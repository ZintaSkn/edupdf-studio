#!/usr/bin/env node
// SknEDU-studio — paquets de mise à jour du contenu (sans installateur), côté éditeur.
//
//   node tools/maj.js init                         crée la clé de signature des mises à jour (une seule fois)
//   node tools/maj.js paquet <resources> <sortie>  (publication automatique) prépare le contenu à signer
//   node tools/maj.js signer <version>             signe le contenu publié et l'ajoute à la version GitHub
//
// La clé privée reste sur l'ordinateur de l'éditeur (%USERPROFILE%\SknEDUpdf-licences), jamais dans le dépôt ni sur
// GitHub : une version publiée n'est installée par cette voie qu'après signature par l'éditeur.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const CU = require('../src/codeupdate');

const REPO = 'ZintaSkn/edupdf-studio';
const KEY_DIR = path.join(os.homedir(), 'SknEDUpdf-licences');
const PRIV = path.join(KEY_DIR, 'cle-privee-mises-a-jour.pem');
const die = (m) => { console.error('Erreur : ' + m); process.exit(1); };

async function paquet(resources, out) {
  const pkg = require('../package.json'); const v = pkg.version; const N = CU.names(v);
  const asar = fs.readFileSync(path.join(resources, 'app.asar'));
  const unpackedDir = path.join(resources, 'app.asar.unpacked'); const entries = CU.dirEntries(unpackedDir);
  const JSZip = require('jszip'); const zip = new JSZip();
  for (const e of entries) zip.file(e.rel, e.data, { date: new Date(0), binary: true });
  const zbuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, N.asar), asar); fs.writeFileSync(path.join(out, N.unpacked), zbuf);
  const data = { produit: CU.PRODUCT, version: v, electron: require('electron/package.json').version, date: new Date().toISOString(),
    asar: { nom: N.asar, taille: asar.length, sha512: CU.sha512(asar) },
    unpacked: { nom: N.unpacked, taille: zbuf.length, sha512: CU.sha512(zbuf), empreinte: CU.treeHashOf(entries), fichiers: entries.length } };
  fs.writeFileSync(path.join(out, N.toSign), JSON.stringify(data, null, 1));
  console.log(`Contenu ${v} prêt à signer : ${N.asar} (${(asar.length / 1048576).toFixed(1)} Mo), ${N.unpacked} (${(zbuf.length / 1048576).toFixed(1)} Mo, ${entries.length} fichiers), Electron ${data.electron}`);
}

async function signer(v) {
  v = String(v || '').replace(/^v/, ''); if (!/^\d+\.\d+\.\d+$/.test(v)) die('indiquez la version, ex. node tools/maj.js signer 1.13.2');
  if (!fs.existsSync(PRIV)) die(`clé absente (${PRIV}) : node tools/maj.js init`);
  const N = CU.names(v); const base = `https://github.com/${REPO}/releases/download/v${v}/`;
  const get = async (n) => { const r = await fetch(base + n, { redirect: 'follow' }); if (!r.ok) die(`${n} introuvable dans la version v${v} (HTTP ${r.status})`); return Buffer.from(await r.arrayBuffer()); };
  const data = JSON.parse((await get(N.toSign)).toString('utf8'));
  if (data.version !== v || data.produit !== CU.PRODUCT) die('description inattendue');
  // contre-vérification de ce qui est publié avant de signer
  const asar = await get(data.asar.nom); if (asar.length !== data.asar.taille || CU.sha512(asar) !== data.asar.sha512) die('app.asar publié différent de sa description');
  const z = await get(data.unpacked.nom); if (z.length !== data.unpacked.taille || CU.sha512(z) !== data.unpacked.sha512) die('modules publiés différents de leur description');
  const zip = await require('jszip').loadAsync(z); const entries = [];
  for (const [rel, e] of Object.entries(zip.files)) if (!e.dir) entries.push({ rel, data: await e.async('nodebuffer') });
  if (CU.treeHashOf(entries) !== data.unpacked.empreinte) die('empreinte des modules incorrecte');
  const signed = CU.signManifest(data, crypto.createPrivateKey(fs.readFileSync(PRIV)));
  CU.verifyManifest(signed); // la clé publique intégrée au logiciel doit accepter cette signature
  const file = path.join(os.tmpdir(), N.manifest); fs.writeFileSync(file, signed);
  execFileSync('gh', ['release', 'upload', `v${v}`, file, '--clobber', '-R', REPO], { stdio: 'inherit' });
  console.log(`Mise à jour du contenu ${v} signée et publiée (${N.manifest}). Electron ${data.electron}.`);
}

function init() {
  if (fs.existsSync(PRIV)) die(`une clé existe déjà : ${PRIV} (jamais écrasée)`);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(KEY_DIR, { recursive: true });
  fs.writeFileSync(PRIV, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  console.log(`Clé privée : ${PRIV}\nÀ sauvegarder hors-ligne (clé USB chiffrée), jamais dans le dépôt.\nClé publique à placer dans src/codeupdate.js (KEYS) :\n${publicKey.export({ type: 'spki', format: 'pem' })}`);
}

const [cmd, ...args] = process.argv.slice(2);
(async () => {
  if (cmd === 'init') init();
  else if (cmd === 'paquet') await paquet(args[0] || 'dist/win-unpacked/resources', args[1] || 'dist');
  else if (cmd === 'signer') await signer(args[0]);
  else console.log('Commandes : init | paquet <resources> <sortie> | signer <version>');
})().catch((e) => die(e.message));
