require('dotenv').config({ quiet: true });

const readline = require('readline');
const config = require('../src/lib/config');
const { useUpstash } = require('../src/lib/store');
const { getUserByEmail, createUser, updateUser, listUsers } = require('../src/lib/users');
const { hashPassword } = require('../src/lib/crypto');

function argValue(name) {
  const exact = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (exact) return exact.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
    return process.argv[index + 1];
  }
  return undefined;
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (text) => {
        if (text.includes(question)) rl.output.write(text);
        else rl.output.write('*');
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

function randomPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const seed = require('crypto').randomBytes(20);
  let out = '';
  for (let i = 0; i < 16; i += 1) out += alphabet[seed[i] % alphabet.length];
  return `${out}9!`;
}

async function main() {
  let email = argValue('email') || process.env.ADMIN_EMAIL || '';
  let name = argValue('name') || process.env.ADMIN_NAME || 'Administrator';
  let password = argValue('password') || process.env.ADMIN_PASSWORD || '';

  if (!process.argv.includes('--yes')) {
    if (!email) email = await ask('Email admin: ');
    if (!email) throw new Error('Email wajib diisi.');
    name = (await ask(`Nama admin [${name}]: `)) || name;
    if (!password) password = await ask('Password admin (kosongkan untuk generate): ', { hidden: true });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`Format email tidak valid: ${email}`);
  }
  if (!password) password = randomPassword();
  if (password.length < 8) {
    throw new Error('Password minimal 8 karakter.');
  }

  const normalized = email.trim().toLowerCase();
  let user = await getUserByEmail(normalized);
  const existed = Boolean(user);
  let apiKey;

  if (user) {
    user = await updateUser(user.id, {
      role: 'admin',
      status: 'active',
      name: name || user.name,
      passwordHash: hashPassword(password),
    });
    apiKey = user.apiKey;
  } else {
    user = await createUser({
      name: name || 'Administrator',
      email: normalized,
      password,
      role: 'admin',
    });
    apiKey = user.apiKey;
  }

  const admins = (await listUsers()).filter((item) => item.role === 'admin');

  console.log('');
  console.log(`Admin ${existed ? 'diperbarui' : 'dibuat'}:`);
  console.log(`  Email    : ${user.email}`);
  console.log(`  Password : ${password}`);
  console.log(`  Nama     : ${user.name}`);
  console.log(`  API key  : ${apiKey}`);
  console.log(`  Login    : ${config.appUrl || 'http://localhost:3000'}/login`);
  console.log('');
  console.log(`Total admin: ${admins.length}`);
  for (const item of admins) {
    console.log(`  - ${item.email} (${item.status})`);
  }
  if (!useUpstash) {
    console.log('');
    console.log('PERINGATAN: UPSTASH_REDIS_REST_URL/TOKEN belum diatur, akun hanya dibuat di memori dan akan hilang.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\nGagal: ${error.message}`);
    process.exit(1);
  });
