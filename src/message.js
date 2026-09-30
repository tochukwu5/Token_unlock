// Builds the Telegram alert text (HTML). Styled like the pair alerts you already use:
// a picture card on top, then bold "Label: value" lines.
const {
  fmtUsd, fmtPrice, fmtAmount, fmtPct, escapeHtml, fmtDate, fmtShortDate,
} = require('./utils');

const GRADE_EMOJI = { A: '🔥', B: '✅', C: '👀', D: '⚪' };
const RISK_EMOJI = { LOW: '🟢', MEDIUM: '🟡', HIGH: '🔴' };

function chg(v) {
  if (v === null || v === undefined) return 'n/a';
  return `${fmtPct(v)} ${v < 0 ? '📉' : '📈'}`;
}

function fundingLine(f) {
  if (f === null) return 'n/a';
  const pct = fmtPct(f * 100, { decimals: 4 });
  if (f > 0) return `${pct} ✅ shorts get paid`;
  if (f === 0) return `${pct}`;
  return `${pct} ⚠️ shorts pay`;
}

function daysLabel(d) {
  const n = Math.round(d);
  return n <= 1 ? 'UNLOCK TOMORROW' : `UNLOCK IN ${n} DAYS`;
}

function buildAlertMessage(s, { timezone }) {
  const b = (t) => `<b>${t}</b>`;
  const sym = escapeHtml(s.symbol);
  const recips = s.recipients.map((r) => `${escapeHtml(r.label)} ${r.share.toFixed(0)}%`).join(', ');
  const perpLinks = s.perps.map((p) => `<a href="${p.url}">${p.exchange}</a>`).join(' · ') || 'none';
  const oi = s.oiUsd !== null
    ? `${fmtUsd(s.oiUsd)}${s.oiToMcap !== null ? ` (${(s.oiToMcap * 100).toFixed(1)}% of mcap)` : ''}`
    : 'n/a';

  const lines = [
    `😈 ${b('Unlock short setup found!')}`,
    `└ ${daysLabel(s.daysAhead)} ⏳`,
    '',
    `${b('Token:')} ${escapeHtml(s.name)} $${sym}`,
  ];
  if (s.chain) lines.push(`${b('Blockchain:')} ${escapeHtml(s.chain)}`);
  lines.push(
    `${b('Unlock Date:')} ${escapeHtml(fmtDate(s.unlockTs, timezone))}`,
    `${b('Unlock Size:')} ${fmtAmount(s.unlockTokens)} ${sym} (${s.pctCirc.toFixed(2)}% of circ)`,
    `${b('Unlock Value:')} ${fmtUsd(s.unlockUsd)}`,
    `${b('Unlock vs 24h Vol:')} ${s.volRatio !== null ? `${s.volRatio.toFixed(1)}x` : 'n/a'}`,
    `${b('Recipients:')} ${recips || 'n/a'}`,
    `${b('Price:')} ${fmtPrice(s.price)}`,
    `${b('Price Change (24h):')} ${chg(s.chg24h)}`,
    `${b('Price Change (7d):')} ${chg(s.chg7d)}`,
    `${b('Price Change (30d):')} ${chg(s.chg30d)}`,
    `${b('Market Cap:')} ${fmtUsd(s.mcap)}`,
    `${b('Futures Vol (24h):')} ${fmtUsd(s.futuresVolume24h)}`,
    `${b('Funding:')} ${fundingLine(s.fundingRate)}`,
    `${b('Open Interest:')} ${oi}`,
    `${b('Short On:')} ${perpLinks}`,
    `${b('Squeeze Risk:')} ${s.squeezeRisk} ${RISK_EMOJI[s.squeezeRisk] || ''}`,
    `${b('Edge Score:')} ${s.score}/100 (${s.grade}) ${GRADE_EMOJI[s.grade] || ''}`,
    `${b('Short Window:')} now → ${escapeHtml(fmtShortDate(s.unlockTs, timezone))} (unlock day)`,
  );

  if (s.warnings?.length) {
    lines.push('');
    for (const w of s.warnings) lines.push(`⚠️ ${escapeHtml(w)}`);
  }

  const links = [
    `<a href="https://defillama.com/unlocks/${encodeURIComponent(s.slug)}">DefiLlama</a>`,
    s.geckoId ? `<a href="https://www.coingecko.com/en/coins/${encodeURIComponent(s.geckoId)}">CoinGecko</a>` : null,
  ].filter(Boolean).join(' · ');
  lines.push('', `🔗 ${links}`);

  return lines.join('\n');
}

function buildResultMessage(r, stats) {
  const b = (t) => `<b>${t}</b>`;
  const win = r.shortReturnPct > 0;
  const lines = [
    `📊 ${b('Unlock result')} — ${escapeHtml(r.name)} $${escapeHtml(r.symbol)}`,
    `└ ${win ? 'SHORT WORKED ✅' : 'SHORT FAILED ❌'}`,
    '',
    `${b('Price at alert:')} ${fmtPrice(r.priceAtAlert)}`,
    `${b('Price on unlock day:')} ${r.priceAtUnlock ? fmtPrice(r.priceAtUnlock) : 'n/a'}`,
    `${b(`Price ${r.daysAfter}d after:`)} ${fmtPrice(r.priceAfter)}`,
    `${b('Short return (alert → unlock):')} ${r.returnToUnlockPct !== null ? fmtPct(r.returnToUnlockPct) : 'n/a'}`,
    `${b(`Short return (alert → +${r.daysAfter}d):`)} ${fmtPct(r.shortReturnPct)}`,
    `${b('Edge Score was:')} ${r.score}/100 (${r.grade})`,
  ];
  if (stats && stats.count) {
    lines.push(
      '',
      `${b('All tracked alerts:')} ${stats.count}`,
      `${b('Win rate (to unlock day):')} ${stats.winRate.toFixed(0)}%`,
      `${b('Avg short return (to unlock day):')} ${fmtPct(stats.avgReturn)}`,
    );
  }
  lines.push('', '<i>Returns are before fees, funding and leverage.</i>');
  return lines.join('\n');
}

module.exports = { buildAlertMessage, buildResultMessage };
