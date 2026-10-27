/* LWFFL Median Score Analysis.
   Every regular-season week, each manager plays two "games" in the standings
   sense: the real head-to-head matchup, and a median matchup — a win for
   outscoring the league's median score that week. Pure functions over the
   rows in league-scores.json so the page and the tests share one definition. */

const LWFFLMedian = (() => {
  const isRegular = g => !g.playoffs || g.playoffs === "N/A";

  const median = values => {
    const s = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };

  const blank = manager => ({
    manager, weeks: 0,
    hw: 0, hl: 0, ht: 0,            // head-to-head record
    mw: 0, ml: 0, mt: 0,            // median record
    rankSum: 0,                     // sum of weekly score ranks (1 = highest)
    expected: 0,                    // expected H2H wins against an average schedule
    pf: 0, pa: 0,
    paVsAvg: 0                      // points against minus the season's average PA
  });

  /* One season's rows (regular season only), unsorted. */
  function season(games, year) {
    const rows = {};
    const get = m => rows[m] || (rows[m] = blank(m));
    const byWeek = {};

    games.filter(g => Number(g.year) === Number(year) && isRegular(g) && g.manager1 && g.manager2)
      .forEach(g => {
        (byWeek[g.week] = byWeek[g.week] || []).push(g);
      });

    Object.values(byWeek).forEach(matchups => {
      const scores = [];
      matchups.forEach(g => {
        scores.push({ m: g.manager1, pf: Number(g.score1), pa: Number(g.score2) });
        scores.push({ m: g.manager2, pf: Number(g.score2), pa: Number(g.score1) });
      });
      const n = scores.length;
      const med = median(scores.map(s => s.pf));

      scores.forEach(s => {
        const r = get(s.m);
        const higher = scores.filter(o => o.pf > s.pf).length;
        const equal = scores.filter(o => o !== s && o.pf === s.pf).length;
        const rank = 1 + higher + equal / 2;               // ties share the average rank

        r.weeks++;
        r.pf += s.pf;
        r.pa += s.pa;
        r.rankSum += rank;
        r.expected += (n - rank) / (n - 1);

        if (s.pf > s.pa) r.hw++; else if (s.pf < s.pa) r.hl++; else r.ht++;
        if (s.pf > med) r.mw++; else if (s.pf < med) r.ml++; else r.mt++;
      });
    });

    const list = Object.values(rows);
    const avgPa = list.reduce((a, r) => a + r.pa, 0) / (list.length || 1);
    list.forEach(r => { r.paVsAvg = r.pa - avgPa; });
    return list;
  }

  /* Fill the derived columns every table row shows. */
  function finish(r) {
    const h2hWins = r.hw + r.ht / 2;
    r.tw = r.hw + r.mw;
    r.tl = r.hl + r.ml;
    r.tt = r.ht + r.mt;
    r.totalWins = r.tw + r.tt / 2;
    r.avgFinish = r.weeks ? r.rankSum / r.weeks : null;
    r.luck = h2hWins - r.expected;
    return r;
  }

  const rankRows = rows => {
    rows.sort((a, b) => b.totalWins - a.totalWins || (b.hw + b.ht / 2) - (a.hw + a.ht / 2) || b.pf - a.pf);
    rows.forEach((r, i) => { r.rank = i + 1; });
    return rows;
  };

  function forSeason(games, year) {
    return rankRows(season(games, year).map(finish));
  }

  /* Every season combined. Expected wins, luck and PA-vs-average are sums of the
     per-season figures, so a 10-team 2014 and a 12-team 2026 each count on
     their own scale. Avg finish is the mean weekly rank across every week. */
  function allTime(games) {
    const years = [...new Set(games.filter(isRegular).map(g => Number(g.year)))].sort((a, b) => a - b);
    const total = {};
    years.forEach(y => {
      season(games, y).forEach(r => {
        const t = total[r.manager] || (total[r.manager] = Object.assign(blank(r.manager), { seasons: 0 }));
        t.seasons++;
        ["weeks", "hw", "hl", "ht", "mw", "ml", "mt", "rankSum", "expected", "pf", "pa", "paVsAvg"]
          .forEach(k => { t[k] += r[k]; });
      });
    });
    return rankRows(Object.values(total).map(finish));
  }

  const rec = (w, l, t) => (t ? `${w}-${l}-${t}` : `${w}-${l}`);
  const signed = (n, d) => {
    const v = Number(n.toFixed(d));
    return (v > 0 ? "+" : "") + v.toFixed(d);
  };

  return { forSeason, allTime, rec, signed, median };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LWFFLMedian;
