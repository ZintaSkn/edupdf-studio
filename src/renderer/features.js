/* SknEDU-studio — fonctions pour la classe :
   correction de copies, évaluations différenciées, publipostage, inclusion (DYS, lecture à voix haute),
   classe connectée, diaporama interactif et mode présentateur, IA locale, équations, version bilingue,
   accessibilité et interface en anglais. S'appuie sur le moteur de app.js (même portée globale). */
'use strict';

// ---------------------------------------------------------------- outils communs
const FX = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Charge un fichier local de l'application (XHR : compatible avec file:// et l'archive asar). */
function loadLocal(url, type = 'arraybuffer') {
  return new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('GET', url); x.responseType = type; x.onload = () => (x.status === 0 || x.status === 200 ? res(x.response) : rej(new Error(url))); x.onerror = () => rej(new Error(url)); x.send(); });
}
function loadScriptOnce(src) {
  FX.scripts = FX.scripts || {};
  if (!FX.scripts[src]) FX.scripts[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src)); document.head.appendChild(s); });
  return FX.scripts[src];
}
const AIBUF = new Map();
window.api.onAiChunk(({ id, text }) => { if (AIBUF.has(id)) AIBUF.set(id, AIBUF.get(id) + text); });
/** Interroge l'IA configurée et renvoie la réponse complète (texte). */
async function aiAsk(prompt, { pdfBase64 = null, images = null, system = AI_SYSTEM } = {}) {
  if (!can('ai')) { denied('ai'); throw new Error('Assistant IA désactivé par l\'administrateur.'); }
  const st = await window.api.aiStatus(); const P = st.providers[st.provider];
  if (!P.hasKey) throw new Error('NO_AI');
  const id = 'f' + Date.now() + Math.random().toString(36).slice(2, 6); AIBUF.set(id, '');
  try {
    const r = await window.api.aiChat({ id, system, prompt, pdfBase64, images });
    if (r && r.cancelled) throw new Error('Demande annulée.');
    return AIBUF.get(id);
  } finally { AIBUF.delete(id); }
}
/** Extrait l'objet JSON d'une réponse d'IA (tolère le texte autour et les blocs de code). */
function parseJson(text) {
  const t = String(text).replace(/```json|```/g, ''); const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('Réponse de l\'IA illisible (JSON attendu).');
  return JSON.parse(t.slice(a, b + 1));
}
async function aiMissing() {
  const r = await modal('Assistant IA requis', '<p>Cette fonction utilise l\'assistant IA, qui n\'est pas encore configuré.</p><p class="muted">Ajoutez une clé (Claude, ChatGPT, Gemini, Mistral) ou installez l\'IA locale gratuite (hors ligne).</p>',
    [['Annuler', null], ['IA locale gratuite', 'local'], ['Réglages IA', 'settings', true]]);
  if (r === 'settings') aiSettings(); if (r === 'local') aiLocalDialog();
}
async function pagesPayload(pages, provider) {
  if (provider === 'anthropic') { const b = await buildPdf(pages); return { pdfBase64: (await bytesToDataUrl(b, 'application/pdf')).split(',')[1] }; }
  const images = []; for (const p of pages) { const im = await pageJpeg(p, 1.5); images.push(await bytesToDataUrl(im.bytes, 'image/jpeg')); }
  return { images };
}
async function openPdfInNewTab(bytes, name) {
  if (S.pages.length) newTab(); else resetDoc();
  await insertPdf(bytes, 0); S.fileName = name; S.cur = 0; S.sel = new Set([0]); setDirty(true); refresh(); showSide('pages');
}
async function mergePdfs(list) {
  const out = await PDFDocument.create();
  for (const b of list) { const d = await PDFDocument.load(b); (await out.copyPages(d, d.getPageIndices())).forEach((p) => out.addPage(p)); }
  return out.save();
}
function shuffle(arr, seed) { const a = arr.slice(); let s = seed; for (let i = a.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const j = Math.floor(s / 233280 * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ================================================================ 1. Correction de copies assistée
const GR = { copies: [], questions: [], ppc: 1, key: '' };
function gradingParseScale(txt) {
  return String(txt).split(/[;\n,]+/).map((s) => s.trim()).filter(Boolean).map((s, i) => {
    const m = /^(.*?)[\s:=]+(\d+(?:[.,]\d+)?)$/.exec(s); return m ? { id: m[1].trim() || `Q${i + 1}`, max: parseFloat(m[2].replace(',', '.')) } : { id: s, max: 1 };
  });
}
function gradingTotals() { GR.copies.forEach((c) => { c.total = GR.questions.reduce((s, q) => s + (parseFloat(String(c.pts[q.id] ?? '').replace(',', '.')) || 0), 0); }); }
async function gradingDialog() {
  if (!S.pages.length) return alert('Ouvrez ou scannez d\'abord le paquet de copies (une ou plusieurs pages par élève).');
  const r = await modal('Corriger des copies', `<p>Le document contient <b>${S.pages.length}</b> page(s).</p>
    <label class="blk">Pages par copie <input type="text" id="grPpc" value="${GR.ppc || 1}" style="width:80px"></label>
    <label class="blk">Barème (question : points), séparé par des points-virgules <input type="text" id="grScale" value="${esc(GR.questions.length ? GR.questions.map((q) => q.id + ':' + q.max).join('; ') : 'Q1:5; Q2:5; Q3:10')}"></label>
    <label class="blk">Corrigé ou attendus (facultatif, aide l'IA) <textarea id="grKey" rows="4" style="width:100%;box-sizing:border-box">${esc(GR.key)}</textarea></label>
    <p class="muted">Ensuite : saisissez les points copie par copie, ou laissez l'IA proposer une note (elle lit aussi l'écriture manuscrite). Vous validez toujours avant d'appliquer.</p>`,
  [['Annuler', null], ['Continuer', () => ({ ppc: Math.max(1, parseInt($('#grPpc').value, 10) || 1), scale: $('#grScale').value, key: $('#grKey').value }), true]]);
  if (!r) return;
  GR.ppc = r.ppc; GR.key = r.key; GR.questions = gradingParseScale(r.scale);
  if (!GR.questions.length) return alert('Barème vide.');
  const old = new Map(GR.copies.map((c) => [c.pages.join(','), c]));
  GR.copies = [];
  for (let i = 0; i < S.pages.length; i += GR.ppc) {
    const pages = S.pages.slice(i, i + GR.ppc).map((p) => p.uid); const prev = old.get(pages.join(','));
    GR.copies.push(prev || { pages, name: '', pts: {}, comment: '', total: 0 });
  }
  gradingGrid();
}
function gradingGridHtml() {
  gradingTotals(); const max = GR.questions.reduce((s, q) => s + q.max, 0);
  return `<div class="grgrid"><table><tr><th>Copie</th><th>Élève</th>${GR.questions.map((q) => `<th title="sur ${q.max}">${esc(q.id)}<small>/${q.max}</small></th>`).join('')}<th>Total<small>/${max}</small></th><th>Appréciation</th></tr>
    ${GR.copies.map((c, i) => `<tr data-c="${i}"><td><button class="link" data-goto-copy="${i}" title="Afficher cette copie">n° ${i + 1}</button>${c.ai ? ' <span title="Proposé par l\'IA, à vérifier">✨</span>' : ''}</td>
      <td><input data-f="name" value="${esc(c.name)}" placeholder="Nom"></td>
      ${GR.questions.map((q) => `<td><input data-q="${esc(q.id)}" value="${esc(c.pts[q.id] ?? '')}" inputmode="decimal" class="pt"></td>`).join('')}
      <td class="tot">${(Math.round(c.total * 100) / 100).toString().replace('.', ',')}</td><td><input data-f="comment" value="${esc(c.comment)}"></td></tr>`).join('')}</table></div>
    <p class="muted" id="grStatus">Saisie au clavier : Tab pour passer à la case suivante. Les propositions de l'IA (✨) sont à vérifier.</p>`;
}
function gradingBind() {
  $$('#mBody tr[data-c] input').forEach((inp) => {
    inp.oninput = () => { const c = GR.copies[+inp.closest('tr').dataset.c]; if (inp.dataset.q) c.pts[inp.dataset.q] = inp.value; else c[inp.dataset.f] = inp.value; gradingTotals(); inp.closest('tr').querySelector('.tot').textContent = (Math.round(c.total * 100) / 100).toString().replace('.', ','); };
  });
  $$('#mBody [data-goto-copy]').forEach((b) => { b.onclick = () => { const c = GR.copies[+b.dataset.gotoCopy]; const i = S.pages.findIndex((p) => p.uid === c.pages[0]); if (i >= 0) { S.cur = i; S.sel = new Set([i]); refresh(); } }; });
}
async function gradingGrid() {
  const p = modal('Corriger des copies — notes', gradingGridHtml(), [
    ['✨ Proposer avec l\'IA', () => { gradingAi(); return false; }],
    ['Exporter les notes (Excel)', () => { gradingExport(); return false; }],
    ['Fermer', null], ['Appliquer sur les copies', 'apply', true]]);
  $('#modal .mbox').classList.add('wide'); gradingBind();
  const r = await p; $('#modal .mbox').classList.remove('wide');
  if (r === 'apply') gradingApply();
}
async function gradingAi() {
  const st = await window.api.aiStatus(); if (!st.providers[st.provider].hasKey) return aiMissing();
  const bar = GR.questions.map((q) => `${q.id} sur ${q.max} points`).join(', ');
  for (let i = 0; i < GR.copies.length; i++) {
    const c = GR.copies[i]; if (c.ai || Object.keys(c.pts).length) continue;
    const s = $('#grStatus'); if (s) s.textContent = `L'IA lit la copie ${i + 1} / ${GR.copies.length}…`;
    const pages = c.pages.map((u) => S.pages.find((p) => p.uid === u)).filter(Boolean);
    try {
      const payload = await pagesPayload(pages, st.provider);
      const txt = await aiAsk(`Tu aides un enseignant à corriger la copie d'un élève (elle peut être manuscrite). Barème : ${bar}.${GR.key ? `\nCorrigé / attendus :\n${GR.key}` : ''}
Lis toute la copie, puis réponds UNIQUEMENT avec ce JSON : {"eleve":"nom et prénom lus sur la copie, sinon vide","notes":{${GR.questions.map((q) => `"${q.id}":nombre`).join(',')}},"commentaire":"appréciation brève, précise et bienveillante (25 mots max.)"}. Les notes ne dépassent pas le maximum de chaque question.`, { ...payload, system: 'Tu es un correcteur rigoureux et bienveillant. Tu réponds uniquement en JSON valide.' });
      const j = parseJson(txt);
      c.name = c.name || j.eleve || ''; c.comment = c.comment || j.commentaire || ''; c.ai = true;
      for (const q of GR.questions) { const v = Number(j.notes && j.notes[q.id]); if (!Number.isNaN(v)) c.pts[q.id] = String(Math.max(0, Math.min(q.max, v))).replace('.', ','); }
    } catch (e) { if (errMsg(e) === 'NO_AI') return aiMissing(); const s2 = $('#grStatus'); if (s2) s2.textContent = `Copie ${i + 1} : ${errMsg(e)}`; }
    if ($('#modal').hidden) return;
    $('#mBody').innerHTML = gradingGridHtml(); gradingBind();
  }
  const s = $('#grStatus'); if (s) s.textContent = 'Propositions terminées : vérifiez chaque note avant d\'appliquer.';
}
function gradingApply() {
  gradingTotals(); snapshot(); const max = GR.questions.reduce((s, q) => s + q.max, 0);
  for (const c of GR.copies) {
    const p = S.pages.find((x) => x.uid === c.pages[0]); if (!p) continue;
    p.items = p.items.filter((o) => o.tag !== 'grade');
    const box = [430, 770, 575, 822]; const red = '#c0392b';
    p.items.push({ type: 'rect', kind: 'box', tag: 'grade', rect: box, color: red, width: 1.5 });
    p.items.push({ type: 'text', tag: 'grade', at: [438, 816], size: 16, color: red, font: { family: 'Arial', bold: true }, text: `${(Math.round(c.total * 100) / 100).toString().replace('.', ',')} / ${max}` });
    p.items.push({ type: 'text', tag: 'grade', at: [438, 794], size: 8, color: red, font: { family: 'Arial' }, text: GR.questions.map((q) => `${q.id} : ${c.pts[q.id] || 0}/${q.max}`).join('  ') });
    if (c.comment) p.items.push({ type: 'note', tag: 'grade', at: [400, 820], text: `Appréciation : ${c.comment}`, color: '#ffd400' });
  }
  setDirty(true); refresh(); msg(`Notes appliquées sur ${GR.copies.length} copie(s). Enregistrez, imprimez ou exportez les notes.`);
}
async function gradingExport() {
  gradingTotals();
  const rows = [['Copie', 'Élève', ...GR.questions.map((q) => `${q.id} (/${q.max})`), `Total (/${GR.questions.reduce((s, q) => s + q.max, 0)})`, 'Appréciation'],
    ...GR.copies.map((c, i) => [i + 1, c.name, ...GR.questions.map((q) => parseFloat(String(c.pts[q.id] ?? '').replace(',', '.')) || 0), Math.round(c.total * 100) / 100, c.comment])];
  try { const r = await window.api.exportSheet([{ name: 'Notes', rows }], `${baseName()}-notes.xlsx`, 'xlsx'); if (r) msg(`Notes exportées : ${r}`); } catch (e) { alert(errMsg(e)); }
}

// ================================================================ 2. Évaluations différenciées
const LEVELS = ['Soutien', 'Standard', 'Approfondissement'];
async function diffEvalDialog() {
  if (!S.pages.length) return alert('Ouvrez d\'abord le document de cours (ou le sujet) à partir duquel créer les évaluations.');
  const r = await modal('Évaluations différenciées', `<p>À partir du document ouvert, l'IA prépare des sujets adaptés et leurs corrigés.</p>
    <div class="row">${LEVELS.map((l, i) => `<label class="ck"><input type="checkbox" class="lvl" value="${l}" ${i < 3 ? 'checked' : ''}> ${l}</label>`).join('')}</div>
    <div class="row"><label class="ck"><input type="checkbox" id="deAB" checked> Sujets A et B (questions et réponses mélangées)</label></div>
    <div class="row"><label>Questions par sujet <input type="text" id="deN" value="8" style="width:60px"></label>
    <label class="ck"><input type="checkbox" class="dty" value="qcm" checked> QCM</label><label class="ck"><input type="checkbox" class="dty" value="vf" checked> Vrai / faux</label><label class="ck"><input type="checkbox" class="dty" value="courte" checked> Réponse courte</label></div>
    <label class="blk">Consignes supplémentaires (facultatif) <input type="text" id="deExtra" placeholder="ex. niveau 5e, durée 30 min, notions des pages 2 à 4"></label>`,
  [['Annuler', null], ['Créer les sujets', () => ({ levels: $$('.lvl').filter((c) => c.checked).map((c) => c.value), ab: $('#deAB').checked, n: Math.min(30, Math.max(3, parseInt($('#deN').value, 10) || 8)), types: $$('.dty').filter((c) => c.checked).map((c) => c.value), extra: $('#deExtra').value }), true]]);
  if (!r || !r.levels.length) return;
  busy('L\'IA prépare les évaluations…');
  try {
    const st = await window.api.aiStatus();
    const text = (await aiDocText(S.pages)).slice(0, 120000);
    const payload = st.provider === 'anthropic' && st.sendPdf ? { pdfBase64: (await bytesToDataUrl(await buildPdf(S.pages), 'application/pdf')).split(',')[1] } : {};
    const ans = await aiAsk(`Crée une évaluation différenciée à partir de ce document de cours. Niveaux : ${r.levels.join(', ')}. ${r.n} questions par niveau, types autorisés : ${r.types.join(', ')} (qcm = 4 choix, une seule bonne réponse ; vf = vrai/faux ; courte = réponse en quelques mots). ${r.extra}
Réponds UNIQUEMENT avec ce JSON : {"titre":"…","niveaux":[{"nom":"${r.levels[0]}","questions":[{"type":"qcm|vf|courte","enonce":"…","choix":["…"],"reponse":"texte exact de la bonne réponse (ou Vrai / Faux)","points":1}]}]}${payload.pdfBase64 ? '' : `\n<document>\n${text}\n</document>`}`, { ...payload, system: 'Tu es un concepteur d\'évaluations pédagogiques. Tu réponds uniquement en JSON valide.' });
    const data = parseJson(ans); done();
    await diffEvalBuild(data, r.ab);
  } catch (e) { done(); if (errMsg(e) === 'NO_AI') return aiMissing(); alert('Création impossible : ' + errMsg(e)); }
}
/** Construit les sujets (PDF) et les exports à partir de la réponse JSON. */
async function diffEvalBuild(data, ab) {
  FX.lastEval = data; const pdfs = []; const keyLines = [`${data.titre || 'Évaluation'} — CORRIGÉS`, ''];
  for (const [li, lv] of (data.niveaux || []).entries()) {
    for (const v of ab ? ['A', 'B'] : ['']) {
      const qs = v === 'B' ? shuffle(lv.questions, 97 + li) : lv.questions;
      const lines = [`${data.titre || 'Évaluation'} — ${lv.nom}${v ? ' — Sujet ' + v : ''}`, 'Nom : ____________________   Prénom : ____________________   Classe : ________   Date : __________', ''];
      keyLines.push(`${lv.nom}${v ? ' — Sujet ' + v : ''}`);
      qs.forEach((q, i) => {
        const pts = q.points ? ` (${q.points} pt${q.points > 1 ? 's' : ''})` : '';
        lines.push(`${i + 1}. ${q.enonce}${pts}`);
        if (q.type === 'qcm') { const ch = v === 'B' ? shuffle(q.choix || [], 31 + i) : (q.choix || []); ch.forEach((c, k) => lines.push(`   □ ${String.fromCharCode(65 + k)}) ${c}`)); const k = ch.indexOf(q.reponse); keyLines.push(`  ${i + 1}. ${k >= 0 ? String.fromCharCode(65 + k) + ') ' : ''}${q.reponse}`); }
        else if (q.type === 'vf') { lines.push('   □ Vrai     □ Faux'); keyLines.push(`  ${i + 1}. ${q.reponse}`); }
        else { lines.push('   ………………………………………………………………………………………………', '   ………………………………………………………………………………………………'); keyLines.push(`  ${i + 1}. ${q.reponse}`); }
        lines.push('');
      });
      keyLines.push('');
      pdfs.push(await textToPdf(lines.join('\n')));
    }
  }
  pdfs.push(await textToPdf(keyLines.join('\n')));
  await openPdfInNewTab(await mergePdfs(pdfs), `${data.titre || 'Évaluations'} - différenciées.pdf`);
  const r = await modal('Évaluations prêtes', `<p>${(data.niveaux || []).length} niveau(x)${ab ? ', sujets A et B' : ''} et le corrigé sont ouverts dans un nouvel onglet.</p>
    <p class="muted">Exportez aussi les questions pour Moodle (format GIFT) ou un tableur (Google Forms, Kahoot, Wooclap acceptent l'import par tableur).</p>`,
  [['Exporter Moodle (GIFT)', 'gift'], ['Exporter tableur', 'csv'], ['Fermer', null, true]]);
  if (r === 'gift') await window.api.save({ bytes: new TextEncoder().encode(toGift(data)), defaultName: `${data.titre || 'evaluation'}.gift.txt`, filters: [{ name: 'Moodle GIFT', extensions: ['txt'] }] });
  if (r === 'csv') {
    const rows = [['Niveau', 'N°', 'Type', 'Question', 'Choix A', 'Choix B', 'Choix C', 'Choix D', 'Bonne réponse', 'Points']];
    (data.niveaux || []).forEach((lv) => lv.questions.forEach((q, i) => rows.push([lv.nom, i + 1, q.type, q.enonce, ...[0, 1, 2, 3].map((k) => (q.choix || [])[k] || ''), q.reponse, q.points || 1])));
    await window.api.exportSheet([{ name: 'Questions', rows }], `${data.titre || 'evaluation'}.xlsx`, 'xlsx');
  }
}
function toGift(data) {
  const e = (s) => String(s).replace(/([~=#{}:])/g, '\\$1');
  return (data.niveaux || []).flatMap((lv) => [`// ${lv.nom}`, `$CATEGORY: ${e(data.titre || 'Evaluation')}/${e(lv.nom)}`, '', ...lv.questions.map((q, i) => {
    const head = `::${e(lv.nom)} Q${i + 1}:: ${e(q.enonce)} `;
    if (q.type === 'qcm') return head + '{' + (q.choix || []).map((c) => (c === q.reponse ? `=${e(c)}` : `~${e(c)}`)).join(' ') + '}\n';
    if (q.type === 'vf') return head + (/^v|^t/i.test(q.reponse) ? '{TRUE}' : '{FALSE}') + '\n';
    return head + `{=${e(q.reponse)}}\n`;
  })]).join('\n');
}

// ================================================================ 3. Publipostage
async function mailMergeDialog() {
  if (!S.pages.length) return alert('Ouvrez d\'abord le modèle (bulletin, attestation…). Placez-y des zones de texte contenant {{NomDeColonne}}, ou des champs de formulaire portant le nom des colonnes.');
  const data = await window.api.readSheet(); if (!data) return;
  if (!data.rows.length) return alert('Le tableur ne contient aucune ligne de données.');
  const tags = new Set(); S.pages.forEach((p) => p.items.forEach((o) => { if (o.type === 'text') for (const m of o.text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) tags.add(m[1]); }));
  const fields = new Set(); for (const p of S.pages) { try { (await (await getPdfPage(p)).getAnnotations()).forEach((a) => { if (a.fieldName) fields.add(a.fieldName); }); } catch { /* sans formulaire */ } }
  const used = data.headers.filter((h) => tags.has(h) || fields.has(h));
  const r = await modal('Publipostage', `<p><b>${data.rows.length}</b> ligne(s) dans « ${esc(data.file)} ». Colonnes : ${data.headers.map((h) => `<code>${esc(h)}</code>`).join(' ')}</p>
    <p>${used.length ? `Utilisées dans le modèle : ${used.map((h) => `<b>${esc(h)}</b>`).join(', ')}` : '<span class="err">Aucune colonne n\'est encore utilisée dans le modèle</span> : ajoutez des zones de texte avec {{Nom}} (outil « Ajouter du texte ») ou des champs nommés comme les colonnes.'}</p>
    <label class="ck"><input type="radio" name="mmOut" value="one" checked> Un seul PDF (toutes les pages à la suite, pratique pour imprimer)</label>
    <label class="ck"><input type="radio" name="mmOut" value="many"> Un PDF par ligne, nommé d'après la colonne <select id="mmName">${data.headers.map((h) => `<option>${esc(h)}</option>`).join('')}</select></label>`,
  [['Annuler', null], ['Générer', () => (used.length ? { out: document.querySelector('input[name=mmOut]:checked').value, nameCol: $('#mmName').value } : (alert('Le modèle ne contient aucune balise correspondant aux colonnes.'), false)), true]]);
  if (!r) return;
  busy('Publipostage…');
  try {
    const files = await mergeRows(data.headers, data.rows, r.nameCol);
    done();
    if (r.out === 'one') await openPdfInNewTab(await mergePdfs(files.map((f) => f.bytes)), `${baseName()} - publipostage.pdf`);
    else { const dir = await window.api.saveMany(files); if (dir) msg(`${files.length} fichier(s) créé(s) dans ${dir}`); }
  } catch (e) { done(); alert('Publipostage impossible : ' + errMsg(e)); }
}
/** Génère un PDF par ligne en remplaçant les balises {{Colonne}} et en remplissant les champs du même nom. */
async function mergeRows(headers, rows, nameCol) {
  const saved = JSON.stringify(S.pages); const out = [];
  const ann = new Map(); for (const p of S.pages) { try { ann.set(p.uid, await (await getPdfPage(p)).getAnnotations()); } catch { ann.set(p.uid, []); } }
  try {
    for (const [ri, row] of rows.entries()) {
      busy(`Publipostage : document ${ri + 1} / ${rows.length}…`);
      const val = Object.fromEntries(headers.map((h, i) => [h, row[i] ?? '']));
      S.pages = JSON.parse(saved);
      for (const p of S.pages) {
        p.items.forEach((o) => { if (o.type === 'text') o.text = o.text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, k) => (k in val ? val[k] : m)); });
        for (const a of ann.get(p.uid) || []) if (a.fieldName && a.fieldName in val) { p.forms = p.forms || {}; p.forms[a.id] = a.checkBox ? { t: 'cb', v: /^(1|oui|x|vrai|true|yes)$/i.test(val[a.fieldName]), on: a.exportValue || 'Yes' } : { t: 'tx', v: val[a.fieldName] }; }
      }
      const name = String(val[nameCol] || `document-${ri + 1}`).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
      out.push({ name: `${name}.pdf`, bytes: await buildPdf() });
    }
  } finally { S.pages = JSON.parse(saved); refresh(); }
  return out;
}

// ================================================================ 4. Inclusion : version adaptée (DYS, malvoyants) et lecture à voix haute
async function dysDialog() {
  if (!S.pages.length) return;
  const r = await modal('Version adaptée (DYS, malvoyants)', `<p>Recrée le texte du document dans une mise en page plus lisible (les images ne sont pas reprises).</p>
    <div class="row"><label>Police <select id="dyF"><option value="OpenDyslexic">OpenDyslexic (dyslexie)</option><option>Verdana</option><option>Arial</option><option>Comic Sans MS</option></select></label>
    <label>Taille <select id="dyS"><option>14</option><option selected>16</option><option>18</option><option>22</option></select></label>
    <label>Interligne <select id="dyL"><option value="1.5">1,5</option><option value="1.8" selected>1,8</option><option value="2.2">2,2</option></select></label>
    <label>Espacement des lettres <select id="dyC"><option value="0">normal</option><option value="0.6" selected>large</option><option value="1.2">très large</option></select></label></div>
    <label class="ck"><input type="checkbox" id="dyR" checked> Règle de lecture : une ligne sur deux surlignée en couleur pâle</label>`,
  [['Annuler', null], ['Créer la version adaptée', () => ({ font: $('#dyF').value, size: +$('#dyS').value, lh: +$('#dyL').value, cs: +$('#dyC').value, ruler: $('#dyR').checked }), true]]);
  if (!r) return;
  busy('Création de la version adaptée…');
  try { const bytes = await dysPdf(r); done(); await openPdfInNewTab(bytes, `${baseName()} - version adaptée.pdf`); msg('Version adaptée créée dans un nouvel onglet.'); }
  catch (e) { done(); alert(errMsg(e)); }
}
async function dysPdf({ font, size, lh, cs, ruler }) {
  const d = await PDFDocument.create(); const emb = fontEmbedder(d); await emb.get('arial.ttf');
  let od = null;
  if (font === 'OpenDyslexic') { d.registerFontkit(window.fontkit); od = await d.embedFont(new Uint8Array(await loadLocal('../../node_modules/@fontsource/opendyslexic/files/opendyslexic-latin-400-normal.woff')), { subset: true }); }
  const fam = { family: font === 'OpenDyslexic' ? 'Arial' : font };
  const okOD = (s) => { try { od.encodeText(s); return true; } catch { return false; } };
  const width = async (s) => (od && okOD(s) ? od.widthOfTextAtSize(s, size) : await measureText(s, fam, size)) + cs * [...s].length;
  const [W, H] = A4; const m = 50; const maxW = W - 2 * m; const step = size * lh;
  let page = d.addPage(A4); let y = H - m - size; let n = 0;
  const colors = [rgb(1, 0.97, 0.82), rgb(0.88, 0.94, 1)];
  const line = async (s) => {
    if (y < m) { page = d.addPage(A4); y = H - m - size; }
    if (ruler && s) page.drawRectangle({ x: m - 6, y: y - size * 0.35, width: maxW + 12, height: step * 0.92, color: colors[n++ % 2] });
    if (s) {
      page.pushOperators(PDFLib.setCharacterSpacing(cs));
      if (od && okOD(s)) page.drawText(s, { x: m, y, size, font: od, color: rgb(0.05, 0.07, 0.2) });
      else await drawUnicode(page, emb, s, { x: m, y, size, font: fam, color: rgb(0.05, 0.07, 0.2) });
      page.pushOperators(PDFLib.setCharacterSpacing(0));
    }
    y -= step;
  };
  for (const p of S.pages) {
    for (const par of await pageParagraphs(p)) {
      let cur = '';
      for (const w of par.text.split(/\s+/)) { const t = cur ? cur + ' ' + w : w; if (cur && await width(t) > maxW) { await line(cur); cur = w; } else cur = t; }
      await line(cur); y -= step * 0.4;
    }
  }
  return d.save();
}
let speaking = false;
async function speakToggle() {
  if (speaking || speechSynthesis.speaking) { speechSynthesis.cancel(); speaking = false; return msg('Lecture arrêtée.'); }
  const p = curPage(); if (!p) return;
  const text = (await pageParagraphs(p)).map((l) => l.text).join('. ');
  if (!text.trim()) return alert('Aucun texte sur cette page : faites d\'abord l\'OCR si c\'est un scan.');
  const u = new SpeechSynthesisUtterance(text); const voices = speechSynthesis.getVoices();
  u.voice = voices.find((v) => /^fr/i.test(v.lang)) || null; u.lang = 'fr-FR'; u.rate = 0.95;
  u.onend = () => { speaking = false; }; speaking = true; speechSynthesis.speak(u);
  msg(`Lecture à voix haute${u.voice ? ' (' + u.voice.name + ')' : ''} — cliquez à nouveau pour arrêter.`);
}

// ================================================================ 5. Diaporama interactif : stylo, tableau blanc, minuteur, présentateur
const INK = { pen: false, board: false, color: 0, strokes: {}, vps: {}, cur: null, timer: null, timerEnd: 0, presenter: false, lastFrame: 0 };
const PEN_COLORS = ['#e53935', '#1e88e5', '#43a047', '#111111', '#fbc02d'];
function inkCanvas() {
  let c = $('#showInk');
  if (!c) { c = document.createElement('canvas'); c.id = 'showInk'; $('#show').appendChild(c); bindInk(c); }
  return c;
}
function placeInk() {
  const c = inkCanvas(); const s = $('#showCanvas'); const sh = $('#show');
  const r = INK.board ? { left: 0, top: sh.scrollTop, width: sh.clientWidth, height: sh.clientHeight } : { left: s.offsetLeft, top: s.offsetTop, width: s.offsetWidth, height: s.offsetHeight };
  Object.assign(c.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  const dpr = devicePixelRatio || 1; c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
  c.classList.toggle('on', INK.pen || INK.board); redrawInk();
}
function strokesKey() { return INK.board ? 'board' : SHOW.i; }
function redrawInk() {
  const c = $('#showInk'); if (!c) return; const ctx = c.getContext('2d'); const dpr = devicePixelRatio || 1;
  ctx.clearRect(0, 0, c.width, c.height);
  if (INK.board) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
  for (const st of INK.strokes[strokesKey()] || []) {
    ctx.strokeStyle = st.color; ctx.lineWidth = st.w * dpr; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
    st.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * dpr, y * dpr) : ctx.moveTo(x * dpr, y * dpr))); ctx.stroke();
  }
  sendFrame();
}
function bindInk(c) {
  c.addEventListener('pointerdown', (e) => { if (!(INK.pen || INK.board)) return; e.stopPropagation(); c.setPointerCapture(e.pointerId); const r = c.getBoundingClientRect(); INK.cur = { color: PEN_COLORS[INK.color], w: 3, pts: [[e.clientX - r.left, e.clientY - r.top]] }; (INK.strokes[strokesKey()] = INK.strokes[strokesKey()] || []).push(INK.cur); });
  c.addEventListener('pointermove', (e) => { if (!INK.cur) return; const r = c.getBoundingClientRect(); INK.cur.pts.push([e.clientX - r.left, e.clientY - r.top]); redrawInk(); });
  c.addEventListener('pointerup', () => { INK.cur = null; redrawInk(); });
  c.addEventListener('click', (e) => { if (INK.pen || INK.board) e.stopPropagation(); });
}
function showBadge(t) { const i = $('#showInfo'); i.textContent = t; i.classList.add('vis'); clearTimeout(i._t); i._t = setTimeout(() => i.classList.remove('vis'), 1800); }
function timerTick() {
  const el = $('#showTimer'); if (!el) return;
  const left = Math.max(0, INK.timerEnd - Date.now()); const mm = Math.floor(left / 60000), ss = Math.floor(left / 1000) % 60;
  el.textContent = `⏱ ${mm}:${String(ss).padStart(2, '0')}`; el.classList.toggle('end', left === 0);
  if (left === 0) { clearInterval(INK.timer); INK.timer = null; try { const a = new AudioContext(); const o = a.createOscillator(); o.connect(a.destination); o.frequency.value = 880; o.start(); setTimeout(() => { o.stop(); a.close(); }, 600); } catch { /* son facultatif */ } }
  sendFrame();
}
window.showKeyHook = (e) => {
  const k = e.key.toLowerCase();
  if (k === 'p') { INK.pen = !INK.pen; placeInk(); showBadge(INK.pen ? '✏️ Stylo activé (C : couleur, E : effacer)' : 'Stylo désactivé'); return true; }
  if (k === 'c' && (INK.pen || INK.board)) { INK.color = (INK.color + 1) % PEN_COLORS.length; showBadge('Couleur du stylo'); return true; }
  if (k === 'e') { INK.strokes[strokesKey()] = []; redrawInk(); showBadge('Annotations effacées'); return true; }
  if (k === 't') { INK.board = !INK.board; placeInk(); showBadge(INK.board ? '📝 Tableau blanc (T pour revenir)' : 'Retour au diaporama'); return true; }
  if (k === 'm') {
    const steps = [5, 10, 15, 20, 30, 0]; const cur = INK.timer ? Math.round((INK.timerEnd - Date.now()) / 60000) : 0; const next = steps.find((s) => s > cur) ?? 0;
    clearInterval(INK.timer); INK.timer = null; let el = $('#showTimer');
    if (!next) { if (el) el.remove(); showBadge('Minuteur arrêté'); return true; }
    if (!el) { el = document.createElement('div'); el.id = 'showTimer'; $('#show').appendChild(el); }
    INK.timerEnd = Date.now() + next * 60000; INK.timer = setInterval(timerTick, 500); timerTick(); showBadge(`Minuteur : ${next} min (M pour changer)`); return true;
  }
  return false;
};
window.showPointerBusy = () => INK.pen || INK.board;
window.showRenderHook = (c, vp) => { INK.vps[SHOW.i] = { vp, dpr: devicePixelRatio || 1 }; placeInk(); presenterUpdate(); };
window.showEndHook = () => {
  clearInterval(INK.timer); INK.timer = null; const t = $('#showTimer'); if (t) t.remove();
  INK.pen = false; INK.board = false; const c = $('#showInk'); if (c) c.classList.remove('on');
  if (INK.presenter) { window.api.presentClose(); INK.presenter = false; $('#show').classList.remove('presenter'); }
  const pages = Object.keys(INK.strokes).filter((k) => k !== 'board' && (INK.strokes[k] || []).length);
  if (pages.length && confirm('Ajouter au document les annotations faites au stylo pendant la projection ?')) {
    snapshot();
    for (const k of pages) {
      const p = S.pages[+k]; const v = INK.vps[k]; if (!p || !v) continue;
      for (const st of INK.strokes[k]) p.items.push({ type: 'ink', color: st.color, width: 2, points: st.pts.map(([x, y]) => v.vp.convertToPdfPoint(x * v.dpr, y * v.dpr)) });
    }
    setDirty(true);
  }
  INK.strokes = {}; INK.vps = {};
};
/** Image envoyée au second écran : diapositive + annotations (ou tableau blanc). */
function sendFrame() {
  if (!INK.presenter) return; const now = Date.now(); if (now - INK.lastFrame < 90) { clearTimeout(INK.frameT); INK.frameT = setTimeout(sendFrame, 100); return; }
  INK.lastFrame = now;
  const s = $('#showCanvas'); const ink = $('#showInk'); if (!s) return;
  const c = document.createElement('canvas'); c.width = INK.board ? ink.width : s.width; c.height = INK.board ? ink.height : s.height; const ctx = c.getContext('2d');
  if (!INK.board) ctx.drawImage(s, 0, 0); if (ink && (INK.pen || INK.board || (INK.strokes[strokesKey()] || []).length)) ctx.drawImage(ink, 0, 0, c.width, c.height);
  window.api.presentFrame(c.toDataURL('image/jpeg', 0.88));
}
async function presenterUpdate() {
  if (!INK.presenter) return;
  const nx = $('#presNext'); const notes = $('#presNotes'); const p = S.pages[SHOW.i]; const n = S.pages[SHOW.i + 1];
  if (notes) notes.textContent = (p && p.items.filter((o) => o.type === 'note').map((o) => o.text).join('\n')) || 'Aucune note pour cette page (ajoutez des commentaires 💬 pour qu\'ils apparaissent ici).';
  if (nx) { nx.innerHTML = n ? '' : '<p>Fin du diaporama</p>'; if (n) { const im = await pageJpeg(n, 0.6); const img = new Image(); img.src = await bytesToDataUrl(im.bytes, 'image/jpeg'); nx.appendChild(img); } }
  sendFrame();
}
// Démarrage : si un second écran est branché, mode présentateur (projection d'un côté, notes et diapositive suivante de l'autre)
const _startShow = startShow;
startShow = async function (fromCurrent) { // eslint-disable-line no-func-assign
  let two = false; try { two = (await window.api.displays()) > 1; } catch { two = false; }
  if (two && S.pages.length && confirm('Un second écran est branché : utiliser le mode présentateur ?\n(projection sur le second écran, notes et diapositive suivante sur celui-ci)')) {
    INK.presenter = await window.api.presentOpen();
    if (INK.presenter) {
      $('#show').classList.add('presenter');
      if (!$('#presPanel')) { const d = document.createElement('div'); d.id = 'presPanel'; d.innerHTML = '<h4>Diapositive suivante</h4><div id="presNext"></div><h4>Notes</h4><pre id="presNotes"></pre><p class="muted">P stylo · T tableau blanc · M minuteur · B/W écran noir/blanc · Échap quitter</p>'; $('#show').appendChild(d); }
    }
  }
  return _startShow(fromCurrent);
};
window.api.onPresentKey(({ key, shift }) => window.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey: shift })));
window.api.onPresentClosed(() => { if (INK.presenter) { INK.presenter = false; $('#show').classList.remove('presenter'); } });

