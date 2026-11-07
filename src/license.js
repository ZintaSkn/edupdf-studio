// SknEDU-studio — éditions commerciales (open core).
// Le logiciel reste entièrement utilisable en édition Communauté (AGPL-3.0). Une licence signée par l'éditeur
// identifie l'édition Enseignant ou Établissement : nom de l'établissement dans l'application et les modèles,
// support prioritaire, déploiement. Elle se vérifie hors ligne (signature Ed25519).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAAWJBQvHRbjGXeR/8N0o1OQtxGqcDumYikk/rFmLnNyQ=
-----END PUBLIC KEY-----`;
const EDITIONS = { communaute: 'Communauté', enseignant: 'Enseignant', etablissement: 'Établissement' };

let A = null; const P = {};

/** Vérifie une clé « SKN1.<données>.<signature> » ; retourne la licence ou une erreur lisible. */
function verify(text) {
  const m = /SKN1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/.exec(String(text || ''));
  if (!m) return { ok: false, error: 'Clé de licence illisible (elle commence par « SKN1. »).' };
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(m[1]), PUBLIC_KEY, Buffer.from(m[2], 'base64url')); } catch { ok = false; }
  if (!ok) return { ok: false, error: 'Clé de licence invalide (signature incorrecte).' };
  let lic; try { lic = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); } catch { return { ok: false, error: 'Clé de licence endommagée.' }; }
  if (!['SknEDU-studio', 'SknEDUpdf-studio'].includes(lic.product) || !EDITIONS[lic.edition]) return { ok: false, error: 'Cette clé ne concerne pas SknEDU-studio.' };
  return { ok: true, key: m[0], lic };
}
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

/** Licence en vigueur : celle de l'utilisateur, sinon celle installée pour tout le PC (déploiement établissement). */
function status() {
  for (const [f, scope] of [[P.user, 'user'], [P.machine, 'machine']]) {
    const t = read(f); if (!t) continue;
    const v = verify(t); if (!v.ok) continue;
    const expired = new Date(v.lic.expires + 'T23:59:59') < new Date();
    const days = Math.ceil((new Date(v.lic.expires + 'T23:59:59') - new Date()) / 864e5);
    return { edition: v.lic.edition, label: EDITIONS[v.lic.edition], org: v.lic.org, seats: v.lic.seats, expires: v.lic.expires,
      expired, daysLeft: days, support: v.lic.support || '', email: v.lic.email || '', ref: v.lic.ref, scope };
  }
  return { edition: 'communaute', label: EDITIONS.communaute, org: '', expired: false };
}
function activate(text, scope) {
  const v = verify(text); if (!v.ok) throw new Error(v.error);
  const f = scope === 'machine' ? P.machine : P.user;
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, v.key + '\n'); }
  catch { if (scope === 'machine') { fs.mkdirSync(path.dirname(P.user), { recursive: true }); fs.writeFileSync(P.user, v.key + '\n'); } else throw new Error('Enregistrement de la licence impossible.'); }
  return status();
}
function remove() { try { fs.rmSync(P.user, { force: true }); } catch { /* */ } return status(); }

function init(deps) {
  A = deps;
  P.user = path.join(A.app.getPath('userData'), 'licence.sknlic');
  P.machine = path.join(process.env.EDUPDF_MACHINE_DIR || (process.platform === 'win32' ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'EduPDF') : process.platform === 'darwin' ? '/Users/Shared/EduPDF' : '/var/tmp/EduPDF'), 'licence.sknlic');
  A.ipcMain.handle('license-status', () => status());
  A.ipcMain.handle('license-activate', (_e, { text, scope }) => activate(text, scope));
  A.ipcMain.handle('license-remove', () => remove());
  A.ipcMain.handle('license-pick', async () => {
    const r = await A.dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Licence SknEDU-studio', extensions: ['sknlic', 'txt'] }] });
    return r.canceled ? null : read(r.filePaths[0]);
  });
  A.ipcMain.handle('notices', () => read(path.join(__dirname, '..', 'THIRD_PARTY_NOTICES.md')) || 'Liste indisponible.');
}

module.exports = { init, verify, status, EDITIONS };
