// Journal du son et son « bloqué » : regroupement des répétitions, détection de la bouée immobile, rappel avec bouton « Rétablir le son »,
// escalade vers le son de secours, signe de vie (page qui s'arrête sans prévenir), minuterie en retard.
// On ne peut pas reproduire ici le blocage de Safari après la veille : la bouée immobile est SIMULÉE (son temps de lecture est figé à la demande).
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_son_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : journal du son et son bloqué');
const estBruitReseau = harnais.estBruitReseau;
plan(67);

const URL = 'http://localhost:8765/index.html';
const sel = k => !process.env.ONLY || process.env.ONLY.split(',').includes(k); // ONLY=A,B : seulement ces scénarios
const journal = page => page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.audioLog.v1') || '[]'));
const attendreJournal = async (page) => { await page.waitForTimeout(1000); return journal(page); }; // l'écriture dans le stockage est différée de 0,8 s

async function ouvrir(browser, ctxExistant, opts = {}) {
    const ctx = ctxExistant || await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !estBruitReseau(m.text()) && !/ERR_FAILED/.test(m.text())) erreurs.push('console: ' + m.text()); });
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.addInitScript(({ avecBouee, secours }) => {
        try { localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1'); if (avecBouee) localStorage.setItem('trainhub.metroLife.v1', '1'); if (secours) localStorage.setItem('trainhub.metroFallback.v1', '1'); } catch (e) { } // la bouée est désactivée par défaut : les scénarios qui l'éprouvent l'activent
        // bouée immobile à la demande : tant que window.__gel est vrai, l'élément qui boucle (la bouée) répond toujours 0 comme temps de lecture
        const play0 = HTMLMediaElement.prototype.play; // la bouée = l'élément qui boucle : retenue au lancement
        HTMLMediaElement.prototype.play = function () { if (this.loop) window.__bouee = this; if (window.__refuser && !this.loop) return Promise.reject(new DOMException('refusé pour le test', 'NotAllowedError')); return play0.apply(this, arguments); };
        window.__retard = 0; const stt = window.setTimeout; window.setTimeout = function (f, ms) { const a = Array.prototype.slice.call(arguments); if (window.__retard && ms < 150) a[1] = (ms || 0) + window.__retard; return stt.apply(window, a); }; // minuteries ralenties à la demande
        window.__osc = 0; const st0 = OscillatorNode.prototype.start; OscillatorNode.prototype.start = function () { window.__osc++; return st0.apply(this, arguments); }; // clics joués par Web Audio
        const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
        Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { configurable: true, get() { return window.__gel && this.loop ? 0 : d.get.call(this); }, set(v) { d.set.call(this, v); } });
    }, { avecBouee: opts.bouee !== false, secours: !!opts.secours });
    await page.goto(URL);
    await page.waitForTimeout(500);
    return { ctx, page, erreurs };
}
async function lancer(page) {
    await page.click('#metronome-btn');
    await page.waitForSelector('.metro-play-btn-big');
    await page.click('.metro-play-btn-big');
    await page.waitForTimeout(800);
}
const toast = page => page.locator('.toast').first().innerText().catch(() => '');

