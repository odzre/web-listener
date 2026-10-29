const isVercel = Boolean(process.env.VERCEL);
const isProduction = process.env.NODE_ENV === 'production' || isVercel;

module.exports = {
  isVercel,
  isProduction,
  port: Number(process.env.PORT || 3000),
  appUrl: (process.env.APP_URL || '').replace(/\/$/, ''),
  sessionCookie: 'np_session',
  csrfCookie: 'np_csrf',
  sessionTtlSeconds: 60 * 60 * 24 * 7,
  adminEmail: (process.env.ADMIN_EMAIL || 'admin@notipay.local').toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || 'Admin#12345',
  adminName: process.env.ADMIN_NAME || 'Administrator',
  upstashUrl: process.env.UPSTASH_REDIS_REST_URL || '',
  upstashToken: process.env.UPSTASH_REDIS_REST_TOKEN || '',
  blobToken: process.env.BLOB_READ_WRITE_TOKEN || '',
  cronSecret: process.env.CRON_SECRET || '',
  registrationOpenDefault: process.env.REGISTRATION_OPEN !== 'false',
};
