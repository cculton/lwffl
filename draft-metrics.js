/**
 * Draft value analytics helpers for LWFFL draft history data.
 *
 * Why multiple metrics?
 * - Simple rank deltas/ratios are intuitive, but raw ratios can be skewed by long bust tails.
 * - Log-ratios are symmetric, but can still feel structurally downside-heavy in fantasy outcomes.
 * - Percentile metrics are bounded and more comparable across positions/years.
 * - Capped rank metrics reduce outlier domination from catastrophic misses.
 *
 * Source rows are NEVER mutated. All derived values are returned in new enriched objects.
 */

/** @typedef {'QB'|'RB'|'WR'|'TE'|'K'|'DST'} NormalizedPosition */

/** @type {Record<NormalizedPosition, number|null>} */
export const DEFAULT_POSITION_CAPS = {
  QB: 24,
  RB: 60,
  WR: 60,
  TE: 30,
  K: null,
  DST: null
};

const MANAGER_FIELD_CANDIDATES = ['manager', 'owner', 'teamOwner', 'team_owner', 'gm'];
const FINISH_RANK_FIELD_CANDIDATES = ['positionrank', 'position rank', 'positionRank'];
const PLAYER_FIELD_CANDIDATES = ['player', 'name'];
const PRICE_FIELD_CANDIDATES = ['price', 'auctionPrice', 'auction_price', 'cost'];

/**
 * @typedef {Object} MetricConfig
 * @property {Record<NormalizedPosition, number|null>} [positionCaps]
 * @property {'draftCount'|'cap'} [finishPoolStrategy] - denominator basis for finish percentile.
 */

/** @returns {MetricConfig} */
export function defaultMetricConfig() {
  return {
    positionCaps: DEFAULT_POSITION_CAPS,
    finishPoolStrategy: 'draftCount'
  };
}

function isNilOrBlank(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

function toFiniteNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function firstPresentValue(obj, candidates) {
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  }
  return undefined;
}

/**** Normalization ****/

/**
 * @param {unknown} position
 * @returns {NormalizedPosition}
 */
export function normalizePosition(position) {
  const raw = String(position ?? '').trim().toUpperCase();
  if (raw === 'D/ST' || raw === 'DST' || raw === 'DEF' || raw === 'D') return 'DST';
  if (raw === 'K' || raw === 'PK') return 'K';
  if (raw === 'QB' || raw === 'RB' || raw === 'WR' || raw === 'TE') return raw;
  return /** @type {NormalizedPosition} */ ('DST');
}

/**
 * @param {Record<string, any>} row
 * @returns {number|null}
 */
export function parseFinishRank(row) {
  const raw = firstPresentValue(row, FINISH_RANK_FIELD_CANDIDATES);
  const parsed = toFiniteNumber(raw);
  if (parsed == null || parsed <= 0) return null;
  return Math.floor(parsed);
}

/**
 * @param {Record<string, any>} row
 * @returns {string}
 */
export function detectManagerValue(row) {
  const raw = firstPresentValue(row, MANAGER_FIELD_CANDIDATES);
  return isNilOrBlank(raw) ? 'Unknown Manager' : String(raw).trim();
}

/**
 * @param {Record<string, any>} row
 * @returns {string}
 */
export function detectPlayerValue(row) {
  const raw = firstPresentValue(row, PLAYER_FIELD_CANDIDATES);
  return isNilOrBlank(raw) ? 'Unknown Player' : String(raw).trim();
}

/**
 * @param {Record<string, any>} row
 * @returns {number|null}
 */
export function parseAuctionPrice(row) {
  const raw = firstPresentValue(row, PRICE_FIELD_CANDIDATES);
  const parsed = toFiniteNumber(raw);
  return parsed != null && parsed >= 0 ? parsed : null;
}

/**
 * Convert source entries into a stable analysis-ready shape (without mutating source objects).
 * @param {Record<string, any>[]} sourceEntries
 */
export function normalizeEntries(sourceEntries) {
  return sourceEntries.map((row, sourceIndex) => {
    const normalizedPosition = normalizePosition(row.position);
    const overall = toFiniteNumber(row.overall);
    const year = toFiniteNumber(row.year);

    return {
      ...row,
      __sourceIndex: sourceIndex,
      __analysisYear: year != null ? Math.floor(year) : null,
      __analysisOverall: overall,
      normalizedPosition,
      isDefenseOrKicker: normalizedPosition === 'DST' || normalizedPosition === 'K',
      managerValue: detectManagerValue(row),
      playerValue: detectPlayerValue(row),
      finishRank: parseFinishRank(row),
      auctionPrice: parseAuctionPrice(row)
    };
  });
}

function percentileFromRank(rank, poolSize) {
  if (rank == null || poolSize == null || poolSize <= 0) return null;
  if (poolSize === 1) return 1;
  return (poolSize - rank) / (poolSize - 1);
}

