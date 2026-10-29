const app = require('./app');
const config = require('./lib/config');
const { useUpstash } = require('./lib/store');

app.listen(config.port, () => {
  console.log(`[notipay] listening on http://localhost:${config.port}`);
  if (!useUpstash) {
    console.warn('[notipay] UPSTASH_REDIS_REST_URL/TOKEN belum diatur. Memakai penyimpanan memori sementara.');
  }
  if (config.isProduction && config.adminPassword === 'Admin#12345') {
    console.warn('[notipay] Ganti ADMIN_PASSWORD sebelum production.');
  }
});
