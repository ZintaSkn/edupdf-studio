// ZintaServices — menu, copie des numéros, système détecté, demandes de produits et commande de licence (tout reste dans le navigateur).
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var EN = document.documentElement.lang === 'en';
  var t = function (fr, en) { return EN ? en : fr; };

  function toast(msg) {
    var el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = msg;
    document.body.appendChild(el); setTimeout(function () { el.remove(); }, 2200);
  }
  function copy(text, done) {
    var ok = function () { toast(done || t('Copié', 'Copied')); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(ok, fallback); else fallback();
    function fallback() { var a = document.createElement('textarea'); a.value = text; a.setAttribute('readonly', ''); a.style.position = 'fixed'; a.style.opacity = '0'; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); ok(); } catch (e) { /* */ } a.remove(); }
  }

  // Menu (téléphone)
  var btn = $('.menu'), nav = $('#nav');
  if (btn && nav) {
    btn.addEventListener('click', function () { var open = nav.classList.toggle('open'); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && nav.classList.contains('open')) { nav.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); btn.focus(); } });
  }

  // Copier un numéro
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-copy]'); if (!b) return;
    copy(b.getAttribute('data-copy'), t('Numéro copié : ', 'Number copied: ') + b.getAttribute('data-copy'));
  });

  // Téléchargement : mettre en avant le système du visiteur
  var oses = $$('.os[data-os]');
  if (oses.length) {
    var ua = navigator.userAgent || ''; var pf = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    var mine = /Android|iPhone|iPad|iPod/i.test(ua) ? '' : /Win/i.test(pf + ua) ? 'win' : /Mac/i.test(pf + ua) ? 'mac' : /Linux|X11/i.test(pf + ua) ? 'linux' : '';
    oses.forEach(function (o) { if (o.getAttribute('data-os') === mine) o.classList.add('mine'); });
  }

  // ---------------------------------------------------------------- Demande de produits (fournitures, bio, électronique)
  var WA_NUM = '2250506848164', MAIL = 'sknzinta@gmail.com';
  $$('.req-form').forEach(function (f) {
    var cat = f.getAttribute('data-cat'); var err = $('.error', f);
    var val = function (n) { var e = f.elements[n]; return e ? e.value.trim() : ''; };
    function msg() {
      var lines = [t('Demande — ', 'Request — ') + cat + t(' (site ZintaServices)', ' (ZintaServices website)'), '', t('Articles :', 'Items:'), val('items'), '', t('Nom : ', 'Name: ') + val('nom')];
      if (val('tel')) lines.push(t('Téléphone : ', 'Phone: ') + val('tel'));
      if (val('ville')) lines.push(t('Ville / commune : ', 'Town / district: ') + val('ville'));
      lines.push(t('Réception : ', 'Receiving: ') + val('reception'));
      return lines.join('\n');
    }
    function ok() {
      var bad = !val('items') ? 'items' : !val('nom') ? 'nom' : '';
      ['items', 'nom'].forEach(function (n) { f.elements[n].classList.toggle('invalid', n === bad); });
      if (!bad) { err.hidden = true; return true; }
      err.textContent = bad === 'items' ? t('Indiquez les articles et les quantités souhaités.', 'Please list the items and quantities you want.') : t('Indiquez votre nom.', 'Please enter your name.');
      err.hidden = false; f.elements[bad].focus(); return false;
    }
    f.addEventListener('input', function () { if (!err.hidden && val('items') && val('nom')) { err.hidden = true; f.elements.items.classList.remove('invalid'); f.elements.nom.classList.remove('invalid'); } });
    $$('[data-req]', f).forEach(function (b) {
      b.addEventListener('click', function () {
        if (!ok()) return; var m = msg(); var how = b.getAttribute('data-req');
        if (how === 'wa') window.location.href = 'https://wa.me/' + WA_NUM + '?text=' + encodeURIComponent(m);
        else if (how === 'mail') window.location.href = 'mailto:' + MAIL + '?subject=' + encodeURIComponent(t('Demande — ', 'Request — ') + cat) + '&body=' + encodeURIComponent(m);
        else copy(m, t('Demande copiée', 'Request copied'));
      });
    });
    f.__msg = msg;
  });

  // ---------------------------------------------------------------- Commande d'une licence
  var form = $('#order'); if (!form) return;
  var D = JSON.parse($('#order-data').textContent);
  var fmt = function (n) { return Number(n).toLocaleString(EN ? 'en-US' : 'fr-FR') + ' ' + D.devise; };
  var el = { paste: $('#o-paste'), pasteBtn: $('#o-pastebtn'), parsed: $('#o-parsed'), manual: $('#o-manual'), offre: $('#o-offre'), qteRow: $('#o-qte-row'), qte: $('#o-qte'),
    email: $('#o-email'), nom: $('#o-nom'), org: $('#o-org'), moyen: $('#o-moyen'), trx: $('#o-trx'), total: $('#o-total'), err: $('#o-error'), preview: $('#o-preview') };
  var EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;

  // ?offre=ens-1a
  var q = new URLSearchParams(location.search).get('offre');
  if (q && D.offres.some(function (o) { return o.id === q; })) el.offre.value = q;

  function current() { var id = el.offre.value; for (var i = 0; i < D.offres.length; i++) if (D.offres[i].id === id) return D.offres[i]; return D.offres[0]; }
  /** Demande collée depuis le logiciel (« Commande SknEDU-studio — CMD-… »). */
  function parsePaste() {
    var txt = el.paste.value.trim(); if (!txt) return null;
    var ref = (txt.match(/(CMD-[A-Z0-9-]+)/i) || [])[1] || '';
    var off = (txt.match(/^\s*Offre\s*:\s*(.+)$/im) || [])[1] || '';
    var acc = (txt.match(/^\s*Compte\s*:\s*(\S+@\S+)/im) || [])[1] || '';
    var amount = (off.match(/—\s*([\d\s  .,]+\s*FCFA)/) || [])[1] || '';
    return { txt: txt, ref: ref, off: off, acc: acc, amount: amount.replace(/\s+/g, ' ').trim(), valid: /SknEDU-studio/i.test(txt) && !!ref };
  }
  function update() {
    var o = current(); el.qteRow.hidden = !o.parPoste;
    var min = o.min || 1; el.qte.min = min; if (o.parPoste && (+el.qte.value || 0) < min) el.qte.value = min;
    var n = o.parPoste ? Math.max(min, Math.round(+el.qte.value || min)) : 1;
    var p = parsePaste();
    el.manual.disabled = !!(p && p.valid);
    if (p && p.valid) {
      el.parsed.hidden = false;
      el.parsed.textContent = '✓ ' + t('Demande reconnue', 'Request recognised') + ' — ' + p.ref + (p.off ? ' · ' + p.off : '') + (p.acc ? ' · ' + p.acc : '');
      el.total.textContent = p.amount || '—';
    } else {
      el.parsed.hidden = !p; if (p) el.parsed.textContent = t('Ce texte ne ressemble pas à une demande du logiciel : vérifiez-le, ou remplissez le formulaire.', 'This text does not look like a request from the software: check it, or fill in the form.');
      el.total.textContent = fmt(o.prix * n) + (o.parPoste ? ' (' + n + ' × ' + fmt(o.prix) + ')' : '');
    }
    el.preview.textContent = message();
    if (!el.err.hidden && ((p && p.valid) || EMAIL_RE.test(el.email.value.trim()))) { el.err.hidden = true; el.email.classList.remove('invalid'); }
  }
  function payLine() {
    var m = el.moyen.value; var trx = el.trx.value.trim();
    if (!m) return t('Paiement : pas encore effectué', 'Payment: not made yet');
    return t('Paiement : ', 'Payment: ') + m + t(' au ', ' to ') + D.phone + ' (' + D.vendeur + ')' + (trx ? t(' — transaction ', ' — transaction ') + trx : '') + t(' — preuve jointe', ' — proof attached');
  }
  function message() {
    var p = parsePaste();
    if (p && p.valid) return p.txt + '\n\n' + payLine();
    var o = current(); var n = o.parPoste ? Math.max(o.min || 1, Math.round(+el.qte.value || o.min || 1)) : 1;
    return [t('Commande SknEDU-studio (site ZintaServices)', 'SknEDU-studio order (ZintaServices website)'),
      t('Offre : ', 'Offer: ') + o.label + (o.parPoste ? ' × ' + n + t(' postes', ' seats') : '') + ' — ' + fmt(o.prix * n),
      t('Compte (e-mail) : ', 'Account (e-mail): ') + (el.email.value.trim() || '—'),
      t('Nom : ', 'Name: ') + (el.nom.value.trim() || '—') + (el.org.value.trim() ? ' — ' + el.org.value.trim() : ''),
      '', payLine()].join('\n');
  }
  function validate() {
    var p = parsePaste(); el.err.hidden = true; el.email.classList.remove('invalid');
    if (p && p.valid) return true;
    if (p && !p.valid && !el.email.value.trim()) { el.err.textContent = t('La demande collée n\'est pas reconnue. Collez la demande complète copiée par le logiciel, ou remplissez le formulaire.', 'The pasted request is not recognised. Paste the full request copied by the software, or fill in the form.'); el.err.hidden = false; return false; }
    if (!EMAIL_RE.test(el.email.value.trim())) {
      el.email.classList.add('invalid'); el.err.textContent = t('Indiquez l\'adresse e-mail de votre compte SknEDU-studio : la licence est émise pour cette adresse.', 'Enter the e-mail address of your SknEDU-studio account: the licence is issued for that address.'); el.err.hidden = false; el.email.focus(); return false;
    }
    return true;
  }
  ['input', 'change'].forEach(function (ev) { form.addEventListener(ev, update); el.moyen.addEventListener(ev, update); el.trx.addEventListener(ev, update); });
  el.pasteBtn.addEventListener('click', function () {
    if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(function (txt) { el.paste.value = txt; update(); el.paste.focus(); }, function () { el.paste.focus(); toast(t('Collez avec Ctrl+V ou un appui long', 'Paste with Ctrl+V or a long press')); });
    else { el.paste.focus(); toast(t('Collez avec Ctrl+V ou un appui long', 'Paste with Ctrl+V or a long press')); }
  });
  $$('[data-send]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!validate()) return;
      var msg = message(); var p = parsePaste(); var ref = p && p.valid ? ' ' + p.ref : '';
      var how = b.getAttribute('data-send');
      if (how === 'wa') window.location.href = 'https://wa.me/' + D.wa + '?text=' + encodeURIComponent(msg);
      else if (how === 'mail') window.location.href = 'mailto:' + D.email + '?subject=' + encodeURIComponent(t('Commande SknEDU-studio', 'SknEDU-studio order') + ref) + '&body=' + encodeURIComponent(msg);
      else copy(msg, t('Message copié', 'Message copied'));
    });
  });
  update();
})();
