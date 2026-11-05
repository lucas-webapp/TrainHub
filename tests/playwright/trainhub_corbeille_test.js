// Corbeille : vidage par ancienneté (« Vider les plus anciens… ») et rappel discret quand plus de 20 exercices y dorment (une fois par jour au plus).
// Les exercices supprimés sont GRAINES directement dans l'état local (settings.trash).
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_corbeille_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : corbeille — vidage par ancienneté et rappel au-delà de 20 exercices');
const estBruitReseau = harnais.estBruitReseau;
plan(24);

const JOUR = 86400000;
// ages : liste de jours d'ancienneté, un exercice supprimé par valeur ; dossier : un dossier supprimé contenant n exercices (ancienneté j)
async function ouvrir(browser, { ages = [], dossier = null, tel = false } = {}) {
    const ctx = await browser.newContext({ viewport: tel ? { width: 390, height: 800 } : { width: 1280, height: 900 }, serviceWorkers: 'block', colorScheme: 'dark' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !estBruitReseau(m.text()) && !/ERR_FAILED/.test(m.text())) erreurs.push('console: ' + m.text()); });
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.addInitScript(({ ages, dossier, JOUR }) => {
        try {
            localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1');
            if (sessionStorage.getItem('__seed')) return;
            sessionStorage.setItem('__seed', '1');
            const now = Date.now();
            const ex = (id, title) => ({ id, title, notes: '', collapsed: true });
            const trash = ages.map((j, i) => ({ id: 'tr' + i, type: 'exercise', data: ex('x' + i, 'Supprimé ' + i), deletedAt: now - j * JOUR - 3600000, instrumentId: 'i1', parentFolderId: null }));
            if (dossier) trash.push({ id: 'trF', type: 'folder', data: { id: 'fd', name: 'Vieux dossier', exercises: Array.from({ length: dossier.n }, (_, k) => ex('d' + k, 'Dans le dossier ' + k)), folders: [] }, deletedAt: now - dossier.j * JOUR - 3600000, instrumentId: 'i1', parentFolderId: null });
            localStorage.setItem('trainhub.v1', JSON.stringify({
                activeInstrumentId: 'i1', updatedAt: 1,
                instruments: [{ id: 'i1', name: 'Guitare', categories: [{ id: 'c1', name: 'Technique', color: '#e91e63', exercises: [ex('t1', 'Gamme de Do')], folders: [] }] }],
                settings: { trash }
            }));
        } catch (e) { }
    }, { ages, dossier, JOUR });
    await page.goto('http://localhost:8765/index.html');
    await page.waitForTimeout(700);
    return { ctx, page, erreurs };
}
const toast = page => page.locator('.toast').first().innerText().catch(() => '');
const nTrash = page => page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.v1')).settings.trash.length);
const ouvrirCorbeille = async page => { await page.evaluate(() => document.getElementById('trash-btn').click()); await page.waitForSelector('.trash-panel, #trash-panel, .backups-list'); await page.waitForTimeout(150); };
const dormir = ms => new Promise(r => setTimeout(r, ms));

// 25 exercices : 5 de 100 jours, 5 de 40 jours, 5 de 10 jours, 10 de 1 jour
const AGES25 = [].concat(Array(5).fill(100), Array(5).fill(40), Array(5).fill(10), Array(10).fill(1));

