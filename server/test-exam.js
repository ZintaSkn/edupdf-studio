// Tests de l'épreuve en ligne (boîte de dépôt chiffrée) : node server/test-exam.js  (aucune connexion, horloge simulée)
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const { LIMITS, plan, newMeta, handleExam, examAlarm, copyLimiter } = require('./exam-core');

let t = Date.UTC(2026, 10, 20, 8, 0, 0); const now = () => t; const DAY = 86400000;
const sha = async (x) => crypto.createHash('sha256').update(x).digest('hex');
const cid = () => crypto.randomBytes(16).toString('hex');
const bytes = (n, fill = 7) => new Uint8Array(n).fill(fill);
function store() { // stockage en mémoire, comme celui d'un Durable Object
  const m = new Map(); let alarm = null;
  return { m, get alarm() { return alarm; },
    get: async (k) => (m.has(k) ? m.get(k) : undefined), put: async (k, v) => { m.set(k, v); },
    delete: async (k) => { for (const x of [].concat(k)) m.delete(x); }, deleteAll: async () => { m.clear(); }, setAlarm: async (x) => { alarm = x; } };
}
let used = 0; const QUOTA = 300 * 1048576;
const quota = async (d) => { if (d > 0 && used + d > QUOTA) return false; used = Math.max(0, used + d); return true; };

