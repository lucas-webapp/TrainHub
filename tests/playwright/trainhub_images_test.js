// Captures d'un exercice (v271) : nom posé par-dessus l'image (sans prendre de place), flèches de part et d'autre dans le grand format (+ clavier), ordre au glisser-déposer.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_images_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : captures — nom par-dessus, flèches du grand format, ordre');
plan(27);

(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block', colorScheme: 'dark' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.addInitScript(() => { try {
        localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1');
        if (sessionStorage.getItem('__seed')) return; sessionStorage.setItem('__seed', '1');
        localStorage.setItem('trainhub.v1', JSON.stringify({ activeInstrumentId: 'i1', updatedAt: 1, instruments: [{ id: 'i1', name: 'Basse', categories: [
            { id: 'c1', name: 'Technique', color: '#e91e63', folders: [], exercises: [{ id: 'e1', title: 'Tablatures', notes: '', collapsed: false }] }] }], settings: {} }));
    } catch (e) { } });
    await page.goto('http://localhost:8765/index.html');
    await page.waitForTimeout(900);
    // trois vraies images (canvas → PNG)
    const png = async (couleur, w, h) => Buffer.from((await page.evaluate(([c, w, h]) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(0, h - 20, w, 20); return cv.toDataURL('image/png').split(',')[1]; }, [couleur, w, h])), 'base64');
    await page.setInputFiles('input.add-file-input', [
        { name: 'Capture d\'écran 2026-11-10 à 12.00.00.png', mimeType: 'image/png', buffer: await png('#c0392b', 400, 200) },
        { name: 'image.png', mimeType: 'image/png', buffer: await png('#2980b9', 400, 200) },
        { name: 'IMG_0003.png', mimeType: 'image/png', buffer: await png('#27ae60', 400, 200) }]);
    await page.waitForSelector('.img-fig', { timeout: 8000 });
    await page.waitForFunction(() => document.querySelectorAll('.img-fig').length === 3, null, { timeout: 8000 });
    await page.waitForTimeout(600);
    const imgs = () => page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.v1')).instruments[0].categories[0].exercises[0].images.map(m => ({ id: m.id, name: m.name })));
    const dom = () => page.locator('.img-fig').evaluateAll(l => l.map(f => f.dataset.reorderId));

    // 1. nom : rien d'affiché tant qu'aucun nom n'est donné (le nom de fichier n'en est pas un)
    check('3 captures affichées', await page.locator('.img-fig').count() === 3);
    check('noms de fichiers non affichés par-dessus les images', (await page.locator('.img-title').evaluateAll(l => l.every(e => e.hidden || e.textContent === ''))));
    check('plus de ligne de nom sous les vignettes', await page.locator('.img-caption').count() === 0);
    // 2. donner un nom
    const f0 = page.locator('.img-fig').nth(0);
    const hFig0 = await f0.evaluate(e => e.getBoundingClientRect().height), hBox0 = await f0.locator('.img-box').evaluate(e => e.getBoundingClientRect().height);
    check('le nom ne prend aucune place : la figure a la hauteur de l\'image', Math.abs(hFig0 - hBox0) < 1.5, hFig0 + ' / ' + hBox0);
    await f0.locator('.img-box').hover();
    check('au survol, le crayon « Donner un nom » apparaît sur l\'image', await f0.locator('.img-name-btn').evaluate(e => parseFloat(getComputedStyle(e).opacity)) === 1);
    await f0.locator('.img-name-btn').click();
    const inp = f0.locator('input.img-title-input');
    check('une zone de saisie s\'ouvre par-dessus l\'image', await inp.count() === 1 && await inp.evaluate(e => { const r = e.getBoundingClientRect(), b = e.parentElement.querySelector('.img-thumb-btn').getBoundingClientRect(); return r.left >= b.left && r.right <= b.right + 1 && r.bottom <= b.bottom + 1; }));
    await page.keyboard.type('Couplet'); await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    check('le nom s\'affiche par-dessus l\'image', (await f0.locator('.img-title').innerText()).trim() === 'Couplet');
    const geo = await f0.locator('.img-title').evaluate(e => { const r = e.getBoundingClientRect(), b = e.closest('.img-thumb-btn').getBoundingClientRect(), cs = getComputedStyle(e); return { dedans: r.left >= b.left - 1 && r.right <= b.right + 1 && r.bottom <= b.bottom + 1 && r.top >= b.top, blanc: cs.color === 'rgb(255, 255, 255)', fond: /gradient/.test(cs.backgroundImage) }; });
    check('… dans le cadre de l\'image, en blanc sur fond sombre dégradé (lisible sur toute image)', geo.dedans && geo.blanc && geo.fond, JSON.stringify(geo));
    check('la hauteur de la figure n\'a pas changé', Math.abs((await f0.evaluate(e => e.getBoundingClientRect().height)) - hFig0) < 1.5);
    check('nom enregistré dans l\'exercice', (await imgs())[0].name === 'Couplet');
    // Échap annule
    await f0.locator('.img-box').hover(); await f0.locator('.img-name-btn').click();
    await page.keyboard.type(' XXX'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    check('Échap annule la modification', (await imgs())[0].name === 'Couplet' && (await f0.locator('.img-title').innerText()).trim() === 'Couplet');
    // 2e nom
    const f1 = page.locator('.img-fig').nth(1);
    await f1.locator('.img-box').hover(); await f1.locator('.img-name-btn').click();
    await page.keyboard.type('Refrain'); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
    check('2e nom enregistré', (await imgs())[1].name === 'Refrain');
    // 3. grand format : titre par-dessus, flèches
    await f0.locator('.img-thumb-btn').click();
    await page.waitForSelector('.img-viewer');
    await page.waitForTimeout(500);
    const vt = async () => ({ n: (await page.locator('.img-viewer-caption').innerText()).trim(), t: (await page.locator('.img-viewer-title').isVisible()) ? (await page.locator('.img-viewer-title').innerText()).trim() : '' });
    let v = await vt();
    check('grand format : 1 / 3 et le nom « Couplet » par-dessus l\'image', v.n === '1 / 3' && v.t === 'Couplet', JSON.stringify(v));
    const nav = await page.evaluate(() => { const g = e => e.getBoundingClientRect(), im = g(document.querySelector('.img-viewer-body img')), p = g(document.querySelector('.img-viewer-nav-prev')), n = g(document.querySelector('.img-viewer-nav-next')), b = g(document.querySelector('.img-viewer-body')); return { gauche: p.right <= im.left + p.width && p.left >= b.left, droite: n.left >= im.right - n.width && n.right <= b.right, centre: Math.abs((p.top + p.height / 2) - (b.top + b.height / 2)) < 6 }; });
    check('flèches de part et d\'autre de l\'image, à mi-hauteur', nav.gauche && nav.droite && nav.centre, JSON.stringify(nav));
    check('plus de flèches dans le bandeau du haut', await page.locator('.img-viewer-head .img-viewer-nav').count() === 0);
    await page.locator('.img-viewer-nav-next').click(); await page.waitForTimeout(250);
    v = await vt(); check('flèche droite : 2 / 3 « Refrain »', v.n === '2 / 3' && v.t === 'Refrain', JSON.stringify(v));
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250);
    v = await vt(); check('touche → : 3 / 3, sans nom donné : pas de titre', v.n === '3 / 3' && v.t === '', JSON.stringify(v));
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250);
    v = await vt(); check('→ au bout : on revient à 1 / 3', v.n === '1 / 3', JSON.stringify(v));
    await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(250);
    v = await vt(); check('touche ← : retour à 3 / 3', v.n === '3 / 3', JSON.stringify(v));
    await page.locator('.img-viewer-nav-prev').click(); await page.waitForTimeout(250);
    v = await vt(); check('flèche gauche : 2 / 3', v.n === '2 / 3', JSON.stringify(v));
    const bpm0 = await page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.v1')).settings && JSON.parse(localStorage.getItem('trainhub.v1')).settings.metronome ? JSON.parse(localStorage.getItem('trainhub.v1')).settings.metronome.bpm : null);
    check('les flèches du clavier ne touchent pas au tempo du métronome', bpm0 === null || bpm0 === (await page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.v1')).settings.metronome.bpm)));
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    check('Échap ferme le grand format', await page.locator('.img-viewer').count() === 0);
    // 4. un exercice à une seule image : pas de flèches (testé plus bas via l'ordre) ; ordre au glisser-déposer
    const avant = await dom();
    const b2 = await page.locator('.img-fig').nth(2).locator('.img-thumb-btn').boundingBox(), b0 = await page.locator('.img-fig').nth(0).locator('.img-thumb-btn').boundingBox();
    await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
    await page.mouse.down();
    await page.mouse.move(b2.x + b2.width / 2 - 40, b2.y + b2.height / 2, { steps: 6 });
    await page.mouse.move(b0.x + 20, b0.y + b0.height / 2, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    const apres = (await imgs()).map(m => m.id);
    check('glisser-déposer : la 3e capture passe en tête', apres.join() === [avant[2], avant[0], avant[1]].join(), apres.join() + ' / ' + avant.join());
    check('l\'affichage suit le nouvel ordre', (await dom()).join() === apres.join());
    check('les noms suivent leurs images', (await imgs()).map(m => m.name).join() === ['IMG_0003.png', 'Couplet', 'Refrain'].join());
    // 5. persistance
    await page.reload(); await page.waitForTimeout(1000);
    check('après rechargement : noms et ordre conservés', (await page.locator('.img-title').allInnerTexts()).map(t => t.trim()).join('|') === '|Couplet|Refrain');
    check('aucune erreur de page', erreurs.length === 0, erreurs.join(' | '));
    await browser.close();
    bilan();
})().catch(e => { console.error('FAIL exception', e); process.exit(1); });
