// MODULE « fiche » — CAPTURES (images) : ajout par le trombone, miniatures de l'onglet « Images », nom posé par-dessus l'image, grand format avec flèches ‹ ›, retrait avec confirmation.
// Observé en boîte noire (playwright-cli, 24/11/2026) : une image est rangée dans IndexedDB (la fiche garde id, nom, type, taille) ; l'accès rapide « Voir l'image » / « Voir les images (n) » est dans
// l'en-tête ; le nom se donne par le crayon qui apparaît au survol (Entrée valide, Échap annule) ; le grand format s'ouvre par un clic sur la miniature, légende « 1 / 3 », boutons « Image
// précédente (←) » / « Image suivante (→) » (+ touches ← →, tour complet), Échap ferme ; « ✕ » demande « Retirer cette image ? ». Les détails au pixel : banc `images` (PLAN § 7).
import { test, expect } from '../support/fixtures';
import { ajouterFichiers, etatFiche, exo, fiche, onglet, ouvrirOnglet, ouvrirTechnique, png, sansBlobIndexedDB } from './aide-fiche';
import type { Locator, Page } from '@playwright/test';

const ROUGE = () => png('rouge.png', [192, 57, 43]);
const BLEU = () => png('bleu.png', [41, 128, 185]);
const VERT = () => png('vert.png', [39, 174, 96]);
const vignettes = (f: Locator) => f.locator('.img-fig');
const visionneuse = (page: Page) => page.locator('.img-viewer');
const legende = (page: Page) => visionneuse(page).locator('.img-viewer-caption');
const titreGrand = (page: Page) => visionneuse(page).locator('.img-viewer-title');
const suivante = (page: Page) => visionneuse(page).getByRole('button', { name: 'Image suivante (→)' });
const precedente = (page: Page) => visionneuse(page).getByRole('button', { name: 'Image précédente (←)' });

/** Pose une capture à la fois (une par ajout), dans l'ordre donné. */
async function poser(page: Page, f: Locator, ...images: Array<ReturnType<typeof ROUGE>>) {
  for (const [i, image] of images.entries()) {
    await ajouterFichiers(page, f, image);
    await expect(onglet(f, 'Images')).toHaveText(new RegExp(`Images\\s*${i + 1}`));
  }
  await ouvrirOnglet(f, 'Images');
  await expect(vignettes(f)).toHaveCount(images.length);
}

