const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, AlignmentType, HeadingLevel } = require('docx');
const db = require('../db/database');
const { formatInventoryNumber, formatAktNumber } = require('../db/codeGenerator');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const uploadsDir = path.join(__dirname, '..', 'uploads', 'akt-scans');
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `item${req.params.id}_${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) return cb(new Error('Faqat PDF, JPG yoki PNG fayl yuklash mumkin.'));
    cb(null, true);
  }
});

function logAudit(userId, action, details, ip) {
  db.prepare('INSERT INTO audit_log (user_id, action, details, ip) VALUES (?, ?, ?, ?)')
    .run(userId || null, action, details || null, ip || null);
}

const ITEM_SELECT = `
  SELECT i.*, r.number AS room_number, d.name AS department_name,
         c.name AS category_name,
         pa.akt_number AS person_akt_number,
         pa.scan_path AS person_scan_path,
         pa.scan_uploaded_at AS person_scan_uploaded_at
  FROM inventory_items i
  LEFT JOIN rooms r ON r.id = i.room_id
  LEFT JOIN departments d ON d.id = i.department_id
  LEFT JOIN categories c ON c.code = i.category_code
  LEFT JOIN person_akts pa ON pa.responsible_person = i.responsible_person
`;

// Mas'ul shaxs bo'yicha dalolatnoma yozuvini topish yoki yaratish
function getOrCreatePersonAkt(personName) {
  let row = db.prepare('SELECT * FROM person_akts WHERE responsible_person = ?').get(personName);
  if (!row) {
    const info = db.prepare('INSERT INTO person_akts (responsible_person) VALUES (?)').run(personName);
    row = db.prepare('SELECT * FROM person_akts WHERE id = ?').get(info.lastInsertRowid);
  }
  return row;
}

// ---------- Ro'yxat (qidiruv/filtr bilan) ----------
router.get('/', (req, res) => {
  const { q, room_id, department_id, category_code, status } = req.query;
  let sql = ITEM_SELECT + ` WHERE 1=1`;
  const params = [];

  if (q) {
    sql += ` AND (i.name LIKE ? OR i.inventory_number LIKE ? OR i.brand LIKE ? OR i.model LIKE ? OR r.number LIKE ? OR d.name LIKE ? OR i.responsible_person LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like, like);
  }
  if (room_id) { sql += ` AND i.room_id = ?`; params.push(room_id); }
  if (department_id) { sql += ` AND i.department_id = ?`; params.push(department_id); }
  if (category_code) { sql += ` AND i.category_code = ?`; params.push(category_code); }
  if (status) { sql += ` AND i.status = ?`; params.push(status); }

  sql += ` ORDER BY i.created_at DESC`;
  const rows = db.prepare(sql).all(...params);
  res.json({ items: rows });
});

router.get('/:id', (req, res) => {
  const item = db.prepare(ITEM_SELECT + ` WHERE i.id = ?`).get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Topilmadi.' });
  res.json({ item });
});

// ---------- Meta ma'lumotlar (forma uchun) ----------
router.get('/meta/rooms', (req, res) => {
  res.json({ rooms: db.prepare('SELECT * FROM rooms ORDER BY number').all() });
});
router.get('/meta/departments', (req, res) => {
  res.json({ departments: db.prepare('SELECT * FROM departments ORDER BY name').all() });
});
router.get('/meta/categories', (req, res) => {
  res.json({ categories: db.prepare('SELECT * FROM categories ORDER BY name').all() });
});

const STATUS_VALUES = ['Foydalanishda', 'Omborda', "Ta'mirda", 'Hisobdan chiqarilgan'];
const CONDITION_VALUES = ['Yangi', 'Yaxshi', 'Qoniqarli', 'Eskirgan', 'Nosoz'];

