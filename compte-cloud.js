// COMPTE CLOUD — composant d'interface COMMUN à HarmoHub, TabHub et TrainHub.
// VERSION 1 — 28/10/2026. Fichier de référence : dépôt HarmoHub. À COPIER TEL QUEL dans les autres applis
// (voir docs/fichiers-partages.md) : on n'y met rien de propre à une appli, tout passe par les options.
//
// Retour utilisateur : « sur les 3 applis, les pastilles de connexion sont différentes. Je veux mettre les
// mêmes. » Chaque appli avait la sienne — TrainHub un bouton « G » puis nom + ● + bouton de sortie, HarmoHub
// une pilule avec un menu, TabHub un point sur le bouton Enregistrer et la connexion dans un menu. Ce
// fichier dessine LUI-MÊME tout ce qui se voit de la connexion :
//   - la PILULE de la barre du haut : « G Se connecter », ou la pastille d'état + le nom du compte ;
//   - le MENU du compte : qui est connecté, l'état de la synchro en toutes lettres, « Se déconnecter » ;
//   - la FENÊTRE DE CONNEXION, proposée à l'ouverture quand personne n'est connecté (retour utilisateur :
//     « propose la fenêtre connexion lorsqu'aucun utilisateur n'est connecté »), et à la première
//     modification si elle n'a pas encore été vue.
// Il ne sait RIEN de Firebase ni des données : l'appli lui dit qui est connecté et où en est la synchro, et
// il lui rend les clics (seConnecter, seDeconnecter). TrainHub peut donc le brancher sur son propre moteur
// de synchro, HarmoHub et TabHub sur synchro-cloud.js.
//
// SES STYLES SONT À LUI (balise <style> injectée, classes « cc-… ») et ne s'appuient que sur les variables
// que les trois applis partagent (--bg, --text-main, --text-muted, --border, --accent, --font), avec des
// valeurs de repli. Les fonds sont CALCULÉS à partir de --bg et --text-main plutôt que pris dans --card-bg :
// dans les thèmes « verre » de TrainHub, --card-bg est presque transparent, et une fenêtre transparente
// au-dessus de l'appli serait illisible. Les boutons repartent de zéro (`all: unset`) : chaque appli a ses
// règles générales sur `button` (HarmoHub : flex: 1 et min-width: 120px, qui faisaient faire 121 px à une
// simple pastille) et aucune ne doit déteindre ici.
//
// UTILISATION (une fois le DOM prêt) :
//   var compte = monterCompteCloud(document.getElementById('compte-cloud'), {
//       appli: 'HarmoHub',              // nom affiché dans la fenêtre
//       slug: 'harmohub',               // clé de mémoire (« ne plus proposer »), une par appli
//       objets: 'morceaux',             // ce que l'appli enregistre : « tes morceaux sont enregistrés… »
//       seConnecter: function () {},    // appelé DANS le clic (la fenêtre Google l'exige)
//       seDeconnecter: function () {},
//       surIndisponible: function (raison) {},   // facultatif : clic sur la pilule grisée
//   });
//   compte.authPrete(user)        // Firebase a répondu : user (ou null). Propose la fenêtre si personne.
//   compte.utilisateur(user)      // changement de compte ensuite
//   compte.etat(mode, libelle)    // 'synced' | 'syncing' | 'pending' | 'offline' | 'error' | 'toolarge' | null
//   compte.indisponible(raison)   // Firebase n'a pas pu démarrer : pilule grisée, raison au survol et au clic
//   compte.proposerConnexion('modification')   // garde-fou « tu n'es pas connecté » (une fois par onglet)
//   compte.message(texte)         // une phrase propre à l'appli sur la pilule « Se connecter » (au survol, et
//                                 // pastille orange tant qu'elle existe) — ex. TrainHub : « 3 séances
//                                 // enregistrées hors connexion : connecte-toi pour les envoyer ». '' l'efface.

var COMPTE_CLOUD_VERSION = 1;

var COMPTE_CLOUD_LIBELLES = {
    synced: 'Synchronisé avec le cloud',
    syncing: 'Envoi en cours…',
    pending: 'Modifications pas encore envoyées',
    error: 'Erreur de synchronisation — la dernière version reste enregistrée sur cet appareil',
    offline: 'Hors ligne — les modifications partiront au retour du réseau',
    toolarge: 'Données trop volumineuses pour le cloud — fais une sauvegarde sur disque',
};