test.describe('Fiche : captures @fiche', () => {
  test('ajouter une capture : une miniature apparaît, l\'en-tête propose « Voir l\'image », la fiche l\'enregistre ; elle est toujours là (décodée) après rechargement @critique', async ({ ouvrirAppli, garde, browserName }) => {
    sansBlobIndexedDB(test, browserName);
    const page = await ouvrirAppli({ etat: etatFiche(['Tablatures']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Tablatures');
    await expect(onglet(f, 'Images')).toHaveCount(0);
    await poser(page, f, ROUGE());
    await expect(f.locator('.exercise-row').getByRole('button', { name: /^Voir l'image/ })).toBeVisible();
    await expect.poll(async () => (await exo(page, 'Tablatures')).images).toMatchObject([{ name: 'rouge.png', type: 'image/png' }]);
    // La miniature est une vraie image décodée.
    await expect.poll(() => vignettes(f).locator('img').first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBe(400);

    await page.reload();
    await ouvrirTechnique(page);
    await ouvrirOnglet(f, 'Images');
    await expect(vignettes(f)).toHaveCount(1);
    await expect.poll(() => vignettes(f).locator('img').first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBe(400);
    expect(garde.bloquees).toEqual([]);
  });

  test('plusieurs captures : ajoutées une à une, elles se rangent dans l\'ordre d\'ajout ; l\'en-tête annonce « Voir les images (3) »', async ({ ouvrirAppli, browserName }) => {
    sansBlobIndexedDB(test, browserName);
    const page = await ouvrirAppli({ etat: etatFiche(['Tablatures']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Tablatures');
    await poser(page, f, ROUGE(), BLEU(), VERT());
    await expect(f.locator('.exercise-row').getByRole('button', { name: /^Voir les images \(3\)/ })).toBeVisible();
    await expect.poll(async () => (await exo(page, 'Tablatures')).images.map((i: any) => i.name)).toEqual(['rouge.png', 'bleu.png', 'vert.png']);
    await expect(vignettes(f).locator('img')).toHaveCount(3);
  });

  test('donner un nom à une capture : le crayon (au survol) ouvre la saisie, Entrée pose le nom par-dessus l\'image, Échap annule, le nom est enregistré @critique', async ({ ouvrirAppli, browserName }) => {
    sansBlobIndexedDB(test, browserName);
    const page = await ouvrirAppli({ etat: etatFiche(['Tablatures']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Tablatures');
    await poser(page, f, ROUGE(), BLEU());
    // Sans nom donné : rien n'est écrit sur les images (le nom du fichier n'en est pas un).
    await expect(f.locator('.img-title:visible')).toHaveCount(0);

    const premiere = vignettes(f).nth(0);
    await premiere.locator('.img-box').hover();
    await premiere.getByRole('button', { name: /Donner un nom à cette capture/ }).click();
    const saisie = premiere.locator('input.img-title-input');
    await expect(saisie).toBeFocused();
    await page.keyboard.type('Couplet');
    await page.keyboard.press('Enter');
    await expect(premiere.locator('.img-title')).toHaveText('Couplet');
    await expect.poll(async () => (await exo(page, 'Tablatures')).images[0].name).toBe('Couplet');

    // Échap : la modification est abandonnée.
    await premiere.locator('.img-box').hover();
    await premiere.getByRole('button', { name: 'Renommer cette capture (« Couplet »)' }).click();   // le crayon change d'info-bulle une fois la capture nommée
    await page.keyboard.type(' XXX');
    await page.keyboard.press('Escape');
    await expect(premiere.locator('.img-title')).toHaveText('Couplet');
    expect((await exo(page, 'Tablatures')).images[0].name).toBe('Couplet');

    await page.reload();
    await ouvrirTechnique(page);
    await ouvrirOnglet(f, 'Images');
    await expect(vignettes(f).nth(0).locator('.img-title')).toHaveText('Couplet');
  });

  test('grand format : un clic sur la miniature l\'ouvre (« 1 / 3 », nom par-dessus), les flèches ‹ › et ← → font le tour, Échap ferme @critique', async ({ ouvrirAppli, browserName }) => {
    sansBlobIndexedDB(test, browserName);
    const page = await ouvrirAppli({ etat: etatFiche(['Tablatures']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Tablatures');
    await poser(page, f, ROUGE(), BLEU(), VERT());
    // Nom de la 2e capture, vu ensuite dans le grand format.
    const deuxieme = vignettes(f).nth(1);
    await deuxieme.locator('.img-box').hover();
    await deuxieme.getByRole('button', { name: /Donner un nom à cette capture/ }).click();
    await page.keyboard.type('Refrain');
    await page.keyboard.press('Enter');
    await expect(deuxieme.locator('.img-title')).toHaveText('Refrain');

    await vignettes(f).nth(0).locator('.img-thumb-btn').click();
    await expect(visionneuse(page)).toBeVisible();
    await expect(legende(page)).toHaveText('1 / 3');
    await expect(visionneuse(page).locator('.img-viewer-body img')).toBeVisible();
    await suivante(page).click();
    await expect(legende(page)).toHaveText('2 / 3');
    await expect(titreGrand(page)).toHaveText('Refrain');
    await page.keyboard.press('ArrowRight');
    await expect(legende(page)).toHaveText('3 / 3');
    await expect(titreGrand(page)).toBeHidden();   // pas de nom donné : pas de titre
    await page.keyboard.press('ArrowRight');       // tour complet
    await expect(legende(page)).toHaveText('1 / 3');
    await page.keyboard.press('ArrowLeft');
    await expect(legende(page)).toHaveText('3 / 3');
    await precedente(page).click();
    await expect(legende(page)).toHaveText('2 / 3');
    await page.keyboard.press('Escape');
    await expect(visionneuse(page)).toHaveCount(0);
  });

  test('grand format par l\'accès rapide de l\'en-tête : « Voir l\'image » ouvre la capture, sans flèches quand il n\'y en a qu\'une', async ({ ouvrirAppli, browserName }) => {
    sansBlobIndexedDB(test, browserName);
    const page = await ouvrirAppli({ etat: etatFiche(['Tablatures']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Tablatures');
    await poser(page, f, ROUGE());
    await f.locator('.exercise-row').getByRole('button', { name: /^Voir l'image/ }).click();
    await expect(visionneuse(page)).toBeVisible();
    await expect(legende(page)).toHaveText('');   // une seule image : pas de « 1 / 1 »
    await expect(suivante(page)).toBeHidden();
    await expect(precedente(page)).toBeHidden();
    await expect(visionneuse(page).locator('.img-viewer-body img')).toBeVisible();
    await visionneuse(page).getByRole('button', { name: 'Fermer (Échap)' }).click();
    await expect(visionneuse(page)).toHaveCount(0);
  });

  test('retirer une capture : « Retirer cette image ? », « Annuler » la garde, « Retirer » l\'enlève de la fiche @critique', async ({ ouvrirAppli, browserName }) => {
    sansBlobIndexedDB(test, browserName);
    const page = await ouvrirAppli({ etat: etatFiche(['Tablatures']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Tablatures');
    await poser(page, f, ROUGE(), BLEU());
    const boite = page.getByRole('dialog', { name: 'Retirer cette image ?' });

    await vignettes(f).nth(0).getByRole('button', { name: '✕' }).click();
    await expect(boite).toBeVisible();
    await boite.getByRole('button', { name: 'Annuler' }).click();
    await expect(boite).toBeHidden();
    await expect(vignettes(f)).toHaveCount(2);

    await vignettes(f).nth(0).getByRole('button', { name: '✕' }).click();
    await boite.getByRole('button', { name: 'Retirer', exact: true }).click();
    await expect(boite).toBeHidden();
    await expect(vignettes(f)).toHaveCount(1);
    await expect.poll(async () => (await exo(page, 'Tablatures')).images.map((i: any) => i.name)).toEqual(['bleu.png']);
    // Avec une seule capture restante, l'accès rapide devient « Voir l'image ».
    await expect(f.locator('.exercise-row').getByRole('button', { name: /^Voir l'image/ })).toBeVisible();
    // Retirer la dernière : l'onglet disparaît.
    await vignettes(f).nth(0).getByRole('button', { name: '✕' }).click();
    await boite.getByRole('button', { name: 'Retirer', exact: true }).click();
    await expect(onglet(f, 'Images')).toHaveCount(0);
    await expect.poll(async () => (await exo(page, 'Tablatures')).images).toEqual([]);
  });

  test('plusieurs captures ajoutées d\'un coup : toutes arrivent, chacune avec sa miniature', async ({ ouvrirAppli, browserName }) => {
    sansBlobIndexedDB(test, browserName);
    const page = await ouvrirAppli({ etat: etatFiche(['Tablatures']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Tablatures');
    await ajouterFichiers(page, f, ROUGE(), BLEU(), VERT());
    await expect(onglet(f, 'Images')).toHaveText(/Images\s*3/);
    await ouvrirOnglet(f, 'Images');
    await expect(vignettes(f)).toHaveCount(3);
    await expect.poll(async () => (await exo(page, 'Tablatures')).images.map((i: any) => i.name).sort()).toEqual(['bleu.png', 'rouge.png', 'vert.png']);
  });
});
