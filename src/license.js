// SknEDU-studio — éditions commerciales, essai et fonctions Premium.
// - Compte obligatoire (adresse e-mail) et essai de 30 jours lié au poste : voir account.js.
// - Pendant l'essai, ou avec une licence valide, les fonctions Premium sont disponibles.
// - Après l'essai, sans licence : version gratuite (lecture, annotation, organisation des pages, impression…).
// Licences en ligne (v2, recommandées) : émises pour une adresse e-mail et une durée ; activées sur UN poste à la fois par le
// service d'activation (server/), transférables après désactivation pour leurs jours restants, au plus 2 cumulées.
// Le service renvoie un jeton signé, vérifié hors ligne et renouvelé en ligne au moins tous les 14 jours.
// Licences hors ligne (v1, anciennes) : date de fin fixe, liées à l'e-mail et éventuellement à des codes de postes.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const account = require('./account');

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAAWJBQvHRbjGXeR/8N0o1OQtxGqcDumYikk/rFmLnNyQ=
-----END PUBLIC KEY-----`;
const EDITIONS = { communaute: 'Gratuite', enseignant: 'Enseignant', etablissement: 'Établissement' };
let COMMERCIAL = {}; try { COMMERCIAL = require('../package.json').commercial || {}; } catch { /* */ }

let A = null; const P = {};
const DAY = 86400000;
const testMode = () => !!process.env.EDUPDF_SELFTEST;
// adresse et clé publique du service d'activation (package.json › commercial ; remplaçables en auto-test seulement)
const serverUrl = () => ((testMode() && process.env.EDUPDF_LICENCE_SERVER) || COMMERCIAL.licenceServer || '').replace(/\/+$/, '');
// rotation des clés : serverPublicKey peut être une liste (clé actuelle + clé suivante)
const serverKeys = () => [].concat((testMode() && process.env.EDUPDF_TEST_SERVER_PUBKEY) || COMMERCIAL.serverPublicKey || []).filter(Boolean);
const serverKey = () => serverKeys()[0] || '';
const licenceKeys = () => [PUBLIC_KEY, ...[].concat(COMMERCIAL.licencePublicKeys || []), ...(testMode() && process.env.EDUPDF_TEST_LICENCE_PUBKEY ? [process.env.EDUPDF_TEST_LICENCE_PUBKEY] : [])];

/** Vérifie une clé « SKN1.<données>.<signature> » ; retourne la licence ou une erreur lisible. */
function verify(text) {
  const m = /SKN1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/.exec(String(text || ''));
  if (!m) return { ok: false, error: 'Clé de licence illisible (elle commence par « SKN1. »).' };
  let ok = false;
  for (const k of licenceKeys()) { try { ok = ok || crypto.verify(null, Buffer.from(m[1]), k, Buffer.from(m[2], 'base64url')); } catch { /* clé suivante */ } }
  if (!ok) return { ok: false, error: 'Clé de licence invalide (signature incorrecte).' };
  let lic; try { lic = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); } catch { return { ok: false, error: 'Clé de licence endommagée.' }; }
  // clés émises sous les anciens noms du produit acceptées
  if (!['SknEDU-studio', 'SknEDUpdf-studio'].includes(lic.product) || !['enseignant', 'etablissement'].includes(lic.edition)) return { ok: false, error: 'Cette clé ne concerne pas SknEDU-studio.' };
  return { ok: true, key: m[0], lic };
}
/** Licence utilisable sur ce poste et pour ce compte ? */
function bindingError(lic) {
  const acc = account.status().account;
  if (lic.email && acc && lic.email.trim().toLowerCase() !== acc.email) return `Cette licence est au nom de ${lic.email} : le compte de ce poste est ${acc.email}.`;
  if (Array.isArray(lic.machines) && lic.machines.length && !lic.machines.map((c) => String(c).toUpperCase()).includes(account.machineCode())) return `Cette licence est prévue pour un autre poste (code de ce poste : ${account.machineCode()}).`;
  return null;
}
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const expiredAt = (d) => new Date(d + 'T23:59:59') < new Date();

// ---------------------------------------------------------------- Licences en ligne (jeton du service d'activation)
function readToken() {
  const t = read(P.token); const key = serverKey(); if (!t || !key) return null;
  const m = /^SKNT\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\s*$/.exec(t); if (!m) return null;
  let ok = false; for (const k of serverKeys()) { try { ok = ok || crypto.verify(null, Buffer.from(m[1]), k, Buffer.from(m[2], 'base64url')); } catch { /* clé suivante */ } }
  if (!ok) return null;
  let p; try { p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); } catch { return null; }
  const acc = account.status().account;
  if (p.machine !== account.machineId() || !acc || p.email !== acc.email) return null; // jeton d'un autre poste ou d'un autre compte
  return p;
}
function onlineStatus() {
  const p = readToken(); if (!p) return null;
  const t = account.now(); const needsCheck = t >= p.refreshBy;
  return { edition: p.edition || 'communaute', label: EDITIONS[p.edition] || EDITIONS.communaute, org: p.org, online: true, licences: p.licences || [],
    expires: new Date(p.end).toISOString().slice(0, 10), daysLeft: Math.max(0, Math.ceil((p.end - t) / DAY)), expired: t >= p.end || !(p.licences || []).length,
    needsCheck, checkedAt: p.issued, mismatch: needsCheck ? 'Licence à revérifier : connectez l\'ordinateur à Internet puis ouvrez Aide › Licence et édition (vérification au moins tous les 14 jours).' : null };
}
async function api(route, body) {
  const url = serverUrl(); if (!url) throw new Error('Le service d\'activation des licences n\'est pas encore configuré : contactez l\'éditeur.');
  const acc = account.status().account; if (!acc) throw new Error('Créez d\'abord votre compte.');
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 20000);
  let res;
  try { res = await fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, email: acc.email, machine: account.machineId() }), signal: ctrl.signal }); }
  catch { throw new Error('Connexion impossible au service d\'activation : vérifiez la connexion Internet.'); }
  finally { clearTimeout(timer); }
  let j = {}; try { j = await res.json(); } catch { /* */ }
  if (!j.ok) throw new Error(j.error || `Service d'activation indisponible (HTTP ${res.status}).`);
  if (j.token) { fs.mkdirSync(path.dirname(P.token), { recursive: true }); fs.writeFileSync(P.token, j.token + '\n'); }
  return j;
}
async function refresh() { if (!read(P.token) || !serverUrl()) return status(); try { await api('/v1/status', {}); } catch { /* hors connexion : nouvel essai plus tard */ } return status(); }
async function deactivate(ref) {
  const j = await api('/v1/deactivate', { ref: String(ref || '') });
  return { remainingDays: j.remainingDays, ...status() };
}

