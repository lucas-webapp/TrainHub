// Notes vides masquées (v273) : une note fixe ou mobile VIDE ne prend plus de place dans la fiche d'un exercice ;
// « ＋ Note fixe » / « ＋ Note mobile » la fait apparaître ; dès qu'elle contient quelque chose, elle reste toujours visible.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_notes_vides_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : notes fixes / mobiles vides masquées');
plan(31);

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
        const ex = (id, title, extra) => Object.assign({ id, title, notes: '', fixedNotes: '', collapsed: false, links: [], files: [], images: [] }, extra || {});
        const exs = [
            ex('vide', 'Gamme vide'),
            ex('fixe', 'Gamme avec fixe', { fixedNotes: 'Garder le poignet souple' }),
            ex('mobile', 'Gamme avec mobile', { notes: '10/11 : plus lent' }),
            ex('deux', 'Gamme avec les deux', { fixedNotes: 'Fixe', notes: 'Mobile' }),
            ex('archive', 'Gamme avec archives', { notesArchive: [{ d: '2026-10-01', t: 'ancienne ligne' }] }),
            ex('ajout', 'Gamme pour ajout'),
            ex('rangee', 'Gamme pour rangement')
        ];
        localStorage.setItem('trainhub.v1', JSON.stringify({ activeInstrumentId: 'i1', updatedAt: 1, instruments: [{ id: 'i1', name: 'Guitare', categories: [
            { id: 'c1', name: 'Technique', color: '#e91e63', folders: [], exercises: exs }] }], settings: {} }));
    } catch (e) { } });
    await page.goto('http://localhost:8765/index.html');
    await page.waitForTimeout(1000);

    const E = id => `.exercise[data-ex-id="${id}"]`;
    const vis = (id, sel) => page.locator(`${E(id)} ${sel}`).first().isVisible();
    const fixeVisible = id => vis(id, '.notes-fixed-textarea');
    const mobVisible = id => vis(id, '.notes-textarea');
    const btnFixe = id => page.locator(`${E(id)} .ex-note-add`, { hasText: 'Note fixe' }).first();
    const btnMob = id => page.locator(`${E(id)} .ex-note-add`, { hasText: 'Note mobile' }).first();
    const stockee = id => page.evaluate(i => { const s = JSON.parse(localStorage.getItem('trainhub.v1')); let r = null; s.instruments.forEach(n => n.categories.forEach(c => (c.exercises || []).forEach(e => { if (e.id === i) r = e; }))); return r; }, id);

    // 1. exercice sans aucune note : rien de visible, deux petits boutons
    check(!(await fixeVisible('vide')), '1. sans note : la zone « Notes fixes » est masquée');
    check(!(await mobVisible('vide')), '1. sans note : la zone « Notes mobiles » est masquée');
    check(await page.locator(`${E('vide')} .section-label:visible`, { hasText: 'Notes' }).count() === 0, '1. aucun intitulé « Notes … » à l\'écran');
    check(await btnFixe('vide').isVisible() && await btnMob('vide').isVisible(), '1. « ＋ Note fixe » et « ＋ Note mobile » sont proposés');

    // 2. une note fixe seule : elle reste visible, l'autre est proposée
    check(await fixeVisible('fixe'), '2. note fixe écrite : toujours visible');
    check((await page.locator(`${E('fixe')} .notes-fixed-textarea`).inputValue()) === 'Garder le poignet souple', '2. … avec son texte');
    check(!(await mobVisible('fixe')) && await btnMob('fixe').isVisible() && !(await btnFixe('fixe').isVisible()), '2. seule « ＋ Note mobile » est proposée');

    // 3. une note mobile seule
    check(await mobVisible('mobile'), '3. note mobile écrite : toujours visible');
    check(!(await fixeVisible('mobile')) && await btnFixe('mobile').isVisible() && !(await btnMob('mobile').isVisible()), '3. seule « ＋ Note fixe » est proposée');

    // 4. les deux écrites : aucun bouton, rien de superflu
    check(await fixeVisible('deux') && await mobVisible('deux'), '4. les deux écrites : les deux zones visibles');
    check(await page.locator(`${E('deux')} .ex-note-add:visible`).count() === 0 && !(await vis('deux', '.ex-note-add-row')), '4. … et aucun bouton « ＋ »');

    // 5. archives présentes : la zone mobile reste (le bouton « Archives » est dans son en-tête)
    check(await mobVisible('archive') && await vis('archive', '.notes-archive-btn'), '5. archives existantes : zone mobile et bouton « Archives » visibles');
    check(!(await btnMob('archive').isVisible()), '5. … donc pas de « ＋ Note mobile »');

    // 6. gain de place : fiche vide plus courte que la fiche aux deux notes
    const hauteur = id => page.locator(E(id)).evaluate(e => e.getBoundingClientRect().height);
    const hVide = await hauteur('vide'), hDeux = await hauteur('deux');
    check(hVide < hDeux - 60, `6. la fiche sans note est plus courte (${Math.round(hVide)} px contre ${Math.round(hDeux)} px)`);

    // 7. « ＋ Note fixe » : la zone apparaît, le curseur y est, on écrit, c'est enregistré
    await btnFixe('ajout').click();
    await page.waitForTimeout(200);
    check(await fixeVisible('ajout'), '7. clic sur « ＋ Note fixe » : la zone apparaît');
    check(!(await btnFixe('ajout').isVisible()), '7. … et le bouton disparaît');
    check(await page.locator(`${E('ajout')} .notes-fixed-textarea`).evaluate(t => document.activeElement === t), '7. … avec le curseur dedans');
    check((await page.locator(`${E('ajout')} .notes-fixed-textarea`).evaluate(t => t.getBoundingClientRect().height)) > 40, '7. … à une hauteur normale (pas écrasée)');
    await page.keyboard.type('Tenir le tempo');
    await page.locator('h1, .top-bar').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.locator(`${E('ajout')} .notes-fixed-textarea`).evaluate(t => t.blur());
    await page.waitForTimeout(400);
    check(await fixeVisible('ajout'), '7. avec du texte, la zone reste visible après avoir quitté le champ');
    check((await stockee('ajout')).fixedNotes === 'Tenir le tempo', '7. … et le texte est enregistré');

    // 8. « ＋ Note mobile » puis rien écrit : la zone se range à la sortie
    await btnMob('rangee').click();
    await page.waitForTimeout(200);
    check(await mobVisible('rangee'), '8. clic sur « ＋ Note mobile » : la zone apparaît');
    await page.locator(`${E('rangee')} .notes-textarea`).evaluate(t => t.blur());
    await page.waitForTimeout(300);
    check(!(await mobVisible('rangee')), '8. rien écrit, on quitte : la zone se range');
    check(await btnMob('rangee').isVisible(), '8. … et « ＋ Note mobile » revient');

    // 9. effacer tout le texte d'une note fixe : elle se range aussi
    await btnFixe('rangee').click();
    await page.waitForTimeout(150);
    await page.keyboard.type('x');
    await page.keyboard.press('Backspace');
    await page.locator(`${E('rangee')} .notes-fixed-textarea`).evaluate(t => t.blur());
    await page.waitForTimeout(400);
    check(!(await fixeVisible('rangee')), '9. texte effacé puis sortie : la zone se range');
    check((await stockee('rangee')).fixedNotes === '', '9. … et rien de résiduel n\'est enregistré');

    // 10. note mobile écrite via le bouton, puis rechargement : elle est toujours là
    await btnMob('ajout').click();
    await page.waitForTimeout(150);
    await page.keyboard.type('11/11 : à retravailler');
    await page.locator(`${E('ajout')} .notes-textarea`).evaluate(t => t.blur());
    await page.waitForTimeout(400);
    await page.reload();
    await page.waitForTimeout(1000);
    check(await mobVisible('ajout') && (await page.locator(`${E('ajout')} .notes-textarea`).inputValue()) === '11/11 : à retravailler', '10. après rechargement : la note mobile écrite est visible');
    check(await fixeVisible('ajout'), '10. … et la note fixe aussi');
    check(await page.locator(`${E('ajout')} .ex-note-add:visible`).count() === 0, '10. … sans bouton « ＋ »');
    check(!(await fixeVisible('vide')) && !(await mobVisible('vide')), '10. l\'exercice resté vide est toujours sans zones de notes');

    // 11. exercice replié : la note fixe écrite reste visible comme avant
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('trainhub.v1')); s.instruments[0].categories[0].exercises.forEach(e => { if (e.id === 'fixe') e.collapsed = true; }); localStorage.setItem('trainhub.v1', JSON.stringify(s)); });
    await page.reload();
    await page.waitForTimeout(1000);
    check(await page.locator(`${E('fixe')} .exercise-fixed-view`).isVisible(), '11. exercice replié : la note fixe écrite reste visible');

    check(erreurs.length === 0, '12. aucune erreur JavaScript ' + JSON.stringify(erreurs));
    await ctx.close();
    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
