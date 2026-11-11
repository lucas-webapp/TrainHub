// Vidéos YouTube : plein écran du bouton de TrainHub (reprise de la lecture si YouTube se met en pause), plein écran propre à YouTube (rien à reprendre),
// pause voulue respectée, journal des vidéos. Le vrai YouTube est inaccessible d'ici : l'API et le lecteur sont des FAUX (yt_mock), dont l'un imite la
// pause constatée sur Safari quand la page qui l'embarque met son cadre en plein écran.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_video_test.js   (serveurs : TrainHub :8765, faux lecteur :8766)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : plein écran des vidéos');
const estBruitReseau = harnais.estBruitReseau;
plan(28);
const API = fs.readFileSync(path.join(__dirname, 'yt_mock_api.js'), 'utf8');
const SHOTS = path.join(__dirname, 'shots');

async function ouvrir(browser, { quirk = true, viewport = { width: 1280, height: 900 } } = {}) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !estBruitReseau(m.text()) && !/ERR_FAILED/.test(m.text())) erreurs.push('console: ' + m.text()); });
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.route('https://www.youtube.com/iframe_api', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: (quirk ? '' : 'window.__QUIRK=false;') + API }));
    await page.addInitScript(() => { try { localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1'); } catch (e) { } });
    await page.goto('http://localhost:8765/index.html');
    await page.waitForTimeout(500);
    const inp = page.locator('input[placeholder^="Ajouter un exercice"]').first();
    await inp.fill('Vidéo test'); await inp.press('Enter'); await page.waitForTimeout(300);
    await page.locator('.exercise .exercise-row-spacer').first().click();
    await page.waitForSelector('.add-link-row input[type=url]');
    await page.locator('.add-link-row input[type=url]').fill('https://www.youtube.com/watch?v=abcdefghijk');
    await page.locator('.add-link-row input[type=url]').press('Enter');
    await page.waitForTimeout(500);
    const onglet = page.locator('.media-tab[data-tab="videos"]');
    if (await onglet.count() && !(await onglet.first().getAttribute('class')).includes('active')) await onglet.first().click();
    const bascule = page.locator('button.gs-yt-toggle:visible', { hasText: /afficher/ });
    if (await bascule.count()) await bascule.first().click();
    await page.waitForSelector('.gs-yt-card iframe', { timeout: 8000 });
    const cadre = page.frameLocator('.gs-yt-card iframe');
    await cadre.locator('#pp').waitFor();
    return { ctx, page, cadre, erreurs };
}
const etat = async cadre => (await cadre.locator('#st').innerText()).trim();
const plein = page => page.evaluate(() => document.fullscreenElement ? document.fullscreenElement.tagName : null);
const journal = async page => { await page.waitForTimeout(1000); return page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.videoLog.v1') || '[]')); };
const appels = page => page.evaluate(() => window.__ytCalls || []);

(async () => {
    const browser = await chromium.launch();

    // ===== A. YouTube se met en pause quand TrainHub passe le cadre en plein écran : la lecture reprend =====
    {
        const { ctx, page, cadre, erreurs } = await ouvrir(browser);
        await cadre.locator('#pp').click();                       // démarre la lecture (clic DANS le lecteur)
        await page.waitForTimeout(400);
        check(await etat(cadre) === 'état 1', 'A. la vidéo joue');
        await page.click('.gs-yt-full-btn');
        await page.waitForFunction(() => document.fullscreenElement && document.fullscreenElement.tagName === 'IFRAME', null, { timeout: 5000 });
        check(true, 'A. le bouton de TrainHub met le cadre YouTube en plein écran');
        await page.waitForTimeout(1200);
        check(await etat(cadre) === 'état 1', `A. et la lecture CONTINUE (le lecteur s'est mis en pause, TrainHub l'a relancée : ${await etat(cadre)})`);
        let j = await journal(page);
        check(j.some(l => /pause juste après un changement de plein écran → reprise automatique/.test(l)), 'A. le journal des vidéos note la reprise automatique');
        check(j.some(l => /bouton TrainHub, demande de plein écran sur IFRAME \(état : lecture\)/.test(l)) && j.some(l => /plein écran accordé/.test(l)), 'A. et la demande, puis son acceptation');
        check(j.some(l => /plein écran entré \(demandé par TrainHub/.test(l)), 'A. et l\'entrée en plein écran « demandé par TrainHub »');
        check((await appels(page)).filter(x => x === 'play').length === 1, 'A. une seule relance, pas de boucle');
        // sortie (Échap : en plein écran le bouton de TrainHub est recouvert par la vidéo) : même chose
        await page.evaluate(() => document.exitFullscreen());
        await page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 5000 });
        await page.waitForTimeout(1200);
        check(await etat(cadre) === 'état 1', `A. à la sortie du plein écran aussi, la lecture continue (${await etat(cadre)})`);
        // pause voulue par l'utilisateur, plus tard : jamais défaite
        await page.waitForTimeout(2200);
        await cadre.locator('#pp').click();
        await page.waitForTimeout(1500);
        check(await etat(cadre) === 'état 2', "A. une pause voulue (quelques secondes après) n'est PAS défaite");
        // vidéo en pause + plein écran : elle reste en pause
        const avant = (await appels(page)).filter(x => x === 'play').length;
        await page.click('.gs-yt-full-btn');
        await page.waitForFunction(() => document.fullscreenElement && document.fullscreenElement.tagName === 'IFRAME', null, { timeout: 5000 });
        await page.waitForTimeout(1500);
        check(await etat(cadre) === 'état 2' && (await appels(page)).filter(x => x === 'play').length === avant, 'A. une vidéo déjà en pause le reste en plein écran (rien n\'est relancé)');
        await page.evaluate(() => document.exitFullscreen());
        check(erreurs.length === 0, 'A. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ===== B. Plein écran propre à YouTube (son bouton, dans le lecteur) : rien à faire, et le journal le dit =====
    {
        const { ctx, page, cadre, erreurs } = await ouvrir(browser);
        await cadre.locator('#pp').click();
        await page.waitForTimeout(400);
        await cadre.locator('#fs').click();
        await page.waitForFunction(() => document.fullscreenElement && document.fullscreenElement.tagName === 'IFRAME', null, { timeout: 5000 });
        await page.waitForTimeout(1300);
        check(await etat(cadre) === 'état 1', 'B. plein écran du lecteur lui-même : la lecture continue');
        const j = await journal(page);
        check(j.some(l => /plein écran entré \(demandé par YouTube/.test(l)), 'B. le journal distingue « demandé par YouTube »');
        check(!j.some(l => /reprise automatique/.test(l)) && !(await appels(page)).includes('play'), 'B. TrainHub n\'a rien relancé');
        await page.evaluate(() => document.exitFullscreen());
        await page.waitForTimeout(1300);
        check(await etat(cadre) === 'état 1', 'B. et à la sortie, la lecture continue encore');
        check(erreurs.length === 0, 'B. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ===== C. YouTube NE se met PAS en pause : aucune relance inutile =====
    {
        const { ctx, page, cadre, erreurs } = await ouvrir(browser, { quirk: false });
        await cadre.locator('#pp').click();
        await page.waitForTimeout(400);
        await page.click('.gs-yt-full-btn');
        await page.waitForFunction(() => document.fullscreenElement, null, { timeout: 5000 });
        await page.waitForTimeout(1500);
        check(await etat(cadre) === 'état 1' && !(await appels(page)).includes('play'), 'C. sans pause de YouTube : la lecture continue et TrainHub ne relance rien');
        await page.evaluate(() => document.exitFullscreen());
        check(erreurs.length === 0, 'C. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ===== D. Double-clic sur la vidéo (couche transparente) = même chemin que le bouton, avec la même reprise =====
    {
        const { ctx, page, cadre, erreurs } = await ouvrir(browser);
        await cadre.locator('#pp').click();
        await page.waitForTimeout(500);
        const b = await page.locator('.gs-yt-dbl').boundingBox();
        await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);
        await page.waitForFunction(() => document.fullscreenElement && document.fullscreenElement.tagName === 'IFRAME', null, { timeout: 5000 });
        await page.waitForTimeout(1300);
        check(await etat(cadre) === 'état 1', `D. double-clic : plein écran, et la lecture continue (${await etat(cadre)})`);
        const j = await journal(page);
        check(j.some(l => /double-clic sur la vidéo → plein écran/.test(l)), 'D. le double-clic est journalisé');
        await page.evaluate(() => document.exitFullscreen());
        check(erreurs.length === 0, 'D. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ===== E. Réglages : le journal des vidéos se copie =====
    {
        const { ctx, page } = await ouvrir(browser);
        await cadre_noop();
        async function cadre_noop() { }
        await page.click('#settings-btn');
        await page.locator('.settings-tab', { hasText: /Vidéos/ }).first().click();
        await page.waitForSelector('.settings-action:has-text("Journal des vidéos"):visible', { timeout: 5000 });
        await page.locator('.settings-action', { hasText: 'Journal des vidéos' }).click();
        await page.waitForTimeout(500);
        const t = await page.locator('.toast, .app-dialog').allInnerTexts();
        check(t.join(' ').includes('Journal des vidéos'), `E. « Journal des vidéos » : ${t.join(' | ').slice(0, 90)}`);
        await ctx.close();
    }

    // ===== F. En-tête de la carte (v275) : bouton plein écran large et cerclé, plus de pastille « Clavier : vidéo » =====
    {
        const { ctx, page, cadre, erreurs } = await ouvrir(browser);
        const b = await page.locator('.gs-yt-full-btn').first().evaluate(e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e), sv = e.querySelector('svg').getBoundingClientRect(); return { w: r.width, h: r.height, bord: cs.borderTopWidth, coul: cs.borderTopColor, svw: sv.width, svh: sv.height }; });
        check(b.w >= 54 && b.w > b.h + 10, `F. bouton plein écran plus large que haut (${Math.round(b.w)} × ${Math.round(b.h)} px)`);
        check(b.bord === '1px' && !/rgba\(0, 0, 0, 0\)|transparent/.test(b.coul), `F. … avec un contour visible (${b.coul})`);
        check(b.svw > b.svh + 3, `F. … et une icône en rectangle (${Math.round(b.svw)} × ${Math.round(b.svh)} px)`);
        await page.click('#free-btn'); await page.waitForTimeout(600);     // session libre : les raccourcis de TrainHub sont en concurrence avec ceux de la vidéo
        await cadre.locator('#pp').click(); await page.waitForTimeout(500); // un clic DANS la vidéo lui donne le clavier
        check(await page.locator('.gs-yt-card.gs-yt-kbd').count() === 1, 'F. la vidéo qui a le clavier garde son liseré autour de la carte');
        check(await page.locator('.gs-yt-kbd-badge').count() === 0 && (await page.locator('.gs-yt-card').first().innerText()).indexOf('Clavier') === -1, 'F. mais plus aucune pastille « Clavier : vidéo »');
        check(erreurs.length === 0, 'F. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
