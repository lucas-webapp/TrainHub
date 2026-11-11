// Légende « Dernière fois jouée » en bas de la fiche (v274) : texte court (« hier (mardi 10 novembre). Environ N séances par mois. »),
// et, pour un exercice avec objectif tempo, le dernier tempo atteint.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_derniere_ligne_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : légende « Dernière fois jouée » — texte court, rythme mensuel, dernier tempo');
plan(16);

(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', colorScheme: 'dark' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.addInitScript(() => { try {
        localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1');
        if (sessionStorage.getItem('__seed')) return; sessionStorage.setItem('__seed', '1');
        const ex = (id, title, o) => Object.assign({ id, title, notes: '', collapsed: false, links: [], files: [], images: [], favorite: false, archived: false, updatedAt: 1, tempoGoal: true }, o || {});
        localStorage.setItem('trainhub.v1', JSON.stringify({ activeInstrumentId: 'i1', updatedAt: 1, instruments: [{ id: 'i1', name: 'Basse', categories: [
            { id: 'c1', name: 'Technique', color: '#e91e63', folders: [], exercises: [
                ex('g', 'Gamme avec tempo'), ex('n', 'Gamme sans objectif', { tempoGoal: false }), ex('r', 'Rare'), ex('u', 'Sans tempo noté'), ex('j', 'Jamais') ] }] }], settings: {} }));
        const mk = d => d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1);
        const par = {};
        const st = (exId, bpm) => ({ sid: 's' + Math.random(), exerciseId: exId, title: exId, chapterId: 'c1', chapterName: 'Technique', path: ['Technique'], pathIds: ['c1'], plannedMin: 5, actualSec: 300, bpmFirst: bpm, bpmMax: bpm, bpmEnd: bpm, playedSec: 0 });
        let k = 0;
        const rec = (jours, steps) => { const d = new Date(); d.setDate(d.getDate() - jours); d.setHours(18, 0, 0, 0); const r = { v: 2, id: 'r' + (k++), instrumentId: 'i1', date: d.getTime(), endedAt: d.getTime() + 1200000, totalSec: 300 * steps.length, plannedSec: 0, sessionId: 'free', name: 'Session libre', free: true, steps }; (par[mk(d)] = par[mk(d)] || []).push(r); };
        // journal de 100 jours (≈ 3,3 mois) : « g » et « n » 5 séances, « r » 1 seule (la plus ancienne), « u » 3 sans tempo noté
        rec(100, [st('g', 80), st('n', 80), st('r', 70), st('u', null)]);
        rec(70, [st('g', 100), st('n', 100)]);
        rec(40, [st('g', 120), st('n', 120), st('u', null)]);
        rec(10, [st('g', 110), st('n', 110), st('u', null)]);
        rec(2, [st('g', null), st('n', null)]);
        Object.keys(par).forEach(key => localStorage.setItem('trainhub.log.' + key, JSON.stringify({ records: par[key], deleted: [], updatedAt: Date.now() })));
    } catch (e) { } });
    await page.goto('http://localhost:8765/index.html');
    await page.waitForTimeout(900);
    await page.locator('.tree-node > .tree-row', { hasText: 'Technique' }).first().click();
    await page.waitForTimeout(400);
    const ligne = async id => (await page.locator(`.exercise[data-ex-id="${id}"] .ex-last-played`).innerText()).replace(/\s+/g, ' ');

    const g = await ligne('g');
    check(/^Dernière fois jouée : il y a 2 jours \(\p{L}+ \d+ \p{L}+\)\./u.test(g), '1. « il y a 2 jours (jour date mois). » : « ' + g + ' »');
    check(!/session libre|« |depuis le/.test(g), '1. plus de détail de la session ni de « depuis le … »');
    check(/Environ 2 séances par mois\./.test(g), '2. rythme : 5 séances sur ≈ 3,3 mois → « Environ 2 séances par mois. »');
    check(/Dernier tempo atteint : 110 BPM\.$/.test(g), '3. objectif tempo : dernier tempo atteint = 110 BPM (la plus récente séance qui en a un, pas le meilleur ni la dernière séance sans tempo)');
    check(g.length < 130 && g.replace(/ Dernier tempo.*$/, '').length < 90, '4. la légende est courte (' + g.length + ' caractères avec le tempo, ' + g.replace(/ Dernier tempo.*$/, '').length + ' sans)');
    const n = await ligne('n');
    check(/Environ 2 séances par mois\./.test(n) && !/tempo/i.test(n), '5. sans objectif tempo : pas de mention du tempo : « ' + n + ' »');
    const r = await ligne('r');
    check(/Moins d'une séance par mois\./.test(r), '6. 1 séance sur plus de 3 mois : « Moins d\'une séance par mois. » : « ' + r + ' »');
    check(/Dernier tempo atteint : 70 BPM\./.test(r), '7. … et son tempo (70 BPM) est rappelé');
    const u = await ligne('u');
    check(/Environ 1 séance par mois\./.test(u) && !/tempo/i.test(u), '8. 3 séances / 3,3 mois → « Environ 1 séance par mois. », aucun tempo noté → pas de mention : « ' + u + ' »');
    const j = await ligne('j');
    check(/^Jamais jouée en session depuis le/.test(j), '9. exercice jamais joué : « Jamais jouée en session… » inchangé');
    check(await page.locator('.ex-last-played').count() === 5, '10. une légende par fiche ouverte');
    // un exercice SANS tempoGoal défini (anciens exercices : objectif tempo actif par défaut) montre aussi le tempo
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('trainhub.v1')); delete s.instruments[0].categories[0].exercises[0].tempoGoal; localStorage.setItem('trainhub.v1', JSON.stringify(s)); });
    await page.reload(); await page.waitForTimeout(900);
    await page.locator('.tree-node > .tree-row', { hasText: 'Technique' }).first().click(); await page.waitForTimeout(400);
    check(/Dernier tempo atteint : 110 BPM\./.test(await ligne('g')), '11. objectif tempo absent du fichier = actif (comme avant) : le tempo est montré');
    // objectif retiré : le tempo disparaît de la légende
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('trainhub.v1')); s.instruments[0].categories[0].exercises[0].tempoGoal = false; localStorage.setItem('trainhub.v1', JSON.stringify(s)); });
    await page.reload(); await page.waitForTimeout(900);
    await page.locator('.tree-node > .tree-row', { hasText: 'Technique' }).first().click(); await page.waitForTimeout(400);
    check(!/tempo/i.test(await ligne('g')), '12. objectif tempo retiré : plus de tempo dans la légende');
    check(/Environ 2 séances par mois\./.test(await ligne('g')), '13. … le reste de la légende est inchangé');
    check(await page.locator('.toast').count() === 0, '14. information seule : aucun message');
    check(erreurs.length === 0, '15. aucune erreur JavaScript ' + JSON.stringify(erreurs));
    await ctx.close();
    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
