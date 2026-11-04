// Session guidée en cours : barre d'avancement verte (par la durée), largeur maximale des boutons, bouton « fenêtre flottante » dans la colonne,
// carte des temps sous le métronome épinglé, logo sans titre dans la barre du haut.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_session_ui_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : session en cours — barre d\'avancement, boutons, temps sous le métronome, logo');
const estBruitReseau = harnais.estBruitReseau;
plan(70);
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

async function ouvrir(browser, { viewport, taille = null, glass = false, etapes = 3 } = {}) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', colorScheme: 'dark' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !estBruitReseau(m.text()) && !/ERR_FAILED/.test(m.text())) erreurs.push('console: ' + m.text()); });
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.addInitScript(({ taille, glass, etapes }) => {
        try {
            localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1');
            localStorage.setItem('trainhub.metroDock.v1', '1');
            if (glass) localStorage.setItem('trainhub.glass.v1', '1');
            if (taille) localStorage.setItem('trainhub.metroDockSize.v1', JSON.stringify(taille));
            if (sessionStorage.getItem('__seed')) return;
            sessionStorage.setItem('__seed', '1');
            const ex = (id, title, o) => Object.assign({ id, title, notes: '', collapsed: true }, o || {});
            // 2 + 3 + 10 minutes : le dernier exercice dure plus que les deux autres réunis
            const titres = ['Gamme avec accents', 'Arpèges', 'Blue Bossa', 'Tremolo', 'Legato', 'Slap', 'Walking bass sur un blues en Fa avec un titre vraiment très long pour vérifier la coupure', 'Accords', 'Improvisation'];
            const nb = etapes === 3 ? 3 : etapes, exs = [], steps = [];
            for (let i = 0; i < nb; i++) { exs.push(ex('e' + (i + 1), titres[i])); steps.push({ id: 'p' + (i + 1), exerciseId: 'e' + (i + 1), minutes: nb === 3 ? [2, 3, 10][i] : 2 + (i % 3) }); }
            localStorage.setItem('trainhub.v1', JSON.stringify({ activeInstrumentId: 'i1', updatedAt: 1, instruments: [{ id: 'i1', name: 'Guitare', categories: [{ id: 'c1', name: 'Technique', color: '#e91e63', folders: [], exercises: exs }] }],
                settings: { guidedSessions: [{ id: 'g1', name: 'Session test', instrumentId: 'i1', tabIds: [], createdAt: 1, steps: steps }] } }));
        } catch (e) { }
    }, { taille, glass, etapes });
    await page.goto('http://localhost:8765/index.html');
    await page.waitForTimeout(800);
    return { ctx, page, erreurs };
}
async function lancerSession(page, { metronome = true } = {}) {
    await page.click('#guided-session-btn');
    await page.waitForSelector('.gs-session-row');
    await page.locator('.gs-session-row .gs-session-play-btn').first().click();
    await page.waitForSelector('.gs-run-timer-row');
    await page.waitForTimeout(400);
    if (metronome && !(await page.locator('.metro-dock:not([hidden])').count())) { await page.locator('.gs-run-metro-btn').first().click(); await page.waitForTimeout(800); }
}
const suivant = async page => { await page.locator('.gs-run-nav-row button.btn-accent').click(); await page.waitForTimeout(500); };
const barre = page => page.evaluate(() => { const b = document.querySelector('.gs-run-bar'), f = b.querySelector('.gs-run-bar-fill'), bb = b.getBoundingClientRect(); return { now: +b.getAttribute('aria-valuenow'), w: f.getBoundingClientRect().width / bb.width * 100, ticks: Array.from(b.querySelectorAll('.gs-run-bar-tick')).map(t => +(((t.getBoundingClientRect().left + 1) - bb.left) / bb.width * 100).toFixed(1)), cur: (() => { const c = b.querySelector('.gs-run-bar-cur').getBoundingClientRect(); return [+((c.left - bb.left) / bb.width * 100).toFixed(1), +(c.width / bb.width * 100).toFixed(1)]; })(), titre: b.title, couleur: getComputedStyle(f).backgroundImage }; });
const carte = page => page.evaluate(() => { const c = document.querySelector('.gs-dock-clock'); if (!c) return null; const v = k => c.querySelector('[data-k="' + k + '"]').textContent, b = c.getBoundingClientRect(), p = document.querySelector('.metro-dock .backups-panel').getBoundingClientRect(); return { total: v('total'), left: v('left'), ex: v('ex'), exleft: !!c.querySelector('[data-k="exleft"]'), cells: c.querySelectorAll('.gs-clock-cell').length, sub: v('sub'), foot: v('foot'), haut: b.top, bas: b.bottom, gauche: b.left, larg: b.width, panBas: p.bottom, panG: p.left, panL: p.width, visible: b.width > 0 }; });
const sec = t => { const p = t.replace('+', '').split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };

