// Cloudflare Pages Function — vidéos du site servies par morceaux (requêtes HTTP « Range »).
// Les fichiers statiques de Pages ignorent « Range » (réponse 200 complète) ; Safari et iPhone exigent une réponse 206
// pour lire une vidéo. Cette fonction ne s'applique qu'aux adresses /video/* (le reste du site reste statique).
// Déploiement : depuis D:\EduPDF\tools\pages-functions (voir docs du site) — wrangler y trouve le dossier functions/.
const HEADERS = { 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=604800', 'X-Content-Type-Options': 'nosniff', 'Strict-Transport-Security': 'max-age=31536000' };

async function serve({ request, env }, head) {
  const asset = await env.ASSETS.fetch(new Request(new URL(request.url).toString(), { headers: { 'accept-encoding': 'identity' } }));
  if (!asset.ok) return asset;
  const buf = await asset.arrayBuffer(); const size = buf.byteLength;
  const h = { ...HEADERS, 'Content-Type': asset.headers.get('content-type') || 'video/mp4' };
  const m = /^bytes=(\d*)-(\d*)$/.exec((request.headers.get('range') || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return new Response(head ? null : buf, { status: 200, headers: { ...h, 'Content-Length': String(size) } });
  let a, b;
  if (m[1] === '') { a = Math.max(0, size - Number(m[2])); b = size - 1; } // derniers octets
  else { a = Number(m[1]); b = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (!(a >= 0) || a > b || a >= size) return new Response(null, { status: 416, headers: { ...h, 'Content-Range': `bytes */${size}` } });
  return new Response(head ? null : buf.slice(a, b + 1), { status: 206, headers: { ...h, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': String(b - a + 1) } });
}
export const onRequestGet = (ctx) => serve(ctx, false);
export const onRequestHead = (ctx) => serve(ctx, true);
