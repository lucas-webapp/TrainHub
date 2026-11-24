// MODULE « bibliotheque » — EXERCICES : ajouter en rafale, renommer, dupliquer, copies liées, supprimer (corbeille + annuler), favori, « En cours », archiver.
// Observé en boîte noire (playwright-cli, 23/11/2026) : le champ « Ajouter un exercice… » reste prêt après Entrée (rafale) ; le titre d'une ligne est un champ de saisie ;
// le menu (clic droit / appui long) propose Renommer…, Ajouter à une session…, « Marquer « En cours » », « Marquer en favori », Déplacer vers…, Plus d'actions ▾
// (Transformer en morceau…, Remplacer partout par…, Lier à un autre exercice…, Sélectionner (plusieurs), Dupliquer, Archiver) et Supprimer… (→ corbeille, message « Annuler »).
// Les détails de la corbeille et des favoris au pixel près sont tenus par les bancs `corbeille` et `favoris` (PLAN § 7) : ici, les PARCOURS.
import { test, expect } from '../support/fixtures';
import {
  actionExercice, ajouterExercice, annuler, attendreTitres, bibliothequeType, champTitre, confirmer, corbeilleEnregistree, entreeArchives, entreeFavoris, etatBibliotheque,
  exerciceEnregistre, exercicesEnregistres, lignesExercices, ligne, ligneDepart, menuContextuel, message, ouvrirChapitre, ouvrirChemin, ouvrirMenu, rangee, retablir, titresAffiches, titresVue,
} from './aide-bibliotheque';
import type { Page } from '@playwright/test';

const unExercice = (titre: string) => etatBibliotheque([{ nom: 'Basse', chapitres: [{ nom: 'Technique', exercices: [titre] }] }]);
const troisExercices = () => etatBibliotheque([{ nom: 'Basse', chapitres: [{ nom: 'Technique', exercices: ['Alpha', 'Bravo', 'Charlie'] }] }]);
const champAjout = (page: Page) => page.locator('#folder-container .add-exercise-row input');

