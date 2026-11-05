// Choix d'un exercice pour une session : l'onglet « ★ Favoris » range les favoris par dossier (au lieu d'une liste à plat) — écran d'ajout d'un exercice
// et fenêtre de choix (« Remplacer partout par… »). Les exercices sont GRAINES dans l'état local.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_favoris_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : favoris rangés par dossier dans le choix d\'une session');
const estBruitReseau = harnais.estBruitReseau;
plan(31);
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

async function ouvrir(browser, { viewport = { width: 1280, height: 900 }, glass = false, theme = null } = {}) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', colorScheme: 'dark' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !estBruitReseau(m.text()) && !/ERR_FAILED/.test(m.text())) erreurs.push('console: ' + m.text()); });
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.addInitScript(({ glass, theme }) => {
        try {
            localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1');
            if (glass) localStorage.setItem('trainhub.glass.v1', '1');
            if (theme) localStorage.setItem('trainhub.theme.v1', theme);
            if (sessionStorage.getItem('__seed')) return;
            sessionStorage.setItem('__seed', '1');
            const ex = (id, title, o) => Object.assign({ id, title, notes: '', collapsed: true }, o || {});
            const st = {
                activeInstrumentId: 'i1', updatedAt: 1,
                instruments: [{ id: 'i1', name: 'Guitare', categories: [
                    { id: 'c1', name: 'Technique', color: '#e91e63', exercises: [ex('t1', 'Gamme de Do', { favorite: true }), ex('t2', 'Arpèges')], folders: [
                        { id: 'f1', name: 'Vitesse', exercises: [ex('v1', 'Doubles croches', { favorite: true }), ex('v2', 'Trémolo'), ex('v3', 'Legato', { favorite: true })], folders: [] }] },
                    { id: 'c2', name: 'Morceaux', color: '#ff9800', exercises: [ex('m1', 'Hotel California', { favorite: true }), ex('m2', 'Autumn Leaves', { favorite: true }), ex('m3', 'Blue Bossa')], folders: [
                        { id: 'f2', name: 'Jazz', exercises: [ex('j1', 'Giant Steps', { favorite: true })], folders: [] }] },
                    { id: 'c3', name: 'Gammes', color: '#4caf50', exercises: [ex('g1', 'Pentatonique', { favorite: true, archived: true }), ex('g2', 'Modes')], folders: [] }
                ] }],
                settings: { guidedSessions: [{ id: 'g1', name: 'Session test', instrumentId: 'i1', tabIds: [], createdAt: 1, steps: [{ id: 'p1', exerciseId: 't2', minutes: 5 }] }] }
            };
            localStorage.setItem('trainhub.v1', JSON.stringify(st));
        } catch (e) { }
    }, { glass, theme });
    await page.goto('http://localhost:8765/index.html');
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
const groupes = page => page.evaluate(() => Array.from(document.querySelectorAll('.gs-pick-favgroup')).map(n => ({ titre: n.querySelector('.tree-label').textContent, n: n.querySelector('.result-group-count').textContent, ouvert: !!n.querySelector('.gs-pick-tree-children'), exos: Array.from(n.querySelectorAll('.gs-pick-ex-title')).map(e => e.textContent), badges: n.querySelectorAll('.gs-theme-badge').length })));

