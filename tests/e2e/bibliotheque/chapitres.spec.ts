// MODULE « bibliotheque » — CHAPITRES (le premier niveau de l'espace) : créer, renommer, réordonner, dupliquer, fusionner, supprimer.
// Observé en boîte noire (playwright-cli, 23/11/2026) : à l'ordinateur les chapitres sont des lignes de la colonne latérale (champ « Nouveau chapitre… ») ;
// au téléphone (≤ 700 px) ce sont des pastilles de la barre du haut (bouton « + » = « Ajouter un grand chapitre »). Le menu (clic droit / appui long) propose :
// Nouveau sous-dossier, Renommer, Dupliquer, Déplacer vers…, Fusionner avec…, Transformer en chapitre de morceaux…, Supprimer.
// Il n'existe PAS d'« archivage » de chapitre : l'entrée « Archivés » (colonne ou barre) regroupe les EXERCICES archivés (voir exercices.spec.ts).
import { test, expect } from '../support/fixtures';
import {
  arbre, ordreChapitres, auTelephone, bibliothequeType, chapitre, etatBibliotheque, lignesExercices, message, ouvrirChapitre, ouvrirMenu, choisirAction, menuContextuel,
  titreOuvert, titresAffiches, attendreTitres, annuler, retablir, ajouterExercice, glisser,
} from './aide-bibliotheque';
import type { Page } from '@playwright/test';
import type { Noeud } from './aide-bibliotheque';

async function creerChapitre(page: Page, nom: string) {
  if (auTelephone(page)) {
    await page.getByTitle('Ajouter un grand chapitre').click();
    const saisie = page.getByRole('dialog').getByRole('textbox');
    await saisie.fill(nom);
    await saisie.press('Enter');
  } else {
    const champ = page.getByPlaceholder('Nouveau chapitre…');
    await champ.fill(nom);
    await champ.press('Enter');
  }
  await expect(chapitre(page, nom)).toBeVisible();
}
const noms = async (page: Page) => (await arbre(page))[0].chapitres.map((c) => c.nom);