function withPositionDraftOrder(normalizedRows) {
  /** @type {Map<string, any[]>} */
  const byYearPos = new Map();

  for (const row of normalizedRows) {
    const key = `${row.__analysisYear ?? 'unknown'}__${row.normalizedPosition}`;
    if (!byYearPos.has(key)) byYearPos.set(key, []);
    byYearPos.get(key).push(row);
  }

  /** @type {Map<number, {posDraftOrder:number,posDraftCount:number}>} */
  const indexMeta = new Map();

  for (const rows of byYearPos.values()) {
    rows.sort((a, b) => {
      const ao = a.__analysisOverall;
      const bo = b.__analysisOverall;
      if (ao == null && bo == null) return a.__sourceIndex - b.__sourceIndex;
      if (ao == null) return 1;
      if (bo == null) return -1;
      if (ao !== bo) return ao - bo;
      return a.__sourceIndex - b.__sourceIndex;
    });

    const count = rows.length;
    rows.forEach((row, idx) => {
      indexMeta.set(row.__sourceIndex, { posDraftOrder: idx + 1, posDraftCount: count });
    });
  }

  return indexMeta;
}

function withPositionPriceOrder(normalizedRows) {
  /** @type {Map<string, any[]>} */
  const byYearPos = new Map();

  for (const row of normalizedRows) {
    const key = `${row.__analysisYear ?? 'unknown'}__${row.normalizedPosition}`;
    if (!byYearPos.has(key)) byYearPos.set(key, []);
    if (row.auctionPrice != null) byYearPos.get(key).push(row);
  }

  /** @type {Map<number, {posPriceOrder:number,posPriceCount:number}>} */
  const indexMeta = new Map();

  for (const rows of byYearPos.values()) {
    rows.sort((a, b) => {
      if (a.auctionPrice !== b.auctionPrice) return b.auctionPrice - a.auctionPrice;
      return a.__sourceIndex - b.__sourceIndex;
    });

    const count = rows.length;
    rows.forEach((row, idx) => {
      indexMeta.set(row.__sourceIndex, { posPriceOrder: idx + 1, posPriceCount: count });
    });
  }

  return indexMeta;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Optional display helper for front-ends/tooltips.
 */
export function getMetricTooltips() {
  return {
    valueRatio: 'Value Ratio = positional draft order ÷ end-of-year positional finish (higher is better).',
    percentileDelta: 'Percentile Delta = finish percentile - draft percentile; positive means better-than-cost outcomes.'
  };
}

/**
 * Primary enrichment pipeline.
 * Returns new objects with required derived fields and keeps source fields untouched.
 *
 * @param {Record<string, any>[]} sourceEntries
 * @param {MetricConfig} [config]
 */
export function enrichDraftEntries(sourceEntries, config = defaultMetricConfig()) {
  const cfg = { ...defaultMetricConfig(), ...config, positionCaps: { ...DEFAULT_POSITION_CAPS, ...(config.positionCaps || {}) } };
  const normalized = normalizeEntries(sourceEntries);
  const draftOrderMeta = withPositionDraftOrder(normalized);
  const priceOrderMeta = withPositionPriceOrder(normalized);

  return normalized.map((row) => {
    const orderMeta = draftOrderMeta.get(row.__sourceIndex) || { posDraftOrder: null, posDraftCount: null };
    const auctionMeta = priceOrderMeta.get(row.__sourceIndex) || { posPriceOrder: null, posPriceCount: null };
    const posDraftOrder = orderMeta.posDraftOrder;
    const posDraftCount = orderMeta.posDraftCount;
    const posPriceOrder = auctionMeta.posPriceOrder;
    const posPriceCount = auctionMeta.posPriceCount;
    const finishRank = row.finishRank;
    const cap = cfg.positionCaps[row.normalizedPosition] ?? null;
    const isDefenseOrKicker = row.isDefenseOrKicker;

    const finishPoolSize = cfg.finishPoolStrategy === 'cap' && cap != null
      ? cap
      : posDraftCount;

    const imputedFinishRank = !isDefenseOrKicker && finishRank == null && finishPoolSize != null
      ? finishPoolSize
      : null;

    const effectiveFinishRank = finishRank ?? imputedFinishRank;
    const cappedFinishRank = effectiveFinishRank != null && cap != null ? Math.min(effectiveFinishRank, cap) : null;
    const isRankEligible = !isDefenseOrKicker && effectiveFinishRank != null;

    const draftPercentileWithinPos = !isDefenseOrKicker
      ? percentileFromRank(posDraftOrder, posDraftCount)
      : null;

    const finishPercentileWithinPos = isRankEligible
      ? percentileFromRank(effectiveFinishRank, finishPoolSize)
      : null;

    const percentileDelta =
      draftPercentileWithinPos != null && finishPercentileWithinPos != null
        ? finishPercentileWithinPos - draftPercentileWithinPos
        : null;

    const posRankDelta = isRankEligible ? posDraftOrder - effectiveFinishRank : null;
    const cappedPosRankDelta = isRankEligible && cappedFinishRank != null ? posDraftOrder - cappedFinishRank : null;
    const priceVsFinishDelta = isRankEligible && posPriceOrder != null ? posPriceOrder - effectiveFinishRank : null;

    const valueRatio = isRankEligible ? posDraftOrder / effectiveFinishRank : null;
    const cappedValueRatio = isRankEligible && cappedFinishRank != null ? posDraftOrder / cappedFinishRank : null;

    const beatCost = isRankEligible ? effectiveFinishRank < posDraftOrder : false;
    const metCost = isRankEligible ? effectiveFinishRank === posDraftOrder : false;
    const missedCost = isRankEligible ? effectiveFinishRank > posDraftOrder : false;

    let hitTier = 'neutral';
    if (isDefenseOrKicker) hitTier = 'excluded';
    else if (!isRankEligible) hitTier = 'unranked';
    else if (beatCost) hitTier = 'win';
    else if (missedCost) hitTier = 'loss';

    const { __sourceIndex, __analysisYear, __analysisOverall, managerValue, playerValue, ...sourcePreserved } = row;

    return {
      ...sourcePreserved,
      managerValue,
      playerValue,
      isDefenseOrKicker,
      normalizedPosition: row.normalizedPosition,
      isRankEligible,
      posDraftOrder,
      posDraftCount,
      auctionPrice: row.auctionPrice,
      posPriceOrder,
      posPriceCount,
      finishRank,
      imputedFinishRank,
      effectiveFinishRank,
      cappedFinishRank,
      posRankDelta,
      cappedPosRankDelta,
      priceVsFinishDelta,
      valueRatio,
      cappedValueRatio,
      draftPercentileWithinPos,
      finishPercentileWithinPos,
      percentileDelta,
      beatCost,
      metCost,
      missedCost,
      hitTier
    };
  });
}

function summarizeGroup(rows) {
  const totalPicks = rows.length;
  const excludedPicks = rows.filter((r) => r.isDefenseOrKicker).length;
  const eligibleRows = rows.filter((r) => r.isRankEligible);
  const eligiblePicks = eligibleRows.length;
  const unrankedPicks = rows.filter((r) => !r.isDefenseOrKicker && !r.isRankEligible).length;

  const beatCount = eligibleRows.filter((r) => r.beatCost).length;
  const metCount = eligibleRows.filter((r) => r.metCost).length;

  const deltas = eligibleRows.map((r) => r.posRankDelta).filter((n) => n != null);
  const cappedDeltas = eligibleRows.map((r) => r.cappedPosRankDelta).filter((n) => n != null);
  const percentiles = eligibleRows.map((r) => r.percentileDelta).filter((n) => n != null);
  const cappedRatios = eligibleRows.map((r) => r.cappedValueRatio).filter((n) => n != null);

  return {
    totalPicks,
    eligiblePicks,
    excludedPicks,
    unrankedPicks,
    beatCostRate: eligiblePicks ? beatCount / eligiblePicks : null,
    metOrBeatCostRate: eligiblePicks ? (beatCount + metCount) / eligiblePicks : null,
    avgPosRankDelta: average(deltas),
    medianPosRankDelta: median(deltas),
    avgCappedPosRankDelta: average(cappedDeltas),
    avgPercentileDelta: average(percentiles),
    avgCappedValueRatio: average(cappedRatios)
  };
}

function groupAndSummarize(entries, keyFn) {
  const map = new Map();
  for (const row of entries) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  const result = [];
  for (const [key, rows] of map.entries()) {
    result.push({ key, ...summarizeGroup(rows) });
  }
  result.sort((a, b) => String(a.key).localeCompare(String(b.key), undefined, { numeric: true }));
  return result;
}

/** @param {any[]} entries */
export function summarizeByYear(entries) {
  return groupAndSummarize(entries, (r) => r.year ?? 'Unknown Year').map(({ key, ...rest }) => ({ year: key, ...rest }));
}

/** @param {any[]} entries */
export function summarizeByManager(entries) {
  return groupAndSummarize(entries, (r) => detectManagerValue(r)).map(({ key, ...rest }) => ({ manager: key, ...rest }));
}

/** @param {any[]} entries */
export function summarizeByPosition(entries) {
  return groupAndSummarize(entries, (r) => r.normalizedPosition ?? normalizePosition(r.position)).map(({ key, ...rest }) => ({ position: key, ...rest }));
}

/** @param {any[]} entries */
export function summarizeByYearAndManager(entries) {
  const byYear = new Map();
  for (const row of entries) {
    const year = row.year ?? 'Unknown Year';
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(row);
  }

  const years = [...byYear.keys()].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  return years.map((year) => ({
    year,
    managers: summarizeByManager(byYear.get(year))
  }));
}
