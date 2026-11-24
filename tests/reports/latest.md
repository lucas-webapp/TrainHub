# Rapport — module `bibliotheque` — 23/11/2026

## Résumé
- Testé : espaces, chapitres, dossiers, exercices (ajout, renommage, copies liées, corbeille, favori, « En cours », archivage), menu clic droit / appui long, sélection multiple, glisser-déposer, volet latéral, fil d'Ariane, tri et filtres, loupe et recherche rapide, annuler / rétablir.
- Résultat : **93 tests, sur les 7 projets : 578 réussis, 21 « échecs attendus » (bugs BI-01 à BI-03 marqués `test.fail`), 2 ignorés voulus (BI-04), 0 échoué.** Deux passages complets identiques par `emulators:exec` (9,2 et 8,8 min), après deux autres passages qui ont fait corriger 2 tests fragiles.
- Suite conseillée : décider des bugs BI-02 (accents de la loupe) et BI-03 (barre de sélection) ; puis module `fiche`.

## Environnement
- Émulateurs `demo-trainhub` (Auth 9199, Firestore 8180) et serveur de test (8937) : lancés par moi, arrêtés. Session `playwright-cli` `trainhub` fermée.
- Aucune requête vers la production (le garde-fou de la fixture n'a rien bloqué ; aucun test n'a échoué pour ce motif).
- Résultats par projet : chromium, firefox, edge 89 tests chacun ; webkit et tablette 88 + 1 ignoré ; mobile-android et mobile-iphone 78 chacun.

## Bugs (détail dans `tests/reports/bugs.md`)
**BI-01 (mineur, à arbitrer) — le champ « Ajouter un exercice… » perd le focus après Entrée**
- Étapes : 1. ouvrir un chapitre ; 2. cliquer le champ, taper « Un », Entrée ; 3. taper « Deux », Entrée.
- Attendu : le champ reste prêt (ajout en rafale au clavier). Observé : le focus passe au `<body>`, « Deux » est perdu.
- Appareil : observé sur Chromium (playwright-cli) ; le test échoue (attendu) sur les 7 projets.
- Trace : `exercices.spec.ts`, « après Entrée, le champ… garde le focus ». Avis : bug de l'appli ou choix voulu ; à arbitrer.

**BI-02 (gênant) — la loupe est sensible aux accents**
- Étapes : 1. loupe ; 2. taper « arpeges » (ou « arpe »). Attendu : « Arpèges » trouvé. Observé : aucun résultat.
- La recherche rapide (Ctrl/⌘ + F), elle, ignore les accents. « ARPÈGES » (casse seule) marche.
- Appareil : tous. Trace : `recherche.spec.ts`, « la loupe trouve « Arpèges » en tapant « arpeges » ». Avis : bug de l'appli (incohérence entre les deux recherches).

**BI-03 (gênant) — la barre de sélection recouvre le bas de la liste**
- Étapes : 1. 14 exercices dans un dossier ; 2. « Sélectionner (plusieurs) » sur le premier ; 3. descendre tout en bas.
- Attendu : le dernier exercice et le champ d'ajout passent au-dessus de la barre. Observé : la barre fixe les recouvre, même au bas du défilement (mesuré sur les 7 projets).
- Au téléphone c'est pire : sur iPhone (659 px de haut), le 2ᵉ exercice d'un dossier de 2 exercices n'est déjà plus touchable. Contournements : « Tout », ✕.
- Trace : `selection.spec.ts`, « la barre d'actions ne recouvre pas… ». Avis : bug de l'appli.

**BI-04 (gênant, intermittent ≈ 30 %) — palette « Recherche rapide » sans focus sur WebKit**
- Étapes : 1. Ctrl/⌘ + F (ou loupe puis « Recherche rapide ») ; 2. taper aussitôt.
- Attendu : le texte entre dans le champ. Observé : une fois sur trois, le focus reste sur `<body>` / le bouton, le texte est perdu.
- Appareil : `webkit` et `tablette` seulement (15 essais Chromium, Firefox, Edge : 0 échec ; iPhone 10 essais : 0 échec).
- Test : `test.fixme` sur ces deux projets (intermittent) ; la même vérification tourne ailleurs. Avis : bug de l'appli (course sur le focus), à confirmer sur un vrai Safari.

