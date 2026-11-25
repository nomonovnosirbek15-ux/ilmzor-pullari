// Ilmzor test boti v2 — Cloudflare Workers + D1 (bepul tarif)
// Sozlamalar (Cloudflare → Worker → Settings):
//   DB               — D1 bazasi (Bindings)
//   BOT_TOKEN        — BotFather bergan token (Secret)
//   WEBHOOK_SECRET   — Telegram webhook kaliti (Secret)
//   TEACHER_PASSWORD — ustozlar paroli (Secret)
//   CEO_PASSWORD     — CEO paroli: /ceo PAROL (Secret, tavsiya etiladi). Oʻrnatilmagan boʻlsa, CEO yoʻq vaqtda birinchi marta ADMIN_PASSWORD ham ishlaydi
//   ADMIN_PASSWORD   — umumiy admin paroli (/admin PAROL): varonka, arizalar, kurslar, statistika. Yaxshisi shaxsiy kod ishlating
//   IMPORT_KEY       — Google Sheets'dan oylik natijalarni qabul qilish kaliti (Secret)
//   VOUCHER_KEY      — (ixtiyoriy) vaucher havolasini imzolash kaliti; yoʻq boʻlsa WEBHOOK_SECRET ishlatiladi (Secret)
//   Trigger events → Cron: * * * * *  (navbatdagi xabarlarni har daqiqada yuboradi)

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, role TEXT DEFAULT 'student', state TEXT, data TEXT, created INTEGER);
CREATE TABLE IF NOT EXISTS tests (code TEXT PRIMARY KEY, title TEXT, teacher_id INTEGER, files TEXT, answer_key TEXT, n INTEGER, open INTEGER DEFAULT 1, created INTEGER);
CREATE TABLE IF NOT EXISTS results (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, user_id INTEGER, name TEXT, answers TEXT, correct INTEGER, total INTEGER, created INTEGER, UNIQUE(code, user_id));
CREATE TABLE IF NOT EXISTS monthly (grp TEXT, teacher TEXT, student TEXT, phone1 TEXT, phone2 TEXT, ym TEXT, label TEXT, score REAL, maxs REAL, updated INTEGER, PRIMARY KEY (grp, student, ym));
CREATE INDEX IF NOT EXISTS monthly_p1 ON monthly (phone1);
CREATE INDEX IF NOT EXISTS monthly_p2 ON monthly (phone2);
CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, chat INTEGER, kind TEXT, payload TEXT, bid INTEGER);
CREATE TABLE IF NOT EXISTS broadcasts (id INTEGER PRIMARY KEY AUTOINCREMENT, admin INTEGER, target TEXT, total INTEGER, sent INTEGER DEFAULT 0, failed INTEGER DEFAULT 0, created INTEGER, done INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS rsets (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, active INTEGER DEFAULT 1, created INTEGER);
CREATE TABLE IF NOT EXISTS ritems (id INTEGER PRIMARY KEY AUTOINCREMENT, set_id INTEGER, label TEXT, ftype TEXT, fid TEXT, csv TEXT, created INTEGER);
CREATE TABLE IF NOT EXISTS vused (k TEXT PRIMARY KEY, used INTEGER DEFAULT 1, used_at INTEGER);
CREATE TABLE IF NOT EXISTS authfail (uid INTEGER PRIMARY KEY, n INTEGER, ts INTEGER);
CREATE TABLE IF NOT EXISTS invites (code TEXT PRIMARY KEY, name TEXT, created INTEGER, used_by INTEGER, used_at INTEGER);
CREATE TABLE IF NOT EXISTS courses (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, price TEXT, info TEXT, active INTEGER DEFAULT 1, created INTEGER);
CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, course_id INTEGER, ctitle TEXT, name TEXT, phone TEXT, student TEXT, username TEXT, stage TEXT DEFAULT 'new', assigned INTEGER, aname TEXT, reminded INTEGER DEFAULT 0, created INTEGER, updated INTEGER);
CREATE INDEX IF NOT EXISTS leads_user ON leads (user_id);
CREATE INDEX IF NOT EXISTS leads_stage ON leads (stage);
`;
const MIGRATIONS = ['ALTER TABLE users ADD COLUMN phone TEXT', 'ALTER TABLE users ADD COLUMN blocked INTEGER DEFAULT 0', 'ALTER TABLE tests ADD COLUMN deadline INTEGER', 'ALTER TABLE tests ADD COLUMN reveal INTEGER DEFAULT 1', 'ALTER TABLE tests ADD COLUMN notified INTEGER DEFAULT 0', 'ALTER TABLE leads ADD COLUMN subject TEXT', 'ALTER TABLE leads ADD COLUMN shift TEXT', 'ALTER TABLE leads ADD COLUMN grade TEXT', "ALTER TABLE invites ADD COLUMN role TEXT DEFAULT 'teacher'", 'ALTER TABLE rsets ADD COLUMN open_at INTEGER', 'ALTER TABLE leads ADD COLUMN vaucher TEXT'];
let dbReady = false;
async function ensureDb(env) {
  if (dbReady) return;
  try { await env.DB.batch(SCHEMA.split(';').map((q) => q.trim()).filter(Boolean).map((q) => env.DB.prepare(q))); } catch (e) { console.log('schema', e && e.message); }
  for (const m of MIGRATIONS) {
    const mt = m.match(/ALTER TABLE (\w+) ADD COLUMN (\w+)/);
    try { await env.DB.prepare(`SELECT ${mt[2]} FROM ${mt[1]} LIMIT 1`).first(); continue; } catch (e) { /* ustun yoʻq */ }
    try { await env.DB.prepare(m).run(); } catch (e) { console.log('migratsiya', e && e.message); }
  }
  dbReady = true;
}

const COMMANDS = [
  {command: 'start', description: 'Bosh menyu'},
  {command: 'ism', description: 'Ismni oʻzgartirish'},
  {command: 'raqam', description: 'Telefon raqamni ulash'},
  {command: 'kurs', description: 'Kurslarga yozilish'}
];

// ---------- Tugmalar ----------
const B = {
  test: '✍️ Test topshirish', myres: '📊 Natijalarim', monthly: '🗓 Oylik natijalarim', profile: '👤 Profil',
  newtest: '➕ Yangi test', mytests: '📚 Testlarim', groups: '🗓 Oylik natijalar',
  bcast: '📢 Xabar yuborish', stats: '📈 Statistika', cancel: '❌ Bekor qilish', later: '⏭ Keyinroq',
  courses: '🎓 Kurslarga yozilish', funnel: '📊 Sotuv varonkasi', cadmin: '🎓 Kurslar (admin)', invite: '🔑 Xodim kodi', staff: '👥 Xodimlar', self: '👤 Oʻzim uchun',
  morning: '🌅 Ertalab', afternoon: '🌇 Abeddan keyin', olymp: '🏆 Olimpiada natijalari', radmin: '🏆 Natijalar (admin)', oskip: "⏭ Oʻtkazib yuborish", rank: '🏅 Reytingim', vaz: '📝 Vazifalarim', coin: '💰 Ilmzor pulim', shop: '🛍 Doʻkon'
};
const kb = (rows) => ({reply_markup: {keyboard: rows, resize_keyboard: true, is_persistent: true}});
// ---- Rollar va ruxsatlar ----
// CEO — hammasi. Admin — sotuv varonkasi, arizalar, kurslar, statistika, natijalarni koʻrish (reklama va tahrir yoʻq). Ustoz — testlar, oylik va olimpiada natijalari.
const PERMS = {
  ceo: ['tests', 'alltests', 'monthly', 'results', 'bcast', 'stats', 'funnel', 'courses', 'invite', 'staff'],
  admin: ['funnel', 'courses', 'stats', 'monthly'],
  teacher: ['tests', 'monthly', 'results'],
};
const ROLE_NAME = {ceo: '👑 CEO', admin: '🛡 Admin', teacher: '👨‍🏫 Ustoz', student: '🎓 Oʻquvchi'};
const can = (u, p) => !!u && (PERMS[u.role] || []).includes(p);
const isTeacher = (u) => can(u, 'tests');
// Pastki tugmalar olib tashlandi — hamma narsa ilovada. Xabar ostida bitta «Ilovani ochish» tugmasi.
function menuKb(u) {
  return {reply_markup: {inline_keyboard: [[{text: '📱 Ilovani ochish', web_app: {url: APP_URL + '/app'}}]]}};
}
function oldMenuKb(u) {
  if (u.role === 'ceo') return kb([[B.newtest, B.mytests], [B.groups, B.radmin], [B.funnel, B.cadmin], [B.bcast, B.stats], [B.invite, B.staff], [B.test, B.myres], [B.courses, B.olymp], [B.vaz, B.rank], [B.coin, B.shop], [B.profile]]);
  if (u.role === 'admin') return kb([[B.funnel, B.cadmin], [B.groups, B.olymp], [B.stats, B.profile], [B.vaz, B.rank]]);
  if (u.role === 'teacher') return kb([[B.newtest, B.mytests], [B.groups, B.radmin], [B.vaz, B.rank], [B.profile]]);
  return kb([[B.vaz, B.coin], [B.shop, B.rank], [B.test, B.myres], [B.monthly, B.olymp], [B.courses, B.profile]]);
}
const cancelKb = kb([[B.cancel]]);
const SUBJECTS = ['Matematika', 'Ingliz tili', 'Ona tili', 'Rus tili'];
const GRADES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
const GRADE_ADULT = 'Katta';
const NAME_RE = /^[\p{L}ʻ'’`\-]{2,}(\s+[\p{L}ʻ'’`\-]{2,})+$/u;
const leadPhoneKb = {reply_markup: {keyboard: [[{text: '📱 Raqamni yuborish', request_contact: true}], [B.cancel]], resize_keyboard: true, one_time_keyboard: true}};
const gradeKb = kb([GRADES.slice(0, 5).map((g) => g + '-sinf'), GRADES.slice(5).map((g) => g + '-sinf'), [GRADE_ADULT], [B.cancel]]);
const subjectKb = kb([SUBJECTS.slice(0, 2), SUBJECTS.slice(2), [B.cancel]]);
const shiftKb = kb([[B.morning, B.afternoon], [B.cancel]]);
const phoneKb = {reply_markup: {keyboard: [[{text: '📱 Raqamni yuborish', request_contact: true}], [B.later]], resize_keyboard: true, one_time_keyboard: true}};
const inl = (rows) => ({reply_markup: {inline_keyboard: rows}});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try { const tr = await tbRoute(request, url, env); if (tr) return tr; const ar = await miniApp(request, url, env); if (ar) return ar; } catch (e) { console.log('app', e && e.stack || e); return new Response(JSON.stringify({error: 'Xatolik, qayta urinib koʻring'}), {status: 500, headers: {'content-type': 'application/json'}}); }
    if (request.method === 'GET' && url.pathname === '/setup') return setup(url, env);
    if (request.method === 'GET' && url.pathname === '/v') {
      if (!(await vcheck(url.searchParams, env))) return new Response('Vaucher havolasi yaroqsiz. Botdan qayta oching.', {status: 403, headers: {'content-type': 'text/plain; charset=utf-8'}});
      return new Response(vhtml(url.searchParams), {headers: {'content-type': 'text/html; charset=utf-8'}});
    }
    if (request.method === 'GET' && url.pathname === '/leads.csv') {
      if (!(await xcheck(env, 'LEADS', url.searchParams.get('s')))) return text('Havola yaroqsiz.', 403);
      return new Response(await leadsCsv(env), {headers: {'content-type': 'text/csv; charset=utf-8'}});
    }
    if (request.method === 'GET' && url.pathname === '/export') {
      const c = (url.searchParams.get('c') || '').toUpperCase();
      if (!(await xcheck(env, c, url.searchParams.get('s')))) return text('Havola yaroqsiz.', 403);
      const csv = await testCsv(env, c);
      return csv == null ? text('Test topilmadi.', 404) : new Response(csv, {headers: {'content-type': 'text/csv; charset=utf-8'}});
    }
    if (request.method === 'POST' && url.pathname === '/import') return importMonthly(request, env);
    if (request.method === 'POST' && url.pathname === '/') {
      if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('forbidden', {status: 403});
      try { await ensureDb(env); await handle(await request.json(), env); } catch (e) { console.log('xato', e && e.stack || e); }
      return new Response('ok');
    }
    return text('Ilmzor test boti ishlayapti ✅');
  },
  async scheduled(event, env) {
    await ensureDb(env);
    try { await closeExpired(env); } catch (e) { console.log('closeExpired', e && e.message); }
    try { await remindLeads(env); } catch (e) { console.log('remindLeads', e && e.message); }
    await flushOutbox(env);
    try { await vzBackup(env); } catch (e) { console.log('backup', e && e.message); }
    try { await vzNotify(env); } catch (e) { console.log('notify', e && e.message); }
    try { await subSelfCheck(env); } catch (e) { console.log('kanal', e && e.message); }
    try { await appMenu(env); } catch (e) { console.log('appMenu', e && e.message); }
  }
};

// ---------- Bir martalik sozlash: /setup?key=WEBHOOK_SECRET ----------
async function setup(url, env) {
  if (!env.WEBHOOK_SECRET || url.searchParams.get('key') !== env.WEBHOOK_SECRET) return text('Kalit notoʻgʻri.', 403);
  if (!env.DB) return text('D1 bazasi ulanmagan: Settings → Bindings → D1 database, nomi DB boʻlsin.', 500);
  if (!env.BOT_TOKEN) return text('BOT_TOKEN kiritilmagan.', 500);
  await env.DB.batch(SCHEMA.split(';').map((q) => q.trim()).filter(Boolean).map((q) => env.DB.prepare(q)));
  for (const m of MIGRATIONS) { try { await env.DB.prepare(m).run(); } catch (e) { /* allaqachon bor */ } }
  const hook = await tg(env, 'setWebhook', {url: url.origin + '/', secret_token: env.WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true});
  const cmds = await tg(env, 'setMyCommands', {commands: COMMANDS});
  const me = await tg(env, 'getMe', {});
  const ok = hook.ok && cmds.ok && me.ok;
  const raw = String(env.BOT_TOKEN), ct = cleanToken(raw);
  const shape = `\n\nToken tekshiruvi (tokenning oʻzi koʻrsatilmaydi): uzunlik ${raw.length}/${ct.length}, format ${/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(ct) ? 'toʻgʻri' : 'NOTOʻGʻRI'}.`;
  const extra = `\nAdmin paroli: ${env.ADMIN_PASSWORD ? 'bor' : 'YOʻQ'} · Import kaliti: ${env.IMPORT_KEY ? 'bor' : 'YOʻQ'}`;
  return text(ok ? `✅ Tayyor! Bot @${me.result.username} ulandi.${extra}` : '❌ Xato: ' + JSON.stringify({hook, cmds, me}) + shape, ok ? 200 : 500);
}
const text = (t, status = 200) => new Response(t, {status, headers: {'content-type': 'text/plain; charset=utf-8'}});
const json = (o, status = 200) => new Response(JSON.stringify(o), {status, headers: {'content-type': 'application/json; charset=utf-8'}});

// ---------- Telegram ----------
const cleanToken = (raw) => { const m = String(raw || '').match(/\d{6,}:[A-Za-z0-9_-]{30,}/); return m ? m[0] : String(raw || '').trim(); };
async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${cleanToken(env.BOT_TOKEN)}/${method}`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
  return r.json();
}
function splitText(t, max = 3900) {
  const out = []; let cur = '';
  for (const line of String(t).split('\n')) {
    if (cur && (cur + '\n' + line).length > max) { out.push(cur); cur = line; } else cur = cur ? cur + '\n' + line : line;
    while (cur.length > max) { out.push(cur.slice(0, max)); cur = cur.slice(max); }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}
async function send(env, chat, t, extra = {}) {
  const parts = splitText(t); let res;
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    res = await tg(env, 'sendMessage', Object.assign({chat_id: chat, text: parts[i], parse_mode: 'HTML', disable_web_page_preview: true}, last ? extra : {}));
  }
  return res;
}
const safeEq = (a, b) => { a = String(a); b = String(b); let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; };
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- Ma'lumotlar ----------
async function getUser(env, from) {
  let u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(from.id).first();
  if (!u) {
    await env.DB.prepare('INSERT INTO users (id, name, role, state, data, created) VALUES (?, NULL, ?, ?, NULL, ?)').bind(from.id, 'student', 'ask_name', Date.now()).run();
    u = {id: from.id, name: null, role: 'student', state: 'ask_name', data: null, phone: null, isNew: true};
  }
  u.d = u.data ? JSON.parse(u.data) : {};
  return u;
}
async function setState(env, u, state, data) {
  u.state = state; u.d = data || {};
  await env.DB.prepare('UPDATE users SET state = ?, data = ? WHERE id = ?').bind(state, JSON.stringify(u.d), u.id).run();
}
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
async function newCode(env) {
  for (let k = 0; k < 20; k++) {
    let c = ''; const r = crypto.getRandomValues(new Uint8Array(4));
    for (const b of r) c += ALPH[b % ALPH.length];
    if (!await env.DB.prepare('SELECT code FROM tests WHERE code = ?').bind(c).first()) return c;
  }
  throw new Error('kod topilmadi');
}
// Telefon: faqat oxirgi 9 raqam (998 va + belgisisiz)
const phone9 = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : ''; };
const showPhone = (p) => p ? `+998 ${p.slice(0, 2)} ${p.slice(2, 5)} ** ${p.slice(7)}` : 'ulanmagan';

// Javoblarni o'qish: "abcd...", "1a 2b 3c", "1-a, 2-b" va kirill harflari (а б в г д) ham bo'ladi
const CYR = {'а': 'a', 'б': 'b', 'в': 'c', 'г': 'd', 'д': 'e', 'с': 'c', 'ц': 'c'};
function parseAnswers(raw) {
  const s = String(raw || '').toLowerCase().replace(/[абвгдсц]/g, (ch) => CYR[ch] || ch);
  if (/\d/.test(s)) {
    const out = []; const re = /(\d+)\s*[-.):=]?\s*([a-e])/g; let m;
    while ((m = re.exec(s))) { const qn = +m[1]; if (qn < 1 || qn > 200) return null; out[qn - 1] = m[2]; }
    if (!out.length) return null;
    return Array.from({length: out.length}, (_, i) => out[i] || '-').join('');
  }
  const letters = s.replace(/[^a-e]/g, '');
  return letters.length ? letters : null;
}
function check(key, ans) {
  const wrong = []; let ok = 0;
  for (let i = 0; i < key.length; i++) { if (ans[i] === key[i]) ok++; else wrong.push(i + 1); }
  return {ok, total: key.length, wrong};
}
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const bar = (p) => '▓'.repeat(Math.round(p / 10)) + '░'.repeat(10 - Math.round(p / 10));
const fmtDate = (ms) => { const d = new Date(ms + 5 * 3600e3); const p = (v) => String(v).padStart(2, '0'); return `${d.getUTCDate()}.${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
const codeExample = (n) => 'abcd'.repeat(Math.ceil(n / 4)).slice(0, n);

// ---------- Asosiy mantiq ----------
async function handle(update, env) {
  if (update.callback_query) return onCallback(update.callback_query, env);
  const msg = update.message; if (!msg || !msg.from || msg.chat.type !== 'private') return;
  const chat = msg.chat.id, t = (msg.text || msg.caption || '').trim();
  const u = await getUser(env, msg.from);
  if (!(await subOk(env, u))) return subAsk(env, chat);
  if (u.blocked) await env.DB.prepare('UPDATE users SET blocked = 0 WHERE id = ?').bind(u.id).run();
  if (u.name && (u.created || 0) < Date.parse('2026-11-25T11:45:00Z')) await dropOldKb(env, chat, u);
  const cmd = t.startsWith('/') ? t.split(/\s+/)[0].slice(1).split('@')[0].toLowerCase() : '';
  const arg = cmd ? t.slice(t.indexOf(cmd) + cmd.length).trim() : '';

  // --- buyruqlar
  if (cmd === 'start' || t === B.cancel) {
    if (!u.name) { await setState(env, u, 'ask_name'); return send(env, chat, '👋 Assalomu alaykum! <b>Ilmzor oʻquv markazi</b>ning test botiga xush kelibsiz.\n\nIsm va familiyangizni yozing (masalan: <i>Ali Valiyev</i>):', {reply_markup: {remove_keyboard: true}}); }
    await setState(env, u, 'idle');
    return send(env, chat, t === B.cancel ? 'Bekor qilindi. Bosh menyu 👇' : `👋 Salom, <b>${esc(u.name)}</b>! Kerakli boʻlimni tanlang 👇`, menuKb(u));
  }
  if (cmd === 'kanal' && u.role === 'ceo') { const me = await tg(env, 'getMe', {}); const r = await tg(env, 'getChatMember', {chat_id: SUB_CHANNEL, user_id: me.result.id}); return send(env, chat, r && r.ok && r.result.status === 'administrator' ? '✅ Bot ' + SUB_CHANNEL + ' kanalida admin — majburiy obuna ishlayapti.' : '⚠️ Bot ' + SUB_CHANNEL + ' kanalida admin emas. Kanal → Boshqaruv → Administratorlar → @' + me.result.username + ' ni qoʻshing. Shungacha tekshiruv oʻtkazib yuboriladi.', menuKb(u)); }
  if (cmd === 'ism') { await setState(env, u, 'ask_name'); return send(env, chat, 'Yangi ism va familiyangizni yozing:', cancelKb); }
  if (cmd === 'raqam') return askPhone(env, chat, u);
  if (cmd === 'ustoz' || cmd === 'admin' || cmd === 'ceo') {
    await tg(env, 'deleteMessage', {chat_id: chat, message_id: msg.message_id}).catch(() => {});
    if (u.role === 'ceo') return send(env, chat, 'Siz allaqachon 👑 <b>CEO</b>siz.', menuKb(u));
    const ceoN = cmd === 'ceo' ? (await env.DB.prepare("SELECT COUNT(*) c FROM users WHERE role = 'ceo'").first()).c : 1;
    // CEO: CEO_PASSWORD bilan; hali CEO yoʻq boʻlsa — birinchi marta ADMIN_PASSWORD bilan ham olish mumkin
    const pass = cmd === 'ceo' ? (env.CEO_PASSWORD || (ceoN === 0 ? env.ADMIN_PASSWORD : '')) : cmd === 'admin' ? env.ADMIN_PASSWORD : env.TEACHER_PASSWORD;
    const fl = await env.DB.prepare('SELECT n, ts FROM authfail WHERE uid = ?').bind(u.id).first();
    const recent = !!fl && Date.now() - fl.ts < 15 * 60e3;
    if (recent && fl.n >= 5) return send(env, chat, '⏳ Juda koʻp xato urinish. 15 daqiqadan keyin qayta urinib koʻring.');
    let role = cmd === 'ceo' ? 'ceo' : cmd === 'admin' ? 'admin' : 'teacher';
    let ok = !!pass && safeEq(arg, pass);
    if (!ok && cmd === 'ustoz' && arg.length >= 6) { const r = await useInvite(env, arg.toUpperCase(), u); if (r) { ok = true; role = r; } }
    if (!ok) {
      await env.DB.prepare('INSERT OR REPLACE INTO authfail (uid, n, ts) VALUES (?, ?, ?)').bind(u.id, recent ? fl.n + 1 : 1, Date.now()).run();
      return send(env, chat, '❌ Parol yoki kod notoʻgʻri.');
    }
    await env.DB.prepare('DELETE FROM authfail WHERE uid = ?').bind(u.id).run();
    await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, u.id).run(); u.role = role;
    await setState(env, u, 'idle');
    const what = {ceo: '👑 <b>CEO</b>siz: barcha imkoniyatlar sizda.', admin: '🛡 <b>admin</b>siz: sotuv varonkasi, arizalar, kurslar va statistika.', teacher: '👨‍🏫 <b>ustoz</b>siz: testlar, oylik va olimpiada natijalari.'}[role];
    return send(env, chat, `✅ Siz endi ${what}\n«📱 Ilova» tugmasini bosing 👇`, menuKb(u));
  }
  if (cmd === 'natija') return isTeacher(u) ? results(env, chat, u, arg.toUpperCase()) : myResults(env, chat, u);
  if (cmd === 'yangi' || t === B.newtest) { if (!isTeacher(u)) return notTeacher(env, chat, u); await setState(env, u, 't_files', {files: []}); return send(env, chat, '📄 Test faylini yuboring: <b>rasm</b> yoki <b>PDF</b>. Bir nechta rasm boʻlsa, hammasini ketma-ket yuboring.\n\nTugagach <b>javoblar kalitini</b> yozing, masalan:\n<code>abcdabcdab</code> yoki <code>1a 2b 3c 4d</code>', cancelKb); }
  if (cmd === 'testlar' || t === B.mytests) { if (!isTeacher(u)) return notTeacher(env, chat, u); await setState(env, u, 'idle'); return listTests(env, chat, u); }
  if (t === B.groups) { if (!can(u, 'monthly')) return notTeacher(env, chat, u); await setState(env, u, 'idle'); return groupSummary(env, chat, u); }
  if (t === B.bcast) { if (!can(u, 'bcast')) return notTeacher(env, chat, u); await setState(env, u, 'b_msg'); return send(env, chat, '📢 Hammaga yuboriladigan xabarni yuboring: matn, rasm, video yoki fayl (izohi bilan).\n\nAvval koʻrinishini koʻrsataman, keyin kimga yuborishni tanlaysiz.', cancelKb); }
  if (t === B.stats) { if (!can(u, 'stats')) return notTeacher(env, chat, u); return stats(env, chat, u); }
  if (t === B.test) { await setState(env, u, 'ask_code'); return send(env, chat, '✍️ Ustozingiz bergan <b>4 belgili test kodini</b> yozing (masalan: <code>A7K3</code>):', cancelKb); }
  if (t === B.myres) { await setState(env, u, 'idle'); return myResults(env, chat, u); }
  if (t === B.monthly) { await setState(env, u, 'idle'); return myMonthly(env, chat, u); }
  if (t === B.coin || cmd === 'coin') { await setState(env, u, 'idle'); return vzCoins(env, chat, u); }
  if (t === B.shop || cmd === 'dokon') { await setState(env, u, 'idle'); return vzShop(env, chat, u); }
  if (cmd === 'zaxira' && u.role === 'ceo') { const ok = await vzBackup(env, true); return send(env, chat, ok ? '💾 Zaxira nusxa yuborildi.' : '⚠️ Zaxira nusxani yuborib boʻlmadi.', menuKb(u)); }
  if (t === B.vaz || cmd === 'vazifa') { await setState(env, u, 'idle'); return vzShow(env, chat, u); }
  if (t === B.rank || cmd === 'reyting') { try { const lk = await vzLink(env, u); if (lk) { const me = await bahoMe(env, lk); if (me) { await setState(env, u, 'idle'); return rankShow(env, chat, u, me.student.name, true); } } } catch (e) {} if (u.name && u.name.trim().split(/\s+/).length >= 2) { await setState(env, u, 'idle'); return rankShow(env, chat, u, u.name, true); } await setState(env, u, 'rk_name'); return send(env, chat, '🏅 Ism va familiyangizni yozing (masalan: <i>Qosimov Temurbek</i>):', cancelKb); }
  if (t === B.olymp) { await setState(env, u, 'idle'); return olympList(env, chat, u); }
  if (t === B.radmin) { if (!can(u, 'results')) return notTeacher(env, chat, u); await setState(env, u, 'idle'); return rAdmin(env, chat, u); }
  if (t === B.profile) { await setState(env, u, 'idle'); return profile(env, chat, u); }
  if (cmd === 'kurs' || t === B.courses) { await setState(env, u, 'idle'); return courseList(env, chat, u); }
  if (t === B.funnel) { if (!can(u, 'funnel')) return notTeacher(env, chat, u); await setState(env, u, 'idle'); return funnel(env, chat, u); }
  if (t === B.cadmin) { if (!can(u, 'courses')) return notTeacher(env, chat, u); await setState(env, u, 'idle'); return courseAdmin(env, chat, u); }
  if (t === B.invite) { if (!can(u, 'invite')) return notTeacher(env, chat, u); return inviteList(env, chat, u); }
  if (t === B.staff) { if (!can(u, 'staff')) return notTeacher(env, chat, u); await setState(env, u, 'idle'); return staffList(env, chat, u); }
  if (cmd) return send(env, chat, 'Bunday buyruq yoʻq. «📱 Ilova» tugmasini bosing 👇', menuKb(u));

  // --- holatlar
  if (u.state === 'vz_code') { if (!t) return send(env, chat, 'Kodni matn bilan yozing:', cancelKb); return vzLinkCode(env, chat, u, t); }
  if (u.state === 'rk_name') { if (!t) return send(env, chat, 'Ism va familiyangizni matn bilan yozing:', cancelKb); await setState(env, u, 'idle'); return rankShow(env, chat, u, t, false); }
  if (u.state === 'ask_name') {
    const name = t.replace(/\s+/g, ' ').slice(0, 60);
    if (name.length < 3 || !/\p{L}/u.test(name)) return send(env, chat, 'Iltimos, ism va familiyangizni harflar bilan yozing:');
    await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, u.id).run(); u.name = name;
    if (!u.phone) return askPhone(env, chat, u, `✅ Rahmat, <b>${esc(name)}</b>!\n\n`);
    await setState(env, u, 'idle');
    return send(env, chat, `✅ Ism saqlandi: <b>${esc(name)}</b>`, menuKb(u));
  }
  if (u.state === 'ask_phone') {
    if (msg.contact) {
      if (msg.contact.user_id !== msg.from.id) return send(env, chat, 'Iltimos, <b>oʻzingizning</b> raqamingizni pastdagi tugma orqali yuboring.', phoneKb);
      const p = phone9(msg.contact.phone_number);
      await env.DB.prepare('UPDATE users SET phone = ? WHERE id = ?').bind(p, u.id).run(); u.phone = p;
      await setState(env, u, 'idle');
      const found = await env.DB.prepare('SELECT COUNT(DISTINCT student) AS c FROM monthly WHERE phone1 = ? OR phone2 = ?').bind(p, p).first();
      return send(env, chat, '✅ Raqam ulandi!' + (found && found.c ? '\n🗓 Oylik natijalar topildi — ilovadagi «📝 Vazifalar va reyting» boʻlimida.' : '\nOylik test natijalari kiritilganda shu yerga xabar keladi.'), menuKb(u));
    }
    if (t === B.later) { await setState(env, u, 'idle'); return send(env, chat, 'Mayli. Raqamni keyin «👤 Profil» boʻlimidan ulashingiz mumkin.\n\nKerakli boʻlimni tanlang 👇', menuKb(u)); }
    return send(env, chat, 'Raqamni pastdagi <b>«📱 Raqamni yuborish»</b> tugmasi orqali yuboring.', phoneKb);
  }
  if (u.state === 't_files') {
    const f = msg.photo ? {type: 'photo', id: msg.photo[msg.photo.length - 1].file_id} : msg.document ? {type: 'document', id: msg.document.file_id} : null;
    if (f) {
      await env.DB.prepare("UPDATE users SET data = json_insert(COALESCE(data, '{\"files\":[]}'), '$.files[#]', json(?)) WHERE id = ?").bind(JSON.stringify(f), u.id).run();
      if (msg.caption) await env.DB.prepare("UPDATE users SET data = json_set(data, '$.title', ?) WHERE id = ?").bind(msg.caption.slice(0, 80), u.id).run();
      if (msg.media_group_id) {
        const gid = String(msg.media_group_id);
        const first = await env.DB.prepare("UPDATE users SET data = json_set(data, '$.mg', ?) WHERE id = ? AND COALESCE(json_extract(data, '$.mg'), '') != ?").bind(gid, u.id, gid).run();
        if (!(first.meta && first.meta.changes)) return;
        return send(env, chat, '📥 Rasmlar qabul qilinmoqda. Hammasi kelgach <b>javoblar kalitini</b> yozing.');
      }
      const cnt = await env.DB.prepare("SELECT json_array_length(data, '$.files') AS c FROM users WHERE id = ?").bind(u.id).first();
      return send(env, chat, `📥 Fayl qabul qilindi (${cnt ? cnt.c : '?'} ta). Yana fayl yuboring yoki <b>javoblar kalitini</b> yozing.`);
    }
    if (!u.d.files.length) return send(env, chat, 'Avval test faylini (rasm yoki PDF) yuboring.');
    const key = parseAnswers(t);
    if (!key || key.length > 200) return send(env, chat, 'Kalitni tushunmadim. Masalan: <code>abcdabcd</code> yoki <code>1a 2b 3c</code>');
    await setState(env, u, 't_title', Object.assign(u.d, {key}));
    return send(env, chat, `🔑 Kalit: <b>${key.length} ta savol</b> — <code>${key.toUpperCase()}</code>\n\nTest nomini yozing (masalan: <i>5-sinf, kasrlar</i>):`);
  }
  if (u.state === 't_title') {
    const title = (t || u.d.title || 'Test').slice(0, 80); const code = await newCode(env); const key = u.d.key;
    await env.DB.prepare('INSERT INTO tests (code, title, teacher_id, files, answer_key, n, open, created) VALUES (?, ?, ?, ?, ?, ?, 1, ?)').bind(code, title, u.id, JSON.stringify(u.d.files), key, key.length, Date.now()).run();
    await setState(env, u, 'idle');
    await send(env, chat, `✅ Test saqlandi!\n\n📝 <b>${esc(title)}</b>\n❓ ${key.length} ta savol\n🔢 Test kodi: <code>${code}</code>\n\nKodni oʻquvchilarga bering. Natijalar «${B.mytests}» boʻlimida.`, menuKb(u));
    return;
  }
  if (u.state === 'b_msg') {
    await setState(env, u, 'b_target', {mid: msg.message_id});
    await tg(env, 'copyMessage', {chat_id: chat, from_chat_id: chat, message_id: msg.message_id});
    return send(env, chat, '👆 Xabar shunday koʻrinadi. <b>Kimga yuboramiz?</b>', inl([[{text: '👥 Hammaga', callback_data: 'b:all'}], [{text: '🎓 Oʻquvchilarga', callback_data: 'b:stu'}, {text: '👨‍🏫 Ustozlarga', callback_data: 'b:tea'}], [{text: '🗓 Guruh boʻyicha', callback_data: 'b:grp'}], [{text: '❌ Bekor qilish', callback_data: 'b:no'}]]));
  }
  if (u.state === 'answering') {
    const cur = await env.DB.prepare('SELECT n FROM tests WHERE code = ?').bind(u.d.code).first();
    const pa = parseAnswers(t);
    const looksCode = /^[A-Za-z0-9]{4}$/.test(t);
    if (!looksCode || (cur && pa && pa.length === cur.n)) return submitAnswers(env, chat, u, t);
  }
  if (u.state === 'r_newset' && can(u, 'results')) { const title = (t || '').slice(0, 80); if (title.length < 2) return send(env, chat, "Toʻplam nomini yozing:"); await env.DB.prepare('INSERT INTO rsets (title, active, created) VALUES (?, 1, ?)').bind(title, Date.now()).run(); await setState(env, u, 'idle'); return rAdmin(env, chat, u, "✅ Toʻplam yaratildi."); }
  if (u.state === 'r_label' && can(u, 'results')) { const label = (t || '').slice(0, 40); if (!label) return send(env, chat, 'Tugma nomini yozing (masalan: 3-sinf):'); await setState(env, u, 'r_file', Object.assign(u.d, {label})); return send(env, chat, "📎 «" + esc(label) + "» uchun <b>faylni yuboring</b> (PDF yoki rasm).", cancelKb); }
  if (u.state === 'r_file' && can(u, 'results')) { const f = msg.document ? {ftype: 'document', fid: msg.document.file_id} : msg.photo ? {ftype: 'photo', fid: msg.photo[msg.photo.length - 1].file_id} : null; if (!f) return send(env, chat, 'Iltimos, PDF yoki rasm yuboring.'); await setState(env, u, 'r_csv', Object.assign(u.d, f)); return send(env, chat, "🔗 Ism boʻyicha qidirish uchun Google Sheets <b>CSV havolasini</b> yuboring (ixtiyoriy).\nKerak boʻlmasa «" + B.oskip + "» tugmasini bosing.", kb([[B.oskip], [B.cancel]])); }
  if (u.state === 'r_csv' && can(u, 'results')) { const csv = (t === B.oskip) ? '' : (t || '').trim().slice(0, 300); await env.DB.prepare('INSERT INTO ritems (set_id, label, ftype, fid, csv, created) VALUES (?, ?, ?, ?, ?, ?)').bind(u.d.setid, u.d.label, u.d.ftype, u.d.fid, csv, Date.now()).run(); await setState(env, u, 'idle'); return rAdmin(env, chat, u, "✅ «" + esc(u.d.label) + "» qoʻshildi."); }
  if (u.state === 'r_time' && can(u, 'results')) {
    const m = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s+(\d{1,2}):(\d{2})$/.exec((t || '').trim());
    const y = m && m[3] ? +m[3] : new Date(Date.now() + 5 * 3600e3).getUTCFullYear();
    const at = m ? Date.UTC(y, +m[2] - 1, +m[1], +m[4] - 5, +m[5]) : NaN;
    const chk = m ? new Date(at + 5 * 3600e3) : null;
    if (!m || +m[1] > 31 || +m[2] > 12 || +m[4] > 23 || +m[5] > 59 || chk.getUTCDate() !== +m[1]) return send(env, chat, '⚠️ Format: <code>12.11 18:00</code>', cancelKb);
    if (at <= Date.now()) return send(env, chat, '⚠️ Bu vaqt allaqachon oʻtgan. Kelajakdagi vaqtni yozing:', cancelKb);
    const st = await env.DB.prepare('SELECT title FROM rsets WHERE id = ?').bind(u.d.setid).first();
    if (!st) { await setState(env, u, 'idle'); return send(env, chat, 'Toʻplam topilmadi.', menuKb(u)); }
    await env.DB.prepare('UPDATE rsets SET open_at = ? WHERE id = ?').bind(at, u.d.setid).run();
    await setState(env, u, 'idle');
    return send(env, chat, `🔒 <b>${esc(st.title)}</b> — oʻquvchilar faqat ism-familiya bilan qidiradi.\n⏰ Fayllar <b>${lockWhen({open_at: at})}</b> ochiladi.`, menuKb(u));
  }
  if (u.state === 'o_find') return olympFind(env, chat, u, t);

  if (u.state === 'e_name' && isTeacher(u)) {
    const tt = await ownTest(env, u, u.d.code);
    if (!tt) { await setState(env, u, 'idle'); return send(env, chat, 'Test topilmadi.', menuKb(u)); }
    const title = (t || '').slice(0, 80);
    if (title.length < 2) return send(env, chat, 'Test nomini yozing:');
    await env.DB.prepare('UPDATE tests SET title = ? WHERE code = ?').bind(title, tt.code).run();
    await setState(env, u, 'idle');
    return send(env, chat, `✅ Nomi yangilandi: <b>${esc(title)}</b>`, menuKb(u));
  }
  if (u.state === 'e_key' && isTeacher(u)) {
    const tt = await ownTest(env, u, u.d.code);
    if (!tt) { await setState(env, u, 'idle'); return send(env, chat, 'Test topilmadi.', menuKb(u)); }
    const key = parseAnswers(t);
    if (!key || key.length !== tt.n || key.includes('-')) return send(env, chat, `Kalit aynan <b>${tt.n}</b> ta javobdan iborat boʻlishi kerak. Qayta yozing:`);
    await env.DB.prepare('UPDATE tests SET answer_key = ? WHERE code = ?').bind(key, tt.code).run();
    const rs = (await env.DB.prepare('SELECT id, answers FROM results WHERE code = ?').bind(tt.code).all()).results || [];
    for (const part of chunks(rs, 30)) {
      await env.DB.prepare(`UPDATE results SET correct = CASE id ${part.map(() => 'WHEN ? THEN ?').join(' ')} END WHERE id IN (${part.map(() => '?').join(',')})`)
        .bind(...part.flatMap((r) => [r.id, check(key, r.answers).ok]), ...part.map((r) => r.id)).run();
    }
    await setState(env, u, 'idle');
    return send(env, chat, `✅ Kalit yangilandi. <b>${rs.length}</b> ta natija qayta hisoblandi.`, menuKb(u));
  }
  if (u.state === 'iv_name' && can(u, 'invite')) {
    const nm = (t || '').slice(0, 40);
    if (nm.length < 2) return send(env, chat, 'Xodim ismini yozing:');
    const irole = u.d.role === 'admin' ? 'admin' : 'teacher';
    const code = await newInvite(env);
    await env.DB.prepare('INSERT INTO invites (code, name, role, created) VALUES (?, ?, ?, ?)').bind(code, nm, irole, Date.now()).run();
    await setState(env, u, 'idle');
    return send(env, chat, `✅ <b>${esc(nm)}</b> (${ROLE_NAME[irole]}) uchun kod:\n<code>${code}</code>\n\nU botda shuni yozadi: <code>/ustoz ${code}</code>\nKod bir martalik — ishlatilgach kuchini yoʻqotadi.`, menuKb(u));
  }
  if (u.state === 'c_title' && can(u, 'courses')) {
    const title = (t || '').slice(0, 80);
    if (title.length < 2) return send(env, chat, 'Kurs nomini yozing:');
    await setState(env, u, 'c_price', {title});
    return send(env, chat, '💵 Narxini yozing (masalan: <i>300 000 soʻm/oy</i>) yoki «' + B.oskip + '» ni bosing.', kb([[B.oskip], [B.cancel]]));
  }
  if (u.state === 'c_price' && can(u, 'courses')) {
    const price = t === B.oskip ? '' : (t || '').slice(0, 60);
    await setState(env, u, 'c_info', Object.assign(u.d, {price}));
    return send(env, chat, 'ℹ️ Jadval va ustoz haqida qisqa maʼlumot yozing (masalan: <i>Du-Chor-Ju 15:00, Sardorbek ustoz</i>) yoki «' + B.oskip + '» ni bosing.', kb([[B.oskip], [B.cancel]]));
  }
  if (u.state === 'c_info' && can(u, 'courses')) {
    const info = t === B.oskip ? '' : (t || '').slice(0, 400);
    await env.DB.prepare('INSERT INTO courses (title, price, info, active, created) VALUES (?, ?, ?, 1, ?)').bind(u.d.title, u.d.price || '', info, Date.now()).run();
    await setState(env, u, 'idle');
    return courseAdmin(env, chat, u, '✅ Kurs qoʻshildi.');
  }
  if (u.state === 'lead_phone') {
    const cid = u.d.course;
    if (msg.contact) {
      if (msg.contact.user_id !== msg.from.id) return send(env, chat, 'Iltimos, <b>oʻzingizning</b> raqamingizni pastdagi tugma orqali yuboring.', leadPhoneKb);
      const p = phone9(msg.contact.phone_number);
      await env.DB.prepare('UPDATE users SET phone = ? WHERE id = ?').bind(p, u.id).run(); u.phone = p;
      return leadAskStudent(env, chat, u, cid, u.d.vaucher);
    }
    return send(env, chat, '📱 Telefon raqam <b>majburiy</b>. Pastdagi <b>«📱 Raqamni yuborish»</b> tugmasini bosing.', leadPhoneKb);
  }
  if (u.state === 'lead_student') {
    const name = (t === B.self ? (u.name || '') : (t || '')).trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!NAME_RE.test(name)) return send(env, chat, '⚠️ <b>Ism va familiya</b> ikkalasi ham kerak.\nMasalan: <i>Ali Valiyev</i>', leadNameKb(u));
    return leadAskSubject(env, chat, u, u.d.course, name, u.d.vaucher);
  }
  if (u.state === 'lead_subject') {
    const f = (t || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (f.length < 3 || /^\d+$/.test(f)) return send(env, chat, '⚠️ <b>Fan</b> majburiy. Tugmalardan tanlang yoki fan nomini yozing.', subjectKb);
    return leadAskShift(env, chat, u, Object.assign(u.d, {subject: f}));
  }
  if (u.state === 'lead_shift') {
    if (t !== B.morning && t !== B.afternoon) return send(env, chat, '⚠️ Vaqt majburiy. Tugmalardan birini tanlang 👇', shiftKb);
    return leadAskGrade(env, chat, u, Object.assign(u.d, {shift: t === B.morning ? 'Ertalab' : 'Abeddan keyin'}));
  }
  if (u.state === 'lead_grade') {
    const m = /^(\d{1,2})-sinf$/.exec(t || '');
    const g = t === GRADE_ADULT ? GRADE_ADULT : (m && GRADES.includes(m[1]) ? m[1] + '-sinf' : '');
    if (!g) return send(env, chat, '⚠️ Sinf majburiy: 2-sinfdan 11-sinfgacha yoki «Katta». Tugmalardan tanlang 👇', gradeKb);
    return leadCreate(env, chat, u, Object.assign(u.d, {grade: g}), msg.from.username);
  }

  // --- test kodi
  const code = t.toUpperCase();
  if (/^[A-Z0-9]{4}$/.test(code)) return openTest(env, chat, u, code);
  if (u.state === 'ask_code') return send(env, chat, 'Kod 4 belgidan iborat boʻladi, masalan: <code>A7K3</code>. Qayta yozing:');
  return send(env, chat, isTeacher(u) ? '«📱 Ilova» tugmasini bosing 👇' : `✍️ Test kodini yozing yoki «📱 Ilova» tugmasini bosing 👇`, menuKb(u));
}

