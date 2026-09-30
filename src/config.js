// All settings come from environment variables (set them in Railway → Variables).
// Every setting has a safe default except the Telegram ones.

function num(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Env ${name} must be a number, got "${v}"`);
  return n;
}

function bool(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function list(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

const config = {
  // --- Telegram ---
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  // One or more chat IDs, comma separated (you, your friend, or a group)
  telegramChatIds: list('TELEGRAM_CHAT_ID', []),

  // --- Schedule ---
  // Default: every day at 08:00 Lagos time
  scanCron: process.env.SCAN_CRON || '0 8 * * *',
  timezone: process.env.TIMEZONE || 'Africa/Lagos',
  runOnStart: bool('RUN_ON_START', true),

  // --- Storage (attach a Railway volume and set DATA_DIR=/data) ---
  dataDir: process.env.DATA_DIR || './data',

  // --- Data sources ---
  // Unlock schedules come from DefiLlama's free public datasets (no key needed).
  // Optional free "Demo" key from coingecko.com — gives steadier rate limits
  coingeckoApiKey: process.env.COINGECKO_API_KEY || '',
  // Which exchanges to check for a perpetual futures (short) market
  exchanges: list('EXCHANGES', ['binance', 'bybit']).map((e) => e.toLowerCase()),

  // --- Timing window ---
  // Alert when an unlock is between MIN_DAYS_AHEAD and WINDOW_DAYS away.
  // Research shows most of the drop happens in the ~30 days BEFORE the unlock.
  windowDays: num('WINDOW_DAYS', 30),
  minDaysAhead: num('MIN_DAYS_AHEAD', 3),

  // --- Edge filters ---
  minUnlockPctCirc: num('MIN_UNLOCK_PCT', 2), // unlock size as % of circulating supply
  minUnlockUsd: num('MIN_UNLOCK_USD', 1_000_000), // ignore tiny unlocks
  maxMarketCapUsd: num('MAX_MCAP_USD', 5_000_000_000), // big caps absorb unlocks easily
  minFuturesVolumeUsd: num('MIN_FUTURES_VOLUME_USD', 2_000_000), // must be tradable
  requirePerp: bool('REQUIRE_PERP', true),
  minScore: num('MIN_SCORE', 55), // edge score out of 100 needed to alert

  // --- Result tracking ---
  trackResults: bool('TRACK_RESULTS', true),
  resultDaysAfterUnlock: num('RESULT_DAYS_AFTER_UNLOCK', 7),

  // --- Misc ---
  sendStartupMessage: bool('SEND_STARTUP_MESSAGE', true),
  sendDailySummary: bool('SEND_DAILY_SUMMARY', false),
  maxAlertsPerScan: num('MAX_ALERTS_PER_SCAN', 10),
  fetchConcurrency: num('FETCH_CONCURRENCY', 4),
};

function validateConfig({ needTelegram = true } = {}) {
  const problems = [];
  if (needTelegram) {
    if (!config.telegramToken) problems.push('TELEGRAM_BOT_TOKEN is missing');
    if (!config.telegramChatIds.length) problems.push('TELEGRAM_CHAT_ID is missing');
  }
  if (config.minDaysAhead >= config.windowDays) {
    problems.push('MIN_DAYS_AHEAD must be smaller than WINDOW_DAYS');
  }
  return problems;
}

module.exports = { config, validateConfig };
