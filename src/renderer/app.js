/* SknEDU-studio — interface et moteur d'édition */
'use strict';
const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;

const A4 = [595.28, 841.89];
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ---------------- État ----------------
const S = {
  sources: [],          // { bytes, doc (pdf.js), cache:{} }
  pages: [],            // { uid, src, idx, rot, items:[], ocr:null, edited:[] }
  cur: 0, sel: new Set(), tool: 'select', zoom: 'fit', scale: 1, vp: null,
  filePath: null, fileName: 'Document.pdf', dirty: false, selItem: -1, renderToken: 0,
  protect: null         // { userPassword, ownerPassword, permissions } appliqué à l'enregistrement
};
const hist = { undo: [], redo: [] };
let uidc = 1;
let thumbCache = new Map();
let textCache = new Map();
// Plusieurs documents dans la même fenêtre (onglets) : chaque onglet garde son propre état
const DOCS = []; let curDoc = 0;

const curPage = () => S.pages[S.cur];
/** Taille des fichiers sources du document, en Mo (sert à alléger le travail sur les fichiers lourds). */
const docMegabytes = () => S.sources.reduce((s, x) => s + ((x && x.bytes && x.bytes.length) || 0), 0) / 1048576;
const color = () => $('#color').value;
const size = () => Math.max(4, +$('#size').value || 14);

// ---------------- Utilitaires ----------------
function msg(t) { $('#msg').textContent = t; }
function busy(t) { $('#busyMsg').textContent = t; $('#busy').hidden = false; }
function done(t) { $('#busy').hidden = true; if (t) msg(t); }
function setDirty(v) { S.dirty = v; window.api.setDirty(v || DOCS.some((d, i) => i !== curDoc && d.dirty)); updateTitle(); }
function updateTitle() { if (typeof renderDocTabs === 'function' && DOCS.length) renderDocTabs(); document.title = `${S.dirty ? '● ' : ''}${S.protect ? '🔒 ' : ''}${S.fileName} — SknEDU-studio`; }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function rgbHex(r, g, b) { return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''); }

// ---------------- Boîte de dialogue ----------------
function modal(title, html, buttons) {
  return new Promise((resolve) => {
    $('#mTitle').textContent = title; $('#mBody').innerHTML = html;
    const bar = $('#mBtns'); bar.innerHTML = '';
    const close = (v) => { $('#modal').hidden = true; $('#modal').onkeydown = null; resolve(v); };
    buttons.forEach(([label, val, primary]) => {
      const b = document.createElement('button'); b.textContent = label; if (primary) b.className = 'primary';
      b.onclick = () => { const v = typeof val === 'function' ? val() : val; if (v !== false) close(v); };
      bar.appendChild(b);
    });
    $('#modal').onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { const p = bar.querySelector('.primary'); if (p) { e.preventDefault(); p.click(); } }
    };
    $('#modal').hidden = false;
    const f = $('#mBody input, #mBody select'); if (f) f.focus();
  });
}
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); }
function dataUrlToBytes(u) { const b = atob(u.split(',')[1]); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
function bytesToDataUrl(bytes, mime = 'application/octet-stream') {
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(new Blob([bytes], { type: mime })); });
}
// PDF.js : jamais d'évaluation de code (protection contre les PDF malveillants, CVE-2024-4367)
const PDFJS_DIR = '../../node_modules/pdfjs-dist/';
function openPdfJs(data, password) {
  return pdfjsLib.getDocument({ data, password, isEvalSupported: false, enableXfa: false,
    cMapUrl: PDFJS_DIR + 'cmaps/', cMapPacked: true, standardFontDataUrl: PDFJS_DIR + 'standard_fonts/',
    wasmUrl: PDFJS_DIR + 'wasm/', iccUrl: PDFJS_DIR + 'iccs/', verbosity: 0 }).promise; // polices et encodages asiatiques non intégrés
}
// Images (signatures, photos) stockées une seule fois : l'historique d'annulation reste léger
const imgStore = new Map();
function putImg(dataUrl) { for (const [k, v] of imgStore) if (v === dataUrl) return k; const id = 'img' + (imgStore.size + 1); imgStore.set(id, dataUrl); return id; }
const srcOf = (o) => (o.ref ? imgStore.get(o.ref) : o.src);
const errMsg = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '').replace(/^BLOQUE_ADMIN: /, '').replace(/^PREMIUM: /, '⭐ ');
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
function normRect(r) { return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])]; }
function viewRect(vp, rect) { const [a, b, c, d] = normRect([...vp.convertToViewportPoint(rect[0], rect[1]), ...vp.convertToViewportPoint(rect[2], rect[3])]); return { l: a, t: b, w: c - a, h: d - b }; }
function viewToPdfRect(vp, l, t, w, h) { return normRect([...vp.convertToPdfPoint(l, t), ...vp.convertToPdfPoint(l + w, t + h)]); }
const baseName = () => S.fileName.replace(/\.pdf$/i, '');



// ---------------- Historique ----------------
const stateJson = () => JSON.stringify({ pages: S.pages, cur: S.cur, wm: S.watermark || null });
function snapshot() { hist.undo.push(stateJson()); if (hist.undo.length > 60) hist.undo.shift(); hist.redo = []; setDirty(true); }
function restore(from, to) {
  if (!from.length) return;
  to.push(stateJson());
  const st = JSON.parse(from.pop());
  S.pages = st.pages; S.watermark = st.wm || null; S.cur = Math.min(st.cur, S.pages.length - 1); S.selItem = -1; S.sel = new Set([S.cur]);
  setDirty(true); refresh();
}

// ---------------- Sources PDF ----------------
async function addSource(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); // pas de copie supplémentaire (fichiers lourds)
  const doc = await openPdfJs(u8.slice()); // PDF.js reçoit sa propre copie (transférée à son processus)
  S.sources.push({ bytes: u8, doc, cache: {}, notes: await savedMarks(doc) });
  return S.sources.length - 1;
}
/** Notes inscrites avec l'outil « Noter » et enregistrées dans le PDF (clé SknNotes des propriétés du document). */
async function savedMarks(doc) {
  const out = {};
  try {
    const md = await doc.getMetadata(); const C = md && md.info && md.info.Custom; const raw = C instanceof Map ? C.get('SknNotes') : C && C.SknNotes; // PDF.js : Map
    if (raw) for (const x of JSON.parse(raw).slice(0, 5000)) {
      if (!Number.isInteger(x.p) || x.p < 1 || !Array.isArray(x.l)) continue;
      out[x.p - 1] = x.l.filter((m) => m && Number.isFinite(+m.note) && +m.sur > 0).slice(0, 50).map((m) => ({ note: +m.note, sur: +m.sur, appr: String(m.appr || '').slice(0, 40) }));
    }
  } catch { /* PDF sans notes */ }
  return out;
}
/** Notes d'une page : celles déjà enregistrées dans le fichier + celles inscrites depuis l'ouverture. */
function pageMarks(p) {
  const src = S.sources[p.src];
  return [...((src && src.notes && src.notes[p.idx]) || []), ...p.items.filter((o) => o.mark).map((o) => ({ note: o.mark.note, sur: o.mark.sur, appr: o.mark.appr || '' }))];
}
async function getPdfPage(p) {
  const s = S.sources[p.src];
  if (!s.cache[p.idx]) s.cache[p.idx] = await s.doc.getPage(p.idx + 1);
  return s.cache[p.idx];
}
async function totalRot(p) { const pg = await getPdfPage(p); return (pg.rotate + p.rot + 360) % 360; }
function newPage(src, idx) { return { uid: uidc++, src, idx, rot: 0, items: [], ocr: null, edited: [] }; }

async function insertPdf(bytes, at = S.pages.length) {
  const src = await addSource(bytes);
  const n = S.sources[src].doc.numPages;
  const list = Array.from({ length: n }, (_, i) => newPage(src, i));
  S.pages.splice(at, 0, ...list);
  return list;
}

async function blankPdf() { const d = await PDFDocument.create(); d.addPage(A4); return d.save(); }

async function imagesToPdf(list) {
  const d = await PDFDocument.create();
  for (const bytes of list) {
    const bmp = await createImageBitmap(new Blob([bytes]));
    const k = Math.min(1, 3000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const img = await d.embedJpg(dataUrlToBytes(c.toDataURL('image/jpeg', 0.9)));
    const size = c.width > c.height ? [A4[1], A4[0]] : A4;
    const pg = d.addPage(size); const m = 14;
    const f = Math.min((size[0] - 2 * m) / c.width, (size[1] - 2 * m) / c.height);
    const w = c.width * f, h = c.height * f;
    pg.drawImage(img, { x: (size[0] - w) / 2, y: (size[1] - h) / 2, width: w, height: h });
  }
  return d.save();
}

async function textToPdf(text) {
  const d = await PDFDocument.create(); const emb = fontEmbedder(d); const font = { family: 'Calibri' };
  const fs = 11, lh = 15, m = 56, maxW = A4[0] - 2 * m;
  let pg = d.addPage(A4), y = A4[1] - m;
  const put = async (line) => { if (y < m) { pg = d.addPage(A4); y = A4[1] - m; } if (line) await drawUnicode(pg, emb, line, { x: m, y, size: fs, font }); y -= lh; };
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const words = raw.replace(/\t/g, '    ').split(' '); let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (line && await measureText(t, font, fs) > maxW) { await put(line); line = w; } else line = t;
    }
    await put(line);
  }
  return d.save();
}

/** Copie « numérisée » : chaque page devient une image fidèle (rendu identique), prête pour l'OCR. */
async function rasterPdf(pdfjsDoc, pageNums) {
  const d = await PDFDocument.create();
  for (const n of pageNums) {
    const pg = await pdfjsDoc.getPage(n);
    const v1 = pg.getViewport({ scale: 1 });
    const sc = Math.min(2.5, 3000 / Math.max(v1.width, v1.height));
    const vp = pg.getViewport({ scale: sc });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    const img = await d.embedJpg(dataUrlToBytes(c.toDataURL('image/jpeg', 0.92)));
    d.addPage([v1.width, v1.height]).drawImage(img, { x: 0, y: 0, width: v1.width, height: v1.height });
  }
  return d.save();
}

// ---------------- Chargement de fichiers ----------------
async function handleLoaded(files, at) {
  const wasEmpty = S.pages.length === 0;
  const images = [];
  let added = 0;
  if (at === undefined) at = S.pages.length;
  snapshotIfDoc();
  const notes = []; let scanned = null;
  for (const f of files) {
    try {
      if (f.error) {
        if (f.error === 'LIBREOFFICE_MISSING') { await officeMissing(f.name); continue; }
        if (f.error === 'OFFICE_LOCKED') { alert(`« ${f.name} » est protégé par un mot de passe Office.\n\nOuvrez-le une fois dans Word / PowerPoint / Excel (ou LibreOffice) avec son mot de passe, puis « Enregistrer sous » sans mot de passe ou « Imprimer › Microsoft Print to PDF » : SknEDU-studio pourra alors l'ouvrir et le modifier.`); continue; }
        alert(`Impossible d'ouvrir ${f.name} :\n${f.error}`); continue;
      }
      if (f.kind === 'image') { images.push(f.bytes); continue; }
      if (f.kind === 'images') { images.push(...f.images); if (f.note === 'xps') notes.push(` : converti en images (faites l'OCR pour en rendre le texte modifiable)`); continue; }
      if (f.kind === 'office' && f.locked) {
        const b = await unlockOffice(f); if (!b) { notes.push(` non ouvert (mot de passe requis)`); continue; }
        f.kind = 'pdf'; f.locked = false; f.bytes = b; f.note = 'office'; f.path = null;
      }
      let bytes = f.kind === 'text' ? await textToPdf(f.text) : f.bytes;
      let isScan = false;
      if (f.locked) {
        const u = await unlockFile(f);
        if (!u) { notes.push(`${f.name} non ouvert (mot de passe requis)`); continue; }
        bytes = u.bytes; isScan = u.scanned;
        if (wasEmpty && files.length === 1 && !isScan) S.protect = { userPassword: u.password, ownerPassword: '', permissions: { print: true, modify: true, copy: true, annotate: true } };
        notes.push(isScan ? `${f.name} : copie numérisée fidèle créée` : `${f.name} déverrouillé` + (S.protect ? ' (il sera réenregistré avec le même mot de passe — onglet Protéger & Comparer pour changer)' : ''));
      }
      if (f.note === 'unrestricted') notes.push(`${f.name} : restrictions de modification levées, le document est entièrement modifiable`);
      if (f.note === 'repaired') notes.push(`${f.name} : fichier endommagé réparé`);
      if (f.note === 'approx') notes.push(`${f.name} : converti sans LibreOffice (mise en page approximative — installez LibreOffice pour un rendu identique)`);
      const list = await insertPdf(bytes, at + added); added += list.length;
      if (isScan) scanned = (scanned || []).concat(list);
      if (wasEmpty && files.length === 1) { S.filePath = f.kind === 'pdf' && !f.locked && !f.note ? f.path : null; S.fileName = f.name.replace(/\.[^.]+$/, '') + '.pdf'; S.origin = f.orig && f.orig.ext !== 'pdf' ? f.orig : null; S.readOnly = window.isReadOnlyPdf ? await window.isReadOnlyPdf(bytes) : false; }
    } catch (e) { alert(`Erreur avec ${f.name} : ${errMsg(e)}`); }
  }
  if (images.length) { const list = await insertPdf(await imagesToPdf(images), at + added); added += list.length; }
  if (!added) { if (notes.length) msg(notes.join(' • ')); return 0; }
  S.cur = wasEmpty ? 0 : at; S.sel = new Set([S.cur]);
  setDirty(!(wasEmpty && files.length === 1 && files[0].kind === 'pdf' && !files[0].note && !files[0].locked));
  refresh(); showSide('pages');
  msg(notes.length ? notes.join(' • ') : `${added} page(s) ajoutée(s).`);
  if (scanned && confirm('Ce document a été converti en copie numérisée fidèle.\nRendre son texte modifiable (OCR) maintenant ?')) await runOcr(scanned);
  return added;
}

/** Fichier Office protégé : mot de passe demandé puis déchiffrement local. */
async function unlockOffice(f) {
  const wasBusy = !$('#busy').hidden; $('#busy').hidden = true;
  try {
    let wrong = false;
    for (;;) {
      const pw = await askPassword(f.name, wrong); if (pw === null) return null;
      busy('Déverrouillage et conversion…');
      const r = await window.api.unlockOffice(f.path, pw);
      if (r.ok) return r.bytes;
      $('#busy').hidden = true; wrong = true;
    }
  } catch (e) { if (/LIBREOFFICE_MISSING/.test(errMsg(e))) await officeMissing(f.name); else alert(errMsg(e)); return null; }
  finally { $('#busy').hidden = !wasBusy; }
}

async function askPassword(name, wrong) {
  return modal('Document protégé', `<p>« ${esc(name)} » est protégé par un mot de passe d'ouverture.</p>
    ${wrong ? '<p class="err">Mot de passe incorrect, réessayez.</p>' : ''}
    <input type="password" id="pw" placeholder="Mot de passe" autocomplete="off">
    <p class="muted">Sans le mot de passe, le contenu chiffré ne peut pas être lu (ni par SknEDU-studio, ni par un autre logiciel).</p>`,
  [['Annuler', null], ['Ouvrir', () => $('#pw').value, true]]);
}
/** Déverrouille un PDF : déchiffrement complet (structure intacte), sinon copie numérisée fidèle. */
async function unlockFile(f) {
  const wasBusy = !$('#busy').hidden; $('#busy').hidden = true;
  try {
    let wrong = false;
    for (;;) {
      const pw = await askPassword(f.name, wrong);
      if (pw === null) return null;
      busy('Déverrouillage…');
      let r = null;
      try { r = await window.api.unlockPdf(f.bytes, pw); } catch { r = null; }
      if (r && r.ok) return { bytes: r.bytes, password: pw, scanned: false };
      if (!r) { // déchiffrement impossible : PDF.js lit le document et on en fait une copie numérisée
        try {
          const d = await openPdfJs(new Uint8Array(f.bytes), pw);
          busy('Création d\'une copie numérisée fidèle…');
          return { bytes: await rasterPdf(d, Array.from({ length: d.numPages }, (_, i) => i + 1)), password: pw, scanned: true };
        } catch (e) { if (!(e && e.name === 'PasswordException')) throw e; }
      }
      $('#busy').hidden = true; wrong = true;
    }
  } finally { $('#busy').hidden = !wasBusy; }
}
function snapshotIfDoc() { if (S.pages.length) snapshot(); }

async function officeMissing(name) {
  const wasBusy = !$('#busy').hidden; $('#busy').hidden = true;
  const c = await modal('Conversion Office', `<p>« ${esc(name)} » est un fichier Office (Word, PowerPoint, Excel…).</p>
    <p>Pour le convertir avec sa mise en page exacte, SknEDU-studio utilise <b>LibreOffice</b> (gratuit, hors-ligne), qui n'est pas encore installé sur ce PC.</p>
    <p class="muted">L'installation automatique télécharge LibreOffice (≈ 350 Mo) depuis le catalogue officiel Microsoft winget.</p>`,
  [['Annuler', null], ['Page de téléchargement', 'web'], ['Installer automatiquement', 'auto', true]]);
  if (c === 'web') window.api.openExternal('https://fr.libreoffice.org/download/telecharger-libreoffice/');
  if (c === 'auto') {
    busy('Installation de LibreOffice… (plusieurs minutes, ne fermez pas SknEDU-studio)');
    const r = await window.api.installOffice(); done();
    if (r.ok) alert('LibreOffice est installé. Rouvrez votre fichier Office : il sera converti avec sa mise en page d\'origine.');
    else if (confirm(`L'installation automatique n'a pas abouti.\n${r.log}\n\nOuvrir la page de téléchargement ?`)) window.api.openExternal('https://fr.libreoffice.org/download/telecharger-libreoffice/');
  }
  $('#busy').hidden = !wasBusy;
}

async function openFiles(insert) {
  busy('Ouverture…');
  try {
    const files = await window.api.openDialog();
    if (!files.length) return done();
    if (!insert) { if (S.pages.length) newTab(); else resetDoc(); }
    await handleLoaded(files, insert ? S.cur + 1 : 0);
    done();
  } catch (e) { done(); alert(errMsg(e)); }
}
function confirmDiscard() { return !S.dirty || confirm('Des modifications ne sont pas enregistrées. Continuer quand même ?'); }
function resetDoc() {
  S.sources = []; S.pages = []; S.cur = 0; S.sel = new Set(); S.filePath = null; S.fileName = 'Document.pdf'; S.selItem = -1; S.protect = null; S.watermark = null; S.origin = null; S.readOnly = false; S.rid = null; FIND.hits = [];
  hist.undo = []; hist.redo = []; thumbCache.clear(); textCache.clear(); setDirty(false);
}

// ---------------- Construction du PDF final ----------------
async function rotatedPng(dataUrl, R) {
  const img = await loadImg(dataUrl);
  const c = document.createElement('canvas'); const swap = R % 180 !== 0;
  c.width = swap ? img.height : img.width; c.height = swap ? img.width : img.height;
  const ctx = c.getContext('2d'); ctx.translate(c.width / 2, c.height / 2); ctx.rotate(-R * Math.PI / 180);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  return dataUrlToBytes(c.toDataURL('image/png'));
}

// ---- Formulaires : valeurs saisies écrites dans les champs d'origine ----
function applyForms(lib, forms) {
  const { PDFName, PDFHexString, PDFRef, PDFDict } = PDFLib;
  const N = (s) => PDFName.of(s);
  for (const [id, f] of Object.entries(forms || {})) {
    const m = /^(\d+)R(\d*)$/.exec(id); if (!m) continue;
    const w = lib.context.lookup(PDFRef.of(+m[1], +(m[2] || 0)));
    if (!(w instanceof PDFDict)) continue;
    let field = w;
    while (!field.get(N('T')) && field.get(N('Parent')) instanceof PDFRef) field = lib.context.lookup(field.get(N('Parent')));
    if (f.t === 'tx' || f.t === 'ch') { field.set(N('V'), PDFHexString.fromText(String(f.v))); w.delete(N('AP')); }
    else if (f.t === 'cb') { const n = N(f.v ? f.on : 'Off'); field.set(N('V'), n); w.set(N('AS'), n); }
    else if (f.t === 'rb') { if (f.v) field.set(N('V'), N(f.on)); w.set(N('AS'), N(f.v ? f.on : 'Off')); }
  }
}
/** Reconstitue / met à jour le formulaire (AcroForm) pour garder les champs interactifs. */
function rebuildAcroForm(out, libs, { inPlace = false, prune = true, needAppearances = false } = {}) {
  const { PDFName, PDFDict, PDFRef, PDFBool, PDFObjectCopier } = PDFLib;
  const N = (s) => PDFName.of(s); const ctx = out.context;
  const fields = []; const seen = new Set();
  for (const pg of out.getPages()) {
    const annots = pg.node.Annots(); if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      let ref = annots.get(i); if (!(ref instanceof PDFRef)) continue;
      let d = ctx.lookup(ref);
      if (!(d instanceof PDFDict) || d.get(N('Subtype')) !== N('Widget')) continue;
      while (d.get(N('Parent')) instanceof PDFRef) { ref = d.get(N('Parent')); d = ctx.lookup(ref); }
      if (!seen.has(ref.toString())) { seen.add(ref.toString()); fields.push(ref); }
    }
  }
  const existing = out.catalog.lookup(N('AcroForm'));
  if (inPlace && existing instanceof PDFDict) { // document d'origine : on garde son formulaire tel quel
    if (prune) existing.set(N('Fields'), ctx.obj(fields));
    if (needAppearances) existing.set(N('NeedAppearances'), PDFBool.True);
    return;
  }
  if (!fields.length) return;
  const acro = ctx.obj({});
  acro.set(N('Fields'), ctx.obj(fields)); acro.set(N('NeedAppearances'), PDFBool.True);
  const src = Object.values(libs).map((l) => l.catalog.lookup(N('AcroForm'))).find((a) => a instanceof PDFDict);
  if (src) {
    const lib = Object.values(libs).find((l) => l.catalog.lookup(N('AcroForm')) === src);
    const copier = PDFObjectCopier.for(lib.context, ctx);
    for (const k of ['DR', 'DA', 'Q']) { const v = src.get(N(k)); if (v) acro.set(N(k), copier.copy(v)); }
  }
  out.catalog.set(N('AcroForm'), ctx.register(acro));
}

/**
 * Suppression définitive du contenu d'origine sous les zones masquées et les textes corrigés
 * (sinon l'ancien texte resterait sélectionnable et copiable sous le cache).
 */
async function redactedSources(list) {
  const count = {}; list.forEach((p) => { const k = p.src + ':' + p.idx; count[k] = (count[k] || 0) + 1; });
  const zones = {};
  for (const p of list) {
    if (count[p.src + ':' + p.idx] > 1) continue; // page dupliquée : on ne touche pas à la source commune
    const zs = p.items.filter((o) => o.type === 'rect' && o.kind === 'whiteout').map((o) => {
      const r = normRect(o.rect); const s = o.edit ? 1.2 : 0;
      return { rect: [r[0] + s, r[1] + s, r[2] - s, r[3] - s], full: !o.edit };
    }).filter((z) => z.rect[2] > z.rect[0] && z.rect[3] > z.rect[1]);
    if (zs.length) (zones[p.src] = zones[p.src] || {})[p.idx] = zs;
  }
  const res = {};
  for (const src of new Set(list.map((p) => p.src))) {
    let b = S.sources[src].bytes;
    if (zones[src]) { try { b = await window.api.redactPdf(b, zones[src]); } catch (e) { console.warn('suppression définitive impossible', e); } }
    res[src] = b;
  }
  return res;
}