// ================================================================ 6. Classe connectée (réseau local, sans Internet)
let CLASS = { active: false };
async function classroomDialog() {
  if (CLASS.active) return classroomPanel();
  if (!S.pages.length) return alert('Ouvrez d\'abord le document à distribuer (fiche, évaluation, formulaire…).');
  const r = await modal('Classe connectée', `<p>Les élèves connectés au <b>même Wi-Fi</b> que ce PC ouvrent le document en scannant un QR code, puis rendent leur copie. Aucune connexion Internet n'est nécessaire.</p>
    <label class="blk">Titre affiché aux élèves <input type="text" id="clT" value="${esc(baseName())}"></label>
    <label class="blk">Consigne <input type="text" id="clM" value="Téléchargez le document, complétez-le, puis rendez-le en PDF."></label>
    <label class="ck"><input type="checkbox" id="clC" checked> Récupérer les copies des élèves</label>
    <p class="muted">Au premier partage, Windows peut demander d'autoriser SknEDU-studio sur les réseaux privés : acceptez.</p>`,
  [['Annuler', null], ['Démarrer le partage', () => ({ title: $('#clT').value || baseName(), message: $('#clM').value, collect: $('#clC').checked }), true]]);
  if (!r) return;
  busy('Préparation du partage…');
  try { const bytes = await buildPdf(); CLASS = await window.api.classroomStart({ bytes, title: r.title, message: r.message, collect: r.collect, fileName: S.fileName }); done(); classroomTag(); classroomPanel(); }
  catch (e) { done(); alert('Partage impossible : ' + errMsg(e)); }
}
function classroomHtml() {
  return `<div class="clgrid"><div><img src="${CLASS.qr || ''}" alt="QR code" class="qr"><p class="muted">Ou saisir l'adresse :</p>${(CLASS.urls || [CLASS.url]).map((u) => `<code class="url">${esc(u)}</code>`).join('')}</div>
    <div><p>📥 Téléchargements : <b id="clDl">${CLASS.downloads || 0}</b></p>${CLASS.collect ? `<p>📤 Copies reçues : <b>${(CLASS.received || []).length}</b></p>
    <ul class="cllist">${(CLASS.received || []).map((r) => `<li>${esc(r.eleve)} <small>${new Date(r.at).toLocaleTimeString('fr-FR')}</small></li>`).join('') || '<li class="muted">En attente…</li>'}</ul>` : ''}</div></div>`;
}
async function classroomPanel() {
  const r = await modal('Classe connectée — partage en cours', classroomHtml(), [['Arrêter le partage', 'stop'], ...(CLASS.collect ? [['Ouvrir les copies reçues', 'open'], ['Corriger les copies', 'grade']] : []), ['Réduire', null, true]]);
  if (r === 'stop') { const s = await window.api.classroomStop(); CLASS = { active: false }; classroomTag(); msg(`Partage arrêté. ${s.received} copie(s) reçue(s), conservées dans ${s.dir}.`); }
  if (r === 'open' || r === 'grade') {
    const files = (CLASS.received || []).map((x) => x.file); if (!files.length) return alert('Aucune copie reçue pour l\'instant.');
    busy('Ouverture des copies…'); const loaded = await window.api.loadPaths(files); if (S.pages.length) newTab(); else resetDoc(); await handleLoaded(loaded, 0); S.fileName = 'Copies reçues.pdf'; done();
    if (r === 'grade') { GR.ppc = Math.max(1, Math.round(S.pages.length / files.length)); gradingDialog(); }
  }
}
function classroomTag() {
  let t = $('#classTag');
  if (!CLASS.active) { if (t) t.remove(); return; }
  if (!t) { t = document.createElement('button'); t.id = 'classTag'; t.onclick = () => classroomPanel(); $('footer').insertBefore(t, $('#update')); }
  t.textContent = `📡 Partage en cours${CLASS.collect ? ` — ${(CLASS.received || []).length} copie(s)` : ''}`;
}
window.api.onClassroom((s) => { const qr = CLASS.qr; CLASS = { ...s, qr }; classroomTag(); if (!$('#modal').hidden && $('#mTitle').textContent.startsWith('Classe connectée —')) $('#mBody').innerHTML = classroomHtml(); });

