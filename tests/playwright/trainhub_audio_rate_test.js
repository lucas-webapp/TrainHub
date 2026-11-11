// Lecteur audio de TrainHub : la vitesse monte jusqu'à 150 %. Un vrai MP3 (audio/piano/C2.mp3) est lu dans Chromium.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_audio_rate_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : vitesse du lecteur audio jusqu\'à 150 %');
const estBruitReseau = harnais.estBruitReseau;
plan(24);

const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const MP3 = 'http://localhost:8765/audio/piano/C2.mp3';

async function ouvrir(browser, { viewport = { width: 1280, height: 800 }, rate = null, mode = null } = {}) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', colorScheme: 'dark' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !estBruitReseau(m.text()) && !/ERR_FAILED/.test(m.text())) erreurs.push('console: ' + m.text()); });
    // pas de Firebase ici
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.addInitScript(({ rate, mode, MP3 }) => {
        // trace des vitesses réellement données aux éléments <audio>, et mémorisation de l'élément qui joue
        window.__rates = [];
        const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
        Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', { configurable: true, get() { return d.get.call(this); }, set(v) { window.__rates.push(v); d.set.call(this, v); } });
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () { window.__audio = this; return play.apply(this, arguments); };
        try {
            if (!sessionStorage.getItem('__seed')) {
                sessionStorage.setItem('__seed', '1');
                localStorage.setItem('trainhub.audioList.v1', JSON.stringify({ index: 0, tracks: [{ kind: 'link', url: MP3, name: 'Do grave (C2)', rate }] }));
                if (mode) localStorage.setItem('trainhub.audioMode', mode);
            }
        } catch (e) { }
    }, { rate, mode, MP3 });
    await page.goto('http://localhost:8765/index.html');
    await page.click('#audio-btn');
    await page.waitForSelector('.audio-player-rate', { timeout: 8000 });
    return { ctx, page, erreurs };
}
const lire = page => page.evaluate(() => { const r = document.querySelector('.audio-player-rate'); return { min: r.min, max: r.max, step: r.step, val: r.value, txt: document.querySelector('.audio-player-rate-txt').textContent, p: r.style.getPropertyValue('--p'), derniere: window.__rates[window.__rates.length - 1] }; });