async function buildPdf(list = S.pages) {
  const { PDFName, PDFHexString } = PDFLib;
  const N = (s) => PDFName.of(s);
  const srcBytes = await redactedSources(list);
  // Un seul document d'origine, sans page dupliquée : on le modifie sur place pour garder
  // signets, liens, propriétés, pièces jointes, étiquettes de pages et formulaire d'origine.
  const inPlace = list.length > 0 && list.every((p) => p.src === list[0].src) && new Set(list.map((p) => p.idx)).size === list.length;
  const libs = {}; const pagesOut = []; let out; let formsApplied = false; let pruned = false;
  if (inPlace) {
    out = await PDFDocument.load(srcBytes[list[0].src], { ignoreEncryption: true, updateMetadata: false });
    libs[list[0].src] = out;
    const orig = out.getPages();
    for (const pg of orig) for (const k of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) {
      if (!pg.node.get(N(k))) { const v = pg.node.getInheritableAttribute(N(k)); if (v) pg.node.set(N(k), v); }
    }
    for (const p of list) if (p.forms && Object.keys(p.forms).length) { applyForms(out, p.forms); formsApplied = true; }
    pruned = list.length !== orig.length;
    const same = !pruned && list.every((p, i) => p.idx === i);
    if (!same) {
      for (let i = orig.length - 1; i >= 0; i--) out.removePage(i);
      for (const p of list) out.addPage(orig[p.idx]);
    }
    for (const p of list) pagesOut.push(orig[p.idx]);
  } else {
    out = await PDFDocument.create();
    for (const p of list) {
      if (!libs[p.src]) libs[p.src] = await PDFDocument.load(srcBytes[p.src], { ignoreEncryption: true, updateMetadata: false });
      if (p.forms && Object.keys(p.forms).length) applyForms(libs[p.src], p.forms);
      const [cp] = await out.copyPages(libs[p.src], [p.idx]);
      out.addPage(cp); pagesOut.push(cp);
    }
    try { // propriétés du premier document
      const first = libs[list[0].src];
      if (first.getTitle()) out.setTitle(first.getTitle());
      if (first.getAuthor()) out.setAuthor(first.getAuthor());
      if (first.getSubject()) out.setSubject(first.getSubject());
      if (first.getKeywords()) out.setKeywords([first.getKeywords()]);
    } catch { /* sans propriétés */ }
  }
  const emb = fontEmbedder(out);
  const newFields = [];
  for (let n = 0; n < list.length; n++) {
    const p = list[n]; const cp = pagesOut[n];
    const pg = await getPdfPage(p);
    const R = (pg.rotate + p.rot + 360) % 360;
    cp.setRotation(degrees(R));
    if (p.crop) { const [x1, y1, x2, y2] = normRect(p.crop); cp.setCropBox(x1, y1, x2 - x1, y2 - y1); }
    const vp = pg.getViewport({ scale: 1, rotation: R });
    const textAt = (vx, vy, txt, sz, opts = {}) => {
      const [x, y] = vp.convertToPdfPoint(vx, vy);
      return drawUnicode(cp, emb, txt, { x, y, size: sz, rotate: R, ...opts });
    };
    // Couche de texte invisible (OCR) : rend la page cherchable et copiable
    if (p.ocr) for (const w of p.ocr.words) {
      const r = viewRect(vp, w.rect); const w1 = await measureText(w.text, null, 1);
      if (!w1 || r.h <= 0) continue;
      const sz = Math.max(1, Math.min(r.h * 1.1, r.w / w1));
      await textAt(r.l, r.t + r.h * 0.8, w.text, sz, { opacity: 0 });
    }
    for (const o of p.items) {
      if (o.type === 'rect') {
        const [x1, y1, x2, y2] = normRect(o.rect); const box = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
        if (o.kind === 'highlight') cp.drawRectangle({ ...box, color: hexRgb(o.color || '#F1B434'), opacity: 0.38, blendMode: 'Multiply' });
        else if (o.kind === 'whiteout') cp.drawRectangle({ ...box, color: o.color && o.color.length === 7 ? hexRgb(o.color) : rgb(1, 1, 1) });
        else if (o.kind === 'ellipse') cp.drawEllipse({ x: x1 + box.width / 2, y: y1 + box.height / 2, xScale: box.width / 2, yScale: box.height / 2, borderColor: hexRgb(o.color), borderWidth: o.width || 2 });
        else cp.drawRectangle({ ...box, borderColor: hexRgb(o.color), borderWidth: o.width || 2 });
      } else if (o.type === 'field') {
        newFields.push({ o, cp, R });
      } else if (o.type === 'image') {
        const [x1, y1, x2, y2] = normRect(o.rect);
        const img = await out.embedPng(await rotatedPng(srcOf(o), R));
        cp.drawImage(img, { x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
      } else if (o.type === 'ink') {
        for (let i = 1; i < o.points.length; i++) {
          const [a, b] = [o.points[i - 1], o.points[i]];
          cp.drawLine({ start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thickness: o.width, color: hexRgb(o.color), lineCap: 1 });
        }
        if (o.arrow && o.points.length > 1) {
          const b = o.points[o.points.length - 1]; const h = arrowHead(o.points[o.points.length - 2], b, Math.max(9, o.width * 4));
          for (const e of h) cp.drawLine({ start: { x: e[0], y: e[1] }, end: { x: b[0], y: b[1] }, thickness: o.width, color: hexRgb(o.color), lineCap: 1 });
        }
      } else if (o.type === 'text') {
        const [vx, vy] = vp.convertToViewportPoint(...o.at);
        const lines = o.text.split('\n');
        for (let i = 0; i < lines.length; i++) if (lines[i]) await textAt(vx, vy + o.size * (0.85 + i * 1.2), lines[i], o.size, { color: hexRgb(o.color), font: o.font });
      } else if (o.type === 'note') { // commentaire PDF standard (note repliable, lisible dans tous les lecteurs)
        const [x, y] = o.at; const c = hexRgb(o.color || '#ffd400');
        const annot = out.context.obj({
          Type: 'Annot', Subtype: 'Text', Rect: [x, y - 20, x + 20, y], Name: 'Comment', F: 4, Open: false,
          C: [c.red, c.green, c.blue], Contents: PDFHexString.fromText(o.text || ''), T: PDFHexString.fromText(o.author || (window.PREFS && PREFS.teacher) || 'SknEDU-studio'),
          M: PDFLib.PDFString.fromDate(new Date())
        });
        cp.node.addAnnot(out.context.register(annot));
      }
    }
    if (S.watermark && S.watermark.text) { // filigrane en diagonale, centré
      const W = S.watermark; const size = W.size || 60;
      const w = await measureText(W.text, { family: 'Arial', bold: true }, size);
      const c = Math.SQRT1_2; const cx = vp.width / 2, cy = vp.height / 2;
      const sx = cx - (w / 2) * c + size * 0.35 * c, sy = cy + (w / 2) * c + size * 0.35 * c;
      const [x, y] = vp.convertToPdfPoint(sx, sy);
      await drawUnicode(cp, emb, W.text, { x, y, size, rotate: R + 45, font: { family: 'Arial', bold: true }, color: hexRgb(W.color || '#c0392b'), opacity: W.opacity ?? 0.18 });
    }
  }
  try { rebuildAcroForm(out, libs, { inPlace, prune: pruned, needAppearances: formsApplied }); } catch (e) { console.warn('formulaire', e); }
  if (newFields.length) {
    const form = out.getForm(); const used = new Set(form.getFields().map((f) => f.getName()));
    for (const { o, cp, R } of newFields) {
      const [x1, y1, x2, y2] = normRect(o.rect);
      let name = (o.name || 'champ').replace(/[.\s]/g, '_'); let k = 1;
      while (used.has(name)) name = `${o.name || 'champ'}_${++k}`;
      used.add(name);
      const opt = { x: x1, y: y1, width: x2 - x1, height: y2 - y1, borderColor: rgb(0.45, 0.45, 0.5), borderWidth: 1, rotate: degrees(R) };
      try {
        if (o.kind === 'check') form.createCheckBox(name).addToPage(cp, opt);
        else {
          const f = form.createTextField(name); if (y2 - y1 > 36) f.enableMultiline();
          f.addToPage(cp, { ...opt, backgroundColor: rgb(0.94, 0.96, 1) });
        }
      } catch (e) { console.warn('champ', name, e); }
    }
  }
  try { // notes attribuées (outil « Noter ») : gardées dans le fichier pour le relevé des notes après réouverture
    const notes = list.map((p, i) => ({ p: i + 1, l: pageMarks(p) })).filter((x) => x.l.length); const info = out.getInfoDict();
    if (notes.length) info.set(N('SknNotes'), PDFHexString.fromText(JSON.stringify(notes))); else info.delete(N('SknNotes'));
  } catch (e) { console.warn('notes', e); }
  return out.save({ updateFieldAppearances: false });
}

async function save(asNew) {
  if (!S.pages.length) return;
  if (!can('save')) return denied('save');
  if (!asNew && S.origin && window.saveOriginDialog && await window.saveOriginDialog()) return;
  busy('Enregistrement…');
  try {
    let bytes = await buildPdf();
    if (S.protect) bytes = await window.api.encryptPdf(bytes, S.protect);
    const p = await window.api.save({ bytes, defaultName: S.fileName, filters: [{ name: 'PDF', extensions: ['pdf'] }], filePath: asNew ? null : S.filePath });
    if (p) { S.filePath = p; S.fileName = p.split(/[\\/]/).pop(); setDirty(false); done(`Enregistré : ${p}`); } else done();
  } catch (e) { done(); alert('Échec de l\'enregistrement : ' + errMsg(e)); }
}

// ---------------- Rendu ----------------
async function renderPage() {
  const p = curPage();
  const token = ++S.renderToken;
  $('#welcome').hidden = !!p; $('#pageBox').hidden = !p;
  $('#pageLbl').textContent = p ? `${S.cur + 1} / ${S.pages.length}` : '–';
  if (!p) { ['#formLayer', '#overlayLayer', '#textLayer'].forEach((s) => { $(s).innerHTML = ''; }); layoutStack(); return; }
  $('#formLayer').innerHTML = '';
  const pg = await getPdfPage(p);
  const R = (pg.rotate + p.rot + 360) % 360;
  const base = pg.getViewport({ scale: 1, rotation: R });
  S.scale = pageScale(base);
  $('#zoomLbl').textContent = (S.zoom === 'fit' ? 'Largeur ' : S.zoom === 'page' ? 'Page ' : '') + `${Math.round(S.scale * 100)} %`;
  const vp = pg.getViewport({ scale: S.scale, rotation: R });
  const dpr = window.devicePixelRatio || 1;
  const c = document.createElement('canvas');
  c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr);
  c.style.width = vp.width + 'px'; c.style.height = vp.height + 'px';
  if (S.renderTask) { try { S.renderTask.cancel(); } catch { /* déjà terminé */ } }
  const task = pg.render({ canvasContext: c.getContext('2d'), viewport: pg.getViewport({ scale: S.scale * dpr, rotation: R }), annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS });
  S.renderTask = task;
  try { await task.promise; } catch (e) { if (e && e.name === 'RenderingCancelledException') return; throw e; } finally { if (S.renderTask === task) S.renderTask = null; }
  if (token !== S.renderToken) return;
  c.id = 'canvas'; $('#canvas').replaceWith(c);
  S.vp = vp;
  const box = $('#pageBox'); box.style.width = vp.width + 'px'; box.style.height = vp.height + 'px';
  await layoutStack();
  drawItems();
  await drawFormLayer(pg, p);
  await drawTextLayer();
  drawFindLayer();
  if (window.afterRender) window.afterRender(pg, p);
  $('#ocrText').value = p.ocr ? p.ocr.text : '';
}

// ---------------- Défilement continu : toutes les pages l'une sous l'autre ----------------
// La page courante est la page « vivante » (#pageBox, modifiable) ; les autres sont des images rendues
// seulement quand elles approchent de l'écran. En défilant, la page au centre devient la page courante.
const VIEW = { mode: null, sig: '', holder: -1, lock: false, io: null, fromScroll: false, raf: 0 };
function continuous() {
  if (VIEW.mode === null) { try { VIEW.mode = localStorage.getItem('edupdf.view') || 'continu'; } catch { VIEW.mode = 'continu'; } }
  return VIEW.mode === 'continu';
}
function pageScale(b) {
  const w = $('#viewWrap');
  if (S.zoom === 'fit') return Math.min(Math.max((w.clientWidth - 60) / b.width, 0.3), 2.5);
  if (S.zoom === 'page') return Math.min(Math.max(Math.min((w.clientWidth - 60) / b.width, (w.clientHeight - 48) / b.height), 0.2), 2.5);
  return S.zoom;
}
async function slotDims(p) {
  const pg = await getPdfPage(p); const R = (pg.rotate + p.rot + 360) % 360; const b = pg.getViewport({ scale: 1, rotation: R }); const k = pageScale(b);
  return { w: b.width * k, h: b.height * k };
}
async function layoutStack() {
  const wrap = $('#viewWrap'); const box = $('#pageBox'); let st = $('#pageStack');
  if (!continuous() || !S.pages.length) {
    if (st) { wrap.appendChild(box); st.parentNode.removeChild(st); if (VIEW.io) VIEW.io.disconnect(); }
    VIEW.sig = ''; VIEW.holder = -1; return;
  }
  const dims = []; for (const p of S.pages) dims.push(await slotDims(p));
  const sig = S.pages.map((p, i) => `${p.uid}:${Math.round(dims[i].w)}x${Math.round(dims[i].h)}`).join(',');
  if (!st) { st = document.createElement('div'); st.id = 'pageStack'; wrap.appendChild(st); }
  let rebuilt = false;
  if (sig !== VIEW.sig) {
    wrap.appendChild(box); st.innerHTML = ''; if (VIEW.io) VIEW.io.disconnect();
    VIEW.io = new IntersectionObserver((en) => en.forEach((e) => {
      if (e.isIntersecting) paintSlot(e.target);
      else if (+e.target.dataset.i !== VIEW.holder) { e.target.innerHTML = ''; e.target._painted = false; } // mémoire libérée loin de l'écran
    }), { root: wrap, rootMargin: '900px 0px' });
    S.pages.forEach((p, i) => {
      const d = document.createElement('div'); d.className = 'pslot'; d.dataset.i = i; d._p = p;
      Object.assign(d.style, { width: dims[i].w + 'px', height: dims[i].h + 'px' }); st.appendChild(d); VIEW.io.observe(d);
    });
    VIEW.sig = sig; VIEW.holder = -1; rebuilt = true;
  }
  const slots = st.children; const slot = slots[S.cur]; if (!slot) return;
  if (VIEW.holder !== S.cur) {
    const old = slots[VIEW.holder]; VIEW.holder = S.cur;
    if (old) { old._painted = false; paintSlot(old); } // l'ancienne page reprend son image, avec les modifications
    slot.innerHTML = ''; slot.appendChild(box);
  }
  const mid = wrap.scrollTop + wrap.clientHeight / 2;
  if (rebuilt || (!VIEW.fromScroll && (slot.offsetTop > mid || slot.offsetTop + slot.offsetHeight < mid))) {
    VIEW.lock = true; wrap.scrollTop = slot.offsetTop - 12; requestAnimationFrame(() => requestAnimationFrame(() => { VIEW.lock = false; }));
  }
  VIEW.fromScroll = false;
}
async function paintSlot(d) {
  const i = +d.dataset.i; const p = S.pages[i];
  if (i === VIEW.holder || d._painted || !p || d._p !== p) return;
  d._painted = true;
  try {
    const pg = await getPdfPage(p); const R = (pg.rotate + p.rot + 360) % 360; const b = pg.getViewport({ scale: 1, rotation: R });
    const dpr = window.devicePixelRatio || 1; const vp = pg.getViewport({ scale: pageScale(b) * dpr, rotation: R });
    const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS }).promise;
    await paintItems(ctx, vp, p);
    if (+d.dataset.i === VIEW.holder || !d.isConnected || !d._painted) return;
    d.innerHTML = ''; d.appendChild(c);
  } catch { d._painted = false; }
}
function markThumbs() {
  $$('#thumbs .thumb').forEach((t) => { const i = +t.dataset.i; t.classList.toggle('cur', i === S.cur); t.classList.toggle('sel', S.sel.has(i)); });
  const c = $('#thumbs').children[S.cur]; if (c && !$('#thumbs').hidden) c.scrollIntoView({ block: 'nearest' });
  $('#pageLbl').textContent = `${S.cur + 1} / ${S.pages.length}`;
}
$('#viewWrap').addEventListener('scroll', () => {
  if (!continuous() || VIEW.lock || VIEW.raf) return;
  VIEW.raf = requestAnimationFrame(() => {
    VIEW.raf = 0; const st = $('#pageStack'); if (!st || VIEW.lock) return;
    const ae = document.activeElement; if ((ae && ae.isContentEditable) || drag) return; // ne pas changer de page pendant une saisie
    const wrap = $('#viewWrap'); const mid = wrap.scrollTop + wrap.clientHeight / 2; let idx = -1;
    for (const d of st.children) { if (d.offsetTop + d.offsetHeight + 16 >= mid) { idx = +d.dataset.i; break; } }
    if (idx >= 0 && idx !== S.cur && S.pages[idx]) { S.cur = idx; S.sel = new Set([idx]); S.selItem = -1; VIEW.fromScroll = true; renderPage(); markThumbs(); }
  });
}, { passive: true });
function setViewMode(m) { VIEW.mode = m; try { localStorage.setItem('edupdf.view', m); } catch { /* */ } VIEW.sig = ''; renderPage(); msg(m === 'continu' ? 'Défilement continu : faites défiler les pages de haut en bas.' : 'Affichage page par page.'); }

/** Supprime un élément ; pour un texte modifié, retire aussi son cache et rétablit le texte d'origine. */
function removeItem(p, i) {
  const o = p.items[i]; if (!o) return;
  if (!o.grp) { p.items.splice(i, 1); return; }
  const keys = p.items.filter((x) => x.grp === o.grp).flatMap((x) => x.keys || []);
  p.items = p.items.filter((x) => x.grp !== o.grp); p.edited = p.edited.filter((k) => !keys.includes(k));
}

let thumbTimer = null;
function drawItems() {
  clearTimeout(thumbTimer); thumbTimer = setTimeout(renderThumbs, 700);
  const p = curPage(); const vp = S.vp; const layer = $('#overlayLayer');
  layer.innerHTML = '';
  if (!p || !vp) return;
  p.items.forEach((o, i) => {
    const el = document.createElement('div'); el.className = 'ov'; el.dataset.i = i;
    if (o.type === 'rect' || o.type === 'image') {
      const r = viewRect(vp, o.rect); Object.assign(el.style, { left: r.l + 'px', top: r.t + 'px', width: r.w + 'px', height: r.h + 'px' });
      el.classList.add(o.type === 'image' ? 'image' : o.kind);
      if (o.kind === 'box' || o.kind === 'ellipse') el.style.borderColor = o.color, el.style.borderWidth = (o.width || 2) * S.scale + 'px';
      if (o.kind === 'whiteout' && o.color && o.color.length === 7) el.style.background = o.color;
      if (o.kind === 'highlight' && o.color) el.style.background = o.color + '61';
      if (o.type === 'image') { const im = document.createElement('img'); im.src = srcOf(o); el.appendChild(im); }
      const h = document.createElement('div'); h.className = 'handle'; el.appendChild(h);
    } else if (o.type === 'note') {
      const [x, y] = vp.convertToViewportPoint(...o.at);
      el.classList.add('note'); el.textContent = '💬'; el.title = o.text || '(commentaire vide)';
      Object.assign(el.style, { left: x + 'px', top: y + 'px', background: o.color || '#ffd400' });
    } else if (o.type === 'field') {
      const r = viewRect(vp, o.rect); Object.assign(el.style, { left: r.l + 'px', top: r.t + 'px', width: r.w + 'px', height: r.h + 'px' });
      el.classList.add('field', o.kind); el.innerHTML = `<span>${o.kind === 'check' ? '☐' : esc(o.name || 'champ')}</span><div class="handle"></div>`;
    } else if (o.type === 'text') {
      const [x, y] = vp.convertToViewportPoint(...o.at);
      el.classList.add('text'); el.textContent = o.text;
      Object.assign(el.style, { left: x + 'px', top: y + 'px', fontSize: o.size * S.scale + 'px', color: o.color, fontFamily: cssFont(o.font),
        fontWeight: o.font && o.font.bold ? 'bold' : 'normal', fontStyle: o.font && o.font.italic ? 'italic' : 'normal' });
    } else if (o.type === 'ink') {
      const pts = o.points.map((q) => vp.convertToViewportPoint(...q));
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const l = Math.min(...xs), t = Math.min(...ys);
      Object.assign(el.style, { left: l + 'px', top: t + 'px', width: Math.max(...xs) - l + 'px', height: Math.max(...ys) - t + 'px' });
      const head = o.arrow && pts.length > 1 ? arrowHead(pts[pts.length - 2], pts[pts.length - 1], Math.max(9, o.width * 4) * S.scale) : null;
      const pad = head ? Math.max(9, o.width * 4) * S.scale : 0; // la pointe dépasse du cadre du trait
      Object.assign(el.style, { left: l - pad + 'px', top: t - pad + 'px', width: Math.max(...xs) - l + 2 * pad + 'px', height: Math.max(...ys) - t + 2 * pad + 'px' });
      const sh = (q) => `${q[0] - l + pad},${q[1] - t + pad}`; const last = pts[pts.length - 1];
      el.innerHTML = `<svg width="100%" height="100%" style="overflow:visible"><polyline fill="none" stroke="${o.color}" stroke-width="${o.width * S.scale}" stroke-linecap="round" stroke-linejoin="round" points="${pts.map(sh).join(' ')}"/>${head ? `<polyline fill="none" stroke="${o.color}" stroke-width="${o.width * S.scale}" stroke-linecap="round" stroke-linejoin="round" points="${sh(head[0])} ${sh(last)} ${sh(head[1])}"/>` : ''}</svg>`;
    }
    if (i === S.selItem) el.classList.add('sel');
    layer.appendChild(el);
  });
  // Zone rognée : l'extérieur est grisé
  if (p.crop) {
    const r = viewRect(vp, p.crop); const W = vp.width, H = vp.height;
    [[0, 0, W, r.t], [0, r.t + r.h, W, H - r.t - r.h], [0, r.t, r.l, r.h], [r.l + r.w, r.t, W - r.l - r.w, r.h]].forEach(([l, t, w, h]) => {
      const d = document.createElement('div'); d.className = 'cropmask'; Object.assign(d.style, { left: l + 'px', top: t + 'px', width: Math.max(0, w) + 'px', height: Math.max(0, h) + 'px' }); layer.appendChild(d);
    });
  }
  if (S.watermark && S.watermark.text) {
    const d = document.createElement('div'); d.className = 'wm'; d.textContent = S.watermark.text;
    Object.assign(d.style, { fontSize: (S.watermark.size || 60) * S.scale + 'px', color: S.watermark.color || '#c0392b', opacity: S.watermark.opacity ?? 0.18 });
    layer.appendChild(d);
  }
  const o = p.items[S.selItem];
  $('#selInfo').textContent = o ? `Élément sélectionné : ${({ text: 'texte', rect: 'forme', image: 'image', ink: 'tracé', field: 'champ de formulaire', note: 'commentaire' })[o.type]} — Suppr pour l'effacer` : 'Aucun élément sélectionné';
  if (o && o.type === 'text') {
    const f = o.font || { family: 'Arial' };
    $('#fontFam').value = FONT_FAMILIES[f.family] ? f.family : 'Arial'; $('#fontB').checked = !!f.bold; $('#fontI').checked = !!f.italic;
    $('#size').value = o.size; $('#color').value = o.color && o.color.length === 7 ? o.color : '#000000';
  }
  if (window.afterItems) window.afterItems();
}

// ---------------- Formulaires existants (champs à remplir) ----------------
async function drawFormLayer(pg, p) {
  const layer = $('#formLayer'); layer.innerHTML = '';
  let annots = [];
  try { annots = await pg.getAnnotations({ intent: 'display' }); } catch { annots = []; }
  p.forms = p.forms || {};
  const radios = annots.filter((a) => a.fieldType === 'Btn' && a.radioButton);
  for (const a of annots) {
    if (a.subtype !== 'Widget' || a.hidden || !a.rect) continue;
    const r = viewRect(S.vp, a.rect); const cur = p.forms[a.id]; let el;
    const set = (val) => { snapshot(); p.forms[a.id] = val; };
    if (a.fieldType === 'Tx') {
      el = document.createElement(a.multiLine ? 'textarea' : 'input');
      el.value = cur ? cur.v : (a.fieldValue || '');
      if (a.maxLen) el.maxLength = a.maxLen;
      el.style.fontSize = Math.max(8, Math.min(r.h * 0.62, 14 * S.scale)) + 'px';
      el.onchange = () => set({ t: 'tx', v: el.value });
    } else if (a.fieldType === 'Btn' && a.checkBox) {
      el = document.createElement('input'); el.type = 'checkbox';
      el.checked = cur ? cur.v : (!!a.fieldValue && a.fieldValue !== 'Off');
      el.onchange = () => set({ t: 'cb', v: el.checked, on: a.exportValue || 'Yes' });
    } else if (a.fieldType === 'Btn' && a.radioButton) {
      el = document.createElement('input'); el.type = 'radio'; el.name = `rb_${p.uid}_${a.fieldName}`;
      el.checked = cur ? cur.v : a.fieldValue === a.buttonValue;
      el.onchange = () => {
        snapshot();
        radios.filter((b) => b.fieldName === a.fieldName).forEach((b) => { p.forms[b.id] = { t: 'rb', v: b.id === a.id, on: b.buttonValue }; });
      };
    } else if (a.fieldType === 'Ch') {
      el = document.createElement('select');
      (a.options || []).forEach((o) => { const op = document.createElement('option'); op.value = o.exportValue; op.textContent = o.displayValue; el.appendChild(op); });
      const v = cur ? cur.v : (Array.isArray(a.fieldValue) ? a.fieldValue[0] : a.fieldValue);
      if (v !== undefined) el.value = v;
      el.onchange = () => set({ t: 'ch', v: el.value });
    } else continue;
    if (a.readOnly || !can('forms')) el.disabled = true;
    el.className = 'fw'; el.title = a.alternativeText || a.fieldName || '';
    Object.assign(el.style, { left: r.l + 'px', top: r.t + 'px', width: r.w + 'px', height: r.h + 'px' });
    el.addEventListener('keydown', (e) => e.stopPropagation());
    layer.appendChild(el);
  }
}

// Couleurs du texte et du fond sous une zone de la page (pour une correction invisible)
function sampleColors(r, canvas, scaleK) {
  const c = canvas || $('#canvas'); const k = scaleK || c.width / parseFloat(c.style.width || c.width);
  const x = Math.max(0, Math.floor(r.l * k)), y = Math.max(0, Math.floor(r.t * k));
  const w = Math.min(c.width - x, Math.ceil(r.w * k)), h = Math.min(c.height - y, Math.ceil(r.h * k));
  if (w < 1 || h < 1) return { fg: '#000000', bg: '#ffffff' };
  const d = c.getContext('2d').getImageData(x, y, w, h).data;
  const hist = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const key = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
    const e = hist.get(key) || [0, 0, 0, 0]; e[0]++; e[1] += d[i]; e[2] += d[i + 1]; e[3] += d[i + 2]; hist.set(key, e);
  }
  let best = null; for (const e of hist.values()) if (!best || e[0] > best[0]) best = e;
  const bg = [best[1] / best[0], best[2] / best[0], best[3] / best[0]];
  const far = [];
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
    if (dist > 90) far.push([dist, d[i], d[i + 1], d[i + 2]]);
  }
  let fg = [0, 0, 0];
  if (far.length) {
    far.sort((a, b) => b[0] - a[0]); const top = far.slice(0, Math.max(1, Math.ceil(far.length * 0.3)));
    fg = [0, 1, 2].map((j) => top.reduce((s, q) => s + q[j + 1], 0) / top.length);
  }
  return { fg: rgbHex(...fg), bg: rgbHex(...bg) };
}

async function getTextItems(p) {
  const key = `${p.src}:${p.idx}`;
  if (!textCache.has(key)) {
    const pg = await getPdfPage(p); const tc = await pg.getTextContent();
    textCache.set(key, tc.items.map((it, i) => {
      const [a, b, c, d, e, f] = it.transform; const h = Math.hypot(c, d);
      if (!it.str.trim() || Math.abs(b) > 0.01 || a < 0) return null;
      const st = tc.styles[it.fontName] || {};
      return { key: 'n' + i, text: it.str, size: h, base: [e, f], fontName: it.fontName, fallback: st.fontFamily, rect: [e, f - 0.22 * h, e + it.width, f + 0.9 * h] };
    }).filter(Boolean));
  }
  const list = [...textCache.get(key)];
  if (p.ocr) p.ocr.lines.forEach((l, i) => { if (l.text) list.push({ key: 'o' + i, text: l.text, ocr: true, rect: l.rect }); });
  return list.filter((t) => !p.edited.includes(t.key));
}

/** Police d'origine d'un morceau de texte (connue après le rendu de la page par PDF.js). */
function fontOfItem(pg, t) {
  if (t.ocr) return { family: 'Arial', bold: false, italic: false };
  let o = null;
  try { if (t.fontName && pg.commonObjs.has(t.fontName)) o = pg.commonObjs.get(t.fontName); } catch { o = null; }
  const fb = (o && o.fallbackName) || (t.fallback === 'serif' ? 'serif' : t.fallback === 'monospace' ? 'monospace' : 'sans-serif');
  return matchFont({ name: o && o.name, bold: o && o.bold, italic: o && o.italic, black: o && o.black, fallbackName: fb });
}

