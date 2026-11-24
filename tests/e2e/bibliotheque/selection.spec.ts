// MODULE « bibliotheque » — SÉLECTION MULTIPLE d'exercices : Ctrl/⌘ + clic, Maj + clic (plage), « Sélectionner (plusieurs) » du menu, barre d'actions.
// Observé en boîte noire (playwright-cli, 23/11/2026) : Ctrl/⌘ + clic sur une ligne la sélectionne (classe `selected`, case ✓) et fait apparaître en bas la barre
// « N exercices sélectionnés » (role=toolbar « Actions sur la sélection » : ＋ Session…, Dé…, Déplacer vers…, Copier vers…, En cours, Favori, Archiver, Supprimer…, Tout, ✕).
// Maj + clic étend de la dernière ligne cliquée à celle-ci. Échap ou ✕ désélectionne. Après une action, la sélection est vidée.
import { test, expect } from '../support/fixtures';
import {
  actionExercice, annuler, attendreTitres, auTelephone, confirmer, etatBibliotheque, exerciceEnregistre, ligneDepart, ouvrirChapitre, ouvrirMenu, rangee, menuContextuel,
  message, titresAffiches, ouvrirChemin, choisirAction, ouvrirDossier,
} from './aide-bibliotheque';
import type { Page } from '@playwright/test';

const cinq = () => etatBibliotheque([{ nom: 'Basse', chapitres: [
  { nom: 'Technique', exercices: ['Un', 'Deux', 'Trois', 'Quatre', 'Cinq'], dossiers: [{ nom: 'Cible' }] },
] }]);
const barre = (page: Page) => page.getByRole('toolbar', { name: 'Actions sur la sélection' });
const choisis = (page: Page) => page.locator('#folder-container .exercise.selected');
const titresChoisis = (page: Page) => choisis(page).locator('input.exercise-title').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
const bouton = (page: Page, nom: string | RegExp) => barre(page).getByRole('button', { name: nom });

