// Statistiques › onglet Exercices (v281) : deux groupes. « Objectif tempo » = SEULEMENT la progression du tempo, date après date ;
// « Sans objectif tempo » = SEULEMENT la durée (temps passé, réel contre prévu). Rien de mélangé.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_stats_exercices_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : statistiques par exercice — objectif tempo (tempo seul) / sans objectif (durée seule)');
const estBruitReseau = harnais.estBruitReseau;
plan(23);
const URL = 'http://localhost:8765/index.html';

async function ouvrir(browser) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', colorScheme: 'dark' });
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
            const ex = (id, title, tg) => ({ id, title, notes: '', collapsed: true, tempoGoal: tg });
            localStorage.setItem('trainhub.v1', JSON.stringify({ activeInstrumentId: 'i1', updatedAt: 1, instruments: [{ id: 'i1', name: 'Guitare', categories: [{ id: 'c1', name: 'Technique', color: '#e91e63', folders: [],
                exercises: [ex('e1', 'Gamme avec tempo', true), ex('e2', 'Legato libre', false), ex('e3', 'Sans métronome', true)] }] }], settings: {} }));
            const mk = d => d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1);
            const par = {};
            const bpm = [100, 102, 104, 106, 108, 110];
            bpm.forEach((b, i) => {
                const d = new Date(); d.setDate(Math.max(1, d.getDate() - (5 - i))); d.setHours(1 + i, 0, 0, 0);
                const st = (id, ex, t, s, o) => Object.assign({ sid: 'p' + id, exerciseId: ex, title: t, chapterId: 'c1', chapterName: 'Technique', path: ['Technique'], pathIds: ['c1'], plannedMin: 10, actualSec: s, bpmFirst: null, bpmMax: null, bpmEnd: null, playedSec: 0 }, o || {});
                // « Gamme avec tempo » : 3 min réelles pour 10 min prévues (cela aurait déclenché une alerte de durée) ; « Legato libre » : idem MAIS avec des BPM notés (ignorés : pas d'objectif tempo)
                const rec = { v: 2, id: 'r' + i, instrumentId: 'i1', name: 'Technique du jour', date: d.getTime(), endedAt: d.getTime() + 1500000, totalSec: 800, plannedSec: 1800,
                    steps: [st(i + 'a', 'e1', 'Gamme avec tempo', 200, { bpmFirst: b - 3, bpmMax: b, bpmEnd: b }), st(i + 'b', 'e2', 'Legato libre', 200, { bpmFirst: 70, bpmMax: 80, bpmEnd: 80 }), st(i + 'c', 'e3', 'Sans métronome', 400)] };
                const k = mk(d); (par[k] = par[k] || []).push(rec);
            });
            Object.keys(par).forEach(k => localStorage.setItem('trainhub.log.' + k, JSON.stringify({ records: par[k], deleted: [], updatedAt: Date.now() })));
        } catch (e) { }
    });
    await page.goto(URL);
    await page.waitForTimeout(600);
    return { ctx, page, erreurs };
}

