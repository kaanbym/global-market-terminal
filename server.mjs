import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, 'dist');
const DATA_DIR = path.join(__dirname, 'data');
const SNAP_FILE = path.join(DATA_DIR, 'snapshots.json');
const PORT = Number(process.env.PORT || 4173);

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Tracked Hyperliquid perp markets for server-side rolling 15m/30m/60m/240m OI & Funding snapshots
const TRACKED_HL = [
  { id: 'xyz100', coin: 'xyz:XYZ100', dex: 'xyz' },
  { id: 'sp500', coin: 'xyz:SP500', dex: 'xyz' },
  { id: 'aapl', coin: 'xyz:AAPL', dex: 'xyz' },
  { id: 'tsla', coin: 'xyz:TSLA', dex: 'xyz' },
  { id: 'amzn', coin: 'xyz:AMZN', dex: 'xyz' },
  { id: 'meta', coin: 'xyz:META', dex: 'xyz' },
  { id: 'googl', coin: 'xyz:GOOGL', dex: 'xyz' },
  { id: 'nflx', coin: 'xyz:NFLX', dex: 'xyz' },
  { id: 'amd', coin: 'xyz:AMD', dex: 'xyz' },
  { id: 'mu', coin: 'xyz:MU', dex: 'xyz' },
  { id: 'spcx', coin: 'xyz:SPCX', dex: 'xyz' },
  { id: 'ant', coin: 'xyz:ANT', dex: 'xyz' },
  { id: 'oai', coin: 'io:OAI', dex: 'io' },
  { id: 'nvda', coin: 'xyz:NVDA', dex: 'xyz' },
  { id: 'intc', coin: 'xyz:INTC', dex: 'xyz' },
  { id: 'asml', coin: 'xyz:ASML', dex: 'xyz' },
  { id: 'pltr', coin: 'xyz:PLTR', dex: 'xyz' },
  { id: 'crwd', coin: 'xyz:CRWD', dex: 'xyz' },
  { id: 'msft', coin: 'xyz:MSFT', dex: 'xyz' },
  { id: 'qcom', coin: 'xyz:QCOM', dex: 'xyz' },
  { id: 'gold', coin: 'xyz:GOLD', dex: 'xyz' },
  { id: 'brent', coin: 'xyz:BRENTOIL', dex: 'xyz' },
  { id: 'eur', coin: 'xyz:EUR', dex: 'xyz' },
  { id: 'gbp', coin: 'xyz:GBP', dex: 'xyz' },
  { id: 'jpy', coin: 'xyz:JPY', dex: 'xyz' },
  { id: 'btc', coin: 'BTC', dex: '' },
  { id: 'eth', coin: 'ETH', dex: '' },
];

// Load persisted snapshots
let snapHistory = {};
try {
  if (fs.existsSync(SNAP_FILE)) {
    snapHistory = JSON.parse(fs.readFileSync(SNAP_FILE, 'utf8'));
  }
} catch {
  snapHistory = {};
}

async function collectHlSnapshots() {
  const dexs = ['', 'xyz', 'io'];
  const now = Date.now();
  const cutoff = now - 5 * 3600_000;
  try {
    const results = await Promise.all(
      dexs.map(async (dex) => {
        const res = await fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'metaAndAssetCtxs', dex }),
          signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) return null;
        const [meta, ctxs] = await res.json();
        return { dex, meta, ctxs };
      })
    );

    const ctxByCoin = new Map();
    for (const r of results) {
      if (!r?.meta?.universe || !Array.isArray(r.ctxs)) continue;
      r.meta.universe.forEach((u, i) => {
        if (u?.name && r.ctxs[i]) ctxByCoin.set(u.name, r.ctxs[i]);
      });
    }

    for (const t of TRACKED_HL) {
      const ctx = ctxByCoin.get(t.coin);
      if (!ctx) continue;
      const mark = Number(ctx.markPx);
      const oi = Number(ctx.openInterest);
      const funding = Number(ctx.funding);
      const oiUsd = Number.isFinite(mark) && Number.isFinite(oi) ? oi * mark : null;
      const f = Number.isFinite(funding) ? funding : null;
      const arr = snapHistory[t.id] || [];
      arr.push({ t: now, f, oi: oiUsd });
      while (arr.length > 0 && arr[0].t < cutoff) arr.shift();
      snapHistory[t.id] = arr;
    }

    fs.writeFileSync(SNAP_FILE, JSON.stringify(snapHistory));
  } catch (err) {
    console.error('[snapshots] collect error:', err.message);
  }
}

// Start background snapshot collector immediately + every 60s
collectHlSnapshots();
setInterval(collectHlSnapshots, 60_000);

// Classic Spot & Futures cache (4s TTL)
let spotCache = { at: 0, payload: null };