// ---------- Yangi buyum qo'shish ----------
router.post(
  '/',
  requireRole('admin', 'editor'),
  [
    body('name').trim().isLength({ min: 1, max: 200 }).withMessage('Jihoz nomi kiritilishi shart'),
    body('category_code').trim().isLength({ min: 1, max: 10 }).withMessage("Kategoriya tanlanishi shart"),
    body('room_number').trim().isLength({ min: 1, max: 50 }).withMessage('Xona raqami kiritilishi shart'),
    body('department_name').trim().isLength({ min: 1, max: 200 }).withMessage('Bo\'lim/kafedra kiritilishi shart'),
    body('quantity').optional().isInt({ min: 1 }).toInt(),
    body('item_date').optional({ checkFalsy: true }).isISO8601(),
    body('price').optional({ checkFalsy: true }).isFloat({ min: 0 }).toFloat(),
    body('status').optional({ checkFalsy: true }).isIn(STATUS_VALUES),
    body('condition_status').optional({ checkFalsy: true }).isIn(CONDITION_VALUES),
    body('note').optional({ checkFalsy: true }).isLength({ max: 1000 })
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const b = req.body;
    const categoryCode = b.category_code.trim().toUpperCase();
    const category = db.prepare('SELECT * FROM categories WHERE code = ?').get(categoryCode);
    if (!category) return res.status(400).json({ error: "Noma'lum kategoriya kodi." });

    // Xona va bo'limni topish yoki avtomatik yaratish
    let department = db.prepare('SELECT * FROM departments WHERE name = ?').get(b.department_name.trim());
    if (!department) {
      const info = db.prepare('INSERT INTO departments (name) VALUES (?)').run(b.department_name.trim());
      department = { id: info.lastInsertRowid, name: b.department_name.trim() };
    }
    let room = db.prepare('SELECT * FROM rooms WHERE number = ?').get(b.room_number.trim());
    if (!room) {
      const info = db.prepare('INSERT INTO rooms (number, department_id) VALUES (?, ?)').run(b.room_number.trim(), department.id);
      room = { id: info.lastInsertRowid, number: b.room_number.trim(), department_id: department.id };
    }

    const tempCode = `TMP-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const insert = db.prepare(`
      INSERT INTO inventory_items (
        code, name, quantity, item_date, room_id, department_id, note, created_by,
        category_code, brand, model, tech_spec, unit, document_number, supplier, price,
        branch, building, responsible_person, condition_status, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = insert.run(
      tempCode, b.name.trim(), b.quantity || 1, b.item_date || null, room.id, department.id, b.note || null,
      req.session.user.id,
      categoryCode, b.brand || null, b.model || null, b.tech_spec || null, b.unit || 'dona',
      b.document_number || null, b.supplier || null, b.price || null,
      b.branch || null, b.building || null, b.responsible_person || null,
      b.condition_status || null, b.status || 'Foydalanishda'
    );

    const id = result.lastInsertRowid;
    const inventoryNumber = formatInventoryNumber(categoryCode, id);
    db.prepare(`UPDATE inventory_items SET code = ?, inventory_number = ? WHERE id = ?`)
      .run(inventoryNumber, inventoryNumber, id);

    logAudit(req.session.user.id, 'item_created', inventoryNumber, req.ip);
    const item = db.prepare(ITEM_SELECT + ` WHERE i.id = ?`).get(id);
    res.status(201).json({ item });
  }
);

// ---------- Buyumni yangilash ----------
const UPDATABLE_FIELDS = [
  'name', 'quantity', 'item_date', 'note', 'brand', 'model', 'tech_spec', 'unit',
  'document_number', 'supplier', 'price', 'branch', 'building', 'responsible_person',
  'condition_status', 'status'
];

router.put(
  '/:id',
  requireRole('admin', 'editor'),
  [
    body('name').optional().trim().isLength({ min: 1, max: 200 }),
    body('quantity').optional().isInt({ min: 1 }).toInt(),
    body('price').optional({ checkFalsy: true }).isFloat({ min: 0 }).toFloat(),
    body('status').optional({ checkFalsy: true }).isIn(STATUS_VALUES),
    body('condition_status').optional({ checkFalsy: true }).isIn(CONDITION_VALUES),
    body('note').optional({ checkFalsy: true }).isLength({ max: 1000 })
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const existing = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Topilmadi.' });

    const updates = {};
    UPDATABLE_FIELDS.forEach((f) => {
      if (req.body[f] !== undefined) updates[f] = req.body[f] === '' ? null : req.body[f];
    });

    const setClause = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
    if (setClause) {
      db.prepare(`UPDATE inventory_items SET ${setClause}, updated_at = datetime('now') WHERE id = ?`)
        .run(...Object.values(updates), req.params.id);
    }

    logAudit(req.session.user.id, 'item_updated', existing.inventory_number, req.ip);
    const item = db.prepare(ITEM_SELECT + ` WHERE i.id = ?`).get(req.params.id);
    res.json({ item });
  }
);

// ---------- Buyumni o'chirish (faqat admin) ----------
router.delete('/:id', requireRole('admin'), (req, res) => {
  const existing = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Topilmadi.' });
  db.prepare('DELETE FROM inventory_items WHERE id = ?').run(req.params.id);

  // Agar bu mas'ul shaxsning so'nggi jihozi bo'lsa, umumiy dalolatnoma/skan yozuvini ham tozalaymiz
  if (existing.responsible_person) {
    const remaining = db.prepare('SELECT COUNT(*) AS c FROM inventory_items WHERE responsible_person = ?').get(existing.responsible_person);
    if (remaining.c === 0) {
      const personAkt = db.prepare('SELECT * FROM person_akts WHERE responsible_person = ?').get(existing.responsible_person);
      if (personAkt) {
        if (personAkt.scan_path) {
          const full = path.join(uploadsDir, path.basename(personAkt.scan_path));
          fs.existsSync(full) && fs.unlinkSync(full);
        }
        db.prepare('DELETE FROM person_akts WHERE id = ?').run(personAkt.id);
      }
    }
  }

  logAudit(req.session.user.id, 'item_deleted', existing.inventory_number, req.ip);
  res.json({ ok: true });
});

// ---------- Dalolatnoma (Word) generatsiya qilish — mas'ul shaxsning BARCHA jihozlari bitta faylda ----------
router.get('/:id/akt.docx', async (req, res) => {
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Topilmadi.' });
  if (!item.responsible_person) {
    return res.status(400).json({ error: "Dalolatnoma yaratish uchun avval Mas'ul shaxs kiritilishi kerak." });
  }

  const personAkt = getOrCreatePersonAkt(item.responsible_person);
  let aktNumber = personAkt.akt_number;
  if (!aktNumber) {
    aktNumber = formatAktNumber(personAkt.id);
    db.prepare(`UPDATE person_akts SET akt_number = ?, generated_at = datetime('now') WHERE id = ?`)
      .run(aktNumber, personAkt.id);
    logAudit(req.session.user.id, 'akt_generated', `${aktNumber} (${item.responsible_person})`, req.ip);
  }

  // Shu mas'ul shaxsga tegishli BARCHA jihozlarni yig'amiz
  const items = db.prepare(ITEM_SELECT + ` WHERE i.responsible_person = ? ORDER BY i.created_at`).all(item.responsible_person);

  const today = new Date().toLocaleDateString('uz-UZ');
  const headerCell = (text) => new TableCell({
    shading: { fill: 'EFE8DC' },
    children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })]
  });
  const cell = (text) => new TableCell({ children: [new Paragraph(String(text ?? '—'))] });

  const headerRow = new TableRow({
    children: ['№', 'Inventar №', 'Nomi', 'Brend/Model', 'Miqdor', 'Xona', "Bo'lim", 'Qiymati', 'Holati'].map(headerCell)
  });
  const itemRows = items.map((it, idx) => new TableRow({
    children: [
      cell(idx + 1),
      cell(it.inventory_number),
      cell(it.name),
      cell([it.brand, it.model].filter(Boolean).join(' / ') || '—'),
      cell(`${it.quantity} ${it.unit || 'dona'}`),
      cell(it.room_number),
      cell(it.department_name),
      cell(it.price ? Number(it.price).toLocaleString('uz-UZ') : '—'),
      cell(it.condition_status)
    ]
  }));

  const totalValue = items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 1), 0);

  const doc = new Document({
    sections: [{
      properties: { page: { size: { orientation: 'landscape' } } },
      children: [
        new Paragraph({ text: 'MODDIY-TEXNIKA VOSITALARINI QABUL QILISH-TOPSHIRISH DALOLATNOMASI', heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER }),
        new Paragraph({ text: `№ ${aktNumber}                                                                    Sana: ${today}`, alignment: AlignmentType.CENTER }),
        new Paragraph({ text: '' }),
        new Paragraph(`Ushbu dalolatnoma asosida quyida ko'rsatilgan mas'ul shaxsga jami ${items.length} ta moddiy-texnika vositasi (jihoz) topshirildi:`),
        new Paragraph({ children: [new TextRun({ text: `Mas'ul shaxs: ${item.responsible_person}`, bold: true })] }),
        new Paragraph({ text: '' }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [headerRow, ...itemRows]
        }),
        new Paragraph({ text: '' }),
        new Paragraph({ children: [new TextRun({ text: `Jami qiymati: ${totalValue.toLocaleString('uz-UZ')} so'm`, bold: true })] }),
        new Paragraph({ text: '' }),
        new Paragraph({ text: '' }),
        new Paragraph(`Topshirdi: _________________________  (F.I.Sh, imzo)          Sana: _______________`),
        new Paragraph({ text: '' }),
        new Paragraph(`Qabul qildi (mas'ul shaxs): ${item.responsible_person}`),
        new Paragraph(`Imzo: _________________________          Sana: _______________`)
      ]
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  const safeName = item.responsible_person.replace(/[^\p{L}\p{N}]+/gu, '_');
  const filename = `dalolatnoma_${safeName}_${aktNumber}.docx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});

// ---------- Skanerlangan dalolatnomani yuklash (mas'ul shaxsning umumiy hujjati sifatida) ----------
router.post('/:id/akt-scan', requireRole('admin', 'editor'), (req, res) => {
  upload.single('scan')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Fayl yuklashda xatolik.' });
    const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Topilmadi.' });
    if (!item.responsible_person) return res.status(400).json({ error: "Avval Mas'ul shaxs kiritilishi kerak." });
    if (!req.file) return res.status(400).json({ error: 'Fayl tanlanmagan.' });

    const personAkt = getOrCreatePersonAkt(item.responsible_person);

    // Eski faylni o'chirish
    if (personAkt.scan_path) {
      const oldFull = path.join(uploadsDir, path.basename(personAkt.scan_path));
      fs.existsSync(oldFull) && fs.unlinkSync(oldFull);
    }

    db.prepare(`
      UPDATE person_akts
      SET scan_path = ?, scan_original_name = ?, scan_uploaded_at = datetime('now')
      WHERE id = ?
    `).run(req.file.filename, req.file.originalname, personAkt.id);

    logAudit(req.session.user.id, 'akt_scan_uploaded', item.responsible_person, req.ip);
    res.json({ ok: true });
  });
});

// ---------- Skanerlangan dalolatnomani ko'rish/yuklab olish ----------
router.get('/:id/akt-scan', (req, res) => {
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id);
  if (!item || !item.responsible_person) return res.status(404).json({ error: 'Skanerlangan fayl topilmadi.' });
  const personAkt = db.prepare('SELECT * FROM person_akts WHERE responsible_person = ?').get(item.responsible_person);
  if (!personAkt || !personAkt.scan_path) return res.status(404).json({ error: 'Skanerlangan fayl topilmadi.' });
  const full = path.join(uploadsDir, path.basename(personAkt.scan_path));
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Fayl serverda topilmadi.' });
  res.sendFile(full);
});

module.exports = router;
