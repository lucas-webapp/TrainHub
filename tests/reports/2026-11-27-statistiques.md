# Rapport — module `statistiques` — 27/11/2026 (exploration et écriture le 26/11)

## Résumé
- Testé : toute la fenêtre « Statistiques » (ouverture, onglets Aperçu / Temps / Répartition / Exercices, 11 périodes et jour précis, comparaisons, début des statistiques, graphique, carte de régularité, réel contre prévu, camemberts, alertes, courbe de tempo et retrait d'un point, « séances à attribuer à un chapitre », noms à jour, menu d'un exercice, séances réellement enregistrées, téléphone).
- Résultat : **193 tests, 1 295 exécutions sur les 7 projets : 1 263 réussies + 32 échecs voulus (bugs ST-01 à ST-06) + 0 ignorée, 0 échoué** — deux passages complets identiques, consécutifs (≈ 16 min chacun, 1 295 réussies sur 1 295 attendues). Aucun `test.fixme`.
- Suite conseillée : arbitrer ST-03 (gênant) puis les cinq mineurs ; passer au module `outils`.

## Environnement
- Émulateurs `demo-trainhub` (Auth 9199, Firestore 8180) et serveur de test (8937) lancés par moi ; à arrêter à la fin. Session `playwright-cli` `trainhub` fermée.
- Production : la fixture commune fait échouer tout test qui enverrait une requête vers un domaine Firebase de production ; aucun test n'a échoué pour cela. `playwright-cli requests` (appli ouverte avec un journal amorcé) : seule la police Google (`fonts.googleapis.com`, coupée) ; aucune requête vers un domaine Firebase.
- Par projet : chromium, firefox, edge 183 exécutions (179 réussies + 4 échecs voulus) ; webkit, tablette 183 (178 + 5) ; mobile-android 190 (185 + 5) ; mobile-iphone 190 (185 + 5).
- Tests : 64 `@critique`, 3 `@ordinateur` (ordre des onglets ×2, clic à côté de la fenêtre), 10 `@mobile` (tout `telephone.spec.ts`) ; le reste tourne partout.
- Le temps est figé avec `page.clock.setFixedTime` au jeudi 26/11/2026 10:00 (Paris) ; les séances sont posées dans `trainhub.log.AAAA-MM` par `journalStats` (aide). Quatre tests de `depuis-seances` passent par les vrais écrans « Libre » et « Session guidée » avec l'horloge pilotée comme les modules `libre` et `session`.

## Ce que l'exploration a appris (comportements à connaître)
- Les statistiques sont UNE fenêtre ouverte par l'icône de l'écran « Session guidée » (ou depuis l'Historique / le Calendrier). **Il n'y a ni série de jours d'affilée, ni objectif de temps, ni export** : rien de tel n'est testé.
- Tout vient du journal : titres, chapitres et dossiers y sont figés à la date de la séance ; les statistiques affichent les noms actuels. Une séance supprimée du journal ou d'un autre espace n'est pas comptée.
- Les jours d'avant la première séance (ou d'avant la date « Statistiques comptées à partir du ») ne comptent pas : « Jours pratiqués » vaut « n / jours depuis le début du journal » (ex. « 3 / 10 » pour 28 jours demandés).
- Le graphique montre TOUT l'historique compté (défilant) ; la période choisie est soulignée, le reste estompé ; la moyenne en pointillé se calcule sur la période comptée, pas sur la période demandée.
- « 3 derniers jours » est une période courte (détail par chapitre, pas de carte de régularité) mais garde le graphique.
- « Aujourd'hui » se compare à hier À LA MÊME HEURE ; une séance d'hier soir n'entre pas dans la comparaison.
- Un exercice à objectif tempo n'a jamais d'alerte de durée ; un BPM noté sur un exercice sans objectif est ignoré. Seuils : bloqué = 5 séances à ±1 BPM du dernier, en recul = moins de 90 % du record (3 séances), court / long = moins de 70 % / plus de 130 % du prévu (3 séances), dominant = plus de 40 % du temps (4 exercices au moins), « plus travaillé » = 21 jours.
- La vue (« Tempo progressif » / « Durées »), l'onglet actif, les cartes ouvertes et le tri sont gardés tant que la page n'est pas rechargée ; la période revient à 28 jours à chaque ouverture.

