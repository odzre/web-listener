const crypto = require('crypto');
const { store } = require('./store');
const config = require('./config');

const SETTINGS_KEY = 'settings';

const DEFAULTS = {
  siteName: 'NotiPay',
  siteTitle: 'NotiPay — Notification Payment Gateway',
  siteDescription: 'Ubah notifikasi pembayaran menjadi status transaksi otomatis untuk Malaysia dan Indonesia.',
  logoUrl: '',
  faviconUrl: '',
  supportEmail: 'support@notipay.local',
  announcement: '',
  registrationOpen: config.registrationOpenDefault,
  maintenance: false,
  callbackSecret: '',
  apiDocsUrl: '/docs',
  footerNote: 'NotiPay memproses notifikasi pembayaran secara otomatis. Selalu verifikasi transaksi penting melalui dashboard.',
};

function defaultSettings() {
  return {
    ...DEFAULTS,
    callbackSecret: `np_cb_${crypto.randomBytes(24).toString('hex')}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function getSettings() {
  const raw = await store.get(SETTINGS_KEY);
  if (!raw) {
    const settings = defaultSettings();
    await store.set(SETTINGS_KEY, JSON.stringify(settings));
    return settings;
  }
  try {
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return defaultSettings();
  }
}

async function updateSettings(patch) {
  const current = await getSettings();
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await store.set(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

function publicSettings(settings) {
  const { callbackSecret, ...safe } = settings;
  return safe;
}

module.exports = {
  getSettings,
  updateSettings,
  publicSettings,
};
