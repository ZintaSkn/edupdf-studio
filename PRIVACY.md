# Confidentialité — SknEDU-studio

SknEDU-studio fonctionne **hors connexion**. Le logiciel ne collecte aucune donnée personnelle, n'envoie
**aucune statistique d'utilisation** et ne transfère aucune information vers un autre système en réseau,
sauf dans les cas suivants, tous visibles et à l'initiative de l'utilisateur ou de son administrateur :

| Connexion | Quand | Données envoyées | Comment la désactiver |
|---|---|---|---|
| **Mises à jour** (github.com) | Au démarrage puis toutes les 4 heures | Aucune donnée personnelle : demande de la dernière version publiée | Aide › Préférences › « Rechercher les mises à jour automatiquement » |
| **Assistant IA** (Anthropic, OpenAI, Google, Mistral) | Uniquement quand l'utilisateur lance une demande à l'IA avec **sa propre clé** | Le texte de la demande et la page, la sélection ou le document choisi | Ne pas configurer de clé ; ou IA locale (Ollama), qui ne quitte pas l'ordinateur ; l'administrateur peut bloquer l'IA |
| **Cloud** (OneDrive, Google Drive, Dropbox…) | Uniquement si l'utilisateur enregistre dans un dossier synchronisé ou active la sauvegarde automatique | Le document enregistré, transmis par l'application officielle du service | Ne pas activer la sauvegarde automatique ; l'administrateur peut bloquer le cloud |
| **Classe connectée** (réseau local) | Uniquement quand l'enseignant démarre un partage | Le document partagé, aux appareils de la classe connectés au même réseau | Arrêter le partage (arrêt automatique à la fermeture) |
| **Notifications d'administration** (ntfy) | Uniquement si l'administrateur de l'établissement les configure | Type d'évènement, poste et utilisateur concernés | Console d'administration |
| **Activation des licences** (service de l'éditeur, Cloudflare) | Uniquement pour activer, désactiver ou revérifier une licence (au plus une fois par 12 h) | Clé de licence, adresse e-mail du compte, identifiant anonyme du poste | Ne pas activer de licence en ligne ; la version gratuite et l'essai fonctionnent sans connexion |
| **Compte et essai** | Au premier démarrage | **Rien n'est envoyé** : l'adresse e-mail, le nom et l'établissement saisis restent sur l'ordinateur, avec la date de début de l'essai | — |
| **Installation d'outils** (winget, Ollama) | Uniquement sur demande explicite (LibreOffice, Google Drive, IA locale…) | Aucune donnée personnelle | Ne pas lancer l'installation |

Le compte (adresse e-mail obligatoire, nom et établissement facultatifs) et la date de début de l'essai sont
enregistrés sur l'ordinateur, sous forme scellée : dossier commun du PC (ProgramData\EduPDF), registre de Windows
(HKCU\Software\SknEDU-studio), dossier local (AppData\Local\SknEDU) et données de l'application. Ces informations
servent uniquement à l'essai et à la vérification de la licence ; elles ne sont transmises à personne. Elles sont
conservées après la désinstallation pour que l'essai ne puisse pas être recommencé sur le même poste.

Les clés d'API de l'assistant IA sont chiffrées sur l'ordinateur (protection des données de Windows) et ne
sont jamais envoyées ailleurs qu'au fournisseur choisi. Les documents ouverts restent sur l'ordinateur.

Composants tiers : les services ci-dessus appliquent leur propre politique de confidentialité lorsque
l'utilisateur choisit de les utiliser.

Contact : ouvrez une demande sur https://github.com/ZintaSkn/edupdf-studio/issues
