// MODULE « mobile » — ROTATION portrait / paysage. Observé en boîte noire (playwright-cli, 26/11/2026) : un téléphone couché fait 734 × 343 (iPhone 15) ou 863 × 360 (Pixel 7), profils « landscape » de Playwright, donc PLUS DE 700 px ;
// la colonne latérale n'apparaît pas pour autant (la barre des chapitres reste) ; la barre du haut a la forme « téléphone » à 734 px (neuf icônes) et la forme « ordinateur » à 863 px (boutons séparés : Annuler, Rétablir, Gammes…).
// Le test fait donc PIVOTER la fenêtre (`setViewportSize`, comme le fait le navigateur à la rotation) et vérifie ce qui doit survivre : l'état, ce qui est tapé, la lecture du métronome, les panneaux ouverts, et que rien ne sort de l'écran.
import { test, expect } from '../support/fixtures';
import { etatFiche, fiche, ligneDepart } from '../fiche/aide-fiche';
import { DEJA_EPINGLE, alArret, enLecture, etatMetro, flottant, jouer, metro, ouvrirEpingle, volet, ouvrir } from '../metronome/aide-metronome';
import { tientBientot, bibliothequeLongue, boutonHaut, commandesDehors, dansLEcran, hauteurEcran, ouvrirTel, pastilleChapitre, sansDefilementHorizontal, tailles, taille } from './aide-mobile';

/** Pivote et attend que la page ait pris la nouvelle largeur (`resize` traité). */
async function pivoter(page: import('@playwright/test').Page, taille: { width: number; height: number }) {
  await page.setViewportSize(taille);
  await expect.poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([taille.width, taille.height]);
}

test.describe('Rotation @mobile', () => {
  test('portrait → paysage → portrait : le chapitre, la fiche ouverte et le texte non validé sont conservés, rien ne sort de l\'écran @critique', async ({ ouvrirAppli, page }, testInfo) => {
    await ouvrirTel(ouvrirAppli, etatFiche(['Gamme majeure', 'Arpèges'], 'Technique'));
    const { portrait, paysage } = tailles(page, testInfo.project.name);
    const champ = fiche(page, 'Gamme majeure').getByPlaceholder('Coller un lien…');
    await champ.fill('https://exemple.fr/pas-encore-valide');
    await sansDefilementHorizontal(page, 'portrait');

    await pivoter(page, paysage);
    await expect(ligneDepart(page, 'Gamme majeure')).toBeVisible();
    await expect(fiche(page, 'Gamme majeure').getByPlaceholder('Coller un lien…')).toHaveValue('https://exemple.fr/pas-encore-valide');
    await sansDefilementHorizontal(page, 'paysage');
    expect(await commandesDehors(page, page.locator('.top-bar')), 'barre du haut en paysage').toEqual([]);
    expect(await commandesDehors(page, page.locator('#folder-container')), 'liste en paysage').toEqual([]);
    for (const nom of ['Paramètres', 'Session guidée']) {
      const b = boutonHaut(page, nom);
      await expect(b, nom).toBeVisible();
      await dansLEcran(page, b, `${nom} en paysage`);
    }

    await pivoter(page, portrait);
    await expect(fiche(page, 'Gamme majeure').getByPlaceholder('Coller un lien…')).toHaveValue('https://exemple.fr/pas-encore-valide');
    await sansDefilementHorizontal(page, 'retour en portrait');
    await expect(page.locator('#chapter-bar')).toBeVisible();
    expect(await commandesDehors(page, page.locator('.top-bar')), 'barre du haut au retour').toEqual([]);
  });

  test('le chapitre ouvert reste le même après un aller-retour, et les pastilles se touchent dans les deux orientations', async ({ ouvrirAppli, page }, testInfo) => {
    await ouvrirTel(ouvrirAppli, bibliothequeLongue(6));
    const { portrait, paysage } = tailles(page, testInfo.project.name);
    await pastilleChapitre(page, 'Gammes').click();
    await expect(pastilleChapitre(page, 'Gammes')).toHaveClass(/\bactive\b/);
    await pivoter(page, paysage);
    await expect(pastilleChapitre(page, 'Gammes')).toHaveClass(/\bactive\b/);
    await expect(page.locator('#breadcrumb .crumb-current')).toHaveText('Gammes');
    await pastilleChapitre(page, 'Improvisation').click();
    await expect(pastilleChapitre(page, 'Improvisation')).toHaveClass(/\bactive\b/);
    await pivoter(page, portrait);
    await expect(page.locator('#breadcrumb .crumb-current')).toHaveText('Improvisation');
    await expect(pastilleChapitre(page, 'Improvisation')).toHaveClass(/\bactive\b/);
  });

  test('téléphone couché : les barres collantes du haut laissent au moins 40 % de la hauteur à la liste, qui reste atteignable en défilant', async ({ ouvrirAppli, page }, testInfo) => {
    await ouvrirTel(ouvrirAppli, bibliothequeLongue(20));
    const { paysage } = tailles(page, testInfo.project.name);
    await pivoter(page, paysage);
    const bas = await page.evaluate(() => Math.max(...['.top-bar', '#chapter-bar'].map((s) => document.querySelector(s)!.getBoundingClientRect().bottom)));
    expect(bas / paysage.height, `barres du haut : ${Math.round(bas)} px sur ${paysage.height}`).toBeLessThanOrEqual(0.6);
    const derniere = ligneDepart(page, 'Technique 20');
    await derniere.scrollIntoViewIfNeeded();
    await expect(derniere).toBeInViewport();
    const b = (await derniere.boundingBox())!;
    expect(b.y, 'la dernière ligne n\'est pas cachée sous les barres collantes').toBeGreaterThanOrEqual(bas - 1);
  });

  test('un panneau ouvert pendant la rotation (Paramètres) se remet à la taille de l\'écran dans les deux sens', async ({ ouvrirAppli, page }, testInfo) => {
    await ouvrirTel(ouvrirAppli);
    const { portrait, paysage } = tailles(page, testInfo.project.name);
    await boutonHaut(page, 'Paramètres').tap();
    const panneau = page.locator('.settings-panel');
    await expect(panneau).toBeVisible();
    await pivoter(page, paysage);
    await tientBientot(page, panneau, 'Paramètres en paysage');
    expect(await commandesDehors(page, panneau)).toEqual([]);
    await pivoter(page, portrait);
    await tientBientot(page, panneau, 'Paramètres au retour');
    expect(await commandesDehors(page, panneau)).toEqual([]);
    await panneau.getByRole('button', { name: 'Fermer', exact: true }).tap();
    await expect(panneau).toBeHidden();
  });
});

