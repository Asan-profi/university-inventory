// Inventar raqami formati: <KATEGORIYA_KODI>-<6 xonali tartib raqam>
// Masalan: CMP-000001, MON-000002 (tartib raqam bazadagi ichki ID asosida)
function formatInventoryNumber(categoryCode, id) {
  const padded = String(id).padStart(6, '0');
  return `${categoryCode.toUpperCase()}-${padded}`;
}

// Dalolatnoma raqami formati: AKT-<6 xonali tartib raqam>
function formatAktNumber(id) {
  return `AKT-${String(id).padStart(6, '0')}`;
}

module.exports = { formatInventoryNumber, formatAktNumber };
