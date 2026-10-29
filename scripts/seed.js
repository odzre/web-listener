require('dotenv').config({ quiet: true });

const config = require('../src/lib/config');
const { ensureAdmin } = require('../src/lib/users');
const { ensureBundledApp } = require('../src/services/apps');
const { useUpstash } = require('../src/lib/store');

(async () => {
  if (!useUpstash) {
    console.log('Upstash belum dikonfigurasi. Seed dijalankan di memori dan akan hilang saat proses selesai.');
  }
  const admin = await ensureAdmin();
  const app = await ensureBundledApp();
  console.log('Admin siap:');
  console.log(`  Email    : ${admin.email}`);
  console.log(`  Password : ${config.adminPassword}`);
  console.log(`  API key  : ${admin.apiKey}`);
  console.log(`Aplikasi : ${app.version} (${app.url})`);
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
