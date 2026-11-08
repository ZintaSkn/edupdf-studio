# Mettre en ligne le service d'activation des licences

Le service garantit qu'une licence n'est **active que sur un seul ordinateur à la fois**, qu'elle peut être **déplacée**
vers un autre poste pour ses jours restants, et qu'**au plus deux licences** s'additionnent sur un poste. Sans lui, les
licences « en ligne » (émises avec `--jours`) ne peuvent pas être activées ; les anciennes licences hors ligne (`--fin`)
continuent de fonctionner.

**En service** : https://sknedu-licences.ksehibi.workers.dev (compte Cloudflare ksehibi@gmail.com, offre gratuite :
100 000 requêtes par jour, largement suffisant). Les données sont dans un **Durable Object** unique : les demandes y
sont traitées l'une après l'autre, donc une licence ne peut jamais être activée sur deux postes en même temps, et un
transfert est pris en compte immédiatement (testé en ligne le 8 novembre 2026).
Code : dossier `server/` (`core.js` = règles, testées par `node server/test-core.js` ; `worker.js` = version en ligne).

## Ce que le service enregistre

Pour chaque licence : sa référence, l'adresse e-mail, l'édition, la durée, le temps déjà consommé et le poste qui l'utilise
(identifiant de poste anonyme, dérivé de l'identifiant de Windows). Rien d'autre : ni nom de fichier, ni document.

## Étapes (déjà faites le 8 novembre 2026 ; à refaire seulement sur un autre compte)

1. Créez un compte gratuit sur https://dash.cloudflare.com (activez la double authentification).
2. Sur votre PC, dans le dossier `server` du projet (pas dans C:\Windows\System32) : `npx wrangler login`, puis
   choisissez un sous-domaine workers.dev (proposé au premier `npx wrangler deploy` lancé dans un terminal).
3. Créez la clé du service (dans votre dossier privé, jamais dans le dépôt) :
   ```
   node tools/licence.js init-serveur "%USERPROFILE%\SknEDUpdf-licences"
   ```
   - installez la clé privée comme secret : `npx wrangler secret put SERVER_PRIVATE_KEY` puis collez le contenu de
     `cle-privee-serveur.pem` ;
   - copiez la clé publique affichée dans `package.json` › `commercial` › `serverPublicKey`.
4. Publiez : `npx wrangler deploy`. Notez l'adresse obtenue (par exemple `https://sknedu-licences.<votre-compte>.workers.dev`)
   et copiez-la dans `package.json` › `commercial` › `licenceServer`.
5. Publiez une nouvelle version de SknEDU-studio : les postes peuvent désormais activer les licences en ligne.

## Émettre une licence en ligne

```
node tools/licence.js emettre "%USERPROFILE%\SknEDUpdf-licences" --org "Mme Kouassi" --edition enseignant --email prof@exemple.ci --jours 365 --ref FAC-2026-012
```

Envoyez la clé `SKN1.…` (ou le fichier `.sknlic`) au client : il la colle dans **Aide › Licence et édition**.

## Fonctionnement pour l'utilisateur

- **Activer** (Internet nécessaire) : la licence est liée à l'adresse e-mail du compte et à ce PC.
- **Utiliser** : sans connexion pendant 14 jours au plus ; le logiciel revérifie automatiquement dès qu'Internet est disponible.
- **Changer d'ordinateur** : Aide › Licence et édition › « Désactiver de ce PC », puis activer la même clé sur l'autre poste
  (même adresse e-mail) : elle reprend ses jours restants.
- **Cumuler** : une deuxième licence s'ajoute à la première (les jours s'additionnent) ; une troisième est refusée.

## Mettre à jour le service

Après une modification de `server/core.js` ou `server/worker.js` : `node server/test-core.js`, puis, dans `server` :
`npx --yes wrangler@4 deploy`. Les licences et activations enregistrées sont conservées.

## Limites à connaître

- Si un PC est perdu, ou si Windows est réinstallé sans désactivation (réinstaller seulement SknEDU-studio ne pose pas de problème), la licence reste attachée à l'ancien poste : l'éditeur doit la
  libérer (outil d'administration à prévoir ; en attendant, demandez-le-moi).
