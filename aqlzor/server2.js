
// ---- 🛍 Mini App 2-bosqich: chek yuklash, natijalar, admin, PDF kitoblar ----
var app2Ready = false;
async function app2Db(env) {
  if (app2Ready) return;
  await keysDb(env);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS tres (id INTEGER PRIMARY KEY AUTOINCREMENT, uid INTEGER, key_id INTEGER, ok INTEGER, n INTEGER, answers TEXT, ts INTEGER)").run();
  for (const q of ["ALTER TABLE books ADD COLUMN pdf TEXT", "ALTER TABLE books ADD COLUMN pdf_name TEXT", "ALTER TABLE orders ADD COLUMN pdf_sent INTEGER DEFAULT 0"]) {
    try { await env.DB.prepare(q).run(); } catch (e) {}
  }
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS seen (uid INTEGER, day TEXT, PRIMARY KEY (uid, day))").run();
  for (const q of ["ALTER TABLE broadcast ADD COLUMN btn INTEGER DEFAULT 0", "ALTER TABLE broadcast ADD COLUMN aud TEXT DEFAULT 'all'", "ALTER TABLE broadcast ADD COLUMN created TEXT", "ALTER TABLE broadcast ADD COLUMN preview TEXT"]) {
    try { await env.DB.prepare(q).run(); } catch (e) {}
  }
  app2Ready = true;
}
var isDigitalOrder = async (env, items) => {
  if (!items.length) return false;
  for (const it of items) {
    const b = await env.DB.prepare("SELECT pdf FROM books WHERE id=?").bind(it.id ?? it.book_id).first();
    if (!b || !b.pdf) return false;
  }
  return true;
};
// To'lov tasdiqlanganda PDF kitoblarni mijozga yuborish
async function deliverPdfs(env, o) {
  try {
    await app2Db(env);
    const fresh = await env.DB.prepare("SELECT pdf_sent FROM orders WHERE id=?").bind(o.id).first();
    if (fresh && fresh.pdf_sent) return;
    const items = JSON.parse(o.items || "[]");
    let sent = 0, all = items.length > 0;
    for (const it of items) {
      const b = await env.DB.prepare("SELECT title, pdf FROM books WHERE id=?").bind(it.id).first();
      if (!b || !b.pdf) { all = false; continue; }
      const r = await tg(env, "sendDocument", { chat_id: o.user_id, document: b.pdf, caption: `\u{1F4D8} ${b.title}\nBuyurtma #${o.id} — xaridingiz uchun rahmat!` });
      if (r.ok) sent++;
    }
    if (!sent) return;
    await env.DB.prepare("UPDATE orders SET pdf_sent=1 WHERE id=?").bind(o.id).run();
    if (all && o.status === "confirmed") {
      await env.DB.prepare("UPDATE orders SET status='done', closed_ts=? WHERE id=?").bind(Date.now(), o.id).run();
      o.status = "done";
      await refreshGroupMsg(env, o, `\n\n\u{1F4C4} PDF kitob mijozga avtomatik yuborildi, ${now()}`);
      await toSheets(env, { type: "status", id: o.id, status: STATUS.done + " (PDF)" });
    }
  } catch (e) {
    console.log("deliverPdfs", e && e.message);
  }
}
// Mini App orqali yuklangan faylni Telegram'ga qo'yib, file_id olish
async function appUploadToTg(env, chatId, file, caption) {
  const isImg = /^image\//.test(file.type || "");
  const fd = new FormData();
  fd.append("chat_id", String(chatId));
  fd.append(isImg ? "photo" : "document", file, file.name || (isImg ? "chek.jpg" : "chek.pdf"));
  if (caption) fd.append("caption", toNewAlphabet(caption));
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${isImg ? "sendPhoto" : "sendDocument"}`, { method: "POST", body: fd }).then((x) => x.json()).catch(() => ({ ok: false }));
  if (!r.ok) return null;
  const m = r.result;
  return fileOf(m);
}
async function appReceipt(env, u, form) {
  const id = Number(form.get("id"));
  const file = form.get("file");
  if (!file || typeof file === "string") return appErr("Chek faylini tanlang");
  if (file.size > 10 * 1024 * 1024) return appErr("Fayl juda katta (10 MB dan oshmasin)");
  if (!/^image\//.test(file.type || "") && file.type !== "application/pdf") return appErr("Chekni rasm yoki PDF qilib yuklang");
  const o = await env.DB.prepare("SELECT * FROM orders WHERE id=? AND user_id=?").bind(id, u.id).first();
  if (!o || !["new", "check"].includes(o.status)) return appErr("Bu buyurtma uchun chek qabul qilinmaydi");
  const f = await appUploadToTg(env, u.id, file, `\u{1F9FE} Buyurtma #${o.id} uchun chek (ilovadan yuborildi)`);
  if (!f) return appErr("Faylni yuborib bo'lmadi, qayta urinib ko'ring", 502);
  await processReceipt(env, u.id, u.id, o.id, f, false);
  const after = await env.DB.prepare("SELECT status FROM orders WHERE id=?").bind(o.id).first();
  if (after && after.status === "check") return appJ({ ok: true, status: "check" });
  return appJ({ ok: false, status: "problem" });
}
async function appReceiptForce(env, u, b) {
  const st = await getState(env, u.id);
  if (!st || st.step !== "receipt_retry" || Number(st.data.id) !== Number(b.id)) return appErr("Chekni qaytadan yuklang");
  await processReceipt(env, u.id, u.id, st.data.id, st.data.f, true);
  return appJ({ ok: true, status: "check" });
}
// ---- test natijalari
async function appTestSave(env, u, b) {
  const k = await env.DB.prepare("SELECT id, answers FROM tkeys WHERE id=?").bind(Number(b.id)).first();
  if (!k) return appErr("Test topilmadi", 404);
  const key = JSON.parse(k.answers || "[]");
  const ans = (Array.isArray(b.answers) ? b.answers : []).slice(0, key.length).map((x) => /^[A-E]$/.test(String(x)) ? String(x) : "");
  const ok = key.reduce((s, x, i) => s + (ans[i] === x ? 1 : 0), 0);
  await env.DB.prepare("INSERT INTO tres (uid, key_id, ok, n, answers, ts) VALUES (?, ?, ?, ?, ?, ?)").bind(u.id, k.id, ok, key.length, JSON.stringify(ans), Date.now()).run();
  return appJ({ ok, n: key.length, results: await appMyResults(env, u.id) });
}
async function appMyResults(env, uid) {
  const { results } = await env.DB.prepare("SELECT r.id, r.key_id, r.ok, r.n, r.ts, k.title, k.book_id, b.title AS btitle FROM tres r JOIN tkeys k ON k.id=r.key_id JOIN books b ON b.id=k.book_id WHERE r.uid=? ORDER BY r.id DESC LIMIT 200").bind(uid).all();
  return (results || []).map((r) => ({ id: r.id, key: r.key_id, book: r.book_id, ok: r.ok, n: r.n, ts: r.ts, title: toNewAlphabet(r.title), btitle: toNewAlphabet(r.btitle) }));
}
// ---- admin
var ADMIN_ST = ["new", "check", "confirmed", "sent", "done", "cancelled"];
async function appAdminOrders(env, b) {
  const f = String(b.filter || "active");
  const where = f === "all" ? "1=1" : f === "active" ? "status IN ('new','check','confirmed','sent')" : "status=?";
  const st = ADMIN_ST.includes(f) ? [f] : [];
  const { results } = await env.DB.prepare(`SELECT * FROM orders WHERE ${where} ORDER BY id DESC LIMIT 40`).bind(...st).all();
  const { results: cnt } = await env.DB.prepare("SELECT status, COUNT(*) AS n FROM orders GROUP BY status").all();
  const out = [];
  for (const o of results || []) {
    const items = JSON.parse(o.items || "[]");
    out.push({
      id: o.id, status: o.status, statusText: toNewAlphabet(STATUS[o.status] || o.status), date: o.created_at, total: o.total,
      name: toNewAlphabet(o.full_name || ""), phone: o.phone, address: toNewAlphabet(o.address || ""), post: toNewAlphabet(o.comment || ""), track: o.track || "",
      user: o.user_id, receipt: !!o.receipt, digital: await isDigitalOrder(env, items),
      items: items.map((i) => ({ title: toNewAlphabet(i.title), qty: i.qty, price: i.price }))
    });
  }
  return appJ({ orders: out, counts: Object.fromEntries((cnt || []).map((r) => [r.status, r.n])) });
}
async function appSetStatus(env, u, b) {
  const o = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(Number(b.id)).first();
  if (!o) return appErr("Buyurtma topilmadi", 404);
  const to = String(b.to || "");
  if (["done", "cancelled"].includes(o.status)) return appErr("Bu buyurtma yopilgan");
  const who = esc([u.first_name, u.last_name].filter(Boolean).join(" ") || u.id);
  const allowed = { new: ["confirmed", "cancelled"], check: ["confirmed", "reject", "cancelled"], confirmed: ["sent", "cancelled"], sent: ["done"] }[o.status] || [];
  if (!allowed.includes(to)) return appErr("Bu holatga o'tkazib bo'lmaydi");
  if (to === "sent") {
    const t = String(b.track || "").trim().slice(0, 60) || null;
    await env.DB.prepare("UPDATE orders SET status='sent', track=?, sent_ts=? WHERE id=?").bind(t, Date.now(), o.id).run();
    o.status = "sent"; o.track = t;
    await refreshGroupMsg(env, o, `\n\n✍️ Pochtaga topshirdi: ${who}, ${now()}`);
    await send(env, o.user_id, `\u{1F9FE} Buyurtma #${o.id}\n\n${CUSTOMER_STATUS_TEXT.sent}` + (t ? `\n\n\u{1F4E6} Trek raqami: <code>${esc(t)}</code>\nPosilkani pochta saytida shu raqam bilan kuzatishingiz mumkin.` : ""));
    await toSheets(env, { type: "status", id: o.id, status: STATUS.sent + (t ? " (" + t + ")" : "") });
    return appJ({ ok: true });
  }
  const reject = to === "reject";
  const ns = reject ? "new" : to;
  await env.DB.prepare("UPDATE orders SET status=? WHERE id=?").bind(ns, o.id).run();
  if (ns === "confirmed") await env.DB.prepare("UPDATE orders SET paid_ts=? WHERE id=?").bind(Date.now(), o.id).run();
  if (ns === "cancelled" || ns === "done") await env.DB.prepare("UPDATE orders SET closed_ts=? WHERE id=?").bind(Date.now(), o.id).run();
  if (reject) await env.DB.prepare("UPDATE orders SET created_ts=?, reminded=1 WHERE id=?").bind(Date.now(), o.id).run();
  o.status = ns;
  await refreshGroupMsg(env, o, `\n\n✍️ ${reject ? "Chek rad etildi" : "Oxirgi o'zgarish"}: ${who}, ${now()} (ilovadan)`);
  if (reject) await send(env, o.user_id, `\u{1F9FE} Buyurtma #${o.id}\n\n\u{1F6AB} Chek tasdiqlanmadi. Iltimos, to'lov summasi va karta raqamini tekshirib, chekni qayta yuboring.`, payButton(o.id));
  else if (CUSTOMER_STATUS_TEXT[ns]) await send(env, o.user_id, `\u{1F9FE} Buyurtma #${o.id}\n\n${CUSTOMER_STATUS_TEXT[ns]}`);
  await toSheets(env, { type: "status", id: o.id, status: reject ? "\u{1F6AB} Chek rad etildi" : STATUS[ns] });
  if (ns === "confirmed") await deliverPdfs(env, o);
  return appJ({ ok: true });
}
async function appAdminReceipt(env, b) {
  const o = await env.DB.prepare("SELECT receipt, receipt_kind FROM orders WHERE id=?").bind(Number(b.id)).first();
  if (!o || !o.receipt) return new Response("not found", { status: 404 });
  const f = await tg(env, "getFile", { file_id: o.receipt });
  if (!f.ok) return new Response("not found", { status: 404 });
  const r = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${f.result.file_path}`);
  const ct = /\.pdf$/i.test(f.result.file_path) ? "application/pdf" : "image/jpeg";
  return new Response(r.body, { headers: { "content-type": ct, "cache-control": "no-store" } });
}
async function appAdminBooks(env) {
  const { results } = await env.DB.prepare("SELECT id, cat, title, price, active, photo, pdf, pdf_name, sort FROM books ORDER BY sort, id").all();
  const cats = await getCats(env, true);
  return appJ({ books: (results || []).map((b) => ({ id: b.id, cat: b.cat, title: toNewAlphabet(b.title), price: b.price, active: !!b.active, photo: b.photo ? String(b.photo).slice(-12) : "", pdf: !!b.pdf, pdfName: b.pdf_name || "" })), cats: cats.map((c) => ({ key: c.key, title: toNewAlphabet(c.title) })) });
}
async function appAdminBookSave(env, u, b) {
  const id = Number(b.id);
  const before = await env.DB.prepare("SELECT * FROM books WHERE id=?").bind(id).first();
  if (!before) return appErr("Kitob topilmadi", 404);
  if (b.price !== void 0) {
    const p = Math.max(0, Math.round(Number(String(b.price).replace(/\D/g, "")) || 0));
    await env.DB.prepare("UPDATE books SET price=? WHERE id=?").bind(p, id).run();
    if (p > 0 && !(before.price > 0)) {
      const { results: waiting } = await env.DB.prepare("SELECT DISTINCT user_id FROM cart WHERE book_id=? LIMIT 40").bind(id).all();
      for (const w of waiting || []) await send(env, w.user_id, `\u{1F514} <b>${esc(before.title)}</b> kitobining narxi e'lon qilindi: <b>${money(p)}</b>\n\nU savatchangizda turibdi — do'konni ochib buyurtma berishingiz mumkin \u{1F447}`, ik([[{ text: "\u{1F6CD} Do'konni ochish", web_app: { url: APP_ORIGIN + "/app#cart" } }]]));
    }
  }
  if (b.active !== void 0) await env.DB.prepare("UPDATE books SET active=? WHERE id=?").bind(b.active ? 1 : 0, id).run();
  if (b.removePdf) await env.DB.prepare("UPDATE books SET pdf=NULL, pdf_name=NULL WHERE id=?").bind(id).run();
  return appAdminBooks(env);
}
async function appAdminBookNew(env, u, b) {
  const title = toOldAlphabet(String(b.title || "").trim()).slice(0, 120);
  if (title.length < 3) return appErr("Kitob nomini yozing");
  const cat = String(b.cat || "");
  if (!(await getCats(env, true)).some((c) => c.key === cat)) return appErr("Bo'limni tanlang");
  const price = Math.max(0, Math.round(Number(String(b.price || "0").replace(/\D/g, "")) || 0));
  const mx = await env.DB.prepare("SELECT COALESCE(MAX(sort),0) AS s FROM books").first();
  await env.DB.prepare("INSERT INTO books (cat, title, description, price, sort) VALUES (?, ?, ?, ?, ?)").bind(cat, title, toOldAlphabet(String(b.desc || "").trim()).slice(0, 1000), price, (mx?.s || 0) + 1).run();
  return appAdminBooks(env);
}
async function appAdminPdf(env, u, form) {
  const id = Number(form.get("id"));
  const file = form.get("file");
  if (!file || typeof file === "string") return appErr("PDF faylni tanlang");
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name || "")) return appErr("Faqat PDF fayl yuklang");
  if (file.size > 49 * 1024 * 1024) return appErr("Fayl 49 MB dan katta bo'lmasin");
  const book = await env.DB.prepare("SELECT title FROM books WHERE id=?").bind(id).first();
  if (!book) return appErr("Kitob topilmadi", 404);
  const f = await appUploadToTg(env, u.id, new File([file], file.name || "kitob.pdf", { type: "application/pdf" }), `\u{1F4C4} «${book.title}» PDF fayli saqlandi. Bu fayl to'lov tasdiqlangan mijozlarga avtomatik yuboriladi.`);
  if (!f) return appErr("Faylni Telegram'ga yuklab bo'lmadi", 502);
  await env.DB.prepare("UPDATE books SET pdf=?, pdf_name=? WHERE id=?").bind(f.fid, String(file.name || "kitob.pdf").slice(0, 120), id).run();
  return appAdminBooks(env);
}
var shopKb = (hash) => ik([[{ text: "\u{1F6CD} Do'konni ochish", web_app: { url: APP_ORIGIN + "/app" + (hash ? "#" + hash : "") } }]]);

