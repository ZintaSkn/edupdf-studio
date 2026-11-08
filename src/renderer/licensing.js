// SknEDU-studio — compte obligatoire, essai de 30 jours et fonctions Premium (interface).
// Le contrôle principal est fait côté système (src/license.js) ; ici : création du compte, affichage de l'état,
// fenêtre « Premium » quand une fonction réservée est demandée, fenêtre Licence.
/* global S, $, $$, actions, msg, modal, esc, errMsg, LIC, applyLicense, licenseDialog */

// ---------------------------------------------------------------- Fonctions Premium (licence ou essai)
// Version gratuite après l'essai : ouvrir et lire tous les formats, imprimer, enregistrer en PDF, organiser les pages,
// annoter (texte ajouté, surligneur, cadres, formes, stylo, commentaires, tampons), remplir les formulaires, signer à la main,
// scanner, modèles, diaporama, version DYS et lecture à voix haute (inclusion), préférences, langue.
const PREMIUM_GROUPS = {
  edit: '✏️ Modifier le texte et les paragraphes d\'origine, rechercher et remplacer',
  ocr: '🔍 OCR : rendre les scans et les copies numérisées modifiables',
  convert: '🔄 Conversions PDF ↔ Word, Excel, PowerPoint et format d\'origine',
  ai: '✨ Assistant IA (Claude, ChatGPT, Gemini, Mistral, IA locale)',
  classe: '🎓 Outils de la classe : correction de copies, évaluations différenciées, publipostage, version bilingue, classe connectée, équations',
  protect: '🔒 Mot de passe, signature numérique par certificat, comparaison, copie commentée en lecture seule',
  pro: '🧰 Sauvegarde automatique dans le cloud, en-tête et pied de page, filigrane, réduction de taille'
};
const PREMIUM_ACTS = {
  replace: 'edit',
  ocrPage: 'ocr', ocrAll: 'ocr', editAfterOcr: 'ocr', scanCopy: 'ocr',
  toWord: 'convert', toExcel: 'convert', toPpt: 'convert', exportAs: 'convert', convertOffice: 'convert', exportOrigin: 'convert',
  aiPanel: 'ai', aiSettings: 'ai', aiSubscription: 'ai', aiLocal: 'ai',
  grading: 'classe', diffEval: 'classe', mailMerge: 'classe', bilingual: 'classe', classroom: 'classe', equation: 'classe',
  protect: 'protect', certSign: 'protect', compare: 'protect', commentLocked: 'protect',
  cloudAuto: 'pro', headerFooter: 'pro', watermark: 'pro', compress: 'pro'
};
const PREMIUM_TOOLS = { edit: 'edit', editpara: 'edit' };
const groupOf = (kind, name) => (kind === 'ai' ? 'ai' : kind === 'tool' ? PREMIUM_TOOLS[name] : PREMIUM_ACTS[name]);

/** Laisse passer une fonction Premium pendant l'essai ou avec une licence ; sinon explique comment la débloquer. */
window.premiumGate = (kind, name) => {
  const g = groupOf(kind, name); if (!g || (LIC && LIC.premium)) return true;
  upgradeDialog(g); return false;
};
async function upgradeDialog(g) {
  const L = LIC || {};
  const why = L.trial && L.trial.clockBack ? '<p class="err">La date de l\'ordinateur est antérieure à la dernière utilisation : corrigez la date et l\'heure de Windows pour retrouver votre essai.</p>'
    : L.trial && L.trial.ended ? '<p>Votre <b>essai gratuit de 30 jours est terminé</b>.</p>' : '';
  const r = await modal('⭐ Fonction Premium', `${why}<p><b>${esc(PREMIUM_GROUPS[g])}</b> fait partie des fonctions Premium, incluses dans les éditions <b>Enseignant</b> et <b>Établissement</b>.</p>
    <p>Fonctions Premium :</p><ul class="premlist">${Object.values(PREMIUM_GROUPS).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    <p class="muted">La version gratuite reste utilisable sans limite de durée : lire, annoter, organiser les pages, remplir et signer, imprimer.</p>`,
  [['Plus tard', null], ['J\'ai une licence', 'lic'], ['Obtenir une licence', 'buy', true]]);
  if (r === 'buy') purchaseDialog();
  if (r === 'lic') actions.license();
}

