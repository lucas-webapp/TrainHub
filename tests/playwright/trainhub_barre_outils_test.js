// Barre d'outils d'une fiche d'exercice (v276) : métronome · options · ▶ · objectif tempo à gauche (vignettes « ＋ Note » dessous, calées sur la même largeur),
// dé · réglage · Tirer à droite ; « En cours » dans l'en-tête (fiche ouverte seulement) ; plus de ✕ dans l'en-tête ni dans la ligne du métronome.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_barre_outils_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : barre d\'outils de la fiche — gauche métronome, droite dé, « En cours » dans l\'en-tête, plus de ✕');
plan(30);

async function ouvrir(browser, viewport) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', colorScheme: 'dark' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.addInitScript(() => { try {
        localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1');
        if (sessionStorage.getItem('__seed')) return; sessionStorage.setItem('__seed', '1');
        const P = { bpm: 100, beatsPerMeasure: 4, rhythmLabel: 'None', beatPattern: [1, 0, 0, 0], advanced: false };
        const ex = (id, title, o) => Object.assign({ id, title, notes: '', fixedNotes: '', collapsed: false, links: [], files: [], images: [], favorite: false, archived: false, updatedAt: 1 }, o || {});
        localStorage.setItem('trainhub.v1', JSON.stringify({ activeInstrumentId: 'i1', updatedAt: 1, instruments: [{ id: 'i1', name: 'Basse', categories: [
            { id: 'c1', name: 'Technique', color: '#e91e63', folders: [], exercises: [
                ex('a', 'Gammes par sauts de 2-3 notes', { dice: { cfg: null }, tempoGoal: true, metronome: P, inProgress: true }),
                ex('b', 'Legato aux deux mains', { tempoGoal: false }),
                ex('c', 'Arpèges fermés', { collapsed: true, inProgress: true }),
                ex('d', 'Octaves fermés', { collapsed: true })] }] }], settings: {} }));
    } catch (e) { } });
    await page.goto('http://localhost:8765/index.html');
    await page.waitForTimeout(900);
    return { ctx, page, erreurs };
}

