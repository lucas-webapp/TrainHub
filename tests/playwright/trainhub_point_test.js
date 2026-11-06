// Statistiques : clic droit (appui long) sur un point du graphique de tempo → « Retirer ce point des statistiques », avec « Annuler ».
// Le tempo de CETTE séance pour CET exercice est vidé ; le temps passé, les autres exercices et les autres séances ne bougent pas.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_point_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : retirer un point du graphique de tempo des statistiques');
const estBruitReseau = harnais.estBruitReseau;
plan(31);
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const URL = 'http://localhost:8765/index.html';

async function ouvrir(browser, { tactile = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', colorScheme: 'dark', hasTouch: tactile });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !estBruitReseau(m.text()) && !/ERR_FAILED/.test(m.text())) erreurs.push('console: ' + m.text()); });
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.addInitScript(() => {
        try {
            localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1');
            if (sessionStorage.getItem('__seed')) return;
            sessionStorage.setItem('__seed', '1');
            const ex = (id, title) => ({ id, title, notes: '', collapsed: true });
            localStorage.setItem('trainhub.v1', JSON.stringify({ activeInstrumentId: 'i1', updatedAt: 1, instruments: [{ id: 'i1', name: 'Guitare', categories: [{ id: 'c1', name: 'Technique', color: '#e91e63', folders: [], exercises: [ex('e1', 'Gamme lente'), ex('e2', 'Arpèges')] }] }], settings: { guidedSessions: [] } }));
            // 7 séances sur les 7 derniers jours (ramenées au 1er du mois en début de mois) : tempo de « Gamme lente » ≈ 108 → 112, sauf la dernière (65 : erreur d'enregistrement) ; « Arpèges » toujours présent
            const bpm = [108, 109, 111, 110, 112, 111, 65];
            const mk = d => d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1);
            const par = {};
            bpm.forEach((b, i) => {
                const d = new Date(); d.setDate(Math.max(1, d.getDate() - (6 - i))); d.setHours(1 + i, 0, 0, 0); // jamais avant le 1er du mois (la page Statistiques n'affiche que le mois) ; l'heure garde l'ordre des séances
                const st = (id, ex, t, s, o) => Object.assign({ sid: 'p' + id, exerciseId: ex, title: t, chapterId: 'c1', chapterName: 'Technique', path: ['Technique'], pathIds: ['c1'], plannedMin: Math.round(s / 60), actualSec: s, bpmFirst: null, bpmMax: null, bpmEnd: null, playedSec: s }, o);
                const rec = { v: 2, id: 'r' + i, instrumentId: 'i1', name: 'Technique du jour', date: d.getTime(), endedAt: d.getTime() + 1500000, totalSec: 600 + 300, plannedSec: 900,
                    steps: [st(i + 'a', 'e1', 'Gamme lente', 600, { bpmFirst: b - 4, bpmMax: b, bpmEnd: b, bpmHow: 'tenu 15 s' }), st(i + 'b', 'e2', 'Arpèges', 300, { bpmFirst: 80, bpmMax: 90 + i, bpmEnd: 90 + i })] };
                const k = mk(d); (par[k] = par[k] || []).push(rec);
            });
            Object.keys(par).forEach(k => localStorage.setItem('trainhub.log.' + k, JSON.stringify({ records: par[k], deleted: [], updatedAt: Date.now() })));
        } catch (e) { }
    });
    await page.goto(URL);
    await page.waitForTimeout(600);
    return { ctx, page, erreurs };
}
const journalLocal = page => page.evaluate(() => { const out = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.indexOf('trainhub.log.') === 0) { const d = JSON.parse(localStorage.getItem(k)); (d.records || []).forEach(r => out.push(r)); } } return out.sort((a, b) => a.date - b.date); });
async function ouvrirExercices(page) {
    await page.click('#guided-session-btn');
    await page.waitForSelector('.gs-stats-btn');
    await page.click('.gs-stats-btn');
    await page.waitForSelector('.st-tab');
    await page.click('.st-tab[data-tab="ex"]');
    await page.waitForSelector('.st-ex-row');
    await page.locator('.st-ex', { hasText: 'Gamme lente' }).locator('.st-ex-row').click();
    await page.waitForSelector('.st-tempo');
}
const points = page => page.locator('.st-tempo .st-pt');
const resume = page => page.locator('.st-ex', { hasText: 'Gamme lente' }).locator('.st-ex-tempo').innerText();

