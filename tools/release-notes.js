#!/usr/bin/env node
// Notes d'une version tirées de CHANGELOG.md : node tools/release-notes.js 1.11.2 [--title]
//   sans option : écrit le contenu de la section (liste des changements) ;
//   --title     : écrit le titre de la version GitHub, « SknEDU-studio 1.11.2 — résumé ».
'use strict';
const fs = require('fs');
const path = require('path');

const v = String(process.argv[2] || '').replace(/^v/, '');
if (!v) { console.error('Usage : node tools/release-notes.js <version> [--title]'); process.exit(2); }
const md = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
const re = new RegExp(`^## \\[${v.replace(/\./g, '\\.')}\\] — (.+)$`, 'm');
const m = re.exec(md);
if (!m) { // version absente du CHANGELOG : notes génériques, la publication continue
  process.stdout.write(process.argv.includes('--title') ? `SknEDU-studio ${v}` : 'Mise à jour automatique de SknEDU-studio.\n');
  process.exit(0);
}
if (process.argv.includes('--title')) { process.stdout.write(`SknEDU-studio ${v} — ${m[1].trim()}`); process.exit(0); }
const start = m.index + m[0].length; const next = md.indexOf('\n## [', start);
const body = md.slice(start, next < 0 ? undefined : next).trim();
process.stdout.write(`${body}\n\nInstallée automatiquement sur les ordinateurs déjà équipés. Historique complet : CHANGELOG.md\n`);
