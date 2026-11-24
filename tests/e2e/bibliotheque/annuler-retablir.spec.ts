// MODULE « bibliotheque » — ANNULER / RÉTABLIR (historique des modifications de la bibliothèque).
// Observé en boîte noire (playwright-cli, 23/11/2026) : boutons « Annuler » / « Rétablir » en haut (grisés quand il n'y a rien à faire) ; au téléphone ils sont dans le menu
// « ⋯ » (Plus d'actions : Annuler, Rétablir, Corbeille). Chaque modification de la liste (ajout, renommage, déplacement, suppression, archivage…) est une étape ; les
// messages « … mis à la corbeille — Annuler » appellent la même annulation. Une nouvelle modification après un « Annuler » efface les étapes à rétablir.
import { test, expect } from '../support/fixtures';
import {
  actionExercice, ajouterExercice, annuler, attendreTitres, auTelephone, bibliothequeType, champTitre, etatBibliotheque, exerciceEnregistre, ligneDepart, ouvrirChapitre,
  retablir, ouvrirMenu, rangee, choisirAction, chapitre, confirmer,
} from './aide-bibliotheque';
import type { Page } from '@playwright/test';

const trois = () => etatBibliotheque([{ nom: 'Basse', chapitres: [{ nom: 'Technique', exercices: ['Alpha', 'Bravo', 'Charlie'] }] }]);

/** Les actions possibles : boutons du haut (ordinateur) ou entrées du menu « ⋯ » (téléphone). */
async function possibles(page: Page): Promise<{ annuler: boolean; retablir: boolean }> {
  if (auTelephone(page)) {
    await page.locator('#more-btn').click();
    const r = {
      annuler: await page.getByRole('menuitem', { name: 'Annuler', exact: true }).isEnabled(),
      retablir: await page.getByRole('menuitem', { name: 'Rétablir', exact: true }).isEnabled(),
    };
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: 'Annuler', exact: true })).toBeHidden();
    return r;
  }
  return { annuler: await page.locator('#undo-btn').isEnabled(), retablir: await page.locator('#redo-btn').isEnabled() };
}

