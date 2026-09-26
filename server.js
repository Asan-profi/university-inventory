require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const SQLiteStore = require('connect-sqlite3')(session);

require('./db/database'); // ma'lumotlar bazasini ishga tushirish (jadval yaratish + admin urug'lash)
const { requireAuth, requireRole } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const inventoryRoutes = require('./routes/inventory');
const adminRoutes = require('./routes/admin');
const exportRoutes = require('./routes/export');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

// ---------- Xavfsizlik sarlavhalari ----------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  referrerPolicy: { policy: 'no-referrer' }
}));

// ---------- Umumiy so'rov cheklovi (DDoS/brute-force'ga qarshi asosiy himoya) ----------
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
}));

app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));

// ---------- Sessiya (SQLite'da saqlanadi, xavfsiz cookie sozlamalari) ----------
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'db') }),
  name: 'sid',
  secret: process.env.SESSION_SECRET || 'CHANGE_ME_INSECURE_DEFAULT',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd,       // production'da faqat HTTPS orqali yuboriladi
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000 // 8 soat
  }
}));

// ---------- API yo'llari ----------
app.use('/api/auth', authRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/export', exportRoutes);

// ---------- Statik fayllar ----------
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'public/login.html')));
app.get('/', requireAuth, (req, res) => res.redirect('/dashboard.html'));
app.get('/dashboard.html', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public/dashboard.html')));
app.get('/admin.html', requireAuth, requireRole('admin'), (req, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));

// ---------- 404 va xato ushlovchi ----------
app.use((req, res) => res.status(404).json({ error: 'Topilmadi.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server xatosi yuz berdi.' });
});

app.listen(PORT, () => {
  console.log(`Universitet Inventarizatsiya Platformasi http://localhost:${PORT} manzilida ishga tushdi (${isProd ? 'production' : 'development'})`);
});