var COMPTE_CLOUD_G = '<svg class="cc-g" viewBox="0 0 24 24" aria-hidden="true">'
    + '<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>'
    + '<path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.69-2.26 1.1-3.71 1.1-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>'
    + '<path fill="#FBBC05" d="M5.84 14.14A6.93 6.93 0 0 1 5.42 12c0-.74.13-1.46.35-2.14V7.02H2.18A10.98 10.98 0 0 0 1 12c0 1.77.42 3.45 1.18 4.98l3.66-2.84z"/>'
    + '<path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.02l3.66 2.84c.87-2.6 3.3-4.48 6.16-4.48z"/>'
    + '</svg>';

// Les couleurs d'état sont FIXES et non tirées du thème : une pastille verte doit vouloir dire la même chose
// dans les trois applis. Teintes choisies pour rester lisibles sur fond sombre COMME sur le thème clair de
// TrainHub (les verts/bleus très pâles de l'ancienne pastille disparaissaient sur blanc).
var COMPTE_CLOUD_CSS = [
    '.cc-hote { display: inline-flex; align-items: center; flex: 0 0 auto; min-width: 0; }',
    '.cc-hote .cc-pilule, .cc-menu button, .cc-voile button { all: unset; box-sizing: border-box; cursor: pointer; -webkit-tap-highlight-color: transparent; }',
    '.cc-hote .cc-pilule {',
    '  display: inline-flex; align-items: center; gap: 7px; height: 32px; max-width: 200px; padding: 0 12px;',
    '  border: 1px solid var(--border, #333); border-radius: 999px;',
    // OPAQUE : dans HarmoHub la barre du haut FLOTTE au-dessus de la page, et une pilule translucide
    // laisserait voir le contenu défiler derrière le nom du compte.
    '  background: color-mix(in srgb, var(--bg, #0a0a0a) 88%, var(--text-main, #e0e0e0));',
    '  color: var(--text-main, #e0e0e0); font-family: var(--font, inherit); font-size: 13px; font-weight: 600; line-height: 1;',
    '  white-space: nowrap; transition: background-color .15s ease, border-color .15s ease;',
    '}',
    '.cc-hote .cc-pilule[hidden] { display: none; }',
    '.cc-hote .cc-pilule:hover { background: color-mix(in srgb, var(--bg, #0a0a0a) 80%, var(--text-main, #e0e0e0)); }',
    '.cc-hote .cc-pilule:focus-visible, .cc-menu button:focus-visible, .cc-voile button:focus-visible { outline: 2px solid var(--accent, #00e676); outline-offset: 2px; }',
    '.cc-hote .cc-pilule.cc-indisponible { opacity: .55; }',
    // Un message en attente (voir api.message) : une petite pastille orange sur le G, comme une notification.
    '.cc-hote .cc-pilule.cc-message { position: relative; }',
    '.cc-hote .cc-pilule.cc-message::after { content: ""; position: absolute; top: 3px; left: 22px; width: 8px; height: 8px; border-radius: 50%;',
    '  background: #e09a2a; box-shadow: 0 0 0 2px color-mix(in srgb, var(--bg, #0a0a0a) 88%, var(--text-main, #e0e0e0)); }',
    '.cc-hote .cc-pilule.cc-indisponible .cc-libelle::after { content: " (indisponible)"; }',
    '.cc-g { width: 16px; height: 16px; flex: 0 0 auto; display: block; }',
    '.cc-libelle { overflow: hidden; text-overflow: ellipsis; min-width: 0; }',
    '.cc-initiale { display: none; }',
    '.cc-pastille { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; background: #8a8f98;',
    '  box-shadow: 0 0 0 2px color-mix(in srgb, var(--bg, #0a0a0a) 70%, transparent); }',
    '.cc-pastille[data-etat="synced"] { background: #3fb36b; }',
    '.cc-pastille[data-etat="syncing"] { background: #4a90e2; animation: cc-pouls 1s ease-in-out infinite; }',
    '.cc-pastille[data-etat="pending"] { background: #e09a2a; }',
    '.cc-pastille[data-etat="offline"] { background: #8a8f98; }',
    '.cc-pastille[data-etat="error"], .cc-pastille[data-etat="toolarge"] { background: #e5534b; }',
    '@keyframes cc-pouls { 50% { opacity: .35; } }',
    // Téléphone : la barre du haut n'a pas la place d'un nom. Le G seul pour se connecter, et la pastille
    // + l'INITIALE du compte une fois connecté — reconnaissable, et une cible assez grande pour le doigt.
    '@media (max-width: 600px) {',
    '  .cc-hote .cc-pilule { padding: 0 9px; min-width: 32px; justify-content: center; }',
    '  .cc-hote .cc-libelle { display: none; }',
    '  .cc-hote .cc-initiale { display: inline; font-weight: 700; }',
    '}',
    // MENU DU COMPTE
    '.cc-menu { position: fixed; z-index: 10001; min-width: 240px; max-width: min(320px, calc(100vw - 16px)); padding: 6px;',
    '  border: 1px solid var(--border, #333); border-radius: 12px; box-sizing: border-box;',
    '  background: color-mix(in srgb, var(--bg, #0a0a0a) 90%, var(--text-main, #e0e0e0));',
    '  color: var(--text-main, #e0e0e0); font-family: var(--font, inherit); font-size: 13px;',
    '  box-shadow: 0 10px 30px rgba(0, 0, 0, .35); }',
    '.cc-menu[hidden] { display: none; }',
    '.cc-menu-qui { padding: 8px 10px 6px; display: flex; flex-direction: column; gap: 2px; }',
    '.cc-menu-nom { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.cc-menu-mail, .cc-aide { color: var(--text-muted, #a0a0a0); font-size: 12px; overflow-wrap: anywhere; }',
    '.cc-menu-etat { display: flex; gap: 8px; align-items: flex-start; padding: 6px 10px 8px; line-height: 1.35; }',
    '.cc-menu-etat .cc-pastille { margin-top: 4px; }',
    '.cc-menu-sep { height: 1px; margin: 2px 4px; background: var(--border, #333); }',
    '.cc-menu button { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 8px 10px; border-radius: 8px; }',
    '.cc-menu button:hover { background: color-mix(in srgb, var(--text-main, #e0e0e0) 8%, transparent); }',
    '.cc-menu button > span:first-child { font-weight: 600; }',
    // FENÊTRE DE CONNEXION
    '.cc-voile { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 16px;',
    '  background: rgba(0, 0, 0, .55); box-sizing: border-box; }',
    '.cc-voile[hidden] { display: none; }',
    '.cc-fenetre { width: min(420px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; box-sizing: border-box; padding: 22px 22px 18px;',
    '  border: 1px solid var(--border, #333); border-radius: 16px;',
    '  background: color-mix(in srgb, var(--bg, #0a0a0a) 92%, var(--text-main, #e0e0e0));',
    '  color: var(--text-main, #e0e0e0); font-family: var(--font, inherit); font-size: 14px; line-height: 1.45;',
    '  box-shadow: 0 20px 60px rgba(0, 0, 0, .45); }',
    '.cc-fenetre h2 { margin: 0 0 10px; font-size: 18px; line-height: 1.25; font-weight: 800; color: var(--text-main, #e0e0e0); text-wrap: balance; }',
    '.cc-fenetre p { margin: 0 0 10px; }',
    '.cc-fenetre .cc-aide { font-size: 13px; }',
    '.cc-actions { display: flex; flex-direction: column; gap: 8px; margin: 16px 0 12px; }',
    '.cc-voile .cc-bouton { display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 42px; padding: 0 16px;',
    '  border-radius: 10px; font-weight: 700; font-size: 14px; text-align: center; }',
    '.cc-voile .cc-bouton-google { background: #fff; color: #1f1f1f; border: 1px solid #dadce0; }',
    '.cc-voile .cc-bouton-google:hover { background: #f2f2f2; }',
    '.cc-voile .cc-bouton-sans { border: 1px solid var(--border, #333); color: var(--text-main, #e0e0e0); }',
    '.cc-voile .cc-bouton-sans:hover { background: color-mix(in srgb, var(--text-main, #e0e0e0) 8%, transparent); }',
    '.cc-case { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-muted, #a0a0a0); cursor: pointer; }',
    '.cc-case input { margin: 0; width: 16px; height: 16px; flex: 0 0 auto; accent-color: var(--accent, #00e676); }',
    '@media (prefers-reduced-motion: reduce) { .cc-pastille[data-etat="syncing"] { animation: none; } }',
].join('\n');

