# OSS Steam — Backend

Bu backend saytdagi buyurtma formasidan kelgan ma'lumotlarni qabul qiladi, bazaga
saqlaydi va **har bir yangi buyurtmani avtomatik ravishda Telegram botga** yuboradi.
Admin panel orqali buyurtmalar va sharhlarni kuzatib borasiz.

## GitHub'ga yuklanadigan fayllar (barchasi bitta darajada, papkasiz)

```
oss-steam-backend/
├── server.js
├── package.json
├── .env.example
├── README.md
└── admin.html          <- diqqat: "public/" papkasi ICHIDA EMAS, to'g'ridan-to'g'ri asosiy joyda
```

Agar avval `public/admin.html` deb yuklagan bo'lsangiz — uni o'chirib, shu joyga
(asosiy papkaga) qayta yuklang, aks holda admin panel ochilmaydi.

## Nima uchun Steam akkauntni o'zi avtomatik yaratmaydi

Steam'da yangi akkaunt ochish bosqichida captcha va email tasdiqlash choralari bor.
Buni dasturiy ravishda aylanib o'tadigan bot yasash Steam qoidalarini buzadi va
firibgarlik uchun ishlatilishi mumkin, shuning uchun bu qism qo'shilmagan. Akkaunt
yaratish jarayonini operator (siz) qo'lda bajarasiz, so'ng admin paneldan buyurtmani
"bajarildi" deb belgilaysiz.

## Railway'da ishga tushirish

1. Yuqoridagi 5 ta faylni GitHub repongizga yuklang (papkasiz, bitta darajada).
2. railway.app'da "New Project" → "Deploy from GitHub repo" → repongizni tanlang.
3. "Variables" bo'limida quyidagilarni qo'shing:
   - `TELEGRAM_BOT_TOKEN` — @BotFather'dan olingan token
   - `TELEGRAM_CHAT_ID` — @userinfobot'dan olingan ID
   - `ADMIN_TOKEN` — `.env.example`dagi tayyor qiymat (yoki o'zingiz yangisini generatsiya qiling)
   - `ALLOWED_ORIGIN` — hozircha `*` deb qoldiring
   - `PORT` — `3000`
4. "Settings" → "Networking" → "Generate Domain" — sizga URL beriladi.
5. Shu URL'ni `oss-steam.html` faylidagi `BACKEND_URL` o'zgaruvchisiga yozing.
6. `https://sizning-domeningiz/admin.html` sahifasini oching, `ADMIN_TOKEN` qiymatini kiriting.

## Tekshirish

- `https://sizning-domeningiz/api/health` — `{"ok":true,...}` chiqishi kerak (server ishlayapti).
- `https://sizning-domeningiz/admin.html` — token kiritib kirish mumkin bo'lishi kerak.

## Xavfsizlik choralari

- **helmet** — standart HTTP xavfsizlik header'lari
- **CORS** — faqat `ALLOWED_ORIGIN`da ko'rsatilgan domendan so'rovlarga ruxsat
- **Rate limiting** — buyurtma va sharh endpointlariga alohida spam/bot cheklovi
- **Input validatsiya** — telefon, ism, nik, parol, email formati tekshiriladi
- **Parol hash** — mijoz bergan parol bazada ochiq emas, SHA-256 hash holida saqlanadi
- **Admin panel himoyasi** — `x-admin-token` maxsus kalitisiz hech kim ma'lumot ko'ra olmaydi

## Muhim eslatma — kafolat haqida

Hech qanday sayt yoki server 100% "buzilmas" bo'lmaydi. Production'ga chiqarishdan
oldin: `.env`ni GitHub'ga yuklamang, muntazam zaxira nusxa (`orders.db`) oling, va
serverni yangilab turing (`npm audit`, `npm update`).

## API

| Endpoint | Usul | Tavsif |
|---|---|---|
| `/api/order` | POST | Yangi buyurtma qabul qiladi, Telegramga yuboradi |
| `/api/reviews` | GET / POST | Sharhlarni o'qish / yangi sharh qo'shish |
| `/api/admin/orders` | GET | Buyurtmalar ro'yxati (admin token kerak) |
| `/api/admin/orders/:id/status` | POST | Buyurtma holatini yangilash (admin token kerak) |
| `/api/admin/reviews/:id` | DELETE | Sharhni o'chirish (admin token kerak) |
| `/api/health` | GET | Server ishlayotganini tekshirish |
| `/admin.html` | GET | Admin panel sahifasi |
