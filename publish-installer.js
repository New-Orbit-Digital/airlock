// Publishes the newest dist/*.exe so the site's "Download for Windows" button works:
//   1. uploads it to the R2 bucket "airlock-downloads" (stable key + versioned key)
//   2. deploys the download worker and reads its URL from wrangler's output
//   3. writes the /download/Airlock-Setup.exe redirect into site/_redirects
//   4. rebuilds web/ and redeploys the Pages site
// Run:  npm run publish:installer
// First time only: enable R2 in the Cloudflare dashboard (R2 Object Storage → Get started; it asks for a
// payment method but the free tier covers this), then:  npx wrangler r2 bucket create airlock-downloads
const { execSync } = require('child_process');
const fs = require('fs'), path = require('path');

const dist = path.join(__dirname, 'dist');
const exe = fs.existsSync(dist) && fs.readdirSync(dist).filter((f) => /^Airlock Setup .*\.exe$/.test(f))
  .map((f) => ({ f, t: fs.statSync(path.join(dist, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
if (!exe) { console.error('No "Airlock Setup x.y.z.exe" in dist/. Run npm run dist first.'); process.exit(1); }
const src = path.join(dist, exe.f);
const version = require('./package.json').version;
const sh = (cmd, capture = false) => {
  console.log('> ' + cmd);
  return execSync(cmd, { cwd: __dirname, stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8' });
};

console.log(`\nPublishing ${exe.f} (${(fs.statSync(src).size / 1048576).toFixed(0)} MB)\n`);
// R2 upload with retries: the API occasionally answers 524 on a 78 MB put. The stable key must succeed
// (it is what the site's download button serves); the versioned archive copy is best-effort.
const put = (key, attempts) => {
  for (let i = 1; i <= attempts; i++) {
    try { sh(`npx wrangler r2 object put "airlock-downloads/${key}" --file "${src}" --content-type application/octet-stream --remote`); return true; }
    catch (e) { console.warn(`upload of ${key} failed (attempt ${i}/${attempts})`); }
  }
  return false;
};
if (!put('Airlock-Setup.exe', 3)) { console.error('Could not upload the installer to R2.'); process.exit(1); }
if (!put(`Airlock-Setup-${version}.exe`, 2)) console.warn('Versioned copy skipped; the download link is unaffected.');

const out = sh('npx wrangler deploy -c download-worker/wrangler.jsonc', true);
process.stdout.write(out);
const m = out.match(/https:\/\/airlock-download\.[\w-]+\.workers\.dev/);
if (!m) { console.error('\nCould not find the worker URL in wrangler output; check above and set site/_redirects by hand.'); process.exit(1); }
const workerUrl = m[0];

const redirectsPath = path.join(__dirname, 'site', '_redirects');
const rule = `/download/Airlock-Setup.exe ${workerUrl}/Airlock-Setup.exe 302`;
let redirects = fs.readFileSync(redirectsPath, 'utf8').split(/\r?\n/).filter((l) => !/^#?\s*\/download\/Airlock-Setup\.exe /.test(l));
redirects = redirects.filter((l, i, a) => !(l.startsWith('# Windows installer') || l.startsWith('# After `npm run publish')));
redirects.push('# Windows installer lives in R2 behind the airlock-download worker (Pages caps files at 25 MB).', rule, '');
fs.writeFileSync(redirectsPath, redirects.join('\n'));
console.log(`\nWrote redirect: ${rule}`);

sh('node build-web.js');
sh('npx wrangler pages deploy web --project-name airlock --branch main --commit-dirty=true');
console.log('\nDone. https://airlock.neworbitdigital.com/download/ now serves the installer.');
