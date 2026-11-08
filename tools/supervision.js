// Supervision du service d'activation et du canal de mises à jour : node tools/supervision.js
// Lancé chaque jour par .github/workflows/supervision.yml (et à la main au besoin). Aucune donnée n'est créée ni modifiée.
// Vérifie : disponibilité, TLS 1.3 négocié, certificat valable > 14 jours, en-têtes de sécurité, refus des demandes invalides,
// temps de réponse, et présence du fichier de mise à jour publié.
'use strict';
const tls = require('tls');
const pkg = require('../package.json');

const SERVICE = (process.env.SKN_SERVICE || (pkg.commercial && pkg.commercial.licenceServer) || '').replace(/\/$/, '');
const PUB = [].concat((pkg.build && pkg.build.publish) || [])[0] || {};
const UPDATES = `https://github.com/${PUB.owner || 'ZintaSkn'}/${PUB.repo || 'edupdf-studio'}/releases/latest/download/latest.yml`;
const MAX_MS = 3000;
const results = []; let failed = 0;
const check = (name, ok, detail) => { results.push(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; };
const timed = async (fn) => { const t = Date.now(); const r = await fn(); return [r, Date.now() - t]; };
const get = (url, opts = {}) => fetch(url, { ...opts, signal: AbortSignal.timeout(15000), redirect: 'follow' });

function tlsInfo(host) {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host, port: 443, servername: host, minVersion: 'TLSv1.3' }, () => {
      const c = s.getPeerCertificate(); const r = { protocol: s.getProtocol(), validTo: new Date(c.valid_to), authorized: s.authorized };
      s.end(); resolve(r);
    });
    s.setTimeout(15000, () => { s.destroy(); reject(new Error('délai dépassé')); });
    s.on('error', reject);
  });
}

(async () => {
  if (!SERVICE) throw new Error('Adresse du service absente (package.json › commercial.licenceServer).');
  const host = new URL(SERVICE).hostname;
  try {
    const t = await tlsInfo(host); const days = Math.floor((t.validTo - Date.now()) / 86400000);
    check('TLS 1.3 négocié', t.protocol === 'TLSv1.3' && t.authorized, t.protocol);
    check('Certificat valable plus de 14 jours', days > 14, `${days} jours`);
  } catch (e) { check('TLS 1.3 négocié', false, e.message); }
  try {
    const [r, ms] = await timed(() => get(SERVICE + '/')); const b = await r.json().catch(() => ({}));
    check('Service disponible', r.status === 200 && b.ok === true, `HTTP ${r.status}`);
    check(`Temps de réponse < ${MAX_MS} ms`, ms < MAX_MS, `${ms} ms`);
    check('En-tête HSTS', /max-age=\d{7,}/.test(r.headers.get('strict-transport-security') || ''));
    check('Politique de contenu restrictive', /default-src 'none'/.test(r.headers.get('content-security-policy') || ''));
    check('Pas de mise en cache', /no-store/.test(r.headers.get('cache-control') || ''));
  } catch (e) { check('Service disponible', false, e.message); }
  try {
    const r = await get(SERVICE + '/v1/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    check('Demande incomplète refusée (4xx)', r.status >= 400 && r.status < 500, `HTTP ${r.status}`);
    const r2 = await get(SERVICE + '/v1/status', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
    check('Type de contenu non JSON refusé', r2.status === 415, `HTTP ${r2.status}`);
    const r3 = await get(SERVICE + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    check('Adresse inconnue refusée', r3.status === 404, `HTTP ${r3.status}`);
  } catch (e) { check('Refus des demandes invalides', false, e.message); }
  try {
    const r = await get(UPDATES); const txt = await r.text();
    const v = (txt.match(/^version:\s*(\S+)/m) || [])[1];
    check('Canal de mises à jour disponible', r.status === 200 && !!v, v ? `version publiée ${v}` : `HTTP ${r.status}`);
  } catch (e) { check('Canal de mises à jour disponible', false, e.message); }
  console.log(`Supervision ${new Date().toISOString()} — ${SERVICE}\n` + results.join('\n'));
  if (failed) { console.error(`${failed} contrôle(s) en échec.`); process.exit(1); }
  console.log('TOUS LES CONTRÔLES RÉUSSIS');
})().catch((e) => { console.error('ÉCHEC :', e.message); process.exit(1); });
