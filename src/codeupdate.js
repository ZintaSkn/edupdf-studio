// SknEDU-studio — mise à jour du contenu de l'application, sans installateur.
//
// Pourquoi : le contrôle intelligent des applications de Windows 11 bloque tout installateur non signé. Or le programme
// lui-même (Electron d'origine, jamais modifié) reste identique tant que la version d'Electron ne change pas : seul le
// contenu de l'application change (resources\app.asar et resources\app.asar.unpacked), qui n'est pas un programme.
// Ce module télécharge ce contenu, vérifie sa signature Ed25519 (clé de mise à jour de l'éditeur, conservée hors de
// GitHub) et ses empreintes SHA-512, puis le met en place après la fermeture, par le programme lui-même en mode Node
// (src/maj-appliquer.js), avec copie de l'ancienne version et retour arrière si le redémarrage échoue.
// Utilisé quand l'installateur ne peut pas être lancé (contrôle intelligent actif) et pour la version sans installation.
'use strict';
const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');

// Clés publiques de mise à jour (rotation : ajouter la clé suivante ici dans une version, puis signer avec elle)
const KEYS = [`-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAT/GYpf4sHbYcbaDDXQeYSBUgPabNa9Y/FDJUgg8VfRE=
-----END PUBLIC KEY-----`];
const REPO = 'ZintaSkn/edupdf-studio';
const PRODUCT = 'SknEDU-studio';
const names = (v) => ({
  manifest: `${PRODUCT}-${v}-contenu.json`, toSign: `${PRODUCT}-${v}-contenu-a-signer.json`,
  asar: `${PRODUCT}-${v}-app.asar`, unpacked: `${PRODUCT}-${v}-app.asar.unpacked.zip`
});
const assetUrl = (v, name, base) => `${base || `https://github.com/${REPO}/releases/download`}/v${v}/${name}`;

let ofs = null; // fs sans prise en charge des archives .asar (sinon « app.asar » serait vu comme un dossier)
const rawFs = () => ofs || (ofs = (() => { try { return require('original-fs'); } catch { return require('fs'); } })());

/** Empreinte d'une arborescence : chemins triés + SHA-256 de chaque fichier (identique côté éditeur et côté poste). */
function treeHashOf(entries) {
  const h = crypto.createHash('sha256');
  for (const e of [...entries].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))) h.update(e.rel + '\0' + crypto.createHash('sha256').update(e.data).digest('hex') + '\n');
  return h.digest('hex');
}
function dirEntries(dir) {
  const fs = rawFs(); const out = [];
  const walk = (d) => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, n.name); if (n.isDirectory()) walk(p); else if (n.isFile()) out.push({ rel: path.relative(dir, p).split(path.sep).join('/'), data: fs.readFileSync(p) }); } };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}
const treeHash = (dir) => treeHashOf(dirEntries(dir));
const sha512 = (buf) => crypto.createHash('sha512').update(buf).digest('base64');

/** Vérifie le fichier de contenu signé ; retourne sa description ou lève une erreur claire. */
function verifyManifest(text, keys = KEYS) {
  let j; try { j = JSON.parse(text); } catch { throw new Error('Description de mise à jour illisible.'); }
  if (!j || typeof j.data !== 'string' || typeof j.sig !== 'string' || !/^[A-Za-z0-9_-]+$/.test(j.data) || !/^[A-Za-z0-9_-]+$/.test(j.sig)) throw new Error('Description de mise à jour non signée.');
  let ok = false;
  for (const k of keys) { try { ok = ok || crypto.verify(null, Buffer.from(j.data), k, Buffer.from(j.sig, 'base64url')); } catch { /* clé suivante */ } }
  if (!ok) throw new Error('Signature de la mise à jour incorrecte : mise à jour refusée.');
  const m = JSON.parse(Buffer.from(j.data, 'base64url').toString('utf8'));
  const file = (f) => f && typeof f.nom === 'string' && /^[\w.+-]+$/.test(f.nom) && Number.isInteger(f.taille) && f.taille > 0 && typeof f.sha512 === 'string';
  if (m.produit !== PRODUCT || !/^\d+\.\d+\.\d+$/.test(m.version) || typeof m.electron !== 'string' || !file(m.asar) || !file(m.unpacked) || !/^[0-9a-f]{64}$/.test(m.unpacked.empreinte)) throw new Error('Description de mise à jour incomplète.');
  return m;
}
function signManifest(data, privateKey) {
  const d = Buffer.from(JSON.stringify(data)).toString('base64url');
  return JSON.stringify({ data: d, sig: crypto.sign(null, Buffer.from(d), privateKey).toString('base64url') }, null, 1);
}

let A = null; // { app, net, log }
function init(deps) { A = deps; }
const testMode = () => !!process.env.EDUPDF_SELFTEST;
const resourcesDir = (o) => (o && o.resources) || process.resourcesPath;
const stagingRoot = (o) => (o && o.stagingRoot) || path.join(process.env.LOCALAPPDATA || A.app.getPath('userData'), 'SknEDU-studio-maj');
/** Version sans installation : pas de programme de désinstallation à côté du programme. */
const isPortable = () => process.platform === 'win32' && !!(A && A.app.isPackaged) && !rawFs().existsSync(path.join(path.dirname(process.execPath), `Uninstall ${PRODUCT}.exe`));
function writable(dir) {
  const fs = rawFs(); const t = path.join(dir, `.skn-ecriture-${process.pid}`);
  try { fs.writeFileSync(t, 'x'); fs.rmSync(t, { force: true }); return true; } catch { return false; }
}
async function fetchOk(url, o) {
  const res = await ((o && o.fetch) || A.net.fetch)(url, { redirect: 'follow', cache: 'no-store' });
  if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
  return res;
}
/** Téléchargement en flux vers un fichier, avec contrôle de la taille et de l'empreinte SHA-512. */
async function download(url, dest, f, onProgress, o) {
  const fs = rawFs(); const res = await fetchOk(url, o); const h = crypto.createHash('sha512');
  const fd = fs.openSync(dest, 'w'); let n = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      n += value.length; if (n > f.taille) throw new Error('Fichier de mise à jour plus grand que prévu.');
      h.update(value); fs.writeSync(fd, value); if (onProgress) onProgress(n);
    }
  } finally { fs.closeSync(fd); }
  if (n !== f.taille || h.digest('base64') !== f.sha512) { fs.rmSync(dest, { force: true }); throw new Error('Fichier de mise à jour endommagé (empreinte incorrecte) : téléchargement refusé.'); }
}

