// MODULE « bibliotheque » — TRI ET FILTRES de la liste d'exercices d'un dossier.
// Observé en boîte noire (playwright-cli, 23/11/2026) : au-dessus de la liste, une barre : « Tri » (Ordre manuel, A → Z, Z → A, Création : récents d'abord /
// anciens d'abord, Modifiés récemment), « Pièces jointes » (PJ : toutes / Avec PJ / Sans PJ), « Notes » (Notes : toutes / Avec notes / Sans notes) et trois boutons
// à bascule : ★ Favoris, ● En cours, Avec vidéo. Le tri et les filtres ne changent que l'AFFICHAGE : l'ordre enregistré est celui du glisser-déposer.
import { test, expect } from '../support/fixtures';
import {
  actionExercice, ajouterExercice, attendreTitres, champTitre, etatBibliotheque, exerciceEnregistre, lireEtat, ligneDepart, ouvrirChapitre, titresAffiches,
} from './aide-bibliotheque';
import type { Page } from '@playwright/test';

const tri = (page: Page) => page.getByRole('combobox', { name: 'Tri' });
const pj = (page: Page) => page.getByRole('combobox', { name: 'Pièces jointes' });
const notes = (page: Page) => page.getByRole('combobox', { name: 'Notes' });
const filtre = (page: Page, nom: string | RegExp) => page.getByRole('button', { name: nom });
const etat = () => etatBibliotheque([{ nom: 'Basse', chapitres: [{ nom: 'Technique', exercices: [
  { titre: 'Mi', notes: 'Une note sur le mi' }, 'Do', { titre: 'Sol', favori: true }, 'La', { titre: 'Fa', notes: 'Fa dièse à revoir', favori: true },
] }] }]);
const ordreEnregistre = async (page: Page) => (await lireEtat(page)).instruments[0].categories[0].exercises.map((x: any) => x.title);

