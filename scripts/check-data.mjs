#!/usr/bin/env node
/**
 * Data consistency and privacy checks, run by the deploy workflow on every push.
 * Whatever wrote the files (sync-espn.mjs, a person, Pages CMS), this is the last
 * gate before the data goes public.
 *
 *   node scripts/check-data.mjs
 *
 * 1. No transaction file may contain trade proposals, declines, upholds or draft
 *    picks. From 2026 on, pending moves are banned too, since they would expose
 *    a manager's live waiver claims.
 * 2. Every league-scores.json row has exactly one box score with the same managers
 *    and scores, and every box score has a row. This is what makes the site's
 *    score links safe.
 * 3. The index files agree with the season files they summarize.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = f => JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
const seasonsOf = prefix => fs.readdirSync(root)
  .map(f => new RegExp(`^${prefix}-(\\d{4})\\.json$`).exec(f)).filter(Boolean).map(m => +m[1]).sort();
const errors = [];

const PRIVATE = new Set(["TRADE_PROPOSAL", "TRADE_DECLINE", "TRADE_UPHOLD", "DRAFT"]);
const tIdx = read("transactions-index.json");
for (const y of seasonsOf("transactions")) {
  const d = read(`transactions-${y}.json`);
  const bad = d.transactions.filter(t => PRIVATE.has(t.ty) || (y >= 2026 && t.st === "PENDING"));
  if (bad.length) errors.push(`transactions-${y}.json has ${bad.length} private row(s) (${[...new Set(bad.map(t => `${t.ty}/${t.st}`))].join(", ")})`);
  const s = tIdx.seasons.find(x => x.year === y);
  if (!s) errors.push(`transactions-index.json has no ${y} entry`);
  else if (s.total !== d.transactions.length) errors.push(`transactions-index.json says ${y} has ${s.total} rows; the file has ${d.transactions.length}`);
}

const scores = read("league-scores.json");
const bIdx = read("boxscores-index.json");
const key = (y, w, a, b, sa, sb) => [y, w, ...[[a, sa], [b, sb]].sort().flat()].join("|");
const boxKeys = new Map();
for (const y of seasonsOf("boxscores")) {
  const d = read(`boxscores-${y}.json`);
  const weeks = Object.keys(d.weeks).map(Number).sort((a, b) => a - b);
  const entry = bIdx.seasons.find(s => s.year === y);
  const count = weeks.reduce((a, w) => a + d.weeks[w].length, 0);
  if (!entry || entry.matchups !== count || entry.weeks.join() !== weeks.join()) {
    errors.push(`boxscores-index.json disagrees with boxscores-${y}.json`);
  }
  for (const w of weeks) for (const m of d.weeks[w]) {
    const k = key(y, +w, m.away.manager, m.home.manager, m.away.points, m.home.points);
    boxKeys.set(k, (boxKeys.get(k) || 0) + 1);
  }
}
if (bIdx.totalMatchups !== bIdx.seasons.reduce((a, s) => a + s.matchups, 0)) errors.push("boxscores-index.json totalMatchups is off");
const rowKeys = new Map();
for (const r of scores) {
  const k = key(r.year, r.week, r.manager1, r.manager2, r.score1, r.score2);
  rowKeys.set(k, (rowKeys.get(k) || 0) + 1);
}
const onlyRows = [...rowKeys].filter(([k, n]) => boxKeys.get(k) !== n).map(([k]) => k);
const onlyBox = [...boxKeys].filter(([k, n]) => rowKeys.get(k) !== n).map(([k]) => k);
if (onlyRows.length) errors.push(`${onlyRows.length} score row(s) without a matching box score, e.g. ${onlyRows[0]}`);
if (onlyBox.length) errors.push(`${onlyBox.length} box score(s) without a matching score row, e.g. ${onlyBox[0]}`);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Data check passed: ${scores.length} score rows = ${[...boxKeys.values()].reduce((a, b) => a + b, 0)} box scores; no private transactions`);
