// MODULE « session » — CHOISIR les exercices : onglets Exercices / Morceaux / Favoris / En cours, recherche, ordre glissable dans l'éditeur. Observé en boîte noire
// (playwright-cli, 25/11/2026) : les onglets portent leur effectif « Favoris (1) » ; la recherche filtre les dossiers et exercices ; dans l'éditeur chaque étape a une poignée
// (⋮⋮) pour la glisser. Détail fin du choix = bancs `choix` et `rafale` (PLAN § 7).
import { test, expect } from '../support/fixtures';
import { glisser } from '../bibliotheque/aide-bibliotheque';
import {
  bandeau, champRecherche, choisir, etatSession, ligneSession, ongletChoix, ouvrirChoix, ouvrirSessions, poigneeEtape, etape, rondExercice, sessionsEnregistrees, termine, titresEtapes,
  boutonEnregistrer, etapes,
} from './aide-session';

const EXOS = ['Alpha', 'Bravo', 'Charlie', 'Delta'];

test.describe('Session : choisir les exercices @session', () => {
  test('les onglets Favoris et En cours ne montrent que les exercices concernés, avec leur effectif ; Morceaux est vide sans morceau @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatSession(['Alpha', { titre: 'Bravo', extra: { favorite: true } }, { titre: 'Charlie', extra: { inProgress: true } }, { titre: 'Delta', extra: { favorite: true, inProgress: true } }]) });
    await ouvrirSessions(page);
    await ouvrirChoix(page);
    await expect(ongletChoix(page, 'Exercices')).toHaveText('Exercices (4)');
    await expect(ongletChoix(page, 'Morceaux')).toHaveText('Morceaux (0)');
    await expect(ongletChoix(page, 'Favoris')).toHaveText('★ Favoris (2)');
    await expect(ongletChoix(page, 'En cours')).toHaveText('● En cours (2)');

    await ongletChoix(page, 'Favoris').click();
    await expect(ongletChoix(page, 'Favoris')).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Tout déplier' }).click();
    await expect(rondExercice(page, 'Bravo')).toBeVisible();
    await expect(rondExercice(page, 'Delta')).toBeVisible();
    await expect(rondExercice(page, 'Alpha')).toHaveCount(0);
    await expect(rondExercice(page, 'Charlie')).toHaveCount(0);

    await ongletChoix(page, 'En cours').click();
    await page.getByRole('button', { name: 'Tout déplier' }).click();
    await expect(rondExercice(page, 'Charlie')).toBeVisible();
    await expect(rondExercice(page, 'Delta')).toBeVisible();
    await expect(rondExercice(page, 'Bravo')).toHaveCount(0);

    // Un choix fait dans un onglet reste dans la session quand on change d'onglet.
    await choisir(page, 'Delta');
    await ongletChoix(page, 'Favoris').click();
    await page.getByRole('button', { name: 'Tout déplier' }).click();
    await expect(rondExercice(page, 'Delta')).toHaveAccessibleName('1 Delta');
    await expect(bandeau(page)).toContainText('Delta');
    await ongletChoix(page, 'Morceaux').click();
    await expect(rondExercice(page, 'Delta')).toHaveCount(0);
    await termine(page).click();
    await expect(etapes(page)).toHaveCount(1);
  });

  test('la recherche filtre la liste ; vider le champ rend tout ; le choix déjà fait reste numéroté', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatSession(['Gamme majeure', 'Arpèges', 'Gamme mineure', 'Slap']) });
    await ouvrirSessions(page);
    await ouvrirChoix(page);
    await choisir(page, 'Slap');
    await champRecherche(page).fill('gamme');
    await expect(rondExercice(page, 'Gamme majeure')).toBeVisible();
    await expect(rondExercice(page, 'Gamme mineure')).toBeVisible();
    await expect(rondExercice(page, 'Arpèges')).toHaveCount(0);
    await expect(rondExercice(page, 'Slap')).toHaveCount(0);
    await choisir(page, 'Gamme mineure');
    await expect(rondExercice(page, 'Gamme mineure')).toHaveAccessibleName(/^2 /);
    await champRecherche(page).fill('');
    await expect(rondExercice(page, 'Arpèges')).toBeVisible();
    await expect(rondExercice(page, 'Slap')).toHaveAccessibleName('1 Slap');
    await champRecherche(page).fill('zzz');
    await expect(rondExercice(page, 'Slap')).toHaveCount(0);
    await expect(rondExercice(page, 'Gamme majeure')).toHaveCount(0);
  });

  test('l\'ordre se change en glissant la poignée d\'une étape dans l\'éditeur ; il est enregistré @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatSession(EXOS, [{ nom: 'Grille', exercices: [['Alpha', 5], ['Bravo', 6], ['Charlie', 7]] }]) });
    await ouvrirSessions(page);
    await ligneSession(page, 'Grille').locator('.gs-session-name').click();
    await expect.poll(() => titresEtapes(page)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    await glisser(page, poigneeEtape(page, 'Charlie'), etape(page, 'Alpha'), 'haut');
    await expect.poll(() => titresEtapes(page)).toEqual(['Charlie', 'Alpha', 'Bravo']);
    await boutonEnregistrer(page).click();
    await expect.poll(async () => (await sessionsEnregistrees(page))[0]).toMatchObject({ exercices: ['Charlie', 'Alpha', 'Bravo'], minutes: [7, 5, 6] });
    await page.reload();
    await ouvrirSessions(page);
    await ligneSession(page, 'Grille').locator('.gs-session-name').click();
    await expect.poll(() => titresEtapes(page)).toEqual(['Charlie', 'Alpha', 'Bravo']);
  });
});
