// Gros bouton Jouer / Arrêter du métronome (v272) : cadre en ombres internes (bord bas coloré garanti, même à hauteur fractionnaire / panneau zoomé),
// verre dépoli (reflet + grain + flou d'arrière-plan), vert à l'arrêt, rouge pendant la lecture, mode « verre » de l'appli compris.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_bouton_lecture_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : bouton Jouer du métronome — contour coloré en bas, verre dépoli');
plan(21);

async function ouvrir(browser, { glass = false, dpr = 2 } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block', colorScheme: 'dark', deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.addInitScript(g => { try {
        localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1');
        if (g) localStorage.setItem('trainhub.glass.v1', '1');
        if (sessionStorage.getItem('__seed')) return; sessionStorage.setItem('__seed', '1');
        localStorage.setItem('trainhub.v1', JSON.stringify({ activeInstrumentId: 'i1', updatedAt: 1, instruments: [{ id: 'i1', name: 'Basse', categories: [{ id: 'c1', name: 'T', color: '#e91e63', folders: [], exercises: [] }] }], settings: {} }));
    } catch (e) { } }, glass);
    await page.goto('http://localhost:8765/index.html');
    await page.waitForTimeout(700);
    await page.locator('#metronome-btn').click();
    await page.waitForSelector('button.metro-play-btn-big');
    await page.waitForTimeout(500);
    return { ctx, page, erreurs };
}
// couleurs (r,g,b) des pixels sur la colonne centrale, du dernier pixel du bouton vers le bas
async function bas(page) {
    const r = await page.locator('button.metro-play-btn-big').first().boundingBox();
    const dpr = await page.evaluate(() => devicePixelRatio);
    const shot = await page.screenshot({ clip: { x: Math.round(r.x + r.width / 2), y: Math.floor(r.y + r.height) - 5, width: 1, height: 9 } });
    return page.evaluate(async b64 => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); const o = []; for (let y = 0; y < im.height; y++) { const d = g.getImageData(0, y, 1, 1).data; o.push([d[0], d[1], d[2]]); } return o; }, shot.toString('base64'));
}
const vif = (px, teinte) => px.some(([r, g, b]) => teinte === 'vert' ? (g > 120 && g > r * 1.6 && g > b * 1.2) : (r > 150 && r > g * 1.6 && r > b * 1.6));

