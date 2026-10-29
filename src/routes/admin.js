const express = require('express');
const crypto = require('crypto');
const { handleUpload } = require('@vercel/blob/client');
const { head } = require('@vercel/blob');
const { asyncHandler, requireAdmin } = require('../lib/http');
const config = require('../lib/config');
const { useUpstash } = require('../lib/store');
const { setFlash } = require('../lib/auth');
const { safeEqual } = require('../lib/crypto');
const { updateSettings } = require('../lib/settings');
const { listUsers, getUser, updateUser, rotateApiKey } = require('../lib/users');
const { getAllOrders, setOrderStatus, getOrder, getOrderByCode } = require('../services/orders');
const { buildAdminStats, lastSevenDays } = require('../services/stats');
const { listCallbacks, matchCallbackManually } = require('../services/callbacks');
const { listApps, createApp, activateApp, deleteApp } = require('../services/apps');
const { uploadFile, uploadImageOrDataUrl, deleteStoredFile } = require('../services/storage');

const router = express.Router();

router.post('/admin/apps/blob-token', asyncHandler(async (req, res) => {
  if (!config.blobToken) {
    return res.status(400).json({ success: false, message: 'Vercel Blob belum dikonfigurasi.' });
  }
  if (res.locals.user?.role !== 'admin') {
    return res.status(401).json({ success: false, message: 'Unauthorized.' });
  }
  const csrfHeader = req.headers['x-csrf-token'];
  const csrfCookie = req.cookies?.[config.csrfCookie];
  if (!csrfHeader || !csrfCookie || !safeEqual(csrfHeader, csrfCookie)) {
    return res.status(403).json({ success: false, message: 'Token keamanan tidak valid.' });
  }

  const response = await handleUpload({
    body: req.body,
    request: req,
    token: config.blobToken,
    onBeforeGenerateToken: async () => ({
      allowedContentTypes: ['application/vnd.android.package-archive', 'application/octet-stream'],
      maximumSizeInBytes: 250 * 1024 * 1024,
      addRandomSuffix: true,
    }),
  });
  return res.json(response);
}));

router.use('/admin', requireAdmin);

function fileFrom(req, field) {
  return (req.files || []).find((file) => file.fieldname === field);
}

function isImage(file) {
  return file && /^image\/(png|jpeg|webp|gif|svg\+xml|x-icon|vnd.microsoft.icon)$/i.test(file.mimetype);
}

router.get('/admin', asyncHandler(async (req, res) => {
  const [orders, users] = await Promise.all([
    getAllOrders(2000),
    listUsers(),
  ]);
  const stats = buildAdminStats(orders);

  res.render('admin/dashboard', {
    ...res.locals,
    pageTitle: `Admin — ${res.locals.site.siteName}`,
    stats,
    users,
    recentOrders: orders.slice(0, 8),
    chart: lastSevenDays(orders),
  });
}));

router.get('/admin/users', asyncHandler(async (req, res) => {
  const [users, orders] = await Promise.all([listUsers(), getAllOrders(2000)]);
  const counts = new Map();
  for (const order of orders) {
    const current = counts.get(order.userId) || { total: 0, success: 0 };
    current.total += 1;
    if (order.status === 'success') current.success += 1;
    counts.set(order.userId, current);
  }
  res.render('admin/users', {
    ...res.locals,
    pageTitle: `Pengguna — ${res.locals.site.siteName}`,
    users,
    counts,
  });
}));

router.post('/admin/users/:id/status', asyncHandler(async (req, res) => {
  const target = await getUser(req.params.id);
  if (!target) {
    setFlash(res, 'danger', 'Pengguna tidak ditemukan.');
    return res.redirect('/admin/users');
  }
  if (target.id === res.locals.user.id) {
    setFlash(res, 'danger', 'Anda tidak dapat menangguhkan akun sendiri.');
    return res.redirect('/admin/users');
  }
  const status = req.body.status === 'suspended' ? 'suspended' : 'active';
  await updateUser(target.id, { status });
  setFlash(res, 'success', `Status ${target.email} diubah menjadi ${status}.`);
  return res.redirect('/admin/users');
}));

router.post('/admin/users/:id/rotate-key', asyncHandler(async (req, res) => {
  const target = await getUser(req.params.id);
  if (!target) {
    setFlash(res, 'danger', 'Pengguna tidak ditemukan.');
    return res.redirect('/admin/users');
  }
  await rotateApiKey(target.id);
  setFlash(res, 'success', `API key ${target.email} berhasil diperbarui.`);
  return res.redirect('/admin/users');
}));