## Autres observations (pas des bugs)
- Il n'y a pas d'archivage de chapitre : « Archivés » liste les exercices archivés (testé).
- Le champ « Nouveau sous-dossier… » n'est affiché qu'au téléphone ; à l'ordinateur, on crée par le menu (clic droit › Nouveau sous-dossier). L'appli ouvre le dossier créé.
- Dupliquer un chapitre ou un dossier ajoute « (copie) » à TOUS les noms copiés (exercices et dossiers). Un déplacement par glisser vers un dossier de la colonne ouvre un petit menu « Déplacer ici / Copier ici ».
- L'ordre des chapitres glissés est enregistré dans `pinnedOrder`, pas dans l'ordre de `categories`.
- Glisser un dossier sur un dossier de la colonne : sans effet (non pris en charge, non testé).
- Le badge favori (`.exercise-favorite-badge`) est une boîte de 0 × 0 : seule son étoile est visible (Playwright le juge « hidden »).
- Technique : l'appui long du téléphone est simulé par un `pointerdown` tactile maintenu (Playwright n'a pas ce geste) ; sur iPhone le premier appui juste après une action échoue parfois, l'aide réessaie (annotation `appui-long` dans le test).
- Sélecteurs CSS utilisés faute de mieux (aucun `data-testid`) : `#sidebar-tree`, `#chapter-bar`, `#breadcrumb`, `#undo-btn` / `#redo-btn` / `#more-btn`, `.folder-row`, `.exercise-row`, `.exercise-title`, `.ctx-backdrop`, `.folder-picker-panel`, `.exercise-picker-panel`, `.result-path`. Rôles et libellés partout ailleurs.

## Tests ajoutés (`tests/e2e/bibliotheque/`, 93 tests, 28 `@critique`)
- `espaces.spec.ts` 6 : créer, changer, renommer, supprimer (+ annuler), nom vide, corbeille.
- `chapitres.spec.ts` 8 : créer, nom vide, renommer, réordonner (glisser), dupliquer, fusionner, supprimer (+ rétablir), nouveau sous-dossier.
- `dossiers.spec.ts` 11 : créer / sous-dossier / fil d'Ariane, champ au téléphone, menu à l'ordinateur, renommer (crayon et menu), déplacer (dans un dossier, vers un autre chapitre), fusionner, dupliquer, supprimer, note.
- `exercices.spec.ts` 14 : rafale, focus (BI-01), dossier ouvert, renommer ×2, dupliquer, copies liées ×2, supprimer ×2, favori, « En cours », archiver, déplacer.
- `menu-contextuel.spec.ts` 7 : clic droit, appui long (`@mobile`), « Plus d'actions », retirer favori / en cours, menus dossier et chapitre, un seul menu.
- `selection.spec.ts` 9 : Ctrl/⌘ + clic, ⌘, Maj + clic, menu « Sélectionner », actions de la barre ×3, copier vers, menu sur sélection, BI-03.
- `glisser.spec.ts` 7 : réordonner exercices, annuler, glisser raté, réordonner dossiers, exercice sur dossier / chapitre de la colonne, titre éditable.
- `volet.spec.ts` 4 : masquer / afficher (+ Ctrl/⌘ + B), largeur (souris, flèches, bornes, double clic), largeur conservée, téléphone (`@mobile`).
- `recherche.spec.ts` 12 : loupe ×5 (+ BI-02), recherche rapide ×6 (Ctrl/⌘ + F, bouton, clic, dossier, accents, focus BI-04).
- `tri-filtres.spec.ts` 9 : A → Z / Z → A, création, modifiés récemment, ★ Favoris, ● En cours, Notes, PJ, filtre vide, barre absente si vide.
- `annuler-retablir.spec.ts` 6 : enchaînement, nouvelle action, clavier, chapitre, menu « ⋯ » (`@mobile`), boutons du haut (`@ordinateur`).
- `aide-bibliotheque.ts` : état de départ, lecture de l'état, menus, appui long, glisser, annuler / rétablir.

## Non couvert
Voir `tests/PLAN.md` § 3, ligne 2 : archivage de chapitre (n'existe pas), glisser un dossier dans la colonne (sans effet), actions des modules `morceaux` / `session` / `fiche` du menu, filtres PJ et vidéo avec de vraies pièces jointes, détails tenus par les bancs (corbeille, favoris, notes de dossier).

## Rejouer
`npx firebase emulators:exec --project demo-trainhub --only auth,firestore "npx playwright test tests/e2e/bibliotheque --grep '@smoke|@critique' --project=chromium"` (28 tests, aucun `@smoke` dans ce module).
