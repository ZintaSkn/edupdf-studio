// EduPDF Studio — services cloud (OneDrive, Google Drive, Dropbox, iCloud, Box, dossiers personnalisés)
// Principe : on enregistre dans le dossier synchronisé de l'application officielle du service ;
// elle envoie le fichier dans le cloud (et le rend disponible sur les autres appareils), sans mot de passe à confier à EduPDF.
const fs = require('fs');
const path = require('path');
const os = require('os');

const exists = (p) => { try { return !!p && fs.statSync(p).isDirectory(); } catch { return false; } };
const home = os.homedir();

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }

function detect(custom = []) {
  const list = [];
  const add = (id, name, p, extra = {}) => { if (exists(p) && !list.some((x) => x.path.toLowerCase() === p.toLowerCase())) list.push({ id, name, path: p, ...extra }); };

  // OneDrive (personnel et professionnel / scolaire)
  add('onedrive', 'OneDrive', process.env.OneDriveConsumer || '');
  add('onedrive', 'OneDrive', process.env.OneDrive || '');
  if (process.env.OneDriveCommercial) add('onedrive-pro', 'OneDrive (établissement)', process.env.OneDriveCommercial);
  for (const d of safeReaddir(home)) if (/^OneDrive( - .+)?$/i.test(d)) add(/ - /.test(d) ? 'onedrive-pro' : 'onedrive', d.replace(/^OneDrive - /i, 'OneDrive – '), path.join(home, d));

  // Google Drive pour ordinateur : lecteur virtuel (G:\Mon Drive) ou ancien dossier
  for (const L of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
    for (const n of ['Mon Drive', 'My Drive', 'Mi unidad', 'Meine Ablage']) add('gdrive', 'Google Drive', `${L}:\\${n}`);
    add('gdrive-shared', 'Google Drive (partagés)', `${L}:\\Drive partagés`);
  }
  add('gdrive', 'Google Drive', path.join(home, 'Google Drive'));
  add('gdrive', 'Google Drive', path.join(home, 'Mon Drive'));

  // Dropbox
  for (const base of [process.env.APPDATA, process.env.LOCALAPPDATA]) {
    const info = base && readJson(path.join(base, 'Dropbox', 'info.json'));
    if (info) { if (info.personal) add('dropbox', 'Dropbox', info.personal.path); if (info.business) add('dropbox-pro', 'Dropbox (équipe)', info.business.path); }
  }
  add('dropbox', 'Dropbox', path.join(home, 'Dropbox'));

  // iCloud Drive, Box, pCloud, Nextcloud, MEGA
  add('icloud', 'iCloud Drive', path.join(home, 'iCloudDrive'));
  add('box', 'Box', path.join(home, 'Box'));
  add('pcloud', 'pCloud', 'P:\\');
  add('nextcloud', 'Nextcloud', path.join(home, 'Nextcloud'));
  add('mega', 'MEGA', path.join(home, 'MEGA'));

  for (const c of custom) add('custom', c.name || path.basename(c.path), c.path, { custom: true });
  return list;
}
function safeReaddir(d) { try { return fs.readdirSync(d); } catch { return []; } }

// Installation des applications officielles (catalogue Microsoft winget)
const INSTALL = {
  gdrive: { id: 'Google.GoogleDrive', name: 'Google Drive pour ordinateur', web: 'https://www.google.com/intl/fr/drive/download/' },
  onedrive: { id: 'Microsoft.OneDrive', name: 'OneDrive', web: 'https://www.microsoft.com/fr-fr/microsoft-365/onedrive/download' },
  dropbox: { id: 'Dropbox.Dropbox', name: 'Dropbox', web: 'https://www.dropbox.com/fr/install' }
};

/** Dossier « EduPDF » dans le cloud choisi (créé si besoin). */
function targetDir(cloudPath) {
  const d = path.join(cloudPath, 'EduPDF');
  try { fs.mkdirSync(d, { recursive: true }); return d; } catch { return cloudPath; }
}

module.exports = { detect, INSTALL, targetDir };