test.describe('Exercices @bibliotheque', () => {
  test('ajouter des exercices en rafale : Entrée les crée l\'un après l\'autre, dans l\'ordre, et ils restent après rechargement @critique', async ({ ouvrirAppli, garde }) => {
    const page = await ouvrirAppli({ etat: etatBibliotheque([{ nom: 'Basse', chapitres: [{ nom: 'Technique' }] }]) });
    await ouvrirChapitre(page, 'Technique');
    await expect(lignesExercices(page)).toHaveCount(0);

    // Rafale : saisie + Entrée, saisie + Entrée… (voir le test suivant pour le focus après Entrée, BI-01).
    for (const t of ['Gamme de do', 'Gamme de ré', 'Gamme de mi', 'Gamme de fa']) {
      await champAjout(page).fill(t);
      await champAjout(page).press('Enter');
      await expect(champAjout(page)).toHaveValue('');
    }
    await attendreTitres(page, ['Gamme de do', 'Gamme de ré', 'Gamme de mi', 'Gamme de fa']);
    // Le bouton « + » fait pareil.
    await champAjout(page).fill('Gamme de sol');
    await page.getByTitle("Ajouter l'exercice").click();
    await attendreTitres(page, ['Gamme de do', 'Gamme de ré', 'Gamme de mi', 'Gamme de fa', 'Gamme de sol']);

    // Un titre vide, ou fait d'espaces, ne crée rien.
    await champAjout(page).fill('   ');
    await champAjout(page).press('Enter');
    await attendreTitres(page, ['Gamme de do', 'Gamme de ré', 'Gamme de mi', 'Gamme de fa', 'Gamme de sol']);

    await expect.poll(async () => (await exercicesEnregistres(page)).map((x) => x.exo.title)).toEqual(['Gamme de do', 'Gamme de ré', 'Gamme de mi', 'Gamme de fa', 'Gamme de sol']);
    await page.reload();
    await ouvrirChapitre(page, 'Technique');
    await attendreTitres(page, ['Gamme de do', 'Gamme de ré', 'Gamme de mi', 'Gamme de fa', 'Gamme de sol']);
    expect(garde.bloquees).toEqual([]);
  });

  test('après Entrée, le champ « Ajouter un exercice… » garde le focus : on peut taper les exercices suivants au clavier, sans reprendre la souris', async ({ ouvrirAppli }) => {
    test.fail(true, 'BI-01 : après Entrée, le focus passe au <body> (champ perdu) : la 2e saisie au clavier est perdue. À arbitrer (mineur).');
    const page = await ouvrirAppli({ etat: etatBibliotheque([{ nom: 'Basse', chapitres: [{ nom: 'Technique' }] }]) });
    await ouvrirChapitre(page, 'Technique');
    await champAjout(page).click();
    for (const t of ['Un', 'Deux', 'Trois']) {
      await page.keyboard.type(t);
      await page.keyboard.press('Enter');
    }
    await attendreTitres(page, ['Un', 'Deux', 'Trois']);
  });

  test('un exercice se crée dans le dossier ouvert, pas ailleurs', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirChemin(page, 'Technique', 'Slap', 'Pops');
    await ajouterExercice(page, 'Pop double');
    await attendreTitres(page, ['Pop simple', 'Pop double']);
    const emplacement = (await exerciceEnregistre(page, 'Pop double'))[0].chemin;
    expect(emplacement).toBe('Basse › Technique › Slap › Pops');
    await ouvrirChemin(page, 'Technique', 'Slap');
    await attendreTitres(page, ['Pouce']);
  });

  test('renommer un exercice : en modifiant son titre sur la ligne (Entrée), puis par « Renommer… » ; le titre est enregistré @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: troisExercices() });
    await ouvrirChapitre(page, 'Technique');

    // Directement dans le champ du titre.
    const alpha = ligneDepart(page, 'Alpha');
    await champTitre(alpha).fill('Alpha renommé');
    await champTitre(alpha).press('Enter');
    await expect.poll(async () => (await exerciceEnregistre(page, 'Alpha renommé')).length).toBe(1);
    await expect.poll(() => titresAffiches(page)).toEqual(['Alpha renommé', 'Bravo', 'Charlie']);

    // Par le menu : une petite boîte, bouton grisé tant que le titre ne change pas.
    await actionExercice(page, ligneDepart(page, 'Bravo'), 'Renommer…');
    const boite = page.getByRole('dialog', { name: "Renommer l'exercice" });
    await expect(boite.getByRole('textbox')).toHaveValue('Bravo');
    await expect(boite.getByRole('button', { name: 'Renommer', exact: true })).toBeDisabled();
    await boite.getByRole('textbox').fill('Bravo 2');
    await boite.getByRole('textbox').press('Enter');
    await expect(boite).toBeHidden();
    await expect.poll(() => titresAffiches(page)).toEqual(['Alpha renommé', 'Bravo 2', 'Charlie']);
    expect((await exerciceEnregistre(page, 'Bravo 2'))).toHaveLength(1);
    expect((await exerciceEnregistre(page, 'Bravo'))).toHaveLength(0);

    await page.reload();
    await ouvrirChapitre(page, 'Technique');
    await attendreTitres(page, ['Alpha renommé', 'Bravo 2', 'Charlie']);
  });

  test('la boîte « Renommer… » limite le titre à 80 caractères et « Annuler » ne change rien', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: unExercice('Court') });
    await ouvrirChapitre(page, 'Technique');
    await actionExercice(page, ligneDepart(page, 'Court'), 'Renommer…');
    const boite = page.getByRole('dialog', { name: "Renommer l'exercice" });
    await boite.getByRole('textbox').fill('x'.repeat(120));
    await expect(boite.getByRole('textbox')).toHaveValue('x'.repeat(80));
    await boite.getByRole('button', { name: 'Annuler' }).click();
    await expect(boite).toBeHidden();
    await attendreTitres(page, ['Court']);
  });

  test('dupliquer un exercice : une copie liée « (copie) » apparaît en fin de liste, avec un badge de liaison sur les deux', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: troisExercices() });
    await ouvrirChapitre(page, 'Technique');
    await actionExercice(page, ligneDepart(page, 'Bravo'), 'Dupliquer');
    await expect.poll(() => titresAffiches(page)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Bravo (copie)']);
    await expect(message(page, /Copie liée à l'original/)).toBeVisible();
    // Un badge « exercice lié » sur l'original et sur la copie, pas sur les autres.
    const badge = (l: ReturnType<typeof ligneDepart>) => l.getByRole('button', { name: 'Exercice lié : gérer la liaison' });
    await expect(badge(ligneDepart(page, 'Bravo'))).toBeVisible();
    await expect(badge(await ligne(page, 'Bravo (copie)'))).toBeVisible();
    await expect(badge(ligneDepart(page, 'Alpha'))).toHaveCount(0);
    await expect(badge(ligneDepart(page, 'Charlie'))).toHaveCount(0);
  });

  test('copies liées : le badge ouvre la boîte de liaison ; « Rompre pour cet exercice » sépare, et « Annuler » rétablit le lien @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: unExercice('Walking') });
    await ouvrirChapitre(page, 'Technique');
    await actionExercice(page, ligneDepart(page, 'Walking'), 'Dupliquer');
    const original = ligneDepart(page, 'Walking');
    const badge = original.getByRole('button', { name: 'Exercice lié : gérer la liaison' });
    await badge.click();
    const boite = page.getByRole('dialog', { name: 'Liaison de « Walking »' });
    await expect(boite).toContainText('Pièces jointes');
    await expect(boite).toContainText('Walking (copie)');
    await expect(boite.getByRole('button', { name: 'Ouvrir' })).toBeVisible();

    await boite.getByRole('button', { name: 'Rompre pour cet exercice' }).click();
    await expect(boite).toBeHidden();
    await expect(page.locator('#folder-container').getByRole('button', { name: 'Exercice lié : gérer la liaison' })).toHaveCount(0);
    await expect(message(page, '« Walking » n\'est plus lié aux autres exercices')).toBeVisible();

    await message(page, 'n\'est plus lié').getByRole('button', { name: 'Annuler' }).click();
    await expect(page.locator('#folder-container').getByRole('button', { name: 'Exercice lié : gérer la liaison' })).toHaveCount(2);
  });

  test('lier deux exercices existants : choisir l\'autre dans la liste, confirmer, les deux portent le badge', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: troisExercices() });
    await ouvrirChapitre(page, 'Technique');
    await actionExercice(page, ligneDepart(page, 'Alpha'), /Lier à un autre exercice/);
    const choix = page.locator('.exercise-picker-panel');
    await expect(choix).toContainText('Lier « Alpha » à…');
    await choix.getByPlaceholder('Rechercher un exercice…').fill('Brav');
    await choix.getByText('Bravo', { exact: true }).click();
    const boite = page.getByRole('dialog', { name: 'Lier les deux exercices' });
    await expect(boite).toContainText('« Alpha » (Technique) et « Bravo » (Technique) mettront en commun leurs pièces jointes et leurs réglages');
    await boite.getByRole('button', { name: 'Lier', exact: true }).click();
    await expect(boite).toBeHidden();
    await expect(message(page, '« Alpha » et « Bravo » sont liés')).toBeVisible();
    const badge = (t: string) => ligneDepart(page, t).getByRole('button', { name: 'Exercice lié : gérer la liaison' });
    await expect(badge('Alpha')).toBeVisible();
    await expect(badge('Bravo')).toBeVisible();
    await expect(badge('Charlie')).toHaveCount(0);
  });

  test('supprimer un exercice : confirmation, mis à la corbeille, « Annuler » le ramène à sa place, « Rétablir » le supprime de nouveau @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: troisExercices() });
    await ouvrirChapitre(page, 'Technique');
    await actionExercice(page, ligneDepart(page, 'Bravo'), 'Supprimer…');
    const boite = page.getByRole('dialog', { name: 'Supprimer « Bravo » ?' });
    await expect(boite).toContainText('Récupérable dans la corbeille.');
    // Refuser ne supprime rien.
    await boite.getByRole('button', { name: 'Annuler' }).click();
    await expect(boite).toBeHidden();
    await attendreTitres(page, ['Alpha', 'Bravo', 'Charlie']);

    await actionExercice(page, ligneDepart(page, 'Bravo'), 'Supprimer…');
    await confirmer(page, 'Supprimer');
    await attendreTitres(page, ['Alpha', 'Charlie']);
    await expect(message(page, '« Bravo » mis à la corbeille')).toBeVisible();
    expect(await exerciceEnregistre(page, 'Bravo')).toHaveLength(0);
    expect(JSON.stringify(await corbeilleEnregistree(page))).toContain('Bravo');

    // « Annuler » du message : l'exercice revient À SA PLACE (entre Alpha et Charlie).
    await message(page, 'mis à la corbeille').getByRole('button', { name: 'Annuler' }).click();
    await attendreTitres(page, ['Alpha', 'Bravo', 'Charlie']);
    expect(await exerciceEnregistre(page, 'Bravo')).toHaveLength(1);

    // « Rétablir » (bouton du haut ou menu « ⋯ ») refait la suppression, « Annuler » la défait encore.
    await retablir(page);
    await attendreTitres(page, ['Alpha', 'Charlie']);
    await annuler(page);
    await attendreTitres(page, ['Alpha', 'Bravo', 'Charlie']);
  });

  test('la corbeille de l\'appli propose l\'exercice supprimé et le restaure', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: troisExercices() });
    await ouvrirChapitre(page, 'Technique');
    await actionExercice(page, ligneDepart(page, 'Charlie'), 'Supprimer…');
    await confirmer(page, 'Supprimer');
    await attendreTitres(page, ['Alpha', 'Bravo']);

    if ((page.viewportSize()?.width ?? 1440) <= 700) { await page.locator('#more-btn').click(); await page.getByRole('menuitem', { name: 'Corbeille' }).click(); }
    else await page.getByRole('button', { name: 'Corbeille' }).click();
    const corbeille = page.locator('.backups-panel, [role=dialog]').filter({ hasText: 'Charlie' }).first();
    await expect(corbeille).toBeVisible();
    await corbeille.getByRole('button', { name: /Restaurer/ }).first().click();
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await exerciceEnregistre(page, 'Charlie')).length).toBe(1);
  });

  test('favori : le menu marque l\'exercice (étoile), l\'entrée « Favoris » le liste, le menu le démarque @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirChapitre(page, 'Technique');
    const arpeges = ligneDepart(page, 'Arpèges');
    await actionExercice(page, arpeges, /Marquer en favori/);
    await expect(arpeges.locator('.exercise-favorite-badge svg')).toBeVisible();   // le badge est une boîte de 0 × 0 : seule son étoile se voit
    expect((await exerciceEnregistre(page, 'Arpèges'))[0].exo.favorite).toBe(true);

    // L'entrée « Favoris » de la colonne (ou de la barre) montre l'exercice, groupé par dossier.
    await entreeFavoris(page).click();
    await expect.poll(() => titresVue(page)).toEqual(['Arpèges']);
    await expect(page.locator('#folder-container .exercise-favorite-badge svg').first()).toBeVisible();

    // On le démarque depuis la liste des favoris : il disparaît de la liste.
    const dansFavoris = page.locator('#folder-container [data-ex-id="' + 'ex-arpeges' + '"]');
    await ouvrirMenu(page, rangee(dansFavoris));
    await menuContextuel(page).getByRole('button', { name: /Retirer des favoris|Marquer en favori|favori/ }).first().click();
    await expect(dansFavoris).toHaveCount(0);
    expect((await exerciceEnregistre(page, 'Arpèges'))[0].exo.favorite).toBe(false);
  });

  test('« En cours » : le menu marque l\'exercice (pastille), le bouton « En cours » de la fiche ouverte bascule aussi, le filtre « ● En cours » ne garde que ceux-là', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: troisExercices() });
    await ouvrirChapitre(page, 'Technique');
    const bravo = ligneDepart(page, 'Bravo');
    await actionExercice(page, bravo, /Marquer « En cours »/);
    await expect(bravo.getByRole('img', { name: 'En cours' })).toHaveCount(1);
    expect((await exerciceEnregistre(page, 'Bravo'))[0].exo.inProgress).toBe(true);

    // Le menu propose maintenant de le retirer.
    await ouvrirMenu(page, rangee(bravo));
    await expect(menuContextuel(page).getByRole('button', { name: /En cours/ }).first()).toContainText(/Retirer|●/);
    await page.keyboard.press('Escape');

    // Filtre « ● En cours » de la barre de la liste.
    await page.getByRole('button', { name: '● En cours' }).click();
    await attendreTitres(page, ['Bravo']);
    await page.getByRole('button', { name: '● En cours' }).click();
    await attendreTitres(page, ['Alpha', 'Bravo', 'Charlie']);

    // On le retire par le menu.
    await actionExercice(page, bravo, /En cours/);
    await expect(bravo.getByRole('img', { name: 'En cours' })).toHaveCount(0);
    expect((await exerciceEnregistre(page, 'Bravo'))[0].exo.inProgress).toBeFalsy();
  });

  test('archiver un exercice : il quitte son dossier, apparaît dans « Archivés » (avec son dossier d\'origine) et on peut le désarchiver @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirChemin(page, 'Technique', 'Rythme');
    await actionExercice(page, ligneDepart(page, 'Triolets'), 'Archiver');
    await attendreTitres(page, ['Croches']);
    expect((await exerciceEnregistre(page, 'Triolets'))[0].exo.archived).toBe(true);

    await entreeArchives(page).click();
    const archive = page.locator('#folder-container [data-ex-id="ex-triolets"]');
    await expect(archive).toBeVisible();
    await expect(archive.locator('.exercise-archived-badge')).toHaveText('Archivé');
    await expect(page.locator('#folder-container .result-group-title')).toContainText('Rythme');

    // Désarchiver (menu › Plus d'actions) : il retourne dans son dossier.
    await actionExercice(page, archive, /Désarchiver/);
    await expect(archive).toHaveCount(0);
    expect((await exerciceEnregistre(page, 'Triolets'))[0].exo.archived).toBeFalsy();
    await ouvrirChemin(page, 'Technique', 'Rythme');
    await expect.poll(() => titresAffiches(page)).toEqual(expect.arrayContaining(['Croches', 'Triolets']));
  });

  test('« Déplacer vers… » envoie l\'exercice dans un autre dossier ; annuler le remet', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ouvrirChapitre(page, 'Technique');
    await actionExercice(page, ligneDepart(page, 'Arpèges'), 'Déplacer vers…');
    await page.locator('.folder-picker-panel').getByRole('button', { name: 'Slap', exact: true }).click();
    await expect(page.locator('.folder-picker-panel')).toBeHidden();
    await attendreTitres(page, ['Gamme majeure']);
    expect((await exerciceEnregistre(page, 'Arpèges'))[0].chemin).toBe('Basse › Technique › Slap');
    await annuler(page);
    await attendreTitres(page, ['Gamme majeure', 'Arpèges']);
  });
});