async function drawTextLayer() {
  const layer = $('#textLayer'); layer.innerHTML = '';
  const p = curPage(); if (!p || (S.tool !== 'edit' && S.tool !== 'editpara')) return;
  const vp = S.vp; const pg = await getPdfPage(p);
  if (S.tool === 'editpara') { // modification par paragraphe : le texte se recompose dans la largeur d'origine
    for (const para of groupParagraphs(await getTextItems(p), pg)) {
      const r = viewRect(vp, para.rect); const fs = para.size * S.scale;
      const el = document.createElement('div'); el.className = 'tl para'; el.textContent = para.text;
      Object.assign(el.style, { left: r.l + 'px', top: r.t + 'px', width: r.w + 'px', minHeight: r.h + 'px', fontSize: fs + 'px', lineHeight: (para.lh * S.scale) + 'px',
        whiteSpace: 'pre-wrap', fontFamily: cssFont(para.font), fontWeight: para.font.bold ? 'bold' : 'normal', fontStyle: para.font.italic ? 'italic' : 'normal' });
      el.title = 'Paragraphe : cliquer pour le modifier (le texte se recompose sur la largeur du bloc). Entrée = nouvelle ligne, Ctrl+Entrée = valider, Échap = annuler.';
      el.onclick = () => startParaEdit(el, para, r);
      layer.appendChild(el);
    }
    return;
  }
  for (const t of await getTextItems(p)) {
    const r = viewRect(vp, t.rect);
    t.font = fontOfItem(pg, t);
    const sp = document.createElement('span'); sp.className = 'tl' + (t.ocr ? ' ocr' : ''); sp.textContent = t.text;
    const fs = (t.size || (Math.abs(t.rect[3] - t.rect[1]) * 0.8)) * S.scale;
    Object.assign(sp.style, { left: r.l + 'px', top: r.t + 'px', minWidth: r.w + 'px', height: r.h + 'px', fontSize: fs + 'px', paddingTop: Math.max(0, r.h - fs) / 2 + 'px',
      fontFamily: cssFont(t.font), fontWeight: t.font.bold ? 'bold' : 'normal', fontStyle: t.font.italic ? 'italic' : 'normal' });
    sp.onclick = () => startTextEdit(sp, t, r, fs / S.scale);
    layer.appendChild(sp);
  }
}

/** Regroupe les morceaux de texte en lignes, puis en paragraphes (même marge gauche, interligne régulier, même taille). */
function groupParagraphs(items, pg) {
  const runs = items.filter((t) => t.text.trim()).map((t) => { const r = normRect(t.rect); return { t, x1: r[0], x2: r[2], y1: r[1], y2: r[3], base: t.base ? t.base[1] : r[1] + (r[3] - r[1]) * 0.22, size: t.size || (r[3] - r[1]) * 0.8 }; });
  runs.sort((a, b) => b.base - a.base || a.x1 - b.x1);
  const lines = [];
  for (const r of runs) {
    const l = lines[lines.length - 1];
    if (l && Math.abs(l.base - r.base) < r.size * 0.35 && r.x1 - l.x2 < r.size * 3) { l.runs.push(r); l.x2 = Math.max(l.x2, r.x2); l.y1 = Math.min(l.y1, r.y1); l.y2 = Math.max(l.y2, r.y2); }
    else lines.push({ runs: [r], x1: r.x1, x2: r.x2, y1: r.y1, y2: r.y2, base: r.base, size: r.size });
  }
  lines.forEach((l) => { l.runs.sort((a, b) => a.x1 - b.x1); l.text = l.runs.map((r, i) => (i && r.x1 - l.runs[i - 1].x2 > r.size * 0.15 && !/\s$/.test(l.runs[i - 1].t.text) ? ' ' : '') + r.t.text).join('').replace(/\s+$/, ''); });
  const paras = [];
  for (const l of lines) {
    const P = paras[paras.length - 1]; const prev = P && P.lines[P.lines.length - 1];
    const gap = prev ? prev.base - l.base : 0;
    const same = prev && Math.abs(prev.size - l.size) < prev.size * 0.15 && gap > l.size * 0.8 && gap < l.size * 1.9 &&
      (Math.abs(prev.x1 - l.x1) < l.size * 1.5 || (l.x1 >= prev.x1 - l.size && l.x1 <= prev.x2)) && (!P.gap || Math.abs(gap - P.gap) < l.size * 0.45);
    if (same) { P.lines.push(l); P.gap = P.gap || gap; } else paras.push({ lines: [l], gap: 0 });
  }
  return paras.map((P) => {
    const ls = P.lines; const first = ls[0].runs[0].t;
    let text = ''; ls.forEach((l, i) => { text += i ? (/[-‐]$/.test(text) && /^[a-zà-ÿ]/.test(l.text) ? '' : ' ') + l.text : l.text; });
    text = text.replace(/([a-zà-ÿ])[-‐] ?(?=[a-zà-ÿ])/g, (m, c) => (m.endsWith(' ') ? c + '-' : m)); // césures conservées si choisies
    return { lines: ls, text, size: ls[0].size, lh: P.gap || ls[0].size * 1.2, font: fontOfItem(pg, first), keys: ls.flatMap((l) => l.runs.map((r) => r.t.key)),
      rect: [Math.min(...ls.map((l) => l.x1)), Math.min(...ls.map((l) => l.y1)), Math.max(...ls.map((l) => l.x2)), Math.max(...ls.map((l) => l.y2))],
      x: Math.min(...ls.map((l) => l.x1)), width: Math.max(...ls.map((l) => l.x2)) - Math.min(...ls.map((l) => l.x1)), base: ls[0].base };
  });
}
/** Découpe un texte en lignes qui tiennent dans la largeur donnée (police, taille d'origine). */
async function wrapText(text, font, size, width) {
  const out = [];
  for (const par of String(text).split('\n')) {
    let line = '';
    for (const w of par.split(/ +/)) {
      const t = line ? line + ' ' + w : w;
      if (line && await measureText(t, font, size) > width) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}
function startParaEdit(el, para, r) {
  if (el.isContentEditable) return;
  const colors = sampleColors({ l: r.l, t: r.t, w: r.w, h: r.h });
  el.contentEditable = 'true'; el.classList.add('editing'); el.focus(); document.getSelection().selectAllChildren(el);
  const finish = async (commit) => {
    el.onblur = null; el.onkeydown = null;
    const txt = el.innerText.replace(/\n+$/, '');
    if (!commit || txt === para.text) { el.contentEditable = 'false'; el.classList.remove('editing'); el.textContent = para.text; return; }
    snapshot(); const p = curPage(); const pad = 1.2; const grp = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    para.lines.forEach((l, i) => p.items.push({ type: 'rect', kind: 'whiteout', edit: true, grp, keys: i ? undefined : para.keys, color: colors.bg, rect: [l.x1 - pad, l.y1 - pad, l.x2 + pad, l.y2 + pad] }));
    const lines = txt.trim() ? await wrapText(txt, para.font, para.size, para.width + 0.5) : [];
    lines.forEach((ln, i) => {
      if (!ln) return;
      const baseY = para.base - i * para.lh; // ligne de base dans les coordonnées PDF (texte horizontal)
      p.items.push({ type: 'text', grp, at: [para.x, baseY + 0.85 * para.size], size: Math.round(para.size * 10) / 10, color: colors.fg, font: para.font, text: ln });
    });
    p.edited.push(...para.keys);
    const extra = lines.length - para.lines.length;
    drawItems(); drawTextLayer();
    msg(extra > 0 ? `Paragraphe modifié : il dépasse de ${extra} ligne(s) — vérifiez qu'il ne chevauche pas la suite.` : 'Paragraphe modifié et recomposé dans sa largeur d\'origine.');
  };
  el.onblur = () => finish(true).catch((e) => { console.error('Paragraphe :', e); msg('Modification du paragraphe impossible : ' + e.message); });
  el.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); el.blur(); } if (e.key === 'Escape') finish(false); };
}

function startTextEdit(sp, t, r, fsPdf) {
  if (sp.isContentEditable) return;
  const colors = sampleColors({ l: r.l, t: r.t, w: r.w, h: r.h }); // avant que le cadre d'édition ne masque la zone
  sp.contentEditable = 'true'; sp.classList.add('editing'); sp.focus();
  document.getSelection().selectAllChildren(sp);
  const finish = (commit) => {
    sp.onblur = null; sp.onkeydown = null;
    const txt = sp.innerText.replace(/\n+$/, '');
    if (commit && txt !== t.text) {
      snapshot();
      const p = curPage();
      const pad = 1.5;
      const grp = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      p.items.push({ type: 'rect', kind: 'whiteout', edit: true, grp, keys: [t.key], color: colors.bg, rect: viewToPdfRect(S.vp, r.l - pad, r.t - pad, r.w + 2 * pad, r.h + 2 * pad) });
      let at;
      if (t.base) { const [bx, by] = S.vp.convertToViewportPoint(...t.base); at = S.vp.convertToPdfPoint(bx, by - 0.85 * fsPdf * S.scale); }
      else at = S.vp.convertToPdfPoint(r.l, r.t + (r.h - fsPdf * S.scale) / 2);
      if (txt.trim()) p.items.push({ type: 'text', grp, at, size: Math.round(fsPdf * 10) / 10, color: colors.fg, font: t.font || { family: 'Arial' }, text: txt });
      p.edited.push(t.key);
      drawItems(); drawTextLayer(); msg('Texte modifié.');
    } else { sp.contentEditable = 'false'; sp.classList.remove('editing'); sp.textContent = t.text; }
  };
  sp.onblur = () => finish(true);
  sp.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sp.blur(); }
    if (e.key === 'Escape') finish(false);
    e.stopPropagation();
  };
}

// ---------------- Miniatures ----------------
let thumbQueue = Promise.resolve();
/** Style du texte d'origine le plus proche du point cliqué (police, taille, couleur), s'il est assez près. */
async function nearbyTextStyle(p, pos) {
  try {
    const pg = await getPdfPage(p); let best = null;
    for (const t of await getTextItems(p)) {
      if (!t.text.trim()) continue;
      const r = viewRect(S.vp, t.rect);
      const dx = Math.max(r.l - pos[0], 0, pos[0] - (r.l + r.w)); const dy = Math.max(r.t - pos[1], 0, pos[1] - (r.t + r.h));
      const d = Math.hypot(dx, dy * 1.6);
      if (!best || d < best.d) best = { d, t, r };
    }
    if (!best || best.d > Math.max(60, best.r.h * 4)) return null;
    const t = best.t; const sz = Math.round((t.size || Math.abs(t.rect[3] - t.rect[1]) * 0.8) * 10) / 10;
    const col = sampleColors(best.r).fg;
    return { font: fontOfItem(pg, t), size: sz, color: col && col.length === 7 ? col : '#000000' };
  } catch { return null; }
}
/** Deux segments de pointe de flèche au point b (venant de a), longueur L. */
function arrowHead(a, b, L) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); const s = Math.PI / 7.5;
  return [[b[0] - L * Math.cos(ang - s), b[1] - L * Math.sin(ang - s)], [b[0] - L * Math.cos(ang + s), b[1] - L * Math.sin(ang + s)]];
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
/** Dessine les ajouts d'une page sur un canevas (miniatures). */
async function paintItems(ctx, vp, p) {
  const k = vp.scale;
  for (const o of p.items) {
    if (o.type === 'rect' || o.type === 'image' || o.type === 'field') {
      const r = viewRect(vp, o.rect);
      if (o.type === 'image') { try { ctx.drawImage(await loadImg(srcOf(o)), r.l, r.t, r.w, r.h); } catch { /* image absente */ } }
      else if (o.kind === 'highlight') { ctx.save(); ctx.globalAlpha = 0.38; ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = o.color || '#F1B434'; ctx.fillRect(r.l, r.t, r.w, r.h); ctx.restore(); }
      else if (o.kind === 'whiteout') { ctx.fillStyle = o.color && o.color.length === 7 ? o.color : '#fff'; ctx.fillRect(r.l, r.t, r.w, r.h); }
      else if (o.type === 'field') { ctx.save(); ctx.setLineDash([3, 2]); ctx.strokeStyle = '#2f6fed'; ctx.strokeRect(r.l, r.t, r.w, r.h); ctx.restore(); }
      else if (o.kind === 'ellipse') { ctx.strokeStyle = o.color; ctx.lineWidth = (o.width || 2) * k; ctx.beginPath(); ctx.ellipse(r.l + r.w / 2, r.t + r.h / 2, r.w / 2, r.h / 2, 0, 0, 2 * Math.PI); ctx.stroke(); }
      else { ctx.strokeStyle = o.color; ctx.lineWidth = (o.width || 2) * k; ctx.strokeRect(r.l, r.t, r.w, r.h); }
    } else if (o.type === 'ink') {
      ctx.beginPath(); ctx.strokeStyle = o.color; ctx.lineWidth = o.width * k; ctx.lineCap = 'round';
      const vpts = o.points.map((q) => vp.convertToViewportPoint(...q));
      vpts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      if (o.arrow && vpts.length > 1) { const b = vpts[vpts.length - 1]; const h = arrowHead(vpts[vpts.length - 2], b, Math.max(9, o.width * 4) * k); ctx.beginPath(); ctx.moveTo(...h[0]); ctx.lineTo(...b); ctx.lineTo(...h[1]); ctx.stroke(); }
    } else if (o.type === 'text') {
      const [x, y] = vp.convertToViewportPoint(...o.at); const f = o.font || {};
      ctx.fillStyle = o.color; ctx.font = `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${o.size * k}px ${cssFont(f)}`;
      o.text.split('\n').forEach((ln, i) => ctx.fillText(ln, x, y + o.size * k * (0.85 + i * 1.2)));
    } else if (o.type === 'note') {
      const [x, y] = vp.convertToViewportPoint(...o.at); ctx.fillStyle = o.color || '#ffd400'; ctx.fillRect(x, y, 20 * k, 20 * k);
    }
  }
  if (p.crop) {
    const r = viewRect(vp, p.crop); ctx.save(); ctx.fillStyle = 'rgba(40,50,70,.55)';
    ctx.beginPath(); ctx.rect(0, 0, vp.width, vp.height); ctx.rect(r.l, r.t, r.w, r.h); ctx.fill('evenodd'); ctx.restore();
  }
  if (S.watermark && S.watermark.text) {
    ctx.save(); ctx.globalAlpha = S.watermark.opacity ?? 0.18; ctx.fillStyle = S.watermark.color || '#c0392b';
    ctx.font = `bold ${(S.watermark.size || 60) * k}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.translate(vp.width / 2, vp.height / 2); ctx.rotate(-Math.PI / 4); ctx.fillText(S.watermark.text, 0, 0); ctx.restore();
  }
}
const thumbObserver = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting && en.target._load) { const f = en.target._load; en.target._load = null; thumbObserver.unobserve(en.target); f(); } }), { root: document.querySelector('#thumbs'), rootMargin: '600px 0px' });
function renderThumbs() {
  const box = $('#thumbs'); thumbObserver.disconnect(); box.innerHTML = '';
  S.pages.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'thumb' + (i === S.cur ? ' cur' : '') + (S.sel.has(i) ? ' sel' : '');
    d.draggable = true; d.dataset.i = i;
    // la miniature montre aussi les ajouts (textes, surlignages, signatures, rognage, filigrane)
    const key = `${p.src}:${p.idx}:${p.rot}:${hashStr(JSON.stringify([p.items, p.crop || 0, S.watermark || 0]))}`;
    d.innerHTML = (thumbCache.has(key) ? `<img src="${thumbCache.get(key)}">` : '<div class="ph"></div>') + `<span>${i + 1}</span>` + (p.ocr ? '<b class="badge">OCR</b>' : '');
    // miniature calculée seulement quand elle devient visible (gros documents : affichage immédiat)
    if (!thumbCache.has(key)) d._load = () => thumbQueue = thumbQueue.then(async () => {
      if (!d.isConnected) return;
      const pg = await getPdfPage(p); const R = (pg.rotate + p.rot + 360) % 360;
      const v0 = pg.getViewport({ scale: 1, rotation: R }); const vp = pg.getViewport({ scale: 240 / v0.width, rotation: R });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      await paintItems(c.getContext('2d'), vp, p);
      if (thumbCache.size > 400) thumbCache.clear();
      thumbCache.set(key, c.toDataURL('image/jpeg', 0.8));
      const ph = d.querySelector('.ph'); if (ph) ph.outerHTML = `<img src="${thumbCache.get(key)}" alt="Page ${i + 1}">`;
    }).catch(() => {});
    if (d._load) thumbObserver.observe(d);
    d.onclick = (e) => {
      if (e.ctrlKey) { S.sel.has(i) ? S.sel.delete(i) : S.sel.add(i); }
      else if (e.shiftKey) { const [a, b] = [Math.min(S.cur, i), Math.max(S.cur, i)]; for (let k = a; k <= b; k++) S.sel.add(k); }
      else S.sel = new Set([i]);
      S.cur = i; S.selItem = -1; refresh();
    };
    d.ondragstart = (e) => e.dataTransfer.setData('text/page', String(i));
    d.ondragover = (e) => { if (e.dataTransfer.types.includes('text/page')) { e.preventDefault(); d.classList.add('drop'); } };
    d.ondragleave = () => d.classList.remove('drop');
    d.ondrop = (e) => {
      const from = +e.dataTransfer.getData('text/page'); d.classList.remove('drop');
      if (isNaN(from) || from === i) return;
      if (!can('pages')) return denied('pages');
      e.preventDefault(); e.stopPropagation(); snapshot();
      const [pg] = S.pages.splice(from, 1); const to = from < i ? i - 1 : i;
      S.pages.splice(to, 0, pg); S.cur = to; S.sel = new Set([to]); refresh();
    };
    box.appendChild(d);
  });
  const cur = box.children[S.cur]; if (cur) cur.scrollIntoView({ block: 'nearest' });
}

function refresh() { renderThumbs(); renderPage(); updateTitle(); }

// ---------------- Interaction sur la page ----------------
let drag = null;
function localPos(e) { const r = $('#overlayLayer').getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
function translateItem(o, dx, dy) {
  const vp = S.vp; const [x0, y0] = vp.convertToPdfPoint(0, 0); const [x1, y1] = vp.convertToPdfPoint(dx, dy);
  const ddx = x1 - x0, ddy = y1 - y0;
  if (o.rect) o.rect = [o.rect[0] + ddx, o.rect[1] + ddy, o.rect[2] + ddx, o.rect[3] + ddy];
  if (o.at) o.at = [o.at[0] + ddx, o.at[1] + ddy];
  if (o.points) o.points = o.points.map((q) => [q[0] + ddx, q[1] + ddy]);
}

$('#overlayLayer').addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !curPage()) return;
  const layer = e.currentTarget; const pos = localPos(e); const p = curPage();
  const el = e.target.closest('.ov');
  if (el && el.isContentEditable) return;
  if (S.tool === 'select') {
    if (!el) { S.selItem = -1; drawItems(); return; }
    S.selItem = +el.dataset.i; drawItems();
    const o = p.items[S.selItem];
    drag = { mode: e.target.classList.contains('handle') ? 'resize' : 'move', o, start: pos, orig: JSON.parse(JSON.stringify(o)), moved: false, snap: stateJson() };
  } else if (S.tool === 'text') {
    e.preventDefault(); snapshot();
    (async () => {
      const st = await nearbyTextStyle(p, pos);
      const sz = st ? st.size : size();
      p.items.push({ type: 'text', at: S.vp.convertToPdfPoint(pos[0], pos[1] - sz * S.scale * 0.6), size: sz, color: st ? st.color : color(), font: st ? st.font : curFont(), text: '' });
      S.selItem = p.items.length - 1; drawItems(); editTextItem(S.selItem);
      if (st) msg(`Texte adapté au texte voisin : ${st.font.family}${st.font.bold ? ' gras' : ''}, ${st.size} pt — modifiable dans Propriétés.`);
    })();
    return;
  } else if (S.tool === 'sign') {
    e.preventDefault(); placeSignature(pos); return;
  } else if (S.tool === 'note') {
    e.preventDefault(); snapshot();
    const o = { type: 'note', at: S.vp.convertToPdfPoint(pos[0] - 10, pos[1] - 10), text: '', color: '#ffd400', author: (window.PREFS && PREFS.teacher) || undefined };
    p.items.push(o); S.selItem = p.items.length - 1; drawItems(); Promise.resolve(editNote(o, true)).then(() => { if (S.tool === 'note') setTool('select'); }); return;
  } else if (S.tool === 'ink') {
    drag = { mode: 'ink', pts: [pos] };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none');
    svg.innerHTML = `<polyline fill="none" stroke="${color()}" stroke-width="${+$('#width').value * S.scale}" stroke-linecap="round" stroke-linejoin="round"/>`;
    layer.appendChild(svg); drag.svg = svg;
  } else {
    if (S.tool === 'line' || S.tool === 'arrow') {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none');
      svg.innerHTML = `<line stroke="${color()}" stroke-width="${(+$('#width').value || 2) * S.scale}" stroke-linecap="round" x1="${pos[0]}" y1="${pos[1]}" x2="${pos[0]}" y2="${pos[1]}"/>`;
      layer.appendChild(svg); drag = { mode: 'line', start: pos, svg }; layer.setPointerCapture(e.pointerId); return;
    }
    if (S.tool === 'stamp') { e.preventDefault(); if (window.placeStamp) window.placeStamp(pos); return; }
    if (S.tool === 'mark') { e.preventDefault(); if (window.placeMark) window.placeMark(pos); return; }
    const rb = document.createElement('div'); rb.className = 'rubber'; layer.appendChild(rb);
    drag = { mode: 'rubber', start: pos, rb };
  }
  layer.setPointerCapture(e.pointerId);
});

$('#overlayLayer').addEventListener('pointermove', (e) => {
  if (!drag) return;
  const pos = localPos(e);
  if (drag.mode === 'move' || drag.mode === 'resize') {
    const dx = pos[0] - drag.start[0], dy = pos[1] - drag.start[1];
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    if (!drag.moved) { hist.undo.push(drag.snap); hist.redo = []; setDirty(true); drag.moved = true; }
    const o = drag.o; Object.assign(o, JSON.parse(JSON.stringify(drag.orig)));
    if (drag.mode === 'move') translateItem(o, dx, dy);
    else { const r = viewRect(S.vp, drag.orig.rect); o.rect = viewToPdfRect(S.vp, r.l, r.t, Math.max(8, r.w + dx), Math.max(8, r.h + dy)); }
    drawItems();
  } else if (drag.mode === 'line') {
    let [x, y] = pos; if (e.shiftKey) { const dx = x - drag.start[0], dy = y - drag.start[1]; if (Math.abs(dx) > Math.abs(dy) * 2) y = drag.start[1]; else if (Math.abs(dy) > Math.abs(dx) * 2) x = drag.start[0]; }
    drag.end = [x, y]; const ln = drag.svg.firstChild; ln.setAttribute('x2', x); ln.setAttribute('y2', y);
  } else if (drag.mode === 'ink') {
    drag.pts.push(pos); drag.svg.firstChild.setAttribute('points', drag.pts.map((q) => q.join(',')).join(' '));
  } else if (drag.mode === 'rubber') {
    const [l, t] = [Math.min(pos[0], drag.start[0]), Math.min(pos[1], drag.start[1])];
    Object.assign(drag.rb.style, { left: l + 'px', top: t + 'px', width: Math.abs(pos[0] - drag.start[0]) + 'px', height: Math.abs(pos[1] - drag.start[1]) + 'px' });
  }
});

$('#overlayLayer').addEventListener('pointerup', async (e) => {
  if (!drag) return;
  const d = drag; drag = null; const p = curPage(); const pos = localPos(e);
  if (d.mode === 'line') {
    d.svg.remove(); const end = d.end || pos;
    if (Math.hypot(end[0] - d.start[0], end[1] - d.start[1]) > 4) { snapshot(); p.items.push({ type: 'ink', points: [S.vp.convertToPdfPoint(...d.start), S.vp.convertToPdfPoint(...end)], color: color(), width: +$('#width').value || 2, arrow: S.tool === 'arrow' }); S.selItem = p.items.length - 1; }
    drawItems(); return;
  }
  if (d.mode === 'ink') {
    d.svg.remove();
    if (d.pts.length > 1) { snapshot(); p.items.push({ type: 'ink', points: d.pts.map((q) => S.vp.convertToPdfPoint(...q)), color: color(), width: +$('#width').value || 2 }); }
    drawItems();
  } else if (d.mode === 'rubber') {
    d.rb.remove();
    let [l, t, w, h] = [Math.min(pos[0], d.start[0]), Math.min(pos[1], d.start[1]), Math.abs(pos[0] - d.start[0]), Math.abs(pos[1] - d.start[1])];
    if (w < 5 || h < 5) {
      if (S.tool === 'image') { w = 160; h = 120; }
      else if (S.tool === 'ftext') { w = 180 * S.scale; h = 22 * S.scale; }
      else if (S.tool === 'fcheck') { w = h = 14 * S.scale; }
      else return;
    }
    const rect = viewToPdfRect(S.vp, l, t, w, h);
    if (S.tool === 'crop') {
      const sel = selected(); snapshot();
      sel.forEach((i) => { S.pages[i].crop = rect; });
      setTool('select'); refresh(); msg(`${sel.length} page(s) rognée(s). Pages › « Annuler le rognage » pour revenir en arrière.`); return;
    }
    if (S.tool === 'ftext' || S.tool === 'fcheck') {
      const n = S.pages.reduce((s, q) => s + q.items.filter((o) => o.type === 'field').length, 0) + 1;
      snapshot(); p.items.push({ type: 'field', kind: S.tool === 'fcheck' ? 'check' : 'text', rect, name: `${S.tool === 'fcheck' ? 'case' : 'champ'}_${n}` });
      S.selItem = p.items.length - 1; setTool('select'); drawItems(); return;
    } else if (S.tool === 'image') {
      const files = await window.api.openDialog({ imagesOnly: true });
      if (!files.length || files[0].error) return;
      const src = await bytesToDataUrl(files[0].bytes, 'image/png');
      const img = await loadImg(src);
      // conserver les proportions de l'image
      const k = Math.min(w / img.width, h / img.height); const rr = viewToPdfRect(S.vp, l, t, img.width * k, img.height * k);
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0);
      snapshot(); p.items.push({ type: 'image', rect: rr, ref: putImg(c.toDataURL('image/png')) });
      S.selItem = p.items.length - 1; setTool('select'); drawItems(); return;
    } else {
      snapshot(); p.items.push({ type: 'rect', kind: S.tool, rect, color: S.tool === 'highlight' ? '#F1B434' : S.tool === 'whiteout' ? '#ffffff' : color(), width: +$('#width').value || 2 });
    }
    S.selItem = p.items.length - 1; drawItems();
  }
});

$('#overlayLayer').addEventListener('dblclick', (e) => {
  const el = e.target.closest('.ov'); if (!el) return;
  const o = curPage().items[+el.dataset.i]; if (o.type === 'text') editTextItem(+el.dataset.i);
  if (o.type === 'note') editNote(o);
});

async function editNote(o, isNew) {
  const r = await modal('Commentaire', `<textarea id="noteTxt" rows="6" style="width:100%;box-sizing:border-box">${esc(o.text || '')}</textarea>
    <p class="muted">Le commentaire apparaît comme une note repliable dans tous les lecteurs PDF (Acrobat, Edge, Chrome…).</p>`,
  [...(isNew ? [] : [['Supprimer', 'del']]), ['Annuler', null], ['Valider', () => $('#noteTxt').value, true]]);
  const p = curPage();
  if (r === 'del' || (isNew && (r === null || !r.trim()))) { const i = p.items.indexOf(o); if (i >= 0) { if (!isNew) snapshot(); p.items.splice(i, 1); } S.selItem = -1; }
  else if (r !== null && r !== o.text) { if (!isNew) snapshot(); o.text = r; }
  drawItems();
}

function editTextItem(i) {
  const el = $(`#overlayLayer .ov[data-i="${i}"]`); const p = curPage(); const o = p.items[i];
  el.contentEditable = 'true'; el.focus(); document.getSelection().selectAllChildren(el);
  const before = o.text;
  el.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Escape') el.blur(); };
  el.onblur = () => {
    const txt = el.innerText.replace(/\n+$/, '');
    if (!txt.trim()) { p.items.splice(i, 1); S.selItem = -1; }
    else if (txt !== before) { if (before) snapshot(); o.text = txt; }
    drawItems();
  };
}

function setTool(t) {
  const need = FEATURE_OF.tool[t]; if (need && !can(need)) { denied(need); t = 'select'; } // droits d'accès et lecture seule
  if (t !== 'select' && window.premiumGate && !window.premiumGate('tool', t)) t = 'select'; // fonction Premium
  S.tool = t; $$('.tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  const box = $('#pageBox'); box.className = 't-' + t;
  if (t !== 'select') { S.selItem = -1; drawItems(); }
  drawTextLayer();
  const tips = {
    select: 'Cliquez un élément pour le déplacer, le redimensionner, ou double-cliquez un texte pour le modifier.',
    edit: 'Cliquez sur un texte de la page pour le corriger (Entrée pour valider, Échap pour annuler).',
    ellipse: 'Tracez un cercle ou une ellipse en faisant glisser la souris.',
    line: 'Tracez un trait en faisant glisser la souris (Maj : horizontal ou vertical).',
    arrow: 'Tracez une flèche en faisant glisser la souris (Maj : horizontale ou verticale).',
    stamp: 'Cliquez sur la page pour poser le tampon choisi (Échap pour arrêter).',
    mark: 'Cliquez sur la copie à l\'endroit où inscrire la note.',
    editpara: 'Cliquez sur un paragraphe pour le réécrire : il se recompose dans sa largeur, avec la police, la taille et la couleur d\'origine (Ctrl+Entrée pour valider).',
    text: 'Cliquez à l\'endroit où ajouter du texte.', image: 'Tracez un cadre puis choisissez une image.',
    highlight: 'Tracez un rectangle pour surligner.', whiteout: 'Tracez un rectangle pour masquer (effacer) une zone.',
    box: 'Tracez un cadre.', ink: 'Dessinez à main levée (annotations, corrections).',
    sign: 'Cliquez à l\'endroit où placer votre signature (Outils › Ma signature pour la modifier).',
    ftext: 'Tracez la zone d\'un champ texte à remplir (les élèves pourront écrire dedans).',
    fcheck: 'Cliquez ou tracez pour ajouter une case à cocher.',
    note: 'Cliquez à l\'endroit où ajouter un commentaire (note repliable).',
    crop: 'Tracez la zone à conserver : elle s\'applique aux pages sélectionnées.'
  };
  msg(tips[t] || '');
}

const curFont = () => ({ family: $('#fontFam').value, bold: $('#fontB').checked, italic: $('#fontI').checked });

// Propriétés appliquées à l'élément sélectionné
['color', 'size', 'width', 'fontFam', 'fontB', 'fontI'].forEach((id) => $('#' + id).addEventListener('change', () => {
  const o = curPage() && curPage().items[S.selItem]; if (!o) return;
  snapshot();
  if (id === 'color' && o.type !== 'image' && o.kind !== 'whiteout') o.color = color();
  if (id === 'size' && o.type === 'text') o.size = size();
  if (id === 'width' && (o.type === 'ink' || o.kind === 'box')) o.width = +$('#width').value;
  if (/^font/.test(id) && o.type === 'text') o.font = curFont();
  drawItems();
}));

// ---------------- Signature manuscrite ----------------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* stockage indisponible */ } }
};
async function signaturePad() {
  const html = `<p class="muted">Signez avec la souris, le pavé tactile ou un stylet, ou importez une image de votre signature.</p>
    <canvas id="sigPad" width="560" height="200"></canvas>
    <div class="row"><button id="sigClear" class="small">Effacer</button><button id="sigImport" class="small">Importer une image…</button>
    <label><input type="checkbox" id="sigDate" ${store.get('edupdf.signDate') === '1' ? 'checked' : ''}> Ajouter la date sous la signature</label></div>`;
  const p = modal('Ma signature', html, [['Annuler', null], ['Enregistrer', () => {
    const c = $('#sigPad'); const ctx = c.getContext('2d'); const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 10) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (x1 < 0) { alert('Signez d\'abord dans le cadre.'); return false; }
    const o = document.createElement('canvas'); o.width = x1 - x0 + 9; o.height = y1 - y0 + 9;
    o.getContext('2d').drawImage(c, x0 - 4, y0 - 4, o.width, o.height, 0, 0, o.width, o.height);
    store.set('edupdf.signDate', $('#sigDate').checked ? '1' : '0');
    return o.toDataURL('image/png');
  }, true]]);
  const c = $('#sigPad'); const ctx = c.getContext('2d');
  ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#001871';
  const old = await savedSignature();
  if (old) loadImg(old).then((im) => { const k = Math.min(1, c.width / im.width, c.height / im.height); ctx.drawImage(im, (c.width - im.width * k) / 2, (c.height - im.height * k) / 2, im.width * k, im.height * k); });
  let last = null;
  const pt = (e) => { const b = c.getBoundingClientRect(); return [(e.clientX - b.left) * c.width / b.width, (e.clientY - b.top) * c.height / b.height]; };
  c.onpointerdown = (e) => { c.setPointerCapture(e.pointerId); last = pt(e); };
  c.onpointermove = (e) => { if (!last) return; const q = pt(e); ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...q); ctx.stroke(); last = q; };
  c.onpointerup = () => { last = null; };
  $('#sigClear').onclick = () => ctx.clearRect(0, 0, c.width, c.height);
  $('#sigImport').onclick = async () => {
    const f = (await window.api.openDialog({ imagesOnly: true })).find((x) => !x.error); if (!f) return;
    const im = await loadImg(await bytesToDataUrl(f.bytes, 'image/png'));
    // fond clair rendu transparent
    const t = document.createElement('canvas'); t.width = im.width; t.height = im.height; const tc = t.getContext('2d'); tc.drawImage(im, 0, 0);
    const id = tc.getImageData(0, 0, t.width, t.height);
    for (let i = 0; i < id.data.length; i += 4) if (id.data[i] + id.data[i + 1] + id.data[i + 2] > 600) id.data[i + 3] = 0;
    tc.putImageData(id, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const k = Math.min(c.width / t.width, c.height / t.height); ctx.drawImage(t, (c.width - t.width * k) / 2, (c.height - t.height * k) / 2, t.width * k, t.height * k);
  };
  const res = await p;
  if (res) { await window.api.vaultSet('signature', res); msg('Signature enregistrée sur ce PC (chiffrée).'); }
  return res;
}
/** Signature enregistrée (coffre chiffré). Une signature d'une ancienne version, en clair, y est déplacée. */
async function savedSignature() {
  const legacy = store.get('edupdf.signature');
  if (legacy) { if (await window.api.vaultSet('signature', legacy)) { try { localStorage.removeItem('edupdf.signature'); } catch { /* */ } } return legacy; }
  return window.api.vaultGet('signature');
}
async function placeSignature(pos) {
  let sig = await savedSignature();
  if (!sig) sig = await signaturePad();
  if (!sig) return;
  const im = await loadImg(sig); const p = curPage();
  const w = 150 * S.scale, h = w * im.height / im.width;
  snapshot();
  p.items.push({ type: 'image', rect: viewToPdfRect(S.vp, pos[0] - w / 2, pos[1] - h / 2, w, h), ref: putImg(sig) });
  if (store.get('edupdf.signDate') === '1') {
    p.items.push({ type: 'text', at: S.vp.convertToPdfPoint(pos[0] - w / 2, pos[1] + h / 2 + 2 * S.scale), size: 10, color: '#001871', font: { family: 'Arial' }, text: 'Le ' + new Date().toLocaleDateString('fr-FR') });
  }
  S.selItem = p.items.length - 1; setTool('select'); drawItems(); msg('Signature ajoutée : déplacez-la ou redimensionnez-la si besoin.');
}

