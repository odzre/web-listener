const express = require('express');
const { getSettings } = require('../lib/settings');
const { getUserByApiKey } = require('../lib/users');
const { safeEqual } = require('../lib/crypto');
const { processNotificationCallback } = require('../services/callbacks');

const router = express.Router();

function extractApiKey(req) {
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return req.body?.apikey
    || req.body?.api_key
    || req.query?.apikey
    || req.headers['x-api-key']
    || '';
}

async function handleCallback(req, res, next) {
  try {
    const body = req.body || {};
    const apiKey = extractApiKey(req);
    let user = null;
    let secretMode = false;

    if (apiKey) {
      user = await getUserByApiKey(apiKey);
      if (!user) {
        return res.status(401).json({ success: false, message: 'API key tidak valid.' });
      }
      if (user.status !== 'active') {
        return res.status(403).json({ success: false, message: 'Akun sedang tidak aktif.' });
      }
    } else {
      const settings = await getSettings();
      const secret = body.secret || body.callback_secret || req.query.secret || '';
      if (!safeEqual(secret, settings.callbackSecret)) {
        return res.status(401).json({ success: false, message: 'Secret callback tidak valid.' });
      }
      secretMode = true;
    }

    const result = await processNotificationCallback({
      user,
      packageName: body.package || body.package_name || body.packageName || '',
      title: body.title || '',
      text: body.text || body.message || body.notification_text || body.big_text || '',
      deviceId: body.device_id || body.deviceId || '',
      ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
      secretMode,
    });

    const busy = result.callback.status === 'busy';
    return res.status(busy ? 409 : 200).json({
      success: !busy,
      matched: result.callback.status === 'matched',
      status: result.callback.status,
      reason: result.callback.reason,
      order: result.order ? {
        id: result.order.id,
        code: result.order.code,
        status: result.order.status,
        amount: result.order.amount,
        formatted_amount: result.order.formattedAmount,
        region: result.order.region,
      } : null,
    });
  } catch (error) {
    return next(error);
  }
}

router.post('/callback', handleCallback);
router.post('/notification', handleCallback);

module.exports = router;
module.exports.handleCallback = handleCallback;
