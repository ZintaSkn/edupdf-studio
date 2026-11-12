// SknEDU-studio — dossier d'échange : un dossier synchronisé (Google Drive, OneDrive, Dropbox…) sert de centre
// d'échange entre l'enseignant et ses élèves, sans compte ni mot de passe confié au logiciel.
//   <cloud>/SknEDU-studio/Classes/<Classe>/<Élève>/1 - À faire          ← documents distribués par l'enseignant
//                                              /2 - Copies rendues      ← copies déposées par l'élève
//                                              /3 - Corrigés            ← copies corrigées rendues à l'élève
// L'enseignant partage à chaque élève SON dossier seulement : aucun élève ne voit les copies des autres.
// Sécurité : la liste des classes et des élèves vient des réglages locaux (jamais du dossier synchronisé) ; seuls des
// fichiers ordinaires d'un type pris en charge, de taille limitée, sont proposés à l'ouverture.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cloud = require('./cloud');

let A = null; const watchers = new Map(); let debounce = null; let poll = null; let lastSig = '';

const SUB = { todo: '1 - À faire', done: '2 - Copies rendues', back: '3 - Corrigés' };
const MAX_FILE = 50 * 1048576; const MAX_STUDENTS = 200; const MAX_PER_FOLDER = 300;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
const MISSING = 'Le dossier de la classe est introuvable : vérifiez que votre cloud est bien synchronisé sur ce PC.';
/** Nom de classe ou d'élève utilisable comme nom de dossier (lettres, chiffres, espaces, apostrophes, tirets). */
function cleanName(s, n = 60) {
  const t = String(s == null ? '' : s).normalize('NFC').replace(/[^\p{L}\p{N} '\-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, n).trim();
  return RESERVED.test(t) || !/[\p{L}\p{N}]/u.test(t) ? '' : t;
}
/** Noms nettoyés, sans doublon (les dossiers Windows et macOS ne distinguent pas majuscules et minuscules). */
function cleanList(list) {
  const seen = new Set(); const out = [];
  for (const e of Array.isArray(list) ? list : []) { const n = cleanName(e); const k = n.toLowerCase(); if (n && !seen.has(k)) { seen.add(k); out.push(n); } }
  return out;
}
function cleanFile(s) {
  let t = path.basename(String(s || 'Document.pdf')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').trim().slice(0, 100);
  t = t.replace(/\.pdf$/i, '').replace(/[. ]+$/, '') || 'Document';
  return (RESERVED.test(t) ? 'Document' : t) + '.pdf';
}
const inside = (dir, p) => { const rel = path.relative(dir, path.resolve(p)); return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel); };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const classes = () => { const e = A.readSettings().echange; return Array.isArray(e) ? e.filter((c) => c && typeof c.id === 'string' && typeof c.dir === 'string' && path.isAbsolute(c.dir) && typeof c.name === 'string' && Array.isArray(c.eleves)) : []; };
function saveClasses(fn) { const s = A.readSettings(); s.echange = fn(Array.isArray(s.echange) ? s.echange : []); A.writeSettings(s); }
function classOf(id) { const c = classes().find((x) => x.id === id); if (!c) throw new Error('Classe inconnue.'); return c; }
function studentDir(c, eleve) {
  if (typeof eleve !== 'string' || !c.eleves.includes(eleve)) throw new Error('Élève inconnu dans cette classe.');
  const d = path.join(c.dir, eleve); if (!inside(c.dir, d)) throw new Error('Dossier invalide.'); return d;
}
/** Fichiers ordinaires d'un dossier (ni raccourcis, ni fichiers cachés ou en cours de synchronisation). */
function filesOf(dir) {
  const out = []; let names = []; try { names = fs.readdirSync(dir); } catch { return out; }
  for (const n of names.slice(0, MAX_PER_FOLDER * 2)) {
    if (/^[.~]|\.(tmp|part|partial|crdownload|download)$/i.test(n) || /^desktop\.ini$/i.test(n)) continue;
    const p = path.join(dir, n); let st; try { st = fs.lstatSync(p); } catch { continue; }
    if (!st.isFile() || st.isSymbolicLink()) continue;
    out.push({ name: n, file: p, size: st.size, at: Math.round(st.mtimeMs) });
    if (out.length >= MAX_PER_FOLDER) break;
  }
  return out.sort((a, b) => a.at - b.at);
}
const extOk = (n) => A.docExt().includes(path.extname(n).slice(1).toLowerCase());
function scan(c) {
  const ok = isDir(c.dir); const vues = c.vues || {}; let nouvelles = 0;
  const eleves = c.eleves.map((nom) => {
    const d = path.join(c.dir, nom); const copies = []; let ignores = 0;
    for (const f of ok ? filesOf(path.join(d, SUB.done)) : []) {
      if (!f.size) continue; // fichier pas encore arrivé (synchronisation en cours)
      if (!extOk(f.name) || f.size > MAX_FILE) { ignores++; continue; } // type non pris en charge ou trop volumineux : signalé à l'enseignant
      const vu = vues[nom + '/' + f.name]; if (vu === -f.at) { ignores++; continue; } // faux PDF déjà écarté
      const nouveau = vu !== f.at; if (nouveau) nouvelles++;
      copies.push({ name: f.name, file: f.file, at: f.at, size: f.size, nouveau });
    }
    return { nom, aFaire: ok ? filesOf(path.join(d, SUB.todo)).length : 0, corriges: ok ? filesOf(path.join(d, SUB.back)).length : 0, copies, ignores };
  });
  return { id: c.id, name: c.name, dir: c.dir, ok, eleves, nouvelles };
}
function list() {
  const cs = classes().map(scan); watch();
  return { classes: cs, nouvelles: cs.reduce((n, c) => n + c.nouvelles, 0), clouds: A.roots().map((r) => ({ name: r.name, path: r.path })), dossiers: SUB, maxMo: MAX_FILE / 1048576 };
}

// ---------- Surveillance : les copies déposées apparaissent seules dans le logiciel ----------
function notify() {
  let st; try { st = list(); } catch { return; }
  const sig = JSON.stringify(st.classes.map((c) => [c.id, c.ok, c.eleves.map((e) => [e.aFaire, e.corriges, e.ignores, e.copies.map((f) => [f.name, f.at, f.nouveau])])]));
  if (sig === lastSig) return; lastSig = sig;
  const w = A.getWin(); if (w && !w.isDestroyed()) w.webContents.send('exchange-update', st);
}
const soon = () => { clearTimeout(debounce); debounce = setTimeout(notify, 1200); };
function watch() {
  const cs = classes(); const wanted = new Set(cs.filter((c) => isDir(c.dir)).map((c) => c.dir));
  for (const [d, w] of watchers) if (!wanted.has(d)) { try { w.close(); } catch { /* déjà fermé */ } watchers.delete(d); }
  for (const d of wanted) {
    if (watchers.has(d)) continue;
    try {
      const w = fs.watch(d, { recursive: true, persistent: false }, soon);
      w.on('error', () => { try { w.close(); } catch { /* */ } watchers.delete(d); });
      watchers.set(d, w);
    } catch { /* lecteur virtuel sans notification : la vérification périodique suffit */ }
  }
  // certains lecteurs cloud virtuels ne signalent pas les changements : vérification périodique en complément
  if (cs.length && !poll) { poll = setInterval(notify, 20000); if (poll.unref) poll.unref(); }
  if (!cs.length && poll) { clearInterval(poll); poll = null; }
}
function unwatch() { for (const w of watchers.values()) { try { w.close(); } catch { /* */ } } watchers.clear(); if (poll) clearInterval(poll); poll = null; clearTimeout(debounce); }

// ---------- Actions de l'enseignant ----------
const HELP = (eleve, classe) => `Bonjour ${eleve},\r\n\r\nCe dossier est ton espace d'échange avec ton enseignant (classe ${classe}).\r\n\r\n`
  + `  ${SUB.todo} : les documents à télécharger et à compléter.\r\n  ${SUB.done} : dépose ici ta copie (PDF de préférence, ou photo ; ${MAX_FILE / 1048576} Mo maximum).\r\n  ${SUB.back} : tes copies corrigées.\r\n\r\n`
  + 'Toi seul et ton enseignant voyez ce dossier.\r\n';
/** Écriture en deux temps : jamais de fichier à moitié écrit pris par la synchronisation ; rien ne traîne en cas d'échec. */
function writeAtomic(file, buf) {
  const tmp = path.join(path.dirname(file), '.' + crypto.randomBytes(5).toString('hex') + '.tmp');
  try { fs.writeFileSync(tmp, buf); fs.renameSync(tmp, file); } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* */ } throw e; }
}
function toBuffer(bytes) {
  const b = Buffer.from(bytes || []); if (!b.length || b.length > 100 * 1048576) throw new Error('Document vide ou trop volumineux (100 Mo maximum).');
  if (b.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('Seul un PDF peut être déposé.');
  return b;
}
function create({ cloudPath, name, eleves }) {
  A.premium('Dossier d\'échange'); A.guard('cloud', 'Dossier d\'échange');
  const root = A.roots().find((r) => r.path === cloudPath); if (!root) throw new Error('Dossier cloud inconnu.');
  const cname = cleanName(name); if (!cname) throw new Error('Indiquez le nom de la classe (lettres et chiffres).');
  const dir = path.join(cloud.targetDir(root.path), 'Classes', cname);
  const prev = classes().find((c) => path.resolve(c.dir).toLowerCase() === path.resolve(dir).toLowerCase());
  const all = cleanList([...(prev ? prev.eleves : []), ...(Array.isArray(eleves) ? eleves : [])]).slice(0, MAX_STUDENTS);
  if (!all.length) throw new Error('Indiquez au moins un élève (un nom par ligne).');
  if (!prev && classes().length >= 60) throw new Error('Trop de classes : retirez-en une avant d\'en créer une autre.');
  // un élève déjà connu garde son dossier tel qu'il a été créé (même si la casse du nom saisi diffère)
  const known = new Map((prev ? prev.eleves : []).map((e) => [e.toLowerCase(), e])); const final = all.map((e) => known.get(e.toLowerCase()) || e);
  for (const e of final) {
    const d = path.join(dir, e); if (!inside(dir, d)) continue;
    for (const s of Object.values(SUB)) fs.mkdirSync(path.join(d, s), { recursive: true });
    const help = path.join(d, 'Lisez-moi.txt'); if (!fs.existsSync(help)) fs.writeFileSync(help, '﻿' + HELP(e, cname));
  }
  const id = prev ? prev.id : crypto.randomBytes(6).toString('hex');
  saveClasses((l) => l.filter((c) => c && c.id !== id).concat([{ id, name: cname, dir, eleves: final, vues: (prev && prev.vues) || {} }]));
  A.logEvent('cloud', { file: 'Classe ' + cname, service: root.name });
  return { id, ajoutes: final.length - (prev ? prev.eleves.length : 0), ...list() };
}
function distribute({ id, bytes, fileName, eleves }) {
  A.premium('Dossier d\'échange'); A.guard('cloud', 'Distribuer un document');
  const c = classOf(id); if (!isDir(c.dir)) throw new Error(MISSING);
  const buf = toBuffer(bytes); const name = cleanFile(fileName);
  const cible = Array.isArray(eleves) && eleves.length ? c.eleves.filter((e) => eleves.includes(e)) : c.eleves; let n = 0; const echecs = [];
  for (const e of cible) { // un dossier verrouillé par la synchronisation n'empêche pas de servir les autres élèves
    try { const d = path.join(studentDir(c, e), SUB.todo); fs.mkdirSync(d, { recursive: true }); writeAtomic(path.join(d, name), buf); n++; } catch { echecs.push(e); }
  }
  if (!n) throw new Error('Aucun dossier d\'élève n\'a pu être écrit : vérifiez que votre cloud est bien synchronisé sur ce PC.');
  A.logEvent('cloud', { file: name, service: 'Classe ' + c.name });
  soon();
  return { count: n, name, echecs };
}
function saveVues(id, vues, present) {
  for (const k of Object.keys(vues)) if (!present.has(k)) delete vues[k]; // copies supprimées depuis : la liste ne grossit pas sans fin
  saveClasses((l) => l.map((x) => (x && x.id === id ? { ...x, vues } : x)));
}
const present = (st, c) => { const s = new Set(); for (const e of st.eleves) for (const f of filesOf(path.join(c.dir, e.nom, SUB.done))) s.add(e.nom + '/' + f.name); return s; };
/** Copies à ouvrir : chemins autorisés un par un pour l'interface (Zero Trust). Elles ne sont marquées « vues » qu'une fois ouvertes (exchange-seen). */
function copies({ id, eleve, nouvelles }) {
  A.guard('cloud', 'Ouvrir les copies');
  const c = classOf(id); if (!isDir(c.dir)) throw new Error(MISSING);
  const st = scan(c); const out = []; const vues = { ...(c.vues || {}) }; let faux = 0; let enCours = 0;
  for (const e of st.eleves) {
    if (eleve && e.nom !== eleve) continue;
    for (const f of e.copies) {
      if (nouvelles && !f.nouveau) continue;
      if (Date.now() - f.at < 1500) { enCours++; continue; } // encore en cours d'écriture par la synchronisation
      if (/\.pdf$/i.test(f.name)) {
        let h = ''; try { const fd = fs.openSync(f.file, 'r'); const b = Buffer.alloc(5); fs.readSync(fd, b, 0, 5, 0); fs.closeSync(fd); h = b.toString('latin1'); } catch { enCours++; continue; }
        if (h !== '%PDF-') { vues[e.nom + '/' + f.name] = -f.at; faux++; continue; } // faux PDF : écarté, compté parmi les fichiers ignorés
      }
      A.grant(f.file); out.push({ eleve: e.nom, file: f.file, name: f.name, at: f.at });
      if (out.length >= 200) break;
    }
    if (out.length >= 200) break;
  }
  if (faux) { saveVues(id, vues, present(st, c)); soon(); }
  return { copies: out, faux, enCours };
}
/** Copies effectivement ouvertes par l'enseignant : elles ne comptent plus comme nouvelles. */
function seen({ id, items }) {
  const c = classOf(id); const st = scan(c); const vues = { ...(c.vues || {}) }; let n = 0;
  for (const it of (Array.isArray(items) ? items : []).slice(0, 400)) {
    const e = it && st.eleves.find((x) => x.nom === it.eleve); const f = e && e.copies.find((x) => x.name === it.name);
    if (f) { vues[e.nom + '/' + f.name] = f.at; n++; }
  }
  if (n) { saveVues(id, vues, present(st, c)); soon(); }
  return n;
}
function giveBack({ id, eleve, bytes, fileName }) {
  A.premium('Dossier d\'échange'); A.guard('cloud', 'Rendre un corrigé');
  const c = classOf(id); if (!isDir(c.dir)) throw new Error(MISSING);
  const d = path.join(studentDir(c, eleve), SUB.back); fs.mkdirSync(d, { recursive: true });
  const name = cleanFile(fileName); const p = path.join(d, name); writeAtomic(p, toBuffer(bytes));
  A.logEvent('cloud', { file: name, service: 'Classe ' + c.name });
  soon();
  return p;
}
function openFolder({ id, eleve }) {
  const c = classOf(id); const d = eleve ? studentDir(c, eleve) : c.dir;
  if (isDir(d)) A.shell.openPath(d); return isDir(d);
}
/** Retire la classe du logiciel ; les dossiers et les copies restent dans le cloud. */
function remove({ id }) { saveClasses((l) => l.filter((c) => c && c.id !== id)); const st = list(); soon(); return st; }

function init(deps) {
  A = deps;
  A.ipcMain.handle('exchange-list', () => list());
  A.ipcMain.handle('exchange-create', (_e, a) => create(a || {}));
  A.ipcMain.handle('exchange-distribute', (_e, a) => distribute(a || {}));
  A.ipcMain.handle('exchange-copies', (_e, a) => copies(a || {}));
  A.ipcMain.handle('exchange-seen', (_e, a) => seen(a || {}));
  A.ipcMain.handle('exchange-return', (_e, a) => giveBack(a || {}));
  A.ipcMain.handle('exchange-open-folder', (_e, a) => openFolder(a || {}));
  A.ipcMain.handle('exchange-remove', (_e, a) => remove(a || {}));
  A.app.on('before-quit', unwatch);
}
module.exports = { init, _test: { cleanName, cleanList, cleanFile, SUB } };