// ---------------- Opérations sur les pages ----------------
const selected = () => (S.sel.size ? [...S.sel] : [S.cur]).filter((i) => i < S.pages.length).sort((a, b) => a - b);

function rotate(delta) { if (!S.pages.length) return; snapshot(); selected().forEach((i) => { S.pages[i].rot = (S.pages[i].rot + delta + 360) % 360; }); refresh(); }
/** « 1-3, 5 » à partir de numéros de page (base 1) triés. */
function rangeText(nums) {
  const out = []; let a = null, b = null;
  for (const n of [...nums].sort((x, y) => x - y)) { if (a !== null && n === b + 1) b = n; else { if (a !== null) out.push(a === b ? a : `${a}-${b}`); a = b = n; } }
  if (a !== null) out.push(a === b ? a : `${a}-${b}`); return out.join(', ');
}
/** « 1-3, 5 ; 8 » → numéros de page valides (base 1), sans doublon. */
function parsePages(s, max) {
  const out = new Set();
  for (const part of String(s).split(/[,;\s]+/)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim()); if (!m) continue;
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= max) out.add(i);
  }
  return [...out].sort((x, y) => x - y);
}
/**
 * Choix de plusieurs pages : intervalle à taper (« 2-4, 7 ») ou cases à cocher, préremplis avec la sélection des miniatures.
 * Retourne les index (base 0) choisis, ou null si annulé.
 */
