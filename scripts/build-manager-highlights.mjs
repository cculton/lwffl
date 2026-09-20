#!/usr/bin/env node
/**
 * Builds manager-highlights.json — the per-manager "Front Office" data that
 * managers.html renders as tiles and top-five widgets.
 *
 *   node scripts/build-manager-highlights.mjs
 *
 * Sources
 *   transactions-{2018..}.json  winning FAAB bids
 *   boxscores-{2014..}.json     starter usage and starter points
 *   draft-history-2.json        draft picks
 *
 * Two rules matter here and both were bugs before this script existed:
 *
 * 1. A FAAB bid only counts if it actually won. ESPN keeps every losing claim
 *    on the same player at the same timestamp, plus PENDING rows for claims a
 *    manager edited or that never processed. Only `ty === "WAIVER"` AND
 *    `st === "EXECUTED"` is a real, paid bid — that is the same rule the
 *    per-season faabByManager totals already use.
 *
 * 2. Top-five lists include ties. Where the tie group at the cutoff is too
 *    large to list, the extras are reported as an explicit `tiedRest` summary
 *    rather than silently truncated, so nothing is dropped at random.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = f => JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
const yearsOf = prefix => fs.readdirSync(root)
  .map(f => new RegExp(`^${prefix}-(\\d{4})\\.json$`).exec(f))
  .filter(Boolean).map(m => Number(m[1])).sort((a, b) => a - b);

/* How many rows a widget may show before a tie group is collapsed. */
const TOP_N = 5;
const MAX_ROWS = 8;

/**
 * Rank entries into a top-five that keeps ties.
 *
 * Entries are grouped by value. Whole groups are taken until at least TOP_N
 * rows are on the board. If the group that crosses the line would push the
 * list past MAX_ROWS, that group is not listed individually — it comes back
 * as `tiedRest` so the page can say "18 more tied at 2" instead of picking
 * an arbitrary handful.
 */
function topWithTies(entries, { decimals = null, minValue = null } = {}) {
  const key = v => decimals == null ? v : Number(v.toFixed(decimals));
  const pool = minValue == null ? entries : entries.filter(e => e.value >= minValue);
  const sorted = pool.slice().sort((a, b) => b.value - a.value);

  const groups = [];
  for (const e of sorted) {
    const k = key(e.value);
    const g = groups[groups.length - 1];
    if (g && key(g.value) === k) g.items.push(e);
    else groups.push({ value: e.value, items: [e] });
  }

  const rows = [];
  let tiedRest = null;
  let rank = 1;
  for (const g of groups) {
    if (rows.length >= TOP_N) break;
    if (rows.length + g.items.length > MAX_ROWS) {
      tiedRest = { value: g.value, count: g.items.length };
      break;
    }
    for (const it of g.items) rows.push({ ...it, rank });
    rank += g.items.length;
  }
  return tiedRest ? { rows, tiedRest } : { rows };
}

/* ---------------- FAAB: winning bids only ---------------- */

const costliestBid = {};
const txYears = yearsOf("transactions");
for (const year of txYears) {
  for (const t of read(`transactions-${year}.json`).transactions) {
    if (t.ty !== "WAIVER" || t.st !== "EXECUTED" || !(t.bid > 0) || !t.mgr) continue;
    const add = (t.items || []).find(i => i.t === "ADD");
    if (!add) continue;
    const cur = costliestBid[t.mgr];
    /* ties on amount go to the earlier bid — deterministic, not arbitrary */
    if (!cur || t.bid > cur.bid || (t.bid === cur.bid && t.date < cur.date)) {
      costliestBid[t.mgr] = {
        bid: t.bid, player: add.p, pos: add.pos, year, week: t.wk, date: t.date
      };
    }
  }
}

/* ---------------- Starter usage and starter points ---------------- */

/* Keyed on ESPN player id so a mid-career rename (Kyle Pitts -> Kyle Pitts Sr.)
   stays one player; the most recent spelling wins for display. */
const byManager = {};
const bxYears = yearsOf("boxscores");
for (const year of bxYears) {
  const data = read(`boxscores-${year}.json`);
  for (const games of Object.values(data.weeks)) {
    for (const g of games) {
      for (const side of ["away", "home"]) {
        const s = g[side];
        if (!s || !s.manager) continue;
        const bucket = byManager[s.manager] || (byManager[s.manager] = new Map());
        for (const p of s.starters || []) {
          const id = p.id ?? p.name;
          const rec = bucket.get(id) || { name: p.name, pos: p.pos, starts: 0, pts: 0, lastYear: 0 };
          rec.starts += 1;
          rec.pts += p.pts || 0;
          if (year >= rec.lastYear) { rec.name = p.name; rec.pos = p.pos; rec.lastYear = year; }
          bucket.set(id, rec);
        }
      }
    }
  }
}

/* ---------------- Draft picks ---------------- */

const draftByManager = {};
for (const pick of read("draft-history-2.json")) {
  if (!pick.manager || !pick.name) continue;
  const bucket = draftByManager[pick.manager] || (draftByManager[pick.manager] = new Map());
  const rec = bucket.get(pick.name) || { name: pick.name, pos: pick.position, times: 0, years: [] };
  rec.times += 1;
  rec.years.push(pick.year);
  if (pick.position) rec.pos = pick.position;
  bucket.set(pick.name, rec);
}

/* ---------------- Assemble ---------------- */

const managers = new Set([
  ...Object.keys(byManager), ...Object.keys(draftByManager), ...Object.keys(costliestBid)
]);

const topDrafted = {}, topStarted = {}, topScorers = {}, mostStarted = {};

for (const m of managers) {
  const roster = [...(byManager[m] || new Map()).values()];

  if (roster.length) {
    topStarted[m] = topWithTies(
      roster.map(r => ({ name: r.name, pos: r.pos, value: r.starts, pts: Number(r.pts.toFixed(2)) }))
    );
    topScorers[m] = topWithTies(
      roster.map(r => ({ name: r.name, pos: r.pos, value: Number(r.pts.toFixed(2)), starts: r.starts })),
      { decimals: 2 }
    );
    /* legacy single-value tile, kept so nothing else on the site breaks */
    const max = Math.max(...roster.map(r => r.starts));
    mostStarted[m] = {
      starts: max,
      players: roster.filter(r => r.starts === max).map(r => ({ name: r.name, pos: r.pos }))
    };
  }

  const picks = [...(draftByManager[m] || new Map()).values()];
  if (picks.length) {
    /* drafting a player once is not a "most drafted" fact — repeats only */
    topDrafted[m] = topWithTies(
      picks.map(r => ({
        name: r.name, pos: r.pos, value: r.times,
        years: r.years.slice().sort((a, b) => a - b)
      })),
      { minValue: 2 }
    );
  }
}

const out = {
  generated: new Date().toISOString().slice(0, 10),
  note: "FAAB figures count winning waiver claims only (WAIVER + EXECUTED). " +
        "Top-five lists include ties; an oversized tie group at the cutoff is " +
        "reported as tiedRest rather than truncated.",
  draftedThrough: Math.max(...read("draft-history-2.json").map(p => p.year)),
  startsFrom: bxYears[0],
  mostStarted, costliestBid, topDrafted, topStarted, topScorers
};

fs.writeFileSync(path.join(root, "manager-highlights.json"), JSON.stringify(out) + "\n");

console.log(`managers: ${managers.size}`);
console.log(`costliest bids: ${Object.keys(costliestBid).length}`);
console.log(`drafted widgets: ${Object.keys(topDrafted).length}, started: ${Object.keys(topStarted).length}, scorers: ${Object.keys(topScorers).length}`);
