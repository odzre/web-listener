const express = require('express');
const QRCode = require('qrcode');
const config = require('../lib/config');
const { parseAmountInput, normalizeRegion } = require('../lib/money');
const { getUserByApiKey } = require('../lib/users');
const {
  createOrder,
  getOrder,
  getOrderByCode,
  markOrderExpired,
  expireDueOrders,
} = require('../services/orders');
const { getLatestApp } = require('../services/apps');
const { handleCallback } = require('./callback');

const router = express.Router();

function baseUrl(req) {
  return config.appUrl || `${req.protocol}://${req.get('host')}`;
}

function extractApiKey(req) {
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return req.body?.apikey || req.body?.api_key || req.query?.apikey || req.headers['x-api-key'] || '';
}

async function requireApiUser(req, res) {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    res.status(401).json({ success: false, message: 'API key wajib diisi.' });
    return null;
  }
  const user = await getUserByApiKey(apiKey);
  if (!user) {
    res.status(401).json({ success: false, message: 'API key tidak valid.' });
    return null;
  }
  if (user.status !== 'active') {
    res.status(403).json({ success: false, message: 'Akun sedang tidak aktif.' });
    return null;
  }
  return user;
}

function orderJson(req, order) {
  const base = baseUrl(req);
  const qrisIsUrl = /^(https?:\/\/|data:image\/)/i.test(order.qris || '');
  return {
    id: order.id,
    order_id: order.id,
    reference: order.code,
    code: order.code,
    region: order.region,
    currency: order.currency,
    amount: order.amount,
    formatted_amount: order.formattedAmount,
    status: order.status,
    qris: order.qris || null,
    qr_url: order.qris ? `${base}/api/v1/orders/${order.code}/qr` : null,
    qris_is_url: qrisIsUrl,
    payment_url: `${base}/pay/${order.code}`,
    check_status_url: `${base}/api/v1/check-status`,
    created_at: order.createdAt,
    expires_at: order.expiresAt,
    paid_at: order.paidAt || null,
    expired_at: order.expiredAt || null,
  };
}

router.get('/', (req, res) => {
  res.json({
    name: 'NotiPay API',
    version: 'v1',
    endpoints: {
      create_order: 'POST /api/v1/create-order',
      check_status: 'GET|POST /api/v1/check-status',
      callback: 'POST /api/v1/callback',
      latest_app: 'GET /api/v1/app/latest',
    },
    documentation: `${baseUrl(req)}/docs`,
  });
});

router.get('/health', (req, res) => {
  res.json({ success: true, status: 'ok', time: new Date().toISOString() });
});

router.post('/create-order', async (req, res, next) => {
  try {
    const user = await requireApiUser(req, res);
    if (!user) return;

    const region = normalizeRegion(req.body?.region);
    if (!region) {
      return res.status(400).json({ success: false, message: 'Region harus MY atau ID.' });
    }

    const amount = parseAmountInput(region, req.body?.amount);
    if (!amount) {
      return res.status(400).json({ success: false, message: 'Amount tidak valid.' });
    }

    const expired = Number(req.body?.expired ?? 5);
    if (!Number.isFinite(expired) || expired < 1 || expired > 180) {
      return res.status(400).json({ success: false, message: 'Expired harus antara 1 sampai 180 menit.' });
    }

    const qris = req.body?.qris ? String(req.body.qris) : '';
    if (qris.length > 8192) {
      return res.status(400).json({ success: false, message: 'Payload QRIS terlalu panjang.' });
    }

    const order = await createOrder({
      user,
      region,
      amount,
      qris,
      expiredMinutes: expired,
    });

    return res.status(201).json({
      success: true,
      message: 'Order berhasil dibuat.',
      data: {
        ...orderJson(req, order),
        expires_in: Math.round((new Date(order.expiresAt).getTime() - Date.now()) / 1000),
      },
    });
  } catch (error) {
    next(error);
  }
});

async function checkStatusHandler(req, res, next) {
  try {
    const user = await requireApiUser(req, res);
    if (!user) return;

    const identifier = req.body?.order_id
      || req.body?.reference
      || req.body?.trxid
      || req.query?.order_id
      || req.query?.reference
      || req.query?.trxid;

    if (!identifier) {
      return res.status(400).json({ success: false, message: 'order_id atau reference wajib diisi.' });
    }

    let order = await getOrder(identifier);
    if (!order) order = await getOrderByCode(identifier);
    if (!order || order.userId !== user.id) {
      return res.status(404).json({ success: false, message: 'Order tidak ditemukan.' });
    }

    if (order.status === 'pending' && new Date(order.expiresAt).getTime() <= Date.now()) {
      const expired = await markOrderExpired(order.id);
      order = expired.order || order;
    }

    return res.json({
      success: true,
      data: orderJson(req, order),
    });
  } catch (error) {
    next(error);
  }
}

router.get('/check-status', checkStatusHandler);
router.post('/check-status', checkStatusHandler);
router.get('/status', checkStatusHandler);
router.post('/status', checkStatusHandler);

router.get('/app/latest', async (req, res, next) => {
  try {
    const app = await getLatestApp();
    if (!app) {
      return res.status(404).json({ success: false, message: 'Belum ada aplikasi yang diunggah.' });
    }
    return res.json({
      success: true,
      data: {
        version: app.version,
        url: app.url,
        notes: app.notes,
        file_name: app.fileName,
        file_size: app.fileSize,
        created_at: app.createdAt,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/orders/:code/qr', async (req, res, next) => {
  try {
    const order = await getOrderByCode(req.params.code);
    if (!order || !order.qris) {
      return res.status(404).json({ success: false, message: 'QR tidak tersedia.' });
    }
    if (/^(https?:\/\/|data:image\/)/i.test(order.qris)) {
      return res.redirect(order.qris);
    }
    const buffer = await QRCode.toBuffer(order.qris, {
      type: 'png',
      width: 560,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0f172a', light: '#ffffff' },
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(buffer);
  } catch (error) {
    return next(error);
  }
});

router.post('/callback', handleCallback);
router.post('/notification', handleCallback);

router.get('/cron/expire', async (req, res, next) => {
  try {
    if (config.cronSecret) {
      const auth = req.headers.authorization || '';
      const token = auth.replace(/^Bearer\s+/i, '');
      if (token !== config.cronSecret && req.query.secret !== config.cronSecret) {
        return res.status(401).json({ success: false, message: 'Unauthorized.' });
      }
    }
    const expired = await expireDueOrders(500);
    return res.json({ success: true, expired, time: new Date().toISOString() });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
module.exports.orderJson = orderJson;