(async () => {
    const browser = await chromium.launch();
    const { ctx, page, erreurs } = await ouvrir(browser);
    await page.click('#guided-session-btn'); await page.waitForSelector('.gs-stats-btn'); await page.click('.gs-stats-btn');
    await page.waitForSelector('.st-tab'); await page.click('.st-tab[data-tab="ex"]'); await page.waitForSelector('.st-ex-row');
    const carte = nom => page.locator('.st-ex', { hasText: nom });
    const textes = nom => carte(nom).locator('.st-ex-row').innerText();

    // 1. deux groupes, le tempo en premier
    const titres = await page.locator('.st-ex-group strong').allInnerTexts();
    check(titres.length === 2 && /^Objectif tempo · 2 exercices$/.test(titres[0].trim()) && /^Sans objectif tempo · 1 exercice$/.test(titres[1].trim()), `1. deux groupes : ${JSON.stringify(titres)}`);
    const ordre = await page.locator('.st-ex').evaluateAll(l => l.map(e => e.querySelector('.st-ex-name').childNodes[0].textContent));
    check(ordre.indexOf('Legato libre') === 2 && ordre.slice(0, 2).includes('Gamme avec tempo') && ordre.slice(0, 2).includes('Sans métronome'), `1. « Legato libre » (sans objectif) est dans le 2ᵉ groupe (${JSON.stringify(ordre)})`);
    check(await carte('Gamme avec tempo').evaluate(e => e.classList.contains('st-ex-tempomode')) && await carte('Legato libre').evaluate(e => e.classList.contains('st-ex-durmode')), '1. cartes marquées : mode tempo / mode durée');

    // 2. l'en-tête d'un exercice à objectif tempo : le tempo, pas la durée
    const t1 = await textes('Gamme avec tempo');
    check(/100 → 110 BPM \(\+10\)/.test(t1) && /6 séances avec tempo/.test(t1), `2. objectif tempo : « ${t1.replace(/\s+/g, ' ')} »`);
    check(!/min en moyenne|\/ 10 min|3 min|%/.test(t1) && await carte('Gamme avec tempo').locator('.st-ex-dur').count() === 0, '2. … aucune durée dans cet en-tête');
    check(await carte('Gamme avec tempo').locator('.gs-stat-spark').count() === 1, '2. … mais la petite courbe de progression');
    // 3. l'en-tête d'un exercice sans objectif : la durée, pas le tempo
    const t2 = await textes('Legato libre');
    check(/6 séances/.test(t2) && /3 \/ 10 min/.test(t2), `3. sans objectif tempo : « ${t2.replace(/\s+/g, ' ')} »`);
    check(!/BPM/.test(t2) && await carte('Legato libre').locator('.st-ex-tempo, .gs-stat-spark').count() === 0, '3. … aucun tempo (même si des BPM avaient été notés)');
    // 4. objectif tempo mais aucun tempo noté
    const t4 = await textes('Sans métronome');
    check(/aucun tempo noté/.test(t4) && /6 séances/.test(t4) && !/0 séance/.test(t4), `4. objectif tempo sans tempo noté : « ${t4.replace(/\s+/g, ' ')} »`);

    // 5. le détail : tempo seulement / durée seulement
    await carte('Gamme avec tempo').locator('.st-ex-row').click(); await page.waitForTimeout(250);
    const d1 = await carte('Gamme avec tempo').innerText();
    check(await carte('Gamme avec tempo').locator('.st-tempo').count() === 1 && /Progression du tempo/i.test(d1), '5. détail d\'un exercice à objectif tempo : la courbe de progression du tempo');
    check(await carte('Gamme avec tempo').locator('.st-dur').count() === 0 && !/Durée réelle de chaque séance/i.test(d1), '5. … et PAS le graphique des durées');
    check(!/Tu n'y passes|Tu dépasses|Moins de 3 min/i.test(d1), '5. … ni d\'alerte de durée (3 min réelles pour 10 prévues auraient déclenché « Tu n\'y passes que… » avant)');
    await carte('Legato libre').locator('.st-ex-row').click(); await page.waitForTimeout(250);
    const d2 = await carte('Legato libre').innerText();
    check(await carte('Legato libre').locator('.st-dur').count() === 1 && /Durée réelle de chaque séance/i.test(d2), '6. détail d\'un exercice sans objectif : le graphique des durées');
    check(await carte('Legato libre').locator('.st-tempo').count() === 0 && !/Progression du tempo/i.test(d2), '6. … et PAS de courbe de tempo');
    check(/Tu n'y passes en moyenne que 3 min sur 10 min prévues/.test(d2), '6. … avec son alerte de durée');
    // 7. un exercice à objectif tempo sans tempo noté : conseil, pas de graphique
    await carte('Sans métronome').locator('.st-ex-row').click(); await page.waitForTimeout(250);
    check(/Aucun tempo noté sur cette période/i.test(await carte('Sans métronome').innerText()) && await carte('Sans métronome').locator('.st-dur').count() === 0, '7. détail sans tempo noté : explication, et toujours pas de durées');

    // 8. filtre « À surveiller » : seul l'exercice à alerte reste, le groupe vide disparaît
    await page.locator('.st-ex-chips button', { hasText: 'À surveiller' }).click(); await page.waitForTimeout(250);
    const t3 = await page.locator('.st-ex-group strong').allInnerTexts();
    check(t3.length === 1 && /^Sans objectif tempo · 1 exercice$/.test(t3[0].trim()) && await page.locator('.st-ex').count() === 1, `8. « À surveiller » : seul « Legato libre » (alerte de durée) ; le groupe vide disparaît (${JSON.stringify(t3)})`);
    await page.locator('.st-ex-chips button', { hasText: 'Tous' }).click(); await page.waitForTimeout(250);
    // 9. tri : « meilleure progression du tempo » concerne le groupe tempo
    await page.locator('.st-ex-sort').selectOption('gain'); await page.waitForTimeout(250);
    const o2 = await page.locator('.st-ex').evaluateAll(l => l.map(e => e.querySelector('.st-ex-name').childNodes[0].textContent));
    check(o2[0] === 'Gamme avec tempo' && o2[2] === 'Legato libre', `9. tri par progression du tempo : le groupe tempo reste en tête, « Gamme avec tempo » d'abord (${JSON.stringify(o2)})`);
    // 10. point retiré : le clic droit sur un point du tempo marche toujours
    await page.waitForSelector('.st-tempo .st-pt');
    check(await page.locator('.st-tempo .st-pt').count() === 6, '10. la courbe du tempo montre ses 6 points');
    // 11. les autres onglets restent intacts
    await page.click('.st-tab[data-tab="split"]'); await page.waitForTimeout(250);
    check(/Les plus travaillés/i.test(await page.locator('.gs-stat-title').allInnerTexts().then(a => a.join('|'))), '11. l\'onglet Répartition garde ses durées par exercice');
    await page.click('.st-tab[data-tab="overview"]'); await page.waitForTimeout(250);
    check(/Chiffres clés/i.test(await page.locator('.gs-stat-title').allInnerTexts().then(a => a.join('|'))), '11. l\'Aperçu garde ses chiffres clés');
    // 12. téléphone : même contenu, en colonnes
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
    await page.click('.st-tab[data-tab="ex"]'); await page.waitForTimeout(300);
    check(await page.locator('.st-ex-group').count() === 2 && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '12. sur téléphone : les deux groupes, sans débordement');
    check(erreurs.length === 0, '13. aucune erreur JavaScript ' + JSON.stringify(erreurs));
    await ctx.close();
    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
