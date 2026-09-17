// End-to-end smoke test of the Electron app against an in-memory fake backend
// (the build sandbox has no egress to supabase.co; the fake emulates auth, RLS and realtime).
//   SMOKE_FAKE=1 xvfb-run npx electron --no-sandbox smoke-test.js
// Uses a throwaway userData dir.
const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

if (!process.env.SMOKE_FAKE) { console.error('This test runs against the fake backend: set SMOKE_FAKE=1'); process.exit(2); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'airlock-'));
app.setPath('userData', tmp);
require('./main.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = Date.now().toString(36);

app.whenReady().then(async () => {
  const fake = 'file://' + path.join(__dirname, 'test', 'fake-supabase.js');
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['file://*/*vendor/supabase.js'] }, (d, cb) => cb({ redirectURL: fake }));
  await sleep(800);
  const win = BrowserWindow.getAllWindows()[0];
  const errors = [];
  win.webContents.on('console-message', (_e, level, msg, line, src) => {
    if (level >= 2 && !/net::|Failed to load resource/.test(msg)) { errors.push(msg); console.log('renderer:', msg, src + ':' + line); }
  });
  await sleep(1500);
  const run = (js) => win.webContents.executeJavaScript(js, true).catch((e) => { console.error('executeJavaScript failed for:', js.slice(0, 120)); throw e; });
  setTimeout(() => { console.log('SMOKE TIMEOUT'); app.exit(4); }, 120000);
  const counts = () => run(`['q1','q2','q3','q4'].map(q => document.querySelectorAll('#'+q+' .task').length)`);
  const checks = {};

  const signInWithCode = async (email, code) => {
    await run(`{ const e = document.querySelector('#lEmail'); e.value = ${JSON.stringify(email)}; document.querySelector('#loginForm').requestSubmit(); }`);
    await sleep(300);
    await run(`{ const c = document.querySelector('#lCode'); c.value = ${JSON.stringify(code)}; c.dispatchEvent(new Event('input')); document.querySelector('#loginForm').requestSubmit(); }`);
    for (let i = 0; i < 20; i++) { await sleep(250); if (await run(`document.querySelector('#login').hidden`)) break; }
  };

  // 1. sign-in: email step → code step; wrong code rejected; right code signs in; desktop hides Google
  checks.loginShown = await run(`!document.querySelector('#login').hidden`);
  checks.googleVisibleOnDesktop = await run(`!document.querySelector('#googleBtn').hidden`);
  await run(`{ const e = document.querySelector('#lEmail'); e.value = 'alice@example.com'; document.querySelector('#loginForm').requestSubmit(); }`);
  await sleep(300);
  checks.codeStepShown = await run(`!document.querySelector('#codeStep').hidden && document.querySelector('#codeSub').textContent.includes('alice@example.com')`);
  await run(`{ const c = document.querySelector('#lCode'); c.value = '000000'; c.dispatchEvent(new Event('input')); document.querySelector('#loginForm').requestSubmit(); }`);
  await sleep(400);
  checks.wrongCodeRejected = await run(`!document.querySelector('#login').hidden && document.querySelector('#lError').textContent`);
  await run(`{ const c = document.querySelector('#lCode'); c.value = '123456'; c.dispatchEvent(new Event('input')); document.querySelector('#loginForm').requestSubmit(); }`);
  for (let i = 0; i < 20; i++) { await sleep(250); if (await run(`document.querySelector('#login').hidden`)) break; }
  checks.signedIn = await run(`document.querySelector('#login').hidden`);
  checks.whoShowsEmail = await run(`document.querySelector('#who').textContent`);
  checks.hintShownWhenEmpty = await run(`!document.querySelector('#hint').hidden`);
  await sleep(800);

  // 2. session persists across a reload
  win.webContents.reload();
  await sleep(2500);
  checks.stayedLoggedIn = await run(`document.querySelector('#login').hidden`);

  // 3. create tasks via capture (spy on audio: each add should ping)
  await run(`window.__plays = 0; HTMLMediaElement.prototype.play = function () { window.__plays++; return Promise.resolve(); }; true;`);
  const type = async (text, imp, urg) => {
    await run(`document.querySelector('#text').value = ${JSON.stringify(text)};
      document.querySelector('#tImportant').setAttribute('aria-pressed', '${imp}');
      document.querySelector('#tUrgent').setAttribute('aria-pressed', '${urg}');
      document.querySelector('#add').click();`);
    await sleep(150);
  };
  await type(`Smoke ${RUN} do #smoke-${RUN}`, true, true);
  await type(`Smoke ${RUN} eliminate #smoke-${RUN} #home`, false, false);
  checks.hintHiddenAfterAdd = await run(`document.querySelector('#hint').hidden`);
  checks.pingOnAdd = await run(`window.__plays === 2 && new Audio('airlock-ping.wav').src.endsWith('/airlock-ping.wav')`);
  await run(`[...document.querySelectorAll('#chips .chip')].find(c => c.textContent.startsWith('#smoke-${RUN}')).click()`);
  await sleep(100);
  checks.createdCounts = await counts();           // expect [1,0,0,1]

  // 4. drag Do → Schedule
  const dnd = await run(`(async () => {
    const card = document.querySelector('#q1 .task'); const id = card.dataset.id; const dt = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const target = document.querySelector('#q2');
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 100));
    const t = window.matrixStore.tasks.find(x => x.id === id); return { important: t.important, urgent: t.urgent };
  })()`);
  checks.dndFlags = dnd;
  checks.afterDndCounts = await counts();            // expect [0,1,0,1]

  // 5. dialog notes + done
  await run(`document.querySelector('#q2 .task').click()`);
  await sleep(100);
  await run(`document.querySelector('#dNotes').value = 'note ${RUN}'; document.querySelector('#dDone').click()`);
  await sleep(200);
  checks.afterDoneCounts = await counts();           // expect [0,0,0,1]

  // 6. queue flushed, backend rows match
  for (let i = 0; i < 20; i++) { await sleep(500); if (await run(`window.matrixStore.status`) === 'synced') break; }
  checks.syncStatus = await run(`window.matrixStore.status`);
  checks.remoteRows = await run(`[...window.__fakeSupabase.rows.values()].filter(r => r.tags.includes('smoke-${RUN}')).map(r => ({ title: r.title, important: r.important, urgent: r.urgent, notes: r.notes, done: r.done }))`);

  // 7. realtime from a second client
  await run(`(async () => {
    const sb2 = window.supabase.createClient();
    await sb2.from('matrix_tasks').insert({ title: 'Realtime ${RUN}', tags: ['smoke-${RUN}'], important: false, urgent: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  })()`);
  let rt = false;
  for (let i = 0; i < 20; i++) { await sleep(300); rt = await run(`[...document.querySelectorAll('#q3 .task .title')].some(t => t.textContent === 'Realtime ${RUN}')`); if (rt) break; }
  checks.realtimeArrived = rt;

  // 7b. circle tick: click draws the check, card lingers ~1.6s, then the task is done. Muted first: no ping.
  await run(`document.querySelector('#showDone').checked = false; document.querySelector('#showDone').dispatchEvent(new Event('change'));`);
  await run(`document.querySelector('#mute').checked = true; document.querySelector('#mute').dispatchEvent(new Event('change')); window.__plays = 0;`);
  await run(`document.querySelector('#q3 .task .tick').click()`);
  checks.mutedTickSilent = await run(`window.__plays === 0 && localStorage.getItem('airlock.mute') === '1'`);
  await run(`document.querySelector('#mute').checked = false; document.querySelector('#mute').dispatchEvent(new Event('change'));`);
  await sleep(400);
  checks.tickLingers = await run(`!!document.querySelector('#q3 .task.leaving .tick.on')`);
  await sleep(1800);
  checks.tickCompleted = await run(`document.querySelectorAll('#q3 .task').length === 0 && window.matrixStore.tasks.some(t => t.title === 'Realtime ${RUN}' && t.done)`);
  // 7c. theme toggle persists
  await run(`document.querySelector('#themeLight').click()`);
  checks.themeLight = await run(`document.documentElement.dataset.theme === 'light' && localStorage.getItem('airlock.theme') === 'light'`);
  await run(`document.querySelector('#themeDark').click()`);
  checks.menuHidesWebOnlyItems = await run(`getComputedStyle(document.querySelector('#installMenu')).display === 'none' && getComputedStyle(document.querySelector('#startupRow')).display !== 'none'`);

  // 8. export contains the tasks
  checks.exportHasTasks = await run(`JSON.parse(window.matrixStore.exportJSON()).tasks.length >= 3`);

  await run(`document.querySelector('#text').focus()`);
  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(__dirname, 'smoke.png'), img.toPNG()));

  // 9. isolation: sign out, sign in as a different user, see nothing of alice's
  await run(`document.querySelector('#signOut').click()`);
  await sleep(500);
  checks.loginShownAfterSignOut = await run(`!document.querySelector('#login').hidden`);
  await signInWithCode('bob@example.com', '123456');
  await sleep(1200);
  checks.bobSeesNothing = await run(`window.matrixStore.tasks.length === 0 && document.querySelector('#login').hidden`);
  await type(`Bob task ${RUN} #bob`, true, false);
  await sleep(300);
  checks.bobOwnRowScoped = await run(`[...window.__fakeSupabase.rows.values()].filter(r => r.title.startsWith('Bob task')).every(r => r.user_id === window.__fakeSupabase.session.user.id)`);

  // 10. delete account removes bob's rows only and signs out
  await run(`window.prompt = () => 'DELETE'; window.alert = () => {}; document.querySelector('#deleteBtn').click()`);
  await sleep(800);
  checks.deleteRemovedOnlyBob = await run(`![...window.__fakeSupabase.rows.values()].some(r => r.title.startsWith('Bob task')) && [...window.__fakeSupabase.rows.values()].some(r => r.tags.includes('smoke-${RUN}'))`);
  checks.signedOutAfterDelete = await run(`!document.querySelector('#login').hidden`);

  // 11. desktop Google: button opens the system browser (stubbed) and the airlock:// return signs in
  let opened = null;
  const { ipcMain, shell } = require('electron');
  ipcMain.removeHandler('desktop:openExternal');
  ipcMain.handle('desktop:openExternal', (_e, url) => { opened = url; return true; });
  await run(`document.querySelector('#googleBtn').click()`);
  await sleep(400);
  checks.desktopGoogleOpenedBrowser = /accounts\.google\.com/.test(opened || '');
  win.webContents.send('desktop:deeplink', 'airlock://auth?code=badcode');
  await sleep(400);
  checks.deepLinkBadCodeRejected = await run(`!document.querySelector('#login').hidden && document.querySelector('#lError').textContent`);
  win.webContents.send('desktop:deeplink', 'airlock://auth?code=goodcode');
  for (let i = 0; i < 20; i++) { await sleep(250); if (await run(`document.querySelector('#login').hidden`)) break; }
  checks.deepLinkSignedIn = await run(`document.querySelector('#login').hidden && document.querySelector('#who').textContent`);

  const ok = checks.loginShown && checks.googleVisibleOnDesktop && checks.codeStepShown && checks.wrongCodeRejected
    && checks.signedIn && checks.whoShowsEmail === 'alice@example.com' && checks.hintShownWhenEmpty && checks.stayedLoggedIn
    && checks.hintHiddenAfterAdd && JSON.stringify(checks.createdCounts) === '[1,0,0,1]'
    && dnd.important === true && dnd.urgent === false && JSON.stringify(checks.afterDndCounts) === '[0,1,0,1]'
    && JSON.stringify(checks.afterDoneCounts) === '[0,0,0,1]' && checks.syncStatus === 'synced'
    && checks.remoteRows.length === 2 && checks.remoteRows.some((r) => r.title === `Smoke ${RUN} do` && r.important && !r.urgent && r.done && r.notes === `note ${RUN}`)
    && checks.realtimeArrived && checks.tickLingers && checks.tickCompleted && checks.pingOnAdd && checks.mutedTickSilent && checks.themeLight && checks.menuHidesWebOnlyItems && checks.exportHasTasks && checks.loginShownAfterSignOut && checks.bobSeesNothing
    && checks.bobOwnRowScoped && checks.deleteRemovedOnlyBob && checks.signedOutAfterDelete
    && checks.desktopGoogleOpenedBrowser && checks.deepLinkBadCodeRejected && checks.deepLinkSignedIn === 'google-user@example.com' && errors.length === 0;
  console.log(JSON.stringify(checks, null, 2));
  console.log(errors.length ? 'console errors: ' + errors.join(' | ') : 'no console errors');
  console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL');
  app.exit(ok ? 0 : 1);
});
