
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
