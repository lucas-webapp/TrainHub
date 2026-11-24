// MODULE « bibliotheque » — GLISSER-DÉPOSER : réordonner les exercices (poignée ⠿), les dossiers, déposer un exercice sur un dossier de la colonne.
// Observé en boîte noire (playwright-cli, 23/11/2026) : l'appli suit le POINTEUR (pas de glisser-déposer HTML5) ; il faut quelques petits mouvements avant le
// grand déplacement. Déposer sur la moitié haute d'une ligne = avant, moitié basse = après. Les chapitres : voir chapitres.spec.ts.
import { test, expect } from '../support/fixtures';
import {
  attendreTitres, auTelephone, bibliothequeType, etatBibliotheque, exerciceEnregistre, glisser, ligneDepart, noeudColonne, ouvrirChapitre, ouvrirChemin, ouvrirDossier,
  sousDossier, sousDossiers, annuler, lireEtat, rangee, menuContextuel,
} from './aide-bibliotheque';

const cinq = () => etatBibliotheque([{ nom: 'Basse', chapitres: [
  { nom: 'Technique', exercices: ['Un', 'Deux', 'Trois', 'Quatre', 'Cinq'], dossiers: [{ nom: 'Cible' }, { nom: 'Autre' }] },
] }]);
const poignee = (page: any, titre: string) => ligneDepart(page, titre).locator('.exercise-drag-handle');
/** Ordre des exercices du chapitre dans l'état enregistré. */
async function ordreEnregistre(page: any, chapitre = 'Technique') {
  const e = await lireEtat(page);
  const c = e.instruments[0].categories.find((x: any) => x.name === chapitre);
  return c.exercises.map((x: any) => x.title);
}

