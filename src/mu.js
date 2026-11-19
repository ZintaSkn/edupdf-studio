// SknEDU-studio — MuPDF (WebAssembly) : PDF protégés, réparation, chiffrement, formats XPS / EPUB / CBZ / FB2 / MOBI / TIFF / SVG
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

/**
 * Suppression définitive du contenu sous des zones (texte, et selon le cas images et tracés).
 * pages : { [indexPage]: [{ rect:[x1,y1,x2,y2] en coordonnées PDF, full: bool }] }
 * full = zone « Masquer » (texte + images + tracés) ; sinon correction de texte (texte seul).
 */
async function redactPdf(bytes, pages) {
  const m = await mu();
  const doc = m.Document.openDocument(new Uint8Array(bytes), 'application/pdf').asPDF();
  try {
    for (const [idx, zones] of Object.entries(pages)) {
      const page = doc.loadPage(+idx);
      const t = page.getTransform();
      const tr = ([x, y]) => [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
      for (const full of [false, true]) {
        const list = zones.filter((z) => !!z.full === full);
        if (!list.length) continue;
        for (const z of list) {
          const [a, b] = [tr([z.rect[0], z.rect[1]]), tr([z.rect[2], z.rect[3]])];
          const annot = page.createAnnotation('Redact');
          annot.setRect([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]);
        }
        page.applyRedactions(false, full ? 2 : 0, full ? 1 : 0, 0);
      }
    }
    return doc.saveToBuffer('').asUint8Array().slice();
  } finally { doc.destroy && doc.destroy(); }
}

/** Réduit la taille sans perte : objets inutilisés supprimés, flux, polices et images recompressés. */
async function compressPdf(bytes) {
  const m = await mu();
  const doc = m.Document.openDocument(new Uint8Array(bytes), 'application/pdf').asPDF();
  try {
    try { return doc.saveToBuffer('garbage=deduplicate,compress,compress-fonts,compress-images,objstms').asUint8Array().slice(); }
    catch { return doc.saveToBuffer('garbage=deduplicate,compress,compress-fonts,compress-images').asUint8Array().slice(); }
  }
  finally { doc.destroy && doc.destroy(); }
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

// ---------- Zones de réponse (champs de formulaire du PDF) ----------
const FIELD_TYPES = { text: 'text', checkbox: 'checkbox', radiobutton: 'radio', combobox: 'choice', listbox: 'choice' };
/**
 * Parcourt les zones modifiables dans un ordre fixe (pages, puis ordre du PDF) : le numéro k désigne la même zone pour
 * l'élève (page web) et pour l'enseignant (remplissage de la copie). Zones masquées ou en lecture seule : imprimées telles quelles.
 */
function eachField(pdf, fn) {
  let k = 0;
  for (let i = 0, n = pdf.countPages(); i < n && k < 500; i++) {
    const page = pdf.loadPage(i);
    for (const w of page.getWidgets()) {
      const t = FIELD_TYPES[w.getFieldType()];
      if (!t || w.isReadOnly() || (w.getFlags() & (2 | 32))) continue;
      fn(w, t, k++, i, page); if (k >= 500) break;
    }
  }
}
/** Zones de réponse d'un PDF : [{ k, p, t, x, y, w, h, … }] en fractions de la page (origine en haut à gauche). */
async function formFields(bytes) {
  const m = await mu(); const doc = m.Document.openDocument(new Uint8Array(bytes), 'application/pdf');
  try {
    const pdf = doc.asPDF && doc.asPDF(); if (!pdf) return [];
    const out = []; const groups = new Map();
    eachField(pdf, (w, t, k, i, page) => {
      const b = page.getBounds(); const W = b[2] - b[0], H = b[3] - b[1]; const r = w.getRect();
      const f = { k, p: i, t, x: (r[0] - b[0]) / W, y: (r[1] - b[1]) / H, w: (r[2] - r[0]) / W, h: (r[3] - r[1]) / H };
      if (!(f.w > 0 && f.h > 0 && f.x > -0.01 && f.y > -0.01 && f.x + f.w < 1.01 && f.y + f.h < 1.01)) return; // hors de la page
      if (t === 'text') { f.ml = !!w.isMultiline(); f.max = w.getMaxLen() || 0; f.v = String(w.getValue() || '').slice(0, 5000); f.fs = (f.ml ? 11 : Math.min(12, (r[3] - r[1]) * 0.7)) / W; }
      if (t === 'checkbox') { const v = w.getValue(); f.on = !!v && v !== 'Off'; }
      if (t === 'radio') { const name = w.getName(); if (!groups.has(name)) groups.set(name, groups.size); f.g = groups.get(name); }
      if (t === 'choice') { f.o = w.getOptions().slice(0, 200).map((o) => String(o).slice(0, 200)); f.v = String(w.getValue() || ''); }
      out.push(f);
    });
    return out;
  } finally { doc.destroy && doc.destroy(); }
}
/** Remplit les zones avec les réponses vérifiées ({ k: valeur }) ; taille du texte adaptée à la zone. */
function fillFields(pdf, answers) {
  eachField(pdf, (w, t, k) => {
    if (!Object.prototype.hasOwnProperty.call(answers, k)) return;
    const v = answers[k];
    if (t === 'text') {
      const r = w.getRect(); const wd = r[2] - r[0], h = r[3] - r[1]; const ml = w.isMultiline();
      let da = null; try { da = w.getDefaultAppearance(); } catch { da = null; }
      let s = da && da.size > 0 ? da.size : 11; s = ml ? Math.min(s, 12) : Math.min(s, 14, h * 0.75);
      if (!ml) { const len = String(v).length || 1; s = Math.min(s, wd / (0.52 * len)); } // une seule ligne : le texte doit tenir en largeur
      s = Math.max(6, Math.round(s * 2) / 2);
      try { w.setDefaultAppearance((da && da.font) || 'Helv', s, da && Array.isArray(da.color) && da.color.length ? da.color : [0]); } catch { /* police imposée par le PDF */ }
      w.setTextValue(String(v));
    } else if (t === 'checkbox') { const on = !!w.getValue() && w.getValue() !== 'Off'; if (!!v !== on) w.toggle(); }
    else if (t === 'radio') { if (v === true) { w.toggle(); if (!w.getValue() || w.getValue() === 'Off') w.toggle(); } } // déjà coché : le second basculement le remet
    else if (t === 'choice') w.setChoiceValue(String(v));
    w.update();
  });
  eachField(pdf, (w) => { try { w.update(); } catch { /* */ } }); // apparence des boutons radio du même groupe
}

// ---------- Copies d'élèves : document figé et verrouillé ----------
/**
 * Fige un document (PDF ou image) : chaque page est réécrite, si bien que les champs de formulaire, les annotations
 * et les notes ajoutées sont fondus dans la page et ne peuvent plus être modifiés. Le texte reste du texte.
 * notes (PDF seulement) : [{ p, x, y, w, h, fs, text }] en fractions de la page (origine en haut à gauche), fs en fraction de la largeur.
 * answers (PDF seulement) : réponses aux zones { k: valeur }, déjà vérifiées (copies.cleanAnswers).
 */
async function flattenToPdf(bytes, name = 'application/pdf', notes = [], answers = null) {
  const m = await mu();
  let doc = m.Document.openDocument(new Uint8Array(bytes), name);
  try {
    if (doc.needsPassword()) throw new Error('Ce document est protégé par un mot de passe.');
    const n = doc.countPages(); if (!n) throw new Error('Document vide.'); if (n > 300) throw new Error('Document trop long (300 pages maximum).');
    const pdf = doc.asPDF && doc.asPDF();
    if (pdf && (notes.length || answers)) {
      if (answers) fillFields(pdf, answers);
      for (const t of notes) {
        if (!(t.p >= 0 && t.p < n)) continue;
        const page = pdf.loadPage(t.p); const b = page.getBounds(); const W = b[2] - b[0], H = b[3] - b[1];
        const size = Math.min(40, Math.max(6, t.fs * W)); const lines = String(t.text).split('\n').length;
        const x0 = b[0] + Math.min(0.97, Math.max(0, t.x)) * W, y0 = b[1] + Math.min(0.98, Math.max(0, t.y)) * H;
        const x1 = Math.min(b[2], x0 + Math.max(40, t.w * W * 1.04)), y1 = Math.min(b[3], y0 + Math.max(t.h * H * 1.25, lines * size * 1.4 + 4));
        const a = page.createAnnotation('FreeText'); a.setRect([x0, y0, x1, y1]); a.setContents(String(t.text));
        a.setDefaultAppearance('Helv', size, [0, 0.19, 0.61]); try { a.setBorderWidth(0); } catch { /* version sans bordure réglable */ }
        a.update();
      }
      const mid = pdf.saveToBuffer('encrypt=none').asUint8Array().slice(); doc.destroy && doc.destroy();
      doc = m.Document.openDocument(mid, 'application/pdf');
    }
    const buf = new m.Buffer(); const writer = new m.DocumentWriter(buf, 'pdf', '');
    for (let i = 0; i < n; i++) {
      const page = doc.loadPage(i); const dev = writer.beginPage(page.getBounds());
      page.run(dev, m.Matrix.identity); writer.endPage(); page.destroy && page.destroy();
    }
    writer.close();
    return buf.asUint8Array().slice();
  } finally { doc.destroy && doc.destroy(); }
}
/** Verrouille un PDF : chiffrement AES-256 avec un mot de passe de modification aléatoire, jamais conservé. Lecture, impression et copie du texte restent permises. */
async function sealPdf(bytes) {
  return encryptPdf(bytes, { ownerPassword: require('crypto').randomBytes(24).toString('hex'), permissions: { print: true, copy: true, modify: false, annotate: false } });
}
/** Nombre de pages et dimensions (points) d'un PDF. */
async function pageSizes(bytes) {
  const m = await mu(); const doc = m.Document.openDocument(new Uint8Array(bytes), 'application/pdf');
  try { const out = []; const n = doc.countPages(); for (let i = 0; i < n; i++) { const b = doc.loadPage(i).getBounds(); out.push({ w: b[2] - b[0], h: b[3] - b[1] }); } return out; }
  finally { doc.destroy && doc.destroy(); }
}
/** Image JPEG d'une page (affichage dans le navigateur des élèves), large de « width » pixels environ. */
async function pageJpeg(bytes, index, width = 1100) {
  const m = await mu(); const doc = m.Document.openDocument(new Uint8Array(bytes), 'application/pdf');
  try {
    const page = doc.loadPage(index); const b = page.getBounds(); const k = Math.min(3, Math.max(0.5, width / Math.max(1, b[2] - b[0])));
    return Buffer.from(page.toPixmap(m.Matrix.scale(k, k), m.ColorSpace.DeviceRGB, false, true).asJPEG(82));
  } finally { doc.destroy && doc.destroy(); }
}

/** Texte et nombre de champs ou d'annotations encore modifiables d'un PDF (contrôle des copies verrouillées). */
async function describePdf(bytes) {
  const m = await mu(); const doc = m.Document.openDocument(new Uint8Array(bytes), 'application/pdf');
  try {
    const pdf = doc.asPDF(); const n = doc.countPages(); let text = ''; let editable = 0;
    for (let i = 0; i < n; i++) { const p = pdf.loadPage(i); text += p.toStructuredText('').asText() + '\n'; editable += p.getWidgets().length + p.getAnnotations().length; }
    return { pages: n, text, editable, encrypted: isEncrypted(doc), needsPassword: doc.needsPassword() };
  } finally { doc.destroy && doc.destroy(); }
}

module.exports = { inspectPdf, decryptPdf, repairPdf, encryptPdf, convertToPdf, permissionsValue, redactPdf, compressPdf, flattenToPdf, sealPdf, pageSizes, pageJpeg, describePdf, formFields };
