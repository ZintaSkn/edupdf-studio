# EduPDF Studio

Éditeur PDF **hors-ligne** pour enseignants (Windows), dans l'esprit de PDFelement :
créer, modifier, organiser, scanner, rendre le texte des scans modifiable (OCR), protéger, signer,
comparer et convertir les documents de cours. Logiciel libre et perpétuel (AGPL-3.0) : aucun abonnement, aucun compte.

## Fonctions

| Domaine | Ce que fait le logiciel |
|---|---|
| **Créer** | Document vierge A4, PDF depuis photos/images, depuis le scanner, depuis Word / PowerPoint / Excel / OpenOffice / RTF / pages web / EPUB / TXT, fusion de plusieurs fichiers |
| **Modifier** | Corriger le texte existant **dans la police, la taille et la couleur d'origine** (le fond est repris à l'identique ; l'ancien texte est réellement supprimé), **rechercher / remplacer** dans tout le document (Ctrl+F), ajouter du texte (25 polices, gras, italique, tous alphabets), images, surligneur, masquer (suppression définitive), cadres, stylo, **commentaires**, annuler/rétablir |
| **Formulaires** | Remplir les formulaires PDF existants (texte, cases, boutons radio, listes) ; créer des champs texte et des cases à cocher pour des fiches à compléter |
| **Signature** | Signature manuscrite (souris, stylet ou image importée), mémorisée sur le PC, avec date facultative ; **signature numérique avec certificat** (.p12 / .pfx) |
| **Protéger** | Mot de passe d'ouverture et/ou de modification (AES 256), choix des autorisations (imprimer, copier, modifier, annoter) |
| **PDF protégés** | Ouverture avec le mot de passe (structure, polices et mise en page conservées) ; les PDF « restreints » (sans mot de passe d'ouverture) s'ouvrent directement et deviennent modifiables ; PDF endommagés réparés |
| **Copie numérisée éditable** | Pour un fichier impossible à déchiffrer ou dont le texte est illisible : chaque page devient une image identique, puis l'OCR rend le texte modifiable (corrections dans la couleur et sur le fond d'origine) |
| **Comparer** | Comparaison mot à mot avec un autre fichier : ajouts, modifications et suppressions surlignés, liste cliquable des différences |
| **Pages** | Glisser-déposer pour réordonner, pivoter, supprimer, dupliquer, insérer, extraire, diviser, numéroter, **rogner**, **filigrane** ; miniatures à jour avec les modifications |
| **Fichier** | **Imprimer** (Ctrl+P), **réduire la taille**, enregistrement qui **conserve la structure d'origine** (signets, liens, propriétés, pièces jointes, formulaires) |
| **Scanner** | Numérisation WIA (tous scanners Windows), multi-pages, OCR proposé à la fin |
| **OCR** | Tesseract intégré : français, anglais, espagnol, allemand, italien, portugais, arabe (et combinaisons) — rend les scans cherchables/copiables et leur texte modifiable |
| **Convertir** | **PDF → Word, Excel, PowerPoint** (sans rien installer) et **PDF → DOC, ODT, RTF, HTML, XLS, ODS, CSV, PPT, ODP** (LibreOffice) ; tableaux reconstitués en vraies cellules Excel ; **fichier Office ↔ autre format Office** (DOCX ↔ ODT ↔ DOC ↔ RTF ↔ PDF, XLSX ↔ ODS ↔ XLS ↔ CSV, PPTX ↔ ODP ↔ PPT) ; PDF → images PNG / texte ; tous les formats ci-dessous → PDF |
| **Cloud** | **Enregistrer et ouvrir dans OneDrive (personnel et établissement), Google Drive, Dropbox, iCloud Drive, Box, Nextcloud** ou tout dossier synchronisé ; installation guidée de Google Drive / OneDrive / Dropbox |
| **Administration** | Console administrateur : fonctions autorisées par défaut, par utilisateur et par poste (13 fonctions, blocage complet), message aux utilisateurs, journal d'activité, **notifications Windows et sur téléphone** (ntfy) |
| **Mises à jour** | Vérification au démarrage puis toutes les 4 h, téléchargement en arrière-plan, installation au redémarrage |