(async () => {
    const browser = await chromium.launch();
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        const btn = page.locator('button.metro-play-btn-big').first();
        const cs = await btn.evaluate(e => { const s = getComputedStyle(e); return { bw: s.borderBottomWidth, sh: s.boxShadow, bf: s.backdropFilter || s.webkitBackdropFilter, bg: s.backgroundImage, txt: e.textContent.trim() }; });
        check('à l\'arrêt : libellé « Jouer »', cs.txt === 'Jouer', cs.txt);
        check('le cadre ne dépend plus d\'une bordure (bordure 0) mais d\'ombres internes', cs.bw === '0px' && /inset/.test(cs.sh), cs.bw);
        check('un bord coloré net de 2 px en bas (ombre interne 0 -2px)', /0px -2px 0px/.test(cs.sh), cs.sh.slice(0, 160));
        check('verre dépoli : flou d\'arrière-plan', /blur/.test(cs.bf || ''), cs.bf);
        check('verre dépoli : reflet + grain en fond', (cs.bg.match(/gradient/g) || []).length >= 2 && /url\(/.test(cs.bg));
        let px = await bas(page);
        check('bas du bouton (à l\'arrêt) : un bord VERT visible', vif(px, 'vert'), JSON.stringify(px));
        // panneau agrandi / réduit : hauteur fractionnaire, le bord bas doit rester coloré
        let tous = true, det = [];
        for (const z of [0.93, 1.07, 1.13, 1.27, 1.41]) {
            await page.evaluate(z => { const i = document.querySelector('.panel-fit-inner'); if (i) i.style.zoom = String(z); }, z);
            await page.waitForTimeout(150);
            const p2 = await bas(page); const ok = vif(p2, 'vert'); tous = tous && ok; det.push(z + ':' + ok);
        }
        check('bord bas vert aussi à tous les zooms du panneau (hauteurs fractionnaires)', tous, det.join(' '));
        await page.evaluate(() => { const i = document.querySelector('.panel-fit-inner'); if (i) i.style.zoom = ''; });
        await page.waitForTimeout(150);
        await btn.click();
        await page.waitForTimeout(500);
        const cs2 = await btn.evaluate(e => ({ txt: e.textContent.trim(), on: e.classList.contains('metro-play-btn-active') }));
        check('en lecture : « Arrêter » et état actif', cs2.txt === 'Arrêter' && cs2.on, JSON.stringify(cs2));
        px = await bas(page);
        check('bas du bouton (en lecture) : un bord ROUGE visible', vif(px, 'rouge'), JSON.stringify(px));
        const col = await btn.evaluate(e => getComputedStyle(e).color);
        const m = /rgb\((\d+), (\d+), (\d+)/.exec(col);
        check('texte en rouge clair en lecture', m && Number(m[1]) > 200 && Number(m[1]) > Number(m[2]), col);
        await page.keyboard.press('Space').catch(() => {});
        await btn.click(); // arrêt
        await page.waitForTimeout(400);
        const cs3 = await btn.evaluate(e => e.textContent.trim());
        check('un clic arrête : retour à « Jouer »', cs3 === 'Jouer', cs3);
        check('(survol) le bord bas reste coloré', await (async () => { await btn.hover(); await page.waitForTimeout(300); return vif(await bas(page), 'vert'); })());
        const h = await btn.evaluate(e => Math.round(e.getBoundingClientRect().height));
        check('hauteur et largeur inchangées (bouton pleine largeur, ~44 à 56 px)', h >= 40 && h <= 60 && (await btn.evaluate(e => e.getBoundingClientRect().width)) > 200, h);
        check('aucune erreur de page', erreurs.length === 0, erreurs.join(' | '));
        await ctx.close();
    }
    {   // mode « verre » de l'appli : la règle générale des boutons ne doit pas effacer le cadre
        const { ctx, page } = await ouvrir(browser, { glass: true });
        const btn = page.locator('button.metro-play-btn-big').first();
        check('mode verre activé', await page.evaluate(() => document.documentElement.getAttribute('data-glass')) === '1');
        const sh = await btn.evaluate(e => getComputedStyle(e).boxShadow);
        check('mode verre : le bord coloré du bas est conservé', /0px -2px 0px/.test(sh), sh.slice(0, 120));
        check('mode verre : bord bas vert visible', vif(await bas(page), 'vert'));
        await ctx.close();
    }
    {   // écran non Retina (1 pixel = 1 pixel physique)
        const { ctx, page } = await ouvrir(browser, { dpr: 1 });
        check('écran standard (DPR 1) : bord bas vert visible', vif(await bas(page), 'vert'));
        await page.evaluate(() => { const i = document.querySelector('.panel-fit-inner'); if (i) i.style.zoom = '1.13'; });
        await page.waitForTimeout(200);
        check('écran standard, panneau zoomé : bord bas vert visible', vif(await bas(page), 'vert'));
        await ctx.close();
    }
    {   // téléphone
        const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'block', deviceScaleFactor: 2 });
        const page = await ctx.newPage();
        await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
        await page.addInitScript(() => { try { localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1'); } catch (e) { } });
        await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(700);
        await page.locator('#metronome-btn').click().catch(() => {});
        await page.waitForSelector('button.metro-play-btn-big'); await page.waitForTimeout(500);
        check('téléphone : bord bas vert visible', vif(await bas(page), 'vert'));
        const lg = await page.locator('button.metro-play-btn-big').first().evaluate(e => e.getBoundingClientRect().width);
        check('téléphone : bouton pleine largeur', lg > 300, lg);
        await ctx.close();
    }
    await browser.close();
    bilan();
})().catch(e => { console.error('FAIL exception', e); process.exit(1); });