(async () => {
    const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

    // ================= A. Tout va bien : aucune fausse alerte, signe de vie écrit puis effacé =================
    if (sel('A')) {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await lancer(page);
        await page.waitForTimeout(9000);
        let j = await attendreJournal(page);
        check(!j.some(l => /figée/.test(l)), `A. 10 s de lecture saine : aucune alerte « bouée figée » (${j.length} lignes)`);
        const vie = await page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.audioAlive.v1') || 'null'));
        check(vie && Date.now() - vie.t < 3500 && /^ctx\d+:running/.test(vie.ctx), `A. le signe de vie est écrit pendant la lecture (${JSON.stringify(vie)})`);
        check(!(await page.locator('.toast').count()), "A. et aucun rappel « son bloqué » ne s'affiche");
        await page.click('.metro-play-btn-big'); // arrêt
        await page.waitForTimeout(400);
        check(await page.evaluate(() => localStorage.getItem('trainhub.audioAlive.v1')) === null, "A. à l'arrêt du métronome, le signe de vie est effacé");
        check(erreurs.length === 0, 'A. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ================= B. Bouée immobile : journal regroupé, rappel, « Rétablir le son », escalade =================
    if (sel('B')) {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await lancer(page);
        const t0 = Date.now();
        await page.evaluate(() => { window.__gel = true; });
        await page.waitForSelector('.toast', { timeout: 9000 });
        const t = await toast(page);
        check(/semble bloqué/.test(t) && /Rétablir le son/.test(t), `B. la bouée immobile (3 s) déclenche un rappel avec un bouton (${((Date.now() - t0) / 1000).toFixed(1)} s) : « ${t.replace(/\n/g, ' | ')} »`);
        await page.waitForTimeout(10200); // reste immobile : la 1re détection relance la bouée, les suivantes (3,3 s d'écart) se regroupent en UNE ligne
        let j = await attendreJournal(page);
        const fig = j.filter(l => /bouée est figée/.test(l));
        check(fig.length === 2 && /×\d+ \(la dernière à /.test(fig[1]), `B. 4 détections en 13 s : la 1re (suivie de la relance), puis les autres regroupées en une seule ligne : ${fig.length} lignes, « …${fig[1] ? fig[1].slice(-60) : ''} »`);
        check(/\[pause=false prêt=\d+ réseau=\d+ saut=false/.test(fig[0] || ''), "B. la ligne donne l'état de l'élément audio (de quoi diagnostiquer)");
        check(/immobile à 0\.00 s depuis 3\.\d s/.test(fig[0] || ''), "B. et le temps depuis lequel elle est immobile");
        check(!(await page.locator('.toast', { hasText: /toujours bloqué/ }).count()), "B. pas de second rappel avant 2 minutes (pas de harcèlement)");
        check(j.some(l => /bouée lancée \(redémarrage\)/.test(l)), "B. la bouée immobile est relancée (pause, puis lecture 120 ms plus tard)");
        check(j.some(l => /clics de secours en attente : 0\]?/.test(l) || /clics de secours en attente : \d+/.test(l)), "B. la ligne de la bouée figée donne le nombre de clics de secours en attente");
        // l'utilisateur clique « Rétablir le son » : la cause disparaît (simulée) et l'élément est remplacé
        await page.evaluate(() => { window.__gel = false; });
        await page.locator('.toast-action', { hasText: /Rétablir/ }).click();
        await page.waitForTimeout(900);
        j = await journal(page);
        check(j.some(l => /« Rétablir le son » demandé/.test(l)), 'B. « Rétablir le son » est journalisé');
        check(j.some(l => /bouée lancée \(remplacée\)/.test(l)), "B. l'élément audio est remplacé par un neuf (et relancé dans ce clic)");
        check(j.some(l => /échange à chaud \(geste\)/.test(l)), "B. et le contexte audio est échangé dans ce même clic");
        const avant = j.filter(l => /bouée est figée/.test(l)).length;
        await page.waitForTimeout(6000);
        j = await journal(page);
        check(j.filter(l => /bouée est figée/.test(l)).length === avant && !(await page.locator('.toast', { hasText: /semble bloqué/ }).count()), "B. rétabli : plus d'alerte ni de rappel pendant 6 s");
        check(erreurs.length === 0, 'B. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ================= C. Reste bloqué : après 2 minutes, on propose le son de secours =================
    if (sel('C')) {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await lancer(page);
        await page.evaluate(() => { window.__gel = true; });
        await page.waitForSelector('.toast', { timeout: 9000 });
        const premier = await toast(page);
        const t0 = Date.now();
        check(/semble bloqué/.test(premier), 'C. premier rappel : « Rétablir le son »');
        await page.locator('.toast-action').click(); // le clic ne règle rien ici : la bouée reste immobile (gel maintenu)
        await page.waitForTimeout(500);
        // ... jusqu'au second rappel (≥ 120 s après le premier)
        await page.waitForSelector('.toast:has-text("toujours bloqué")', { timeout: 150000 });
        const second = await toast(page);
        check(Date.now() - t0 >= 110000, `C. le second rappel vient après ~2 minutes (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
        check(/son de secours/i.test(second), `C. il propose le son de secours : « ${second.replace(/\n/g, ' | ')} »`);
        await page.locator('.toast-action').click();
        await page.waitForTimeout(500);
        check(await page.evaluate(() => localStorage.getItem('trainhub.metroFallback.v1')) === '1', 'C. le bouton active le son de secours');
        await page.evaluate(() => { window.__gel = true; });
        await page.waitForTimeout(8000);
        check(!(await page.locator('.toast', { hasText: /semble bloqué|toujours bloqué/ }).count()), 'C. avec le son de secours actif, plus de rappel (il joue déjà par le lecteur audio)');
        check(erreurs.length === 0, 'C. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ================= D. Page arrêtée sans prévenir en pleine lecture : le journal suivant le dit =================
    // Un vrai plantage du navigateur ne peut pas être joué ici sans fermer tout le navigateur de test : on recopie le signe de vie que l'appli écrit pendant la lecture
    // (ce qu'un plantage laisse derrière lui, faute de fermeture normale), et l'on vérifie, d'une part qu'une fermeture normale l'efface, d'autre part ce que le journal en dit.
    if (sel('D')) {
        const { ctx, page } = await ouvrir(browser);
        await lancer(page);
        await page.waitForTimeout(3500);
        const vie = await page.evaluate(() => localStorage.getItem('trainhub.audioAlive.v1'));
        check(!!vie && JSON.parse(vie).ctx.indexOf('running') > 0, `D. signe de vie relevé pendant la lecture : ${vie}`);
        await page.reload(); // fermeture normale (pagehide)
        await page.waitForTimeout(1500);
        let j = await journal(page);
        check(!j.some(x => /arrêtée sans prévenir/.test(x)), "D. une fermeture normale (rechargement) pendant la lecture n'est PAS prise pour un plantage");
        check(await page.evaluate(() => localStorage.getItem('trainhub.audioAlive.v1')) === null, "D. et elle a effacé le signe de vie");
        // ce qu'un plantage laisse : le signe de vie est encore là au chargement suivant
        await page.evaluate(v => localStorage.setItem('trainhub.audioAlive.v1', v), vie);
        await page.evaluate(() => { window.__sansPagehide = true; });
        const nouvelle = await ctx.newPage();
        await nouvelle.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
        await nouvelle.goto(URL);
        await nouvelle.waitForTimeout(1500);
        j = await journal(nouvelle);
        const l = j.find(x => /arrêtée sans prévenir/.test(x));
        check(!!l, `D. le chargement suivant le dit : « ${l ? l.slice(l.indexOf('|') + 2, l.indexOf('|') + 150) : '—'}… »`);
        check(l && /dernier signe de vie à \d\d:\d\d:\d\d, métronome en lecture(, lecteur audio [a-zé ]+)?, ctx\d+:running@[\d.]+, bouée joue@[\d.]+, son de secours coupé, 100 BPM/.test(l), 'D. avec le dernier état connu (heure, contexte, bouée, son de secours, tempo)');
        check(l && /\d+ clic\(s\) de secours en attente, planificateur en retard de \d+ ms, dernière étape : lecture normale/.test(l), 'D. et le nombre de clics de secours en attente, le retard du planificateur et la dernière étape');
        check(await nouvelle.evaluate(() => localStorage.getItem('trainhub.audioAlive.v1')) === null, "D. et le signe de vie est consommé : il n'est dit qu'une fois");
        await ctx.close();
    }

    // ================= E. Page gelée quelques secondes : « minuterie en retard » =================
    if (sel('E')) {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await lancer(page);
        await page.evaluate(() => { const t = Date.now(); while (Date.now() - t < 3600); }); // le fil principal est bloqué 3,6 s
        await page.waitForTimeout(900);
        const j = await attendreJournal(page);
        const l = j.find(x => /minuterie en retard/.test(x));
        check(!!l && /retard de 3\.\d s/.test(l), `E. une page gelée 3,6 s est notée dans le journal : « ${l ? l.slice(l.indexOf('|') + 2) : '—'} »`);
        check(erreurs.length === 0, 'E. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ================= F. Bouée de 5 minutes ; interrupteur « Bouée audio » ; étape notée avant la relance =================
    if (sel('F')) {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await lancer(page);
        await page.waitForFunction(() => window.__bouee && isFinite(window.__bouee.duration) && window.__bouee.duration > 100, null, { timeout: 8000 });
        const dur = await page.evaluate(() => ({ d: window.__bouee.duration, loop: window.__bouee.loop }));
        check(dur.d > 295 && dur.d < 305 && dur.loop === true, `F. la bouée dure ${dur.d.toFixed(0)} s (elle ne boucle qu'une fois toutes les 5 minutes) et boucle bien`);
        let j = await attendreJournal(page);
        check(j.some(l => /métronome lancé \(bouée active, son de secours coupé\)/.test(l)), 'F. le lancement note si la bouée est active et si le son de secours l\'est');
        // relance : chaque étape est écrite dans le signe de vie AVANT l'opération (si la page se fige là, le journal suivant le dira)
        await page.evaluate(() => { window.__etapes = []; const set0 = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === 'trainhub.audioAlive.v1') { try { const o = JSON.parse(v); if (o.step && window.__etapes.indexOf(o.step) < 0) window.__etapes.push(o.step); } catch (e) { } } return set0.apply(this, arguments); }; window.__gel = true; });
        await page.waitForSelector('.toast', { timeout: 9000 });
        await page.waitForTimeout(900);
        const etapes = await page.evaluate(() => window.__etapes);
        check(etapes.includes('relance de la bouée : pause') && etapes.includes('relance de la bouée : lecture') && etapes.indexOf('relance de la bouée : pause') < etapes.indexOf('relance de la bouée : lecture'), `F. la relance de la bouée note ses étapes dans le signe de vie, dans l'ordre : ${JSON.stringify(etapes)}`);
        check(await page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.audioAlive.v1')).step) === '', "F. et l'étape est effacée une fois la relance finie");
        await page.click('.metro-play-btn-big'); // arrêt
        await page.keyboard.press('Escape'); // referme la fenêtre du métronome (son fond sur la page)
        await page.waitForSelector('.ctx-backdrop', { state: 'detached', timeout: 3000 }).catch(() => { });
        // interrupteur dans les réglages
        await page.click('#settings-btn');
        await page.locator('.settings-tab', { hasText: /Métronome/ }).first().click();
        const champ = page.locator('.settings-field', { hasText: 'Bouée audio' });
        await champ.locator('.settings-switch').click(); // coupe
        await page.keyboard.press('Escape');
        check(await page.evaluate(() => localStorage.getItem('trainhub.metroLife.v1')) === '0', 'F. l\'interrupteur « Bouée audio » enregistre le réglage (coupée)');
        await page.evaluate(() => { window.__bouee = null; window.__gel = false; });
        await page.waitForSelector('.ctx-backdrop', { state: 'detached', timeout: 3000 }).catch(() => { });
        await page.click('#metronome-btn');
        await page.waitForSelector('.metro-play-btn-big');
        await page.click('.metro-play-btn-big');
        await page.waitForTimeout(3500);
        j = await attendreJournal(page);
        check(await page.evaluate(() => !window.__bouee), 'F. bouée coupée : aucun élément audio ne tourne en boucle');
        check(j.some(l => /bouée audio désactivée/.test(l)) && j.some(l => /métronome lancé \(bouée désactivée/.test(l)), 'F. et le journal le dit (réglage, puis lancement « bouée désactivée »)');
        check(!j.some(l => /la bouée est figée/.test(l.slice(l.lastIndexOf('métronome lancé')))), 'F. et plus aucune alerte « bouée figée » ensuite');
        check(erreurs.length === 0, 'F. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ================= G. Bouée désactivée par défaut ; interrupteur « Bouée audio (essai) » =================
    if (sel('G')) {
        const { ctx, page, erreurs } = await ouvrir(browser, null, { bouee: false });
        check(await page.evaluate(() => localStorage.getItem('trainhub.metroLife.v1')) === null, 'G. aucun réglage enregistré : on part du réglage par défaut');
        await lancer(page);
        await page.waitForTimeout(2500);
        const j = await attendreJournal(page);
        check(j.some(l => /métronome lancé \(bouée désactivée, son de secours coupé\)/.test(l)), 'G. par défaut, le lancement dit « bouée désactivée »');
        check(await page.evaluate(() => !window.__bouee), 'G. et aucun élément audio ne tourne en boucle');
        check(!j.some(l => /la bouée est figée|bouée lancée/.test(l)), 'G. ni lancement ni alerte de bouée dans le journal');
        await page.click('.metro-play-btn-big'); // arrêt
        await page.waitForTimeout(300);
        await page.keyboard.press('Escape');
        await page.waitForSelector('.ctx-backdrop', { state: 'detached', timeout: 3000 }).catch(() => { });
        await page.click('#settings-btn');
        await page.locator('.settings-tab', { hasText: /Métronome/ }).first().click();
        const champ = page.locator('.settings-field', { hasText: 'Bouée audio' });
        check(await champ.count() === 1 && /essai/.test(await champ.innerText()) && !(await champ.locator('.settings-switch').evaluate(e => e.classList.contains('on') || e.getAttribute('aria-checked') === 'true')), 'G. l\'interrupteur « Bouée audio (essai) » est éteint dans les réglages');
        await champ.locator('.settings-switch').click(); // allume
        check(await page.evaluate(() => localStorage.getItem('trainhub.metroLife.v1')) === '1', 'G. on peut l\'allumer : réglage enregistré');
        await page.keyboard.press('Escape');
        await page.waitForSelector('.ctx-backdrop', { state: 'detached', timeout: 3000 }).catch(() => { });
        await lancer(page);
        await page.waitForTimeout(1500);
        check(await page.evaluate(() => !!window.__bouee), 'G. allumée, la bouée tourne de nouveau');
        check(erreurs.length === 0, 'G. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ================= H. Lancement : chaque étape est notée AVANT d'être faite, le journal est écrit tout de suite =================
    if (sel('H')) {
        const { ctx, page, erreurs } = await ouvrir(browser);
        // toutes les écritures du signe de vie pendant le lancement ; le journal est relevé à l'instant exact de l'écriture de la dernière étape
        await page.evaluate(() => {
            window.__vie = []; window.__journalAu = [];
            const set0 = Storage.prototype.setItem;
            Storage.prototype.setItem = function (k, v) {
                if (k === 'trainhub.audioAlive.v1') { try { const o = JSON.parse(v); window.__vie.push({ step: o.step, play: o.play, lag: o.lag, ctx: o.ctx }); } catch (e) { } }
                return set0.apply(this, arguments);
            };
        });
        await page.click('#metronome-btn');
        await page.waitForSelector('.metro-play-btn-big');
        await page.click('.metro-play-btn-big');
        const immediat = await page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.audioLog.v1') || '[]').some(l => /métronome lancé/.test(l)));
        check(immediat, 'H. le journal contient « métronome lancé » dès la fin de l\'appui (écriture immédiate, pas 0,8 s plus tard)');
        await page.waitForTimeout(600);
        const vie = await page.evaluate(() => window.__vie);
        const etapes = vie.map(v => v.step).filter((x, i, a) => x && a.indexOf(x) === i);
        const attendu = ['lancement : contexte audio', 'contexte audio : fermeture de l\'ancien', 'contexte audio : création du neuf', 'lancement : bouée', 'lancement : son de secours', 'lancement : planificateur'];
        const ordre = attendu.map(a => etapes.findIndex(e => e.indexOf(a) === 0));
        check(ordre.every(i => i >= 0) && ordre.every((v, i) => i === 0 || v > ordre[i - 1]), `H. étapes du lancement écrites dans l'ordre : ${etapes.join(' → ')}`);
        check(vie[vie.length - 1].step === '' && vie[vie.length - 1].play === true, `H. la dernière écriture efface l'étape, métronome en lecture (${JSON.stringify(vie[vie.length - 1])})`);
        check(vie[0].play === false, 'H. et la première dit que le métronome est encore en cours de lancement');
        // arrêt puis relance 8 s plus tard : le retard du planificateur n'hérite plus de la lecture précédente
        await page.click('.metro-play-btn-big');
        await page.waitForTimeout(8000);
        await page.evaluate(() => { window.__vie = []; });
        await page.click('.metro-play-btn-big');
        await page.waitForTimeout(500);
        const v2 = await page.evaluate(() => window.__vie);
        check(v2.length > 0 && v2.every(v => v.lag < 1000), `H. relance 8 s après l'arrêt : retard noté < 1 s (au lieu de ~8 s) : ${v2.map(v => v.lag).join(', ')} ms`);
        check(erreurs.length === 0, 'H. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ================= I. Gel pendant le lancement : le journal suivant le dit, avec l'étape =================
    if (sel('I')) {
        const { ctx, page } = await ouvrir(browser, null, { bouee: false });
        await page.evaluate(() => localStorage.setItem('trainhub.audioAlive.v1', JSON.stringify({ t: Date.now() - 5000, ctx: 'ctx6:suspended@0.0', life: 'pause', fb: true, hidden: false, bpm: 58, timers: 0, lag: 3, step: 'lancement : bouée', play: false })));
        const nouvelle = await ctx.newPage();
        await nouvelle.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
        await nouvelle.goto(URL);
        await nouvelle.waitForTimeout(1500);
        const j = await journal(nouvelle);
        const l = j.find(x => /arrêtée sans prévenir/.test(x));
        check(!!l && /métronome en cours de lancement, ctx6:suspended@0.0, bouée pause, son de secours activé, 58 BPM/.test(l) && /dernière étape : lancement : bouée/.test(l), `I. gel au lancement : « ${l ? l.slice(l.indexOf('dernier signe de vie')) : '—'} »`);
        await ctx.close();
    }

    // ================= J. Son de secours : un clic refusé n'est plus perdu, et un bilan est écrit à l'arrêt =================
    if (sel('J')) {
        const lancerSecours = async () => { const o = await ouvrir(browser, null, { bouee: false, secours: true }); await lancer(o.page); return o; };
        const bilan1 = j => j.find(l => /bilan de la lecture/.test(l)) || '';
        {   // J1 : tout va bien
            const { ctx, page, erreurs } = await lancerSecours();
            await page.waitForTimeout(1500);
            await page.evaluate(() => { window.__osc = 0; }); // (les tout premiers clics, pendant que les clics de secours sont rendus, passent par Web Audio)
            await page.waitForTimeout(7000);
            const osc = await page.evaluate(() => window.__osc);
            await page.click('.metro-play-btn-big');
            const j = await attendreJournal(page);
            const b = bilan1(j), m = /(\d+) clic\(s\), (\d+) en retard de plus de 60 ms.*, (\d+) refusé\(s\) par le navigateur.*, (\d+) abandonné/.exec(b);
            check(!!m && +m[1] >= 10 && +m[3] === 0 && +m[4] === 0, `J. lecture saine : le bilan à l'arrêt compte les clics sans refus ni abandon (« ${b.slice(b.indexOf('son de secours'))} »)`);
            check(osc === 0, `J. et tous les clics passent par le lecteur audio : Web Audio n'en joue aucun (${osc})`);
            check(!j.some(l => /lecture refusée/.test(l)), 'J. aucune ligne « lecture refusée »');
            check(erreurs.length === 0, 'J. aucune erreur JavaScript ' + JSON.stringify(erreurs));
            await ctx.close();
        }
        {   // J2 : le navigateur refuse de lancer les clics
            const { ctx, page } = await lancerSecours();
            await page.waitForTimeout(1500);
            await page.evaluate(() => { window.__refuser = true; window.__osc = 0; });
            await page.waitForTimeout(6000);
            const osc = await page.evaluate(() => window.__osc);
            await page.evaluate(() => { window.__refuser = false; });
            await page.click('.metro-play-btn-big');
            const j = await attendreJournal(page);
            check(osc >= 6, `J. quand le navigateur refuse la lecture, Web Audio joue les clics à la place : aucune note perdue (${osc} clics en 6 s à 100 BPM)`);
            const l = j.find(x => /lecture refusée par le navigateur/.test(x)) || '';
            check(/NotAllowedError/.test(l) && /joué par Web Audio/.test(l) && /×\d+/.test(l), `J. et le journal le dit, en regroupant les répétitions (« ${l.slice(l.indexOf('son de secours'))} »)`);
            const m = /(\d+) refusé\(s\) par le navigateur \(rejoués par Web Audio\)/.exec(bilan1(j));
            check(!!m && +m[1] >= 6, `J. le bilan à l'arrêt donne le nombre de clics refusés (${m && m[1]})`);
            await ctx.close();
        }
        {   // J3 : page ralentie (retour d'une autre fenêtre) : les clics en retard sont comptés
            const { ctx, page } = await lancerSecours();
            await page.waitForTimeout(2500);
            await page.evaluate(() => { window.__retard = 120; });
            await page.waitForTimeout(3500);
            await page.evaluate(() => { window.__retard = 0; });
            await page.click('.metro-play-btn-big');
            const j = await attendreJournal(page);
            const m = /(\d+) en retard de plus de 60 ms \(jusqu'à (\d+) ms\)/.exec(bilan1(j));
            check(!!m && +m[1] >= 3 && +m[2] >= 100, `J. minuteries ralenties de 120 ms : le bilan compte les clics en retard (${m ? m[1] + ' clic(s), jusqu\'à ' + m[2] + ' ms' : '—'})`);
            await ctx.close();
        }
    }

    // ================= K. Signe de vie : session libre, taille de la page, dernier affichage =================
    if (sel('K')) {
        const { ctx, page } = await ouvrir(browser, null, { bouee: false });
        await lancer(page);
        await page.waitForTimeout(2500);
        let vie = await page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.audioAlive.v1') || 'null'));
        check(vie && vie.free === false && vie.nodes > 100 && typeof vie.renderMs === 'number', `K. le signe de vie note « session libre : non », la taille de la page et le dernier affichage (${vie && JSON.stringify({ free: vie.free, nodes: vie.nodes, renderMs: vie.renderMs })})`);
        await page.click('.metro-play-btn-big'); // arrêt
        await page.waitForTimeout(300);
        await page.keyboard.press('Escape');
        await page.waitForSelector('.ctx-backdrop', { state: 'detached', timeout: 3000 }).catch(() => { });
        await page.click('#free-btn');
        await page.waitForTimeout(600);
        if (!(await page.locator('.metro-play-btn-big').count())) await page.click('#metronome-btn');
        await page.waitForSelector('.metro-play-btn-big');
        await page.click('.metro-play-btn-big');
        await page.waitForTimeout(2600);
        vie = await page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.audioAlive.v1') || 'null'));
        check(vie && vie.free === true, 'K. pendant une session libre : « session libre : oui »');
        // ce que dit le journal après un gel
        const nouvelle = await ctx.newPage();
        await nouvelle.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
        await page.evaluate(v => localStorage.setItem('trainhub.audioAlive.v1', JSON.stringify(v)), vie);
        await nouvelle.goto(URL);
        await nouvelle.waitForTimeout(1500);
        const l = (await journal(nouvelle)).find(x => /arrêtée sans prévenir/.test(x)) || '';
        check(/session libre active, \d+ éléments dans la page, dernier affichage de la page : \d+ ms/.test(l), `K. le journal après un gel le dit : « ${l.slice(l.indexOf('session libre'))} »`);
        await ctx.close();
    }

    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
