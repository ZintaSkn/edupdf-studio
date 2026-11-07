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

const mu = require('./mu');

// ---------- Fichiers acceptés ----------
const PDF_EXT = ['pdf'];
const IMG_EXT = ['png', 'jpg', 'jpeg', 'jfif', 'jpe', 'bmp', 'gif', 'webp', 'avif', 'ico'];
// Formats lus par MuPDF (mise en page conservée)
const MU_EXT = ['epub', 'cbz', 'fb2', 'mobi', 'tif', 'tiff', 'jxr', 'pnm', 'pbm', 'pgm', 'ppm', 'pam', 'psd'];
// Pages web : rendues par Chromium (mise en page conservée)
const HTML_EXT = ['html', 'htm', 'xhtml', 'mht', 'mhtml', 'svg'];
const TXT_EXT = ['txt', 'md', 'csv', 'json', 'xml', 'log', 'tex', 'ini', 'srt', 'vtt'];
const OFFICE_EXT = ['doc', 'docx', 'docm', 'dot', 'dotx', 'odt', 'ott', 'rtf', 'wpd', 'wps',
  'ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'pot', 'potx', 'odp', 'otp',
  'xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'ots', 'odg', 'otg', 'vsd', 'vsdx', 'pub'];
const ALL_EXT = [...PDF_EXT, ...IMG_EXT, ...MU_EXT, ...HTML_EXT, ...TXT_EXT, ...OFFICE_EXT];

function kindOf(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (PDF_EXT.includes(ext)) return 'pdf';
  if (IMG_EXT.includes(ext)) return 'image';
  if (MU_EXT.includes(ext)) return 'mu';
  if (HTML_EXT.includes(ext)) return 'html';
  if (TXT_EXT.includes(ext)) return 'text';
  if (OFFICE_EXT.includes(ext)) return 'office';
  return 'unknown';
}

/** Reconnaît un fichier par son contenu (extension absente ou trompeuse). */
function sniff(buf) {
  const head = buf.subarray(0, 1024).toString('latin1');
  if (head.includes('%PDF-')) return 'pdf';
  if (buf[0] === 0x89 && head.startsWith('\x89PNG')) return 'image';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image';
  if (head.startsWith('GIF8') || head.startsWith('BM') || (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP')) return 'image';
  if (head.startsWith('II*\0') || head.startsWith('MM\0*')) return 'mu';
  if (/^\s*<(\?xml|svg|!doctype html|html)/i.test(head)) return 'html';
  const sample = buf.subarray(0, 8192);
  if (!sample.includes(0)) return 'text';
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

// ---------- Pages web et Word (sans LibreOffice) → PDF via Chromium ----------
async function htmlToPdf(file) {
  const w = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  try {
    await w.loadFile(file);
    return await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
  } finally { w.destroy(); }
}
async function docxToPdfApprox(file) {
  const mammoth = require('mammoth');
  const { value } = await mammoth.convertToHtml({ path: file });
  const tmp = path.join(os.tmpdir(), `edupdf-${Date.now()}.html`);
  fs.writeFileSync(tmp, `<!doctype html><meta charset="utf-8"><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.35;margin:0}
table{border-collapse:collapse}td,th{border:1px solid #999;padding:3px 6px}img{max-width:100%}</style>${value}`);
  try { return await htmlToPdf(tmp); } finally { fs.rmSync(tmp, { force: true }); }
}

const isOle = (buf) => buf.length > 8 && buf.readUInt32BE(0) === 0xd0cf11e0;
const pdfName = (name) => name.replace(/\.[^.]+$/, '') + '.pdf';

/** Prépare un PDF : déchiffre les PDF protégés (restrictions) et demande le mot de passe si nécessaire. */
async function preparePdf(buf, name, file) {
  let info;
  try { info = await mu.inspectPdf(buf); } catch { info = null; }
  if (!info) { // fichier endommagé : tentative de réparation
    try { return { name, path: null, kind: 'pdf', bytes: await mu.repairPdf(buf), note: 'repaired' }; } catch { return { name, path: file, kind: 'pdf', bytes: buf }; }
  }
  if (!info.encrypted) return { name, path: file, kind: 'pdf', bytes: buf };
  if (info.needsPassword) return { name, path: file, kind: 'pdf', locked: true, bytes: buf };
  return { name, path: file, kind: 'pdf', bytes: await mu.decryptPdf(buf), note: 'unrestricted' };
}

async function loadFile(file) {
  const name = path.basename(file);
  let kind = kindOf(file);
  if (kind === 'office') {
    if (!findSoffice()) {
      if (/\.docx$/i.test(file)) return { name: pdfName(name), path: null, kind: 'pdf', bytes: await docxToPdfApprox(file), note: 'approx' };
      throw new Error('LIBREOFFICE_MISSING');
    }
    try { return { name: pdfName(name), path: null, kind: 'pdf', bytes: await convertWithOffice(file) }; }
    catch (e) {
      if (/x$|m$/i.test(path.extname(file)) && isOle(fs.readFileSync(file))) throw new Error('OFFICE_LOCKED');
      throw e;
    }
  }
  if (kind === 'html') return { name: pdfName(name), path: null, kind: 'pdf', bytes: await htmlToPdf(file) };
  const buf = fs.readFileSync(file);
  if (kind === 'unknown') {
    kind = sniff(buf);
    if (!kind) { // dernier recours : MuPDF, puis LibreOffice
      try { return { name: pdfName(name), path: null, kind: 'pdf', bytes: await mu.convertToPdf(buf, name) }; } catch { /* suite */ }
      if (findSoffice()) return { name: pdfName(name), path: null, kind: 'pdf', bytes: await convertWithOffice(file) };
      throw new Error(`Format non reconnu : ${name}`);
    }
  }
  if (kind === 'pdf') return preparePdf(buf, name, file);
  if (kind === 'mu') return { name: pdfName(name), path: null, kind: 'pdf', bytes: await mu.convertToPdf(buf, name) };
  if (kind === 'html') return { name: pdfName(name), path: null, kind: 'pdf', bytes: await htmlToPdf(file) };
  if (kind === 'text') return { name, path: null, kind, text: buf.toString('utf8').replace(/^﻿/, '') };
  return { name, path: null, kind, bytes: buf };
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
      { name: 'EPUB, BD (CBZ), FB2, MOBI, TIFF…', extensions: MU_EXT },
      { name: 'Pages web', extensions: HTML_EXT },
      { name: 'Texte', extensions: TXT_EXT },
      { name: 'Tous les fichiers', extensions: ['*'] }
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
ipcMain.handle('install-office', () => new Promise((resolve) => {
  execFile('winget', ['install', '-e', '--id', 'TheDocumentFoundation.LibreOffice', '--silent',
    '--accept-package-agreements', '--accept-source-agreements'], { timeout: 1800000, windowsHide: true },
  (err, so, se) => resolve({ ok: !!findSoffice(), log: String(se || so || (err && err.message) || '').trim().slice(-300) }));
}));

// ---------- IPC : protection par mot de passe (MuPDF) ----------
ipcMain.handle('unlock-pdf', async (_e, { bytes, password }) => {
  const out = await mu.decryptPdf(bytes, password);
  return out ? { ok: true, bytes: out } : { ok: false };
});
ipcMain.handle('encrypt-pdf', (_e, { bytes, opts }) => mu.encryptPdf(bytes, opts));

// ---------- IPC : polices Windows (réécriture fidèle, tous alphabets) ----------
const FONT_DIRS = [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'),
  path.join(process.env.LOCALAPPDATA || os.homedir(), 'Microsoft', 'Windows', 'Fonts')];
const fontFiles = new Map();
/** Extrait une police d'une collection .ttc (pdf-lib n'accepte que des .ttf / .otf). */
function ttcExtract(buf, index) {
  if (buf.toString('latin1', 0, 4) !== 'ttcf') return buf;
  const n = buf.readUInt32BE(8); if (index >= n) index = 0;
  const off = buf.readUInt32BE(12 + 4 * index);
  const numTables = buf.readUInt16BE(off + 4);
  const head = 12 + 16 * numTables;
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const r = off + 12 + 16 * i;
    tables.push({ tag: buf.subarray(r, r + 4), sum: buf.readUInt32BE(r + 4), o: buf.readUInt32BE(r + 8), len: buf.readUInt32BE(r + 12) });
  }
  const out = Buffer.alloc(tables.reduce((s, t) => s + ((t.len + 3) & ~3), head));
  buf.copy(out, 0, off, off + 12);
  let pos = head;
  tables.forEach((t, i) => {
    const r = 12 + 16 * i;
    t.tag.copy(out, r); out.writeUInt32BE(t.sum, r + 4); out.writeUInt32BE(pos, r + 8); out.writeUInt32BE(t.len, r + 12);
    buf.copy(out, pos, t.o, t.o + t.len); pos += (t.len + 3) & ~3;
  });
  return out;
}
ipcMain.handle('font-file', (_e, spec) => {
  if (fontFiles.has(spec)) return fontFiles.get(spec);
  const [name, idx] = String(spec).split('#');
  let data = null;
  if (/^[\w .-]+\.(ttf|otf|ttc)$/i.test(name)) {
    for (const d of FONT_DIRS) {
      const f = path.join(d, name);
      if (fs.existsSync(f)) { data = fs.readFileSync(f); break; }
    }
    if (data && /\.ttc$/i.test(name)) data = ttcExtract(data, +idx || 0);
  }
  fontFiles.set(spec, data);
  return data;
});
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
