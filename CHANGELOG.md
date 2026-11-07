# Historique des versions — SknEDU-studio

Toutes les versions sont publiées sur https://github.com/ZintaSkn/edupdf-studio/releases et installées
automatiquement sur les ordinateurs déjà équipés. Chaque version passe l'audit de sécurité des dépendances et
l'auto-test complet avant publication.

## [1.11.2] — Aller à une page en tapant son numéro
- Champ « numéro de page » dans la barre d'état, avec ◀ ▶ et le nombre total de pages
- Ctrl+G pour y accéder ; Entrée pour aller à la page ; au-delà du total, la dernière page s'affiche
- Fonctionne en défilement continu comme en affichage page par page

## [1.11.1] — Préparation de la signature de code
- Signature SignPath des exécutables Windows prête à l'emploi (application, elevate.exe, désinstalleur,
  installateur ; approbation manuelle de chaque demande), activée dès que les secrets SignPath sont configurés
- Empreintes SHA-256 des fichiers Windows publiées avec chaque version
- Politique de signature (CODE_SIGNING.md), confidentialité (PRIVACY.md), guide docs/SIGNATURE-WINDOWS.md
- Page « Licence et confidentialité » affichée pendant l'installation
- Préférences : recherche automatique des mises à jour désactivable

## [1.11.0] — Outils de correction, récupération, préférences
- Tampons de correction : ✔ ✘, Vu, Très bien, Bien, À revoir, Insuffisant, Bravo !, Absent, Copie non rendue
  ou tampon personnalisé, posés d'un clic
- Ellipse, trait et flèche (Maj : tracé droit)
- En-tête et pied de page : établissement, enseignant, classe, date, « Page n / N »
- Impression : page courante ou intervalle (1-3, 5), 2 ou 4 pages par feuille
- Préférences : nom de l'enseignant (auteur des commentaires), établissement, classe, police par défaut
- Copie de récupération automatique proposée au redémarrage après une coupure de courant
- Correcteur orthographique français et anglais, suggestions au clic droit
- Correctif : documents mêlant portrait et paysage imprimés dans le bon sens

## [1.10.0] — SknEDU-studio, défilement continu, cloud automatique
- Nouveau nom SknEDU-studio et nouveau logo (en-tête, accueil, installateur, raccourcis Bureau et menu Démarrer)
- Défilement continu des pages ; zoom largeur, page entière, 25 à 400 % ; barres latérales automatiques
- Diaporama adapté à la largeur de l'écran, avec zoom
- Panneau des modifications : suppression une à une ou en bloc, texte d'origine rétabli
- Texte ajouté adapté à la police, la taille et la couleur du texte voisin
- Commentaires lisibles dans le logiciel ; copie commentée en lecture seule (commentaires verrouillés)
- Réenregistrement au format d'origine (Word, Excel, PowerPoint, OpenDocument, texte, image)
- Connexion et sauvegarde automatique dans OneDrive, Google Drive ou Dropbox
- Correctifs : info-bulles conservées après application des droits ; outils bloqués en lecture seule

## [1.9.0] — Onglet Classe, paragraphes, macOS et Linux
- Accueil : barre latérale en icônes, instructions dans les info-bulles
- Modification de paragraphes entiers, recomposés dans leur largeur d'origine ; miniatures chargées à la demande
- Onglet Classe : correction de copies assistée, évaluations différenciées (export Moodle GIFT), publipostage,
  version DYS et lecture à voix haute, classe connectée par QR code, version bilingue, équations LaTeX
- Diaporama interactif (stylo, tableau blanc, minuteur, mode présentateur) ; IA hors ligne guidée
- Interface en anglais ; accessibilité (ARIA, focus visible, animations réduites)
- Versions macOS (dmg/zip, Intel et Apple Silicon) et Linux (AppImage) ; paquet allégé

