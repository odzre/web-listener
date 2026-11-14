const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseNotificationAmount,
  parseAmountInput,
  formatUnits,
  normalizeRegion,
  isIncomingNotification,
} = require('../src/lib/money');

test('parses Malaysian notification amounts', () => {
  assert.deepEqual(parseNotificationAmount('RM116.00 diterima untuk -'), {
    region: 'MY',
    amount: 11600,
    raw: 'RM116.00',
  });
  assert.equal(parseNotificationAmount('Bayaran RM1,000.50 berjaya').amount, 100050);
});

test('parses Indonesian notification amounts', () => {
  assert.equal(parseNotificationAmount('Rp116.000 diterima').amount, 116000);
  assert.equal(parseNotificationAmount('IDR 1.000.000 masuk').amount, 1000000);
  assert.equal(parseNotificationAmount('Transfer Rp 25.500 sukses').amount, 25500);
});

test('parses Philippine peso notification amounts', () => {
  assert.equal(parseNotificationAmount('You received ₱4,250.00 from +639550747407').amount, 425000);
  assert.equal(parseNotificationAmount('Money received PHP 250.50').amount, 25050);
  assert.equal(parseNotificationAmount('₱1,000.00 credited to your account').amount, 100000);
  assert.equal(parseNotificationAmount('PHP 1,000.00').region, 'PH');
});

test('parses a full Maya incoming notification', () => {
  const text = 'Money received ↙️ You received ₱4,250.00 from +639550747407';
  const parsed = parseNotificationAmount(text);
  assert.deepEqual(parsed.region, 'PH');
  assert.equal(parsed.amount, 425000);
  assert.equal(isIncomingNotification(text), true);
});

test('ignores outgoing payment notifications', () => {
  assert.equal(isIncomingNotification('You sent ₱4,250.00 to +639550747407'), false);
  assert.equal(isIncomingNotification('You received ₱4,250.00 from +639550747407'), true);
});

test('returns null for notifications without an amount', () => {
  assert.equal(parseNotificationAmount('Pembayaran berhasil'), null);
});

test('normalizes create-order amounts to the smallest unit', () => {
  assert.equal(parseAmountInput('MY', 1), 100);
  assert.equal(parseAmountInput('MY', '116.00'), 11600);
  assert.equal(parseAmountInput('ID', 1000), 1000);
  assert.equal(parseAmountInput('ID', '1.000'), 1000);
  assert.equal(parseAmountInput('ID', '1.000.000'), 1000000);
  assert.equal(parseAmountInput('PH', 4250), 425000);
  assert.equal(parseAmountInput('PH', '4,250.00'), 425000);
});

test('formats regional currency', () => {
  assert.equal(formatUnits('MY', 11600), 'RM116.00');
  assert.equal(formatUnits('ID', 1000), 'Rp1.000');
  assert.equal(formatUnits('PH', 425000), '₱4,250.00');
  assert.equal(normalizeRegion('my'), 'MY');
  assert.equal(normalizeRegion('ph'), 'PH');
  assert.equal(normalizeRegion('SG'), null);
});
