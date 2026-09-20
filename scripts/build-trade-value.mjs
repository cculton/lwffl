#!/usr/bin/env node
/**
 * Rebuilds trade-value.json — how every documented trade actually turned out.
 *
 *   node scripts/build-trade-value.mjs
 *   node scripts/placebo-test.mjs      (validates that this is unbiased)
 *
 * Two numbers per side of a trade:
 *
 *   Lineup Points — what the players you received scored, counted only in the
 *   weeks you actually started them. Zero-sum by construction: one side's
 *   surplus is the other's deficit.
 *
 *   Swap-Back — what the trade did to your weekly best lineup versus a
 *   counterfactual in which it never happened. Your roster is rebuilt without
 *   the players you got and with the players you gave away put back, the best
 *   legal lineup is set for both versions, and the difference is the number.
 *
 * ON THE POSITIVE LEAGUE-WIDE SUM. Swap-back totals roughly +1,100 across the
 * league rather than zero, and more trades help both sides than hurt both.
 * That was once read here as a bug — it is not. Lineup value is concave: a
 * third good running back is worth nothing if you can only start two. A trade
 * that converts one manager's surplus into another's need therefore creates
 * real value for both, which is why the two of them agreed to it. Swap-back
 * is not zero-sum and should not be.
 *
 * `placebo-test.mjs` is the evidence. It re-scores each real trade with
 * randomly chosen players from the same two rosters in the same week. Those
 * fake trades come out at mean -4.4 and median 0.0, with 40% joint-negative,
 * while the real ones average +30.4 with 14% joint-negative. An engine that
 * manufactured gains would inflate the random trades too. Re-run it after any
 * change to the lineup solver or the counterfactual.
 *
 * ONE REAL REFINEMENT over the original build: when a player you gave away
 * had been dropped by the entire league, the old version put a ZERO into the
 * no-trade roster. He is now valued at replacement level for his position
 * that week — what the waiver fringe actually scored — since a player a
 * 12-team league declined to roster was worth about that, not nothing. This
 * touches 193 player-weeks and moves 18 of 74 trade sides, by at most 12.3
 * points. Small, but it is the honest number.
 *
 * Swap-back needs bench data to rebuild a roster, so it starts in 2018.
 * Lineup Points runs from 2014 — see scripts/merge-legacy-trades.mjs for how
 * the 2014-15 trades were recovered after being written off as unrecoverable.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = f => JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
const years = fs.readdirSync(root)
  .map(f => /^boxscores-(\d{4})\.json$/.exec(f))
  .filter(Boolean).map(m => Number(m[1])).sort((a, b) => a - b);

/* Slot eligibility. FLEX and WR/TE are the only multi-position slots this
   league has ever used; the TE slot became WR/TE in 2025. */
const ELIGIBLE = {
  QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"],
  "D/ST": ["D/ST"], K: ["K"],
  FLEX: ["RB", "WR", "TE"],
  "WR/TE": ["WR", "TE"]
};
const BENCH_SLOTS = new Set(["BE", "IR"]);

/* ---------- load every rostered player-week ---------- */

/* roster[year][week][manager] = [{id,name,pos,pts,started}] — IR excluded,
   since an injured-reserve player cannot be moved into a lineup.
   scores[year][week][playerId] = pts, across every team in the league, which
   is how a player given away is priced once he is on somebody else's roster. */
const roster = {}, scores = {}, slotTemplate = {}, benchEra = new Set();

for (const year of years) {
  const data = read(`boxscores-${year}.json`);
  roster[year] = {}; scores[year] = {};
  if (data.benchAvailable) benchEra.add(year);
  const templates = new Map();

  for (const [wk, games] of Object.entries(data.weeks)) {
    const w = Number(wk);
    roster[year][w] = roster[year][w] || {};
    scores[year][w] = scores[year][w] || {};
    for (const g of games) {
      for (const side of ["away", "home"]) {
        const s = g[side];
        if (!s || !s.manager) continue;
        const starters = s.starters || [];
        const bench = (s.bench || []).filter(p => !BENCH_SLOTS.has(p.slot) || p.slot === "BE");
        const all = [...starters.map(p => ({ ...p, started: true })),
                     ...bench.map(p => ({ ...p, started: false }))];
        roster[year][w][s.manager] = all
          .filter(p => p.slot !== "IR")
          .map(p => ({ id: p.id ?? p.name, name: p.name, pos: p.pos, pts: p.pts || 0, started: p.started }));
        for (const p of all) scores[year][w][p.id ?? p.name] = p.pts || 0;

        if (starters.length) {
          const key = starters.map(p => p.slot).sort().join(",");
          templates.set(key, (templates.get(key) || 0) + 1);
        }
      }
    }
  }
  /* the modal starting template is this season's lineup rule */
  const best = [...templates.entries()].sort((a, b) => b[1] - a[1])[0];
  slotTemplate[year] = best ? best[0].split(",") : [];
}

