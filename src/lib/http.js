function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireAuth(req, res, next) {
  if (!res.locals.user) {
    res.locals.setFlash?.('warning', 'Silakan masuk terlebih dahulu.');
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  return next();
}

function requireAdmin(req, res, next) {
  if (!res.locals.user) return res.redirect('/login');
  if (res.locals.user.role !== 'admin') {
    return res.status(403).render('error', {
      ...res.locals,
      pageTitle: 'Akses ditolak',
      statusCode: 403,
      message: 'Halaman ini hanya dapat diakses oleh administrator.',
    });
  }
  return next();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

module.exports = {
  asyncHandler,
  requireAuth,
  requireAdmin,
  isEmail,
};