router.get('/admin/orders', asyncHandler(async (req, res) => {
  const orders = await getAllOrders(2000);
  const status = String(req.query.status || '').toLowerCase();
  const region = String(req.query.region || '').toUpperCase();
  const query = String(req.query.q || '').trim().toLowerCase();

  const filtered = orders.filter((order) => {
    if (status && order.status !== status) return false;
    if (region && order.region !== region) return false;
    if (query) {
      const haystack = `${order.code} ${order.userEmail} ${order.userName} ${order.formattedAmount}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  res.render('admin/orders', {
    ...res.locals,
    pageTitle: `Transaksi — ${res.locals.site.siteName}`,
    orders: filtered.slice(0, 150),
    total: filtered.length,
    filters: { status, region, q: req.query.q || '' },
  });
}));

router.post('/admin/orders/:id/status', asyncHandler(async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) {
    setFlash(res, 'danger', 'Order tidak ditemukan.');
    return res.redirect('/admin/orders');
  }
  const status = req.body.status;
  if (!['success', 'expired'].includes(status)) {
    setFlash(res, 'danger', 'Status tidak valid.');
    return res.redirect('/admin/orders');
  }
  await setOrderStatus(order.id, status, { callbackId: 'manual-admin' });
  setFlash(res, 'success', `Order ${order.code} diubah menjadi ${status}.`);
  return res.redirect('/admin/orders');
}));

router.get('/admin/callbacks', asyncHandler(async (req, res) => {
  const callbacks = await listCallbacks(300);
  const status = String(req.query.status || '').toLowerCase();
  const filtered = status ? callbacks.filter((callback) => callback.status === status) : callbacks;
  res.render('admin/callbacks', {
    ...res.locals,
    pageTitle: `Callback — ${res.locals.site.siteName}`,
    callbacks: filtered.slice(0, 150),
    total: filtered.length,
    filters: { status },
  });
}));

router.post('/admin/callbacks/:id/match', asyncHandler(async (req, res) => {
  const identifier = String(req.body.order || '').trim();
  if (!identifier) {
    setFlash(res, 'danger', 'ID atau kode order wajib diisi.');
    return res.redirect('/admin/callbacks');
  }
  try {
    const { order } = await matchCallbackManually(req.params.id, identifier);
    setFlash(res, 'success', `Callback dicocokkan dengan order ${order.code}.`);
  } catch (error) {
    setFlash(res, 'danger', error.message);
  }
  return res.redirect('/admin/callbacks');
}));

router.get('/admin/apps', asyncHandler(async (req, res) => {
  const apps = await listApps();
  res.render('admin/apps', {
    ...res.locals,
    pageTitle: `Aplikasi — ${res.locals.site.siteName}`,
    apps,
    platform: { blob: Boolean(config.blobToken) },
  });
}));

router.post('/admin/apps/blob-finalize', asyncHandler(async (req, res) => {
  if (!config.blobToken) {
    return res.status(400).json({ success: false, message: 'Vercel Blob belum dikonfigurasi.' });
  }
  try {
    const blob = await head(req.body.url);
    const app = await createApp({
      version: req.body.version,
      url: blob.url,
      notes: req.body.notes,
      fileName: req.body.fileName || 'notipay.apk',
      fileSize: blob.size || req.body.size,
      contentType: blob.contentType || 'application/vnd.android.package-archive',
    });
    return res.json({ success: true, app: { id: app.id, version: app.version }, redirect: '/admin/apps' });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
}));

router.post('/admin/apps', asyncHandler(async (req, res) => {
  const file = fileFrom(req, 'apk');
  let url = String(req.body.appUrl || '').trim();
  let fileName = '';
  let fileSize = 0;
  let contentType = 'application/vnd.android.package-archive';

  try {
    if (file) {
      const uploaded = await uploadFile(
        file.buffer,
        file.originalname || 'notipay.apk',
        file.mimetype || contentType,
        'apk',
      );
      url = uploaded.url;
      fileName = file.originalname || 'notipay.apk';
      fileSize = file.size;
      contentType = file.mimetype || contentType;
    }

    if (!url) {
      setFlash(res, 'danger', 'Pilih file APK atau isi URL aplikasi.');
      return res.redirect('/admin/apps');
    }
    if (!/^(https?:\/\/|\/)/i.test(url)) {
      setFlash(res, 'danger', 'URL aplikasi harus dimulai dengan http(s):// atau /.');
      return res.redirect('/admin/apps');
    }

    const app = await createApp({
      version: req.body.version,
      url,
      notes: req.body.notes,
      fileName,
      fileSize,
      contentType,
    });
    setFlash(res, 'success', `Aplikasi ${app.version} berhasil diunggah dan diaktifkan.`);
  } catch (error) {
    setFlash(res, 'danger', error.message);
  }
  return res.redirect('/admin/apps');
}));

router.post('/admin/apps/:id/activate', asyncHandler(async (req, res) => {
  try {
    const app = await activateApp(req.params.id);
    setFlash(res, 'success', `Versi ${app.version} sekarang aktif.`);
  } catch (error) {
    setFlash(res, 'danger', error.message);
  }
  return res.redirect('/admin/apps');
}));

router.post('/admin/apps/:id/delete', asyncHandler(async (req, res) => {
  const app = await deleteApp(req.params.id);
  if (app) {
    await deleteStoredFile(app.url);
    setFlash(res, 'success', `Aplikasi ${app.version} dihapus.`);
  } else {
    setFlash(res, 'danger', 'Aplikasi tidak ditemukan.');
  }
  return res.redirect('/admin/apps');
}));

router.get('/admin/settings', (req, res) => {
  res.render('admin/settings', {
    ...res.locals,
    pageTitle: `Pengaturan — ${res.locals.site.siteName}`,
    platform: {
      upstash: useUpstash,
      blob: Boolean(config.blobToken),
    },
  });
});

router.post('/admin/settings', asyncHandler(async (req, res) => {
  const patch = {};
  const textFields = ['siteName', 'siteTitle', 'siteDescription', 'supportEmail', 'announcement', 'footerNote', 'apiDocsUrl'];
  for (const field of textFields) {
    if (req.body[field] !== undefined) patch[field] = String(req.body[field]).trim().slice(0, 2000);
  }
  if (!patch.siteName) {
    setFlash(res, 'danger', 'Nama website wajib diisi.');
    return res.redirect('/admin/settings');
  }
  patch.registrationOpen = req.body.registrationOpen === 'on' || req.body.registrationOpen === '1';
  patch.maintenance = req.body.maintenance === 'on' || req.body.maintenance === '1';

  try {
    const logoFile = fileFrom(req, 'logo');
    const faviconFile = fileFrom(req, 'favicon');

    if (logoFile) {
      if (!isImage(logoFile)) throw new Error('Logo harus berupa file gambar.');
      patch.logoUrl = await uploadImageOrDataUrl(logoFile.buffer, logoFile.originalname, logoFile.mimetype);
    } else if (req.body.logo_remove === '1') {
      patch.logoUrl = '';
    } else if (req.body.logoUrl) {
      patch.logoUrl = String(req.body.logoUrl).trim();
    }

    if (faviconFile) {
      if (!isImage(faviconFile)) throw new Error('Favicon harus berupa file gambar.');
      patch.faviconUrl = await uploadImageOrDataUrl(faviconFile.buffer, faviconFile.originalname, faviconFile.mimetype);
    } else if (req.body.favicon_remove === '1') {
      patch.faviconUrl = '';
    } else if (req.body.faviconUrl) {
      patch.faviconUrl = String(req.body.faviconUrl).trim();
    }

    await updateSettings(patch);
    setFlash(res, 'success', 'Pengaturan website berhasil disimpan.');
  } catch (error) {
    setFlash(res, 'danger', error.message);
  }
  return res.redirect('/admin/settings');
}));

router.post('/admin/settings/regenerate-secret', asyncHandler(async (req, res) => {
  await updateSettings({ callbackSecret: `np_cb_${crypto.randomBytes(24).toString('hex')}` });
  setFlash(res, 'warning', 'Callback secret baru dibuat. Perbarui konfigurasi aplikasi yang memakai secret lama.');
  return res.redirect('/admin/settings');
}));

router.get('/admin/orders/:id', asyncHandler(async (req, res) => {
  let order = await getOrder(req.params.id);
  if (!order) order = await getOrderByCode(req.params.id);
  if (!order) {
    setFlash(res, 'danger', 'Order tidak ditemukan.');
    return res.redirect('/admin/orders');
  }
  return res.redirect(`/pay/${order.code}`);
}));

module.exports = router;
