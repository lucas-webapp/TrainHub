// MODULE « fiche » — LIENS : ajout d'un lien YouTube et d'un lien web, ouverture, renommer / retirer, accès rapide « Liens (n) » de l'en-tête.
// Observé en boîte noire (playwright-cli, 24/11/2026) : le champ « Coller un lien… » (Entrée ou « + ») complète « https:// » si besoin ; un lien YouTube va dans l'onglet « Vidéos »
// (étiquette « YouTube », lecteur intégré), les autres dans « Liens et fichiers » (étiquette = le domaine, champ de renommage ouvert aussitôt) ; un clic ouvre un NOUVEL ONGLET ;
// l'en-tête propose un accès rapide : le lien lui-même (un seul) ou « Liens (n) » (menu). Le lecteur YouTube lui-même : module `video`.
import { test, expect } from '../support/fixtures';
import { ajouterLien, boutonPlusLien, champLien, etatFiche, exo, fiche, onglet, ouvrirOnglet, ouvrirTechnique, repondreAuxSites } from './aide-fiche';

const YOUTUBE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const SITE = 'https://exemple.fr/ressources';

test.describe('Fiche : liens @fiche', () => {
  test('ajouter un lien YouTube : il apparaît dans l\'onglet « Vidéos » sous l\'étiquette « YouTube », et il est enregistré @critique', async ({ ouvrirAppli, garde }) => {
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await expect(onglet(f, 'Vidéos')).toHaveCount(0);   // pas de lien : pas d'onglet
    await ajouterLien(f, YOUTUBE);
    await expect(onglet(f, 'Vidéos')).toHaveText(/Vidéos\s*1/);
    await ouvrirOnglet(f, 'Vidéos');
    await expect(f.getByRole('link', { name: /YouTube/ }).first()).toHaveAttribute('href', YOUTUBE);
    await expect.poll(async () => (await exo(page, 'Gamme')).links).toMatchObject([{ label: 'YouTube', url: YOUTUBE }]);
    // Il reste après rechargement.
    await page.reload();
    await ouvrirTechnique(page);
    await expect(onglet(f, 'Vidéos')).toHaveText(/Vidéos\s*1/);
    expect(garde.bloquees).toEqual([]);
  });

  test('ajouter un lien web : « + » ou Entrée, l\'étiquette est le domaine, l\'adresse est complétée en https:// et le champ se vide @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    // Avec le bouton « + ».
    await champLien(f).fill(SITE);
    await boutonPlusLien(f).click();
    await expect(champLien(f)).toHaveValue('');
    await expect(onglet(f, 'Liens et fichiers')).toHaveText(/Liens et fichiers\s*1/);
    await expect(f.getByRole('link', { name: /exemple\.fr/ })).toHaveAttribute('href', SITE);
    // Sans « https:// » (Entrée).
    await ajouterLien(f, 'exemple.fr/autre');
    await expect(onglet(f, 'Liens et fichiers')).toHaveText(/Liens et fichiers\s*2/);
    await expect.poll(async () => (await exo(page, 'Gamme')).links.map((l: any) => l.url)).toEqual([SITE, 'https://exemple.fr/autre']);
    // Un champ vide ou d'espaces n'ajoute rien.
    await champLien(f).fill('   ');
    await champLien(f).press('Enter');
    expect((await exo(page, 'Gamme')).links).toHaveLength(2);
  });

  test('ouvrir un lien web : un clic ouvre l\'adresse dans un nouvel onglet', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche([{ titre: 'Gamme', extra: { links: [{ id: 'l1', label: 'Mon site', url: SITE }] } }]) });
    await repondreAuxSites(page);
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await ouvrirOnglet(f, 'Liens et fichiers');
    const [onglet2] = await Promise.all([page.waitForEvent('popup'), f.getByRole('link', { name: /Mon site/ }).click()]);
    await expect.poll(() => onglet2.url()).toBe(SITE);
  });

  test('renommer un lien (crayon, Entrée) ; Échap garde l\'ancien nom ; retirer un lien (✕)', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche([{ titre: 'Gamme', extra: { links: [{ id: 'l1', label: 'exemple.fr', url: SITE }, { id: 'l2', label: 'Autre', url: 'https://exemple.fr/b' }] } }]) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await ouvrirOnglet(f, 'Liens et fichiers');
    // Échap : rien ne change.
    await f.getByTitle('Renommer ce lien').first().click();
    const saisie = f.locator('input.link-label-input');
    await expect(saisie).toBeFocused();
    await saisie.press('Escape');
    expect((await exo(page, 'Gamme')).links[0].label).toBe('exemple.fr');
    // Entrée : le nouveau nom est gardé (le texte est présélectionné : la frappe le remplace).
    await f.getByTitle('Renommer ce lien').first().click();
    await expect(saisie).toBeFocused();
    await page.keyboard.type('Mon site');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await exo(page, 'Gamme')).links.map((l: any) => l.label)).toEqual(['Mon site', 'Autre']);
    await expect(f.getByRole('link', { name: /Mon site/ })).toBeVisible();
    // Retirer.
    await f.getByRole('link', { name: /Mon site/ }).getByTitle('Retirer ce lien').click();
    await expect.poll(async () => (await exo(page, 'Gamme')).links.map((l: any) => l.label)).toEqual(['Autre']);
    await expect(f.getByRole('link', { name: /Mon site/ })).toHaveCount(0);
  });

  test('accès rapide dans l\'en-tête : un seul lien = bouton direct ; plusieurs = « Liens (n) » avec un menu, et choisir ouvre le lien @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']) });
    await repondreAuxSites(page);
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await ajouterLien(f, SITE);
    // Un seul lien : le bouton porte son nom et ouvre directement.
    const rapide = f.locator('.exercise-row').getByRole('button', { name: /exemple\.fr/ });
    await expect(rapide).toBeVisible();
    const [direct] = await Promise.all([page.waitForEvent('popup'), rapide.click()]);
    await expect.poll(() => direct.url()).toBe(SITE);
    await direct.close();

    // Deux liens : « Liens (2) », un menu les liste.
    await ajouterLien(f, 'https://exemple.fr/autre');
    const liens = f.locator('.exercise-row').getByRole('button', { name: /Liens \(2\)|Choisir un lien à ouvrir/ });   // texte « Liens (2) » à l'ordinateur, étiquette « Choisir un lien à ouvrir » au téléphone
    await expect(liens).toBeVisible();
    await liens.click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('button')).toHaveText(['exemple.fr', 'exemple.fr']);
    const [ouvert] = await Promise.all([page.waitForEvent('popup'), menu.getByRole('button').nth(1).click()]);
    await expect.poll(() => ouvert.url()).toBe('https://exemple.fr/autre');
  });

  test('accès rapide d\'un lien YouTube : le bouton de l\'en-tête porte « YouTube » et ouvre la vidéo dans un nouvel onglet', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']) });
    await repondreAuxSites(page);
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await ajouterLien(f, YOUTUBE);
    const [ouvert] = await Promise.all([page.waitForEvent('popup'), f.locator('.exercise-row').getByRole('button', { name: 'YouTube' }).click()]);
    await expect.poll(() => ouvert.url()).toContain('youtube.com/watch?v=dQw4w9WgXcQ');
  });

  test('l\'accès rapide marche aussi fiche repliée', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche([{ titre: 'Gamme', ferme: true, extra: { links: [{ id: 'l1', label: 'Mon site', url: SITE }] } }]) });
    await repondreAuxSites(page);
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await expect(f.getByPlaceholder('Coller un lien…')).toBeHidden();   // bien repliée
    const [ouvert] = await Promise.all([page.waitForEvent('popup'), f.getByRole('button', { name: /Mon site/ }).click()]);
    await expect.poll(() => ouvert.url()).toBe(SITE);
  });
});
