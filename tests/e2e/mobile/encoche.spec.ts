// MODULE « mobile » — ENCOCHE ET ZONE SÛRE. Observé en boîte noire (26/11/2026) : la page déclare `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no` SANS `viewport-fit=cover` : le navigateur
// garde donc la page hors de l'encoche (portrait) et des coins arrondis, et `env(safe-area-inset-*)` ne vaut que 0 sur un vrai iPhone en navigateur ; l'appli l'utilise quand même pour les éléments collés au bas (volet du
// métronome, barre de sélection, lecteur audio) : elle sert en mode « application installée » (PWA plein écran) où la barre d'accueil de l'iPhone (34 px) entre dans la page. On ÉMULE cette zone sûre (Chromium seulement :
// `Emulation.setSafeAreaInsetsOverride`, CDP) et on vérifie que rien de touchable ne tombe dans les 34 px du bas. WebKit n'a pas cette émulation (ENV-MO-03) : à vérifier à la main sur iPhone, application installée.
import { test, expect } from '../support/fixtures';
import { DEJA_EPINGLE, etatMetro, jouer, ouvrirEpingle, volet } from '../metronome/aide-metronome';
import { barreSelection, bibliothequeCourte, boutonHaut, commencerSelection, hauteurEcran, ouvrirTel } from './aide-mobile';

const BAS = 34;
async function zoneSure(page: import('@playwright/test').Page, browserName: string) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, bottom: BAS, left: 0, right: 0 } });
  const mesure = await page.evaluate(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;bottom:0;width:1px;height:env(safe-area-inset-bottom,0px)'; document.body.appendChild(d); const h = d.getBoundingClientRect().height; d.remove(); return h; });
  expect(mesure, 'la zone sûre émulée est bien vue par la page').toBe(BAS);
  return cdp;
}

test.describe('Encoche et zone sûre @mobile', () => {
  test('la page est cadrée sur l\'appareil (largeur, échelle) ; viewport-fit n\'est pas demandé, donc l\'encoche est évitée par le navigateur', async ({ ouvrirAppli, page }) => {
    await ouvrirTel(ouvrirAppli, bibliothequeCourte());
    const meta = await page.evaluate(() => document.querySelector('meta[name=viewport]')!.getAttribute('content')!);
    expect(meta).toContain('width=device-width');
    expect(meta).toContain('initial-scale=1');
    expect(meta, 'viewport-fit=cover n\'est pas demandé : la page ne passe pas sous l\'encoche').not.toContain('viewport-fit=cover');
    // La barre du haut commence tout en haut de la fenêtre (aucune marge à gauche, à droite, en haut) : c'est au navigateur de la placer sous l'encoche.
    const b = await page.locator('.top-bar').evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
    expect(b.x).toBe(0);
    expect(b.y).toBe(0);
    expect(Math.round(b.w)).toBe(page.viewportSize()!.width);
  });

  test('avec 34 px de zone sûre en bas, le bouton Jouer du métronome épinglé reste au-dessus de la barre d\'accueil', async ({ ouvrirAppli, page, browserName }) => {
    test.fixme(browserName === 'webkit', 'ENV-MO-03 : le WebKit de Playwright n\'émule pas la zone sûre (pas de CDP) ; à vérifier sur iPhone, application installée.');
    await ouvrirTel(ouvrirAppli, etatMetro(['Gamme']), { reglages: DEJA_EPINGLE });
    await zoneSure(page, browserName);
    await ouvrirEpingle(page);
    const h = await hauteurEcran(page);
    await expect.poll(async () => { const b = (await jouer(page).boundingBox())!; return b.y + b.height; }, { message: 'Jouer au-dessus des 34 px du bas' }).toBeLessThanOrEqual(h - BAS + 1);
    const v = (await volet(page).boundingBox())!;
    expect(v.y + v.height, 'le volet va jusqu\'au bas de l\'écran, son contenu s\'arrête avant').toBeLessThanOrEqual(h + 1);
  });

  test('avec 34 px de zone sûre en bas, la barre de sélection se pose au-dessus de la barre d\'accueil', async ({ ouvrirAppli, page, browserName }) => {
    test.fixme(browserName === 'webkit', 'ENV-MO-03 : le WebKit de Playwright n\'émule pas la zone sûre (pas de CDP) ; à vérifier sur iPhone, application installée.');
    await ouvrirTel(ouvrirAppli, bibliothequeCourte());
    await zoneSure(page, browserName);
    await commencerSelection(page, 'Arpèges');
    const b = (await barreSelection(page).boundingBox())!, h = await hauteurEcran(page);
    expect(b.y + b.height, 'bas de la barre de sélection').toBeLessThanOrEqual(h - BAS + 1);
  });

  test('avec 34 px de zone sûre en bas, le bandeau du lecteur audio garde ses commandes au-dessus de la barre d\'accueil', async ({ ouvrirAppli, page, browserName }) => {
    test.fixme(browserName === 'webkit', 'ENV-MO-03 : le WebKit de Playwright n\'émule pas la zone sûre (pas de CDP) ; à vérifier sur iPhone, application installée.');
    await ouvrirTel(ouvrirAppli, bibliothequeCourte());
    await zoneSure(page, browserName);
    await boutonHaut(page, 'Lecteur audio').tap();
    const lecteur = page.locator('.audio-panel');
    await expect(lecteur).toBeVisible();
    const h = await hauteurEcran(page);
    const basCommandes = await lecteur.evaluate((r) => Math.max(...[...r.querySelectorAll('button, input, select')].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0).map((b) => b.bottom)));
    expect(basCommandes, 'bas des commandes du lecteur').toBeLessThanOrEqual(h - BAS + 1);
  });
});
