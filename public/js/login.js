document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById('status');
  statusEl.textContent = '';
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) {
      statusEl.textContent = data.error || 'Xatolik yuz berdi.';
      return;
    }
    window.location.href = '/dashboard.html';
  } catch (err) {
    statusEl.textContent = 'Serverga ulanib bo\'lmadi.';
  }
});
