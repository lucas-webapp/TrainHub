// MODULE « libre » — MISE EN PAGE : téléphone (≤ 700 px) et ordinateur. Observé en boîte noire (playwright-cli, 25/11/2026) : au téléphone la barre `#free-bar` prend toute la largeur sous l'en-tête
// (chrono, pause, arrêt) et les pastilles par exercice (`#free-recap`) sont masquées ; à partir de 701 px la barre est à gauche des boutons du haut et les pastilles s'affichent.
// La fenêtre de fin doit tenir dans l'écran. Le bouton « Libre » est dans la rangée d'icônes du haut dans les deux cas.
import { test, expect } from '../support/fixtures';
import {
  afficher, arreterLibre, auTelephone, barre, boutonArret, boutonLibre, boutonPause, chrono, demarrerSur, ecouler, enregistrerSeance, fenetreSeance, journalDuMois, lancerLibre, ouvrirLibre, passerA, puces,
  sec, min, secondesChrono, verifierEtat, laisserPasser, tempsPuce, champNomSeance, DELAI_DEPART,
} from './aide-libre';

/** Aucune barre de défilement horizontale sur la page. */
const sansDefilementHorizontal = (page: any) => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
const largeurEcran = (page: any) => page.evaluate(() => document.documentElement.clientWidth);
async function dansLEcran(page: any, loc: any, nom: string) {
  const b = await loc.boundingBox();
  const l = await largeurEcran(page);
  expect(b, nom).not.toBeNull();
  expect(b!.x, `${nom} : bord gauche`).toBeGreaterThanOrEqual(-1);
  expect(b!.x + b!.width, `${nom} : bord droit`).toBeLessThanOrEqual(l + 1);
}

test.describe('Libre : téléphone @libre', () => {
  test('au téléphone : le parcours complet (démarrer, changer d\'exercice, pause, arrêter, enregistrer) tient dans l\'écran @critique @mobile', async ({ page, ouvrirAppli, garde }) => {
    expect(auTelephone(page)).toBe(true);
    await ouvrirLibre(page, ouvrirAppli);
    await expect(boutonLibre(page)).toBeVisible();
    await lancerLibre(page);
    await verifierEtat(page, 'idle');
    await dansLEcran(page, barre(page), 'barre');
    await afficher(page, 'Alpha');
    await ecouler(page, DELAI_DEPART);
    await verifierEtat(page, 'run');
    await ecouler(page, min(1) + sec(5));
    await expect(chrono(page)).toHaveText('1:05');
    await passerA(page, 'Bravo');
    await ecouler(page, sec(10));
    await boutonPause(page).click();
    await verifierEtat(page, 'paused');
    const fige = await secondesChrono(page);
    expect(fige).toBeGreaterThanOrEqual(75);
    await ecouler(page, sec(20));
    expect(await secondesChrono(page)).toBe(fige);
    await boutonPause(page).click();
    await verifierEtat(page, 'run');
    await arreterLibre(page);
    await expect(fenetreSeance(page)).toBeVisible();
    await dansLEcran(page, fenetreSeance(page), 'fenêtre de fin');
    await expect(fenetreSeance(page).getByRole('button', { name: 'Enregistrer', exact: true })).toBeInViewport();
    await sansDefilementHorizontal(page);
    await enregistrerSeance(page);
    const [s] = await journalDuMois(page);
    expect(s.steps.map((x: any) => x.title)).toEqual(['Alpha', 'Bravo']);
    expect(garde.bloquees).toEqual([]);
  });

  test('au téléphone : la barre prend toute la largeur, les pastilles par exercice sont masquées, chrono et boutons restent utilisables @mobile', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, sec(6));
    const b = await barre(page).boundingBox();
    const l = await largeurEcran(page);
    expect(b!.width).toBeGreaterThan(l * 0.85);
    await expect(chrono(page)).toBeVisible();
    await expect(boutonPause(page)).toBeVisible();
    await expect(boutonArret(page)).toBeVisible();
    await expect(puces(page).first()).toBeHidden();   // « Alpha 0:06 » n'est pas affiché au téléphone
    await expect(barre(page)).toHaveAttribute('title', 'Entraînement libre — Alpha');
    await sansDefilementHorizontal(page);
    // Les deux boutons de la barre sont assez grands pour le doigt.
    for (const bouton of [boutonPause(page), boutonArret(page)]) {
      const r = await bouton.boundingBox();
      expect(r!.width).toBeGreaterThanOrEqual(30);
      expect(r!.height).toBeGreaterThanOrEqual(30);
    }
  });

  test('au téléphone : une séance trop courte donne un message lisible, sans fenêtre ni débordement @mobile', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, sec(20));
    await arreterLibre(page);
    const message = page.locator('.toast').filter({ hasText: 'Entraînement trop court' });
    await expect(message).toBeVisible();
    await dansLEcran(page, message, 'message');
    await expect(fenetreSeance(page)).toBeHidden();
    await sansDefilementHorizontal(page);
  });
});

