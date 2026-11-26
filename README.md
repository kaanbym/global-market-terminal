# Global Market Terminal — Hyperliquid & Spot (24x7)

Canlı Hyperliquid (US Tech, AI, Indices, Macro, FX, Crypto) ve Klasik Spot/Vadeli (Ons Altın `XAUUSD`, `DXY`, `Brent`, `NQ1!`) takip terminali.

## Özellikler
- **3 Grup / 31 Canlı Piyasa:**
  1. **US Tech, AI & Indices:** `XYZ100`, `SP500`, `AAPL`, `TSLA`, `AMZN`, `META`, `GOOGL`, `NFLX`, `AMD`, `MU`, `SPCX`, `ANT`, `OAI`, `NVDA`, `INTC`, `ASML`, `PLTR`, `CRWD`, `MSFT`, `QCOM`
  2. **Macro, FX & Crypto:** `GOLD`, `BRENT`, `EURUSD`, `GBPUSD`, `USDJPY`, `BTCUSD`, `ETHUSD`
  3. **Classic Spot & Futures:** `XAUUSD` (Ons Altın), `DXY`, `BRENT`, `NQ1!`
- **4 Tema:** Bloomberg Terminal · Modern Fintech Dark · Swiss Light Paper · Quant Cyber Matrix
- **4 Yerleşim:** Tablo (23 Sütun / Kompakt Detay) · Bento Heatmap · Split Kokpit · Sütunlu Pano
- **Multi-Timeframe Analiz:** 15m / 30m / 60m / 240m Fiyat %, Funding APR (+24s Ort.) ve 7/24 sunucu snapshot tabanlı Open Interest Δ.

## Çalıştırma (Lokal / 7/24 Sunucu)
```bash
npm install
npm run build
npm start
```
Sunucu `http://localhost:4173` (veya `PORT` env değişkeni) üzerinde açılır; `/api/hl`, `/api/spot` ve `/api/snapshots` uç noktalarını sunar.

## 7/24 Canlı Yayın (Render / Railway / Vercel)
- **Render (Önerilen — 7/24 OI geçmişi için):** Bu repoyu Render'a bağlayın; `render.yaml` otomatik algılanır.
- **Railway / Fly.io:** `Dockerfile` ile tek tıkla deploy edilir.
- **Vercel:** `api/spot.js` ve `api/hl.js` serverless fonksiyonları hazırdır.
