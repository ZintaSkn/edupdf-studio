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
const HEIC_EXT = ['heic', 'heif'];
const XPS_EXT = ['xps', 'oxps'];
const ALL_EXT = [...PDF_EXT, ...IMG_EXT, ...HEIC_EXT, ...MU_EXT, ...HTML_EXT, ...TXT_EXT, ...OFFICE_EXT, ...XPS_EXT];

function kindOf(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (PDF_EXT.includes(ext)) return 'pdf';
  if (HEIC_EXT.includes(ext)) return 'heic';
  if (XPS_EXT.includes(ext)) return 'xps';
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

/**
 * Conversion LibreOffice. Profil séparé : la conversion fonctionne même si LibreOffice est déjà ouvert.
 * @param {string} target ex. 'pdf', 'docx:"MS Word 2007 XML"'
 * @param {string} [infilter] filtre d'import (ex. 'writer_pdf_import' pour PDF → Word)
 */
function convertWithOffice(file, target = 'pdf', infilter = null) {
  return new Promise((resolve, reject) => {
    const soffice = findSoffice();
    if (!soffice) return reject(new Error('LIBREOFFICE_MISSING'));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edupdf-'));
    const profile = 'file:///' + path.join(app.getPath('userData'), 'lo-profile').replace(/\\/g, '/');
    const args = [`-env:UserInstallation=${profile}`, '--headless', '--norestore', '--nologo'];
    if (infilter) args.push(`--infilter=${infilter}`);
    args.push('--convert-to', target, '--outdir', outDir, file);
    execFile(soffice, args, { timeout: 300000, windowsHide: true }, (err) => {
      const ext = target.split(':')[0];
      const out = path.join(outDir, path.basename(file, path.extname(file)) + '.' + ext);
      if (err || !fs.existsSync(out)) { fs.rmSync(outDir, { recursive: true, force: true }); return reject(err || new Error('Conversion LibreOffice échouée')); }
      const bytes = fs.readFileSync(out);
      fs.rmSync(outDir, { recursive: true, force: true });
      resolve(bytes);
    });
  });
}

// ---------- Photos d'iPhone / Android (HEIC, HEIF) ----------
async function heicToJpeg(buf) {
  const convert = require('heic-convert');
  try { return Buffer.from(await convert({ buffer: buf, format: 'JPEG', quality: 0.92 })); }
  catch (e) { throw new Error('Photo HEIC illisible : ' + e.message); }
}

// ---------- XPS / OXPS : rendu par Windows (WPF) en images ----------
function xpsToImages(file) {
  return new Promise((resolve, reject) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edupdf-xps-'));
    const q = (s) => s.replace(/'/g, "''");
    const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore, PresentationFramework, ReachFramework, WindowsBase
$doc = New-Object System.Windows.Xps.Packaging.XpsDocument('${q(file)}', [System.IO.FileAccess]::Read)
$pag = $doc.GetFixedDocumentSequence().DocumentPaginator
$pag.ComputePageCount()
for ($i = 0; $i -lt $pag.PageCount; $i++) {
  $p = $pag.GetPage($i); $s = $p.Size
  $bmp = New-Object System.Windows.Media.Imaging.RenderTargetBitmap([int]($s.Width * 2), [int]($s.Height * 2), 192, 192, [System.Windows.Media.PixelFormats]::Pbgra32)
  $dv = New-Object System.Windows.Media.DrawingVisual; $dc = $dv.RenderOpen()
  $dc.DrawRectangle([System.Windows.Media.Brushes]::White, $null, (New-Object System.Windows.Rect(0, 0, $s.Width, $s.Height))); $dc.Close()
  $bmp.Render($dv); $bmp.Render($p.Visual)
  $enc = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
  $enc.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bmp))
  $fs = [System.IO.File]::Create((Join-Path '${q(outDir)}' ('p{0:D4}.png' -f $i))); $enc.Save($fs); $fs.Close()
}
$doc.Close()`;
    execFile('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', ps], { timeout: 300000, windowsHide: true }, (err, _so, se) => {
      const files = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter((f) => f.endsWith('.png')).sort() : [];
      const imgs = files.map((f) => fs.readFileSync(path.join(outDir, f)));
      fs.rmSync(outDir, { recursive: true, force: true });
      if (!imgs.length) return reject(new Error('Lecture XPS impossible : ' + String(se || (err && err.message) || '').trim().slice(0, 200)));
      resolve(imgs);
    });
  });
}

// ---------- Fichiers Office protégés par mot de passe ----------
function officeEncrypted(buf) {
  try { return require('officecrypto-tool').isEncrypted(buf); } catch { return false; }
}
async function officeWithPassword(file, password) {
  const oc = require('officecrypto-tool');
  let plain;
  try { plain = await oc.decrypt(fs.readFileSync(file), { password }); }
  catch (e) {
    if (/password/i.test(e.message)) return null;
    throw new Error(`Ce fichier Office protégé utilise un chiffrement non pris en charge (${e.message}). Ouvrez-le dans Word avec son mot de passe, puis enregistrez-le sans mot de passe.`);
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edupdf-dec-'));
  const tmp = path.join(tmpDir, path.basename(file));
  fs.writeFileSync(tmp, plain);
  try {
    if (findSoffice()) return await convertWithOffice(tmp);
    if (/\.docx$/i.test(file)) return await docxToPdfApprox(tmp);
    throw new Error('LIBREOFFICE_MISSING');
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
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
  if (kind === 'heic') return { name, path: null, kind: 'image', bytes: await heicToJpeg(fs.readFileSync(file)) };
  if (kind === 'xps') return { name: pdfName(name), path: null, kind: 'images', images: await xpsToImages(file), note: 'xps' };
  if (kind === 'office') {
    if (officeEncrypted(fs.readFileSync(file))) return { name: pdfName(name), path: file, kind: 'office', locked: true };
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
      sandbox: true,
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
  // Liens externes dans le navigateur par défaut (https uniquement) ; aucune navigation hors de l'application
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function filesFromArgv(argv) {
  return argv.slice(1).filter((a) => !a.startsWith('-') && fs.existsSync(a) && fs.statSync(a).isFile());
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
    ? [{ name: 'Images', extensions: [...IMG_EXT, ...HEIC_EXT, 'tif', 'tiff'] }]
    : [
      { name: 'Tous les documents', extensions: ALL_EXT },
      { name: 'PDF', extensions: PDF_EXT },
      { name: 'Images et photos', extensions: [...IMG_EXT, ...HEIC_EXT] },
      { name: 'XPS', extensions: XPS_EXT },
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
    try { const f = await loadFile(p); if (f.kind === 'pdf' && f.path) allow(f.path); out.push(f); }
    catch (err) { out.push({ name: path.basename(p), error: err.message }); }
  }
  return out;
}

// Écriture directe autorisée seulement vers un fichier ouvert ou enregistré par l'utilisateur
const writable = new Set();
const allow = (p) => { if (p) writable.add(path.resolve(p).toLowerCase()); };
ipcMain.handle('dialog-save', async (_e, { bytes, defaultName, filters, filePath }) => {
  let target = filePath && (writable.has(path.resolve(filePath).toLowerCase()) || process.env.EDUPDF_SELFTEST) ? filePath : null;
  if (!target) {
    const r = await dialog.showSaveDialog(win, { defaultPath: path.basename(defaultName || 'Document.pdf'), filters });
    if (r.canceled) return null;
    target = r.filePath;
  }
  try { fs.writeFileSync(target, Buffer.from(bytes)); }
  catch (e) { throw new Error(e.code === 'EBUSY' || e.code === 'EPERM' ? 'Le fichier est ouvert dans un autre logiciel ou en lecture seule. Fermez-le ou choisissez « Enregistrer sous ».' : e.message); }
  allow(target);
  return target;
});

ipcMain.handle('save-many', async (_e, { files }) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Choisir un dossier' });
  if (r.canceled) return null;
  for (const f of files) fs.writeFileSync(path.join(r.filePaths[0], path.basename(f.name)), Buffer.from(f.bytes));
  return r.filePaths[0];
});

// ---------- Impression (boîte d'impression Windows) ----------
ipcMain.handle('print-pages', async (_e, { pages }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edupdf-print-'));
  const imgs = pages.map((p, i) => { const f = path.join(dir, `p${i}.jpg`); fs.writeFileSync(f, Buffer.from(p.bytes)); return { f: path.basename(f), w: p.w, h: p.h }; });
  const html = `<!doctype html><meta charset="utf-8"><style>@page{margin:0}html,body{margin:0;padding:0}
    img{display:block;width:100vw;height:auto;page-break-after:always;break-after:page}img:last-child{page-break-after:auto}</style>
    ${imgs.map((i) => `<img src="${i.f}">`).join('')}`;
  fs.writeFileSync(path.join(dir, 'print.html'), html);
  const pw = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  try {
    await pw.loadFile(path.join(dir, 'print.html'));
    const landscape = pages.length && pages[0].w > pages[0].h;
    return await new Promise((resolve) => pw.webContents.print({ silent: false, printBackground: true, landscape, margins: { marginType: 'none' } },
      (ok, reason) => resolve({ ok, reason: ok ? '' : reason })));
  } finally { pw.destroy(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- Suppression définitive sous les zones masquées / corrigées (MuPDF) ----------
ipcMain.handle('redact-pdf', (_e, { bytes, pages }) => mu.redactPdf(bytes, pages));
ipcMain.handle('compress-pdf', (_e, { bytes }) => mu.compressPdf(bytes));

// ---------- PDF → Word / PowerPoint fidèle (LibreOffice) ----------
ipcMain.handle('pdf-to-office', async (_e, { bytes, format, defaultName }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edupdf-x-'));
  const src = path.join(dir, 'document.pdf'); fs.writeFileSync(src, Buffer.from(bytes));
  try {
    const out = format === 'pptx'
      ? await convertWithOffice(src, 'pptx:"Impress MS PowerPoint 2007 XML"', 'impress_pdf_import')
      : await convertWithOffice(src, 'docx:"MS Word 2007 XML"', 'writer_pdf_import');
    const r = await dialog.showSaveDialog(win, { defaultPath: path.basename(defaultName), filters: [{ name: format === 'pptx' ? 'PowerPoint' : 'Word', extensions: [format] }] });
    if (r.canceled) return null;
    fs.writeFileSync(r.filePath, out); allow(r.filePath);
    return r.filePath;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- Fichiers Office protégés ----------
ipcMain.handle('unlock-office', async (_e, { file, password }) => {
  const bytes = await officeWithPassword(file, password);
  return bytes ? { ok: true, bytes } : { ok: false };
});

// ---------- Signature numérique avec certificat (.p12 / .pfx) ----------
ipcMain.handle('pick-certificate', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Certificat', extensions: ['p12', 'pfx'] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('sign-pdf', async (_e, { bytes, certPath, passphrase, reason, location, name }) => {
  const { PDFDocument } = require('pdf-lib');
  const { pdflibAddPlaceholder } = require('@signpdf/placeholder-pdf-lib');
  const { P12Signer } = require('@signpdf/signer-p12');
  const { SignPdf } = require('@signpdf/signpdf');
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  pdflibAddPlaceholder({ pdfDoc: doc, reason: reason || 'Approbation du document', contactInfo: '', name: name || '', location: location || '', signatureLength: 16384 });
  const prepared = Buffer.from(await doc.save({ useObjectStreams: false }));
  let signer;
  try { signer = new P12Signer(fs.readFileSync(certPath), { passphrase: passphrase || '' }); }
  catch { throw new Error('Certificat illisible ou mot de passe du certificat incorrect.'); }
  try { return await new SignPdf().sign(prepared, signer); }
  catch (e) { throw new Error(/password|MAC|decrypt/i.test(e.message) ? 'Mot de passe du certificat incorrect.' : e.message); }
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
ipcMain.handle('open-external', (_e, url) => (/^https:\/\//i.test(String(url)) ? shell.openExternal(url) : null));
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
  const { Document, Packer, Paragraph, TextRun, PageBreak, ImageRun } = require('docx');
  const children = [];
  pages.forEach((paras, i) => {
    paras.forEach((t) => {
      if (t.image) {
        const k = Math.min(1, 600 / t.w);
        children.push(new Paragraph({ children: [new ImageRun({ data: Buffer.from(t.image), transformation: { width: Math.round(t.w * k), height: Math.round(t.h * k) } })] }));
      } else {
        children.push(new Paragraph({ children: [new TextRun({ text: t.text, size: Math.round((t.size || 11) * 2), bold: !!t.bold, italics: !!t.italic, font: t.font || undefined, color: t.color ? t.color.replace('#', '') : undefined })] }));
      }
    });
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
