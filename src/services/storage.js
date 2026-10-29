const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { put, del } = require('@vercel/blob');
const config = require('../lib/config');

function safeName(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin';
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
}

async function uploadFile(buffer, filename, contentType, prefix = 'files') {
  if (!buffer || !buffer.length) throw new Error('File kosong.');

  if (config.blobToken) {
    const result = await put(`${prefix}/${safeName(filename)}`, buffer, {
      access: 'public',
      contentType: contentType || 'application/octet-stream',
      addRandomSuffix: true,
      multipart: buffer.length > 4 * 1024 * 1024,
    });
    return { url: result.url, pathname: result.pathname, storage: 'blob' };
  }

  if (config.isVercel) {
    throw new Error('BLOB_READ_WRITE_TOKEN belum diatur. File tidak dapat disimpan permanen di Vercel.');
  }

  const dir = path.join(process.cwd(), 'public', 'assets', 'uploads');
  await fs.mkdir(dir, { recursive: true });
  const name = safeName(filename);
  await fs.writeFile(path.join(dir, name), buffer);
  return { url: `/assets/uploads/${name}`, pathname: `uploads/${name}`, storage: 'local' };
}

async function uploadImageOrDataUrl(buffer, filename, contentType) {
  if (!buffer || !buffer.length) return '';
  if (config.blobToken) {
    const result = await uploadFile(buffer, filename, contentType, 'branding');
    return result.url;
  }
  if (buffer.length > 500 * 1024) {
    throw new Error('Ukuran gambar maksimal 500 KB jika Vercel Blob belum dikonfigurasi.');
  }
  return `data:${contentType || 'image/png'};base64,${buffer.toString('base64')}`;
}

async function deleteStoredFile(url) {
  if (!url || !config.blobToken) return;
  if (!/^https?:\/\//.test(url)) return;
  try {
    await del(url);
  } catch {
    // Ignore remote deletion failures so the admin flow is not blocked.
  }
}

module.exports = {
  uploadFile,
  uploadImageOrDataUrl,
  deleteStoredFile,
};
