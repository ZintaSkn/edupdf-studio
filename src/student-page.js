// SknEDU-studio — pages servies aux élèves de la classe connectée (texte pur, sans dépendance) :
//  - par le PC de l'enseignant sur le réseau de la classe (src/classroom.js) ;
//  - par le relais pour les élèves à distance (server/worker.js), où tout le contenu est chiffré de bout en bout.
// Scripts volontairement simples (syntaxe ES5) pour fonctionner sur tous les navigateurs, y compris anciens.
'use strict';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CSS = `body{font:16px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;margin:0;background:#f1f3f8;color:#141c33;-webkit-text-size-adjust:100%}
header{background:#001871;color:#fff;padding:14px 18px;border-bottom:4px solid #F1B434}main{max-width:620px;margin:18px auto;padding:0 14px}main.wide{max-width:980px}
.card{background:#fff;border-radius:12px;padding:16px;margin-bottom:14px;box-shadow:0 2px 10px rgba(0,0,0,.08)}h2,h3{margin:0 0 8px}
a.btn,button{display:inline-block;background:#001871;color:#fff;border:0;border-radius:8px;padding:12px 18px;font-size:16px;text-decoration:none;margin:4px 6px 4px 0;cursor:pointer;-webkit-appearance:none}
a.btn.alt,button.alt{background:#fff;color:#001871;border:2px solid #001871;padding:10px 16px}button[disabled]{opacity:.6}
input,select{font-size:16px;padding:10px;border:1px solid #c4cbd8;border-radius:8px;width:100%;box-sizing:border-box;margin:6px 0 12px;background:#fff}
.ok{color:#128a3e}.err{color:#c63b3b}.muted{color:#5b6478;font-size:14px}
.bar{position:-webkit-sticky;position:sticky;top:0;z-index:5;background:#fff;border-radius:0 0 12px 12px;padding:10px 12px;box-shadow:0 2px 10px rgba(0,0,0,.12);margin-bottom:12px}
.bar .row{display:-webkit-flex;display:flex;-webkit-flex-wrap:wrap;flex-wrap:wrap;-webkit-align-items:center;align-items:center}.bar input{-webkit-flex:1 1 200px;flex:1 1 200px;margin:4px 6px 4px 0;width:auto}.bar select{width:auto;margin:4px 6px 4px 0}
.pg{position:relative;background:#fff;margin:0 0 12px;box-shadow:0 2px 10px rgba(0,0,0,.12);overflow:hidden;cursor:text}.pg img{display:block;width:100%;height:auto;-webkit-user-select:none;user-select:none;pointer-events:none}
.pg textarea.t{position:absolute;margin:0;padding:0 2px;border:1px dashed rgba(0,48,156,.45);border-radius:2px;background:rgba(255,255,255,.55);color:#00309c;font-family:Helvetica,Arial,sans-serif;line-height:1.25;resize:none;overflow:hidden;box-sizing:border-box;-webkit-appearance:none}
.pg textarea.t:focus{outline:none;border:1px solid #00309c;background:rgba(255,255,255,.85)}`;

