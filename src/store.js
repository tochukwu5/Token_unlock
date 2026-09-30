// Remembers which unlocks were already sent, so each one is alerted only once.
// Saved as JSON in DATA_DIR. On Railway, attach a Volume at /data and set DATA_DIR=/data,
// otherwise the memory is wiped on every redeploy and old alerts may be re-sent.
const fs = require('fs');
const path = require('path');
const { config } = require('./config');

function filePath() {
  return path.join(config.dataDir, 'alerts.json');
}

function load() {
  try {
    const raw = fs.readFileSync(filePath(), 'utf8');
    const data = JSON.parse(raw);
    return { alerts: data.alerts || {} };
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Could not read alerts.json, starting fresh:', e.message);
    return { alerts: {} };
  }
}

function save(state) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = `${filePath()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, filePath()); // atomic replace
}

function isSent(state, key) {
  return Boolean(state.alerts[key]);
}

function markSent(state, setup) {
  state.alerts[setup.key] = {
    key: setup.key,
    slug: setup.slug,
    name: setup.name,
    symbol: setup.symbol,
    geckoId: setup.geckoId,
    unlockTs: setup.unlockTs,
    alertedAt: Math.floor(Date.now() / 1000),
    priceAtAlert: setup.price,
    pctCirc: setup.pctCirc,
    unlockUsd: setup.unlockUsd,
    score: setup.score,
    grade: setup.grade,
    priceAtUnlock: null,
    priceAfter: null,
    resultSent: false,
  };
}

module.exports = { load, save, isSent, markSent };
