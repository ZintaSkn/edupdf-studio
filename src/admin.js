// EduPDF Studio — administration : droits d'accès par utilisateur / poste, journal d'activité, notifications.
//
// Fonctionnement sans serveur : l'administrateur choisit un « dossier de gestion » (dossier local partagé entre
// les comptes Windows du PC, partage réseau de l'établissement ou dossier cloud partagé OneDrive / Google Drive).
//   - policy.json : règles, signées par la clé privée de l'administrateur (Ed25519) → impossibles à falsifier ;
//   - events/<poste>__<utilisateur>.jsonl : journal écrit par chaque poste inscrit ;
//   - admin-key.json : clé publique de l'administrateur (épinglée par chaque poste à l'inscription).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const FEATURES = {
  save: 'Enregistrer et exporter des fichiers',
  edit: 'Modifier (texte, dessins, images, commentaires)',
  forms: 'Remplir les formulaires',
  pages: 'Organiser les pages (pivoter, supprimer, rogner…)',
  ocr: 'Reconnaissance de texte (OCR)',
  scan: 'Scanner',
  convert: 'Convertir (Word, Excel, PowerPoint, images…)',
  print: 'Imprimer',
  cloud: 'Enregistrer / ouvrir dans le cloud',
  protect: 'Ajouter ou retirer un mot de passe',
  unlock: 'Ouvrir les PDF protégés ou restreints',
  sign: 'Signer (manuscrite et certificat)',
  compare: 'Comparer des documents',
  ai: 'Assistant IA (envoie le texte du document au fournisseur choisi)'
};
const EVENTS = {
  app_start: 'Ouverture d\'EduPDF', file_open: 'Fichier ouvert', save: 'Fichier enregistré', export: 'Export / conversion',
  print: 'Impression', cloud: 'Enregistrement dans le cloud', unlock: 'PDF protégé déverrouillé', protect: 'Protection par mot de passe',
  sign: 'Signature', blocked: 'Action bloquée par les règles', user_blocked: 'Utilisateur bloqué : tentative d\'ouverture',
  policy_tampered: 'Règles modifiées sans autorisation', admin_fail: 'Mot de passe administrateur erroné',
  enroll: 'Poste inscrit à la gestion', unenroll: 'Poste retiré de la gestion', ai: 'Utilisation de l\'assistant IA'
};
const DEFAULT_NOTIFY = ['blocked', 'user_blocked', 'policy_tampered', 'admin_fail', 'unenroll', 'unlock', 'enroll'];

const host = os.hostname();
const user = (() => { try { return os.userInfo().username; } catch { return process.env.USERNAME || 'inconnu'; } })();
const PROGRAMDATA = process.env.ProgramData || 'C:\\ProgramData';
const MACHINE_DIR = process.env.EDUPDF_MACHINE_DIR || path.join(PROGRAMDATA, 'EduPDF');

let A = null; // { app, Notification, Tray, Menu, nativeImage, BrowserWindow, ipcMain, dialog, shell, iconPath, getMainWindow, openMain, preloadAdmin }
const P = {};  // chemins
let session = null;     // clé privée déverrouillée (console admin ouverte)
let policyCache = null; // { payload } vérifiée
let tray = null; let consoleWin = null; let watchTimer = null; let lastTamper = null;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2)); };
const scrypt = (pw, salt) => crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), 32, { N: 16384, r: 8, p: 1 });
const newSalt = () => crypto.randomBytes(16).toString('base64');
function hashPw(pw) { const salt = newSalt(); return { salt, hash: scrypt(pw, salt).toString('base64') }; }
function checkPw(pw, h) { if (!h) return false; const a = scrypt(pw, h.salt); const b = Buffer.from(h.hash, 'base64'); return a.length === b.length && crypto.timingSafeEqual(a, b); }

