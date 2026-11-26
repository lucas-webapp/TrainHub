// MODULE « morceaux » — CLASSER PLUSIEURS MORCEAUX À LA FOIS. Observé en boîte noire (playwright-cli, 26/11/2026) : quand TOUS les éléments de la sélection multiple sont des morceaux du MÊME chapitre de morceaux, la barre
// du bas (« Actions sur la sélection ») ajoute « Style… », « Technique… » et « Travail… » ; chacun ouvre un menu « Style — 2 morceaux » avec les valeurs du chapitre (« ✓ » devant celles que TOUS ont déjà), un clic
// donne la valeur à ceux qui ne l'ont pas (ou la retire à tous si tous l'ont), « ＋ Nouveau style… » en crée une pour tous. La sélection elle-même (Ctrl/⌘ + clic, Maj + clic, barre) : module `bibliotheque`.
import { test, expect } from '../support/fixtures';
import type { Page } from '@playwright/test';
import { chapitreEnregistre, etatMorceaux, ligneDepart, morceauEnregistre, ouvrirChapitre, ouvrirDossierCalcule, ouvrirMorceaux, rangee, repondre, titresMorceaux, attendreMorceau, choisirVue } from './aide-morceaux';

const barre = (page: Page) => page.getByRole('toolbar', { name: 'Actions sur la sélection' });
const menu = (page: Page) => page.locator('.ctx-menu');
const valeur = (page: Page, nom: string) => menu(page).getByRole('button', { name: nom, exact: true });
const etat = () => etatMorceaux([{ titre: 'Beatles - Help', styles: ['Rock'] }, 'Beatles - Michelle', { titre: 'Beatles - Yesterday', styles: ['Rock', 'Funk'] }, 'Muse - Hysteria'],
  { exercices: ['Gamme'], vocab: { styles: ['Rock', 'Funk', 'Jazz'], techniques: ['Slap'] }, autreChapitre: { nom: 'Chansons', morceaux: ['Brassens - Les Copains d\'abord'] } });
async function selectionner(page: Page, ...titres: string[]) {
  for (const t of titres) await rangee(ligneDepart(page, t)).click({ modifiers: ['ControlOrMeta'] });
  await expect(barre(page)).toContainText(`${titres.length} exercice${titres.length > 1 ? 's' : ''} sélectionné${titres.length > 1 ? 's' : ''}`);
}

