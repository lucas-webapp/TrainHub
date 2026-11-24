// MODULE « bibliotheque » — DOSSIERS (sous le chapitre, emboîtables) : créer, sous-dossier, renommer, déplacer, fusionner, dupliquer, supprimer, fil d'Ariane, note.
// Observé en boîte noire (playwright-cli, 23/11/2026) : un dossier s'ouvre en cliquant sa ligne dans « Sous-dossiers » (zone principale, ordinateur ET téléphone) ;
// le champ « Nouveau sous-dossier… » crée dedans ; son menu (clic droit / appui long) : Nouveau sous-dossier, Renommer, Dupliquer, Déplacer vers…,
// Fusionner avec…, Supprimer. « Déplacer » et « Fusionner » ouvrent une fenêtre de choix (arbre des chapitres et dossiers) ; fusionner demande confirmation.
// Le détail de la note de dossier est tenu par le banc `notedossier` (PLAN § 7) : ici seulement le parcours.
import { test, expect } from '../support/fixtures';
import {
  arbre, bibliothequeType, chapitre, choisirAction, etatBibliotheque, fil, menuContextuel, message, ouvrirChapitre, ouvrirChemin, ouvrirDossier, ouvrirMenu, sousDossier, sousDossiers,
  titreOuvert, titresAffiches, lireEtat, attendreTitres, annuler, ajouterExercice, confirmer,
} from './aide-bibliotheque';
import type { Noeud } from './aide-bibliotheque';
import type { Locator, Page } from '@playwright/test';

const champSousDossier = (page: Page) => page.getByPlaceholder('Nouveau sous-dossier…');
/** Nouveau sous-dossier par le menu de l'élément parent (chapitre, ou ligne du dossier dans son parent) : marche partout. Observé : le champ
 *  « Nouveau sous-dossier… » n'est affiché qu'au téléphone ; l'appli ouvre le dossier qu'on vient de créer. */
async function nouveauDossier(page: Page, parent: Locator, nom: string) {
  await ouvrirMenu(page, parent);
  await choisirAction(page, 'Nouveau sous-dossier');
  const menu = menuContextuel(page);
  await menu.getByRole('textbox', { name: 'Nom du sous-dossier…' }).fill(nom);
  await menu.getByRole('textbox').press('Enter');
  await expect(menuContextuel(page)).toBeHidden();
  await expect(titreOuvert(page)).toHaveText(nom);
}
const choisirDansLaFenetre = (page: Page, nom: string) => page.locator('.folder-picker-panel').getByRole('button', { name: nom, exact: true }).click();
const chapitreTechnique = async (page: Page): Promise<Noeud> => (await arbre(page))[0].chapitres.find((c) => c.nom === 'Technique')!;
const trouver = (n: Noeud, nom: string): Noeud | undefined => n.nom === nom ? n : n.dossiers.map((d) => trouver(d, nom)).find(Boolean);

