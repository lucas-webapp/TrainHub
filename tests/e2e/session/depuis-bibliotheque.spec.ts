// MODULE « session » (lot 2) — AJOUTER UN EXERCICE À UNE SESSION depuis la bibliothèque. Observé en boîte noire (playwright-cli, 25/11/2026) : le menu clic droit d'un exercice propose
// « Ajouter à une session… » : « ＋ Nouvelle session avec cet exercice » (demande un nom : « Elle contiendra « Alpha ». ») ou une session existante (« Courte (déjà dedans) » si l'exercice y est déjà).
import { test, expect } from '../support/fixtures';
import { actionExercice } from '../bibliotheque/aide-bibliotheque';
import { fiche, ouvrirTechnique } from '../fiche/aide-fiche';
import { etatSession, ligneSession, ouvrirSessions, sessionEnregistree, sessionsEnregistrees } from './aide-session';

const etat = () => etatSession(['Alpha', 'Bravo'], [{ nom: 'Grille', exercices: [['Alpha', 6]] }]);

test.describe('Session : depuis la bibliothèque @session', () => {
  test('« Ajouter à une session… » → une session existante : l\'exercice s\'ajoute à la fin ; s\'il y est déjà, la session est marquée « déjà dedans » @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirTechnique(page);
    await actionExercice(page, fiche(page, 'Bravo'), 'Ajouter à une session…');
    await page.getByRole('menu').getByRole('button', { name: /^Grille/ }).click();
    await expect.poll(async () => (await sessionEnregistree(page, 'Grille'))?.exercices).toEqual(['Alpha', 'Bravo']);
    await actionExercice(page, fiche(page, 'Bravo'), 'Ajouter à une session…');
    await expect(page.getByRole('menu').getByRole('button', { name: 'Grille (déjà dedans)' })).toBeVisible();
    await page.keyboard.press('Escape');
    await ouvrirSessions(page);
    await expect(ligneSession(page, 'Grille')).toContainText('2 exercices');
  });

  test('« ＋ Nouvelle session avec cet exercice » crée une session contenant cet exercice, au nom choisi', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirTechnique(page);
    await actionExercice(page, fiche(page, 'Bravo'), 'Ajouter à une session…');
    await page.getByRole('menu').getByRole('button', { name: '＋ Nouvelle session avec cet exercice' }).click();
    const boite = page.locator('.app-dialog');
    await expect(boite).toContainText('Elle contiendra « Bravo ».');
    await boite.getByRole('textbox').fill('Juste Bravo');
    await boite.getByRole('button', { name: /^Cr[ée]er$/ }).click();
    await expect.poll(async () => (await sessionsEnregistrees(page)).find((s) => s.nom === 'Juste Bravo')?.exercices).toEqual(['Bravo']);
    expect((await sessionsEnregistrees(page)).length).toBe(2);
  });
});