(async () => {
    const browser = await chromium.launch();

    // ============ A. Souris : clic droit ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        const avant = await journalLocal(page);
        await ouvrirExercices(page);
        check(await points(page).count() === 7, `A. le graphique montre 7 points (${await points(page).count()})`);
        check(await page.locator('.st-tempo .st-pt-menu').count() === 7, 'A. chaque point offre le menu (zone de clic élargie)');
        check(/Clic droit/.test(await page.locator('.st-hint').first().innerText()), 'A. une phrase explique le geste sous le graphique');
        const r0 = await resume(page);
        check(/65 BPM/.test(r0), `A. le résumé de l'exercice finit sur le point erroné : « ${r0.replace(/\s+/g, ' ').trim()} »`);
        await page.screenshot({ path: path.join(SHOTS, 'point_avant.png') });

        // clic droit sur le dernier point (65)
        const dernier = page.locator('.st-tempo .st-pt-menu').last();
        await dernier.click({ button: 'right' });
        await page.waitForSelector('.st-pt-ctx');
        const titre = await page.locator('.st-pt-ctx .ctx-title').innerText();
        check(/65 BPM/.test(titre), `A. le menu nomme le point visé : « ${titre} »`);
        const txt = await page.locator('.st-pt-ctx .ctx-message').innerText();
        check(/Gamme lente/.test(txt) && /temps passé reste compté/.test(txt), `A. le texte précise l'exercice et ce qui est conservé : « ${txt} »`);
        const bouton = page.locator('.st-pt-ctx .ctx-item', { hasText: 'Retirer ce point' });
        const bb = await bouton.boundingBox();
        const dessus = await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest('.st-pt-ctx')); }, { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 });
        check(dessus, 'A. le menu est bien au-dessus de la fenêtre des statistiques (cliquable)');
        await page.screenshot({ path: path.join(SHOTS, 'point_menu.png') });

        // Échap : rien ne change
        await page.keyboard.press('Escape');
        check(await page.locator('.st-pt-ctx').count() === 0, 'A. Échap ferme le menu');
        check(await page.locator('.st-tab').count() > 0, 'A. et la fenêtre des statistiques reste ouverte');
        check(JSON.stringify(await journalLocal(page)) === JSON.stringify(avant) && await points(page).count() === 7, 'A. rien n\'a été modifié');

        // clic à côté : idem
        await dernier.click({ button: 'right' });
        await page.waitForSelector('.st-pt-ctx');
        await page.mouse.click(10, 10);
        check(await page.locator('.st-pt-ctx').count() === 0 && JSON.stringify(await journalLocal(page)) === JSON.stringify(avant), 'A. un clic à côté ferme le menu sans rien modifier');

        // retrait
        await dernier.click({ button: 'right' });
        await page.waitForSelector('.st-pt-ctx');
        await page.locator('.st-pt-ctx .ctx-item', { hasText: 'Retirer ce point' }).click();
        await page.waitForTimeout(400);
        check(await points(page).count() === 6, `A. le point disparaît du graphique (${await points(page).count()} restants)`);
        const r1 = await resume(page);
        check(!/65/.test(r1) && /111 BPM/.test(r1), `A. le résumé se recalcule : « ${r1.replace(/\s+/g, ' ').trim()} »`);
        check(await page.locator('.st-tempo').count() === 1 && await page.locator('.st-pt-ctx').count() === 0, 'A. le graphique reste ouvert, le menu est fermé');
        const apres = await journalLocal(page);
        const s = apres[6].steps[0], s0 = avant[6].steps[0];
        check(s.bpmMax === null && s.bpmFirst === null && s.bpmEnd === null && !('bpmHow' in s), 'A. le tempo de ce pas est vidé dans le journal');
        check(s.actualSec === s0.actualSec && apres[6].totalSec === avant[6].totalSec && s.exerciseId === 'e1' && s.title === s0.title, 'A. mais le temps passé, le total et l\'exercice sont intacts');
        check(JSON.stringify(apres[6].steps[1]) === JSON.stringify(avant[6].steps[1]) && JSON.stringify(apres.slice(0, 6)) === JSON.stringify(avant.slice(0, 6)), 'A. l\'autre exercice de la séance et les 6 autres séances sont intacts');
        const sale = await page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.logDirty.v1') || '[]'));
        check(sale.length >= 1, 'A. le mois est marqué « à envoyer au cloud » (même chemin que les autres corrections)');
        const toast = page.locator('.toast', { hasText: 'retiré des statistiques' });
        check(await toast.count() === 1 && /65 BPM/.test(await toast.innerText()), 'A. un message annonce le retrait et propose « Annuler »');
        await page.screenshot({ path: path.join(SHOTS, 'point_apres.png') });

        // annuler
        await toast.locator('.toast-action').click();
        await page.waitForTimeout(400);
        check(await points(page).count() === 7 && /65 BPM/.test(await resume(page)), 'A. « Annuler » remet le point');
        check(JSON.stringify(await journalLocal(page)) === JSON.stringify(avant), 'A. et le journal est identique à l\'original (bpmHow compris)');

        // retrait définitif, puis rechargement : le point reste retiré
        await page.locator('.st-tempo .st-pt-menu').last().click({ button: 'right' });
        await page.waitForSelector('.st-pt-ctx');
        await page.locator('.st-pt-ctx .ctx-item', { hasText: 'Retirer ce point' }).click();
        await page.waitForTimeout(300);
        await page.reload(); await page.waitForTimeout(800);
        await ouvrirExercices(page);
        check(await points(page).count() === 6, 'A. après rechargement, le point reste retiré');

        // un point du milieu (pas le dernier) : la courbe se referme sur les voisins
        await points(page).nth(2).click({ button: 'right' });
        await page.waitForSelector('.st-pt-ctx');
        check(/111 BPM/.test(await page.locator('.st-pt-ctx .ctx-title').innerText()), 'A. un point du milieu (111 BPM) ouvre son propre menu');
        await page.locator('.st-pt-ctx .ctx-item', { hasText: 'Retirer ce point' }).click();
        await page.waitForTimeout(300);
        check(await points(page).count() === 5, 'A. retirer un point du milieu : 5 points');
        check(erreurs.length === 0, 'A. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ B. Téléphone : appui long ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { tactile: true });
        await ouvrirExercices(page);
        const n0 = await points(page).count();
        const pos = await page.locator('.st-tempo .st-pt-menu').last().evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        const evt = (type) => page.locator('.st-tempo .st-pt-menu').last().evaluate((el, a) => el.dispatchEvent(new PointerEvent(a.type, { pointerType: 'touch', clientX: a.x, clientY: a.y, bubbles: true, isPrimary: true })), { type, x: pos.x, y: pos.y });
        await evt('pointerdown');
        await page.waitForTimeout(250);
        check(await page.locator('.st-pt-ctx').count() === 0, 'B. un appui court n\'ouvre rien');
        await evt('pointerup');
        await evt('pointerdown');
        await page.waitForTimeout(800);
        check(await page.locator('.st-pt-ctx').count() === 1, 'B. un appui long (tactile) ouvre le menu du point');
        await evt('pointerup');
        await page.locator('.st-pt-ctx .ctx-item', { hasText: 'Retirer ce point' }).click();
        await page.waitForTimeout(300);
        check(await points(page).count() === n0 - 1, `B. et le point est retiré (${n0} → ${await points(page).count()})`);
        check(erreurs.length === 0, 'B. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ C. Clavier ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await ouvrirExercices(page);
        await page.locator('.st-tempo .st-pt-menu').last().focus();
        await page.keyboard.press('ContextMenu');
        await page.waitForTimeout(300);
        check(await page.locator('.st-pt-ctx').count() === 1, 'C. la touche « Menu » du clavier ouvre aussi le menu du point');
        await page.keyboard.press('Escape');
        check(erreurs.length === 0, 'C. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
