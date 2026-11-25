# Rapport — module `fiche` — 24/11/2026

## Résumé
- Testé : la fiche d'un exercice — ouvrir / replier, notes fixes et mobiles (zones vides masquées, dates, archives, enregistrement automatique), liens (YouTube, web, accès rapide), fichiers joints PDF / MP3, captures (nom, grand format, flèches, retrait), métronome prédéfini et objectif tempo, dé (gammes, harmonie), pastille « En cours », copies liées, « Dernière fois jouée », mise en page téléphone.
- Résultat : **68 tests, sur les 7 projets : 431 réussis, 0 échoué, 40 ignorés voulus.** Deux passages complets propres et identiques (431 / 0 / 40, 8,3 et 8,7 min). « Réussis » compte 3 échecs attendus par projet (`test.fail` : FI-01 ×2, FI-02).
- Suite conseillée : décider de FI-01 (copies liées dépliées : note fixe et dé non rafraîchis) ; rejouer les fichiers et captures sur un WebKit de macOS (ENV-FI-01) ; puis module `session`.

## Environnement
- Émulateurs `demo-trainhub` (Auth 9199, Firestore 8180) et serveur de test (8937) lancés par moi, **arrêtés**. Session `playwright-cli` `trainhub` fermée. La sortie audio factice est laissée allumée.
- Aucune requête vers la production : le garde-fou de la fixture n'a rien bloqué.
- Par projet (réussis / ignorés) : chromium 67 / 0 ; edge 67 / 0 ; firefox 66 / 1 ; mobile-android 68 / 0 ; webkit 54 / 13 ; tablette 54 / 13 ; mobile-iphone 55 / 13. Les écarts viennent des tags `@ordinateur` / `@mobile` (rupture à 700 px) et des ignorés ci-dessous.
- Un passage a été faussé par moi (j'ai lancé un second `playwright test` pendant qu'il tournait : `test-results/` effacé, émulateurs remis à zéro). Refait proprement : les deux passages comptés ci-dessus tournent seuls.

## Ignorés (40) — tous annoncés, aucun ne cache une vérification qui marcherait ailleurs
- **ENV-FI-01 (environnement, 36 = 12 × 3 projets)** : `webkit`, `tablette`, `mobile-iphone` sous **Linux**. Le WebKit de Playwright refuse de ranger un `Blob` dans IndexedDB (mesuré : blob → erreur, ArrayBuffer et texte → ok). L'appli répond alors, à juste titre, « Fichier non enregistré — Stockage plein, ou navigation privée ». Tous les tests qui ajoutent un fichier ou une capture (`fichiers.spec.ts` 5, `captures.spec.ts` 7) sont donc en `test.fixme` conditionnel (`sansBlobIndexedDB`, `aide-fiche.ts`) **uniquement** sur WebKit + Linux. À rejouer sur un WebKit de macOS (CI macOS à la demande, ou le vrai iPhone). Non vérifié.
- **FI-03 (4 = 1 × firefox, webkit, tablette, mobile-iphone)** : bug intermittent, voir ci-dessous.

## Bugs (détail dans `tests/reports/bugs.md`)
**FI-01 (gênant) — copies liées dépliées : note fixe et dé ne s'affichent pas sur l'autre fiche**
- Étapes : 1. deux exercices liés, fiches dépliées toutes les deux (cas des exercices créés en rafale) ; 2. sur l'un, « ＋ Note fixe » et taper un texte (ou allumer le dé) ; 3. regarder l'autre.
- Attendu : la note fixe (le dé) est partagée, elle apparaît aussitôt (le badge dit que les notes fixes et le dé sont communs). Observé : l'état de l'autre exercice est bon (relu dans `trainhub.v1`), mais sa fiche montre toujours « ＋ Note fixe » (pas de « Tirer ») jusqu'au rechargement. Si on écrit alors sur cette fiche, la note commune est écrasée sans qu'on l'ait vue. Tempo, objectif tempo et liens, eux, se rafraîchissent.
- Appareil : mesuré sur Chromium ; les 2 tests échouent (attendu) sur les 7 projets. Trace : `copies-liees.spec.ts` « note fixe commune… » et « dé commun… » (`test.fail`).
- Avis : bug de l'appli (écran pas rafraîchi). Atténué par le fait qu'ouvrir une fiche replie les autres : le cas se présente surtout avec des fiches toutes dépliées au départ.

**FI-02 (mineur) — l'objectif tempo ne met pas la légende « Dernière fois jouée » à jour**
- Étapes : 1. exercice joué avec un tempo (légende « … Dernier tempo atteint : 90 BPM ») ; 2. éteindre « Objectif tempo ».
- Attendu : « Dernier tempo atteint » disparaît (et revient quand on le rallume). Observé : la légende ne change qu'après rechargement.
- Appareil : Chromium observé ; test `derniere-fois.spec.ts` « basculer l'objectif tempo… » (`test.fail`) échoue sur les 7 projets. Avis : bug de l'appli (légende calculée au dessin de la fiche).

