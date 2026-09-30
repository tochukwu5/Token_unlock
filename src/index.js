// Token-unlock short alert bot
// Runs once a day: finds big upcoming unlocks, checks they can be shorted,
// scores the edge, and sends each new setup to Telegram exactly once.
const cron = require('node-cron');
const { config, validateConfig } = require('./config');
const { log } = require('./utils');
const defillama = require('./sources/defillama');
const coingecko = require('./sources/coingecko');
const exchanges = require('./sources/exchanges');
const { analyze } = require('./analyze');
const { buildAlertMessage } = require('./message');
const { renderCard } = require('./card');
const telegram = require('./telegram');
const store = require('./store');
const tracker = require('./tracker');

const DAY = 86400;
const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');

/** Merge events for the same coin on the same day (a coin can appear under 2 DefiLlama slugs). */
function mergeEvents(events) {
  const map = new Map();
  for (const e of events) {
    const k = `${e.geckoId || e.slug}:${Math.floor(e.timestamp / DAY)}`;
    if (!map.has(k)) { map.set(k, { ...e, allocations: [...e.allocations] }); continue; }
    const m = map.get(k);
    // same coin listed twice usually means duplicate data — keep the bigger one
    if (e.totalTokens > m.totalTokens) map.set(k, { ...e, allocations: [...e.allocations] });
  }
  return [...map.values()];
}

async function makeCard(setup) {
  try {
    const logo = await coingecko.getLogoDataUri(setup.image);
    return renderCard(setup, { logoDataUri: logo, timezone: config.timezone });
  } catch (e) {
    log(`Card render failed for ${setup.symbol}: ${e.message}`);
    return null;
  }
}

let running = false;

async function runScan() {
  if (running) { log('Scan already running, skipping'); return; }
  running = true;
  const started = Date.now();
  try {
    const nowTs = Math.floor(Date.now() / 1000);
    const state = store.load();

    // 1. Unlocks in the window
    const raw = await defillama.getUpcomingUnlocks({
      fromTs: nowTs + config.minDaysAhead * DAY,
      toTs: nowTs + config.windowDays * DAY,
      concurrency: config.fetchConcurrency,
    });
    const events = mergeEvents(raw).filter((e) => {
      const key = `${e.slug}:${Math.floor(e.timestamp / DAY) * DAY}`;
      return !store.isSent(state, key); // already alerted → ignore
    });
    log(`${events.length} new unlocks to evaluate (already-sent ones ignored)`);

    let setups = [];
    let exchangeErrors = [];
    if (events.length) {
      // 2. Market data + 3. exchanges
      const markets = await coingecko.getMarkets(events.map((e) => e.geckoId));
      const exData = await exchanges.loadExchanges(config.exchanges);
      exchangeErrors = exData.errors;
      if (config.requirePerp && exData.markets.size === 0) {
        throw new Error(`No exchange data loaded: ${exData.errors.join('; ')}`);
      }

      // 4. Filter + score
      const result = await analyze({
        events,
        markets,
        findPerps: (symbol, price) => exchanges.findPerps(exData, symbol, price),
        cfg: config,
        nowTs,
      });
      setups = result.setups;
      log(`${setups.length} setups passed the edge filters, ${result.rejected.length} rejected`);
      for (const r of result.rejected.slice(0, 40)) log(`  ✗ ${r.name}: ${r.reason}`);
    }

    // 5. Send new alerts (best first) and remember them
    const toSend = setups.slice(0, config.maxAlertsPerScan);
    for (const s of toSend) {
      const html = buildAlertMessage(s, { timezone: config.timezone });
      if (DRY_RUN) {
        log(`[dry-run] would alert ${s.symbol} score ${s.score}\n${html}\n`);
        continue;
      }
      const png = await makeCard(s);
      await telegram.broadcastAlert(html, png);
      store.markSent(state, s);
      store.save(state); // save after each send so a crash never causes a repeat
      log(`Alert sent: ${s.name} ($${s.symbol}) score ${s.score}`);
    }

    // 6. Results of older alerts
    if (!DRY_RUN) {
      const changed = await tracker.updateResults(state, (html) => telegram.broadcastText(html), nowTs);
      if (changed) store.save(state);
    }

    if (config.sendDailySummary && !DRY_RUN) {
      const mins = ((Date.now() - started) / 60000).toFixed(1);
      await telegram.broadcastText(
        `🗓 <b>Daily unlock scan done</b> (${mins} min)\n`
        + `Unlocks checked: ${events.length}\nNew alerts: ${toSend.length}`
        + (exchangeErrors.length ? `\n⚠️ ${exchangeErrors.join('\n⚠️ ')}` : ''),
      );
    }
    log(`Scan finished in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  } catch (e) {
    log(`Scan failed: ${e.stack || e.message}`);
    if (!DRY_RUN && config.telegramToken) {
      await telegram.broadcastText(`⚠️ <b>Unlock bot scan failed</b>\n${String(e.message).slice(0, 500)}`).catch(() => {});
    }
  } finally {
    running = false;
  }
}

async function sendTestAlert() {
  const sample = require('../test/sample-setup');
  const s = sample.makeSample(Math.floor(Date.now() / 1000));
  const html = buildAlertMessage(s, { timezone: config.timezone });
  const png = renderCard(s, { logoDataUri: null, timezone: config.timezone });
  await telegram.broadcastAlert(`🧪 <b>TEST ALERT — not a real signal</b>\n\n${html}`, png);
  log('Test alert sent');
}

async function main() {
  const problems = validateConfig({ needTelegram: !DRY_RUN });
  if (problems.length) {
    console.error(`Config problems:\n - ${problems.join('\n - ')}`);
    process.exit(1);
  }

  if (args.has('--test-alert')) { await sendTestAlert(); return; }
  if (args.has('--once') || DRY_RUN) { await runScan(); return; }

  if (!cron.validate(config.scanCron)) {
    console.error(`SCAN_CRON "${config.scanCron}" is not a valid cron expression`);
    process.exit(1);
  }
  cron.schedule(config.scanCron, runScan, { timezone: config.timezone });
  log(`Scheduler on: "${config.scanCron}" (${config.timezone}). Window ${config.minDaysAhead}–${config.windowDays} days before unlock.`);

  if (config.sendStartupMessage) {
    await telegram.broadcastText(
      `🤖 <b>Unlock short bot is live</b>\nScans daily (${config.scanCron}, ${config.timezone}) for unlocks `
      + `${config.minDaysAhead}–${config.windowDays} days away · min ${config.minUnlockPctCirc}% of circ · min edge score ${config.minScore}.`,
    ).catch((e) => log(`Startup message failed: ${e.message}`));
  }
  if (config.runOnStart) await runScan();
}

process.on('unhandledRejection', (e) => log('Unhandled:', e));

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { runScan, mergeEvents };
