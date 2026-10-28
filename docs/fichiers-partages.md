# Fichiers partagés entre HarmoHub, TabHub et TrainHub

Décision du 28/10/2026 : on garde **une copie par appli** (pas de dépôt commun, pas de dépendance réseau au
chargement), mais **HarmoHub est la référence**. Toute modification se fait d'abord ici, puis on copie le
fichier **tel quel** dans les autres applis. Rien de propre à une appli ne va dans ces fichiers : ce qui
change d'une appli à l'autre passe par les options (`monterCompteCloud`) ou par l'adaptateur
(`demarrerSynchro`).

## Versions de référence

| Fichier | Version | Empreinte SHA-256 | Utilisé par |
|---|---|---|---|
| `compte-cloud.js` | 1 | `1eb4aa1c9669255f8ab8e7ce5d9fb41781996a72dd830dbd37b50fd341e595a1` | HarmoHub, TabHub, TrainHub |
| `synchro-cloud.js` | 2 | `a55d0487e718bbcf05709cd5f1be98b89e3795706dca06e47a3ea3abc6865270` | HarmoHub, TabHub (TrainHub a son propre moteur) |

Le banc `tests/compte_cloud_test.js` refuse un fichier dont l'empreinte ne correspond plus à ce tableau :
modifier un fichier partagé oblige donc à augmenter sa version (en-tête `// VERSION N` **et** constante
`…_VERSION`) et à recalculer l'empreinte ici (`sha256sum compte-cloud.js synchro-cloud.js`).

## Ce que fait chaque fichier

- **`compte-cloud.js`** : tout ce qui se VOIT de la connexion, identique dans les trois applis.
  - la pilule de la barre du haut : « G Se connecter », ou la pastille d'état + le nom du compte (sur
    téléphone : le G seul, ou la pastille + l'initiale) ;
  - le menu du compte : qui est connecté, l'état de la synchro en toutes lettres, « Se déconnecter » ;
  - la fenêtre de connexion : proposée à l'ouverture quand personne n'est connecté, une fois par onglet, avec
    « Ne plus me le proposer sur cet appareil » (retenu par appli) ; et le garde-fou « Tu n'es pas connecté »
    à la première modification, si la fenêtre n'a pas déjà été vue dans l'onglet.
  - Il ne connaît ni Firebase ni les données : l'appli lui dit qui est connecté (`authPrete`, `utilisateur`)
    et où en est la synchro (`etat`), il lui rend les clics (`seConnecter`, `seDeconnecter`).
  - Ses styles sont à lui (classes `cc-…`) et ne lisent que les variables communes aux trois applis
    (`--bg`, `--text-main`, `--text-muted`, `--border`, `--accent`, `--font`).
- **`synchro-cloud.js`** : le moteur de synchro Firebase (connexion, envoi différé en transaction, écoute,
  reprise après panne). Depuis la version 2, il ne dessine plus rien et parle au composant (`elements.ui`).

## Les états de la pastille (communs)

| État | Couleur | Libellé |
|---|---|---|
| `synced` | vert | Synchronisé avec le cloud |
| `syncing` | bleu, pulsé | Envoi en cours… |
| `pending` | orange | Modifications pas encore envoyées |
| `offline` | gris | Hors ligne — les modifications partiront au retour du réseau |
| `error` | rouge | Erreur de synchronisation — la dernière version reste enregistrée sur cet appareil |
| `toolarge` | rouge | Données trop volumineuses pour le cloud — fais une sauvegarde sur disque |

## Procédure pour propager une nouvelle version

1. Dans HarmoHub : modifier le fichier, augmenter sa version, recalculer l'empreinte dans ce tableau, passer
   `compte_cloud_test` et `synchro_cloud_test`, pousser.
2. Dans la discussion de l'autre appli, coller la consigne donnée à ce moment-là (elle dit quel fichier
   récupérer, depuis quel commit, et quelle empreinte vérifier). Les sessions ne se voient pas entre elles :
   c'est l'utilisateur qui porte la consigne d'une discussion à l'autre.
3. L'autre session récupère le fichier depuis le dépôt public HarmoHub, vérifie l'empreinte, ne change que
   l'appel (options / adaptateur), passe ses bancs, pousse.

## Où en est chaque appli

| Appli | `compte-cloud.js` | `synchro-cloud.js` | Remarque |
|---|---|---|---|
| HarmoHub | 1 | 2 | référence |
| TabHub | à installer | 1 (copie du 03/10, en retard) | consigne donnée le 28/10 |
| TrainHub | 1 | — (moteur propre) | installé le 28/10 (version v224) ; son moteur de synchro n'est pas touché |