// ---- 📖 Namuna va PDF kitobni ilova ichida ochish ----
async function appTgFile(env, fileId, type) {
  const f = await tg(env, "getFile", { file_id: fileId });
  if (!f || !f.ok) return null;
  const r = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${f.result.file_path}`);
  if (!r.ok) return null;
  return new Response(r.body, { headers: { "content-type": type || r.headers.get("content-type") || "application/octet-stream", "cache-control": "private, max-age=3600" } });
}
async function appSampleFile(env, id) {
  const s = await env.DB.prepare("SELECT file_id, kind FROM samples WHERE id=?").bind(id).first();
  if (!s) return new Response("not found", { status: 404 });
  const type = s.kind === "photo" ? "image/jpeg" : s.kind === "video" ? "video/mp4" : s.kind === "document" ? "application/pdf" : undefined;
  return (await appTgFile(env, s.file_id, type)) || new Response("not found", { status: 404 });
}
async function appMyPdf(env, u, bookId) {
  const book = await env.DB.prepare("SELECT title, pdf, pdf_name FROM books WHERE id=?").bind(bookId).first();
  if (!book || !book.pdf) return appErr("Bu kitobning PDF fayli yo'q", 404);
  const { results } = await env.DB.prepare("SELECT items FROM orders WHERE user_id=? AND status IN ('confirmed','sent','done')").bind(u.id).all();
  const owns = (results || []).some((o) => JSON.parse(o.items || "[]").some((i) => (i.id ?? i.book_id) === bookId));
  if (!owns && !isAdmin(env, u.id)) return appErr("Bu kitob sizning to'langan buyurtmalaringizda yo'q", 403);
  const r = await appTgFile(env, book.pdf, "application/pdf");
  if (r) return r;
  await tg(env, "sendDocument", { chat_id: u.id, document: book.pdf, caption: toNewAlphabet("\u{1F4C4} " + book.title), protect_content: true });
  return appErr("Fayl katta — u bot chatiga yuborildi", 413);
}

// ---- 📊 Statistika va 📢 xabar yuborish (admin) ----
var tzDay = (offsetDays = 0) => new Date(Date.now() + 5 * 3600 * 1e3 - offsetDays * 864e5).toISOString().slice(0, 10);
async function appSeen(env, uid) {
  try { await env.DB.prepare("INSERT OR IGNORE INTO seen (uid, day) VALUES (?, ?)").bind(uid, tzDay()).run(); } catch (e) {}
}
var PAID_ST = "('confirmed','sent','done')";
async function appAdminStats(env) {
  const one = async (q, ...a) => (await env.DB.prepare(q).bind(...a).first()) || {};
  const d0 = tzDay(), d7 = tzDay(6), d30 = tzDay(29), m0 = d0.slice(0, 7);
  const users = await one("SELECT COUNT(*) AS all_n, SUM(CASE WHEN blocked=1 THEN 1 ELSE 0 END) AS blocked, SUM(CASE WHEN substr(created_at,1,10)=? THEN 1 ELSE 0 END) AS new1, SUM(CASE WHEN substr(created_at,1,10)>=? THEN 1 ELSE 0 END) AS new7, SUM(CASE WHEN substr(created_at,1,10)>=? THEN 1 ELSE 0 END) AS new30 FROM users", d0, d7, d30);
  const act = await one("SELECT COUNT(DISTINCT CASE WHEN day=? THEN uid END) AS a1, COUNT(DISTINCT CASE WHEN day>=? THEN uid END) AS a7, COUNT(DISTINCT uid) AS a30 FROM seen WHERE day>=?", d0, d7, d30);
  const reg = await one("SELECT COUNT(*) AS n FROM (SELECT uid FROM seen WHERE day>=? GROUP BY uid HAVING COUNT(*)>=3)", d30);
  const firstSeen = await one("SELECT MIN(day) AS d FROM seen");
  const ord = await one(`SELECT COUNT(*) AS n, COUNT(DISTINCT user_id) AS buyers, COALESCE(SUM(total),0) AS sum, SUM(CASE WHEN substr(created_at,1,7)=? THEN 1 ELSE 0 END) AS mn, COALESCE(SUM(CASE WHEN substr(created_at,1,7)=? THEN total ELSE 0 END),0) AS msum FROM orders WHERE status IN ${PAID_ST}`, m0, m0);
  const pend = await one("SELECT COUNT(*) AS n FROM orders WHERE status IN ('new','check')");
  const rep = await one("SELECT COUNT(*) AS n FROM (SELECT user_id FROM orders WHERE status IN " + PAID_ST + " GROUP BY user_id HAVING COUNT(*)>=2)");
  const tst = await one("SELECT COUNT(*) AS n, COUNT(DISTINCT uid) AS u FROM tres");
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(tzDay(i));
  const { results: nd } = await env.DB.prepare("SELECT substr(created_at,1,10) AS d, COUNT(*) AS n FROM users WHERE substr(created_at,1,10)>=? GROUP BY d").bind(days[0]).all();
  const { results: ad } = await env.DB.prepare("SELECT day AS d, COUNT(*) AS n FROM seen WHERE day>=? GROUP BY day").bind(days[0]).all();
  const mp = (r) => Object.fromEntries((r || []).map((x) => [x.d, x.n]));
  const NM = mp(nd), AM = mp(ad);
  const { results: rows } = await env.DB.prepare("SELECT items FROM orders WHERE status IN " + PAID_ST).all();
  const top = {};
  for (const o of rows || []) for (const it of JSON.parse(o.items || "[]")) { const k = toNewAlphabet(it.title || ""); top[k] = (top[k] || 0) + (it.qty || 1); }
  return appJ({
    users: { all: users.all_n || 0, live: (users.all_n || 0) - (users.blocked || 0), blocked: users.blocked || 0, new1: users.new1 || 0, new7: users.new7 || 0, new30: users.new30 || 0 },
    active: { d1: act.a1 || 0, d7: act.a7 || 0, d30: act.a30 || 0, regular: reg.n || 0, since: firstSeen.d || d0 },
    orders: { n: ord.n || 0, buyers: ord.buyers || 0, repeat: rep.n || 0, sum: ord.sum || 0, month: ord.mn || 0, msum: ord.msum || 0, pending: pend.n || 0 },
    tests: { n: tst.n || 0, users: tst.u || 0 },
    chart: days.map((d) => ({ d: d.slice(8, 10) + "." + d.slice(5, 7), nw: NM[d] || 0, ac: AM[d] || 0 })),
    top: Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 5)
  });
}
async function appBcCount(env, aud) {
  const q = aud === "buyers" ? "SELECT COUNT(*) AS n FROM users WHERE blocked=0 AND id IN (SELECT user_id FROM orders WHERE status IN " + PAID_ST + ")" : aud === "active30" ? "SELECT COUNT(*) AS n FROM users WHERE blocked=0 AND id IN (SELECT uid FROM seen WHERE day>=?)" : "SELECT COUNT(*) AS n FROM users WHERE blocked=0";
  const st = env.DB.prepare(q);
  return ((aud === "active30" ? await st.bind(tzDay(29)).first() : await st.first()) || {}).n || 0;
}
async function appAdminBcList(env) {
  const { results } = await env.DB.prepare("SELECT id, sent, failed, done, aud, created, preview FROM broadcast ORDER BY id DESC LIMIT 6").all();
  const counts = { all: await appBcCount(env, "all"), active30: await appBcCount(env, "active30"), buyers: await appBcCount(env, "buyers") };
  return appJ({ list: results || [], counts });
}
async function appAdminBc(env, u, form, b) {
  const g = (k) => form ? form.get(k) : b[k];
  const text = String(g("text") || "").trim();
  const aud = ["all", "active30", "buyers"].includes(g("aud")) ? g("aud") : "all";
  const btn = String(g("btn")) === "1" ? 1 : 0;
  const photo = form ? form.get("file") : null;
  if (!text && !photo) return appErr("Xabar matnini yozing");
  if (text.length > (photo ? 1000 : 4000)) return appErr(photo ? "Rasm ostidagi matn 1000 belgidan oshmasin" : "Matn juda uzun");
  const running = await env.DB.prepare("SELECT id FROM broadcast WHERE done=0 LIMIT 1").first();
  if (running) return appErr("Oldingi xabar hali tarqatilmoqda, tugashini kuting");
  const markup = btn ? shopKb().reply_markup : undefined;
  let r;
  if (photo && typeof photo !== "string") {
    const fd = new FormData();
    fd.append("chat_id", String(u.id));
    fd.append("photo", photo, photo.name || "rasm.jpg");
    if (text) fd.append("caption", toNewAlphabet(text));
    if (markup) fd.append("reply_markup", JSON.stringify(markup));
    r = await (await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`, { method: "POST", body: fd })).json().catch(() => ({ ok: false }));
  } else {
    r = await tg(env, "sendMessage", { chat_id: u.id, text, ...(markup ? { reply_markup: markup } : {}) });
  }
  if (!r || !r.ok) return appErr("Xabarni tayyorlab bo'lmadi. Botga /start yozib, qayta urinib ko'ring");
  const n = await appBcCount(env, aud);
  await env.DB.prepare("INSERT INTO broadcast (from_chat, msg_id, admin, btn, aud, created, preview) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(u.id, r.result.message_id, u.id, btn, aud, now(), (photo ? "🖼 " : "") + toNewAlphabet(text).slice(0, 80)).run();
  return appJ({ ok: true, n });
}