## Bugs (détail dans `tests/reports/bugs.md`)
**ST-03 (gênant) — le graphique s'ouvre sur les plus anciennes dates** — Étapes : 1. un journal de plus de ≈ 35 jours ; 2. Session guidée › Statistiques. Attendu : les dates récentes en vue, flèche › éteinte. Observé : le tracé est calé à gauche (scrollLeft 0), les deux flèches ‹ › sont éteintes ; il ne se cale à droite qu'après un changement de période ou d'onglet. Appareil : tous (Chromium et Firefox mesurés). Test : `graphique.spec.ts` (`test.fail`). Avis : bug de l'appli (la position et l'état des flèches sont calculés avant la mise en page de la fenêtre).

**ST-01 (mineur) — « Comparé à aux 3 jours d'avant »** — Période « 3 derniers jours » : le « à » est en double. Test : `apercu.spec.ts` (`test.fail`). Avis : bug de texte.

**ST-02 (mineur) — « Mois dernier » = 32 jours en octobre** — « Jours pratiqués » affiche « 1 / 32 » : le passage à l'heure d'hiver ajoute une heure, l'arrondi au jour supérieur ajoute un jour. Test : `apercu.spec.ts` (`test.fail`). Avis : bug de calcul (fuseau à heure d'été).

**ST-04 (mineur) — « il y a N j » en blocs de 24 h** — « Mes favoris » et « Exercices sous-utilisés » : une séance d'hier 18 h est dite « aujourd'hui » à 10 h le lendemain ; 40 jours deviennent « 39 j ». La fiche, elle, dit « hier ». Test : `repartition.spec.ts` (`test.fail`). Avis : bug de l'appli.

**ST-05 (mineur) — cible d'appui long trop petite au téléphone** — zone d'un point de la courbe de tempo ≈ 17,6 px (< 24 px). Test : `telephone.spec.ts` (`test.fail`). Avis : à arbitrer (la zone a déjà été élargie volontairement).

**ST-06 (mineur, à confirmer sur Safari) — flèche › allumée à 1 px du bout** — WebKit de bureau et iPad seulement (pas iPhone) : après ‹ puis ›, le défilement s'arrête à 2327 pour un maximum de 2328. Test : `graphique.spec.ts` (`test.fail` sur `webkit` et `tablette`). Avis : arrondi propre au moteur, sans conséquence visible ; à confirmer sur Safari.

**Intermittence vue puis traitée (pas un bug de l'appli)** : lors du 1ᵉʳ passage complet, un test de `graphique.spec.ts` (clic sur « ✕ » du détail d'une barre) a échoué 1 fois sur ≈ 1 300 sur Firefox. Examen en rafale : 40 essais sur 40 réussis (3 en parallèle) ; cause probable = le détail s'affiche avec un défilement animé (`scrollIntoView` en douceur) et le clic partait pendant l'animation sous la charge. Correction du TEST : on attend la fin du défilement (`defilementFini`, 8 images de suite à la même position, sans pause fixe) avant de cliquer. Aucune vérification retirée. Deux passages complets suivants : 0 échec. Autre ajustement de test sous WebKit : le défilement animé des flèches ‹ › est attendu jusqu'à son terme avant un second appui (sinon le 2ᵉ appui part du milieu) ; le contrôle « flèche › éteinte au bout » est conservé, strict, dans un test à part (ST-06).

## À vérifier sur un vrai Safari / iPhone
- ST-06 (flèche › à 1 px) ; ST-03 sur Safari (même mécanisme probable).
- Appui long sur un point de la courbe ou sur une carte d'exercice : simulé par événements « pointeur » tactiles, pas un vrai doigt.
- Aucun test ignoré : WebKit sous Linux ne limite rien de ce module.

## Non couvert
- Cases du calendrier de l'Historique et « Non enregistrées » (module `session`).
- Envoi des réglages de statistiques (`statsRules`) vers Firestore (module `synchro`).
- Fuseaux sans heure d'été (tous les tests : Europe/Paris) ; plusieurs milliers de séances (`robustesse`).

## Tests ajoutés (tests/e2e/statistiques/)
- `ouvrir.spec.ts` 10 · `apercu.spec.ts` 33 · `graphique.spec.ts` 19 · `jours-courts.spec.ts` 7 · `temps.spec.ts` 10 · `repartition.spec.ts` 19 · `exercices.spec.ts` 31 · `courbe-tempo.spec.ts` 17 · `a-ranger.spec.ts` 20 · `noms-et-menu.spec.ts` 9 · `depuis-seances.spec.ts` 6 · `onglets.spec.ts` 2 (`@ordinateur`) · `telephone.spec.ts` 10 (`@mobile`) (total 193). Aide : `aide-statistiques.ts` (`journalStats`, `etatStats`, `ouvrirStats`, `paris`, `ilYa`, locators).
- Rejouer les `@critique` : `firebase emulators:exec --project demo-trainhub --only auth,firestore "playwright test tests/e2e/statistiques --grep @critique"` (ou, émulateurs et serveur déjà lancés : `npx playwright test tests/e2e/statistiques --grep @critique`).
