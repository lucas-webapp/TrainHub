// MODULE « bibliotheque » — RECHERCHE : la loupe (barre « Rechercher un exercice », résultats en direct, groupés par dossier) et la recherche rapide (Ctrl/⌘ + F).
// Observé en boîte noire (playwright-cli, 23/11/2026) : la loupe du haut ouvre un champ au-dessus de la liste (« Recherche rapide » à droite, ✕ « Fermer la recherche ») ;
// en tapant, la zone principale ne montre que les exercices (de tous les dossiers actifs) dont le titre contient le texte, chacun sous le chemin « Chapitre › Dossier »
// (bouton qui ouvre ce dossier). La recherche rapide est une palette (« Chercher un exercice, une session, un dossier… ») : flèches, Entrée ouvre l'exercice (déplié) dans son dossier.
import { test, expect } from '../support/fixtures';
import {
  attendreTitres, auTelephone, bibliothequeType, etatBibliotheque, fil, ligneDepart, ouvrirChapitre, ouvrirChemin, titreOuvert, titresAffiches, titresVue, exerciceEnregistre,
} from './aide-bibliotheque';
import type { Page } from '@playwright/test';

const loupe = (page: Page) => page.getByRole('button', { name: 'Rechercher un exercice' });
const champ = (page: Page) => page.getByRole('searchbox', { name: 'Rechercher un exercice' });
const fermer = (page: Page) => page.getByRole('button', { name: 'Fermer la recherche' });
const palette = (page: Page) => page.getByRole('textbox', { name: 'Recherche rapide' });
const resultats = (page: Page) => page.getByRole('listbox').getByRole('option');
/** Ouvre la palette « Recherche rapide » par le bouton de la barre de recherche (que la barre soit déjà ouverte ou non). */
async function ouvrirPalette(page: Page) {
  if (!(await champ(page).isVisible())) await loupe(page).click();
  await page.getByRole('button', { name: 'Recherche rapide' }).click();
  await expect(palette(page)).toBeVisible();
}
const etat = () => etatBibliotheque([
  { nom: 'Basse', chapitres: [
    { nom: 'Technique', exercices: ['Gamme majeure', 'Arpèges'], dossiers: [{ nom: 'Rythme', exercices: ['Croches', 'Gamme rythmique'] }, { nom: 'Slap', exercices: ['Pouce'] }] },
    { nom: 'Improvisation', exercices: ['Blues en la', 'Gamme blues'] },
  ] },
  { nom: 'Guitare', chapitres: [{ nom: 'Accords', exercices: ['Gamme de barrés'] }] },
]);

test.describe('Recherche (loupe) @bibliotheque', () => {
  test('la loupe filtre en direct les exercices de tous les dossiers, avec leur chemin ; ✕ referme et rend la liste @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirChemin(page, 'Technique', 'Slap');
    await attendreTitres(page, ['Pouce']);

    await loupe(page).click();
    await expect(champ(page)).toBeVisible();
    await expect(champ(page)).toBeFocused();
    await champ(page).fill('gamme');
    // Les résultats viennent de plusieurs dossiers et chapitres de l'espace courant (pas de l'autre espace).
    await expect.poll(() => titresVue(page)).toEqual(['Gamme majeure', 'Gamme rythmique', 'Gamme blues']);
    // Chaque résultat porte le chemin de son dossier (bouton « Aller à cet emplacement »).
    await expect(page.locator('#folder-container .result-path')).toHaveText(['Technique', 'Technique › Rythme', 'Improvisation']);

    // Affiner : le filtre suit, sans tenir compte de la casse.
    await champ(page).fill('ARPÈGES');
    await expect.poll(() => titresVue(page)).toEqual(['Arpèges']);
    await champ(page).fill('introuvable');
    await expect.poll(() => titresVue(page)).toEqual([]);

    // Fermer : la liste du dossier ouvert revient.
    await fermer(page).click();
    await expect(champ(page)).toBeHidden();
    await attendreTitres(page, ['Pouce']);
    await expect(titreOuvert(page)).toHaveText('Slap');
  });

  test('la loupe trouve « Arpèges » en tapant « arpeges » (sans accent), comme la recherche rapide', async ({ ouvrirAppli }) => {
    test.fail(true, 'BI-02 : la loupe est sensible aux accents (« arpeges » ne trouve pas « Arpèges »), alors que la recherche rapide ne l\'est pas.');
    const page = await ouvrirAppli({ etat: etat() });
    await loupe(page).click();
    await champ(page).fill('arpeges');
    await expect.poll(() => titresVue(page)).toEqual(['Arpèges']);
  });

  test('la recherche rapide ignore les accents et la casse : « ARPEGES » trouve « Arpèges »', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirPalette(page);
    await palette(page).fill('ARPEGES');
    await expect(resultats(page).filter({ hasText: 'Arpèges' })).toHaveCount(1);
  });

  test('cliquer le chemin d\'un résultat ouvre son dossier ; la loupe se referme', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirChapitre(page, 'Improvisation');
    await loupe(page).click();
    await champ(page).fill('croches');
    await expect.poll(() => titresVue(page)).toEqual(['Croches']);
    await page.locator('#folder-container .result-path', { hasText: 'Technique › Rythme' }).click();
    await expect(titreOuvert(page)).toHaveText('Rythme');
    await expect(fil(page).locator('.crumb')).toHaveText(['Technique', 'Rythme']);
    await expect.poll(() => titresAffiches(page)).toEqual(['Croches', 'Gamme rythmique']);
  });

  test('un résultat de recherche reste un exercice normal : on peut le renommer sans quitter la recherche', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await loupe(page).click();
    await champ(page).fill('pouce');
    await expect.poll(() => titresVue(page)).toEqual(['Pouce']);
    const titre = page.locator('#folder-container input.exercise-title');
    await titre.fill('Pouce et index');
    await titre.press('Enter');
    await expect.poll(async () => (await exerciceEnregistre(page, 'Pouce et index')).length).toBe(1);
  });

  test('la recherche ne montre pas les exercices archivés ni ceux de l\'autre espace', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatBibliotheque([
      { nom: 'Basse', chapitres: [{ nom: 'Technique', exercices: ['Gamme A', { titre: 'Gamme archivée', archive: true }] }] },
      { nom: 'Guitare', chapitres: [{ nom: 'Accords', exercices: ['Gamme guitare'] }] },
    ]) });
    await loupe(page).click();
    await champ(page).fill('gamme');
    await expect.poll(() => titresVue(page)).toEqual(['Gamme A']);
  });

  test('Échap dans le champ ferme la recherche', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await loupe(page).click();
    await champ(page).fill('blues');
    await expect.poll(() => titresVue(page)).toEqual(['Blues en la', 'Gamme blues']);
    await page.keyboard.press('Escape');
    await expect(champ(page)).toBeHidden();
  });
});

