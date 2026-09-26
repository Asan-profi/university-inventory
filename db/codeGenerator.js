const db = require('./database');

const UNI_CODE = (process.env.UNIVERSITY_CODE || 'ITU').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Format: <UNIVERSITET_KODI>-RANCH-<XONA_RAQAMI>-<RANDOM 4 xonali>
// Masalan: ITU-RANCH-214-7391
function generateCode(roomNumber) {
  const room = String(roomNumber || '000').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const check = db.prepare('SELECT 1 FROM inventory_items WHERE code = ?');

  for (let attempt = 0; attempt < 50; attempt++) {
    const random = Math.floor(1000 + Math.random() * 9000); // 4 xonali random
    const code = `${UNI_CODE}-RANCH-${room}-${random}`;
    if (!check.get(code)) return code;
  }
  // g'oyat kam ehtimol bo'lgan holat uchun zaxira: timestamp qo'shamiz
  return `${UNI_CODE}-RANCH-${room}-${Date.now().toString().slice(-6)}`;
}

module.exports = { generateCode };
