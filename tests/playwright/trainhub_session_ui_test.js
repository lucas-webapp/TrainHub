// Session guidée en cours : barre d'avancement verte (par la durée), largeur maximale des boutons, bouton « fenêtre flottante » dans la colonne,
// carte des temps sous le métronome épinglé, logo sans titre dans la barre du haut.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_session_ui_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : session en cours — barre d\'avancement, boutons, temps sous le métronome, logo');
const estBruitReseau = harnais.estBruitReseau;
plan(55);
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
const barre = page => page.evaluate(() => { const b = document.querySelector('.gs-run-bar'), f = b.querySelector('.gs-run-bar-fill'), bb = b.getBoundingClientRect(); return { now: +b.getAttribute('aria-valuenow'), w: f.getBoundingClientRect().width / bb.width * 100, ticks: Array.from(b.querySelectorAll('.gs-run-bar-tick')).map(t => +(((t.getBoundingClientRect().left + 1) - bb.left) / bb.width * 100).toFixed(1)), cur: (() => { const c = b.querySelector('.gs-run-bar-cur').getBoundingClientRect(); return [+((c.left - bb.left) / bb.width * 100).toFixed(1), +(c.width / bb.width * 100).toFixed(1)]; })(), titre: b.title, couleur: getComputedStyle(f).backgroundColor }; });
const carte = page => page.evaluate(() => { const c = document.querySelector('.gs-dock-clock'); if (!c) return null; const v = k => c.querySelector('[data-k="' + k + '"]').textContent, b = c.getBoundingClientRect(), p = document.querySelector('.metro-dock .backups-panel').getBoundingClientRect(); return { total: v('total'), left: v('left'), ex: v('ex'), exleft: v('exleft'), sub: v('sub'), foot: v('foot'), haut: b.top, bas: b.bottom, gauche: b.left, larg: b.width, panBas: p.bottom, panG: p.left, panL: p.width, visible: b.width > 0 }; });
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
        const clr = /rgb\((\d+), (\d+), (\d+)\)/.exec(b.couleur);
        check(clr && +clr[2] > +clr[1] && +clr[2] > +clr[3], `A. la barre est verte (${b.couleur})`);
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
        check(c.exleft === '3:00' && c.left === '13:00' && /Exercice 2 \/ 3 · 13 %/.test(c.sub), `C. exercice de 3 min, 13 min restantes sur 15 : « reste dans l'exercice ${c.exleft} », « reste ${c.left} », « ${c.sub} »`);
        check(/Durée prévue 15:00 · fin vers \d\d:\d\d/.test(c.foot), `C. durée prévue et heure de fin : « ${c.foot} »`);
        await page.waitForTimeout(2300);
        const c2 = await carte(page);
        check(sec(c2.ex) - sec(c.ex) >= 2 && sec(c.exleft) - sec(c2.exleft) >= 2 && sec(c2.total) - sec(c.total) >= 2, `C. les temps avancent seuls (exercice ${c.ex} → ${c2.ex}, reste ${c.exleft} → ${c2.exleft}, session ${c.total} → ${c2.total})`);
        await page.locator('.gs-run-adjust-row button', { hasText: '+1 min' }).click();
        await page.waitForTimeout(400);
        const c3 = await carte(page);
        check(sec(c3.exleft) - sec(c2.exleft) >= 55 && sec(c3.left) - sec(c2.left) >= 55 && /Durée prévue 16:00/.test(c3.foot), `C. « +1 min » : reste dans l'exercice ${c2.exleft} → ${c3.exleft}, durée prévue 16:00`);
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

    // ============ F. Exercices à venir, en petit sous la barre d'avancement ============
    const lignes = page => page.evaluate(() => Array.from(document.querySelectorAll('.gs-run-upnext .gs-run-up-row')).map(r => ({ cls: r.className.replace('gs-run-up-row ', ''), num: r.querySelector('.gs-run-up-num').textContent, txt: r.querySelector('.gs-run-up-title').textContent, coupe: (() => { const t = r.querySelector('.gs-run-up-title'); return t.scrollWidth > t.clientWidth + 1; })() })));
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { viewport: { width: 1440, height: 900 }, etapes: 9 });
        await lancerSession(page);
        let l = await lignes(page);
        check(l.length === 7 && l[0].cls === 'gs-run-up-cur' && l.slice(1, 6).every(x => x.cls === 'gs-run-up-next') && l[6].cls === 'gs-run-up-more', `F. au 1er exercice de 9 : l'exercice en cours puis les 5 suivants, et « ${l[6] && l[6].txt} » (${l.map(x => x.cls.replace('gs-run-up-', '')).join(', ')})`);
        check(l[0].txt === 'Gamme avec accents' && l.slice(1, 6).map(x => x.txt).join('|') === 'Arpèges|Blue Bossa|Tremolo|Legato|Slap' && l[6].txt === '3 à venir ensuite', 'F. les titres à venir sont dans l\'ordre de la session, titres seuls');
        const g = await page.evaluate(() => { const u = document.querySelector('.gs-run-upnext').getBoundingClientRect(), h = document.querySelector('.gs-run-head').getBoundingClientRect(), p = document.querySelector('.gs-run-progress').getBoundingClientRect(), bar = document.querySelector('.gs-run-bar').getBoundingClientRect(); return { haut: u.height, gauche: u.left - h.left, larg: u.width, tete: h.width, souslabarre: u.top - bar.bottom, labelHaut: p.top, uTop: u.top }; });
        check(Math.abs(g.gauche) <= 1 && g.larg <= g.tete + 1 && g.souslabarre >= 0 && g.souslabarre < 16, `F. la liste est sous la barre, alignée à gauche dans la colonne (hauteur ${Math.round(g.haut)} px)`);
        await suivant(page); await suivant(page); await suivant(page); await suivant(page); await suivant(page); // 6e exercice
        l = await lignes(page);
        check(l[0].cls === 'gs-run-up-more' && /^4 faits avant$/.test(l[0].txt) && l[1].cls === 'gs-run-up-done' && l[1].txt === 'Slap'.replace('Slap', 'Legato') && l[2].cls === 'gs-run-up-cur' && l[2].txt === 'Slap', `F. au 6e exercice : « ${l[0].txt} », l'exercice précédent grisé (${l[1].txt}), puis l'exercice en cours (${l[2].txt})`);
        check(l.slice(3).map(x => x.num).join(',') === '7,8,9' && l.length === 6, `F. et les trois derniers à venir, numérotés (${l.slice(3).map(x => x.num + ' ' + x.txt.slice(0, 12)).join(' | ')}), sans ligne « ensuite »`);
        check(l[3].coupe, 'F. un titre trop long est coupé par « … » au lieu de déborder');
        await page.screenshot({ path: path.join(SHOTS, 'sui-7b-milieu.png'), clip: { x: 280, y: 60, width: 720, height: 420 } });
        await suivant(page); await suivant(page); await suivant(page); // dernier
        l = await lignes(page);
        check(l[l.length - 1].cls === 'gs-run-up-cur' && l[l.length - 1].num === '▶' && l[0].txt === '7 faits avant' && l.length === 3, `F. au dernier exercice : rien à venir, « ${l[0].txt} » (${l.map(x => x.cls.replace('gs-run-up-', '')).join(', ')})`);
        const coul = await page.locator('.gs-run-up-cur').evaluate(e => getComputedStyle(e).color);
        check(/rgb\(0, 230, 118\)/.test(coul) || /rgb\(\d+, 2\d\d, \d+\)/.test(coul), `F. l'exercice en cours est en vert (${coul})`);
        const dessous = await page.evaluate(() => { const u = document.querySelector('.gs-run-upnext').getBoundingClientRect(), t = document.querySelector('.gs-run-title').getBoundingClientRect(); return t.top - u.bottom; });
        check(dessous > 0, `F. la liste ne recouvre pas le titre de l'exercice (${Math.round(dessous)} px d'écart)`);
        await page.screenshot({ path: path.join(SHOTS, 'sui-7-aVenir.png') });
        check(erreurs.length === 0, 'F. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }
    {   // session courte : tout est montré, sans ligne de résumé ; téléphone : rien ne déborde
        const { ctx, page } = await ouvrir(browser, { viewport: { width: 390, height: 844 } });
        await lancerSession(page, { metronome: false });
        const l = await lignes(page);
        const o = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth - innerWidth, u: Math.round(document.querySelector('.gs-run-upnext').getBoundingClientRect().right) }));
        check(l.length === 3 && !l.some(x => x.cls === 'gs-run-up-more') && o.doc <= 0 && o.u <= 390, `F. session de 3 exercices sur téléphone : les trois sont listés, sans ligne de résumé, rien ne déborde (${l.map(x => x.txt).join(' | ')})`);
        await page.screenshot({ path: path.join(SHOTS, 'sui-8-aVenir-tel.png') });
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
