// Chapitre « Morceaux » : un morceau = un exercice avec artiste / titre / styles / techniques / travail ; les « dossiers » sont calculés (artistes dès 2 morceaux,
// styles, techniques, travail, tous) ; transformation d'un chapitre existant (dossiers de styles et d'artistes, doublons) ; saisie, classement, renommage, tri, recherche.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_morceaux_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : chapitre Morceaux — artistes, styles, techniques, travail');
const estBruitReseau = harnais.estBruitReseau;
plan(159);
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const URL = 'http://localhost:8765/index.html';

// L'état de départ : « Technique » (ordinaire) et « Morceaux » (dossiers de styles, sous-dossiers d'artistes, un doublon, une copie liée).
function etatDepart() {
    const ex = (id, title, o) => Object.assign({ id, title, notes: '', collapsed: true, links: [], files: [], images: [], favorite: false, archived: false, updatedAt: 1 }, o || {});
    const dossier = (id, name, folders, exercises) => ({ id, name, folders: folders || [], exercises: exercises || [] });
    return {
        activeInstrumentId: 'i1', updatedAt: 1,
        instruments: [
            { id: 'i1', name: 'Basse', categories: [
                { id: 'c1', name: 'Technique', color: '#e91e63', folders: [], exercises: [ex('t1', 'Gamme lente'), ex('t2', 'Slap de base')] },
                { id: 'c2', name: 'Morceaux', color: '#00e676', exercises: [], folders: [
                    dossier('f1', 'Rock', [
                        dossier('f1a', 'Red Hot Chili Peppers', [], [ex('m1', 'Californication', { createdAt: 1000 }), ex('m2', 'Under the Bridge')]),
                        dossier('f1b', 'Beatles', [], [ex('m3', 'Come Together')])
                    ], [ex('m4', 'Seven Nation Army')]),
                    dossier('f2', 'Funk', [
                        dossier('f2a', 'Red Hot Chili Peppers', [], [ex('m5', 'Californication (copie)', { linkId: 'L1', links: [{ id: 'l1', label: 'Vidéo', url: 'https://youtu.be/abc' }], notes: 'refrain à 96' }), ex('m6', 'Give It Away')])
                    ], [ex('m7', 'Chameleon')]),
                    dossier('f3', 'Reggae', [], [ex('m8', 'Bob Marley - Exodus')])
                ] }
            ] },
            { id: 'i2', name: 'Guitare', categories: [{ id: 'g1c', name: 'Morceaux', color: '#a259ff', folders: [], exercises: [ex('gm1', 'Solo de test')] }] }
        ],
        settings: { guidedSessions: [{ id: 'g1', name: 'Session morceaux', instrumentId: 'i1', tabIds: [], createdAt: 1, steps: [{ id: 'p1', exerciseId: 'm5', minutes: 5 }, { id: 'p2', exerciseId: 'm3', minutes: 5 }, { id: 'p3', exerciseId: 't1', minutes: 5 }] }] }
    };
}
async function ouvrir(browser, { etat = etatDepart(), viewport = { width: 1280, height: 900 } } = {}) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', colorScheme: 'dark' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !estBruitReseau(m.text()) && !/ERR_FAILED/.test(m.text())) erreurs.push('console: ' + m.text()); });
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.addInitScript(e => {
        try {
            localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1');
            if (e && !sessionStorage.getItem('__seed')) { sessionStorage.setItem('__seed', '1'); localStorage.setItem('trainhub.v1', JSON.stringify(e)); }
        } catch (x) { }
    }, etat);
    await page.goto(URL);
    await page.waitForTimeout(700);
    return { ctx, page, erreurs };
}
const etat = page => page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.v1')));
const chapitre = async (page, nom, inst = 'i1') => (await etat(page)).instruments.find(i => i.id === inst).categories.find(c => c.name === nom);
async function attendreSauvegarde(page) { await page.waitForTimeout(700); }
async function ouvrirChapitre(page, nom) { await page.locator('.tree-node > .tree-row', { hasText: nom }).first().click(); await page.waitForTimeout(250); }
async function transformer(page, { l1 = null, l2 = null } = {}) {
    await page.locator('.tree-node > .tree-row', { hasText: 'Morceaux' }).first().click({ button: 'right' });
    await page.locator('.ctx-item', { hasText: 'Transformer en chapitre de morceaux' }).click();
    await page.waitForSelector('.songs-convert-panel');
    if (l1) await page.locator('.songs-convert-row select').nth(0).selectOption(l1);
    if (l2) await page.locator('.songs-convert-row select').nth(1).selectOption(l2);
}
const dossiers = page => page.locator('.songs-wrap .song-folder-row .folder-name').allInnerTexts();
const titres = page => page.locator('.songs-wrap .exercise .exercise-title').evaluateAll(els => els.map(e => e.value));
const vue = async (page, v) => { await page.locator(`.songs-view-btn[data-view="${v}"]`).click(); await page.waitForTimeout(250); };


// Un chapitre de morceaux déjà en place (7 morceaux) pour les scénarios suivants.
function etatMorceaux() {
    const ex = (id, title, o) => Object.assign({ id, title, notes: '', collapsed: true, links: [], files: [], images: [], favorite: false, archived: false, updatedAt: 1 }, o || {});
    const song = (id, artist, name, styles, techs, work, o) => ex(id, artist ? artist + ' - ' + name : name, Object.assign({ isSong: true, artist, songName: name, styles: styles || [], techniques: techs || [], work: work || '' }, o || {}));
    return { activeInstrumentId: 'i1', updatedAt: 1, instruments: [{ id: 'i1', name: 'Basse', categories: [
        { id: 'c1', name: 'Technique', color: '#e91e63', folders: [], exercises: [ex('t1', 'Gamme lente'), ex('t2', 'Slap de base')] },
        { id: 'c2', name: 'Morceaux', color: '#00e676', kind: 'songs', folders: [], vocab: { styles: ['Rock', 'Funk', 'Reggae'], techniques: ['Slap', 'Médiator'], work: ['En cours', 'À maîtriser', 'Maîtrisé', 'Plus tard'] }, exercises: [
            song('m1', 'Red Hot Chili Peppers', 'Californication', ['Rock', 'Funk'], ['Slap'], 'En cours'), song('m2', 'Red Hot Chili Peppers', 'Under the Bridge', ['Rock'], [], 'À maîtriser'),
            song('m6', 'Red Hot Chili Peppers', 'Give It Away', ['Funk'], ['Slap'], 'Maîtrisé'), song('m3', 'The Beatles', 'Come Together', ['Rock'], ['Médiator'], 'En cours'),
            song('m4', '', 'Seven Nation Army', ['Rock'], [], ''), song('m8', 'Bob Marley', 'Exodus', ['Reggae'], [], 'Plus tard'), song('m9', 'Jaco Pastorius', 'Portrait of Tracy', [], [], '')
        ] }] }], settings: { guidedSessions: [{ id: 'g1', name: 'Session morceaux', instrumentId: 'i1', tabIds: [], createdAt: 1, steps: [{ id: 'p1', exerciseId: 'm1', minutes: 5 }] }] } };
}
const carte = (page, titre) => page.locator('.songs-wrap .exercise', { has: page.locator('input.exercise-title') }).filter({ hasText: '' }).locator('xpath=.').and(page.locator('.exercise')).filter({ has: page.locator(`input.exercise-title[value="${titre}"]`) });
const ligneId = (page, id) => page.locator(`.exercise[data-ex-id="${id}"] .exercise-row-spacer`);
const barreId = (page, id) => page.locator(`.exercise[data-ex-id="${id}"] input.exercise-title`);
const enfantsArbre = page => page.locator('.song-tree-node .tree-label').allInnerTexts();
const comptesArbre = page => page.locator('.song-tree-node .tree-count').allInnerTexts();

