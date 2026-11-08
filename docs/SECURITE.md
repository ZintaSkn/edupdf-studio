# Configuration de sécurité de référence — état de conformité

Ce document indique, point par point, comment SknEDU-studio applique la configuration de référence retenue
pour le logiciel, avec la preuve vérifiable de chaque mesure et les écarts restants. Il est mis à jour à chaque version.

| Exigence de référence | État | Preuve principale |
|---|---|---|
| Sécurité applicative : OWASP ASVS niveau 3, ou niveau 2 au minimum | **Niveau 2 appliqué (auto-évaluation)**. Le niveau 3 n'est pas revendiqué : il exige une vérification indépendante | Tableau ASVS ci-dessous, auto-test `intrusion-*` |
| Chiffrement : TLS 1.3 en transit | **Appliqué** pour toutes les connexions Internet (minimum imposé dans l'application, vérifié chaque jour sur le service) | `src/main.js` (début), `tools/supervision.js` |
| Chiffrement : AES-256-GCM | **Appliqué** à toutes les données que le logiciel chiffre lui-même | Tableau « Données chiffrées » |
| Gestion rigoureuse des clés | **Appliquée** : inventaire, séparation, rotation, sauvegarde | Section « Gestion des clés » |
| Accès : Zero Trust | **Appliqué** : l'interface est traitée comme non fiable ; chaque demande est vérifiée par le processus principal | Section « Zero Trust » |
| Accès : revue régulière des droits | **Appliquée** : rappel tous les 90 jours dans la console d'administration, revue des comptes de service | Section « Revue des droits » |
| Qualité : tests d'intrusion | **Automatisés** à chaque version ; test externe annuel recommandé (non encore réalisé) | Auto-test, `server/test-core.js` |
| Qualité : supervision continue | **Appliquée** : contrôle quotidien automatique + journaux du service | `.github/workflows/supervision.yml` |
| Performance : disponibilité | **Appliquée** : fonctionnement hors-ligne, service mondial redondé, 14 jours sans connexion | Section « Disponibilité » |
| Performance : consommation énergétique | **Appliquée** : aucun travail inutile, minuteries suspendues fenêtre réduite | Section « Énergie » |

## 1. OWASP ASVS 5.0 — niveau 2

Le logiciel est une application de bureau (Electron) et un petit service web (activation des licences). Les chapitres
de l'ASVS sont appliqués aux deux. Les chapitres sans objet sont indiqués.

| Chapitre ASVS | Application | Service d'activation |
|---|---|---|
| V1 Encodage et assainissement | Textes affichés dans les pages de la classe connectée échappés ; noms d'élèves de la classe connectée réduits aux lettres, chiffres, espaces, apostrophes et tirets ; aucune évaluation de code | Réponses JSON uniquement, `Content-Type` fixé, `nosniff` |
| V2 Validation et logique métier | Chaque échange avec l'interface (IPC) valide type, taille et origine des données ; règles Premium vérifiées par le processus principal, pas seulement par l'interface | Validation stricte (type, taille ≤ 16 Ko, JSON objet), règles « un poste à la fois / 2 licences au plus » appliquées côté service, traitement une demande à la fois (aucune course possible) |
| V3 Sécurité de l'interface web | CSP stricte (`script-src 'self'`), aucune navigation, aucune nouvelle fenêtre, aucune vue web intégrée | CSP `default-src 'none'`, `frame-ancestors 'none'`, `no-referrer` |
| V4 API et services web | Liste fermée de canaux IPC exposés par `preload.js` | Méthodes et adresses inconnues refusées (405 / 404), limitation à 60 demandes par minute et par adresse (429) |
| V5 Fichiers | L'interface ne peut **lire** que les fichiers désignés par l'utilisateur et **écrire** que dans les fichiers qu'il a choisis ; noms de fichiers assainis ; copies d'élèves limitées à des PDF de 30 Mo, 400 par séance, enregistrées dans le dossier de la classe | Sans objet (aucun fichier reçu) |
| V6 Authentification | Compte local par e-mail ; mot de passe administrateur dérivé par scrypt (N = 2¹⁷) ; signature numérique par certificat choisi par l'utilisateur | Licence signée Ed25519 + e-mail + identifiant du poste |
| V7 Sessions | Classe connectée : jeton aléatoire de 72 bits dans l'adresse, session arrêtée par l'enseignant | Sans session : chaque demande est autonome |
| V8 Autorisations | Règles d'établissement signées Ed25519 (impossible de les modifier sans la clé de l'administrateur) ; fonctions Premium contrôlées côté processus principal | Une licence n'est utilisable que par son e-mail ; désactivation seulement avec l'e-mail et l'identifiant du poste qui l'utilise |
| V9 Jetons autonomes | Jetons de licence `SKNT` signés Ed25519 par le service, vérifiés contre une liste de clés publiques, durée de validité de 14 jours | Signature avec la clé du service, conservée comme secret Cloudflare |
| V10 OAuth / OIDC | Sans objet | Sans objet |
| V11 Cryptographie | AES-256-GCM, Ed25519, SHA-256/512, HKDF, scrypt ; uniquement les implémentations de Node.js / Chromium / Web Crypto | Web Crypto (Ed25519) |
| V12 Communications sécurisées | TLS 1.3 minimum (Node.js et Chromium) | HTTPS obligatoire, TLS 1.3, HSTS 2 ans |
| V13 Configuration | Sandbox Electron, `contextIsolation`, pas de `nodeIntegration`, permissions du navigateur refusées par défaut (seules : plein écran, presse-papiers) | Secret uniquement par `wrangler secret`, aucune donnée sensible dans le dépôt |
| V14 Protection des données | Copies de récupération chiffrées, clés d'IA protégées par Windows, aucune télémétrie | Ne conserve que : e-mail, référence de licence, identifiant anonyme du poste, jours restants |
| V15 Codage et architecture sûrs | Analyse CodeQL, Dependabot, `npm audit` bloquant à chaque version et chaque jour | Code commun testé (`server/test-core.js`, 17 contrôles) |
| V16 Journalisation et erreurs | Journal d'administration (ouvertures, signatures, revues des droits…) ; messages d'erreur sans détail interne | Journaux Cloudflare (Observability) ; erreurs génériques |
| V17 WebRTC | Sans objet | Sans objet |

