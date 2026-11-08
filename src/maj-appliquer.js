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

// Installation pour tous les utilisateurs (Program Files) : la mise en place passe par PowerShell (programme de Windows)
// avec l'autorisation d'un administrateur. Le contenu est d'abord copié dans le dossier protégé puis revérifié sur place
// (SHA-512 de la description signée) : il ne peut plus être substitué entre la vérification et l'échange.
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
// PowerShell de Windows par son chemin complet (jamais un autre trouvé dans le PATH), avec ses seuls modules système
const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const PS_HEAD = `$env:PSModulePath = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\Modules'
$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'
$res = ${q(a.resources)}; $st = ${q(a.staging)}
function Again([scriptblock]$b) { for ($i = 0; $i -lt 60; $i++) { try { & $b; return } catch { Start-Sleep -Milliseconds 250 } }; & $b }
$names = @('app.asar')${a.unpacked ? " + @('app.asar.unpacked')" : ''}
function Restore { foreach ($n in $names) { $cur = Join-Path $res $n; if (Test-Path -LiteralPath "$cur.precedent") { Again { if (Test-Path -LiteralPath $cur) { Remove-Item -LiteralPath $cur -Recurse -Force } }; Again { Rename-Item -LiteralPath "$cur.precedent" -NewName $n } } } }
`;
const PS_SWAP = PS_HEAD + `try {
  Copy-Item -LiteralPath (Join-Path $st 'app.asar.nouveau') -Destination (Join-Path $res 'app.asar.nouveau') -Force
  if ((Get-FileHash -LiteralPath (Join-Path $res 'app.asar.nouveau') -Algorithm SHA512).Hash -ne ${q(a.hex && a.hex.asar)}) { Remove-Item -LiteralPath (Join-Path $res 'app.asar.nouveau') -Force; exit 3 }
  if ($names.Count -gt 1) {
    $z = Join-Path $res 'maj-modules.zip'; Copy-Item -LiteralPath (Join-Path $st 'unpacked.zip') -Destination $z -Force
    if ((Get-FileHash -LiteralPath $z -Algorithm SHA512).Hash -ne ${q(a.hex && a.hex.zip)}) { Remove-Item -LiteralPath $z -Force; exit 3 }
    $u = Join-Path $res 'app.asar.unpacked.nouveau'; if (Test-Path -LiteralPath $u) { Remove-Item -LiteralPath $u -Recurse -Force }
    Expand-Archive -LiteralPath $z -DestinationPath $u -Force; Remove-Item -LiteralPath $z -Force
  }
} catch { Add-Content -LiteralPath (Join-Path $st 'journal.txt') -Value ('PowerShell : ' + $_.Exception.Message); exit 4 }
try {
  foreach ($n in $names) {
    $cur = Join-Path $res $n
    Again { if (Test-Path -LiteralPath "$cur.precedent") { Remove-Item -LiteralPath "$cur.precedent" -Recurse -Force } }
    Again { if (Test-Path -LiteralPath $cur) { Rename-Item -LiteralPath $cur -NewName "$n.precedent" } }
    Again { Rename-Item -LiteralPath "$cur.nouveau" -NewName $n }
  }
  exit 0
} catch { Add-Content -LiteralPath (Join-Path $st 'journal.txt') -Value ('PowerShell : ' + $_.Exception.Message); try { Restore } catch { }; exit 5 }
`;
const PS_RESTORE = PS_HEAD + 'try { Restore; exit 0 } catch { exit 5 }\n';
const PS_CODES = { 1: 'autorisation administrateur refusée ou impossible', 3: 'empreinte incorrecte dans le dossier protégé', 4: 'copie impossible', 5: 'échange impossible' };
function elevated(script) {
  const { spawnSync } = require('child_process');
  const b64 = Buffer.from(script, 'utf16le').toString('base64');
  // environnement propre : sans les chemins de modules d'un autre PowerShell (7) ni le mode Node du logiciel
  const env = { ...process.env }; delete env.PSModulePath; delete env.ELECTRON_RUN_AS_NODE; const opt = { windowsHide: true, env };
  if (a.noElevate) { // auto-test : même script, sans demande d'autorisation
    return spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64], { ...opt, timeout: 600000 }).status;
  }
  const outer = `try { $p = Start-Process -FilePath ${q(POWERSHELL)} -ArgumentList '-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand','${b64}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode } catch { exit 1 }`;
  return spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', outer], { ...opt, timeout: 900000 }).status;
}

async function swap() {
  if (a.elevate) {
    const code = elevated(PS_SWAP);
    if (code === 0) { log(`contenu ${a.version} en place (autorisation administrateur)`); return true; }
    log(`échec de la mise en place : ${PS_CODES[code] || 'code ' + code}`); return false;
  }
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
  if (a.elevate) { const code = elevated(PS_RESTORE); log(code === 0 ? 'version précédente rétablie' : 'retour arrière impossible : ' + (PS_CODES[code] || code)); return; }
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