/* ---------- replacement level, per season-week-position ---------- */

/* The league starts a known number of players at each position each week.
   Everyone rostered beyond that line is the bench/waiver fringe, and their
   average is what a freely available body was worth. An unrostered player
   sits at or below this — it is a deliberately conservative stand-in, and
   it applies identically to both sides of every trade. */
const replacement = {};
for (const year of years) {
  replacement[year] = {};
  for (const [w, teams] of Object.entries(roster[year])) {
    const byPos = {}, started = {};
    for (const players of Object.values(teams)) {
      for (const p of players) {
        (byPos[p.pos] = byPos[p.pos] || []).push(p.pts);
        if (p.started) started[p.pos] = (started[p.pos] || 0) + 1;
      }
    }
    replacement[year][w] = {};
    for (const [pos, pts] of Object.entries(byPos)) {
      const demand = started[pos] || 0;
      const fringe = pts.slice().sort((a, b) => b - a).slice(demand);
      replacement[year][w][pos] = fringe.length
        ? fringe.reduce((a, b) => a + b, 0) / fringe.length
        : 0;
    }
  }
}

/* ---------- optimal lineup ---------- */

/* Greedy by scarcity: fill the most constrained slots first (a QB slot can
   only take a QB), leaving the multi-position slots for whoever is left.
   Checked against an exhaustive max-weight assignment on 90 real rosters
   across both slot templates: identical every time. Note the check only
   holds because every slot MUST be filled — allow a slot to go empty and
   greedy loses, since a negative D/ST score is better left out. Real
   lineups cannot do that. */
function bestLineup(players, template) {
  const slots = template.slice()
    .sort((a, b) => ELIGIBLE[a].length - ELIGIBLE[b].length);
  const pool = players.slice().sort((a, b) => b.pts - a.pts);
  const used = new Set();
  let total = 0;
  for (const slot of slots) {
    const ok = ELIGIBLE[slot] || [];
    const pick = pool.find(p => !used.has(p) && ok.includes(p.pos));
    if (pick) { used.add(pick); total += pick.pts; }
  }
  return total;
}

/* ---------- trades ---------- */

const history = read("trades-history.json");
const lastWeek = {};
for (const year of years) lastWeek[year] = Math.max(...Object.keys(roster[year]).map(Number));

/* NFL week-1 Thursday by season. A fantasy week rolls over on the Tuesday
   before its games, which is where the -2 below comes from. Calibrated
   against all 66 trades whose week the original import had already
   established: this rule reproduces every one of them exactly, for both
   anchor offsets of 2 and 3 days, so the boundary is not in doubt. */
const WEEK1_THURSDAY = {
  2014: "2014-09-04", 2015: "2015-09-10", 2016: "2016-09-08", 2017: "2017-09-07",
  2018: "2018-09-06", 2019: "2019-09-05", 2020: "2020-09-10", 2021: "2021-09-09",
  2022: "2022-09-08", 2023: "2023-09-07", 2024: "2024-09-05", 2025: "2025-09-04",
  2026: "2026-09-10"
};

function tradeWeek(year, iso) {
  if (!iso || !WEEK1_THURSDAY[year]) return null;
  const anchor = new Date(`${WEEK1_THURSDAY[year]}T12:00:00`);
  anchor.setDate(anchor.getDate() - 2);
  const wk = Math.floor((new Date(`${iso}T12:00:00`) - anchor) / (7 * 864e5)) + 1;
  const weeks = Object.keys(roster[year] || {}).map(Number).sort((a, b) => a - b);
  if (!weeks.length) return null;
  return Math.min(Math.max(wk, weeks[0]), weeks[weeks.length - 1]);
}

