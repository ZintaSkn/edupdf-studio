// SknEDU-studio — service d'activation des licences : logique commune (Node pour les tests, Cloudflare Worker en ligne).
//
// Règles :
//  - une licence est émise pour une adresse e-mail et une durée (en jours) ; elle n'est active que sur UN poste à la fois ;
//  - désactivée sur un poste, elle peut être activée sur un autre pour ses jours restants ;
//  - au plus DEUX licences actives ensemble sur un poste : leurs jours s'additionnent (la première est consommée,
//    puis la seconde) ;
//  - le temps est décompté en jours calendaires tant que la licence est active sur un poste, même hors connexion.
//
// Dépendances injectées : store { get(k) → objet|null, put(k, objet) }, now() → ms,
// verifyLicence(data, sig) → bool (clé publique de l'éditeur), sign(data) → signature base64url (clé du service).
'use strict';

const DAY = 86400000;
const MAX_LICENCES = 2;
const REFRESH_DAYS = 14; // sans nouvelle vérification en ligne, le jeton cesse d'être valable après 14 jours
const RANK = { enseignant: 1, etablissement: 2 };

class LicError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status || 400; } }

const b64 = { enc: (s) => Buffer.from(s, 'utf8').toString('base64url'), dec: (s) => Buffer.from(s, 'base64url').toString('utf8') };
const normEmail = (e) => String(e || '').trim().toLowerCase();
const okMachine = (m) => /^[0-9a-f]{32}$/.test(String(m || ''));

