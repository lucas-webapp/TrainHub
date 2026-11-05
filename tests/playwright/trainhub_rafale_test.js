// Pastille « En cours » (exercices, morceaux) + onglet « En cours » du choix ; ajout en rafale dans le choix d'une session ; marques « déjà dans la session ».
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_rafale_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : « En cours », ajout en rafale, marques de doublons');
const estBruitReseau = harnais.estBruitReseau;
plan(44);
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const URL = 'http://localhost:8765/index.html';

function etat() {
    const ex = (id, title, o) => Object.assign({ id, title, notes: '', collapsed: true, links: [], files: [], images: [], favorite: false, archived: false, updatedAt: 1 }, o || {});
    const song = (id, artist, name, o) => ex(id, artist ? artist + ' - ' + name : name, Object.assign({ isSong: true, artist, songName: name, styles: [], techniques: [], work: '' }, o || {}));
    return { activeInstrumentId: 'i1', updatedAt: 1, instruments: [{ id: 'i1', name: 'Basse', categories: [
        { id: 'c1', name: 'Technique', color: '#e91e63', folders: [
            { id: 'fa', name: 'Vitesse', folders: [], exercises: [ex('t1', 'Gamme lente'), ex('t2', 'Alternate picking', { inProgress: true }), ex('t3', 'Legato')] },
            { id: 'fb', name: 'Rythme', folders: [], exercises: [ex('t4', 'Slap de base', { inProgress: true }), ex('t5', 'Ghost notes')] }
        ], exercises: [ex('t6', 'Échauffement')] },
        { id: 'c2', name: 'Morceaux', color: '#00e676', kind: 'songs', folders: [], vocab: { styles: ['Rock'], techniques: [], work: ['En cours', 'À maîtriser', 'Maîtrisé', 'Plus tard'] }, exercises: [
            song('m1', 'Red Hot Chili Peppers', 'Californication', { styles: ['Rock'], work: 'En cours' }), song('m2', 'Red Hot Chili Peppers', 'Under the Bridge', { work: 'À maîtriser' }), song('m3', 'The Beatles', 'Come Together', { work: 'En cours' })
        ] }
    ] }], settings: { guidedSessions: [{ id: 'g1', name: 'Ma session', instrumentId: 'i1', tabIds: [], createdAt: 1, steps: [{ id: 'p1', exerciseId: 't1', minutes: 5 }, { id: 'p2', exerciseId: 'm1', minutes: 5 }] }] } };
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

(async () => {
    const browser = await chromium.launch();

    // ============ A. La pastille « En cours » ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await ouvrirChapitre(page, 'Technique');
        await page.locator('.folder-row', { hasText: 'Vitesse' }).click(); await page.waitForTimeout(250);
        check(await page.locator('.exercise-wip-badge').count() === 1, 'A. un exercice déjà « En cours » porte un badge sur sa ligne (1 dans « Vitesse »)');
        // pastille dans la fiche
        await page.locator('.exercise[data-ex-id="t3"] .exercise-row-spacer').click(); await page.waitForTimeout(250);
        const chip = page.locator('.exercise[data-ex-id="t3"] .ex-wip-chip');
        check(await chip.count() === 1 && /En cours/.test(await chip.innerText()) && await chip.getAttribute('aria-pressed') === 'false', 'A. la fiche d\'un exercice montre la pastille « ● En cours » (décochée)');
        // la pastille est sur la ligne des boutons de la fiche (métronome, dé), à leur hauteur
        const geo = await page.locator('.exercise[data-ex-id="t3"]').evaluate(el => { const r = e => e.getBoundingClientRect(); const c = el.querySelector('.ex-wip-chip'), d = el.querySelector('.dice-ex-btn'), m = el.querySelector('.metro-preset-row');
            return { chipH: Math.round(r(c).height), diceH: Math.round(r(d).height), memeLigne: Math.abs((r(c).top + r(c).height / 2) - (r(d).top + r(d).height / 2)) < 3, sousTitre: !!el.querySelector('.ex-wip-row'), dansOutils: c.parentElement.classList.contains('ex-tools-line') }; });
        check(geo.chipH === geo.diceH && geo.memeLigne && geo.dansOutils && !geo.sousTitre, 'A. la pastille est sur la ligne des autres boutons, à la même hauteur (plus de ligne à part) : ' + JSON.stringify(geo));
        await chip.click(); await page.waitForTimeout(250);
        check(await page.locator('.exercise[data-ex-id="t3"] .ex-wip-chip.on').count() === 1 && await page.locator('.exercise[data-ex-id="t3"] .exercise-wip-badge').count() === 1, 'A. cochée : la pastille s\'allume et le badge apparaît sur la ligne');
        const pt = await page.locator('.exercise[data-ex-id="t3"]').evaluate(el => { const b = el.querySelector('.exercise-wip-badge'), t = el.querySelector('input.exercise-title'), i = b.querySelector('i'); const rb = i.getBoundingClientRect(), rt = t.getBoundingClientRect(); return { w: b.offsetWidth, h: b.offsetHeight, texte: b.textContent, droite: rb.left > rt.left + rt.width / 2, bas: rb.top + rb.height / 2 > rt.top + rt.height / 2, dansOutils: !!el.querySelector('.exercise-row-tools .exercise-wip-badge') }; });
        check(pt.w === 0 && pt.h === 0 && pt.texte === '' && pt.droite && pt.bas && !pt.dansOutils, 'A. sur la ligne du titre : un simple point, en bas à droite du titre, hors des boutons, sans place prise : ' + JSON.stringify(pt));
        await sauve(page);
        check(exo(await etatPage(page), 't3').inProgress === true, 'A. l\'état est enregistré (inProgress)');
        await page.locator('.exercise[data-ex-id="t3"] .ex-wip-chip').click(); await page.waitForTimeout(250); await sauve(page);
        check(!('inProgress' in exo(await etatPage(page), 't3')) && await page.locator('.exercise[data-ex-id="t3"] .exercise-wip-badge').count() === 0, 'A. décochée : plus de badge, plus rien d\'enregistré');
        // menu contextuel
        await page.locator('.exercise[data-ex-id="t1"] .exercise-row').click({ button: 'right' });
        await page.locator('.ctx-item', { hasText: 'Marquer « En cours »' }).click(); await page.waitForTimeout(300);
        check(await page.locator('.exercise[data-ex-id="t1"] .exercise-wip-badge').count() === 1, 'A. clic droit › « Marquer « En cours » » : badge');
        await page.locator('.exercise[data-ex-id="t1"] .exercise-row').click({ button: 'right' });
        check(await page.locator('.ctx-item', { hasText: 'Retirer « En cours »' }).count() === 1, 'A. et le menu propose ensuite « Retirer « En cours » »');
        await page.keyboard.press('Escape');
        // filtre de la bibliothèque
        await page.locator('.ex-view-chip', { hasText: 'En cours' }).click(); await page.waitForTimeout(300);
        const vis = await page.locator('.exercise').count();
        check(vis === 2, 'A. le filtre « ● En cours » de la bibliothèque : ne reste que les 2 exercices en cours de « Vitesse » (' + vis + ')');
        await page.locator('.ex-view-chip', { hasText: 'Réinitialiser' }).click(); await page.waitForTimeout(250);
        // sélection multiple
        await page.reload(); await page.waitForTimeout(700);
        await ouvrirChapitre(page, 'Technique'); await page.locator('.folder-row', { hasText: 'Rythme' }).click(); await page.waitForTimeout(250);
        await page.locator('.exercise[data-ex-id="t5"] .exercise-row-spacer').click({ modifiers: ['Control'] });
        await page.locator('.exercise[data-ex-id="t4"] .exercise-row-spacer').click({ modifiers: ['Control'] }); await page.waitForTimeout(300);
        const act = page.locator('button:not(.ex-view-chip)', { hasText: /^(○|●) .*En cours/ });
        check(await act.count() >= 1, 'A. deux exercices sélectionnés : l\'action « En cours » est proposée');
        await act.first().click(); await page.waitForTimeout(400); await sauve(page);
        const st = await etatPage(page);
        check(exo(st, 't5').inProgress === true && exo(st, 't4').inProgress === true, 'A. appliquée aux deux (l\'un l\'était déjà, l\'autre non) : « En cours » pour les deux');
        check(erreurs.length === 0, 'A. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ B. Morceaux : « En cours » = l'état de travail du chapitre ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await ouvrirChapitre(page, 'Morceaux');
        await page.locator('.songs-view-btn[data-view="all"]').click(); await page.waitForTimeout(250);
        check(await page.locator('.exercise-wip-badge').count() === 2, 'B. les 2 morceaux dont le Travail est « En cours » portent le badge');
        await page.locator('.exercise[data-ex-id="m2"] .exercise-row-spacer').click(); await page.waitForTimeout(250);
        check(await page.locator('.exercise[data-ex-id="m2"] .ex-wip-chip').count() === 0 && await page.locator('.exercise[data-ex-id="m2"] .song-block').count() === 1, 'B. pas de pastille en plus sur un morceau : son état de travail la remplace');
        await page.locator('.exercise[data-ex-id="m2"] .exercise-row').click({ button: 'right' });
        await page.locator('.ctx-item', { hasText: 'Marquer « En cours »' }).click(); await page.waitForTimeout(300); await sauve(page);
        let st = await etatPage(page);
        check(exo(st, 'm2').work === 'En cours', 'B. « Marquer En cours » (menu) donne l\'état de travail « En cours » au morceau');
        // renommer l'état « En cours » : la pastille suit
        await page.locator('.songs-view-btn[data-view="work"]').click(); await page.waitForTimeout(250);
        await page.locator('.song-folder-row', { hasText: 'En cours' }).click({ button: 'right' });
        await page.locator('.ctx-item', { hasText: 'Renommer' }).click();
        await page.waitForSelector('.app-dialog input');
        await page.fill('.app-dialog input', 'Actif'); await page.keyboard.press('Enter'); await page.waitForTimeout(500); await sauve(page);
        st = await etatPage(page);
        check(st.instruments[0].categories[1].vocab.inProgress === 'Actif' && exo(st, 'm1').work === 'Actif', 'B. renommer l\'état « En cours » en « Actif » : le chapitre retient que « Actif » compte comme en cours');
        await page.locator('.songs-view-btn[data-view="all"]').click(); await page.waitForTimeout(250);
        check(await page.locator('.exercise-wip-badge').count() === 3, 'B. et les 3 morceaux gardent leur badge');
        check(erreurs.length === 0, 'B. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ C. L'onglet « En cours » du choix ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await versChoix(page);
        const tab = page.locator('.gs-pick-tab[data-tab="wip"]');
        check(/En cours \(4\)/.test(await tab.innerText()), 'C. l\'onglet « ● En cours (4) » : 2 exercices + 2 morceaux : ' + (await tab.innerText()));
        await tab.click(); await page.waitForTimeout(300);
        const groupes = await page.locator('.gs-pick-favgroup .tree-label').allInnerTexts();
        check(groupes.join('|') === 'Technique › Vitesse|Technique › Rythme|Morceaux', 'C. rangés par dossier : ' + groupes.join('|'));
        const lignes = await page.locator('.gs-pick-favgroup .gs-pick-ex-title').allInnerTexts();
        check(lignes.sort().join('|') === ['Alternate picking', 'Slap de base', 'Red Hot Chili Peppers - Californication', 'The Beatles - Come Together'].sort().join('|'), 'C. exercices et morceaux « En cours » : ' + lignes.join('|'));
        await page.fill('.gs-pick-search', 'beatles'); await page.waitForTimeout(250);
        check(await page.locator('.gs-pick-favgroup .gs-pick-exercise-row').count() === 1, 'C. la recherche reste dans l\'onglet (« beatles » : 1)');
        await page.fill('.gs-pick-search', ''); await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(SHOTS, 'choix_en_cours.png') });
        // onglet retenu
        await page.locator('.gs-back-btn').click(); await page.waitForTimeout(300);
        await page.locator('button', { hasText: /^\+ Ajouter un exercice$/ }).first().click(); await page.waitForSelector('.gs-pick-tabs');
        check((await page.locator('.gs-pick-tab[data-tab="wip"]').getAttribute('class')).includes('active'), 'C. l\'onglet « En cours » est retenu au choix suivant');
        // la fenêtre « Remplacer partout par… »
        await page.locator('.gs-back-btn').click(); await page.waitForTimeout(300);
        await page.locator('.gs-step-row').first().click({ button: 'right' });
        await page.locator('.ctx-menu >> text=Remplacer partout par').first().click();
        await page.waitForSelector('.exercise-picker-panel .gs-pick-tabs');
        check(await page.locator('.exercise-picker-panel .gs-pick-tab[data-tab="wip"]').count() === 1 && await page.locator('.exercise-picker-panel .gs-pick-favgroup .gs-pick-exercise-row').count() === 4, 'C. la fenêtre « Remplacer partout par… » a le même onglet (4 lignes)');
        await page.keyboard.press('Escape'); await page.waitForTimeout(250);
        // aucun « en cours » : message
        await page.evaluate(() => { const st = JSON.parse(localStorage.getItem('trainhub.v1')); st.instruments[0].categories[0].folders.forEach(f => f.exercises.forEach(e => delete e.inProgress)); st.instruments[0].categories[1].exercises.forEach(e => { if (e.work === 'En cours') e.work = ''; }); localStorage.setItem('trainhub.v1', JSON.stringify(st)); });
        await page.reload(); await page.waitForTimeout(700); await versChoix(page);
        check(/Rien « En cours »/.test(await page.locator('.gs-empty').innerText()) && /\(0\)/.test(await page.locator('.gs-pick-tab[data-tab="wip"]').innerText()), 'C. sans rien « En cours » : un message qui dit quoi faire, onglet (0)');
        check(erreurs.length === 0, 'C. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ D. Marques « déjà dans la session » ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await versChoix(page);
        await ouvrirTout(page);
        check(await ligne(page, 'Gamme lente').locator('.gs-pick-in.on').count() === 1 && (await ligne(page, 'Gamme lente').locator('.gs-pick-in').innerText()).trim() === '1', 'D. « Gamme lente » (déjà dans la session) porte son rang : 1');
        check(await ligne(page, 'Legato').locator('.gs-pick-in.on').count() === 0 && await ligne(page, 'Legato').locator('.gs-pick-in.off').count() === 1, 'D. « Legato » (pas dans la session) a un rond vide');
        check(await page.locator('.gs-pick-in.on').count() === 1, 'D. 1 rond plein dans l\'onglet Exercices (le morceau est dans l\'onglet Morceaux)');
        // recherche : la marque aussi
        await page.fill('.gs-pick-search', 'gamme'); await page.waitForTimeout(250);
        check(await page.locator('.gs-pick-result .gs-pick-in.on').count() === 1, 'D. dans les résultats de recherche aussi');
        await page.fill('.gs-pick-search', ''); await page.waitForTimeout(250);
        // la marque se met à jour : on ajoute « Legato » (rafale par défaut)
        await ligne(page, 'Legato').click(); await page.waitForTimeout(300);
        check(await ligne(page, 'Legato').locator('.gs-pick-in.on').count() === 1 && (await ligne(page, 'Legato').locator('.gs-pick-in').innerText()).trim() === '3' && await page.locator('.gs-pick-in.on').count() === 2, 'D. « Legato » vient d\'être ajouté : rang 3');
        await ligne(page, 'Legato').click(); await page.waitForTimeout(300);
        check(await ligne(page, 'Legato').locator('.gs-pick-in.on').count() === 0 && await page.locator('.gs-pick-side-row').count() === 2, 'D. un 2e clic le RETIRE (plus de « ×2 ») : la session revient à 2 pas');
        check(erreurs.length === 0, 'D. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ E. Ajout en rafale ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await versChoix(page);
        await ouvrirTout(page);
        check(await page.locator('.gs-pick-burst-opt').count() === 0 && await page.locator('.gs-pick-head input[type="checkbox"]').count() === 0 && await page.locator('.gs-pick-done').isHidden(), 'E. pas de case à cocher : le choix reste toujours ouvert après un ajout ; « Terminer » n\'apparaît qu\'après un premier ajout');
        const ouv0 = await page.locator('.gs-pick-tree .tree-twisty.expanded').count();
        await ligne(page, 'Alternate picking').click(); await page.waitForTimeout(300);
        check(await page.locator('.gs-pick-tabs').count() === 1 && /1 ajouté à la session/.test(await page.locator('.gs-pick-added').innerText()) && await page.locator('.gs-pick-done').isVisible(), 'E. un clic ajoute et on reste dans le choix : « 1 ajouté à la session », bouton « Terminer »');
        check(ouv0 >= 3 && await page.locator('.gs-pick-tree .tree-twisty.expanded').count() === ouv0, 'E. les dossiers restent ouverts (' + ouv0 + ' avant, ' + await page.locator('.gs-pick-tree .tree-twisty.expanded').count() + ' après)');
        await ligne(page, 'Slap de base').click(); await page.waitForTimeout(300);
        await page.locator('.gs-pick-tab[data-tab="so"]').click(); await ouvrirTout(page); // les morceaux sont dans leur onglet
        await ligne(page, 'Under the Bridge').click(); await page.waitForTimeout(300);
        await page.locator('.gs-pick-tab[data-tab="ex"]').click(); await ouvrirTout(page);
        check(/3 ajoutés à la session/.test(await page.locator('.gs-pick-added').innerText()), 'E. 3 ajoutés : « ' + (await page.locator('.gs-pick-added').innerText()) + ' »');
        // sélection multiple (Ctrl+clic) puis « Ajouter à la session »
        await ligne(page, 'Ghost notes').click({ modifiers: ['Control'] });
        await ligne(page, 'Échauffement').click({ modifiers: ['Control'] }); await page.waitForTimeout(250);
        await page.locator('button', { hasText: /Ajouter à la session/ }).first().click(); await page.waitForTimeout(400);
        check(await page.locator('.gs-pick-tabs').count() === 1 && /5 ajoutés/.test(await page.locator('.gs-pick-added').innerText()), 'E. plusieurs d\'un coup (Ctrl+clic, « ＋ Ajouter à la session ») : on reste aussi, compteur à 5');
        // terminer
        await page.locator('.gs-pick-done').click(); await page.waitForTimeout(400);
        check(await page.locator('.gs-edit-topbar').count() === 1 && await page.locator('.gs-step-row').count() === 7, 'E. « Terminer » : retour à la session, 7 pas (2 + 5)');
        const noms = await page.locator('.gs-step-row .gs-step-title, .gs-step-row .exercise-title').allInnerTexts().catch(() => []);
        // retour dans le choix : le compteur repart de zéro
        await page.locator('button', { hasText: /^\+ Ajouter un exercice$/ }).first().click(); await page.waitForSelector('.gs-pick-tabs');
        check((await page.locator('.gs-pick-added').innerText()) === '' && await page.locator('.gs-pick-done').isHidden(), 'E. au choix suivant le compteur repart de zéro');
        // remplacer un pas : jamais en rafale, pas d'option
        await page.locator('.gs-back-btn').click(); await page.waitForTimeout(300);
        await page.reload(); await page.waitForTimeout(700);
        await page.click('#guided-session-btn'); await page.waitForSelector('.gs-session-row'); await page.locator('.gs-session-name').first().click(); await page.waitForSelector('.gs-step-row');
        await page.locator('.gs-step-row').first().click({ button: 'right' });
        await page.locator('.ctx-menu >> text=Remplacer ce pas seulement').first().click(); await page.waitForSelector('.gs-pick-tabs');
        check(await page.locator('.gs-pick-done').isHidden() && await page.locator('.gs-pick-burst-opt').count() === 0, 'E. « Remplacer ce pas seulement… » : un seul choix, ni compteur ni « Terminer »');
        await ouvrirTout(page);
        await ligne(page, 'Legato').click(); await page.waitForTimeout(400);
        check(await page.locator('.gs-edit-topbar').count() === 1, 'E. et un clic remplace le pas puis revient à la session');
        check(erreurs.length === 0, 'E. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