**Pourquoi pas le niveau 3 ?** Le niveau 3 ajoute des exigences (par exemple module matériel pour les clés, revue de
code indépendante, tests d'intrusion manuels par un tiers). Elles ne peuvent pas être attestées par l'éditeur
lui-même. Pour l'obtenir : faire réaliser un audit ASVS niveau 3 par un prestataire indépendant (voir section 6).

## 2. Chiffrement

### En transit

| Liaison | Protection |
|---|---|
| Application → Internet (licences, mises à jour, IA en ligne, polices) | **TLS 1.3 minimum** imposé (`tls.DEFAULT_MIN_VERSION` et `ssl-version-min`) ; toute connexion plus ancienne est refusée |
| Service d'activation | TLS 1.3, HSTS, certificat surveillé chaque jour (alerte à moins de 14 jours de l'échéance) |
| Classe connectée (réseau local de la classe) | **Exception** : HTTP sur le réseau local, car un certificat valable est impossible sur une adresse locale. Atténuations : jeton aléatoire de 72 bits, seuls des PDF sont acceptés, session arrêtée par l'enseignant, aucun accès à Internet |
| IA locale Ollama | **Exception** : HTTP sur `127.0.0.1` uniquement (ne quitte pas l'ordinateur) |

### Données chiffrées par le logiciel

| Donnée | Chiffrement | Clé |
|---|---|---|
| Copies de récupération (documents non enregistrés) | AES-256-GCM (en-tête `SKNE1`) | Clé de données du poste, aléatoire, protégée par Windows (DPAPI) |
| Compte et période d'essai | AES-256-GCM (format `G1`) | Dérivée par HKDF-SHA-256 de l'identifiant du poste |
| Clé privée de l'administrateur d'établissement | AES-256-GCM | Mot de passe administrateur, scrypt N = 2¹⁷ |
| Clés API de l'assistant IA | Protection Windows (DPAPI) | Session Windows de l'utilisateur |
| PDF protégés par mot de passe | AES-256 de la norme PDF (ISO 32000-2) | Mot de passe choisi par l'utilisateur |

Le chiffrement des PDF suit la norme PDF, qui impose AES-256 en mode CBC : c'est la seule façon d'obtenir un fichier
lisible par tous les lecteurs PDF. Les licences et jetons ne contiennent aucun secret : ils sont **signés** (Ed25519),
pas chiffrés.

## 3. Gestion des clés

| Clé | Rôle | Emplacement | Sauvegarde | Rotation |
|---|---|---|---|---|
| Clé de l'éditeur (Ed25519) | Signe les licences | `%USERPROFILE%\SknEDUpdf-licences\cle-privee-licences.pem` sur le PC de l'éditeur, **jamais dans le dépôt** | Copie hors-ligne chiffrée (clé USB chiffrée BitLocker, rangée à part) | Nouvelle clé ajoutée à `licencePublicKeys` dans une version, puis utilisée pour les nouvelles licences ; l'ancienne reste acceptée jusqu'à expiration des licences émises |
| Clé de mise à jour (Ed25519) | Signe le contenu des mises à jour sans installateur | `%USERPROFILE%\SknEDUpdf-licences\cle-privee-mises-a-jour.pem` sur le PC de l'éditeur, **jamais sur GitHub** (signature après la publication : `node tools/maj.js signer X.Y.Z`) | Même copie hors-ligne | Nouvelle clé publique ajoutée à `KEYS` dans `src/codeupdate.js` dans une version, puis signature avec elle |
| Clé du service (Ed25519) | Signe les jetons d'activation | Secret Cloudflare `SERVER_PRIVATE_KEY` + copie hors-ligne `cle-privee-serveur.pem` | Même copie hors-ligne | Nouvelle clé publique ajoutée à `serverPublicKey` (qui accepte une liste) dans une version ; une fois cette version diffusée, `wrangler secret put SERVER_PRIVATE_KEY` |
| Clé de données du poste (AES-256) | Copies de récupération | `cle-donnees.bin` (protégée par DPAPI) | Aucune (les copies ne servent qu'en cas de panne sur ce poste) | Effacer le fichier : une nouvelle clé est créée |
| Clé de l'administrateur d'établissement (Ed25519) | Signe les règles de l'établissement | `admin.json`, chiffrée AES-256-GCM par le mot de passe administrateur | Copier `admin.json` (déjà chiffré) hors du poste | Rechiffrée à chaque changement de mot de passe |
| Certificat de signature du code | Signera l'installateur | **Prévu, pas encore actif** : service SignPath (clé dans un module matériel, jamais sur un PC) | Géré par SignPath | Selon le certificat |

Règles : aucune clé privée dans le dépôt (détection de secrets GitHub active) ; une clé par usage ; accès réservé
à l'éditeur ; en cas de fuite d'une clé : la retirer de la liste des clés publiques dans une nouvelle version et réémettre.

## 4. Zero Trust

Principe : **ne jamais faire confiance à l'interface**, même si un document piégé parvenait à y exécuter du code.

- Le processus principal vérifie chaque demande : chemins (absolus, existants, désignés par l'utilisateur),
  types, tailles, droits d'établissement, droits Premium.
- **Lecture de fichiers** : seulement les fichiers déposés par l'utilisateur (chemin calculé hors de la page),
  ouverts par double-clic dans l'Explorateur, récents, ou rendus par les élèves. Un chemin inventé par la page est refusé.
- **Écriture** : seulement dans les fichiers ouverts ou choisis dans une fenêtre d'enregistrement.
- **Certificats de signature et fichiers Office protégés** : seulement ceux choisis par l'utilisateur.
- **Liens** : seulement `https://` et `mailto:` ; aucune navigation, aucune nouvelle fenêtre, aucune vue web intégrée.
- **Permissions du navigateur** (caméra, micro, position, notifications…) : toutes refusées sauf plein écran et presse-papiers.
- **Service d'activation** : chaque demande est vérifiée seule (signature de la licence, e-mail, poste),
  sans session ni confiance dans l'horloge du poste.

Preuve : l'étape `intrusion-interface` de l'auto-test tente chacun de ces détournements et échoue la version s'il réussit.

## 5. Revue des droits

| Quoi | Fréquence | Comment |
|---|---|---|
| Règles et postes d'un établissement | Tous les 90 jours | La console d'administration affiche l'échéance et rappelle par une notification quotidienne ; l'enregistrement des règles vaut revue (journal `rights_review`) |
| Compte Cloudflare (membres, jetons d'API) | Tous les 90 jours | Tableau de bord › Gérer le compte › Membres et Jetons d'API : retirer tout accès inutile |
| Dépôt GitHub (collaborateurs, clés de déploiement, secrets, applications autorisées) | Tous les 90 jours | Settings › Collaborators, Deploy keys, Secrets, Applications |
| Clés de l'éditeur | Tous les ans | Vérifier la copie hors-ligne et l'absence de copie ailleurs |

## 6. Tests d'intrusion et supervision

**Automatisés à chaque version** (la version n'est pas publiée en cas d'échec) :

- `intrusion-interface` : lecture de fichiers système, chemins inventés, fichier Office arbitraire, certificat arbitraire,
  liens `file:` et `javascript:`, dossier cloud arbitraire, nouvelle fenêtre, caméra, position, notifications ;
- `intrusion-disque` : copies de récupération confinées et chiffrées, clé protégée par Windows, coût scrypt ;
- `intrusion-classe` : nom d'élève piégé (`../`, `<script>`), nom de fichier piégé, jeton deviné ;
- `depot-utilisateur` : contre-épreuve (un fichier réellement déposé s'ouvre) ;
- `licence-jeton-falsifie`, `licence-autre-poste` et `server/test-core.js` : jetons et licences falsifiés,
  activation simultanée, entrées hostiles.

**Supervision continue** (`.github/workflows/supervision.yml`, chaque jour) : failles publiées dans les dépendances,
règles de licence, disponibilité et temps de réponse du service, TLS 1.3, certificat, en-têtes de sécurité,
refus des demandes invalides, canal de mises à jour. En cas d'échec, GitHub prévient par e-mail.
Journaux du service : Cloudflare › Workers › sknedu-licences › Observability. Contrôle manuel : `node tools/supervision.js`.

**Test externe** (recommandé une fois par an et avant un déploiement à grande échelle) : confier à un prestataire
un test d'intrusion de l'application de bureau (IPC, documents piégés, mise à jour) et du service d'activation,
avec vérification ASVS niveau 3. Ce test n'a pas encore été réalisé.

## 7. Disponibilité

- L'application fonctionne **entièrement hors-ligne** ; seule l'activation d'une licence demande Internet.
- Une licence active reste valable **14 jours sans connexion** ; la vérification se fait toute seule à la reconnexion.
- Les fonctions gratuites ne dépendent d'aucun service.
- Le service d'activation tourne sur le réseau mondial de Cloudflare (aucun serveur unique) ; l'offre gratuite
  (100 000 demandes par jour) couvre environ 30 000 postes actifs par jour.
- Mises à jour : publiées sur GitHub Releases, installées seulement après vérification d'intégrité ; quand Windows bloque
  l'installateur (contrôle intelligent), le contenu signé est mis en place sans installateur, avec retour automatique à la
  version précédente si la nouvelle ne démarre pas. Installation pour tous les utilisateurs (Program Files) : une
  autorisation administrateur est demandée ; le contenu est copié dans le dossier protégé puis revérifié sur place
  (SHA-512 de la description signée) avant l'échange, pour qu'un programme de l'utilisateur ne puisse pas le substituer.

## 8. Consommation énergétique et fichiers lourds

- Seules les pages visibles sont dessinées ; un dessin devenu inutile (défilement rapide) est annulé.
- Fenêtre réduite : aucune vérification périodique des règles.
- Sauvegardes de récupération et envois dans le cloud : seulement si le document a changé, jamais pendant la frappe,
  et plus espacés pour les gros fichiers (5 à 15 minutes au-delà de 20 Mo / 100 Mo).
- Impression : résolution adaptée au nombre de pages (moins de calcul et de mémoire pour les longs documents).
- Vérification de licence : une fois toutes les 12 heures ; recherche de mises à jour : toutes les 4 heures.
- Mesure de référence (auto-test `perf-fichier-lourd`, `EDUPDF_PERF=1`) : PDF de 1 000 pages / 133 Mo ouvert en 0,23 s,
  saut à la page 901 en 0,06 s, enregistrement en 0,6 s.