test.describe('Dossiers @bibliotheque', () => {
  test('créer un dossier, un sous-dossier dedans, y ranger un exercice, remonter par le fil d\'Ariane ; tout reste après rechargement @critique', async ({ ouvrirAppli, garde }) => {
    const page = await ouvrirAppli({ etat: etatBibliotheque([{ nom: 'Basse', chapitres: [{ nom: 'Technique' }] }]) });
    await ouvrirChapitre(page, 'Technique');
    await expect(sousDossiers(page)).toHaveCount(0);

    await nouveauDossier(page, chapitre(page, 'Technique'), 'Main droite');
    // Sous-dossier d'un dossier : par le menu de sa ligne, dans son parent.
    await fil(page).locator('.crumb').first().click();
    await nouveauDossier(page, sousDossier(page, 'Main droite'), 'Arpèges');
    await ajouterExercice(page, 'Arpège en do');
    await attendreTitres(page, ['Arpège en do']);

    // Fil d'Ariane : chapitre › dossier › sous-dossier ; cliquer un maillon remonte.
    await expect(fil(page).locator('.crumb')).toHaveText(['Technique', 'Main droite', 'Arpèges']);
    await fil(page).locator('.crumb', { hasText: 'Main droite' }).click();
    await expect(titreOuvert(page)).toHaveText('Main droite');
    await expect(fil(page).locator('.crumb')).toHaveText(['Technique', 'Main droite']);
    await expect(sousDossier(page, 'Arpèges')).toBeVisible();
    await fil(page).locator('.crumb', { hasText: 'Technique' }).first().click();
    await expect(titreOuvert(page)).toHaveText('Technique');
    await expect(sousDossier(page, 'Main droite')).toBeVisible();

    expect(await chapitreTechnique(page)).toEqual({ nom: 'Technique', exercices: [], dossiers: [
      { nom: 'Main droite', exercices: [], dossiers: [{ nom: 'Arpèges', exercices: ['Arpège en do'], dossiers: [] }] },
    ] });
    await page.reload();
    await ouvrirChemin(page, 'Technique', 'Main droite', 'Arpèges');
    await attendreTitres(page, ['Arpège en do']);
    expect(garde.bloquees).toEqual([]);
  });

  test('au téléphone, le champ « Nouveau sous-dossier… » crée un dossier ; un nom vide n\'en crée pas @mobile', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirChapitre(page, 'Technique');
    await expect(sousDossiers(page)).toHaveText(['Rythme', 'Slap']);
    await champSousDossier(page).fill('   ');
    await champSousDossier(page).press('Enter');
    await expect(sousDossiers(page)).toHaveText(['Rythme', 'Slap']);
    await champSousDossier(page).fill('Modes');
    await champSousDossier(page).press('Enter');
    await expect(sousDossiers(page)).toHaveText(['Rythme', 'Slap', 'Modes']);
    await expect(champSousDossier(page)).toHaveValue('');
    expect((await chapitreTechnique(page)).dossiers.map((d) => d.nom)).toEqual(['Rythme', 'Slap', 'Modes']);
  });

  test('à l\'ordinateur, le champ « Nouveau sous-dossier… » n\'est pas affiché : on crée par le menu @ordinateur', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirChapitre(page, 'Technique');
    await expect(champSousDossier(page)).toBeHidden();
    await nouveauDossier(page, chapitre(page, 'Technique'), 'Modes');
    await fil(page).locator('.crumb').first().click();
    await expect(sousDossiers(page)).toHaveText(['Rythme', 'Slap', 'Modes']);
  });

  test('renommer un dossier par le crayon de sa ligne, puis par son menu ; le fil d\'Ariane et la liste suivent @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirChapitre(page, 'Technique');
    // Le crayon de la ligne du dossier.
    await sousDossier(page, 'Rythme').getByRole('button', { name: 'Renommer ce dossier' }).click();
    const menu = menuContextuel(page);
    await expect(menu.getByRole('textbox')).toHaveValue('Rythme');
    await menu.getByRole('textbox').fill('Rythmique');
    await menu.getByRole('button', { name: 'Valider' }).click();
    await expect(sousDossier(page, 'Rythmique')).toBeVisible();
    await ouvrirDossier(page, 'Rythmique');
    await expect(fil(page).locator('.crumb')).toHaveText(['Technique', 'Rythmique']);

    // Par le menu de sa ligne, depuis le chapitre. Échap annule sans rien changer.
    await fil(page).locator('.crumb').first().click();
    await ouvrirMenu(page, sousDossier(page, 'Rythmique'));
    await choisirAction(page, 'Renommer');
    await menuContextuel(page).getByRole('textbox').fill('Ne pas garder');
    await page.keyboard.press('Escape');
    await expect(menuContextuel(page)).toBeHidden();
    await expect(sousDossier(page, 'Rythmique')).toBeVisible();

    await ouvrirMenu(page, sousDossier(page, 'Rythmique'));
    await choisirAction(page, 'Renommer');
    await menuContextuel(page).getByRole('textbox').fill('Groove');
    await menuContextuel(page).getByRole('textbox').press('Enter');
    await expect(sousDossier(page, 'Groove')).toBeVisible();
    await expect(sousDossier(page, 'Rythmique')).toHaveCount(0);
    expect((await chapitreTechnique(page)).dossiers.map((d) => d.nom)).toEqual(['Groove', 'Slap']);
    // Ses exercices l'ont suivi.
    await ouvrirDossier(page, 'Groove');
    await attendreTitres(page, ['Croches', 'Triolets']);
  });

  test('à l\'ordinateur, le crayon à côté du titre renomme le dossier ouvert @ordinateur', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirChemin(page, 'Technique', 'Rythme');
    await page.getByRole('button', { name: 'Renommer ce dossier' }).first().click();
    const menu = menuContextuel(page);
    await expect(menu.getByRole('textbox')).toHaveValue('Rythme');
    await menu.getByRole('textbox').fill('Rythmique');
    await menu.getByRole('button', { name: 'Valider' }).click();
    await expect(titreOuvert(page)).toHaveText('Rythmique');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Rythmique');
  });

  test('déplacer un dossier dans un autre : il part avec ses exercices ; annuler le remet à sa place', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirChapitre(page, 'Technique');
    await ouvrirMenu(page, sousDossier(page, 'Rythme'));
    await choisirAction(page, 'Déplacer vers…');
    await expect(page.locator('.folder-picker-panel')).toContainText('Déplacer « Rythme » vers…');
    // Le dossier ne se propose pas lui-même ; les chapitres et les autres dossiers, oui.
    await expect(page.locator('.folder-picker-panel').getByRole('button', { name: 'Rythme', exact: true })).toHaveCount(0);
    await choisirDansLaFenetre(page, 'Slap');
    await expect(page.locator('.folder-picker-panel')).toBeHidden();

    // « Rythme » n'est plus dans « Technique » : il est dans « Slap », avec ses deux exercices.
    await expect(sousDossier(page, 'Rythme')).toHaveCount(0);
    const slap = trouver(await chapitreTechnique(page), 'Slap')!;
    expect(slap.dossiers.map((d) => d.nom)).toEqual(['Pops', 'Rythme']);
    expect(slap.dossiers.find((d) => d.nom === 'Rythme')!.exercices).toEqual(['Croches', 'Triolets']);
    await ouvrirDossier(page, 'Slap');
    await expect(sousDossier(page, 'Rythme')).toBeVisible();
    await expect(fil(page).locator('.crumb')).toHaveText(['Technique', 'Slap']);

    await annuler(page);
    await expect.poll(async () => (await chapitreTechnique(page)).dossiers.map((d) => d.nom)).toEqual(['Rythme', 'Slap']);
  });

  test('déplacer un dossier vers un AUTRE chapitre', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirChapitre(page, 'Technique');
    await ouvrirMenu(page, sousDossier(page, 'Rythme'));
    await choisirAction(page, 'Déplacer vers…');
    await choisirDansLaFenetre(page, 'Improvisation');
    await expect(sousDossier(page, 'Rythme')).toHaveCount(0);
    const e = (await arbre(page))[0];
    expect(e.chapitres.find((c) => c.nom === 'Technique')!.dossiers.map((d) => d.nom)).toEqual(['Slap']);
    expect(e.chapitres.find((c) => c.nom === 'Improvisation')!.dossiers).toEqual([{ nom: 'Rythme', exercices: ['Croches', 'Triolets'], dossiers: [] }]);
    await ouvrirChapitre(page, 'Improvisation');
    await expect(sousDossier(page, 'Rythme')).toBeVisible();
  });

  test('fusionner deux dossiers : confirmation, puis le contenu du premier passe dans le second, qui garde son nom ; annuler remet tout', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirChapitre(page, 'Technique');
    await ouvrirMenu(page, sousDossier(page, 'Rythme'));
    await choisirAction(page, 'Fusionner avec…');
    await expect(page.locator('.folder-picker-panel')).toContainText('Fusionner « Rythme » dans…');
    await choisirDansLaFenetre(page, 'Slap');
    const boite = page.getByRole('dialog', { name: /Fusionner « Rythme » dans « Slap » \?/ });
    await expect(boite).toContainText('« Rythme » disparaît');
    // Refuser ne change rien.
    await boite.getByRole('button', { name: 'Annuler' }).click();
    await expect(boite).toBeHidden();
    await expect(sousDossier(page, 'Rythme')).toBeVisible();

    await ouvrirMenu(page, sousDossier(page, 'Rythme'));
    await choisirAction(page, 'Fusionner avec…');
    await choisirDansLaFenetre(page, 'Slap');
    await confirmer(page, 'Fusionner');
    await expect(sousDossier(page, 'Rythme')).toHaveCount(0);
    const slap = trouver(await chapitreTechnique(page), 'Slap')!;
    expect(slap.exercices).toEqual(expect.arrayContaining(['Pouce', 'Croches', 'Triolets']));
    expect(slap.exercices).toHaveLength(3);
    expect(slap.dossiers.map((d) => d.nom)).toEqual(['Pops']);
    await ouvrirDossier(page, 'Slap');
    await expect.poll(() => titresAffiches(page)).toEqual(expect.arrayContaining(['Pouce', 'Croches', 'Triolets']));

    await annuler(page);
    await expect.poll(async () => (await chapitreTechnique(page)).dossiers.map((d) => d.nom)).toEqual(['Rythme', 'Slap']);
  });

  test('dupliquer un dossier : « (copie) » avec le contenu, l\'original est intact', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirChapitre(page, 'Technique');
    await ouvrirMenu(page, sousDossier(page, 'Slap'));
    await choisirAction(page, 'Dupliquer');
    await expect(sousDossier(page, 'Slap (copie)')).toBeVisible();
    const t = await chapitreTechnique(page);
    expect(t.dossiers.map((d) => d.nom)).toEqual(['Rythme', 'Slap', 'Slap (copie)']);
    const original = t.dossiers[1], copie = t.dossiers[2];
    expect(original).toEqual({ nom: 'Slap', exercices: ['Pouce'], dossiers: [{ nom: 'Pops', exercices: ['Pop simple'], dossiers: [] }] });
    // La copie contient les mêmes choses, qui portent « (copie) » comme pour un chapitre (cf. chapitres.spec.ts).
    expect(copie.exercices).toEqual(['Pouce (copie)']);
    expect(copie.dossiers).toHaveLength(1);
    expect(copie.dossiers[0].exercices).toEqual(['Pop simple (copie)']);
  });

  test('supprimer un dossier demande confirmation, part à la corbeille avec son contenu, et « Annuler » le ramène @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirChapitre(page, 'Technique');
    await ouvrirMenu(page, sousDossier(page, 'Slap'));
    await choisirAction(page, 'Supprimer');
    const demande = menuContextuel(page);
    await expect(demande).toContainText('Supprimer « Slap »');
    await expect(demande).toContainText('Tout reste récupérable dans la corbeille');
    await demande.getByRole('button', { name: 'Annuler' }).click();
    await expect(sousDossier(page, 'Slap')).toBeVisible();

    await ouvrirMenu(page, sousDossier(page, 'Slap'));
    await choisirAction(page, 'Supprimer');
    await menuContextuel(page).getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect(sousDossier(page, 'Slap')).toHaveCount(0);
    expect((await chapitreTechnique(page)).dossiers.map((d) => d.nom)).toEqual(['Rythme']);
    await expect(message(page, '« Slap » mis à la corbeille')).toBeVisible();

    await message(page, 'mis à la corbeille').getByRole('button', { name: 'Annuler' }).click();
    await expect(sousDossier(page, 'Slap')).toBeVisible();
    expect(trouver(await chapitreTechnique(page), 'Slap')).toEqual({ nom: 'Slap', exercices: ['Pouce'], dossiers: [{ nom: 'Pops', exercices: ['Pop simple'], dossiers: [] }] });
  });

  test('note du dossier : « ＋ Note » ouvre une zone de saisie, le texte reste après rechargement', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirChemin(page, 'Technique', 'Rythme');
    await page.locator('.folder-note-add').click();
    const zone = page.locator('#folder-container .folder-note').locator('textarea, [contenteditable="true"], input').first();
    await expect(zone).toBeVisible();
    await zone.fill('Toujours au métronome, à 60.');
    await page.locator('#folder-container .exercises-wrap').click({ position: { x: 2, y: 2 } }).catch(() => {});
    await expect.poll(async () => JSON.stringify((await lireEtat(page))?.instruments)).toContain('Toujours au métronome, à 60.');
    await page.reload();
    await ouvrirChemin(page, 'Technique', 'Rythme');
    await expect(page.locator('#folder-container .folder-note')).toContainText('Toujours au métronome, à 60.');
  });
});
