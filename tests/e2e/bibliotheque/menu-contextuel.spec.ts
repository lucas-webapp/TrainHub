// MODULE « bibliotheque » — MENU CONTEXTUEL (clic droit à l'ordinateur, appui long au téléphone) et « Plus d'actions ».
// Observé en boîte noire (playwright-cli, 23/11/2026) :
//   exercice : titre du menu = nom de l'exercice ; Renommer…, Ajouter à une session…, Marquer « En cours », Marquer en favori, Déplacer vers…,
//              Plus d'actions ▾ (se déplie en place : Moins d'actions ▴ + Transformer en morceau…, Remplacer partout par…, Lier à un autre exercice…,
//              Sélectionner (plusieurs), Dupliquer, Archiver), Supprimer… ;
//   dossier :  Nouveau sous-dossier, Renommer, Dupliquer, Déplacer vers…, Fusionner avec…, Supprimer ;
//   chapitre : idem + Transformer en chapitre de morceaux… (entre Fusionner et Supprimer).
// L'appui long est simulé par un événement `pointerdown` tactile maintenu (voir `appuiLong` dans aide-bibliotheque.ts) : Playwright n'a pas de geste d'appui long.
import { test, expect } from '../support/fixtures';
import {
  appuiLong, auTelephone, bibliothequeType, chapitre, ligneDepart, menuContextuel, ouvrirChapitre, ouvrirChemin, ouvrirMenu, rangee, sousDossier, titreOuvert, ligne,
} from './aide-bibliotheque';
import type { Page } from '@playwright/test';

const nomsBoutons = (page: Page) => menuContextuel(page).getByRole('button').evaluateAll((bs) => bs.map((b) => (b.textContent || '').trim()));

