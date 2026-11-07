# Politique de signature de code — SknEDU-studio

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

*(Cette mention devient effective dès que SignPath Foundation a accepté le projet ; jusque-là, les installateurs ne sont pas signés.)*

## Ce qui est signé

Uniquement les fichiers construits à partir de ce dépôt par le workflow public
[`.github/workflows/release.yml`](.github/workflows/release.yml), sur les serveurs GitHub Actions :
l'application `SknEDU-studio.exe`, l'assistant d'élévation `elevate.exe`, le désinstalleur et l'installateur `SknEDU-studio-Setup-x.y.z.exe`.
Aucun fichier construit sur un ordinateur personnel n'est signé. Chaque version passe l'audit de sécurité des
dépendances et l'auto-test complet avant d'être construite, puis **chaque demande de signature est approuvée
manuellement** par un approbateur.

Les métadonnées des fichiers signés portent le nom du produit (`SknEDU-studio`) et le numéro de la version publiée.
Les empreintes SHA-256 des fichiers sont publiées avec chaque version (`SHA256SUMS-windows.txt`).

## Équipe et rôles

| Rôle | Membres | Responsabilité |
|---|---|---|
| Auteurs (committers) | [@ksehibi](https://github.com/ksehibi) | Modifier le code source du dépôt |
| Relecteurs (reviewers) | [@ksehibi](https://github.com/ksehibi) | Relire toute contribution extérieure (pull request) avant fusion ; la branche `main` ne peut être ni supprimée ni réécrite |
| Approbateurs (approvers) | [@ksehibi](https://github.com/ksehibi) | Approuver chaque demande de signature dans SignPath |

Tous les membres utilisent l'authentification à plusieurs facteurs sur GitHub et sur SignPath.

## Confidentialité

Ce programme ne transfère aucune information vers d'autres systèmes en réseau, sauf à la demande de
l'utilisateur ou de son administrateur (mises à jour désactivables, assistant IA avec la clé de l'utilisateur,
cloud, classe connectée sur le réseau local). Détails : [PRIVACY.md](PRIVACY.md). Cette information est
également affichée pendant l'installation.

## Signaler un problème

Fichier signé suspect, signature abusive ou faille de sécurité : voir [SECURITY.md](SECURITY.md).
