#!/usr/bin/env node
/**
 * Refreshes the current season from ESPN's league API.
 *
 *   ESPN_S2=... ESPN_SWID=... node scripts/sync-espn.mjs            live
 *   node scripts/sync-espn.mjs --raw <dir>                           saved responses
 *   add --dry-run to report without writing
 *
 * Rewrites, for the CURRENT season only:
 *   league-scores.json        this season's rows (every completed week)
 *   boxscores-<year>.json     + boxscores-index.json
 *   transactions-<year>.json  + transactions-index.json
 *   trades-history.json       this season's completed trades
 *
 * Every completed week is rebuilt on every run, so ESPN stat corrections flow
 * through on their own. Earlier seasons are never fetched or changed; their
 * files are only read to recompute the all-time index totals.
 *
 * The script writes nothing unless every check at the bottom passes.
 * The checks cover:
 *  - Each box score's starters must add up to ESPN's team total.
 *  - This season's box scores and league-scores rows must match 1:1.
 *  - Every manager label must be one of the site's known labels.
 *  - No private transaction type may be written.
 * If any check fails, the script exits non-zero and nothing is published.
 *
 * ESPN traps it handles (see the espn-*-import notes in the project):
 *  - In-progress seasons repeat the live week for every future scoringPeriodId.
 *    We only ask for periods up to latestScoringPeriod and dedupe by id anyway.
 *  - Consolation matchups (both *_CONSOLATION_LADDER tiers) and playoff byes are
 *    excluded; the site has only ever counted the winners bracket.
 *  - A trade is PROPOSAL -> ACCEPT(s) linked by relatedTransactionId. ESPN
 *    often discards the proposal's player list once the trade completes, so
 *    the players are also recovered from rosters (acquisitionType TRADE) and,
 *    once captured, kept in trades-history.json.
 *  - 2018 transactions sometimes have no teamId; team comes from the items.
 *
 * PRIVACY. Never published:
 *  - TRADE_PROPOSAL / TRADE_DECLINE / TRADE_UPHOLD. ESPN keeps offer detail
 *    lopsidedly, so publishing them would put a one-sided record of who
 *    offered what on a public site.
 *  - Anything still PENDING. The API only shows the logged-in manager's own
 *    pending waiver claims. Publishing them would expose one manager's live
 *    claims and bids before waivers run.
 *  - DRAFT (already covered by draft-history.json).
 *  - Last names. Labels are first names, and the Ryans get a last initial.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEAGUE = 16885;
const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const RAW = opt("--raw");
const DRY = flag("--dry-run");

const PRIVATE_TYPES = new Set(["TRADE_PROPOSAL", "TRADE_DECLINE", "TRADE_UPHOLD", "DRAFT"]);
const SLOT = { 0: "QB", 2: "RB", 4: "WR", 5: "WR/TE", 6: "TE", 16: "D/ST", 17: "K", 23: "FLEX", 20: "BE", 21: "IR" };
const POS = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST" };
const PRO = { 0: "FA", 1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET", 9: "GB",
  10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG",
  20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WSH", 29: "CAR",
  30: "JAX", 33: "BAL", 34: "HOU" };
const STARTER_ORDER = ["QB", "RB", "WR", "TE", "FLEX", "D/ST", "K", "WR/TE"]; // how the site lists lineups
const ROUNDS = ["First Round", "Semifinals", "Championship"];

const file = f => path.join(root, f);
const read = f => JSON.parse(fs.readFileSync(file(f), "utf8"));
const exists = f => fs.existsSync(file(f));
const r2 = x => Math.round(x * 100) / 100;
const fail = msg => { console.error(`sync-espn: ${msg}`); process.exit(1); };

/* ---------------- fetching ---------------- */

