require('dotenv').config({ quiet: true });

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const multer = require('multer');
const rateLimit = require('express-rate-limit');

const config = require('./lib/config');
const { getSettings, publicSettings } = require('./lib/settings');
const { getSessionUser, ensureCsrf, verifyCsrf, readFlash, setFlash } = require('./lib/auth');
const { ensureAdmin, publicUser } = require('./lib/users');
const { ensureBundledApp } = require('./services/apps');
const { formatUnits } = require('./lib/money');
const { formatDate, formatDateTime, formatCountdown } = require('./lib/dates');
const { maskKey } = require('./lib/crypto');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: config.isProduction ? '7d' : 0,
  fallthrough: true,
}));

app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

const multipart = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024, files: 5 },
});
app.use((req, res, next) => {
  if (!req.is('multipart/form-data')) return next();
  return multipart.any()(req, res, next);
});

let bootstrapPromise = null;
app.use((req, res, next) => {
  if (!bootstrapPromise) {
    bootstrapPromise = Promise.all([ensureAdmin(), ensureBundledApp()]).catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }
  bootstrapPromise.then(() => next()).catch(next);
});

app.use(async (req, res, next) => {
  try {
    const [settings, user] = await Promise.all([
      getSettings(),
      getSessionUser(req),
    ]);
    const safeUser = publicUser(user);
    const isAdmin = user?.role === 'admin';
    const baseUrl = config.appUrl || `${req.protocol}://${req.get('host')}`;
    const csrfToken = ensureCsrf(req, res);
    const flash = readFlash(req, res);

    res.locals.site = isAdmin ? settings : publicSettings(settings);
    res.locals.baseUrl = baseUrl;
    res.locals.user = safeUser;
    res.locals.isAdmin = isAdmin;
    res.locals.isAuth = Boolean(safeUser);
    res.locals.csrf = csrfToken;
    res.locals.flash = flash;
    res.locals.currentPath = req.path;
    res.locals.currentYear = new Date().getFullYear();
    res.locals.callbackUrl = `${baseUrl}/api/v1/callback`;
    res.locals.helpers = {
      money: formatUnits,
      date: formatDate,
      datetime: formatDateTime,
      countdown: formatCountdown,
      maskKey,
      statusLabel: (status) => ({
        pending: 'Pending',
        success: 'Sukses',
        expired: 'Expired',
        matched: 'Matched',
        matched_manual: 'Manual',
        unmatched: 'Unmatched',
        duplicate: 'Duplikat',
        busy: 'Diproses',
        ignored: 'Diabaikan',
        active: 'Aktif',
        suspended: 'Ditangguhkan',
        admin: 'Admin',
        user: 'User',
      }[status] || status),
      statusClass: (status) => ({
        pending: 'warning',
        success: 'success',
        expired: 'secondary',
        matched: 'success',
        matched_manual: 'info',
        unmatched: 'danger',
        duplicate: 'secondary',
        busy: 'warning',
        ignored: 'secondary',
        active: 'success',
        suspended: 'danger',
      }[status] || 'secondary'),
      initials: (value) => String(value || 'NP').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(),
    };

    if (req.method === 'POST' && !req.path.startsWith('/api/') && req.path !== '/admin/apps/blob-token' && !verifyCsrf(req)) {
      res.status(403).render('error', {
        ...res.locals,
        pageTitle: 'Permintaan ditolak',
        statusCode: 403,
        message: 'Token keamanan tidak valid. Muat ulang halaman lalu coba lagi.',
      });
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: { trustProxy: false },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: { trustProxy: false },
});

app.use('/api/v1', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
}, apiLimiter);

app.use((req, res, next) => {
  res.locals.setFlash = (type, message) => setFlash(res, type, message);
  next();
});

app.use('/', require('./routes/public'));
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/user'));
app.use('/', require('./routes/admin'));
app.use('/api/v1', require('./routes/api'));
app.use('/api', require('./routes/callback'));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'Endpoint tidak ditemukan.' });
  }
  return res.status(404).render('error', {
    ...res.locals,
    pageTitle: 'Halaman tidak ditemukan',
    statusCode: 404,
    message: 'Halaman yang Anda cari tidak tersedia atau sudah dipindahkan.',
  });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('[notipay]', error);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({
      success: false,
      message: config.isProduction ? 'Terjadi kesalahan pada server.' : error.message,
    });
  }
  const fallbackSite = {
    siteName: 'NotiPay',
    siteTitle: 'NotiPay — Notification Payment Gateway',
    siteDescription: 'Notification payment gateway.',
    logoUrl: '',
    faviconUrl: '',
    supportEmail: 'support@notipay.local',
    footerNote: '',
    announcement: '',
    registrationOpen: true,
  };
  return res.status(500).render('error', {
    ...res.locals,
    site: res.locals.site || fallbackSite,
    isAuth: Boolean(res.locals.user),
    isAdmin: Boolean(res.locals.isAdmin),
    currentYear: new Date().getFullYear(),
    pageTitle: 'Terjadi kesalahan',
    statusCode: 500,
    message: config.isProduction
      ? 'Terjadi kesalahan pada server. Silakan coba beberapa saat lagi.'
      : error.message,
  });
});

module.exports = app;
