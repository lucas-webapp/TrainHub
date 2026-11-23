// MODULE « demarrage » — HORS LIGNE : le SDK Firebase est injoignable (réseau coupé, www.gstatic.com bloqué chez l'utilisateur).
// Dans les tests, le serveur de test sert le SDK sous /__e2e__/firebase/ : on le refuse (503) AVANT d'ouvrir l'appli.
// Observé en boîte noire (playwright-cli, 23/11/2026) : l'appli reste en mode local, pas de fenêtre d'accueil, pas de pastille de compte ;
// la pilule « Se connecter » devient grisée (classe `cc-indisponible`) et porte l'explication dans son `title` ;
// à l'ordinateur son libellé se termine par « (indisponible) » ; au téléphone (≤ 700 px) le libellé est masqué (reste l'icône Google) ;
// un clic affiche un message (toast) qui explique pourquoi, sans ouvrir ni fenêtre ni connexion.
import type { Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { CLE_ETAT } from '../support/appli';

const EXPLICATION = "La connexion Google n'a pas pu se charger (hors connexion ?). Tes données restent enregistrées sur cet appareil.";

// Refuse le SDK Firebase servi par le serveur de test ; renvoie le compteur de refus (preuve que le SDK a bien été demandé, puis refusé).
async function couperLeSdk(page: Page) {
  const refus = { n: 0 };
  await page.route('**/__e2e__/firebase/**', (r) => { refus.n++; return r.fulfill({ status: 503, contentType: 'text/plain', body: 'hors ligne' }); });
  return refus;
}

test.describe('Hors ligne : SDK Firebase indisponible @critique @demarrage', () => {
  test('l\'appli reste utilisable en local : l\'exercice ajouté survit au rechargement, sans fenêtre d\'accueil ni compte', async ({ page, ouvrirAppli, garde }) => {
    const refus = await couperLeSdk(page);
    await ouvrirAppli({ accueil: 'garder' });
    const accueil = page.locator('#cloud-guard-modal');
    const pilule = page.getByRole('button', { name: 'Se connecter avec Google' });

    // Le SDK a été demandé puis refusé : la pilule s'est grisée et plus aucun objet Firebase n'existe dans la page.
    await expect(pilule).toHaveClass(/cc-indisponible/);
    expect(refus.n).toBeGreaterThan(0);
    expect(await page.evaluate(() => typeof (window as any).firebase)).toBe('undefined');
    // Aucune fenêtre d'accueil, aucune pastille de compte.
    await expect(accueil).toBeHidden();
    await expect(page.locator('#account-info')).toBeHidden();

    // Un exercice s'ajoute normalement…
    const saisie = page.getByPlaceholder('Ajouter un exercice…');
    await saisie.fill('Gamme hors ligne');
    await saisie.press('Enter');
    const titres = page.locator('#folder-container .exercise .exercise-title');
    await expect(titres).toHaveCount(1);
    await expect(titres.first()).toHaveValue('Gamme hors ligne');

    // … il est enregistré dans le navigateur (stockage local) …
    await expect.poll(() => page.evaluate((cle) => localStorage.getItem(cle) || '', CLE_ETAT)).toContain('Gamme hors ligne');

    // … et toujours là après rechargement, toujours sans fenêtre d'accueil ni compte.
    await page.reload();
    await expect(page.locator('#folder-container .exercise .exercise-title')).toHaveValue('Gamme hors ligne');
    await expect(pilule).toHaveClass(/cc-indisponible/);
    await expect(accueil).toBeHidden();
    await expect(page.locator('#account-info')).toBeHidden();
    expect(garde.bloquees).toEqual([]);
  });

  test('un état existant s\'affiche hors ligne (exercices déjà enregistrés sur l\'appareil)', async ({ page, ouvrirAppli }) => {
    await couperLeSdk(page);
    await ouvrirAppli({ exercices: [{ titre: 'Walking bass déjà là' }, { titre: 'Arpèges déjà là' }], accueil: 'garder' });
    await expect(page.getByRole('button', { name: 'Se connecter avec Google' })).toHaveClass(/cc-indisponible/);
    const titres = page.locator('#folder-container .exercise .exercise-title');
    await expect(titres).toHaveCount(2);
    await expect(titres.nth(0)).toHaveValue('Walking bass déjà là');
    await expect(titres.nth(1)).toHaveValue('Arpèges déjà là');
    await expect(page.locator('#cloud-guard-modal')).toBeHidden();
  });

  test('à l\'ordinateur, la pilule grisée porte « (indisponible) » et explique pourquoi (survol, clic) @ordinateur', async ({ page, ouvrirAppli }) => {
    await couperLeSdk(page);
    await ouvrirAppli({ accueil: 'garder' });
    const pilule = page.getByRole('button', { name: 'Se connecter avec Google' });
    await expect(pilule).toBeVisible();
    await expect(pilule).toHaveClass(/cc-indisponible/);

    // Grisée : visiblement moins opaque qu'un bouton normal.
    await expect.poll(() => pilule.evaluate((el) => Number(getComputedStyle(el).opacity))).toBeLessThan(1);
    // Le libellé visible est « Se connecter » suivi de « (indisponible) » (ajouté par la feuille de style, d'où l'évaluation du pseudo-élément).
    await expect(pilule.locator('.cc-libelle')).toBeVisible();
    await expect(pilule.locator('.cc-libelle')).toHaveText('Se connecter');
    expect(await pilule.locator('.cc-libelle').evaluate((el) => getComputedStyle(el, '::after').content)).toContain('(indisponible)');
    // Au survol, l'info-bulle (attribut title) donne la raison.
    await pilule.hover();
    await expect(pilule).toHaveAttribute('title', EXPLICATION);

    // Au clic : un message répète la raison ; ni fenêtre d'accueil, ni fenêtre Google, ni pastille de compte.
    let popup = false;
    page.on('popup', () => { popup = true; });
    await pilule.click();
    await expect(page.locator('.toast').filter({ hasText: EXPLICATION })).toBeVisible();
    await expect(page.locator('#cloud-guard-modal')).toBeHidden();
    await expect(page.locator('#account-info')).toBeHidden();
    expect(popup).toBe(false);
    expect(page.url()).toMatch(/\/index\.html$/);
  });

  test('au téléphone, la pilule n\'est plus qu\'une icône Google grisée ; le clic affiche la raison @mobile', async ({ page, ouvrirAppli }) => {
    await couperLeSdk(page);
    await ouvrirAppli({ accueil: 'garder' });
    const pilule = page.getByRole('button', { name: 'Se connecter avec Google' });
    await expect(pilule).toBeVisible();
    await expect(pilule).toHaveClass(/cc-indisponible/);
    await expect.poll(() => pilule.evaluate((el) => Number(getComputedStyle(el).opacity))).toBeLessThan(1);

    // Pas de survol sur un écran tactile : le libellé est masqué, il ne reste que l'icône (assez grande pour le doigt).
    await expect(pilule.locator('.cc-libelle')).toBeHidden();
    const boite = await pilule.boundingBox();
    expect(boite!.width).toBeGreaterThanOrEqual(30);
    expect(boite!.height).toBeGreaterThanOrEqual(30);
    // L'icône reste dans l'écran.
    const largeur = await page.evaluate(() => window.innerWidth);
    expect(boite!.x + boite!.width).toBeLessThanOrEqual(largeur);
    await expect(pilule).toHaveAttribute('title', EXPLICATION);

    // Le seul moyen de savoir pourquoi : toucher la pilule → message visible.
    await pilule.tap();
    await expect(page.locator('.toast').filter({ hasText: EXPLICATION })).toBeVisible();
    await expect(page.locator('#cloud-guard-modal')).toBeHidden();
    await expect(page.locator('#account-info')).toBeHidden();
  });
});
