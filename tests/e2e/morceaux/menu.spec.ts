// MODULE « morceaux » — le MENU d'un morceau (clic droit, appui long au téléphone) et ce qu'on en fait : favori, « En cours » (= un état de travail), archiver, renommer, déplacer, supprimer. Observé en boîte noire
// (playwright-cli, 26/11/2026) : menu de premier niveau « Ouvrir dans son dossier » (hors dossier), « Classer : style, technique, travail… », Renommer…, Ajouter à une session…, « Marquer « En cours » »,
// « Marquer en favori », Déplacer vers…, « Plus d'actions ▾ » (Travailler un passage en exercice…, Remplacer partout par…, Sélectionner (plusieurs), Archiver) et Supprimer… ; JAMAIS « Dupliquer », « Lier à un
// autre exercice… » ni « Transformer en morceau… » (un morceau ne se duplique ni ne se lie : on le range par ses caractéristiques). « En cours » d'un morceau = l'état de Travail que le chapitre désigne comme tel.
import { test, expect } from '../support/fixtures';
import {
  actionExercice, annuler, attendreMorceau, boite, boutonPropriete, champsArtiste, champsTitre, chapitreEnregistre, choisirAction, choisirVue, confirmer, deplier, dossierCalcule, entreeArchives, entreeFavoris, etatMorceaux,
  ligneDepart, menuContextuel, message, morceauEnregistre, nomsDossiers, ouvrirDossierCalcule, ouvrirMenu, ouvrirMorceaux, rangee, repondre, titresMorceaux, titresEnregistres, effectif,
} from './aide-morceaux';
import { corbeilleEnregistree, ouvrirChapitre } from '../bibliotheque/aide-bibliotheque';
import type { Page } from '@playwright/test';

const etat = () => etatMorceaux([{ titre: 'Beatles - Help', styles: ['Rock'] }, { titre: 'Beatles - Michelle', styles: ['Rock'] }, 'Muse - Hysteria', 'Solo à la basse'], { exercices: ['Gamme'], vocab: { styles: ['Rock'] } });
const entrees = (page: Page) => menuContextuel(page).getByRole('button').allTextContents();
const enCoursBadge = (page: Page, titre: string) => ligneDepart(page, titre).getByRole('img', { name: 'En cours' });

