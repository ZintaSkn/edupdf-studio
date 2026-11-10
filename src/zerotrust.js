// SknEDU-studio — socle Zero Trust : « ne jamais faire confiance, toujours vérifier ».
//
// Modèle AAA
//  - Authentification : essais de mot de passe limités (verrouillage progressif), voir attempts.
//  - Autorisation     : chaque appel interne (IPC) est vérifié à l'arrivée — il doit venir de la page du logiciel
//                       elle-même, dans sa fenêtre principale ; tout autre appelant est refusé et consigné (guardIpc).
//  - Traçabilité      : journal de sécurité local, chaîné et scellé (HMAC-SHA-256) : une ligne modifiée, supprimée ou
//                       ajoutée à la main se voit à la vérification (audit).
// Modèle CIA : confidentialité et intégrité s'appuient sur la clé de données du poste (AES-256-GCM, protégée par
// Windows) fournie par le processus principal ; la disponibilité est traitée dans main.js (reprise après plantage).
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

let A = null; // { app, key: () => Buffer }
const pending = []; // évènements survenus avant que la clé soit disponible
const APP_URL = pathToFileURL(path.join(__dirname, 'renderer')).href.replace(/\/?$/, '/').toLowerCase();

// ---------------------------------------------------------------- Autorisation des appels internes
/** L'appel vient-il d'une page du logiciel (dossier renderer), dans le cadre principal de sa fenêtre ? */
function trustedSender(e) {
  try {
    const f = e.senderFrame; if (!f || !e.sender || e.sender.isDestroyed()) return false;
    if (f !== e.sender.mainFrame) return false; // jamais un cadre intégré
    return String(f.url || '').toLowerCase().startsWith(APP_URL);
  } catch { return false; }
}
/** Enveloppe ipcMain : tout canal enregistré ensuite vérifie son appelant avant d'exécuter quoi que ce soit. */
function guardIpc(ipcMain) {
  const refuse = (channel, e) => { let from = ''; try { from = String(e.senderFrame && e.senderFrame.url).slice(0, 120); } catch { /* */ } audit('appel_refuse', { canal: channel, origine: from }); };
  for (const m of ['handle', 'handleOnce']) {
    const orig = ipcMain[m].bind(ipcMain);
    ipcMain[m] = (channel, fn) => orig(channel, (e, ...args) => { if (!trustedSender(e)) { refuse(channel, e); throw new Error('Appel non autorisé.'); } return fn(e, ...args); });
  }
  for (const m of ['on', 'once']) {
    const orig = ipcMain[m].bind(ipcMain);
    ipcMain[m] = (channel, fn) => orig(channel, (e, ...args) => { if (!trustedSender(e)) { refuse(channel, e); try { e.returnValue = null; } catch { /* */ } return undefined; } return fn(e, ...args); });
  }
}

// ---------------------------------------------------------------- Traçabilité : journal de sécurité chaîné
const MAX_LOG = 2 * 1024 * 1024;
const logFile = () => path.join(A.app.getPath('userData'), 'logs', 'securite.jsonl');
let macKey = null; let last = null; // dernier sceau écrit
const key = () => macKey || (macKey = Buffer.from(crypto.hkdfSync('sha256', A.key(), 'SknEDU-studio', 'journal-securite', 32)));
const seal = (prev, body) => crypto.createHmac('sha256', key()).update(prev + '|' + body).digest('base64url');
const lines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
function lastSeal() {
  if (last !== null) return last;
  const l = lines(logFile()); const prevFile = lines(logFile() + '.1');
  const tail = l.length ? l[l.length - 1] : prevFile.length ? prevFile[prevFile.length - 1] : null;
  try { last = tail ? JSON.parse(tail).mac || '' : ''; } catch { last = ''; }
  return last;
}
function write(entry) {
  const f = logFile(); fs.mkdirSync(path.dirname(f), { recursive: true });
  try { if (fs.statSync(f).size > MAX_LOG) fs.renameSync(f, f + '.1'); } catch { /* premier évènement */ }
  const prev = lastSeal(); const body = JSON.stringify({ ...entry, prev });
  last = seal(prev, body); fs.appendFileSync(f, JSON.stringify({ ...entry, prev, mac: last }) + '\n');
}
/** Consigne un évènement de sécurité (qui, quand, quoi). Ne lève jamais d'erreur. */
function audit(type, detail = {}) {
  const entry = { ts: new Date().toISOString(), type, detail, user: (() => { try { return os.userInfo().username; } catch { return ''; } })(), host: os.hostname(), v: A && A.app ? A.app.getVersion() : '' };
  try {
    if (!A || !A.app.isReady()) { if (pending.length < 200) pending.push(entry); return; }
    while (pending.length) write(pending.shift());
    write(entry);
  } catch { if (pending.length < 200) pending.push(entry); }
}
/** Vérifie la chaîne : retourne { ok, count, brokenAt } (brokenAt = numéro de la première ligne altérée). */
function verify() {
  const all = [...lines(logFile() + '.1'), ...lines(logFile())]; let prev = null; let i = 0;
  for (const raw of all) {
    i++;
    let e; try { e = JSON.parse(raw); } catch { return { ok: false, count: all.length, brokenAt: i }; }
    const { mac, ...rest } = e;
    if (prev !== null && rest.prev !== prev) return { ok: false, count: all.length, brokenAt: i }; // ligne supprimée ou insérée
    if (seal(rest.prev, JSON.stringify(rest)) !== mac) return { ok: false, count: all.length, brokenAt: i }; // ligne modifiée
    prev = mac;
  }
  return { ok: true, count: all.length, brokenAt: 0 };
}
function list(limit = 200) {
  const all = [...lines(logFile() + '.1'), ...lines(logFile())];
  return { integrity: verify(), entries: all.slice(-Math.max(1, Math.min(1000, limit))).map((l) => { try { const { mac, prev, ...e } = JSON.parse(l); return e; } catch { return { ts: '', type: 'ligne illisible', detail: {} }; } }).reverse() };
}

// ---------------------------------------------------------------- Authentification : essais limités
// Après 5 échecs : attente de 1 minute, doublée à chaque nouvel échec (15 minutes au plus). Conservé après redémarrage.
const triesFile = () => path.join(A.app.getPath('userData'), 'essais.json');
const readTries = () => { try { return JSON.parse(fs.readFileSync(triesFile(), 'utf8')); } catch { return {}; } };
const saveTries = (t) => { try { fs.writeFileSync(triesFile(), JSON.stringify(t)); } catch { /* */ } };
const attempts = {
  /** Lève une erreur si ce mot de passe est verrouillé pour l'instant. */
  check(scope) {
    const s = readTries()[scope]; const left = s && s.until ? s.until - Date.now() : 0;
    if (left > 0) throw new Error(`Trop d'essais incorrects : réessayez dans ${Math.ceil(left / 60000)} minute(s).`);
  },
  fail(scope) {
    const t = readTries(); const s = t[scope] || { n: 0 }; s.n++;
    if (s.n >= 5) { s.until = Date.now() + Math.min(15, 2 ** (s.n - 5)) * 60000; audit('verrouillage', { quoi: scope, essais: s.n }); }
    t[scope] = s; saveTries(t); return s.n;
  },
  ok(scope) { const t = readTries(); if (t[scope]) { delete t[scope]; saveTries(t); } }
};

function init(deps) { A = deps; }
module.exports = { init, guardIpc, trustedSender, audit, verify, list, attempts, _test: { reset: () => { last = null; macKey = null; }, file: () => logFile(), APP_URL } };
