# Rapport — module `morceaux` — 26/11/2026

## Résumé
- Testé : les chapitres de morceaux en entier — ajout, fiche (artiste, titre, style, technique, travail), les cinq rangements et leurs dossiers calculés, tri, gestion des valeurs, menu d'un morceau, classement groupé, recherche, transformations (chapitre ↔ morceaux, exercice → morceau, morceau → exercice), Ménage, sessions, remise en forme des données, téléphone.
- Résultat : **142 tests, 940 exécutions sur les 7 projets : 919 réussies + 21 échecs voulus (bugs MZ-01 et MZ-02) + 0 ignorée, 0 échoué** — deux passages complets identiques (≈ 16 min chacun). Aucun `test.fixme`.
- Suite conseillée : arbitrer MZ-01 et MZ-02 (mineurs, libellés) ; passer au module `statistiques`.

## Environnement
- Émulateurs `demo-trainhub` (Auth 9199, Firestore 8180) et serveur de test (8937) lancés par moi ; à arrêter à la fin. Session `playwright-cli` `trainhub` fermée.
- Production : la fixture commune fait échouer tout test qui enverrait une requête vers un domaine Firebase de production ; aucun test n'a échoué pour cela. `playwright-cli requests` : aucune requête vers un domaine Firebase de production. (Le proxy a refusé du trafic propre aux navigateurs — mises à jour de Firefox, services d'Edge — sans rapport.)
- Par projet : chromium, firefox, webkit, edge, tablette 136 exécutions chacun (133 réussies + 3 échecs voulus) ; mobile-android et mobile-iphone 130 chacun (127 + 3).
- Tests : 32 `@critique`, 12 `@ordinateur`, 6 `@mobile` ; le reste tourne partout. Commande des `@critique` du module : voir plus bas.

## Ce que l'exploration a appris (comportements à connaître)
- Un morceau est un exercice dont le titre est toujours « Artiste - Titre » ; les « dossiers » sont calculés d'après le rangement choisi (Artistes : un dossier dès 2 morceaux ; Styles / Techniques / Travail : un dossier par valeur du chapitre, même vide, puis « Sans style » / « Sans technique » / « À classer »).
- Le tri A → Z se fait sur le TITRE complet sans « The / Le / La… » : « The Doors - … » se range à D.
- Dans la case « Artiste » seule, « + » crée un morceau SANS artiste dont le titre est ce texte (« Queen » → morceau « Queen »).
- Le menu d'un morceau n'a ni « Dupliquer », ni liaison ; « Classer : style, technique, travail… » ouvre sa fiche ; « En cours » = l'état de Travail que le chapitre désigne (il suit son renommage).
- Titre de menu groupé : « Styles — 3 morceaux » (pluriel du rangement, pas « Style »).
- Les champs `isSong`, `artist`, `songName` se recalculent à l'affichage et ne sont réenregistrés qu'à la modification suivante ; un rechargement donne le même résultat à l'écran. Les tests lisent donc l'écran, ou rechargent, avant de juger l'état.
- La sélection multiple survit au changement de chapitre ; « Annuler » du message n'annule que le DERNIER changement (déplier une fiche en est un).
- Un rechargement vide l'historique Annuler / Rétablir.
- Petits indicateurs (étoile de favori, point « En cours ») : posés sur le titre, sans place ; Playwright les voit « cachés » (testés avec `toBeAttached`).

## Bugs (détail dans `tests/reports/bugs.md`)
**MZ-01 (mineur) — « exercice » au lieu de « morceau »** — Étapes : 1. menu d'un morceau › « Renommer… » ; 2. ou : ouvrir sa fiche, taper dans l'en-tête le titre d'un autre morceau, Entrée. Attendu : « Renommer le morceau » et « Un morceau « … » existe déjà ici. » (comme l'ajout et les champs de la fiche). Observé : « Renommer l'exercice » et « Un exercice « … » existe déjà ici. ». Appareil : tous (Chromium observé). Tests : `menu.spec.ts` et `fiche.spec.ts` (`test.fail`). Avis : bug de l'appli (texte), sans conséquence sur les données.

**MZ-02 (mineur) — fautes d'accord** — Étapes : 1. rangement Techniques ou Travail ; 2. clic droit sur un dossier. Attendu : « Renommer la technique », « Supprimer cette technique… », « Supprimer cet état… », « Aucune technique pour l'instant ». Observé : « Renommer le technique », « Supprimer ce technique… », « Supprimer ce état… », « Aucun technique pour l'instant ». Appareil : tous. Test : `valeurs.spec.ts` (`test.fail`). Avis : bug de l'appli (le mot est composé à partir du nom de la valeur, sans accord).

**Intermittence vue puis traitée (pas un bug de l'appli)** : un test enchaînant deux appuis longs sur la même ligne a échoué 1 fois sur 4 sur iPhone (« aucun point libre »). Examen : juste après un nouveau dessin, le titre occupe toute la largeur de la ligne jusqu'à l'image suivante (l'appli règle sa largeur à `requestAnimationFrame`) ; l'appui long tombait dans le champ. Correction du TEST (attente de l'espace libre de la ligne, sans pause fixe, dans `aide-morceaux.ts`) ; vérifié sur 56 exécutions de rafale (iPhone), puis les deux passages complets. Aucune vérification n'a été retirée.

## À vérifier sur un vrai Safari / iPhone
- Rien de propre aux morceaux n'est limité par WebKit sous Linux : aucun test ignoré. La liste de complétion native de la case « Artiste » (`<datalist>`) n'est vérifiée que dans son contenu, pas dans son affichage.
- Appui long sur un morceau ou un dossier calculé : simulé par événements « pointeur » tactiles (comme les modules précédents), pas un vrai doigt.

## Tests ajoutés (tests/e2e/morceaux/)
- `ajouter.spec.ts` 15 · `fiche.spec.ts` 18 · `rangements.spec.ts` 16 · `tri.spec.ts` 5 · `valeurs.spec.ts` 16 · `menu.spec.ts` 15 · `selection.spec.ts` 6 · `recherche.spec.ts` 4 · `transformer.spec.ts` 13 · `menage.spec.ts` 8 · `vers-exercice.spec.ts` 7 · `persistance.spec.ts` 8 · `sessions.spec.ts` 5 · `telephone.spec.ts` 6 (`@mobile`) (total 142). Aide : `aide-morceaux.ts`.
- Rejouer les `@critique` : `firebase emulators:exec --project demo-trainhub --only auth,firestore "playwright test tests/e2e/morceaux --grep @critique"` (ou, émulateurs et serveur déjà lancés : `npx playwright test tests/e2e/morceaux --grep @critique`).