test.describe('Chapitres @bibliotheque', () => {
  test('créer un chapitre : il s\'ouvre, on y ajoute un exercice, tout reste après rechargement @critique', async ({ ouvrirAppli, garde }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await creerChapitre(page, 'Lecture à vue');
    await expect(titreOuvert(page)).toHaveText('Lecture à vue');
    expect(await noms(page)).toEqual(['Technique', 'Improvisation', 'Lecture à vue']);
    await expect(lignesExercices(page)).toHaveCount(0);

    await ajouterExercice(page, 'Rythmes simples');
    await attendreTitres(page, ['Rythmes simples']);

    await page.reload();
    await expect(chapitre(page, 'Lecture à vue')).toBeVisible();
    await ouvrirChapitre(page, 'Lecture à vue');
    await attendreTitres(page, ['Rythmes simples']);
    // Les autres chapitres n'ont pas bougé.
    await ouvrirChapitre(page, 'Improvisation');
    await attendreTitres(page, ['Blues en la']);
    expect(garde.bloquees).toEqual([]);
  });

  test('un nom vide ou fait d\'espaces ne crée pas de chapitre', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    if (auTelephone(page)) {
      await page.getByTitle('Ajouter un grand chapitre').click();
      const saisie = page.getByRole('dialog').getByRole('textbox');
      await saisie.fill('   ');
      await saisie.press('Enter');
      await page.keyboard.press('Escape');
    } else {
      const champ = page.getByPlaceholder('Nouveau chapitre…');
      await champ.fill('   ');
      await champ.press('Enter');
    }
    expect(await noms(page)).toEqual(['Technique', 'Improvisation']);
  });

  test('renommer un chapitre par son menu : le nom change partout (liste, fil d\'Ariane, état enregistré) @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirChapitre(page, 'Technique');
    await ouvrirMenu(page, chapitre(page, 'Technique'));
    await choisirAction(page, 'Renommer');
    const menu = menuContextuel(page);
    const champ = menu.getByRole('textbox');
    await expect(champ).toHaveValue('Technique');
    await champ.fill('Technique de la main droite');
    await menu.getByRole('button', { name: 'Valider' }).click();

    await expect(chapitre(page, 'Technique de la main droite')).toBeVisible();
    await expect(chapitre(page, 'Technique')).toHaveCount(0);
    await expect(titreOuvert(page)).toHaveText('Technique de la main droite');
    expect(await noms(page)).toEqual(['Technique de la main droite', 'Improvisation']);
    // Le contenu a suivi.
    await expect.poll(() => titresAffiches(page)).toEqual(['Gamme majeure', 'Arpèges']);
    await page.reload();
    await expect(chapitre(page, 'Technique de la main droite')).toBeVisible();
  });

  test('réordonner les chapitres par glisser-déposer : le nouvel ordre est enregistré et reste après rechargement', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatBibliotheque([{ nom: 'Basse', chapitres: [
      { nom: 'Technique' }, { nom: 'Gammes' }, { nom: 'Improvisation' },
    ] }]) });
    expect(await noms(page)).toEqual(['Technique', 'Gammes', 'Improvisation']);
    // « Improvisation » (dernier) est déposé sur la moitié haute de « Technique » (premier) : il passe en tête.
    const source = chapitre(page, 'Improvisation'), cible = chapitre(page, 'Technique');
    const affiches = auTelephone(page)
      ? page.locator('#chapter-bar .chapter-chip:not(.virtual-favorites):not(.virtual-archived) .chapter-chip-label')
      : page.locator('#sidebar-tree .tree-row-d0:not(.tree-row-fixed) .tree-label');
    await glisser(page, source, cible, 'haut');
    await expect(affiches).toHaveText(['Improvisation', 'Technique', 'Gammes']);
    await expect.poll(() => ordreChapitres(page)).toEqual(['Improvisation', 'Technique', 'Gammes']);
    await page.reload();
    await expect(affiches).toHaveText(['Improvisation', 'Technique', 'Gammes']);
    // Un exercice ajouté au chapitre déplacé reste dans CE chapitre (le contenu ne suit pas l'ordre d'affichage par erreur).
    await ouvrirChapitre(page, 'Improvisation');
    await ajouterExercice(page, 'Gamme blues');
    await attendreTitres(page, ['Gamme blues']);
    await ouvrirChapitre(page, 'Technique');
    await attendreTitres(page, []);
  });

  test('dupliquer un chapitre : « (copie) » à la fin, avec les mêmes exercices ; annuler le retire', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirMenu(page, chapitre(page, 'Technique'));
    await choisirAction(page, 'Dupliquer');
    await expect(chapitre(page, 'Technique (copie)')).toBeVisible();
    expect(await noms(page)).toEqual(['Technique', 'Improvisation', 'Technique (copie)']);
    // Tout ce que contient la copie (exercices ET dossiers, à tous les niveaux) porte « (copie) » (observé) ; l'original est intact.
    const original = (await arbre(page))[0].chapitres[0];
    const copie = (await arbre(page))[0].chapitres[2];
    const avecCopie = (n: Noeud): Noeud => ({ nom: `${n.nom} (copie)`, exercices: n.exercices.map((t) => `${t} (copie)`), dossiers: n.dossiers.map(avecCopie) });
    expect(copie.exercices).toEqual(original.exercices.map((t) => `${t} (copie)`));
    expect(copie.dossiers).toEqual(original.dossiers.map(avecCopie));
    expect(original.exercices).toEqual(['Gamme majeure', 'Arpèges']);
    expect(original.dossiers.map((d) => d.nom)).toEqual(['Rythme', 'Slap']);

    await annuler(page);
    await expect.poll(() => noms(page)).toEqual(['Technique', 'Improvisation']);
    await expect(chapitre(page, 'Technique (copie)')).toHaveCount(0);
  });

  test('fusionner deux chapitres : le contenu passe dans le chapitre choisi, l\'autre disparaît ; annuler remet les deux', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirMenu(page, chapitre(page, 'Improvisation'));
    await choisirAction(page, 'Fusionner avec…');
    // Choisir la cible dans la fenêtre de choix, puis confirmer.
    await page.locator('.folder-picker-panel').getByRole('button', { name: 'Technique', exact: true }).click();
    const boite = page.getByRole('dialog', { name: /Fusionner « Improvisation » dans « Technique » \?/ });
    await expect(boite).toContainText('« Improvisation » disparaît');
    await boite.getByRole('button', { name: 'Fusionner' }).click();
    await expect(boite).toBeHidden();

    await expect(chapitre(page, 'Improvisation')).toHaveCount(0);
    expect(await noms(page)).toEqual(['Technique']);
    const t = (await arbre(page))[0].chapitres[0];
    // Les exercices de « Improvisation » sont dans « Technique » (au premier niveau ou dans un dossier).
    const tous = (n: any): string[] => [...n.exercices, ...n.dossiers.flatMap(tous)];
    expect(tous(t)).toEqual(expect.arrayContaining(['Blues en la', 'Gamme majeure', 'Arpèges', 'Croches', 'Pouce', 'Pop simple']));

    await annuler(page);
    await expect.poll(() => noms(page)).toEqual(['Technique', 'Improvisation']);
    expect(((await arbre(page))[0].chapitres[1]).exercices).toEqual(['Blues en la']);
  });

  test('supprimer un chapitre : demande de confirmation, « Annuler » ne fait rien, « Supprimer » le met à la corbeille ; Annuler puis Rétablir @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirMenu(page, chapitre(page, 'Improvisation'));
    await choisirAction(page, 'Supprimer');
    const demande = menuContextuel(page);
    await expect(demande).toContainText('Supprimer « Improvisation » et tout son contenu');
    await expect(demande).toContainText('1 exercice dedans. Tout reste récupérable dans la corbeille.');
    await demande.getByRole('button', { name: 'Annuler' }).click();
    await expect(menuContextuel(page)).toBeHidden();
    expect(await noms(page)).toEqual(['Technique', 'Improvisation']);

    await ouvrirMenu(page, chapitre(page, 'Improvisation'));
    await choisirAction(page, 'Supprimer');
    await menuContextuel(page).getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect(chapitre(page, 'Improvisation')).toHaveCount(0);
    await expect(message(page, '« Improvisation » mis à la corbeille')).toBeVisible();
    expect(await noms(page)).toEqual(['Technique']);

    // Le message propose « Annuler » : le chapitre revient, avec son exercice.
    await message(page, 'mis à la corbeille').getByRole('button', { name: 'Annuler' }).click();
    await expect(chapitre(page, 'Improvisation')).toBeVisible();
    expect(((await arbre(page))[0].chapitres.find((c) => c.nom === 'Improvisation'))!.exercices).toEqual(['Blues en la']);

    // « Rétablir » supprime de nouveau.
    await retablir(page);
    await expect(chapitre(page, 'Improvisation')).toHaveCount(0);
  });

  test('« Nouveau sous-dossier » depuis le menu d\'un chapitre crée un dossier dedans', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirMenu(page, chapitre(page, 'Improvisation'));
    await choisirAction(page, 'Nouveau sous-dossier');
    const menu = menuContextuel(page);
    await menu.getByRole('textbox', { name: 'Nom du sous-dossier…' }).fill('Modes');
    await menu.getByRole('textbox').press('Enter');
    await expect(menuContextuel(page)).toBeHidden();
    const imp = (await arbre(page))[0].chapitres.find((c) => c.nom === 'Improvisation')!;
    expect(imp.dossiers.map((d) => d.nom)).toEqual(['Modes']);
    expect(imp.exercices).toEqual(['Blues en la']);
  });
});
