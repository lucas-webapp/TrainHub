// Tempo inhabituel à l'enregistrement d'une séance : hors statistiques si l'écart est grand (> 12 % de la médiane), confirmation s'il est moyen (6 à 12 %).
// Le banc charge script.js avec un crochet de test (injecté à la volée, le fichier du dépôt n'est pas modifié).
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_tempo_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : tempo inhabituel — écarté des statistiques ou confirmé');
plan(15);
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'script.js'), 'utf8');
const fin = SRC.lastIndexOf('})();');
const PATCHE = SRC.slice(0, fin) + ';window.__t={gsAskSaveRun:gsAskSaveRun,logAll:logAll,editLoggedRecord:editLoggedRecord,tempoOutlier:tempoOutlier};' + SRC.slice(fin);

async function ouvrir(browser) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', colorScheme: 'dark' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    await page.route('**/script.js', r => r.fulfill({ body: PATCHE, contentType: 'application/javascript' }));
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.addInitScript(() => { try {
        localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1');
        if (sessionStorage.getItem('__seed')) return; sessionStorage.setItem('__seed', '1');
        const ex = (id, title, o) => Object.assign({ id, title, notes: '', collapsed: true }, o || {});
        localStorage.setItem('trainhub.v1', JSON.stringify({ activeInstrumentId: 'i1', updatedAt: 1, instruments: [{ id: 'i1', name: 'Basse', categories: [{ id: 'c1', name: 'Technique', color: '#e91e63', folders: [], exercises: [ex('e1', 'Gamme lente'), ex('e2', 'Slap'), ex('e3', 'Legato', { tempoGoal: false })] }] }], settings: {} }));
        const jour = n => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(18, 0, 0, 0); return d.getTime(); };
        const rec = (id, n, exId, bpm) => ({ v: 2, id, sessionId: 'x', name: 'Séance', instrumentId: 'i1', date: jour(n), endedAt: jour(n) + 900000, totalSec: 900, plannedSec: 900, steps: [{ sid: 's' + id, exerciseId: exId, title: 'T', plannedMin: 15, actualSec: 900, bpmFirst: bpm, bpmMax: bpm, bpmEnd: bpm }] });
        const recs = [rec('h1', 9, 'e1', 98), rec('h2', 8, 'e1', 99), rec('h3', 6, 'e1', 100), rec('h4', 4, 'e1', 99), rec('h5', 2, 'e1', 100), rec('s1', 5, 'e2', 70), rec('s2', 3, 'e2', 72), rec('l1', 5, 'e3', 80), rec('l2', 4, 'e3', 80), rec('l3', 3, 'e3', 80)];
        const mois = {};
        recs.forEach(r => { const d = new Date(r.date), m = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); (mois[m] = mois[m] || []).push(r); });
        Object.keys(mois).forEach(m => localStorage.setItem('trainhub.log.' + m, JSON.stringify({ records: mois[m], deleted: [], updatedAt: 1 })));
    } catch (e) { } });
    await page.goto('http://localhost:8765/index.html');
    await page.waitForTimeout(800);
    return { ctx, page, erreurs };
}
// Enregistre une séance d'un seul exercice au tempo donné ; renvoie { dialogue, bpm, outlier, toast }
async function essai(page, exId, bpm, { reponse = null, id } = {}) {
    id = id || 'n' + Math.random().toString(36).slice(2, 7);
    await page.evaluate(({ exId, bpm, id }) => {
        const now = Date.now();
        window.__t.gsAskSaveRun({ v: 2, id, sessionId: 'x', name: 'Séance test', instrumentId: 'i1', date: now - 1000000, endedAt: now, totalSec: 900, plannedSec: 900,
            steps: [{ sid: 'z' + id, exerciseId: exId, title: 'T', plannedMin: 15, actualSec: 900, bpmFirst: bpm, bpmMax: bpm, bpmEnd: bpm }] }, [], 'Test');
    }, { exId, bpm, id });
    await page.waitForSelector('.gs-rec-save');
    await page.locator('.gs-rec-save').click();
    await page.waitForTimeout(400);
    if (await page.locator('.app-dialog', { hasText: 'Pas connecté' }).count()) { await page.locator('.app-dialog button', { hasText: 'Enregistrer quand même' }).click(); await page.waitForTimeout(400); }
    let dialogue = null;
    if (await page.locator('.app-dialog').count()) {
        dialogue = await page.locator('.app-dialog').innerText();
        if (reponse === 'revenir') { await page.locator('.app-dialog button', { hasText: 'Revenir' }).click(); await page.waitForTimeout(300); return { dialogue, revenu: await page.locator('.gs-rec-save').count() === 1 }; }
        await page.locator('.app-dialog button', { hasText: reponse === 'ecarter' ? 'écarter' : 'Garder' }).click();
        await page.waitForTimeout(500);
    }
    const toast = await page.locator('.toast').allInnerTexts();
    const st = await page.evaluate(id => { const r = window.__t.logAll().filter(x => x.id === id)[0]; return r ? r.steps[0] : null; }, id);
    await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
    return { dialogue, bpm: st && st.bpmMax, outlier: st && st.bpmOutlier, toast: toast.join(' '), saved: !!st };
}
(async () => {
    const browser = await chromium.launch();
    const { ctx, page, erreurs } = await ouvrir(browser);
    const u = await page.evaluate(() => [[99, [98, 99, 100]], [85, [98, 99, 100]], [115, [98, 99, 100]], [92, [98, 99, 100]], [105, [98, 99, 100]], [103, [98, 99, 100]], [80, [98, 99]]].map(([b, h]) => { const o = window.__t.tempoOutlier(b, h); return o ? o.level : null; }).join());
    check(u === ',drop,drop,ask,ask,,', `règle : 99 normal, 85 et 115 écartés, 92 et 105 demandés, 103 (dans la plage ± 3) normal, historique trop court : rien (${u})`);
    let r = await essai(page, 'e1', 99);
    check(!r.dialogue && r.bpm === 99 && !r.outlier, 'tempo habituel (99 pour 98–100) : enregistré sans question');
    r = await essai(page, 'e1', 85);
    check(!r.dialogue && r.bpm === null && r.outlier === 85 && r.saved, 'écart énorme (85 pour 98–100) : séance enregistrée, tempo laissé hors des statistiques');
    check(/85 BPM laissé hors des statistiques/.test(r.toast) && /98–100 BPM/.test(r.toast), 'un message le dit et rappelle le tempo habituel (« ' + r.toast.slice(0, 120) + ' »)');
    r = await essai(page, 'e1', 115);
    check(r.bpm === null && r.outlier === 115, 'idem au-dessus (115) : écarté');
    r = await essai(page, 'e1', 92);
    check(!!r.dialogue && /92 BPM/.test(r.dialogue) && /98–100 BPM/.test(r.dialogue), 'écart moyen (92) : on demande confirmation, en citant le tempo habituel');
    check(r.bpm === 92 && !r.outlier, '« Garder » : le tempo reste dans les statistiques');
    r = await essai(page, 'e1', 105, { reponse: 'ecarter' });
    check(!!r.dialogue && r.bpm === null && r.outlier === 105, '« L\'écarter » : séance enregistrée, tempo hors des statistiques');
    r = await essai(page, 'e1', 106, { reponse: 'revenir' });
    check(r.revenu === true, '« Revenir à la séance » : rien n\'est enregistré, la fenêtre de relecture reste ouverte');
    await page.evaluate(() => { Object.keys(localStorage).filter(k => /live|recentRuns/i.test(k)).forEach(k => localStorage.removeItem(k)); });
    await page.reload(); await page.waitForTimeout(800);
    r = await essai(page, 'e2', 55);
    check(!r.dialogue && r.bpm === 55, 'historique de 2 séances seulement : pas assez pour juger, tempo gardé');
    r = await essai(page, 'e3', 40);
    check(!r.dialogue && r.saved, 'exercice sans objectif tempo : aucune vérification');
    const e3 = await page.evaluate(() => window.__t.logAll().filter(x => x.steps[0].exerciseId === 'e3' && x.steps[0].bpmMax === 40).length);
    check(e3 === 1, 'et son tempo est inchangé');
    // modification d'une séance déjà enregistrée : pas de vérification
    const ancien = await page.evaluate(() => window.__t.logAll().filter(x => x.steps[0].exerciseId === 'e1' && x.steps[0].bpmMax === 99 && x.id.length > 3)[0]);
    await page.evaluate(id => { const rec = window.__t.logAll().filter(x => x.id === id)[0]; window.__t.editLoggedRecord(JSON.parse(JSON.stringify(rec)), function () {}); }, ancien.id);
    await page.waitForSelector('.gs-rec-save');
    const champ = page.locator('.gs-save-run-panel input.gs-rec-bpm, .gs-save-run-panel .gs-rec-bpm input, .gs-save-run-panel input[inputmode="numeric"]').first();
    const nChamps = await page.locator('.gs-save-run-panel input').count();
    check(nChamps > 0, 'la fenêtre « Modifier la séance » s\'ouvre');
    await page.locator('.gs-rec-save').click(); await page.waitForTimeout(400);
    if (await page.locator('.app-dialog', { hasText: 'Pas connecté' }).count()) { await page.locator('.app-dialog button', { hasText: 'Enregistrer quand même' }).click(); await page.waitForTimeout(400); }
    check(await page.locator('.app-dialog').count() === 0, 'enregistrer une modification : aucune question sur le tempo');
    check(erreurs.length === 0, 'aucune erreur JavaScript ' + JSON.stringify(erreurs));
    await ctx.close();
    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