test.describe('Annuler / rétablir @bibliotheque', () => {
  test('plusieurs modifications de suite : on les annule une à une, puis on les rétablit une à une @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: trois() });
    await ouvrirChapitre(page, 'Technique');
    expect(await possibles(page)).toEqual({ annuler: false, retablir: false });

    // 1. ajout  2. renommage  3. archivage
    await ajouterExercice(page, 'Delta');
    await attendreTitres(page, ['Alpha', 'Bravo', 'Charlie', 'Delta']);
    await champTitre(ligneDepart(page, 'Alpha')).fill('Alpha 2');
    await champTitre(ligneDepart(page, 'Alpha')).press('Enter');
    await expect.poll(async () => (await exerciceEnregistre(page, 'Alpha 2')).length).toBe(1);
    await actionExercice(page, ligneDepart(page, 'Charlie'), 'Archiver');
    await attendreTitres(page, ['Alpha 2', 'Bravo', 'Delta']);
    expect(await possibles(page)).toEqual({ annuler: true, retablir: false });

    await annuler(page);   // désarchive Charlie
    await attendreTitres(page, ['Alpha 2', 'Bravo', 'Charlie', 'Delta']);
    expect(await possibles(page)).toEqual({ annuler: true, retablir: true });
    await annuler(page);   // titre d'origine
    await attendreTitres(page, ['Alpha', 'Bravo', 'Charlie', 'Delta']);
    await annuler(page);   // Delta disparaît
    await attendreTitres(page, ['Alpha', 'Bravo', 'Charlie']);
    expect(await possibles(page)).toEqual({ annuler: false, retablir: true });

    await retablir(page);
    await attendreTitres(page, ['Alpha', 'Bravo', 'Charlie', 'Delta']);
    await retablir(page);
    await attendreTitres(page, ['Alpha 2', 'Bravo', 'Charlie', 'Delta']);
    await retablir(page);
    await attendreTitres(page, ['Alpha 2', 'Bravo', 'Delta']);
    expect(await possibles(page)).toEqual({ annuler: true, retablir: false });
  });

  test('une nouvelle modification après « Annuler » efface ce qu\'on pouvait rétablir', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: trois() });
    await ouvrirChapitre(page, 'Technique');
    await ajouterExercice(page, 'Delta');
    await attendreTitres(page, ['Alpha', 'Bravo', 'Charlie', 'Delta']);
    await annuler(page);
    await attendreTitres(page, ['Alpha', 'Bravo', 'Charlie']);
    expect((await possibles(page)).retablir).toBe(true);

    await ajouterExercice(page, 'Echo');
    await attendreTitres(page, ['Alpha', 'Bravo', 'Charlie', 'Echo']);
    expect(await possibles(page)).toEqual({ annuler: true, retablir: false });
  });

  test('Ctrl/⌘ + Z annule, Ctrl/⌘ + Maj + Z (ou Ctrl + Y) rétablit, hors des champs de saisie @ordinateur', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: trois() });
    await ouvrirChapitre(page, 'Technique');
    await actionExercice(page, ligneDepart(page, 'Bravo'), 'Supprimer…');
    await confirmer(page, 'Supprimer');
    await attendreTitres(page, ['Alpha', 'Charlie']);
    await page.locator('#folder-container').click({ position: { x: 5, y: 5 } });   // le focus n'est dans aucun champ

    await page.keyboard.press('ControlOrMeta+z');
    await attendreTitres(page, ['Alpha', 'Bravo', 'Charlie']);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await attendreTitres(page, ['Alpha', 'Charlie']);
    await page.keyboard.press('ControlOrMeta+z');
    await attendreTitres(page, ['Alpha', 'Bravo', 'Charlie']);
    await page.keyboard.press('ControlOrMeta+y');
    await attendreTitres(page, ['Alpha', 'Charlie']);
  });

  test('annuler un renommage de chapitre, une fusion et une suppression de dossier (enchaînés)', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirChapitre(page, 'Improvisation');
    await ouvrirMenu(page, chapitre(page, 'Improvisation'));
    await choisirAction(page, 'Renommer');
    const menu = page.getByRole('menu').filter({ has: page.getByRole('textbox') });
    await menu.getByRole('textbox').fill('Impro libre');
    await menu.getByRole('textbox').press('Enter');
    await expect(chapitre(page, 'Impro libre')).toBeVisible();

    await annuler(page);
    await expect(chapitre(page, 'Improvisation')).toBeVisible();
    await expect(chapitre(page, 'Impro libre')).toHaveCount(0);
    await retablir(page);
    await expect(chapitre(page, 'Impro libre')).toBeVisible();
  });

  test('au téléphone, le menu « ⋯ » porte Annuler, Rétablir et Corbeille ; Annuler y est grisé quand il n\'y a rien à annuler @mobile', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: trois() });
    await ouvrirChapitre(page, 'Technique');
    await expect(page.locator('#undo-btn')).toBeHidden();
    await page.locator('#more-btn').click();
    await expect(page.getByRole('menuitem')).toHaveText(['Annuler', 'Rétablir', 'Corbeille']);
    await expect(page.getByRole('menuitem', { name: 'Annuler', exact: true })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: 'Rétablir', exact: true })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: 'Corbeille' })).toBeEnabled();
    await page.keyboard.press('Escape');

    await ajouterExercice(page, 'Delta');
    await attendreTitres(page, ['Alpha', 'Bravo', 'Charlie', 'Delta']);
    await page.locator('#more-btn').click();
    await expect(page.getByRole('menuitem', { name: 'Annuler', exact: true })).toBeEnabled();
    await page.getByRole('menuitem', { name: 'Annuler', exact: true }).click();
    await attendreTitres(page, ['Alpha', 'Bravo', 'Charlie']);
    await page.locator('#more-btn').click();
    await expect(page.getByRole('menuitem', { name: 'Rétablir', exact: true })).toBeEnabled();
    await page.getByRole('menuitem', { name: 'Rétablir', exact: true }).click();
    await attendreTitres(page, ['Alpha', 'Bravo', 'Charlie', 'Delta']);
  });

  test('à l\'ordinateur, les boutons Annuler / Rétablir du haut sont grisés au départ et portent leur nom @ordinateur', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: trois() });
    await expect(page.locator('#undo-btn')).toBeDisabled();
    await expect(page.locator('#redo-btn')).toBeDisabled();
    await expect(page.locator('#undo-btn')).toHaveAccessibleName('Annuler');
    await expect(page.locator('#redo-btn')).toHaveAccessibleName('Rétablir');
    await ouvrirChapitre(page, 'Technique');
    await ajouterExercice(page, 'Delta');
    await expect(page.locator('#undo-btn')).toBeEnabled();
    await expect(page.locator('#redo-btn')).toBeDisabled();
  });
});
