# 🪙 Ilmzor puli

Ilmzor o'quv markazi uchun o'quvchilarni rag'batlantirish ilovasi.

- **Android** — APK fayl (GitHub avtomatik yig'adi)
- **iPhone** — veb-ilova (Safari → Ulashish → "Bosh ekranga qo'shish")

## Rollar

| Rol | Nima qila oladi |
|---|---|
| Admin | Akkaunt ochadi, rol beradi, guruhlar, sabablar va summalar, statistika, hisobni tuzatish, parolni yangilash |
| O'qituvchi | O'z hisobidagi puldan o'z guruhidagi o'quvchilarga pul beradi (bittaga yoki butun guruhga) |
| Sotuvchi | Do'kon mahsulotlari, o'quvchiga sotish, o'qituvchilar hisobini to'ldirish |
| O'quvchi | Balansi, tarixi, vazifa va testlarni bajarib pul ishlash, do'kon katalogi, reyting |

**Summalar:** admin har bir sabab uchun summa yozsa — u qat'iy bo'ladi. Bo'sh qoldirsa — o'qituvchi summani o'zi yozadi.

## O'rnatish

### 1. Supabase (server, bepul)
1. https://supabase.com → **Start your project** → GitHub bilan kiring.
2. **New project**: nomi `ilmzor-pullari`, parol o'ylab toping, region: **Central EU (Frankfurt)**.
3. Chap menyu → **SQL Editor** → **New query** → `supabase/schema.sql` faylidagi hamma matnni joylang → **Run**. Keyin xuddi shunday `supabase/02_vazifalar.sql` va `supabase/03_royxatdan_otish.sql` ni ham.
4. **Authentication → Sign In / Providers → Email** → **Confirm email** ni O'CHIRING → Save.
5. **Authentication → Users → Add user → Create new user**:
   email `admin@ilmzor.app`, parol, **Auto Confirm User** ✅.
   Bu birinchi foydalanuvchi avtomatik **admin** bo'ladi. Ilovaga login: `admin`.
6. **Project Settings → API**: `Project URL` va `anon public` (yoki `publishable`) kalitni `src/config.js` ga yozing.

### 2. GitHub (APK va veb)
- Repozitoriy nomi aynan `ilmzor-pullari` bo'lishi kerak (veb manzil shunga bog'langan).
- **Settings → Pages → Source: GitHub Actions**.
- Har safar kod yangilanganda **Actions** avtomatik ishlaydi:
  - APK: **Releases** bo'limida `ilmzor-puli.apk`
  - Veb: `https://<github-login>.github.io/ilmzor-pullari/`

## Eslatma
- Supabase bepul loyihasi 7 kun umuman ishlatilmasa "uxlab qoladi" — dashboard'dan **Restore** bosiladi.
- Ko'p akkaunt birdaniga ochilsa: **Authentication → Rate Limits** da ro'yxatdan o'tish limitini oshiring.
