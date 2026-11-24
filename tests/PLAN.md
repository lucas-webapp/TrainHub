# Plan des tests Playwright (`@playwright/test`) — TrainHub

État : **phases 1 à 4 faites (23/11/2026) ; phase 5 (couverture intégrale) EN COURS — prochain module : `fiche`.** Plan validé par l'utilisateur le 23/11 (§ 8).
Validation phase 4 : `@smoke` vert sur les 7 projets (VM et CI, https://github.com/lucas-webapp/TrainHub/actions/runs/45262782406) ; garde-fou éprouvé (requête de production
bloquée → test en échec ; projet sans `demo-` refusé) ; testeur : rapport `tests/reports/latest.md` ; vidéos du smoke : https://claude.ai/artifact/LCAUcZ53M5ocBrShSBqHxF.
**L'utilisateur a autorisé (23/11) l'enchaînement automatique de la phase 5, sans qu'il le redise** ; il fera des `/clear` : tout l'état doit rester ICI et dans
`CLAUDE-TRAINHUB.md` (« Suite à faire »). Après un module : Chromium vert, `@smoke` + `@critique` verts sur les 7 projets, PLAN à jour, push sur `main` ET
`structure-dossiers`, CI verte, point de 3 lignes à l'utilisateur.
Avancement : 2 modules sur 16 faits (`demarrage`, `bibliotheque`).
Ce fichier est la mémoire de ce chantier : le sous-agent `testeur-e2e` y lit l'état de chaque module ; après un `/clear`, c'est ici qu'on reprend
(« Reprends la phase 5 » → § 3, premier module qui n'est pas ☑).
Référence reprise : l'infrastructure d'HarmoHub (`lucas-webapp/HarmoHub`, branche `claude/harmohub-travail-Claude`, `tests/PLAN.md` § 9), lue le 23/11.

## 1. Reconnaissance (23/11/2026)

✔ = vérifié dans la VM. ≈ = supposé.

### Environnement (la même VM qu'HarmoHub)
- ✔ Node 22.22, Java 21.0.12 (assez pour `firebase-tools`), Playwright 1.63.0 **en global** avec Chromium seul (`/opt/pw-browsers`) ; c'est lui que
  les bancs utilisent (`NODE_PATH=/opt/node22/lib/node_modules`). Absents du dépôt : `package.json`, `@playwright/test`, `firebase-tools`, `.github/`,
  `.claude/settings.json`, `.claude/agents/`, `.gitignore` à la racine. Seul `.claude/commands/reprise.md` existe.
- ✔ Réseau :

| Domaine | Rôle | État |
|---|---|---|
| `registry.npmjs.org` | paquets npm | ouvert |
| `cdn.playwright.dev` (et miroirs) | Firefox, WebKit pour Playwright | ouvert (autorisé dans l'environnement) |
| `packages.microsoft.com` | Microsoft Edge | ouvert |
| `storage.googleapis.com` | archive de l'émulateur Firestore | ouvert |
| `www.gstatic.com` | SDK Firebase chargé par l'appli | **BLOQUÉ** |
| `www.youtube.com` | lecteur YouTube intégré (`iframe_api`) | **BLOQUÉ** |
| `fonts.googleapis.com` | police Plus Jakarta Sans | ≈ bloqué (police de repli) |
| `firestore.googleapis.com` | **PRODUCTION** Firebase | **joignable** : le garde-fou est indispensable |

### Application
- ✔ **Stack** : PWA statique, JavaScript « vanille » sans build ni framework : `index.html` (125 lignes), `script.js` (≈ 27 100 lignes, une seule IIFE,
  **aucune variable globale** exposée : l'état se relit dans `localStorage["trainhub.v1"]`), `style.css` (≈ 5 500 lignes), `compte-cloud.js` (partagé),
  `firebase-config.js`, `sw.js` (**service worker** : cache `trainhub-v283`, cache du piano), `manifest.json`, `jspdf`, `lamejs`, `audio/piano/*.mp3`.
- ✔ **Branche qui publie le site** : GitHub Pages publie **`structure-dossiers`** (276 déploiements « pages build and deployment », tous sur cette branche).
  `main` en est jusqu'ici une copie identique (consigne de `CLAUDE-TRAINHUB.md` : pousser sur les deux). Il n'existe pas de `claude/trainhub-travail-Claude`.
- ✔ **Firebase** :
  - SDK **compat 10.13.2**, chargé **par `script.js`** (fonction `loadFirebaseThenInit`, ligne ≈ 9117), **pas par `index.html`** : adresse
    `https://www.gstatic.com/firebasejs/10.13.2/` écrite en dur, chargement différé (`requestIdleCallback`, ≤ 1,5 s) après le premier affichage ;
  - `firebase-config.js` est chargé **après** le SDK, par le même code ; projet de production **`lucas-apps-479b9`** (partagé avec HarmoHub et TabHub), slug `trainhub` ;
  - moteur de synchro **propre à TrainHub** (dans `script.js`, « synchro cloud (Firebase) », ≈ 8 768-9 130) — il n'utilise pas `synchro-cloud.js` ;
  - `initializeApp(FIREBASE_CONFIG)` puis `firebase.auth()`, `firebase.firestore()`, `onAuthStateChanged` ; connexion **Google** par `signInWithPopup`.
- ✔ **Services réellement utilisés** : **Auth** (Google) et **Firestore** seulement. Documents, tous sous `users/{uid}/apps/…` (donc couverts par les règles) :
  `trainhub` (l'état entier, écrasé en bloc, le plus récent gagne, écoute `onSnapshot`), `trainhub-log-AAAA-MM` (journal des séances, un lot par mois,
  fusionné), `trainhub-img-<id>` (captures ≤ 700 Ko, en base64), `trainhub-file-<cid>-<n>` (fichiers joints découpés). Ni Storage, ni Functions, ni Analytics.
- ✔ **Deux modes** : sans connexion (tout dans `localStorage` + IndexedDB pour les captures et fichiers) ; avec connexion (synchro). Sans compte, la
  fenêtre d'accueil de `compte-cloud.js` (`#cloud-guard-modal`) est proposée une fois par onglet ; « Ne plus me le proposer » = `compteCloud.trainhub.nePlusProposer`.
- ✔ **Son** : métronome Web Audio (ordonnanceur dans un Worker), lecteur de fichiers audio, lecteur d'harmonie (échantillons de piano **locaux**),
  sons de secours `<audio>`. **Micro** (`getUserMedia`) : accordeur et enregistreur rapide. **YouTube** : lecteurs intégrés sous la session.
  Autres API : Wake Lock, IndexedDB, `ResizeObserver`, glisser-déposer, presse-papiers, export PDF (jsPDF), MP3 (lamejs).
- ✔ **Mises en page** : téléphone **≤ 700 px** (`.phone-only`, barre des chapitres, menu « ⋯ », bouton « Outils de musique ») ; métronome épinglé
  en bas sous 1 100 px, à droite au-dessus. L'iPad Pro 11 en paysage (1 194 px) a la mise en page ordinateur.
- ✔ **Sélecteurs** : 187 `aria-label` dans `script.js`, des `title` partout, des `id` stables dans `index.html` ; **aucun `data-testid`**.
- ✔ **Bancs existants** : 34 bancs `tests/playwright/trainhub_<nom>_test.js` (Node + Playwright, Chromium, harnais `tests/_harness.js`), lancés par
  `tests/playwright/lancer.sh` (≈ 15 min, serveur :8765 et faux YouTube :8766) + `tests/compte_cloud_test.js` (composant partagé, empreinte SHA-256).
  **Aucune CI** (pas de `.github/`). `lancer.sh` rend toujours le code 0 (il filtre la sortie).
- ✔ **Les bancs ne contactent pas la production** — **mesuré le 23/11** : les 34 bancs + `compte_cloud_test` ont été rejoués avec un espion (chargé par
  `NODE_OPTIONS`, sans modifier aucun banc) qui note chaque requête vers un domaine Google ou Firebase. Résultat : **0 requête partie vers Firestore,
  Auth (`identitytoolkit`, `securetoken`), `firebaseapp`, `firebaseio` ou `web.app`**. Seules sortent les polices Google (`fonts.googleapis.com`,
  `fonts.gstatic.com`, sans rapport avec Firebase). Le SDK (`www.gstatic.com/firebasejs/**`) est tenté par chaque banc puis interrompu ; seul `trainhub_compte`
  reçoit une réponse, celle de son FAUX SDK. (Une première mesure, qui n'accrochait pas la copie de Playwright du dépôt, ne voyait rien : refaite et corrigée.)
- ✔ **Piège : la sortie audio factice change le résultat d'un banc.** Avec PulseAudio (`pactl load-module module-null-sink`, nécessaire à Firefox pour les tests
  e2e), le banc `preset` échoue sur 3 vérifications (« aucun contexte audio neuf créé (1 → 2) », journal, « Précédent » : même contexte) ; **sans PulseAudio,
  il passe (22 / 22)**. L'appli n'a pas changé (aucun diff de `script.js`). Conséquences : les bancs se lancent **sans PulseAudio** (`pulseaudio --kill` avant
  `lancer.sh`), le workflow `bancs.yml` n'en démarre pas, et c'est consigné comme **à confirmer** dans `tests/reports/bugs.md` (B-01) : avec une sortie audio,
  appliquer un préréglage pendant la lecture crée un contexte audio de plus, ce que le banc dit ne pas devoir arriver. Le banc `son` a aussi échoué une fois sur
  une vérification (« lancement suivant : clics sur un contexte neuf ») au premier passage avec PulseAudio, puis réussi (75 / 75) au second : à surveiller.

### Ce qui diffère d'HarmoHub
| HarmoHub | TrainHub | Adaptation |
|---|---|---|
| SDK Firebase dans des `<script>` de `index.html` | SDK chargé par `script.js` (adresse en dur), après le premier affichage | le serveur de test réécrit **l'adresse dans `script.js`** à la volée (au lieu du HTML) ; même contrôle de version |
| `firebase-config.js` chargé avant le SDK | chargé **après** le SDK | la configuration de test enveloppe `initializeApp` aussitôt chargée : ça marche dans les deux ordres |
| `synchro-cloud.js` partagé | moteur propre, documents multiples (état, journal mensuel, captures, fichiers) | le module `synchro` vérifie les 4 familles de documents |
| pas de service worker | `sw.js` met **tout** en cache (y compris `firebase-config.js`) | service worker **bloqué** dans tous les tests, sauf un test PWA dédié (Chromium) |
| `window.app` pour relire l'état | rien d'exposé | on relit `localStorage["trainhub.v1"]` et l'écran (boîte noire) |
| rupture de mise en page à 900 px | à **700 px** | mêmes tags `@ordinateur` / `@mobile` ; mêmes projets (aucun n'est entre 700 et 900 px) |
| Tone.js en ligne | piano local, mais **YouTube** et **micro** | faux lecteur YouTube (`tests/playwright/yt_mock_api.js`, déjà écrit pour les bancs) servi partout ; faux micro (Chromium, Edge, Firefox) |
| branche de travail `claude/harmohub-travail-Claude` | publication par `structure-dossiers`, `main` recopiée | on pousse sur les deux ; CI sur `structure-dossiers` (D1) |
| la session s'ouvre dans le dépôt | jusqu'ici dans **HarmoHub**, TrainHub à côté ; désormais directement sur TrainHub | hook `SessionStart` + consigne de repli (D8) |
| ports 8936 / 8080 / 9099 | les deux dépôts sont dans la même VM | ports propres : appli **8937**, Firestore **8180**, Auth **9199** (D3) |

## 2. Constat → conséquence → choix

| Constat | Conséquence | Choix |
|---|---|---|
| Site statique sans `package.json` | rien où installer `@playwright/test`, `firebase-tools` | `package.json` **réservé aux tests** (dépendances de développement seulement), `node_modules/` ignoré. Ces fichiers ne sont ni chargés ni mis en cache par l'appli |
| SDK en dur dans `script.js`, `gstatic` bloqué | l'appli ne peut pas parler aux émulateurs dans la VM | `scripts/serveur-test.cjs` sert le dépôt tel quel avec 2 substitutions **en mémoire** : l'adresse `https://www.gstatic.com/firebasejs/10.13.2/` de `script.js` → `/__e2e__/firebase/` (fichiers de `node_modules/firebase@10.13.2`, mêmes octets) ; `firebase-config.js` → configuration `demo-trainhub` qui branche Auth et Firestore sur les émulateurs. Refus si la version du SDK diffère |
| Production joignable, base **partagée par 3 applis** | une erreur écrirait chez les trois | **triple barrière** reprise d'HarmoHub : projet `demo-trainhub` ; `globalSetup` qui refuse un projet sans `demo-` ou des émulateurs absents ; fixture `garde` qui interrompt toute requête vers les domaines Firebase de production **et fait échouer le test** |
| Connexion Google par fenêtre | fenêtre Google hors de portée ; son chargeur `apis.google.com` bloqué dans la VM | comptes **fictifs** de l'émulateur Auth : jeton Google non signé (`signInWithCredential`) pour les parcours ; le test de la vraie fenêtre (celle de l'émulateur) tourne **en CI seulement**, sauté dans la VM avec la raison |
| Service worker qui met tout en cache | il garderait la configuration de test et les anciennes versions d'un test à l'autre | `serviceWorkers: 'block'` partout ; un test `robustesse` l'autorise (Chromium) pour vérifier l'enregistrement et le cache hors ligne |
| Son Web Audio ; Firefox sans carte son | lecture jamais démarrée sous Firefox | sortie PulseAudio **factice** (VM et CI), comme HarmoHub ; on vérifie l'état visible (bouton Jouer/Arrêter, temps qui avance), pas le son |
| Micro (accordeur, enregistreur) | pas de micro dans la VM ni en CI | faux micro : Chromium/Edge `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, Firefox `media.navigator.streams.fake` ; **WebKit : tests micro sautés** (pas de faux micro fiable), en le disant |
| YouTube intégré, `www.youtube.com` bloqué | pas de lecteur dans la VM | faux lecteur (`yt_mock_api.js`) servi à la place de `iframe_api` **partout** (VM et CI testent la même chose) |
| Horloge, calendrier, statistiques, « dernière fois jouée » | rendu dépendant de la date | `page.clock` (date figée) ; journal de séances posé dans `trainhub.log.AAAA-MM` avant le chargement |
| Interface au geste (glisser, poignées, appui long, clic droit) | `getByRole` ne suffit pas toujours | `getByRole` / `getByLabel` / `getByTitle` d'abord ; CSS sinon, signalé dans le rapport. `data-testid` proposés au cas par cas (D4) |
| Verre dépoli, thèmes | captures au pixel fragiles | pas de comparaison de captures ; des mesures (positions, tailles, styles calculés) |

## 3. Inventaire fonctionnel → modules

Priorité : **P1** parcours principal, **P2** important, **P3** secondaire. Statut : ☐ à faire, ◐ en cours, ☑ fait.

| # | Module (`tests/e2e/<module>/`) | Parcours à tester | Prio. | Statut |
|---|---|---|---|---|
| 1 | `demarrage` | l'appli s'ouvre (fenêtre d'accueil, « continuer sans compte »), créer un exercice, lancer et arrêter le métronome, rechargement = tout est resté (`@smoke`) ; garde-fou production (Firestore et Storage) ; les deux modes (sans connexion, connexion Google fictive, vraie fenêtre de l'émulateur en CI) ; hors ligne (SDK refusé : pilule grisée, appli utilisable) | P1 | ☑ 23/11 : 5 fichiers, 13 tests (smoke, garde-fou ×3, deux modes ×3, hors ligne ×4, accueil ×2) ; 59 réussis / 25 sautés voulus sur les 7 projets ; bug D-01 (mineur) |
| 2 | `bibliotheque` | espaces (créer, renommer, supprimer, changer) ; chapitres ; dossiers (créer, renommer, déplacer, fusionner, dupliquer, note du dossier) ; exercices (ajouter en rafale, renommer, dupliquer, copies liées, supprimer → corbeille, favori, « En cours », archiver) ; menu clic droit et « Plus d'actions » ; sélection multiple ; glisser-déposer ; volet latéral (largeur, masquer) ; fil d'Ariane ; tri et filtres ; recherche et recherche rapide (Ctrl+F) ; annuler / rétablir | P1 | ☑ 23/11 : 11 fichiers `tests/e2e/bibliotheque/` (+ aide `aide-bibliotheque.ts`), 93 tests (28 `@critique`, 12 `@ordinateur`, 3 `@mobile`) ; 3 bugs ouverts en `test.fail` (BI-01 focus après Entrée, BI-02 loupe sensible aux accents, BI-03 barre de sélection qui recouvre le bas de la liste) + 1 `test.fixme` WebKit (BI-04 focus de la palette, intermittent). **Non couvert** : archivage d'un CHAPITRE (n'existe pas : « Archivés » = exercices archivés) ; glisser un dossier sur un dossier de la colonne (sans effet, non pris en charge) ; « Transformer en morceau / chapitre de morceaux » (module `morceaux`), « Ajouter à une session… », « Dé… » (modules `session`, `fiche`) ; filtres « Avec PJ / Avec vidéo » avec de vraies pièces jointes (module `fiche`) ; détail de la corbeille, des favoris et des notes de dossier (bancs, § 7) |
| 3 | `fiche` | fiche d'un exercice : notes fixes / mobiles (lignes datées, archives, notes vides masquées), liens (YouTube, web), fichiers joints PDF / MP3, captures (ajout, nom, grand format, flèches), métronome prédéfini, objectif tempo, dé de l'exercice, « Dernière fois jouée », copies liées | P1 | ☐ |
| 4 | `session` | session guidée : créer, choisir les exercices (onglets, rafale, rond de rang, « Ma session »), durées, réordonner, note de session, lancer ; déroulé (chrono, Précédent / Suivant, Pause, −1 / +1 min, cloche, enchaînement auto, deux colonnes), fin et enregistrement ; historique ; calendrier et programmation ; session depuis une séance ; export PDF ; reprise après fermeture brutale | P1 | ☐ |
| 5 | `libre` | entraînement libre : chrono qui suit l'exercice affiché, changement d'exercice, fin et enregistrement de la séance (journal), message « séances non enregistrées », tempo noté | P1 | ☐ |
| 6 | `metronome` | fenêtre et volet épinglé, Jouer / Arrêter, tempo (pas, saisie, tap), mesure et accents, préréglages, appliquer pendant la lecture, journal du son et « Tester le son » | P1 | ☐ |
| 7 | `synchro` | connexion par l'émulateur, envoi de l'état, relecture sur un 2ᵉ appareil, conflit de première synchro (« garder les données en ligne »), journal mensuel fusionné, captures et fichiers dans Firestore, déconnexion, réseau coupé puis repris, règles de sécurité (un inconnu reçoit 403), vraie fenêtre de connexion (CI) | P1 | ☐ |
| 8 | `morceaux` | chapitre de morceaux : ajouter un morceau (sa fiche s'ouvre), artiste / styles / techniques / travail, dossiers calculés, transformer un chapitre, Ménage (variantes d'artistes, doublons en lecture seule), morceau → exercice | P2 | ☐ |
| 9 | `statistiques` | onglets Aperçu, Temps, Répartition, Exercices (vues « Tempo progressif » / « Durées », tris, « À surveiller »), graphique de tempo, retrait d'un tempo (clic droit, Annuler) | P2 | ☐ |
| 10 | `outils` | gammes et arpèges, clavier, harmonie (degrés, progressions, lecteur de boucles), aides (cercle des quintes), dé de gamme et dé d'harmonie (tirage sans remise, réglages, préréglages) | P2 | ☐ |
| 11 | `audio` | lecteur audio (liste, vitesse, boucle, barre épinglée), « Modifier le son » (couper, aimanter, clavier), enregistreur rapide (faux micro, rangement dans un exercice), accordeur (faux micro) | P2 | ☐ |
| 12 | `video` | lecteurs YouTube sous la session (faux lecteur), plein écran, clavier de la vidéo, ouverture de plusieurs liens | P2 | ☐ |
| 13 | `donnees` | export / import JSON, sauvegardes de secours (panneau, restaurer), corbeille (restaurer, vider, vider les plus anciens, rappel au-delà de 20), export / réimport des captures | P2 | ☐ |
| 14 | `parametres` | thème (sombre / clair / auto), verre dépoli, halo, préférences, raccourcis et astuces, persistance après rechargement | P3 | ☐ |
| 15 | `mobile` | barre des chapitres, menu « ⋯ » (annuler, rétablir, corbeille), « Outils de musique », volet, appui long = menu, session et métronome au téléphone, messages lisibles | P1 (projets mobiles) | ☐ |
| 16 | `robustesse` | états vides, très gros contenu, stockage plein ou refusé, deux onglets, service worker (enregistré, hors ligne après une visite — Chromium), garde-fou de fermeture pendant une synchro | P3 | ☐ |

Tags : `@smoke`, `@critique` (parcours P1), `@<module>`, plus `@ordinateur` / `@mobile` (filtre par appareil), `@micro` (faux micro : pas sur WebKit).
Ordre de la phase 5 : `bibliotheque`, `fiche`, `session`, `libre`, `metronome`, `synchro`, `mobile`, puis P2 dans l'ordre du tableau, puis P3.

## 4. Matrice navigateurs / appareils

| Projet | Profil Playwright | Tests | Dans la VM | En CI |
|---|---|---|---|---|
| `chromium` | Desktop Chrome 1440 × 900 | `@ordinateur` | ✔ | ✔ |
| `firefox` | Desktop Firefox 1440 × 900 | `@ordinateur` | ≈ (téléchargement autorisé) | ✔ |
| `webkit` | Desktop Safari 1440 × 900 | `@ordinateur` | ≈ (idem) | ✔ (+ macOS à la demande) |
| `edge` | Desktop Edge (`msedge`) | `@ordinateur` | ≈ (`packages.microsoft.com` ouvert) | ✔ |
| `mobile-android` | Pixel 7 (Chromium, tactile) | `@mobile` | ✔ | ✔ |
| `mobile-iphone` | iPhone 15 (WebKit, tactile) | `@mobile` | ≈ | ✔ |
| `tablette` | iPad Pro 11 paysage (WebKit, tactile, 1 194 px) | `@ordinateur` | ≈ | ✔ |

Façon de travailler : on écrit sur `chromium`, puis on passe le module sur les 7 projets dans la VM avant de le déclarer fini ; la matrice complète tourne en CI.

## 5. Modifications de l'appli (pour la rendre testable)

1. **Aucune n'est indispensable** : le serveur de test fait les substitutions en mémoire (§ 2). `script.js`, `index.html`, `sw.js`, `firebase-config.js`,
   `compte-cloud.js` ne sont pas touchés.
2. *Facultatif, au cas par cas et avec ton accord* : des `data-testid` sur des éléments sans rôle ni étiquette (poignées de largeur, ronds de rang
   du choix, cases du calendrier…). Invisibles, sans effet sur le comportement. Je les propose au moment du module concerné.

## 6. Règles Firestore

Fournies par l'utilisateur (identiques pour les trois applis), copiées dans `firestore.rules` pour l'**émulateur seulement**, jamais déployées :
seul un utilisateur connecté lit et écrit `users/{son uid}/apps/{appId}`. Les 4 familles de documents de TrainHub sont sous ce chemin : les règles les couvrent.

## 7. Ce que couvrent DÉJÀ les bancs (ne pas écrire en double)

34 bancs + `compte_cloud_test` (Chromium, ordinateur et téléphone selon le banc), écrits au fil des versions ; ils tiennent surtout les **détails fins**
(mesures au pixel, cas limites). Les tests e2e visent les **parcours**, sur **tous les navigateurs**, et la **vraie synchro** contre l'émulateur.

| Module | Bancs | Ce qu'ils tiennent déjà |
|---|---|---|
| `bibliotheque` | `volet`, `favoris`, `corbeille`, `notedossier`, `messages` | volet, favoris, corbeille, notes de dossier, messages |
| `fiche` | `note`, `notes_vides`, `images`, `barre_outils`, `ligne_de`, `derniere_ligne`, `tempo`, `preset` | notes, captures, barre d'outils, dé, objectif tempo, préréglages |
| `session` | `session_ui`, `sessions_ecrans`, `choix`, `rafale`, `programmation`, `note_session`, `rideau`, `point` | écrans de session, choix et rafale, programmation, notes |
| `libre` / `metronome` | `son`, `eph`, `bouton_lecture`, `preset` | métronome, journal du son, bouton Jouer |
| `morceaux` | `morceaux`, `morceau_ajout`, `menage` | morceaux, ajout, ménage |
| `statistiques` | `stats_exercices`, `point` | statistiques par exercice |
| `outils` | `de` | dés |
| `audio` | `lecteur`, `audio_rate`, `audio_edit` | lecteur, vitesse, éditeur de son |
| `video` | `video` | lecteurs YouTube (faux lecteur) |
| `synchro` | `compte` (faux SDK), `compte_cloud_test` | pilule, menu, fenêtre de connexion — **pas** le vrai SDK ni les règles |

Les bancs restent **tels quels**, dans un workflow à part (à la demande + chaque dimanche).

## 8. Décisions (validées par l'utilisateur le 23/11, avec les précisions D1 et D8)

- **D1. Branche** (tranché le 23/11) : on pousse sur **les deux branches**, `main` puis `structure-dossiers`, comme le « Cycle de chaque demande » de
  `CLAUDE-TRAINHUB.md` (elles restent identiques). `structure-dossiers` publie le site ; la CI « Tests e2e » se déclenche sur elle (pas sur `main`, pour ne
  pas jouer deux fois le même commit). Pas de pull request.
- **D2. Firebase en test** : serveur de test qui réécrit en mémoire l'adresse du SDK dans `script.js` et remplace `firebase-config.js` (aucune modification de l'appli).
- **D3. Ports** : appli 8937, Firestore 8180, Auth 9199, projet `demo-trainhub` (pour ne pas gêner HarmoHub ni les bancs dans la même VM).
- **D4. `data-testid`** : aucun pour l'instant ; proposés au cas par cas, seulement si un élément n'a ni rôle ni étiquette.
- **D5. Micro** : faux micro sur Chromium, Edge, Firefox ; tests `@micro` sautés sur WebKit (iPhone, iPad, Safari), à vérifier par toi sur l'iPhone.
- **D6. YouTube** : le faux lecteur des bancs, partout.
- **D7. Service worker** : bloqué partout, sauf un test PWA sur Chromium.
- **D8. Autonomie** (tranché le 23/11) : `scripts/setup-tests.sh` + hook `SessionStart` dans `.claude/settings.json`. **Désormais l'utilisateur ouvre
  les sessions TrainHub directement sur ce dépôt** : le hook y prépare tout seul. Consigne de repli dans `CLAUDE-TRAINHUB.md` (session ouverte dans HarmoHub :
  lancer soi-même `bash scripts/setup-tests.sh`).
- **D9. Bancs en CI** : workflow `bancs.yml` (dimanche + à la demande) qui lance `lancer.sh` tel quel et rougit si la sortie contient `FAIL` ou
  « COUVERTURE INCOMPLÈTE » (`lancer.sh` lui-même ne change pas).
- **D10. Fichiers publiés** : `package.json`, `playwright.config.ts`, `scripts/`, `.github/`, `tests/` seront visibles sur GitHub Pages comme le sont déjà
  `tests/` et `README.md` ; ils ne sont ni chargés ni mis en cache par l'appli (le service worker a sa liste fixe) : même affichage, même comportement.
- **D11. Sous-agent** `testeur-e2e` repris d'HarmoHub (`model: sonnet`, `effort: high`), rapports dans `tests/reports/`, bugs dans `tests/reports/bugs.md` (bloquant / gênant / mineur).

Précisions confirmées le 23/11 :
- **Deux modes testés** : sans connexion (données dans le navigateur) et connexion Google **fictive** par l'émulateur Auth (`demarrage/deux-modes.spec.ts`,
  puis le module `synchro`). La vraie fenêtre « Se connecter avec Google » (celle de l'émulateur) a besoin de `apis.google.com`, bloqué dans la VM : **en CI seulement**.
- **Captures et fichiers joints = Firestore**, pas Firebase Storage : documents `users/{uid}/apps/trainhub-img-<id>` (image en base64, ≤ 700 Ko) et
  `users/{uid}/apps/trainhub-file-<cid>-<n>` (fichier découpé) ; `script.js` n'appelle jamais `firebase.storage()` et ne charge pas le SDK Storage.
  L'émulateur Storage est donc inutile. Le garde-fou bloque quand même `firebasestorage.googleapis.com` (test `garde-fou.spec.ts`).

## 9. Ce qui reste à la charge de l'utilisateur
1. Si les règles Firestore changent dans la console, les recopier dans `firestore.rules`.
2. Vérifier sur Safari / iPhone ce que WebKit sous Linux ne prouve pas (liste dans le compte rendu final).
