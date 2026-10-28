// LE COMPOSANT COMMUN « COMPTE CLOUD » (compte-cloud.js), éprouvé SEUL, hors de toute appli.
//
// RETOURS UTILISATEUR, mot pour mot :
//   « Sur les 3 applis, les pastilles de connexion sont différentes. Je veux mettre les mêmes. »
//   « Tu peux également proposer la fenêtre connexion lorsqu'aucun utilisateur n'est connecté. »
//   « À chaque fois que je modifie les systèmes de connexion sur une appli, je dois refaire toute la
//     démarche pour les autres applications. » (décision : un fichier de référence, copié tel quel)
//
// POURQUOI SEUL. Ce fichier part tel quel dans TabHub et TrainHub : ce banc éprouve ce qu'il promet à
// N'IMPORTE QUELLE appli — sur une page qui imite le pire de chacune (règle générale `button` de HarmoHub,
// thème clair et thème « verre » de TrainHub). L'intégration dans HarmoHub est éprouvée, elle, par
// synchro_cloud_test (section 14). Dernière partie : les EMPREINTES des fichiers partagés, relevées dans
// docs/fichiers-partages.md — si le fichier change sans que la note suive, ce banc le dit, et les autres
// applis ne peuvent pas recevoir une copie dont personne ne connaît la version.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { check, exiger, plan, bilan } = require('./_harness')('compte cloud (composant commun)');

plan(49);   // 51 dans HarmoHub et TabHub ; 49 là où synchro-cloud.js n'existe pas (TrainHub)

const RACINE = path.join(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(RACINE, 'compte-cloud.js'), 'utf8');

// Les variables des trois applis (elles partagent les mêmes noms), et le thème clair de TrainHub.
const THEME_SOMBRE = '--bg:#0a0a0a; --text-main:#e0e0e0; --text-muted:#a0a0a0; --border:#333; --accent:#00e676; --card-bg:#161616;';
const THEME_CLAIR = '--bg:#f1f4f1; --text-main:#1a201c; --text-muted:#5b655f; --border:#d3d9d4; --accent:#087a40; --card-bg:rgba(255,255,255,.055);';
const PAGE = (theme) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { ${theme} }
  body { margin: 0; background: var(--bg); color: var(--text-main); font-family: sans-serif; }
  /* Le pire des trois applis : la règle générale des boutons de HarmoHub, et une barre qui coupe ce qui déborde. */
  button { flex: 1; min-width: 120px; padding: 20px; background: red; font-size: 30px; }
  .barre { display: flex; justify-content: flex-end; align-items: center; gap: 8px; height: 48px; padding: 0 12px; overflow: hidden; }
