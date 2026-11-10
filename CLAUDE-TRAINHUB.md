# TrainHub — mémoire de travail pour Claude (fichier CLAUDE-TRAINHUB.md)

PWA d'entraînement musical (basse, guitare, piano) en JavaScript « vanille », sans framework. Dépôt `lucas-webapp/trainhub`
(copie de travail : `/home/user/trainhub`). **Branches `main` et `structure-dossiers` : toujours identiques.**
La session Claude Code s'ouvre dans `/home/user/HarmoHub` : c'est **une autre appli** (la référence des trois), on n'y touche pas.
Tout le travail TrainHub se fait dans `/home/user/trainhub`.

## Suite à faire (lue par `/reprise` — à réécrire à la fin de CHAQUE demande)
- **Rien de prévu** (v270 livrée : ajout d'un morceau → sa fiche s'ouvre aussitôt (`revealExercise`) ; icône « Libre » ailée ; avant : v269 : badge des copies liées = deux feuilles (plus une chaîne, confondue avec la vignette « lien ») ; avant : v268 : ligne du dé refaite (réglage en engrenage, « Tirer » vert, confirmation avant de retirer le dé, icône d'objectif tempo métronome + flèche, « En cours » sur la même ligne) ; avant : note aussi sur les chapitres ; avant : note (pense-bête) sur chaque dossier ; avant : « Lancer la session » dans la barre du haut de la fiche ; avant : écrans de session cohérents, largeur réglable par poignées, bandeau « Ma session » redimensionnable ; avant : nom de l'espace en petites capitales, « En cours » discret, menus des caractéristiques d'un morceau). Aucune demande en attente : `/reprise` doit demander à l'utilisateur ce qui vient ensuite, sans rien commencer.
- Idées déjà proposées, à ne remettre sur la table que si la conversation s'y prête : voir « Idées proposées, pas encore faites » plus bas.
- **Règle** : à la fin de chaque demande, réécrire cette section (la suite annoncée par l'utilisateur, ou « Rien de prévu »), dans le même commit que la version.

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
7. Réécrire la section « Suite à faire » (en haut de ce fichier). Dernière version livrée : **v270**. La suivante sera v271.

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
- **Note d'un dossier (v266)** : `folder.note` (texte libre, absent si vide ; `normalizeFolder`, copié par `duplicateFolderDeep`). `folderNoteBlock(inst, nodes)` (sous le titre, dans `renderFolderBrowser`) : « ＋ Note » → cadre de 3 lignes → zone de saisie (blur = enregistre, Échap annule, Ctrl/Cmd+Entrée) ; `noteWithLinks` rend les URL cliquables (`openExternalLink`, jamais de HTML). Depuis v267 aussi sur les chapitres, y compris `kind: "songs"` (page d'accueil du chapitre seulement, pas dans les dossiers calculés). Dans un dossier, les notes de tous les niveaux au-dessus (chapitre compris) s'affichent sur une ligne (`.folder-note-parent`, clic = aller au parent). Banc `notedossier`.
- **Ligne du dé d'un exercice (v268)** : `buildExerciseDiceRow` → `.dice-ex-row` = dé (`.dice-ex-btn`, clic sur un dé allumé = `dlgConfirm` avant retrait) · réglage (`.dice-ex-set`, engrenage, ouvre la fenêtre du dé sur son dernier onglet) · « Tirer » (`.btn-accent.dice-ex-go`) · objectif tempo (`TARGET_ICON_SVG` = métronome + flèche en Z, aussi dans les sessions) · pastille « En cours » (`.ex-wip-chip`, plus dans `.ex-tools-line`) · tirage. Plus de résumé texte du dé (il reste dans l'infobulle du réglage). Banc `ligne_de`. Badge des copies liées (`appendExerciseLinkBadge`, `COPIES_ICON_SVG` = deux feuilles + nombre, v269) ≠ vignette « lien » (`LINK_ICONS.link`, chaîne) : ne jamais remettre la même icône aux deux.
- **Ajout d'un morceau (v270)** : `renderAddSongForm` → après `save()`, `revealExercise(ex.id)` (navigue vers le dossier où il est rangé, ouvre la fiche, défile, un seul morceau ouvert) + toast « complète sa fiche ». Ne pas remettre `collapsed: false` avant l'appel (sinon `exCollapseOthers` n'est pas joué). Bouton « Libre » (`index.html`, `#free-btn`) : chronomètre + 4 plumes d'ailes (viewBox `2.5 2 26 19`). Banc `morceau_ajout`.
- **Écrans de préparation d'une session (v264)** : `renderGuidedSessionMain` pose `gs-main-roomy` (+ `gs-main-pick` pour le choix) et `gsInstallWidthGrips` (poignée du bord droit, colonne collée au volet de gauche — le banc `rideau` exige un petit écart —, `--gs-w`, `trainhub.gsWidth.v1`, 720 px par défaut, 1 120 px pour le choix) ; `gsBindSplitGrip` = poignée générique (souris, clavier, double-clic) ; `gsPickSplitGrip` = poignée entre le choix et « Ma session » (`--gs-side`, `trainhub.gsSide.v1`). Hauteur unique des boutons de ces écrans : `--gs-ctl-h` (36 px). Fiche : « Lancer » dans la barre du haut (`.gs-edit-topbar`, à droite d'Enregistrer), puis nom, commentaire, onglets, exercices, « + Ajouter », PDF / liens (`.gs-edit-tools-row`).
- **Choix d'un exercice en session** : écran `renderGsPickScreen` + arbre `renderGsPickTree`, et fenêtre `openExercisePickerModal`.
  Chapitres dans l'ordre de la barre latérale (`pickChapters`) ; dossiers replié/déplié **mémorisés à part** (`trainhub.pickOpen.v1`,
  `pickIsOpen / pickSetOpen`, tout replié au départ) ; onglets Exercices / Morceaux / Favoris / En cours (déplaçables, `tabsSortable("pick")`, `pickTabMem` = ex|so|fav|wip, zones `pickZone`/`pickKindZones`) ; **ajout en rafale** (`gsPickChoose`, compteur, « Terminer ») avec **rond de rang** (`gsPickMark`, reclic = retrait via `gsPickRemoveEx`, plus de ×n) et bandeau collant **« Ma session »** (`gsPickPanel` : durées `bindScrubInput`, ordre glissable, ✕, total, camembert trié ; PAS de tri par durée) ; dossiers du choix glissables à la souris par la poignée `.pick-grip` (`pickBindFolderReorder`, option `handle` de `setupDragReorder`) ;
  marques « déjà dans la session » (`gsPickMark`). Piège connu : ne jamais appeler `focus()` sans `{preventScroll: true}` pendant un redessin
  (la vue sautait en haut).
