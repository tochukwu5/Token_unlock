// Renders the picture on top of each alert (like the banner in your pair alerts):
// a header with the countdown, then a black strip with the logo and 3 big stats.
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { fmtUsd, fmtPct, escapeHtml } = require('./utils');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const FONT_FILES = ['Inter_400Regular.ttf', 'Inter_600SemiBold.ttf', 'Inter_700Bold.ttf', 'Inter_800ExtraBold.ttf']
  .map((f) => path.join(FONT_DIR, f));

const W = 1200;
const H = 500;
const SPLIT = 290; // where the black strip starts

const GREEN = '#3DDC84';
const RED = '#FF4D4F';
const ORANGE = '#FF6A13';

const x = (s) => escapeHtml(s);

function colorFor(v) {
  if (v === null || v === undefined) return '#9AA0A6';
  return v < 0 ? RED : GREEN;
}

function trunc(s, n) {
  s = String(s || '');
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function statBlock(cx, label, tag, tagColor, value) {
  return `
    <text x="${cx}" y="${SPLIT + 95}" text-anchor="middle" font-family="Inter" font-weight="600" font-size="30" letter-spacing="1">
      <tspan fill="#9AA0A6">${x(label)}</tspan>${tag ? `<tspan fill="${tagColor}"> ${x(tag)}</tspan>` : ''}
    </text>
    <text x="${cx}" y="${SPLIT + 160}" text-anchor="middle" font-family="Inter" font-weight="800" font-size="54" fill="#FFFFFF">${x(value)}</text>`;
}

function logoSvg(cx, cy, r, logoDataUri, symbol) {
  const ring = `<circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="#000"/>`;
  if (logoDataUri) {
    return `${ring}
      <clipPath id="lc"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="#FFFFFF"/>
      <image href="${logoDataUri}" x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" clip-path="url(#lc)" preserveAspectRatio="xMidYMid slice"/>`;
  }
  return `${ring}
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#1A1A1A"/>
    <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-family="Inter" font-weight="800" font-size="46" fill="#FFFFFF">${x(trunc(symbol, 5))}</text>`;
}

function buildCardSvg(s, { logoDataUri, timezone }) {
  const days = Math.max(1, Math.round(s.daysAhead));
  const dateStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  }).format(new Date(s.unlockTs * 1000));
  const stamp = `${new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', month: 'short', day: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(new Date())} UTC`;

  const topRecipient = s.recipients?.[0]?.label || 'Unknown';
  const tags = [
    `${s.pctCirc.toFixed(1)}% OF CIRC`,
    trunc(topRecipient.toUpperCase(), 20),
    `EDGE ${s.grade} · ${s.score}`,
  ];

  const tagsSvg = tags.map((t, i) => `
    <rect x="${W - 330}" y="${48 + i * 44}" width="14" height="14" fill="${ORANGE}"/>
    <text x="${W - 304}" y="${61 + i * 44}" font-family="Inter" font-weight="700" font-size="22" fill="#1A1A1A" letter-spacing="1">${x(t)}</text>`).join('');

  const mcapTag = s.chg7d !== null && s.chg7d !== undefined ? `${fmtPct(s.chg7d)} 7D` : '';
  const unlockTag = `${s.pctCirc.toFixed(1)}%`;
  const volTag = s.volRatio !== null ? `${s.volRatio.toFixed(1)}x` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="top" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFF5EE"/>
      <stop offset="1" stop-color="#FFE3D3"/>
    </linearGradient>
  </defs>

  <!-- header -->
  <rect width="${W}" height="${SPLIT}" fill="url(#top)"/>
  <rect x="56" y="30" width="300" height="10" fill="#1A1A1A"/>
  <text x="56" y="104" font-family="Inter" font-weight="800" font-size="62" fill="#1A1A1A" letter-spacing="-1">Unlock in ${days} day${days === 1 ? '' : 's'}.</text>
  <text x="56" y="148" font-family="Inter" font-weight="700" font-size="32" fill="#1A1A1A">${x(trunc(s.name, 18))} · ${x(dateStr)}</text>
  <text x="300" y="232" font-family="Inter" font-weight="600" font-size="20" fill="#6B6B6B" letter-spacing="1">${x(fmtUsd(s.unlockUsd))} UNLOCKING · SHORT SETUP</text>
  <text x="${W - 60}" y="268" text-anchor="end" font-family="Inter" font-weight="700" font-size="22" fill="${ORANGE}">→ unlock / ${x(trunc(s.symbol, 10).toLowerCase())}</text>
  ${tagsSvg}

  <!-- black strip -->
  <rect y="${SPLIT}" width="${W}" height="${H - SPLIT}" fill="#000000"/>
  ${logoSvg(150, SPLIT - 20, 100, logoDataUri, s.symbol)}
  <text x="150" y="${SPLIT + 132}" text-anchor="middle" font-family="Inter" font-weight="800" font-size="38" fill="#FFFFFF">${x(trunc(s.symbol, 9))}</text>
  <text x="150" y="${SPLIT + 170}" text-anchor="middle" font-family="Inter" font-weight="400" font-size="26" fill="#BDBDBD">${x(trunc(s.symbol.toLowerCase(), 12))}</text>

  ${statBlock(470, 'MCAP', mcapTag, colorFor(s.chg7d), fmtUsd(s.mcap, { decimals: s.mcap >= 1e9 ? 2 : 1 }))}
  ${statBlock(780, 'UNLOCK', unlockTag, RED, fmtUsd(s.unlockUsd, { decimals: 1 }))}
  ${statBlock(1060, '24H VOL', volTag, ORANGE, fmtUsd(s.volume24h, { decimals: 1 }))}

  <text x="${W - 16}" y="${H - 14}" text-anchor="end" font-family="Inter" font-weight="400" font-size="16" fill="#8A8A8A">${x(stamp)}</text>
</svg>`;
}

/** @returns PNG Buffer */
function renderCard(setup, opts) {
  const svg = buildCardSvg(setup, opts);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Inter' },
  });
  return resvg.render().asPng();
}

module.exports = { renderCard, buildCardSvg };
