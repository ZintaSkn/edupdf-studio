// Tests du service d'activation : node server/test-core.js  (aucune connexion, horloge simulée)
'use strict';
const crypto = require('crypto');
const assert = require('assert');
const { createService, handle, DAY } = require('./core');

const lic = crypto.generateKeyPairSync('ed25519'); const srv = crypto.generateKeyPairSync('ed25519');
const mk = (p) => { const data = Buffer.from(JSON.stringify({ v: 2, product: 'SknEDU-studio', issued: '2026-11-08', ...p })).toString('base64url'); return `SKN1.${data}.${crypto.sign(null, Buffer.from(data), lic.privateKey).toString('base64url')}`; };
let T = Date.UTC(2026, 10, 8); const db = new Map();
const svc = createService({
  store: { get: async (k) => (db.has(k) ? JSON.parse(db.get(k)) : null), put: async (k, v) => db.set(k, JSON.stringify(v)) },
  now: () => T,
  verifyLicence: async (d, s) => crypto.verify(null, Buffer.from(d), lic.publicKey, Buffer.from(s, 'base64url')),
  sign: async (d) => crypto.sign(null, Buffer.from(d), srv.privateKey).toString('base64url')
});
const A = 'a'.repeat(32), B = 'b'.repeat(32); const email = 'prof@ecole.test';
const L1 = mk({ ref: 'L1', edition: 'enseignant', email, days: 365 });
const L2 = mk({ ref: 'L2', edition: 'etablissement', email, days: 30, org: 'Lycée' });
const L3 = mk({ ref: 'L3', edition: 'enseignant', email, days: 90 });
const days = (r) => Math.round((r.end - T) / DAY);
const fails = async (p, code) => { try { await p; assert.fail('attendu : ' + code); } catch (e) { assert.strictEqual(e.code, code, e.message); } };
const ok = []; const step = (n) => ok.push(n);

(async () => {
  let r = await svc.activate({ key: L1, email: 'PROF@ecole.test', machine: A }); assert.strictEqual(days(r), 365); step('activation sur le poste A : 365 jours');
  assert.ok(crypto.verify(null, Buffer.from(r.token.split('.')[1]), srv.publicKey, Buffer.from(r.token.split('.')[2], 'base64url'))); step('jeton signé par le service');
  await fails(svc.activate({ key: L1, email, machine: B }), 'ACTIVE_ELSEWHERE'); step('même licence refusée sur le poste B tant qu\'elle est active sur A');
  r = await svc.activate({ key: L2, email, machine: A }); assert.strictEqual(days(r), 395); assert.strictEqual(r.edition, 'etablissement'); step('2e licence : jours additionnés (395) et meilleure édition');
  await fails(svc.activate({ key: L3, email, machine: A }), 'MAX'); step('3e licence refusée (maximum 2)');
  await fails(svc.activate({ key: mk({ ref: 'X', edition: 'enseignant', email: 'autre@ecole.test', days: 10 }), email, machine: A }), 'EMAIL_MISMATCH'); step('licence d\'une autre adresse refusée');
  await fails(svc.activate({ key: L1.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), email, machine: A }), 'INVALID'); step('clé falsifiée refusée');
  T += 100 * DAY; r = await svc.status({ email, machine: A }); assert.strictEqual(days(r), 295); step('100 jours plus tard : 295 jours restants au total');
  assert.deepStrictEqual(r.licences.map((l) => l.remainingDays), [265, 30]); step('consommation dans l\'ordre : la 1re licence d\'abord');
  r = await svc.deactivate({ ref: 'L1', email, machine: A }); assert.strictEqual(r.remainingDays, 265); assert.strictEqual(days(r), 30); step('désactivation de L1 sur A : elle garde 265 jours');
  r = await svc.activate({ key: L1, email, machine: B }); assert.strictEqual(days(r), 265); step('L1 réactivée sur le poste B pour ses 265 jours restants');
  T += 40 * DAY; r = await svc.status({ email, machine: A }); assert.strictEqual(days(r), 0); assert.strictEqual(r.licences.length, 0); step('L2 épuisée sur A au bout de 30 jours : libérée');
  await fails(svc.activate({ key: L2, email, machine: B }), 'EXPIRED'); step('licence épuisée refusée');
  r = await svc.activate({ key: L3, email, machine: B }); assert.strictEqual(days(r), 225 + 90); step('B : L1 (225 j) + L3 (90 j) = 315 jours');
  const h = await handle(svc, 'POST', '/v1/activate', { key: L1, email, machine: A }); assert.strictEqual(h.status, 409); assert.strictEqual(h.body.code, 'ACTIVE_ELSEWHERE'); step('réponse HTTP 409 claire');
  console.log(ok.map((s) => '✔ ' + s).join('\n') + `\nTOUS LES TESTS RÉUSSIS (${ok.length})`);
})().catch((e) => { console.error('ÉCHEC après :', ok.length, 'tests réussis\n', e); process.exit(1); });
