/*
 * Placebo test for the swap-back engine.
 *
 *   node scripts/placebo-test.mjs
 *
 * Swap-back sums positive across the league, which looks suspicious until you
 * ask whether the machinery would do that to ANY trade. This re-scores each
 * real trade with randomly chosen players from the same two rosters in the
 * same week, keeping the shape (who, when, how many players each way) and
 * throwing away the judgement.
 *
 * If the engine manufactured value, the random trades would come out positive
 * too. They do not — they centre on zero. The real trades' surplus is
 * managers choosing exchanges that convert positional surplus into need,
 * which is a genuine gain for both and the reason trades get agreed at all.
 *
 * Re-run this after touching bestLineup() or the counterfactual in
 * build-trade-value.mjs. A placebo mean that drifts well away from zero means
 * a bias has been introduced.
 */
import { bestLineup, replacement, slotTemplate, roster, scores, lastWeek } from './build-trade-value.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const real = JSON.parse(fs.readFileSync(path.join(root, 'trade-value.json'), 'utf8'));
let seed = 42;
const rnd = () => (seed = (seed*1103515245+12345) & 0x7fffffff) / 0x7fffffff;

function gainFor(year, week, m, received, givenAway) {
  const tmpl = slotTemplate[year]; let g = 0;
  for (let w = week; w <= lastWeek[year]; w++) {
    const have = (roster[year][w]||{})[m]; if (!have) continue;
    const rec = new Set(received.map(p=>p.id));
    const without = have.filter(p => !rec.has(p.id));
    const held = new Set(without.map(p=>p.id));
    for (const p of givenAway) {
      if (held.has(p.id)) continue;
      const seen = scores[year][w] && Object.prototype.hasOwnProperty.call(scores[year][w], p.id);
      without.push({ ...p, pts: seen ? scores[year][w][p.id] : ((replacement[year][w]||{})[p.pos] ?? 0) });
    }
    g += bestLineup(have, tmpl) - bestLineup(without, tmpl);
  }
  return g;
}

const sums = [];
for (const t of real.trades) {
  if (!t.benchEra) continue;
  const [A,B] = Object.keys(t.sides);
  const nA = t.sides[A].players.length, nB = t.sides[B].players.length;
  for (let rep=0; rep<30; rep++) {
    // pick random players actually on each roster the week of the trade
    const rosA = (roster[t.year][t.week]||{})[A] || [], rosB = (roster[t.year][t.week]||{})[B] || [];
    if (rosA.length < nA+1 || rosB.length < nB+1) continue;
    const pick = (arr,n) => { const c=arr.slice(); const o=[]; for(let i=0;i<n&&c.length;i++) o.push(c.splice(Math.floor(rnd()*c.length),1)[0]); return o; };
    // A receives players from B's roster, B receives from A's roster
    const toA = pick(rosB,nA), toB = pick(rosA,nB);
    sums.push(gainFor(t.year,t.week,A,toA,toB) + gainFor(t.year,t.week,B,toB,toA));
  }
}
sums.sort((a,b)=>a-b);
const mean = sums.reduce((a,b)=>a+b,0)/sums.length;
const med = sums[Math.floor(sums.length/2)];
console.log(`PLACEBO (${sums.length} random trades):`);
console.log(`  mean joint gain ${mean.toFixed(1)}   median ${med.toFixed(1)}`);
console.log(`  negative joint sums: ${sums.filter(x=>x<0).length} (${(sums.filter(x=>x<0).length/sums.length*100).toFixed(0)}%)`);

const realSums = real.trades.filter(t=>t.benchEra)
  .map(t=>Object.values(t.sides).reduce((a,s)=>a+s.swapBack,0)).sort((a,b)=>a-b);
const rMean = realSums.reduce((a,b)=>a+b,0)/realSums.length;
console.log(`\nREAL (${realSums.length} trades):`);
console.log(`  mean joint gain ${rMean.toFixed(1)}   median ${realSums[Math.floor(realSums.length/2)].toFixed(1)}`);
console.log(`  negative joint sums: ${realSums.filter(x=>x<0).length} (${(realSums.filter(x=>x<0).length/realSums.length*100).toFixed(0)}%)`);
