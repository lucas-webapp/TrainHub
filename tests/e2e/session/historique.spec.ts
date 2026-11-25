// MODULE « session » — HISTORIQUE des séances et SESSION CRÉÉE DEPUIS UNE SÉANCE. Observé en boîte noire (playwright-cli, 25/11/2026) : l'icône « Historique » ouvre un panneau
// flottant (onglets Séances / Jour / Semaine / Mois / Année / Non enregistrées) ; chaque séance a « ＋ » (créer une session avec ses exercices), « ✎ » (modifier durées et tempo)
// et « ✕ » (supprimer) ; « ＋ Séance passée » ajoute une séance à la main. Le journal est dans `trainhub.log.AAAA-MM`.
import { test, expect } from '../support/fixtures';
import { etatSession, idExerciceDepart, journal, journalDuMois, ligneSession, ouvrirSessions, sessionEnregistree } from './aide-session';

const EXOS = ['Alpha', 'Bravo', 'Charlie'];
const il = (jours: number, heure = 18) => new Date(`2026-11-${String(25 - jours).padStart(2, '0')}T${heure}:00:00+01:00`).getTime();
const seances = () => journal('2026-11', [
  { date: il(1), exercices: [{ id: idExerciceDepart('Alpha'), titre: 'Alpha', bpm: 80 }, { id: idExerciceDepart('Bravo'), titre: 'Bravo' }] },
  { date: il(3), exercices: [{ id: idExerciceDepart('Charlie'), titre: 'Charlie' }] },
]);
const historique = (page: any) => page.locator('.gs-history-panel');

test.describe('Session : historique @session', () => {
  test('l\'historique liste les séances de la plus récente à la plus ancienne, avec exercices et durées ; les onglets regroupent par jour, semaine, mois, année @critique', async ({ page, ouvrirAppli }) => {
    await page.clock.setFixedTime(new Date('2026-11-25T10:00:00+01:00'));
    await ouvrirAppli({ etat: etatSession(EXOS), reglages: seances() });
    await ouvrirSessions(page);
    await page.getByRole('button', { name: /^Historique/ }).click();
    const h = historique(page);
    await expect(h).toContainText('Historique des sessions');
    await expect(h.getByRole('tab', { name: 'Séances' })).toHaveAttribute('aria-selected', 'true');
    await expect(h).toContainText('24/11/26 18:00');
    await expect(h).toContainText('Alpha (5 min, 80 BPM) · Bravo (5 min)');
    await expect(h).toContainText('22/11/26 18:00');
    await expect(h).toContainText('Charlie (5 min)');
    const ordre = (await h.innerText());
    expect(ordre.indexOf('24/11/26')).toBeLessThan(ordre.indexOf('22/11/26'));
    for (const onglet of ['Jour', 'Semaine', 'Mois', 'Année']) {
      await h.getByRole('tab', { name: onglet }).click();
      await expect(h.getByRole('tab', { name: onglet })).toHaveAttribute('aria-selected', 'true');
      await expect(h).toContainText('Alpha');
      await expect(h).toContainText('Charlie');
    }
    await h.getByRole('button', { name: 'Fermer' }).click();
    await expect(h).toBeHidden();
  });

  test('« ＋ » crée une session avec les exercices d\'une séance (cases à cocher, nom proposé) ; elle apparaît dans la liste @critique', async ({ page, ouvrirAppli }) => {
    await page.clock.setFixedTime(new Date('2026-11-25T10:00:00+01:00'));
    await ouvrirAppli({ etat: etatSession(EXOS), reglages: seances() });
    await ouvrirSessions(page);
    await page.getByRole('button', { name: /^Historique/ }).click();
    await historique(page).getByTitle('Créer une session avec les exercices de cette séance').first().click();
    const boite = page.getByText('Créer une session avec ces exercices', { exact: true }).locator('xpath=..');
    await expect(boite).toBeVisible();
    const nom = boite.getByRole('textbox');
    await expect(nom).toHaveValue('Session du 24-11-2026');
    await expect(boite.getByRole('checkbox', { name: /Alpha/ })).toBeChecked();
    await expect(boite.getByRole('checkbox', { name: /Bravo/ })).toBeChecked();
    await boite.getByRole('checkbox', { name: /Bravo/ }).uncheck();
    await expect(boite).toContainText('1 exercice · 5 min');
    await nom.fill('Reprise de mardi');
    await boite.getByRole('button', { name: 'Créer la session' }).click();
    await expect.poll(() => sessionEnregistree(page, 'Reprise de mardi')).toMatchObject({ exercices: ['Alpha'], minutes: [5] });
    await expect(page.locator('.toast').filter({ hasText: '« Reprise de mardi » créée' })).toBeVisible();
    await historique(page).getByRole('button', { name: 'Fermer' }).click();
    await expect(ligneSession(page, 'Reprise de mardi')).toContainText('1 exercice · 5 min');
  });

  test('supprimer une séance de l\'historique la retire du journal', async ({ page, ouvrirAppli }) => {
    await page.clock.setFixedTime(new Date('2026-11-25T10:00:00+01:00'));
    await ouvrirAppli({ etat: etatSession(EXOS), reglages: seances() });
    await ouvrirSessions(page);
    await page.getByRole('button', { name: /^Historique/ }).click();
    expect(await journalDuMois(page)).toHaveLength(2);
    await historique(page).getByTitle('Supprimer cette entrée').first().click();
    const confirmation = page.locator('.app-dialog');
    await confirmation.getByRole('button', { name: /^Supprimer/ }).click();
    await expect(historique(page)).not.toContainText('24/11/26 18:00');
    await expect(historique(page)).toContainText('22/11/26 18:00');
    await expect.poll(async () => (await journalDuMois(page)).filter((r: any) => !(r.deleted)).map((r: any) => r.date).length).toBeGreaterThan(0);
  });
});
