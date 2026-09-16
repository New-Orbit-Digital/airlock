const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

// airlock:// deep link — Google sign-in runs in the system browser and returns here.
const PROTOCOL = 'airlock';
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);   // dev (electron .)
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);                                                        // installed app
}
const findDeepLink = (argv) => argv.find((a) => typeof a === 'string' && a.startsWith(PROTOCOL + '://'));

// Only one window ever; a second launch (e.g. from the Start menu) focuses the existing one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;

  function createWindow() {
    win = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      title: 'Airlock',
      backgroundColor: '#111318',
      autoHideMenuBar: true,
      icon: path.join(__dirname, 'icon.png'),
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.loadFile('index.html');
    win.once('ready-to-show', () => win.show());
    win.webContents.on('did-finish-load', () => { if (pendingDeepLink) { const u = pendingDeepLink; pendingDeepLink = null; win.webContents.send('desktop:deeplink', u); } });
    // any external link opens in the default browser, never inside the app
    win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
    win.on('closed', () => { win = null; });
  }

  let pendingDeepLink = findDeepLink(process.argv) || null;
  const deliverDeepLink = (url) => {
    if (!url) return;
    if (win && !win.webContents.isLoading()) { win.webContents.send('desktop:deeplink', url); if (win.isMinimized()) win.restore(); win.focus(); }
    else pendingDeepLink = url;
  };
  app.on('second-instance', (_e, argv) => {           // Windows/Linux: the OS launches a second copy with the URL
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    deliverDeepLink(findDeepLink(argv));
  });
  app.on('open-url', (e, url) => { e.preventDefault(); deliverDeepLink(url); });   // macOS

  // ---- desktop-only services exposed to the renderer via preload.js ----
  ipcMain.handle('desktop:getStartup', () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle('desktop:setStartup', (_e, on) => {
    app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath });
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('desktop:version', () => app.getVersion());
  ipcMain.handle('desktop:openExternal', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return true; });

  // ---- auto-update from GitHub Releases (New-Orbit-Digital/airlock). Silent download, restart on demand. ----
  let updateReady = null;
  const sendUpdate = (state, extra = {}) => { if (win) win.webContents.send('desktop:update', { state, ...extra }); };
  if (app.isPackaged) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => sendUpdate('checking'));
    autoUpdater.on('update-available', (i) => sendUpdate('downloading', { version: i.version }));
    autoUpdater.on('update-not-available', () => sendUpdate('none'));
    autoUpdater.on('update-downloaded', (i) => { updateReady = i.version; sendUpdate('ready', { version: i.version }); });
    autoUpdater.on('error', (e) => sendUpdate('error', { message: String(e && e.message || e) }));
    const check = () => autoUpdater.checkForUpdates().catch(() => {});
    app.whenReady().then(() => { setTimeout(check, 15000); setInterval(check, 4 * 60 * 60 * 1000); });
  }
  ipcMain.handle('desktop:checkForUpdates', async () => {
    if (!app.isPackaged) return { state: 'dev' };
    try { await autoUpdater.checkForUpdates(); return { state: updateReady ? 'ready' : 'checked', version: updateReady }; }
    catch (e) { return { state: 'error', message: String(e && e.message || e) }; }
  });
  ipcMain.handle('desktop:installUpdate', () => { if (updateReady) setImmediate(() => autoUpdater.quitAndInstall()); return !!updateReady; });

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
