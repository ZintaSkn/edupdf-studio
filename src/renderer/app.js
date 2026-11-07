/* EduPDF Studio — interface et moteur d'édition */
'use strict';
const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = '../../node_modules/pdfjs-dist/build/pdf.worker.min.js';

const A4 = [595.28, 841.89];
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ---------------- État ----------------
const S = {
  sources: [],          // { bytes, doc (pdf.js), cache:{} }
  pages: [],            // { uid, src, idx, rot, items:[], ocr:null, edited:[] }
  cur: 0, sel: new Set(), tool: 'select', zoom: 'fit', scale: 1, vp: null,
  filePath: null, fileName: 'Document.pdf', dirty: false, selItem: -1, renderToken: 0
};
const hist = { undo: [], redo: [] };
let uidc = 1;
const thumbCache = new Map();
const textCache = new Map();

const curPage = () => S.pages[S.cur];
const color = () => $('#color').value;
const size = () => Math.max(4, +$('#size').value || 14);

// ---------------- Utilitaires ----------------
function msg(t) { $('#msg').textContent = t; }
function busy(t) { $('#busyMsg').textContent = t; $('#busy').hidden = false; }
function done(t) { $('#busy').hidden = true; if (t) msg(t); }
function setDirty(v) { S.dirty = v; window.api.setDirty(v); updateTitle(); }
function updateTitle() { document.title = `${S.dirty ? '● ' : ''}${S.fileName} — EduPDF Studio`; }
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); }
function dataUrlToBytes(u) { const b = atob(u.split(',')[1]); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
function bytesToDataUrl(bytes, mime = 'application/octet-stream') {
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(new Blob([bytes], { type: mime })); });
}
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
function normRect(r) { return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])]; }
function viewRect(vp, rect) { const [a, b, c, d] = normRect(vp.convertToViewportRectangle(rect)); return { l: a, t: b, w: c - a, h: d - b }; }
function viewToPdfRect(vp, l, t, w, h) { return normRect([...vp.convertToPdfPoint(l, t), ...vp.convertToPdfPoint(l + w, t + h)]); }
const baseName = () => S.fileName.replace(/\.pdf$/i, '');

const encOk = new Map();
function clean(font, s) {
  s = String(s).replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/\t/g, '    ').replace(/ /g, ' ');
  let out = '';
  for (const ch of s) {
    if (!encOk.has(ch)) { try { font.encodeText(ch); encOk.set(ch, true); } catch { encOk.set(ch, false); } }
    out += encOk.get(ch) ? ch : '?';
  }
  return out;
}

// ---------------- Historique ----------------
function snapshot() { hist.undo.push(JSON.stringify({ pages: S.pages, cur: S.cur })); if (hist.undo.length > 60) hist.undo.shift(); hist.redo = []; setDirty(true); }
function restore(from, to) {
  if (!from.length) return;
  to.push(JSON.stringify({ pages: S.pages, cur: S.cur }));
  const st = JSON.parse(from.pop());
  S.pages = st.pages; S.cur = Math.min(st.cur, S.pages.length - 1); S.selItem = -1; S.sel = new Set([S.cur]);
  setDirty(true); refresh();
}

// ---------------- Sources PDF ----------------
async function addSource(bytes) {
  const u8 = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes);
  const doc = await pdfjsLib.getDocument({ data: u8.slice() }).promise;
  S.sources.push({ bytes: u8, doc, cache: {} });
  return S.sources.length - 1;
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
  const d = await PDFDocument.create(); const font = await d.embedFont(StandardFonts.Helvetica);
  const fs = 11, lh = 15, m = 56, maxW = A4[0] - 2 * m;
  let pg = d.addPage(A4), y = A4[1] - m;
  const put = (line) => { if (y < m) { pg = d.addPage(A4); y = A4[1] - m; } pg.drawText(line, { x: m, y, size: fs, font }); y -= lh; };
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const words = clean(font, raw).split(' '); let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(t, fs) > maxW && line) { put(line); line = w; } else line = t;
    }
    put(line);
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
  for (const f of files) {
    try {
      if (f.error) {
        if (f.error === 'LIBREOFFICE_MISSING') { officeMissing(f.name); continue; }
        alert(`Impossible d'ouvrir ${f.name} :\n${f.error}`); continue;
      }
      if (f.kind === 'image') { images.push(f.bytes); continue; }
      const bytes = f.kind === 'text' ? await textToPdf(f.text) : f.bytes;
      const list = await insertPdf(bytes, at + added); added += list.length;
      if (wasEmpty && files.length === 1) { S.filePath = f.path; S.fileName = f.name.replace(/\.[^.]+$/, '') + '.pdf'; }
    } catch (e) { alert(`Erreur avec ${f.name} : ${e.message}`); }
  }
  if (images.length) { const list = await insertPdf(await imagesToPdf(images), at + added); added += list.length; }
  if (!added) return 0;
  S.cur = wasEmpty ? 0 : at; S.sel = new Set([S.cur]);
  setDirty(!(wasEmpty && files.length === 1 && files[0].kind === 'pdf'));
  refresh();
  msg(`${added} page(s) ajoutée(s).`);
  return added;
}
function snapshotIfDoc() { if (S.pages.length) snapshot(); }

