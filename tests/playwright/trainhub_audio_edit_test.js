// « Modifier le son » : couper une intro, garder une partie, boucle, repères précis, zoom, remplacement, limites, téléphone.
// Un vrai MP3 de test (3 s d'intro douce à 100 Hz, puis 5 notes de 1 s : 440, 660, 880, 660, 440 Hz) est joint à un exercice, modifié par
// l'interface avec de vrais événements, et les fichiers produits sont relus HORS du navigateur (ffmpeg) pour vérifier ce qu'ils contiennent.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_audio_edit_test.js   (serveur statique sur :8765, make_mp3.js déjà lancé)
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, exiger, plan, bilan } = harnais('TrainHub : Modifier le son');
const estBruitReseau = harnais.estBruitReseau;
plan(114);

const SHOTS = path.join(__dirname, 'shots');
const MEDIA = path.join(__dirname, 'media');
fs.mkdirSync(SHOTS, { recursive: true });
const SRC = path.join(MEDIA, 'backing_test.mp3');

// ---- analyse hors navigateur ----
function decode(file) {
    const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', '44100', '-'], { maxBuffer: 400e6 });
    return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
}
const SR = 44100;
const dureeDe = x => x.length / SR;
function rms(x, t0, t1) { let s = 0, n = 0; for (let i = Math.floor(t0 * SR); i < Math.min(x.length, Math.floor(t1 * SR)); i++) { s += x[i] * x[i]; n++; } return n ? Math.sqrt(s / n) : 0; }
function freq(x, t0, t1) { let z = 0, prev = 0; const a = Math.floor(t0 * SR), b = Math.min(x.length, Math.floor(t1 * SR)); for (let i = a; i < b; i++) { if (prev < 0 && x[i] >= 0) z++; prev = x[i]; } return z / ((b - a) / SR); }
const proche = (v, cible, tol) => Math.abs(v - cible) <= tol;

async function ouvrir(browser, { viewport = { width: 1280, height: 900 }, fichier = SRC, nom = 'Backing de test' } = {}) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', colorScheme: 'dark', permissions: ['microphone'] });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !estBruitReseau(m.text()) && !/ERR_FAILED/.test(m.text())) erreurs.push('console: ' + m.text()); });
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.addInitScript(() => {
        try { localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1'); } catch (e) { }
        // trace des sources audio démarrées (boucle ou non), pour vérifier l'écoute en boucle sans coupure
        window.__src = [];
        const orig = AudioContext.prototype.createBufferSource;
        AudioContext.prototype.createBufferSource = function () {
            const s = orig.apply(this, arguments), st = s.start;
            s.start = function () { window.__src.push({ loop: s.loop, ls: s.loopStart, le: s.loopEnd, offset: arguments[1], dur: arguments[2] }); return st.apply(this, arguments); };
            return s;
        };
    });
    await page.goto('http://localhost:8765/index.html');
    await page.waitForTimeout(500);
    const inp = page.locator('input[placeholder^="Ajouter un exercice"]').first();
    await inp.fill(nom); await inp.press('Enter');
    await page.waitForTimeout(300);
    await page.locator('.exercise .exercise-row-spacer').first().click();
    await page.waitForSelector('input.add-file-input', { state: 'attached' });
    await page.setInputFiles('input.add-file-input', fichier);
    await page.waitForSelector('.file-chip', { timeout: 8000 });
    await page.waitForTimeout(300);
    // un fichier tout juste ajouté s'ouvre en saisie de nom : on la referme sans rien changer
    if (await page.locator('.file-chip .link-label-input').count()) { await page.locator('.file-chip .link-label-input').first().press('Escape'); await page.waitForSelector('.file-chip .file-open'); }
    return { ctx, page, erreurs };
}
// les pièces jointes de l'état (nom, id, taille) et leur contenu dans IndexedDB
async function fichiers(page) {
    await page.waitForTimeout(700); // l'état est enregistré avec un léger délai
    return page.evaluate(() => {
        const st = JSON.parse(localStorage.getItem('trainhub.v1') || '{}'), out = [];
        (function walk(o) { if (!o || typeof o !== 'object') return; if (Array.isArray(o.files)) o.files.forEach(f => f && f.id && out.push({ id: f.id, name: f.name, type: f.type, size: f.size })); Object.keys(o).forEach(k => { if (k !== 'trash') walk(o[k]); }); })(st.instruments || st);
        return out;
    });
}
async function sauver(page, id, dest) {
    const b64 = await page.evaluate(id => new Promise((res, rej) => {
        const rq = indexedDB.open('trainhub-files', 1);
        rq.onsuccess = () => { const g = rq.result.transaction('files').objectStore('files').get(id); g.onsuccess = async () => { const b = g.result; if (!b) return res(null); const ab = await b.arrayBuffer(); let s = ''; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); res(btoa(s)); }; g.onerror = () => rej(g.error); };
        rq.onerror = () => rej(rq.error);
    }), id);
    if (!b64) return null;
    fs.writeFileSync(dest, Buffer.from(b64, 'base64'));
    return dest;
}
const panneau = page => page.locator('.audio-edit-panel');
const bouton = (page, re) => panneau(page).locator('button').filter({ hasText: re }).first();
const champs = page => panneau(page).locator('input.rec-wave-t');
async function ouvrirEditeur(page) {
    await page.click('.file-chip .link-edit-sound');
    await panneau(page).locator('canvas.rec-wave-cv').waitFor({ timeout: 15000 });
}
const rng = page => panneau(page).locator('.rec-wave-rng').innerText();

