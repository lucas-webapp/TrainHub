// MODULE « session » (lot 2) — RÉPÉTITION d'une programmation. Observé en boîte noire (playwright-cli, 25/11/2026) : dans « Ajouter le … » du calendrier, la liste « Répétition » propose « Une seule
// fois », « Chaque semaine », « Toutes les 2 / 3 / 4 semaines » et « Chaque mois (même jour) » ; la session est alors programmée à chaque échéance.
import { test, expect } from '../support/fixtures';
import { etatSession, ouvrirSessions, planEnregistre } from './aide-session';

const calendrier = (page: any) => page.locator('.gs-cal-panel');

async function programmer(page: any, repetition: string) {
  await page.clock.setFixedTime(new Date('2026-11-25T10:00:00+01:00'));
  await ouvrirSessions(page);
  await page.getByRole('button', { name: /^Calendrier/ }).click();
  await calendrier(page).getByRole('button', { name: '27 novembre', exact: true }).click();
  const ajout = page.getByText('Ajouter le vendredi 27 novembre', { exact: true }).locator('xpath=..');
  await ajout.getByRole('combobox', { name: 'Répétition' }).selectOption({ label: repetition });
  await ajout.getByRole('button', { name: /^Grille/ }).click();
}

test.describe('Session : répétition d\'une programmation @session', () => {
  test('« Chaque semaine » programme la session tous les 7 jours à partir du jour choisi @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirAppli({ etat: etatSession(['Alpha'], [{ nom: 'Grille', exercices: ['Alpha'] }]), accueil: 'jamais' });
    await programmer(page, 'Chaque semaine');
    await expect.poll(async () => (await planEnregistre(page)).length).toBeGreaterThan(3);
    const dates = (await planEnregistre(page)).map((p) => p.date).sort();
    expect(dates.slice(0, 4)).toEqual(['2026-11-27', '2026-12-04', '2026-12-11', '2026-12-18']);
    expect(new Set((await planEnregistre(page)).map((p) => p.sessionId))).toEqual(new Set(['sess-0']));
    await expect(calendrier(page).getByRole('button', { name: '4 décembre', exact: true })).toContainText('Grille');
  });

  test('« Chaque mois (même jour) » : le 27 de chaque mois ; « Une seule fois » : une seule date', async ({ page, ouvrirAppli }) => {
    await ouvrirAppli({ etat: etatSession(['Alpha'], [{ nom: 'Grille', exercices: ['Alpha'] }]), accueil: 'jamais' });
    await programmer(page, 'Chaque mois (même jour)');
    await expect.poll(async () => (await planEnregistre(page)).length).toBeGreaterThan(2);
    expect((await planEnregistre(page)).map((p) => p.date).sort().slice(0, 3)).toEqual(['2026-11-27', '2026-12-27', '2027-01-27']);
  });

  test('« Une seule fois » ne programme qu\'une date', async ({ page, ouvrirAppli }) => {
    await ouvrirAppli({ etat: etatSession(['Alpha'], [{ nom: 'Grille', exercices: ['Alpha'] }]), accueil: 'jamais' });
    await programmer(page, 'Une seule fois');
    await expect.poll(() => planEnregistre(page)).toEqual([expect.objectContaining({ date: '2026-11-27' })]);
  });
});
