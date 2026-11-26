// MODULE « mobile » — COMPTE ET SYNCHRO au doigt. Observé en boîte noire (playwright-cli, 26/11/2026) : la fenêtre d'accueil (`#cloud-guard-modal`) propose « Se connecter avec Google » / « Continuer sans compte » + une case
// « Ne plus me le proposer » ; connecté (compte FICTIF de l'émulateur Auth), la pilule du haut n'est plus que la pastille et l'initiale, son menu donne l'état et « Se déconnecter ». Les règles de synchro sont dans
// le module `synchro` ; la pilule et son menu au téléphone y sont déjà éprouvés (`connexion.spec.ts`). Ici : la fenêtre d'accueil et la déconnexion AU TOUCHER.
import { test, expect, adresse, connecter, pastille, pilule } from '../synchro/aide-synchro';
import { commandesDehors, dansLEcran, ouvrirTel, sansDefilementHorizontal, taille, hauteurEcran } from './aide-mobile';

test.describe('Compte et synchro au téléphone @mobile', () => {
  test.describe.configure({ timeout: 90_000 });

  test('la fenêtre d\'accueil tient dans l\'écran, ses boutons sont assez grands et la case se coche en touchant son texte @critique', async ({ ouvrirAppli, page }) => {
    await ouvrirAppli({ exercices: [{ titre: 'A' }], accueil: 'garder' });
    const accueil = page.locator('#cloud-guard-modal');
    await expect(accueil).toBeVisible();
    const fenetre = accueil.getByRole('dialog');
    await dansLEcran(page, fenetre, 'fenêtre d\'accueil');
    expect(await commandesDehors(page, accueil)).toEqual([]);
    for (const nom of ['Se connecter avec Google', 'Continuer sans compte']) {
      const b = fenetre.getByRole('button', { name: nom });
      await expect(b).toBeInViewport();
      expect((await taille(b)).h, nom).toBeGreaterThanOrEqual(40);
    }
    const case_ = fenetre.getByRole('checkbox', { name: 'Ne plus me le proposer sur cet appareil' });
    await fenetre.getByText('Ne plus me le proposer sur cet appareil').tap();
    await expect(case_).toBeChecked();
    await sansDefilementHorizontal(page);
    await fenetre.getByRole('button', { name: 'Continuer sans compte' }).tap();
    await expect(accueil).toBeHidden();
    // « Ne plus me le proposer » coché : au rechargement la fenêtre ne revient pas
    await page.reload();
    await expect(page.locator('#google-signin-btn')).toBeVisible();
    await expect(accueil).toBeHidden();
  });

  test('l\'écran étant bas (clavier ou téléphone couché), la fenêtre d\'accueil reste entièrement atteignable', async ({ ouvrirAppli, page }) => {
    await ouvrirAppli({ exercices: [{ titre: 'A' }], accueil: 'garder' });
    const accueil = page.locator('#cloud-guard-modal');
    await expect(accueil).toBeVisible();
    await page.setViewportSize({ width: page.viewportSize()!.width, height: 340 });
    const bouton = accueil.getByRole('button', { name: 'Continuer sans compte' });
    await bouton.scrollIntoViewIfNeeded();
    await expect(bouton).toBeInViewport();
    expect(await hauteurEcran(page)).toBe(340);
    await bouton.tap();
    await expect(accueil).toBeHidden();
  });

  test('connecté : le menu du compte se touche, donne l\'état de la synchro, et « Se déconnecter » remet « Se connecter » sans rien perdre @critique', async ({ ouvrirAppli, page }, testInfo) => {
    await ouvrirAppli({ exercices: [{ titre: 'Walking bass' }], accueil: 'jamais' });
    await connecter(page, adresse(testInfo.project.name, 'e2e-mobile'), 'Camille Mobile');
    await expect(pastille(page)).toBeVisible();
    await dansLEcran(page, pilule(page), 'pilule du compte');
    await pilule(page).tap();
    const menu = page.getByRole('menu');
    await expect(menu).toContainText('Synchronisé avec le cloud');
    await dansLEcran(page, menu, 'menu du compte');
    const sortir = menu.getByRole('menuitem', { name: /^Se déconnecter/ });
    expect((await taille(sortir)).h, 'hauteur de « Se déconnecter »').toBeGreaterThanOrEqual(36);
    await sortir.tap();
    await expect(page.locator('#google-signin-btn')).toBeVisible();
    await expect(pastille(page)).toBeHidden();
    await expect(page.locator('#folder-container input.exercise-title')).toHaveValue('Walking bass');
    await sansDefilementHorizontal(page);
  });
});
