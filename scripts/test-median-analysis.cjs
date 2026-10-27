const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const median = require("../assets/median-analysis.js");

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

/* ---- Hand-checked four-team, two-week season ---- */
const g = (week, m1, s1, m2, s2, playoffs = "N/A") => ({ year: 2030, week, manager1: m1, score1: s1, manager2: m2, score2: s2, playoffs });
const tiny = [
  g(1, "A", 100, "B", 90), g(1, "C", 80, "D", 120),
  g(2, "A", 70, "C", 75), g(2, "B", 110, "D", 60),
  g(3, "A", 999, "B", 1, "Championship")           // playoffs must be ignored
];
const rows = median.forSeason(tiny, 2030);
const by = Object.fromEntries(rows.map(r => [r.manager, r]));

/* Week 1 scores: D120 A100 B90 C80 → median 95; week 2: B110 C75 A70 D60 → median 72.5 */
assert.equal(median.rec(by.A.hw, by.A.hl, by.A.ht), "1-1");
assert.equal(median.rec(by.A.mw, by.A.ml, by.A.mt), "1-1");
assert.equal(by.A.tw, 2);
close(by.A.avgFinish, (2 + 3) / 2, "A avg finish");
close(by.A.expected, (2 / 3) + (1 / 3), "A expected wins");     // (4-2)/3 + (4-3)/3
close(by.A.luck, 1 - 1, "A luck");
assert.equal(by.D.mw, 1);                                         // beat the median once
close(by.D.paVsAvg, (80 + 110) - 705 / 4, "D points against vs league average");
close(rows.reduce((a, r) => a + r.paVsAvg, 0), 0, "PA vs avg sums to zero");
close(rows.reduce((a, r) => a + r.luck, 0), 0, "luck sums to zero");
assert.equal(by.A.weeks, 2);                                       // the playoff row was excluded

/* ---- Ties: equal scores share rank and count as median ties ---- */
const tie = median.forSeason([g(1, "A", 100, "B", 100), g(1, "C", 50, "D", 150)], 2030);
const tb = Object.fromEntries(tie.map(r => [r.manager, r]));
assert.equal(tb.A.ht, 1);
close(tb.A.avgFinish, 2.5, "tied teams share the average rank");
assert.equal(tb.A.mt, 1);                                          // score equals the 100.0 median → a median tie
assert.equal(tb.A.mw, 0);

/* ---- Real data: identities that must hold for every season and all-time ---- */
const scores = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "league-scores.json"), "utf8"));
const years = [...new Set(scores.map(r => Number(r.year)))].sort();
for (const y of years) {
  const table = median.forSeason(scores, y);
  const weeks = table[0].weeks;
  const n = table.length;
  close(table.reduce((a, r) => a + r.luck, 0), 0, `${y} luck sums to zero`);
  close(table.reduce((a, r) => a + r.paVsAvg, 0), 0, `${y} PA vs avg sums to zero`);
  close(table.reduce((a, r) => a + r.hw + r.ht / 2, 0), table.reduce((a, r) => a + r.hl + r.ht / 2, 0), `${y} H2H wins equal losses`);
  close(table.reduce((a, r) => a + r.mw + r.mt / 2, 0), table.reduce((a, r) => a + r.ml + r.mt / 2, 0), `${y} median wins equal losses`);
  table.forEach(r => {
    assert.equal(r.tw + r.tl + r.tt, 2 * r.weeks, `${y} ${r.manager} plays two results a week`);
    assert.equal(r.weeks, weeks, `${y} every team has the same number of weeks`);
  });
  /* the average of everyone's average finish is the middle of the field */
  close(table.reduce((a, r) => a + r.avgFinish, 0) / n, (n + 1) / 2, `${y} avg finish centers on (n+1)/2`);
  table.forEach((r, i) => assert.equal(r.rank, i + 1));
}
const all = median.allTime(scores);
close(all.reduce((a, r) => a + r.luck, 0), 0, "all-time luck sums to zero");
close(all.reduce((a, r) => a + r.paVsAvg, 0), 0, "all-time PA vs avg sums to zero");

assert.equal(median.signed(1.176, 2), "+1.18");
assert.equal(median.signed(-48.84, 1), "-48.8");
assert.equal(median.signed(0, 2), "0.00");

console.log(`median analysis: ${years.length} seasons + all-time passed`);
