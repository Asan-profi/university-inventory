const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { generateCode } = require('../db/codeGenerator');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function logAudit(userId, action, details, ip) {
  db.prepare('INSERT INTO audit_log (user_id, action, details, ip) VALUES (?, ?, ?, ?)')
    .run(userId || null, action, details || null, ip || null);
}

// ---------- Ro'yxat (qidiruv/filtr bilan) ----------
router.get('/', (req, res) => {
  const { q, room_id, department_id } = req.query;
  let sql = `
    SELECT i.*, r.number AS room_number, d.name AS department_name
    FROM inventory_items i
    LEFT JOIN rooms r ON r.id = i.room_id
    LEFT JOIN departments d ON d.id = i.department_id
    WHERE 1=1`;
  const params = [];

  if (q) {
    sql += ` AND (i.name LIKE ? OR i.code LIKE ? OR r.number LIKE ? OR d.name LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (room_id) { sql += ` AND i.room_id = ?`; params.push(room_id); }
  if (department_id) { sql += ` AND i.department_id = ?`; params.push(department_id); }

  sql += ` ORDER BY i.created_at DESC`;
  const rows = db.prepare(sql).all(...params);
  res.json({ items: rows });
});

// ---------- Xonalar va bo'limlar ro'yxati (forma uchun) ----------
router.get('/meta/rooms', (req, res) => {
  res.json({ rooms: db.prepare('SELECT * FROM rooms ORDER BY number').all() });
});
router.get('/meta/departments', (req, res) => {
  res.json({ departments: db.prepare('SELECT * FROM departments ORDER BY name').all() });
});

// ---------- Yangi buyum qo'shish (editor va admin) ----------
router.post(
  '/',
  requireRole('admin', 'editor'),
  [
    body('name').trim().isLength({ min: 1, max: 200 }).withMessage('Nomi kiritilishi shart'),
    body('room_number').trim().isLength({ min: 1, max: 50 }).withMessage('Xona raqami kiritilishi shart'),
    body('department_name').trim().isLength({ min: 1, max: 200 }).withMessage('Bo\'lim/kafedra kiritilishi shart'),
    body('quantity').optional().isInt({ min: 1 }).toInt(),
    body('item_date').optional({ checkFalsy: true }).isISO8601(),
    body('note').optional({ checkFalsy: true }).isLength({ max: 1000 })
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { name, room_number, department_name, quantity, item_date, note } = req.body;

    // Xona va bo'limni topish yoki avtomatik yaratish
    let room = db.prepare('SELECT * FROM rooms WHERE number = ?').get(room_number.trim());
    let department = db.prepare('SELECT * FROM departments WHERE name = ?').get(department_name.trim());
    if (!department) {
      const info = db.prepare('INSERT INTO departments (name) VALUES (?)').run(department_name.trim());
      department = { id: info.lastInsertRowid, name: department_name.trim() };
    }
    if (!room) {
      const info = db.prepare('INSERT INTO rooms (number, department_id) VALUES (?, ?)').run(room_number.trim(), department.id);
      room = { id: info.lastInsertRowid, number: room_number.trim(), department_id: department.id };
    }

    const code = generateCode(room_number);

    const result = db.prepare(`
      INSERT INTO inventory_items (code, name, quantity, item_date, room_id, department_id, note, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(code, name.trim(), quantity || 1, item_date || null, room.id, department.id, note || null, req.session.user.id);

    logAudit(req.session.user.id, 'item_created', code, req.ip);
    const item = db.prepare(`
      SELECT i.*, r.number AS room_number, d.name AS department_name
      FROM inventory_items i
      LEFT JOIN rooms r ON r.id = i.room_id
      LEFT JOIN departments d ON d.id = i.department_id
      WHERE i.id = ?`).get(result.lastInsertRowid);

    res.status(201).json({ item });
  }
);

// ---------- Buyumni yangilash ----------
router.put(
  '/:id',
  requireRole('admin', 'editor'),
  [
    body('name').optional().trim().isLength({ min: 1, max: 200 }),
    body('quantity').optional().isInt({ min: 1 }).toInt(),
    body('note').optional({ checkFalsy: true }).isLength({ max: 1000 })
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const existing = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Topilmadi.' });

    const name = req.body.name ?? existing.name;
    const quantity = req.body.quantity ?? existing.quantity;
    const note = req.body.note ?? existing.note;

    db.prepare(`UPDATE inventory_items SET name = ?, quantity = ?, note = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(name, quantity, note, req.params.id);

    logAudit(req.session.user.id, 'item_updated', existing.code, req.ip);
    res.json({ ok: true });
  }
);

// ---------- Buyumni o'chirish (faqat admin) ----------
router.delete('/:id', requireRole('admin'), (req, res) => {
  const existing = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Topilmadi.' });
  db.prepare('DELETE FROM inventory_items WHERE id = ?').run(req.params.id);
  logAudit(req.session.user.id, 'item_deleted', existing.code, req.ip);
  res.json({ ok: true });
});

module.exports = router;
