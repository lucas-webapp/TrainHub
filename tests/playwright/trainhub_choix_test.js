// Choix d'un exercice pour une session (écran de la session et fenêtre « Remplacer partout par… ») :
//  1. les chapitres sont dans le MÊME ordre que la barre latérale (celui qu'on règle en les glissant) ; les sous-dossiers aussi ;
//  2. dossiers repliés au départ, état retenu d'un choix à l'autre et d'une ouverture de l'appli à l'autre, « Tout replier / Tout déplier » ;
//  3. replier / déplier ne ramène plus la vue tout en haut ; ce qu'on a tapé dans la recherche reste.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_choix_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : choix d\'un exercice en session — ordre, mémoire des dossiers, défilement');
const estBruitReseau = harnais.estBruitReseau;
plan(38);
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const URL = 'http://localhost:8765/index.html';

// 4 chapitres rangés « 2, 0, 1, 3 » dans la barre latérale (pinnedOrder) ; le chapitre 0 a des sous-dossiers dans un ordre qui n'est ni alphabétique ni numérique.
function etat() {
    const ex = (id, title, o) => Object.assign({ id, title, notes: '', collapsed: true, links: [], files: [], images: [], favorite: false, archived: false, updatedAt: 1 }, o || {});
    const cats = [];
    for (let c = 0; c < 4; c++) {
        const folders = [];
        const noms = c === 0 ? ['Zèbre', 'Alpha', 'Milieu', 'Beta', 'Omega', 'Delta'] : [0, 1, 2, 3, 4, 5].map(i => `Dossier ${c}.${i}`);
        noms.forEach((nom, f) => { const exs = []; for (let e = 0; e < 6; e++) exs.push(ex(`e${c}_${f}_${e}`, `Exo ${c}.${f}.${e}`, c === 1 && f === 2 && e === 0 ? { favorite: true } : c === 3 && f === 0 && e < 2 ? { favorite: true } : {})); folders.push({ id: `f${c}_${f}`, name: nom, folders: [], exercises: exs }); });
        cats.push({ id: `c${c}`, name: `Chapitre ${c}`, color: ['#e91e63', '#00e676', '#a259ff', '#ff9100'][c], folders, exercises: [ex(`r${c}`, `Racine ${c}`)] });
    }
    const steps = [];
    for (let i = 0; i < 14; i++) steps.push({ id: 'p' + i, exerciseId: `e0_0_${i % 6}`, minutes: 5 });
    return { activeInstrumentId: 'i1', updatedAt: 1, instruments: [{ id: 'i1', name: 'Basse', categories: cats, pinnedOrder: ['c2', 'c0', 'c1', 'c3', '__favorites__', '__archived__'] }],
        settings: { guidedSessions: [{ id: 'g1', name: 'Longue', instrumentId: 'i1', tabIds: [], createdAt: 1, steps }] } };
}
async function ouvrir(browser, { viewport = { width: 1280, height: 700 } } = {}) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', colorScheme: 'dark' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !estBruitReseau(m.text()) && !/ERR_FAILED/.test(m.text())) erreurs.push('console: ' + m.text()); });
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.addInitScript(e => { localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1'); if (!sessionStorage.getItem('__seed')) { sessionStorage.setItem('__seed', '1'); localStorage.setItem('trainhub.v1', JSON.stringify(e)); } }, etat());
    await page.goto(URL);
    await page.waitForTimeout(700);
    return { ctx, page, erreurs };
}
async function versChoix(page) {
    await page.click('#guided-session-btn');
    await page.waitForSelector('.gs-session-row');
    await page.locator('.gs-session-name').first().click();
    await page.waitForSelector('.gs-edit-topbar');
    await page.locator('button', { hasText: /^\+ Ajouter un exercice$/ }).first().click();
    await page.waitForSelector('.gs-pick-tabs');
}
const y = page => page.evaluate(() => Math.round(window.scrollY));
const chapitresChoix = page => page.locator('.gs-pick-tree .gs-pick-zone > .gs-pick-node > .gs-pick-tree-row .tree-label').allInnerTexts();
const chapitresBarre = page => page.locator('.sidebar-tree .tree-list > .tree-node > .tree-row .tree-label').allInnerTexts();
const ouverts = page => page.locator('.gs-pick-tree .tree-twisty.expanded').count();
const chapitreOuvert = page => page.locator('.gs-pick-tree .gs-pick-zone > .gs-pick-node:has(> .gs-pick-tree-row .tree-twisty.expanded) > .gs-pick-tree-row .tree-label').allInnerTexts();

(async () => {
    const browser = await chromium.launch();

    // ============ A. L'ordre des dossiers ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        const barre = await chapitresBarre(page);
        check(barre.slice(0, 4).join('|') === 'Chapitre 2|Chapitre 0|Chapitre 1|Chapitre 3', 'A. la barre latérale (réglée à la main) : ' + barre.join('|'));
        await versChoix(page);
        check((await chapitresChoix(page)).join('|') === 'Chapitre 2|Chapitre 0|Chapitre 1|Chapitre 3', 'A. le choix d\'un exercice a le MÊME ordre de chapitres : ' + (await chapitresChoix(page)).join('|'));
        // sous-dossiers : même ordre que la barre latérale (ni alphabétique ni numérique)
        await page.locator('.gs-pick-tree .gs-pick-zone > .gs-pick-node', { hasText: 'Chapitre 0' }).first().locator(':scope > .gs-pick-tree-row').click(); await page.waitForTimeout(250);
        const sousChoix = await page.locator('.gs-pick-tree .gs-pick-zone > .gs-pick-node', { hasText: 'Chapitre 0' }).first().locator(':scope > .gs-pick-tree-children > .gs-pick-node > .gs-pick-tree-row .tree-label').allInnerTexts();
        const sousBarre = await page.locator('.sidebar-tree .tree-list > .tree-node', { hasText: 'Chapitre 0' }).first().locator(':scope > .tree-children > .tree-node > .tree-row .tree-label').allInnerTexts();
        check(sousChoix.join('|') === 'Zèbre|Alpha|Milieu|Beta|Omega|Delta' && sousChoix.join('|') === sousBarre.join('|'), 'A. et les sous-dossiers : ' + sousChoix.join('|'));
        // les ordres suivent un réglage fait ensuite (on déplace « Chapitre 3 » en tête)
        await page.evaluate(() => { const st = JSON.parse(localStorage.getItem('trainhub.v1')); st.instruments[0].pinnedOrder = ['c3', 'c2', 'c0', 'c1', '__favorites__', '__archived__']; localStorage.setItem('trainhub.v1', JSON.stringify(st)); });
        await page.reload(); await page.waitForTimeout(700);
        await versChoix(page);
        check((await chapitresChoix(page)).join('|') === 'Chapitre 3|Chapitre 2|Chapitre 0|Chapitre 1' && (await chapitresBarre(page)).slice(0, 4).join('|') === 'Chapitre 3|Chapitre 2|Chapitre 0|Chapitre 1', 'A. un nouveau réglage de la barre latérale se retrouve dans le choix : ' + (await chapitresChoix(page)).join('|'));
        // la fenêtre « Remplacer partout par… »
        await page.locator('.gs-back-btn').click(); await page.waitForTimeout(300);
        await page.locator('.gs-step-row').first().click({ button: 'right' });
        await page.locator('.ctx-menu >> text=Remplacer partout par').first().click();
        await page.waitForSelector('.exercise-picker-panel .gs-pick-tabs');
        check((await page.locator('.exercise-picker-panel .folder-picker-tree > .gs-pick-zone > .gs-pick-node > .gs-pick-tree-row .tree-label').allInnerTexts()).join('|') === 'Chapitre 3|Chapitre 2|Chapitre 0|Chapitre 1', 'A. la fenêtre « Remplacer partout par… » aussi : ' + (await page.locator('.exercise-picker-panel .folder-picker-tree > .gs-pick-zone > .gs-pick-node > .gs-pick-tree-row .tree-label').allInnerTexts()).join('|'));
        check(erreurs.length === 0, 'A. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ B. Replié au départ, état retenu ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await versChoix(page);
        check(await ouverts(page) === 0 && await page.locator('.gs-pick-tree .gs-pick-exercise-row').count() === 0, 'B. au premier choix : tout est replié (4 chapitres, aucun exercice affiché)');
        await page.screenshot({ path: path.join(SHOTS, 'choix_replie.png') });
        await page.locator('.gs-pick-fold-btn[data-fold="open"]').click(); await page.waitForTimeout(250);
        const total = await page.locator('.gs-pick-tree .tree-twisty').count();
        check(await ouverts(page) === total && total === 28, `B. « Tout déplier » : ${await ouverts(page)} dossiers sur ${total}`);
        await page.locator('.gs-pick-fold-btn[data-fold="close"]').click(); await page.waitForTimeout(250);
        check(await ouverts(page) === 0, 'B. « Tout replier » : tout se referme');
        // on ouvre un chapitre, puis un de ses dossiers
        await page.locator('.gs-pick-tree .gs-pick-zone > .gs-pick-node', { hasText: 'Chapitre 2' }).first().locator(':scope > .gs-pick-tree-row').click(); await page.waitForTimeout(200);
        await page.locator('.gs-pick-tree-children > .gs-pick-node', { hasText: 'Dossier 2.1' }).first().locator(':scope > .gs-pick-tree-row').click(); await page.waitForTimeout(200);
        check((await chapitreOuvert(page)).join('|') === 'Chapitre 2' && await page.locator('.gs-pick-tree .gs-pick-exercise-row').count() === 7, 'B. on ouvre « Chapitre 2 » et un dossier : seuls ceux-là sont ouverts (7 exercices visibles)');
        // le choix de la barre latérale n'est pas touché
        check(await page.locator('.sidebar-tree .tree-twisty.expanded').count() >= 4, 'B. la barre latérale garde ses dossiers ouverts (état à part)');
        // retour à la session, puis nouveau choix : même état
        await page.locator('.gs-back-btn').click(); await page.waitForTimeout(300);
        await page.locator('button', { hasText: /^\+ Ajouter un exercice$/ }).first().click(); await page.waitForSelector('.gs-pick-tabs');
        check((await chapitreOuvert(page)).join('|') === 'Chapitre 2' && await page.locator('.gs-pick-tree .gs-pick-exercise-row').count() === 7, 'B. au choix suivant : mêmes dossiers ouverts, mêmes refermés');
        // après fermeture de l'appli
        const m = await page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.pickOpen.v1')));
        check(m && m['t:c2'] === true && m['t:f2_1'] === true, 'B. l\'état est écrit sur l\'appareil (trainhub.pickOpen.v1)');
        await page.reload(); await page.waitForTimeout(700);
        await versChoix(page);
        check((await chapitreOuvert(page)).join('|') === 'Chapitre 2' && await page.locator('.gs-pick-tree .gs-pick-exercise-row').count() === 7, 'B. et après avoir rouvert l\'appli');
        // la fenêtre « Remplacer partout par… » partage cet état
        await page.locator('.gs-back-btn').click(); await page.waitForTimeout(300);
        await page.locator('.gs-step-row').first().click({ button: 'right' });
        await page.locator('.ctx-menu >> text=Remplacer partout par').first().click();
        await page.waitForSelector('.exercise-picker-panel .gs-pick-tabs');
        check(await page.locator('.exercise-picker-panel .gs-pick-exercise-row').count() === 7, 'B. la fenêtre « Remplacer partout par… » montre les mêmes dossiers ouverts');
        await page.locator('.exercise-picker-panel .gs-pick-fold-btn[data-fold="close"]').click(); await page.waitForTimeout(250);
        check(await page.locator('.exercise-picker-panel .gs-pick-exercise-row').count() === 0 && await page.locator('.exercise-picker-panel .tree-twisty.expanded').count() === 0, 'B. « Tout replier » y existe aussi');
        check(erreurs.length === 0, 'B. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ C. La vue ne saute plus en haut ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await versChoix(page);
        await page.locator('.gs-pick-fold-btn[data-fold="open"]').click(); await page.waitForTimeout(300);
        const tw = page.locator('.gs-pick-tree .gs-pick-tree-row .tree-twisty').nth(9);
        await tw.scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
        const y0 = await y(page);
        check(y0 > 300, 'C. la page est bien défilée avant le test (' + y0 + ' px)');
        await tw.click(); await page.waitForTimeout(300);
        check(await y(page) === y0, `C. replier un dossier : la vue reste où elle est (${y0} → ${await y(page)})`);
        await tw.click(); await page.waitForTimeout(300);
        check(await y(page) === y0, `C. le déplier de nouveau : idem (${await y(page)})`);
        const ligne = page.locator('.gs-pick-tree .gs-pick-tree-row').nth(12);
        await ligne.scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
        const y1 = await y(page);
        await ligne.click(); await page.waitForTimeout(300);
        check(await y(page) === y1, `C. un clic sur la ligne du dossier : idem (${y1} → ${await y(page)})`);
        // une action qui redessine toute l'appli (sélection multiple) : la case de recherche ne reprend pas la main
        await page.locator('.gs-pick-fold-btn[data-fold="open"]').scrollIntoViewIfNeeded(); await page.waitForTimeout(100);
        await page.locator('.gs-pick-fold-btn[data-fold="open"]').click(); await page.waitForTimeout(250);
        const ex = page.locator('.gs-pick-exercise-row').nth(20);
        await ex.scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
        const y2 = await y(page);
        await ex.click({ modifiers: ['Control'] }); await page.waitForTimeout(300);
        check(await y(page) === y2 && await page.locator('.gs-pick-tabs').count() === 1, `C. Ctrl+clic (sélection de plusieurs exercices) : la vue reste (${y2} → ${await y(page)}), toujours dans le choix`);
        // recherche : ce qui est tapé reste ; effacer remet la liste
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.fill('.gs-pick-search', 'Exo 2.3'); await page.waitForTimeout(250);
        check(await page.locator('.gs-pick-result').count() === 6, 'C. recherche « Exo 2.3 » : 6 résultats');
        await page.fill('.gs-pick-search', ''); await page.waitForTimeout(250);
        check(await page.locator('.gs-pick-result').count() === 0 && await page.locator('.gs-pick-tree').count() === 1, 'C. effacer la recherche : l\'arborescence revient');
        // la case de recherche est prête à l'ouverture (sans faire défiler)
        await page.locator('.gs-back-btn').click(); await page.waitForTimeout(300);
        await page.locator('button', { hasText: /^\+ Ajouter un exercice$/ }).first().click(); await page.waitForSelector('.gs-pick-tabs'); await page.waitForTimeout(200);
        check(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('gs-pick-search')), 'C. à l\'ouverture du choix, la case de recherche est prête à taper');
        check(erreurs.length === 0, 'C. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ D. Onglet Favoris retenu, groupes repliables retenus ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await versChoix(page);
        await page.locator('.gs-pick-tab[data-tab="fav"]').click(); await page.waitForSelector('.gs-pick-favgroup');
        const g0 = await page.locator('.gs-pick-favgroup').count();
        check(g0 === 2 && await page.locator('.gs-pick-favgroup .gs-pick-exercise-row').count() === 3, 'D. favoris : 2 groupes (dossiers) ouverts au départ, 3 exercices');
        await page.locator('.gs-pick-favgroup', { hasText: 'Dossier 1.2' }).locator('.gs-pick-tree-row').click(); await page.waitForTimeout(250);
        check(await page.locator('.gs-pick-favgroup .gs-pick-exercise-row').count() === 2, 'D. un groupe replié');
        await page.locator('.gs-back-btn').click(); await page.waitForTimeout(300);
        await page.locator('button', { hasText: /^\+ Ajouter un exercice$/ }).first().click(); await page.waitForSelector('.gs-pick-tabs');
        check(await page.locator('.gs-pick-tab[data-tab="fav"]').getAttribute('class').then(c => /active/.test(c)) && await page.locator('.gs-pick-favgroup .gs-pick-exercise-row').count() === 2, 'D. au choix suivant : onglet Favoris toujours choisi, groupe toujours replié');
        await page.reload(); await page.waitForTimeout(700);
        await versChoix(page);
        check(await page.locator('.gs-pick-tab[data-tab="fav"]').getAttribute('class').then(c => /active/.test(c)) && await page.locator('.gs-pick-favgroup .gs-pick-exercise-row').count() === 2, 'D. et après avoir rouvert l\'appli');
        await page.locator('.gs-pick-fold-btn[data-fold="open"]').click(); await page.waitForTimeout(250);
        check(await page.locator('.gs-pick-favgroup .gs-pick-exercise-row').count() === 3, 'D. « Tout déplier » rouvre aussi les groupes de favoris');
        // choisir un exercice : toujours possible, la session reçoit le pas
        await page.locator('.gs-pick-favgroup .gs-pick-exercise-row').first().click(); await page.waitForTimeout(400);
        await page.locator('.gs-pick-done').click(); await page.waitForTimeout(400);
        check(await page.locator('.gs-step-row').count() === 15, 'D. choisir un exercice l\'ajoute à la session (15 pas, après « Terminer »)');
        check(erreurs.length === 0, 'D. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ E. Ajouter ne bouge pas la vue (ajout en rafale) ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await versChoix(page);
        await page.locator('.gs-pick-fold-btn[data-fold="open"]').click(); await page.waitForTimeout(300);
        const ex = page.locator('.gs-pick-exercise-row').nth(30);
        await ex.scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
        const y0 = await y(page);
        check(y0 > 300, 'E. la page est bien défilée avant l\'ajout (' + y0 + ' px)');
        await ex.click(); await page.waitForTimeout(400);
        check(await y(page) === y0 && await page.locator('.gs-pick-tabs').count() === 1 && /1 ajouté/.test(await page.locator('.gs-pick-added').innerText()), `E. un clic ajoute l'exercice : la vue reste exactement où elle est (${y0} → ${await y(page)}), toujours dans le choix, « 1 ajouté »`);
        const ex2 = page.locator('.gs-pick-exercise-row').nth(45);
        await ex2.scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
        const y1 = await y(page);
        await ex2.click(); await page.waitForTimeout(400);
        check(await y(page) === y1 && /2 ajoutés/.test(await page.locator('.gs-pick-added').innerText()), `E. un 2e ajout plus bas : la vue ne bouge pas (${y1} → ${await y(page)}), « 2 ajoutés »`);
        await page.locator('.gs-pick-done').click(); await page.waitForTimeout(400);
        check(await page.locator('.gs-step-row').count() === 16, 'E. « Terminer » : retour à la session, avec ses 16 pas (14 + 2) à régler');
        check(erreurs.length === 0, 'E. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
