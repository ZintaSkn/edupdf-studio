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
    document.addEventListener('click', function (e) { if (nav.classList.contains('open') && !nav.contains(e.target) && !btn.contains(e.target)) { nav.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });
  }

  // Copier un numéro ou un lien
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-copy]'); if (!b) return;
    copy(b.getAttribute('data-copy'), b.getAttribute('data-copy-msg') || t('Numéro copié : ', 'Number copied: ') + b.getAttribute('data-copy'));
  });

  // Téléchargement : mettre en avant le système du visiteur
  var oses = $$('.os[data-os]');
  if (oses.length) {
    var ua = navigator.userAgent || ''; var pf = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    var ipad = /Mac/i.test(pf + ua) && navigator.maxTouchPoints > 1; // iPad qui se présente comme un Mac
    var mobile = ipad || /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.userAgentData && navigator.userAgentData.mobile);
    var mine = mobile ? '' : /Win/i.test(pf + ua) ? 'win' : /Mac/i.test(pf + ua) ? 'mac' : /Linux|X11/i.test(pf + ua) ? 'linux' : '';
    oses.forEach(function (o) { if (o.getAttribute('data-os') === mine) o.classList.add('mine'); });
    // Téléphone ou tablette : le logiciel s'installe sur ordinateur ; proposer de s'envoyer le lien
    var note = $('#mobile-note');
    if (note && mobile) {
      note.hidden = false;
      var sh = $('[data-share]', note);
      if (sh && navigator.share) {
        sh.hidden = false;
        sh.addEventListener('click', function () { navigator.share({ title: document.title, url: sh.getAttribute('data-share') }).catch(function () { /* partage annulé */ }); });
      }
    }
    releaseLinks();
  }

  /** Liens directs vers les fichiers de la dernière version (API GitHub) ; sinon les boutons restent sur la page des versions. */
  function releaseLinks() {
    var API = 'https://api.github.com/repos/ZintaSkn/edupdf-studio/releases/latest', KEY = 'zinta.release';
    var RULES = { 'win-setup': /setup[^/]*\.exe$/i, 'win-zip': /-win\.zip$/i, 'mac-arm': /-arm64\.dmg$/i, 'mac-x64': /^(?!.*arm64).*\.dmg$/i, linux: /\.appimage$/i };
    function apply(r) {
      if (!r || !r.assets) return;
      var mo = function (n) { return Math.round(n / 1048576) + (EN ? ' MB' : ' Mo'); };
      $$('a[data-asset]').forEach(function (a) {
        var re = RULES[a.getAttribute('data-asset')]; if (!re) return;
        var f = r.assets.filter(function (x) { return re.test(x.name) && !/\.blockmap$/i.test(x.name); })[0]; if (!f) return;
        a.href = f.browser_download_url; a.removeAttribute('rel');
        var m = $('.dl-meta', a); if (m) m.textContent = f.name + ' — ' + mo(f.size);
      });
      var rel = $('#release');
      if (rel && r.tag_name) {
        var d = r.published_at ? new Date(r.published_at).toLocaleDateString(EN ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
        rel.textContent = t('Dernière version : ', 'Latest version: ');
        var b = document.createElement('b'); b.textContent = r.tag_name.replace(/^v/, ''); rel.appendChild(b);
        if (d) rel.appendChild(document.createTextNode(t(' — publiée le ', ' — released on ') + d));
      }
    }
    var cached = null;
    try { cached = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { cached = null; }
    if (cached && Date.now() - cached.at < 3600000) return apply(cached.r);
    if (!window.fetch) return;
    fetch(API, { headers: { Accept: 'application/vnd.github+json' } }).then(function (res) { return res.ok ? res.json() : null; }).then(function (j) {
      if (!j || !j.assets) return;
      var r = { tag_name: j.tag_name, published_at: j.published_at, assets: j.assets.map(function (x) { return { name: x.name, size: x.size, browser_download_url: x.browser_download_url }; }) };
      try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), r: r })); } catch (e) { /* */ }
      apply(r);
    }).catch(function () { /* hors ligne ou limite atteinte : les boutons mènent à la page des versions */ });
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
    function send(how) {
      if (!ok()) return; var m = msg();
      if (how === 'wa') window.location.href = 'https://wa.me/' + WA_NUM + '?text=' + encodeURIComponent(m);
      else if (how === 'mail') window.location.href = 'mailto:' + MAIL + '?subject=' + encodeURIComponent(t('Demande — ', 'Request — ') + cat) + '&body=' + encodeURIComponent(m);
      else copy(m, t('Demande copiée', 'Request copied'));
    }
    f.addEventListener('submit', function (e) { e.preventDefault(); send('wa'); }); // bouton « Envoyer par WhatsApp » ou touche Entrée
    $$('[data-req]', f).forEach(function (b) { if (b.type !== 'submit') b.addEventListener('click', function () { send(b.getAttribute('data-req')); }); });
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
  function send(how) {
    if (!validate()) return;
    var msg = message(); var p = parsePaste(); var ref = p && p.valid ? ' ' + p.ref : '';
    if (how === 'wa') window.location.href = 'https://wa.me/' + D.wa + '?text=' + encodeURIComponent(msg);
    else if (how === 'mail') window.location.href = 'mailto:' + D.email + '?subject=' + encodeURIComponent(t('Commande SknEDU-studio', 'SknEDU-studio order') + ref) + '&body=' + encodeURIComponent(msg);
    else copy(msg, t('Message copié', 'Message copied'));
  }
  form.addEventListener('submit', function (e) { e.preventDefault(); send('wa'); }); // bouton « Envoyer par WhatsApp » ou touche Entrée
  $$('[data-send]').forEach(function (b) { if (b.type !== 'submit') b.addEventListener('click', function () { send(b.getAttribute('data-send')); }); });
  update();
})();