### Formats ouverts

- **PDF** (y compris protégés, restreints ou endommagés) • **XPS / OXPS** (converti en images fidèles)
- **Office** : `doc, docx, docm, dot(x), odt, ott, rtf, wpd, wps, ppt, pptx, pptm, pps(x), pot(x), odp, otp, xls, xlsx, xlsm, xlsb, ods, ots, odg, otg, vsd(x), pub` — via LibreOffice (mise en page identique) ;
  sans LibreOffice, les `.docx` s'ouvrent quand même (mise en page approximative). EduPDF propose d'**installer LibreOffice automatiquement**. Les fichiers Office **protégés par mot de passe** s'ouvrent avec leur mot de passe.
- **Livres et BD** : `epub, mobi, fb2, cbz` • **Images** : `heic, heif` (photos d'iPhone), `png, jpg, jfif, bmp, gif, webp, avif, ico, tif/tiff (multipage), jxr, psd, pnm`
- **Web** : `html, htm, xhtml, mht, svg` • **Texte** : `txt, md, csv, json, xml, tex, log, srt…`
- Fichier sans extension ou mal nommé : reconnu d'après son contenu.

## Administration (gestion des accès)

Aide › **Administration** :

1. **Sur votre PC** : « Devenir administrateur » → mot de passe administrateur + dossier de gestion.
   - Ce PC seulement (tous ses comptes Windows) : gardez le dossier proposé.
   - Plusieurs PC : choisissez un **partage réseau** ou un **dossier OneDrive / Google Drive partagé** avec les postes.
2. **Sur chaque poste à gérer** : « Rejoindre la gestion » → même dossier + mot de passe administrateur
   (option « tous les comptes Windows de ce PC » pour les sessions élèves).
3. La **console** permet de cocher les fonctions autorisées (enregistrer, modifier, formulaires, pages, OCR, scanner,
   convertir, imprimer, cloud, mots de passe, PDF protégés, signature, comparaison), par défaut, par utilisateur
   (`eleve1`), par poste (`SALLE-B12\*`) ou pour un compte précis (`SALLE-B12\eleve1`), et de bloquer un utilisateur.
4. **Notifications** : choisissez les événements (action bloquée, utilisateur bloqué, règles falsifiées, mot de passe
   administrateur erroné, poste inscrit / retiré, PDF protégé déverrouillé…). Elles s'affichent sur votre PC
   (EduPDF reste près de l'horloge, et démarre avec Windows si vous le souhaitez) et, si vous le voulez, sur votre
   téléphone avec l'application gratuite **ntfy**.

Sécurité : les règles sont **signées numériquement** (Ed25519) ; un utilisateur ne peut ni les modifier ni retirer son poste
sans le mot de passe administrateur. La clé de l'administrateur est chiffrée par son mot de passe.
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
- Sécurité : PDF.js n'exécute jamais de code venant d'un PDF, l'interface est isolée (sandbox) et ne peut écrire que dans les fichiers que vous avez choisis.
- Les écritures de droite à gauche (arabe, N'Ko) s'affichent, mais les phrases mêlant droite-à-gauche et gauche-à-droite peuvent être mal ordonnées.
- Le texte écrit en oblique ou à la verticale dans un PDF n'est pas modifiable directement (utilisez « Masquer » puis « Ajouter du texte »).
- Cloud : EduPDF utilise l'application officielle du service (OneDrive, Google Drive pour ordinateur, Dropbox…) qui synchronise le dossier ; vos identifiants ne passent jamais par EduPDF.
- Administration : un utilisateur qui est **administrateur Windows** de son PC pourrait supprimer les fichiers d'EduPDF ; réservez les droits d'administration Windows aux adultes responsables.
- Windows « Contrôle intelligent des applications » peut bloquer l'**installateur** tant qu'il n'est pas signé par un certificat d'éditeur (payant).
- Scanner : pilotes WIA (la quasi-totalité des scanners récents). Les scanners uniquement TWAIN ne sont pas pris en charge.