async function pickPages(title, verb, opts = {}) {
  const n = S.pages.length; const start = selected().map((i) => i + 1);
  const boxes = Array.from({ length: n }, (_, i) => `<label class="pgck"><input type="checkbox" data-pg="${i + 1}" ${start.includes(i + 1) ? 'checked' : ''}><span>${i + 1}</span></label>`).join('');
  const html = `<label class="row">Pages <input id="pgRange" type="text" style="flex:1" value="${rangeText(start)}" placeholder="ex. 2-4, 7" autocomplete="off"></label>
    <div class="row wrap pgquick"><button type="button" class="small" data-q="cur">Page courante (${S.cur + 1})</button><button type="button" class="small" data-q="odd">Impaires</button><button type="button" class="small" data-q="even">Paires</button>${opts.all ? '<button type="button" class="small" data-q="all">Toutes</button>' : ''}<button type="button" class="small" data-q="none">Aucune</button></div>
    <div class="pggrid">${boxes}</div><p class="muted" id="pgInfo"></p><p class="err" id="pgErr"></p>`;
  const p = modal(title, html, [['Annuler', null], [verb, () => {
    const nums = parsePages($('#pgRange').value, n);
    if (!nums.length) { $('#pgErr').textContent = 'Choisissez au moins une page.'; return false; }
    if (opts.keepOne && nums.length === n) { $('#pgErr').textContent = 'Impossible de supprimer toutes les pages : gardez-en au moins une.'; return false; }
    return nums.map((x) => x - 1);
  }, true]]);
  const sync = (from) => {
    const fromBoxes = () => [...document.querySelectorAll('#mBody [data-pg]')].filter((c) => c.checked).map((c) => +c.dataset.pg);
    const nums = from === 'boxes' ? fromBoxes() : parsePages($('#pgRange').value, n);
    if (from === 'boxes') $('#pgRange').value = rangeText(nums);
    else document.querySelectorAll('#mBody [data-pg]').forEach((c) => { c.checked = nums.includes(+c.dataset.pg); });
    $('#pgInfo').textContent = nums.length ? `${nums.length} page(s) sur ${n}` : ''; $('#pgErr').textContent = '';
  };
  $('#pgRange').oninput = () => sync('range');
  document.querySelectorAll('#mBody [data-pg]').forEach((c) => { c.onchange = () => sync('boxes'); });
  document.querySelectorAll('#mBody [data-q]').forEach((b) => {
    b.onclick = () => {
      const all = Array.from({ length: n }, (_, i) => i + 1); const q = b.dataset.q;
      $('#pgRange').value = rangeText(q === 'cur' ? [S.cur + 1] : q === 'odd' ? all.filter((x) => x % 2) : q === 'even' ? all.filter((x) => !(x % 2)) : q === 'all' ? all : []); sync('range');
    };
  });
  sync('range'); $('#pgRange').select();
  return p;
}
async function deletePages() {
  if (!S.pages.length) return;
  if (S.pages.length === 1) return alert('Impossible de supprimer la seule page du document.');
  const sel = await pickPages('🗑 Supprimer des pages', 'Supprimer', { keepOne: true }); if (!sel) return;
  snapshot(); [...sel].reverse().forEach((i) => S.pages.splice(i, 1));
  S.cur = Math.min(sel[0], S.pages.length - 1); S.sel = new Set([S.cur]); refresh();
  msg(`${sel.length} page(s) supprimée(s). Ctrl+Z pour annuler.`);
}
function duplicatePages() {
  if (!S.pages.length) return; snapshot();
  const sel = selected(); const copies = sel.map((i) => ({ ...JSON.parse(JSON.stringify(S.pages[i])), uid: uidc++ }));
  S.pages.splice(sel[sel.length - 1] + 1, 0, ...copies); refresh();
}
function movePages(dir) {
  const sel = selected(); if (!S.pages.length) return;
  if ((dir < 0 && sel[0] === 0) || (dir > 0 && sel[sel.length - 1] === S.pages.length - 1)) return;
  snapshot();
  const order = dir < 0 ? sel : [...sel].reverse();
  order.forEach((i) => { const [p] = S.pages.splice(i, 1); S.pages.splice(i + dir, 0, p); });
  S.sel = new Set(sel.map((i) => i + dir)); S.cur += dir; refresh();
}
/** Nouvelle page identique à la page courante : même modèle (Seyès, carreaux, évaluation…), sinon même format et orientation. */
async function insertBlank() {
  const p = curPage(); let bytes; let rot = 0; let tpl = null;
  if (p) {
    const src = S.sources[p.src]; const pg = await getPdfPage(p);
    tpl = src.tpl || null; rot = (pg.rotate + p.rot + 360) % 360;
    if (tpl) bytes = await templatePdf(tpl);
    else { const [x0, y0, x1, y1] = pg.view; const d = await PDFDocument.create(); d.addPage([Math.abs(x1 - x0), Math.abs(y1 - y0)]); bytes = await d.save(); }
  } else bytes = await blankPdf();
  if (S.pages.length) snapshot();
  const at = S.pages.length ? S.cur + 1 : 0;
  const list = await insertPdf(bytes, at);
  if (tpl) S.sources[list[0].src].tpl = tpl; else list.forEach((q) => { q.rot = rot; });
  S.cur = at; S.sel = new Set([at]); setDirty(true); refresh();
  msg(tpl ? 'Nouvelle page ajoutée, identique au modèle de la page précédente.' : 'Nouvelle page ajoutée, au même format que la page précédente.');
}
async function numberPages() {
  if (!S.pages.length) return; snapshot();
  const N = S.pages.length;
  for (let i = 0; i < N; i++) {
    const p = S.pages[i]; p.items = p.items.filter((o) => o.tag !== 'num');
    const pg = await getPdfPage(p); const vp = pg.getViewport({ scale: 1, rotation: (pg.rotate + p.rot + 360) % 360 });
    const label = `${i + 1} / ${N}`;
    p.items.push({ type: 'text', tag: 'num', at: vp.convertToPdfPoint(vp.width / 2 - label.length * 2.6, vp.height - 30), size: 10, color: '#444444', text: label });
  }
  refresh(); msg('Pages numérotées (relancez après réorganisation pour mettre à jour).');
}
async function extractPages() {
  if (!S.pages.length) return;
  const sel = await pickPages('📤 Extraire des pages', 'Extraire', { all: true }); if (!sel) return;
  busy('Extraction…');
  const bytes = await buildPdf(sel.map((i) => S.pages[i]));
  const p = await window.api.save({ bytes, defaultName: `${baseName()}-extrait.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  done(p ? `Pages extraites : ${p}` : '');
}
async function splitPages() {
  if (!S.pages.length) return; busy('Division du document…');
  const files = [];
  for (let i = 0; i < S.pages.length; i++) files.push({ name: `${baseName()}-page-${String(i + 1).padStart(3, '0')}.pdf`, bytes: await buildPdf([S.pages[i]]) });
  const dir = await window.api.saveMany(files); done(dir ? `${files.length} fichiers créés dans ${dir}` : '');
}

// ---------------- Scanner ----------------
async function scan() {
  const imgs = [];
  try {
    for (;;) {
      busy('Numérisation en cours… (fenêtre du scanner)');
      const b = await window.api.scan(); done();
      if (!b) break;
      imgs.push(b);
      if (!confirm(`${imgs.length} page(s) numérisée(s). Scanner une autre page ?`)) break;
    }
  } catch (e) {
    done();
    alert('Scanner indisponible :\n' + errMsg(e) + '\n\nVérifiez que le scanner est branché et allumé, ou utilisez « Depuis des images » avec des photos.');
  }
  if (!imgs.length) return;
  const before = S.pages.length;
  if (before) snapshot();
  const list = await insertPdf(await imagesToPdf(imgs), before);
  S.cur = before; S.sel = new Set([before]); setDirty(true); refresh();
  if (confirm('Rendre le texte de ces pages modifiable et cherchable (OCR) maintenant ?')) await runOcr(list);
}

// ---------------- OCR ----------------
async function ocrOne(p) {
  const pg = await getPdfPage(p); const R = (pg.rotate + p.rot + 360) % 360;
  const v0 = pg.getViewport({ scale: 1, rotation: R });
  const sc = Math.min(3, 2600 / Math.max(v0.width, v0.height));
  const vp = pg.getViewport({ scale: sc, rotation: R });
  const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
  await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  const res = await window.api.ocr(c.toDataURL('image/png'), $('#ocrLang').value);
  const toRect = (b) => normRect([...vp.convertToPdfPoint(b.x0, b.y0), ...vp.convertToPdfPoint(b.x1, b.y1)]);
  p.ocr = {
    text: res.text,
    words: res.words.filter((w) => w.conf > 20).map((w) => ({ text: w.text, rect: toRect(w.bbox) })),
    lines: res.lines.filter((l) => l.text).map((l) => ({ text: l.text, rect: toRect(l.bbox) }))
  };
}
async function runOcr(list) {
  if (!list.length) return;
  snapshot();
  try {
    for (let i = 0; i < list.length; i++) { busy(`Reconnaissance du texte… page ${i + 1} / ${list.length} (la 1re page peut prendre plus de temps)`); await ocrOne(list[i]); }
    done(`OCR terminé sur ${list.length} page(s). Le texte est maintenant cherchable ; utilisez « Modifier le texte » pour le corriger.`);
  } catch (e) { done(); alert('Erreur OCR : ' + errMsg(e)); }
  refresh();
}

// ---------------- Exports ----------------
async function pageParagraphs(p, withStyle) {
  const items = (await getTextItems(p)).filter((t) => !t.ocr);
  let pg = null;
  if (withStyle && items.length) { // un rendu rapide charge les polices : on retrouve police, gras, italique
    pg = await getPdfPage(p); const vp = pg.getViewport({ scale: 0.25 });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    try { await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; } catch { pg = null; }
  }
  const lines = [];
  if (items.length) {
    const sorted = items.map((t) => ({ ...t, y: t.rect[1], x: t.rect[0] })).sort((a, b) => b.y - a.y || a.x - b.x);
    for (const t of sorted) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - t.y) < (t.size || 10) * 0.5) { last.parts.push(t); }
      else lines.push({ y: t.y, size: t.size, parts: [t] });
    }
    lines.forEach((l) => {
      l.parts.sort((a, b) => a.x - b.x); l.text = l.parts.map((q) => q.text).join(' ').replace(/\s+/g, ' ').trim();
      if (pg) l.font = fontOfItem(pg, l.parts[0]);
    });
  } else if (p.ocr) {
    p.ocr.lines.filter((l) => !p.edited.includes('o' + p.ocr.lines.indexOf(l))).forEach((l) => lines.push({ y: l.rect[1], text: l.text, size: 11 }));
  }
  p.items.filter((o) => o.type === 'text' && o.tag !== 'num').forEach((o) => o.text.split('\n').forEach((t) => lines.push({ y: o.at[1], text: t, size: o.size, font: o.font, color: o.color })));
  lines.sort((a, b) => b.y - a.y);
  return lines.filter((l) => l.text).map((l) => ({ text: l.text, size: Math.min(28, Math.max(8, Math.round(l.size || 11))),
    font: l.font && l.font.family, bold: !!(l.font && l.font.bold), italic: !!(l.font && l.font.italic), color: l.color && l.color.length === 7 ? l.color : undefined }));
}
async function pageJpeg(p, scale = 1.6) {
  const pg = await getPdfPage(p); const R = (pg.rotate + p.rot + 360) % 360; const vp = pg.getViewport({ scale, rotation: R });
  const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await pg.render({ canvasContext: ctx, viewport: vp }).promise; await paintItems(ctx, vp, p);
  return { bytes: dataUrlToBytes(c.toDataURL('image/jpeg', 0.9)), w: c.width, h: c.height };
}
/**
 * Mise en page identique (export Word / PowerPoint) : pour chaque page du document final,
 *  - un fond sans le texte horizontal : images, tableaux, diagrammes, couleurs, formes et texte incliné, tels quels ;
 *  - les lignes de texte, placées au point près, avec leur police, leur taille, gras, italique et couleur (texte modifiable).
 * Les dimensions et le nombre de pages sont ceux du PDF.
 */
async function layoutOfDocument(scale = 2.2) {
  const doc = await openPdfJs(await buildPdf()); const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i); const vp1 = pg.getViewport({ scale: 1 }); const vp = pg.getViewport({ scale });
    const mk = () => { const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height); const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); return [c, x]; };
    const [full, fctx] = mk(); await pg.render({ canvasContext: fctx, viewport: vp }).promise;
    const [bg, bctx] = mk();
    const upright = () => { const t = bctx.getTransform(); return t.a > 0 && Math.abs(t.b) <= 1e-3 * t.a && Math.abs(t.c) <= 1e-3 * Math.abs(t.d || 1); };
    for (const m of ['fillText', 'strokeText']) { const o = bctx[m].bind(bctx); bctx[m] = (...a) => (upright() ? undefined : o(...a)); } // le texte droit devient du texte modifiable
    await pg.render({ canvasContext: bctx, viewport: vp }).promise;
    const tc = await pg.getTextContent(); const items = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const m = pdfjsLib.Util.transform(vp1.transform, it.transform); if (m[0] <= 0 || Math.abs(m[1]) > 0.01 * m[0]) continue; // texte incliné : reste dans le fond
      const size = Math.hypot(m[2], m[3]); if (!(size > 1)) continue;
      const st = tc.styles[it.fontName] || {}; const f = fontOfItem(pg, { fontName: it.fontName, fallback: st.fontFamily });
      const w = Math.max(size * 0.3, it.width || 0);
      const col = sampleColors({ l: m[4], t: m[5] - size * 0.78, w, h: size * 0.95 }, full, scale).fg;
      items.push({ text: it.str, x: m[4], yb: m[5], w, size, font: f.family, bold: !!f.bold, italic: !!f.italic, color: col });
    }
    items.sort((a, b) => a.yb - b.yb || a.x - b.x);
    const lines = [];
    for (const t of items) { // même ligne de base et même colonne : une ligne ; un grand écart (cellule de tableau, colonne) : une autre
      const l = lines.find((q) => Math.abs(q.yb - t.yb) < 0.35 * Math.max(q.size, t.size) && t.x - q.right < 1.2 * t.size && t.x > q.x - 1);
      if (!l) { lines.push({ x: t.x, yb: t.yb, right: t.x + t.w, size: t.size, runs: [{ ...t }] }); continue; }
      const r = l.runs[l.runs.length - 1]; const gap = t.x - l.right;
      const space = gap > 0.15 * t.size && !/\s$/.test(r.text) && !/^\s/.test(t.text) ? ' ' : '';
      const same = r.font === t.font && r.bold === t.bold && r.italic === t.italic && Math.abs(r.size - t.size) < 0.6 && r.color === t.color;
      if (same) r.text += space + t.text; else l.runs.push({ ...t, text: space + t.text });
      l.right = Math.max(l.right, t.x + t.w); l.size = Math.max(l.size, t.size);
    }
    pages.push({ w: vp1.width, h: vp1.height, bg: dataUrlToBytes(bg.toDataURL('image/jpeg', 0.88)),
      lines: lines.map((l) => ({ x: l.x, yb: l.yb, w: l.right - l.x, size: l.size, runs: l.runs.map((r) => ({ text: r.text, font: r.font, size: r.size, bold: r.bold, italic: r.italic, color: r.color })) })) });
  }
  return pages;
}
// Formats d'export : famille (texte, présentation, tableur) et faisabilité sans LibreOffice
const EXPORTS = {
  docx: { fam: 'text', label: 'Word (.docx)', alone: true }, doc: { fam: 'text', label: 'Word 97-2003 (.doc)' }, odt: { fam: 'text', label: 'OpenDocument Texte (.odt)' },
  rtf: { fam: 'text', label: 'Texte enrichi (.rtf)' }, html: { fam: 'text', label: 'Page web (.html)' },
  xlsx: { fam: 'sheet', label: 'Excel (.xlsx)', alone: true }, csv: { fam: 'sheet', label: 'CSV (.csv)', alone: true }, ods: { fam: 'sheet', label: 'OpenDocument Tableur (.ods)' }, xls: { fam: 'sheet', label: 'Excel 97-2003 (.xls)' },
  pptx: { fam: 'slides', label: 'PowerPoint (.pptx)', alone: true }, ppt: { fam: 'slides', label: 'PowerPoint 97-2003 (.ppt)' }, odp: { fam: 'slides', label: 'OpenDocument Présentation (.odp)' }
};
/** Lignes et colonnes reconstituées à partir de la position du texte (tableaux → tableur). */
async function pageTable(p) {
  const items = (await getTextItems(p)).map((t) => ({ text: t.text.trim(), x: normRect(t.rect)[0], x2: normRect(t.rect)[2], y: normRect(t.rect)[1], size: t.size || 10 })).filter((t) => t.text);
  if (!items.length) return [];
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const t of items) { const r = rows[rows.length - 1]; if (r && Math.abs(r.y - t.y) < t.size * 0.5) r.cells.push(t); else rows.push({ y: t.y, cells: [t] }); }
  // fusion des morceaux proches d'une même cellule
  rows.forEach((r) => {
    r.cells.sort((a, b) => a.x - b.x); const m = [];
    for (const c of r.cells) { const l = m[m.length - 1]; if (l && c.x - l.x2 < c.size * 0.9) { l.text += (c.x - l.x2 > c.size * 0.15 ? ' ' : '') + c.text; l.x2 = c.x2; } else m.push({ ...c }); }
    r.cells = m;
  });
  // colonnes : regroupement des débuts de cellules
  const starts = rows.flatMap((r) => r.cells.map((c) => c.x)).sort((a, b) => a - b); const cols = [];
  for (const x of starts) { if (!cols.length || x - cols[cols.length - 1].max > 12) cols.push({ min: x, max: x }); else cols[cols.length - 1].max = x; }
  const colOf = (x) => { let best = 0, d = Infinity; cols.forEach((c, i) => { const dd = x < c.min ? c.min - x : x > c.max ? x - c.max : 0; if (dd < d) { d = dd; best = i; } }); return best; };
  const num = (s) => { const t = s.replace(/\s| /g, '').replace(/€|%$/g, ''); return /^-?\d+([.,]\d+)?$/.test(t) ? parseFloat(t.replace(',', '.')) : s; };
  return rows.map((r) => { const out = new Array(cols.length).fill(''); r.cells.forEach((c) => { const i = colOf(c.x); out[i] = out[i] ? out[i] + ' ' + c.text : num(c.text); }); return out; });
}
async function exportDialog() {
  if (!S.pages.length) return;
  const office = await window.api.officeStatus();
  const opt = (k) => `<label class="ck"><input type="radio" name="fmt" value="${k}" ${k === 'docx' ? 'checked' : ''} ${!office && !EXPORTS[k].alone ? 'disabled' : ''}> ${EXPORTS[k].label}${!office && !EXPORTS[k].alone ? ' <span class="muted">(LibreOffice)</span>' : ''}</label>`;
  const k = await modal('Exporter le PDF vers…', `<div class="cols3">
    <div><b>Texte</b>${['docx', 'doc', 'odt', 'rtf', 'html'].map(opt).join('')}</div>
    <div><b>Tableur</b>${['xlsx', 'csv', 'ods', 'xls'].map(opt).join('')}</div>
    <div><b>Présentation</b>${['pptx', 'ppt', 'odp'].map(opt).join('')}</div></div>
    ${office ? '' : '<p class="muted">Les formats grisés demandent LibreOffice (gratuit) : Aide › Statut conversion Office pour l\'installer.</p>'}`,
  [['Annuler', null], ['Exporter', () => (document.querySelector('input[name=fmt]:checked') || {}).value, true]]);
  if (k) await toOffice(k);
}
async function toOffice(format, target) {
  if (!S.pages.length) return;
  if (!can('convert')) return denied('convert');
  const office = await window.api.officeStatus(); const E = EXPORTS[format];
  const name = target || `${baseName()}.${format}`;
  try {
    if (E.fam === 'sheet') { // tableaux → tableur
      busy('Reconstitution des tableaux…');
      const sheets = [];
      for (let i = 0; i < S.pages.length; i++) sheets.push({ name: `Page ${i + 1}`, rows: await pageTable(S.pages[i]) });
      done();
      if (!sheets.some((s) => s.rows.length)) return alert('Aucun texte trouvé. S\'il s\'agit d\'un scan, lancez d\'abord l\'OCR (onglet OCR).');
      if (!E.alone && !office) return officeMissing('PDF → ' + E.label);
      const r = await window.api.exportSheet(sheets.filter((s) => s.rows.length), name, format);
      if (r) msg(`Tableur créé : ${r}`);
      return;
    }
    if (!E.alone && !office) return officeMissing('PDF → ' + E.label);
    let mode = 'identique';
    if (format === 'docx' || format === 'pptx') {
      mode = await modal(`PDF → ${E.label}`, format === 'docx'
        ? `<p><b>Mise en page identique</b> (recommandé) : chaque page garde sa taille, sa mise en page, ses tableaux, diagrammes, images et couleurs ; le texte reste modifiable dans sa police, sa taille et sa couleur.</p><p><b>Texte fluide</b> : seulement le texte, en paragraphes qui se recomposent (pratique pour réécrire un document).</p>`
        : `<p><b>Mise en page identique</b> (recommandé) : chaque page devient une diapositive identique, dont le texte reste modifiable.</p><p><b>Diapositives images</b> : chaque page en image, texte dans les notes.</p>`,
      [['Annuler', null], [format === 'docx' ? 'Texte fluide' : 'Diapositives images', 'simple'], ['Mise en page identique', 'identique', true]]);
      if (!mode) return;
    }
    if (mode === 'identique') {
      busy(`Conversion en ${E.label} : mise en page de chaque page…`);
      const pages = await layoutOfDocument();
      busy(`Conversion en ${E.label}…`);
      const r = E.fam === 'slides' ? await window.api.exportPptxLayout(pages, name, format) : await window.api.exportDocxLayout(pages, name, format);
      done(r ? `Fichier créé : ${r}` : ''); return;
    }
    if (format === 'pptx') {
      busy('Création des diapositives…'); const slides = [];
      for (const p of S.pages) { const im = await pageJpeg(p, 1.8); slides.push({ ...im, notes: (await pageParagraphs(p)).map((l) => l.text).join('\n') }); }
      done(); const r = await window.api.exportPptxImages(slides, name); if (r) msg(`Présentation créée : ${r} (texte de chaque page dans les notes)`);
      return;
    }
  } catch (e) { done(); return alert('Conversion impossible : ' + errMsg(e)); }
  busy('Conversion en Word…');
  const pages = [];
  for (const p of S.pages) {
    const ps = await pageParagraphs(p, true);
    if (!ps.length) { const im = await pageJpeg(p, 1.4); ps.push({ image: im.bytes, w: im.w, h: im.h }); } // page scannée : son image
    pages.push(ps);
  }
  done();
  const r = await window.api.exportDocx(pages, target || `${baseName()}.docx`);
  if (r) msg(`Document Word créé : ${r}${pages.some((ps) => ps[0] && ps[0].image) ? ' (pages sans texte insérées en image : faites l\'OCR pour obtenir leur texte)' : ''}`);
}
const toWord = () => toOffice('docx');
async function toText() {
  if (!S.pages.length) return; busy('Extraction du texte…');
  let out = '';
  for (let i = 0; i < S.pages.length; i++) out += `--- Page ${i + 1} ---\n` + (await pageParagraphs(S.pages[i])).map((l) => l.text).join('\n') + '\n\n';
  done();
  const r = await window.api.save({ bytes: new TextEncoder().encode(out), defaultName: `${baseName()}.txt`, filters: [{ name: 'Texte', extensions: ['txt'] }] });
  if (r) msg(`Texte exporté : ${r}`);
}
async function toImages() {
  if (!S.pages.length) return; busy('Création des images…');
  const doc = await openPdfJs(await buildPdf()); const files = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i); const vp = pg.getViewport({ scale: 2 });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    files.push({ name: `${baseName()}-page-${String(i).padStart(3, '0')}.png`, bytes: dataUrlToBytes(c.toDataURL('image/png')) });
  }
  const dir = await window.api.saveMany(files); done(dir ? `${files.length} image(s) créée(s) dans ${dir}` : '');
}

// ---------------- Protection par mot de passe ----------------
async function protectDialog() {
  if (!S.pages.length) return;
  const P = S.protect || { userPassword: '', ownerPassword: '', permissions: { print: true, modify: false, copy: false, annotate: true } };
  const ck = (k, label) => `<label class="ck"><input type="checkbox" id="perm_${k}" ${P.permissions[k] ? 'checked' : ''}> ${label}</label>`;
  const r = await modal('Protéger le document', `
    <label class="blk">Mot de passe pour <b>ouvrir</b> le document (facultatif)
      <input type="password" id="pwU" value="${esc(P.userPassword)}" autocomplete="new-password"></label>
    <label class="blk">Confirmer ce mot de passe <input type="password" id="pwU2" value="${esc(P.userPassword)}" autocomplete="new-password"></label>
    <label class="blk">Mot de passe pour <b>modifier / lever les restrictions</b> (recommandé)
      <input type="password" id="pwO" value="${esc(P.ownerPassword)}" autocomplete="new-password"></label>
    <p class="muted">Autorisations accordées sans le mot de passe de modification :</p>
    ${ck('print', 'Imprimer')}${ck('copy', 'Copier le texte et les images')}${ck('modify', 'Modifier et réorganiser les pages')}${ck('annotate', 'Annoter et remplir les formulaires')}
    <p class="muted">Chiffrement AES 256 bits, appliqué à chaque enregistrement. Notez bien vos mots de passe : ils ne peuvent pas être récupérés.</p>`,
  [['Annuler', null], ['Protéger', () => {
    const u = $('#pwU').value, o = $('#pwO').value;
    if (u !== $('#pwU2').value) { alert('Les deux mots de passe d\'ouverture ne correspondent pas.'); return false; }
    if (!u && !o) { alert('Indiquez au moins un mot de passe.'); return false; }
    return { userPassword: u, ownerPassword: o, permissions: Object.fromEntries(['print', 'copy', 'modify', 'annotate'].map((k) => [k, $('#perm_' + k).checked])) };
  }, true]]);
  if (!r) return;
  S.protect = r; setDirty(true); msg('Protection définie : elle sera appliquée à l\'enregistrement (Ctrl+S).');
}
function unprotect() {
  if (!S.protect) return alert('Ce document n\'a pas de mot de passe défini dans SknEDU-studio. Les PDF protégés que vous ouvrez sont déverrouillés automatiquement (avec leur mot de passe s\'il y en a un).');
  S.protect = null; setDirty(true); msg('Mot de passe retiré : le document sera enregistré sans protection.');
}

// ---------------- Copie numérisée éditable (fichiers protégés, polices illisibles) ----------------
async function scanCopy() {
  if (!S.pages.length) return;
  const sel = selected();
  if (!confirm(`Transformer ${sel.length} page(s) en copie numérisée fidèle puis en reconnaître le texte (OCR) ?\n\nL'apparence reste identique ; le texte devient modifiable avec « Modifier le texte », dans la même couleur et la même taille.`)) return;
  busy('Création de la copie numérisée…'); snapshot();
  const created = [];
  for (const i of sel) {
    const p = S.pages[i]; const pg = await getPdfPage(p); const R = (pg.rotate + p.rot + 360) % 360;
    const vOld = pg.getViewport({ scale: 1, rotation: R });
    const sc = Math.min(2.5, 3000 / Math.max(vOld.width, vOld.height)); const vp = pg.getViewport({ scale: sc, rotation: R });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    const d = await PDFDocument.create(); const img = await d.embedJpg(dataUrlToBytes(c.toDataURL('image/jpeg', 0.92)));
    d.addPage([vOld.width, vOld.height]).drawImage(img, { x: 0, y: 0, width: vOld.width, height: vOld.height });
    const src = await addSource(await d.save()); const np = newPage(src, 0);
    // les ajouts déjà faits suivent la page (coordonnées converties)
    const map = (q) => { const [vx, vy] = vOld.convertToViewportPoint(q[0], q[1]); return [vx, vOld.height - vy]; };
    np.items = p.items.map((o) => {
      const n = JSON.parse(JSON.stringify(o));
      if (n.rect) n.rect = normRect([...map([o.rect[0], o.rect[1]]), ...map([o.rect[2], o.rect[3]])]);
      if (n.at) n.at = map(o.at);
      if (n.points) n.points = o.points.map(map);
      return n;
    });
    S.pages[i] = np; created.push(np);
  }
  textCache.clear(); done(); refresh();
  await runOcr(created);
}

// ---------------- Comparaison de documents ----------------
function wordsOf(items, page) {
  const out = [];
  for (const t of items) {
    const [x1, y1, x2, y2] = normRect(t.rect); const len = t.text.length || 1; const re = /\S+/g; let m;
    while ((m = re.exec(t.text))) out.push({ text: m[0], page, size: t.size || (y2 - y1) * 0.8, rect: [x1 + (x2 - x1) * m.index / len, y1, x1 + (x2 - x1) * (m.index + m[0].length) / len, y2] });
  }
  // ordre de lecture : lignes de haut en bas, puis de gauche à droite
  out.sort((a, b) => b.rect[1] - a.rect[1]);
  const lines = [];
  for (const w of out) { const l = lines[lines.length - 1]; if (l && Math.abs(l.y - w.rect[1]) < w.size * 0.5) l.ws.push(w); else lines.push({ y: w.rect[1], ws: [w] }); }
  return lines.flatMap((l) => l.ws.sort((a, b) => a.rect[0] - b.rect[0]));
}
/** Différences mot à mot (algorithme de Myers). */
function diffWords(a, b) {
  const n = a.length, m = b.length, max = n + m, off = max + 1;
  const v = new Int32Array(2 * max + 3); const trace = [];
  for (let d = 0; d <= max; d++) {
    if (d > 8000) return null;
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) {
        const aMark = new Uint8Array(n), bMark = new Uint8Array(m);
        let X = n, Y = m;
        for (let dd = d; dd > 0; dd--) {
          const w = trace[dd]; const get = (kk) => w[kk + dd + 1]; const kk = X - Y;
          const pk = (kk === -dd || (kk !== dd && get(kk - 1) < get(kk + 1))) ? kk + 1 : kk - 1;
          const px = get(pk), py = px - pk;
          while (X > px && Y > py) { X--; Y--; }
          if (pk === kk + 1) { Y--; bMark[Y] = 1; } else { X--; aMark[X] = 1; }
        }
        return { aMark, bMark };
      }
    }
  }
  return null;
}
async function compareDocs() {
  if (!S.pages.length) return alert('Ouvrez d\'abord le document à vérifier (par exemple la version la plus récente), puis comparez-le à un autre fichier.');
  const files = await window.api.openDialog(); const f = files[0]; if (!f) return;
  if (f.error) return alert(`Impossible d'ouvrir ${f.name} : ${f.error}`);
  let bytes = f.kind === 'text' ? await textToPdf(f.text) : f.kind === 'image' ? await imagesToPdf([f.bytes]) : f.bytes;
  if (f.locked) { const u = await unlockFile(f); if (!u) return; bytes = u.bytes; }
  busy('Comparaison des documents…');
  try {
    const norm = (s) => s.toLowerCase().normalize('NFC').replace(/[’']/g, "'").replace(/[.,;:!?«»"()]+$/g, '');
    const A = [];
    for (let i = 0; i < S.pages.length; i++) {
      const p = S.pages[i]; const items = await getTextItems(p);
      p.items.filter((o) => o.type === 'text' && o.tag !== 'num').forEach((o) => { const [x, y] = o.at; o.text.split('\n').forEach((ln, j) => items.push({ text: ln, size: o.size, rect: [x, y - o.size * (1.05 + j * 1.2), x + ln.length * o.size * 0.5, y - o.size * (0.2 + j * 1.2)] })); });
      A.push(...wordsOf(items, i));
    }
    const docB = await openPdfJs(new Uint8Array(bytes)); const B = [];
    for (let i = 1; i <= docB.numPages; i++) {
      const tc = await (await docB.getPage(i)).getTextContent();
      B.push(...wordsOf(tc.items.filter((it) => it.str.trim()).map((it) => { const h = Math.hypot(it.transform[2], it.transform[3]); return { text: it.str, size: h, rect: [it.transform[4], it.transform[5], it.transform[4] + it.width, it.transform[5] + h] }; }), i - 1));
    }
    if (!A.length || !B.length) { done(); return alert(`Aucun texte trouvé dans ${!A.length ? 'le document ouvert' : f.name}.\nS'il s'agit d'un scan, faites d'abord l'OCR (onglet OCR), puis relancez la comparaison.`); }
    const r = diffWords(A.map((w) => norm(w.text)), B.map((w) => norm(w.text)));
    if (!r) { done(); return alert('Les documents sont trop différents pour être comparés mot à mot.'); }
    snapshot();
    S.pages.forEach((p) => { p.items = p.items.filter((o) => o.tag !== 'cmp'); });
    const changes = []; let i = 0, j = 0;
    const mark = (w, color) => S.pages[w.page].items.push({ type: 'rect', kind: 'highlight', tag: 'cmp', color, rect: [w.rect[0] - 0.5, w.rect[1] - w.size * 0.25, w.rect[2] + 0.5, w.rect[1] + w.size * 0.95] });
    while (i < A.length || j < B.length) {
      if (j < B.length && r.bMark[j]) {
        const del = []; while (j < B.length && r.bMark[j]) del.push(B[j++]);
        const ins = []; while (i < A.length && r.aMark[i]) ins.push(A[i++]);
        const anchor = ins[0] || A[Math.min(i, A.length - 1)];
        if (ins.length) { ins.forEach((w) => mark(w, '#ffb347')); changes.push({ page: anchor.page, type: 'Modifié', text: `« ${del.map((w) => w.text).join(' ')} » → « ${ins.map((w) => w.text).join(' ')} »` }); }
        else {
          S.pages[anchor.page].items.push({ type: 'rect', kind: 'highlight', tag: 'cmp', color: '#ff4d4d', rect: [anchor.rect[0] - 3, anchor.rect[1] - anchor.size * 0.25, anchor.rect[0] - 0.5, anchor.rect[1] + anchor.size * 0.95] });
          changes.push({ page: anchor.page, type: 'Supprimé', text: `« ${del.map((w) => w.text).join(' ')} »` });
        }
      } else if (i < A.length && r.aMark[i]) {
        const ins = []; while (i < A.length && r.aMark[i]) ins.push(A[i++]);
        ins.forEach((w) => mark(w, '#4ade80'));
        changes.push({ page: ins[0].page, type: 'Ajouté', text: `« ${ins.map((w) => w.text).join(' ')} »` });
      } else { i++; j++; }
    }
    done(); refresh();
    const list = changes.slice(0, 300).map((c) => `<li><button class="link" data-goto="${c.page}">p. ${c.page + 1}</button> <b class="c-${c.type}">${c.type}</b> ${esc(c.text.slice(0, 220))}</li>`).join('');
    const pr = modal('Résultat de la comparaison', `<p>Document ouvert comparé à <b>${esc(f.name)}</b> : <b>${changes.length}</b> différence(s).</p>
      <p class="legend"><span style="background:#4ade80">ajouté</span> <span style="background:#ffb347">modifié</span> <span style="background:#ff4d4d">supprimé (repère)</span></p>
      ${changes.length ? `<ol class="changes">${list}</ol>` : '<p>Aucune différence de texte : les deux documents sont identiques mot pour mot.</p>'}
      <p class="muted">Les différences sont surlignées dans le document. Outils › « Effacer les marques » pour les retirer.</p>`, [['Fermer', true, true]]);
    $$('#mBody [data-goto]').forEach((b) => { b.onclick = () => { S.cur = +b.dataset.goto; S.sel = new Set([S.cur]); refresh(); }; });
    await pr;
  } catch (e) { done(); alert('Erreur de comparaison : ' + errMsg(e)); }
}
function clearCompare() {
  if (!S.pages.some((p) => p.items.some((o) => o.tag === 'cmp'))) return;
  snapshot(); S.pages.forEach((p) => { p.items = p.items.filter((o) => o.tag !== 'cmp'); }); drawItems(); msg('Marques de comparaison effacées.');
}

// ---------------- Rechercher / remplacer (Ctrl+F) ----------------
const FIND = { hits: [], i: -1, q: '' };
const fold = (s) => [...s].map((ch) => (ch.normalize('NFD')[0] || ch).toLowerCase()).join(''); // sans accents ni majuscules, même longueur
async function pageTextUnits(p) {
  const list = (await getTextItems(p)).map((t) => ({ t, text: t.text, rect: t.rect }));
  p.items.forEach((o) => { if (o.type === 'text' && o.text) list.push({ o, text: o.text.replace(/\n/g, ' '), rect: [o.at[0], o.at[1] - o.size * 1.05, o.at[0] + o.text.length * o.size * 0.5, o.at[1] - o.size * 0.1] }); });
  return list;
}
async function findAll(q) {
  FIND.q = q; FIND.hits = []; FIND.i = -1;
  const fq = fold(q); if (!fq.trim()) { drawFindLayer(); return 0; }
  for (let i = 0; i < S.pages.length; i++) {
    for (const u of await pageTextUnits(S.pages[i])) {
      const ft = fold(u.text); let k = ft.indexOf(fq);
      while (k >= 0) { FIND.hits.push({ page: i, u, start: k, len: q.length }); k = ft.indexOf(fq, k + Math.max(1, fq.length)); }
    }
  }
  FIND.i = FIND.hits.findIndex((h) => h.page >= S.cur); if (FIND.i < 0 && FIND.hits.length) FIND.i = 0;
  updateFindUi(); gotoHit();
  return FIND.hits.length;
}
function updateFindUi() { $('#findCount').textContent = FIND.hits.length ? `${FIND.i + 1} / ${FIND.hits.length}` : (FIND.q ? 'aucun résultat' : ''); }
function gotoHit() {
  const h = FIND.hits[FIND.i]; if (!h) { drawFindLayer(); return; }
  if (h.page !== S.cur) { S.cur = h.page; S.sel = new Set([S.cur]); refresh(); } else drawFindLayer();
  updateFindUi();
}
function drawFindLayer() {
  const layer = $('#findLayer'); if (!layer) return; layer.innerHTML = '';
  if ($('#findBar').hidden || !S.vp) return;
  FIND.hits.forEach((h, n) => {
    if (h.page !== S.cur) return;
    const [x1, y1, x2, y2] = normRect(h.u.rect); const L = h.u.text.length || 1;
    const r = viewRect(S.vp, [x1 + (x2 - x1) * h.start / L, y1, x1 + (x2 - x1) * (h.start + h.len) / L, y2]);
    const d = document.createElement('div'); d.className = 'fh' + (n === FIND.i ? ' cur' : '');
    Object.assign(d.style, { left: r.l + 'px', top: r.t + 'px', width: r.w + 'px', height: r.h + 'px' });
    layer.appendChild(d); if (n === FIND.i) d.scrollIntoView({ block: 'center', inline: 'nearest' });
  });
}
/** Remplace du texte d'origine : suppression sous la zone + réécriture dans la police, la taille et la couleur d'origine. */
async function replaceInPage(p, hits, repl) {
  const pg = await getPdfPage(p); const R = (pg.rotate + p.rot + 360) % 360;
  const K = 2; const vp1 = pg.getViewport({ scale: 1, rotation: R }); const vpK = pg.getViewport({ scale: K, rotation: R });
  const c = document.createElement('canvas'); c.width = Math.round(vpK.width); c.height = Math.round(vpK.height);
  await pg.render({ canvasContext: c.getContext('2d'), viewport: vpK, annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS }).promise;
  const byUnit = new Map(); hits.forEach((h) => { if (!byUnit.has(h.u)) byUnit.set(h.u, []); byUnit.get(h.u).push(h); });
  let n = 0;
  for (const [u, hs] of byUnit) {
    hs.sort((a, b) => b.start - a.start);
    let txt = u.text; hs.forEach((h) => { txt = txt.slice(0, h.start) + repl + txt.slice(h.start + h.len); n++; });
    if (u.o) { u.o.text = txt; continue; }
    const t = u.t; const r = viewRect(vp1, t.rect); const size = t.size || r.h * 0.8;
    const colors = sampleColors(r, c, K);
    const pad = 1.5;
    const grp = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    p.items.push({ type: 'rect', kind: 'whiteout', edit: true, grp, keys: [t.key], color: colors.bg, rect: viewToPdfRect(vp1, r.l - pad, r.t - pad, r.w + 2 * pad, r.h + 2 * pad) });
    let at;
    if (t.base) { const [bx, by] = vp1.convertToViewportPoint(...t.base); at = vp1.convertToPdfPoint(bx, by - 0.85 * size); }
    else at = vp1.convertToPdfPoint(r.l, r.t + (r.h - size) / 2);
    if (txt.trim()) p.items.push({ type: 'text', grp, at, size: Math.round(size * 10) / 10, color: colors.fg, font: fontOfItem(pg, t), text: txt });
    p.edited.push(t.key);
  }
  return n;
}
async function replaceHits(all) {
  if (!can('edit')) return denied('edit');
  if (window.premiumGate && !window.premiumGate('act', 'replace')) return;
  const repl = $('#replText').value; const hits = all ? FIND.hits : [FIND.hits[FIND.i]].filter(Boolean);
  if (!hits.length) return;
  busy('Remplacement…'); snapshot(); let n = 0;
  try {
    const pages = [...new Set(hits.map((h) => h.page))];
    for (const i of pages) n += await replaceInPage(S.pages[i], hits.filter((h) => h.page === i), repl);
  } catch (e) { done(); return alert('Remplacement impossible : ' + errMsg(e)); }
  done(`${n} remplacement(s) effectué(s), dans la police et la couleur d'origine.`);
  refresh(); await findAll(FIND.q);
}
function toggleFind(show = $('#findBar').hidden) {
  $('#findBar').hidden = !show;
  if (show) { $('#findText').focus(); $('#findText').select(); } else { FIND.hits = []; drawFindLayer(); }
}

// ---------------- Impression ----------------
async function printDoc() {
  if (!S.pages.length) return;
  if (!can('print')) return denied('print');
  const opt = window.printOptions ? await window.printOptions() : { pages: null, perSheet: 1 };
  if (!opt) return;
  busy('Préparation de l\'impression…');
  try {
    const doc = await openPdfJs(await buildPdf()); let pages = [];
    for (const i of (opt.pages || [...Array(doc.numPages).keys()].map((k) => k + 1))) {
      if (i < 1 || i > doc.numPages) continue;
      busy(`Préparation de l'impression… page ${i} / ${doc.numPages}`);
      const pg = await doc.getPage(i); const vp = pg.getViewport({ scale: doc.numPages > 300 ? 1.5 : doc.numPages > 100 ? 1.8 : 2.2 }); // ≈ 110 à 160 ppp
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
      pages.push({ bytes: dataUrlToBytes(c.toDataURL('image/jpeg', 0.92)), w: c.width, h: c.height });
    }
    if (window.composePrint) pages = await window.composePrint(pages, opt.perSheet); // orientation homogène, 2 ou 4 pages par feuille
    done();
    const r = await window.api.printPages(pages);
    if (r && !r.ok && r.reason && !/cancel/i.test(r.reason)) alert('Impression impossible : ' + r.reason);
  } catch (e) { done(); alert('Impression impossible : ' + errMsg(e)); }
}

