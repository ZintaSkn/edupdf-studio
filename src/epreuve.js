// SknEDU-studio — épreuve en ligne.
// L'épreuve est déposée, chiffrée, sur le service de l'éditeur et reste ouverte jusqu'à la date limite, même quand ce PC est
// éteint. Les élèves l'ouvrent par un lien dans tout navigateur (Windows, Mac, iPad, iPhone, Android), répondent en ligne ou
// envoient leur copie (PDF, ou photos si l'enseignant le permet). Chaque copie est chiffrée pour l'enseignant seul.
// Le logiciel relève les copies dès qu'il est ouvert, les enregistre en PDF figé et verrouillé, puis les supprime du service.
//
// Secrets (jamais dans les réglages en clair) : clé du lien, clé privée des copies et clé de gestion de l'épreuve sur le
// service, chiffrés sur ce PC (userData/epreuves/<n°>/secret.bin).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mu = require('./mu');
const E = require('./e2e');
const CP = require('./copies');

let A = null; let timer = null; const running = new Map(); const fieldCache = new Map();
const ID_RE = /^[A-Za-z0-9_-]{22}$/; const CID_RE = /^[0-9a-f]{32}$/;
const MAX_PDF = 40 * 1048576; const MAX_FILL_PAGES = 40; const PART = 4 * 1048576; const MAX_UPLOAD = 25 * 1048576;
const POLL_MS = 10 * 60000; const GRACE_MS = 2 * 60000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { UserError } = CP;

const root = () => path.join(A.app.getPath('userData'), 'epreuves');
const dirOf = (id) => { if (!ID_RE.test(id)) throw new Error('Épreuve inconnue.'); return path.join(root(), id); };
const records = () => { const e = A.readSettings().epreuves; return Array.isArray(e) ? e.filter((x) => x && typeof x.id === 'string' && ID_RE.test(x.id)) : []; };
function saveRecords(fn) { const s = A.readSettings(); s.epreuves = fn(Array.isArray(s.epreuves) ? s.epreuves : []).filter(Boolean); A.writeSettings(s); }
const recordOf = (id) => { const r = records().find((x) => x.id === id); if (!r) throw new Error('Épreuve inconnue.'); return r; };
const update = (id, patch) => saveRecords((l) => l.map((x) => (x && x.id === id ? { ...x, ...patch } : x)));
function secretOf(id) { return JSON.parse(A.unprotect(fs.readFileSync(path.join(dirOf(id), 'secret.bin'))).toString('utf8')); }
function writeSecret(id, o) { fs.writeFileSync(path.join(dirOf(id), 'secret.bin'), A.protect(Buffer.from(JSON.stringify(o), 'utf8')), { mode: 0o600 }); }
const linkOf = (sec) => `${sec.api}/e/${sec.id}#${sec.k}`;
function indexOf(id) { try { const ix = JSON.parse(fs.readFileSync(path.join(dirOf(id), 'copies.json'), 'utf8')); return Array.isArray(ix.copies) ? ix : { copies: [] }; } catch { return { copies: [] }; } }
function writeIndex(id, ix) { const f = path.join(dirOf(id), 'copies.json'); fs.writeFileSync(f + '.tmp', JSON.stringify(ix)); fs.renameSync(f + '.tmp', f); }
/** Adresse du service : HTTPS obligatoire (sauf service local d'essai). */
function serviceUrl() {
  const b = String(A.relayUrl() || '').replace(/\/+$/, '');
  if (!/^https:\/\/[^/\s]+$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(b)) throw new Error('Service en ligne non configuré.');
  return b;
}
/** Appel du service avec la clé de gestion de l'épreuve. */
const call = (sec, method, sub, body, headers = {}) => A.fetch(`${sec.api}/e/${sec.id}${sub}`, { method, headers: { Authorization: 'Bearer ' + sec.host, ...headers }, body });