test.describe('Libre : ordinateur @libre', () => {
  test('sur ordinateur : la barre est à gauche des boutons du haut et chaque exercice travaillé a sa pastille avec son temps @ordinateur', async ({ page, ouvrirAppli }) => {
    expect(auTelephone(page)).toBe(false);
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, sec(20));
    await passerA(page, 'Bravo');
    await ecouler(page, sec(8));
    await expect(puces(page)).toHaveCount(2);
    await expect(puces(page).first()).toBeVisible();
    await expect(tempsPuce(page, 'Bravo')).toHaveText('0:08');
    const b = await barre(page).boundingBox();
    const bouton = await boutonLibre(page).boundingBox();
    expect(b!.x + b!.width).toBeLessThanOrEqual(bouton!.x + 1);   // à gauche du bouton « Libre »
    expect(b!.width).toBeLessThan(400);
    expect(b!.y).toBeLessThan(bouton!.y + bouton!.height);        // sur la même rangée que lui (pas de renvoi sous l'en-tête)
    await sansDefilementHorizontal(page);
  });

  test('en rétrécissant la fenêtre : barre compacte et pastilles à grande largeur, barre pleine largeur sans pastilles à 700 px @ordinateur', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, sec(8));
    await page.setViewportSize({ width: 1300, height: 900 });
    await laisserPasser(page, 1000);
    await expect(puces(page).first()).toBeVisible();
    expect((await barre(page).boundingBox())!.width).toBeLessThan(400);
    await page.setViewportSize({ width: 900, height: 900 });
    await laisserPasser(page, 1000);
    await expect(puces(page).first()).toBeHidden();   // plus de place pour les pastilles : le chrono et les boutons restent
    expect((await barre(page).boundingBox())!.width).toBeLessThan(400);
    await page.setViewportSize({ width: 700, height: 900 });
    await laisserPasser(page, 1000);
    expect((await barre(page).boundingBox())!.width).toBeGreaterThan(700 * 0.85);   // la mise en page du téléphone : barre sous l'en-tête, pleine largeur
    await expect(chrono(page)).toBeVisible();
    await expect(boutonPause(page)).toBeVisible();
    await sansDefilementHorizontal(page);
    await page.setViewportSize({ width: 1300, height: 900 });
    await laisserPasser(page, 1000);
    await expect(puces(page).first()).toBeVisible();
  });

  test('sur ordinateur : la fenêtre de fin s\'ouvre au milieu de l\'écran et se déplace par sa poignée @ordinateur', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, min(1) + sec(5));
    await arreterLibre(page);
    await expect(fenetreSeance(page)).toBeVisible();
    await dansLEcran(page, fenetreSeance(page), 'fenêtre de fin');
    const avant = await fenetreSeance(page).boundingBox();
    const poignee = fenetreSeance(page).locator('.panel-drag-handle');
    const p = await poignee.boundingBox();
    await page.mouse.move(p!.x + p!.width / 2, p!.y + p!.height / 2);
    await page.mouse.down();
    await page.mouse.move(p!.x + p!.width / 2 - 120, p!.y + p!.height / 2 + 60, { steps: 5 });
    await page.mouse.up();
    const apres = await fenetreSeance(page).boundingBox();
    expect(Math.abs(apres!.x - avant!.x)).toBeGreaterThan(60);
    await expect(champNomSeance(page)).toBeVisible();
  });
});
