// MODULE « session » — CALENDRIER et PROGRAMMATION d'une session future. Observé en boîte noire (playwright-cli, 25/11/2026) : l'icône « Calendrier » ouvre un panneau flottant
// (mois, flèches, « Aujourd'hui ») ; un clic sur un jour ouvre « Ajouter le … » : « + Nouvelle session pour ce jour » ou choisir une session existante (répétition : « Une seule fois »,
// …) ; la séance programmée s'affiche dans la case, avec « prévu N min » et ✎ / ✕ ; une séance déjà faite y est marquée ✓. Le plan est dans settings.sessionPlan ; supprimer la
// session retire ses séances du calendrier (avertissement). Détail fin = banc `programmation` (PLAN § 7).
import { test, expect } from '../support/fixtures';
import { actionSession, etatSession, idExerciceDepart, journal, ligneSession, ongletListe, ouvrirSessions, planEnregistre } from './aide-session';
import { confirmer } from '../bibliotheque/aide-bibliotheque';

const EXOS = ['Alpha', 'Bravo'];
const grille = () => etatSession(EXOS, [{ nom: 'Grille', exercices: [['Alpha', 6], ['Bravo', 5]] }, { nom: 'Courte', exercices: [['Alpha', 3]] }]);
const calendrier = (page: any) => page.locator('.backups-panel').filter({ hasText: 'Calendrier des sessions' });
const jour = (page: any, nom: string) => calendrier(page).getByRole('button', { name: nom, exact: true });

async function ouvrirCalendrier(page: any) {
  await page.clock.setFixedTime(new Date('2026-11-25T10:00:00+01:00'));
  await ouvrirSessions(page);
  await page.getByRole('button', { name: /^Calendrier/ }).click();
  await expect(calendrier(page)).toBeVisible();
}

