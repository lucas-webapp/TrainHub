// MODULE « session » (lot 2) — l'onglet « Morceaux » du CHOIX des exercices, avec de vrais morceaux (chapitre `kind: 'songs'`). Observé en boîte noire (playwright-cli, 25/11/2026) : l'onglet
// porte l'effectif des morceaux ; il montre le chapitre de morceaux avec ses vues (Artistes, Styles, Techniques, Travail, Tous) ; un morceau se choisit comme un exercice (rond de rang)
// et se mélange aux exercices dans la même session ; « ★ Favoris » compte aussi les morceaux favoris. Le détail des morceaux (fiche, artiste, styles) est le module `morceaux`.
import { test, expect } from '../support/fixtures';
import { avecMorceaux, bandeau, choisir, etatSession, etapes, ongletChoix, ouvrirChoix, ouvrirSessions, rondExercice, sessionsEnregistrees, termine, titresEtapes, boutonEnregistrer } from './aide-session';

const etat = () => avecMorceaux(etatSession(['Alpha', 'Bravo']), ['Autumn Leaves', { titre: 'Blue Bossa', favori: true }]);

test.describe('Session : choisir des morceaux @session', () => {
  test('l\'onglet « Morceaux » compte et liste les morceaux ; on les choisit comme des exercices et on les mélange avec eux @critique', async ({ ouvrirAppli, page }) => {
    await ouvrirAppli({ etat: etat(), accueil: 'jamais' });
    await ouvrirSessions(page);
    await ouvrirChoix(page);
    await expect(ongletChoix(page, 'Exercices')).toHaveText('Exercices (2)');
    await expect(ongletChoix(page, 'Morceaux')).toHaveText('Morceaux (2)');
    await ongletChoix(page, 'Morceaux').click();
    await expect(ongletChoix(page, 'Morceaux')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'Tout déplier' })).toBeVisible();
    await page.getByRole('button', { name: 'Tout déplier' }).click();
    for (const vue of ['Artistes', 'Styles', 'Techniques', 'Travail', 'Tous']) await expect(page.getByRole('button', { name: vue, exact: true })).toBeVisible();
    await expect(rondExercice(page, 'Alpha')).toHaveCount(0);   // les exercices ne sont pas dans l'onglet des morceaux
    await choisir(page, 'Blue Bossa');
    await expect(rondExercice(page, 'Blue Bossa')).toHaveAccessibleName(/^1 /);
    await expect(bandeau(page)).toContainText('Blue Bossa');

    await ongletChoix(page, 'Exercices').click();
    await page.getByRole('button', { name: 'Tout déplier' }).click();
    await choisir(page, 'Alpha');
    await expect(rondExercice(page, 'Alpha')).toHaveAccessibleName(/^2 /);   // le rang continue d'un onglet à l'autre
    await termine(page).click();
    await expect.poll(() => titresEtapes(page)).toEqual(['Blue Bossa', 'Alpha']);
    await boutonEnregistrer(page).click();
    await expect.poll(async () => (await sessionsEnregistrees(page))[0].exercices).toEqual(['Blue Bossa', 'Alpha']);
    void etapes;
  });

  test('l\'onglet « ★ Favoris » compte aussi les morceaux favoris', async ({ ouvrirAppli, page }) => {
    await ouvrirAppli({ etat: etat(), accueil: 'jamais' });
    await ouvrirSessions(page);
    await ouvrirChoix(page);
    await expect(ongletChoix(page, 'Favoris')).toHaveText('★ Favoris (1)');
    await ongletChoix(page, 'Favoris').click();
    await page.getByRole('button', { name: 'Tout déplier' }).click();
    await expect(rondExercice(page, 'Blue Bossa')).toBeVisible();
    await expect(rondExercice(page, 'Autumn Leaves')).toHaveCount(0);
  });
});
