// SknEDU-studio — épreuve en ligne : logique commune (Node pour les tests, Cloudflare Worker en ligne).
//
// Une épreuve est une boîte de dépôt chiffrée, ouverte jusqu'à une date limite, même ordinateur de l'enseignant éteint :
//   enseignant → PUT    /e/<id>/b/<morceau>   dépose l'épreuve en morceaux chiffrés (avant ouverture seulement) ;
//   enseignant → POST   /e/<id>/open          ouvre l'épreuve aux élèves (elle ne peut plus être modifiée) ;
//   élève      → GET    /e/<id>/s             état : ouverte, terminée, date limite ;
//   élève      → GET    /e/<id>/b/<morceau>   lit un morceau chiffré ;
//   élève      → POST   /e/<id>/c             dépose sa copie, chiffrée pour l'enseignant seul ;
//   enseignant → GET    /e/<id>/c             liste les copies en attente ; GET /e/<id>/c/<n°> lit une copie ;
//   enseignant → DELETE /e/<id>/c/<n°>        supprime une copie relevée ; DELETE /e/<id> supprime l'épreuve.
// Le service ne peut RIEN lire : l'épreuve est chiffrée avec la clé du lien (après « # », jamais transmise au service) et
// chaque copie avec la clé publique de l'enseignant. Il ne voit que des tailles et des horaires. Le contenu de l'épreuve
// est effacé un jour après la date limite ; les copies non relevées, 30 jours après.
'use strict';

const MB = 1048576; const DAY = 86400000;
const LIMITS = {
  blob: 4.5 * MB,            // un morceau de l'épreuve
  packageBytes: 72 * MB,     // épreuve complète : PDF, Word, images des pages
  copy: 26 * MB,             // une copie (25 Mo de fichiers + enveloppe)
  pendingBytes: 512 * MB,    // copies en attente de relève
  pendingCount: 600,
  copiesTotal: 2000,         // copies reçues au total par une épreuve
  chunk: 4 * MB,             // morceau de stockage
  minLeadMs: 10 * 60000,     // date limite : au moins 10 minutes après la création
  maxDays: 31,               // et au plus 31 jours
  contentDays: 1,            // contenu de l'épreuve effacé 1 jour après la date limite
  keepDays: 30,              // copies non relevées effacées 30 jours après la date limite
  graceMs: 2 * 60000,        // envoi commencé juste avant la date limite
  perIpCopiesPerHour: 150    // une classe entière sort souvent par une seule adresse
};
const ID_RE = /^[A-Za-z0-9_-]{22}$/; const CID_RE = /^[0-9a-f]{32}$/; const BLOB_RE = /^(info|pdf\.\d{1,2}|docx\.\d{1,2}|p\d{1,2})$/;

/** Dates de vie d'une épreuve créée maintenant avec cette date limite ; null si la date est refusée. */
function plan(now, deadline) {
  const d = Math.floor(Number(deadline));
  if (!Number.isFinite(d) || d < now + LIMITS.minLeadMs || d > now + LIMITS.maxDays * DAY) return null;
  return { deadline: d, contentUntil: d + LIMITS.contentDays * DAY, keepUntil: d + LIMITS.keepDays * DAY };
}
const newMeta = (hostHash, p, now) => ({ v: 1, hostHash, created: now, deadline: p.deadline, contentUntil: p.contentUntil, keepUntil: p.keepUntil,
  open: false, blobs: {}, pkg: 0, pending: {}, pendingBytes: 0, received: 0 });