test.describe('Morceaux : le menu d\'un morceau @morceaux', () => {
  test('les entrées du menu : celles d\'un exercice, plus « Classer… » et « Travailler un passage en exercice… » ; jamais Dupliquer, Lier ni Transformer en morceau @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await ouvrirMenu(page, rangee(ligneDepart(page, 'Muse - Hysteria')));
    expect(await entrees(page)).toEqual(['Ouvrir dans son dossier', 'Classer : style, technique, travail…', 'Renommer…', 'Ajouter à une session…', '○ Marquer « En cours »', '☆ Marquer en favori', 'Déplacer vers…', 'Plus d\'actions ▾', 'Supprimer…']);
    await menuContextuel(page).getByRole('button', { name: /Plus d'actions/ }).click();
    expect(await entrees(page)).toEqual(['Ouvrir dans son dossier', 'Classer : style, technique, travail…', 'Renommer…', 'Ajouter à une session…', '○ Marquer « En cours »', '☆ Marquer en favori', 'Déplacer vers…', 'Moins d\'actions ▴',
      'Travailler un passage en exercice…', 'Remplacer partout par…', '☑ Sélectionner (plusieurs)', 'Archiver', 'Supprimer…']);
    // Au contraire, un exercice ordinaire reçoit « Transformer en morceau… » (module bibliotheque), pas « Travailler un passage en exercice… ».
    await page.keyboard.press('Escape');
    await ouvrirChapitre(page, 'Technique');
    await ouvrirMenu(page, rangee(ligneDepart(page, 'Gamme')));
    await menuContextuel(page).getByRole('button', { name: /Plus d'actions/ }).click();
    const sortie = await entrees(page);
    expect(sortie).toContain('♪ Transformer en morceau…');
    expect(sortie).not.toContain('Travailler un passage en exercice…');
  });

  test('« Classer : style, technique, travail… » ouvre la fiche du morceau, là où se trouvent les trois menus', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    const f = ligneDepart(page, 'Muse - Hysteria');
    await expect(f).toHaveClass(/collapsed/);
    await actionExercice(page, f, 'Classer : style, technique, travail…');
    await expect(f).not.toHaveClass(/collapsed/);
    await expect(boutonPropriete(f, 'Style')).toBeVisible();
    await expect(boutonPropriete(f, 'Technique')).toBeVisible();
    await expect(boutonPropriete(f, 'Travail')).toBeVisible();
  });

  test('marquer un morceau « En cours » lui donne l\'état de travail « En cours » du chapitre (un point sur le titre) ; le retirer vide l\'état @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await ouvrirDossierCalcule(page, 'Beatles');
    const f = ligneDepart(page, 'Beatles - Help');
    await expect(enCoursBadge(page, 'Beatles - Help')).toHaveCount(0);
    await actionExercice(page, f, '○ Marquer « En cours »');
    await attendreMorceau(page, 'Beatles - Help', (m) => m.work === 'En cours');
    await expect(enCoursBadge(page, 'Beatles - Help')).toBeAttached();
    await ouvrirMenu(page, rangee(f));
    await expect(menuContextuel(page).getByRole('button', { name: '● Retirer « En cours »' })).toBeVisible();
    await choisirAction(page, '● Retirer « En cours »');
    await attendreMorceau(page, 'Beatles - Help', (m) => m.work === '');
    await expect(enCoursBadge(page, 'Beatles - Help')).toHaveCount(0);
  });

  test('un chapitre sans état « En cours » (supprimé du vocabulaire) : « Marquer En cours » le recrée et le donne au morceau', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(['Muse - Hysteria'], { vocab: { travail: ['À maîtriser', 'Maîtrisé'], enCours: '' } }) });
    await ouvrirMorceaux(page);
    await actionExercice(page, ligneDepart(page, 'Muse - Hysteria'), '○ Marquer « En cours »');
    await attendreMorceau(page, 'Muse - Hysteria', (m) => m.work === 'En cours');
    const ch = await chapitreEnregistre(page);
    expect(ch.vocab.work).toEqual(['À maîtriser', 'Maîtrisé', 'En cours']);
    expect(ch.vocab.inProgress).toBe('En cours');
  });

  test('un chapitre dont l\'état « en cours » est un autre mot (« Au boulot ») : Marquer « En cours » donne cet état', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(['Muse - Hysteria'], { vocab: { travail: ['Au boulot', 'Fini'], enCours: 'Au boulot' } }) });
    await ouvrirMorceaux(page);
    await actionExercice(page, ligneDepart(page, 'Muse - Hysteria'), '○ Marquer « En cours »');
    await attendreMorceau(page, 'Muse - Hysteria', (m) => m.work === 'Au boulot');
    await choisirVue(page, 'Travail');
    await expect(dossierCalcule(page, 'Au boulot')).toContainText('1');
  });

  test('favori : l\'étoile apparaît, le morceau est dans « Favoris » avec les exercices favoris ; « Retirer des favoris » l\'en sort @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await actionExercice(page, ligneDepart(page, 'Muse - Hysteria'), '☆ Marquer en favori');
    await attendreMorceau(page, 'Muse - Hysteria', (m) => m.favorite === true);
    await expect(ligneDepart(page, 'Muse - Hysteria').locator('.exercise-favorite-badge')).toBeAttached();   // une étoile posée sur le titre : pas de place prise
    await entreeFavoris(page).click();
    await expect(page.locator('#folder-container .exercise-title')).toHaveValue('Muse - Hysteria');
    // Depuis la liste des favoris : « Ouvrir dans son dossier » ramène à la page du morceau, fiche ouverte.
    await ouvrirMenu(page, rangee(ligneDepart(page, 'Muse - Hysteria')));
    expect((await entrees(page))[0]).toBe('Ouvrir dans son dossier');
    await choisirAction(page, 'Ouvrir dans son dossier');
    await expect(page.locator('#breadcrumb .crumb-current')).toHaveText('Morceaux');
    await expect(ligneDepart(page, 'Muse - Hysteria')).not.toHaveClass(/collapsed/);
    await actionExercice(page, ligneDepart(page, 'Muse - Hysteria'), '★ Retirer des favoris');
    await attendreMorceau(page, 'Muse - Hysteria', (m) => m.favorite === false);
    await expect(ligneDepart(page, 'Muse - Hysteria').locator('.exercise-favorite-badge')).toHaveCount(0);
  });

  test('« Ouvrir dans son dossier » depuis les favoris suit le rangement : un morceau de « Beatles » mène au dossier Beatles', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux([{ titre: 'Beatles - Help', favori: true }, 'Beatles - Michelle', 'Muse - Hysteria']) });
    await entreeFavoris(page).click();
    await ouvrirMenu(page, rangee(ligneDepart(page, 'Beatles - Help')));
    await choisirAction(page, 'Ouvrir dans son dossier');
    await expect(page.locator('#breadcrumb .crumb')).toHaveText(['Morceaux', 'Beatles']);
    await expect(ligneDepart(page, 'Beatles - Help')).not.toHaveClass(/collapsed/);
  });

  test('archiver : le morceau quitte les rangements et le compte, il est dans « Archivés » ; désarchiver le remet à sa place @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await expect(effectif(page)).toHaveText('4 morceaux');
    await actionExercice(page, ligneDepart(page, 'Muse - Hysteria'), 'Archiver');
    await attendreMorceau(page, 'Muse - Hysteria', (m) => m.archived === true);
    await expect(effectif(page)).toHaveText('3 morceaux');
    expect(await titresMorceaux(page)).not.toContain('Muse - Hysteria');
    await entreeArchives(page).click();
    const f = ligneDepart(page, 'Muse - Hysteria');
    await expect(f).toBeVisible();
    await expect(f.locator('.exercise-archived-badge')).toHaveText('Archivé');
    await ouvrirMenu(page, rangee(f));
    await menuContextuel(page).getByRole('button', { name: /Plus d'actions/ }).click();
    expect(await entrees(page)).not.toContain('Travailler un passage en exercice…');   // proposé seulement pour un morceau non archivé
    await choisirAction(page, 'Désarchiver');
    await attendreMorceau(page, 'Muse - Hysteria', (m) => m.archived === false);
    await ouvrirMorceaux(page);
    await expect(effectif(page)).toHaveText('4 morceaux');
  });

  test('supprimer : confirmation, le morceau part à la corbeille avec ses caractéristiques ; « Annuler » le remet dans son chapitre, toujours un morceau', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux([{ titre: 'Beatles - Help', styles: ['Rock'], travail: 'En cours' }, 'Muse - Hysteria'], { vocab: { styles: ['Rock'] } }) });
    await ouvrirMorceaux(page);
    await actionExercice(page, ligneDepart(page, 'Beatles - Help'), 'Supprimer…');
    await confirmer(page, 'Supprimer');
    await expect.poll(() => titresEnregistres(page)).toEqual(['Muse - Hysteria']);
    await expect.poll(async () => (await corbeilleEnregistree(page)).length).toBe(1);
    await expect(effectif(page)).toHaveText('1 morceau');
    await message(page, 'Beatles - Help').getByRole('button', { name: 'Annuler' }).click();
    await expect.poll(() => titresEnregistres(page)).toEqual(['Beatles - Help', 'Muse - Hysteria']);
    expect(await morceauEnregistre(page, 'Beatles - Help')).toMatchObject({ isSong: true, artist: 'Beatles', songName: 'Help', styles: ['Rock'], work: 'En cours' });
    expect(await corbeilleEnregistree(page)).toHaveLength(0);
  });

  test('« Renommer… » : la boîte propose le titre « Artiste - Titre » ; le nouveau titre est redécoupé en artiste et titre, la fiche suit', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await actionExercice(page, ligneDepart(page, 'Muse - Hysteria'), 'Renommer…');
    await expect(boite(page).getByRole('textbox')).toHaveValue('Muse - Hysteria');
    await repondre(page, 'Led Zeppelin - Kashmir');
    await attendreMorceau(page, 'Led Zeppelin - Kashmir', () => true);
    await expect(message(page, '« Muse - Hysteria » renommé en « Led Zeppelin - Kashmir »')).toBeVisible();
    await deplier(page, 'Muse - Hysteria');   // l'identifiant ne change pas au renommage
    const f = ligneDepart(page, 'Muse - Hysteria');
    await expect(champsArtiste(f)).toHaveValue('Led Zeppelin');
    await expect(champsTitre(f)).toHaveValue('Kashmir');
    await page.reload();   // un rechargement relit le titre : artiste et titre sont ceux du titre enregistré
    await ouvrirMorceaux(page);
    expect(await morceauEnregistre(page, 'Led Zeppelin - Kashmir')).toMatchObject({ artist: 'Led Zeppelin', songName: 'Kashmir' });
  });

  test('« Annuler » du message de renommage remet l\'ancien titre, avec son artiste', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await actionExercice(page, ligneDepart(page, 'Muse - Hysteria'), 'Renommer…');
    await repondre(page, 'Led Zeppelin - Kashmir');
    await message(page, '« Muse - Hysteria » renommé').getByRole('button', { name: 'Annuler' }).click();
    await expect.poll(() => titresEnregistres(page)).toContain('Muse - Hysteria');
    expect(await morceauEnregistre(page, 'Muse - Hysteria')).toMatchObject({ artist: 'Muse', songName: 'Hysteria' });
  });

  test('« Renommer… » d\'un morceau parle d\'un « morceau », pas d\'un « exercice »', async ({ ouvrirAppli }) => {
    test.fail(true, 'MZ-01 : la boîte « Renommer… » d\'un morceau s\'intitule « Renommer l\'exercice » (et le nom déjà pris « Un exercice … existe déjà ici ») ; la fiche et l\'ajout disent « morceau »');
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await actionExercice(page, ligneDepart(page, 'Muse - Hysteria'), 'Renommer…');
    await expect(boite(page)).toContainText('Renommer le morceau');
  });

  test('déplacer un morceau vers un chapitre ordinaire en fait un exercice ordinaire : plus de champs artiste / titre dans sa fiche, il n\'est plus compté parmi les morceaux', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await actionExercice(page, ligneDepart(page, 'Muse - Hysteria'), 'Déplacer vers…');
    await expect(page.locator('.folder-picker-panel')).toContainText('Déplacer « Muse - Hysteria » vers…');
    await page.locator('.folder-picker-panel').getByRole('button', { name: 'Technique', exact: true }).click();
    await expect(page.locator('.folder-picker-panel')).toBeHidden();
    await expect(message(page, '« Muse - Hysteria » déplacé vers « Technique »')).toBeVisible();
    await expect.poll(async () => (await chapitreEnregistre(page, 'Technique')).exercises.map((e: any) => e.title)).toEqual(['Gamme', 'Muse - Hysteria']);
    expect(await titresEnregistres(page)).toEqual(['Beatles - Help', 'Beatles - Michelle', 'Solo à la basse']);
    await expect(effectif(page)).toHaveText('3 morceaux');
    await ouvrirChapitre(page, 'Technique');
    await deplier(page, 'Muse - Hysteria');
    await expect(champsArtiste(ligneDepart(page, 'Muse - Hysteria'))).toHaveCount(0);   // c'est un exercice
  });

  test('« Annuler » du message de déplacement remet le morceau dans son chapitre, toujours un morceau', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await actionExercice(page, ligneDepart(page, 'Muse - Hysteria'), 'Déplacer vers…');
    await page.locator('.folder-picker-panel').getByRole('button', { name: 'Technique', exact: true }).click();
    await message(page, 'déplacé vers « Technique »').getByRole('button', { name: 'Annuler' }).click();
    await expect.poll(() => titresEnregistres(page)).toContain('Muse - Hysteria');
    expect((await morceauEnregistre(page, 'Muse - Hysteria')).isSong).toBe(true);
    await expect(effectif(page)).toHaveText('4 morceaux');
  });

  test('un exercice déplacé dans un chapitre de morceaux devient un morceau, découpé en artiste et titre d\'après son titre', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(['Beatles - Help'], { exercices: ['Toto - Africa', 'Gamme'] }) });
    await ouvrirChapitre(page, 'Technique');
    await actionExercice(page, ligneDepart(page, 'Toto - Africa'), 'Déplacer vers…');
    await page.locator('.folder-picker-panel').getByRole('button', { name: 'Morceaux', exact: true }).click();
    await expect.poll(async () => (await chapitreEnregistre(page)).exercises.map((e: any) => e.title)).toEqual(['Beatles - Help', 'Toto - Africa']);
    await ouvrirMorceaux(page);
    await expect(effectif(page)).toHaveText('2 morceaux');
    await deplier(page, 'Toto - Africa');
    await expect(champsArtiste(ligneDepart(page, 'Toto - Africa'))).toHaveValue('Toto');   // la fiche d'un morceau, découpée d'après le titre
    await expect(champsTitre(ligneDepart(page, 'Toto - Africa'))).toHaveValue('Africa');
    await page.reload();
    await ouvrirMorceaux(page);
    expect(await morceauEnregistre(page, 'Toto - Africa')).toMatchObject({ isSong: true, artist: 'Toto', songName: 'Africa', styles: [], techniques: [], work: '' });
  });
});
