// Lecteur de fichiers audio (MP3) et session libre : journal du lecteur, signe de vie qui couvre aussi le métronome ARRÊTÉ (session libre, lecteur qui joue),
// page qui ne répond plus, et horloge du moteur de boucle figée (le son serait muet sans rien dire : l'élément reprend le son).
// Un vrai MP3 (audio/piano/C2.mp3) est lu dans Chromium. Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_lecteur_test.js   (serveur statique :8765)
const { chromium } = require('playwright');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : lecteur audio et session libre — journal, signe de vie, horloge figée');
const estBruitReseau = harnais.estBruitReseau;
plan(29);
const MP3 = 'http://localhost:8765/audio/piano/C2.mp3';

async function ouvrir(browser, { boucle = false, url = MP3, ctxExistant = null, ouvrirLecteur = true, seed = true } = {}) {
    const ctx = ctxExistant || await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', colorScheme: 'dark' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !estBruitReseau(m.text()) && !/ERR_FAILED|Failed to load resource/.test(m.text())) erreurs.push('console: ' + m.text()); });
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.addInitScript(({ boucle, url, seed }) => {
        try {
            localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1');
            // vrai état de sourdine posé sur l'élément <audio> (l'appli le mémorise au chargement : cette enveloppe doit être posée avant elle)
            window.__sourdine = [];
            const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted');
            Object.defineProperty(HTMLMediaElement.prototype, 'muted', { configurable: true, get() { return d.get.call(this); }, set(v) { window.__sourdine.push(!!v); d.set.call(this, v); } });
            // horloge du contexte audio : peut être figée à la demande
            const BA = window.BaseAudioContext.prototype, dt = Object.getOwnPropertyDescriptor(BA, 'currentTime');
            Object.defineProperty(BA, 'currentTime', { configurable: true, get() { return window.__figee != null ? window.__figee : dt.get.call(this); } });
            if (seed && !sessionStorage.getItem('__seed')) {
                sessionStorage.setItem('__seed', '1');
                localStorage.setItem('trainhub.audioList.v1', JSON.stringify({ index: 0, tracks: [{ kind: 'link', url, name: 'Do grave (C2)', rate: null }] }));
                if (boucle) localStorage.setItem('trainhub.audioLoop', '1');
            }
        } catch (e) { }
    }, { boucle, url, seed });
    await page.goto('http://localhost:8765/index.html');
    await page.waitForTimeout(500);
    if (ouvrirLecteur) { await page.click('#audio-btn'); await page.waitForSelector('.audio-play', { timeout: 8000 }); }
    return { ctx, page, erreurs };
}
const path = require('path');
const FICHIER = path.join(__dirname, 'media', 'backing_test.mp3'); // 8 s
// Un vrai fichier joint à un exercice (stocké dans IndexedDB : il peut se déplacer dans le fichier et passer par le moteur de boucle) ; un clic sur sa puce l'ouvre dans le lecteur et le lance.
async function ouvrirFichier(browser, { boucle = false } = {}) {
    const r = await ouvrir(browser, { ouvrirLecteur: false, seed: false });
    const page = r.page;
    const inp = page.locator('input[placeholder^="Ajouter un exercice"]').first();
    await inp.fill('Backing'); await inp.press('Enter'); await page.waitForTimeout(300);
    await page.locator('.exercise .exercise-row-spacer').first().click();
    await page.waitForSelector('input.add-file-input', { state: 'attached' });
    await page.setInputFiles('input.add-file-input', FICHIER);
    await page.waitForSelector('.file-chip', { timeout: 8000 }); await page.waitForTimeout(300);
    if (await page.locator('.file-chip .link-label-input').count()) { await page.locator('.file-chip .link-label-input').first().press('Escape'); await page.waitForSelector('.file-chip .file-open'); }
    await page.locator('.file-chip .file-open').click();
    await page.waitForSelector('.audio-play', { timeout: 8000 });
    await page.waitForTimeout(600);
    if (boucle) { await page.click('.audio-loop'); await page.waitForTimeout(300); }
    return r;
}
const journal = async page => { await page.waitForTimeout(1000); return page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.audioLog.v1') || '[]')); };
const vie = page => page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.audioAlive.v1') || 'null'));
const lignes = (j, re) => j.filter(l => re.test(l));

(async () => {
    const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

    // ============ A. Journal du lecteur (fichier joint, sans boucle) ============
    {
        const { ctx, page, erreurs } = await ouvrirFichier(browser);
        let j = await journal(page);
        check(lignes(j, /lecteur audio : lecture — « backing_test\.mp3 » file, joue@/).length === 1, 'A. « lecture » est notée, avec le nom du fichier, son type, la position et la durée : ' + (lignes(j, /lecture —/)[0] || '').replace(/^.*\| /, ''));
        await page.click('.audio-play'); await page.waitForTimeout(300); // Pause au clic
        j = await journal(page);
        check(lignes(j, /pause demandée \(geste\)/).length === 1, 'A. une pause au clic est « demandée (geste) »');
        await page.click('.audio-play'); await page.waitForTimeout(2200); // relance, puis plus aucun geste pendant 2 s
        await page.evaluate(() => document.querySelector('.audio-host audio').pause()); // pause venue d'ailleurs (système, casque, touche média)
        j = await journal(page);
        check(lignes(j, /pause SANS geste de l'utilisateur/).length === 1, 'A. une pause sans geste (système, casque, touche média) est signalée comme telle');
        check(/état \d\/\d/.test(lignes(j, /pause SANS geste/)[0] || ''), 'A. avec l\'état du lecteur (readyState / networkState)');
        // fin du fichier
        await page.evaluate(() => { const a = document.querySelector('.audio-host audio'); a.currentTime = Math.max(0, a.duration - 0.4); a.play(); });
        await page.waitForTimeout(1500);
        j = await journal(page);
        check(lignes(j, /lecteur audio : fin du fichier/).length === 1, 'A. la fin du fichier est notée');
        check(j.filter(l => /lecteur audio : pause/.test(l)).length === 2, 'A. et la fin n\'est pas comptée comme une pause (2 pauses seulement)');
        check(erreurs.length === 0, 'A. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ B. Fichier introuvable ============
    {
        const { ctx, page } = await ouvrir(browser, { url: 'http://localhost:8765/audio/inexistant.mp3' });
        await page.click('.audio-play'); await page.waitForTimeout(1200);
        const j = await journal(page);
        check(lignes(j, /lecteur audio : ERREUR \d/).length >= 1, 'B. un fichier introuvable est noté « ERREUR » avec le code du navigateur : ' + (lignes(j, /ERREUR/)[0] || '').slice(0, 200));
        await ctx.close();
    }

    // ============ C. Horloge du moteur de boucle ============
    {
        const { ctx, page, erreurs } = await ouvrirFichier(browser, { boucle: true });
        // (le fichier joue déjà depuis son ouverture) le moteur de boucle prend le relais : l'élément est mis en sourdine
        let ok = false;
        for (let i = 0; i < 40 && !ok; i++) { await page.waitForTimeout(250); ok = await page.evaluate(() => window.__sourdine.length > 0 && window.__sourdine[window.__sourdine.length - 1] === true); }
        check(ok, 'C. boucle : le moteur Web Audio prend le relais (élément en sourdine)');
        // 4 s de lecture normale : aucune alerte d'horloge
        await page.waitForTimeout(4000);
        let j = await journal(page);
        check(lignes(j, /horloge du moteur de boucle est figée/).length === 0, 'C. en lecture normale, aucune fausse alerte d\'horloge figée (5 s)');
        const avant = await page.evaluate(() => { const a = document.querySelector('.audio-host audio'); return { t: a.currentTime, paused: a.paused, dur: a.duration }; });
        // gel de l'horloge du contexte (état « en marche », temps qui n'avance plus)
        await page.evaluate(() => { window.__figee = 1.234; });
        await page.waitForTimeout(2600);
        j = await journal(page);
        check(lignes(j, /horloge du moteur de boucle est figée depuis/).length === 1, 'C. horloge figée : détectée et notée : ' + (lignes(j, /horloge du moteur/)[0] || '').replace(/^.*\| /, '').slice(0, 170));
        const apres = await page.evaluate(() => { const a = document.querySelector('.audio-host audio'); return { t: a.currentTime, paused: a.paused, sourdine: window.__sourdine[window.__sourdine.length - 1] }; });
        check(apres.sourdine === false, 'C. l\'élément reprend le son (sourdine levée)');
        check(!apres.paused, 'C. et il continue de jouer');
        // position : l'élément a continué d'avancer (en boucle sur un fichier court : on vérifie qu'il n'a pas été ramené en arrière à l'instant figé)
        check(Math.abs(apres.t - 1.234) > 0.3 || avant.dur < 2,  `C. la position n'a pas été recalée sur l'horloge figée (élément à ${apres.t.toFixed(2)} s, horloge figée à 1,23 s)`);
        // pas de relance en boucle de l'alerte
        await page.waitForTimeout(2500);
        j = await journal(page);
        check(lignes(j, /horloge du moteur de boucle est figée/).length === 1, 'C. l\'alerte n\'est écrite qu\'une fois');
        check(erreurs.length === 0, 'C. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ============ D. Signe de vie : session libre, métronome ARRÊTÉ ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { ouvrirLecteur: false, seed: false });
        check(await vie(page) === null, 'D. au repos (ni session libre, ni lecteur, ni métronome) : pas de signe de vie');
        await page.click('#free-btn'); await page.waitForTimeout(2600);
        let v = await vie(page);
        check(v && v.free === true && v.play === false && v.start === false && v.mp3 === '—', 'D. session libre en cours, métronome arrêté : un signe de vie est écrit ' + JSON.stringify(v && { free: v.free, play: v.play, start: v.start, mp3: v.mp3, lag: v.lag }));
        check(v && v.lag === 0, 'D. sans « retard du planificateur » trompeur (le métronome n\'est pas lancé)');
        // plantage : le moteur de rendu meurt sans prévenir (pas de « pagehide »)
        // Un vrai plantage ne peut pas être joué ici sans fermer tout le navigateur de test : on recopie le signe de vie écrit pendant la session libre (ce qu'un plantage laisse derrière lui)
        const brut = await page.evaluate(() => localStorage.getItem('trainhub.audioAlive.v1'));
        await page.reload(); await page.waitForTimeout(500); // fermeture normale : efface le signe de vie
        check(await vie(page) === null, 'D. une fermeture normale (rechargement) en session libre efface le signe de vie');
        await page.evaluate(v => localStorage.setItem('trainhub.audioAlive.v1', v), brut);
        const nouvelle = await ctx.newPage();
        await nouvelle.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
        await nouvelle.goto('http://localhost:8765/index.html'); await nouvelle.waitForTimeout(800);
        const j = await journal(nouvelle);
        const l = lignes(j, /arrêtée sans prévenir/)[0] || '';
        check(!!l, 'D. la page suivante le dit : « la page précédente s\'est arrêtée sans prévenir »');
        check(/métronome arrêté/.test(l) && /lecteur audio fermé/.test(l) && /session libre active/.test(l), 'D. avec l\'état : métronome arrêté, lecteur fermé, session libre active : ' + l.replace(/^.*\| /, '').slice(0, 330));
        await ctx.close();
    }

    // ============ E. Signe de vie : lecteur audio qui joue, rien d'autre ============
    {
        const { ctx, page } = await ouvrir(browser);
        await page.click('.audio-play'); await page.waitForTimeout(2600);
        let v = await vie(page);
        check(v && v.mp3 === 'joue' && v.free === false && v.play === false, 'E. lecteur audio en lecture : signe de vie écrit (mp3 : joue)');
        await page.click('.audio-play'); await page.waitForTimeout(2800);
        check(await vie(page) === null, 'E. lecteur mis en pause, plus rien en cours : le signe de vie est effacé');
        await page.click('.audio-play'); await page.waitForTimeout(2500);
        // Un vrai plantage ne peut pas être joué ici sans fermer tout le navigateur de test : on recopie le signe de vie écrit pendant la session libre (ce qu'un plantage laisse derrière lui)
        const brut = await page.evaluate(() => localStorage.getItem('trainhub.audioAlive.v1'));
        await page.reload(); await page.waitForTimeout(500); // fermeture normale : efface le signe de vie
        await page.evaluate(v => localStorage.setItem('trainhub.audioAlive.v1', v), brut);
        const nouvelle = await ctx.newPage();
        await nouvelle.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
        await nouvelle.goto('http://localhost:8765/index.html'); await nouvelle.waitForTimeout(800);
        const l = lignes(await journal(nouvelle), /arrêtée sans prévenir/)[0] || '';
        check(/lecteur audio en lecture/.test(l) && /métronome arrêté/.test(l), 'E. plantage du lecteur : « lecteur audio en lecture », « métronome arrêté » : ' + l.replace(/^.*\| /, '').slice(0, 200));
        await ctx.close();
    }

    // ============ F. Fermeture normale : pas de fausse alerte ============
    {
        const { ctx, page } = await ouvrir(browser, { ouvrirLecteur: false, seed: false });
        await page.click('#free-btn'); await page.waitForTimeout(2600);
        await page.reload(); await page.waitForTimeout(800);
        const j = await journal(page);
        check(lignes(j, /arrêtée sans prévenir/).length === 0, 'F. un simple rechargement en session libre n\'est pas pris pour un plantage');
        await ctx.close();
    }

    // ============ G. Page qui ne répond plus en session libre ============
    {
        const { ctx, page } = await ouvrir(browser, { ouvrirLecteur: false, seed: false });
        await page.click('#free-btn'); await page.waitForTimeout(2600);
        await page.evaluate(() => { const t = Date.now(); while (Date.now() - t < 8500); }); // fil principal bloqué 8,5 s
        await page.waitForTimeout(2600);
        const j = await journal(page);
        const l = lignes(j, /minuterie en retard de/)[0] || '';
        check(/session libre en cours/.test(l) && /8\.\d s|9\.\d s|10\.\d s/.test(l), 'G. une page figée 8,5 s en session libre est notée : ' + l.replace(/^.*\| /, '').slice(0, 160));
        await ctx.close();
    }

    // ============ H. Rien de plus qu'avant au repos : pas de bruit dans le journal ============
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { ouvrirLecteur: false, seed: false });
        await page.waitForTimeout(9000);
        const j = await journal(page);
        check(j.filter(l => /minuterie|lecteur audio/.test(l)).length === 0 && await vie(page) === null, 'H. au repos, 9 s : aucune ligne parasite dans le journal, aucun signe de vie');
        check(erreurs.length === 0, 'H. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
