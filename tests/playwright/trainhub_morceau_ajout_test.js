// Ajout d'un morceau (v270) : la fiche du morceau s'ouvre tout de suite (caractéristiques, liens), là où il est rangé ; icône « Libre » avec des ailes.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_morceau_ajout_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : ajout d\'un morceau — fiche ouverte aussitôt, icône Libre ailée');
plan(14);

(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 }, serviceWorkers: 'block', colorScheme: 'dark' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.addInitScript(() => { try {
        localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1');
        if (sessionStorage.getItem('__seed')) return; sessionStorage.setItem('__seed', '1');
        const song = (id, artist, name, styles) => ({ id, title: artist + ' - ' + name, isSong: true, artist, songName: name, styles, techniques: [], work: '', notes: '', collapsed: true, links: [], files: [] });
        localStorage.setItem('trainhub.v1', JSON.stringify({ activeInstrumentId: 'i1', updatedAt: 1, instruments: [{ id: 'i1', name: 'Basse', categories: [
            { id: 'c1', name: 'Morceaux', color: '#e91e63', kind: 'songs', folders: [], exercises: [song('s0', 'Daft Punk', 'Around', ['Funk']), song('s1', 'Chic', 'Le Freak', ['Funk'])] }] }], settings: {} }));
    } catch (e) { } });
    await page.goto('http://localhost:8765/index.html');
    await page.waitForTimeout(900);
    const ouverts = () => page.locator('.exercise:not(.collapsed) .exercise-title').evaluateAll(l => l.map(e => e.value));
    const ajouter = async (a, t) => { await page.locator('.add-song-artist').first().fill(a); await page.locator('.add-song-title').first().fill(t); await page.keyboard.press('Enter'); await page.waitForTimeout(1100); };

    // 1. ajout depuis la page d'accueil du chapitre
    await ajouter('Jaco Pastorius', 'Portrait of Tracy');
    check('la fiche du morceau ajouté s\'ouvre aussitôt', (await ouverts()).join('|') === 'Jaco Pastorius - Portrait of Tracy', (await ouverts()).join('|'));
    check('… avec ses caractéristiques (style, technique, travail)', await page.locator('.exercise:not(.collapsed) .song-props button').count() === 3);
    check('… et la zone « Coller un lien… »', await page.locator('.exercise:not(.collapsed) input[placeholder^="Coller un lien"]').count() === 1);
    const vis = await page.locator('.exercise:not(.collapsed)').evaluate(e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; });
    check('la fiche est visible à l\'écran (défilée jusqu\'à elle)', vis);
    check('un message dit d\'en compléter la fiche', (await page.locator('.toast').allInnerTexts()).join(' ').includes('complète sa fiche'));
    // 2. on peut remplir tout de suite : un style, puis un lien
    await page.locator('.exercise:not(.collapsed) .song-props button').first().click();
    await page.waitForTimeout(300);
    check('le menu des styles s\'ouvre sur la fiche', await page.locator('.ctx-menu, .context-menu, [role="menu"]').count() > 0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.locator('.exercise:not(.collapsed) input[placeholder^="Coller un lien"]').fill('https://www.youtube.com/watch?v=abc123');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const liens = await page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.v1')).instruments[0].categories[0].exercises.filter(e => e.songName === 'Portrait of Tracy')[0].links.length);
    check('un lien de travail s\'enregistre sur le nouveau morceau', liens === 1, liens);
    // 3. un seul morceau ouvert à la fois : le suivant referme le précédent
    await ajouter('Jaco Pastorius', 'Teen Town');
    check('un seul morceau ouvert : le nouveau', (await ouverts()).join('|') === 'Jaco Pastorius - Teen Town', (await ouverts()).join('|'));
    check('l\'artiste est gardé en mémoire dans le formulaire (ajout en série)', await page.locator('.add-song-artist').first().inputValue() === 'Jaco Pastorius');
    // 4. ajout depuis un dossier de style : on ouvre le morceau là où il est rangé
    await page.locator('.song-folder-row', { hasText: 'Funk' }).first().click().catch(() => {});
    await page.waitForTimeout(400);
    const dansFunk = await page.locator('.crumb-current', { hasText: 'Funk' }).count();
    if (dansFunk) {
        await ajouter('Level 42', 'Lessons in Love');
        check('dans le dossier de style : le morceau s\'ouvre (rangé « Sans style », la page suit)', (await ouverts()).join('|') === 'Level 42 - Lessons in Love', (await ouverts()).join('|'));
        check('… et la page affichée est bien celle où il est rangé', await page.locator('.exercise:not(.collapsed)').count() === 1);
    } else { check('dossier Funk introuvable', false); check('(non joué)', false); }
    // 5. icône « Libre » ailée
    const svg = await page.locator('#free-btn svg').evaluate(s => ({ vb: s.getAttribute('viewBox'), paths: s.querySelectorAll('path').length, circles: s.querySelectorAll('circle').length }));
    check('icône « Libre » : un chronomètre (1 cercle) et 4 plumes d\'ailes en plus', svg.circles === 1 && svg.paths === 7, JSON.stringify(svg));
    check('… plus large que l\'icône « Session » seule (viewBox élargi)', Number(svg.vb.split(' ')[2]) > 14, svg.vb);
    check('aucune erreur de page', erreurs.length === 0, erreurs.join(' | '));
    await browser.close();
    bilan();
})().catch(e => { console.error('FAIL exception', e); process.exit(1); });