// ---------------- Filigrane, rognage, compression ----------------
async function watermarkDialog() {
  if (!S.pages.length) return;
  const W = S.watermark || { text: 'CONFIDENTIEL', size: 60, color: '#c0392b', opacity: 0.18 };
  const r = await modal('Filigrane', `<label class="blk">Texte <input type="text" id="wmT" value="${esc(W.text)}"></label>
    <div class="row"><label>Taille <input type="number" id="wmS" value="${W.size}" min="10" max="200" style="width:70px"></label>
    <label>Couleur <input type="color" id="wmC" value="${W.color}"></label>
    <label>Opacité <input type="range" id="wmO" min="5" max="60" value="${Math.round((W.opacity ?? 0.18) * 100)}"></label></div>
    <p class="muted">Ex. : « CORRIGÉ », « SUJET 2026 », « NE PAS DIFFUSER », le nom de l'établissement… Appliqué en diagonale sur toutes les pages.</p>`,
  [...(S.watermark ? [['Retirer', 'off']] : []), ['Annuler', null], ['Appliquer', () => ({ text: $('#wmT').value.trim(), size: +$('#wmS').value || 60, color: $('#wmC').value, opacity: +$('#wmO').value / 100 }), true]]);
  if (r === null) return;
  snapshot(); S.watermark = r === 'off' || !r.text ? null : r; refresh();
}
function uncrop() { const sel = selected().filter((i) => S.pages[i].crop); if (!sel.length) return; snapshot(); sel.forEach((i) => { S.pages[i].crop = null; }); refresh(); msg('Rognage annulé.'); }
async function compressDoc() {
  if (!S.pages.length) return; busy('Réduction de la taille…');
  try {
    const before = await buildPdf(); let after = await window.api.compressPdf(before);
    if (after.length >= before.length) after = before;
    if (S.protect) after = await window.api.encryptPdf(after, S.protect);
    done();
    const p = await window.api.save({ bytes: after, defaultName: `${baseName()}-compressé.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (p) msg(`Fichier réduit : ${(before.length / 1048576).toFixed(2)} Mo → ${(after.length / 1048576).toFixed(2)} Mo — ${p}`);
  } catch (e) { done(); alert('Réduction impossible : ' + errMsg(e)); }
}

// ---------------- Signature numérique (certificat) ----------------
async function certSign() {
  if (!S.pages.length) return;
  const cert = await window.api.pickCertificate(); if (!cert) return;
  const r = await modal('Signature numérique', `<p>Certificat : <b>${esc(cert.split(/[\\/]/).pop())}</b></p>
    <label class="blk">Mot de passe du certificat <input type="password" id="cpw" autocomplete="off"></label>
    <label class="blk">Signataire <input type="text" id="cname" value="${esc(store.get('edupdf.signName') || '')}"></label>
    <label class="blk">Motif <input type="text" id="creason" value="Approbation du document"></label>
    <label class="blk">Lieu <input type="text" id="cloc" value="${esc(store.get('edupdf.signLoc') || '')}"></label>
    <p class="muted">La signature numérique garantit l'auteur et l'intégrité du fichier : toute modification ultérieure la rend invalide. Ajoutez d'abord votre signature manuscrite si vous voulez qu'elle soit visible.${S.protect ? '<br><b>La copie signée sera enregistrée sans mot de passe</b> (chiffrer après signature invaliderait la signature).' : ''}</p>`,
  [['Annuler', null], ['Signer et enregistrer', () => ({ passphrase: $('#cpw').value, name: $('#cname').value, reason: $('#creason').value, location: $('#cloc').value }), true]]);
  if (!r) return;
  store.set('edupdf.signName', r.name); store.set('edupdf.signLoc', r.location);
  busy('Signature numérique…');
  try {
    const signed = await window.api.signPdf({ bytes: await buildPdf(), certPath: cert, ...r });
    done();
    const p = await window.api.save({ bytes: signed, defaultName: `${baseName()}-signé.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (p) msg(`Document signé numériquement : ${p}`);
  } catch (e) { done(); alert('Signature impossible : ' + errMsg(e)); }
}

// ---------------- Conversion Office ↔ Office ----------------
async function convertOfficeFileDialog() {
  if (!can('convert')) return denied('convert');
  if (!(await window.api.officeStatus())) return officeMissing('Conversion Office');
  const fams = { text: 'Texte (Word, OpenDocument…)', sheet: 'Tableur (Excel, OpenDocument…)', slides: 'Présentation (PowerPoint…)' };
  const T = await window.api.officeTargets();
  const groups = Object.entries(fams).map(([f, l]) => `<div><b>${l}</b>${Object.entries(T).filter(([, v]) => v.fam === f).map(([k, v]) => `<label class="ck"><input type="radio" name="tgt" value="${k}"> ${esc(v.label)} (.${k})</label>`).join('')}</div>`).join('');
  const k = await modal('Convertir un fichier Office', `<p>Choisissez le format voulu, puis le fichier à convertir (Word, Excel, PowerPoint, OpenDocument, RTF, CSV…).</p>
    <div class="cols3">${groups}</div><label class="ck"><input type="radio" name="tgt" value="pdf" checked> <b>PDF</b></label>`,
  [['Annuler', null], ['Choisir le fichier…', () => (document.querySelector('input[name=tgt]:checked') || {}).value, true]]);
  if (!k) return;
  busy('Conversion… (LibreOffice)');
  try { const r = await window.api.convertOfficeFile(k); done(r ? `Fichier converti : ${r}` : ''); }
  catch (e) { done(); alert(/OFFICE_LOCKED/.test(errMsg(e)) ? 'Ce fichier est protégé par mot de passe : ouvrez-le d\'abord dans SknEDU-studio (Fichier › Ouvrir), puis exportez-le.' : 'Conversion impossible : ' + errMsg(e)); }
}

// ---------------- Cloud ----------------
async function cloudDialog(mode) {
  if (!can('cloud')) return denied('cloud');
  if (mode === 'save' && !S.pages.length) return;
  const { clouds, install } = await window.api.cloudList();
  const icons = { onedrive: '☁️', 'onedrive-pro': '🏫', gdrive: '🟢', 'gdrive-shared': '👥', dropbox: '📦', 'dropbox-pro': '📦', icloud: '🍏', box: '🗃', custom: '📁' };
  const rows = clouds.map((c, i) => `<div class="cloudrow"><button class="cloudbtn" data-c="${i}">${icons[c.id] || '☁️'} <b>${esc(c.name)}</b><small>${esc(c.path)}</small></button>${c.custom ? `<button class="small" data-rm="${i}" title="Retirer">✕</button>` : ''}</div>`).join('');
  const missing = Object.entries(install).filter(([id]) => !clouds.some((c) => c.id.startsWith(id)));
  const html = `${clouds.length ? `<p>${mode === 'save' ? 'Enregistrer le document dans :' : 'Ouvrir un fichier depuis :'}</p>${rows}` : '<p><b>Aucun service cloud détecté sur ce PC.</b></p>'}
    <p class="muted">SknEDU-studio enregistre dans le dossier synchronisé de l'application officielle (OneDrive, Google Drive pour ordinateur, Dropbox…), qui envoie le fichier dans votre cloud. Vos identifiants ne sont jamais demandés par SknEDU-studio.</p>
    ${missing.length ? `<p>Installer un service : ${missing.map(([id, v]) => `<button class="small" data-inst="${id}">${esc(v.name)}</button>`).join(' ')}</p>` : ''}
    <p><button class="small" id="cloudAdd">➕ Ajouter un autre dossier synchronisé (Nextcloud, réseau de l'établissement…)</button></p>`;
  let chosen = null;
  const p = modal(mode === 'save' ? 'Enregistrer dans le cloud' : 'Ouvrir depuis le cloud', html, [['Fermer', null]]);
  $$('#mBody [data-c]').forEach((b) => { b.onclick = () => { chosen = clouds[+b.dataset.c]; $('#mBtns button').click(); }; });
  $$('#mBody [data-rm]').forEach((b) => { b.onclick = async () => { await window.api.cloudRemove(clouds[+b.dataset.rm].path); $('#mBtns button').click(); cloudDialog(mode); }; });
  $$('#mBody [data-inst]').forEach((b) => { b.onclick = async () => {
    const it = install[b.dataset.inst]; $('#mBtns button').click();
    if (!confirm(`Installer ${it.name} depuis le catalogue officiel Microsoft (winget) ?\nVous devrez ensuite vous connecter à votre compte dans l'application ${it.name}.`)) return;
    busy(`Installation de ${it.name}…`); const r = await window.api.cloudInstall(b.dataset.inst); done();
    if (r.ok) alert(`${it.name} est installé. Ouvrez-le, connectez-vous à votre compte, puis revenez ici : le dossier apparaîtra automatiquement.`);
    else if (confirm(`Installation automatique impossible.\n${r.log}\n\nOuvrir la page de téléchargement ?`)) window.api.openExternal(it.web);
  }; });
  $('#cloudAdd').onclick = async () => { const d = await window.api.cloudAdd(); $('#mBtns button').click(); if (d) cloudDialog(mode); };
  await p;
  if (!chosen) return;
  if (mode === 'save') {
    busy('Préparation du document…');
    try {
      let bytes = await buildPdf(); if (S.protect) bytes = await window.api.encryptPdf(bytes, S.protect); done();
      const r = await window.api.cloudSave(chosen.path, bytes, S.fileName);
      if (r) { S.filePath = r; S.fileName = r.split(/[\\/]/).pop(); setDirty(false); msg(`Enregistré dans ${chosen.name} : ${r} — la synchronisation l'envoie dans votre cloud.`); }
    } catch (e) { done(); alert('Enregistrement impossible : ' + errMsg(e)); }
  } else {
    const files = await window.api.cloudOpen(chosen.path); if (!files.length) return;
    if (S.pages.length) newTab(); else resetDoc();
    busy('Ouverture…'); await handleLoaded(files, 0); done();
  }
}

// ---------------- Droits d'accès (administration) ----------------
let POLICY = { managed: false, blocked: false, features: {} };
const RO_BLOCK = new Set(['edit', 'pages', 'sign', 'forms', 'ocr', 'protect']);
const can = (f) => !POLICY.blocked && POLICY.features[f] !== false && !(S.readOnly && RO_BLOCK.has(f));
const FEATURE_OF = {
  act: { save: 'save', saveAs: 'save', compress: 'save', print: 'print', cloudSave: 'cloud', cloudOpen: 'cloud', scan: 'scan',
    rotL: 'pages', rotR: 'pages', delPages: 'pages', dupPages: 'pages', moveUp: 'pages', moveDown: 'pages', extract: 'save', split: 'save', numbers: 'pages', uncrop: 'pages', watermark: 'pages',
    ocrPage: 'ocr', ocrAll: 'ocr', editAfterOcr: 'ocr', scanCopy: 'ocr', toWord: 'convert', toPpt: 'convert', toExcel: 'convert', toImages: 'convert', toText: 'convert', exportAs: 'convert', convertOffice: 'convert',
    aiPanel: 'ai', aiSettings: 'ai', aiSubscription: 'ai',
    protect: 'protect', unprotect: 'protect', signPad: 'sign', certSign: 'sign', compare: 'compare', clearCompare: 'compare', find: 'edit', delItem: 'edit' },
  tool: { edit: 'edit', editpara: 'edit', text: 'edit', image: 'edit', highlight: 'edit', whiteout: 'edit', box: 'edit', ellipse: 'edit', line: 'edit', arrow: 'edit', stamp: 'edit', mark: 'edit', ink: 'edit', note: 'edit', ftext: 'edit', fcheck: 'edit', sign: 'sign', crop: 'pages' }
};
function denied(f) {
  if (S.readOnly && RO_BLOCK.has(f) && !POLICY.blocked && POLICY.features[f] !== false) { msg('🔒 Document en lecture seule : les commentaires et le contenu sont verrouillés. Lisez, imprimez ou exportez-le.'); return false; }
  const label = (POLICY.labels && POLICY.labels[f]) || f;
  msg(`⛔ « ${label} » est désactivé par l'administrateur.`);
  window.api.logEvent('blocked', { feature: f, action: label });
  return false;
}
async function applyPolicy() {
  try { POLICY = await window.api.policy(); } catch { return; }
  $$('[data-act],[data-tool],[data-ai]').forEach((b) => {
    const f = b.dataset.ai ? 'ai' : b.dataset.act ? FEATURE_OF.act[b.dataset.act] : FEATURE_OF.tool[b.dataset.tool];
    const off = !!f && !can(f); b.classList.toggle('locked', off);
    if (b.dataset.t0 === undefined) b.dataset.t0 = b.title || ''; // info-bulle d'origine conservée
    b.title = off ? (S.readOnly && POLICY.features[f] !== false && !POLICY.blocked ? '🔒 Document en lecture seule' : 'Désactivé par l\'administrateur') : b.dataset.t0;
  });
  if (S.tool && FEATURE_OF.tool[S.tool] && !can(FEATURE_OF.tool[S.tool])) setTool('select');
  if (!can('ai')) $('#aiPanel').hidden = true;
  $('#policyBar').hidden = !(POLICY.managed && (POLICY.message || POLICY.blocked));
  $('#policyBar').textContent = POLICY.blocked ? '' : (POLICY.message ? '📢 ' + POLICY.message : '');
  $('#blockedScreen').hidden = !POLICY.blocked;
  if (POLICY.blocked) $('#blockedWho').textContent = `${POLICY.host}\\${POLICY.user}`;
  $('#managedTag').hidden = !POLICY.managed;
  $$('#formLayer .fw').forEach((el) => { el.disabled = el.disabled || !can('forms'); });
}
async function adminDialog() {
  const st = await window.api.adminStatus();
  if (st.admin) return window.api.adminOpenConsole();
  if (st.enrollment) {
    const pw = await modal('Poste géré', `<p>Ce poste (<b>${esc(st.host)}\\${esc(st.user)}</b>) suit les règles de l'administrateur.</p>
      <p class="muted">Dossier de gestion : ${esc(st.enrollment.folder)}<br>Portée : ${st.enrollment.scope === 'machine' ? 'tous les comptes Windows de ce PC' : 'ce compte Windows'}</p>
      <label class="blk">Pour retirer ce poste de la gestion, mot de passe administrateur : <input type="password" id="apw"></label>`,
    [['Fermer', null], ['Retirer de la gestion', () => $('#apw').value || false]]);
    if (!pw) return;
    try { await window.api.adminUnenroll(pw); await applyPolicy(); alert('Ce poste ne suit plus les règles de l\'administrateur.'); } catch (e) { alert(errMsg(e)); }
    return;
  }
  const choice = await modal('Administration', `<p><b>Devenir administrateur (ce PC)</b> : définissez les fonctions autorisées pour chaque utilisateur et chaque poste,
    consultez l'activité et recevez des notifications (Windows et téléphone).</p>
    <p><b>Rejoindre la gestion</b> : ce poste appliquera les règles d'un administrateur (dossier de gestion + mot de passe administrateur).</p>`,
  [['Annuler', null], ['Rejoindre la gestion', 'join'], ['Devenir administrateur', 'setup', true]]);
  if (choice === 'setup') {
    const r = await modal('Créer l\'administration', `<label class="blk">Mot de passe administrateur (6 caractères min.) <input type="password" id="ap1" autocomplete="new-password"></label>
      <label class="blk">Confirmer <input type="password" id="ap2" autocomplete="new-password"></label>
      <p>Dossier de gestion :<br><code id="afold">${esc(st.defaultFolder)}</code> <button class="small" id="apick">Changer…</button></p>
      <p class="muted">• Par défaut : ce PC uniquement (tous ses comptes Windows).<br>• Pour plusieurs PC : choisissez un partage réseau ou un dossier OneDrive / Google Drive partagé avec les postes.</p>`,
    [['Annuler', null], ['Créer', () => {
      if ($('#ap1').value.length < 6) { alert('Mot de passe trop court.'); return false; }
      if ($('#ap1').value !== $('#ap2').value) { alert('Les mots de passe ne correspondent pas.'); return false; }
      return { password: $('#ap1').value, folder: $('#afold').textContent };
    }, true]]);
    if (!r) return;
    try { await window.api.adminSetup(r); alert('Administration créée. La console s\'ouvre : réglez les droits, puis inscrivez les postes à gérer.'); }
    catch (e) { alert(errMsg(e)); }
  }
  if (choice === 'join') {
    const r = await modal('Rejoindre la gestion', `<p>Dossier de gestion de l'administrateur :<br><code id="afold">—</code> <button class="small" id="apick">Choisir…</button></p>
      <label class="blk">Mot de passe administrateur <input type="password" id="apw"></label>
      <label class="ck"><input type="checkbox" id="amach" checked> Appliquer à tous les comptes Windows de ce PC</label>`,
    [['Annuler', null], ['Rejoindre', () => ($('#afold').textContent === '—' ? (alert('Choisissez le dossier de gestion.'), false) : { folder: $('#afold').textContent, password: $('#apw').value, scope: $('#amach').checked ? 'machine' : 'user' }), true]]);
    if (!r) return;
    try { const x = await window.api.adminEnroll(r); await applyPolicy(); alert(`Poste inscrit (${x.scope === 'machine' ? 'tous les comptes de ce PC' : 'ce compte uniquement'}). Les règles de l'administrateur s'appliquent.`); }
    catch (e) { alert(errMsg(e)); }
  }
}
// le bouton « Changer… / Choisir… » des boîtes ci-dessus
document.addEventListener('click', async (e) => {
  if (e.target.id !== 'apick') return;
  const d = await window.api.adminPickFolder(); if (d) $('#afold').textContent = d;
});
// ---------------- Assistant IA ----------------
const AI_SYSTEM = "Tu es l'assistant pédagogique de SknEDU-studio, au service d'enseignants francophones. Réponds en français (sauf demande de traduction), de façon claire et structurée, en texte simple (titres courts, listes avec tirets, pas de tableaux Markdown), prêt à être collé dans un document de cours. Appuie-toi sur le document fourni ; si une information n'y figure pas, dis-le au lieu d'inventer.";
const AI_PRESETS = {
  resume: ['Résumer', 'Fais un résumé structuré de ce document : idées principales, notions clés à retenir, vocabulaire important.'],
  qcm: ['QCM', 'Crée un QCM de 10 questions sur ce document (4 propositions, une seule bonne réponse), de difficulté progressive, puis le corrigé commenté à la fin.'],
  exos: ['Exercices', 'Crée une fiche de 5 exercices progressifs à partir de ce document, puis un corrigé détaillé à la fin.'],
  simplifier: ['Simplifier', 'Réécris ce document pour des élèves en difficulté : phrases courtes, vocabulaire simple, exemples concrets, sans perdre les notions essentielles.'],
  corriger: ['Corriger', 'Relis ce document et liste toutes les fautes d\'orthographe, de grammaire, de conjugaison et de typographie, une par ligne : « erreur » → « correction » (explication courte). Termine par le nombre total de fautes.'],
  traduire: ['Traduire', 'Traduis intégralement ce document en anglais en conservant sa structure (titres, listes, numérotation).'],
  grille: ['Grille d\'évaluation', 'Crée une grille d\'évaluation critériée adaptée à ce document : critères, indicateurs observables, 4 niveaux de maîtrise et barème sur 20.'],
  latex: ['Formules en LaTeX', 'Retranscris toutes les formules mathématiques, physiques ou chimiques de ce document (y compris manuscrites) en LaTeX, une par ligne, numérotées, avec leur page.'],
  cours: ['Plan de séance', 'Propose un plan de séance de 55 minutes fondé sur ce document : objectifs, prérequis, déroulé minuté (phases, activités, consignes), différenciation et trace écrite.']
};
const AI_SITES = [['ChatGPT', 'https://chatgpt.com/'], ['Claude', 'https://claude.ai/new'], ['Gemini', 'https://gemini.google.com/app'], ['Copilot', 'https://copilot.microsoft.com/'], ['Le Chat (Mistral)', 'https://chat.mistral.ai/chat'], ['Perplexity', 'https://www.perplexity.ai/']];
let AI = { id: null, text: '', status: null };
window.api.onAiChunk(({ id, text }) => { if (id !== AI.id) return; AI.text += text; const o = $('#aiOut'); o.textContent = AI.text; o.scrollTop = o.scrollHeight; });

async function aiScopePages() {
  const s = $('#aiScope').value;
  return s === 'page' ? [curPage()] : s === 'sel' ? selected().map((i) => S.pages[i]) : S.pages;
}
async function aiDocText(pages) {
  let out = '';
  for (let i = 0; i < pages.length; i++) out += `--- Page ${S.pages.indexOf(pages[i]) + 1} ---\n` + (await pageParagraphs(pages[i])).map((l) => l.text).join('\n') + '\n\n';
  return out;
}
function toggleAi(show = $('#aiPanel').hidden) {
  if (show && !can('ai')) return denied('ai');
  $('#aiPanel').hidden = !show; if (show) { refreshAiBadge(); $('#aiPrompt').focus(); }
}
async function refreshAiBadge() {
  AI.status = await window.api.aiStatus();
  const p = AI.status.providers[AI.status.provider];
  const model = AI.status.models[AI.status.provider] || p.models[0] || '?';
  $('#aiBadge').textContent = `${p.name} · ${model}${p.hasKey ? '' : ' — clé manquante'}`;
  $('#aiBadge').classList.toggle('warn', !p.hasKey);
}
async function aiRun(preset) {
  if (!can('ai')) return denied('ai');
  if (window.premiumGate && !window.premiumGate('ai', 'run')) return;
  if (!S.pages.length && preset) return alert('Ouvrez d\'abord un document.');
  $('#aiPanel').hidden = false;
  if (preset) $('#aiPrompt').value = AI_PRESETS[preset][1];
  const ask = $('#aiPrompt').value.trim(); if (!ask) return $('#aiPrompt').focus();
  if (!AI.status) await refreshAiBadge();
  const prov = AI.status.provider; const P = AI.status.providers[prov];
  if (!P.hasKey) { const ok = await aiSettings(); if (!ok) return; }
  const pages = S.pages.length ? await aiScopePages() : [];
  let text = pages.length ? await aiDocText(pages) : '';
  let pdfBase64 = null;
  const usePdf = prov === 'anthropic' && AI.status.sendPdf && pages.length;
  if (usePdf) {
    const bytes = await buildPdf(pages);
    if (bytes.length < 30 * 1048576 && pages.length <= 600) pdfBase64 = await bytesToDataUrl(bytes, 'application/pdf').then((u) => u.split(',')[1]);
  }
  if (pages.length && !pdfBase64 && !text.replace(/--- Page \d+ ---/g, '').trim()) return alert('Aucun texte trouvé dans ces pages. S\'il s\'agit d\'un scan, lancez d\'abord l\'OCR (onglet OCR)' + (prov !== 'anthropic' ? ', ou choisissez Claude, qui lit directement les pages scannées.' : '.'));
  const LIMIT = 400000; let note = '';
  if (!pdfBase64 && text.length > LIMIT) {
    if (!confirm(`Le texte sélectionné est très long (${Math.round(text.length / 1000)} 000 caractères). Seuls les ${LIMIT / 1000} 000 premiers seront envoyés.\nContinuer ? (sinon, choisissez « Page courante » ou une sélection de pages)`)) return;
    text = text.slice(0, LIMIT); note = '\n[Document tronqué pour respecter la taille maximale.]';
  }
  const prompt = pdfBase64 ? ask : (text ? `${ask}\n\n<document>\n${text}${note}\n</document>` : ask);
  AI.id = 'r' + Date.now(); AI.text = ''; $('#aiOut').textContent = ''; $('#aiOut').classList.add('busy'); if (window.aiErrorActions) window.aiErrorActions(null);
  $('#aiSend').hidden = true; $('#aiStop').hidden = false;
  try {
    const r = await window.api.aiChat({ id: AI.id, system: AI_SYSTEM, prompt, pdfBase64 });
    if (r.cancelled) AI.text += '\n[Arrêté]';
    msg(`Réponse de ${r.provider || 'l\'IA'}${r.model ? ` (${r.model})` : ''}${pdfBase64 ? ' — PDF lu directement (texte, images, mise en page)' : ''}.`);
  } catch (e) { const h = window.aiErrorHelp ? window.aiErrorHelp(errMsg(e)) : { text: errMsg(e) }; AI.text += (AI.text ? '\n\n' : '') + '⚠️ ' + h.text; AI.errCode = h.code; }
  $('#aiOut').textContent = AI.text; $('#aiOut').classList.remove('busy');
  if (window.aiErrorActions) window.aiErrorActions(AI.errCode); AI.errCode = null;
  $('#aiSend').hidden = false; $('#aiStop').hidden = true;
}
async function aiSettings() {
  const st = await window.api.aiStatus();
  const opts = Object.entries(st.providers).map(([k, p]) => `<option value="${k}" ${k === st.provider ? 'selected' : ''}>${esc(p.name)}${p.hasKey ? ' ✔' : ''}</option>`).join('');
  const p0 = st.providers[st.provider];
  const html = `<label class="blk">Fournisseur <select id="aiProv">${opts}</select></label>
    <label class="blk">Modèle <input type="text" id="aiModel" list="aiModels" value="${esc(st.models[st.provider] || p0.models[0] || '')}"><datalist id="aiModels"></datalist></label>
    <label class="blk" id="aiKeyRow">Clé API <input type="password" id="aiKey" placeholder="${p0.hasKey ? '•••••••• (enregistrée — laisser vide pour la garder)' : 'Collez votre clé API'}" autocomplete="off"></label>
    <p class="muted" id="aiHelp"></p>
    <label class="ck" id="aiPdfRow"><input type="checkbox" id="aiPdf" ${st.sendPdf ? 'checked' : ''}> Envoyer les pages en PDF (Claude lit aussi les images, schémas et pages scannées)</label>
    <p class="muted">La clé est chiffrée par Windows sur ce PC et n'est jamais affichée ni partagée. Le texte des pages choisies est envoyé au fournisseur à chaque demande (sauf Ollama, 100 % local).</p>
    <label class="ck"><input type="checkbox" id="aiTest" checked> Tester la connexion après l'enregistrement</label>
    <p class="muted"><b>Important :</b> l'API est facturée à part, en crédit prépayé (Claude : console.anthropic.com › Billing). Un abonnement Claude Pro / Max ou ChatGPT Plus <b>ne donne pas de crédit API</b>.</p>
    <p class="muted"><b>Abonnement ChatGPT Plus, Claude Pro, Gemini, Copilot…</b> : ces abonnements ne donnent pas de clé API. Utilisez le bouton « Mon abonnement » : SknEDU-studio prépare la demande et ouvre votre IA dans le navigateur.</p>`;
  const pr = modal('Réglages de l\'assistant IA', html, [['Annuler', null], ['Enregistrer', () => ({ provider: $('#aiProv').value, model: $('#aiModel').value, key: $('#aiKey').value, sendPdf: $('#aiPdf').checked, test: $('#aiTest').checked }), true]]);
  const upd = async () => {
    const k = $('#aiProv').value; const p = st.providers[k];
    let models = p.models;
    if (k === 'ollama') { const m = await window.api.aiOllamaModels(); models = m || []; $('#aiHelp').innerHTML = m ? `Ollama est actif : ${m.length} modèle(s) installé(s).` : 'Ollama n\'est pas lancé ou pas installé : <a href="https://ollama.com/download" target="_blank">ollama.com</a>, puis « ollama run llama3.2 ».'; }
    else $('#aiHelp').innerHTML = `Obtenir une clé : <a href="${p.keyUrl}" target="_blank">${esc(p.keyUrl)}</a> (facturation à l'usage par ${esc(p.name.split(' (')[0])}).`;
    $('#aiModels').innerHTML = models.map((m) => `<option value="${esc(m)}">`).join('');
    if (!$('#aiModel').value || !models.includes($('#aiModel').value)) $('#aiModel').value = st.models[k] || models[0] || '';
    $('#aiKeyRow').hidden = !!p.local; $('#aiPdfRow').hidden = !p.pdf;
    $('#aiKey').placeholder = p.hasKey ? '•••••••• (enregistrée — laisser vide pour la garder)' : 'Collez votre clé API';
  };
  $('#aiProv').onchange = upd; upd();
  const r = await pr; if (!r) return false; const doTest = r.test; delete r.test;
  try { AI.status = await window.api.aiSave(r); await refreshAiBadge(); msg('Assistant IA configuré.'); if (doTest && window.aiTestConnection) await window.aiTestConnection(); return AI.status.providers[r.provider].hasKey; }
  catch (e) { alert(errMsg(e)); return false; }
}
async function aiSubscription() {
  if (!can('ai')) return denied('ai');
  const ask = $('#aiPrompt').value.trim() || AI_PRESETS.resume[1];
  const pages = S.pages.length ? await aiScopePages() : [];
  const text = pages.length ? await aiDocText(pages) : '';
  const full = `${AI_SYSTEM}\n\n${ask}${text ? `\n\n<document>\n${text}</document>` : ''}`;
  const site = await modal('Utiliser mon abonnement IA', `<p>Votre demande et le texte du document sont copiés. Choisissez votre IA : elle s'ouvre dans le navigateur où vous êtes déjà connecté ; <b>collez (Ctrl+V)</b> puis envoyez.</p>
    <div class="cols3">${AI_SITES.map(([n, u], i) => `<button class="cloudbtn" data-site="${i}"><b>${esc(n)}</b><small>${esc(u.replace('https://', ''))}</small></button>`).join('')}</div>
    <p class="muted">Pour les pages scannées ou les schémas, glissez aussi le fichier PDF enregistré dans la conversation. Ensuite, copiez la réponse et cliquez « Coller la réponse » dans le panneau IA pour l'insérer dans le document.</p>`, [['Fermer', null]]);
  void site;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-site]'); if (!b) return;
  const [n, u] = AI_SITES[+b.dataset.site];
  const ask = $('#aiPrompt').value.trim() || AI_PRESETS.resume[1];
  const pages = S.pages.length ? await aiScopePages() : [];
  const text = pages.length ? await aiDocText(pages) : '';
  await navigator.clipboard.writeText(`${AI_SYSTEM}\n\n${ask}${text ? `\n\n<document>\n${text}</document>` : ''}`);
  window.api.openExternal(u); $('#mBtns button').click(); $('#aiPanel').hidden = false;
  window.api.logEvent('export', { action: `Demande copiée vers ${n}` });
  msg(`Demande copiée : collez-la (Ctrl+V) dans ${n}.`);
});
async function aiInsert() {
  const t = (AI.text || $('#aiOut').textContent).replace(/\n?⚠️.*$/s, '').trim(); if (!t) return;
  if (!can('edit')) return denied('edit');
  const before = S.pages.length; if (before) snapshot();
  const list = await insertPdf(await textToPdf(t), before); S.cur = before; S.sel = new Set([before]); setDirty(true); refresh();
  msg(`${list.length} page(s) ajoutée(s) à la fin du document avec la réponse de l'IA.`);
}
async function aiWord() {
  const t = (AI.text || $('#aiOut').textContent).trim(); if (!t) return;
  const r = await window.api.exportDocx([t.split('\n').map((l) => ({ text: l, size: /^#|^[A-ZÉÈ0-9][^a-z]{3,}$/.test(l) ? 14 : 11, bold: /^#/.test(l) })).map((p) => ({ ...p, text: p.text.replace(/^#+\s*/, '') }))], `${baseName()}-IA.docx`);
  if (r) msg(`Document Word créé : ${r}`);
}

// ---------------- Actions ----------------
const actions = {
  async new() { if (S.pages.length) newTab(); else resetDoc(); await insertBlank(); setDirty(false); showSide('pages'); },
  open: () => openFiles(false),
  insertFiles: () => (S.pages.length ? openFiles(true) : openFiles(false)),
  save: () => save(false), saveAs: () => save(true),
  close() { closeTab(curDoc); },
  slideshow: () => startShow(false), slideshowHere: () => startShow(true), homeSide: () => showSide('home'), toggleRibbon: () => toggleRibbon(),
  blank: insertBlank,
  async fromImages() {
    const files = (await window.api.openDialog({ imagesOnly: true })).filter((f) => !f.error);
    if (files.length) await handleLoaded(files, S.pages.length ? S.cur + 1 : 0);
  },
  scan,
  undo: () => restore(hist.undo, hist.redo), redo: () => restore(hist.redo, hist.undo),
  delItem() { const p = curPage(); if (!p || S.selItem < 0) return; snapshot(); removeItem(p, S.selItem); S.selItem = -1; drawItems(); drawTextLayer(); },
  rotL: () => rotate(-90), rotR: () => rotate(90),
  delPages: deletePages, dupPages: duplicatePages, moveUp: () => movePages(-1), moveDown: () => movePages(1),
  extract: extractPages, split: splitPages, numbers: numberPages,
  ocrPage: () => curPage() && runOcr([curPage()]),
  ocrAll: () => runOcr(S.pages.filter((p) => !p.ocr).length ? S.pages.filter((p) => !p.ocr) : S.pages),
  editAfterOcr() { switchTab('modifier'); setTool('edit'); },
  toWord, toText, toImages,
  protect: protectDialog, unprotect, signPad: signaturePad, compare: compareDocs, clearCompare, scanCopy,
  toPpt: () => toOffice('pptx'), toExcel: () => toOffice('xlsx'), exportAs: exportDialog, convertOffice: convertOfficeFileDialog,
  aiPanel: () => toggleAi(), aiSettings, aiSubscription,
  cloudSave: () => cloudDialog('save'), cloudOpen: () => cloudDialog('open'), admin: adminDialog, print: printDoc, find: () => toggleFind(true), watermark: watermarkDialog, uncrop, compress: compressDoc, certSign,
  zoomIn() { S.zoom = Math.min(4, (typeof S.zoom === 'number' ? S.zoom : S.scale) * 1.2); renderPage(); },
  zoomOut() { S.zoom = Math.max(0.25, (typeof S.zoom === 'number' ? S.zoom : S.scale) / 1.2); renderPage(); },
  zoomFit() { S.zoom = 'fit'; renderPage(); },
  zoomPage() { S.zoom = 'page'; renderPage(); },
  viewMode() { setViewMode(continuous() ? 'page' : 'continu'); },
  prev() { if (S.cur > 0) { S.cur--; S.sel = new Set([S.cur]); S.selItem = -1; refresh(); } },
  next() { if (S.cur < S.pages.length - 1) { S.cur++; S.sel = new Set([S.cur]); S.selItem = -1; refresh(); } },
  async checkUpdate() {
    if (!(await window.api.isPackaged())) return alert('Les mises à jour automatiques fonctionnent dans la version installée (setup .exe).');
    window.api.checkUpdate(); msg('Recherche de mises à jour…');
  },
  async office() {
    if (await window.api.officeStatus()) alert('LibreOffice est installé : la conversion Word / PowerPoint / Excel → PDF est disponible hors-ligne.');
    else officeMissing('Word / PowerPoint / Excel');
  },
  about: () => aboutDialog(), license: () => licenseDialog(),
};

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b && actions[b.dataset.act]) { const f = FEATURE_OF.act[b.dataset.act]; if (f && !can(f)) denied(f); else if (window.premiumGate && !window.premiumGate('act', b.dataset.act)) { /* fonction Premium : fenêtre d'explication affichée */ } else actions[b.dataset.act](); }
  const t = e.target.closest('[data-tool]');
  if (t) { const f = FEATURE_OF.tool[t.dataset.tool]; if (f && !can(f)) denied(f); else setTool(S.tool === t.dataset.tool ? 'select' : t.dataset.tool); } // clic sur l'outil actif : désactivé
  const tab = e.target.closest('[data-tab]'); if (tab) switchTab(tab.dataset.tab);
});
function switchTab(name) {
  $$('#tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('on', p.dataset.panel === name));
  if (name === 'accueil') showSide('home');
  if (document.body.classList.contains('ribbon-auto')) document.body.classList.add('ribbon-show');
}
$('#copyOcr').onclick = () => { navigator.clipboard.writeText($('#ocrText').value); msg('Texte copié.'); };

document.addEventListener('keydown', (e) => {
  if (e.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (e.key === 'F5') { e.preventDefault(); startShow(e.shiftKey); }
  else if (e.ctrlKey && e.key === 'F1') { e.preventDefault(); toggleRibbon(); }
  else if (e.ctrlKey && k === 't') { e.preventDefault(); newTab(); }
  else if (e.ctrlKey && k === 'w') { e.preventDefault(); closeTab(curDoc); }
  else if (e.ctrlKey && e.key === 'Tab') { e.preventDefault(); if (DOCS.length > 1) switchDoc((curDoc + (e.shiftKey ? DOCS.length - 1 : 1)) % DOCS.length); }
  else if (e.ctrlKey && k === 's') { e.preventDefault(); save(e.shiftKey); }
  else if (e.ctrlKey && k === 'o') { e.preventDefault(); actions.open(); }
  else if (e.ctrlKey && k === 'p') { e.preventDefault(); printDoc(); }
  else if (e.ctrlKey && (k === 'f' || k === 'h')) { e.preventDefault(); toggleFind(true); }
  else if (e.ctrlKey && (k === '+' || k === '=')) { e.preventDefault(); actions.zoomIn(); }
  else if (e.ctrlKey && k === '-') { e.preventDefault(); actions.zoomOut(); }
  else if (e.ctrlKey && k === '0') { e.preventDefault(); actions.zoomFit(); }
  else if (e.ctrlKey && k === 'n') { e.preventDefault(); actions.new(); }
  else if (e.ctrlKey && k === 'z') { e.preventDefault(); actions.undo(); }
  else if (e.ctrlKey && k === 'y') { e.preventDefault(); actions.redo(); }
  else if (e.key === 'Delete') { if (S.selItem >= 0) actions.delItem(); else if (document.activeElement === document.body) deletePages(); }
  else if (e.key === 'PageDown' || (e.key === 'ArrowRight' && !e.ctrlKey)) actions.next();
  else if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && !e.ctrlKey)) actions.prev();
  else if (e.key === 'Escape') setTool('select');
});

// Glisser-déposer de fichiers depuis l'Explorateur
document.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
document.addEventListener('drop', async (e) => {
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean);
  busy('Ouverture…'); const files = await window.api.loadPaths(paths);
  if (e.ctrlKey && S.pages.length) await handleLoaded(files, S.cur + 1); // Ctrl : insérer dans le document ouvert
  else { if (S.pages.length) newTab(); await handleLoaded(files, 0); }
  done();
});

window.api.onOpenPaths(async (paths) => {
  busy('Ouverture…'); const files = await window.api.loadPaths(paths);
  if (S.pages.length) newTab();
  await handleLoaded(files, 0); done();
});

// Mises à jour automatiques
// Version sans installation (archive ZIP) : raccourcis Bureau et menu Démarrer proposés une fois
(async () => {
  try {
    const p = await window.api.portableInfo(); if (!p.portable || p.asked) return;
    const r = await modal('SknEDU-studio sans installation', `<p>SknEDU-studio fonctionne depuis ce dossier, sans installation : idéal quand Windows bloque les installateurs.</p>
      <p>Créer un raccourci sur le Bureau et dans le menu Démarrer ?</p>
      <p class="muted">Gardez le dossier à cet emplacement (pas dans Téléchargements) : les mises à jour s'y installent automatiquement.</p>`, [['Non merci', 'non'], ['Créer les raccourcis', 'oui', true]]);
    const yes = r === 'oui'; const ok = await window.api.createShortcuts(yes); if (yes) msg(ok ? 'Raccourcis créés sur le Bureau et dans le menu Démarrer.' : 'Raccourcis non créés.');
  } catch { /* version installée */ }
})();
window.api.onUpdate(({ status, info }) => {
  const el = $('#update');
  if (status === 'manual') { el.innerHTML = `Nouvelle version ${esc(info)} — <a href="https://github.com/ZintaSkn/edupdf-studio/releases/latest" target="_blank">télécharger</a>`; return; }
  const t = { store: 'Mises à jour installées par le Microsoft Store', checking: 'Recherche de mises à jour…', available: `Mise à jour ${info} en téléchargement…`, progress: `Téléchargement de la mise à jour : ${info} %`, none: 'À jour ✔', offline: 'Mises à jour non vérifiées (connexion ?) — nouvel essai plus tard' }[status];
  if (status === 'available' && window.api.platform === 'darwin') { el.innerHTML = `Nouvelle version ${info} — <a href="https://github.com/ZintaSkn/edupdf-studio/releases/latest" target="_blank">télécharger</a>`; return; }
  if (status === 'blocked') {
    el.innerHTML = `Version ${info} disponible — <button id="updWhy">installation bloquée par Windows</button>`;
    $('#updWhy').onclick = () => modal('Mise à jour en attente', `<p>La version <b>${esc(info)}</b> est téléchargée, mais le <b>contrôle intelligent des applications</b> de Windows 11 bloque son installateur, qui n'est pas encore signé numériquement.</p>
      <p>Pour ne pas vous laisser sans logiciel, SknEDU-studio <b>ne se ferme pas</b> pour l'installer : votre version actuelle continue de fonctionner normalement, avec vos documents et réglages.</p>
      <p>La mise à jour s'installera automatiquement dès que les versions seront signées (démarche en cours), ou depuis le Microsoft Store.</p>
      <p class="muted">Ce réglage se trouve dans Sécurité Windows › Contrôle des applications et du navigateur › Contrôle intelligent des applications. Le désactiver est un choix qui vous appartient : il réduit la protection de l'ordinateur et ne peut pas être réactivé sans réinstaller Windows.</p>`, [['Compris', null, true]]);
    return;
  }
  if (status === 'ready' || status === 'ready-admin') {
    el.innerHTML = `Version ${info} prête — <button id="doUpd">Redémarrer et installer</button>`;
    if (status === 'ready-admin') $('#doUpd').title = 'Logiciel installé pour tous les utilisateurs : Windows demandera l\'autorisation d\'un administrateur (fenêtre « Windows PowerShell »).';
    $('#doUpd').onclick = () => { if (confirmDiscard()) { window.api.setDirty(false); window.api.installUpdate(); } };
  } else el.textContent = t || '';
});

let resizeT; window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => typeof S.zoom !== 'number' && renderPage(), 150); });

