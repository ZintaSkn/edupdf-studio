// SknEDU-studio — classe connectée : partage d'un document aux élèves et récupération de leurs copies.
// Deux chemins, au choix de l'enseignant :
//  - le réseau local (Wi-Fi de la classe), sans Internet : ce PC sert directement les élèves, derrière un jeton aléatoire ;
//  - à distance (maison, 4G) : les élèves passent par le relais de l'éditeur, qui ne fait que transporter des messages
//    chiffrés de bout en bout (AES-256-GCM) — la clé ne figure que dans le lien remis aux élèves, après « # ».
// Le lien s'ouvre dans tout navigateur (Windows, Mac, iPad, iPhone, Android).
// L'élève reçoit un document modifiable : PDF, Word (.docx) ou page à remplir dans le navigateur.
// Toute copie rendue est enregistrée en PDF figé et verrouillé : champs et réponses fondus dans les pages,
// modification interdite (AES-256, mot de passe de modification aléatoire jamais conservé).
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mu = require('./mu');
const SP = require('./student-page');

let A = null; let server = null; let session = null; let chain = Promise.resolve();

const MAX_UPLOAD = 40 * 1048576; const MAX_REMOTE_UPLOAD = 25 * 1048576; const MAX_FILES = 20; const MAX_FILL_PAGES = 40; const MAX_NOTES = 400; const MAX_COPIES = 400;
const { esc, page } = SP;
const cleanStudent = (s) => String(s || '').replace(/[^\p{L}\p{N} '\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 80);
class UserError extends Error {}
/** Une seule copie traitée à la fois : le moteur PDF travaille dans le processus principal. */
function queued(fn) { const p = chain.then(fn); chain = p.catch(() => {}); return p; }

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !/^169\.254\./.test(a.address)) out.push({ name, address: a.address });
  }
  // priorité aux réseaux privés habituels (Wi-Fi / Ethernet)
  return out.sort((x, y) => (/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(y.address) ? 1 : 0) - (/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(x.address) ? 1 : 0));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('trop gros')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
  });
}
/** Lecture minimale d'un formulaire multipart : champs texte, et fichiers (plusieurs possibles sous le même nom, ex. photos d'une copie). */
function parseMultipart(buf, boundary) {
  const parts = {}; const sep = Buffer.from('--' + boundary);
  let pos = buf.indexOf(sep);
  while (pos >= 0) {
    const next = buf.indexOf(sep, pos + sep.length); if (next < 0) break;
    const part = buf.subarray(pos + sep.length + 2, next - 2);
    const he = part.indexOf('\r\n\r\n'); if (he > 0) {
      const head = part.subarray(0, he).toString('utf8'); const body = part.subarray(he + 4);
      const name = /name="([^"]+)"/.exec(head); const file = /filename="([^"]*)"/.exec(head);
      if (name && file) { const f = { filename: file[1], data: body }; if (!parts[name[1]]) parts[name[1]] = f; (parts[name[1] + '[]'] = parts[name[1] + '[]'] || []).push(f); }
      else if (name) parts[name[1]] = body.toString('utf8');
    }
    pos = next;
  }
  return parts;
}

