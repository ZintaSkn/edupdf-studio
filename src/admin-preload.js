// Pont sécurisé de la console d'administration
const { contextBridge, ipcRenderer } = require('electron');
const call = (name, arg) => ipcRenderer.invoke(name, arg);
contextBridge.exposeInMainWorld('adm', {
  status: () => call('admin-status'),
  login: (password) => call('admin-login', { password }),
  get: () => call('admin-get'),
  save: (policy) => call('admin-save', { policy }),
  events: (limit) => call('admin-events', { limit }),
  saveNotify: (n) => call('admin-notify-save', n),
  testNotify: () => call('admin-notify-test'),
  changePassword: (oldPw, newPw) => call('admin-change-password', { oldPw, newPw }),
  showFolder: () => call('admin-show-folder'),
  onChanged: (cb) => ipcRenderer.on('admin-events-changed', () => cb())
});
