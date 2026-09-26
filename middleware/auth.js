function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Tizimga kirish talab qilinadi.' });
  }
  return res.redirect('/login.html');
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: 'Tizimga kirish talab qilinadi.' });
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'Ushbu amal uchun ruxsatingiz yetarli emas.' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
