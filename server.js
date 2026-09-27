// OSS Steam — backend server
// Vazifasi: saytdan kelgan buyurtmalarni qabul qiladi, tekshiradi (validatsiya),
// bazaga saqlaydi va HAR BIR YANGI BUYURTMANI AVTOMATIK ravishda Telegram botga yuboradi.
//
// MUHIM: bu server Steam akkauntlarini o'zi yaratmaydi — bu qonuniy emas va Steam
// qoidalariga zid (captcha/bot-himoyani aylanib o'tishni talab qiladi). Bu server
// faqat buyurtmalarni qabul qilish + operatorga (sizga) Telegram orqali xabar
// berish vazifasini bajaradi. Akkauntni operator (siz) qo'lda yoki o'z ish
// jarayoningiz asosida tayyorlaysiz, keyin admin panel orqali mijozga yuborilgan
// deb belgilaysiz.

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const fetch = require('node-fetch');

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN; // admin panelga kirish uchun maxfiy kalit
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*'; // saytingiz domeni, masalan https://osssteam.uz

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.warn('[OGOHLANTIRISH] TELEGRAM_BOT_TOKEN yoki TELEGRAM_CHAT_ID sozlanmagan — .env faylini tekshiring.');
}
if (!ADMIN_TOKEN) {
  console.warn('[OGOHLANTIRISH] ADMIN_TOKEN sozlanmagan — admin panel himoyasiz qoladi. .env ga qo\'shing.');
}

// ---------- Ma'lumotlar bazasi ----------
const db = new Database(path.join(__dirname, 'orders.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    nick TEXT,
    pass_hash TEXT,
    email TEXT,
    status TEXT NOT NULL DEFAULT 'yangi',
    created_at TEXT NOT NULL,
    ip TEXT
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    rating INTEGER NOT NULL,
    comment TEXT,
    created_at TEXT NOT NULL,
    ip TEXT
  );
`);

// Parolni bazada ochiq saqlamaymiz — faqat hash. Operator akkaunt yaratganda
// mijoz bilan alohida (masalan Telegram orqali) bog'lanib real parolni so'raydi
// yoki mijoz o'zi keyinchalik akkauntga kirib parolni o'zgartiradi.
function hashSecret(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// ---------- Express sozlamalari ----------
const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '20kb' }));
app.use('/admin.html', express.static(path.join(__dirname, 'admin.html')));

app.use(cors({
  origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN.split(',').map(s => s.trim()),
  methods: ['GET', 'POST'],
}));

// Barcha so'rovlar uchun umumiy tezlik cheklovi (DDoS/spam'dan himoya)
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Buyurtma yuborish endpointiga qattiqroq limit (bot-spam'dan himoya)
const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Juda ko'p urinish. Birozdan so'ng qayta urinib ko'ring." },
});

// ---------- Validatsiya ----------
const PHONE_RE = /^\+?[0-9\s\-()]{7,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateOrder(body) {
  const errors = [];
  const service = String(body.service || '').trim();
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const nick = String(body.nick || '').trim();
  const pass = String(body.pass || '').trim();
  const email = String(body.email || '').trim();

  if (!['ready', 'new'].includes(service)) errors.push('Xizmat turi noto\'g\'ri.');
  if (name.length < 2 || name.length > 80) errors.push('Ism noto\'g\'ri kiritilgan.');
  if (!PHONE_RE.test(phone)) errors.push('Telefon raqam noto\'g\'ri.');
  if (service === 'new') {
    if (nick.length < 3 || nick.length > 40) errors.push('Nik kamida 3 ta belgidan iborat bo\'lishi kerak.');
    if (pass.length < 8 || pass.length > 64) errors.push('Parol kamida 8 ta belgidan iborat bo\'lishi kerak.');
    if (email && !EMAIL_RE.test(email)) errors.push('Email manzil noto\'g\'ri.');
  }
  // Oddiy XSS/in'ektsiyaga qarshi: boshqaruvchi belgilarni rad etamiz
  const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;
  for (const v of [service, name, phone, nick, email]) {
    if (CONTROL_CHARS.test(v)) errors.push('Ruxsat etilmagan belgilar aniqlandi.');
  }

  return { errors, clean: { service, name, phone, nick, pass, email } };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------- Telegramga avtomatik yuborish ----------
async function sendTelegramNotification(order) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  const serviceLabel = order.service === 'ready' ? 'Tayyor akkaunt' : 'Yangi akkaunt (nik/parol bilan)';
  const lines = [
    '🆕 <b>Yangi buyurtma — OSS Steam</b>',
    `🆔 Buyurtma: #${order.id}`,
    `🎮 Xizmat: ${escapeHtml(serviceLabel)}`,
    `👤 Ism: ${escapeHtml(order.name)}`,
    `📞 Tel: ${escapeHtml(order.phone)}`,
  ];
  if (order.service === 'new') {
    lines.push(`🔤 Nik: ${escapeHtml(order.nick)}`);
    lines.push('🔒 Parol: admin panelda mavjud (xabarga chiqarilmaydi)');
    if (order.email) lines.push(`📧 Email: ${escapeHtml(order.email)}`);
  }
  lines.push(`🕒 ${order.created_at}`);

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: lines.join('\n'),
      parse_mode: 'HTML',
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error('[Telegram xatosi]', res.status, t);
  }
}