window.api.version().then((v) => { $('#ver').textContent = 'v' + v; });
applyPolicy(); setInterval(() => { if (!document.hidden) applyPolicy(); }, 60000); // fenêtre réduite : aucune vérification (énergie)
Object.keys(FONT_FAMILIES).forEach((f) => { const o = document.createElement('option'); o.value = f; o.textContent = f; o.style.fontFamily = cssFont({ family: f }); $('#fontFam').appendChild(o); });
$('#fontFam').value = 'Arial';
setTool('select'); refresh();

// Barre de recherche
$('#findText').addEventListener('keydown', async (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') toggleFind(false);
  if (e.key === 'Enter') {
    if ($('#findText').value !== FIND.q) await findAll($('#findText').value);
    else if (FIND.hits.length) { FIND.i = (FIND.i + (e.shiftKey ? -1 : 1) + FIND.hits.length) % FIND.hits.length; gotoHit(); }
  }
});
$('#replText').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') toggleFind(false); });
$('#findNext').onclick = async () => { if ($('#findText').value !== FIND.q) return findAll($('#findText').value); if (FIND.hits.length) { FIND.i = (FIND.i + 1) % FIND.hits.length; gotoHit(); } };
$('#findPrev').onclick = () => { if (FIND.hits.length) { FIND.i = (FIND.i - 1 + FIND.hits.length) % FIND.hits.length; gotoHit(); } };
$('#replOne').onclick = async () => { if ($('#findText').value !== FIND.q) await findAll($('#findText').value); replaceHits(false); };
$('#replAll').onclick = async () => { if ($('#findText').value !== FIND.q) await findAll($('#findText').value); if (FIND.hits.length && confirm(`Remplacer les ${FIND.hits.length} occurrence(s) de « ${FIND.q} » ?`)) replaceHits(true); };
$('#findClose').onclick = () => toggleFind(false);

// Ctrl + molette : zoom
$('#viewWrap').addEventListener('wheel', (e) => { if (!e.ctrlKey || !S.pages.length) return; e.preventDefault(); e.deltaY < 0 ? actions.zoomIn() : actions.zoomOut(); }, { passive: false });

// Panneau IA
$('#aiSend').onclick = () => aiRun();
$('#aiStop').onclick = () => window.api.aiCancel(AI.id);
$('#aiClose').onclick = () => toggleAi(false);
$('#aiCopy').onclick = () => { navigator.clipboard.writeText(AI.text || $('#aiOut').textContent); msg('Réponse copiée.'); };
$('#aiPaste').onclick = async () => { AI.text = await navigator.clipboard.readText(); $('#aiOut').textContent = AI.text; msg('Réponse collée : vous pouvez l\'insérer dans le document ou l\'exporter en Word.'); };
$('#aiInsert').onclick = aiInsert; $('#aiWordBtn').onclick = aiWord;
$('#aiBadge').onclick = aiSettings;
$('#aiPrompt').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && e.ctrlKey) aiRun(); });
document.addEventListener('click', (e) => { const b = e.target.closest('[data-ai]'); if (b) { if (!can('ai')) return denied('ai'); aiRun(b.dataset.ai); } });

// Mise en page adaptative : hauteur réelle de l'en-tête, panneau Propriétés repliable, ruban défilant à la molette
new ResizeObserver(() => document.documentElement.style.setProperty('--hdr', document.querySelector('header').offsetHeight + 'px')).observe(document.querySelector('header'));
$('#sideToggle').onclick = () => document.body.classList.toggle('side-open');
$$('.panel').forEach((p) => p.addEventListener('wheel', (e) => { if (p.scrollWidth > p.clientWidth && !e.ctrlKey) { e.preventDefault(); p.scrollLeft += e.deltaY || e.deltaX; } }, { passive: false }));
window.addEventListener('resize', () => { if (innerWidth > 1000) document.body.classList.remove('side-open'); });

// ================= Onglets de documents (plusieurs fichiers dans la même fenêtre) =================
function docState() {
  return { sources: S.sources, pages: S.pages, cur: S.cur, sel: S.sel, zoom: S.zoom, filePath: S.filePath, fileName: S.fileName, dirty: S.dirty,
    selItem: S.selItem, protect: S.protect, watermark: S.watermark, origin: S.origin, readOnly: S.readOnly, rid: S.rid, undo: hist.undo, redo: hist.redo, thumbs: thumbCache, texts: textCache };
}
const emptyDoc = () => ({ sources: [], pages: [], cur: 0, sel: new Set(), zoom: 'fit', filePath: null, fileName: 'Document.pdf', dirty: false,
  selItem: -1, protect: null, watermark: null, origin: null, readOnly: false, rid: null, undo: [], redo: [], thumbs: new Map(), texts: new Map() });
function loadDocState(d) {
  Object.assign(S, { sources: d.sources, pages: d.pages, cur: d.cur, sel: d.sel, zoom: d.zoom, filePath: d.filePath, fileName: d.fileName, dirty: d.dirty,
    selItem: d.selItem, protect: d.protect, watermark: d.watermark, origin: d.origin || null, readOnly: !!d.readOnly, rid: d.rid || null });
  if (window.afterDocSwitch) window.afterDocSwitch();
  hist.undo = d.undo; hist.redo = d.redo; thumbCache = d.thumbs; textCache = d.texts;
  FIND.hits = []; drawFindLayer();
}
function initDocs() { DOCS.length = 0; DOCS.push(docState()); curDoc = 0; renderDocTabs(); }
function switchDoc(i) {
  if (i === curDoc || !DOCS[i]) return;
  DOCS[curDoc] = docState(); curDoc = i; loadDocState(DOCS[i]);
  setDirty(S.dirty); if (S.tool !== 'select') setTool('select'); refresh(); showSide(S.pages.length ? 'pages' : 'home');
}
function newTab() {
  DOCS[curDoc] = docState(); DOCS.push(emptyDoc()); curDoc = DOCS.length - 1; loadDocState(DOCS[curDoc]);
  setDirty(false); refresh(); showSide('home');
}
function closeTab(i) {
  const d = i === curDoc ? docState() : DOCS[i];
  if (d.dirty && !confirm(`« ${d.fileName} » a des modifications non enregistrées. Fermer quand même ?`)) return;
  if (i === curDoc) DOCS[curDoc] = docState();
  DOCS.splice(i, 1);
  if (!DOCS.length) DOCS.push(emptyDoc());
  curDoc = Math.min(i, DOCS.length - 1); loadDocState(DOCS[curDoc]);
  setDirty(S.dirty); refresh(); showSide(S.pages.length ? 'pages' : 'home');
}
function renderDocTabs() {
  const bar = $('#docTabs'); if (!bar) return;
  bar.innerHTML = DOCS.map((d, i) => {
    const st = i === curDoc ? { n: S.fileName, dirty: S.dirty, pages: S.pages.length, lock: !!S.protect } : { n: d.fileName, dirty: d.dirty, pages: d.pages.length, lock: !!d.protect };
    const name = st.pages ? st.n : 'Nouvel onglet';
    return `<div class="dtab${i === curDoc ? ' on' : ''}" data-doc="${i}" title="${esc(name)}">${st.lock ? '🔒' : '📄'}<span>${esc(name)}</span>${st.dirty ? '<b title="Modifications non enregistrées">●</b>' : ''}<button data-close="${i}" title="Fermer l'onglet (Ctrl+W)">×</button></div>`;
  }).join('') + '<button class="dnew" title="Nouvel onglet (Ctrl+T)">+</button>';
}
$('#docTabs').addEventListener('click', (e) => {
  const c = e.target.closest('[data-close]'); if (c) { e.stopPropagation(); return closeTab(+c.dataset.close); }
  if (e.target.closest('.dnew')) return newTab();
  const t = e.target.closest('[data-doc]'); if (t) switchDoc(+t.dataset.doc);
});
$('#docTabs').addEventListener('auxclick', (e) => { const t = e.target.closest('[data-doc]'); if (t && e.button === 1) closeTab(+t.dataset.doc); });

