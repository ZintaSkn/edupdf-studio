# Sécurité d'EduPDF Studio

## Signaler une faille

Merci de **ne pas ouvrir de ticket public**. Utilisez l'onglet **Security › Report a vulnerability** du dépôt GitHub
(signalement privé). Vous recevrez une réponse sous 7 jours.

## Mesures en place

| Domaine | Protection |
|---|---|
| Documents piégés | PDF.js à jour, sans évaluation de code ; interface isolée (sandbox Electron, `contextIsolation`), politique CSP stricte, aucune navigation hors de l'application |
| Fichiers | L'interface ne peut écrire que dans les fichiers choisis par l'utilisateur ; liens externes en `https` uniquement |
| Mises à jour | Téléchargées depuis GitHub Releases en HTTPS, intégrité vérifiée (SHA-512) avant installation ; chaque version passe l'auto-test complet avant publication |
| Clés API (assistant IA) | Chiffrées par Windows (DPAPI), jamais renvoyées à l'interface, jamais écrites en clair |
| Administration | Règles signées Ed25519, clé privée chiffrée (AES-256-GCM, scrypt) par le mot de passe administrateur |
| Code source | Analyse CodeQL, alertes et mises à jour Dependabot, détection de secrets à l'envoi |

## Limites connues

- L'installateur n'est pas encore signé par un certificat d'éditeur : Windows SmartScreen affiche un avertissement
  au premier lancement (« Informations complémentaires › Exécuter quand même »).
- L'exécutable Electron n'est volontairement pas modifié (fusibles, intégrité asar) tant qu'il n'est pas signé :
  toute modification le ferait bloquer par le Contrôle intelligent des applications de Windows 11.
