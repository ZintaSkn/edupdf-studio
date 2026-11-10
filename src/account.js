// SknEDU-studio — compte (adresse e-mail obligatoire) et période d'essai de 30 jours, liée au poste.
//
// L'essai démarre à la création du compte et ne peut pas être recommencé sur le même ordinateur :
// la date de début est conservée à plusieurs endroits (dossier commun du PC, registre de Windows, dossier local,
// données de l'application). Désinstaller, réinstaller ou créer un autre compte Windows ne la remet pas à zéro.
// Les enregistrements sont chiffrés et authentifiés (AES-256-GCM, clé dérivée de l'identifiant du poste) : un enregistrement
// modifié à la main ou copié depuis un autre poste est ignoré.
// Si l'horloge est reculée, l'essai est suspendu jusqu'à ce que la date soit corrigée.
//
// Rien n'est envoyé sur Internet : l'adresse e-mail reste sur l'ordinateur (voir PRIVACY.md).
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const TRIAL_DAYS = 30;
const DAY = 86400000;
const CLOCK_TOLERANCE = 2 * 3600000; // décalage d'horloge toléré (changement d'heure, fuseau)
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;
const SALT = 'SknEDU-studio/essai/v1';
const REG_KEY = 'HKCU\\Software\\SknEDU-studio';

let A = null; let MID = null;
const testMode = () => !!process.env.EDUPDF_SELFTEST;
/** Heure courante ; en auto-test seulement, EDUPDF_NOW_OFFSET_DAYS simule le passage du temps. */
const now = () => Date.now() + (testMode() ? (Number(process.env.EDUPDF_NOW_OFFSET_DAYS) || 0) * DAY : 0);

/** Identifiant stable du poste (jamais l'identifiant brut de Windows). */
function machineId() {
  if (MID) return MID;
  let raw = '';
  try {
    if (process.platform === 'win32') raw = /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(execFileSync('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true, timeout: 5000 }))[1];
    else if (process.platform === 'darwin') raw = /"IOPlatformUUID" = "([^"]+)"/.exec(execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000 }))[1];
    else raw = fs.readFileSync('/etc/machine-id', 'utf8').trim();
  } catch { raw = ''; }
  if (!raw) raw = os.hostname() + '|' + (os.cpus()[0] || {}).model + '|' + os.totalmem();
  if (testMode()) raw = 'poste-de-test';
  MID = crypto.createHash('sha256').update(SALT + '|' + raw).digest('hex').slice(0, 32);
  return MID;
}
/** Code du poste à communiquer au vendeur pour une licence liée à ce PC (format XXXX-XXXX-XXXX-XXXX). */
const machineCode = () => machineId().slice(0, 16).toUpperCase().match(/.{4}/g).join('-');

