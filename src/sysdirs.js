// SknEDU-studio — dossiers du système, obtenus sans faire confiance aux variables d'environnement du processus.
// Un utilisateur peut lancer le logiciel avec des variables modifiées (ProgramData, LOCALAPPDATA…) : les règles de
// l'établissement, la licence du poste et les traces de la période d'essai ne doivent pas pouvoir être déplacées ainsi.
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');

/** Dossier du profil de l'utilisateur, demandé à Windows (et non à la variable USERPROFILE). */
function home() { try { return os.userInfo().homedir || os.homedir(); } catch { return os.homedir(); } }
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
/** C:\ProgramData : à la racine du lecteur du profil, sinon du lecteur C:. */
function programData() {
  const root = path.parse(home()).root || 'C:\\'; const d = path.join(root, 'ProgramData');
  return isDir(d) || !isDir('C:\\ProgramData') ? d : 'C:\\ProgramData';
}
function localAppData() { return path.join(home(), 'AppData', 'Local'); }
/** Dossier commun à tous les comptes du poste (règles de l'établissement, licence du poste). Déplacé seulement pendant l'auto-test. */
function machineDir() {
  if (process.env.EDUPDF_SELFTEST && process.env.EDUPDF_MACHINE_DIR) return process.env.EDUPDF_MACHINE_DIR;
  return process.platform === 'win32' ? path.join(programData(), 'EduPDF') : process.platform === 'darwin' ? '/Users/Shared/EduPDF' : '/var/tmp/EduPDF';
}

module.exports = { home, programData, localAppData, machineDir };
