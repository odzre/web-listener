const { store } = require('./store');
const { hashPassword, generateApiKey } = require('./crypto');
const { uuid } = require('./ids');
const config = require('./config');

const USERS_SET = 'users';

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

async function getUser(id) {
  if (!id) return null;
  const raw = await store.get(`user:${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function getUserByEmail(email) {
  const id = await store.get(`user:email:${String(email || '').trim().toLowerCase()}`);
  return id ? getUser(id) : null;
}

async function getUserByApiKey(apiKey) {
  if (!apiKey) return null;
  const id = await store.get(`apikey:${apiKey}`);
  return id ? getUser(id) : null;
}

async function createUser({ name, email, password, role = 'user' }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();

  // Kunci unik per email supaya pembuatan akun paralel tidak menghasilkan duplikat.
  const lockKey = `user:email:${normalizedEmail}`;
  const lock = await store.set(lockKey, 'pending', { nx: true });
  if (lock === null) {
    const error = new Error('Email sudah terdaftar.');
    error.code = 'EMAIL_EXISTS';
    throw error;
  }

  const existing = await getUserByEmail(normalizedEmail);
  if (existing) {
    const error = new Error('Email sudah terdaftar.');
    error.code = 'EMAIL_EXISTS';
    throw error;
  }

  let apiKey = generateApiKey();
  let guard = 0;
  while (await store.get(`apikey:${apiKey}`)) {
    apiKey = generateApiKey();
    guard += 1;
    if (guard > 5) throw new Error('Gagal membuat API key.');
  }

  const now = new Date().toISOString();
  const user = {
    id: uuid(),
    name: String(name || '').trim() || 'Pengguna',
    email: normalizedEmail,
    passwordHash: hashPassword(password),
    role,
    apiKey,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  await Promise.all([
    store.set(`user:${user.id}`, JSON.stringify(user)),
    store.set(lockKey, user.id),
    store.set(`apikey:${apiKey}`, user.id),
    store.sadd(USERS_SET, user.id),
  ]);

  return user;
}

async function updateUser(id, patch) {
  const current = await getUser(id);
  if (!current) throw new Error('Pengguna tidak ditemukan.');

  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };

  if (patch.email && patch.email.toLowerCase() !== current.email) {
    const email = patch.email.trim().toLowerCase();
    const owner = await store.get(`user:email:${email}`);
    if (owner && owner !== id) {
      const error = new Error('Email sudah digunakan.');
      error.code = 'EMAIL_EXISTS';
      throw error;
    }
    next.email = email;
    await store.del(`user:email:${current.email}`);
    await store.set(`user:email:${email}`, id);
  }

  if (patch.apiKey && patch.apiKey !== current.apiKey) {
    await store.del(`apikey:${current.apiKey}`);
    await store.set(`apikey:${patch.apiKey}`, id);
  }

  await store.set(`user:${id}`, JSON.stringify(next));
  return next;
}

async function rotateApiKey(id) {
  let apiKey = generateApiKey();
  let guard = 0;
  while (await store.get(`apikey:${apiKey}`)) {
    apiKey = generateApiKey();
    guard += 1;
    if (guard > 5) throw new Error('Gagal membuat API key.');
  }
  return updateUser(id, { apiKey });
}

async function listUsers() {
  const ids = await store.smembers(USERS_SET);
  if (!ids.length) return [];
  const values = await store.mget(...ids.map((id) => `user:${id}`));
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

async function ensureAdmin() {
  let admin = await getUserByEmail(config.adminEmail);
  if (admin) {
    if (admin.role !== 'admin') {
      admin = await updateUser(admin.id, { role: 'admin' });
    }
    return admin;
  }

  admin = await createUser({
    name: config.adminName,
    email: config.adminEmail,
    password: config.adminPassword,
    role: 'admin',
  });
  return admin;
}

module.exports = {
  USERS_SET,
  publicUser,
  getUser,
  getUserByEmail,
  getUserByApiKey,
  createUser,
  updateUser,
  rotateApiKey,
  listUsers,
  ensureAdmin,
};
