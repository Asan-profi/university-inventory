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

let meId = null;

async function loadMe() {
  const { user } = await api('/api/auth/me');
  meId = user.id;
  document.getElementById('whoami').textContent = `${user.full_name || user.username} (${user.role})`;
}

async function loadUsers() {
  const { users } = await api('/api/admin/users');
  document.getElementById('usersBody').innerHTML = users.map(u => `
    <tr>
      <td>${escHtml(u.username)}</td>
      <td>${escHtml(u.full_name || '')}</td>
      <td><span class="badge badge-${u.role}">${escHtml(u.role)}</span></td>
      <td>${u.is_active ? 'faol' : 'bloklangan'}</td>
      <td>
        ${u.id === meId ? '' : `
          <button class="secondary" data-toggle="${u.id}" data-active="${u.is_active}">${u.is_active ? 'Bloklash' : 'Aktivlashtirish'}</button>
          <button class="secondary" data-reset="${u.id}">Parolni tiklash</button>
          <button class="secondary danger" data-del="${u.id}">O'chirish</button>
        `}
      </td>
    </tr>`).join('');
}

async function loadCategories() {
  const { categories } = await api('/api/admin/categories');
  document.getElementById('catBody').innerHTML = categories.map(c => `
    <tr>
      <td class="code">${escHtml(c.code)}</td>
      <td>${escHtml(c.name)}</td>
      <td>${escHtml(c.example || '')}</td>
      <td><button class="secondary danger" data-delcat="${escHtml(c.code)}">o'chirish</button></td>
    </tr>`).join('');
}

document.getElementById('btnAddCat').addEventListener('click', async () => {
  const statusEl = document.getElementById('catStatus');
  const code = document.getElementById('cat_code').value.trim();
  const name = document.getElementById('cat_name').value.trim();
  const example = document.getElementById('cat_example').value.trim();
  if (!code || !name) { setStatus(statusEl, 'Kod va nomi kiritilishi shart.', false); return; }
  try {
    await api('/api/admin/categories', { method: 'POST', body: JSON.stringify({ code, name, example }) });
    setStatus(statusEl, "Kategoriya qo'shildi.", true);
    ['cat_code', 'cat_name', 'cat_example'].forEach(id => document.getElementById(id).value = '');
    await loadCategories();
  } catch (e) { setStatus(statusEl, e.message, false); }
});
document.getElementById('catBody').addEventListener('click', async (e) => {
  if (e.target.dataset.delcat) {
    if (!confirm("Ushbu kategoriyani o'chirishni tasdiqlaysizmi?")) return;
    try {
      await api('/api/admin/categories/' + e.target.dataset.delcat, { method: 'DELETE' });
      await loadCategories();
    } catch (err) { alert(err.message); }
  }
});

async function loadDeptsRooms() {
  const [{ departments }, { rooms }] = await Promise.all([
    api('/api/admin/departments'),
    api('/api/admin/rooms')
  ]);
  document.getElementById('deptBody').innerHTML = departments.map(d => `
    <tr><td>${escHtml(d.name)}</td><td><button class="secondary danger" data-deldept="${d.id}">o'chirish</button></td></tr>`).join('');
  document.getElementById('roomBody').innerHTML = rooms.map(r => `
    <tr><td>${escHtml(r.number)}</td><td>${escHtml(r.department_name || '—')}</td><td><button class="secondary danger" data-delroom="${r.id}">o'chirish</button></td></tr>`).join('');
  document.getElementById('r_dept').innerHTML = departments.map(d => `<option value="${d.id}">${escHtml(d.name)}</option>`).join('');
}

async function loadLog() {
  const { log } = await api('/api/admin/audit-log');
  document.getElementById('logBody').innerHTML = log.map(l => `
    <tr><td>${escHtml(l.created_at)}</td><td>${escHtml(l.username || '—')}</td><td>${escHtml(l.action)}</td><td>${escHtml(l.details || '')}</td><td>${escHtml(l.ip || '')}</td></tr>`).join('');
}

document.getElementById('btnAddUser').addEventListener('click', async () => {
  const statusEl = document.getElementById('userStatus');
  try {
    await api('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('u_username').value.trim(),
        password: document.getElementById('u_password').value,
        full_name: document.getElementById('u_fullname').value.trim(),
        role: document.getElementById('u_role').value
      })
    });
    setStatus(statusEl, "Foydalanuvchi qo'shildi.", true);
    ['u_username', 'u_password', 'u_fullname'].forEach(id => document.getElementById(id).value = '');
    await loadUsers();
  } catch (e) { setStatus(statusEl, e.message, false); }
});

document.getElementById('usersBody').addEventListener('click', async (e) => {
  const t = e.target;
  if (t.dataset.toggle) {
    const active = t.dataset.active === '1' || t.dataset.active === 'true';
    await api(`/api/admin/users/${t.dataset.toggle}/status`, { method: 'PUT', body: JSON.stringify({ is_active: !active }) });
    await loadUsers();
  } else if (t.dataset.reset) {
    const pw = prompt("Yangi parol (kamida 8 belgi):");
    if (!pw) return;
    try {
      await api(`/api/admin/users/${t.dataset.reset}/reset-password`, { method: 'PUT', body: JSON.stringify({ newPassword: pw }) });
      alert("Parol tiklandi.");
    } catch (err) { alert(err.message); }
  } else if (t.dataset.del) {
    if (!confirm("Foydalanuvchini o'chirishni tasdiqlaysizmi?")) return;
    await api(`/api/admin/users/${t.dataset.del}`, { method: 'DELETE' });
    await loadUsers();
  }
});

document.getElementById('btnAddDept').addEventListener('click', async () => {
  const name = document.getElementById('d_name').value.trim();
  if (!name) return;
  await api('/api/admin/departments', { method: 'POST', body: JSON.stringify({ name }) });
  document.getElementById('d_name').value = '';
  await loadDeptsRooms();
});
document.getElementById('btnAddRoom').addEventListener('click', async () => {
  const number = document.getElementById('r_number').value.trim();
  const department_id = document.getElementById('r_dept').value;
  if (!number) return;
  await api('/api/admin/rooms', { method: 'POST', body: JSON.stringify({ number, department_id }) });
  document.getElementById('r_number').value = '';
  await loadDeptsRooms();
});
document.getElementById('deptBody').addEventListener('click', async (e) => {
  if (e.target.dataset.deldept) {
    await api('/api/admin/departments/' + e.target.dataset.deldept, { method: 'DELETE' });
    await loadDeptsRooms();
  }
});
document.getElementById('roomBody').addEventListener('click', async (e) => {
  if (e.target.dataset.delroom) {
    await api('/api/admin/rooms/' + e.target.dataset.delroom, { method: 'DELETE' });
    await loadDeptsRooms();
  }
});
document.getElementById('btnLogout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

(async function init() {
  try {
    await loadMe();
    await loadUsers();
    await loadCategories();
    await loadDeptsRooms();
    await loadLog();
  } catch (e) { /* redirect already handled */ }
})();