/**
 * Prépare la mise à jour du contenu vers la version v. Retourne { ready: true, … } ou { ready: false, reason }.
 * o (auto-test uniquement) : base, keys, resources, stagingRoot, electron, fetch.
 */
async function prepare(v, onProgress, o = {}) {
  if (!testMode()) o = {};
  if (process.platform !== 'win32' && !testMode()) return { ready: false, reason: 'système' };
  const fs = rawFs(); const N = names(v);
  let m;
  try { m = verifyManifest(await (await fetchOk(assetUrl(v, N.manifest, o.base), o)).text(), o.keys || KEYS); }
  catch (e) { if (e.status === 404) return { ready: false, reason: 'contenu pas encore publié' }; throw e; }
  if (m.version !== v) throw new Error('Version de la mise à jour inattendue.');
  if (m.electron !== (o.electron || process.versions.electron)) return { ready: false, reason: `Electron ${m.electron} requis (installé : ${o.electron || process.versions.electron})` };
  const res = resourcesDir(o); if (!writable(res)) return { ready: false, reason: 'dossier du logiciel protégé en écriture' };
  const dir = path.join(stagingRoot(o), v); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const total = m.asar.taille + (treeHash(path.join(res, 'app.asar.unpacked')) === m.unpacked.empreinte ? 0 : m.unpacked.taille);
  const prog = (base) => (n) => onProgress && onProgress(Math.min(99, Math.round(((base + n) / total) * 100)));
  await download(assetUrl(v, m.asar.nom, o.base), path.join(dir, 'app.asar.nouveau'), m.asar, prog(0), o);
  let unpacked = false;
  if (total > m.asar.taille) { // modules (OCR, MuPDF…) modifiés : téléchargés aussi
    const zipPath = path.join(dir, 'unpacked.zip'); await download(assetUrl(v, m.unpacked.nom, o.base), zipPath, m.unpacked, prog(m.asar.taille), o);
    const JSZip = require('jszip'); const zip = await JSZip.loadAsync(fs.readFileSync(zipPath)); const target = path.join(dir, 'unpacked'); const entries = [];
    for (const [rel, e] of Object.entries(zip.files)) {
      if (e.dir) continue; if (rel.includes('..') || path.isAbsolute(rel) || rel.includes('\\')) throw new Error('Archive de mise à jour invalide.');
      const data = await e.async('nodebuffer'); const p = path.join(target, ...rel.split('/'));
      fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); entries.push({ rel, data });
    }
    if (treeHashOf(entries) !== m.unpacked.empreinte) throw new Error('Modules de mise à jour endommagés : mise à jour refusée.');
    fs.rmSync(zipPath, { force: true }); unpacked = true;
  }
  fs.writeFileSync(path.join(dir, 'pret.json'), JSON.stringify({ version: v, unpacked }));
  if (onProgress) onProgress(100);
  return { ready: true, version: v, dir, unpacked, resources: res };
}

let applying = false;
/**
 * Met le contenu préparé en place après la fermeture de l'application (programme lui-même en mode Node).
 * relaunch : redémarre ensuite le logiciel et revient à l'ancienne version s'il ne démarre pas.
 */
function apply(staged, relaunch, o = {}) {
  if (applying || !staged || !staged.ready) return false; applying = true;
  const fs = rawFs(); const helper = path.join(staged.dir, 'maj-appliquer.js');
  fs.writeFileSync(helper, require('fs').readFileSync(path.join(__dirname, 'maj-appliquer.js'))); // copié hors de l'archive
  const args = { pid: o.pid || process.pid, resources: staged.resources, staging: staged.dir, version: staged.version, unpacked: staged.unpacked, relaunch: !!relaunch,
    exe: o.exe || process.execPath, exeArgs: o.exeArgs || ['--apres-maj'], marker: path.join(staged.dir, 'demarrage-ok'), timeoutMs: o.timeoutMs || 120000 };
  fs.writeFileSync(path.join(stagingRoot(o), 'en-cours.json'), JSON.stringify({ version: staged.version, dir: staged.dir }));
  const child = spawn(process.execPath, [helper, JSON.stringify(args)], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  child.unref(); return child;
}
/** Au démarrage qui suit une mise à jour : confirme que la nouvelle version fonctionne (sinon retour arrière). */
function confirmStart() {
  const fs = rawFs();
  try {
    const f = path.join(stagingRoot(), 'en-cours.json'); if (!fs.existsSync(f)) return;
    const c = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (c.version === A.app.getVersion()) { fs.writeFileSync(path.join(c.dir, 'demarrage-ok'), String(Date.now())); fs.rmSync(f, { force: true }); }
  } catch { /* rien à confirmer */ }
}

module.exports = { _test: { reset: () => { applying = false; } }, init, prepare, apply, confirmStart, isPortable, verifyManifest, signManifest, treeHash, treeHashOf, dirEntries, sha512, names, KEYS, PRODUCT };
