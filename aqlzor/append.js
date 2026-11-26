
// ---- 🛍 Telegram Mini App: /app (kitob do'koni Telegram ichida) ----
var APP_ORIGIN = "https://aqlzor-bot.nomonovnosirbek15.workers.dev";
var APP_MENU_V = "v1";
var appJ = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
var appErr = (m, s) => appJ({ error: toNewAlphabet(m) }, s || 400);
async function appUser(env, initData) {
  if (!initData || !env.BOT_TOKEN) return null;
  const p = new URLSearchParams(String(initData));
  const hash = p.get("hash");
  if (!hash) return null;
  p.delete("hash");
  const dcs = [...p.entries()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).map(([k, v]) => k + "=" + v).join("\n");
  const enc = new TextEncoder(), H = { name: "HMAC", hash: "SHA-256" };
  const k1 = await crypto.subtle.importKey("raw", enc.encode("WebAppData"), H, false, ["sign"]);
  const secret = await crypto.subtle.sign("HMAC", k1, enc.encode(String(env.BOT_TOKEN).trim()));
  const k2 = await crypto.subtle.importKey("raw", secret, H, false, ["sign"]);
  const hex = [...new Uint8Array(await crypto.subtle.sign("HMAC", k2, enc.encode(dcs)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex !== hash) return null;
  if (Date.now() / 1e3 - Number(p.get("auth_date") || 0) > 86400) return null;
  try {
    const u = JSON.parse(p.get("user") || "null");
    return u && u.id ? u : null;
  } catch (e) {
    return null;
  }
}
async function appCart(env, uid) {
  return (await getCart(env, uid)).map((c) => ({ id: c.book_id, qty: c.qty, title: toNewAlphabet(c.title), price: c.price }));
}
async function appCatalog(env, u) {
  await env.DB.prepare(
    "INSERT INTO users (id, name, username, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET username=excluded.username, blocked=0"
  ).bind(u.id, [u.first_name, u.last_name].filter(Boolean).join(" "), u.username || "", now()).run();
  const cats = await getCats(env);
  const keys = new Set(cats.map((c) => c.key));
  const { results } = await env.DB.prepare(
    "SELECT b.id, b.cat, b.title, b.description, b.price, b.photo, b.pdf, (SELECT COUNT(*) FROM samples s WHERE s.book_id=b.id) AS smp, (SELECT COUNT(*) FROM tkeys k WHERE k.book_id=b.id) AS nk FROM books b WHERE b.active=1 ORDER BY b.sort, b.id"
  ).all();
  const usr = await env.DB.prepare("SELECT name, phone, address FROM users WHERE id=?").bind(u.id).first();
  const orders = await env.DB.prepare("SELECT name FROM users WHERE id=? AND phone IS NOT NULL AND phone<>''").bind(u.id).first();
  return {
    cats: cats.map((c) => ({ key: c.key, title: toNewAlphabet(c.title) })),
    books: (results || []).filter((b) => keys.has(b.cat)).map((b) => ({ id: b.id, cat: b.cat, title: toNewAlphabet(b.title), desc: toNewAlphabet(b.description || ""), price: b.price, photo: b.photo ? String(b.photo).slice(-12) : "", smp: b.smp, pdf: !!b.pdf, nk: b.nk })),
    cart: await appCart(env, u.id),
    user: orders && usr ? { name: toNewAlphabet(usr.name || ""), phone: usr.phone || "", address: usr.address || "", addressShow: toNewAlphabet(usr.address || "") } : { name: toNewAlphabet([u.first_name, u.last_name].filter(Boolean).join(" ")), phone: "", address: "" },
    regions: Object.entries(REGIONS).map(([r, ds]) => [r, toNewAlphabet(r), ds.map((d) => [d, toNewAlphabet(d)])]),
    contact: toNewAlphabet(await getSetting(env, "contact_info", ""))
  };
}
async function appImage(env, id, ctx, request) {
  const cache = caches.default;
  const key = new Request(request.url);
  const hit = await cache.match(key);
  if (hit) return hit;
  const b = await env.DB.prepare("SELECT photo FROM books WHERE id=? AND active=1").bind(id).first();
  if (!b || !b.photo) return new Response("not found", { status: 404 });
  const f = await tg(env, "getFile", { file_id: b.photo });
  if (!f.ok || !f.result?.file_path) return new Response("not found", { status: 404 });
  const r = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${f.result.file_path}`);
  if (!r.ok) return new Response("not found", { status: 404 });
  const res = new Response(r.body, { headers: { "content-type": r.headers.get("content-type") || "image/jpeg", "cache-control": "public, max-age=604800" } });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
async function appOrder(env, u, b) {
  const name = toOldAlphabet(String(b.name || "").replace(/\s+/g, " ").trim()).slice(0, 100);
  if (name.length < 3) return appErr("Ism va familiyangizni to'liq yozing");
  let phone = String(b.phone || "").trim();
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15) return appErr("Telefon raqam noto'g'ri. Masalan: +998 90 123 45 67");
  if (digits.length === 9) phone = "+998" + digits;
  else phone = "+" + digits;
  let address = "";
  const digital = await isDigitalOrder(env, orderable(await getCart(env, u.id)));
  if (digital) {
    address = "PDF kitob (elektron)";
  } else if (b.region) {
    const region = String(b.region);
    if (!REGIONS[region]) return appErr("Viloyatni ro'yxatdan tanlang");
    const district = toOldAlphabet(String(b.district || "").trim()).slice(0, 60);
    const street = toOldAlphabet(String(b.street || "").trim()).slice(0, 150);
    if (district.length < 2) return appErr("Tuman yoki shaharni tanlang");
    if (street.length < 3) return appErr("Mahalla, ko'cha va uy raqamini yozing");
    address = [region, district, street].join(", ");
  } else {
    address = toOldAlphabet(String(b.address || "").trim()).slice(0, 300);
    if (address.length < 8) return appErr("Manzilni batafsilroq yozing (viloyat, tuman, ko'cha, uy)");
  }
  const comment = digital ? "PDF — bot orqali yuboriladi" : toOldAlphabet(String(b.comment || "").trim()).slice(0, 300);
  if (!digital && comment.length < 5) return appErr("Yaqin BTS yoki EMU pochta bo'limi manzilini yozing");
  const last = await env.DB.prepare("SELECT created_ts FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 1").bind(u.id).first();
  if (last && Date.now() - (last.created_ts || 0) < 15e3) return appErr("Buyurtma hozirgina yuborildi. Bir necha soniya kuting.", 429);
  await clearState(env, u.id);
  const o = await createOrder(env, u.id, { name, phone, address, comment });
  if (!o) return appErr("Savatchada narxi e'lon qilingan kitob yo'q");
  await send(env, u.id, `\u{1F389} <b>Buyurtmangiz qabul qilindi!</b>
Buyurtma raqami: <b>#${o.id}</b>`, await mainKb(env, u.id));
  let pi = await payInstructions(env, o);
  if (digital) pi = pi.replace(/\n<i>\(pochta xizmati haqi[^<]*<\/i>/, "").replace("kitoblaringiz pochta orqali jo'natiladi", "PDF kitob shu chatga avtomatik yuboriladi");
  await send(env, u.id, pi, payButton(o.id));
  await notifyAdmins(env, o);
  const items = JSON.parse(o.items);
  await toSheets(env, {
    type: "order",
    id: o.id,
    date: o.created_at,
    name: o.full_name,
    phone: o.phone,
    address: o.address,
    comment: o.comment,
    items: items.map((it) => `${it.title} \xD7 ${it.qty}`).join("; "),
    qty: items.reduce((s, it) => s + it.qty, 0),
    total: o.total,
    status: STATUS.new,
    user_id: o.user_id
  });
  return appJ({ ok: true, id: o.id, total: o.total, digital, payInfo: toNewAlphabet(await getSetting(env, "payment_info", "")), cart: await appCart(env, u.id) });
}
async function appRoute(request, url, env, ctx) {
  const p = url.pathname;
  if (request.method === "GET" && (p === "/app" || p === "/app/")) return new Response(APP_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  const im = p.match(/^\/app\/img\/(\d+)$/);
  if (request.method === "GET" && im) return appImage(env, Number(im[1]), ctx, request);
  const smf = p.match(/^\/app\/smp\/(\d+)$/);
  if (request.method === "GET" && smf) return appSampleFile(env, Number(smf[1]));
  if (request.method !== "POST" || !p.startsWith("/app/api/")) return new Response("not found", { status: 404 });
  const multipart = /multipart\/form-data/i.test(request.headers.get("content-type") || "");
  const form = multipart ? await request.formData().catch(() => null) : null;
  const b = form ? { initData: form.get("initData") } : await request.json().catch(() => ({}));
  const u = await appUser(env, b.initData);
  if (!u) return appErr("Do'konni botdan qayta oching", 403);
  await app2Db(env);
  ctx && ctx.waitUntil ? ctx.waitUntil(appSeen(env, u.id)) : await appSeen(env, u.id);
  const op = p.slice("/app/api/".length);
  if (op === "receipt" && form) return appReceipt(env, u, form);
  if (op === "receipt_force") return appReceiptForce(env, u, b);
  if (op === "tsave") return appTestSave(env, u, b);
  if (op.startsWith("a_")) {
    if (!isAdmin(env, u.id)) return appErr("Faqat adminlar uchun", 403);
    if (op === "a_orders") return appAdminOrders(env, b);
    if (op === "a_status") return appSetStatus(env, u, b);
    if (op === "a_receipt") return appAdminReceipt(env, b);
    if (op === "a_books") return appAdminBooks(env);
    if (op === "a_book") return appAdminBookSave(env, u, b);
    if (op === "a_new") return appAdminBookNew(env, u, b);
    if (op === "a_pdf" && form) return appAdminPdf(env, u, form);
    if (op === "a_stats") return appAdminStats(env);
    if (op === "a_bcs") return appAdminBcList(env);
    if (op === "a_bc") return appAdminBc(env, u, form, b);
    return appErr("Noma'lum so'rov", 404);
  }
  if (op === "catalog") return appJ({ ...(await appCatalog(env, u)), admin: isAdmin(env, u.id) });
  if (op === "keys") return appJ({ keys: await keysList(env), results: await appMyResults(env, u.id) });
  if (op === "kadd" || op === "kdel") {
    if (!isAdmin(env, u.id)) return appErr("Faqat adminlar uchun", 403);
    if (op === "kadd") return keysAdd(env, b);
    await keysDb(env); await env.DB.prepare("DELETE FROM tkeys WHERE id=?").bind(Number(b.id)).run();
    return appJ({ ok: true, keys: await keysList(env) });
  }
  if (op === "cart") {
    const id = Number(b.book_id), q = Math.max(0, Math.min(20, Math.round(Number(b.qty) || 0)));
    const book = await env.DB.prepare("SELECT id, pdf FROM books WHERE id=? AND active=1").bind(id).first();
    if (!book) return appErr("Bu kitob hozir mavjud emas");
    if (book.pdf && q > 1) return appErr("PDF kitob bitta nusxada sotiladi");
    if (q === 0) await env.DB.prepare("DELETE FROM cart WHERE user_id=? AND book_id=?").bind(u.id, id).run();
    else await env.DB.prepare("INSERT INTO cart (user_id, book_id, qty) VALUES (?, ?, ?) ON CONFLICT(user_id, book_id) DO UPDATE SET qty=excluded.qty").bind(u.id, id, q).run();
    return appJ({ cart: await appCart(env, u.id) });
  }
  if (op === "order") return appOrder(env, u, b);
  if (op === "orders") {
    const { results } = await env.DB.prepare("SELECT id, created_at, status, total, items, track FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 20").bind(u.id).all();
    const { results: pb } = await env.DB.prepare("SELECT id FROM books WHERE pdf IS NOT NULL AND pdf<>''").all();
    const pdfIds = new Set((pb || []).map((x) => x.id));
    const paid = (st) => st === "confirmed" || st === "sent" || st === "done";
    return appJ({ payInfo: toNewAlphabet(await getSetting(env, "payment_info", "")), orders: (results || []).map((o) => ({ id: o.id, date: o.created_at, status: toNewAlphabet(STATUS[o.status] || o.status), st: o.status, pay: o.status === "new", total: o.total, track: o.track || "", items: JSON.parse(o.items || "[]").map((i) => { const bid = i.id ?? i.book_id; return { id: bid, title: toNewAlphabet(i.title), qty: i.qty, pdf: paid(o.status) && pdfIds.has(bid) }; }) })) });
  }
  if (op === "samples") {
    const { results } = await env.DB.prepare("SELECT id, kind FROM samples WHERE book_id=? ORDER BY id").bind(Number(b.book_id)).all();
    return appJ({ samples: results || [] });
  }
  if (op === "mypdf") return appMyPdf(env, u, Number(b.book_id));
  if (op === "sample") {
    if (!await sampleCount(env, Number(b.book_id))) return appErr("Bu kitob uchun namuna hali qo'shilmagan");
    await sendSamples(env, u.id, Number(b.book_id));
    return appJ({ ok: true });
  }
  return appErr("Noma'lum so'rov", 404);
}
async function appMenu(env) {
  if (await getSetting(env, "app_menu", "") === APP_MENU_V) return;
  const t = await tg(env, "setChatMenuButton", { menu_button: { type: "web_app", text: "\u{1F6CD} Do'kon", web_app: { url: APP_ORIGIN + "/app" } } });
  if (t && t.ok) await setSetting(env, "app_menu", APP_MENU_V);
}

// ---- ✅ Javoblar: kitoblardagi testlar kaliti (hammaga ochiq) ----
var keysReady = false;
async function keysDb(env) {
  if (keysReady) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS tkeys (id INTEGER PRIMARY KEY AUTOINCREMENT, book_id INTEGER, title TEXT, sort INTEGER DEFAULT 0, answers TEXT, created INTEGER)").run();
  keysReady = true;
}
var CYR = { "А": "A", "Б": "B", "В": "C", "Г": "D", "Д": "E" };
function parseKey(s) {
  s = String(s || "").toUpperCase().replace(/[А-Д]/g, (c) => CYR[c]);
  const out = [];
  const re = /(\d{1,3})\s*[-).:=]?\s*([A-E])(?![A-Z])/g;
  let m, numbered = false;
  while (m = re.exec(s)) {
    numbered = true;
    const i = Number(m[1]);
    if (i >= 1 && i <= 300) out[i - 1] = m[2];
  }
  if (numbered) return out.length && !out.includes(void 0) && out.every(Boolean) ? out : null;
  const letters = s.replace(/[^A-E]/g, "");
  return letters.length ? letters.split("") : null;
}
async function keysList(env) {
  await keysDb(env);
  const { results } = await env.DB.prepare("SELECT k.id, k.book_id, k.title, k.answers, b.title AS btitle, b.sort AS bsort FROM tkeys k JOIN books b ON b.id=k.book_id ORDER BY b.sort, b.id, k.sort, k.id").all();
  const books = [];
  for (const r of results || []) {
    let b = books[books.length - 1];
    if (!b || b.id !== r.book_id) books.push(b = { id: r.book_id, title: toNewAlphabet(r.btitle), tests: [] });
    b.tests.push({ id: r.id, title: toNewAlphabet(r.title), key: JSON.parse(r.answers || "[]") });
  }
  return books;
}
async function keysAdd(env, b) {
  await keysDb(env);
  const book = await env.DB.prepare("SELECT id FROM books WHERE id=?").bind(Number(b.book_id)).first();
  if (!book) return appErr("Kitobni tanlang");
  const lines = String(b.text || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return appErr("Kalitlarni yozing");
  const mx = await env.DB.prepare("SELECT COALESCE(MAX(sort),0) AS m FROM tkeys WHERE book_id=?").bind(book.id).first();
  let sort = mx.m, added = [];
  const bad = [];
  for (const line of lines) {
    const ix = line.lastIndexOf(":");
    if (ix < 1) { bad.push(line); continue; }
    const title = toOldAlphabet(line.slice(0, ix).trim()).slice(0, 80), ans = parseKey(line.slice(ix + 1));
    if (!title || !ans) { bad.push(line); continue; }
    added.push(env.DB.prepare("INSERT INTO tkeys (book_id, title, sort, answers, created) VALUES (?, ?, ?, ?, ?)").bind(book.id, title, ++sort, JSON.stringify(ans), Date.now()));
  }
  if (bad.length) return appErr("Bu qatorlarni tushunmadim:\n" + bad.slice(0, 3).join("\n") + "\n\nNamuna: 1-dars 1-test: 1A 2C 3B 4D");
  await env.DB.batch(added);
  return appJ({ ok: true, added: added.length, keys: await keysList(env) });
}

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

var APP_HTML = "<!DOCTYPE html>\n<html lang=\"uz\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover\">\n<title>Aqlzor kitob dökoni</title>\n<script src=\"https://telegram.org/js/telegram-web-app.js\"></script>\n<style>\n:root{--ind:#23205E;--ind2:#3a3690;--amb:#F5A524;--bg:#f4f3f8;--card:#fff;--ink:#1b1a33;--ink2:#6b6a83;--line:#e6e4ef;--ok:#14845a;--bad:#c0392b}\n*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}\nhtml,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.4 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,system-ui,sans-serif}\nbutton{font:inherit;cursor:pointer}\nheader{background:var(--ind);color:#fff;padding:14px 16px 12px;position:sticky;top:0;z-index:5}\n.brand{display:flex;align-items:center;gap:10px}\n.brand b{font-size:19px;letter-spacing:.2px}\n.brand small{display:block;color:#c9c6f2;font-size:12px;margin-top:1px}\n.tabs{display:flex;flex-wrap:wrap;gap:6px 8px;margin-top:10px}\n.tabs::-webkit-scrollbar{display:none}\n.tab{flex:none;border:0;border-radius:20px;padding:7px 12px;background:rgba(255,255,255,.12);color:#fff;font-weight:600;font-size:14px;white-space:nowrap}\n.tab.on{background:var(--amb);color:var(--ind)}\nmain{padding:14px 12px 110px;max-width:720px;margin:0 auto}\n.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}\n@media(min-width:560px){.grid{grid-template-columns:repeat(3,1fr)}}\n.bk{background:var(--card);border-radius:14px;overflow:hidden;box-shadow:0 1px 4px rgba(35,32,94,.08);display:flex;flex-direction:column}\n.cov{aspect-ratio:3/4;background:linear-gradient(150deg,var(--ind),var(--ind2));position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden}\n.cov img{width:100%;height:100%;object-fit:cover;display:block}\n.cov .ph{color:#fff;text-align:center;padding:12px;font-weight:700;font-size:14px;line-height:1.25}\n.cov .ph i{display:block;width:26px;height:4px;background:var(--amb);border-radius:2px;margin:0 auto 10px}\n.cov .badge{position:absolute;left:8px;top:8px;background:var(--amb);color:var(--ind);font-size:11px;font-weight:800;padding:3px 7px;border-radius:8px}\n.bi{padding:10px 10px 12px;display:flex;flex-direction:column;gap:6px;flex:1}\n.bt{font-weight:700;font-size:14px;line-height:1.25;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}\n.pr{font-weight:800;color:var(--ind)}\n.pr.soon{color:var(--ink2);font-weight:600;font-size:13px}\n.sp{flex:1}\n.add{border:0;border-radius:10px;background:var(--ind);color:#fff;font-weight:700;padding:9px 6px;width:100%}\n.add.soft{background:#ecebf6;color:var(--ind)}\n.step{display:flex;align-items:center;justify-content:space-between;background:#ecebf6;border-radius:10px;overflow:hidden}\n.step button{border:0;background:none;width:38px;height:36px;font-size:20px;font-weight:700;color:var(--ind)}\n.step span{font-weight:800}\n.empty{text-align:center;color:var(--ink2);padding:40px 16px}\n.bar{position:fixed;left:0;right:0;bottom:0;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:linear-gradient(transparent,var(--bg) 35%);z-index:6}\n.bar .in{max-width:720px;margin:0 auto;display:flex;gap:8px}\n.big{flex:1;border:0;border-radius:14px;background:var(--amb);color:var(--ind);font-weight:800;font-size:16px;padding:14px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 4px 14px rgba(245,165,36,.35)}\n.big:disabled{opacity:.6}\n.big.ind{background:var(--ind);color:#fff;box-shadow:0 4px 14px rgba(35,32,94,.3)}\n.ghostb{border:0;border-radius:14px;background:#fff;color:var(--ind);font-weight:700;padding:14px 16px;box-shadow:0 1px 4px rgba(35,32,94,.12)}\n.card{background:var(--card);border-radius:14px;padding:14px;box-shadow:0 1px 4px rgba(35,32,94,.08);margin-bottom:12px}\nh2{font-size:18px;margin:2px 0 12px}\nh3{font-size:15px;margin:0 0 8px}\n.ci{display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}\n.ci:last-child{border-bottom:0}\n.ci .th{width:46px;height:60px;border-radius:6px;background:linear-gradient(150deg,var(--ind),var(--ind2));flex:none;overflow:hidden}\n.ci .th img{width:100%;height:100%;object-fit:cover}\n.ci .nm{flex:1;min-width:0}\n.ci .nm b{display:block;font-size:14px;line-height:1.25}\n.ci .nm small{color:var(--ink2)}\n.ci .step{width:112px;flex:none}\n.tot{display:flex;justify-content:space-between;font-size:17px;font-weight:800;margin-top:10px}\n.note{color:var(--ink2);font-size:13px;margin-top:8px}\nlabel{display:block;font-weight:700;font-size:13px;margin:12px 0 5px;color:var(--ind)}\ninput,select,textarea{width:100%;font:inherit;border:1.5px solid var(--line);border-radius:10px;padding:11px 12px;background:#fff;color:var(--ink);outline:0}\ninput:focus,select:focus,textarea:focus{border-color:var(--ind2)}\ntextarea{min-height:70px;resize:vertical}\n.err{color:var(--bad);font-size:13px;margin-top:6px;min-height:1em;white-space:pre-line}\n.seg{display:flex;background:#ecebf6;border-radius:10px;padding:3px;margin-top:4px}\n.seg button{flex:1;border:0;background:none;padding:8px;border-radius:8px;font-weight:700;color:var(--ink2);font-size:13px}\n.seg button.on{background:#fff;color:var(--ind);box-shadow:0 1px 3px rgba(0,0,0,.08)}\n.ord{border-left:4px solid var(--amb)}\n.ord .hd{display:flex;justify-content:space-between;font-weight:800}\n.ord .st{display:inline-block;margin:6px 0;font-weight:700;font-size:13px;background:#f4f3f8;padding:4px 8px;border-radius:8px}\n.ord ul{margin:4px 0 0;padding-left:18px;color:var(--ink2);font-size:13px}\n.ok{text-align:center;padding:26px 16px}\n.ok .ic{font-size:56px}\n.sheet{position:fixed;inset:0;background:rgba(20,18,50,.45);z-index:20;display:flex;align-items:flex-end;justify-content:center}\n.sheet .in{background:#fff;border-radius:18px 18px 0 0;max-width:720px;width:100%;max-height:92vh;overflow:auto;padding:16px 16px calc(16px + env(safe-area-inset-bottom))}\n.sheet .cov{aspect-ratio:auto;height:280px;border-radius:12px}\n.sheet .cov img{object-fit:contain;background:#efeef6}\n.x{float:right;border:0;background:#ecebf6;border-radius:50%;width:32px;height:32px;font-size:16px;color:var(--ind)}\n.navb{display:flex;gap:6px;margin-top:10px}\n.navb button{border:0;background:rgba(255,255,255,.12);color:#fff;border-radius:10px;padding:6px 10px;font-weight:600;font-size:13px}\n.navb button.on{background:#fff;color:var(--ind)}\n.load{text-align:center;color:var(--ink2);padding:60px 0}\n.navb{flex-wrap:wrap}\n.srch{position:relative;margin:0 0 12px}\n.srch input{padding-left:38px;border-radius:12px}\n.srch span{position:absolute;left:12px;top:50%;transform:translateY(-50%);opacity:.6}\n.badge.pdf{left:auto;right:8px;background:#fff;color:var(--ind)}\n.paybox{background:#fff8e8;border:1.5px dashed var(--amb);border-radius:12px;padding:12px;white-space:pre-wrap;font-weight:600;margin:8px 0}\n.pill{display:inline-block;background:#ecebf6;color:var(--ind);border-radius:8px;padding:2px 8px;font-size:12px;font-weight:800;margin-left:6px}\n.pill.g{background:#e3f6ec;color:var(--ok)}.pill.y{background:#fff4d6;color:#a15c00}.pill.r{background:#fdeaea;color:var(--bad)}\n.adm .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}\n.adm .row button{flex:1;min-width:120px}\n.btn2{border:0;border-radius:10px;padding:10px 12px;font-weight:700;background:var(--ind);color:#fff}\n.btn2.soft{background:#ecebf6;color:var(--ind)}.btn2.ok{background:var(--ok)}.btn2.bad{background:#fdeaea;color:var(--bad)}\n.ab{display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line);flex-wrap:wrap}\n.ab:last-child{border-bottom:0}\n.ab .th{width:40px;height:54px;border-radius:6px;background:linear-gradient(150deg,var(--ind),var(--ind2));flex:none;overflow:hidden}\n.ab .th img{width:100%;height:100%;object-fit:cover}\n.ab .nm{flex:1;min-width:150px;font-weight:700;font-size:14px;line-height:1.25}\n.ab .nm small{display:block;font-weight:500;color:var(--ink2)}\n.ab .ctl{display:flex;gap:6px;align-items:center;width:100%;padding-left:50px;flex-wrap:wrap}\n.ab input{width:110px;padding:8px}\n.kv{font-size:14px;line-height:1.55}\n.kv b{color:var(--ind)}\n.chips{display:flex;flex-wrap:wrap;gap:8px}\n.chip{border:0;border-radius:10px;background:#ecebf6;color:var(--ind);font-weight:700;padding:9px 12px;font-size:14px}\n.q{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--line)}\n.q:last-child{border-bottom:0}\n.q .n{width:34px;font-weight:800;color:var(--ink2);flex:none}\n.q .opts{display:flex;gap:6px;flex:1}\n.q .opts button{flex:1;max-width:52px;height:40px;border-radius:10px;border:1.5px solid var(--line);background:#fff;font-weight:800;color:var(--ind)}\n.q .opts button.on{background:var(--ind);color:#fff;border-color:var(--ind)}\n.q .opts button.good{background:#e3f6ec;border-color:var(--ok);color:var(--ok)}\n.q .opts button.bad{background:#fdeaea;border-color:var(--bad);color:var(--bad)}\n.q .mk{width:26px;text-align:center;font-size:18px;flex:none}\n.res{text-align:center}\n.res .big2{font-size:40px;font-weight:900;color:var(--ind)}\n.kgrid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}\n.kgrid span{background:#f4f3f8;border-radius:8px;padding:6px 0;text-align:center;font-weight:700;font-size:14px}\n.kgrid span b{color:var(--ind)}\n.row2{display:flex;gap:8px;margin-top:12px}\n.row2 button{flex:1}\n.kb{display:flex;align-items:center;gap:12px;width:100%;border:0;text-align:left;background:var(--card);border-radius:14px;padding:10px;box-shadow:0 1px 4px rgba(35,32,94,.08);margin-bottom:10px;color:var(--ink)}\n.kb .th{width:48px;height:64px;border-radius:8px;background:linear-gradient(150deg,var(--ind),var(--ind2));flex:none;overflow:hidden}\n.kb .th img{width:100%;height:100%;object-fit:cover}\n.kb .tx{flex:1;min-width:0}\n.kb .tx b{display:block;font-size:15px;line-height:1.25}\n.kb .tx small{color:var(--ink2)}\n.kb .ar{font-size:22px;color:var(--ink2)}\n.tl{display:flex;align-items:center;gap:10px;width:100%;border:0;text-align:left;background:none;padding:12px 2px;border-bottom:1px solid var(--line);color:var(--ink)}\n.tl:last-child{border-bottom:0}\n.tl .nn{width:38px;height:38px;border-radius:10px;background:#ecebf6;color:var(--ind);font-weight:800;display:flex;align-items:center;justify-content:center;flex:none}\n.tl .tt{flex:1;font-weight:600;line-height:1.3}\n.tl .tt small{display:block;color:var(--ink2);font-weight:500}\n/* ---- yangi joylashuv: pastki menyu, bo'lim kartalari, galereya ---- */\n.tabs{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin:10px -16px -2px;padding:0 16px 2px}\nmain{padding-bottom:170px}\n.tbar{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid var(--line);display:flex;z-index:8;padding-bottom:env(safe-area-inset-bottom);box-shadow:0 -4px 16px rgba(35,32,94,.06)}\n.tbar button{flex:1;border:0;background:none;padding:8px 2px 7px;font-size:11px;font-weight:700;color:var(--ink2);display:flex;flex-direction:column;align-items:center;gap:3px;position:relative}\n.tbar button i{font-style:normal;font-size:21px;line-height:1;filter:grayscale(1);opacity:.65}\n.tbar button.on{color:var(--ind)}.tbar button.on i{filter:none;opacity:1}\n.tbar .dot{position:absolute;top:2px;left:calc(50% + 6px);background:var(--amb);color:var(--ind);border-radius:9px;font-size:10px;min-width:17px;height:17px;line-height:17px;padding:0 4px;font-weight:800}\n.bar{bottom:calc(58px + env(safe-area-inset-bottom));padding-bottom:10px}\n.secs{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px}\n.sec{border:0;border-radius:16px;background:#fff;box-shadow:0 1px 4px rgba(35,32,94,.08);padding:14px;text-align:left;display:flex;flex-direction:column;gap:6px;min-height:104px;color:var(--ink)}\n.sec i{font-style:normal;font-size:28px;line-height:1}\n.sec b{font-size:15px;color:var(--ind);line-height:1.25}\n.sec small{color:var(--ink2);font-weight:600;font-size:12px}\n.sec.dark{background:var(--ind);color:#fff}.sec.dark b{color:#fff}.sec.dark small{color:#c9c6f2}\n.sh{display:flex;justify-content:space-between;align-items:center;margin:4px 2px 10px}\n.sh b{font-size:16px;color:var(--ind)}.sh button{border:0;background:none;color:var(--ind2);font-weight:700;font-size:13px}\n.hrow{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px;scrollbar-width:none;margin:0 -12px 6px;padding-left:12px;padding-right:12px}\n.hrow .bk{width:138px;flex:none}\n.gal{display:flex;gap:8px;overflow-x:auto;margin:6px 0 14px;padding-bottom:4px}\n.gal img,.gal video{height:210px;border-radius:10px;flex:none;background:#efeef6;cursor:zoom-in}\n.gal .gdoc{height:210px;width:150px;flex:none;border:0;border-radius:10px;background:#ecebf6;color:var(--ind);font-weight:800;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px}\n.gal .gdoc i{font-style:normal;font-size:34px}\n.pdfv canvas{width:100%;display:block;margin:0 0 8px;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.12);background:#fff}\n.ibtn{border:0;border-radius:10px;background:#ecebf6;color:var(--ind);font-weight:700;padding:8px 12px;font-size:13px;margin-top:8px}\n.tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}\n.tl2{background:#fff;border-radius:14px;padding:12px;box-shadow:0 1px 4px rgba(35,32,94,.08);display:flex;flex-direction:column;gap:2px}\n.tl2 b{font-size:22px;color:var(--ind);line-height:1.15}.tl2 span{font-weight:700;font-size:13px}.tl2 small{color:var(--ink2);font-size:12px}\n.tl2.tg b{color:var(--ok)}.tl2.tr b{color:var(--bad)}.tl2.warn{background:#fff8e8}.tl2.dark{background:var(--ind);color:#fff}.tl2.dark b{color:var(--amb)}.tl2.dark small{color:#c9c6f2}\n.chart{display:flex;gap:4px;height:120px;align-items:stretch}.chart .col{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px}\n.chart .bars{flex:1;width:100%;display:flex;align-items:flex-end;gap:1px}.chart .bars i{flex:1;border-radius:3px 3px 0 0;min-height:2px}.chart small{font-size:10px;color:var(--ink2)}\n.leg{display:flex;gap:14px;font-size:12px;color:var(--ink2);margin-bottom:8px}.leg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}\n.trow{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px}.trow:last-child{border-bottom:0}\n.chk{display:flex;align-items:center;gap:8px;color:var(--ink);font-weight:600}.chk input{width:auto}\n.seg button{font-size:12px;padding:8px 4px}\n</style>\n</head>\n<body>\n<header>\n  <div class=\"brand\">\n    <svg height=\"34\" aria-label=\"aqlzor\" role=\"img\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"6 12 331.2 110\"><circle cx=\"60\" cy=\"26\" r=\"10\" fill=\"#F5A524\"/><path fill=\"#FFFFFF\" d=\"M42.75,42 H82 V61 H42.75 Q38,61 38,56.25 V46.75 Q38,42 42.75,42 Z\"/><rect x=\"70.56\" y=\"44.5\" width=\"10.54\" height=\"14.0\" fill=\"#C9C6E8\"/><path fill=\"#FFFFFF\" d=\"M28.75,63.5 H96 V82.5 H28.75 Q24,82.5 24,77.75 V68.25 Q24,63.5 28.75,63.5 Z\"/><rect x=\"77.28\" y=\"66.0\" width=\"17.82\" height=\"14.0\" fill=\"#C9C6E8\"/><path fill=\"#FFFFFF\" d=\"M10,85.0 H51.25 Q56,85.0 56,89.75 V99.25 Q56,104.0 51.25,104.0 H10 Z\"/><rect x=\"10.90\" y=\"87.5\" width=\"11.06\" height=\"14.0\" fill=\"#C9C6E8\"/><path fill=\"#FFFFFF\" d=\"M68.75,85.0 H110 V104.0 H68.75 Q64,104.0 64,99.25 V89.75 Q64,85.0 68.75,85.0 Z\"/><rect x=\"98.04\" y=\"87.5\" width=\"11.06\" height=\"14.0\" fill=\"#C9C6E8\"/><path d=\"M160.42105263157896 104.0 159.10526315789474 93.10526315789474 160.5263157894737 89.0 159.10526315789474 84.94736842105263 160.42105263157896 74.0H170.57894736842104L168.73684210526315 89.0L170.57894736842104 104.0ZM162.8421052631579 89.0Q162.05263157894737 93.78947368421052 159.84210526315792 97.34210526315789Q157.63157894736844 100.89473684210526 154.26315789473685 102.86842105263158Q150.89473684210526 104.84210526315789 146.68421052631578 104.84210526315789Q142.26315789473685 104.84210526315789 138.92105263157896 102.84210526315789Q135.57894736842104 100.84210526315789 133.68421052631578 97.28947368421052Q131.78947368421052 93.73684210526315 131.78947368421052 89.0Q131.78947368421052 84.26315789473684 133.68421052631578 80.71052631578948Q135.57894736842104 77.15789473684211 138.92105263157896 75.15789473684211Q142.26315789473685 73.15789473684211 146.68421052631578 73.15789473684211Q150.89473684210526 73.15789473684211 154.26315789473685 75.13157894736842Q157.63157894736844 77.10526315789474 159.8684210526316 80.63157894736842Q162.10526315789474 84.15789473684211 162.8421052631579 89.0ZM141.68421052631578 89.0Q141.68421052631578 91.42105263157895 142.68421052631578 93.28947368421052Q143.68421052631578 95.15789473684211 145.44736842105263 96.23684210526315Q147.21052631578948 97.3157894736842 149.5263157894737 97.3157894736842Q151.8421052631579 97.3157894736842 153.92105263157896 96.23684210526315Q156.0 95.15789473684211 157.57894736842104 93.28947368421052Q159.1578947368421 91.42105263157895 159.94736842105263 89.0Q159.1578947368421 86.57894736842105 157.57894736842104 84.71052631578948Q156.0 82.84210526315789 153.92105263157896 81.76315789473684Q151.8421052631579 80.68421052631578 149.5263157894737 80.68421052631578Q147.21052631578948 80.68421052631578 145.44736842105263 81.76315789473684Q143.68421052631578 82.84210526315789 142.68421052631578 84.71052631578948Q141.68421052631578 86.57894736842105 141.68421052631578 89.0ZM211.49473684210528 74.0V112.6842105263158H201.70526315789476V94.42105263157895L202.1263157894737 92.10526315789474V84.3157894736842L201.70526315789476 83.05263157894737V74.0ZM204.9157894736842 89.0Q204.17894736842106 93.78947368421052 201.96842105263158 97.34210526315789Q199.7578947368421 100.89473684210526 196.36315789473684 102.86842105263158Q192.96842105263158 104.84210526315789 188.7578947368421 104.84210526315789Q184.38947368421054 104.84210526315789 181.02105263157895 102.84210526315789Q177.65263157894736 100.84210526315789 175.7842105263158 97.28947368421052Q173.9157894736842 93.73684210526315 173.9157894736842 89.0Q173.9157894736842 84.26315789473684 175.7842105263158 80.71052631578948Q177.65263157894736 77.15789473684211 181.02105263157895 75.15789473684211Q184.38947368421054 73.15789473684211 188.7578947368421 73.15789473684211Q192.96842105263158 73.15789473684211 196.36315789473684 75.13157894736842Q199.7578947368421 77.10526315789474 201.99473684210528 80.63157894736842Q204.23157894736843 84.15789473684211 204.9157894736842 89.0ZM183.7578947368421 89.0Q183.7578947368421 91.42105263157895 184.7578947368421 93.28947368421052Q185.7578947368421 95.15789473684211 187.54736842105262 96.23684210526315Q189.33684210526317 97.3157894736842 191.60000000000002 97.3157894736842Q193.96842105263158 97.3157894736842 196.02105263157895 96.23684210526315Q198.07368421052632 95.15789473684211 199.65263157894736 93.28947368421052Q201.23157894736843 91.42105263157895 202.07368421052632 89.0Q201.23157894736843 86.57894736842105 199.65263157894736 84.71052631578948Q198.07368421052632 82.84210526315789 196.02105263157895 81.76315789473684Q193.96842105263158 80.68421052631578 191.60000000000002 80.68421052631578Q189.33684210526317 80.68421052631578 187.54736842105262 81.76315789473684Q185.7578947368421 82.84210526315789 184.7578947368421 84.71052631578948Q183.7578947368421 86.57894736842105 183.7578947368421 89.0ZM216.98947368421054 63.473684210526315H226.7263157894737V104.0H216.98947368421054ZM231.06315789473686 104.0V97.15789473684211L252.43157894736845 79.63157894736841L259.16842105263163 81.10526315789474H231.22105263157897V74.0H262.8526315789474V80.84210526315789L241.5368421052632 98.36842105263158L235.8 96.89473684210526H262.95789473684215V104.0ZM284.821052631579 104.84210526315789Q279.1368421052632 104.84210526315789 274.87368421052633 102.84210526315789Q270.6105263157895 100.84210526315789 268.2421052631579 97.26315789473685Q265.87368421052633 93.6842105263158 265.87368421052633 89.0Q265.87368421052633 84.26315789473684 268.2421052631579 80.71052631578948Q270.6105263157895 77.15789473684211 274.90000000000003 75.15789473684211Q279.18947368421055 73.15789473684211 284.821052631579 73.15789473684211Q290.5052631578948 73.15789473684211 294.7947368421053 75.15789473684211Q299.0842105263158 77.15789473684211 301.4526315789474 80.71052631578948Q303.821052631579 84.26315789473684 303.821052631579 89.0Q303.821052631579 93.73684210526315 301.4526315789474 97.28947368421052Q299.0842105263158 100.84210526315789 294.7947368421053 102.84210526315789Q290.5052631578948 104.84210526315789 284.821052631579 104.84210526315789ZM284.821052631579 97.47368421052632Q287.71578947368425 97.47368421052632 289.7421052631579 96.44736842105263Q291.7684210526316 95.42105263157895 292.8473684210527 93.52631578947368Q293.92631578947373 91.63157894736842 293.92631578947373 89.0Q293.92631578947373 86.36842105263158 292.8473684210527 84.47368421052632Q291.7684210526316 82.57894736842105 289.7421052631579 81.55263157894737Q287.71578947368425 80.52631578947368 284.821052631579 80.52631578947368Q282.0315789473685 80.52631578947368 279.97894736842113 81.55263157894737Q277.92631578947373 82.57894736842105 276.821052631579 84.47368421052632Q275.71578947368425 86.36842105263158 275.71578947368425 89.0Q275.71578947368425 91.63157894736842 276.821052631579 93.52631578947368Q277.92631578947373 95.42105263157895 279.97894736842113 96.44736842105263Q282.0315789473685 97.47368421052632 284.821052631579 97.47368421052632ZM306.421052631579 74.0H316.3157894736843L318.1052631578948 84.78947368421052V104.0H308.3157894736843V84.0ZM332.421052631579 73.57894736842105V82.0Q331.00000000000006 81.68421052631578 329.6052631578948 81.52631578947367Q328.21052631578954 81.36842105263158 327.0526315789474 81.36842105263158Q324.52631578947376 81.36842105263158 322.50000000000006 82.39473684210526Q320.47368421052636 83.42105263157895 319.2894736842106 85.63157894736841Q318.1052631578948 87.84210526315789 318.1052631578948 91.36842105263158L316.15789473684214 88.94736842105263Q316.52631578947376 85.73684210526315 317.3684210526317 82.89473684210526Q318.21052631578954 80.05263157894737 319.68421052631584 77.86842105263158Q321.15789473684214 75.68421052631578 323.3421052631579 74.42105263157895Q325.52631578947376 73.15789473684211 328.6315789473685 73.15789473684211Q329.52631578947376 73.15789473684211 330.52631578947376 73.26315789473685Q331.52631578947376 73.36842105263158 332.421052631579 73.57894736842105Z\" fill=\"#FFFFFF\"/></svg><small style=\"margin-left:4px;align-self:flex-end;padding-bottom:3px\">kitoblari</small>\n  </div>\n  <div class=\"tabs\" id=\"tabs\"></div>\n</header>\n<main id=\"app\"><div class=\"load\">Yuklanmoqda…</div></main>\n<div class=\"bar\" id=\"bar\" hidden></div>\n<nav class=\"tbar\" id=\"nav\"></nav>\n<script>\n(function(){\nvar W=window.Telegram&&Telegram.WebApp, ID=W&&W.initData||'';\ntry{W.ready();W.expand();W.disableVerticalSwipes&&W.disableVerticalSwipes();W.setHeaderColor('#23205E');W.setBackgroundColor('#f4f3f8');}catch(e){}\nvar AP=\"['‘’ʻʼ`]\";\nfunction NA(t){return String(t).replace(new RegExp('O'+AP,'g'),'Ö').replace(new RegExp('o'+AP,'g'),'ö').replace(new RegExp('G'+AP,'g'),'Ğ').replace(new RegExp('g'+AP,'g'),'ğ').replace(/SH/g,'Ş').replace(/Sh/g,'Ş').replace(/sh/g,'ş').replace(/CH/g,'Ç').replace(/Ch/g,'Ç').replace(/ch/g,'ç');}\nfunction conv(root){if(!root)return;var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null),n;while(n=w.nextNode()){if(n.parentNode&&/^(SCRIPT|STYLE|TEXTAREA)$/.test(n.parentNode.nodeName))continue;var v=NA(n.nodeValue);if(v!==n.nodeValue)n.nodeValue=v;}\n  root.querySelectorAll&&root.querySelectorAll('[placeholder]').forEach(function(e){e.placeholder=NA(e.placeholder);});}\nvar S={view:'shop',cat:'',D:null,busy:false,form:null,orders:null,done:null,keys:null,KB:null,T:null,res:[],qs:'',payInfo:'',A:{tab:'stats',st:null,bc:{text:'',aud:'all',btn:1,file:null,fname:''},bcs:null,filter:'active',orders:null,counts:{},books:null,cats:[],nb:{},track:{}},kf:{book_id:'',text:''}};\nvar $=function(id){return document.getElementById(id);};\nvar esc=function(s){return String(s==null?'':s).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c];});};\nvar money=function(n){return Number(n).toLocaleString('ru-RU').replace(/ /g,' ')+' so‘m';};\nfunction hap(t){try{t==='ok'?W.HapticFeedback.notificationOccurred('success'):W.HapticFeedback.impactOccurred('light');}catch(e){}}\nfunction say(m){m=NA(m);try{W.showAlert(m);}catch(e){alert(m);}}\nfunction api(p,b){b=b||{};b.initData=ID;return fetch('/app/api/'+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Xatolik');return j;});});}\nfunction img(b,cls){return b.photo?'<img loading=\"lazy\" src=\"/app/img/'+b.id+'?v='+encodeURIComponent(b.photo)+'\" alt=\"\">':'<div class=\"ph\"><i></i>'+esc(b.title)+'</div>';}\nfunction qty(id){var c=(S.D.cart||[]).filter(function(x){return x.id===id;})[0];return c?c.qty:0;}\nfunction cartSum(){var s=0,n=0;(S.D.cart||[]).forEach(function(c){n+=c.qty;if(c.price>0)s+=c.price*c.qty;});return {s:s,n:n};}\nfunction stepper(id,q){return '<div class=\"step\"><button data-q=\"'+id+':'+(q-1)+'\">−</button><span>'+q+'</span><button data-q=\"'+id+':'+(q+1)+'\">+</button></div>';}\nfunction buyBtn(b){var q=qty(b.id);if(q&&b.pdf)return '<button class=\"add soft\" data-q=\"'+b.id+':0\">✓ Savatchada · olib tashlash</button>';if(q)return stepper(b.id,q);return '<button class=\"add'+(b.price>0?'':' soft')+'\" data-q=\"'+b.id+':1\">'+(b.price>0?'Savatchaga':'🔔 Narxi chiqqanda xabar')+'</button>';}\n\nfunction nav(){var c=cartSum();var items=[['shop','🏠','Dökon'],['cart','🛒','Savatcha'],['orders','📦','Buyurtmalar'],['keys','✅','Javoblar']];if(S.D.admin)items.push(['admin','⚙️','Admin']);\n  var act=S.view==='checkout'?'cart':S.view==='done'?'orders':(S.view==='test'||S.view==='kbook')?'keys':S.view;\n  $('nav').innerHTML=items.map(function(x){return '<button data-nav=\"'+x[0]+'\" class=\"'+(act===x[0]?'on':'')+'\"><i>'+x[1]+'</i>'+x[2]+(x[0]==='cart'&&c.n?'<span class=\"dot\">'+c.n+'</span>':'')+'</button>';}).join('');\n  var showTabs=S.view==='shop'&&S.cat&&!S.qs.trim();\n  $('tabs').innerHTML=showTabs?[{key:'',title:'🏠 Bölimlar'}].concat(S.D.cats,[{key:'__new',title:'🆕 Yangi kelganlar'}]).map(function(c){return '<button class=\"tab'+(S.cat===c.key?' on':'')+'\" data-cat=\"'+esc(c.key)+'\">'+esc(c.title)+'</button>';}).join(''):'';\n  $('tabs').style.display=showTabs?'flex':'none';}\n\nfunction bar(){var c=cartSum(),b=$('bar');\n  if(S.view==='shop'&&c.n){b.hidden=false;b.innerHTML='<div class=\"in\"><button class=\"big\" data-nav=\"cart\"><span>🛒 Savatcha · '+c.n+' dona</span><span>'+(c.s?money(c.s):'')+'</span></button></div>';return;}\n  if(S.view==='cart'&&c.s){b.hidden=false;b.innerHTML='<div class=\"in\"><button class=\"big ind\" data-nav=\"checkout\"><span>Buyurtma berish</span><span>'+money(c.s)+' →</span></button></div>';return;}\n  if(S.view==='checkout'){b.hidden=false;b.innerHTML='<div class=\"in\"><button class=\"big\" id=\"send\" '+(S.busy?'disabled':'')+'><span>'+(S.busy?'Yuborilmoqda…':'✅ Buyurtmani tasdiqlash')+'</span><span>'+money(c.s)+'</span></button></div>';return;}\n  if(S.view==='test'&&S.T&&!S.T.checked){var na=S.T.ans.filter(Boolean).length;b.hidden=false;b.innerHTML='<div class=\"in\"><button class=\"big ind\" id=\"tcheck\" '+(na?'':'disabled')+'><span>✅ Tekshirish</span><span>'+na+' / '+S.T.t.key.length+'</span></button></div>';return;}\n  b.hidden=true;b.innerHTML='';}\n\nfunction shopList(){var q=S.qs.trim().toLowerCase();\n  if(q){var nq=NA(q);return S.D.books.filter(function(b){var t=b.title.toLowerCase();return t.indexOf(q)>=0||t.indexOf(nq)>=0||(b.desc||'').toLowerCase().indexOf(nq)>=0;});}\n  if(S.cat==='__new')return S.D.books.slice().sort(function(a,b){return b.id-a.id;}).slice(0,8);\n  return S.D.books.filter(function(b){return b.cat===S.cat;});}\nfunction gridHtml(){var list=shopList();\n  if(!list.length)return '<div class=\"empty\">'+(S.qs.trim()?'🔎 «'+esc(S.qs.trim())+'» bo‘yicha kitob topilmadi.':'Bu bo‘limda hozircha kitob yo‘q.')+'</div>';\n  return (S.qs.trim()?'<div class=\"note\" style=\"margin:0 4px 10px\">🔎 '+list.length+' ta kitob topildi</div>':'')+'<div class=\"grid\">'+list.map(function(b){return '<div class=\"bk\"><div class=\"cov\" data-open=\"'+b.id+'\">'+img(b)+(b.smp?'<span class=\"badge\">📖 Namuna</span>':'')+(b.pdf?'<span class=\"badge pdf\">📄 PDF</span>':'')+'</div><div class=\"bi\"><div class=\"bt\" data-open=\"'+b.id+'\">'+esc(b.title)+'</div><div class=\"pr'+(b.price>0?'':' soon')+'\">'+(b.price>0?money(b.price):'⏳ Narxi tez orada')+'</div><div class=\"sp\"></div>'+buyBtn(b)+'</div></div>';}).join('')+'</div>';}\nfunction homeHtml(){var ic=function(t){var m=String(t).match(/^(\\p{Extended_Pictographic}️?)\\s*(.*)$/u);return m?[m[1],m[2]]:['📚',t];};\n  var h='<div class=\"secs\">'+S.D.cats.map(function(c){var n=S.D.books.filter(function(b){return b.cat===c.key;}).length,x=ic(c.title);return '<button class=\"sec\" data-cat=\"'+esc(c.key)+'\"><i>'+x[0]+'</i><b>'+esc(x[1])+'</b><small>'+n+' ta kitob</small></button>';}).join('')+\n  '<button class=\"sec dark\" data-nav=\"keys\"><i>✅</i><b>Testlar javoblari</b><small>Javobingizni tekşiring</small></button></div>';\n  var nw=S.D.books.slice().sort(function(a,b){return b.id-a.id;}).slice(0,8);\n  if(nw.length)h+='<div class=\"sh\"><b>🆕 Yangi kelganlar</b><button data-cat=\"__new\">Barçasi ›</button></div><div class=\"hrow\">'+nw.map(bookCard).join('')+'</div>';\n  return h;}\nfunction bookCard(b){return '<div class=\"bk\"><div class=\"cov\" data-open=\"'+b.id+'\">'+img(b)+(b.smp?'<span class=\"badge\">📖 Namuna</span>':'')+(b.pdf?'<span class=\"badge pdf\">📄 PDF</span>':'')+'</div><div class=\"bi\"><div class=\"bt\" data-open=\"'+b.id+'\">'+esc(b.title)+'</div><div class=\"pr'+(b.price>0?'':' soon')+'\">'+(b.price>0?money(b.price):'⏳ Narxi tez orada')+'</div><div class=\"sp\"></div>'+buyBtn(b)+'</div></div>';}\nfunction vShop(){return '<div class=\"srch\"><span>🔎</span><input id=\"qs\" type=\"search\" placeholder=\"Kitob qidirish…\" value=\"'+esc(S.qs)+'\" autocomplete=\"off\"></div><div id=\"grid\">'+(S.qs.trim()||S.cat?gridHtml():homeHtml())+'</div>';}\n\nfunction vCart(){var C=S.D.cart||[];\n  if(!C.length)return '<div class=\"empty\">🛒 Savatchangiz bo‘sh.<br><br><button class=\"add\" style=\"width:auto;padding:10px 18px\" data-nav=\"shop\">Kitob tanlash</button></div>';\n  var c=cartSum(),un=C.some(function(x){return !(x.price>0);});\n  return '<div class=\"card\"><h2>🛒 Savatcha</h2>'+C.map(function(x){var b=S.D.books.filter(function(y){return y.id===x.id;})[0]||{id:x.id,title:x.title};return '<div class=\"ci\"><div class=\"th\">'+(b.photo?'<img src=\"/app/img/'+b.id+'?v='+encodeURIComponent(b.photo)+'\">':'')+'</div><div class=\"nm\"><b>'+esc(x.title)+'</b><small>'+(x.price>0?x.qty+' × '+money(x.price):'⏳ narxi hali e’lon qilinmagan')+'</small></div>'+stepper(x.id,x.qty)+'</div>';}).join('')+\n  '<div class=\"tot\"><span>Jami</span><span>'+money(c.s)+'</span></div>'+\n  (un?'<div class=\"note\">⏳ Narxi e’lon qilinmagan kitoblar hozircha buyurtmaga kirmaydi — narxi chiqqanda xabar beramiz.</div>':'')+\n  '<div class=\"note\">📮 Pochta xizmati haqi narxga kirmaydi — uni kitobni olayotganda pochtada o‘zingiz to‘laysiz.</div></div>';}\n\nfunction cartDigital(){var C=(S.D.cart||[]).filter(function(x){return x.price>0;});return C.length>0&&C.every(function(x){return bookOf(x.id).pdf;});}\nfunction vCheckout(){var F=S.form,R=S.D.regions,DG=cartDigital();\n  var regs=R.map(function(r){return '<option value=\"'+esc(r[0])+'\"'+(F.region===r[0]?' selected':'')+'>'+esc(r[1])+'</option>';}).join('');\n  var cur=R.filter(function(r){return r[0]===F.region;})[0];\n  var dis=cur?cur[2].map(function(d){return '<option value=\"'+esc(d[0])+'\"'+(F.district===d[0]?' selected':'')+'>'+esc(d[1])+'</option>';}).join(''):'';\n  return '<div class=\"card\"><h2>📝 Buyurtma ma’lumotlari</h2>'+\n  '<label for=\"f_name\">Ism va familiya</label><input id=\"f_name\" data-f=\"name\" value=\"'+esc(F.name)+'\" placeholder=\"Masalan: Aliyev Vali\" autocomplete=\"name\">'+\n  '<label for=\"f_phone\">Telefon raqam</label><input id=\"f_phone\" data-f=\"phone\" value=\"'+esc(F.phone)+'\" placeholder=\"+998 90 123 45 67\" inputmode=\"tel\" autocomplete=\"tel\">'+\n  (DG?'<div class=\"note\" style=\"color:var(--ink);font-weight:600\">📄 Savatchangizda faqat PDF kitoblar bor — manzil va pochta kerak emas. To‘lov tasdiqlangach kitob «📦 Buyurtmalar» bölimida ilovaning özida ochiladi.</div>':'<label>Manzil</label>'+(F.prev?'<div class=\"seg\"><button data-am=\"prev\" class=\"'+(F.am==='prev'?'on':'')+'\">📌 Oldingi</button><button data-am=\"list\" class=\"'+(F.am==='list'?'on':'')+'\">Ro‘yxatdan</button><button data-am=\"manual\" class=\"'+(F.am==='manual'?'on':'')+'\">O‘zim yozaman</button></div>':'<div class=\"seg\"><button data-am=\"list\" class=\"'+(F.am==='list'?'on':'')+'\">Ro‘yxatdan tanlash</button><button data-am=\"manual\" class=\"'+(F.am==='manual'?'on':'')+'\">O‘zim yozaman</button></div>')+\n  (F.am==='prev'?'<div class=\"note\" style=\"color:var(--ink);font-weight:600\">'+esc(F.prevShow)+'</div>':'')+\n  (F.am==='list'?'<label for=\"f_region\">Viloyat</label><select id=\"f_region\" data-f=\"region\"><option value=\"\">— tanlang —</option>'+regs+'</select>'+\n    (cur?'<label for=\"f_district\">Tuman / shahar</label><select id=\"f_district\" data-f=\"district\"><option value=\"\">— tanlang —</option>'+dis+'<option value=\"__other\"'+(F.district==='__other'?' selected':'')+'>✍️ Ro‘yxatda yo‘q</option></select>'+(F.district==='__other'?'<input style=\"margin-top:8px\" data-f=\"districtText\" value=\"'+esc(F.districtText)+'\" placeholder=\"Tuman yoki shahar nomi\">':''):'')+\n    '<label for=\"f_street\">Mahalla, ko‘cha, uy</label><input id=\"f_street\" data-f=\"street\" value=\"'+esc(F.street)+'\" placeholder=\"Masalan: Navro‘z mahallasi, Bobur ko‘chasi 12\">':'')+\n  (F.am==='manual'?'<textarea data-f=\"address\" placeholder=\"Viloyat, tuman, mahalla/ko‘cha, uy\">'+esc(F.address)+'</textarea>':'')+\n  '<label for=\"f_post\">📮 Yaqin BTS yoki EMU pochta bo‘limi</label><textarea id=\"f_post\" data-f=\"comment\" placeholder=\"Masalan: BTS, Asaka sh., Navoiy ko‘chasi 25 (bozor yonida)\">'+esc(F.comment)+'</textarea>'+\n  '<div class=\"note\">Kitoblar shu pochta bo‘limiga jo‘natiladi, siz u yerdan olasiz. Pochta xizmati haqini o‘zingiz to‘laysiz.</div>')+\n  '<div class=\"err\" id=\"err\">'+esc(F.err||'')+'</div></div>'+\n  '<div class=\"card\"><h3>🧾 Buyurtmangiz</h3>'+S.D.cart.filter(function(x){return x.price>0;}).map(function(x){return '<div style=\"display:flex;justify-content:space-between;gap:8px;padding:4px 0\"><span>'+esc(x.title)+' × '+x.qty+'</span><b style=\"white-space:nowrap\">'+money(x.price*x.qty)+'</b></div>';}).join('')+'<div class=\"tot\"><span>Jami</span><span>'+money(cartSum().s)+'</span></div></div>';}\n\nfunction vOrders(){if(!S.orders)return '<div class=\"load\">Yuklanmoqda…</div>';\n  if(!S.orders.length)return '<div class=\"empty\">📦 Hali buyurtmangiz yo‘q.</div>';\n  return S.orders.map(function(o){return '<div class=\"card ord\"><div class=\"hd\"><span>Buyurtma #'+o.id+'</span><span>'+money(o.total)+'</span></div><div class=\"st\">'+esc(o.status)+'</div><div class=\"note\" style=\"margin:0\">📅 '+esc(o.date)+(o.track?' · 📦 Trek: <b>'+esc(o.track)+'</b>':'')+'</div><ul>'+o.items.map(function(i){return '<li>'+esc(i.title)+' × '+i.qty+'</li>';}).join('')+'</ul>'+o.items.filter(function(i){return i.pdf;}).map(function(i){return '<button class=\"ibtn\" data-mypdf=\"'+i.id+'\" data-t=\"'+esc(i.title)+'\">📖 «'+esc(i.title)+'» ni öqiş</button> ';}).join('')+(o.pay?'<div class=\"paybox\" style=\"font-weight:500\">'+(S.payInfo?esc(S.payInfo):'Karta ma’lumotini admin tez orada yuboradi.')+'</div><button class=\"btn2\" style=\"width:100%\" data-rcpt=\"'+o.id+'\">🧾 Chekni yuklash</button>':'')+(o.st==='check'?'<div class=\"note\">🧾 Chek yuborilgan — admin tekshirmoqda.</div>':'')+'</div>';}).join('')+(S.D.contact?'<div class=\"card\"><h3>☎️ Aloqa</h3><div style=\"white-space:pre-wrap\">'+esc(S.D.contact)+'</div></div>':'');}\n\nfunction bookOf(id){return S.D.books.filter(function(x){return x.id===id;})[0]||{};}\nfunction vKeys(){if(!S.keys)return '<div class=\"load\">Yuklanmoqda…</div>';\n  var R=S.res.slice(0,8),h=(R.length?'<div class=\"card\"><h3>📊 Oxirgi natijalarim</h3>'+R.map(function(r){var p=Math.round(r.ok*100/r.n);return '<button class=\"tl\" data-test=\"'+r.key+'\"><span class=\"nn\" style=\"width:auto;min-width:46px;padding:0 6px;background:'+(p>=80?'#e3f6ec':p>=50?'#fff4d6':'#fdeaea')+';color:'+(p>=80?'var(--ok)':p>=50?'#a15c00':'var(--bad)')+'\">'+p+'%</span><span class=\"tt\">'+esc(r.btitle)+'<small>'+esc(r.title)+' · '+r.ok+'/'+r.n+' · '+fdate(r.ts)+'</small></span></button>';}).join('')+'</div>':'')+(S.keys.length?'<div class=\"note\" style=\"margin:0 4px 10px\">Kitobingizni tanlang 👇</div>'+S.keys.map(function(b){var bk=bookOf(b.id),q=b.tests.reduce(function(a,t){return a+t.key.length;},0);return '<button class=\"kb\" data-kb=\"'+b.id+'\"><div class=\"th\">'+(bk.photo?'<img loading=\"lazy\" src=\"/app/img/'+b.id+'?v='+encodeURIComponent(bk.photo)+'\">':'')+'</div><div class=\"tx\"><b>'+esc(b.title)+'</b><small>'+b.tests.length+' ta test · '+q+' ta savol</small></div><span class=\"ar\">›</span></button>';}).join(''):'<div class=\"empty\">✅ Hali javoblar qo‘shilmagan.</div>');\n  if(S.D.admin){var K=S.kf;h+='<div class=\"card\"><h3>⚙️ Javob kaliti qo‘shish (admin)</h3><label for=\"k_book\">Kitob</label><select id=\"k_book\" data-k=\"book_id\"><option value=\"\">— tanlang —</option>'+S.D.books.map(function(b){return '<option value=\"'+b.id+'\"'+(String(K.book_id)===String(b.id)?' selected':'')+'>'+esc(b.title)+'</option>';}).join('')+'</select>'+\n    '<label for=\"k_text\">Testlar va javoblar — har bir test alohida qatorda</label><textarea id=\"k_text\" data-k=\"text\" style=\"min-height:130px\" placeholder=\"1-dars 1-test: 1A 2C 3B 4D 5A&#10;1-dars 2-test: ACBDA BCDAB\">'+esc(K.text)+'</textarea>'+\n    '<div class=\"note\">Har qatorda: test nomi, ikki nuqta, keyin javoblar. «1A 2C 3B» yoki ketma-ket «ACBD» ko‘rinishida yozsa bo‘ladi.</div><div class=\"err\" id=\"kerr\">'+esc(K.err||'')+'</div><button class=\"add\" id=\"kadd\">➕ Qo‘shish</button></div>';}\n  return h;}\nfunction vKBook(){if(!S.keys)return '<div class=\"load\">Yuklanmoqda…</div>';var b=S.keys.filter(function(x){return x.id===S.KB;})[0];if(!b)return '<div class=\"empty\">Topilmadi</div>';\n  return '<div class=\"card\"><div class=\"note\" style=\"margin:0\">📘 Kitob</div><h2 style=\"margin:4px 0 0\">'+esc(b.title)+'</h2><div class=\"note\">Testni tanlang — javoblaringizni tekshiring yoki kalitni ko‘ring</div></div><div class=\"card\" style=\"padding:4px 12px\">'+\n  b.tests.map(function(t){var m=t.title.match(/^(\\d+)-dars:?\\s*(.*)$/);return '<button class=\"tl\" data-test=\"'+t.id+'\"><span class=\"nn\">'+(m?m[1]:'•')+'</span><span class=\"tt\">'+(m?m[1]+'-dars':esc(t.title))+'<small>'+esc(m?m[2]:'')+(m&&m[2]?' · ':'')+t.key.length+' ta savol</small></span>'+pillRes(t.id)+'<span class=\"ar\" style=\"color:var(--ink2);font-size:22px\">›</span></button>';}).join('')+'</div>';}\nfunction lastRes(id){var r=S.res.filter(function(x){return x.key===id;})[0];return r?Math.round(r.ok*100/r.n):null;}\nfunction pillRes(id){var l=lastRes(id);return l==null?'':'<span class=\"pill '+(l>=80?'g':l>=50?'y':'r')+'\">'+l+'%</span>';}\nfunction fdate(ts){var d=new Date(ts);return d.getDate()+'.'+String(d.getMonth()+1).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}\nfunction letters(t){return t.key.indexOf('E')>=0?['A','B','C','D','E']:['A','B','C','D'];}\nfunction vTest(){var T=S.T,t=T.t,L=letters(t),ok=0;\n  var rows=t.key.map(function(k,i){var a=T.ans[i]||'';if(T.checked&&a===k)ok++;\n    return '<div class=\"q\"><span class=\"n\">'+(i+1)+'.</span><div class=\"opts\">'+L.map(function(l){var c='';if(T.checked){if(l===k)c='good';else if(l===a)c='bad';}else if(l===a)c='on';return '<button class=\"'+c+'\" data-a=\"'+i+':'+l+'\"'+(T.checked?' disabled':'')+'>'+l+'</button>';}).join('')+'</div><span class=\"mk\">'+(T.checked?(a===k?'✅':a?'❌':'➖'):'')+'</span></div>';}).join('');\n  var top='<div class=\"card\"><div class=\"note\" style=\"margin:0\">'+esc(T.book)+'</div><h2 style=\"margin:4px 0 0\">'+esc(t.title)+'</h2><div class=\"note\">'+t.key.length+' ta savol'+(function(){var p=S.res.filter(function(x){return x.key===t.id;});return p.length?' · avvalgi urinishlar: '+p.slice(0,5).map(function(x){return Math.round(x.ok*100/x.n)+'%';}).join(', '):'';})()+'</div></div>';\n  var res='';if(T.checked){var pct=Math.round(ok*100/t.key.length);res='<div class=\"card res\"><div class=\"big2\">'+pct+'%</div><div>'+ok+' ta to‘g‘ri · '+(t.key.length-ok)+' ta xato yoki belgilanmagan</div><div class=\"row2\"><button class=\"add soft\" id=\"tagain\">↺ Qayta ishlash</button><button class=\"add\" data-nav=\"kbook\">Boshqa test</button></div></div>';}\n  var key=T.showKey?'<div class=\"card\"><h3>🔑 Javoblar kaliti</h3><div class=\"kgrid\">'+t.key.map(function(k,i){return '<span>'+(i+1)+'. <b>'+k+'</b></span>';}).join('')+'</div></div>':'';\n  return top+res+(T.checked?'':'<div class=\"note\" style=\"margin:0 4px 10px\">Javoblaringizni belgilang va «Tekshirish» ni bosing.</div>')+'<div class=\"card\">'+rows+'</div>'+key+\n    '<div class=\"row2\" style=\"margin-bottom:12px\"><button class=\"add soft\" id=\"tkey\">'+(T.showKey?'🙈 Kalitni yashirish':'🔑 Kalitni ko‘rish')+'</button>'+(S.D.admin?'<button class=\"add soft\" style=\"color:var(--bad)\" id=\"tdel\">🗑 O‘chirish</button>':'')+'</div>';}\nfunction payCard(info,id,total){return '<div class=\"card\"><h3>💳 To‘lov</h3><div class=\"kv\">Summa: <b>'+money(total)+'</b></div>'+(info?'<div class=\"paybox\">'+esc(info)+'</div>':'<div class=\"note\">Karta ma’lumotini admin tez orada yuboradi.</div>')+'<div class=\"note\" style=\"margin-bottom:10px\">To‘lovni qilgach, to‘lov cheki skrinshotini (yoki PDF) yuklang — admin tekshirib tasdiqlaydi.</div><button class=\"big ind\" style=\"width:100%;justify-content:center\" data-rcpt=\"'+id+'\">🧾 Chekni yuklash</button></div>';}\nfunction vDone(){var d=S.done;if(d.rc==='check')return '<div class=\"card ok\"><div class=\"ic\">✅</div><h2>Chek qabul qilindi!</h2><p class=\"note\">Admin tekshirib tasdiqlagach, '+(d.digital?'PDF kitobni «📦 Buyurtmalar» bölimida ilovaning özida öqiysiz.':'kitoblaringiz pochtaga topshiriladi.')+' Holatini «📦 Buyurtmalarim» bo‘limida kuzatasiz.</p><br><button class=\"big ind\" style=\"width:100%;justify-content:center\" data-nav=\"orders\">📦 Buyurtmalarim</button></div>';\n  return '<div class=\"card ok\"><div class=\"ic\">🎉</div><h2>Buyurtmangiz qabul qilindi!</h2><p>Buyurtma raqami: <b>#'+d.id+'</b><br>Jami: <b>'+money(d.total)+'</b></p></div>'+payCard(d.payInfo,d.id,d.total)+'<button class=\"add soft\" style=\"margin-bottom:12px\" id=\"close\">Keyinroq — bot chatiga o‘tish</button>';}\n\nfunction vAdmin(){var A=S.A;var h='<div class=\"seg\" style=\"margin-bottom:12px\">'+[['stats','📊 Statistika'],['bc','📢 Xabar'],['orders','🧾 Buyurtma'],['books','📚 Kitoblar']].map(function(x){return '<button data-atab=\"'+x[0]+'\" class=\"'+(A.tab===x[0]?'on':'')+'\">'+x[1]+'</button>';}).join('')+'</div>';\n  if(A.tab==='stats')return h+vStats();\n  if(A.tab==='bc')return h+vBc();\n  if(A.tab==='orders'){var F=[['active','Faol'],['check','🧾 Chek'],['new','⏳ To‘lov'],['confirmed','📦 Jo‘natish'],['sent','🚚 Pochtada'],['all','Hammasi']];\n    h+='<div class=\"chips\" style=\"margin-bottom:12px\">'+F.map(function(f){var n=f[0]==='active'?['new','check','confirmed','sent'].reduce(function(a,k){return a+(A.counts[k]||0);},0):f[0]==='all'?'':(A.counts[f[0]]||0);return '<button class=\"chip\" style=\"'+(A.filter===f[0]?'background:var(--ind);color:#fff':'')+'\" data-afil=\"'+f[0]+'\">'+f[1]+(n!==''?' · '+n:'')+'</button>';}).join('')+'</div>';\n    if(!A.orders)return h+'<div class=\"load\">Yuklanmoqda…</div>';\n    if(!A.orders.length)return h+'<div class=\"empty\">Bu bo‘limda buyurtma yo‘q ✅</div>';\n    return h+A.orders.map(function(o){var act='';\n      if(o.status==='new')act='<button class=\"btn2 ok\" data-ast=\"'+o.id+':confirmed\">✅ To‘lovni tasdiqlash</button><button class=\"btn2 bad\" data-ast=\"'+o.id+':cancelled\">❌ Bekor qilish</button>';\n      if(o.status==='check')act='<button class=\"btn2 soft\" data-arc=\"'+o.id+'\">🧾 Chekni ko‘rish</button><button class=\"btn2 ok\" data-ast=\"'+o.id+':confirmed\">✅ Tasdiqlash</button><button class=\"btn2 bad\" data-ast=\"'+o.id+':reject\">🚫 Chek rad</button><button class=\"btn2 bad\" data-ast=\"'+o.id+':cancelled\">❌ Bekor</button>';\n      if(o.status==='confirmed')act=o.digital?'<div class=\"note\">📄 PDF kitob mijozga yuborilgan.</div>':'<input placeholder=\"Trek raqami (ixtiyoriy)\" data-atr=\"'+o.id+'\" value=\"'+esc(A.track[o.id]||'')+'\"><button class=\"btn2\" data-ast=\"'+o.id+':sent\">🚚 Pochtaga topshirildi</button><button class=\"btn2 bad\" data-ast=\"'+o.id+':cancelled\">❌ Bekor</button>';\n      if(o.status==='sent')act='<button class=\"btn2 ok\" data-ast=\"'+o.id+':done\">📦 Yetkazildi</button>';\n      return '<div class=\"card ord adm\"><div class=\"hd\"><span>#'+o.id+(o.digital?' <span class=\"pill\">📄 PDF</span>':'')+'</span><span>'+money(o.total)+'</span></div><div class=\"st\">'+esc(o.statusText)+'</div><div class=\"kv\">👤 <b>'+esc(o.name)+'</b> · <a href=\"tel:'+esc(o.phone)+'\">'+esc(o.phone)+'</a><br>'+(o.digital?'':'📍 '+esc(o.address)+'<br>📮 '+esc(o.post)+'<br>')+'📅 '+esc(o.date)+(o.track?' · trek: <b>'+esc(o.track)+'</b>':'')+'</div><ul>'+o.items.map(function(i){return '<li>'+esc(i.title)+' × '+i.qty+'</li>';}).join('')+'</ul>'+(act?'<div class=\"row\">'+act+'</div>':'')+'</div>';}).join('');}\n  if(!A.books)return h+'<div class=\"load\">Yuklanmoqda…</div>';\n  var nb=A.nb;h+='<div class=\"card\"><h3>➕ Yangi kitob</h3><input data-nb=\"title\" placeholder=\"Kitob nomi\" value=\"'+esc(nb.title||'')+'\"><div style=\"display:flex;gap:8px;margin-top:8px\"><select data-nb=\"cat\"><option value=\"\">— bo‘lim —</option>'+A.cats.map(function(c){return '<option value=\"'+esc(c.key)+'\"'+(nb.cat===c.key?' selected':'')+'>'+esc(c.title)+'</option>';}).join('')+'</select><input data-nb=\"price\" inputmode=\"numeric\" placeholder=\"Narxi\" style=\"width:120px\" value=\"'+esc(nb.price||'')+'\"></div><textarea data-nb=\"desc\" style=\"margin-top:8px;min-height:60px\" placeholder=\"Qisqa tavsif\">'+esc(nb.desc||'')+'</textarea><div class=\"note\">PDF kitob bo‘lsa, qo‘shilgach ro‘yxatda «📄 PDF yuklash» ni bosing. Muqova rasmini bot ichidagi Admin panel orqali qo‘yasiz.</div><button class=\"btn2\" style=\"width:100%;margin-top:8px\" id=\"nbadd\">➕ Qo‘shish</button></div>';\n  A.cats.forEach(function(c){var L=A.books.filter(function(b){return b.cat===c.key;});if(!L.length)return;\n    h+='<div class=\"card\"><h3>'+esc(c.title)+'</h3>'+L.map(function(b){return '<div class=\"ab\" style=\"'+(b.active?'':'opacity:.55')+'\"><div class=\"th\">'+(b.photo?'<img loading=\"lazy\" src=\"/app/img/'+b.id+'?v='+encodeURIComponent(b.photo)+'\">':'')+'</div><div class=\"nm\">'+esc(b.title)+'<small>'+(b.price?money(b.price):'narx yo‘q')+(b.active?'':' · 🙈 yashirin')+(b.pdf?' · 📄 '+esc(b.pdfName||'PDF'):'')+'</small></div><div class=\"ctl\"><input inputmode=\"numeric\" data-apr=\"'+b.id+'\" value=\"'+(b.price||'')+'\" placeholder=\"Narx\"><button class=\"btn2 soft\" data-asv=\"'+b.id+'\">💾</button><button class=\"btn2 soft\" data-atg=\"'+b.id+'\">'+(b.active?'🙈 Yashirish':'👁 Ko‘rsatish')+'</button><button class=\"btn2 soft\" data-apdf=\"'+b.id+'\">📄 '+(b.pdf?'PDF almashtirish':'PDF yuklash')+'</button>'+(b.pdf?'<button class=\"btn2 bad\" data-arm=\"'+b.id+'\">✕ PDF</button>':'')+'</div></div>';}).join('')+'</div>';});\n  return h;}\nfunction num(n){return Number(n||0).toLocaleString('ru-RU').replace(/\\s/g,' ');}\nfunction tile(v,l,sub,c){return '<div class=\"tl2'+(c?' '+c:'')+'\"><b>'+v+'</b><span>'+l+'</span>'+(sub?'<small>'+sub+'</small>':'')+'</div>';}\nfunction vStats(){var T=S.A.st;if(!T)return '<div class=\"load\">Yuklanmoqda…</div>';var U=T.users,Ac=T.active,O=T.orders;\n  var mx=Math.max.apply(null,T.chart.map(function(x){return Math.max(x.nw,x.ac);}).concat([1]));\n  var pct=function(a,b){return b?Math.round(a*100/b)+'%':'—';};\n  return '<div class=\"sh\"><b>👥 Foydalanuvchilar</b></div><div class=\"tiles\">'+tile(num(U.all),'Jami foydalanuvchi','bot + ilova')+tile(num(U.live),'Faol obunachi','xabar yetib boradi','tg')+tile(num(U.blocked),'Botni bloklagan',pct(U.blocked,U.all),'tr')+tile('+'+num(U.new1),'Bugun qo‘shildi','7 kun: +'+num(U.new7)+' · 30 kun: +'+num(U.new30))+'</div>'+\n  '<div class=\"sh\"><b>🔥 Faollik</b></div><div class=\"tiles\">'+tile(num(Ac.d1),'Bugun kirgan')+tile(num(Ac.d7),'7 kunda kirgan')+tile(num(Ac.d30),'30 kunda kirgan')+tile(num(Ac.regular),'Doimiy foydalanuvchi','30 kunda 3+ kun kirgan','dark')+'</div>'+\n  '<div class=\"note\" style=\"margin:-4px 4px 12px\">Faollik '+esc(Ac.since)+' dan beri hisoblanmoqda.</div>'+\n  '<div class=\"card\"><h3>📈 Oxirgi 14 kun</h3><div class=\"leg\"><span><i style=\"background:var(--ind)\"></i>Kirganlar</span><span><i style=\"background:var(--amb)\"></i>Yangilar</span></div><div class=\"chart\">'+T.chart.map(function(x){return '<div class=\"col\" title=\"'+x.d+'\"><div class=\"bars\"><i style=\"height:'+Math.round(x.ac*100/mx)+'%;background:var(--ind)\"></i><i style=\"height:'+Math.round(x.nw*100/mx)+'%;background:var(--amb)\"></i></div><small>'+x.d.slice(0,2)+'</small></div>';}).join('')+'</div></div>'+\n  '<div class=\"sh\"><b>🛒 Savdo</b></div><div class=\"tiles\">'+tile(num(O.n),'To‘langan buyurtma','bu oy: '+num(O.month))+tile(num(O.buyers),'Xaridor',num(O.repeat)+' tasi qayta olgan · '+pct(O.buyers,U.all)+' konversiya')+tile(money(O.msum),'Bu oydagi tushum','jami: '+money(O.sum),'tg')+tile(num(O.pending),'Kutilayotgan','to‘lov yoki chek',O.pending?'warn':'')+'</div>'+\n  (T.top.length?'<div class=\"card\"><h3>🏆 Eng kõp sotilganlar</h3>'+T.top.map(function(x,i){return '<div class=\"trow\"><span>'+(i+1)+'. '+esc(x[0])+'</span><b>'+x[1]+' ta</b></div>';}).join('')+'</div>':'')+\n  '<div class=\"sh\"><b>✅ Testlar</b></div><div class=\"tiles\">'+tile(num(T.tests.n),'Tekshirilgan test')+tile(num(T.tests.users),'Test yechgan o‘quvchi')+'</div>'+\n  '<button class=\"btn2 soft\" style=\"width:100%;margin-top:4px\" data-arel>↻ Yangilash</button>';}\nfunction vBc(){var B=S.A.bc,L=S.A.bcs;var C=L?L.counts:{};\n  var auds=[['all','Hammaga',C.all],['active30','30 kunda faol',C.active30],['buyers','Xaridorlarga',C.buyers]];\n  var running=L&&L.list.some(function(x){return !x.done;});\n  return '<div class=\"card\"><h3>📢 Foydalanuvchilarga xabar</h3><label>Kimga</label><div class=\"chips\">'+auds.map(function(a){return '<button class=\"chip\" style=\"'+(B.aud===a[0]?'background:var(--ind);color:#fff':'')+'\" data-baud=\"'+a[0]+'\">'+a[1]+(a[2]!=null?' · '+num(a[2]):'')+'</button>';}).join('')+'</div>'+\n  '<label for=\"bc_t\">Xabar matni</label><textarea id=\"bc_t\" data-bc=\"text\" style=\"min-height:130px\" placeholder=\"Masalan: Yangi mashq daftarlari dökonda! Namunalarni bepul köring 👇\">'+esc(B.text)+'</textarea>'+\n  '<div class=\"row2\" style=\"margin-top:8px\"><button class=\"btn2 soft\" data-bpic>🖼 '+(B.file?'Rasm: '+esc(B.fname):'Rasm qöşiş')+'</button>'+(B.file?'<button class=\"btn2 bad\" data-bpicx>✕</button>':'')+'</div>'+\n  '<label class=\"chk\"><input type=\"checkbox\" data-bbtn '+(B.btn?'checked':'')+'> Xabar ostiga «🛍 Dökonni ochish» tugmasi</label>'+\n  '<div class=\"note\">Xabar avval sizga yuboriladi, keyin tanlangan foydalanuvchilarga daqiqasiga 40 tadan tarqatiladi. Tugagach, natijani bot sizga yozadi.</div>'+\n  '<button class=\"big ind\" style=\"width:100%;justify-content:center;margin-top:12px\" id=\"bsend\" '+(running||S.busy?'disabled':'')+'>'+(running?'⏳ Oldingi xabar tarqatilmoqda…':'📢 Yuborish')+'</button></div>'+\n  (L&&L.list.length?'<div class=\"card\"><h3>🕘 Oxirgi xabarlar</h3>'+L.list.map(function(x){var tot=x.sent+x.failed;return '<div class=\"trow\" style=\"align-items:flex-start\"><span>'+esc(x.preview||'Xabar #'+x.id)+'<small style=\"display:block;color:var(--ink2)\">'+esc(x.created||'')+' · '+({all:'hammaga',active30:'faollarga',buyers:'xaridorlarga'}[x.aud]||'hammaga')+'</small></span><b style=\"white-space:nowrap\">'+(x.done?'✅ '+x.sent+(x.failed?' · ❌ '+x.failed:''):'⏳ '+tot)+'</b></div>';}).join('')+'</div>':'');}\nfunction aLoad(){var A=S.A;if(A.tab==='stats'){api('a_stats').then(function(j){A.st=j;if(S.view==='admin')render();}).catch(function(e){say(e.message);});return;}\n  if(A.tab==='bc'){api('a_bcs').then(function(j){A.bcs=j;if(S.view==='admin')render();}).catch(function(e){say(e.message);});return;}\n  if(A.tab==='orders'){api('a_orders',{filter:A.filter}).then(function(j){A.orders=j.orders;A.counts=j.counts;if(S.view==='admin')render();}).catch(function(e){say(e.message);});}\n  else api('a_books').then(function(j){A.books=j.books;A.cats=j.cats;if(S.view==='admin')render();}).catch(function(e){say(e.message);});}\nfunction pickFile(accept,cb){var i=document.createElement('input');i.type='file';i.accept=accept;i.style.display='none';document.body.appendChild(i);i.onchange=function(){var f=i.files[0];i.remove();if(f)cb(f);};i.click();}\nfunction upload(op,fields,file){var fd=new FormData();fd.append('initData',ID);Object.keys(fields).forEach(function(k){fd.append(k,fields[k]);});fd.append('file',file);\n  return fetch('/app/api/'+op,{method:'POST',body:fd}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Xatolik');return j;});});}\nfunction sendReceipt(id){pickFile('image/*,application/pdf',function(f){if(f.size>10*1024*1024){say('Fayl juda katta (10 MB dan oshmasin)');return;}\n  S.busy=true;say0('⏳ Chek yuborilmoqda…');upload('receipt',{id:id},f).then(function(j){S.busy=false;\n    if(j.status==='check'){hap('ok');S.done={id:id,rc:'check',digital:S.done&&S.done.digital};S.orders=null;go('done');}\n    else{var ask=NA('🤔 Chekda muammo bor: summa yoki karta mos kelmadi yoki rasm chekka o‘xshamadi. Bot chatida batafsil yozildi.\\n\\nChek to‘g‘ri bo‘lsa, «OK» ni bosing — admin qo‘lda tekshiradi.');\n      var force=function(){api('receipt_force',{id:id}).then(function(){hap('ok');S.done={id:id,rc:'check'};go('done');}).catch(function(e){say(e.message);});};\n      try{W.showConfirm(ask,function(y){if(y)force();});}catch(_){if(confirm(ask))force();}}\n  }).catch(function(e){S.busy=false;say(e.message);});});}\nfunction say0(m){var b=$('toast');if(!b){b=document.createElement('div');b.id='toast';b.style.cssText='position:fixed;left:50%;top:14px;transform:translateX(-50%);background:var(--ind);color:#fff;padding:10px 16px;border-radius:12px;z-index:50;font-weight:700';document.body.appendChild(b);}b.textContent=NA(m);clearTimeout(b._t);b._t=setTimeout(function(){b.remove();},2500);}\nfunction render(){nav();var h='';\n  if(S.view==='shop')h=vShop();else if(S.view==='cart')h=vCart();else if(S.view==='checkout')h=vCheckout();else if(S.view==='orders')h=vOrders();else if(S.view==='done')h=vDone();else if(S.view==='keys')h=vKeys();else if(S.view==='kbook')h=vKBook();else if(S.view==='admin')h=vAdmin();else if(S.view==='test')h=vTest();\n  $('app').innerHTML=h;bar();conv($('app'));conv($('nav'));conv($('tabs'));conv($('bar'));\n  try{if((S.view==='shop'&&!S.cat)||S.view==='done')W.BackButton.hide();else W.BackButton.show();}catch(e){}}\n\nfunction go(v){if(v==='checkout'){if(!cartSum().s)return;if(!S.form){var u=S.D.user||{};S.form={name:u.name||'',phone:u.phone||'',prev:u.address||'',prevShow:u.addressShow||'',am:u.address?'prev':'list',region:'',district:'',districtText:'',street:'',address:'',comment:'',err:''};}}\n  if((v==='keys'||v==='kbook')&&!S.keys){api('keys').then(function(j){S.keys=j.keys;S.res=j.results||[];if(S.view==='keys'||S.view==='kbook')render();}).catch(function(e){say(e.message);});}\n  if(v==='admin')aLoad();\n  if(v==='orders'){S.orders=null;api('orders').then(function(j){S.orders=j.orders;S.payInfo=j.payInfo;if(S.view==='orders')render();}).catch(function(e){say(e.message);});}\n  S.view=v;window.scrollTo(0,0);render();}\n\nfunction setQty(id,q){q=Math.max(0,Math.min(20,q));var old=JSON.stringify(S.D.cart);\n  var C=S.D.cart.filter(function(x){return x.id!==id;});var b=S.D.books.filter(function(x){return x.id===id;})[0];\n  if(q>0){var ex=S.D.cart.filter(function(x){return x.id===id;})[0];C.push({id:id,qty:q,title:(ex||b).title,price:(ex||b).price});}\n  S.D.cart=C;hap();render();\n  api('cart',{book_id:id,qty:q}).then(function(j){S.D.cart=j.cart;render();}).catch(function(e){S.D.cart=JSON.parse(old);render();say(e.message);});}\n\nfunction openBook(id){var b=S.D.books.filter(function(x){return x.id===id;})[0];if(!b)return;\n  var d=document.createElement('div');d.className='sheet';d.id='sheet';\n  d.innerHTML='<div class=\"in\"><button class=\"x\" data-close>✕</button><div class=\"cov\" style=\"margin-top:40px\">'+img(b)+'</div><h2 style=\"margin-top:14px\">'+esc(b.title)+'</h2><div class=\"pr'+(b.price>0?'':' soon')+'\" style=\"font-size:18px\">'+(b.price>0?money(b.price):'⏳ Narxi tez orada e’lon qilinadi')+'</div><p style=\"white-space:pre-wrap;color:var(--ink2)\">'+esc(b.desc||'')+'</p>'+(b.pdf?'<div class=\"note\" style=\"margin:0 0 10px\">📄 Elektron (PDF) kitob — to‘lov tasdiqlangach «📦 Buyurtmalar» bölimida ilovaning özida ochiladi, pochta kerak emas.</div>':'')+(b.smp?'<div class=\"note\" style=\"margin:0 0 2px;font-weight:700;color:var(--ind)\">📖 Namuna sahifalar</div><div class=\"gal\" id=\"sgal\"><div class=\"note\">Yuklanmoqda…</div></div>':'')+(b.nk?'<button class=\"add soft\" style=\"margin-bottom:10px\" data-kopen=\"'+b.id+'\">✅ Testlar javoblari ('+b.nk+' ta test)</button>':'')+'<div id=\"sbuy\">'+buyBtn(b)+'</div></div>';\n  document.body.appendChild(d);conv(d);\n  if(b.smp)api('samples',{book_id:b.id}).then(function(j){var g=$('sgal');if(!g)return;S.smp=j.samples;g.innerHTML=j.samples.map(function(x,i){return x.kind==='photo'?'<img src=\"/app/smp/'+x.id+'\" data-simg=\"'+i+'\" loading=\"lazy\" alt=\"\">':x.kind==='video'?'<video src=\"/app/smp/'+x.id+'\" controls playsinline preload=\"metadata\"></video>':'<button class=\"gdoc\" data-spdf=\"'+x.id+'\"><i>📄</i>PDF namuna</button>';}).join('')||'<div class=\"note\">Namuna topilmadi</div>';conv(g);}).catch(function(e){var g=$('sgal');if(g)g.innerHTML='<div class=\"note\">⚠️ '+esc(e.message)+'</div>';});}\nfunction sheet2(html){var o=$('sheet2');if(o)o.remove();var d=document.createElement('div');d.className='sheet';d.id='sheet2';d.style.zIndex=30;d.innerHTML='<div class=\"in\" style=\"max-height:96vh\"><button class=\"x\" data-close2>✕</button><div style=\"clear:both;padding-top:6px\">'+html+'</div></div>';document.body.appendChild(d);conv(d);return d;}\nfunction viewImg(i){var L=(S.smp||[]).filter(function(x){return x.kind==='photo';});var all=S.smp||[];var x=all[i];if(!x)return;sheet2('<img src=\"/app/smp/'+x.id+'\" style=\"width:100%;border-radius:10px;background:#efeef6\">'+(all.length>1?'<div class=\"row2\"><button class=\"add soft\" data-simg=\"'+((i-1+all.length)%all.length)+'\">‹ Oldingi</button><button class=\"add soft\" data-simg=\"'+((i+1)%all.length)+'\">Keyingi ›</button></div>':''));}\nfunction loadPdfJs(){return window.pdfjsLib?Promise.resolve():new Promise(function(ok,no){var sc=document.createElement('script');sc.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';sc.onload=function(){pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';ok();};sc.onerror=function(){no(new Error('PDF ko‘rsatkich yuklanmadi'));};document.head.appendChild(sc);});}\nfunction openPdf(getBuf,title){var d=sheet2('<h3>📄 '+esc(title||'PDF')+'</h3><div class=\"pdfv\" id=\"pdfv\"><div class=\"load\">Yuklanmoqda…</div></div>');\n  Promise.all([loadPdfJs(),getBuf()]).then(function(r){return pdfjsLib.getDocument({data:r[1]}).promise;}).then(function(doc){var box=$('pdfv');if(!box)return;box.innerHTML='<div class=\"note\" style=\"margin:0 0 8px\">'+doc.numPages+' bet</div>';var i=1;\n    (function next(){if(i>doc.numPages||!$('pdfv'))return;doc.getPage(i).then(function(pg){var vp=pg.getViewport({scale:Math.min(2,(box.clientWidth*2)/pg.getViewport({scale:1}).width)});var cv=document.createElement('canvas');cv.width=vp.width;cv.height=vp.height;box.appendChild(cv);return pg.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;}).then(function(){i++;next();});})();})\n  .catch(function(e){var box=$('pdfv');if(box)box.innerHTML='<div class=\"empty\">⚠️ '+esc(NA(e.message))+'</div>';});}\nfunction bufGet(url){return fetch(url).then(function(r){if(!r.ok)throw new Error('Faylni yuklab bo‘lmadi');return r.arrayBuffer();});}\nfunction bufPost(op,b){b=b||{};b.initData=ID;return fetch('/app/api/'+op,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){if(!r.ok)return r.json().then(function(j){throw new Error(j.error||'Xatolik');});return r.arrayBuffer();});}\nfunction closeSheet(){var s=$('sheet');if(s)s.remove();}\n\nfunction submit(){var F=S.form;F.err='';\n  var body={name:F.name.trim(),phone:F.phone.trim(),comment:F.comment.trim()};\n  if(body.name.length<3)F.err='Ism va familiyangizni to‘liq yozing';\n  else if(body.phone.replace(/\\D/g,'').length<9)F.err='Telefon raqam noto‘g‘ri. Masalan: +998 90 123 45 67';\n  else if(cartDigital()){body.comment='-';}\n  else if(F.am==='prev')body.address=F.prev;\n  else if(F.am==='manual'){if(F.address.trim().length<8)F.err='Manzilni batafsilroq yozing (viloyat, tuman, ko‘cha, uy)';else body.address=F.address.trim();}\n  else{var dist=F.district==='__other'?F.districtText.trim():F.district;\n    if(!F.region)F.err='Viloyatni tanlang';else if(!dist)F.err='Tuman yoki shaharni tanlang';else if(F.street.trim().length<3)F.err='Mahalla, ko‘cha va uy raqamini yozing';\n    else{body.region=F.region;body.district=dist;body.street=F.street.trim();}}\n  if(!F.err&&!cartDigital()&&body.comment.length<5)F.err='Yaqin BTS yoki EMU pochta bo‘limi manzilini yozing';\n  if(F.err){render();var e=$('err');if(e)e.scrollIntoView({block:'center'});try{W.HapticFeedback.notificationOccurred('error');}catch(_){}return;}\n  S.busy=true;render();\n  api('order',body).then(function(j){S.busy=false;var pu=S.D.user||{},ad=body.region?[body.region,body.district,body.street].join(', '):(body.address||pu.address||'');S.D.user={name:body.name,phone:body.phone,address:ad,addressShow:NA(ad)};S.done=j;S.form=null;S.D.cart=j.cart||[];hap('ok');go('done');})\n  .catch(function(e){S.busy=false;F.err=e.message;render();});}\n\ndocument.addEventListener('click',function(e){var t=e.target.closest('[data-arel],[data-baud],[data-bpic],[data-bpicx],[data-bbtn],#bsend,[data-mypdf],[data-simg],[data-spdf],[data-close2],[data-rcpt],[data-kopen],[data-atab],[data-afil],[data-ast],[data-arc],[data-asv],[data-atg],[data-apdf],[data-arm],#nbadd,[data-kb],[data-q],[data-nav],[data-cat],[data-open],[data-close],[data-smp],[data-am],[data-test],[data-a],#send,#close,#kadd,#tcheck,#tkey,#tagain,#tdel');\n  if(!t){if(e.target.classList&&e.target.classList.contains('sheet'))closeSheet();return;}\n  if(t.dataset.q){var p=t.dataset.q.split(':');setQty(+p[0],+p[1]);var sb=$('sbuy');if(sb){var b=S.D.books.filter(function(x){return x.id===+p[0];})[0];sb.innerHTML=buyBtn(b);conv(sb);}return;}\n  if(t.dataset.nav){closeSheet();go(t.dataset.nav);return;}\n  if(t.dataset.cat!=null&&t.dataset.cat!==undefined&&t.hasAttribute('data-cat')){S.cat=t.dataset.cat;S.qs='';hap();render();window.scrollTo(0,0);return;}\n  if(t.dataset.open){openBook(+t.dataset.open);return;}\n  if(t.dataset.close!=null){closeSheet();return;}\n  if(t.dataset.close2!=null){var s2=$('sheet2');if(s2)s2.remove();return;}\n  if(t.dataset.simg){viewImg(+t.dataset.simg);return;}\n  if(t.dataset.spdf){openPdf(function(){return bufGet('/app/smp/'+t.dataset.spdf);},'Namuna');return;}\n  if(t.dataset.mypdf){var mb=+t.dataset.mypdf;openPdf(function(){return bufPost('mypdf',{book_id:mb});},t.dataset.t);return;}\n  if(t.dataset.smp){t.disabled=true;api('sample',{book_id:+t.dataset.smp}).then(function(){hap('ok');say('📖 Namuna bot chatiga yuborildi');}).catch(function(e){say(e.message);}).then(function(){t.disabled=false;});return;}\n  if(t.dataset.am){S.form.am=t.dataset.am;S.form.err='';render();return;}\n  if(t.id==='send'){if(!S.busy)submit();return;}\n  if(t.id==='close'){try{W.close();}catch(_){}return;}\n  if(t.dataset.rcpt){if(!S.busy)sendReceipt(+t.dataset.rcpt);return;}\n  if(t.dataset.kopen){var kid=+t.dataset.kopen;closeSheet();S.KB=kid;go('kbook');return;}\n  if(t.dataset.arel!=null){S.A.st=null;render();aLoad();return;}\n  if(t.dataset.baud){S.A.bc.aud=t.dataset.baud;render();return;}\n  if(t.dataset.bbtn!=null){S.A.bc.btn=t.checked?1:0;return;}\n  if(t.dataset.bpicx!=null){S.A.bc.file=null;S.A.bc.fname='';render();return;}\n  if(t.dataset.bpic!=null){pickFile('image/*',function(f){if(f.size>10*1024*1024){say('Rasm 10 MB dan oshmasin');return;}S.A.bc.file=f;S.A.bc.fname=f.name.slice(0,18);render();});return;}\n  if(t.id==='bsend'){var B=S.A.bc;if(!B.text.trim()&&!B.file){say('Xabar matnini yozing');return;}var cnt=(S.A.bcs&&S.A.bcs.counts[B.aud])||0;\n    var go3=function(){S.busy=true;render();var pr=B.file?upload('a_bc',{text:B.text,aud:B.aud,btn:B.btn},B.file):api('a_bc',{text:B.text,aud:B.aud,btn:B.btn});\n      pr.then(function(j){S.busy=false;hap('ok');S.A.bc={text:'',aud:'all',btn:1,file:null,fname:''};say('✅ Xabar '+j.n+' ta foydalanuvchiga tarqatila boşlandi. Namunasi sizga yuborildi.');aLoad();}).catch(function(e){S.busy=false;render();say(e.message);});};\n    var q=NA('Xabar '+cnt+' ta foydalanuvchiga yuborilsinmi?');try{W.showConfirm(q,function(y){if(y)go3();});}catch(_){if(confirm(q))go3();}return;}\n  if(t.dataset.atab){S.A.tab=t.dataset.atab;render();aLoad();return;}\n  if(t.dataset.afil){S.A.filter=t.dataset.afil;S.A.orders=null;render();aLoad();return;}\n  if(t.dataset.ast){var pa=t.dataset.ast.split(':'),oid=+pa[0],to=pa[1];var lbl={confirmed:'to‘lovni tasdiqlaysizmi',cancelled:'buyurtmani bekor qilasizmi',reject:'chekni rad etasizmi',sent:'pochtaga topshirildi deb belgilaysizmi',done:'yetkazildi deb belgilaysizmi'}[to];\n    var doIt=function(){t.disabled=true;api('a_status',{id:oid,to:to,track:S.A.track[oid]||''}).then(function(){hap('ok');say0('✅ Saqlandi, mijozga xabar ketdi');aLoad();}).catch(function(e){t.disabled=false;say(e.message);});};\n    var q=NA('#'+oid+': '+lbl+'?');try{W.showConfirm(q,function(y){if(y)doIt();});}catch(_){if(confirm(q))doIt();}return;}\n  if(t.dataset.arc){t.disabled=true;fetch('/app/api/a_receipt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({initData:ID,id:+t.dataset.arc})}).then(function(r){if(!r.ok)throw new Error('Chek topilmadi');return r.blob();}).then(function(bl){t.disabled=false;var u=URL.createObjectURL(bl);var d=document.createElement('div');d.className='sheet';d.id='sheet';d.innerHTML='<div class=\"in\"><button class=\"x\" data-close>✕</button><div style=\"clear:both;padding-top:8px\">'+(bl.type==='application/pdf'?'<iframe src=\"'+u+'\" style=\"width:100%;height:70vh;border:0\"></iframe>':'<img src=\"'+u+'\" style=\"width:100%;border-radius:10px\">')+'</div></div>';document.body.appendChild(d);}).catch(function(e){t.disabled=false;say(e.message);});return;}\n  if(t.dataset.asv){var bid=+t.dataset.asv,inp=document.querySelector('[data-apr=\"'+bid+'\"]');api('a_book',{id:bid,price:inp?inp.value:0}).then(function(j){S.A.books=j.books;hap('ok');say0('💾 Narx saqlandi');render();}).catch(function(e){say(e.message);});return;}\n  if(t.dataset.atg){var bk=S.A.books.filter(function(x){return x.id===+t.dataset.atg;})[0];api('a_book',{id:bk.id,active:!bk.active}).then(function(j){S.A.books=j.books;render();}).catch(function(e){say(e.message);});return;}\n  if(t.dataset.apdf){var pb=+t.dataset.apdf;pickFile('application/pdf',function(f){say0('⏳ PDF yuklanmoqda…');upload('a_pdf',{id:pb},f).then(function(j){S.A.books=j.books;hap('ok');say0('📄 PDF saqlandi');render();}).catch(function(e){say(e.message);});});return;}\n  if(t.dataset.arm){var rb=+t.dataset.arm;var go2=function(){api('a_book',{id:rb,removePdf:1}).then(function(j){S.A.books=j.books;render();}).catch(function(e){say(e.message);});};try{W.showConfirm(NA('PDF faylni olib tashlaysizmi?'),function(y){if(y)go2();});}catch(_){go2();}return;}\n  if(t.id==='nbadd'){var nb=S.A.nb;api('a_new',nb).then(function(j){S.A.books=j.books;S.A.nb={};hap('ok');say0('✅ Kitob qo‘shildi');render();api('catalog').then(function(c){S.D.books=c.books;});}).catch(function(e){say(e.message);});return;}\n  if(t.dataset.kb){S.KB=+t.dataset.kb;go('kbook');return;}\n  if(t.dataset.test){var id=+t.dataset.test;S.keys.forEach(function(b){b.tests.forEach(function(x){if(x.id===id){S.T={t:x,book:b.title,ans:[],checked:false,showKey:false};S.KB=b.id;}});});go('test');return;}\n  if(t.dataset.a){var p2=t.dataset.a.split(':');S.T.ans[+p2[0]]=S.T.ans[+p2[0]]===p2[1]?'':p2[1];hap();render();return;}\n  if(t.id==='tcheck'){S.T.checked=true;hap('ok');var sv={id:S.T.t.id,answers:S.T.ans.slice()};render();window.scrollTo(0,0);api('tsave',sv).then(function(j){S.res=j.results||S.res;}).catch(function(){});return;}\n  if(t.id==='tagain'){S.T.ans=[];S.T.checked=false;S.T.showKey=false;render();window.scrollTo(0,0);return;}\n  if(t.id==='tkey'){S.T.showKey=!S.T.showKey;render();if(S.T.showKey)window.scrollTo(0,document.body.scrollHeight);return;}\n  if(t.id==='tdel'){var del=function(){api('kdel',{id:S.T.t.id}).then(function(j){S.keys=j.keys;go('kbook');}).catch(function(e){say(e.message);});};try{W.showConfirm(NA('Bu test kalitini o‘chirasizmi?'),function(y){if(y)del();});}catch(_){if(confirm('O‘chirilsinmi?'))del();}return;}\n  if(t.id==='kadd'){var K=S.kf;K.err='';if(!K.book_id){K.err='Kitobni tanlang';render();return;}t.disabled=true;\n    api('kadd',{book_id:+K.book_id,text:K.text}).then(function(j){S.keys=j.keys;K.text='';K.err='';say('✅ '+j.added+' ta test kaliti qo‘shildi');render();}).catch(function(e){K.err=e.message;render();});return;}\n});\ndocument.addEventListener('input',function(e){var ds=e.target.dataset||{};\n  if(e.target.id==='qs'){S.qs=e.target.value;var g=$('grid');if(g){g.innerHTML=S.qs.trim()||S.cat?gridHtml():homeHtml();conv(g);}nav();conv($('tabs'));return;}\n  if(ds.nb){S.A.nb[ds.nb]=e.target.value;return;}\n  if(ds.bc){S.A.bc[ds.bc]=e.target.value;return;}\n  if(ds.atr){S.A.track[ds.atr]=e.target.value;return;}\n  var k=e.target.dataset&&e.target.dataset.k;if(k){S.kf[k]=e.target.value;return;}var f=e.target.dataset&&e.target.dataset.f;if(!f||!S.form)return;S.form[f]=e.target.value;\n  if(f==='region'){S.form.district='';render();}else if(f==='district'){render();}});\ntry{W.BackButton.onClick(function(){if($('sheet2'))return $('sheet2').remove();if($('sheet'))return closeSheet();if(S.view==='shop'&&S.cat){S.cat='';render();window.scrollTo(0,0);return;}go(S.view==='checkout'?'cart':S.view==='test'?'kbook':S.view==='kbook'?'keys':'shop');});}catch(e){}\n\nif(!ID){$('app').innerHTML=NA('<div class=\"empty\">Bu do‘kon Telegram ichida ochiladi.<br><br><a href=\"https://t.me/Aqlzor_bot\">@Aqlzor_bot</a> ga o‘ting va «🛍 Do‘kon» tugmasini bosing.</div>');return;}\napi('catalog').then(function(j){S.D=j;S.cat='';var h=location.hash.slice(1);if(h==='cart'||h==='orders'||h==='keys'||(h==='admin'&&j.admin))go(h);else render();})\n.catch(function(e){$('app').innerHTML='<div class=\"empty\">⚠️ '+esc(e.message)+'<br><br><button class=\"add\" style=\"width:auto;padding:10px 18px\" onclick=\"location.reload()\">Qayta urinish</button></div>';});\n})();\n</script>\n</body>\n</html>\n";
