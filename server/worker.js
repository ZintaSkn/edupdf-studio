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

export class LicenceStore extends DurableObject {
  async keys() {
    if (!this.k) this.k = {
      priv: await crypto.subtle.importKey('pkcs8', pemToBytes(this.env.SERVER_PRIVATE_KEY), { name: 'Ed25519' }, false, ['sign']),
      pub: await crypto.subtle.importKey('spki', pemToBytes(this.env.LICENCE_PUBLIC_KEY), { name: 'Ed25519' }, false, ['verify'])
    };
    return this.k;
  }
  /** Appel depuis le Worker : traité seul, sans entrelacement avec une autre demande. */
  async process(method, pathname, body) {
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
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
    if (request.method === 'GET' && url.pathname === '/') return new Response(JSON.stringify({ service: 'SknEDU-studio licences', ok: true }), { headers });
    let body = null; try { body = await request.json(); } catch { body = null; }
    const stub = env.STORE.get(env.STORE.idFromName('licences'));
    const r = await stub.process(request.method, url.pathname, body);
    return new Response(JSON.stringify(r.body), { status: r.status, headers });
  }
};
