// Vérifie, dans TrainHub, l'installation du composant commun compte-cloud.js : fenêtre à l'ouverture, pilule, menu,
// déconnexion, indisponibilité, garde-fou de fermeture, barre du haut à 390 px, thèmes. Firebase est SIMULÉ (gstatic intercepté).
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_compte_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { check, exiger, plan, bilan, estBruitReseau } = Object.assign(
    require('/home/user/trainhub/tests/_harness')('TrainHub : connexion via compte-cloud.js'),
    { estBruitReseau: require('/home/user/trainhub/tests/_harness').estBruitReseau });
plan(66);

const URL = 'http://localhost:8765/index.html';
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

// Faux Firebase : l'authentification et un Firestore en mémoire, assez pour que le moteur de TrainHub tourne.
const FAUX_FIREBASE = `
(function () {
  var opts = window.__FAUX || {};
  var user = opts.user || null, authCb = null, store = {};
  window.__appels = { connexion: 0, deconnexion: 0, sets: 0 };
  function doc(p) {
    return {
      get: function () { return Promise.resolve({ exists: p in store, data: function () { return store[p]; } }); },
      set: function (d) { window.__appels.sets++; return new Promise(function (ok) { setTimeout(function () { store[p] = d; ok(); }, opts.lenteur || 0); }); },
      delete: function () { delete store[p]; return Promise.resolve(); },
      onSnapshot: function () { return function () {}; },
      collection: function (n) { return col(p + '/' + n); }
    };
  }
  function col(p) { return { doc: function (id) { return doc(p + '/' + id); }, get: function () { return Promise.resolve({ docs: [], forEach: function () {} }); } }; }
  var authObj = {
    onAuthStateChanged: function (cb) { authCb = cb; setTimeout(function () { cb(user); }, opts.delai || 60); },
    signInWithPopup: function () {
      window.__appels.connexion++;
      user = { uid: 'u1', displayName: 'Lucas Martin', email: 'lucas@example.com' };
      setTimeout(function () { authCb(user); }, 20);
      return Promise.resolve();
    },
    signOut: function () { window.__appels.deconnexion++; user = null; setTimeout(function () { authCb(null); }, 20); return Promise.resolve(); }
  };
  var authFn = function () { return authObj; }; authFn.GoogleAuthProvider = function () {};
  var fsFn = function () { return { collection: col }; }; fsFn.Blob = { fromUint8Array: function (x) { return x; } };
  window.firebase = { initializeApp: function () { return {}; }, auth: authFn, firestore: fsFn };
})();
`;

async function ouvrir(browser, { faux = {}, viewport = { width: 1280, height: 800 }, theme = null, glass = false, pending = false, indisponible = false, avant = null } = {}) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', colorScheme: 'dark' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !estBruitReseau(m.text()) && !(indisponible && /ERR_FAILED/.test(m.text()))) erreurs.push('console: ' + m.text()); });
    await page.route('https://www.gstatic.com/firebasejs/**', route => {
        if (indisponible) return route.abort('failed');
        const u = route.request().url();
        route.fulfill({ status: 200, contentType: 'application/javascript', body: /firebase-app-compat/.test(u) ? FAUX_FIREBASE : '' });
    });
    await page.addInitScript(({ faux, theme, glass, pending }) => {
        window.__FAUX = faux;
        try {
            if (theme) localStorage.setItem('trainhub.theme.v1', theme);
            if (glass) localStorage.setItem('trainhub.glass.v1', '1');
            if (pending && !sessionStorage.getItem('__seed')) {
                sessionStorage.setItem('__seed', '1');
                const d = new Date(); const m = d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1);
                localStorage.setItem('trainhub.log.' + m, JSON.stringify({ records: [{ id: 'r1', date: Date.now(), name: 'Séance test', free: false, steps: [] }, { id: 'r2', date: Date.now() - 1000, name: 'Séance test 2', free: false, steps: [] }], deleted: [], updatedAt: Date.now() }));
                localStorage.setItem('trainhub.logPending.v1', JSON.stringify(pending === 1 ? ['r1'] : ['r1', 'r2']));
            }
        } catch (e) { }
    }, { faux, theme, glass, pending });
    if (avant) await avant(page);
    await page.goto(URL);
    return { ctx, page, erreurs };
}

