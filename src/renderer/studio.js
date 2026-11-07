// SknEDU-studio — confort de travail : barres latérales automatiques, zoom, défilement continu,
// gestion des modifications, commentaires en lecture seule, format d'origine, sauvegarde automatique dans le cloud.
/* global S, $, $$, actions, FEATURE_OF, msg, busy, done, modal, esc, errMsg, can, denied, snapshot, setDirty, drawItems, drawTextLayer,
   renderPage, refresh, removeItem, curPage, buildPdf, toOffice, toImages, pageParagraphs, baseName, hashStr, stateJson, applyPolicy,
   continuous, setViewMode, SHOW, PDFLib, DOCS */

const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } };

// ================================================================ 1. Barres latérales : affichage et masquage automatiques
const SB = { mode: lsGet('edupdf.sidebars', 'auto') };
function applySidebars() {
  document.body.classList.toggle('sb-auto', SB.mode === 'auto');
  const b = $('#sbMode');
  if (b) { b.innerHTML = SB.mode === 'auto' ? '📌<span class="lbl"> Barres auto</span>' : '📌<span class="lbl"> Barres fixes</span>'; b.title = SB.mode === 'auto' ? 'Les barres latérales apparaissent au passage de la souris sur le bord de la fenêtre et se masquent seules.\nCliquer pour les garder affichées.' : 'Les barres latérales restent affichées.\nCliquer pour qu\'elles s\'affichent et se masquent automatiquement.'; }
  window.dispatchEvent(new Event('resize')); // la page s'ajuste à la nouvelle largeur
}
for (const id of ['leftBar', 'side']) {
  const el = $('#' + id); if (!el) continue;
  const open = () => { clearTimeout(el._t); el.classList.add('peek'); };
  const close = () => { clearTimeout(el._t); el._t = setTimeout(() => { if (!el.matches(':hover') && !el.contains(document.activeElement)) el.classList.remove('peek'); }, 700); };
  el.addEventListener('mouseenter', open); el.addEventListener('mouseleave', close);
  el.addEventListener('focusin', open); el.addEventListener('focusout', close);
}
$('#sbMode').onclick = () => { SB.mode = SB.mode === 'auto' ? 'fixed' : 'auto'; lsSet('edupdf.sidebars', SB.mode); applySidebars(); };
applySidebars();

// ================================================================ 2. Zoom et défilement
function syncViewControls() {
  const sel = $('#zoomSel'); if (!sel) return;
  const v = typeof S.zoom === 'number' ? String(Math.round(S.zoom * 100) / 100) : S.zoom;
  let opt = [...sel.options].find((o) => o.value === v);
  sel.querySelectorAll('option.tmp').forEach((o) => { if (o !== opt) o.remove(); });
  if (!opt) { opt = new Option(`${Math.round(S.zoom * 100)} %`, v); opt.className = 'tmp'; sel.add(opt); }
  sel.value = v;
  const vb = $('#viewModeBtn'); if (vb) { const c = continuous(); vb.innerHTML = c ? '📜<span class="lbl"> Continu</span>' : '📄<span class="lbl"> Page par page</span>'; vb.classList.toggle('on', c); }
}
$('#zoomSel').onchange = (e) => { const v = e.target.value; S.zoom = v === 'fit' || v === 'page' ? v : +v; renderPage(); };

