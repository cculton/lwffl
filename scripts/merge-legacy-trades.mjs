#!/usr/bin/env node
/**
 * Merges the recovered 2014–2015 trades into trades-history.json.
 *
 *   node scripts/merge-legacy-trades.mjs data/legacy-trades-2014-2015.json
 *
 * WHY THESE WERE MISSING. The original import concluded ESPN's trade
 * notification emails "started September 2016" and wrote off 31 trades as
 * unrecoverable. That was wrong. ESPN changed both the sender and the subject
 * line between 2015 and 2016, so a search keyed on the newer pair found
 * nothing in the older seasons:
 *
 *              sender                              subject
 *   2014–15    espnfantasy@fantasygames.go.com     "A Trade Has Been Accepted in Your ESPN Fantasy Football League"
 *   2016+      fantasy@espnmail.com                "A Trade in Your ESPN Fantasy Football League Has Been Accepted"
 *
 * Search BOTH if this is ever re-run. Other traps worth keeping:
 *
 * - The 2014–15 body says "X traded PLAYER to Y", which is unambiguous — the
 *   named team GIVES. That is a different shape from the 2016+ wording
 *   ("X trades PLAYER, Y trades PLAYER"), which reads as if X receives.
 * - ESPN sends ONE email per trade to the whole league, not one per team, so
 *   there is no second copy of a missing trade under another recipient.
 * - Gmail threads bundle unrelated trades. Count messages, not threads.
 * - Filter by league name in the body. These years overlap with the owner's
 *   other ESPN leagues (Hernandez's Jail Cell, Trinity Test League, Calamity
 *   at Amity, Bottom's Up) whose emails look identical.
 * - Managers renamed teams mid-season (Adam Goho ran "Matt Is Gay",
 *   "Bryce Is Gay" and "Chad Is Gay" in 2014 alone), so match on the manager
 *   name ESPN prints after the abbreviation, never on the team name.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = f => JSON.parse(fs.readFileSync(path.isAbsolute(f) ? f : path.join(root, f), "utf8"));

const src = process.argv[2] || "data/legacy-trades-2014-2015.json";
const recovered = read(src);
const th = read("trades-history.json");
const counters = read("transactions-index.json").counters;

/* ---- trades ESPN's per-team counters say each season had ---- */
const counterTotal = year => Math.round(
  Object.values(counters[String(year)] || {}).reduce((a, v) => a + (v.trades || 0), 0) / 2
);

/* ---- per-manager reconciliation, the only check that matters ---- */
function reconcile(year, rows) {
  const seen = {};
  for (const t of rows) for (const m of Object.keys(t.receives)) seen[m] = (seen[m] || 0) + 1;
  const espn = counters[String(year)] || {};
  const off = [];
  for (const [m, v] of Object.entries(espn)) {
    const want = v.trades || 0, got = seen[m] || 0;
    if (want !== got) off.push({ manager: m, espn: want, email: got, delta: got - want });
  }
  return off;
}

const out = { ...th, trades: th.trades.filter(t => t.year >= 2016) };
const seasons = new Map(th.seasons.map(s => [s.year, { ...s }]));
const undocumented = { ...th.undocumentedSeasons };

for (const year of [2014, 2015]) {
  const rows = recovered.filter(t => t.year === year);
  const off = reconcile(year, rows);
  const total = counterTotal(year);

  for (const t of rows) {
    out.trades.push({
      year, date: t.date, detail: true,
      parties: Object.keys(t.receives),
      receives: t.receives
    });
  }

  /* A manager short by exactly one on both sides of a gap identifies the
     participants of a trade whose email did not survive — the same inference
     the 2016 season already ships. Anything messier is left alone. */
  const short = off.filter(o => o.delta === -1);
  let inferred = 0;
  if (rows.length + short.length / 2 === total && short.length === 2) {
    out.trades.push({
      year, date: null, detail: false,
      parties: short.map(o => o.manager),
      note: "Participants inferred from ESPN per-team trade counters; no confirmation email survives, so the players are unknown.",
      receives: {}
    });
    inferred = 1;
  }

  seasons.set(year, {
    year,
    trades: rows.length + inferred,
    detailed: rows.length,
    espnCounter: total,
    reconciles: rows.length + inferred === total,
    ...(rows.length + inferred === total ? {} : { undocumented: total - rows.length - inferred })
  });

  if (rows.length + inferred === total) delete undocumented[year];
  else undocumented[year] = total - rows.length - inferred;

  console.log(`${year}: ${rows.length} recovered, ${inferred} inferred, ESPN counter ${total}` +
    (off.length ? `  (short: ${off.map(o => `${o.manager} ${o.delta}`).join(", ")})` : "  reconciles exactly"));
}

out.trades.sort((a, b) => a.year - b.year || (a.date || "").localeCompare(b.date || ""));
out.seasons = [...seasons.values()].sort((a, b) => a.year - b.year);
out.undocumentedSeasons = undocumented;
out.documented = out.trades.length;
out.withPlayers = out.trades.filter(t => t.detail).length;
out.generated = new Date().toISOString().slice(0, 10);
out.source = "ESPN trade confirmation emails (two sender/subject formats, 2014-15 and 2016+), " +
  "cross-checked against ESPN's per-team trade counters";

const career = {};
for (const t of out.trades) for (const m of t.parties) career[m] = (career[m] || 0) + 1;
out.career = Object.fromEntries(Object.entries(career).sort((a, b) => b[1] - a[1]));

fs.writeFileSync(path.join(root, "trades-history.json"), JSON.stringify(out) + "\n");
console.log(`\ntotal ${out.documented} documented, ${out.withPlayers} with players, ` +
  `of ${out.totalPerCounters} per counters`);
