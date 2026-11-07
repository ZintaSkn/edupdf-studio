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
| **Installation d'outils** (winget, Ollama) | Uniquement sur demande explicite (LibreOffice, Google Drive, IA locale…) | Aucune donnée personnelle | Ne pas lancer l'installation |

Les clés d'API de l'assistant IA sont chiffrées sur l'ordinateur (protection des données de Windows) et ne
sont jamais envoyées ailleurs qu'au fournisseur choisi. Les documents ouverts restent sur l'ordinateur.

Composants tiers : les services ci-dessus appliquent leur propre politique de confidentialité lorsque
l'utilisateur choisit de les utiliser.

Contact : ouvrez une demande sur https://github.com/ksehibi/edupdf-studio/issues
