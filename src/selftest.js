// Auto-test : EDUPDF_SELFTEST=<dossier de sortie> electron .
const fs = require('fs');
const path = require('path');
module.exports = (win, outDir) => {
  try { require('./account').save({ email: 'enseignant@ecole.test', name: 'Mme Test', org: 'Lycée Test' }); } catch (e) { console.error('compte de test', e); }
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
        const picked = await window.api.pickCertificate();
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
        await new Promise((r) => setTimeout(r, 300)); out.solutionsProposees = [...document.querySelectorAll('#aiFix button')].map((b) => b.textContent).join(' | ');
        const h = window.aiErrorHelp('[credit] Compte sans crédit API'); out.aideCredit = h.code + ' / ' + h.text.slice(0, 30);
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
        await step('perf-fichier-lourd', `(async () => {
          const T = window.__edupdf; const t = () => performance.now(); const r = {}; const wait = (ms) => new Promise((res) => setTimeout(res, ms));
          for (let i = 0; i < 12 && (T.S.pages.length || document.querySelectorAll('#docTabs .dtab').length > 1); i++) { T.S.dirty = false; T.actions.close(); }
          let t0 = t(); const d = await PDFLib.PDFDocument.create(); const f = await d.embedFont(PDFLib.StandardFonts.Helvetica);
          const c = document.createElement('canvas'); c.width = 1240; c.height = 1754; const x = c.getContext('2d'); x.fillStyle = '#f4f1e8'; x.fillRect(0, 0, 1240, 1754);
          for (let i = 0; i < 4000; i++) { x.fillStyle = 'rgba(0,0,0,' + (Math.random() * 0.5) + ')'; x.fillRect(Math.random() * 1240, Math.random() * 1754, 30, 3); }
          const scan = async () => { for (let i = 0; i < 1500; i++) { x.fillStyle = 'rgba(0,0,0,' + (Math.random() * 0.5) + ')'; x.fillRect(Math.random() * 1240, Math.random() * 1754, 30, 3); } return d.embedJpg(dataUrlToBytes(c.toDataURL('image/jpeg', 0.9))); };
          for (let i = 1; i <= 1000; i++) {
            const p = d.addPage([595, 842]);
            if (i % 5 === 0) p.drawImage(await scan(), { x: 0, y: 0, width: 595, height: 842 }); // page « scannée » (image différente à chaque fois)
            else for (let l = 0; l < 40; l++) p.drawText('Page ' + i + ' — ligne ' + l + ' : texte de cours pour mesurer les performances.', { x: 40, y: 800 - l * 19, size: 10, font: f });
          }
          const bytes = await d.save(); r.document = '1000 pages (200 scannées), ' + Math.round(bytes.length / 1048576) + ' Mo, créé en ' + Math.round(t() - t0) + ' ms';
          t0 = t(); await T.insertPdf(bytes); T.S.cur = 0; await T.renderPage(); r.ouverturePremierePage = Math.round(t() - t0) + ' ms';
          await wait(1500);
          t0 = t(); const wrap = document.querySelector('#viewWrap'); const st = document.querySelector('#pageStack');
          if (st) { wrap.scrollTop = st.children[900].offsetTop + 20; for (let i = 0; i < 100 && T.S.cur !== 900; i++) await wait(50); }
          r.allerPage901 = Math.round(t() - t0) + ' ms (page ' + (T.S.cur + 1) + ')';
          T.S.pages[5].items.push({ type: 'text', at: [60, 500], size: 14, color: '#001871', text: 'Modification' }); T.S.dirty = true;
          t0 = t(); for (let i = 0; i < 5; i++) window.__edupdf.S.pages.length && (await (window.__teacher && window.__teacher.recoveryTick ? Promise.resolve() : 0)); r.verificationChangement = Math.round((t() - t0) / 5) + ' ms';
          t0 = t(); JSON.stringify({ pages: T.S.pages }); r.instantaneEtat = Math.round(t() - t0) + ' ms';
          t0 = t(); const out = await T.buildPdf(); r.enregistrement = Math.round(t() - t0) + ' ms / ' + Math.round(out.length / 1048576) + ' Mo';
          r.memoireJS = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + ' Mo (limite ' + Math.round(performance.memory.jsHeapSizeLimit / 1048576) + ' Mo)' : '?';
          T.S.dirty = false; T.actions.close(); return r;
        })()`, 600000);
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
        TE.PREFS.recoveryMin = 1; T.S.dirty = true; await TE.recoveryTick(true);
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
      // ---------- 1.13.0 : outils à bascule, pages identiques, notes (et relevé conservé dans le PDF) ----------
      await step('v113', `(async () => {
        const T = window.__edupdf; const TE = window.__teacher; const out = {}; const q = (s) => document.querySelector(s); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const A0 = window.alert, C0 = window.confirm; const alerts = []; window.alert = (m) => alerts.push(String(m).slice(0, 80)); window.confirm = () => true; out.alertes = alerts;
        const reset = () => { for (let i = 0; i < 12 && (T.S.pages.length || document.querySelectorAll('#docTabs .dtab').length > 1); i++) { T.S.dirty = false; T.actions.close(); } };
        reset(); const d = await PDFLib.PDFDocument.create(); d.addPage([842, 595]); await T.insertPdf(await d.save()); T.S.cur = 0; T.refresh(); await wait(700);
        out.outilParDefaut = T.S.tool;
        const hl = q('#ribbon [data-tool="highlight"]'); hl.click(); const actif = T.S.tool; hl.click(); out.bascule = actif + ' → ' + T.S.tool;
        await T.actions.blank(); const pg = await T.getPdfPage(T.S.pages[1]); out.pageIdentique = T.S.pages.length + ' pages, ' + Math.round(pg.view[2]) + '×' + Math.round(pg.view[3]);
        // notes : 14,5/20 « Bien » page 1, 8/20 « Insuffisant » page 2
        const noter = async (page, note, appr) => {
          T.S.cur = page; T.S.sel = new Set([page]); T.refresh(); await wait(500);
          const ov = q('#overlayLayer'); const r = ov.getBoundingClientRect();
          ov.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: r.left + 200, clientY: r.top + 150 })); await wait(400);
          q('#mkNote').value = note; q('#mkSur').value = '20'; q('#mkAppr').value = appr; q('#mBtns button.primary').click(); await wait(500);
        };
        q('#ribbon [data-panel="classe"] [data-tool="mark"]').click(); out.outilNoter = T.S.tool;
        T.S.cur = 0; T.refresh(); await wait(400);
        { const ov = q('#overlayLayer'); const r = ov.getBoundingClientRect(); ov.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: r.left + 200, clientY: r.top + 150 })); await wait(400);
          out.fenetre = q('#mTitle').textContent; q('#mkNote').value = '25'; q('#mBtns button.primary').click(); await wait(150); out.noteHorsBareme = q('#mkErr').textContent;
          [...document.querySelectorAll('#mBtns button')].find((b) => /Annuler/.test(b.textContent)).click(); await wait(200); }
        await noter(0, '14,5', 'Bien'); await noter(1, '8', 'Insuffisant');
        out.notesInscrites = T.S.pages.map((p) => p.items.filter((o) => o.mark).map((o) => o.mark.note + '/' + o.mark.sur + ' ' + o.mark.appr).join(',')).join(' | ');
        out.outilResteActif = T.S.tool; q('#ribbon [data-panel="classe"] [data-tool="mark"]').click(); out.outilArrete = T.S.tool;
        const releve = async () => { const pr = TE.marksSummary(); await wait(400); const t = q('#modal').hidden ? '(aucune fenêtre)' : q('#mBody').textContent.replace(/\\s+/g, ' ').slice(0, 90); const b = [...document.querySelectorAll('#mBtns button')].find((x) => /Fermer/.test(x.textContent)); if (b) b.click(); await pr; return t; };
        out.releve = await releve();
        // enregistré puis rouvert : le relevé retrouve les notes
        const bytes = await T.buildPdf(); reset(); await T.insertPdf(bytes); T.S.cur = 0; T.refresh(); await wait(500);
        out.releveApresReouverture = await releve();
        // modèle Seyès : la nouvelle page reprend le modèle
        reset(); q('[data-tpl="seyes"]').click(); await wait(1500); await T.actions.blank();
        out.modeleRepris = T.S.pages.length + ' pages, modèle ' + (T.S.sources[T.S.pages[1].src].tpl || 'aucun');
        const ok = out.outilParDefaut === 'select' && out.bascule === 'highlight → select' && out.pageIdentique === '2 pages, 842×595' && out.outilNoter === 'mark'
          && /0 et 20/.test(out.noteHorsBareme) && out.notesInscrites === '14.5/20 Bien | 8/20 Insuffisant' && out.outilArrete === 'select'
          && /2 note/.test(out.releve) && /11,25/.test(out.releve) && /2 note/.test(out.releveApresReouverture) && /11,25/.test(out.releveApresReouverture) && out.modeleRepris === '2 pages, modèle seyes';
        window.alert = A0; window.confirm = C0;
        if (!ok) throw new Error('Résultat inattendu : ' + JSON.stringify(out));
        reset(); return out;
      })()`);
      // ---------- Tous les boutons du ruban et tous les outils : aucun ne provoque d'erreur ----------
      await step('tous-les-boutons', `(async () => {
        const T = window.__edupdf; const q = (s) => document.querySelector(s); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const errs = []; let cur = ''; const onErr = (e) => errs.push(cur + ' : ' + String((e.reason && (e.reason.stack || e.reason.message || e.reason)) || e.message || e).slice(0, 160));
        window.addEventListener('error', onErr); window.addEventListener('unhandledrejection', onErr);
        const A0 = window.alert, C0 = window.confirm; const alerts = []; window.alert = (m) => alerts.push(String(m).slice(0, 60)); window.confirm = () => false;
        // ouvrent une fenêtre du système (fichier, impression, navigateur), quittent l'affichage normal, ou sont testés à part
        const SKIP = new Set(['open', 'new', 'save', 'saveAs', 'cloudSave', 'cloudOpen', 'fromImages', 'insertFiles', 'scan', 'convertOffice', 'print', 'admin', 'language', 'close', 'certSign',
          'slideshow', 'slideshowHere', 'speak', 'classroom', 'exportOrigin', 'toWord', 'toExcel', 'toPpt', 'exportAs', 'toImages', 'toText', 'split', 'extract', 'commentLocked',
          'aiSubscription', 'ocrAll', 'ocrPage', 'scanCopy', 'compress', 'protect', 'checkUpdate']);
        const fresh = async () => {
          for (let i = 0; i < 12 && (T.S.pages.length || document.querySelectorAll('#docTabs .dtab').length > 1); i++) { T.S.dirty = false; T.actions.close(); }
          const d = await PDFLib.PDFDocument.create(); for (let i = 0; i < 3; i++) d.addPage([595, 842]).drawText('Page ' + (i + 1), { x: 60, y: 760, size: 24 });
          await T.insertPdf(await d.save()); T.S.cur = 0; T.S.sel = new Set([0]); T.refresh(); await wait(300);
        };
        const settle = async () => {
          for (let k = 0; k < 60; k++) {
            await wait(150);
            if (!q('#modal').hidden) { const bs = [...document.querySelectorAll('#mBtns button')]; const b = bs.find((x) => /^(Annuler|Fermer|Plus tard|Non|Cancel|Close|Later)/i.test(x.textContent.trim())) || bs[0]; if (b) b.click(); else return; }
            else if (q('#busy').hidden) return;
          }
        };
        await fresh(); const res = []; const modals = [];
        const acts = [...new Set([...document.querySelectorAll('#ribbon [data-act], #welcome [data-act], #side [data-act], #footer [data-act], footer [data-act]')].map((b) => b.dataset.act))].filter((a) => !SKIP.has(a));
        for (const a of acts) {
          cur = a; const n0 = errs.length;
          document.querySelector('[data-act="' + a + '"]').click(); await wait(300);
          if (!q('#modal').hidden) modals.push(a);
          await settle();
          if (a === 'viewMode') { T.actions.viewMode(); await wait(300); } // retour à l'affichage d'origine
          if (!q('#findBar').hidden) q('#findClose').click();
          if (!T.S.pages.length || T.S.pages.length > 12) await fresh();
          res.push(errs.length > n0 ? a + ' ✗' : a);
        }
        if (!q('#aiPanel').hidden) T.actions.aiPanel();
        cur = 'outils'; T.setTool('select'); await fresh(); const tools = [...new Set([...document.querySelectorAll('#ribbon [data-tool]')].map((b) => b.dataset.tool))]; const badTools = []; const toolModals = [];
        for (const t of tools) {
          const b = document.querySelector('#ribbon [data-tool="' + t + '"]'); b.click(); await wait(80); const on = T.S.tool; if (!q('#modal').hidden) { toolModals.push(t + ' : ' + q('#mTitle').textContent + ' / ' + q('#mBody').textContent.slice(0, 120) + ' / ro=' + (q('#roTag') && !q('#roTag').hidden)); await settle(); }
          b.click(); await wait(80); if (!q('#modal').hidden) await settle();
          if (on !== t || T.S.tool !== 'select') badTools.push(t + ' : ' + on + ' puis ' + T.S.tool);
        }
        window.alert = A0; window.confirm = C0; window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onErr);
        T.setTool('select'); T.S.dirty = false;
        const out = { actionsCliquees: acts.length, fenetresOuvertesPuisFermees: modals.length, messages: alerts.length, outilsTestes: tools.length, outilsEnDefaut: badTools, fenetresOutils: toolModals };
        if (errs.length || badTools.length) throw new Error('Erreurs : ' + errs.join(' || ') + ' — outils : ' + badTools.join(', ') + ' — ' + JSON.stringify(out));
        return out;
      })()`, 240000);
      await step('langue', `(async () => {
        const F = window.__features; const q = (s) => document.querySelector(s); const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const out = {};
        const T = window.__edupdf; T.S.dirty = false;
        F.setLanguage('en'); await wait(400);
        out.onglets = [...document.querySelectorAll('#tabs [data-tab]')].map((b) => b.textContent.trim()).join(', ');
        out.infobulle = q('#sbMode').title.split('\\n').join(' / ');
        out.accueil = (q('#homeSide .hi') || {}).title;
        out.boutonDeuxLignes = (q('[data-act=headerFooter]') || {}).textContent;
        // textes encore en français dans l'interface visible (hors document)
        const FR = /\\b(le|la|les|des|du|une|pour|avec|dans|sur|cliquez|enregistrer|ouvrir|fichier|page suivante|modifier)\\b|[éèêàùç]/i;
        const left = new Set();
        const walk = (el) => {
          if (el.nodeType === 3) { const v = el.nodeValue.trim(); if (v && FR.test(v) && el.parentElement && !el.parentElement.closest('#pageBox,#thumbs,#aiOut,#pageStack,#ocrText,#aiPrompt,#modal[hidden],#docTabs,script,style')) left.add(v.slice(0, 60)); return; }
          if (el.nodeType !== 1 || el.closest('#pageBox,#thumbs,#pageStack,#docTabs')) return;
          for (const at of ['title', 'placeholder', 'aria-label']) { const v = el.getAttribute(at); if (v && FR.test(v)) left.add('[' + at + '] ' + v.split('\\n')[0].slice(0, 60)); }
          el.childNodes.forEach(walk);
        };
        walk(document.body); out.resteFrancais = left.size;
        window.__left = [...left];
        T.actions.prefs(); await wait(400); out.dialogue = q('#mTitle').textContent + ' | ' + [...document.querySelectorAll('#mBody label')].slice(0, 3).map((l) => l.textContent.trim().slice(0, 30)).join(' | ');
        q('#mBtns button').click(); await wait(200);
        window.api.version && 0; document.querySelector('#msg').textContent = 'Conversion impossible : délai dépassé'; await wait(100); out.messageCompose = q('#msg').textContent;
        F.setLanguage('fr'); await wait(400);
        out.retourFrancais = [...document.querySelectorAll('#tabs [data-tab]')].slice(0, 3).map((b) => b.textContent.trim()).join(', ') + ' | ' + q('#sbMode').title.split('\\n')[0];
        return out;
      })()`);
      if (process.env.EDUPDF_I18N_DEBUG) await step('reste-0', `(window.__left || []).slice(0, 9).join(" || ")`);
      if (process.env.EDUPDF_I18N_DEBUG) await step('reste-1', `(window.__left || []).slice(9, 18).join(" || ")`);
      if (process.env.EDUPDF_I18N_DEBUG) await step('reste-2', `(window.__left || []).slice(18, 27).join(" || ")`);
      if (process.env.EDUPDF_I18N_DEBUG) await step('reste-3', `(window.__left || []).slice(27, 36).join(" || ")`);
      if (process.env.EDUPDF_I18N_DEBUG) await step('reste-4', `(window.__left || []).slice(36, 45).join(" || ")`);
      if (process.env.EDUPDF_I18N_DEBUG) await step('reste-5', `(window.__left || []).slice(45, 54).join(" || ")`);
      if (process.env.EDUPDF_I18N_DEBUG) await step('reste-6', `(window.__left || []).slice(54, 63).join(" || ")`);
      if (process.env.EDUPDF_I18N_DEBUG) await step('reste-7', `(window.__left || []).slice(63, 72).join(" || ")`);
      // ---------- Compte obligatoire, essai de 30 jours lié au poste, fonctions Premium ----------
      {
        const ACC = require('./account');
        const recFiles = ['a', 'b', 'c'].map((n) => path.join(outDir, 'essai', n, '.sknedu'));
        await step('essai-compte', `(async () => {
          const L = await window.api.licenseStatus(); const q = (s) => document.querySelector(s);
          await new Promise((r) => setTimeout(r, 300));
          return { mode: L.mode, compte: L.account && L.account.email, jours: L.trial.daysLeft, premium: L.premium, etablissement: L.establishment,
            codePoste: /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/.test(L.machineCode), barre: q('#editionTag').textContent, verrous: document.querySelectorAll('.plocked').length,
            boutonsPremium: document.querySelectorAll('.premium').length, fenetreCompte: q('#modal').hidden ? 'fermée' : q('#mTitle').textContent };
        })()`);
        try {
          const start0 = ACC.status().trial.start;
          fs.rmSync(recFiles[2], { force: true });
          const apresSuppression = ACC.status().trial.start === start0;
          ACC.touch(); const repare = fs.existsSync(recFiles[2]);
          ACC.save({ email: 'autre.adresse@ecole.test', name: 'Autre' }); const irreversible = ACC.status().trial.start === start0;
          ACC.save({ email: 'enseignant@ecole.test', name: 'Mme Test', org: 'Lycée Test' });
          const blob = fs.readFileSync(recFiles[0], 'utf8'); const chiffre = blob.startsWith('G1.') && !blob.includes('ecole') && !Buffer.from(blob.split('.')[2], 'base64url').toString('latin1').includes('ecole');
          const parts = blob.split('.'); parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1); fs.writeFileSync(recFiles[0], parts.join('.'));
          const falsifieIgnore = ACC.status().trial.start === start0 && ACC.status().trial.daysLeft === 30;
          fs.writeFileSync(recFiles[0], blob);
          log('OK   essai-persistance', JSON.stringify({ chiffreAES256GCM: chiffre, apresSuppression, repare, irreversible, falsifieIgnore, emplacements: recFiles.filter((f) => fs.existsSync(f)).length }));
        } catch (e) { log('FAIL essai-persistance', e.stack); results.essai = { error: e.message }; }
        process.env.EDUPDF_NOW_OFFSET_DAYS = '31';
        await step('essai-termine', `(async () => {
          const T = window.__edupdf; const q = (s) => document.querySelector(s); const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const out = {};
          const L = await window.__licensing.refresh(); out.mode = L.mode + ' / premium ' + L.premium + ' / essai terminé ' + L.trial.ended;
          out.barre = q('#editionTag').textContent; out.verrous = document.querySelectorAll('.plocked').length;
          out.conversionBloquee = window.premiumGate('act', 'toWord') === false && q('#mTitle').textContent; q('#mBtns button').click(); await wait(150);
          out.gratuitPermis = window.premiumGate('act', 'rotR') === true && window.premiumGate('act', 'print') === true && window.premiumGate('tool', 'highlight') === true;
          T.setTool('edit'); await wait(100); out.outilModifierRefuse = T.S.tool === 'select'; if (!q('#modal').hidden) q('#mBtns button').click(); await wait(100);
          try { await window.api.pdfToOffice(new Uint8Array([37, 80, 68, 70]), 'docx', 'x.docx'); out.gardeSysteme = 'NON BLOQUÉ'; } catch (e) { out.gardeSysteme = /PREMIUM/.test(e.message) ? 'bloqué' : e.message.slice(0, 60); }
          try { await window.api.aiChat({ id: 'x', system: '', prompt: 'ok' }); out.gardeIA = 'NON BLOQUÉ'; } catch (e) { out.gardeIA = /PREMIUM/.test(e.message) ? 'bloqué' : e.message.slice(0, 60); }
          return out;
        })()`);
        process.env.EDUPDF_NOW_OFFSET_DAYS = '-1';
        await step('horloge-reculee', `(async () => { const T = window.__edupdf; await window.__licensing.refresh(); const L = await window.api.licenseStatus(); return { mode: L.mode, horlogeReculee: L.trial.clockBack, barre: document.querySelector('#editionTag').textContent }; })()`);
        // licence liée au compte et au poste (si la clé de l'éditeur est sur ce PC)
        const priv = ['SknEDUpdf-licences', 'SknEDU-licences'].map((d) => path.join(require('os').homedir(), d, 'cle-privee-licences.pem')).find((f) => fs.existsSync(f));
        if (priv) {
          const crypto = require('crypto');
          const mk = (extra) => { const data = Buffer.from(JSON.stringify({ v: 1, product: 'SknEDU-studio', edition: 'enseignant', org: 'Mme Test', seats: 1, ref: 'TEST-LIEE', issued: '2026-11-08', expires: '2099-12-31', ...extra })).toString('base64url'); return `SKN1.${data}.${crypto.sign(null, Buffer.from(data), crypto.createPrivateKey(fs.readFileSync(priv))).toString('base64url')}`; };
          process.env.EDUPDF_NOW_OFFSET_DAYS = '31';
          await step('licence-liee', `(async () => {
            const T = window.__edupdf; const out = {};
            try { await window.api.licenseActivate(${JSON.stringify(mk({ email: 'quelquun@ailleurs.test' }))}, 'user'); out.autreEmail = 'ACCEPTÉE (anomalie)'; } catch (e) { out.autreEmail = e.message.replace(/^.*Error: /, '').slice(0, 70); }
            try { await window.api.licenseActivate(${JSON.stringify(mk({ email: 'enseignant@ecole.test', machines: ['AAAA-BBBB-CCCC-DDDD'] }))}, 'user'); out.autrePoste = 'ACCEPTÉE (anomalie)'; } catch (e) { out.autrePoste = e.message.replace(/^.*Error: /, '').slice(0, 70); }
            const st = await window.api.licenseActivate(${JSON.stringify(mk({ email: 'Enseignant@Ecole.test', machines: [ACC.machineCode()] }))}, 'user');
            await window.__licensing.refresh(); out.bonneLicence = st.mode + ' / premium ' + st.premium + ' / ' + document.querySelector('#editionTag').textContent;
            out.verrousApresLicence = document.querySelectorAll('.plocked').length;
            await window.api.licenseRemove(); return out;
          })()`);
        } else log('SKIP', 'licence-liee', '(clé de l\'éditeur absente sur ce PC)');
        process.env.EDUPDF_NOW_OFFSET_DAYS = '0';
        await step('essai-retour', `(async () => { const T = window.__edupdf; await window.__licensing.refresh(); const L = await window.api.licenseStatus(); return { mode: L.mode, verrous: document.querySelectorAll('.plocked').length }; })()`);
        // fenêtre de création du compte (premier démarrage), parcourue comme un utilisateur
        for (const f of recFiles) fs.rmSync(f, { force: true });
        await step('fenetre-compte', `(async () => {
          const q = (s) => document.querySelector(s); const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const out = {};
          const p = window.__licensing.ensureAccount(); await wait(500);
          out.titre = q('#mTitle').textContent; out.boutons = [...document.querySelectorAll('#mBtns button')].map((b) => b.textContent).join(' | ');
          q('#acEmail').value = 'pas-une-adresse'; q('#mBtns button.primary').click(); await wait(150); out.adresseInvalide = q('#acErr').textContent;
          q('#acEmail').value = 'Nouvel.Enseignant@Ecole.test'; q('#acName').value = 'M. Nouveau'; q('#mBtns button.primary').click(); await wait(150); out.sansAccord = q('#acErr').textContent;
          window.__shot = true; return out;
        })()`);
        try { fs.writeFileSync(path.join(outDir, 'compte.png'), (await win.webContents.capturePage()).toPNG()); } catch (e) { log('note capture compte', e.message); }
        await step('fenetre-compte-fin', `(async () => {
          const q = (s) => document.querySelector(s); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          q('#acOk').checked = true; q('#mBtns button.primary').click(); await wait(800);
          const L = await window.api.licenseStatus();
          return { fenetreFermee: q('#modal').hidden, compte: L.account && L.account.email, mode: L.mode, jours: L.trial.daysLeft, message: q('#msg').textContent.slice(0, 70) };
        })()`);
      // ---------- Licences en ligne : un poste à la fois, transfert pour les jours restants, cumul de 2 (service local de test) ----------
      if (!fs.existsSync(path.join(__dirname, '..', 'server', 'core.js'))) log('SKIP', 'licences-en-ligne', '(service absent de la version installée)'); else {
        const crypto = require('crypto'); const http = require('http'); const ACC2 = require('./account');
        const { createService, handle } = require('../server/core');
        const kl = crypto.generateKeyPairSync('ed25519'); const ks = crypto.generateKeyPairSync('ed25519');
        const db = new Map(); const DAYMS = 86400000;
        const svc = createService({
          store: { get: async (k) => (db.has(k) ? JSON.parse(db.get(k)) : null), put: async (k, v) => db.set(k, JSON.stringify(v)) },
          now: () => Date.now() + (Number(process.env.EDUPDF_NOW_OFFSET_DAYS) || 0) * DAYMS,
          verifyLicence: async (d, s) => crypto.verify(null, Buffer.from(d), kl.publicKey, Buffer.from(s, 'base64url')),
          sign: async (d) => crypto.sign(null, Buffer.from(d), ks.privateKey).toString('base64url')
        });
        const srv = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', async () => { let b = null; try { b = JSON.parse(Buffer.concat(c).toString()); } catch { /* */ } const r = await handle(svc, req.method, req.url, b); res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r.body)); }); });
        await new Promise((r) => srv.listen(0, '127.0.0.1', r));
        process.env.EDUPDF_LICENCE_SERVER = `http://127.0.0.1:${srv.address().port}`;
        process.env.EDUPDF_TEST_SERVER_PUBKEY = ks.publicKey.export({ type: 'spki', format: 'pem' });
        process.env.EDUPDF_TEST_LICENCE_PUBKEY = kl.publicKey.export({ type: 'spki', format: 'pem' });
        const email = ACC2.status().account.email;
        const mk = (p) => { const data = Buffer.from(JSON.stringify({ v: 2, product: 'SknEDU-studio', issued: '2026-11-08', email, ...p })).toString('base64url'); return `SKN1.${data}.${crypto.sign(null, Buffer.from(data), kl.privateKey).toString('base64url')}`; };
        const L1 = mk({ ref: 'EN-LIGNE-1', edition: 'enseignant', org: 'Mme Test', days: 365 });
        const L2 = mk({ ref: 'EN-LIGNE-2', edition: 'etablissement', org: 'Lycée Test', days: 30 });
        const L3 = mk({ ref: 'EN-LIGNE-3', edition: 'enseignant', days: 90 });
        const B = 'f'.repeat(32);
        const msgOf = async (p) => { try { await p; return 'ACCEPTÉ'; } catch (e) { return String(e.message).replace(/^.*Error: /, '').slice(0, 75); } };
        await step('licence-en-ligne-1', `(async () => {
          const out = {}; const m = async (p) => { try { await p; return 'ACCEPTÉ'; } catch (e) { return String(e.message).replace(/^.*Error: /, '').slice(0, 75); } };
          let L = await window.api.licenseActivate(${JSON.stringify(L1)}, 'user'); out.l1 = L.mode + ' / ' + L.daysLeft + ' j / ' + L.licences.length + ' licence';
          L = await window.api.licenseActivate(${JSON.stringify(L2)}, 'user'); out.cumul = L.daysLeft + ' j / ' + L.label + ' / ' + L.licences.map((l) => l.remainingDays).join('+');
          out.troisieme = await m(window.api.licenseActivate(${JSON.stringify(L3)}, 'user'));
          return out;
        })()`);
        const autrePosteRefuse = await msgOf(svc.activate({ key: L1, email, machine: B }));
        await step('licence-en-ligne-2', `(async () => {
          const out = {}; const m = async (p) => { try { await p; return 'ACCEPTÉ'; } catch (e) { return String(e.message).replace(/^.*Error: /, '').slice(0, 75); } };
          const d = await window.api.licenseDeactivate('EN-LIGNE-1'); out.desactivee = d.remainingDays + ' j gardés ; ce PC : ' + d.daysLeft + ' j';
          return out;
        })()`);
        const transfert = await msgOf(svc.activate({ key: L1, email, machine: B }));
        const surB = (await svc.status({ email, machine: B })).licences.map((l) => l.ref + ' ' + l.remainingDays + ' j').join(', ');
        await step('licence-en-ligne-3', `(async () => {
          const m = async (p) => { try { await p; return 'ACCEPTÉ'; } catch (e) { return String(e.message).replace(/^.*Error: /, '').slice(0, 75); } };
          return { retourSurA: await m(window.api.licenseActivate(${JSON.stringify(L1)}, 'user')) };
        })()`);
        log('OK   licence-autre-poste', JSON.stringify({ autrePosteRefuse, transfert, surB }));
        await svc.deactivate({ ref: 'EN-LIGNE-1', email, machine: B });
        // jeton falsifié : ignoré
        const tokFile = path.join(outDir, 'userdata', 'licence-jeton.sknt'); const tok = fs.readFileSync(tokFile, 'utf8');
        fs.writeFileSync(tokFile, tok.replace(/\.([A-Za-z0-9_-])/, (m0, c) => '.' + (c === 'A' ? 'B' : 'A')));
        await step('licence-jeton-falsifie', `(async () => { const L = await window.api.licenseStatus(); return { licenceValide: L.licValid, mode: L.mode }; })()`);
        fs.writeFileSync(tokFile, tok);
        // 20 jours sans vérification en ligne puis vérification : jours décomptés, licence de nouveau valable
        process.env.EDUPDF_NOW_OFFSET_DAYS = '20';
        await step('licence-14-jours', `(async () => {
          const out = {}; let L = await window.api.licenseStatus(); out.avantVerification = 'valide ' + L.licValid + ' / ' + (L.mismatch || '').slice(0, 40);
          L = await window.api.licenseRefresh(); out.apresVerification = 'valide ' + L.licValid + ' / ' + L.daysLeft + ' j restants';
          await window.__licensing.refresh(); const d = window.__licensing.licenceDialog(); await new Promise((r) => setTimeout(r, 800));
          out.fenetre = document.querySelectorAll('#mBody .licrow').length + ' licence(s) affichée(s), ' + document.querySelectorAll('#mBody [data-deact]').length + ' bouton(s) Désactiver';
          const bs = [...document.querySelectorAll('#mBtns button')]; bs[bs.length - 2].click(); await d;
          await window.api.licenseDeactivate('EN-LIGNE-2'); out.final = (await window.api.licenseStatus()).mode;
          return out;
        })()`);
        process.env.EDUPDF_NOW_OFFSET_DAYS = '0';
        delete process.env.EDUPDF_LICENCE_SERVER; srv.close();
      }

      }

      // ---------- Commande d'une licence : offres, Mobile Money, code de commande (aucun message réellement envoyé) ----------
      process.env.EDUPDF_TEST_SALES = JSON.stringify({ whatsapp: '+225 07 00 00 00 00', email: 'ventes@exemple.ci', page: 'https://exemple.ci/paiement',
        mobileMoney: [{ operateur: 'Orange Money', numero: '0700000000' }, { operateur: 'Wave', numero: '0500000000' }, { operateur: 'MTN MoMo', numero: '' }],
        offres: [{ id: 'ens-1a', edition: 'enseignant', jours: 365, libelle: 'Enseignant — 1 an', prix: '15000' }, { id: 'etab-1a', edition: 'etablissement', jours: 365, libelle: 'Établissement — 1 an (par poste)', prix: '7000', parPoste: true }] });
      await step('commande-licence', `(async () => {
        const q = (s) => document.querySelector(s); const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const out = {};
        await window.__licensing.refresh();
        let p = window.__licensing.purchaseDialog(); await wait(500);
        out.titre = q('#mTitle').textContent; out.boutons = [...document.querySelectorAll('#mBtns button')].map((b) => b.textContent).join(' | ');
        out.offres = [...document.querySelectorAll('#poOffre option')].map((o) => o.textContent).join(' / ');
        out.postesMasques = q('#poQteRow').hidden;
        q('#poOffre').value = '1'; q('#poOffre').dispatchEvent(new Event('change', { bubbles: true })); await wait(100); out.postesVisibles = !q('#poQteRow').hidden;
        q('#poQte').value = '3'; [...document.querySelectorAll('#mBtns button')].find((b) => b.textContent === 'Mobile Money').click(); await wait(600);
        out.mobileMoney = q('#mTitle').textContent + ' | ' + q('#mBody').textContent.replace(/\\s+/g, ' ').slice(0, 150);
        out.boutonsPaiement = [...document.querySelectorAll('#mBtns button')].map((b) => b.textContent).join(' | ');
        [...document.querySelectorAll('#mBtns button')].find((b) => b.textContent === 'Fermer').click(); await p; await wait(100);
        const o = window.__derniereCommande; const d = JSON.parse(decodeURIComponent(escape(atob(o.code.slice(5).replace(/-/g, '+').replace(/_/g, '/')))));
        out.commande = o.ref + ' | ' + d.edition + ' ' + d.jours + ' j × ' + d.qte + ' | ' + d.email + ' | poste ' + d.poste;
        out.texte = o.text.split('\\n').slice(0, 2).join(' / ');
        return out;
      })()`);
      delete process.env.EDUPDF_TEST_SALES;
      await step('commande-reglages-reels', `(async () => {
        const q = (s) => document.querySelector(s); const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const out = {};
        const L = await window.__licensing.refresh(); const sv = L.sales;
        out.contacts = 'WhatsApp ' + sv.whatsapp + ' | e-mail ' + sv.email + ' | ' + sv.mobileMoney.map((m) => m.operateur + ' ' + m.numero + ' (' + m.nom + ')').join(', ');
        const p = window.__licensing.purchaseDialog(); await wait(500);
        out.offres = [...document.querySelectorAll('#poOffre option')].map((o) => o.textContent).join(' / ');
        out.canaux = [...document.querySelectorAll('#mBtns button')].map((b) => b.textContent).join(' | ');
        q('#poOffre').value = '3'; q('#poOffre').dispatchEvent(new Event('change', { bubbles: true })); await wait(100);
        out.minimum = q('#poQte').min + ' / ' + q('#poQte').value; q('#poQte').value = '4';
        [...document.querySelectorAll('#mBtns button')].find((b) => b.textContent === 'Mobile Money').click(); await wait(600);
        out.paiement = q('#mBody').textContent.replace(/\\s+/g, ' ').slice(0, 120);
        [...document.querySelectorAll('#mBtns button')].find((b) => b.textContent === 'Fermer').click(); await p;
        out.lienWhatsApp = 'https://wa.me/' + sv.whatsapp + '?text=…';
        return out;
      })()`);

      // ---------- Tests d'intrusion automatisés : tentatives de détournement du logiciel (doivent toutes échouer) ----------
      {
        const ud = path.join(outDir, 'userdata');
        await step('intrusion-interface', `(async () => {
          const out = {}; const refuse = async (p) => { try { const r = await p; return r === null || r === undefined || (Array.isArray(r) && !r.length) ? 'refusé' : 'ACCEPTÉ : ' + JSON.stringify(r).slice(0, 60); } catch (e) { return 'refusé'; } };
          out.lectureFichiersSysteme = await refuse(window.api.loadPaths(['C:\\\\Windows\\\\win.ini', 'C:\\\\Windows\\\\System32\\\\drivers\\\\etc\\\\hosts', '..\\\\..\\\\secret.pdf', 'relatif.pdf', 'C:\\\\Windows\\\\System32\\\\config\\\\SAM']));
          out.deverrouillageFichierArbitraire = await refuse(window.api.unlockOffice('C:\\\\Windows\\\\win.ini', 'x'));
          out.certificatArbitraire = await refuse(window.api.signPdf({ bytes: new Uint8Array([37, 80, 68, 70]), certPath: 'C:\\\\Windows\\\\win.ini', passphrase: 'x' }));
          out.liensDangereux = [await refuse(window.api.openExternal('file:///C:/Windows/win.ini')), await refuse(window.api.openExternal('javascript:alert(1)')), await refuse(window.api.openExternal('http://exemple.ci'))].join(' / ');
          out.cloudArbitraire = await refuse(window.api.cloudAutosave('C:\\\\Windows', new Uint8Array([1]), 'x.pdf'));
          out.nouvelleFenetre = window.open('file:///C:/Windows/') === null ? 'refusée' : 'OUVERTE';
          out.camera = await navigator.mediaDevices.getUserMedia({ video: true }).then(() => 'ACCORDÉE', (e) => 'refusée (' + e.name + ')');
          out.localisation = await new Promise((r) => navigator.geolocation.getCurrentPosition(() => r('ACCORDÉE'), (e) => r('refusée (' + e.code + ')'), { timeout: 3000 }));
          out.notifications = await Notification.requestPermission();
          const rid = await window.api.recoverySave('..\\\\..\\\\..\\\\evasion', 'x.pdf', new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10]));
          out.recuperation = rid ? 'écrite (dans son dossier : vérifié ci-dessous)' : 'refusée';
          out.cheminForge = await refuse(window.api.loadPaths([window.api.pathForFile({ path: 'C:\\\\Windows\\\\win.ini' }) || 'C:\\\\Windows\\\\win.ini']));
          const bad = Object.entries(out).filter(([, v]) => /ACCEPTÉ|OUVERTE|ACCORDÉE|^granted$/.test(String(v)));
          if (bad.length) throw new Error('INTRUSION POSSIBLE : ' + JSON.stringify(bad).slice(0, 300));
          return out;
        })()`);
        try { // vérifications sur le disque
          const recDir = path.join(ud, 'recuperation'); const files = fs.existsSync(recDir) ? fs.readdirSync(recDir) : [];
          const evasion = ['evasion.pdf', '../evasion.pdf', '../../evasion.pdf', '../../../evasion.pdf'].some((f) => fs.existsSync(path.join(recDir, f)) && f !== 'evasion.pdf');
          const enc = files.filter((f) => f.endsWith('.pdf')).map((f) => fs.readFileSync(path.join(recDir, f)).subarray(0, 5).toString());
          const admin = (() => { try { const a = JSON.parse(fs.readFileSync(path.join(ud, 'admin.json'), 'utf8')); return a.pwHash && (a.pwHash.N || 16384); } catch { return 'pas d\'administrateur sur ce poste de test'; } })();
          const key = fs.existsSync(path.join(ud, 'cle-donnees.bin')) ? fs.readFileSync(path.join(ud, 'cle-donnees.bin')).subarray(0, 1).toString() : '?';
          log((evasion ? 'FAIL ' : 'OK   ') + 'intrusion-disque', JSON.stringify({ copieConfinee: !evasion, copiesChiffreesAES256GCM: enc.every((h) => h === 'SKNE1') && enc.length > 0, cleDeDonnees: key === 'P' ? 'protégée par Windows (DPAPI)' : key, scryptAdministrateurN: admin }));
          await js('window.api.recoveryClear(\'evasion\')');
        } catch (e) { log('FAIL intrusion-disque', e.stack); }
        try { // classe connectée : nom d'élève piégé, jeton deviné
          const st = await js(`(async () => window.api.classroomStart({ bytes: await window.__edupdf.buildPdf(), title: 'Test', collect: true, fileName: 'fiche.pdf' }).then((s) => ({ url: s.url, dir: s.dir })))()`);
          const http = require('http'); const u = new URL(st.url + 'rendre'); const boundary = '----x' + Date.now();
          const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="eleve"\r\n\r\n../../../..\\evasion<script>\r\n--${boundary}\r\nContent-Disposition: form-data; name="copie"; filename="../../x.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.7 test\r\n--${boundary}--\r\n`)]);
          const post = await new Promise((res, rej) => { const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length } }, (rs) => { rs.resume(); rs.on('end', () => res(rs.statusCode)); }); r.on('error', rej); r.end(body); });
          const guess = await new Promise((res) => http.get(st.url.replace(/\/c\/[^/]+\//, '/c/AAAAAAAAAAAA/') + 'document.pdf', (r) => { r.resume(); res(r.statusCode); }).on('error', () => res('erreur')));
          const status = await js('window.api.classroomStatus()'); await js('window.api.classroomStop()');
          const saved = (status.received || []).map((r) => r.file);
          const confine = saved.every((f) => path.dirname(f) === st.dir && !/[\\/]\.\.|<|>/.test(path.basename(f)));
          log((confine && guess === 404 ? 'OK   ' : 'FAIL ') + 'intrusion-classe', JSON.stringify({ envoi: post, fichiers: saved.map((f) => path.basename(f)), confineDansLeDossierDeLaClasse: confine, jetonDevine: guess }));
        } catch (e) { log('FAIL intrusion-classe', e.stack); }
        try { // contre-épreuve : un fichier réellement choisi par l'utilisateur (hors des dossiers du logiciel) s'ouvre toujours
          const dropFile = path.join(require('os').tmpdir(), 'sknedu-depot-' + Date.now() + '.pdf');
          const { PDFDocument } = require('pdf-lib'); const d0 = await PDFDocument.create(); d0.addPage(); fs.writeFileSync(dropFile, await d0.save());
          await js("(() => { const i = document.createElement('input'); i.type = 'file'; i.id = '__depot'; i.hidden = true; document.body.appendChild(i); })()");
          const dbg = win.webContents.debugger; dbg.attach('1.3');
          const { root } = await dbg.sendCommand('DOM.getDocument');
          const { nodeId } = await dbg.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '#__depot' });
          await dbg.sendCommand('DOM.setFileInputFiles', { nodeId, files: [dropFile] }); dbg.detach();
          const r = await js("(async () => { const i = document.getElementById('__depot'); const p = window.api.pathForFile(i.files[0]); const f = await window.api.loadPaths([p]); i.remove(); return { cheminObtenu: !!p, ouvert: f.length === 1 && !f[0].error ? f[0].kind : 'NON' }; })()");
          log((r.ouvert === 'pdf' ? 'OK   ' : 'FAIL ') + 'depot-utilisateur', JSON.stringify(r));
          fs.rmSync(dropFile, { force: true });
        } catch (e) { log('FAIL depot-utilisateur', e.stack); }
      }

      // ---------- Licence (open core) : clé invalide refusée ; clé réelle testée si la clé de l'éditeur est sur ce PC ----------
      {
        let realKey = null;
        const priv = ['SknEDUpdf-licences', 'SknEDU-licences'].map((d) => path.join(require('os').homedir(), d, 'cle-privee-licences.pem')).find((f) => fs.existsSync(f));
        if (priv) {
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
