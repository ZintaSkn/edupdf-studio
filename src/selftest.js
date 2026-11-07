// Auto-test : EDUPDF_SELFTEST=<dossier de sortie> electron .
const fs = require('fs');
const path = require('path');
module.exports = (win, outDir) => {
  const logFile = path.join(outDir, 'selftest.log');
  fs.writeFileSync(logFile, '');
  const log = (...a) => fs.appendFileSync(logFile, a.join(' ') + '\n');
  const timeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + what)), ms))]);
  setTimeout(() => { log('GLOBAL TIMEOUT'); process.exit(1); }, 300000);
  win.webContents.on('console-message', (_e, level, m) => { if (level >= 2) log('[renderer]', m); });
  // fichiers d'essai pour les formats « tous fichiers »
  fs.writeFileSync(path.join(outDir, 't.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#def"/><text x="20" y="100" font-size="30">SVG Leçon</text></svg>');
  fs.writeFileSync(path.join(outDir, 't.html'), '<!doctype html><meta charset="utf-8"><h1 style="color:#1f3b73">Fiche HTML</h1><p>Énoncé de l\'exercice.</p>');
  fs.writeFileSync(path.join(outDir, 'notes'), 'Fichier sans extension : texte brut.');
  win.webContents.once('did-finish-load', async () => {
    const js = (code) => win.webContents.executeJavaScript(code);
    const results = {};
    const step = async (name, code, ms = 60000) => {
      try { results[name] = await timeout(js(code), ms, name); log('OK  ', name, JSON.stringify(results[name]).slice(0, 600)); }
      catch (e) { results[name] = { error: e.message }; log('FAIL', name, e.message); }
    };
    try {
      await step('unicode+fonts', `(async () => {
        const T = window.__edupdf; window.__start = T.S.pages.length;
        await T.insertPdf(await T.textToPdf('Leçon 1 : Les fractions — π ≈ 3,14 ; √2 ≤ ∞'));
        await T.insertPdf(await T.blankPdf());
        T.S.pages[1].rot = 90;
        const txt = 'Évaluation – Ωμέγα ∑ 数学 ߒߞߏ';
        T.S.pages[0].items.push({ type:'text', at:[60,700], size:18, color:'#cc0000', font:{ family:'Times New Roman', bold:true }, text: txt });
        T.S.pages[0].items.push({ type:'field', kind:'text', rect:[60,560,300,584], name:'nom' });
        T.S.pages[0].items.push({ type:'field', kind:'check', rect:[320,560,334,574], name:'ok' });
        T.S.pages[1].items.push({ type:'ink', points:[[100,100],[200,150],[250,300]], color:'#0000ff', width:3 });
        await T.actions.numbers();
        const bytes = await T.buildPdf(); window.__built = bytes;
        const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
        const p1 = await doc.getPage(1); const text = (await p1.getTextContent()).items.map(i => i.str).join('|');
        const lib = await PDFLib.PDFDocument.load(bytes);
        const all = []; for (let i = 1; i <= doc.numPages; i++) all.push((await (await doc.getPage(i)).getTextContent()).items.map(i => i.str).join('|').slice(0, 160)); return { all, startPages: window.__start, pages: doc.numPages, hasUnicode: text.includes('Ωμέγα') && text.includes('数学') && text.includes('√2'), nko: text.includes('ߒߞߏ'), noQuestion: !text.includes('?'), fields: lib.getForm().getFields().map(f => f.getName()), rot2: (await doc.getPage(2)).rotate, size: bytes.length };
      })()`, 90000);
      fs.writeFileSync(path.join(outDir, 'unicode.pdf'), Buffer.from(await js('Array.from(window.__built)')));

      await step('encrypt+unlock', `(async () => {
        const enc = await window.api.encryptPdf(window.__built, { userPassword: 'abc', ownerPassword: 'prof', permissions: { print: true } });
        window.__enc = enc;
        let needs = false; try { await pdfjsLib.getDocument({ data: enc.slice() }).promise; } catch (e) { needs = e.name === 'PasswordException'; }
        const bad = await window.api.unlockPdf(enc, 'zzz'); const good = await window.api.unlockPdf(enc, 'abc');
        const d = await pdfjsLib.getDocument({ data: good.bytes.slice() }).promise;
        return { needsPassword: needs, badRejected: !bad.ok, unlocked: good.ok, pages: d.numPages };
      })()`);
      fs.writeFileSync(path.join(outDir, 'protege-abc.pdf'), Buffer.from(await js('Array.from(window.__enc)')));

      await step('open-locked-with-dialog', `(async () => {
        const T = window.__edupdf; T.actions.close && (T.S.dirty = false);
        const files = await window.api.loadPaths([${JSON.stringify(path.join(outDir, 'protege-abc.pdf'))}]);
        const locked = files[0].locked;
        const p = T.handleLoaded(files, 0);
        for (let i = 0; i < 50 && document.querySelector('#modal').hidden; i++) await new Promise(r => setTimeout(r, 50));
        document.querySelector('#pw').value = 'abc'; document.querySelector('#mBtns .primary').click();
        await p;
        return { locked, pagesNow: T.S.pages.length, protect: !!T.S.protect, msg: document.querySelector('#msg').textContent.slice(0, 120) };
      })()`);

      await step('restrictions-only', `(async () => {
        const enc = await window.api.encryptPdf(window.__built, { ownerPassword: 'prof', permissions: { print: true } });
        const fsPath = ${JSON.stringify(path.join(outDir, 'restreint.pdf'))};
        await window.api.save({ bytes: enc, filePath: fsPath });
        const f = (await window.api.loadPaths([fsPath]))[0];
        const lib = await PDFLib.PDFDocument.load(f.bytes);
        return { locked: !!f.locked, note: f.note, editableByPdfLib: !lib.isEncrypted };
      })()`);

      await step('fill-existing-form', `(async () => {
        const T = window.__edupdf;
        const d = await PDFLib.PDFDocument.create(); const pg = d.addPage([400, 300]); const form = d.getForm();
        form.createTextField('eleve').addToPage(pg, { x: 40, y: 200, width: 200, height: 24 });
        form.createCheckBox('presence').addToPage(pg, { x: 40, y: 150, width: 16, height: 16 });
        const bytes = await d.save();
        T.S.dirty = false; T.actions.close();
        await T.insertPdf(bytes); T.setTool('select'); T.refresh();
        for (let i = 0; i < 60 && !document.querySelector('#formLayer .fw[title=eleve]'); i++) await new Promise(r => setTimeout(r, 50));
        const inputs = [...document.querySelectorAll('#formLayer .fw')];
        const tx = inputs.find(e => e.tagName === 'INPUT' && e.type !== 'checkbox'); const cb = inputs.find(e => e.type === 'checkbox');
        tx.value = 'Aïcha Koné'; tx.dispatchEvent(new Event('change')); cb.checked = true; cb.dispatchEvent(new Event('change'));
        const out = await T.buildPdf(); const lib = await PDFLib.PDFDocument.load(out); const f = lib.getForm();
        return { inputs: inputs.length, forms: T.S.pages[0].forms, value: f.getTextField('eleve').getText() || null, checked: f.getCheckBox('presence').isChecked(), acro: lib.catalog.lookup(PDFLib.PDFName.of('AcroForm')) ? String(lib.catalog.lookup(PDFLib.PDFName.of('AcroForm'))).slice(0,300) : null, ids: (await (await T.getPdfPage(T.S.pages[0])).getAnnotations()).map(a => a.id + ':' + a.fieldName) };
      })()`);

      await step('font-detection+edit', `(async () => {
        const T = window.__edupdf;
        const d = await PDFLib.PDFDocument.create(); const pg = d.addPage([400, 300]);
        pg.drawRectangle({ x: 0, y: 0, width: 400, height: 300, color: PDFLib.rgb(1, 0.95, 0.8) });
        pg.drawText('Texte original', { x: 40, y: 200, size: 20, font: await d.embedFont(PDFLib.StandardFonts.TimesRomanBold), color: PDFLib.rgb(0.8, 0, 0) });
        T.S.dirty = false; T.actions.close();
        await T.insertPdf(await d.save()); T.setTool('edit'); T.refresh();
        for (let i = 0; i < 60 && !document.querySelector('#textLayer .tl'); i++) await new Promise(r => setTimeout(r, 50));
        const sp = document.querySelector('#textLayer .tl'); sp.click();
        sp.innerText = 'Texte corrigé'; sp.blur();
        const items = T.S.pages[0].items;
        const t = items.find(o => o.type === 'text'), w = items.find(o => o.kind === 'whiteout');
        return { font: t && t.font, color: t && t.color, size: t && t.size, bg: w && w.color };
      })()`);

      await step('scan-copy+ocr', `(async () => {
        const T = window.__edupdf; window.confirm = () => true;
        T.S.cur = 0; T.S.sel = new Set([0]);
        await T.actions.scanCopy();
        const p = T.S.pages[0];
        return { ocrLines: p.ocr ? p.ocr.lines.map(l => l.text) : null, itemsKept: p.items.length };
      })()`, 120000);

      await step('compare', `(async () => {
        const T = window.__edupdf;
        const r = T.diffWords('le chat noir dort ici'.split(' '), 'le chat blanc dort'.split(' '));
        return { a: Array.from(r.aMark), b: Array.from(r.bMark) };
      })()`);

      await step('formats', `(async () => {
        const files = await window.api.loadPaths([${JSON.stringify(path.join(outDir, 't.svg'))}, ${JSON.stringify(path.join(outDir, 't.html'))}, ${JSON.stringify(path.join(outDir, 'notes'))}]);
        const out = [];
        for (const f of files) {
          if (f.error) { out.push(f.name + ': ' + f.error); continue; }
          if (f.kind === 'text') { out.push(f.name + ': texte ' + f.text.length); continue; }
          const d = await pdfjsLib.getDocument({ data: new Uint8Array(f.bytes) }).promise;
          const t = (await (await d.getPage(1)).getTextContent()).items.map(i => i.str).join(' ');
          out.push(f.name + ': ' + d.numPages + ' p. « ' + t.slice(0, 40) + ' »');
        }
        return out;
      })()`, 60000);

      await new Promise((res) => setTimeout(res, 800));
      fs.writeFileSync(path.join(outDir, 'ui.png'), (await win.webContents.capturePage()).toPNG());
      log(Object.values(results).some((r) => r && r.error) ? 'DONE WITH FAILURES' : 'ALL OK');
    } catch (e) {
      log('ECHEC', e.stack || e.message);
    }
    setTimeout(() => process.exit(0), 300);
  });
};