**FI-03 (mineur, intermittent) — bouton calendrier sur une note mobile encore vide**
- Étapes : 1. « ＋ Note mobile » ; 2. aussitôt « Ajouter la date d'aujourd'hui ».
- Attendu : « 24/11/26 : » écrit, prêt à être complété. Observé : la zone se range (perte du focus, elle est vide) et la date n'est pas écrite. Avec du texte déjà dans la note, ça marche.
- Appareil : Firefox 7 fois sur 8, WebKit 4 sur 8, iPhone 5 sur 8 (même après 1 s d'attente) ; Chromium 0 sur 8, Edge et Android 0 sur 10. Test en `test.fixme` sur Firefox et WebKit seulement ; sur Chromium, Edge et Android il passe. À confirmer sur un vrai Safari / Firefox.
- Avis : bug de l'appli (la sortie du champ range la zone avant que le clic sur le bouton ne soit pris en compte).

## Autres observations (pas des bugs)
- **Une seule fiche dépliée à la fois** : ouvrir une fiche (clic sur l'en-tête) replie toutes les autres, y compris sa copie liée ; replier n'en touche aucune autre. Testé tel quel (`ouvrir-replier.spec.ts`). À confirmer comme voulu.
- Une copie créée par « Dupliquer » arrive **repliée**.
- Un texte qui n'est pas une adresse (« n'importe quoi ») devient un lien `https://n'importe quoi` d'étiquette « n'importe%20quoi » (l'échappement se voit). Pas de refus ; non testé (à arbitrer).
- Renommer un fichier joint : le champ propose le nom entier, extension comprise ; taper « Grille » enregistre « Grille » (le type reste `application/pdf`).
- Au téléphone, l'onglet des liens s'appelle « Liens » (« Liens et fichiers » à l'ordinateur) et le bouton rapide de l'en-tête devient « Choisir un lien à ouvrir » ; avec audio ou images en plus, un seul bouton « Liens, audio et images de l'exercice : … ». Les tests acceptent les deux libellés.
- Une capture unique : pas de « 1 / 1 » ni de flèches dans le grand format.
- Ajouter plusieurs captures d'un coup : l'ordre a été vu inversé **une fois** sur quatre essais (non reproduit ensuite) ; le test compare donc sans ordre ; ajout une à une : toujours dans l'ordre.
- Sans visionneuse PDF (Chromium de test, Firefox) le PDF est téléchargé depuis l'adresse `blob:` ; Edge l'affiche : le test relit dans les deux cas les octets ouverts et les compare à ceux fabriqués.
- (Module `metronome`) Dans la fenêtre « Réglage pour… », les boutons « − 10 » / « + 10 » passent sous le cadran rond : Playwright refuse le clic au centre (« intercepts pointer events ») alors que le clic sur le libellé marche (mesuré). Les tests visent la partie libre du bouton.
- Sélecteurs CSS utilisés faute de mieux (aucun `data-testid`) : `.exercise-row` et `.exercise-row-spacer` (zone de clic qui replie), `.img-fig`, `.img-box`, `.img-thumb-btn`, `.img-title`, `input.img-title-input`, `.img-viewer`, `.img-viewer-caption`, `.img-viewer-title`, `.img-viewer-body img`, `.dice-ex-res`, `.ex-last-played`, `.ex-tools-left`. Rôles et libellés partout ailleurs.

## Tests ajoutés (`tests/e2e/fiche/`, 68 tests, 27 `@critique`, 1 `@mobile`)
- `ouvrir-replier.spec.ts` 6 : replier / rouvrir (+ rechargement), indépendance au repli, une seule fiche dépliée, titre modifiable, note fixe lisible repliée, résumé replié.
- `notes.spec.ts` 9 : note fixe et note mobile (enregistrement automatique, rechargement), zones vides masquées, rangement, date du jour (+ FI-03), 6 lignes et archives, archives seules, indépendance entre exercices.
- `liens.spec.ts` 7 : YouTube, lien web (+ / Entrée, https://), ouvrir, renommer / retirer, accès rapide (un lien, « Liens (n) »), YouTube rapide, fiche repliée.
- `fichiers.spec.ts` 5 : PDF (octets relus), MP3 (lecteur, durée, accès rapide), plusieurs, renommer, retirer avec confirmation.
- `captures.spec.ts` 7 : ajout, ordre, nom par-dessus, grand format et flèches, accès rapide, retrait, plusieurs d'un coup.
- `metronome-objectif.spec.ts` 7 : tempo (saisie, chevrons), fenêtre de réglage (Enregistrer / Annuler), ▶, pastille ♩ et « Retirer ce tempo », objectif tempo.
- `de.spec.ts` 5 : allumer, « Tirer », réglage d'une tonalité, retrait avec confirmation, dé d'harmonie.
- `en-cours.spec.ts` 3 : pastille, repliée, accord avec le menu.
- `copies-liees.spec.ts` 9 : dupliquer, liens communs, réglages communs, FI-01 ×2, après rechargement, propres à chacun, rompre, repliée.
- `derniere-fois.spec.ts` 8 : joué, plusieurs séances, jamais joué, sans journal, repliée, objectif désactivé, FI-02, après rechargement.
- `mise-en-page.spec.ts` 2 : liens + YouTube (menu), `@mobile` rien ne déborde.
- `aide-fiche.ts` : état de départ, journal, fabrique de PDF / MP3 / PNG, ajout de fichiers, ouverture d'un PDF.

## Non couvert
- Fichiers joints et captures sur **WebKit sous Linux** (ENV-FI-01) : à rejouer sur macOS / iPhone.
- Bouton « Coller » (presse-papiers), dépôt de fichiers par glisser-déposer, glisser pour réordonner les captures (banc `images`), « Modifier le son » et lecture audio (module `audio`), lecteur YouTube (module `video`), envoi dans Firestore connecté (module `synchro`), tirage sans remise du dé (module `outils`), suppression d'une ligne archivée (✕), phrases détaillées de « Dernière fois jouée » (rythme par mois : banc `derniere_ligne`).