test.describe('Recherche rapide @bibliotheque', () => {
  test('Ctrl/⌘ + F ouvre la palette : taper, Entrée ouvre l\'exercice dans son dossier, déplié @critique @ordinateur', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirChapitre(page, 'Improvisation');
    await page.keyboard.press('ControlOrMeta+f');
    await expect(palette(page)).toBeVisible();
    // Sans saisie : les exercices modifiés récemment.
    await expect(resultats(page).first()).toBeVisible();

    await palette(page).fill('pouc');
    await expect(resultats(page)).toHaveCount(1);
    await expect(resultats(page).first()).toContainText('Pouce');
    await expect(resultats(page).first()).toContainText('Technique › Slap');
    await palette(page).press('Enter');
    await expect(palette(page)).toBeHidden();
    await expect(titreOuvert(page)).toHaveText('Slap');
    await expect(ligneDepart(page, 'Pouce')).toBeVisible();
    await expect(ligneDepart(page, 'Pouce')).not.toHaveClass(/collapsed/);   // la fiche s'ouvre
  });

  test('à l\'ouverture de la palette, le focus est dans le champ : on tape tout de suite, sans cliquer @ordinateur', async ({ ouvrirAppli }, testInfo) => {
    // Intermittent (≈ 1 fois sur 3) sur WebKit de bureau et sur iPad (projets webkit et tablette) : le focus reste sur <body> ou sur le bouton, le texte tapé est perdu.
    test.fixme(['webkit', 'tablette'].includes(testInfo.project.name), 'BI-04 : WebKit (Safari bureau, iPad) : la palette « Recherche rapide » n\'a pas le focus ≈ 1 fois sur 3 à l\'ouverture (intermittent).');
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirChapitre(page, 'Technique');
    await page.keyboard.press('ControlOrMeta+f');
    await expect(palette(page)).toBeFocused();
    await page.keyboard.type('pouc');
    await expect(palette(page)).toHaveValue('pouc');
    await expect(resultats(page).filter({ hasText: 'Pouce' })).toHaveCount(1);
  });

  test('on y accède aussi par le bouton « Recherche rapide » de la barre de recherche (téléphone compris) ; flèches + Entrée', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirPalette(page);
    // La palette cherche dans TOUS les espaces : « Gamme de barrés » (Guitare) y est aussi.
    await palette(page).fill('gamme');
    await expect(resultats(page)).toHaveCount(4);
    await expect(resultats(page).first()).toHaveAttribute('aria-selected', 'true');
    await palette(page).press('ArrowDown');
    await expect(resultats(page).nth(1)).toHaveAttribute('aria-selected', 'true');
    const choisi = (await resultats(page).nth(1).innerText()).split('\n')[0];
    await palette(page).press('Enter');
    await expect(palette(page)).toBeHidden();
    await expect.poll(() => titresVue(page).then((t) => t.includes(choisi))).toBe(true);
  });

  test('un clic sur un résultat l\'ouvre ; Échap ferme la palette sans rien changer', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirChapitre(page, 'Technique');
    await ouvrirPalette(page);
    await palette(page).fill('blues en');
    await resultats(page).first().click();
    await expect(titreOuvert(page)).toHaveText('Improvisation');
    await expect(ligneDepart(page, 'Blues en la')).toBeVisible();

    await ouvrirPalette(page);
    await page.keyboard.press('Escape');
    await expect(palette(page)).toBeHidden();
    await expect(titreOuvert(page)).toHaveText('Improvisation');
  });

  test('la palette trouve aussi un DOSSIER ; Entrée l\'ouvre', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirPalette(page);
    await palette(page).fill('rythme');
    const dossier = resultats(page).filter({ hasText: 'Rythme' }).first();
    await expect(dossier).toBeVisible();
    // le premier résultat « dossier » (et non l'exercice « Gamme rythmique »)
    const options = await resultats(page).evaluateAll((os) => os.map((o) => (o.textContent || '').trim()));
    const i = options.findIndex((t) => /^Rythme/.test(t));
    expect(i, 'la palette doit proposer le dossier « Rythme » (ligne « Dossier · Technique · 2 exercices »)').toBeGreaterThanOrEqual(0);
    await resultats(page).nth(i).click();
    await expect(titreOuvert(page)).toHaveText('Rythme');
  });
});
