// SknEDU-studio — service d'activation des licences, version Cloudflare Workers.
// Données : un Durable Object unique (stockage SQLite, offre gratuite) — toutes les demandes y sont traitées une à une,
// donc une licence ne peut jamais être activée sur deux postes en même temps, et un transfert est immédiat.
// Secret : SERVER_PRIVATE_KEY (clé Ed25519 du service, PKCS8 PEM). Variable : LICENCE_PUBLIC_KEY (clé publique de l'éditeur).
// Déploiement : voir docs/SERVEUR-LICENCES.md.
import { DurableObject } from 'cloudflare:workers';
import { createService, handle } from './core.js';
import { createRoom, handleRoom, LIMITS, ROOM_RE } from './relay-core.js';
import { LIMITS as EXAM_LIMITS, ID_RE as EXAM_ID_RE, plan as examPlan, newMeta as examMeta, handleExam, examAlarm, copyLimiter } from './exam-core.js';
import { remoteShell, examShell } from '../src/student-page.js';

const pemToBytes = (pem) => Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const enc = new TextEncoder();
const MAX_BODY = 16 * 1024;            // une demande d'activation fait moins de 2 Ko
const RATE = { limit: 60, windowMs: 60000 }; // par adresse IP
// En-têtes de sécurité (aucun contenu actif, HTTPS obligatoire, pas de mise en cache)
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer' };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: HEADERS });

export class LicenceStore extends DurableObject {
  async keys() {
    if (!this.k) this.k = {
      priv: await crypto.subtle.importKey('pkcs8', pemToBytes(this.env.SERVER_PRIVATE_KEY), { name: 'Ed25519' }, false, ['sign']),
      pub: await crypto.subtle.importKey('spki', pemToBytes(this.env.LICENCE_PUBLIC_KEY), { name: 'Ed25519' }, false, ['verify'])
    };
    return this.k;
  }
  /** Limitation de débit par adresse (en mémoire du Durable Object unique). */
  allow(ip) {
    const t = Date.now(); this.rl = this.rl || new Map(); const e = this.rl.get(ip) || { n: 0, since: t };
    if (t - e.since > RATE.windowMs) { e.n = 0; e.since = t; }
    e.n++; this.rl.set(ip, e);
    if (this.rl.size > 5000) for (const [k, v] of this.rl) if (t - v.since > RATE.windowMs) this.rl.delete(k);
    return e.n <= RATE.limit;
  }
  /** Relais : au plus 40 salles par heure et par adresse (une école entière sort souvent par une seule adresse). */
  allowRoom(ip) {
    const t = Date.now(); this.rooms = this.rooms || new Map(); const e = this.rooms.get(ip) || { n: 0, since: t };
    if (t - e.since > 3600000) { e.n = 0; e.since = t; }
    e.n++; this.rooms.set(ip, e);
    if (this.rooms.size > 5000) for (const [k, v] of this.rooms) if (t - v.since > 3600000) this.rooms.delete(k);
    return e.n <= 40;
  }
  /** Épreuves en ligne : au plus 30 créations par heure et par adresse. */
  allowExam(ip) {
    const t = Date.now(); this.exams = this.exams || new Map(); const e = this.exams.get(ip) || { n: 0, since: t };
    if (t - e.since > 3600000) { e.n = 0; e.since = t; }
    e.n++; this.exams.set(ip, e);
    if (this.exams.size > 5000) for (const [k, v] of this.exams) if (t - v.since > 3600000) this.exams.delete(k);
    return e.n <= 30;
  }
  /**
   * Place occupée par toutes les épreuves en ligne (octets) : au plus 3 Go, pour que le stockage de l'offre gratuite (5 Go)
   * ne puisse jamais être rempli au point de bloquer l'activation des licences.
   */
  async examQuota(delta) {
    const d = Math.trunc(Number(delta) || 0); const used = (await this.ctx.storage.get('quota:epreuves')) || 0;
    if (d > 0 && used + d > 3 * 1024 ** 3) { console.warn(JSON.stringify({ evenement: 'epreuves_quota_atteint' })); return false; }
    await this.ctx.storage.put('quota:epreuves', Math.max(0, used + d)); return true;
  }
  /** Appel depuis le Worker : traité seul, sans entrelacement avec une autre demande. */
  async process(method, pathname, body, ip) {
    if (!this.allow(ip || 'inconnu')) { console.warn(JSON.stringify({ evenement: 'licences_limite' })); return { status: 429, body: { ok: false, code: 'RATE_LIMIT', error: 'Trop de demandes : réessayez dans une minute.' } }; }
    const k = await this.keys(); const st = this.ctx.storage;
    const service = createService({
      store: { get: async (key) => (await st.get(key)) || null, put: async (key, v) => st.put(key, v) },
      now: () => Date.now(),
      verifyLicence: async (data, sig) => { try { return await crypto.subtle.verify({ name: 'Ed25519' }, k.pub, fromB64u(sig), enc.encode(data)); } catch { return false; } },
      sign: async (data) => b64u(await crypto.subtle.sign({ name: 'Ed25519' }, k.priv, enc.encode(data)))
    });
    return this.ctx.blockConcurrencyWhile(() => handle(service, method, pathname, body));
  }
}

