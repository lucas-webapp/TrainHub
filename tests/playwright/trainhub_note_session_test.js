// Note (1 à 5 étoiles) et commentaire de la SESSION elle-même (le modèle, sans qu'elle soit lancée) : étoiles dans la liste des sessions,
// bloc dans l'écran d'édition, fin de session, copie, barre du haut en thème « verre ». Les sessions sont GRAINEES dans l'état local.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_note_session_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : note et commentaire de la session');
const estBruitReseau = harnais.estBruitReseau;
plan(86);
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

async function ouvrir(browser, { viewport = { width: 1280, height: 900 }, theme = null, glass = false, glassBg = null, horloge = false, live = null } = {}) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', colorScheme: 'dark' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !estBruitReseau(m.text()) && !/ERR_FAILED/.test(m.text())) erreurs.push('console: ' + m.text()); });
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    if (horloge) await page.clock.install();
    await page.addInitScript(({ theme, glass, glassBg, live }) => {
        try {
            localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1');
            if (theme) localStorage.setItem('trainhub.theme.v1', theme);
            if (glass) localStorage.setItem('trainhub.glass.v1', '1');
            if (glassBg) localStorage.setItem('trainhub.glassBg.v1', glassBg);
            if (sessionStorage.getItem('__seed')) return;
            sessionStorage.setItem('__seed', '1');
            const ex = (id, title) => ({ id, title, notes: '' });
            const st = {
                activeInstrumentId: 'i1', updatedAt: 1,
                instruments: [{ id: 'i1', name: 'Guitare', categories: [{ id: 'c1', name: 'Technique', color: '#e91e63', folders: [], exercises: [ex('e1', 'Gamme avec accents'), ex('e2', 'Arpèges'), ex('e3', 'Blues en La')] }] }],
                settings: {
                    guidedSessions: [
                        { id: 'g1', name: 'Session vitesse', instrumentId: 'i1', tabIds: [], createdAt: 1700000000000, steps: [{ id: 'p1', exerciseId: 'e1', minutes: 4 }, { id: 'p2', exerciseId: 'e2', minutes: 8 }] },
                        { id: 'g2', name: 'Session blues', instrumentId: 'i1', tabIds: [], createdAt: 1700000001000, rating: 4, comment: 'Très bon enchaînement', steps: [{ id: 'p3', exerciseId: 'e3', minutes: 12 }] },
                        { id: 'g3', name: 'Session à valeurs absurdes', instrumentId: 'i1', tabIds: [], createdAt: 1700000002000, rating: 9, comment: '    ', steps: [{ id: 'p4', exerciseId: 'e1', minutes: 5 }] },
                        { id: 'g4', name: 'Session à note texte', instrumentId: 'i1', tabIds: [], createdAt: 1700000003000, rating: 'beaucoup', comment: 42, steps: [{ id: 'p5', exerciseId: 'e2', minutes: 5 }] }
                    ]
                }
            };
            localStorage.setItem('trainhub.v1', JSON.stringify(st));
            if (live) localStorage.setItem('trainhub.gsLive.v1', JSON.stringify(live));
        } catch (e) { }
    }, { theme, glass, glassBg, live });
    await page.goto('http://localhost:8765/index.html');
    await page.waitForTimeout(700);
    return { ctx, page, erreurs };
}
const etat = page => page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.v1')));
const sess = async (page, id) => (await etat(page)).settings.guidedSessions.find(g => g.id === id);
async function ouvrirListe(page) {
    if (!(await page.locator('.gs-session-row').count())) await page.click('#guided-session-btn');
    await page.waitForSelector('.gs-session-row');
}
const ligne = (page, nom) => page.locator('.gs-session-row', { hasText: nom }).first();
const allumees = l => l.locator('.rate-star.on').count();

