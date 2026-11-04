# TrainHub — mémoire de travail pour Claude (fichier CLAUDE-TRAINHUB.md)

PWA d'entraînement musical (basse, guitare, piano) en JavaScript « vanille », sans framework. Dépôt `lucas-webapp/trainhub`
(copie de travail : `/home/user/trainhub`). **Branches `main` et `structure-dossiers` : toujours identiques.**
La session Claude Code s'ouvre dans `/home/user/HarmoHub` : c'est **une autre appli** (la référence des trois), on n'y touche pas.
Tout le travail TrainHub se fait dans `/home/user/trainhub`.

## Comment travailler avec l'utilisateur
- Il écrit en **français** : répondre en français, court, sans jargon inutile. Les textes de l'appli, les commentaires du code et le README sont en français.
- Rapport final honnête : dire ce qui est vérifié et ce qui ne l'est pas. Les tests tournent **sur Chromium seulement** ; l'utilisateur utilise Safari
  (macOS) et l'iPhone : ne jamais affirmer qu'un correctif est vérifié sur Safari/iPhone.
- Pour une nouveauté importante, il aime qu'on **discute d'abord** (avis, améliorations, régressions possibles) avant de coder ; pour une demande
  claire, il veut que ce soit fait, testé et poussé. Il répond souvent « Fais au mieux » : trancher, puis l'expliquer.
- Garder les écrans **légers** : l'appli a déjà retiré les étiquettes et les statuts, jugés trop compliqués au quotidien. Pas d'options à cocher en plus
  sans nécessité (il a refusé une case « Rester ici après chaque ajout » : l'ajout en rafale est le seul comportement).
- Ne pas créer de pull request (on pousse directement sur `main` + `structure-dossiers`). Pas de nom de modèle dans les commits.

## Cycle de chaque demande (toujours dans cet ordre)
1. Implémenter dans `script.js` / `style.css` (`node --check script.js` après chaque modification).
2. Tester avec Playwright (voir « Tests »), toutes les suites existantes à la fin, pas seulement la nouvelle.
3. `README.md` : **une puce par version** (« - Titre (vNNN) — description… »), insérée après la puce de la version précédente.
4. `sw.js` : incrémenter `CACHE_NAME = "trainhub-vNNN"` (sinon l'appli installée garde l'ancien code) **et** `APP_VERSION = "vNNN"` dans `script.js` (écrit en tête du journal du son).
5. Commit avec les deux lignes finales fournies par la session : `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` puis
   `Claude-Session: https://claude.ai/code/session_…` (reprendre l'URL donnée par le rappel d'attribution de la session en cours).
6. `git push -q origin main`, puis `git push -q origin HEAD:structure-dossiers`, puis vérifier avec `git ls-remote origin main structure-dossiers`
   que les deux pointent sur le même commit. (Le message « This repository moved » de GitHub est sans conséquence.)
7. Dernière version livrée : **v256**. La suivante sera v257.

## À ne pas toucher
- **Le moteur de synchronisation cloud** (Firestore : envoi différé, écoute, reprise). Les nouveaux champs voyagent avec l'état sans le modifier.
- Fichiers **partagés avec HarmoHub et TabHub**, à laisser tels quels : `compte-cloud.js`, `docs/fichiers-partages.md`, `tests/compte_cloud_test.js`,
  `tests/_harness.js` (un banc vérifie leur empreinte SHA-256 ; HarmoHub est la référence).

## Architecture (script.js ≈ 25 600 lignes, une seule IIFE ; style.css ≈ 5 100 lignes)
- **État** : `localStorage "trainhub.v1"` → `state.instruments[]` (`{id, name, categories[], pinnedOrder}`) ; une catégorie = un **chapitre**, qui contient
  des `folders[]` (récursifs) et des `exercises[]`. `state.settings` : `guidedSessions`, `sessionFolders`, `sessionPlan`, `metronome`, `prefs`,
  `appearance`, `statsRules`, `trash`… La synchro cloud remplace l'état en bloc (le plus récent gagne, `updatedAt`).
- **Journal des séances faites** : à part, un lot par mois (`trainhub.log.AAAA-MM`), fonctions `logAll / logAdd / logRemove`.
- **Exercice** : `{id, title, notes, fixedNotes, links, files, images, favorite, archived, inProgress, metronome, tempoGoal, linkId, collapsed, updatedAt…}`.
  `linkId` = copies « liées » (pièces jointes et réglages partagés).
- **Rendu** : `render()` reconstruit tout (sidebar, barre de chapitres mobile, zone principale). Menus : `bindContextGesture` (clic droit + appui long),
  `openExerciseMenu`, `openFolderMenu`. Dialogues : `dlgConfirm / dlgPrompt / dlgChoice / ifNameFree`. Annulation : `toastUndo` (annule le dernier
  changement) ; sauvegarde de secours avant les opérations lourdes : `backupSnapshot(raison, état)`.
- **Dialogues** : un clic clavier (`detail === 0`) dans les 0,4 s après l'ouverture est ignoré (sinon la touche Entrée qui ouvre « Ce nom existe déjà »
  la validait aussitôt).