const notTeacher = (env, chat, u) => send(env, chat, '🔒 Bu boʻlim sizning rolingiz uchun emas. Ustoz yoki admin boʻlsangiz, rahbardan <b>shaxsiy kod</b> soʻrang: <code>/ustoz KOD</code>', menuKb(u));

async function askPhone(env, chat, u, prefix = '') {
  await setState(env, u, 'ask_phone');
  return send(env, chat, prefix + '📱 <b>Telefon raqamingizni ulang.</b>\nShunda oylik test natijalaringizni shu botda koʻrasiz va natija chiqqanda xabar olasiz.\n\nOta-ona ham oʻz raqami bilan kirsa boʻladi — raqam markazdagi roʻyxatda boʻlsa, farzandining natijasi chiqadi.', phoneKb);
}

// ---------- O'quvchi: test ----------
async function openTest(env, chat, u, code) {
  const tt = await env.DB.prepare('SELECT * FROM tests WHERE code = ?').bind(code).first();
  if (!tt) return send(env, chat, '❌ Bunday kodli test topilmadi. Kodni tekshirib qayta yozing.');
  if (!isOpen(tt)) return send(env, chat, '🔒 Bu test yopilgan.', menuKb(u));
  const done = await env.DB.prepare('SELECT correct, total FROM results WHERE code = ? AND user_id = ?').bind(code, u.id).first();
  if (done) { await setState(env, u, 'idle'); return send(env, chat, `Siz bu testni topshirgansiz: <b>${done.correct}/${done.total}</b> (${pct(done.correct, done.total)}%).`, menuKb(u)); }
  if (!u.name) { await setState(env, u, 'ask_name'); return send(env, chat, 'Avval ism va familiyangizni yozing:'); }
  for (const f of JSON.parse(tt.files || '[]')) await tg(env, f.type === 'photo' ? 'sendPhoto' : 'sendDocument', {chat_id: chat, [f.type === 'photo' ? 'photo' : 'document']: f.id});
  await setState(env, u, 'answering', {code});
  return send(env, chat, `📝 <b>${esc(tt.title)}</b> — ${tt.n} ta savol\n${tt.deadline ? '⏰ Muddat: <b>' + fmtDate(tt.deadline) + '</b>\n' : ''}\nYechib boʻling va javoblarni <b>bitta xabarda</b> yuboring, masalan:\n<code>${codeExample(tt.n)}</code>\nyoki <code>1a 2b 3c …</code>\n\n⚠️ Javob faqat bir marta qabul qilinadi.`, cancelKb);
}
async function submitAnswers(env, chat, u, t) {
  const tt = await env.DB.prepare('SELECT * FROM tests WHERE code = ?').bind(u.d.code).first();
  if (!tt) { await setState(env, u, 'idle'); return send(env, chat, 'Test topilmadi. Kodni qayta yozing.', menuKb(u)); }
  if (!isOpen(tt)) { await setState(env, u, 'idle'); return send(env, chat, '🔒 Bu test yopilgan.', menuKb(u)); }
  const ans = parseAnswers(t);
  if (!ans) return send(env, chat, `Javoblarni tushunmadim. ${tt.n} ta javobni ketma-ket yozing, masalan: <code>${codeExample(tt.n)}</code>`);
  if (ans.length !== tt.n) return send(env, chat, `⚠️ Sizda <b>${ans.length}</b> ta javob, testda esa <b>${tt.n}</b> ta savol. Hammasini qayta, ketma-ket yuboring.`);
  const r = check(tt.answer_key, ans);
  try {
    await env.DB.prepare('INSERT INTO results (code, user_id, name, answers, correct, total, created) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(tt.code, u.id, u.name || '—', ans, r.ok, r.total, Date.now()).run();
  } catch (e) { await setState(env, u, 'idle'); return send(env, chat, 'Siz bu testni avval topshirgansiz. Natija bir marta hisoblanadi.', menuKb(u)); }
  await setState(env, u, 'idle');
  const p = pct(r.ok, r.total); const medal = p >= 90 ? '🏆' : p >= 70 ? '👏' : p >= 50 ? '🙂' : '📚';
  await send(env, chat, `${medal} <b>Natijangiz: ${r.ok} / ${r.total} (${p}%)</b>\n${bar(p)}\n📝 ${esc(tt.title)}\n` + (r.wrong.length ? `❌ Xato savollar: ${r.wrong.join(', ')}` : '✅ Hammasi toʻgʻri! Barakalla!') + '\n\n🌱 Ilmzor — bilim bogʻingiz!', menuKb(u));
  await send(env, tt.teacher_id, `🔔 <b>${esc(u.name)}</b> — ${tt.code} (${esc(tt.title)}): <b>${r.ok}/${r.total}</b> (${p}%)`).catch(() => {});
}

// ---------- O'quvchi: oylik natijalar ----------
async function myMonthly(env, chat, u) {
  try { const lk = await vzLink(env, u); if (lk) { const me = await bahoMe(env, lk); if (me) return vzMonthly(env, chat, u, me); } } catch (e) {}
  if (u.role === 'student') { const r = await vzShowMonthlyByName(env, chat, u); if (r) return r; }
  if (!u.phone) return askPhone(env, chat, u, 'Oylik natijalarni koʻrish uchun telefon raqamingiz kerak.\n\n');
  const rows = (await env.DB.prepare('SELECT * FROM monthly WHERE phone1 = ? OR phone2 = ? ORDER BY student, ym').bind(u.phone, u.phone).all()).results || [];
  if (!rows.length) return send(env, chat, `🗓 Raqamingiz (${showPhone(u.phone)}) boʻyicha hali oylik natija topilmadi.\n\nNatijalar kiritilganda shu yerga xabar keladi. Raqam markazga boshqa raqam bilan yozilgan boʻlsa, ustozga ayting.`, menuKb(u));
  const byStudent = {};
  rows.forEach((r) => { (byStudent[r.grp + '|' + r.student] = byStudent[r.grp + '|' + r.student] || []).push(r); });
  const parts = [];
  for (const list of Object.values(byStudent)) {
    const last = list[list.length - 1], prev = list[list.length - 2];
    const p = pct(last.score, last.maxs);
    const rank = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM monthly WHERE grp = ? AND ym = ? AND score * 1.0 / maxs > ? * 1.0 / ?) + 1 AS r, (SELECT COUNT(*) FROM monthly WHERE grp = ? AND ym = ?) AS n').bind(last.grp, last.ym, last.score, last.maxs, last.grp, last.ym).first();
    let s = `👤 <b>${esc(last.student)}</b> · ${esc(last.grp)}\n🗓 <b>${esc(last.label)}</b>: ${num(last.score)}/${num(last.maxs)} — <b>${p}%</b>\n${bar(p)}`;
    if (prev) { const d = p - pct(prev.score, prev.maxs); s += `\n${d > 0 ? '📈' : d < 0 ? '📉' : '➖'} ${esc(prev.label)}ga nisbatan: ${d > 0 ? '+' : ''}${d}%`; }
    if (rank && rank.n > 1) s += `\n🏅 Guruhda: ${rank.r}-oʻrin (${rank.n} kishidan)`;
    if (list.length > 1) s += '\n\n<b>Oylar boʻyicha:</b>\n' + list.slice(-6).map((r) => `<code>${esc(r.label.slice(0, 3))}</code> ${bar(pct(r.score, r.maxs))} ${pct(r.score, r.maxs)}%`).join('\n');
    parts.push(s);
  }
  return send(env, chat, parts.join('\n\n— — —\n\n'), menuKb(u));
}
const num = (v) => Number.isInteger(v) ? v : Math.round(v * 10) / 10;

async function profile(env, chat, u) {
  const role = ROLE_NAME[u.role] || 'Oʻquvchi';
  return send(env, chat, `👤 <b>${esc(u.name || '—')}</b>\n🎓 Rol: ${role}\n📱 Raqam: ${showPhone(u.phone)}`, inl([[{text: '✏️ Ismni oʻzgartirish', callback_data: 'p:name'}, {text: '📱 Raqamni ulash', callback_data: 'p:phone'}]]));
}