// ---------- Relais de la classe connectée (voir relay-core.js) : une salle = un Durable Object, tout en mémoire, contenus chiffrés ----------
const RELAY_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Strict-Transport-Security': 'max-age=63072000; includeSubDomains', 'Referrer-Policy': 'no-referrer' };
const SHELL_HEADERS = { ...RELAY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; img-src 'self' blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" };
const sha256hex = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const rnd = (n) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const TIMERS = { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t) };
export class Room extends DurableObject {
  async init(hostHash, expires) {
    this.meta = { hostHash, expires }; await this.ctx.storage.put('meta', this.meta); await this.ctx.storage.setAlarm(expires);
    this.room = createRoom(TIMERS); return true;
  }
  async end() { if (this.room) this.room.close(); this.room = null; this.meta = null; await this.ctx.storage.deleteAll(); }
  async alarm() { await this.end(); }
  async fetch(request) {
    if (!this.meta) this.meta = (await this.ctx.storage.get('meta')) || null;
    if (!this.meta) return new Response(null, { status: 404, headers: RELAY_HEADERS });
    if (!this.room) this.room = createRoom(TIMERS);
    const ip = request.headers.get('cf-connecting-ip') || 'inconnu'; const t = Date.now(); this.rl = this.rl || new Map(); const e = this.rl.get(ip) || { n: 0, since: t };
    if (t - e.since > 60000) { e.n = 0; e.since = t; }
    e.n++; this.rl.set(ip, e); if (this.rl.size > 3000) for (const [k, v] of this.rl) if (t - v.since > 60000) this.rl.delete(k);
    if (e.n > 900) { if (e.n === 901) console.warn(JSON.stringify({ evenement: 'relais_limite' })); return new Response(null, { status: 429, headers: { ...RELAY_HEADERS, 'Retry-After': '60' } }); } // 900 demandes par minute et par adresse
    const sub = new URL(request.url).pathname.replace(/^\/r\/[^/]+/, '');
    const r = await handleRoom(this.room, this.meta, { method: request.method, sub, header: (n) => request.headers.get(n), body: async () => new Uint8Array(await request.arrayBuffer()), hash: sha256hex }, TIMERS.now);
    if (r.status === 401 || r.status === 413) console.warn(JSON.stringify({ evenement: 'relais_refus', statut: r.status, action: request.method + ' ' + sub.replace(/[0-9a-f]{16,}/, '…') })); // journal de supervision : ni adresse ni contenu
    if (r.end) await this.end();
    return new Response(r.body || null, { status: r.status, headers: { ...RELAY_HEADERS, ...(r.body ? { 'Content-Type': 'application/octet-stream' } : {}), ...(r.headers || {}) } });
  }
}
async function relay(request, env, url) {
  if (request.method === 'POST' && url.pathname === '/r/new') { // une salle par partage ; nombre limité par adresse
    const ip = request.headers.get('cf-connecting-ip') || 'inconnu';
    if (!(await env.STORE.get(env.STORE.idFromName('licences')).allowRoom(ip))) return (console.warn(JSON.stringify({ evenement: 'relais_salles_limite' })), json(429, { ok: false, code: 'RATE_LIMIT', error: 'Trop de partages à distance ouverts depuis ce réseau : réessayez plus tard.' }));
    const room = rnd(16); const hostKey = rnd(32); const expires = Date.now() + LIMITS.ttlMs;
    await env.ROOMS.get(env.ROOMS.idFromName(room)).init(await sha256hex(hostKey), expires);
    return json(200, { ok: true, room, hostKey, expires, maxBody: LIMITS.body });
  }
  const m = /^\/r\/([^/]+)(\/.*)?$/.exec(url.pathname);
  if (!m || !ROOM_RE.test(m[1])) return json(404, { ok: false, code: 'NOT_FOUND', error: 'Adresse inconnue.' });
  if (request.method === 'GET' && !m[2]) return new Response(remoteShell(), { status: 200, headers: SHELL_HEADERS }); // la page ne contient aucun contenu de la classe
  return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(request);
}