(async () => {
    const browser = await chromium.launch();

    // ===== A. Réglage à la main =====
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        let r = await lire(page);
        check(r.min === '25' && r.max === '150', `A. la jauge va de ${r.min} % à ${r.max} %`);
        check(r.val === '100' && r.txt.trim() === '100 %', `A. départ à 100 % (${r.txt})`);
        // clavier : Fin = maximum
        await page.focus('.audio-player-rate');
        await page.keyboard.press('End');
        r = await lire(page);
        check(r.val === '150' && r.txt.trim() === '150 %', `A. jauge au maximum : ${r.txt}`);
        check(r.derniere === 1.5, `A. et l'élément <audio> reçoit bien 1,5 (${r.derniere})`);
        check(r.p === '100%', `A. la jauge est remplie jusqu'au bout (--p = ${r.p})`);
        // le bouton + ne dépasse pas 150
        await page.click('.audio-rate-plus');
        r = await lire(page);
        check(r.val === '150', `A. « + » à 150 % ne va pas plus loin (${r.val})`);
        // le bouton − redescend d'un pas de 5
        await page.click('.audio-rate-minus');
        r = await lire(page);
        check(r.val === '145' && r.derniere === 1.45, `A. « − » redescend à 145 % (${r.txt}, élément ${r.derniere})`);
        // pas de 5 depuis 100 : sept appuis de « + » = 135, etc.
        await page.click('.audio-player-rate-txt');
        r = await lire(page);
        check(r.val === '100' && r.derniere === 1, `A. un clic sur le chiffre revient à 100 % (${r.txt})`);
        for (let i = 0; i < 9; i++) await page.click('.audio-rate-plus');
        r = await lire(page);
        check(r.val === '145', `A. neuf appuis de « + » depuis 100 % : ${r.txt}`);
        await page.click('.audio-rate-plus'); await page.click('.audio-rate-plus');
        r = await lire(page);
        check(r.val === '150', `A. puis butée à 150 % (${r.txt})`);
        // le bas de la plage est intact
        await page.focus('.audio-player-rate');
        await page.keyboard.press('Home');
        r = await lire(page);
        check(r.val === '25' && r.derniere === 0.25, `A. le bas de la plage est intact : ${r.txt}`);
        // mémoire : la dernière vitesse sert de départ aux prochains morceaux
        await page.keyboard.press('End');
        const mem = await page.evaluate(() => ({ g: localStorage.getItem('trainhub.audioRate'), l: JSON.parse(localStorage.getItem('trainhub.audioList.v1')).tracks[0].rate }));
        check(mem.g === '1.5' && mem.l === 1.5, `A. la vitesse est retenue (dernier réglage ${mem.g}, morceau ${mem.l})`);
        await page.screenshot({ path: path.join(SHOTS, 'audio-bureau-150.png') });
        check(erreurs.length === 0, 'A. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ===== B. Un morceau déjà réglé à 150 % le retrouve ; une valeur absurde est ramenée dans la plage =====
    for (const [rate, attendu] of [[1.5, '150'], [3, '150'], [0.1, '25']]) {
        const { ctx, page } = await ouvrir(browser, { rate });
        const r = await lire(page);
        check(r.val === attendu, `B. morceau enregistré à ${rate * 100} % : la jauge affiche ${r.val} %`);
        await ctx.close();
    }

    // ===== C. Lecture réelle : à 150 % le son avance 1,5 fois plus vite =====
    {
        const { ctx, page } = await ouvrir(browser);
        async function mesurer(pct) {
            await page.focus('.audio-player-rate');
            await page.evaluate(v => { const r = document.querySelector('.audio-player-rate'); r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true })); }, pct);
            await page.evaluate(() => { const a = window.__audio || document.querySelector('audio'); if (a) { a.pause(); a.currentTime = 0; } });
            await page.click('.audio-player-play, .audio-play, [aria-label="Lecture"], [title="Lecture"]').catch(() => { });
            await page.evaluate(() => { if (window.__audio && window.__audio.paused) window.__audio.play().catch(() => { }); });
            await page.waitForTimeout(300);
            const d = await page.evaluate(() => { const a = window.__audio; return a ? { t: a.currentTime, rate: a.playbackRate, paused: a.paused, dur: a.duration } : null; });
            if (!d || d.paused) return d;
            const t0 = d.t; const w0 = Date.now();
            await page.waitForTimeout(1500);
            const f = await page.evaluate(() => ({ t: window.__audio.currentTime, rate: window.__audio.playbackRate, paused: window.__audio.paused }));
            return { gain: (f.t - t0) / ((Date.now() - w0) / 1000), rate: f.rate, paused: f.paused, dur: d.dur };
        }
        const m100 = await mesurer(100);
        const m150 = await mesurer(150);
        console.log('  mesures :', JSON.stringify({ m100, m150 }));
        check(m150 && m150.rate === 1.5, `C. l'élément <audio> lit à ${m150 && m150.rate}`);
        if (m100 && m150 && m100.gain && m150.gain) {
            const rapport = m150.gain / m100.gain;
            check(rapport > 1.3 && rapport < 1.7, `C. le son avance ${rapport.toFixed(2)} fois plus vite à 150 % qu'à 100 % (attendu ≈ 1,5)`);
        } else check(false, 'C. la lecture n\'a pas démarré dans ce navigateur de test ' + JSON.stringify({ m100, m150 }));
        await ctx.close();
    }

    // ===== D. Téléphone 390 px : la jauge reste utilisable =====
    {
        const { ctx, page } = await ouvrir(browser, { viewport: { width: 390, height: 844 }, rate: 1.5 });
        const g = await page.evaluate(() => {
            const r = document.querySelector('.audio-player-rate').getBoundingClientRect(); const t = document.querySelector('.audio-player-rate-txt').getBoundingClientRect();
            return { l: r.left, r: r.right, w: Math.round(r.width), txtR: t.right, doc: document.documentElement.scrollWidth - innerWidth };
        });
        check(g.w >= 80 && g.txtR <= 390 && g.doc <= 0, `D. téléphone : jauge de ${g.w} px, chiffre dans l'écran, rien ne déborde (${JSON.stringify(g)})`);
        await page.screenshot({ path: path.join(SHOTS, 'audio-tel-150.png') });
        await ctx.close();
    }

    // ===== E. Barre épinglée (v277) : jauges de volume et de vitesse plus larges (62 et 77 px avant) =====
    {
        const mesure = async largeur => {
            const { ctx, page, erreurs } = await ouvrir(browser, { viewport: { width: largeur, height: 800 }, mode: 'dock' });
            await page.waitForSelector('.audio-dock .audio-player-vol', { timeout: 5000 });
            await page.waitForTimeout(400);
            const m = await page.evaluate(() => { const w = s => Math.round(document.querySelector(s).getBoundingClientRect().width); return { vol: w('.audio-player-vol'), rate: w('.audio-player-rate'), haut: w('.audio-dock') && Math.round(document.querySelector('.audio-dock').getBoundingClientRect().height), doc: document.documentElement.scrollWidth - innerWidth, txtR: document.querySelector('.audio-player-rate-txt').getBoundingClientRect().right, ecran: innerWidth }; });
            m.erreurs = erreurs.length; await ctx.close(); return m;
        };
        const g1280 = await mesure(1280), g1600 = await mesure(1600), g1000 = await mesure(1000);
        check(g1280.vol >= 100 && g1280.rate >= 130, `E. 1280 px : volume ${g1280.vol} px et vitesse ${g1280.rate} px (avant : 62 et 77)`);
        check(g1280.haut < 70, `E. … et la barre tient toujours sur une seule ligne (${g1280.haut} px de haut)`);
        check(g1600.vol > g1280.vol && g1600.rate > g1280.rate, `E. fenêtre plus large : les jauges grandissent encore (${g1600.vol} / ${g1600.rate} px à 1600)`);
        check(g1000.vol >= 150 && g1000.rate >= 200 && g1000.doc <= 0 && g1000.txtR <= g1000.ecran, `E. 1000 px : jauges ${g1000.vol} / ${g1000.rate} px, rien ne déborde`);
        check(g1280.erreurs + g1600.erreurs + g1000.erreurs === 0, 'E. aucune erreur JavaScript');
    }

    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
