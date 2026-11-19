// SknEDU-studio — pages servies aux élèves (texte pur, sans dépendance) :
//  - classe connectée par le réseau de la classe : servies par le PC de l'enseignant (src/classroom.js) ;
//  - classe connectée à distance et épreuve en ligne : servies par le service de l'éditeur (server/worker.js), où tout
//    le contenu est chiffré de bout en bout — la page ne contient que le programme qui le déchiffre dans le navigateur.
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
.pg textarea.t:focus{outline:none;border:1px solid #00309c;background:rgba(255,255,255,.85)}
.pg .fld{position:absolute;box-sizing:border-box;margin:0;padding:0 2px;width:auto;border:1px solid rgba(0,110,60,.6);border-radius:2px;background:rgba(226,250,236,.85);color:#00309c;font-family:Helvetica,Arial,sans-serif;line-height:1.2;resize:none;-webkit-appearance:none}
.pg textarea.fld{overflow:auto}.pg .fld:focus{outline:2px solid #128a3e;background:#fff}
.pg input.fld[type=checkbox],.pg input.fld[type=radio]{-webkit-appearance:auto;appearance:auto;padding:0;background:transparent;border:0;accent-color:#00309c}
.pg select.fld{-webkit-appearance:menulist;appearance:menulist;padding:0 2px}
.due{background:#fff7e0;border-left:4px solid #F1B434;padding:8px 10px;border-radius:6px}`;

function page(title, body, wide, label = 'classe connectée') {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body><header><b>SknEDU-studio</b> — ${esc(label)}</header><main id="main"${wide ? ' class="wide"' : ''}>${body}</main></body></html>`;
}

/** Textes de la page « Remplir en ligne ». */
const FILL_TEXT = { send: '📤 Envoyer ma copie', sending: 'Envoi en cours…', name: 'Indiquez votre nom et votre prénom.', empty: 'Répondez au moins à une question : écrivez dans une zone de réponse, ou touchez la page à l\'endroit voulu.',
  confirm: 'Envoyer votre copie ? Après l\'envoi, elle sera verrouillée et ne pourra plus être modifiée.', fail: 'Envoi impossible : vérifiez votre connexion, puis réessayez.', done: 'Copie reçue',
  locked: 'Votre copie a bien été transmise. Elle est verrouillée : elle ne peut plus être modifiée.' };
/** Barre et zone des pages de « Remplir en ligne » (le lien de retour dépend du mode). */
const fillBody = (back) => `<div class="bar"><div class="row"><input id="eleve" maxlength="80" placeholder="Nom et prénom" autocomplete="name">
    <select id="sz" title="Taille du texte"><option value="0.018">Texte petit</option><option value="0.024" selected>Texte moyen</option><option value="0.032">Texte grand</option></select>
    <button id="send">📤 Envoyer ma copie</button></div>
    <div class="muted">✏️ Écrivez dans les zones vertes, ou touchez la page à l'endroit où vous voulez écrire. Une zone libre laissée vide disparaît toute seule. ${back}</div></div>
    <div id="pages"></div>`;

// « Remplir en ligne » : window.SKFILL(C) avec C = { key, pages:[{w,h}], fields:[zones du PDF], t:FILL_TEXT,
//   pageSrc(i, cb(url)), submit({ eleve, items, answers }, cb(erreur|null, résultat)), done(résultat)? }.
const FILL_JS = String.raw`window.SKFILL = function (C) {
  var box = document.getElementById('pages'), nameEl = document.getElementById('eleve'), sizeSel = document.getElementById('sz'), send = document.getElementById('send');
  var KEY = 'sknedu-classe-' + C.key, pages = [], fields = C.fields || [], els = {}, draft = null;
  function fit(t) { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; }
  function px(t) { t.style.fontSize = Math.max(7, parseFloat(t.getAttribute('data-fs')) * t.parentNode.clientWidth) + 'px'; if (t.className === 't') fit(t); }
  function items() {
    var out = [], i, j, ts, t, pg;
    for (i = 0; i < pages.length; i++) {
      pg = pages[i]; ts = pg.getElementsByTagName('textarea');
      for (j = 0; j < ts.length; j++) {
        t = ts[j]; if (t.className !== 't' || !t.value.replace(/\s/g, '') || !pg.clientWidth || !pg.clientHeight) continue;
        out.push({ p: i, x: t.offsetLeft / pg.clientWidth, y: t.offsetTop / pg.clientHeight, w: t.offsetWidth / pg.clientWidth, h: t.offsetHeight / pg.clientHeight, fs: parseFloat(t.getAttribute('data-fs')), text: t.value });
      }
    }
    return out;
  }
  function answers() {
    var out = {}, i, f, e;
    for (i = 0; i < fields.length; i++) {
      f = fields[i]; e = els[f.k]; if (!e) continue;
      if (f.t === 'text') { if (e.value !== (f.v || '') && e.value.replace(/\s/g, '')) out[f.k] = e.value; }
      else if (f.t === 'checkbox') { if (e.checked !== !!f.on) out[f.k] = e.checked; }
      else if (f.t === 'radio') { if (e.checked) out[f.k] = true; }
      else if (f.t === 'choice') { if (e.value && e.value !== (f.v || '')) out[f.k] = e.value; }
    }
    return out;
  }
  function save() { try { window.localStorage.setItem(KEY, JSON.stringify({ n: nameEl.value, i: items(), a: answers() })); } catch (e) {} }
  function add(pg, x, y, fs, text) {
    var t = document.createElement('textarea'); t.className = 't'; t.rows = 1; t.setAttribute('data-fs', fs); t.setAttribute('autocapitalize', 'sentences');
    t.style.left = (x * 100) + '%'; t.style.top = (y * 100) + '%'; t.style.width = (Math.max(0.1, Math.min(0.7, 0.985 - x)) * 100) + '%';
    t.value = text || ''; pg.appendChild(t); px(t);
    t.oninput = function () { fit(t); save(); };
    t.onblur = function () { if (!t.value.replace(/\s/g, '') && t.parentNode) t.parentNode.removeChild(t); save(); };
    return t;
  }
  function field(pg, f) {
    var e, j, o, a = draft && draft.a ? draft.a : {}, has = a.hasOwnProperty(String(f.k));
    if (f.t === 'text') { e = document.createElement(f.ml ? 'textarea' : 'input'); if (!f.ml) e.type = 'text'; if (f.max > 0) e.maxLength = f.max; e.value = has ? a[f.k] : (f.v || ''); e.setAttribute('data-fs', f.fs || 0.02); e.setAttribute('autocapitalize', 'sentences'); }
    else if (f.t === 'checkbox' || f.t === 'radio') { e = document.createElement('input'); e.type = f.t; if (f.t === 'radio') e.name = 'g' + f.g; e.checked = has ? !!a[f.k] : !!f.on; }
    else if (f.t === 'choice') { e = document.createElement('select'); e.appendChild(document.createElement('option')); for (j = 0; j < (f.o || []).length; j++) { o = document.createElement('option'); o.value = f.o[j]; o.appendChild(document.createTextNode(f.o[j])); e.appendChild(o); } e.value = has ? a[f.k] : (f.v || ''); e.setAttribute('data-fs', Math.max(0.012, f.h * 0.6 * 1.414)); }
    else return;
    e.className = 'fld'; e.setAttribute('aria-label', 'Zone de réponse ' + (f.k + 1));
    e.style.left = (f.x * 100) + '%'; e.style.top = (f.y * 100) + '%'; e.style.width = (f.w * 100) + '%'; e.style.height = (f.h * 100) + '%';
    if (f.t === 'checkbox' || f.t === 'radio') { e.style.width = e.style.height = 'auto'; e.style.minWidth = (f.w * 100) + '%'; }
    e.onchange = save; e.oninput = save; pg.appendChild(e); els[f.k] = e;
    if (e.getAttribute('data-fs')) px(e);
  }
  function makePage(i) {
    var pg = document.createElement('div'), img = document.createElement('img'), s = C.pages[i], j;
    pg.className = 'pg'; img.alt = 'Page ' + (i + 1); img.width = Math.round(s.w); img.height = Math.round(s.h);
    img.onload = function () { var ts = pg.querySelectorAll('[data-fs]'), j; for (j = 0; j < ts.length; j++) px(ts[j]); };
    pg.appendChild(img); box.appendChild(pg); pages.push(pg);
    for (j = 0; j < fields.length; j++) if (fields[j].p === i) field(pg, fields[j]);
    C.pageSrc(i, function (url) { if (url) img.src = url; });
    pg.onclick = function (e) {
      var tg = e.target && e.target.tagName; if (tg === 'TEXTAREA' || tg === 'INPUT' || tg === 'SELECT' || tg === 'OPTION' || tg === 'LABEL') return;
      var r = pg.getBoundingClientRect(), fs = parseFloat(sizeSel.value); if (!r.width || !r.height) return;
      var x = Math.min(0.9, Math.max(0, (e.clientX - r.left) / r.width)), y = Math.min(0.97, Math.max(0, (e.clientY - r.top) / r.height - fs * r.width * 0.7 / r.height));
      add(pg, x, y, fs, '').focus();
    };
  }
  var i;
  try { draft = JSON.parse(window.localStorage.getItem(KEY) || 'null'); } catch (e) { draft = null; }
  for (i = 0; i < C.pages.length; i++) makePage(i);
  if (draft) { nameEl.value = draft.n || ''; if (draft.i) for (i = 0; i < draft.i.length; i++) if (pages[draft.i[i].p]) add(pages[draft.i[i].p], draft.i[i].x, draft.i[i].y, draft.i[i].fs, draft.i[i].text); }
  nameEl.oninput = save;
  window.onresize = function () { var ts = box.querySelectorAll('[data-fs]'), j; for (j = 0; j < ts.length; j++) px(ts[j]); };
  send.onclick = function () {
    var n = nameEl.value.replace(/^\s+|\s+$/g, ''), it = items(), an = answers(), k, none = true;
    for (k in an) if (an.hasOwnProperty(k)) none = false;
    if (!n) { window.alert(C.t.name); nameEl.focus(); return; }
    if (!it.length && none) { window.alert(C.t.empty); return; }
    if (!window.confirm(C.t.confirm)) return;
    send.disabled = true; send.innerHTML = C.t.sending;
    C.submit({ eleve: n, items: it, answers: an }, function (err, res) {
      if (err) { window.alert(err === true ? C.t.fail : err); send.disabled = false; send.innerHTML = C.t.send; return; }
      try { window.localStorage.removeItem(KEY); } catch (e) {}
      if (C.done) return C.done(res);
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

// Outils communs aux pages chiffrées (classe à distance, épreuve en ligne) : window.SK.
const CRYPTO_JS = String.raw`window.SK = (function () {
  var T = window.SKT, main = document.getElementById('main');
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function card(cls, html) { main.className = ''; main.innerHTML = '<div class="card ' + cls + '">' + html + '</div>'; window.scrollTo(0, 0); }
  function fromB64u(s) { var b = window.atob(s.replace(/-/g, '+').replace(/_/g, '/')), a = new Uint8Array(b.length), i; for (i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  function toB64u(a) { var s = '', i; a = new Uint8Array(a); for (i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return window.btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function hex(n) { var a = new Uint8Array(n), s = '', i; window.crypto.getRandomValues(a); for (i = 0; i < n; i++) s += (a[i] < 16 ? '0' : '') + a[i].toString(16); return s; }
  function cat(list) { var n = 0, i, o = 0, out; for (i = 0; i < list.length; i++) n += list[i].length; out = new Uint8Array(n); for (i = 0; i < list.length; i++) { out.set(list[i], o); o += list[i].length; } return out; }
  var C = window.crypto, S = C && (C.subtle || C.webkitSubtle), ok = !!(S && window.Promise && window.TextEncoder && window.TextDecoder && window.Uint8Array && window.Blob && window.URL);
  var te = ok ? new window.TextEncoder() : null, td = ok ? new window.TextDecoder() : null;
  function frame(head, body) {
    var h = te.encode(JSON.stringify(head)), b = body ? new Uint8Array(body) : new Uint8Array(0), out = new Uint8Array(4 + h.length + b.length);
    out[0] = h.length >>> 24; out[1] = (h.length >>> 16) & 255; out[2] = (h.length >>> 8) & 255; out[3] = h.length & 255; out.set(h, 4); out.set(b, 4 + h.length); return out;
  }
  function unframe(buf) { var a = new Uint8Array(buf), n = ((a[0] << 24) | (a[1] << 16) | (a[2] << 8) | a[3]) >>> 0; return { head: JSON.parse(td.decode(a.subarray(4, 4 + n))), body: a.subarray(4 + n) }; }
  function linkKey() { var raw = null; try { raw = fromB64u(location.hash.replace(/^#/, '')); } catch (e) { raw = null; } return raw && raw.length === 32 ? raw : null; }
  function save(bytes, name, type) {
    var url = window.URL.createObjectURL(new window.Blob([bytes], { type: type })), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    window.setTimeout(function () { window.URL.revokeObjectURL(url); }, 60000);
  }
  function readFiles(list) {
    return Promise.all(Array.prototype.map.call(list, function (f) {
      return new Promise(function (res, rej) { var r = new window.FileReader(); r.onload = function () { res({ name: f.name, data: new Uint8Array(r.result) }); }; r.onerror = function () { rej(T.read); }; r.readAsArrayBuffer(f); });
    }));
  }
  /** Type réel d'un fichier choisi : 'pdf', 'img' (JPEG, PNG, HEIC) ou ''. */
  function magic(a) {
    if (a.length < 12) return '';
    if (a[0] === 0x25 && a[1] === 0x50 && a[2] === 0x44 && a[3] === 0x46 && a[4] === 0x2D) return 'pdf';
    if ((a[0] === 0xFF && a[1] === 0xD8 && a[2] === 0xFF) || (a[0] === 0x89 && a[1] === 0x50 && a[2] === 0x4E && a[3] === 0x47)) return 'img';
    if (a[4] === 0x66 && a[5] === 0x74 && a[6] === 0x79 && a[7] === 0x70) return 'img';
    return '';
  }
  return { T: T, main: main, esc: esc, card: card, fromB64u: fromB64u, toB64u: toB64u, hex: hex, cat: cat, S: S, C: C, ok: ok, te: te, td: td, frame: frame, unframe: unframe, linkKey: linkKey, save: save, readFiles: readFiles, magic: magic };
})();`;

// Classe à distance : la page parle au relais ; tout est chiffré avec la clé contenue dans le lien (après « # »),
// que le navigateur n'envoie jamais au relais.
const REMOTE_JS = String.raw`(function () {
  var K = window.SK, T = K.T, S = K.S, C = K.C, esc = K.esc, card = K.card, main = K.main, te = K.te;
  var api = location.pathname.replace(/\/+$/, ''), room = api.split('/').pop();
  if (!K.ok) return card('err', T.old);
  var raw = K.linkKey(); if (!raw) return card('err', T.badLink);
  var keyP = S.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  var macP = S.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  // Appel chiffré : « shared » = réponse identique pour toute la classe (document, images de pages), que le relais peut garder sans pouvoir la lire.
  function call(head, body, shared) {
    var id = K.hex(16), iv = new Uint8Array(12); C.getRandomValues(iv);
    return Promise.all([keyP, shared ? macP.then(function (m) { return S.sign('HMAC', m, te.encode('cache:' + JSON.stringify(head))); }) : null]).then(function (r) {
      var key = r[0], ck = r[1] ? K.toB64u(r[1]) : '';
      return S.encrypt({ name: 'AES-GCM', iv: iv, additionalData: te.encode('q:' + id) }, key, K.frame(head, body)).then(function (ct) {
        var msg = new Uint8Array(12 + ct.byteLength); msg.set(iv, 0); msg.set(new Uint8Array(ct), 12);
        return new Promise(function (ok, ko) {
          var x = new XMLHttpRequest(); x.open('POST', api + '/q'); x.responseType = 'arraybuffer';
          x.setRequestHeader('Content-Type', 'application/octet-stream'); x.setRequestHeader('X-Id', id); if (ck) x.setRequestHeader('X-Cache', ck);
          x.onload = function () {
            if (x.status !== 200) return ko(x.status === 503 ? T.offline : x.status === 404 || x.status === 410 ? T.ended : x.status === 413 ? T.big : x.status === 429 ? T.busy : T.net);
            var a = new Uint8Array(x.response), aad = x.getResponseHeader('X-Aad') === 'c' && ck ? 'c:' + ck : 'a:' + id;
            S.decrypt({ name: 'AES-GCM', iv: a.subarray(0, 12), additionalData: te.encode(aad) }, key, a.subarray(12)).then(function (pt) { ok(K.unframe(pt)); }, function () { ko(T.badLink); });
          };
          x.onerror = function () { ko(T.net); }; x.ontimeout = function () { ko(T.net); }; x.timeout = 120000;
          x.send(msg);
        });
      });
    });
  }
  function download(op, name, type, btn) {
    var label = btn.innerHTML; btn.disabled = true; btn.innerHTML = T.loading;
    call({ op: op }, null, true).then(function (r) { K.save(r.body, name, type); }, function (e) { window.alert(e); }).then(function () { btn.disabled = false; btn.innerHTML = label; });
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
      K.readFiles(fl).then(function (files) {
        var meta = [], j; for (j = 0; j < files.length; j++) meta.push({ name: files[j].name, size: files[j].data.length });
        return call({ op: 'files', eleve: n, files: meta }, K.cat(files.map(function (f) { return f.data; })), false);
      }).then(function (r) {
        if (!r.head.ok) throw r.head.error || T.net;
        card('ok', '<h2>✅ Copie reçue</h2><p>' + T.thanks + '</p><p>🔒 ' + T.lockedNow + '</p>');
      }).then(null, function (e) { window.alert(e); btn.disabled = false; btn.innerHTML = '📤 Envoyer ma copie'; });
    };
  }
  function fill(info) {
    main.className = 'wide'; main.innerHTML = T.fillBody; window.scrollTo(0, 0);
    document.getElementById('skBack').onclick = function (e) { e.preventDefault(); home(info); };
    window.SKFILL({ key: room, pages: info.pages, fields: info.fields || [], t: T.fill,
      pageSrc: function (i, cb) { call({ op: 'page', i: i }, null, true).then(function (r) { cb(window.URL.createObjectURL(new window.Blob([r.body], { type: 'image/jpeg' }))); }, function () { cb(null); }); },
      submit: function (copie, cb) { call({ op: 'fill', eleve: copie.eleve, items: copie.items, answers: copie.answers }, null, false).then(function (r) { cb(r.head.ok ? null : (r.head.error || true)); }, function (e) { cb(e || true); }); } });
  }
  card('', '<p class="muted">' + T.loading + '</p>');
  call({ op: 'info' }, null, true).then(function (r) { if (!r.head.ok) throw r.head.error || T.ended; home(r.head); }).then(null, function (e) { card('err', esc(e)); });
})();`;

// Épreuve en ligne : l'épreuve est déposée, chiffrée, sur le service jusqu'à la date limite (le PC de l'enseignant peut
// être éteint). La page lit les morceaux chiffrés (clé du lien, après « # ») et dépose la copie chiffrée pour
// l'enseignant seul : clé éphémère P-256 + clé publique de l'enseignant (ECDH) → SHA-256 → AES-256-GCM.
const EXAM_JS = String.raw`(function () {
  var K = window.SK, T = K.T, S = K.S, C = K.C, esc = K.esc, card = K.card, main = K.main, te = K.te;
  var api = location.pathname.replace(/\/+$/, ''), id = api.split('/').pop();
  if (!K.ok) return card('err', T.old);
  var raw = K.linkKey(); if (!raw) return card('err', T.badLink);
  var keyP = S.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
  function xhr(method, url, body, headers, type) {
    return new Promise(function (ok, ko) {
      var x = new XMLHttpRequest(), h; x.open(method, url); x.responseType = type || 'arraybuffer'; x.timeout = 180000;
      for (h in headers) if (headers.hasOwnProperty(h)) x.setRequestHeader(h, headers[h]);
      x.onload = function () { ok(x); }; x.onerror = function () { ko(T.net); }; x.ontimeout = function () { ko(T.net); };
      x.send(body || null);
    });
  }
  function errOf(s) { return s === 404 || s === 410 ? T.ended : s === 413 ? T.big : s === 429 ? T.busy : s === 507 ? T.full : T.net; }
  function blob(name) {
    return xhr('GET', api + '/b/' + name).then(function (x) {
      if (x.status !== 200) throw errOf(x.status);
      var a = new Uint8Array(x.response);
      return keyP.then(function (k) { return S.decrypt({ name: 'AES-GCM', iv: a.subarray(0, 12), additionalData: te.encode('e:' + id + ':' + name) }, k, a.subarray(12)); })
        .then(function (pt) { return new Uint8Array(pt); }, function () { throw T.badLink; });
    });
  }
  function parts(prefix, n) { var l = [], i; for (i = 0; i < n; i++) l.push(blob(prefix + '.' + i)); return Promise.all(l).then(K.cat); }
  function when(ms) { try { return new Date(ms).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return new Date(ms).toString(); } }
  // Copie chiffrée pour l'enseignant seul, puis déposée sur le service.
  function send(info, head, body) {
    var cid = K.hex(16), iv = new Uint8Array(12), curve = { name: 'ECDH', namedCurve: 'P-256' }, ephRaw;
    C.getRandomValues(iv);
    return Promise.all([S.importKey('raw', K.fromB64u(info.pub), curve, false, []), S.generateKey(curve, true, ['deriveBits'])]).then(function (r) {
      return Promise.all([S.deriveBits({ name: 'ECDH', public: r[0] }, r[1].privateKey, 256), S.exportKey('raw', r[1].publicKey)]);
    }).then(function (r) {
      ephRaw = new Uint8Array(r[1]);
      return S.digest('SHA-256', K.cat([te.encode('sknedu-copie-v1'), new Uint8Array(r[0]), ephRaw]));
    }).then(function (d) { return S.importKey('raw', d, { name: 'AES-GCM' }, false, ['encrypt']); })
      .then(function (k) { return S.encrypt({ name: 'AES-GCM', iv: iv, additionalData: te.encode('c:' + id + ':' + cid) }, k, K.frame(head, body)); })
      .then(function (ct) { return xhr('POST', api + '/c', K.cat([new Uint8Array([1]), ephRaw, iv, new Uint8Array(ct)]), { 'Content-Type': 'application/octet-stream', 'X-Id': cid }, 'text'); })
      .then(function (x) {
        var r = {}; try { r = JSON.parse(x.responseText); } catch (e) {}
        if (x.status !== 200 || !r.ok) throw r.error || errOf(x.status);
        return { at: r.at, ref: cid.slice(0, 8).toUpperCase() };
      });
  }
  function receipt(r) { card('ok', '<h2>✅ ' + T.received + '</h2><p>' + T.receivedAt + ' <b>' + esc(when(r.at)) + '</b>.</p><p>' + T.ref + ' <b>' + esc(r.ref) + '</b></p><p>🔒 ' + T.lockedNow + '</p>'); }
  function download(prefix, n, name, type, btn) {
    var label = btn.innerHTML; btn.disabled = true; btn.innerHTML = T.loading;
    parts(prefix, n).then(function (b) { K.save(b, name, type); }, function (e) { window.alert(e); }).then(function () { btn.disabled = false; btn.innerHTML = label; });
  }
  function home(info) {
    var h = '<div class="card"><h2>' + esc(info.title) + '</h2><p>' + esc(info.message || T.defMsg) + '</p><p class="due">⏰ ' + T.due + ' <b>' + esc(when(info.deadline)) + '</b></p>'
      + (info.fill ? '<button id="bFill">✏️ Répondre en ligne</button>' : '') + '<button id="bPdf"' + (info.fill ? ' class="alt"' : '') + '>📥 Sujet en PDF</button>'
      + (info.word ? '<button id="bDocx" class="alt">📥 Sujet en Word (.docx)</button>' : '') + (info.fill ? '<p class="muted">' + T.fillHint + '</p>' : '') + '</div>'
      + '<div class="card"><h3>' + T.sendTitle + '</h3><label>Nom et prénom<input id="rEleve" maxlength="80" autocomplete="name"></label>'
      + '<label>' + (info.photos ? T.filesLabel : T.pdfLabel) + '<input type="file" id="rFiles" accept="' + (info.photos ? 'application/pdf,.pdf,image/*' : 'application/pdf,.pdf') + '" multiple></label>'
      + '<button id="rSend">📤 Envoyer ma copie</button><p class="muted">🔒 ' + T.lockNote + '</p></div><p class="muted">🔐 ' + T.e2eExam + '</p>';
    main.className = ''; main.innerHTML = h;
    var base = (info.fileName || 'epreuve.pdf').replace(/\.pdf$/i, '');
    document.getElementById('bPdf').onclick = function () { download('pdf', info.pdfParts, base + '.pdf', 'application/pdf', this); };
    if (info.word) document.getElementById('bDocx').onclick = function () { download('docx', info.docxParts, base + '.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', this); };
    if (info.fill) document.getElementById('bFill').onclick = function () { fill(info); };
    document.getElementById('rSend').onclick = function () {
      var btn = this, n = document.getElementById('rEleve').value.replace(/^\s+|\s+$/g, ''), fl = document.getElementById('rFiles').files, total = 0, i;
      if (!n || !fl || !fl.length) return window.alert(info.photos ? T.need : T.needPdf);
      for (i = 0; i < fl.length; i++) total += fl[i].size;
      if (total > info.maxUpload) return window.alert(T.big);
      if (fl.length > 20) return window.alert(T.tooMany);
      btn.disabled = true; btn.innerHTML = T.sending;
      K.readFiles(fl).then(function (files) {
        var meta = [], j, m;
        for (j = 0; j < files.length; j++) { m = K.magic(files[j].data); if (m !== 'pdf' && !(m === 'img' && info.photos)) throw (info.photos ? T.badFile : T.onlyPdf) + ' (' + files[j].name + ')'; meta.push({ name: files[j].name, size: files[j].data.length }); }
        if (!window.confirm(T.fill.confirm)) throw '';
        return send(info, { kind: 'files', eleve: n, files: meta }, K.cat(files.map(function (f) { return f.data; })));
      }).then(receipt).then(null, function (e) { if (e) window.alert(e); btn.disabled = false; btn.innerHTML = '📤 Envoyer ma copie'; });
    };
  }
  function fill(info) {
    main.className = 'wide'; main.innerHTML = T.fillBody; window.scrollTo(0, 0);
    document.getElementById('skBack').onclick = function (e) { e.preventDefault(); home(info); };
    window.SKFILL({ key: id, pages: info.pages, fields: info.fields || [], t: T.fill,
      pageSrc: function (i, cb) { blob('p' + i).then(function (b) { cb(window.URL.createObjectURL(new window.Blob([b], { type: 'image/jpeg' }))); }, function () { cb(null); }); },
      submit: function (copie, cb) { send(info, { kind: 'fill', eleve: copie.eleve, items: copie.items, answers: copie.answers }, null).then(function (r) { cb(null, r); }, function (e) { cb(e || true); }); },
      done: receipt });
  }
  card('', '<p class="muted">' + T.loading + '</p>');
  xhr('GET', api + '/s', null, {}, 'text').then(function (x) {
    var st = {}; try { st = JSON.parse(x.responseText); } catch (e) {}
    if (x.status !== 200) throw errOf(x.status);
    if (!st.open) throw T.notYet;
    if (st.closed) throw T.closedAt + ' ' + when(st.deadline) + '.';
    return blob('info').then(function (b) { var info = JSON.parse(K.td.decode(b)); info.deadline = st.deadline; home(info); });
  }).then(null, function (e) { card('err', esc(e)); });
})();`;

const COMMON_TEXT = {
  old: 'Ce navigateur est trop ancien pour ouvrir ce lien en toute sécurité : mettez-le à jour, ou utilisez un autre navigateur.',
  badLink: 'Lien incomplet ou incorrect : ouvrez le lien entier envoyé par votre enseignant (ou scannez à nouveau le QR code).',
  big: 'Fichiers trop volumineux (25 Mo au plus pour une copie envoyée par Internet).', busy: 'Beaucoup de demandes en ce moment : réessayez dans un instant.',
  net: 'Connexion impossible : vérifiez votre connexion Internet, puis réessayez.', read: 'Un fichier n\'a pas pu être lu : choisissez-le à nouveau.',
  loading: 'Chargement…', sending: 'Envoi en cours…', defMsg: 'Complétez le document, puis rendez votre copie.',
  lockNote: 'Votre copie est enregistrée en PDF verrouillé : après l\'envoi, elle ne peut plus être modifiée.',
  need: 'Indiquez votre nom et choisissez un fichier PDF ou des photos de votre copie.',
  lockedNow: 'Elle est verrouillée : elle ne peut plus être modifiée.',
  fill: FILL_TEXT, fillBody: fillBody('<a href="#" id="skBack">Retour</a>')
};
const REMOTE_TEXT = { ...COMMON_TEXT,
  offline: 'L\'enseignant n\'est pas connecté pour l\'instant : réessayez dans quelques minutes.', ended: 'Ce partage est terminé.',
  fillHint: '« Remplir en ligne » : écrivez vos réponses directement sur le document, sans rien installer.',
  thanks: 'Votre copie a bien été transmise.',
  e2e: 'Document et copie chiffrés de bout en bout : seuls vous et votre enseignant pouvez les lire.' };
const EXAM_TEXT = { ...COMMON_TEXT,
  ended: 'Cette épreuve est terminée ou n\'existe plus.', notYet: 'Cette épreuve n\'est pas encore disponible : réessayez dans quelques minutes.',
  closedAt: 'Cette épreuve est terminée : la date limite était le', due: 'À rendre avant le',
  full: 'Le dépôt des copies est momentanément impossible : réessayez plus tard, ou prévenez votre enseignant.',
  fillHint: '« Répondre en ligne » : écrivez directement sur le sujet, dans tout navigateur, sans rien installer. Votre brouillon reste sur cet appareil jusqu\'à l\'envoi.',
  sendTitle: 'Ou envoyer ma copie en fichier', filesLabel: 'Copie (PDF, ou photos de la copie papier)', pdfLabel: 'Copie (fichier PDF)',
  needPdf: 'Indiquez votre nom et choisissez le fichier PDF de votre copie.', onlyPdf: 'Cette épreuve n\'accepte que des fichiers PDF', badFile: 'Fichier non pris en charge : choisissez un PDF ou une photo',
  tooMany: '20 fichiers au plus.', received: 'Copie déposée', receivedAt: 'Votre copie a été déposée le', ref: 'Numéro de dépôt :',
  e2eExam: 'Sujet et copie chiffrés de bout en bout : le service qui les transporte ne peut pas les lire, et seul votre enseignant peut ouvrir votre copie.' };

const jsonForScript = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
/** Page de la classe à distance : aucun contenu de la classe, seulement le programme qui le déchiffre dans le navigateur. */
function remoteShell() {
  return page('Classe connectée', `<div class="card"><p class="muted">Chargement…</p><noscript>Activez JavaScript pour ouvrir ce document.</noscript></div>
    <script>window.SKT = ${jsonForScript(REMOTE_TEXT)};</script><script>${FILL_JS}</script><script>${CRYPTO_JS}</script><script>${REMOTE_JS}</script>`);
}
/** Page de l'épreuve en ligne : idem, le sujet et les copies restent chiffrés de bout en bout. */
function examShell() {
  return page('Épreuve en ligne', `<div class="card"><p class="muted">Chargement…</p><noscript>Activez JavaScript pour ouvrir cette épreuve.</noscript></div>
    <script>window.SKT = ${jsonForScript(EXAM_TEXT)};</script><script>${FILL_JS}</script><script>${CRYPTO_JS}</script><script>${EXAM_JS}</script>`, false, 'épreuve en ligne');
}

module.exports = { esc, page, FILL_JS, LAN_JS, FILL_TEXT, fillBody, jsonForScript, remoteShell, examShell };
