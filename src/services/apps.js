const { store } = require('../lib/store');
const fs = require('fs');
const path = require('path');
const { uuid } = require('../lib/ids');
const config = require('../lib/config');

const APPS_SET = 'apps';

async function getApp(id) {
  if (!id) return null;
  const raw = await store.get(`app:${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function listApps() {
  const ids = await store.smembers(APPS_SET);
  if (!ids.length) return [];
  const values = await store.mget(...ids.map((id) => `app:${id}`));
  return values
    .filter(Boolean)
    .map((raw) => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function getLatestApp() {
  const apps = await listApps();
  return apps.find((app) => app.active) || apps[0] || null;
}

async function createApp({ version, url, notes, fileName, fileSize, contentType }) {
  if (!url) throw new Error('URL aplikasi wajib diisi.');
  const id = uuid();
  const now = new Date().toISOString();
  const app = {
    id,
    version: String(version || '').trim() || `v${new Date().toISOString().slice(0, 10)}`,
    url,
    notes: String(notes || '').slice(0, 4000),
    fileName: String(fileName || '').slice(0, 300),
    fileSize: Number(fileSize) || 0,
    contentType: contentType || 'application/vnd.android.package-archive',
    active: true,
    createdAt: now,
    updatedAt: now,
  };

  const existing = await listApps();
  await Promise.all([
    store.set(`app:${id}`, JSON.stringify(app)),
    store.sadd(APPS_SET, id),
    ...existing
      .filter((item) => item.active)
      .map((item) => store.set(`app:${item.id}`, JSON.stringify({ ...item, active: false, updatedAt: now }))),
  ]);

  return app;
}

async function activateApp(id) {
  const target = await getApp(id);
  if (!target) throw new Error('Aplikasi tidak ditemukan.');
  const apps = await listApps();
  const now = new Date().toISOString();
  await Promise.all(apps.map(async (app) => {
    const next = { ...app, active: app.id === id, updatedAt: now };
    await store.set(`app:${app.id}`, JSON.stringify(next));
  }));
  return getApp(id);
}

async function deleteApp(id) {
  const app = await getApp(id);
  if (!app) return null;
  await store.del(`app:${id}`);
  await store.srem(APPS_SET, id);
  if (app.active) {
    const remaining = await listApps();
    if (remaining.length) await activateApp(remaining[0].id);
  }
  return app;
}

async function ensureBundledApp() {
  const apps = await listApps();
  if (apps.length) return apps[0];
  const filePath = path.join(process.cwd(), 'public', 'assets', 'app', 'notipay-listener.apk');
  let fileSize = 0;
  try {
    fileSize = fs.statSync(filePath).size;
  } catch {
    fileSize = 0;
  }

  let url = '/assets/app/notipay-listener.apk';
  if (config.blobToken) {
    try {
      const { uploadFile } = require('./storage');
      const buffer = fs.readFileSync(filePath);
      const uploaded = await uploadFile(
        buffer,
        'notipay-listener.apk',
        'application/vnd.android.package-archive',
        'apk',
      );
      url = uploaded.url;
      fileSize = buffer.length;
    } catch (error) {
      console.warn('[notipay] Gagal upload APK bawaan ke Vercel Blob:', error.message);
    }
  }

  return createApp({
    version: '1.0.0',
    url,
    notes: 'Build awal: notification listener, filter aplikasi, WorkManager retry, foreground service, dan callback per API key.',
    fileName: 'notipay-listener.apk',
    fileSize,
    contentType: 'application/vnd.android.package-archive',
  });
}

module.exports = {
  APPS_SET,
  ensureBundledApp,
  getApp,
  listApps,
  getLatestApp,
  createApp,
  activateApp,
  deleteApp,
};