function files() {
  if (testMode()) { const d = path.join(process.env.EDUPDF_SELFTEST, 'essai'); return ['a', 'b', 'c'].map((n) => path.join(d, n, '.sknedu')); }
  const home = os.homedir(); const list = [];
  if (process.platform === 'win32') {
    list.push(path.join(process.env.ProgramData || 'C:\\ProgramData', 'EduPDF', '.skn-trial'));
    list.push(path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'SknEDU', 'trial.dat'));
  } else if (process.platform === 'darwin') {
    list.push('/Users/Shared/EduPDF/.skn-trial', path.join(home, 'Library', 'Application Support', '.sknedu-trial'));
  } else list.push('/var/tmp/EduPDF/.skn-trial', path.join(home, '.config', '.sknedu-trial'));
  list.push(path.join(A.app.getPath('userData'), 'account.dat'));
  return list;
}
// Enregistrements chiffrés et authentifiés (AES-256-GCM), clé dérivée de l'identité du poste (HKDF-SHA256)
const recKey = () => Buffer.from(crypto.hkdfSync('sha256', machineId(), SALT, 'enregistrement-compte', 32));
const seal = (obj) => {
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', recKey(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return ['G1', iv.toString('base64url'), ct.toString('base64url'), c.getAuthTag().toString('base64url')].join('.');
};
function unseal(text) {
  const g = /^G1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(text || '').trim());
  if (g) {
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', recKey(), Buffer.from(g[1], 'base64url')); d.setAuthTag(Buffer.from(g[3], 'base64url'));
      const r = JSON.parse(Buffer.concat([d.update(Buffer.from(g[2], 'base64url')), d.final()]).toString('utf8'));
      return r && r.m === machineId() && Number.isFinite(r.start) ? r : null;
    } catch { return null; } // enregistrement modifié ou d'un autre poste
  }
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(text || '').trim()); if (!m) return null; // ancien format (scellé HMAC), relu puis réécrit chiffré
  const sig = crypto.createHmac('sha256', SALT + machineId()).update(m[1]).digest('base64url');
  if (sig.length !== m[2].length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(m[2]))) return null;
  try { const r = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); return r && r.m === machineId() && Number.isFinite(r.start) ? r : null; } catch { return null; }
}
function regRead() {
  if (process.platform !== 'win32' || testMode()) return null;
  try { return /\sT\s+REG_SZ\s+(\S+)/.exec(execFileSync('reg.exe', ['query', REG_KEY, '/v', 'T'], { encoding: 'utf8', windowsHide: true, timeout: 5000 }))[1]; } catch { return null; }
}
function regWrite(v) {
  if (process.platform !== 'win32' || testMode()) return;
  try { execFileSync('reg.exe', ['add', REG_KEY, '/v', 'T', '/t', 'REG_SZ', '/d', v, '/f'], { windowsHide: true, timeout: 5000 }); } catch { /* registre indisponible */ }
}
// Lecture mise en cache 5 minutes : le statut est demandé à chaque fonction Premium (OCR page par page, conversions…)
// et la lecture du registre lance un programme ; toute écriture met le cache à jour.
let CACHE = null; const CACHE_MS = 5 * 60000;
function readAll() {
  if (CACHE && Date.now() - CACHE.at < CACHE_MS && !testMode()) return CACHE.recs;
  const recs = [];
  for (const f of files()) { try { const r = unseal(fs.readFileSync(f, 'utf8')); if (r) recs.push(r); } catch { /* absent */ } }
  const r = unseal(regRead()); if (r) recs.push(r);
  CACHE = { at: Date.now(), recs };
  return recs;
}
function writeAll(rec) {
  const blob = seal(rec); CACHE = null;
  for (const f of files()) { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, blob); } catch { /* emplacement protégé : les autres suffisent */ } }
  regWrite(blob);
}
/** Fusion des enregistrements : le plus ancien début d'essai et la dernière date vue l'emportent toujours. */
function merged() {
  const recs = readAll(); if (!recs.length) return null;
  const latest = recs.reduce((a, b) => ((b.updated || 0) > (a.updated || 0) ? b : a));
  return { v: 1, m: machineId(), email: latest.email, name: latest.name || '', org: latest.org || '', created: Math.min(...recs.map((r) => r.created || r.start)),
    start: Math.min(...recs.map((r) => r.start)), seen: Math.max(...recs.map((r) => r.seen || r.start)), updated: latest.updated || 0, n: recs.length };
}
function status() {
  const r = merged();
  if (!r) return { account: null, trial: { days: TRIAL_DAYS, active: false, started: false }, machineCode: machineCode() };
  const t = now(); const end = r.start + TRIAL_DAYS * DAY; const clockBack = t < r.seen - CLOCK_TOLERANCE;
  return {
    account: { email: r.email, name: r.name, org: r.org, created: r.created },
    trial: { days: TRIAL_DAYS, started: true, start: r.start, end, daysLeft: Math.max(0, Math.ceil((end - t) / DAY)), active: !clockBack && t < end, ended: t >= end, clockBack },
    machineCode: machineCode()
  };
}
/** Création (ou mise à jour) du compte : l'essai garde toujours sa date de début d'origine. */
function save({ email, name, org }) {
  email = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw new Error('Adresse e-mail invalide.');
  const old = merged(); const t = now();
  if (old && t < old.seen - CLOCK_TOLERANCE) throw new Error('La date de l\'ordinateur est antérieure à la dernière utilisation : corrigez la date et l\'heure de Windows.');
  writeAll({ v: 1, m: machineId(), email, name: String(name || '').trim().slice(0, 80), org: String(org || '').trim().slice(0, 120),
    created: old ? old.created : t, start: old ? old.start : t, seen: Math.max(t, old ? old.seen : t), updated: t });
  return status();
}
/** Mémorise la dernière date d'utilisation (détection d'une horloge reculée) et répare les emplacements effacés. */
function touch() {
  const r = merged(); if (!r) return; const t = now();
  if (t < r.seen - CLOCK_TOLERANCE) return;
  if (t > r.seen + 60000 || r.n < files().length) writeAll({ ...r, seen: Math.max(r.seen, t) });
}

function init(deps) {
  A = deps;
  touch(); setInterval(touch, 3600000).unref();
  A.ipcMain.handle('account-status', () => status());
  A.ipcMain.handle('account-save', (_e, data) => { const r = save(data || {}); require('./zerotrust').audit('compte_enregistre', {}); return r; });
}

module.exports = { init, status, save, touch, machineId, machineCode, now, TRIAL_DAYS, EMAIL_RE };