function licenceStatus() {
  const on = onlineStatus(); if (on && on.licences.length) return { ...on, scope: 'user' };
  for (const [f, scope] of [[P.user, 'user'], [P.machine, 'machine']]) {
    const t = read(f); if (!t) continue;
    const v = verify(t); if (!v.ok) continue;
    const L = v.lic; const days = Math.ceil((new Date(L.expires + 'T23:59:59') - new Date()) / 864e5);
    return { edition: L.edition, label: EDITIONS[L.edition], org: L.org, seats: L.seats, expires: L.expires, expired: expiredAt(L.expires),
      daysLeft: days, support: L.support || '', email: L.email || '', ref: L.ref, scope, mismatch: bindingError(L) };
  }
  return { edition: 'communaute', label: EDITIONS.communaute, org: '', expired: false };
}
/** Moyens de paiement et offres (package.json › commercial ; remplaçables en auto-test seulement). */
function sales() {
  let c = COMMERCIAL; if (testMode() && process.env.EDUPDF_TEST_SALES) { try { c = { ...c, ...JSON.parse(process.env.EDUPDF_TEST_SALES) }; } catch { /* */ } }
  return { vendeur: c.vendeur || '', whatsapp: String(c.whatsapp || '').replace(/[^\d]/g, ''), email: /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(c.email || '') ? c.email : '',
    page: /^https:\/\//i.test(c.page || '') ? c.page : '', devise: c.devise || 'FCFA',
    mobileMoney: (c.mobileMoney || []).filter((m) => m && m.numero), offres: (c.offres || []).filter((o) => o && o.id && o.jours > 0) };
}
function status() {
  const lic = licenceStatus(); const acc = account.status();
  const licValid = lic.edition !== 'communaute' && !lic.expired && !lic.mismatch;
  const trial = acc.trial.active;
  return { ...lic, account: acc.account, trial: acc.trial, machineCode: acc.machineCode,
    licValid, premium: licValid || trial, establishment: (licValid && lic.edition === 'etablissement') || trial,
    mode: licValid ? 'licence' : trial ? 'essai' : 'gratuit', buyUrl: COMMERCIAL.buyUrl || '', contact: COMMERCIAL.contact || '', sales: sales() };
}
/** Contrôle côté système (en plus de l'interface) pour les fonctions Premium. */
function requirePremium(label, establishment) {
  const s = status();
  if (establishment ? s.establishment : s.premium) return;
  throw new Error(`PREMIUM: « ${label} » fait partie des fonctions ${establishment ? 'de l\'édition Établissement' : 'Premium'}. ${s.trial.ended ? 'Votre essai est terminé : ' : ''}activez une licence (Aide › Licence et édition).`);
}
async function activate(text, scope) {
  if (!account.status().account) throw new Error('Créez d\'abord votre compte.');
  const v = verify(text); if (!v.ok) throw new Error(v.error);
  if (v.lic.v === 2) { // licence en ligne : un seul poste à la fois, jours restants transférables
    const acc = account.status().account;
    if (v.lic.email && v.lic.email.trim().toLowerCase() !== acc.email) throw new Error(`Cette licence est au nom de ${v.lic.email} : le compte de ce poste est ${acc.email}.`);
    await api('/v1/activate', { key: v.key }); return status();
  }
  const b = bindingError(v.lic); if (b) throw new Error(b);
  if (expiredAt(v.lic.expires)) throw new Error(`Cette licence a expiré le ${v.lic.expires}.`);
  const f = scope === 'machine' ? P.machine : P.user;
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, v.key + '\n'); }
  catch { if (scope === 'machine') { fs.mkdirSync(path.dirname(P.user), { recursive: true }); fs.writeFileSync(P.user, v.key + '\n'); } else throw new Error('Enregistrement de la licence impossible.'); }
  return status();
}
function remove() { try { fs.rmSync(P.user, { force: true }); } catch { /* */ } return status(); }

