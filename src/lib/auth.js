const { store } = require('./store');
const config = require('./config');
const { sha256, randomToken, safeEqual } = require('./crypto');
const { getUser } = require('./users');

const FLASH_COOKIE = 'np_flash';

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    maxAge,
  };
}

async function createSession(res, userId) {
  const token = randomToken(32);
  const key = `session:${sha256(token)}`;
  await store.set(key, JSON.stringify({ userId, createdAt: Date.now() }), {
    ex: config.sessionTtlSeconds,
  });
  res.cookie(config.sessionCookie, token, cookieOptions(config.sessionTtlSeconds * 1000));
  return token;
}

async function destroySession(req, res) {
  const token = req.cookies?.[config.sessionCookie];
  if (token) await store.del(`session:${sha256(token)}`);
  res.clearCookie(config.sessionCookie, { path: '/' });
}

async function getSessionUser(req) {
  const token = req.cookies?.[config.sessionCookie];
  if (!token) return null;
  const raw = await store.get(`session:${sha256(token)}`);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    const user = await getUser(session.userId);
    if (!user || user.status !== 'active') return null;
    return user;
  } catch {
    return null;
  }
}

function ensureCsrf(req, res) {
  let token = req.cookies?.[config.csrfCookie];
  if (!token) {
    token = randomToken(24);
    res.cookie(config.csrfCookie, token, cookieOptions(60 * 60 * 24 * 30));
  }
  return token;
}

function verifyCsrf(req) {
  const cookieToken = req.cookies?.[config.csrfCookie];
  const bodyToken = req.body?._csrf;
  if (!cookieToken || !bodyToken) return false;
  return safeEqual(cookieToken, bodyToken);
}

function setFlash(res, type, message) {
  const payload = JSON.stringify({ type, message });
  res.cookie(FLASH_COOKIE, payload, {
    ...cookieOptions(60 * 1000),
    httpOnly: false,
  });
}

function readFlash(req, res) {
  const raw = req.cookies?.[FLASH_COOKIE];
  if (!raw) return null;
  res.clearCookie(FLASH_COOKIE, { path: '/' });
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.message) return null;
    return parsed;
  } catch {
    return null;
  }
}

function describeClient(req) {
  return {
    ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '',
    userAgent: (req.headers['user-agent'] || '').slice(0, 300),
  };
}

module.exports = {
  createSession,
  destroySession,
  getSessionUser,
  ensureCsrf,
  verifyCsrf,
  setFlash,
  readFlash,
  describeClient,
  cookieOptions,
};
