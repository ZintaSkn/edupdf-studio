// SknEDU-studio — mise en place du contenu d'une mise à jour, après la fermeture de l'application.
// Lancé par src/codeupdate.js avec le programme du logiciel lui-même en mode Node (ELECTRON_RUN_AS_NODE) :
// aucun nouveau programme n'est exécuté. Étapes : attendre la fermeture, garder l'ancienne version (*.precedent),
// mettre la nouvelle en place, puis (si demandé) redémarrer et revenir à l'ancienne si le démarrage n'est pas confirmé.
'use strict';
process.noAsar = true; // « app.asar » est ici un fichier ordinaire
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const a = JSON.parse(process.argv[2] || '{}');
const log = (m) => { try { fs.appendFileSync(path.join(a.staging, 'journal.txt'), `[${new Date().toISOString()}] ${m}\n`); } catch { /* */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
// fichiers parfois retenus quelques secondes (fin des processus de l'application, antivirus) : nouvel essai
async function retry(fn, n = 60) { for (let i = 0; ; i++) { try { return fn(); } catch (e) { if (i >= n) throw e; await sleep(250); } } }
function move(from, to) {
  try { fs.renameSync(from, to); } catch (e) {
    if (e.code !== 'EXDEV') throw e; // autre disque : copie puis suppression
    fs.cpSync(from, to, { recursive: true }); fs.rmSync(from, { recursive: true, force: true });
  }
}
const ITEMS = [['app.asar.nouveau', 'app.asar'], ...(a.unpacked ? [['unpacked', 'app.asar.unpacked']] : [])];
async function swap() {
  const done = [];
  try {
    for (const [src, name] of ITEMS) {
      const cur = path.join(a.resources, name); const prev = cur + '.precedent';
      await retry(() => fs.rmSync(prev, { recursive: true, force: true }));
      if (fs.existsSync(cur)) await retry(() => fs.renameSync(cur, prev));
      done.push(name);
      await retry(() => move(path.join(a.staging, src), cur));
    }
    log(`contenu ${a.version} en place`); return true;
  } catch (e) { log(`échec de la mise en place : ${e.message}`); await restore(done); return false; }
}
async function restore(names) {
  for (const name of names) {
    const cur = path.join(a.resources, name); const prev = cur + '.precedent';
    if (!fs.existsSync(prev)) continue;
    await retry(() => fs.rmSync(cur, { recursive: true, force: true })); await retry(() => fs.renameSync(prev, cur));
  }
  log('version précédente rétablie');
}
function launch(args) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // le logiciel, pas le mode Node
  const c = spawn(a.exe, args, { detached: true, stdio: 'ignore', env }); c.unref(); return c;
}
(async () => {
  for (let i = 0; i < 240 && alive(a.pid); i++) await sleep(250); // fermeture de l'application (60 s au plus)
  if (alive(a.pid)) { log('application toujours ouverte : mise à jour reportée'); return; }
  await sleep(500);
  const ok = await swap();
  if (!a.relaunch) return;
  if (!ok) { launch((a.exeArgs || []).filter((x) => x !== '--apres-maj')); return; }
  try { fs.rmSync(a.marker, { force: true }); } catch { /* */ }
  const child = launch(a.exeArgs || []);
  const t0 = Date.now();
  while (Date.now() - t0 < (a.timeoutMs || 120000)) { if (fs.existsSync(a.marker)) { log(`démarrage de ${a.version} confirmé`); return; } await sleep(500); }
  log('démarrage non confirmé : retour à la version précédente');
  try { if (child.pid && alive(child.pid)) process.kill(child.pid); } catch { /* */ }
  await sleep(1500);
  await restore(ITEMS.map(([, n]) => n));
  launch((a.exeArgs || []).filter((x) => x !== '--apres-maj'));
})().catch((e) => log('erreur : ' + e.message));
