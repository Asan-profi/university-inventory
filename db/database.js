const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'inventory.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------- Asosiy sxema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')) DEFAULT 'viewer',
  is_active INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE NOT NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS categories (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  example TEXT
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  item_date TEXT,
  room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS person_akts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  responsible_person TEXT UNIQUE NOT NULL,
  akt_number TEXT UNIQUE,
  generated_at TEXT,
  scan_path TEXT,
  scan_original_name TEXT,
  scan_uploaded_at TEXT 
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  details TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---------- Eski bazalarni yangi maydonlar bilan to'ldirish (migratsiya) ----------
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

const newColumns = [
  ['inventory_number', 'TEXT'],
  ['category_code', 'TEXT'],
  ['brand', 'TEXT'],
  ['model', 'TEXT'],
  ['tech_spec', 'TEXT'],
  ['unit', "TEXT DEFAULT 'dona'"],
  ['document_number', 'TEXT'],
  ['supplier', 'TEXT'],
  ['price', 'REAL'],
  ['branch', 'TEXT'],
  ['building', 'TEXT'],
  ['responsible_person', 'TEXT'],
  ['condition_status', 'TEXT'],
  ['status', "TEXT DEFAULT 'Foydalanishda'"],
  ['akt_number', 'TEXT'],
  ['akt_generated_at', 'TEXT'],
  ['akt_scan_path', 'TEXT'],
  ['akt_scan_original_name', 'TEXT'],
  ['akt_scan_uploaded_at', 'TEXT']
];
newColumns.forEach(([col, def]) => ensureColumn('inventory_items', col, def));

// Eski yozuvlar uchun inventory_number bo'sh bo'lsa, code'dan nusxalab qo'yamiz
db.exec(`UPDATE inventory_items SET inventory_number = code WHERE inventory_number IS NULL`);

// ---------- Standart kategoriyalarni urug'lash ----------
const defaultCategories = [
  ['PC', 'Sistemali blok', 'Dell OptiPlex'],
  ['MON', 'Monitor', 'Samsung 24"'],
  ['LTP', 'Noutbuk', 'Lenovo ThinkBook'],
  ['MFP', 'MFP', 'HP LaserJet MFP'],
  ['PRN', 'Printer', 'Canon LBP'],
  ['PRJ', 'Proyektor', 'Epson'],
  ['TV', 'Televizor / panel', 'Artel 65"'],
  ['UPS', 'UPS', 'APC'],
  ['NET', 'Tarmoq uskunalari', 'Switch, router'],
  ['CAM', 'Kamera', 'IP kamera'],
  ['AC', 'Konditsioner', 'Artel'],
  ['DSK', 'Stol', "O'qituvchi stoli"],
  ['CHR', 'Stul', 'Ofis stuli'],
  ['CAB', 'Shkaf', 'Hujjatlar shkafi'],
  ['BRD', 'Doska', 'Markerli doska'],
  ['OTH', 'Boshqa', 'Boshqa aktiv']
];
const insertCat = db.prepare('INSERT OR IGNORE INTO categories (code, name, example) VALUES (?, ?, ?)');
defaultCategories.forEach(([code, name, example]) => insertCat.run(code, name, example));

// ---------- Yuklanadigan fayllar uchun papka ----------
const uploadsDir = path.join(__dirname, '..', 'uploads', 'akt-scans');
fs.mkdirSync(uploadsDir, { recursive: true });

// ---------- Bosh administratorni urug'lash ----------
function seedAdmin() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return;

  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  const hash = bcrypt.hashSync(password, 12);
  db.prepare(
    `INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, 'admin')`
  ).run(username, hash, process.env.ADMIN_FULLNAME || 'Administrator');

  console.log(`[seed] Bosh administrator yaratildi: username="${username}". Iltimos, birinchi kirishdan so'ng parolni o'zgartiring.`);
}
seedAdmin();

module.exports = db;
