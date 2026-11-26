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
  return { price, prevClose, base2d, spark, volumeUsd: vol && price ? vol * price : null };
}

async function fetchSwissquoteXau() {
  try {
    const res = await fetch(
      'https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD',
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const arr = await res.json();
    const prices = arr?.[0]?.spreadProfilePrices;
    if (!Array.isArray(prices) || prices.length === 0) return null;
    const best = prices.find((p) => p.spreadProfile === 'prime') || prices[0];
    return typeof best?.bid === 'number' && typeof best?.ask === 'number' ? (best.bid + best.ask) / 2 : null;
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=4, stale-while-revalidate=10');

  const [gc, dxy, brent, nq, sqXau] = await Promise.all([
    fetchYahooChart('GC=F').catch(() => null),
    fetchYahooChart('DX-Y.NYB').catch(() => null),
    fetchYahooChart('BZ=F').catch(() => null),
    fetchYahooChart('NQ=F').catch(() => null),
    fetchSwissquoteXau(),
  ]);

  let spotXau = sqXau;
  if (spotXau == null) spotXau = await fetchGoldApiXau();

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

  res.status(200).json({
    updatedAt: Date.now(),
    markets: {
      'spot-xau': xauMarket,
      'spot-dxy': dxy ? { ...dxy, refPrice: dxy.price, source: 'ICE DXY' } : null,
      'spot-brent': brent ? { ...brent, refPrice: brent.price, source: 'ICE BZ=F' } : null,
      'spot-nq1': nq ? { ...nq, refPrice: nq.price, source: 'CME NQ=F' } : null,
    },
  });
}