(async () => {
    const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
    const orig = decode(SRC);
    check(proche(dureeDe(orig), 8, 0.15) && freq(orig, 3.1, 3.9) > 420 && freq(orig, 3.1, 3.9) < 460, `0. le MP3 de test : ${dureeDe(orig).toFixed(2)} s, note 440 Hz après l'intro (${Math.round(freq(orig, 3.1, 3.9))} Hz)`);

    // ===================== A. Accès à l'éditeur =====================
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        const t = await page.locator('.file-chip .link-edit-sound').getAttribute('title');
        check(/Modifier le son/.test(t || ''), `A. la puce du fichier audio a ses ciseaux (${t})`);
        await page.locator('.file-chip .file-open').click({ button: 'right' });
        await page.waitForTimeout(200);
        const menu = await page.locator('.ctx-menu, .links-quick-menu, [role=menu]').allInnerTexts();
        check(menu.join('\n').includes('Modifier le son'), "A. le menu du fichier (clic droit) propose « Modifier le son… »");
        await page.keyboard.press('Escape');
        await page.mouse.click(5, 5);
        // le lecteur : ciseaux visibles pour un fichier
        await page.locator('.file-chip .file-open').click();
        await page.waitForSelector('.audio-player', { timeout: 5000 });
        check(await page.locator('.audio-edit-sound').isVisible(), "A. dans le lecteur audio, le bouton « Modifier le son » est là pour un fichier");
        await page.click('.audio-edit-sound');
        await panneau(page).locator('canvas.rec-wave-cv').waitFor({ timeout: 15000 });
        check(true, "A. et il ouvre l'éditeur sur le morceau en cours");
        const sub = await panneau(page).locator('.rec-edit-sub').innerText();
        check(/backing_test/.test(sub) && /0:08\.0/.test(sub) && /stéréo/.test(sub), `A. l'en-tête dit le fichier, sa durée et stéréo/mono (${sub})`);
        const lecteurEnPause = await page.evaluate(() => { const a = document.querySelector('audio'); return !a || a.paused; });
        check(lecteurEnPause, "A. le lecteur se met en pause à l'ouverture (un seul son à la fois)");
        const disabled = await panneau(page).locator('button.rec-save').isDisabled();
        check(disabled, "A. rien n'est modifié : « Enregistrer » est grisé");
        await page.screenshot({ path: path.join(SHOTS, 'edit-1-ouvert.png') });
        check(erreurs.length === 0, 'A. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ===================== B. Couper l'intro et enregistrer une copie =====================
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        const avant = await fichiers(page);
        await ouvrirEditeur(page);
        // début = 3 s (champ précis), fin = fin du fichier
        await champs(page).nth(0).fill('3');
        await champs(page).nth(0).press('Enter');
        let r = await rng(page);
        check(/Sélection 0:03\.0 → 0:08\.0 · 0:05\.0/.test(r), `B. le champ « début » pose la sélection : ${r.replace(/\n/g, ' ')}`);
        check(await champs(page).nth(0).inputValue() === '0:03.000' && /^0:08\.0\d\d$/.test(await champs(page).nth(1).inputValue()), `B. les champs affichent le début et la fin au millième : ${await champs(page).nth(0).inputValue()} → ${await champs(page).nth(1).inputValue()} (le MP3 décodé dure 8,05 s : délai de l'encodeur)`);
        // flèche haut = +0,01 s, Maj + flèche bas = −0,1 s
        await champs(page).nth(0).focus(); await champs(page).nth(0).press('ArrowUp');
        check(await champs(page).nth(0).inputValue() === '0:03.010', `B. ↑ avance le début de 0,01 s (${await champs(page).nth(0).inputValue()})`);
        await champs(page).nth(0).press('Shift+ArrowDown');
        check(await champs(page).nth(0).inputValue() === '0:02.910', `B. Maj+↓ recule de 0,1 s (${await champs(page).nth(0).inputValue()})`);
        await champs(page).nth(0).fill('3'); await champs(page).nth(0).press('Enter');
        check(await panneau(page).locator('button.rec-save').isEnabled(), "B. une sélection active « Enregistrer »");
        check(/Enregistrer la sélection \(0:05\.0\)/.test(await panneau(page).locator('.rec-save-lab').innerText()), "B. et le bouton annonce la durée gardée");
        await bouton(page, /^Garder$/).click();
        r = await rng(page);
        check(/^0:05\.0$/.test(r.trim()), `B. « Garder » : il reste 5,0 s (${r.trim()})`);
        await bouton(page, /^↶$/).click();
        check(/Sélection 0:03\.0 → 0:08\.0 · 0:05\.0/.test(await rng(page)), "B. « Annuler » rend les 8,0 s ET la sélection d'avant");
        await champs(page).nth(0).fill('3'); await champs(page).nth(0).press('Enter');
        await bouton(page, /^Garder$/).click();
        // nom + enregistrement
        const nom = await panneau(page).locator('input.rec-name').inputValue();
        check(nom === 'backing_test (modifié)', `B. nom proposé : « ${nom} »`);
        await panneau(page).locator('input.rec-name').fill('Sans intro');
        await page.screenshot({ path: path.join(SHOTS, 'edit-2-intro-coupee.png') });
        await panneau(page).locator('button.rec-save').click();
        await panneau(page).waitFor({ state: 'detached', timeout: 20000 });
        await page.waitForSelector('.toast', { timeout: 5000 });
        const toast = await page.locator('.toast').first().innerText();
        check(/Enregistré dans/.test(toast) && /Sans intro/.test(toast) && /0:05\.0/.test(toast), `B. message : ${toast.slice(0, 90)}`);
        const apres = await fichiers(page);
        check(apres.length === avant.length + 1, `B. un fichier de plus dans l'exercice (${avant.length} → ${apres.length})`);
        const chips = await page.locator('.file-chip .file-open').allInnerTexts();
        check(chips.length === 2 && chips[0].includes('backing_test') && chips[1].includes('Sans intro'), `B. l'original reste, la copie est à côté : ${JSON.stringify(chips)}`);
        const nouveau = apres.find(f => f.name === 'Sans intro');
        const out1 = await sauver(page, nouveau.id, path.join(MEDIA, 'out_sans_intro.mp3'));
        const x = decode(out1);
        check(proche(dureeDe(x), 5, 0.12), `B. le fichier produit dure ${dureeDe(x).toFixed(2)} s (attendu 5,0)`);
        check(nouveau.type === 'audio/mpeg' && /\.mp3$/.test(out1), `B. c'est un MP3 (${nouveau.type})`);
        const f1 = freq(x, 0.2, 0.8), f2 = freq(x, 1.2, 1.8), f3 = freq(x, 2.2, 2.8);
        check(proche(f1, 440, 25) && proche(f2, 660, 25) && proche(f3, 880, 25), `B. le contenu est bien la fin du morceau : ${Math.round(f1)}, ${Math.round(f2)}, ${Math.round(f3)} Hz (440, 660, 880)`);
        check(rms(x, 0, 0.5) > 0.2, `B. plus d'intro : le fichier démarre fort (RMS ${rms(x, 0, 0.5).toFixed(2)} contre ${rms(orig, 0, 0.5).toFixed(3)} à l'origine)`);
        const idOrig = avant[0].id;
        const origApres = await sauver(page, idOrig, path.join(MEDIA, 'orig_apres.mp3'));
        check(fs.readFileSync(origApres).equals(fs.readFileSync(SRC)), "B. le fichier d'origine est strictement inchangé");
        check(Math.abs(nouveau.size - fs.statSync(out1).size) < 5, `B. la taille enregistrée correspond au fichier (${nouveau.size} octets)`);
        check(erreurs.length === 0, 'B. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ===================== C. Garder une partie pour boucler : écoute en boucle, repères « ici », zoom =====================
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await ouvrirEditeur(page);
        const cv = panneau(page).locator('canvas.rec-wave-cv');
        const box = await cv.boundingBox();
        // clic à 25 % (≈ 2 s) puis « Début ici »
        await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
        await bouton(page, /^Début ici$/).click();
        const a1 = await champs(page).nth(0).inputValue();
        const sec1 = parseFloat(a1.split(':')[1]) + 60 * parseInt(a1.split(':')[0], 10);
        check(proche(sec1, 2, 0.15), `C. clic à 25 % + « Début ici » → début ${a1} (≈ 2 s)`);
        // clic à 75 % : DANS la sélection (2 s → fin) : le repère bouge, la sélection reste
        await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
        check(/Sélection/.test(await rng(page)), "C. un clic dans la sélection ne l'efface pas (seul le repère bouge)");
        await bouton(page, /^Fin ici$/).click();
        const b1 = await champs(page).nth(1).inputValue();
        const sec2 = parseFloat(b1.split(':')[1]) + 60 * parseInt(b1.split(':')[0], 10);
        check(proche(sec2, 6, 0.15) && proche(sec1, 2, 0.15), `C. clic à 75 % + « Fin ici » → ${a1} → ${b1}`);
        // on règle au centième : 4 s → 6 s
        await champs(page).nth(0).fill('4'); await champs(page).nth(0).press('Enter');
        await champs(page).nth(1).fill('6,0'); await champs(page).nth(1).press('Enter');
        check(await champs(page).nth(0).inputValue() === '0:04.000' && await champs(page).nth(1).inputValue() === '0:06.000', "C. début 4 s, fin 6 s (virgule décimale acceptée)");
        // un clic hors sélection l'efface
        await page.mouse.click(box.x + box.width * 0.05, box.y + box.height / 2);
        check(!/Sélection/.test(await rng(page)), "C. un clic hors de la sélection l'efface");
        await champs(page).nth(0).fill('4'); await champs(page).nth(0).press('Enter');
        await champs(page).nth(1).fill('6'); await champs(page).nth(1).press('Enter');
        // écoute en boucle
        await bouton(page, /Boucle/).click();
        check(await bouton(page, /Boucle/).getAttribute('aria-pressed') === 'true', "C. le bouton « Boucle » s'enclenche");
        await page.evaluate(() => { window.__src.length = 0; });
        await bouton(page, /Écouter/).click();
        await page.waitForTimeout(400);
        const srcs = await page.evaluate(() => window.__src.slice());
        const s = srcs[srcs.length - 1] || {};
        check(s.loop === true && proche(s.ls, 4, 0.002) && proche(s.le, 6, 0.002), `C. l'aperçu tourne EN BOUCLE sans coupure sur 4,00 → 6,00 s (${JSON.stringify(s)})`);
        check(/Arrêter/.test(await bouton(page, /Arrêter|Écouter/).innerText()), "C. pendant l'écoute, le bouton propose « Arrêter »");
        await bouton(page, /Arrêter/).click();
        await page.waitForTimeout(150);
        check(/Écouter/.test(await panneau(page).locator('.rec-wave-play').innerText()), "C. « Arrêter » arrête l'aperçu");
        await bouton(page, /Boucle/).click();
        // zoom sur la sélection : le repère et les clics suivent la partie visible
        await bouton(page, /^Sélection$/).click();
        check(/^zoom ×/.test((await panneau(page).locator('.rec-wave-zoomread').innerText()).trim()) && await panneau(page).locator('canvas.rec-wave-over').isVisible(), "C. zoomé : l'indication de zoom s'affiche, la vue d'ensemble montre la partie visible");
        check(await bouton(page, /^Tout voir$/).isEnabled(), "C. « Tout voir » est disponible une fois zoomé");
        await page.waitForTimeout(100);
        await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2); // milieu de la partie visible
        await bouton(page, /^Début ici$/).click();
        const mid = await champs(page).nth(0).inputValue();
        const secMid = parseFloat(mid.split(':')[1]);
        check(proche(secMid, 5, 0.25) && !proche(secMid, 4, 0.2), `C. zoomé, le milieu de l'écran est ≈ 5,0 s (pas 4,0 comme sans zoom) : ${mid}`);
        await page.screenshot({ path: path.join(SHOTS, 'edit-3-zoom-boucle.png') });
        await bouton(page, /^Tout voir$/).click();
        check(/tout le son/.test(await panneau(page).locator('.rec-wave-zoomread').innerText()), "C. « Tout voir » ramène la vue entière");
        // enregistrer la sélection 4 → 6 s sous un nom
        await champs(page).nth(0).fill('4'); await champs(page).nth(0).press('Enter');
        await champs(page).nth(1).fill('6'); await champs(page).nth(1).press('Enter');
        await panneau(page).locator('input.rec-name').fill('Boucle 2 s');
        await panneau(page).locator('button.rec-save').click();
        await panneau(page).waitFor({ state: 'detached', timeout: 20000 });
        const fs_ = await fichiers(page);
        const boucle = fs_.find(f => f.name === 'Boucle 2 s');
        const out2 = await sauver(page, boucle.id, path.join(MEDIA, 'out_boucle.mp3'));
        const y = decode(out2);
        check(proche(dureeDe(y), 2, 0.12), `C. la boucle enregistrée dure ${dureeDe(y).toFixed(2)} s (attendu 2,0)`);
        check(proche(freq(y, 0.1, 0.9), 660, 30) && proche(freq(y, 1.1, 1.9), 880, 30), `C. elle contient bien 660 puis 880 Hz : ${Math.round(freq(y, 0.1, 0.9))}, ${Math.round(freq(y, 1.1, 1.9))}`);
        // fondu de 5 ms : le tout premier échantillon est (presque) nul
        check(Math.abs(y[200]) < 0.15, `C. début adouci (fondu de 5 ms) : échantillon 200 = ${y[200].toFixed(3)}`);
        // le lecteur de l'appli ouvre bien ce nouveau fichier (en-têtes MP3 valides) et en connaît la durée
        await page.locator('.file-chip .file-open', { hasText: 'Boucle 2 s' }).click();
        await page.waitForFunction(() => { const a = document.querySelector('.audio-player audio, audio'); return a && a.readyState >= 1 && isFinite(a.duration); }, null, { timeout: 10000 });
        const durLecteur = await page.evaluate(() => document.querySelector('.audio-player audio, audio').duration);
        check(proche(durLecteur, 2.04, 0.1), `C. le lecteur de l'appli lit la boucle enregistrée : ${durLecteur.toFixed(2)} s`);
        check(erreurs.length === 0, 'C. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ===================== D. Couper un passage au milieu =====================
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await ouvrirEditeur(page);
        await champs(page).nth(0).fill('4'); await champs(page).nth(0).press('Enter');
        await champs(page).nth(1).fill('6'); await champs(page).nth(1).press('Enter');
        await bouton(page, /^Couper$/).click();
        check(/^0:06\.0$/.test((await rng(page)).trim()), `D. « Couper » retire 2 s : ${(await rng(page)).trim()}`);
        await panneau(page).locator('input.rec-name').fill('Sans le milieu');
        await panneau(page).locator('button.rec-save').click();
        await panneau(page).waitFor({ state: 'detached', timeout: 20000 });
        const f = (await fichiers(page)).find(z => z.name === 'Sans le milieu');
        const out = await sauver(page, f.id, path.join(MEDIA, 'out_coupe.mp3'));
        const z = decode(out);
        check(proche(dureeDe(z), 6, 0.12), `D. fichier de ${dureeDe(z).toFixed(2)} s`);
        check(proche(freq(z, 1.2, 1.8), 100, 15) && proche(freq(z, 3.2, 3.8), 440, 30) && proche(freq(z, 4.2, 4.8), 660, 30) && proche(freq(z, 5.2, 5.8), 440, 30), `D. la suite se raccorde (intro, 440, puis 660 et 440 d'après le passage coupé) : ${[1.5, 3.5, 4.5, 5.5].map(t => Math.round(freq(z, t - 0.3, t + 0.3))).join(', ')} Hz`);
        // le raccord (à 4,0 s) ne « claque » pas : aucun saut brutal entre deux échantillons voisins
        let saut = 0; for (let i = Math.floor(3.99 * SR); i < Math.floor(4.01 * SR); i++) saut = Math.max(saut, Math.abs(z[i + 1] - z[i]));
        check(saut < 0.25, `D. pas de clic au raccord : plus grand saut entre deux échantillons = ${saut.toFixed(3)} (une onde de 660 Hz à ce volume en fait au plus 0,06 ; un recollage brut ≈ 1)`);
        check(erreurs.length === 0, 'D. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ===================== E. Remplacer l'original ; fermer avec des modifications =====================
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        const avant = await fichiers(page);
        await ouvrirEditeur(page);
        await champs(page).nth(0).fill('3'); await champs(page).nth(0).press('Enter');
        // fermer avec une modification : confirmation, on peut rester
        await panneau(page).locator('button.rec-close').click();
        await page.waitForSelector('.app-dialog', { timeout: 3000 });
        check(/Abandonner/.test(await page.locator('.app-dialog-title').innerText()), "E. fermer avec une modification demande confirmation");
        await page.locator('.app-dialog button', { hasText: /Annuler/ }).click();
        check(await panneau(page).isVisible(), "E. « Annuler » : la fenêtre reste ouverte, rien n'est perdu");
        await bouton(page, /^Garder$/).click();
        const libs = await panneau(page).locator('select.rec-dest option').allInnerTexts();
        check(libs.map(l => l.trim()).join('|') === 'Nouveau fichier|Remplacer fichier|Autre exercice…', `E. la liste « Où ranger » est courte : ${JSON.stringify(libs)}`);
        await panneau(page).locator('select.rec-dest').selectOption('replace');
        check(await panneau(page).locator('input.rec-name').inputValue() === 'backing_test', "E. en mode « remplacer », le nom proposé est celui de l'original");
        await panneau(page).locator('button.rec-save').click();
        await page.waitForSelector('.app-dialog', { timeout: 3000 });
        check(/Remplacer l'original/.test(await page.locator('.app-dialog-title').innerText()), "E. remplacer l'original demande confirmation");
        await page.locator('.app-dialog button', { hasText: /^Remplacer$/ }).click();
        await panneau(page).waitFor({ state: 'detached', timeout: 20000 });
        const apres = await fichiers(page);
        check(apres.length === 1 && apres[0].id !== avant[0].id && apres[0].name === 'backing_test', `E. un seul fichier, nouveau, au même nom (${JSON.stringify(apres.map(a => a.name))})`);
        const anc = await sauver(page, avant[0].id, path.join(MEDIA, 'ancien.mp3'));
        check(anc === null, "E. l'ancien fichier a disparu de cet appareil");
        const out = await sauver(page, apres[0].id, path.join(MEDIA, 'out_remplace.mp3'));
        check(proche(dureeDe(decode(out)), 5, 0.12), `E. le remplaçant dure ${dureeDe(decode(out)).toFixed(2)} s`);
        // fermer sans modification : aucune confirmation
        await page.locator('.file-chip .link-edit-sound').click();
        await panneau(page).locator('canvas.rec-wave-cv').waitFor({ timeout: 15000 });
        await panneau(page).locator('button.rec-close').click();
        await page.waitForTimeout(300);
        check(!(await panneau(page).count()), "E. fermer sans modification : se ferme tout de suite");
        check(erreurs.length === 0, 'E. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ===================== F. Vers un autre exercice =====================
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        // un deuxième exercice
        const inp = page.locator('input[placeholder^="Ajouter un exercice"]').first();
        await inp.fill('Autre exercice'); await inp.press('Enter'); await page.waitForTimeout(300);
        await ouvrirEditeur(page);
        await champs(page).nth(0).fill('3'); await champs(page).nth(0).press('Enter');
        await panneau(page).locator('select.rec-dest').selectOption('pick');
        await page.waitForSelector('.exercise-picker-panel', { timeout: 5000 });
        await page.locator('.exercise-picker-panel .gs-pick-fold-btn[data-fold="open"]').click(); // le choix est replié au départ (état retenu) : on ouvre les dossiers
        await page.locator('.exercise-picker-panel').getByText('Autre exercice', { exact: false }).first().click();
        await page.waitForTimeout(300);
        const lib = await panneau(page).locator('select.rec-dest option:checked').innerText();
        check(/Autre exercice/.test(lib), `F. destination : ${lib}`);
        await panneau(page).locator('button.rec-save').click();
        await panneau(page).waitFor({ state: 'detached', timeout: 20000 });
        const toast = await page.locator('.toast').first().innerText();
        check(/Autre exercice/.test(toast), `F. rangé dans l'autre exercice : ${toast.slice(0, 80)}`);
        const tout = await fichiers(page);
        check(tout.length === 2, `F. l'original reste et la copie est dans l'autre exercice (${tout.length} fichiers)`);
        check(erreurs.length === 0, 'F. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ===================== J. Remplacer un morceau qui est dans la liste du lecteur =====================
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await page.locator('.file-chip .file-open').click({ button: 'right' });
        await page.locator('text=Ajouter à la liste de lecture').first().click();
        await page.waitForSelector('.audio-player', { timeout: 5000 });
        await page.waitForTimeout(300);
        const onglets0 = await page.locator('.audio-tab').allInnerTexts();
        await ouvrirEditeur(page);
        await champs(page).nth(0).fill('3'); await champs(page).nth(0).press('Enter');
        await bouton(page, /^Garder$/).click();
        await panneau(page).locator('select.rec-dest').selectOption('replace');
        await panneau(page).locator('input.rec-name').fill('Morceau sans intro');
        await panneau(page).locator('button.rec-save').click();
        await page.locator('.app-dialog button', { hasText: /^Remplacer$/ }).click();
        await panneau(page).waitFor({ state: 'detached', timeout: 20000 });
        await page.waitForTimeout(600);
        const noms = (await fichiers(page)).map(f => f.name);
        check(noms.length === 1 && noms[0] === 'Morceau sans intro', `J. un seul fichier dans l'exercice : ${JSON.stringify(noms)}`);
        const onglets = await page.locator('.audio-tab').allInnerTexts().catch(() => []);
        const joue = await page.locator('.audio-title').innerText().catch(() => '');
        check((onglets.join(' ') + ' ' + joue).includes('Morceau sans intro') && !(onglets.join(' ') + ' ' + joue).includes('backing_test'), `J. le lecteur suit : l'ancien morceau est remplacé par le nouveau (onglets ${JSON.stringify(onglets0)} → ${JSON.stringify(onglets)}, titre « ${joue} »)`);
        check(!(await page.locator('.audio-player-error:visible').count()), "J. et aucun message d'erreur n'apparaît dans le lecteur");
        check(erreurs.length === 0, 'J. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ===================== G. Un son trop long est refusé AVANT de décoder =====================
    {
        const long = path.join(MEDIA, 'long_11min.mp3');
        if (!fs.existsSync(long)) execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=22050', '-t', '660', '-ac', '1', '-b:a', '24k', long]);
        const { ctx, page, erreurs } = await ouvrir(browser, { fichier: long });
        await page.click('.file-chip .link-edit-sound');
        await panneau(page).locator('.rec-msg-err').waitFor({ timeout: 15000 });
        const m = await panneau(page).locator('.rec-msg').innerText();
        check(/11:00/.test(m) && /10 min/.test(m), `G. 11 minutes : refusé avec la raison (${m.slice(0, 100)})`);
        check(await panneau(page).locator('canvas.rec-wave-cv').count() === 0, "G. et aucune forme d'onde n'est construite");
        check(erreurs.length === 0, 'G. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ===================== H. Téléphone 390 px =====================
    {
        const { ctx, page, erreurs } = await ouvrir(browser, { viewport: { width: 390, height: 844 } });
        await ouvrirEditeur(page);
        await champs(page).nth(0).fill('3'); await champs(page).nth(0).press('Enter');
        await page.waitForTimeout(300);
        const g = await page.evaluate(() => {
            const p = document.querySelector('.audio-edit-panel'), r = p.getBoundingClientRect();
            const wide = Array.from(p.querySelectorAll('*')).filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > r.right + 1 || b.left < r.left - 1); }).map(e => e.className || e.tagName).slice(0, 5);
            return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), sw: p.scrollWidth - p.clientWidth, doc: document.documentElement.scrollWidth - innerWidth, wide };
        });
        check(g.l >= 0 && g.r <= 390 && g.sw <= 0 && g.doc <= 0 && g.wide.length === 0, `H. téléphone : la fenêtre tient dans 390 px, sans rien qui déborde (${JSON.stringify(g)})`);
        const tailles = await page.evaluate(() => Array.from(document.querySelectorAll('.audio-edit-panel button, .audio-edit-panel input.rec-wave-t')).map(e => Math.round(e.getBoundingClientRect().height)));
        check(Math.min(...tailles) >= 28, `H. les commandes se visent au doigt (hauteur mini ${Math.min(...tailles)} px)`);
        await page.screenshot({ path: path.join(SHOTS, 'edit-4-telephone.png') });
        await panneau(page).evaluate(p => p.scrollTo(0, p.scrollHeight));
        await page.screenshot({ path: path.join(SHOTS, 'edit-5-telephone-bas.png') });
        check(erreurs.length === 0, 'H. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ===================== I. L'enregistreur n'a pas bougé (même éditeur, version sobre) =====================
    {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', permissions: ['microphone'] });
        const page = await ctx.newPage();
        const erreurs = [];
        page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
        page.on('console', m => { if (m.type() === 'error' && !estBruitReseau(m.text()) && !/ERR_FAILED/.test(m.text())) erreurs.push('console: ' + m.text()); });
        await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
        await page.addInitScript(() => { try { localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1'); } catch (e) { } });
        await page.goto('http://localhost:8765/index.html');
        await page.waitForTimeout(500);
        await page.click('#rec-btn');
        await page.waitForSelector('.recorder-panel .rec-go');
        await page.waitForTimeout(500);
        await page.click('.recorder-panel .rec-go');
        await page.waitForTimeout(2200);
        await page.click('.recorder-panel .rec-go');
        await page.locator('.recorder-panel canvas.rec-wave-cv').waitFor({ timeout: 15000 });
        const n = await page.locator('.recorder-panel .rec-wave-tools button').allInnerTexts();
        check(n.map(t => t.trim()).join('|') === '▶ Écouter|⟲ Boucle|Écouter la coupe|Tout|Garder|Couper|↶', `I. enregistreur : la même barre d'outils que « Modifier le son » (${JSON.stringify(n)})`);
        check(await page.locator('.recorder-panel .rec-wave-edges').count() === 1 && await page.locator('.recorder-panel .rec-wave-zoom').count() === 1 && await page.locator('.recorder-panel canvas.rec-wave-ruler').count() === 1 && await page.locator('.recorder-panel canvas.rec-wave-over').count() === 1, "I. enregistreur : mêmes outils précis que le ciseau (zoom, début/fin, règle de temps, vue d'ensemble)");
        const dur0 = (await page.locator('.recorder-panel .rec-wave-rng').innerText()).trim();
        await page.locator('.recorder-panel button').filter({ hasText: /^Tout$/ }).click();
        await page.locator('.recorder-panel button').filter({ hasText: /^Garder$/ }).click();
        check(/^0:0\d\.\d$/.test((await page.locator('.recorder-panel .rec-wave-rng').innerText()).trim()), `I. enregistreur : sélectionner / garder fonctionnent (${dur0})`);
        const cv = page.locator('.recorder-panel canvas.rec-wave-cv'); const bx = await cv.boundingBox();
        await page.mouse.move(bx.x + bx.width * 0.2, bx.y + 40); await page.mouse.down(); await page.mouse.move(bx.x + bx.width * 0.6, bx.y + 40, { steps: 6 }); await page.mouse.up();
        check(/Sélection/.test(await page.locator('.recorder-panel .rec-wave-rng').innerText()), "I. enregistreur : on sélectionne à la souris");
        await page.locator('.recorder-panel button').filter({ hasText: /^Couper$/ }).click();
        check(!/Sélection/.test(await page.locator('.recorder-panel .rec-wave-rng').innerText()), "I. enregistreur : couper fonctionne");
        await page.locator('.recorder-panel button').filter({ hasText: /^↶$/ }).click();
        await page.screenshot({ path: path.join(SHOTS, 'edit-6-enregistreur.png') });
        check(erreurs.length === 0, 'I. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ===================== K. Le clavier est à « Modifier le son » (v277) ; le volume agit pendant l'écoute =====================
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await page.click('#metronome-btn');                       // un métronome ouvert derrière : l'Espace ne doit PAS le lancer
        await page.waitForSelector('.metro-play-btn-big', { timeout: 5000 });
        const metro = () => page.locator('.metro-play-btn-big').first().innerText();
        const bpm = () => page.locator('.metro-dial-value').first().innerText();
        const bpm0 = await bpm();
        await page.evaluate(() => document.querySelector('.file-chip .link-edit-sound').click()); // le panneau du métronome (au centre) recouvre le ciseau : clic direct
        await panneau(page).locator('canvas.rec-wave-cv').waitFor({ timeout: 15000 });
        await page.evaluate(() => { window.__gains = []; const o = AudioContext.prototype.createGain; AudioContext.prototype.createGain = function () { const g = o.apply(this, arguments); window.__gains.push(g); return g; }; });
        await page.locator('.audio-edit-panel .rec-wave-rng').click();        // focus sur du neutre dans la fenêtre (pas un champ de saisie)
        await page.locator('.audio-edit-panel').evaluate(el => document.activeElement && document.activeElement.blur());
        check(/Jouer/.test(await metro()), "K. départ : le métronome n'est pas lancé");
        await page.keyboard.press('Space');
        await page.waitForTimeout(500);
        check(/Jouer/.test(await metro()), "K. Espace dans « Modifier le son » : le métronome du fond ne se lance PAS");
        check(/Arrêter/.test(await panneau(page).locator('.rec-wave-play').innerText()), "K. … c'est l'aperçu de l'éditeur qui démarre (« Arrêter » proposé)");
        // volume pendant l'écoute
        const gain = () => page.evaluate(() => { const g = window.__gains; return g.length ? g[g.length - 1].gain.value : null; });
        const g0 = await gain();
        await panneau(page).locator('input.rec-wave-vrange').fill('12'); await page.waitForTimeout(400);
        const g1 = await gain();
        await panneau(page).locator('input.rec-wave-vrange').fill('-12'); await page.waitForTimeout(400);
        const g2 = await gain();
        check(g0 !== null && Math.abs(g0 - 1) < 0.02, `K. aperçu à 0 dB : gain ${g0 && g0.toFixed(2)}`);
        check(Math.abs(g1 - 3.98) < 0.1 && Math.abs(g2 - 0.251) < 0.02, `K. la barre « Volume » agit PENDANT l'écoute : +12 dB → ${g1 && g1.toFixed(2)} (3,98), −12 dB → ${g2 && g2.toFixed(3)} (0,251)`);
        await page.locator('.audio-edit-panel').evaluate(el => document.activeElement && document.activeElement.blur());
        await page.keyboard.press('Space'); await page.waitForTimeout(300);
        check(/Écouter/.test(await panneau(page).locator('.rec-wave-play').innerText()) && /Jouer/.test(await metro()), "K. un second Espace arrête l'aperçu (toujours sans toucher au métronome)");
        // flèches : le tempo du métronome ne bouge pas
        await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
        check(await bpm() === bpm0, `K. flèches ↑ ↑ dans « Modifier le son » : le tempo du métronome reste à ${bpm0} (${await bpm()})`);
        // Ctrl/⌘ + Z : annule la dernière coupe de l'éditeur (pas l'annulation de l'appli)
        await champs(page).nth(0).fill('3'); await champs(page).nth(0).press('Enter');
        await bouton(page, /^Garder$/).click();
        const apresGarder = (await rng(page)).trim();
        await page.locator('.audio-edit-panel').evaluate(el => document.activeElement && document.activeElement.blur());
        await page.keyboard.press('Control+z'); await page.waitForTimeout(250);
        const apresZ = (await rng(page)).trim();
        check(apresGarder !== apresZ, `K. Ctrl+Z annule la dernière coupe de l'éditeur (${apresGarder} → ${apresZ})`);
        // saisie de texte : les touches gardent leur rôle (Espace dans le nom)
        await panneau(page).locator('input.rec-name').fill('A');
        await panneau(page).locator('input.rec-name').press('Space');
        check((await panneau(page).locator('input.rec-name').inputValue()) === 'A ' && /Jouer/.test(await metro()), "K. dans le champ du nom, l'Espace écrit une espace (et ne lance rien)");
        // fermée : le clavier est rendu à l'appli
        await panneau(page).locator('button.rec-close').click();
        await page.locator('.app-dialog button', { hasText: /Abandonner/ }).click().catch(() => {});
        await panneau(page).waitFor({ state: 'detached', timeout: 5000 });
        await page.evaluate(() => document.activeElement && document.activeElement.blur());
        await page.keyboard.press('Space'); await page.waitForTimeout(400);
        check(/Arrêter/.test(await metro()), "K. éditeur fermé : l'Espace relance le métronome comme avant");
        check(erreurs.length === 0, 'K. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }


    // ===================== L. Éditeur précis (v278) : règle, vue d'ensemble, zoom à 5 ms, repère au clavier et à la souris =====================
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        await ouvrirEditeur(page);
        const P = panneau(page), zoomTxt = () => P.locator('.rec-wave-zoomread').innerText(), headTxt = async () => (await P.locator('.rec-wave-headread').innerText()).replace('Repère', '').trim();
        const tOf = v => { const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(String(v).trim()); return m ? +m[1] * 60 + parseFloat(m[2]) : NaN; };
        check(await P.locator('canvas.rec-wave-ruler').count() === 1 && await P.locator('canvas.rec-wave-cv').count() === 1 && await P.locator('canvas.rec-wave-over').count() === 1 && await P.locator('.rec-wave-grp').count() === 2, "L. règle de temps, forme d'onde, vue d'ensemble, et deux groupes de boutons (écoute · modification)");
        check(await bouton(page, /^Aimanter$/).getAttribute('aria-pressed') === 'true', "L. « Aimanter » est activé par défaut");
        // zoom jusqu'à 5 ms
        for (let i = 0; i < 40 && await bouton(page, /^\+$/).isEnabled(); i++) await bouton(page, /^\+$/).click();
        const zmax = parseFloat(/zoom ×([\d.]+)/.exec(await zoomTxt())[1]);
        check(zmax >= 1000, `L. zoom maximal : ×${zmax} (≈ 5 ms visibles sur 8 s : ×1600)`);
        check(await bouton(page, /^\+$/).isDisabled() && await bouton(page, /^−$/).isEnabled(), "L. au zoom maximal « + » est grisé, « − » reste disponible");
        await bouton(page, /^Tout voir$/).click();
        // clavier : la forme d'onde a le focus
        const cv = P.locator('canvas.rec-wave-cv');
        await cv.focus();
        await page.keyboard.press('Home');
        check(await headTxt() === '0:00.000', `L. Début : repère à 0:00.000 (${await headTxt()})`);
        for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
        check(await headTxt() === '0:00.030', `L. → ×3 : +30 ms (${await headTxt()})`);
        await page.keyboard.press('Shift+ArrowRight');
        check(await headTxt() === '0:00.130', `L. Maj + → : +100 ms (${await headTxt()})`);
        await page.keyboard.press('Alt+ArrowRight');
        check(await headTxt() === '0:00.131', `L. Alt + → : +1 ms (${await headTxt()})`);
        await page.keyboard.press('End');
        check(/^0:08\.0\d\d$/.test(await headTxt()), `L. Fin : repère au bout du son (${await headTxt()})`);
        await page.keyboard.press('+');
        check(/^zoom ×/.test((await zoomTxt()).trim()), `L. la touche + zoome (${(await zoomTxt()).trim()})`);
        await page.keyboard.press('-');
        check(/tout le son/.test(await zoomTxt()), `L. la touche − dézoome (${(await zoomTxt()).trim()})`);
        // on attrape le repère à la souris
        await page.keyboard.press('Home');
        const bx = await cv.boundingBox();
        await page.mouse.move(bx.x + 2, bx.y + 80); await page.mouse.down(); await page.mouse.move(bx.x + bx.width * 0.5, bx.y + 80, { steps: 8 }); await page.mouse.up();
        const th = tOf(await headTxt());
        check(th > 3.9 && th < 4.2, `L. glisser le repère rouge : il suit la souris (${await headTxt()} ≈ 4,0 s)`);
        // vue d'ensemble : un clic recentre la partie zoomée
        await bouton(page, /^\+$/).click(); await bouton(page, /^\+$/).click();
        const fin = t => tOf(/→\s*([\d:.]+)/.exec(t)[1]);
        const f0 = fin(await zoomTxt());
        const ob = await P.locator('canvas.rec-wave-over').boundingBox();
        await page.mouse.click(ob.x + ob.width * 0.9, ob.y + ob.height / 2);
        const f1 = fin(await zoomTxt());
        check(f1 > f0 + 2, `L. clic sur la vue d'ensemble : la partie visible se déplace (fin ${f0.toFixed(2)} → ${f1.toFixed(2)} s)`);
        // règle : glisser = se déplacer
        const rb = await P.locator('canvas.rec-wave-ruler').boundingBox();
        const d0 = tOf(/zoom ×[\d.]+ · ([\d:.]+)/.exec(await zoomTxt())[1]);
        await page.mouse.move(rb.x + rb.width * 0.4, rb.y + 10); await page.mouse.down(); await page.mouse.move(rb.x + rb.width * 0.8, rb.y + 10, { steps: 6 }); await page.mouse.up(); // la vue est au bout : on la tire vers la gauche du son
        const d1 = tOf(/zoom ×[\d.]+ · ([\d:.]+)/.exec(await zoomTxt())[1]);
        check(Math.abs(d1 - d0) > 0.3, `L. glisser la règle déplace la partie visible (début ${d0.toFixed(2)} → ${d1.toFixed(2)} s)`);
        check(erreurs.length === 0, 'L. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    // ===================== M. Aimantation au passage par zéro, « Écouter la coupe » (v278) — un sinus de 30 Hz : passages par zéro tous les 1/60 s =====================
    {
        const SINE = path.join(os.tmpdir(), 'trainhub_sinus30.wav');
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=30:duration=4:sample_rate=44100', '-ac', '2', SINE]);
        const { ctx, page, erreurs } = await ouvrir(browser, { fichier: SINE, nom: 'Sinus' });
        await ouvrirEditeur(page);
        const P = panneau(page), cv = P.locator('canvas.rec-wave-cv'), bx = await cv.boundingBox();
        const tOf = v => { const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(String(v).trim()); return m ? +m[1] * 60 + parseFloat(m[2]) : NaN; };
        const frac = t => t * 60 - Math.round(t * 60);                   // 0 = pile sur un passage par zéro, ±0,5 = au milieu de deux
        const xAt = t => bx.x + t / 4 * bx.width;
        const glisser = async (ta, tb) => { await page.mouse.move(xAt(ta), bx.y + 90); await page.mouse.down(); await page.mouse.move(xAt(tb), bx.y + 90, { steps: 10 }); await page.mouse.up(); };
        const ta = 60.5 / 60, tb = 180.5 / 60;                            // deux points choisis AU MILIEU de deux passages par zéro
        await glisser(ta, tb);
        const a1 = tOf(await champs(page).nth(0).inputValue()), b1 = tOf(await champs(page).nth(1).inputValue());
        check(Math.abs(frac(a1)) < 0.05 && Math.abs(frac(b1)) < 0.05, `M. aimantation active : début ${a1.toFixed(3)} s et fin ${b1.toFixed(3)} s tombent sur des passages par zéro (écarts ${frac(a1).toFixed(2)} / ${frac(b1).toFixed(2)} demi-période)`);
        // « Écouter la coupe » : 0,5 s avant + 0,5 s après, collées
        await page.evaluate(() => { window.__src.length = 0; });
        await bouton(page, /^Écouter la coupe$/).click(); await page.waitForTimeout(400);
        const src = await page.evaluate(() => window.__src.slice(-1)[0]);
        check(src && src.loop === false && Math.abs(src.offset) < 0.01 && Math.abs(src.dur - 1.0) < 0.05, `M. « Écouter la coupe » joue un raccord de 1,0 s sans boucle (${JSON.stringify(src)})`);
        check(/Arrêter/.test(await P.locator('.rec-wave-play').innerText()), "M. … et le bouton d'écoute propose « Arrêter » pendant ce temps");
        await P.locator('.rec-wave-play').click(); await page.waitForTimeout(200);
        // aimantation coupée : le point tombe où on a cliqué
        await bouton(page, /^Aimanter$/).click();
        check(await bouton(page, /^Aimanter$/).getAttribute('aria-pressed') === 'false' && await page.evaluate(() => localStorage.getItem('trainhub.audioSnap.v1')) === '0', "M. « Aimanter » se désactive, et le choix est mémorisé");
        await page.mouse.click(xAt(3.7), bx.y + 90); // un clic à l'écart efface la sélection (sinon le départ à 8 ms d'une poignée l'attraperait)
        await glisser(ta, tb);
        const a2 = tOf(await champs(page).nth(0).inputValue()), b2 = tOf(await champs(page).nth(1).inputValue());
        check(Math.abs(Math.abs(frac(a2)) - 0.5) < 0.12 && Math.abs(Math.abs(frac(b2)) - 0.5) < 0.12, `M. aimantation coupée : début ${a2.toFixed(3)} s et fin ${b2.toFixed(3)} s restent là où l'on a cliqué (écarts ${frac(a2).toFixed(2)} / ${frac(b2).toFixed(2)})`);
        // Maj enfoncé : poignée dix fois plus lente (on tire la poignée de début de 100 px : le début bouge d'environ 10 px)
        const dx = 100, avant = a2, hx = xAt(a2);
        await page.mouse.move(hx, bx.y + 90); await page.mouse.down(); await page.keyboard.down('Shift'); await page.mouse.move(hx + dx, bx.y + 90, { steps: 10 }); await page.keyboard.up('Shift'); await page.mouse.up();
        const a3 = tOf(await champs(page).nth(0).inputValue()), pxSec = 4 / bx.width;
        check(a3 > avant && Math.abs((a3 - avant) / pxSec - dx * 0.1) < 4, `M. Maj + glisser : poignée dix fois plus lente (${((a3 - avant) / pxSec).toFixed(1)} px au lieu de ${dx})`);
        check(erreurs.length === 0, 'M. aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }

    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