function createService({ store, now, verifyLicence, sign }) {
  async function parseKey(key) {
    const m = /SKN1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/.exec(String(key || ''));
    if (!m || !(await verifyLicence(m[1], m[2]))) throw new LicError('INVALID', 'Clé de licence invalide.');
    let lic; try { lic = JSON.parse(b64.dec(m[1])); } catch { throw new LicError('INVALID', 'Clé de licence endommagée.'); }
    if (lic.v !== 2 || !RANK[lic.edition] || !(lic.days > 0) || !lic.ref || !lic.email) throw new LicError('INVALID', 'Cette clé n\'est pas une licence à activer en ligne.');
    return lic;
  }
  const remaining = (l) => Math.max(0, l.days * DAY - (l.usedMs || 0));
  /** Décompte le temps écoulé depuis la dernière opération : licences consommées l'une après l'autre. */
  async function settle(pc, t, pcKey) {
    let elapsed = Math.max(0, t - (pc.since || t)); const keep = [];
    for (const ref of pc.refs) {
      const l = await store.get('lic:' + ref); if (!l) continue;
      const take = Math.min(elapsed, remaining(l)); l.usedMs = (l.usedMs || 0) + take; elapsed -= take;
      if (remaining(l) > 0) keep.push(ref); else l.machine = null; // licence épuisée : libérée
      await store.put('lic:' + ref, l);
    }
    pc.refs = keep; pc.since = t;
    await store.put(pcKey, pc); // enregistré tout de suite : le temps n'est jamais décompté deux fois
  }
  async function loadPc(email, machine) { return (await store.get(`pc:${email}:${machine}`)) || { refs: [], since: now() }; }
  async function token(email, machine, pc, t) {
    const lics = []; for (const ref of pc.refs) { const l = await store.get('lic:' + ref); if (l) lics.push(l); }
    const total = lics.reduce((s, l) => s + remaining(l), 0);
    const best = lics.reduce((a, l) => (RANK[l.edition] > RANK[(a || {}).edition] ? l : a || l), null);
    const payload = { v: 1, email, machine, edition: best ? best.edition : null, org: best ? best.org || '' : '', end: t + total, issued: t, refreshBy: t + REFRESH_DAYS * DAY,
      licences: lics.map((l) => ({ ref: l.ref, edition: l.edition, org: l.org || '', days: l.days, remainingDays: Math.ceil(remaining(l) / DAY) })) };
    const data = b64.enc(JSON.stringify(payload));
    return { token: `SKNT.${data}.${await sign(data)}`, ...payload };
  }
  const check = (email, machine) => {
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw new LicError('EMAIL', 'Adresse e-mail invalide.');
    if (!okMachine(machine)) throw new LicError('MACHINE', 'Identifiant de poste invalide.');
  };

  return {
    /** Active une licence sur ce poste (refusée si elle est active ailleurs, épuisée, ou si 2 licences sont déjà actives). */
    async activate({ key, email, machine }) {
      email = normEmail(email); check(email, machine);
      const lic = await parseKey(key);
      if (normEmail(lic.email) !== email) throw new LicError('EMAIL_MISMATCH', `Cette licence est au nom de ${lic.email}.`, 403);
      const t = now();
      let l = await store.get('lic:' + lic.ref);
      if (!l) l = { ref: lic.ref, email: normEmail(lic.email), edition: lic.edition, org: lic.org || '', days: lic.days, usedMs: 0, machine: null, firstActivation: t };
      if (l.revoked) throw new LicError('REVOKED', 'Cette licence a été révoquée par l\'éditeur.', 403);
      const pc = await loadPc(email, machine); await settle(pc, t, `pc:${email}:${machine}`);
      l = await store.get('lic:' + lic.ref) || l; // relu après le décompte
      if (pc.refs.includes(l.ref)) { await store.put(`pc:${email}:${machine}`, pc); return token(email, machine, pc, t); } // déjà active ici
      if (l.machine && l.machine !== machine) throw new LicError('ACTIVE_ELSEWHERE', 'Cette licence est déjà active sur un autre poste : désactivez-la d\'abord sur ce poste (Aide › Licence et édition).', 409);
      if (remaining(l) <= 0) throw new LicError('EXPIRED', 'Cette licence n\'a plus de jours restants.', 410);
      if (pc.refs.length >= MAX_LICENCES) throw new LicError('MAX', `Au plus ${MAX_LICENCES} licences peuvent être actives ensemble sur un poste.`, 409);
      l.machine = machine; pc.refs.push(l.ref);
      await store.put('lic:' + l.ref, l); await store.put(`pc:${email}:${machine}`, pc);
      return token(email, machine, pc, t);
    },
    /** Libère une licence de ce poste : elle garde ses jours restants et peut être activée ailleurs. */
    async deactivate({ ref, email, machine }) {
      email = normEmail(email); check(email, machine);
      const t = now(); const pc = await loadPc(email, machine); await settle(pc, t, `pc:${email}:${machine}`);
      const l = await store.get('lic:' + ref);
      if (!l || !pc.refs.includes(ref)) throw new LicError('NOT_ACTIVE', 'Cette licence n\'est pas active sur ce poste.', 404);
      pc.refs = pc.refs.filter((r) => r !== ref); l.machine = null;
      await store.put('lic:' + ref, l); await store.put(`pc:${email}:${machine}`, pc);
      return { remainingDays: Math.ceil(remaining(l) / DAY), ...(await token(email, machine, pc, t)) };
    },
    /** État des licences de ce poste (renouvelle le jeton). */
    async status({ email, machine }) {
      email = normEmail(email); check(email, machine);
      const t = now(); const pc = await loadPc(email, machine); await settle(pc, t, `pc:${email}:${machine}`);
      await store.put(`pc:${email}:${machine}`, pc);
      return token(email, machine, pc, t);
    }
  };
}

/** Requête HTTP → service (commun au serveur de test Node et au Worker). */
async function handle(service, method, pathname, body) {
  try {
    if (method !== 'POST') throw new LicError('METHOD', 'Méthode non autorisée.', 405);
    const route = { '/v1/activate': 'activate', '/v1/deactivate': 'deactivate', '/v1/status': 'status' }[pathname];
    if (!route) throw new LicError('NOT_FOUND', 'Adresse inconnue.', 404);
    return { status: 200, body: { ok: true, ...(await service[route](body || {})) } };
  } catch (e) {
    return { status: e.status || 500, body: { ok: false, code: e.code || 'ERROR', error: e instanceof LicError ? e.message : 'Erreur du service d\'activation.' } };
  }
}

module.exports = { createService, handle, LicError, DAY, MAX_LICENCES, REFRESH_DAYS };
