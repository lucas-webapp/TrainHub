// MODULE « metronome » — OUVRIR, FERMER, ÉPINGLER. Observé en boîte noire (playwright-cli, 25/11/2026) : le bouton « Métronome » ouvre une fenêtre flottante (tempo 100, 4/4, volume 80 par défaut) ;
// « Fermer » la ferme ET arrête la lecture (le chrono repart de zéro à la réouverture) ; la punaise l'épingle dans un volet de la page (à droite ≥ 1 100 px, en bas au-dessous) et ce choix est retenu
// (`trainhub.metroDock.v1`) : le bouton rouvre ensuite le volet, même après un rechargement ; Paramètres › Métronome règle la position et la taille de la fenêtre flottante.
import { test, expect } from '../support/fixtures';
import { accentsAffiches, alArret, boutonMetronome, chrono, enLecture, flottant, jouer, metro, ouvrir, ouvrirEtEpingler, ouvrirMetro, pastilles, punaise, saisirTempo, tempoAffiche, valeurTempo, volet } from './aide-metronome';

const rechargee = async (page: import('@playwright/test').Page) => { await page.reload(); await expect(page.locator('#folder-container')).toBeAttached(); };

test.describe('Métronome : ouvrir, fermer, épingler @metronome', () => {
  test('« Métronome » ouvre la fenêtre (100 BPM, 4/4, Jouer), « Fermer » la referme, et on peut la rouvrir @critique', async ({ page, ouvrirAppli, garde }) => {
    await ouvrirMetro(ouvrirAppli);
    await expect(metro(page)).toBeHidden();
    await ouvrir(page);
    await expect(flottant(page)).toBeVisible();
    await expect(valeurTempo(page)).toHaveText('100');
    await expect(pastilles(page)).toHaveCount(4);
    expect(await accentsAffiches(page)).toEqual([2, 1, 1, 1]);   // 4/4 : un temps fort puis trois normaux
    await expect(chrono(page)).toHaveText('00:00');
    await alArret(page);
    await metro(page).getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(metro(page)).toBeHidden();
    await ouvrir(page);
    await expect(valeurTempo(page)).toHaveText('100');
    expect(garde.bloquees).toEqual([]);
  });

  test('fermer la fenêtre pendant la lecture arrête le métronome : à la réouverture, « Jouer » et chrono à zéro', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await jouer(page).click();
    await enLecture(page);
    await expect(chrono(page)).not.toHaveText('00:00');
    await metro(page).getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(metro(page)).toBeHidden();
    await ouvrir(page);
    await alArret(page);
    await expect(chrono(page)).toHaveText('00:00');
  });

  test('la fenêtre rouverte garde le tempo choisi (il est enregistré, pas perdu à la fermeture)', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await saisirTempo(page, 132);
    await metro(page).getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(metro(page)).toBeHidden();
    await ouvrir(page);
    await expect(valeurTempo(page)).toHaveText('132');
  });

  test('@ordinateur la punaise épingle le métronome dans un volet À DROITE de la page ; la même punaise le détache en fenêtre flottante @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await expect(volet(page)).toBeHidden();
    await punaise(page).click();
    await expect(volet(page)).toBeVisible();
    await expect(volet(page).locator('.metronome-panel')).toBeVisible();
    const larg = page.viewportSize()!.width;
    const boite = (await volet(page).boundingBox())!;
    expect(boite.x, 'le volet est dans la moitié droite').toBeGreaterThan(larg / 2);
    expect(boite.x + boite.width, 'il ne déborde pas de la page').toBeLessThanOrEqual(larg + 1);
    // La page reste utilisable à côté : la liste des exercices est toujours là et l'ajout d'un exercice fonctionne.
    await page.getByPlaceholder('Ajouter un exercice…').fill('Nouveau');
    await page.getByPlaceholder('Ajouter un exercice…').press('Enter');
    await expect(page.locator('#folder-container .exercise .exercise-title').last()).toHaveValue('Nouveau');
    // Détacher.
    await punaise(page).click();
    await expect(flottant(page)).toBeVisible();
    await expect(volet(page)).toBeHidden();
  });

  test('@ordinateur le volet est à droite à partir de 1 100 px de large et passe EN BAS au-dessous', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await page.setViewportSize({ width: 1101, height: 800 });
    await ouvrirEtEpingler(page);
    await expect.poll(async () => { const b = (await volet(page).boundingBox())!; return b.x > 500 && b.width < 600; }, { message: 'à 1 101 px : volet à droite' }).toBe(true);
    await page.setViewportSize({ width: 1099, height: 800 });
    await expect.poll(async () => { const b = (await volet(page).boundingBox())!; return b.x <= 1 && b.width >= 1090 && b.y > 300; }, { message: 'à 1 099 px : volet en bas, sur toute la largeur' }).toBe(true);
    const b = (await volet(page).boundingBox())!;
    expect(Math.round(b.y + b.height), 'collé au bas de la fenêtre').toBe(800);
  });

  test('« ✕ » ferme le volet ; le bouton « Métronome » le rouvre épinglé, et le choix survit à un rechargement', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrirEtEpingler(page);
    await volet(page).getByRole('button', { name: 'Fermer le métronome' }).click();
    await expect(volet(page)).toBeHidden();
    await boutonMetronome(page).click();
    await expect(volet(page)).toBeVisible();
    await rechargee(page);
    await expect(metro(page)).toBeHidden();   // un rechargement ferme le métronome…
    await boutonMetronome(page).click();
    await expect(volet(page)).toBeVisible();  // … mais le bouton le rouvre épinglé
    await expect(flottant(page)).toBeHidden();
  });

  test('épingler ou détacher pendant la lecture ne l\'interrompt pas', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await jouer(page).click();
    await enLecture(page);
    await punaise(page).click();
    await expect(volet(page)).toBeVisible();
    await enLecture(page);
    await punaise(page).click();
    await expect(flottant(page)).toBeVisible();
    await enLecture(page);
    await jouer(page).click();
    await alArret(page);
  });

  test('épingler pendant la lecture ne remet pas le chrono à zéro', async ({ page, ouvrirAppli }) => {
    test.fail(true, 'ME-01 : épingler (ou détacher) le métronome en cours de lecture remet le chrono à 00:00 alors que la lecture continue (le temps déjà joué est perdu)');
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await jouer(page).click();
    await expect.poll(async () => Number((await chrono(page).innerText()).split(':')[1])).toBeGreaterThanOrEqual(3);
    await punaise(page).click();
    await expect(volet(page)).toBeVisible();
    await enLecture(page);
    // Attendu : le chrono continue à partir de ≥ 3 s ; observé : il repart de 00:00.
    expect(Number((await chrono(page).innerText()).split(':')[1])).toBeGreaterThanOrEqual(3);
  });

  test('Paramètres › Métronome › Position et Taille : la fenêtre flottante s\'ouvre là où on le demande', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await page.getByRole('button', { name: 'Paramètres' }).click();
    await page.getByRole('tab', { name: 'Métronome' }).click();
    await page.getByRole('tabpanel').getByRole('combobox').first().selectOption({ label: 'Haut' });
    await page.getByRole('radio', { name: 'Grande' }).check();
    await page.getByRole('button', { name: 'Fermer', exact: true }).click();
    await ouvrir(page);
    await expect(metro(page)).toHaveClass(/metro-pos-top/);
    await expect(metro(page)).toHaveClass(/metro-size-large/);
    const b = (await metro(page).boundingBox())!;
    expect(b.y, 'en haut de la fenêtre').toBeLessThan(200);
  });
});
