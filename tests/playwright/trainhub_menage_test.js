// v258 : « Dernière fois jouée » en bas de la fiche, créer une session à partir d'une séance jouée, ménage des artistes et des doublons.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_menage_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : dernière fois jouée, session depuis une séance, ménage des artistes');
const estBruitReseau = harnais.estBruitReseau;
plan(39);
const URL = 'http://localhost:8765/index.html';

async function ouvrir(browser, { journal = true, live = null } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', colorScheme: 'dark' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !estBruitReseau(m.text()) && !/ERR_FAILED/.test(m.text())) erreurs.push('console: ' + m.text()); });
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.addInitScript(({ avecJournal, live }) => {
        try {
            localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1');
            if (sessionStorage.getItem('__seed')) return;
            sessionStorage.setItem('__seed', '1');
            const ex = (id, title, o) => Object.assign({ id, title, notes: '', collapsed: true, links: [], files: [], images: [], favorite: false, archived: false, updatedAt: 1 }, o || {});
            const song = (id, artist, name) => ex(id, artist + ' - ' + name, { isSong: true, artist, songName: name, styles: [], techniques: [], work: '' });
            localStorage.setItem('trainhub.v1', JSON.stringify({ activeInstrumentId: 'i1', updatedAt: 1, instruments: [{ id: 'i1', name: 'Basse', categories: [
                { id: 'c1', name: 'Technique', color: '#e91e63', folders: [], exercises: [ex('t1', 'Gamme lente'), ex('t2', 'Legato'), ex('t3', 'Arpèges')] },
                { id: 'c3', name: 'Autre', color: '#2196f3', folders: [], exercises: [ex('t4', 'Gamme lente', { links: [{ id: 'l1', label: 'x', url: 'https://youtube.com/watch?v=aaaaaaaaaaa' }] })] },
                { id: 'c2', name: 'Morceaux', color: '#00e676', kind: 'songs', folders: [], vocab: { styles: ['Rock'], techniques: [], work: ['En cours', 'À maîtriser', 'Maîtrisé', 'Plus tard'] }, exercises: [
                    song('m1', 'Red Hot Chili Peppers', 'Californication'), song('m2', 'RHCP', 'Snow'), song('m3', 'Future islands', 'Seasons'), song('m4', 'Futur islands', 'Tin Man'),
                    song('m5', 'Sade', 'Smooth Operator'), song('m6', 'The Beatles', 'Help'), song('m7', 'Beatles', 'Yesterday')
                ] }
            ] }], settings: { guidedSessions: [{ id: 'g1', name: 'Session vitesse', instrumentId: 'i1', tabIds: [], createdAt: 1, steps: [{ id: 'p1', exerciseId: 't4', minutes: 5 }] }] } }));
            if (live) localStorage.setItem('trainhub.gsLive.v1', JSON.stringify(live));
            if (!avecJournal) return;
            const mk = d => d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1);
            const par = {};
            const st = (id, exId, t, s) => ({ sid: id, exerciseId: exId, title: t, chapterId: 'c1', chapterName: 'Technique', path: ['Technique'], pathIds: ['c1'], plannedMin: Math.round(s / 60), actualSec: s, bpmFirst: null, bpmMax: null, bpmEnd: null, playedSec: 0 });
            const rec = (id, jours, o, steps) => { const d = new Date(); d.setDate(d.getDate() - jours); d.setHours(18, 0, 0, 0); const r = Object.assign({ v: 2, id, instrumentId: 'i1', date: d.getTime(), endedAt: d.getTime() + 1200000, totalSec: steps.reduce((a, x) => a + x.actualSec, 0), plannedSec: 0, steps }, o); (par[mk(d)] = par[mk(d)] || []).push(r); };
            rec('r1', 2, { sessionId: 'free', name: 'Session libre', free: true }, [st('a1', 't1', 'Gamme lente', 600), st('a2', 'm1', 'Californication', 30)]);
            rec('r2', 20, { sessionId: 'g1', name: 'Session vitesse' }, [st('b1', 't3', 'Arpèges', 300), st('b2', 't1', 'Gamme lente', 300)]);
            Object.keys(par).forEach(k => localStorage.setItem('trainhub.log.' + k, JSON.stringify({ records: par[k], deleted: [], updatedAt: Date.now() })));
        } catch (e) { }
    }, { avecJournal: journal, live });
    await page.goto(URL);
    await page.waitForTimeout(700);
    return { ctx, page, erreurs };
}
const etatPage = page => page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.v1')));
const sauve = page => page.waitForTimeout(700);
const exo = (st, id) => { let r = null; st.instruments[0].categories.forEach(c => { (function w(f) { (f.exercises || []).forEach(e => { if (e.id === id) r = e; }); (f.folders || []).forEach(w); })(c); }); return r; };
async function ouvrirChapitre(page, nom) { await page.locator('.tree-node > .tree-row', { hasText: nom }).first().click(); await page.waitForTimeout(300); }
async function ouvrirFiche(page, id) { await page.locator('.exercise[data-ex-id="' + id + '"] .exercise-row-spacer').click(); await page.waitForTimeout(300); }
const derniere = (page, id) => page.locator('.exercise[data-ex-id="' + id + '"] .ex-last-played');
async function ouvrirHistorique(page) {
    await page.click('#guided-session-btn'); await page.waitForSelector('.gs-history-btn');
    await page.click('.gs-history-btn'); await page.waitForSelector('.gs-history-entry');
}

