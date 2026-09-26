const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/excel', async (req, res) => {
  const { q, room_id, department_id } = req.query;
  let sql = `
    SELECT i.code, i.name, i.quantity, i.item_date, r.number AS room_number,
           d.name AS department_name, i.note, i.created_at
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

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Universitet Inventarizatsiya Platformasi';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Inventarizatsiya');
  sheet.columns = [
    { header: 'RANCH kodi', key: 'code', width: 24 },
    { header: 'Nomi', key: 'name', width: 30 },
    { header: 'Miqdori', key: 'quantity', width: 10 },
    { header: 'Sana', key: 'item_date', width: 14 },
    { header: 'Xona', key: 'room_number', width: 14 },
    { header: "Bo'lim/Kafedra", key: 'department_name', width: 30 },
    { header: 'Izoh', key: 'note', width: 30 },
    { header: "Qo'shilgan sana", key: 'created_at', width: 20 }
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFE8DC' } };
  rows.forEach((r) => sheet.addRow(r));
  sheet.autoFilter = { from: 'A1', to: 'H1' };

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `inventarizatsiya_${new Date().toISOString().slice(0, 10)}.xlsx`;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});

module.exports = router;
