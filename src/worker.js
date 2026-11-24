// Ilmzor — Vazifalar va ballar (server). Cloudflare Worker + D1.
// Roles: admin (rahbar) sees everything; teacher sees only own students/tasks.
// Public: /reyting page and /api/public/* (ranking only — no task details).
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
  const out = rated.map(x => ({ name: x.name, group: x.group, teacher: x.teacher, gkey: x.gkey, pct: Math.round(x.pct * 10) / 10, ball: Math.round(x.b * 10) / 10, max: x.m, n: x.n, rankCenter: x.rankCenter, rankGroup: x.rankGroup, groupSize: x.groupSize }));
  return { period, from, to, today, total: rated.length, list: out };
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
        return json(r, 200, { 'access-control-allow-origin': '*' });
      }
      if (M === 'GET' && p === '/api/public/find') { // for the Telegram bot: ?q=name&p=month|week
        const q = norm(url.searchParams.get('q')); if (q.length < 3) return json({ matches: [] }, 200, { 'access-control-allow-origin': '*' });
        const r = await ranking(env, url.searchParams.get('p') === 'week' ? 'week' : 'month', null);
        const words = q.split(' ');
        const matches = r.list.filter(x => { const n = norm(x.name); return words.every(w => n.includes(w)); }).slice(0, 5).map(x => ({ ...x, total: r.total }));
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