// ================================================================ 7. IA locale intégrée (hors ligne, gratuite)
async function aiLocalDialog() {
  const r = await modal('IA locale (hors ligne, gratuite)', `<p>Installe un moteur d'IA sur ce PC : les demandes ne quittent jamais l'ordinateur et fonctionnent sans Internet.</p>
    <label class="blk">Modèle <select id="alM"><option value="llama3.2:3b">Llama 3.2 3B — rapide, 2 Go (recommandé)</option><option value="qwen2.5:7b">Qwen 2.5 7B — plus précis, 4,7 Go</option><option value="mistral:7b">Mistral 7B — 4,1 Go</option><option value="llava:7b">LLaVA 7B — lit aussi les images et les copies, 4,7 Go</option></select></label>
    <p class="muted">Téléchargement unique (Internet nécessaire une seule fois). 8 Go de mémoire vive conseillés.</p>`, [['Annuler', null], ['Installer', () => $('#alM').value, true]]);
  if (!r) return;
  busy('Préparation de l\'IA locale…');
  const off = (m) => { $('#busyMsg').textContent = m; };
  window.api.onAiInstall(off);
  try { const x = await window.api.aiInstallLocal(r); done(`IA locale prête (${x.model}) : l'assistant fonctionne désormais hors ligne.`); refreshAiBadge(); }
  catch (e) { done(); alert('Installation impossible : ' + errMsg(e)); }
}

