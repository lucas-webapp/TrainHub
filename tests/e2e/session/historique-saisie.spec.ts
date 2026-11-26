// MODULE « session » (lot 2) — HISTORIQUE : « ＋ Séance passée » (saisie à la main) et « ✎ Modifier cette séance ». Observé en boîte noire (playwright-cli, 25/11/2026) : « Ajouter une séance
// passée » = nom (« Session libre » par défaut), date, heure, exercices effectués (« ＋ Ajouter un exercice » ouvre « Exercice effectué ») avec minutes / secondes / tempo, note, commentaire ;
// « Enregistrer » reste grisé sans exercice ; sans connexion une confirmation prévient que la séance reste sur l'appareil. « ✎ » rouvre le même panneau (« Modifier la séance »).
import { test, expect } from '../support/fixtures';
import { etatSession, idExerciceDepart, journal, journalDuMois, ouvrirSessions } from './aide-session';

const EXOS = ['Alpha', 'Bravo', 'Charlie'];
const historique = (page: any) => page.locator('.gs-history-panel');
const saisie = (page: any) => page.locator('.gs-save-run-panel:visible');
const T = (iso: string) => new Date(iso).getTime();
/** Le journal du mois avec une séance nommée (les séances enregistrées par l'appli portent le nom de la session). */
function journalNomme() {
  const brut = journal('2026-11', [{ date: T('2026-11-24T18:00:00+01:00'), exercices: [{ id: idExerciceDepart('Alpha'), titre: 'Alpha' }, { id: idExerciceDepart('Bravo'), titre: 'Bravo' }] }]);
  const cle = Object.keys(brut)[0], contenu = JSON.parse(brut[cle]);
  contenu.records[0].name = 'Grille';
  return { [cle]: JSON.stringify(contenu) };
}
async function ouvrirHistorique(page: any) {
  await page.clock.setFixedTime(new Date('2026-11-25T10:00:00+01:00'));
  await ouvrirSessions(page);
  await page.getByRole('button', { name: /^Historique/ }).click();
  await expect(historique(page)).toBeVisible();
}

test.describe('Session : historique, saisie et modification @session', () => {
  test('« ＋ Séance passée » : nom, date, heure et exercices effectués ; la séance entre dans le journal à la bonne date @critique', async ({ page, ouvrirAppli }) => {
    await page.clock.setFixedTime(new Date('2026-11-25T10:00:00+01:00'));
    await ouvrirAppli({ etat: etatSession(EXOS), accueil: 'jamais' });
    await ouvrirHistorique(page);
    await historique(page).getByRole('button', { name: /^＋ Séance passée/ }).click();
    const p = saisie(page);
    await expect(p).toContainText('Ajouter une séance passée');
    await expect(p.getByRole('button', { name: 'Enregistrer', exact: true })).toBeDisabled();   // rien à enregistrer sans exercice
    await expect(p.locator('input[type=text]').first()).toHaveValue('Session libre');
    await p.locator('input[type=text]').first().fill('Séance du week-end');
    await p.locator('input[type=date]').fill('2026-11-20');
    await p.locator('input[type=time]').fill('18:30');
    await p.getByRole('button', { name: '＋ Ajouter un exercice' }).click();
    await expect(page.getByText('Exercice effectué', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Tout déplier' }).click();
    await page.getByRole('button', { name: 'Alpha', exact: true }).click();
    await expect(p).toContainText('1 exercice');
    await p.locator('input[type=number]').first().fill('12');
    await p.locator('input[type=number]').first().press('Tab');
    await expect(p).toContainText('12 min · 1 exercice');
    await p.getByRole('radio', { name: /^4 sur 5/ }).click();
    await p.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.getByRole('button', { name: 'Enregistrer quand même' }).click();

    await expect.poll(() => journalDuMois(page)).toHaveLength(1);
    const [s] = await journalDuMois(page);
    expect(s).toMatchObject({ name: 'Séance du week-end', totalSec: 720, manual: true });
    expect(new Date(s.date).toISOString()).toBe('2026-11-20T17:30:00.000Z');
    expect(s.steps.map((x: any) => [x.title, x.actualSec])).toEqual([['Alpha', 720]]);
    await expect(historique(page)).toContainText('Séance du week-end');
    await expect(historique(page)).toContainText('20/11/26 18:30 · 12 min');
    await expect(historique(page)).toContainText('Alpha (12 min)');
  });

  test('« ✎ » rouvre une séance : changer une durée met à jour le journal et l\'historique @critique', async ({ page, ouvrirAppli }) => {
    await page.clock.setFixedTime(new Date('2026-11-25T10:00:00+01:00'));
    await ouvrirAppli({ etat: etatSession(EXOS), reglages: journalNomme(), accueil: 'jamais' });
    await ouvrirHistorique(page);
    await expect(historique(page)).toContainText('Alpha (5 min) · Bravo (5 min)');
    await historique(page).getByTitle('Modifier cette séance (durées, tempo)').click();
    const p = saisie(page);
    await expect(p).toContainText('Modifier la séance');
    await expect(p).toContainText('10 min · 2 exercices');
    await p.locator('input[type=number]').first().fill('8');
    await p.locator('input[type=number]').first().press('Tab');
    await expect(p).toContainText('13 min · 2 exercices');
    await p.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.getByRole('button', { name: 'Enregistrer quand même' }).click();
    await expect.poll(async () => (await journalDuMois(page))[0].steps[0].actualSec).toBe(480);
    const [s] = await journalDuMois(page);
    expect(s.totalSec).toBe(780);
    expect(s.steps[1].actualSec).toBe(300);
    await expect(historique(page)).toContainText('Alpha (8 min) · Bravo (5 min)');
    await expect(historique(page)).toContainText('13 min');
  });

  test('« Annuler » dans la modification laisse la séance intacte', async ({ page, ouvrirAppli }) => {
    await page.clock.setFixedTime(new Date('2026-11-25T10:00:00+01:00'));
    await ouvrirAppli({ etat: etatSession(EXOS), reglages: journalNomme(), accueil: 'jamais' });
    await ouvrirHistorique(page);
    await historique(page).getByTitle('Modifier cette séance (durées, tempo)').click();
    const p = saisie(page);
    await p.locator('input[type=number]').first().fill('30');
    await p.locator('input[type=number]').first().press('Tab');
    await p.getByRole('button', { name: 'Annuler', exact: true }).click();
    const confirmation = page.locator('.app-dialog');
    await expect(confirmation).toContainText('Abandonner les modifications ?');
    await confirmation.getByRole('button', { name: /^Abandonner/ }).click();
    await expect(p).toBeHidden();
    expect((await journalDuMois(page))[0].steps[0].actualSec).toBe(300);
    await expect(historique(page)).toContainText('Alpha (5 min) · Bravo (5 min)');
  });
});
