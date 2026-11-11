// Préréglage de métronome appliqué PENDANT la lecture (changement d'exercice d'une session, « Suivre l'exercice ouvert » en session libre) :
// le métronome continue de jouer — pas d'arrêt, pas de contexte audio neuf, pas de redémarrage 32 ms plus tard.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_preset_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : préréglage appliqué pendant la lecture, sans redémarrage du son');
const estBruitReseau = harnais.estBruitReseau;
plan(22);
const URL = 'http://localhost:8765/index.html';

const journal = page => page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.audioLog.v1') || '[]'));
const attendre = async page => { await page.waitForTimeout(1000); return journal(page); };

(async () => {
    const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    // ============ A. Session guidée : « Suivant » pendant que le métronome joue ============
    {
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', colorScheme: 'dark' });
        const page = await ctx.newPage();
        const erreurs = [];
        page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
        page.on('console', m => { if (m.type() === 'error' && !estBruitReseau(m.text()) && !/ERR_FAILED/.test(m.text())) erreurs.push('console: ' + m.text()); });
        await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
        await page.addInitScript(() => {
            try {
                localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1'); localStorage.setItem('trainhub.metroDock.v1', '1');
                window.__ctxN = 0; window.__osc = 0;
                const AC = window.AudioContext; window.AudioContext = function () { window.__ctxN++; return new AC(); }; window.AudioContext.prototype = AC.prototype;
                const st0 = OscillatorNode.prototype.start; OscillatorNode.prototype.start = function () { window.__osc++; return st0.apply(this, arguments); };
                if (sessionStorage.getItem('__seed')) return; sessionStorage.setItem('__seed', '1');
                const P = b => ({ bpm: b, beatsPerMeasure: 1, rhythmLabel: 'None', beatPattern: [1], advanced: false });
                const ex = (id, title) => ({ id, title, notes: '', collapsed: true });
                const ste = (id, e, m) => ({ id, exerciseId: e, minutes: 5, metronome: P(m) });
                localStorage.setItem('trainhub.v1', JSON.stringify({ activeInstrumentId: 'i1', updatedAt: 1, instruments: [{ id: 'i1', name: 'Guitare', categories: [{ id: 'c1', name: 'Technique', color: '#e91e63', folders: [], exercises: [ex('e1', 'Gamme lente'), ex('e2', 'Gamme rapide')] }] }],
                    settings: { guidedSessions: [{ id: 'g1', name: 'Session test', instrumentId: 'i1', tabIds: [], createdAt: 1, steps: [ste('p1', 'e1', 100), ste('p2', 'e2', 150), ste('p3', 'e1', 90)] }] } }));
            } catch (e) { }
        });
        await page.goto(URL); await page.waitForTimeout(800);
        await page.click('#guided-session-btn'); await page.waitForSelector('.gs-session-row');
        await page.locator('.gs-session-row .gs-session-play-btn').first().click(); await page.waitForSelector('.gs-run-timer-row'); await page.waitForTimeout(500);
        if (!(await page.locator('.metro-dock:not([hidden])').count())) { await page.locator('.gs-run-metro-btn').first().click(); await page.waitForTimeout(800); }
        const bpm = () => page.locator('.metro-dock .metro-dial-value').innerText();
        const bouton = () => page.locator('.metro-dock .metro-play-btn-big').innerText();
        check(await bpm() === '100', `A. 1er exercice : le préréglage met le métronome à ${await bpm()} BPM`);
        await page.click('.metro-dock .metro-play-btn-big');
        await page.waitForTimeout(1500);
        const avant = await page.evaluate(() => ({ ctx: window.__ctxN, osc: window.__osc }));
        const chrono0 = await page.locator('.metro-dock .metro-chrono-value').innerText();
        await page.locator('.gs-run-nav-row button.btn-accent').click(); // Suivant : préréglage du 2e exercice (150 BPM) pendant la lecture
        await page.waitForTimeout(2500);
        const apres = await page.evaluate(() => ({ ctx: window.__ctxN, osc: window.__osc }));
        check(await bpm() === '150', `A. « Suivant » : le métronome passe à ${await bpm()} BPM`);
        check((await bouton()).includes('Arrêter'), `A. et il joue toujours : le bouton dit « ${(await bouton()).trim()} »`);
        check(apres.ctx === avant.ctx, `A. aucun contexte audio neuf créé (${avant.ctx} → ${apres.ctx})`);
        check(apres.osc - avant.osc >= 4, `A. les clics continuent sans interruption (${apres.osc - avant.osc} clics en 2,5 s à 150 BPM)`);
        const chrono1 = await page.locator('.metro-dock .metro-chrono-value').innerText();
        const sec = t => { const m = /^(\d\d):(\d\d)$/.exec(t); return m ? (+m[1]) * 60 + (+m[2]) : -1; };
        check(sec(chrono1) >= 3 && sec(chrono1) <= 5, `A. le chronomètre ne repart pas de zéro : « ${chrono1} » 2,5 s après « ${chrono0} » (≈ 4 s de lecture en tout)`);
        let j = await attendre(page);
        const apresLancement = j.slice(j.findIndex(l => /métronome lancé/.test(l)));
        check(!apresLancement.some(l => /métronome arrêté/.test(l)) && apresLancement.filter(l => /métronome lancé/.test(l)).length === 1 && !apresLancement.some(l => /contexte neuf adopté/.test(l.replace(/.*métronome lancé/, '')) && false), 'A. journal : un seul « métronome lancé », aucun « métronome arrêté » au changement d\'exercice');
        check(j.filter(l => /contexte neuf adopté/.test(l)).length === 1, 'A. journal : un seul « contexte neuf adopté » (celui du lancement) ' + JSON.stringify(j.filter(l => /contexte|métronome (lancé|arrêté)/.test(l)).slice(0, 6)));
        await page.locator('.gs-run-nav-row button', { hasText: 'Précédent' }).click(); // retour au 1er : 100 BPM, toujours en lecture
        await page.waitForTimeout(1500);
        const retour = await page.evaluate(() => ({ ctx: window.__ctxN, osc: window.__osc }));
        check(await bpm() === '100' && (await bouton()).includes('Arrêter') && retour.ctx === avant.ctx && retour.osc > apres.osc, `A. « Précédent » : ${await bpm()} BPM, toujours en lecture, même contexte audio (${retour.ctx})`);
        // le bouton Arrêter fonctionne toujours (reconstruit)
        await page.click('.metro-dock .metro-play-btn-big');
        await page.waitForTimeout(400);
        check((await bouton()).includes('Jouer'), 'A. « Arrêter » sur le panneau reconstruit arrête bien le métronome');
        const oscStop = await page.evaluate(() => window.__osc);
        await page.waitForTimeout(1200);
        check(await page.evaluate(() => window.__osc) === oscStop, 'A. et plus aucun clic après l\'arrêt');
        j = await attendre(page);
        check(j.some(l => /métronome arrêté/.test(l)), 'A. journal : « métronome arrêté » après l\'arrêt voulu');
        // un nouveau lancement voulu repart bien de zéro (le report ne sert qu'à la reconstruction en pleine lecture)
        await page.click('.metro-dock .metro-play-btn-big'); await page.waitForTimeout(700);
        const chronoRelance = await page.locator('.metro-dock .metro-chrono-value').innerText();
        check(sec(chronoRelance) === 0, `A. relance voulue : le chronomètre repart de zéro (« ${chronoRelance} »)`);
        await page.click('.metro-dock .metro-play-btn-big'); await page.waitForTimeout(400);
        // à l'arrêt : un préréglage s'applique sans rien lancer
        const ctxArret = await page.evaluate(() => ({ ctx: window.__ctxN, osc: window.__osc }));
        await page.locator('.gs-run-nav-row button.btn-accent').click();
        await page.waitForTimeout(800);
        const finale = await page.evaluate(() => ({ ctx: window.__ctxN, osc: window.__osc }));
        check(await bpm() === '150' && (await bouton()).includes('Jouer') && finale.ctx === ctxArret.ctx && finale.osc === ctxArret.osc, `A. à l'arrêt : le préréglage s'applique (${await bpm()} BPM), le métronome reste arrêté, rien n'est créé`);
        check(erreurs.length === 0, 'A. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ B. Session libre : « Suivre l'exercice ouvert » pendant la lecture ============
    // (v273 : fenêtre de 600 px de haut — les notes vides sont masquées, la page est plus courte ; à 900 px le 1er exercice resterait le plus visible tout en bas)
    {
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 600 }, serviceWorkers: 'block', colorScheme: 'dark' });
        const page = await ctx.newPage();
        const erreurs = [];
        page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
        page.on('console', m => { if (m.type() === 'error' && !estBruitReseau(m.text()) && !/ERR_FAILED/.test(m.text())) erreurs.push('console: ' + m.text()); });
        await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
        await page.addInitScript(() => {
            try {
                localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1'); localStorage.setItem('trainhub.metroDock.v1', '1');
                window.__ctxN = 0; window.__osc = 0;
                const AC = window.AudioContext; window.AudioContext = function () { window.__ctxN++; return new AC(); }; window.AudioContext.prototype = AC.prototype;
                const st0 = OscillatorNode.prototype.start; OscillatorNode.prototype.start = function () { window.__osc++; return st0.apply(this, arguments); };
                if (sessionStorage.getItem('__seed')) return; sessionStorage.setItem('__seed', '1');
                const P = b => ({ bpm: b, beatsPerMeasure: 1, rhythmLabel: 'None', beatPattern: [1], advanced: false });
                const long = Array.from({ length: 90 }, (_, i) => 'ligne ' + i).join('\n');
                const exs = [{ id: 'e1', title: 'Gamme lente', notes: '', fixedNotes: long, collapsed: false, metronome: P(100) }, { id: 'e2', title: 'Gamme rapide', notes: '', fixedNotes: 'courte', collapsed: false, metronome: P(160) }];
                localStorage.setItem('trainhub.v1', JSON.stringify({ activeInstrumentId: 'i1', updatedAt: 1, instruments: [{ id: 'i1', name: 'Guitare', categories: [{ id: 'c1', name: 'Technique', color: '#e91e63', folders: [], exercises: exs }] }], settings: { guidedSessions: [] } }));
            } catch (e) { }
        });
        await page.goto(URL); await page.waitForTimeout(1000);
        await page.click('#free-btn'); await page.waitForTimeout(600);
        await page.click('#metronome-btn'); await page.waitForSelector('.metro-dock .metro-play-btn-big');
        await page.waitForTimeout(1500); // l'exercice affiché (Gamme lente) est suivi : 100 BPM
        const bpm = () => page.locator('.metro-dock .metro-dial-value').innerText();
        check(await bpm() === '100', `B. session libre : « Gamme lente » affichée, métronome à ${await bpm()} BPM`);
        await page.click('.metro-dock .metro-play-btn-big');
        await page.waitForTimeout(1500);
        const avant = await page.evaluate(() => ({ ctx: window.__ctxN, osc: window.__osc }));
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); // « Gamme rapide » devient l'exercice le plus visible
        await page.waitForTimeout(3500);
        const apres = await page.evaluate(() => ({ ctx: window.__ctxN, osc: window.__osc }));
        check(await bpm() === '160', `B. l'exercice affiché change : le métronome suit (${await bpm()} BPM)`);
        check((await page.locator('.metro-dock .metro-play-btn-big').innerText()).includes('Arrêter'), 'B. et il joue toujours');
        check(apres.ctx === avant.ctx && apres.osc - avant.osc >= 6, `B. sans contexte audio neuf (${avant.ctx} → ${apres.ctx}), clics ininterrompus (${apres.osc - avant.osc} en 3,5 s)`);
        const j = await attendre(page);
        const apresLancement = j.slice(j.findIndex(l => /métronome lancé/.test(l)));
        check(!apresLancement.some(l => /métronome arrêté/.test(l)) && apresLancement.filter(l => /métronome lancé/.test(l)).length === 1, 'B. journal : aucun arrêt ni relance au changement d\'exercice');
        check(await page.locator('.toast', { hasText: 'Métronome réglé sur' }).count() >= 1, 'B. le message « Métronome réglé sur… » s\'affiche toujours');
        check(erreurs.length === 0, 'B. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
