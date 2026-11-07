const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openDialog: (opts) => ipcRenderer.invoke('dialog-open', opts),
  loadPaths: (paths) => ipcRenderer.invoke('load-paths', paths),
  save: (args) => ipcRenderer.invoke('dialog-save', args),
  saveMany: (files) => ipcRenderer.invoke('save-many', { files }),
  officeStatus: () => ipcRenderer.invoke('office-status'),
  installOffice: () => ipcRenderer.invoke('install-office'),
  unlockPdf: (bytes, password) => ipcRenderer.invoke('unlock-pdf', { bytes, password }),
  encryptPdf: (bytes, opts) => ipcRenderer.invoke('encrypt-pdf', { bytes, opts }),
  fontFile: (spec) => ipcRenderer.invoke('font-file', spec),
  printPages: (pages) => ipcRenderer.invoke('print-pages', { pages }),
  redactPdf: (bytes, pages) => ipcRenderer.invoke('redact-pdf', { bytes, pages }),
  compressPdf: (bytes) => ipcRenderer.invoke('compress-pdf', { bytes }),
  pdfToOffice: (bytes, format, defaultName) => ipcRenderer.invoke('pdf-to-office', { bytes, format, defaultName }),
  unlockOffice: (file, password) => ipcRenderer.invoke('unlock-office', { file, password }),
  pickCertificate: () => ipcRenderer.invoke('pick-certificate'),
  signPdf: (args) => ipcRenderer.invoke('sign-pdf', args),
  scan: () => ipcRenderer.invoke('scan'),
  ocr: (dataUrl, langs) => ipcRenderer.invoke('ocr', { dataUrl, langs }),
  exportDocx: (pages, defaultName) => ipcRenderer.invoke('export-docx', { pages, defaultName }),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),
  version: () => ipcRenderer.invoke('app-version'),
  isPackaged: () => ipcRenderer.invoke('is-packaged'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdate: (cb) => ipcRenderer.on('update-status', (_e, s) => cb(s)),
  onOpenPaths: (cb) => ipcRenderer.on('open-paths', (_e, p) => cb(p)),
  setDirty: (v) => ipcRenderer.send('set-dirty', v),
  pathForFile: (file) => {
    try { return require('electron').webUtils.getPathForFile(file); } catch { return file.path; }
  }
});