</style></head><body><div class="barre"><span>Appli</span><div id="compte-cloud"></div></div><main style="height:1500px">contenu</main></body></html>`;

(async () => {
    const navigateur = await chromium.launch();
    const erreurs = [];
    const ouvrir = async (theme, viewport, extra = {}) => {
        const ctx = await navigateur.newContext({ viewport, ...extra });
        // Une VRAIE origine (et non about:blank) : localStorage et sessionStorage doivent y fonctionner.
        await ctx.route('http://harnais.test/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: PAGE(theme) }));
        const p = await ctx.newPage();
        p.on('pageerror', (e) => erreurs.push('pageerror: ' + e.message));
        p.on('console', (m) => { if (m.type() === 'error') erreurs.push('console: ' + m.text()); });
        await p.goto('http://harnais.test/');
        await p.addScriptTag({ content: SOURCE });
        await p.evaluate(() => {
            window.__appels = { connexion: 0, deconnexion: 0, indispo: [] };
            window.compte = monterCompteCloud(document.getElementById('compte-cloud'), {
                appli: 'Essai', slug: 'essai', objets: 'tablatures',
                seConnecter: () => window.__appels.connexion++,
                seDeconnecter: () => window.__appels.deconnexion++,
                surIndisponible: (r) => window.__appels.indispo.push(r),
            });
        });
        return { ctx, p };
    };
    const visible = (p, sel) => p.isVisible(sel);
    // `color-mix()` rend ses couleurs calculées au format « color(srgb 0.88 0.89 0.88) », de 0 à 1, et non
    // « rgb(224, 227, 224) » de 0 à 255 : les deux doivent se lire, sinon une fenêtre claire paraît noire.
    const lum = (css) => {
        const c = css.match(/[\d.]+/g).map(Number);
        const k = /^color\(srgb/.test(css) ? 1 : 1 / 255;
        return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) * k;
    };

    // ============ 1. AVANT QUE FIREBASE AIT RÉPONDU ============
    const { ctx, p } = await ouvrir(THEME_SOMBRE, { width: 1200, height: 800 });
    check(await p.isHidden('#google-signin-btn') && await p.isHidden('#account-info'),
        'avant la réponse de Firebase : rien n\'apparaît (« Se connecter » à quelqu\'un déjà connecté serait une fausse alerte)');
    check(await p.evaluate(() => compte.proposerConnexion('modification')) === false && await p.isHidden('#cloud-guard-modal'),
        'et la fenêtre ne s\'ouvre pas : « pas de compte » ne veut encore rien dire');
    check(await p.evaluate(() => typeof COMPTE_CLOUD_VERSION === 'number' && compte.version === COMPTE_CLOUD_VERSION), 'le composant annonce sa version');
    // Une appli qui rafraîchit sa pilule AVANT la réponse de Firebase (TrainHub, séance enregistrée hors
    // connexion) ne doit ni faire apparaître « Se connecter », ni priver l'utilisateur de la fenêtre d'accueil.
    await p.evaluate(() => compte.utilisateur(null));
    check(await p.isHidden('#google-signin-btn') && await p.isHidden('#cloud-guard-modal'),
        'un rafraîchissement de l\'appli avant la réponse de Firebase ne vaut pas réponse : rien n\'apparaît encore');

    // ============ 2. PERSONNE N'EST CONNECTÉ : la fenêtre d'accueil ============
    await p.evaluate(() => compte.authPrete(null));
    check(await visible(p, '#google-signin-btn'), 'Firebase a répondu « personne » : la pilule « Se connecter » apparaît');
    check(await visible(p, '#cloud-guard-modal') && await p.getAttribute('#cloud-guard-modal', 'data-raison') === 'accueil',
        'et la fenêtre de connexion est PROPOSÉE d\'emblée');
    const texte = await p.textContent('#cloud-guard-modal');
    check(/tes tablatures sont enregistrés automatiquement|tes tablatures sont enregistr/.test(texte), `elle parle avec les mots de l'appli (option « objets ») — ${texte.slice(0, 90)}`);
    check(await p.evaluate(() => document.activeElement && document.activeElement.id === 'cloud-guard-connect'), 'le focus est sur « Se connecter avec Google » (clavier)');
    await p.click('#cloud-guard-connect');
    check(await p.evaluate(() => window.__appels.connexion) === 1 && await p.isHidden('#cloud-guard-modal'),
        '« Se connecter avec Google » appelle la connexion de l\'appli, DANS le clic, et ferme la fenêtre');
    check(await p.evaluate(() => compte.proposerConnexion('modification')) === false, 'une seule fenêtre par onglet : la première modification ne relance pas');
    await p.evaluate(() => compte.authPrete(null));
    check(await p.isHidden('#cloud-guard-modal'), 'une deuxième réponse « personne » (après une déconnexion) n\'accueille pas de nouveau');
    await p.click('#google-signin-btn');
    check(await p.evaluate(() => window.__appels.connexion) === 2, 'la pilule « Se connecter » appelle aussi la connexion');
    // Le message propre à une appli (TrainHub : des séances attendent d'être envoyées).
    await p.evaluate(() => compte.message('3 séances enregistrées hors connexion : connecte-toi pour les envoyer'));
    const msg = await p.evaluate(() => { const b = document.getElementById('google-signin-btn'); return { titre: b.title, pastille: getComputedStyle(b, '::after').backgroundColor }; });
    check(/3 séances/.test(msg.titre) && msg.pastille === 'rgb(224, 154, 42)', `un message de l'appli s'affiche au survol, avec une pastille orange (${JSON.stringify(msg)})`);
    await p.evaluate(() => compte.message(''));
    check(!/séances/.test(await p.getAttribute('#google-signin-btn', 'title')) && !(await p.locator('#google-signin-btn').evaluate(e => e.classList.contains('cc-message'))),
        'et s\'efface quand l\'appli n\'a plus rien à dire');

    // ============ 3. CONNECTÉ : la pilule, la pastille, le menu ============
    await p.evaluate(() => compte.utilisateur({ displayName: 'Lucas Delmas', email: 'lucas@example.com' }));
    check(await p.isHidden('#google-signin-btn') && await visible(p, '#account-info'), 'connecté : la pilule du compte remplace « Se connecter »');
    check((await p.textContent('#account-name')) === 'Lucas Delmas', 'avec le nom du compte');
    const MODES = ['synced', 'syncing', 'pending', 'offline', 'error', 'toolarge'];
    const couleurs = {};
    for (const m of MODES) {
        await p.evaluate((mode) => compte.etat(mode), m);
        couleurs[m] = await p.evaluate(() => getComputedStyle(document.getElementById('sync-status')).backgroundColor);
    }
    check(new Set(Object.values(couleurs)).size === 5 && couleurs.error === couleurs.toolarge,
        `une couleur par état (erreur et « trop volumineux » partagent le rouge) — ${JSON.stringify(couleurs)}`);
    await p.evaluate(() => compte.etat('pending'));
    check(/pas encore envoyées/.test(await p.getAttribute('#sync-status', 'aria-label')) && await p.getAttribute('#sync-status', 'data-etat') === 'pending',
        'l\'état est dit EN TOUTES LETTRES (aria-label), pas seulement par une couleur');
    await p.evaluate(() => compte.etat('synced', 'Synchronisé avec le cloud — bibliothèque à 82 % du plafond'));
    check(/82 %/.test(await p.getAttribute('#sync-status', 'aria-label')), 'un libellé fourni par l\'appli (avec son détail) passe tel quel');
    await p.click('#account-info');
    check(await visible(p, '#cloud-menu') && await p.getAttribute('#account-info', 'aria-expanded') === 'true', 'cliquer la pilule ouvre le menu du compte');
    const menu = await p.textContent('#cloud-menu');
    check(/Lucas Delmas/.test(menu) && /lucas@example\.com/.test(menu) && /82 %/.test(menu), 'il dit QUI est connecté et l\'état complet de la synchro');
    const rMenu = await p.evaluate(() => { const r = document.getElementById('cloud-menu').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top }; });
    check(rMenu.l >= 0 && rMenu.r <= 1200 && rMenu.t > 30, `le menu reste dans l'écran, sous la pilule (${JSON.stringify(rMenu)})`);
    await p.keyboard.press('Escape');
    check(await p.isHidden('#cloud-menu') && await p.getAttribute('#account-info', 'aria-expanded') === 'false', 'Échap le referme');
    await p.click('#account-info'); await p.mouse.click(300, 400);
    check(await p.isHidden('#cloud-menu'), 'cliquer ailleurs le referme');
    await p.click('#account-info'); await p.click('#signout-btn');
    check(await p.evaluate(() => window.__appels.deconnexion) === 1 && await p.isHidden('#cloud-menu'), '« Se déconnecter » appelle la déconnexion de l\'appli et referme le menu');
    await p.evaluate(() => compte.utilisateur(null));
    check(await visible(p, '#google-signin-btn') && await p.isHidden('#account-info') && await p.isHidden('#cloud-guard-modal'),
        'déconnecté : retour à « Se connecter », sans fenêtre d\'accueil');

    // ============ 4. ROBUSTESSE FACE AUX STYLES DE L'APPLI ============
    const geo = await p.evaluate(() => {
        const b = document.getElementById('google-signin-btn').getBoundingClientRect();
        const s = getComputedStyle(document.getElementById('google-signin-btn'));
        return { w: b.width, h: b.height, fond: s.backgroundColor, police: s.fontSize };
    });
    check(geo.w < 200 && geo.h === 32 && geo.fond !== 'rgb(255, 0, 0)' && geo.police === '13px',
        `la règle générale « button » de l'appli ne déteint pas (flex: 1, min-width: 120px, fond rouge…) — ${JSON.stringify(geo)}`);
    await p.evaluate(() => compte.utilisateur({ displayName: 'Lucas', email: 'l@x.fr' }));
    const geoC = await p.evaluate(() => document.getElementById('account-info').getBoundingClientRect().width);
    check(geoC < 140, `la pilule connectée reste compacte (${Math.round(geoC)} px)`);

    // ============ 5. INDISPONIBLE (Firebase n'a pas pu démarrer) ============
    const I = await ouvrir(THEME_SOMBRE, { width: 1200, height: 800 });
    await I.p.evaluate(() => compte.indisponible('Le service Firebase n\'a pas pu se charger'));
    check(await visible(I.p, '#google-signin-btn') && await I.p.locator('#google-signin-btn').evaluate(e => e.classList.contains('cc-indisponible')),
        'Firebase indisponible : la pilule reste VISIBLE, grisée — un bouton qui disparaît ressemble à une panne');
    check(/Firebase/.test(await I.p.getAttribute('#google-signin-btn', 'title')), 'la raison est au survol');
    await I.p.click('#google-signin-btn');
    check((await I.p.evaluate(() => window.__appels)).indispo.length === 1 && (await I.p.evaluate(() => window.__appels)).connexion === 0,
        'le clic DIT pourquoi (rappel de l\'appli) au lieu de tenter une connexion impossible');
    await I.p.evaluate(() => compte.authPrete(null));
    check(await I.p.isHidden('#cloud-guard-modal'), 'et on ne propose pas une connexion impossible');

    // ============ 6. « NE PLUS ME LE PROPOSER », par appli ============
    const N = await ouvrir(THEME_SOMBRE, { width: 1200, height: 800 });
    await N.p.evaluate(() => compte.authPrete(null));
    await N.p.check('#cloud-guard-ne-plus');
    await N.p.click('#cloud-guard-continue');
    check(await N.p.evaluate(() => localStorage.getItem('compteCloud.essai.nePlusProposer')) === '1', 'la décision est retenue sur cet appareil, POUR CETTE APPLI (clé avec le slug)');
    const N2p = await N.ctx.newPage();
    await N2p.goto('http://harnais.test/'); await N2p.addScriptTag({ content: SOURCE });
    const autre = await N2p.evaluate(() => {
        const a = monterCompteCloud(document.getElementById('compte-cloud'), { slug: 'essai' });
        a.authPrete(null);
        const essai = document.getElementById('cloud-guard-modal').hidden;
        return { essai };
    });
    check(autre.essai === true, 'nouvel onglet de la même appli : plus de fenêtre');
    const N3p = await N.ctx.newPage();
    await N3p.goto('http://harnais.test/'); await N3p.addScriptTag({ content: SOURCE });
    check(await N3p.evaluate(() => { const a = monterCompteCloud(document.getElementById('compte-cloud'), { slug: 'autre-appli' }); a.authPrete(null); return !document.getElementById('cloud-guard-modal').hidden; }),
        'une AUTRE appli du même domaine (lucas-webapp.github.io) continue de la proposer : chacune sa décision');
    // Fermer sans choisir, par Échap ou en cliquant à côté = continuer.
    await N3p.keyboard.press('Escape');
    check(await N3p.isHidden('#cloud-guard-modal'), 'Échap referme la fenêtre (= continuer sans compte)');

    // ============ 7. THÈMES : clair (TrainHub) et sombre ============
    const fondFenetre = async (pg) => pg.evaluate(() => {
        const v = document.getElementById('cloud-guard-modal'); v.hidden = false;
        const s = getComputedStyle(v.querySelector('.cc-fenetre'));
        const r = { fond: s.backgroundColor, encre: s.color };
        v.hidden = true; return r;
    });
    const sombre = await fondFenetre(N3p);
    const C = await ouvrir(THEME_CLAIR, { width: 1200, height: 800 });
    await C.p.evaluate(() => compte.utilisateur({ displayName: 'Lucas' }));
    const clair = await fondFenetre(C.p);
    check(lum(sombre.fond) < 0.2 && lum(sombre.encre) > 0.7, `thème sombre : fenêtre sombre, texte clair (${sombre.fond} / ${sombre.encre})`);
    check(lum(clair.fond) > 0.85 && lum(clair.encre) < 0.3, `thème clair de TrainHub : fenêtre claire, texte sombre (${clair.fond} / ${clair.encre})`);
    check(!/rgba\([^)]*,\s*0?\.\d+\)/.test(clair.fond) && !/\/\s*0?\.\d+\)/.test(clair.fond),
        `la fenêtre reste OPAQUE même quand --card-bg est translucide (thèmes « verre ») — ${clair.fond}`);
    const piluleClaire = await C.p.evaluate(() => getComputedStyle(document.getElementById('account-info')).color);
    check(piluleClaire === 'rgb(26, 32, 28)', `la pilule prend l'encre du thème de l'appli (${piluleClaire})`);

    // ============ 8. TÉLÉPHONE ============
    const T = await ouvrir(THEME_SOMBRE, { width: 390, height: 760 }, { hasTouch: true, isMobile: true });
    await T.p.evaluate(() => compte.authPrete(null));
    const fen = await T.p.evaluate(() => { const r = document.querySelector('.cc-fenetre').getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, h: window.innerHeight }; });
    check(fen.l >= 0 && fen.r <= 390 && fen.b <= fen.h, `la fenêtre tient dans l'écran du téléphone (${JSON.stringify(fen)})`);
    const boutons = await T.p.evaluate(() => ['cloud-guard-connect', 'cloud-guard-continue'].map(id => document.getElementById(id).getBoundingClientRect().height));
    check(boutons.every(h => h >= 42), `ses boutons se visent au doigt (${boutons})`);
    await T.p.tap('#cloud-guard-continue');
    const pil = await T.p.evaluate(() => {
        const b = document.getElementById('google-signin-btn').getBoundingClientRect();
        return { w: b.width, h: b.height, lib: getComputedStyle(document.querySelector('#google-signin-btn .cc-libelle')).display };
    });
    check(pil.lib === 'none' && pil.w >= 32 && pil.w <= 40 && pil.h >= 32, `téléphone : le G seul, assez grand pour le doigt (${JSON.stringify(pil)})`);
    await T.p.evaluate(() => compte.utilisateur({ displayName: 'Lucas Delmas' }));
    await T.p.evaluate(() => compte.etat('synced'));
    const conn = await T.p.evaluate(() => ({
        initiale: document.querySelector('#account-info .cc-initiale').textContent,
        vis: getComputedStyle(document.querySelector('#account-info .cc-initiale')).display,
        nom: getComputedStyle(document.getElementById('account-name')).display,
        w: document.getElementById('account-info').getBoundingClientRect().width,
    }));
    check(conn.initiale === 'L' && conn.vis !== 'none' && conn.nom === 'none' && conn.w <= 60, `connecté sur téléphone : pastille + initiale (${JSON.stringify(conn)})`);
    await T.p.tap('#account-info');
    const mm = await T.p.evaluate(() => { const r = document.getElementById('cloud-menu').getBoundingClientRect(); return { l: r.left, r: r.right }; });
    check(mm.l >= 0 && mm.r <= 390, `le menu tient dans la largeur du téléphone (${JSON.stringify(mm)})`);
    const debord = await T.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(debord <= 0, `rien ne déborde à 390 px (${debord})`);

    // ============ 9. LES EMPREINTES DES FICHIERS PARTAGÉS ============
    // La note docs/fichiers-partages.md donne, pour chaque fichier partagé, sa VERSION et son EMPREINTE
    // SHA-256. C'est ce que les autres applis comparent pour savoir si leur copie est la bonne. Si le fichier
    // change sans que la note suive, la comparaison mentirait : ce banc refuse.
    const note = fs.readFileSync(path.join(RACINE, 'docs', 'fichiers-partages.md'), 'utf8');
    // TrainHub copie ce banc mais garde son propre moteur : pas de synchro-cloud.js chez lui. On ne vérifie que
    // les fichiers partagés PRÉSENTS dans le dépôt — compte-cloud.js, lui, l'est partout (voir plan()).
    for (const [fichier, constante] of [['compte-cloud.js', 'COMPTE_CLOUD_VERSION'], ['synchro-cloud.js', 'SYNCHRO_CLOUD_VERSION']]) {
        if (fichier !== 'compte-cloud.js' && !fs.existsSync(path.join(RACINE, fichier))) continue;
        const contenu = fs.readFileSync(path.join(RACINE, fichier));
        const empreinte = crypto.createHash('sha256').update(contenu).digest('hex');
        const texteFichier = contenu.toString('utf8');
        const version = Number((texteFichier.match(new RegExp('var ' + constante + ' = (\\d+);')) || [])[1]);
        const enTete = Number((texteFichier.match(/^\/\/ VERSION (\d+) —/m) || [])[1]);
        check(version > 0 && version === enTete, `${fichier} : la version de l'en-tête (${enTete}) est celle du code (${version})`);
        const ligne = note.split('\n').find(l => l.includes('`' + fichier + '`'));
        check(!!ligne && ligne.includes(empreinte) && new RegExp('\\|\\s*' + version + '\\s*\\|').test(ligne),
            `${fichier} : la note de docs/fichiers-partages.md donne la bonne version et la bonne empreinte (${empreinte.slice(0, 12)}…)`);
    }

    check(erreurs.length === 0, `aucune erreur JavaScript (${erreurs.slice(0, 2).join(' | ')})`);
    await navigateur.close();
    bilan();
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
