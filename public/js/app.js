let currentUser = null;

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
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
  setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 3000);
}

async function loadMe() {
  const { user } = await api('/api/auth/me');
  currentUser = user;
  document.getElementById('whoami').textContent = `${user.full_name || user.username} (${user.role})`;
  if (user.role === 'admin') document.getElementById('adminLink').style.display = '';
  if (user.role === 'viewer') document.getElementById('addCard').style.display = 'none';
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
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (department_id) params.set('department_id', department_id);
  if (room_id) params.set('room_id', room_id);

  const { items } = await api('/api/inventory?' + params.toString());
  const tbody = document.getElementById('tbody');
  document.getElementById('emptyMsg').style.display = items.length ? 'none' : 'block';
  tbody.innerHTML = items.map(i => `
    <tr>
      <td class="code">${escHtml(i.code)}</td>
      <td>${escHtml(i.name)}</td>
      <td>${escHtml(i.item_date || '—')}</td>
      <td>${escHtml(i.quantity)}</td>
      <td><span class="pill">${escHtml(i.room_number || '—')}</span></td>
      <td>${escHtml(i.department_name || '—')}</td>
      <td>${escHtml(i.note || '')}</td>
      <td>${currentUser.role === 'admin' ? `<button class="secondary danger" data-id="${i.id}">o'chirish</button>` : ''}</td>
    </tr>`).join('');
}

async function addItem() {
  const statusEl = document.getElementById('addStatus');
  const payload = {
    name: document.getElementById('f_name').value.trim(),
    item_date: document.getElementById('f_date').value || null,
    quantity: Number(document.getElementById('f_qty').value) || 1,
    room_number: document.getElementById('f_room').value.trim(),
    department_name: document.getElementById('f_dept').value.trim(),
    note: document.getElementById('f_note').value.trim()
  };
  try {
    const { item } = await api('/api/inventory', { method: 'POST', body: JSON.stringify(payload) });
    setStatus(statusEl, `Qo'shildi. Kod: ${item.code}`, true);
    ['f_name', 'f_date', 'f_qty', 'f_room', 'f_dept', 'f_note'].forEach(id => {
      const el = document.getElementById(id);
      el.value = id === 'f_qty' ? 1 : '';
    });
    await loadFilters();
    await loadItems();
  } catch (e) {
    setStatus(statusEl, e.message, false);
  }
}

document.getElementById('btnAdd').addEventListener('click', addItem);
document.getElementById('btnRefresh').addEventListener('click', loadItems);
document.getElementById('q').addEventListener('input', () => loadItems());
document.getElementById('fDept').addEventListener('change', loadItems);
document.getElementById('fRoom').addEventListener('change', loadItems);
document.getElementById('tbody').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-id]');
  if (!btn) return;
  if (!confirm("Ushbu yozuvni o'chirishni tasdiqlaysizmi?")) return;
  await api('/api/inventory/' + btn.dataset.id, { method: 'DELETE' });
  await loadItems();
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
  } catch (e) {
    alert(e.message);
  }
});

(async function init() {
  try {
    await loadMe();
    await loadFilters();
    await loadItems();
  } catch (e) { /* redirect already handled */ }
})();
