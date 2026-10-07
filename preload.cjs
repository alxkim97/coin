const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  onNavigate: (cb) => ipcRenderer.on('navigate', (_e, view) => cb(view)),
})
