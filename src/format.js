export const TZ = 'Europe/Istanbul';

function priceDecimals(val) {
  const a = Math.abs(val);
  if (a >= 10000) return 0;
  if (a >= 1000) return 1;
  if (a >= 10) return 2;
  if (a >= 2) return 3;
  return 4;
}

function netDecimals(val) {
  const a = Math.abs(val);
  if (a >= 1) return 2;
  if (a >= 0.01) return 3;
  return 4;
}

export function fmtPx(val) {
  if (val == null || !Number.isFinite(val)) return '—';
  const d = priceDecimals(val);
  return val.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtSigned(val, decimals) {
  const prefix = val > 0 ? '+' : val < 0 ? '-' : '';
  return prefix + Math.abs(val).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtNet(val) {
  if (val == null || !Number.isFinite(val)) return '—';
  return fmtSigned(val, netDecimals(val));
}

export function fmtPct(val, decimals = 2) {
  if (val == null || !Number.isFinite(val)) return '—';
  const pct = val * 100;
  const d = Math.abs(pct) >= 1000 ? 0 : Math.abs(pct) >= 100 ? 1 : decimals;
  return fmtSigned(pct, d) + '%';
}

export function fmtFundApr(hourlyRate) {
  if (hourlyRate == null || !Number.isFinite(hourlyRate)) return '—';
  const apr = hourlyRate * 24 * 365;
  return fmtPct(apr, 1);
}

export function fmtCompact(val) {
  if (val == null || !Number.isFinite(val)) return '—';
  const a = Math.abs(val);
  if (a === 0) return '0';
  const sign = val < 0 ? '-' : '';
  if (a >= 1e12) return sign + '$' + (a / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return sign + '$' + (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return sign + '$' + (a / 1e3).toFixed(1) + 'K';
  return sign + '$' + a.toFixed(0);
}

export function freshnessLetter(ts, now) {
  if (!ts) return '';
  const age = now - ts;
  if (age <= 60_000) return 'A';
  if (age <= 1_200_000) return 'L';
  return 'S';
}

function trtParts(ms) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(fmt.formatToParts(ms).map((p) => [p.type, p.value]));
}

export function fmtClock(ms) {
  const p = trtParts(ms);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mon = months[Number(p.month) - 1] ?? p.month;
  return `${p.day} ${mon} ${p.year}  ${p.hour}:${p.minute}:${p.second} TRT`;
}

export function fmtQuoteTime(ts, now) {
  if (!ts) return '—';
  const a = trtParts(ts);
  const b = trtParts(now);
  if (a.year === b.year && a.month === b.month && a.day === b.day) {
    return `${a.hour}:${a.minute}:${a.second}`;
  }
  return `${a.day}/${a.month}`;
}

export function dirClass(val) {
  if (val == null || !Number.isFinite(val) || val === 0) return 'flat';
  return val > 0 ? 'up' : 'down';
}

export function heatLevel(pct) {
  if (pct == null || !Number.isFinite(pct) || pct === 0) return 0;
  const a = Math.abs(pct) * 100;
  if (a >= 5) return 4;
  if (a >= 2.5) return 3;
  if (a >= 1) return 2;
  return 1;
}

export function heatClass(pct) {
  const dir = dirClass(pct);
  const lvl = heatLevel(pct);
  return lvl ? `${dir} heat-${lvl}` : 'flat';
}

export function fundClass(apr) {
  if (apr == null || !Number.isFinite(apr)) return 'fund none';
  if (apr > 0.15) return 'fund hot';
  if (apr > 0) return 'fund pos';
  if (apr < -0.05) return 'fund cold';
  if (apr < 0) return 'fund neg';
  return 'fund zero';
}

export function pctChange(now, prev) {
  if (now == null || prev == null || prev === 0) return null;
  return (now - prev) / prev;
}