// ---------- Ustoz: testlar ----------
async function listTests(env, chat, u) { const v = await testsView(env, u); return send(env, chat, v.t, v.extra); }
async function results(env, chat, u, code) {
  if (!/^[A-Z0-9]{4}$/.test(code)) return listTests(env, chat, u);
  const tt = await env.DB.prepare('SELECT * FROM tests WHERE code = ?').bind(code).first();
  if (!tt || (tt.teacher_id !== u.id && !can(u, 'alltests'))) return send(env, chat, 'Bunday kodli testingiz topilmadi.');
  const rows = (await env.DB.prepare('SELECT name, correct, total, created, answers FROM results WHERE code = ? ORDER BY correct DESC, created ASC').bind(code).all()).results || [];
  if (!rows.length) return send(env, chat, `📝 ${esc(tt.title)} (${code}) — hali hech kim topshirmagan.`);
  const avg = Math.round(rows.reduce((s, r) => s + pct(r.correct, r.total), 0) / rows.length);
  const miss = new Array(tt.n).fill(0);
  rows.forEach((r) => { for (let i = 0; i < tt.n; i++) if (r.answers[i] !== tt.answer_key[i]) miss[i]++; });
  const top = miss.map((v, i) => [i + 1, v]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const lines = rows.slice(0, 50).map((r, i) => `${i < 3 ? ['🥇', '🥈', '🥉'][i] : (i + 1) + '.'} ${esc(r.name)} — <b>${r.correct}/${r.total}</b> (${pct(r.correct, r.total)}%)`);
  return send(env, chat, `📊 <b>${esc(tt.title)}</b> (${code})\n👥 ${rows.length} kishi · oʻrtacha <b>${avg}%</b>\n${bar(avg)}\n` + (top.length ? `❗ Koʻp xato: ${top.map((x) => x[0] + '-savol (' + x[1] + ')').join(', ')}\n` : '') + '\n' + lines.join('\n'), inl([[{text: '📤 Excel / Sheets', callback_data: 'xp:' + code}, {text: '⚙️ Sozlash', callback_data: 'tm:' + code}]]));
}
async function groupSummary(env, chat, u) {
  const rows = (await env.DB.prepare('SELECT m.grp, m.teacher, m.label, COUNT(*) AS n, AVG(m.score * 100.0 / m.maxs) AS avg FROM monthly m JOIN (SELECT grp, MAX(ym) AS ym FROM monthly GROUP BY grp) l ON l.grp = m.grp AND l.ym = m.ym GROUP BY m.grp ORDER BY m.grp').all()).results || [];
  if (!rows.length) return send(env, chat, '🗓 Hali oylik natijalar kiritilmagan.\nGoogle Sheets jadvalida «🌱 Ilmzor → 📤 Natijalarni botga yuborish» ni bosing.', menuKb(u));
  return send(env, chat, '🗓 <b>Oylik natijalar</b> (har guruhning oxirgi oyi)\n\n' + rows.map((r) => `<b>${esc(r.grp)}</b>${r.teacher ? ' · ' + esc(r.teacher) : ''}\n${esc(r.label)} · ${r.n} kishi · oʻrtacha <b>${Math.round(r.avg)}%</b>\n${bar(Math.round(r.avg))}`).join('\n\n'), menuKb(u));
}
async function stats(env, chat, u) {
  const q = async (sql) => (await env.DB.prepare(sql).first()).c;
  const [all, stu, tea, ph, tests, res, mon, q2] = await Promise.all([
    q('SELECT COUNT(*) c FROM users'), q("SELECT COUNT(*) c FROM users WHERE role = 'student'"), q("SELECT COUNT(*) c FROM users WHERE role != 'student'"),
    q("SELECT COUNT(*) c FROM users WHERE phone IS NOT NULL AND phone != ''"), q('SELECT COUNT(*) c FROM tests'), q('SELECT COUNT(*) c FROM results'),
    q('SELECT COUNT(DISTINCT grp || student) c FROM monthly'), q('SELECT COUNT(*) c FROM outbox')]);
  return send(env, chat, `📈 <b>Statistika</b>\n\n👥 Foydalanuvchilar: <b>${all}</b>\n   🎓 Oʻquvchi: ${stu} · 👨‍🏫 Ustoz/admin: ${tea}\n   📱 Raqam ulagan: ${ph} (${pct(ph, all)}%)\n📝 Testlar: <b>${tests}</b> · topshirishlar: <b>${res}</b>\n🗓 Oylik natijasi bor oʻquvchilar: <b>${mon}</b>\n📤 Navbatdagi xabarlar: ${q2}`, menuKb(u));
}

// ---------- Inline tugmalar ----------
async function onCallback(cq, env) {
  const u = await getUser(env, cq.from); const chat = cq.message ? cq.message.chat.id : cq.from.id; const data = cq.data || '';
  const [k, v] = data.split(':');
  const answer = (t) => tg(env, 'answerCallbackQuery', {callback_query_id: cq.id, text: t || ''});
  if (k === 'sub') return subCallback(env, cq, u, chat, answer);
  if (!(await subOk(env, u))) { await answer(); return subAsk(env, chat); }
  if (k === 'vzP' || k === 'vzB' || k === 'vzY' || k === 'vzO' || k === 'vzQ') return vzShopCb(env, cq, u, chat, k, v, answer);
  if (k === 'vzS' || k === 'vzU' || k === 'vzR' || k === 'vzX' || k === 'vzC' || k === 'vzK') return vzCallback(env, cq, u, chat, k, v, answer);
  if (await onMore(cq, env, u, chat, data, answer)) return;
  if (k === 'p') {
    await answer();
    if (v === 'name') { await setState(env, u, 'ask_name'); return send(env, chat, 'Yangi ism va familiyangizni yozing:', cancelKb); }
    return askPhone(env, chat, u);
  }
  if ((k === 'r' || k === 't') && isTeacher(u)) {
    const tt = await env.DB.prepare('SELECT * FROM tests WHERE code = ?').bind(v).first();
    if (!tt || (tt.teacher_id !== u.id && !can(u, 'alltests'))) return answer('Test topilmadi');
    if (k === 'r') { await answer(); return results(env, chat, u, v); }
    await env.DB.prepare('UPDATE tests SET open = ? WHERE code = ?').bind(tt.open ? 0 : 1, v).run();
    if (tt.open) await notifyClosed(env, tt, false); else await env.DB.prepare('UPDATE tests SET deadline = NULL WHERE code = ? AND deadline < ?').bind(v, Date.now()).run();
    await answer(tt.open ? '🔒 Yopildi' : '🔓 Ochildi');
    const view = await testsView(env, u);
    return tg(env, 'editMessageText', Object.assign({chat_id: chat, message_id: cq.message.message_id, text: view.t, parse_mode: 'HTML'}, view.extra));
  }
  if (k === 'b' && can(u, 'bcast')) {
    if (u.state !== 'b_target' || !u.d.mid) return answer('Xabar topilmadi, qaytadan boshlang');
    if (v === 'no') { await setState(env, u, 'idle'); await answer('Bekor qilindi'); return send(env, chat, 'Bekor qilindi.', menuKb(u)); }
    const where = v === 'stu' ? "WHERE COALESCE(blocked, 0) = 0 AND role = 'student'" : v === 'tea' ? "WHERE COALESCE(blocked, 0) = 0 AND role != 'student'" : 'WHERE COALESCE(blocked, 0) = 0';
    const now = Date.now();
    const ins = await env.DB.prepare('INSERT INTO broadcasts (admin, target, total, created) VALUES (?, ?, 0, ?)').bind(u.id, v, now).run();
    const bid = ins.meta && ins.meta.last_row_id;
    const payload = JSON.stringify({from: chat, mid: u.d.mid});
    const r = await env.DB.prepare(`INSERT INTO outbox (chat, kind, payload, bid) SELECT id, 'copy', ?, ? FROM users ${where}`).bind(payload, bid).run();
    const total = (r.meta && r.meta.changes) || 0;
    await env.DB.prepare('UPDATE broadcasts SET total = ? WHERE id = ?').bind(total, bid).run();
    await setState(env, u, 'idle'); await answer('Navbatga qoʻyildi');
    return send(env, chat, `⏳ Xabar <b>${total}</b> kishiga yuborish navbatiga qoʻyildi.\nTaxminan ${Math.max(1, Math.ceil(total / PER_RUN))} daqiqada tugaydi, oxirida hisobot keladi.`, menuKb(u));
  }

  if (k === 'os') { await answer(); return olympOpen(env, chat, u, +v); }
  if (k === 'oi') { await answer(); return olympSend(env, chat, u, +v); }
  if (k === 'of') { await answer(); await setState(env, u, 'o_find', {setid: +v}); return send(env, chat, "🔎 Ism va familiyangizni yozing (masalan: <i>Ali Valiyev</i>):", cancelKb); }
  if (can(u, 'results')) {
    if (k === 'rt') {
      await answer(); const st = await env.DB.prepare('SELECT title, open_at FROM rsets WHERE id = ?').bind(+v).first();
      if (!st) return true;
      await send(env, chat, `⏰ <b>${esc(st.title)}</b>\n${isLocked(st) ? '🔒 Hozir: fayllar yopiq — <b>' + lockWhen(st) + '</b> ochiladi' : '📂 Hozir: fayllar hammaga ochiq'}\n\nOʻquvchilar fayllarni qachongacha koʻrmasin? (shu vaqtgacha faqat ism-familiya orqali qidiradi)`, inl([[{text: '1 soat', callback_data: `rT:${v}:1`}, {text: '3 soat', callback_data: `rT:${v}:3`}, {text: '24 soat', callback_data: `rT:${v}:24`}], [{text: '3 kun', callback_data: `rT:${v}:72`}, {text: '1 hafta', callback_data: `rT:${v}:168`}], [{text: '📅 Sana va vaqt yozish', callback_data: 'rW:' + v}], [{text: '♾ Qoʻlda ochgunimcha yopiq', callback_data: `rT:${v}:m`}, {text: '🔓 Hozir ochish', callback_data: `rT:${v}:n`}]]));
      return true;
    }
    if (k === 'rT') {
      const w = data.split(':')[2];
      const st = await env.DB.prepare('SELECT title FROM rsets WHERE id = ?').bind(+v).first();
      if (!st) { await answer('Topilmadi'); return true; }
      const at = w === 'n' ? null : w === 'm' ? FOREVER : (/^\d+$/.test(w || '') ? Date.now() + (+w) * 3600e3 : undefined);
      if (at === undefined) { await answer('Notoʻgʻri'); return true; }
      await env.DB.prepare('UPDATE rsets SET open_at = ? WHERE id = ?').bind(at, +v).run();
      await answer('Saqlandi');
      await send(env, chat, at == null ? `🔓 <b>${esc(st.title)}</b> — fayllar hammaga ochiq.` : `🔒 <b>${esc(st.title)}</b> — oʻquvchilar faqat ism-familiya bilan qidiradi.\n⏰ Fayllar <b>${lockWhen({open_at: at})}</b> ochiladi.`);
      return true;
    }
    if (k === 'rW') { await answer(); await setState(env, u, 'r_time', {setid: +v}); await send(env, chat, '📅 Fayllar ochiladigan sana va vaqtni yozing (Toshkent vaqti):\n<code>12.11 18:00</code>', cancelKb); return true; }
    if (k === 'rn') { await answer(); await setState(env, u, 'r_newset'); return send(env, chat, "🆕 Yangi natijalar toʻplami nomini yozing\n(masalan: <i>Tezkor matematika — 8-noyabr</i>):", cancelKb); }
    if (k === 'ra') { await answer(); await setState(env, u, 'r_label', {setid: +v}); return send(env, chat, "➕ Tugma nomini yozing (masalan: <i>3-sinf</i>):", cancelKb); }
    if (k === 'rc') { await answer(); return rAdminEdit(env, chat, cq, u); }
    if (k === 'rx') { const s = await env.DB.prepare('SELECT active FROM rsets WHERE id = ?').bind(+v).first(); if (s) await env.DB.prepare('UPDATE rsets SET active = ? WHERE id = ?').bind(s.active ? 0 : 1, +v).run(); await answer(s && s.active ? 'Yashirildi' : "Koʻrsatildi"); return rAdminEdit(env, chat, cq, u); }
    if (k === 'rd') { await answer(); return tg(env, 'editMessageText', {chat_id: chat, message_id: cq.message.message_id, text: "🗑 Shu toʻplam va uning fayllari oʻchirilsinmi?", parse_mode: 'HTML', reply_markup: {inline_keyboard: [[{text: "✅ Ha, oʻchir", callback_data: 'rD:' + v}, {text: "❌ Yoʻq", callback_data: 'rc:0'}]]}}); }
    if (k === 'rD') { await env.DB.prepare('DELETE FROM ritems WHERE set_id = ?').bind(+v).run(); await env.DB.prepare('DELETE FROM rsets WHERE id = ?').bind(+v).run(); await answer("Oʻchirildi"); return rAdminEdit(env, chat, cq, u); }
    if (k === 'vt') { const key = u.d.vk; if (!key) return answer('Avval ism qidiring'); if (v === '1') { await env.DB.prepare('INSERT OR REPLACE INTO vused (k, used, used_at) VALUES (?, 1, ?)').bind(key, Date.now()).run(); await answer('🔴 Ishlatilgan deb belgilandi'); } else { await env.DB.prepare('DELETE FROM vused WHERE k = ?').bind(key).run(); await answer('✅ Bekor qilindi'); } const uu = await env.DB.prepare('SELECT used_at FROM vused WHERE k = ?').bind(key).first(); return tg(env, 'editMessageReplyMarkup', {chat_id: chat, message_id: cq.message.message_id, reply_markup: {inline_keyboard: [vbtn(!!uu)]}}); }
  }
  return answer();
}

// ---------- Navbatdagi xabarlar (har daqiqada, Cron) ----------
const PER_RUN = 35;
async function flushOutbox(env) {
  const rows = (await env.DB.prepare('SELECT * FROM outbox ORDER BY id LIMIT ?').bind(PER_RUN).all()).results || [];
  if (!rows.length) return 0;
  const stat = {}; const blockedIds = [];
  for (const r of rows) {
    const p = JSON.parse(r.payload || '{}'); let res;
    try {
      res = r.kind === 'copy' ? await tg(env, 'copyMessage', {chat_id: r.chat, from_chat_id: p.from, message_id: p.mid}) : await send(env, r.chat, p.text, p.extra || {});
    } catch (e) { res = {ok: false}; }
    if (res && !res.ok && (res.error_code === 403 || /blocked|deactivated|chat not found/i.test(res.description || ''))) blockedIds.push(r.chat);
    if (r.bid) { stat[r.bid] = stat[r.bid] || {ok: 0, fail: 0}; stat[r.bid][res && res.ok ? 'ok' : 'fail']++; }
  }
  if (blockedIds.length) await env.DB.prepare(`UPDATE users SET blocked = 1 WHERE id IN (${blockedIds.map(() => '?').join(',')})`).bind(...blockedIds).run();
  await env.DB.prepare(`DELETE FROM outbox WHERE id IN (${rows.map(() => '?').join(',')})`).bind(...rows.map((r) => r.id)).run();
  for (const [bid, s] of Object.entries(stat)) {
    await env.DB.prepare('UPDATE broadcasts SET sent = sent + ?, failed = failed + ? WHERE id = ?').bind(s.ok, s.fail, +bid).run();
    const left = await env.DB.prepare('SELECT COUNT(*) AS c FROM outbox WHERE bid = ?').bind(+bid).first();
    if (!left.c) {
      const b = await env.DB.prepare('SELECT * FROM broadcasts WHERE id = ?').bind(+bid).first();
      if (b && !b.done) {
        await env.DB.prepare('UPDATE broadcasts SET done = 1 WHERE id = ?').bind(+bid).run();
        await send(env, b.admin, `✅ <b>Xabar yuborildi</b>\n📬 Yetib bordi: <b>${b.sent}</b> / ${b.total}\n🚫 Yetmadi (botni bloklagan): ${b.failed}`);
      }
    }
  }
  return rows.length;
}

// ---------- Google Sheets'dan oylik natijalar ----------
// POST /import, sarlavha X-Ilmzor-Key: IMPORT_KEY
// {grp, teacher, rows: [{student, phone1, phone2, ym: '2026-10', label: 'Oktabr', score, max}], notify: true}
async function importMonthly(request, env) {
  if (!env.IMPORT_KEY || request.headers.get('X-Ilmzor-Key') !== env.IMPORT_KEY) return json({ok: false, error: 'kalit notoʻgʻri'}, 403);
  let body; try { body = await request.json(); } catch (e) { return json({ok: false, error: 'JSON xato'}, 400); }
  const grp = String(body.grp || '').trim().slice(0, 60), teacher = String(body.teacher || '').trim().slice(0, 60);
  if (!grp) return json({ok: false, error: 'guruh nomi yoʻq'}, 400);
  const rows = (body.rows || []).map((r) => ({student: String(r.student || '').trim().slice(0, 60), p1: phone9(r.phone1), p2: phone9(r.phone2), ym: String(r.ym || ''), label: String(r.label || '').slice(0, 20), score: Number(r.score), max: Number(r.max)}))
    .filter((r) => r.student && /^\d{4}-\d{2}$/.test(r.ym) && isFinite(r.score) && r.max > 0);
  const seen = {};
  const nk = (r) => r.student.toLowerCase().replace(/\s+/g, ' ');
  rows.forEach((r) => { (seen[nk(r)] = seen[nk(r)] || new Set()).add(r.p1 + '/' + r.p2); });
  rows.forEach((r) => { if (seen[nk(r)].size > 1) r.student = (r.student + ' (' + ((r.p1 || r.p2 || '?').slice(-4)) + ')').slice(0, 60); });
  const old = {};
  ((await env.DB.prepare('SELECT student, ym, score FROM monthly WHERE grp = ?').bind(grp).all()).results || []).forEach((r) => { old[r.student + '|' + r.ym] = r.score; });
  const now = Date.now(); const stmts = [env.DB.prepare('DELETE FROM monthly WHERE grp = ?').bind(grp)];
  for (let i = 0; i < rows.length; i += 9) {
    const chunk = rows.slice(i, i + 9);
    stmts.push(env.DB.prepare('INSERT OR REPLACE INTO monthly (grp, teacher, student, phone1, phone2, ym, label, score, maxs, updated) VALUES ' + chunk.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(','))
      .bind(...chunk.flatMap((r) => [grp, teacher, r.student, r.p1, r.p2, r.ym, r.label, r.score, r.max, now])));
  }
  await env.DB.batch(stmts);
  // Yangi yoki o'zgargan natijalar uchun xabar (har o'quvchiga eng oxirgi o'zgargan oy)
  let queued = 0;
  if (body.notify !== false) {
    const changed = {};
    rows.forEach((r) => { if (old[r.student + '|' + r.ym] !== r.score && (!changed[r.student] || changed[r.student].ym < r.ym)) changed[r.student] = r; });
    const list = Object.values(changed);
    const phones = [...new Set(list.flatMap((r) => [r.p1, r.p2]).filter(Boolean))];
    const users = {};
    for (let i = 0; i < phones.length; i += 90) {
      const part = phones.slice(i, i + 90);
      ((await env.DB.prepare(`SELECT id, phone FROM users WHERE phone IN (${part.map(() => '?').join(',')})`).bind(...part).all()).results || []).forEach((x) => { (users[x.phone] = users[x.phone] || []).push(x.id); });
    }
    const out = [];
    for (const r of list) {
      const ids = [...new Set([...(users[r.p1] || []), ...(users[r.p2] || [])])]; const p = pct(r.score, r.max);
      const msgText = `🗓 <b>${esc(r.label)}</b> oylik test natijasi chiqdi!\n\n👤 ${esc(r.student)} · ${esc(grp)}\n✅ <b>${num(r.score)}/${num(r.max)} — ${p}%</b>\n${bar(p)}\n\nBatafsil: «${B.monthly}»`;
      ids.forEach((id) => out.push(env.DB.prepare("INSERT INTO outbox (chat, kind, payload, bid) VALUES (?, 'text', ?, NULL)").bind(id, JSON.stringify({text: msgText}))));
    }
    if (out.length) await env.DB.batch(out);
    queued = out.length;
  }
  return json({ok: true, grp, saved: rows.length, students: new Set(rows.map((r) => r.student)).size, notified: queued});
}


// ---------- Olimpiada / test natijalari ----------
function normName(s) { return String(s || '').toLowerCase().replace(/[ʻ‘’'`]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
function parseCsvLine(ln) { const out = []; let cur = '', q = false; for (let i = 0; i < ln.length; i++) { const ch = ln[i]; if (q) { if (ch === '"') { if (ln[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; } else { if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; } } out.push(cur); return out.map((x) => x.trim()); }
function matchName(cell, qt) { const n = normName(cell); if (n.length < 3) return false; return qt.every((tok) => n.includes(tok)); }

const csvCache = new Map();
async function getCsv(url) {
  const hit = csvCache.get(url);
  if (hit && Date.now() - hit.t < 60000) return hit.text;
  const r = await fetch(url, {cf: {cacheTtl: 60}});
  if (!r.ok) throw new Error('csv ' + r.status);
  const text = await r.text();
  csvCache.set(url, {t: Date.now(), text});
  if (csvCache.size > 20) csvCache.delete(csvCache.keys().next().value);
  return text;
}
const FOREVER = 253402300799000;
const isLocked = (st) => !!st && !!st.open_at && st.open_at > Date.now();
const lockWhen = (st) => st.open_at >= FOREVER ? 'ustoz ochgunicha' : fmtDate(st.open_at) + ' da';
async function olympList(env, chat, u) {
  const sets = (await env.DB.prepare('SELECT id, title, open_at FROM rsets WHERE active = 1 ORDER BY created DESC').all()).results || [];
  if (!sets.length) return send(env, chat, '🏆 Hozircha eʼlon qilingan natijalar yoʻq.', menuKb(u));
  return send(env, chat, '🏆 <b>Olimpiada va test natijalari</b>\n\nKerakli boʻlimni tanlang 👇', inl(sets.map((s) => [{text: (isLocked(s) && u.role === 'student' ? '🔎 ' : '📂 ') + s.title, callback_data: 'os:' + s.id}])));
}
async function olympOpen(env, chat, u, setid) {
  const s = await env.DB.prepare('SELECT * FROM rsets WHERE id = ?').bind(setid).first();
  if (!s) return send(env, chat, 'Topilmadi.', menuKb(u));
  const items = (await env.DB.prepare('SELECT id, label, csv FROM ritems WHERE set_id = ? ORDER BY id').bind(setid).all()).results || [];
  const locked = isLocked(s);
  if (locked && u.role === 'student') {
    if (!items.some((it) => it.csv)) return send(env, chat, '🔒 <b>' + esc(s.title) + '</b>\n\nNatijalar tez orada eʼlon qilinadi.', menuKb(u));
    return send(env, chat, '🔎 <b>' + esc(s.title) + '</b>\n\nHozircha natijani faqat <b>ism va familiyangiz</b> orqali koʻrasiz. Umumiy fayllar <b>' + lockWhen(s) + '</b> ochiladi 👇', inl([[{text: '🔎 Ismim boʻyicha qidirish', callback_data: 'of:' + setid}]]));
  }
  if (!items.length) return send(env, chat, '📂 <b>' + esc(s.title) + '</b>\n\nHali fayl qoʻshilmagan.', menuKb(u));
  const rows = items.map((it) => [{text: '📄 ' + it.label, callback_data: 'oi:' + it.id}]);
  if (items.some((it) => it.csv)) rows.push([{text: '🔎 Ismim boʻyicha qidirish', callback_data: 'of:' + setid}]);
  return send(env, chat, '📂 <b>' + esc(s.title) + '</b>' + (locked ? '\n🔒 Oʻquvchilarga fayllar yopiq: ' + lockWhen(s) + ' ochiladi' : '') + '\n\nSinf yoki boʻlimni tanlang — natija fayli yuboriladi 👇', inl(rows));
}
async function olympSend(env, chat, u, itemid) {
  const it = await env.DB.prepare('SELECT * FROM ritems WHERE id = ?').bind(itemid).first();
  if (!it) return send(env, chat, 'Fayl topilmadi.', menuKb(u));
  const s = await env.DB.prepare('SELECT title, open_at FROM rsets WHERE id = ?').bind(it.set_id).first();
  if (isLocked(s) && u.role === 'student') return send(env, chat, '🔒 Fayllar hozircha yopiq. Natijani ism va familiyangiz orqali qidiring; umumiy fayllar <b>' + lockWhen(s) + '</b> ochiladi.', menuKb(u));
  return tg(env, it.ftype === 'photo' ? 'sendPhoto' : 'sendDocument', {chat_id: chat, [it.ftype === 'photo' ? 'photo' : 'document']: it.fid, caption: '🏆 ' + esc(s ? s.title : '') + ' — ' + esc(it.label), parse_mode: 'HTML'});
}
const TIERS = [
  {max: 3, n: 'Oltin', a: 150000, c1: '#f4dd8a', c2: '#d4a829', ink: '#6b4e00'},
  {max: 10, n: 'Kumush', a: 120000, c1: '#eef2f6', c2: '#9aa6b4', ink: '#3a4654'},
  {max: 20, n: 'Bronza', a: 100000, c1: '#f0c59a', c2: '#c07a3e', ink: '#5a2f12'},
  {max: 50, n: 'Koʻk', a: 50000, c1: '#bfe0ff', c2: '#4b8fd6', ink: '#123a63'},
  {max: Infinity, n: 'Ishtirok', a: 30000, c1: '#bfead9', c2: '#3fbf8f', ink: '#114b38'}
];
const tierOf = (rank) => { const r = parseInt(rank, 10) || 999; return TIERS.find((t) => r <= t.max) || TIERS[TIERS.length - 1]; };
const VDEADLINE = '\n\n📌 Vaucher <b>1-dekabr</b>gacha roʻyxatdan oʻtilsa amal qiladi.';
function vtier(rank) { const t = tierOf(rank); return {n: t.n, a: t.a}; }
const vkey = (setid, label, name) => setid + '|' + label + '|' + normName(name);
const fmtSom = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const vbtn = (used) => used ? [{text: '♻️ Bekor qilish', callback_data: 'vt:0'}] : [{text: '🔴 Ishlatilgan deb belgilash', callback_data: 'vt:1'}];
async function olympFind(env, chat, u, name) {
  const setid = u.d.setid; const qt = normName(name).split(' ').filter(Boolean);
  if (qt.join('').length < 4 || qt.length < 2) { return send(env, chat, 'Iltimos, <b>toʻliq</b> ism va familiyangizni yozing (masalan: <i>Ali Valiyev</i>):'); }
  const items = (await env.DB.prepare("SELECT label, csv FROM ritems WHERE set_id = ? AND csv IS NOT NULL AND csv != ''").bind(setid).all()).results || [];
  const found = [];
  await Promise.all(items.map((it) => getCsv(it.csv).catch(() => '')));
  for (const it of items) {
    try {
      const text = await getCsv(it.csv);
      const lines = text.split(/\r?\n/);
      for (const ln of lines) { const cells = parseCsvLine(ln); if (cells.length < 3) continue; for (const c of cells) { if (matchName(c, qt)) { found.push({label: it.label, cells}); break; } } }
    } catch (e) {}
  }
  if (!found.length) { await setState(env, u, 'idle'); return send(env, chat, '🔎 «' + esc(name) + '» topilmadi.\nIsmni toʻliq va toʻgʻri yozganingizni tekshiring yoki yuqoridagi fayldan qarang.', menuKb(u)); }
  const parts = [];
  for (const f of found.slice(0, 6)) {
    const c = f.cells; const rank = c[0], nm = c[1] || '', mak = c[2] || '', ball = c[c.length - 2] || '', foiz = c[c.length - 1] || '';
    const vt = vtier(rank); const total = vt.a * 6; const k = vkey(setid, f.label, nm);
    const uu = await env.DB.prepare('SELECT used_at FROM vused WHERE k = ?').bind(k).first();
    const st = uu ? '🔴 <b>Ishlatilgan</b> (' + fmtDate(uu.used_at) + ')' : '✅ Ishlatilmagan';
    parts.push('📄 <b>' + esc(f.label) + '</b>\n🏅 Oʻrin: <b>' + esc(rank) + '</b>\n👤 ' + esc(nm) + (mak && mak !== '-' ? ' · ' + esc(mak) + '-maktab' : '') + '\n⭐ Ball: <b>' + esc(ball) + '</b> · ' + esc(foiz) + '\n🎟 Vaucher (' + vt.n + '): <b>' + fmtSom(vt.a) + ' soʻm</b>/oy · jami <b>' + fmtSom(total) + ' soʻm</b>\n📋 Holati: ' + st);
  }
  const body = parts.join('\n\n— — —\n\n');
  if (found.length === 1) {
    const f = found[0]; const c = f.cells; const nm = c[1] || '', rank = c[0], mak = c[2] || '', foiz = c[c.length - 1] || '', ball = c[c.length - 2] || '';
    const cl = f.label.replace('-sinf', '');
    const vq = {n: nm, c: cl, r: rank, b: ball, p: foiz, m: mak}; const vurl = WORKER_URL + '/v?s=' + (await vsign(env, vq)) + '&n=' + encodeURIComponent(nm) + '&c=' + encodeURIComponent(cl) + '&r=' + encodeURIComponent(rank) + '&b=' + encodeURIComponent(ball) + '&p=' + encodeURIComponent(foiz) + '&m=' + encodeURIComponent(mak);
    /** @type {any[]} */
    const vt2 = vtier(rank); const vinfo = vt2.n + ' · ' + fmtSom(vt2.a * 6) + ' soʻm';
    const rows = [[{text: '🎟 Vaucherni ochish / saqlash', url: vurl}], [{text: '🎓 Vaucher bilan kursga yozilish', callback_data: 'vj:0'}]];
    if (can(u, 'results')) {
      const k = vkey(setid, f.label, nm);
      const uu = await env.DB.prepare('SELECT used_at FROM vused WHERE k = ?').bind(k).first();
      await setState(env, u, 'idle', {vk: k, vinfo}); rows.push(vbtn(!!uu));
    } else { await setState(env, u, 'idle', {vinfo}); }
    return send(env, chat, body + VDEADLINE, inl(rows));
  }
  await setState(env, u, 'idle', {vinfo: 'Olimpiada vaucheri'});
  return send(env, chat, body + VDEADLINE, inl([[{text: '🎓 Vaucher bilan kursga yozilish', callback_data: 'vj:0'}]]));
}
function rSetRows(sets) {
  const rows = [];
  for (const s of sets) { rows.push([{text: (s.active ? '👁 ' : '🙈 ') + (isLocked(s) ? '🔒 ' : '') + s.title + ' (' + s.n + ')', callback_data: 'rc:0'}]); rows.push([{text: '➕ Qoʻshish', callback_data: 'ra:' + s.id}, {text: s.active ? '🙈 Yashirish' : '👁 Koʻrsatish', callback_data: 'rx:' + s.id}, {text: isLocked(s) ? '🔒 Vaqt' : '⏰ Vaqt', callback_data: 'rt:' + s.id}, {text: '🗑', callback_data: 'rd:' + s.id}]); }
  rows.push([{text: '🆕 Yangi toʻplam', callback_data: 'rn:0'}]);
  return rows;
}
async function rAdmin(env, chat, u, note) {
  const sets = (await env.DB.prepare('SELECT s.id, s.title, s.active, s.open_at, (SELECT COUNT(*) FROM ritems WHERE set_id = s.id) AS n FROM rsets s ORDER BY s.created DESC').all()).results || [];
  return send(env, chat, (note ? note + '\n\n' : '') + '🏆 <b>Natijalar — admin</b>\n\nHar toʻplamga sinf/boʻlim tugmasi va fayl qoʻshing. 👁 faol toʻplamlar oʻquvchilarga «' + B.olymp + '» boʻlimida koʻrinadi.\n🔒 — fayllar oʻquvchilarga yopiq, ular faqat ism-familiya bilan qidiradi. ⏰ tugmasi bilan ochilish vaqtini belgilang.', inl(rSetRows(sets)));
}
async function rAdminEdit(env, chat, cq, u) {
  const sets = (await env.DB.prepare('SELECT s.id, s.title, s.active, s.open_at, (SELECT COUNT(*) FROM ritems WHERE set_id = s.id) AS n FROM rsets s ORDER BY s.created DESC').all()).results || [];
  return tg(env, 'editMessageText', {chat_id: chat, message_id: cq.message.message_id, text: '🏆 <b>Natijalar — admin</b>\n\n👁 faol toʻplamlar oʻquvchilarga koʻrinadi.', parse_mode: 'HTML', reply_markup: {inline_keyboard: rSetRows(sets)}});
}


// ---------- Vaucher veb-sahifasi (o'quvchi o'zi yuklab oladi) ----------
const WORKER_URL = "https://ilmzor-test-bot.nomonovnosirbek15.workers.dev";
const VLOGO = "data:image/png;base64,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";
const VFIELDS = ['n', 'c', 'r', 'b', 'p', 'm'];
async function vsign(env, o) {
  const secret = env.VOUCHER_KEY || env.WEBHOOK_SECRET; if (!secret) return '';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(secret)), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(VFIELDS.map((k) => o[k] || '').join('|')));
  return [...new Uint8Array(sig)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function vcheck(sp, env) {
  const o = {}; VFIELDS.forEach((k) => { o[k] = sp.get(k) || ''; });
  const want = await vsign(env, o); const got = sp.get('s') || '';
  return !!want && safeEq(want, got);
}
const vsom = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
function vhtml(sp) {
  const E = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const name = sp.get('n') || '', cls = sp.get('c') || '', rank = sp.get('r') || '', ball = sp.get('b') || '', foiz = sp.get('p') || '', mak = sp.get('m') || '';
  const t = tierOf(rank); const tn = t.n, c1 = t.c1, c2 = t.c2, ink = t.ink, amt = t.a; const total = amt * 6;
  const makTxt = /^\d+$/.test(mak) ? ' · ' + E(mak) + '-maktab' : (mak && mak !== '-' ? ' · ' + E(mak) : '');
  const cell = '<td class="cell"><div class="amt">' + vsom(amt) + '</div><div class="st">muhr</div></td>';
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vaucher — ${E(name)}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{background:#0a1a2f;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#eaf1fa;padding:14px 0 30px;text-align:center;}
#stage{transform-origin:top center;margin:0 auto;}
#vch{position:relative;width:1240px;height:880px;overflow:hidden;color:#eaf1fa;text-align:left;
 background:radial-gradient(1200px 560px at 82% -12%,rgba(232,193,90,.16),transparent 60%),linear-gradient(135deg,#0c2744,#0f2f53 50%,#0b2340);}
.fr{position:absolute;inset:22px;border:2px solid rgba(232,193,90,.55);border-radius:18px;}
.fr:before{content:"";position:absolute;inset:8px;border:1px solid rgba(232,193,90,.28);border-radius:13px;}
.cn{position:absolute;width:40px;height:40px;border:3px solid ${c1};}
.tl{left:36px;top:36px;border-right:0;border-bottom:0;border-radius:11px 0 0 0;}
.tr{right:36px;top:36px;border-left:0;border-bottom:0;border-radius:0 11px 0 0;}
.bl{left:36px;bottom:36px;border-right:0;border-top:0;border-radius:0 0 0 11px;}
.br{right:36px;bottom:36px;border-left:0;border-top:0;border-radius:0 0 11px 0;}
.in{position:absolute;inset:22px;padding:30px 46px;display:flex;flex-direction:column;}
.top{display:flex;justify-content:space-between;align-items:center;}
.top img{width:104px;height:104px;}
.ol{text-align:right;}
.ol .t{font-size:16px;letter-spacing:1.4px;color:#fff;font-weight:700;}
.ol .d{font-size:12.5px;color:${c1};letter-spacing:2.5px;margin-top:4px;}
.rb{align-self:center;margin-top:4px;padding:8px 36px;border-radius:30px;background:linear-gradient(90deg,${c2},${c1},${c2});color:${ink};font-weight:700;font-size:21px;letter-spacing:7px;box-shadow:0 7px 18px rgba(0,0,0,.3);}
.hd{display:flex;align-items:center;gap:26px;margin-top:16px;}
.md{width:132px;text-align:center;flex:0 0 auto;}
.pc{font-weight:700;font-size:15px;color:${c1};}
.who{flex:1;min-width:0;}
.lb{font-size:12px;letter-spacing:3px;color:${c1};}
.nm{font-weight:800;font-size:40px;color:#fff;line-height:1.05;margin:4px 0;}
.mt{font-size:16px;color:#c3d2e6;}
.tb{flex:0 0 auto;width:372px;text-align:center;padding:18px 14px 15px;border-radius:16px;border:2px solid ${c1};background:linear-gradient(180deg,rgba(232,193,90,.10),rgba(232,193,90,.03));box-shadow:0 0 34px rgba(232,193,90,.22);}
.tb .l{font-size:13px;letter-spacing:4px;color:${c1};}
.tb .v{font-weight:800;font-size:60px;line-height:1;margin-top:4px;white-space:nowrap;color:${c1};text-shadow:0 1px 2px rgba(0,0,0,.35);}
.tb .u{font-size:17px;color:#fff;font-weight:700;}
.tb .s{font-size:12px;color:#c3d2e6;margin-top:5px;}
.sb{display:flex;align-items:center;gap:20px;margin-top:18px;}
.sb .q{font-size:14px;color:#dfe8f3;}
.ck{display:flex;align-items:center;gap:9px;font-size:17px;color:#fff;}
.bx{width:22px;height:22px;border:2px solid ${c1};border-radius:5px;}
table{width:100%;border-collapse:separate;border-spacing:11px;margin-top:12px;}
th{font-size:13px;letter-spacing:2px;color:${c1};font-weight:700;}
td.rl{width:118px;font-weight:700;font-size:18px;color:#fff;}
td.cell{background:rgba(255,255,255,.055);border:1.5px solid rgba(232,193,90,.4);border-radius:11px;height:72px;text-align:center;}
td.cell .amt{font-weight:800;font-size:27px;color:${c1};}
td.cell .st{font-size:10px;color:#8ea2ba;letter-spacing:1px;margin-top:2px;border-top:1px dashed rgba(255,255,255,.16);padding-top:3px;width:66%;margin:2px auto 0;}
.ft{display:flex;justify-content:space-between;align-items:flex-end;margin-top:auto;padding-top:12px;}
.no{font-family:monospace;font-size:14px;color:#fff;letter-spacing:1px;}
.ru{font-size:11.5px;margin-top:5px;max-width:560px;line-height:1.5;color:#9fb2c9;}
.sg{text-align:center;min-width:270px;}
.sg .ln{width:240px;border-top:1.6px solid ${c1};margin:0 auto;}
.sg .n{font-weight:700;font-size:18px;color:#fff;margin-top:6px;}
.sg .r{font-size:12px;color:${c1};margin-top:2px;}
#dl{margin:18px auto 0;display:inline-block;padding:14px 28px;font-size:17px;font-weight:700;border:0;border-radius:12px;background:linear-gradient(90deg,#d4a829,#f4dd8a);color:#5a3d00;cursor:pointer;box-shadow:0 6px 16px rgba(0,0,0,.3);}
.hint{color:#8ea2ba;font-size:13px;margin-top:10px;}
</style></head><body>
<div id="stage"><div id="vch">
<div class="fr"></div><span class="cn tl"></span><span class="cn tr"></span><span class="cn bl"></span><span class="cn br"></span>
<div class="in">
<div class="top"><img src="${VLOGO}" alt="ilmzor"><div class="ol"><div class="t">«TEZKOR MATEMATIKA» OLIMPIADASI</div><div class="d">8-NOYABR · 2026 · NATIJALARI</div></div></div>
<div class="rb">${tn.toUpperCase()} VAUCHER</div>
<div class="hd">
<div class="md"><svg width="132" height="150" viewBox="0 0 132 150"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><path d="M36 6 L54 6 L76 82 L54 82 Z" fill="#9a2f2f"/><path d="M96 6 L78 6 L56 82 L78 82 Z" fill="#b23b3b"/><circle cx="66" cy="100" r="46" fill="url(#g)" stroke="#fff6da" stroke-width="2.5"/><circle cx="66" cy="100" r="39" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1.4"/><text x="66" y="110" text-anchor="middle" font-family="Arial" font-weight="bold" font-size="48" fill="${ink}">${E(rank)}</text><text x="66" y="133" text-anchor="middle" font-family="Arial" font-weight="bold" font-size="13" letter-spacing="2.5" fill="${ink}">OʻRIN</text></svg><div class="pc">Natija: ${E(foiz)}</div></div>
<div class="who"><div class="lb">ISM VA FAMILIYA</div><div class="nm">${E(name)}</div><div class="mt">${E(cls)}-sinf${makTxt}</div></div>
<div class="tb"><div class="l">JAMI QIYMAT</div><div class="v">${vsom(total)}</div><div class="u">soʻm</div><div class="s">2 ta fan × 3 oy chegirma</div></div>
</div>
<div class="sb"><span class="q">Fanni tanlang (2 ta):</span><span class="ck"><span class="bx"></span>Matematika</span><span class="ck"><span class="bx"></span>Ingliz tili</span><span class="ck"><span class="bx"></span>Rus tili</span></div>
<table><tr><th></th><th>1-oy</th><th>2-oy</th><th>3-oy</th></tr><tr><td class="rl">1-fan</td>${cell}${cell}${cell}</tr><tr><td class="rl">2-fan</td>${cell}${cell}${cell}</tr></table>
<div class="ft"><div><div class="no">№ TM8-${E(cls)}-${E(rank)}</div><div class="ru">Har oy, har fan uchun ${vsom(amt)} soʻm chegirma (soʻmda, foizda emas). Boshqa shaxsga berilmaydi. 2026-yil 1-dekabrgacha roʻyxatdan oʻtilsa amal qiladi.</div></div><div class="sg"><div class="ln"></div><div class="n">Noʻmonov Nosirbek</div><div class="r">Ilmzor oʻquv markazi direktori</div></div></div>
</div></div></div>
<button id="dl">📥 Rasm qilib saqlash</button>
<div class="hint">Tugma ishlamasa — ekrandan skrinshot oling.</div>
<script>
function fit(){var w=Math.min(window.innerWidth-16,1240);var s=w/1240;var st=document.getElementById('stage');st.style.transform='scale('+s+')';st.style.height=(880*s)+'px';}
fit();window.addEventListener('resize',fit);
document.getElementById('dl').onclick=function(){var b=this;b.textContent='⏳ Tayyorlanmoqda...';html2canvas(document.getElementById('vch'),{scale:2,backgroundColor:null,logging:false}).then(function(cv){cv.toBlob(function(bl){var a=document.createElement('a');a.href=URL.createObjectURL(bl);a.download='vaucher-${String(cls).replace(/[^A-Za-z0-9]/g, '')}-${String(rank).replace(/[^A-Za-z0-9]/g, '')}.png';document.body.appendChild(a);a.click();a.remove();b.textContent='📥 Rasm qilib saqlash';},'image/png');}).catch(function(e){b.textContent='📥 Rasm qilib saqlash';alert('Saqlashda xatolik. Skrinshot oling.');});};
</script>
</body></html>`;
}

// =====================================================================
// YANGI: test boshqaruvi, eksport, guruhga xabar, ustoz kodi, kurslar va sotuv varonkasi
// =====================================================================
const isOpen = (t) => !!t.open && (!t.deadline || Date.now() < t.deadline);
const fullPhone = (p) => p ? `+998 ${p.slice(0, 2)} ${p.slice(2, 5)} ${p.slice(5, 7)} ${p.slice(7)}` : 'yoʻq';
const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const STAGES = {new: '🆕 Yangi', contacted: '📞 Bogʻlanildi', trial: '🧪 Sinov darsi', paid: '💰 Toʻladi', lost: '❌ Rad etdi'};
const STAGE_KEYS = ['new', 'contacted', 'trial', 'paid', 'lost'];
const STAGE_NOTE = {trial: '🧪 Sinov darsi belgilandi! Admin siz bilan aniq vaqtni kelishadi.', paid: '🎉 Tabriklaymiz! Siz kursga qabul qilindingiz. Ilmzor — bilim bogʻingiz!'};

async function ownTest(env, u, code) {
  const tt = await env.DB.prepare('SELECT * FROM tests WHERE code = ?').bind(String(code || '').toUpperCase()).first();
  return tt && (tt.teacher_id === u.id || can(u, 'alltests')) ? tt : null;
}

// ---------- HMAC (eksport havolasi) ----------
async function hmacHex(env, msg) {
  const secret = env.VOUCHER_KEY || env.WEBHOOK_SECRET; if (!secret) return '';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(secret)), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const xsign = (env, code) => hmacHex(env, 'x|' + code);
async function xcheck(env, code, sig) { const want = await xsign(env, code); return !!want && safeEq(want, sig || ''); }

// ---------- Muddat tugagan testlarni yopish (Cron) ----------
async function closeExpired(env) {
  const rows = (await env.DB.prepare('SELECT * FROM tests WHERE open = 1 AND deadline IS NOT NULL AND deadline < ? LIMIT 5').bind(Date.now()).all()).results || [];
  for (const tt of rows) {
    await env.DB.prepare('UPDATE tests SET open = 0 WHERE code = ?').bind(tt.code).run();
    await notifyClosed(env, tt, true);
  }
}
async function notifyClosed(env, tt, auto) {
  const st = await env.DB.prepare('SELECT COUNT(*) AS n, AVG(correct * 100.0 / total) AS avg FROM results WHERE code = ?').bind(tt.code).first();
  if (auto) {
    await send(env, tt.teacher_id, `⏰ <b>${esc(tt.title)}</b> (<code>${tt.code}</code>) muddati tugadi va yopildi.\n👥 ${st.n} kishi · oʻrtacha <b>${Math.round(st.avg || 0)}%</b>`, inl([[{text: '📊 Natijalar', callback_data: 'r:' + tt.code}, {text: '📤 Excel / Sheets', callback_data: 'xp:' + tt.code}]])).catch(() => {});
  }
  if (tt.reveal === 0 || !st.n) return;
  const first = await env.DB.prepare('UPDATE tests SET notified = 1 WHERE code = ? AND COALESCE(notified, 0) = 0').bind(tt.code).run();
  if (!(first.meta && first.meta.changes)) return;
  const payload = JSON.stringify({text: `🔒 <b>${esc(tt.title)}</b> testi yopildi.\nToʻgʻri javoblar va reytingni koʻrishingiz mumkin 👇`, extra: inl([[{text: '📋 Javoblar va reyting', callback_data: 'sr:' + tt.code}]])});
  await env.DB.prepare("INSERT INTO outbox (chat, kind, payload, bid) SELECT user_id, 'text', ?, NULL FROM results WHERE code = ?").bind(payload, tt.code).run();
}

// ---------- O'quvchi: javoblar va reyting ----------
async function showReveal(env, chat, u, code) {
  const tt = await env.DB.prepare('SELECT * FROM tests WHERE code = ?').bind(String(code).toUpperCase()).first();
  if (!tt) return send(env, chat, 'Test topilmadi.', menuKb(u));
  const mine = await env.DB.prepare('SELECT * FROM results WHERE code = ? AND user_id = ?').bind(tt.code, u.id).first();
  if (!mine && !isTeacher(u)) return send(env, chat, 'Bu testni siz topshirmagansiz.', menuKb(u));
  if (isOpen(tt)) return send(env, chat, '⏳ Test hali ochiq. Yopilgach toʻgʻri javoblar va reyting koʻrinadi.', menuKb(u));
  if (tt.reveal === 0 && !isTeacher(u)) return send(env, chat, '🙈 Ustoz bu test javoblarini yashirgan.', menuKb(u));
  const all = (await env.DB.prepare('SELECT user_id, name, correct, total FROM results WHERE code = ? ORDER BY correct DESC, created ASC').bind(tt.code).all()).results || [];
  const n = all.length; const avg = n ? Math.round(all.reduce((s, r) => s + pct(r.correct, r.total), 0) / n) : 0;
  const top = all.slice(0, 5).map((r, i) => `${['🥇', '🥈', '🥉', '4.', '5.'][i]} ${esc(r.name)} — <b>${pct(r.correct, r.total)}%</b>`).join('\n');
  let own = '';
  if (mine) {
    const rank = all.findIndex((r) => r.user_id === u.id) + 1; const p = pct(mine.correct, mine.total);
    const wrong = [];
    for (let i = 0; i < tt.n; i++) if (mine.answers[i] !== tt.answer_key[i]) wrong.push(`${i + 1}-savol: <s>${(mine.answers[i] || '-').toUpperCase()}</s> → <b>${tt.answer_key[i].toUpperCase()}</b>`);
    own = `\n\n🎯 Siz: <b>${rank}-oʻrin</b> (${n} kishidan) · ${mine.correct}/${mine.total} · ${p}%\n${bar(p)}\n` + (wrong.length ? `\n❌ <b>Xatolaringiz</b>\n${wrong.join('\n')}` : '\n✅ Hammasi toʻgʻri!');
  }
  return send(env, chat, `📋 <b>${esc(tt.title)}</b> (<code>${tt.code}</code>)\n👥 ${n} kishi · oʻrtacha <b>${avg}%</b>\n\n🏆 <b>Reyting</b>\n${top}${own}\n\n🔑 <b>Kalit:</b> <code>${tt.answer_key.toUpperCase()}</code>`, menuKb(u));
}
async function myResults(env, chat, u) {
  const rows = (await env.DB.prepare('SELECT r.code, r.correct, r.total, r.created, t.title, t.open, t.deadline, t.reveal FROM results r LEFT JOIN tests t ON t.code = r.code WHERE r.user_id = ? ORDER BY r.created DESC LIMIT 15').bind(u.id).all()).results || [];
  if (!rows.length) return send(env, chat, `Hali test topshirmagansiz.\n«${B.test}» tugmasini bosib, ustoz bergan kodni yozing.`, menuKb(u));
  const avg = Math.round(rows.reduce((s, r) => s + pct(r.correct, r.total), 0) / rows.length);
  const body = `📊 <b>Natijalarim</b> · oʻrtacha <b>${avg}%</b>\n\n` + rows.map((r) => `${bar(pct(r.correct, r.total))} <b>${pct(r.correct, r.total)}%</b>\n${esc(r.title || r.code)} — ${r.correct}/${r.total} · ${fmtDate(r.created)}`).join('\n\n');
  const btns = rows.filter((r) => r.title && !isOpen(r) && r.reveal !== 0).slice(0, 8).map((r) => [{text: `📋 ${r.code} · javoblar va reyting`, callback_data: 'sr:' + r.code}]);
  return send(env, chat, body, btns.length ? inl(btns) : menuKb(u));
}

// ---------- Ustoz: testlar ro'yxati va sozlash ----------
async function testsView(env, u) {
  const rows = (await env.DB.prepare('SELECT t.code, t.title, t.n, t.open, t.deadline, (SELECT COUNT(*) FROM results r WHERE r.code = t.code) AS cnt FROM tests t WHERE t.teacher_id = ? ORDER BY t.created DESC LIMIT 15').bind(u.id).all()).results || [];
  if (!rows.length) return {t: `Hali test yoʻq. «${B.newtest}» tugmasini bosing.`, extra: {}};
  const body = '📚 <b>Testlaringiz</b>\n\n' + rows.map((r) => `${isOpen(r) ? '🟢' : '🔒'} <code>${r.code}</code> — ${esc(r.title)} · ${r.n} savol · <b>${r.cnt}</b> kishi${r.deadline ? ' · ⏰ ' + fmtDate(r.deadline) : ''}`).join('\n') + '\n\n📊 — natijalar · 🔒/🔓 — yopish/ochish · ⚙️ — sozlash';
  return {t: body, extra: inl(rows.map((r) => [{text: `📊 ${r.code} · ${r.title.slice(0, 20)}`, callback_data: 'r:' + r.code}, {text: isOpen(r) ? '🔒' : '🔓', callback_data: 't:' + r.code}, {text: '⚙️', callback_data: 'tm:' + r.code}]))};
}
async function manageTest(env, chat, tt) {
  const c = tt.code;
  const body = `⚙️ <b>${esc(tt.title)}</b> (<code>${c}</code>)\n❓ ${tt.n} savol · ${isOpen(tt) ? '🟢 ochiq' : '🔒 yopiq'}\n⏰ Muddat: <b>${tt.deadline ? fmtDate(tt.deadline) : 'yoʻq'}</b>\n👁 Yopilgach javoblar: <b>${tt.reveal === 0 ? 'yashirin' : 'koʻrsatiladi'}</b>`;
  return send(env, chat, body, inl([[{text: '✏️ Nomi', callback_data: 'tn:' + c}, {text: '🔑 Kalit', callback_data: 'tk:' + c}], [{text: '⏰ Muddat', callback_data: 'td:' + c}, {text: '👁 Javoblar', callback_data: 'tv:' + c}], [{text: '📤 Excel / Sheets', callback_data: 'xp:' + c}], [{text: '🗑 Oʻchirish', callback_data: 'tx:' + c}, {text: '⬅️ Testlar', callback_data: 'tl:0'}]]));
}

// ---------- Natijalarni eksport (CSV + Google Sheets IMPORTDATA) ----------
const csvCell = (v) => { v = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
async function leadsCsv(env) {
  const rows = (await env.DB.prepare('SELECT * FROM leads ORDER BY id').all()).results || [];
  const head = ['№', 'Sana', 'Oʻquvchi', 'Akkaunt', 'Telefon', 'Kurs', 'Fan', 'Smena', 'Sinf', 'Vaucher', 'Bosqich', 'Masʼul', 'Telegram'];
  const lines = [head.map(csvCell).join(',')];
  rows.forEach((r, i) => lines.push([i + 1, fmtDate(r.created), r.student || r.name, r.name, r.phone ? '+998' + r.phone : '', r.ctitle, r.subject, r.shift, r.grade, r.vaucher, STAGES[r.stage] || r.stage, r.aname, r.username ? '@' + r.username : ''].map(csvCell).join(',')));
  return lines.join('\n');
}
async function testCsv(env, code) {
  const tt = await env.DB.prepare('SELECT * FROM tests WHERE code = ?').bind(String(code || '').toUpperCase()).first();
  if (!tt) return null;
  const rows = (await env.DB.prepare('SELECT name, correct, total, created, answers FROM results WHERE code = ? ORDER BY correct DESC, created ASC').bind(tt.code).all()).results || [];
  const head = ['№', 'Ism', 'Toʻgʻri', 'Jami', 'Foiz', 'Vaqt', 'Javoblar'];
  for (let i = 1; i <= tt.n; i++) head.push(String(i));
  const lines = [head.map(csvCell).join(',')];
  rows.forEach((r, i) => {
    const cells = [i + 1, r.name, r.correct, r.total, pct(r.correct, r.total), fmtDate(r.created), String(r.answers).toUpperCase()];
    for (let q = 0; q < tt.n; q++) cells.push(r.answers[q] === tt.answer_key[q] ? 1 : 0);
    lines.push(cells.map(csvCell).join(','));
  });
  return lines.join('\n');
}
async function exportTest(env, chat, tt) {
  const csv = await testCsv(env, tt.code);
  const url = `${WORKER_URL}/export?c=${tt.code}&s=${await xsign(env, tt.code)}`;
  const fd = new FormData();
  fd.append('chat_id', String(chat));
  fd.append('caption', `📤 ${tt.title} (${tt.code}) natijalari`);
  fd.append('document', new Blob(['﻿' + csv], {type: 'text/csv'}), `natijalar-${tt.code}.csv`);
  await fetch(`https://api.telegram.org/bot${cleanToken(env.BOT_TOKEN)}/sendDocument`, {method: 'POST', body: fd});
  return send(env, chat, `📊 <b>Google Sheets uchun</b>\nYangi jadvalning A1 katagiga shuni qoʻying — natijalar avtomatik yangilanib turadi:\n\n<code>=IMPORTDATA("${url}")</code>\n\n📎 Yuqoridagi fayl Excel va Sheets'da ochiladi.`);
}

// ---------- Ustoz uchun shaxsiy kod ----------
async function newInvite(env) {
  for (let k = 0; k < 20; k++) {
    let c = ''; for (const b of crypto.getRandomValues(new Uint8Array(8))) c += ALPH[b % ALPH.length];
    if (!await env.DB.prepare('SELECT code FROM invites WHERE code = ?').bind(c).first()) return c;
  }
  throw new Error('kod topilmadi');
}
async function useInvite(env, code, u) {
  const inv = await env.DB.prepare('SELECT role FROM invites WHERE code = ? AND used_by IS NULL').bind(code).first();
  if (!inv) return null;
  const r = await env.DB.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL').bind(u.id, Date.now(), code).run();
  if (!(r.meta && r.meta.changes)) return null;
  return inv.role === 'admin' ? 'admin' : 'teacher';
}
async function inviteList(env, chat, u) {
  const rows = (await env.DB.prepare('SELECT code, name, used_by, role FROM invites ORDER BY created DESC LIMIT 10').all()).results || [];
  await setState(env, u, 'idle');
  const list = rows.length ? '\n\n' + rows.map((r) => `${r.used_by ? '✅' : '⏳'} ${r.role === 'admin' ? '🛡' : '👨‍🏫'} ${esc(r.name)} — <code>${r.code}</code>`).join('\n') : '';
  return send(env, chat, `🔑 <b>Xodim kodi</b>\nKim uchun kod kerak? Rolni tanlang, keyin ismini yozasiz. Kod bir martalik.${list}`, inl([[{text: '🛡 Admin', callback_data: 'iv:admin'}, {text: '👨‍🏫 Ustoz', callback_data: 'iv:teacher'}]]));
}
// ---------- Xodimlar (faqat CEO) ----------
async function staffList(env, chat, u) {
  const rows = (await env.DB.prepare("SELECT id, name, role FROM users WHERE role != 'student' ORDER BY CASE role WHEN 'ceo' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, name LIMIT 40").all()).results || [];
  const c = {ceo: 0, admin: 0, teacher: 0}; rows.forEach((r) => { c[r.role] = (c[r.role] || 0) + 1; });
  const body = `👥 <b>Xodimlar</b> · jami <b>${rows.length}</b>\n\n👑 CEO: <b>${c.ceo}</b> · 🛡 Admin: <b>${c.admin}</b> · 👨‍🏫 Ustoz: <b>${c.teacher}</b>\n\nRolni oʻzgartirish uchun xodimni bosing 👇`;
  return send(env, chat, body, inl(rows.map((r) => [{text: `${(ROLE_NAME[r.role] || '').split(' ')[0]} ${r.name || r.id}`, callback_data: 'st:' + r.id}])));
}
async function staffCard(env, chat, cq, u, id) {
  const t = await env.DB.prepare('SELECT id, name, role, phone FROM users WHERE id = ?').bind(id).first();
  if (!t) return send(env, chat, 'Foydalanuvchi topilmadi.');
  const btns = t.role === 'ceo' || t.id === u.id ? [] : ['admin', 'teacher', 'student'].filter((r) => r !== t.role).map((r) => ({text: '→ ' + ROLE_NAME[r], callback_data: `sx:${t.id}:${r}`}));
  const body = `👤 <b>${esc(t.name || t.id)}</b>\n${ROLE_NAME[t.role] || t.role}${t.phone ? '\n📱 ' + fullPhone(t.phone) : ''}${t.role === 'ceo' ? '\n\n🔒 CEO rolini bot orqali oʻzgartirib boʻlmaydi.' : ''}`;
  return tg(env, 'editMessageText', {chat_id: chat, message_id: cq.message.message_id, text: body, parse_mode: 'HTML', reply_markup: {inline_keyboard: [...chunks(btns, 2), [{text: '⬅️ Xodimlar', callback_data: 'sl:0'}]]}});
}

// ---------- Kurslar va sotuv varonkasi ----------
const leadCard = (l) => `🎓 <b>Ariza #${l.id}</b>\n📘 ${esc(l.ctitle)}\n👤 <b>${esc(l.student && l.student !== 'Oʻzi' ? l.student : (l.name || '—'))}</b>${l.grade ? ' · ' + esc(l.grade) : ''}${l.student && l.student !== 'Oʻzi' && l.name && l.name !== l.student ? ' (akkaunt: ' + esc(l.name) + ')' : ''}\n${l.subject ? '📚 ' + esc(l.subject) + (l.shift ? ' · 🕒 ' + esc(l.shift) : '') + '\n' : ''}📱 ${fullPhone(l.phone)}\n🔗 <a href="tg://user?id=${l.user_id}">Telegramda yozish</a>${l.username ? ' · @' + esc(l.username) : ''}\n${l.vaucher ? '🎟 <b>' + esc(l.vaucher) + '</b>\n' : ''}📍 <b>${STAGES[l.stage] || l.stage}</b>${l.aname ? '\n🙋 Mas’ul: ' + esc(l.aname) : ''}\n🕒 ${fmtDate(l.created)}`;
function leadKb(l) {
  const rows = [];
  if (!l.assigned) rows.push([{text: '🙋 Men bogʻlanaman', callback_data: 'lc:' + l.id}]);
  const btns = STAGE_KEYS.filter((s) => s !== l.stage && s !== 'new').map((s) => ({text: STAGES[s], callback_data: `ls:${l.id}:${s}`}));
  return rows.concat(chunks(btns, 2));
}
const editLead = (env, chat, cq, l) => tg(env, 'editMessageText', {chat_id: chat, message_id: cq.message.message_id, text: leadCard(l), parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: {inline_keyboard: leadKb(l)}});
async function notifyAdmins(env, text, extra) {
  const ids = ((await env.DB.prepare("SELECT id FROM users WHERE role IN ('admin', 'ceo')").all()).results || []).map((x) => x.id);
  for (const id of ids) await send(env, id, text, extra).catch(() => {});
  return ids.length;
}

async function courseList(env, chat, u) {
  const cs = (await env.DB.prepare('SELECT id, title, price FROM courses WHERE active = 1 ORDER BY id').all()).results || [];
  if (!cs.length) return send(env, chat, '🎓 Hozircha ochiq kurslar yoʻq. Tez orada eʼlon qilamiz.', menuKb(u));
  return send(env, chat, '🎓 <b>Ilmzor kurslariga yozilish</b>\n\nKursni tanlang 👇', inl([...cs.map((c) => [{text: '📘 ' + c.title + (c.price ? ' · ' + c.price : ''), callback_data: 'cv:' + c.id}]), [{text: '📝 Arizalarim', callback_data: 'cm:0'}]]));
}
async function courseView(env, chat, u, id) {
  const c = await env.DB.prepare('SELECT * FROM courses WHERE id = ? AND active = 1').bind(id).first();
  if (!c) return send(env, chat, 'Kurs topilmadi yoki yopilgan.', menuKb(u));
  return send(env, chat, `📘 <b>${esc(c.title)}</b>${c.price ? '\n💵 ' + esc(c.price) : ''}${c.info ? '\n\n' + esc(c.info) : ''}`, inl([[{text: '✅ Yozilish', callback_data: 'cj:' + c.id}], [{text: '⬅️ Kurslar', callback_data: 'cl:0'}]]));
}
async function myLeads(env, chat, u) {
  const rows = (await env.DB.prepare('SELECT ctitle, student, stage, created FROM leads WHERE user_id = ? ORDER BY created DESC LIMIT 10').bind(u.id).all()).results || [];
  if (!rows.length) return send(env, chat, '📝 Hali kursga yozilmagansiz.', menuKb(u));
  return send(env, chat, '📝 <b>Arizalarim</b>\n\n' + rows.map((r) => `📘 ${esc(r.ctitle)}${r.student && r.student !== 'Oʻzi' ? ' · ' + esc(r.student) : ''}\n${STAGES[r.stage] || r.stage} · ${fmtDate(r.created)}`).join('\n\n'), menuKb(u));
}
async function leadStart(env, chat, u, courseId) {
  const vau = (u.d && u.d.vinfo) || '';
  if (!u.phone) { await setState(env, u, 'lead_phone', {course: courseId, vaucher: vau}); return send(env, chat, '📱 Admin siz bilan bogʻlanishi uchun <b>telefon raqamingizni</b> yuboring (majburiy) 👇', leadPhoneKb); }
  return leadAskStudent(env, chat, u, courseId, vau);
}
const leadNameKb = (u) => kb([...(NAME_RE.test(String(u.name || '').trim()) ? [[B.self]] : []), [B.cancel]]);
async function leadAskStudent(env, chat, u, courseId, vau) {
  await setState(env, u, 'lead_student', {course: courseId, vaucher: vau || ''});
  return send(env, chat, '👤 <b>Oʻquvchining ismi va familiyasi</b> (majburiy)\nMasalan: <i>Ali Valiyev</i>', leadNameKb(u));
}
async function leadAskSubject(env, chat, u, courseId, name, vau) {
  await setState(env, u, 'lead_subject', {course: courseId, student: name, vaucher: vau || ''});
  return send(env, chat, '📚 <b>Qaysi fan?</b> (majburiy)\nTugmadan tanlang yoki fan nomini yozing.', subjectKb);
}
async function leadAskShift(env, chat, u, d) {
  await setState(env, u, 'lead_shift', d);
  return send(env, chat, '🕒 <b>Kurs qaysi paytga kerak?</b> (majburiy)', shiftKb);
}
async function leadAskGrade(env, chat, u, d) {
  await setState(env, u, 'lead_grade', d);
  return send(env, chat, '🎒 <b>Sinfi?</b> (majburiy)\n2-sinfdan 11-sinfgacha, undan kattalar uchun «Katta».', gradeKb);
}
async function leadCreate(env, chat, u, d, username) {
  const c = await env.DB.prepare('SELECT * FROM courses WHERE id = ? AND active = 1').bind(d.course).first();
  await setState(env, u, 'idle');
  if (!c) return send(env, chat, 'Kurs topilmadi yoki yopilgan.', menuKb(u));
  const dup = await env.DB.prepare("SELECT id FROM leads WHERE user_id = ? AND course_id = ? AND stage != 'lost' AND student = ?").bind(u.id, c.id, d.student).first();
  if (dup) return send(env, chat, 'Bu oʻquvchi bu kursga allaqachon yozilgan. Holatni «📝 Arizalarim» da koʻrasiz.', menuKb(u));
  const now = Date.now();
  const ins = await env.DB.prepare("INSERT INTO leads (user_id, course_id, ctitle, name, phone, student, subject, shift, grade, username, vaucher, stage, reminded, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 0, ?, ?)").bind(u.id, c.id, c.title, u.name, u.phone || null, d.student, d.subject, d.shift, d.grade, username || '', d.vaucher || '', now, now).run();
  const l = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(ins.meta.last_row_id).first();
  await send(env, chat, `✅ <b>Arizangiz qabul qilindi!</b>\n📘 ${esc(c.title)}\n👤 ${esc(d.student)} · ${esc(d.grade)}\n📚 ${esc(d.subject)} · 🕒 ${d.shift}\n\nAdmin tez orada siz bilan bogʻlanadi.`, menuKb(u));
  await notifyAdmins(env, '🔔 <b>Yangi ariza!</b>\n\n' + leadCard(l), inl(leadKb(l)));
}
async function remindLeads(env) {
  const rows = (await env.DB.prepare("SELECT * FROM leads WHERE stage = 'new' AND assigned IS NULL AND COALESCE(reminded, 0) = 0 AND created < ? LIMIT 5").bind(Date.now() - 30 * 60e3).all()).results || [];
  for (const l of rows) {
    await env.DB.prepare('UPDATE leads SET reminded = 1 WHERE id = ?').bind(l.id).run();
    await notifyAdmins(env, '⏰ <b>30 daqiqadan beri javobsiz ariza!</b>\n\n' + leadCard(l), inl(leadKb(l)));
  }
}
async function funnel(env, chat, u) {
  const rows = (await env.DB.prepare('SELECT stage, COUNT(*) AS c FROM leads GROUP BY stage').all()).results || [];
  const cnt = {}; rows.forEach((r) => { cnt[r.stage] = r.c; });
  const total = rows.reduce((s, r) => s + r.c, 0);
  if (!total) return send(env, chat, '📊 <b>Sotuv varonkasi</b>\n\nHali ariza yoʻq. Kurs qoʻshing — arizalar «🎓 Kurslarga yozilish» orqali keladi.', menuKb(u));
  const week = (await env.DB.prepare('SELECT COUNT(*) AS c FROM leads WHERE created > ?').bind(Date.now() - 7 * 864e5).first()).c;
  const stale = (await env.DB.prepare("SELECT COUNT(*) AS c FROM leads WHERE stage = 'new' AND assigned IS NULL AND created < ?").bind(Date.now() - 30 * 60e3).first()).c;
  const byCourse = (await env.DB.prepare("SELECT ctitle, COUNT(*) AS c, SUM(stage = 'paid') AS paid FROM leads GROUP BY ctitle ORDER BY c DESC LIMIT 5").all()).results || [];
  const lines = STAGE_KEYS.map((s) => { const c = cnt[s] || 0; const p = pct(c, total); return `${STAGES[s]}\n${bar(p)} <b>${c}</b> · ${p}%`; }).join('\n\n');
  const body = `📊 <b>Sotuv varonkasi</b> · jami <b>${total}</b> ariza\n\n${lines}\n\n✅ Konversiya (toʻladi): <b>${pct(cnt.paid || 0, total)}%</b>\n📅 Soʻnggi 7 kun: <b>+${week}</b>` + (stale ? `\n🚨 Javobsiz (30 daqiqadan oshgan): <b>${stale}</b>` : '') + (byCourse.length ? '\n\n📘 <b>Kurslar</b>\n' + byCourse.map((c) => `${esc(c.ctitle)} — ${c.c} ariza, ${c.paid || 0} toʻlagan`).join('\n') : '');
  const kbs = chunks(STAGE_KEYS.map((s) => ({text: `${STAGES[s]} (${cnt[s] || 0})`, callback_data: 'lf:' + s})), 2);
  kbs.push([{text: '📤 Google Sheets uchun havola', callback_data: 'lx:0'}]);
  return send(env, chat, body, inl(kbs));
}
async function leadList(env, chat, stage) {
  const rows = (await env.DB.prepare('SELECT id, name, student, ctitle FROM leads WHERE stage = ? ORDER BY created DESC LIMIT 15').bind(stage).all()).results || [];
  if (!rows.length) return send(env, chat, `${STAGES[stage]} bosqichida ariza yoʻq.`);
  return send(env, chat, `${STAGES[stage]} · soʻnggi ${rows.length} ta 👇`, inl(rows.map((r) => [{text: `${r.name || '—'}${r.student && r.student !== 'Oʻzi' ? ' (' + r.student + ')' : ''} · ${r.ctitle}`.slice(0, 60), callback_data: 'lo:' + r.id}])));
}
async function courseAdmin(env, chat, u, note) {
  const cs = (await env.DB.prepare('SELECT c.id, c.title, c.price, c.active, (SELECT COUNT(*) FROM leads l WHERE l.course_id = c.id) AS n FROM courses c ORDER BY c.id').all()).results || [];
  const rows = [];
  for (const c of cs) { rows.push([{text: (c.active ? '👁 ' : '🙈 ') + c.title.slice(0, 40) + ` (${c.n})`, callback_data: 'cH:' + c.id}]); rows.push([{text: c.active ? '🙈 Yashirish' : '👁 Koʻrsatish', callback_data: 'cH:' + c.id}, {text: '🗑 Oʻchirish', callback_data: 'cX:' + c.id}]); }
  rows.push([{text: '➕ Yangi kurs', callback_data: 'cA:0'}]);
  return send(env, chat, (note ? note + '\n\n' : '') + '🎓 <b>Kurslar — admin</b>\n\n👁 faol kurslar oʻquvchilarga «' + B.courses + '» boʻlimida koʻrinadi. Qavs ichida — arizalar soni.', inl(rows));
}

// ---------- Qoʻshimcha inline tugmalar (yangi funksiyalar) ----------
async function onMore(cq, env, u, chat, data, answer) {
  const P = data.split(':'); const k = P[0], v = P[1], w = P[2]; const bc = can(u, 'bcast'), co = can(u, 'courses'), fu = can(u, 'funnel');

  // kod berish va xodimlar (faqat CEO)
  if (k === 'iv') {
    if (!can(u, 'invite') || !['admin', 'teacher'].includes(v)) { await answer('Ruxsat yoʻq'); return true; }
    await answer(); await setState(env, u, 'iv_name', {role: v});
    await send(env, chat, `✏️ ${ROLE_NAME[v]} ismini yozing:`, cancelKb); return true;
  }
  if (k === 'sl' || k === 'st' || k === 'sx') {
    if (!can(u, 'staff')) { await answer('Ruxsat yoʻq'); return true; }
    if (k === 'sl') { await answer(); await staffList(env, chat, u); return true; }
    if (k === 'st') { await answer(); await staffCard(env, chat, cq, u, +v); return true; }
    const t = await env.DB.prepare('SELECT id, name, role FROM users WHERE id = ?').bind(+v).first();
    if (!t || t.role === 'ceo' || t.id === u.id || !['admin', 'teacher', 'student'].includes(w)) { await answer('Mumkin emas'); return true; }
    await env.DB.prepare("UPDATE users SET role = ?, state = 'idle', data = NULL WHERE id = ?").bind(w, t.id).run();
    await answer('Oʻzgartirildi');
    await send(env, t.id, `ℹ️ Sizning rolingiz oʻzgardi: ${ROLE_NAME[w]}. Menyu yangilandi 👇`, menuKb({role: w})).catch(() => {});
    await staffCard(env, chat, cq, u, t.id); return true;
  }

  // testni boshqarish
  if (['tm', 'tn', 'tk', 'td', 'th', 'tv', 'tx', 'tX', 'tl', 'xp'].includes(k)) {
    if (!isTeacher(u)) { await answer('Faqat ustozlar uchun'); return true; }
    if (k === 'tl') { await answer(); await listTests(env, chat, u); return true; }
    const tt = await ownTest(env, u, v);
    if (!tt) { await answer('Test topilmadi'); return true; }
    if (k === 'tm') { await answer(); await manageTest(env, chat, tt); return true; }
    if (k === 'xp') { await answer('Tayyorlanmoqda…'); await exportTest(env, chat, tt); return true; }
    if (k === 'tn') { await answer(); await setState(env, u, 'e_name', {code: tt.code}); await send(env, chat, '✏️ Yangi test nomini yozing:', cancelKb); return true; }
    if (k === 'tk') { await answer(); await setState(env, u, 'e_key', {code: tt.code}); await send(env, chat, `🔑 Yangi javoblar kalitini yozing — aynan <b>${tt.n}</b> ta savol (masalan: <code>${codeExample(tt.n)}</code>).\nNatijalar qayta hisoblanadi.`, cancelKb); return true; }
    if (k === 'td') { await answer(); await send(env, chat, '⏰ Test muddati hozirdan boshlab qancha boʻlsin?', inl([[{text: '1 soat', callback_data: `th:${tt.code}:1`}, {text: '3 soat', callback_data: `th:${tt.code}:3`}, {text: '24 soat', callback_data: `th:${tt.code}:24`}], [{text: '1 hafta', callback_data: `th:${tt.code}:168`}, {text: '♾ Muddatsiz', callback_data: `th:${tt.code}:0`}]])); return true; }
    if (k === 'th') {
      const hours = +w; if (!(hours >= 0 && hours <= 24 * 90)) { await answer('Xato'); return true; }
      const dl = hours ? Date.now() + hours * 3600e3 : null;
      await env.DB.prepare('UPDATE tests SET deadline = ?, open = CASE WHEN ? IS NOT NULL THEN 1 ELSE open END WHERE code = ?').bind(dl, dl, tt.code).run();
      await answer(hours ? '⏰ Muddat belgilandi' : 'Muddat olib tashlandi');
      await manageTest(env, chat, await ownTest(env, u, tt.code)); return true;
    }
    if (k === 'tv') {
      await env.DB.prepare('UPDATE tests SET reveal = CASE WHEN COALESCE(reveal, 1) = 0 THEN 1 ELSE 0 END WHERE code = ?').bind(tt.code).run();
      await answer('Saqlandi'); await manageTest(env, chat, await ownTest(env, u, tt.code)); return true;
    }
    if (k === 'tx') { await answer(); await send(env, chat, `🗑 <b>${esc(tt.title)}</b> (${tt.code}) va uning <b>barcha natijalari</b> oʻchirilsinmi? Bu qaytarilmaydi.`, inl([[{text: '✅ Ha, oʻchir', callback_data: 'tX:' + tt.code}, {text: '❌ Yoʻq', callback_data: 'tm:' + tt.code}]])); return true; }
    if (k === 'tX') {
      await env.DB.batch([env.DB.prepare('DELETE FROM results WHERE code = ?').bind(tt.code), env.DB.prepare('DELETE FROM tests WHERE code = ?').bind(tt.code)]);
      await answer('Oʻchirildi'); await listTests(env, chat, u); return true;
    }
  }
  if (k === 'sr') { await answer(); await showReveal(env, chat, u, v); return true; }

  // guruh boʻyicha xabar
  if (bc && k === 'b' && v === 'grp') {
    if (u.state !== 'b_target' || !u.d.mid) { await answer('Xabar topilmadi, qaytadan boshlang'); return true; }
    const gs = (await env.DB.prepare('SELECT grp, COUNT(DISTINCT student) AS n FROM monthly GROUP BY grp ORDER BY grp LIMIT 40').all()).results || [];
    if (!gs.length) { await answer('Guruhlar yoʻq'); await send(env, chat, 'Hali oylik natijalar kiritilmagan, guruhlar yoʻq.'); return true; }
    await setState(env, u, 'b_target', {mid: u.d.mid, groups: gs.map((g) => g.grp)});
    await answer();
    await send(env, chat, '🗓 Qaysi guruhga yuboramiz?\n<i>Faqat botda raqamini ulagan oʻquvchi/ota-onalarga boradi.</i>', inl(gs.map((g, i) => [{text: `${g.grp} (${g.n})`, callback_data: 'bg:' + i}])));
    return true;
  }
  if (bc && k === 'bg') {
    const gname = u.d.groups && u.d.groups[+v];
    if (u.state !== 'b_target' || !gname || !u.d.mid) { await answer('Qaytadan boshlang'); return true; }
    const ins = await env.DB.prepare('INSERT INTO broadcasts (admin, target, total, created) VALUES (?, ?, 0, ?)').bind(u.id, 'grp', Date.now()).run();
    const bid = ins.meta && ins.meta.last_row_id;
    const r = await env.DB.prepare("INSERT INTO outbox (chat, kind, payload, bid) SELECT DISTINCT u.id, 'copy', ?, ? FROM users u JOIN monthly m ON (u.phone = m.phone1 OR u.phone = m.phone2) WHERE m.grp = ? AND u.phone IS NOT NULL AND u.phone != '' AND COALESCE(u.blocked, 0) = 0").bind(JSON.stringify({from: chat, mid: u.d.mid}), bid, gname).run();
    const total = (r.meta && r.meta.changes) || 0;
    await env.DB.prepare('UPDATE broadcasts SET total = ?, done = ? WHERE id = ?').bind(total, total ? 0 : 1, bid).run();
    await setState(env, u, 'idle'); await answer('Navbatga qoʻyildi');
    await send(env, chat, total ? `⏳ «${esc(gname)}» guruhiga <b>${total}</b> kishiga yuborish navbatiga qoʻyildi. Oxirida hisobot keladi.` : `«${esc(gname)}» guruhida raqamini ulagan hech kim topilmadi.`, menuKb(u));
    return true;
  }

  // kurslar (hamma)
  if (k === 'vj') { await answer(); const vi = (u.d && u.d.vinfo) || 'Olimpiada vaucheri'; await setState(env, u, 'idle', {vinfo: vi}); await courseList(env, chat, u); return true; }
  if (k === 'cl') { await answer(); await courseList(env, chat, u); return true; }
  if (k === 'cv') { await answer(); await courseView(env, chat, u, +v); return true; }
  if (k === 'cm') { await answer(); await myLeads(env, chat, u); return true; }
  if (k === 'cj') {
    const c = await env.DB.prepare('SELECT id, title FROM courses WHERE id = ? AND active = 1').bind(+v).first();
    if (!c) { await answer('Kurs yopilgan'); return true; }
    const dup = await env.DB.prepare("SELECT stage FROM leads WHERE user_id = ? AND course_id = ? AND stage != 'lost'").bind(u.id, c.id).first();
    if (dup) { await answer('Siz allaqachon yozilgansiz'); await send(env, chat, `Siz «${esc(c.title)}» kursiga yozilgansiz.\nHolati: <b>${STAGES[dup.stage]}</b>`); return true; }
    await answer(); await leadStart(env, chat, u, c.id); return true;
  }

  // kurslar va varonka (admin)
  if (co && k === 'cA') { await answer(); await setState(env, u, 'c_title'); await send(env, chat, '➕ Kurs nomini yozing (masalan: <i>Tezkor matematika, 2-3-sinf</i>):', cancelKb); return true; }
  if (co && k === 'cH') {
    const c = await env.DB.prepare('SELECT active FROM courses WHERE id = ?').bind(+v).first();
    if (c) await env.DB.prepare('UPDATE courses SET active = ? WHERE id = ?').bind(c.active ? 0 : 1, +v).run();
    await answer(c && c.active ? 'Yashirildi' : 'Koʻrsatildi'); await courseAdmin(env, chat, u); return true;
  }
  if (co && k === 'cX') { await answer(); await send(env, chat, '🗑 Kurs oʻchirilsinmi? Avvalgi arizalar saqlanib qoladi.', inl([[{text: '✅ Ha, oʻchir', callback_data: 'cY:' + v}, {text: '❌ Yoʻq', callback_data: 'cH:' + v}]])); return true; }
  if (co && k === 'cY') { await env.DB.prepare('DELETE FROM courses WHERE id = ?').bind(+v).run(); await answer('Oʻchirildi'); await courseAdmin(env, chat, u); return true; }
  if (fu && k === 'lx') {
    await answer();
    const lurl = `${WORKER_URL}/leads.csv?s=${await xsign(env, 'LEADS')}`;
    await send(env, chat, `📊 <b>Arizalar — Google Sheets uchun</b>\n\nYangi jadvalning A1 katagiga shuni qoʻying, arizalar avtomatik yangilanib turadi:\n\n<code>=IMPORTDATA("${lurl}")</code>\n\n⚠️ Havolada telefon raqamlar bor — begonaga bermang.`);
    return true;
  }
  if (fu && k === 'lf') { await answer(); await leadList(env, chat, v); return true; }
  if (fu && (k === 'lo' || k === 'lc' || k === 'ls')) {
    let l = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(+v).first();
    if (!l) { await answer('Ariza topilmadi'); return true; }
    if (k === 'lo') { await answer(); await send(env, chat, leadCard(l), inl(leadKb(l))); return true; }
    if (k === 'lc') {
      const r = await env.DB.prepare('UPDATE leads SET assigned = ?, aname = ?, updated = ? WHERE id = ? AND assigned IS NULL').bind(u.id, u.name || 'Admin', Date.now(), l.id).run();
      await answer(r.meta && r.meta.changes ? '🙋 Siz mas’ulsiz' : 'Boshqa admin allaqachon oldi');
      l = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(l.id).first();
      await editLead(env, chat, cq, l).catch(() => {}); return true;
    }
    if (!STAGE_KEYS.includes(w)) { await answer('Xato'); return true; }
    await env.DB.prepare('UPDATE leads SET stage = ?, updated = ?, assigned = COALESCE(assigned, ?), aname = COALESCE(aname, ?) WHERE id = ?').bind(w, Date.now(), u.id, u.name || 'Admin', l.id).run();
    l = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(l.id).first();
    await answer(STAGES[w]);
    await editLead(env, chat, cq, l).catch(() => {});
    if (STAGE_NOTE[w]) await send(env, l.user_id, STAGE_NOTE[w]).catch(() => {});
    return true;
  }
  return false;
}

export {parseAnswers, check, handle, flushOutbox, importMonthly, SCHEMA, phone9};

// ---- 🏅 Reytingim: Ilmzor vazifalar va ballar tizimidan (ilmzor-baho) ----
const BAHO_URL = 'https://ilmzor-baho.nomonovnosirbek15.workers.dev';
async function bahoFind(env, q, p) {
  const path = '/api/public/find?q=' + encodeURIComponent(q) + '&p=' + p;
  const r = env.BAHO ? await env.BAHO.fetch('https://baho' + path) : await fetch(BAHO_URL + path);
  return r.json();
}
function rankBar(p) { const k = Math.max(0, Math.min(10, Math.round(p / 10))); return '🟩'.repeat(k) + '⬜'.repeat(10 - k); }
function rankDate(d) { const x = String(d || '').split('-'); return x.length === 3 ? x[2] + '.' + x[1] : ''; }
async function rankShow(env, chat, u, q, auto) {
  let m, w;
  try { [m, w] = await Promise.all([bahoFind(env, q, 'month'), bahoFind(env, q, 'week')]); }
  catch (e) { return send(env, chat, '⚠️ Reyting hozir ochilmadi, birozdan keyin qayta urinib koʻring.', menuKb(u)); }
  if (!m.matches || !m.matches.length) {
    if (auto) { await setState(env, u, 'rk_name'); return send(env, chat, '🔎 «' + esc(q) + '» nomi bilan bu oy natija topilmadi.\n\nMarkazdagi roʻyxatdagidek ism va familiyangizni yozing (masalan: <i>Qosimov Temurbek</i>):', cancelKb); }
    return send(env, chat, '🔎 «' + esc(q) + '» boʻyicha bu oy natija topilmadi.\nIsm-familiyani roʻyxatdagidek yozing yoki ustozingizdan soʻrang.', menuKb(u));
  }
  const blocks = m.matches.map((x) => {
    const wk = (w.matches || []).find((y) => y.name === x.name && y.gkey === x.gkey);
    const medal = x.rankGroup === 1 ? '🥇 ' : x.rankGroup === 2 ? '🥈 ' : x.rankGroup === 3 ? '🥉 ' : '';
    return '👤 <b>' + esc(x.name) + '</b> · ' + esc(x.group || '') + (x.teacher ? ' (' + esc(x.teacher) + ')' : '') +
      '\n' + rankBar(x.pct) + ' <b>' + x.pct + '%</b>' +
      '\n' + medal + '🏫 Guruhda: <b>' + x.rankGroup + '</b>-oʻrin / ' + x.groupSize +
      '\n🏢 Markazda: <b>' + x.rankCenter + '</b>-oʻrin / ' + m.total +
      '\n⭐ Ball: ' + x.ball + ' / ' + x.max +
      (wk ? '\n📅 Bu hafta: ' + wk.pct + '% · guruhda ' + wk.rankGroup + '-oʻrin' : '');
  });
  return send(env, chat, '🏅 <b>Reyting — bu oy</b> (' + rankDate(m.from) + '–' + rankDate(m.to) + ')\n\n' + blocks.join('\n\n') +
    '\n\n<i>Foiz — berilgan vazifalardan olingan ball ulushi.</i>\nToʻliq reyting: ' + BAHO_URL + '/reyting', menuKb(u));
}


// ---- 📝 Vazifalarim: o'quvchi shaxsiy kodi bilan (ilmzor-baho tizimi) ----
const VZ_MON = ['yan', 'fev', 'mar', 'apr', 'may', 'iyun', 'iyul', 'avg', 'sen', 'okt', 'noy', 'dek'];
const vzDate = (s) => { const x = String(s || '').split('-'); return x.length === 3 ? (+x[2]) + '-' + VZ_MON[+x[1] - 1] : s; };
async function vzDb(env) { await env.DB.prepare('CREATE TABLE IF NOT EXISTS baho_link(uid TEXT PRIMARY KEY, code TEXT, created INTEGER)').run(); }
async function vzLink(env, u) { await vzDb(env); const r = await env.DB.prepare('SELECT code FROM baho_link WHERE uid = ?').bind(String(u.id)).first(); return r ? r.code : null; }
async function bahoReq(env, method, path, code, body) {
  const init = {method, headers: {'x-code': code, 'content-type': 'application/json'}, body: body ? JSON.stringify(body) : undefined};
  const r = env.BAHO ? await env.BAHO.fetch('https://baho' + path, init) : await fetch(BAHO_URL + path, init);
  const j = await r.json().catch(() => ({})); return {ok: r.ok, status: r.status, j};
}
async function bahoMe(env, code) { const r = await bahoReq(env, 'GET', '/api/s/me', code); return r.ok ? r.j : null; }
async function vzAskCode(env, chat, u, note) {
  await setState(env, u, 'vz_code');
  return send(env, chat, (note ? note + '\n\n' : '') + '✍️ <b>Ism va familiyangizni</b> markazdagi roʻyxatdagidek yozing (masalan: <i>Qosimov Temurbek</i>).\n\nBot sizni topib, shaxsiy kodingizni beradi. Bir marta yetarli — keyin bot sizni taniydi.\n<i>Kodingiz boʻlsa, uni ham yozishingiz mumkin.</i>', cancelKb);
}
async function vzLinkCode(env, chat, u, t) {
  const raw = String(t).trim();
  if (/\s/.test(raw.replace(/\s+$/, '')) || !/^[A-Za-z0-9]{6}$/.test(raw)) return vzClaim(env, chat, u, {name: raw});
  const code = raw.toUpperCase();
  if (code.length !== 6) return send(env, chat, 'Kod 6 ta harf va raqamdan iborat. Qaytadan yozing:', cancelKb);
  const me = await bahoMe(env, code);
  if (!me) return send(env, chat, '❌ Bunday kod topilmadi. Ustozingizdan tekshirib oling va qaytadan yozing:', cancelKb);
  await vzDb(env); await env.DB.prepare('INSERT OR REPLACE INTO baho_link(uid, code, created) VALUES(?, ?, ?)').bind(String(u.id), code, Date.now()).run();
  await setState(env, u, 'idle');
  await send(env, chat, '✅ Ulandi: <b>' + esc(me.student.name) + '</b>', menuKb(u));
  return vzSend(env, chat, me, code);
}
function vzView(me, code) {
  const s = me.student, m = me.month, T = (me.tasks || []).filter((x) => x.type !== 'Oylik test'), O = me.oylik || [];
  const by = (k) => T.filter((x) => x.status === k);
  const back = [...by('overdue'), ...by('owed')], pend = by('pending'), subm = by('submitted'), done = by('done');
  let t = '📝 <b>' + esc(s.name) + '</b> · ' + esc(s.group) + (s.teacher ? ' (' + esc(s.teacher) + ')' : '') + '\n';
  t += m ? '📊 Bu oy: <b>' + m.pct + '%</b> · guruhda <b>' + m.rankGroup + '</b>/' + m.groupSize + ' · markazda <b>' + m.rankCenter + '</b>/' + m.total + '\n' : '📊 Bu oy hali baho yoʻq\n';
  if (me.coins) t += '💰 Ilmzor puli: <b>' + me.coins.balance + '</b>' + (me.coins.balance > 0 ? ' · guruhda ' + me.coins.rank + '/' + me.coins.groupSize : '') + '\n';
  if (O.length) { const o = O[O.length - 1]; t += '🗓 Oylik test (' + esc(o.label) + '): <b>' + o.pct + '%</b>' + (o.n > 1 ? ' · guruhda ' + o.rank + '/' + o.n : '') + '\n'; }
  if (back.length) t += '\n❗ <b>Orqada qolgan (' + back.length + ')</b> — 0 hisoblanmoqda:\n' + back.map((x) => '• ' + esc(x.title) + ' — ' + vzDate(x.date)).join('\n') + '\n';
  if (pend.length) t += '\n⏳ <b>Bajarilishi kerak (' + pend.length + ')</b>:\n' + pend.map((x) => '• ' + esc(x.title) + ' — ' + vzDate(x.deadline) + ' gacha').join('\n') + '\n';
  if (subm.length) t += '\n🙋 <b>Ustozga topshirishga tayyor (' + subm.length + ')</b>:\n' + subm.map((x) => '• ' + esc(x.title)).join('\n') + '\n';
  if (done.length) t += '\n✅ <b>Oxirgi baholar</b>:\n' + done.slice(0, 5).map((x) => '• ' + esc(x.title) + ' — <b>' + x.pct + '%</b>').join('\n') + '\n';
  if (!T.length) t += '\nHozircha vazifa berilmagan.\n';
  if (back.length || pend.length) t += '\nVazifani bajargach, pastdan «🙋 Bajardim» ni bosing va ishni ustozga olib boring — ball qoʻyilgach foizingiz oshadi.';
  const rows = [];
  for (const x of [...back, ...pend].slice(0, 8)) rows.push([{text: '🙋 Bajardim: ' + String(x.title).slice(0, 40), callback_data: 'vzS:' + x.id}]);
  for (const x of subm.slice(0, 4)) rows.push([{text: '↩ Bekor qilish: ' + String(x.title).slice(0, 36), callback_data: 'vzU:' + x.id}]);
  rows.push([{text: '🖼 Haftalik karta', callback_data: 'vzK:week'}, {text: '🖼 Oylik karta', callback_data: 'vzK:month'}]);
  if (O.length) rows.push([{text: '🖼 Oylik test kartasi', callback_data: 'vzK:oylik'}]);
  rows.push([{text: '📱 Ilovada ochish', web_app: {url: APP_URL + '/app'}}]);
  rows.push([{text: '🔄 Yangilash', callback_data: 'vzR:0'}, {text: '🌐 Saytda', url: BAHO_URL + '/men?kod=' + code}]);
  rows.push([{text: '🔑 Boshqa kod kiritish', callback_data: 'vzX:0'}]);
  return {text: t, markup: {inline_keyboard: rows}};
}
async function vzSend(env, chat, me, code) { const v = vzView(me, code); return tg(env, 'sendMessage', {chat_id: chat, text: v.text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: v.markup}); }
async function vzShow(env, chat, u) {
  const code = await vzLink(env, u);
  if (!code) { if (u.role === 'student' && u.name && String(u.name).trim().split(/\s+/).length >= 2) { const r = await bahoReq(env, 'POST', '/api/bot/claim', '', {name: u.name, tg: String(u.id), probe: true}).catch(() => null); if (r && r.ok && r.j.status === 'ok') return vzClaim(env, chat, u, {name: u.name}); } return vzAskCode(env, chat, u); }
  let me; try { me = await bahoMe(env, code); } catch (e) { return send(env, chat, '⚠️ Hozir ochilmadi, birozdan keyin qayta urinib koʻring.', menuKb(u)); }
  if (!me) { await env.DB.prepare('DELETE FROM baho_link WHERE uid = ?').bind(String(u.id)).run(); return vzAskCode(env, chat, u, '⚠️ Saqlangan kodingiz endi ishlamayapti (ustoz yangilagan boʻlishi mumkin).'); }
  return vzSend(env, chat, me, code);
}
async function vzCallback(env, cq, u, chat, k, v, answer) {
  if (k === 'vzK') { const c = await vzLink(env, u); if (!c) { await answer(); return vzAskCode(env, chat, u); } await answer('🖼 Karta tayyorlanmoqda…'); return vzCard(env, chat, c, v === 'week' ? 'week' : v === 'oylik' ? 'oylik' : 'month'); }
  if (k === 'vzC') { await answer(); return vzClaim(env, chat, u, {sid: v, name: (u.d && u.d.vzName) || ''}); }
  if (k === 'vzX') { await answer(); await vzDb(env); await env.DB.prepare('DELETE FROM baho_link WHERE uid = ?').bind(String(u.id)).run(); return vzAskCode(env, chat, u); }
  const code = await vzLink(env, u); if (!code) { await answer(); return vzAskCode(env, chat, u); }
  let note = '';
  if (k === 'vzS' || k === 'vzU') {
    const r = await bahoReq(env, 'POST', k === 'vzS' ? '/api/s/submit' : '/api/s/unsubmit', code, {taskId: v});
    if (!r.ok) return answer('⚠️ ' + (r.j.error || 'Xatolik'));
    note = k === 'vzS' ? '✅ Belgilandi! Ishingizni ustozga olib boring' : 'Bekor qilindi';
  }
  await answer(note);
  const me = await bahoMe(env, code); if (!me) return vzShow(env, chat, u);
  const view = vzView(me, code);
  const e = await tg(env, 'editMessageText', {chat_id: chat, message_id: cq.message.message_id, text: view.text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: view.markup});
  if (!e.ok && !String(e.description || '').includes('not modified')) return vzSend(env, chat, me, code);
}

async function vzClaim(env, chat, u, q) {
  const name = String(q.name || '').replace(/\s+/g, ' ').trim();
  if (name.split(' ').length < 2) return send(env, chat, 'Iltimos, <b>ism va familiyangizni</b> birga yozing (masalan: <i>Qosimov Temurbek</i>):', cancelKb);
  const r = await bahoReq(env, 'POST', '/api/bot/claim', '', {name, sid: q.sid || undefined, tg: String(u.id), nobind: u.role !== 'student'});
  const j = r.j || {};
  if (!r.ok) return send(env, chat, '⚠️ Hozir ulanib boʻlmadi, birozdan keyin qayta urinib koʻring.', cancelKb);
  if (j.status === 'notfound') return send(env, chat, '🔎 «' + esc(name) + '» roʻyxatda topilmadi.\n\nIsm-familiyani ustozingiz yozgandek yozing (harflari bir xil boʻlsin) yoki ustozingizdan soʻrang:', cancelKb);
  if (j.status === 'many') { await setState(env, u, 'vz_code', {vzName: name}); return tg(env, 'sendMessage', {chat_id: chat, text: '👥 Bu ismdagi bir nechta oʻquvchi bor. Oʻzingizni tanlang:', reply_markup: {inline_keyboard: j.options.map((o) => [{text: o.group + (o.teacher ? ' · ' + o.teacher : ''), callback_data: 'vzC:' + o.sid}])}}); }
  if (j.status === 'taken') return send(env, chat, '🔒 <b>' + esc(j.name) + '</b> (' + esc(j.group) + ') boshqa Telegram akkauntga ulangan.\n\nAgar bu siz boʻlsangiz, ustozingizga ayting — u «🔄» tugmasi bilan ulanishni yangilaydi, keyin qayta yozasiz.', menuKb(u));
  if (j.status !== 'ok') return send(env, chat, '⚠️ Xatolik. Qayta urinib koʻring.', cancelKb);
  await vzDb(env); await env.DB.prepare('INSERT OR REPLACE INTO baho_link(uid, code, created) VALUES(?, ?, ?)').bind(String(u.id), j.code, Date.now()).run();
  await setState(env, u, 'idle');
  await send(env, chat, '✅ Topildingiz: <b>' + esc(j.name) + '</b> · ' + esc(j.group) + (j.teacher ? ' (' + esc(j.teacher) + ')' : '') + '\n\n🔑 Shaxsiy kodingiz: <code>' + j.code + '</code>\nSaytda kirish uchun: ' + BAHO_URL + '/men?kod=' + j.code + '\n\n<i>Kodni hech kimga bermang.</i>', menuKb(u));
  const me = await bahoMe(env, j.code); if (me) return vzSend(env, chat, me, j.code);
}

async function vzCard(env, chat, code, p) {
  try {
    tg(env, 'sendChatAction', {chat_id: chat, action: 'upload_photo'});
    const path = '/api/s/card.png?p=' + p;
    const init = {headers: {'x-code': code}};
    const r = env.BAHO ? await env.BAHO.fetch('https://baho' + path, init) : await fetch(BAHO_URL + path, init);
    if (!r.ok) throw new Error('card ' + r.status);
    const png = await r.arrayBuffer();
    const fd = new FormData();
    fd.append('chat_id', String(chat));
    fd.append('photo', new Blob([png], {type: 'image/png'}), 'ilmzor-' + (p === 'week' ? 'haftalik' : p === 'oylik' ? 'oylik-test' : 'oylik') + '-karta.png');
    fd.append('caption', (p === 'week' ? '📊 Haftalik vazifalar' : p === 'oylik' ? '🗓 Oylik test' : '📊 Oylik vazifalar') + ' kartasi — Ilmzor\nOta-onangizga ham yuboring 🙂');
    const s = await fetch('https://api.telegram.org/bot' + cleanToken(env.BOT_TOKEN) + '/sendPhoto', {method: 'POST', body: fd}).then((x) => x.json());
    if (!s.ok) throw new Error(s.description || 'sendPhoto');
  } catch (e) {
    return send(env, chat, '⚠️ Kartani tayyorlab boʻlmadi, birozdan keyin qayta urinib koʻring.');
  }
}

function vzBar(p) { const k = Math.max(0, Math.min(10, Math.round(p / 10))); return '🟩'.repeat(k) + '⬜'.repeat(10 - k); }
async function vzMonthly(env, chat, u, me) {
  const O = me.oylik || [];
  if (!O.length) return send(env, chat, '🗓 <b>' + esc(me.student.name) + '</b>\n\nHali oylik test natijasi kiritilmagan. Ustoz natijani kiritishi bilan shu yerda chiqadi.', menuKb(u));
  const last = O[O.length - 1], prev = O[O.length - 2];
  let t = '🗓 <b>Oylik test natijalari</b>\n👤 <b>' + esc(me.student.name) + '</b> · ' + esc(me.student.group) + '\n\n<b>' + esc(last.label) + '</b>: <b>' + last.pct + '%</b>\n' + vzBar(last.pct);
  if (last.n > 1) t += '\n🏅 Guruhda: ' + last.rank + '-oʻrin (' + last.n + ' kishidan)';
  if (prev) { const d = last.pct - prev.pct; t += '\n' + (d > 0 ? '📈' : d < 0 ? '📉' : '➖') + ' ' + esc(prev.label) + 'ga nisbatan: ' + (d > 0 ? '+' : '') + d + '%'; }
  if (O.length > 1) t += '\n\n<b>Oylar boʻyicha:</b>\n' + O.slice(-6).map((o) => '<code>' + esc(o.label.slice(0, 3)) + '</code> ' + vzBar(o.pct) + ' ' + o.pct + '%').join('\n');
  t += '\n\n<i>Oylik test vazifa foiziga qoʻshilmaydi — alohida koʻrsatiladi.</i>';
  return tg(env, 'sendMessage', {chat_id: chat, text: t, parse_mode: 'HTML', reply_markup: {inline_keyboard: [[{text: '🖼 Oylik test kartasi', callback_data: 'vzK:oylik'}]]}});
}
async function vzShowMonthlyByName(env, chat, u) {
  if (!(u.name && String(u.name).trim().split(/\s+/).length >= 2)) return null;
  const r = await bahoReq(env, 'POST', '/api/bot/claim', '', {name: u.name, tg: String(u.id), probe: true}).catch(() => null);
  if (!(r && r.ok && r.j.status === 'ok')) return null;
  const c = await bahoReq(env, 'POST', '/api/bot/claim', '', {name: u.name, tg: String(u.id)}).catch(() => null);
  if (!(c && c.ok && c.j.status === 'ok')) return null;
  await vzDb(env); await env.DB.prepare('INSERT OR REPLACE INTO baho_link(uid, code, created) VALUES(?, ?, ?)').bind(String(u.id), c.j.code, Date.now()).run();
  const me = await bahoMe(env, c.j.code); return me ? vzMonthly(env, chat, u, me) : null;
}

async function vzCoins(env, chat, u) {
  const lk = await vzLink(env, u); if (!lk) return vzShow(env, chat, u);
  const me = await bahoMe(env, lk); if (!me) return vzShow(env, chat, u);
  const C = me.coins || {balance: 0, month: 0, recent: [], shop: []};
  let t = '💰 <b>Ilmzor pulim</b>\n👤 ' + esc(me.student.name) + ' · ' + esc(me.student.group) + '\n\n🪙 Balans: <b>' + C.balance + ' Ilmzor puli</b>\n📅 Bu oy: +' + C.month + (C.balance > 0 ? '\n🏅 Guruhda: ' + C.rank + '-oʻrin (' + C.groupSize + ' kishidan)' : '');
  if (C.recent.length) t += '\n\n<b>Oxirgi harakatlar:</b>\n' + C.recent.slice(0, 8).map((r) => (r.amount > 0 ? '🟢 +' : '🔴 ') + r.amount + ' — ' + esc(r.reason || '')).join('\n');
  else t += '\n\nHali Ilmzor puli yoʻq. Vazifani bajaring — baho qoʻyilishi bilan pul tushadi!';
  t += '\n\n🛍 Doʻkondagi mahsulotlar va narxlar — «' + B.shop + '» tugmasida.';
  t += '\n\n<i>Ilmzor puli qanday toʻplanadi: vazifa 100% — eng koʻp, 80% dan yuqori — koʻp; xulq, davomat va faollik uchun ustoz qoʻshimcha beradi.</i>';
  return send(env, chat, t, menuKb(u));
}


// ---------- 🛍 Doʻkon: katalog, rasm, buyurtma ----------
async function vzShopItems(env) { try { const r = await env.BAHO.fetch('https://baho/api/bot/shop'); if (r.ok) return await r.json(); } catch (e) { console.log('shop', e && e.message); } return {items: [], base: ''}; }
async function vzBal(env, code) { if (!code) return null; const me = await bahoMe(env, code); return me && me.coins ? me.coins : null; }
async function vzShop(env, chat, u) {
  const {items} = await vzShopItems(env); const code = await vzLink(env, u); const C = await vzBal(env, code); const bal = C ? C.balance : null;
  let t = '🛍 <b>Ilmzor doʻkoni</b>' + (bal !== null ? '\n🪙 Sizning balansingiz: <b>' + bal + ' Ilmzor puli</b>' : '') + '\n';
  const rows = [];
  if (!items.length) t += '\nHozircha doʻkonda mahsulot yoʻq. Tez orada qoʻshiladi!';
  else {
    const have = items.filter((i) => i.stock > 0), out = items.filter((i) => i.stock <= 0);
    const cats = {}; have.forEach((i) => { const c = i.category || 'Boshqa'; (cats[c] = cats[c] || []).push(i); });
    for (const [c, list] of Object.entries(cats)) t += '\n<b>' + esc(c) + '</b>\n' + list.map((i) => (bal !== null && bal >= i.price ? '✅ ' : '▫️ ') + esc(i.name) + ' — <b>' + i.price + '</b> 🪙 · ' + (i.stock <= 3 ? 'oxirgi ' + i.stock + ' ta' : i.stock + ' ta bor') + (i.pv ? ' 📷' : '') + (bal !== null && bal < i.price ? ' <i>(yana ' + (i.price - bal) + ' kerak)</i>' : '')).join('\n') + '\n';
    if (!have.length) t += '\nHozir sotuvda mahsulot qolmagan.\n';
    if (out.length) t += '\n❌ <b>Tugagan:</b> ' + out.map((i) => esc(i.name) + ' (' + i.price + ' 🪙)').join(', ') + '\n';
    if (bal !== null) t += '\n✅ — pulingiz yetadi · ▫️ — hali yetmaydi';
    t += '\n\n👇 Mahsulotni bosing — rasmi va «🛒 Olaman» tugmasi chiqadi.';
    if (bal === null) t += '\n<i>Xarid qilish uchun avval «' + B.vaz + '» orqali ism-familiyangizni yozib ulaning.</i>';
    have.slice(0, 24).forEach((i) => rows.push([{text: (bal !== null && bal >= i.price ? '✅ ' : '') + i.name + ' — ' + i.price + ' 🪙', callback_data: 'vzP:' + i.id}]));
  }
  if (C && (C.orders || []).length) rows.push([{text: '📦 Buyurtmalarim', callback_data: 'vzO:l'}]);
  return send(env, chat, t.slice(0, 4000), rows.length ? inl(rows) : menuKb(u));
}
async function vzShopCb(env, cq, u, chat, k, v, answer) {
  const code = await vzLink(env, u);
  if (k === 'vzO' && v === 's') { await answer(); return vzShop(env, chat, u); }
  if (k === 'vzP') {
    const {items, base} = await vzShopItems(env); const it = items.find((i) => i.id === v); if (!it) return answer('Bu mahsulot endi yoʻq');
    await answer(); const C = await vzBal(env, code); const bal = C ? C.balance : null;
    const cap = '🛍 <b>' + esc(it.name) + '</b>\n' + esc(it.category || '') + '\n\n💰 Narxi: <b>' + it.price + ' Ilmzor puli</b>\n📦 ' + (it.stock > 0 ? (it.stock <= 3 ? 'Oxirgi ' + it.stock + ' ta qoldi!' : it.stock + ' ta bor') : 'Tugagan') + (bal !== null ? '\n🪙 Balansingiz: <b>' + bal + '</b>' + (bal >= it.price ? ' ✅ yetadi' : ' — yana <b>' + (it.price - bal) + '</b> kerak') : '\n\n<i>Xarid uchun avval «' + B.vaz + '» orqali ulaning.</i>');
    const btn = []; if (code && it.stock > 0 && bal !== null && bal >= it.price) btn.push([{text: '🛒 Olaman — ' + it.price + ' 🪙', callback_data: 'vzB:' + it.id}]); btn.push([{text: '⬅️ Doʻkonga qaytish', callback_data: 'vzO:s'}]);
    if (it.pv && base) { const r = await tg(env, 'sendPhoto', {chat_id: chat, photo: base + '/p/shop/' + it.id + '.jpg?v=' + it.pv, caption: cap, parse_mode: 'HTML', reply_markup: {inline_keyboard: btn}}); if (r && r.ok) return; }
    return send(env, chat, cap, inl(btn));
  }
  if (!code) { await answer(); return vzAskCode(env, chat, u); }
  if (k === 'vzB') {
    const {items} = await vzShopItems(env); const it = items.find((i) => i.id === v); if (!it || it.stock <= 0) return answer('Bu mahsulot tugagan');
    await answer();
    return send(env, chat, '🛒 <b>' + esc(it.name) + '</b> — <b>' + it.price + ' Ilmzor puli</b>\n\nOlasizmi? Pul darhol band qilinadi, mahsulotni doʻkon sotuvchisidan olasiz.', inl([[{text: '✅ Ha, olaman', callback_data: 'vzY:' + it.id}, {text: '✖ Yoʻq', callback_data: 'vzO:s'}]]));
  }
  if (k === 'vzY') {
    if (cq.message) await tg(env, 'editMessageReplyMarkup', {chat_id: chat, message_id: cq.message.message_id, reply_markup: {inline_keyboard: []}});
    const r = await bahoReq(env, 'POST', '/api/s/order', code, {itemId: v, qty: 1});
    if (!r.ok) { await answer('⚠️ Boʻlmadi'); return send(env, chat, '⚠️ ' + esc(r.j.error || 'Buyurtma berib boʻlmadi'), menuKb(u)); }
    await answer('✅ Buyurtma qabul qilindi');
    return send(env, chat, '✅ <b>Buyurtma qabul qilindi!</b>\n🛍 ' + esc(r.j.name) + ' — ' + r.j.cost + ' 🪙 band qilindi\n🪙 Qolgan balans: <b>' + r.j.balance + '</b>\n\n📍 Mahsulotni doʻkon sotuvchisidan olib keting. Berilganda shu yerga xabar keladi.\n<i>Fikringiz oʻzgarsa: «📦 Buyurtmalarim» → Bekor qilish (pul qaytadi).</i>', inl([[{text: '📦 Buyurtmalarim', callback_data: 'vzO:l'}]]));
  }
  if (k === 'vzO') {
    await answer(); const C = await vzBal(env, code); const os = (C && C.orders) || [];
    if (!os.length) return send(env, chat, '📦 Hali buyurtma bermagansiz.', inl([[{text: '🛍 Doʻkon', callback_data: 'vzO:s'}]]));
    const ic = {kutilmoqda: '⏳', berildi: '✅', bekor: '✖'}, nm = {kutilmoqda: 'sotuvchidan olib keting', berildi: 'berildi', bekor: 'bekor qilindi'};
    const t = '📦 <b>Buyurtmalarim</b>\n\n' + os.map((o) => ic[o.status] + ' ' + esc(o.name) + ' — ' + o.cost + ' 🪙 · <i>' + nm[o.status] + '</i>').join('\n');
    const rows = os.filter((o) => o.status === 'kutilmoqda').map((o) => [{text: '✖ Bekor qilish: ' + o.name, callback_data: 'vzQ:' + o.id}]); rows.push([{text: '🛍 Doʻkon', callback_data: 'vzO:s'}]);
    return send(env, chat, t, inl(rows));
  }
  if (k === 'vzQ') {
    const r = await bahoReq(env, 'POST', '/api/s/order/cancel', code, {id: v});
    if (!r.ok) return answer('⚠️ ' + (r.j.error || 'Xatolik'));
    await answer('Bekor qilindi'); if (cq.message) await tg(env, 'editMessageReplyMarkup', {chat_id: chat, message_id: cq.message.message_id, reply_markup: {inline_keyboard: []}});
    const C = await vzBal(env, code);
    return send(env, chat, '✖ Buyurtma bekor qilindi, Ilmzor pulingiz qaytdi.' + (C ? '\n🪙 Balans: <b>' + C.balance + '</b>' : ''), menuKb(u));
  }
  return answer();
}

// ---------- 🔔 Xabarnomalar: yangi mahsulot, buyurtma holati, pul yetdi ----------
async function vzNotify(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS bot_kv (k TEXT PRIMARY KEY, v TEXT)').run(); await vzDb(env);
  const row = await env.DB.prepare("SELECT v FROM bot_kv WHERE k = 'ev'").first(); const since = row ? Number(row.v) : 0;
  const r = await env.BAHO.fetch('https://baho/api/bot/events?since=' + since); if (!r.ok) return; const E = await r.json();
  await env.DB.prepare("INSERT INTO bot_kv (k, v) VALUES ('ev', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(E.now)).run();
  if (!since) return;
  const links = (await env.DB.prepare('SELECT uid, code FROM baho_link').all()).results || []; const byCode = {}; links.forEach((l) => (byCode[l.code] = byCode[l.code] || []).push(l.uid));
  const toCode = async (c, t, extra) => { for (const uid of byCode[c] || []) { try { await send(env, uid, t, extra || {}); } catch (e) {} } };
  let sent = 0;
  for (const it of E.items || []) {
    const cap = '🆕 <b>Doʻkonga yangi mahsulot!</b>\n🛍 ' + esc(it.name) + ' — <b>' + it.price + ' Ilmzor puli</b>'; const btn = {inline_keyboard: [[{text: '🛒 Koʻrish', callback_data: 'vzP:' + it.id}]]};
    for (const uid of [...new Set(links.map((l) => l.uid))]) { if (sent++ > 250) break; try { if (it.pv) await tg(env, 'sendPhoto', {chat_id: uid, photo: E.base + '/p/shop/' + it.id + '.jpg?v=' + it.pv, caption: cap, parse_mode: 'HTML', reply_markup: btn}); else await send(env, uid, cap, {reply_markup: btn}); } catch (e) {} }
  }
  const ceos = ((await env.DB.prepare("SELECT id FROM users WHERE role = 'ceo'").all()).results || []).map((x) => x.id);
  for (const o of E.orders || []) {
    if (o.status === 'kutilmoqda' && o.ts > since) for (const c of ceos) await send(env, c, '📲 <b>Yangi buyurtma</b> (bot orqali)\n🛍 ' + esc(o.name) + ' — ' + o.cost + ' 🪙\n<i>Sotuvchi berganda saytda «✅ Berildi» ni bosadi.</i>', {disable_notification: true});
    if (o.done_ts && o.done_ts > since && o.code) {
      if (o.status === 'berildi') await toCode(o.code, '✅ <b>Buyurtmangiz berildi!</b>\n🛍 ' + esc(o.name) + '\nXaridingiz muborak! 🎉');
      if (o.status === 'bekor' && o.by_user !== 'student') await toCode(o.code, '✖ Buyurtmangiz bekor qilindi: ' + esc(o.name) + '\n🪙 ' + o.cost + ' Ilmzor puli balansingizga qaytdi.');
    }
  }
  for (const c of E.coins || []) {
    if (!(c.delta > 0)) continue; const prev = c.balance - c.delta;
    const now = (E.shop || []).filter((i) => i.price > prev && i.price <= c.balance);
    if (now.length) await toCode(c.code, '🎉 <b>Ilmzor pulingiz yetdi!</b>\n🪙 Balans: <b>' + c.balance + '</b>\n\nEndi olishingiz mumkin:\n' + now.slice(0, 6).map((i) => '✅ ' + esc(i.name) + ' — ' + i.price + ' 🪙').join('\n'), inl([[{text: '🛍 Doʻkonga oʻtish', callback_data: 'vzO:s'}]]));
  }
}

// ---------- 💾 Kunlik zaxira nusxa (23:00, CEO ga fayl) ----------
async function vzBackup(env, force) {
  const now = new Date(Date.now() + 5 * 3600e3); const day = now.toISOString().slice(0, 10);
  if (!force && now.getUTCHours() !== 23) return false;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS bot_kv (k TEXT PRIMARY KEY, v TEXT)').run();
  const last = await env.DB.prepare("SELECT v FROM bot_kv WHERE k = 'backup'").first();
  if (!force && last && last.v === day) return false;
  await env.DB.prepare("INSERT INTO bot_kv (k, v) VALUES ('backup', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(day).run();
  let baho = null; try { const r = await env.BAHO.fetch('https://baho/api/bot/backup'); if (r.ok) baho = await r.json(); } catch (e) { console.log('backup baho', e && e.message); }
  const bot = {}; const tb = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf%' ESCAPE '\\' AND name NOT LIKE 'sqlite%'").all()).results || [];
  for (const x of tb) bot[x.name] = (await env.DB.prepare('SELECT * FROM "' + x.name + '"').all()).results || [];
  const json = JSON.stringify({at: new Date().toISOString(), baho, bot});
  const gz = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const T = baho ? baho.tables : {}; const docs = T.docs || [];
  const cap = '💾 <b>Kunlik zaxira nusxa</b> — ' + day + '\n' + (baho ? '👥 Oʻquvchi: ' + docs.filter((d) => d.coll === 'students').length + ' · 📝 Vazifa: ' + docs.filter((d) => d.coll === 'tasks').length + ' · 🪙 Pul yozuvi: ' + (T.coins || []).length + ' · 🛍 Mahsulot: ' + (T.shop || []).length : '⚠️ Baholar bazasini olib boʻlmadi') + '\n🤖 Bot natijalari: ' + (bot.results || []).length + '\n\n<i>Faylni saqlab qoʻying — kerak boʻlsa shu fayldan hammasi tiklanadi.</i>';
  const ceos = (await env.DB.prepare("SELECT id FROM users WHERE role = 'ceo'").all()).results || [];
  let ok = false;
  for (const c of ceos) {
    const fd = new FormData(); fd.append('chat_id', String(c.id)); fd.append('caption', cap); fd.append('parse_mode', 'HTML'); fd.append('disable_notification', 'true');
    fd.append('document', new Blob([gz], {type: 'application/gzip'}), 'ilmzor-zaxira-' + day + '.json.gz');
    const r = await fetch('https://api.telegram.org/bot' + cleanToken(env.BOT_TOKEN) + '/sendDocument', {method: 'POST', body: fd}); if (r.ok) ok = true;
  }
  return ok;
}


// ---------- 📢 Majburiy obuna: yangi oʻquvchilar @ilmzorlc kanaliga obuna boʻlgach bot ochiladi ----------
const SUB_CHANNEL = '@ilmzorlc', SUB_URL = 'https://t.me/ilmzorlc', SUB_FROM = 1795582624721; // shu vaqtdan keyin kelgan aʼzolar uchun
const SUBC = new Map();
async function subOk(env, u) {
  if (u.role !== 'student') return true;
  if (!u.isNew && Number(u.created || 0) < SUB_FROM) return true;
  const c = SUBC.get(u.id); if (c && Date.now() - c < 10 * 60e3) return true;
  const r = await tg(env, 'getChatMember', {chat_id: SUB_CHANNEL, user_id: u.id}).catch(() => null);
  if (!r || !r.ok) { await subWarn(env, r); return true; } // bot kanalda admin boʻlmasa — oʻtkazib yuboramiz, CEO ga ogohlantirish
  const s = r.result || {}; const ok = ['creator', 'administrator', 'member'].includes(s.status) || (s.status === 'restricted' && s.is_member);
  if (ok) SUBC.set(u.id, Date.now()); return ok;
}
async function subAsk(env, chat) {
  return send(env, chat, '📢 Botdan foydalanish uchun <b>Ilmzor oʻquv markazi</b> kanaliga obuna boʻling.\n\nKanalda eʼlonlar, natijalar va foydali materiallar chiqib boradi.\n\n1️⃣ «📢 Kanalga oʻtish» → <b>Obuna boʻlish</b>\n2️⃣ Qaytib «✅ Obuna boʻldim» ni bosing 👇', inl([[{text: '📢 Kanalga oʻtish', url: SUB_URL}], [{text: '✅ Obuna boʻldim', callback_data: 'sub:chk'}]]));
}
async function subCallback(env, cq, u, chat, answer) {
  SUBC.delete(u.id);
  if (!(await subOk(env, u))) return answer('❌ Hali obuna boʻlmagansiz. Avval «📢 Kanalga oʻtish» ni bosing.');
  await answer('✅ Rahmat!'); if (cq.message) await tg(env, 'deleteMessage', {chat_id: chat, message_id: cq.message.message_id}).catch(() => {});
  if (!u.name) { await setState(env, u, 'ask_name'); return send(env, chat, '✅ Rahmat! Endi <b>ism va familiyangizni</b> yozing (masalan: <i>Ali Valiyev</i>):', {reply_markup: {remove_keyboard: true}}); }
  return send(env, chat, '✅ Rahmat! Bot imkoniyatlari ochildi. Kerakli boʻlimni tanlang 👇', menuKb(u));
}
async function subWarn(env, r) {
  try {
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS bot_kv (k TEXT PRIMARY KEY, v TEXT)').run();
    const day = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10); const w = await env.DB.prepare("SELECT v FROM bot_kv WHERE k = 'subwarn'").first(); if (w && w.v === day) return;
    await env.DB.prepare("INSERT INTO bot_kv (k, v) VALUES ('subwarn', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(day).run();
    const ceos = (await env.DB.prepare("SELECT id FROM users WHERE role = 'ceo'").all()).results || [];
    for (const c of ceos) await send(env, c.id, '⚠️ <b>Majburiy obuna ishlamayapti</b>: bot ' + SUB_CHANNEL + ' kanalida admin emas, shuning uchun oʻquvchilar tekshiruvsiz oʻtkazilyapti.\nKanal → Boshqaruv → Administratorlar → botni qoʻshing. Tekshirish: /kanal' + (r && r.description ? '\n<i>' + esc(r.description) + '</i>' : ''));
  } catch (e) {}
}

// bot kanalda admin ekanini har 10 daqiqada tekshirib, bot_kv ga yozib qoʻyadi (CEO /kanal bilan ham koʻradi)
async function subSelfCheck(env) {
  if (new Date().getUTCMinutes() % 10 !== 0) { const r0 = await env.DB.prepare("SELECT v FROM bot_kv WHERE k = 'kanal'").first().catch(() => null); if (r0) return; }
  const me = await tg(env, 'getMe', {}); const r = await tg(env, 'getChatMember', {chat_id: SUB_CHANNEL, user_id: me.result.id});
  const v = JSON.stringify({at: new Date().toISOString(), ok: !!(r && r.ok), status: r && r.ok ? r.result.status : null, rights: r && r.ok ? {post: r.result.can_post_messages || false, edit: r.result.can_edit_messages || false, del: r.result.can_delete_messages || false, invite: r.result.can_invite_users || false} : null, err: r && !r.ok ? r.description : null});
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS bot_kv (k TEXT PRIMARY KEY, v TEXT)').run();
  await env.DB.prepare("INSERT INTO bot_kv (k, v) VALUES ('kanal', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(v).run();
}

// ---- 📱 Telegram Mini App: /app (oʻquvchi sahifasi Telegram ichida) ----
const APP_URL = 'https://ilmzor-test-bot.nomonovnosirbek15.workers.dev';
const APP_BOOT = `<script src="https://telegram.org/js/telegram-web-app.js"></script>
<script>
(function(){
  var W=window.Telegram&&Telegram.WebApp, ID=W&&W.initData||'';
  try{if(!ID&&window.parent!==window)ID=window.parent.Telegram.WebApp.initData||'';}catch(e){}
  window.__TGI=ID;
  try{W.ready();W.expand();W.setHeaderColor('#0e223a');W.setBackgroundColor('#f2f5f8');}catch(e){}
  var code='';
  if(ID){try{var x=new XMLHttpRequest();x.open('POST','/app/auth',false);x.setRequestHeader('content-type','application/json');x.send(JSON.stringify({initData:ID}));var j=JSON.parse(x.responseText||'{}');code=j.code||'';}catch(e){}}
  try{code?localStorage.setItem('ilmzor_code',code):localStorage.removeItem('ilmzor_code');}catch(e){}
  var of=window.fetch.bind(window);
  window.fetch=function(u,o){o=o||{};if(typeof u==='string'&&u.indexOf('/api/s/')===0){o.headers=Object.assign({},o.headers||{},{'x-tg-init':ID});}return of(u,o);};
  function say(m){try{W.showAlert(m);}catch(_){alert(m);}}
  document.addEventListener('click',function(e){
    var a=e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href')||'';
    if(h.indexOf('/api/s/card.png')>=0){e.preventDefault();var p=(h.match(/[?&]p=(\\w+)/)||[])[1]||'month';
      of('/app/card',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({initData:ID,p:p})}).then(function(r){return r.json();}).then(function(j){
        if(j.ok){try{W.HapticFeedback.notificationOccurred('success');}catch(_){}say('🖼 Karta bot chatiga yuborildi. Ota-onangizga ham yuboring!');}else say(j.error||'Xatolik');}).catch(function(){say('Internetni tekshiring');});return;}
    if(W&&/^https:\\/\\/t\\.me\\//.test(a.href)){e.preventDefault();W.openTelegramLink(a.href);}
  },true);
})();
</script>`;
const appJson = (o, s) => new Response(JSON.stringify(o), {status: s || 200, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});
async function appRaw(env, path, init) { return env.BAHO ? env.BAHO.fetch('https://baho' + path, init) : fetch(BAHO_URL + path, init); }
async function appDb(env) { await env.DB.prepare('CREATE TABLE IF NOT EXISTS appcfg (k TEXT PRIMARY KEY, v TEXT)').run(); await vzDb(env); }
async function tgInitUser(env, initData) {
  if (!initData || !env.BOT_TOKEN) return null;
  const p = new URLSearchParams(String(initData)); const hash = p.get('hash'); if (!hash) return null; p.delete('hash');
  const dcs = [...p.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v]) => k + '=' + v).join('\n');
  const enc = new TextEncoder(), H = {name: 'HMAC', hash: 'SHA-256'};
  const k1 = await crypto.subtle.importKey('raw', enc.encode('WebAppData'), H, false, ['sign']);
  const secret = await crypto.subtle.sign('HMAC', k1, enc.encode(cleanToken(env.BOT_TOKEN)));
  const k2 = await crypto.subtle.importKey('raw', secret, H, false, ['sign']);
  const hex = [...new Uint8Array(await crypto.subtle.sign('HMAC', k2, enc.encode(dcs)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== hash) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date') || 0) > 86400) return null;
  try { const u = JSON.parse(p.get('user') || 'null'); return u && u.id ? u : null; } catch (e) { return null; }
}
async function appFails(env, uid, add) {
  const k = 'af:' + uid; const r = await env.DB.prepare('SELECT v FROM appcfg WHERE k = ?').bind(k).first();
  let o = r ? JSON.parse(r.v) : {n: 0, t: Date.now()}; if (Date.now() - o.t > 3600000) o = {n: 0, t: Date.now()};
  if (add) { o.n++; await env.DB.prepare('INSERT OR REPLACE INTO appcfg(k, v) VALUES(?, ?)').bind(k, JSON.stringify(o)).run(); }
  return o.n;
}
async function appLinked(env, uid) { const r = await env.DB.prepare('SELECT code FROM baho_link WHERE uid = ?').bind(String(uid)).first(); return r ? r.code : ''; }
async function miniApp(request, url, env) {
  const p = url.pathname, M = request.method;
  if (M === 'GET' && p === '/app/men') {
    const r = await appRaw(env, '/men');
    const h = (await r.text()).replace('<head>', '<head>\n' + APP_BOOT);
    return new Response(h, {headers: {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'}});
  }
  if (M === 'POST' && (p === '/app/auth' || p === '/app/card')) {
    const b = await request.json().catch(() => ({}));
    const user = await tgInitUser(env, b.initData); if (!user) return appJson({error: 'Ilovani botdan qayta oching'}, 403);
    await appDb(env); const code = await appLinked(env, user.id);
    if (p === '/app/auth') return appJson({code});
    if (!code) return appJson({error: 'Avval kodingiz bilan kiring'}, 404);
    const per = b.p === 'week' ? 'week' : b.p === 'oylik' ? 'oylik' : 'month';
    await vzCard(env, user.id, code, per); return appJson({ok: true});
  }
  if (M === 'GET' && (p.startsWith('/fonts/') || p.startsWith('/brand/') || p === '/reyting' || p === '/reyting/' || p.startsWith('/api/public/'))) {
    const r = await appRaw(env, p + url.search); return new Response(r.body, {status: r.status, headers: r.headers});
  }
  if ((M === 'GET' || M === 'POST') && p.startsWith('/api/s/')) {
    const user = await tgInitUser(env, request.headers.get('x-tg-init'));
    if (!user) return appJson({error: 'Ilovani botdan qayta oching'}, 403);
    await appDb(env);
    let code = await appLinked(env, user.id), fresh = false;
    if (p === '/api/s/me' && code && (await appRaw(env, '/api/s/me', {headers: {'x-code': code}})).status === 404) { await env.DB.prepare('DELETE FROM baho_link WHERE uid = ?').bind(String(user.id)).run(); code = ''; }
    if (!code) { // hali bogʻlanmagan: oʻquvchi kodini qoʻlda kiritadi
      if ((await appFails(env, user.id, false)) >= 6) return appJson({error: 'Juda koʻp urinish. 1 soatdan keyin qayta urinib koʻring yoki botda «📝 Vazifalarim» ga ism-familiyangizni yozing.'}, 429);
      code = String(request.headers.get('x-code') || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); fresh = true;
      if (code.length !== 6) return appJson({error: 'Kod notoʻgʻri'}, 404);
    }
    const h = new Headers({'x-code': code}); const ct = request.headers.get('content-type'); if (ct) h.set('content-type', ct);
    const q = new URLSearchParams(url.search); q.delete('code'); const qs = q.toString();
    const r = await appRaw(env, p + (qs ? '?' + qs : ''), {method: M, headers: h, body: M === 'POST' ? await request.arrayBuffer() : undefined});
    if (fresh) {
      if (r.status === 200) await env.DB.prepare('INSERT OR REPLACE INTO baho_link(uid, code, created) VALUES(?, ?, ?)').bind(String(user.id), code, Date.now()).run();
      else if (r.status === 404) await appFails(env, user.id, true);
    }
    return new Response(r.body, {status: r.status, headers: r.headers});
  }
  return null;
}
async function appMenu(env) {
  await appDb(env);
  const r = await env.DB.prepare("SELECT v FROM appcfg WHERE k = 'menu'").first(); if (r && r.v === 'v2') return;
  const t = await tg(env, 'setChatMenuButton', {menu_button: {type: 'web_app', text: '📱 Ilova', web_app: {url: APP_URL + '/app'}}});
  if (t && t.ok) await env.DB.prepare("INSERT OR REPLACE INTO appcfg(k, v) VALUES('menu', 'v2')").run();
}


// ==== 📱 Ilmzor Mini App 2.0: botning barcha imkoniyatlari ilovada ====
const TA = (o, s) => new Response(JSON.stringify(o), {status: s || 200, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});
const TE = (m, s) => TA({error: m}, s || 400);
const fsig = (env, fid) => hmacHex(env, 'f|' + fid);
async function furl(env, f) { return '/app/f?i=' + encodeURIComponent(f.id || f.fid) + '&t=' + (f.type || f.ftype || 'document') + '&s=' + (await fsig(env, f.id || f.fid)); }
async function tbUser(env, t) {
  let u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(t.id).first();
  if (!u) {
    await env.DB.prepare('INSERT INTO users (id, name, role, state, data, created) VALUES (?, NULL, ?, ?, NULL, ?)').bind(t.id, 'student', 'idle', Date.now()).run();
    u = {id: t.id, name: null, role: 'student', phone: null, isNew: true, created: Date.now()};
  }
  u.d = u.data ? JSON.parse(u.data) : {};
  return u;
}
const permsOf = (u) => PERMS[u.role] || [];
// Telegram'ga fayl yuklab file_id olish (ustoz/admin o'z chatiga)
async function tbUpload(env, chatId, file, caption) {
  const isImg = /^image\//.test(file.type || '');
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append(isImg ? 'photo' : 'document', file, file.name || (isImg ? 'rasm.jpg' : 'fayl.pdf'));
  if (caption) fd.append('caption', caption);
  const r = await fetch(`https://api.telegram.org/bot${cleanToken(env.BOT_TOKEN)}/${isImg ? 'sendPhoto' : 'sendDocument'}`, {method: 'POST', body: fd}).then((x) => x.json()).catch(() => ({ok: false}));
  if (!r.ok) return null;
  const m = r.result;
  if (m.photo) return {type: 'photo', id: m.photo[m.photo.length - 1].file_id, mid: m.message_id};
  if (m.document) return {type: 'document', id: m.document.file_id, mid: m.message_id};
  return null;
}
async function tbFile(env, url) {
  const fid = url.searchParams.get('i') || '';
  if (!fid || !safeEq(await fsig(env, fid), url.searchParams.get('s') || '')) return new Response('forbidden', {status: 403});
  const g = await tg(env, 'getFile', {file_id: fid});
  if (!g.ok) return new Response('not found', {status: 404});
  const r = await fetch(`https://api.telegram.org/file/bot${cleanToken(env.BOT_TOKEN)}/${g.result.file_path}`);
  const p = g.result.file_path.toLowerCase();
  const ct = p.endsWith('.pdf') ? 'application/pdf' : /\.(jpe?g)$/.test(p) ? 'image/jpeg' : p.endsWith('.png') ? 'image/png' : p.endsWith('.webp') ? 'image/webp' : 'application/octet-stream';
  return new Response(r.body, {headers: {'content-type': ct, 'cache-control': 'private, max-age=3600'}});
}
// ---------- o'quvchi: test ----------
async function taTestOpen(env, u, b) {
  const code = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{4}$/.test(code)) return TE('Kod 4 belgidan iborat boʻladi, masalan: A7K3');
  const tt = await env.DB.prepare('SELECT * FROM tests WHERE code = ?').bind(code).first();
  if (!tt) return TE('Bunday kodli test topilmadi. Kodni tekshirib qayta yozing.', 404);
  const done = await env.DB.prepare('SELECT correct, total, answers FROM results WHERE code = ? AND user_id = ?').bind(code, u.id).first();
  if (done) return TA({code, title: tt.title, done: {ok: done.correct, n: done.total, pct: pct(done.correct, done.total)}, canReveal: !isOpen(tt) && tt.reveal !== 0});
  if (!isOpen(tt)) return TE('🔒 Bu test yopilgan.');
  const files = [];
  for (const f of JSON.parse(tt.files || '[]')) files.push({type: f.type, url: await furl(env, f)});
  return TA({code, title: tt.title, n: tt.n, deadline: tt.deadline || null, files});
}
async function taTestSubmit(env, u, b) {
  if (!u.name) return TE('Avval ism va familiyangizni kiriting');
  const tt = await env.DB.prepare('SELECT * FROM tests WHERE code = ?').bind(String(b.code || '').toUpperCase()).first();
  if (!tt) return TE('Test topilmadi', 404);
  if (!isOpen(tt)) return TE('🔒 Bu test yopilgan.');
  const ans = String(b.answers || '').toLowerCase().replace(/[^a-e-]/g, '');
  if (ans.length !== tt.n) return TE(`Testda ${tt.n} ta savol bor — hammasiga javob belgilang.`);
  const r = check(tt.answer_key, ans);
  try {
    await env.DB.prepare('INSERT INTO results (code, user_id, name, answers, correct, total, created) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(tt.code, u.id, u.name || '—', ans, r.ok, r.total, Date.now()).run();
  } catch (e) { return TE('Siz bu testni avval topshirgansiz. Natija bir marta hisoblanadi.'); }
  const p = pct(r.ok, r.total);
  await send(env, tt.teacher_id, `🔔 <b>${esc(u.name)}</b> — ${tt.code} (${esc(tt.title)}): <b>${r.ok}/${r.total}</b> (${p}%) · ilovadan`).catch(() => {});
  return TA({ok: r.ok, n: r.total, pct: p, wrong: r.wrong, title: tt.title});
}
async function taMine(env, u) {
  const rows = (await env.DB.prepare('SELECT r.code, r.correct, r.total, r.created, t.title, t.open, t.deadline, t.reveal FROM results r LEFT JOIN tests t ON t.code = r.code WHERE r.user_id = ? ORDER BY r.created DESC LIMIT 30').bind(u.id).all()).results || [];
  return TA({results: rows.map((r) => ({code: r.code, title: r.title || r.code, ok: r.correct, n: r.total, pct: pct(r.correct, r.total), at: r.created, reveal: !!r.title && !isOpen(r) && r.reveal !== 0}))});
}
async function taReveal(env, u, b) {
  const tt = await env.DB.prepare('SELECT * FROM tests WHERE code = ?').bind(String(b.code || '').toUpperCase()).first();
  if (!tt) return TE('Test topilmadi', 404);
  const mine = await env.DB.prepare('SELECT * FROM results WHERE code = ? AND user_id = ?').bind(tt.code, u.id).first();
  if (!mine && !isTeacher(u)) return TE('Bu testni siz topshirmagansiz.');
  if (isOpen(tt)) return TE('⏳ Test hali ochiq. Yopilgach toʻgʻri javoblar va reyting koʻrinadi.');
  if (tt.reveal === 0 && !isTeacher(u)) return TE('🙈 Ustoz bu test javoblarini yashirgan.');
  const all = (await env.DB.prepare('SELECT user_id, name, correct, total FROM results WHERE code = ? ORDER BY correct DESC, created ASC').bind(tt.code).all()).results || [];
  const n = all.length, avg = n ? Math.round(all.reduce((s, r) => s + pct(r.correct, r.total), 0) / n) : 0;
  let me = null;
  if (mine) me = {rank: all.findIndex((r) => r.user_id === u.id) + 1, ok: mine.correct, n: mine.total, pct: pct(mine.correct, mine.total), answers: mine.answers};
  return TA({code: tt.code, title: tt.title, count: n, avg, top: all.slice(0, 5).map((r) => ({name: r.name, pct: pct(r.correct, r.total)})), me, key: tt.answer_key});
}
// ---------- olimpiada ----------
async function taOlymp(env, u) {
  const staff = can(u, 'results');
  const sets = (await env.DB.prepare('SELECT id, title, open_at FROM rsets WHERE active = 1 ORDER BY created DESC').all()).results || [];
  const out = [];
  for (const s of sets) {
    const items = (await env.DB.prepare('SELECT id, label, ftype, fid, csv FROM ritems WHERE set_id = ? ORDER BY id').bind(s.id).all()).results || [];
    const locked = isLocked(s) && !staff;
    const its = [];
    for (const it of items) its.push({id: it.id, label: it.label, type: it.ftype, url: locked ? null : await furl(env, it)});
    out.push({id: s.id, title: s.title, locked: isLocked(s), lockText: isLocked(s) ? lockWhen(s) : '', canSearch: items.some((it) => it.csv), items: its});
  }
  return TA({sets: out});
}
async function taOlympFind(env, u, b) {
  const setid = Number(b.setid); const name = String(b.name || ''); const qt = normName(name).split(' ').filter(Boolean);
  if (qt.join('').length < 4 || qt.length < 2) return TE('Iltimos, toʻliq ism va familiyangizni yozing (masalan: Ali Valiyev)');
  const items = (await env.DB.prepare("SELECT label, csv FROM ritems WHERE set_id = ? AND csv IS NOT NULL AND csv != ''").bind(setid).all()).results || [];
  const found = [];
  await Promise.all(items.map((it) => getCsv(it.csv).catch(() => '')));
  for (const it of items) {
    try {
      for (const ln of (await getCsv(it.csv)).split(/\r?\n/)) { const cells = parseCsvLine(ln); if (cells.length < 3) continue; for (const c of cells) { if (matchName(c, qt)) { found.push({label: it.label, cells}); break; } } }
    } catch (e) {}
  }
  const out = [];
  for (const f of found.slice(0, 6)) {
    const c = f.cells; const rank = c[0], nm = c[1] || '', mak = c[2] || '', ball = c[c.length - 2] || '', foiz = c[c.length - 1] || '';
    const vt = vtier(rank); const k = vkey(setid, f.label, nm);
    const uu = await env.DB.prepare('SELECT used_at FROM vused WHERE k = ?').bind(k).first();
    const cl = f.label.replace('-sinf', '');
    const vq = {n: nm, c: cl, r: rank, b: ball, p: foiz, m: mak};
    const vurl = WORKER_URL + '/v?s=' + (await vsign(env, vq)) + '&n=' + encodeURIComponent(nm) + '&c=' + encodeURIComponent(cl) + '&r=' + encodeURIComponent(rank) + '&b=' + encodeURIComponent(ball) + '&p=' + encodeURIComponent(foiz) + '&m=' + encodeURIComponent(mak);
    out.push({label: f.label, rank, name: nm, school: mak && mak !== '-' ? mak : '', ball, pct: foiz, tier: vt.n, amount: vt.a, total: vt.a * 6, used: uu ? uu.used_at : null, vurl, vkey: can(u, 'results') ? k : null});
  }
  if (out.length) await setState(env, u, u.state || 'idle', Object.assign(u.d || {}, {vinfo: out.length === 1 ? out[0].tier + ' · ' + fmtSom(out[0].total) + ' soʻm' : 'Olimpiada vaucheri'}));
  return TA({found: out, deadline: '1-dekabr'});
}
async function taVused(env, u, b) {
  if (!can(u, 'results')) return TE('Ruxsat yoʻq', 403);
  const k = String(b.k || '');
  if (b.used) await env.DB.prepare('INSERT OR REPLACE INTO vused (k, used, used_at) VALUES (?, 1, ?)').bind(k, Date.now()).run();
  else await env.DB.prepare('DELETE FROM vused WHERE k = ?').bind(k).run();
  return TA({ok: true});
}
// ---------- kurslar ----------
async function taCourses(env, u) {
  const cs = (await env.DB.prepare('SELECT id, title, price, info FROM courses WHERE active = 1 ORDER BY id').all()).results || [];
  const mine = (await env.DB.prepare('SELECT id, ctitle, student, stage, created FROM leads WHERE user_id = ? ORDER BY created DESC LIMIT 10').bind(u.id).all()).results || [];
  return TA({courses: cs, mine: mine.map((l) => ({id: l.id, course: l.ctitle, student: l.student, stage: STAGES[l.stage] || l.stage, at: l.created})), subjects: SUBJECTS, grades: GRADES.map((g) => g + '-sinf').concat([GRADE_ADULT]), vinfo: (u.d && u.d.vinfo) || ''});
}
async function taLead(env, u, b, username) {
  const c = await env.DB.prepare('SELECT * FROM courses WHERE id = ? AND active = 1').bind(Number(b.course)).first();
  if (!c) return TE('Kurs topilmadi yoki yopilgan');
  if (!u.phone) return TE('phone', 428);
  const student = String(b.student || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!NAME_RE.test(student)) return TE('Oʻquvchining ism va familiyasi ikkalasi ham kerak. Masalan: Ali Valiyev');
  const subject = String(b.subject || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (subject.length < 3 || /^\d+$/.test(subject)) return TE('Fanni tanlang yoki yozing');
  const shift = b.shift === 'Ertalab' || b.shift === 'Abeddan keyin' ? b.shift : '';
  if (!shift) return TE('Kurs vaqtini tanlang');
  const grade = String(b.grade || '');
  if (!(grade === GRADE_ADULT || GRADES.map((g) => g + '-sinf').includes(grade))) return TE('Sinfni tanlang');
  const dup = await env.DB.prepare("SELECT id FROM leads WHERE user_id = ? AND course_id = ? AND stage != 'lost' AND student = ?").bind(u.id, c.id, student).first();
  if (dup) return TE('Bu oʻquvchi bu kursga allaqachon yozilgan.');
  const now = Date.now(); const vau = b.voucher ? String((u.d && u.d.vinfo) || 'Olimpiada vaucheri').slice(0, 80) : '';
  const ins = await env.DB.prepare("INSERT INTO leads (user_id, course_id, ctitle, name, phone, student, subject, shift, grade, username, vaucher, stage, reminded, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 0, ?, ?)").bind(u.id, c.id, c.title, u.name, u.phone, student, subject, shift, grade, username || '', vau, now, now).run();
  const l = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(ins.meta.last_row_id).first();
  await notifyAdmins(env, '🔔 <b>Yangi ariza!</b> (ilovadan)\n\n' + leadCard(l), inl(leadKb(l)));
  return TA({ok: true, id: l.id});
}
// ---------- Ilmzor puli do'koni ----------
async function taShop(env, u) {
  const {items, base} = await vzShopItems(env); const code = await vzLink(env, u); const C = code ? await vzBal(env, code) : null;
  return TA({linked: !!code, balance: C ? C.balance : null, orders: C ? (C.orders || []) : [], items: items.map((i) => ({id: i.id, name: i.name, category: i.category || 'Boshqa', price: i.price, stock: i.stock, img: i.pv && base ? base + '/p/shop/' + i.id + '.jpg?v=' + i.pv : ''}))});
}
async function taShopOrder(env, u, b, cancel) {
  const code = await vzLink(env, u); if (!code) return TE('Avval «📝 Vazifalar» boʻlimida ism-familiyangiz bilan ulaning');
  const r = cancel ? await bahoReq(env, 'POST', '/api/s/order/cancel', code, {id: String(b.id || '')}) : await bahoReq(env, 'POST', '/api/s/order', code, {itemId: String(b.id || ''), qty: 1});
  if (!r.ok) return TE(r.j.error || 'Xatolik');
  return TA(Object.assign({ok: true}, r.j));
}
// ---------- ustoz: testlar ----------
async function taTTList(env, u) {
  const all = can(u, 'alltests') && false;
  const rows = (await env.DB.prepare('SELECT t.code, t.title, t.n, t.open, t.deadline, t.reveal, t.created, (SELECT COUNT(*) FROM results r WHERE r.code = t.code) AS cnt FROM tests t WHERE t.teacher_id = ? ORDER BY t.created DESC LIMIT 60').bind(u.id).all()).results || [];
  return TA({tests: rows.map((r) => ({code: r.code, title: r.title, n: r.n, open: isOpen(r), deadline: r.deadline || null, reveal: r.reveal !== 0, cnt: r.cnt, at: r.created})), all});
}
async function taTTGet(env, u, b) {
  const tt = await ownTest(env, u, b.code); if (!tt) return TE('Test topilmadi', 404);
  const rows = (await env.DB.prepare('SELECT name, correct, total, created, answers FROM results WHERE code = ? ORDER BY correct DESC, created ASC').bind(tt.code).all()).results || [];
  const miss = new Array(tt.n).fill(0);
  rows.forEach((r) => { for (let i = 0; i < tt.n; i++) if (r.answers[i] !== tt.answer_key[i]) miss[i]++; });
  const avg = rows.length ? Math.round(rows.reduce((s, r) => s + pct(r.correct, r.total), 0) / rows.length) : 0;
  const files = [];
  for (const f of JSON.parse(tt.files || '[]')) files.push({type: f.type, url: await furl(env, f)});
  return TA({code: tt.code, title: tt.title, n: tt.n, key: tt.answer_key, open: isOpen(tt), deadline: tt.deadline || null, reveal: tt.reveal !== 0, files, avg, miss, results: rows.map((r) => ({name: r.name, ok: r.correct, n: r.total, pct: pct(r.correct, r.total), at: r.created}))});
}
async function taTTNew(env, u, form) {
  const key = parseAnswers(form.get('key') || '');
  if (!key || key.length > 200 || key.includes('-')) return TE('Kalitni tushunmadim. Masalan: abcdabcd yoki 1a 2b 3c');
  const title = String(form.get('title') || '').trim().slice(0, 80) || 'Test';
  const files = [];
  for (const f of form.getAll('files')) {
    if (!f || typeof f === 'string') continue;
    if (f.size > 20 * 1024 * 1024) return TE('Har bir fayl 20 MB dan oshmasin');
    const up = await tbUpload(env, u.id, f, files.length ? '' : `📄 «${title}» test fayli (ilovadan)`);
    if (!up) return TE('Faylni yuklab boʻlmadi, qayta urinib koʻring', 502);
    files.push({type: up.type, id: up.id});
  }
  if (!files.length) return TE('Test faylini (rasm yoki PDF) tanlang');
  const code = await newCode(env);
  await env.DB.prepare('INSERT INTO tests (code, title, teacher_id, files, answer_key, n, open, created) VALUES (?, ?, ?, ?, ?, ?, 1, ?)').bind(code, title, u.id, JSON.stringify(files), key, key.length, Date.now()).run();
  return TA({ok: true, code, n: key.length, title});
}
async function taTTSet(env, u, b) {
  const tt = await ownTest(env, u, b.code); if (!tt) return TE('Test topilmadi', 404);
  if (b.title !== undefined) { const t = String(b.title).trim().slice(0, 80); if (t.length < 2) return TE('Test nomini yozing'); await env.DB.prepare('UPDATE tests SET title = ? WHERE code = ?').bind(t, tt.code).run(); }
  if (b.key !== undefined) {
    const key = parseAnswers(b.key);
    if (!key || key.length !== tt.n || key.includes('-')) return TE(`Kalit aynan ${tt.n} ta javobdan iborat boʻlishi kerak`);
    await env.DB.prepare('UPDATE tests SET answer_key = ? WHERE code = ?').bind(key, tt.code).run();
    const rs = (await env.DB.prepare('SELECT id, answers FROM results WHERE code = ?').bind(tt.code).all()).results || [];
    for (const part of chunks(rs, 30)) {
      await env.DB.prepare(`UPDATE results SET correct = CASE id ${part.map(() => 'WHEN ? THEN ?').join(' ')} END WHERE id IN (${part.map(() => '?').join(',')})`).bind(...part.flatMap((r) => [r.id, check(key, r.answers).ok]), ...part.map((r) => r.id)).run();
    }
  }
  if (b.hours !== undefined) {
    const hours = Number(b.hours); if (!(hours >= 0 && hours <= 24 * 90)) return TE('Muddat notoʻgʻri');
    const dl = hours ? Date.now() + hours * 3600e3 : null;
    await env.DB.prepare('UPDATE tests SET deadline = ?, open = CASE WHEN ? IS NOT NULL THEN 1 ELSE open END WHERE code = ?').bind(dl, dl, tt.code).run();
  }
  if (b.reveal !== undefined) await env.DB.prepare('UPDATE tests SET reveal = ? WHERE code = ?').bind(b.reveal ? 1 : 0, tt.code).run();
  if (b.open !== undefined) {
    if (b.open && !isOpen(tt)) await env.DB.prepare('UPDATE tests SET open = 1, deadline = CASE WHEN deadline < ? THEN NULL ELSE deadline END WHERE code = ?').bind(Date.now(), tt.code).run();
    if (!b.open && isOpen(tt)) { await env.DB.prepare('UPDATE tests SET open = 0 WHERE code = ?').bind(tt.code).run(); await notifyClosed(env, tt, false); }
  }
  return taTTGet(env, u, {code: tt.code});
}
async function taTTExport(env, u, b) {
  const tt = await ownTest(env, u, b.code); if (!tt) return TE('Test topilmadi', 404);
  await exportTest(env, u.id, tt);
  return TA({ok: true, url: `${WORKER_URL}/export?c=${tt.code}&s=${await xsign(env, tt.code)}`});
}
async function taTTDel(env, u, b) {
  const tt = await ownTest(env, u, b.code); if (!tt) return TE('Test topilmadi', 404);
  await env.DB.batch([env.DB.prepare('DELETE FROM results WHERE code = ?').bind(tt.code), env.DB.prepare('DELETE FROM tests WHERE code = ?').bind(tt.code)]);
  return TA({ok: true});
}
async function taMonthlyGroups(env) {
  const rows = (await env.DB.prepare('SELECT m.grp, m.teacher, m.label, COUNT(*) AS n, AVG(m.score * 100.0 / m.maxs) AS avg FROM monthly m JOIN (SELECT grp, MAX(ym) AS ym FROM monthly GROUP BY grp) l ON l.grp = m.grp AND l.ym = m.ym GROUP BY m.grp ORDER BY m.grp').all()).results || [];
  return TA({groups: rows.map((r) => ({grp: r.grp, teacher: r.teacher, label: r.label, n: r.n, avg: Math.round(r.avg || 0)}))});
}
// ---------- natijalar (olimpiada) admin ----------
async function taRSets(env) {
  const sets = (await env.DB.prepare('SELECT id, title, active, open_at, created FROM rsets ORDER BY created DESC').all()).results || [];
  const out = [];
  for (const s of sets) {
    const items = (await env.DB.prepare('SELECT id, label, ftype, fid, csv FROM ritems WHERE set_id = ? ORDER BY id').bind(s.id).all()).results || [];
    const its = [];
    for (const it of items) its.push({id: it.id, label: it.label, csv: it.csv || '', url: await furl(env, it), type: it.ftype});
    out.push({id: s.id, title: s.title, active: !!s.active, locked: isLocked(s), lockText: isLocked(s) ? lockWhen(s) : '', items: its});
  }
  return TA({sets: out});
}
async function taRAct(env, u, op, b, form) {
  if (op === 'r_newset') { const t = String(b.title || '').trim().slice(0, 80); if (t.length < 2) return TE("Toʻplam nomini yozing"); await env.DB.prepare('INSERT INTO rsets (title, active, created) VALUES (?, 1, ?)').bind(t, Date.now()).run(); }
  if (op === 'r_toggle') await env.DB.prepare('UPDATE rsets SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?').bind(Number(b.id)).run();
  if (op === 'r_del') await env.DB.batch([env.DB.prepare('DELETE FROM ritems WHERE set_id = ?').bind(Number(b.id)), env.DB.prepare('DELETE FROM rsets WHERE id = ?').bind(Number(b.id))]);
  if (op === 'r_itemdel') await env.DB.prepare('DELETE FROM ritems WHERE id = ?').bind(Number(b.id)).run();
  if (op === 'r_lock') {
    let at;
    if (b.mode === 'n') at = null; else if (b.mode === 'm') at = FOREVER;
    else if (b.mode === 'at') { at = Number(b.at); if (!(at > Date.now())) return TE('Kelajakdagi vaqtni tanlang'); }
    else { const h = Number(b.mode); if (!(h > 0 && h <= 24 * 60)) return TE('Notoʻgʻri'); at = Date.now() + h * 3600e3; }
    await env.DB.prepare('UPDATE rsets SET open_at = ? WHERE id = ?').bind(at, Number(b.id)).run();
  }
  if (op === 'r_item') {
    const setid = Number(form.get('setid')); const label = String(form.get('label') || '').trim().slice(0, 40); const csv = String(form.get('csv') || '').trim().slice(0, 300);
    const file = form.get('file');
    if (!label) return TE('Tugma nomini yozing (masalan: 3-sinf)');
    if (!file || typeof file === 'string') return TE('Natija faylini (PDF yoki rasm) tanlang');
    if (csv && !/^https:\/\//.test(csv)) return TE('CSV havolasi https:// bilan boshlanishi kerak');
    const st = await env.DB.prepare('SELECT title FROM rsets WHERE id = ?').bind(setid).first(); if (!st) return TE('Toʻplam topilmadi');
    const up = await tbUpload(env, u.id, file, `🏆 ${st.title} — ${label} (ilovadan saqlandi)`);
    if (!up) return TE('Faylni yuklab boʻlmadi', 502);
    await env.DB.prepare('INSERT INTO ritems (set_id, label, ftype, fid, csv, created) VALUES (?, ?, ?, ?, ?, ?)').bind(setid, label, up.type, up.id, csv, Date.now()).run();
  }
  return taRSets(env);
}
// ---------- varonka va kurslar (admin) ----------
const leadObj = (l) => ({id: l.id, course: l.ctitle, student: l.student && l.student !== 'Oʻzi' ? l.student : (l.name || '—'), account: l.name, phone: l.phone ? fullPhone(l.phone) : '', tel: l.phone ? '+998' + l.phone : '', subject: l.subject || '', shift: l.shift || '', grade: l.grade || '', voucher: l.vaucher || '', stage: l.stage, stageText: STAGES[l.stage] || l.stage, assigned: l.aname || '', username: l.username || '', user: l.user_id, at: l.created});
async function taFunnel(env) {
  const rows = (await env.DB.prepare('SELECT stage, COUNT(*) AS c FROM leads GROUP BY stage').all()).results || [];
  const cnt = {}; rows.forEach((r) => { cnt[r.stage] = r.c; });
  const total = rows.reduce((s, r) => s + r.c, 0);
  const week = (await env.DB.prepare('SELECT COUNT(*) AS c FROM leads WHERE created > ?').bind(Date.now() - 7 * 864e5).first()).c;
  const stale = (await env.DB.prepare("SELECT COUNT(*) AS c FROM leads WHERE stage = 'new' AND assigned IS NULL AND created < ?").bind(Date.now() - 30 * 60e3).first()).c;
  const byCourse = (await env.DB.prepare("SELECT ctitle, COUNT(*) AS c, SUM(stage = 'paid') AS paid FROM leads GROUP BY ctitle ORDER BY c DESC LIMIT 8").all()).results || [];
  return TA({total, week, stale, stages: STAGE_KEYS.map((s) => ({key: s, title: STAGES[s], n: cnt[s] || 0})), byCourse, sheets: `${WORKER_URL}/leads.csv?s=${await xsign(env, 'LEADS')}`});
}
async function taLeads(env, b) {
  const st = STAGE_KEYS.includes(b.stage) ? b.stage : 'new';
  const rows = (await env.DB.prepare('SELECT * FROM leads WHERE stage = ? ORDER BY created DESC LIMIT 40').bind(st).all()).results || [];
  return TA({leads: rows.map(leadObj)});
}
async function taLeadAct(env, u, b) {
  let l = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(Number(b.id)).first();
  if (!l) return TE('Ariza topilmadi', 404);
  if (b.assign) {
    const r = await env.DB.prepare('UPDATE leads SET assigned = ?, aname = ?, updated = ? WHERE id = ? AND assigned IS NULL').bind(u.id, u.name || 'Admin', Date.now(), l.id).run();
    if (!(r.meta && r.meta.changes)) return TE('Boshqa admin allaqachon oldi');
  } else if (b.stage) {
    if (!STAGE_KEYS.includes(b.stage)) return TE('Xato');
    await env.DB.prepare('UPDATE leads SET stage = ?, updated = ?, assigned = COALESCE(assigned, ?), aname = COALESCE(aname, ?) WHERE id = ?').bind(b.stage, Date.now(), u.id, u.name || 'Admin', l.id).run();
    if (STAGE_NOTE[b.stage]) await send(env, l.user_id, STAGE_NOTE[b.stage]).catch(() => {});
  }
  l = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(l.id).first();
  return TA({lead: leadObj(l)});
}
async function taCAdmin(env, op, b) {
  if (op === 'c_add') {
    const title = String(b.title || '').trim().slice(0, 80); if (title.length < 2) return TE('Kurs nomini yozing');
    await env.DB.prepare('INSERT INTO courses (title, price, info, active, created) VALUES (?, ?, ?, 1, ?)').bind(title, String(b.price || '').slice(0, 60), String(b.info || '').slice(0, 400), Date.now()).run();
  }
  if (op === 'c_toggle') await env.DB.prepare('UPDATE courses SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?').bind(Number(b.id)).run();
  if (op === 'c_del') await env.DB.prepare('DELETE FROM courses WHERE id = ?').bind(Number(b.id)).run();
  const cs = (await env.DB.prepare('SELECT c.id, c.title, c.price, c.info, c.active, (SELECT COUNT(*) FROM leads l WHERE l.course_id = c.id) AS n FROM courses c ORDER BY c.id').all()).results || [];
  return TA({courses: cs.map((c) => ({id: c.id, title: c.title, price: c.price || '', info: c.info || '', active: !!c.active, n: c.n}))});
}
async function taStats(env) {
  const q = async (sql) => (await env.DB.prepare(sql).first()).c;
  const [all, stu, tea, ph, tests, res, mon, ob, leads, paid] = await Promise.all([
    q('SELECT COUNT(*) c FROM users'), q("SELECT COUNT(*) c FROM users WHERE role = 'student'"), q("SELECT COUNT(*) c FROM users WHERE role != 'student'"),
    q("SELECT COUNT(*) c FROM users WHERE phone IS NOT NULL AND phone != ''"), q('SELECT COUNT(*) c FROM tests'), q('SELECT COUNT(*) c FROM results'),
    q('SELECT COUNT(DISTINCT grp || student) c FROM monthly'), q('SELECT COUNT(*) c FROM outbox'), q('SELECT COUNT(*) c FROM leads'), q("SELECT COUNT(*) c FROM leads WHERE stage = 'paid'")]);
  const week = (await env.DB.prepare('SELECT COUNT(*) AS c FROM results WHERE created > ?').bind(Date.now() - 7 * 864e5).first()).c;
  return TA({users: all, students: stu, staff: tea, phones: ph, tests, results: res, week, monthly: mon, outbox: ob, leads, paid});
}
// ---------- xabar tarqatish ----------
async function taBGroups(env) {
  const gs = (await env.DB.prepare('SELECT grp, COUNT(DISTINCT student) AS n FROM monthly GROUP BY grp ORDER BY grp LIMIT 60').all()).results || [];
  const c = async (w) => (await env.DB.prepare(`SELECT COUNT(*) c FROM users ${w}`).first()).c;
  return TA({groups: gs, counts: {all: await c('WHERE COALESCE(blocked, 0) = 0'), stu: await c("WHERE COALESCE(blocked, 0) = 0 AND role = 'student'"), tea: await c("WHERE COALESCE(blocked, 0) = 0 AND role != 'student'")}});
}
async function taBSend(env, u, form, b) {
  const get = (k) => form ? form.get(k) : b[k];
  const txt = String(get('text') || '').trim().slice(0, 3500);
  const target = String(get('target') || ''); const grp = String(get('grp') || '');
  const file = form ? form.get('file') : null;
  if (!txt && !(file && typeof file !== 'string')) return TE('Xabar matnini yozing yoki rasm tanlang');
  if (!['all', 'stu', 'tea', 'grp'].includes(target)) return TE('Kimga yuborishni tanlang');
  let payload, kind;
  if (file && typeof file !== 'string') {
    const up = await tbUpload(env, u.id, file, txt.slice(0, 1000));
    if (!up) return TE('Rasmni yuklab boʻlmadi', 502);
    kind = 'copy'; payload = JSON.stringify({from: u.id, mid: up.mid});
  } else { kind = 'text'; payload = JSON.stringify({text: esc(txt)}); }
  const ins = await env.DB.prepare('INSERT INTO broadcasts (admin, target, total, created) VALUES (?, ?, 0, ?)').bind(u.id, target, Date.now()).run();
  const bid = ins.meta && ins.meta.last_row_id; let r;
  if (target === 'grp') {
    if (!grp) return TE('Guruhni tanlang');
    r = await env.DB.prepare("INSERT INTO outbox (chat, kind, payload, bid) SELECT DISTINCT u.id, ?, ?, ? FROM users u JOIN monthly m ON (u.phone = m.phone1 OR u.phone = m.phone2) WHERE m.grp = ? AND u.phone IS NOT NULL AND u.phone != '' AND COALESCE(u.blocked, 0) = 0").bind(kind, payload, bid, grp).run();
  } else {
    const where = target === 'stu' ? "WHERE COALESCE(blocked, 0) = 0 AND role = 'student'" : target === 'tea' ? "WHERE COALESCE(blocked, 0) = 0 AND role != 'student'" : 'WHERE COALESCE(blocked, 0) = 0';
    r = await env.DB.prepare(`INSERT INTO outbox (chat, kind, payload, bid) SELECT id, ?, ?, ? FROM users ${where}`).bind(kind, payload, bid).run();
  }
  const total = (r.meta && r.meta.changes) || 0;
  await env.DB.prepare('UPDATE broadcasts SET total = ?, done = ? WHERE id = ?').bind(total, total ? 0 : 1, bid).run();
  return TA({ok: true, total, minutes: Math.max(1, Math.ceil(total / PER_RUN))});
}
// ---------- xodimlar ----------
async function taStaff(env, u, op, b) {
  if (op === 'iv_new') {
    const nm = String(b.name || '').trim().slice(0, 40); const role = b.role === 'admin' ? 'admin' : 'teacher';
    if (nm.length < 2) return TE('Xodim ismini yozing');
    const code = await newInvite(env);
    await env.DB.prepare('INSERT INTO invites (code, name, role, created) VALUES (?, ?, ?, ?)').bind(code, nm, role, Date.now()).run();
  }
  if (op === 's_role') {
    const t = await env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(Number(b.id)).first();
    if (!t || t.role === 'ceo' || t.id === u.id || !['admin', 'teacher', 'student'].includes(b.role)) return TE('Mumkin emas');
    await env.DB.prepare("UPDATE users SET role = ?, state = 'idle', data = NULL WHERE id = ?").bind(b.role, t.id).run();
    await send(env, t.id, `ℹ️ Sizning rolingiz oʻzgardi: ${ROLE_NAME[b.role]}. Menyu yangilandi 👇`, menuKb({role: b.role})).catch(() => {});
  }
  const inv = (await env.DB.prepare('SELECT code, name, used_by, role, created FROM invites ORDER BY created DESC LIMIT 20').all()).results || [];
  const st = (await env.DB.prepare("SELECT id, name, role, phone FROM users WHERE role != 'student' ORDER BY CASE role WHEN 'ceo' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, name LIMIT 80").all()).results || [];
  return TA({invites: inv.map((i) => ({code: i.code, name: i.name, role: i.role, used: !!i.used_by})), staff: st.map((s) => ({id: s.id, name: s.name || String(s.id), role: s.role, phone: s.phone ? fullPhone(s.phone) : '', me: s.id === u.id}))});
}
// ---------- router ----------
async function tbApi(request, url, env) {
  const op = url.pathname.slice('/app/api/'.length);
  const multipart = /multipart\/form-data/i.test(request.headers.get('content-type') || '');
  const form = multipart ? await request.formData().catch(() => null) : null;
  const b = form ? {} : await request.json().catch(() => ({}));
  const tgu = await tgInitUser(env, form ? form.get('initData') : b.initData);
  if (!tgu) return TE('Ilovani botdan qayta oching', 403);
  await ensureDb(env);
  const u = await tbUser(env, tgu);
  if (u.blocked) await env.DB.prepare('UPDATE users SET blocked = 0 WHERE id = ?').bind(u.id).run();
  if (op === 'me') {
    const sub = await subOk(env, u);
    const code = await vzLink(env, u);
    return TA({id: u.id, name: u.name || '', tgName: [tgu.first_name, tgu.last_name].filter(Boolean).join(' '), role: u.role, roleName: ROLE_NAME[u.role] || '', phone: u.phone ? showPhone(u.phone) : '', perms: permsOf(u), teacher: isTeacher(u), sub, subUrl: SUB_URL, linked: !!code, baho: BAHO_URL});
  }
  if (op === 'sub_check') { SUBC.delete(u.id); return TA({sub: await subOk(env, u)}); }
  if (!(await subOk(env, u))) return TE('sub', 451);
  if (op === 'set_name') {
    const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (name.length < 3 || !/\p{L}/u.test(name)) return TE('Ism va familiyangizni harflar bilan yozing');
    await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, u.id).run();
    return TA({ok: true, name});
  }
  if (op === 'set_phone') {
    const p = phone9(b.phone); if (!p) return TE('Telefon raqam notoʻgʻri');
    await env.DB.prepare('UPDATE users SET phone = ? WHERE id = ?').bind(p, u.id).run();
    const found = await env.DB.prepare('SELECT COUNT(DISTINCT student) AS c FROM monthly WHERE phone1 = ? OR phone2 = ?').bind(p, p).first();
    return TA({ok: true, phone: showPhone(p), monthly: !!(found && found.c)});
  }
  if (op === 't_open') return taTestOpen(env, u, b);
  if (op === 't_submit') return taTestSubmit(env, u, b);
  if (op === 't_mine') return taMine(env, u);
  if (op === 't_reveal') return taReveal(env, u, b);
  if (op === 'olymp') return taOlymp(env, u);
  if (op === 'o_find') return taOlympFind(env, u, b);
  if (op === 'vused') return taVused(env, u, b);
  if (op === 'courses') return taCourses(env, u);
  if (op === 'lead') return taLead(env, u, b, tgu.username);
  if (op === 'shop') return taShop(env, u);
  if (op === 's_order') return taShopOrder(env, u, b, false);
  if (op === 's_cancel') return taShopOrder(env, u, b, true);
  // ustoz
  if (op.startsWith('tt_')) {
    if (!isTeacher(u)) return TE('Faqat ustozlar uchun', 403);
    if (op === 'tt_list') return taTTList(env, u);
    if (op === 'tt_get') return taTTGet(env, u, b);
    if (op === 'tt_new' && form) return taTTNew(env, u, form);
    if (op === 'tt_set') return taTTSet(env, u, b);
    if (op === 'tt_export') return taTTExport(env, u, b);
    if (op === 'tt_del') return taTTDel(env, u, b);
  }
  if (op === 'monthly_groups') { if (!can(u, 'monthly')) return TE('Ruxsat yoʻq', 403); return taMonthlyGroups(env); }
  if (op.startsWith('r_')) {
    if (!can(u, 'results')) return TE('Ruxsat yoʻq', 403);
    if (op === 'r_sets') return taRSets(env);
    return taRAct(env, u, op, b, form);
  }
  if (op === 'f_sum' || op === 'f_list' || op === 'f_act') {
    if (!can(u, 'funnel')) return TE('Ruxsat yoʻq', 403);
    if (op === 'f_sum') return taFunnel(env);
    if (op === 'f_list') return taLeads(env, b);
    return taLeadAct(env, u, b);
  }
  if (op.startsWith('c_')) { if (!can(u, 'courses')) return TE('Ruxsat yoʻq', 403); return taCAdmin(env, op, b); }
  if (op === 'stats') { if (!can(u, 'stats')) return TE('Ruxsat yoʻq', 403); return taStats(env); }
  if (op === 'b_groups' || op === 'b_send') {
    if (!can(u, 'bcast')) return TE('Ruxsat yoʻq', 403);
    return op === 'b_groups' ? taBGroups(env) : taBSend(env, u, form, b);
  }
  if (op === 'iv_new' || op === 's_role' || op === 'staff') {
    if (!can(u, op === 'iv_new' ? 'invite' : 'staff') && !(op === 'staff' && can(u, 'invite'))) return TE('Ruxsat yoʻq', 403);
    return taStaff(env, u, op, b);
  }
  return TE('Nomaʼlum soʻrov', 404);
}
async function tbRoute(request, url, env) {
  const p = url.pathname;
  if (request.method === 'GET' && (p === '/app' || p === '/app/')) return new Response(TB_HTML, {headers: {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'}});
  if (request.method === 'GET' && p === '/app/f') return tbFile(env, url);
  if (request.method === 'POST' && p.startsWith('/app/api/')) return tbApi(request, url, env);
  return null;
}

const TB_HTML = "<!DOCTYPE html>\n<html lang=\"uz\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover\">\n<title>Ilmzor</title>\n<script src=\"https://telegram.org/js/telegram-web-app.js\"></script>\n<style>\n@font-face{font-family:Satoshi;src:url(/fonts/Satoshi-Medium.woff2) format('woff2');font-weight:500}\n@font-face{font-family:Satoshi;src:url(/fonts/Satoshi-Bold.woff2) format('woff2');font-weight:700}\n@font-face{font-family:Satoshi;src:url(/fonts/Satoshi-Black.woff2) format('woff2');font-weight:900}\n:root{--navy:#0e223a;--navy2:#1b3a5c;--aqua:#4ad496;--bg:#f2f5f8;--card:#fff;--ink:#0e223a;--ink2:#5a6a80;--line:#e3e8ef;--ok:#13804b;--bad:#c0392b;--warn:#a15c00}\n*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}\nhtml,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 Satoshi,-apple-system,system-ui,sans-serif}\nbutton,input,select,textarea{font:inherit}\nbutton{cursor:pointer}\nheader{background:var(--navy);color:#fff;padding:12px 16px;position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:10px}\nheader img{height:30px}\nheader .t{flex:1;min-width:0}\nheader .t b{display:block;font-size:17px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\nheader .t small{color:var(--aqua);font-weight:700}\nheader .home{border:0;background:rgba(255,255,255,.12);color:#fff;border-radius:10px;padding:7px 10px;font-weight:700}\nmain{padding:14px 12px 100px;max-width:720px;margin:0 auto}\n.card{background:var(--card);border-radius:16px;padding:14px;box-shadow:0 2px 10px rgba(14,34,58,.07);margin-bottom:12px}\nh2{font-size:19px;margin:0 0 10px;font-weight:900}\nh3{font-size:16px;margin:0 0 8px;font-weight:800}\n.muted{color:var(--ink2);font-size:13px}\n.hello{background:linear-gradient(135deg,var(--navy),var(--navy2));color:#fff}\n.hello .r{display:inline-block;background:rgba(74,212,150,.18);color:var(--aqua);border-radius:8px;padding:2px 8px;font-weight:800;font-size:12px;margin-top:6px}\n.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}\n.tile{border:0;background:var(--card);border-radius:14px;padding:14px 6px;box-shadow:0 2px 8px rgba(14,34,58,.06);display:flex;flex-direction:column;align-items:center;gap:6px;color:var(--ink);font-weight:700;font-size:13px;text-align:center;line-height:1.2}\n.tile i{font-style:normal;font-size:26px}\n.sec{font-weight:900;color:var(--ink2);font-size:12px;text-transform:uppercase;letter-spacing:.5px;margin:18px 4px 8px}\nlabel{display:block;font-weight:800;font-size:13px;margin:12px 0 5px}\ninput,select,textarea{width:100%;border:1.5px solid var(--line);border-radius:11px;padding:11px 12px;background:#fff;color:var(--ink);outline:0}\ninput:focus,select:focus,textarea:focus{border-color:var(--navy2)}\ntextarea{min-height:80px;resize:vertical}\n.btn{border:0;border-radius:12px;padding:12px 14px;background:var(--navy);color:#fff;font-weight:800;width:100%}\n.btn.aq{background:var(--aqua);color:var(--navy)}\n.btn.soft{background:#e9eef5;color:var(--navy)}\n.btn.bad{background:#fdeaea;color:var(--bad)}\n.btn:disabled{opacity:.55}\n.row{display:flex;gap:8px;flex-wrap:wrap}\n.row>*{flex:1}\n.chips{display:flex;flex-wrap:wrap;gap:6px}\n.chip{border:0;border-radius:10px;padding:8px 11px;background:#e9eef5;color:var(--navy);font-weight:700;font-size:13px}\n.chip.on{background:var(--navy);color:#fff}\n.err{color:var(--bad);font-size:13px;margin-top:6px;min-height:1em;white-space:pre-line}\n.big{font-size:44px;font-weight:900;text-align:center;letter-spacing:3px}\n.li{display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid var(--line);width:100%;border-left:0;border-right:0;border-top:0;background:none;text-align:left;color:var(--ink)}\n.li:last-child{border-bottom:0}\n.li .tx{flex:1;min-width:0}\n.li .tx b{display:block;font-weight:800}\n.li .tx small{color:var(--ink2)}\n.pc{min-width:52px;text-align:center;border-radius:10px;padding:6px 4px;font-weight:900;color:#fff}\n.q{display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid var(--line)}\n.q:last-child{border-bottom:0}\n.q .n{width:34px;font-weight:900;color:var(--ink2)}\n.q button{flex:1;max-width:50px;height:40px;border-radius:10px;border:1.5px solid var(--line);background:#fff;font-weight:900;color:var(--navy)}\n.q button.on{background:var(--navy);border-color:var(--navy);color:#fff}\n.q button.good{background:#e3f6ec;border-color:var(--ok);color:var(--ok)}\n.q button.badc{background:#fdeaea;border-color:var(--bad);color:var(--bad)}\n.files img{width:100%;border-radius:10px;margin-bottom:8px;display:block}\n.kgrid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}\n.kgrid span{background:#f2f5f8;border-radius:8px;padding:6px 0;text-align:center;font-weight:800;font-size:13px}\n.bar2{position:fixed;left:0;right:0;bottom:0;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:linear-gradient(transparent,var(--bg) 35%);z-index:6}\n.bar2 .in{max-width:720px;margin:0 auto}\n.bar2 .btn{box-shadow:0 4px 14px rgba(14,34,58,.25);padding:14px}\n.sgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}\n.si{background:var(--card);border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(14,34,58,.06);display:flex;flex-direction:column}\n.si .im{aspect-ratio:1;background:#e9eef5;display:flex;align-items:center;justify-content:center;font-size:36px}\n.si .im img{width:100%;height:100%;object-fit:cover}\n.si .b{padding:10px;display:flex;flex-direction:column;gap:6px;flex:1}\n.stat{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}\n.stat div{background:var(--card);border-radius:14px;padding:12px;box-shadow:0 2px 8px rgba(14,34,58,.06)}\n.stat b{display:block;font-size:24px;font-weight:900}\n.stat small{color:var(--ink2);font-weight:700}\n.prog{height:8px;background:#e9eef5;border-radius:4px;overflow:hidden;margin-top:4px}\n.prog i{display:block;height:100%;background:var(--aqua)}\n.tag{display:inline-block;border-radius:8px;padding:2px 8px;font-size:12px;font-weight:800;background:#e9eef5;color:var(--navy)}\n.tag.g{background:#e3f6ec;color:var(--ok)}.tag.r{background:#fdeaea;color:var(--bad)}.tag.y{background:#fff4d6;color:var(--warn)}\niframe.vz{width:100%;border:0;height:calc(100vh - 70px);display:block;border-radius:0}\n.toast{position:fixed;left:50%;top:12px;transform:translateX(-50%);background:var(--navy);color:#fff;padding:10px 16px;border-radius:12px;z-index:50;font-weight:800;max-width:90%;text-align:center}\n.load{text-align:center;color:var(--ink2);padding:50px 0}\n.empty{text-align:center;color:var(--ink2);padding:24px 10px}\na{color:var(--navy2)}\n</style>\n</head>\n<body>\n<header><img src=\"/brand/logo-gorizontal.png\" alt=\"ilmzor\"><div class=\"t\"><b id=\"ht\">Ilmzor</b><small id=\"hs\"></small></div><button class=\"home\" id=\"hbtn\" hidden>🏠</button></header>\n<main id=\"app\"><div class=\"load\">Yuklanmoqda…</div></main>\n<div class=\"bar2\" id=\"bar\" hidden></div>\n<script>\n(function(){\nvar W=window.Telegram&&Telegram.WebApp,ID=W&&W.initData||'';\ntry{W.ready();W.expand();W.setHeaderColor('#0e223a');W.setBackgroundColor('#f2f5f8');W.disableVerticalSwipes&&W.disableVerticalSwipes();}catch(e){}\nvar $=function(i){return document.getElementById(i);};\nvar esc=function(s){return String(s==null?'':s).replace(/[&<>\"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c];});};\nvar pcol=function(p){return 'hsl('+Math.round(Math.max(0,Math.min(100,p))*1.2)+',62%,'+(p>=50?38:44)+'%)';};\nvar fdt=function(ms){var d=new Date(ms);return d.getDate()+'.'+String(d.getMonth()+1).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');};\nvar som=function(n){return String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g,' ');};\nfunction hap(t){try{t==='ok'?W.HapticFeedback.notificationOccurred('success'):t==='err'?W.HapticFeedback.notificationOccurred('error'):W.HapticFeedback.impactOccurred('light');}catch(e){}}\nfunction say(m){try{W.showAlert(m);}catch(e){alert(m);}}\nfunction ask(m,cb){try{W.showConfirm(m,function(y){if(y)cb();});}catch(e){if(confirm(m))cb();}}\nfunction toast(m){var b=document.createElement('div');b.className='toast';b.textContent=m;document.body.appendChild(b);setTimeout(function(){b.remove();},2300);}\nfunction api(op,b){b=b||{};b.initData=ID;return fetch('/app/api/'+op,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().then(function(j){if(!r.ok){var e=new Error(j.error||'Xatolik');e.status=r.status;throw e;}return j;});});}\nfunction upl(op,fields,files){var fd=new FormData();fd.append('initData',ID);Object.keys(fields).forEach(function(k){fd.append(k,fields[k]);});(files||[]).forEach(function(f){fd.append(f[0],f[1]);});\n  return fetch('/app/api/'+op,{method:'POST',body:fd}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Xatolik');return j;});});}\nfunction openUrl(u){var a=/^https?:/.test(u)?u:location.origin+u;try{W.openLink(a);}catch(e){window.open(a,'_blank');}}\nfunction copy(t){try{navigator.clipboard.writeText(t);toast('📋 Nusxalandi');}catch(e){say(t);}}\nfunction phoneReq(cb){try{W.requestContact(function(ok,res){if(!ok){cb(null);return;}var p=res&&res.responseUnsafe&&res.responseUnsafe.contact&&res.responseUnsafe.contact.phone_number;cb(p||null);});}catch(e){var p=prompt('Telefon raqamingiz (+998 …)');cb(p);}}\n\nvar S={me:null,view:'home',stack:[],d:{}};\nvar can=function(p){return S.me&&S.me.perms.indexOf(p)>=0;};\nvar VIEWS={};\nfunction go(v,push){if(push!==false&&S.view!==v)S.stack.push(S.view);S.view=v;window.scrollTo(0,0);render();}\nfunction back(){var v=S.stack.pop()||'home';S.view=v;render();}\nfunction bar(h){var b=$('bar');if(h){b.hidden=false;b.innerHTML='<div class=\"in\">'+h+'</div>';}else{b.hidden=true;b.innerHTML='';}}\nfunction render(){var v=VIEWS[S.view]||VIEWS.home;bar('');$('app').style.padding=S.view==='vaz'?'0':'';var r=v();$('app').innerHTML=typeof r==='string'?r:'';\n  $('hbtn').hidden=S.view==='home'||S.view==='name'||S.view==='sub';\n  try{if(S.view==='home'||S.view==='name'||S.view==='sub')W.BackButton.hide();else W.BackButton.show();}catch(e){}\n  if(v.after)v.after();}\nfunction load(key,op,b,force){if(S.d[key]&&!force)return S.d[key];S.d[key]=null;api(op,b).then(function(j){S.d[key]=j;render();}).catch(function(e){S.d[key]={error:e.message};render();});return null;}\nfunction errBox(j){return j&&j.error?'<div class=\"card empty\">⚠️ '+esc(j.error)+'</div>':'';}\nfunction L(){return '<div class=\"load\">Yuklanmoqda…</div>';}\n\n// ---------- bosh sahifa\nvar TILES=[\n  ['test','✍️','Test topshirish'],['mine','📊','Natijalarim'],['vaz','📝','Vazifalar va reyting'],['shop','🛍','Ilmzor puli do‘koni'],\n  ['olymp','🏆','Olimpiada natijalari'],['courses','🎓','Kurslarga yozilish'],['profile','👤','Profil']];\nvar STAFF=[\n  ['tt','📚','Testlarim','tests'],['tt_new','➕','Yangi test','tests'],['mgroups','🗓','Oylik natijalar','monthly'],['radm','🏆','Natijalar (admin)','results'],\n  ['funnel','📊','Sotuv varonkasi','funnel'],['cadm','🎓','Kurslar (admin)','courses'],['bcast','📢','Xabar yuborish','bcast'],['stats','📈','Statistika','stats'],['staff','👥','Xodimlar va kodlar','invite']];\nVIEWS.home=function(){var m=S.me;var st=STAFF.filter(function(t){return can(t[3]);});\n  return '<div class=\"card hello\"><div style=\"font-size:13px;opacity:.8\">Assalomu alaykum</div><div style=\"font-size:21px;font-weight:900\">'+esc(m.name||m.tgName)+'</div><span class=\"r\">'+esc(m.roleName)+'</span></div>'+\n  (st.length?'<div class=\"sec\">Ish joyi</div><div class=\"tiles\">'+st.map(function(t){return '<button class=\"tile\" data-go=\"'+t[0]+'\"><i>'+t[1]+'</i>'+t[2]+'</button>';}).join('')+'</div><div class=\"sec\">Oʻquvchi boʻlimlari</div>':'')+\n  '<div class=\"tiles\">'+TILES.map(function(t){return '<button class=\"tile\" data-go=\"'+t[0]+'\"><i>'+t[1]+'</i>'+t[2]+'</button>';}).join('')+'</div>'+\n  '<p class=\"muted\" style=\"text-align:center;margin-top:18px\">🌱 Ilmzor — bilim bogʻingiz</p>';};\nVIEWS.name=function(){return '<div class=\"card\"><h2>👋 Xush kelibsiz!</h2><p class=\"muted\">Ustozlar natijangizni taniy olishi uchun <b>ism va familiyangizni</b> yozing.</p><input id=\"nm\" placeholder=\"Masalan: Ali Valiyev\" value=\"'+esc(S.me.tgName||'')+'\"><div class=\"err\" id=\"er\"></div><br><button class=\"btn\" id=\"nmok\">Saqlash</button></div>';};\nVIEWS.sub=function(){return '<div class=\"card\" style=\"text-align:center\"><div style=\"font-size:48px\">📢</div><h2>Kanalga obuna boʻling</h2><p class=\"muted\">Ilovadan foydalanish uchun <b>Ilmzor oʻquv markazi</b> kanaliga obuna boʻling — eʼlonlar, natijalar va foydali materiallar shu yerda.</p><button class=\"btn aq\" id=\"subgo\">📢 Kanalga oʻtish</button><br><br><button class=\"btn\" id=\"subchk\">✅ Obuna boʻldim</button></div>';};\n\n// ---------- test topshirish\nVIEWS.test=function(){var T=S.d.T;\n  if(!T)return '<div class=\"card\"><h2>✍️ Test topshirish</h2><p class=\"muted\">Ustozingiz bergan <b>4 belgili test kodini</b> yozing.</p><input id=\"tcode\" maxlength=\"4\" placeholder=\"A7K3\" style=\"text-transform:uppercase;font-size:24px;text-align:center;letter-spacing:6px;font-weight:900\" autocomplete=\"off\"><div class=\"err\" id=\"er\"></div><br><button class=\"btn\" id=\"topen\">Testni ochish</button></div>';\n  if(T.done)return '<div class=\"card\" style=\"text-align:center\"><h2>'+esc(T.title)+'</h2><p>Siz bu testni topshirgansiz:</p><div class=\"big\" style=\"color:'+pcol(T.done.pct)+'\">'+T.done.pct+'%</div><p><b>'+T.done.ok+' / '+T.done.n+'</b></p>'+(T.canReveal?'<button class=\"btn\" data-rev=\"'+T.code+'\">📋 Javoblar va reyting</button>':'<p class=\"muted\">Test yopilgach toʻgʻri javoblar va reyting koʻrinadi.</p>')+'<br><br><button class=\"btn soft\" id=\"tnew\">Boshqa test</button></div>';\n  if(T.result){var R=T.result;return '<div class=\"card\" style=\"text-align:center\"><div style=\"font-size:44px\">'+(R.pct>=90?'🏆':R.pct>=70?'👏':R.pct>=50?'🙂':'📚')+'</div><h2>Natijangiz</h2><div class=\"big\" style=\"color:'+pcol(R.pct)+'\">'+R.pct+'%</div><p><b>'+R.ok+' / '+R.n+'</b> · '+esc(R.title)+'</p>'+(R.wrong.length?'<p class=\"muted\">❌ Xato savollar: '+R.wrong.join(', ')+'</p>':'<p>✅ Hammasi toʻgʻri! Barakalla!</p>')+'<p class=\"muted\">Test yopilgach toʻgʻri javoblar va reytingni «📊 Natijalarim»da koʻrasiz.</p><button class=\"btn soft\" id=\"tnew\">Boshqa test</button></div>';}\n  var n=T.n,A=T.ans,L=['A','B','C','D'];var h='<div class=\"card\"><h2>'+esc(T.title)+'</h2><div class=\"muted\">'+n+' ta savol'+(T.deadline?' · ⏰ muddat: <b>'+fdt(T.deadline)+'</b>':'')+'</div></div>';\n  if(T.files.length)h+='<div class=\"card files\"><h3>📄 Test</h3>'+T.files.map(function(f,i){return f.type==='photo'?'<img src=\"'+f.url+'\" alt=\"\">':'<button class=\"btn soft\" style=\"margin-bottom:8px\" data-open=\"'+esc(f.url)+'\">📄 PDF faylni ochish ('+(i+1)+')</button>';}).join('')+'</div>';\n  h+='<div class=\"card\"><h3>✍️ Javob varagʻi</h3><p class=\"muted\" style=\"margin-top:0\">Har bir savolga javobni belgilang. Javob faqat bir marta qabul qilinadi.</p>';\n  for(var i=0;i<n;i++)h+='<div class=\"q\"><span class=\"n\">'+(i+1)+'.</span>'+L.map(function(l){return '<button class=\"'+(A[i]===l.toLowerCase()?'on':'')+'\" data-ans=\"'+i+':'+l.toLowerCase()+'\">'+l+'</button>';}).join('')+'</div>';\n  h+='</div>';var cnt=A.filter(Boolean).length;\n  setTimeout(function(){bar('<button class=\"btn aq\" id=\"tsub\" '+(cnt===n?'':'disabled')+'>✅ Yuborish · '+cnt+' / '+n+'</button>');},0);\n  return h;};\n\n// ---------- natijalarim\nVIEWS.mine=function(){var j=load('mine','t_mine');if(!j)return L();if(j.error)return errBox(j);\n  if(!j.results.length)return '<div class=\"card empty\">Hali test topshirmagansiz.<br><br><button class=\"btn\" data-go=\"test\">✍️ Test topshirish</button></div>';\n  var avg=Math.round(j.results.reduce(function(s,r){return s+r.pct;},0)/j.results.length);\n  return '<div class=\"card\"><h2>📊 Natijalarim</h2><div class=\"muted\">Oʻrtacha: <b>'+avg+'%</b> · '+j.results.length+' ta test</div><div class=\"prog\"><i style=\"width:'+avg+'%\"></i></div></div><div class=\"card\">'+\n  j.results.map(function(r){return '<button class=\"li\" '+(r.reveal?'data-rev=\"'+r.code+'\"':'')+'><span class=\"pc\" style=\"background:'+pcol(r.pct)+'\">'+r.pct+'%</span><span class=\"tx\"><b>'+esc(r.title)+'</b><small>'+r.code+' · '+r.ok+'/'+r.n+' · '+fdt(r.at)+(r.reveal?' · 📋 javoblar':'')+'</small></span></button>';}).join('')+'</div>';};\nVIEWS.reveal=function(){var j=S.d.rev;if(!j)return L();if(j.error)return errBox(j);\n  var h='<div class=\"card\"><h2>📋 '+esc(j.title)+'</h2><div class=\"muted\">'+j.code+' · '+j.count+' kishi · oʻrtacha <b>'+j.avg+'%</b></div></div>';\n  if(j.me)h+='<div class=\"card\" style=\"text-align:center\"><div class=\"muted\">Sizning natijangiz</div><div class=\"big\" style=\"color:'+pcol(j.me.pct)+'\">'+j.me.pct+'%</div><b>'+j.me.rank+'-oʻrin</b> ('+j.count+' kishidan) · '+j.me.ok+'/'+j.me.n+'</div>';\n  h+='<div class=\"card\"><h3>🏆 Reyting</h3>'+j.top.map(function(r,i){return '<div class=\"li\"><span style=\"width:30px;font-size:18px\">'+['🥇','🥈','🥉','4.','5.'][i]+'</span><span class=\"tx\"><b>'+esc(r.name)+'</b></span><b>'+r.pct+'%</b></div>';}).join('')+'</div>';\n  h+='<div class=\"card\"><h3>🔑 Javoblar'+(j.me?' va xatolaringiz':'')+'</h3><div class=\"kgrid\">'+j.key.split('').map(function(k,i){var a=j.me?j.me.answers[i]:null;var ok=!j.me||a===k;return '<span style=\"'+(ok?'':'background:#fdeaea;color:var(--bad)')+'\">'+(i+1)+'. '+k.toUpperCase()+(ok||!a||a==='-'?'':' <s>'+a.toUpperCase()+'</s>')+'</span>';}).join('')+'</div></div>';\n  return h;};\n\n// ---------- vazifalar (oʻquvchi sahifasi)\nVIEWS.vaz=function(){return '<iframe class=\"vz\" src=\"/app/men\"></iframe>';};\n\n// ---------- do'kon\nVIEWS.shop=function(){var j=load('shop','shop');if(!j)return L();if(j.error)return errBox(j);\n  var h='<div class=\"card\"><h2>🛍 Ilmzor puli doʻkoni</h2>'+(j.balance!==null?'<div style=\"font-size:15px\">🪙 Balansingiz: <b style=\"font-size:22px\">'+j.balance+'</b> Ilmzor puli</div>':'<div class=\"muted\">Xarid qilish uchun avval <b>«📝 Vazifalar»</b> boʻlimida ism-familiyangiz bilan ulaning.</div>')+'</div>';\n  var pend=j.orders.filter(function(o){return o.status==='kutilmoqda';});\n  if(j.orders.length)h+='<div class=\"card\"><h3>📦 Buyurtmalarim</h3>'+j.orders.slice(0,8).map(function(o){return '<div class=\"li\"><span class=\"tx\"><b>'+esc(o.name)+'</b><small>'+o.cost+' 🪙 · '+({kutilmoqda:'⏳ sotuvchidan olib keting',berildi:'✅ berildi',bekor:'✖ bekor qilindi'}[o.status]||o.status)+'</small></span>'+(o.status==='kutilmoqda'?'<button class=\"chip\" data-scancel=\"'+o.id+'\">Bekor</button>':'')+'</div>';}).join('')+'</div>';\n  if(!j.items.length)return h+'<div class=\"card empty\">Hozircha doʻkonda mahsulot yoʻq.</div>';\n  var cats={};j.items.forEach(function(i){(cats[i.category]=cats[i.category]||[]).push(i);});\n  Object.keys(cats).forEach(function(c){h+='<div class=\"sec\">'+esc(c)+'</div><div class=\"sgrid\">'+cats[c].map(function(i){var enough=j.balance!==null&&j.balance>=i.price;return '<div class=\"si\"><div class=\"im\">'+(i.img?'<img loading=\"lazy\" src=\"'+esc(i.img)+'\">':'🎁')+'</div><div class=\"b\"><b>'+esc(i.name)+'</b><div><b style=\"color:var(--navy2)\">'+i.price+' 🪙</b> <span class=\"muted\">· '+(i.stock>0?(i.stock<=3?'oxirgi '+i.stock+' ta':i.stock+' ta'):'tugagan')+'</span></div><div style=\"flex:1\"></div>'+(i.stock>0&&j.linked?'<button class=\"btn '+(enough?'aq':'soft')+'\" style=\"padding:9px\" data-buy=\"'+i.id+'\" '+(enough?'':'disabled')+'>'+(enough?'🛒 Olaman':'Pul yetmaydi')+'</button>':'')+'</div></div>';}).join('')+'</div>';});\n  return h;};\n\n// ---------- olimpiada\nVIEWS.olymp=function(){var j=load('olymp','olymp');if(!j)return L();if(j.error)return errBox(j);\n  if(!j.sets.length)return '<div class=\"card empty\">🏆 Hozircha eʼlon qilingan natijalar yoʻq.</div>';\n  return '<div class=\"card\"><h2>🏆 Olimpiada va test natijalari</h2>'+j.sets.map(function(s){return '<button class=\"li\" data-oset=\"'+s.id+'\"><span style=\"font-size:22px\">'+(s.locked?'🔒':'📂')+'</span><span class=\"tx\"><b>'+esc(s.title)+'</b><small>'+(s.locked?'Hozircha ism-familiya bilan qidiriladi · fayllar '+esc(s.lockText)+' ochiladi':s.items.length+' ta fayl')+'</small></span><span>›</span></button>';}).join('')+'</div>';};\nVIEWS.oset=function(){var j=S.d.olymp;var s=j&&j.sets.filter(function(x){return x.id===S.d.oid;})[0];if(!s)return L();var F=S.d.ofind;\n  var h='<div class=\"card\"><h2>'+esc(s.title)+'</h2>'+(s.locked?'<div class=\"muted\">🔒 Umumiy fayllar <b>'+esc(s.lockText)+'</b> ochiladi. Hozircha natijangizni ism-familiya bilan qidiring.</div>':'')+'</div>';\n  if(s.canSearch)h+='<div class=\"card\"><h3>🔎 Ismim boʻyicha qidirish</h3><input id=\"ofn\" placeholder=\"Masalan: Ali Valiyev\" value=\"'+esc(S.d.ofq||'')+'\"><div class=\"err\" id=\"er\"></div><button class=\"btn\" id=\"ofgo\">Qidirish</button></div>';\n  if(F&&F.found){if(!F.found.length)h+='<div class=\"card empty\">🔎 Topilmadi. Ism-familiyani toʻliq va toʻgʻri yozing.</div>';\n    else h+=F.found.map(function(f){return '<div class=\"card\"><div class=\"tag\">'+esc(f.label)+'</div><h3 style=\"margin-top:8px\">👤 '+esc(f.name)+(f.school?' <span class=\"muted\">· '+esc(f.school)+'-maktab</span>':'')+'</h3><div class=\"row\" style=\"text-align:center\"><div><div class=\"muted\">Oʻrin</div><b style=\"font-size:24px\">'+esc(f.rank)+'</b></div><div><div class=\"muted\">Ball</div><b style=\"font-size:24px\">'+esc(f.ball)+'</b></div><div><div class=\"muted\">Foiz</div><b style=\"font-size:24px\">'+esc(f.pct)+'</b></div></div><div class=\"card\" style=\"background:#f2f5f8;box-shadow:none;margin:12px 0 10px\">🎟 <b>Vaucher ('+esc(f.tier)+')</b>: '+som(f.amount)+' soʻm/oy · jami <b>'+som(f.total)+' soʻm</b><br><span class=\"muted\">'+(f.used?'🔴 Ishlatilgan ('+fdt(f.used)+')':'✅ Ishlatilmagan')+' · 1-dekabrgacha roʻyxatdan oʻtilsa amal qiladi</span></div><div class=\"row\"><button class=\"btn soft\" data-open=\"'+esc(f.vurl)+'\">🎟 Vaucherni ochish</button><button class=\"btn aq\" data-vjoin=\"1\">🎓 Kursga yozilish</button></div>'+(f.vkey?'<br><button class=\"btn '+(f.used?'soft':'bad')+'\" data-vused=\"'+esc(f.vkey)+'\" data-u=\"'+(f.used?0:1)+'\">'+(f.used?'♻️ Ishlatilganni bekor qilish':'🔴 Ishlatilgan deb belgilash')+'</button>':'')+'</div>';}).join('');}\n  if(s.items.length&&!(s.locked&&!can('results')))h+='<div class=\"card\"><h3>📄 Fayllar</h3>'+s.items.map(function(it){return '<button class=\"li\" data-open=\"'+esc(it.url)+'\"><span style=\"font-size:20px\">📄</span><span class=\"tx\"><b>'+esc(it.label)+'</b></span><span>›</span></button>';}).join('')+'</div>';\n  return h;};\n\n// ---------- kurslar\nVIEWS.courses=function(){var j=load('courses','courses');if(!j)return L();if(j.error)return errBox(j);\n  var h='<div class=\"card\"><h2>🎓 Ilmzor kurslariga yozilish</h2>'+(S.d.vj?'<div class=\"tag g\">🎟 Vaucher bilan yozilasiz</div>':'')+(j.courses.length?j.courses.map(function(c){return '<button class=\"li\" data-course=\"'+c.id+'\"><span style=\"font-size:22px\">📘</span><span class=\"tx\"><b>'+esc(c.title)+'</b><small>'+esc(c.price||'')+'</small></span><span>›</span></button>';}).join(''):'<p class=\"muted\">Hozircha ochiq kurslar yoʻq.</p>')+'</div>';\n  if(j.mine.length)h+='<div class=\"card\"><h3>📝 Arizalarim</h3>'+j.mine.map(function(l){return '<div class=\"li\"><span class=\"tx\"><b>'+esc(l.course)+'</b><small>'+esc(l.student||'')+' · '+fdt(l.at)+'</small></span><span class=\"tag\">'+esc(l.stage)+'</span></div>';}).join('')+'</div>';\n  return h;};\nVIEWS.course=function(){var j=S.d.courses;var c=j&&j.courses.filter(function(x){return x.id===S.d.cid;})[0];if(!c)return L();var F=S.d.lf;\n  return '<div class=\"card\"><h2>📘 '+esc(c.title)+'</h2>'+(c.price?'<div><b>💵 '+esc(c.price)+'</b></div>':'')+(c.info?'<p style=\"white-space:pre-wrap\">'+esc(c.info)+'</p>':'')+'</div>'+\n  '<div class=\"card\"><h3>✍️ Ariza</h3>'+(S.me.phone?'<div class=\"muted\">📱 Admin <b>'+esc(S.me.phone)+'</b> raqami orqali bogʻlanadi.</div>':'<div class=\"muted\">📱 Admin siz bilan bogʻlanishi uchun telefon raqamingiz kerak — yuborishda soʻraladi.</div>')+\n  '<label>Oʻquvchining ism-familiyasi</label><input data-lf=\"student\" value=\"'+esc(F.student)+'\" placeholder=\"Masalan: Ali Valiyev\">'+\n  '<label>Fan</label><div class=\"chips\">'+j.subjects.map(function(s){return '<button class=\"chip'+(F.subject===s?' on':'')+'\" data-lsub=\"'+esc(s)+'\">'+esc(s)+'</button>';}).join('')+'</div><input data-lf=\"subject\" style=\"margin-top:8px\" placeholder=\"yoki fan nomini yozing\" value=\"'+esc(j.subjects.indexOf(F.subject)<0?F.subject:'')+'\">'+\n  '<label>Qaysi payt?</label><div class=\"chips\">'+['Ertalab','Abeddan keyin'].map(function(s){return '<button class=\"chip'+(F.shift===s?' on':'')+'\" data-lshift=\"'+s+'\">'+(s==='Ertalab'?'🌅 ':'🌇 ')+s+'</button>';}).join('')+'</div>'+\n  '<label>Sinf</label><div class=\"chips\">'+j.grades.map(function(g){return '<button class=\"chip'+(F.grade===g?' on':'')+'\" data-lgrade=\"'+g+'\">'+g+'</button>';}).join('')+'</div>'+\n  '<div class=\"err\" id=\"er\">'+esc(F.err||'')+'</div><button class=\"btn aq\" id=\"lsend\">✅ Yozilish</button></div>';};\nVIEWS.leaddone=function(){return '<div class=\"card\" style=\"text-align:center\"><div style=\"font-size:48px\">✅</div><h2>Arizangiz qabul qilindi!</h2><p class=\"muted\">Admin tez orada siz bilan bogʻlanadi. Holatini «🎓 Kurslarga yozilish» → «Arizalarim»da koʻrasiz.</p><button class=\"btn\" data-home=\"1\">🏠 Bosh sahifa</button></div>';};\n\n// ---------- profil\nVIEWS.profile=function(){var m=S.me;return '<div class=\"card\"><h2>👤 Profil</h2><label>Ism va familiya</label><input id=\"pnm\" value=\"'+esc(m.name)+'\"><div class=\"err\" id=\"er\"></div><button class=\"btn\" id=\"pnmok\">Saqlash</button></div>'+\n  '<div class=\"card\"><h3>📱 Telefon raqam</h3><p class=\"muted\" style=\"margin-top:0\">Raqam ulansa, oylik test natijalari shu yerga keladi. Ota-ona ham oʻz raqami bilan kirsa boʻladi.</p><div style=\"margin-bottom:10px\">Hozir: <b>'+(m.phone?esc(m.phone):'ulanmagan')+'</b></div><button class=\"btn aq\" id=\"pph\">📱 Raqamni ulash</button></div>'+\n  '<div class=\"card\"><div class=\"muted\">Rol: <b>'+esc(m.roleName)+'</b></div></div>';};\n\n// ================= USTOZ =================\nVIEWS.tt=function(){var j=load('tt','tt_list');if(!j)return L();if(j.error)return errBox(j);\n  var h='<button class=\"btn aq\" data-go=\"tt_new\" style=\"margin-bottom:12px\">➕ Yangi test</button>';\n  if(!j.tests.length)return h+'<div class=\"card empty\">Hali test yoʻq.</div>';\n  return h+'<div class=\"card\"><h2>📚 Testlarim</h2>'+j.tests.map(function(t){return '<button class=\"li\" data-tt=\"'+t.code+'\"><span class=\"tag '+(t.open?'g':'')+'\" style=\"font-size:14px;letter-spacing:1px\">'+t.code+'</span><span class=\"tx\"><b>'+esc(t.title)+'</b><small>'+(t.open?'🟢 ochiq':'🔒 yopiq')+' · '+t.n+' savol · <b>'+t.cnt+'</b> kishi'+(t.deadline?' · ⏰ '+fdt(t.deadline):'')+'</small></span><span>›</span></button>';}).join('')+'</div>';};\nVIEWS.tt_new=function(){var F=S.d.tf;return '<div class=\"card\"><h2>➕ Yangi test</h2>'+\n  '<label>1. Test fayllari (rasm yoki PDF)</label><input type=\"file\" id=\"tfiles\" multiple accept=\"image/*,application/pdf\"><div class=\"muted\" id=\"tfn\">'+(F.files.length?F.files.length+' ta fayl tanlandi':'Bir nechta rasm tanlasa boʻladi')+'</div>'+\n  '<label>2. Javoblar kaliti</label><textarea id=\"tkey\" placeholder=\"abcdabcd… yoki 1a 2b 3c …\">'+esc(F.key)+'</textarea><div class=\"muted\" id=\"tkn\"></div>'+\n  '<label>3. Test nomi</label><input id=\"ttitle\" placeholder=\"Masalan: 5-sinf, kasrlar\" value=\"'+esc(F.title)+'\">'+\n  '<div class=\"err\" id=\"er\"></div><button class=\"btn aq\" id=\"tcreate\">✅ Testni yaratish</button></div>';};\nfunction keyLen(s){s=String(s||'').toLowerCase().replace(/[абвгдсц]/g,function(c){return{'а':'a','б':'b','в':'c','г':'d','д':'e','с':'c','ц':'c'}[c];});if(/\\d/.test(s)){var m,re=/(\\d+)\\s*[-.):=]?\\s*([a-e])/g,mx=0;while((m=re.exec(s)))mx=Math.max(mx,+m[1]);return mx;}return s.replace(/[^a-e]/g,'').length;}\nVIEWS.tt_view=function(){var j=S.d.tv;if(!j)return L();if(j.error)return errBox(j);\n  var h='<div class=\"card\" style=\"text-align:center\"><div class=\"muted\">Test kodi</div><div class=\"big\">'+j.code+'</div><div><b>'+esc(j.title)+'</b> · '+j.n+' savol</div><br><div class=\"row\"><button class=\"btn soft\" data-copy=\"'+j.code+'\">📋 Kodni nusxalash</button><button class=\"btn '+(j.open?'bad':'aq')+'\" data-tset=\"open\" data-v=\"'+(j.open?0:1)+'\">'+(j.open?'🔒 Yopish':'🔓 Ochish')+'</button></div></div>';\n  h+='<div class=\"stat\"><div><small>Topshirganlar</small><b>'+j.results.length+'</b></div><div><small>Oʻrtacha</small><b style=\"color:'+pcol(j.avg)+'\">'+j.avg+'%</b></div></div><br>';\n  var miss=j.miss.map(function(v,i){return[i+1,v];}).filter(function(x){return x[1]>0;}).sort(function(a,b){return b[1]-a[1];}).slice(0,6);\n  if(miss.length)h+='<div class=\"card\"><h3>❗ Koʻp xato qilingan savollar</h3><div class=\"chips\">'+miss.map(function(x){return '<span class=\"tag r\">'+x[0]+'-savol · '+x[1]+' kishi</span>';}).join('')+'</div></div>';\n  h+='<div class=\"card\"><h3>📊 Natijalar</h3>'+(j.results.length?j.results.map(function(r,i){return '<div class=\"li\"><span style=\"width:30px;font-weight:900\">'+(i<3?['🥇','🥈','🥉'][i]:(i+1)+'.')+'</span><span class=\"tx\"><b>'+esc(r.name)+'</b><small>'+fdt(r.at)+'</small></span><b>'+r.ok+'/'+r.n+'</b><span class=\"pc\" style=\"background:'+pcol(r.pct)+';margin-left:6px\">'+r.pct+'%</span></div>';}).join(''):'<p class=\"muted\">Hali hech kim topshirmagan.</p>')+'</div>';\n  h+='<div class=\"card\"><h3>⚙️ Sozlash</h3><div class=\"muted\">⏰ Muddat: <b>'+(j.deadline?fdt(j.deadline):'yoʻq')+'</b> · 👁 Yopilgach javoblar: <b>'+(j.reveal?'koʻrsatiladi':'yashirin')+'</b></div><label>Muddat (hozirdan)</label><div class=\"chips\">'+[[1,'1 soat'],[3,'3 soat'],[24,'24 soat'],[168,'1 hafta'],[0,'♾ Muddatsiz']].map(function(x){return '<button class=\"chip\" data-tset=\"hours\" data-v=\"'+x[0]+'\">'+x[1]+'</button>';}).join('')+'</div><br><div class=\"row\"><button class=\"btn soft\" data-tset=\"reveal\" data-v=\"'+(j.reveal?0:1)+'\">'+(j.reveal?'🙈 Javoblarni yashirish':'👁 Javoblarni koʻrsatish')+'</button><button class=\"btn soft\" id=\"texp\">📤 Excel / Sheets</button></div>'+\n  '<label>Nomi</label><div class=\"row\"><input id=\"ett\" value=\"'+esc(j.title)+'\" style=\"flex:3\"><button class=\"chip\" data-tset=\"title\">💾</button></div>'+\n  '<label>Kalit ('+j.n+' ta)</label><div class=\"row\"><input id=\"ekey\" value=\"'+j.key.toUpperCase()+'\" style=\"flex:3;letter-spacing:1px\"><button class=\"chip\" data-tset=\"key\">💾</button></div><div class=\"muted\">Kalit oʻzgarsa, natijalar qayta hisoblanadi.</div><br>'+\n  (j.files.length?'<div class=\"row\">'+j.files.map(function(f,i){return '<button class=\"btn soft\" data-open=\"'+esc(f.url)+'\">📄 '+(i+1)+'-fayl</button>';}).join('')+'</div><br>':'')+\n  '<button class=\"btn bad\" id=\"tdel\">🗑 Testni oʻchirish</button></div>';\n  return h;};\nVIEWS.mgroups=function(){var j=load('mg','monthly_groups');if(!j)return L();if(j.error)return errBox(j);\n  if(!j.groups.length)return '<div class=\"card empty\">🗓 Hali oylik natijalar kiritilmagan.</div>';\n  return '<div class=\"card\"><h2>🗓 Oylik natijalar</h2><div class=\"muted\">Har guruhning oxirgi oyi</div></div>'+j.groups.map(function(g){return '<div class=\"card\"><b>'+esc(g.grp)+'</b>'+(g.teacher?' <span class=\"muted\">· '+esc(g.teacher)+'</span>':'')+'<div class=\"muted\">'+esc(g.label)+' · '+g.n+' kishi · oʻrtacha <b style=\"color:'+pcol(g.avg)+'\">'+g.avg+'%</b></div><div class=\"prog\"><i style=\"width:'+g.avg+'%;background:'+pcol(g.avg)+'\"></i></div></div>';}).join('');};\nVIEWS.radm=function(){var j=load('radm','r_sets');if(!j)return L();if(j.error)return errBox(j);\n  var h='<div class=\"card\"><h2>🏆 Natijalar — admin</h2><p class=\"muted\" style=\"margin-top:0\">Har toʻplamga sinf tugmasi va natija fayli qoʻshing. CSV havola qoʻyilsa, oʻquvchilar ism bilan qidira oladi.</p><div class=\"row\"><input id=\"rnew\" placeholder=\"Yangi toʻplam: Tezkor matematika — 8-noyabr\" style=\"flex:3\"><button class=\"chip\" id=\"rnewok\">➕</button></div></div>';\n  return h+j.sets.map(function(s){var A=S.d.ra[s.id]||{};return '<div class=\"card\" style=\"'+(s.active?'':'opacity:.7')+'\"><h3>'+(s.active?'👁 ':'🙈 ')+(s.locked?'🔒 ':'')+esc(s.title)+'</h3>'+(s.locked?'<div class=\"muted\">Fayllar '+esc(s.lockText)+' ochiladi</div>':'')+\n    s.items.map(function(it){return '<div class=\"li\"><span class=\"tx\"><b>📄 '+esc(it.label)+'</b><small>'+(it.csv?'🔎 ism bilan qidiruv bor':'qidiruv yoʻq')+'</small></span><button class=\"chip\" data-open=\"'+esc(it.url)+'\">Ochish</button><button class=\"chip\" data-ridel=\"'+it.id+'\">🗑</button></div>';}).join('')+\n    '<details style=\"margin-top:8px\"><summary style=\"font-weight:800;cursor:pointer\">➕ Fayl qoʻshish</summary><input data-ra=\"'+s.id+'\" data-k=\"label\" placeholder=\"Tugma nomi: 3-sinf\" value=\"'+esc(A.label||'')+'\" style=\"margin-top:8px\"><input type=\"file\" data-rf=\"'+s.id+'\" accept=\"image/*,application/pdf\" style=\"margin-top:8px\"><input data-ra=\"'+s.id+'\" data-k=\"csv\" placeholder=\"CSV havola (ixtiyoriy, ism bilan qidiruv uchun)\" value=\"'+esc(A.csv||'')+'\" style=\"margin-top:8px\"><button class=\"btn\" style=\"margin-top:8px\" data-radd=\"'+s.id+'\">Qoʻshish</button></details>'+\n    '<label>🔒 Fayllar oʻquvchilarga qachongacha yopiq?</label><div class=\"chips\">'+[['n','Hozir ochiq'],['1','1 soat'],['3','3 soat'],['24','24 soat'],['72','3 kun'],['m','Ochguncha']].map(function(x){return '<button class=\"chip\" data-rlock=\"'+s.id+'\" data-m=\"'+x[0]+'\">'+x[1]+'</button>';}).join('')+'</div><div class=\"row\" style=\"margin-top:8px\"><input type=\"datetime-local\" data-rat=\"'+s.id+'\" style=\"flex:3\"><button class=\"chip\" data-rlockat=\"'+s.id+'\">⏰</button></div>'+\n    '<div class=\"row\" style=\"margin-top:10px\"><button class=\"btn soft\" data-rtog=\"'+s.id+'\">'+(s.active?'🙈 Yashirish':'👁 Koʻrsatish')+'</button><button class=\"btn bad\" data-rdel=\"'+s.id+'\">🗑 Oʻchirish</button></div></div>';}).join('');};\n\n// ================= ADMIN =================\nVIEWS.funnel=function(){var j=load('fs','f_sum');if(!j)return L();if(j.error)return errBox(j);var st=S.d.fst||'new';var Ls=S.d.fl;\n  var h='<div class=\"card\"><h2>📊 Sotuv varonkasi</h2><div class=\"stat\"><div><small>Jami arizalar</small><b>'+j.total+'</b></div><div><small>Oxirgi 7 kun</small><b>+'+j.week+'</b></div></div>'+(j.stale?'<p style=\"color:var(--bad);font-weight:800\">🚨 30 daqiqadan beri javobsiz: '+j.stale+' ta</p>':'')+\n  j.stages.map(function(s){var p=j.total?Math.round(s.n*100/j.total):0;return '<div style=\"margin-top:10px\"><div style=\"display:flex;justify-content:space-between\"><b>'+esc(s.title)+'</b><span><b>'+s.n+'</b> · '+p+'%</span></div><div class=\"prog\"><i style=\"width:'+p+'%\"></i></div></div>';}).join('')+\n  '<br><button class=\"btn soft\" data-copy=\"=IMPORTDATA(&quot;'+esc(j.sheets)+'&quot;)\">📤 Google Sheets formulasini nusxalash</button></div>';\n  if(j.byCourse.length)h+='<div class=\"card\"><h3>📘 Kurslar</h3>'+j.byCourse.map(function(c){return '<div class=\"li\"><span class=\"tx\"><b>'+esc(c.ctitle)+'</b></span>'+c.c+' ta · 💰 '+(c.paid||0)+'</div>';}).join('')+'</div>';\n  h+='<div class=\"chips\" style=\"margin-bottom:10px\">'+j.stages.map(function(s){return '<button class=\"chip'+(st===s.key?' on':'')+'\" data-fst=\"'+s.key+'\">'+esc(s.title)+' · '+s.n+'</button>';}).join('')+'</div>';\n  if(!Ls)return h+L();\n  if(!Ls.length)return h+'<div class=\"card empty\">Bu bosqichda ariza yoʻq.</div>';\n  return h+Ls.map(function(l){return '<div class=\"card\"><div style=\"display:flex;justify-content:space-between\"><b>#'+l.id+' · '+esc(l.course)+'</b><span class=\"tag\">'+esc(l.stageText)+'</span></div><div style=\"margin:6px 0\">👤 <b>'+esc(l.student)+'</b>'+(l.grade?' · '+esc(l.grade):'')+(l.account&&l.account!==l.student?' <span class=\"muted\">(akkaunt: '+esc(l.account)+')</span>':'')+'<br>'+(l.subject?'📚 '+esc(l.subject)+(l.shift?' · 🕒 '+esc(l.shift):'')+'<br>':'')+(l.voucher?'🎟 '+esc(l.voucher)+'<br>':'')+'<span class=\"muted\">📅 '+fdt(l.at)+(l.assigned?' · 🙋 '+esc(l.assigned):'')+'</span></div>'+\n    '<div class=\"row\">'+(l.tel?'<button class=\"btn soft\" data-open=\"tel:'+esc(l.tel)+'\">📞 '+esc(l.phone)+'</button>':'')+(l.username?'<button class=\"btn soft\" data-open=\"https://t.me/'+esc(l.username)+'\">💬 Telegram</button>':'')+'</div>'+\n    '<div class=\"chips\" style=\"margin-top:8px\">'+(l.assigned?'':'<button class=\"chip on\" data-la=\"'+l.id+'\">🙋 Men bogʻlanaman</button>')+j.stages.filter(function(s){return s.key!==l.stage&&s.key!=='new';}).map(function(s){return '<button class=\"chip\" data-ls=\"'+l.id+'\" data-s=\"'+s.key+'\">'+esc(s.title)+'</button>';}).join('')+'</div></div>';}).join('');};\nVIEWS.funnel.after=function(){if(S.d.fl===undefined){S.d.fl=null;api('f_list',{stage:S.d.fst||'new'}).then(function(j){S.d.fl=j.leads;render();}).catch(function(e){say(e.message);});}};\nVIEWS.cadm=function(){var j=load('cadm','c_list');if(!j)return L();if(j.error)return errBox(j);var C=S.d.cf;\n  return '<div class=\"card\"><h2>🎓 Kurslar — admin</h2>'+(j.courses.length?j.courses.map(function(c){return '<div class=\"li\" style=\"'+(c.active?'':'opacity:.6')+'\"><span class=\"tx\"><b>'+(c.active?'👁 ':'🙈 ')+esc(c.title)+'</b><small>'+esc(c.price||'')+' · '+c.n+' ta ariza</small></span><button class=\"chip\" data-ctog=\"'+c.id+'\">'+(c.active?'Yashirish':'Koʻrsatish')+'</button><button class=\"chip\" data-cdel=\"'+c.id+'\">🗑</button></div>';}).join(''):'<p class=\"muted\">Hali kurs yoʻq.</p>')+'</div>'+\n  '<div class=\"card\"><h3>➕ Yangi kurs</h3><input data-cf=\"title\" placeholder=\"Kurs nomi: Tezkor matematika, 2-3-sinf\" value=\"'+esc(C.title||'')+'\"><input data-cf=\"price\" style=\"margin-top:8px\" placeholder=\"Narxi: 300 000 soʻm/oy\" value=\"'+esc(C.price||'')+'\"><textarea data-cf=\"info\" style=\"margin-top:8px\" placeholder=\"Jadval va ustoz: Du-Chor-Ju 15:00, Sardorbek ustoz\">'+esc(C.info||'')+'</textarea><button class=\"btn aq\" style=\"margin-top:8px\" id=\"cadd\">➕ Qoʻshish</button></div>';};\nVIEWS.stats=function(){var j=load('stats','stats');if(!j)return L();if(j.error)return errBox(j);\n  var p=j.users?Math.round(j.phones*100/j.users):0;\n  return '<div class=\"card\"><h2>📈 Statistika</h2></div><div class=\"stat\">'+[['👥 Foydalanuvchilar',j.users],['🎓 Oʻquvchilar',j.students],['👨‍🏫 Xodimlar',j.staff],['📱 Raqam ulagan',j.phones+' · '+p+'%'],['📝 Testlar',j.tests],['✍️ Topshirishlar',j.results],['📅 7 kunda topshirildi',j.week],['🗓 Oylik natijasi bor',j.monthly],['🎓 Arizalar',j.leads],['💰 Toʻlaganlar',j.paid],['📤 Navbatdagi xabarlar',j.outbox]].map(function(x){return '<div><small>'+x[0]+'</small><b>'+x[1]+'</b></div>';}).join('')+'</div>';};\nVIEWS.bcast=function(){var j=load('bg','b_groups');if(!j)return L();if(j.error)return errBox(j);var B=S.d.bf;\n  return '<div class=\"card\"><h2>📢 Xabar yuborish</h2><label>Xabar matni</label><textarea id=\"btext\" style=\"min-height:120px\" placeholder=\"Eʼlon matni…\">'+esc(B.text)+'</textarea><label>Rasm (ixtiyoriy)</label><input type=\"file\" id=\"bfile\" accept=\"image/*\">'+\n  '<label>Kimga?</label><div class=\"chips\">'+[['all','👥 Hammaga · '+j.counts.all],['stu','🎓 Oʻquvchilarga · '+j.counts.stu],['tea','👨‍🏫 Xodimlarga · '+j.counts.tea],['grp','🗓 Guruh boʻyicha']].map(function(x){return '<button class=\"chip'+(B.target===x[0]?' on':'')+'\" data-bt=\"'+x[0]+'\">'+x[1]+'</button>';}).join('')+'</div>'+\n  (B.target==='grp'?'<label>Guruh</label><select id=\"bgrp\"><option value=\"\">— tanlang —</option>'+j.groups.map(function(g){return '<option'+(B.grp===g.grp?' selected':'')+'>'+esc(g.grp)+'</option>';}).join('')+'</select><div class=\"muted\">Faqat botda raqamini ulagan oʻquvchi va ota-onalarga boradi.</div>':'')+\n  '<div class=\"err\" id=\"er\"></div><button class=\"btn aq\" id=\"bsend\">📢 Yuborish</button></div>';};\nVIEWS.staff=function(){var j=load('staff','staff');if(!j)return L();if(j.error)return errBox(j);var I=S.d.ivf;\n  var h='';if(can('invite'))h+='<div class=\"card\"><h2>🔑 Xodim kodi</h2><p class=\"muted\" style=\"margin-top:0\">Kod bir martalik. Xodim botda <code>/ustoz KOD</code> deb yozadi.</p><div class=\"chips\">'+[['teacher','👨‍🏫 Ustoz'],['admin','🛡 Admin']].map(function(x){return '<button class=\"chip'+(I.role===x[0]?' on':'')+'\" data-ivr=\"'+x[0]+'\">'+x[1]+'</button>';}).join('')+'</div><div class=\"row\" style=\"margin-top:8px\"><input id=\"ivn\" placeholder=\"Xodim ismi\" value=\"'+esc(I.name||'')+'\" style=\"flex:3\"><button class=\"chip\" id=\"ivok\">Kod olish</button></div>'+\n    (j.invites.length?j.invites.map(function(i){return '<div class=\"li\"><span class=\"tx\"><b>'+(i.role==='admin'?'🛡 ':'👨‍🏫 ')+esc(i.name)+'</b><small>'+(i.used?'✅ ishlatilgan':'⏳ kutilmoqda')+'</small></span>'+(i.used?'':'<button class=\"chip\" data-copy=\"/ustoz '+i.code+'\">'+i.code+' 📋</button>')+'</div>';}).join(''):'')+'</div>';\n  if(can('staff'))h+='<div class=\"card\"><h2>👥 Xodimlar</h2>'+j.staff.map(function(s){return '<div class=\"li\"><span class=\"tx\"><b>'+esc(s.name)+'</b><small>'+({ceo:'👑 CEO',admin:'🛡 Admin',teacher:'👨‍🏫 Ustoz'}[s.role]||s.role)+(s.phone?' · '+esc(s.phone):'')+'</small></span>'+(s.role==='ceo'||s.me?'':'<select data-srole=\"'+s.id+'\" style=\"width:auto;padding:6px\"><option value=\"\">Rol…</option><option value=\"admin\">🛡 Admin</option><option value=\"teacher\">👨‍🏫 Ustoz</option><option value=\"student\">🎓 Oʻquvchi</option></select>')+'</div>';}).join('')+'</div>';\n  return h;};\n\n// ---------- hodisalar\ndocument.addEventListener('click',function(e){var t=e.target.closest('button,[data-open]');if(!t)return;var d=t.dataset;\n  if(t.id==='hbtn'){S.stack=[];go('home',false);return;}\n  if(d.go){if(d.go==='tt_new')S.d.tf={files:[],key:'',title:''};if(d.go==='test')S.d.T=null;if(d.go==='courses')S.d.vj=false;if(d.go==='funnel')S.d.fl=undefined;go(d.go);return;}\n  if(d.home){S.stack=[];go('home',false);return;}\n  if(d.open){openUrl(d.open);return;}\n  if(d.copy){copy(d.copy);return;}\n  if(t.id==='nmok'||t.id==='pnmok'){var v=$(t.id==='nmok'?'nm':'pnm').value;t.disabled=true;api('set_name',{name:v}).then(function(j){S.me.name=j.name;hap('ok');toast('✅ Saqlandi');if(S.view==='name')go('home',false);else t.disabled=false;}).catch(function(e){t.disabled=false;$('er').textContent=e.message;});return;}\n  if(t.id==='subgo'){try{W.openTelegramLink(S.me.subUrl);}catch(_){openUrl(S.me.subUrl);}return;}\n  if(t.id==='subchk'){api('sub_check').then(function(j){if(j.sub){S.me.sub=true;go(S.me.name?'home':'name',false);}else say('❌ Hali obuna boʻlmagansiz. Avval «Kanalga oʻtish»ni bosing.');});return;}\n  if(t.id==='pph'){phoneReq(function(p){if(!p)return;api('set_phone',{phone:p}).then(function(j){S.me.phone=j.phone;hap('ok');say('✅ Raqam ulandi!'+(j.monthly?'\\n🗓 Oylik natijalar topildi — «Vazifalar va reyting» boʻlimida.':''));render();}).catch(function(e){say(e.message);});});return;}\n  // test\n  if(t.id==='topen'){var c=$('tcode').value.trim();t.disabled=true;api('t_open',{code:c}).then(function(j){j.ans=new Array(j.n||0).fill('');S.d.T=j;hap();render();}).catch(function(e){t.disabled=false;$('er').textContent=e.message;hap('err');});return;}\n  if(d.ans){var p=d.ans.split(':'),T=S.d.T;T.ans[+p[0]]=T.ans[+p[0]]===p[1]?'':p[1];hap();var y=window.scrollY;render();window.scrollTo(0,y);return;}\n  if(t.id==='tsub'){var T2=S.d.T;ask('Javoblarni yuborasizmi? Javob faqat bir marta qabul qilinadi.',function(){t.disabled=true;api('t_submit',{code:T2.code,answers:T2.ans.join('')}).then(function(j){T2.result=j;hap('ok');S.d.mine=null;go('test',false);window.scrollTo(0,0);}).catch(function(e){t.disabled=false;say(e.message);});});return;}\n  if(t.id==='tnew'){S.d.T=null;render();return;}\n  if(d.rev){S.d.rev=null;go('reveal');api('t_reveal',{code:d.rev}).then(function(j){S.d.rev=j;render();}).catch(function(e){S.d.rev={error:e.message};render();});return;}\n  // do'kon\n  if(d.buy){var it=S.d.shop.items.filter(function(x){return x.id===d.buy;})[0];ask('🛒 '+it.name+' — '+it.price+' Ilmzor puli. Olasizmi? Pul darhol band qilinadi.',function(){api('s_order',{id:it.id}).then(function(j){hap('ok');say('✅ Buyurtma qabul qilindi!\\n🪙 Qolgan balans: '+j.balance+'\\n📍 Mahsulotni doʻkon sotuvchisidan olib keting.');load('shop','shop',{},true);render();}).catch(function(e){say(e.message);});});return;}\n  if(d.scancel){ask('Buyurtmani bekor qilasizmi? Pul qaytadi.',function(){api('s_cancel',{id:d.scancel}).then(function(){toast('✖ Bekor qilindi');load('shop','shop',{},true);render();}).catch(function(e){say(e.message);});});return;}\n  // olimpiada\n  if(d.oset){S.d.oid=+d.oset;S.d.ofind=null;go('oset');return;}\n  if(t.id==='ofgo'){var q=$('ofn').value;S.d.ofq=q;t.disabled=true;api('o_find',{setid:S.d.oid,name:q}).then(function(j){S.d.ofind=j;render();}).catch(function(e){t.disabled=false;$('er').textContent=e.message;});return;}\n  if(d.vjoin){S.d.vj=true;S.d.courses=null;go('courses');return;}\n  if(d.vused){api('vused',{k:d.vused,used:d.u==='1'}).then(function(){toast('Saqlandi');$('ofgo')&&$('ofgo').click();});return;}\n  // kurslar\n  if(d.course){S.d.cid=+d.course;S.d.lf={student:S.me.name||'',subject:'',shift:'',grade:'',err:''};go('course');return;}\n  if(d.lsub){S.d.lf.subject=d.lsub;render();return;}\n  if(d.lshift){S.d.lf.shift=d.lshift;render();return;}\n  if(d.lgrade){S.d.lf.grade=d.lgrade;render();return;}\n  if(t.id==='lsend'){var F=S.d.lf;var sendLead=function(){t.disabled=true;api('lead',{course:S.d.cid,student:F.student,subject:F.subject,shift:F.shift,grade:F.grade,voucher:!!S.d.vj}).then(function(){hap('ok');S.d.courses=null;S.stack=[];go('leaddone',false);}).catch(function(e){t.disabled=false;\n      if(e.status===428){phoneReq(function(p){if(!p){F.err='Telefon raqam majburiy — admin siz bilan bogʻlanishi uchun.';render();return;}api('set_phone',{phone:p}).then(function(j){S.me.phone=j.phone;sendLead();}).catch(function(e2){say(e2.message);});});return;}\n      F.err=e.message;render();hap('err');});};sendLead();return;}\n  // ustoz\n  if(d.tt){S.d.tv=null;go('tt_view');api('tt_get',{code:d.tt}).then(function(j){S.d.tv=j;render();}).catch(function(e){S.d.tv={error:e.message};render();});return;}\n  if(t.id==='tcreate'){var TF=S.d.tf;TF.key=$('tkey').value;TF.title=$('ttitle').value;if(!TF.files.length){$('er').textContent='Test faylini tanlang';return;}if(!keyLen(TF.key)){$('er').textContent='Javoblar kalitini yozing';return;}\n    t.disabled=true;t.textContent='⏳ Yuklanmoqda…';upl('tt_new',{key:TF.key,title:TF.title},TF.files.map(function(f){return['files',f];})).then(function(j){hap('ok');S.d.tt=null;S.d.tv=null;S.stack=['home','tt'];S.view='tt_view';render();api('tt_get',{code:j.code}).then(function(x){S.d.tv=x;render();});}).catch(function(e){t.disabled=false;t.textContent='✅ Testni yaratish';$('er').textContent=e.message;});return;}\n  if(d.tset){var J=S.d.tv,body={code:J.code};if(d.tset==='title')body.title=$('ett').value;else if(d.tset==='key')body.key=$('ekey').value;else if(d.tset==='hours')body.hours=+d.v;else body[d.tset]=d.v==='1';\n    api('tt_set',body).then(function(j){S.d.tv=j;S.d.tt=null;hap('ok');toast('✅ Saqlandi');render();}).catch(function(e){say(e.message);});return;}\n  if(t.id==='texp'){api('tt_export',{code:S.d.tv.code}).then(function(j){say('📤 Natijalar fayli bot chatiga yuborildi.\\n\\nGoogle Sheets uchun formula nusxalandi — yangi jadvalning A1 katagiga qoʻying.');copy('=IMPORTDATA(\"'+j.url+'\")');}).catch(function(e){say(e.message);});return;}\n  if(t.id==='tdel'){ask('Test va uning barcha natijalari oʻchirilsinmi? Bu qaytarilmaydi.',function(){api('tt_del',{code:S.d.tv.code}).then(function(){S.d.tt=null;toast('🗑 Oʻchirildi');back();}).catch(function(e){say(e.message);});});return;}\n  // natijalar admin\n  var rr=function(op,b){return api(op,b).then(function(j){S.d.radm=j;S.d.olymp=null;hap('ok');render();}).catch(function(e){say(e.message);});};\n  if(t.id==='rnewok'){rr('r_newset',{title:$('rnew').value});return;}\n  if(d.rtog){rr('r_toggle',{id:+d.rtog});return;}\n  if(d.rdel){ask('Toʻplam va uning fayllari oʻchirilsinmi?',function(){rr('r_del',{id:+d.rdel});});return;}\n  if(d.ridel){ask('Fayl oʻchirilsinmi?',function(){rr('r_itemdel',{id:+d.ridel});});return;}\n  if(d.rlock){rr('r_lock',{id:+d.rlock,mode:d.m});return;}\n  if(d.rlockat){var inp=document.querySelector('[data-rat=\"'+d.rlockat+'\"]');if(!inp.value){say('Sana va vaqtni tanlang');return;}rr('r_lock',{id:+d.rlockat,mode:'at',at:new Date(inp.value).getTime()});return;}\n  if(d.radd){var sid=d.radd,A=S.d.ra[sid]||{},fi=document.querySelector('[data-rf=\"'+sid+'\"]');if(!fi.files[0]){say('Natija faylini tanlang');return;}t.disabled=true;t.textContent='⏳ Yuklanmoqda…';\n    upl('r_item',{setid:sid,label:A.label||'',csv:A.csv||''},[['file',fi.files[0]]]).then(function(j){S.d.radm=j;S.d.ra[sid]={};S.d.olymp=null;hap('ok');toast('✅ Qoʻshildi');render();}).catch(function(e){t.disabled=false;t.textContent='Qoʻshish';say(e.message);});return;}\n  // varonka\n  if(d.fst){S.d.fst=d.fst;S.d.fl=undefined;render();return;}\n  if(d.la||d.ls){api('f_act',d.la?{id:+d.la,assign:1}:{id:+d.ls,stage:d.s}).then(function(){hap('ok');toast('✅ Saqlandi');S.d.fs=null;S.d.fl=undefined;load('fs','f_sum',{},true);render();}).catch(function(e){say(e.message);});return;}\n  // kurslar admin\n  var cc=function(op,b){api(op,b).then(function(j){S.d.cadm=j;S.d.courses=null;hap('ok');render();}).catch(function(e){say(e.message);});};\n  if(d.ctog){cc('c_toggle',{id:+d.ctog});return;}\n  if(d.cdel){ask('Kurs oʻchirilsinmi? Avvalgi arizalar saqlanib qoladi.',function(){cc('c_del',{id:+d.cdel});});return;}\n  if(t.id==='cadd'){cc('c_add',S.d.cf);S.d.cf={};return;}\n  // xabar\n  if(d.bt){S.d.bf.text=$('btext').value;S.d.bf.target=d.bt;render();return;}\n  if(t.id==='bsend'){var BF=S.d.bf;BF.text=$('btext').value;if($('bgrp'))BF.grp=$('bgrp').value;var f=$('bfile').files[0];\n    if(!BF.target){$('er').textContent='Kimga yuborishni tanlang';return;}\n    ask('Xabar yuborilsinmi?',function(){t.disabled=true;var pr=f?upl('b_send',{text:BF.text,target:BF.target,grp:BF.grp||''},[['file',f]]):api('b_send',{text:BF.text,target:BF.target,grp:BF.grp||''});\n      pr.then(function(j){hap('ok');S.d.bf={text:'',target:'',grp:''};say('⏳ Xabar '+j.total+' kishiga yuborish navbatiga qoʻyildi. Taxminan '+j.minutes+' daqiqada tugaydi, oxirida botga hisobot keladi.');render();}).catch(function(e){t.disabled=false;$('er').textContent=e.message;});});return;}\n  // xodimlar\n  if(d.ivr){S.d.ivf.role=d.ivr;S.d.ivf.name=$('ivn').value;render();return;}\n  if(t.id==='ivok'){var I=S.d.ivf;I.name=$('ivn').value;api('iv_new',{role:I.role||'teacher',name:I.name}).then(function(j){S.d.staff=j;S.d.ivf={role:I.role};hap('ok');var c=j.invites[0];copy('/ustoz '+c.code);say('✅ '+c.name+' uchun kod: '+c.code+'\\n\\nXodim botda shuni yozadi:\\n/ustoz '+c.code+'\\n\\n(nusxalandi)');render();}).catch(function(e){say(e.message);});return;}\n});\ndocument.addEventListener('input',function(e){var t=e.target,d=t.dataset;\n  if(t.id==='tcode'){t.value=t.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);return;}\n  if(d.lf){S.d.lf[d.lf]=t.value;return;}\n  if(t.id==='tkey'){S.d.tf.key=t.value;var n=keyLen(t.value);$('tkn').textContent=n?n+' ta savol':'';return;}\n  if(t.id==='ttitle'){S.d.tf.title=t.value;return;}\n  if(d.ra){S.d.ra[d.ra]=S.d.ra[d.ra]||{};S.d.ra[d.ra][d.k]=t.value;return;}\n  if(d.cf){S.d.cf[d.cf]=t.value;return;}\n  if(t.id==='btext'){S.d.bf.text=t.value;return;}\n});\ndocument.addEventListener('change',function(e){var t=e.target;\n  if(t.id==='tfiles'){S.d.tf.files=[].slice.call(t.files);$('tfn').textContent=S.d.tf.files.length+' ta fayl tanlandi';return;}\n  if(t.dataset.srole&&t.value){var id=+t.dataset.srole,r=t.value;ask('Rol oʻzgartirilsinmi?',function(){api('s_role',{id:id,role:r}).then(function(j){S.d.staff=j;toast('✅ Oʻzgartirildi');render();}).catch(function(e2){say(e2.message);});});t.value='';return;}\n});\ntry{W.BackButton.onClick(function(){back();});}catch(e){}\n\nS.d.ra={};S.d.cf={};S.d.bf={text:'',target:'',grp:''};S.d.ivf={role:'teacher'};S.d.tf={files:[],key:'',title:''};S.d.lf={};\nif(!ID){$('app').innerHTML='<div class=\"card empty\">Bu ilova Telegram ichida ochiladi.<br><br><a href=\"https://t.me/ilmzor_test_bot\">@ilmzor_test_bot</a> → «📱 Ilova»</div>';return;}\napi('me').then(function(m){S.me=m;$('hs').textContent=m.roleName;\n  if(!m.sub){S.view='sub';render();return;}\n  if(!m.name){S.view='name';render();return;}\n  var h=location.hash.slice(1);if(h&&VIEWS[h]){S.stack=['home'];if(h==='funnel')S.d.fl=undefined;S.view=h;}render();\n}).catch(function(e){$('app').innerHTML='<div class=\"card empty\">⚠️ '+esc(e.message)+'<br><br><button class=\"btn\" onclick=\"location.reload()\">Qayta urinish</button></div>';});\n})();\n</script>\n</body>\n</html>\n";

// Eski pastki klaviaturani har foydalanuvchida bir marta olib tashlash
async function dropOldKb(env, chat, u) {
  try {
    await appDb(env);
    const k = 'nokb:' + u.id;
    if (await env.DB.prepare('SELECT 1 FROM appcfg WHERE k = ?').bind(k).first()) return;
    await env.DB.prepare('INSERT OR REPLACE INTO appcfg(k, v) VALUES(?, ?)').bind(k, '1').run();
    await send(env, chat, '✨ <b>Bot yangilandi!</b> Barcha boʻlimlar endi ilovada — pastdagi tugmalar kerak emas.\nChap pastdagi <b>«📱 Ilova»</b> tugmasini bosing.', {reply_markup: {remove_keyboard: true}});
  } catch (e) { console.log('dropOldKb', e); }
}
