let currentUser = null;
let categories = [];
let selectedCategory = null;
let currentModalItemId = null;

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(url, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const res = await fetch(url, {
    headers: isForm ? undefined : { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { window.location.href = '/login.html'; throw new Error('unauthorized'); }
  if (!res.ok) throw new Error(data.error || 'Xatolik yuz berdi.');
  return data;
}

function setStatus(el, text, ok) {
  el.textContent = text;
  el.className = 'status ' + (ok ? 'ok' : 'err');
  setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 3500);
}

async function loadMe() {
  const { user } = await api('/api/auth/me');
  currentUser = user;
  document.getElementById('whoami').textContent = `${user.full_name || user.username} (${user.role})`;
  if (user.role === 'admin') document.getElementById('adminLink').style.display = '';
  if (user.role === 'viewer') document.getElementById('addCard').style.display = 'none';
}

// ---------- Kategoriya klaviaturasi ----------
async function loadCategories() {
  const { categories: cats } = await api('/api/inventory/meta/categories');
  categories = cats;
  const kb = document.getElementById('catKeyboard');
  kb.innerHTML = cats.map(c => `
    <button type="button" class="cat-btn" data-code="${escHtml(c.code)}">
      <span class="code">${escHtml(c.code)}</span>
      <span class="name">${escHtml(c.name)}</span>
    </button>`).join('');
  kb.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedCategory = btn.dataset.code;
      kb.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('catStatus').textContent = '';
    });
  });

  const fCat = document.getElementById('fCat');
  fCat.innerHTML = '<option value="">Barcha kategoriyalar</option>' +
    cats.map(c => `<option value="${escHtml(c.code)}">${escHtml(c.code)} — ${escHtml(c.name)}</option>`).join('');
}

async function loadFilters() {
  const [{ rooms }, { departments }] = await Promise.all([
    api('/api/inventory/meta/rooms'),
    api('/api/inventory/meta/departments')
  ]);
  const dSel = document.getElementById('fDept'), rSel = document.getElementById('fRoom');
  dSel.innerHTML = '<option value="">Barcha bo\'limlar</option>' +
    departments.map(d => `<option value="${d.id}">${escHtml(d.name)}</option>`).join('');
  rSel.innerHTML = '<option value="">Barcha xonalar</option>' +
    rooms.map(r => `<option value="${r.id}">${escHtml(r.number)}</option>`).join('');
}

async function loadItems() {
  const q = document.getElementById('q').value.trim();
  const department_id = document.getElementById('fDept').value;
  const room_id = document.getElementById('fRoom').value;
  const category_code = document.getElementById('fCat').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (department_id) params.set('department_id', department_id);
  if (room_id) params.set('room_id', room_id);
  if (category_code) params.set('category_code', category_code);

  const { items } = await api('/api/inventory?' + params.toString());
  const tbody = document.getElementById('tbody');
  document.getElementById('emptyMsg').style.display = items.length ? 'none' : 'block';
  tbody.innerHTML = items.map(i => `
    <tr>
      <td class="code">${escHtml(i.inventory_number)}</td>
      <td>${escHtml(i.name)}</td>
      <td><span class="pill">${escHtml(i.category_code || '—')}</span></td>
      <td>${escHtml(i.room_number || '—')}</td>
      <td>${escHtml(i.department_name || '—')}</td>
      <td>${escHtml(i.responsible_person || '—')}</td>
      <td>${escHtml(i.status || '—')}</td>
      <td><button class="secondary" data-detail="${i.id}">Batafsil</button></td>
    </tr>`).join('');
}

async function addItem() {
  const statusEl = document.getElementById('addStatus');
  const catStatusEl = document.getElementById('catStatus');
  if (!selectedCategory) {
    catStatusEl.textContent = 'Iltimos, kategoriyani yuqoridan tanlang.';
    return;
  }
  const payload = {
    category_code: selectedCategory,
    name: document.getElementById('f_name').value.trim(),
    brand: document.getElementById('f_brand').value.trim(),
    model: document.getElementById('f_model').value.trim(),
    tech_spec: document.getElementById('f_techspec').value.trim(),
    quantity: Number(document.getElementById('f_qty').value) || 1,
    unit: document.getElementById('f_unit').value,
    item_date: document.getElementById('f_date').value || null,
    price: document.getElementById('f_price').value || null,
    document_number: document.getElementById('f_docnum').value.trim(),
    supplier: document.getElementById('f_supplier').value.trim(),
    branch: document.getElementById('f_branch').value.trim(),
    building: document.getElementById('f_building').value.trim(),
    room_number: document.getElementById('f_room').value.trim(),
    department_name: document.getElementById('f_dept').value.trim(),
    responsible_person: document.getElementById('f_responsible').value.trim(),
    condition_status: document.getElementById('f_condition').value,
    status: document.getElementById('f_status').value,
    note: document.getElementById('f_note').value.trim()
  };
  try {
    const { item } = await api('/api/inventory', { method: 'POST', body: JSON.stringify(payload) });
    setStatus(statusEl, `Qo'shildi. Inventar №: ${item.inventory_number}`, true);
    ['f_name', 'f_brand', 'f_model', 'f_techspec', 'f_date', 'f_price', 'f_docnum', 'f_supplier',
      'f_branch', 'f_building', 'f_room', 'f_dept', 'f_responsible', 'f_note'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('f_qty').value = 1;
    document.getElementById('f_condition').value = '';
    document.getElementById('f_status').value = 'Foydalanishda';
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('selected'));
    selectedCategory = null;
    await loadFilters();
    await loadItems();
  } catch (e) {
    setStatus(statusEl, e.message, false);
  }
}