## [1.8.0] — Open core : éditions, licences, mentions légales
- Éditions Communauté (gratuite, complète, AGPL), Enseignant et Établissement (licence signée, vérifiée hors ligne)
- Licence par compte ou pour tout le PC ; nom de l'établissement dans l'application et les modèles
- À propos : licence AGPL, code source, politique de marque, licences des composants tiers
- TRADEMARK.md, CONTRIBUTING.md

## [1.7.0] — Accueil, onglets de documents, ruban automatique, diaporama
- Nouveau nom SknEDUpdf-studio (réglages, clés IA et administration conservés)
- Onglet Accueil : démarrer, modèles (Seyès, petits carreaux, évaluation, fiche d'exercices), fichiers récents
- Plusieurs documents en onglets dans la même fenêtre (Ctrl+T / Ctrl+W / Ctrl+Tab)
- Ruban épinglé ou masqué automatiquement (Ctrl+F1) ; barre d'accès rapide personnalisable
- Diaporama plein écran (F5 / Maj+F5) : écran noir ou blanc, pointeur laser

## [1.6.0] — Nouvelles couleurs
- Thème bleu marine #001871 et or #F1B434, dégradé en vagues signature
- Palette appliquée à toute l'interface et à la console d'administration ; nouvelle icône

## [1.5.1] — Confiance Windows, mises à jour vérifiées, affichage adaptatif
*(reprend la 1.5.0, non publiée : l'auto-test de publication l'avait bloquée)*
- PDF.js 6.5 (deux failles d'exécution de code corrigées) ; 0 vulnérabilité connue dans les dépendances
- Fenêtre adaptée à l'écran au démarrage, taille mémorisée ; affichage de 800×600 à la 4K, mise à l'échelle 125-200 %
- LibreOffice compatible avec les noms d'utilisateur accentués
- Journal des mises à jour ; publication conditionnée à l'audit et à l'auto-test complet
- CodeQL, Dependabot, SECURITY.md

## [1.4.0] — Assistant IA et application allégée
- Assistant IA : Claude, ChatGPT, Gemini, Mistral ou IA locale (Ollama), avec votre clé API
- Actions pour l'enseignant : résumé, QCM, exercices, simplification, correction, traduction, grille, plan de séance
- Abonnements grand public utilisables par le navigateur
- Clés API chiffrées par Windows ; IA désactivable par l'administrateur
- Installation plus légère (environ 90 Mo de moins)

## [1.3.0] — Conversions Office, cloud, administration
- PDF → Word, Excel, PowerPoint sans logiciel supplémentaire ; DOC, ODT, RTF, HTML, XLS, ODS, CSV, PPT, ODP avec LibreOffice
- Tableaux du PDF reconstitués en cellules Excel
- Conversion d'un fichier Office vers un autre format Office ou PDF
- Enregistrer et ouvrir dans OneDrive, Google Drive, Dropbox, iCloud, Box, Nextcloud
- Administration : droits par utilisateur et par poste, journal d'activité, notifications Windows et téléphone

## [1.2.0] — Audit complet et nouvelles fonctions
- Sécurité : Electron 45, interface isolée, PDF.js sans exécution de code
- Fidélité : signets, liens, propriétés, pièces jointes et formulaires conservés ; texte corrigé réellement supprimé
- Rechercher / remplacer, impression, commentaires, filigrane, rognage, réduction de taille, signature par certificat
- PDF → Word et PowerPoint ; photos HEIC, XPS, fichiers Office protégés ; 5 langues d'OCR de plus

## [1.1.0] — Polices fidèles, PDF protégés, signature, formulaires
- Texte réécrit dans la police, la taille et la couleur d'origine ; tous les alphabets
- PDF protégés : mot de passe, levée des restrictions, réparation ; copie numérisée modifiable par OCR
- Protection AES-256 avec autorisations ; signature manuscrite ; formulaires ; comparaison de documents
- Nouveaux formats : EPUB, MOBI, FB2, CBZ, TIFF, SVG, HTML

## [1.0.1] — Première version publiée
- Éditeur PDF hors ligne pour l'enseignement : créer, modifier, organiser les pages, scanner, OCR, convertir
- Mises à jour automatiques