test.describe('Sélection multiple @bibliotheque', () => {
  test('Ctrl/⌘ + clic ajoute et retire des exercices ; la barre en donne le nombre ; Échap et ✕ désélectionnent @critique @ordinateur', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: cinq() });
    await ouvrirChapitre(page, 'Technique');
    await expect(barre(page)).toHaveCount(0);

    await rangee(ligneDepart(page, 'Un')).click({ modifiers: ['ControlOrMeta'] });
    await expect(barre(page)).toBeVisible();
    await expect(barre(page)).toContainText('1 exercice sélectionné');
    await rangee(ligneDepart(page, 'Trois')).click({ modifiers: ['ControlOrMeta'] });
    await expect(barre(page)).toContainText('2 exercices sélectionnés');
    await expect.poll(() => titresChoisis(page)).toEqual(['Un', 'Trois']);

    // Un second Ctrl+clic sur une ligne sélectionnée la retire.
    await rangee(ligneDepart(page, 'Un')).click({ modifiers: ['ControlOrMeta'] });
    await expect.poll(() => titresChoisis(page)).toEqual(['Trois']);
    await expect(barre(page)).toContainText('1 exercice sélectionné');

    // Échap vide la sélection, la barre disparaît.
    await page.keyboard.press('Escape');
    await expect(barre(page)).toHaveCount(0);
    await expect(choisis(page)).toHaveCount(0);

    // Même chose avec ✕.
    await rangee(ligneDepart(page, 'Deux')).click({ modifiers: ['ControlOrMeta'] });
    await rangee(ligneDepart(page, 'Quatre')).click({ modifiers: ['ControlOrMeta'] });
    await expect(barre(page)).toContainText('2 exercices sélectionnés');
    await barre(page).getByRole('button', { name: 'Désélectionner' }).click();
    await expect(barre(page)).toHaveCount(0);
    await attendreTitres(page, ['Un', 'Deux', 'Trois', 'Quatre', 'Cinq']);   // rien n'a été modifié
  });

  test('⌘ (Meta) + clic sélectionne comme Ctrl + clic @ordinateur', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: cinq() });
    await ouvrirChapitre(page, 'Technique');
    await rangee(ligneDepart(page, 'Deux')).click({ modifiers: ['Meta'] });
    await rangee(ligneDepart(page, 'Cinq')).click({ modifiers: ['Meta'] });
    await expect.poll(() => titresChoisis(page)).toEqual(['Deux', 'Cinq']);
    await expect(barre(page)).toContainText('2 exercices sélectionnés');
  });

  test('Maj + clic sélectionne toute la plage depuis la dernière ligne cliquée @critique @ordinateur', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: cinq() });
    await ouvrirChapitre(page, 'Technique');
    await rangee(ligneDepart(page, 'Deux')).click({ modifiers: ['ControlOrMeta'] });
    await rangee(ligneDepart(page, 'Quatre')).click({ modifiers: ['Shift'] });
    await expect.poll(() => titresChoisis(page)).toEqual(['Deux', 'Trois', 'Quatre']);
    await expect(barre(page)).toContainText('3 exercices sélectionnés');
    // « Tout » prend tout le dossier.
    await bouton(page, 'Tout').click();
    await expect.poll(() => titresChoisis(page)).toEqual(['Un', 'Deux', 'Trois', 'Quatre', 'Cinq']);
    await expect(barre(page)).toContainText('5 exercices sélectionnés');
  });

  test('« Sélectionner (plusieurs) » du menu démarre une sélection, que l\'on étend en touchant les autres lignes @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: cinq() });
    await ouvrirChapitre(page, 'Technique');
    await actionExercice(page, ligneDepart(page, 'Deux'), /Sélectionner \(plusieurs\)/);
    await expect(barre(page)).toContainText('1 exercice sélectionné');
    await expect.poll(() => titresChoisis(page)).toEqual(['Deux']);
    // En mode sélection, toucher une ligne la coche (sans Ctrl).
    await rangee(ligneDepart(page, 'Quatre')).click();
    await expect.poll(() => titresChoisis(page)).toEqual(['Deux', 'Quatre']);
    await expect(barre(page)).toContainText('2 exercices sélectionnés');
    await rangee(ligneDepart(page, 'Deux')).click();
    await expect.poll(() => titresChoisis(page)).toEqual(['Quatre']);
  });

  test('actions de la barre : Favori puis En cours sur la sélection ; message « Annuler » ; la sélection est vidée', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: cinq() });
    await ouvrirChapitre(page, 'Technique');
    await actionExercice(page, ligneDepart(page, 'Un'), /Sélectionner \(plusieurs\)/);
    await rangee(ligneDepart(page, 'Trois')).click();
    await rangee(ligneDepart(page, 'Cinq')).click();
    await bouton(page, /Favori/).click();
    await expect(message(page, '3 exercices ajoutés aux favoris')).toBeVisible();
    await expect(barre(page)).toHaveCount(0);
    for (const t of ['Un', 'Trois', 'Cinq']) expect((await exerciceEnregistre(page, t))[0].exo.favorite).toBe(true);
    for (const t of ['Deux', 'Quatre']) expect((await exerciceEnregistre(page, t))[0].exo.favorite).toBeFalsy();

    // « Annuler » du message défait l'action pour les trois d'un coup.
    await message(page, 'ajoutés aux favoris').getByRole('button', { name: 'Annuler' }).click();
    await expect.poll(async () => (await exerciceEnregistre(page, 'Trois'))[0].exo.favorite).toBeFalsy();
    expect((await exerciceEnregistre(page, 'Un'))[0].exo.favorite).toBeFalsy();

    // « En cours » sur deux autres.
    await actionExercice(page, ligneDepart(page, 'Deux'), /Sélectionner \(plusieurs\)/);
    await rangee(ligneDepart(page, 'Quatre')).click();
    await bouton(page, /En cours/).click();
    await expect.poll(async () => (await exerciceEnregistre(page, 'Deux'))[0].exo.inProgress).toBe(true);
    expect((await exerciceEnregistre(page, 'Quatre'))[0].exo.inProgress).toBe(true);
    expect((await exerciceEnregistre(page, 'Un'))[0].exo.inProgress).toBeFalsy();
  });

  test('archiver, déplacer et supprimer toute une sélection @critique', async ({ ouvrirAppli }) => {
    // Deux exercices par chapitre, sélectionnés avec « Tout » : au téléphone la barre d'actions recouvre le bas de l'écran et le 2e exercice n'est plus
    // touchable (BI-03, test plus bas) ; « Tout » est le contournement.
    const page = await ouvrirAppli({ etat: etatBibliotheque([{ nom: 'Basse', chapitres: [
      { nom: 'Technique', exercices: ['Un', 'Deux'] }, { nom: 'Source', exercices: ['Trois', 'Quatre'] }, { nom: 'Cible' },
    ] }]) });
    const toutChoisir = async (premier: string, ...tous: string[]) => {
      await actionExercice(page, ligneDepart(page, premier), /Sélectionner \(plusieurs\)/);
      await bouton(page, 'Tout').click();
      await expect.poll(() => titresChoisis(page)).toEqual([premier, ...tous]);
    };

    // Archiver Un + Deux.
    await ouvrirChapitre(page, 'Technique');
    await toutChoisir('Un', 'Deux');
    await bouton(page, 'Archiver').click();
    await attendreTitres(page, []);
    expect((await exerciceEnregistre(page, 'Un'))[0].exo.archived).toBe(true);
    expect((await exerciceEnregistre(page, 'Deux'))[0].exo.archived).toBe(true);

    // Déplacer Trois + Quatre dans le chapitre « Cible ».
    await ouvrirChapitre(page, 'Source');
    await toutChoisir('Trois', 'Quatre');
    await bouton(page, 'Déplacer vers…').click();
    await page.locator('.folder-picker-panel').getByRole('button', { name: 'Cible', exact: true }).click();
    await attendreTitres(page, []);
    expect((await exerciceEnregistre(page, 'Trois'))[0].chemin).toBe('Basse › Cible');
    expect((await exerciceEnregistre(page, 'Quatre'))[0].chemin).toBe('Basse › Cible');

    // Supprimer Trois + Quatre : confirmation puis corbeille ; Annuler les ramène.
    await ouvrirChapitre(page, 'Cible');
    await toutChoisir('Trois', 'Quatre');
    await bouton(page, 'Supprimer…').click();
    await expect(page.getByRole('dialog')).toContainText('Supprimer 2 exercices ?');
    await expect(page.getByRole('dialog')).toContainText('dans la corbeille');
    await confirmer(page, 'Supprimer');
    await attendreTitres(page, []);
    expect(await exerciceEnregistre(page, 'Trois')).toHaveLength(0);
    await annuler(page);
    await attendreTitres(page, ['Trois', 'Quatre']);
  });

  test('la barre d\'actions ne recouvre pas les derniers exercices : en bas de la liste, on peut les atteindre', async ({ ouvrirAppli }) => {
    test.fail(true, 'BI-03 : la barre « N exercices sélectionnés » (fixe, en bas) recouvre le dernier exercice et le champ « Ajouter un exercice… » même au bas du défilement.');
    const titres = Array.from({ length: 14 }, (_, i) => `Exo ${String(i + 1).padStart(2, '0')}`);
    const page = await ouvrirAppli({ etat: etatBibliotheque([{ nom: 'Basse', chapitres: [{ nom: 'Technique', exercices: titres }] }]) });
    await ouvrirChapitre(page, 'Technique');
    await actionExercice(page, ligneDepart(page, 'Exo 01'), /Sélectionner \(plusieurs\)/);
    await expect(barre(page)).toBeVisible();
    await page.evaluate(() => { document.scrollingElement!.scrollTop = 1e6; });
    const { hautBarre, basDernier, basChamp } = await page.evaluate(() => ({
      hautBarre: document.querySelector('.sel-bar')!.getBoundingClientRect().top,
      basDernier: [...document.querySelectorAll('#folder-container .exercise')].pop()!.getBoundingClientRect().bottom,
      basChamp: document.querySelector('#folder-container .add-exercise-row')!.getBoundingClientRect().bottom,
    }));
    expect(basDernier).toBeLessThanOrEqual(hautBarre);
    expect(basChamp).toBeLessThanOrEqual(hautBarre);
  });

  test('« Copier vers… » duplique la sélection dans un autre dossier sans toucher aux originaux', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: cinq() });
    await ouvrirChapitre(page, 'Technique');
    await actionExercice(page, ligneDepart(page, 'Un'), /Sélectionner \(plusieurs\)/);
    await rangee(ligneDepart(page, 'Deux')).click();
    await bouton(page, 'Copier vers…').click();
    await page.locator('.folder-picker-panel').getByRole('button', { name: 'Cible', exact: true }).click();
    await attendreTitres(page, ['Un', 'Deux', 'Trois', 'Quatre', 'Cinq']);
    await expect.poll(async () => (await exerciceEnregistre(page, 'Un')).map((x) => x.chemin).sort()).toEqual(['Basse › Technique', 'Basse › Technique › Cible']);
    expect((await exerciceEnregistre(page, 'Deux')).map((x) => x.chemin).sort()).toEqual(['Basse › Technique', 'Basse › Technique › Cible']);
  });

  test('le menu d\'un exercice sélectionné s\'applique à toute la sélection', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: cinq() });
    await ouvrirChapitre(page, 'Technique');
    await actionExercice(page, ligneDepart(page, 'Un'), /Sélectionner \(plusieurs\)/);
    await rangee(ligneDepart(page, 'Trois')).click();
    await ouvrirMenu(page, rangee(ligneDepart(page, 'Trois')));
    const menu = menuContextuel(page);
    await expect(menu.getByRole('button', { name: /Favori/ })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Archiver' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Supprimer…' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Renommer…' })).toHaveCount(0);   // pas d'action « un seul exercice »
    await choisirAction(page, 'Archiver');
    await attendreTitres(page, ['Deux', 'Quatre', 'Cinq']);
  });
});