- **Morceaux (v243)** : un chapitre `kind: "songs"` range ses morceaux **à plat** ; chaque morceau est un exercice avec `isSong, artist, songName`
  (le titre affiché est toujours `« Artiste - Titre »`), `styles[]`, `techniques[]`, `work`. Vocabulaires par chapitre : `ch.vocab = {styles, techniques,
  work, inProgress}` (noms renommables ; `inProgress` = l'état de Travail qui compte comme « en cours »). Les « dossiers » sont **calculés**
  (`songsGroups` ; dossier d'artiste dès 2 morceaux ; « Sans style / À classer » pour ne rien perdre). Préférences d'affichage : `trainhub.songsUi.v1`
  (par chapitre, sur l'appareil). Fonctions clés : `normalizeSongsChapter`, `songsSync` (appelée dans `render`), `renderSongsMain`,
  `songsPickContent`, `openSongsConvertDialog` (transformation d'un chapitre : fusion des doublons, remplacement dans les sessions, alias
  statistiques). Les morceaux ne se dupliquent ni ne se lient (pas de « Dupliquer » / « Liaison » dans leur menu).
- **« En cours » (v245)** : `exInProgress(ex)` / `exSetInProgress(ex, on)` ; pastille `ex.inProgress` pour un exercice, état de Travail pour un morceau.
- **Choix d'un exercice en session** : écran `renderGsPickScreen` + arbre `renderGsPickTree`, et fenêtre `openExercisePickerModal`.
  Chapitres dans l'ordre de la barre latérale (`pickChapters`) ; dossiers replié/déplié **mémorisés à part** (`trainhub.pickOpen.v1`,
  `pickIsOpen / pickSetOpen`, tout replié au départ) ; onglets Tous / Favoris / En cours ; **ajout en rafale** (`gsPickChoose`, compteur, « Terminer ») ;
  marques « déjà dans la session » (`gsPickMark`). Piège connu : ne jamais appeler `focus()` sans `{preventScroll: true}` pendant un redessin
  (la vue sautait en haut).
- **Statistiques** : `statsRows`, `renderStatsScreen`, graphiques SVG sans bibliothèque ; clic droit sur un point du graphique de tempo =
  `statsDropTempo` (vide le tempo de cette séance, avec « Annuler »).
- **Son (le point le plus délicat)** : métronome Web Audio (ordonnanceur dans un Worker + chien de garde), un contexte audio neuf à chaque lancement,
  échange de contexte au premier geste après une absence, bouée `<audio>` (désactivée par défaut), son de secours `<audio>` (désactivable), lecteur de
  fichiers audio (`audioEng*`, moteur de boucle sans coupure). Appliquer un préréglage pendant la lecture ne redémarre plus rien (`loadMetronomePreset`,
  `metroSoftRestart`, v240). **Journal du son** (`audioLog`, Paramètres › Métronome) + **signe de vie** (`trainhub.audioAlive.v1`, couvre aussi la
  session libre et le lecteur) : c'est ce qui permet de diagnostiquer après coup.

## Tests (Playwright, Chromium)
- `require('playwright')` fonctionne avec `NODE_PATH=/opt/node22/lib/node_modules` (ne pas réinstaller Playwright).
- Serveur statique depuis la racine du dépôt sur `:8765` (le banc vidéo a aussi besoin du faux lecteur YouTube sur `:8766`) : `lancer.sh` s'en charge.
- Harnais : `tests/_harness.js` → `const { check, plan, bilan } = require('…/_harness')('titre')` ; `plan(n)` déclare le minimum de vérifications
  (un banc qui s'arrête en route est signalé « COUVERTURE INCOMPLÈTE »). Un échec de couverture seul = exception levée en route : lire la sortie complète.
- Technique habituelle : amorcer `trainhub.v1` par `addInitScript` (garde `sessionStorage` pour ne pas réamorcer au rechargement),
  `localStorage['compteCloud.trainhub.nePlusProposer'] = '1'` (pas de fenêtre de connexion), bloquer `https://www.gstatic.com/firebasejs/**`,
  `serviceWorkers: 'block'`. Horloge simulée (`page.clock`) pour les vraies sessions ; CDP pour les mesures de performance.
  Un vrai plantage de page ne se joue pas ici : on recopie le signe de vie (`trainhub.audioAlive.v1`) dans une nouvelle page.
- Les **20 bancs** sont dans le dépôt : `tests/playwright/trainhub_<nom>_test.js` (morceaux 165, rafale 42, choix 38, compte 68, note 34, note_session 86,
  favoris 31, rideau 33, session_ui 55, son 67, video 22, preset 22, point 31, lecteur 29, audio_rate 19, audio_edit 80, de 13, eph 12, volet 20, tempo 15), avec leurs fichiers
  (`media/`, `yt_mock/`). Lancer : `tests/playwright/lancer.sh` (tous) ou `tests/playwright/lancer.sh morceaux choix` ; il démarre et arrête les
  serveurs :8765 et :8766. Un nouveau banc s'ajoute dans ce dossier, avec `plan(n)` ; le garder à jour quand un comportement change exprès.
- Lancer **toutes** les suites avant chaque livraison (≈ 15 min) ; adapter un banc existant seulement si le comportement a changé exprès.

## Sujets en cours / à savoir
- **Bug ouvert (Safari/macOS)** : son coupé ou application figée **en session libre uniquement** (jamais en session guidée ni hors session) ; une fois
  sur un MP3 du lecteur. Cause non établie ; v240 (plus de redémarrage du métronome au changement de préréglage) et v242 (journal et signe de vie
  étendus au lecteur et à la session libre) sont les pistes. À la prochaine alerte, demander : copier le **journal du son** tout de suite, avant de
  relancer l'appli ; dire si c'est l'écran ou le son qui se fige ; si le chrono continue ; si le métronome ou un MP3 jouait ; si la version est à jour.
- Refusé pour l'instant : statistiques par artiste ou par style pour les morceaux.
- Idées de l'utilisateur déjà livrées : ajout en rafale, marques de doublons, onglet « En cours ». Idées proposées et refusées : « Tout ajouter » sur
  un dossier, onglet « À reprendre », filtres combinés pour les morceaux.
