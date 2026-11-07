// Démarrage : PDF.js 5 est un module ES ; on l'expose puis on charge l'éditeur.
import * as pdfjsLib from '../../node_modules/pdfjs-dist/build/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = '../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs';
window.pdfjsLib = pdfjsLib;
for (const src of ['fonts.js', 'app.js', 'features.js', 'studio.js', 'teacher.js']) {
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Chargement impossible : ' + src));
    document.body.appendChild(s);
  });
}
