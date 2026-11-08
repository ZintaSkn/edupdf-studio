// SknEDU-studio — service d'activation des licences, version Cloudflare Workers.
// Données : un Durable Object unique (stockage SQLite, offre gratuite) — toutes les demandes y sont traitées une à une,
// donc une licence ne peut jamais être activée sur deux postes en même temps, et un transfert est immédiat.
// Secret : SERVER_PRIVATE_KEY (clé Ed25519 du service, PKCS8 PEM). Variable : LICENCE_PUBLIC_KEY (clé publique de l'éditeur).
// Déploiement : voir docs/SERVEUR-LICENCES.md.
import { DurableObject } from 'cloudflare:workers';
import { createService, handle } from './core.js';

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
  /** Appel depuis le Worker : traité seul, sans entrelacement avec une autre demande. */
  async process(method, pathname, body, ip) {
    if (!this.allow(ip || 'inconnu')) return { status: 429, body: { ok: false, code: 'RATE_LIMIT', error: 'Trop de demandes : réessayez dans une minute.' } };
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.protocol !== 'https:') return json(400, { ok: false, code: 'HTTPS', error: 'HTTPS obligatoire.' });
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
