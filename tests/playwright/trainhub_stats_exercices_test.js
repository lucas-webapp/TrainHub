// Statistiques › onglet Exercices (v281-v282) : deux VUES à basculer. « Tempo progressif » = les exercices à objectif tempo, SEULEMENT leur progression de tempo, date après date ;
// « Durées » = les exercices sans objectif tempo, SEULEMENT le temps passé (réel contre prévu). Rien de mélangé.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_stats_exercices_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : statistiques par exercice — objectif tempo (tempo seul) / sans objectif (durée seule)');
const estBruitReseau = harnais.estBruitReseau;
plan(26);
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
    const noms = () => page.locator('.st-ex').evaluateAll(l => l.map(e => e.querySelector('.st-ex-name').childNodes[0].textContent));
    const mode = m => page.locator('.st-ex-mode-btn[data-mode="' + m + '"]');

    // 1. deux vues à basculer, avec leur nombre d'exercices ; « Tempo progressif » s'ouvre d'abord quand il y en a
    check(await page.locator('.st-ex-mode-btn').count() === 2 && /Tempo progressif/.test(await mode('tempo').innerText()) && /Durées/.test(await mode('dur').innerText()), '1. deux vues : « Tempo progressif » et « Durées »');
    check((await mode('tempo').locator('.st-ex-mode-n').innerText()) === '2' && (await mode('dur').locator('.st-ex-mode-n').innerText()) === '1', '1. … avec leur nombre d\'exercices (2 à objectif tempo, 1 sans)');
    check(await mode('tempo').getAttribute('aria-pressed') === 'true' && await mode('dur').getAttribute('aria-pressed') === 'false', '1. « Tempo progressif » est la vue ouverte au départ');
    let n1 = await noms();
    check(n1.length === 2 && n1.includes('Gamme avec tempo') && n1.includes('Sans métronome') && !n1.includes('Legato libre'), `1. la vue Tempo ne montre que les exercices à objectif tempo (${JSON.stringify(n1)})`);

    // 2. l'en-tête d'un exercice à objectif tempo : le tempo, pas la durée
    const t1 = await textes('Gamme avec tempo');
    check(/100 → 110 BPM \(\+10\)/.test(t1) && /6 séances avec tempo/.test(t1), `2. vue Tempo : « ${t1.replace(/\s+/g, ' ')} »`);
    check(!/min en moyenne|\/ 10 min|3 min|%/.test(t1) && await carte('Gamme avec tempo').locator('.st-ex-dur').count() === 0, '2. … aucune durée dans cet en-tête');
    check(await carte('Gamme avec tempo').locator('.gs-stat-spark').count() === 1, '2. … mais la petite courbe de progression');
    const t4 = await textes('Sans métronome');
    check(/aucun tempo noté/.test(t4) && /6 séances/.test(t4) && !/0 séance/.test(t4), `3. objectif tempo sans tempo noté : « ${t4.replace(/\s+/g, ' ')} »`);

    // 4. le détail d'un exercice à objectif tempo : la courbe seulement
    await carte('Gamme avec tempo').locator('.st-ex-row').click(); await page.waitForTimeout(250);
    const d1 = await carte('Gamme avec tempo').innerText();
    check(await carte('Gamme avec tempo').locator('.st-tempo').count() === 1 && /Progression du tempo/i.test(d1), '4. détail : la courbe de progression du tempo');
    check(await carte('Gamme avec tempo').locator('.st-dur').count() === 0 && !/Durée réelle de chaque séance/i.test(d1), '4. … et PAS le graphique des durées');
    check(!/Tu n'y passes|Tu dépasses|Moins de 3 min/i.test(d1), '4. … ni d\'alerte de durée (3 min réelles pour 10 prévues en auraient déclenché une avant)');
    await carte('Sans métronome').locator('.st-ex-row').click(); await page.waitForTimeout(250);
    check(/Aucun tempo noté sur cette période/i.test(await carte('Sans métronome').innerText()) && await carte('Sans métronome').locator('.st-dur').count() === 0, '5. sans tempo noté : explication, et toujours pas de durées');
    check(await page.locator('.st-tempo .st-pt').count() === 6, '5. la courbe du tempo montre ses 6 points (clic droit : retirer un point, comme avant)');

    // 6. vue Tri : propre à la vue
    const optTempo = await page.locator('.st-ex-sort option').allInnerTexts();
    check(optTempo.some(t => /progression du tempo/i.test(t)) && !optTempo.some(t => /Plus travaillés/.test(t)), `6. tri de la vue Tempo : « Meilleure progression du tempo », pas « Plus travaillés » (${JSON.stringify(optTempo)})`);
    // 7. « À surveiller » : aucun exercice à tempo n'a d'alerte ici
    await page.locator('.st-ex-chips button', { hasText: 'À surveiller' }).click(); await page.waitForTimeout(250);
    check(await page.locator('.st-ex').count() === 0 && /Aucun exercice à surveiller/.test((await page.locator('.gs-empty').allInnerTexts()).join('|')), '7. « À surveiller » dans la vue Tempo : rien (leurs durées ne déclenchent plus d\'alerte)');
    await page.locator('.st-ex-chips button', { hasText: 'Tous' }).click(); await page.waitForTimeout(250);

    // 8. la vue Durées : l'exercice sans objectif tempo, la durée seulement
    await mode('dur').click(); await page.waitForTimeout(250);
    n1 = await noms();
    check(n1.length === 1 && n1[0] === 'Legato libre' && await mode('dur').getAttribute('aria-pressed') === 'true', `8. la vue Durées ne montre que « Legato libre » (${JSON.stringify(n1)})`);
    const t2 = await textes('Legato libre');
    check(/6 séances/.test(t2) && /3 \/ 10 min/.test(t2) && !/BPM/.test(t2) && await carte('Legato libre').locator('.st-ex-tempo, .gs-stat-spark').count() === 0, `8. durée seulement, aucun BPM même noté : « ${t2.replace(/\s+/g, ' ')} »`);
    await carte('Legato libre').locator('.st-ex-row').click(); await page.waitForTimeout(250);
    const d2 = await carte('Legato libre').innerText();
    check(await carte('Legato libre').locator('.st-dur').count() === 1 && /Durée réelle de chaque séance/i.test(d2) && await carte('Legato libre').locator('.st-tempo').count() === 0 && !/Progression du tempo/i.test(d2), '9. détail : le graphique des durées, pas de courbe de tempo');
    check(/Tu n'y passes en moyenne que 3 min sur 10 min prévues/.test(d2), '9. … avec son alerte de durée');
    const optDur = await page.locator('.st-ex-sort option').allInnerTexts();
    check(optDur.some(t => /Plus travaillés/.test(t)) && !optDur.some(t => /progression du tempo/i.test(t)), `10. tri de la vue Durées : « Plus travaillés », pas de progression du tempo (${JSON.stringify(optDur)})`);
    await page.locator('.st-ex-chips button', { hasText: 'À surveiller' }).click(); await page.waitForTimeout(250);
    check(await page.locator('.st-ex').count() === 1, '10. « À surveiller » dans la vue Durées : « Legato libre » (alerte de durée) reste');
    await page.locator('.st-ex-chips button', { hasText: 'Tous' }).click(); await page.waitForTimeout(250);

    // 11. le choix de vue est gardé quand on change d'onglet puis qu'on revient
    await page.click('.st-tab[data-tab="split"]'); await page.waitForTimeout(250);
    check(/Les plus travaillés/i.test(await page.locator('.gs-stat-title').allInnerTexts().then(a => a.join('|'))), '11. l\'onglet Répartition garde ses durées par exercice');
    await page.click('.st-tab[data-tab="overview"]'); await page.waitForTimeout(250);
    check(/Chiffres clés/i.test(await page.locator('.gs-stat-title').allInnerTexts().then(a => a.join('|'))), '11. l\'Aperçu garde ses chiffres clés');
    await page.click('.st-tab[data-tab="ex"]'); await page.waitForTimeout(250);
    check(await mode('dur').getAttribute('aria-pressed') === 'true', '11. en revenant dans Exercices, la vue Durées est toujours la vue choisie');
    // 12. téléphone
    await mode('tempo').click(); await page.waitForTimeout(200);
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
    check(await page.locator('.st-ex-mode-btn').count() === 2 && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '12. sur téléphone : les deux vues, sans débordement');
    check(erreurs.length === 0, '13. aucune erreur JavaScript ' + JSON.stringify(erreurs));
    await ctx.close();
    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
