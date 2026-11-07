# EduPDF Studio

Éditeur PDF **hors-ligne** pour enseignants (Windows), dans l'esprit de PDFelement :
créer, modifier, organiser, scanner, rendre le texte des scans modifiable (OCR), protéger, signer,
comparer et convertir les documents de cours. Logiciel libre et perpétuel (AGPL-3.0) : aucun abonnement, aucun compte.

## Fonctions

| Domaine | Ce que fait le logiciel |
|---|---|
| **Créer** | Document vierge A4, PDF depuis photos/images, depuis le scanner, depuis Word / PowerPoint / Excel / OpenOffice / RTF / pages web / EPUB / TXT, fusion de plusieurs fichiers |
| **Modifier** | Corriger le texte existant **dans la police, la taille et la couleur d'origine** (le fond est repris à l'identique), ajouter du texte (25 polices, gras, italique, tous alphabets), images, surligneur, masquer, cadres, stylo, annuler/rétablir |
| **Formulaires** | Remplir les formulaires PDF existants (texte, cases, boutons radio, listes) ; créer des champs texte et des cases à cocher pour des fiches à compléter |
| **Signature** | Signature manuscrite (souris, stylet ou image importée), mémorisée sur le PC, avec date facultative |
| **Protéger** | Mot de passe d'ouverture et/ou de modification (AES 256), choix des autorisations (imprimer, copier, modifier, annoter) |
| **PDF protégés** | Ouverture avec le mot de passe (structure, polices et mise en page conservées) ; les PDF « restreints » (sans mot de passe d'ouverture) s'ouvrent directement et deviennent modifiables ; PDF endommagés réparés |
| **Copie numérisée éditable** | Pour un fichier impossible à déchiffrer ou dont le texte est illisible : chaque page devient une image identique, puis l'OCR rend le texte modifiable (corrections dans la couleur et sur le fond d'origine) |
| **Comparer** | Comparaison mot à mot avec un autre fichier : ajouts, modifications et suppressions surlignés, liste cliquable des différences |
| **Pages** | Glisser-déposer pour réordonner, pivoter, supprimer, dupliquer, insérer, extraire, diviser, numéroter |
| **Scanner** | Numérisation WIA (tous scanners Windows), multi-pages, OCR proposé à la fin |
| **OCR** | Tesseract intégré (français + anglais) : rend les scans cherchables/copiables et leur texte modifiable |
| **Convertir** | PDF → Word (.docx), PDF → images PNG, PDF → texte ; tous formats ci-dessous → PDF |
| **Mises à jour** | Vérification au démarrage puis toutes les 4 h, téléchargement en arrière-plan, installation au redémarrage |

### Formats ouverts

- **PDF** (y compris protégés, restreints ou endommagés)
- **Office** : `doc, docx, docm, dot(x), odt, ott, rtf, wpd, wps, ppt, pptx, pptm, pps(x), pot(x), odp, otp, xls, xlsx, xlsm, xlsb, ods, ots, odg, otg, vsd(x), pub` — via LibreOffice (mise en page identique) ;
  sans LibreOffice, les `.docx` s'ouvrent quand même (mise en page approximative). EduPDF propose d'**installer LibreOffice automatiquement**.
- **Livres et BD** : `epub, mobi, fb2, cbz` • **Images** : `png, jpg, jfif, bmp, gif, webp, avif, ico, tif/tiff (multipage), jxr, psd, pnm`
- **Web** : `html, htm, xhtml, mht, svg` • **Texte** : `txt, md, csv, json, xml, tex, log, srt…`
- Fichier sans extension ou mal nommé : reconnu d'après son contenu.

## Lancer en développement

```bash
npm install
npm start
```

## Créer l'installateur Windows

```bash
npm run dist
```

## Mises à jour automatiques

Dépôt : https://github.com/ksehibi/edupdf-studio — téléchargement : onglet **Releases**.

Pour chaque nouvelle version : augmentez `"version"` dans `package.json`, commitez, puis
`git tag vX.Y.Z` et `git push origin main vX.Y.Z`. Le workflow `.github/workflows/release.yml` construit
l'installateur sur les serveurs de GitHub et le publie ; les PC déjà équipés installent la mise à jour tout seuls.

## Architecture

- `src/main.js` — processus principal : fichiers et conversions, LibreOffice, scanner WIA, OCR Tesseract, polices Windows, export Word, mises à jour.
- `src/mu.js` — MuPDF (WebAssembly) : déchiffrement, chiffrement AES, réparation, EPUB / MOBI / FB2 / CBZ / TIFF.
- `src/preload.js` — pont sécurisé entre l'interface et le système.
- `src/renderer/app.js` — interface et moteur d'édition (PDF.js pour l'affichage, pdf-lib pour l'écriture).
- `src/renderer/fonts.js` — reconnaissance de la police d'origine et réécriture Unicode (polices de secours par alphabet).
- `src/selftest.js` — auto-test : `set EDUPDF_SELFTEST=C:\dossier` puis `npx electron .`

## Bon à savoir

- Un PDF chiffré avec un **mot de passe d'ouverture** ne peut être lu qu'avec ce mot de passe (c'est le principe du chiffrement).
- Les fichiers Office protégés par mot de passe doivent d'abord être ouverts dans Word / LibreOffice avec leur mot de passe.
- La signature est une signature manuscrite visuelle (pas un certificat numérique qualifié).
- Les écritures de droite à gauche (arabe, N'Ko) s'affichent, mais leur mise en forme n'est pas garantie.
