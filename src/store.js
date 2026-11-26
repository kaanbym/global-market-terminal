import { MARKETS } from './markets.js';

const HL_REST = 'https://api.hyperliquid.xyz/info';
const HL_WS = 'wss://api.hyperliquid.xyz/ws';
const WATCH_KEY = 'mt-watchlist-v1';
const SNAP_KEY = 'mt-snapshots-v1';
const WINDOWS_MIN = [15, 30, 60, 240];

function num(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function sameNum(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  const eps = Math.max(1e-9, Math.abs(a) * 1e-8);
  return Math.abs(a - b) <= eps;
}

function emptyQuote() {
  return {
    mark: null,
    mid: null,
    oracle: null,
    prev: null,
    funding: null,
    oi: null,
    vol: null,
    quoteAt: 0,
    flash: null,
    flashUntil: 0,
    wsMarkAt: 0,
    maxLeverage: null,
    isolated: false,
    sourceLabel: '',
  };
}

function emptyMt() {
  return {
    fund: { 15: null, 30: null, 60: null, 240: null },
    oiPct: { 15: null, 30: null, 60: null, 240: null },
    oiVal: { 15: null, 30: null, 60: null, 240: null },
  };
}

function readWatchlist() {
  try {
    const raw = localStorage.getItem(WATCH_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? [...new Set(arr.filter((x) => typeof x === 'string'))] : [];
  } catch {
    return [];
  }
}

function saveWatchlist(coins) {
  try {
    localStorage.setItem(WATCH_KEY, JSON.stringify(coins));
  } catch {}
}

function loadLocalSnaps() {
  try {
    const raw = localStorage.getItem(SNAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveLocalSnaps(snaps) {
  try {
    localStorage.setItem(SNAP_KEY, JSON.stringify(snaps));
  } catch {}
}

function initialState() {
  return {
    status: 'loading',
    spotStatus: 'loading',
    detail: '',
    ready: false,
    candlesReady: false,
    quotes: {},
    sparks: {},
    base2d: {},
    priceMt: {}, // { [id]: { 15, 30, 60, 240 } } base prices from 15m candles
    mt: {}, // multi-timeframe { [id]: { fund: {15,30,60,240,avg24h}, oiPct: {15,30,60,240} } }
    present: {},
    apiCoin: {},
    omitted: [],
    catalog: [],
    watchlist: [],
    snapCount: 0,
    snapSpanMin: 0,
  };
}

let state = initialState();
const listeners = new Set();
let notifyTimer = 0;

function scheduleNotify() {
  if (notifyTimer) return;
  notifyTimer = window.setTimeout(() => {
    notifyTimer = 0;
    for (const fn of listeners) fn();
  }, 160);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  return state;
}

const refreshHandlers = new Set();
let watchOps = null;
let refCount = 0;
let stopEngine = null;
let stopDelay = 0;

export function mountStore() {
  refCount += 1;
  if (stopDelay) {
    window.clearTimeout(stopDelay);
    stopDelay = 0;
  }
  if (!stopEngine) {
    stopEngine = startEngine();
  }
  return () => {
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0) {
      stopDelay = window.setTimeout(() => {
        stopDelay = 0;
        if (refCount === 0 && stopEngine) {
          stopEngine();
          stopEngine = null;
        }
      }, 150);
    }
  };
}

export function addWatchCoin(coin) {
  watchOps?.add(coin);
}

export function removeWatchId(id) {
  watchOps?.remove(id);
}

export function triggerRefresh() {
  for (const fn of refreshHandlers) fn();
}

function startEngine() {
  let dead = false;
  let ws = null;
  let backoff = 500;
  let fetchingRest = false;
  let lastRestAt = 0;
  let lastWsAt = 0;
  let wsReady = false;
  let wsQueue = [];
  let wsLive = false;
  let catalogLoaded = false;

  const coinToId = new Map();
  const dexUniverse = new Map();
  const latestCtx = new Map();
  const catalogMap = new Map();
  const seenIds = new Set();
  const timers = [];
  const baseById = new Map(MARKETS.map((m) => [m.id, m]));

  // Rolling snapshots per market id: Array<{ t: number, f: number|null, oi: number|null }>
  const snapHistory = loadLocalSnaps();
  // Funding history from Hyperliquid fundingHistory endpoint: { [id]: { 60: number|null, 240: number|null } }
  const hlFundingHist = {};

  function computeMtForId(id, now) {
    const q = state.quotes[id];
    const out = emptyMt();
    const curOiUsd = q?.oi != null && q?.mark != null ? q.oi * q.mark : null;
    const list = snapHistory[id] || [];

    for (const mins of WINDOWS_MIN) {
      const target = now - mins * 60_000;
      const maxTolerance = Math.max(5 * 60_000, mins * 60_000 * 0.45);
      let best = null;
      let bestDiff = Infinity;
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const pt = list[i];
        const diff = Math.abs(pt.t - target);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = pt;
        }
      }
      if (best && bestDiff <= maxTolerance) {
        if (best.f != null) out.fund[mins] = best.f * 24 * 365;
        if (best.oi != null && best.oi > 0 && curOiUsd != null) {
          out.oiPct[mins] = (curOiUsd - best.oi) / best.oi;
          out.oiVal[mins] = best.oi;
        }
      }
    }

    // Backfill 60m, 240m, and 24h avg funding from Hyperliquid fundingHistory
    const fh = hlFundingHist[id];
    if (fh) {
      if (out.fund[60] == null && fh[60] != null) out.fund[60] = fh[60] * 24 * 365;
      if (out.fund[240] == null && fh[240] != null) out.fund[240] = fh[240] * 24 * 365;
      if (fh.avg24h != null) out.fund.avg24h = fh.avg24h * 24 * 365;
    }

    return out;
  }

  function recomputeAllMt() {
    const now = Date.now();
    const nextMt = {};
    const allSpecs = [...MARKETS, ...state.watchlist];
    let maxPts = 0;
    let maxSpanMin = 0;
    for (const spec of allSpecs) {
      if (spec.kind === 'tradfi' || spec.kind === 'spot') continue;
      nextMt[spec.id] = computeMtForId(spec.id, now);
      const arr = snapHistory[spec.id] || [];
      if (arr.length > maxPts) maxPts = arr.length;
      if (arr.length >= 2) {
        const span = Math.round((now - arr[0].t) / 60_000);
        if (span > maxSpanMin) maxSpanMin = span;
      }
    }
    state = { ...state, mt: nextMt, snapCount: maxPts, snapSpanMin: maxSpanMin };
  }

  function recordLocalSnapshots() {
    const now = Date.now();
    const cutoff = now - 5 * 3600_000; // keep 5h rolling
    let changed = false;

    for (const spec of [...MARKETS, ...state.watchlist]) {
      if (spec.kind === 'tradfi' || spec.kind === 'spot') continue;
      const q = state.quotes[spec.id];
      if (!q || (q.funding == null && q.oi == null)) continue;
      const oiUsd = q.oi != null && q.mark != null ? q.oi * q.mark : null;
      const arr = snapHistory[spec.id] || [];
      const last = arr[arr.length - 1];
      if (!last || now - last.t >= 55_000) {
        arr.push({ t: now, f: q.funding, oi: oiUsd });
        while (arr.length > 0 && arr[0].t < cutoff) arr.shift();
        snapHistory[spec.id] = arr;
        changed = true;
      }
    }
    if (changed) {
      saveLocalSnaps(snapHistory);
      recomputeAllMt();
      scheduleNotify();
    }
  }

  async function mergeServerSnapshots() {
    try {
      const res = await fetch('/api/snapshots', { signal: AbortSignal.timeout(8000) });
      if (!res.ok || dead) return;
      const data = await res.json();
      if (!data || !data.history || dead) return;
      const cutoff = Date.now() - 5 * 3600_000;
      for (const [id, pts] of Object.entries(data.history)) {
        if (!Array.isArray(pts) || pts.length === 0) continue;
        const existing = snapHistory[id] || [];
        const byMin = new Map();
        for (const p of existing) byMin.set(Math.floor(p.t / 60_000), p);
        for (const p of pts) byMin.set(Math.floor(p.t / 60_000), p);
        const merged = [...byMin.values()].filter((p) => p.t >= cutoff).sort((a, b) => a.t - b.t);
        snapHistory[id] = merged;
      }
      saveLocalSnaps(snapHistory);
      recomputeAllMt();
      scheduleNotify();
    } catch {
      // Static mode without server snapshots — client-side snapshots still work
    }
  }

  function applyQuote(id, ctx, source) {
    if (!['markPx', 'midPx', 'oraclePx', 'prevDayPx', 'funding', 'openInterest', 'dayNtlVlm'].some((k) => k in ctx)) {
      return;
    }
    const prev = state.quotes[id] ?? emptyQuote();
    const next = { ...prev };
    const skipMark = source === 'rest' && wsLive && prev.wsMarkAt > 0;

    if ('markPx' in ctx && !skipMark) {
      const m = num(ctx.markPx);
      if (m != null) {
        if (seenIds.has(id) && prev.mark != null && !sameNum(prev.mark, m)) {
          next.flash = m > prev.mark ? 'up' : 'down';
          next.flashUntil = Date.now() + 700;
        }
        if (!sameNum(prev.mark, m)) {
          next.quoteAt = Date.now();
        }
        next.mark = m;
      }
    }
    if ('midPx' in ctx && !skipMark) {
      next.mid = ctx.midPx == null ? null : num(ctx.midPx);
    }
    if ('oraclePx' in ctx) {
      const o = num(ctx.oraclePx);
      if (o != null) {
        if (!sameNum(prev.oracle, o)) {
          next.quoteAt = next.quoteAt || Date.now();
          if (prev.oracle != null) next.quoteAt = Date.now();
        }
        next.oracle = o;
      }
    }
    if ('prevDayPx' in ctx) {
      const p = num(ctx.prevDayPx);
      if (p != null) next.prev = p;
    }
    if ('funding' in ctx) {
      const f = num(ctx.funding);
      if (f != null) next.funding = f;
    }
    if ('openInterest' in ctx) {
      const o = num(ctx.openInterest);
      if (o != null) next.oi = o;
    }
    if ('dayNtlVlm' in ctx) {
      const v = num(ctx.dayNtlVlm);
      if (v != null) next.vol = v;
    }
    if (ctx.sourceLabel) next.sourceLabel = ctx.sourceLabel;

    if (source === 'ws' && ('markPx' in ctx || 'midPx' in ctx)) {
      next.wsMarkAt = Date.now();
    }
    if (!next.quoteAt && next.mark != null) {
      next.quoteAt = Date.now();
    }
    seenIds.add(id);
    state = { ...state, quotes: { ...state.quotes, [id]: next } };
  }

  function addOmitted(spec, reason) {
    if (state.omitted.some((x) => x.id === spec.id)) return;
    state = {
      ...state,
      omitted: [...state.omitted, { id: spec.id, coin: spec.coin, name: spec.name, reason }],
    };
  }

  async function postHl(body) {
    const payload = JSON.stringify(body);
    try {
      const res = await fetch('/api/hl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return await res.json();
    } catch {
      // Fallback to direct Hyperliquid API if local/Vercel proxy is unavailable
    }
    const res = await fetch(HL_REST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Hyperliquid HTTP ${res.status}`);
    return await res.json();
  }

  function dexLabelFor(dex) {
    return dex === '' ? 'Hype' : dex === 'spot' ? 'Spot' : dex;
  }

  function syncCatalog() {
    state = { ...state, catalog: [...catalogMap.values()] };
  }

  function registerPresent(spec, coin, uniItem) {
    coinToId.set(coin, spec.id);
    const prev = state.quotes[spec.id] ?? emptyQuote();
    state = {
      ...state,
      present: { ...state.present, [spec.id]: true },
      apiCoin: { ...state.apiCoin, [spec.id]: coin },
      quotes: {
        ...state.quotes,
        [spec.id]: {
          ...prev,
          maxLeverage: uniItem?.maxLeverage ?? prev.maxLeverage,
          isolated: !!(
            uniItem?.onlyIsolated ||
            uniItem?.marginMode === 'noCross' ||
            uniItem?.marginMode === 'strictIsolated' ||
            prev.isolated
          ),
        },
      },
    };
  }

  function ingestPerpDex(dex, meta, ctxs) {
    const names = meta.universe.map((u) => u.name);
    dexUniverse.set(dex, names);

    for (const [k, v] of catalogMap) {
      if (v.kind === 'perp' && v.dex === dex) catalogMap.delete(k);
    }

    for (let i = 0; i < meta.universe.length; i += 1) {
      const u = meta.universe[i];
      if (!u) continue;
      const ctx = ctxs[i];
      if (ctx) latestCtx.set(u.name, ctx);
      const id = coinToId.get(u.name);
      if (id && ctx) applyQuote(id, ctx, 'rest');
      if (u.isDelisted) continue;
      const ticker = u.name.includes(':') ? u.name.slice(u.name.indexOf(':') + 1) : u.name;
      const dl = dexLabelFor(dex);
      catalogMap.set(u.name, {
        coin: u.name,
        dex,
        dexLabel: dl,
        ticker,
        name: ticker,
        kind: 'perp',
        ref: ticker,
        search: [ticker, u.name, dl, dex || 'hype', 'perp'].join(' ').toLowerCase(),
        maxLeverage: u.maxLeverage ?? null,
        isolated: !!(u.onlyIsolated || u.marginMode === 'noCross' || u.marginMode === 'strictIsolated'),
      });
    }

    for (const spec of MARKETS) {
      if (spec.kind !== 'perp' || spec.dex !== dex) continue;
      const idx = names.indexOf(spec.coin);
      if (idx < 0) {
        addOmitted(spec, `dex "${dex || 'native'}" üzerinde bulunamadı`);
        continue;
      }
      const uni = meta.universe[idx];
      if (uni?.isDelisted) {
        addOmitted(spec, 'delisted');
        continue;
      }
      registerPresent(spec, spec.coin, uni);
      const ctx = ctxs[idx];
      if (ctx) applyQuote(spec.id, ctx, 'rest');
    }
  }

  function ingestSpot(spotMeta, spotCtxs) {
    for (const [k, v] of catalogMap) {
      if (v.kind === 'spot') catalogMap.delete(k);
    }
    const tokens = new Map(spotMeta.tokens.map((t) => [t.index, t]));
    const ctxMap = new Map();
    spotCtxs.forEach((c, idx) => {
      if (c?.coin) ctxMap.set(c.coin, c);
      else ctxMap.set(`@${idx}`, c);
    });
    for (const u of spotMeta.universe) {
      const base = tokens.get(u.tokens[0] ?? -1);
      const quote = tokens.get(u.tokens[1] ?? -1);
      const ctx = ctxMap.get(u.name) ?? spotCtxs[u.index];
      if (ctx) latestCtx.set(u.name, ctx);
      const id = coinToId.get(u.name);
      if (id && ctx) applyQuote(id, ctx, 'rest');
      if (!base || !quote) continue;
      const pair = `${base.name}/${quote.name}`;
      catalogMap.set(u.name, {
        coin: u.name,
        dex: 'spot',
        dexLabel: 'Spot',
        ticker: base.name,
        name: pair,
        kind: 'spot',
        ref: quote.name,
        search: [base.name, quote.name, pair, u.name, 'spot'].join(' ').toLowerCase(),
        maxLeverage: null,
        isolated: false,
      });
    }
  }

  function activeCoinsSet() {
    const set = new Set();
    for (const m of MARKETS) {
      if (state.present[m.id]) set.add(state.apiCoin[m.id] ?? m.coin);
    }
    for (const w of state.watchlist) {
      set.add(state.apiCoin[w.id] ?? w.coin);
    }
    return set;
  }

  function addCatalogItem(item) {
    if (activeCoinsSet().has(item.coin)) return;
    const spec = {
      id: `wl:${item.coin}`,
      coin: item.coin,
      dex: item.dex,
      ticker: item.ticker,
      dexLabel: item.dexLabel,
      name: item.name,
      ref: item.ref,
      group: 'watch',
      kind: item.kind,
    };
    const q = emptyQuote();
    q.maxLeverage = item.maxLeverage;
    q.isolated = item.isolated;
    state = {
      ...state,
      watchlist: [...state.watchlist, spec],
      present: { ...state.present, [spec.id]: true },
      apiCoin: { ...state.apiCoin, [spec.id]: item.coin },
      quotes: { ...state.quotes, [spec.id]: q },
    };
    coinToId.set(item.coin, spec.id);
    const ctx = latestCtx.get(item.coin);
    if (ctx) applyQuote(spec.id, ctx, 'rest');
    saveWatchlist(state.watchlist.map((w) => w.coin));
    scheduleNotify();
    if (state.ready) {
      loadCandlesFor([spec]);
      loadFundingHistoryFor([spec]);
    }
  }

  function restoreWatchlist() {
    for (const coin of readWatchlist()) {
      const item = catalogMap.get(coin);
      if (item) addCatalogItem(item);
    }
  }

  function addByCoin(coin) {
    const item = catalogMap.get(coin);
    if (item) addCatalogItem(item);
  }

  function removeById(id) {
    const spec = state.watchlist.find((w) => w.id === id);
    if (!spec) return;
    const coin = state.apiCoin[spec.id] ?? spec.coin;
    if (coinToId.get(coin) === spec.id) coinToId.delete(coin);
    const quotes = { ...state.quotes };
    const present = { ...state.present };
    const apiCoin = { ...state.apiCoin };
    const sparks = { ...state.sparks };
    const base2d = { ...state.base2d };
    const mt = { ...state.mt };
    delete quotes[spec.id];
    delete present[spec.id];
    delete apiCoin[spec.id];
    delete sparks[spec.id];
    delete base2d[spec.id];
    delete mt[spec.id];
    seenIds.delete(spec.id);
    state = {
      ...state,
      quotes,
      present,
      apiCoin,
      sparks,
      base2d,
      mt,
      watchlist: state.watchlist.filter((w) => w.id !== spec.id),
    };
    saveWatchlist(state.watchlist.map((w) => w.coin));
    scheduleNotify();
  }

  async function loadExtendedCatalog() {
    try {
      const dexs = await postHl({ type: 'perpDexs' });
      if (dead) return;
      const core = new Set(['', 'xyz', 'io']);
      const extraDexs = [...new Set(dexs.filter((d) => d?.name && !core.has(d.name)).map((d) => d.name))];
      const [extraPerps, spotRes] = await Promise.all([
        Promise.all(
          extraDexs.map(async (dex) => {
            try {
              const [meta, ctxs] = await postHl({ type: 'metaAndAssetCtxs', dex });
              return { dex, meta, ctxs };
            } catch {
              return null;
            }
          })
        ),
        postHl({ type: 'spotMetaAndAssetCtxs' }).catch(() => null),
      ]);
      if (dead) return;
      for (const r of extraPerps) {
        if (r?.meta && r?.ctxs) ingestPerpDex(r.dex, r.meta, r.ctxs);
      }
      if (spotRes) ingestSpot(spotRes[0], spotRes[1]);
      syncCatalog();
      restoreWatchlist();
      scheduleNotify();
    } catch {
      // Non-critical extended catalog failure
    }
  }

  async function initialHlLoad() {
    const coreDexs = ['', 'xyz', 'io'];
    const perpResults = await Promise.all(
      coreDexs.map(async (dex) => {
        try {
          const [meta, ctxs] = await postHl({ type: 'metaAndAssetCtxs', dex });
          return { dex, meta, ctxs, error: '' };
        } catch (err) {
          return { dex, meta: null, ctxs: null, error: err instanceof Error ? err.message : 'failed' };
        }
      })
    );
    if (dead) return;

    let anyOk = false;
    for (const r of perpResults) {
      if (r.meta && r.ctxs) {
        anyOk = true;
        ingestPerpDex(r.dex, r.meta, r.ctxs);
      } else {
        for (const spec of MARKETS) {
          if (spec.kind === 'perp' && spec.dex === r.dex) {
            addOmitted(spec, r.error || 'dex request failed');
          }
        }
      }
    }
    if (!anyOk) throw new Error('Hyperliquid dex verileri alınamadı');

    syncCatalog();
    if (!catalogLoaded) {
      catalogLoaded = true;
      restoreWatchlist();
      loadExtendedCatalog();
    }
  }

  async function refreshHlOnly() {
    const neededDexs = new Set();
    let needSpot = false;
    for (const spec of [...MARKETS, ...state.watchlist]) {
      if (!state.present[spec.id] || spec.kind === 'tradfi') continue;
      if (spec.kind === 'spot') needSpot = true;
      else neededDexs.add(spec.dex);
    }
    const perpResults = await Promise.all(
      [...neededDexs].map(async (dex) => {
        const [meta, ctxs] = await postHl({ type: 'metaAndAssetCtxs', dex });
        return { dex, meta, ctxs };
      })
    );
    const spot = needSpot ? await postHl({ type: 'spotMetaAndAssetCtxs' }) : null;
    if (dead) return;
    for (const r of perpResults) ingestPerpDex(r.dex, r.meta, r.ctxs);
    if (spot) ingestSpot(spot[0], spot[1]);
    syncCatalog();
  }

  async function pollHlRest() {
    if (fetchingRest || dead) return;
    fetchingRest = true;
    try {
      if (catalogLoaded) await refreshHlOnly();
      else await initialHlLoad();
      if (dead) return;
      lastRestAt = Date.now();
      state = {
        ...state,
        ready: true,
        status: wsLive ? 'live' : state.status === 'error' || state.status === 'loading' ? 'polling' : state.status,
        detail: '',
      };
      recordLocalSnapshots();
      recomputeAllMt();
      scheduleNotify();
    } catch (err) {
      if (dead) return;
      const msg = err instanceof Error ? err.message : 'Request failed';
      state = state.ready
        ? { ...state, detail: `Yenileme hatası: ${msg}` }
        : { ...state, status: 'error', detail: msg };
      scheduleNotify();
    } finally {
      if (!dead) fetchingRest = false;
    }
  }

  // Group 3: Classic Spot & Futures via /api/spot
  async function pollClassicSpot() {
    try {
      const res = await fetch('/api/spot', { signal: AbortSignal.timeout(12_000) });
      if (!res.ok) throw new Error(`Spot API HTTP ${res.status}`);
      const payload = await res.json();
      if (dead || !payload?.markets) return;

      for (const spec of MARKETS) {
        if (spec.kind !== 'tradfi') continue;
        const m = payload.markets[spec.id];
        if (!m || m.price == null) continue;
        state = {
          ...state,
          present: { ...state.present, [spec.id]: true },
          apiCoin: { ...state.apiCoin, [spec.id]: spec.coin },
        };
        applyQuote(
          spec.id,
          {
            markPx: m.price,
            oraclePx: m.refPrice ?? m.price,
            prevDayPx: m.prevClose,
            dayNtlVlm: m.volumeUsd ?? null,
            sourceLabel: m.source || '',
          },
          'spot-api'
        );
        if (Array.isArray(m.spark) && m.spark.length > 1) {
          state = {
            ...state,
            sparks: { ...state.sparks, [spec.id]: m.spark },
            base2d: { ...state.base2d, [spec.id]: m.base2d ?? null },
          };
        }
      }
      state = { ...state, spotStatus: 'live', ready: true };
      scheduleNotify();
    } catch (err) {
      if (dead) return;
      state = { ...state, spotStatus: 'error' };
      scheduleNotify();
    }
  }

  function parseCandles(candles, now) {
    const t48 = now - 172_800_000;
    const t24 = now - 86_400_000;
    let base = null;
    const spark = [];
    const priceMt = { 15: null, 30: null, 60: null, 240: null };
    for (const c of candles) {
      const close = Number(c.c);
      if (!Number.isFinite(close)) continue;
      if (c.t <= t48) base = close;
      if (c.t >= t24) spark.push(close);
      for (const mins of WINDOWS_MIN) {
        if (c.t <= now - mins * 60_000) priceMt[mins] = close;
      }
    }
    return { spark, base, priceMt };
  }

  async function loadCandlesFor(specs) {
    const hlSpecs = specs.filter((s) => s.kind !== 'tradfi');
    if (hlSpecs.length === 0) return;
    let cursor = 0;

    async function worker() {
      while (cursor < hlSpecs.length) {
        const spec = hlSpecs[cursor++];
        if (!spec || dead) return;
        const coin = state.apiCoin[spec.id] ?? spec.coin;
        let parsed = null;
        for (let attempt = 0; attempt < 3 && !parsed; attempt += 1) {
          try {
            const now = Date.now();
            const raw = await postHl({
              type: 'candleSnapshot',
              req: { coin, interval: '15m', startTime: now - 180_000_000, endTime: now },
            });
            if (dead) return;
            if (!Array.isArray(raw)) throw new Error('bad candle payload');
            parsed = parseCandles(raw, now);
          } catch {
            if (attempt < 2) await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
          }
        }
        if (dead) return;
        parsed ??= { spark: [], base: null, priceMt: {} };
        state = {
          ...state,
          sparks: { ...state.sparks, [spec.id]: parsed.spark },
          base2d: { ...state.base2d, [spec.id]: parsed.base },
          priceMt: { ...state.priceMt, [spec.id]: parsed.priceMt },
        };
        scheduleNotify();
        await new Promise((r) => setTimeout(r, 35));
      }
    }

    const workers = Math.min(4, Math.max(1, hlSpecs.length));
    await Promise.all(Array.from({ length: workers }, () => worker()));
    if (!dead) {
      state = { ...state, candlesReady: true };
      scheduleNotify();
    }
  }

  async function loadFundingHistoryFor(specs) {
    const perpSpecs = specs.filter((s) => s.kind === 'perp');
    if (perpSpecs.length === 0) return;
    let cursor = 0;

    async function worker() {
      while (cursor < perpSpecs.length) {
        const spec = perpSpecs[cursor++];
        if (!spec || dead) return;
        const coin = state.apiCoin[spec.id] ?? spec.coin;
        try {
          const now = Date.now();
          const hist = await postHl({
            type: 'fundingHistory',
            coin,
            startTime: now - 24 * 3600_000,
          });
          if (dead || !Array.isArray(hist) || hist.length === 0) continue;
          const sorted = hist.slice().sort((a, b) => a.time - b.time);
          const r60 = num(sorted[sorted.length - 1]?.fundingRate);
          const idx240 = Math.max(0, sorted.length - 4);
          const r240 = num(sorted[idx240]?.fundingRate);
          const rates = sorted.map((x) => num(x.fundingRate)).filter((x) => x != null);
          const avg24h = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
          hlFundingHist[spec.id] = { 60: r60, 240: r240, avg24h };
        } catch {
          // ignore individual coin funding history errors
        }
        await new Promise((r) => setTimeout(r, 30));
      }
    }

    const workers = Math.min(4, Math.max(1, perpSpecs.length));
    await Promise.all(Array.from({ length: workers }, () => worker()));
    if (!dead) {
      recomputeAllMt();
      scheduleNotify();
    }
  }

  // WebSocket deflate-raw decoding (same protocol as Hyperliquid public WS)
  async function decodePayload(data) {
    if (typeof data !== 'string') return data;
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const text = await new Response(stream).text();
    return JSON.parse(text);
  }

  let wsChain = Promise.resolve();
  function enqueueWs(channel, data) {
    wsChain = wsChain.then(() => handleWs(channel, data)).catch(() => {});
  }

  async function handleWs(channel, data) {
    if (!wsReady) {
      wsQueue.push({ channel, data });
      if (wsQueue.length > 80) wsQueue.shift();
      return;
    }
    try {
      const decoded = await decodePayload(data);
      if (dead) return;
      if (channel === 'fastAssetCtxs' && decoded && typeof decoded === 'object') {
        for (const [coin, ctx] of Object.entries(decoded)) {
          const id = coinToId.get(coin);
          if (id && ctx && typeof ctx === 'object') applyQuote(id, ctx, 'ws');
        }
      } else if (channel === 'pac' && Array.isArray(decoded)) {
        for (const item of decoded) {
          if (!Array.isArray(item) || item.length < 2) continue;
          const dex = String(item[0] ?? '');
          const ctxs = item[1];
          const names = dexUniverse.get(dex);
          if (names && Array.isArray(ctxs) && ctxs.length === names.length) {
            for (let i = 0; i < ctxs.length; i += 1) {
              const id = coinToId.get(names[i] ?? '');
              if (id && ctxs[i]) applyQuote(id, ctxs[i], 'ws');
            }
          }
        }
      } else if (channel === 'sac' && decoded && typeof decoded === 'object') {
        for (const [coin, ctx] of Object.entries(decoded)) {
          const id = coinToId.get(coin);
          if (id && ctx) applyQuote(id, ctx, 'ws');
        }
      }
      lastWsAt = Date.now();
      wsLive = true;
      if (state.status !== 'live') state = { ...state, status: 'live' };
      scheduleNotify();
    } catch {
      // ignore malformed frame; REST polling covers fallback
    }
  }

  function flushWsQueue() {
    const items = wsQueue.splice(0, wsQueue.length);
    for (const item of items) enqueueWs(item.channel, item.data);
  }

  function connectWs() {
    if (dead) return;
    try {
      ws = new WebSocket(HL_WS);
    } catch {
      scheduleReconnect();
      return;
    }
    const sock = ws;
    sock.onopen = () => {
      if (dead || sock !== ws) return;
      backoff = 500;
      const sub = (s) => sock.send(JSON.stringify({ method: 'subscribe', subscription: s }));
      sub({ type: 'fastAssetCtxs' });
      sub({ type: 'pac' });
      sub({ type: 'sac' });
      sock.send(JSON.stringify({ method: 'ping' }));
    };
    sock.onmessage = (ev) => {
      if (dead || sock !== ws) return;
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!msg.channel || msg.channel === 'pong' || msg.channel === 'subscriptionResponse') return;
      if (msg.channel === 'error') {
        state = { ...state, detail: `WS: ${String(msg.data ?? 'error')}` };
        scheduleNotify();
      } else {
        enqueueWs(msg.channel, msg.data);
      }
    };
    sock.onclose = () => {
      if (dead || sock !== ws) return;
      wsLive = false;
      if (state.ready && state.status !== 'error') {
        state = { ...state, status: 'reconnecting' };
        scheduleNotify();
      }
      scheduleReconnect();
    };
    sock.onerror = () => sock.close();
  }

  function scheduleReconnect() {
    if (dead) return;
    const wait = backoff;
    backoff = Math.min(15_000, backoff * 2);
    timers.push(window.setTimeout(connectWs, wait));
  }

  function activeSpecs() {
    return [...MARKETS, ...state.watchlist].filter((s) => state.present[s.id]);
  }

  // Boot sequence
  (async () => {
    connectWs();
    await Promise.all([pollHlRest(), pollClassicSpot(), mergeServerSnapshots()]);
    if (dead) return;
    wsReady = true;
    flushWsQueue();
    const specs = activeSpecs();
    await Promise.all([loadCandlesFor(specs), loadFundingHistoryFor(specs)]);
  })();

  // Periodic maintenance timers
  timers.push(
    window.setInterval(() => {
      if (dead) return;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ method: 'ping' }));
      }
      if (wsLive && lastWsAt && Date.now() - lastWsAt > 14_000) {
        wsLive = false;
        ws?.close();
      }
    }, 15_000)
  );

  timers.push(
    window.setInterval(() => {
      if (dead) return;
      const interval = wsLive ? 45_000 : 3_000;
      if (Date.now() - lastRestAt >= interval) pollHlRest();
    }, 1_500)
  );

  // Live poll Group 3 (Classic Spot & Futures) every 5s
  timers.push(
    window.setInterval(() => {
      if (!dead) pollClassicSpot();
    }, 5_000)
  );

  // Record 1-minute snapshots & sync server snapshots
  timers.push(
    window.setInterval(() => {
      if (!dead && state.ready) {
        recordLocalSnapshots();
        mergeServerSnapshots();
      }
    }, 60_000)
  );

  // Refresh candles & funding history every 5 min
  timers.push(
    window.setInterval(() => {
      if (!dead && state.ready) {
        const specs = activeSpecs();
        loadCandlesFor(specs);
        loadFundingHistoryFor(specs);
      }
    }, 300_000)
  );

  const manualRefresh = () => {
    if (dead) return;
    Promise.all([pollHlRest(), pollClassicSpot(), mergeServerSnapshots()]).then(() => {
      if (!dead) {
        const specs = activeSpecs();
        loadCandlesFor(specs);
        loadFundingHistoryFor(specs);
      }
    });
  };

  refreshHandlers.add(manualRefresh);
  watchOps = { add: addByCoin, remove: removeById };

  return () => {
    dead = true;
    refreshHandlers.delete(manualRefresh);
    if (watchOps?.add === addByCoin) watchOps = null;
    ws?.close();
    for (const t of timers) window.clearInterval(t);
    if (notifyTimer) {
      window.clearTimeout(notifyTimer);
      notifyTimer = 0;
    }
    state = initialState();
    seenIds.clear();
  };
}
