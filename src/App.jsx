import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { GROUPS, LAYOUTS, MARKETS, THEMES, tradeUrl } from './markets.js';
import {
  addWatchCoin,
  getState,
  mountStore,
  removeWatchId,
  subscribe,
  triggerRefresh,
} from './store.js';
import {
  dirClass,
  fmtClock,
  fmtCompact,
  fmtNet,
  fmtPct,
  fmtPx,
  fmtQuoteTime,
  freshnessLetter,
  fundClass,
  heatClass,
  pctChange,
} from './format.js';

function useStoreTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const unmount = mountStore();
    const unsub = subscribe(() => setTick((n) => n + 1));
    return () => {
      unsub();
      unmount();
    };
  }, []);
}

function useClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function readPref(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writePref(key, val) {
  try {
    localStorage.setItem(key, val);
  } catch {}
}

function Sparkline({ points, live, change = null, width = 82, height = 18, area = false }) {
  const series = useMemo(() => {
    const arr = points.slice();
    if (live != null && Number.isFinite(live)) arr.push(live);
    return arr;
  }, [points, live]);

  if (series.length < 2) {
    return (
      <svg className="spark empty" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <line x1={width * 0.3} y1={height / 2} x2={width * 0.7} y2={height / 2} stroke="currentColor" strokeWidth="1" />
      </svg>
    );
  }

  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || Math.abs(max) * 0.002 || 1;
  const coords = series.map((v, i) => [
    ((i / (series.length - 1)) * (width - 4) + 2).toFixed(1),
    ((1 - (v - min) / span) * (height - 4) + 2).toFixed(1),
  ]);
  const poly = coords.map((c) => c.join(',')).join(' ');
  const dir =
    change != null && Number.isFinite(change)
      ? dirClass(change)
      : series[series.length - 1] >= series[0]
      ? 'up'
      : 'down';

  return (
    <svg className={`spark ${dir}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {area ? (
        <polygon points={`2,${height - 1} ${poly} ${width - 2},${height - 1}`} fill="currentColor" fillOpacity="0.16" />
      ) : null}
      <polyline
        points={poly}
        fill="none"
        stroke="currentColor"
        strokeWidth={area ? '1.65' : '1.35'}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MarketPicker({ onClose }) {
  const st = getState();
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const activeCoins = useMemo(() => {
    const s = new Set();
    for (const m of MARKETS) if (st.present[m.id]) s.add(st.apiCoin[m.id] ?? m.coin);
    for (const w of st.watchlist) s.add(st.apiCoin[w.id] ?? w.coin);
    return s;
  }, [st.present, st.apiCoin, st.watchlist]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    const list = q ? st.catalog.filter((c) => c.search.includes(q)) : st.catalog;
    return [...list].sort((a, b) => {
      if (q) {
        const score = (x) => {
          const t = x.ticker.toLowerCase();
          const c = x.coin.toLowerCase();
          return t === q || c === q ? 0 : t.startsWith(q) || c.endsWith(`:${q}`) ? 1 : 2;
        };
        const d = score(a) - score(b);
        if (d !== 0) return d;
      }
      return a.ticker.localeCompare(b.ticker) || a.dexLabel.localeCompare(b.dexLabel);
    });
  }, [q, st.catalog]);

  const shown = matches.slice(0, 80);

  return (
    <div className="picker" role="dialog" aria-label="Piyasa ekle">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Ticker, isim veya dex ara..."
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          const first = shown.find((c) => !activeCoins.has(c.coin));
          if (first) {
            addWatchCoin(first.coin);
            onClose();
          }
        }}
      />
      <p className="picker-meta">
        {q ? `${matches.length} eşleşme` : `${st.catalog.length} piyasa`}
        {matches.length > shown.length ? ` · ilk ${shown.length}` : ''}
      </p>
      <ul>
        {shown.map((item) => {
          const added = activeCoins.has(item.coin);
          return (
            <li key={item.coin}>
              <button
                type="button"
                disabled={added}
                onClick={() => {
                  addWatchCoin(item.coin);
                  onClose();
                }}
              >
                <span className="picker-ticker">{item.ticker}</span>
                <span className="picker-dex">{item.dexLabel}</span>
                <span className="picker-name">{item.name}</span>
                <span className="picker-kind">{added ? 'Eklendi' : item.kind === 'spot' ? 'Spot' : 'Perp'}</span>
              </button>
            </li>
          );
        })}
        {shown.length === 0 ? <li className="picker-meta">Eşleşen piyasa yok.</li> : null}
      </ul>
    </div>
  );
}

function computeRowMetrics(spec, st, now) {
  const q = st.quotes[spec.id];
  const apiCoin = st.apiCoin[spec.id] ?? spec.coin;
  const mark = q?.mark ?? null;
  const prev = q?.prev ?? null;
  const chg1d = pctChange(mark, prev);
  const net1d = mark != null && prev != null ? mark - prev : null;
  const base2d = st.base2d[spec.id];
  const chg2d = pctChange(mark, base2d);
  const has2d = spec.id in st.base2d;
  const oracle = q?.oracle ?? null;
  const vsRef = pctChange(mark, oracle);
  const fundApr = spec.kind === 'perp' && q?.funding != null ? q.funding * 24 * 365 : null;
  const oiUsd = spec.kind === 'perp' && q?.oi != null && mark != null ? q.oi * mark : null;
  const mt = st.mt[spec.id];
  const flash = q && q.flash && q.flashUntil > now ? q.flash : null;
  const fresh = freshnessLetter(q?.quoteAt ?? 0, now);
  const url = tradeUrl(spec, apiCoin);
  const tooltip = [
    apiCoin,
    q?.sourceLabel || '',
    q?.maxLeverage ? `${q.maxLeverage}x max` : '',
    q?.isolated ? 'isolated' : '',
    q?.mid != null ? `mid ${fmtPx(q.mid)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    q,
    apiCoin,
    mark,
    prev,
    chg1d,
    net1d,
    chg2d,
    has2d,
    oracle,
    vsRef,
    fundApr,
    oiUsd,
    mt,
    priceMt: st.priceMt[spec.id] ?? {},
    flash,
    fresh,
    url,
    tooltip,
    sparks: st.sparks[spec.id] ?? [],
  };
}

function fmtMtFund(val, tf, spanMin) {
  if (val != null && Number.isFinite(val)) return fmtPct(val, 1);
  return spanMin > 0 && spanMin < tf ? `${spanMin}/${tf}d` : '—';
}

function fmtMtOi(val, tf, spanMin) {
  if (val != null && Number.isFinite(val)) return fmtPct(val, 2);
  return spanMin > 0 && spanMin < tf ? `${spanMin}/${tf}d` : '—';
}

function TableRow({ spec, st, now, wideMode, expanded, onToggleExpand }) {
  const m = computeRowMetrics(spec, st, now);
  const isPerp = spec.kind === 'perp';
  const dir = dirClass(m.chg1d);
  const pctHeat = heatClass(m.chg1d);
  const spanMin = st.snapSpanMin || 0;

  return (
    <Fragment>
      <tr
        className={`data ${dir} ${!wideMode && isPerp ? 'clickable' : ''}`}
        onClick={!wideMode && isPerp ? () => onToggleExpand(spec.id) : undefined}
      >
        <td className="ticker">
          {!wideMode && isPerp ? <span className="exp-caret">{expanded ? '▼' : '▶'}</span> : null}
          {spec.group === 'watch' ? (
            <button
              type="button"
              className="remove"
              aria-label={`Kaldır ${spec.ticker}`}
              onClick={(e) => {
                e.stopPropagation();
                removeWatchId(spec.id);
              }}
            >
              ×
            </button>
          ) : null}
          <a href={m.url} target="_blank" rel="noreferrer" title={m.tooltip} onClick={(e) => e.stopPropagation()}>
            {spec.ticker}
          </a>
        </td>
        <td className={`dex ${spec.dexLabel.toLowerCase()}`}>{spec.dexLabel}</td>
        <td className="name" title={m.tooltip}>
          {spec.name}
        </td>
        <td className={`sparkcell ${pctHeat}`}>
          <Sparkline points={m.sparks} live={m.mark} change={m.chg1d} area />
        </td>
        <td className={`num px ${m.flash ? `flash-${m.flash}` : ''}`}>{fmtPx(m.mark)}</td>
        <td className={`num net-heat ${pctHeat}`}>{fmtNet(m.net1d)}</td>
        <td className={`num ${dirClass(m.chg1d)}`}>{fmtPct(m.chg1d, 2)}</td>
        <td className={`num ${dirClass(m.chg2d)}`}>{!m.has2d ? '…' : fmtPct(m.chg2d, 2)}</td>

        {/* Funding APR */}
        <td className={`fundcell ${wideMode ? 'mt-fund' : ''}`}>
          {!isPerp ? (
            <span className="fund none">—</span>
          ) : (
            <span className={fundClass(m.fundApr)} title="Saatlik Funding × 24 × 365">
              {fmtPct(m.fundApr, 1)}
            </span>
          )}
        </td>

        {wideMode ? (
          <>
            {[15, 30, 60, 240].map((tf) => {
              const v = m.mt?.fund?.[tf];
              return (
                <td
                  key={`f-${tf}`}
                  className={`num mt-fund ${isPerp && v != null ? dirClass(v) : 'dim'}`}
                  title={v == null && isPerp ? `7/24 sunucuda ${tf} dk snapshot birikiyor (${spanMin}/${tf} dk)` : undefined}
                >
                  {isPerp ? fmtMtFund(v, tf, spanMin) : '—'}
                </td>
              );
            })}
          </>
        ) : null}

        {/* OI */}
        <td className={`num dim ${wideMode ? 'mt-oi' : ''}`}>{isPerp ? fmtCompact(m.oiUsd) : '—'}</td>

        {wideMode ? (
          <>
            {[15, 30, 60, 240].map((tf) => {
              const v = m.mt?.oiPct?.[tf];
              return (
                <td
                  key={`oi-${tf}`}
                  className={`num mt-oi ${isPerp && v != null ? dirClass(v) : 'dim'}`}
                  title={v == null && isPerp ? `7/24 sunucuda ${tf} dk OI geçmişi birikiyor (${spanMin}/${tf} dk)` : undefined}
                >
                  {isPerp ? fmtMtOi(v, tf, spanMin) : '—'}
                </td>
              );
            })}
          </>
        ) : null}

        <td className="num dim">{fmtCompact(m.q?.vol)}</td>
        <td className="num dim">{spec.ref}</td>
        <td className="num">{fmtPx(m.oracle)}</td>
        <td className={`num ${dirClass(m.vsRef)}`}>{fmtPct(m.vsRef, 2)}</td>
        <td className="updated" title={m.q?.quoteAt ? new Date(m.q.quoteAt).toISOString() : undefined}>
          <span className="qtime">{fmtQuoteTime(m.q?.quoteAt ?? 0, now)}</span>
          {m.fresh ? <span className={`letter ${m.fresh}`}>{m.fresh}</span> : null}
        </td>
      </tr>

      {!wideMode && expanded && isPerp ? (
        <tr className="drawer-row">
          <td colSpan={15}>
            <div className="drawer-grid">
              <div className="drawer-card">
                <div className="drawer-title fund-t">
                  <span>{spec.ticker} · Funding APR</span>
                  <span>24s Ort: {m.mt?.fund?.avg24h != null ? fmtPct(m.mt.fund.avg24h, 1) : '—'}</span>
                </div>
                <div className="tf-grid">
                  <div className="tf-box">
                    <div className="tf-lbl">Anlık</div>
                    <div className={`tf-val ${dirClass(m.fundApr)}`}>{fmtPct(m.fundApr, 1)}</div>
                  </div>
                  {[15, 30, 60, 240].map((tf) => {
                    const v = m.mt?.fund?.[tf];
                    return (
                      <div className="tf-box" key={tf}>
                        <div className="tf-lbl">{tf}m</div>
                        <div className={`tf-val ${v != null ? dirClass(v) : 'dim'}`}>{fmtMtFund(v, tf, spanMin)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="drawer-card">
                <div className="drawer-title oi-t">
                  <span>{spec.ticker} · Open Interest Δ</span>
                  <span>Toplam: {fmtCompact(m.oiUsd)}</span>
                </div>
                <div className="tf-grid">
                  <div className="tf-box">
                    <div className="tf-lbl">Anlık OI</div>
                    <div className="tf-val">{fmtCompact(m.oiUsd)}</div>
                  </div>
                  {[15, 30, 60, 240].map((tf) => {
                    const v = m.mt?.oiPct?.[tf];
                    return (
                      <div className="tf-box" key={tf}>
                        <div className="tf-lbl">{tf}m Δ</div>
                        <div className={`tf-val ${v != null ? dirClass(v) : 'dim'}`}>{fmtMtOi(v, tf, spanMin)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="drawer-card">
                <div className="drawer-title" style={{ color: 'var(--up)' }}>
                  <span>{spec.ticker} · Fiyat % Değişimi (Canlı)</span>
                  <span>15m Mumlar</span>
                </div>
                <div className="tf-grid">
                  <div className="tf-box">
                    <div className="tf-lbl">1D %</div>
                    <div className={`tf-val ${dirClass(m.chg1d)}`}>{fmtPct(m.chg1d, 2)}</div>
                  </div>
                  {[15, 30, 60, 240].map((tf) => {
                    const chg = pctChange(m.mark, m.priceMt?.[tf]);
                    return (
                      <div className="tf-box" key={tf}>
                        <div className="tf-lbl">{tf}m</div>
                        <div className={`tf-val ${dirClass(chg)}`}>{fmtPct(chg, 2)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function BentoView({ visible, st, now }) {
  return (
    <div className="bento-wrap">
      {GROUPS.map((g) => {
        const items = visible.filter((x) => x.group === g.id);
        if (items.length === 0) return null;
        return (
          <section key={g.id}>
            <div className="bento-group-head">
              <span>{g.title}</span>
              <span className="gbadge">{g.badge}</span>
              <span className="gcount">({items.length})</span>
            </div>
            <div className="bento-grid">
              {items.map((spec) => {
                const m = computeRowMetrics(spec, st, now);
                const dir = dirClass(m.chg1d);
                return (
                  <a key={spec.id} href={m.url} target="_blank" rel="noreferrer" className={`bento-card ${dir}`}>
                    <div className="bento-top">
                      <div>
                        <div className="bento-ticker">{spec.ticker}</div>
                        <div className="bento-name">
                          {spec.name} · {spec.dexLabel}
                        </div>
                      </div>
                      <span className={`bento-pill ${dir}`}>{fmtPct(m.chg1d, 2)}</span>
                    </div>
                    <div className="bento-mid">
                      <div className="bento-px">{fmtPx(m.mark)}</div>
                      <Sparkline points={m.sparks} live={m.mark} change={m.chg1d} width={78} height={24} area />
                    </div>
                    <div className="bento-meta">
                      <div>
                        <span>2D%</span>
                        {m.has2d ? fmtPct(m.chg2d, 1) : '…'}
                      </div>
                      <div>
                        <span>Fund APR</span>
                        {spec.kind === 'perp' ? fmtPct(m.fundApr, 1) : '—'}
                      </div>
                      <div>
                        <span>OI</span>
                        {spec.kind === 'perp' ? fmtCompact(m.oiUsd) : fmtCompact(m.q?.vol)}
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CockpitView({ visible, st, now, selectedId, onSelect }) {
  const sel = visible.find((x) => x.id === selectedId) || visible[0];
  if (!sel) return <p className="empty-msg">Eşleşen piyasa bulunamadı.</p>;
  const m = computeRowMetrics(sel, st, now);
  const isPerp = sel.kind === 'perp';

  return (
    <div className="cockpit-wrap">
      <div className="cockpit-list">
        {GROUPS.map((g) => {
          const items = visible.filter((x) => x.group === g.id);
          if (items.length === 0) return null;
          return (
            <div key={g.id}>
              <div className="cockpit-cat">
                {g.title} ({items.length})
              </div>
              {items.map((spec) => {
                const rm = computeRowMetrics(spec, st, now);
                return (
                  <button
                    key={spec.id}
                    type="button"
                    className={`cockpit-item ${spec.id === sel.id ? 'active' : ''}`}
                    onClick={() => onSelect(spec.id)}
                  >
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--ticker)' }}>{spec.ticker}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{spec.name}</div>
                    </div>
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                      <div style={{ fontWeight: 600 }}>{fmtPx(rm.mark)}</div>
                      <div className={`num ${dirClass(rm.chg1d)}`} style={{ fontSize: 11 }}>
                        {fmtPct(rm.chg1d, 2)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="cockpit-detail">
        <div className="cockpit-hero">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--ticker)' }}>{sel.ticker}</span>
              <span className="gbadge">{sel.dexLabel}</span>
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>{sel.name}</span>
            </div>
            <div className="cockpit-price" style={{ marginTop: 6 }}>
              {fmtPx(m.mark)}{' '}
              <span className={`num ${dirClass(m.chg1d)}`} style={{ fontSize: 16 }}>
                {fmtNet(m.net1d)} ({fmtPct(m.chg1d, 2)})
              </span>
            </div>
          </div>
          <a href={m.url} target="_blank" rel="noreferrer" className="textbtn on">
            {sel.kind === 'tradfi' ? 'TradingView ↗' : 'Hyperliquid Trade ↗'}
          </a>
        </div>

        <div className="cockpit-chart-box">
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
            24 Saatlik 15m Trend · 2D Değişim: <strong className={`num ${dirClass(m.chg2d)}`}>{fmtPct(m.chg2d, 2)}</strong>
          </div>
          <Sparkline points={m.sparks} live={m.mark} change={m.chg1d} width={640} height={96} area />
        </div>

        <div className="cockpit-stats">
          <div className="stat-card">
            <div className="stat-lbl">Oracle / Ref ({sel.ref})</div>
            <div className="stat-val">{fmtPx(m.oracle)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-lbl">vs Ref</div>
            <div className={`stat-val num ${dirClass(m.vsRef)}`}>{fmtPct(m.vsRef, 2)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-lbl">24h Volume</div>
            <div className="stat-val">{fmtCompact(m.q?.vol)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-lbl">Open Interest</div>
            <div className="stat-val">{isPerp ? fmtCompact(m.oiUsd) : '—'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-lbl">Fund APR</div>
            <div className={`stat-val num ${dirClass(m.fundApr)}`}>{isPerp ? fmtPct(m.fundApr, 1) : '—'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-lbl">Updated (TRT)</div>
            <div className="stat-val" style={{ color: 'var(--blue)' }}>
              {fmtQuoteTime(m.q?.quoteAt ?? 0, now)} {m.fresh}
            </div>
          </div>
        </div>

        {isPerp ? (
          <div className="drawer-grid">
            <div className="drawer-card">
              <div className="drawer-title fund-t">
                <span>Funding APR (15–240m)</span>
                <span>24s Ort: {m.mt?.fund?.avg24h != null ? fmtPct(m.mt.fund.avg24h, 1) : '—'}</span>
              </div>
              <div className="tf-grid">
                <div className="tf-box">
                  <div className="tf-lbl">Anlık</div>
                  <div className={`tf-val ${dirClass(m.fundApr)}`}>{fmtPct(m.fundApr, 1)}</div>
                </div>
                {[15, 30, 60, 240].map((tf) => {
                  const v = m.mt?.fund?.[tf];
                  return (
                    <div className="tf-box" key={tf}>
                      <div className="tf-lbl">{tf}m</div>
                      <div className={`tf-val ${v != null ? dirClass(v) : 'dim'}`}>
                        {fmtMtFund(v, tf, st.snapSpanMin || 0)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="drawer-card">
              <div className="drawer-title oi-t">
                <span>Open Interest Δ (15–240m)</span>
              </div>
              <div className="tf-grid">
                <div className="tf-box">
                  <div className="tf-lbl">Anlık</div>
                  <div className="tf-val">{fmtCompact(m.oiUsd)}</div>
                </div>
                {[15, 30, 60, 240].map((tf) => {
                  const v = m.mt?.oiPct?.[tf];
                  return (
                    <div className="tf-box" key={tf}>
                      <div className="tf-lbl">{tf}m Δ</div>
                      <div className={`tf-val ${v != null ? dirClass(v) : 'dim'}`}>
                        {fmtMtOi(v, tf, st.snapSpanMin || 0)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="drawer-card">
              <div className="drawer-title" style={{ color: 'var(--up)' }}>
                <span>Fiyat % Değişimi (Canlı)</span>
                <span>15m Mumlar</span>
              </div>
              <div className="tf-grid">
                <div className="tf-box">
                  <div className="tf-lbl">1D %</div>
                  <div className={`tf-val ${dirClass(m.chg1d)}`}>{fmtPct(m.chg1d, 2)}</div>
                </div>
                {[15, 30, 60, 240].map((tf) => {
                  const chg = pctChange(m.mark, m.priceMt?.[tf]);
                  return (
                    <div className="tf-box" key={tf}>
                      <div className="tf-lbl">{tf}m</div>
                      <div className={`tf-val ${dirClass(chg)}`}>{fmtPct(chg, 2)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ColumnsView({ visible, st, now }) {
  return (
    <div>
      <div className="tape">
        <span style={{ color: 'var(--accent)', fontWeight: 700 }}>● LIVE TAPE</span>
        {visible.slice(0, 14).map((spec) => {
          const m = computeRowMetrics(spec, st, now);
          return (
            <span key={spec.id}>
              <strong>{spec.ticker}</strong> {fmtPx(m.mark)}{' '}
              <span className={`num ${dirClass(m.chg1d)}`}>{fmtPct(m.chg1d, 2)}</span>
            </span>
          );
        })}
      </div>
      <div className="columns-grid">
        {GROUPS.map((g) => {
          const items = visible.filter((x) => x.group === g.id);
          if (items.length === 0) return null;
          return (
            <div key={g.id} className="col-panel">
              <div className="col-head">
                <span>{g.title}</span>
                <span className="gcount">{items.length}</span>
              </div>
              {items.map((spec) => {
                const m = computeRowMetrics(spec, st, now);
                return (
                  <a key={spec.id} href={m.url} target="_blank" rel="noreferrer" className="col-row">
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--ticker)', fontFamily: 'var(--font-mono)' }}>
                        {spec.ticker}{' '}
                        <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>{spec.dexLabel}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {spec.name}
                        {spec.kind === 'perp' ? ` · Fund ${fmtPct(m.fundApr, 1)}` : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                      <div style={{ fontWeight: 700 }}>{fmtPx(m.mark)}</div>
                      <div className={`num ${dirClass(m.chg1d)}`} style={{ fontSize: 11 }}>
                        {fmtPct(m.chg1d, 2)}
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function App() {
  useStoreTick();
  const now = useClock();
  const st = getState();

  const [theme, setTheme] = useState(() => readPref('mt-theme', 'terminal'));
  const [layout, setLayout] = useState(() => readPref('mt-layout', 'table'));
  const [wideMode, setWideMode] = useState(() => readPref('mt-wide', '1') === '1');
  const [grid, setGrid] = useState(() => readPref('mt-grid', '1') !== '0');
  const [filter, setFilter] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expandedId, setExpandedId] = useState('nvda');
  const [selectedId, setSelectedId] = useState('nvda');
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const raw = localStorage.getItem('mt-collapsed');
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    writePref('mt-theme', theme);
  }, [theme]);

  const q = filter.trim().toLowerCase();
  const visible = useMemo(() => {
    const all = [...st.watchlist, ...MARKETS];
    return all.filter((spec) => {
      if (!q) return true;
      return `${spec.ticker} ${spec.name} ${spec.coin} ${spec.dexLabel} ${spec.ref}`.toLowerCase().includes(q);
    });
  }, [q, st.watchlist]);

  function toggleGroup(id) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writePref('mt-collapsed', JSON.stringify([...next]));
      return next;
    });
  }

  function collapseAll(flag) {
    const next = flag ? new Set(GROUPS.map((g) => g.id)) : new Set();
    writePref('mt-collapsed', JSON.stringify([...next]));
    setCollapsed(next);
  }

  const activeCount = [...MARKETS, ...st.watchlist].filter((m) => st.present[m.id]).length;
  const statusLabel =
    st.status === 'live'
      ? 'HL LIVE WS'
      : st.status === 'polling'
      ? 'POLLING'
      : st.status === 'reconnecting'
      ? 'RECONNECTING'
      : st.status === 'error'
      ? 'OFFLINE'
      : 'LOADING';

  return (
    <div className="app">
      <header>
        <div className="statusline">
          <div className="brand">
            <span className={`dot ${st.status}`} aria-hidden="true" />
            <span className={`status ${st.status}`}>{statusLabel}</span>
            <span className="sep">·</span>
            <span className={`status ${st.spotStatus === 'live' ? 'live' : 'polling'}`}>
              SPOT {st.spotStatus === 'live' ? 'LIVE' : '...'}
            </span>
            <span className="sep">·</span>
            <span>{st.ready ? `${activeCount} piyasa` : 'bağlanıyor...'}</span>
            {st.snapSpanMin > 0 ? (
              <>
                <span className="sep">·</span>
                <span
                  className={st.snapSpanMin >= 240 ? 'status live' : ''}
                  title="7/24 sunucu snapshot geçmişi (240 dk dolduğunda tüm 15/30/60/240m pencereleri tam dolar)"
                >
                  OI Geçmişi: {st.snapSpanMin >= 240 ? '4s TAM' : `${st.snapSpanMin}/240 dk`}
                </span>
              </>
            ) : null}
          </div>

          <div className="status-right">
            <button type="button" className="textbtn" onClick={() => collapseAll(collapsed.size === 0)}>
              {collapsed.size === 0 ? 'Daralt' : 'Genişlet'}
            </button>
            <button type="button" className="textbtn" onClick={() => triggerRefresh()}>
              Yenile
            </button>
            <time dateTime={new Date(now).toISOString()}>{fmtClock(now)}</time>
          </div>
        </div>

        <div className="title-row">
          <h1>Global Market Terminal — Hyperliquid &amp; Spot (24x7)</h1>
          <div className="segmented" role="group" aria-label="Görünüm seçici">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                type="button"
                className={`seg-btn ${layout === l.id ? 'active' : ''}`}
                onClick={() => {
                  setLayout(l.id);
                  writePref('mt-layout', l.id);
                }}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <p className="legend">
          Hyperliquid Public WS/REST + Global Spot/Futures
          <span className="sep">·</span>
          <span className="letter A">A</span> ≤1 dk
          <span className="letter L">L</span> 1–20 dk
          <span className="letter S">S</span> &gt;20 dk
          <span className="sep">·</span>
          Europe/Istanbul (TRT)
        </p>

        <div className="tools">
          <div className="tools-left">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Ara: NVDA, BTC, XAUUSD, NQ1!..."
              spellCheck={false}
              aria-label="Piyasa filtrele"
            />
            <div className="adder">
              <button
                type="button"
                className="textbtn"
                disabled={!st.ready || st.catalog.length === 0}
                onClick={() => setPickerOpen((v) => !v)}
              >
                + Piyasa Ekle
              </button>
              {pickerOpen ? <MarketPicker onClose={() => setPickerOpen(false)} /> : null}
            </div>
          </div>

          <div className="tools-right">
            {layout === 'table' ? (
              <>
                <div className="segmented" role="group" aria-label="Sütun modu">
                  <button
                    type="button"
                    className={`seg-btn ${wideMode ? 'active' : ''}`}
                    onClick={() => {
                      setWideMode(true);
                      writePref('mt-wide', '1');
                    }}
                  >
                    23 Sütun (15/30/60/240m Açık)
                  </button>
                  <button
                    type="button"
                    className={`seg-btn ${!wideMode ? 'active' : ''}`}
                    onClick={() => {
                      setWideMode(false);
                      writePref('mt-wide', '0');
                    }}
                  >
                    Kompakt (Satır Detay)
                  </button>
                </div>
                <button
                  type="button"
                  className={`textbtn ${grid ? 'on' : ''}`}
                  onClick={() => {
                    const next = !grid;
                    setGrid(next);
                    writePref('mt-grid', next ? '1' : '0');
                  }}
                >
                  Grid
                </button>
              </>
            ) : null}

            <select
              className="select-pill"
              value={theme}
              aria-label="Tema seç"
              onChange={(e) => setTheme(e.target.value)}
            >
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  Tema: {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <div className="scroll">
        {!st.ready && st.status !== 'error' ? <p className="loading">Canlı piyasa verileri yükleniyor...</p> : null}

        {st.ready && layout === 'table' ? (
          <table className={`${grid ? 'grid' : ''} ${wideMode ? 'has-super' : ''}`}>
            <thead>
              {wideMode ? (
                <tr className="super">
                  <th colSpan={8} style={{ textAlign: 'left' }}>
                    Piyasa &amp; Fiyat
                  </th>
                  <th colSpan={5} className="super-fund">
                    Funding APR (15–240m)
                  </th>
                  <th colSpan={5} className="super-oi">
                    Open Interest (15–240m Δ)
                  </th>
                  <th colSpan={5} style={{ textAlign: 'left' }}>
                    Hacim &amp; Referans
                  </th>
                </tr>
              ) : null}
              <tr className="cols">
                <th className="ticker">Ticker</th>
                <th className="dex-h">Dex</th>
                <th className="name">Name</th>
                <th style={{ textAlign: 'center' }}>Spark</th>
                <th title="Anlık Mark / Spot Fiyat">Price</th>
                <th title="1 Günlük Net Fark">1D Net</th>
                <th title="1 Günlük % Değişim">1D%</th>
                <th title="48 Saatlik % Değişim">2D%</th>
                <th title="Anlık Yıllıklandırılmış Funding (Saatlik × 24 × 365)">Fund APR</th>
                {wideMode ? (
                  <>
                    <th title="15 dk önceki Funding APR">F 15m</th>
                    <th title="30 dk önceki Funding APR">F 30m</th>
                    <th title="60 dk önceki Funding APR">F 60m</th>
                    <th title="240 dk (4s) önceki Funding APR">F 240m</th>
                  </>
                ) : null}
                <th title="Open Interest (USD)">OI</th>
                {wideMode ? (
                  <>
                    <th title="15 dk OI % Değişim">OI 15m</th>
                    <th title="30 dk OI % Değişim">OI 30m</th>
                    <th title="60 dk OI % Değişim">OI 60m</th>
                    <th title="240 dk OI % Değişim">OI 240m</th>
                  </>
                ) : null}
                <th title="24 Saatlik Hacim">Vol 24h</th>
                <th>Ref</th>
                <th title="Oracle / Referans Fiyat">Ref Px</th>
                <th title="(Mark − Ref) / Ref">vs Ref</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {GROUPS.map((g) => {
                const rows = visible.filter((x) => x.group === g.id);
                if (rows.length === 0) return null;
                const isCol = collapsed.has(g.id);
                return (
                  <Fragment key={g.id}>
                    <tr className="group">
                      <td colSpan={wideMode ? 23 : 15}>
                        <button type="button" className="group-btn" onClick={() => toggleGroup(g.id)}>
                          <span>{isCol ? '▶' : '▼'}</span>
                          <span>{g.title}</span>
                          <span className="gbadge">{g.badge}</span>
                          <span className="gcount">({rows.length})</span>
                        </button>
                      </td>
                    </tr>
                    {!isCol
                      ? rows.map((spec) => (
                          <TableRow
                            key={spec.id}
                            spec={spec}
                            st={st}
                            now={now}
                            wideMode={wideMode}
                            expanded={expandedId === spec.id}
                            onToggleExpand={(id) => setExpandedId((cur) => (cur === id ? null : id))}
                          />
                        ))
                      : null}
                  </Fragment>
                );
              })}
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={wideMode ? 23 : 15} className="empty-msg">
                    Filtreye uyan piyasa yok.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        ) : null}

        {st.ready && layout === 'bento' ? <BentoView visible={visible} st={st} now={now} /> : null}
        {st.ready && layout === 'cockpit' ? (
          <CockpitView
            visible={visible}
            st={st}
            now={now}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        ) : null}
        {st.ready && layout === 'columns' ? <ColumnsView visible={visible} st={st} now={now} /> : null}

        <footer>
          Hyperliquid verileri canlı olarak <code>wss://api.hyperliquid.xyz/ws</code> ve{' '}
          <code>https://api.hyperliquid.xyz/info</code> üzerinden; klasik spot/vadeli verileri (XAU/USD, DXY, Brent,
          NQ1!) <code>/api/spot</code> üzerinden anlık çekilir. 60m ve 240m Funding verileri Hyperliquid{' '}
          <code>fundingHistory</code> ile ilk açılışta dolar; 15m/30m Funding ve 15m/30m/60m/240m OI değişimleri
          sunucu + tarayıcı 1 dakikalık snapshot birikimiyle anlık hesaplanır.
        </footer>
      </div>
    </div>
  );
}