test.describe('Session : calendrier et programmation @session', () => {
  test('programmer une session un jour futur : elle apparaît dans la case du jour, dans le plan enregistré et dans l\'onglet « À venir » @critique', async ({ page, ouvrirAppli }) => {
    await page.clock.setFixedTime(new Date('2026-11-25T10:00:00+01:00'));
    await ouvrirAppli({ etat: grille() });
    await ouvrirCalendrier(page);
    await expect(calendrier(page)).toContainText('novembre 2026');
    await jour(page, '27 novembre').click();
    const ajout = page.getByText('Ajouter le vendredi 27 novembre', { exact: true }).locator('xpath=..');
    await expect(ajout).toContainText('Nouvelle session pour ce jour');
    await ajout.getByRole('button', { name: /^Grille/ }).click();
    await expect(page.locator('.toast').filter({ hasText: '« Grille » programmée le vendredi 27 novembre' })).toBeVisible();
    await expect(jour(page, '27 novembre')).toContainText('Grille');
    await expect(calendrier(page)).toContainText(/vendredi 27 novembre/i);
    await expect(calendrier(page)).toContainText('prévu 11 min');
    await expect.poll(() => planEnregistre(page)).toEqual([expect.objectContaining({ date: '2026-11-27' })]);
    expect((await planEnregistre(page))[0].sessionId).toBe('sess-0');

    await calendrier(page).getByRole('button', { name: 'Fermer' }).click();
    await ongletListe(page, /^À venir/).click();
    const prevues = page.locator('.gs-upcoming .gs-up-row');
    await expect(prevues).toHaveCount(1);
    await expect(page.locator('.gs-upcoming .gs-up-day')).toHaveText('vendredi 27 novembre');
    await expect(prevues.first()).toContainText('Grille');
    await expect(prevues.first()).toContainText('2 exercices · 11 min');
    await prevues.first().getByTitle('Retirer du planning').click();
    await expect.poll(() => planEnregistre(page)).toEqual([]);
  });

  test('le compteur de l\'onglet « À venir » se met à jour dès qu\'on programme une session', async ({ page, ouvrirAppli }) => {
    test.fail(true, 'SE-01 : le compteur de « À venir » reste à 0 après la programmation (il ne suit qu\'au rechargement) ; la liste, elle, est juste');
    await page.clock.setFixedTime(new Date('2026-11-25T10:00:00+01:00'));
    await ouvrirAppli({ etat: grille() });
    await ouvrirCalendrier(page);
    await jour(page, '27 novembre').click();
    await page.getByText('Ajouter le vendredi 27 novembre', { exact: true }).locator('xpath=..').getByRole('button', { name: /^Grille/ }).click();
    await calendrier(page).getByRole('button', { name: 'Fermer' }).click();
    await expect(ongletListe(page, /^À venir/)).toContainText('1');
  });

  test('une séance déjà faite est marquée ✓ dans sa case ; un jour sans rien dit « Rien de prévu »', async ({ page, ouvrirAppli }) => {
    await page.clock.setFixedTime(new Date('2026-11-25T10:00:00+01:00'));
    await ouvrirAppli({ etat: grille(), reglages: journal('2026-11', [{ date: new Date('2026-11-24T18:00:00+01:00').getTime(), exercices: [{ id: idExerciceDepart('Alpha'), titre: 'Alpha' }] }]) });
    await ouvrirCalendrier(page);
    await expect(jour(page, '24 novembre')).toContainText('✓');
    await jour(page, '26 novembre').click();
    await expect(calendrier(page)).toContainText('Rien de prévu ce jour-là.');
  });

  test('retirer une séance programmée la sort du plan sans toucher à la session', async ({ page, ouvrirAppli }) => {
    await page.clock.setFixedTime(new Date('2026-11-25T10:00:00+01:00'));
    await ouvrirAppli({ etat: etatSession(EXOS, [{ nom: 'Grille', exercices: [['Alpha', 6]] }], { sessionPlan: [{ id: 'p1', date: '2026-11-27', sessionId: 'sess-0', instrumentId: 'esp-0' }] }) });
    await ouvrirCalendrier(page);
    await jour(page, '27 novembre').click();
    await expect(calendrier(page)).toContainText('prévu 6 min');
    await page.keyboard.press('Escape');   // referme la fenêtre « Ajouter le … » ouverte par le clic sur le jour
    await expect(page.getByText('Ajouter le vendredi 27 novembre', { exact: true })).toBeHidden();
    await calendrier(page).getByRole('button', { name: '✕' }).first().click();
    await expect.poll(() => planEnregistre(page)).toEqual([]);
    await expect(jour(page, '27 novembre')).not.toContainText('Grille');
    await calendrier(page).getByRole('button', { name: 'Fermer' }).click();
    await expect(ligneSession(page, 'Grille')).toBeVisible();
  });

  test('« Programmer au calendrier… » depuis le menu d\'une session ; supprimer la session prévient et retire ses séances du calendrier', async ({ page, ouvrirAppli }) => {
    await page.clock.setFixedTime(new Date('2026-11-25T10:00:00+01:00'));
    await ouvrirAppli({ etat: etatSession(EXOS, [{ nom: 'Grille', exercices: [['Alpha', 6]] }], { sessionPlan: [{ id: 'p1', date: '2026-11-27', sessionId: 'sess-0', instrumentId: 'esp-0' }] }) });
    await ouvrirSessions(page);
    await actionSession(page, 'Grille', 'Programmer au calendrier…');
    await expect(calendrier(page)).toBeVisible();
    await calendrier(page).getByRole('button', { name: 'Fermer' }).click();
    await actionSession(page, 'Grille', 'Supprimer…');
    await expect(page.getByRole('dialog')).toContainText('Prévue 1 fois au calendrier (prochaine : vendredi 27 novembre)');
    await confirmer(page);
    await expect(ligneSession(page, 'Grille')).toHaveCount(0);
    await expect.poll(() => planEnregistre(page)).toEqual([]);
  });
});
