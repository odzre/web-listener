const test = require('node:test');
const assert = require('node:assert/strict');
const { createUser } = require('../src/lib/users');
const {
  createOrder,
  getOrder,
  markOrderExpired,
  findOrderForCallback,
} = require('../src/services/orders');
const { processNotificationCallback } = require('../src/services/callbacks');

let counter = 0;

async function makeUser() {
  counter += 1;
  return createUser({
    name: `Merchant ${counter}`,
    email: `merchant-${Date.now()}-${counter}@test.local`,
    password: 'password123',
  });
}

test('matches a Malaysian notification to the oldest pending order', async () => {
  const user = await makeUser();
  const order = await createOrder({
    user,
    region: 'MY',
    amount: 11600,
    expiredMinutes: 5,
  });

  const result = await processNotificationCallback({
    user,
    packageName: 'id.dana',
    title: 'DANA',
    text: 'RM116.00 diterima untuk -',
    deviceId: 'test-device',
    ip: '127.0.0.1',
  });

  assert.equal(result.callback.status, 'matched');
  assert.equal(result.order.id, order.id);
  assert.equal(result.order.status, 'success');
  const saved = await getOrder(order.id);
  assert.equal(saved.status, 'success');
  assert.equal(saved.callbackId, result.callback.id);
});

test('matches an Indonesian notification with dot thousand separators', async () => {
  const user = await makeUser();
  const order = await createOrder({
    user,
    region: 'ID',
    amount: 116000,
    expiredMinutes: 5,
  });

  const result = await processNotificationCallback({
    user,
    packageName: 'com.gojek.app',
    title: 'GoPay',
    text: 'Rp116.000 diterima',
  });

  assert.equal(result.callback.status, 'matched');
  assert.equal(result.order.id, order.id);
});

test('does not match an order belonging to another merchant', async () => {
  const owner = await makeUser();
  const other = await makeUser();
  await createOrder({
    user: owner,
    region: 'MY',
    amount: 2500,
    expiredMinutes: 5,
  });

  const result = await processNotificationCallback({
    user: other,
    packageName: 'id.dana',
    title: 'DANA',
    text: 'RM25.00 diterima',
  });

  assert.equal(result.callback.status, 'unmatched');
  assert.equal(result.order, null);
});

test('expired orders are not matched', async () => {
  const user = await makeUser();
  const order = await createOrder({
    user,
    region: 'MY',
    amount: 7700,
    expiredMinutes: 5,
  });
  await markOrderExpired(order.id);

  const match = await findOrderForCallback({
    userId: user.id,
    region: 'MY',
    amount: 7700,
  });
  assert.equal(match, null);

  const result = await processNotificationCallback({
    user,
    packageName: 'id.dana',
    title: 'DANA',
    text: 'RM77.00 diterima',
  });
  assert.equal(result.callback.status, 'unmatched');
});

test('matches a Maya peso notification to a Philippines order', async () => {
  const user = await makeUser();
  const order = await createOrder({
    user,
    region: 'PH',
    amount: 425000,
    expiredMinutes: 5,
  });

  const result = await processNotificationCallback({
    user,
    packageName: 'com.maya.ph',
    title: 'Maya',
    text: 'Money received · You received ₱4,250.00 from +639550747407',
    deviceId: 'android-ph',
  });

  assert.equal(result.callback.status, 'matched');
  assert.equal(result.order.id, order.id);
  assert.equal(result.order.formattedAmount, '₱4,250.00');
});

test('marks outgoing peso notifications as ignored', async () => {
  const user = await makeUser();
  await createOrder({
    user,
    region: 'PH',
    amount: 425000,
    expiredMinutes: 5,
  });

  const result = await processNotificationCallback({
    user,
    packageName: 'com.maya.ph',
    title: 'Maya',
    text: 'You sent ₱4,250.00 to +639550747407',
  });

  assert.equal(result.callback.status, 'ignored');
  assert.equal(result.order, null);
});

test('notification without an amount is logged as unmatched', async () => {
  const user = await makeUser();
  const result = await processNotificationCallback({
    user,
    packageName: 'com.example.app',
    title: 'Promo',
    text: 'Promo cashback 20% untuk Anda',
  });
  assert.equal(result.callback.status, 'unmatched');
  assert.equal(result.callback.parsed, null);
});