(async () => {
    const browser = await chromium.launch();

    // ============ A. Liste des sessions : les étoiles sont dans la barre de titre de chaque session ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await ouvrirListe(page);
        const n = await page.locator('.gs-session-row').count();
        check(n === 4, `A. quatre sessions dans la liste (${n})`);
        const l1 = ligne(page, 'Session vitesse'), l2 = ligne(page, 'Session blues'), l3 = ligne(page, 'Session à valeurs absurdes'), l4 = ligne(page, 'Session à note texte');
        check(await l1.locator('.rate-star').count() === 5 && await allumees(l1) === 0, 'A. chaque session a ses cinq étoiles, éteintes tant qu\'elle n\'a pas de note');
        check(await allumees(l2) === 4, `A. « Session blues » (note 4 enregistrée) montre quatre étoiles (${await allumees(l2)})`);
        check(await l2.locator('.gs-session-comment').isVisible() && (await l2.locator('.gs-session-comment').innerText()) === 'Très bon enchaînement', 'A. et son commentaire sur sa propre ligne');
        check(!(await l1.locator('.gs-session-comment').isVisible()), 'A. pas de ligne de commentaire quand il n\'y en a pas');
        const nom = await l2.locator('.gs-session-name').boundingBox(), et = await l2.locator('.rate-stars').boundingBox();
        check(et.x > nom.x + nom.width - 1 && Math.abs((et.y + et.height / 2) - (nom.y + nom.height / 2)) < 14, `A. les étoiles sont sur la ligne du titre, à droite du nom (nom x=${Math.round(nom.x)}–${Math.round(nom.x + nom.width)}, étoiles x=${Math.round(et.x)}, Δy=${Math.round(Math.abs((et.y + et.height / 2) - (nom.y + nom.height / 2)))})`);
        // taille et centrage : les étoiles restent plus petites qu'une ligne de texte ; le texte du cadre est centré comme les boutons de droite
        for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
            await page.setViewportSize(vp);
            await page.waitForTimeout(250);
            const m = await page.evaluate(() => Array.from(document.querySelectorAll('.gs-session-row')).map(row => {
                const rb = row.getBoundingClientRect(), box = s => { const e = row.querySelector(s); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return b.width ? b : null; };
                const parts = ['.gs-session-name', '.gs-session-meta', '.rate-stars', '.gs-session-comment'].map(box).filter(Boolean);
                const haut = Math.min(...parts.map(b => b.top)) - rb.top, bas = rb.bottom - Math.max(...parts.map(b => b.bottom));
                const nm = box('.gs-session-name'), ac = box('.gs-session-actions'), st = box('.rate-star'), bu = box('.gs-session-cmt-btn');
                return { cadre: row.querySelector('.gs-session-name').textContent.slice(0, 14), ecart: +(haut - bas).toFixed(1), titreDecale: nm && ac ? +(((nm.top + nm.height / 2) - (rb.top + rb.height / 2))).toFixed(1) : null, comm: !!box('.gs-session-comment'), etoile: st && Math.round(st.height), bulle: bu && Math.round(bu.height), larg: Math.round(box('.rate-stars').width) };
            }));
            check(m.every(x => Math.abs(x.ecart) <= 2), `A. ${vp.width} px : le contenu de chaque cadre est centré (écart haut/bas en px : ${m.map(x => x.ecart).join(', ')})`);
            if (vp.width > 800) check(m.filter(x => !x.comm).every(x => Math.abs(x.titreDecale) <= 1.5), `A. ${vp.width} px : sur une ligne, le titre est à la hauteur du centre du cadre (décalage ${m.filter(x => !x.comm).map(x => x.titreDecale).join(', ')} px)`);
            check(m.every(x => x.etoile <= 16 && x.bulle <= 20 && x.larg <= 80), `A. ${vp.width} px : étoiles de ${m[0].etoile} px (${m[0].larg} px pour les cinq), bulle de ${m[0].bulle} px`);
        }
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.waitForTimeout(200);
        // valeurs absurdes : retirées au chargement
        const s = await etat(page);
        const g3 = s.settings.guidedSessions.find(g => g.id === 'g3'), g4 = s.settings.guidedSessions.find(g => g.id === 'g4');
        check(!('rating' in g3) && !('comment' in g3) && !('rating' in g4) && !('comment' in g4) && await allumees(l3) === 0 && await allumees(l4) === 0 && !(await l3.locator('.gs-session-comment').isVisible()), `A. note 9, texte, commentaire vide ou numérique : ignorés (${JSON.stringify([g3.rating, g3.comment, g4.rating, g4.comment])})`);
        // clic sur la 3e étoile : note enregistrée, sans ouvrir la session
        await l1.locator('.rate-star[data-k="3"]').click();
        await page.waitForTimeout(250);
        check(await allumees(l1) === 3 && (await page.locator('.gs-edit-topbar').count()) === 0, 'A. un clic sur la 3e étoile allume trois étoiles sans ouvrir la session');
        let g1 = await sess(page, 'g1');
        check(g1.rating === 3, `A. la note est enregistrée dans la session (rating = ${g1.rating})`);
        check((await l1.locator('.rate-star[data-k="3"]').getAttribute('title')).includes('Correct'), 'A. au survol : « 3 sur 5 : Correct »');
        await l1.locator('.rate-star[data-k="3"]').click();
        await page.waitForTimeout(250);
        g1 = await sess(page, 'g1');
        check(await allumees(l1) === 0 && g1.rating === undefined, 'A. un clic sur l\'étoile déjà choisie efface la note');
        await l1.locator('.rate-star[data-k="5"]').click();
        await page.waitForTimeout(250);
        // la note n'est pas une « modification » de la session (tri par date de modification)
        await page.reload();
        await page.waitForTimeout(500);
        await ouvrirListe(page);
        g1 = await sess(page, 'g1');
        check(g1.rating === 5 && g1.updatedAt === undefined, `A. noter ne compte pas comme modifier la session (updatedAt = ${g1.updatedAt})`);
        // commentaire
        const l1b = ligne(page, 'Session vitesse');
        await l1b.locator('.gs-session-cmt-btn').click();
        await page.waitForSelector('.app-dialog-input');
        check(await page.locator('.app-dialog-input').inputValue() === '', 'A. le commentaire s\'ouvre vide pour une session sans commentaire');
        await page.locator('.app-dialog-input').fill('Exercice 2 trop long');
        await page.locator('.app-dialog button', { hasText: /^Enregistrer$/ }).click();
        await page.waitForTimeout(250);
        g1 = await sess(page, 'g1');
        check(g1.comment === 'Exercice 2 trop long' && g1.rating === 5, `A. commentaire enregistré sans toucher à la note (${g1.comment} / ${g1.rating})`);
        check((await l1b.locator('.gs-session-comment').innerText()) === 'Exercice 2 trop long' && (await l1b.locator('.gs-session-cmt-btn').getAttribute('class')).includes('on'), 'A. affiché sous le nom, et la bulle est allumée');
        await l1b.locator('.gs-session-cmt-btn').click();
        await page.waitForSelector('.app-dialog-input');
        check(await page.locator('.app-dialog-input').inputValue() === 'Exercice 2 trop long' && await page.locator('.app-dialog button', { hasText: /Effacer/ }).count() === 1, 'A. le commentaire se rouvre rempli, avec « Effacer »');
        await page.locator('.app-dialog button', { hasText: /Effacer/ }).click();
        await page.waitForTimeout(250);
        g1 = await sess(page, 'g1');
        check(g1.comment === undefined && !(await l1b.locator('.gs-session-comment').isVisible()), 'A. « Effacer » retire le commentaire');
        await page.locator('.gs-session-cmt-btn').first().evaluate(b => b.click()); // remet un commentaire pour la copie ci-dessous
        await page.waitForSelector('.app-dialog-input');
        await page.locator('.app-dialog-input').fill('à copier ?');
        await page.locator('.app-dialog button', { hasText: /^Enregistrer$/ }).click();
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(SHOTS, 'ns-1-liste.png') });
        check(erreurs.length === 0, 'A. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ B. Écran d'édition : noter sans lancer, sans « Enregistrer » ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await ouvrirListe(page);
        await ligne(page, 'Session vitesse').locator('.gs-session-name').click();
        await page.waitForSelector('.gs-edit-topbar');
        const rangee = page.locator('.gs-name-row');
        check(await rangee.locator('input.gs-name-input').count() === 1 && await rangee.locator('.rate-star').count() === 5, 'B. la barre de titre de la session contient le nom et les cinq étoiles');
        const gm = await page.evaluate(() => { const g = s => document.querySelector(s).getBoundingClientRect(); return { champ: g('.gs-name-input').height, pilule: g('.gs-name-rate').height, etoile: g('.gs-name-rate .rate-star').height, larg: g('.gs-name-rate').width, hautChamp: g('.gs-name-input').top, hautPilule: g('.gs-name-rate').top }; });
        check(Math.abs(gm.champ - gm.pilule) <= 1 && Math.abs(gm.hautChamp - gm.hautPilule) <= 1 && gm.etoile <= 20 && gm.larg <= 190, `B. barre de titre : le cadre des étoiles a la hauteur du champ du nom (${gm.pilule} px / ${gm.champ} px), étoiles de ${gm.etoile} px, ${Math.round(gm.larg)} px de large`);
        check((await rangee.locator('.rate-label').innerText()).includes('Pas de note') && await page.locator('textarea.gs-note-comment').count() === 1, 'B. « Pas de note » et un champ de commentaire');
        const bt = page.locator('.gs-save-btn');
        check(await bt.isDisabled() && (await bt.innerText()).trim() === 'Enregistré', 'B. départ : « Enregistré » (rien à enregistrer)');
        await rangee.locator('.rate-star[data-k="4"]').click();
        await page.waitForTimeout(300);
        let g1 = await sess(page, 'g1');
        check(g1.rating === 4 && (await rangee.locator('.rate-label').innerText()).includes('Bien'), `B. 4 étoiles : « Bien », enregistré tout de suite (rating = ${g1.rating})`);
        check(await bt.isDisabled() && (await bt.innerText()).trim() === 'Enregistré', 'B. la note ne rend pas la session « à enregistrer »');
        await page.locator('textarea.gs-note-comment').fill('Exercice 2 trop long');
        await page.waitForTimeout(900);
        g1 = await sess(page, 'g1');
        check(g1.comment === 'Exercice 2 trop long' && await bt.isDisabled(), `B. commentaire enregistré au fil de la frappe (${g1.comment})`);
        // une vraie modification (durée) + Enregistrer : la note et le commentaire ne sont pas écrasés par la copie de travail
        await page.locator('.gs-step-minutes').first().fill('6');
        await page.locator('.gs-step-minutes').first().dispatchEvent('change');
        await page.waitForTimeout(250);
        check(await bt.isEnabled(), 'B. une durée modifiée active « Enregistrer »');
        await rangee.locator('.rate-star[data-k="2"]').click(); // on change la note PENDANT que la copie de travail est modifiée
        await bt.click();
        await page.waitForTimeout(400);
        g1 = await sess(page, 'g1');
        check(g1.rating === 2 && g1.comment === 'Exercice 2 trop long' && g1.steps[0].minutes === 6, `B. après « Enregistrer » : note ${g1.rating}, commentaire gardé, durée ${g1.steps[0].minutes} min`);
        // annuler les modifications ne touche pas à la note
        await page.locator('.gs-step-minutes').first().fill('9');
        await page.locator('.gs-step-minutes').first().dispatchEvent('change');
        await page.waitForTimeout(200);
        await page.locator('.gs-cancel-btn').click();
        await page.waitForTimeout(400);
        g1 = await sess(page, 'g1');
        check(g1.rating === 2 && g1.comment === 'Exercice 2 trop long' && g1.steps[0].minutes === 6 && await page.locator('textarea.gs-note-comment').inputValue() === 'Exercice 2 trop long', 'B. « Annuler » défait la durée, pas la note ni le commentaire');
        await page.screenshot({ path: path.join(SHOTS, 'ns-2-edition.png') });
        // retour à la liste : la note est là
        await page.locator('.gs-back-btn').click();
        await page.waitForSelector('.gs-session-row');
        const l1 = ligne(page, 'Session vitesse');
        check(await allumees(l1) === 2 && (await l1.locator('.gs-session-comment').innerText()) === 'Exercice 2 trop long', 'B. retour à la liste : deux étoiles et le commentaire');
        // Ctrl+Z de l'application : revient à la note précédente
        await l1.locator('.rate-star[data-k="5"]').click();
        await page.waitForTimeout(300);
        check(await allumees(ligne(page, 'Session vitesse')) === 5, 'B. 5 étoiles depuis la liste');
        check(erreurs.length === 0, 'B. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ C. Copie d'une session : pas la note de l'originale ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await ouvrirListe(page);
        await ligne(page, 'Session blues').click({ button: 'right' });
        await page.waitForSelector('.ctx-menu');
        await page.locator('.ctx-menu >> text=Dupliquer').first().click();
        await page.waitForTimeout(400);
        const s = await etat(page);
        const copie = s.settings.guidedSessions.find(g => g.name === 'Session blues (copie)'), orig = s.settings.guidedSessions.find(g => g.id === 'g2');
        check(copie && copie.rating === undefined && copie.comment === undefined && orig.rating === 4, `C. la copie repart sans note ni commentaire, l'originale garde 4 étoiles (copie : ${copie && copie.rating} / ${copie && copie.comment})`);
        check(erreurs.length === 0, 'C. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ D. Fin de session : la note donnée à la séance devient celle de la session ============
    {   // D1 : séance non enregistrée retrouvée au lancement (même fenêtre d'enregistrement que la fin de session)
        const now = Date.now();
        const rec = { v: 2, id: 'r1', sessionId: 'g2', name: 'Session blues', instrumentId: 'i1', date: now - 900000, endedAt: now - 60000, totalSec: 840, plannedSec: 720, steps: [{ exerciseId: 'e3', title: 'Blues en La', actualSec: 840, plannedMin: 12 }] };
        const { ctx, page, erreurs } = await ouvrir(browser, { live: { v: 1, kind: 'record', savedAt: now, record: rec, extraSteps: [] } });
        await page.waitForSelector('.gs-live-save', { timeout: 8000 });
        await page.click('.gs-live-save');
        await page.waitForSelector('.gs-save-run-panel .gs-rec-rate');
        await page.locator('.gs-save-run-panel .rate-star[data-k="2"]').click();
        await page.locator('.gs-save-run-panel textarea.gs-rec-comment').fill('Trop dur ce soir');
        await page.locator('.gs-save-run-panel button.gs-rec-save').click();
        const quand = page.locator('.app-dialog button', { hasText: /Enregistrer quand même/ });
        if (await quand.waitFor({ timeout: 1500 }).then(() => true, () => false)) await quand.click();
        await page.waitForTimeout(500);
        const g2 = await sess(page, 'g2');
        check(g2.rating === 2 && g2.comment === 'Trop dur ce soir', `D. séance retrouvée, notée 2 : la session « Session blues » passe de 4 à ${g2.rating} étoiles, commentaire « ${g2.comment} »`);
        await ouvrirListe(page);
        check(await allumees(ligne(page, 'Session blues')) === 2 && (await ligne(page, 'Session blues').locator('.gs-session-comment').innerText()) === 'Trop dur ce soir', 'D. la liste des sessions montre aussitôt ces 2 étoiles et ce commentaire');
        check(erreurs.length === 0, 'D1. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }
    {   // D2 : une séance enregistrée SANS note ni commentaire ne touche pas à la note de la session
        const now = Date.now();
        const rec = { v: 2, id: 'r2', sessionId: 'g2', name: 'Session blues', instrumentId: 'i1', date: now - 900000, endedAt: now - 60000, totalSec: 840, plannedSec: 720, steps: [{ exerciseId: 'e3', title: 'Blues en La', actualSec: 840, plannedMin: 12 }] };
        const { ctx, page, erreurs } = await ouvrir(browser, { live: { v: 1, kind: 'record', savedAt: now, record: rec, extraSteps: [] } });
        await page.waitForSelector('.gs-live-save', { timeout: 8000 });
        await page.click('.gs-live-save');
        await page.waitForSelector('.gs-save-run-panel .gs-rec-rate');
        await page.locator('.gs-save-run-panel button.gs-rec-save').click();
        const quand = page.locator('.app-dialog button', { hasText: /Enregistrer quand même/ });
        if (await quand.waitFor({ timeout: 1500 }).then(() => true, () => false)) await quand.click();
        await page.waitForTimeout(500);
        const g2 = await sess(page, 'g2');
        check(g2.rating === 4 && g2.comment === 'Très bon enchaînement', `D. séance enregistrée sans note : la session garde ses ${g2.rating} étoiles et son commentaire`);
        check(erreurs.length === 0, 'D2. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }
    {   // D3 : vraie fin de session lancée (horloge simulée : 13 minutes de pratique)
        const { ctx, page, erreurs } = await ouvrir(browser, { horloge: true });
        await ouvrirListe(page);
        await ligne(page, 'Session blues').locator('.gs-session-play-btn').click();
        await page.waitForSelector('.gs-run-screen, .gs-run, #guided-run, .gs-run-title', { timeout: 8000 }).catch(() => { });
        await page.clock.fastForward('13:00');
        await page.waitForTimeout(300);
        // dernière étape : « Terminer »
        const fin = page.locator('button', { hasText: /^Terminer$/ }).first();
        if (await fin.count()) await fin.click();
        const ok = await page.waitForSelector('.gs-save-run-panel .gs-rec-rate', { timeout: 6000 }).then(() => true, () => false);
        check(ok, 'D. à la fin d\'une vraie session (13 min de pratique), la fenêtre d\'enregistrement propose « Comment c\'était ? »');
        if (ok) {
            await page.locator('.gs-save-run-panel .rate-star[data-k="5"]').click();
            await page.locator('.gs-save-run-panel textarea.gs-rec-comment').fill('Parfait');
            await page.locator('.gs-save-run-panel button.gs-rec-save').click();
            const quand = page.locator('.app-dialog button', { hasText: /Enregistrer quand même/ });
            if (await quand.waitFor({ timeout: 1500 }).then(() => true, () => false)) await quand.click();
            await page.waitForTimeout(500);
            const g2 = await sess(page, 'g2');
            check(g2.rating === 5 && g2.comment === 'Parfait', `D. fin de session notée 5 : la session passe à ${g2.rating} étoiles, commentaire « ${g2.comment} »`);
        } else check(false, 'D. (non exécuté : pas de fenêtre d\'enregistrement)');
        check(erreurs.length === 0, 'D3. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ E. Barre du haut de l'écran d'édition, au repos : plus de barre noire en thème « verre » ============
    for (const [nom, opt] of [['verre-aurore', { glass: true }], ['verre-bleu', { glass: true, glassBg: 'blue' }], ['verre-clair', { glass: true, theme: 'light' }], ['sombre', {}], ['clair', { theme: 'light' }]]) {
        const { ctx, page, erreurs } = await ouvrir(browser, opt);
        await ouvrirListe(page);
        await ligne(page, 'Session vitesse').locator('.gs-session-name').click();
        await page.waitForSelector('.gs-edit-topbar');
        const m = await page.evaluate(() => {
            const b = document.querySelector('.gs-edit-topbar'), cs = getComputedStyle(b), t = getComputedStyle(document.querySelector('.top-bar'));
            return { fond: cs.backgroundColor, flou: cs.backdropFilter || cs.webkitBackdropFilter, fondBarre: t.backgroundColor, glass: document.documentElement.getAttribute('data-glass'), bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() };
        });
        const alpha = c => { const x = /rgba?\(([^)]+)\)/.exec(c); if (!x) return 1; const p = x[1].split(/[ ,\/]+/).filter(Boolean); return p.length >= 4 ? parseFloat(p[3]) : 1; };
        if (nom.startsWith('verre')) check(alpha(m.fond) === 0 && !/blur/.test(m.flou || ''), `E. ${nom} : au repos, la barre n'a plus de fond noir : elle laisse voir le dégradé (fond ${m.fond}, filtre ${m.flou})`);
        else check(alpha(m.fond) === 1 && !/blur/.test(m.flou || 'none'), `E. ${nom} : hors thème verre, la barre garde son fond uni (${m.fond})`);
        await page.screenshot({ path: path.join(SHOTS, `ns-3-barre-${nom}.png`), clip: { x: 0, y: 0, width: 1280, height: 420 } });
        check(erreurs.length === 0, `E. ${nom} : aucune erreur JavaScript ` + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ G. La barre se fond dans la page au repos, et prend son fond « verre » quand elle est collée en haut ============
    for (const [nom, opt] of [['verre-aurore', { glass: true }], ['verre-clair', { glass: true, theme: 'light' }], ['sombre', {}]]) {
        const { ctx, page, erreurs } = await ouvrir(browser, { ...opt, viewport: { width: 1280, height: 400 } }); // fenêtre basse : la page défile
        await ouvrirListe(page);
        await ligne(page, 'Session vitesse').locator('.gs-session-name').click();
        await page.waitForSelector('.gs-edit-topbar');
        const lire = () => page.evaluate(() => { const b = document.querySelector('.gs-edit-topbar'), cs = getComputedStyle(b); return { stuck: b.classList.contains('gs-edit-stuck'), fond: cs.backgroundColor, flou: cs.backdropFilter || cs.webkitBackdropFilter || 'none', defile: document.documentElement.scrollHeight - innerHeight, y: Math.round(b.getBoundingClientRect().top), barreBas: Math.round(document.querySelector('.top-bar').getBoundingClientRect().bottom) }; });
        const alpha = c => { const x = /rgba?\(([^)]+)\)/.exec(c); if (!x) return 1; const p = x[1].split(/[ ,\/]+/).filter(Boolean); return p.length >= 4 ? parseFloat(p[3]) : 1; };
        let r0 = await lire();
        check(!r0.stuck, `G. ${nom} : au repos, la barre n'est pas « collée » (y = ${r0.y})`);
        if (nom.startsWith('verre')) check(alpha(r0.fond) === 0 && !/blur/.test(r0.flou), `G. ${nom} : au repos, transparente et sans flou (fond ${r0.fond}, filtre ${r0.flou})`);
        else check(alpha(r0.fond) === 1, `G. ${nom} : au repos, fond uni habituel (${r0.fond})`);
        await page.mouse.move(640, 400);
        await page.evaluate(() => window.scrollTo(0, 400));
        await page.waitForTimeout(250);
        const r1 = await lire();
        check(r1.defile > 0 ? r1.stuck : true, `G. ${nom} : après défilement, la barre est collée en haut (y = ${r1.y}, page défilable de ${r1.defile} px)`);
        check(Math.abs(r1.y - r1.barreBas) <= 1, `G. ${nom} : collée juste sous la barre de l'appli, pas cachée derrière (barre collée y = ${r1.y}, bas de la barre de l'appli = ${r1.barreBas})`);
        if (nom.startsWith('verre')) check(r1.stuck && alpha(r1.fond) > 0 && alpha(r1.fond) < 1 && /blur/.test(r1.flou), `G. ${nom} : collée, elle devient « verre » : translucide et floue (fond ${r1.fond}, filtre ${r1.flou})`);
        else check(alpha(r1.fond) === 1, `G. ${nom} : collée, fond uni habituel (${r1.fond})`);
        await page.screenshot({ path: path.join(SHOTS, `ns-5-collee-${nom}.png`) });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(250);
        const r2 = await lire();
        check(!r2.stuck, `G. ${nom} : de retour en haut, elle se fond de nouveau dans la page`);
        // l'écran est redessiné alors que la page est défilée (« Annuler ») : l'état « collée » est juste dès le départ
        await page.locator('.gs-step-minutes').first().fill('9');
        await page.locator('.gs-step-minutes').first().dispatchEvent('change');
        await page.waitForTimeout(150);
        await page.evaluate(() => window.scrollTo(0, 400));
        await page.waitForTimeout(250);
        await page.locator('.gs-cancel-btn').click();
        await page.waitForTimeout(400);
        const r3 = await lire();
        const hautPage = await page.evaluate(() => Math.round(window.scrollY));
        check(r3.stuck === (hautPage > 0 && r3.defile > 0 && r3.y <= r3.barreBas + 1), `G. ${nom} : écran redessiné alors que la page est défilée (scrollY ${hautPage}) : barre ${r3.stuck ? 'collée' : 'à sa place'}, comme il se doit`);
        check(erreurs.length === 0, `G. ${nom} : aucune erreur JavaScript ` + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ F. Téléphone : lisible, rien ne déborde ============
    for (const [nom, opt] of [['tel-sombre', {}], ['tel-verre', { glass: true }]]) {
        const { ctx, page, erreurs } = await ouvrir(browser, { ...opt, viewport: { width: 390, height: 844 } });
        await ouvrirListe(page);
        const m1 = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth - innerWidth, dep: Array.from(document.querySelectorAll('.gs-session-row')).some(r => r.scrollWidth > r.clientWidth + 1) }));
        check(m1.doc <= 0 && !m1.dep, `F. ${nom} : liste sans débordement (${JSON.stringify(m1)})`);
        await page.screenshot({ path: path.join(SHOTS, `ns-4-${nom}-liste.png`) });
        await ligne(page, 'Session blues').locator('.gs-session-name').click();
        await page.waitForSelector('.gs-name-row');
        const m2 = await page.evaluate(() => { const r = document.querySelector('.gs-name-rate').getBoundingClientRect(); return { doc: document.documentElement.scrollWidth - innerWidth, droite: Math.round(r.right), gauche: Math.round(r.left) }; });
        check(m2.doc <= 0 && m2.droite <= 390 && m2.gauche >= 0, `F. ${nom} : barre de titre de l'édition dans l'écran (${JSON.stringify(m2)})`);
        await page.screenshot({ path: path.join(SHOTS, `ns-4-${nom}-edition.png`) });
        check(erreurs.length === 0, `F. ${nom} : aucune erreur JavaScript ` + JSON.stringify(erreurs));
        await ctx.close();
    }

    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