// ---------- Publication ----------
async function publish({ bytes, title, message, fileName, deadline, fill, photos, layout }, progress = () => {}) {
  A.premium('Épreuve en ligne'); A.guard('save', 'Épreuve en ligne');
  const pdf = Buffer.from(bytes || []); if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new UserError('Document illisible.');
  if (pdf.length > MAX_PDF) throw new UserError('Document trop volumineux pour une épreuve en ligne (40 Mo au plus) : réduisez sa taille (Fichier › Réduire la taille), puis réessayez.');
  const now = Date.now(); const d = Math.floor(Number(deadline));
  if (!(d >= now + 10 * 60000)) throw new UserError('La date limite doit être au moins 10 minutes plus tard.');
  if (d > now + 31 * 86400000) throw new UserError('La date limite ne peut pas dépasser 31 jours.');
  const base = serviceUrl();
  progress('Préparation de l\'épreuve…');
  const pages = await mu.pageSizes(pdf); if (!pages.length) throw new UserError('Document vide.');
  const canFill = fill !== false && pages.length <= MAX_FILL_PAGES;
  const fields = canFill ? await mu.formFields(pdf).catch(() => []) : [];
  let docx = null; if (Array.isArray(layout) && layout.length && A.docx) { try { docx = Buffer.from(await A.docx(layout)); } catch { docx = null; } if (docx && docx.length > MAX_PDF) docx = null; }
  progress('Création de l\'épreuve sur le service…');
  let j = null; let res;
  try { res = await A.fetch(base + '/e/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deadline: d }) }); j = await res.json().catch(() => null); }
  catch { throw new UserError('Le service en ligne est injoignable : vérifiez la connexion Internet de ce PC.'); }
  if (res.status === 429) throw new UserError('Trop d\'épreuves créées depuis ce réseau : réessayez plus tard.');
  if (res.status !== 200 || !j || !ID_RE.test(j.id || '') || !/^[A-Za-z0-9_-]{20,100}$/.test(j.hostKey || '')) throw new UserError('Le service en ligne n\'a pas pu créer l\'épreuve : réessayez plus tard.');
  const k = crypto.randomBytes(32); const kp = E.teacherKeys();
  const sec = { v: 1, id: j.id, api: base, host: j.hostKey, k: k.toString('base64url'), priv: kp.priv.toString('base64') };
  const dir = dirOf(j.id); fs.mkdirSync(path.join(dir, 'copies'), { recursive: true });
  writeSecret(j.id, sec); fs.writeFileSync(path.join(dir, 'epreuve.pdf'), pdf);
  const rec = { id: j.id, title: String(title || 'Épreuve').slice(0, 120), message: String(message || '').slice(0, 400), fileName: path.basename(String(fileName || 'epreuve.pdf')).replace(/["\\<>]/g, '_').slice(0, 120),
    deadline: j.deadline, contentUntil: j.contentUntil, keepUntil: j.keepUntil, created: now, pages: pages.length, fill: canFill, fields: fields.length, photos: photos !== false, word: !!docx, state: 'envoi' };
  saveRecords((l) => l.filter((x) => x && x.id !== j.id).concat([rec]));
  try {
    const put = async (name, data) => {
      const body = E.seal(k, `e:${j.id}:${name}`, data);
      for (let a = 0; ; a++) {
        let r = null; try { r = await call(sec, 'PUT', '/b/' + name, body, { 'Content-Type': 'application/octet-stream' }); } catch { r = null; }
        if (r && r.status === 204) return;
        if (r && r.status === 507) throw new UserError('Le service des épreuves en ligne est plein pour le moment : réessayez plus tard.');
        if ((r && r.status >= 400 && r.status < 500) || a >= 2) throw new UserError('L\'envoi de l\'épreuve a échoué : vérifiez la connexion Internet de ce PC, puis réessayez.');
        await sleep(1500 * (a + 1));
      }
    };
    const split = (buf) => { const out = []; for (let i = 0; i < buf.length; i += PART) out.push(buf.subarray(i, i + PART)); return out; };
    const pdfParts = split(pdf); const docxParts = docx ? split(docx) : [];
    for (let i = 0; i < pdfParts.length; i++) { progress(`Envoi du sujet… ${i + 1} / ${pdfParts.length}`); await put('pdf.' + i, pdfParts[i]); }
    for (let i = 0; i < docxParts.length; i++) { progress(`Envoi de la version Word… ${i + 1} / ${docxParts.length}`); await put('docx.' + i, docxParts[i]); }
    if (canFill) for (let i = 0; i < pages.length; i++) { progress(`Envoi des pages à remplir… ${i + 1} / ${pages.length}`); await put('p' + i, await CP.queued(() => mu.pageJpeg(pdf, i))); }
    const info = { v: 1, title: rec.title, message: rec.message, fileName: rec.fileName, deadline: j.deadline, pages: canFill ? pages : [], fill: canFill, fields, photos: rec.photos, word: !!docx,
      pdfParts: pdfParts.length, docxParts: docxParts.length, pub: kp.pub.toString('base64url'), maxUpload: MAX_UPLOAD };
    progress('Ouverture de l\'épreuve…');
    await put('info', Buffer.from(JSON.stringify(info), 'utf8'));
    const o = await call(sec, 'POST', '/open'); if (o.status !== 204) throw new UserError('L\'épreuve n\'a pas pu être ouverte : réessayez.');
  } catch (e) { // épreuve incomplète : supprimée du service et du logiciel
    try { await call(sec, 'DELETE', ''); } catch { /* le service l'effacera à son échéance */ }
    saveRecords((l) => l.filter((x) => x && x.id !== j.id)); fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  update(j.id, { state: 'ouverte' });
  A.logEvent('export', { action: 'Épreuve en ligne publiée', pages: pages.length, zones: fields.length });
  if (A.audit) A.audit('epreuve_publiee', { pages: pages.length });
  schedule(); notify();
  return { id: j.id, ...(await linkInfo(j.id)), fillOff: fill !== false && !canFill, wordOff: Array.isArray(layout) && layout.length > 0 && !docx, fields: fields.length };
}

// ---------- Relève des copies ----------
async function fieldsOf(id) {
  if (!fieldCache.has(id)) fieldCache.set(id, await mu.formFields(fs.readFileSync(path.join(dirOf(id), 'epreuve.pdf'))).catch(() => []));
  return fieldCache.get(id);
}
function fileStamp(ms) { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}h${p(d.getMinutes())}`; }
function storeCopy(id, eleve, at, buf) {
  const dir = path.join(dirOf(id), 'copies'); fs.mkdirSync(dir, { recursive: true });
  const base = `${eleve} - ${fileStamp(at)}`; let f = path.join(dir, base + '.pdf');
  for (let i = 2; fs.existsSync(f) && i < 100; i++) f = path.join(dir, `${base} (${i}).pdf`);
  fs.writeFileSync(f, buf); return f;
}
/** Transforme une copie reçue (déchiffrée) en PDF verrouillé. */
async function makeCopy(id, rec, q) {
  const head = q.head || {};
  if (head.kind === 'fill') {
    if (!rec.fill) throw new UserError('Réponses en ligne reçues alors que l\'épreuve ne les prévoit pas.');
    const notes = CP.cleanNotes(head.items, rec.pages); const answers = CP.cleanAnswers(head.answers, await fieldsOf(id));
    if (!notes.length && !Object.keys(answers).length) throw new UserError('Copie vide.');
    return { how: 'en ligne', pdf: await CP.queued(() => CP.lockedCopy({ base: fs.readFileSync(path.join(dirOf(id), 'epreuve.pdf')), notes, answers })) };
  }
  if (head.kind === 'files') {
    const files = CP.splitFiles(head.files, q.body); if (!files.length) throw new UserError('Aucun fichier dans la copie.');
    const pdf = await CP.queued(() => CP.lockedCopy({ files, photos: rec.photos, heic: A.heic }));
    return { how: files.length > 1 ? 'photos' : CP.kindOf(files[0].data) === 'pdf' ? 'PDF' : 'photo', pdf };
  }
  throw new UserError('Copie d\'un type inconnu.');
}
async function collectOne(id) {
  const rec = recordOf(id); if (rec.state !== 'ouverte') return { added: 0, refused: 0 };
  const sec = secretOf(id); const ix = indexOf(id); let added = 0; let refused = 0;
  let r; try { r = await call(sec, 'GET', '/c'); } catch { throw new UserError('Le service en ligne est injoignable : vérifiez la connexion Internet de ce PC.'); }
  if (r.status === 404) { update(id, { state: 'terminee', ended: Date.now() }); notify(); return { added, refused }; } // effacée par le service (échéance)
  if (r.status !== 200) throw new UserError('La relève des copies a échoué : réessayez plus tard.');
  const list = (await r.json().catch(() => ({}))).copies || [];
  for (const c of list.slice(0, 300)) {
    if (!CID_RE.test(String(c && c.id))) continue;
    if (!ix.copies.some((x) => x.cid === c.id)) {
      let g; try { g = await call(sec, 'GET', '/c/' + c.id); } catch { break; } // connexion perdue : la suite à la prochaine relève
      if (g.status !== 200) continue;
      const env = Buffer.from(await g.arrayBuffer()); const at = Number(c.at) || Date.now();
      const entry = { cid: c.id, at, seen: false };
      try {
        const q = E.unframe(E.openCopy(Buffer.from(sec.priv, 'base64'), `c:${id}:${c.id}`, env));
        entry.eleve = CP.cleanStudent(q.head && q.head.eleve) || 'Élève sans nom';
        const made = await makeCopy(id, rec, q); entry.how = made.how; entry.file = storeCopy(id, entry.eleve, at, made.pdf); entry.ok = true; added++;
      } catch (e) {
        entry.ok = false; refused++;
        entry.error = e instanceof UserError ? e.message : 'Copie illisible (fichier endommagé, protégé, ou envoi altéré).';
        try { const raw = path.join(dirOf(id), 'non-traitees'); fs.mkdirSync(raw, { recursive: true }); fs.writeFileSync(path.join(raw, c.id + '.bin'), env); } catch { /* */ } // gardée, chiffrée, pour un nouvel essai
      }
      ix.copies.push(entry); writeIndex(id, ix);
    }
    try { await call(sec, 'DELETE', '/c/' + c.id); } catch { /* supprimée à la prochaine relève */ } // relevée : effacée du service
  }
  const patch = { lastCollect: Date.now() };
  if (Date.now() > rec.deadline + GRACE_MS + 60000 && !list.length) { // terminée et tout est relevé : l'épreuve est effacée du service
    try { await call(sec, 'DELETE', ''); } catch { /* le service l'effacera à son échéance */ }
    patch.state = 'terminee'; patch.ended = Date.now();
  }
  update(id, patch);
  if (added || refused || patch.state) notify();
  return { added, refused };
}
/** Relève d'une épreuve, ou de toutes les épreuves ouvertes ; une seule relève à la fois par épreuve. */
async function collect(id) {
  const ids = id ? [id] : records().filter((x) => x.state === 'ouverte').map((x) => x.id);
  const out = { added: 0, refused: 0, errors: [] };
  for (const i of ids) {
    if (!running.has(i)) running.set(i, collectOne(i).finally(() => running.delete(i)));
    try { const r = await running.get(i); out.added += r.added; out.refused += r.refused; } catch (e) { out.errors.push(e instanceof UserError ? e.message : 'relève impossible'); }
  }
  return out;
}
function schedule() {
  const open = records().some((x) => x.state === 'ouverte');
  if (open && !timer) { timer = setInterval(() => { collect().catch(() => {}); }, POLL_MS); if (timer.unref) timer.unref(); }
  if (!open && timer) { clearInterval(timer); timer = null; }
}

// ---------- Pour l'interface ----------
async function linkInfo(id) {
  const link = linkOf(secretOf(id));
  const QR = require('qrcode');
  return { link, qr: await QR.toDataURL(link, { margin: 1, width: 320, color: { dark: '#001871', light: '#ffffff' } }) };
}
function status() {
  const now = Date.now();
  const items = records().map((r) => {
    const ix = indexOf(r.id); const ok = ix.copies.filter((c) => c.ok);
    return { id: r.id, title: r.title, deadline: r.deadline, keepUntil: r.keepUntil, created: r.created, state: r.state, pages: r.pages, fill: r.fill, fields: r.fields, photos: r.photos, word: r.word,
      lastCollect: r.lastCollect || 0, closed: now > r.deadline, copies: ok.length, nouvelles: ok.filter((c) => !c.seen).length,
      refusees: ix.copies.filter((c) => !c.ok).map((c) => ({ eleve: c.eleve || '?', at: c.at, error: c.error })),
      list: ok.map((c) => ({ eleve: c.eleve, at: c.at, how: c.how, seen: !!c.seen })) };
  }).sort((a, b) => b.created - a.created);
  return { items, nouvelles: items.reduce((n, x) => n + x.nouvelles, 0) };
}
function notify() { const w = A.getWin(); if (w && !w.isDestroyed()) w.webContents.send('epreuve-update', status()); }
/** Copies à ouvrir : chemins autorisés un par un pour l'interface (Zero Trust), marquées « vues ». */
function copies({ id, onlyNew }) {
  const ix = indexOf(id); const out = [];
  for (const c of ix.copies) {
    if (!c.ok || !c.file || (onlyNew && c.seen) || !fs.existsSync(c.file)) continue;
    A.grant(c.file); out.push({ eleve: c.eleve, file: c.file, at: c.at }); c.seen = true;
  }
  if (out.length) { writeIndex(id, ix); notify(); }
  return out;
}
async function close({ id }) {
  const rec = recordOf(id);
  if (rec.state === 'ouverte') { await collect(id); }
  const sec = secretOf(id); let pending = 0;
  try { const r = await call(sec, 'GET', '/c'); if (r.status === 200) pending = ((await r.json()).copies || []).length; } catch { throw new UserError('Le service en ligne est injoignable : vérifiez la connexion Internet de ce PC.'); }
  if (pending) throw new UserError('Des copies sont encore en cours de relève : réessayez dans un instant.');
  try { await call(sec, 'DELETE', ''); } catch { /* */ }
  update(id, { state: 'close', ended: Date.now() }); schedule(); notify();
  return status();
}
/** Retire l'épreuve du logiciel ; les copies déjà reçues restent dans leur dossier. */
async function remove({ id }) {
  const rec = recordOf(id);
  if (rec.state === 'ouverte') { try { await call(secretOf(id), 'DELETE', ''); } catch { /* le service l'effacera à son échéance */ } }
  try { fs.rmSync(path.join(dirOf(id), 'secret.bin'), { force: true }); } catch { /* */ }
  saveRecords((l) => l.filter((x) => x && x.id !== id)); fieldCache.delete(id); schedule(); notify();
  return status();
}

function init(deps) {
  A = deps;
  const h = (name, fn) => A.ipcMain.handle(name, (e, a) => fn(a || {}, e));
  h('epreuve-list', () => status());
  h('epreuve-publish', (a, e) => publish(a, (t) => { try { e.sender.send('epreuve-progress', t); } catch { /* fenêtre fermée */ } }));
  h('epreuve-link', ({ id }) => linkInfo(id));
  h('epreuve-collect', async ({ id }) => { const r = await collect(id); return { ...r, ...status() }; });
  h('epreuve-copies', (a) => copies(a));
  h('epreuve-close', (a) => close(a));
  h('epreuve-remove', (a) => remove(a));
  h('epreuve-open-folder', ({ id }) => { const d = path.join(dirOf(id), 'copies'); if (fs.existsSync(d)) A.shell.openPath(d); return fs.existsSync(d); });
  schedule();
  setTimeout(() => { if (records().some((x) => x.state === 'ouverte')) collect().catch(() => {}); }, process.env.EDUPDF_SELFTEST ? 3600000 : 20000).unref?.(); // relève au démarrage
}

module.exports = { init, _test: { secretOf, collect, status } };
