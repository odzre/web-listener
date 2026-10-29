const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseNotificationAmount,
  parseAmountInput,
  formatUnits,
  normalizeRegion,
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

test('returns null for notifications without an amount', () => {
  assert.equal(parseNotificationAmount('Pembayaran berhasil'), null);
});

test('normalizes create-order amounts to the smallest unit', () => {
  assert.equal(parseAmountInput('MY', 1), 100);
  assert.equal(parseAmountInput('MY', '116.00'), 11600);
  assert.equal(parseAmountInput('ID', 1000), 1000);
  assert.equal(parseAmountInput('ID', '1.000'), 1000);
  assert.equal(parseAmountInput('ID', '1.000.000'), 1000000);
});

test('formats regional currency', () => {
  assert.equal(formatUnits('MY', 11600), 'RM116.00');
  assert.equal(formatUnits('ID', 1000), 'Rp1.000');
  assert.equal(normalizeRegion('my'), 'MY');
  assert.equal(normalizeRegion('SG'), null);
});
