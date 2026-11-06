// Écrans de préparation d'une session (v264) : colonne de largeur raisonnable, collée au volet de gauche, réglable par sa poignée de droite (retenue, double-clic = taille d'origine),
// fiche dans l'ordre (nom, onglets, exercices, actions), boutons de même hauteur, état vide parlant, bandeau « Ma session » redimensionnable.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_sessions_ecrans_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : écrans de session — largeur réglable, fiche dans l\'ordre, bandeau « Ma session » redimensionnable');
const estBruitReseau = harnais.estBruitReseau;
plan(43);
const URL = 'http://localhost:8765/index.html';

function etat() {
    const ex = (id, title, o) => Object.assign({ id, title, notes: '', collapsed: true, links: [], files: [], images: [], favorite: false, archived: false, updatedAt: 1 }, o || {});
    const st = (id, e, m) => ({ id, exerciseId: e, minutes: m });
    return { activeInstrumentId: 'i1', updatedAt: 1, instruments: [{ id: 'i1', name: 'Basse', categories: [
        { id: 'c1', name: 'Technique', color: '#e91e63', folders: [{ id: 'fa', name: 'Vitesse', folders: [], exercises: [ex('t1', 'Gamme avec changements découpages'), ex('t2', 'Gammes hasard - Thumb sur les croches'), ex('t3', 'Alternate picking')] }], exercises: [ex('t6', 'Échauffement')] }
    ] }], settings: { sessionFolders: [{ id: 'sf1', name: 'Sessions 1 heure', instrumentId: 'i1', collapsed: false }],
        guidedSessions: [
            { id: 'g1', name: 'Session vitesse', instrumentId: 'i1', tabIds: ['sf1'], createdAt: 1, steps: [st('p1', 't1', 10), st('p2', 't2', 5)] },
            { id: 'g3', name: 'Session vide', instrumentId: 'i1', tabIds: [], createdAt: 3, steps: [] }] } };
}
async function ouvrir(browser, viewport = { width: 1500, height: 900 }) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', colorScheme: 'dark' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !estBruitReseau(m.text()) && !/ERR_FAILED/.test(m.text())) erreurs.push('console: ' + m.text()); });
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.addInitScript(e => { localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1'); if (!sessionStorage.getItem('__seed')) { sessionStorage.setItem('__seed', '1'); localStorage.setItem('trainhub.v1', JSON.stringify(e)); } }, etat());
    await page.goto(URL);
    await page.waitForTimeout(700);
    await page.click('#guided-session-btn');
    await page.waitForSelector('.gs-session-row');
    return { ctx, page, erreurs };
}
const largeur = page => page.evaluate(() => Math.round(document.querySelector('.gs-main').getBoundingClientRect().width));
const cle = (page, k) => page.evaluate(k => localStorage.getItem(k), k);
async function glisser(page, sel, dx) {
    const b = await page.locator(sel).boundingBox();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx / 2, y, { steps: 4 }); await page.mouse.move(x + dx, y, { steps: 4 }); await page.mouse.up();
    await page.waitForTimeout(200);
}
const ouvrirSession = async (page, nom) => { await page.locator('.gs-session-name', { hasText: nom }).click(); await page.waitForSelector('.gs-edit-topbar'); await page.waitForTimeout(250); };
const hauteur = (page, sel) => page.locator(sel).first().evaluate(e => Math.round(e.getBoundingClientRect().height));

