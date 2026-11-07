# Contribuer à SknEDU-studio

Merci de votre intérêt ! Les contributions (corrections, traductions, modèles, idées) sont les bienvenues.

## Accord de contribution (obligatoire)

SknEDU-studio est développé en **open core** : le logiciel est libre (AGPL-3.0) et son titulaire propose
autour des offres commerciales (licences établissement, support, déploiement, formation). Pour garder cette
possibilité, chaque contribution est acceptée aux conditions suivantes, que vous acceptez en ouvrant une
*pull request* :

1. Vous êtes l'auteur de la contribution, ou avez le droit de la proposer.
2. Vous la placez sous la licence **AGPL-3.0-or-later** du projet.
3. Vous accordez en plus au titulaire du projet (ksehibi) une licence **mondiale, perpétuelle, gratuite,
   irrévocable et non exclusive** lui permettant d'utiliser, modifier, sous-licencier et distribuer votre
   contribution **sous toute autre licence**, y compris commerciale.
4. Vous conservez vos droits d'auteur sur votre contribution.

Ajoutez à chaque commit la ligne `Signed-off-by: Prénom Nom <email>` (`git commit -s`) pour confirmer cet accord.

## Avant d'envoyer

- Lancez l'auto-test : `set EDUPDF_SELFTEST=C:\dossier` puis `npx electron .` — le fichier `selftest.log` doit se
  terminer par `ALL OK`.
- Aucune clé, aucun mot de passe, aucune donnée d'élève dans les fichiers envoyés.
- Les failles de sécurité se signalent en privé (voir [SECURITY.md](SECURITY.md)).