test.describe('Menu contextuel @bibliotheque', () => {
  test('clic droit sur un exercice : le menu porte son nom et ses actions ; Échap, un clic ailleurs ou une action le ferment @critique @ordinateur', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirChapitre(page, 'Technique');
    const exo = ligneDepart(page, 'Arpèges');
    await rangee(exo).click({ button: 'right' });
    const menu = menuContextuel(page);
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('Arpèges');
    expect(await nomsBoutons(page)).toEqual([
      'Renommer…', 'Ajouter à une session…', '○ Marquer « En cours »', '☆ Marquer en favori', 'Déplacer vers…', "Plus d'actions ▾", 'Supprimer…',
    ]);

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    // Un clic ailleurs le ferme aussi, sans rien déclencher.
    await rangee(exo).click({ button: 'right' });
    await expect(menu).toBeVisible();
    await page.locator('.ctx-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(menu).toBeHidden();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Le clic droit ne sélectionne rien et ne change pas l'exercice.
    await expect(page.locator('#folder-container .exercise.selected')).toHaveCount(0);
  });

  test('appui long sur un exercice (téléphone) : le menu s\'ouvre ; un simple toucher ne l\'ouvre pas @critique @mobile', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirChapitre(page, 'Technique');
    const exo = ligneDepart(page, 'Arpèges');
    await exo.scrollIntoViewIfNeeded();

    // Un toucher bref déplie la ligne (ou la replie) mais n'ouvre pas de menu.
    await rangee(exo).tap({ position: { x: 150, y: 10 } });
    await expect(menuContextuel(page)).toHaveCount(0);

    await appuiLong(page, rangee(exo));
    const menu = menuContextuel(page);
    await expect(menu).toContainText('Arpèges');
    expect(await nomsBoutons(page)).toEqual([
      'Renommer…', 'Ajouter à une session…', '○ Marquer « En cours »', '☆ Marquer en favori', 'Déplacer vers…', "Plus d'actions ▾", 'Supprimer…',
    ]);
    // Le menu reste entièrement dans l'écran.
    const b = (await menu.boundingBox())!;
    const v = page.viewportSize()!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(v.width + 1);
    expect(b.y + b.height).toBeLessThanOrEqual(v.height + 1);

    // Un toucher hors du menu le ferme.
    await page.locator('.ctx-backdrop').tap({ position: { x: 5, y: 5 } });
    await expect(menu).toBeHidden();
  });

  test('« Plus d\'actions » déplie les actions rares dans le menu, « Moins d\'actions » les replie', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirChapitre(page, 'Technique');
    await ouvrirMenu(page, rangee(ligneDepart(page, 'Gamme majeure')));
    const menu = menuContextuel(page);
    const plus = menu.getByRole('button', { name: /Plus d'actions/ });
    await expect(plus).toHaveAttribute('aria-expanded', 'false');
    await expect(menu.getByRole('button', { name: 'Dupliquer' })).toHaveCount(0);

    await plus.click();
    await expect(menu.getByRole('button', { name: /Moins d'actions/ })).toHaveAttribute('aria-expanded', 'true');
    expect(await nomsBoutons(page)).toEqual([
      'Renommer…', 'Ajouter à une session…', '○ Marquer « En cours »', '☆ Marquer en favori', 'Déplacer vers…', "Moins d'actions ▴",
      '♪ Transformer en morceau…', 'Remplacer partout par…', '🔗 Lier à un autre exercice…', '☑ Sélectionner (plusieurs)', 'Dupliquer', 'Archiver', 'Supprimer…',
    ]);
    // Le menu entier reste dans l'écran même déplié.
    const b = (await menu.boundingBox())!, v = page.viewportSize()!;
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height).toBeLessThanOrEqual(v.height + 1);

    await menu.getByRole('button', { name: /Moins d'actions/ }).click();
    await expect(menu.getByRole('button', { name: 'Dupliquer' })).toHaveCount(0);
    await expect(menu.getByRole('button', { name: /Plus d'actions/ })).toBeVisible();
  });

  test('le menu d\'un exercice déjà favori / en cours propose de le retirer', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirChapitre(page, 'Technique');
    const exo = ligneDepart(page, 'Gamme majeure');
    await ouvrirMenu(page, rangee(exo));
    await menuContextuel(page).getByRole('button', { name: /Marquer en favori/ }).click();
    await ouvrirMenu(page, rangee(exo));
    await menuContextuel(page).getByRole('button', { name: /Marquer « En cours »/ }).click();
    await ouvrirMenu(page, rangee(exo));
    const noms = await nomsBoutons(page);
    expect(noms.some((n) => /favori/i.test(n) && !/Marquer en favori/.test(n))).toBe(true);
    expect(noms.some((n) => /En cours/.test(n) && !/Marquer « En cours »/.test(n))).toBe(true);
  });

  test('menu d\'un dossier : ses actions, dans l\'ordre', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirChapitre(page, 'Technique');
    await ouvrirMenu(page, sousDossier(page, 'Slap'));
    await expect(menuContextuel(page)).toContainText('Slap');
    expect(await nomsBoutons(page)).toEqual(['Nouveau sous-dossier', 'Renommer', 'Dupliquer', 'Déplacer vers…', 'Fusionner avec…', 'Supprimer']);
    await page.keyboard.press('Escape');
    await expect(menuContextuel(page)).toBeHidden();
  });

  test('menu d\'un chapitre : celui d\'un dossier + « Transformer en chapitre de morceaux… »', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirMenu(page, chapitre(page, 'Technique'));
    await expect(menuContextuel(page)).toContainText('Technique');
    expect(await nomsBoutons(page)).toEqual([
      'Nouveau sous-dossier', 'Renommer', 'Dupliquer', 'Déplacer vers…', 'Fusionner avec…', 'Transformer en chapitre de morceaux…', 'Supprimer',
    ]);
  });

  test('un seul menu à la fois : en ouvrir un second remplace le premier', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirChapitre(page, 'Technique');
    await ouvrirMenu(page, rangee(ligneDepart(page, 'Gamme majeure')));
    await expect(menuContextuel(page)).toContainText('Gamme majeure');
    await page.keyboard.press('Escape');
    await ouvrirMenu(page, rangee(ligneDepart(page, 'Arpèges')));
    await expect(menuContextuel(page)).toHaveCount(1);
    await expect(menuContextuel(page)).toContainText('Arpèges');
    await expect(menuContextuel(page)).not.toContainText('Gamme majeure');
  });
});