(async () => {
  // 1. date limite : au moins 10 minutes, au plus 31 jours
  assert.strictEqual(plan(t, t + 5 * 60000), null); assert.strictEqual(plan(t, t + 32 * DAY), null); assert.strictEqual(plan(t, 'demain'), null);
  const p = plan(t, t + 2 * DAY); assert.ok(p && p.contentUntil === p.deadline + DAY && p.keepUntil === p.deadline + 30 * DAY);

  const st = store(); const hostKey = crypto.randomBytes(32).toString('base64url');
  await st.put('meta', newMeta(await sha(hostKey), p, t));
  const ctx = { st, now, quota, allowCopy: copyLimiter(now) };
  const call = (method, sub, { auth, headers = {}, body = new Uint8Array(0), ip = '10.0.0.1' } = {}) => handleExam(ctx, {
    method, sub, ip, hash: sha, body: async () => body,
    header: (n) => ({ ...headers, ...(auth ? { authorization: 'Bearer ' + auth } : {}), 'content-length': String(body.length) })[n.toLowerCase()] || '' });

  // 2. avant ouverture : rien de visible pour les élèves ; dépôt réservé à l'enseignant
  assert.deepStrictEqual((await call('GET', '/s')).json, { open: false, closed: false, deadline: p.deadline });
  assert.strictEqual((await call('PUT', '/b/info', { body: bytes(50) })).status, 401);
  assert.strictEqual((await call('PUT', '/b/info', { auth: crypto.randomBytes(32).toString('base64url'), body: bytes(50) })).status, 401);
  assert.strictEqual((await call('POST', '/open', { auth: hostKey })).status, 409, 'ouverture sans description refusée');
  assert.strictEqual((await call('PUT', '/b/info', { auth: hostKey, body: bytes(50, 1) })).status, 204);
  assert.strictEqual((await call('PUT', '/b/info', { auth: hostKey, body: bytes(60, 2) })).status, 204, 'remplacée avant ouverture');
  assert.strictEqual((await call('PUT', '/b/pdf.0', { auth: hostKey, body: bytes(9 * 1048576 / 2) })).status, 204, 'morceau de 4,5 Mo découpé en stockage');
  assert.strictEqual((await call('PUT', '/b/p0', { auth: hostKey, body: bytes(LIMITS.blob + 1) })).status, 413);
  assert.strictEqual((await call('PUT', '/b/../meta', { auth: hostKey, body: bytes(10) })).status, 404, 'nom de morceau piégé');
  assert.strictEqual((await call('PUT', '/b/p0', { auth: hostKey, body: new Uint8Array(0) })).status, 400);
  assert.strictEqual((await call('GET', '/b/info')).status, 404, 'invisible avant ouverture');
  assert.strictEqual((await call('GET', '/b/info', { auth: hostKey })).status, 200, 'l\'enseignant peut vérifier');
  assert.strictEqual((await call('POST', '/c', { headers: { 'x-id': cid() }, body: bytes(500) })).status, 404, 'copie refusée avant ouverture');
  assert.strictEqual(used, 60 + 9 * 1048576 / 2, 'quota : le morceau remplacé est libéré');

  // 3. ouverture : l'épreuve ne change plus ; les élèves lisent les morceaux
  assert.strictEqual((await call('POST', '/open', { auth: hostKey })).status, 204);
  assert.strictEqual((await call('PUT', '/b/info', { auth: hostKey, body: bytes(10) })).status, 409, 'immuable après ouverture');
  const info = await call('GET', '/b/info'); assert.strictEqual(info.status, 200); assert.strictEqual(info.body.length, 60); assert.strictEqual(info.body[0], 2); assert.strictEqual(info.cache, true);
  const big = await call('GET', '/b/pdf.0'); assert.strictEqual(big.body.length, 9 * 1048576 / 2);
  assert.strictEqual((await call('GET', '/b/p7')).status, 404);

  // 4. dépôt des copies : identifiant, taille, doublon, limites
  const c1 = cid(); const r1 = await call('POST', '/c', { headers: { 'x-id': c1 }, body: bytes(5000, 3) });
  assert.strictEqual(r1.status, 200); assert.strictEqual(r1.json.at, t);
  assert.strictEqual((await call('POST', '/c', { headers: { 'x-id': c1 }, body: bytes(5000) })).status, 409, 'même dépôt refusé');
  assert.strictEqual((await call('POST', '/c', { headers: { 'x-id': 'pas-un-id' }, body: bytes(5000) })).status, 400);
  assert.strictEqual((await call('POST', '/c', { headers: { 'x-id': cid() }, body: bytes(20) })).status, 400, 'copie vide');
  assert.strictEqual((await call('POST', '/c', { headers: { 'x-id': cid() }, body: bytes(LIMITS.copy + 1) })).status, 413);
  const c2 = cid(); assert.strictEqual((await call('POST', '/c', { headers: { 'x-id': c2 }, body: bytes(LIMITS.chunk * 2 + 10, 4) })).status, 200, 'copie de plus de 8 Mo découpée');

  // 5. seul l'enseignant liste, lit et supprime les copies
  assert.strictEqual((await call('GET', '/c')).status, 401); assert.strictEqual((await call('GET', '/c/' + c1)).status, 401); assert.strictEqual((await call('DELETE', '/c/' + c1)).status, 401);
  assert.strictEqual((await call('DELETE', '')).status, 401, 'fermeture réservée à l\'enseignant');
  const list = await call('GET', '/c', { auth: hostKey }); assert.deepStrictEqual(list.json.copies.map((c) => c.id).sort(), [c1, c2].sort());
  const g2 = await call('GET', '/c/' + c2, { auth: hostKey }); assert.strictEqual(g2.body.length, LIMITS.chunk * 2 + 10); assert.ok(g2.body.every((x) => x === 4));
  assert.strictEqual(g2.cache, undefined, 'une copie n\'est jamais mise en cache');
  assert.strictEqual((await call('DELETE', '/c/' + c2, { auth: hostKey })).status, 204);
  assert.strictEqual((await call('GET', '/c/' + c2, { auth: hostKey })).status, 404);
  assert.strictEqual((await call('POST', '/c', { headers: { 'x-id': c2 }, body: bytes(5000) })).status, 409, 'numéro déjà utilisé, même après relève');
  assert.ok(![...st.m.keys()].some((k) => k.startsWith('c:' + c2 + ':')), 'morceaux de la copie supprimés');

  // 6. limite par adresse : 150 copies par heure
  const ip = '203.0.113.9'; let refusedAt = 0;
  for (let i = 1; i <= LIMITS.perIpCopiesPerHour + 1; i++) { const r = await call('POST', '/c', { ip, headers: { 'x-id': cid() }, body: bytes(200) }); if (r.status === 429) { refusedAt = i; break; } }
  assert.strictEqual(refusedAt, LIMITS.perIpCopiesPerHour + 1);

  // 7. date limite : délai de grâce de 2 minutes, puis plus aucun dépôt
  t = p.deadline + 60000; assert.strictEqual((await call('POST', '/c', { headers: { 'x-id': cid() }, body: bytes(300) })).status, 200, 'envoi commencé juste avant la date limite');
  t = p.deadline + LIMITS.graceMs + 1; assert.strictEqual((await call('POST', '/c', { headers: { 'x-id': cid() }, body: bytes(300) })).status, 410);
  assert.strictEqual((await call('GET', '/s')).json.closed, true);

  // 8. réveils : contenu effacé un jour après, copies non relevées gardées jusqu'au 30e jour
  const before = used; t = p.contentUntil; await examAlarm(ctx);
  assert.strictEqual((await call('GET', '/b/info')).status, 410); assert.strictEqual(st.alarm, p.keepUntil);
  assert.ok(used < before, 'quota libéré'); assert.strictEqual((await call('GET', '/c', { auth: hostKey })).json.copies.length > 0, true, 'copies toujours relevables');
  t = p.keepUntil; await examAlarm(ctx); assert.strictEqual(st.m.size, 0, 'tout est effacé'); assert.strictEqual((await call('GET', '/s')).status, 404);

  // 9. fermeture par l'enseignant : tout est effacé, quota rendu
  const st2 = store(); const hk2 = crypto.randomBytes(32).toString('base64url'); t = Date.UTC(2026, 10, 21);
  const p2 = plan(t, t + DAY); await st2.put('meta', newMeta(await sha(hk2), p2, t));
  const ctx2 = { st: st2, now, quota, allowCopy: copyLimiter(now) }; const u0 = used;
  const call2 = (method, sub, o = {}) => handleExam(ctx2, { method, sub, ip: '1.1.1.1', hash: sha, body: async () => o.body || new Uint8Array(0), header: (n) => ({ ...(o.headers || {}), ...(o.auth ? { authorization: 'Bearer ' + o.auth } : {}) })[n.toLowerCase()] || '' });
  await call2('PUT', '/b/info', { auth: hk2, body: bytes(1000) }); await call2('POST', '/open', { auth: hk2 });
  await call2('POST', '/c', { headers: { 'x-id': cid() }, body: bytes(2000) });
  const end = await call2('DELETE', '', { auth: hk2 }); assert.strictEqual(end.status, 204); assert.strictEqual(end.end, true);
  assert.strictEqual(st2.m.size, 0); assert.strictEqual(used, u0, 'quota rendu à la fermeture');

  // 10. quota global plein : dépôt refusé (507), le reste du service continue
  const st3 = store(); const hk3 = crypto.randomBytes(32).toString('base64url'); const p3 = plan(t, t + DAY); await st3.put('meta', newMeta(await sha(hk3), p3, t));
  const ctx3 = { st: st3, now, quota: async (d) => d <= 0, allowCopy: () => true };
  const r3 = await handleExam(ctx3, { method: 'PUT', sub: '/b/info', ip: '1.1.1.1', hash: sha, body: async () => bytes(10), header: (n) => (n === 'authorization' ? 'Bearer ' + hk3 : '') });
  assert.strictEqual(r3.status, 507);

  console.log('ALL OK — épreuve en ligne : date limite, dépôt réservé, immuable après ouverture, copies (taille, doublons, limite par adresse), relève réservée, grâce de 2 min, effacements programmés, quota');
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
