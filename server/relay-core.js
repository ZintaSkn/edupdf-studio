// SknEDU-studio — relais de la classe connectée : logique commune (Node pour les tests, Cloudflare Worker en ligne).
//
// Rôle : permettre à un élève hors du réseau de la classe (maison, 4G) de joindre le PC de l'enseignant, qui n'est pas
// joignable depuis Internet. Le relais est une simple boîte aux lettres :
//   élève      → POST /r/<salle>/q        dépose une demande et attend la réponse ;
//   enseignant → GET  /r/<salle>/next     vient chercher la demande suivante (attente longue) ;
//   enseignant → POST /r/<salle>/a/<id>   dépose la réponse, remise à l'élève.
// Le relais ne peut RIEN lire : demandes et réponses sont chiffrées (AES-256-GCM) avec une clé qui ne figure que dans
// le lien remis aux élèves, après « # » — partie que les navigateurs n'envoient jamais. Il ne voit que des tailles et des horaires.
// Rien n'est écrit sur disque ; une salle disparaît à la fin du partage ou à son échéance.
'use strict';

const LIMITS = {
  body: 30 * 1048576,        // une demande ou une réponse
  pending: 80,               // demandes en attente de réponse
  queuedBytes: 96 * 1048576, // total des demandes en file
  cacheBytes: 64 * 1048576,  // réponses communes gardées (document, images des pages) — toujours chiffrées
  cacheItem: 24 * 1048576,
  waitMs: 90000,             // attente maximale d'une réponse par l'élève
  pollMs: 25000,             // attente longue de l'enseignant
  hostGoneMs: 60000,         // sans nouvelle de l'enseignant : « hors ligne »
  ttlMs: 8 * 3600000         // durée de vie maximale d'une salle
};
const ID_RE = /^[0-9a-f]{16,64}$/; const CACHE_RE = /^[A-Za-z0-9_-]{20,64}$/; const ROOM_RE = /^[A-Za-z0-9_-]{16,40}$/;

/**
 * Une salle. Dépendances injectées : now() → ms, setTimeout, clearTimeout.
 * Les contenus sont des Uint8Array opaques (chiffrés).
 */
