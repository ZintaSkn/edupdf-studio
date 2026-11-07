# Signer l'installateur Windows — guide pas à pas

Objectif : que Windows 11 (contrôle intelligent des applications, SmartScreen) et les antivirus fassent confiance
à SknEDU-studio. Tout est déjà prêt dans le dépôt : il reste les étapes qui demandent **votre** compte.

## Ce qui est déjà en place

- `build/signpath-sign.js` : envoie chaque exécutable (application, elevate.exe, désinstalleur, installateur) à SignPath pendant
  la construction, attend votre approbation, puis remet le fichier signé à sa place. Testé de bout en bout avec un faux serveur SignPath (vraie construction de l'installateur).
- `.github/workflows/release.yml` : la signature s'active **toute seule** dès que les secrets ci-dessous existent ;
  sinon la construction reste non signée, comme aujourd'hui.
- `CODE_SIGNING.md` (politique de signature), `PRIVACY.md` (confidentialité), page « Licence et confidentialité »
  affichée pendant l'installation, mises à jour automatiques désactivables dans Préférences.

## ⚠️ Point d'attention : éditions payantes

SignPath Foundation (gratuit) n'accepte que les projets **entièrement open source, sans double licence commerciale**.
SknEDU-studio est sous AGPL, mais les éditions Enseignant / Établissement (licences payantes, CLA des contributeurs)
peuvent être considérées comme une offre commerciale. Présentez honnêtement le modèle dans la demande : le code
est 100 % AGPL et identique pour tous, la licence payante n'ajoute que des services (personnalisation, support).
SignPath peut accepter ou refuser. En cas de refus, voir « Autres solutions » plus bas : le script et le workflow
restent utiles avec une offre SignPath payante.

## Étapes

1. **Activer la double authentification GitHub** (obligatoire) : github.com › Settings › Password and authentication.
2. **Faire la demande** sur https://signpath.org/apply avec les informations ci-dessous.
3. Après acceptation, dans SignPath (activer aussi la double authentification) :
   - projet : `sknedu-studio` ; politique de signature : `release-signing` (approbation manuelle) ;
   - configuration d'artefact par défaut : un fichier PE (`.exe`) signé avec Authenticode ;
   - restriction des métadonnées : nom du produit `SknEDU-studio` ;
   - créer un utilisateur CI (« submitter ») et copier son **jeton API**.
4. Dans GitHub › dépôt `edupdf-studio` › Settings › Secrets and variables › Actions :
   - secrets : `SIGNPATH_API_TOKEN` (le jeton) et `SIGNPATH_ORGANIZATION_ID` (identifiant de l'organisation) ;
   - variables (facultatif, si vos noms diffèrent) : `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_SIGNING_POLICY_SLUG`.
5. Publier la version suivante (tag `vX.Y.Z`). Pendant la construction, **quatre demandes** apparaissent dans SignPath
   (application, assistant d'élévation elevate.exe, désinstalleur, installateur) : les approuver une par une. La construction attend jusqu'à 2 heures.

Ne collez jamais le jeton API dans un fichier du dépôt ni dans une discussion : uniquement dans les secrets GitHub.

## Informations pour la demande SignPath Foundation

- **Nom du projet** : SknEDU-studio
- **Dépôt** : https://github.com/ZintaSkn/edupdf-studio
- **Licence** : GNU AGPL-3.0 (tous les composants : licences libres approuvées OSI, voir THIRD_PARTY_NOTICES.md)
- **Description** : éditeur PDF hors ligne pour les enseignants (créer, modifier, organiser, scanner, OCR,
  convertir, corriger des copies), sous Windows, macOS et Linux.
- **Page de téléchargement** : https://github.com/ZintaSkn/edupdf-studio/releases
- **Politique de signature** : https://github.com/ZintaSkn/edupdf-studio/blob/main/CODE_SIGNING.md
- **Construction** : GitHub Actions (serveurs hébergés par GitHub), workflow public `release.yml`,
  auto-test complet et audit des dépendances avant chaque version.
- **Fichiers à signer** : `SknEDU-studio.exe`, son désinstalleur et l'installateur NSIS.
- **Modèle économique** : code identique et entièrement AGPL pour tous ; services payants facultatifs
  (personnalisation au nom de l'établissement, support, déploiement).

## Autres solutions si la demande est refusée

| Solution | Coût indicatif | Remarques |
|---|---|---|
| SignPath (offre payante) | sur devis | Le script et le workflow fonctionnent tels quels |
| Certificat « Open Source Code Signing » Certum | environ 30 à 70 € / an | Pour une personne physique ; signature dans le cloud (SimplySign) ; demande une adaptation du script |
| Azure Trusted Signing (Microsoft) | environ 10 $ / mois | Réservé à certains pays et aux organisations ou personnes vérifiées ; electron-builder le gère nativement |
| Certificat OV (Sectigo, SSL.com…) | 150 à 300 $ / an | Clé sur support matériel ou service cloud obligatoire |

macOS : la signature et la notarisation demandent un compte Apple Developer (99 $ / an), indépendant de ce guide.
