// EduPDF Studio — processus principal (Electron)
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

let win = null;
let pendingOpen = [];
let dirty = false;
ipcMain.on('set-dirty', (_e, v) => { dirty = !!v; });

// ---------- Fichiers acceptés ----------
const PDF_EXT = ['pdf'];
const IMG_EXT = ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'];
const TXT_EXT = ['txt', 'md', 'csv'];
const OFFICE_EXT = ['doc', 'docx', 'odt', 'rtf', 'ppt', 'pptx', 'pps', 'ppsx', 'odp',
  'xls', 'xlsx', 'ods', 'odg', 'pub', 'tif', 'tiff', 'html', 'htm', 'epub'];
const ALL_EXT = [...PDF_EXT, ...IMG_EXT, ...TXT_EXT, ...OFFICE_EXT];

function kindOf(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (PDF_EXT.includes(ext)) return 'pdf';
  if (IMG_EXT.includes(ext)) return 'image';
  if (TXT_EXT.includes(ext)) return 'text';
  if (OFFICE_EXT.includes(ext)) return 'office';
  return null;
}

// ---------- LibreOffice (conversion Word / PowerPoint / Excel → PDF) ----------
function findSoffice() {
  const candidates = [
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    '/usr/bin/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function convertWithOffice(file) {
  return new Promise((resolve, reject) => {
    const soffice = findSoffice();
    if (!soffice) return reject(new Error('LIBREOFFICE_MISSING'));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edupdf-'));
    execFile(soffice, ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', outDir, file],
      { timeout: 180000, windowsHide: true }, (err) => {
        const out = path.join(outDir, path.basename(file, path.extname(file)) + '.pdf');
        if (err || !fs.existsSync(out)) return reject(err || new Error('Conversion échouée'));
        const bytes = fs.readFileSync(out);
        fs.rmSync(outDir, { recursive: true, force: true });
        resolve(bytes);
      });
  });
}

async function loadFile(file) {
  const kind = kindOf(file);
  const name = path.basename(file);
  if (!kind) throw new Error(`Format non pris en charge : ${name}`);
  if (kind === 'office') {
    const bytes = await convertWithOffice(file);
    return { name: name.replace(/\.[^.]+$/, '.pdf'), path: null, kind: 'pdf', bytes };
  }
  if (kind === 'text') return { name, path: null, kind, text: fs.readFileSync(file, 'utf8') };
  return { name, path: kind === 'pdf' ? file : null, kind, bytes: fs.readFileSync(file) };
}

// ---------- Fenêtre ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1000, minHeight: 650,
    title: 'EduPDF Studio',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false // OCR / export continuent même fenêtre réduite
    }
  });
  Menu.setApplicationMenu(null);
  win.on('close', (e) => {
    if (!dirty) return;
    const c = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['Quitter sans enregistrer', 'Annuler'], defaultId: 1, cancelId: 1,
      title: 'EduPDF Studio', message: 'Le document a des modifications non enregistrées.'
    });
    if (c === 1) e.preventDefault();
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (process.env.EDUPDF_SELFTEST) require('./selftest')(win, process.env.EDUPDF_SELFTEST);
  win.webContents.on('did-finish-load', () => {
    if (pendingOpen.length) { win.webContents.send('open-paths', pendingOpen); pendingOpen = []; }
  });
  // Liens externes dans le navigateur par défaut
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function filesFromArgv(argv) {
  return argv.slice(1).filter((a) => !a.startsWith('-') && fs.existsSync(a) && kindOf(a));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const files = filesFromArgv(argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (files.length) win.webContents.send('open-paths', files);
    }
  });
  app.whenReady().then(() => {
    pendingOpen = app.isPackaged ? filesFromArgv(process.argv) : [];
    createWindow();
    setupAutoUpdate();
  });
  app.on('window-all-closed', () => app.quit());
}

// ---------- IPC : fichiers ----------
ipcMain.handle('dialog-open', async (_e, opts = {}) => {
  const filters = opts.imagesOnly
    ? [{ name: 'Images', extensions: IMG_EXT }]
    : [
      { name: 'Tous les documents', extensions: ALL_EXT },
      { name: 'PDF', extensions: PDF_EXT },
      { name: 'Images', extensions: IMG_EXT },
      { name: 'Word / PowerPoint / Excel / OpenOffice', extensions: OFFICE_EXT },
      { name: 'Texte', extensions: TXT_EXT }
    ];
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters });
  if (r.canceled) return [];
  return loadMany(r.filePaths);
});

ipcMain.handle('load-paths', (_e, paths) => loadMany(paths));

async function loadMany(paths) {
  const out = [];
  for (const p of paths) {
    try { out.push(await loadFile(p)); }
    catch (err) { out.push({ name: path.basename(p), error: err.message }); }
  }
  return out;
}

ipcMain.handle('dialog-save', async (_e, { bytes, defaultName, filters, filePath }) => {
  let target = filePath;
  if (!target) {
    const r = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters });
    if (r.canceled) return null;
    target = r.filePath;
  }
  fs.writeFileSync(target, Buffer.from(bytes));
  return target;
});

ipcMain.handle('save-many', async (_e, { files }) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Choisir un dossier' });
  if (r.canceled) return null;
  for (const f of files) fs.writeFileSync(path.join(r.filePaths[0], f.name), Buffer.from(f.bytes));
  return r.filePaths[0];
});

