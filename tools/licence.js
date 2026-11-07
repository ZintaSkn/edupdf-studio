#!/usr/bin/env node
// Outil du vendeur : émettre les licences commerciales de SknEDUpdf-studio (à utiliser sur VOTRE PC uniquement).
//
//   node tools/licence.js init <dossier-prive>
//       Crée la paire de clés de signature. La clé privée reste dans <dossier-prive> (JAMAIS dans le dépôt Git) ;
//       la clé publique affichée est à copier dans src/license.js (PUBLIC_KEY).
//
//   node tools/licence.js emettre <dossier-prive> --org "Lycée X" --edition etablissement --postes 50 --fin 2027-09-30
//         [--email contact@lycee.ci] [--support https://…] [--ref FACT-2026-001]
//       Produit le fichier <ref>.sknlic à envoyer au client (et affiche la clé à copier-coller).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const [, , cmd, dir, ...rest] = process.argv;
const arg = (n, d) => { const i = rest.indexOf('--' + n); return i >= 0 ? rest[i + 1] : d; };
const die = (m) => { console.error('Erreur : ' + m); process.exit(1); };
if (!cmd || !dir) die('usage : node tools/licence.js init|emettre <dossier-prive> [options]');
const keyFile = path.join(dir, 'cle-privee-licences.pem');

if (cmd === 'init') {
  if (path.resolve(dir).toLowerCase().startsWith(path.resolve(__dirname, '..').toLowerCase())) die('le dossier privé ne doit pas être dans le dépôt.');
  if (fs.existsSync(keyFile)) die('une clé existe déjà dans ce dossier (ne la remplacez pas : les licences émises deviendraient invalides).');
  fs.mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  fs.writeFileSync(path.join(dir, 'cle-publique.pem'), pub);
  console.log('Clé privée : ' + keyFile + '\n→ sauvegardez-la (clé USB, coffre-fort) : sans elle, impossible d\'émettre de nouvelles licences.\n');
  console.log('Clé publique à placer dans src/license.js :\n' + pub);
} else if (cmd === 'emettre') {
  if (!fs.existsSync(keyFile)) die('clé privée introuvable : lancez d\'abord « init ».');
  const edition = arg('edition', 'etablissement');
  if (!['enseignant', 'etablissement'].includes(edition)) die('--edition doit valoir enseignant ou etablissement');
  const org = arg('org'); if (!org) die('--org est obligatoire');
  const fin = arg('fin'); if (!/^\d{4}-\d{2}-\d{2}$/.test(fin || '')) die('--fin AAAA-MM-JJ est obligatoire');
  const payload = {
    v: 1, product: 'SknEDUpdf-studio', edition, org, seats: Number(arg('postes', edition === 'enseignant' ? 1 : 10)),
    email: arg('email', ''), support: arg('support', ''), ref: arg('ref', 'LIC-' + Date.now()),
    issued: new Date().toISOString().slice(0, 10), expires: fin
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.sign(null, Buffer.from(data), crypto.createPrivateKey(fs.readFileSync(keyFile))).toString('base64url');
  const key = `SKN1.${data}.${sig}`;
  const out = path.join(dir, payload.ref.replace(/[^\w.-]/g, '_') + '.sknlic');
  fs.writeFileSync(out, key + '\n');
  console.log(`Licence ${edition} pour « ${org} » (${payload.seats} poste(s), jusqu'au ${fin}) : ${out}\n\n${key}`);
} else die('commande inconnue : ' + cmd);
