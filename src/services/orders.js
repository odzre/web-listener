const { store } = require('../lib/store');
const { uuid, createOrderCode } = require('../lib/ids');
const { REGIONS, formatUnits, normalizeRegion } = require('../lib/money');

const STATUS = {
  PENDING: 'pending',
  SUCCESS: 'success',
  EXPIRED: 'expired',
};

function pendingDueKey() {
  return 'orders:pending:due';
}

function pendingUserKey(userId, region, amount) {
  return `pending:user:${userId}:${region}:${amount}`;
}

function pendingAllKey(region, amount) {
  return `pending:all:${region}:${amount}`;
}

async function getOrder(id) {
  if (!id) return null;
  const raw = await store.get(`order:${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function getOrderByCode(code) {
  const id = await store.get(`order:code:${String(code || '').trim().toUpperCase()}`);
  return id ? getOrder(id) : null;
}

async function hydrateOrders(ids) {
  if (!ids.length) return [];
  const values = await store.mget(...ids.map((id) => `order:${id}`));
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

async function createOrder({ user, region, amount, qris, expiredMinutes }) {
  const normalizedRegion = normalizeRegion(region);
  if (!normalizedRegion) throw new Error('Region tidak valid.');
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Amount tidak valid.');

  const regionConfig = REGIONS[normalizedRegion];
  if (normalizedRegion === 'MY' && amount < 1) {
    throw new Error('Minimal transaksi RM0.01.');
  }
  if (normalizedRegion === 'ID' && amount < 1) {
    throw new Error('Minimal transaksi Rp1.');
  }
  if (normalizedRegion === 'PH' && amount < 1) {
    throw new Error('Minimal transaksi PHP0.01.');
  }

  let code = createOrderCode();
  let guard = 0;
  while (await store.get(`order:code:${code}`)) {
    code = createOrderCode();
    guard += 1;
    if (guard > 5) throw new Error('Gagal membuat kode order.');
  }

  const now = Date.now();
  const expired = Math.min(Math.max(Number(expiredMinutes) || 5, 1), 180);
  const expiresAt = now + expired * 60 * 1000;
  const order = {
    id: uuid(),
    code,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    region: normalizedRegion,
    currency: regionConfig.currency,
    amount,
    formattedAmount: formatUnits(normalizedRegion, amount),
    qris: qris ? String(qris).trim().slice(0, 8192) : '',
    status: STATUS.PENDING,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    paidAt: null,
    expiredAt: null,
    callbackId: null,
    updatedAt: new Date(now).toISOString(),
  };

  await Promise.all([
    store.set(`order:${order.id}`, JSON.stringify(order)),
    store.set(`order:code:${order.code}`, order.id),
    store.zadd(`user:${user.id}:orders`, now, order.id),
    store.zadd('orders:all', now, order.id),
    addPendingIndexes(order),
  ]);

  return order;
}

async function addPendingIndexes(order) {
  const createdAt = new Date(order.createdAt).getTime();
  const expiresAt = new Date(order.expiresAt).getTime();
  await Promise.all([
    store.zadd(pendingDueKey(), expiresAt, order.id),
    store.zadd(pendingUserKey(order.userId, order.region, order.amount), createdAt, order.id),
    store.zadd(pendingAllKey(order.region, order.amount), createdAt, order.id),
  ]);
}

async function removePendingIndexes(order) {
  await Promise.all([
    store.zrem(pendingDueKey(), order.id),
    store.zrem(pendingUserKey(order.userId, order.region, order.amount), order.id),
    store.zrem(pendingAllKey(order.region, order.amount), order.id),
  ]);
}

async function saveOrder(order, previousStatus = order.status) {
  order.updatedAt = new Date().toISOString();
  await store.set(`order:${order.id}`, JSON.stringify(order));
  if (order.status !== STATUS.PENDING) {
    await removePendingIndexes(order);
  } else if (previousStatus !== STATUS.PENDING) {
    await addPendingIndexes(order);
  }
  return order;
}

async function markOrderPaid(orderId, extra = {}) {
  const order = await getOrder(orderId);
  if (!order) return { order: null, changed: false };
  if (order.status === STATUS.SUCCESS) return { order, changed: false };
  if (order.status === STATUS.EXPIRED) return { order, changed: false };

  order.status = STATUS.SUCCESS;
  order.paidAt = new Date().toISOString();
  order.callbackId = extra.callbackId || order.callbackId || null;
  if (extra.paidAmount) order.paidAmount = extra.paidAmount;
  order.updatedAt = new Date().toISOString();
  await saveOrder(order, STATUS.PENDING);
  return { order, changed: true };
}

async function markOrderExpired(orderId) {
  const order = await getOrder(orderId);
  if (!order || order.status !== STATUS.PENDING) return { order, changed: false };
  order.status = STATUS.EXPIRED;
  order.expiredAt = new Date().toISOString();
  order.updatedAt = new Date().toISOString();
  await saveOrder(order, STATUS.PENDING);
  return { order, changed: true };
}

async function setOrderStatus(orderId, status, extra = {}) {
  if (!Object.values(STATUS).includes(status)) throw new Error('Status tidak valid.');
  if (status === STATUS.SUCCESS) return markOrderPaid(orderId, extra);
  if (status === STATUS.EXPIRED) return markOrderExpired(orderId);
  return { order: await getOrder(orderId), changed: false };
}

async function findOrderForCallback({ userId, region, amount }) {
  const key = userId
    ? pendingUserKey(userId, region, amount)
    : pendingAllKey(region, amount);
  const ids = await store.zrange(key, 0, 9);

  for (const id of ids) {
    const order = await getOrder(id);
    if (!order || order.status !== STATUS.PENDING) {
      await store.zrem(key, id);
      continue;
    }
    if (new Date(order.expiresAt).getTime() <= Date.now()) {
      await markOrderExpired(order.id);
      continue;
    }
    return order;
  }
  return null;
}

async function expireDueOrders(limit = 200) {
  const ids = await store.zrangeByScore(pendingDueKey(), 0, Date.now(), { limit });
  let expired = 0;
  for (const id of ids) {
    const result = await markOrderExpired(id);
    if (result.changed) expired += 1;
  }
  return expired;
}

async function getUserOrders(userId, limit = 500) {
  await expireDueOrders(100);
  const ids = await store.zrange(`user:${userId}:orders`, 0, Math.max(0, limit - 1), { rev: true });
  return hydrateOrders(ids);
}

async function getAllOrders(limit = 1000) {
  await expireDueOrders(200);
  const ids = await store.zrange('orders:all', 0, Math.max(0, limit - 1), { rev: true });
  return hydrateOrders(ids);
}

module.exports = {
  STATUS,
  getOrder,
  getOrderByCode,
  createOrder,
  markOrderPaid,
  markOrderExpired,
  setOrderStatus,
  findOrderForCallback,
  expireDueOrders,
  getUserOrders,
  getAllOrders,
  hydrateOrders,
};
