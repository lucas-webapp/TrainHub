// Dé de gammes ET dé d'harmonie : tirage « truqué » pour apprendre — sans remise (les 12 tonalités avant qu'une revienne), sac retenu sur l'appareil.
// Le banc charge script.js avec un crochet de test (injecté à la volée, le fichier du dépôt n'est pas modifié) pour appeler diceDraw directement.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_de_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : dés de gammes et d\'harmonie — tirage sans remise, toutes les tonalités, mémoire retenue');
plan(19);
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'script.js'), 'utf8');
const fin = SRC.lastIndexOf('})();');
const PATCHE = SRC.slice(0, fin) + ';window.__d={diceDraw:diceDraw,diceNewMem:diceNewMem,diceNormCfg:diceNormCfg,dicePickLines:dicePickLines,harmDraw:harmDraw,harmNewMem:harmNewMem,harmNormCfg:harmNormCfg,harmAllProgIds:harmAllProgIds};' + SRC.slice(fin);

async function ouvrir(browser) {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
    await page.route('**/script.js', r => r.fulfill({ body: PATCHE, contentType: 'application/javascript' }));
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
    await page.addInitScript(() => { try { localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1'); } catch (e) { } });
    await page.goto('http://localhost:8765/index.html');
    await page.waitForTimeout(700);
    return { ctx, page, erreurs };
}
const tirer = (page, n, o = {}) => page.evaluate(({ n, o }) => {
    const D = window.__d, cfg = D.diceNormCfg(o.cfg || { on: { key: true, scale: true, mode: false, notes: false }, scale: ['major', 'aeolian'] });
    const mem = D.diceNewMem(), out = [];
    for (let i = 0; i < n; i++) { const p = D.diceDraw(cfg, mem); out.push({ key: p.key, scale: p.scale, mode: p.mode, label: D.dicePickLines(p).map(x => x.label).join(' ') }); }
    return out;
}, { n, o });

(async () => {
    const browser = await chromium.launch();
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        let t = await tirer(page, 12);
        check(new Set(t.map(x => x.key)).size === 12, `les 12 premiers tirages donnent les 12 tonalités, chacune une fois (${t.map(x => x.key).join(' ')})`);
        await page.evaluate(() => localStorage.removeItem('trainhub.diceBag.v1'));
        t = await tirer(page, 48);
        const cpt = {}; t.forEach(x => cpt[x.key] = (cpt[x.key] || 0) + 1);
        check(Object.keys(cpt).length === 12 && Object.values(cpt).every(c => c === 4), `sur 48 tirages, chaque tonalité sort exactement 4 fois (${JSON.stringify(cpt)})`);
        await page.evaluate(() => localStorage.removeItem('trainhub.diceBag.v1'));
        t = await tirer(page, 6000);
        let ecartMin = 99; const vu = {};
        t.forEach((x, i) => { if (vu[x.key] !== undefined) ecartMin = Math.min(ecartMin, i - vu[x.key]); vu[x.key] = i; });
        check(ecartMin >= 4, `une tonalité ne revient jamais avant 4 tirages, tours compris (écart minimal ${ecartMin} sur 6000 tirages)`);
        check(t.every((x, i) => i === 0 || x.scale !== t[i - 1].scale), 'majeur et mineur naturel alternent : jamais deux fois la même gamme de suite');
        const labels = new Set(t.map(x => x.label));
        check(labels.size === 24, `les 24 gammes (12 majeures + 12 mineures naturelles) sont toutes sorties (${labels.size})`);
        const maj = [...labels].filter(l => /Majeur/.test(l)).map(l => l.split(' ')[0]).sort().join(',');
        check(maj === ['A', 'A♭', 'B', 'B♭', 'C', 'D', 'D♭', 'E', 'E♭', 'F', 'F♯', 'G'].sort().join(','), 'les 12 majeures du cercle des quintes : ' + maj);
        // l'ordre varie d'un tour à l'autre (ce n'est pas un cycle fixe)
        const tours = []; for (let i = 0; i < 6; i++) tours.push(t.slice(i * 12, i * 12 + 12).map(x => x.key).join());
        check(new Set(tours).size > 1, 'l\'ordre des tonalités change d\'un tour à l\'autre');
        // mémoire retenue : 5 tirages, rechargement de la page, 7 tirages : le tour continue
        await page.evaluate(() => localStorage.removeItem('trainhub.diceBag.v1'));
        const avant = await tirer(page, 5);
        await page.reload(); await page.waitForTimeout(700);
        const apres = await tirer(page, 7);
        check(new Set(avant.concat(apres).map(x => x.key)).size === 12, 'après un rechargement de l\'appli, le tour des 12 tonalités continue là où il en était');
        // plusieurs dés : mode ≠ gamme, tous les modes passent
        const m = await tirer(page, 70, { cfg: { on: { key: true, scale: true, mode: true, notes: false }, scale: ['major', 'aeolian'], mode: ['major', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian'] } });
        check(m.every(x => x.mode !== x.scale), 'le mode tiré n\'est jamais le même que la gamme (pas de « Majeur · Ionien »)');
        check(new Set(m.slice(0, 14).map(x => x.mode)).size >= 6, 'les modes tournent aussi sans remise (au moins 6 sur 14 tirages)');
        // réglage restreint : 3 tonalités seulement
        await page.evaluate(() => localStorage.removeItem('trainhub.diceBag.v1'));
        const r = await tirer(page, 30, { cfg: { on: { key: true, scale: false, mode: false, notes: false }, key: [true, false, false, false, true, false, false, true, false, false, false, false] } });
        check(r.every(x => [0, 4, 7].includes(x.key)) && new Set(r.slice(0, 3).map(x => x.key)).size === 3, 'avec 3 tonalités cochées (C, E, G), seules celles-ci sortent, une fois chacune par tour');
        // une face décochée en cours de route : le sac s'adapte
        const s = await page.evaluate(() => { const D = window.__d, mem = D.diceNewMem(); const c1 = D.diceNormCfg({ on: { key: true, scale: false, mode: false, notes: false } }); D.diceDraw(c1, mem); D.diceDraw(c1, mem);
            const c2 = D.diceNormCfg({ on: { key: true, scale: false, mode: false, notes: false }, key: [true, true, true, true, false, false, false, false, false, false, false, false] }); const o = []; for (let i = 0; i < 12; i++) o.push(D.diceDraw(c2, mem).key); return o; });
        check(s.every(k => k < 4) && s.length === 12, 'un réglage modifié ne casse pas le tirage (' + s.join(' ') + ')');
        check(erreurs.length === 0, 'aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }
    // ===== Dé d'harmonie : le même tirage sans remise (v260) =====
    {
        const { ctx, page, erreurs } = await ouvrir(browser);
        const hTirer = (n, o = {}) => page.evaluate(({ n, o }) => {
            const D = window.__d, ids = D.harmAllProgIds().slice(0, o.nProg || 6);
            const cfg = D.harmNormCfg(Object.assign({ on: { key: true, prog: false, chord: false, cons: false }, prog: ids, chord: ['triad', 'tetrad', 'ext'] }, o.cfg || {}));
            const mem = D.harmNewMem(), out = [];
            for (let i = 0; i < n; i++) out.push(D.harmDraw(cfg, mem));
            return out;
        }, { n, o });
        await page.evaluate(() => localStorage.removeItem('trainhub.diceBag.v1'));
        let t = await hTirer(12);
        check(new Set(t.map(x => x.key)).size === 12, `harmonie : les 12 premiers tirages donnent les 12 tonalités, chacune une fois (${t.map(x => x.key).join(' ')})`);
        await page.evaluate(() => localStorage.removeItem('trainhub.diceBag.v1'));
        t = await hTirer(6000);
        let ecart = 99; const vu = {};
        t.forEach((x, i) => { if (vu[x.key] !== undefined) ecart = Math.min(ecart, i - vu[x.key]); vu[x.key] = i; });
        const cpt = {}; t.slice(0, 48).forEach(x => cpt[x.key] = (cpt[x.key] || 0) + 1);
        check(Object.keys(cpt).length === 12 && Object.values(cpt).every(c => c === 4), `harmonie : sur 48 tirages, chaque tonalité sort exactement 4 fois (${JSON.stringify(cpt)})`);
        check(ecart >= 4, `harmonie : une tonalité ne revient jamais avant 4 tirages, tours compris (écart minimal ${ecart})`);
        await page.evaluate(() => localStorage.removeItem('trainhub.diceBag.v1'));
        const pr = await hTirer(18, { cfg: { on: { key: false, prog: true, chord: false, cons: false } } });
        const cp = {}; pr.forEach(x => cp[x.prog] = (cp[x.prog] || 0) + 1);
        check(Object.keys(cp).length === 6 && Object.values(cp).every(c => c === 3), `harmonie : 6 progressions, 18 tirages : chacune exactement 3 fois (${JSON.stringify(cp)})`);
        await page.evaluate(() => localStorage.removeItem('trainhub.diceBag.v1'));
        const avant = await hTirer(5), apres = await (async () => { await page.reload(); await page.waitForTimeout(700); return hTirer(7); })();
        check(new Set(avant.concat(apres).map(x => x.key)).size === 12, 'harmonie : après un rechargement de l\'appli, le tour des 12 tonalités continue là où il en était');
        check(erreurs.length === 0, 'harmonie : aucune erreur JavaScript ' + JSON.stringify(erreurs));
        await ctx.close();
    }
    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
