// A made-up setup used by `npm run test-alert` to check Telegram + the picture.
function makeSample(nowTs) {
  return {
    key: 'sample:0',
    slug: 'sample-protocol',
    name: 'Sample Protocol',
    symbol: 'SMPL',
    geckoId: null,
    image: null,
    chain: 'Ethereum',
    unlockTs: nowTs + 12 * 86400,
    daysAhead: 12,
    unlockTokens: 42_500_000,
    unlockUsd: 18_700_000,
    pctCirc: 6.8,
    volRatio: 2.4,
    recipients: [{ label: 'Investors (VC)', share: 55 }, { label: 'Team / Insiders', share: 45 }],
    recipientNames: ['Seed Investors', 'Core Contributors'],
    sellPressure: 1,
    price: 0.44,
    mcap: 275_000_000,
    volume24h: 7_800_000,
    chg24h: -2.1,
    chg7d: -6.4,
    chg30d: -11.2,
    perps: [
      { exchange: 'Binance', url: 'https://www.binance.com/en/futures', fundingRate: 0.0001, oiUsd: 9_000_000, volume24hUsd: 40_000_000 },
      { exchange: 'Bybit', url: 'https://www.bybit.com/trade/usdt', fundingRate: 0.00005, oiUsd: 4_000_000, volume24hUsd: 15_000_000 },
    ],
    futuresVolume24h: 55_000_000,
    fundingRate: 0.000075,
    oiUsd: 13_000_000,
    oiToMcap: 13_000_000 / 275_000_000,
    score: 82,
    grade: 'A',
    warnings: [],
    squeezeRisk: 'LOW',
  };
}

module.exports = { makeSample };
