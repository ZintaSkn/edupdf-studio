// Tests du relais de la classe connectée : node server/test-relay.js  (aucune connexion, horloge simulée)
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const { createRoom, handleRoom, LIMITS } = require('./relay-core');

// horloge simulée
let t = 1000000; const timers = [];
const T = { now: () => t, setTimeout: (f, ms) => { const x = { f, at: t + ms }; timers.push(x); return x; }, clearTimeout: (x) => { const i = timers.indexOf(x); if (i >= 0) timers.splice(i, 1); } };
const advance = (ms) => { t += ms; for (const x of timers.filter((y) => y.at <= t)) { T.clearTimeout(x); x.f(); } };
const bytes = (s) => new Uint8Array(Buffer.from(s)); const id = () => crypto.randomBytes(16).toString('hex');
const tick = () => new Promise((r) => setImmediate(r));
const sha = async (x) => crypto.createHash('sha256').update(x).digest('hex');

(async () => {
  // 1. sans enseignant connecté : « hors ligne »
  let room = createRoom(T);
  assert.strictEqual((await room.ask({ id: id(), body: bytes('x') })).status, 503);

  // 2. aller-retour : l'enseignant attend, l'élève demande, la réponse revient
  const poll = room.next(); const q1 = id(); const ans = room.ask({ id: q1, body: bytes('demande') });
  const got = await poll; assert.strictEqual(got.id, q1); assert.strictEqual(Buffer.from(got.body).toString(), 'demande');
  assert.strictEqual(room.answer('00'.repeat(16), bytes('x'), false), false, 'réponse à une demande inconnue refusée');
  assert.strictEqual(room.answer(q1, bytes('réponse'), false), true);
  const r1 = await ans; assert.strictEqual(r1.status, 200); assert.strictEqual(r1.aad, 'a'); assert.strictEqual(Buffer.from(r1.body).toString(), 'réponse');
  assert.strictEqual(room.answer(q1, bytes('encore'), false), false, 'une demande ne reçoit qu\'une réponse');

  // 3. demande en file avant que l'enseignant ne revienne ; identifiant en double refusé
  const q2 = id(); const a2 = room.ask({ id: q2, body: bytes('en file') });
  assert.strictEqual((await room.ask({ id: q2, body: bytes('doublon') })).status, 409);
  assert.strictEqual((await room.next()).id, q2); room.answer(q2, bytes('ok'), false); assert.strictEqual((await a2).status, 200);

  // 4. réponse commune : gardée (chiffrée) et resservie sans déranger l'enseignant
  const ck = crypto.randomBytes(32).toString('base64url'); const q3 = id(); const a3 = room.ask({ id: q3, body: bytes('doc'), cacheKey: ck });
  await room.next(); room.answer(q3, bytes('document chiffré'), true); assert.strictEqual((await a3).aad, 'c');
  const again = await room.ask({ id: id(), body: bytes('doc'), cacheKey: ck });
  assert.strictEqual(again.status, 200); assert.strictEqual(again.aad, 'c'); assert.strictEqual(Buffer.from(again.body).toString(), 'document chiffré');
  assert.strictEqual(room.stats().cached, 1);
  // une réponse non commune n'est jamais gardée, même avec une étiquette
  const ck2 = crypto.randomBytes(32).toString('base64url'); const q4 = id(); const a4 = room.ask({ id: q4, body: bytes('copie'), cacheKey: ck2 });
  await room.next(); room.answer(q4, bytes('privé'), false); assert.strictEqual((await a4).aad, 'a'); assert.strictEqual(room.stats().cached, 1);

  // 5. entrées invalides et limites
  assert.strictEqual((await room.ask({ id: 'pas-hexa', body: bytes('x') })).status, 400);
  assert.strictEqual((await room.ask({ id: id(), body: bytes('x'), cacheKey: '../../x' })).status, 400);
  assert.strictEqual((await room.ask({ id: id(), body: new Uint8Array(0) })).status, 400);
  assert.strictEqual((await room.ask({ id: id(), body: new Uint8Array(LIMITS.body + 1) })).status, 413);
  const many = []; for (let i = 0; i < LIMITS.pending; i++) many.push(room.ask({ id: id(), body: bytes('x') }));
  assert.strictEqual((await room.ask({ id: id(), body: bytes('x') })).status, 429, 'trop de demandes en attente');

  // 6. délais : l'élève n'attend pas indéfiniment ; l'attente longue de l'enseignant se termine ; enseignant absent = hors ligne
  advance(LIMITS.waitMs + 1); assert.ok((await Promise.all(many)).every((r) => r.status === 504));
  assert.strictEqual(room.stats().pending, 0); assert.strictEqual(room.stats().queued, 0);
  const idle = room.next(); advance(LIMITS.pollMs + 1); assert.strictEqual(await idle, null);
  advance(LIMITS.hostGoneMs + 1); assert.strictEqual((await room.ask({ id: id(), body: bytes('x') })).status, 503);

  // 7. fermeture : tout le monde est prévenu, plus rien n'est gardé
  room.next().then(() => {}); const q5 = id(); room.next(); const a5 = room.ask({ id: q5, body: bytes('x') }); room.close();
  assert.strictEqual((await a5).status, 410); assert.strictEqual((await room.ask({ id: id(), body: bytes('x') })).status, 410);
  assert.strictEqual(room.stats().cached, 0);

  // 8. couche HTTP : seul l'enseignant (clé de salle) lit les demandes, y répond et ferme ; salle échue
  room = createRoom(T); const hostKey = crypto.randomBytes(32).toString('base64url'); const meta = { hostHash: await sha(hostKey), expires: t + 3600000 };
  const req = (method, sub, headers = {}, body = '') => ({ method, sub, header: (n) => headers[n.toLowerCase()] || '', body: async () => bytes(body), hash: sha });
  assert.strictEqual((await handleRoom(room, meta, req('GET', '/next'), T.now)).status, 401);
  assert.strictEqual((await handleRoom(room, meta, req('GET', '/next', { authorization: 'Bearer ' + crypto.randomBytes(32).toString('base64url') }), T.now)).status, 401);
  assert.strictEqual((await handleRoom(room, meta, req('POST', '/a/' + id(), {}, 'x'), T.now)).status, 401);
  assert.strictEqual((await handleRoom(room, meta, req('DELETE', ''), T.now)).status, 401);
  const auth = { authorization: 'Bearer ' + hostKey };
  const hp = handleRoom(room, meta, req('GET', '/next', auth), T.now); await tick();
  const q6 = id(); const sp = handleRoom(room, meta, req('POST', '/q', { 'x-id': q6 }, 'bonjour'), T.now);
  const item = await hp; assert.strictEqual(item.status, 200); assert.strictEqual(item.headers['X-Id'], q6);
  assert.strictEqual((await handleRoom(room, meta, req('POST', '/a/' + q6, auth, 'salut'), T.now)).status, 204);
  const back = await sp; assert.strictEqual(back.status, 200); assert.strictEqual(Buffer.from(back.body).toString(), 'salut'); assert.strictEqual(back.headers['X-Aad'], 'a');
  assert.strictEqual((await handleRoom(room, meta, req('POST', '/q', { 'x-id': id(), 'content-length': String(LIMITS.body + 1) }, 'x'), T.now)).status, 413);
  assert.strictEqual((await handleRoom(room, meta, req('GET', '/inconnu'), T.now)).status, 404);
  const del = await handleRoom(room, meta, req('DELETE', '', auth), T.now); assert.strictEqual(del.status, 204); assert.strictEqual(del.end, true);
  const old = await handleRoom(createRoom(T), { hostHash: meta.hostHash, expires: t - 1 }, req('POST', '/q', { 'x-id': id() }, 'x'), T.now);
  assert.strictEqual(old.status, 410); assert.strictEqual(old.end, true);

  console.log('ALL OK — relais : aller-retour, file, réponses communes, limites, délais, fermeture, accès réservé à l\'enseignant');
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