// ================================================================ 3. Modifications de la page : liste, suppression une à une ou en bloc
const KIND_LABEL = { highlight: '🖍 Surlignage', whiteout: '⬜ Masquage', box: '▭ Cadre' };
function itemLabel(o) {
  if (o.grp) { const t = curPage().items.find((x) => x.grp === o.grp && x.type === 'text'); return `✏️ Texte modifié « ${esc(((t && t.text) || '(supprimé)').slice(0, 28))} »`; }
  if (o.type === 'rect') return KIND_LABEL[o.kind] || '▭ Forme';
  return ({ text: `🔤 Texte « ${esc((o.text || '').slice(0, 28))} »`, image: '🖼 Image / signature', ink: '✍ Tracé au stylo', note: `💬 Commentaire « ${esc((o.text || '').slice(0, 24))} »`, field: '☐ Champ de formulaire' })[o.type] || o.type;
}
function renderModList() {
  const box = $('#modList'); if (!box) return; const p = curPage();
  if (!p) { box.innerHTML = '<p class="muted">Aucun document.</p>'; return; }
  const seen = new Set(); const rows = [];
  p.items.forEach((o, i) => { if (o.grp) { if (seen.has(o.grp)) return; seen.add(o.grp); } rows.push(`<div class="modrow${i === S.selItem ? ' sel' : ''}"><button class="modsel" data-i="${i}" title="Sélectionner">${itemLabel(o)}</button><button class="moddel" data-i="${i}" title="Supprimer cette modification" aria-label="Supprimer">✖</button></div>`); });
  if (p.crop) rows.push('<div class="modrow"><span class="modsel">✂ Rognage de la page</span><button class="moddel" data-crop="1" title="Annuler le rognage" aria-label="Supprimer">✖</button></div>');
  if (S.watermark && S.watermark.text) rows.push(`<div class="modrow"><span class="modsel">💧 Filigrane « ${esc(S.watermark.text.slice(0, 20))} » (tout le document)</span><button class="moddel" data-wm="1" title="Retirer le filigrane" aria-label="Supprimer">✖</button></div>`);
  box.innerHTML = rows.length ? rows.join('') : '<p class="muted">Aucune modification sur cette page.</p>';
  $('#modClearPage').disabled = !rows.length;
}
$('#modList').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return; const p = curPage(); if (!p) return;
  if (b.classList.contains('modsel')) { S.selItem = +b.dataset.i; drawItems(); return; }
  if (!can('edit')) return denied('edit');
  snapshot();
  if (b.dataset.crop) { p.crop = null; refresh(); }
  else if (b.dataset.wm) { S.watermark = null; refresh(); }
  else { removeItem(p, +b.dataset.i); S.selItem = -1; drawItems(); drawTextLayer(); }
  msg('Modification supprimée (Ctrl+Z pour la rétablir).');
});
function clearPageMods(p) { p.items = []; p.edited = []; p.crop = null; }
$('#modClearPage').onclick = () => {
  const p = curPage(); if (!p) return; if (!can('edit')) return denied('edit');
  if (!confirm('Supprimer toutes les modifications et tous les ajouts de cette page (textes, cadres, images, surlignages, commentaires, rognage) ?\nLe texte d\'origine est rétabli. Ctrl+Z pour annuler.')) return;
  snapshot(); clearPageMods(p); S.selItem = -1; refresh(); msg('Page rétablie dans son état d\'origine.');
};
$('#modClearDoc').onclick = () => {
  if (!S.pages.length) return; if (!can('edit')) return denied('edit');
  if (!confirm('Supprimer toutes les modifications et tous les ajouts de TOUT le document (y compris le filigrane) ?\nCtrl+Z pour annuler.')) return;
  snapshot(); S.pages.forEach(clearPageMods); S.watermark = null; S.selItem = -1; refresh(); msg('Document rétabli dans son état d\'origine.');
};
window.afterItems = renderModList;

