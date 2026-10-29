const express = require('express');
const rateLimit = require('express-rate-limit');
const { asyncHandler, isEmail } = require('../lib/http');
const { getUserByEmail, createUser } = require('../lib/users');
const { verifyPassword } = require('../lib/crypto');
const { createSession, destroySession, setFlash } = require('../lib/auth');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: { trustProxy: false },
  handler: (req, res) => {
    res.status(429).render('error', {
      ...res.locals,
      pageTitle: 'Terlalu banyak percobaan',
      statusCode: 429,
      message: 'Terlalu banyak percobaan. Silakan tunggu 15 menit lalu coba lagi.',
    });
  },
});

function safeNext(value) {
  if (!value || typeof value !== 'string') return '';
  if (!value.startsWith('/') || value.startsWith('//')) return '';
  return value;
}

router.get('/login', (req, res) => {
  if (res.locals.user) return res.redirect(res.locals.user.role === 'admin' ? '/admin' : '/dashboard');
  return res.render('auth/login', {
    ...res.locals,
    pageTitle: `Masuk — ${res.locals.site.siteName}`,
    metaDescription: 'Masuk ke dashboard NotiPay.',
    next: safeNext(req.query.next),
    form: {},
  });
});

router.post('/login', limiter, asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const next = safeNext(req.body.next);

  if (!isEmail(email) || !password) {
    setFlash(res, 'danger', 'Email dan password wajib diisi dengan benar.');
    return res.redirect('/login');
  }

  const user = await getUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    setFlash(res, 'danger', 'Email atau password salah.');
    return res.redirect('/login');
  }

  if (user.status !== 'active') {
    setFlash(res, 'danger', 'Akun Anda sedang ditangguhkan. Hubungi administrator.');
    return res.redirect('/login');
  }

  await createSession(res, user.id);
  if (next) return res.redirect(next);
  return res.redirect(user.role === 'admin' ? '/admin' : '/dashboard');
}));

router.get('/register', (req, res) => {
  if (res.locals.user) return res.redirect('/dashboard');
  if (!res.locals.site.registrationOpen) {
    return res.status(403).render('error', {
      ...res.locals,
      pageTitle: 'Pendaftaran ditutup',
      statusCode: 403,
      message: 'Pendaftaran akun baru sedang ditutup. Silakan hubungi administrator.',
    });
  }
  return res.render('auth/register', {
    ...res.locals,
    pageTitle: `Daftar — ${res.locals.site.siteName}`,
    metaDescription: 'Buat akun NotiPay baru.',
    form: {},
  });
});

router.post('/register', limiter, asyncHandler(async (req, res) => {
  if (!res.locals.site.registrationOpen) {
    setFlash(res, 'danger', 'Pendaftaran sedang ditutup.');
    return res.redirect('/register');
  }

  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const confirm = String(req.body.confirm_password || '');

  if (name.length < 2) {
    setFlash(res, 'danger', 'Nama minimal 2 karakter.');
    return res.redirect('/register');
  }
  if (!isEmail(email)) {
    setFlash(res, 'danger', 'Format email tidak valid.');
    return res.redirect('/register');
  }
  if (password.length < 8) {
    setFlash(res, 'danger', 'Password minimal 8 karakter.');
    return res.redirect('/register');
  }
  if (password !== confirm) {
    setFlash(res, 'danger', 'Konfirmasi password tidak cocok.');
    return res.redirect('/register');
  }

  try {
    const user = await createUser({ name, email, password, role: 'user' });
    await createSession(res, user.id);
    setFlash(res, 'success', 'Akun berhasil dibuat. Selamat datang.');
    return res.redirect('/dashboard');
  } catch (error) {
    if (error.code === 'EMAIL_EXISTS') {
      setFlash(res, 'danger', 'Email sudah terdaftar. Silakan masuk.');
      return res.redirect('/login');
    }
    throw error;
  }
}));

router.post('/logout', asyncHandler(async (req, res) => {
  await destroySession(req, res);
  setFlash(res, 'success', 'Anda telah keluar.');
  return res.redirect('/');
}));

module.exports = router;