(async () => {
    const browser = await chromium.launch();

    // ============ A. Dernière fois jouée, tout en bas de la fiche ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await ouvrirChapitre(page, 'Technique');
        await ouvrirFiche(page, 't1');
        const t1 = (await derniere(page, 't1').innerText()).replace(/\s+/g, ' ');
        check(/Dernière fois jouée : il y a 2 jours/.test(t1) && /session libre/.test(t1) && /2 séances/.test(t1), 'A. « Gamme lente » : il y a 2 jours, session libre, 2 séances : « ' + t1 + ' »');
        check(await page.locator('.exercise[data-ex-id="t1"] .ex-last-played').evaluate(e => { const d = e.closest('.exercise-details') || e.parentElement; return d.lastElementChild === e; }), 'A. la ligne est bien tout en bas de la fiche ouverte');
        await ouvrirFiche(page, 't2');
        check(/Jamais jouée en session depuis le/.test(await derniere(page, 't2').innerText()), 'A. « Legato » (jamais joué) : « Jamais jouée en session depuis le… »');
        await ouvrirFiche(page, 't3');
        const t3 = (await derniere(page, 't3').innerText()).replace(/\s+/g, ' ');
        check(/il y a 20 jours/.test(t3) && /« Session vitesse »/.test(t3) && /1 séance depuis/.test(t3), 'A. « Arpèges » : il y a 20 jours, session « Session vitesse », 1 séance : « ' + t3 + ' »');
        check(await page.locator('.ex-last-played').count() === 1 && await page.locator('.toast').count() === 0 && await page.locator('.exercise-wip-badge, .exercise-stale-badge').count() === 0, 'A. information seule : une seule ligne (celle de la fiche ouverte), aucun rappel ni pastille ailleurs');
        check(erreurs.length === 0, 'A. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { journal: false });
        await ouvrirChapitre(page, 'Technique');
        await ouvrirFiche(page, 't1');
        check(await derniere(page, 't1').isHidden(), 'A. journal vide : rien n\'est affiché (pas de faux « jamais joué »)');
        await ctx.close();
    }

    // ============ B. Créer une session à partir d'une séance jouée ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await ouvrirHistorique(page);
        const e = page.locator('.gs-history-entry', { hasText: 'Session libre' }).first();
        check(await e.locator('.gs-history-mksess').count() === 1, 'B. l\'historique propose « ＋ » sur chaque séance');
        await e.locator('.gs-history-mksess').click();
        await page.waitForSelector('.gs-fromrec-pop');
        const rows = page.locator('.gs-fromrec-row');
        check(await rows.count() === 2 && await rows.nth(0).locator('input').isChecked() && !(await rows.nth(1).locator('input').isChecked()), 'B. deux exercices ; « Gamme lente » (10 min) coché, « Californication » (30 s) décoché');
        check(/10 min/.test(await rows.nth(0).innerText()) && /1 min/.test(await rows.nth(1).innerText()), 'B. durées arrondies à la minute (10 min, 1 min)');
        check(/1 exercice · 10 min/.test(await page.locator('.gs-fromrec-sum').innerText()), 'B. résumé : 1 exercice · 10 min');
        await rows.nth(1).locator('input').check(); await page.waitForTimeout(150);
        check(/2 exercices · 11 min/.test(await page.locator('.gs-fromrec-sum').innerText()), 'B. en cochant le 2e : 2 exercices · 11 min');
        check(/^Session du \d\d-\d\d-\d{4}$/.test(await page.locator('.gs-fromrec-pop .gs-keep-name').inputValue()), 'B. nom proposé : « Session du JJ-MM-AAAA »');
        await page.locator('.gs-fromrec-pop .gs-keep-name').fill('Ma séance libre');
        await page.locator('.gs-fromrec-ok').click(); await sauve(page);
        const g = (await etatPage(page)).settings.guidedSessions.find(x => x.name === 'Ma séance libre');
        check(!!g && g.steps.length === 2 && g.steps[0].exerciseId === 't1' && g.steps[0].minutes === 10 && g.steps[1].exerciseId === 'm1' && g.steps[1].minutes === 1 && !g.ephemeral, 'B. la session existe avec les 2 pas, dans l\'ordre, avec leurs durées');
        check(/créée/.test(await page.locator('.toast').first().innerText().catch(() => '')) && await page.locator('.toast-action', { hasText: 'Ouvrir' }).count() === 1, 'B. un message l\'annonce et propose « Ouvrir »');
        check((await etatPage(page)).settings.guidedSessions.length === 2, 'B. rien d\'autre n\'a changé (2 sessions en tout)');
        check(erreurs.length === 0, 'B. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ C. Ménage des artistes ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await ouvrirChapitre(page, 'Morceaux');
        await page.locator('.songs-cleanup-btn').click();
        await page.waitForSelector('.songs-cleanup-panel');
        const groupes = page.locator('.songs-cleanup-group[data-kind="artist"]');
        const txt = await groupes.allInnerTexts();
        check(await groupes.count() === 3, 'C. trois groupes de variantes repérés : ' + txt.map(t => t.split('\n')[0] + '/' + (t.split('\n')[1] || '')).join(' ; '));
        check(txt.some(t => /Red Hot Chili Peppers/.test(t) && /RHCP/.test(t)) && txt.some(t => /Future islands/.test(t) && /Futur islands/.test(t)) && txt.some(t => /The Beatles/.test(t) && /\bBeatles \(/.test(t)), 'C. RHCP ↔ Red Hot Chili Peppers (sigle), Futur ↔ Future (faute), Beatles ↔ The Beatles (« The »)');
        check(!txt.some(t => /Sade/.test(t)), 'C. « Sade » (seul) n\'est dans aucun groupe');
        const rhcp = groupes.filter({ hasText: 'RHCP' });
        check(await rhcp.locator('.songs-cleanup-go').innerText() === 'Fusionner sous « Red Hot Chili Peppers »', 'C. nom proposé : « Red Hot Chili Peppers » (le plus long à égalité)');
        await rhcp.locator('input[type="radio"]').nth(1).check(); await page.waitForTimeout(150);
        check(/Fusionner sous « RHCP »/.test(await rhcp.locator('.songs-cleanup-go').innerText()), 'C. on peut choisir un autre nom à garder (le bouton suit)');
        await rhcp.locator('input[type="radio"]').nth(0).check();
        await rhcp.locator('.songs-cleanup-go').click(); await sauve(page);
        let st = await etatPage(page);
        check(exo(st, 'm2').artist === 'Red Hot Chili Peppers' && exo(st, 'm2').title === 'Red Hot Chili Peppers - Snow' && exo(st, 'm1').title === 'Red Hot Chili Peppers - Californication', 'C. fusion : « RHCP - Snow » devient « Red Hot Chili Peppers - Snow »');
        check(await page.locator('.songs-cleanup-group[data-kind="artist"]').count() === 2, 'C. le groupe disparaît de la liste (2 restants)');
        await page.locator('.songs-cleanup-group[data-kind="artist"]', { hasText: 'Beatles' }).locator('.songs-cleanup-no').click(); await page.waitForTimeout(200);
        check(await page.locator('.songs-cleanup-group[data-kind="artist"]').count() === 1, 'C. « Pas les mêmes » retire le groupe Beatles');
        st = await etatPage(page);
        check(exo(st, 'm7').artist === 'Beatles' && exo(st, 'm6').artist === 'The Beatles', 'C. et ne change rien aux morceaux');
        // doublons de titre
        const dup = page.locator('.songs-cleanup-group[data-kind="dup"]');
        check(await dup.count() === 1 && /« Gamme lente » × 2/.test(await dup.innerText()), 'C. « Gamme lente » × 2 repéré dans les doublons');
        const opts = await dup.locator('.songs-cleanup-opt').allInnerTexts();
        check(/Technique/.test(opts[0]) && /jouée 3 fois|jouée 2 fois/.test(opts[0]) && /Autre/.test(opts[1]) && /jamais jouée/.test(opts[1]), 'C. celui qui a servi est proposé en premier : ' + JSON.stringify(opts));
        await dup.locator('.songs-cleanup-go').click();
        await page.locator('.app-dialog button', { hasText: /^Fusionner$/ }).click(); await sauve(page);
        st = await etatPage(page);
        check(!exo(st, 't4') && !!exo(st, 't1'), 'C. le doublon (chapitre « Autre ») est retiré, l\'exercice joué est gardé');
        check((st.settings.trash || []).some(t => t.type === 'exercise' && t.data && t.data.id === 't4'), 'C. il est à la corbeille (rétablissable)');
        check(st.settings.guidedSessions[0].steps[0].exerciseId === 't1', 'C. la session qui l\'utilisait passe sur l\'exercice gardé');
        check(await page.locator('.songs-cleanup-group[data-kind="dup"]').count() === 0 && /Aucun doublon/.test(await page.locator('.songs-cleanup-body').innerText()), 'C. plus de doublon dans la liste');
        check(erreurs.length === 0, 'C. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        // le « pas les mêmes » est retenu
        await page.reload(); await page.waitForTimeout(700);
        await ouvrirChapitre(page, 'Morceaux');
        await page.locator('.songs-cleanup-btn').click(); await page.waitForSelector('.songs-cleanup-panel');
        const gr = await page.locator('.songs-cleanup-group[data-kind="artist"]').allInnerTexts();
        check(gr.length === 1 && /Futur/.test(gr[0]), 'C. après rechargement : seul le groupe Futur / Future reste (Beatles toujours écarté)');
        await ctx.close();
    }

    // ============ D. Fin d'une session libre : « en faire une session ? » ============
    {
        const now = Date.now();
        const live = { v: 1, kind: 'free', savedAt: now, startedAt: now - 1200000, sessionId: 'free', name: 'Session libre', instrumentId: 'i1', spent: { 'free:t2': 420000, 'free:t3': 300000, 'free:t1': 20000 }, bpm: {}, totalMs: 740000, steps: [{ id: 'free:t2', exerciseId: 't2', minutes: 0 }, { id: 'free:t3', exerciseId: 't3', minutes: 0 }, { id: 'free:t1', exerciseId: 't1', minutes: 0 }] };
        const { ctx, page, erreurs } = await ouvrir(browser, { live });
        await page.waitForSelector('.gs-live-resume', { timeout: 8000 });
        await page.click('.gs-live-resume'); await page.waitForTimeout(500);
        await page.locator('.free-stop').click();
        await page.waitForSelector('.gs-save-run-panel button.gs-rec-save');
        await page.locator('.gs-save-run-panel button.gs-rec-save').click();
        const quand = page.locator('.app-dialog button', { hasText: /Enregistrer quand même/ });
        if (await quand.waitFor({ timeout: 1500 }).then(() => true, () => false)) await quand.click();
        await page.waitForTimeout(500);
        const act = page.locator('.toast-action', { hasText: 'Créer une session' });
        check(await act.count() === 1 && /en faire une session/.test(await page.locator('.toast').first().innerText()), 'D. après l\'enregistrement de la session libre, le message propose « Créer une session »');
        await act.click(); await page.waitForSelector('.gs-fromrec-pop');
        const noms = await page.locator('.gs-fromrec-name').allInnerTexts(), coch = await page.locator('.gs-fromrec-row input').evaluateAll(l => l.map(i => i.checked));
        check(noms.join('|') === 'Legato|Arpèges|Gamme lente' && coch.join(',') === 'true,true,false', 'D. les exercices dans l\'ordre où ils ont été joués ; celui joué 20 s est décoché : ' + noms.join('|') + ' / ' + coch.join(','));
        await page.locator('.gs-fromrec-pop .gs-keep-name').fill('Mon routine libre');
        await page.locator('.gs-fromrec-ok').click(); await sauve(page);
        const g = (await etatPage(page)).settings.guidedSessions.find(x => x.name === 'Mon routine libre');
        check(!!g && g.steps.map(x => x.exerciseId + ':' + x.minutes).join(',') === 't2:7,t3:5', 'D. la session créée : Legato 7 min, Arpèges 5 min');
        await page.locator('.toast-action', { hasText: 'Ouvrir' }).click(); await page.waitForTimeout(500);
        check(await page.locator('.gs-edit-topbar').count() === 1 && await page.locator('.gs-step-row').count() === 2, 'D. « Ouvrir » affiche la session (2 pas) pour l\'ajuster');
        check(erreurs.length === 0, 'D. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    await browser.close();
    bilan();
})();