function createRoom({ now, setTimeout: st, clearTimeout: ct }) {
  const queue = []; const waiters = []; const pending = new Map(); const cache = new Map();
  let cacheBytes = 0; let queuedBytes = 0; let lastHost = 0; let closed = false; let served = 0;
  const dequeue = (id) => { const i = queue.findIndex((q) => q.id === id); if (i >= 0) { queuedBytes -= queue[i].body.length; queue.splice(i, 1); } };
  const finish = (id, res) => { const p = pending.get(id); if (!p) return false; ct(p.timer); pending.delete(id); dequeue(id); p.resolve(res); return true; };

  /** Élève : dépose une demande ; la promesse rend { status, body?, aad? }. */
  function ask({ id, body, cacheKey }) {
    if (closed) return Promise.resolve({ status: 410 });
    if (!ID_RE.test(String(id)) || (cacheKey && !CACHE_RE.test(cacheKey)) || !body || !body.length) return Promise.resolve({ status: 400 });
    if (body.length > LIMITS.body) return Promise.resolve({ status: 413 });
    if (cacheKey && cache.has(cacheKey)) { served++; return Promise.resolve({ status: 200, body: cache.get(cacheKey), aad: 'c' }); }
    if (!lastHost || now() - lastHost > LIMITS.hostGoneMs) return Promise.resolve({ status: 503 });
    if (pending.has(id)) return Promise.resolve({ status: 409 });
    if (pending.size >= LIMITS.pending || queuedBytes + body.length > LIMITS.queuedBytes) return Promise.resolve({ status: 429 });
    return new Promise((resolve) => {
      const item = { id, body, cacheKey: cacheKey || '' };
      pending.set(id, { resolve, cacheKey: item.cacheKey, timer: st(() => finish(id, { status: 504 }), LIMITS.waitMs) });
      const w = waiters.shift();
      if (w) { ct(w.timer); w.resolve(item); } else { queue.push(item); queuedBytes += body.length; }
    });
  }
  /** Enseignant : demande suivante, ou null après l'attente longue. */
  function next() {
    lastHost = now();
    if (closed) return Promise.resolve(null);
    const item = queue.shift();
    if (item) { queuedBytes -= item.body.length; return Promise.resolve(item); }
    return new Promise((resolve) => {
      const w = { resolve, timer: st(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); lastHost = now(); resolve(null); }, LIMITS.pollMs) };
      waiters.push(w);
    });
  }
  /** Enseignant : réponse à la demande « id ». shared = réponse commune à toute la classe (gardée, chiffrée, pour les suivants). */
  function answer(id, body, shared) {
    lastHost = now();
    const p = pending.get(id); if (!p || !body || !body.length || body.length > LIMITS.body) return false;
    const keep = !!shared && !!p.cacheKey && body.length <= LIMITS.cacheItem;
    if (keep) {
      while (cacheBytes + body.length > LIMITS.cacheBytes && cache.size) { const k = cache.keys().next().value; cacheBytes -= cache.get(k).length; cache.delete(k); }
      if (!cache.has(p.cacheKey)) { cache.set(p.cacheKey, body); cacheBytes += body.length; }
    }
    served++;
    return finish(id, { status: 200, body, aad: keep ? 'c' : 'a' });
  }
  function close() {
    closed = true;
    for (const id of [...pending.keys()]) finish(id, { status: 410 });
    for (const w of waiters.splice(0)) { ct(w.timer); w.resolve(null); }
    cache.clear(); cacheBytes = 0; queue.length = 0; queuedBytes = 0;
  }
  return { ask, next, answer, close, stats: () => ({ pending: pending.size, queued: queue.length, cached: cache.size, cacheBytes, served, closed }) };
}

/**
 * Traite une demande HTTP adressée à une salle.
 * room : createRoom(…) ; meta : { hostHash, expires } ; req : { method, sub ('/q', '/next', '/a/<id>', ''), header(nom) → valeur, body() → Promise<Uint8Array>, hash(texte) → Promise<hex> }.
 * Rend { status, body?, headers? } ; « end: true » demande à l'hôte de supprimer la salle.
 */
async function handleRoom(room, meta, req, now) {
  if (!meta || now() > meta.expires) return { status: 410, end: true };
  const isHost = async () => { const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.header('authorization') || ''); return !!m && (await req.hash(m[1])) === meta.hostHash; };
  const { method, sub } = req;
  if (method === 'POST' && sub === '/q') {
    const len = Number(req.header('content-length') || 0); if (len > LIMITS.body) return { status: 413 };
    const body = await req.body(); if (body.length > LIMITS.body) return { status: 413 };
    const r = await room.ask({ id: req.header('x-id') || '', body, cacheKey: req.header('x-cache') || '' });
    return r.status === 200 ? { status: 200, body: r.body, headers: { 'X-Aad': r.aad } } : { status: r.status };
  }
  if (method === 'GET' && sub === '/next') {
    if (!(await isHost())) return { status: 401 };
    const item = await room.next();
    return item ? { status: 200, body: item.body, headers: { 'X-Id': item.id, 'X-Cache': item.cacheKey } } : { status: 204 };
  }
  const a = /^\/a\/([0-9a-f]{16,64})$/.exec(sub);
  if (method === 'POST' && a) {
    if (!(await isHost())) return { status: 401 };
    const body = await req.body();
    return { status: room.answer(a[1], body, req.header('x-shared') === '1') ? 204 : 404 };
  }
  if (method === 'DELETE' && sub === '') {
    if (!(await isHost())) return { status: 401 };
    room.close(); return { status: 204, end: true };
  }
  return { status: 404 };
}

module.exports = { createRoom, handleRoom, LIMITS, ROOM_RE };
