/* SknEDU-studio — console d'administration */
'use strict';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const err = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
let D = null; let EV = { events: [], posts: [], labels: {} };
const SHORT = { save: 'Enregistrer', edit: 'Modifier', forms: 'Formulaires', pages: 'Pages', ocr: 'OCR', scan: 'Scanner', convert: 'Convertir', print: 'Imprimer', cloud: 'Cloud', protect: 'Mot de passe', unlock: 'PDF protégés', sign: 'Signer', compare: 'Comparer', ai: 'IA' };
function toast(t) { const m = $('#msg'); m.textContent = t; m.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => { m.style.display = 'none'; }, 3500); }
const fmt = (ts) => new Date(ts).toLocaleString('fr-FR');

$('#go').onclick = login;
$('#pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
async function login() {
  try { await window.adm.login($('#pw').value); $('#login').hidden = true; $('#app').hidden = false; await load(); }
  catch (e) { $('#loginErr').textContent = err(e); }
}
window.adm.status().then((s) => { $('#who').textContent = `${s.host}\\${s.user}`; });
setTimeout(() => $('#pw').focus(), 100);

$$('nav button').forEach((b) => { b.onclick = () => { $$('nav button').forEach((x) => x.classList.toggle('on', x === b)); $$('section').forEach((s) => s.classList.toggle('on', s.dataset.s === b.dataset.t)); if (/activity|journal/.test(b.dataset.t)) loadEvents(); }; });

async function load() {
  D = await window.adm.get();
  const P = D.policy;
  $('#defaults').innerHTML = Object.entries(D.features).map(([k, l]) => `<label class="ck"><input type="checkbox" data-f="${k}" ${P.defaults[k] !== false ? 'checked' : ''}> ${esc(l)}</label>`).join('');
  $('#message').value = P.message || ''; $('#logNames').checked = P.logFileNames !== false;
  { const last = P.reviewedAt || P.updated; const due = !last || Date.now() - Date.parse(last) > 90 * 86400000;
    $('#updated').textContent = (P.updated ? `Dernière diffusion : ${fmt(P.updated)}` : '') + (due ? ' — ⚠️ revue des droits à faire (plus de 90 jours) : vérifiez les droits puis enregistrez' : ` — revue des droits à jour (prochaine avant le ${new Date(Date.parse(last) + 90 * 86400000).toLocaleDateString('fr-FR')})`); }
  if (D.tampered) toast('⚠️ Le fichier de règles a été modifié hors de la console : vérifiez les réglages puis cliquez « Enregistrer et diffuser » pour le re-signer.');
  $('#folder').textContent = D.folder;
  $('#notifTypes').innerHTML = Object.entries(D.events).map(([k, l]) => `<label class="ck"><input type="checkbox" data-n="${k}" ${D.notify.types.includes(k) ? 'checked' : ''}> ${esc(l)}</label>`).join('');
  $('#nWin').checked = D.notify.windows !== false; $('#nStart').checked = !!D.notify.startup; $('#nTopic').value = D.notify.ntfy || '';
  $('#fType').innerHTML = '<option value="">Tous les événements</option>' + Object.entries(D.events).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('');
  await loadEvents(); renderUsers();
}

// ---- utilisateurs
function renderUsers() {
  const P = D.policy; const keys = new Set(Object.keys(P.users));
  EV.posts.forEach((p) => keys.add(`${p.host}\\${p.user}`.toLowerCase()));
  const feats = Object.keys(D.features);
  const head = `<tr><th>Utilisateur / poste</th><th>Dernière activité</th><th>Bloqué</th>${feats.map((f) => `<th title="${esc(D.features[f])}">${esc(SHORT[f] || f)}</th>`).join('')}</tr>`;
  const rows = [...keys].sort().map((k) => {
    const u = P.users[k] || {}; const post = EV.posts.find((p) => `${p.host}\\${p.user}`.toLowerCase() === k);
    return `<tr data-k="${esc(k)}"><td><b>${esc(k)}</b></td><td class="muted">${post ? fmt(post.last) : '—'}</td>
      <td><input type="checkbox" data-blocked ${u.blocked ? 'checked' : ''}></td>
      ${feats.map((f) => { const v = u.features && typeof u.features[f] === 'boolean' ? (u.features[f] ? 'y' : 'n') : ''; return `<td><select data-uf="${f}"><option value="">Défaut</option><option value="y" ${v === 'y' ? 'selected' : ''}>✔</option><option value="n" ${v === 'n' ? 'selected' : ''}>✖</option></select></td>`; }).join('')}</tr>`;
  });
  $('#usersTbl').innerHTML = head + (rows.join('') || `<tr><td colspan="${feats.length + 3}" class="muted">Aucun utilisateur connu pour l'instant : ajoutez-en un, ou attendez qu'un poste inscrit ouvre SknEDU-studio.</td></tr>`);
}
$('#addUser').onclick = () => {
  const k = $('#newUser').value.trim().toLowerCase(); if (!k) return;
  collect(); D.policy.users[k] = D.policy.users[k] || { blocked: false, features: {} }; $('#newUser').value = ''; renderUsers();
};
function collect() {
  const P = D.policy;
  $$('#defaults [data-f]').forEach((c) => { P.defaults[c.dataset.f] = c.checked; });
  P.message = $('#message').value; P.logFileNames = $('#logNames').checked;
  $$('#usersTbl tr[data-k]').forEach((tr) => {
    const k = tr.dataset.k; const u = { blocked: tr.querySelector('[data-blocked]').checked, features: {} };
    tr.querySelectorAll('[data-uf]').forEach((s) => { if (s.value) u.features[s.dataset.uf] = s.value === 'y'; });
    if (u.blocked || Object.keys(u.features).length || P.users[k]) P.users[k] = u;
  });
}
$$('.save').forEach((b) => { b.onclick = async () => {
  collect();
  try { const r = await window.adm.save(D.policy); D.policy.updated = r.updated; $('#updated').textContent = `Dernière diffusion : ${fmt(r.updated)}`; toast('Règles enregistrées : les postes les appliquent dans la minute.'); }
  catch (e) { toast(err(e)); }
}; });

// ---- activité et journal
async function loadEvents() {
  try { EV = await window.adm.events(3000); } catch (e) { toast(err(e)); return; }
  $('#postsTbl').innerHTML = '<tr><th>Poste</th><th>Utilisateur</th><th>Dernière activité</th><th>Dernier événement</th><th>Version</th><th>Événements</th><th>Actions bloquées</th></tr>' +
    (EV.posts.sort((a, b) => (a.last < b.last ? 1 : -1)).map((p) => `<tr><td>${esc(p.host)}</td><td>${esc(p.user)}</td><td>${fmt(p.last)}</td><td>${esc(EV.labels[p.lastType] || p.lastType)}</td><td>${esc(p.version || '')}</td><td>${p.count}</td><td>${p.blocked ? `<span class="tag bad">${p.blocked}</span>` : '<span class="tag good">0</span>'}</td></tr>`).join('') ||
      '<tr><td colspan="7" class="muted">Aucune activité enregistrée pour l\'instant.</td></tr>');
  renderJournal(); if (D) renderUsers();
}
function renderJournal() {
  const t = $('#fType').value; const q = $('#fText').value.toLowerCase();
  const list = EV.events.filter((e) => (!t || e.type === t) && (!q || JSON.stringify(e).toLowerCase().includes(q))).slice(0, 1000);
  const bad = new Set(['blocked', 'user_blocked', 'policy_tampered', 'admin_fail', 'unenroll']);
  $('#journalTbl').innerHTML = '<tr><th>Date</th><th>Poste</th><th>Utilisateur</th><th>Événement</th><th>Détail</th></tr>' +
    (list.map((e) => `<tr><td>${fmt(e.ts)}</td><td>${esc(e.host)}</td><td>${esc(e.user)}</td><td><span class="tag ${bad.has(e.type) ? 'bad' : ''}">${esc(EV.labels[e.type] || e.type)}</span></td><td class="muted">${esc(Object.values(e.detail || {}).join(' — '))}</td></tr>`).join('') ||
      '<tr><td colspan="5" class="muted">Aucun événement.</td></tr>');
}
$('#fType').onchange = renderJournal; $('#fText').oninput = renderJournal; $('#reload').onclick = loadEvents;
window.adm.onChanged(() => { if (!$('#app').hidden) loadEvents(); });

// ---- notifications
$('#genTopic').onclick = () => { const a = new Uint8Array(9); crypto.getRandomValues(a); $('#nTopic').value = 'edupdf-' + [...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14); };
$('#saveNotif').onclick = async () => {
  try {
    await window.adm.saveNotify({ types: $$('#notifTypes [data-n]').filter((c) => c.checked).map((c) => c.dataset.n), windows: $('#nWin').checked, startup: $('#nStart').checked, ntfy: $('#nTopic').value.trim() });
    toast('Préférences de notification enregistrées.');
  } catch (e) { toast(err(e)); }
};
$('#testNotif').onclick = async () => { await window.adm.testNotify(); toast('Notification de test envoyée.'); };

// ---- paramètres
$('#openFolder').onclick = () => window.adm.showFolder();
$('#chPw').onclick = async () => {
  try { await window.adm.changePassword($('#oldPw').value, $('#newPw').value); $('#oldPw').value = $('#newPw').value = ''; toast('Mot de passe changé et règles re-signées.'); }
  catch (e) { toast(err(e)); }
};
