#!/usr/bin/env node
// Outil du vendeur : émettre les licences commerciales de SknEDU-studio (à utiliser sur VOTRE PC uniquement).
//
//   node tools/licence.js commande <dossier-prive> SKNC.… --paye
//       Transforme une commande reçue (WhatsApp, e-mail, page, Mobile Money) en licence(s) en ligne,
//       tient le registre des commandes et affiche le message à renvoyer au client.
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
} else if (cmd === 'commande') {
  // Commande reçue (WhatsApp, e-mail, page, Mobile Money) → licence(s) en ligne + message à renvoyer au client.
  //   node tools/licence.js commande <dossier-prive> SKNC.xxxx --paye [--jours N] [--postes N]
  if (!fs.existsSync(keyFile)) die('clé privée introuvable : lancez d\'abord « init ».');
  const m = /SKNC\.([A-Za-z0-9_-]+)/.exec(rest.join(' ')); if (!m) die('collez le code de commande (il commence par « SKNC. »).');
  let c; try { c = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); } catch { die('code de commande illisible.'); }
  if (!['enseignant', 'etablissement'].includes(c.edition) || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(c.email || '') || !/^CMD-[\w-]+$/.test(c.ref || '')) die('code de commande incomplet.');
  const days = Number(arg('jours', c.jours)); const qte = Math.max(1, Math.min(500, Number(arg('postes', c.qte || 1))));
  if (!Number.isInteger(days) || days < 1 || days > 3660) die('durée invalide (--jours pour la corriger).');
  console.log(`Commande ${c.ref} du ${c.date} — ${c.edition}, ${days} jours × ${qte} — ${c.email}${c.nom ? ' — ' + c.nom : ''}${c.org ? ' — ' + c.org : ''} (poste ${c.poste || '?'})`);
  if (!rest.includes('--paye')) die('vérifiez d\'abord le paiement, puis relancez la commande avec --paye.');
  const priv = crypto.createPrivateKey(fs.readFileSync(keyFile)); const keys = [];
  for (let i = 1; i <= qte; i++) {
    const ref = qte > 1 ? `${c.ref}-${i}` : c.ref; const out = path.join(dir, ref + '.sknlic');
    if (fs.existsSync(out)) die(`la licence ${ref} a déjà été émise (${out}).`);
    const payload = { v: 2, product: 'SknEDU-studio', edition: c.edition, org: c.org || c.nom || c.email, email: String(c.email).toLowerCase(), days, ref, issued: new Date().toISOString().slice(0, 10), order: c.ref };
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const key = `SKN1.${data}.${crypto.sign(null, Buffer.from(data), priv).toString('base64url')}`;
    fs.writeFileSync(out, key + '\n'); keys.push(key);
  }
  fs.appendFileSync(path.join(dir, 'registre-commandes.csv'), `${new Date().toISOString()};${c.ref};${c.email};${c.edition};${days};${qte};${(c.nom || '').replace(/;/g, ',')};${(c.org || '').replace(/;/g, ',')}\n`);
  console.log(`\n${qte} licence(s) émise(s) dans ${dir} (registre : registre-commandes.csv).\n\n----- Message à envoyer au client -----\n`
    + `Bonjour${c.nom ? ' ' + c.nom : ''},\nMerci pour votre paiement (commande ${c.ref}). Voici ${qte > 1 ? 'vos clés' : 'votre clé'} de licence SknEDU-studio `
    + `(édition ${c.edition === 'etablissement' ? 'Établissement' : 'Enseignant'}, ${days} jours${qte > 1 ? ', une clé par poste' : ''}) :\n\n${keys.join('\n\n')}\n\n`
    + `Dans SknEDU-studio : Aide › Licence et édition › collez la clé › Activer (connexion Internet nécessaire).\nLa licence fonctionne avec le compte ${c.email}, sur un ordinateur à la fois.\n--------------------------------------`);
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
