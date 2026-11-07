// Signature de code SignPath, appelée par electron-builder pour chaque exécutable Windows
// (application SknEDU-studio.exe, désinstalleur, installateur).
// Sans les secrets SIGNPATH_* (builds locaux, forks), rien n'est signé et la construction continue normalement.
//
// Variables (secrets GitHub du dépôt) :
//   SIGNPATH_API_TOKEN                   jeton API d'un utilisateur « submitter » SignPath
//   SIGNPATH_ORGANIZATION_ID             identifiant de l'organisation SignPath
//   SIGNPATH_PROJECT_SLUG                projet SignPath (défaut : sknedu-studio)
//   SIGNPATH_SIGNING_POLICY_SLUG         politique de signature (défaut : release-signing)
//   SIGNPATH_ARTIFACT_CONFIGURATION_SLUG configuration d'artefact (facultatif)
//   SIGNPATH_WAIT_MIN                    attente maximale de l'approbation manuelle, en minutes (défaut : 120)
'use strict';
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function signWithSignPath(config) {
  const file = config.path; const name = path.basename(file);
  const env = process.env;
  const token = env.SIGNPATH_API_TOKEN; const org = env.SIGNPATH_ORGANIZATION_ID;
  if (!token || !org) { console.log(`  • SignPath non configuré : ${name} n'est pas signé`); return; }
  const base = `${env.SIGNPATH_API_URL || 'https://app.signpath.io/Api/v1'}/${encodeURIComponent(org)}`; // SIGNPATH_API_URL : tests uniquement
  const auth = { Authorization: `Bearer ${token}` };
  const run = env.GITHUB_RUN_ID ? ` — ${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : '';

  const form = new FormData();
  form.append('projectSlug', env.SIGNPATH_PROJECT_SLUG || 'sknedu-studio');
  form.append('signingPolicySlug', env.SIGNPATH_SIGNING_POLICY_SLUG || 'release-signing');
  if (env.SIGNPATH_ARTIFACT_CONFIGURATION_SLUG) form.append('artifactConfigurationSlug', env.SIGNPATH_ARTIFACT_CONFIGURATION_SLUG);
  form.append('description', `${name} ${env.GITHUB_REF_NAME || ''}${run}`.trim());
  form.append('artifact', new Blob([fs.readFileSync(file)]), name);

  let res;
  for (let attempt = 1; ; attempt++) { // service momentanément indisponible : nouvelles tentatives
    res = await fetch(`${base}/SigningRequests/SubmitWithArtifact`, { method: 'POST', headers: auth, body: form });
    if (res.status !== 503 || attempt >= 5) break;
    await sleep(30000);
  }
  if (res.status !== 201) throw new Error(`SignPath : envoi de ${name} refusé (HTTP ${res.status}) ${(await res.text()).slice(0, 400)}`);
  const id = String(res.headers.get('location') || '').split('/').filter(Boolean).pop();
  if (!id) throw new Error('SignPath : identifiant de la demande de signature introuvable.');
  console.log(`  • SignPath : demande ${id} pour ${name} — en attente d'approbation sur https://app.signpath.io`);

  const deadline = Date.now() + (Number(env.SIGNPATH_WAIT_MIN) || 120) * 60000;
  let st = {}; let last = '';
  while (Date.now() < deadline) {
    await sleep(15000);
    const s = await fetch(`${base}/SigningRequests/${id}/Status`, { headers: auth });
    if (!s.ok) continue; // incident réseau passager
    st = await s.json();
    if (st.workflowStatus !== last) { last = st.workflowStatus; console.log(`  • SignPath : ${name} — ${st.status} / ${st.workflowStatus}`); }
    if (st.isFinalStatus) break;
  }
  if (!st.isFinalStatus) throw new Error(`SignPath : ${name} non approuvé dans le délai imparti (demande ${id}).`);
  if (st.status !== 'Completed') throw new Error(`SignPath : signature de ${name} ${st.status} (${st.workflowStatus}).`);

  const d = await fetch(`${base}/SigningRequests/${id}/SignedArtifact`, { headers: auth });
  if (!d.ok) throw new Error(`SignPath : téléchargement de ${name} signé impossible (HTTP ${d.status}).`);
  const signed = Buffer.from(await d.arrayBuffer());
  if (signed.length < 1024 || signed[0] !== 0x4d || signed[1] !== 0x5a) throw new Error(`SignPath : fichier signé invalide pour ${name}.`); // en-tête « MZ » d'un exécutable
  fs.writeFileSync(file, signed);
  console.log(`  • SignPath : ${name} signé (${signed.length} octets)`);
};