ipcMain.handle('office-status', () => !!findSoffice());
ipcMain.handle('open-external', (_e, url) => shell.openExternal(url));
ipcMain.handle('show-in-folder', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('app-version', () => app.getVersion());

// ---------- IPC : scanner (Windows WIA) ----------
ipcMain.handle('scan', () => new Promise((resolve, reject) => {
  if (process.platform !== 'win32') return reject(new Error('Le scan WIA nécessite Windows.'));
  const out = path.join(os.tmpdir(), `edupdf-scan-${Date.now()}.jpg`);
  const ps = `
$ErrorActionPreference = 'Stop'
$dlg = New-Object -ComObject WIA.CommonDialog
$img = $dlg.ShowAcquireImage(1, 1, 0, '{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}', $false, $true, $false)
if ($img -eq $null) { exit 3 }
if (Test-Path '${out}') { Remove-Item '${out}' }
$img.SaveFile('${out}')
`;
  execFile('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    { windowsHide: false, timeout: 600000 }, (err, _so, se) => {
      if (fs.existsSync(out)) {
        const bytes = fs.readFileSync(out); fs.unlinkSync(out); return resolve(bytes);
      }
      if (err && err.code === 3) return resolve(null);
      reject(new Error((se || (err && err.message) || 'Aucun scanner détecté').toString().trim().slice(0, 400)));
    });
}));

// ---------- IPC : OCR (Tesseract, 100 % hors-ligne) ----------
let ocrWorker = null;
let ocrLangs = '';
function langDir(lang) {
  const base = path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`))
    .replace('app.asar', 'app.asar.unpacked');
  const sub = ['4.0.0_best_int', ...fs.readdirSync(base)].find((d) => fs.existsSync(path.join(base, d, `${lang}.traineddata.gz`)));
  return path.join(base, sub);
}
let langServer = null;
function serveFolder(dir) {
  if (langServer) return Promise.resolve(langServer);
  const http = require('http');
  const srv = http.createServer((req, res) => {
    const f = path.join(dir, path.basename(decodeURIComponent(req.url.split('?')[0])));
    if (!f.startsWith(dir) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => {
    langServer = `http://127.0.0.1:${srv.address().port}`;
    resolve(langServer);
  }));
}
async function getWorker(langs) {
  if (ocrWorker && ocrLangs === langs) return ocrWorker;
  if (ocrWorker) await ocrWorker.terminate();
  const { createWorker } = require('tesseract.js');
  // Toutes les langues doivent partager le même dossier : on copie dans un cache local
  const cache = path.join(app.getPath('userData'), 'tessdata');
  fs.mkdirSync(cache, { recursive: true });
  for (const l of langs.split('+')) {
    const dst = path.join(cache, `${l}.traineddata.gz`);
    if (!fs.existsSync(dst)) fs.copyFileSync(path.join(langDir(l), `${l}.traineddata.gz`), dst);
  }
  // Sous Electron, Tesseract charge les langues par URL : on les sert en local (127.0.0.1, aucun accès Internet)
  const langPath = await serveFolder(cache);
  ocrWorker = await createWorker(langs.split('+'), 1, {
    langPath, cacheMethod: 'none', gzip: true,
    errorHandler: (e) => console.error('OCR', e)
  });
  ocrLangs = langs;
  return ocrWorker;
}

ipcMain.handle('ocr', async (_e, { dataUrl, langs }) => {
  const worker = await getWorker(langs || 'fra+eng');
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  const { data } = await worker.recognize(buf, {}, { text: true, blocks: true });
  const words = [];
  const lines = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
    lines.push({ text: l.text.trim(), bbox: l.bbox });
    for (const w of l.words || []) if (w.text.trim()) words.push({ text: w.text, bbox: w.bbox, conf: w.confidence });
  }
  return { text: data.text, words, lines };
});

// ---------- IPC : export Word (.docx) ----------
ipcMain.handle('export-docx', async (_e, { pages, defaultName }) => {
  const { Document, Packer, Paragraph, TextRun, PageBreak } = require('docx');
  const children = [];
  pages.forEach((paras, i) => {
    paras.forEach((t) => children.push(new Paragraph({ children: [new TextRun({ text: t.text, size: Math.round((t.size || 11) * 2), bold: !!t.bold })] })));
    if (i < pages.length - 1) children.push(new Paragraph({ children: [new PageBreak()] }));
  });
  const doc = new Document({ sections: [{ children }] });
  const buf = await Packer.toBuffer(doc);
  const r = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters: [{ name: 'Word', extensions: ['docx'] }] });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, buf);
  return r.filePath;
});

// ---------- Mises à jour automatiques ----------
function setupAutoUpdate() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  const send = (status, info) => win && win.webContents.send('update-status', { status, info });
  autoUpdater.on('checking-for-update', () => send('checking'));
  autoUpdater.on('update-available', (i) => send('available', i.version));
  autoUpdater.on('update-not-available', () => send('none'));
  autoUpdater.on('download-progress', (p) => send('progress', Math.round(p.percent)));
  autoUpdater.on('update-downloaded', (i) => send('ready', i.version));
  autoUpdater.on('error', () => send('offline'));
  const check = () => autoUpdater.checkForUpdates().catch(() => send('offline'));
  setTimeout(check, 5000);
  setInterval(check, 4 * 60 * 60 * 1000); // toutes les 4 h
  ipcMain.handle('check-update', check);
  ipcMain.handle('install-update', () => autoUpdater.quitAndInstall());
}
ipcMain.handle('is-packaged', () => app.isPackaged);