async function fetchYahooChart(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=15m&range=5d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketTerminal/1.0)' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Yahoo ${symbol} HTTP ${res.status}`);
  const data = await res.json();
  const r = data?.chart?.result?.[0];
  if (!r) throw new Error(`Yahoo ${symbol} empty`);

  const meta = r.meta || {};
  const ts = r.timestamp || [];
  const closes = r.indicators?.quote?.[0]?.close || [];
  const nowSec = Math.floor(Date.now() / 1000);
  const t24 = nowSec - 86400;
  const t48 = nowSec - 172800;

  const spark = [];
  let base2d = null;
  for (let i = 0; i < ts.length; i += 1) {
    const c = closes[i];
    if (c == null || !Number.isFinite(c)) continue;
    if (ts[i] <= t48) base2d = c;
    if (ts[i] >= t24) spark.push(c);
  }

  const price = meta.regularMarketPrice ?? (spark.length ? spark[spark.length - 1] : null);
  const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
  const vol = meta.regularMarketVolume ?? null;
  return {
    price,
    prevClose,
    base2d,
    spark,
    volumeUsd: vol && price ? vol * price : null,
  };
}

async function fetchSwissquoteXau() {
  try {
    const res = await fetch(
      'https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD',
      {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) return null;
    const arr = await res.json();
    const prices = arr?.[0]?.spreadProfilePrices;
    if (!Array.isArray(prices) || prices.length === 0) return null;
    const best = prices.find((p) => p.spreadProfile === 'prime') || prices[0];
    if (typeof best?.bid === 'number' && typeof best?.ask === 'number') {
      return (best.bid + best.ask) / 2;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchGoldApiXau() {
  try {
    const res = await fetch('https://api.gold-api.com/price/XAU', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const d = await res.json();
    return typeof d?.price === 'number' ? d.price : null;
  } catch {
    return null;
  }
}

async function getClassicSpot() {
  const now = Date.now();
  if (spotCache.payload && now - spotCache.at < 4000) {
    return spotCache.payload;
  }

  const [gc, dxy, brent, nq, sqXau] = await Promise.all([
    fetchYahooChart('GC=F').catch(() => null),
    fetchYahooChart('DX-Y.NYB').catch(() => null),
    fetchYahooChart('BZ=F').catch(() => null),
    fetchYahooChart('NQ=F').catch(() => null),
    fetchSwissquoteXau(),
  ]);

  let spotXau = sqXau;
  if (spotXau == null) spotXau = await fetchGoldApiXau();

  // Keep XAU/USD spot price accurate while deriving consistent prevClose/2D% without futures basis distortion
  let xauMarket = null;
  if (spotXau != null) {
    const gcDailyPct = gc?.price && gc?.prevClose ? (gc.price - gc.prevClose) / gc.prevClose : null;
    const gc2dPct = gc?.price && gc?.base2d ? (gc.price - gc.base2d) / gc.base2d : null;
    const basis = gc?.price ? spotXau - gc.price : 0;
    xauMarket = {
      price: spotXau,
      refPrice: gc?.price ?? spotXau,
      prevClose: gcDailyPct != null ? spotXau / (1 + gcDailyPct) : null,
      base2d: gc2dPct != null ? spotXau / (1 + gc2dPct) : null,
      spark: gc?.spark ? gc.spark.map((v) => v + basis) : [],
      volumeUsd: null,
      source: sqXau != null ? 'Swissquote Spot' : 'Gold-API Spot',
    };
  } else if (gc) {
    xauMarket = { ...gc, refPrice: gc.price, source: 'COMEX GC=F' };
  }

  const payload = {
    updatedAt: now,
    markets: {
      'spot-xau': xauMarket,
      'spot-dxy': dxy ? { ...dxy, refPrice: dxy.price, source: 'ICE DXY' } : null,
      'spot-brent': brent ? { ...brent, refPrice: brent.price, source: 'ICE BZ=F' } : null,
      'spot-nq1': nq ? { ...nq, refPrice: nq.price, source: 'CME NQ=F' } : null,
    },
  };

  spotCache = { at: now, payload };
  return payload;
}

// Short-lived cache for Hyperliquid REST proxy (prevents rate limiting across users)
const hlProxyCache = new Map();

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === '/api/hl' && req.method === 'POST') {
    try {
      const rawBody = await readBody(req);
      const now = Date.now();
      const cached = hlProxyCache.get(rawBody);
      if (cached && now - cached.at < 2000) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(cached.text);
        return;
      }
      const upstream = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody,
        signal: AbortSignal.timeout(15_000),
      });
      const text = await upstream.text();
      if (upstream.ok) {
        hlProxyCache.set(rawBody, { at: now, text });
        if (hlProxyCache.size > 150) {
          const oldest = hlProxyCache.keys().next().value;
          hlProxyCache.delete(oldest);
        }
      }
      res.writeHead(upstream.status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(text);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/spot') {
    try {
      const payload = await getClassicSpot();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(payload));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/snapshots') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ updatedAt: Date.now(), history: snapHistory }));
    return;
  }

  // Static files from dist/
  let filePath = path.join(DIST_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(DIST_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Build not found. Run npm run build.');
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

server.on('error', (err) => {
  console.error('Server error:', err);
});

server.listen(PORT, () => {
  console.log(`Market Terminal listening on http://localhost:${PORT}`);
});
