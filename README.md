# Universitet Inventarizatsiya Platformasi

Login/parol bilan himoyalangan, ma'lumotlar bazasiga ulangan, admin panelli inventarizatsiya veb-sayti.
Har bir buyumga avtomatik **RANCH kod** beriladi: `UNIVERSITET_KODI-RANCH-XONA-RANDOM`
(masalan: `ITU-RANCH-214-7391`).

## Texnologiyalar
- **Node.js + Express** — server
- **SQLite** (better-sqlite3) — ma'lumotlar bazasi, alohida server talab qilmaydi, bitta fayl (`db/inventory.db`)
- **bcrypt** — parollarni xesh qilish
- **express-session** (SQLite'da saqlanadi) — sessiya boshqaruvi
- **helmet, express-rate-limit** — xavfsizlik sarlavhalari va brute-force himoyasi
- **exceljs** — Excel (.xlsx) eksport

## O'rnatish (server/hostingda)

1. Node.js 18+ o'rnatilgan bo'lishi kerak.
2. Loyihani hostingga yuklang, so'ng:
   ```bash
   cd university-inventory
   npm install
   cp .env.example .env
   ```
3. `.env` faylini oching va quyidagilarni albatta o'zgartiring:
   - `SESSION_SECRET` — uzun, tasodifiy qator (masalan: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` buyrug'i bilan yarating)
   - `ADMIN_USERNAME` va `ADMIN_PASSWORD` — bosh administrator uchun kuchli login/parol
   - `UNIVERSITY_CODE` — RANCH kodlarida ishlatiladigan universitet qisqartmasi (masalan `ITU`)
   - `NODE_ENV=production` — HTTPS ostida ishlaganda cookie xavfsizligini yoqadi
4. Serverni ishga tushiring:
   ```bash
   npm start
   ```
   Birinchi ishga tushirishda `db/inventory.db` fayli avtomatik yaratiladi va `.env`dagi login/parol bilan bosh administrator hisobi urug'lanadi.

### Doimiy ishlash uchun (tavsiya)
Serverni doimiy ishlatish uchun `pm2` kabi process manager ishlating:
```bash
npm install -g pm2
pm2 start server.js --name inventory
pm2 save
```

### HTTPS va domen
Ilova o'zi HTTPS sertifikatini boshqarmaydi — buni **Nginx** yoki **Caddy** kabi reverse proxy orqali sozlash tavsiya etiladi:
- Nginx + Let's Encrypt (certbot) orqali domenga SSL sertifikat o'rnating.
- Nginx'ni `localhost:3000` portiga proxy qilib sozlang.
- `.env` faylida `TRUST_PROXY=1` qoldiring (proxy orqasida ishlashi uchun) va `NODE_ENV=production` bo'lsin — shunda sessiya cookie'lari faqat HTTPS orqali yuboriladi.

## Xavfsizlik choralari (kiber hujumlarga qarshi)

- **Parollar** bcrypt bilan xeshlanadi (oddiy matnda saqlanmaydi).
- **Login urinishlari cheklangan**: 15 daqiqada 20 urinishdan ko'p bo'lsa IP bloklanadi; bitta hisobga 5 marta noto'g'ri parol kiritilsa, hisob 15 daqiqaga bloklanadi.
- **Umumiy so'rov cheklovi** (rate limit) butun saytga qo'llanilgan — avtomatlashtirilgan hujumlarni sekinlashtiradi.
- **SQL in'ektsiyasi**: barcha so'rovlar parametrlangan (`better-sqlite3` prepared statements), foydalanuvchi kiritgan matn to'g'ridan-to'g'ri SQL ichiga qo'shilmaydi.
- **XSS himoyasi**: barcha foydalanuvchi matni chiqarishdan oldin HTML-escape qilinadi; `helmet` orqali qat'iy Content-Security-Policy o'rnatilgan (faqat o'z domenidan skript ishga tushadi, inline skriptlar bloklangan).
- **CSRF/cookie himoyasi**: sessiya cookie'lari `httpOnly`, `sameSite=strict` va production'da `secure` (faqat HTTPS) sifatida sozlangan.
- **Rol asosidagi ruxsatlar**: `admin` (to'liq huquq), `editor` (qo'shish/tahrirlash), `viewer` (faqat ko'rish) — har bir API yo'li mos rolni tekshiradi.
- **Audit jurnali**: kirish, chiqish, qo'shish/o'chirish, parol o'zgartirish kabi barcha muhim amallar `audit_log` jadvalida saqlanadi va admin panelda ko'rinadi.
- **Kiritilgan ma'lumotlar** `express-validator` orqali server tomonida tekshiriladi (uzunlik, format, majburiy maydonlar).

### Qo'shimcha tavsiyalar (server darajasida)
- Hostingda **firewall** yoqing va faqat 80/443 (va SSH) portlarini oching, 3000-portni tashqi dunyoga ochmang — faqat Nginx orqali ulaning.
- Muntazam **zaxira nusxa** oling: `db/inventory.db` va `db/sessions.db` fayllarini davriy ravishda boshqa joyga ko'chiring.
- `npm audit` orqali vaqti-vaqti bilan kutubxonalarni yangilab turing.
- Standart admin parolini birinchi kirishdan so'ng albatta o'zgartiring (dashboard'dagi "Parolni o'zgartirish" tugmasi orqali).

## Foydalanish

- `/login.html` — kirish sahifasi
- `/dashboard.html` — inventar ro'yxati, qo'shish, qidirish/filtrlash, Excel eksport
- `/admin.html` — faqat `admin` roli uchun: foydalanuvchilar, bo'lim/kafedralar, xonalar, audit jurnali

### RANCH kod formati
```
<UNIVERSITET_KODI>-RANCH-<XONA_RAQAMI>-<4 xonali random raqam>
```
Masalan, `UNIVERSITY_CODE=ITU` va xona `214` bo'lsa: **`ITU-RANCH-214-7391`**
Kod har doim bazada noyob bo'lishi tekshiriladi, takrorlanish bo'lsa avtomatik qayta generatsiya qilinadi.

## Loyihaviy tuzilma
```
university-inventory/
├── server.js              # asosiy server va xavfsizlik sozlamalari
├── db/
│   ├── database.js        # sxema va admin urug'lash
│   └── codeGenerator.js   # RANCH kod generatori
├── middleware/auth.js     # sessiya va rol tekshiruvi
├── routes/
│   ├── auth.js            # kirish/chiqish/parol
│   ├── inventory.js       # inventar CRUD
│   ├── admin.js           # foydalanuvchi/bo'lim/xona boshqaruvi
│   └── export.js          # Excel eksport
└── public/                # login, dashboard, admin sahifalari (HTML/CSS/JS)
```