test.describe('Métronome et rotation @mobile', () => {
  test('la fenêtre flottante en lecture continue de jouer à la rotation et reste dans l\'écran, bouton Jouer compris', async ({ ouvrirAppli, page }, testInfo) => {
    await ouvrirTel(ouvrirAppli, etatMetro(['Gamme']));
    const { portrait, paysage } = tailles(page, testInfo.project.name);
    await ouvrir(page);
    await jouer(page).click();
    await enLecture(page);
    await pivoter(page, paysage);
    await expect(flottant(page)).toBeVisible();
    await enLecture(page);
    // la fenêtre a 8 px de marge en haut et 340 px de contenu : sur 343 px de haut, sa marge basse est rognée de ≈ 5 px (jamais son contenu, vérifié par `toBeInViewport` sur Jouer)
    await tientBientot(page, metro(page), 'fenêtre du métronome en paysage', 8);
    await expect(jouer(page)).toBeInViewport();
    await pivoter(page, portrait);
    await tientBientot(page, metro(page), 'fenêtre du métronome au retour');
    await enLecture(page);
    await jouer(page).click();
    await alArret(page);
  });

  // MO-05 (gênant) : épinglé, le métronome occupe ≈ 58 % de l'écran couché et son gros bouton Jouer est écrasé à 18 px de haut (530 px de large) : la commande principale devient une fine barre.
  test('épinglé et téléphone couché, le bouton Jouer garde une cible d\'au moins 32 px de haut', async ({ ouvrirAppli, page }, testInfo) => {
    test.fail(true, 'MO-05 : le volet épinglé du métronome écrase le bouton Jouer à 18 px de haut en paysage.');
    await ouvrirTel(ouvrirAppli, etatMetro(['Gamme']), { reglages: DEJA_EPINGLE });
    const { paysage } = tailles(page, testInfo.project.name);
    await ouvrirEpingle(page);
    await pivoter(page, paysage);
    await expect(volet(page)).toBeVisible();
    await tientBientot(page, volet(page), 'volet épinglé en paysage');
    expect((await taille(jouer(page))).h, 'hauteur du bouton Jouer').toBeGreaterThanOrEqual(32);
  });

  test('épinglé et téléphone couché, le volet ne prend pas plus des deux tiers de l\'écran : la liste reste visible au-dessus', async ({ ouvrirAppli, page }, testInfo) => {
    await ouvrirTel(ouvrirAppli, etatMetro(['Gamme']), { reglages: DEJA_EPINGLE });
    const { paysage } = tailles(page, testInfo.project.name);
    await ouvrirEpingle(page);
    await pivoter(page, paysage);
    await expect(volet(page)).toBeVisible();
    const b = (await volet(page).boundingBox())!;
    expect(b.height / (await hauteurEcran(page)), `volet : ${Math.round(b.height)} px sur ${paysage.height}`).toBeLessThanOrEqual(0.67);
    await sansDefilementHorizontal(page);
  });
});
