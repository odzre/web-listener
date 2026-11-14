const { store } = require('../lib/store');
const { parseNotificationAmount, isIncomingNotification, formatUnits } = require('../lib/money');
const { sha256 } = require('../lib/crypto');
const { uuid } = require('../lib/ids');
const {
  findOrderForCallback,
  markOrderPaid,
  getOrder,
  getOrderByCode,
} = require('./orders');

async function getCallback(id) {
  if (!id) return null;
  const raw = await store.get(`callback:${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveCallback(callback) {
  await store.set(`callback:${callback.id}`, JSON.stringify(callback));
  const score = new Date(callback.createdAt).getTime();
  await store.zadd('callbacks:all', score, callback.id);
  if (callback.userId) {
    await store.zadd(`user:${callback.userId}:callbacks`, score, callback.id);
  }
  return callback;
}

async function listCallbacks(limit = 200) {
  const ids = await store.zrange('callbacks:all', 0, Math.max(0, limit - 1), { rev: true });
  if (!ids.length) return [];
  const values = await store.mget(...ids.map((id) => `callback:${id}`));
  return values
    .filter(Boolean)
    .map((raw) => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function processNotificationCallback({
  user,
  packageName,
  title,
  text,
  deviceId,
  ip,
  secretMode = false,
}) {
  const cleanTitle = String(title || '').slice(0, 500);
  const cleanText = String(text || '').slice(0, 4000);
  const cleanPackage = String(packageName || '').slice(0, 200);
  const combined = `${cleanTitle} ${cleanText}`.trim();
  const now = Date.now();
  const dedupeKey = `callback:dedupe:${sha256(`${user?.id || 'global'}|${cleanPackage}|${combined}|${Math.floor(now / 15000)}`)}`;
  const firstSeen = await store.set(dedupeKey, '1', { ex: 20, nx: true });

  if (!firstSeen) {
    const duplicate = {
      id: uuid(),
      userId: user?.id || null,
      userEmail: user?.email || null,
      status: 'duplicate',
      reason: 'Callback yang sama diterima dalam 15 detik terakhir.',
      parsed: null,
      orderId: null,
      orderCode: null,
      packageName: cleanPackage,
      title: cleanTitle,
      text: cleanText,
      deviceId: String(deviceId || '').slice(0, 200),
      ip: ip || '',
      secretMode,
      createdAt: new Date(now).toISOString(),
    };
    await saveCallback(duplicate);
    return { callback: duplicate, order: null, duplicate: true };
  }

  const callback = {
    id: uuid(),
    userId: user?.id || null,
    userEmail: user?.email || null,
    status: 'unmatched',
    reason: '',
    parsed: null,
    orderId: null,
    orderCode: null,
    packageName: cleanPackage,
    title: cleanTitle,
    text: cleanText,
    deviceId: String(deviceId || '').slice(0, 200),
    ip: ip || '',
    secretMode,
    createdAt: new Date(now).toISOString(),
  };

  const parsed = parseNotificationAmount(combined);
  callback.parsed = parsed;

  if (!parsed) {
    callback.reason = 'Nominal pembayaran tidak ditemukan pada teks notifikasi.';
    await saveCallback(callback);
    return { callback, order: null, duplicate: false };
  }

  if (!isIncomingNotification(combined)) {
    callback.status = 'ignored';
    callback.reason = `Notifikasi bukan uang masuk, diabaikan (${formatUnits(parsed.region, parsed.amount)}).`;
    await saveCallback(callback);
    return { callback, order: null, duplicate: false };
  }

  const order = await findOrderForCallback({
    userId: user?.id || null,
    region: parsed.region,
    amount: parsed.amount,
  });

  if (!order) {
    callback.reason = `Tidak ada order pending ${formatUnits(parsed.region, parsed.amount)}.`;
    await saveCallback(callback);
    return { callback, order: null, duplicate: false };
  }

  const lockKey = `lock:order:${order.id}`;
  const lock = await store.set(lockKey, callback.id, { ex: 20, nx: true });
  if (!lock) {
    callback.status = 'busy';
    callback.reason = 'Order sedang diproses oleh callback lain.';
    await saveCallback(callback);
    return { callback, order, duplicate: false };
  }

  callback.orderId = order.id;
  callback.orderCode = order.code;
  const paid = await markOrderPaid(order.id, { callbackId: callback.id, paidAmount: parsed.amount });
  if (paid.changed) {
    callback.status = 'matched';
    callback.reason = 'Order berhasil ditandai sebagai sukses.';
  } else if (paid.order?.status === 'success') {
    callback.status = 'duplicate';
    callback.reason = 'Order sudah sukses sebelumnya.';
  } else {
    callback.status = 'unmatched';
    callback.reason = 'Order tidak dapat diproses.';
  }

  await saveCallback(callback);
  return { callback, order: paid.order, duplicate: callback.status === 'duplicate' };
}

async function matchCallbackManually(callbackId, orderIdentifier) {
  const callback = await getCallback(callbackId);
  if (!callback) throw new Error('Callback tidak ditemukan.');
  if (callback.status === 'matched' || callback.status === 'matched_manual') {
    throw new Error('Callback ini sudah dicocokkan dengan order.');
  }
  const order = await getOrder(orderIdentifier) || await getOrderByCode(orderIdentifier);
  if (!order) throw new Error('Order tidak ditemukan.');
  if (order.status !== 'pending') throw new Error('Order bukan dalam status pending.');

  const paid = await markOrderPaid(order.id, {
    callbackId: callback.id,
    paidAmount: callback.parsed?.amount || order.amount,
  });
  callback.status = paid.changed ? 'matched_manual' : 'unmatched';
  callback.orderId = order.id;
  callback.orderCode = order.code;
  callback.reason = paid.changed
    ? 'Dicocokkan manual oleh administrator.'
    : 'Order tidak dapat diubah.';
  callback.matchedBy = 'admin';
  callback.matchedAt = new Date().toISOString();
  await saveCallback(callback);
  return { callback, order: paid.order };
}

module.exports = {
  getCallback,
  saveCallback,
  listCallbacks,
  processNotificationCallback,
  matchCallbackManually,
};
