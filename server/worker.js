// SknEDU-studio — service d'activation des licences, version Cloudflare Workers.
// Données : espace KV « LICENCES ». Secrets : SERVER_PRIVATE_KEY (clé Ed25519 du service, PKCS8 PEM).
// Variable : LICENCE_PUBLIC_KEY (clé publique de l'éditeur, la même que dans src/license.js).
// Déploiement : voir docs/SERVEUR-LICENCES.md.
import { createService, handle } from './core.js';

const pemToBytes = (pem) => Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const enc = new TextEncoder();
let KEYS = null;
async function keys(env) {
  if (!KEYS) KEYS = {
    priv: await crypto.subtle.importKey('pkcs8', pemToBytes(env.SERVER_PRIVATE_KEY), { name: 'Ed25519' }, false, ['sign']),
    pub: await crypto.subtle.importKey('spki', pemToBytes(env.LICENCE_PUBLIC_KEY), { name: 'Ed25519' }, false, ['verify'])
  };
  return KEYS;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
    if (request.method === 'GET' && url.pathname === '/') return new Response(JSON.stringify({ service: 'SknEDU-studio licences', ok: true }), { headers: cors });
    const k = await keys(env);
    const service = createService({
      store: { get: async (key) => env.LICENCES.get(key, 'json'), put: async (key, v) => env.LICENCES.put(key, JSON.stringify(v)) },
      now: () => Date.now(),
      verifyLicence: async (data, sig) => { try { return await crypto.subtle.verify({ name: 'Ed25519' }, k.pub, fromB64u(sig), enc.encode(data)); } catch { return false; } },
      sign: async (data) => b64u(await crypto.subtle.sign({ name: 'Ed25519' }, k.priv, enc.encode(data)))
    });
    let body = null; try { body = await request.json(); } catch { body = null; }
    const r = await handle(service, request.method, url.pathname, body);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: cors });
  }
};
