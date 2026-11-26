// MODULE « metronome » — AU TÉLÉPHONE (≤ 700 px). Observé en boîte noire (playwright-cli et projets mobile-android / mobile-iphone, 25/11/2026) : le bouton « Métronome » est une icône de la barre du haut ; la fenêtre
// flottante tient dans l'écran ; épinglée, elle devient un volet EN BAS (pleine largeur), réductible (▾ / ▴) ; le curseur de volume est derrière un bouton « Volume ». Aucune barre de défilement horizontale.
import { test, expect } from '../support/fixtures';
import { alArret, appuyer, attendreEtat, boutonVolume, chrono, curseurVolume, enLecture, flottant, jouer, metro, moins10, ouvrir, ouvrirEtEpingler, ouvrirMetro, pastilles, plus10, plus1, formule, valeurTempo, volet, saisirTempo } from './aide-metronome';

const debordeHorizontalement = (page: import('@playwright/test').Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

test.describe('Métronome : au téléphone @metronome @mobile', () => {
  test('la fenêtre s\'ouvre dans l\'écran, joue, s\'arrête et se ferme @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await expect(flottant(page)).toBeVisible();
    const b = (await metro(page).boundingBox())!, v = page.viewportSize()!;
    expect(b.x).toBeGreaterThanOrEqual(-1);
    expect(b.x + b.width, 'la fenêtre ne déborde pas à droite').toBeLessThanOrEqual(v.width + 1);
    await expect(jouer(page)).toBeInViewport();
    await jouer(page).click();
    await enLecture(page);
    await expect(chrono(page)).not.toHaveText('00:00', { timeout: 5_000 });
    await jouer(page).click();
    await alArret(page);
    await metro(page).getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(metro(page)).toBeHidden();
    expect(await debordeHorizontalement(page)).toBe(false);
  });

  test('tempo (+1, +10, saisie) et mesure se règlent du doigt', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await appuyer(plus1(page));
    await expect(valeurTempo(page)).toHaveText('101');
    await appuyer(plus10(page));
    await expect(valeurTempo(page)).toHaveText('111');
    await appuyer(moins10(page));
    await expect(valeurTempo(page)).toHaveText('101');
    await saisirTempo(page, 72);
    await expect(valeurTempo(page)).toHaveText('72');
    await formule(page, '3/4').click();
    await expect(pastilles(page)).toHaveCount(3);
    await attendreEtat(page, (m) => [m.bpm, m.beatsPerMeasure], [72, 3]);
  });

  test('le volume se règle par le bouton « Volume »', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await expect(boutonVolume(page)).toBeVisible();
    await expect(curseurVolume(page)).toBeHidden();   // le curseur en ligne est réservé à l'ordinateur
    await boutonVolume(page).click();
    const curseur = metro(page).locator('input.metro-volume-slider');
    await expect(curseur).toBeVisible();
    await curseur.fill('30');
    await attendreEtat(page, (m) => m.volume, 0.3);
  });

  test('épinglé, le métronome est un volet EN BAS de l\'écran ; ▾ le réduit, ▴ le rouvre, ✕ le ferme', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrirEtEpingler(page);
    const v = page.viewportSize()!;
    const b = (await volet(page).boundingBox())!;
    expect(b.x).toBeLessThanOrEqual(1);
    expect(b.width).toBeGreaterThanOrEqual(v.width - 2);
    expect(Math.round(b.y + b.height), 'collé au bas de l\'écran').toBe(v.height);
    expect(b.y, 'ne couvre pas tout l\'écran').toBeGreaterThan(v.height * 0.25);
    expect(await debordeHorizontalement(page)).toBe(false);
    await jouer(page).click();
    await enLecture(page);
    await volet(page).getByRole('button', { name: 'Réduire le métronome' }).click();
    await expect.poll(async () => (await volet(page).boundingBox())!.height).toBeLessThan(b.height / 2);
    await expect(jouer(page)).toBeVisible();   // le gros bouton reste là, réduit
    await enLecture(page);
    await volet(page).getByRole('button', { name: 'Agrandir le métronome' }).click();
    await expect.poll(async () => (await volet(page).boundingBox())!.height).toBeGreaterThan(b.height - 5);
    await volet(page).getByRole('button', { name: 'Fermer le métronome' }).click();
    await expect(volet(page)).toBeHidden();
  });
});
