# EduPDF Studio

Éditeur PDF **hors-ligne** pour enseignants (Windows), dans l'esprit de PDFelement :
créer, modifier, organiser, scanner, rendre le texte des scans modifiable (OCR) et convertir
les documents de cours. Licence perpétuelle MIT : aucun abonnement, aucun compte.

## Fonctions

| Domaine | Ce que fait le logiciel |
|---|---|
| **Créer** | Document vierge A4, PDF depuis photos/images, depuis le scanner, depuis Word / PowerPoint / Excel / OpenOffice / RTF / TXT, fusion de plusieurs fichiers |
| **Modifier** | Corriger le texte existant (clic sur le texte), ajouter du texte, images, surligneur, masquer (effaceur blanc), cadres, stylo à main levée, annuler/rétablir |
| **Pages** | Glisser-déposer pour réordonner, pivoter, supprimer, dupliquer, insérer, extraire, diviser (1 PDF/page), numéroter |
| **Scanner** | Numérisation WIA (tous scanners Windows), multi-pages, OCR proposé à la fin |
| **OCR** | Tesseract intégré (français + anglais) : rend les scans cherchables/copiables et leur texte modifiable |
| **Convertir** | PDF → Word (.docx), PDF → images PNG, PDF → texte ; Office → PDF |
| **Mises à jour** | Vérification au démarrage puis toutes les 4 h, téléchargement en arrière-plan, installation au redémarrage |

Formats ouverts : `pdf, docx, doc, odt, rtf, pptx, ppt, pps(x), odp, xlsx, xls, ods, odg, pub, html, epub, tif(f), png, jpg, bmp, gif, webp, txt, md, csv`.

> Les fichiers Office sont convertis via **LibreOffice** (gratuit, hors-ligne), à installer une fois :
> https://fr.libreoffice.org/download/telecharger-libreoffice/ — EduPDF le détecte automatiquement.

## Lancer en développement

```bash
npm install
npm start
```

## Créer l'installateur Windows

```bash
npm run dist
```

Résultat : `dist/EduPDF Studio Setup 1.0.0.exe` (installation sans droits administrateur, raccourci bureau,
association des fichiers .pdf).

## Mises à jour automatiques (à configurer une fois)

Le logiciel utilise `electron-updater` avec **GitHub Releases** (gratuit) :

Dépôt : https://github.com/ksehibi/edupdf-studio — téléchargement : onglet **Releases**.

1. Pour chaque nouvelle version : augmentez `"version"` dans `package.json` (ex. `1.0.1`), commitez, puis
   `git tag v1.0.1` et `git push --tags`. Le workflow `.github/workflows/release.yml` construit l'installateur
   sur les serveurs de GitHub et le publie ; les PC déjà équipés installent la mise à jour tout seuls.

(Alternative locale : `setx GH_TOKEN "jeton"` puis `npm run publish`. Si Windows bloque la construction avec
`spawn UNKNOWN`, c'est le Contrôle intelligent des applications : utilisez le workflow GitHub.)

Hors connexion, le logiciel fonctionne normalement ; il vérifiera les mises à jour à la prochaine connexion.

## Architecture

- `src/main.js` — processus principal : fichiers, conversion LibreOffice, scanner WIA, OCR Tesseract, export Word, mises à jour.
- `src/preload.js` — pont sécurisé entre l'interface et le système.
- `src/renderer/` — interface (PDF.js pour l'affichage, pdf-lib pour l'écriture du PDF).
- `src/selftest.js` — auto-test : `set EDUPDF_SELFTEST=C:\dossier` puis `npx electron .`

Principe d'édition : le document est un modèle de pages (source + rotation + éléments ajoutés) ;
le PDF final est reconstruit à l'enregistrement. La « modification du texte » existant masque l'ancien texte
et réécrit le nouveau à la même position (même méthode que la plupart des éditeurs PDF légers).

## Limites actuelles / pistes

- Police de réécriture : Helvetica (les caractères hors alphabet latin deviennent « ? »).
- Pas encore : chiffrement par mot de passe, signature, formulaires, comparaison de documents.
- Les PDF protégés par mot de passe ne s'ouvrent pas.
