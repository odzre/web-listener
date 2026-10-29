const express = require('express');
const { asyncHandler } = require('../lib/http');
const { getLatestApp } = require('../services/apps');
const { getOrderByCode, markOrderExpired } = require('../services/orders');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const latestApp = await getLatestApp();
  res.render('public/home', {
    ...res.locals,
    pageTitle: res.locals.site.siteTitle,
    metaDescription: res.locals.site.siteDescription,
    latestApp,
  });
}));

router.get('/download', asyncHandler(async (req, res) => {
  const latestApp = await getLatestApp();
  res.render('public/download', {
    ...res.locals,
    pageTitle: `Unduh Aplikasi — ${res.locals.site.siteName}`,
    metaDescription: 'Unduh aplikasi Android NotiPay Notification Listener.',
    latestApp,
  });
}));

router.get('/docs', (req, res) => {
  res.render('public/docs', {
    ...res.locals,
    pageTitle: `Dokumentasi API — ${res.locals.site.siteName}`,
    metaDescription: 'Dokumentasi API create order, check status, callback, dan aplikasi Android.',
  });
});

router.get('/pay/:code', asyncHandler(async (req, res, next) => {
  let order = await getOrderByCode(req.params.code);
  if (!order) return next();

  if (order.status === 'pending' && new Date(order.expiresAt).getTime() <= Date.now()) {
    const result = await markOrderExpired(order.id);
    order = result.order || order;
  }

  return res.render('public/pay', {
    ...res.locals,
    pageTitle: `Pembayaran ${order.code}`,
    metaDescription: `Halaman pembayaran ${order.formattedAmount}.`,
    order,
  });
}));

router.get('/health', (req, res) => {
  res.json({ ok: true, service: 'notipay', time: new Date().toISOString() });
});

module.exports = router;