test.describe('Tri et filtres @bibliotheque', () => {
  test('trier A → Z puis Z → A change l\'affichage, pas l\'ordre enregistré ; « Ordre manuel » le rend @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirChapitre(page, 'Technique');
    await attendreTitres(page, ['Mi', 'Do', 'Sol', 'La', 'Fa']);
    await expect(tri(page)).toHaveValue(/./);

    await tri(page).selectOption({ label: 'A → Z' });
    await attendreTitres(page, ['Do', 'Fa', 'La', 'Mi', 'Sol']);
    await tri(page).selectOption({ label: 'Z → A' });
    await attendreTitres(page, ['Sol', 'Mi', 'La', 'Fa', 'Do']);
    expect(await ordreEnregistre(page)).toEqual(['Mi', 'Do', 'Sol', 'La', 'Fa']);

    await tri(page).selectOption({ label: 'Ordre manuel' });
    await attendreTitres(page, ['Mi', 'Do', 'Sol', 'La', 'Fa']);
  });

  test('tri par création : les exercices créés à l\'instant se rangent du plus récent au plus ancien, et inversement', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatBibliotheque([{ nom: 'Basse', chapitres: [{ nom: 'Technique' }] }]) });
    await ouvrirChapitre(page, 'Technique');
    for (const t of ['Premier', 'Deuxième', 'Troisième']) {
      await ajouterExercice(page, t);
      await expect.poll(async () => (await exerciceEnregistre(page, t)).length).toBe(1);   // chaque création est enregistrée avant la suivante
    }
    await attendreTitres(page, ['Premier', 'Deuxième', 'Troisième']);
    await tri(page).selectOption({ label: "Création : récents d'abord" });
    await attendreTitres(page, ['Troisième', 'Deuxième', 'Premier']);
    await tri(page).selectOption({ label: "Création : anciens d'abord" });
    await attendreTitres(page, ['Premier', 'Deuxième', 'Troisième']);
  });

  test('tri « Modifiés récemment » : l\'exercice qu\'on vient de modifier passe en tête', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirChapitre(page, 'Technique');
    await champTitre(ligneDepart(page, 'La')).fill('La bémol');
    await champTitre(ligneDepart(page, 'La')).press('Enter');
    await expect.poll(async () => (await exerciceEnregistre(page, 'La bémol')).length).toBe(1);
    await tri(page).selectOption({ label: 'Modifiés récemment' });
    await expect.poll(async () => (await titresAffiches(page))[0]).toBe('La bémol');
  });

  test('le filtre ★ Favoris ne garde que les favoris, un second clic les rend tous @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirChapitre(page, 'Technique');
    await filtre(page, /★ Favoris/).click();
    await attendreTitres(page, ['Sol', 'Fa']);
    await expect(filtre(page, /★ Favoris/)).toHaveAttribute('aria-pressed', 'true');
    // Combiné au tri.
    await tri(page).selectOption({ label: 'A → Z' });
    await attendreTitres(page, ['Fa', 'Sol']);
    await filtre(page, /★ Favoris/).click();
    await attendreTitres(page, ['Do', 'Fa', 'La', 'Mi', 'Sol']);
  });

  test('le filtre ● En cours ne garde que les exercices en cours', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirChapitre(page, 'Technique');
    await actionExercice(page, ligneDepart(page, 'Do'), /Marquer « En cours »/);
    await actionExercice(page, ligneDepart(page, 'La'), /Marquer « En cours »/);
    await filtre(page, /● En cours/).click();
    await attendreTitres(page, ['Do', 'La']);
    // Avec les favoris en plus : seuls ceux qui sont les deux (ici aucun).
    await filtre(page, /★ Favoris/).click();
    await attendreTitres(page, []);
    await filtre(page, /★ Favoris/).click();
    await filtre(page, /● En cours/).click();
    await attendreTitres(page, ['Mi', 'Do', 'Sol', 'La', 'Fa']);
  });

  test('filtre « Notes » : Avec notes / Sans notes', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirChapitre(page, 'Technique');
    await notes(page).selectOption({ label: 'Avec notes' });
    await attendreTitres(page, ['Mi', 'Fa']);
    await notes(page).selectOption({ label: 'Sans notes' });
    await attendreTitres(page, ['Do', 'Sol', 'La']);
    await notes(page).selectOption({ label: 'Notes : toutes' });
    await attendreTitres(page, ['Mi', 'Do', 'Sol', 'La', 'Fa']);
  });

  test('filtre « Pièces jointes » : sans pièce jointe tout est « Sans PJ », « Avec PJ » ne montre rien', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirChapitre(page, 'Technique');
    await pj(page).selectOption({ label: 'Avec PJ' });
    await attendreTitres(page, []);
    await pj(page).selectOption({ label: 'Sans PJ' });
    await attendreTitres(page, ['Mi', 'Do', 'Sol', 'La', 'Fa']);
  });

  test('un filtre sans résultat ne supprime rien : on le retire et tout est là', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirChapitre(page, 'Technique');
    await filtre(page, /Avec vidéo/).click();
    await attendreTitres(page, []);
    expect(await ordreEnregistre(page)).toEqual(['Mi', 'Do', 'Sol', 'La', 'Fa']);
    await filtre(page, /Avec vidéo/).click();
    await attendreTitres(page, ['Mi', 'Do', 'Sol', 'La', 'Fa']);
  });

  test('la barre de tri et de filtres n\'apparaît que s\'il y a des exercices à trier', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatBibliotheque([{ nom: 'Basse', chapitres: [{ nom: 'Vide' }, { nom: 'Plein', exercices: ['A', 'B'] }] }]) });
    await ouvrirChapitre(page, 'Vide');
    await expect(tri(page)).toHaveCount(0);
    await ouvrirChapitre(page, 'Plein');
    await expect(tri(page)).toBeVisible();
  });
});
