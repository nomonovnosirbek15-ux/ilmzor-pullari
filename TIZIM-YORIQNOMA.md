# Ilmzor — Vazifalar, ballar va Ilmzor puli tizimi

## Tarkibi
| Qism | Qayerda | Vazifasi |
|---|---|---|
| `ilmzor-baho` | Cloudflare Worker + D1 (`a3440e9f-…`) | Sayt: rahbar, ustoz, sotuvchi; o'quvchi sahifasi `/men`; ochiq reyting `/reyting` |
| `ilmzor-test-bot` | Cloudflare Worker + D1 (`b2ef9963-…`) | @ilmzor_test_bot: testlar, Vazifalarim, Ilmzor pulim, Do'kon, xabarnomalar, kunlik zaxira |
| Kod | GitHub `nomonovnosirbek15-ux/ilmzor-pullari`, `ilmzor-baho` tarmog'i | `src/` — manba, `dist/` — yuklanadigan fayllar (`python3 build.py`) |

Bot saytga `BAHO` service binding orqali murojaat qiladi (`https://baho/api/bot/*`, `/api/s/*`).
Bot sirlari (BOT_TOKEN va b.) Cloudflare'da Secret sifatida turadi — kodda yo'q.

## Zaxira
* Har kuni 23:00 (Toshkent) bot CEO ga `ilmzor-zaxira-SANA.json.gz` yuboradi (ikkala baza).
* Istalgan vaqt: botga `/zaxira` yoki saytda «💾 Hozir yuklab olish».
* Cloudflare D1 o'zi ham oxirgi kunlar holatiga qaytara oladi (Time Travel).

## Tiklash
1. `python3 tools/tiklash.py ilmzor-zaxira-SANA.json.gz` → `baho.sql`, `bot.sql`
2. Yangi/bo'sh D1 ga: `npx wrangler d1 execute DB --remote --file baho.sql` (bot uchun ham shunday)
3. Workerlarni `dist/` dan qayta yuklash, bindinglarni ulash (DB, BAHO, Secret'lar).
4. Zaxirada parollar yo'q: rahbar paroli D1 da yangilanadi, xodimlarga «🔑 Yangi parol».

## Uzoq muddat uchun qoidalar
* Ilovaga oxirgi ~13 oy vazifalari yuklanadi; eskilari bazada va zaxirada qoladi.
* Reyting va hisobotlar sana bo'yicha indeks bilan o'qiladi, 30 soniya keshlanadi.
* Ilmzor puli: avtomatik pul `Qoidalar → boshlanish sanasi` dan keyingi vazifalarga.

## Telegram Mini App (25.11.2026)
* `ilmzor-test-bot` worker'ida `/app` — o'quvchi sahifasi (`/men`) Telegram ichida. Kirish Telegram `initData` imzosi bilan (BOT_TOKEN), kod `baho_link` jadvalidan olinadi.
* Botdagi pastki chap «📱 Ilova» tugmasi (setChatMenuButton, `appcfg.menu=v1`) va «📝 Vazifalarim» xabaridagi «📱 Ilovada ochish».
* Kod: `bot/miniapp.js` (bot worker oxiriga qo'shilgan qism).
