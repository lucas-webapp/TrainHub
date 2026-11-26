// MODULE « morceaux » — RETROUVER un morceau : la loupe (barre « Rechercher un exercice ») cherche aussi dans l'artiste, le titre, les styles, les techniques et l'état de travail d'un morceau, sans tenir compte des
// accents pour ces caractéristiques ; les morceaux archivés n'en font pas partie. La recherche rapide (palette Ctrl/⌘ + F) ouvre le morceau dans son dossier calculé, fiche dépliée. Observé en boîte noire
// (playwright-cli, 26/11/2026). Le fonctionnement général de la loupe et de la palette est le module `bibliotheque` (BI-02 : la loupe y est sensible aux accents pour le TITRE d'un exercice).
import { test, expect } from '../support/fixtures';
import type { Page } from '@playwright/test';
import { choisirVue, etatMorceaux, ligneDepart, ouvrirMorceaux, titresMorceaux } from './aide-morceaux';
import { titresVue } from '../bibliotheque/aide-bibliotheque';

const loupe = (page: Page) => page.getByRole('button', { name: 'Rechercher un exercice' });
const champ = (page: Page) => page.getByRole('searchbox', { name: 'Rechercher un exercice' });
const palette = (page: Page) => page.getByRole('textbox', { name: 'Recherche rapide' });
const etat = () => etatMorceaux([
  { titre: 'Beatles - Help', styles: ['Rock'], travail: 'En cours' },
  { titre: 'Beatles - Michelle', styles: ['Folk'] },
  { titre: 'Muse - Hysteria', styles: ['Rock', 'Funk'], techniques: ['Médiator'] },
  { titre: 'Stevie Wonder - Superstition', styles: ['Funk'], techniques: ['Slap'], travail: 'À maîtriser' },
  { titre: 'Beyoncé - Halo' },
  { titre: 'Toto - Africa', styles: ['Rock'], archive: true },
], { exercices: ['Gamme funk'], vocab: { styles: ['Rock', 'Funk', 'Folk'], techniques: ['Slap', 'Médiator'] } });
async function chercher(page: Page, texte: string) {
  if (!(await champ(page).isVisible())) await loupe(page).click();
  await champ(page).fill(texte);
}

test.describe('Morceaux : recherche @morceaux', () => {
  test('la loupe trouve un morceau par son artiste, son style, sa technique ou son état de travail, avec le chemin de son chapitre @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await chercher(page, 'beatles');
    await expect.poll(() => titresVue(page)).toEqual(['Beatles - Help', 'Beatles - Michelle']);
    await expect(page.locator('#folder-container .result-path')).toHaveText(['Morceaux', 'Morceaux']);
    await champ(page).fill('rock');   // un style, pas dans le titre
    await expect.poll(() => titresVue(page)).toEqual(['Beatles - Help', 'Muse - Hysteria']);   // « Toto - Africa » est archivé
    await champ(page).fill('slap');   // une technique
    await expect.poll(() => titresVue(page)).toEqual(['Stevie Wonder - Superstition']);
    await champ(page).fill('en cours');   // un état de travail
    await expect.poll(() => titresVue(page)).toEqual(['Beatles - Help']);
    await champ(page).fill('funk');   // un style : les deux morceaux ET l'exercice qui porte « funk » dans son titre
    await expect.poll(() => titresVue(page)).toEqual(['Gamme funk', 'Muse - Hysteria', 'Stevie Wonder - Superstition']);
  });

  test('pour un morceau, la recherche ignore les accents et la casse : « mediator », « MAITRISER », « beyonce »', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await chercher(page, 'mediator');
    await expect.poll(() => titresVue(page)).toEqual(['Muse - Hysteria']);
    await champ(page).fill('MAITRISER');
    await expect.poll(() => titresVue(page)).toEqual(['Stevie Wonder - Superstition']);
    await champ(page).fill('beyonce');
    await expect.poll(() => titresVue(page)).toEqual(['Beyoncé - Halo']);
  });

  test('un morceau archivé n\'est jamais dans les résultats ; ✕ referme la recherche et rend le chapitre', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await chercher(page, 'africa');
    await expect(page.locator('#folder-container .exercise-title')).toHaveCount(0);
    await champ(page).fill('toto');
    await expect(page.locator('#folder-container .exercise-title')).toHaveCount(0);
    await page.getByRole('button', { name: 'Fermer la recherche' }).click();
    await expect(page.locator('#folder-container .songs-bar')).toBeVisible();
    await choisirVue(page, 'Tous');
    expect(await titresMorceaux(page)).not.toContain('Toto - Africa');
  });

  test('la recherche rapide (Ctrl/⌘ + F) trouve un morceau par son titre, Entrée l\'ouvre dans son dossier calculé, fiche dépliée @ordinateur', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await page.keyboard.press('ControlOrMeta+f');
    await expect(palette(page)).toBeVisible();
    await palette(page).fill('michelle');
    const options = page.getByRole('listbox').getByRole('option');
    await expect(options).toHaveCount(1);
    await expect(options.first()).toContainText('Beatles - Michelle');
    await expect(options.first()).toContainText('Morceaux');
    await palette(page).press('Enter');
    await expect(palette(page)).toBeHidden();
    await expect(page.locator('#breadcrumb .crumb')).toHaveText(['Morceaux', 'Beatles']);   // le dossier calculé où il est rangé
    await expect(ligneDepart(page, 'Beatles - Michelle')).not.toHaveClass(/collapsed/);
  });
});
