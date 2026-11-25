# @Aqlzor_bot — Telegram Mini App (kitob do'koni)
* `app.html` — do'kon sahifasi (katalog, savatcha, buyurtma, buyurtmalarim).
* `server.js` — bot worker (`aqlzor-bot`) oxiriga qo'shiladigan qism: `/app`, `/app/img/:id`, `/app/api/*`, menyu tugmasi.
* `append.js` — `server.js` + `APP_HTML` (yuklanadigan tayyor qism).
Kirish Telegram `initData` imzosi bilan (BOT_TOKEN). Buyurtma botdagi `createOrder` / `notifyAdmins` / `toSheets` orqali o'tadi.
