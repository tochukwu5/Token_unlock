// Unlock schedules from DefiLlama's free public datasets (same data as defillama.com/unlocks).
const { fetchJson, mapLimit, log } = require('../utils');

const DATASETS = 'https://defillama-datasets.llama.fi';
const DAY = 86400;

// How bearish each recipient type usually is when their tokens unlock.
// Team/insiders and private-sale investors (VCs) sold at a low cost basis → most likely to sell.
const CATEGORY_INFO = {
  insiders: { label: 'Team / Insiders', weight: 1.0 },
  privateSale: { label: 'Investors (VC)', weight: 1.0 },
  publicSale: { label: 'Public Sale', weight: 0.6 },
  airdrop: { label: 'Airdrop', weight: 0.6 },
  farming: { label: 'Farming / Rewards', weight: 0.5 },
  liquidity: { label: 'Liquidity', weight: 0.3 },
  noncirculating: { label: 'Treasury / Ecosystem', weight: 0.2 },
  other: { label: 'Other', weight: 0.4 },
};

function categoryInfo(cat) {
  return CATEGORY_INFO[cat] || CATEGORY_INFO.other;
}

async function listProtocols() {
  const list = await fetchJson(`${DATASETS}/emissionsProtocolsList`, { label: 'DefiLlama protocol list' });
  if (!Array.isArray(list)) throw new Error('Unexpected DefiLlama protocol list format');
  return list;
}

async function getProtocol(slug) {
  const res = await fetchJson(`${DATASETS}/emissions/${encodeURIComponent(slug)}`, {
    label: `DefiLlama ${slug}`, retries: 2,
  });
  // Pro API wraps the body as a JSON string; the dataset returns it directly.
  if (res && typeof res.body === 'string') return JSON.parse(res.body);
  return res?.body && typeof res.body === 'object' ? res.body : res;
}

/** Map section label (e.g. "Core Contributors") → category (e.g. "insiders"). */
function sectionToCategory(body) {
  const map = {};
  const cats = body?.categories || {};
  for (const [cat, labels] of Object.entries(cats)) {
    for (const l of labels || []) map[l] = cat;
  }
  return map;
}

function sum(arr) {
  return (Array.isArray(arr) ? arr : [arr]).reduce((a, b) => a + (Number(b) || 0), 0);
}

/**
 * Pull the cliff unlocks (one-day releases) that fall inside [fromTs, toTs].
 * Linear/streaming emissions are ignored — they don't create a single "dump day".
 * Returns allocations grouped per UTC day.
 */
function extractCliffUnlocks(body, fromTs, toTs) {
  const md = body?.metadata || {};
  const allocs = []; // { ts, recipient, category, amount }

  // 1) Best source: structured unlockEvents with named recipients
  if (Array.isArray(md.unlockEvents) && md.unlockEvents.length) {
    for (const ue of md.unlockEvents) {
      if (!(ue.timestamp >= fromTs && ue.timestamp <= toTs)) continue;
      for (const c of ue.cliffAllocations || []) {
        if (!(c.amount > 0)) continue;
        allocs.push({ ts: ue.timestamp, recipient: c.recipient || c.category, category: c.category || 'other', amount: c.amount });
      }
    }
  }

  // 2) Fallback: flat events list
  if (!allocs.length && Array.isArray(md.events)) {
    for (const ev of md.events) {
      if (!(ev.timestamp >= fromTs && ev.timestamp <= toTs)) continue;
      const type = String(ev.unlockType || '').toLowerCase();
      if (type && type !== 'cliff') continue;
      const amount = sum(ev.noOfTokens);
      if (!(amount > 0)) continue;
      allocs.push({ ts: ev.timestamp, recipient: ev.category || 'Unknown', category: ev.category || 'other', amount });
    }
  }

  // 3) Last fallback: detect one-day jumps in the documented supply chart
  if (!allocs.length && Array.isArray(body?.documentedData?.data)) {
    const secMap = sectionToCategory(body);
    for (const section of body.documentedData.data) {
      const pts = section.data || [];
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i];
        if (!(p.timestamp >= fromTs && p.timestamp <= toTs)) continue;
        const delta = (p.unlocked ?? 0) - (pts[i - 1].unlocked ?? 0);
        if (!(delta > 0)) continue;
        // compare with the typical daily release of the previous 30 points
        const prev = [];
        for (let j = Math.max(1, i - 30); j < i; j++) prev.push((pts[j].unlocked ?? 0) - (pts[j - 1].unlocked ?? 0));
        if (prev.length < 7) continue; // not enough history to tell a cliff from normal flow
        const typical = Math.max(...prev.map((v) => (v > 0 ? v : 0)));
        if (delta > typical * 5) {
          allocs.push({ ts: p.timestamp, recipient: section.label, category: secMap[section.label] || 'other', amount: delta });
        }
      }
    }
  }

  // group per UTC day
  const byDay = new Map();
  for (const a of allocs) {
    const day = Math.floor(a.ts / DAY) * DAY;
    if (!byDay.has(day)) byDay.set(day, { timestamp: a.ts, allocations: [] });
    const g = byDay.get(day);
    g.timestamp = Math.min(g.timestamp, a.ts);
    g.allocations.push({ recipient: a.recipient, category: a.category, amount: a.amount });
  }
  return [...byDay.values()].map((g) => ({
    ...g,
    totalTokens: g.allocations.reduce((s, a) => s + a.amount, 0),
  }));
}

function geckoIdOf(body) {
  if (body?.gecko_id) return body.gecko_id;
  const t = body?.metadata?.token;
  if (typeof t === 'string' && t.startsWith('coingecko:')) return t.slice('coingecko:'.length);
  return null;
}

/**
 * Scan every token DefiLlama tracks and return upcoming cliff unlocks in the window.
 * @param {object} opts { fromTs, toTs, concurrency, skip(slug)=>bool }
 */
async function getUpcomingUnlocks({ fromTs, toTs, concurrency = 4 }) {
  const slugs = await listProtocols();
  log(`DefiLlama: checking ${slugs.length} tokens for unlocks…`);
  let failed = 0;
  const results = await mapLimit(slugs, concurrency, async (slug) => {
    try {
      const body = await getProtocol(slug);
      const unlocks = extractCliffUnlocks(body, fromTs, toTs);
      if (!unlocks.length) return [];
      const geckoId = geckoIdOf(body);
      return unlocks.map((u) => ({
        slug,
        name: body.name || slug,
        geckoId,
        chain: body.chainName || body.metadata?.chain || null,
        sources: body.metadata?.sources || [],
        ...u,
      }));
    } catch (e) {
      failed++;
      if (failed <= 5) log(`  skip ${slug}: ${e.message}`);
      return [];
    }
  });
  const events = results.flat();
  log(`DefiLlama: found ${events.length} cliff unlocks in window (${failed} tokens failed to load)`);
  return events;
}

module.exports = { getUpcomingUnlocks, extractCliffUnlocks, categoryInfo, CATEGORY_INFO };