// ================= Barre latérale gauche : Accueil (essentiel de l'enseignant) / Pages =================
let sideMode = 'home';
function showSide(mode) {
  sideMode = mode;
  $('#homeSide').hidden = mode !== 'home'; $('#thumbs').hidden = mode !== 'pages';
  $('#leftBar').classList.toggle('rail', mode === 'home');
  $$('#sideSwitch [data-side]').forEach((b) => b.classList.toggle('on', b.dataset.side === mode));
  if (mode === 'home') renderRecent();
}
$('#sideSwitch').addEventListener('click', (e) => { const b = e.target.closest('[data-side]'); if (b) showSide(b.dataset.side); });
// Barre Accueil en icônes seules : le nom et le mode d'emploi s'affichent dans l'info-bulle (et pour les lecteurs d'écran)
const HOME_ITEMS = [
  ['Démarrer', [
    ['data-act="new"', '📄', 'Nouveau document', 'Crée une page A4 vierge (dans un nouvel onglet si un document est ouvert). Raccourci : Ctrl+N.'],
    ['data-act="open"', '📂', 'Ouvrir un fichier', 'PDF, Word, PowerPoint, Excel, images, EPUB, pages web… Chaque fichier s\'ouvre dans son propre onglet. Raccourci : Ctrl+O.'],
    ['data-act="cloudOpen"', '🌐', 'Ouvrir depuis le cloud', 'OneDrive, Google Drive, Dropbox, iCloud… via le dossier synchronisé de votre PC.'],
    ['data-act="scan"', '🖨', 'Scanner un document', 'Numérise une ou plusieurs pages, puis propose de rendre le texte modifiable (OCR).'],
    ['data-act="fromImages"', '🖼', 'Photos → PDF', 'Assemble des photos (tableau, cahier, polycopié) en un PDF, une photo par page.']]],
  ['Modèles pour la classe', [
    ['data-tpl="seyes" data-name="Feuille Seyès"', '📒', 'Feuille Seyès (grands carreaux)', 'Feuille lignée Seyès avec marge, prête à imprimer ou à compléter.'],
    ['data-tpl="carreaux" data-name="Petits carreaux"', '🔲', 'Petits carreaux 5 mm', 'Quadrillage 5 mm pour la géométrie, les sciences ou les brouillons.'],
    ['data-tpl="evaluation" data-name="Évaluation"', '📝', 'Évaluation', 'En-tête élève (nom, prénom, classe, date), case de note /20, appréciation et barème par exercice.'],
    ['data-tpl="exercices" data-name="Fiche d\'exercices"', '✏️', 'Fiche d\'exercices', 'En-tête élève et blocs d\'exercices lignés.']]],
  ['Outils de l\'enseignant', [
    ['data-act="grading"', '🧑‍🏫', 'Corriger des copies', 'Scannez un paquet de copies : barème, note et commentaires par copie (manuellement ou proposés par l\'IA), puis export des notes vers Excel.'],
    ['data-act="diffEval"', '🎯', 'Évaluations différenciées', 'À partir du document : 3 niveaux, sujets A/B et corrigé, export Moodle (GIFT) et tableur.'],
    ['data-act="mailMerge"', '✉️', 'Publipostage', 'Génère bulletins, attestations ou convocations en lot à partir d\'un fichier Excel ou CSV.'],
    ['data-act="dys"', '🔠', 'Version adaptée (DYS / malvoyants)', 'Recrée le document avec une police lisible, des interlignes larges et une règle de lecture colorée.'],
    ['data-act="speak"', '🔊', 'Lire à voix haute', 'Lit la page courante avec les voix de Windows, sans connexion. Cliquer à nouveau pour arrêter.'],
    ['data-act="classroom"', '📡', 'Classe connectée', 'Partage le document aux élèves par le Wi-Fi de la classe (QR code) et récupère leurs copies, sans Internet.'],
    ['data-ai="qcm"', '✅', 'Créer un QCM (IA)', 'L\'assistant IA crée un QCM corrigé à partir du document ouvert.'],
    ['data-act="ocrPage"', '🔍', 'Rendre un scan modifiable', 'Reconnaît le texte de la page (OCR) pour le rechercher, le copier et le corriger.'],
    ['data-act="slideshow"', '🖥', 'Projeter en diaporama', 'Plein écran, stylo, tableau blanc, minuteur, mode présentateur sur deux écrans. Raccourci : F5.'],
    ['data-act="compare"', '⚖️', 'Comparer deux versions', 'Surligne les ajouts, modifications et suppressions entre deux fichiers.'],
    ['data-tool="sign"', '✍️', 'Signer', 'Place votre signature manuscrite ; signature numérique par certificat dans l\'onglet Protéger.']]]
];
function initHome() {
  $('#homeSide').innerHTML = HOME_ITEMS.map(([group, items]) => `<section role="group" aria-label="${esc(group)}">${items.map(([attrs, icon, label, help]) =>
    `<button ${attrs} class="hi" title="${esc(label)}\n${esc(help)}" aria-label="${esc(label)} : ${esc(help)}">${icon}</button>`).join('')}</section>`).join('<hr>') +
    '<hr><section role="group" aria-label="Fichiers récents" id="recentList"></section>' +
    `<hr><button class="hi" id="shortcutsHelp" title="Raccourcis clavier\nCtrl+T nouvel onglet · Ctrl+W fermer · Ctrl+Tab onglet suivant\nF5 diaporama · Ctrl+F1 masquer le ruban · Ctrl+F rechercher · Ctrl+G aller à la page\nClic droit sur un bouton du ruban : barre d'accès rapide" aria-label="Raccourcis clavier">⌨️</button>`;
  showSide('home');
}
async function renderRecent() {
  let list = []; try { list = await window.api.recentList(); } catch { list = []; }
  const box = $('#recentList'); if (!box) return;
  box.innerHTML = list.slice(0, 6).map((r, i) => `<button class="hi recent" data-recent="${i}" title="${esc(r.name)}\n${esc(r.dir)}\nFichier récent : cliquer pour l'ouvrir dans un onglet." aria-label="Ouvrir le fichier récent ${esc(r.name)}">🕘</button>`).join('') +
    (list.length ? '<button class="hi" id="recentClear" title="Effacer la liste des fichiers récents" aria-label="Effacer la liste des fichiers récents">🧹</button>' : '<span class="hi muted" title="Fichiers récents\nLes fichiers ouverts et enregistrés apparaîtront ici." aria-label="Aucun fichier récent">🕘</span>');
  box.querySelectorAll('[data-recent]').forEach((b) => { b.onclick = async () => {
    const r = list[+b.dataset.recent]; busy('Ouverture…');
    try { const files = await window.api.recentOpen(r.path); if (S.pages.length) newTab(); else resetDoc(); await handleLoaded(files, 0); } catch (e) { alert(errMsg(e)); }
    done();
  }; });
  const c = $('#recentClear'); if (c) c.onclick = async () => { await window.api.recentClear(); renderRecent(); };
}// Modèles : feuilles d'école prêtes à remplir ou à imprimer
async function templatePdf(kind) {
  const d = await PDFDocument.create(); const pg = d.addPage(A4); const emb = fontEmbedder(d);
  const mm = 72 / 25.4; const [W, H] = A4; const blue = rgb(0, 24 / 255, 113 / 255);
  const line = (x1, y1, x2, y2, c, t = 0.4) => pg.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, color: c, thickness: t });
  const text = (s, x, y, size = 11, bold = false, color = blue) => drawUnicode(pg, emb, s, { x, y, size, font: { family: 'Arial', bold }, color });
  d.setTitle({ seyes: 'Feuille Seyès', carreaux: 'Petits carreaux', evaluation: 'Évaluation', exercices: 'Fiche d\'exercices' }[kind]);
  if (kind === 'seyes') {
    const top = H - 20 * mm, bottom = 12 * mm, left = 10 * mm, right = W - 10 * mm;
    for (let i = 0, y = top; y > bottom; i++, y -= 2 * mm) line(left, y, right, y, i % 4 === 0 ? rgb(0.55, 0.55, 0.85) : rgb(0.8, 0.8, 0.95), i % 4 === 0 ? 0.5 : 0.3);
    for (let x = left; x <= right; x += 8 * mm) line(x, top, x, bottom, rgb(0.8, 0.8, 0.95), 0.3);
    line(left + 30 * mm, top + 6 * mm, left + 30 * mm, bottom, rgb(0.85, 0.2, 0.25), 0.8);
  } else if (kind === 'carreaux') {
    for (let x = 10 * mm; x <= W - 10 * mm; x += 5 * mm) line(x, 12 * mm, x, H - 12 * mm, rgb(0.78, 0.82, 0.92), 0.3);
    for (let y = 12 * mm; y <= H - 12 * mm; y += 5 * mm) line(10 * mm, y, W - 10 * mm, y, rgb(0.78, 0.82, 0.92), 0.3);
  } else {
    const m = 15 * mm;
    pg.drawRectangle({ x: m, y: H - m - 34 * mm, width: W - 2 * m, height: 34 * mm, borderColor: blue, borderWidth: 1 });
    await text('Nom :', m + 4 * mm, H - m - 9 * mm, 11, true); await text('Prénom :', m + 4 * mm, H - m - 17 * mm, 11, true);
    await text('Classe :', m + 4 * mm, H - m - 25 * mm, 11, true); await text('Date :', W / 2 - 10 * mm, H - m - 9 * mm, 11, true);
    if (kind === 'evaluation') {
      pg.drawRectangle({ x: W - m - 42 * mm, y: H - m - 30 * mm, width: 38 * mm, height: 26 * mm, borderColor: rgb(0.95, 0.71, 0.2), borderWidth: 1.5 });
      await text('Note', W - m - 38 * mm, H - m - 10 * mm, 10, true); await text('/ 20', W - m - 16 * mm, H - m - 26 * mm, 14, true);
      await text('Appréciation :', W / 2 - 10 * mm, H - m - 17 * mm, 11, true);
    }
    if (LIC.org) await text(LIC.org, m, H - m + 3 * mm, 10, true); // édition Établissement : nom de l'établissement
    await text(kind === 'evaluation' ? 'Évaluation — titre :' : 'Fiche d\'exercices — thème :', m, H - m - 46 * mm, 15, true);
    let y = H - m - 58 * mm;
    for (let n = 1; n <= (kind === 'evaluation' ? 4 : 5) && y > 30 * mm; n++) {
      await text(kind === 'evaluation' ? `Exercice ${n}  ( ……… / ……… pts )` : `Exercice ${n}`, m, y, 12, true); y -= 8 * mm;
      for (let l = 0; l < (kind === 'evaluation' ? 6 : 5) && y > 20 * mm; l++, y -= 8 * mm) line(m, y, W - m, y, rgb(0.75, 0.78, 0.88), 0.4);
      y -= 4 * mm;
    }
  }
  return d.save();
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-tpl]'); if (!b) return;
  busy('Création du modèle…');
  try { const bytes = await templatePdf(b.dataset.tpl); if (S.pages.length) newTab(); else resetDoc(); { const l0 = await insertPdf(bytes, 0); S.sources[l0[0].src].tpl = b.dataset.tpl; } S.fileName = (b.dataset.name || 'Modèle') + '.pdf'; S.cur = 0; S.sel = new Set([0]); setDirty(true); refresh(); showSide('pages'); done('Modèle créé : complétez-le avec « Ajouter du texte », puis enregistrez ou imprimez.'); }
  catch (err) { done(); alert(errMsg(err)); }
});

// ================= Ruban : épinglé ou masqué automatiquement =================
const RIB = { mode: 'pinned', hideT: null };
function applyRibbonMode() {
  document.body.classList.toggle('ribbon-auto', RIB.mode === 'auto'); document.body.classList.remove('ribbon-show');
  $('#ribbonMode').textContent = RIB.mode === 'auto' ? '▾' : '▴';
  $('#ribbonMode').title = RIB.mode === 'auto' ? 'Ruban masqué automatiquement — cliquer pour l\'épingler (Ctrl+F1)' : 'Masquer automatiquement le ruban (Ctrl+F1)';
}
function toggleRibbon() { RIB.mode = RIB.mode === 'auto' ? 'pinned' : 'auto'; store.set('edupdf.ribbon', RIB.mode); applyRibbonMode(); }
function initRibbonMode() {
  RIB.mode = store.get('edupdf.ribbon') || (innerHeight < 640 ? 'auto' : 'pinned'); // petits écrans : masqué automatiquement
  applyRibbonMode();
  $('#ribbonMode').onclick = toggleRibbon;
  $('#tabs').addEventListener('dblclick', (e) => { if (e.target.closest('[data-tab]')) toggleRibbon(); });
  const hide = () => document.body.classList.remove('ribbon-show');
  document.addEventListener('pointerdown', (e) => { if (RIB.mode === 'auto' && !e.target.closest('header') && !e.target.closest('#ctxMenu')) hide(); });
  $('#ribbon').addEventListener('click', (e) => { if (RIB.mode === 'auto' && e.target.closest('[data-act],[data-tool],[data-ai]')) setTimeout(hide, 150); });
  $('header').addEventListener('mouseleave', () => { if (RIB.mode === 'auto') RIB.hideT = setTimeout(hide, 900); });
  $('header').addEventListener('mouseenter', () => clearTimeout(RIB.hideT));
}

// ================= Barre d'accès rapide (personnalisable) =================
const QAT_DEFAULT = ['save', 'undo', 'redo', 'print', 'slideshow'];
let QAT = QAT_DEFAULT.slice();
try { const q = JSON.parse(store.get('edupdf.qat') || 'null'); if (Array.isArray(q)) QAT = q; } catch { /* défaut */ }
function qatSource(id) {
  const [kind, name] = id.startsWith('tool:') ? ['tool', id.slice(5)] : ['act', id];
  return { kind, name, el: document.querySelector(`#ribbon [data-${kind}="${name}"]`) };
}
function renderQat() {
  $('#qat').innerHTML = QAT.map((id) => {
    const { kind, name, el } = qatSource(id); if (!el) return '';
    const icon = (el.querySelector('i') || {}).textContent || '•'; const label = el.textContent.replace(icon, '').replace(/\s+/g, ' ').trim();
    return `<button data-${kind}="${name}" data-qat="${id}" title="${esc(label)}">${icon}</button>`;
  }).join('') + '<button id="qatMore" title="Personnaliser la barre d\'accès rapide">▾</button>';
  store.set('edupdf.qat', JSON.stringify(QAT)); applyPolicy();
}
function ctxMenu(x, y, entries) {
  const m = $('#ctxMenu'); m.innerHTML = entries.map((e, i) => (e === '-' ? '<hr>' : `<button data-i="${i}">${e[0]}</button>`)).join('');
  m.hidden = false; m.style.left = Math.min(x, innerWidth - 270) + 'px'; m.style.top = Math.min(y, innerHeight - m.offsetHeight - 8) + 'px';
  m.onclick = (ev) => { const b = ev.target.closest('[data-i]'); if (!b) return; m.hidden = true; entries[+b.dataset.i][1](); };
}
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#ctxMenu')) $('#ctxMenu').hidden = true; });
document.addEventListener('contextmenu', (e) => {
  const q = e.target.closest('#qat [data-qat]');
  if (q) { e.preventDefault(); return ctxMenu(e.clientX, e.clientY, [['✖ Retirer de la barre d\'accès rapide', () => { QAT = QAT.filter((x) => x !== q.dataset.qat); renderQat(); }]]); }
  const b = e.target.closest('#ribbon [data-act], #ribbon [data-tool]');
  if (!b) return;
  e.preventDefault();
  const id = b.dataset.act || 'tool:' + b.dataset.tool;
  ctxMenu(e.clientX, e.clientY, QAT.includes(id)
    ? [['✖ Retirer de la barre d\'accès rapide', () => { QAT = QAT.filter((x) => x !== id); renderQat(); }]]
    : [['★ Ajouter à la barre d\'accès rapide', () => { QAT.push(id); renderQat(); }]]);
});
document.addEventListener('click', (e) => {
  if (e.target.id !== 'qatMore') return;
  const r = e.target.getBoundingClientRect();
  const entries = QAT.map((id) => { const { el } = qatSource(id); const label = el ? el.textContent.replace(/\s+/g, ' ').trim() : id; return [`✖ Retirer : ${esc(label)}`, () => { QAT = QAT.filter((x) => x !== id); renderQat(); }]; });
  ctxMenu(r.left, r.bottom + 4, [...entries, '-', ['↺ Rétablir la barre par défaut', () => { QAT = QAT_DEFAULT.slice(); renderQat(); }], ['ℹ️ Astuce : clic droit sur un bouton du ruban pour l\'ajouter', () => {}]]);
});

// ================= Diaporama plein écran =================
const SHOW = { on: false, i: 0, token: 0, digits: '', idleT: null, laser: false, fit: 'width', zoom: 1, wheelT: 0 };
try { SHOW.fit = localStorage.getItem('edupdf.showfit') || 'width'; } catch { /* */ }
async function startShow(fromCurrent) {
  if (!S.pages.length) return alert('Ouvrez d\'abord un document à projeter.');
  SHOW.on = true; SHOW.i = fromCurrent ? S.cur : 0; SHOW.digits = '';
  const el = $('#show'); el.hidden = false; el.className = ''; SHOW.zoom = 1;
  try { await el.requestFullscreen({ navigationUI: 'hide' }); } catch { /* plein écran refusé : affichage dans la fenêtre */ }
  await renderShow();
}
async function renderShow() {
  const tok = ++SHOW.token; const p = S.pages[SHOW.i]; const pg = await getPdfPage(p);
  const R = (pg.rotate + p.rot + 360) % 360; const v1 = pg.getViewport({ scale: 1, rotation: R });
  const W = window.innerWidth, H = window.innerHeight; const dpr = window.devicePixelRatio || 1;
  const k = (SHOW.fit === 'width' ? W / v1.width : Math.min(W / v1.width, H / v1.height)) * SHOW.zoom;
  const vp = pg.getViewport({ scale: k * dpr, rotation: R });
  const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  c.style.width = Math.round(vp.width / dpr) + 'px'; c.style.height = Math.round(vp.height / dpr) + 'px';
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await pg.render({ canvasContext: ctx, viewport: vp }).promise; await paintItems(ctx, vp, p);
  if (tok !== SHOW.token || !SHOW.on) return;
  c.id = 'showCanvas'; const sh = $('#show'); const scrolls = SHOW.fit === 'width' || SHOW.zoom > 1;
  sh.classList.toggle('fitw', scrolls); c.style.marginTop = scrolls ? Math.max(0, (H - vp.height / dpr) / 2) + 'px' : '';
  $('#showCanvas').replaceWith(c); if (SHOW.keepScroll === undefined) sh.scrollTop = SHOW.toBottom ? sh.scrollHeight : 0; SHOW.keepScroll = undefined; SHOW.toBottom = false;
  if (window.showRenderHook) window.showRenderHook(c, vp, p);
  const info = $('#showInfo'); info.textContent = `${SHOW.i + 1} / ${S.pages.length}`; info.classList.add('vis');
  clearTimeout(info._t); info._t = setTimeout(() => info.classList.remove('vis'), 1500);
}
function showGo(i) { const n = Math.max(0, Math.min(S.pages.length - 1, i)); if (n !== SHOW.i) { SHOW.toBottom = n < SHOW.i && SHOW.scrollUpNav; SHOW.scrollUpNav = false; SHOW.i = n; renderShow(); } }
/** Largeur de la fenêtre : la page défile d'abord, puis on passe à la suivante. */
function showScroll(dir) {
  const el = $('#show'); if (!el.classList.contains('fitw')) return false;
  const max = el.scrollHeight - el.clientHeight;
  if (dir > 0 && el.scrollTop < max - 2) { el.scrollBy({ top: el.clientHeight * 0.85, behavior: 'smooth' }); return true; }
  if (dir < 0 && el.scrollTop > 2) { el.scrollBy({ top: -el.clientHeight * 0.85, behavior: 'smooth' }); return true; }
  return false;
}
function showBadgeMsg(t) { const info = $('#showInfo'); info.textContent = t; info.classList.add('vis'); clearTimeout(info._t); info._t = setTimeout(() => info.classList.remove('vis'), 1600); }
function showRefit() { SHOW.keepScroll = true; renderShow(); }
function endShow() {
  if (!SHOW.on) return;
  if (window.showEndHook) window.showEndHook(); SHOW.on = false; $('#show').hidden = true; $('#laser').hidden = true; SHOW.laser = false;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  S.cur = SHOW.i; S.sel = new Set([S.cur]); refresh();
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && SHOW.on) endShow(); else if (SHOW.on) renderShow(); });
window.addEventListener('keydown', (e) => {
  if (!SHOW.on) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (window.showKeyHook && window.showKeyHook(e)) return; // stylo, tableau blanc, minuteur…
  const k = e.key; const el = $('#show');
  if (/^[0-9]$/.test(k)) { SHOW.digits += k; return; }
  if (k === 'Enter' && SHOW.digits) { showGo(+SHOW.digits - 1); SHOW.digits = ''; return; }
  SHOW.digits = '';
  if (['ArrowDown', 'PageDown', ' '].includes(k) && showScroll(1)) return;
  if (['ArrowUp', 'PageUp'].includes(k) && showScroll(-1)) return;
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'].includes(k)) { el.classList.remove('black', 'white'); showGo(SHOW.i + 1); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(k)) { el.classList.remove('black', 'white'); SHOW.scrollUpNav = ['ArrowUp', 'PageUp'].includes(k); showGo(SHOW.i - 1); }
  else if (k === 'f' || k === 'F') { SHOW.fit = SHOW.fit === 'width' ? 'page' : 'width'; SHOW.zoom = 1; try { localStorage.setItem('edupdf.showfit', SHOW.fit); } catch { /* */ } renderShow(); showBadgeMsg(SHOW.fit === 'width' ? '↔ Largeur de l\'écran (F : page entière)' : '⛶ Page entière (F : largeur de l\'écran)'); }
  else if (k === '+' || k === '=') { SHOW.zoom = Math.min(4, SHOW.zoom * 1.2); showRefit(); showBadgeMsg(`🔍 ${Math.round(SHOW.zoom * 100)} %`); }
  else if (k === '-' || k === '_') { SHOW.zoom = Math.max(0.4, SHOW.zoom / 1.2); showRefit(); showBadgeMsg(`🔍 ${Math.round(SHOW.zoom * 100)} %`); }
  else if (k === 'Home') showGo(0);
  else if (k === 'End') showGo(S.pages.length - 1);
  else if (k === 'b' || k === 'B' || k === '.') { el.classList.remove('white'); el.classList.toggle('black'); }
  else if (k === 'w' || k === 'W' || k === ',') { el.classList.remove('black'); el.classList.toggle('white'); }
  else if (k === 'l' || k === 'L') { SHOW.laser = !SHOW.laser; $('#laser').hidden = !SHOW.laser; el.classList.toggle('laser', SHOW.laser); }
  else if (k === 'Escape' || k === 'F5') endShow();
}, true);
$('#show').addEventListener('click', () => { if (window.showPointerBusy && window.showPointerBusy()) return; showGo(SHOW.i + 1); });
$('#show').addEventListener('contextmenu', (e) => { e.preventDefault(); showGo(SHOW.i - 1); });
$('#show').addEventListener('wheel', (e) => {
  const el = $('#show');
  if (e.ctrlKey) { e.preventDefault(); SHOW.zoom = Math.max(0.4, Math.min(4, SHOW.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); showRefit(); showBadgeMsg(`🔍 ${Math.round(SHOW.zoom * 100)} %`); return; }
  if (el.classList.contains('fitw')) { // la page défile ; au bord, page suivante / précédente
    const max = el.scrollHeight - el.clientHeight;
    if ((e.deltaY > 0 && el.scrollTop < max - 2) || (e.deltaY < 0 && el.scrollTop > 2)) return;
  }
  e.preventDefault(); const now = Date.now(); if (now - SHOW.wheelT < 450) return; SHOW.wheelT = now;
  if (e.deltaY < 0) SHOW.scrollUpNav = true; showGo(SHOW.i + (e.deltaY > 0 ? 1 : -1));
}, { passive: false });
$('#show').addEventListener('mousemove', (e) => {
  const el = $('#show'); el.classList.remove('idle'); clearTimeout(SHOW.idleT); SHOW.idleT = setTimeout(() => el.classList.add('idle'), 2500);
  if (SHOW.laser) Object.assign($('#laser').style, { left: e.clientX + 'px', top: e.clientY + 'px' });
});
window.addEventListener('resize', () => { if (SHOW.on) renderShow(); });

// ================= Éditions (open core), à propos, mentions légales =================
let LIC = { edition: 'communaute', label: 'Communauté', org: '' };
async function applyLicense() {
  try { LIC = await window.api.licenseStatus(); } catch { return; }
  const tag = $('#editionTag');
  tag.textContent = LIC.edition === 'communaute' ? 'Édition Communauté' : `Édition ${LIC.label}${LIC.org ? ' — ' + LIC.org : ''}${LIC.expired ? ' (licence expirée)' : ''}`;
  tag.classList.toggle('pro', LIC.edition !== 'communaute' && !LIC.expired);
  tag.classList.toggle('expired', !!LIC.expired);
}
async function licenseDialog() {
  await applyLicense();
  const L = LIC;
  const etat = L.edition === 'communaute'
    ? '<p>Vous utilisez l\'<b>édition Communauté</b> : gratuite, complète et libre (AGPL-3.0).</p>'
    : `<p><b>Édition ${esc(L.label)}</b> — ${esc(L.org)}<br>${L.seats ? esc(L.seats) + ' poste(s) — ' : ''}${L.expired ? '<span class="err">expirée le ' + esc(L.expires) + '</span>' : 'valable jusqu\'au ' + esc(L.expires) + (L.daysLeft <= 30 ? ` <span class="err">(${L.daysLeft} jour(s) restant(s))</span>` : '')}<br><span class="muted">Référence ${esc(L.ref || '')} · ${L.scope === 'machine' ? 'installée pour tout le PC' : 'installée pour ce compte'}</span></p>`;
  const r = await modal('Licence et édition', `${etat}
    <p class="muted">Les éditions <b>Enseignant</b> et <b>Établissement</b> ajoutent le nom de l'établissement dans l'application et les modèles,
    le support prioritaire, l'aide au déploiement sur les postes et la formation. Toutes les fonctions restent disponibles dans l'édition Communauté.</p>
    <label class="blk">Clé de licence <textarea id="licKey" rows="3" style="width:100%;box-sizing:border-box" placeholder="SKN1.…"></textarea></label>
    <div class="row"><button class="small" id="licFile">Importer un fichier .sknlic…</button>
    <label class="ck"><input type="checkbox" id="licMachine"> Pour tous les comptes Windows de ce PC</label></div>
    ${L.support ? `<p><a href="${esc(L.support)}" target="_blank">Support prioritaire</a></p>` : ''}`,
  [...(L.edition !== 'communaute' && L.scope === 'user' ? [['Retirer la licence', 'remove']] : []), ['Fermer', null], ['Activer', () => ({ text: $('#licKey').value, scope: $('#licMachine').checked ? 'machine' : 'user' }), true]]);
  if (r === 'remove') { if (confirm('Retirer la licence de ce compte ? Le logiciel repasse en édition Communauté.')) { await window.api.licenseRemove(); await applyLicense(); } return; }
  if (!r) return;
  try { await window.api.licenseActivate(r.text, r.scope); await applyLicense(); alert(`Licence activée : édition ${LIC.label}${LIC.org ? ' — ' + LIC.org : ''}.`); }
  catch (e) { alert(errMsg(e)); }
}
document.addEventListener('click', async (e) => { if (e.target.id !== 'licFile') return; const t = await window.api.licensePick(); if (t) $('#licKey').value = t.trim(); });
/** Journal de sécurité : qui a fait quoi et quand sur ce poste, avec contrôle d'intégrité (chaîne scellée). */
const AUDIT_LABELS = { demarrage: 'Ouverture du logiciel', compte_enregistre: 'Compte enregistré', licence_activation: 'Activation d\'une licence', licence_desactivation: 'Désactivation d\'une licence',
  licence_retrait: 'Retrait d\'une licence', admin_connexion: 'Connexion administrateur', admin_echec: 'Mot de passe administrateur incorrect', admin_session_expiree: 'Session administrateur expirée',
  admin_mot_de_passe_change: 'Mot de passe administrateur changé', verrouillage: 'Verrouillage après essais incorrects', appel_refuse: 'Appel interne refusé', ouverture_refusee: 'Ouverture de fichier refusée',
  mise_a_jour_prete: 'Mise à jour prête', mise_a_jour_installation: 'Installation d\'une mise à jour', signature_certificat: 'Signature par certificat', interface_plantee: 'Interface relancée après un plantage',
  interface_figee: 'Interface figée', erreur_interne: 'Erreur interne' };
async function securityLogDialog() {
  const j = await window.api.auditList(200);
  const state = j.integrity.ok ? `<p class="ok">✔ Journal intact : ${j.integrity.count} évènement(s), chaîne vérifiée.</p>` : `<p class="err">⚠ Journal altéré à partir de la ligne ${j.integrity.brokenAt} : une ligne a été modifiée, supprimée ou ajoutée hors du logiciel.</p>`;
  const rows = j.entries.map((e) => `<tr><td>${esc(e.ts ? new Date(e.ts).toLocaleString('fr-FR') : '')}</td><td>${esc(AUDIT_LABELS[e.type] || e.type)}</td><td>${esc(Object.entries(e.detail || {}).map(([k, v]) => k + ' : ' + v).join(' · '))}</td><td>${esc(e.user || '')}</td></tr>`).join('');
  const r = await modal('🛡️ Journal de sécurité', `${state}<p class="muted">Ce journal reste sur l'ordinateur. Il consigne les évènements de sécurité (connexions, licences, mises à jour, refus), jamais le contenu des documents.</p>
    <div class="auditbox"><table class="grtable"><tr><th>Date</th><th>Évènement</th><th>Détail</th><th>Utilisateur</th></tr>${rows}</table></div>`, [['Copier', 'copy'], ['Fermer', null, true]]);
  if (r === 'copy') { await navigator.clipboard.writeText(j.entries.map((e) => [e.ts, AUDIT_LABELS[e.type] || e.type, JSON.stringify(e.detail || {}), e.user || ''].join('\t')).join('\n')); msg('Journal copié.'); }
}
async function aboutDialog() {
  await applyLicense();
  const v = await window.api.version();
  const r = await modal('À propos de SknEDU-studio', `<p><b>SknEDU-studio ${esc(v)}</b> — éditeur PDF hors-ligne pour l'enseignement.<br>
    Édition : <b>${esc(window.__licensing ? window.__licensing.editionText(LIC) : LIC.label)}</b>${LIC.account ? ' — ' + esc(LIC.account.email) : ''}</p>
    <p>Logiciel libre sous licence <b>GNU AGPL-3.0</b> : vous pouvez l'utiliser, l'étudier, le modifier et le redistribuer selon cette licence.
    Le code source complet est publié. Le nom et le logo « SknEDU-studio » sont des marques réservées (voir la politique de marque).</p>
    <p class="muted">Rendu PDF.js · Édition pdf-lib · Protection et formats MuPDF · OCR Tesseract · IA : Claude, ChatGPT, Gemini, Mistral, Ollama.</p>`,
  [['Journal de sécurité', 'journal'], ['Licences des composants', 'notices'], ['Code source', 'source'], ['Politique de marque', 'tm'], ['Fermer', null, true]]);
  if (r === 'journal') return securityLogDialog();
  if (r === 'source') window.api.openExternal('https://github.com/ZintaSkn/edupdf-studio');
  if (r === 'tm') window.api.openExternal('https://github.com/ZintaSkn/edupdf-studio/blob/main/TRADEMARK.md');
  if (r === 'notices') { const n = await window.api.notices(); await modal('Composants tiers et licences', `<pre class="notices">${esc(n)}</pre>`, [['Fermer', null, true]]); }
}
// Démarrage de l'interface : onglets de documents, Accueil, ruban, accès rapide
initDocs(); initHome(); initRibbonMode(); renderQat(); switchTab('accueil'); applyLicense();

// Accès pour les tests
window.__edupdf = { applyLicense, LIC: () => LIC, templatePdf, renderPage, newTab, switchDoc, closeTab, toggleRibbon, startShow, aiRun, aiDocText, AI, applyPolicy, can: (f) => can(f), pageTable, toOffice, S, buildPdf, insertPdf, blankPdf, textToPdf, refresh, actions, handleLoaded, diffWords, matchFont, getTextItems, getPdfPage, fontOfItem, setTool, startTextEdit };
