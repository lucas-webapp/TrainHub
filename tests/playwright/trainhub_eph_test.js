// Onglet « Éphémères » des sessions : sessions prévues + séances éphémères déjà réalisées (30 derniers jours, lues dans le journal).
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_eph_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : onglet Éphémères — séances réalisées sur le dernier mois');
plan(12);

async function ouvrir(browser, { viewport = { width: 1280, height: 900 }, vide = false } = {}) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', colorScheme: 'dark' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.addInitScript(({ vide }) => {
        try {
            localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1');
            if (sessionStorage.getItem('__seed')) return; sessionStorage.setItem('__seed', '1');
            const ex = (id, title) => ({ id, title, notes: '', collapsed: true });
            localStorage.setItem('trainhub.v1', JSON.stringify({ activeInstrumentId: 'i1', updatedAt: 1,
                instruments: [{ id: 'i1', name: 'Basse', categories: [{ id: 'c1', name: 'Technique', color: '#e91e63', folders: [], exercises: [ex('e1', 'Gamme lente'), ex('e2', 'Slap')] }] }, { id: 'i2', name: 'Guitare', categories: [{ id: 'c2', name: 'Autre', color: '#00e676', folders: [], exercises: [] }] }],
                settings: { guidedSessions: [{ id: 'g1', name: 'Ma session', instrumentId: 'i1', tabIds: [], createdAt: 1, steps: [{ id: 'p1', exerciseId: 'e1', minutes: 5 }] }] } }));
            if (vide) return;
            const jour = n => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(18, 0, 0, 0); return d.getTime(); };
            const rec = (id, n, o) => Object.assign({ v: 2, id, sessionId: 'x' + id, name: 'Session du jour ' + n, instrumentId: 'i1', date: jour(n), endedAt: jour(n) + 1500000, totalSec: 1500, plannedSec: 1800, ephemeral: true,
                steps: [{ sid: 's1', exerciseId: 'e1', title: 'Gamme lente', plannedMin: 5, sec: 900 }, { sid: 's2', exerciseId: 'e2', title: 'Slap', plannedMin: 5, sec: 600 }] }, o || {});
            const recs = [rec('r1', 2), rec('r2', 10), rec('r3', 27), rec('r4', 45), rec('r5', 5, { ephemeral: false, name: 'Ma session', sessionId: 'g1' }), rec('r6', 3, { instrumentId: 'i2', name: 'Guitare éphémère' })];
            const mois = {};
            recs.forEach(r => { const d = new Date(r.date), m = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); (mois[m] = mois[m] || []).push(r); });
            Object.keys(mois).forEach(m => localStorage.setItem('trainhub.log.' + m, JSON.stringify({ records: mois[m], deleted: [], updatedAt: 1 })));
        } catch (e) { }
    }, { vide });
    await page.goto('http://localhost:8765/index.html');
    await page.waitForTimeout(800);
    await page.click('#guided-session-btn'); await page.waitForSelector('.gs-tabbar');
    await page.locator('.gs-tab', { hasText: 'Éphémères' }).click(); await page.waitForTimeout(300);
    return { ctx, page, erreurs };
}

(async () => {
    const browser = await chromium.launch();
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        const titre = await page.locator('.gs-eph-past-title').innerText();
        check(/Réalisées ces 30 derniers jours \(3\)/i.test(titre), `un titre « ${titre} » : 3 séances éphémères de la base (2, 10 et 27 jours ; pas celle de 45 jours)`);
        const noms = await page.locator('.gs-eph-past-row .gs-up-name').allInnerTexts();
        check(noms.join('|') === '✓ Session du jour 2|✓ Session du jour 10|✓ Session du jour 27', `elles sont de la plus récente à la plus ancienne (${noms.join(' | ')})`);
        check(!noms.some(n => /Guitare éphémère|Ma session/.test(n)), 'ni celle d\'un autre espace, ni une session ordinaire (non éphémère)');
        const meta = await page.locator('.gs-eph-past-row .gs-up-meta').first().innerText();
        check(/2 exercices · réel 25 min \/ prévu 30 min/.test(meta), `chaque ligne donne les exercices et la durée réelle / prévue (« ${meta} »)`);
        check(await page.locator('.gs-eph-past-day').count() === 3, 'regroupées par jour');
        check(await page.locator('.gs-eph-past-title').evaluate(e => e.getBoundingClientRect().top) > await page.locator('.gs-eph-hint').evaluate(e => e.getBoundingClientRect().bottom), 'la liste est sous la zone de création');
        await page.locator('.gs-eph-past-row').first().click(); await page.waitForTimeout(400);
        const recap = await page.locator('.gs-popover, .gs-pop').first().innerText().catch(() => '');
        check(/Gamme lente/.test(recap) && /Slap/.test(recap), 'un clic ouvre le récapitulatif de la séance (exercices et durées)');
        await page.keyboard.press('Escape'); await page.mouse.click(5, 5); await page.waitForTimeout(200);
        await page.locator('.gs-eph-past-row').first().click({ button: 'right' }); await page.waitForTimeout(250);
        const items = await page.locator('.ctx-menu .ctx-item, .links-quick-menu button, .ctx-item').allInnerTexts();
        check(items.some(t => /Ouvrir ce jour dans le calendrier/.test(t)), 'clic droit : « Ouvrir ce jour dans le calendrier »');
        check(erreurs.length === 0, 'aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }
    {
        const { ctx, page } = await ouvrir(browser, { vide: true });
        check(await page.locator('.gs-eph-past-none').count() === 1 && /dernier mois/.test(await page.locator('.gs-eph-past-none').innerText()), 'sans séance : « Aucune session éphémère réalisée sur le dernier mois. »');
        check(await page.locator('.gs-eph-newbar').count() === 1 && await page.locator('.gs-empty', { hasText: 'Aucune session éphémère prévue' }).count() === 1, 'et la zone de création reste là, avec « Aucune session éphémère prévue. »');
        await ctx.close();
    }
    {
        const { ctx, page } = await ouvrir(browser, { viewport: { width: 390, height: 800 } });
        const o = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth - innerWidth, n: document.querySelectorAll('.gs-eph-past-row').length }));
        check(o.n === 3 && o.doc <= 0, `téléphone : les 3 séances sont listées, sans défilement horizontal (${o.n}, ${o.doc})`);
        await ctx.close();
    }
    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
