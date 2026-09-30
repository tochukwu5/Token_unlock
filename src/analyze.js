// Turns raw unlock events + market data into scored short setups.
const { categoryInfo } = require('./sources/defillama');

const DAY = 86400;

/**
 * EDGE SCORE (0–100). What the research says matters most:
 *  1. Unlock size vs circulating supply ............ up to 30 pts
 *  2. Unlock value vs normal daily trading volume ... up to 20 pts (can the market absorb it?)
 *  3. Who receives it (team/VC most likely to sell) . up to 20 pts
 *  4. Small market cap (thin books move more) ....... up to 10 pts
 *  5. Funding rate (positive = shorts get paid) ..... up to 10 pts
 *  6. Short crowding (open interest vs market cap) .. up to 10 pts
 *  Penalties: already dumped a lot, or pumping hard into the unlock.
 */
function scoreSetup(s) {
  let score = 0;
  const warnings = [];

  // 1. Size vs circulating supply
  const p = s.pctCirc;
  score += p >= 10 ? 30 : p >= 5 ? 24 : p >= 3 ? 16 : p >= 2 ? 10 : 4;

  // 2. Unlock value vs 24h spot volume
  const r = s.volRatio;
  if (r !== null) score += r >= 5 ? 20 : r >= 2 ? 15 : r >= 1 ? 10 : r >= 0.5 ? 5 : 0;

  // 3. Recipients
  score += Math.round(20 * s.sellPressure);

  // 4. Market cap
  const m = s.mcap || Infinity;
  score += m < 100e6 ? 10 : m < 300e6 ? 8 : m < 1e9 ? 5 : m < 3e9 ? 2 : 0;

  // 5. Funding (average across exchanges)
  const f = s.fundingRate;
  if (f === null) score += 5;
  else if (f >= 0.0001) score += 10;
  else if (f >= 0) score += 8;
  else if (f > -0.0003) { score += 4; warnings.push('Funding is negative — shorts are paying longs'); }
  else warnings.push('Very negative funding — shorts are crowded, squeeze risk');

  // 6. Crowding: open interest vs market cap
  const oi = s.oiToMcap;
  if (oi === null) score += 5;
  else if (oi < 0.05) score += 10;
  else if (oi < 0.10) score += 6;
  else if (oi < 0.20) { score += 3; warnings.push('High open interest vs market cap'); }
  else warnings.push('Open interest is very high vs market cap — squeeze risk');

  // Penalties
  if (s.chg30d !== null && s.chg30d <= -40) {
    score -= 8;
    warnings.push(`Already down ${Math.abs(s.chg30d).toFixed(0)}% in 30d — much of the drop may be priced in`);
  }
  if (s.chg7d !== null && s.chg7d >= 30) {
    score -= 5;
    warnings.push(`Up ${s.chg7d.toFixed(0)}% this week — strong momentum, wait for it to cool`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade = score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 45 ? 'C' : 'D';

  let squeezeRisk = 'LOW';
  if ((f !== null && f < -0.0003) || (oi !== null && oi >= 0.2)) squeezeRisk = 'HIGH';
  else if ((f !== null && f < 0) || (oi !== null && oi >= 0.1) || (s.chg7d !== null && s.chg7d >= 25)) squeezeRisk = 'MEDIUM';

  return { score, grade, warnings, squeezeRisk };
}

function recipientBreakdown(allocations) {
  const total = allocations.reduce((s, a) => s + a.amount, 0) || 1;
  const byLabel = new Map();
  let weighted = 0;
  for (const a of allocations) {
    const info = categoryInfo(a.category);
    weighted += info.weight * a.amount;
    const label = info.label;
    byLabel.set(label, (byLabel.get(label) || 0) + a.amount);
  }
  const parts = [...byLabel.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([label, amt]) => ({ label, share: (amt / total) * 100 }));
  const names = [...new Set(allocations.map((a) => a.recipient).filter(Boolean))];
  return { parts, sellPressure: weighted / total, names };
}

/**
 * @param {object} args
 *  events: from defillama.getUpcomingUnlocks
 *  markets: Map geckoId → market data (coingecko)
 *  findPerps: async (symbol, price) → perp entries
 *  cfg: config
 *  nowTs: unix seconds
 * @returns { setups: passing setups sorted by score, rejected: [{name, reason}] }
 */
async function analyze({ events, markets, findPerps, cfg, nowTs }) {
  const setups = [];
  const rejected = [];
  const reject = (e, reason) => rejected.push({ name: e.name, slug: e.slug, reason });

  for (const e of events) {
    const daysAhead = (e.timestamp - nowTs) / DAY;
    if (daysAhead < cfg.minDaysAhead || daysAhead > cfg.windowDays) { reject(e, `out of window (${daysAhead.toFixed(1)}d)`); continue; }

    const mkt = e.geckoId ? markets.get(e.geckoId) : null;
    if (!mkt || !mkt.price) { reject(e, 'no market data'); continue; }
    if (!mkt.circSupply) { reject(e, 'no circulating supply'); continue; }

    const unlockUsd = e.totalTokens * mkt.price;
    const pctCirc = (e.totalTokens / mkt.circSupply) * 100;
    if (pctCirc < cfg.minUnlockPctCirc) { reject(e, `small unlock ${pctCirc.toFixed(2)}% of circ`); continue; }
    if (unlockUsd < cfg.minUnlockUsd) { reject(e, `unlock value too small $${unlockUsd.toFixed(0)}`); continue; }
    if (mkt.mcap && mkt.mcap > cfg.maxMarketCapUsd) { reject(e, 'market cap too large'); continue; }

    const perps = await findPerps(mkt.symbol, mkt.price);
    if (cfg.requirePerp && !perps.length) { reject(e, 'no perp futures market to short'); continue; }
    const futVol = perps.reduce((s, p) => s + (p.volume24hUsd || 0), 0);
    if (cfg.requirePerp && futVol < cfg.minFuturesVolumeUsd) { reject(e, `futures volume too low $${futVol.toFixed(0)}`); continue; }

    const fundings = perps.map((p) => p.fundingRate).filter((x) => x !== null && !Number.isNaN(x));
    const fundingRate = fundings.length ? fundings.reduce((a, b) => a + b, 0) / fundings.length : null;
    const oiUsd = perps.some((p) => p.oiUsd) ? perps.reduce((s, p) => s + (p.oiUsd || 0), 0) : null;

    const rec = recipientBreakdown(e.allocations);
    const s = {
      key: `${e.slug}:${Math.floor(e.timestamp / DAY) * DAY}`,
      slug: e.slug,
      name: mkt.name || e.name,
      symbol: mkt.symbol,
      geckoId: e.geckoId,
      image: mkt.image,
      chain: e.chain,
      unlockTs: e.timestamp,
      daysAhead,
      unlockTokens: e.totalTokens,
      unlockUsd,
      pctCirc,
      volRatio: mkt.volume24h ? unlockUsd / mkt.volume24h : null,
      recipients: rec.parts,
      recipientNames: rec.names,
      sellPressure: rec.sellPressure,
      price: mkt.price,
      mcap: mkt.mcap,
      fdv: mkt.fdv,
      volume24h: mkt.volume24h,
      chg24h: mkt.chg24h ?? null,
      chg7d: mkt.chg7d ?? null,
      chg30d: mkt.chg30d ?? null,
      perps,
      futuresVolume24h: futVol,
      fundingRate,
      oiUsd,
      oiToMcap: oiUsd !== null && mkt.mcap ? oiUsd / mkt.mcap : null,
      sources: e.sources,
    };
    Object.assign(s, scoreSetup(s));
    if (s.score < cfg.minScore) { reject(e, `edge score ${s.score} < ${cfg.minScore}`); continue; }
    setups.push(s);
  }

  setups.sort((a, b) => b.score - a.score);
  return { setups, rejected };
}

module.exports = { analyze, scoreSetup, recipientBreakdown };
