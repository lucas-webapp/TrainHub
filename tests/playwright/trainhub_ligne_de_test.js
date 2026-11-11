// Ligne du dé d'un exercice (v268) : plus de résumé « Tonalité-Gamme(2) » mais un bouton de réglage, « Tirer » en vert collé au dé,
// objectif tempo (nouvelle icône) puis « En cours » sur la même ligne, confirmation avant de retirer le dé.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_ligne_de_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : ligne du dé d\'un exercice');
plan(23);

(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block', colorScheme: 'dark' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.addInitScript(() => { try {
        localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1');
        if (sessionStorage.getItem('__seed')) return; sessionStorage.setItem('__seed', '1');
        localStorage.setItem('trainhub.v1', JSON.stringify({ activeInstrumentId: 'i1', updatedAt: 1, instruments: [{ id: 'i1', name: 'Basse', categories: [
            { id: 'c1', name: 'Technique', color: '#e91e63', folders: [], exercises: [
                { id: 'e1', title: 'Avec dé', notes: '', collapsed: false, inProgress: true, tempoGoal: true, dice: { cfg: null } },
                { id: 'e2', title: 'Sans dé', notes: '', collapsed: false },
                { id: 'e3', title: 'Avec harmonie', notes: '', collapsed: false, harm: { cfg: null } },
                { id: 'e4', title: 'Copie A', notes: '', collapsed: true, linkId: 'L', links: [{ id: 'l1', label: 'Site', url: 'https://exemple.fr' }] },
                { id: 'e5', title: 'Copie B', notes: '', collapsed: true, linkId: 'L', links: [{ id: 'l2', label: 'Site', url: 'https://exemple.fr' }] }] }] }], settings: {} }));
    } catch (e) { } });
    await page.goto('http://localhost:8765/index.html');
    await page.waitForTimeout(900);
    const ex = id => page.locator('.exercise[data-ex-id="' + id + '"]');
    const etat = id => page.evaluate(i => { const s = JSON.parse(localStorage.getItem('trainhub.v1')); const e = s.instruments[0].categories[0].exercises.filter(x => x.id === i)[0]; return { dice: !!e.dice, harm: !!e.harm }; }, id);

    // 1. composition de la ligne
    check('plus de résumé texte du dé', await ex('e1').locator('.dice-ex-sum').count() === 0);
    check('un bouton de réglage (engrenage) à côté du dé', await ex('e1').locator('button.dice-ex-set svg').count() === 1);
    const txt = await ex('e1').locator('.dice-ex-row').innerText();
    check('aucun « Tonalité-Gamme » affiché dans la ligne', !/Tonalité|Gamme/.test(txt), txt);
    const ordre = await ex('e1').locator('.dice-ex-row').evaluate(r => Array.from(r.children).map(c => c.className.split(' ')[0]));
    check('ordre (v276) : dé · réglage · Tirer — l\'objectif tempo et « En cours » ne sont plus dans cette ligne', ordre.slice(0, 3).join(',') === 'dice-ex-btn,dice-ex-set,btn-accent' && !ordre.includes('tempo-goal-btn') && !ordre.includes('ex-wip-chip'), ordre.join(','));
    check('« Tirer » est un bouton vert (btn-accent)', await ex('e1').locator('button.btn-accent.dice-ex-go').innerText() === 'Tirer');
    const geo = await ex('e1').locator('.dice-ex-row').evaluate(r => { const q = s => r.querySelector(s).getBoundingClientRect(); const mid = b => b.top + b.height / 2; const d = q('.dice-ex-btn'), g = q('.dice-ex-go'), s = q('.dice-ex-set');
        return { memeLigne: [g, s].every(b => Math.abs(mid(b) - mid(d)) < 3), colle: g.left - s.right < 14 && s.left - d.right < 14 }; });
    check('dé, réglage et « Tirer » sur la même ligne', geo.memeLigne, JSON.stringify(geo));
    check('« Tirer » est collé au dé et à son réglage', geo.colle, JSON.stringify(geo));
    check('nouvelle icône d\'objectif tempo (métronome + flèche), plus de cible', await ex('e1').locator('.tempo-goal-btn svg path').count() === 4 && await ex('e1').locator('.tempo-goal-btn svg circle').count() === 0);
    check('sans dé : ni réglage ni « Tirer », mais objectif tempo et « En cours »', await ex('e2').locator('.dice-ex-set').isHidden() && await ex('e2').locator('.dice-ex-go').isHidden() && await ex('e2').locator('.tempo-goal-btn').isVisible() && await ex('e2').locator('.ex-wip-chip').isVisible());

    // 2. « Tirer » tire bien
    await ex('e1').locator('.dice-ex-go').click();
    await page.waitForTimeout(300);
    check('« Tirer » affiche un tirage', (await ex('e1').locator('.dice-ex-res').innerText()).trim().length > 0);
    // 3. le réglage ouvre la fenêtre du dé
    await ex('e1').locator('.dice-ex-set').click();
    await page.waitForTimeout(400);
    check('le bouton de réglage ouvre la fenêtre du dé', await page.getByText('Dé de gammes · Avec dé').count() > 0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelectorAll('.dice-win, [class*="dice-window"]').forEach(w => { const c = w.querySelector('[aria-label="Fermer"], .win-close, button[title*="Fermer"]'); if (c) c.click(); }));

    // 4. confirmation avant de retirer le dé
    await ex('e1').locator('button.dice-ex-btn').click();
    await page.waitForTimeout(300);
    check('clic sur le dé allumé : une confirmation s\'affiche', await page.locator('.app-dialog', { hasText: 'Retirer le dé' }).count() === 1);
    check('… et le dé est encore là', (await etat('e1')).dice === true);
    await page.locator('.app-dialog button', { hasText: /Annuler|Non|Garder/ }).first().click();
    await page.waitForTimeout(300);
    check('Annuler : le dé reste', (await etat('e1')).dice === true && await ex('e1').locator('.dice-ex-go').isVisible());
    await ex('e1').locator('button.dice-ex-btn').click();
    await page.waitForTimeout(300);
    await page.locator('.app-dialog button', { hasText: 'Retirer' }).click();
    await page.waitForTimeout(400);
    check('Retirer : le dé disparaît', (await etat('e1')).dice === false && await ex('e1').locator('.dice-ex-go').isHidden());
    // 5. dé éteint : pas de confirmation, on choisit le dé
    await ex('e1').locator('button.dice-ex-btn').click();
    await page.waitForTimeout(300);
    check('dé éteint : clic = choix du dé (pas de confirmation)', await page.locator('.app-dialog', { hasText: 'Quel dé' }).count() === 1 && await page.locator('.app-dialog', { hasText: 'Retirer' }).count() === 0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // 6. dé d'harmonie : même confirmation
    await ex('e3').locator('button.dice-ex-btn').click();
    await page.waitForTimeout(300);
    check('dé d\'harmonie : confirmation aussi', await page.locator('.app-dialog', { hasText: 'Retirer le dé d\'harmonie' }).count() === 1 && (await etat('e3')).harm === true);
    await page.locator('.app-dialog button', { hasText: 'Retirer' }).click();
    await page.waitForTimeout(400);
    check('… puis il est retiré', (await etat('e3')).harm === false);
    // 7. « En cours » fonctionne depuis la ligne
    await ex('e2').locator('.ex-wip-chip').click();
    await page.waitForTimeout(300);
    check('« En cours » s\'allume depuis l\'en-tête de la fiche', await ex('e2').locator('.ex-wip-chip.on').count() === 1);
    // 8. Vignette « lien » et badge « copie liée » : deux icônes bien différentes (v269)
    const ico = async sel => ex('e4').locator(sel + ' svg').evaluate(s => s.innerHTML);
    check('lien ordinaire : vignette chaîne (.exercise-link-quick)', await ex('e4').locator('.exercise-link-quick').count() === 1);
    check('copie liée : badge avec le nombre de copies', (await ex('e4').locator('.exercise-link-badge').innerText()).trim() === '1');
    const [icoLien, icoCopie] = [await ico('.exercise-link-quick'), await ico('.exercise-link-badge')];
    check('les deux icônes sont différentes, et le badge n\'a plus de chaîne (deux feuilles : 1 rect + 1 path)', icoLien !== icoCopie && /<rect/.test(icoCopie) && (icoCopie.match(/<path/g) || []).length === 1, icoCopie.slice(0, 80));
    check('aucune erreur de page', erreurs.length === 0, erreurs.join(' | '));
    await browser.close();
    bilan();
})().catch(e => { console.error('FAIL exception', e); process.exit(1); });
