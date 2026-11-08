#!/usr/bin/env node
// Outil du vendeur : émettre les licences commerciales de SknEDU-studio (à utiliser sur VOTRE PC uniquement).
//
//   node tools/licence.js init <dossier-prive>
//       Crée la paire de clés de signature. La clé privée reste dans <dossier-prive> (JAMAIS dans le dépôt Git) ;
//       la clé publique affichée est à copier dans src/license.js (PUBLIC_KEY).
//
//   node tools/licence.js emettre <dossier-prive> --org "Lycée X" --edition enseignant --email prof@lycee.ci --jours 365
//       Licence EN LIGNE (recommandée) : activée sur un seul poste à la fois, transférable, cumulable par 2.
//   node tools/licence.js emettre <dossier-prive> --org "Lycée X" --edition etablissement --postes 50 --fin 2027-09-30
//         --email contact@lycee.ci [--codes-postes 1A2B-3C4D-5E6F-7A8B,…] [--support https://…] [--ref FACT-2026-001]
//       --email : adresse du compte du client (Aide › Licence et édition) ; la licence ne fonctionne qu'avec ce compte.
//       --codes-postes : facultatif, limite la licence aux PC indiqués (code affiché dans Aide › Licence et édition).
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
  const email = String(arg('email', '')).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) die('--email (adresse du compte du client) est obligatoire');
  const ref = arg('ref', 'LIC-' + Date.now());
  const jours = arg('jours');
  let payload;
  if (jours) { // licence en ligne (recommandée) : durée en jours, un poste à la fois, transférable, cumulable par 2
    const days = Number(jours); if (!Number.isInteger(days) || days < 1 || days > 3660) die('--jours : nombre entier de jours (1 à 3660)');
    payload = { v: 2, product: 'SknEDU-studio', edition, org, email, days, support: arg('support', ''), ref, issued: new Date().toISOString().slice(0, 10) };
  } else { // licence hors ligne (ancienne) : date de fin fixe
    const codes = String(arg('codes-postes', '')).split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
    if (codes.some((c) => !/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/.test(c))) die('--codes-postes : codes au format XXXX-XXXX-XXXX-XXXX, séparés par des virgules');
    const fin = arg('fin'); if (!/^\d{4}-\d{2}-\d{2}$/.test(fin || '')) die('indiquez --jours N (licence en ligne) ou --fin AAAA-MM-JJ (licence hors ligne)');
    payload = { v: 1, product: 'SknEDU-studio', edition, org, seats: Number(arg('postes', edition === 'enseignant' ? 1 : 10)),
      email, ...(codes.length ? { machines: codes } : {}), support: arg('support', ''), ref, issued: new Date().toISOString().slice(0, 10), expires: fin };
  }
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.sign(null, Buffer.from(data), crypto.createPrivateKey(fs.readFileSync(keyFile))).toString('base64url');
  const key = `SKN1.${data}.${sig}`;
  const out = path.join(dir, ref.replace(/[^\w.-]/g, '_') + '.sknlic');
  if (fs.existsSync(out)) die(`une licence porte déjà la référence ${ref} : choisissez une autre --ref.`);
  fs.writeFileSync(out, key + '\n');
  console.log(payload.v === 2
    ? `Licence ${edition} en ligne pour « ${org} » — compte ${email} — ${payload.days} jours (un poste à la fois) : ${out}\n\n${key}`
    : `Licence ${edition} hors ligne pour « ${org} » — compte ${email} (jusqu'au ${payload.expires}) : ${out}\n\n${key}`);
} else if (cmd === 'init-serveur') { // clé de signature du service d'activation (secret du Worker)
  const f = path.join(dir, 'cle-privee-serveur.pem');
  if (path.resolve(dir).toLowerCase().startsWith(path.resolve(__dirname, '..').toLowerCase())) die('le dossier privé ne doit pas être dans le dépôt.');
  if (fs.existsSync(f)) die('une clé de service existe déjà dans ce dossier.');
  fs.mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(f, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  console.log(`Clé privée du service : ${f}\n→ à installer comme secret du Worker : npx wrangler secret put SERVER_PRIVATE_KEY (coller le contenu du fichier)\n`);
  console.log('Clé publique à placer dans package.json › commercial › serverPublicKey :\n' + JSON.stringify(pub));
} else die('commande inconnue : ' + cmd);