(async () => {
    const browser = await chromium.launch();

    // ===== A. Le rappel : plus de 20 exercices =====
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { ages: AGES25 });
        await page.waitForTimeout(4000);
        const t = await toast(page);
        check(/25 exercices/.test(t) && /corbeille/i.test(t), `A. 25 exercices à la corbeille : un rappel s'affiche (« ${t.replace(/\n/g, ' ')} »)`);
        check(await page.locator('.toast .toast-action').count() === 1, 'A. le rappel propose « Ouvrir »');
        await page.click('.toast .toast-action');
        await page.waitForTimeout(300);
        check(await page.locator('.backups-row').count() === 25, `A. « Ouvrir » ouvre la corbeille (${await page.locator('.backups-row').count()} lignes)`);
        const jour = await page.evaluate(() => localStorage.getItem('trainhub.trashRemind.v1'));
        check(/^\d{4}-\d{2}-\d{2}$/.test(jour || ''), `A. le jour du rappel est retenu sur l'appareil (${jour})`);
        await page.reload(); await page.waitForTimeout(4800);
        check(!(await page.locator('.toast').count()), 'A. rechargement le même jour : pas de second rappel');
        await page.evaluate(() => localStorage.setItem('trainhub.trashRemind.v1', '2000-01-01'));
        await page.reload(); await page.waitForTimeout(4800);
        check(/25 exercices/.test(await toast(page)), "A. un autre jour : le rappel revient");
        check(erreurs.length === 0, 'A. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ===== B. Pas de rappel jusqu'à 20 exercices ; un dossier supprimé compte pour ses exercices ; les sessions ne comptent pas =====
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { ages: Array(20).fill(1) });
        await page.waitForTimeout(4800);
        check(!(await page.locator('.toast').count()), 'B. 20 exercices : pas de rappel (le seuil est « plus de 20 »)');
        await ctx.close();
        const b = await ouvrir(browser, { ages: Array(10).fill(1), dossier: { n: 12, j: 1 } });
        await b.page.waitForTimeout(4800);
        const t = await toast(b.page);
        check(/22 exercices/.test(t), `B. 10 exercices + un dossier de 12 : le rappel compte 22 (« ${t.replace(/\n/g, ' ')} »)`);
        check(await nTrash(b.page) === 11, 'B. et la corbeille compte bien 11 éléments (le dossier est un seul élément)');
        await b.ctx.close();
    }

    // ===== C. Vider les plus anciens =====
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { ages: AGES25 });
        await page.evaluate(() => localStorage.setItem('trainhub.trashRemind.v1', new Date().toLocaleDateString('sv'))); // pas de rappel dans ce scénario
        await ouvrirCorbeille(page);
        check(await page.locator('.trash-older-btn').count() === 1, 'C. le bouton « Vider les plus anciens… » est dans la corbeille');
        await page.click('.trash-older-btn');
        await page.waitForTimeout(300);
        const corps = await page.locator('.app-dialog-overlay').innerText();
        check(/plus de 7 jours \(15 éléments\)/.test(corps) && /plus de 30 jours \(10 éléments\)/.test(corps) && /plus de 90 jours \(5 éléments\)/.test(corps), `C. trois choix avec leur nombre (${corps.replace(/\n/g, ' | ').slice(0, 200)})`);
        await page.getByRole('button', { name: /plus de 30 jours/ }).click();
        await page.waitForTimeout(500);
        const conf = await page.locator('.app-dialog-overlay').innerText();
        check(/10 éléments/.test(conf) && /30 jours/.test(conf) && /définitivement/i.test(conf), 'C. une confirmation nomme le nombre et l\'ancienneté');
        check(await nTrash(page) === 25, 'C. rien n\'est supprimé avant la confirmation');
        await dormir(500);
        await page.locator('.app-dialog-cancel').click();
        await page.waitForTimeout(300);
        check(await nTrash(page) === 25, 'C. « Annuler » ne supprime rien');
        await ouvrirCorbeille(page);
        await page.click('.trash-older-btn'); await page.waitForTimeout(300);
        await page.getByRole('button', { name: /plus de 30 jours/ }).click(); await page.waitForTimeout(500);
        await dormir(500);
        await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
        await page.waitForTimeout(400);
        const ages = await page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.v1')).settings.trash.map(e => Math.round((Date.now() - e.deletedAt) / 86400000)));
        check(ages.length === 15 && ages.every(a => a < 30), `C. après confirmation : les 10 éléments de plus de 30 jours sont partis, les 15 plus récents restent (${ages.length})`);
        check(await page.locator('.backups-row').count() === 15, 'C. la corbeille ouverte est rafraîchie (15 lignes)');
        // plus rien d'aussi ancien que 90 jours
        await page.click('.trash-older-btn'); await page.waitForTimeout(300);
        const corps2 = await page.locator('.app-dialog-overlay').innerText();
        check(/plus de 7 jours \(5 éléments\)/.test(corps2) && !/plus de 30 jours/.test(corps2) && !/plus de 90 jours/.test(corps2), 'C. les choix vides ne sont pas proposés (il ne reste que 5 éléments de plus de 7 jours)');
        await page.locator('.app-dialog-cancel').click(); await page.waitForTimeout(300);
        check(erreurs.length === 0, 'C. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ===== D. Rien d'assez ancien ; un dossier supprimé ancien part avec ses exercices ; téléphone =====
    {
        const { ctx, page } = await ouvrir(browser, { ages: Array(3).fill(2) });
        await ouvrirCorbeille(page);
        await page.click('.trash-older-btn'); await page.waitForTimeout(300);
        check(/Rien d'aussi ancien/.test(await toast(page)) && !(await page.locator('.app-dialog-overlay').count()), 'D. rien de plus de 7 jours : un message, pas de boîte');
        await ctx.close();
        const d = await ouvrir(browser, { ages: [1, 1], dossier: { n: 30, j: 200 } });
        await ouvrirCorbeille(d.page);
        await d.page.click('.trash-older-btn'); await d.page.waitForTimeout(300);
        await d.page.getByRole('button', { name: /plus de 7 jours \(1 élément\)/ }).click(); await d.page.waitForTimeout(500);
        await dormir(500);
        await d.page.getByRole('button', { name: 'Supprimer', exact: true }).click(); await d.page.waitForTimeout(400);
        check(await nTrash(d.page) === 2, 'D. le vieux dossier (30 exercices) est supprimé en un seul élément, les 2 récents restent');
        await d.ctx.close();
        const m = await ouvrir(browser, { ages: AGES25, tel: true });
        await m.page.evaluate(() => localStorage.setItem('trainhub.trashRemind.v1', new Date().toLocaleDateString('sv')));
        await ouvrirCorbeille(m.page);
        const r1 = await m.page.locator('.trash-older-btn').boundingBox(), r2 = await m.page.getByRole('button', { name: 'Vider la corbeille' }).boundingBox();
        const larg = await m.page.evaluate(() => window.innerWidth);
        check(r1 && r2 && r1.x >= 0 && r2.x + r2.width <= larg + 1 && r1.height >= 40, `D. téléphone : les deux boutons tiennent dans l'écran (${JSON.stringify([r1 && Math.round(r1.width), r2 && Math.round(r2.width), larg])})`);
        check(r1 && r2 && (Math.abs(r1.y - r2.y) < 4 || r1.y + r1.height <= r2.y + 1 || r2.y + r2.height <= r1.y + 1), 'D. et ne se chevauchent pas');
        await m.ctx.close();
    }

    // ===== E. Aucun rappel pendant un entraînement libre =====
    {
        const { ctx, page } = await ouvrir(browser, { ages: AGES25 });
        await page.waitForTimeout(100);
        const f = await page.evaluate(() => { const b = document.getElementById('free-btn'); if (b) { b.click(); return true; } return false; });
        await page.waitForTimeout(4800);
        const t = await toast(page);
        check(f && !/corbeille/i.test(t), `E. entraînement libre en cours : pas de rappel (« ${t.replace(/\n/g, ' ')} »)`);
        await ctx.close();
    }
    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
