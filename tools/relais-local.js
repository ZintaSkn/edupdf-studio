// SknEDU-studio — service en ligne en version locale (Node) pour les essais et l'auto-test : relais de la classe connectée
// et épreuve en ligne. Même logique que le service en ligne (server/relay-core.js, server/exam-core.js) et mêmes pages élève
// (src/student-page.js) ; le stockage est en mémoire.
//   node tools/relais-local.js [port]     → http://localhost:<port>
'use strict';
const http = require('http');
const crypto = require('crypto');
const { createRoom, handleRoom, LIMITS, ROOM_RE } = require('../server/relay-core');
const EX = require('../server/exam-core');
const { remoteShell, examShell } = require('../src/student-page');

const TIMERS = { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t) };
const sha256hex = async (t) => crypto.createHash('sha256').update(t).digest('hex');
const rnd = (n) => crypto.randomBytes(n).toString('base64url');
const SHELL_CSP = "default-src 'none'; img-src 'self' blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
function memStore() {
  const m = new Map(); const s = { m, alarm: null,
    get: async (k) => (m.has(k) ? m.get(k) : undefined), put: async (k, v) => { m.set(k, v); },
    delete: async (k) => { for (const x of [].concat(k)) m.delete(x); }, deleteAll: async () => { m.clear(); }, setAlarm: async (t) => { s.alarm = t; } };
  return s;
}

function start(port = 0, host = '127.0.0.1') {
  const rooms = new Map(); // salle → { room, meta }
  const exams = new Map(); // épreuve → { st, allowCopy }
  let used = 0; const quota = async (d) => { if (d > 0 && used + d > 3 * 1024 ** 3) return false; used = Math.max(0, used + d); return true; };
  const readBody = (req, limit) => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('trop gros')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks)))); req.on('error', reject);
  });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'); const send = (status, body, headers = {}) => { res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }); res.end(body || undefined); };
    const json = (status, o) => send(status, JSON.stringify(o), { 'Content-Type': 'application/json; charset=utf-8' });
    const header = (n) => req.headers[n.toLowerCase()] || '';
    try {
      // ---------- épreuve en ligne ----------
      if (req.method === 'POST' && url.pathname === '/e/new') {
        let b = null; try { b = JSON.parse(Buffer.from(await readBody(req, 1024)).toString('utf8')); } catch { b = null; }
        const p = b ? EX.plan(Date.now(), b.deadline) : null; if (!p) return json(400, { ok: false, code: 'DEADLINE' });
        const id = rnd(16); const hostKey = rnd(32); const st = memStore(); await st.put('meta', EX.newMeta(await sha256hex(hostKey), p, Date.now())); await st.setAlarm(p.contentUntil);
        exams.set(id, { st, allowCopy: EX.copyLimiter(Date.now) });
        return json(200, { ok: true, id, hostKey, deadline: p.deadline, contentUntil: p.contentUntil, keepUntil: p.keepUntil, limits: { blob: EX.LIMITS.blob, copy: EX.LIMITS.copy } });
      }
      let m = /^\/e\/([^/]+)(\/.*)?$/.exec(url.pathname);
      if (m) {
        if (!EX.ID_RE.test(m[1])) return send(404);
        if (req.method === 'GET' && !m[2]) return send(200, examShell(), { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': SHELL_CSP, 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
        const e = exams.get(m[1]); if (!e) return send(404);
        const ctx = { st: e.st, now: Date.now, quota, allowCopy: e.allowCopy };
        if (e.st.alarm && Date.now() >= e.st.alarm) await EX.examAlarm(ctx); // réveils programmés, vérifiés à chaque demande
        const r = await EX.handleExam(ctx, { method: req.method, sub: m[2] || '', ip: req.socket.remoteAddress, header, body: () => readBody(req, 64 * 1048576), hash: sha256hex });
        if (r.end) exams.delete(m[1]);
        if (r.json) return json(r.status, r.json);
        return send(r.status, r.body ? Buffer.from(r.body) : null, { ...(r.body ? { 'Content-Type': 'application/octet-stream' } : {}), ...(r.cache ? { 'Cache-Control': 'private, max-age=86400, immutable' } : {}) });
      }
      // ---------- relais de la classe connectée ----------
      if (req.method === 'POST' && url.pathname === '/r/new') {
        const id = rnd(16); const hostKey = rnd(32); const expires = Date.now() + LIMITS.ttlMs;
        rooms.set(id, { room: createRoom(TIMERS), meta: { hostHash: await sha256hex(hostKey), expires } });
        return json(200, { ok: true, room: id, hostKey, expires, maxBody: LIMITS.body });
      }
      m = /^\/r\/([^/]+)(\/.*)?$/.exec(url.pathname);
      if (!m || !ROOM_RE.test(m[1])) return send(404);
      if (req.method === 'GET' && !m[2]) return send(200, remoteShell(), { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': SHELL_CSP, 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
      const e = rooms.get(m[1]); if (!e) return send(404);
      const r = await handleRoom(e.room, e.meta, { method: req.method, sub: m[2] || '', header, body: () => readBody(req, LIMITS.body), hash: sha256hex }, TIMERS.now);
      if (r.end) { e.room.close(); rooms.delete(m[1]); }
      send(r.status, r.body ? Buffer.from(r.body) : null, { ...(r.body ? { 'Content-Type': 'application/octet-stream' } : {}), ...(r.headers || {}) });
    } catch { try { send(413); } catch { /* connexion déjà fermée */ } }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve({ url: `http://localhost:${server.address().port}`, rooms, exams, quotaUsed: () => used,
      close: () => new Promise((r) => { for (const e of rooms.values()) e.room.close(); rooms.clear(); exams.clear(); if (server.closeAllConnections) server.closeAllConnections(); server.close(() => r()); }) }));
  });
}

module.exports = { start };
if (require.main === module) start(Number(process.argv[2]) || 8787).then((s) => console.log('Service local : ' + s.url));
