// Ilmzor — Vazifalar va ballar (server). Cloudflare Worker + D1.
// Roles: admin (rahbar) sees everything; teacher sees only own students/tasks.
// Public: /reyting page and /api/public/* (ranking only — no task details).
import { initCard, renderPng, pcolor as cardColor } from './card.mjs';
import RESVG_WASM from './resvg.wasm';
import { SATOSHI_MEDIUM, SATOSHI_BOLD, SATOSHI_BLACK } from './fonts.mjs';
/*__ASSETS__*/

const DEADLINE_DAYS = 2;
const SESSION_DAYS = 60;

const enc = new TextEncoder();
const json = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...h } });
const err = (msg, s = 400, code = 'invalid_argument') => json({ error: msg, code }, s);
const rid = (n = 20) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join(''); };
const normPhone = p => { const s = String(p || '').trim().toLowerCase(); if (s === 'admin') return 'admin'; const d = s.replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : d; };
function genPassword() { const a = new Uint8Array(6); crypto.getRandomValues(a); const w = 'abcdefghjkmnpqrstuvwxyz'; return [...a].slice(0, 3).map(b => w[b % w.length]).join('') + String(100 + (a[3] * 256 + a[4]) % 900); }
async function hashPw(pw, salt) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const b = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, k, 256);
  return btoa(String.fromCharCode(...new Uint8Array(b)));
}
function cookie(req, name) { const c = req.headers.get('cookie') || ''; const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)')); return m ? decodeURIComponent(m[1]) : null; }

async function ensureSchema(env) {
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT, phone TEXT UNIQUE, role TEXT, salt TEXT, hash TEXT, active INTEGER DEFAULT 1, created INTEGER)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT, expires INTEGER)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS docs(coll TEXT, id TEXT, teacher_id TEXT, data TEXT, updated INTEGER, PRIMARY KEY(coll,id))'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS docs_t ON docs(coll, teacher_id)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS codes(code TEXT PRIMARY KEY, student_id TEXT UNIQUE, created INTEGER)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS claims(student_id TEXT PRIMARY KEY, tg TEXT, ts INTEGER)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS subs(task_id TEXT, student_id TEXT, ts INTEGER, PRIMARY KEY(task_id, student_id))'),
  ]);
}
async function me(req, env) {
  const t = cookie(req, 'sid'); if (!t) return null;
  const r = await env.DB.prepare('SELECT u.id,u.name,u.phone,u.role,u.active FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').bind(t, Date.now()).first();
  return r && r.active ? r : null;
}

/* ---------- docs (students / tasks) ---------- */
const COLLS = ['students', 'tasks'];
async function listDocs(env, coll, user) {
  const q = user.role === 'admin'
    ? env.DB.prepare('SELECT id,data,teacher_id FROM docs WHERE coll=?').bind(coll)
    : env.DB.prepare('SELECT id,data,teacher_id FROM docs WHERE coll=? AND teacher_id=?').bind(coll, user.id);
  const { results } = await q.all();
  return results.map(r => ({ id: r.id, data: JSON.parse(r.data) }));
}
async function getDoc(env, coll, id) { const r = await env.DB.prepare('SELECT data,teacher_id FROM docs WHERE coll=? AND id=?').bind(coll, id).first(); return r ? { data: JSON.parse(r.data), teacher_id: r.teacher_id } : null; }
async function myStudentIds(env, teacherId) { const { results } = await env.DB.prepare("SELECT id FROM docs WHERE coll='students' AND teacher_id=?").bind(teacherId).all(); return new Set(results.map(r => r.id)); }
// decide owner (teacher_id) of a doc being written; enforce teacher scope
async function ownerFor(env, coll, data, user, existing) {
  if (user.role !== 'admin') {
    if (existing && existing.teacher_id !== user.id) throw new Error('scope');
    if (coll === 'tasks') { const mine = await myStudentIds(env, user.id); for (const s of (data.studentIds || [])) if (!mine.has(s)) throw new Error('scope'); }
    return user.id;
  }
  if (coll === 'students') return data.teacherId || (existing && existing.teacher_id) || user.id;
  // admin writing a task: owner = teacher of its students (if all the same), else keep / admin
  if (existing && existing.teacher_id) return existing.teacher_id;
  const ids = data.studentIds || [];
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    const { results } = await env.DB.prepare(`SELECT DISTINCT teacher_id FROM docs WHERE coll='students' AND id IN (${ph})`).bind(...ids).all();
    if (results.length === 1) return results[0].teacher_id;
  }
  return user.id;
}
async function putDoc(env, coll, id, data, user, merge) {
  const ex = await getDoc(env, coll, id);
  if (merge) { if (!ex) throw new Error('missing'); data = { ...ex.data, ...data }; }
  if (coll === 'tasks') delete data.submitted;
  const owner = await ownerFor(env, coll, data, user, ex);
  if (coll === 'students') data.teacherId = owner;
  await env.DB.prepare('INSERT INTO docs(coll,id,teacher_id,data,updated) VALUES(?,?,?,?,?) ON CONFLICT(coll,id) DO UPDATE SET teacher_id=excluded.teacher_id,data=excluded.data,updated=excluded.updated')
    .bind(coll, id, owner, JSON.stringify(data), Date.now()).run();
}

