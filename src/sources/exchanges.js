// Perpetual futures data (can we short it? funding, open interest, volume)
// from Binance and Bybit public APIs. No API keys needed.
//
// NOTE: Binance and Bybit block requests from US servers. On Railway, deploy the
// service in an EU or Asia region (e.g. "EU West (Amsterdam)" or "Southeast Asia").
const { fetchJson, log } = require('../utils');

const MULT_RE = /^(1000000|100000|10000|1000|100)([A-Z0-9]+)$/;

function splitMultiplier(base) {
  const m = MULT_RE.exec(base);
  if (m) return { underlying: m[2], multiplier: Number(m[1]) };
  return { underlying: base, multiplier: 1 };
}

function addEntry(map, entry) {
  if (!map.has(entry.underlying)) map.set(entry.underlying, []);
  map.get(entry.underlying).push(entry);
}

// ---------------- Binance USDⓈ-M futures ----------------
const BINANCE = 'https://fapi.binance.com';

async function loadBinance() {
  const [info, premium, tickers] = await Promise.all([
    fetchJson(`${BINANCE}/fapi/v1/exchangeInfo`, { label: 'Binance exchangeInfo' }),
    fetchJson(`${BINANCE}/fapi/v1/premiumIndex`, { label: 'Binance premiumIndex' }),
    fetchJson(`${BINANCE}/fapi/v1/ticker/24hr`, { label: 'Binance 24hr' }),
  ]);
  const prem = new Map(premium.map((p) => [p.symbol, p]));
  const tick = new Map(tickers.map((t) => [t.symbol, t]));
  const map = new Map();
  for (const s of info.symbols || []) {
    if (s.contractType !== 'PERPETUAL' || s.status !== 'TRADING' || s.quoteAsset !== 'USDT') continue;
    const { underlying, multiplier } = splitMultiplier(s.baseAsset);
    const p = prem.get(s.symbol);
    const t = tick.get(s.symbol);
    addEntry(map, {
      exchange: 'Binance',
      symbol: s.symbol,
      underlying,
      multiplier,
      markPrice: p ? Number(p.markPrice) : null,
      fundingRate: p ? Number(p.lastFundingRate) : null, // per interval, e.g. 0.0001 = 0.01%
      volume24hUsd: t ? Number(t.quoteVolume) : null,
      oiUsd: null, // fetched lazily for matches only
      url: `https://www.binance.com/en/futures/${s.symbol}`,
    });
  }
  return map;
}

async function binanceOpenInterestUsd(entry) {
  try {
    const r = await fetchJson(`${BINANCE}/fapi/v1/openInterest?symbol=${entry.symbol}`, { label: 'Binance OI', retries: 1 });
    return Number(r.openInterest) * (entry.markPrice || 0);
  } catch {
    return null;
  }
}

// ---------------- Bybit linear perps ----------------
const BYBIT = 'https://api.bybit.com';

async function loadBybit() {
  const instruments = [];
  let cursor = '';
  for (let page = 0; page < 10; page++) {
    const url = `${BYBIT}/v5/market/instruments-info?category=linear&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const r = await fetchJson(url, { label: 'Bybit instruments' });
    if (r.retCode !== 0) throw new Error(`Bybit instruments: ${r.retMsg}`);
    instruments.push(...(r.result?.list || []));
    cursor = r.result?.nextPageCursor;
    if (!cursor) break;
  }
  const t = await fetchJson(`${BYBIT}/v5/market/tickers?category=linear`, { label: 'Bybit tickers' });
  if (t.retCode !== 0) throw new Error(`Bybit tickers: ${t.retMsg}`);
  const tick = new Map((t.result?.list || []).map((x) => [x.symbol, x]));
  const map = new Map();
  for (const s of instruments) {
    if (s.contractType !== 'LinearPerpetual' || s.status !== 'Trading' || s.quoteCoin !== 'USDT') continue;
    const { underlying, multiplier } = splitMultiplier(s.baseCoin);
    const x = tick.get(s.symbol);
    addEntry(map, {
      exchange: 'Bybit',
      symbol: s.symbol,
      underlying,
      multiplier,
      markPrice: x ? Number(x.markPrice) : null,
      fundingRate: x ? Number(x.fundingRate) : null,
      volume24hUsd: x ? Number(x.turnover24h) : null,
      oiUsd: x ? Number(x.openInterestValue) : null,
      url: `https://www.bybit.com/trade/usdt/${s.symbol}`,
    });
  }
  return map;
}

const LOADERS = { binance: loadBinance, bybit: loadBybit };

/**
 * Load all enabled exchanges once per scan.
 * @returns { markets: Map<exchangeName, Map<underlying, entry[]>>, errors: string[] }
 */
async function loadExchanges(names) {
  const markets = new Map();
  const errors = [];
  await Promise.all(names.map(async (n) => {
    const loader = LOADERS[n];
    if (!loader) { errors.push(`Unknown exchange "${n}"`); return; }
    try {
      const m = await loader();
      markets.set(n, m);
      log(`${n}: ${[...m.values()].flat().length} USDT perpetuals loaded`);
    } catch (e) {
      const hint = /HTTP (451|403)/.test(e.message) ? ' (region blocked — deploy Railway in EU/Asia)' : '';
      errors.push(`${n}: ${e.message}${hint}`);
      log(`${n} failed: ${e.message}${hint}`);
    }
  }));
  return { markets, errors };
}

/**
 * Find the perp for a coin on each exchange. We match by ticker AND check the
 * exchange price is close to CoinGecko's price, so we don't confuse two coins
 * that share the same ticker.
 */
async function findPerps(exchangeData, symbol, cgPrice) {
  const found = [];
  for (const [, map] of exchangeData.markets) {
    const candidates = map.get(String(symbol || '').toUpperCase()) || [];
    for (const c of candidates) {
      if (cgPrice && c.markPrice) {
        const unitPrice = c.markPrice / c.multiplier;
        const diff = Math.abs(unitPrice - cgPrice) / cgPrice;
        if (diff > 0.3) continue; // different coin with the same ticker
      }
      const entry = { ...c };
      if (entry.exchange === 'Binance' && entry.oiUsd === null) entry.oiUsd = await binanceOpenInterestUsd(entry);
      found.push(entry);
      break; // one market per exchange is enough
    }
  }
  return found;
}

module.exports = { loadExchanges, findPerps, splitMultiplier };