function concat(parts) { let n = 0; for (const p of parts) n += p.length; const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
async function putChunks(st, prefix, data) {
  const n = Math.max(1, Math.ceil(data.length / LIMITS.chunk));
  for (let i = 0; i < n; i++) await st.put(prefix + i, data.slice(i * LIMITS.chunk, (i + 1) * LIMITS.chunk)); // slice : copie autonome, jamais toute la mémoire tampon
  return n;
}
async function getChunks(st, prefix, n) {
  const parts = [];
  for (let i = 0; i < n; i++) { const v = await st.get(prefix + i); if (!v) return null; parts.push(v instanceof Uint8Array ? v : new Uint8Array(v)); }
  return concat(parts);
}
async function delChunks(st, prefix, n) {
  const keys = []; for (let i = 0; i < n; i++) keys.push(prefix + i);
  for (let i = 0; i < keys.length; i += 128) await st.delete(keys.slice(i, i + 128));
}

/**
 * Traite une demande adressée à une épreuve.
 * ctx : { st (stockage : get, put, delete, deleteAll, setAlarm), now(), quota(delta) → Promise<bool>, allowCopy(ip) → bool }.
 * req : { method, sub ('/s', '/b/info', '/c', …), header(nom), body() → Promise<Uint8Array>, hash(texte) → Promise<hex>, ip }.
 * Rend { status, json?, body?, cache?, end? }.
 */
async function handleExam(ctx, req) {
  const { st } = ctx; const t = ctx.now();
  const meta = await st.get('meta'); if (!meta) return { status: 404 };
  const isHost = async () => { const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.header('authorization') || ''); return !!m && (await req.hash(m[1])) === meta.hostHash; };
  const save = () => st.put('meta', meta);
  const ended = t > meta.deadline + LIMITS.graceMs; const { method, sub } = req; let m;

  if (method === 'GET' && sub === '/s') return { status: 200, json: { open: meta.open, closed: ended, deadline: meta.deadline } };

  if ((m = /^\/b\/([a-z0-9.]{1,8})$/.exec(sub)) && BLOB_RE.test(m[1])) {
    const name = m[1]; const b = meta.blobs[name];
    if (method === 'GET') {
      if (!meta.open && !(await isHost())) return { status: 404 };
      if (!b) return { status: t >= meta.contentUntil ? 410 : 404 };
      const data = await getChunks(st, 'b:' + name + ':', b.n); return data ? { status: 200, body: data, cache: meta.open } : { status: 404 };
    }
    if (method === 'PUT') {
      if (!(await isHost())) return { status: 401 };
      if (meta.open) return { status: 409 }; // ouverte : l'épreuve ne change plus (les élèves voient tous le même sujet)
      if (ended) return { status: 410 };
      if (Number(req.header('content-length') || 0) > LIMITS.blob) return { status: 413 };
      const data = await req.body(); if (!data.length) return { status: 400 }; if (data.length > LIMITS.blob) return { status: 413 };
      const old = b ? b.size : 0; if (meta.pkg - old + data.length > LIMITS.packageBytes) return { status: 413 };
      if (!(await ctx.quota(data.length))) return { status: 507 };
      if (b) await delChunks(st, 'b:' + name + ':', b.n);
      meta.blobs[name] = { n: await putChunks(st, 'b:' + name + ':', data), size: data.length }; meta.pkg += data.length - old;
      await save(); if (old) await ctx.quota(-old);
      return { status: 204 };
    }
    return { status: 405 };
  }

  if (sub === '/open' && method === 'POST') {
    if (!(await isHost())) return { status: 401 };
    if (ended) return { status: 410 }; if (!meta.blobs.info) return { status: 409 };
    meta.open = true; await save(); return { status: 204 };
  }

  if (sub === '/c' && method === 'POST') { // dépôt d'une copie par un élève (chiffrée : le service ne peut pas la vérifier)
    if (!meta.open) return { status: 404 }; if (ended) return { status: 410 };
    const cid = String(req.header('x-id') || ''); if (!CID_RE.test(cid)) return { status: 400 };
    if (meta.pending[cid] || (await st.get('vu:' + cid))) return { status: 409 };
    if (!ctx.allowCopy(req.ip || '?')) return { status: 429 };
    if (meta.received >= LIMITS.copiesTotal || Object.keys(meta.pending).length >= LIMITS.pendingCount) return { status: 507 };
    if (Number(req.header('content-length') || 0) > LIMITS.copy) return { status: 413 };
    const data = await req.body(); if (data.length < 100) return { status: 400 }; if (data.length > LIMITS.copy) return { status: 413 };
    if (meta.pendingBytes + data.length > LIMITS.pendingBytes) return { status: 507 };
    if (!(await ctx.quota(data.length))) return { status: 507 };
    meta.pending[cid] = { n: await putChunks(st, 'c:' + cid + ':', data), size: data.length, at: t };
    meta.pendingBytes += data.length; meta.received++; await st.put('vu:' + cid, 1); await save();
    return { status: 200, json: { ok: true, at: t } };
  }
  if (sub === '/c' && method === 'GET') {
    if (!(await isHost())) return { status: 401 };
    const copies = Object.entries(meta.pending).map(([id, c]) => ({ id, size: c.size, at: c.at })).sort((a, b) => a.at - b.at);
    return { status: 200, json: { ok: true, copies, received: meta.received, deadline: meta.deadline, closed: ended } };
  }
  if ((m = /^\/c\/([0-9a-f]{32})$/.exec(sub))) {
    if (!(await isHost())) return { status: 401 };
    const c = meta.pending[m[1]]; if (!c) return { status: 404 };
    if (method === 'GET') { const data = await getChunks(st, 'c:' + m[1] + ':', c.n); return data ? { status: 200, body: data } : { status: 404 }; }
    if (method === 'DELETE') {
      await delChunks(st, 'c:' + m[1] + ':', c.n); delete meta.pending[m[1]]; meta.pendingBytes = Math.max(0, meta.pendingBytes - c.size);
      await save(); await ctx.quota(-c.size); return { status: 204 };
    }
    return { status: 405 };
  }
  if (method === 'DELETE' && sub === '') {
    if (!(await isHost())) return { status: 401 };
    await endExam(ctx, meta); return { status: 204, end: true };
  }
  return { status: 404 };
}
async function endExam(ctx, meta) { const bytes = meta.pkg + meta.pendingBytes; await ctx.st.deleteAll(); if (bytes > 0) await ctx.quota(-bytes); }
/** Réveil programmé : contenu effacé un jour après la date limite, tout le reste 30 jours après. */
async function examAlarm(ctx) {
  const meta = await ctx.st.get('meta'); if (!meta) return;
  const t = ctx.now();
  if (t >= meta.keepUntil) return endExam(ctx, meta);
  if (t >= meta.contentUntil && meta.pkg > 0) {
    for (const [name, b] of Object.entries(meta.blobs)) await delChunks(ctx.st, 'b:' + name + ':', b.n);
    const freed = meta.pkg; meta.blobs = {}; meta.pkg = 0; await ctx.st.put('meta', meta); await ctx.quota(-freed);
  }
  await ctx.st.setAlarm(t < meta.contentUntil ? meta.contentUntil : meta.keepUntil);
}
/** Limite des dépôts par adresse et par heure (en mémoire : remise à zéro si l'épreuve est déchargée). */
function copyLimiter(now) {
  const seen = new Map();
  return (ip) => {
    const t = now(); const e = seen.get(ip) || { n: 0, since: t };
    if (t - e.since > 3600000) { e.n = 0; e.since = t; }
    e.n++; seen.set(ip, e); if (seen.size > 5000) for (const [k, v] of seen) if (t - v.since > 3600000) seen.delete(k);
    return e.n <= LIMITS.perIpCopiesPerHour;
  };
}

module.exports = { LIMITS, ID_RE, CID_RE, BLOB_RE, plan, newMeta, handleExam, examAlarm, copyLimiter };
