// Programmation d'une session : onglets Exercices / Morceaux / Favoris / En cours déplaçables, rond de rang (reclic = retrait), bandeau « Ma session » (durées, ordre, retrait, total, camembert), dossiers glissables.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_programmation_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : programmation de session (onglets, rangs, bandeau « Ma session », dossiers glissables)');
const estBruitReseau = harnais.estBruitReseau;
plan(50);
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const URL = 'http://localhost:8765/index.html';

function etat() {
    const ex = (id, title, o) => Object.assign({ id, title, notes: '', collapsed: true, links: [], files: [], images: [], favorite: false, archived: false, updatedAt: 1 }, o || {});
    const song = (id, artist, name, o) => ex(id, artist + ' - ' + name, Object.assign({ isSong: true, artist, songName: name, styles: [], techniques: [], work: '' }, o || {}));
    return { activeInstrumentId: 'i1', updatedAt: 1, instruments: [{ id: 'i1', name: 'Basse', categories: [
        { id: 'c1', name: 'Technique', color: '#e91e63', folders: [
            { id: 'fa', name: 'Vitesse', folders: [], exercises: [ex('t1', 'Gamme lente'), ex('t2', 'Alternate picking', { favorite: true }), ex('t3', 'Legato')] },
            { id: 'fb', name: 'Rythme', folders: [], exercises: [ex('t4', 'Slap de base', { inProgress: true }), ex('t5', 'Ghost notes')] }
        ], exercises: [ex('t6', 'Échauffement')] },
        { id: 'c3', name: 'Harmonie', color: '#2196f3', folders: [], exercises: [ex('h1', 'Accords de passage'), ex('h2', 'Cadences')] },
        { id: 'c2', name: 'Morceaux', color: '#00e676', kind: 'songs', folders: [], vocab: { styles: ['Rock'], techniques: [], work: ['En cours', 'À maîtriser', 'Maîtrisé', 'Plus tard'] }, exercises: [
            song('m1', 'Red Hot Chili Peppers', 'Californication', { favorite: true, work: 'En cours' }), song('m2', 'Red Hot Chili Peppers', 'Under the Bridge'), song('m3', 'The Beatles', 'Come Together')
        ] }
    ] }], settings: { guidedSessions: [{ id: 'g1', name: 'Ma session', instrumentId: 'i1', tabIds: [], createdAt: 1, steps: [] }] } };
}
async function ouvrir(browser, { viewport = { width: 1280, height: 900 } } = {}) {
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
const etatPage = page => page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.v1')));
const sauve = page => page.waitForTimeout(700);
const exo = (st, id) => { let r = null; st.instruments[0].categories.forEach(c => { (function w(f) { (f.exercises || []).forEach(e => { if (e.id === id) r = e; }); (f.folders || []).forEach(w); })(c); }); return r; };
async function ouvrirChapitre(page, nom) { await page.locator('.tree-node > .tree-row', { hasText: nom }).first().click(); await page.waitForTimeout(250); }
async function versChoix(page) {
    await page.click('#guided-session-btn');
    await page.waitForSelector('.gs-session-row');
    await page.locator('.gs-session-name').first().click();
    await page.waitForSelector('.gs-edit-topbar');
    await page.locator('button', { hasText: /^\+ Ajouter un exercice$/ }).first().click();
    await page.waitForSelector('.gs-pick-tabs');
}
const ouvrirTout = async page => { await page.locator('.gs-pick-fold-btn[data-fold="open"]').click(); await page.waitForTimeout(250); };
const ligne = (page, titre) => page.locator('.gs-pick-exercise-row', { hasText: titre }).first();
const rangs = page => page.locator('.gs-pick-side-row .gs-pick-side-n').allInnerTexts();
const noms = page => page.locator('.gs-pick-side-row .gs-pick-side-name').allInnerTexts();
const onglets = page => page.locator('.gs-pick-tab').evaluateAll(l => l.map(b => b.dataset.tab));
async function glisser(page, de, vers, dx = 0, dy = 0, pas = 14) {
    const a = await de.boundingBox(), b = await vers.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    const x1 = b.x + b.width / 2 + dx, y1 = b.y + b.height / 2 + dy;
    for (let i = 1; i <= pas; i++) { await page.mouse.move(a.x + a.width / 2 + (x1 - a.x - a.width / 2) * i / pas, a.y + a.height / 2 + (y1 - a.y - a.height / 2) * i / pas); await page.waitForTimeout(16); }
    await page.mouse.up();
    await page.waitForTimeout(300);
}

(async () => {
    const browser = await chromium.launch();

    // ============ A. Onglets : Exercices / Morceaux / Favoris / En cours ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await versChoix(page);
        check((await onglets(page)).join('|') === 'ex|so|fav|wip', 'A. quatre onglets, dans l\'ordre : Exercices | Morceaux | Favoris | En cours');
        const txt = await page.locator('.gs-pick-tab').allInnerTexts();
        check(/Exercices \(8\)/.test(txt[0]) && /Morceaux \(3\)/.test(txt[1]) && /Favoris \(2\)/.test(txt[2]) && /En cours \(2\)/.test(txt[3]), 'A. effectifs : ' + txt.join(' | '));
        await ouvrirTout(page);
        check(await page.locator('.gs-pick-zone-ex').count() === 1 && await page.locator('.gs-pick-zone-so').count() === 0, 'A. « Exercices » : une zone verte, aucun morceau');
        check(await page.locator('.gs-pick-exercise-row', { hasText: 'Californication' }).count() === 0 && await page.locator('.gs-pick-exercise-row', { hasText: 'Cadences' }).count() === 1, 'A. les morceaux ne sont PAS dans « Exercices »');
        check((await page.locator('.gs-pick-zone > .gs-pick-node > .gs-pick-tree-row .tree-label').allInnerTexts()).join('|') === 'Technique|Harmonie', 'A. seuls les chapitres d\'exercices : Technique | Harmonie');
        await page.locator('.gs-pick-tab[data-tab="so"]').click(); await ouvrirTout(page);
        check(await page.locator('.gs-pick-zone-so').count() === 1 && await page.locator('.gs-pick-exercise-row', { hasText: 'Under the Bridge' }).count() === 1 && await page.locator('.gs-pick-exercise-row', { hasText: 'Cadences' }).count() === 0, 'A. « Morceaux » : zone violette, uniquement les morceaux');
        await page.locator('.gs-pick-tab[data-tab="fav"]').click(); await page.waitForTimeout(250);
        check(await page.locator('.gs-pick-zone-head').allInnerTexts().then(l => l.map(t => t.replace(/\s+/g, ' ').toLowerCase()).join('|')) === 'exercices 1|morceaux 1', 'A. « Favoris » : deux titres, « Exercices 1 » puis « Morceaux 1 »');
        check(await page.locator('.gs-pick-zone-ex .gs-pick-favgroup').count() === 1 && await page.locator('.gs-pick-zone-so .gs-pick-favgroup').count() === 1, 'A. chaque titre garde ses dossiers (un groupe chacun)');
        await page.locator('.gs-pick-tab[data-tab="wip"]').click(); await page.waitForTimeout(250);
        check(await page.locator('.gs-pick-zone-ex .gs-pick-exercise-row').count() === 1 && await page.locator('.gs-pick-zone-so .gs-pick-exercise-row').count() === 1, 'A. « En cours » : un exercice sous « Exercices », un morceau sous « Morceaux »');
        // recherche : liste à plat limitée à l'onglet
        await page.locator('.gs-pick-tab[data-tab="ex"]').click(); await page.fill('.gs-pick-search', 'e'); await page.waitForTimeout(250);
        check(await page.locator('.gs-pick-result', { hasText: 'Californication' }).count() === 0 && await page.locator('.gs-pick-result').count() > 0, 'A. la recherche dans « Exercices » ne montre pas de morceau');
        await page.fill('.gs-pick-search', '');
        // l'onglet se retient
        await page.locator('.gs-pick-tab[data-tab="so"]').click(); await page.waitForTimeout(200);
        await page.locator('.gs-back-btn').click(); await page.waitForTimeout(300);
        await page.locator('button', { hasText: /^\+ Ajouter un exercice$/ }).first().click(); await page.waitForSelector('.gs-pick-tabs');
        check(await page.locator('.gs-pick-tab.active').getAttribute('data-tab') === 'so', 'A. l\'onglet choisi est retenu d\'un choix à l\'autre');
        check(erreurs.length === 0, 'A. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ B. Les onglets se déplacent à la souris ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await versChoix(page);
        await glisser(page, page.locator('.gs-pick-tab[data-tab="wip"]'), page.locator('.gs-pick-tab[data-tab="ex"]'), -30, 0);
        check((await onglets(page)).join('|') === 'wip|ex|so|fav', 'B. « En cours » glissé en tête : ' + (await onglets(page)).join('|'));
        check(await page.locator('.gs-pick-tab.active').getAttribute('data-tab') === 'ex', 'B. le glisser ne change pas d\'onglet');
        await page.reload(); await page.waitForTimeout(700); await versChoix(page);
        check((await onglets(page)).join('|') === 'wip|ex|so|fav', 'B. l\'ordre est retenu après rechargement');
        // la fenêtre « Remplacer partout par… » partage l'ordre
        await page.locator('.gs-back-btn').click(); await page.waitForTimeout(300);
        check(erreurs.length === 0, 'B. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ C. Rond de rang et bandeau « Ma session » ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await versChoix(page);
        await ouvrirTout(page);
        check(await page.locator('.gs-pick-side').count() === 1 && /Ma session/.test(await page.locator('.gs-pick-side-head').innerText()) && await page.locator('.gs-pick-side-row').count() === 0, 'C. le bandeau « Ma session » est là, vide');
        await ligne(page, 'Legato').click(); await ligne(page, 'Cadences').click(); await ligne(page, 'Gamme lente').click(); await page.waitForTimeout(300);
        check((await rangs(page)).join(',') === '1,2,3' && (await noms(page)).join('|') === 'Legato|Cadences|Gamme lente', 'C. trois choix : rangs 1, 2, 3 dans l\'ordre des clics : ' + (await noms(page)).join('|'));
        check((await ligne(page, 'Cadences').locator('.gs-pick-in').innerText()).trim() === '2', 'C. le rond de « Cadences » porte son rang : 2');
        check(/15 min/.test(await page.locator('.gs-pick-side-total').innerText()), 'C. total : 15 min (3 × 5)');
        // reclic = retrait
        await ligne(page, 'Cadences').click(); await page.waitForTimeout(300);
        check((await noms(page)).join('|') === 'Legato|Gamme lente' && (await rangs(page)).join(',') === '1,2', 'C. un reclic RETIRE l\'exercice, les rangs se resserrent');
        check((await ligne(page, 'Gamme lente').locator('.gs-pick-in').innerText()).trim() === '2' && await ligne(page, 'Cadences').locator('.gs-pick-in.off').count() === 1, 'C. « Gamme lente » passe au rang 2 ; « Cadences » retrouve son rond vide');
        // durée : chevrons
        const ligneLegato = page.locator('.gs-pick-side-row', { hasText: 'Legato' });
        await ligneLegato.locator('.num-stepper-btn').last().click(); await ligneLegato.locator('.num-stepper-btn').last().click(); await page.waitForTimeout(250);
        check(await ligneLegato.locator('input').inputValue() === '7' && /12 min/.test(await page.locator('.gs-pick-side-total').innerText()), 'C. les chevrons règlent la durée (7 min) et le total suit (12 min)');
        // ✕ dans le bandeau
        await page.locator('.gs-pick-side-row', { hasText: 'Gamme lente' }).locator('.gs-pick-side-rm').click(); await page.waitForTimeout(300);
        check((await noms(page)).join('|') === 'Legato' && await ligne(page, 'Gamme lente').locator('.gs-pick-in.off').count() === 1, 'C. ✕ retire du bandeau (et le rond redevient vide dans l\'arbre)');
        // camembert : par dossier, du plus long au plus court
        await ligne(page, 'Cadences').click(); await ligne(page, 'Accords de passage').click(); await page.waitForTimeout(300);
        const lg = await page.locator('.gs-pick-legend-row').allInnerTexts();
        check(lg.length === 2 && /Harmonie/.test(lg[0]) && /10 min/.test(lg[0]) && /Technique/.test(lg[1]) && /7 min/.test(lg[1]), 'C. légende triée du plus long (Harmonie, 10 min) au plus court (Technique, 7 min) ' + JSON.stringify(lg));
        check(await page.locator('.gs-pick-pie-svg circle').count() === 2, 'C. le camembert a une part par dossier principal');
        // les morceaux : leur onglet
        await page.locator('.gs-pick-tab[data-tab="so"]').click(); await ouvrirTout(page);
        await ligne(page, 'Come Together').click(); await page.waitForTimeout(300);
        check((await noms(page)).slice(-1)[0] === 'The Beatles - Come Together' && (await rangs(page)).slice(-1)[0] === '4', 'C. un morceau s\'ajoute au bandeau aussi (rang 4)');
        // enregistrement
        await page.locator('.gs-pick-done').click(); await page.waitForSelector('.gs-edit-topbar');
        check(await page.locator('.gs-step-row').count() === 4 && (await page.locator('.gs-step-minutes').first().inputValue()) === '7', 'C. « Terminer » : la session a les 4 pas, le premier à 7 min');
        check(erreurs.length === 0, 'C. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ D. Ordre glissable dans le bandeau ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await versChoix(page); await ouvrirTout(page);
        for (const t of ['Legato', 'Cadences', 'Gamme lente', 'Ghost notes']) await ligne(page, t).click();
        await page.waitForTimeout(300);
        const r = i => page.locator('.gs-pick-side-row').nth(i).locator('.gs-pick-side-name');
        await glisser(page, r(3), r(0), 0, -8);
        check((await noms(page)).join('|') === 'Ghost notes|Legato|Cadences|Gamme lente' && (await rangs(page)).join(',') === '1,2,3,4', 'D. « Ghost notes » glissé en tête : ' + (await noms(page)).join('|'));
        check((await ligne(page, 'Ghost notes').locator('.gs-pick-in').innerText()).trim() === '1', 'D. le rond de l\'arbre suit (rang 1)');
        const ln = page.locator('.gs-pick-side-row').nth(1);
        await ln.locator('.num-stepper-btn').last().click(); await ln.locator('.num-stepper-btn').last().click(); await ln.locator('.num-stepper-btn').last().click(); await page.waitForTimeout(250);
        check((await noms(page)).join('|') === 'Ghost notes|Legato|Cadences|Gamme lente', 'D. allonger une durée ne réordonne RIEN (pas de tri par durée)');
        await page.locator('.gs-pick-done').click(); await page.waitForSelector('.gs-edit-topbar');
        check((await page.locator('.gs-step-row .gs-step-label').allInnerTexts()).join('|') === 'Ghost notes|Legato|Cadences|Gamme lente', 'D. la session suit l\'ordre du bandeau');
        check(erreurs.length === 0, 'D. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ E. Dossiers glissables à la souris ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await versChoix(page);
        const chap = () => page.locator('.gs-pick-zone > .gs-pick-node > .gs-pick-tree-row .tree-label').allInnerTexts();
        check((await chap()).join('|') === 'Technique|Harmonie', 'E. départ : Technique | Harmonie');
        check(await page.locator('.gs-pick-zone > .gs-pick-node > .gs-pick-tree-row .pick-grip').count() === 2, 'E. chaque dossier porte une poignée « ⋮⋮ »');
        const grip = nom => page.locator('.gs-pick-zone > .gs-pick-node', { hasText: nom }).first().locator(':scope > .gs-pick-tree-row .pick-grip');
        const row = nom => page.locator('.gs-pick-zone > .gs-pick-node', { hasText: nom }).first().locator(':scope > .gs-pick-tree-row');
        await glisser(page, grip('Harmonie'), row('Technique'), 0, -10);
        check((await chap()).join('|') === 'Harmonie|Technique', 'E. « Harmonie » glissé avant « Technique » : ' + (await chap()).join('|'));
        check(await page.locator('.gs-pick-zone > .gs-pick-node.expanded, .gs-pick-zone > .gs-pick-node > .gs-pick-tree-children').count() === 0, 'E. le glisser n\'a rien déplié');
        await sauve(page);
        const st = await etatPage(page);
        const ordre = st.instruments[0].pinnedOrder.filter(id => id === 'c1' || id === 'c3');
        check(ordre.join(',') === 'c3,c1', 'E. l\'ordre est enregistré (le même que dans le volet de gauche) : ' + ordre.join(','));
        await page.reload(); await page.waitForTimeout(700); await versChoix(page);
        check((await chap()).join('|') === 'Harmonie|Technique', 'E. et retrouvé après rechargement');
        // sous-dossiers de rang 2 : repliables et glissables
        await row('Technique').click(); await page.waitForTimeout(300);
        const sub = nom => page.locator('.gs-pick-tree-children > .gs-pick-node', { hasText: nom }).first().locator(':scope > .gs-pick-tree-row');
        check(await page.locator('.gs-pick-tree-children > .gs-pick-node').count() === 2, 'E. les sous-dossiers (rang 2) apparaissent');
        await sub('Vitesse').click(); await page.waitForTimeout(250);
        check(await page.locator('.gs-pick-exercise-row', { hasText: 'Legato' }).count() === 1, 'E. un sous-dossier se déplie');
        await sub('Vitesse').click(); await page.waitForTimeout(250);
        check(await page.locator('.gs-pick-exercise-row', { hasText: 'Legato' }).count() === 0, 'E. et se replie');
        await glisser(page, sub('Rythme').locator('.pick-grip'), sub('Vitesse'), 0, -8);
        check((await page.locator('.gs-pick-tree-children > .gs-pick-node > .gs-pick-tree-row .tree-label').allInnerTexts()).join('|') === 'Rythme|Vitesse', 'E. « Rythme » glissé avant « Vitesse »');
        await sauve(page);
        check((await etatPage(page)).instruments[0].categories.find(c => c.id === 'c1').folders.map(f => f.id).join(',') === 'fb,fa', 'E. l\'ordre des sous-dossiers est enregistré');
        // hiérarchie de tailles
        const taille = async sel => parseFloat(await page.locator(sel).first().evaluate(e => getComputedStyle(e).fontSize));
        await page.locator('.gs-pick-fold-btn[data-fold="open"]').click(); await page.waitForTimeout(250);
        const tChap = await taille('.gs-pick-zone > .gs-pick-node > .gs-pick-tree-row .tree-label'), tSub = await taille('.gs-pick-tree-children .gs-pick-node > .gs-pick-tree-row .tree-label'), tEx = await taille('.gs-pick-exercise-row .gs-pick-ex-title');
        check(tChap > tSub && tSub > tEx, `E. noms de dossier plus grands que les sous-dossiers, eux-mêmes plus grands que les exercices (${tChap} > ${tSub} > ${tEx})`);
        check(erreurs.length === 0, 'E. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ F. Fenêtre « Remplacer partout par… » ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('trainhub.v1')); s.settings.guidedSessions[0].steps = [{ id: 'p1', exerciseId: 't1', minutes: 5 }]; localStorage.setItem('trainhub.v1', JSON.stringify(s)); });
        await page.reload(); await page.waitForTimeout(700);
        await page.click('#guided-session-btn'); await page.waitForSelector('.gs-session-row');
        await page.locator('.gs-session-name').first().click(); await page.waitForSelector('.gs-edit-topbar');
        await page.locator('.gs-step-row').first().click({ button: 'right' });
        await page.locator('.ctx-menu >> text=Remplacer partout par').first().click();
        await page.waitForSelector('.exercise-picker-panel .gs-pick-tabs');
        check((await onglets(page)).length === 4 && await page.locator('.exercise-picker-panel .gs-pick-zone-ex').count() === 1, 'F. la fenêtre a les mêmes onglets et la zone « Exercices »');
        await page.locator('.exercise-picker-panel .gs-pick-tab[data-tab="so"]').click(); await page.waitForTimeout(250);
        check(await page.locator('.exercise-picker-panel .gs-pick-zone-so').count() === 1, 'F. et l\'onglet « Morceaux » avec sa zone violette');
        check(erreurs.length === 0, 'F. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    await browser.close();
    bilan();
})();