// ---------------------------------------------------------------- administrateur (ce PC)
const adminCfg = () => readJson(P.admin);
function encryptKey(pem, pw) {
  const salt = newSalt(); const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', scrypt(pw, salt), iv);
  const data = Buffer.concat([c.update(pem, 'utf8'), c.final()]);
  return { salt, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function decryptKey(enc, pw) {
  const d = crypto.createDecipheriv('aes-256-gcm', scrypt(pw, enc.salt), Buffer.from(enc.iv, 'base64'));
  d.setAuthTag(Buffer.from(enc.tag, 'base64'));
  return crypto.createPrivateKey(Buffer.concat([d.update(Buffer.from(enc.data, 'base64')), d.final()]).toString('utf8'));
}
function signPolicy(payload, priv) { return { payload, sig: crypto.sign(null, Buffer.from(JSON.stringify(payload)), priv).toString('base64') }; }
function verifyPolicy(obj, pubPem) {
  try { return !!obj && !!obj.payload && crypto.verify(null, Buffer.from(JSON.stringify(obj.payload)), pubPem, Buffer.from(obj.sig, 'base64')); } catch { return false; }
}
const defaultPolicy = (pwHash) => ({
  v: 1, updated: new Date().toISOString(), pwHash, defaults: Object.fromEntries(Object.keys(FEATURES).map((k) => [k, true])),
  users: {}, message: '', logFileNames: true
});

function setupAdmin({ password, folder }) {
  if (adminCfg()) throw new Error('L\'administration est déjà configurée sur ce PC.');
  if (!password || password.length < 6) throw new Error('Choisissez un mot de passe d\'au moins 6 caractères.');
  fs.mkdirSync(path.join(folder, 'events'), { recursive: true });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  const pwHash = hashPw(password);
  const cfg = { folder, pub, priv: encryptKey(privateKey.export({ type: 'pkcs8', format: 'pem' }), password), pwHash,
    notify: { types: DEFAULT_NOTIFY, ntfy: '', startup: true, windows: true }, cursor: {}, created: new Date().toISOString() };
  writeJson(path.join(folder, 'admin-key.json'), { pub, created: cfg.created, admin: `${host}\\${user}` });
  writeJson(path.join(folder, 'policy.json'), signPolicy(defaultPolicy(pwHash), privateKey));
  writeJson(P.admin, cfg);
  session = privateKey;
  startWatcher(); applyStartup(); ensureTray();
  return { ok: true };
}
function adminLogin(password) {
  const cfg = adminCfg(); if (!cfg) throw new Error('Administration non configurée.');
  if (!checkPw(password, cfg.pwHash)) { logEvent('admin_fail', { where: 'console' }); throw new Error('Mot de passe administrateur incorrect.'); }
  session = decryptKey(cfg.priv, password);
  return { ok: true };
}
function requireSession() { if (!session) throw new Error('Session administrateur expirée : reconnectez-vous.'); }
function readPolicyRaw(folder) { return readJson(path.join(folder, 'policy.json')); }
function getPolicyForAdmin() {
  requireSession(); const cfg = adminCfg(); const raw = readPolicyRaw(cfg.folder);
  const ok = raw && verifyPolicy(raw, cfg.pub);
  let policy = ok ? raw.payload : defaultPolicy(cfg.pwHash);
  if (!ok && raw && raw.payload) policy = { ...defaultPolicy(cfg.pwHash), ...raw.payload, pwHash: cfg.pwHash }; // reprise du contenu pour le re-signer
  return { policy, tampered: !!raw && !ok, features: FEATURES, events: EVENTS, folder: cfg.folder, notify: cfg.notify };
}
function savePolicy(payload) {
  requireSession(); const cfg = adminCfg();
  const clean = { v: 1, updated: new Date().toISOString(), pwHash: cfg.pwHash,
    defaults: Object.fromEntries(Object.keys(FEATURES).map((k) => [k, payload.defaults[k] !== false])),
    users: Object.fromEntries(Object.entries(payload.users || {}).map(([k, v]) => [k.trim().toLowerCase(), v]).filter(([k]) => k)), message: String(payload.message || '').slice(0, 500), logFileNames: payload.logFileNames !== false };
  writeJson(path.join(cfg.folder, 'policy.json'), signPolicy(clean, session));
  return { ok: true, updated: clean.updated };
}
function changePassword(oldPw, newPw) {
  const cfg = adminCfg(); if (!checkPw(oldPw, cfg.pwHash)) throw new Error('Ancien mot de passe incorrect.');
  if (!newPw || newPw.length < 6) throw new Error('Nouveau mot de passe trop court (6 caractères minimum).');
  const priv = decryptKey(cfg.priv, oldPw);
  cfg.priv = encryptKey(priv.export({ type: 'pkcs8', format: 'pem' }), newPw); cfg.pwHash = hashPw(newPw);
  writeJson(P.admin, cfg); session = priv;
  const raw = readPolicyRaw(cfg.folder); const pol = raw && verifyPolicy(raw, cfg.pub) ? raw.payload : defaultPolicy(cfg.pwHash);
  pol.pwHash = cfg.pwHash; pol.updated = new Date().toISOString();
  writeJson(path.join(cfg.folder, 'policy.json'), signPolicy(pol, priv));
  return { ok: true };
}
function saveNotify(n) {
  requireSession(); const cfg = adminCfg();
  cfg.notify = { types: (n.types || []).filter((t) => EVENTS[t]), ntfy: String(n.ntfy || '').replace(/[^\w-]/g, '').slice(0, 64), startup: !!n.startup, windows: n.windows !== false };
  writeJson(P.admin, cfg); applyStartup();
  return { ok: true };
}

// ---------------------------------------------------------------- poste géré (client)
function enrollment() { return readJson(path.join(MACHINE_DIR, 'managed.json')) || readJson(P.userEnroll); }
function enroll({ folder, password, scope }) {
  const key = readJson(path.join(folder, 'admin-key.json')); const raw = readPolicyRaw(folder);
  if (!key || !raw) throw new Error('Ce dossier ne contient pas de gestion EduPDF (admin-key.json / policy.json introuvables).');
  if (!verifyPolicy(raw, key.pub)) throw new Error('Règles invalides (signature incorrecte).');
  if (!checkPw(password, raw.payload.pwHash)) throw new Error('Mot de passe administrateur incorrect.');
  const e = { folder, pub: key.pub, enrolledAt: new Date().toISOString(), scope: scope === 'user' ? 'user' : 'machine' };
  let where = e.scope;
  if (e.scope === 'machine') { try { writeJson(path.join(MACHINE_DIR, 'managed.json'), e); } catch { where = 'user'; } }
  if (where === 'user') writeJson(P.userEnroll, { ...e, scope: 'user' });
  policyCache = null; refreshPolicy(); logEvent('enroll', { scope: where });
  return { ok: true, scope: where };
}
function unenroll(password) {
  const e = enrollment(); if (!e) return { ok: true };
  const pol = refreshPolicy();
  if (!checkPw(password, pol && pol.pwHash)) { logEvent('admin_fail', { where: 'retrait du poste' }); throw new Error('Mot de passe administrateur incorrect.'); }
  logEvent('unenroll', {});
  for (const f of [path.join(MACHINE_DIR, 'managed.json'), P.userEnroll]) { try { fs.rmSync(f, { force: true }); } catch { /* droits */ } }
  policyCache = null;
  return { ok: true };
}
/** Règles en vigueur (vérifiées) ; repli sur la dernière copie valide si le dossier est inaccessible. */
function refreshPolicy() {
  const e = enrollment(); if (!e) { policyCache = null; return null; }
  const raw = readPolicyRaw(e.folder);
  if (raw && verifyPolicy(raw, e.pub)) { policyCache = raw.payload; writeJson(P.policyCache, raw); return policyCache; }
  if (raw) { const h = crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex'); if (h !== lastTamper) { lastTamper = h; logEvent('policy_tampered', { note: 'signature invalide' }); } }
  const cached = readJson(P.policyCache);
  policyCache = cached && verifyPolicy(cached, e.pub) ? cached.payload : policyCache;
  return policyCache;
}
function effective() {
  const pol = policyCache || refreshPolicy();
  if (!pol) return { managed: false, blocked: false, features: Object.fromEntries(Object.keys(FEATURES).map((k) => [k, true])), message: '', user, host };
  const u = pol.users[`${host}\\${user}`.toLowerCase()] || pol.users[user.toLowerCase()] || pol.users[`${host}\\*`.toLowerCase()] || {};
  const features = {};
  for (const k of Object.keys(FEATURES)) features[k] = u.features && typeof u.features[k] === 'boolean' ? u.features[k] : pol.defaults[k] !== false;
  return { managed: true, blocked: !!u.blocked, features, message: pol.message || '', user, host, labels: FEATURES, updated: pol.updated };
}
function can(feature) { const e = effective(); return !e.blocked && e.features[feature] !== false; }
function guard(feature, what) {
  if (can(feature)) return;
  logEvent('blocked', { feature, action: what || FEATURES[feature] });
  throw new Error(`BLOQUE_ADMIN: « ${FEATURES[feature] || feature} » est désactivé par l'administrateur.`);
}

// ---------------------------------------------------------------- journal
function logEvent(type, detail = {}) {
  try {
    const e = enrollment(); const pol = policyCache;
    if (detail.file && pol && pol.logFileNames === false) delete detail.file;
    const line = JSON.stringify({ ts: new Date().toISOString(), host, user, type, detail, v: A && A.app.getVersion() }) + '\n';
    const targets = [];
    if (e) targets.push(path.join(e.folder, 'events', `${host}__${user}.jsonl`.replace(/[\\/:*?"<>|]/g, '_')));
    const cfg = adminCfg(); if (cfg && (!e || path.resolve(e.folder) !== path.resolve(cfg.folder))) targets.push(path.join(cfg.folder, 'events', `${host}__${user}.jsonl`.replace(/[\\/:*?"<>|]/g, '_')));
    for (const f of targets) {
      try { fs.mkdirSync(path.dirname(f), { recursive: true }); flushPending(f); fs.appendFileSync(f, line); }
      catch { fs.appendFileSync(P.pending, line); } // dossier inaccessible (hors réseau) : envoi différé
    }
  } catch { /* le journal ne doit jamais bloquer l'application */ }
}
function flushPending(f) {
  if (!fs.existsSync(P.pending)) return;
  const data = fs.readFileSync(P.pending, 'utf8'); if (!data) return;
  fs.appendFileSync(f, data); fs.writeFileSync(P.pending, '');
}
function readAllEvents(limit = 2000) {
  requireSession(); const cfg = adminCfg(); const dir = path.join(cfg.folder, 'events');
  const all = [];
  for (const f of safeReaddir(dir).filter((x) => x.endsWith('.jsonl'))) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).slice(-limit);
    for (const l of lines) { try { all.push(JSON.parse(l)); } catch { /* ligne incomplète */ } }
  }
  all.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  const posts = {};
  for (const e of all) {
    const k = `${e.host}\\${e.user}`;
    if (!posts[k]) posts[k] = { host: e.host, user: e.user, last: e.ts, lastType: e.type, version: e.v, count: 0, blocked: 0 };
    posts[k].count++; if (e.type === 'blocked' || e.type === 'user_blocked') posts[k].blocked++;
  }
  return { events: all.slice(0, limit), posts: Object.values(posts), labels: EVENTS };
}
function safeReaddir(d) { try { return fs.readdirSync(d); } catch { return []; } }

// ---------------------------------------------------------------- notifications (PC administrateur)
function describe(e) {
  const d = e.detail || {};
  const extra = d.action || d.file || d.feature || d.where || d.note || '';
  return `${e.user} sur ${e.host}${extra ? ' — ' + extra : ''}`;
}
function notify(title, body) {
  const cfg = adminCfg(); if (!cfg) return;
  if (cfg.notify.windows !== false && A.Notification.isSupported()) {
    const n = new A.Notification({ title, body, icon: A.iconPath });
    n.on('click', () => openConsole()); n.show();
  }
  if (cfg.notify.ntfy) { // notification sur le téléphone (application gratuite « ntfy »)
    fetch(`https://ntfy.sh/${cfg.notify.ntfy}`, { method: 'POST', body: `\n${body}`, headers: { Title: 'EduPDF Studio', Tags: 'bell' } }).catch(() => {});
  }
}
function pollEvents() {
  const cfg = adminCfg(); if (!cfg) return;
  const dir = path.join(cfg.folder, 'events'); const cursor = cfg.cursor || {}; let changed = false; const fresh = [];
  for (const f of safeReaddir(dir).filter((x) => x.endsWith('.jsonl'))) {
    const full = path.join(dir, f); let size = 0;
    try { size = fs.statSync(full).size; } catch { continue; }
    const from = cursor[f] === undefined ? size : Math.min(cursor[f], size); // nouveau fichier : on ne rejoue pas l'historique
    if (cursor[f] === undefined && size > 0) {
      // nouveau poste : on reprend ses événements survenus depuis la dernière surveillance
      const since = cfg.lastPoll || cfg.created;
      const lines = fs.readFileSync(full, 'utf8').split('\n').filter(Boolean);
      for (const l of lines.slice(-200)) { try { const e = JSON.parse(l); if (e.ts > since) fresh.push(e); } catch { /* */ } }
    }
    if (size > from) {
      const fd = fs.openSync(full, 'r'); const buf = Buffer.alloc(size - from); fs.readSync(fd, buf, 0, buf.length, from); fs.closeSync(fd);
      for (const l of buf.toString('utf8').split('\n').filter(Boolean)) { try { fresh.push(JSON.parse(l)); } catch { /* */ } }
    }
    if (cursor[f] !== size) { cursor[f] = size; changed = true; }
  }
  cfg.cursor = cursor; cfg.lastPoll = new Date().toISOString(); if (changed || fresh.length || !cfg.lastPollSaved || Date.now() - Date.parse(cfg.lastPollSaved) > 600000) { cfg.lastPollSaved = cfg.lastPoll; writeJson(P.admin, cfg); }
  const types = new Set(cfg.notify.types || DEFAULT_NOTIFY);
  const toShow = fresh.filter((e) => types.has(e.type) && !(e.host === host && e.user === user && e.type === 'admin_fail' && consoleWin));
  for (const e of toShow.slice(0, 5)) notify(`EduPDF — ${EVENTS[e.type] || e.type}`, describe(e));
  if (toShow.length > 5) notify('EduPDF', `${toShow.length - 5} autre(s) événement(s) — ouvrez la console d'administration.`);
  if (consoleWin && !consoleWin.isDestroyed() && fresh.length) consoleWin.webContents.send('admin-events-changed');
  return fresh;
}
function startWatcher() {
  if (watchTimer || !adminCfg()) return;
  pollEvents(); watchTimer = setInterval(pollEvents, 15000);
}

// ---------------------------------------------------------------- démarrage, icône de notification, console
function applyStartup() {
  const cfg = adminCfg(); if (!cfg || !A.app.isPackaged) return;
  A.app.setLoginItemSettings({ openAtLogin: !!cfg.notify.startup, args: ['--admin-tray'] });
}
function ensureTray() {
  if (tray || !adminCfg()) return;
  tray = new A.Tray(A.nativeImage.createFromPath(A.iconPath).resize({ width: 16, height: 16 }));
  tray.setToolTip('EduPDF Studio — surveillance administrateur');
  tray.setContextMenu(A.Menu.buildFromTemplate([
    { label: 'Console d\'administration', click: openConsole },
    { label: 'Ouvrir EduPDF Studio', click: () => A.openMain() },
    { type: 'separator' },
    { label: 'Quitter', click: () => { A.app.exit(0); } }
  ]));
  tray.on('click', openConsole);
}
function openConsole() {
  if (consoleWin && !consoleWin.isDestroyed()) { consoleWin.show(); consoleWin.focus(); return; }
  consoleWin = new A.BrowserWindow({
    width: 1180, height: 820, title: 'EduPDF — Administration', icon: A.iconPath, autoHideMenuBar: true,
    webPreferences: { preload: A.preloadAdmin, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  consoleWin.setMenu(null);
  consoleWin.loadFile(path.join(__dirname, 'renderer', 'admin.html'));
  consoleWin.webContents.on('will-navigate', (e) => e.preventDefault());
  consoleWin.on('closed', () => { consoleWin = null; session = null; });
}
function hasTrayOrConsole() { return !!tray; }

// ---------------------------------------------------------------- IPC
function init(deps) {
  A = deps; const ud = A.app.getPath('userData');
  Object.assign(P, { admin: path.join(ud, 'admin.json'), userEnroll: path.join(ud, 'managed.json'), policyCache: path.join(ud, 'policy-cache.json'), pending: path.join(ud, 'pending-events.jsonl') });
  try { A.app.setAppUserModelId('com.edupdf.studio'); } catch { /* */ }
  refreshPolicy();
  setInterval(refreshPolicy, 60000);
  const ip = A.ipcMain;
  const h = (name, fn) => ip.handle(name, async (_e, arg) => fn(arg || {}));
  // côté application
  h('policy', () => effective());
  h('log-event', ({ type, detail }) => { if (['blocked', 'export', 'print', 'cloud', 'sign', 'protect', 'save'].includes(type)) logEvent(type, detail); });
  h('admin-status', () => ({ admin: !!adminCfg(), adminFolder: adminCfg() && adminCfg().folder, enrollment: enrollment(), defaultFolder: path.join(MACHINE_DIR, 'gestion'), host, user }));
  h('admin-open-console', () => { openConsole(); return true; });
  h('admin-setup', (a) => { const r = setupAdmin(a); openConsole(); return r; });
  h('admin-enroll', (a) => enroll(a));
  h('admin-unenroll', ({ password }) => unenroll(password));
  h('admin-pick-folder', async () => { const r = await A.dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: 'Dossier de gestion' }); return r.canceled ? null : r.filePaths[0]; });
  // console
  h('admin-login', ({ password }) => adminLogin(password));
  h('admin-get', () => getPolicyForAdmin());
  h('admin-save', ({ policy }) => savePolicy(policy));
  h('admin-events', ({ limit }) => readAllEvents(limit));
  h('admin-notify-save', (n) => saveNotify(n));
  h('admin-notify-test', () => { notify('EduPDF — test', 'Les notifications fonctionnent.'); return true; });
  h('admin-change-password', ({ oldPw, newPw }) => changePassword(oldPw, newPw));
  h('admin-show-folder', () => { const c = adminCfg(); if (c) A.shell.openPath(c.folder); return true; });
  if (adminCfg()) { startWatcher(); ensureTray(); }
}

module.exports = { init, guard, can, logEvent, effective, openConsole, hasTrayOrConsole, FEATURES, EVENTS, _test: { setupAdmin, adminLogin, savePolicy, enroll, unenroll, refreshPolicy, effective, pollEvents, readAllEvents, verifyPolicy } };
