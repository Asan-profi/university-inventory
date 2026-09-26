const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

function logAudit(userId, action, details, ip) {
  db.prepare('INSERT INTO audit_log (user_id, action, details, ip) VALUES (?, ?, ?, ?)')
    .run(userId || null, action, details || null, ip || null);
}

// ---------- Foydalanuvchilar ----------
router.get('/users', (req, res) => {
  const users = db.prepare(
    'SELECT id, username, full_name, role, is_active, created_at FROM users ORDER BY created_at DESC'
  ).all();
  res.json({ users });
});

router.post(
  '/users',
  [
    body('username').trim().isLength({ min: 3, max: 50 }).matches(/^[a-zA-Z0-9._-]+$/)
      .withMessage('Login faqat lotin harflari, raqam va . _ - belgilaridan iborat bo\'lishi kerak'),
    body('password').isLength({ min: 8 }).withMessage('Parol kamida 8 belgidan iborat bo\'lishi kerak'),
    body('full_name').trim().isLength({ min: 1, max: 200 }),
    body('role').isIn(['admin', 'editor', 'viewer'])
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { username, password, full_name, role } = req.body;
    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) return res.status(409).json({ error: 'Bu login band.' });

    const hash = bcrypt.hashSync(password, 12);
    const info = db.prepare(
      'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)'
    ).run(username, hash, full_name, role);

    logAudit(req.session.user.id, 'user_created', username, req.ip);
    res.status(201).json({ id: info.lastInsertRowid });
  }
);

router.put('/users/:id/status', [body('is_active').isBoolean()], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Noto\'g\'ri qiymat.' });
  if (Number(req.params.id) === req.session.user.id) {
    return res.status(400).json({ error: 'O\'z hisobingizni bloklay olmaysiz.' });
  }
  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(req.body.is_active ? 1 : 0, req.params.id);
  logAudit(req.session.user.id, 'user_status_changed', `id=${req.params.id} active=${req.body.is_active}`, req.ip);
  res.json({ ok: true });
});

router.put(
  '/users/:id/reset-password',
  [body('newPassword').isLength({ min: 8 })],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Parol kamida 8 belgidan iborat bo\'lishi kerak.' });
    const hash = bcrypt.hashSync(req.body.newPassword, 12);
    db.prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?')
      .run(hash, req.params.id);
    logAudit(req.session.user.id, 'password_reset_by_admin', `id=${req.params.id}`, req.ip);
    res.json({ ok: true });
  }
);

router.delete('/users/:id', (req, res) => {
  if (Number(req.params.id) === req.session.user.id) {
    return res.status(400).json({ error: 'O\'z hisobingizni o\'chira olmaysiz.' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  logAudit(req.session.user.id, 'user_deleted', `id=${req.params.id}`, req.ip);
  res.json({ ok: true });
});

// ---------- Bo'lim/kafedralar ----------
router.get('/departments', (req, res) => {
  res.json({ departments: db.prepare('SELECT * FROM departments ORDER BY name').all() });
});
router.post('/departments', [body('name').trim().isLength({ min: 1, max: 200 })], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Nomi kiritilishi shart.' });
  try {
    const info = db.prepare('INSERT INTO departments (name) VALUES (?)').run(req.body.name.trim());
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(409).json({ error: 'Bu bo\'lim allaqachon mavjud.' });
  }
});
router.delete('/departments/:id', (req, res) => {
  db.prepare('DELETE FROM departments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Xonalar ----------
router.get('/rooms', (req, res) => {
  const rooms = db.prepare(`
    SELECT r.*, d.name AS department_name FROM rooms r
    LEFT JOIN departments d ON d.id = r.department_id
    ORDER BY r.number`).all();
  res.json({ rooms });
});
router.post(
  '/rooms',
  [body('number').trim().isLength({ min: 1, max: 50 }), body('department_id').optional({ checkFalsy: true }).isInt()],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Xona raqami kiritilishi shart.' });
    try {
      const info = db.prepare('INSERT INTO rooms (number, department_id) VALUES (?, ?)')
        .run(req.body.number.trim(), req.body.department_id || null);
      res.status(201).json({ id: info.lastInsertRowid });
    } catch (e) {
      res.status(409).json({ error: 'Bu xona allaqachon mavjud.' });
    }
  }
);
router.delete('/rooms/:id', (req, res) => {
  db.prepare('DELETE FROM rooms WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Audit jurnal ----------
router.get('/audit-log', (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, u.username FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.created_at DESC LIMIT 300`).all();
  res.json({ log: rows });
});

module.exports = router;
