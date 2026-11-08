# Publier SknEDU-studio dans le Microsoft Store

## Pourquoi

Sur les PC où le **contrôle intelligent des applications** de Windows 11 est appliqué, Windows bloque tout
installateur non signé, y compris les mises à jour automatiques. Une application distribuée par le Microsoft Store
est **signée par Microsoft** : elle s'installe et se met à jour sans blocage, sans certificat à acheter.

C'est complémentaire de la signature SignPath (docs/SIGNATURE-WINDOWS.md), qui concerne l'installateur publié sur GitHub.

## Ce qui est prêt dans le dépôt

- Configuration du paquet Store (`build.appx` dans package.json) : nom, éditeur affiché (SEHI BI Kouahi Nestor),
  couleurs, langues français et anglais, association des fichiers PDF, vignettes générées depuis le logo (`build/appx/`).
- À chaque version, le workflow de publication construit le paquet `SknEDU-studio-x.y.z-Store.appx` et le joint à
  l'exécution GitHub Actions (onglet Actions › la version › « Artifacts », conservé 90 jours).
- Dans la version Store, les mises à jour automatiques intégrées sont désactivées : c'est le Store qui les installe.

## Étapes (à faire avec votre compte)

1. Créer un compte développeur **individuel** sur l'Espace partenaires : https://partner.microsoft.com/dashboard
   (inscription gratuite pour les particuliers, vérification d'identité demandée).
2. Créer une application et **réserver le nom** « SknEDU-studio ».
3. Ouvrir « Gestion des produits › Identité du produit » et relever :
   - `Package/Identity/Name` (par exemple `12345SEHIBI.SknEDU-studio`) ;
   - `Package/Identity/Publisher` (par exemple `CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`).
4. Dans GitHub › dépôt › Settings › Secrets and variables › Actions › **Variables**, créer :
   - `STORE_IDENTITY_NAME` = la valeur de `Package/Identity/Name` ;
   - `STORE_PUBLISHER` = la valeur de `Package/Identity/Publisher`.
5. Publier une version (tag `vX.Y.Z`), puis télécharger l'artefact `microsoft-store-vX.Y.Z` (fichier `.appx`).
6. Dans l'Espace partenaires, créer une **soumission** :
   - Paquets : téléverser le fichier `.appx` ;
   - Fiche du Store : description, captures d'écran, catégorie « Éducation » ;
   - Politique de confidentialité : https://github.com/ZintaSkn/edupdf-studio/blob/main/PRIVACY.md ;
   - Capacité « runFullTrust » : application de bureau (Electron) qui ouvre et enregistre les fichiers choisis par
     l'utilisateur, numérise, imprime et convertit des documents ;
   - Tarification : gratuite (les éditions payantes restent vendues hors du Store).
7. Envoyer pour certification (quelques jours). Les versions suivantes : téléverser le nouvel `.appx` dans une
   nouvelle soumission.

## Bon à savoir

- Les données (réglages, clés IA chiffrées, licences) de la version Store sont séparées de celles de la version
  installée depuis GitHub. Désinstaller d'abord la version GitHub évite d'avoir deux copies.
- Les paquets Store ne peuvent pas être installés hors du Store tant qu'ils ne sont pas signés par Microsoft.
