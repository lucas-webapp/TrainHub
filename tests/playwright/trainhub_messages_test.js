// Messages (toasts) sur téléphone (v283) : un message long n'est plus écrasé dans la moitié de l'écran
// (left:50% limitait la largeur disponible) ; il occupe la largeur utile et reste entièrement dans l'écran.
// Les pastilles à 999 px ne passent pas sur deux lignes.
// Lancer :  NODE_PATH=/opt/node22/lib/node_modules node trainhub_messages_test.js   (serveur statique sur :8765)
const { chromium } = require('playwright');
const harnais = require('/home/user/trainhub/tests/_harness');
const { check, plan, bilan } = harnais('TrainHub : messages lisibles sur téléphone');
plan(13);

(async () => {
    const browser = await chromium.launch();
    const LONG = "D'autres modifications ont suivi : utilise le bouton ↶ (Annuler) pour revenir en arrière pas à pas.";
    const mesure = (page, avecAction, texte) => page.evaluate(([a, t]) => {
        document.querySelectorAll('.toast').forEach(n => n.remove());
        const d = document.createElement('div'); d.className = 'toast' + (a ? ' toast-with-action' : '');
        if (a) { const s = document.createElement('span'); s.className = 'toast-text'; s.textContent = t; const b = document.createElement('button'); b.className = 'toast-action'; b.textContent = 'Annuler'; d.appendChild(s); d.appendChild(b); }
        else d.textContent = t;
        document.body.appendChild(d);
        const r = d.getBoundingClientRect();
        return { w: r.width, l: r.left, r: r.right, h: r.height, vw: innerWidth, sw: document.documentElement.scrollWidth };
    }, [avecAction, texte]);

    for (const W of [390, 320]) {
        const ctx = await browser.newContext({ viewport: { width: W, height: 800 }, serviceWorkers: 'block', colorScheme: 'dark' });
        const page = await ctx.newPage();
        const erreurs = [];
        page.on('pageerror', e => erreurs.push(e.message));
        await page.route('https://www.gstatic.com/firebasejs/**', r => r.abort('failed'));
        await page.addInitScript(() => { try { localStorage.setItem('compteCloud.trainhub.nePlusProposer', '1'); } catch (e) { } });
        await page.goto('http://localhost:8765/index.html');
        await page.waitForTimeout(800);

        const a = await mesure(page, false, LONG);
        check(a.w > W * 0.8, `${W} px : message long = largeur utile, pas la moitié d'écran (${Math.round(a.w)} px)`);
        check(a.l >= 0 && a.r <= a.vw, `${W} px : … entièrement dans l'écran (${Math.round(a.l)} → ${Math.round(a.r)})`);
        check(a.sw <= a.vw, `${W} px : … sans faire défiler la page latéralement`);
        const b = await mesure(page, true, LONG);
        check(b.w > W * 0.8 && b.l >= 0 && b.r <= b.vw, `${W} px : message avec « Annuler » : même largeur utile, dans l'écran (${Math.round(b.w)} px)`);
        const c = await mesure(page, false, 'Copié');
        check(c.w < 140, `${W} px : message court = reste compact (${Math.round(c.w)} px)`);
        if (W === 390) {
            const nowrap = await page.evaluate(() => ['gs-files-badge', 'gs-yt-side-value', 'ex-note-add', 'harm-deg-fn', 'media-tab-count'].map(k => { const e = document.createElement('span'); e.className = k; document.body.appendChild(e); const v = getComputedStyle(e).whiteSpace; e.remove(); return v; }));
            check(nowrap.every(v => v === 'nowrap'), '390 px : les pastilles à 999 px ne passent pas sur deux lignes ' + JSON.stringify(nowrap));
        }
        check(erreurs.length === 0, `${W} px : aucune erreur JavaScript ` + JSON.stringify(erreurs));
        await ctx.close();
    }
    await browser.close();
    bilan();
})().catch(e => { console.error(e); process.exit(2); });