function monterCompteCloud(hote, options) {
    options = options || {};
    var slug = options.slug || 'appli';
    var objets = options.objets || 'données';
    var CLE_NE_PLUS = 'compteCloud.' + slug + '.nePlusProposer';   // localStorage : décision durable
    var CLE_PROPOSE = 'compteCloud.' + slug + '.propose';          // sessionStorage : une fois par onglet

    if (!document.getElementById('compte-cloud-style')) {
        var style = document.createElement('style');
        style.id = 'compte-cloud-style';
        style.textContent = COMPTE_CLOUD_CSS;
        document.head.appendChild(style);
    }
    if (!hote) { hote = document.createElement('div'); document.body.appendChild(hote); }
    hote.classList.add('cc-hote');

    // Les identifiants sont ceux que TrainHub et HarmoHub utilisaient déjà (google-signin-btn, account-info,
    // sync-status…) : le code et les bancs qui les visent continuent de les trouver.
    // Les deux pilules sont MASQUÉES au départ, le temps que Firebase dise si une session existe : afficher
    // « Se connecter » à quelqu'un déjà connecté serait une fausse alerte à chaque ouverture.
    hote.innerHTML =
        '<button type="button" id="google-signin-btn" class="cc-pilule cc-connexion" hidden'
        + ' title="Se connecter avec Google : ton travail est enregistré automatiquement dans le cloud" aria-label="Se connecter avec Google">'
        + COMPTE_CLOUD_G + '<span class="cc-libelle">Se connecter</span></button>'
        + '<button type="button" id="account-info" class="cc-pilule cc-compte" hidden aria-haspopup="menu" aria-expanded="false">'
        + '<span id="sync-status" class="cc-pastille" role="img" data-etat=""></span>'
        + '<span id="account-name" class="cc-libelle"></span><span class="cc-initiale" aria-hidden="true"></span></button>';

    // Menu et fenêtre vivent dans <body> et non dans la barre : une barre du haut a souvent `overflow: hidden`,
    // qui les couperait.
    var menu = document.createElement('div');
    menu.id = 'cloud-menu';
    menu.className = 'cc-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    menu.innerHTML =
        '<div class="cc-menu-qui"><span class="cc-menu-nom"></span><span class="cc-menu-mail"></span></div>'
        + '<div class="cc-menu-etat"><span class="cc-pastille" data-etat=""></span><span id="cloud-menu-etat"></span></div>'
        + '<div class="cc-menu-sep"></div>'
        + '<button type="button" id="signout-btn" role="menuitem"><span>Se déconnecter</span>'
        + '<span class="cc-aide">Ce qui est déjà envoyé reste dans le cloud</span></button>';
    document.body.appendChild(menu);

    var voile = document.createElement('div');
    voile.id = 'cloud-guard-modal';
    voile.className = 'cc-voile';
    voile.hidden = true;
    voile.innerHTML =
        '<div class="cc-fenetre" role="dialog" aria-modal="true" aria-labelledby="cc-titre">'
        + '<h2 id="cc-titre"></h2><p id="cc-texte"></p><p class="cc-aide" id="cc-aide"></p>'
        + '<div class="cc-actions">'
        + '<button type="button" id="cloud-guard-connect" class="cc-bouton cc-bouton-google">' + COMPTE_CLOUD_G + '<span>Se connecter avec Google</span></button>'
        + '<button type="button" id="cloud-guard-continue" class="cc-bouton cc-bouton-sans"></button>'
        + '</div>'
        + '<label class="cc-case"><input type="checkbox" id="cloud-guard-ne-plus"> Ne plus me le proposer sur cet appareil</label>'
        + '</div>';
    document.body.appendChild(voile);

    var $connexion = document.getElementById('google-signin-btn');
    var $compte = document.getElementById('account-info');
    var $pastille = document.getElementById('sync-status');
    var $nom = document.getElementById('account-name');
    var $initiale = hote.querySelector('.cc-initiale');

    var etat = { user: null, authPrete: false, indisponible: false, raison: '', mode: null, libelle: '', message: '' };

    function lireCle(stockage, cle) { try { return stockage.getItem(cle); } catch (e) { return null; } }
    function ecrireCle(stockage, cle, v) { try { stockage.setItem(cle, v); } catch (e) { /* navigation privée : sans gravité */ } }

    function majPilule() {
        var u = etat.user;
        // Rien n'apparaît avant la réponse de Firebase, SAUF la pilule grisée « indisponible » : un bouton
        // qui n'apparaît jamais ressemble à une panne (retour utilisateur : « je ne vois pas le bouton »).
        $connexion.hidden = !!u || !(etat.authPrete || etat.indisponible);
        $compte.hidden = !u;
        $connexion.classList.toggle('cc-indisponible', etat.indisponible);
        $connexion.classList.toggle('cc-message', !!etat.message && !etat.indisponible);
        $connexion.title = etat.indisponible ? etat.raison
            : (etat.message || 'Se connecter avec Google : ton travail est enregistré automatiquement dans le cloud');
        var nom = u ? (u.displayName || u.email || 'Connecté') : '';
        $nom.textContent = nom;
        $initiale.textContent = nom ? nom.trim().charAt(0).toUpperCase() : '';
        menu.querySelector('.cc-menu-nom').textContent = nom;
        menu.querySelector('.cc-menu-mail').textContent = u && u.email && u.email !== nom ? u.email : '';
        majEtat();
    }

    function majEtat() {
        var lib = etat.libelle || COMPTE_CLOUD_LIBELLES[etat.mode] || 'Non synchronisé';
        [$pastille, menu.querySelector('.cc-pastille')].forEach(function (p) { p.dataset.etat = etat.mode || ''; });
        // Classes en plus de data-etat : l'ancienne pastille de HarmoHub et TrainHub s'en servait.
        $pastille.className = 'cc-pastille' + (etat.mode ? ' ' + etat.mode : '');
        $pastille.title = lib;
        $pastille.setAttribute('aria-label', lib);
        $compte.title = etat.user ? (etat.user.displayName || etat.user.email || 'Compte') + ' — ' + lib : '';
        document.getElementById('cloud-menu-etat').textContent = lib;
    }

    // ---------- menu ----------
    function ouvrirMenu() {
        menu.hidden = false;
        var r = $compte.getBoundingClientRect();
        var pad = 8;
        menu.style.top = Math.min(r.bottom + 6, window.innerHeight - menu.offsetHeight - pad) + 'px';
        // Aligné sur le bord DROIT de la pilule (elle est à droite de la barre dans les trois applis), sans
        // jamais sortir de l'écran.
        var gauche = Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - pad);
        menu.style.left = Math.max(pad, gauche) + 'px';
        $compte.setAttribute('aria-expanded', 'true');
    }
    function fermerMenu() {
        if (menu.hidden) return;
        menu.hidden = true;
        $compte.setAttribute('aria-expanded', 'false');
    }
    $compte.addEventListener('click', function (e) {
        e.stopPropagation();
        if (menu.hidden) ouvrirMenu(); else fermerMenu();
    });
    document.getElementById('signout-btn').addEventListener('click', function () {
        fermerMenu();
        if (options.seDeconnecter) options.seDeconnecter();
    });
    document.addEventListener('click', function (e) {
        if (!menu.hidden && !menu.contains(e.target) && !$compte.contains(e.target)) fermerMenu();
    }, true);
    window.addEventListener('resize', fermerMenu);

    $connexion.addEventListener('click', function () {
        if (etat.indisponible) {
            if (options.surIndisponible) options.surIndisponible(etat.raison);
            else window.alert('Connexion indisponible : ' + etat.raison);
            return;
        }
        if (options.seConnecter) options.seConnecter();
    });

    // ---------- fenêtre de connexion ----------
    var focusAvant = null;
    var TEXTES = {
        accueil: {
            titre: 'Retrouve ton travail partout',
            texte: 'Connecte-toi avec ton compte Google : tes ' + objets + ' sont enregistrés automatiquement dans le cloud, et tu les retrouves sur tous tes appareils.',
            aide: 'Sans compte, ils restent seulement dans ce navigateur, et peuvent disparaître si ses données sont effacées.',
            continuer: 'Continuer sans compte',
        },
        modification: {
            titre: 'Tu n\'es pas connecté',
            texte: 'Ce que tu fais maintenant ne sera pas enregistré dans le cloud : il restera seulement sur cet appareil, et un autre appareil ne le verra pas.',
            aide: 'Tu pourras te connecter plus tard avec le bouton « Se connecter », en haut de l\'écran.',
            continuer: 'Continuer sans synchroniser',
        },
    };

    function fermerFenetre() {
        if (voile.hidden) return;
        if (document.getElementById('cloud-guard-ne-plus').checked) ecrireCle(localStorage, CLE_NE_PLUS, '1');
        voile.hidden = true;
        if (focusAvant && focusAvant.focus) { try { focusAvant.focus(); } catch (e) { /* élément disparu */ } }
    }

    // Une seule fenêtre par ONGLET, qu'elle vienne de l'ouverture ou de la première modification : quelqu'un
    // qui vient de répondre « continuer sans compte » ne doit pas être relancé au premier clic, ni à chaque
    // rechargement de la page (sessionStorage survit au rechargement, pas à la fermeture de l'onglet).
    function proposerConnexion(raison) {
        if (etat.user || !etat.authPrete || etat.indisponible) return false;
        if (lireCle(localStorage, CLE_NE_PLUS) === '1') return false;
        if (lireCle(sessionStorage, CLE_PROPOSE) === '1') return false;
        ecrireCle(sessionStorage, CLE_PROPOSE, '1');
        var t = TEXTES[raison] || TEXTES.accueil;
        document.getElementById('cc-titre').textContent = t.titre;
        document.getElementById('cc-texte').textContent = t.texte;
        document.getElementById('cc-aide').textContent = t.aide;
        document.getElementById('cloud-guard-continue').textContent = t.continuer;
        document.getElementById('cloud-guard-ne-plus').checked = false;
        voile.dataset.raison = raison || 'accueil';
        focusAvant = document.activeElement;
        voile.hidden = false;
        document.getElementById('cloud-guard-connect').focus();
        return true;
    }

    document.getElementById('cloud-guard-connect').addEventListener('click', function () {
        // La connexion part DIRECTEMENT de ce clic : le navigateur n'ouvre la fenêtre Google que dans un geste.
        fermerFenetre();
        if (options.seConnecter) options.seConnecter();
    });
    document.getElementById('cloud-guard-continue').addEventListener('click', fermerFenetre);
    // Cliquer à côté, ou Échap, vaut « continuer » : on ne bloque jamais le travail.
    voile.addEventListener('click', function (e) { if (e.target === voile) fermerFenetre(); });
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (!voile.hidden) { fermerFenetre(); e.stopPropagation(); }
        else if (!menu.hidden) { fermerMenu(); $compte.focus(); e.stopPropagation(); }
    }, true);

    var api = {
        version: COMPTE_CLOUD_VERSION,
        // Seule la PREMIÈRE réponse de Firebase compte comme « ouverture » : celle d'après une déconnexion
        // passe par utilisateur(null), et on n'accueille pas quelqu'un qui vient de se déconnecter.
        authPrete: function (user) {
            var premiere = !etat.authPrete;
            etat.authPrete = true;
            etat.user = user || null;
            if (etat.user) fermerFenetre(); else fermerMenu();
            majPilule();
            if (premiere && !etat.user && options.accueil !== false) proposerConnexion('accueil');
        },
        // Ne vaut PAS réponse de Firebase : une appli peut rafraîchir sa pilule à tout moment (TrainHub le fait
        // quand une séance est enregistrée hors connexion). Si cet appel comptait comme « Firebase a répondu
        // personne », la vraie réponse, arrivée après, ne serait plus la première et la fenêtre d'accueil ne
        // s'ouvrirait jamais. Avant authPrete, rien ne s'affiche donc encore.
        utilisateur: function (user) {
            etat.user = user || null;
            if (etat.user) fermerFenetre(); else fermerMenu();
            majPilule();
        },
        etat: function (mode, libelle) {
            etat.mode = mode || null;
            etat.libelle = libelle || '';
            majEtat();
        },
        indisponible: function (raison) {
            etat.indisponible = true;
            etat.raison = raison || 'Le service de connexion n\'a pas pu démarrer';
            majPilule();
        },
        proposerConnexion: proposerConnexion,
        message: function (texte) {
            etat.message = texte || '';
            majPilule();
        },
        fermerMenu: fermerMenu,
        fermerFenetre: fermerFenetre,
        // Ce que l'interface affiche, pour les bancs et le débogage.
        lire: function () { return { connecte: !!etat.user, mode: etat.mode, indisponible: etat.indisponible }; },
    };
    return api;
}