(async () => {
    const browser = await chromium.launch();

    // ============ A. Barre d'avancement : par la durée, pas par le nombre d'exercices ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { viewport: { width: 1440, height: 900 } });
        await lancerSession(page);
        let b = await barre(page);
        check(await page.locator('.gs-run-bar[role="progressbar"]').count() === 1 && b.now <= 1, `A. une barre d'avancement sous « Exercice 1 / 3 », presque vide au départ (${b.now} %)`);
        check(b.ticks.length === 2 && Math.abs(b.ticks[0] - 13.3) < 0.6 && Math.abs(b.ticks[1] - 33.3) < 0.6, `A. un repère entre chaque exercice, à 13,3 % et 33,3 % (2 + 3 + 10 min) : ${b.ticks.join(' %, ')} %`);
        check(Math.abs(b.cur[0]) < 0.5 && Math.abs(b.cur[1] - 13.3) < 0.6, `A. l'exercice en cours est mis en valeur (du ${b.cur[0]} % sur ${b.cur[1]} % de la barre)`);
        await suivant(page);
        b = await barre(page);
        check(Math.abs(b.now - 13) <= 1 && Math.abs(b.w - 13.3) < 1.2, `A. au 2e exercice : 13 % (et non 33 % = 1/3 des exercices) — barre à ${b.w.toFixed(1)} %`);
        check(b.cur[0] > 12 && b.cur[0] < 14.5 && Math.abs(b.cur[1] - 20) < 0.8, `A. l'exercice en cours occupe 20 % de la barre (${b.cur[1]} %)`);
        await suivant(page);
        b = await barre(page);
        check(Math.abs(b.now - 33) <= 1 && Math.abs(b.cur[1] - 66.7) < 0.8, `A. au dernier exercice (le plus long) : seulement 33 % faits, il occupe 67 % de la barre (${b.now} %, ${b.cur[1]} %)`);
        check(/33 % de la durée prévue/.test(b.titre) && /exercice 3 sur 3/.test(b.titre), `A. au survol : « ${b.titre} »`);
        check(/rgb\(233, 30, 99\)/.test(b.couleur), `A. la barre prend la couleur du dossier de l'exercice (ici rose, comme le chapitre « Technique ») et non plus un vert unique (${b.couleur.slice(0, 80)}…)`);
        await page.locator('.gs-run-adjust-row button', { hasText: '+1 min' }).click();
        await page.waitForTimeout(400);
        b = await barre(page);
        check(Math.abs(b.cur[1] - 11 / 16 * 100) < 0.8 && Math.abs(b.ticks[1] - 5 / 16 * 100) < 0.6, `A. « +1 min » rallonge l'exercice en cours : la barre est recalculée (repère à ${b.ticks[1]} % au lieu de 33,3 %)`);
        await page.locator('.gs-run-nav-row button', { hasText: 'Précédent' }).click();
        await page.waitForTimeout(500);
        b = await barre(page);
        check(Math.abs(b.now - 13) <= 1, `A. « Précédent » : la barre recule (${b.now} %)`);
        await page.screenshot({ path: path.join(SHOTS, 'sui-1-barre.png') });
        check(erreurs.length === 0, 'A. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ B. Largeur des boutons ; bouton « fenêtre flottante » dans la colonne ============
    for (const [w, h] of [[1728, 1000], [1440, 900], [1024, 800]]) {
        const { ctx, page } = await ouvrir(browser, { viewport: { width: w, height: h } });
        await lancerSession(page, { metronome: w >= 1100 });
        const g = await page.evaluate(() => { const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, w: b.width, h: b.height }; }; return { head: r('.gs-run-head'), controls: r('.gs-run-controls'), nav: r('.gs-run-nav-row'), adj: r('.gs-run-adjust-row'), mini: r('.gs-run-mini-btn'), top: r('.gs-run-topline'), main: r('.gs-main'), doc: document.documentElement.scrollWidth - innerWidth }; });
        const maxW = Math.max(g.controls.w, g.nav.w, g.adj.w);
        check(maxW <= 441 && (w >= 1100 ? g.main.w > 600 : true), `B. ${w} px : boutons de ${Math.round(g.controls.w)} px au plus (avant : 560 px) alors que la zone fait ${Math.round(g.main.w)} px`);
        check(Math.abs(g.controls.l - g.nav.l) <= 1 && Math.abs(g.controls.r - g.nav.r) <= 1 && Math.abs(g.head.l - g.controls.l) <= 1 && Math.abs(g.head.r - g.controls.r) <= 1, `B. ${w} px : ligne du haut, barre et boutons ont les mêmes bords gauche et droit`);
        check(g.mini.r <= g.controls.r + 1 && g.mini.l >= g.controls.l && g.top.h <= 36, `B. ${w} px : le bouton « fenêtre flottante » est à l'intérieur de cette colonne (bord droit ${Math.round(g.mini.r)} px ≤ ${Math.round(g.controls.r)} px), ligne de ${Math.round(g.top.h)} px`);
        check(g.doc <= 0, `B. ${w} px : rien ne déborde`);
        if (w === 1728) await page.screenshot({ path: path.join(SHOTS, 'sui-2-large.png') });
        await ctx.close();
    }

    // ============ C. Carte des temps sous le métronome épinglé ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { viewport: { width: 1440, height: 900 } });
        await lancerSession(page);
        await suivant(page); // 2e exercice : 3 min
        let c = await carte(page);
        check(!!c && c.visible && c.haut >= c.panBas && c.haut - c.panBas < 20 && Math.abs(c.gauche - c.panG) <= 1 && Math.abs(c.larg - c.panL) <= 1, `C. la carte des temps est SOUS le métronome, à sa largeur (carte à ${c && Math.round(c.haut)} px, bas du métronome à ${c && Math.round(c.panBas)} px)`);
        check(c.left === '13:00' && /Exercice 2 \/ 3 · 13 %/.test(c.sub), `C. exercice de 3 min, 13 min restantes sur 15 : « reste ${c.left} », « ${c.sub} »`);
        check(!c.exleft && c.cells === 3, `C. plus de chronomètre « Reste dans l'exercice » : ${c.cells} temps seulement (session, reste prévu, exercice)`);
        check(/Durée prévue 15:00 · fin vers \d\d:\d\d/.test(c.foot), `C. durée prévue et heure de fin : « ${c.foot} »`);
        await page.waitForTimeout(2300);
        const c2 = await carte(page);
        check(sec(c2.ex) - sec(c.ex) >= 2 && sec(c.left) - sec(c2.left) >= 2 && sec(c2.total) - sec(c.total) >= 2, `C. les temps avancent seuls (exercice ${c.ex} → ${c2.ex}, reste prévu ${c.left} → ${c2.left}, session ${c.total} → ${c2.total})`);
        await page.locator('.gs-run-adjust-row button', { hasText: '+1 min' }).click();
        await page.waitForTimeout(400);
        const c3 = await carte(page);
        check(sec(c3.left) - sec(c2.left) >= 55 && /Durée prévue 16:00/.test(c3.foot), `C. « +1 min » : reste prévu ${c2.left} → ${c3.left}, durée prévue 16:00`);
        await page.locator('.gs-run-pause-btn').click();
        await page.waitForTimeout(500);
        const c4 = await carte(page);
        await page.waitForTimeout(1500);
        const c5 = await carte(page);
        check(/en pause/.test(c4.foot) && c4.ex === c5.ex && c4.total === c5.total, `C. en pause : les temps s'arrêtent et la carte le dit (« ${c4.foot} »)`);
        await page.locator('.gs-run-pause-btn').click();
        // fermer le métronome : la carte disparaît avec lui ; le rouvrir la ramène en dessous
        await page.locator('.metro-dock .panel-dock-close').click();
        await page.waitForTimeout(500);
        check(!(await page.locator('.gs-dock-clock').isVisible()), 'C. métronome fermé : la carte n\'occupe plus la colonne de droite');
        await page.locator('.gs-run-metro-btn').first().click();
        await page.waitForTimeout(800);
        c = await carte(page);
        check(!!c && c.visible && c.haut >= c.panBas, 'C. métronome rouvert : la carte revient en dessous');
        await page.screenshot({ path: path.join(SHOTS, 'sui-3-carte.png') });
        // fin de session : la carte disparaît
        await page.locator('.gs-run-stop-btn').click();
        await page.locator('.app-dialog button', { hasText: /^Arrêter la session$/ }).click();
        await page.waitForTimeout(700);
        check(await page.locator('.gs-dock-clock').count() === 0 || !(await page.locator('.gs-dock-clock').isVisible()), 'C. la session arrêtée, la carte disparaît');
        check(erreurs.length === 0, 'C. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }
    {   // métronome agrandi (volet de 650 × 950 px) : le métronome et la carte tiennent ensemble dans la hauteur de l'écran
        const { ctx, page } = await ouvrir(browser, { viewport: { width: 1600, height: 1100 }, taille: { w: 650, h: 950 } });
        await lancerSession(page);
        await page.waitForTimeout(500);
        const m = await page.evaluate(() => { const d = document.querySelector('.metro-dock').getBoundingClientRect(), p = document.querySelector('.metro-dock .backups-panel').getBoundingClientRect(), c = document.querySelector('.gs-dock-clock').getBoundingClientRect(); return { dockBas: Math.round(d.bottom), panH: Math.round(p.height), carteH: Math.round(c.height), carteBas: Math.round(c.bottom), ecran: innerHeight }; });
        check(m.carteBas <= m.ecran - 8 && m.dockBas <= m.ecran - 8 && m.panH < 950, `C. volet agrandi : métronome (${m.panH} px au lieu de 950) et carte (${m.carteH} px) tiennent dans l'écran de ${m.ecran} px (bas à ${m.carteBas} px)`);
        const poignee = await page.evaluate(() => { const g = document.querySelector('.metro-dock-grip-h').getBoundingClientRect(), p = document.querySelector('.metro-dock .backups-panel').getBoundingClientRect(); return Math.round(g.top - p.bottom); });
        check(Math.abs(poignee) <= 16, `C. la poignée de hauteur reste au bas du métronome, pas au bas de la carte (écart ${poignee} px)`);
        await page.screenshot({ path: path.join(SHOTS, 'sui-4-grand.png') });
        await ctx.close();
    }
    {   // écran étroit : métronome en bandeau, pas de carte
        const { ctx, page } = await ouvrir(browser, { viewport: { width: 1000, height: 800 } });
        await lancerSession(page);
        check(await page.locator('.gs-dock-clock').count() === 0, 'C. sous 1100 px (métronome en bandeau en bas) : pas de carte');
        await ctx.close();
    }

    // ============ F. Liste des exercices de la session (tous visibles, gérés à la souris) ============
    const lignes = page => page.evaluate(() => Array.from(document.querySelectorAll('.gs-run-upnext .gs-run-up-row')).map(r => ({ cls: r.className.replace('gs-run-up-row ', '').replace(' dragging', '').replace(' ctx-touch', ''), num: r.querySelector('.gs-run-up-num').textContent, txt: r.querySelector('.gs-run-up-title').textContent, min: r.querySelector('.gs-run-up-min').textContent, id: r.dataset.reorderId, coupe: (() => { const t = r.querySelector('.gs-run-up-title'); return t.scrollWidth > t.clientWidth + 1; })() })));
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { viewport: { width: 1440, height: 900 }, etapes: 9 });
        await lancerSession(page);
        let l = await lignes(page);
        check(l.length === 9 && l[0].cls === 'gs-run-up-cur' && l.slice(1).every(x => x.cls === 'gs-run-up-next'), `F. au 1er exercice de 9 : les 9 sont listés, le premier en évidence (${l.length})`);
        check(l[0].txt === 'Gamme avec accents' && l.slice(1, 6).map(x => x.txt).join('|') === 'Arpèges|Blue Bossa|Tremolo|Legato|Slap' && l[8].txt === 'Improvisation' && l[0].min === '2 min', 'F. les titres sont dans l\'ordre de la session, avec leur durée');
        const g = await page.evaluate(() => { const u = document.querySelector('.gs-run-upnext').getBoundingClientRect(), h = document.querySelector('.gs-run-head').getBoundingClientRect(), bar = document.querySelector('.gs-run-bar').getBoundingClientRect(); return { haut: u.height, gauche: u.left - h.left, larg: u.width, tete: h.width, souslabarre: u.top - bar.bottom }; });
        check(Math.abs(g.gauche) <= 1 && g.larg <= g.tete + 1 && g.souslabarre >= 0 && g.souslabarre < 16, `F. la liste est sous la barre, dans la colonne (hauteur ${Math.round(g.haut)} px)`);
        check(await page.locator('.gs-plan').count() === 0 && await page.getByText('Plan de la session').count() === 0, 'F. plus de barre « Plan de la session » tout en bas');
        // clic = aller à l'exercice
        await page.locator('.gs-run-up-row').nth(3).click(); await page.waitForTimeout(400);
        l = await lignes(page);
        check(l[3].cls === 'gs-run-up-cur' && l[2].cls === 'gs-run-up-done' && /Tremolo/.test(await page.locator('.gs-run-title').textContent()), 'F. un clic sur une ligne passe à cet exercice (4e)');
        // glisser = déplacer ; l'exercice en cours reste le même
        const ids0 = (await lignes(page)).map(x => x.id);
        const r0 = await page.locator('.gs-run-up-row').nth(6).boundingBox(), r1 = await page.locator('.gs-run-up-row').nth(1).boundingBox();
        await page.mouse.move(r0.x + 60, r0.y + r0.height / 2); await page.mouse.down();
        await page.mouse.move(r0.x + 60, r0.y + r0.height / 2 - 20, { steps: 4 });
        await page.mouse.move(r1.x + 60, r1.y + 2, { steps: 12 });
        await page.mouse.up(); await page.waitForTimeout(500);
        l = await lignes(page);
        check(l.map(x => x.id).join() === [ids0[0], ids0[6], ids0[1], ids0[2], ids0[3], ids0[4], ids0[5], ids0[7], ids0[8]].join(), `F. glisser la 7e ligne en 2e position la déplace (${l.map(x => x.txt.slice(0, 5)).join(', ')})`);
        check(l[4].cls === 'gs-run-up-cur' && l[4].txt === 'Tremolo' && /Tremolo/.test(await page.locator('.gs-run-title').textContent()), 'F. l\'exercice en cours reste « Tremolo » (il est passé en 5e position)');
        const ordre = await page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.v1')).settings.guidedSessions[0].steps.map(s => s.id).join());
        check(ordre === l.map(x => x.id).join(), 'F. le nouvel ordre est enregistré dans la session');
        // clic droit : menu
        await page.locator('.gs-run-up-row').nth(7).click({ button: 'right' }); await page.waitForTimeout(250);
        const items = await page.locator('.ctx-menu .ctx-item').allTextContents();
        check(items.length === 4 && /Retirer de la session/.test(items[3]) && /durée/i.test(items[1]), `F. clic droit sur une ligne : menu (${items.join(' | ')})`);
        await page.locator('.ctx-menu .ctx-item', { hasText: 'Retirer de la session' }).click(); await page.waitForTimeout(400);
        l = await lignes(page);
        check(l.length === 8 && !l.some(x => x.txt === 'Accords') && l[4].cls === 'gs-run-up-cur', `F. « Retirer de la session » enlève la ligne (${l.length} restantes), l'exercice en cours ne change pas`);
        await page.getByRole('button', { name: 'Annuler' }).last().click(); await page.waitForTimeout(400);
        l = await lignes(page);
        check(l.length === 9 && l[7].txt === 'Accords', 'F. « Annuler » dans le message remet l\'exercice à sa place');
        await page.locator('.gs-run-up-row').nth(4).click({ button: 'right' }); await page.waitForTimeout(250);
        check(await page.locator('.ctx-menu .ctx-item', { hasText: 'Retirer de la session' }).isDisabled(), 'F. l\'exercice en cours ne peut pas être retiré (bouton grisé)');
        await page.keyboard.press('Escape');
        // durée
        await page.locator('.gs-run-up-row').nth(0).click({ button: 'right' }); await page.waitForTimeout(250);
        await page.locator('.ctx-menu .ctx-item', { hasText: 'Changer la durée' }).click(); await page.waitForTimeout(300);
        await page.locator('.app-dialog-input').fill('7');
        await page.getByRole('button', { name: 'Valider' }).click(); await page.waitForTimeout(400);
        l = await lignes(page);
        check(l[0].min === '7 min', `F. « Changer la durée » : le premier exercice passe à ${l[0].min}`);
        await page.screenshot({ path: path.join(SHOTS, 'sui-7-liste.png') });
        check(erreurs.length === 0, 'F. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }
    {   // beaucoup d'exercices : la liste défile et garde l'exercice en cours visible ; grand écran : liste dans la marge de gauche
        const { ctx, page } = await ouvrir(browser, { viewport: { width: 1920, height: 1000 }, etapes: 9 });
        await lancerSession(page);
        const g = await page.evaluate(() => { const u = document.querySelector('.gs-run-steps').getBoundingClientRect(), h = document.querySelector('.gs-run-head').getBoundingClientRect(), s = document.querySelector('.sidebar, #sidebar, aside'), sb = s ? s.getBoundingClientRect().right : 0; return { droite: u.right, gauche: u.left, tete: h.left, sb: sb }; });
        check(g.droite <= g.tete && g.gauche > g.sb, `F. à 1920 px la liste est à gauche de la colonne de guidage, sans toucher le volet des dossiers (${Math.round(g.gauche)}→${Math.round(g.droite)} px, colonne dès ${Math.round(g.tete)}, volet jusqu'à ${Math.round(g.sb)})`);
        await ctx.close();
    }
    {   // téléphone : rien ne déborde
        const { ctx, page } = await ouvrir(browser, { viewport: { width: 390, height: 844 } });
        await lancerSession(page, { metronome: false });
        const l = await lignes(page);
        const o = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth - innerWidth, u: Math.round(document.querySelector('.gs-run-upnext').getBoundingClientRect().right) }));
        check(l.length === 3 && o.doc <= 0 && o.u <= 390, `F. session de 3 exercices sur téléphone : les trois sont listés, rien ne déborde (${l.map(x => x.txt).join(' | ')})`);
        await page.screenshot({ path: path.join(SHOTS, 'sui-8-aVenir-tel.png') });
        await ctx.close();
    }

    // ============ G. Bouton Session sans session en cours : un clic dans les dossiers le désactive ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { viewport: { width: 1440, height: 900 } });
        await page.click('#guided-session-btn'); await page.waitForSelector('.gs-session-row');
        check(await page.locator('#guided-session-btn.active').count() === 1 && await page.locator('.gs-main').count() === 1, 'G. la vue Session est ouverte (liste des sessions, aucune en cours)');
        await page.locator('.tree-row').filter({ hasText: 'Technique' }).first().click(); await page.waitForTimeout(500);
        check(await page.locator('#guided-session-btn.active').count() === 0 && await page.locator('.gs-main').count() === 0, 'G. un clic sur un dossier du volet de gauche désactive le bouton Session et affiche les exercices');
        check(await page.locator('.exercise').count() >= 1, 'G. les exercices du dossier sont à l\'écran');
        await page.click('#guided-session-btn'); await page.waitForSelector('.gs-session-row');
        await page.locator('.gs-session-row .gs-session-name, .gs-session-row').first().click(); await page.waitForTimeout(400);
        await page.locator('.tree-row').filter({ hasText: 'Technique' }).first().click(); await page.waitForTimeout(500);
        check(await page.locator('#guided-session-btn.active').count() === 0, 'G. idem après être entré dans une session de la liste');
        check(erreurs.length === 0, 'G. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }
    {   // pendant une session en cours : comportement inchangé (la bande garde le chrono)
        const { ctx, page } = await ouvrir(browser, { viewport: { width: 1440, height: 900 } });
        await lancerSession(page);
        await page.locator('.tree-row').filter({ hasText: 'Technique' }).first().click(); await page.waitForTimeout(500);
        check(await page.locator('#guided-session-btn.active').count() === 0 && await page.locator('#gs-strip').count() === 1 && await page.locator('.exercise').count() >= 1, 'G. session en cours : un clic dans les dossiers montre les exercices, la bande de session reste en haut');
        await ctx.close();
    }

    // ============ H. Écran tactile : pas de surlignage de texte sur un appui long ni un glisser ============
    for (const [nom, tactile] of [['téléphone', true], ['ordinateur', false]]) {
        const ctx = await browser.newContext(tactile ? { viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' } : { viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
        const page = await ctx.newPage();
        await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
        await page.addInitScript(() => { try { localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1'); if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1');
            localStorage.setItem('trainhub.v1', JSON.stringify({ activeInstrumentId: 'i1', updatedAt: 1, instruments: [{ id: 'i1', name: 'Guitare', categories: [{ id: 'c1', name: 'Technique', color: '#e91e63', folders: [{ id: 'f1', name: 'Dossier A', folders: [], exercises: [] }], exercises: [{ id: 'e1', title: 'Gamme majeure', notes: 'Une note', collapsed: false }, { id: 'e2', title: 'Arpèges', notes: '', collapsed: true }] }] }], settings: {} })); } catch (e) { } });
        await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(800);
        const sel = await page.evaluate(() => { const us = e => { const c = getComputedStyle(e); return c.userSelect || c.webkitUserSelect; };
            const ex = document.querySelector('.exercise .exercise-title, .exercise-title, .exercise'); const ta = document.querySelector('.exercise textarea');
            return { ex: ex ? us(ex) : null, ta: ta ? us(ta) : null, wrap: us(document.querySelector('.exercises-wrap, #folder-container') || document.body) }; });
        if (tactile) {
            check(sel.ex === 'none', `H. ${nom} : le texte d'un exercice n'est pas sélectionnable (${sel.ex})`);
            check(sel.ta === null || sel.ta === 'text', `H. ${nom} : la zone de notes reste sélectionnable (${sel.ta})`);
            const sans = await page.evaluate(() => { const r = document.querySelector('.tree-row, .chapter-chip'); return getComputedStyle(r).webkitUserSelect || getComputedStyle(r).userSelect; });
            check(sans === 'none', `H. ${nom} : les lignes des dossiers non plus (${sans})`);
        } else {
            check(sel.ex !== 'none', `H. ${nom} : sur ordinateur le texte reste sélectionnable à la souris (${sel.ex})`);
        }
        await ctx.close();
    }

    // ============ D. Barre du haut : le logo seul ============
    for (const [nom, vp, glass] of [['bureau', { width: 1440, height: 900 }, false], ['verre', { width: 1440, height: 900 }, true], ['tel', { width: 390, height: 844 }, false]]) {
        const { ctx, page, erreurs } = await ouvrir(browser, { viewport: vp, glass });
        const l = await page.evaluate(() => { const lg = document.querySelector('.logo'), t = document.querySelector('.logo-text'), m = document.querySelector('.logo-mark').getBoundingClientRect(), s = document.querySelector('#instrument-select, .instrument-select, select'); return { texte: getComputedStyle(t).display, marque: Math.round(m.width), titre: lg.title, aria: lg.getAttribute('aria-label'), largLogo: Math.round(lg.getBoundingClientRect().width), doc: document.documentElement.scrollWidth - innerWidth }; });
        check(l.texte === 'none' && l.marque > 20 && l.titre === 'TrainHub' && l.aria === 'TrainHub' && l.doc <= 0, `D. ${nom} : plus de titre « TrainHub » dans la barre, le logo reste (${l.marque} px), nom gardé en info-bulle et pour les lecteurs d'écran (logo ${l.largLogo} px de large)`);
        if (nom === 'bureau') await page.screenshot({ path: path.join(SHOTS, 'sui-5-logo.png'), clip: { x: 0, y: 0, width: 1440, height: 70 } });
        check(erreurs.length === 0, `D. ${nom} : aucune erreur JavaScript ` + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ E. Téléphone : la session reste lisible ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { viewport: { width: 390, height: 844 } });
        await lancerSession(page, { metronome: false });
        const g = await page.evaluate(() => { const r = s => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width) }; }; return { head: r('.gs-run-head'), controls: r('.gs-run-controls'), mini: r('.gs-run-mini-btn'), doc: document.documentElement.scrollWidth - innerWidth }; });
        check(g.doc <= 0 && g.head.l >= 0 && g.head.r <= 390 && g.mini.r <= g.head.r + 1 && g.controls.w <= 441, `E. téléphone : barre, boutons et bouton flottant dans l'écran (${JSON.stringify(g)})`);
        await page.screenshot({ path: path.join(SHOTS, 'sui-6-tel.png') });
        check(erreurs.length === 0, 'E. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
