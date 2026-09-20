#!/usr/bin/env node
/**
 * Rasterises n/cards/<slug>.html -> n/cards/<slug>.png (1200x630).
 *
 *   node scripts/render-cards.mjs
 *
 * og:image has to be a raster format — Discord and iMessage will not render
 * an SVG card — so the templates build-notebook.mjs emits get screenshotted
 * once each. Needs a Chromium; set CHROME_PATH if it is not on the usual
 * playwright path. If you have no Chromium handy, skip this: the posts still
 * unfurl with title and description, just without the picture.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "n", "cards");

let chromium;
try { ({ chromium } = await import("playwright-core")); }
catch { console.error("playwright-core not installed — skipping card render"); process.exit(0); }

const exe = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });

for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".html"))) {
  await page.goto("file://" + path.join(dir, f), { waitUntil: "networkidle" });
  await page.waitForTimeout(350);          /* webfonts */
  const out = f.replace(/\.html$/, ".png");
  await page.screenshot({ path: path.join(dir, out) });
  console.log("  " + out);
}
await browser.close();
