// Assembles web/ for Cloudflare Pages:
//   web/            <- site/  (landing page, /privacy, /terms, /download, root sw + _redirects)
//   web/app/        <- the app files (index.html, renderer, store, config, sw, manifest, icons, vendor)
const fs = require('fs'), path = require('path');
const out = path.join(__dirname, 'web');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(__dirname, 'site'), out, { recursive: true });
const app = path.join(out, 'app');
fs.mkdirSync(path.join(app, 'vendor'), { recursive: true });
for (const f of ['index.html', 'renderer.js', 'store.js', 'config.js', 'manifest.json', 'sw.js', 'icon.svg', 'icon.png', 'icon-180.png', 'vendor/supabase.js'])
  fs.copyFileSync(path.join(__dirname, f), path.join(app, f));
console.log('web/ ready');
