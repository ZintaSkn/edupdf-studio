// Captures d'écran du guide d'utilisation (docs/guide) — lancé par l'auto-test quand EDUPDF_CAPTURES est défini :
//   $env:EDUPDF_SELFTEST = 'C:\dossier-vide'; $env:EDUPDF_CAPTURES = '1'; node_modules\electron\dist\electron.exe .
// Données isolées (dossier de test) ; les images sont écrites dans <dossier>\captures.
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async function captures(win, js, outDir) {
  const dir = path.join(outDir, 'captures'); fs.mkdirSync(dir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const done = [];
  const shot = async (name, rect) => { await wait(450); const img = await win.webContents.capturePage(rect); fs.writeFileSync(path.join(dir, name + '.png'), img.toPNG()); done.push(name); };
  const rectOf = async (sel, pad = 0) => js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.max(0, Math.round(r.left) - ${pad}), y: Math.max(0, Math.round(r.top) - ${pad}), width: Math.round(r.width) + ${2 * pad}, height: Math.round(r.height) + ${2 * pad} }; })()`);
  const closeModal = () => js(`(async () => { for (let i = 0; i < 4 && !document.querySelector('#modal').hidden; i++) { const bs = [...document.querySelectorAll('#mBtns button')]; (bs.find((b) => /^(Annuler|Fermer|Plus tard|Non|Cancel|Close)/i.test(b.textContent.trim())) || bs[0]).click(); await new Promise((r) => setTimeout(r, 250)); } })()`);
  const modalShot = async (name, code) => { await js(`(() => { ${code}; return true; })()`); await wait(900); if (!(await js('!document.querySelector("#modal").hidden'))) return; await shot(name, await rectOf('#modal .mbox', 14)); await closeModal(); };

  win.setContentSize(1440, 900); win.center(); await wait(800);
  await js(`window.__features && window.__features.setLanguage('fr')`);
  await shot('01-accueil');

  // Document d'exemple : une fiche d'exercices de mathématiques sur 3 pages
  await js(`(async () => {
    const T = window.__edupdf;
    const txt = 'Classe de 5e — Mathématiques                                  Nom : ......................\\n\\nLEÇON 3 : LES FRACTIONS\\n\\nUne fraction représente une partie d\\'un tout. Dans 3/4, 3 est le numérateur et 4 le dénominateur.\\nPour additionner deux fractions de même dénominateur, on additionne les numérateurs.\\n\\nExercice 1 — Calculer :\\n   a) 1/4 + 2/4 = ...........        b) 3/7 + 2/7 = ...........        c) 5/9 - 2/9 = ...........\\n\\nExercice 2 — Simplifier :\\n   a) 6/8 = ...........        b) 10/15 = ...........        c) 12/18 = ...........\\n\\nExercice 3 — Problème :\\n   Awa a mangé 2/8 d\\'une pizza et Koffi 3/8. Quelle fraction de la pizza ont-ils mangée ensemble ?\\n   ...................................................................................................\\n\\nExercice 4 — Comparer (<, > ou =) :\\n   a) 3/5 ..... 4/5        b) 2/3 ..... 2/6        c) 7/7 ..... 1';
    await T.insertPdf(await T.textToPdf(txt)); await T.insertPdf(await T.textToPdf('Exercice 5 — Placer sur une droite graduée : 1/2, 3/4, 5/4.\\n\\nExercice 6 — Vrai ou faux ?\\n   a) 2/4 = 1/2        b) 3/9 = 1/4        c) 8/8 = 1')); await T.insertPdf(await T.textToPdf('Corrigé — réservé à l\\'enseignant'));
    T.S.fileName = 'Fractions - fiche 5e.pdf'; T.S.cur = 0; T.S.sel = new Set([0]); T.refresh(); return true;
  })()`);
  await wait(1500);
  await shot('02-document');

  // Onglets du ruban
  const tabs = ['accueil', 'fichier', 'creer', 'modifier', 'pages', 'ocr', 'convertir', 'outils', 'classe', 'ia', 'aide'];
  for (const t of tabs) {
    await js(`document.querySelector('#tabs [data-tab="${t}"]').click()`); await wait(350);
    await shot('ruban-' + t, await rectOf('header'));
  }
  await js(`document.querySelector('#tabs [data-tab="classe"]').click()`);

  // Copie corrigée : surlignage, tampons, note
  await js(`(async () => {
    const T = window.__edupdf; const TE = window.__teacher; const q = (s) => document.querySelector(s); const w = (ms) => new Promise((r) => setTimeout(r, ms));
    const ov = q('#overlayLayer'); const r = ov.getBoundingClientRect(); const ev = (type, x, y) => ov.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: r.left + x, clientY: r.top + y }));
    TE.setStamp('Très bien', '#1e8e3e'); T.setTool('stamp'); ev('pointerdown', r.width * 0.72, r.height * 0.40); await w(400);
    TE.setStamp('✔', '#1e8e3e'); ev('pointerdown', r.width * 0.86, r.height * 0.32); await w(400);
    T.setTool('ellipse'); ev('pointerdown', r.width * 0.12, r.height * 0.555); ev('pointermove', r.width * 0.55, r.height * 0.6); ev('pointerup', r.width * 0.55, r.height * 0.6); await w(300);
    T.setTool('mark'); ev('pointerdown', r.width * 0.86, r.height * 0.05); await w(500);
    q('#mkNote').value = '16,5'; q('#mkSur').value = '20'; q('#mkAppr').value = 'Très bien'; q('#mBtns button.primary').click(); await w(500);
    T.setTool('select'); return true;
  })()`);
  await wait(800);
  await shot('03-copie-corrigee');

  // Fenêtres principales
  await modalShot('10-noter', `window.placeMark && (window.__edupdf.setTool('mark'), window.placeMark([300, 300]))`);
  await js(`window.__edupdf.setTool('select')`);
  await modalShot('11-releve-notes', `window.__teacher.marksSummary()`);
  await modalShot('12-tampons', `window.__edupdf.actions.stamps()`);
  await modalShot('13-impression', `window.__edupdf.actions.print()`);
  await modalShot('14-en-tete-pied', `window.__edupdf.actions.headerFooter()`);
  await modalShot('15-preferences', `window.__edupdf.actions.prefs()`);
  await modalShot('16-correction-copies', `window.__edupdf.actions.grading()`);
  await modalShot('17-filigrane', `window.__edupdf.actions.watermark()`);
  await modalShot('18-proteger', `window.__edupdf.actions.protect()`);
  await modalShot('19-licence', `window.__edupdf.actions.license()`);
  await modalShot('20-obtenir-licence', `window.__edupdf.actions.buyLicence()`);
  await modalShot('21-reglages-ia', `window.__edupdf.actions.aiSettings()`);
  await modalShot('22-equation', `window.__edupdf.actions.equation()`);
  await modalShot('23-publipostage', `window.__edupdf.actions.mailMerge()`);
  await modalShot('24-evaluations-differenciees', `window.__edupdf.actions.diffEval()`);

  // Panneaux et modes d'affichage
  await js(`window.__edupdf.toggleAi && 0; window.__edupdf.actions.aiPanel()`); await wait(600); await shot('30-assistant-ia'); await js(`window.__edupdf.actions.aiPanel()`);
  await js(`window.__edupdf.actions.find()`); await wait(300); await js(`(() => { const i = document.querySelector('#findText'); i.value = 'fraction'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`); await wait(800);
  await shot('31-rechercher'); await js(`document.querySelector('#findClose').click()`);
  // barres latérales fixées le temps des captures (elles se masquent seules d'ordinaire)
  await js(`(() => { if (document.querySelector('#sbMode') && !/fix/i.test(document.body.className + localStorage.getItem('edupdf.sidebars'))) document.querySelector('#sbMode').click(); document.body.classList.add('peek-all'); document.querySelectorAll('#leftBar, #side').forEach((e) => e.classList.add('peek')); })()`); await wait(500);
  await js(`window.__edupdf.actions.dupPages && 0; (document.querySelector('#sideSwitch [data-side="pages"]') || {}).click && document.querySelector('#sideSwitch [data-side="pages"]').click()`); await wait(1200); await shot('32-miniatures-proprietes');
  await js(`document.querySelector('#sideSwitch [data-side="home"]').click()`); await wait(800); await shot('33-panneau-accueil');
  await js(`window.__edupdf.startShow(false)`); await wait(1500); await shot('34-diaporama'); await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await wait(600);
  await js(`window.__features.setLanguage('en')`); await wait(700); await shot('35-interface-anglais'); await js(`window.__features.setLanguage('fr')`); await wait(500);
  await shot('36-barre-etat', await rectOf('footer'));
  // Contenu du ruban tel qu'affiché (icône, libellé, info-bulle) et panneau Accueil, pour les tableaux du guide
  const ruban = await js(`(() => {
    const o = {};
    document.querySelectorAll('#ribbon .panel').forEach((p) => {
      o[p.dataset.panel] = [...p.querySelectorAll('button')].map((b) => ({
        icon: (b.querySelector('i') || {}).textContent || '',
        label: [...b.childNodes].filter((n) => n.nodeType === 3 || n.tagName === 'BR').map((n) => n.textContent || ' ').join('').replace(/\\s+/g, ' ').trim(),
        title: b.title || '', act: b.dataset.act || '', tool: b.dataset.tool || '', ai: b.dataset.ai || '',
        premium: !!(window.__licensing && ((b.dataset.act && window.__licensing.PREMIUM_ACTS[b.dataset.act]) || (b.dataset.tool && window.__licensing.PREMIUM_TOOLS[b.dataset.tool]) || b.dataset.ai))
      }));
    });
    o.__accueil = [...document.querySelectorAll('#homeSide [title]')].map((b) => ({ text: b.textContent.replace(/\\s+/g, ' ').trim().slice(0, 80), title: b.title }));
    return o;
  })()`);
  fs.writeFileSync(path.join(dir, 'ruban.json'), JSON.stringify(ruban, null, 1));
  return done;
};
