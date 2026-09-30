// Offline test: runs the full pipeline on made-up data (no internet needed).
// Checks: unlock extraction, filters, scoring, dedupe, message size, picture, result tracking.
// Usage: npm run mock   → writes test/out/*.png and prints the messages.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

process.env.DATA_DIR = path.join(__dirname, 'out', 'data');
fs.rmSync(path.join(__dirname, 'out'), { recursive: true, force: true });

const { config } = require('../src/config');
const { extractCliffUnlocks } = require('../src/sources/defillama');
const { splitMultiplier } = require('../src/sources/exchanges');
const { analyze } = require('../src/analyze');
const { buildAlertMessage } = require('../src/message');
const { renderCard } = require('../src/card');
const { visibleLength } = require('../src/telegram');
const store = require('../src/store');
const { mergeEvents } = require('../src/index');

const DAY = 86400;
const now = Math.floor(Date.UTC(2026, 8, 28, 8) / 1000);
const day = (n) => Math.floor((now + n * DAY) / DAY) * DAY;

// ---------- fake DefiLlama bodies ----------
const bodies = {
  // big VC + team cliff, 12 days out → should alert
  alpha: {
    name: 'Alpha Network', gecko_id: 'alpha-network', chainName: 'Arbitrum',
    metadata: {
      token: 'coingecko:alpha-network',
      unlockEvents: [
        { timestamp: day(12), cliffAllocations: [
          { recipient: 'Seed Investors', category: 'privateSale', unlockType: 'cliff', amount: 30_000_000 },
          { recipient: 'Core Team', category: 'insiders', unlockType: 'cliff', amount: 20_000_000 },
        ], linearAllocations: [] },
        { timestamp: day(80), cliffAllocations: [{ recipient: 'Team', category: 'insiders', amount: 5e6 }], linearAllocations: [] },
      ],
    },
  },
  // flat events format, ecosystem unlock, small → should be rejected
  beta: {
    name: 'Beta Finance', gecko_id: 'beta-finance',
    metadata: { events: [
      { timestamp: day(9), noOfTokens: [1_000_000], category: 'noncirculating', unlockType: 'cliff' },
      { timestamp: day(9), noOfTokens: [9_000_000], category: 'farming', unlockType: 'linear' },
    ] },
  },
  // only chart data (fallback detector), 20 days out, big airdrop jump
  gamma: {
    name: 'Gamma', metadata: { token: 'coingecko:gamma-token' },
    categories: { airdrop: ['Community Airdrop'] },
    documentedData: { data: [{
      label: 'Community Airdrop',
      data: Array.from({ length: 60 }, (_, i) => {
        const ts = day(i - 10);
        const unlocked = i < 30 ? i * 10_000 : 30 * 10_000 + 80_000_000 + (i - 30) * 10_000; // jump at day(20)
        return { timestamp: ts, unlocked, rawEmission: unlocked, burned: 0 };
      }),
    }] },
  },
  // 1 day out → too late, rejected
  delta: {
    name: 'Delta', gecko_id: 'delta',
    metadata: { unlockEvents: [{ timestamp: day(1), cliffAllocations: [{ recipient: 'Team', category: 'insiders', amount: 9e7 }] }] },
  },
  // no perp → rejected
  epsilon: {
    name: 'Epsilon', gecko_id: 'epsilon',
    metadata: { unlockEvents: [{ timestamp: day(15), cliffAllocations: [{ recipient: 'VC', category: 'privateSale', amount: 5e7 }] }] },
  },
};

const fromTs = now + config.minDaysAhead * DAY;
const toTs = now + config.windowDays * DAY;
let events = [];
for (const [slug, body] of Object.entries(bodies)) {
  const u = extractCliffUnlocks(body, fromTs - 5 * DAY, toTs); // wider so "delta" appears and is rejected by analyze
  const geckoId = body.gecko_id || body.metadata.token.replace('coingecko:', '');
  events.push(...u.map((x) => ({ slug, name: body.name, geckoId, chain: body.chainName, sources: [], ...x })));
}
// duplicate listing of alpha under another slug → must be merged
events.push({ ...events[0], slug: 'alpha-dup' });
events = mergeEvents(events);

assert.ok(events.find((e) => e.slug === 'alpha' && e.totalTokens === 50_000_000), 'alpha cliff extracted');
assert.ok(!events.find((e) => e.slug === 'beta' && e.totalTokens > 1_000_000), 'linear beta event ignored');
assert.ok(events.find((e) => e.slug === 'gamma' && e.totalTokens >= 80_000_000), 'gamma jump detected from chart');
assert.strictEqual(events.filter((e) => e.geckoId === 'alpha-network').length, 1, 'duplicate merged');
console.log('✓ unlock extraction:', events.map((e) => `${e.slug}@+${((e.timestamp - now) / DAY).toFixed(0)}d=${e.totalTokens}`).join(', '));