(async () => {
    const browser = await chromium.launch();

    // ============ A. Transformation d'un chapitre existant ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        check(await page.locator('.songs-view-btn').count() === 0, 'A. avant : « Morceaux » est un chapitre ordinaire (pas de rangements)');
        await ouvrirChapitre(page, 'Morceaux');
        check(await page.locator('.songs-view-btn').count() === 0 && await page.locator('.folder-row').count() === 3, 'A. avant : ses dossiers (Rock, Funk, Reggae) sont de vrais dossiers');
        // la fenêtre de transformation
        await transformer(page);
        const intro = await page.locator('.songs-convert-intro').innerText();
        check(/sauvegarde de secours/.test(intro) && /doublons/.test(intro), 'A. la fenêtre explique ce qui va se passer (doublons fusionnés, sauvegarde de secours)');
        const sel = await page.locator('.songs-convert-row select').count();
        check(sel === 2 && await page.locator('.songs-convert-row select').nth(0).inputValue() === 'style' && await page.locator('.songs-convert-row select').nth(1).inputValue() === 'artist', 'A. par défaut : dossiers du 1er niveau = Styles, du 2e niveau = Artistes');
        const sum = await page.locator('.songs-convert-sum').innerText();
        check(/7 morceaux/.test(sum) && /1 doublon fusionné/.test(sum) && /3 styles/.test(sum), 'A. l\'aperçu annonce le résultat : ' + sum);
        await page.screenshot({ path: path.join(SHOTS, 'morceaux_conversion.png') });
        await page.click('.songs-convert-foot .btn-accent');
        await page.waitForTimeout(600);
        await attendreSauvegarde(page);
        const ch = await chapitre(page, 'Morceaux');
        check(ch.kind === 'songs' && ch.folders.length === 0 && ch.exercises.length === 7, `A. le chapitre est de type morceaux : 7 morceaux, plus de dossiers (${ch.exercises.length})`);
        check(JSON.stringify(ch.vocab.styles) === JSON.stringify(['Rock', 'Funk', 'Reggae']), 'A. les styles reprennent les dossiers dans leur ordre : ' + JSON.stringify(ch.vocab.styles));
        const cal = ch.exercises.find(e => e.songName === 'Californication');
        check(cal && cal.artist === 'Red Hot Chili Peppers' && cal.title === 'Red Hot Chili Peppers - Californication', 'A. le titre est « Artiste - Titre » : ' + (cal && cal.title));
        check(cal && JSON.stringify(cal.styles) === JSON.stringify(['Rock', 'Funk']), 'A. le doublon fusionné a les DEUX styles : ' + (cal && JSON.stringify(cal.styles)));
        check(cal && cal.links.length === 1 && cal.notes === 'refrain à 96' && cal.id === 'm5', 'A. la copie la plus riche (lien, notes) est conservée, avec ses données');
        check(!ch.exercises.some(e => /\(copie\)/.test(e.title)) && ch.exercises.filter(e => /Californication/.test(e.title)).length === 1, 'A. plus de « (copie) » ni de doublon');
        const exo = ch.exercises.find(e => e.songName === 'Exodus');
        check(exo && exo.artist === 'Bob Marley' && JSON.stringify(exo.styles) === JSON.stringify(['Reggae']), 'A. « Bob Marley - Exodus » : artiste lu dans le titre, style Reggae');
        const seven = ch.exercises.find(e => e.songName === 'Seven Nation Army');
        check(seven && seven.artist === '' && seven.title === 'Seven Nation Army', 'A. sans artiste connu : le titre seul');
        const st = await etat(page);
        const s1 = st.settings.guidedSessions[0];
        check(s1.steps.every(x => ch.exercises.some(e => e.id === x.exerciseId) || x.exerciseId === 't1'), 'A. les sessions pointent toujours vers un morceau existant');
        check(st.settings.statsRules && st.settings.statsRules.alias && st.settings.statsRules.alias.m1 === 'm5', 'A. l\'ancienne copie est reliée au morceau conservé pour les statistiques : ' + JSON.stringify(st.settings.statsRules && st.settings.statsRules.alias));
        check(!ch.exercises.some(e => e.linkId), 'A. la liaison entre copies n\'a plus d\'objet : retirée');
        const sauv = await page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.backups.v1') || localStorage.getItem('trainhub.backups') || '[]').length);
        const clesSauv = await page.evaluate(() => Object.keys(localStorage).filter(k => /backup/i.test(k)));
        check(clesSauv.length > 0, 'A. une sauvegarde de secours a été faite avant (' + clesSauv.join(', ') + ')');
        // l'autre chapitre et l'autre instrument sont intacts
        const tech = await chapitre(page, 'Technique');
        const guit = await chapitre(page, 'Morceaux', 'i2');
        check(tech.kind === undefined && tech.exercises.length === 2 && !tech.exercises[0].isSong, 'A. « Technique » (exercices) est intact');
        check(guit.kind === undefined && guit.exercises.length === 1 && guit.exercises[0].title === 'Solo de test', 'A. et le chapitre « Morceaux » de la Guitare (autre espace) n\'est pas touché');
        // arrivée sur la vue Styles (comme les dossiers d'origine)
        check((await dossiers(page)).join('|') === 'Rock|Funk|Reggae', 'A. la page s\'ouvre sur le rangement par style : ' + (await dossiers(page)).join('|'));
        check(erreurs.length === 0, 'A. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }


    // ============ B. Les rangements calculés ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { etat: etatMorceaux() });
        await ouvrirChapitre(page, 'Morceaux');
        check(await page.locator('.songs-view-btn').count() === 5, 'B. cinq rangements sous le titre : ' + (await page.locator('.songs-view-btn').allInnerTexts()).join(' / '));
        check(await page.locator('.songs-view-btn.on').getAttribute('data-view') === 'artist', 'B. ouverture sur « Artistes »');
        check((await dossiers(page)).join('|') === 'Red Hot Chili Peppers', 'B. Artistes : un dossier seulement pour l\'artiste qui a 2 morceaux ou plus : ' + (await dossiers(page)).join('|'));
        check((await titres(page)).join('|') === 'The Beatles - Come Together|Bob Marley - Exodus|Jaco Pastorius - Portrait of Tracy|Seven Nation Army', 'B. les autres morceaux restent à plat, « Artiste - Titre », A→Z (« The » ignoré) : ' + (await titres(page)).join('|'));
        check(/7 morceaux/.test(await page.locator('.songs-bar .ex-view-count').innerText()), 'B. le nombre de morceaux est indiqué');
        check((await enfantsArbre(page)).join('|') === 'Red Hot Chili Peppers', 'B. la barre latérale montre le même dossier sous « Morceaux »');
        // dans le dossier d'un artiste : toujours « Artiste - Titre »
        await page.locator('.song-folder-row', { hasText: 'Red Hot Chili Peppers' }).click(); await page.waitForTimeout(250);
        check((await page.locator('.crumb').allInnerTexts()).join('|') === 'Morceaux|Red Hot Chili Peppers', 'B. fil d\'Ariane : Morceaux › Red Hot Chili Peppers');
        const t3 = await titres(page);
        check(t3.length === 3 && t3.every(t => t.startsWith('Red Hot Chili Peppers - ')), 'B. dans le dossier de l\'artiste, la barre garde le format « Artiste - Titre » : ' + t3.join('|'));
        // un 2e morceau des Beatles : leur dossier se crée tout seul. Saisie en minuscules : la graphie existante est reprise.
        await page.locator('.crumb', { hasText: 'Morceaux' }).first().click(); await page.waitForTimeout(250);
        await page.fill('.add-song-artist', 'the beatles');
        await page.fill('.add-song-title', 'Help!');
        await page.press('.add-song-title', 'Enter'); await page.waitForTimeout(500);
        check((await dossiers(page)).join('|') === 'The Beatles|Red Hot Chili Peppers', 'B. le 2e morceau d\'un artiste crée son dossier tout seul : ' + (await dossiers(page)).join('|'));
        const ch1 = await chapitre(page, 'Morceaux'); await attendreSauvegarde(page);
        const help = (await chapitre(page, 'Morceaux')).exercises.find(e => e.songName === 'Help!');
        check(help && help.artist === 'The Beatles' && help.title === 'The Beatles - Help!', 'B. l\'artiste reprend la graphie existante (« the beatles » → « The Beatles ») : ' + (help && help.title));
        check(await page.locator('.toast', { hasText: 'Help!' }).count() === 1 && await page.locator('.toast .toast-action', { hasText: 'Voir' }).count() === 1, 'B. un message dit où il est rangé et propose « Voir »');
        // Styles
        await vue(page, 'style');
        check((await dossiers(page)).join('|') === 'Rock|Funk|Reggae|Sans style', 'B. Styles : ' + (await dossiers(page)).join('|'));
        check((await page.locator('.songs-wrap .song-folder-count').allInnerTexts()).join('|') === '4|2|1|2', 'B. avec le nombre de morceaux de chaque dossier : ' + (await page.locator('.songs-wrap .song-folder-count').allInnerTexts()).join('|'));
        check((await enfantsArbre(page)).join('|') === 'Rock|Funk|Reggae|Sans style' && (await comptesArbre(page)).join('|') === '4|2|1|2', 'B. la barre latérale suit : ' + (await enfantsArbre(page)).join('|') + ' ' + (await comptesArbre(page)).join('|'));
        await page.locator('.song-folder-row', { hasText: 'Funk' }).click(); await page.waitForTimeout(250);
        check((await titres(page)).join('|') === 'Red Hot Chili Peppers - Californication|Red Hot Chili Peppers - Give It Away', 'B. le dossier Funk : un morceau à plusieurs styles y est aussi (sans copie) : ' + (await titres(page)).join('|'));
        await page.screenshot({ path: path.join(SHOTS, 'morceaux_funk.png') });
        // Techniques, Travail, Tous
        await vue(page, 'technique');
        check((await dossiers(page)).join('|') === 'Slap|Médiator|Sans technique', 'B. Techniques : ' + (await dossiers(page)).join('|'));
        await vue(page, 'work');
        check((await dossiers(page)).join('|') === 'En cours|À maîtriser|Maîtrisé|Plus tard|À classer', 'B. Travail : ' + (await dossiers(page)).join('|'));
        await vue(page, 'all');
        check(await page.locator('.song-folder-row').count() === 0 && (await titres(page)).length === 8, 'B. Tous : les 8 morceaux à plat, sans dossier');
        check((await enfantsArbre(page)).length === 0, 'B. et sans sous-dossiers dans la barre latérale');
        // Tri
        await page.selectOption('.songs-sort', 'created-desc'); await page.waitForTimeout(250);
        check((await titres(page))[0] === 'The Beatles - Help!', 'B. tri « Ajoutés récemment » : le dernier ajouté d\'abord : ' + (await titres(page))[0]);
        await page.selectOption('.songs-sort', 'created-asc'); await page.waitForTimeout(250);
        check((await titres(page))[7] === 'The Beatles - Help!', 'B. tri « Ajoutés en premier » : le dernier ajouté à la fin');
        await page.selectOption('.songs-sort', 'az'); await page.waitForTimeout(250);
        const az = await titres(page);
        check(az[0] === 'The Beatles - Come Together' && az[1] === 'The Beatles - Help!' && az[2] === 'Bob Marley - Exodus', 'B. tri A → Z : ' + az.slice(0, 3).join('|'));
        // le choix est gardé après rechargement
        await page.reload(); await page.waitForTimeout(700);
        await ouvrirChapitre(page, 'Morceaux');
        check(await page.locator('.songs-view-btn.on').getAttribute('data-view') === 'all' && await page.locator('.songs-sort').inputValue() === 'az', 'B. le rangement et le tri choisis sont retenus');
        check(erreurs.length === 0, 'B. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ C. La fiche du morceau ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { etat: etatMorceaux() });
        await ouvrirChapitre(page, 'Morceaux');
        await vue(page, 'style');
        await page.locator('.song-folder-row', { hasText: 'Sans style' }).click(); await page.waitForTimeout(250);
        check((await titres(page)).join('|') === 'Jaco Pastorius - Portrait of Tracy', 'C. « Sans style » : le morceau à classer s\'y trouve');
        await ligneId(page, 'm9').click(); await page.waitForTimeout(300);
        check(await page.locator('.song-block').count() === 1 && await page.locator('.song-field-artist input').inputValue() === 'Jaco Pastorius' && await page.locator('.song-field-name input').inputValue() === 'Portrait of Tracy', 'C. la fiche montre l\'artiste et le titre dans deux champs');
        check((await page.locator('.song-block .song-line').count()) === 3, 'C. et trois lignes de caractéristiques : styles, techniques, travail');
        await page.locator('.song-block .song-line', { hasText: 'Styles' }).locator('.song-chip', { hasText: 'Rock' }).click(); await page.waitForTimeout(300);
        check(await page.locator('.song-block .song-chip.on', { hasText: 'Rock' }).count() === 1, 'C. un clic sur « Rock » : le style est donné');
        check(await barreId(page, 'm9').count() === 1, 'C. le morceau reste affiché dans « Sans style » le temps de finir de le classer (même si ce dossier est vide)');
        await page.locator('.song-block .song-line', { hasText: 'Styles' }).locator('.song-chip', { hasText: 'Funk' }).click(); await page.waitForTimeout(300);
        check(await page.locator('.song-block .song-line', { hasText: 'Styles' }).locator('.song-chip.on').count() === 2, 'C. deux styles à la fois');
        // travail : un seul à la fois
        const travail = page.locator('.song-block .song-line', { hasText: 'Travail' });
        await travail.locator('.song-chip', { hasText: 'En cours' }).click(); await page.waitForTimeout(250);
        await travail.locator('.song-chip', { hasText: 'Maîtrisé' }).click(); await page.waitForTimeout(250);
        check(await travail.locator('.song-chip.on').count() === 1 && await travail.locator('.song-chip.on').innerText() === 'Maîtrisé', 'C. Travail : une seule valeur (la dernière choisie)');
        await travail.locator('.song-chip', { hasText: 'Maîtrisé' }).click(); await page.waitForTimeout(250);
        check(await travail.locator('.song-chip.on').count() === 0, 'C. un 2e clic la retire');
        // nouvelle valeur depuis la fiche
        await page.locator('.song-block .song-line', { hasText: 'Techniques' }).locator('.song-chip-add').click();
        await page.waitForSelector('.dlg-input, .app-dialog input');
        await page.keyboard.type('Walking'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
        await attendreSauvegarde(page);
        let ch = await chapitre(page, 'Morceaux'), jaco = ch.exercises.find(e => e.id === 'm9');
        check(ch.vocab.techniques.includes('Walking') && jaco.techniques.includes('Walking') && jaco.styles.join() === 'Rock,Funk', 'C. « ＋ » crée la technique « Walking » et la donne au morceau : ' + JSON.stringify({ t: jaco.techniques, s: jaco.styles }));
        // renommer par les champs
        await page.locator('.song-field-name input').fill('Portrait Of Tracy (live)'); await page.locator('.song-field-name input').press('Enter'); await page.waitForTimeout(500);
        check(await barreId(page, 'm9').inputValue() === 'Jaco Pastorius - Portrait Of Tracy (live)', 'C. le titre de la barre suit : « Artiste - Titre »');
        await page.locator('.song-field-artist input').fill('jaco pastorius'); await page.locator('.song-field-artist input').press('Enter'); await page.waitForTimeout(500);
        check(await page.locator('.song-field-artist input').inputValue() === 'Jaco Pastorius', 'C. l\'artiste saisi autrement (casse) reprend la graphie connue');
        // titre saisi dans la barre
        const barre = barreId(page, 'm9');
        await barre.fill('Weather Report - Birdland'); await barre.press('Enter'); await page.waitForTimeout(500);
        await attendreSauvegarde(page);
        jaco = (await chapitre(page, 'Morceaux')).exercises.find(e => e.id === 'm9');
        check(jaco.artist === 'Weather Report' && jaco.songName === 'Birdland' && jaco.title === 'Weather Report - Birdland', 'C. « Artiste - Titre » tapé dans la barre : artiste et titre retrouvés : ' + jaco.title);
        // un titre déjà pris : confirmation
        await page.locator('.song-field-artist input').fill('Bob Marley'); await page.locator('.song-field-artist input').press('Enter'); await page.waitForTimeout(500);
        await page.locator('.song-field-name input').fill('Exodus'); await page.locator('.song-field-name input').press('Enter'); await page.waitForTimeout(500);
        check(await page.locator('.app-dialog').count() === 1 && /existe déjà|déjà/.test(await page.locator('.app-dialog').innerText()), 'C. un titre déjà pris demande confirmation : ' + (await page.locator('.app-dialog').innerText().catch(() => '—')).slice(0, 80).replace(/\n/g, ' '));
        await page.locator('.app-dialog button', { hasText: 'Annuler' }).click(); await page.waitForTimeout(300);
        check(await barreId(page, 'm9').inputValue() === 'Bob Marley - Birdland', 'C. « Annuler » : rien ne change (le titre reste « Bob Marley - Birdland »)');
        check(erreurs.length === 0, 'C. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ D. Ajouter un morceau depuis un dossier ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { etat: etatMorceaux() });
        await ouvrirChapitre(page, 'Morceaux');
        await vue(page, 'style');
        await page.locator('.song-folder-row', { hasText: 'Funk' }).click(); await page.waitForTimeout(250);
        await page.fill('.add-song-artist', 'Herbie Hancock'); await page.fill('.add-song-title', 'Chameleon'); await page.press('.add-song-title', 'Enter'); await page.waitForTimeout(500);
        check((await titres(page)).includes('Herbie Hancock - Chameleon'), 'D. ajouté depuis le dossier « Funk » : il s\'y trouve aussitôt');
        await attendreSauvegarde(page);
        let cham = (await chapitre(page, 'Morceaux')).exercises.find(e => e.songName === 'Chameleon');
        check(cham && cham.styles.join() === 'Funk' && cham.isSong === true && cham.createdAt > 0, 'C. (D) il reçoit le style du dossier où on l\'ajoute : ' + (cham && JSON.stringify(cham.styles)));
        check(await page.locator('.add-song-artist').inputValue() === 'Herbie Hancock' && await page.locator('.add-song-title').inputValue() === '', 'D. l\'artiste reste dans la case pour enchaîner ses morceaux, le titre est vidé');
        await page.fill('.add-song-title', 'Watermelon Man'); await page.press('.add-song-title', 'Enter'); await page.waitForTimeout(500);
        check((await titres(page)).includes('Herbie Hancock - Watermelon Man'), 'D. 2e morceau du même artiste, sans retaper l\'artiste');
        // tout dans la case « Artiste » : « Artiste - Titre »
        await page.fill('.add-song-artist', 'Stevie Wonder - Superstition'); await page.press('.add-song-title', 'Enter'); await page.waitForTimeout(500);
        check((await titres(page)).includes('Stevie Wonder - Superstition'), 'D. « Artiste - Titre » collé dans la case Artiste : séparé tout seul');
        // dans un dossier d'artiste : l'artiste est déjà rempli
        await vue(page, 'artist');
        await page.locator('.song-folder-row', { hasText: 'Herbie Hancock' }).click(); await page.waitForTimeout(250);
        check(await page.locator('.add-song-artist').inputValue() === 'Herbie Hancock', 'D. dans le dossier d\'un artiste, la case Artiste est déjà remplie');
        // titre déjà pris
        await page.fill('.add-song-title', 'Chameleon'); await page.press('.add-song-title', 'Enter'); await page.waitForTimeout(400);
        check(await page.locator('.app-dialog').count() === 1, 'D. un morceau déjà présent (même artiste et titre) demande confirmation');
        await page.locator('.app-dialog button', { hasText: 'Annuler' }).click(); await page.waitForTimeout(250);
        // ajout depuis la racine d'un rangement par style : il tombe dans « Sans style » avec « Voir »
        await vue(page, 'style');
        await page.fill('.add-song-artist', 'Nirvana'); await page.fill('.add-song-title', 'Come as You Are'); await page.press('.add-song-title', 'Enter'); await page.waitForTimeout(500);
        const voir = page.locator('.toast .toast-action', { hasText: 'Voir' });
        check(await voir.count() === 1 && /Sans style/.test(await page.locator('.toast').innerText()), 'D. depuis la page des styles : « rangé dans Sans style », avec « Voir » : ' + (await page.locator('.toast').innerText()).replace(/\n/g, ' '));
        await voir.click(); await page.waitForTimeout(400);
        check((await page.locator('.crumb').allInnerTexts()).join('|') === 'Morceaux|Sans style' && await page.locator('.song-block').count() === 1, 'D. « Voir » ouvre le dossier et la fiche du morceau, prête à classer');
        check(erreurs.length === 0, 'D. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ E. Gérer les dossiers calculés : renommer, ordonner, fusionner, supprimer ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { etat: etatMorceaux() });
        await ouvrirChapitre(page, 'Morceaux');
        await vue(page, 'style');
        // renommer un style
        await page.locator('.song-folder-row', { hasText: 'Rock' }).click({ button: 'right' });
        check(await page.locator('.ctx-item', { hasText: 'Renommer' }).count() === 1 && await page.locator('.ctx-item', { hasText: 'Monter' }).count() === 1 && await page.locator('.ctx-item', { hasText: 'Supprimer' }).count() === 1, 'E. clic droit sur un dossier : renommer, monter, descendre, supprimer');
        await page.locator('.ctx-item', { hasText: 'Renommer' }).click();
        await page.waitForSelector('.app-dialog input');
        await page.fill('.app-dialog input', 'Rock & Pop'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
        await attendreSauvegarde(page);
        let ch = await chapitre(page, 'Morceaux');
        check(ch.vocab.styles[0] === 'Rock & Pop' && ch.exercises.filter(e => e.styles.includes('Rock & Pop')).length === 4 && !ch.exercises.some(e => e.styles.includes('Rock')), 'E. le nouveau nom s\'applique aux 4 morceaux concernés : ' + JSON.stringify(ch.vocab.styles));
        check((await enfantsArbre(page))[0] === 'Rock & Pop', 'E. et à la barre latérale');
        // monter / descendre
        await page.locator('.song-folder-row', { hasText: 'Reggae' }).click({ button: 'right' });
        await page.locator('.ctx-item', { hasText: 'Monter' }).click(); await page.waitForTimeout(400);
        check((await dossiers(page)).join('|') === 'Rock & Pop|Reggae|Funk|Sans style', 'E. « Monter » : l\'ordre des dossiers change : ' + (await dossiers(page)).join('|'));
        await page.locator('.song-folder-row', { hasText: 'Rock & Pop' }).click({ button: 'right' });
        check(await page.locator('.ctx-item', { hasText: 'Monter' }).isDisabled(), 'E. le premier dossier ne peut pas monter');
        await page.keyboard.press('Escape');
        // fusion : renommer « Reggae » en « Funk »
        await page.locator('.song-folder-row', { hasText: 'Reggae' }).click({ button: 'right' });
        await page.locator('.ctx-item', { hasText: 'Renommer' }).click();
        await page.waitForSelector('.app-dialog input');
        await page.fill('.app-dialog input', 'funk'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
        await attendreSauvegarde(page);
        ch = await chapitre(page, 'Morceaux');
        const exo = ch.exercises.find(e => e.id === 'm8');
        check(ch.vocab.styles.filter(v => v === 'Funk').length === 1 && !ch.vocab.styles.includes('Reggae') && exo.styles.join() === 'Funk', 'E. renommer en un nom déjà pris fusionne les deux dossiers : ' + JSON.stringify(ch.vocab.styles) + ' ' + JSON.stringify(exo.styles));
        // supprimer + annuler
        await page.locator('.song-folder-row', { hasText: 'Funk' }).click({ button: 'right' });
        await page.locator('.ctx-item', { hasText: 'Supprimer' }).click();
        await page.waitForSelector('.app-dialog');
        check(/perd/.test(await page.locator('.app-dialog').innerText()), 'E. supprimer une valeur prévient du nombre de morceaux concernés');
        await page.locator('.app-dialog button', { hasText: 'Supprimer' }).click(); await page.waitForTimeout(500);
        ch = await chapitre(page, 'Morceaux'); await attendreSauvegarde(page); ch = await chapitre(page, 'Morceaux');
        check(!ch.vocab.styles.includes('Funk') && ch.exercises.length === 7 && ch.exercises.every(e => !e.styles.includes('Funk')), 'E. la valeur disparaît, aucun morceau n\'est supprimé');
        await page.locator('.toast .toast-action', { hasText: 'Annuler' }).click(); await page.waitForTimeout(600);
        ch = await chapitre(page, 'Morceaux');
        check(ch.vocab.styles.includes('Funk') && ch.exercises.filter(e => e.styles.includes('Funk')).length === 3, 'E. « Annuler » remet le dossier et ses morceaux');
        // nouveau style depuis la page
        await page.locator('.song-add-value').click();
        await page.waitForSelector('.app-dialog input');
        await page.fill('.app-dialog input', 'Soul'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
        check((await dossiers(page)).includes('Soul') && (await page.locator('.song-folder-row', { hasText: 'Soul' }).locator('.song-folder-count').innerText()) === '0', 'E. « ＋ Nouveau style » crée un dossier vide');
        // renommer un artiste
        await vue(page, 'artist');
        await page.locator('.song-folder-row', { hasText: 'Red Hot Chili Peppers' }).click({ button: 'right' });
        check(await page.locator('.ctx-item', { hasText: 'Monter' }).count() === 0 && await page.locator('.ctx-item', { hasText: 'Supprimer' }).count() === 0, 'E. un dossier d\'artiste : seulement « Renommer » (il est calculé)');
        await page.locator('.ctx-item', { hasText: 'Renommer' }).click();
        await page.waitForSelector('.app-dialog input');
        await page.fill('.app-dialog input', 'RHCP'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
        await attendreSauvegarde(page);
        ch = await chapitre(page, 'Morceaux');
        check(ch.exercises.filter(e => e.artist === 'RHCP').length === 3 && ch.exercises.find(e => e.id === 'm1').title === 'RHCP - Californication', 'E. renommer un artiste met à jour ses morceaux et leurs titres');
        check(erreurs.length === 0, 'E. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ F. Recherche, sélection multiple, archivés, retour en arrière ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { etat: etatMorceaux() });
        await ouvrirChapitre(page, 'Morceaux');
        await page.click('#search-toggle-btn');
        await page.fill('#search-input', 'funk'); await page.waitForTimeout(400);
        const res = await page.locator('.result-item .exercise-title').evaluateAll(els => els.map(e => e.value));
        check(res.length === 2 && res.every(t => /Red Hot Chili Peppers - (Californication|Give It Away)/.test(t)), 'F. la recherche « funk » trouve les morceaux de style Funk : ' + res.join('|'));
        await page.locator('.result-item .exercise-row').first().click({ button: 'right' });
        await page.locator('.ctx-item', { hasText: 'Ouvrir dans son dossier' }).click(); await page.waitForTimeout(500);
        check((await page.locator('.crumb').allInnerTexts()).join('|') === 'Morceaux|Red Hot Chili Peppers' && await page.locator('.exercise:not(.collapsed)').count() === 1, 'F. « Ouvrir dans son dossier » (depuis la recherche) mène au dossier de l\'artiste, morceau ouvert : ' + (await page.locator('.crumb').allInnerTexts()).join('|'));
        await page.fill('#search-input', 'beatles'); await page.waitForTimeout(300);
        check((await page.locator('.result-item .exercise-title').evaluateAll(els => els.map(e => e.value))).join('|') === 'The Beatles - Come Together', 'F. et par artiste');
        await page.click('#search-close-btn'); await page.waitForTimeout(300);
        await ouvrirChapitre(page, 'Morceaux');
        // sélection multiple → style
        await vue(page, 'all');
        await page.locator('.exercise[data-ex-id="m4"] .exercise-row-spacer').click({ modifiers: ['Control'] });
        await page.locator('.exercise[data-ex-id="m8"] .exercise-row-spacer').click({ modifiers: ['Control'] });
        await page.waitForTimeout(300);
        const barre = page.locator('.ex-sel-bar button, .ex-selbar button, [class*="sel-bar"] button', { hasText: 'Style…' });
        check(await barre.count() >= 1, 'F. deux morceaux sélectionnés : l\'action « Style… » est proposée');
        if (await barre.count()) {
            await barre.first().click();
            await page.locator('.ctx-item', { hasText: 'Funk' }).click(); await page.waitForTimeout(500);
            await attendreSauvegarde(page);
            const ch = await chapitre(page, 'Morceaux');
            check(ch.exercises.find(e => e.id === 'm4').styles.includes('Funk') && ch.exercises.find(e => e.id === 'm8').styles.includes('Funk'), 'F. « Funk » ajouté aux deux morceaux d\'un coup');
        } else check(false, 'F. (action absente)');
        // archiver : le morceau sort des rangements (on repart d'une page sans sélection)
        await page.reload(); await page.waitForTimeout(700); await ouvrirChapitre(page, 'Morceaux');
        await page.locator('.exercise[data-ex-id="m8"] .exercise-row').click({ button: 'right' });
        check(await page.locator('.ctx-item', { hasText: 'Dupliquer' }).count() === 0 && await page.locator('.ctx-item', { hasText: 'Liaison' }).count() === 0 && await page.locator('.ctx-item', { hasText: 'Lier' }).count() === 0, 'F. un morceau ne se duplique pas et ne se lie pas : pas de « Dupliquer » ni de « Liaison »');
        check(await page.locator('.ctx-item', { hasText: 'Classer' }).count() === 1, 'F. mais « Classer : style, technique, travail… » est proposé');
        await page.locator('.ctx-item', { hasText: 'Archiver' }).click(); await page.waitForTimeout(400);
        check((await titres(page)).length === 6 && !(await titres(page)).includes('Bob Marley - Exodus'), 'F. archivé : il quitte les rangements');
        await page.locator('.tree-node > .tree-row', { hasText: 'Archivés' }).first().click(); await page.waitForTimeout(300);
        check((await page.locator('.exercise-title').evaluateAll(els => els.map(e => e.value))).includes('Bob Marley - Exodus'), 'F. et se retrouve dans « Archivés »');
        // revenir à un chapitre ordinaire
        await ouvrirChapitre(page, 'Morceaux');
        await page.locator('.tree-node > .tree-row', { hasText: 'Morceaux' }).first().click({ button: 'right' });
        check(await page.locator('.ctx-item', { hasText: 'Nouveau sous-dossier' }).count() === 0, 'F. un chapitre de morceaux n\'a pas de « Nouveau sous-dossier » (les dossiers sont calculés)');
        await page.locator('.ctx-item', { hasText: 'Revenir à un chapitre ordinaire' }).click();
        await page.waitForSelector('.app-dialog');
        await page.locator('.app-dialog button', { hasText: 'Revenir' }).click(); await page.waitForTimeout(500);
        await attendreSauvegarde(page);
        const ord = await chapitre(page, 'Morceaux');
        check(ord.kind === undefined && ord.exercises.length === 7 && ord.exercises.every(e => !e.isSong), 'F. retour à un chapitre ordinaire : les 7 morceaux restent, sans rangements');
        check(await page.locator('.songs-view-btn').count() === 0, 'F. plus d\'icônes de rangement');
        check(erreurs.length === 0, 'F. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ G. Téléphone ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { etat: etatMorceaux(), viewport: { width: 390, height: 800 } });
        await page.locator('.chapter-chip', { hasText: 'Morceaux' }).click(); await page.waitForTimeout(300);
        await vue(page, 'style');
        const sc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        check(sc.sw <= sc.cw + 1, 'G. téléphone : pas de défilement horizontal (' + sc.sw + ' / ' + sc.cw + ')');
        check((await dossiers(page)).join('|') === 'Rock|Funk|Reggae|Sans style', 'G. les dossiers calculés sont dans la page (pas de barre latérale sur téléphone)');
        await page.screenshot({ path: path.join(SHOTS, 'morceaux_tel.png') });
        check(erreurs.length === 0, 'G. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ H. Choisir un morceau pour une session ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { etat: etatMorceaux() });
        await page.click('#guided-session-btn');
        await page.waitForSelector('.gs-session-row');
        await page.locator('.gs-session-name').first().click();
        await page.waitForSelector('.gs-edit-topbar');
        await page.locator('button', { hasText: /^\+ Ajouter un exercice$/ }).first().click();
        await page.waitForSelector('.gs-pick-tabs');
        check(await page.locator('.gs-pick-tree .songs-views-pick').count() === 0, 'H. au départ le choix est replié : les rangements n\'apparaissent qu\'une fois le chapitre « Morceaux » ouvert');
        await page.locator('.gs-pick-tree > .gs-pick-node', { hasText: 'Morceaux' }).first().locator(':scope > .gs-pick-tree-row').click(); await page.waitForTimeout(250);
        check(await page.locator('.gs-pick-tree .songs-views-pick').count() === 1 && await page.locator('.gs-pick-tree .songs-views-pick .songs-view-btn').count() === 5, 'H. le choix d\'exercice de la session montre les cinq rangements sous « Morceaux » (et seulement là)');
        check(await page.locator('.gs-pick-tree .songs-views-pick .songs-view-btn.on').getAttribute('data-view') === 'artist', 'H. le rangement est celui de la bibliothèque (Artistes)');
        check(await page.locator('.gs-pick-songgroup').count() === 1 && (await page.locator('.gs-pick-songgroup .tree-label').innerText()) === 'Red Hot Chili Peppers' && await page.locator('.gs-pick-songgroup .gs-pick-exercise-row').count() === 0, 'H. Artistes : le dossier de l\'artiste est replié au départ');
        const loose = await page.locator('.gs-pick-node', { hasText: 'Morceaux' }).first().locator(':scope > .gs-pick-tree-children > .gs-pick-exercise-row .gs-pick-ex-title').allInnerTexts();
        check(loose.join('|') === 'The Beatles - Come Together|Bob Marley - Exodus|Jaco Pastorius - Portrait of Tracy|Seven Nation Army', 'H. et les morceaux seuls de leur artiste sont listés dessous : ' + loose.join('|'));
        await page.locator('.gs-pick-songgroup .gs-pick-tree-row').click(); await page.waitForTimeout(250);
        const dansDossier = await page.locator('.gs-pick-songgroup .gs-pick-exercise-row .gs-pick-ex-title').allInnerTexts();
        check(dansDossier.length === 3 && dansDossier.every(t => t.startsWith('Red Hot Chili Peppers - ')), 'H. un clic ouvre le dossier : « Artiste - Titre » : ' + dansDossier.join('|'));
        await page.locator('.gs-pick-tree .songs-view-btn[data-view="style"]').click(); await page.waitForTimeout(250);
        check((await page.locator('.gs-pick-songgroup .tree-label').allInnerTexts()).join('|') === 'Rock|Funk|Reggae|Sans style', 'H. Styles : ' + (await page.locator('.gs-pick-songgroup .tree-label').allInnerTexts()).join('|'));
        await page.locator('.gs-pick-songgroup', { hasText: 'Reggae' }).locator('.gs-pick-tree-row').click(); await page.waitForTimeout(250);
        await page.locator('.gs-pick-songgroup', { hasText: 'Reggae' }).locator('.gs-pick-exercise-row', { hasText: 'Exodus' }).click(); await page.waitForTimeout(400);
        await page.locator('.gs-pick-done').click(); await page.waitForTimeout(400); // ajout en rafale : « Terminer » revient à la session
        check(await page.locator('.gs-step-row').count() === 2 && /Bob Marley - Exodus/.test(await page.locator('.gs-step-row').nth(1).innerText()), 'H. un clic sur un morceau l\'ajoute à la session : « Artiste - Titre »');
        // recherche : par artiste ou style
        await page.locator('button', { hasText: /^\+ Ajouter un exercice$/ }).first().click();
        await page.waitForSelector('.gs-pick-tabs');
        await page.fill('.gs-pick-search', 'jaco'); await page.waitForTimeout(250);
        check(await page.locator('.gs-pick-result').count() === 1, 'H. recherche « jaco » : le morceau de Jaco Pastorius');
        await page.fill('.gs-pick-search', 'reggae'); await page.waitForTimeout(250);
        check(await page.locator('.gs-pick-result').count() === 1 && /Exodus/.test(await page.locator('.gs-pick-result').innerText()), 'H. recherche « reggae » : par style');
        // fenêtre « Remplacer partout par… »
        await page.locator('.gs-back-btn').click(); await page.waitForTimeout(300);
        await page.locator('.gs-step-row').first().click({ button: 'right' });
        await page.locator('.ctx-menu >> text=Remplacer partout par').first().click();
        await page.waitForSelector('.exercise-picker-panel .gs-pick-tabs');
        check(await page.locator('.exercise-picker-panel .songs-views-pick').count() === 1, 'H. le chapitre « Morceaux » ouvert dans le choix précédent reste ouvert dans la fenêtre « Remplacer partout par… » (état retenu)');
        check(await page.locator('.exercise-picker-panel .songs-views-pick .songs-view-btn').count() === 5, 'H. la fenêtre « Remplacer partout par… » a les mêmes rangements');
        await page.locator('.exercise-picker-panel .songs-view-btn[data-view="work"]').click(); await page.waitForTimeout(250);
        check((await page.locator('.exercise-picker-panel .gs-pick-songgroup .tree-label').allInnerTexts()).join('|') === 'En cours|À maîtriser|Maîtrisé|Plus tard|À classer', 'H. Travail dans la fenêtre : ' + (await page.locator('.exercise-picker-panel .gs-pick-songgroup .tree-label').allInnerTexts()).join('|'));
        await page.screenshot({ path: path.join(SHOTS, 'morceaux_choix_session.png') });
        check(erreurs.length === 0, 'H. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ I. Autres transformations : chapitre sans dossiers, et choix d'une autre correspondance des dossiers ============
    {
        // I1 : « Technique » n'a pas de sous-dossier : confirmation simple, ses exercices deviennent des morceaux
        const a = await ouvrir(browser);
        await a.page.locator('.tree-node > .tree-row', { hasText: 'Technique' }).first().click({ button: 'right' });
        await a.page.locator('.ctx-item', { hasText: 'Transformer en chapitre de morceaux' }).click();
        await a.page.waitForSelector('.app-dialog');
        check(await a.page.locator('.songs-convert-panel').count() === 0 && /sans dossiers ni copies/.test(await a.page.locator('.app-dialog').innerText()), 'I. un chapitre sans sous-dossier : simple confirmation (pas de choix de correspondance)');
        await a.page.locator('.app-dialog button', { hasText: 'Transformer' }).click(); await a.page.waitForTimeout(500);
        await attendreSauvegarde(a.page);
        const tech = await chapitre(a.page, 'Technique');
        check(tech.kind === 'songs' && tech.exercises.length === 2 && tech.exercises.every(e => e.isSong && e.artist === '') && JSON.stringify(tech.vocab.work) === JSON.stringify(['En cours', 'À maîtriser', 'Maîtrisé', 'Plus tard']) && tech.vocab.styles.length === 0, 'I. ses 2 exercices deviennent des morceaux ; travail : En cours / À maîtriser / Maîtrisé / Plus tard ; aucun style imposé');
        check(await a.page.locator('.songs-view-btn.on').getAttribute('data-view') === 'artist', 'I. ouverture sur « Artistes »');
        check(a.erreurs.length === 0, 'I. aucune erreur JavaScript ' + JSON.stringify(a.erreurs));
        await a.ctx.close();
        // I2 : premier niveau = Techniques, deuxième niveau = Travail
        const b = await ouvrir(browser);
        await ouvrirChapitre(b.page, 'Morceaux');
        await transformer(b.page, { l1: 'technique', l2: 'work' });
        const sum = await b.page.locator('.songs-convert-sum').innerText();
        check(/3 techniques/.test(sum) && !/styles/.test(sum), 'I. correspondance changée (1er niveau = Techniques) : l\'aperçu suit : ' + sum);
        await b.page.click('.songs-convert-foot .btn-accent'); await b.page.waitForTimeout(500); await attendreSauvegarde(b.page);
        const ch2 = await chapitre(b.page, 'Morceaux');
        const cal = ch2.exercises.find(e => e.songName === 'Californication');
        check(JSON.stringify(ch2.vocab.techniques) === JSON.stringify(['Rock', 'Funk', 'Reggae']) && ch2.vocab.styles.length === 0 && cal.techniques.join() === 'Rock,Funk' && cal.work === 'Red Hot Chili Peppers', 'I. les noms de dossiers vont dans les techniques (1er niveau) et le travail (2e) : ' + JSON.stringify({ t: ch2.vocab.techniques, w: cal.work }));
        check(await b.page.locator('.songs-view-btn.on').getAttribute('data-view') === 'technique', 'I. la page s\'ouvre sur le rangement qui correspond au 1er niveau');
        // annuler la transformation (« Annuler » du message) : le chapitre est de nouveau comme avant, avec ses dossiers
        await b.page.locator('.toast .toast-action', { hasText: 'Annuler' }).click(); await b.page.waitForTimeout(600); await attendreSauvegarde(b.page);
        const avant = await chapitre(b.page, 'Morceaux');
        check(avant.kind === undefined && avant.folders.length === 3 && avant.exercises.length === 0, 'I. « Annuler » : le chapitre retrouve ses dossiers (Rock, Funk, Reggae)');
        const s2 = await etat(b.page);
        check(s2.settings.guidedSessions[0].steps.map(x => x.exerciseId).join() === 'm5,m3,t1', 'I. et les sessions retrouvent leurs morceaux d\'origine : ' + s2.settings.guidedSessions[0].steps.map(x => x.exerciseId).join());
        check(b.erreurs.length === 0, 'I. aucune erreur JavaScript ' + JSON.stringify(b.erreurs));
        await b.ctx.close();
    }

    // ============ J. Une note de musique devant le nom d'un chapitre de morceaux ============
    {
        const a = await ouvrir(browser, { etat: etatMorceaux() });
        const n = await a.page.evaluate(() => ({ morceaux: !!Array.from(document.querySelectorAll('.tree-node > .tree-row')).find(r => /Morceaux/.test(r.textContent)).querySelector('.tree-songs-icon svg'), autres: Array.from(document.querySelectorAll('.tree-node > .tree-row')).filter(r => !/Morceaux|Favoris|Archivés/.test(r.textContent)).filter(r => r.querySelector('.tree-songs-icon')).length }));
        check(n.morceaux && n.autres === 0, 'J. barre latérale : le chapitre de morceaux porte une note de musique, pas les chapitres classiques');
        const avant = await a.page.locator('.tree-node > .tree-row', { hasText: 'Morceaux' }).first().evaluate(r => r.querySelector('.tree-label').getBoundingClientRect().left - r.getBoundingClientRect().left);
        check(avant > 20, 'J. l\'icône précède le nom (nom décalé de ' + Math.round(avant) + ' px)');
        check(a.erreurs.length === 0, 'J. aucune erreur JavaScript ' + JSON.stringify(a.erreurs));
        await a.ctx.close();
        const m = await ouvrir(browser, { etat: etatMorceaux(), viewport: { width: 390, height: 800 } });
        check(await m.page.locator('.chapter-chip', { hasText: 'Morceaux' }).locator('.chapter-chip-songs svg').count() === 1, 'J. téléphone : la puce du chapitre de morceaux porte la note de musique');
        const classiques = await m.page.locator('.chapter-chip:not(.virtual-favorites):not(.virtual-archived):not(:has-text("Morceaux")) .chapter-chip-songs').count();
        check(classiques === 0, 'J. téléphone : pas d\'icône sur les chapitres classiques');
        await m.ctx.close();
    }

    // ============ K. Menu d'un exercice : « Transformer en morceau… » ============
    {
        const a = await ouvrir(browser, { etat: etatMorceaux() });
        await a.page.locator('.tree-node > .tree-row', { hasText: 'Technique' }).first().click(); await a.page.waitForTimeout(300);
        await a.page.locator('.exercise[data-ex-id="t1"] .exercise-row').click({ button: 'right' }); await a.page.waitForTimeout(250);
        const items = await a.page.locator('.ctx-menu .ctx-item').allTextContents();
        check(items.some(t => /Transformer en morceau/.test(t)), 'K. le menu d\'un exercice ordinaire propose « Transformer en morceau… »');
        await a.page.locator('.ctx-item', { hasText: 'Transformer en morceau' }).click(); await a.page.waitForTimeout(300);
        check(await a.page.locator('.app-dialog-input').inputValue() === 'Gamme lente', 'K. le titre actuel est proposé dans la saisie « Artiste - Titre »');
        await a.page.locator('.app-dialog-input').fill('Jamiroquai - Whatever it is');
        await a.page.getByRole('button', { name: 'Transformer' }).click(); await a.page.waitForTimeout(700); await attendreSauvegarde(a.page);
        const ch = await chapitre(a.page, 'Morceaux'), tech = await chapitre(a.page, 'Technique');
        const m = ch.exercises.find(e => e.id === 't1');
        check(!!m && m.isSong === true && m.artist === 'Jamiroquai' && m.songName === 'Whatever it is' && m.title === 'Jamiroquai - Whatever it is', 'K. l\'exercice est maintenant un morceau « Artiste - Titre » rangé dans le chapitre de morceaux');
        check(!tech.exercises.some(e => e.id === 't1') && tech.exercises.length === 1, 'K. et il n\'est plus dans l\'ancien chapitre');
        await a.page.locator('.exercise[data-ex-id="t2"] .exercise-row').click({ button: 'right' }).catch(() => {});
        await a.page.keyboard.press('Escape');
        await a.page.locator('.toast .toast-action', { hasText: 'Annuler' }).click().catch(() => {}); await a.page.waitForTimeout(600); await attendreSauvegarde(a.page);
        const tech2 = await chapitre(a.page, 'Technique');
        check(tech2.exercises.some(e => e.id === 't1' && !e.isSong && e.title === 'Gamme lente'), 'K. « Annuler » le remet comme avant (exercice ordinaire, titre d\'origine)');
        check(a.erreurs.length === 0, 'K. aucune erreur JavaScript ' + JSON.stringify(a.erreurs));
        await a.ctx.close();
        // sans chapitre de morceaux
        const b = await ouvrir(browser, { etat: etatDepart() });
        await b.page.locator('.tree-node > .tree-row', { hasText: 'Technique' }).first().click(); await b.page.waitForTimeout(300);
        await b.page.locator('.exercise[data-ex-id="t1"] .exercise-row').click({ button: 'right' });
        await b.page.locator('.ctx-item', { hasText: 'Transformer en morceau' }).click(); await b.page.waitForTimeout(300);
        const btns = await b.page.locator('.app-dialog button').allTextContents();
        check(btns.some(t => /Transformer « Morceaux »/.test(t)) && btns.some(t => /Créer un chapitre de morceaux/.test(t)), 'K. sans chapitre de morceaux : on propose de transformer « Morceaux » ou d\'en créer un (' + btns.join(' | ') + ')');
        await b.page.getByRole('button', { name: 'Créer un chapitre de morceaux' }).click(); await b.page.waitForTimeout(400);
        await b.page.locator('.app-dialog-input').fill('Jamiroquai - Whatever it is');
        await b.page.getByRole('button', { name: 'Transformer' }).click(); await b.page.waitForTimeout(700); await attendreSauvegarde(b.page);
        const st = await etat(b.page), cats = st.instruments[0].categories, nouveau = cats.find(c => c.kind === 'songs');
        check(!!nouveau && nouveau.name === 'Mes morceaux' && nouveau.exercises.length === 1 && nouveau.exercises[0].artist === 'Jamiroquai', 'K. un nouveau chapitre « Mes morceaux » (« Morceaux » est pris) contient le morceau');
        check(await b.page.locator('.tree-node > .tree-row', { hasText: 'Mes morceaux' }).locator('.tree-songs-icon').count() === 1, 'K. et il porte la note de musique');
        check(b.erreurs.length === 0, 'K. aucune erreur JavaScript ' + JSON.stringify(b.erreurs));
        await b.ctx.close();
    }

    // ============ L. Artistes regroupés (2 morceaux ou plus) dans les dossiers de style, technique, travail ============
    {
        const a = await ouvrir(browser, { etat: etatMorceaux() });
        await ouvrirChapitre(a.page, 'Morceaux');
        await vue(a.page, 'style');
        await a.page.locator('.songs-wrap .song-folder-row', { hasText: 'Rock' }).first().click(); await a.page.waitForTimeout(400);
        const blocs = () => a.page.locator('.song-artist-block');
        check(await blocs().count() === 1 && /Red Hot Chili Peppers/.test(await blocs().first().locator('.song-artist-head').innerText()), 'L. style « Rock » : les 2 morceaux des Red Hot Chili Peppers sont regroupés sous leur nom');
        check(/2 morceaux/.test(await blocs().first().locator('.song-artist-count').innerText()) && await blocs().first().locator('.exercise').count() === 2, 'L. le bloc affiche « 2 morceaux » et contient ces 2 morceaux');
        check(await a.page.locator('.songs-wrap > .exercises-wrap > .exercise').count() === 2, 'L. les morceaux d\'artistes à un seul morceau (Beatles, sans artiste) restent à plat');
        const ordre = await a.page.locator('.songs-wrap .exercise-title').evaluateAll(els => els.map(e => e.value));
        check(ordre.join('|') === 'The Beatles - Come Together|Red Hot Chili Peppers - Californication|Red Hot Chili Peppers - Under the Bridge|Seven Nation Army', 'L. l\'ordre du tri est respecté (le bloc prend la place de son premier morceau) : ' + ordre.join(' | '));
        await blocs().first().locator('.song-artist-head').click(); await a.page.waitForTimeout(200);
        check(await blocs().first().locator('.song-artist-list').isHidden(), 'L. un clic sur le nom replie le bloc');
        await a.page.reload(); await a.page.waitForTimeout(800);
        await ouvrirChapitre(a.page, 'Morceaux');
        await a.page.locator('.songs-wrap .song-folder-row', { hasText: 'Rock' }).first().click(); await a.page.waitForTimeout(400);
        check(await a.page.locator('.song-artist-block').count() === 1 && await a.page.locator('.song-artist-block .song-artist-list').isHidden(), 'L. le pli est retenu après un rechargement');
        await a.page.locator('.song-artist-head').click(); await a.page.waitForTimeout(200);
        await vue(a.page, 'technique');
        await a.page.locator('.songs-wrap .song-folder-row', { hasText: 'Slap' }).first().click(); await a.page.waitForTimeout(400);
        check(await a.page.locator('.song-artist-block').count() === 1 && await a.page.locator('.song-artist-block .exercise').count() === 2, 'L. technique « Slap » : mêmes regroupements (Californication et Give It Away)');
        await ouvrirChapitre(a.page, 'Morceaux'); await vue(a.page, 'style');
        await a.page.locator('.songs-wrap .song-folder-row', { hasText: 'Reggae' }).first().click(); await a.page.waitForTimeout(400);
        check(await a.page.locator('.song-artist-block').count() === 0 && await a.page.locator('.songs-wrap .exercise').count() === 1, 'L. un seul morceau d\'un artiste : pas de bloc');
        await ouvrirChapitre(a.page, 'Morceaux'); await vue(a.page, 'artist');
        await a.page.locator('.songs-wrap .song-folder-row', { hasText: 'Red Hot' }).first().click(); await a.page.waitForTimeout(400);
        check(await a.page.locator('.song-artist-block').count() === 0 && await a.page.locator('.songs-wrap .exercise').count() === 3, 'L. dans un dossier d\'artiste, pas de bloc en plus (3 morceaux à plat)');
        check(a.erreurs.length === 0, 'L. aucune erreur JavaScript ' + JSON.stringify(a.erreurs));
        await a.ctx.close();
    }

    // ============ M. Barre d'ajout : même hauteur que les cartes, bouton « + » plus large, « Artiste - Titre » reconnu ============
    {
        const a = await ouvrir(browser, { etat: etatMorceaux() });
        await ouvrirChapitre(a.page, 'Morceaux'); await vue(a.page, 'all');
        const g = await a.page.evaluate(() => { const r = e => e.getBoundingClientRect(); const row = document.querySelector('.add-song-row'), ins = [...row.querySelectorAll('input')].map(r), b = r(row.querySelector('button')), c = r(document.querySelector('.exercise'));
            return { carte: Math.round(c.height), champs: ins.map(x => Math.round(x.height)), larg: ins.map(x => Math.round(x.width)), bouton: [Math.round(b.width), Math.round(b.height)] }; });
        check(g.champs.every(h => h === g.carte), `M. morceaux : les deux cases ont la hauteur d'une carte (${g.champs.join(', ')} px / carte ${g.carte} px)`);
        check(Math.abs(g.larg[0] - g.larg[1]) <= 1, `M. morceaux : artiste et titre ont la même largeur (${g.larg.join(' / ')} px)`);
        check(g.bouton[0] >= 48 && g.bouton[1] === g.carte, `M. le bouton « + » est plus large (${g.bouton[0]} × ${g.bouton[1]} px, contre 24 × 34 avant)`);
        await a.page.locator('.add-song-artist').pressSequentially('Radiohead - Nude', { delay: 15 }); await a.page.waitForTimeout(100);
        check(await a.page.locator('.add-song-artist').inputValue() === 'Radiohead' && await a.page.locator('.add-song-title').inputValue() === 'Nude', 'M. « Radiohead - Nude » tapé dans la case artiste : réparti aussitôt (artiste | titre)');
        check(await a.page.evaluate(() => document.activeElement.className) === 'add-song-title', 'M. et le curseur passe dans la case du titre');
        await a.page.keyboard.press('Enter'); await a.page.waitForTimeout(500); await attendreSauvegarde(a.page);
        let ch = await chapitre(a.page, 'Morceaux'), n = ch.exercises.find(e => e.title === 'Radiohead - Nude');
        check(!!n && n.artist === 'Radiohead' && n.songName === 'Nude', 'M. Entrée ajoute le morceau « Radiohead - Nude »');
        await a.page.locator('.add-song-artist').fill(''); await a.page.locator('.add-song-title').pressSequentially('Muse - Hysteria', { delay: 15 }); await a.page.waitForTimeout(100);
        check(await a.page.locator('.add-song-artist').inputValue() === 'Muse' && await a.page.locator('.add-song-title').inputValue() === 'Hysteria', 'M. idem tapé dans la case du titre (artiste vide)');
        await a.page.locator('.add-song-row button').click(); await a.page.waitForTimeout(500); await attendreSauvegarde(a.page);
        ch = await chapitre(a.page, 'Morceaux');
        check(ch.exercises.some(e => e.title === 'Muse - Hysteria' && e.artist === 'Muse'), 'M. le bouton « + » ajoute « Muse - Hysteria »');
        await a.page.locator('.add-song-artist').fill('Titre sans tiret'); await a.page.waitForTimeout(100);
        check(await a.page.locator('.add-song-title').inputValue() === '', 'M. sans « espace tiret espace », rien n\'est découpé');
        check(a.erreurs.length === 0, 'M. aucune erreur JavaScript ' + JSON.stringify(a.erreurs));
        await a.ctx.close();
        const b = await ouvrir(browser, { etat: etatDepart() });
        await b.page.locator('.tree-node > .tree-row', { hasText: 'Technique' }).first().click(); await b.page.waitForTimeout(300);
        const h = await b.page.evaluate(() => ({ carte: Math.round(document.querySelector('.exercise').getBoundingClientRect().height), champ: Math.round(document.querySelector('.add-exercise-row input').getBoundingClientRect().height), btn: Math.round(document.querySelector('.add-exercise-row button').getBoundingClientRect().width) }));
        check(h.champ === h.carte && h.btn >= 48, `M. exercices : la barre d'ajout a aussi la hauteur d'une carte (${h.champ} / ${h.carte} px) et un bouton « + » large (${h.btn} px)`);
        await b.ctx.close();
    }

    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