/* ---------- ranking (same rules as the app) ---------- */
const ymd = d => d.toISOString().slice(0, 10);
function tashkentToday() { return ymd(new Date(Date.now() + 5 * 3600e3)); }
function addDays(s, n) { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd(d); }
function periodRange(p, anchor) {
  const a = new Date(anchor + 'T00:00:00Z');
  if (p === 'week') { const dow = (a.getUTCDay() + 6) % 7; const s = addDays(anchor, -dow); return [s, addDays(s, 6)]; }
  if (p === 'all') return ['0000-00-00', '9999-12-31'];
  const s = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1)); const e = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 0));
  return [ymd(s), ymd(e)];
}
async function ranking(env, period, anchor) {
  const today = tashkentToday(); anchor = anchor || today;
  const [from, to] = periodRange(period, anchor);
  const [{ results: S }, { results: T }, { results: U }] = await Promise.all([
    env.DB.prepare("SELECT id,data,teacher_id FROM docs WHERE coll='students'").all(),
    env.DB.prepare("SELECT data FROM docs WHERE coll='tasks'").all(),
    env.DB.prepare('SELECT id,name FROM users').all(),
  ]);
  const tname = Object.fromEntries(U.map(u => [u.id, u.name]));
  const st = {}; for (const r of S) { const d = JSON.parse(r.data); if (d.archived) continue; st[r.id] = { name: d.name, group: d.group || 'Guruhsiz', teacher: tname[r.teacher_id] || '', gkey: r.teacher_id + '|' + (d.group || 'Guruhsiz'), b: 0, m: 0, n: 0 }; }
  for (const r of T) {
    const t = JSON.parse(r.data); if (!t.date || t.date < from || t.date > to || t.date > today) continue;
    const max = Number(t.max) || 0; if (!max) continue; const sc = t.scores || {}, ab = t.absent || {}, ow = t.owed || {};
    for (const id of (t.studentIds || [])) {
      const x = st[id]; if (!x || ab[id]) continue; const v = sc[id]; let ball;
      if (v !== undefined && v !== null && v !== '') ball = Number(v);
      else if (ow[id]) continue;
      else if (addDays(t.date, DEADLINE_DAYS) < today) ball = 0;
      else continue;
      x.b += ball; x.m += max; x.n++;
    }
  }
  const list = Object.entries(st).map(([id, x]) => ({ id, ...x, pct: x.m ? Math.min(100, x.b / x.m * 100) : null }));
  const rated = list.filter(x => x.pct != null).sort((a, b) => b.pct - a.pct || b.b - a.b);
  const rankOf = arr => { let prev = null, r = 0; arr.forEach((x, i) => { if (!prev || x.pct < prev.pct - 1e-9) r = i + 1; x._r = r; prev = x; }); };
  rankOf(rated); rated.forEach(x => x.rankCenter = x._r);
  const groups = {}; rated.forEach(x => (groups[x.gkey] = groups[x.gkey] || []).push(x));
  Object.values(groups).forEach(g => { rankOf(g); g.forEach(x => { x.rankGroup = x._r; x.groupSize = g.length; }); });
  const out = rated.map(x => ({ sid: x.id, name: x.name, group: x.group, teacher: x.teacher, gkey: x.gkey, pct: Math.round(x.pct * 10) / 10, ball: Math.round(x.b * 10) / 10, max: x.m, n: x.n, rankCenter: x.rankCenter, rankGroup: x.rankGroup, groupSize: x.groupSize }));
  return { period, from, to, today, total: rated.length, list: out };
}
/* ---------- natija kartasi (PNG) ---------- */
const MONS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const DSH = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'];
const b64u8 = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
let FONTS = null;
function rangeLabel(p, from, to) {
  const a = new Date(from + 'T00:00:00Z'), b = new Date(to + 'T00:00:00Z');
  if (p === 'month') return MONS[a.getUTCMonth()][0].toUpperCase() + MONS[a.getUTCMonth()].slice(1) + ' ' + a.getUTCFullYear();
  return a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${b.getUTCDate()}-${MONS[b.getUTCMonth()]}` : `${a.getUTCDate()}-${MONS[a.getUTCMonth()]} – ${b.getUTCDate()}-${MONS[b.getUTCMonth()]}`;
}
function cardStats(rows, today) {
  let b = 0, m = 0, checked = 0, zero = 0, abs = 0, owed = 0, od = 0;
  for (const t of rows) {
    if (t.status === 'absent') { abs++; continue; }
    if (t.status === 'done') { checked++; b += t.ball; m += t.max; if (t.ball === 0) zero++; continue; }
    if (t.status === 'owed') { owed++; continue; }
    if (t.deadline < today) { od++; m += t.max; }
  }
  return { pct: m ? Math.min(100, b / m * 100) : null, checked, zero, abs, owed, od, total: rows.length - abs };
}
async function cardPng(env, V, p) {
  await initCard(RESVG_WASM);
  if (!FONTS) FONTS = [b64u8(SATOSHI_MEDIUM), b64u8(SATOSHI_BOLD), b64u8(SATOSHI_BLACK)];
  const today = V.today; const [from, to] = periodRange(p, today);
  const inR = (f, t) => V.tasks.filter(x => x.date >= f && x.date <= t && x.date <= today);
  const rows = inR(from, to); const st = cardStats(rows, today);
  const sal = cardStats(rows.filter(x => x.type === 'Saralash testi'), today);
  const [pf, pt] = p === 'week' ? [addDays(from, -7), addDays(from, -1)] : periodRange('month', addDays(from, -1));
  const prev = cardStats(inR(pf, pt), today);
  const [wk0] = periodRange('week', today); const weeks = [];
  for (let i = 3; i >= 0; i--) { const f = addDays(wk0, -7 * i), t = addDays(f, 6); const a = new Date(f + 'T00:00:00Z'), b = new Date(t + 'T00:00:00Z');
    weeks.push({ label: `${a.getUTCDate()}–${b.getUTCDate()} ${MONS[b.getUTCMonth()].slice(0, 3)}`, pct: cardStats(inR(f, t), today).pct }); }
  const rk = p === 'week' ? V.week : V.month;
  const list = [...rows].sort((a, b) => a.date.localeCompare(b.date)).map(t => {
    const d = new Date(t.date + 'T00:00:00Z'); const dateLabel = `${d.getUTCDate()}-${MONS[d.getUTCMonth()].slice(0, 3)}, ${DSH[d.getUTCDay()]}`;
    let lab, bg, fg = '#0e223a';
    if (t.status === 'absent') { lab = 'Kelmadi'; bg = '#e4e8ee'; }
    else if (t.status === 'done') { lab = `${Math.round(t.ball * 10) / 10}/${t.max}`; bg = cardColor(t.pct); fg = '#fff'; }
    else if (t.status === 'owed') { lab = 'Qarzdor'; bg = '#ece3fa'; }
    else if (t.deadline < today) { lab = 'Bajarmadi'; bg = '#d03b3b'; fg = '#fff'; }
    else { lab = t.status === 'submitted' ? 'tekshirilmoqda' : 'kutilmoqda'; bg = '#f1f3f6'; }
    return { dateLabel, title: t.title, lab, bg, fg };
  });
  const R = { period: p, label: rangeLabel(p, from, to), name: V.student.name, group: V.student.group, teacher: V.student.teacher,
    pct: st.pct, prevPct: prev.pct, checked: st.checked, total: st.total, salPct: sal.pct, salN: sal.checked + sal.od, missed: st.zero + st.od, absent: st.abs, owed: st.owed,
    rankGroup: rk ? rk.rankGroup : null, groupSize: rk ? rk.groupSize : null, rankCenter: rk ? rk.rankCenter : null, centerSize: rk ? rk.total : null, weeks, list };
  return renderPng(R, { fonts: FONTS, logoB64: ASSETS['/brand/logo-gorizontal.png'].b64 });
}
const pub = r => ({ ...r, list: r.list.map(({ sid, ...x }) => x) });

/* ---------- student codes & self-view ---------- */
const CODE_ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newStudentCode() { const a = new Uint8Array(6); crypto.getRandomValues(a); return [...a].map(b => CODE_ALPH[b % 32]).join(''); }
async function ensureCodes(env, ids) {
  if (!ids.length) return {};
  const { results } = await env.DB.prepare('SELECT code,student_id FROM codes').all();
  const map = {}; for (const r of results) map[r.student_id] = r.code;
  const used = new Set(results.map(r => r.code)); const st = [];
  for (const id of ids) if (!map[id]) { let c; do c = newStudentCode(); while (used.has(c)); used.add(c); map[id] = c; st.push(env.DB.prepare('INSERT INTO codes(code,student_id,created) VALUES(?,?,?)').bind(c, id, Date.now())); }
  for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
  return Object.fromEntries(ids.map(id => [id, map[id]]));
}
async function studentByCode(env, code) {
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if (code.length !== 6) return null;
  const r = await env.DB.prepare("SELECT c.student_id id, d.data, d.teacher_id FROM codes c JOIN docs d ON d.coll='students' AND d.id=c.student_id WHERE c.code=?").bind(code).first();
  if (!r) return null; const d = JSON.parse(r.data); if (d.archived) return null;
  return { id: r.id, data: d, teacher_id: r.teacher_id };
}
async function studentView(env, s) {
  const today = tashkentToday(); const sid = s.id;
  const [{ results: T }, { results: SB }, tu, rm, rw] = await Promise.all([
    env.DB.prepare("SELECT id,data FROM docs WHERE coll='tasks' AND data LIKE ?").bind('%"' + sid + '"%').all(),
    env.DB.prepare('SELECT task_id,ts FROM subs WHERE student_id=?').bind(sid).all(),
    env.DB.prepare('SELECT name FROM users WHERE id=?').bind(s.teacher_id).first(),
    ranking(env, 'month'), ranking(env, 'week'),
  ]);
  const sub = Object.fromEntries(SB.map(r => [r.task_id, r.ts]));
  const tasks = [];
  for (const r of T) {
    const t = JSON.parse(r.data); if (!(t.studentIds || []).includes(sid) || !t.date) continue;
    const max = Number(t.max) || 0, v = (t.scores || {})[sid], dl = addDays(t.date, DEADLINE_DAYS);
    const graded = v !== undefined && v !== null && v !== '';
    let status;
    if ((t.absent || {})[sid]) status = 'absent';
    else if (graded) status = 'done';
    else if (sub[r.id]) status = 'submitted';
    else if ((t.owed || {})[sid]) status = 'owed';
    else if (dl < today) status = 'overdue';
    else status = 'pending';
    const ball = graded ? Number(v) : null;
    tasks.push({ id: r.id, title: t.title || 'Vazifa', type: t.type || '', date: t.date, deadline: dl, max, note: t.note || '', status, ball, pct: graded && max ? Math.round(Math.min(100, ball / max * 100)) : null, submittedAt: sub[r.id] || null, late: !!(sub[r.id] && ymd(new Date(sub[r.id] + 5 * 3600e3)) > dl) });
  }
  tasks.sort((a, b) => b.date.localeCompare(a.date));
  const pick = r => { const x = r.list.find(y => y.sid === sid); return x ? { pct: x.pct, ball: x.ball, max: x.max, rankGroup: x.rankGroup, groupSize: x.groupSize, rankCenter: x.rankCenter, total: r.total } : null; };
  return { student: { name: s.data.name, group: s.data.group || 'Guruhsiz', teacher: tu ? tu.name : '' }, today, month: pick(rm), week: pick(rw), from: rm.from, to: rm.to, tasks };
}
const norm = s => String(s || '').toLowerCase().replace(/[‘’ʻʼ`']/g, '').replace(/\s+/g, ' ').trim();

/* ---------- main ---------- */
export default {
  async fetch(req, env) {
    const url = new URL(req.url); const p = url.pathname; const M = req.method;
    try {
      if (!globalThis.__schema) { await ensureSchema(env); globalThis.__schema = true; }
      // static
      if (M === 'GET' && (p === '/' || p === '/index.html')) return new Response(APP_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
      if (M === 'GET' && (p === '/reyting' || p === '/reyting/')) return new Response(RANK_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
      if (M === 'GET' && ASSETS[p]) { const a = ASSETS[p]; const bin = Uint8Array.from(atob(a.b64), c => c.charCodeAt(0)); return new Response(bin, { headers: { 'content-type': a.type, 'cache-control': 'public, max-age=604800' } }); }

      // public ranking (no task details)
      if (M === 'GET' && p === '/api/public/ranking') {
        const r = await ranking(env, url.searchParams.get('p') === 'week' ? 'week' : url.searchParams.get('p') === 'all' ? 'all' : 'month', url.searchParams.get('d'));
        return json(pub(r), 200, { 'access-control-allow-origin': '*' });
      }
      // bot-only (reachable just through the service binding, host "baho"): student gets own code by name
      if (p === '/api/bot/claim' && M === 'POST') {
        if (url.hostname !== 'baho') return err('Topilmadi', 404, 'not_found');
        const b = await req.json().catch(() => ({})); const tg = String(b.tg || ''); if (!tg) return err('tg kerak');
        const { results } = await env.DB.prepare("SELECT d.id, d.data, d.teacher_id, u.name tname FROM docs d LEFT JOIN users u ON u.id=d.teacher_id WHERE d.coll='students'").all();
        const key = s => norm(s).split(' ').filter(Boolean).sort().join(' ');
        const want = key(b.name);
        let cands = results.map(r => ({ id: r.id, d: JSON.parse(r.data), tname: r.tname || '' })).filter(x => !x.d.archived && key(x.d.name) === want && want.split(' ').length >= 2);
        if (b.sid) cands = cands.filter(x => x.id === b.sid);
        if (!cands.length) return json({ status: 'notfound' });
        if (cands.length > 1) return json({ status: 'many', options: cands.map(x => ({ sid: x.id, name: x.d.name, group: x.d.group || 'Guruhsiz', teacher: x.tname })) });
        const x = cands[0];
        const cl = await env.DB.prepare('SELECT tg FROM claims WHERE student_id=?').bind(x.id).first();
        // nobind: staff (ustoz/rahbar) just looks — never binds or blocks the student's own Telegram
        if (cl && cl.tg !== tg && !b.nobind) return json({ status: 'taken', name: x.d.name, group: x.d.group || 'Guruhsiz', teacher: x.tname });
        if (b.probe) return json({ status: 'ok' });
        if (!cl && !b.nobind) await env.DB.prepare('INSERT INTO claims(student_id,tg,ts) VALUES(?,?,?)').bind(x.id, tg, Date.now()).run();
        const codes = await ensureCodes(env, [x.id]);
        return json({ status: 'ok', code: codes[x.id], name: x.d.name, group: x.d.group || 'Guruhsiz', teacher: x.tname });
      }
      if (M === 'GET' && (p === '/men' || p === '/men/')) return new Response(STU_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
      // student self-view by personal code (web page /men and Telegram bot)
      if (p.startsWith('/api/s/')) {
        const code = req.headers.get('x-code') || url.searchParams.get('code');
        const s = await studentByCode(env, code);
        if (!s) { await new Promise(r => setTimeout(r, 400)); return err('Kod noto‘g‘ri yoki o‘quvchi topilmadi', 404, 'not_found'); }
        if (M === 'GET' && p === '/api/s/me') return json(await studentView(env, s));
        if (M === 'GET' && p === '/api/s/card.png') {
          const per = url.searchParams.get('p') === 'week' ? 'week' : 'month';
          const png = await cardPng(env, await studentView(env, s), per);
          const fn = `ilmzor-${per === 'week' ? 'haftalik' : 'oylik'}-${String(s.data.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
          return new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'no-store', 'content-disposition': `${url.searchParams.get('dl') ? 'attachment' : 'inline'}; filename="${fn}"` } });
        }
        if (M === 'POST' && (p === '/api/s/submit' || p === '/api/s/unsubmit')) {
          const b = await req.json().catch(() => ({})); const t = await getDoc(env, 'tasks', String(b.taskId || ''));
          if (!t || !(t.data.studentIds || []).includes(s.id)) return err('Vazifa topilmadi', 404, 'not_found');
          const v = (t.data.scores || {})[s.id]; if (v !== undefined && v !== null && v !== '') return err('Bu vazifa allaqachon baholangan');
          if ((t.data.absent || {})[s.id]) return err('Bu kuni darsga kelmagansiz — vazifa hisobga kirmaydi');
          if (p === '/api/s/submit') await env.DB.prepare('INSERT OR REPLACE INTO subs(task_id,student_id,ts) VALUES(?,?,?)').bind(b.taskId, s.id, Date.now()).run();
          else await env.DB.prepare('DELETE FROM subs WHERE task_id=? AND student_id=?').bind(b.taskId, s.id).run();
          return json({ ok: true });
        }
        return err('Topilmadi', 404, 'not_found');
      }
      if (M === 'GET' && p === '/api/public/find') { // for the Telegram bot: ?q=name&p=month|week
        const q = norm(url.searchParams.get('q')); if (q.length < 3) return json({ matches: [] }, 200, { 'access-control-allow-origin': '*' });
        const r = await ranking(env, url.searchParams.get('p') === 'week' ? 'week' : 'month', null);
        const words = q.split(' ');
        const matches = pub(r).list.filter(x => { const n = norm(x.name); return words.every(w => n.includes(w)); }).slice(0, 5).map(x => ({ ...x, total: r.total }));
        return json({ period: r.period, from: r.from, to: r.to, total: r.total, matches }, 200, { 'access-control-allow-origin': '*' });
      }

      // auth
      if (M === 'POST' && p === '/api/setup') { // only when there are no users yet
        const c = await env.DB.prepare('SELECT COUNT(*) n FROM users').first(); if (c.n > 0) return err('Allaqachon sozlangan', 403);
        const b = await req.json(); const salt = rid(16); const pw = b.password || genPassword(); const id = 'u_' + rid(12);
        await env.DB.prepare('INSERT INTO users(id,name,phone,role,salt,hash,active,created) VALUES(?,?,?,?,?,?,1,?)').bind(id, b.name || 'Rahbar', normPhone(b.phone || 'admin'), 'admin', salt, await hashPw(pw, salt), Date.now()).run();
        return json({ ok: true, id, password: pw });
      }
      if (M === 'POST' && p === '/api/login') {
        const b = await req.json().catch(() => ({})); const ph = normPhone(b.phone);
        const u = await env.DB.prepare('SELECT * FROM users WHERE phone=? AND active=1').bind(ph).first();
        if (!u || (await hashPw(String(b.password || ''), u.salt)) !== u.hash) { await new Promise(r => setTimeout(r, 700)); return err('Telefon raqam yoki parol noto‘g‘ri', 401, 'auth'); }
        const t = rid(32); await env.DB.prepare('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)').bind(t, u.id, Date.now() + SESSION_DAYS * 864e5).run();
        return json({ ok: true, user: { id: u.id, name: u.name, role: u.role } }, 200, { 'set-cookie': `sid=${t}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}` });
      }
      if (M === 'POST' && p === '/api/logout') { const t = cookie(req, 'sid'); if (t) await env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(t).run(); return json({ ok: true }, 200, { 'set-cookie': 'sid=; Path=/; Max-Age=0' }); }

      const user = await me(req, env);
      if (p.startsWith('/api/') && !user) return err('Kirish kerak', 401, 'auth');
      if (M === 'GET' && p === '/api/me') return json({ id: user.id, name: user.name, role: user.role, phone: user.phone });
      if (M === 'POST' && p === '/api/password') { // change own password
        const b = await req.json(); if (!b.password || String(b.password).length < 6) return err('Parol kamida 6 belgi bo‘lsin');
        const u = await env.DB.prepare('SELECT salt,hash FROM users WHERE id=?').bind(user.id).first();
        if ((await hashPw(String(b.old || ''), u.salt)) !== u.hash) return err('Eski parol noto‘g‘ri', 403);
        const salt = rid(16); await env.DB.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').bind(salt, await hashPw(String(b.password), salt), user.id).run();
        return json({ ok: true });
      }

      // users
      if (p === '/api/users' && M === 'GET') {
        const { results } = await env.DB.prepare('SELECT id,name,phone,role,active,created FROM users ORDER BY created').all();
        return json({ users: user.role === 'admin' ? results : results.map(u => ({ id: u.id, name: u.name, role: u.role })) });
      }
      if (user.role === 'admin') {
        if (p === '/api/users' && M === 'POST') {
          const b = await req.json(); const ph = normPhone(b.phone); if (!b.name || !ph || ph.length < 9) return err('Ism va to‘liq telefon raqam kerak');
          const ex = await env.DB.prepare('SELECT id FROM users WHERE phone=?').bind(ph).first(); if (ex) return err('Bu raqam allaqachon bor');
          const pw = genPassword(); const salt = rid(16); const id = 'u_' + rid(12);
          await env.DB.prepare('INSERT INTO users(id,name,phone,role,salt,hash,active,created) VALUES(?,?,?,?,?,?,1,?)').bind(id, String(b.name).trim(), ph, b.role === 'admin' ? 'admin' : 'teacher', salt, await hashPw(pw, salt), Date.now()).run();
          return json({ ok: true, id, password: pw });
        }
        let m;
        if ((m = p.match(/^\/api\/users\/([\w]+)\/reset$/)) && M === 'POST') {
          const pw = genPassword(); const salt = rid(16);
          await env.DB.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').bind(salt, await hashPw(pw, salt), m[1]).run();
          await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(m[1]).run();
          return json({ ok: true, password: pw });
        }
        if ((m = p.match(/^\/api\/users\/([\w]+)$/)) && M === 'PATCH') {
          const b = await req.json(); if (m[1] === user.id && b.active === false) return err('O‘zingizni o‘chirib bo‘lmaydi');
          if (b.name) await env.DB.prepare('UPDATE users SET name=? WHERE id=?').bind(String(b.name).trim(), m[1]).run();
          if (b.phone) await env.DB.prepare('UPDATE users SET phone=? WHERE id=?').bind(normPhone(b.phone), m[1]).run();
          if (typeof b.active === 'boolean') { await env.DB.prepare('UPDATE users SET active=? WHERE id=?').bind(b.active ? 1 : 0, m[1]).run(); if (!b.active) await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(m[1]).run(); }
          return json({ ok: true });
        }
        if (p === '/api/assign-group' && M === 'POST') { // move a group (and its tasks) to a teacher
          const b = await req.json(); const { results } = await env.DB.prepare("SELECT id,data FROM docs WHERE coll='students' AND teacher_id=?").bind(b.from).all();
          const ids = results.filter(r => (JSON.parse(r.data).group || 'Guruhsiz') === b.group).map(r => r.id); if (!ids.length) return err('Guruh topilmadi');
          const st = []; for (const r of results) { const d = JSON.parse(r.data); if (ids.includes(r.id)) { d.teacherId = b.to; st.push(env.DB.prepare("UPDATE docs SET teacher_id=?,data=?,updated=? WHERE coll='students' AND id=?").bind(b.to, JSON.stringify(d), Date.now(), r.id)); } }
          const { results: tk } = await env.DB.prepare("SELECT id,data FROM docs WHERE coll='tasks' AND teacher_id=?").bind(b.from).all();
          const set = new Set(ids);
          const { results: allS } = await env.DB.prepare("SELECT id FROM docs WHERE coll='students'").all(); const exists = new Set(allS.map(r => r.id));
          for (const r of tk) { const d = JSON.parse(r.data); const s = (d.studentIds || []).filter(x => exists.has(x)); if (s.length && s.every(x => set.has(x))) st.push(env.DB.prepare("UPDATE docs SET teacher_id=? WHERE coll='tasks' AND id=?").bind(b.to, r.id)); }
          await env.DB.batch(st); return json({ ok: true, students: ids.length });
        }
        if (p === '/api/import' && M === 'POST') { // one-time migration: {students:[{id,data}], tasks:[{id,data}], teacherId}
          const b = await req.json(); const owner = b.teacherId || user.id; const st = [];
          for (const c of COLLS) for (const d of (b[c] || [])) { if (c === 'students') d.data.teacherId = owner; st.push(env.DB.prepare('INSERT OR REPLACE INTO docs(coll,id,teacher_id,data,updated) VALUES(?,?,?,?,?)').bind(c, d.id, owner, JSON.stringify(d.data), Date.now())); }
          for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
          return json({ ok: true, n: st.length });
        }
      }

      // student codes (teacher: own students; admin: all)
      if (p === '/api/codes' && M === 'GET') {
        const sts = (await listDocs(env, 'students', user)).filter(d => !d.data.archived);
        const { results: cl } = await env.DB.prepare('SELECT student_id FROM claims').all();
        const ids = new Set(sts.map(d => d.id));
        return json({ codes: await ensureCodes(env, sts.map(d => d.id)), linked: cl.map(r => r.student_id).filter(id => ids.has(id)) });
      }
      if (p === '/api/codes/reset' && M === 'POST') {
        const b = await req.json(); const d = await getDoc(env, 'students', String(b.id || ''));
        if (!d || (user.role !== 'admin' && d.teacher_id !== user.id)) return err('Ruxsat yo‘q', 403, 'permission_denied');
        await env.DB.batch([env.DB.prepare('DELETE FROM codes WHERE student_id=?').bind(b.id), env.DB.prepare('DELETE FROM claims WHERE student_id=?').bind(b.id)]);
        return json({ codes: await ensureCodes(env, [b.id]) });
      }
      // "bajardim" submissions waiting for the teacher
      if (p === '/api/subs' && M === 'GET') {
        const tasks = await listDocs(env, 'tasks', user); const ids = new Set(tasks.map(t => t.id));
        const { results } = await env.DB.prepare('SELECT task_id,student_id,ts FROM subs').all();
        return json({ subs: results.filter(r => ids.has(r.task_id)) });
      }
      if (p === '/api/subs' && M === 'DELETE') {
        const b = await req.json(); const t = await getDoc(env, 'tasks', String(b.taskId || ''));
        if (!t || (user.role !== 'admin' && t.teacher_id !== user.id)) return err('Ruxsat yo‘q', 403, 'permission_denied');
        await env.DB.prepare('DELETE FROM subs WHERE task_id=? AND student_id=?').bind(b.taskId, b.studentId).run(); return json({ ok: true });
      }

      // collections
      const cm = p.match(/^\/api\/c\/(students|tasks)(?:\/([\w.\-:@+~]+))?$/);
      if (cm) {
        const [, coll, id] = cm;
        if (M === 'GET' && !id) return json({ docs: await listDocs(env, coll, user) });
        if (M === 'POST' && !id) { const data = await req.json(); const nid = rid(20); await putDoc(env, coll, nid, data, user, false); return json({ id: nid }); }
        if (id && (M === 'PUT' || M === 'PATCH')) { const data = await req.json(); await putDoc(env, coll, id, data, user, M === 'PATCH'); return json({ ok: true }); }
        if (id && M === 'DELETE') {
          const ex = await getDoc(env, coll, id); if (!ex) return json({ ok: true });
          if (user.role !== 'admin' && ex.teacher_id !== user.id) return err('Ruxsat yo‘q', 403);
          await env.DB.prepare('DELETE FROM docs WHERE coll=? AND id=?').bind(coll, id).run(); return json({ ok: true });
        }
      }
      return err('Topilmadi', 404);
    } catch (e) {
      if (String(e && e.message) === 'scope') return err('Bu sizning guruhingiz emas', 403);
      if (String(e && e.message) === 'missing') return err('Topilmadi', 404);
      return err('Server xatosi: ' + (e && e.message), 500, 'unavailable');
    }
  },
};
