// Note (1 à 5 étoiles) et commentaire libre sur les séances enregistrées : historique (étoiles cliquables, commentaire), fenêtre « Modifier la séance »,
// retour en arrière, fusion des séances libres du même jour, calendrier. Les séances sont GRAINES directement dans le journal local.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_note_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : note et commentaire des séances');
const estBruitReseau = harnais.estBruitReseau;
plan(34);
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

async function ouvrir(browser, { viewport = { width: 1280, height: 900 }, theme = null, glass = false } = {}) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', colorScheme: 'dark' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !estBruitReseau(m.text()) && !/ERR_FAILED/.test(m.text())) erreurs.push('console: ' + m.text()); });
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.addInitScript(({ theme, glass }) => {
        try {
            localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1');
            if (theme) localStorage.setItem('trainhub.theme.v1', theme);
            if (glass) localStorage.setItem('trainhub.glass.v1', '1');
            if (sessionStorage.getItem('__seed')) return;
            sessionStorage.setItem('__seed', '1');
            const now = new Date(), mk = d => d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1);
            const jour = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };
            const step = (t, s) => ({ title: t, actualSec: s, plannedMin: Math.round(s / 60) });
            const recs = [
                { v: 2, id: 's1', name: 'Gammes du matin', date: jour(0, 5), endedAt: jour(0, 31), totalSec: 1500, plannedSec: 1500, steps: [step('Gamme de Do', 900), step('Arpèges', 600)] },
                { v: 2, id: 's2', name: 'Improvisation', date: jour(0, 6), endedAt: jour(0, 40), totalSec: 1200, plannedSec: 1200, steps: [step('Blues en La', 1200)] },
                { v: 2, id: 'f1', free: true, name: 'Session libre', date: jour(0, 10), endedAt: jour(0, 22), totalSec: 700, plannedSec: 0, rating: 2, comment: 'trop long', steps: [step('Basse', 700)] },
                { v: 2, id: 'f2', free: true, name: 'Session libre', date: jour(0, 40), endedAt: jour(0, 54), totalSec: 800, plannedSec: 0, rating: 5, comment: 'bon tempo', steps: [step('Basse', 800)] },
            ];
            const par = {};
            recs.forEach(r => { const k = mk(new Date(r.date)); (par[k] = par[k] || []).push(r); });
            Object.keys(par).forEach(k => localStorage.setItem('trainhub.log.' + k, JSON.stringify({ records: par[k], deleted: [], updatedAt: Date.now() })));
        } catch (e) { }
    }, { theme, glass });
    await page.goto('http://localhost:8765/index.html');
    await page.waitForTimeout(600);
    return { ctx, page, erreurs };
}
const enregistrement = (page, id) => page.evaluate(id => { const out = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.indexOf('trainhub.log.') === 0) { const d = JSON.parse(localStorage.getItem(k)); (d.records || []).forEach(r => out.push(r)); } } return out.find(r => r.id === id) || null; }, id);
async function ouvrirHistorique(page) {
    await page.click('#guided-session-btn');
    await page.waitForSelector('.gs-history-btn');
    await page.click('.gs-history-btn');
    await page.waitForSelector('.gs-history-entry');
}
const entree = (page, nom) => page.locator('.gs-history-entry', { hasText: nom }).first();
const etoiles = async e => e.locator('.rate-star.on').count();

