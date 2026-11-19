// SknEDU-studio — chiffrement de bout en bout (classe connectée à distance, épreuve en ligne).
// Le service de l'éditeur ne transporte et ne garde que des messages chiffrés : il ne peut ni les lire ni les modifier
// sans que cela se voie.
'use strict';
const crypto = require('crypto');

/** AES-256-GCM : [IV 12 octets][chiffré][sceau 16 octets]. « aad » lie le message à son usage (salle, épreuve, morceau). */
function seal(key, aad, plain) {
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(aad, 'utf8'));
  return Buffer.concat([iv, c.update(plain), c.final(), c.getAuthTag()]);
}
function unseal(key, aad, msg) {
  if (!msg || msg.length < 29) throw new Error('message invalide');
  const d = crypto.createDecipheriv('aes-256-gcm', key, msg.subarray(0, 12)); d.setAAD(Buffer.from(aad, 'utf8')); d.setAuthTag(msg.subarray(msg.length - 16));
  return Buffer.concat([d.update(msg.subarray(12, msg.length - 16)), d.final()]);
}
/** Message = [4 octets : longueur de l'en-tête][en-tête JSON][données]. */
const frame = (head, body) => { const h = Buffer.from(JSON.stringify(head), 'utf8'); const n = Buffer.alloc(4); n.writeUInt32BE(h.length); return Buffer.concat([n, h, body || Buffer.alloc(0)]); };
function unframe(buf) {
  if (!buf || buf.length < 4) throw new Error('message invalide');
  const n = buf.readUInt32BE(0); if (n > buf.length - 4 || n > 2 * 1048576) throw new Error('message invalide');
  return { head: JSON.parse(buf.subarray(4, 4 + n).toString('utf8')), body: buf.subarray(4 + n) };
}

// ---------- Copies d'épreuve : chiffrées pour l'enseignant seul ----------
// L'élève tire une clé éphémère P-256, en déduit un secret partagé avec la clé publique de l'enseignant (ECDH), puis
// une clé AES-256-GCM (SHA-256). Les autres élèves, qui ont pourtant le lien, ne peuvent pas lire les copies.
// Enveloppe = [1][clé publique éphémère, 65 octets][IV 12][chiffré][sceau 16].
const COPY_LABEL = Buffer.from('sknedu-copie-v1', 'utf8');
function teacherKeys() { const e = crypto.createECDH('prime256v1'); e.generateKeys(); return { pub: e.getPublicKey(), priv: e.getPrivateKey() }; }
const copyKey = (shared, eph) => crypto.createHash('sha256').update(Buffer.concat([COPY_LABEL, shared, eph])).digest();
function openCopy(priv, aad, env) {
  if (!env || env.length < 1 + 65 + 29 || env[0] !== 1) throw new Error('copie invalide');
  const eph = env.subarray(1, 66); const e = crypto.createECDH('prime256v1'); e.setPrivateKey(priv);
  return unseal(copyKey(e.computeSecret(eph), eph), aad, env.subarray(66)); // computeSecret refuse un point invalide
}
/** Côté élève (le navigateur fait la même chose avec WebCrypto) : utilisé par les tests. */
function sealCopy(pub, aad, plain) {
  const e = crypto.createECDH('prime256v1'); e.generateKeys(); const eph = e.getPublicKey();
  return Buffer.concat([Buffer.from([1]), eph, seal(copyKey(e.computeSecret(pub), eph), aad, plain)]);
}

module.exports = { seal, unseal, frame, unframe, teacherKeys, openCopy, sealCopy };
