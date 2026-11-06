// Note d'un dossier ou d'un chapitre (pense-bête) : « ＋ Note » discret, saisie, liens cliquables, persistance, Échap, rappel dans les sous-dossiers, chapitres inclus.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_notedossier_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : note d\'un dossier');
plan(31);

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
        const ex = (id, title) => ({ id, title, notes: '', collapsed: true });
        localStorage.setItem('trainhub.v1', JSON.stringify({ activeInstrumentId: 'i1', updatedAt: 1, instruments: [{ id: 'i1', name: 'Basse', categories: [
            { id: 'c1', name: 'Technique', color: '#e91e63', exercises: [ex('e0', 'Chauffe')], folders: [
                { id: 'f1', name: 'Slap', exercises: [ex('e1', 'Pouce')], folders: [{ id: 'f2', name: 'Pouce', exercises: [ex('e2', 'Montée')], folders: [] }] },
                { id: 'f3', name: 'Vitesse', exercises: [], folders: [] }] }] }], settings: {} }));
    } catch (e) { } });
    await page.goto('http://localhost:8765/index.html');
    await page.waitForTimeout(800);
    const note = async () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('trainhub.v1')); return s.instruments[0].categories[0].folders[0].note; });

    // 1. Sur le chapitre : « ＋ Note » aussi (v267)
    check('chapitre : « ＋ Note » présent', await page.locator('.folder-note-add').count() === 1);
    // 2. Dans Slap
    await page.locator('.folder-row', { hasText: 'Slap' }).click();
    await page.waitForTimeout(300);
    check('dossier vide : « ＋ Note » discret', await page.locator('.folder-note-add').count() === 1);
    const h = await page.locator('.folder-note-add').evaluate(e => e.getBoundingClientRect().height);
    check('le bouton prend peu de place (< 30 px)', h < 30, h);
    await page.locator('.folder-note-add').click();
    check('clic : zone de saisie active', await page.locator('.folder-note-edit').evaluate(e => document.activeElement === e));
    await page.keyboard.type('Prochaine fois : 80 bpm\nhttps://www.youtube.com/watch?v=abc123.');
    await page.locator('h2', { hasText: 'Slap' }).click(); // clic ailleurs = blur = enregistre
    await page.waitForTimeout(400);
    check('note enregistrée dans les données', (await note()) === 'Prochaine fois : 80 bpm\nhttps://www.youtube.com/watch?v=abc123.', await note());
    check('affichée en lecture (plus de zone de saisie)', await page.locator('.folder-note-view').count() === 1 && await page.locator('.folder-note-edit').count() === 0);
    check('le lien est cliquable', await page.locator('.folder-note-view a').count() === 1);
    check('le point final reste hors du lien', (await page.locator('.folder-note-view a').getAttribute('href')) === 'https://www.youtube.com/watch?v=abc123');
    check('cadre compact (< 90 px)', (await page.locator('.folder-note-view').evaluate(e => e.getBoundingClientRect().height)) < 90);
    // 3. clic sur le lien : ne passe pas en édition
    await page.evaluate(() => { window.__ouvert = []; window.open = u => { window.__ouvert.push(u); return null; }; });
    await page.locator('.folder-note-view a').click();
    check('clic sur le lien : ouvre l\'URL', (await page.evaluate(() => window.__ouvert))[0] === 'https://www.youtube.com/watch?v=abc123');
    check('… sans passer en édition', await page.locator('.folder-note-edit').count() === 0);
    // 4. Échap annule
    await page.locator('.folder-note-view').click({ position: { x: 5, y: 5 } });
    check('clic sur le texte : édition', await page.locator('.folder-note-edit').count() === 1);
    await page.keyboard.type(' XXX');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check('Échap : modification annulée', (await note()).indexOf('XXX') === -1 && await page.locator('.folder-note-view').count() === 1);
    // 5. Ctrl+Entrée valide
    await page.locator('.folder-note-view').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' OK');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(300);
    check('Ctrl+Entrée : enregistre', (await note()).endsWith(' OK'));
    // 6. Rappel dans le sous-dossier
    await page.locator('.folder-row', { hasText: 'Pouce' }).click();
    await page.waitForTimeout(300);
    check('sous-dossier : rappel de la note du parent', await page.locator('.folder-note-parent').count() === 1);
    check('rappel sur une seule ligne', (await page.locator('.folder-note-parent').evaluate(e => e.getBoundingClientRect().height)) < 30);
    check('le rappel ne déborde pas de l\'écran', (await page.locator('.folder-note-parent').evaluate(e => e.getBoundingClientRect().right)) <= 1280);
    check('le rappel contient le nom du parent', (await page.locator('.folder-note-parent').innerText()).startsWith('Slap :'));
    check('le sous-dossier a sa propre note vide', await page.locator('.folder-note-add').count() === 1);
    await page.locator('.folder-note-parent').click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(300);
    check('clic sur le rappel : retour au dossier parent', await page.locator('.folder-note-view').count() === 1 && await page.locator('.folder-note-parent').count() === 0);
    // 7. Persistance après rechargement
    await page.reload();
    await page.waitForTimeout(800);
    check('note conservée après rechargement', (await note()).startsWith('Prochaine fois'));
    // 8. Vider la note la supprime
    await page.locator('.folder-row').first().waitFor({ state: 'attached' }).catch(() => {});
    const dansSlap = await page.locator('.folder-note-view').count();
    if (!dansSlap) { await page.locator('.folder-row', { hasText: 'Slap' }).click(); await page.waitForTimeout(300); }
    await page.locator('.folder-note-view').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await page.locator('h2', { hasText: 'Slap' }).click();
    await page.waitForTimeout(300);
    check('note vidée : champ supprimé des données', (await note()) === undefined && await page.locator('.folder-note-add').count() === 1);
    // 9. Texte de la note jamais interprété comme HTML
    await page.locator('.folder-note-add').click();
    await page.keyboard.type('<img src=x onerror=window.__pwn=1> <b>gras</b>');
    await page.locator('h2', { hasText: 'Slap' }).click();
    await page.waitForTimeout(300);
    check('HTML dans la note : affiché tel quel, jamais exécuté', await page.locator('.folder-note-view img, .folder-note-view b').count() === 0 && !(await page.evaluate(() => window.__pwn)));
    // 10. Note de chapitre (v267) : rappelée dans les dossiers en dessous
    await page.locator('.crumb', { hasText: 'Technique' }).click();
    await page.waitForTimeout(300);
    await page.locator('.folder-note-add').click();
    await page.keyboard.type('Chapitre : toujours chauffer 5 min https://exemple.fr/doc');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(300);
    const chNote = await page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.v1')).instruments[0].categories[0].note);
    check('note de chapitre enregistrée', chNote === 'Chapitre : toujours chauffer 5 min https://exemple.fr/doc', chNote);
    check('chapitre : cadre de lecture + lien cliquable', await page.locator('.folder-note-view a').count() === 1);
    await page.locator('.folder-row', { hasText: 'Vitesse' }).click();
    await page.waitForTimeout(300);
    check('dossier : rappel « Technique : »', (await page.locator('.folder-note-parent').first().innerText()).startsWith('Technique :'));
    await page.locator('.crumb', { hasText: 'Technique' }).click();
    await page.waitForTimeout(300);
    await page.locator('.folder-row', { hasText: 'Slap' }).click();
    await page.waitForTimeout(300);
    await page.locator('.folder-row', { hasText: 'Pouce' }).click();
    await page.waitForTimeout(300);
    check('sous-sous-dossier : rappels du chapitre et de Slap', await page.locator('.folder-note-parent').count() === 2);
    await page.locator('.folder-note-parent').first().click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(300);
    check('clic sur le rappel du chapitre : retour au chapitre', await page.locator('.crumb-current', { hasText: 'Technique' }).count() === 1 && await page.locator('.folder-note-view').count() === 1);
    // chapitre de morceaux
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('trainhub.v1')); s.instruments[0].categories.push({ id: 'c2', name: 'Morceaux', kind: 'songs', folders: [], exercises: [] }); s.updatedAt = 99; localStorage.setItem('trainhub.v1', JSON.stringify(s)); });
    await page.reload();
    await page.waitForTimeout(800);
    await page.locator('.tree-label, .chapter-tab, .sidebar *', { hasText: /^Morceaux$/ }).first().click();
    await page.waitForTimeout(400);
    check('chapitre de morceaux : « ＋ Note » aussi', await page.locator('.folder-note-add').count() === 1);
    await page.locator('.folder-note-add').click();
    await page.keyboard.type('Setlist de samedi');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(300);
    check('… et elle se garde', (await page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.v1')).instruments[0].categories[1].note)) === 'Setlist de samedi');
    check('aucune erreur de page', erreurs.length === 0, erreurs.join(' | '));
    await browser.close();
    bilan();
})().catch(e => { console.error('FAIL exception', e); process.exit(1); });
