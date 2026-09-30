// Market data (price, circulating supply, market cap, volume) from CoinGecko.
const { fetchJson, chunk, sleep, log } = require('../utils');
const { config } = require('../config');

const BASE = 'https://api.coingecko.com/api/v3';

function headers() {
  return config.coingeckoApiKey ? { 'x-cg-demo-api-key': config.coingeckoApiKey } : {};
}

/**
 * @returns Map geckoId → { symbol, name, image, price, circSupply, mcap, volume24h, chg24h, chg7d, chg30d }
 */
async function getMarkets(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = new Map();
  for (const batch of chunk(unique, 100)) {
    const url = `${BASE}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(batch.join(','))}`
      + '&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d,30d';
    const rows = await fetchJson(url, { headers: headers(), label: 'CoinGecko markets', retries: 4 });
    for (const r of rows || []) {
      out.set(r.id, {
        symbol: String(r.symbol || '').toUpperCase(),
        name: r.name,
        image: r.image,
        price: r.current_price,
        circSupply: r.circulating_supply,
        mcap: r.market_cap || (r.current_price && r.circulating_supply ? r.current_price * r.circulating_supply : null),
        fdv: r.fully_diluted_valuation,
        volume24h: r.total_volume,
        chg24h: r.price_change_percentage_24h_in_currency ?? r.price_change_percentage_24h,
        chg7d: r.price_change_percentage_7d_in_currency,
        chg30d: r.price_change_percentage_30d_in_currency,
      });
    }
    await sleep(config.coingeckoApiKey ? 500 : 6000); // stay under the free rate limit
  }
  log(`CoinGecko: got market data for ${out.size}/${unique.length} tokens`);
  return out;
}

/** Simple current prices, used for result tracking. */
async function getPrices(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = new Map();
  for (const batch of chunk(unique, 100)) {
    const url = `${BASE}/simple/price?vs_currencies=usd&ids=${encodeURIComponent(batch.join(','))}`;
    const res = await fetchJson(url, { headers: headers(), label: 'CoinGecko prices', retries: 4 });
    for (const [id, v] of Object.entries(res || {})) if (v?.usd) out.set(id, v.usd);
    await sleep(config.coingeckoApiKey ? 500 : 6000);
  }
  return out;
}

/** Download the token logo as a data URI (for the alert image). PNG/JPEG only. */
async function getLogoDataUri(url) {
  if (!url) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(url.replace('/small/', '/large/').replace('/thumb/', '/large/'), { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || '').split(';')[0];
    if (!['image/png', 'image/jpeg', 'image/jpg'].includes(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

module.exports = { getMarkets, getPrices, getLogoDataUri };
