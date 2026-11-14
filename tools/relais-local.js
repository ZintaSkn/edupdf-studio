// SknEDU-studio — relais de la classe connectée, version locale (Node) pour les essais et l'auto-test.
// Même logique que le service en ligne (server/relay-core.js) et même page élève (src/student-page.js).
//   node tools/relais-local.js [port]     → http://localhost:<port>
'use strict';
const http = require('http');
const crypto = require('crypto');
const { createRoom, handleRoom, LIMITS, ROOM_RE } = require('../server/relay-core');
const { remoteShell } = require('../src/student-page');

const TIMERS = { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t) };
const sha256hex = async (t) => crypto.createHash('sha256').update(t).digest('hex');
const rnd = (n) => crypto.randomBytes(n).toString('base64url');
const SHELL_CSP = "default-src 'none'; img-src 'self' blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function start(port = 0, host = '127.0.0.1') {
  const rooms = new Map(); // salle → { room, meta }
  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > LIMITS.body) { reject(new Error('trop gros')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks)))); req.on('error', reject);
  });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'); const send = (status, body, headers = {}) => { res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }); res.end(body || undefined); };
    try {
      if (req.method === 'POST' && url.pathname === '/r/new') {
        const id = rnd(16); const hostKey = rnd(32); const expires = Date.now() + LIMITS.ttlMs;
        rooms.set(id, { room: createRoom(TIMERS), meta: { hostHash: await sha256hex(hostKey), expires } });
        return send(200, JSON.stringify({ ok: true, room: id, hostKey, expires, maxBody: LIMITS.body }), { 'Content-Type': 'application/json; charset=utf-8' });
      }
      const m = /^\/r\/([^/]+)(\/.*)?$/.exec(url.pathname);
      if (!m || !ROOM_RE.test(m[1])) return send(404);
      if (req.method === 'GET' && !m[2]) return send(200, remoteShell(), { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': SHELL_CSP, 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
      const e = rooms.get(m[1]); if (!e) return send(404);
      const r = await handleRoom(e.room, e.meta, { method: req.method, sub: m[2] || '', header: (n) => req.headers[n.toLowerCase()] || '', body: () => readBody(req), hash: sha256hex }, TIMERS.now);
      if (r.end) { e.room.close(); rooms.delete(m[1]); }
      send(r.status, r.body ? Buffer.from(r.body) : null, { ...(r.body ? { 'Content-Type': 'application/octet-stream' } : {}), ...(r.headers || {}) });
    } catch { try { send(413); } catch { /* connexion déjà fermée */ } }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve({ url: `http://localhost:${server.address().port}`, rooms,
      close: () => new Promise((r) => { for (const e of rooms.values()) e.room.close(); rooms.clear(); if (server.closeAllConnections) server.closeAllConnections(); server.close(() => r()); }) }));
  });
}

module.exports = { start };
if (require.main === module) start(Number(process.argv[2]) || 8787).then((s) => console.log('Relais local : ' + s.url));
