// Tracks how each alert played out, so you can see if the strategy really works
// before putting serious money in. Records the price on unlock day and N days after,
// then sends a result message.
const { config } = require('./config');
const { getPrices } = require('./sources/coingecko');
const { buildResultMessage } = require('./message');
const { log } = require('./utils');

const DAY = 86400;

function shortReturn(entry, exit) {
  if (!entry || !exit) return null;
  return ((entry - exit) / entry) * 100; // price going down = short profit
}

function computeStats(alerts) {
  const done = alerts.filter((a) => a.priceAtUnlock && a.priceAtAlert);
  if (!done.length) return { count: 0 };
  const rets = done.map((a) => shortReturn(a.priceAtAlert, a.priceAtUnlock));
  return {
    count: done.length,
    winRate: (rets.filter((r) => r > 0).length / rets.length) * 100,
    avgReturn: rets.reduce((s, r) => s + r, 0) / rets.length,
  };
}

/**
 * @param state store state (mutated)
 * @param send async (html) => void
 * @returns true if state changed
 */
async function updateResults(state, send, nowTs = Math.floor(Date.now() / 1000)) {
  if (!config.trackResults) return false;
  const all = Object.values(state.alerts);
  const needUnlock = all.filter((a) => !a.priceAtUnlock && nowTs >= a.unlockTs);
  const needAfter = all.filter((a) => !a.resultSent && nowTs >= a.unlockTs + config.resultDaysAfterUnlock * DAY);
  const ids = [...needUnlock, ...needAfter].map((a) => a.geckoId);
  if (!ids.length) return false;

  let prices;
  try {
    prices = await getPrices(ids);
  } catch (e) {
    log(`Result tracking skipped: ${e.message}`);
    return false;
  }

  let changed = false;
  for (const a of needUnlock) {
    const p = prices.get(a.geckoId);
    if (p) { a.priceAtUnlock = p; changed = true; }
  }
  for (const a of needAfter) {
    const p = prices.get(a.geckoId);
    if (!p) continue;
    a.priceAfter = p;
    a.resultSent = true;
    changed = true;
    const r = {
      ...a,
      daysAfter: config.resultDaysAfterUnlock,
      returnToUnlockPct: shortReturn(a.priceAtAlert, a.priceAtUnlock),
      shortReturnPct: shortReturn(a.priceAtAlert, p),
    };
    try {
      await send(buildResultMessage(r, computeStats(Object.values(state.alerts))));
    } catch (e) {
      log(`Could not send result for ${a.symbol}: ${e.message}`);
    }
  }
  return changed;
}

module.exports = { updateResults, computeStats, shortReturn };