(async () => {
    const browser = await chromium.launch();
    // ============ A. Grand écran ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { width: 1280, height: 800 });
        await page.locator('.tree-node > .tree-row', { hasText: 'Technique' }).first().click();
        await page.waitForTimeout(500);
        const E = id => page.locator(`.exercise[data-ex-id="${id}"]`);
        const etat = id => page.evaluate(i => { const s = JSON.parse(localStorage.getItem('trainhub.v1')); let r = null; s.instruments[0].categories[0].exercises.forEach(e => { if (e.id === i) r = e; }); return r; }, id);

        // 1. plus de ✕
        check(await E('a').locator('.exercise-row-tools .icon-btn').count() === 0 && await E('a').locator('.exercise-row button', { hasText: '✕' }).count() === 0, 'A1. plus de ✕ à droite de l\'en-tête de l\'exercice');
        check(await E('a').locator('.metro-preset-row button', { hasText: '✕' }).count() === 0, 'A2. plus de ✕ « Retirer ce réglage » dans la ligne du métronome (alors qu\'un réglage existe)');
        // 3. la suppression reste possible : clic droit › Supprimer…
        await E('b').locator('.exercise-row').click({ button: 'right' });
        await page.waitForTimeout(250);
        check(await page.locator('.ctx-item', { hasText: 'Supprimer' }).count() === 1, 'A3. clic droit : « Supprimer… » est dans le menu');
        await page.locator('.ctx-item', { hasText: 'Supprimer' }).click(); await page.waitForTimeout(250);
        check(await page.locator('.app-dialog', { hasText: 'Supprimer « Legato aux deux mains »' }).count() === 1, 'A4. … et demande confirmation');
        await page.locator('.app-dialog button', { hasText: /Annuler|Non/ }).first().click(); await page.waitForTimeout(250);
        check(await E('b').count() === 1, 'A5. Annuler : l\'exercice est toujours là');

        // 6. composition : gauche = métronome, options, ▶, objectif tempo ; droite = dé, réglage, Tirer
        const comp = await E('a').evaluate(el => {
            const L = el.querySelector('.ex-tools-left'), R = el.querySelector('.dice-ex-row'), q = (r, s) => r.querySelector(s);
            return { gaucheMetro: !!q(L, '.metro-preset-row .metro-preset-icon'), gaucheTempo: !!q(L, '.num-stepper'), gaucheOptions: !!q(L, 'button.metro-preset-btn-icon'), gaucheObjectif: !!q(L, '.tempo-goal-btn'),
                objectifDernier: L.querySelector('.metro-preset-row').lastElementChild.classList.contains('tempo-goal-btn'),
                droiteDe: !!q(R, '.dice-ex-btn') && !!q(R, '.dice-ex-set') && !!q(R, '.dice-ex-go'), objectifPasDansDe: !R.querySelector('.tempo-goal-btn'), enCoursPasDansDe: !R.querySelector('.ex-wip-chip'), enCoursPasDansGauche: !L.querySelector('.ex-wip-chip') };
        });
        check(comp.gaucheMetro && comp.gaucheTempo && comp.gaucheOptions && comp.gaucheObjectif && comp.objectifDernier, 'A6. à gauche : métronome, tempo, options, objectif tempo (en dernier) ' + JSON.stringify(comp));
        check(comp.droiteDe && comp.objectifPasDansDe && comp.enCoursPasDansDe && comp.enCoursPasDansGauche, 'A7. à droite : dé, réglage, Tirer (et ni objectif tempo ni « En cours »)');

        // 8. mêmes boutons : taille et contour identiques
        const geo = await E('a').evaluate(el => {
            const g = s => el.querySelector(s), r = e => e.getBoundingClientRect(), cs = e => getComputedStyle(e);
            const gearM = g('.ex-tools-left button.metro-preset-btn-icon'), gearD = g('.dice-ex-set'), goal = g('.ex-tools-left .tempo-goal-btn'), dice = g('.dice-ex-btn'), go = g('.dice-ex-go'), field = g('.ex-tools-left .num-stepper');
            const play = Array.from(el.querySelectorAll('.ex-tools-left button.metro-preset-btn-icon'))[1];
            return { gearM: [Math.round(r(gearM).width), Math.round(r(gearM).height)], gearD: [Math.round(r(gearD).width), Math.round(r(gearD).height)],
                memeBordure: cs(gearM).borderTopWidth === cs(gearD).borderTopWidth && cs(gearM).borderTopLeftRadius === cs(gearD).borderTopLeftRadius && cs(gearM).backgroundColor === cs(gearD).backgroundColor,
                hauteurs: [gearM, play, goal, dice, go, gearD].map(b => Math.round(r(b).height)), champ: Math.round(r(field).width) };
        });
        check(geo.gearM.join('x') === geo.gearD.join('x') && geo.gearM.join('x') === '36x32', 'A8. les deux engrenages sont identiques : 36 × 32 px ' + JSON.stringify(geo.gearM) + ' / ' + JSON.stringify(geo.gearD));
        check(geo.memeBordure, 'A9. … même contour, même coin, même fond');
        check(geo.hauteurs.every(h => h === 32), 'A10. options, ▶, objectif tempo, dé, Tirer, réglage du dé : tous 32 px de haut ' + JSON.stringify(geo.hauteurs));
        check(geo.champ <= 80 && geo.champ >= 70, `A11. le choix du tempo ‹ 100 › est resserré (${geo.champ} px, avant : 104)`);

        // 12. alignement géométrique des vignettes de notes sur la ligne du métronome
        const al = await E('a').evaluate(el => {
            const r = e => e.getBoundingClientRect(), L = el.querySelector('.ex-tools-left'), icon = L.querySelector('.metro-preset-icon'), goal = L.querySelector('.tempo-goal-btn'), adds = Array.from(L.querySelectorAll('.ex-note-add')).filter(b => b.offsetParent);
            const g1 = r(goal), a0 = r(adds[0]), aN = r(adds[adds.length - 1]);
            return { n: adds.length, droite: Math.abs(aN.right - g1.right) < 1.5, gauche: Math.abs(a0.left - r(icon).left) < 1.5 || a0.left - r(icon).left <= 2, hauteur: Math.round(a0.height), deuxiemeLigne: a0.top > g1.bottom, coin: getComputedStyle(adds[0]).borderTopLeftRadius === getComputedStyle(L.querySelector('button.metro-preset-btn-icon')).borderTopLeftRadius };
        });
        check(al.n === 2 && al.droite, 'A12. les deux vignettes « ＋ Note » finissent pile sous le bouton d\'objectif tempo ' + JSON.stringify(al));
        check(al.hauteur === 32 && al.coin && al.deuxiemeLigne, 'A13. … 32 px de haut, même coin que les boutons, sous la ligne du métronome');
        const dr = await E('a').evaluate(el => { const r = e => e.getBoundingClientRect(), R = el.querySelector('.dice-ex-row'), L = el.querySelector('.ex-tools-left .metro-preset-row'), tl = el.querySelector('.ex-tools-line'); return { memeHaut: Math.abs(r(R).top - r(L).top) < 3, aDroite: r(tl).right - r(R).right < 3 }; });
        check(dr.memeHaut && dr.aDroite, 'A14. le groupe du dé est calé à droite, sur la même ligne que le métronome ' + JSON.stringify(dr));

        // 15. « En cours » dans l'en-tête
        const wip = await E('a').evaluate(el => { const c = el.querySelector('.exercise-row > .ex-wip-chip'), t = el.querySelector('input.exercise-title'), r = e => e.getBoundingClientRect(); return { present: !!c, on: c && c.classList.contains('on'), pressed: c && c.getAttribute('aria-pressed'), apresTitre: c && r(c).left >= r(t).right - 1, mem: c && Math.abs((r(c).top + r(c).height / 2) - (r(t).top + r(t).height / 2)) < 6, pasDePoint: !el.querySelector('.exercise-wip-badge') }; });
        check(wip.present && wip.on && wip.pressed === 'true' && wip.apresTitre && wip.mem && wip.pasDePoint, 'A15. fiche ouverte « en cours » : pastille verte à droite du titre, sans point en plus ' + JSON.stringify(wip));
        check(await E('b').locator('.exercise-row > .ex-wip-chip').count() === 1 && await E('b').locator('.ex-wip-chip.on').count() === 0, 'A16. fiche ouverte pas « en cours » : pastille présente mais grisée');
        await E('b').locator('.ex-wip-chip').click(); await page.waitForTimeout(400);
        check(await E('b').locator('.ex-wip-chip.on').count() === 1 && (await etat('b')).inProgress === true, 'A17. un clic l\'allume (et c\'est enregistré)');
        await E('b').locator('.ex-wip-chip').click(); await page.waitForTimeout(400);
        check(await E('b').locator('.ex-wip-chip.on').count() === 0 && !(await etat('b')).inProgress, 'A18. un second clic l\'éteint');
        // 19. exercices fermés : pas de pastille, le point seulement si en cours
        check(await E('c').locator('.ex-wip-chip').count() === 0 && await E('c').locator('.exercise-wip-badge').count() === 1, 'A19. fermé et en cours : aucune pastille, le petit point vert');
        check(await E('d').locator('.ex-wip-chip').count() === 0 && await E('d').locator('.exercise-wip-badge').count() === 0, 'A20. fermé et pas en cours : rien');

        // 21. retirer le réglage de métronome : par la pastille ♩ de l'en-tête (fenêtre « Retirer »)
        await E('a').locator('.tempo-chip').click(); await page.waitForTimeout(250);
        check(await page.locator('.tempo-pop button', { hasText: 'Retirer' }).count() === 1, 'A21. la pastille ♩ de l\'en-tête propose « Retirer » (remplace le ✕ de la ligne)');
        await page.locator('.tempo-pop button', { hasText: 'Retirer' }).click(); await page.waitForTimeout(500);
        check(!(await etat('a')).metronome, 'A22. « Retirer » enlève bien le réglage de métronome');

        // 23. exercice sans dé ni réglage (« b ») : ligne simple, rien d'inutile
        const b = await E('b').evaluate(el => ({ dice: !!el.querySelector('.dice-ex-set:not([hidden])') && getComputedStyle(el.querySelector('.dice-ex-set')).display !== 'none', goal: !!el.querySelector('.ex-tools-left .tempo-goal-btn') }));
        check(!b.dice && b.goal, 'A23. sans dé : pas de réglage ni de « Tirer » à droite ; l\'objectif tempo reste dans la ligne du métronome');
        check(erreurs.length === 0, 'A24. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ B. Téléphone ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { width: 390, height: 844 });
        const m = await page.evaluate(() => { const el = document.querySelector('.exercise[data-ex-id="a"]'), r = e => e.getBoundingClientRect(), c = el.querySelector('.exercise-row > .ex-wip-chip'), t = el.querySelector('input.exercise-title'), L = el.querySelector('.ex-tools-left'), R = el.querySelector('.dice-ex-row'), goal = L.querySelector('.tempo-goal-btn'), adds = L.querySelectorAll('.ex-note-add');
            return { chipW: Math.round(r(c).width), label: getComputedStyle(c.querySelector('span')).position, titreW: Math.round(r(t).width), dedans: document.documentElement.scrollWidth <= innerWidth + 1, noteDroite: Math.abs(r(adds[adds.length - 1]).right - r(goal).right) < 1.5, deSousMetro: r(R).top >= r(L).bottom - 2 || r(R).left >= r(L).right }; });
        check(m.chipW <= 36 && m.label === 'absolute', 'B1. téléphone : la pastille « En cours » se réduit à son rond (' + m.chipW + ' px)');
        check(m.titreW >= 120, 'B2. … et le titre garde de la place (' + m.titreW + ' px)');
        check(m.dedans, 'B3. rien ne déborde de l\'écran');
        check(m.noteDroite, 'B4. les vignettes de notes restent calées sur l\'objectif tempo');
        check(m.deSousMetro, 'B5. le groupe du dé passe à la ligne d\'un bloc, sans chevaucher le métronome');
        check(erreurs.length === 0, 'B6. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }
    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