(async () => {
    const browser = await chromium.launch();

    // ============ A. Liste : colonne et bouton à taille normale ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        const w = await largeur(page);
        check(w > 600 && w <= 722, 'A. liste des sessions : colonne de 720 px au plus sur un grand écran (' + w + ')');
        const nb = await page.locator('.gs-add-session-btn').evaluate(e => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
        check(nb.w < 260 && nb.h === 36, 'A. « + Nouvelle session » est un bouton (pas une barre) de 36 px : ' + JSON.stringify(nb));
        check(await page.locator('.gs-grip-right').count() === 1 && await page.locator('.gs-grip-left').count() === 0, 'A. une poignée de largeur, au bord droit');
        const colG = await page.evaluate(() => Math.round(document.querySelector('.gs-main').getBoundingClientRect().left - document.querySelector('.sidebar-tree').getBoundingClientRect().right));
        check(colG <= 30, 'A. la colonne est collée au volet de gauche (' + colG + ' px d\'écart, pas de bande vide à gauche)');
        check(await page.locator('.gs-grip-right').getAttribute('role') === 'separator' && !!(await page.locator('.gs-grip-right').getAttribute('title')), 'A. la poignée est un séparateur avec une infobulle');

        // ============ B. Poignées de largeur ============
        await glisser(page, '.gs-grip-right > i', 100);
        const w2 = await largeur(page);
        check(w2 >= w + 95 && w2 <= w + 105, 'B. glisser le bord droit de 100 px : la colonne gagne 100 px (' + w + ' → ' + w2 + ')');
        check(await cle(page, 'trainhub.gsWidth.v1') === String(w2), 'B. la largeur est retenue sur l\'appareil');
        await glisser(page, '.gs-grip-right > i', -60); // vers la gauche = rétrécit
        const w3 = await largeur(page);
        check(w3 >= w2 - 65 && w3 <= w2 - 55, 'B. le bord droit tiré de 60 px vers l\'intérieur : −60 px (' + w2 + ' → ' + w3 + ')');
        await page.reload(); await page.waitForTimeout(700); await page.click('#guided-session-btn'); await page.waitForSelector('.gs-session-row');
        check(Math.abs(await largeur(page) - w3) <= 1, 'B. après rechargement, la largeur choisie est reprise');
        await ouvrirSession(page, 'Session vitesse');
        check(Math.abs(await largeur(page) - w3) <= 1, 'B. la même largeur sur la fiche d\'une session (un seul réglage pour tous ces écrans)');
        await page.locator('.gs-grip-right').focus(); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
        check(await largeur(page) === w3 + 32, 'B. flèche → au clavier : +32 px');
        await page.locator('.gs-grip-right').dblclick(); await page.waitForTimeout(200);
        check(await cle(page, 'trainhub.gsWidth.v1') === null && await largeur(page) <= 722, 'B. double-clic : retour à la taille d\'origine, plus rien de retenu');
        await glisser(page, '.gs-grip-right > i', 900);
        check(await largeur(page) <= 1400 + 2 && await largeur(page) <= 1500, 'B. la largeur reste dans la fenêtre : ' + await largeur(page));
        await page.locator('.gs-grip-right').dblclick(); await page.waitForTimeout(150);

        // ============ C. Fiche d'une session : l'ordre et les boutons ============
        const ordre = await page.evaluate(() => { const y = s => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top) : -1; }; return { nom: y('.gs-name-row'), com: y('textarea.gs-note-comment'), onglets: y('.gs-tabpick'), tete: y('.gs-steps-head'), liste: y('.gs-steps-list'), ajout: y('.gs-add-step-btn'), actions: y('.gs-edit-tools-row') }; });
        check(ordre.nom < ordre.com && ordre.com < ordre.onglets && ordre.onglets < ordre.tete && ordre.tete < ordre.liste && ordre.liste < ordre.ajout && ordre.ajout < ordre.actions, 'C. ordre de la fiche : nom, commentaire, onglets, exercices, « + Ajouter », actions : ' + JSON.stringify(ordre));
        check((await page.locator('.gs-tabpick-label').innerText()).includes('Rangée dans'), 'C. les onglets sont introduits par « Rangée dans : »');
        check(await page.locator('.gs-steps-head .gs-total-row').innerText() === 'Durée totale : 15 min', 'C. la durée totale est sur la ligne du titre des exercices');
        const hs = await page.evaluate(() => ['.gs-back-btn', '.gs-add-step-btn', '.gs-edit-run-btn', '.gs-pdf-btn'].map(s => Math.round(document.querySelector(s).getBoundingClientRect().height)));
        check(hs.every(h => h === 36), 'C. retour, ajouter, lancer, PDF : une seule hauteur (36 px) : ' + hs.join(','));
        const larg = await page.evaluate(() => ['.gs-add-step-btn', '.gs-edit-run-btn', '.gs-pdf-btn'].map(s => Math.round(document.querySelector(s).getBoundingClientRect().width)));
        check(larg.every(x => x < 260), 'C. plus de barres sur toute la largeur : ' + larg.join(','));
        check(await page.locator('.gs-edit-run-btn').evaluate(e => e.classList.contains('btn-accent')) && await page.locator('.gs-add-step-btn').evaluate(e => e.classList.contains('btn-ghost') && !e.classList.contains('btn-accent')), 'C. avec des exercices, « Lancer » est le seul bouton vert');
        check(await page.locator('.gs-steps-empty').count() === 0 && await page.locator('.gs-step-row').count() === 2, 'C. pas de message « vide » quand la session a des exercices');
        check(erreurs.length === 0, 'C. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ D. Session vide : on dit quoi faire ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await ouvrirSession(page, 'Session vide');
        check(await page.locator('.gs-steps-empty').count() === 1 && /ajoute le premier/.test(await page.locator('.gs-steps-empty').innerText()), 'D. session vide : un message dit d\'ajouter le premier exercice');
        check(await page.locator('.gs-add-step-btn').evaluate(e => e.classList.contains('btn-accent')), 'D. et « + Ajouter un exercice » est le bouton vert (la prochaine étape)');
        check(await page.locator('.gs-edit-run-btn').isDisabled(), 'D. « Lancer » attend un exercice (grisé)');
        check(await page.locator('.gs-steps-head .gs-total-row').innerText() === 'Durée totale : 0 min', 'D. durée totale : 0 min');
        await page.locator('.gs-add-step-btn').click(); await page.waitForSelector('.gs-pick-tabs');
        await page.locator('.gs-pick-exercise-row', { hasText: 'Alternate' }).first().click().catch(() => {});
        await page.locator('.gs-pick-fold-btn[data-fold="open"]').click(); await page.waitForTimeout(250);
        await page.locator('.gs-pick-exercise-row', { hasText: 'Alternate picking' }).first().click(); await page.waitForTimeout(250);
        await page.locator('.gs-pick-done').click(); await page.waitForTimeout(300);
        check(await page.locator('.gs-steps-empty').count() === 0 && await page.locator('.gs-add-step-btn').evaluate(e => e.classList.contains('btn-ghost') && !e.classList.contains('btn-accent')) && !(await page.locator('.gs-edit-run-btn').isDisabled()), 'D. après un exercice : plus de message, « Ajouter » redevient discret, « Lancer » est actif');
        check(erreurs.length === 0, 'D. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ E. Choix des exercices : « Ma session » redimensionnable ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await ouvrirSession(page, 'Session vitesse');
        await page.locator('.gs-add-step-btn').click(); await page.waitForSelector('.gs-pick-tabs');
        const lw = await largeur(page);
        check(lw > 900 && lw <= 1122, 'E. l\'écran de choix (deux colonnes) a sa place : ' + lw + ' px, 1 120 px au plus');
        const cote = () => page.locator('.gs-pick-side').evaluate(e => Math.round(e.getBoundingClientRect().width));
        const c0 = await cote();
        check(c0 >= 338 && c0 <= 342 && await page.locator('.gs-pick-split').count() === 1, 'E. le bandeau « Ma session » fait 340 px et une poignée le sépare du choix (' + c0 + ')');
        const trop = () => page.locator('.gs-pick-side-name').evaluateAll(els => els.filter(e => e.scrollWidth > e.clientWidth + 1).length);
        const t0 = await trop();
        check(t0 >= 1, 'E. à 340 px, des noms sont coupés (' + t0 + ')');
        await glisser(page, '.gs-pick-split > i', -240);
        const c1 = await cote();
        check(c1 >= c0 + 235 && c1 <= c0 + 245, 'E. glisser la poignée de 240 px vers la gauche élargit le bandeau (' + c0 + ' → ' + c1 + ')');
        check(await trop() === 0, 'E. ... et les noms ne sont plus coupés');
        check(await cle(page, 'trainhub.gsSide.v1') === String(c1), 'E. la largeur du bandeau est retenue');
        const mainW = await page.locator('.gs-pick-main').evaluate(e => Math.round(e.getBoundingClientRect().width));
        check(mainW >= 300, 'E. le choix garde de la place : ' + mainW + ' px');
        await glisser(page, '.gs-pick-split > i', -2000);
        const c2 = await cote(), mainW2 = await page.locator('.gs-pick-main').evaluate(e => Math.round(e.getBoundingClientRect().width));
        check(c2 <= 720 && mainW2 >= 295, 'E. tiré à fond, le bandeau s\'arrête (' + c2 + ' px) et le choix garde ses 300 px (' + mainW2 + ')');
        // le bandeau reste réglé quand on ajoute un exercice (redessin)
        await page.locator('.gs-pick-fold-btn[data-fold="open"]').click(); await page.waitForTimeout(200);
        await page.locator('.gs-pick-exercise-row', { hasText: 'Alternate picking' }).first().click(); await page.waitForTimeout(300);
        check(await cote() === c2 && await page.locator('.gs-pick-side-row').count() === 3, 'E. un ajout redessine le bandeau sans changer sa largeur');
        await page.locator('.gs-pick-split').dblclick(); await page.waitForTimeout(200);
        const c3 = await cote();
        check(c3 >= 338 && c3 <= 342 && await cle(page, 'trainhub.gsSide.v1') === null, 'E. double-clic sur la poignée : retour à 340 px, plus rien de retenu');
        await glisser(page, '.gs-pick-split > i', -100);
        const c4 = await cote();
        await page.reload(); await page.waitForTimeout(700);
        check(c4 > c3 && await cle(page, 'trainhub.gsSide.v1') === String(c4), 'E. un nouveau réglage est enregistré (' + c4 + ')');
        await page.locator('.gs-pick-split').focus().catch(() => {});
        check(erreurs.length === 0, 'E. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ F. Téléphone : pas de poignées ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { width: 390, height: 800 });
        check(await page.locator('.gs-grip-right').isHidden(), 'F. sur téléphone, la poignée de largeur est masquée');
        await ouvrirSession(page, 'Session vitesse');
        await page.locator('.gs-add-step-btn').click(); await page.waitForSelector('.gs-pick-tabs');
        check(await page.locator('.gs-pick-split').isHidden(), 'F. et la poignée du bandeau « Ma session » aussi (une seule colonne)');
        const deborde = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        check(!deborde, 'F. aucun débordement horizontal sur téléphone');
        check(erreurs.length === 0, 'F. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(1); });