function officeMissing(name) {
  if (confirm(`« ${name} » est un fichier Office.\n\nPour convertir Word, PowerPoint et Excel, EduPDF utilise LibreOffice (gratuit, hors-ligne).\nIl n'est pas installé sur ce PC.\n\nOuvrir la page de téléchargement de LibreOffice ?`))
    window.api.openExternal('https://fr.libreoffice.org/download/telecharger-libreoffice/');
}

async function openFiles(insert) {
  busy('Ouverture…');
  try {
    const files = await window.api.openDialog();
    if (!files.length) return done();
    if (!insert && S.pages.length && !confirmDiscard()) return done();
    if (!insert) resetDoc();
    await handleLoaded(files, insert ? S.cur + 1 : 0);
    done();
  } catch (e) { done(); alert(e.message); }
}
function confirmDiscard() { return !S.dirty || confirm('Des modifications ne sont pas enregistrées. Continuer quand même ?'); }
function resetDoc() {
  S.sources = []; S.pages = []; S.cur = 0; S.sel = new Set(); S.filePath = null; S.fileName = 'Document.pdf'; S.selItem = -1;
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

async function buildPdf(list = S.pages) {
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const libs = {};
  for (const p of list) {
    if (!libs[p.src]) libs[p.src] = await PDFDocument.load(S.sources[p.src].bytes, { ignoreEncryption: true });
    const [cp] = await out.copyPages(libs[p.src], [p.idx]);
    const pg = await getPdfPage(p);
    const R = (pg.rotate + p.rot + 360) % 360;
    cp.setRotation(degrees(R));
    out.addPage(cp);
    const vp = pg.getViewport({ scale: 1, rotation: R });
    const textAt = (vx, vy, txt, sz, opts = {}) => {
      const [x, y] = vp.convertToPdfPoint(vx, vy);
      cp.drawText(clean(font, txt), { x, y, size: sz, font, rotate: degrees(R), ...opts });
    };
    // Couche de texte invisible (OCR) : rend la page cherchable et copiable
    if (p.ocr) for (const w of p.ocr.words) {
      const r = viewRect(vp, w.rect); const t = clean(font, w.text); const w1 = font.widthOfTextAtSize(t, 1);
      if (!w1 || r.h <= 0) continue;
      const sz = Math.max(1, Math.min(r.h * 1.1, r.w / w1));
      textAt(r.l, r.t + r.h * 0.8, t, sz, { opacity: 0 });
    }
    for (const o of p.items) {
      if (o.type === 'rect') {
        const [x1, y1, x2, y2] = normRect(o.rect); const box = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
        if (o.kind === 'highlight') cp.drawRectangle({ ...box, color: hexRgb(o.color || '#ffe600'), opacity: 0.38, blendMode: 'Multiply' });
        else if (o.kind === 'whiteout') cp.drawRectangle({ ...box, color: rgb(1, 1, 1) });
        else cp.drawRectangle({ ...box, borderColor: hexRgb(o.color), borderWidth: o.width || 2 });
      } else if (o.type === 'image') {
        const [x1, y1, x2, y2] = normRect(o.rect);
        const img = await out.embedPng(await rotatedPng(o.src, R));
        cp.drawImage(img, { x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
      } else if (o.type === 'ink') {
        for (let i = 1; i < o.points.length; i++) {
          const [a, b] = [o.points[i - 1], o.points[i]];
          cp.drawLine({ start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thickness: o.width, color: hexRgb(o.color), lineCap: 1 });
        }
      } else if (o.type === 'text') {
        const [vx, vy] = vp.convertToViewportPoint(...o.at);
        o.text.split('\n').forEach((line, i) => { if (line) textAt(vx, vy + o.size * (0.85 + i * 1.2), line, o.size, { color: hexRgb(o.color) }); });
      }
    }
  }
  return out.save();
}

async function save(asNew) {
  if (!S.pages.length) return;
  busy('Enregistrement…');
  try {
    const bytes = await buildPdf();
    const p = await window.api.save({ bytes, defaultName: S.fileName, filters: [{ name: 'PDF', extensions: ['pdf'] }], filePath: asNew ? null : S.filePath });
    if (p) { S.filePath = p; S.fileName = p.split(/[\\/]/).pop(); setDirty(false); done(`Enregistré : ${p}`); } else done();
  } catch (e) { done(); alert('Échec de l\'enregistrement : ' + e.message); }
}

// ---------------- Rendu ----------------
async function renderPage() {
  const p = curPage();
  const token = ++S.renderToken;
  $('#welcome').hidden = !!p; $('#pageBox').hidden = !p;
  $('#pageLbl').textContent = p ? `${S.cur + 1} / ${S.pages.length}` : '–';
  if (!p) return;
  const pg = await getPdfPage(p);
  const R = (pg.rotate + p.rot + 360) % 360;
  const base = pg.getViewport({ scale: 1, rotation: R });
  S.scale = S.zoom === 'fit' ? Math.min(Math.max(($('#viewWrap').clientWidth - 60) / base.width, 0.3), 2.5) : S.zoom;
  $('#zoomLbl').textContent = S.zoom === 'fit' ? `Ajusté (${Math.round(S.scale * 100)} %)` : `${Math.round(S.scale * 100)} %`;
  const vp = pg.getViewport({ scale: S.scale, rotation: R });
  const dpr = window.devicePixelRatio || 1;
  const c = document.createElement('canvas');
  c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr);
  c.style.width = vp.width + 'px'; c.style.height = vp.height + 'px';
  await pg.render({ canvasContext: c.getContext('2d'), viewport: pg.getViewport({ scale: S.scale * dpr, rotation: R }) }).promise;
  if (token !== S.renderToken) return;
  c.id = 'canvas'; $('#canvas').replaceWith(c);
  S.vp = vp;
  const box = $('#pageBox'); box.style.width = vp.width + 'px'; box.style.height = vp.height + 'px';
  drawItems();
  await drawTextLayer();
  $('#ocrText').value = p.ocr ? p.ocr.text : '';
}

function drawItems() {
  const p = curPage(); const vp = S.vp; const layer = $('#overlayLayer');
  layer.innerHTML = '';
  if (!p || !vp) return;
  p.items.forEach((o, i) => {
    const el = document.createElement('div'); el.className = 'ov'; el.dataset.i = i;
    if (o.type === 'rect' || o.type === 'image') {
      const r = viewRect(vp, o.rect); Object.assign(el.style, { left: r.l + 'px', top: r.t + 'px', width: r.w + 'px', height: r.h + 'px' });
      el.classList.add(o.type === 'image' ? 'image' : o.kind);
      if (o.kind === 'box') el.style.borderColor = o.color, el.style.borderWidth = (o.width || 2) * S.scale + 'px';
      if (o.kind === 'highlight' && o.color) el.style.background = o.color + '61';
      if (o.type === 'image') { const im = document.createElement('img'); im.src = o.src; el.appendChild(im); }
      const h = document.createElement('div'); h.className = 'handle'; el.appendChild(h);
    } else if (o.type === 'text') {
      const [x, y] = vp.convertToViewportPoint(...o.at);
      el.classList.add('text'); el.textContent = o.text;
      Object.assign(el.style, { left: x + 'px', top: y + 'px', fontSize: o.size * S.scale + 'px', color: o.color });
    } else if (o.type === 'ink') {
      const pts = o.points.map((q) => vp.convertToViewportPoint(...q));
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const l = Math.min(...xs), t = Math.min(...ys);
      Object.assign(el.style, { left: l + 'px', top: t + 'px', width: Math.max(...xs) - l + 'px', height: Math.max(...ys) - t + 'px' });
      el.innerHTML = `<svg width="100%" height="100%"><polyline fill="none" stroke="${o.color}" stroke-width="${o.width * S.scale}" stroke-linecap="round" stroke-linejoin="round" points="${pts.map((q) => `${q[0] - l},${q[1] - t}`).join(' ')}"/></svg>`;
    }
    if (i === S.selItem) el.classList.add('sel');
    layer.appendChild(el);
  });
  const o = p.items[S.selItem];
  $('#selInfo').textContent = o ? `Élément sélectionné : ${({ text: 'texte', rect: 'forme', image: 'image', ink: 'tracé' })[o.type]} — Suppr pour l'effacer` : 'Aucun élément sélectionné';
}

async function getTextItems(p) {
  const key = `${p.src}:${p.idx}`;
  if (!textCache.has(key)) {
    const pg = await getPdfPage(p); const tc = await pg.getTextContent();
    textCache.set(key, tc.items.map((it, i) => {
      const [a, b, c, d, e, f] = it.transform; const h = Math.hypot(c, d);
      if (!it.str.trim() || Math.abs(b) > 0.01 || a < 0) return null;
      return { key: 'n' + i, text: it.str, size: h, rect: [e, f - 0.22 * h, e + it.width, f + 0.9 * h] };
    }).filter(Boolean));
  }
  const list = [...textCache.get(key)];
  if (p.ocr) p.ocr.lines.forEach((l, i) => { if (l.text) list.push({ key: 'o' + i, text: l.text, ocr: true, rect: l.rect }); });
  return list.filter((t) => !p.edited.includes(t.key));
}

async function drawTextLayer() {
  const layer = $('#textLayer'); layer.innerHTML = '';
  const p = curPage(); if (!p || S.tool !== 'edit') return;
  const vp = S.vp;
  for (const t of await getTextItems(p)) {
    const r = viewRect(vp, t.rect);
    const sp = document.createElement('span'); sp.className = 'tl' + (t.ocr ? ' ocr' : ''); sp.textContent = t.text;
    const fs = (t.size || (Math.abs(t.rect[3] - t.rect[1]) * 0.8)) * S.scale;
    Object.assign(sp.style, { left: r.l + 'px', top: r.t + 'px', minWidth: r.w + 'px', height: r.h + 'px', fontSize: fs + 'px', paddingTop: Math.max(0, r.h - fs) / 2 + 'px' });
    sp.onclick = () => startTextEdit(sp, t, r, fs / S.scale);
    layer.appendChild(sp);
  }
}

function startTextEdit(sp, t, r, fsPdf) {
  if (sp.isContentEditable) return;
  sp.contentEditable = 'true'; sp.classList.add('editing'); sp.focus();
  document.getSelection().selectAllChildren(sp);
  const finish = (commit) => {
    sp.onblur = null; sp.onkeydown = null;
    const txt = sp.innerText.replace(/\n+$/, '');
    if (commit && txt !== t.text) {
      snapshot();
      const p = curPage();
      const pad = 1.5;
      p.items.push({ type: 'rect', kind: 'whiteout', rect: viewToPdfRect(S.vp, r.l - pad, r.t - pad, r.w + 2 * pad, r.h + 2 * pad) });
      if (txt.trim()) p.items.push({ type: 'text', at: S.vp.convertToPdfPoint(r.l, r.t + (r.h - fsPdf * S.scale) / 2), size: Math.round(fsPdf * 10) / 10, color: color(), text: txt });
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
function renderThumbs() {
  const box = $('#thumbs'); box.innerHTML = '';
  S.pages.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'thumb' + (i === S.cur ? ' cur' : '') + (S.sel.has(i) ? ' sel' : '');
    d.draggable = true; d.dataset.i = i;
    const key = `${p.src}:${p.idx}:${p.rot}`;
    d.innerHTML = (thumbCache.has(key) ? `<img src="${thumbCache.get(key)}">` : '<div class="ph"></div>') + `<span>${i + 1}</span>` + (p.ocr ? '<b class="badge">OCR</b>' : '');
    if (!thumbCache.has(key)) thumbQueue = thumbQueue.then(async () => {
      const pg = await getPdfPage(p); const R = (pg.rotate + p.rot + 360) % 360;
      const v0 = pg.getViewport({ scale: 1, rotation: R }); const vp = pg.getViewport({ scale: 240 / v0.width, rotation: R });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      thumbCache.set(key, c.toDataURL('image/jpeg', 0.8));
      const ph = d.querySelector('.ph'); if (ph) ph.outerHTML = `<img src="${thumbCache.get(key)}">`;
    }).catch(() => {});
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
    drag = { mode: e.target.classList.contains('handle') ? 'resize' : 'move', o, start: pos, orig: JSON.parse(JSON.stringify(o)), moved: false, snap: JSON.stringify({ pages: S.pages, cur: S.cur }) };
  } else if (S.tool === 'text') {
    snapshot();
    p.items.push({ type: 'text', at: S.vp.convertToPdfPoint(pos[0], pos[1] - size() * S.scale * 0.6), size: size(), color: color(), text: '' });
    S.selItem = p.items.length - 1; drawItems();
    editTextItem(S.selItem); e.preventDefault(); return;
  } else if (S.tool === 'ink') {
    drag = { mode: 'ink', pts: [pos] };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none');
    svg.innerHTML = `<polyline fill="none" stroke="${color()}" stroke-width="${+$('#width').value * S.scale}" stroke-linecap="round" stroke-linejoin="round"/>`;
    layer.appendChild(svg); drag.svg = svg;
  } else {
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
  if (d.mode === 'ink') {
    d.svg.remove();
    if (d.pts.length > 1) { snapshot(); p.items.push({ type: 'ink', points: d.pts.map((q) => S.vp.convertToPdfPoint(...q)), color: color(), width: +$('#width').value || 2 }); }
    drawItems();
  } else if (d.mode === 'rubber') {
    d.rb.remove();
    let [l, t, w, h] = [Math.min(pos[0], d.start[0]), Math.min(pos[1], d.start[1]), Math.abs(pos[0] - d.start[0]), Math.abs(pos[1] - d.start[1])];
    if (w < 5 || h < 5) { if (S.tool !== 'image') return; w = 160; h = 120; }
    const rect = viewToPdfRect(S.vp, l, t, w, h);
    if (S.tool === 'image') {
      const files = await window.api.openDialog({ imagesOnly: true });
      if (!files.length || files[0].error) return;
      const src = await bytesToDataUrl(files[0].bytes, 'image/png');
      const img = await loadImg(src);
      // conserver les proportions de l'image
      const k = Math.min(w / img.width, h / img.height); const rr = viewToPdfRect(S.vp, l, t, img.width * k, img.height * k);
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0);
      snapshot(); p.items.push({ type: 'image', rect: rr, src: c.toDataURL('image/png') });
    } else {
      snapshot(); p.items.push({ type: 'rect', kind: S.tool, rect, color: S.tool === 'highlight' ? '#ffe600' : color(), width: +$('#width').value || 2 });
    }
    S.selItem = p.items.length - 1; drawItems();
  }
});

$('#overlayLayer').addEventListener('dblclick', (e) => {
  const el = e.target.closest('.ov'); if (!el) return;
  const o = curPage().items[+el.dataset.i]; if (o.type === 'text') editTextItem(+el.dataset.i);
});

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
  S.tool = t; $$('.tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  const box = $('#pageBox'); box.className = 't-' + t;
  if (t !== 'select') { S.selItem = -1; drawItems(); }
  drawTextLayer();
  const tips = {
    select: 'Cliquez un élément pour le déplacer, le redimensionner, ou double-cliquez un texte pour le modifier.',
    edit: 'Cliquez sur un texte de la page pour le corriger (Entrée pour valider, Échap pour annuler).',
    text: 'Cliquez à l\'endroit où ajouter du texte.', image: 'Tracez un cadre puis choisissez une image.',
    highlight: 'Tracez un rectangle pour surligner.', whiteout: 'Tracez un rectangle pour masquer (effacer) une zone.',
    box: 'Tracez un cadre.', ink: 'Dessinez à main levée (annotations, corrections).'
  };
  msg(tips[t] || '');
}

// Propriétés appliquées à l'élément sélectionné
['color', 'size', 'width'].forEach((id) => $('#' + id).addEventListener('change', () => {
  const o = curPage() && curPage().items[S.selItem]; if (!o) return;
  snapshot();
  if (id === 'color' && o.type !== 'image' && o.kind !== 'whiteout') o.color = color();
  if (id === 'size' && o.type === 'text') o.size = size();
  if (id === 'width' && (o.type === 'ink' || o.kind === 'box')) o.width = +$('#width').value;
  drawItems();
}));

// ---------------- Opérations sur les pages ----------------
const selected = () => (S.sel.size ? [...S.sel] : [S.cur]).filter((i) => i < S.pages.length).sort((a, b) => a - b);

function rotate(delta) { if (!S.pages.length) return; snapshot(); selected().forEach((i) => { S.pages[i].rot = (S.pages[i].rot + delta + 360) % 360; }); refresh(); }
function deletePages() {
  const sel = selected(); if (!S.pages.length) return;
  if (sel.length === S.pages.length) return alert('Impossible de supprimer toutes les pages.');
  if (!confirm(`Supprimer ${sel.length} page(s) ?`)) return;
  snapshot(); sel.reverse().forEach((i) => S.pages.splice(i, 1));
  S.cur = Math.min(sel[sel.length - 1], S.pages.length - 1); S.sel = new Set([S.cur]); refresh();
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
async function insertBlank() {
  const bytes = await blankPdf();
  if (S.pages.length) snapshot();
  const at = S.pages.length ? S.cur + 1 : 0;
  await insertPdf(bytes, at); S.cur = at; S.sel = new Set([at]); setDirty(true); refresh();
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
  const sel = selected(); if (!S.pages.length) return;
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
    alert('Scanner indisponible :\n' + e.message + '\n\nVérifiez que le scanner est branché et allumé, ou utilisez « Depuis des images » avec des photos.');
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
  } catch (e) { done(); alert('Erreur OCR : ' + e.message); }
  refresh();
}

// ---------------- Exports ----------------
async function pageParagraphs(p) {
  const items = (await getTextItems(p)).filter((t) => !t.ocr);
  const lines = [];
  if (items.length) {
    const sorted = items.map((t) => ({ ...t, y: t.rect[1], x: t.rect[0] })).sort((a, b) => b.y - a.y || a.x - b.x);
    for (const t of sorted) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - t.y) < (t.size || 10) * 0.5) { last.parts.push(t); }
      else lines.push({ y: t.y, size: t.size, parts: [t] });
    }
    lines.forEach((l) => { l.parts.sort((a, b) => a.x - b.x); l.text = l.parts.map((q) => q.text).join(' ').replace(/\s+/g, ' ').trim(); });
  } else if (p.ocr) {
    p.ocr.lines.filter((l) => !p.edited.includes('o' + p.ocr.lines.indexOf(l))).forEach((l) => lines.push({ y: l.rect[1], text: l.text, size: 11 }));
  }
  p.items.filter((o) => o.type === 'text' && o.tag !== 'num').forEach((o) => o.text.split('\n').forEach((t) => lines.push({ y: o.at[1], text: t, size: o.size })));
  lines.sort((a, b) => b.y - a.y);
  return lines.filter((l) => l.text).map((l) => ({ text: l.text, size: Math.min(28, Math.max(8, Math.round(l.size || 11))) }));
}
async function toWord() {
  if (!S.pages.length) return; busy('Conversion en Word…');
  const pages = []; let empty = 0;
  for (const p of S.pages) { const ps = await pageParagraphs(p); if (!ps.length) empty++; pages.push(ps); }
  done();
  if (empty === S.pages.length) return alert('Aucun texte trouvé. S\'il s\'agit d\'un scan, lancez d\'abord l\'OCR (onglet OCR).');
  const r = await window.api.exportDocx(pages, `${baseName()}.docx`);
  if (r) msg(`Document Word créé : ${r}`);
}
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
  const doc = await pdfjsLib.getDocument({ data: await buildPdf() }).promise; const files = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i); const vp = pg.getViewport({ scale: 2 });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    files.push({ name: `${baseName()}-page-${String(i).padStart(3, '0')}.png`, bytes: dataUrlToBytes(c.toDataURL('image/png')) });
  }
  const dir = await window.api.saveMany(files); done(dir ? `${files.length} image(s) créée(s) dans ${dir}` : '');
}

