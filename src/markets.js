export const GROUPS = [
  { id: 'watch', title: 'My Watchlist', badge: 'CUSTOM' },
  { id: 'tech', title: 'US Tech, AI & Indices (Hyperliquid)', badge: 'PERP' },
  { id: 'macro', title: 'Macro, FX & Crypto (Hyperliquid)', badge: 'PERP' },
  { id: 'spot', title: 'Classic Spot & Futures', badge: 'GLOBAL' },
];

export const MARKETS = [
  // ── GROUP 1: US Tech, AI & Indices (Hyperliquid) ──────────────────────────
  { id: 'xyz100', coin: 'xyz:XYZ100', dex: 'xyz', ticker: 'XYZ100', dexLabel: 'xyz', name: 'Nasdaq 100 (XYZ)', ref: 'NDX', group: 'tech', kind: 'perp' },
  { id: 'sp500', coin: 'xyz:SP500', dex: 'xyz', ticker: 'SP500', dexLabel: 'xyz', name: 'S&P 500', ref: 'SPX', group: 'tech', kind: 'perp' },
  { id: 'aapl', coin: 'xyz:AAPL', dex: 'xyz', ticker: 'AAPL', dexLabel: 'xyz', name: 'Apple', ref: 'AAPL', group: 'tech', kind: 'perp' },
  { id: 'tsla', coin: 'xyz:TSLA', dex: 'xyz', ticker: 'TSLA', dexLabel: 'xyz', name: 'Tesla', ref: 'TSLA', group: 'tech', kind: 'perp' },
  { id: 'amzn', coin: 'xyz:AMZN', dex: 'xyz', ticker: 'AMZN', dexLabel: 'xyz', name: 'Amazon', ref: 'AMZN', group: 'tech', kind: 'perp' },
  { id: 'meta', coin: 'xyz:META', dex: 'xyz', ticker: 'META', dexLabel: 'xyz', name: 'Meta', ref: 'META', group: 'tech', kind: 'perp' },
  { id: 'googl', coin: 'xyz:GOOGL', dex: 'xyz', ticker: 'GOOGL', dexLabel: 'xyz', name: 'Alphabet (Google)', ref: 'GOOGL', group: 'tech', kind: 'perp' },
  { id: 'nflx', coin: 'xyz:NFLX', dex: 'xyz', ticker: 'NFLX', dexLabel: 'xyz', name: 'Netflix', ref: 'NFLX', group: 'tech', kind: 'perp' },
  { id: 'amd', coin: 'xyz:AMD', dex: 'xyz', ticker: 'AMD', dexLabel: 'xyz', name: 'AMD', ref: 'AMD', group: 'tech', kind: 'perp' },
  { id: 'mu', coin: 'xyz:MU', dex: 'xyz', ticker: 'MU', dexLabel: 'xyz', name: 'Micron', ref: 'MU', group: 'tech', kind: 'perp' },
  { id: 'spcx', coin: 'xyz:SPCX', dex: 'xyz', ticker: 'SPCX', dexLabel: 'xyz', name: 'SpaceX', ref: 'SPCX', group: 'tech', kind: 'perp' },
  { id: 'ant', coin: 'xyz:ANT', dex: 'xyz', ticker: 'ANT', dexLabel: 'xyz', name: 'Anthropic', ref: 'ANT', group: 'tech', kind: 'perp' },
  { id: 'oai', coin: 'io:OAI', dex: 'io', ticker: 'OAI', dexLabel: 'io', name: 'OpenAI', ref: 'OAI', group: 'tech', kind: 'perp' },
  { id: 'nvda', coin: 'xyz:NVDA', dex: 'xyz', ticker: 'NVDA', dexLabel: 'xyz', name: 'Nvidia', ref: 'NVDA', group: 'tech', kind: 'perp' },
  { id: 'intc', coin: 'xyz:INTC', dex: 'xyz', ticker: 'INTC', dexLabel: 'xyz', name: 'Intel', ref: 'INTC', group: 'tech', kind: 'perp' },
  { id: 'asml', coin: 'xyz:ASML', dex: 'xyz', ticker: 'ASML', dexLabel: 'xyz', name: 'ASML', ref: 'ASML', group: 'tech', kind: 'perp' },
  { id: 'pltr', coin: 'xyz:PLTR', dex: 'xyz', ticker: 'PLTR', dexLabel: 'xyz', name: 'Palantir', ref: 'PLTR', group: 'tech', kind: 'perp' },
  { id: 'crwd', coin: 'xyz:CRWD', dex: 'xyz', ticker: 'CRWD', dexLabel: 'xyz', name: 'CrowdStrike', ref: 'CRWD', group: 'tech', kind: 'perp' },
  { id: 'msft', coin: 'xyz:MSFT', dex: 'xyz', ticker: 'MSFT', dexLabel: 'xyz', name: 'Microsoft', ref: 'MSFT', group: 'tech', kind: 'perp' },
  { id: 'qcom', coin: 'xyz:QCOM', dex: 'xyz', ticker: 'QCOM', dexLabel: 'xyz', name: 'Qualcomm', ref: 'QCOM', group: 'tech', kind: 'perp' },

  // ── GROUP 2: Macro, FX & Crypto (Hyperliquid) ─────────────────────────────
  { id: 'gold', coin: 'xyz:GOLD', dex: 'xyz', ticker: 'GOLD', dexLabel: 'xyz', name: 'Gold (HL Perp)', ref: 'XAU', group: 'macro', kind: 'perp' },
  { id: 'brent', coin: 'xyz:BRENTOIL', dex: 'xyz', ticker: 'BRENT', dexLabel: 'xyz', name: 'Brent Oil (HL Perp)', ref: 'CO', group: 'macro', kind: 'perp' },
  { id: 'eur', coin: 'xyz:EUR', dex: 'xyz', ticker: 'EURUSD', dexLabel: 'xyz', name: 'EUR / USD', ref: 'EUR', group: 'macro', kind: 'perp' },
  { id: 'gbp', coin: 'xyz:GBP', dex: 'xyz', ticker: 'GBPUSD', dexLabel: 'xyz', name: 'GBP / USD', ref: 'GBP', group: 'macro', kind: 'perp' },
  { id: 'jpy', coin: 'xyz:JPY', dex: 'xyz', ticker: 'USDJPY', dexLabel: 'xyz', name: 'USD / JPY', ref: 'JPY', group: 'macro', kind: 'perp' },
  { id: 'btc', coin: 'BTC', dex: '', ticker: 'BTCUSD', dexLabel: 'Hype', name: 'Bitcoin', ref: 'BTC', group: 'macro', kind: 'perp' },
  { id: 'eth', coin: 'ETH', dex: '', ticker: 'ETHUSD', dexLabel: 'Hype', name: 'Ethereum', ref: 'ETH', group: 'macro', kind: 'perp' },

  // ── GROUP 3: Classic Spot & Global Futures ────────────────────────────────
  { id: 'spot-xau', coin: 'SPOT:XAUUSD', dex: 'classic', ticker: 'XAUUSD', dexLabel: 'Spot', name: 'Ons Altın (Spot)', ref: 'GC=F', group: 'spot', kind: 'tradfi', tvSymbol: 'OANDA:XAUUSD' },
  { id: 'spot-dxy', coin: 'SPOT:DXY', dex: 'classic', ticker: 'DXY', dexLabel: 'Index', name: 'US Dollar Index', ref: 'ICE', group: 'spot', kind: 'tradfi', tvSymbol: 'TVC:DXY' },
  { id: 'spot-brent', coin: 'SPOT:BRENT', dex: 'classic', ticker: 'BRENT', dexLabel: 'Fut', name: 'Brent Crude (ICE)', ref: 'BZ=F', group: 'spot', kind: 'tradfi', tvSymbol: 'TVC:UKOIL' },
  { id: 'spot-nq1', coin: 'SPOT:NQ1', dex: 'classic', ticker: 'NQ1!', dexLabel: 'CME', name: 'Nasdaq 100 Futures', ref: 'NQ=F', group: 'spot', kind: 'tradfi', tvSymbol: 'CME_MINI:NQ1!' },
];

export function tradeUrl(spec, apiCoin) {
  if (spec.kind === 'tradfi') {
    const sym = spec.tvSymbol || spec.ticker;
    return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(sym)}`;
  }
  if (spec.kind === 'spot') {
    const pair = spec.name.endsWith(' Spot') ? spec.name.slice(0, -5) : spec.name;
    if (pair.includes('/')) return `https://app.hyperliquid.xyz/trade/${pair}`;
  }
  return `https://app.hyperliquid.xyz/trade/${encodeURIComponent(apiCoin)}`;
}

export const THEMES = [
  { id: 'terminal', label: 'Bloomberg Terminal' },
  { id: 'fintech', label: 'Modern Fintech Dark' },
  { id: 'paper', label: 'Swiss Light Paper' },
  { id: 'quant', label: 'Quant Cyber Matrix' },
];

export const LAYOUTS = [
  { id: 'table', label: 'Tablo' },
  { id: 'bento', label: 'Bento Heatmap' },
  { id: 'cockpit', label: 'Split Kokpit' },
  { id: 'columns', label: 'Sütunlu Pano' },
];