- **Session depuis une séance (v258)** : `gsSessionFromRecord(rec)` (fenêtre : exercices dans l'ordre joué, durée arrondie à la minute, décochés si < 1 min ou supprimés) ;
  appelée par le message de fin de session libre (`gsAskSaveRun`), l'Historique (bouton ＋ `.gs-history-mksess`) et le calendrier.
- **Dernière fois jouée (v258)** : `lastPlayedIndex()` (index du journal, résout les alias des statistiques) → `buildLastPlayedLine`, tout en bas de la fiche (`renderExerciseDetails`). Information seule.
- **Ménage (v258-v259)** : bouton « Ménage… » dans la barre d'un chapitre de morceaux → `openSongsCleanupDialog` : variantes d'artistes (`songsArtistVariants` : sigle, faute à 1-2 lettres,
  « The », ponctuation ; « Pas les mêmes » = `trainhub.artistIgnore.v1`) fusionnées via `songsRenameValue` ; doublons de titre **en lecture seule** (`exerciseTitleDuplicates`, jamais morceau contre exercice).
- **Morceau → exercice (v259)** : `songToExercise` (titre + liens copiés avec nouveaux identifiants, AUCUNE caractéristique de morceau, `fromSongId`, dernier dossier dans `trainhub.songToEx.v1`) ;
  `buildKinshipLine` (« Tiré du morceau… » / « Travaillé aussi en exercice… »). Menu clic droit d'un exercice : actions courantes en tête, le reste sous « Plus d'actions » (`.ctx-more`).
- **Corbeille (v260)** : `addToTrash / restoreFromTrash / purgeFromTrash / emptyTrash` (limite `TRASH_LIMIT` = 50) ; **vidage par ancienneté** `trashOlderThan(jours)` + `purgeTrashEntries` (bouton « Vider les plus anciens… » =
  7 / 30 / 90 jours, confirmation) ; **rappel** `trashRemindCheck` (plus de 20 exercices, `trashExerciseCount` compte aussi ceux des dossiers/espaces supprimés ; au plus un par jour, `trainhub.trashRemind.v1` ; jamais en session/entraînement libre).
- **Dés** : le dé de gammes (`diceDraw`) ET le dé d'harmonie (`harmDraw`, v260) tirent **sans remise** dans un sac par dé et par jeu de faces (`diceBagStore`, `diceRefillBag`, clé `trainhub.diceBag.v1`, préfixe `h:` pour l'harmonie).
- **Statistiques** : `statsRows`, `renderStatsScreen`, graphiques SVG sans bibliothèque ; clic droit sur un point du graphique de tempo =
  `statsDropTempo` (vide le tempo de cette séance, avec « Annuler »).