// ---------- Copie rendue : toujours un PDF figé et verrouillé ----------
const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
/** Type réel du fichier, d'après son contenu (jamais d'après son nom). */
function kindOf(d) {
  if (!d || d.length < 12) return null;
  if (d.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (d[0] === 0xFF && d[1] === 0xD8 && d[2] === 0xFF) return 'jpg';
  if (d.subarray(0, 8).equals(PNG)) return 'png';
  if (d.subarray(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|hevc|mif1|msf1|heif)$/.test(d.subarray(8, 12).toString('latin1'))) return 'heic';
  if (d[0] === 0x50 && d[1] === 0x4B) return 'office';
  return null;
}
async function flatten(d) {
  const k = kindOf(d);
  if (k === 'pdf') return mu.flattenToPdf(d, 'application/pdf');
  if (k === 'jpg' || k === 'png') return mu.flattenToPdf(d, 'photo.' + k);
  if (k === 'heic') return mu.flattenToPdf(await A.heic(d), 'photo.jpg');
  if (k === 'office') throw new UserError('Un document Word ne peut pas être rendu tel quel : enregistrez-le en PDF (Fichier › Enregistrer sous › PDF), puis envoyez le PDF.');
  throw new UserError('Choisissez un fichier PDF ou une photo de votre copie.');
}
/** Plusieurs fichiers (photos d'une copie de plusieurs pages) : réunis en un seul PDF, puis verrouillé. */
async function lockedCopy(s, files, notes) {
  const flats = [];
  if (notes) flats.push(await mu.flattenToPdf(s.bytes, 'application/pdf', notes));
  else for (const f of files) { try { flats.push(await flatten(f.data)); } catch (e) { if (e instanceof UserError) throw e; throw new UserError('Fichier illisible ou protégé par un mot de passe : vérifiez-le, puis envoyez-le à nouveau.'); } }
  let pdf = flats[0];
  if (flats.length > 1) {
    const { PDFDocument } = require('pdf-lib'); const out = await PDFDocument.create();
    for (const b of flats) { const d = await PDFDocument.load(b); (await out.copyPages(d, d.getPageIndices())).forEach((p) => out.addPage(p)); }
    pdf = await out.save();
  }
  return Buffer.from(await mu.sealPdf(pdf));
}
function store(s, eleve, buf, how) {
  const base = `${eleve} - ${new Date().toISOString().slice(11, 19).replace(/:/g, 'h')}`; let file = path.join(s.dir, base + '.pdf');
  for (let i = 2; fs.existsSync(file) && i < 50; i++) file = path.join(s.dir, `${base} (${i}).pdf`);
  fs.writeFileSync(file, buf); s.received.push({ eleve, file, at: Date.now(), how }); notify();
}

// ---------- Ce que l'élève peut demander (identique par le réseau local et par le relais) ----------
/** Copie envoyée en fichiers (PDF, photos). Rend { code, error? , eleve? }. */
async function submitFiles(s, rawName, files, remote) {
  if (!s.collect) return { code: 404, error: 'Ce partage ne reçoit pas de copies.' };
  if (s.received.length >= MAX_COPIES) return { code: 429, error: 'Trop de copies reçues pour ce partage : prévenez l\'enseignant.' };
  const eleve = cleanStudent(rawName); const list = (files || []).filter((x) => x && x.data && x.data.length).slice(0, MAX_FILES);
  if (!eleve || !list.length) return { code: 400, error: 'Indiquez votre nom et choisissez un fichier PDF ou des photos de votre copie.' };
  let locked; try { locked = await queued(() => lockedCopy(s, list, null)); } catch (e) { return { code: 400, error: e instanceof UserError ? e.message : 'Copie illisible : vérifiez le fichier, puis envoyez-le à nouveau.' }; }
  if (session !== s) return { code: 410, error: 'Le partage est terminé.' };
  store(s, eleve, locked, (list.length > 1 ? 'photos' : kindOf(list[0].data) === 'pdf' ? 'pdf' : 'photo') + (remote ? ' · à distance' : ''));
  return { code: 200, eleve };
}
/** Copie remplie dans le navigateur : { eleve, items:[{ p, x, y, w, h, fs, text }] }. */
async function submitFill(s, d, remote) {
  if (!s.collect || !s.fill) return { code: 404, error: 'Ce partage ne reçoit pas de copies remplies en ligne.' };
  if (s.received.length >= MAX_COPIES) return { code: 429, error: 'Trop de copies reçues pour ce partage : prévenez l\'enseignant.' };
  const eleve = cleanStudent(d && d.eleve); const num = (v) => (typeof v === 'number' && isFinite(v) ? v : NaN); let total = 0;
  const notes = (d && Array.isArray(d.items) ? d.items : []).slice(0, MAX_NOTES).map((t) => ({ p: Math.floor(num(t && t.p)), x: num(t && t.x), y: num(t && t.y), w: num(t && t.w), h: num(t && t.h), fs: num(t && t.fs),
    text: String((t && t.text) || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').slice(0, 2000).trim() }))
    .filter((t) => t.text && t.p >= 0 && t.p < s.pages.length && t.x >= 0 && t.x <= 1 && t.y >= 0 && t.y <= 1 && t.w > 0 && t.w <= 1 && t.h > 0 && t.h <= 1 && t.fs >= 0.006 && t.fs <= 0.08 && (total += t.text.length) <= 60000);
  if (!eleve) return { code: 400, error: 'Indiquez votre nom et votre prénom.' };
  if (!notes.length) return { code: 400, error: 'Écrivez au moins une réponse sur le document.' };
  let locked; try { locked = await queued(() => lockedCopy(s, null, notes)); } catch { return { code: 500, error: 'La copie n\'a pas pu être créée : prévenez l\'enseignant.' }; }
  if (session !== s) return { code: 410, error: 'Le partage est terminé.' };
  store(s, eleve, locked, 'en ligne' + (remote ? ' · à distance' : ''));
  return { code: 200, eleve };
}
/** Image d'une page : rendue une fois, puis gardée pour toute la classe. */
function pageImage(s, i) {
  if (!s.images[i]) { s.images[i] = queued(() => mu.pageJpeg(s.bytes, i)); s.images[i].catch(() => { s.images[i] = null; }); }
  return s.images[i];
}
const infoOf = (s) => ({ ok: true, title: s.title, message: s.message, fill: s.fill, pages: s.fill ? s.pages : [], collect: s.collect, word: !!s.docx, fileName: s.fileName, maxUpload: MAX_REMOTE_UPLOAD });

// ---------- Réseau de la classe : pages servies directement par ce PC ----------
function homePage(base) {
  const s = session;
  return page(s.title, `<div class="card"><h2>${esc(s.title)}</h2><p>${esc(s.message || 'Complétez le document, puis rendez votre copie.')}</p>
    ${s.fill ? `<a class="btn" href="${base}/remplir">✏️ Remplir en ligne</a>` : ''}
    <a class="btn${s.fill ? ' alt' : ''}" href="${base}/document.pdf" download="${esc(s.fileName)}">📥 PDF</a>
    ${s.docx ? `<a class="btn alt" href="${base}/document.docx" download="${esc(s.fileName.replace(/\.pdf$/i, '') + '.docx')}">📥 Word (.docx)</a>` : ''}
    ${s.fill ? '<p class="muted">« Remplir en ligne » : écrivez vos réponses directement sur le document, sans rien installer.</p>' : ''}</div>
    ${s.collect ? `<div class="card"><h3>Rendre ma copie</h3><form method="post" action="${base}/rendre" enctype="multipart/form-data">
    <label>Nom et prénom<input name="eleve" required maxlength="80" autocomplete="name"></label>
    <label>Copie (PDF, ou photos de la copie)<input type="file" name="copie" accept="application/pdf,.pdf,image/*" multiple required></label>
    <button>📤 Envoyer ma copie</button></form>
    <p class="muted">🔒 Votre copie est enregistrée en PDF verrouillé : après l'envoi, elle ne peut plus être modifiée.</p></div>` : ''}`);
}
function fillPage(base) {
  const s = session;
  const cfg = { base, key: s.token.slice(0, 8), pages: s.pages, t: { ...SP.FILL_TEXT, fail: 'Envoi impossible : vérifiez que vous êtes toujours sur le Wi-Fi de la classe, puis réessayez.' } };
  return page(s.title, `${SP.fillBody(`<a href="${base}/">Retour</a>`)}
    <script>window.CFG = ${SP.jsonForScript(cfg)};</script><script>${SP.FILL_JS}</script><script>${SP.LAN_JS}</script>`, true);
}
function handler(req, res) {
  const u = new URL(req.url, 'http://x'); const base = `/c/${session.token}`;
  const send = (code, body, type = 'text/html; charset=utf-8', extra = {}) => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'", ...extra });
    res.end(body);
  };
  const json = (code, o) => send(code, JSON.stringify(o), 'application/json; charset=utf-8');
  if (!u.pathname.startsWith(base)) return send(404, page('Introuvable', '<div class="card">Adresse invalide ou partage terminé.</div>'));
  const sub = u.pathname.slice(base.length) || '/';
  const s = session;
  if (req.method === 'GET' && sub === '/') return send(200, homePage(base));
  if (req.method === 'GET' && sub === '/document.pdf') { s.downloads++; notify(); return send(200, s.bytes, 'application/pdf'); }
  if (req.method === 'GET' && sub === '/document.docx' && s.docx) {
    s.downloads++; notify();
    return send(200, s.docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', { 'Content-Disposition': 'attachment; filename="document.docx"' });
  }
  if (req.method === 'GET' && sub === '/remplir' && s.fill) { s.downloads++; notify(); return send(200, fillPage(base)); }
  const pm = /^\/page\/(\d{1,3})\.jpg$/.exec(sub);
  if (req.method === 'GET' && pm && s.fill && +pm[1] < s.pages.length) {
    pageImage(s, +pm[1]).then((img) => { if (session === s) res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' }); else res.writeHead(404); res.end(session === s ? img : ''); })
      .catch(() => send(500, 'Page illisible', 'text/plain; charset=utf-8'));
    return;
  }
  if (req.method === 'POST' && sub === '/rendre' && s.collect) {
    const fail = (code, t) => send(code, page('Erreur', `<div class="card err">${esc(t)}</div><p><a class="btn alt" href="${base}/">Retour</a></p>`));
    const m = /boundary=(.+)$/.exec(req.headers['content-type'] || ''); if (!m) return send(400, 'Requête invalide', 'text/plain; charset=utf-8');
    readBody(req, MAX_UPLOAD).then(async (buf) => {
      const f = parseMultipart(buf, m[1].replace(/^"|"$/g, ''));
      const r = await submitFiles(s, f.eleve, f['copie[]'], false);
      if (r.code !== 200) return fail(r.code, r.error);
      send(200, page('Merci', `<div class="card ok"><h2>✅ Copie reçue</h2><p>Merci ${esc(r.eleve)}, votre copie a bien été transmise.</p><p>🔒 Elle est verrouillée : elle ne peut plus être modifiée.</p></div>`));
    }).catch(() => fail(413, `Fichier trop volumineux (${MAX_UPLOAD / 1048576} Mo maximum).`));
    return;
  }
  if (req.method === 'POST' && sub === '/remplir' && s.collect && s.fill) {
    readBody(req, 600000).then(async (buf) => {
      let d = null; try { d = JSON.parse(buf.toString('utf8')); } catch { /* requête invalide */ }
      const r = await submitFill(s, d, false);
      json(r.code, r.code === 200 ? { ok: true } : { error: r.error });
    }).catch(() => json(413, { error: 'Copie trop volumineuse.' }));
    return;
  }
  send(404, 'Introuvable', 'text/plain; charset=utf-8');
}

// ---------- À distance : relais de l'éditeur, contenus chiffrés de bout en bout ----------
// Message = [4 octets : longueur de l'en-tête][en-tête JSON][données], chiffré en AES-256-GCM ; envoyé = [IV 12 octets][chiffré][sceau 16 octets].
const frame = (head, body) => { const h = Buffer.from(JSON.stringify(head), 'utf8'); const n = Buffer.alloc(4); n.writeUInt32BE(h.length); return Buffer.concat([n, h, body || Buffer.alloc(0)]); };
function unframe(buf) { const n = buf.readUInt32BE(0); if (n > buf.length - 4 || n > 2 * 1048576) throw new Error('message invalide'); return { head: JSON.parse(buf.subarray(4, 4 + n).toString('utf8')), body: buf.subarray(4 + n) }; }
function seal(key, aad, plain) {
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(aad, 'utf8'));
  return Buffer.concat([iv, c.update(plain), c.final(), c.getAuthTag()]);
}
function unseal(key, aad, msg) {
  if (msg.length < 29) throw new Error('message invalide');
  const d = crypto.createDecipheriv('aes-256-gcm', key, msg.subarray(0, 12)); d.setAAD(Buffer.from(aad, 'utf8')); d.setAuthTag(msg.subarray(msg.length - 16));
  return Buffer.concat([d.update(msg.subarray(12, msg.length - 16)), d.final()]);
}
const cacheKeyOf = (key, head) => crypto.createHmac('sha256', key).update('cache:' + JSON.stringify(head)).digest('base64url');
const SHARED_OPS = new Set(['info', 'pdf', 'docx', 'page']);
/** Répond à une demande d'élève arrivée par le relais. Rend { head, body?, shared }. */
async function remoteAnswer(s, head, body) {
  const op = head && head.op;
  if (op === 'info') return { head: infoOf(s), shared: true };
  if (op === 'pdf') { s.downloads++; notify(); return { head: { ok: true }, body: s.bytes, shared: true }; }
  if (op === 'docx' && s.docx) { s.downloads++; notify(); return { head: { ok: true }, body: s.docx, shared: true }; }
  if (op === 'page' && s.fill && Number.isInteger(head.i) && head.i >= 0 && head.i < s.pages.length) return { head: { ok: true }, body: await pageImage(s, head.i), shared: true };
  if (op === 'fill') { const r = await submitFill(s, head, true); return { head: r.code === 200 ? { ok: true } : { ok: false, error: r.error } }; }
  if (op === 'files') {
    const meta = Array.isArray(head.files) ? head.files.slice(0, MAX_FILES) : []; const files = []; let off = 0;
    if (body.length > MAX_REMOTE_UPLOAD) return { head: { ok: false, error: 'Fichiers trop volumineux (25 Mo au plus pour une copie envoyée à distance).' } };
    for (const f of meta) { const n = Math.floor(Number(f && f.size)); if (!(n > 0) || off + n > body.length) break; files.push({ filename: String((f && f.name) || ''), data: body.subarray(off, off + n) }); off += n; }
    const r = await submitFiles(s, head.eleve, files, true); return { head: r.code === 200 ? { ok: true } : { ok: false, error: r.error } };
  }
  return { head: { ok: false, error: 'Demande inconnue.' } };
}
async function remoteServe(s, R, id, cacheKey, msg) {
  if (R.seen.has(id)) return; R.seen.add(id); if (R.seen.size > 20000) R.seen.clear(); // une demande rejouée n'est jamais traitée deux fois
  let out; let shared = false; let aad = 'a:' + id;
  try {
    const q = unframe(unseal(R.key, 'q:' + id, msg));
    const r = await remoteAnswer(s, q.head, q.body);
    // réponse commune gardée par le relais seulement si l'étiquette de cache correspond bien à la demande déchiffrée
    shared = !!r.shared && SHARED_OPS.has(q.head.op) && !!cacheKey && cacheKey === cacheKeyOf(R.key, q.head);
    if (shared) aad = 'c:' + cacheKey;
    out = seal(R.key, aad, frame(r.head, r.body));
  } catch { return; } // message illisible (mauvaise clé, altéré) : ignoré, l'élève verra une erreur de délai
  try { await A.fetch(`${R.api}/a/${id}`, { method: 'POST', headers: { Authorization: 'Bearer ' + R.hostKey, 'Content-Type': 'application/octet-stream', ...(shared ? { 'X-Shared': '1' } : {}) }, body: out }); } catch { /* relais injoignable : l'élève réessaiera */ }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function remoteLoop(s, R) {
  let errors = 0;
  while (session === s && s.remote === R && !R.stopped) {
    try {
      const res = await A.fetch(`${R.api}/next`, { headers: { Authorization: 'Bearer ' + R.hostKey } });
      if (res.status === 200) { errors = 0; R.online = true; const id = res.headers.get('x-id') || ''; const ck = res.headers.get('x-cache') || ''; const buf = Buffer.from(await res.arrayBuffer()); remoteServe(s, R, id, ck, buf); }
      else if (res.status === 204) { errors = 0; if (!R.online) { R.online = true; notify(); } }
      else if (res.status === 401 || res.status === 404 || res.status === 410) { R.stopped = true; R.online = false; R.ended = true; notify(); break; } // salle expirée ou fermée
      else { errors++; await sleep(Math.min(15000, 1500 * errors)); }
    } catch { errors++; if (R.online && errors > 2) { R.online = false; notify(); } await sleep(Math.min(15000, 1500 * errors)); }
  }
}
async function remoteOpen(s) {
  const base = String(A.relayUrl() || '').replace(/\/+$/, ''); if (!/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('relais non configuré');
  const res = await A.fetch(base + '/r/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const j = await res.json().catch(() => null);
  if (res.status === 429) throw new UserError('Trop de partages à distance ouverts depuis ce réseau : réessayez plus tard.');
  if (res.status !== 200 || !j || !/^[A-Za-z0-9_-]{16,40}$/.test(j.room || '') || !/^[A-Za-z0-9_-]{20,100}$/.test(j.hostKey || '')) throw new Error('relais indisponible');
  const key = crypto.randomBytes(32);
  const R = { api: `${base}/r/${j.room}`, hostKey: j.hostKey, key, url: `${base}/r/${j.room}#${key.toString('base64url')}`, expires: Number(j.expires) || 0, seen: new Set(), online: true, stopped: false, ended: false };
  s.remote = R;
  for (let i = 0; i < 3; i++) remoteLoop(s, R); // trois écoutes : plusieurs élèves servis en même temps
  return R;
}
async function remoteClose(R) {
  if (!R || R.stopped) return; R.stopped = true;
  try { await Promise.race([A.fetch(R.api, { method: 'DELETE', headers: { Authorization: 'Bearer ' + R.hostKey } }), sleep(4000)]); } catch { /* le relais supprimera la salle à son échéance */ }
}

function notify() {
  const w = A.getWin(); if (w && !w.isDestroyed()) w.webContents.send('classroom-update', status());
}
function status() {
  if (!session) return { active: false };
  const R = session.remote;
  return { active: true, url: session.url, urls: session.urls, title: session.title, downloads: session.downloads, collect: session.collect, fill: session.fill, word: !!session.docx,
    remote: R ? { url: R.url, online: R.online && !R.ended, ended: R.ended, expires: R.expires } : null,
    received: session.received.map((r) => ({ eleve: r.eleve, file: r.file, at: r.at, how: r.how })), dir: session.dir };
}
async function start({ bytes, title, fileName, message, collect, fill, layout, remote }) {
  require('./license').requirePremium('Classe connectée');
  await stop();
  const ips = lanAddresses();
  if (!ips.length && !remote) throw new Error('Aucun réseau local détecté : connectez ce PC au Wi-Fi ou au réseau de la classe.');
  const pdf = Buffer.from(bytes); if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('Document illisible.');
  let pages = []; if (fill !== false) { try { pages = await mu.pageSizes(pdf); } catch { pages = []; } }
  const canFill = pages.length > 0 && pages.length <= MAX_FILL_PAGES;
  let docx = null; if (Array.isArray(layout) && layout.length && A.docx) { try { docx = Buffer.from(await A.docx(layout)); } catch { docx = null; } }
  const token = crypto.randomBytes(9).toString('base64url');
  const dir = path.join(A.app.getPath('userData'), 'classe', new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const s = { token, bytes: pdf, title: String(title || 'Document').slice(0, 120), fileName: path.basename(String(fileName || 'document.pdf')).replace(/["\\<>]/g, '_').slice(0, 120), message: message ? String(message).slice(0, 400) : '',
    collect: collect !== false, fill: canFill, pages, images: [], docx, dir, received: [], downloads: 0, remote: null, urls: [], url: '' };
  session = s;
  const QR = require('qrcode'); const qrOf = (u) => QR.toDataURL(u, { margin: 1, width: 320, color: { dark: '#001871', light: '#ffffff' } });
  if (ips.length) {
    server = http.createServer((req, res) => { try { if (session) handler(req, res); else { res.writeHead(404); res.end(); } } catch { try { res.writeHead(500); res.end(); } catch { /* connexion déjà fermée */ } } });
    server.requestTimeout = 120000; server.headersTimeout = 15000; server.maxConnections = 200; // réseau de classe : pas de connexion bloquée indéfiniment
    await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '0.0.0.0', res); });
    const port = server.address().port;
    s.urls = ips.map((ip) => `http://${ip.address}:${port}/c/${token}/`); s.url = s.urls[0];
  }
  let remoteOff = null;
  if (remote) { try { await remoteOpen(s); } catch (e) { remoteOff = e instanceof UserError ? e.message : 'Le lien à distance n\'a pas pu être créé : vérifiez la connexion Internet de ce PC.'; } }
  if (!s.url && !s.remote) { await stop(); throw new Error(remoteOff || 'Aucun réseau disponible.'); }
  return { ...status(), fillOff: fill !== false && !canFill ? (pages.length > MAX_FILL_PAGES ? 'pages' : 'illisible') : null, wordOff: Array.isArray(layout) && layout.length > 0 && !docx, remoteOff,
    qr: s.url ? await qrOf(s.url) : '', qrRemote: s.remote ? await qrOf(s.remote.url) : '' };
}
async function stop() {
  const sv = server; server = null; const s = session; session = null;
  if (s && s.remote) await remoteClose(s.remote);
  if (sv) { if (sv.closeAllConnections) sv.closeAllConnections(); await new Promise((r) => sv.close(() => r())); }
  return { active: false, dir: s && s.dir, received: s ? s.received.length : 0 };
}
function init(deps) {
  A = deps;
  if (!A.fetch) A.fetch = (...a) => fetch(...a);
  A.ipcMain.handle('classroom-start', (_e, a) => { A.guard('save', 'Classe connectée'); return start(a || {}); });
  A.ipcMain.handle('classroom-stop', () => stop());
  A.ipcMain.handle('classroom-status', () => status());
  A.ipcMain.handle('classroom-open-received', () => (session ? session.received.map((r) => r.file) : []));
  A.app.on('before-quit', () => { if (session && session.remote) remoteClose(session.remote); if (server) server.close(); });
}
module.exports = { init, _test: { parseMultipart, lanAddresses, kindOf, seal, unseal, frame, unframe } };