let unobservable = 0, imputed = 0, observedReturns = 0;
let benchedPts = 0, acquiredPts = 0;

function scoreTrade(t) {
  const year = t.year;
  const sides = Object.entries(t.receives || {});
  if (sides.length !== 2 || !roster[year]) return null;

  const week = tradeWeek(year, t.date);
  if (!week) return null;
  const end = lastWeek[year];
  const weeks = [];
  for (let w = week; w <= end; w++) if (roster[year][w]) weeks.push(w);
  if (!weeks.length) return null;

  /* Map each side's named haul onto player ids seen on that manager's roster.
     Keyed by the name from the email, not by what the roster happens to show:
     2014-17 box scores carry starters only, so a player who was acquired and
     never started has no roster row at all. He still belongs on the trade
     card with zero starts — dropping him would silently shorten the haul. */
  const idsFor = (manager, names) => {
    const found = new Map();
    for (const n of names) found.set(n.toLowerCase(), { id: null, name: n, pos: null });
    for (const w of weeks) {
      for (const p of (roster[year][w] || {})[manager] || []) {
        const k = p.name.toLowerCase();
        if (found.has(k) && found.get(k).id == null) {
          found.set(k, { id: p.id, name: p.name, pos: p.pos });
        }
      }
    }
    return found;
  };

  const out = { year: t.year, date: t.date, week, weeksRemaining: weeks.length,
    benchEra: benchEra.has(year), parties: t.parties, sides: {} };

  const recv = {};
  for (const [m, names] of sides) recv[m] = idsFor(m, names);

  for (const [m, names] of sides) {
    const other = sides.find(([x]) => x !== m)[0];
    const mine = recv[m];                 /* players this manager received */
    const gave = recv[other];             /* ...which the other side gave away */

    /* --- Lineup Points: received players, only where actually started --- */
    const mineIds = new Set([...mine.values()].filter(p => p.id != null).map(p => p.id));
    const gaveIds = new Set([...gave.values()].filter(p => p.id != null).map(p => p.id));

    const perPlayer = new Map();
    for (const { name, pos } of mine.values()) perPlayer.set(name.toLowerCase(), { name, pos, pts: 0, starts: 0 });
    let lineupPts = 0, starts = 0, rosteredPts = 0;
    for (const w of weeks) {
      for (const p of (roster[year][w] || {})[m] || []) {
        if (!mineIds.has(p.id)) continue;
        rosteredPts += p.pts;                 /* whether started or benched */
        if (!p.started) continue;
        lineupPts += p.pts; starts++;
        const rec = perPlayer.get(p.name.toLowerCase());
        if (rec) { rec.pts += p.pts; rec.starts++; if (!rec.pos) rec.pos = p.pos; }
      }
    }
    benchedPts += rosteredPts - lineupPts;
    acquiredPts += rosteredPts;

    /* --- Roster Gain: best lineup with the trade vs. without it --- */
    let gain = null;
    if (benchEra.has(year)) {
      gain = 0;
      const tmpl = slotTemplate[year];
      for (const w of weeks) {
        const have = (roster[year][w] || {})[m];
        if (!have) continue;

        const actual = bestLineup(have, tmpl);

        /* no-trade roster: drop what came in, put back what went out */
        const without = have.filter(p => !mineIds.has(p.id));
        const held = new Set(without.map(p => p.id));
        for (const { id, name, pos } of gave.values()) {
          if (id == null || held.has(id)) continue;                 /* re-acquired later */
          const seen = scores[year][w] && Object.prototype.hasOwnProperty.call(scores[year][w], id);
          if (seen) { observedReturns++; without.push({ id, name, pos, pts: scores[year][w][id] }); }
          else {
            /* THE FIX: nobody rostered him, so he is worth replacement
               level — not the zero the old swap-back used. */
            unobservable++; imputed++;
            without.push({ id, name, pos, pts: (replacement[year][w] || {})[pos] ?? 0 });
          }
        }
        gain += actual - bestLineup(without, tmpl);
      }
      gain = Math.round(gain * 100) / 100;
    }

    out.sides[m] = {
      players: [...perPlayer.values()].map(p => ({ ...p, pts: Math.round(p.pts * 100) / 100 })),
      lineupPts: Math.round(lineupPts * 100) / 100,
      starts,
      swapBack: gain
    };
  }

  const [a, b] = Object.keys(out.sides);
  out.margin = Math.round(Math.abs(out.sides[a].lineupPts - out.sides[b].lineupPts) * 100) / 100;
  out.winner = out.sides[a].lineupPts === out.sides[b].lineupPts ? null
    : out.sides[a].lineupPts > out.sides[b].lineupPts ? a : b;
  return out;
}

