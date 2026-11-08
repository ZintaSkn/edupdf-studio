// SknEDU-studio — classe connectée : partage d'un document aux élèves par le réseau local (Wi-Fi de la classe)
// et récupération de leurs copies, sans Internet. Le partage n'est actif que pendant la séance, derrière un
// jeton aléatoire dans l'adresse ; seuls des PDF (30 Mo max.) sont acceptés en retour.
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let A = null; let server = null; let session = null;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !/^169\.254\./.test(a.address)) out.push({ name, address: a.address });
  }
  // priorité aux réseaux privés habituels (Wi-Fi / Ethernet)
  return out.sort((x, y) => (/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(y.address) ? 1 : 0) - (/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(x.address) ? 1 : 0));
}
function page(title, body) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>body{font:16px system-ui,sans-serif;margin:0;background:#f1f3f8;color:#141c33}
header{background:#001871;color:#fff;padding:14px 18px;border-bottom:4px solid #F1B434}main{max-width:620px;margin:18px auto;padding:0 14px}
.card{background:#fff;border-radius:12px;padding:16px;margin-bottom:14px;box-shadow:0 2px 10px rgba(0,0,0,.08)}
a.btn,button{display:inline-block;background:#001871;color:#fff;border:0;border-radius:8px;padding:12px 18px;font-size:16px;text-decoration:none}
input{font-size:16px;padding:10px;border:1px solid #c4cbd8;border-radius:8px;width:100%;box-sizing:border-box;margin:6px 0 12px}.ok{color:#128a3e}.err{color:#c63b3b}</style></head>
<body><header><b>SknEDU-studio</b> — classe connectée</header><main>${body}</main></body></html>`;
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('trop gros')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
  });
}
/** Lecture minimale d'un formulaire multipart (un champ texte « eleve » et un fichier « copie »). */
function parseMultipart(buf, boundary) {
  const parts = {}; const sep = Buffer.from('--' + boundary);
  let pos = buf.indexOf(sep);
  while (pos >= 0) {
    const next = buf.indexOf(sep, pos + sep.length); if (next < 0) break;
    const part = buf.subarray(pos + sep.length + 2, next - 2);
    const he = part.indexOf('\r\n\r\n'); if (he > 0) {
      const head = part.subarray(0, he).toString('utf8'); const body = part.subarray(he + 4);
      const name = /name="([^"]+)"/.exec(head); const file = /filename="([^"]*)"/.exec(head);
      if (name) parts[name[1]] = file ? { filename: file[1], data: body } : body.toString('utf8');
    }
    pos = next;
  }
  return parts;
}

function handler(req, res) {
  const u = new URL(req.url, 'http://x'); const base = `/c/${session.token}`;
  const send = (code, html, type = 'text/html; charset=utf-8') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(html); };
  if (!u.pathname.startsWith(base)) return send(404, page('Introuvable', '<div class="card">Adresse invalide ou partage terminé.</div>'));
  const sub = u.pathname.slice(base.length) || '/';
  if (req.method === 'GET' && sub === '/') {
    return send(200, page(session.title, `<div class="card"><h2>${esc(session.title)}</h2><p>${esc(session.message || 'Téléchargez le document, complétez-le, puis rendez-le ci-dessous.')}</p>
      <a class="btn" href="${base}/document.pdf" download="${esc(session.fileName)}">📥 Télécharger le document</a></div>
      ${session.collect ? `<div class="card"><h3>Rendre ma copie</h3><form method="post" action="${base}/rendre" enctype="multipart/form-data">
      <label>Nom et prénom<input name="eleve" required maxlength="80"></label><label>Copie (PDF)<input type="file" name="copie" accept="application/pdf" required></label>
      <button>📤 Envoyer ma copie</button></form></div>` : ''}`));
  }
  if (req.method === 'GET' && sub === '/document.pdf') { session.downloads++; notify(); return send(200, session.bytes, 'application/pdf'); }
  if (req.method === 'POST' && sub === '/rendre' && session.collect) {
    if (session.received.length >= 400) return send(429, page('Erreur', '<div class="card err">Trop de copies reçues pour ce partage : prévenez l\'enseignant.</div>'));
    const m = /boundary=(.+)$/.exec(req.headers['content-type'] || ''); if (!m) return send(400, 'Requête invalide');
    readBody(req, 30 * 1048576).then((buf) => {
      const f = parseMultipart(buf, m[1].replace(/^"|"$/g, ''));
      const eleve = String(f.eleve || '').replace(/[^\p{L}\p{N} '\-]/gu, '').trim().slice(0, 80);
      if (!eleve || !f.copie || !f.copie.data || f.copie.data.subarray(0, 5).toString() !== '%PDF-') return send(400, page('Erreur', '<div class="card err">Indiquez votre nom et choisissez un fichier PDF.</div>'));
      const file = path.join(session.dir, `${eleve} - ${new Date().toISOString().slice(11, 19).replace(/:/g, 'h')}.pdf`);
      fs.writeFileSync(file, f.copie.data); session.received.push({ eleve, file, at: Date.now() }); notify();
      send(200, page('Merci', `<div class="card ok"><h2>✅ Copie reçue</h2><p>Merci ${esc(eleve)}, votre copie a bien été transmise.</p></div>`));
    }).catch(() => send(413, page('Erreur', '<div class="card err">Fichier trop volumineux (30 Mo maximum).</div>')));
    return;
  }
  send(404, 'Introuvable', 'text/plain');
}
function notify() {
  const w = A.getWin(); if (w && !w.isDestroyed()) w.webContents.send('classroom-update', status());
}
function status() {
  if (!session) return { active: false };
  return { active: true, url: session.url, urls: session.urls, title: session.title, downloads: session.downloads, collect: session.collect,
    received: session.received.map((r) => ({ eleve: r.eleve, file: r.file, at: r.at })), dir: session.dir };
}
async function start({ bytes, title, fileName, message, collect }) {
  require('./license').requirePremium('Classe connectée');
  await stop();
  const ips = lanAddresses();
  if (!ips.length) throw new Error('Aucun réseau local détecté : connectez ce PC au Wi-Fi ou au réseau de la classe.');
  const token = crypto.randomBytes(9).toString('base64url');
  const dir = path.join(A.app.getPath('userData'), 'classe', new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  session = { token, bytes: Buffer.from(bytes), title: title || 'Document', fileName: fileName || 'document.pdf', message, collect: collect !== false, dir, received: [], downloads: 0 };
  server = http.createServer(handler);
  server.requestTimeout = 120000; server.headersTimeout = 15000; server.maxConnections = 200; // réseau de classe : pas de connexion bloquée indéfiniment
  await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '0.0.0.0', res); });
  const port = server.address().port;
  session.urls = ips.map((ip) => `http://${ip.address}:${port}/c/${token}/`); session.url = session.urls[0];
  const QR = require('qrcode');
  return { ...status(), qr: await QR.toDataURL(session.url, { margin: 1, width: 320, color: { dark: '#001871', light: '#ffffff' } }) };
}
async function stop() {
  if (server) await new Promise((r) => server.close(() => r())); server = null;
  const s = session; session = null; return { active: false, dir: s && s.dir, received: s ? s.received.length : 0 };
}
function init(deps) {
  A = deps;
  A.ipcMain.handle('classroom-start', (_e, a) => { A.guard('save', 'Classe connectée'); return start(a); });
  A.ipcMain.handle('classroom-stop', () => stop());
  A.ipcMain.handle('classroom-status', () => status());
  A.ipcMain.handle('classroom-open-received', () => (session ? session.received.map((r) => r.file) : []));
  A.app.on('before-quit', () => { if (server) server.close(); });
}
module.exports = { init, _test: { parseMultipart, lanAddresses } };
