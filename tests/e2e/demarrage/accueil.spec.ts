// MODULE « demarrage » — LA FENÊTRE D'ACCUEIL DU COMPTE (SDK Firebase disponible, émulateurs) : « Continuer sans compte » et
// « Ne plus me le proposer sur cet appareil ». Observé en boîte noire (playwright-cli, 23/11/2026) :
// - sans cocher : la fenêtre ne revient pas au rechargement du même onglet, mais REVIENT dans un nouvel onglet (mémorisation par onglet) ;
// - en cochant : la fenêtre ne revient plus dans aucun onglet de l'appareil, et la pilule « Se connecter » reste disponible.
import { test, expect } from '../support/fixtures';

const CLE_NE_PLUS = 'compteCloud.trainhub.nePlusProposer';

test.describe('Fenêtre d\'accueil du compte @critique @demarrage', () => {
  test('« Continuer sans compte » : pas de retour au rechargement, mais retour dans un nouvel onglet', async ({ ouvrirAppli, context }) => {
    const page = await ouvrirAppli({ accueil: 'garder' });
    const accueil = page.locator('#cloud-guard-modal');
    await expect(accueil).toBeVisible();
    await accueil.getByRole('button', { name: 'Continuer sans compte' }).click();
    await expect(accueil).toBeHidden();
    // sans la case cochée, rien n'est retenu pour l'appareil
    expect(await page.evaluate((cle) => localStorage.getItem(cle), CLE_NE_PLUS)).toBeNull();

    await page.reload();
    await expect(page.getByRole('button', { name: 'Se connecter avec Google' })).toBeVisible();
    await expect(accueil).toBeHidden();

    // Nouvel onglet : l'accueil est proposé de nouveau.
    const onglet = await context.newPage();
    await onglet.goto('/index.html');
    await expect(onglet.locator('#cloud-guard-modal')).toBeVisible({ timeout: 15_000 });
    await expect(onglet.locator('#cloud-guard-modal').getByRole('button', { name: 'Se connecter avec Google' })).toBeVisible();
  });

  test('« Ne plus me le proposer sur cet appareil » : plus de fenêtre dans un nouvel onglet, pilule toujours disponible', async ({ ouvrirAppli, context }) => {
    const page = await ouvrirAppli({ accueil: 'garder' });
    const accueil = page.locator('#cloud-guard-modal');
    await expect(accueil).toBeVisible();
    await accueil.getByLabel('Ne plus me le proposer sur cet appareil').check();
    await accueil.getByRole('button', { name: 'Continuer sans compte' }).click();
    await expect(accueil).toBeHidden();
    expect(await page.evaluate((cle) => localStorage.getItem(cle), CLE_NE_PLUS)).toBe('1');

    const onglet = await context.newPage();
    await onglet.goto('/index.html');
    const pilule = onglet.getByRole('button', { name: 'Se connecter avec Google' });
    await expect(pilule).toBeVisible({ timeout: 15_000 });
    // le SDK s'est chargé : la pilule n'est PAS grisée, et la fenêtre d'accueil ne s'ouvre pas
    await expect(pilule).not.toHaveClass(/cc-indisponible/);
    await expect(onglet.locator('#cloud-guard-modal')).toBeHidden();
  });
});
