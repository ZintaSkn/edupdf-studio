// SknEDU-studio — réglages et outils indispensables de l'enseignant :
// préférences, récupération après coupure, tampons de correction, en-tête / pied de page, options d'impression.
/* global S, $, $$, actions, FEATURE_OF, msg, busy, done, modal, esc, errMsg, can, denied, snapshot, setDirty, drawItems, refresh,
   curPage, buildPdf, getPdfPage, measureText, viewToPdfRect, putImg, hashStr, stateJson, setTool, handleLoaded, newTab, DOCS, curDoc,
   closeTab, loadImg, dataUrlToBytes, FONT_FAMILIES */

// ================================================================ 1. Préférences
const PREF_DEFAULT = { teacher: '', school: '', className: '', font: 'Arial', size: 14, recoveryMin: 1 };
window.PREFS = Object.assign({}, PREF_DEFAULT);
try { Object.assign(window.PREFS, JSON.parse(localStorage.getItem('edupdf.prefs') || '{}')); } catch { /* réglages illisibles */ }
const savePrefs = () => { try { localStorage.setItem('edupdf.prefs', JSON.stringify(PREFS)); } catch { /* */ } };
function applyPrefs() {
  if (FONT_FAMILIES[PREFS.font]) $('#fontFam').value = PREFS.font;
  $('#size').value = PREFS.size || 14;
}
async function prefsDialog() {
  let upd = true; try { upd = await window.api.updatePref(); } catch { /* */ }
  const fonts = Object.keys(FONT_FAMILIES).map((f) => `<option ${f === PREFS.font ? 'selected' : ''}>${esc(f)}</option>`).join('');
  const r = await modal('⚙ Préférences', `
    <label class="row">Nom de l'enseignant <input id="pfT" value="${esc(PREFS.teacher)}" placeholder="ex. Mme Kouassi" autocomplete="name"></label>
    <p class="muted">Signe vos commentaires (visible dans tous les lecteurs PDF) et remplit {enseignant} des en-têtes.</p>
    <label class="row">Établissement <input id="pfS" value="${esc(PREFS.school)}" placeholder="ex. Lycée moderne de Cocody"></label>
    <label class="row">Classe habituelle <input id="pfC" value="${esc(PREFS.className)}" placeholder="ex. 3e B"></label>
    <label class="row">Police du texte ajouté <select id="pfF">${fonts}</select></label>
    <label class="row">Taille du texte ajouté <input id="pfZ" type="number" min="6" max="72" value="${PREFS.size || 14}"></label>
    <label class="row">Copie de récupération <select id="pfR">${[[1, 'chaque minute'], [2, 'toutes les 2 min'], [5, 'toutes les 5 min'], [0, 'désactivée (déconseillé)']].map(([v, l]) => `<option value="${v}" ${+PREFS.recoveryMin === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <p class="muted">En cas de coupure de courant ou de fermeture imprévue, vos documents non enregistrés sont proposés au redémarrage.</p>
    <label class="ck"><input type="checkbox" id="pfU" ${upd ? 'checked' : ''}> Rechercher les mises à jour automatiquement (connexion à github.com)</label>
    <p class="muted">SknEDU-studio n'envoie aucune donnée personnelle ni statistique d'utilisation. Voir PRIVACY.md.</p>`,
  [['Annuler', null], ['Enregistrer', () => ({ teacher: $('#pfT').value.trim(), school: $('#pfS').value.trim(), className: $('#pfC').value.trim(), font: $('#pfF').value, size: Math.max(6, Math.min(72, +$('#pfZ').value || 14)), recoveryMin: +$('#pfR').value, upd: $('#pfU').checked }), true]]);
  if (!r) return;
  try { await window.api.updatePref(!!r.upd); } catch { /* */ } delete r.upd;
  Object.assign(PREFS, r); savePrefs(); applyPrefs(); msg('Préférences enregistrées.');
}

// ================================================================ 2. Récupération après coupure ou plantage
const newRid = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const recHash = new Map(); let recBusy = false; let recLast = 0; let lastInput = 0;
['keydown', 'pointerdown', 'wheel'].forEach((ev) => window.addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true }));
async function recoveryTick(force) {
  const base = +PREFS.recoveryMin; if (!base || recBusy || !S.pages.length || !S.dirty) return;
  const mb = docMegabytes(); const every = Math.max(base, mb > 100 ? 10 : mb > 20 ? 5 : base); // fichiers lourds : moins souvent
  if (!force && (Date.now() - recLast < every * 60000 - 500 || Date.now() - lastInput < 3000)) return; // jamais pendant la frappe
  const ae = document.activeElement; if (!$('#busy').hidden || (ae && ae.isContentEditable)) return;
  if (!S.rid) S.rid = newRid();
  const h = hashStr(stateJson() + S.fileName); if (!force && recHash.get(S.rid) === h) return;
  recBusy = true;
  try { await window.api.recoverySave(S.rid, S.fileName, await buildPdf()); recHash.set(S.rid, h); recLast = Date.now(); }
  catch { /* nouvel essai au prochain passage */ } finally { recBusy = false; }
}
setInterval(() => recoveryTick(false), 15000);
// enregistré ou abandonné : la copie de récupération n'est plus utile
const _setDirty = setDirty;
setDirty = (v) => { _setDirty(v); if (!v && S.rid) { window.api.recoveryClear(S.rid); recHash.delete(S.rid); } }; // eslint-disable-line no-global-assign
const _closeTab = closeTab;
closeTab = (i) => { // eslint-disable-line no-global-assign
  const rid = i === curDoc ? S.rid : (DOCS[i] && DOCS[i].rid); _closeTab(i);
  if (rid && S.rid !== rid && !DOCS.some((d) => d.rid === rid)) window.api.recoveryClear(rid);
};
async function offerRecovery() {
  let list = []; try { list = await window.api.recoveryList(); } catch { return; }
  if (!list.length) return;
  const rows = list.map((d) => `<li><b>${esc(d.name)}</b> <span class="muted">— ${new Date(d.date).toLocaleString('fr-FR')}</span></li>`).join('');
  const r = await modal('🛟 Documents récupérés', `<p>SknEDU-studio s'est fermé sans que ces documents soient enregistrés (coupure de courant, fermeture imprévue) :</p><ul>${rows}</ul>
    <p class="muted">Ils s'ouvrent dans de nouveaux onglets, avec toutes vos modifications. Pensez à les enregistrer.</p>`, [['Supprimer ces copies', 'drop'], ['Plus tard', null], ['Récupérer', 'open', true]]);
  if (r === 'drop') { for (const d of list) await window.api.recoveryClear(d.id); return msg('Copies de récupération supprimées.'); }
  if (r !== 'open') return;
  let n = 0;
  for (const d of list) {
    try {
      const f = await window.api.recoveryLoad(d.id); if (S.pages.length) newTab();
      await handleLoaded([f], 0); S.fileName = d.name; S.rid = newRid(); setDirty(true); await window.api.recoveryClear(d.id); n++;
    } catch (e) { alert(`Récupération impossible de « ${d.name} » : ${errMsg(e)}`); }
  }
  refresh(); if (n) msg(`${n} document(s) récupéré(s) : enregistrez-les (Ctrl+S).`);
}

// ================================================================ 3. Tampons de correction
const STAMPS = [
  ['✔', 'Juste', '#1e8e3e'], ['✘', 'Faux', '#d93025'], ['Vu', '', '#1a56c4'], ['Très bien', '', '#1e8e3e'], ['Bien', '', '#1e8e3e'],
  ['Assez bien', '', '#b26a00'], ['À revoir', '', '#d93025'], ['Insuffisant', '', '#d93025'], ['Bravo !', '', '#1e8e3e'],
  ['⭐', 'Étoile', '#f2a900'], ['😊', 'Content', '#f2a900'], ['Absent', '', '#5f6368'], ['Copie non rendue', '', '#5f6368'], ['?', 'Imprécis', '#b26a00']
];
let STAMP = { text: '✔', color: '#1e8e3e' };
const SYMBOL = (t) => /^[✀-➿⭐\u{1F300}-\u{1FAFF}?]+$/u.test(t);
async function stampImage(text, color) {
  const sym = SYMBOL(text); const H = 160; const font = `bold ${sym ? 128 : 76}px "Segoe UI", "Segoe UI Emoji", "Segoe UI Symbol", Arial, sans-serif`;
  const m = document.createElement('canvas').getContext('2d'); m.font = font; const tw = m.measureText(text).width;
  const W = Math.ceil(sym ? Math.max(H, tw + 20) : tw + 64);
  const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d');
  ctx.font = font; ctx.fillStyle = color; ctx.strokeStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (!sym) { ctx.lineWidth = 9; const r = 26; ctx.beginPath(); ctx.roundRect(6, 6, W - 12, H - 12, r); ctx.stroke(); }
  ctx.fillText(text, W / 2, H / 2 + (sym ? 6 : 4));
  return { url: c.toDataURL('image/png'), ratio: W / H };
}
window.placeStamp = async (pos) => {
  const p = curPage(); if (!p) return;
  const { url, ratio } = await stampImage(STAMP.text, STAMP.color);
  const h = (SYMBOL(STAMP.text) ? 26 : 22) * S.scale; const w = h * ratio;
  snapshot(); p.items.push({ type: 'image', rect: viewToPdfRect(S.vp, pos[0] - w / 2, pos[1] - h / 2, w, h), ref: putImg(url), stamp: STAMP.text });
  S.selItem = p.items.length - 1; drawItems(); msg(`Tampon « ${STAMP.text} » posé — cliquez ailleurs pour en poser un autre, Échap pour arrêter.`);
};
async function stampsDialog() {
  if (!can('edit')) return denied('edit');
  const html = `<div class="stampgrid">${STAMPS.map(([t, l, c], i) => `<button class="stampbtn" data-i="${i}" style="color:${c};border-color:${c}" title="${esc(l || t)}">${esc(t)}</button>`).join('')}</div>
    <label class="row">Tampon personnalisé <input id="stC" placeholder="ex. Revoir la leçon 3" maxlength="40"></label>
    <label class="row">Couleur <input type="color" id="stCol" value="#d93025"></label>
    <p class="muted">Choisissez un tampon puis cliquez sur la copie autant de fois que nécessaire. Chaque tampon se déplace, se redimensionne et se supprime comme une image.</p>`;
  let pick = null;
  const pr = modal('🔖 Tampons de correction', html, [['Annuler', null], ['Utiliser le tampon personnalisé', () => ($('#stC').value.trim() ? { text: $('#stC').value.trim(), color: $('#stCol').value } : null), true]]);
  $$('#mBody .stampbtn').forEach((b) => { b.onclick = () => { const [t, , c] = STAMPS[+b.dataset.i]; pick = { text: t, color: c }; $('#mBtns button').click(); }; });
  const r = (await pr) || pick; if (!r) return;
  STAMP = r; setTool('stamp'); msg(`Tampon « ${r.text} » : cliquez sur la page pour le poser.`);
}

// ================================================================ 3 bis. Attribution de note
const APPRECIATIONS = ['', 'Excellent', 'Très bien', 'Bien', 'Assez bien', 'Passable', 'Insuffisant', 'Peut mieux faire', 'Félicitations'];
async function markImage(note, sur, appr) {
  const ratio = sur > 0 ? note / sur : 0; const color = ratio >= 0.5 ? '#1e8e3e' : '#d93025';
  const score = `${String(note).replace('.', ',')}/${sur}`; const H = appr ? 230 : 170;
  const m = document.createElement('canvas').getContext('2d'); m.font = 'bold 34px "Segoe UI", Arial'; const aw = appr ? m.measureText(appr).width : 0;
  const W = Math.ceil(Math.max(170, aw + 40)); const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d');
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 7; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.beginPath(); ctx.ellipse(W / 2, 82, 80, 74, -0.08, 0, 2 * Math.PI); ctx.stroke();
  ctx.font = `bold ${score.length > 6 ? 44 : 54}px "Segoe UI", Arial`; ctx.fillText(score, W / 2, 86);
  if (appr) { ctx.font = 'bold 34px "Segoe UI", Arial'; ctx.fillText(appr, W / 2, 200); }
  return { url: c.toDataURL('image/png'), ratio: W / H, score };
}
/** Clic sur la copie : la note (et une appréciation) s'inscrit, entourée, en vert si ≥ la moyenne, sinon en rouge. */
window.placeMark = async (pos) => {
  const p = curPage(); if (!p) return;
  let last = { sur: 20 }; try { last = { ...last, ...JSON.parse(localStorage.getItem('edupdf.note') || '{}') }; } catch { /* */ }
  const r = await modal('📝 Attribuer une note', `<div class="row"><label>Note <input type="text" id="mkNote" inputmode="decimal" style="width:80px" placeholder="15,5"></label>
    <label>sur <input type="number" id="mkSur" min="1" max="1000" value="${last.sur}" style="width:70px"></label></div>
    <label class="row">Appréciation <select id="mkAppr">${APPRECIATIONS.map((x) => `<option ${x === (last.appr || '') ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
    <label class="row">ou appréciation libre <input id="mkLibre" maxlength="40" placeholder="ex. Revoir les fractions"></label><p class="err" id="mkErr"></p>`,
  [['Annuler', null], ['Inscrire la note', () => {
    const note = Number($('#mkNote').value.replace(',', '.')); const sur = Number($('#mkSur').value);
    if (!(sur > 0) || !Number.isFinite(note) || note < 0 || note > sur) { $('#mkErr').textContent = `Indiquez une note entre 0 et ${sur || '…'}.`; return false; }
    return { note: Math.round(note * 100) / 100, sur, appr: $('#mkLibre').value.trim() || $('#mkAppr').value };
  }, true]]);
  if (!r) return;
  try { localStorage.setItem('edupdf.note', JSON.stringify({ sur: r.sur, appr: r.appr && APPRECIATIONS.includes(r.appr) ? r.appr : '' })); } catch { /* */ }
  const im = await markImage(r.note, r.sur, r.appr); const h = (r.appr ? 46 : 36) * S.scale; const w = h * im.ratio;
  snapshot(); p.items.push({ type: 'image', rect: viewToPdfRect(S.vp, pos[0] - w / 2, pos[1] - h / 2, w, h), ref: putImg(im.url), stamp: 'note', mark: { note: r.note, sur: r.sur, appr: r.appr } });
  S.selItem = p.items.length - 1; drawItems(); msg(`Note ${im.score} inscrite${r.appr ? ' — ' + r.appr : ''}. Cliquez sur une autre copie pour noter, ou sur l'outil pour l'arrêter.`);
};
/** Relevé des notes du document (page par page), copiable dans un tableur. */
async function marksSummary() {
  const rows = []; S.pages.forEach((p, i) => pageMarks(p).forEach((m) => rows.push([i + 1, m.note, m.sur, m.appr || ''])));
  if (!rows.length) return alert('Aucune note inscrite dans ce document : outil « Noter », puis cliquez sur la copie.');
  const moy = rows.reduce((s, r) => s + (r[1] / r[2]) * 20, 0) / rows.length;
  const tsv = 'Page\tNote\tSur\tAppréciation\n' + rows.map((r) => r.join('\t')).join('\n');
  const r = await modal('📋 Relevé des notes', `<p>${rows.length} note(s) — moyenne sur 20 : <b>${moy.toFixed(2).replace('.', ',')}</b></p>
    <table class="grtable"><tr><th>Page</th><th>Note</th><th>Appréciation</th></tr>${rows.map((x) => `<tr><td>${x[0]}</td><td>${String(x[1]).replace('.', ',')}/${x[2]}</td><td>${esc(x[3])}</td></tr>`).join('')}</table>`,
  [['Fermer', null], ['Copier pour un tableur', 'copy', true]]);
  if (r === 'copy') { await navigator.clipboard.writeText(tsv); msg('Relevé copié : collez-le dans Excel ou Google Sheets.'); }
}

// ================================================================ 4. En-tête et pied de page
let HF = null;
try { HF = JSON.parse(localStorage.getItem('edupdf.hf') || 'null'); } catch { HF = null; }
async function headerFooterDialog() {
  if (!S.pages.length) return; if (!can('pages')) return denied('pages');
  const d = HF || { hl: '{établissement}', hc: '', hr: '{classe} — {date}', fl: '{enseignant}', fc: '', fr: 'Page {page} / {pages}', size: 9, color: '#444444' };
  const inp = (id, ph) => `<input id="hf_${id}" value="${esc(d[id] || '')}" placeholder="${ph}">`;
  const r = await modal('🔖 En-tête et pied de page', `<p class="muted">Variables : {établissement}, {enseignant}, {classe}, {date}, {page}, {pages}, {fichier}</p>
    <div class="hfgrid"><b></b><b>Gauche</b><b>Centre</b><b>Droite</b>
      <b>En-tête</b>${inp('hl', '')}${inp('hc', '')}${inp('hr', '')}
      <b>Pied</b>${inp('fl', '')}${inp('fc', '')}${inp('fr', '')}</div>
    <label class="row">Taille <input type="number" id="hf_size" min="6" max="24" value="${d.size || 9}"></label>
    <label class="row">Couleur <input type="color" id="hf_color" value="${d.color || '#444444'}"></label>
    <label class="row">Classe pour ce document <input id="hf_cls" value="${esc(d.cls || PREFS.className || '')}"></label>`,
  [['Retirer', 'remove'], ['Annuler', null], ['Appliquer à toutes les pages', () => Object.fromEntries(['hl', 'hc', 'hr', 'fl', 'fc', 'fr', 'size', 'color', 'cls'].map((k) => [k, $('#hf_' + k).value])), true]]);
  if (!r) return;
  snapshot();
  for (const p of S.pages) p.items = p.items.filter((o) => o.tag !== 'hf');
  if (r === 'remove') { refresh(); return msg('En-têtes et pieds de page retirés.'); }
  HF = r; try { localStorage.setItem('edupdf.hf', JSON.stringify(r)); } catch { /* */ }
  await applyHeaderFooter(r); refresh(); msg('En-tête et pied de page ajoutés à toutes les pages (Modifications de la page › ✖ pour en retirer un).');
}
async function applyHeaderFooter(r) {
  const size = Math.max(6, Math.min(24, +r.size || 9)); const font = { family: 'Arial' }; const n = S.pages.length;
  const date = new Date().toLocaleDateString('fr-FR');
  const fill = (t, i) => String(t || '').replace(/\{établissement\}|\{etablissement\}/gi, PREFS.school || '').replace(/\{enseignant\}/gi, PREFS.teacher || '')
    .replace(/\{classe\}/gi, r.cls || '').replace(/\{date\}/gi, date).replace(/\{page\}/gi, i + 1).replace(/\{pages\}/gi, n).replace(/\{fichier\}/gi, S.fileName.replace(/\.pdf$/i, ''))
    .replace(/^\s*—\s*|\s*—\s*$/g, '').trim();
  for (let i = 0; i < n; i++) {
    const p = S.pages[i]; const pg = await getPdfPage(p); const R = (pg.rotate + p.rot + 360) % 360; const vp = pg.getViewport({ scale: 1, rotation: R });
    const M = 34; const rows = [[r.hl, r.hc, r.hr, 16], [r.fl, r.fc, r.fr, vp.height - 16 - size]];
    for (const [l, c, rt, y] of rows) {
      for (const [t, al] of [[l, 'l'], [c, 'c'], [rt, 'r']]) {
        const txt = fill(t, i); if (!txt) continue;
        const w = await measureText(txt, font, size);
        const x = al === 'l' ? M : al === 'c' ? (vp.width - w) / 2 : vp.width - M - w;
        p.items.push({ type: 'text', tag: 'hf', at: vp.convertToPdfPoint(x, y), size, color: r.color || '#444444', font, text: txt });
      }
    }
  }
  setDirty(true);
}

// ================================================================ 5. Impression : pages, pages par feuille, orientation
function parseRange(s, max) {
  const out = [];
  for (const part of String(s).split(/[,;]\s*/)) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part); if (!m) continue;
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= max && !out.includes(i)) out.push(i);
  }
  return out;
}
window.printOptions = async () => {
  const n = S.pages.length;
  const r = await modal('🖨 Imprimer', `<p><b>Pages</b></p>
    <label class="ck"><input type="radio" name="prP" value="all" checked> Toutes (${n})</label>
    <label class="ck"><input type="radio" name="prP" value="cur"> Page courante (${S.cur + 1})</label>
    <label class="ck"><input type="radio" name="prP" value="range"> Pages : <input id="prR" placeholder="ex. 1-3, 5" style="width:120px"></label>
    <p><b>Pages par feuille</b> (économie de papier)</p>
    <label class="ck"><input type="radio" name="prS" value="1" checked> 1</label>
    <label class="ck"><input type="radio" name="prS" value="2"> 2 (format A5, feuille à l'italienne)</label>
    <label class="ck"><input type="radio" name="prS" value="4"> 4</label>
    <p class="muted">Copies, recto verso et choix de l'imprimante : dans la fenêtre d'impression qui suit.</p>`,
  [['Annuler', null], ['Continuer', () => ({ p: document.querySelector('input[name=prP]:checked').value, r: $('#prR').value, s: +document.querySelector('input[name=prS]:checked').value }), true]]);
  if (!r) return null;
  const pages = r.p === 'cur' ? [S.cur + 1] : r.p === 'range' ? parseRange(r.r, n) : null;
  if (pages && !pages.length) { alert('Indiquez des pages valides, par exemple 1-3, 5.'); return null; }
  return { pages, perSheet: r.s };
};
async function imgOf(pg) { const u = URL.createObjectURL(new Blob([pg.bytes], { type: 'image/jpeg' })); try { return await loadImg(u); } finally { URL.revokeObjectURL(u); } }
window.composePrint = async (pages, perSheet) => {
  if (!pages.length) return pages;
  const toJpeg = (c) => ({ bytes: dataUrlToBytes(c.toDataURL('image/jpeg', 0.92)), w: c.width, h: c.height });
  if (perSheet === 2 || perSheet === 4) {
    const base = Math.max(...pages.map((p) => Math.max(p.w, p.h))); const A = Math.SQRT2;
    const land = perSheet === 2; const W = Math.round(land ? base * A / 1.2 : base / 1.2 * 1), H = Math.round(land ? base / 1.2 : base / 1.2 * A);
    const cols = 2, rows = perSheet === 2 ? 1 : 2; const out = [];
    for (let s = 0; s < pages.length; s += perSheet) {
      const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      const cw = W / cols, ch = H / rows; const pad = Math.round(Math.min(cw, ch) * 0.03);
      for (let k = 0; k < perSheet && s + k < pages.length; k++) {
        const im = await imgOf(pages[s + k]); const cx = (k % cols) * cw, cy = Math.floor(k / cols) * ch;
        const z = Math.min((cw - 2 * pad) / im.width, (ch - 2 * pad) / im.height); const w = im.width * z, h = im.height * z;
        ctx.drawImage(im, cx + (cw - w) / 2, cy + (ch - h) / 2, w, h);
        ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1; ctx.strokeRect(cx + (cw - w) / 2, cy + (ch - h) / 2, w, h);
      }
      out.push(toJpeg(c));
    }
    return out;
  }
  // 1 page par feuille : toutes les pages dans l'orientation de la première (les autres sont tournées d'un quart de tour)
  const land = pages[0].w > pages[0].h; const out = [];
  for (const pg of pages) {
    if ((pg.w > pg.h) === land) { out.push(pg); continue; }
    const im = await imgOf(pg); const c = document.createElement('canvas'); c.width = im.height; c.height = im.width; const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2); ctx.rotate(-Math.PI / 2); ctx.drawImage(im, -im.width / 2, -im.height / 2); out.push(toJpeg(c));
  }
  return out;
};

// ================================================================ Actions, raccourcis, démarrage
Object.assign(actions, { prefs: prefsDialog, stamps: stampsDialog, headerFooter: headerFooterDialog, marks: marksSummary });
Object.assign(FEATURE_OF.act, { stamps: 'edit', headerFooter: 'pages' });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.tool === 'stamp' && !document.activeElement.isContentEditable && $('#modal').hidden) setTool('select'); });
applyPrefs();
setTimeout(() => { if (!/EDUPDF_SELFTEST/.test(location.search)) offerRecovery(); }, 1500);
window.__teacher = { markImage, marksSummary, PREFS, savePrefs, recoveryTick, offerRecovery, stampImage, applyHeaderFooter, parseRange, composePrint: window.composePrint, setStamp: (t, c) => { STAMP = { text: t, color: c }; } };
