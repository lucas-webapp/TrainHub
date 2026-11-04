// Espaces entre le bandeau des dossiers, le contenu et le métronome épinglé ; seuil de taille des icônes du métronome quand le volet est agrandi.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_rideau_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : espaces entre les fenêtres et seuil des icônes du métronome');
const estBruitReseau = harnais.estBruitReseau;
plan(33);
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

async function ouvrir(browser, { viewport, dock = '1', taille = null, glass = false } = {}) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', colorScheme: 'dark' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !estBruitReseau(m.text()) && !/ERR_FAILED/.test(m.text())) erreurs.push('console: ' + m.text()); });
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.addInitScript(({ dock, taille, glass }) => {
        try {
            localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1');
            localStorage.setItem('trainhub.metroDock.v1', dock);
            if (glass) localStorage.setItem('trainhub.glass.v1', '1');
            if (taille) localStorage.setItem('trainhub.metroDockSize.v1', JSON.stringify(taille));
            if (sessionStorage.getItem('__seed')) return;
            sessionStorage.setItem('__seed', '1');
            const ex = (id, title, o) => Object.assign({ id, title, notes: '', collapsed: true }, o || {});
            localStorage.setItem('trainhub.v1', JSON.stringify({ activeInstrumentId: 'i1', updatedAt: 1, instruments: [{ id: 'i1', name: 'Guitare', categories: [{ id: 'c1', name: 'Technique', color: '#e91e63', folders: [], exercises: [ex('e1', 'Gamme avec accents'), ex('e2', 'Arpèges', { collapsed: false })] }, { id: 'c2', name: 'Morceaux', color: '#ff9800', folders: [], exercises: [ex('e3', 'Blue Bossa')] }] }],
                settings: { guidedSessions: [{ id: 'g1', name: 'Session test', instrumentId: 'i1', tabIds: [], createdAt: 1, steps: [{ id: 'p1', exerciseId: 'e1', minutes: 4 }, { id: 'p2', exerciseId: 'e2', minutes: 8 }] }] } }));
        } catch (e) { }
    }, { dock, taille, glass });
    await page.goto('http://localhost:8765/index.html');
    await page.waitForTimeout(800);
    return { ctx, page, erreurs };
}
const geom = page => page.evaluate(() => {
    const q = s => { const e = document.querySelector(s); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return b.width ? { l: b.left, r: b.right, w: b.width } : null; };
    const main = document.querySelector('.main'), contenu = Array.from(main.querySelectorAll('.gs-session-row, .gs-run-exdetails, .gs-edit-topbar')).filter(e => e.getBoundingClientRect().width > 0);
    return { bandeau: q('.sidebar-tree'), dock: q('.metro-dock'), cl: contenu.length ? Math.min(...contenu.map(e => e.getBoundingClientRect().left)) : null, cr: contenu.length ? Math.max(...contenu.map(e => e.getBoundingClientRect().right)) : null, doc: document.documentElement.scrollWidth - innerWidth };
});

