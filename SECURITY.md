# Sécurité de SknEDU-studio

## Signaler une faille

Merci de **ne pas ouvrir de ticket public**. Utilisez l'onglet **Security › Report a vulnerability** du dépôt GitHub
(signalement privé). Vous recevrez une réponse sous 7 jours.

## Mesures en place

| Domaine | Protection |
|---|---|
| Documents piégés | PDF.js à jour, sans évaluation de code ; interface isolée (sandbox Electron, `contextIsolation`), politique CSP stricte, aucune navigation hors de l'application |
| Fichiers | L'interface ne peut écrire que dans les fichiers choisis par l'utilisateur ; liens externes en `https` uniquement |
| Mises à jour | Téléchargées depuis GitHub Releases en HTTPS, intégrité vérifiée (SHA-512) avant installation ; sans installateur (contrôle intelligent de Windows) : contenu accepté seulement s'il est signé par la clé de mise à jour de l'éditeur (Ed25519, conservée hors de GitHub) ; chaque version passe l'auto-test complet avant publication |
| Clés API (assistant IA) | Chiffrées par Windows (DPAPI), jamais renvoyées à l'interface, jamais écrites en clair |
| Administration | Règles signées Ed25519, clé privée chiffrée (AES-256-GCM, scrypt) par le mot de passe administrateur |
| Code source | Analyse CodeQL, alertes et mises à jour Dependabot, détection de secrets à l'envoi |
| Communications | TLS 1.3 minimum pour toutes les connexions Internet ; service d'activation en HTTPS avec HSTS |
| Données locales | Copies de récupération et compte chiffrés en AES-256-GCM (clé protégée par Windows) |
| Accès (Zero Trust) | L'interface n'ouvre que les fichiers désignés par l'utilisateur ; permissions du navigateur refusées ; revue des droits tous les 90 jours |
| Modèles CIA et AAA | Appelant vérifié à chaque appel interne, essais de mot de passe limités, session administrateur limitée à 15 minutes, journal de sécurité scellé, signature manuscrite chiffrée, reprise après plantage |
| Tests et supervision | Tests d'intrusion automatisés à chaque version ; supervision quotidienne du service (`.github/workflows/supervision.yml`) |

Détail point par point (OWASP ASVS niveau 2, chiffrement, gestion des clés, Zero Trust, disponibilité, énergie) :
[docs/SECURITE.md](docs/SECURITE.md).

## Limites connues

- L'installateur n'est pas encore signé par un certificat d'éditeur : Windows SmartScreen affiche un avertissement
  au premier lancement (« Informations complémentaires › Exécuter quand même ») et, quand le contrôle intelligent des
  applications de Windows 11 est actif, l'installateur est bloqué. Dans ce cas : version sans installation (archive ZIP
  de la page des versions), puis mises à jour du contenu signées, sans installateur. Une nouvelle version d'Electron
  exige en revanche le nouvel installateur ou la nouvelle archive : la solution durable reste la signature du code
  (SignPath Foundation, certificat d'éditeur) ou le Microsoft Store.
- L'exécutable Electron n'est volontairement pas modifié (fusibles, intégrité asar) tant qu'il n'est pas signé :
  toute modification le ferait bloquer par le Contrôle intelligent des applications de Windows 11.
