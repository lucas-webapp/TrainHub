// MODULE « statistiques » — ORDRE DES ONGLETS : à la souris, un onglet (Aperçu, Temps, Répartition, Exercices) se glisse à une autre place ; l'ordre est gardé sur l'appareil et suit à la réouverture.
// Observé en boîte noire (playwright-cli, 26/11/2026). Le glisser est réservé à la souris (pas au téléphone : l'appui long sert aux menus).
import { test, expect } from '../support/fixtures';
import { glisser } from '../bibliotheque/aide-bibliotheque';
import { fenetre, fermer, ilYa, ongletStats, ouvrirFenetre, ouvrirStats, boutonStats } from './aide-statistiques';

const ordre = (page: any) => fenetre(page).getByRole('tab').allTextContents();

test.describe('Statistiques : ordre des onglets @statistiques @ordinateur', () => {
  test('glisser « Exercices » avant « Aperçu » change l\'ordre ; l\'onglet actif ne change pas ; l\'ordre survit à la réouverture et au rechargement', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(1), pas: [{ ex: 'Gamme majeure', min: 10 }] }]);
    await ouvrirFenetre(page);
    expect(await ordre(page)).toEqual(['Aperçu', 'Temps', 'Répartition', 'Exercices']);
    await glisser(page, ongletStats(page, 'Exercices'), ongletStats(page, 'Aperçu'), 'haut');
    await expect.poll(() => ordre(page)).toEqual(['Exercices', 'Aperçu', 'Temps', 'Répartition']);
    await expect(ongletStats(page, 'Aperçu')).toHaveAttribute('aria-selected', 'true');   // le glisser n'a pas changé d'onglet
    await fermer(page).click();
    await boutonStats(page).click();
    await expect(fenetre(page)).toBeVisible();
    expect(await ordre(page)).toEqual(['Exercices', 'Aperçu', 'Temps', 'Répartition']);
    await page.reload();
    await expect(page.locator('#folder-container')).toBeAttached();
    await ouvrirFenetre(page);
    expect(await ordre(page)).toEqual(['Exercices', 'Aperçu', 'Temps', 'Répartition']);
  });

  test('un simple clic sur un onglet l\'ouvre sans le déplacer', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(1), pas: [{ ex: 'Gamme majeure', min: 10 }] }]);
    await ouvrirFenetre(page);
    await ongletStats(page, 'Répartition').click();
    await expect(ongletStats(page, 'Répartition')).toHaveAttribute('aria-selected', 'true');
    expect(await ordre(page)).toEqual(['Aperçu', 'Temps', 'Répartition', 'Exercices']);
  });
});
