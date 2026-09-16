const { contextBridge, ipcRenderer } = require('electron');

// Desktop-only conveniences. Task data itself goes through Supabase (store.js), same as the web app.
contextBridge.exposeInMainWorld('desktop', {
  getStartup: () => ipcRenderer.invoke('desktop:getStartup'),
  setStartup: (on) => ipcRenderer.invoke('desktop:setStartup', on),
  version: () => ipcRenderer.invoke('desktop:version'),
  openExternal: (url) => ipcRenderer.invoke('desktop:openExternal', url),
  onDeepLink: (cb) => ipcRenderer.on('desktop:deeplink', (_e, url) => cb(url)),
  checkForUpdates: () => ipcRenderer.invoke('desktop:checkForUpdates'),
  installUpdate: () => ipcRenderer.invoke('desktop:installUpdate'),
  onUpdate: (cb) => ipcRenderer.on('desktop:update', (_e, info) => cb(info)),
});
