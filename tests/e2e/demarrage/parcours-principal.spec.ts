// MODULE « demarrage » — le parcours principal, sur TOUS les appareils (@smoke : toujours filmé).
// L'appli s'ouvre sans connexion (données dans le navigateur), on crée un exercice, on lance puis arrête le métronome, et après un
// rechargement l'exercice est toujours là.
import { test, expect } from '../support/fixtures';
import { CLE_ETAT } from '../support/appli';

test.use({ video: 'on' });

test.describe('Parcours principal @smoke @critique @demarrage', () => {
  test('ouvrir l\'appli, créer un exercice, jouer le métronome, recharger', async ({ ouvrirAppli, garde }) => {
    const page = await ouvrirAppli({ accueil: 'garder' });
    await expect(page).toHaveTitle(/TrainHub/);
    // Firebase est branché sur les émulateurs (et jamais sur la production).
    await expect.poll(() => page.evaluate(() => (window as any).__EMULATEURS_BRANCHES === true && (window as any).firebase.app().options.projectId)).toMatch(/^demo-/);

    // Première visite : la fenêtre d'accueil propose de se connecter ; on continue sans compte (données dans le navigateur).
    const accueil = page.locator('#cloud-guard-modal');
    await expect(accueil).toBeVisible();
    await expect(accueil.getByRole('button', { name: 'Se connecter avec Google' })).toBeVisible();
    await accueil.getByRole('button', { name: 'Continuer sans compte' }).click();
    await expect(accueil).toBeHidden();

    // Un exercice, ajouté dans le chapitre ouvert (Technique, par défaut).
    const saisie = page.getByPlaceholder('Ajouter un exercice…');
    await saisie.fill('Gamme de do majeur');
    await saisie.press('Enter');
    const titres = page.locator('#folder-container .exercise .exercise-title');
    await expect(titres).toHaveCount(1);
    await expect(titres.first()).toHaveValue('Gamme de do majeur');

    // Le métronome : Jouer, le chrono avance, Arrêter.
    await page.getByRole('button', { name: 'Métronome', exact: true }).click();
    const jouer = page.locator('button.metro-play-btn-big');
    await expect(jouer).toBeVisible();
    await expect(jouer).toHaveText(/Jouer/);
    await jouer.click();
    await expect(jouer).toHaveText(/Arrêter/);
    // le chrono du métronome avance : la lecture tourne vraiment
    await expect(page.locator('.metro-chrono-value').first()).not.toHaveText('00:00', { timeout: 5_000 });
    await jouer.click();
    await expect(jouer).toHaveText(/Jouer/);

    // Rechargement : l'exercice est resté dans le navigateur (mode sans connexion), et la fenêtre d'accueil ne revient pas dans cet onglet.
    await page.reload();
    await expect(page.locator('#folder-container .exercise .exercise-title').first()).toHaveValue('Gamme de do majeur');
    await expect(page.locator('#cloud-guard-modal')).toBeHidden();
    expect(await page.evaluate((cle) => localStorage.getItem(cle) || '', CLE_ETAT)).toContain('Gamme de do majeur');
    expect(garde.bloquees).toEqual([]);
  });
});
