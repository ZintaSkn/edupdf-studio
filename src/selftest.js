// Auto-test : EDUPDF_SELFTEST=<dossier de sortie> electron .
const fs = require('fs');
const path = require('path');
module.exports = (win, outDir) => {
  const logFile = path.join(outDir, 'selftest.log');
  fs.writeFileSync(logFile, '');
  const log = (...a) => fs.appendFileSync(logFile, a.join(' ') + '\n');
  const timeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + what)), ms)), ]);
  setTimeout(() => { log('GLOBAL TIMEOUT'); process.exit(1); }, 480000);
  win.webContents.on('console-message', (e, level, m) => { const lv = e && e.level !== undefined ? e.level : level; const txt = e && e.message !== undefined ? e.message : m; if (lv === 'error' || lv === 'warning' || lv >= 2) log('[renderer]', txt, e && e.sourceId ? e.sourceId.split('/').pop() + ':' + e.lineNumber : ''); });
  // fichiers d'essai pour les formats « tous fichiers »
  fs.writeFileSync(path.join(outDir, 't.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#def"/><text x="20" y="100" font-size="30">SVG Leçon</text></svg>');
  fs.writeFileSync(path.join(outDir, 't.html'), '<!doctype html><meta charset="utf-8"><h1 style="color:#1f3b73">Fiche HTML</h1><p>Énoncé de l\'exercice.</p>');
  fs.writeFileSync(path.join(outDir, 'notes'), 'Fichier sans extension : texte brut.');
  fs.writeFileSync(path.join(outDir, 'photo.heic'), 'pas une vraie photo');
  // Fixtures : certificat de test, Word protégé, document XPS
  const fixtures = (async () => {
    const forge = require('node-forge');
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate(); cert.publicKey = keys.publicKey; cert.serialNumber = '01';
    cert.validity.notBefore = new Date(); cert.validity.notAfter = new Date(Date.now() + 365 * 864e5);
    const attrs = [{ name: 'commonName', value: 'Professeur Test' }]; cert.setSubject(attrs); cert.setIssuer(attrs);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'secret', { algorithm: '3des' });
    fs.writeFileSync(path.join(outDir, 'test.p12'), Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'));
    try {
      const { Document, Packer, Paragraph } = require('docx');
      const plain = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('Devoir protégé par mot de passe')] }] }));
      const enc = await require('officecrypto-tool').encrypt(plain, { password: 'mdp' });
      fs.writeFileSync(path.join(outDir, 'devoir.docx'), enc);
    } catch (e) { log('fixture docx', e.message); }
    await new Promise((res) => require('child_process').execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', `
Add-Type -AssemblyName PresentationFramework, ReachFramework, System.Printing
$doc = New-Object System.Windows.Documents.FixedDocument; $pc = New-Object System.Windows.Documents.PageContent
$fp = New-Object System.Windows.Documents.FixedPage; $fp.Width = 816; $fp.Height = 1056
$tb = New-Object System.Windows.Controls.TextBlock; $tb.Text = 'Document XPS'; $tb.FontSize = 40
[System.Windows.Documents.FixedPage]::SetLeft($tb, 96); [System.Windows.Documents.FixedPage]::SetTop($tb, 96); $fp.Children.Add($tb) | Out-Null
([System.Windows.Markup.IAddChild]$pc).AddChild($fp); $doc.Pages.Add($pc) | Out-Null
$x = New-Object System.Windows.Xps.Packaging.XpsDocument('${path.join(outDir, 't.xps')}', [IO.FileAccess]::ReadWrite)
[System.Windows.Xps.Packaging.XpsDocument]::CreateXpsDocumentWriter($x).Write($doc); $x.Close()`], { windowsHide: true }, (err, so, se) => { if (err) log('fixture xps', String(se).slice(0, 200)); res(); }));
  })();  win.webContents.once('did-finish-load', async () => {
    await fixtures;
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
        const files = await window.api.loadPaths([${JSON.stringify(path.join(outDir, 'protege-abc.pdf'))}, ]);
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
        const d = await PDFLib.PDFDocument.create(); const pg = d.addPage([400, 300, ]); const form = d.getForm();
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
        const d = await PDFLib.PDFDocument.create(); const pg = d.addPage([400, 300, ]);
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
        T.S.cur = 0; T.S.sel = new Set([0, ]);
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
        const files = await window.api.loadPaths([${JSON.stringify(path.join(outDir, 't.svg'))}, ${JSON.stringify(path.join(outDir, 't.html'))}, ${JSON.stringify(path.join(outDir, 'notes'))}, ${JSON.stringify(path.join(outDir, 'photo.heic'))}]);
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

      await step('redact+inplace', `(async () => {
        const T = window.__edupdf; T.S.dirty = false; T.actions.close();
        const d = await PDFLib.PDFDocument.create(); d.setTitle('Cours de maths'); const font = await d.embedFont(PDFLib.StandardFonts.Helvetica);
        for (let i = 1; i <= 3; i++) { const pg = d.addPage([400, 300, ]); pg.drawText('Réponse secrète ' + i, { x: 40, y: 200, size: 16, font }); pg.drawText('Ligne voisine ' + i, { x: 40, y: 178, size: 16, font }); }
        await T.insertPdf(await d.save()); T.setTool('edit'); T.refresh();
        for (let i = 0; i < 60 && !document.querySelector('#textLayer .tl'); i++) await new Promise(r => setTimeout(r, 50));
        const sp = [...document.querySelectorAll('#textLayer .tl')].find(s => s.textContent.startsWith('Réponse')); sp.click(); sp.innerText = 'Texte public'; sp.blur();
        const [p3] = T.S.pages.splice(2, 1); T.S.pages.unshift(p3); // réorganisation
        const out = await T.buildPdf(); window.__redacted = out;
        const doc = await pdfjsLib.getDocument({ data: out.slice() }).promise;
        const texts = []; for (let i = 1; i <= doc.numPages; i++) texts.push((await (await doc.getPage(i)).getTextContent()).items.map(x => x.str).join('|'));
        const lib = await PDFLib.PDFDocument.load(out);
        return { title: lib.getTitle(), texts, secretGone: !texts[1].includes('secrète 1'), neighbourKept: texts[1].includes('voisine 1'), replaced: texts[1].includes('Texte public') };
      })()`);

      await step('find+replace', `(async () => {
        const T = window.__edupdf; window.confirm = () => true; T.setTool('select');
        T.actions.find(); document.querySelector('#findText').value = 'voisine';
        document.querySelector('#replText').value = 'proche';
        document.querySelector('#replAll').click();
        for (let i = 0; i < 100 && !/remplacement/.test(document.querySelector('#msg').textContent); i++) await new Promise(r => setTimeout(r, 100));
        const out = await T.buildPdf(); const doc = await pdfjsLib.getDocument({ data: out.slice() }).promise;
        const t = []; for (let i = 1; i <= doc.numPages; i++) t.push((await (await doc.getPage(i)).getTextContent()).items.map(x => x.str).join('|'));
        return { msg: document.querySelector('#msg').textContent, texts: t, noOld: !t.join().includes('voisine') };
      })()`, 90000);

      await step('note+watermark+crop', `(async () => {
        const T = window.__edupdf;
        T.S.pages[0].items.push({ type: 'note', at: [300, 280], text: 'Revoir cet exercice', color: '#ffd400' });
        T.S.watermark = { text: 'CORRIGÉ', size: 50, color: '#c0392b', opacity: 0.2 };
        T.S.pages[1].crop = [20, 20, 380, 280];
        const out = await T.buildPdf(); window.__wm = out; const doc = await pdfjsLib.getDocument({ data: out.slice() }).promise;
        const p1 = await doc.getPage(1); const annots = (await p1.getAnnotations()).map(a => a.subtype + ':' + (a.contentsObj && a.contentsObj.str));
        const t1 = (await p1.getTextContent()).items.map(x => x.str).join('|');
        const p2 = await doc.getPage(2);
        return { annots, watermark: t1.includes('CORRIGÉ'), cropView: p2.view };
      })()`);

      await step('compress', `(async () => {
        const out = await window.api.compressPdf(window.__wm);
        const doc = await pdfjsLib.getDocument({ data: out.slice() }).promise;
        return { before: window.__wm.length, after: out.length, pages: doc.numPages };
      })()`);

      await step('cert-sign', `(async () => {
        const signed = await window.api.signPdf({ bytes: window.__wm, certPath: ${JSON.stringify(path.join(outDir, 'test.p12'))}, passphrase: 'secret', name: 'Prof', reason: 'Test' });
        const s = new TextDecoder('latin1').decode(signed);
        let bad = null; try { await window.api.signPdf({ bytes: window.__wm, certPath: ${JSON.stringify(path.join(outDir, 'test.p12'))}, passphrase: 'faux' }); } catch (e) { bad = e.message; }
        return { byteRange: s.includes('/ByteRange'), sig: s.includes('/Type /Sig') || s.includes('/Type/Sig'), wrongPassword: bad };
      })()`);

      await step('xps+locked-docx', `(async () => {
        const files = await window.api.loadPaths([${JSON.stringify(path.join(outDir, 't.xps'))}, ${JSON.stringify(path.join(outDir, 'devoir.docx'))}, ]);
        const r = files.map(f => ({ name: f.name, kind: f.kind, locked: !!f.locked, images: f.images ? f.images.length : 0, error: f.error }));
        const docx = files.find(f => f.locked);
        let unlocked = null, wrong = null;
        if (docx) {
          wrong = (await window.api.unlockOffice(docx.path, 'xxx')).ok;
          const u = await window.api.unlockOffice(docx.path, 'mdp');
          if (u.ok) { const d = await pdfjsLib.getDocument({ data: new Uint8Array(u.bytes) }).promise; unlocked = (await (await d.getPage(1)).getTextContent()).items.map(x => x.str).join(' '); }
        }
        return { r, wrongAccepted: wrong, unlocked };
      })()`, 120000);

      // ---------- Conversions Office ----------
      await step('pdf-to-excel+pptx', `(async () => {
        const T = window.__edupdf; T.S.dirty = false; T.actions.close();
        const d = await PDFLib.PDFDocument.create(); const pg = d.addPage([500, 300]); const f = await d.embedFont(PDFLib.StandardFonts.Helvetica);
        const rows = [['Élève', 'Maths', 'Français'], ['Aïcha', '15,5', '12'], ['Koffi', '9', '14,25']];
        rows.forEach((r, i) => r.forEach((c, j) => pg.drawText(c, { x: 40 + j * 140, y: 250 - i * 22, size: 12, font: f })));
        await T.insertPdf(await d.save()); T.refresh();
        const table = await T.pageTable(T.S.pages[0]);
        await T.toOffice('xlsx'); await T.toOffice('csv');
        return { table, msg: document.querySelector('#msg').textContent };
      })()`);
      try {
        const ExcelJS = require('exceljs'); const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(outDir, 'Document.xlsx'));
        const ws = wb.worksheets[0]; log('OK   xlsx-content', JSON.stringify([1, 2, 3].map((r) => ws.getRow(r).values.slice(1))));
        log('OK   csv-content', JSON.stringify(fs.readFileSync(path.join(outDir, 'Document.csv'), 'utf8').slice(0, 80)));
      } catch (e) { log('FAIL xlsx-content', e.message); results.xlsx = { error: e.message }; }
      await step('pptx-images', `(async () => {
        const T = window.__edupdf; window.confirm = () => true;
        // sans LibreOffice : diapositives images
        const office = await window.api.officeStatus();
        if (!office) await T.toOffice('pptx');
        return { office, msg: document.querySelector('#msg').textContent };
      })()`);
      try { const z = fs.readFileSync(path.join(outDir, 'Document.pptx')); log('OK   pptx-file', z.length, z.slice(0, 2).toString()); } catch (e) { log('FAIL pptx-file', e.message); results.pptx = { error: e.message }; }

      // ---------- Cloud ----------
      await step('cloud-detect', `(async () => { const r = await window.api.cloudList(); return { clouds: r.clouds.map(c => c.name + ' = ' + c.path), install: Object.keys(r.install) }; })()`);

      // ---------- Administration ----------
      const ADM = require('./admin')._test; const gestion = path.join(outDir, 'gestion');
      try {
        ADM.setupAdmin({ password: 'admin123', folder: gestion });
        const user = require('os').userInfo().username.toLowerCase();
        const defaults = Object.fromEntries(Object.keys(require('./admin').FEATURES).map((k) => [k, k !== 'print']));
        ADM.savePolicy({ defaults, users: { [user]: { features: { convert: false } } }, message: 'Bonjour les enseignants', logFileNames: true });
        let wrong = null; try { ADM.enroll({ folder: gestion, password: 'mauvais', scope: 'machine' }); } catch (e) { wrong = e.message; }
        const en = ADM.enroll({ folder: gestion, password: 'admin123', scope: 'machine' });
        log('OK   admin-setup', JSON.stringify({ wrong, en, eff: ADM.effective().features }));
      } catch (e) { log('FAIL admin-setup', e.stack); results.adm = { error: e.message }; }
      await step('admin-enforce', `(async () => {
        const T = window.__edupdf; await T.applyPolicy();
        document.querySelector('[data-act=print]').click();
        await new Promise(r => setTimeout(r, 300));
        let mainGuard = null; try { await window.api.printPages([]); } catch (e) { mainGuard = e.message; }
        return { canPrint: T.can('print'), canConvert: T.can('convert'), canEdit: T.can('edit'), locked: document.querySelectorAll('.locked').length,
          msg: document.querySelector('#msg').textContent, banner: document.querySelector('#policyBar').textContent, managed: !document.querySelector('#managedTag').hidden, mainGuard };
      })()`);
      try {
        // falsification des règles : signature invalide → ignorée
        const pf = path.join(gestion, 'policy.json'); const raw = JSON.parse(fs.readFileSync(pf, 'utf8'));
        raw.payload.defaults.print = true; fs.writeFileSync(pf, JSON.stringify(raw));
        const pol = ADM.refreshPolicy();
        const fresh = ADM.pollEvents();
        const all = ADM.readAllEvents(100);
        log('OK   admin-tamper+events', JSON.stringify({ printStillBlocked: pol.defaults.print === false, freshTypes: [...new Set(fresh.map((e) => e.type))], posts: all.posts.map((p) => p.user + ':' + p.count + ' bloquées ' + p.blocked) }));
        let un = null; try { ADM.unenroll('faux'); } catch (e) { un = e.message; }
        ADM.unenroll('admin123');
        log('OK   admin-unenroll', JSON.stringify({ wrongRefused: un, canPrintAfter: ADM.effective().features.print }));
      } catch (e) { log('FAIL admin-tamper', e.stack); results.adm2 = { error: e.message }; }

      try { // console d'administration : capture d'écran après connexion
        const { BrowserWindow } = require('electron');
        require('./admin').openConsole(); await new Promise((r) => setTimeout(r, 1500));
        const cw = BrowserWindow.getAllWindows().find((w) => /Administration/.test(w.getTitle()));
        await cw.webContents.executeJavaScript(`document.querySelector('#pw').value = 'admin123'; document.querySelector('#go').click(); 1`);
        await new Promise((r) => setTimeout(r, 1500));
        await cw.webContents.executeJavaScript(`document.querySelector('[data-t=users]').click(); 1`); await new Promise((r) => setTimeout(r, 500));
        fs.writeFileSync(path.join(outDir, 'admin-users.png'), (await cw.webContents.capturePage()).toPNG());
        await cw.webContents.executeJavaScript(`document.querySelector('[data-t=journal]').click(); 1`); await new Promise((r) => setTimeout(r, 800));
        fs.writeFileSync(path.join(outDir, 'admin-journal.png'), (await cw.webContents.capturePage()).toPNG());
        log('OK   admin-console', await cw.webContents.executeJavaScript(`document.querySelectorAll('#journalTbl tr').length + ' lignes de journal'`));
      } catch (e) { log('FAIL admin-console', e.message); results.cons = { error: e.message }; }

      await step('thumbs', `(async () => {
        const T = window.__edupdf; T.refresh(); await new Promise(r => setTimeout(r, 2500));
        return { thumbs: document.querySelectorAll('#thumbs img').length, pages: T.S.pages.length };
      })()`);

      await new Promise((res) => setTimeout(res, 800));      fs.writeFileSync(path.join(outDir, 'ui.png'), (await win.webContents.capturePage()).toPNG());
      log(Object.values(results).some((r) => r && r.error) ? 'DONE WITH FAILURES' : 'ALL OK');
    } catch (e) {
      log('ECHEC', e.stack || e.message);
    }
    setTimeout(() => process.exit(0), 300);
  });
};
