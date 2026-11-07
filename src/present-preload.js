// Pont de l'écran de projection (mode présentateur)
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('present', {
  onFrame: (cb) => ipcRenderer.on('present-frame', (_e, url) => cb(url)),
  key: (key, shift) => ipcRenderer.send('present-key', { key, shift })
});
