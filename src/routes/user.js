const express = require('express');
const { asyncHandler, requireAuth, isEmail } = require('../lib/http');
const { getUser, updateUser, rotateApiKey } = require('../lib/users');
const { verifyPassword, hashPassword } = require('../lib/crypto');
const { setFlash } = require('../lib/auth');
const { getUserOrders } = require('../services/orders');
const { buildUserStats } = require('../services/stats');
const { getLatestApp } = require('../services/apps');

const router = express.Router();

router.use(['/dashboard', '/orders', '/settings'], requireAuth);

router.get('/dashboard', asyncHandler(async (req, res) => {
  const [orders, latestApp] = await Promise.all([
    getUserOrders(res.locals.user.id, 1000),
    getLatestApp(),
  ]);
  const stats = buildUserStats(orders);

  res.render('user/dashboard', {
    ...res.locals,
    pageTitle: `Dashboard — ${res.locals.site.siteName}`,
    stats,
    recentOrders: orders.slice(0, 6),
    latestApp,
    totalOrders: orders.length,
  });
}));

router.get('/orders', asyncHandler(async (req, res) => {
  const orders = await getUserOrders(res.locals.user.id, 1000);
  const status = String(req.query.status || '').toLowerCase();
  const region = String(req.query.region || '').toUpperCase();
  const query = String(req.query.q || '').trim().toLowerCase();

  const filtered = orders.filter((order) => {
    if (status && order.status !== status) return false;
    if (region && order.region !== region) return false;
    if (query && !`${order.code} ${order.formattedAmount}`.toLowerCase().includes(query)) return false;
    return true;
  });

  res.render('user/orders', {
    ...res.locals,
    pageTitle: `Transaksi — ${res.locals.site.siteName}`,
    orders: filtered.slice(0, 100),
    total: filtered.length,
    filters: { status, region, q: req.query.q || '' },
  });
}));

router.get('/settings', (req, res) => {
  res.render('user/settings', {
    ...res.locals,
    pageTitle: `Pengaturan — ${res.locals.site.siteName}`,
  });
});

router.post('/settings/profile', asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  if (name.length < 2) {
    setFlash(res, 'danger', 'Nama minimal 2 karakter.');
    return res.redirect('/settings');
  }
  if (!isEmail(email)) {
    setFlash(res, 'danger', 'Format email tidak valid.');
    return res.redirect('/settings');
  }
  try {
    await updateUser(res.locals.user.id, { name, email });
    setFlash(res, 'success', 'Profil berhasil diperbarui.');
  } catch (error) {
    if (error.code === 'EMAIL_EXISTS') {
      setFlash(res, 'danger', 'Email sudah digunakan akun lain.');
    } else {
      throw error;
    }
  }
  return res.redirect('/settings');
}));

router.post('/settings/password', asyncHandler(async (req, res) => {
  const current = String(req.body.current_password || '');
  const next = String(req.body.new_password || '');
  const confirm = String(req.body.confirm_password || '');
  const user = await getUser(res.locals.user.id);

  if (!verifyPassword(current, user.passwordHash)) {
    setFlash(res, 'danger', 'Password saat ini tidak sesuai.');
    return res.redirect('/settings');
  }
  if (next.length < 8) {
    setFlash(res, 'danger', 'Password baru minimal 8 karakter.');
    return res.redirect('/settings');
  }
  if (next !== confirm) {
    setFlash(res, 'danger', 'Konfirmasi password baru tidak cocok.');
    return res.redirect('/settings');
  }

  await updateUser(user.id, { passwordHash: hashPassword(next) });
  setFlash(res, 'success', 'Password berhasil diperbarui.');
  return res.redirect('/settings');
}));

router.post('/settings/rotate-key', asyncHandler(async (req, res) => {
  await rotateApiKey(res.locals.user.id);
  setFlash(res, 'success', 'API key baru berhasil dibuat. Perbarui aplikasi Anda.');
  return res.redirect('/settings');
}));

module.exports = router;
