/* LWFFL v2 — shared data layer.
   Loads the league JSONs (one directory up) and computes the derived
   model every page renders from. Cached so multiple calls are free. */

const LWFFL = (() => {
  let cachePromise = null;

  const slugify = name =>
    String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  /* privacy-friendly display: "Cobey Culton" → "Cobey C." */
  const shortName = name => {
    const parts = String(name).trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    const first = parts[0] === "Tom" ? "Thomas" : parts[0];
    return `${first} ${parts[parts.length - 1][0]}.`;
  };

  const fmt = (n, d = 2) =>
    Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

  const fmtInt = n => Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

  const mlink = name => `<a class="mlink" href="managers.html?m=${slugify(name)}">${shortName(name)}</a>`;

  let activeByName = {};

  const alumPill = name => activeByName[name] === false
    ? ' <span class="pill" title="Former manager">Alum</span>'
    : "";

  const managerCell = name => `${mlink(name)}${alumPill(name)}`;

  const finishCell = finish => {
    if (finish == null) return "—";
    if (finish === 1) return `${finish} 🏆`;
    if (finish === 2) return `${finish} 🥈`;
    if (finish === 3) return `${finish} 🥉`;
    return finish;
  };

  /* tenure with gap detection: [2015..2022, 2024, 2025] → "2015–2022, 2024–present" */
  const tenureStr = (yearsArr, lastLeagueYear) => {
    const ys = [...new Set(yearsArr)].sort((a, b) => a - b);
    if (!ys.length) return "";
    const spans = [];
    let start = ys[0], prev = ys[0];
    for (let i = 1; i <= ys.length; i++) {
      if (ys[i] === prev + 1) { prev = ys[i]; continue; }
      spans.push([start, prev]);
      start = ys[i]; prev = ys[i];
    }
    return spans.map(([a, b], i) => {
      if (i === spans.length - 1 && b === lastLeagueYear) return `${a}–present`;
      return a === b ? `${a}` : `${a}–${b}`;
    }).join(", ");
  };
  const ylink = year => `<a class="ylink" href="seasons.html?y=${year}">${year}</a>`;

  function recordStr(w, l, t) {
    return t ? `${w}-${l}-${t}` : `${w}-${l}`;
  }

  function sparkline(values, w = 170, h = 44) {
    if (!values.length) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pad = 5;
    const step = (w - 2 * pad) / Math.max(values.length - 1, 1);
    const pts = values.map((v, i) => {
      const x = pad + i * step;
      const y = pad + ((v - min) / span) * (h - 2 * pad);
      return [x, y];
    });
    const poly = pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    const last = pts[pts.length - 1];
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
      <polyline points="${poly}"></polyline>
      <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3"></circle>
    </svg>`;
  }

  const isPlayoff = g => g.playoffs && g.playoffs !== "N/A";

  /* ELO ratings — ported from the classic site's manager cards.
     Week z-scores soften lucky/unlucky results, a floor adjustment
     discounts managers with a history of low floors, playoff matchups
     count double, and margin of victory scales the update. */
  function computeElo(games, managerNames) {
    const BASE = 1500, K_BASE = 40, G0 = 30, PLAYOFF_MULT = 2.0,
          ETA = 0.08, CAP = 0.15, LOOKBACK = 50, Q = 0.25,
          FLOOR_FACTOR = 70, Z_CLIP = -2.5;

    const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    const stdev = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) * (x - m)))); };
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const bottomQ = a => {
      if (!a || !a.length) return 0;
      const s = [...a].sort((x, y) => x - y);
      return mean(s.slice(0, Math.max(1, Math.floor(s.length * Q))));
    };

    const rating = {}, played = {}, history = {}, zHist = {}, seasonal = {}, leagueAvg = {};
    managerNames.forEach(m => { rating[m] = BASE; played[m] = 0; history[m] = [BASE]; zHist[m] = []; seasonal[m] = []; });

    const ordered = games.slice().sort((a, b) => a.year - b.year || a.week - b.week);

    const weekStats = {};
    ordered.forEach(g => {
      const k = `${g.year}::${g.week}`;
      (weekStats[k] = weekStats[k] || []).push(g.score1, g.score2);
    });
    Object.keys(weekStats).forEach(k => {
      const arr = weekStats[k];
      weekStats[k] = { mu: mean(arr), sd: stdev(arr) || 1 };
    });

    const snapshotYear = y => {
      const yr = [];
      managerNames.forEach(m => { seasonal[m].push({ year: y, elo: Math.round(rating[m]) }); yr.push(rating[m]); });
      leagueAvg[y] = mean(yr);
    };

    let currentYear = ordered.length ? ordered[0].year : null;
    ordered.forEach((g, i) => {
      if (g.year !== currentYear) { snapshotYear(currentYear); currentYear = g.year; }

      const A = g.manager1, B = g.manager2;
      if (!(A in rating) || !(B in rating)) return;
      const ws = weekStats[`${g.year}::${g.week}`] || { mu: 0, sd: 1 };
      const zA = (g.score1 - ws.mu) / ws.sd;
      const zB = (g.score2 - ws.mu) / ws.sd;
      const fA = clamp(bottomQ(zHist[A].slice(-LOOKBACK)), Z_CLIP, 0);
      const fB = clamp(bottomQ(zHist[B].slice(-LOOKBACK)), Z_CLIP, 0);
      const EA = 1 / (1 + Math.pow(10, ((rating[B] + FLOOR_FACTOR * fB) - (rating[A] + FLOOR_FACTOR * fA)) / 400));

      let SA = g.score1 > g.score2 ? 1 : g.score1 < g.score2 ? 0 : 0.5;
      SA = clamp(SA + clamp(ETA * (zA - zB), -CAP, CAP), 0, 1);

      const Mv = clamp(Math.log(Math.abs(g.score1 - g.score2) + 1), 0.2, 2.2);
      const P = isPlayoff(g) ? PLAYOFF_MULT : 1;
      const K = (K_BASE * (G0 / (G0 + played[A])) + K_BASE * (G0 / (G0 + played[B]))) / 2;
      const delta = K * P * Mv * (SA - EA);

      rating[A] += delta;
      rating[B] -= delta;
      played[A]++; played[B]++;
      history[A].push(rating[A]); history[B].push(rating[B]);
      zHist[A].push(zA); zHist[B].push(zB);

      if (i === ordered.length - 1) snapshotYear(g.year);
    });

    const ratings = {};
    managerNames.forEach(m => {
      const h = history[m];
      ratings[m] = {
        elo: Math.round(h[h.length - 1]),
        peak: Math.round(Math.max(...h)),
        floor: Math.round(Math.min(...h))
      };
    });
    return { seasonal, leagueAvg, ratings };
  }

  async function load() {
    if (cachePromise) return cachePromise;
    cachePromise = (async () => {
      const [standings, games, seeds] = await Promise.all([
        fetch("final-standings.json").then(r => r.json()),
        fetch("league-scores.json").then(r => r.json()),
        fetch("playoff-seeds.json").then(r => r.json())
      ]);
      games.forEach(g => {
        g.year = Number(g.year);
        g.week = Number(g.week);
        g.score1 = Number(g.score1);
        g.score2 = Number(g.score2);
      });
      return build(standings, games, seeds);
    })();
    return cachePromise;
  }

  function build(standings, games, seeds) {
    const years = [...new Set(standings.map(r => r.year))].sort((a, b) => a - b);

    const seedMap = {};
    seeds.forEach(s => { seedMap[`${s.manager}_${s.year}`] = s.seed; });

    /* ----- Season summaries ----- */
    const seasonSummaries = years.map(y => {
      const rows = standings
        .filter(r => r.year === y)
        .sort((a, b) => (a.final_standing ?? 99) - (b.final_standing ?? 99));
      const champ = rows[0];
      const runnerUp = rows[1];
      const last = rows[rows.length - 1];
      const scoring = rows.slice().sort((a, b) => (b.points_for ?? 0) - (a.points_for ?? 0))[0];
      const champGame = games.find(g => g.year === y && g.playoffs === "Championship") || null;
      let champScore = null;
      if (champGame) {
        champScore = champGame.manager1 === champ.manager
          ? { winner: champGame.score1, loser: champGame.score2 }
          : { winner: champGame.score2, loser: champGame.score1 };
      }
      return { year: y, rows, champ, runnerUp, last, scoring, champGame, champScore };
    });

    /* ----- Flattened per-manager game performances ----- */
    const perfs = [];
    games.forEach(g => {
      if (!g.manager1 || !g.manager2) return;
      perfs.push({ year: g.year, week: g.week, playoffs: g.playoffs, manager: g.manager1, opp: g.manager2, pf: g.score1, pa: g.score2 });
      perfs.push({ year: g.year, week: g.week, playoffs: g.playoffs, manager: g.manager2, opp: g.manager1, pf: g.score2, pa: g.score1 });
    });
    perfs.sort((a, b) => a.year - b.year || a.week - b.week);

    /* ----- Managers + careers ----- */
    const managers = {};
    standings.forEach(r => {
      const slug = slugify(r.manager);
      if (!managers[slug]) managers[slug] = { name: r.manager, slug, seasons: [] };
      managers[slug].seasons.push(r);
    });

    Object.values(managers).forEach(m => {
      m.seasons.sort((a, b) => a.year - b.year);
      const ss = m.seasons;
      /* career counting stats come from every matchup played — playoffs included */
      const my = perfs.filter(p => p.manager === m.name);
      const c = {
        seasons: ss.length,
        wins: my.filter(p => p.pf > p.pa).length,
        losses: my.filter(p => p.pf < p.pa).length,
        ties: my.filter(p => p.pf === p.pa).length,
        pf: my.reduce((a, p) => a + p.pf, 0),
        pa: my.reduce((a, p) => a + p.pa, 0),
        titles: ss.filter(r => r.final_standing === 1).map(r => r.year),
        runnerUps: ss.filter(r => r.final_standing === 2).map(r => r.year),
        thirdPlaces: ss.filter(r => r.final_standing === 3).map(r => r.year),
        bestFinish: Math.min(...ss.map(r => r.final_standing ?? 99)),
        firstYear: ss[0].year,
        lastYear: ss[ss.length - 1].year,
        years: ss.map(r => r.year)
      };
      c.games = my.length;
      c.winPct = c.games ? (c.wins + c.ties * 0.5) / c.games : 0;
      c.scoringTitles = seasonSummaries.filter(s => s.scoring.manager === m.name).map(s => s.year);
      c.playoffApps = new Set(
        perfs.filter(p => p.manager === m.name && isPlayoff(p)).map(p => p.year)
      ).size;
      c.active = c.lastYear === years[years.length - 1];
      m.career = c;
    });
    activeByName = Object.fromEntries(Object.values(managers).map(m => [m.name, m.career.active]));

    /* ----- Head-to-head matrix ----- */
    const h2h = {};
    perfs.forEach(p => {
      if (!h2h[p.manager]) h2h[p.manager] = {};
      if (!h2h[p.manager][p.opp]) h2h[p.manager][p.opp] = { w: 0, l: 0, t: 0, pf: 0, pa: 0, games: [] };
      const rec = h2h[p.manager][p.opp];
      if (p.pf > p.pa) rec.w++;
      else if (p.pf < p.pa) rec.l++;
      else rec.t++;
      rec.pf += p.pf;
      rec.pa += p.pa;
      rec.games.push(p);
    });

    /* PF/PA ranks within each season (1 = most) — feeds the Luck Index */
    const seasonRanks = {};
    years.forEach(y => {
      const rows = standings.filter(r => r.year === y);
      rows.slice().sort((a, b) => b.points_for - a.points_for)
        .forEach((r, i) => { seasonRanks[`${r.manager}_${y}`] = { pfRank: i + 1 }; });
      rows.slice().sort((a, b) => b.points_against - a.points_against)
        .forEach((r, i) => { seasonRanks[`${r.manager}_${y}`].paRank = i + 1; });
    });

    const elo = computeElo(games, Object.values(managers).map(m => m.name));

    /* ELO rank among managers with 3+ seasons (matches the classic site's eligibility rule) */
    const eligible = Object.values(managers).filter(m => m.career.seasons >= 3);
    eligible
      .sort((a, b) => elo.ratings[b.name].elo - elo.ratings[a.name].elo)
      .forEach((m, i) => { elo.ratings[m.name].rank = i + 1; });
    elo.rankedCount = eligible.length;

    return { years, managers, seasonSummaries, games, perfs, h2h, seedMap, standings, seasonRanks, elo };
  }

  return { load, slugify, shortName, tenureStr, fmt, fmtInt, mlink, alumPill, managerCell, finishCell, ylink, recordStr, sparkline, isPlayoff };
})();
