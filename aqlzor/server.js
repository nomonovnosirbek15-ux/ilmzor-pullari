
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