const scored = history.trades.map(scoreTrade).filter(Boolean)
  .sort((x, y) => (x.date || "").localeCompare(y.date || ""));

export { scored, bestLineup, replacement, slotTemplate, roster, scores, lastWeek, ELIGIBLE };

/* ---------- career rollup ---------- */

const PUSH_BAND = Number(process.env.PUSH_BAND || 15);

const career = {};
const touch = m => career[m] = career[m] || { manager: m, trades: 0, w: 0, l: 0, p: 0,
  net: 0, gain: 0, gainTrades: 0 };

for (const t of scored) {
  const ms = Object.keys(t.sides);
  for (const m of ms) {
    const c = touch(m);
    c.trades++;
    const mine = t.sides[m].lineupPts, theirs = t.sides[ms.find(x => x !== m)].lineupPts;
    c.net += mine - theirs;
    if (t.margin < PUSH_BAND) c.p++;
    else if (t.winner === m) c.w++; else c.l++;
    if (t.sides[m].swapBack != null) { c.gain += t.sides[m].swapBack; c.gainTrades++; }
  }
}
const careerRows = Object.values(career).map(c => ({
  ...c,
  net: Math.round(c.net * 100) / 100,
  perTrade: Math.round((c.net / c.trades) * 100) / 100,
  gain: c.gainTrades ? Math.round(c.gain * 100) / 100 : null,
  gainPerTrade: c.gainTrades ? Math.round((c.gain / c.gainTrades) * 100) / 100 : null
})).sort((a, b) => b.perTrade - a.perTrade);

const benchEraScored = scored.filter(t => t.benchEra).length;
const gainSum = careerRows.reduce((a, c) => a + (c.gain || 0), 0);
const bothUp = scored.filter(t => t.benchEra &&
  Object.values(t.sides).every(s => s.swapBack > 0)).length;
const bothDown = scored.filter(t => t.benchEra &&
  Object.values(t.sides).every(s => s.swapBack < 0)).length;

const lineupPtsTotal = scored.reduce((a, t) =>
  a + Object.values(t.sides).reduce((x, s) => x + s.lineupPts, 0), 0);

const out = {
  generated: new Date().toISOString().slice(0, 10),
  metric: "swapBack",
  scored: scored.length,
  benchEraScored,
  firstYear: Math.min(...scored.map(t => t.year)),
  gainFirstYear: Math.min(...scored.filter(t => t.benchEra).map(t => t.year)),
  undocumentedTrades: history.totalPerCounters - scored.length,
  undocumentedSeasons: history.undocumentedSeasons,
  pushBand: PUSH_BAND,
  pushes: scored.filter(t => t.margin < PUSH_BAND).length,
  lineupPtsTotal: Math.round(lineupPtsTotal * 100) / 100,
  benchWastePct: acquiredPts ? Math.round((benchedPts / acquiredPts) * 100) : 0,
  imputedPlayerWeeks: imputed,
  observedPlayerWeeks: observedReturns,
  bothImproved: bothUp,
  bothHurt: bothDown,
  leagueGainSum: Math.round(gainSum * 100) / 100,
  career: careerRows,
  trades: scored
};

if (process.argv[1] && process.argv[1].endsWith("build-trade-value.mjs")) {
  fs.writeFileSync(path.join(root, "trade-value.json"), JSON.stringify(out) + "\n");
  console.log(`scored ${scored.length} trades (${benchEraScored} with roster gain)`);
  console.log(`imputed ${imputed} player-weeks at replacement, observed ${observedReturns}`);
  console.log(`both improved ${bothUp} | both hurt ${bothDown} | league gain sum ${gainSum.toFixed(1)}`);
}