// ---------- fake market + exchange data ----------
const markets = new Map([
  ['alpha-network', { symbol: 'ALPHA', name: 'Alpha Network', price: 0.5, circSupply: 600_000_000, mcap: 300_000_000, volume24h: 9_000_000, chg24h: -1.2, chg7d: -4, chg30d: -9 }],
  ['beta-finance', { symbol: 'BETA', name: 'Beta Finance', price: 1, circSupply: 500_000_000, mcap: 500_000_000, volume24h: 20_000_000 }],
  ['gamma-token', { symbol: 'GAMMA', name: 'Gamma', price: 0.1, circSupply: 900_000_000, mcap: 90_000_000, volume24h: 3_000_000, chg24h: 3, chg7d: 35, chg30d: 10 }],
  ['delta', { symbol: 'DLT', name: 'Delta', price: 1, circSupply: 1e9, mcap: 1e9, volume24h: 1e7 }],
  ['epsilon', { symbol: 'EPS', name: 'Epsilon', price: 1, circSupply: 1e9, mcap: 1e9, volume24h: 1e7 }],
]);
const perps = {
  ALPHA: [{ exchange: 'Binance', symbol: 'ALPHAUSDT', url: 'https://www.binance.com/en/futures/ALPHAUSDT', fundingRate: 0.0001, oiUsd: 12e6, volume24hUsd: 60e6 },
    { exchange: 'Bybit', symbol: 'ALPHAUSDT', url: 'https://www.bybit.com/trade/usdt/ALPHAUSDT', fundingRate: 0.00008, oiUsd: 5e6, volume24hUsd: 20e6 }],
  GAMMA: [{ exchange: 'Bybit', symbol: '1000GAMMAUSDT', url: 'https://www.bybit.com/trade/usdt/1000GAMMAUSDT', fundingRate: -0.0002, oiUsd: 11e6, volume24hUsd: 8e6 }],
  DLT: [{ exchange: 'Binance', symbol: 'DLTUSDT', url: '', fundingRate: 0, oiUsd: 1e6, volume24hUsd: 5e6 }],
};

assert.deepStrictEqual(splitMultiplier('1000PEPE'), { underlying: 'PEPE', multiplier: 1000 });
assert.deepStrictEqual(splitMultiplier('1INCH'), { underlying: '1INCH', multiplier: 1 });
console.log('✓ exchange ticker multipliers');

(async () => {
  const { setups, rejected } = await analyze({
    events, markets, findPerps: async (sym) => perps[sym] || [], cfg: { ...config, minScore: 40 }, nowTs: now,
  });
  console.log('✓ passed:', setups.map((s) => `${s.symbol} ${s.score}/${s.grade} risk=${s.squeezeRisk}`).join(', '));
  console.log('✓ rejected:', rejected.map((r) => `${r.slug}: ${r.reason}`).join(' | '));
  assert.ok(setups.find((s) => s.symbol === 'ALPHA'), 'ALPHA should pass');
  assert.ok(!setups.find((s) => s.symbol === 'BETA'), 'BETA should be rejected');
  assert.ok(!setups.find((s) => s.symbol === 'DLT'), 'DLT too close');
  assert.ok(!setups.find((s) => s.symbol === 'EPS'), 'EPS has no perp');
  const alpha = setups.find((s) => s.symbol === 'ALPHA');
  assert.ok(Math.abs(alpha.pctCirc - 8.333) < 0.01, 'pct of circ');

  // messages + pictures
  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  for (const s of setups) {
    const html = buildAlertMessage(s, { timezone: config.timezone });
    const len = visibleLength(html);
    console.log(`\n----- ${s.symbol} message (${len} visible chars, fits caption: ${len <= 1024}) -----\n${html}`);
    const png = renderCard(s, { logoDataUri: null, timezone: config.timezone });
    fs.writeFileSync(path.join(outDir, `${s.symbol}.png`), png);
  }

  // dedupe
  const state = store.load();
  store.markSent(state, alpha);
  store.save(state);
  const reloaded = store.load();
  assert.ok(store.isSent(reloaded, alpha.key), 'sent alert remembered after reload');
  console.log('\n✓ dedupe: ALPHA remembered, will be ignored on the next scan');

  // result tracking with stubbed prices
  const cg = require('../src/sources/coingecko');
  cg.getPrices = async (ids) => new Map(ids.map((id) => [id, 0.41]));
  delete require.cache[require.resolve('../src/tracker')];
  const tracker = require('../src/tracker');
  const sent = [];
  const later = alpha.unlockTs + 8 * DAY;
  await tracker.updateResults(reloaded, async (h) => sent.push(h), later);
  assert.strictEqual(sent.length, 1, 'one result message');
  assert.ok(reloaded.alerts[alpha.key].resultSent, 'result marked sent');
  await tracker.updateResults(reloaded, async (h) => sent.push(h), later + DAY);
  assert.strictEqual(sent.length, 1, 'result not sent twice');
  console.log(`\n----- result message -----\n${sent[0]}`);
  console.log('\nALL CHECKS PASSED ✅  Pictures saved in test/out/');
})().catch((e) => { console.error('TEST FAILED', e); process.exit(1); });
