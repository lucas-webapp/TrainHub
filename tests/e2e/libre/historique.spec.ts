// MODULE « libre » — la séance libre dans l'HISTORIQUE et « SESSION DEPUIS UNE SÉANCE ». Observé en boîte noire (playwright-cli, 25/11/2026) : une séance libre enregistrée apparaît dans l'historique du
// bouton « Session » comme les autres (nom « Session libre », date, durée, exercices avec leur durée). Deux chemins vers « Créer une session avec ces exercices » : le bouton « Créer une session »
// du message de fin, et le « ＋ » de la séance dans l'Historique. La fenêtre propose un nom (« Session du JJ-MM-AAAA »), une case par exercice et la durée de chacun.
import { test, expect } from '../support/fixtures';
import {
  arreterEtEnregistrer, demarrerSur, ecouler, journalDuMois, laisserPasser, ouvrirLibre, ouvrirSessions, passerA, sec, min,
} from './aide-libre';
import { ligneSession, sessionEnregistree } from '../session/aide-session';

const historique = (page: any) => page.locator('.gs-history-panel');
const boiteCreation = (page: any) => page.getByText('Créer une session avec ces exercices', { exact: true }).locator('xpath=..');

/** Séance libre enregistrée : 1 min 30 s sur Alpha, 45 s sur Bravo. */
async function seanceEnregistree(page: any, ouvrirAppli: any) {
  await ouvrirLibre(page, ouvrirAppli);
  await demarrerSur(page, 'Alpha');
  await ecouler(page, min(1) + sec(30));
  await passerA(page, 'Bravo');
  await ecouler(page, sec(45));
  await arreterEtEnregistrer(page);
}
async function ouvrirHistorique(page: any) {
  await ouvrirSessions(page);
  await page.getByRole('button', { name: /^Historique/ }).click();
  await laisserPasser(page);
  await expect(historique(page)).toContainText('Historique des sessions');
}

test.describe('Libre : historique et session depuis une séance @libre', () => {
  test('la séance libre enregistrée apparaît dans l\'Historique avec sa date, sa durée et ses exercices @critique', async ({ page, ouvrirAppli }) => {
    await seanceEnregistree(page, ouvrirAppli);
    await ouvrirHistorique(page);
    const h = historique(page);
    await expect(h.getByRole('tab', { name: 'Séances' })).toHaveAttribute('aria-selected', 'true');
    await expect(h).toContainText('Session libre');
    await expect(h).toContainText(/25\/11\/26 10:02 · 2 min 1\d s/);
    await expect(h).toContainText(/Alpha \(1 min 3\d s\) · Bravo \(0 min 4\d s\)/);
    for (const onglet of ['Jour', 'Semaine', 'Mois', 'Année']) {
      await h.getByRole('tab', { name: onglet }).click();
      await expect(h.getByRole('tab', { name: onglet })).toHaveAttribute('aria-selected', 'true');
      await expect(h).toContainText('Alpha');
    }
    await expect(h).not.toContainText(/Non enregistrées \([1-9]/);
  });

  test('« ＋ » de la séance : crée une session avec ses exercices (nom proposé, cases, durées) ; elle apparaît dans la liste @critique', async ({ page, ouvrirAppli }) => {
    await seanceEnregistree(page, ouvrirAppli);
    await ouvrirHistorique(page);
    await historique(page).getByTitle('Créer une session avec les exercices de cette séance').first().click();
    const boite = boiteCreation(page);
    await expect(boite).toBeVisible();
    await expect(boite.getByRole('textbox')).toHaveValue('Session du 25-11-2026');
    await expect(boite.getByRole('checkbox', { name: /Alpha/ })).toBeChecked();
    await expect(boite.getByRole('checkbox', { name: /Bravo/ })).not.toBeChecked();   // moins d'une minute de travail : décoché d'office
    await expect(boite).toContainText(/1 exercice · \d+ min/);
    await boite.getByRole('textbox').fill('Reprise du soir');
    await boite.getByRole('button', { name: 'Créer la session' }).click();
    await expect.poll(async () => (await sessionEnregistree(page, 'Reprise du soir'))?.exercices[0]).toBe('Alpha');
    const s = await sessionEnregistree(page, 'Reprise du soir');
    expect(s!.exercices).toEqual(['Alpha']);
    expect(s!.minutes[0]).toBeGreaterThanOrEqual(1);
    expect(s!.minutes[0]).toBeLessThanOrEqual(2);
    await expect(page.locator('.toast').filter({ hasText: '« Reprise du soir » créée' })).toBeVisible();
    await historique(page).getByRole('button', { name: 'Fermer' }).click();
    await expect(ligneSession(page, 'Reprise du soir')).toBeVisible();
  });

  test('le message de fin propose « Créer une session » : même fenêtre, mêmes exercices', async ({ page, ouvrirAppli }) => {
    await seanceEnregistree(page, ouvrirAppli);
    const message = page.locator('.toast').filter({ hasText: 'Entraînement enregistré dans l\'historique' });
    await expect(message).toContainText('en faire une session ?');
    await message.getByRole('button', { name: 'Créer une session' }).click();
    const boite = boiteCreation(page);
    await expect(boite).toBeVisible();
    await expect(boite.getByRole('textbox')).toHaveValue('Session du 25-11-2026');
    await expect(boite.getByRole('checkbox', { name: /Alpha/ })).toBeChecked();
    await boite.getByRole('button', { name: 'Créer la session' }).click();
    await expect.poll(async () => (await sessionEnregistree(page, 'Session du 25-11-2026'))?.exercices[0]).toBe('Alpha');
    await expect(page.locator('.toast').filter({ hasText: '« Session du 25-11-2026 » créée' })).toBeVisible();
  });

  test('décocher un exercice dans la fenêtre : il n\'entre pas dans la session créée', async ({ page, ouvrirAppli }) => {
    await seanceEnregistree(page, ouvrirAppli);
    await ouvrirHistorique(page);
    await historique(page).getByTitle('Créer une session avec les exercices de cette séance').first().click();
    const boite = boiteCreation(page);
    await boite.getByRole('checkbox', { name: /Alpha/ }).check();
    await boite.getByRole('checkbox', { name: /Bravo/ }).check();
    await expect(boite).toContainText('2 exercices');
    await boite.getByRole('checkbox', { name: /Alpha/ }).uncheck();
    await expect(boite).toContainText('1 exercice');
    await boite.getByRole('button', { name: 'Créer la session' }).click();
    await expect.poll(async () => (await sessionEnregistree(page, 'Session du 25-11-2026'))?.exercices).toEqual(['Bravo']);
  });

  test('supprimer la séance libre de l\'Historique la retire du journal', async ({ page, ouvrirAppli }) => {
    await seanceEnregistree(page, ouvrirAppli);
    expect(await journalDuMois(page)).toHaveLength(1);
    await ouvrirHistorique(page);
    await historique(page).getByTitle('Supprimer cette entrée').first().click();
    await page.locator('.app-dialog').getByRole('button', { name: /^Supprimer/ }).click();
    await expect(historique(page)).not.toContainText('Session libre');
    await expect.poll(async () => (await journalDuMois(page)).filter((r: any) => !r.deleted).length).toBe(0);
  });
});