// ================================================================ 4. Commentaires : lecture dans le logiciel, enregistrement en lecture seule
const RO_KEY = 'SknEDUReadOnly';
window.isReadOnlyPdf = async (bytes) => {
  try {
    const d = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const v = d.getInfoDict().get(PDFLib.PDFName.of(RO_KEY)); return !!v && String(v) === 'true';
  } catch { return false; }
};
/** Commentaires déjà présents dans le PDF (tous lecteurs) : affichés en lecture, avec auteur et date. */
async function drawExistingComments(pg) {
  let layer = $('#annotLayer');
  if (!layer) { layer = document.createElement('div'); layer.id = 'annotLayer'; $('#pageBox').appendChild(layer); }
  layer.innerHTML = '';
  let annots = []; try { annots = await pg.getAnnotations({ intent: 'display' }); } catch { return; }
  for (const a of annots) {
    const text = (a.contentsObj && a.contentsObj.str) || a.contents || '';
    if (['Widget', 'Link', 'Popup'].includes(a.subtype) || !text.trim()) continue;
    const [x, y] = S.vp.convertToViewportPoint(a.rect[0], a.rect[3]);
    const who = (a.titleObj && a.titleObj.str) || a.title || '';
    const m = document.createElement('button'); m.className = 'annMark'; m.textContent = '💬'; m.style.left = x + 'px'; m.style.top = y + 'px';
    m.title = (who ? who + ' : ' : '') + text; m.setAttribute('aria-label', 'Commentaire : ' + text);
    m.onclick = (e) => { e.stopPropagation(); modal('💬 Commentaire', `${who ? `<p class="muted">${esc(who)}${a.modificationDate ? ' — ' + esc(String(a.modificationDate).replace(/^D:(\d{4})(\d\d)(\d\d).*/, '$3/$2/$1')) : ''}</p>` : ''}<p style="white-space:pre-wrap">${esc(text)}</p>${S.readOnly ? '<p class="muted">🔒 Document en lecture seule : ce commentaire ne peut pas être modifié.</p>' : ''}`, [['Fermer', null, true]]); };
    layer.appendChild(m);
  }
}
let lastRo = null;
function syncReadOnly() {
  $('#roTag').hidden = !S.readOnly;
  if (lastRo !== S.readOnly) { lastRo = S.readOnly; applyPolicy(); if (S.readOnly) { if (typeof setTool === 'function') setTool('select'); msg('🔒 Document en lecture seule : commentaires et contenu verrouillés (lecture, impression et export possibles).'); } }
}
async function saveCommentedReadOnly() {
  if (!S.pages.length) return; if (!can('save')) return denied('save');
  const n = S.pages.reduce((s, p) => s + p.items.filter((o) => o.type === 'note').length, 0);
  const ok = await modal('🔒 Enregistrer avec les commentaires, en lecture seule', `<p>Le document est enregistré <b>avec ses ${n} commentaire(s)</b>, visibles dans SknEDU-studio, Adobe Acrobat Reader, Edge, Chrome, Foxit…</p>
    <ul><li>Les commentaires sont <b>verrouillés</b> : ils se lisent mais ne se modifient pas et ne se suppriment pas.</li>
    <li>Le contenu est protégé contre la modification ; la lecture, l'impression et la copie du texte restent possibles.</li>
    <li>Votre document de travail reste modifiable : seule la copie enregistrée est en lecture seule.</li></ul>`, [['Annuler', null], ['Enregistrer', true, true]]);
  if (!ok) return;
  busy('Enregistrement en lecture seule…');
  try {
    const bytes = await readOnlyBytes(); done();
    const p = await window.api.save({ bytes, defaultName: `${baseName()} (lecture seule).pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }], filePath: null });
    if (p) msg(`🔒 Enregistré en lecture seule avec ${n} commentaire(s) : ${p}`);
    return p;
  } catch (e) { done(); alert('Enregistrement impossible : ' + errMsg(e)); return null; }
}
/** Copie verrouillée : commentaires « verrouillés », marqueur de lecture seule, modification et annotation interdites. */
async function readOnlyBytes() {
  {
    const d = await PDFLib.PDFDocument.load(await buildPdf(), { updateMetadata: false });
    const N = (s) => PDFLib.PDFName.of(s);
    for (const pg of d.getPages()) {
      const annots = pg.node.Annots(); if (!annots) continue;
      for (let i = 0; i < annots.size(); i++) {
        const a = annots.lookup(i, PDFLib.PDFDict); if (!a) continue;
        const st = a.get(N('Subtype')); if (st && String(st) === '/Widget') continue;
        const f = a.get(N('F')); const fv = f && f.asNumber ? f.asNumber() : 0;
        a.set(N('F'), PDFLib.PDFNumber.of(fv | 4 | 128 | 512)); // imprimable, verrouillé, contenu verrouillé
      }
    }
    d.getInfoDict().set(N(RO_KEY), PDFLib.PDFBool.True);
    const owner = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
    return window.api.encryptPdf(await d.save(), { userPassword: (S.protect && S.protect.userPassword) || '', ownerPassword: owner,
      permissions: { print: true, copy: true, modify: false, annotate: false } });
  }
}

// ================================================================ 5. Format d'origine (Word, Excel, PowerPoint, OpenDocument, texte, image)
const ORIGIN_FMT = { docx: 'docx', doc: 'doc', odt: 'odt', rtf: 'rtf', html: 'html', htm: 'html', xlsx: 'xlsx', xls: 'xls', ods: 'ods', csv: 'csv',
  pptx: 'pptx', ppt: 'ppt', odp: 'odp', txt: 'txt', png: 'img', jpg: 'img', jpeg: 'img', bmp: 'img', webp: 'img', gif: 'img', tif: 'img', tiff: 'img', heic: 'img' };
async function exportOrigin() {
  const o = S.origin;
  if (!S.pages.length) return;
  if (!o) return alert('Ce document a été ouvert en PDF : enregistrez-le (Ctrl+S) ou utilisez « PDF → autres formats » pour l\'exporter.');
  if (!can('convert')) return denied('convert');
  const k = ORIGIN_FMT[o.ext];
  if (!k) return alert(`Le format .${o.ext} ne peut pas être recréé à l'identique : enregistrez en PDF ou exportez vers Word, Excel ou PowerPoint.`);
  if (k === 'txt') {
    let out = ''; for (const p of S.pages) out += (await pageParagraphs(p)).map((l) => l.text).join('\n') + '\n\n';
    const r = await window.api.save({ bytes: new TextEncoder().encode(out.trimEnd() + '\n'), defaultName: o.name, filters: [{ name: 'Texte', extensions: ['txt'] }] });
    if (r) { setDirty(false); msg(`Enregistré au format d'origine : ${r}`); }
    return;
  }
  if (k === 'img') {
    if (S.pages.length > 1) return toImages();
    busy('Création de l\'image…');
    const doc = await pdfjsLib.getDocument({ data: await buildPdf(), isEvalSupported: false }).promise; const pg = await doc.getPage(1); const vp = pg.getViewport({ scale: 2 });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    const jpg = /jpe?g|heic/.test(o.ext); const ext = jpg ? 'jpg' : 'png';
    const blob = await new Promise((r) => c.toBlob(r, jpg ? 'image/jpeg' : 'image/png', 0.92)); done();
    const r = await window.api.save({ bytes: new Uint8Array(await blob.arrayBuffer()), defaultName: o.name.replace(/\.[^.]+$/, '.' + ext), filters: [{ name: 'Image', extensions: [ext] }] });
    if (r) { setDirty(false); msg(`Enregistré au format d'origine : ${r}`); }
    return;
  }
  await toOffice(k, o.path || o.name);
}
window.saveOriginDialog = async () => {
  const o = S.origin; if (!o || !ORIGIN_FMT[o.ext]) return false;
  const r = await modal('Enregistrer', `<p>Ce document a été ouvert depuis <b>${esc(o.name)}</b>.</p><p>Dans quel format l'enregistrer ?</p>`,
    [['Annuler', 'cancel'], ['En PDF', 'pdf'], [`Au format d'origine (.${o.ext})`, 'orig', true]]);
  if (r === 'pdf') return false;
  if (r === 'orig') await exportOrigin();
  return true;
};

// ================================================================ 6. Cloud : connexion et sauvegarde automatique
let CA = { on: false, path: null, name: '', every: 2 };
try { CA = Object.assign(CA, JSON.parse(lsGet('edupdf.cloudauto', '{}'))); } catch { /* réglage illisible */ }
const caHashes = new Map(); let caLast = 0; let caBusy = false;
const saveCA = () => lsSet('edupdf.cloudauto', JSON.stringify(CA));
function cloudTag(text, title) { const t = $('#cloudTag'); t.hidden = !CA.on; t.textContent = text; t.title = title || ''; }
async function cloudAutoTick(force) {
  if (!CA.on || !CA.path || !S.pages.length || caBusy || !can('cloud')) return;
  if (!force && Date.now() - caLast < CA.every * 60000) return;
  const ae = document.activeElement;
  if (!$('#busy').hidden || (ae && ae.isContentEditable) || (typeof SHOW !== 'undefined' && SHOW.on)) return;
  const h = hashStr(stateJson() + S.fileName + (S.watermark ? JSON.stringify(S.watermark) : ''));
  if (caHashes.get(S.fileName) === h) return;
  caBusy = true;
  try {
    let bytes = await buildPdf(); if (S.protect) bytes = await window.api.encryptPdf(bytes, S.protect);
    const p = await window.api.cloudAutosave(CA.path, bytes, S.fileName);
    caHashes.set(S.fileName, h); caLast = Date.now();
    cloudTag(`☁ ${CA.name} ✓ ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`, `Sauvegarde automatique : ${p}\nLa synchronisation l'envoie dans votre cloud.`);
  } catch (e) { cloudTag(`☁ ${CA.name} ⚠`, 'Sauvegarde automatique impossible : ' + errMsg(e)); } finally { caBusy = false; }
}
setInterval(() => cloudAutoTick(false), 20000);
const CLOUD_WEB = { onedrive: ['OneDrive', 'https://onedrive.live.com/'], gdrive: ['Google Drive', 'https://drive.google.com/'], dropbox: ['Dropbox', 'https://www.dropbox.com/home'], icloud: ['iCloud Drive', 'https://www.icloud.com/iclouddrive/'] };
async function cloudAutoDialog() {
  if (!can('cloud')) return denied('cloud');
  const { clouds, install } = await window.api.cloudList();
  const missing = Object.entries(install).filter(([id]) => !clouds.some((c) => c.id.startsWith(id)));
  const rows = clouds.map((c, i) => `<label class="ck"><input type="radio" name="caT" value="${i}" ${c.path === CA.path ? 'checked' : ''}> ✅ <b>${esc(c.name)}</b> <span class="muted">connecté — ${esc(c.path)}</span></label>`).join('');
  const html = `<p>Vos documents sont <b>enregistrés automatiquement</b> dans votre cloud pendant que vous travaillez (dossier « SknEDU-studio › Sauvegardes automatiques »), uniquement quand ils ont changé.</p>
    ${clouds.length ? `<p><b>Comptes connectés sur ce PC :</b></p>${rows}` : '<p><b>Aucun compte cloud n\'est encore connecté sur ce PC.</b></p>'}
    ${missing.length ? `<p><b>Se connecter à un autre compte :</b> ${missing.map(([id, v]) => `<button class="small" data-inst="${id}">🔑 ${esc(v.name)}</button>`).join(' ')}</p>` : ''}
    <p class="muted">La connexion se fait dans l'application officielle du service (OneDrive, Google Drive pour ordinateur, Dropbox) : votre mot de passe n'est jamais saisi dans SknEDU-studio. Une fois connecté, le compte apparaît ici automatiquement.</p>
    <p>Voir mes fichiers en ligne : ${Object.values(CLOUD_WEB).map(([n, u]) => `<button class="small" data-web="${esc(u)}">🌐 ${n}</button>`).join(' ')}</p>
    <label class="row">Fréquence <select id="caEvery">${[1, 2, 5, 10, 15].map((m) => `<option value="${m}" ${m === CA.every ? 'selected' : ''}>toutes les ${m} min</option>`).join('')}</select></label>
    <label class="ck"><input type="checkbox" id="caOn" ${CA.on ? 'checked' : ''}> Activer la sauvegarde automatique</label>`;
  const pr = modal('☁ Sauvegarde automatique dans le cloud', html, [['Annuler', null], ['Enregistrer', () => ({ t: (document.querySelector('input[name=caT]:checked') || {}).value, on: $('#caOn').checked, every: +$('#caEvery').value }), true]]);
  $$('#mBody [data-web]').forEach((b) => { b.onclick = () => window.api.openExternal(b.dataset.web); });
  $$('#mBody [data-inst]').forEach((b) => { b.onclick = async () => {
    const it = install[b.dataset.inst]; $('#mBtns button').click();
    if (!confirm(`Installer ${it.name} (catalogue officiel Microsoft) puis vous y connecter avec votre compte ?`)) return;
    busy(`Installation de ${it.name}…`); const r = await window.api.cloudInstall(b.dataset.inst); done();
    if (r.ok) alert(`${it.name} est installé : ouvrez-le et connectez-vous à votre compte. Revenez ensuite dans « Sauvegarde automatique » : le compte sera proposé.`);
    else if (confirm(`Installation automatique impossible.\n${r.log}\n\nOuvrir la page officielle de téléchargement ?`)) window.api.openExternal(it.web);
  }; });
  const r = await pr; if (!r) return;
  if (r.on && r.t === undefined) return alert('Choisissez d\'abord un compte cloud connecté (ou connectez-en un).');
  const c = r.t !== undefined ? clouds[+r.t] : null;
  CA = { on: !!r.on && !!c, path: c ? c.path : CA.path, name: c ? c.name : CA.name, every: r.every || 2 }; saveCA(); caHashes.clear();
  cloudTag(CA.on ? `☁ ${CA.name}` : '', CA.on ? 'Sauvegarde automatique activée' : '');
  msg(CA.on ? `☁ Sauvegarde automatique activée dans ${CA.name} (toutes les ${CA.every} min si le document a changé).` : 'Sauvegarde automatique désactivée.');
  if (CA.on) cloudAutoTick(true);
}
if (CA.on) cloudTag(`☁ ${CA.name}`, 'Sauvegarde automatique activée');

// ================================================================ Crochets et actions
window.afterRender = (pg) => { syncViewControls(); syncReadOnly(); drawExistingComments(pg); renderModList(); };
window.afterDocSwitch = () => { syncReadOnly(); };
Object.assign(actions, { cloudAuto: cloudAutoDialog, exportOrigin, commentLocked: saveCommentedReadOnly, sidebars: () => $('#sbMode').click() });
Object.assign(FEATURE_OF.act, { cloudAuto: 'cloud', exportOrigin: 'convert', commentLocked: 'save' });
syncViewControls(); renderModList();
window.__studio = { SB, cloudAutoTick, exportOrigin, saveCommentedReadOnly, readOnlyBytes, renderModList,
  setCloudAuto: (path, name) => { CA = { on: true, path, name, every: 2 }; caHashes.clear(); caLast = 0; } };