function page(title, body, wide) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body><header><b>SknEDU-studio</b> — classe connectée</header><main id="main"${wide ? ' class="wide"' : ''}>${body}</main></body></html>`;
}

/** Textes de la page « Remplir en ligne ». */
const FILL_TEXT = { send: '📤 Envoyer ma copie', sending: 'Envoi en cours…', name: 'Indiquez votre nom et votre prénom.', empty: 'Écrivez au moins une réponse sur le document : touchez la page à l\'endroit voulu.',
  confirm: 'Envoyer votre copie ? Après l\'envoi, elle sera verrouillée et ne pourra plus être modifiée.', fail: 'Envoi impossible : vérifiez votre connexion, puis réessayez.', done: 'Copie reçue',
  locked: 'Votre copie a bien été transmise. Elle est verrouillée : elle ne peut plus être modifiée.' };
/** Barre et zone des pages de « Remplir en ligne » (le lien de retour dépend du mode : réseau de la classe ou relais). */
const fillBody = (back) => `<div class="bar"><div class="row"><input id="eleve" maxlength="80" placeholder="Nom et prénom" autocomplete="name">
    <select id="sz" title="Taille du texte"><option value="0.018">Texte petit</option><option value="0.024" selected>Texte moyen</option><option value="0.032">Texte grand</option></select>
    <button id="send">📤 Envoyer ma copie</button></div>
    <div class="muted">✏️ Touchez la page à l'endroit où vous voulez écrire. Une zone vide disparaît toute seule. ${back}</div></div>
    <div id="pages"></div>`;

// « Remplir en ligne » : window.SKFILL(C) avec C = { key, pages:[{w,h}], t:FILL_TEXT, pageSrc(i, cb(url)), submit(copie, cb(erreur|null)) }.
const FILL_JS = String.raw`window.SKFILL = function (C) {
  var box = document.getElementById('pages'), nameEl = document.getElementById('eleve'), sizeSel = document.getElementById('sz'), send = document.getElementById('send');
  var KEY = 'sknedu-classe-' + C.key, pages = [];
  function fit(t) { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; }
  function px(t) { t.style.fontSize = Math.max(7, parseFloat(t.getAttribute('data-fs')) * t.parentNode.clientWidth) + 'px'; fit(t); }
  function items() {
    var out = [], i, j, ts, t, pg;
    for (i = 0; i < pages.length; i++) {
      pg = pages[i]; ts = pg.getElementsByTagName('textarea');
      for (j = 0; j < ts.length; j++) {
        t = ts[j]; if (!t.value.replace(/\s/g, '') || !pg.clientWidth || !pg.clientHeight) continue;
        out.push({ p: i, x: t.offsetLeft / pg.clientWidth, y: t.offsetTop / pg.clientHeight, w: t.offsetWidth / pg.clientWidth, h: t.offsetHeight / pg.clientHeight, fs: parseFloat(t.getAttribute('data-fs')), text: t.value });
      }
    }
    return out;
  }
  function save() { try { window.localStorage.setItem(KEY, JSON.stringify({ n: nameEl.value, i: items() })); } catch (e) {} }
  function add(pg, x, y, fs, text) {
    var t = document.createElement('textarea'); t.className = 't'; t.rows = 1; t.setAttribute('data-fs', fs); t.setAttribute('autocapitalize', 'sentences');
    t.style.left = (x * 100) + '%'; t.style.top = (y * 100) + '%'; t.style.width = (Math.max(0.1, Math.min(0.7, 0.985 - x)) * 100) + '%';
    t.value = text || ''; pg.appendChild(t); px(t);
    t.oninput = function () { fit(t); save(); };
    t.onblur = function () { if (!t.value.replace(/\s/g, '') && t.parentNode) t.parentNode.removeChild(t); save(); };
    return t;
  }
  function makePage(i) {
    var pg = document.createElement('div'), img = document.createElement('img'), s = C.pages[i];
    pg.className = 'pg'; img.alt = 'Page ' + (i + 1); img.width = Math.round(s.w); img.height = Math.round(s.h);
    img.onload = function () { var ts = pg.getElementsByTagName('textarea'), j; for (j = 0; j < ts.length; j++) px(ts[j]); };
    pg.appendChild(img); box.appendChild(pg); pages.push(pg);
    C.pageSrc(i, function (url) { if (url) img.src = url; });
    pg.onclick = function (e) {
      if (e.target && e.target.tagName === 'TEXTAREA') return;
      var r = pg.getBoundingClientRect(), fs = parseFloat(sizeSel.value); if (!r.width || !r.height) return;
      var x = Math.min(0.9, Math.max(0, (e.clientX - r.left) / r.width)), y = Math.min(0.97, Math.max(0, (e.clientY - r.top) / r.height - fs * r.width * 0.7 / r.height));
      add(pg, x, y, fs, '').focus();
    };
  }
  var i, d;
  for (i = 0; i < C.pages.length; i++) makePage(i);
  try { d = JSON.parse(window.localStorage.getItem(KEY) || 'null'); } catch (e) { d = null; }
  if (d && d.i && d.i.length) { nameEl.value = d.n || ''; for (i = 0; i < d.i.length; i++) if (pages[d.i[i].p]) add(pages[d.i[i].p], d.i[i].x, d.i[i].y, d.i[i].fs, d.i[i].text); }
  nameEl.oninput = save;
  window.onresize = function () { var ts = box.getElementsByTagName('textarea'), j; for (j = 0; j < ts.length; j++) px(ts[j]); };
  send.onclick = function () {
    var n = nameEl.value.replace(/^\s+|\s+$/g, ''), it = items();
    if (!n) { window.alert(C.t.name); nameEl.focus(); return; }
    if (!it.length) { window.alert(C.t.empty); return; }
    if (!window.confirm(C.t.confirm)) return;
    send.disabled = true; send.innerHTML = C.t.sending;
    C.submit({ eleve: n, items: it }, function (err) {
      if (err) { window.alert(err === true ? C.t.fail : err); send.disabled = false; send.innerHTML = C.t.send; return; }
      try { window.localStorage.removeItem(KEY); } catch (e) {}
      document.getElementById('main').innerHTML = '<div class="card ok"><h2>✅ ' + C.t.done + '</h2><p>' + C.t.locked + '</p></div>'; window.scrollTo(0, 0);
    });
  };
};`;

// Réseau de la classe : images et envoi directs vers le PC de l'enseignant.
const LAN_JS = String.raw`(function () {
  var C = window.CFG;
  C.pageSrc = function (i, cb) { cb(C.base + '/page/' + i + '.jpg'); };
  C.submit = function (copie, cb) {
    var x = new XMLHttpRequest(); x.open('POST', C.base + '/remplir'); x.setRequestHeader('Content-Type', 'application/json');
    x.onload = function () { var r = {}; try { r = JSON.parse(x.responseText); } catch (e) {} cb(x.status === 200 && r.ok ? null : (r.error || true)); };
    x.onerror = function () { cb(true); };
    x.send(JSON.stringify(copie));
  };
  window.SKFILL(C);
})();`;

// À distance : la page parle au relais, mais tout ce qui circule est chiffré avec la clé contenue dans le lien (après « # »),
// que le navigateur n'envoie jamais au relais. Message = [4 octets : longueur de l'en-tête][en-tête JSON][données].
const REMOTE_JS = String.raw`(function () {
  var T = window.SKT, main = document.getElementById('main'), api = location.pathname.replace(/\/+$/, ''), room = api.split('/').pop();
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function card(cls, html) { main.className = ''; main.innerHTML = '<div class="card ' + cls + '">' + html + '</div>'; window.scrollTo(0, 0); }
  function fromB64u(s) { var b = window.atob(s.replace(/-/g, '+').replace(/_/g, '/')), a = new Uint8Array(b.length), i; for (i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  function toB64u(a) { var s = '', i; a = new Uint8Array(a); for (i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return window.btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function hex(n) { var a = new Uint8Array(n), s = '', i; window.crypto.getRandomValues(a); for (i = 0; i < n; i++) s += (a[i] < 16 ? '0' : '') + a[i].toString(16); return s; }
  var C = window.crypto, S = C && (C.subtle || C.webkitSubtle);
  if (!S || !window.Promise || !window.TextEncoder || !window.Uint8Array) return card('err', T.old);
  var raw = null; try { raw = fromB64u(location.hash.replace(/^#/, '')); } catch (e) { raw = null; }
  if (!raw || raw.length !== 32) return card('err', T.badLink);
  var te = new window.TextEncoder(), td = new window.TextDecoder();
  var keyP = S.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  var macP = S.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  function frame(head, body) {
    var h = te.encode(JSON.stringify(head)), b = body ? new Uint8Array(body) : new Uint8Array(0), out = new Uint8Array(4 + h.length + b.length);
    out[0] = h.length >>> 24; out[1] = (h.length >>> 16) & 255; out[2] = (h.length >>> 8) & 255; out[3] = h.length & 255; out.set(h, 4); out.set(b, 4 + h.length); return out;
  }
  function unframe(buf) { var a = new Uint8Array(buf), n = ((a[0] << 24) | (a[1] << 16) | (a[2] << 8) | a[3]) >>> 0; return { head: JSON.parse(td.decode(a.subarray(4, 4 + n))), body: a.subarray(4 + n) }; }
  // Appel chiffré : « shared » = réponse identique pour toute la classe (document, images de pages), que le relais peut garder sans pouvoir la lire.
  function call(head, body, shared) {
    var id = hex(16), iv = new Uint8Array(12); C.getRandomValues(iv);
    return Promise.all([keyP, shared ? macP.then(function (m) { return S.sign('HMAC', m, te.encode('cache:' + JSON.stringify(head))); }) : null]).then(function (r) {
      var key = r[0], ck = r[1] ? toB64u(r[1]) : '';
      return S.encrypt({ name: 'AES-GCM', iv: iv, additionalData: te.encode('q:' + id) }, key, frame(head, body)).then(function (ct) {
        var msg = new Uint8Array(12 + ct.byteLength); msg.set(iv, 0); msg.set(new Uint8Array(ct), 12);
        return new Promise(function (ok, ko) {
          var x = new XMLHttpRequest(); x.open('POST', api + '/q'); x.responseType = 'arraybuffer';
          x.setRequestHeader('Content-Type', 'application/octet-stream'); x.setRequestHeader('X-Id', id); if (ck) x.setRequestHeader('X-Cache', ck);
          x.onload = function () {
            if (x.status !== 200) return ko(x.status === 503 ? T.offline : x.status === 404 || x.status === 410 ? T.ended : x.status === 413 ? T.big : x.status === 429 ? T.busy : T.net);
            var a = new Uint8Array(x.response), aad = x.getResponseHeader('X-Aad') === 'c' && ck ? 'c:' + ck : 'a:' + id;
            S.decrypt({ name: 'AES-GCM', iv: a.subarray(0, 12), additionalData: te.encode(aad) }, key, a.subarray(12)).then(function (pt) { ok(unframe(pt)); }, function () { ko(T.badLink); });
          };
          x.onerror = function () { ko(T.net); }; x.ontimeout = function () { ko(T.net); }; x.timeout = 120000;
          x.send(msg);
        });
      });
    });
  }
  function download(op, name, type, btn) {
    var label = btn.innerHTML; btn.disabled = true; btn.innerHTML = T.loading;
    call({ op: op }, null, true).then(function (r) {
      var url = window.URL.createObjectURL(new window.Blob([r.body], { type: type })), a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      window.setTimeout(function () { window.URL.revokeObjectURL(url); }, 60000);
    }, function (e) { window.alert(e); }).then(function () { btn.disabled = false; btn.innerHTML = label; });
  }
  function readFiles(list) {
    return Promise.all(Array.prototype.map.call(list, function (f) {
      return new Promise(function (ok, ko) { var r = new window.FileReader(); r.onload = function () { ok({ name: f.name, data: new Uint8Array(r.result) }); }; r.onerror = function () { ko(T.read); }; r.readAsArrayBuffer(f); });
    }));
  }
  function home(info) {
    var h = '<div class="card"><h2>' + esc(info.title) + '</h2><p>' + esc(info.message || T.defMsg) + '</p>'
      + (info.fill ? '<button id="bFill">✏️ Remplir en ligne</button>' : '') + '<button id="bPdf"' + (info.fill ? ' class="alt"' : '') + '>📥 PDF</button>'
      + (info.word ? '<button id="bDocx" class="alt">📥 Word (.docx)</button>' : '') + (info.fill ? '<p class="muted">' + T.fillHint + '</p>' : '') + '</div>';
    if (info.collect) h += '<div class="card"><h3>Rendre ma copie</h3><label>Nom et prénom<input id="rEleve" maxlength="80" autocomplete="name"></label>'
      + '<label>Copie (PDF, ou photos de la copie)<input type="file" id="rFiles" accept="application/pdf,.pdf,image/*" multiple></label><button id="rSend">📤 Envoyer ma copie</button>'
      + '<p class="muted">🔒 ' + T.lockNote + '</p></div>';
    h += '<p class="muted">🔐 ' + T.e2e + '</p>';
    main.className = ''; main.innerHTML = h;
    document.getElementById('bPdf').onclick = function () { download('pdf', info.fileName || 'document.pdf', 'application/pdf', this); };
    if (info.word) document.getElementById('bDocx').onclick = function () { download('docx', (info.fileName || 'document.pdf').replace(/\.pdf$/i, '') + '.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', this); };
    if (info.fill) document.getElementById('bFill').onclick = function () { fill(info); };
    if (info.collect) document.getElementById('rSend').onclick = function () {
      var btn = this, n = document.getElementById('rEleve').value.replace(/^\s+|\s+$/g, ''), fl = document.getElementById('rFiles').files, total = 0, i;
      if (!n || !fl || !fl.length) return window.alert(T.need);
      for (i = 0; i < fl.length; i++) total += fl[i].size;
      if (total > info.maxUpload) return window.alert(T.big);
      btn.disabled = true; btn.innerHTML = T.sending;
      readFiles(fl).then(function (files) {
        var all = new Uint8Array(total), off = 0, meta = [], j;
        for (j = 0; j < files.length; j++) { all.set(files[j].data, off); off += files[j].data.length; meta.push({ name: files[j].name, size: files[j].data.length }); }
        return call({ op: 'files', eleve: n, files: meta }, all, false);
      }).then(function (r) {
        if (!r.head.ok) throw r.head.error || T.net;
        card('ok', '<h2>✅ Copie reçue</h2><p>' + T.thanks + '</p><p>🔒 ' + T.lockedNow + '</p>');
      }).then(null, function (e) { window.alert(e); btn.disabled = false; btn.innerHTML = '📤 Envoyer ma copie'; });
    };
  }
  function fill(info) {
    main.className = 'wide'; main.innerHTML = T.fillBody; window.scrollTo(0, 0);
    document.getElementById('skBack').onclick = function (e) { e.preventDefault(); home(info); };
    window.SKFILL({ key: room, pages: info.pages, t: T.fill,
      pageSrc: function (i, cb) { call({ op: 'page', i: i }, null, true).then(function (r) { cb(window.URL.createObjectURL(new window.Blob([r.body], { type: 'image/jpeg' }))); }, function () { cb(null); }); },
      submit: function (copie, cb) { call({ op: 'fill', eleve: copie.eleve, items: copie.items }, null, false).then(function (r) { cb(r.head.ok ? null : (r.head.error || true)); }, function (e) { cb(e || true); }); } });
  }
  card('', '<p class="muted">' + T.loading + '</p>');
  call({ op: 'info' }, null, true).then(function (r) { if (!r.head.ok) throw r.head.error || T.ended; home(r.head); }).then(null, function (e) { card('err', esc(e)); });
})();`;

const REMOTE_TEXT = {
  old: 'Ce navigateur est trop ancien pour ouvrir ce lien en toute sécurité : mettez-le à jour, ou utilisez un autre navigateur.',
  badLink: 'Lien incomplet ou incorrect : ouvrez le lien entier envoyé par votre enseignant (ou scannez à nouveau le QR code).',
  offline: 'L\'enseignant n\'est pas connecté pour l\'instant : réessayez dans quelques minutes.', ended: 'Ce partage est terminé.',
  big: 'Fichiers trop volumineux (25 Mo au plus pour une copie envoyée à distance).', busy: 'Beaucoup de demandes en ce moment : réessayez dans un instant.',
  net: 'Connexion impossible : vérifiez votre connexion Internet, puis réessayez.', read: 'Un fichier n\'a pas pu être lu : choisissez-le à nouveau.',
  loading: 'Chargement…', sending: 'Envoi en cours…', defMsg: 'Complétez le document, puis rendez votre copie.',
  fillHint: '« Remplir en ligne » : écrivez vos réponses directement sur le document, sans rien installer.',
  lockNote: 'Votre copie est enregistrée en PDF verrouillé : après l\'envoi, elle ne peut plus être modifiée.',
  need: 'Indiquez votre nom et choisissez un fichier PDF ou des photos de votre copie.', thanks: 'Votre copie a bien été transmise.',
  lockedNow: 'Elle est verrouillée : elle ne peut plus être modifiée.',
  e2e: 'Document et copie chiffrés de bout en bout : seuls vous et votre enseignant pouvez les lire.',
  fill: FILL_TEXT, fillBody: fillBody('<a href="#" id="skBack">Retour</a>')
};
const jsonForScript = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
/** Page servie par le relais : aucun contenu de la classe, seulement le programme qui le déchiffre dans le navigateur. */
function remoteShell() {
  return page('Classe connectée', `<div class="card"><p class="muted">Chargement…</p><noscript>Activez JavaScript pour ouvrir ce document.</noscript></div>
    <script>window.SKT = ${jsonForScript(REMOTE_TEXT)};</script><script>${FILL_JS}</script><script>${REMOTE_JS}</script>`);
}

module.exports = { esc, page, FILL_JS, LAN_JS, FILL_TEXT, fillBody, jsonForScript, remoteShell };