function init(deps) {
  A = deps;
  account.init(deps);
  P.user = path.join(A.app.getPath('userData'), 'licence.sknlic');
  P.token = path.join(A.app.getPath('userData'), 'licence-jeton.sknt');
  P.machine = path.join(process.env.EDUPDF_MACHINE_DIR || (process.platform === 'win32' ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'EduPDF') : process.platform === 'darwin' ? '/Users/Shared/EduPDF' : '/var/tmp/EduPDF'), 'licence.sknlic');
  A.ipcMain.handle('license-status', () => status());
  A.ipcMain.handle('license-activate', (_e, { text, scope }) => activate(text, scope));
  A.ipcMain.handle('license-remove', () => remove());
  A.ipcMain.handle('license-deactivate', (_e, { ref }) => deactivate(ref));
  A.ipcMain.handle('license-refresh', () => refresh());
  setTimeout(() => { refresh(); }, 8000); setInterval(() => { refresh(); }, 12 * 3600000).unref(); // vérification en ligne régulière
  A.ipcMain.handle('license-pick', async () => {
    const r = await A.dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Licence SknEDU-studio', extensions: ['sknlic', 'txt'] }] });
    return r.canceled ? null : read(r.filePaths[0]);
  });
  A.ipcMain.handle('notices', () => read(path.join(__dirname, '..', 'THIRD_PARTY_NOTICES.md')) || 'Liste indisponible.');
}

module.exports = { init, verify, status, requirePremium, activate, deactivate, refresh, EDITIONS };