// ---------- Épreuve en ligne (voir exam-core.js) : une épreuve = un Durable Object qui garde des morceaux chiffrés ----------
export class Exam extends DurableObject {
  ctxOf() {
    const s = this.ctx.storage; const store = this.env.STORE.get(this.env.STORE.idFromName('licences'));
    if (!this.allowCopy) this.allowCopy = copyLimiter(() => Date.now());
    return { st: { get: (k) => s.get(k), put: (k, v) => s.put(k, v), delete: (k) => s.delete(k), deleteAll: () => s.deleteAll(), setAlarm: (t) => s.setAlarm(t) },
      now: () => Date.now(), quota: (d) => store.examQuota(d), allowCopy: this.allowCopy };
  }
  async init(hostHash, p) {
    if (await this.ctx.storage.get('meta')) throw new Error('épreuve existante');
    await this.ctx.storage.put('meta', examMeta(hostHash, p, Date.now())); await this.ctx.storage.setAlarm(p.contentUntil); return true;
  }
  async alarm() { await examAlarm(this.ctxOf()); }
  async fetch(request) {
    const ip = request.headers.get('cf-connecting-ip') || 'inconnu'; const t = Date.now(); this.rl = this.rl || new Map(); const e = this.rl.get(ip) || { n: 0, since: t };
    if (t - e.since > 60000) { e.n = 0; e.since = t; }
    e.n++; this.rl.set(ip, e); if (this.rl.size > 3000) for (const [k, v] of this.rl) if (t - v.since > 60000) this.rl.delete(k);
    if (e.n > 900) { if (e.n === 901) console.warn(JSON.stringify({ evenement: 'epreuve_limite' })); return new Response(null, { status: 429, headers: { ...RELAY_HEADERS, 'Retry-After': '60' } }); }
    const sub = new URL(request.url).pathname.replace(/^\/e\/[^/]+/, '');
    const r = await handleExam(this.ctxOf(), { method: request.method, sub, ip, header: (n) => request.headers.get(n), body: async () => new Uint8Array(await request.arrayBuffer()), hash: sha256hex });
    if (r.status === 401 || r.status === 413 || r.status === 507) console.warn(JSON.stringify({ evenement: 'epreuve_refus', statut: r.status, action: request.method + ' ' + sub.replace(/[0-9a-f]{16,}/, '…') })); // ni adresse ni contenu
    if (r.json) return new Response(JSON.stringify(r.json), { status: r.status, headers: { ...RELAY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' } });
    // morceaux de l'épreuve : immuables une fois ouverte, gardés par le navigateur de l'élève (ils restent chiffrés)
    return new Response(r.body || null, { status: r.status, headers: { ...RELAY_HEADERS, ...(r.body ? { 'Content-Type': 'application/octet-stream' } : {}), ...(r.cache ? { 'Cache-Control': 'private, max-age=86400, immutable' } : {}) } });
  }
}
async function exam(request, env, url) {
  if (request.method === 'POST' && url.pathname === '/e/new') { // création : nombre limité par adresse
    const ip = request.headers.get('cf-connecting-ip') || 'inconnu';
    if (!(await env.STORE.get(env.STORE.idFromName('licences')).allowExam(ip))) return (console.warn(JSON.stringify({ evenement: 'epreuves_creation_limite' })), json(429, { ok: false, code: 'RATE_LIMIT', error: 'Trop d\'épreuves créées depuis ce réseau : réessayez plus tard.' }));
    const raw = await request.text(); if (raw.length > 1024) return json(413, { ok: false, code: 'TOO_LARGE', error: 'Demande trop volumineuse.' });
    let b = null; try { b = JSON.parse(raw); } catch { b = null; }
    const p = b && typeof b === 'object' ? examPlan(Date.now(), b.deadline) : null;
    if (!p) return json(400, { ok: false, code: 'DEADLINE', error: 'Date limite refusée : entre 10 minutes et 31 jours.' });
    const id = rnd(16); const hostKey = rnd(32);
    await env.EXAMS.get(env.EXAMS.idFromName(id)).init(await sha256hex(hostKey), p);
    return json(200, { ok: true, id, hostKey, deadline: p.deadline, contentUntil: p.contentUntil, keepUntil: p.keepUntil, limits: { blob: EXAM_LIMITS.blob, copy: EXAM_LIMITS.copy } });
  }
  const m = /^\/e\/([^/]+)(\/.*)?$/.exec(url.pathname);
  if (!m || !EXAM_ID_RE.test(m[1])) return json(404, { ok: false, code: 'NOT_FOUND', error: 'Adresse inconnue.' });
  if (request.method === 'GET' && !m[2]) return new Response(examShell(), { status: 200, headers: SHELL_HEADERS }); // aucun contenu de l'épreuve dans la page
  return env.EXAMS.get(env.EXAMS.idFromName(m[1])).fetch(request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.protocol !== 'https:') return json(400, { ok: false, code: 'HTTPS', error: 'HTTPS obligatoire.' });
    if (url.pathname === '/r' || url.pathname.startsWith('/r/')) return relay(request, env, url);
    if (url.pathname === '/e' || url.pathname.startsWith('/e/')) return exam(request, env, url);
    if (request.method === 'GET' && url.pathname === '/') return json(200, { service: 'SknEDU-studio licences', ok: true });
    if (request.method === 'POST' && !/^application\/json\b/i.test(request.headers.get('content-type') || '')) return json(415, { ok: false, code: 'TYPE', error: 'JSON attendu.' });
    const raw = await request.text(); if (raw.length > MAX_BODY) return json(413, { ok: false, code: 'TOO_LARGE', error: 'Demande trop volumineuse.' });
    let body = null; try { body = raw ? JSON.parse(raw) : null; } catch { return json(400, { ok: false, code: 'JSON', error: 'JSON invalide.' }); }
    if (body !== null && (typeof body !== 'object' || Array.isArray(body))) return json(400, { ok: false, code: 'JSON', error: 'JSON invalide.' });
    const stub = env.STORE.get(env.STORE.idFromName('licences'));
    const r = await stub.process(request.method, url.pathname, body, request.headers.get('cf-connecting-ip') || '');
    return json(r.status, r.body);
  }
};
