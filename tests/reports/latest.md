# Rapport — module `demarrage` — 23/11/2026

## Résumé
- Testé : ouverture de l'appli, fenêtre d'accueil du compte, garde-fou production, deux modes (sans compte / compte fictif), **hors ligne (SDK Firebase refusé)**, « Ne plus me le proposer ».
- Résultat : **59 réussis / 0 échoué / 25 sautés voulus** sur les 7 projets (chromium 11, firefox / webkit / edge / mobile-android / mobile-iphone / tablette 8 chacun). Aucun test instable (2 passages complets identiques).
- Suite conseillée : module `bibliotheque` ; décider du bug D-01 (texte coupé, mineur).

## Environnement
- Émulateurs (`demo-trainhub`, Auth 9199, Firestore 8180) et serveur de test (8937) : aucun n'était lancé ; je les ai lancés puis arrêtés.
- Aucune requête vers la production Firebase pendant l'exploration (`playwright-cli requests` : seules des polices Google, bloquées par la config).
- `playwright-cli open` échouait ici (« chrome-for-testing » attendu en révision 1255, seule la 1243 est installée). Contournement : `--config /tmp/cli-th.json` (copie de `.playwright/cli.config.json` + `executablePath` vers `/opt/pw-browsers/chromium-1243`). Aucun fichier du dépôt touché. Ce n'est pas un défaut de l'appli.

## Observé hors ligne (boîte noire)
- Le SDK est demandé puis refusé (503) : message console « Firebase indisponible : mode local uniquement ».
- Pas de fenêtre d'accueil, pas de pastille de compte, `window.firebase` absent.
- La pilule « Se connecter » reste visible, grisée (opacité 0,55, classe `cc-indisponible`). Son `title` : « La connexion Google n'a pas pu se charger (hors connexion ?). Tes données restent enregistrées sur cet appareil. »
- Ordinateur : libellé « Se connecter (indisponible) ». Au clic : message (toast) avec la même phrase ; rien ne s'ouvre.
- Téléphone (≤ 700 px) : libellé masqué, il ne reste que l'icône Google grisée (36 px). Le toucher affiche le même message.
- Exercice ajouté : enregistré dans `trainhub.v1`, toujours là après rechargement.

## Problème
**D-01 (mineur) — « (indisponible) » est coupé à l'ordinateur**
- Étapes : 1. refuser `/__e2e__/firebase/**` ; 2. ouvrir l'appli à 1440 px (idem 1194, 800, 701) ; 3. lire la pilule.
- Attendu : « Se connecter (indisponible) » lisible.
- Observé : « Se connecter (indispo… » (libellé 151 px de large, contenu 170 px, `text-overflow: ellipsis`). L'info-bulle et le message au clic donnent bien la raison complète.
- Appareil : tous les écrans > 700 px (testé en Chromium).
- Trace : mesure directe, pas de test en échec ; le test `hors-ligne` vérifie le contenu « (indisponible) » de la feuille de style, pas l'absence de coupure.
- Avis : bug de l'appli (cosmétique, à arbitrer). Non couvert par un test en échec.

## Tests ajoutés
- `tests/e2e/demarrage/hors-ligne.spec.ts` : 4 tests, `@critique @demarrage` (dont un `@ordinateur`, un `@mobile`) :
  1. utilisable en local, exercice conservé après rechargement, ni accueil ni compte ;
  2. état existant affiché hors ligne ;
  3. ordinateur : pilule grisée, « (indisponible) », `title`, toast au clic, pas de fenêtre ;
  4. téléphone : icône seule, taille tactile, `title`, toast au toucher.
- `tests/e2e/demarrage/accueil.spec.ts` : 2 tests, `@critique @demarrage` :
  1. « Continuer sans compte » : pas de retour au rechargement, retour dans un nouvel onglet ;
  2. « Ne plus me le proposer sur cet appareil » : clé enregistrée, plus de fenêtre dans un nouvel onglet, pilule non grisée.
- Fichiers existants inchangés (parcours-principal 1, garde-fou 3, deux-modes 3).

## Sélecteurs CSS utilisés (pas de mieux)
- `#folder-container .exercise .exercise-title`, `#cloud-guard-modal`, `#account-info`, `.toast` : ni rôle ni étiquette. Le message (toast) n'a pas de `role="status"` : un `data-testid="toast"` ou ce rôle aiderait.

## Résultats par projet
chromium 11 + 1 sauté (fenêtre Google : CI seulement) ; les 6 autres 8 réussis + 4 sautés (garde-fou chromium seul, fenêtre Google, test @mobile ou @ordinateur selon l'appareil). Les 2 ✘ du garde-fou (chromium) sont des échecs attendus, comptés réussis.
