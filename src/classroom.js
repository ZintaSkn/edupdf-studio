// SknEDU-studio — classe connectée : partage d'un document aux élèves par le réseau local (Wi-Fi de la classe)
// et récupération de leurs copies, sans Internet. Le partage n'est actif que pendant la séance, derrière un
// jeton aléatoire dans l'adresse. Le lien s'ouvre dans tout navigateur (Windows, Mac, iPad, iPhone, Android).
// L'élève reçoit un document modifiable : PDF, Word (.docx) ou page à remplir dans le navigateur.
// Toute copie rendue est enregistrée en PDF figé et verrouillé : champs et réponses fondus dans les pages,
// modification interdite (AES-256, mot de passe de modification aléatoire jamais conservé).
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mu = require('./mu');

let A = null; let server = null; let session = null; let chain = Promise.resolve();

const MAX_UPLOAD = 40 * 1048576; const MAX_FILES = 20; const MAX_FILL_PAGES = 40; const MAX_NOTES = 400;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
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
const CSS = `body{font:16px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;margin:0;background:#f1f3f8;color:#141c33;-webkit-text-size-adjust:100%}
header{background:#001871;color:#fff;padding:14px 18px;border-bottom:4px solid #F1B434}main{max-width:620px;margin:18px auto;padding:0 14px}main.wide{max-width:980px}
.card{background:#fff;border-radius:12px;padding:16px;margin-bottom:14px;box-shadow:0 2px 10px rgba(0,0,0,.08)}h2,h3{margin:0 0 8px}
a.btn,button{display:inline-block;background:#001871;color:#fff;border:0;border-radius:8px;padding:12px 18px;font-size:16px;text-decoration:none;margin:4px 6px 4px 0;cursor:pointer;-webkit-appearance:none}
a.btn.alt{background:#fff;color:#001871;border:2px solid #001871;padding:10px 16px}button[disabled]{opacity:.6}
input,select{font-size:16px;padding:10px;border:1px solid #c4cbd8;border-radius:8px;width:100%;box-sizing:border-box;margin:6px 0 12px;background:#fff}
.ok{color:#128a3e}.err{color:#c63b3b}.muted{color:#5b6478;font-size:14px}
.bar{position:-webkit-sticky;position:sticky;top:0;z-index:5;background:#fff;border-radius:0 0 12px 12px;padding:10px 12px;box-shadow:0 2px 10px rgba(0,0,0,.12);margin-bottom:12px}
.bar .row{display:-webkit-flex;display:flex;-webkit-flex-wrap:wrap;flex-wrap:wrap;-webkit-align-items:center;align-items:center}.bar input{-webkit-flex:1 1 200px;flex:1 1 200px;margin:4px 6px 4px 0;width:auto}.bar select{width:auto;margin:4px 6px 4px 0}
.pg{position:relative;background:#fff;margin:0 0 12px;box-shadow:0 2px 10px rgba(0,0,0,.12);overflow:hidden;cursor:text}.pg img{display:block;width:100%;height:auto;-webkit-user-select:none;user-select:none;pointer-events:none}
.pg textarea.t{position:absolute;margin:0;padding:0 2px;border:1px dashed rgba(0,48,156,.45);border-radius:2px;background:rgba(255,255,255,.55);color:#00309c;font-family:Helvetica,Arial,sans-serif;line-height:1.25;resize:none;overflow:hidden;box-sizing:border-box;-webkit-appearance:none}
.pg textarea.t:focus{outline:none;border:1px solid #00309c;background:rgba(255,255,255,.85)}`;
function page(title, body, wide) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body><header><b>SknEDU-studio</b> — classe connectée</header><main id="main"${wide ? ' class="wide"' : ''}>${body}</main></body></html>`;
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
async function lockedCopy(files, notes) {
  const flats = [];
  if (notes) flats.push(await mu.flattenToPdf(session.bytes, 'application/pdf', notes));
  else for (const f of files) { try { flats.push(await flatten(f.data)); } catch (e) { if (e instanceof UserError) throw e; throw new UserError('Fichier illisible ou protégé par un mot de passe : vérifiez-le, puis envoyez-le à nouveau.'); } }
  let pdf = flats[0];
  if (flats.length > 1) {
    const { PDFDocument } = require('pdf-lib'); const out = await PDFDocument.create();
    for (const b of flats) { const d = await PDFDocument.load(b); (await out.copyPages(d, d.getPageIndices())).forEach((p) => out.addPage(p)); }
    pdf = await out.save();
  }
  return Buffer.from(await mu.sealPdf(pdf));
}
function store(eleve, buf, how) {
  const base = `${eleve} - ${new Date().toISOString().slice(11, 19).replace(/:/g, 'h')}`; let file = path.join(session.dir, base + '.pdf');
  for (let i = 2; fs.existsSync(file) && i < 50; i++) file = path.join(session.dir, `${base} (${i}).pdf`);
  fs.writeFileSync(file, buf); session.received.push({ eleve, file, at: Date.now(), how }); notify();
}

// ---------- Pages servies aux élèves ----------
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
// Script de la page « Remplir en ligne » : volontairement simple (ES5) pour fonctionner sur tous les navigateurs, y compris anciens.
const FILL_JS = String.raw`(function () {
  var C = window.CFG, box = document.getElementById('pages'), nameEl = document.getElementById('eleve'), sizeSel = document.getElementById('sz'), send = document.getElementById('send');
  var KEY = 'sknedu-classe-' + C.key, pages = [];
  function fit(t) { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; }
  function px(t) { t.style.fontSize = Math.max(7, parseFloat(t.getAttribute('data-fs')) * t.parentNode.clientWidth) + 'px'; fit(t); }
  function items() {
    var out = [], i, j, ts, t, pg;
    for (i = 0; i < pages.length; i++) {
      pg = pages[i]; ts = pg.getElementsByTagName('textarea');
      for (j = 0; j < ts.length; j++) {
        t = ts[j]; if (!t.value.replace(/\s/g, '') || !pg.clientWidth || !pg.clientHeight) continue;
        out.push({ p: i, x: t.offsetLeft / pg.clientWidth, y: t.offsetTop / pg.clientHeight, w: t.offsetWidth / pg.clientWidth, h: t.offsetHeight / pg.clientHeight, fs: parseFloat(t.getAttribute('data-fs')), text: t.value });
      }
    }
    return out;
  }
  function save() { try { window.localStorage.setItem(KEY, JSON.stringify({ n: nameEl.value, i: items() })); } catch (e) {} }
  function add(pg, x, y, fs, text) {
    var t = document.createElement('textarea'); t.className = 't'; t.rows = 1; t.setAttribute('data-fs', fs); t.setAttribute('autocapitalize', 'sentences');
    t.style.left = (x * 100) + '%'; t.style.top = (y * 100) + '%'; t.style.width = (Math.max(0.1, Math.min(0.7, 0.985 - x)) * 100) + '%';
    t.value = text || ''; pg.appendChild(t); px(t);
    t.oninput = function () { fit(t); save(); };
    t.onblur = function () { if (!t.value.replace(/\s/g, '') && t.parentNode) t.parentNode.removeChild(t); save(); };
    return t;
  }
  function makePage(i) {
    var pg = document.createElement('div'), img = document.createElement('img'), s = C.pages[i];
    pg.className = 'pg'; img.alt = 'Page ' + (i + 1); img.width = Math.round(s.w); img.height = Math.round(s.h); img.src = C.base + '/page/' + i + '.jpg';
    img.onload = function () { var ts = pg.getElementsByTagName('textarea'), j; for (j = 0; j < ts.length; j++) px(ts[j]); };
    pg.appendChild(img); box.appendChild(pg); pages.push(pg);
    pg.onclick = function (e) {
      if (e.target && e.target.tagName === 'TEXTAREA') return;
      var r = pg.getBoundingClientRect(), fs = parseFloat(sizeSel.value); if (!r.width || !r.height) return;
      var x = Math.min(0.9, Math.max(0, (e.clientX - r.left) / r.width)), y = Math.min(0.97, Math.max(0, (e.clientY - r.top) / r.height - fs * r.width * 0.7 / r.height));
      add(pg, x, y, fs, '').focus();
    };
  }
  var i, d;
  for (i = 0; i < C.pages.length; i++) makePage(i);
  try { d = JSON.parse(window.localStorage.getItem(KEY) || 'null'); } catch (e) { d = null; }
  if (d && d.i && d.i.length) { nameEl.value = d.n || ''; for (i = 0; i < d.i.length; i++) if (pages[d.i[i].p]) add(pages[d.i[i].p], d.i[i].x, d.i[i].y, d.i[i].fs, d.i[i].text); }
  nameEl.oninput = save;
  window.onresize = function () { var ts = box.getElementsByTagName('textarea'), j; for (j = 0; j < ts.length; j++) px(ts[j]); };
  function back(m) { if (m) window.alert(m); send.disabled = false; send.innerHTML = C.t.send; }
  send.onclick = function () {
    var n = nameEl.value.replace(/^\s+|\s+$/g, ''), it = items();
    if (!n) { window.alert(C.t.name); nameEl.focus(); return; }
    if (!it.length) { window.alert(C.t.empty); return; }
    if (!window.confirm(C.t.confirm)) return;
    send.disabled = true; send.innerHTML = C.t.sending;
    var x = new XMLHttpRequest(); x.open('POST', C.base + '/remplir'); x.setRequestHeader('Content-Type', 'application/json');
    x.onload = function () {
      var r = {}; try { r = JSON.parse(x.responseText); } catch (e) {}
      if (x.status === 200 && r.ok) {
        try { window.localStorage.removeItem(KEY); } catch (e) {}
        document.getElementById('main').innerHTML = '<div class="card ok"><h2>✅ ' + C.t.done + '</h2><p>' + C.t.locked + '</p></div>'; window.scrollTo(0, 0);
      } else back(r.error || C.t.fail);
    };
    x.onerror = function () { back(C.t.fail); };
    x.send(JSON.stringify({ eleve: n, items: it }));
  };
})();`;
function fillPage(base) {
  const s = session;
  const cfg = { base, key: s.token.slice(0, 8), pages: s.pages, t: { send: '📤 Envoyer ma copie', sending: 'Envoi en cours…', name: 'Indiquez votre nom et votre prénom.', empty: 'Écrivez au moins une réponse sur le document : touchez la page à l\'endroit voulu.',
    confirm: 'Envoyer votre copie ? Après l\'envoi, elle sera verrouillée et ne pourra plus être modifiée.', fail: 'Envoi impossible : vérifiez que vous êtes toujours sur le Wi-Fi de la classe, puis réessayez.', done: 'Copie reçue', locked: 'Votre copie a bien été transmise. Elle est verrouillée : elle ne peut plus être modifiée.' } };
  return page(s.title, `<div class="bar"><div class="row"><input id="eleve" maxlength="80" placeholder="Nom et prénom" autocomplete="name">
    <select id="sz" title="Taille du texte"><option value="0.018">Texte petit</option><option value="0.024" selected>Texte moyen</option><option value="0.032">Texte grand</option></select>
    <button id="send">📤 Envoyer ma copie</button></div>
    <div class="muted">✏️ Touchez la page à l'endroit où vous voulez écrire. Une zone vide disparaît toute seule. <a href="${base}/">Retour</a></div></div>
    <div id="pages"></div>
    <script>window.CFG = ${JSON.stringify(cfg).replace(/</g, '\\u003c')};</script><script>${FILL_JS}</script>`, true);
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
  if (req.method === 'GET' && sub === '/remplir' && s.fill) { if (!s.fillOpened) { s.fillOpened = true; } s.downloads++; notify(); return send(200, fillPage(base)); }
  const pm = /^\/page\/(\d{1,3})\.jpg$/.exec(sub);
  if (req.method === 'GET' && pm && s.fill && +pm[1] < s.pages.length) {
    const i = +pm[1];
    if (!s.images[i]) s.images[i] = queued(() => mu.pageJpeg(s.bytes, i)); // rendue une fois, puis gardée pour toute la classe
    s.images[i].then((img) => { if (session === s) res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' }); else res.writeHead(404); res.end(session === s ? img : ''); })
      .catch(() => { s.images[i] = null; send(500, 'Page illisible', 'text/plain; charset=utf-8'); });
    return;
  }
  const full = () => s.received.length >= 400;
  if (req.method === 'POST' && sub === '/rendre' && s.collect) {
    if (full()) return send(429, page('Erreur', '<div class="card err">Trop de copies reçues pour ce partage : prévenez l\'enseignant.</div>'));
    const m = /boundary=(.+)$/.exec(req.headers['content-type'] || ''); if (!m) return send(400, 'Requête invalide', 'text/plain; charset=utf-8');
    const fail = (code, t) => send(code, page('Erreur', `<div class="card err">${esc(t)}</div><p><a class="btn alt" href="${base}/">Retour</a></p>`));
    readBody(req, MAX_UPLOAD).then(async (buf) => {
      const f = parseMultipart(buf, m[1].replace(/^"|"$/g, ''));
      const eleve = cleanStudent(f.eleve); const files = (f['copie[]'] || []).filter((x) => x.data && x.data.length).slice(0, MAX_FILES);
      if (!eleve || !files.length) return fail(400, 'Indiquez votre nom et choisissez un fichier PDF ou des photos de votre copie.');
      let locked; try { locked = await queued(() => lockedCopy(files, null)); } catch (e) { return fail(400, e instanceof UserError ? e.message : 'Copie illisible : vérifiez le fichier, puis envoyez-le à nouveau.'); }
      if (session !== s) return fail(410, 'Le partage est terminé.');
      store(eleve, locked, files.length > 1 ? 'photos' : kindOf(files[0].data) === 'pdf' ? 'pdf' : 'photo');
      send(200, page('Merci', `<div class="card ok"><h2>✅ Copie reçue</h2><p>Merci ${esc(eleve)}, votre copie a bien été transmise.</p><p>🔒 Elle est verrouillée : elle ne peut plus être modifiée.</p></div>`));
    }).catch(() => fail(413, `Fichier trop volumineux (${MAX_UPLOAD / 1048576} Mo maximum).`));
    return;
  }
  if (req.method === 'POST' && sub === '/remplir' && s.collect && s.fill) {
    if (full()) return json(429, { error: 'Trop de copies reçues pour ce partage : prévenez l\'enseignant.' });
    readBody(req, 600000).then(async (buf) => {
      let d = null; try { d = JSON.parse(buf.toString('utf8')); } catch { /* requête invalide */ }
      const eleve = cleanStudent(d && d.eleve); const num = (v) => (typeof v === 'number' && isFinite(v) ? v : NaN); let total = 0;
      const notes = (d && Array.isArray(d.items) ? d.items : []).slice(0, MAX_NOTES).map((t) => ({ p: Math.floor(num(t && t.p)), x: num(t && t.x), y: num(t && t.y), w: num(t && t.w), h: num(t && t.h), fs: num(t && t.fs),
        text: String((t && t.text) || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').slice(0, 2000).trim() }))
        .filter((t) => t.text && t.p >= 0 && t.p < s.pages.length && t.x >= 0 && t.x <= 1 && t.y >= 0 && t.y <= 1 && t.w > 0 && t.w <= 1 && t.h > 0 && t.h <= 1 && t.fs >= 0.006 && t.fs <= 0.08 && (total += t.text.length) <= 60000);
      if (!eleve) return json(400, { error: 'Indiquez votre nom et votre prénom.' });
      if (!notes.length) return json(400, { error: 'Écrivez au moins une réponse sur le document.' });
      let locked; try { locked = await queued(() => lockedCopy(null, notes)); } catch { return json(500, { error: 'La copie n\'a pas pu être créée : prévenez l\'enseignant.' }); }
      if (session !== s) return json(410, { error: 'Le partage est terminé.' });
      store(eleve, locked, 'en ligne'); json(200, { ok: true });
    }).catch(() => json(413, { error: 'Copie trop volumineuse.' }));
    return;
  }
  send(404, 'Introuvable', 'text/plain; charset=utf-8');
}
function notify() {
  const w = A.getWin(); if (w && !w.isDestroyed()) w.webContents.send('classroom-update', status());
}
function status() {
  if (!session) return { active: false };
  return { active: true, url: session.url, urls: session.urls, title: session.title, downloads: session.downloads, collect: session.collect, fill: session.fill, word: !!session.docx,
    received: session.received.map((r) => ({ eleve: r.eleve, file: r.file, at: r.at, how: r.how })), dir: session.dir };
}
async function start({ bytes, title, fileName, message, collect, fill, layout }) {
  require('./license').requirePremium('Classe connectée');
  await stop();
  const ips = lanAddresses();
  if (!ips.length) throw new Error('Aucun réseau local détecté : connectez ce PC au Wi-Fi ou au réseau de la classe.');
  const pdf = Buffer.from(bytes); if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('Document illisible.');
  let pages = []; if (fill !== false) { try { pages = await mu.pageSizes(pdf); } catch { pages = []; } }
  const canFill = pages.length > 0 && pages.length <= MAX_FILL_PAGES;
  let docx = null; if (Array.isArray(layout) && layout.length && A.docx) { try { docx = Buffer.from(await A.docx(layout)); } catch { docx = null; } }
  const token = crypto.randomBytes(9).toString('base64url');
  const dir = path.join(A.app.getPath('userData'), 'classe', new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  session = { token, bytes: pdf, title: String(title || 'Document').slice(0, 120), fileName: path.basename(String(fileName || 'document.pdf')).replace(/["\\<>]/g, '_').slice(0, 120), message: message ? String(message).slice(0, 400) : '',
    collect: collect !== false, fill: canFill, pages, images: [], docx, dir, received: [], downloads: 0 };
  server = http.createServer((req, res) => { try { if (session) handler(req, res); else { res.writeHead(404); res.end(); } } catch { try { res.writeHead(500); res.end(); } catch { /* connexion déjà fermée */ } } });
  server.requestTimeout = 120000; server.headersTimeout = 15000; server.maxConnections = 200; // réseau de classe : pas de connexion bloquée indéfiniment
  await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '0.0.0.0', res); });
  const port = server.address().port;
  session.urls = ips.map((ip) => `http://${ip.address}:${port}/c/${token}/`); session.url = session.urls[0];
  const QR = require('qrcode');
  return { ...status(), fillOff: fill !== false && !canFill ? (pages.length > MAX_FILL_PAGES ? 'pages' : 'illisible') : null, wordOff: Array.isArray(layout) && layout.length > 0 && !docx,
    qr: await QR.toDataURL(session.url, { margin: 1, width: 320, color: { dark: '#001871', light: '#ffffff' } }) };
}
async function stop() {
  const sv = server; server = null; const s = session; session = null;
  if (sv) { if (sv.closeAllConnections) sv.closeAllConnections(); await new Promise((r) => sv.close(() => r())); }
  return { active: false, dir: s && s.dir, received: s ? s.received.length : 0 };
}
function init(deps) {
  A = deps;
  A.ipcMain.handle('classroom-start', (_e, a) => { A.guard('save', 'Classe connectée'); return start(a || {}); });
  A.ipcMain.handle('classroom-stop', () => stop());
  A.ipcMain.handle('classroom-status', () => status());
  A.ipcMain.handle('classroom-open-received', () => (session ? session.received.map((r) => r.file) : []));
  A.app.on('before-quit', () => { if (server) server.close(); });
}
module.exports = { init, _test: { parseMultipart, lanAddresses, kindOf } };