// ---------- Public API ----------
app.post('/api/order', orderLimiter, async (req, res) => {
  const { errors, clean } = validateOrder(req.body || {});
  if (errors.length) {
    return res.status(400).json({ ok: false, error: errors.join(' ') });
  }

  const created_at = new Date().toISOString();
  const passHash = clean.pass ? hashSecret(clean.pass) : null;

  const stmt = db.prepare(`
    INSERT INTO orders (service, name, phone, nick, pass_hash, email, status, created_at, ip)
    VALUES (@service, @name, @phone, @nick, @pass_hash, @email, 'yangi', @created_at, @ip)
  `);
  const info = stmt.run({
    service: clean.service,
    name: clean.name,
    phone: clean.phone,
    nick: clean.nick || null,
    pass_hash: passHash,
    email: clean.email || null,
    created_at,
    ip: req.ip,
  });

  const order = { id: info.lastInsertRowid, ...clean, created_at };

  // Xatolik bo'lsa ham mijozga muvaffaqiyatli javob beramiz — buyurtma bazada saqlangan,
  // Telegram xabari kelmasa operator admin paneldan ko'radi.
  sendTelegramNotification(order).catch(err => console.error('[Telegram yuborishda xatolik]', err));

  res.json({ ok: true, id: order.id });
});

// ---------- Admin API (ADMIN_TOKEN bilan himoyalangan) ----------
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: 'Ruxsat yo\'q.' });
  }
  next();
}

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT id, service, name, phone, nick, email, status, created_at FROM orders ORDER BY id DESC LIMIT 200').all();
  res.json({ ok: true, orders: rows });
});

app.post('/api/admin/orders/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  const allowed = ['yangi', 'jarayonda', 'bajarildi', 'bekor qilindi'];
  if (!allowed.includes(status)) return res.status(400).json({ ok: false, error: 'Noto\'g\'ri status.' });
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});

// Sharh (review) yuborish uchun cheklov — spam'dan himoya
const reviewLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Juda ko'p urinish. Birozdan so'ng qayta urinib ko'ring." },
});

function validateReview(body) {
  const errors = [];
  const name = String(body.name || '').trim().slice(0, 60) || 'Mijoz';
  const comment = String(body.comment || '').trim().slice(0, 300);
  const rating = parseInt(body.rating, 10);

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.push("Baho 1 dan 5 gachа bo'lishi kerak.");

  const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;
  if (CONTROL_CHARS.test(name) || CONTROL_CHARS.test(comment)) errors.push('Ruxsat etilmagan belgilar aniqlandi.');

  return { errors, clean: { name, comment, rating } };
}

app.post('/api/reviews', reviewLimiter, (req, res) => {
  const { errors, clean } = validateReview(req.body || {});
  if (errors.length) return res.status(400).json({ ok: false, error: errors.join(' ') });

  const created_at = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO reviews (name, rating, comment, created_at, ip)
    VALUES (@name, @rating, @comment, @created_at, @ip)
  `);
  const info = stmt.run({ ...clean, created_at, ip: req.ip });

  res.json({ ok: true, id: info.lastInsertRowid });
});

app.get('/api/reviews', (req, res) => {
  const rows = db.prepare('SELECT id, name, rating, comment, created_at FROM reviews ORDER BY id DESC LIMIT 100').all();
  res.json({ ok: true, reviews: rows });
});

app.delete('/api/admin/reviews/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Noma'lum endpointlar uchun umumiy javob (ichki xatolik tafsilotlarini oshkor qilmaymiz)
app.use((req, res) => res.status(404).json({ ok: false, error: 'Topilmadi.' }));
app.use((err, req, res, next) => {
  console.error('[Server xatosi]', err);
  res.status(500).json({ ok: false, error: 'Server xatosi. Birozdan so\'ng urinib ko\'ring.' });
});

app.listen(PORT, () => {
  console.log(`OSS Steam backend ${PORT}-portda ishga tushdi.`);
});