test.describe('Morceaux : classer plusieurs morceaux @morceaux @ordinateur', () => {
  test('la barre de sélection de morceaux propose Style…, Technique… et Travail…, que la barre d\'exercices n\'a pas @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await ouvrirDossierCalcule(page, 'Beatles');
    await selectionner(page, 'Beatles - Help', 'Beatles - Michelle');
    for (const b of ['Style…', 'Technique…', 'Travail…']) await expect(barre(page).getByRole('button', { name: b, exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await ouvrirChapitre(page, 'Technique');
    await rangee(ligneDepart(page, 'Gamme')).click({ modifiers: ['ControlOrMeta'] });
    await expect(barre(page)).toBeVisible();
    for (const b of ['Style…', 'Technique…', 'Travail…']) await expect(barre(page).getByRole('button', { name: b, exact: true })).toHaveCount(0);
  });

  test('pas de classement groupé quand la sélection mêle un morceau et un exercice', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await selectionner(page, 'Muse - Hysteria');
    await expect(barre(page).getByRole('button', { name: 'Style…', exact: true })).toBeVisible();
    // On passe dans « Technique » sans lâcher la sélection : l'exercice qu'on y ajoute à la sélection la mêle.
    await ouvrirChapitre(page, 'Technique');
    await rangee(ligneDepart(page, 'Gamme')).click({ modifiers: ['ControlOrMeta'] });
    await expect(barre(page)).toContainText('2 exercices sélectionnés');
    await expect(barre(page).getByRole('button', { name: 'Style…', exact: true })).toHaveCount(0);
    await expect(barre(page).getByRole('button', { name: 'Travail…', exact: true })).toHaveCount(0);
  });

  test('« Style… » : donne le style à tous ceux qui ne l\'ont pas ; « ✓ » devant ce que tous ont ; re-cliquer le retire à tous @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await ouvrirDossierCalcule(page, 'Beatles');
    await selectionner(page, 'Beatles - Help', 'Beatles - Michelle', 'Beatles - Yesterday');
    await barre(page).getByRole('button', { name: 'Style…', exact: true }).click();
    await expect(menu(page).locator('.ctx-title')).toHaveText('Styles — 3 morceaux');
    await expect(menu(page).locator('.ctx-item')).toHaveText(['Rock', 'Funk', 'Jazz', '＋ Nouveau style…']);   // Rock n'est pas à tous : pas de ✓
    await valeur(page, 'Rock').click();   // Michelle ne l'a pas : elle le reçoit
    await attendreMorceau(page, 'Beatles - Michelle', (m) => m.styles.includes('Rock'));
    expect((await morceauEnregistre(page, 'Beatles - Help')).styles).toEqual(['Rock']);   // ceux qui l'avaient déjà ne le perdent pas
    expect((await morceauEnregistre(page, 'Beatles - Yesterday')).styles).toEqual(['Rock', 'Funk']);
    // Maintenant tous l'ont : « ✓ Rock », et un clic le retire à tous.
    await expect(barre(page)).toContainText('3 exercices sélectionnés');
    await barre(page).getByRole('button', { name: 'Style…', exact: true }).click();
    await expect(valeur(page, '✓ Rock')).toBeVisible();
    await expect(valeur(page, '✓ Funk')).toHaveCount(0);
    await valeur(page, '✓ Rock').click();
    await attendreMorceau(page, 'Beatles - Help', (m) => !m.styles.includes('Rock'));
    expect((await morceauEnregistre(page, 'Beatles - Michelle')).styles).toEqual([]);
    expect((await morceauEnregistre(page, 'Beatles - Yesterday')).styles).toEqual(['Funk']);
  });

  test('« Travail… » : un seul état à la fois ; le donner à tous, puis le retirer à tous', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Tous');
    await selectionner(page, 'Beatles - Help', 'Muse - Hysteria');
    await barre(page).getByRole('button', { name: 'Travail…', exact: true }).click();
    await expect(menu(page).locator('.ctx-title')).toHaveText('Travail — 2 morceaux');
    await expect(menu(page).locator('.ctx-item')).toHaveText(['En cours', 'À maîtriser', 'Maîtrisé', 'Plus tard', '＋ Nouvel état…']);
    await valeur(page, 'À maîtriser').click();
    await attendreMorceau(page, 'Muse - Hysteria', (m) => m.work === 'À maîtriser');
    expect((await morceauEnregistre(page, 'Beatles - Help')).work).toBe('À maîtriser');
    await barre(page).getByRole('button', { name: 'Travail…', exact: true }).click();
    await valeur(page, '✓ À maîtriser').click();
    await attendreMorceau(page, 'Muse - Hysteria', (m) => m.work === '');
    expect((await morceauEnregistre(page, 'Beatles - Help')).work).toBe('');
  });

  test('« Technique… » puis « ＋ Nouvelle technique… » : la valeur créée est donnée à tous et ajoutée au vocabulaire du chapitre', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Tous');
    await selectionner(page, 'Beatles - Michelle', 'Muse - Hysteria');
    await barre(page).getByRole('button', { name: 'Technique…', exact: true }).click();
    await menu(page).getByRole('button', { name: '＋ Nouvelle technique…' }).click();
    await repondre(page, 'Tapping');
    await attendreMorceau(page, 'Muse - Hysteria', (m) => m.techniques.includes('Tapping'));
    expect((await morceauEnregistre(page, 'Beatles - Michelle')).techniques).toEqual(['Tapping']);
    expect((await chapitreEnregistre(page)).vocab.techniques).toEqual(['Slap', 'Tapping']);
    expect(await titresMorceaux(page)).toHaveLength(4);
  });

  test('le menu clic droit d\'un morceau sélectionné avec d\'autres agit sur toute la sélection (ne propose pas Style…, propose les actions groupées)', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Tous');
    await selectionner(page, 'Beatles - Help', 'Muse - Hysteria');
    await rangee(ligneDepart(page, 'Muse - Hysteria')).click({ button: 'right' });
    const entrees = await menu(page).locator('.ctx-item').allTextContents();
    expect(entrees).toEqual(expect.arrayContaining(['Style…', 'Technique…', 'Travail…', 'Archiver']));
  });
});