// ---------------- Actions ----------------
const actions = {
  async new() { if (S.pages.length && !confirmDiscard()) return; resetDoc(); await insertBlank(); setDirty(false); },
  open: () => openFiles(false),
  insertFiles: () => (S.pages.length ? openFiles(true) : openFiles(false)),
  save: () => save(false), saveAs: () => save(true),
  close() { if (!confirmDiscard()) return; resetDoc(); refresh(); },
  blank: insertBlank,
  async fromImages() {
    const files = (await window.api.openDialog({ imagesOnly: true })).filter((f) => !f.error);
    if (files.length) await handleLoaded(files, S.pages.length ? S.cur + 1 : 0);
  },
  scan,
  undo: () => restore(hist.undo, hist.redo), redo: () => restore(hist.redo, hist.undo),
  delItem() { const p = curPage(); if (!p || S.selItem < 0) return; snapshot(); p.items.splice(S.selItem, 1); S.selItem = -1; drawItems(); },
  rotL: () => rotate(-90), rotR: () => rotate(90),
  delPages: deletePages, dupPages: duplicatePages, moveUp: () => movePages(-1), moveDown: () => movePages(1),
  extract: extractPages, split: splitPages, numbers: numberPages,
  ocrPage: () => curPage() && runOcr([curPage()]),
  ocrAll: () => runOcr(S.pages.filter((p) => !p.ocr).length ? S.pages.filter((p) => !p.ocr) : S.pages),
  editAfterOcr() { switchTab('modifier'); setTool('edit'); },
  toWord, toText, toImages,
  zoomIn() { S.zoom = Math.min(4, (S.zoom === 'fit' ? S.scale : S.zoom) * 1.2); renderPage(); },
  zoomOut() { S.zoom = Math.max(0.25, (S.zoom === 'fit' ? S.scale : S.zoom) / 1.2); renderPage(); },
  zoomFit() { S.zoom = 'fit'; renderPage(); },
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
  async about() { alert(`EduPDF Studio ${await window.api.version()}\n\nÉditeur PDF hors-ligne pour l'enseignement.\nLicence perpétuelle (MIT) — aucun abonnement.\nOCR : Tesseract • Rendu : PDF.js • Édition : pdf-lib`); }
};

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (b && actions[b.dataset.act]) actions[b.dataset.act]();
  const t = e.target.closest('[data-tool]'); if (t) setTool(t.dataset.tool);
  const tab = e.target.closest('[data-tab]'); if (tab) switchTab(tab.dataset.tab);
});
function switchTab(name) {
  $$('#tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('on', p.dataset.panel === name));
}
$('#copyOcr').onclick = () => { navigator.clipboard.writeText($('#ocrText').value); msg('Texte copié.'); };

document.addEventListener('keydown', (e) => {
  if (e.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === 's') { e.preventDefault(); save(e.shiftKey); }
  else if (e.ctrlKey && k === 'o') { e.preventDefault(); actions.open(); }
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
  await handleLoaded(files, S.pages.length ? S.cur + 1 : 0); done();
});

window.api.onOpenPaths(async (paths) => {
  busy('Ouverture…'); const files = await window.api.loadPaths(paths);
  if (S.pages.length && confirmDiscard()) resetDoc();
  await handleLoaded(files, S.pages.length ? S.cur + 1 : 0); done();
});

// Mises à jour automatiques
window.api.onUpdate(({ status, info }) => {
  const el = $('#update');
  const t = { checking: 'Recherche de mises à jour…', available: `Mise à jour ${info} en téléchargement…`, progress: `Téléchargement de la mise à jour : ${info} %`, none: 'À jour ✔', offline: 'Hors-ligne — mises à jour vérifiées plus tard' }[status];
  if (status === 'ready') {
    el.innerHTML = `Version ${info} prête — <button id="doUpd">Redémarrer et installer</button>`;
    $('#doUpd').onclick = () => { if (confirmDiscard()) { window.api.setDirty(false); window.api.installUpdate(); } };
  } else el.textContent = t || '';
});

let resizeT; window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => S.zoom === 'fit' && renderPage(), 150); });

window.api.version().then((v) => { $('#ver').textContent = 'v' + v; });
setTool('select'); refresh();

// Accès pour les tests
window.__edupdf = { S, buildPdf, insertPdf, blankPdf, textToPdf, refresh, actions };