- **Son (le point le plus délicat)** : métronome Web Audio (ordonnanceur dans un Worker + chien de garde), un contexte audio neuf à chaque lancement,
  échange de contexte au premier geste après une absence, bouée `<audio>` (désactivée par défaut), son de secours `<audio>` (désactivable), lecteur de
  fichiers audio (`audioEng*`, moteur de boucle sans coupure). Appliquer un préréglage pendant la lecture ne redémarre plus rien (`loadMetronomePreset`,
  `metroSoftRestart`, v240). **Journal du son** (`audioLog`, Paramètres › Métronome) + **signe de vie** (`trainhub.audioAlive.v1`, couvre aussi la
  session libre et le lecteur) : c'est ce qui permet de diagnostiquer après coup. **Contexte inactif fermé (v260)** : `metroIdleArm / metroIdleCheck` (`METRO_IDLE_MS` = 60 s) ferment le contexte qui ne joue plus rien
  (jamais pendant métronome, lecteur d'harmonie, enregistrement avec clic, ni session guidée avec cloche/enchaînement automatique) ; le lancement suivant repart sur un contexte neuf.

## Tests (Playwright, Chromium)
- `require('playwright')` fonctionne avec `NODE_PATH=/opt/node22/lib/node_modules` (ne pas réinstaller Playwright).
- Serveur statique depuis la racine du dépôt sur `:8765` (le banc vidéo a aussi besoin du faux lecteur YouTube sur `:8766`) : `lancer.sh` s'en charge.
- Harnais : `tests/_harness.js` → `const { check, plan, bilan } = require('…/_harness')('titre')` ; `plan(n)` déclare le minimum de vérifications
  (un banc qui s'arrête en route est signalé « COUVERTURE INCOMPLÈTE »). Un échec de couverture seul = exception levée en route : lire la sortie complète.
- Technique habituelle : amorcer `trainhub.v1` par `addInitScript` (garde `sessionStorage` pour ne pas réamorcer au rechargement),
  `localStorage['compteCloud.trainhub.nePlusProposer'] = '1'` (pas de fenêtre de connexion), bloquer `https://www.gstatic.com/firebasejs/**`,
  `serviceWorkers: 'block'`. Horloge simulée (`page.clock`) pour les vraies sessions ; CDP pour les mesures de performance.
  Un vrai plantage de page ne se joue pas ici : on recopie le signe de vie (`trainhub.audioAlive.v1`) dans une nouvelle page.
- Les **27 bancs** sont dans le dépôt : `tests/playwright/trainhub_<nom>_test.js` (morceaux 173, programmation 50, menage 52, rafale 42, choix 38, compte 68, note 34, note_session 86,
  favoris 31, rideau 33, session_ui 71, son 75, video 22, preset 22, point 31, lecteur 29, audio_rate 19, audio_edit 80, de 19, eph 12, volet 20, tempo 15, corbeille 24, sessions_ecrans 44, notedossier 31, ligne_de 23, morceau_ajout 14), avec leurs fichiers
  (`media/`, `yt_mock/`). Lancer : `tests/playwright/lancer.sh` (tous) ou `tests/playwright/lancer.sh morceaux choix` ; il démarre et arrête les
  serveurs :8765 et :8766. Un nouveau banc s'ajoute dans ce dossier, avec `plan(n)` ; le garder à jour quand un comportement change exprès.
- Lancer **toutes** les suites avant chaque livraison (≈ 15 min) ; adapter un banc existant seulement si le comportement a changé exprès.

## Sujets en cours / à savoir
- **Bug ouvert (Safari/macOS)** : son coupé ou application figée **en session libre uniquement** (jamais en session guidée ni hors session) ; une fois
  sur un MP3 du lecteur. Cause non établie ; v240 (plus de redémarrage du métronome au changement de préréglage), v242 (journal et signe de vie
  étendus au lecteur et à la session libre) et v260 (contexte audio inactif fermé, feu vert donné par l'utilisateur le 5 nov.) sont les pistes. **Non vérifié sur Safari** : à confirmer à l'usage. À la prochaine alerte, demander : copier le **journal du son** tout de suite, avant de
  relancer l'appli ; dire si c'est l'écran ou le son qui se fige ; si le chrono continue ; si le métronome ou un MP3 jouait ; si la version est à jour.
- Refusé pour l'instant : statistiques par artiste ou par style pour les morceaux.
- Idées de l'utilisateur déjà livrées : programmation de session (v257), session créée depuis une séance libre / ménage des artistes et doublons / « dernière fois jouée » en bas de fiche (v258 — SANS rappel : l'utilisateur n'en veut pas), morceau → exercice « Travailler un passage en exercice… » (v259 : titre + liens copiés, AUCUNE caractéristique de morceau, `fromSongId`), menu clic droit regroupé sous « Plus d'actions » (v259) ; le Ménage ne supprime ni ne fusionne JAMAIS d'exercice (doublons de titre en lecture seule), ajout en rafale, marques de doublons, onglet « En cours ». Idées proposées et refusées : « Tout ajouter » sur
  un dossier, onglet « À reprendre », filtres combinés pour les morceaux, filtre « fiches vides » (v260 : un exercice peut se suffire de son titre).

## Reprise (état au 5 novembre 2026, après la v260)
- **Livré en v260** : vidage de la corbeille par ancienneté + rappel au-delà de 20 exercices ; dé d'harmonie sans remise ; fermeture du contexte audio inactif (piste du bug Safari). Banc `corbeille` ajouté.
- **Banc `point`** : corrigé en v264 (ses 7 séances sont ramenées au 1er du mois en début de mois ; la page Statistiques n'affiche que le mois).
- **Ce que l'utilisateur ne veut PAS** : aucun rappel pour reprendre un exercice (la « dernière fois jouée » est une information, pas une alerte) ; le Ménage ne supprime ni ne fusionne jamais un exercice ;
  un exercice tiré d'un morceau ne porte aucune caractéristique de morceau (artiste, style, technique, travail) ; pas de tri de la liste « Ma session » par durée ;
  **pas de filtre « fiches vides » / « sans lien ni note »** (un exercice peut se suffire de son titre : une fiche vide n'est pas un défaut).
  Le seul rappel voulu est celui de la corbeille (plus de 20 exercices).
- **Usage constaté dans sa sauvegarde du 5 nov.** (85 exercices, 31 morceaux, 25 séances depuis le 8 oct.) : surtout des **sessions libres** (18/25, ≈ 26 min, 4-5 exercices), le soir ; séance moyenne 34 min,
  ≈ 6 min par exercice ; 76 % du temps sur exercices, 24 % sur morceaux ; seuls 35 exercices sur 85 apparaissent dans le journal ; liens à 98 % YouTube, très peu de fichiers (12). Morceaux « À maîtriser » : 20 dont 7 joués.
  Les 10 morceaux du chapitre « Morceaux » de la Guitare sont dans un chapitre **ordinaire** (non converti).
- **Idées proposées, pas encore faites** : (4) tempo bloqué — proposer un tempo progressif quand un exercice reste au même BPM 5 séances de suite ;
  (6) convertir en lot les 10 morceaux de la Guitare (`openSongsConvertDialog` existe) ; (8) vue « Ma pratique » (minutes par chapitre, part exercices/morceaux, régularité) ; relier les statistiques d'un morceau et de son exercice tiré (proposé, non demandé).
- **Sujet resté ouvert : « graphie des enharmoniques »** — on n'a pas su ce que l'utilisateur veut dire. Audit fait le 5 nov. (toutes les gammes × 12 tonalités, `spellBest`) : une lettre par degré, tonique au moins altérée (F♯ avant G♭ à égalité) ; les doubles altérations qui restent sont
  inévitables (Do dim7 = C E♭ G♭ B𝄫, Mi lydien ♯2…) ; la tonique n'est jamais renommée hors des deux noms du menu (pas de B♯ ni de C♭ pour C ou B). Rien changé. **Demander à l'utilisateur un exemple précis** (où, quelle note, ce qu'il voit, ce qu'il attend) avant de coder.
- **Limite à toujours dire** : tout est testé sous Chromium seulement ; ne jamais écrire « vérifié sur Safari/iPhone ». Réponses de l'utilisateur en français, courtes et honnêtes.
