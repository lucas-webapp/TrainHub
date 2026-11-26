# Rapport — module `mobile` — 26/11/2026

## Résumé
- Testé : l'appli au téléphone (≤ 700 px : Pixel 7 et iPhone 15) et sa bascule de mise en page : barres du haut et des chapitres, panneaux plein écran, menus d'appui long, gestes (toucher, appui long, balayage, glisser), clavier virtuel (simulé), rotation, barre de sélection, compte et déconnexion au doigt, zone sûre (encoche) ; plus, sur les projets d'ordinateur, les seuils de mise en page.
- Résultat : **74 tests, 154 exécutions sur les 7 projets : 134 réussies + 13 échecs voulus (bugs MO-01 à MO-07) + 7 ignorées voulues, 0 échoué** — deux passages complets identiques (≈ 2 min chacun).
- Suite conseillée : arbitrer MO-05, MO-06, MO-07 (gênants, métronome épinglé couché et lecteur audio qui recouvre / est recouvert) et MO-08 (intermittent : un balayage qui part d'une ligne peut intervertir deux exercices) ; vérifier sur un vrai iPhone la liste « à vérifier » ci-dessous ; puis module `morceaux`.

## Environnement
- Émulateurs `demo-trainhub` (Auth 9199, Firestore 8180) et serveur de test (8937) lancés par moi (ils étaient tombés en cours de route : relancés), à arrêter à la fin. Session `playwright-cli` `trainhub` fermée.
- Production : la fixture commune fait échouer tout test qui enverrait une requête vers un domaine Firebase de production ; aucun test n'a échoué pour cela. `playwright-cli requests` : aucune requête vers un domaine Firebase de production.
- Par projet : chromium, firefox, webkit, edge, tablette 2 exécutions chacun (les 2 tests `@ordinateur` des seuils) ; mobile-android 72 (65 réussies + 6 échecs voulus + 1 ignorée) ; mobile-iphone 72 (59 réussies + 7 échecs voulus + 6 ignorées).

## Ce que l'exploration a appris (comportements à connaître)
- Au téléphone, la barre du haut (`.top-bar`, 2 rangées, icônes de 36 × 38 px) ET la barre des chapitres (`#chapter-bar`, passe à la ligne) sont collantes : avec les 5 chapitres de l'utilisateur elles prennent 221 px sur les 659 de l'iPhone (33 %).
- Seuils réels de mise en page, mesurés sur 100 largeurs : **≤ 760 px barre du haut « téléphone » (neuf icônes + « ⋯ »)**, 761 → 879 px barre du haut « ordinateur » + barre des chapitres, **≥ 880 px colonne latérale**. `PLAN.md` / `CLAUDE-TRAINHUB.md` disent 700 px (vrai pour la fonction `auTelephone` et les tags des projets de test, pas pour l'écran). Un téléphone couché (iPhone 734 × 343, Pixel 863 × 360) tombe dans la zone intermédiaire : pas de colonne latérale, mais barre des chapitres + barres collantes qui prennent 49 à 54 % de la hauteur.
- Panneaux (Paramètres, Corbeille, Gammes, Harmonie, Aides, Enregistreur) : plein écran avec « Fermer » ; ils se redimensionnent à la rotation avec ≈ 0,5 s de retard (attendu par `expect.poll`, sans pause). Les onglets de Paramètres (7) défilent de côté dans leur bandeau, la page non.
- Les menus d'appui long sont bornés à la hauteur de l'écran et défilent. La poignée ⠿ et les pastilles de chapitre ont `touch-action: none`.
- Le Lecteur audio est un panneau flottant en bas (pas un bandeau docké comme à l'ordinateur).
- La page déclare `maximum-scale=1, user-scalable=no`, sans `viewport-fit=cover` : le navigateur garde la page hors de l'encoche ; `env(safe-area-inset-bottom)` est quand même pris en compte pour le volet du métronome, la barre de sélection et le lecteur (vérifié avec une zone sûre émulée de 34 px sous Chromium).
- À confirmer sur iPhone : le texte des listes déroulantes (tri, filtres) est coupé en haut sur le WebKit de Playwright (hauteur 32 px, texte 11,5 px) — probablement un rendu de WebKit sous Linux, non consigné comme bug.

## Bugs (détail dans `tests/reports/bugs.md`)
**MO-01 (mineur) — la barre des chapitres glisse sous la barre du haut** — Étapes : 1. ouvrir un chapitre long ; 2. défiler de 900 px. Attendu : barre des chapitres entière sous la barre du haut, ou masquée. Observé : une bande de ≈ 23 px de pastilles coupées. Appareils : les deux téléphones. Test : `barre-haut.spec.ts` (`test.fail`). Avis : bug de l'appli (`top: 0` sur deux barres collantes).

**MO-02 (mineur) — nom de chapitre long hors de sa pastille** — Étapes : 1. un chapitre au nom de 85 caractères. Observé : le texte passe sur deux lignes et sort du cadre de 30 px. Test : `barre-haut.spec.ts` (`test.fail`). Avis : bug de l'appli (CSS).

**MO-03 (mineur, WebKit) — espace au nom très long : page plus large que l'écran** — Étapes : 1. nom d'espace de 47 caractères. Observé (iPhone) : `scrollWidth` 551 pour 393 ; la page glisse de côté. Pixel : normal. Test : `barre-haut.spec.ts` (`test.fail` sur WebKit seulement). Avis : bug probable de l'appli (largeur de la liste déroulante) ; à confirmer sur un vrai iPhone.

**MO-04 (mineur) — cibles tactiles de moins de 24 px** — Observé : étoiles de la note (15 px liste, 19 px éditeur), « Commentaire sur la session » (18), « Retirer de la session » (18), « ＋ Note » (23 de haut), − / + des champs numériques (20 de large). Test : `panneaux.spec.ts` (`test.fail`). Avis : choix de conception à arbitrer (WCAG 2.2 AA demande 24 px).

**MO-05 (gênant) — métronome épinglé, téléphone couché : Jouer écrasé à 18 px** — Étapes : 1. épingler le métronome ; 2. coucher le téléphone. Observé : volet de ≈ 200 px sur 343-360 (58 %), bouton Jouer de 18 px de haut. Test : `rotation.spec.ts` (`test.fail`). Avis : bug de l'appli (mise en page).

**MO-06 (gênant) — la barre de sélection recouvre le lecteur audio** — Étapes : 1. sélectionner un exercice ; 2. ouvrir le Lecteur audio. Observé : barre 701–825 et lecteur 734–831 (Pixel) : ils se recouvrent. Test : `selection.spec.ts` (`test.fail`). Avis : bug de l'appli (la règle `audio-docked` ne s'applique pas au panneau flottant).

**MO-07 (gênant) — le lecteur audio recouvre le bas des menus d'appui long** — Étapes : 1. ouvrir le Lecteur audio ; 2. appui long sur un exercice, « Plus d'actions ». Observé : « Dupliquer », « Archiver », « Supprimer… » recouverts, intouchables. Test : `panneaux.spec.ts` (`test.fail`). Avis : bug de l'appli (ordre d'empilement).

**MO-08 (gênant, intermittent ≈ 3 %) — un balayage qui part d'une ligne intervertit deux exercices** — Étapes : 1. longue liste ; 2. balayer pour défiler en posant le doigt sur une ligne (vrais événements tactiles, Chromium). Observé : `pointerdown` puis `pointercancel (0, 0)` et deux exercices voisins échangés, 6 fois sur 180 (3/40, 1/60, 2/80) ; jamais en partant de la marge. Trace : essais `repeat-each` consignés dans cette session, pas de trace conservée (réussit presque toujours). Test : `tactile.spec.ts` (`test.fixme`, bug intermittent). Avis : bug probable de l'appli (annulation du geste traitée comme un lâcher).

**Intermittence vue puis traitée (pas un bug)** : le balayage de la liste a d'abord échoué 3 fois sur 40 sous charge ; l'examen en rafale (80 essais, journal des événements) a montré que c'était MO-08, pas le test. Le test qui reste (départ dans la marge, horloge de la page figée) a passé 40 essais d'affilée.

## Tests ajoutés — `tests/e2e/mobile/` (+ aide `aide-mobile.ts`)
- `barre-haut.spec.ts` — 11 (5 `@critique`) : neuf icônes dans l'écran sans chevauchement, toucher de chaque icône, menus « Outils » et « ⋯ », pastilles (toucher, retour à la ligne, 14 chapitres), noms longs, place des barres collantes, MO-01, MO-02, MO-03, fenêtre de l'appli (viewport, pas de zoom au double toucher).
- `panneaux.spec.ts` — 24 (7 `@critique`) : six panneaux plein écran (dans l'écran, « Fermer ») ×2 (écran normal puis bas), onglets et interrupteurs de Paramètres, écrans de session (liste, éditeur, choix, calendrier, historique, statistiques), recherche, lecteur audio, paysage et clavier ouvert, MO-04, MO-07.
- `rotation.spec.ts` — 7 (1 `@critique`) : état et texte conservés à l'aller-retour, chapitre, place des barres couché, panneau ouvert pendant la rotation, métronome flottant en lecture, MO-05, volet épinglé couché.
- `clavier.spec.ts` — 8 (1 `@critique`) : « Ajouter un exercice… » en bas de liste, champ de fiche, champ au milieu de l'écran, volet épinglé + clavier, tempo du métronome, « Renommer l'espace », recherche, éditeur de session.
- `tactile.spec.ts` — 10 (4 `@critique`) : appui long sur pastille / dossier, bords de l'écran, écran bas, annulation par le mouvement, `touch-action`, balayage (marge, MO-08), glisser un exercice et une pastille au doigt, commandes sans survol.
- `selection.spec.ts` — 5 (2 `@critique`) : sélection au doigt, barre dans l'écran, MO-06, couché, message « Annuler ».
- `compte.spec.ts` — 3 (2 `@critique`) : fenêtre d'accueil, écran bas, menu du compte et déconnexion au doigt.
- `encoche.spec.ts` — 4 : viewport et `viewport-fit`, zone sûre de 34 px (Jouer, barre de sélection, lecteur audio).
- `seuils.spec.ts` — 2 (1 `@critique`, `@ordinateur`) : mise en page à la largeur du projet, paliers de 1 200 à 480 px.
- Total : 74 tests, 23 `@critique`, 72 `@mobile`, 2 `@ordinateur`.

## Par projet (passage complet, identique deux fois)
- chromium, firefox, webkit, edge, tablette : 2 réussies chacun.
- mobile-android : 65 réussies + 6 échecs voulus (MO-01, 02, 04, 05, 06, 07) + 1 ignorée (MO-08 `test.fixme`).
- mobile-iphone : 59 réussies + 7 échecs voulus (MO-01 à MO-07) + 6 ignorées : MO-08, ENV-MO-02 ×2 (balayage de la marge ; annulation de l'appui long), ENV-MO-03 ×3 (zone sûre).
- Limites WebKit sous Linux (comme les modules précédents) : **ENV-MO-01** un `tap()` sur une pastille de chapitre ou une ligne d'exercice n'envoie pas de `click` (pointerdown annulé par le glisser-déposer : 4 événements au lieu de 5) ; sur un vrai iPhone ça marche, les tests utilisent `click()` sur WebKit pour ces deux éléments. **ENV-MO-02** aucun geste tactile réel (« mouse.wheel is not supported in mobile WebKit »). **ENV-MO-03** pas d'émulation de zone sûre (pas de CDP). Aucun n'est un défaut prouvé de l'appli.

## Sélecteurs et limites
- Sélecteurs CSS faute de mieux : `.top-bar`, `#chapter-bar .chapter-chip`, `.chapter-chip-label`, `.settings-panel`, `.trash-panel`, `.scales-panel`, `.harmony-panel`, `.aides-panel`, `.recorder-panel`, `.audio-panel`, `.metronome-panel`, `aside#metro-dock`, `.exercise-row`, `.exercise-drag-handle`, `.gs-session-name`, `.toast`, `#cloud-guard-modal`. Aucun `data-testid` indispensable.
- Clavier virtuel SIMULÉ en réduisant la hauteur de la fenêtre à 58 % (modèle Android) ; le navigateur recentre le champ, ce que l'aide `champAccessible` rejoue quand `focus()` ne le fait pas (WebKit laisse un champ à moitié coupé).
- Horloge de la page figée (`ouvrirAvecHorloge`) pour les tests d'appui long et de balayage.

## Non couvert / à vérifier sur un vrai iPhone
- Vrai clavier iOS (il recouvre la page sans la redimensionner), vraie encoche et barre d'accueil (application installée), vrai appui long et balayage tactile sous Safari (ENV-MO-02), `tap` sur une pastille de chapitre (ENV-MO-01), texte coupé des listes déroulantes.
- Fenêtre « Données en ligne trouvées » (conflit de synchro) et déroulé de session au téléphone : modules `synchro` et `session` ; pincement et zoom (désactivés par la page) ; accordeur et enregistreur avec micro (module `audio`).

## Rejouer
- Les `@critique` du module (émulateurs et serveur déjà lancés) : `npx playwright test tests/e2e/mobile --grep @critique`.
- Avec les émulateurs lancés par la commande : `npx firebase emulators:exec --project demo-trainhub --only auth,firestore "npx playwright test tests/e2e/mobile --grep @critique"`.
- Tout le module : `npm run test:e2e:module -- mobile`.