// ---------------------------------------------------------------- État : barre d'état et boutons marqués 🔒
function markPremium() {
  const locked = !(LIC && LIC.premium);
  $$('[data-act],[data-tool],[data-ai]').forEach((b) => {
    const g = b.dataset.ai ? 'ai' : b.dataset.tool ? PREMIUM_TOOLS[b.dataset.tool] : PREMIUM_ACTS[b.dataset.act];
    b.classList.toggle('premium', !!g); b.classList.toggle('plocked', !!g && locked);
  });
}
function editionText(L) {
  if (L.mode === 'licence') return `Édition ${L.label}${L.org ? ' — ' + L.org : ''}`;
  if (L.mode === 'essai') return `⭐ Essai Premium : ${L.trial.daysLeft} jour(s)`;
  if (L.trial && L.trial.clockBack) return '⚠️ Date de l\'ordinateur incorrecte';
  return 'Version gratuite — ⭐ Passer à Premium';
}
// remplace l'affichage de l'édition d'app.js (même nom, appelé partout)
applyLicense = async function applyLicenseFull() { // eslint-disable-line no-global-assign
  try { LIC = await window.api.licenseStatus(); } catch { return LIC; } // eslint-disable-line no-global-assign
  const tag = $('#editionTag'); tag.textContent = editionText(LIC);
  tag.classList.toggle('pro', LIC.mode === 'licence'); tag.classList.toggle('trial', LIC.mode === 'essai'); tag.classList.toggle('expired', LIC.mode === 'gratuit');
  tag.title = 'Aide › Licence et édition'; tag.setAttribute('role', 'button'); tag.tabIndex = 0;
  markPremium();
  return LIC;
};
$('#editionTag').addEventListener('click', () => actions.license());

