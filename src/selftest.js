// Auto-test : EDUPDF_SELFTEST=<dossier de sortie> electron .
const fs = require('fs');
const path = require('path');
module.exports = (win, outDir) => {
  const logFile = path.join(outDir, 'selftest.log');
  fs.writeFileSync(logFile, '');
  const log = (...a) => fs.appendFileSync(logFile, a.join(' ') + '\n');
  const timeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + what)), ms))]);
  setTimeout(() => { log('GLOBAL TIMEOUT'); process.exit(1); }, 200000);
  win.webContents.on('console-message', (_e, level, m) => { log('[renderer]', m); });
  win.webContents.once('did-finish-load', async () => {
    const js = (code) => win.webContents.executeJavaScript(code);
    try {
      log('load ok');
      const a = await timeout(js(`(async () => {
        const T = window.__edupdf, out = {};
        console.log('s1'); const tp = await T.textToPdf('Leçon 1 : Les fractions\\nÉcrire 3/4 sous forme décimale.'); console.log('s2'); await T.insertPdf(tp); console.log('s3');
        await T.insertPdf(await T.blankPdf());
        T.S.pages[1].rot = 90;
        T.S.pages[0].items.push({ type:'text', at:[60,700], size:18, color:'#cc0000', text:'Évaluation – Classe de 5e' });
        T.S.pages[0].items.push({ type:'rect', kind:'highlight', rect:[50,760,300,790], color:'#ffe600' });
        T.S.pages[1].items.push({ type:'ink', points:[[100,100],[200,150],[250,300]], color:'#0000ff', width:3 });
        T.S.cur = 0; T.refresh();
        console.log('s4'); await T.actions.numbers(); console.log('s5');
        const bytes = await T.buildPdf(); console.log('s6 ' + bytes.length);
        const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise; console.log('s7');
        out.pages = doc.numPages;
        const p1 = await doc.getPage(1); out.text1 = (await p1.getTextContent()).items.map(i => i.str).join(' | ');
        console.log('s8'); out.rot2 = (await doc.getPage(2)).rotate; console.log('s9');
        const vp = p1.getViewport({ scale: 2.5 }); const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
        await p1.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        console.log('s10'); window.__ocrImg = c.toDataURL('image/png'); console.log('s11');
        return { out, pdf: Array.from(bytes) };
      })()`), 30000, 'build');
      log('build', JSON.stringify(a.out));
      fs.writeFileSync(path.join(outDir, 'selftest.pdf'), Buffer.from(a.pdf));
      const b = await timeout(js(`(async () => { const t0 = Date.now(); const o = await window.api.ocr(window.__ocrImg, 'fra+eng'); return { ms: Date.now() - t0, words: o.words.length, text: o.text.trim().slice(0, 200) }; })()`), 150000, 'ocr');
      log('ocr', JSON.stringify(b));
      await new Promise((res) => setTimeout(res, 1000));
      fs.writeFileSync(path.join(outDir, 'ui.png'), (await win.webContents.capturePage()).toPNG());
      log('OK');
    } catch (e) {
      log('ECHEC', e.message);
      fs.writeFileSync(path.join(outDir, 'ui.png'), (await win.webContents.capturePage()).toPNG());
    }
    setTimeout(() => process.exit(0), 300);
  });
};

