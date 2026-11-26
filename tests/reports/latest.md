# Rapport — module `metronome` — 26/11/2026

## Résumé
- Testé : le métronome de bout en bout : ouvrir / fermer la fenêtre, volet épinglé (à droite, en bas sous 1 100 px et au téléphone), Jouer / Arrêter et chrono, tempo (±1, ±10, saisie, molette, TAP, bornes), mesure et accents, volume et son du clic, préréglages (réglages enregistrés du tempo progressif : créer, appliquer, renommer, supprimer, appliquer en pleine lecture), métronome d'un exercice (suivre la fiche ouverte, Annuler, disquette, ▶), « Tester le son » et journal du son, téléphone.
- Résultat : **73 tests, 479 exécutions sur les 7 projets : 474 réussies (dont 7 échecs voulus du bug ME-01) + 5 ignorées voulues (fixme : ME-02 sur chromium et edge, ME-03 sur webkit, tablette, mobile-iphone), 0 échoué** — deux passages complets identiques (≈ 10 min chacun, les deux derniers d'une série de six passages qui ont servi à stabiliser). Détail par projet plus bas.
- Suite conseillée : arbitrer ME-01 et ME-02 (mineurs), confirmer ME-03 sur un vrai Safari ; puis module `synchro`. Non couvert : le SON lui-même (aucune mesure du signal), l'avancée réelle du tempo progressif dans le temps, le mode « entraînement » (barres muettes) — voir la fin.

## Environnement
- Émulateurs `demo-trainhub` (Auth 9199, Firestore 8180) et serveur de test (8937) lancés par moi, **arrêtés à la fin**. Session `playwright-cli` `trainhub` fermée. Sortie audio factice (PulseAudio) laissée allumée, comme demandé.
- Production : la fixture commune échoue tout test qui enverrait une requête vers la production Firebase : aucune n'a été bloquée. À l'exploration, je n'ai pas relevé `playwright-cli requests` à intervalles réguliers (oubli) ; la configuration de la session bloque ces origines.
- Par projet (attendus) : chromium 69, firefox 69, webkit 69, edge 69, tablette 69, mobile-android 67, mobile-iphone 67.
- Temps : `page.clock` pour le chrono (5 s jouées = `00:05`, exact) et TAP ; le reste en temps réel avec des attentes sur des états (aucun `waitForTimeout`).

## Ce que l'exploration a appris (comportements à connaître)
- « Métronome » ouvre une fenêtre flottante (100 BPM, 4/4, volume 80). **« Fermer » arrête aussi la lecture** et remet le chrono à zéro (testé comme comportement observé). Un rechargement arrête tout.
- La punaise épingle dans un volet : à droite à partir de 1 100 px, **en bas** au-dessous (et au téléphone, avec ▾ / ▴ pour réduire). Le choix est retenu (`trainhub.metroDock.v1`) : le bouton rouvre ensuite le volet épinglé, même après un rechargement.
- Les « préréglages » du métronome sont les **« Réglages enregistrés » du tempo progressif** (signet sous l'escalier) : nom par défaut « Paliers N », ✎ renomme, ✕ supprime, un clic sur le nom applique (et ferme le menu). Appliquer ne change pas le tempo affiché, seulement le délai / seuil / paliers. Le réglage rattaché à un EXERCICE est autre chose (module `fiche` pour sa fenêtre).
- « Suivre l'exercice ouvert » (Paramètres, allumé par défaut) : volet épinglé seulement ; déplier une fiche qui a un réglage charge son tempo et sa mesure, même en lecture (elle continue), avec « Métronome réglé sur « X » … » + Annuler. Une icône disquette propose « Mettre à jour ce réglage dans l'exercice « X » ». Rouvrir la MÊME fiche après un exercice sans réglage ne recharge rien.
- Tempo : 30 à 300 ; une saisie hors limites est ramenée à la borne ; un 0 dans « Temps/mesure » est refusé (4 revient). Le « pas des gros boutons » (Paramètres) change le « 10 » de ± 10.
- Les quatre boutons autour du cadran passent sous le cadran rond : Playwright refuse le clic au centre, on vise leur partie libre (comme le doigt). Leur nom accessible est « − », « + », « − 10 » ; leur info-bulle (`title`) sert de repère. Les interrupteurs de Paramètres n'ont pas de nom accessible.
- **Graine d'état** : un état de départ sans `settings.metronome` ni `settings.prefs` (impossible en vrai : une appli neuve les crée) rend « Suivre l'exercice ouvert » muet alors que son interrupteur s'affiche allumé. Les tests partent donc des réglages d'une appli neuve (`METRO_DEFAUT`, `PREFS_DEFAUT`).
- Observé, non retenu : déplier une fiche dans les premières centaines de ms après l'ouverture du volet ou le chargement n'est pas suivi (une fois sur deux, surtout au premier test d'un navigateur froid) ; personne ne clique si vite. Les tests attendent que le volet soit immobile et que la page ait 3 s.
- Le journal du son : « Tester le son » affiche « Deux bips : … » et écrit « test du son » ; « Journal du son » copie dans le presse-papiers, ou, si la copie échoue, ouvre une boîte avec les dernières lignes datées (`MM-JJ hh:mm:ss.mmm état-page JOUE|arrêt ctx… | message`). Les tests remplacent le presse-papiers par un faux pour jouer les deux cas sur tous les navigateurs.

## Bugs (détail dans `tests/reports/bugs.md`)
**ME-01 (mineur) — épingler pendant la lecture remet le chrono à zéro**
- Étapes : 1. ouvrir le métronome, Jouer ; 2. attendre 3 s (chrono `00:03`) ; 3. cliquer la punaise.
- Attendu : le volet s'ouvre, la lecture et le chrono continuent (≥ `00:03`). Observé : la lecture continue mais le chrono repart de `00:00`.
- Appareils : identique sur les 7 projets. Test : `ouvrir-fermer.spec.ts` « épingler pendant la lecture ne remet pas le chrono à zéro » (`test.fail`, échec voulu ×7). Avis : bug de l'appli (le panneau est reconstruit).

**ME-02 (mineur, à arbitrer, intermittent) — Échap pendant la saisie du tempo valide la valeur**
- Étapes : 1. fenêtre FLOTTANTE ouverte, tempo 88 ; 2. cliquer le chiffre du cadran ; 3. taper 77 ; 4. Échap.
- Attendu : saisie abandonnée, tempo 88. Observé : la fenêtre se ferme ET 77 est enregistré. Dans le volet épinglé, Échap abandonne bien la saisie.
- Appareils : Chromium et Edge de bureau seulement, environ 6 fois sur 10 (8 échecs voulus sur 20 essais) ; jamais vu ailleurs. Test : `tempo.spec.ts` « saisie dans la fenêtre flottante : Échap abandonne… » (`test.fixme` sur chromium et edge, exigé ailleurs). Avis : bug de l'appli (ordre fermeture / validation à la sortie du champ).

**ME-03 (mineur, intermittent, avis : environnement WebKit plutôt que l'appli) — rechargement qui ne rend pas la main**
- Étapes : 1. Paramètres › Métronome, allumer « Son de secours » ; 2. recharger la page.
- Attendu : la page se recharge, l'interrupteur reste allumé. Observé : sur WebKit sous Linux, dans la série complète seulement (4 passages complets sur 6), `page.reload()` n'aboutit pas en 45 s (même en `domcontentloaded`) ; 24 rechargements sur 24 hors série (avec « Son de secours », « Bouée audio » ou rien) ont abouti en ≈ 0,2 s.
- Appareils : projets `webkit`, `mobile-iphone` (et une fois un comportement voisin sur iPhone avant correction des sélecteurs). Test : `journal-son.spec.ts` « Son de secours allumé : l'interrupteur garde son état après un rechargement » (`test.fixme` sur WebKit hors CI, exigé ailleurs). À rejouer en CI (macOS) avant d'y voir un bug de l'appli.

## Tests ajoutés — `tests/e2e/metronome/` (+ aide `aide-metronome.ts`)
- `ouvrir-fermer.spec.ts` — 9 (2 `@critique`, 2 `@ordinateur`) : ouvrir / fermer, fermer en lecture, tempo gardé, volet à droite / en bas (1 101 px / 1 099 px), ✕ et rechargement, épingler en lecture, ME-01, position et taille.
- `lecture.spec.ts` — 7 (1 `@critique`, 1 `@ordinateur`) : Jouer / Arrêter, pastille qui s'allume, chrono sous horloge, remise à zéro, tempo changé en lecture, muet, rechargement.
- `tempo.spec.ts` — 13 (2 `@critique`) : ±1, ±10, saisie (Entrée, sortie du champ, Échap épinglé et flottant = ME-02), bornes, molette, TAP ×3, persistance, pas des gros boutons.
- `mesure.spec.ts` — 11 (2 `@critique`) : 2/4, 3/4, 4/4, 5/4, 6/8, « None », cycle des accents, glisser sur les pastilles, « ⋯ » (temps/mesure 1-12, subdivision), changement en lecture, persistance.
- `son-volume.spec.ts` — 5 (1 `@critique`, 3 `@ordinateur`) : curseur de volume, muet, persistance, cinq sons du clic, « Écouter ce son ».
- `prereglages.spec.ts` — 8 (3 `@critique`) : tempo progressif, créer, appliquer, deux préréglages, renommer, supprimer, persistance, appliquer en pleine lecture (réf. B-01).
- `exercice.spec.ts` — 9 (4 `@critique`) : suivre la fiche ouverte, en lecture, Annuler, exercice sans réglage, interrupteur éteint, fenêtre flottante, disquette, ▶ de la fiche, ▶ d'une autre fiche en lecture (réf. B-01).
- `journal-son.spec.ts` — 7 (2 `@critique`) : « Tester le son », journal (copie impossible / réussie), traces d'une lecture, interrupteurs « Son de secours » et « Bouée audio » (état, puis état après rechargement = ME-03), lecture avec le son de secours.
- `telephone.spec.ts` — 4 (1 `@critique`, 4 `@mobile`) : fenêtre, tempo et mesure, bouton « Volume », volet en bas réductible.
- Total 73 tests : 18 `@critique`, 6 `@ordinateur`, 4 `@mobile`.

## Par projet (passage complet, identique deux fois)
- chromium 67 réussis + 1 échec voulu (ME-01) + 1 ignoré (ME-02) ; edge idem ; firefox 68 + 1 ; webkit 67 + 1 + 1 ignoré (ME-03) ; tablette idem ; mobile-android 66 + 1 ; mobile-iphone 65 + 1 + 1 ignoré (ME-03). Aucun échec.

## Sélecteurs et limites d'environnement
- Sélecteurs CSS faute de mieux : `.metronome-panel`, `.metro-dial-value`, `.metro-step`, `.metro-play-btn-big`, `.metro-chrono-value`, `.metro-presets-pop`, `.toast`. `data-testid` ou `aria-label` utiles : les quatre boutons du cadran, les interrupteurs de Paramètres, le curseur de volume.
- Pastilles : une pastille n'est « courante » qu'un instant, un sondage régulier la manque (Edge) ; le test pose un observateur de mutations dans la page.
- Limite d'environnement PROUVÉE : Playwright refuse `mouse.wheel` en WebKit mobile (« Mouse wheel is not supported in mobile WebKit ») ; le test de la molette y envoie le même événement `wheel` au cadran (assertion identique).
- B-01 (contexte audio de plus quand on applique un préréglage en lecture, sortie audio factice) : non re-testé ; les tests « appliquer en pleine lecture » ne vérifient que l'observable (la lecture continue, le chrono n'est pas remis à zéro, le tempo change).

## Non couvert
- Le SON lui-même (aucune mesure du signal ; banc `son`), les contextes audio (bancs `son`, `eph`, `preset`).
- L'avancée réelle du tempo progressif dans le temps (+1 BPM toutes les N s, seuil, paliers, retour au tempo de départ) et le mode « entraînement » (mesures muettes, fondu) : ni explorés ni testés ; dépendent du temps audio réel.
- Pré-remplissage de « Tempo atteint » par le métronome en séance libre (≈ 25 s d'audio réel) ; « Suivant » d'une session guidée qui applique le réglage de l'exercice (module `session`, banc `preset`) ; fenêtre « Réglage pour « X » » (module `fiche`).
- Glisser pour déplacer / redimensionner la fenêtre ou la largeur du volet.
