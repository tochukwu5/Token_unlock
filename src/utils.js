const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

/**
 * fetch + JSON with timeout and retries (handles 429 / 5xx / network errors).
 */
async function fetchJson(url, { headers = {}, retries = 3, timeoutMs = 45_000, label } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: ctrl.signal });
      if (res.status === 429 || res.status >= 500) {
        const wait = Number(res.headers.get('retry-after')) * 1000 || 2000 * (attempt + 1) ** 2;
        lastErr = new Error(`${label || url} → HTTP ${res.status}`);
        await sleep(Math.min(wait, 60_000));
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const err = new Error(`${label || url} → HTTP ${res.status} ${body.slice(0, 200)}`);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (e.status && e.status < 500 && e.status !== 429) throw e; // 4xx: don't retry
      await sleep(1500 * (attempt + 1));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

/** Run async fn over items with limited concurrency. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------- formatting ----------

/** $11K, $1.2M, $3.45B, $0.0000123 */
function fmtUsd(v, { decimals } = {}) {
  if (v === null || v === undefined || Number.isNaN(v)) return 'n/a';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(decimals ?? 2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(decimals ?? 2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(decimals ?? 1)}K`;
  return `${sign}$${abs.toFixed(decimals ?? 0)}`;
}

/** Prices can be tiny, keep significant digits. */
function fmtPrice(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return 'n/a';
  if (v >= 1000) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (v >= 1) return `$${v.toFixed(4)}`;
  if (v >= 0.01) return `$${v.toFixed(5)}`;
  return `$${v.toPrecision(4)}`;
}

/** 1.2K, 3.4M, 5.67B tokens */
function fmtAmount(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return 'n/a';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

function fmtPct(v, { sign = true, decimals = 2 } = {}) {
  if (v === null || v === undefined || Number.isNaN(v)) return 'n/a';
  const s = sign && v > 0 ? '+' : '';
  return `${s}${v.toFixed(decimals)}%`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(tsSec, timezone) {
  const d = new Date(tsSec * 1000);
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short',
  }).format(d);
  return `${date}, ${time}`;
}

function fmtShortDate(tsSec, timezone) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, day: '2-digit', month: 'short' })
    .format(new Date(tsSec * 1000));
}

module.exports = {
  sleep, log, fetchJson, mapLimit, chunk,
  fmtUsd, fmtPrice, fmtAmount, fmtPct, escapeHtml, fmtDate, fmtShortDate,
};
