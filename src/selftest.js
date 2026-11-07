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
    if (process.platform === 'win32') await new Promise((res) => require('child_process').execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', `
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
    for (let i = 0; i < 100 && !(await js('!!window.__edupdf')); i++) await new Promise((r) => setTimeout(r, 100)); // éditeur chargé (module PDF.js)
    await new Promise((r) => setTimeout(r, 600)); try { fs.writeFileSync(path.join(outDir, 'accueil.png'), (await win.webContents.capturePage()).toPNG()); } catch { /* capture facultative */ }
    const results = {};
    const step = async (name, code, ms = 60000) => {
      if (process.env.EDUPDF_ONLY && !process.env.EDUPDF_ONLY.split(',').includes(name)) return; // mise au point : quelques étapes seulement
      if (process.env.EDUPDF_SMOKE && ['unicode+fonts', 'xps+locked-docx'].includes(name)) { log('SKIP', name, '(propre à Windows)'); return; }
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

      // ---------- Assistant IA ----------
      await step('ai', `(async () => {
        const out = {};
        let st = await window.api.aiStatus(); out.encryption = st.encryption; out.providers = Object.keys(st.providers);
        st = await window.api.aiSave({ provider: 'anthropic', model: 'claude-opus-5-5', key: 'sk-ant-cle-de-test-invalide', sendPdf: true });
        out.keyStoredNotExposed = st.providers.anthropic.hasKey && !JSON.stringify(st).includes('sk-ant');
        const T = window.__edupdf; T.S.dirty = false; T.actions.close(); await T.insertPdf(await T.textToPdf('Les fractions : 3/4 = 0,75.'));
        document.querySelector('#aiPrompt').value = 'Résume en une phrase.';
        await T.aiRun();
        out.claude = document.querySelector('#aiOut').textContent.slice(0, 160);
        await window.api.aiSave({ provider: 'openai', model: 'gpt-5', key: 'sk-test-invalide' });
        await T.aiRun(); out.openai = document.querySelector('#aiOut').textContent.slice(0, 160);
        out.ollama = await window.api.aiOllamaModels();
        await window.api.aiSave({ provider: 'anthropic', clearKey: true });
        out.docText = (await T.aiDocText(T.S.pages)).slice(0, 60);
        return out;
      })()`, 90000);
      try { const raw = fs.readFileSync(path.join(outDir, 'userdata', 'ai.json'), 'utf8'); log('OK   ai-key-encrypted', JSON.stringify({ plainKeyOnDisk: raw.includes('sk-test-invalide') || raw.includes('sk-ant-cle') })); } catch (e) { log('FAIL ai-key-encrypted', e.message); }
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
        try { cw.show(); cw.focus(); fs.writeFileSync(path.join(outDir, 'admin-users.png'), (await cw.webContents.capturePage()).toPNG()); } catch (e) { log('note capture console', e.message); }
        await cw.webContents.executeJavaScript(`document.querySelector('[data-t=journal]').click(); 1`); await new Promise((r) => setTimeout(r, 800));
        try { fs.writeFileSync(path.join(outDir, 'admin-journal.png'), (await cw.webContents.capturePage()).toPNG()); } catch (e) { log('note capture console', e.message); }
        log('OK   admin-console', await cw.webContents.executeJavaScript(`document.querySelectorAll('#journalTbl tr').length + ' lignes de journal'`));
      } catch (e) { log('FAIL admin-console', e.message); results.cons = { error: e.message }; }

      await step('onglets+accueil+diaporama', `(async () => {
        const T = window.__edupdf; const out = {}; const q = (s) => document.querySelector(s); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        T.S.dirty = false; T.actions.close();
        out.titre = document.title; out.marque = q('#tabs .brand').textContent;
        out.accueilVisible = !q('#homeSide').hidden && !!q('#homeSide [data-tpl=seyes]') && q('#homeSide [data-tpl=seyes]').textContent.trim() === '📒' && q('#homeSide [data-tpl=seyes]').title.includes('Seyès');
        // modèle Seyès dans l'onglet courant, puis un 2e document dans un nouvel onglet
        q('[data-tpl=seyes]').click(); for (let i = 0; i < 40 && !T.S.pages.length; i++) await wait(100);
        out.modele = T.S.fileName + ' / ' + T.S.pages.length + ' p.';
        T.newTab(); await T.insertPdf(await T.textToPdf('Deuxième document')); T.S.dirty = true; T.refresh();
        out.onglets = document.querySelectorAll('#docTabs .dtab').length;
        T.switchDoc(0); out.retourOnglet1 = T.S.fileName + ' / ' + T.S.pages.length + ' p.';
        T.switchDoc(1); out.onglet2Modifie = T.S.dirty && !!q('#docTabs .dtab.on b');
        // ruban masqué automatiquement
        T.toggleRibbon(); out.rubanAuto = document.body.classList.contains('ribbon-auto') && getComputedStyle(q('#ribbon')).display === 'none';
        q('[data-tab=pages]').click(); out.rubanAffiche = getComputedStyle(q('#ribbon')).display !== 'none';
        T.toggleRibbon();
        // barre d'accès rapide
        out.accesRapide = [...document.querySelectorAll('#qat [data-qat]')].map((b) => b.dataset.qat);
        // diaporama
        await T.startShow(false); await wait(700);
        out.diapoOuvert = !q('#show').hidden && q('#showCanvas').width > 100;
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await wait(300);
        out.diapoFerme = q('#show').hidden;
        T.S.dirty = false; T.closeTab(1); out.ongletsApresFermeture = document.querySelectorAll('#docTabs .dtab').length;
        return out;
      })()`);

      if (process.env.EDUPDF_PERF) { // mesure de performances sur un gros document (hors intégration continue)
        await step('perf-300-pages', `(async () => {
          const T = window.__edupdf; const t = () => performance.now(); const r = {}; T.S.dirty = false; T.actions.close();
          let t0 = t(); const d = await PDFLib.PDFDocument.create(); const f = await d.embedFont(PDFLib.StandardFonts.Helvetica);
          for (let i = 1; i <= 300; i++) { const p = d.addPage([595, 842]); for (let l = 0; l < 40; l++) p.drawText('Page ' + i + ' — ligne ' + l + ' : texte de cours pour mesurer les performances.', { x: 40, y: 800 - l * 19, size: 10, font: f }); }
          const bytes = await d.save(); r.creation = Math.round(t() - t0) + ' ms / ' + Math.round(bytes.length / 1024) + ' Ko';
          t0 = t(); await T.insertPdf(bytes); T.refresh(); r.ouverture = Math.round(t() - t0) + ' ms';
          t0 = t(); for (let i = 0; i < 10; i++) { T.S.cur = i * 30; await T.renderPage(); } r.affichage10pages = Math.round(t() - t0) + ' ms';
          T.S.pages[5].items.push({ type: 'text', at: [60, 500], size: 14, color: '#001871', text: 'Modification' });
          t0 = t(); const out = await T.buildPdf(); r.enregistrement = Math.round(t() - t0) + ' ms / ' + Math.round(out.length / 1024) + ' Ko';
          t0 = t(); const s = await T.getTextItems(T.S.pages[299]); r.texteDernierePage = Math.round(t() - t0) + ' ms (' + s.length + ' éléments)';
          await new Promise((res) => setTimeout(res, 6000)); r.miniaturesApres6s = document.querySelectorAll('#thumbs img').length;
          r.memoireJS = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + ' Mo' : '?';
          return r;
        })()`, 180000);
        const m = process.getProcessMemoryInfo ? await process.getProcessMemoryInfo() : null;
        log('INFO memoire processus principal', m ? Math.round(m.private / 1024) + ' Mo' : '?');
      }

      // ---------- Nouveautés : paragraphes, correction, évaluations, publipostage, DYS, équations, bilingue, classe connectée, diaporama, anglais ----------
      await step('nouveautes', `(async () => {
        const T = window.__edupdf; const F = window.__features; const out = {}; const q = (s) => document.querySelector(s); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        T.S.dirty = false; T.actions.close();
        // 1. modification d'un paragraphe : recomposition dans la largeur d'origine
        const d = await PDFLib.PDFDocument.create(); const pg = d.addPage([595, 842]); const f = await d.embedFont(PDFLib.StandardFonts.TimesRoman);
        ['La photosynthèse permet aux plantes de fabriquer', 'leur matière organique à partir de la lumière,', 'de l\\'eau et du dioxyde de carbone.'].forEach((t, i) => pg.drawText(t, { x: 60, y: 700 - i * 16, size: 13, font: f }));
        pg.drawText('Titre suivant', { x: 60, y: 600, size: 18, font: f });
        await T.insertPdf(await d.save()); T.setTool('editpara'); T.refresh();
        for (let i = 0; i < 50 && !q('#textLayer .tl.para'); i++) await wait(80);
        await wait(800);
        const paras = [...document.querySelectorAll('#textLayer .tl.para')]; out.paragraphes = paras.length;
        const para = paras.find((x) => x.textContent.startsWith('La photosynthèse'));
        out.texteParagraphe = para && para.textContent.slice(0, 80);
        para.click(); para.innerText = 'La photosynthèse permet aux plantes vertes de produire leur propre matière organique grâce à la lumière du soleil, à l\\'eau et au dioxyde de carbone de l\\'air.'; para.blur(); if (para.onblur) para.onblur(); // fenêtre de test sans focus système : l'évènement blur n'est pas émis
        let lines = []; for (let i = 0; i < 100 && !lines.length; i++) { await wait(100); lines = T.S.pages[0].items.filter((o) => o.type === 'text'); }
        out.whiteouts = T.S.pages.flatMap((p) => p.items).filter((o) => o.kind === 'whiteout').length;
        out.lignesRecomposees = lines.length; out.memePolice = lines.every((o) => o.font && o.font.family === 'Times New Roman');
        out.largeurRespectee = lines.every((o) => o.at[0] === lines[0].at[0]);
        T.setTool('select');
        // 2. correction de copies (saisie manuelle) : application et export
        F.GR.questions = F.gradingParseScale('Q1:5; Q2:15'); F.GR.copies = [{ pages: [T.S.pages[0].uid], name: 'Awa', pts: { Q1: '4', Q2: '12,5' }, comment: 'Bon travail' }];
        F.gradingApply(); out.noteCopie = T.S.pages[0].items.filter((o) => o.tag === 'grade' && o.type === 'text').map((o) => o.text)[0];
        // 3. évaluations différenciées à partir d'une réponse d'IA simulée
        const evalData = { titre: 'Fractions', niveaux: [{ nom: 'Soutien', questions: [{ type: 'qcm', enonce: '1/2 = ?', choix: ['0,5', '2', '0,2', '1'], reponse: '0,5', points: 1 }, { type: 'vf', enonce: '3/4 > 1', reponse: 'Faux', points: 1 }] }, { nom: 'Approfondissement', questions: [{ type: 'courte', enonce: 'Simplifier 6/8', reponse: '3/4', points: 2 }] }] };
        const giftTxt = F.toGift(evalData); out.gift = giftTxt.includes('{=0,5 ~2') && giftTxt.includes('{FALSE}') && giftTxt.includes('{=3/4}');
        const tabsAvant = document.querySelectorAll('#docTabs .dtab').length;
        const p2 = F.diffEvalBuild(evalData, true); await wait(1500); if (!q('#modal').hidden) q('#mBtns button.primary').click(); await p2;
        out.sujetsPages = T.S.pages.length; out.ongletSujets = document.querySelectorAll('#docTabs .dtab').length === tabsAvant + 1;
        // 4. publipostage : balises {{Nom}} remplacées ligne par ligne
        T.S.pages = T.S.pages.slice(0, 1); T.S.pages[0].items.push({ type: 'text', at: [60, 500], size: 14, color: '#000000', text: 'Attestation : {{Nom}} — {{Classe}}' });
        const files = await F.mergeRows(['Nom', 'Classe'], [['Awa Koné', '5e B'], ['Yao Kouassi', '4e A']], 'Nom');
        const dm = await pdfjsLib.getDocument({ data: files[1].bytes }).promise; const tx = (await (await dm.getPage(1)).getTextContent()).items.map((i) => i.str).join(' ');
        out.publipostage = files.length + ' fichiers ; ' + files[1].name + ' ; ' + (tx.includes('Yao Kouassi') && tx.includes('4e A') && !tx.includes('{{'));
        out.modeleIntact = T.S.pages[0].items.some((o) => o.text && o.text.includes('{{Nom}}'));
        // 5. version adaptée DYS (police OpenDyslexic, règle de lecture)
        const dy = await F.dysPdf({ font: 'OpenDyslexic', size: 16, lh: 1.8, cs: 0.6, ruler: true }); const dd = await pdfjsLib.getDocument({ data: dy }).promise;
        out.dys = dd.numPages + ' p. ; ' + (await (await dd.getPage(1)).getTextContent()).items.map((i) => i.str).join(' ').slice(0, 40);
        // 6. équation LaTeX
        const eq = await F.texToPng('\\\\frac{a}{b}=\\\\sqrt{x^2+1}'); out.equation = eq.url.startsWith('data:image/png') && eq.w > 20;
        // 7. version bilingue (traductions simulées)
        const bi = await F.bilingualPdf([['Bonjour à tous.', 'Hello everyone.'], ['La cellule est l\\'unité du vivant.', 'The cell is the unit of life.']], 'anglais');
        const bd = await pdfjsLib.getDocument({ data: bi }).promise; const bt = (await (await bd.getPage(1)).getTextContent()).items.map((i) => i.str).join(' ');
        out.bilingue = bt.includes('Bonjour') && bt.includes('Hello everyone');
        // 8. diaporama : annotation au stylo conservée dans le document
        await T.startShow(false); await wait(600);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' })); await wait(100);
        F.INK.strokes[0] = [{ color: '#e53935', w: 3, pts: [[50, 50], [120, 90], [200, 60]] }];
        window.confirm = () => true; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await wait(400);
        out.encreConservee = T.S.pages[0].items.some((o) => o.type === 'ink');
        // 9. accessibilité et anglais
        out.aria = q('#tabs').getAttribute('role') === 'tablist' && q('#modal').getAttribute('role') === 'dialog';
        out.anglais = F.tr('Fichier') === 'File' && F.tr('Corriger des copies') === 'Grade papers';
        return out;
      })()`, 120000);

      // ---------- Classe connectée : un « élève » télécharge le document et rend sa copie par le réseau ----------
      try {
        const st = await js(`(async () => window.api.classroomStart({ bytes: new Uint8Array(await window.__edupdf.buildPdf()), title: 'Test', collect: true, fileName: 'fiche.pdf' }).then((s) => ({ url: s.url, qr: !!s.qr })))()`.replace('new Uint8Array(await', '(await').replace('buildPdf())', 'buildPdf())'));
        const http = require('http'); const get = (u) => new Promise((res, rej) => http.get(u, (r) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => res({ code: r.statusCode, body: Buffer.concat(c) })); }).on('error', rej));
        const page = await get(st.url); const doc = await get(st.url + 'document.pdf');
        const boundary = '----edupdf' + Date.now(); const pdf = doc.body;
        const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="eleve"\r\n\r\nAwa Koné\r\n--${boundary}\r\nContent-Disposition: form-data; name="copie"; filename="copie.pdf"\r\nContent-Type: application/pdf\r\n\r\n`), pdf, Buffer.from(`\r\n--${boundary}--\r\n`)]);
        const u = new URL(st.url + 'rendre');
        const post = await new Promise((res, rej) => { const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length } }, (rs) => { const c = []; rs.on('data', (d) => c.push(d)); rs.on('end', () => res({ code: rs.statusCode, body: Buffer.concat(c).toString() })); }); r.on('error', rej); r.end(body); });
        const bad = await get(st.url.replace(/\/c\/[^/]+\//, '/c/mauvais-jeton/'));
        const status = await js('window.api.classroomStatus()'); await js('window.api.classroomStop()');
        log('OK   classe-connectee', JSON.stringify({ qr: st.qr, page: page.code, pdf: doc.body.subarray(0, 5).toString(), rendu: post.code, merci: post.body.includes('Copie reçue'), recues: status.received.map((r) => r.eleve), jetonInvalide: bad.code }));
      } catch (e) { log('FAIL classe-connectee', e.stack); results.classe = { error: e.message }; }
      // ---------- 1.10 : défilement continu, zoom, barres automatiques, texte adapté, modifications, commentaires verrouillés, format d'origine, cloud ----------
      const settingsF = path.join(require('electron').app.getPath('userData'), 'settings.json');
      const editSettings = (fn) => { let st = {}; try { st = JSON.parse(fs.readFileSync(settingsF, 'utf8')); } catch { /* absent */ } fn(st); fs.writeFileSync(settingsF, JSON.stringify(st)); };
      const cloudDir = path.join(outDir, 'MonCloud'); fs.mkdirSync(cloudDir, { recursive: true });
      editSettings((st) => { st.clouds = (st.clouds || []).filter((c) => c.path !== cloudDir).concat([{ path: cloudDir, name: 'MonCloud' }]); });
      const roFile = path.join(outDir, 'lecture-seule.pdf');
      await step('v110', `(async () => {
        const T = window.__edupdf; const ST = window.__studio; const out = {}; const q = (s) => document.querySelector(s); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < 12 && (T.S.pages.length || document.querySelectorAll('#docTabs .dtab').length > 1); i++) { T.S.dirty = false; T.actions.close(); } // document vierge, un seul onglet
        await T.applyPolicy(); // politique d'administration rétablie (poste désinscrit plus haut)
        const d = await PDFLib.PDFDocument.create(); const f = await d.embedFont(PDFLib.StandardFonts.HelveticaBold);
        for (let i = 0; i < 3; i++) { const pg = d.addPage([595, 842]); pg.drawText('Chapitre ' + (i + 1) + ' : les volcans', { x: 60, y: 760, size: 20, font: f, color: PDFLib.rgb(0.1, 0.2, 0.6) }); }
        await T.insertPdf(await d.save()); T.S.cur = 0; T.refresh(); await wait(1200);
        const stack = q('#pageStack'); out.continu = !!stack && stack.children.length === 3 && !!stack.children[0].querySelector('#pageBox');
        const wrap = q('#viewWrap'); wrap.scrollTop = stack.children[2].offsetTop + 30; await wait(900);
        out.pageApresDefilement = T.S.cur + 1; out.pageVivanteSuit = !!stack.children[2].querySelector('#pageBox');
        await wait(700); out.pagesVoisinesAffichees = !!stack.children[1].querySelector('canvas');
        T.actions.zoomPage(); await wait(600); out.zoomPageEntiere = q('#zoomSel').value + ' / ' + q('#zoomLbl').textContent;
        T.actions.zoomIn(); await wait(600); out.zoomAvant = q('#zoomLbl').textContent; T.actions.zoomFit(); await wait(600);
        const lb = q('#leftBar'); out.barresAuto = document.body.classList.contains('sb-auto') && getComputedStyle(lb).position === 'absolute';
        lb.dispatchEvent(new MouseEvent('mouseenter')); out.barreSurvol = lb.classList.contains('peek');
        lb.dispatchEvent(new MouseEvent('mouseleave')); await wait(1000); out.barreMasquee = !lb.classList.contains('peek');
        T.S.cur = 0; T.S.sel = new Set([0]); T.refresh(); await wait(900);
        const [px, py] = T.S.vp.convertToViewportPoint(62, 735);
        const sty = await nearbyTextStyle(T.S.pages[0], [px, py]);
        out.texteAdapte = sty && (sty.font.family + (sty.font.bold ? ' gras ' : ' ') + sty.size + ' pt ' + sty.color);
        T.setTool('edit'); await wait(700);
        const sp = [...document.querySelectorAll('#textLayer .tl')].find((x) => x.textContent.startsWith('Chapitre 1'));
        if (!sp) return out;
        sp.click(); sp.innerText = 'Chapitre 1 : les séismes'; if (sp.onblur) sp.onblur(); await wait(500);
        const p0 = T.S.pages[0]; out.modifie = p0.items.length + ' éléments, ' + p0.edited.length + ' remplacé(s)';
        if (!q('#modList .moddel')) return out;
        q('#modList .moddel').click(); await wait(300);
        out.apresSuppression = p0.items.length + ' éléments, ' + p0.edited.length + ' remplacé(s)';
        T.setTool('select');
        p0.items.push({ type: 'rect', kind: 'box', rect: [50, 50, 200, 120], color: '#ff0000', width: 2 }, { type: 'ink', points: [[60, 60], [90, 90]], color: '#000000', width: 2 });
        T.refresh(); await wait(500); window.confirm = () => true; q('#modClearPage').click(); await wait(300); out.pageEffacee = p0.items.length === 0;
        p0.items.push({ type: 'note', at: [300, 700], text: 'Très bon travail, revoir la conclusion.', color: '#ffd400', author: 'M. Koné' });
        const ro = await ST.readOnlyBytes();
        const rd = await pdfjsLib.getDocument({ data: ro.slice() }).promise; const pr = await rd.getPermissions(); const perms = pr ? [...pr] : null;
        const an = (await (await rd.getPage(1)).getAnnotations()).filter((a) => a.subtype === 'Text');
        out.verrou = 'modif. interdite ' + (!!perms && !perms.includes(8) && !perms.includes(32)) + ', commentaire ' + !!(an.length && an[0].contentsObj.str) + ', drapeaux ' + (an.length && an[0].annotationFlags) + ', marqueur ' + await window.isReadOnlyPdf(ro);
        await window.api.save({ bytes: ro, defaultName: 'lecture-seule.pdf', filters: [], filePath: ${JSON.stringify(roFile)} });
        T.S.origin = { ext: 'docx', name: 'cours.docx', path: ${JSON.stringify(path.join(outDir, 'cours.docx'))} };
        const pe = ST.exportOrigin(); await wait(1500);
        if (!q('#modal').hidden) { const b = [...document.querySelectorAll('#mBtns button')].find((x) => /Texte simple/.test(x.textContent)) || q('#mBtns button.primary'); b.click(); }
        await pe; out.formatOrigine = q('#msg').textContent.slice(0, 70);
        ST.setCloudAuto(${JSON.stringify(cloudDir)}, 'MonCloud'); T.S.fileName = 'Volcans.pdf'; await ST.cloudAutoTick(true);
        out.cloud = q('#cloudTag').textContent + ' | ' + q('#cloudTag').title.split('\\n')[0];
        return out;
      })()`, 180000);
      try {
        const auto = path.join(cloudDir, 'SknEDU-studio', 'Sauvegardes automatiques', 'Volcans.pdf');
        log((fs.existsSync(auto) ? 'OK   ' : 'FAIL ') + 'cloud-auto', auto, fs.existsSync(auto) ? fs.statSync(auto).size + ' octets' : '');
        const docx = path.join(outDir, 'cours.docx'); log((fs.existsSync(docx) ? 'OK   ' : 'FAIL ') + 'origine-docx', fs.existsSync(docx) ? fs.readFileSync(docx).subarray(0, 2).toString() : 'absent');
        editSettings((st) => { st.recent = [{ path: roFile, name: 'lecture-seule.pdf', date: Date.now() }].concat(st.recent || []); });
      } catch (e) { log('FAIL v110-fichiers', e.message); }
      await step('lecture-seule', `(async () => {
        const T = window.__edupdf; const q = (s) => document.querySelector(s); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        T.S.dirty = false; T.actions.close();
        const files = (await window.api.recentOpen(${JSON.stringify(roFile)})).filter((f) => !f.error); if (!files.length) return { erreur: 'fichier lecture seule absent' }; await T.handleLoaded(files, 0); await wait(1200);
        T.setTool('text');
        return { lectureSeule: T.S.readOnly, modifierBloque: !T.can('edit'), outilTexteRefuse: T.S.tool !== 'text', bandeau: !q('#roTag').hidden, commentaireVisible: document.querySelectorAll('#annotLayer .annMark').length, info: (q('#annotLayer .annMark') || {}).title, message: q('#msg').textContent.slice(0, 60) };
      })()`);
      await step('fin-lecture-seule', `(async () => { const T = window.__edupdf; T.S.dirty = false; T.actions.close(); return { lectureSeule: T.S.readOnly }; })()`);

      // ---------- 1.11 : formes et flèches, tampons, en-tête / pied de page, impression, récupération, auteur des commentaires ----------
      await step('v111', `(async () => {
        const T = window.__edupdf; const TE = window.__teacher; const out = {}; const q = (s) => document.querySelector(s); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < 12 && (T.S.pages.length || document.querySelectorAll('#docTabs .dtab').length > 1); i++) { T.S.dirty = false; T.actions.close(); }
        await T.applyPolicy();
        const d = await PDFLib.PDFDocument.create(); d.addPage([595, 842]); d.addPage([842, 595]); d.addPage([595, 842]);
        await T.insertPdf(await d.save()); T.S.cur = 0; T.refresh(); await wait(900);
        // flèche tracée à la souris
        T.setTool('arrow'); const ov = q('#overlayLayer'); const r = ov.getBoundingClientRect();
        const ev = (type, x, y) => ov.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: r.left + x, clientY: r.top + y }));
        ev('pointerdown', 60, 60); ev('pointermove', 160, 120); ev('pointerup', 160, 120); await wait(200);
        const p0 = T.S.pages[0]; const arrow = p0.items.find((o) => o.type === 'ink' && o.arrow);
        out.fleche = !!arrow && arrow.points.length === 2 && !!q('#overlayLayer .ov svg polyline + polyline');
        T.setTool('ellipse'); ev('pointerdown', 200, 200); ev('pointermove', 300, 260); ev('pointerup', 300, 260); await wait(200);
        out.ellipse = p0.items.some((o) => o.kind === 'ellipse') && !!q('#overlayLayer .ov.ellipse');
        // tampons
        TE.setStamp('Très bien', '#1e8e3e'); T.setTool('stamp'); ev('pointerdown', 120, 320); await wait(400);
        TE.setStamp('✔', '#1e8e3e'); ev('pointerdown', 220, 320); await wait(400);
        out.tampons = p0.items.filter((o) => o.stamp).map((o) => o.stamp).join(' + ');
        T.setTool('select');
        // auteur des commentaires (préférences)
        TE.PREFS.teacher = 'Mme Test'; TE.PREFS.school = 'Lycée Test';
        p0.items.push({ type: 'note', at: [400, 700], text: 'Soignez la présentation.', color: '#ffd400' });
        // en-tête et pied de page sur les 3 pages
        await TE.applyHeaderFooter({ hl: '{établissement}', hc: '', hr: '{classe}', fl: '{enseignant}', fc: '', fr: 'Page {page} / {pages}', size: 9, color: '#444444', cls: '4e A' });
        const pdf = await T.buildPdf(); const doc = await pdfjsLib.getDocument({ data: pdf }).promise;
        const t2 = (await (await doc.getPage(2)).getTextContent()).items.map((i) => i.str).join(' ');
        out.enTete = t2.includes('Lycée Test') && t2.includes('4e A') && t2.includes('Mme Test') && t2.includes('Page 2 / 3');
        const ann = (await (await doc.getPage(1)).getAnnotations()).find((a) => a.subtype === 'Text');
        out.auteurCommentaire = ann && ann.titleObj.str;
        out.pdfValide = doc.numPages === 3;
        // impression : sélection de pages, 2 par feuille, orientation homogène
        out.intervalle = TE.parseRange('1-3, 5, 2', 4).join(',');
        const fake = async (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').fillRect(0, 0, 10, 10); const b = await new Promise((res) => c.toBlob(res, 'image/jpeg')); return { bytes: new Uint8Array(await b.arrayBuffer()), w, h }; };
        const pages = [await fake(600, 848), await fake(848, 600), await fake(600, 848)];
        const s2 = await TE.composePrint(pages, 2); const s1 = await TE.composePrint(pages, 1);
        out.impression = s2.length + ' feuilles à 2 pages (' + (s2[0].w > s2[0].h ? 'italienne' : 'portrait') + '), 1 par feuille : ' + s1.every((p) => p.h > p.w);
        // copie de récupération puis suppression après enregistrement
        TE.PREFS.recoveryMin = 1; T.S.dirty = true; await TE.recoveryTick();
        const l1 = await window.api.recoveryList(); out.recuperation = l1.length + ' copie(s) ' + (l1[0] ? l1[0].name : '');
        const back = await window.api.recoveryLoad(l1[0].id); out.recupOuvrable = back.bytes.length > 1000;
        T.S.dirty = true; window.setDirty(false); await wait(300); out.apresEnregistrement = (await window.api.recoveryList()).length;
        const u0 = await window.api.updatePref(); await window.api.updatePref(false); const u1 = await window.api.updatePref(); await window.api.updatePref(true);
        out.majDesactivable = u0 === true && u1 === false && (await window.api.updatePref()) === true;
        TE.PREFS.teacher = ''; TE.PREFS.school = '';
        return out;
      })()`, 120000);

      await step('aller-a-la-page', `(async () => {
        const T = window.__edupdf; const q = (s) => document.querySelector(s); const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const out = {};
        for (let i = 0; i < 12 && (T.S.pages.length || document.querySelectorAll('#docTabs .dtab').length > 1); i++) { T.S.dirty = false; T.actions.close(); }
        const d = await PDFLib.PDFDocument.create(); for (let i = 0; i < 6; i++) d.addPage([595, 842]);
        await T.insertPdf(await d.save()); T.S.cur = 0; T.refresh(); await wait(900);
        out.affiche = q('#pageInput').value + ' ' + q('#pageTotal').textContent;
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true })); out.ctrlG = document.activeElement === q('#pageInput');
        const inp = q('#pageInput'); inp.value = '4'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(900);
        out.page4 = T.S.cur + 1; out.champApres = inp.value; out.pageVisible = !!q('#pageStack') && !!q('#pageStack').children[3].querySelector('#pageBox');
        inp.focus(); inp.value = '99'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(700);
        out.horsLimite = T.S.cur + 1 + ' — ' + q('#msg').textContent.slice(0, 50);
        inp.focus(); inp.value = 'abc'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(200);
        out.invalide = T.S.cur + 1; inp.blur();
        T.actions.prev(); await wait(600); out.precedente = q('#pageInput').value;
        return out;
      })()`);
      // ---------- Licence (open core) : clé invalide refusée ; clé réelle testée si la clé de l'éditeur est sur ce PC ----------
      {
        let realKey = null;
        const priv = path.join(require('os').homedir(), 'SknEDU-licences', 'cle-privee-licences.pem');
        if (fs.existsSync(priv)) {
          const crypto = require('crypto');
          const data = Buffer.from(JSON.stringify({ v: 1, product: 'SknEDU-studio', edition: 'etablissement', org: 'Lycée de démonstration', seats: 25, ref: 'TEST', issued: '2026-11-07', expires: '2099-12-31' })).toString('base64url');
          realKey = `SKN1.${data}.${crypto.sign(null, Buffer.from(data), crypto.createPrivateKey(fs.readFileSync(priv))).toString('base64url')}`;
        }
        await step('licence', `(async () => {
          const out = {};
          out.depart = (await window.api.licenseStatus()).label;
          try { await window.api.licenseActivate('SKN1.abc.def', 'user'); out.fausseCle = 'ACCEPTÉE (anomalie)'; } catch (e) { out.fausseCle = 'refusée'; }
          const real = ${JSON.stringify(realKey)};
          if (real) {
            const st = await window.api.licenseActivate(real, 'user'); out.vraieCle = st.label + ' — ' + st.org;
            const T = window.__edupdf; await T.applyLicense(); out.barre = document.querySelector('#editionTag').textContent;
            const d = await pdfjsLib.getDocument({ data: await T.templatePdf('evaluation') }).promise;
            out.modeleAvecEtablissement = (await (await d.getPage(1)).getTextContent()).items.map((i) => i.str).join(' ').includes('Lycée de démonstration');
            await window.api.licenseRemove(); out.apresRetrait = (await window.api.licenseStatus()).label;
          } else out.vraieCle = "non testée (clé de l'éditeur absente sur ce PC)";
          out.mentions = (await window.api.notices()).includes('mupdf');
          return out;
        })()`);
      }

      await step('thumbs', `(async () => {
        const T = window.__edupdf; T.refresh(); await new Promise(r => setTimeout(r, 2500));
        return { thumbs: document.querySelectorAll('#thumbs img').length, pages: T.S.pages.length };
      })()`);

      // ---------- Affichage : tailles d'écran (CSS px = résolution ÷ mise à l'échelle Windows) ----------
      try {
        const sizes = [[800, 560, '800x600'], [1093, 614, '1366x768 à 125 %'], [1280, 680, '1280x720'], [1536, 824, '1920x1080 à 125 %'], [1920, 1040, '1920x1080'], [2560, 1400, '2560x1440']];
        if (win.isMaximized()) win.unmaximize();
        const minSize = win.getMinimumSize();
        for (const [w, h, label] of sizes) {
          win.setMinimumSize(320, 320); win.setContentSize(w, h); await new Promise((r) => setTimeout(r, 900));
          const m = await win.webContents.executeJavaScript(`(async () => {
            const q = (s) => document.querySelector(s); const out = {};
            out.viewport = innerWidth + 'x' + innerHeight;
            out.pageScrollX = document.documentElement.scrollWidth > innerWidth + 1;
            out.tabsClipped = [...document.querySelectorAll('#tabs [data-tab]')].filter((t) => t.getBoundingClientRect().right > innerWidth + 1).length;
            let maxRibbon = 0, clipped = 0;
            for (const t of document.querySelectorAll('#tabs [data-tab]')) {
              t.click(); await new Promise((r) => setTimeout(r, 30));
              maxRibbon = Math.max(maxRibbon, q('#ribbon').offsetHeight);
              const p = q('.panel.on'); const scrollable = getComputedStyle(p).overflowX === 'auto';
              p.querySelectorAll('button').forEach((b) => { if (b.getBoundingClientRect().right > innerWidth + 1 && !scrollable) clipped++; });
            }
            q('[data-tab=fichier]').click();
            out.maxRibbonH = maxRibbon; out.clippedButtons = clipped;
            const vw = q('#viewWrap').getBoundingClientRect(); out.docArea = Math.round(vw.width) + 'x' + Math.round(vw.height);
            out.side = q('#side').offsetWidth; out.thumbs = q('#thumbs').offsetWidth;
            out.footerVisible = q('footer').getBoundingClientRect().bottom <= innerHeight + 1;
            out.diaporamaMasque = getComputedStyle(q('#show')).display === 'none';
            return out;
          })()`);
          log('OK   layout', label, JSON.stringify(m));
          if (w <= 1093 || w >= 2560) {
            await win.webContents.executeJavaScript(`document.querySelector('[data-tab=modifier]').click(); 1`); await new Promise((r) => setTimeout(r, 400));
            fs.writeFileSync(path.join(outDir, `ecran-${w}x${h}.png`), (await win.webContents.capturePage()).toPNG());
            await win.webContents.executeJavaScript(`document.querySelector('[data-tab=fichier]').click(); 1`);
          }
        }
        win.setMinimumSize(...minSize);
      } catch (e) { log('FAIL layout', e.stack); }

      await new Promise((res) => setTimeout(res, 800));
      fs.writeFileSync(path.join(outDir, 'ui.png'), (await win.webContents.capturePage()).toPNG());
      log(Object.values(results).some((r) => r && r.error) ? 'DONE WITH FAILURES' : 'ALL OK');
    } catch (e) {
      log('ECHEC', e.stack || e.message);
    }
    setTimeout(() => process.exit(0), 300);
  });
};