(async () => {
    const browser = await chromium.launch();

    // ============ A. Écran d'ajout d'un exercice : l'onglet Favoris est rangé par dossier ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await versChoix(page);
        check((await page.locator('.gs-pick-tab[data-tab="fav"]').innerText()).includes('(6)'), 'A. « ★ Favoris (6) » : six favoris (l\'exercice archivé n\'est pas compté)');
        check(await page.locator('.gs-pick-tree-row').count() >= 3 && await page.locator('.gs-pick-favgroup').count() === 0, 'A. onglet « Exercices » : l\'arborescence habituelle, inchangée');
        await page.locator('.gs-pick-tab[data-tab="fav"]').click();
        await page.waitForSelector('.gs-pick-favgroup');
        let g = await groupes(page);
        check(g.length === 4, `A. quatre dossiers contiennent des favoris : ${g.map(x => x.titre).join(' | ')}`);
        const attendu = { 'Technique': ['Gamme de Do'], 'Technique › Vitesse': ['Doubles croches', 'Legato'], 'Morceaux': ['Hotel California', 'Autumn Leaves'], 'Morceaux › Jazz': ['Giant Steps'] };
        check(g.every(x => JSON.stringify(x.exos) === JSON.stringify(attendu[x.titre])), `A. chaque favori est rangé sous SON dossier, dans l'ordre du dossier (${g.map(x => x.titre + ' = ' + x.exos.join(', ')).join(' ; ')})`);
        check(g.every(x => x.n === String(x.exos.length)), `A. et le titre donne le nombre de favoris du dossier (${g.map(x => x.n).join(', ')})`);
        const ordre = g.map(x => x.titre.split(' › ')[0]);
        check(ordre.join(',') === 'Technique,Technique,Morceaux,Morceaux', `A. les dossiers suivent l'ordre des chapitres (${ordre.join(', ')})`);
        check(g.every(x => x.badges === 0) && !(await page.locator('.gs-pick-result').count()), 'A. plus de pastille de chemin répétée sur chaque ligne, ni de liste à plat');
        check(!g.some(x => x.exos.includes('Pentatonique')), 'A. un favori archivé n\'apparaît pas');
        await page.screenshot({ path: path.join(SHOTS, 'fav-1-groupes.png'), clip: { x: 260, y: 80, width: 1020, height: 520 } });
        // replier un dossier : les autres restent ; l'état est retenu en changeant d'onglet
        await page.locator('.gs-pick-favgroup', { hasText: 'Technique › Vitesse' }).locator('.gs-pick-tree-row').click();
        g = await groupes(page);
        check(g.find(x => x.titre === 'Technique › Vitesse').ouvert === false && g.filter(x => x.ouvert).length === 3, 'A. un clic sur le titre replie le dossier, les trois autres restent dépliés');
        await page.locator('.gs-pick-tab[data-tab="ex"]').click();
        await page.locator('.gs-pick-tab[data-tab="fav"]').click();
        g = await groupes(page);
        check(g.find(x => x.titre === 'Technique › Vitesse').ouvert === false, 'A. le dossier replié le reste en revenant sur l\'onglet Favoris');
        await page.locator('.gs-pick-favgroup', { hasText: 'Technique › Vitesse' }).locator('.gs-pick-tree-row').click();
        g = await groupes(page);
        check(g.every(x => x.ouvert), 'A. un second clic le redéplie');
        // la recherche garde le rangement par dossier
        await page.locator('.gs-pick-search').fill('legato');
        g = await groupes(page);
        check(g.length === 1 && g[0].titre === 'Technique › Vitesse' && g[0].exos.join() === 'Legato', 'A. rechercher « legato » dans les favoris : un seul dossier, un seul exercice');
        await page.locator('.gs-pick-search').fill('zzz');
        check((await page.locator('.gs-empty').innerText()).includes('Aucun exercice ne correspond'), 'A. recherche sans résultat : message habituel');
        await page.locator('.gs-pick-search').fill('');
        // recherche dans « Exercices » : liste à plat avec pastille, inchangée
        await page.locator('.gs-pick-tab[data-tab="ex"]').click();
        await page.locator('.gs-pick-search').fill('legato');
        check(await page.locator('.gs-pick-result').count() === 1 && await page.locator('.gs-pick-result .gs-theme-badge').count() === 1 && await page.locator('.gs-pick-favgroup').count() === 0, 'A. « Tous » + recherche : liste à plat avec sa pastille, comme avant');
        await page.locator('.gs-pick-search').fill('');
        // choisir un favori : il est ajouté à la session
        await page.locator('.gs-pick-tab[data-tab="fav"]').click();
        await page.locator('.gs-pick-favgroup', { hasText: 'Morceaux' }).locator('.gs-pick-exercise-row', { hasText: 'Autumn Leaves' }).click();
        await page.locator('.gs-pick-done').click(); // le choix reste ouvert après un ajout (ajout en rafale) : « Terminer » revient à la session
        await page.waitForSelector('.gs-edit-topbar');
        const noms = await page.evaluate(() => Array.from(document.querySelectorAll('.gs-step-row .gs-step-label')).map(e => e.textContent));
        check(noms.includes('Autumn Leaves') && noms.length === 2, `A. un clic sur un favori l'ajoute à la session (${noms.join(', ')})`);
        check(erreurs.length === 0, 'A. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ B. Sans favori : message ; l'onglet retenu d'une fois sur l'autre ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('trainhub.v1')); (function w(f) { (f.exercises || []).forEach(e => { e.favorite = false; }); (f.folders || []).forEach(w); })({ exercises: [], folders: s.instruments[0].categories }); localStorage.setItem('trainhub.v1', JSON.stringify(s)); });
        await page.reload(); await page.waitForTimeout(600);
        await versChoix(page);
        await page.locator('.gs-pick-tab[data-tab="fav"]').click();
        check((await page.locator('.gs-empty').innerText()).includes('Aucun favori') && await page.locator('.gs-pick-favgroup').count() === 0, 'B. sans favori : « Aucun favori… » (rien d\'autre)');
        check(erreurs.length === 0, 'B. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ C. Fenêtre de choix (« Remplacer partout par… ») : mêmes favoris rangés par dossier ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await page.click('#guided-session-btn');
        await page.waitForSelector('.gs-session-row');
        await page.locator('.gs-session-name').first().click();
        await page.waitForSelector('.gs-step-row');
        await page.locator('.gs-step-row').first().click({ button: 'right' });
        await page.locator('.ctx-menu >> text=Remplacer partout par').first().click();
        await page.waitForSelector('.exercise-picker-panel .gs-pick-tabs, .gs-pick-tabs');
        await page.locator('.gs-pick-tab[data-tab="fav"]').click();
        await page.waitForSelector('.gs-pick-favgroup');
        const g = await groupes(page);
        check(g.length === 4 && g.map(x => x.titre).join(' | ') === 'Technique | Technique › Vitesse | Morceaux | Morceaux › Jazz', `C. la fenêtre de choix range aussi les favoris par dossier (${g.map(x => x.titre).join(' | ')})`);
        await page.locator('.gs-pick-favgroup', { hasText: 'Technique › Vitesse' }).locator('.gs-pick-tree-row').click();
        check((await groupes(page)).find(x => x.titre === 'Technique › Vitesse').ouvert === false, 'C. un clic sur le titre replie le dossier dans la fenêtre aussi');
        await page.screenshot({ path: path.join(SHOTS, 'fav-2-fenetre.png') });
        await page.locator('.gs-pick-favgroup', { hasText: 'Morceaux ›' }).locator('.gs-pick-exercise-row', { hasText: 'Giant Steps' }).click();
        await page.waitForSelector('.gs-replace-panel', { timeout: 5000 });
        check(/Giant Steps/.test(await page.locator('.gs-replace-panel .gs-sync-intro').innerText()), 'C. choisir un favori de la fenêtre le sélectionne (le panneau « Remplacer partout » s\'ouvre sur « Giant Steps »)');
        check(erreurs.length === 0, 'C. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ D. Thèmes et téléphone : lisible, rien ne déborde ============
    for (const [nom, opt] of [['bureau-verre', { glass: true }], ['tel-sombre', { viewport: { width: 390, height: 844 } }], ['tel-clair', { viewport: { width: 390, height: 844 }, theme: 'light' }]]) {
        const { ctx, page, erreurs } = await ouvrir(browser, opt);
        await versChoix(page);
        await page.locator('.gs-pick-tab[data-tab="fav"]').click();
        await page.waitForSelector('.gs-pick-favgroup');
        const m = await page.evaluate(() => { const l = document.querySelector('.gs-pick-favs').getBoundingClientRect(); const heads = Array.from(document.querySelectorAll('.gs-pick-fav-head')).map(h => h.getBoundingClientRect()); return { doc: document.documentElement.scrollWidth - innerWidth, debord: heads.some(h => h.right > innerWidth + 1 || h.left < -1), haut: heads.map(h => Math.round(h.height)), n: heads.length }; });
        check(m.doc <= 0 && !m.debord && m.n === 4, `D. ${nom} : les quatre titres de dossier tiennent dans l'écran, sans débordement (${JSON.stringify(m)})`);
        const col = await page.locator('.gs-pick-fav-head').first().evaluate(e => getComputedStyle(e).borderLeftColor);
        check(col !== 'rgba(0, 0, 0, 0)', `D. ${nom} : liseré de la couleur du chapitre (${col})`);
        await page.screenshot({ path: path.join(SHOTS, `fav-3-${nom}.png`) });
        check(erreurs.length === 0, `D. ${nom} : aucune erreur JavaScript ` + JSON.stringify(erreurs));
        await ctx.close();
    }

    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
