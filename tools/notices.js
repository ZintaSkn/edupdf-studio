#!/usr/bin/env node
// Génère THIRD_PARTY_NOTICES.md : composants libres inclus dans l'application et leurs licences.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tree = JSON.parse(execSync('npm ls --omit=dev --all --json', { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const seen = new Map();
(function walk(deps) {
  for (const [name, d] of Object.entries(deps || {})) {
    if (!d.version || seen.has(name + '@' + d.version)) { walk(d.dependencies); continue; }
    let lic = '?', repo = '';
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
      lic = typeof pj.license === 'string' ? pj.license : (pj.license && pj.license.type) || '?';
      repo = typeof pj.repository === 'string' ? pj.repository : (pj.repository && pj.repository.url) || pj.homepage || '';
    } catch { /* paquet imbriqué */ }
    seen.set(name + '@' + d.version, { name, version: d.version, lic, repo: repo.replace(/^git\+/, '').replace(/\.git$/, '') });
    walk(d.dependencies);
  }
})(tree.dependencies);
const rows = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
const md = `# Composants tiers — SknEDU-studio

SknEDU-studio est distribué sous licence AGPL-3.0-or-later (voir LICENSE). Il intègre les composants libres
suivants, chacun sous sa propre licence. Données de langue OCR : tessdata (Apache-2.0).
Code source complet : https://github.com/ksehibi/edupdf-studio

| Composant | Version | Licence |
|---|---|---|
${rows.map((r) => `| ${r.name} | ${r.version} | ${r.lic} |`).join('\n')}

Total : ${rows.length} composants.
`;
fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), md);
console.log(`THIRD_PARTY_NOTICES.md : ${rows.length} composants.`);
