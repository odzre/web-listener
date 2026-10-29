const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const roots = ['src', 'api', 'scripts', 'tests', 'public/assets/js'];
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      if (entry.name === 'blob-client.js') continue;
      files.push(full);
    }
  }
}

for (const root of roots) {
  if (fs.existsSync(root)) walk(root);
}

for (const file of files) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

console.log(`Syntax OK (${files.length} files)`);
