const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const db = require('../db/database');

const router = express.Router();

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

// Login yo'liga qo'shimcha qattiq cheklov — brute-force hujumlariga qarshi
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Juda ko\'p urinish. Iltimos, keyinroq qayta urining.' }
});

function logAudit(userId, action, details, ip) {
  db.prepare('INSERT INTO audit_log (user_id, action, details, ip) VALUES (?, ?, ?, ?)')
    .run(userId || null, action, details || null, ip || null);
}

router.post(
  '/login',
  loginLimiter,
  [
    body('username').trim().notEmpty().withMessage('Login kiritilishi shart'),
    body('password').notEmpty().withMessage('Parol kiritilishi shart')
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Login va parolni to\'g\'ri kiriting.' });
    }

    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());

    // Har doim bir xil xabar — mavjud/mavjud emas loginlarni farqlamaslik uchun
    const genericError = { error: 'Login yoki parol noto\'g\'ri.' };

    if (!user || !user.is_active) {
      logAudit(null, 'login_failed', `username=${username}`, req.ip);
      return res.status(401).json(genericError);
    }

    if (user.locked_until && Date.now() < user.locked_until) {
      const minutesLeft = Math.ceil((user.locked_until - Date.now()) / 60000);
      return res.status(423).json({ error: `Hisob vaqtincha bloklangan. ${minutesLeft} daqiqadan so'ng urinib ko'ring.` });
    }

    const ok = bcrypt.compareSync(password, user.password_hash);
    if (!ok) {
      const attempts = (user.failed_attempts || 0) + 1;
      let lockedUntil = null;
      if (attempts >= MAX_ATTEMPTS) {
        lockedUntil = Date.now() + LOCK_MINUTES * 60 * 1000;
      }
      db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?')
        .run(attempts, lockedUntil, user.id);
      logAudit(user.id, 'login_failed', null, req.ip);
      return res.status(401).json(genericError);
    }

    // Muvaffaqiyatli kirish — hisoblagichni tozalash
    db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Server xatosi.' });
      req.session.user = {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role
      };
      logAudit(user.id, 'login_success', null, req.ip);
      res.json({ ok: true, user: req.session.user });
    });
  }
);

router.post('/logout', (req, res) => {
  const userId = req.session?.user?.id;
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    logAudit(userId, 'logout', null, req.ip);
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Tizimga kirilmagan.' });
  }
  res.json({ user: req.session.user });
});

router.post(
  '/change-password',
  [
    body('currentPassword').notEmpty(),
    body('newPassword').isLength({ min: 8 }).withMessage('Yangi parol kamida 8 belgidan iborat bo\'lishi kerak')
  ],
  (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Tizimga kirilmagan.' });
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
    if (!bcrypt.compareSync(req.body.currentPassword, user.password_hash)) {
      return res.status(400).json({ error: 'Joriy parol noto\'g\'ri.' });
    }
    const newHash = bcrypt.hashSync(req.body.newPassword, 12);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.id);
    logAudit(user.id, 'password_changed', null, req.ip);
    res.json({ ok: true });
  }
);

module.exports = router;
