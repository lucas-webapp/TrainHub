// MODULE « bibliotheque » — VOLET LATÉRAL (colonne « Chapitres et dossiers ») : masquer / afficher, largeur. À l'ordinateur seulement ; au téléphone la barre de pastilles la remplace.
// Observé en boîte noire (playwright-cli, 23/11/2026) : largeur 280 px par défaut ; le bouton du haut (aria-pressed), Ctrl/⌘ + B masquent et réaffichent ;
// la poignée (separator « Largeur du bandeau ») se glisse à la souris, se règle aux flèches (± 20 px), un double clic rend 280 px ; bornes 200 et 560 px ;
// largeur et état sont gardés (localStorage `trainhub.sidebarWidth`, `trainhub.sidebarHidden.v1`). Les mesures au pixel près sont tenues par le banc `volet` (PLAN § 7).
import { test, expect } from '../support/fixtures';
import { auTelephone, bibliothequeType, chapitre, ouvrirChapitre } from './aide-bibliotheque';
import type { Page } from '@playwright/test';

const colonne = (page: Page) => page.locator('#sidebar-tree');
const bascule = (page: Page) => page.getByRole('button', { name: 'Masquer ou afficher le bandeau des dossiers' });
const poignee = (page: Page) => page.getByRole('separator', { name: 'Largeur du bandeau' });
const largeur = (page: Page) => colonne(page).evaluate((e) => Math.round(e.getBoundingClientRect().width));
async function glisserPoignee(page: Page, versX: number) {
  const b = (await poignee(page).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + 200);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + (versX > b.x ? 6 : -6), b.y + 200, { steps: 2 });
  await page.mouse.move(versX, b.y + 200, { steps: 10 });
  await page.mouse.up();
}

test.describe('Volet latéral @bibliotheque @ordinateur', () => {
  test('masquer et réafficher le volet : par le bouton du haut et par Ctrl/⌘ + B ; l\'état reste après rechargement @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await expect(chapitre(page, 'Technique')).toBeVisible();
    await expect(bascule(page)).toHaveAttribute('aria-pressed', 'false');
    expect(await largeur(page)).toBe(280);

    await bascule(page).click();
    await expect(bascule(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(chapitre(page, 'Technique')).toBeHidden();
    expect(await largeur(page)).toBe(0);
    // La zone principale prend la place : l'écran n'est pas vide, on peut toujours travailler.
    await expect(page.locator('#folder-container')).toBeVisible();
    await expect(page.getByPlaceholder('Ajouter un exercice…')).toBeVisible();

    // Rechargement : toujours masqué.
    await page.reload();
    await expect(bascule(page)).toHaveAttribute('aria-pressed', 'true');
    expect(await largeur(page)).toBe(0);

    // Clavier : Ctrl/⌘ + B le réaffiche, puis le masque de nouveau.
    await page.keyboard.press('ControlOrMeta+b');
    await expect(bascule(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(chapitre(page, 'Technique')).toBeVisible();
    expect(await largeur(page)).toBe(280);
    await page.keyboard.press('ControlOrMeta+b');
    await expect(chapitre(page, 'Technique')).toBeHidden();
    await bascule(page).click();
    await ouvrirChapitre(page, 'Improvisation');   // une fois réaffiché, il fonctionne comme avant
  });

  test('régler la largeur : à la souris, aux flèches, bornes 200 et 560 px, double clic = taille par défaut ; la largeur reste après rechargement @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    expect(await largeur(page)).toBe(280);

    // Souris : on élargit.
    await glisserPoignee(page, 400);
    await expect.poll(() => largeur(page)).toBe(400);
    // Bornes : très large → 560, très étroit → 200.
    await glisserPoignee(page, 1300);
    await expect.poll(() => largeur(page)).toBe(560);
    await glisserPoignee(page, 4);
    await expect.poll(() => largeur(page)).toBe(200);

    // Flèches : ± 20 px par appui.
    await poignee(page).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => largeur(page)).toBe(240);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => largeur(page)).toBe(220);

    // La largeur est gardée.
    await page.reload();
    expect(await largeur(page)).toBe(220);
    expect(await page.evaluate(() => localStorage.getItem('trainhub.sidebarWidth'))).toBe('220');

    // Double clic : retour à 280 px.
    await poignee(page).dblclick();
    await expect.poll(() => largeur(page)).toBe(280);
    // Les chapitres restent lisibles et cliquables à toutes les largeurs.
    await ouvrirChapitre(page, 'Improvisation');
  });

  test('la largeur réglée est conservée quand on masque puis réaffiche le volet', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await glisserPoignee(page, 360);
    await expect.poll(() => largeur(page)).toBe(360);
    await bascule(page).click();
    await expect.poll(() => largeur(page)).toBe(0);
    await bascule(page).click();
    await expect.poll(() => largeur(page)).toBe(360);
  });
});

test.describe('Volet au téléphone @bibliotheque @mobile', () => {
  test('au téléphone, la colonne latérale n\'est pas affichée : la barre de pastilles (Favoris, chapitres, Archivés, +) la remplace', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    expect(auTelephone(page)).toBe(true);
    await expect(page.locator('#chapter-bar')).toBeVisible();
    await expect(page.locator('#chapter-bar .chapter-chip')).toHaveText(['Favoris', 'Technique', 'Improvisation', 'Archivés']);
    await expect(page.getByTitle('Ajouter un grand chapitre')).toBeVisible();
    expect(await largeur(page)).toBeLessThan(5);   // aucune colonne
    await expect(poignee(page)).toBeHidden();
    await expect(bascule(page)).toBeHidden();
  });
});
