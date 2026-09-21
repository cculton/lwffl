/* LWFFL normalized lineup slots and weekly position-edge analytics. */

const LWFFLLineupEdge = (() => {
  const PRE_2025_SLOTS = ["QB", "RB", "WR", "TE", "FLEX", "D/ST", "K"];
  const MODERN_SLOTS = ["QB", "RB", "WR", "FLEX", "WR/TE", "D/ST", "K"];
  const BASE_SLOTS = new Set(["QB", "RB", "WR", "TE", "D/ST", "K"]);

  const points = player => Number(player?.points ?? player?.pts ?? 0);
  const position = player => BASE_SLOTS.has(player?.slot)
    ? player.slot
    : player?.position || player?.pos || null;
  const byScore = (a, b) => points(b) - points(a) || String(a.name || "").localeCompare(String(b.name || ""));

  function normalizeLineup(starters = [], year) {
    const remaining = starters.slice();
    const assigned = {};

    function take(label, eligible, count = 1) {
      const choices = remaining
        .map((player, index) => ({ player, index }))
        .filter(({ player }) => eligible.includes(position(player)))
        .sort((a, b) => byScore(a.player, b.player))
        .slice(0, count);
      assigned[label] = choices.map(choice => choice.player);
      choices.map(choice => choice.index).sort((a, b) => b - a).forEach(index => remaining.splice(index, 1));
    }

    take("QB", ["QB"]);
    take("RB", ["RB"], 2);
    take("WR", ["WR"], 2);

    if (Number(year) < 2025) {
      take("TE", ["TE"]);
      take("FLEX", ["RB", "WR", "TE"]);
    } else {
      const flexChoices = remaining
        .map((player, index) => ({ player, index }))
        .filter(({ player }) => ["RB", "WR", "TE"].includes(position(player)));
      const choicesPreservingWrTe = flexChoices.filter(choice =>
        remaining.some((player, index) => index !== choice.index && ["WR", "TE"].includes(position(player))));
      const choice = (choicesPreservingWrTe.length ? choicesPreservingWrTe : flexChoices)
        .sort((a, b) => byScore(a.player, b.player))[0];
      assigned.FLEX = choice ? [choice.player] : [];
      if (choice) remaining.splice(choice.index, 1);
      take("WR/TE", ["WR", "TE"]);
    }

    take("D/ST", ["D/ST"]);
    take("K", ["K"]);

    const slots = Number(year) < 2025 ? PRE_2025_SLOTS : MODERN_SLOTS;
    return Object.fromEntries(slots.map(slot => [slot,
      Number((assigned[slot] || []).reduce((sum, player) => sum + points(player), 0).toFixed(2))]));
  }

  function performancesFromSeasons(seasons) {
    const performances = [];
    for (const season of seasons.filter(Boolean)) {
      const year = Number(season.year);
      for (const [weekValue, matchups] of Object.entries(season.weeks || {})) {
        const week = Number(weekValue);
        for (const matchup of matchups || []) {
          for (const side of [matchup.home, matchup.away]) {
            if (!side?.manager) continue;
            performances.push({
              year,
              week,
              manager: side.manager,
              playoffs: matchup.playoffs || matchup.round || "N/A",
              isPlayoff: Boolean((matchup.playoffs && matchup.playoffs !== "N/A") || (matchup.round && matchup.round !== "N/A")),
              slots: normalizeLineup(side.starters || [], year)
            });
          }
        }
      }
    }

    const weekly = new Map();
    for (const performance of performances) {
      const key = `${performance.year}:${performance.week}`;
      const group = weekly.get(key) || [];
      group.push(performance);
      weekly.set(key, group);
    }

    for (const group of weekly.values()) {
      const slotNames = [...new Set(group.flatMap(performance => Object.keys(performance.slots)))];
      const averages = Object.fromEntries(slotNames.map(slot => [slot,
        group.reduce((sum, performance) => sum + Number(performance.slots[slot] || 0), 0) / group.length]));
      for (const performance of group) {
        performance.averages = averages;
        performance.edges = Object.fromEntries(slotNames.map(slot => [slot,
          Number((Number(performance.slots[slot] || 0) - averages[slot]).toFixed(4))]));
        performance.totalEdge = Number(Object.values(performance.edges).reduce((sum, edge) => sum + edge, 0).toFixed(4));
      }
    }
    return performances;
  }

  function aggregate(performances) {
    const groups = new Map();
    for (const performance of performances) {
      const group = groups.get(performance.manager) || { manager: performance.manager, games: 0, totalEdge: 0, slots: {}, slotGames: {} };
      group.games++;
      group.totalEdge += performance.totalEdge;
      for (const [slot, value] of Object.entries(performance.edges)) {
        group.slots[slot] = (group.slots[slot] || 0) + value;
        group.slotGames[slot] = (group.slotGames[slot] || 0) + 1;
      }
      groups.set(performance.manager, group);
    }
    return [...groups.values()].map(group => ({
      ...group,
      totalEdgePerWeek: group.games ? group.totalEdge / group.games : 0,
      slotEdgePerWeek: Object.fromEntries(Object.entries(group.slots).map(([slot, value]) => [slot, value / group.slotGames[slot]]))
    }));
  }

  async function load(years = null) {
    const index = await fetch("boxscores-index.json").then(response => {
      if (!response.ok) throw new Error("Could not load box-score index");
      return response.json();
    });
    const requested = new Set((years || []).map(Number));
    const availableYears = (index.seasons || [])
      .map(season => Number(season.year))
      .filter(year => !requested.size || requested.has(year));
    const available = await Promise.all(availableYears.map(year =>
      fetch(`boxscores-${year}.json`).then(response => {
        if (!response.ok) throw new Error(`Could not load ${year} box scores`);
        return response.json();
      })));
    return {
      years: available.map(season => Number(season.year)).sort((a, b) => a - b),
      performances: performancesFromSeasons(available)
    };
  }

  return { PRE_2025_SLOTS, MODERN_SLOTS, normalizeLineup, performancesFromSeasons, aggregate, load };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LWFFLLineupEdge;
