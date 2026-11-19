// SknEDU-studio — copies d'élèves : réponses et fichiers reçus → PDF figé et verrouillé.
// Commun à la classe connectée (réseau de la classe et lien à distance) et à l'épreuve en ligne.
// Tout ce qui vient d'un élève est vérifié ici : type réel des fichiers, nom, réponses (placement, longueur, zones existantes).
'use strict';
const mu = require('./mu');

class UserError extends Error {}
let chain = Promise.resolve();
/** Une seule copie traitée à la fois : le moteur PDF travaille dans le processus principal. */
function queued(fn) { const p = chain.then(fn); chain = p.catch(() => {}); return p; }

const MAX_FILES = 20; const MAX_NOTES = 400; const MAX_TEXT = 60000;
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const cleanStudent = (s) => String(s || '').replace(/[^\p{L}\p{N} '\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 80);

const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
/** Type réel du fichier, d'après son contenu (jamais d'après son nom). */
function kindOf(d) {
  if (!d || d.length < 12) return null;
  d = Buffer.from(d.buffer, d.byteOffset, d.byteLength);
  if (d.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (d[0] === 0xFF && d[1] === 0xD8 && d[2] === 0xFF) return 'jpg';
  if (d.subarray(0, 8).equals(PNG)) return 'png';
  if (d.subarray(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|hevc|mif1|msf1|heif)$/.test(d.subarray(8, 12).toString('latin1'))) return 'heic';
  if (d[0] === 0x50 && d[1] === 0x4B) return 'office';
  return null;
}
async function flatten(d, opt) {
  const k = kindOf(d); const photo = k === 'jpg' || k === 'png' || k === 'heic';
  if (k === 'pdf') return mu.flattenToPdf(d, 'application/pdf');
  if (photo && !opt.photos) throw new UserError('Cette épreuve n\'accepte que des fichiers PDF : enregistrez votre copie en PDF, puis envoyez-la.');
  if (k === 'jpg' || k === 'png') return mu.flattenToPdf(d, 'photo.' + k);
  if (k === 'heic') { if (!opt.heic) throw new UserError('Photo HEIC non prise en charge : envoyez-la en JPEG.'); return mu.flattenToPdf(await opt.heic(Buffer.from(d)), 'photo.jpg'); }
  if (k === 'office') throw new UserError('Un document Word ne peut pas être rendu tel quel : enregistrez-le en PDF (Fichier › Enregistrer sous › PDF), puis envoyez le PDF.');
  throw new UserError(opt.photos ? 'Choisissez un fichier PDF ou une photo de votre copie.' : 'Choisissez un fichier PDF.');
}

/** Texte libre écrit sur les pages : { p, x, y, w, h, fs, text } en fractions de page, vérifiés. */
function cleanNotes(items, nPages) {
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : NaN); let total = 0;
  return (Array.isArray(items) ? items : []).slice(0, MAX_NOTES).map((t) => ({ p: Math.floor(num(t && t.p)), x: num(t && t.x), y: num(t && t.y), w: num(t && t.w), h: num(t && t.h), fs: num(t && t.fs),
    text: String((t && t.text) || '').replace(CTRL, '').replace(/\r\n?/g, '\n').slice(0, 2000).trim() }))
    .filter((t) => t.text && t.p >= 0 && t.p < nPages && t.x >= 0 && t.x <= 1 && t.y >= 0 && t.y <= 1 && t.w > 0 && t.w <= 1 && t.h > 0 && t.h <= 1 && t.fs >= 0.006 && t.fs <= 0.08 && (total += t.text.length) <= MAX_TEXT);
}
/** Réponses aux zones du PDF ({ k: valeur }), vérifiées d'après la liste des zones de l'épreuve (mu.formFields). */
function cleanAnswers(raw, fields) {
  const out = {}; let total = 0; const radio = new Set();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(fields)) return out;
  for (const [key, v] of Object.entries(raw).slice(0, 600)) {
    const k = Number(key); const f = Number.isInteger(k) ? fields[k] : null; if (!f || f.k !== k) continue;
    if (f.t === 'text') {
      if (typeof v !== 'string') continue;
      let s = v.replace(CTRL, '').replace(/\r\n?/g, '\n'); if (!f.ml) s = s.replace(/\n/g, ' ');
      s = s.slice(0, f.max > 0 ? f.max : 5000); if (!s.trim() || (total += s.length) > MAX_TEXT) continue;
      out[k] = s;
    } else if (f.t === 'checkbox') { if (typeof v === 'boolean') out[k] = v; }
    else if (f.t === 'radio') { if (v === true && !radio.has(f.g)) { radio.add(f.g); out[k] = true; } } // un seul choix par groupe
    else if (f.t === 'choice') { if (typeof v === 'string' && (f.o || []).includes(v)) out[k] = v; }
  }
  return out;
}
/** Fichiers d'une copie (PDF, photos) : découpe d'un envoi [méta][données mises bout à bout]. */
function splitFiles(meta, body) {
  const files = []; let off = 0;
  for (const f of (Array.isArray(meta) ? meta : []).slice(0, MAX_FILES)) {
    const n = Math.floor(Number(f && f.size)); if (!(n > 0) || off + n > body.length) break;
    files.push({ filename: String((f && f.name) || '').slice(0, 200), data: body.subarray(off, off + n) }); off += n;
  }
  return files;
}
/**
 * Copie verrouillée : soit les réponses écrites en ligne (texte libre et zones du PDF) fondues dans l'épreuve « base »,
 * soit les fichiers envoyés (PDF, photos si permises) réunis en un seul PDF. Toujours figée puis verrouillée.
 */
async function lockedCopy({ base, files, notes, answers, photos = true, heic }) {
  const flats = [];
  if (files) {
    for (const f of files) {
      try { flats.push(await flatten(f.data, { photos, heic })); }
      catch (e) { if (e instanceof UserError) throw e; throw new UserError('Fichier illisible ou protégé par un mot de passe : vérifiez-le, puis envoyez-le à nouveau.'); }
    }
  } else flats.push(await mu.flattenToPdf(base, 'application/pdf', notes || [], answers && Object.keys(answers).length ? answers : null));
  if (!flats.length) throw new UserError('Copie vide.');
  let pdf = flats[0];
  if (flats.length > 1) {
    const { PDFDocument } = require('pdf-lib'); const out = await PDFDocument.create();
    for (const b of flats) { const d = await PDFDocument.load(b); (await out.copyPages(d, d.getPageIndices())).forEach((p) => out.addPage(p)); }
    pdf = await out.save();
  }
  return Buffer.from(await mu.sealPdf(pdf));
}

module.exports = { UserError, queued, kindOf, cleanStudent, cleanNotes, cleanAnswers, splitFiles, lockedCopy, MAX_FILES };