// ---------- Batafsil modal ----------
function fmtMoney(v) { return v ? Number(v).toLocaleString('uz-UZ') + " so'm" : '—'; }

async function openDetail(id) {
  currentModalItemId = id;
  const { item: i } = await api('/api/inventory/' + id);
  document.getElementById('modalTitle').textContent = `${i.inventory_number} — ${i.name}`;
  const rows = [
    ['ID (tizim)', i.id], ['Inventar №', i.inventory_number],
    ['Kategoriya', `${i.category_code || ''} — ${i.category_name || ''}`],
    ['Jihoz nomi', i.name], ['Brend', i.brand || '—'], ['Model', i.model || '—'],
    ['Texnik tavsifi', i.tech_spec || '—'], ['Miqdor', `${i.quantity} ${i.unit || 'dona'}`],
    ['Qiymati', fmtMoney(i.price)], ['Kelgan sana', i.item_date || '—'],
    ['Hujjat №', i.document_number || '—'], ['Yetkazib beruvchi', i.supplier || '—'],
    ['Filial', i.branch || '—'], ['Bino', i.building || '—'],
    ['Xona', i.room_number || '—'], ["Bo'lim/Kafedra", i.department_name || '—'],
    ["Mas'ul shaxs", i.responsible_person || '—'], ['Holati', i.condition_status || '—'],
    ['Status', i.status || '—'], ['Izoh', i.note || '—']
  ];
  document.getElementById('modalBody').innerHTML = `
    <div class="detail-grid">
      ${rows.map(([label, val]) => `<div><div class="dt">${escHtml(label)}</div><p class="dd">${escHtml(val)}</p></div>`).join('')}
    </div>
    <div class="modal-actions">
      <button id="btnAkt">📄 Dalolatnoma (Word) yaratish/yuklab olish</button>
      ${i.akt_scan_path ? `<button class="secondary" id="btnViewScan">🖼️ Yuklangan skanerni ko'rish</button>` : ''}
      ${currentUser.role !== 'viewer' ? `
        <label class="secondary" style="display:inline-flex;align-items:center;gap:6px;padding:9px 16px;border:1px solid var(--accent);border-radius:6px;cursor:pointer;">
          📎 Imzolangan dalolatnomani skanerlab yuklash
          <input type="file" id="scanFile" accept=".pdf,.jpg,.jpeg,.png" style="display:none;">
        </label>` : ''}
    </div>
    <div class="status" id="modalStatus"></div>
  `;
  document.getElementById('btnAkt').addEventListener('click', () => {
    window.location.href = `/api/inventory/${i.id}/akt.docx`;
  });
  const viewScanBtn = document.getElementById('btnViewScan');
  if (viewScanBtn) viewScanBtn.addEventListener('click', () => window.open(`/api/inventory/${i.id}/akt-scan`, '_blank'));
  const scanInput = document.getElementById('scanFile');
  if (scanInput) scanInput.addEventListener('change', async () => {
    if (!scanInput.files[0]) return;
    const fd = new FormData();
    fd.append('scan', scanInput.files[0]);
    const modalStatus = document.getElementById('modalStatus');
    try {
      await api(`/api/inventory/${i.id}/akt-scan`, { method: 'POST', body: fd });
      setStatus(modalStatus, 'Skanerlangan hujjat muvaffaqiyatli yuklandi.', true);
      openDetail(i.id);
    } catch (e) { setStatus(modalStatus, e.message, false); }
  });
  document.getElementById('modalOverlay').style.display = 'flex';
}

document.getElementById('modalClose').addEventListener('click', () => {
  document.getElementById('modalOverlay').style.display = 'none';
});
document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'modalOverlay') document.getElementById('modalOverlay').style.display = 'none';
});

document.getElementById('btnAdd').addEventListener('click', addItem);
document.getElementById('btnRefresh').addEventListener('click', loadItems);
document.getElementById('q').addEventListener('input', () => loadItems());
document.getElementById('fDept').addEventListener('change', loadItems);
document.getElementById('fRoom').addEventListener('change', loadItems);
document.getElementById('fCat').addEventListener('change', loadItems);
document.getElementById('tbody').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-detail]');
  if (btn) openDetail(btn.dataset.detail);
});
document.getElementById('btnExport').addEventListener('click', () => {
  const q = document.getElementById('q').value.trim();
  const department_id = document.getElementById('fDept').value;
  const room_id = document.getElementById('fRoom').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (department_id) params.set('department_id', department_id);
  if (room_id) params.set('room_id', room_id);
  window.location.href = '/api/export/excel?' + params.toString();
});
document.getElementById('btnLogout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});
document.getElementById('btnChangePw').addEventListener('click', async () => {
  const currentPassword = prompt("Joriy parolingizni kiriting:");
  if (!currentPassword) return;
  const newPassword = prompt("Yangi parol (kamida 8 belgi):");
  if (!newPassword) return;
  try {
    await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
    alert("Parol muvaffaqiyatli o'zgartirildi.");
  } catch (e) { alert(e.message); }
});

(async function init() {
  try {
    await loadMe();
    await loadCategories();
    await loadFilters();
    await loadItems();
  } catch (e) { /* redirect already handled */ }
})();
