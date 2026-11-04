// Volet de gauche : dossiers principaux (Favoris et Archivés = titres, Exercices vert, Morceaux violet repliables), barres au-dessus de la lumière ;
// et un seul exercice ouvert à la fois.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_volet_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : volet de gauche — dossiers principaux, couleurs, un seul exercice ouvert');
plan(20);

function etat() {
    const ex = (id, title, o) => Object.assign({ id, title, notes: '', collapsed: true, links: [], files: [], images: [], favorite: false, archived: false, updatedAt: 1 }, o || {});
    const song = (id, a, n) => ex(id, a + ' - ' + n, { isSong: true, artist: a, songName: n, styles: [], techniques: ['Médiator'], work: '' });
    return { activeInstrumentId: 'i1', updatedAt: 1, instruments: [{ id: 'i1', name: 'Basse', categories: [
        { id: 'c1', name: 'Technique', color: '#ff4f9a', folders: [], exercises: [ex('a', 'Gamme lente', { collapsed: false }), ex('b', 'Slap', { collapsed: false }), ex('c', 'Legato'), ex('d', 'Arpèges')] },
        { id: 'c3', name: 'Harmonie', color: '#40c4ff', folders: [], exercises: [ex('h', 'Accords')] },
        { id: 'c2', name: 'Morceaux', color: '#ffb04a', kind: 'songs', folders: [], vocab: { styles: [], techniques: ['Médiator'], work: ['En cours'] }, exercises: [song('m1', 'Chic', 'Good times'), song('m2', 'Chic', 'Le freak')] }
    ] }], settings: {} };
}
async function ouvrir(browser, { viewport = { width: 1280, height: 800 }, glass = false } = {}) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', colorScheme: 'dark' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.addInitScript(({ e, glass }) => { try { localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1'); if (glass) localStorage.setItem('trainhub.glass.v1', '1'); if (!sessionStorage.getItem('__seed')) { sessionStorage.setItem('__seed', '1'); localStorage.setItem('trainhub.v1', JSON.stringify(e)); } } catch (x) { } }, { e: etat(), glass });
    await page.goto('http://localhost:8765/index.html');
    await page.waitForTimeout(800);
    return { ctx, page, erreurs };
}
(async () => {
    const browser = await chromium.launch();
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        const o = await page.evaluate(() => {
            const kids = [...document.querySelector('.sidebar-tree').children].map(e => e.className.replace(/\s+/g, '.')).filter(c => /tree-title|tree-zone|tree-add/.test(c));
            const zone = c => document.querySelector('.tree-zone.' + c), css = (e, p) => getComputedStyle(e).getPropertyValue(p).trim();
            const noeud = document.querySelector('.tree-zone.tz-ex .tree-node'), bg = getComputedStyle(noeud).backgroundColor;
            return { kids, ex: [...zone('tz-ex').querySelectorAll('.tree-row-d0 .tree-label')].map(e => e.textContent).join('|'), so: [...zone('tz-songs').querySelectorAll('.tree-row-d0 .tree-label')].map(e => e.textContent).join('|'),
                zEx: css(zone('tz-ex'), '--z'), zSo: css(zone('tz-songs'), '--z'), cEx: zone('tz-ex').querySelector('.tz-count').textContent, cSo: zone('tz-songs').querySelector('.tz-count').textContent, bg,
                lblEx: zone('tz-ex').querySelector('.tz-label').textContent, lblSo: zone('tz-songs').querySelector('.tz-label').textContent,
                favBox: getComputedStyle(document.querySelector('.tree-title-top > .tree-row')).boxShadow, favBg: getComputedStyle(document.querySelector('.tree-title-top > .tree-row')).backgroundColor };
        });
        check(/tree-title-top.*tree-zone.tz-ex.*tree-zone.tz-songs.*tree-title-bottom/.test(o.kids.join(' ')), 'ordre du volet : Favoris, Exercices, Morceaux, Archivés (' + o.kids.join(' ') + ')');
        check(o.ex === 'Technique|Harmonie' && o.so === 'Morceaux', `les chapitres sont sous leur dossier principal (Exercices : ${o.ex} · Morceaux : ${o.so})`);
        check(o.lblEx === 'Exercices' && o.lblSo === 'Morceaux' && o.cEx === '5' && o.cSo === '2', `en-têtes avec le nombre d'exercices et de morceaux (${o.cEx} / ${o.cSo})`);
        check(o.zEx === '#5f9f80' && o.zSo === '#8b74c4', `vert pour les exercices, violet pour les morceaux, teintes pastel (${o.zEx} / ${o.zSo})`);
        check(!/rgba?\(\d+, \d+, \d+, 0\)|transparent/.test(o.bg) && o.bg !== 'rgba(0, 0, 0, 0)', 'les barres de chapitre ont un fond plein : la lumière passe derrière, pas dessus (' + o.bg + ')');
        check(o.favBg === 'rgba(0, 0, 0, 0)' && !/rgb|color\(/.test(o.favBox.replace(/rgba\(\d+, \d+, \d+, 0\)/g, '').replace(/color\([^)]*\/ 0\)/g, '')), 'Favoris est un titre à part : ni fond ni cadre ni halo (' + o.favBg + ' / ' + o.favBox.slice(0, 50) + ')');
        const lum = await page.evaluate(() => { const z = document.querySelector('.tree-zone.tz-ex'), a = getComputedStyle(z, '::after'); return { w: Math.round(parseFloat(a.width) / z.getBoundingClientRect().width * 100), z: a.zIndex, tz: getComputedStyle(z.querySelector('.tree-list')).zIndex }; });
        check(lum.w >= 30 && lum.w <= 36 && lum.z === '0' && lum.tz === '1', `la lumière couvre le premier tiers de la largeur (${lum.w} %) et reste sous les barres (z ${lum.z} < ${lum.tz})`);
        // repli retenu
        await page.locator('.tree-zone.tz-songs .tz-head').click(); await page.waitForTimeout(200);
        check(await page.locator('.tree-zone.tz-songs .tree-list').isHidden() && await page.locator('.tree-zone.tz-ex .tree-list').isVisible(), 'un clic sur « Morceaux » replie ses chapitres seulement');
        await page.reload(); await page.waitForTimeout(800);
        check(await page.locator('.tree-zone.tz-songs .tree-list').isHidden(), 'le repli est retenu après un rechargement');
        await page.locator('.tree-zone.tz-songs .tz-head').click(); await page.waitForTimeout(200);
        // Favoris / Archivés ouvrent leur liste
        await page.locator('.tree-title-bottom .tree-row').click(); await page.waitForTimeout(400);
        check(/Archiv/i.test(await page.locator('#content-heading, .content-heading, h2').first().innerText()), 'un clic sur Archivés ouvre la liste des archives');
        await page.locator('.tree-title-top .tree-row').click(); await page.waitForTimeout(400);
        check(/Favori/i.test(await page.locator('#content-heading, .content-heading, h2').first().innerText()), 'un clic sur Favoris ouvre les favoris');
        check(erreurs.length === 0, 'aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }
    {   // mode verre : Favoris et Archivés restent des titres
        const { ctx, page } = await ouvrir(browser, { glass: true });
        const g = await page.evaluate(() => { const r = document.querySelector('.tree-title-top > .tree-row'), c = getComputedStyle(r); return { bg: c.backgroundColor, sh: c.boxShadow }; });
        check(g.bg === 'rgba(0, 0, 0, 0)' && (g.sh === 'none' || /^(rgba\(0, 0, 0, 0\)[^,]*,? ?)+$/.test(g.sh)), 'mode verre : Favoris reste un titre sans cadre (' + g.bg + ' / ' + g.sh.slice(0, 40) + ')');
        await ctx.close();
    }
    {   // téléphone : puces regroupées, Favoris en tête et Archivés en dernier
        const { ctx, page } = await ouvrir(browser, { viewport: { width: 390, height: 800 } });
        const chips = await page.locator('.chapter-chip .chapter-chip-label').allInnerTexts();
        check(chips.join('|') === 'Favoris|Technique|Harmonie|Morceaux|Archivés', 'téléphone : puces dans l\'ordre Favoris, exercices, morceaux, Archivés (' + chips.join('|') + ')');
        await ctx.close();
    }
    {   // un seul exercice ouvert à la fois
        const { ctx, page, erreurs } = await ouvrir(browser);
        await page.locator('.tree-zone.tz-ex .tree-row-d0', { hasText: 'Technique' }).click(); await page.waitForTimeout(400);
        const ouverts = () => page.evaluate(() => [...document.querySelectorAll('.exercise:not(.collapsed)')].map(e => e.dataset.exId).join());
        check(await ouverts() === 'a,b', 'au départ, deux exercices sont ouverts (état enregistré)');
        await page.locator('.exercise[data-ex-id="c"] .exercise-row').click({ position: { x: 600, y: 10 } }); await page.waitForTimeout(400);
        check(await ouverts() === 'c', 'en ouvrir un troisième referme les deux autres (' + await ouverts() + ')');
        await page.locator('.exercise[data-ex-id="d"] .exercise-row').click({ position: { x: 600, y: 10 } }); await page.waitForTimeout(400);
        check(await ouverts() === 'd', 'puis un autre : seul le dernier ouvert reste ouvert (' + await ouverts() + ')');
        await page.locator('.exercise[data-ex-id="d"] .exercise-row').click({ position: { x: 600, y: 10 } }); await page.waitForTimeout(400);
        check(await ouverts() === '', 'un clic sur l\'exercice ouvert le referme (rien d\'ouvert)');
        const sauve = await page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.v1')).instruments[0].categories[0].exercises.map(e => e.collapsed).join());
        check(sauve === 'true,true,true,true', 'l\'état fermé est bien enregistré (' + sauve + ')');
        check(erreurs.length === 0, 'aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }
    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