// ---------------------------------------------------------------- Fenêtre Licence et édition
async function licenceDialogFull() {
  let L = await applyLicense();
  if (L.online) { try { L = await window.api.licenseRefresh(); await applyLicense(); } catch { /* hors connexion */ } } // état à jour si Internet
  const a = L.account || {};
  const lics = L.online ? L.licences || [] : [];
  const etat = L.mode === 'licence'
    ? `<p>✅ <b>Édition ${esc(L.label)}</b>${L.org ? ' — ' + esc(L.org) : ''}<br>${L.online ? `<b>${L.daysLeft} jour(s)</b> restant(s) au total, jusqu'au ${new Date(L.expires).toLocaleDateString('fr-FR')}` : `valable jusqu'au ${esc(L.expires)}`}${L.daysLeft <= 30 ? ' <span class="err">— pensez à la renouveler</span>' : ''}</p>`
    : L.mode === 'essai' ? `<p>⭐ <b>Essai Premium</b> : toutes les fonctions jusqu'au <b>${new Date(L.trial.end).toLocaleDateString('fr-FR')}</b> (${L.trial.daysLeft} jour(s) restant(s)).</p>`
      : `<p><b>Version gratuite</b>${L.trial && L.trial.ended ? ' : votre essai de 30 jours est terminé.' : ''}</p>`;
  const warn = L.mismatch ? `<p class="err">${esc(L.mismatch)}</p>` : L.expired && L.edition !== 'communaute' ? `<p class="err">Votre licence a expiré le ${esc(L.expires)}.</p>` : '';
  const rows = lics.map((l) => `<div class="licrow"><span>🔑 <b>${esc(l.edition === 'etablissement' ? 'Établissement' : 'Enseignant')}</b>${l.org ? ' — ' + esc(l.org) : ''} · <b>${l.remainingDays}</b> jour(s) restant(s) <span class="muted">(${esc(l.ref)})</span></span><button class="small" data-deact="${esc(l.ref)}" title="Libère la licence de ce PC : elle garde ses jours restants et peut être activée sur un autre poste.">Désactiver de ce PC</button></div>`).join('');
  const r = await modal('Licence et édition', `${etat}${warn}
    ${rows ? `<p><b>Licences actives sur ce poste</b> (au plus 2, leurs jours s'additionnent) :</p>${rows}` : ''}
    <p class="muted">Compte : <b>${esc(a.email || '—')}</b>${a.name ? ' — ' + esc(a.name) : ''} · Code de ce poste : <b id="mcode">${esc(L.machineCode || '')}</b> <button class="small" id="mcodeCopy">Copier</button></p>
    <p class="muted">Une licence est liée à votre adresse e-mail et active sur un seul ordinateur à la fois. Pour l'utiliser sur un autre poste, désactivez-la d'abord ici : elle y sera activable pour ses jours restants. Activation et désactivation demandent Internet ; ensuite, une vérification en ligne au moins tous les 14 jours.</p>
    <label class="blk">Clé de licence <textarea id="licKey" rows="3" style="width:100%;box-sizing:border-box" placeholder="SKN1.…"></textarea></label>
    <div class="row"><button class="small" id="licFile">Importer un fichier .sknlic…</button>
    <label class="ck"><input type="checkbox" id="licMachine"> Pour tous les comptes Windows de ce PC</label></div>
    ${L.support ? `<p><a href="${esc(L.support)}" target="_blank">Support prioritaire</a></p>` : ''}`,
  [...(!L.online && L.edition !== 'communaute' && L.scope === 'user' ? [['Retirer la licence', 'remove']] : []), ['Obtenir une licence', 'buy'], ['Fermer', null],
    ['Activer', () => ({ text: $('#licKey').value, scope: $('#licMachine').checked ? 'machine' : 'user' }), true]]);
  if (r === 'buy') return purchaseDialog();
  if (r === 'remove') { if (confirm('Retirer la licence de ce compte ? Les fonctions Premium ne seront plus disponibles après l\'essai.')) { await window.api.licenseRemove(); await applyLicense(); } return; }
  if (!r || !r.text.trim()) return;
  try { await window.api.licenseActivate(r.text, r.scope); await applyLicense(); alert(`Licence activée : édition ${LIC.label}${LIC.org ? ' — ' + LIC.org : ''}. Toutes les fonctions Premium sont disponibles.`); }
  catch (e) { alert(errMsg(e)); }
}
/** Désactivation d'une licence de ce poste (bouton dans la fenêtre Licence). */
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-deact]'); if (!b) return;
  if (!confirm('Désactiver cette licence sur ce PC ? Elle gardera ses jours restants et pourra être activée sur un autre poste avec la même adresse e-mail.')) return;
  try { const r = await window.api.licenseDeactivate(b.dataset.deact); const bs = [...document.querySelectorAll('#mBtns button')]; if (!$('#modal').hidden && bs.length > 1) bs[bs.length - 2].click(); await applyLicense(); msg(`Licence désactivée de ce PC : ${r.remainingDays} jour(s) restant(s), activable sur un autre poste.`); }
  catch (err) { alert(errMsg(err)); }
});
document.addEventListener('click', (e) => { if (e.target.id === 'mcodeCopy') { navigator.clipboard.writeText($('#mcode').textContent); msg('Code du poste copié.'); } });
actions.license = licenceDialogFull;

// ---------------------------------------------------------------- Commande d'une licence : WhatsApp, Mobile Money, e-mail ou page
const b64u = (str) => btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fmtPrix = (o, q, dev) => (o.prix ? `${(Number(String(o.prix).replace(/[^\d]/g, '')) * (q || 1)).toLocaleString('fr-FR')} ${dev}` : 'prix communiqué par l\'éditeur');
/** Demande de licence : texte lisible + code de commande (SKNC.…) que l'outil de l'éditeur transforme en licence. */
function buildOrder(L, o, q, nom, org) {
  const d = new Date(); const ref = `CMD-${d.toISOString().slice(0, 10).replace(/-/g, '')}-${(L.machineCode || 'XXXX').slice(0, 4)}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  const a = L.account || {}; const sv = L.sales || {};
  const data = { v: 1, ref, offre: o.id, edition: o.edition, jours: o.jours, qte: q, email: a.email, nom, org, poste: L.machineCode, date: d.toISOString().slice(0, 10) };
  const code = 'SKNC.' + b64u(JSON.stringify(data));
  const text = [`Commande SknEDU-studio — ${ref}`, `Offre : ${o.libelle}${q > 1 ? ` × ${q} postes` : ''} — ${fmtPrix(o, q, sv.devise || 'FCFA')}`,
    `Compte : ${a.email}`, `Nom : ${nom || '—'}${org ? ' — ' + org : ''}`, `Code du poste : ${L.machineCode}`, '', `Code de commande : ${code}`].join('\n');
  return { ref, code, text, data };
}
async function purchaseDialog() {
  const L = await applyLicense(); const sv = L.sales || {}; const a = L.account || {};
  const offres = sv.offres || []; if (!offres.length) return alert('Les offres ne sont pas encore configurées : contactez l\'éditeur.');
  const canaux = [sv.whatsapp && ['WhatsApp', 'wa'], sv.mobileMoney && sv.mobileMoney.length && ['Mobile Money', 'mm'], sv.email && ['E-mail', 'mail'], sv.page && ['Page de paiement', 'page']].filter(Boolean);
  const pr = modal('🛒 Obtenir une licence', `<p>Choisissez votre offre, puis le moyen de paiement. La demande est préparée avec votre adresse e-mail et le code de ce poste : après le paiement, vous recevez votre clé de licence (WhatsApp ou e-mail) à coller dans Aide › Licence et édition.</p>
    <label class="blk">Offre <select id="poOffre">${offres.map((o, i) => `<option value="${i}">${esc(o.libelle)} — ${esc(fmtPrix(o, 1, sv.devise || 'FCFA'))}</option>`).join('')}</select></label>
    <label class="blk" id="poQteRow">Nombre de postes <input type="number" id="poQte" min="1" max="500" value="1"></label>
    <label class="blk">Nom <input id="poNom" value="${esc(a.name || '')}"></label>
    <label class="blk">Établissement <input id="poOrg" value="${esc(a.org || '')}"></label>
    <p class="muted">Compte : <b>${esc(a.email || '')}</b> · Code du poste : <b>${esc(L.machineCode || '')}</b>${sv.vendeur ? ' · Éditeur : ' + esc(sv.vendeur) : ''}</p>
    <p class="muted">Une licence est valable sur un ordinateur à la fois ; deux licences au plus s'additionnent sur un même poste.</p>
    ${canaux.length ? '' : '<p class="err">Les moyens de paiement ne sont pas encore configurés : copiez la demande et envoyez-la à l\'éditeur.</p>'}`,
  [['Annuler', null], ['Copier la demande', 'copy'], ...canaux.map(([lab, id], i) => [lab, id, i === 0])].map((b) => (b[1] ? [b[0], () => ({ ch: b[1], o: offres[+$('#poOffre').value], q: Math.max(1, Math.min(500, Math.round(+$('#poQte').value || 1))), nom: $('#poNom').value.trim(), org: $('#poOrg').value.trim() }), b[2]] : b)));
  $('#poQteRow').hidden = !offres[0].parPoste; // nombre de postes : offres Établissement seulement
  const r = await pr; if (!r) return;
  const q = r.o.parPoste ? r.q : 1;
  const ord = buildOrder(L, r.o, q, r.nom, r.org);
  try { localStorage.setItem('edupdf.derniereCommande', JSON.stringify({ ref: ord.ref, offre: r.o.libelle, date: ord.data.date })); } catch { /* */ }
  window.__derniereCommande = ord;
  if (r.ch === 'copy') { await navigator.clipboard.writeText(ord.text); return msg(`Demande ${ord.ref} copiée : collez-la dans votre message à l'éditeur.`); }
  if (r.ch === 'wa') { window.api.openExternal(`https://wa.me/${sv.whatsapp}?text=${encodeURIComponent(ord.text)}`); return msg(`Demande ${ord.ref} préparée dans WhatsApp : envoyez-la, puis réglez selon les instructions reçues.`); }
  if (r.ch === 'mail') { window.api.openExternal(`mailto:${sv.email}?subject=${encodeURIComponent('Commande SknEDU-studio ' + ord.ref)}&body=${encodeURIComponent(ord.text)}`); return msg(`Demande ${ord.ref} préparée dans votre messagerie : envoyez-la.`); }
  if (r.ch === 'page') { await navigator.clipboard.writeText(ord.text); window.api.openExternal(sv.page); return msg(`Demande ${ord.ref} copiée : collez-la dans la page de paiement qui s'ouvre.`); }
  if (r.ch === 'mm') {
    const montant = fmtPrix(r.o, q, sv.devise || 'FCFA');
    const nums = sv.mobileMoney.map((x) => `<div class="licrow"><span><b>${esc(x.operateur)}</b> : <b>${esc(x.numero)}</b>${x.nom ? ' (' + esc(x.nom) + ')' : ''}</span><button class="small" data-copy="${esc(x.numero)}">Copier</button></div>`).join('');
    const r2 = await modal('📱 Paiement Mobile Money', `<p>Envoyez <b>${esc(montant)}</b> à l'un de ces numéros${sv.vendeur ? ' (' + esc(sv.vendeur) + ')' : ''} :</p>${nums}
      <p>Indiquez la référence <b>${esc(ord.ref)}</b> dans le motif du transfert, si l'opérateur le permet.</p>
      <p>Ensuite, envoyez la demande et la preuve de paiement (capture ou SMS de confirmation) : vous recevrez votre clé de licence.</p>`,
    [['Copier la demande', 'copy'], ...(sv.whatsapp ? [['Envoyer par WhatsApp', 'wa', true]] : []), ...(sv.email ? [['Envoyer par e-mail', 'mail', !sv.whatsapp]] : []), ['Fermer', null]]);
    if (r2 === 'copy') { await navigator.clipboard.writeText(ord.text); msg(`Demande ${ord.ref} copiée.`); }
    if (r2 === 'wa') window.api.openExternal(`https://wa.me/${sv.whatsapp}?text=${encodeURIComponent(ord.text + '\n\nPaiement Mobile Money effectué : ' + montant)}`);
    if (r2 === 'mail') window.api.openExternal(`mailto:${sv.email}?subject=${encodeURIComponent('Commande SknEDU-studio ' + ord.ref)}&body=${encodeURIComponent(ord.text + '\n\nPaiement Mobile Money effectué : ' + montant)}`);
  }
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-copy]'); if (b) { navigator.clipboard.writeText(b.dataset.copy); msg('Numéro copié.'); } });
document.addEventListener('change', (e) => { if (e.target.id === 'poOffre') { const sv = (LIC && LIC.sales) || {}; const o = (sv.offres || [])[+e.target.value]; const row = $('#poQteRow'); if (row) row.hidden = !(o && o.parPoste); } });
actions.buyLicence = purchaseDialog;

// ---------------------------------------------------------------- Compte obligatoire au premier démarrage
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;
async function ensureAccount() {
  let L = await applyLicense();
  while (L && !L.account) {
    const r = await modal('Bienvenue dans SknEDU-studio', `<p>Créez votre compte pour commencer : <b>30 jours d'essai gratuit de toutes les fonctions</b>, puis la version gratuite ou une licence.</p>
      <label class="blk">Adresse e-mail <span class="err">*</span> <input type="email" id="acEmail" autocomplete="email" placeholder="prenom.nom@exemple.com"></label>
      <label class="blk">Nom et prénom <input id="acName" autocomplete="name" placeholder="facultatif"></label>
      <label class="blk">Établissement <input id="acOrg" autocomplete="organization" placeholder="facultatif"></label>
      <label class="ck"><input type="checkbox" id="acOk"> J'accepte la politique de confidentialité : mon adresse reste sur cet ordinateur et n'est envoyée à personne.</label>
      <p class="muted">L'essai est lié à cet ordinateur et ne peut être utilisé qu'une fois. Votre adresse e-mail sert à établir votre licence.</p>
      <p class="err" id="acErr"></p>`,
    [['Créer mon compte', () => {
      const email = $('#acEmail').value.trim();
      if (!EMAIL_RE.test(email)) { $('#acErr').textContent = 'Indiquez une adresse e-mail valide.'; $('#acEmail').focus(); return false; }
      if (!$('#acOk').checked) { $('#acErr').textContent = 'Cochez la case pour accepter la politique de confidentialité.'; return false; }
      return { email, name: $('#acName').value.trim(), org: $('#acOrg').value.trim() };
    }, true]]);
    if (!r) continue; // Échap : le compte reste obligatoire
    try { await window.api.accountSave(r); } catch (e) { alert(errMsg(e)); }
    L = await applyLicense();
    if (L.account && window.PREFS) { // nom et établissement repris dans les préférences
      if (!PREFS.teacher && r.name) PREFS.teacher = r.name; if (!PREFS.school && r.org) PREFS.school = r.org;
      if (window.__teacher) window.__teacher.savePrefs();
      msg(`Compte créé : essai Premium de 30 jours, jusqu'au ${new Date(L.trial.end).toLocaleDateString('fr-FR')}.`);
    }
  }
  return L;
}
/** Rappels : fin d'essai proche, essai terminé, horloge reculée. */
async function trialNotices(L) {
  if (!L || !L.account || L.mode === 'licence') return;
  const day = new Date().toISOString().slice(0, 10); let last = null; try { last = localStorage.getItem('edupdf.trialNotice'); } catch { /* */ }
  if (L.trial.clockBack) return upgradeDialog('edit');
  if (L.mode === 'essai' && L.trial.daysLeft <= 7 && last !== day) {
    try { localStorage.setItem('edupdf.trialNotice', day); } catch { /* */ }
    const r = await modal('⭐ Essai Premium', `<p>Il reste <b>${L.trial.daysLeft} jour(s)</b> à votre essai des fonctions Premium.</p><p class="muted">Ensuite, la version gratuite reste utilisable ; les fonctions Premium demandent une licence.</p>`,
      [['Plus tard', null], ['J\'ai une licence', 'lic'], ['Obtenir une licence', 'buy', true]]);
    if (r === 'buy') purchaseDialog(); if (r === 'lic') actions.license();
  } else if (L.mode === 'gratuit' && L.trial.ended && last !== 'fin') {
    try { localStorage.setItem('edupdf.trialNotice', 'fin'); } catch { /* */ }
    upgradeDialog('edit');
  }
}
setInterval(() => applyLicense(), 3600000);
(async () => { const L = await ensureAccount(); trialNotices(L); })();
window.__licensing = { purchaseDialog, buildOrder, licenceDialog: licenceDialogFull, refresh: () => applyLicense(), PREMIUM_ACTS, PREMIUM_TOOLS, PREMIUM_GROUPS, markPremium, ensureAccount, editionText };
