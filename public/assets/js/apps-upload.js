(function () {
  'use strict';
  const form = document.getElementById('appUploadForm');
  if (!form || form.getAttribute('data-blob') !== '1') return;
  const fileInput = document.getElementById('apkFile');
  const button = document.getElementById('apkUploadBtn');
  const status = document.getElementById('apkUploadStatus');
  if (!fileInput || !button || !status || !window.NotiPayBlob) return;

  form.addEventListener('submit', async function (event) {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    event.preventDefault();

    const csrf = form.getAttribute('data-csrf') || '';
    const version = form.querySelector('input[name="version"]').value.trim();
    const notes = form.querySelector('textarea[name="notes"]').value.trim();
    button.disabled = true;
    status.className = 'upload-status working';
    status.textContent = 'Meminta token upload...';

    try {
      const blob = await window.NotiPayBlob.upload(
        'apk/' + Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '-'),
        file,
        {
          access: 'public',
          handleUploadUrl: '/admin/apps/blob-token',
          headers: { 'x-csrf-token': csrf },
          contentType: file.type || 'application/vnd.android.package-archive',
          multipart: true,
          onUploadProgress: function (progress) {
            status.textContent = 'Mengunggah APK... ' + Math.round(progress.percentage || 0) + '%';
          },
        }
      );

      status.textContent = 'Menyimpan metadata...';
      const response = await fetch('/admin/apps/blob-finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          _csrf: csrf,
          url: blob.url,
          version: version,
          notes: notes,
          fileName: file.name,
          size: file.size,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Gagal menyimpan aplikasi.');
      status.className = 'upload-status success';
      status.textContent = 'Upload selesai. Memuat ulang...';
      window.location.href = data.redirect || '/admin/apps';
    } catch (error) {
      status.className = 'upload-status error';
      status.textContent = error.message || 'Upload gagal.';
      button.disabled = false;
    }
  });
})();
