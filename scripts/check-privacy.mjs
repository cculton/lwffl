#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const managers = new Set(JSON.parse(readFileSync(join(root, "final-standings.json"), "utf8"))
  .map(row => row.manager));
const errors = [];

for (const name of managers) {
  if (!/^[A-Z][a-z]+$|^Ryan [A-Z]\.$/.test(name)) {
    errors.push(`Manager label is not a first name or Ryan initial: ${name}`);
  }
}
if (managers.size !== 16) errors.push(`Expected 16 distinct manager labels; found ${managers.size}`);

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === ".git" || entry.name === "node_modules") return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

for (const file of files(root)) {
  if (file.endsWith(".html")) {
    if (!/<meta\s+name="robots"\s+content="[^"]*noindex/i.test(readFileSync(file, "utf8"))) {
      errors.push(`${relative(root, file)} lacks a noindex tag`);
    }
  }
  if (!file.endsWith(".json")) continue;
  const data = JSON.parse(readFileSync(file, "utf8"));
  function walk(value, at = "") {
    if (Array.isArray(value)) return value.forEach((item, i) => walk(item, `${at}[${i}]`));
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      const field = `${at}.${key}`;
      if (/^manager[12]?$/.test(key) && typeof item === "string" && item && !managers.has(item)) {
        errors.push(`${relative(root, file)}${field}: unknown manager label`);
      }
      if (key === "faabByManager" && item && typeof item === "object") {
        for (const name of Object.keys(item)) {
          if (!managers.has(name)) errors.push(`${relative(root, file)}${field}: unknown manager key`);
        }
      }
      walk(item, field);
    }
  }
  walk(data);
}

if (!readFileSync(join(root, "robots.txt"), "utf8").includes("Disallow: /")) {
  errors.push("robots.txt has no AI crawler exclusion");
}
if (errors.length) {
  console.error(errors.slice(0, 30).join("\n"));
  process.exit(1);
}
console.log(`Privacy check passed: ${managers.size} manager labels, JSON joins, HTML noindex tags`);
