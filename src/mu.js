// EduPDF Studio — MuPDF (WebAssembly) : PDF protégés, réparation, chiffrement, formats XPS / EPUB / CBZ / FB2 / MOBI / TIFF / SVG
const path = require('path');
const { pathToFileURL } = require('url');

let modP = null;
function mu() {
  if (!modP) {
    let p = require.resolve('mupdf');
    // Dans l'application installée, le module est décompressé hors de l'archive asar
    p = p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    modP = import(pathToFileURL(p).href);
  }
  return modP;
}

const isEncrypted = (doc) => {
  const pdf = doc.asPDF && doc.asPDF();
  if (!pdf) return false;
  const e = pdf.getTrailer().get('Encrypt');
  return !!e && !e.isNull();
};

/** Analyse un PDF : chiffré ? mot de passe d'ouverture nécessaire ? */
async function inspectPdf(bytes) {
  const m = await mu();
  const doc = m.Document.openDocument(new Uint8Array(bytes), 'application/pdf');
  try { return { encrypted: isEncrypted(doc), needsPassword: doc.needsPassword() }; }
  finally { doc.destroy && doc.destroy(); }
}

/**
 * Retire le chiffrement (mot de passe facultatif) en conservant tout le contenu
 * (texte, polices, images, formulaires, mise en page). Retourne null si le mot de passe est faux.
 */
async function decryptPdf(bytes, password = '') {
  const m = await mu();
  const doc = m.Document.openDocument(new Uint8Array(bytes), 'application/pdf');
  try {
    if (doc.needsPassword() && !doc.authenticatePassword(password || '')) return null;
    return doc.asPDF().saveToBuffer('encrypt=none').asUint8Array().slice();
  } finally { doc.destroy && doc.destroy(); }
}

/** Réécrit un PDF endommagé (MuPDF répare la table des objets à l'ouverture). */
async function repairPdf(bytes) {
  const m = await mu();
  const doc = m.Document.openDocument(new Uint8Array(bytes), 'application/pdf');
  try { return doc.asPDF().saveToBuffer('garbage=compact').asUint8Array().slice(); }
  finally { doc.destroy && doc.destroy(); }
}

/** Bits de permissions PDF (norme ISO 32000, valeur /P). */
function permissionsValue({ print = true, modify = false, copy = false, annotate = true } = {}) {
  let p = -3904; // bits réservés à 1, toutes les permissions retirées
  if (print) p |= 4 | 2048;
  if (modify) p |= 8 | 1024;
  if (copy) p |= 16 | 512;
  if (annotate) p |= 32 | 256;
  return p;
}

/** Chiffre un PDF en AES-256 avec un mot de passe d'ouverture et/ou de modification. */
async function encryptPdf(bytes, { userPassword = '', ownerPassword = '', permissions = {} }) {
  const m = await mu();
  const doc = m.Document.openDocument(new Uint8Array(bytes), 'application/pdf');
  try {
    const esc = (s) => String(s).replace(/,/g, '');
    const owner = ownerPassword || userPassword;
    const opts = [`encrypt=aes-256`, `owner-password=${esc(owner)}`, `permissions=${permissionsValue(permissions)}`];
    if (userPassword) opts.push(`user-password=${esc(userPassword)}`);
    return doc.asPDF().saveToBuffer(opts.join(',')).asUint8Array().slice();
  } finally { doc.destroy && doc.destroy(); }
}

/** Convertit tout document lisible par MuPDF (XPS, EPUB, CBZ, FB2, MOBI, TIFF multipage, SVG…) en PDF. */
async function convertToPdf(bytes, fileName) {
  const m = await mu();
  const doc = m.Document.openDocument(new Uint8Array(bytes), fileName);
  try {
    if (doc.needsPassword()) throw new Error('Ce document est protégé par un mot de passe.');
    const pdf = doc.asPDF && doc.asPDF();
    if (pdf) return pdf.saveToBuffer('encrypt=none').asUint8Array().slice();
    try { if (doc.isReflowable()) doc.layout(595.28, 841.89, 12); } catch { /* format à mise en page fixe */ }
    const buf = new m.Buffer();
    const writer = new m.DocumentWriter(buf, 'pdf', '');
    const n = doc.countPages();
    if (!n) throw new Error('Document vide.');
    for (let i = 0; i < n; i++) {
      const page = doc.loadPage(i);
      const dev = writer.beginPage(page.getBounds());
      page.run(dev, m.Matrix.identity);
      writer.endPage();
      page.destroy && page.destroy();
    }
    writer.close();
    return buf.asUint8Array().slice();
  } finally { doc.destroy && doc.destroy(); }
}

module.exports = { inspectPdf, decryptPdf, repairPdf, encryptPdf, convertToPdf, permissionsValue };