(async () => {
    const browser = await chromium.launch();

    // ============ A. Historique : étoiles cliquables et commentaire ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await ouvrirHistorique(page);
        const n = await page.locator('.gs-history-entry').count();
        check(n === 3, `A. trois séances dans l'historique : « Gammes du matin », « Improvisation » et la session libre fusionnée (${n})`);
        const e1 = entree(page, 'Gammes du matin');
        check(await e1.locator('.rate-star').count() === 5 && await etoiles(e1) === 0, 'A. chaque séance a ses cinq étoiles, éteintes tant qu\'elle n\'a pas de note');
        await e1.locator('.rate-star[data-k="4"]').click();
        check(await etoiles(e1) === 4, 'A. un clic sur la 4e étoile allume quatre étoiles');
        let r = await enregistrement(page, 's1');
        check(r && r.rating === 4, `A. la note est enregistrée dans la séance (rating = ${r && r.rating})`);
        check((await e1.locator('.rate-star[data-k="4"]').getAttribute('title')).includes('Bien'), 'A. au survol : « 4 sur 5 : Bien »');
        await e1.locator('.rate-star[data-k="4"]').click();
        r = await enregistrement(page, 's1');
        check(await etoiles(e1) === 0 && r && r.rating === undefined, 'A. un clic sur l\'étoile déjà choisie efface la note');
        await e1.locator('.rate-star[data-k="2"]').click();
        // commentaire
        await e1.locator('.gs-history-cmt-btn').click();
        await page.waitForSelector('.app-dialog-input');
        check(await page.locator('.app-dialog-input').inputValue() === '', 'A. le commentaire s\'ouvre vide pour une séance sans commentaire');
        await page.locator('.app-dialog-input').fill('Exercice trop long, bon tempo');
        await page.locator('.app-dialog button', { hasText: /^Enregistrer$/ }).click();
        await page.waitForTimeout(200);
        r = await enregistrement(page, 's1');
        check(r && r.comment === 'Exercice trop long, bon tempo' && r.rating === 2, `A. commentaire enregistré sans toucher à la note (${r && r.comment} / ${r && r.rating})`);
        check((await e1.locator('.gs-history-comment').innerText()).includes('Exercice trop long'), 'A. et affiché sous la séance');
        await e1.locator('.gs-history-cmt-btn').click();
        await page.waitForSelector('.app-dialog-input');
        check(await page.locator('.app-dialog-input').inputValue() === 'Exercice trop long, bon tempo' && await page.locator('.app-dialog button', { hasText: /Effacer/ }).count() === 1, 'A. le commentaire se rouvre rempli, avec « Effacer »');
        await page.locator('.app-dialog button', { hasText: /Effacer/ }).click();
        await page.waitForTimeout(200);
        r = await enregistrement(page, 's1');
        check(r && r.comment === undefined && !(await e1.locator('.gs-history-comment').isVisible()), 'A. « Effacer » retire le commentaire');
        check(erreurs.length === 0, 'A. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ B. Séances libres du même jour fusionnées : la note la plus récente, les commentaires réunis ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await ouvrirHistorique(page);
        const e = entree(page, 'Session libre');
        const r = await enregistrement(page, 'f1');
        check(r && r.rating === 5 && r.totalSec === 1500 && /trop long/.test(r.comment) && /bon tempo/.test(r.comment), `B. fusion de deux séances libres : durée 25 min, note 5 (la plus récente), commentaires réunis (${r && r.rating} ; ${r && JSON.stringify(r.comment)})`);
        check(await etoiles(e) === 5, 'B. l\'historique montre cinq étoiles allumées');
        const t = await e.locator('.gs-history-comment').innerText();
        check(/trop long/.test(t) && /bon tempo/.test(t), 'B. et les deux commentaires');
        check(erreurs.length === 0, 'B. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ C. Fenêtre « Modifier la séance » : étoiles, commentaire, retour en arrière, abandon ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await ouvrirHistorique(page);
        const e2 = entree(page, 'Improvisation');
        await e2.locator('.gs-sync-row button[title^="Modifier cette séance"]').click();
        await page.waitForSelector('.gs-save-run-panel .gs-rec-rate');
        const p = page.locator('.gs-save-run-panel');
        check(await p.locator('.rate-star').count() === 5 && await p.locator('textarea.gs-rec-comment').count() === 1, 'C. la fenêtre propose les cinq étoiles et un commentaire libre');
        check((await p.locator('.rate-label').innerText()).includes('Pas de note'), 'C. « Pas de note » tant que rien n\'est choisi');
        await p.locator('.rate-star[data-k="3"]').click();
        check((await p.locator('.rate-label').innerText()).includes('Correct') && await p.locator('.rate-star.on').count() === 3, 'C. 3 étoiles : « Correct »');
        await p.locator('.rate-star[data-k="5"]').click();
        await page.keyboard.press('Control+z');
        check(await p.locator('.rate-star.on').count() === 3, 'C. Ctrl+Z revient à la note précédente (5 → 3)');
        await page.keyboard.press('Control+y');
        check(await p.locator('.rate-star.on').count() === 5, 'C. Ctrl+Y la rétablit');
        await p.locator('textarea.gs-rec-comment').fill('Trop dur pour le moment');
        await page.screenshot({ path: path.join(SHOTS, 'note-1-editeur.png') });
        // abandon avec modifications : confirmation, la séance reste inchangée
        await p.locator('button.btn-ghost', { hasText: /^Annuler$/ }).click();
        await page.waitForSelector('.app-dialog');
        check(/Abandonner/.test(await page.locator('.app-dialog-title').innerText()), 'C. fermer avec une note ou un commentaire non enregistrés demande confirmation');
        await page.locator('.app-dialog button', { hasText: /^Abandonner$/ }).click();
        await page.waitForTimeout(300);
        let r = await enregistrement(page, 's2');
        check(r && r.rating === undefined && r.comment === undefined, 'C. abandonné : la séance n\'a reçu ni note ni commentaire');
        // enregistrement
        await ouvrirHistoriqueSiBesoin();
        async function ouvrirHistoriqueSiBesoin() { if (!(await page.locator('.gs-history-entry').count())) await ouvrirHistorique(page); }
        await entree(page, 'Improvisation').locator('.gs-sync-row button[title^="Modifier cette séance"]').click();
        await page.waitForSelector('.gs-save-run-panel .gs-rec-rate');
        await page.locator('.gs-save-run-panel .rate-star[data-k="5"]').click();
        await page.locator('.gs-save-run-panel textarea.gs-rec-comment').fill('Très bien, à refaire');
        await page.locator('.gs-save-run-panel button.gs-rec-save').click();
        // pas connecté à Google (Firebase est bloqué ici) : le garde-fou de l'appli demande d'abord confirmation
        const quand = page.locator('.app-dialog button', { hasText: /Enregistrer quand même/ });
        if (await quand.count().then(n => n, () => 0) || await quand.waitFor({ timeout: 1500 }).then(() => true, () => false)) await quand.click();
        await page.waitForTimeout(600);
        r = await enregistrement(page, 's2');
        check(r && r.rating === 5 && r.comment === 'Très bien, à refaire' && r.totalSec === 1200, `C. « Enregistrer » : note 5 et commentaire dans la séance, durées intactes (${r && r.rating}, ${r && r.comment}, ${r && r.totalSec} s)`);
        await ouvrirHistoriqueSiBesoin();
        check(await etoiles(entree(page, 'Improvisation')) === 5, 'C. l\'historique rouvert montre les 5 étoiles');
        await page.screenshot({ path: path.join(SHOTS, 'note-2-historique.png') });
        check(erreurs.length === 0, 'C. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ D. Calendrier : récapitulatif d'une séance notée ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await ouvrirHistorique(page);
        await entree(page, 'Gammes du matin').locator('.rate-star[data-k="4"]').click();
        await entree(page, 'Gammes du matin').locator('.gs-history-cmt-btn').click();
        await page.waitForSelector('.app-dialog-input');
        await page.locator('.app-dialog-input').fill('Un peu long');
        await page.locator('.app-dialog button', { hasText: /^Enregistrer$/ }).click();
        await page.waitForTimeout(300);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        if (!(await page.locator('.gs-calendar-btn').count())) await page.click('#guided-session-btn');
        await page.click('.gs-calendar-btn');
        await page.waitForSelector('.cal-chip-done[data-rec="s1"]', { timeout: 8000 });
        await page.locator('.cal-chip-done[data-rec="s1"]').first().click();
        await page.waitForSelector('.cal-recap');
        const txt = await page.locator('.cal-recap').innerText();
        check(await page.locator('.cal-recap-stars').innerText() === '★★★★☆' && /Bien/.test(txt) && /Un peu long/.test(txt), `D. le récapitulatif du calendrier montre ★★★★☆, « Bien » et le commentaire`);
        await page.screenshot({ path: path.join(SHOTS, 'note-3-calendrier.png') });
        check(erreurs.length === 0, 'D. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ E. Téléphone et thèmes : lisible, rien ne déborde ============
    for (const [nom, opt, vp] of [['tel-sombre', {}, { width: 390, height: 844 }], ['tel-clair', { theme: 'light' }, { width: 390, height: 844 }], ['verre', { glass: true }, { width: 1280, height: 900 }]]) {
        const { ctx, page, erreurs } = await ouvrir(browser, { ...opt, viewport: vp });
        await ouvrirHistorique(page);
        const e = entree(page, 'Session libre');
        const g = await page.evaluate(() => { const l = document.querySelector('.gs-history-list'); const r = Array.from(document.querySelectorAll('.gs-history-rate, .gs-history-comment')).map(x => x.getBoundingClientRect()).filter(b => b.width > 0); /* les commentaires vides sont masqués */ const p = document.querySelector('.gs-history-list').getBoundingClientRect(); return { depasse: r.some(b => b.right > p.right + 1 || b.left < p.left - 1), doc: document.documentElement.scrollWidth - innerWidth }; });
        const coul = await e.locator('.rate-star.on').first().evaluate(x => getComputedStyle(x).color);
        const fond = await page.evaluate(() => getComputedStyle(document.querySelector('.gs-history-entry')).backgroundColor);
        check(!g.depasse && g.doc <= 0 && coul !== 'rgba(0, 0, 0, 0)', `E. ${nom} : étoiles et commentaire dans la liste, sans débordement (couleur des étoiles ${coul})`);
        await page.screenshot({ path: path.join(SHOTS, `note-4-${nom}.png`) });
        check(erreurs.length === 0, `E. ${nom} : aucune erreur JavaScript ` + JSON.stringify(erreurs));
        await ctx.close();
    }

    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