(async () => {
    const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

    // ============ A. Écran de la session avec le métronome épinglé : l'espace entre les fenêtres ============
    // (avant : 32 px à 1280, 72 px à 1440, 216 px à 1728, de chaque côté du contenu)
    for (const [w, h, maxG, maxD, avantG] of [[1280, 800, 22, 14, 32], [1440, 900, 22, 14, 72], [1728, 1000, 80, 72, 216]]) {
        const { ctx, page, erreurs } = await ouvrir(browser, { viewport: { width: w, height: h } });
        await page.click('#guided-session-btn');
        await page.waitForSelector('.gs-session-row');
        await page.locator('.gs-session-row .gs-session-play-btn').first().click();
        await page.waitForSelector('.gs-run-timer-row');
        await page.waitForTimeout(400);
        if (!(await page.locator('.metro-dock:not([hidden])').count())) { await page.locator('.gs-run-metro-btn').first().click(); await page.waitForTimeout(700); }
        const g = await geom(page);
        const gG = Math.round(g.cl - g.bandeau.r), gD = Math.round(g.dock.l - g.cr);
        check(gG <= maxG && gD <= maxD && gG < avantG, `A. ${w} px : espace bandeau → contenu ${gG} px et contenu → métronome ${gD} px (avant : ${avantG} px de chaque côté)`);
        check(g.doc <= 0, `A. ${w} px : rien ne déborde de l'écran`);
        await page.screenshot({ path: path.join(SHOTS, `rideau-apres-${w}.png`), clip: { x: 0, y: 0, width: w, height: Math.min(h, 760) } });
        check(erreurs.length === 0, `A. ${w} px : aucune erreur JavaScript ` + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ B. Liste des sessions et préparation : l'espace entre le bandeau et le contenu ============
    for (const [w, h, maxG, avantG] of [[1280, 800, 22, 32], [1440, 900, 22, 80], [1728, 1000, 170, 224]]) {
        const { ctx, page } = await ouvrir(browser, { viewport: { width: w, height: h } });
        await page.click('#guided-session-btn');
        await page.waitForSelector('.gs-session-row');
        let g = await geom(page);
        const gl = Math.round(g.cl - g.bandeau.r);
        check(gl <= maxG && gl < avantG + 1 && (w === 1280 || gl < avantG), `B. liste des sessions à ${w} px : ${gl} px entre le bandeau et les cadres (avant : ${avantG} px)`);
        await page.locator('.gs-session-name').first().click();
        await page.waitForSelector('.gs-edit-topbar');
        g = await geom(page);
        const ge = Math.round(g.cl - g.bandeau.r);
        check(ge <= maxG, `B. écran d'une session à ${w} px : ${ge} px entre le bandeau et le contenu`);
        await ctx.close();
    }

    // ============ C. Écrans étroits : mise en page inchangée, sans débordement ============
    for (const [w, h] of [[390, 844], [768, 1024], [1024, 768], [1099, 800], [1100, 800]]) {
        const { ctx, page } = await ouvrir(browser, { viewport: { width: w, height: h } });
        await page.click('#guided-session-btn');
        await page.waitForSelector('.gs-session-row');
        await page.locator('.gs-session-row .gs-session-play-btn').first().click();
        await page.waitForSelector('.gs-run-timer-row');
        await page.waitForTimeout(400);
        if (!(await page.locator('.metro-dock:not([hidden])').count())) { await page.locator('.gs-run-metro-btn').first().click().catch(() => { }); await page.waitForTimeout(600); }
        const g = await geom(page);
        check(g.doc <= 0, `C. ${w} px : session + métronome sans débordement horizontal (${Math.round(g.doc)} px)`);
        if (w === 1099 || w === 390) await page.screenshot({ path: path.join(SHOTS, `rideau-etroit-${w}.png`) });
        await ctx.close();
    }

    // ============ D. Volet du métronome agrandi : les icônes s'arrêtent à un seuil, le reste grossit ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { viewport: { width: 1600, height: 1100 }, taille: { w: 650, h: 950 } });
        await page.click('#metronome-btn');
        await page.waitForSelector('.metro-dock .metro-play-btn-big');
        await page.waitForTimeout(900);
        const m = await page.evaluate(() => {
            const dock = document.querySelector('.metro-dock'), inner = dock.querySelector('.panel-fit-inner'), r = s => { const e = dock.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; };
            const box = dock.querySelector('.panel-fit-box');
            return { zoom: parseFloat(inner.style.zoom) || 1, iconz: parseFloat(inner.style.getPropertyValue('--icon-z')), pin: r('.metro-pin-btn'), close: r('.panel-dock-close'), mute: r('.metro-volume-btn-icon'), slider: r('.metro-volume-inline-slider'), logo: r('.metro-title-icon'), dial: r('.metro-dial-value'), jouer: r('.metro-play-btn-big'), chronoIcon: r('.metro-chrono-icon'), reset: r('.metro-chrono-reset'), deborde: box.scrollWidth > box.clientWidth + 1 || box.scrollHeight > box.clientHeight + 1 };
        });
        check(m.zoom > 1.8 && m.iconz > 0 && m.iconz < 0.8, `D. volet de 650 × 950 px : le contenu est agrandi ×${m.zoom.toFixed(2)} et les icônes ramenées par ×${m.iconz} (--icon-z)`);
        check(m.pin.w <= 31 * 1.4 + 1 && m.close.w <= 31 * 1.4 + 1 && m.pin.w === m.close.w, `D. épingle et croix : ${m.pin.w} px (au lieu de ${Math.round(30 * m.zoom)} px sans seuil)`);
        check(m.mute.w <= 29 * 1.4 + 1 && m.logo.w <= 23 * 1.4 + 1, `D. volume (${m.mute.w} px) et logo du métronome (${m.logo.w} px) plafonnés`);
        check(m.chronoIcon.w <= 20 * 1.4 + 2 && m.reset.w <= 37 * 1.4 + 2, `D. chronomètre (${m.chronoIcon.w} px) et remise à zéro (${m.reset.w} px) plafonnés`);
        check(m.dial.w > 200 && m.jouer.h >= 60, `D. mais le tempo (${m.dial.w} px de large) et « Jouer » (${m.jouer.h} px de haut) continuent de remplir le volet`);
        check(!m.deborde, 'D. rien ne dépasse du volet');
        check(m.slider.w >= 280 && m.slider.h <= 31 * 1.4, `D. curseur de volume : ${m.slider.w} px de long, ${m.slider.h} px de haut (plus de place, pas de pouce géant)`);
        // régler le volume au curseur
        const sl = page.locator('.metro-dock .metro-volume-inline-slider');
        const bb = await sl.boundingBox();
        await page.mouse.click(bb.x + bb.width * 0.25, bb.y + bb.height / 2);
        const v1 = await sl.inputValue();
        await page.mouse.click(bb.x + bb.width * 0.8, bb.y + bb.height / 2);
        const v2 = await sl.inputValue();
        check(Math.abs(v1 - 25) <= 12 && Math.abs(v2 - 80) <= 12, `D. un clic à 25 % puis à 80 % du curseur règle le volume (${v1}, ${v2})`);
        await page.screenshot({ path: path.join(SHOTS, 'rideau-dock-grand.png'), clip: { x: 1600 - 690, y: 60, width: 690, height: 1000 } });
        check(erreurs.length === 0, 'D. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }
    {   // volet de taille ordinaire : aucun contre-zoom, icônes comme avant
        const { ctx, page } = await ouvrir(browser, { viewport: { width: 1440, height: 900 } });
        await page.click('#metronome-btn');
        await page.waitForSelector('.metro-dock .metro-play-btn-big');
        await page.waitForTimeout(700);
        const m = await page.evaluate(() => { const dock = document.querySelector('.metro-dock'), inner = dock.querySelector('.panel-fit-inner'), b = dock.querySelector('.metro-pin-btn').getBoundingClientRect(); return { zoom: parseFloat(inner.style.zoom) || 1, iconz: inner.style.getPropertyValue('--icon-z'), pin: Math.round(b.width) }; });
        check(m.iconz === '' && m.pin === 30, `D. volet de taille ordinaire (zoom ×${m.zoom}) : pas de contre-zoom, épingle de ${m.pin} px comme avant`);
        await ctx.close();
    }
    {   // zoom modéré (≤ 1,4) : les icônes suivent encore le contenu
        const { ctx, page } = await ouvrir(browser, { viewport: { width: 1600, height: 1000 }, taille: { w: 440, h: 560 } });
        await page.click('#metronome-btn');
        await page.waitForSelector('.metro-dock .metro-play-btn-big');
        await page.waitForTimeout(700);
        const m = await page.evaluate(() => { const dock = document.querySelector('.metro-dock'), inner = dock.querySelector('.panel-fit-inner'), b = dock.querySelector('.metro-pin-btn').getBoundingClientRect(); return { zoom: parseFloat(inner.style.zoom) || 1, iconz: inner.style.getPropertyValue('--icon-z'), pin: Math.round(b.width) }; });
        check(m.zoom <= 1.4 ? m.iconz === '' && m.pin === Math.round(30 * m.zoom) : m.pin <= 43, `D. volet moyen (zoom ×${m.zoom.toFixed(2)}) : épingle de ${m.pin} px (${m.zoom <= 1.4 ? 'elle suit le contenu' : 'plafonnée'})`);
        await ctx.close();
    }
    {   // fenêtre flottante (métronome non épinglé) : rien de changé, pas d'erreur
        const { ctx, page, erreurs } = await ouvrir(browser, { viewport: { width: 1440, height: 900 }, dock: '0' });
        await page.click('#metronome-btn');
        await page.waitForSelector('.metronome-panel .metro-play-btn-big');
        await page.waitForTimeout(600);
        const m = await page.evaluate(() => { const p = document.querySelector('.metronome-panel'), b = p.querySelector('.metro-pin-btn').getBoundingClientRect(), inner = p.querySelector('.panel-fit-inner'); return { pin: Math.round(b.width), iconz: inner.style.getPropertyValue('--icon-z') }; });
        check(m.pin <= 43, `D. fenêtre flottante : épingle de ${m.pin} px, sans erreur`);
        check(erreurs.length === 0, 'D. fenêtre flottante : aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