// ================================================================ 8. Équations (LaTeX) et formules
async function texToPng(latex, color = '#000000') {
  window.MathJax = window.MathJax || { startup: { typeset: false }, svg: { fontCache: 'none' }, options: { enableMenu: false } };
  await loadScriptOnce('../../node_modules/mathjax/es5/tex-svg-full.js'); await window.MathJax.startup.promise;
  const node = await window.MathJax.tex2svgPromise(latex, { display: true });
  const svg = node.querySelector('svg'); const holder = document.createElement('div'); Object.assign(holder.style, { position: 'fixed', left: '-9999px', fontSize: '32px', color });
  holder.appendChild(svg); document.body.appendChild(holder);
  const b = svg.getBoundingClientRect(); svg.setAttribute('width', b.width); svg.setAttribute('height', b.height); svg.setAttribute('color', color);
  const xml = new XMLSerializer().serializeToString(svg).replace(/currentColor/g, color); holder.remove();
  const img = await loadImg('data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml))));
  const k = 3; const c = document.createElement('canvas'); c.width = Math.ceil(b.width * k); c.height = Math.ceil(b.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { url: c.toDataURL('image/png'), w: b.width, h: b.height };
}
async function equationDialog() {
  if (!S.pages.length) return alert('Ouvrez d\'abord un document.');
  if (!can('edit')) return denied('edit');
  const p = modal('Insérer une équation', `<label class="blk">Formule (LaTeX) <textarea id="eqT" rows="3" style="width:100%;box-sizing:border-box;font-family:Consolas,monospace">\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}</textarea></label>
    <div id="eqP" class="eqprev">…</div><div class="row"><label>Taille <select id="eqS"><option value="0.6">petite</option><option value="0.8" selected>moyenne</option><option value="1.1">grande</option></select></label><label>Couleur <input type="color" id="eqC" value="#000000"></label></div>
    <p class="muted">Exemples : <code>x^2</code>, <code>\\sqrt{2}</code>, <code>\\frac{a}{b}</code>, <code>\\vec{F}=m\\vec{a}</code>, <code>H_2O</code>, <code>\\int_0^1 f(x)\\,dx</code>. Astuce : l'assistant IA (préréglage « Formules en LaTeX ») retranscrit les formules d'un scan.</p>`,
  [['Annuler', null], ['Insérer', () => ({ tex: $('#eqT').value, k: +$('#eqS').value, color: $('#eqC').value }), true]]);
  const prev = async () => { try { const r = await texToPng($('#eqT').value, $('#eqC').value); $('#eqP').innerHTML = `<img src="${r.url}" style="max-width:100%;height:${Math.min(120, r.h)}px">`; } catch { $('#eqP').textContent = 'Formule invalide.'; } };
  $('#eqT').oninput = () => { clearTimeout(FX.eqT); FX.eqT = setTimeout(prev, 300); }; $('#eqC').oninput = prev; prev();
  const r = await p; if (!r || !r.tex.trim()) return;
  try {
    const im = await texToPng(r.tex, r.color); const pg = curPage(); const w = im.w * r.k * S.scale, h = im.h * r.k * S.scale;
    const box = $('#pageBox').getBoundingClientRect(); const vw = $('#viewWrap').getBoundingClientRect();
    const cx = Math.min(box.width - w, Math.max(0, (vw.left + vw.width / 2) - box.left - w / 2)); const cy = Math.min(box.height - h, Math.max(0, (vw.top + vw.height / 2) - box.top - h / 2));
    snapshot(); pg.items.push({ type: 'image', rect: viewToPdfRect(S.vp, cx, cy, w, h), ref: putImg(im.url), tex: r.tex });
    S.selItem = pg.items.length - 1; setTool('select'); drawItems(); msg('Équation insérée : déplacez-la ou redimensionnez-la avec la souris.');
  } catch (e) { alert('Formule invalide : ' + errMsg(e)); }
}

// ================================================================ 9. Version bilingue côte à côte
async function bilingualDialog() {
  if (!S.pages.length) return;
  const r = await modal('Version bilingue côte à côte', `<p>Chaque paragraphe du document est placé à côté de sa traduction (idéal pour les sections bilingues et les élèves allophones).</p>
    <label class="blk">Traduire vers <select id="biL"><option>anglais</option><option>français</option><option>espagnol</option><option>allemand</option><option>portugais</option><option>arabe</option><option>italien</option></select></label>`,
  [['Annuler', null], ['Créer', () => $('#biL').value, true]]);
  if (!r) return;
  busy('Traduction…');
  try {
    const pairs = [];
    for (let i = 0; i < S.pages.length; i++) {
      busy(`Traduction : page ${i + 1} / ${S.pages.length}…`);
      const paras = (await pageParagraphs(S.pages[i])).map((l) => l.text).filter((t) => t.trim());
      if (!paras.length) continue;
      const ans = await aiAsk(`Traduis chaque paragraphe en ${r}. Réponds UNIQUEMENT avec ce JSON : {"traductions":["…"]} (même nombre d'éléments, même ordre).\n${JSON.stringify(paras)}`, { system: 'Tu es un traducteur professionnel pour l\'enseignement. Tu réponds uniquement en JSON valide.' });
      const t = parseJson(ans).traductions || []; paras.forEach((s, k) => pairs.push([s, t[k] || '']));
    }
    if (!pairs.length) { done(); return alert('Aucun texte à traduire (faites d\'abord l\'OCR si c\'est un scan).'); }
    const bytes = await bilingualPdf(pairs, r); done(); await openPdfInNewTab(bytes, `${baseName()} - bilingue.pdf`);
  } catch (e) { done(); if (errMsg(e) === 'NO_AI') return aiMissing(); alert('Traduction impossible : ' + errMsg(e)); }
}
async function bilingualPdf(pairs, lang) {
  const d = await PDFDocument.create(); const emb = fontEmbedder(d); const [W, H] = A4; const m = 40, gap = 18; const cw = (W - 2 * m - gap) / 2; const size = 10, step = 13;
  const font = { family: 'Calibri' }; let page = d.addPage(A4); let y = H - m;
  const head = async () => { await drawUnicode(page, emb, 'Original', { x: m, y, size: 9, font: { family: 'Arial', bold: true }, color: rgb(0, 0.09, 0.44) }); await drawUnicode(page, emb, `Traduction (${lang})`, { x: m + cw + gap, y, size: 9, font: { family: 'Arial', bold: true }, color: rgb(0.8, 0.57, 0) }); y -= 16; };
  await head();
  for (const [a, b] of pairs) {
    const la = await wrapText(a, font, size, cw); const lb = await wrapText(b, font, size, cw); const rows = Math.max(la.length, lb.length);
    if (y - rows * step < m) { page = d.addPage(A4); y = H - m; await head(); }
    page.drawLine({ start: { x: m + cw + gap / 2, y: y + 9 }, end: { x: m + cw + gap / 2, y: y - rows * step + 4 }, color: rgb(0.8, 0.83, 0.9), thickness: 0.6 });
    for (let i = 0; i < rows; i++) {
      if (la[i]) await drawUnicode(page, emb, la[i], { x: m, y: y - i * step, size, font, color: rgb(0.08, 0.1, 0.2) });
      if (lb[i]) await drawUnicode(page, emb, lb[i], { x: m + cw + gap, y: y - i * step, size, font, color: rgb(0.08, 0.1, 0.2) });
    }
    y -= rows * step + 8;
  }
  return d.save();
}

// ================================================================ Accessibilité
function a11y() {
  $('#tabs').setAttribute('role', 'tablist');
  $$('#tabs [data-tab]').forEach((b) => { b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', b.classList.contains('on')); });
  $$('.panel').forEach((p) => { p.setAttribute('role', 'toolbar'); p.setAttribute('aria-label', 'Ruban : ' + p.dataset.panel); });
  $('#modal').setAttribute('role', 'dialog'); $('#modal').setAttribute('aria-modal', 'true'); $('#modal').setAttribute('aria-labelledby', 'mTitle');
  $('#msg').setAttribute('role', 'status'); $('#msg').setAttribute('aria-live', 'polite');
  $$('#qat button, #docTabs button').forEach((b) => { if (!b.getAttribute('aria-label') && b.title) b.setAttribute('aria-label', b.title); });
  $$('button i').forEach((i) => i.setAttribute('aria-hidden', 'true'));
}
new MutationObserver(() => $$('#tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', b.classList.contains('on')))).observe(document.querySelector('#tabs'), { subtree: true, attributes: true, attributeFilter: ['class'] });

// ================================================================ Interface en anglais
const EN = {
  'Accueil': 'Home', '🏠 Accueil': '🏠 Home', 'Fichier': 'File', 'Créer': 'Create', 'Modifier': 'Edit', 'Pages': 'Pages', 'OCR': 'OCR', 'Convertir': 'Convert',
  'Protéger & Comparer': 'Protect & Compare', '✨ Assistant IA': '✨ AI assistant', 'Aide': 'Help', '🎓 Classe': '🎓 Classroom',
  'Nouveau': 'New', 'Ouvrir': 'Open', 'Enregistrer': 'Save', 'Imprimer': 'Print', 'Modifier le texte': 'Edit text', 'Modifier un paragraphe': 'Edit a paragraph',
  'Ajouter du texte': 'Add text', 'Surligner': 'Highlight', 'Assistant IA': 'AI assistant', 'Diaporama (F5)': 'Slideshow (F5)', 'Depuis cette page (Maj+F5)': 'From this page (Shift+F5)',
  'Panneau Accueil': 'Home panel', 'Enregistrer sous': 'Save as', 'Enregistrer dans le cloud': 'Save to cloud', 'Ouvrir depuis le cloud': 'Open from cloud',
  'Réduire la taille': 'Reduce size', 'Fermer': 'Close', 'Page vierge': 'Blank page', 'Depuis des images': 'From images', 'Scanner': 'Scan',
  'Insérer / Fusionner (PDF, Word, PPT, Excel)': 'Insert / Merge (PDF, Word, PPT, Excel)', 'Sélection': 'Select', 'Image': 'Image', 'Masquer (blanc)': 'Redact (white)',
  'Cadre': 'Box', 'Stylo': 'Pen', 'Signature': 'Signature', 'Champ texte': 'Text field', 'Case à cocher': 'Checkbox', 'Commentaire': 'Comment',
  'Rechercher / remplacer': 'Find / replace', 'Annuler': 'Undo', 'Rétablir': 'Redo', "Supprimer l'élément": 'Delete item', 'Équation': 'Equation',
  'Pivoter gauche': 'Rotate left', 'Pivoter droite': 'Rotate right', 'Supprimer': 'Delete', 'Dupliquer': 'Duplicate', 'Insérer vierge': 'Insert blank', 'Monter': 'Move up',
  'Descendre': 'Move down', 'Extraire la sélection': 'Extract selection', 'Diviser (1 PDF / page)': 'Split (1 PDF / page)', 'Numéroter les pages': 'Number pages',
  'Rogner': 'Crop', 'Annuler le rognage': 'Undo crop', 'Filigrane': 'Watermark', 'Langue': 'Language', 'OCR page courante': 'OCR current page',
  'OCR tout le document': 'OCR whole document', 'Modifier le texte reconnu': 'Edit recognized text', 'Copie numérisée éditable (sélection)': 'Editable scanned copy (selection)',
  'Protéger par mot de passe': 'Password protect', 'Retirer le mot de passe': 'Remove password', 'Ma signature': 'My signature', 'Signer avec un certificat': 'Sign with a certificate',
  'Comparer avec un autre fichier': 'Compare with another file', 'Effacer les marques de comparaison': 'Clear comparison marks', 'PDF → autres formats (ODT, RTF, ODS, CSV…)': 'PDF → other formats (ODT, RTF, ODS, CSV…)',
  'Convertir un fichier Office': 'Convert an Office file', 'PDF → Images (.png)': 'PDF → Images (.png)', 'PDF → Texte (.txt)': 'PDF → Text (.txt)', 'Ouvrir l\'assistant': 'Open assistant',
  'Résumer': 'Summarize', 'Créer un QCM': 'Create a quiz', "Fiche d'exercices": 'Worksheet', 'Simplifier (différenciation)': 'Simplify (differentiation)',
  'Corriger les fautes': 'Proofread', 'Traduire': 'Translate', "Grille d'évaluation": 'Rubric', 'Plan de séance': 'Lesson plan', 'Mon abonnement (ChatGPT, Claude…)': 'My subscription (ChatGPT, Claude…)',
  'Réglages IA': 'AI settings', 'Administration': 'Administration', 'Licence et édition': 'License & edition', 'Rechercher les mises à jour': 'Check for updates',
  'Statut conversion Office': 'Office conversion status', 'À propos': 'About', 'Remplacer': 'Replace', 'Tout remplacer': 'Replace all',
  'Créez, modifiez, organisez et numérisez vos documents de cours — sans connexion.': 'Create, edit, organize and scan your teaching documents — offline.',
  'Ouvrir un fichier': 'Open a file', 'PDF, Word, PowerPoint, Excel, images…': 'PDF, Word, PowerPoint, Excel, images…', 'Document vierge': 'Blank document',
  'Feuille A4 pour une fiche ou une évaluation': 'A4 sheet for a worksheet or a test', 'Numériser un polycopié puis le rendre modifiable': 'Scan a handout and make it editable',
  'Photos → PDF': 'Photos → PDF', 'Photos de tableau, de cahier, de documents': 'Photos of boards, notebooks, documents', "Astuce : glissez-déposez vos fichiers n'importe où dans la fenêtre.": 'Tip: drag and drop your files anywhere in the window.',
  'Propriétés': 'Properties', 'Couleur': 'Color', 'Police': 'Font', 'Gras': 'Bold', 'Italique': 'Italic', 'Taille du texte': 'Text size', 'Épaisseur stylo': 'Pen width',
  'Aucun élément sélectionné': 'No item selected', 'Texte reconnu (OCR)': 'Recognized text (OCR)', 'Copier le texte': 'Copy text', 'Affichage': 'View', 'Ajuster': 'Fit',
  'Prêt.': 'Ready.', '⚙ Propriétés': '⚙ Properties', '🛡️ Poste géré': '🛡️ Managed device', 'Contenu envoyé': 'Content sent', 'Page courante': 'Current page',
  'Pages sélectionnées': 'Selected pages', 'Tout le document': 'Whole document', 'Envoyer': 'Send', '■ Arrêter': '■ Stop', 'Copier': 'Copy',
  'Insérer dans le document': 'Insert into document', 'Exporter en Word': 'Export to Word', 'Coller la réponse': 'Paste answer', 'Traitement…': 'Working…',
  'Rechercher…': 'Find…', 'Remplacer par…': 'Replace with…', 'Valider': 'OK', 'Créer': 'Create', 'Continuer': 'Continue', 'Nouvel onglet': 'New tab',
  'Corriger des copies': 'Grade papers', 'Évaluations différenciées': 'Differentiated tests', 'Publipostage': 'Mail merge', 'Classe connectée': 'Connected classroom',
  'Version adaptée (DYS)': 'Accessible version (dyslexia)', 'Lire à voix haute': 'Read aloud', 'Version bilingue': 'Bilingual version', 'IA locale (hors ligne)': 'Local AI (offline)',
  'Édition Communauté': 'Community edition', 'Licences des composants': 'Component licenses', 'Code source': 'Source code', 'Politique de marque': 'Trademark policy'
};
let LANG = 'fr';
const EN_X = () => window.EN_EXTRA || {};
window.__trLine = (s) => tr(s);
/** Traduction d'une ligne : dictionnaire, messages composés, puis « Début connu : détail ». */
function tr(s) {
  const k = String(s).replace(/\s+/g, ' ').trim(); if (!k) return null;
  const X = EN_X(); if (EN[k]) return EN[k]; if (X[k]) return X[k];
  for (const [re, rep] of window.EN_PATTERNS || []) if (re.test(k)) return k.replace(re, rep);
  const i = k.indexOf(' : ');
  if (i > 3) {
    const rest = k.slice(i + 3); const head = k.slice(0, i + 2); const t = EN[head] || X[head]; if (t) return t + ' ' + (tr(rest) || rest);
    const h2 = k.slice(0, i); const t2 = EN[h2] || X[h2]; if (t2) return t2 + ': ' + (tr(rest) || rest);
  }
  return null;
}
/** Texte sur plusieurs lignes (info-bulles, alertes) : chaque ligne est traduite. */
function trText(s) {
  if (LANG !== 'en' || s == null) return s;
  const lines = String(s).split('\n'); let changed = false;
  const out = lines.map((l) => { const t = tr(l); if (t) { changed = true; return l.replace(l.trim(), t); } return l; });
  return changed ? out.join('\n') : s;
}
const ORIG = []; // [référence faible, attribut ou null, texte français, texte anglais] : retour au français sans recharger
const ATTRS = ['title', 'placeholder', 'aria-label'];
const SKIP = '#pageBox,#thumbs,#aiOut,#textLayer,#pageStack';
function translateNode(root) {
  if (LANG !== 'en' || !root) return;
  const walk = (el) => {
    if (el.nodeType === 3) {
      const p = el.parentElement; if (!p || p.tagName === 'TEXTAREA' || p.closest(SKIP) || p.isContentEditable) return;
      const t = trText(el.nodeValue); if (t !== el.nodeValue) { ORIG.push([new WeakRef(el), null, el.nodeValue, t]); el.nodeValue = t; } return;
    }
    if (el.nodeType !== 1 || el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.closest(SKIP) || el.isContentEditable) return;
    if (el.tagName === 'BUTTON' && el.querySelector('br')) { // libellé sur deux lignes : traduit d'un bloc
      const i = el.querySelector('i'); const label = [...el.childNodes].filter((n) => n !== i).map((n) => (n.nodeName === 'BR' ? ' ' : n.textContent)).join('');
      const t = tr(label); if (t) { ORIG.push([new WeakRef(el), '#html', el.innerHTML, null]); el.innerHTML = ''; if (i) el.appendChild(i); el.appendChild(document.createTextNode(t)); ORIG[ORIG.length - 1][3] = el.innerHTML; }
    }
    for (const at of ATTRS) { const v = el.getAttribute(at); if (!v) continue; const t = trText(v); if (t !== v) { ORIG.push([new WeakRef(el), at, v, t]); el.setAttribute(at, t); } }
    el.childNodes.forEach(walk);
  };
  walk(root);
}
function restoreFrench() {
  for (const [ref, at, fr, en] of ORIG.splice(0)) {
    const n = ref.deref(); if (!n || !n.isConnected) continue;
    if (at === null) { if (n.nodeValue === en) n.nodeValue = fr; } else if (at === '#html') { if (n.innerHTML === en) n.innerHTML = fr; } else if (n.getAttribute(at) === en) n.setAttribute(at, fr);
  }
}
const I18N_OBS = new MutationObserver((ms) => {
  if (LANG !== 'en') return;
  for (const m of ms) {
    if (m.type === 'childList') m.addedNodes.forEach((n) => translateNode(n));
    else if (m.type === 'characterData') translateNode(m.target);
    else if (m.type === 'attributes') { const v = m.target.getAttribute(m.attributeName); const t = v && trText(v); if (t && t !== v && !m.target.closest(SKIP)) { ORIG.push([new WeakRef(m.target), m.attributeName, v, t]); m.target.setAttribute(m.attributeName, t); } }
  }
});
// Alertes et confirmations de Windows : traduites elles aussi
const _alert = window.alert.bind(window); const _confirm = window.confirm.bind(window);
window.alert = (m) => _alert(trText(m));
window.confirm = (m) => _confirm(trText(m));
function applyLanguage() {
  I18N_OBS.disconnect();
  if (LANG === 'en') { translateNode(document.body); I18N_OBS.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS }); }
  else restoreFrench();
  const b = document.querySelector('#langBtn'); if (b) { b.textContent = LANG === 'en' ? '🌐 EN' : '🌐 FR'; b.title = LANG === 'en' ? 'Interface language: English\nClick for French' : 'Langue de l\'interface : français\nCliquer pour l\'anglais'; }
}
/** Changement de langue immédiat : aucun rechargement, les documents ouverts sont conservés. */
function setLanguage(l) {
  if (l !== 'en' && l !== 'fr') return; store.set('edupdf.lang', l);
  if (l === LANG) return; LANG = l; applyLanguage();
  msg(l === 'en' ? 'Interface in English.' : 'Interface en français.');
}
async function languageDialog() {
  const r = await modal('Langue de l\'interface / Interface language', '<p>Choisissez la langue de toute l\'interface : menus, boutons, info-bulles, fenêtres et messages. / Choose the language of the whole interface: menus, buttons, tooltips, dialogs and messages.</p><p class="muted">Le changement est immédiat, vos documents ouverts sont conservés. Raccourci : bouton 🌐 en bas de la fenêtre. / The change is immediate and your open documents are kept. Shortcut: 🌐 button at the bottom of the window.</p>',
    [['Annuler', null], ['English', 'en'], ['Français', 'fr', true]]);
  if (r) setLanguage(r);
}

// ================================================================ Branchement dans l'interface
Object.assign(actions, {
  grading: gradingDialog, diffEval: diffEvalDialog, mailMerge: mailMergeDialog, dys: dysDialog, speak: speakToggle, classroom: classroomDialog,
  aiLocal: aiLocalDialog, equation: equationDialog, bilingual: bilingualDialog, language: languageDialog
});
Object.assign(FEATURE_OF.act, { grading: 'edit', diffEval: 'ai', mailMerge: 'save', dys: 'convert', classroom: 'save', aiLocal: 'ai', equation: 'edit', bilingual: 'ai' });
(function initFeatures() {
  LANG = store.get('edupdf.lang') || ((navigator.language || 'fr').startsWith('fr') ? 'fr' : 'en');
  document.documentElement.lang = LANG;
  a11y(); applyPolicy(); renderQat();
  applyLanguage();
  const lb = document.querySelector('#langBtn'); if (lb) lb.onclick = () => setLanguage(LANG === 'en' ? 'fr' : 'en');
  window.__features = { setLanguage, trText, getLang: () => LANG, gradingParseScale, GR, gradingApply, gradingTotals, diffEvalBuild, toGift, mergeRows, dysPdf, texToPng, bilingualPdf, INK, tr, aiAsk, parseJson };
})();
