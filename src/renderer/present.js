// Écran de projection (second écran) : affiche l'image envoyée par le mode présentateur et renvoie les touches.
'use strict';
window.present.onFrame((url) => { document.getElementById('frame').src = url; });
window.addEventListener('keydown', (e) => { e.preventDefault(); window.present.key(e.key, e.shiftKey); });
window.addEventListener('click', () => window.present.key('ArrowRight', false));
window.addEventListener('contextmenu', (e) => { e.preventDefault(); window.present.key('ArrowLeft', false); });
