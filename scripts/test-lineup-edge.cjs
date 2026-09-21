const assert = require("node:assert/strict");
const edge = require("../assets/lineup-edge.js");

const player = (name, position, points) => ({ name, position, points });
const repoPlayer = (name, pos, pts) => ({ name, pos, pts });

const legacy = edge.normalizeLineup([
  player("QB", "QB", 20), player("RB1", "RB", 18), player("RB2", "RB", 12),
  player("WR1", "WR", 30), player("WR2", "WR", 20), player("WR3", "WR", 10),
  player("TE", "TE", 8), player("DST", "D/ST", 5), player("K", "K", 4)
], 2024);
assert.deepEqual(legacy, { QB: 20, RB: 30, WR: 50, TE: 8, FLEX: 10, "D/ST": 5, K: 4 });

const modern = edge.normalizeLineup([
  player("QB", "QB", 20), player("RB1", "RB", 18), player("RB2", "RB", 12),
  player("WR1", "WR", 40), player("WR2", "WR", 30), player("WR3", "WR", 20), player("WR4", "WR", 10),
  player("DST", "D/ST", 5), player("K", "K", 4)
], 2025);
assert.deepEqual(modern, { QB: 20, RB: 30, WR: 70, FLEX: 20, "WR/TE": 10, "D/ST": 5, K: 4 });

const flexFirst = edge.normalizeLineup([
  player("QB", "QB", 20), player("RB1", "RB", 18), player("RB2", "RB", 12),
  player("WR1", "WR", 30), player("WR2", "WR", 20), player("WR3", "WR", 9), player("TE", "TE", 15),
  player("DST", "D/ST", 5), player("K", "K", 4)
], 2025);
assert.equal(flexFirst.FLEX, 15);
assert.equal(flexFirst["WR/TE"], 9);

const preserveWrTe = edge.normalizeLineup([
  player("QB", "QB", 20), player("RB1", "RB", 18), player("RB2", "RB", 12), player("RB3", "RB", 4),
  player("WR1", "WR", 30), player("WR2", "WR", 20), player("WR3", "WR", 10),
  player("DST", "D/ST", 5), player("K", "K", 4)
], 2025);
assert.equal(preserveWrTe.FLEX, 4);
assert.equal(preserveWrTe["WR/TE"], 10);

const repositorySchema = edge.normalizeLineup([
  repoPlayer("QB", "QB", 20), repoPlayer("RB1", "RB", 18), repoPlayer("RB2", "RB", 12),
  repoPlayer("WR1", "WR", 30), repoPlayer("WR2", "WR", 20), repoPlayer("WR3", "WR", 10),
  repoPlayer("TE", "TE", 8), repoPlayer("DST", "D/ST", 5), repoPlayer("K", "K", 4)
], 2024);
assert.deepEqual(repositorySchema, { QB: 20, RB: 30, WR: 50, TE: 8, FLEX: 10, "D/ST": 5, K: 4 });

const dualEligibility = edge.normalizeLineup([
  { ...repoPlayer("QB", "QB", 20), slot: "QB" },
  { ...repoPlayer("Ty Montgomery", "WR", 9.7), slot: "RB" },
  { ...repoPlayer("RB2", "RB", 12), slot: "RB" },
  { ...repoPlayer("WR1", "WR", 30), slot: "WR" },
  { ...repoPlayer("WR2", "WR", 20), slot: "WR" },
  { ...repoPlayer("WR3", "WR", 10), slot: "FLEX" },
  { ...repoPlayer("Taysom Hill", "QB", 8), slot: "TE" },
  { ...repoPlayer("DST", "D/ST", 5), slot: "D/ST" },
  { ...repoPlayer("K", "K", 4), slot: "K" }
], 2020);
assert.deepEqual(dualEligibility, { QB: 20, RB: 21.7, WR: 50, TE: 8, FLEX: 10, "D/ST": 5, K: 4 });

const perfs = edge.performancesFromSeasons([{ year: 2025, weeks: { 1: [{
  home: { manager: "A", starters: [player("QB", "QB", 20)] },
  away: { manager: "B", starters: [player("QB", "QB", 10)] }
}] } }]);
assert.equal(perfs.find(row => row.manager === "A").edges.QB, 5);
assert.equal(perfs.find(row => row.manager === "B").edges.QB, -5);
for (const slot of edge.MODERN_SLOTS) {
  const sum = perfs.reduce((total, row) => total + row.edges[slot], 0);
  assert.ok(Math.abs(sum) < 1e-9, `${slot} edges should sum to zero`);
}

console.log("lineup-edge tests passed");