async function espn(season, query, rawName) {
  if (RAW) {
    const f = path.join(RAW, `${rawName}.json`);
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, "utf8"));
  }
  const s2 = process.env.ESPN_S2, swid = process.env.ESPN_SWID;
  if (!s2 || !swid) fail("ESPN_S2 and ESPN_SWID must be set (or pass --raw <dir>).");
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${LEAGUE}${query}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { Cookie: `espn_s2=${s2}; SWID=${swid}`, Accept: "application/json" } });
    if (res.status === 401 || res.status === 403) {
      fail(`ESPN refused the login cookies (HTTP ${res.status}). They have probably expired: ` +
        "copy fresh espn_s2 and SWID values into the repo's Actions secrets.");
    }
    if (res.ok) {
      const text = await res.text();
      if (text.trimStart().startsWith("<")) fail("ESPN returned a web page instead of data; the cookies are probably stale.");
      return JSON.parse(text);
    }
    if (attempt >= 3) fail(`ESPN ${res.status} for ${query}`);
    await new Promise(r => setTimeout(r, 2000 * attempt));
  }
}

async function publicJson(url, headers = {}) {
  try {
    const res = await fetch(url, { headers });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

/* ---------------- league + managers ---------------- */

// A season runs September to early January, so January-July still belongs to last
// year's season. Override with --season.
const today = new Date();
const league = await espn(Number(opt("--season")) || today.getUTCFullYear() - (today.getUTCMonth() < 7 ? 1 : 0),
  "?view=mSettings&view=mTeam&view=mStatus", "settings");
const SEASON = league?.seasonId;
if (!league?.teams) fail("could not read league settings/teams");
const status = league.status;
const sched = league.settings.scheduleSettings;
const regularPeriods = sched.matchupPeriodCount;

const labels = new Set(read("final-standings.json").map(r => r.manager));
const members = new Map(league.members.map(m => [m.id, m]));
const teamLabel = new Map();
for (const t of league.teams) {
  const m = members.get(t.primaryOwner || t.owners?.[0]);
  if (!m) fail(`team ${t.id} has no owner record`);
  const first = (m.firstName || "").trim();
  const label = first === "Ryan" ? `Ryan ${(m.lastName || "").trim().charAt(0)}.` : first;
  if (!labels.has(label)) {
    fail(`team ${t.id} ("${t.name}") maps to "${label}", which is not a known manager label. ` +
      "A new owner needs Cobey to choose a label before this can run.");
  }
  teamLabel.set(t.id, label);
}
if (new Set(teamLabel.values()).size !== teamLabel.size) fail("two teams map to the same manager label");
const teamMeta = new Map(league.teams.map(t => [t.id, { teamName: t.name, abbrev: t.abbrev }]));
const mgrOf = id => teamLabel.get(id) ?? null;

/* ---------------- player names ---------------- */

const players = new Map();
function learn(p) {
  if (p?.id != null && p.fullName && !players.has(p.id)) {
    players.set(p.id, { name: p.fullName, pos: POS[p.defaultPositionId] || "", team: PRO[p.proTeamId] || "FA" });
  }
}

/* ---------------- matchups -> box scores + league-scores ---------------- */

const boxFile = `boxscores-${SEASON}.json`;
const prevBox = exists(boxFile) ? read(boxFile) : null;
const prevNames = new Map(); // `${week}:${teamId}` -> {teamName, abbrev}: keep the name a team had that week
for (const [wk, list] of Object.entries(prevBox?.weeks || {})) {
  for (const m of list) for (const side of [m.home, m.away]) if (side) {
    prevNames.set(`${wk}:${side.teamId}`, { teamName: side.teamName, abbrev: side.abbrev });
    if (side.manager !== mgrOf(side.teamId)) {
      fail(`team ${side.teamId} was "${side.manager}" in week ${wk} but ESPN now says "${mgrOf(side.teamId)}". ` +
        "An ownership change needs a manual look.");
    }
  }
}

function lineupEntry(e, week) {
  const p = e.playerPoolEntry?.player || {};
  learn(p);
  const stat = (p.stats || []).find(s => s.scoringPeriodId === week && s.statSourceId === 0 && s.statSplitTypeId === 1);
  const pts = r2(stat ? stat.appliedTotal : (e.playerPoolEntry?.appliedStatTotal ?? 0));
  return { name: p.fullName || `Player ${e.playerId}`, pos: POS[p.defaultPositionId] || "",
    team: PRO[p.proTeamId] || "FA", pts, id: e.playerId, slot: SLOT[e.lineupSlotId] || String(e.lineupSlotId) };
}

function side(s, week) {
  const entries = s.rosterForCurrentScoringPeriod?.entries;
  if (!entries) fail(`week ${week}: team ${s.teamId} has no roster in the response`);
  const all = entries.map(e => lineupEntry(e, week));
  const starters = all.filter(x => x.slot !== "BE" && x.slot !== "IR")
    .sort((a, b) => STARTER_ORDER.indexOf(a.slot) - STARTER_ORDER.indexOf(b.slot) || b.pts - a.pts);
  const bench = all.filter(x => x.slot === "BE" || x.slot === "IR")
    .sort((a, b) => (a.slot === "IR") - (b.slot === "IR") || b.pts - a.pts);
  const names = prevNames.get(`${week}:${s.teamId}`) || teamMeta.get(s.teamId);
  return { teamId: s.teamId, manager: mgrOf(s.teamId), teamName: names.teamName, abbrev: names.abbrev,
    points: r2(s.totalPoints), starterSum: r2(starters.reduce((a, x) => a + x.pts, 0)), starters, bench };
}

const weeks = {};
const scoreRows = [];
const lastPeriod = Math.min(status.currentMatchupPeriod, status.finalScoringPeriod ?? 17);
for (let week = 1; week <= lastPeriod; week++) {
  const data = await espn(SEASON, `?view=mMatchup&view=mMatchupScore&scoringPeriodId=${week}`, `m${week}`);
  if (!data) break;
  const games = data.schedule.filter(g => g.matchupPeriodId === week);
  if (!games.length || games.some(g => g.winner === "UNDECIDED")) break; // week not final yet
  const playoff = week > regularPeriods;
  const kept = games.filter(g => g.home && g.away &&
    (playoff ? g.playoffTierType === "WINNERS_BRACKET" : (g.playoffTierType || "NONE") === "NONE"));
  const round = playoff ? ROUNDS[week - regularPeriods - 1] || "Playoffs" : "N/A";
  weeks[week] = kept.sort((a, b) => a.id - b.id).map(g => ({
    id: g.id, week, round, tier: g.playoffTierType || "NONE", winner: g.winner,
    away: side(g.away, week), home: side(g.home, week)
  }));
  for (const m of weeks[week]) {
    scoreRows.push({ year: SEASON, week, manager1: m.away.manager, score1: m.away.points,
      manager2: m.home.manager, score2: m.home.points, playoffs: round });
  }
}
const doneWeeks = Object.keys(weeks).map(Number);

/* ---------------- transactions ---------------- */

const tx = new Map();
for (let p = 0; p <= status.latestScoringPeriod; p++) {
  const d = await espn(SEASON, `?view=mTransactions2&scoringPeriodId=${p}`, `tx${p}`);
  for (const t of d?.transactions || []) tx.set(t.id, t); // dedupe: live season repeats the current week
}

// Roster snapshot: player names for free agents, and trade detail if ESPN dropped the proposal.
const rosterData = await espn(SEASON, "?view=mRoster", "ros");
const tradedIn = []; // {playerId, teamId, date}
for (const t of rosterData?.teams || []) {
  for (const e of t.roster?.entries || []) {
    learn(e.playerPoolEntry?.player);
    if (e.acquisitionType === "TRADE") tradedIn.push({ playerId: e.playerId, teamId: t.id, date: e.acquisitionDate });
  }
}

// Names for anyone still unknown (dropped players, etc.): the public player pool, then per-athlete lookup.
const referenced = new Set([...tx.values()].flatMap(t => (t.items || []).map(i => i.playerId)));
if ([...referenced].some(id => !players.has(id))) {
  const pool = await publicJson(
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/players?scoringPeriodId=0&view=players_wl`,
    { "x-fantasy-filter": JSON.stringify({ filterActive: { value: true } }) });
  for (const p of pool || []) learn(p);
}
for (const id of referenced) {
  if (players.has(id) || id <= 0) continue;
  const a = await publicJson(`https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${id}`);
  if (a?.athlete) players.set(id, { name: a.athlete.displayName, pos: a.athlete.position?.abbreviation || "", team: "" });
}
const pname = id => players.get(id)?.name || `Player ${id}`;
const ppos = id => players.get(id)?.pos || "";

function teamOf(t) {
  if (teamLabel.has(t.teamId)) return t.teamId;
  const add = (t.items || []).find(i => i.type === "ADD" && teamLabel.has(i.toTeamId));
  if (add) return add.toTeamId;
  const drop = (t.items || []).find(i => i.type === "DROP" && teamLabel.has(i.fromTeamId));
  return drop ? drop.fromTeamId : null;
}

const published = [...tx.values()]
  .filter(t => !PRIVATE_TYPES.has(t.type) && t.status !== "PENDING")
  .filter(t => t.type !== "TRADE_ACCEPT" || t.status === "EXECUTED")
  .map(t => ({
    ty: t.type, st: t.status || "EXECUTED", wk: t.scoringPeriodId, mgr: mgrOf(teamOf(t)), bid: t.bidAmount || 0,
    date: t.proposedDate,
    items: (t.items || []).filter(i => i.type !== "TRADE").map(i => ({
      t: i.type, p: pname(i.playerId), pos: ppos(i.playerId),
      from: i.type === "LINEUP" ? null : mgrOf(i.fromTeamId), to: i.type === "LINEUP" ? null : mgrOf(i.toTeamId),
      slot: i.type === "LINEUP" ? SLOT[i.toLineupSlotId] || "" : ""
    }))
  }))
  .sort((a, b) => a.wk - b.wk || a.date - b.date);

/* ---------------- trades ---------------- */

const etDate = ms => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const accepts = [...tx.values()].filter(t => t.type === "TRADE_ACCEPT" && t.status === "EXECUTED");
const byProposal = new Map();
for (const a of accepts) {
  const key = a.relatedTransactionId || a.id;
  if (!byProposal.has(key)) byProposal.set(key, []);
  byProposal.get(key).push(a);
}
const trades = [];
for (const [proposalId, acc] of byProposal) {
  const proposal = tx.get(proposalId);
  const date = Math.max(...acc.map(a => a.proposedDate));
  const when = Math.max(...acc.map(a => a.processDate || a.proposedDate));
  const partyIds = new Set([...acc.map(a => a.teamId), ...(proposal ? [proposal.teamId] : [])]);
  let moves = (proposal?.items || []).filter(i => i.type === "TRADE")
    .map(i => ({ playerId: i.playerId, to: i.toTeamId, from: i.fromTeamId }));
  if (!moves.length) {
    // Fallback: players now on a party's roster whose acquisition is this trade (within 10 minutes).
    moves = tradedIn.filter(x => Math.abs(x.date - when) < 10 * 60e3).map(x => ({ playerId: x.playerId, to: x.teamId }));
  }
  for (const m of moves) { partyIds.add(m.to); if (m.from != null) partyIds.add(m.from); }
  const parties = [...partyIds].map(mgrOf).filter(Boolean).sort();
  const receives = {};
  for (const m of moves) (receives[mgrOf(m.to)] ||= []).push(pname(m.playerId));
  const detail = parties.length === 2 && Object.keys(receives).length === 2;
  trades.push({ id: proposalId, wk: Math.max(...acc.map(a => a.scoringPeriodId)), date, detail,
    sides: detail ? receives : {}, parties });
}
trades.sort((a, b) => a.date - b.date);

// Player lists ESPN has since dropped: reuse what an earlier run captured.
const th = read("trades-history.json");
const earlier = th.trades.filter(t => t.year === SEASON);
for (const t of trades) {
  const prior = earlier.find(e => e.espnId === t.id);
  if (!t.detail && prior?.detail) Object.assign(t, { detail: true, parties: prior.parties, sides: prior.receives });
}

/* ---------------- build files ---------------- */

const now = new Date().toISOString();
const out = {};

// league-scores.json: replace this season's rows, keep everything else byte-for-byte in order.
const scores = read("league-scores.json");
const prevSeasonRows = scores.filter(r => r.year === SEASON);
// A week whose rows are unchanged keeps its existing order, so the diff shows only real changes.
const rowKey = r => JSON.stringify([r.week, r.manager1, r.score1, r.manager2, r.score2, r.playoffs]);
const seasonRows = doneWeeks.flatMap(w => {
  const fresh = scoreRows.filter(r => r.week === w), before = prevSeasonRows.filter(r => r.week === w);
  const same = fresh.length === before.length && before.every(b => fresh.some(f => rowKey(f) === rowKey(b)));
  return same ? before : fresh;
});
// Earlier seasons are copied through as text: the file was written by Python, so
// whole-number scores read "88.0", and re-serializing from JS would churn them.
const scoresText = fs.readFileSync(file("league-scores.json"), "utf8");
const blocks = scoresText.match(/^  \{\n[\s\S]*?^  \}/gm) || [];
if (blocks.length !== scores.length) fail("league-scores.json is not in the expected 2-space layout");
const keptBlocks = blocks.filter((b, i) => scores[i].year !== SEASON);
const pyNum = n => Number.isInteger(n) ? `${n}.0` : String(n);
const rowText = r => `  {\n    "year": ${r.year},\n    "week": ${r.week},\n    "manager1": ${JSON.stringify(r.manager1)},\n` +
  `    "score1": ${pyNum(r.score1)},\n    "manager2": ${JSON.stringify(r.manager2)},\n    "score2": ${pyNum(r.score2)},\n` +
  `    "playoffs": ${JSON.stringify(r.playoffs)}\n  }`;
out["league-scores.json"] = "[\n" + [...keptBlocks, ...seasonRows.map(rowText)].join(",\n") + "\n]\n";
if (JSON.stringify(JSON.parse(out["league-scores.json"])) !== JSON.stringify([...scores.filter(r => r.year !== SEASON), ...seasonRows])) {
  fail("league-scores.json round-trip mismatch");
}

// box scores
const boxSeason = { year: SEASON, inferredSlots: false, benchAvailable: true, weeks };
out[boxFile] = JSON.stringify(boxSeason);
const bIdx = read("boxscores-index.json");
const bEntry = { year: SEASON, matchups: doneWeeks.reduce((a, w) => a + weeks[w].length, 0), inferredSlots: false,
  benchAvailable: true, weeks: doneWeeks };
bIdx.seasons = [...bIdx.seasons.filter(s => s.year !== SEASON), bEntry].sort((a, b) => a.year - b.year);
bIdx.totalMatchups = bIdx.seasons.reduce((a, s) => a + s.matchups, 0);
bIdx.generated = now;
out["boxscores-index.json"] = JSON.stringify(bIdx);

// transactions
const faabByManager = {};
for (const t of published) if (t.ty === "WAIVER" && t.st === "EXECUTED" && t.bid > 0) {
  faabByManager[t.mgr] = (faabByManager[t.mgr] || 0) + t.bid;
}
const txSeason = { year: SEASON, transactions: published,
  trades: trades.map(({ id, ...t }) => t), faabByManager: Object.fromEntries(Object.entries(faabByManager).sort((a, b) => b[1] - a[1])) };
out[`transactions-${SEASON}.json`] = JSON.stringify(txSeason);

// transactions index: recomputed from every season file so totals can't drift.
const tIdx = read("transactions-index.json");
const seasonFiles = {};
for (const f of fs.readdirSync(root)) {
  const m = /^transactions-(\d{4})\.json$/.exec(f);
  if (m) seasonFiles[+m[1]] = +m[1] === SEASON ? txSeason : read(f);
}
const years = Object.keys(seasonFiles).map(Number).sort((a, b) => a - b);
const oldSeason = new Map(tIdx.seasons.map(s => [s.year, s]));
tIdx.seasons = years.map(y => {
  const d = seasonFiles[y], T = d.transactions;
  if (y !== SEASON && oldSeason.has(y)) return oldSeason.get(y); // historical: keep the verified summary
  return { year: y, total: T.length, executed: T.filter(t => t.st === "EXECUTED").length,
    waivers: T.filter(t => t.ty === "WAIVER").length, freeAgents: T.filter(t => t.ty === "FREEAGENT").length,
    trades: d.trades.length, tradesDetailed: d.trades.filter(t => t.detail).length,
    lineup: T.filter(t => t.ty === "ROSTER" || t.ty === "FUTURE_ROSTER").length,
    faab: Object.values(d.faabByManager).reduce((a, b) => a + b, 0) };
});
tIdx.counters[SEASON] = Object.fromEntries(league.teams.map(t => [mgrOf(t.id), {
  acquisitions: t.transactionCounter?.acquisitions ?? 0, drops: t.transactionCounter?.drops ?? 0,
  trades: t.transactionCounter?.trades ?? 0, budgetSpent: t.transactionCounter?.acquisitionBudgetSpent ?? 0 }]));
const bids = [], careers = {};
const car = m => (careers[m] ||= { adds: 0, drops: 0, trades: 0, faab: 0, claims: 0, lost: 0 });
for (const y of years) {
  for (const t of seasonFiles[y].transactions) {
    if (!t.mgr) continue;
    const c = car(t.mgr), ex = t.st === "EXECUTED";
    if (t.ty === "WAIVER" && ex) { c.faab += t.bid; c.claims++; if (t.bid > 0) {
      const add = t.items.find(i => i.t === "ADD");
      bids.push({ year: y, week: t.wk, mgr: t.mgr, bid: t.bid, player: add ? add.p : null, date: t.date });
    } }
    if (t.ty === "WAIVER" && t.st.startsWith("FAILED")) { c.claims++; c.lost++; }
    for (const i of t.items) {
      if (ex && i.t === "ADD") c.adds++;
      if (ex && i.t === "DROP" && (t.ty === "WAIVER" || t.ty === "FREEAGENT")) c.drops++;
    }
  }
}
for (const y of years) for (const t of seasonFiles[y].trades) for (const m of t.parties) if (m) car(m).trades++;
tIdx.careers = Object.fromEntries(Object.entries(careers).sort((a, b) => b[1].adds - a[1].adds));
tIdx.topBids = bids.sort((a, b) => b.bid - a.bid || a.year - b.year || a.week - b.week || a.date - b.date)
  .slice(0, 25).map(({ date, ...b }) => b);
tIdx.totals = { transactions: tIdx.seasons.reduce((a, s) => a + s.total, 0),
  faab: tIdx.seasons.reduce((a, s) => a + s.faab, 0), trades: tIdx.seasons.reduce((a, s) => a + s.trades, 0),
  topBid: tIdx.topBids[0] };
tIdx.generated = now;
out["transactions-index.json"] = JSON.stringify(tIdx);

// trades-history.json: this season's trades, keeping detail captured by an earlier run.
const merged = trades.map(t => {
  const prior = earlier.find(e => !e.espnId && e.date === etDate(t.date) && e.parties.join() === t.parties.join());
  if (!t.detail && prior?.detail) return prior; // an entry added by hand (e.g. from the ESPN email)
  return { year: SEASON, date: etDate(t.date), detail: t.detail, parties: t.parties,
    ...(t.detail ? { receives: t.sides } : {}), espnId: t.id };
});
const kept = earlier.filter(e => !merged.includes(e) && !trades.some(t => t.id === e.espnId) &&
  !merged.some(m => m.date === e.date && m.parties.join() === e.parties.join()));
if (kept.length) console.warn(`note: keeping ${kept.length} ${SEASON} trade(s) in trades-history.json that ESPN no longer lists`);
th.trades = [...th.trades.filter(t => t.year !== SEASON), ...kept, ...merged]
  .sort((a, b) => a.year - b.year || String(a.date).localeCompare(String(b.date)));
const espnCounter = Object.values(tIdx.counters[SEASON]).reduce((a, c) => a + c.trades, 0) / 2;
const thisYear = th.trades.filter(t => t.year === SEASON);
th.seasons = [...th.seasons.filter(s => s.year !== SEASON), { year: SEASON, trades: thisYear.length,
  detailed: thisYear.filter(t => t.detail).length, espnCounter, reconciles: thisYear.length === espnCounter }]
  .sort((a, b) => a.year - b.year);
const career = {};
for (const t of th.trades) for (const p of t.parties || []) career[p] = (career[p] || 0) + 1;
th.career = Object.fromEntries(Object.entries(career).sort((a, b) => b[1] - a[1]));
th.documented = th.trades.length;
th.withPlayers = th.trades.filter(t => t.detail).length;
th.totalPerCounters = th.seasons.reduce((a, s) => a + s.espnCounter, 0);
th.generated = now.slice(0, 10);
out["trades-history.json"] = JSON.stringify(th) + "\n";

/* ---------------- checks: all must pass before anything is written ---------------- */

const errors = [];
for (const w of doneWeeks) for (const m of weeks[w]) for (const s of [m.away, m.home]) {
  if (Math.abs(s.starterSum - s.points) > 0.011) {
    errors.push(`week ${w} ${s.manager}: starters sum to ${s.starterSum} but ESPN's total is ${s.points}`);
  }
}
const key = (w, a, b, sa, sb) => `${w}|${a}|${b}|${sa}|${sb}`;
const fromBox = new Set(doneWeeks.flatMap(w => weeks[w].map(m => key(w, m.away.manager, m.home.manager, m.away.points, m.home.points))));
const fromRows = new Set(scoreRows.map(r => key(r.week, r.manager1, r.manager2, r.score1, r.score2)));
if (fromBox.size !== fromRows.size || [...fromBox].some(k => !fromRows.has(k))) errors.push("box scores and league-scores rows disagree");
for (const w of doneWeeks) {
  const seen = weeks[w].flatMap(m => [m.away.manager, m.home.manager]);
  if (new Set(seen).size !== seen.length) errors.push(`week ${w}: a manager appears twice`);
  if (w <= regularPeriods && weeks[w].length !== league.teams.length / 2) errors.push(`week ${w}: expected ${league.teams.length / 2} matchups, got ${weeks[w].length}`);
}
// Never lose a completed week the site already has.
const prevWeeks = new Set(prevSeasonRows.map(r => r.week));
for (const w of prevWeeks) if (!weeks[w]) errors.push(`week ${w} is on the site but ESPN did not return it as final`);
if (published.some(t => PRIVATE_TYPES.has(t.ty) || t.st === "PENDING")) errors.push("a private transaction type slipped into the output");
if (published.some(t => !t.mgr)) errors.push(`${published.filter(t => !t.mgr).length} transaction(s) have no manager`);
for (const [name, text] of Object.entries(out)) {
  for (const mem of league.members) {
    const first = (mem.firstName || "").trim(), last = (mem.lastName || "").trim();
    if (first && last && text.includes(`${first} ${last}`)) errors.push(`${name} contains a manager's full name`);
  }
}

/* ---------------- report + write ---------------- */

const newRows = scoreRows.filter(r => !prevSeasonRows.some(p => p.week === r.week && p.manager1 === r.manager1 && p.score1 === r.score1 && p.score2 === r.score2));
const changedWeeks = [...new Set(newRows.map(r => r.week))];
console.log(`Season ${SEASON}: final weeks ${doneWeeks.join(", ") || "none"}; ` +
  `${published.length} public transactions (${tx.size} from ESPN); ${trades.length} completed trade(s).`);
if (changedWeeks.length) console.log(`New or corrected weeks: ${changedWeeks.join(", ")}`);
for (const t of trades) console.log(`Trade ${etDate(t.date)}: ${t.parties.join(" / ")}${t.detail ? "" : " (players not recovered)"}`);
if (errors.length) { console.error("Checks failed, nothing written:\n  " + errors.join("\n  ")); process.exit(1); }
if (DRY) { console.log("Dry run: checks passed, nothing written."); process.exit(0); }
// Skip files whose only change would be the "generated" stamp, so a run with no
// new ESPN activity produces no commit.
const unstamp = t => t.replace(/"generated":"[^"]*"/, '"generated":""');
const written = [];
for (const [name, text] of Object.entries(out)) {
  const before = exists(name) ? fs.readFileSync(file(name), "utf8") : null;
  if (before !== null && unstamp(before) === unstamp(text)) continue;
  fs.writeFileSync(file(name), text);
  written.push(name);
}
console.log(written.length ? `Checks passed; updated ${written.join(", ")}.` : "Checks passed; nothing changed.");
