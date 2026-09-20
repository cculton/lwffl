import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, "assets/notebook.js"), "utf8"), context);
const project = context.notebookDivisionStandings;
const divisions = JSON.parse(fs.readFileSync(path.join(root, "data/notebook-divisions.json")))["2026"];
const games = JSON.parse(fs.readFileSync(path.join(root, "league-scores.json")))
  .filter(game => game.year === 2026);
const perfs = games.flatMap(game => [
  { year: game.year, week: game.week, playoffs: game.playoffs,
    manager: game.manager1, opp: game.manager2, pf: game.score1, pa: game.score2 },
  { year: game.year, week: game.week, playoffs: game.playoffs,
    manager: game.manager2, opp: game.manager1, pf: game.score2, pa: game.score1 }
]);

const roster = divisions.flatMap(division => division.managers);
assert.equal(divisions.length, 3);
assert.equal(new Set(roster).size, 12);
assert.deepEqual(new Set(perfs.map(perf => perf.manager)), new Set(roster));

const weekOne = project(perfs, divisions, 2026, 1);
assert.equal(weekOne.through, 1);
assert.deepEqual(Array.from(weekOne.groups, group => group.rows.length), [4, 4, 4]);
assert.equal(weekOne.seeds.size, 6);
const withFutureGame = project([...perfs,
  { year: 2026, week: 2, playoffs: "N/A", manager: "Adam", opp: "Bryce", pf: 200, pa: 50 }
], divisions, 2026, 1);
assert.deepEqual([...withFutureGame.seeds], [...weekOne.seeds]);

const smallDivisions = [
  { name: "A", managers: ["A1", "A2"] },
  { name: "B", managers: ["B1", "B2"] },
  { name: "C", managers: ["C1", "C2"] }
];
const records = {
  A1: [[50, 40], [50, 40]], A2: [[20, 10], [20, 30]],
  B1: [[45, 40], [45, 40]], B2: [[100, 90], [50, 60]],
  C1: [[40, 30], [40, 30]], C2: [[100, 110], [100, 110]]
};
const synthetic = Object.entries(records).flatMap(([manager, scores]) =>
  scores.map(([pf, pa], index) => ({ year: 2026, week: index + 1,
    playoffs: "N/A", manager, opp: "Other", pf, pa })));
const seeds = project(synthetic, smallDivisions, 2026, 2).seeds;
assert.deepEqual(Array.from(seeds, ([name, seed]) => [name, seed]).sort((a, b) => a[1] - b[1]), [
  ["A1", 1], ["B1", 2], ["C1", 3],
  ["B2", 4], ["C2", 5], ["A2", 6]
]);

for (const slug of ["2026-w1-recap", "2026-w2-preview"]) {
  const html = fs.readFileSync(path.join(root, "n", `${slug}.html`), "utf8");
  assert.match(html, /data-standings-week="1"/);
}
console.log("Notebook division standings and playoff projection passed");