test.describe('Glisser-déposer @bibliotheque', () => {
  test('réordonner les exercices par leur poignée : l\'ordre est enregistré et reste après rechargement @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: cinq() });
    await ouvrirChapitre(page, 'Technique');
    await attendreTitres(page, ['Un', 'Deux', 'Trois', 'Quatre', 'Cinq']);

    // « Quatre » est lâché sur la moitié haute de « Deux » : il passe en 2e position.
    await glisser(page, poignee(page, 'Quatre'), rangee(ligneDepart(page, 'Deux')), 'haut');
    await attendreTitres(page, ['Un', 'Quatre', 'Deux', 'Trois', 'Cinq']);
    await expect.poll(() => ordreEnregistre(page)).toEqual(['Un', 'Quatre', 'Deux', 'Trois', 'Cinq']);

    // « Un » est lâché sur la moitié basse de « Cinq » : il passe en dernier.
    await glisser(page, poignee(page, 'Un'), rangee(ligneDepart(page, 'Cinq')), 'bas');
    await attendreTitres(page, ['Quatre', 'Deux', 'Trois', 'Cinq', 'Un']);
    await expect.poll(() => ordreEnregistre(page)).toEqual(['Quatre', 'Deux', 'Trois', 'Cinq', 'Un']);

    await page.reload();
    await ouvrirChapitre(page, 'Technique');
    await attendreTitres(page, ['Quatre', 'Deux', 'Trois', 'Cinq', 'Un']);
  });

  test('annuler remet l\'ordre précédent des exercices', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: cinq() });
    await ouvrirChapitre(page, 'Technique');
    await glisser(page, poignee(page, 'Trois'), rangee(ligneDepart(page, 'Un')), 'haut');
    await attendreTitres(page, ['Trois', 'Un', 'Deux', 'Quatre', 'Cinq']);
    await annuler(page);
    await attendreTitres(page, ['Un', 'Deux', 'Trois', 'Quatre', 'Cinq']);
  });

  test('un glisser lâché hors de toute liste (en haut de la page) ne change rien', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: cinq() });
    await ouvrirChapitre(page, 'Technique');
    await page.evaluate(() => window.scrollTo(0, 0));
    const b = (await poignee(page, 'Un').boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 8, b.y - 6, { steps: 3 });
    await page.mouse.move(b.x + 40, 130, { steps: 8 });   // le titre du chapitre : aucune cible
    await page.mouse.up();
    await attendreTitres(page, ['Un', 'Deux', 'Trois', 'Quatre', 'Cinq']);
    await expect.poll(() => ordreEnregistre(page)).toEqual(['Un', 'Deux', 'Trois', 'Quatre', 'Cinq']);
    await expect(menuContextuel(page)).toHaveCount(0);
  });

  test('réordonner les sous-dossiers par glisser-déposer', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirChapitre(page, 'Technique');
    await expect(sousDossiers(page)).toHaveText(['Rythme', 'Slap']);
    await glisser(page, sousDossier(page, 'Slap'), sousDossier(page, 'Rythme'), 'haut');
    await expect(sousDossiers(page)).toHaveText(['Slap', 'Rythme']);
    await expect.poll(async () => {
      const e = await lireEtat(page);
      return e.instruments[0].categories[0].folders.map((f: any) => f.name);
    }).toEqual(['Slap', 'Rythme']);
    await page.reload();
    await ouvrirChapitre(page, 'Technique');
    await expect(sousDossiers(page)).toHaveText(['Slap', 'Rythme']);
  });

  test('déposer un exercice sur un dossier de la colonne le range dedans ; annuler le ramène @critique @ordinateur', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: cinq() });
    await ouvrirChapitre(page, 'Technique');
    const cible = noeudColonne(page, 'Cible');
    await expect(cible).toBeVisible();
    await glisser(page, poignee(page, 'Trois'), cible, 'milieu');
    // Lâcher sur un dossier ouvre un petit menu : « Trois » → « Cible » : Déplacer ici / Copier ici / Annuler.
    await expect(menuContextuel(page)).toContainText('« Trois » → « Cible »');
    await menuContextuel(page).getByRole('button', { name: 'Déplacer ici' }).click();
    await attendreTitres(page, ['Un', 'Deux', 'Quatre', 'Cinq']);
    expect((await exerciceEnregistre(page, 'Trois'))[0].chemin).toBe('Basse › Technique › Cible');
    await ouvrirDossier(page, 'Cible');
    await attendreTitres(page, ['Trois']);

    await annuler(page);
    await ouvrirChapitre(page, 'Technique');
    await attendreTitres(page, ['Un', 'Deux', 'Trois', 'Quatre', 'Cinq']);
    expect((await exerciceEnregistre(page, 'Trois'))[0].chemin).toBe('Basse › Technique');
  });

  test('déposer un exercice sur le chapitre voisin de la colonne le change de chapitre @ordinateur', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirChapitre(page, 'Technique');
    const cible = noeudColonne(page, 'Improvisation');
    await glisser(page, poignee(page, 'Arpèges'), cible, 'milieu');
    await expect(menuContextuel(page)).toContainText('« Arpèges » → « Improvisation »');
    await menuContextuel(page).getByRole('button', { name: 'Déplacer ici' }).click();
    await attendreTitres(page, ['Gamme majeure']);
    expect((await exerciceEnregistre(page, 'Arpèges'))[0].chemin).toBe('Basse › Improvisation');
  });

  test('le titre d\'un exercice reste modifiable à la souris : cliquer dedans ne lance pas de glisser', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: cinq() });
    await ouvrirChapitre(page, 'Technique');
    const champ = ligneDepart(page, 'Deux').locator('input.exercise-title');
    await champ.click();
    await expect(champ).toBeFocused();
    await champ.press('End');
    await page.keyboard.type(' bis');
    await champ.press('Enter');
    await expect.poll(async () => (await exerciceEnregistre(page, 'Deux bis')).length).toBe(1);
    await attendreTitres(page, ['Un', 'Deux bis', 'Trois', 'Quatre', 'Cinq']);
  });
});
