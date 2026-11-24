// Ilmzor — o'quvchi natija kartasi (SVG → PNG, resvg-wasm). 1080×1350, ilovadagi ota-ona kartasi uslubida.
import { initWasm, Resvg } from './resvg.mjs';

let ready = null;
export function initCard(wasmModule) { if (!ready) ready = initWasm(wasmModule); return ready; }

const NAVY = '#0e223a', AQUA = '#4ad496', MUTED = '#5b6878', SOFT = '#8a94a3';
const esc = (s) => String(s == null ? '' : s).replace(/ʻ/g, '‘').replace(/ʼ/g, '’').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function pcolor(p) {
  if (p == null) return '#8a94a3';
  p = Math.max(0, Math.min(100, p)); let h, l;
  if (p < 50) { h = 2 + 44 * (p / 50); l = 50; } else { h = 46 + 76 * ((p - 50) / 50); l = 50 - 14 * ((p - 50) / 50); }
  return `hsl(${h.toFixed(0)},80%,${l.toFixed(0)}%)`;
}
function statusLabel(p) { if (p == null) return 'Baholanmagan'; if (p >= 100) return 'Bajardi'; if (p >= 80) return 'A‘lo'; if (p >= 50) return 'O‘rta'; if (p > 0) return 'Past'; return 'Bajarmadi'; }
const fmtP = (p) => (p == null ? '—' : Math.round(p) + '%');
const fmtN = (n) => (Math.round(n * 10) / 10).toString();
// rough width (Satoshi): good enough for ellipsis
const tw = (s, size, w = 600) => String(s).length * size * (w >= 800 ? 0.6 : 0.54);
function ellip(s, size, max, w) { s = String(s); if (tw(s, size, w) <= max) return s; while (s.length > 1 && tw(s + '…', size, w) > max) s = s.slice(0, -1); return s + '…'; }
const T = (x, y, s, size, weight, fill, anchor = 'start') => `<text x="${x}" y="${y}" font-family="Satoshi" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
const box = (x, y, w, h, r, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;

export function cardSvg(R, logoB64) {
  const W = 1080, H = 1350; let o = '';
  o += box(0, 0, W, H, 0, '#f4f6f9');
  // header
  o += box(0, 0, W, 190, 0, NAVY);
  o += `<circle cx="${W - 60}" cy="40" r="170" fill="${AQUA}" fill-opacity="0.08"/><circle cx="${W - 60}" cy="40" r="100" fill="${AQUA}" fill-opacity="0.07"/>`;
  if (logoB64) o += `<image href="data:image/png;base64,${logoB64}" x="70" y="40" height="74" width="300" preserveAspectRatio="xMinYMid meet"/>`;
  o += T(72, 160, (R.period === 'week' ? 'Haftalik' : 'Oylik') + ' hisobot · ' + R.label, 27, 700, AQUA);
  // name
  o += T(70, 268, ellip(R.name, 52, W - 140, 800), 52, 800, NAVY);
  o += T(72, 308, [R.group, R.teacher].filter(Boolean).join(' · '), 26, 600, MUTED);
  // ring card
  o += box(50, 340, 440, 360, 28, '#fff');
  const cx = 270, cy = 505, r = 118, C = 2 * Math.PI * r;
  o += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e8edf3" stroke-width="28"/>`;
  if (R.pct != null) { const f = Math.max(0.005, Math.min(1, R.pct / 100)); o += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${pcolor(R.pct)}" stroke-width="28" stroke-linecap="${R.pct >= 95 ? 'butt' : 'round'}" stroke-dasharray="${(C * f).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`; }
  o += T(cx, cy + 16, fmtP(R.pct), 72, 800, NAVY, 'middle');
  o += T(cx, cy + 56, 'o‘rtacha bajarish', 20, 600, MUTED, 'middle');
  o += T(cx, 676, statusLabel(R.pct), 26, 700, pcolor(R.pct), 'middle');
  // tiles
  const tiles = [
    ['Vazifalar', `${R.checked} / ${R.total}`, 'baholangan', null],
    ['Saralash testlari', fmtP(R.salPct), R.salN ? `${R.salN} ta test` : 'bu davrda yo‘q', R.salPct],
    ['Bajarilmagan vazifa', `${R.missed}`, `kelmadi: ${R.absent}${R.owed ? ` · qarz: ${R.owed}` : ''}`, null],
  ];
  tiles.forEach((t, i) => {
    const y = 340 + i * 124; o += box(520, y, 510, 112, 22, '#fff');
    o += T(548, y + 38, t[0], 24, 600, MUTED);
    o += T(548, y + 90, t[1], 44, 800, t[3] != null ? pcolor(t[3]) : NAVY);
    o += T(1006, y + 88, t[2], 22, 500, SOFT, 'end');
  });
  // ranks
  let y = 720;
  if (R.oylik !== undefined) {
    // oylik karta: guruhda · markazda · oylik test
    const boxes = [['Guruhda', R.rankGroup, R.groupSize, 'o‘rin'], ['Markazda', R.rankCenter, R.centerSize, 'o‘rin']];
    boxes.forEach((k, i) => { const x = 50 + i * 330; o += box(x, y, 310, 96, 22, '#fff');
      o += T(x + 24, y + 40, k[0] + ' ' + k[3], 22, 600, MUTED);
      o += `<text x="${x + 24}" y="${y + 82}" font-family="Satoshi"><tspan font-size="38" font-weight="900" fill="${NAVY}">${k[1] == null ? '—' : k[1]}</tspan><tspan font-size="22" font-weight="700" fill="${SOFT}">${k[1] == null ? '' : ' / ' + k[2]}</tspan></text>`; });
    const ox = 710; o += box(ox, y, 320, 96, 22, R.oylik.pct == null ? '#fff' : pcolor(R.oylik.pct));
    const fg = R.oylik.pct == null ? MUTED : '#fff';
    o += T(ox + 24, y + 40, 'Oylik test', 22, 700, fg);
    o += T(ox + 24, y + 82, R.oylik.pct == null ? '—' : R.oylik.pct + '%', 38, 900, R.oylik.pct == null ? NAVY : '#fff');
    if (R.oylik.pct != null && R.oylik.n > 1) o += T(ox + 296, y + 80, `${R.oylik.rank}-o‘rin / ${R.oylik.n}`, 20, 700, fg, 'end');
  } else
  [['Guruhdagi o‘rni', R.rankGroup, R.groupSize], ['Markazdagi o‘rni', R.rankCenter, R.centerSize]].forEach((k, i) => {
    const x = 50 + i * 500; o += box(x, y, 480, 96, 22, '#fff');
    o += T(x + 28, y + 58, k[0], 26, 600, MUTED);
    o += `<text x="${x + 452}" y="${y + 64}" font-family="Satoshi" text-anchor="end"><tspan font-size="48" font-weight="900" fill="${NAVY}">${k[1] == null ? '—' : k[1]}</tspan><tspan font-size="26" font-weight="700" fill="${SOFT}">${k[1] == null ? '' : ' / ' + k[2]}</tspan></text>`;
  });
  // trend
  y = 836; o += box(50, y, 980, 134, 22, '#fff');
  o += T(78, y + 42, 'So‘nggi 4 hafta', 26, 700, NAVY);
  if (R.pct != null && R.prevPct != null) { const d = Math.round(R.pct - R.prevPct); o += T(1002, y + 42, `${d > 0 ? '▲ +' : d < 0 ? '− ' : ''}${Math.abs(d) === d ? d : Math.abs(d)}% ${R.period === 'week' ? 'o‘tgan haftaga' : 'o‘tgan oyga'} nisbatan`, 24, 700, d > 0 ? '#0b8a0b' : d < 0 ? '#c33' : MUTED, 'end'); }
  R.weeks.forEach((w, i) => {
    const bx = 78 + i * 238, bw = 210, by = y + 56, bh = 60;
    o += box(bx, by, bw, bh, 12, '#eef1f5');
    if (w.pct != null) o += box(bx, by, Math.max(14, bw * w.pct / 100), bh, 12, pcolor(w.pct));
    const fg = w.pct != null && w.pct > 35 ? '#fff' : NAVY;
    o += T(bx + 14, by + 30, fmtP(w.pct), 26, 800, fg);
    o += T(bx + 14, by + 52, w.label, 18, 600, fg);
  });
  // tasks
  y = 990; const bottom = H - 92 - 18; const avail = bottom - y;
  const maxRows = Math.max(1, Math.floor((avail - 70 - 30) / 38));
  const items = R.list.slice(-maxRows); const more = R.list.length - items.length;
  const listH = Math.min(avail, 70 + Math.max(1, items.length) * 38 + (more > 0 ? 30 : 6));
  o += box(50, y, 980, listH, 22, '#fff');
  o += T(78, y + 42, 'Vazifalar', 26, 700, NAVY);
  items.forEach((t, i) => {
    const ry = y + 84 + i * 38;
    o += T(78, ry, t.dateLabel, 21, 500, MUTED);
    o += T(220, ry, ellip(t.title, 22, 560, 600), 22, 600, NAVY);
    const w = tw(t.lab, 20, 700) + 28;
    o += box(1000 - w, ry - 25, w, 34, 17, t.bg);
    o += T(1000 - w / 2, ry - 1, t.lab, 20, 700, t.fg, 'middle');
  });
  if (!items.length) o += T(78, y + 90, 'Bu davrda vazifa berilmagan', 22, 500, SOFT);
  if (more > 0) o += T(78, y + listH - 14, `+ yana ${more} ta vazifa (oldingi kunlar)`, 19, 500, SOFT);
  // footer
  o += box(0, H - 92, W, 92, 0, AQUA);
  o += T(W / 2, H - 36, 'ILMZOR — ILM BOG‘INGIZ', 32, 800, NAVY, 'middle');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${o}</svg>`;
}

export function oylikSvg(R, logoB64) {
  const W = 1080, H = 1350; let o = '';
  o += box(0, 0, W, H, 0, '#f4f6f9');
  o += box(0, 0, W, 190, 0, NAVY);
  o += `<circle cx="${W - 60}" cy="40" r="170" fill="${AQUA}" fill-opacity="0.08"/><circle cx="${W - 60}" cy="40" r="100" fill="${AQUA}" fill-opacity="0.07"/>`;
  if (logoB64) o += `<image href="data:image/png;base64,${logoB64}" x="70" y="40" height="74" width="300" preserveAspectRatio="xMinYMid meet"/>`;
  o += T(72, 160, 'Oylik test natijasi · ' + R.label, 27, 700, AQUA);
  o += T(70, 268, ellip(R.name, 52, W - 140, 800), 52, 800, NAVY);
  o += T(72, 308, [R.group, R.teacher].filter(Boolean).join(' · '), 26, 600, MUTED);
  // big ring
  o += box(50, 340, 520, 430, 28, '#fff');
  const cx = 310, cy = 530, r = 140, C = 2 * Math.PI * r;
  o += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e8edf3" stroke-width="34"/>`;
  if (R.pct != null) { const f = Math.max(0.005, Math.min(1, R.pct / 100)); o += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${pcolor(R.pct)}" stroke-width="34" stroke-linecap="${R.pct >= 95 ? 'butt' : 'round'}" stroke-dasharray="${(C * f).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`; }
  o += T(cx, cy + 24, fmtP(R.pct), 92, 900, NAVY, 'middle');
  o += T(cx, cy + 66, 'oylik test', 22, 600, MUTED, 'middle');
  o += T(cx, 740, statusLabel(R.pct), 30, 800, pcolor(R.pct), 'middle');
  // tiles
  const d = R.prevPct != null && R.pct != null ? Math.round(R.pct - R.prevPct) : null;
  const tiles = [
    ['Guruhdagi o‘rni', R.rank != null ? String(R.rank) : '—', R.n ? `${R.n} kishidan` : '', NAVY],
    ['Guruh o‘rtachasi', fmtP(R.avg), R.avg != null && R.pct != null ? (R.pct >= R.avg ? 'o‘rtachadan yuqori' : 'o‘rtachadan past') : '', R.avg != null ? pcolor(R.avg) : NAVY],
    ['O‘tgan oyga nisbatan', d == null ? '—' : (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d) + '%', R.prevLabel || 'birinchi oy', d == null ? NAVY : d > 0 ? '#0b8a0b' : d < 0 ? '#c33' : MUTED],
  ];
  tiles.forEach((t, i) => { const y = 340 + i * 146; o += box(600, y, 430, 130, 22, '#fff');
    o += T(628, y + 42, t[0], 24, 600, MUTED); o += T(628, y + 104, t[1], 52, 900, t[3]); o += T(1006, y + 102, t[2], 21, 600, SOFT, 'end'); });
  // history chart
  const y0 = 800, ch = 330; o += box(50, y0, 980, ch + 70, 22, '#fff');
  o += T(78, y0 + 44, 'Oylar boʻyicha'.replace('ʻ', '‘'), 26, 700, NAVY);
  const hist = R.history.slice(-9); const n = Math.max(hist.length, 1);
  const gap = 18, bw = Math.min(120, (920 - gap * (n - 1)) / n), base = y0 + ch + 10, top = y0 + 90, hh = base - top - 40;
  const x0 = 78 + (920 - (bw * n + gap * (n - 1))) / 2;
  o += `<line x1="78" y1="${base}" x2="1002" y2="${base}" stroke="#e3e8ef" stroke-width="2"/>`;
  hist.forEach((m, i) => { const x = x0 + i * (bw + gap), h = Math.max(6, hh * m.pct / 100), last = i === hist.length - 1;
    o += box(x, base - h, bw, h, 12, pcolor(m.pct)); if (!last) o += `<rect x="${x}" y="${base - h}" width="${bw}" height="${h}" rx="12" fill="#fff" fill-opacity="0.35"/>`;
    o += T(x + bw / 2, base - h - 12, m.pct + '%', 24, 800, NAVY, 'middle');
    o += T(x + bw / 2, base + 32, m.short, 20, last ? 800 : 600, last ? NAVY : MUTED, 'middle'); });
  if (!hist.length) o += T(540, y0 + 200, 'Hali natija yoʻq'.replace('ʻ', '‘'), 24, 500, SOFT, 'middle');
  o += T(540, H - 118, 'Oylik test vazifa foiziga qoʻshilmaydi — alohida baholanadi'.replace('ʻ', '‘'), 20, 500, SOFT, 'middle');
  o += box(0, H - 92, W, 92, 0, AQUA);
  o += T(W / 2, H - 36, 'ILMZOR — ILM BOG‘INGIZ', 32, 800, NAVY, 'middle');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${o}</svg>`;
}
export async function renderSvgPng(svg, opts) {
  await ready;
  const r = new Resvg(svg, { font: { fontBuffers: opts.fonts, defaultFontFamily: 'Satoshi', loadSystemFonts: false }, fitTo: { mode: 'original' } });
  const png = r.render().asPng(); r.free(); return png;
}
export async function renderPng(R, opts) {
  await ready;
  const svg = cardSvg(R, opts.logoB64);
  const r = new Resvg(svg, { font: { fontBuffers: opts.fonts, defaultFontFamily: 'Satoshi', loadSystemFonts: false }, fitTo: { mode: 'original' } });
  const png = r.render().asPng(); r.free(); return png;
}