const visible = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e || e.hidden) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; }, sel);
const debordement = page => page.evaluate(() => ({ doc: document.documentElement.scrollWidth - window.innerWidth, barre: (() => { const b = document.querySelector('.top-bar'); return b ? b.scrollWidth - b.clientWidth : 0; })() }));
const classesPastille = page => page.evaluate(() => document.getElementById('sync-status').className);

(async () => {
    const browser = await chromium.launch();

    // ============ A. Ordinateur, personne de connecté ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { pending: true, faux: { delai: 1500 } });
        // avant la réponse de Firebase (délai 60 ms) : rien dans la barre
        await page.waitForSelector('#google-signin-btn', { state: 'attached' });
        const tot = await visible(page, '#google-signin-btn');
        check(!tot, "A. avant la réponse de Firebase : ni « Se connecter » ni nom de compte (pas de fausse alerte)");
        await page.waitForFunction(() => !document.getElementById('cloud-guard-modal').hidden, null, { timeout: 8000 });
        check(await visible(page, '#cloud-guard-modal'), "A. sans compte : la fenêtre de connexion s'ouvre à l'ouverture de l'appli");
        check(await visible(page, '#google-signin-btn'), "A. et la pilule « G Se connecter » est dans la barre du haut");
        check(!(await visible(page, '#account-info')), "A. pas de compte affiché");
        const titre = await page.locator('#google-signin-btn').getAttribute('title');
        check(/2 séances enregistrées hors connexion : connecte-toi pour les envoyer$/.test(titre || ''), `A. la phrase « N séances enregistrées hors connexion » passe par compte.message (${titre})`);
        const texte = await page.locator('#cc-texte').innerText();
        check(/séances et exercices/.test(texte), "A. la fenêtre parle des « séances et exercices »");
        await page.screenshot({ path: path.join(SHOTS, 'A-bureau-sombre-fenetre.png') });
        await page.click('#cloud-guard-continue');
        check(!(await visible(page, '#cloud-guard-modal')), "A. « Continuer sans compte » ferme la fenêtre");
        check(await visible(page, '#google-signin-btn'), "A. et la pilule « Se connecter » reste en place");
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(SHOTS, 'A-bureau-sombre-pilule.png'), clip: { x: 640, y: 0, width: 640, height: 120 } });
        await page.screenshot({ path: path.join(SHOTS, 'A-bureau-sombre-page.png') });
        const ov = await debordement(page);
        check(ov.doc <= 0 && ov.barre <= 0, `A. la barre du haut ne déborde pas à 1280 px (${JSON.stringify(ov)})`);
        // connexion via la pilule
        await page.click('#google-signin-btn');
        await page.waitForSelector('#account-info:not([hidden])', { timeout: 5000 });
        const ap = await page.evaluate(() => window.__appels);
        check(ap.connexion === 1, `A. le clic sur la pilule lance la connexion de TrainHub (signInWithPopup × ${ap.connexion})`);
        check(await visible(page, '#account-info') && !(await visible(page, '#google-signin-btn')), "A. connecté : la pilule du compte remplace « Se connecter »");
        check((await page.locator('#account-name').innerText()).trim() === 'Lucas Martin', "A. avec le nom du compte");
        // synchro : la pastille doit finir « synced »
        await page.waitForFunction(() => document.getElementById('sync-status').classList.contains('synced'), null, { timeout: 8000 });
        check(true, "A. la pastille passe à « synced » après la synchro initiale (moteur de TrainHub intact)");
        check((await page.locator('#google-signin-btn').getAttribute('title') || '').indexOf('hors connexion') === -1 || !(await visible(page, '#google-signin-btn')), "A. connecté : plus de phrase « hors connexion »");
        // menu
        await page.click('#account-info');
        check(await visible(page, '#cloud-menu'), "A. cliquer la pilule ouvre le menu du compte");
        const menuTxt = await page.locator('#cloud-menu').innerText();
        check(/Lucas Martin/.test(menuTxt) && /lucas@example\.com/.test(menuTxt) && /Synchronisé avec le cloud/.test(menuTxt), "A. le menu dit qui est connecté et l'état de la synchro");
        await page.screenshot({ path: path.join(SHOTS, 'B-bureau-sombre-menu.png'), clip: { x: 640, y: 0, width: 640, height: 220 } });
        await page.screenshot({ path: path.join(SHOTS, 'B-bureau-sombre-connecte.png') });
        // « pending » puis « syncing » puis « synced » après une modification
        await page.keyboard.press('Escape');
        // déconnexion
        await page.click('#account-info');
        await page.click('#signout-btn');
        await page.waitForSelector('#google-signin-btn:not([hidden])', { timeout: 5000 });
        const ap2 = await page.evaluate(() => window.__appels);
        check(ap2.deconnexion === 1, `A. « Se déconnecter » appelle auth.signOut() (${ap2.deconnexion})`);
        check(!(await visible(page, '#cloud-guard-modal')), "A. après une déconnexion, la fenêtre d'accueil ne revient pas");
        check(!(await visible(page, '#account-info')), "A. déconnecté : plus de pilule de compte");
        check(erreurs.length === 0, 'A. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ B. Ordinateur, déjà connecté au chargement ; pending → syncing → synced ; garde-fou ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { faux: { user: { uid: 'u1', displayName: 'Lucas Martin', email: 'lucas@example.com' }, lenteur: 700 } });
        await page.waitForSelector('#account-info:not([hidden])', { timeout: 8000 });
        check(!(await visible(page, '#cloud-guard-modal')), "B. déjà connecté : pas de fenêtre à l'ouverture");
        check(!(await visible(page, '#google-signin-btn')), "B. déjà connecté : pas de « Se connecter » (jamais de fausse alerte)");
        await page.waitForFunction(() => document.getElementById('sync-status').classList.contains('synced'), null, { timeout: 10000 });
        // provoquer une modification (enregistrée → persist → scheduleCloudPush)
        await page.evaluate(() => { window.__vu = []; const el = document.getElementById('sync-status'); new MutationObserver(() => window.__vu.push(el.className)).observe(el, { attributes: true, attributeFilter: ['class'] }); });
        // ajouter un espace : bouton +, saisie du nom, valider
        await page.click('#add-instrument-btn');
        await page.waitForTimeout(250);
        const champ = page.locator('.app-dialog-input').first();
        if (await champ.count()) { await champ.fill('Basse'); await page.keyboard.press('Enter'); }
        await page.waitForTimeout(80);
        const vu = await page.evaluate(() => window.__vu);
        check(vu.some(c => /\bpending\b/.test(c)), `B. une modification met la pastille en « pending » pendant le délai d'attente (${JSON.stringify(vu)})`);
        // garde-fou de fermeture pendant pending / syncing
        const garde = await page.evaluate(() => { const ev = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(ev); return { prevenu: ev.defaultPrevented, cls: document.getElementById('sync-status').className }; });
        check(garde.prevenu, `B. le garde-fou de fermeture se déclenche tant que ce n'est pas envoyé (${garde.cls})`);
        await page.waitForFunction(() => document.getElementById('sync-status').classList.contains('syncing'), null, { timeout: 4000 });
        check(true, "B. puis « syncing » quand l'envoi part");
        const garde2 = await page.evaluate(() => { const ev = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(ev); return ev.defaultPrevented; });
        check(garde2, "B. le garde-fou tient aussi pendant « syncing »");
        await page.waitForFunction(() => document.getElementById('sync-status').classList.contains('synced'), null, { timeout: 8000 });
        const garde3 = await page.evaluate(() => { const ev = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(ev); return ev.defaultPrevented; });
        check(!garde3, "B. et se tait une fois « synced »");
        await page.screenshot({ path: path.join(SHOTS, 'B-bureau-sombre-page-connecte.png') });
        check(erreurs.length === 0, 'B. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ C. Firebase indisponible ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { indisponible: true });
        await page.waitForSelector('#google-signin-btn.cc-indisponible:not([hidden])', { timeout: 10000 });
        check(true, "C. Firebase injoignable : la pilule reste visible, grisée");
        check(!(await visible(page, '#cloud-guard-modal')), "C. et on ne propose pas une connexion impossible");
        const t = await page.locator('#google-signin-btn').getAttribute('title');
        check(/n'a pas pu se charger/.test(t || ''), `C. la raison est au survol (${t})`);
        await page.click('#google-signin-btn');
        await page.waitForSelector('.toast');
        const toast = await page.locator('.toast').first().innerText();
        check(/n'a pas pu se charger/.test(toast), `C. le clic DIT pourquoi, par un message de l'appli (${toast.slice(0, 60)}…)`);
        await page.screenshot({ path: path.join(SHOTS, 'C-bureau-indisponible.png'), clip: { x: 640, y: 0, width: 640, height: 120 } });
        check(erreurs.length === 0, 'C. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ F. Une seule séance en attente ; l'action « Se connecter » du rappel passe par la pilule ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { pending: 1 });
        await page.waitForFunction(() => !document.getElementById('cloud-guard-modal').hidden, null, { timeout: 8000 });
        const titre = await page.locator('#google-signin-btn').getAttribute('title');
        check(/^1 séance enregistrée hors connexion : connecte-toi pour l'envoyer$/.test(titre || ''), `F. une seule séance en attente : phrase au singulier (${titre})`);
        await page.click('#cloud-guard-continue');
        await page.waitForSelector('.toast-action', { timeout: 5000 });
        await page.click('.toast-action');
        await page.waitForSelector('#account-info:not([hidden])', { timeout: 5000 });
        const ap = await page.evaluate(() => window.__appels);
        check(ap.connexion === 1, `F. l'action « Se connecter » du rappel de séances lance la connexion (× ${ap.connexion})`);
        check(erreurs.length === 0, 'F. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ D. Téléphone 390 px, sombre : sans compte puis connecté ============
    const tel = { width: 390, height: 844 };
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { viewport: tel, pending: true });
        await page.waitForFunction(() => !document.getElementById('cloud-guard-modal').hidden, null, { timeout: 8000 });
        const fen = await page.evaluate(() => { const r = document.querySelector('.cc-fenetre').getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom }; });
        check(fen.l >= 0 && fen.r <= 390 && fen.b <= 844, `D. la fenêtre tient dans l'écran du téléphone (${JSON.stringify(fen)})`);
        await page.screenshot({ path: path.join(SHOTS, 'D-tel-sombre-fenetre.png') });
        await page.click('#cloud-guard-continue');
        await page.waitForTimeout(300);
        let ov = await debordement(page);
        check(ov.doc <= 0 && ov.barre <= 0, `D. sans compte : rien ne déborde à 390 px (${JSON.stringify(ov)})`);
        const g = await page.evaluate(() => { const b = document.getElementById('google-signin-btn').getBoundingClientRect(); const l = document.querySelector('#google-signin-btn .cc-libelle'); return { w: b.width, h: b.height, lib: getComputedStyle(l).display, droite: b.right }; });
        check(g.lib === 'none' && g.w >= 32 && g.droite <= 390, `D. « G » seul sur téléphone (${JSON.stringify(g)})`);
        await page.screenshot({ path: path.join(SHOTS, 'D-tel-sombre-sans-compte.png') });
        await page.click('#google-signin-btn');
        await page.waitForSelector('#account-info:not([hidden])', { timeout: 5000 });
        await page.waitForFunction(() => document.getElementById('sync-status').classList.contains('synced'), null, { timeout: 8000 });
        ov = await debordement(page);
        check(ov.doc <= 0 && ov.barre <= 0, `D. connecté : rien ne déborde à 390 px (${JSON.stringify(ov)})`);
        const c = await page.evaluate(() => { const b = document.getElementById('account-info').getBoundingClientRect(); const ini = document.querySelector('.cc-initiale'); const n = document.getElementById('account-name'); return { w: b.width, droite: b.right, ini: getComputedStyle(ini).display, nom: getComputedStyle(n).display, initiale: ini.textContent }; });
        check(c.ini !== 'none' && c.nom === 'none' && c.droite <= 390, `D. connecté : pastille + initiale (${JSON.stringify(c)})`);
        await page.screenshot({ path: path.join(SHOTS, 'D-tel-sombre-connecte.png') });
        await page.click('#account-info');
        const m = await page.evaluate(() => { const r = document.getElementById('cloud-menu').getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom }; });
        check(m.l >= 0 && m.r <= 390 && m.b <= 844, `D. le menu tient dans l'écran (${JSON.stringify(m)})`);
        await page.screenshot({ path: path.join(SHOTS, 'D-tel-sombre-menu.png') });
        // les neuf boutons d'outils gardent leurs colonnes : la barre garde deux lignes
        const hbarre = await page.evaluate(() => document.querySelector('.top-bar').getBoundingClientRect().height);
        check(hbarre < 140, `D. la barre du haut reste sur ses deux lignes (hauteur ${Math.round(hbarre)} px)`);
        check(erreurs.length === 0, 'D. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ E. Thème clair + thèmes verre, ordinateur et téléphone ============
    const variantes = [
        ['clair', { theme: 'light' }],
        ['verre-sombre', { glass: true }],
        ['verre-clair', { glass: true, theme: 'light' }],
    ];
    for (const [nom, opt] of variantes) {
        for (const [appareil, vp] of [['bureau', { width: 1280, height: 800 }], ['tel', tel]]) {
            const { ctx, page, erreurs } = await ouvrir(browser, { ...opt, viewport: vp, pending: true });
            await page.waitForFunction(() => !document.getElementById('cloud-guard-modal').hidden, null, { timeout: 8000 });
            await page.screenshot({ path: path.join(SHOTS, `E-${appareil}-${nom}-fenetre.png`) });
            const lis = await page.evaluate(() => {
                const f = document.querySelector('.cc-fenetre'); const cs = getComputedStyle(f);
                const parse = c => { const m = c.match(/[\d.]+/g).map(Number); return m; };
                const lum = c => { const [r, g, b] = parse(c).slice(0, 3).map(v => { v = v > 1 && !/color\(/.test(c) ? v / 255 : v; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
                const t = document.getElementById('cc-titre'); const fond = cs.backgroundColor; const enc = getComputedStyle(t).color;
                const a = lum(fond), b = lum(enc); const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
                return { fond, enc, ratio: Math.round(ratio * 10) / 10 };
            });
            check(lis.ratio >= 7, `E. ${appareil}/${nom} : fenêtre lisible (contraste ${lis.ratio} : ${lis.enc} sur ${lis.fond})`);
            await page.click('#cloud-guard-continue');
            await page.waitForTimeout(300);
            const pil = await page.evaluate(() => { const b = document.getElementById('google-signin-btn'); const cs = getComputedStyle(b); const r = b.getBoundingClientRect(); return { fond: cs.backgroundColor, enc: cs.color, vis: r.width > 0, droite: r.right }; });
            check(pil.vis && pil.droite <= vp.width, `E. ${appareil}/${nom} : pilule visible dans la barre (${pil.enc} sur ${pil.fond})`);
            await page.screenshot({ path: path.join(SHOTS, `E-${appareil}-${nom}-sans-compte.png`) });
            await page.click('#google-signin-btn');
            await page.waitForSelector('#account-info:not([hidden])', { timeout: 5000 });
            await page.waitForFunction(() => document.getElementById('sync-status').classList.contains('synced'), null, { timeout: 8000 });
            await page.click('#account-info');
            await page.screenshot({ path: path.join(SHOTS, `E-${appareil}-${nom}-menu.png`) });
            const ov = await debordement(page);
            check(ov.doc <= 0 && ov.barre <= 0, `E. ${appareil}/${nom} : rien ne déborde (${JSON.stringify(ov)})`);
            check(erreurs.length === 0, `E. ${appareil}/${nom} : aucune erreur JavaScript ` + JSON.stringify(erreurs));
            await ctx.close();
        }
    }

    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
