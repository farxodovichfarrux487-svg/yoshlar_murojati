# Yoshlar va Rahbar Uchrashuvi portali

Jarayon: bayonnoma qo'lda tuziladi, imzolanib PDF shaklida yuklanadi → murojaat kiritiladi → tashkilot rahbariga Telegram xabari boradi → rahbar login-parol bilan kirib,
bayonnomani o'qiydi va javob xatini kiritadi → admin tasdiqlaydi → murojaat "Ijobiy hal etildi" bo'ladi.

## Ishga tushirish (D:\partal)
1. Zip ichidagi fayllarni D:\partal ga nusxalang (mavjudlarini almashtirish: Ha). `.env` fayliga tegmang.
2. Eski, endi kerak bo'lmagan fayllarni o'chiring: `routes\`, `middleware\`, `services\`, `database.js`, `database.sql`, `setup.js`, `public\login.html`.
3. `.env` ga qo'shing (namuna: `.env.example`):
   - `TELEGRAM_BOT_TOKEN=` (@BotFather bergan token)
   - `BASE_URL=` (rahbarlar kiradigan manzil, masalan http://192.168.1.10:3000)
   - `SESSION_SECRET=` uzun tasodifiy matn. `DATABASE_URL` endi kerak emas (baza SQLite: `data\portal.db`).
4. `npm install`, keyin `npm start`. Brauzerda: http://localhost:3000

## Boshlang'ich login / parollar (birinchi kirishda almashtirish majburiy)
| Login | Parol | Rol |
|---|---|---|
| admin | Admin123! | Super admin |
| hokim | Hokim123! | Tuman rahbari |
| bandlik | Bandlik123! | Tashkilot rahbari |
| bank | Bank12345! | Tashkilot rahbari |
| agent | Agent123! | Tashkilot rahbari |
| med | Med12345! | Tashkilot rahbari |

## Telegram
Bot rahbarga birinchi bo'lib yoza olmaydi. Har bir rahbar: Profil → "Ulash kodini olish" → Telegramda botga `/start KOD` yuboradi.
Admin ham "Rahbarlar" bo'limidan istalgan rahbar uchun kod olib bera oladi. Ulanmagan rahbar jadvalda ✈️✕ bilan ko'rinadi.
Eslatmalar har kuni 09:00 dan keyin (10, 5, 3, 2, 1, 0 kun qolganda va muddati o'tganda) avtomatik yuboriladi.

## Eslatma
- Kompyuter/server yoqilgan va `npm start` ishlab turishi kerak. Rahbarlar o'z telefonidan kirishi uchun server tarmoqda ochiq bo'lishi kerak.
- Zaxira: `data\portal.db` va `uploads\` papkalarini muntazam nusxalang.
- HTTPS orqali ishlatilsa `.env` da `COOKIE_SECURE=1`.

## Bayonnoma va murojaat qoidalari
- Bayonnoma tizimda yozilmaydi: qo'lda tuzilib, imzolangan PDF (20 MB gacha) "Bayonnomalar" bo'limidan yuklanadi. Fayl haqiqiy PDF ekani tekshiriladi.
- Murojaat qo'shishda majburiy: familiya, ism, otasining ismi, telefon (+998 XX XXX XX XX), mahalla, toifa, masala, mazmun, bayonnoma, mas'ul rahbar, ijro muddati. Izoh ixtiyoriy.
- Toifalar: doimiy ishga joylashtirish, kredit ajratish, yoshlar daftariga kiritish, kasb-hunarga o'qitish, migratsiyaga jo'natish, davolanish, asbob-uskuna ajratish, boshqa masalalar.
- Namunaviy bayonnoma №1 PDF siz yaratilgan. "Bayonnomalar" → ✏️ orqali PDF yuklang yoki namunaviy ma'lumotni o'chiring (README oxiridagi "Namunaviy holat" tugmasi emas, `data\portal.db` ni o'chirib qayta ishga tushiring).
- Oldingi versiyada ishlagan bo'lsangiz, baza avtomatik yangilanadi; eski bayonnomalar "PDF yuklanmagan" deb ko'rinadi.
