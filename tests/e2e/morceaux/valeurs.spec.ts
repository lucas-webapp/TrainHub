// MODULE « morceaux » — GÉRER les valeurs d'un chapitre : styles, techniques, états de travail et artistes. Observé en boîte noire (playwright-cli, 26/11/2026) : un clic droit (appui long au téléphone) sur un dossier
// calculé, ou son crayon « Renommer », ouvre un petit menu — Renommer… (pour tous les morceaux concernés), Monter, Descendre, Supprimer ce style… (artistes : seulement Renommer…) ; « Sans style », « Sans technique »
// et « À classer » n'ont pas de menu. Renommer vers un nom déjà pris fusionne les deux dossiers. Supprimer demande confirmation, retire la valeur des morceaux (ils restent dans la bibliothèque) et propose « Annuler ».
// Le bouton « ＋ Nouveau style » (idem technique, état) ajoute une valeur au vocabulaire du chapitre, sans doublon à la casse près.
import { test, expect } from '../support/fixtures';
import {
  boite, choisirVue, chapitreEnregistre, confirmer, dossierCalcule, effectifsDossiers, entreesMenu, ligneDepart, menuDossier, message, morceauEnregistre, nomsDossiers, ouvrirDossierCalcule,
  ouvrirMorceaux, repondre, etatMorceaux, titresEnregistres, dossiersColonne, auTelephone,
} from './aide-morceaux';
import type { Page } from '@playwright/test';

const etat = () => etatMorceaux([
  { titre: 'Beatles - Help', styles: ['Rock'], travail: 'En cours' }, { titre: 'Beatles - Michelle', styles: ['Rock', 'Folk'] },
  { titre: 'Muse - Hysteria', styles: ['Rock', 'Funk'], techniques: ['Slap'] }, { titre: 'Stevie Wonder - Superstition', styles: ['Funk'], techniques: ['Slap', 'Médiator'], travail: 'À maîtriser' },
], { vocab: { styles: ['Rock', 'Funk', 'Folk', 'Jazz'], techniques: ['Slap', 'Médiator'] } });
const action = (page: Page, nom: string) => page.locator('.ctx-menu').getByRole('button', { name: nom, exact: true });

test.describe('Morceaux : gérer les valeurs @morceaux', () => {
  test('le menu d\'un dossier de style : Renommer…, Monter, Descendre, Supprimer ce style… ; Monter est grisé pour le premier, Descendre pour le dernier', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Styles');
    await menuDossier(page, 'Funk');
    expect(await entreesMenu(page)).toEqual(['Renommer…', 'Monter', 'Descendre', 'Supprimer ce style…']);
    await expect(page.locator('.ctx-menu .ctx-title')).toHaveText('Funk');
    await expect(action(page, 'Monter')).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('.ctx-menu')).toHaveCount(0);
    await menuDossier(page, 'Rock');
    await expect(action(page, 'Monter')).toBeDisabled();
    await page.keyboard.press('Escape');
    await menuDossier(page, 'Jazz');
    await expect(action(page, 'Descendre')).toBeDisabled();
  });

  test('le menu d\'un dossier d\'artiste ne propose que « Renommer… » ; le dossier « Sans style » n\'a pas de menu ni de crayon', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(['Beatles - Help', 'Beatles - Michelle', 'Muse - Hysteria']) });
    await ouvrirMorceaux(page);
    await menuDossier(page, 'Beatles');
    expect(await entreesMenu(page)).toEqual(['Renommer…']);
    await page.keyboard.press('Escape');
    await choisirVue(page, 'Styles');
    await expect(dossierCalcule(page, 'Sans style')).toBeVisible();
    await expect(dossierCalcule(page, 'Sans style').getByRole('button', { name: 'Renommer' })).toHaveCount(0);
    if (!auTelephone(page)) await dossierCalcule(page, 'Sans style').click({ button: 'right' });
    await expect(page.locator('.ctx-menu')).toHaveCount(0);
  });

  test('renommer un style : la valeur change pour tous les morceaux concernés et dans le vocabulaire du chapitre, à sa place @critique', async ({ ouvrirAppli, garde }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Styles');
    await menuDossier(page, 'Rock');
    await action(page, 'Renommer…').click();
    const d = boite(page);
    await expect(d).toContainText('Renommer le style');
    await expect(d).toContainText('Le nouveau nom s\'applique à tous les morceaux concernés.');
    await expect(d.getByRole('textbox')).toHaveValue('Rock');
    await expect(d.getByRole('button', { name: 'Renommer', exact: true })).toBeDisabled();   // « mustChange » : même nom, rien à faire
    await repondre(page, 'Rock\'n\'roll');
    await expect.poll(async () => (await chapitreEnregistre(page)).vocab.styles).toEqual(['Rock\'n\'roll', 'Funk', 'Folk', 'Jazz']);
    expect((await morceauEnregistre(page, 'Beatles - Help')).styles).toEqual(['Rock\'n\'roll']);
    expect((await morceauEnregistre(page, 'Beatles - Michelle')).styles).toEqual(['Rock\'n\'roll', 'Folk']);
    expect((await morceauEnregistre(page, 'Muse - Hysteria')).styles).toEqual(['Rock\'n\'roll', 'Funk']);
    expect(await effectifsDossiers(page)).toEqual([['Rock\'n\'roll', 3], ['Funk', 2], ['Folk', 1], ['Jazz', 0]]);
    expect(garde.bloquees).toEqual([]);
  });

  test('renommer par le crayon « Renommer » de la rangée du dossier : même boîte, et le dossier garde sa place', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Techniques');
    await dossierCalcule(page, 'Slap').getByRole('button', { name: 'Renommer' }).click();
    await expect(action(page, 'Renommer…')).toBeVisible();
    await action(page, 'Renommer…').click();
    await repondre(page, 'Slap basse');
    await expect(dossierCalcule(page, 'Slap basse')).toBeVisible();
    await ouvrirDossierCalcule(page, 'Slap basse');
    await expect(page.locator('#folder-container .exercise-title')).toHaveCount(2);
    expect((await chapitreEnregistre(page)).vocab.techniques).toEqual(['Slap basse', 'Médiator']);
  });

  test('renommer par le crayon du grand titre quand le dossier est ouvert : on reste dans le dossier renommé @ordinateur', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Techniques');
    await ouvrirDossierCalcule(page, 'Slap');
    await page.locator('#content-heading').getByRole('button', { name: 'Renommer' }).click();
    await action(page, 'Renommer…').click();
    await repondre(page, 'Slap et pop');
    await expect(page.locator('#breadcrumb .crumb-current')).toHaveText('Slap et pop');   // la page reste sur le dossier renommé
    await expect(page.locator('#folder-container .exercise-title')).toHaveCount(2);
    expect((await chapitreEnregistre(page)).vocab.techniques).toEqual(['Slap et pop', 'Médiator']);
  });

  test('renommer vers un nom déjà pris fusionne les deux dossiers : plus de doublon dans les morceaux, le nom existant l\'emporte', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Styles');
    await menuDossier(page, 'Folk');
    await action(page, 'Renommer…').click();
    await repondre(page, 'rock');   // « Rock » existe (casse différente) : Michelle est déjà Rock, elle n'a pas Rock deux fois
    await expect.poll(async () => (await chapitreEnregistre(page)).vocab.styles).toEqual(['Rock', 'Funk', 'Jazz']);
    expect((await morceauEnregistre(page, 'Beatles - Michelle')).styles).toEqual(['Rock']);
    await expect.poll(() => nomsDossiers(page)).toEqual(['Rock', 'Funk', 'Jazz']);
  });

  test('Monter / Descendre changent l\'ordre des dossiers (et du vocabulaire) ; l\'ordre se retrouve après rechargement', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Styles');
    await menuDossier(page, 'Folk');
    await action(page, 'Monter').click();
    await expect.poll(() => nomsDossiers(page)).toEqual(['Rock', 'Folk', 'Funk', 'Jazz']);
    await menuDossier(page, 'Rock');
    await action(page, 'Descendre').click();
    await expect.poll(() => nomsDossiers(page)).toEqual(['Folk', 'Rock', 'Funk', 'Jazz']);
    expect((await chapitreEnregistre(page)).vocab.styles).toEqual(['Folk', 'Rock', 'Funk', 'Jazz']);
    await page.reload();
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Styles');
    expect(await nomsDossiers(page)).toEqual(['Folk', 'Rock', 'Funk', 'Jazz']);
  });

  test('supprimer un style : confirmation qui dit combien de morceaux le perdent, ils restent dans la bibliothèque ; « Annuler » du message le remet @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Styles');
    await menuDossier(page, 'Funk');
    await action(page, 'Supprimer ce style…').click();
    const d = boite(page);
    await expect(d).toContainText('Supprimer « Funk » ?');
    await expect(d).toContainText('2 morceaux perdent cette valeur (ils restent dans la bibliothèque, « Sans style » si c\'était la seule).');
    await d.getByRole('button', { name: 'Annuler' }).click();   // un refus ne change rien
    expect((await chapitreEnregistre(page)).vocab.styles).toContain('Funk');
    await menuDossier(page, 'Funk');
    await action(page, 'Supprimer ce style…').click();
    await confirmer(page, 'Supprimer');
    await expect.poll(() => nomsDossiers(page)).toEqual(['Rock', 'Folk', 'Jazz', 'Sans style']);
    expect((await chapitreEnregistre(page)).vocab.styles).toEqual(['Rock', 'Folk', 'Jazz']);
    expect((await morceauEnregistre(page, 'Stevie Wonder - Superstition')).styles).toEqual([]);
    expect((await morceauEnregistre(page, 'Muse - Hysteria')).styles).toEqual(['Rock']);
    expect(await titresEnregistres(page)).toHaveLength(4);   // aucun morceau supprimé
    // « Annuler » dans le message rétablit la valeur sur ses morceaux.
    await message(page, '« Funk » supprimé').getByRole('button', { name: 'Annuler' }).click();
    await expect.poll(async () => (await chapitreEnregistre(page)).vocab.styles).toEqual(['Rock', 'Funk', 'Folk', 'Jazz']);
    expect((await morceauEnregistre(page, 'Stevie Wonder - Superstition')).styles).toEqual(['Funk']);
  });

  test('supprimer un style vide : « Aucun morceau n\'est concerné. »', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Styles');
    await menuDossier(page, 'Jazz');
    await action(page, 'Supprimer ce style…').click();
    await expect(boite(page)).toContainText('Aucun morceau n\'est concerné.');
    await confirmer(page, 'Supprimer');
    expect((await chapitreEnregistre(page)).vocab.styles).toEqual(['Rock', 'Funk', 'Folk']);
    await expect.poll(() => nomsDossiers(page)).toEqual(['Rock', 'Funk', 'Folk']);
  });

  test('supprimer le style du dossier ouvert (crayon du grand titre) ramène à la page du chapitre @ordinateur', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Styles');
    await ouvrirDossierCalcule(page, 'Jazz');
    await page.locator('#content-heading').getByRole('button', { name: 'Renommer' }).click();
    await action(page, 'Supprimer ce style…').click();
    await confirmer(page, 'Supprimer');
    await expect(page.locator('#breadcrumb .crumb')).toHaveText(['Morceaux']);
    expect((await chapitreEnregistre(page)).vocab.styles).toEqual(['Rock', 'Funk', 'Folk']);
  });

  test('supprimer une technique, puis un état de travail. Les morceaux retombent dans « À classer »', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Techniques');
    await menuDossier(page, 'Médiator');
    await page.locator('.ctx-menu').getByRole('button', { name: /^Supprimer c\w+ technique…$/ }).click();
    await confirmer(page, 'Supprimer');
    expect((await chapitreEnregistre(page)).vocab.techniques).toEqual(['Slap']);
    expect((await morceauEnregistre(page, 'Stevie Wonder - Superstition')).techniques).toEqual(['Slap']);
    await choisirVue(page, 'Travail');
    await menuDossier(page, 'À maîtriser');
    await page.locator('.ctx-menu').getByRole('button', { name: /^Supprimer c\w+ état…$/ }).click();
    await confirmer(page, 'Supprimer');
    expect((await morceauEnregistre(page, 'Stevie Wonder - Superstition')).work).toBe('');
    await expect.poll(async () => (await effectifsDossiers(page)).find((x) => x[0] === 'À classer')?.[1]).toBe(3);
  });

  test('renommer l\'état « En cours » : les morceaux restent « en cours » (la pastille suit le nom) ; le supprimer retire la pastille', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await ouvrirDossierCalcule(page, 'Beatles');
    await expect(ligneDepart(page, 'Beatles - Help').getByRole('img', { name: 'En cours' })).toBeAttached();   // un point posé sur le titre : pas de place prise
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Travail');
    await menuDossier(page, 'En cours');
    await action(page, 'Renommer…').click();
    await expect(boite(page)).toContainText('Renommer l\'état');
    await repondre(page, 'Au boulot');
    await expect.poll(async () => (await chapitreEnregistre(page)).vocab.inProgress).toBe('Au boulot');
    expect((await morceauEnregistre(page, 'Beatles - Help')).work).toBe('Au boulot');
    await ouvrirDossierCalcule(page, 'Au boulot');
    await expect(ligneDepart(page, 'Beatles - Help').getByRole('img', { name: 'En cours' })).toBeAttached();
    await ouvrirMorceaux(page);
    await menuDossier(page, 'Au boulot');
    await page.locator('.ctx-menu').getByRole('button', { name: /^Supprimer c\w+ état…$/ }).click();
    await confirmer(page, 'Supprimer');
    expect((await chapitreEnregistre(page)).vocab.inProgress).toBe('');
    expect((await morceauEnregistre(page, 'Beatles - Help')).work).toBe('');
  });

  test('renommer un artiste : tous ses morceaux changent de titre « Artiste - Titre » ; un artiste déjà connu (autre casse) absorbe les morceaux @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(['Beatles - Help', 'Beatles - Michelle', 'Muse - Hysteria', 'Muse - Uprising', 'Toto - Africa']) });
    await ouvrirMorceaux(page);
    await menuDossier(page, 'Beatles');
    await action(page, 'Renommer…').click();
    await expect(boite(page)).toContainText('Renommer l\'artiste');
    await repondre(page, 'The Beatles');
    await expect.poll(() => titresEnregistres(page)).toEqual(['The Beatles - Help', 'The Beatles - Michelle', 'Muse - Hysteria', 'Muse - Uprising', 'Toto - Africa']);
    expect((await morceauEnregistre(page, 'The Beatles - Help'))).toMatchObject({ artist: 'The Beatles', songName: 'Help' });
    await expect.poll(() => nomsDossiers(page)).toEqual(['The Beatles', 'Muse']);   // « The » ne compte pas dans le tri
    // Vers un artiste existant, avec une autre casse : « the beatles » prend la graphie de « The Beatles ».
    await menuDossier(page, 'Muse');
    await action(page, 'Renommer…').click();
    await repondre(page, 'the beatles');
    await expect.poll(() => titresEnregistres(page)).toEqual(['The Beatles - Help', 'The Beatles - Michelle', 'The Beatles - Hysteria', 'The Beatles - Uprising', 'Toto - Africa']);
    await expect.poll(() => nomsDossiers(page)).toEqual(['The Beatles']);
  });

  test('« ＋ Nouveau style » ajoute un dossier vide à la fin du vocabulaire ; un nom déjà connu (casse, accents) ne crée pas de doublon', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Styles');
    await page.getByRole('button', { name: '＋ Nouveau style' }).click();
    await repondre(page, 'Reggae');
    await expect.poll(() => nomsDossiers(page)).toEqual(['Rock', 'Funk', 'Folk', 'Jazz', 'Reggae']);
    expect((await effectifsDossiers(page)).at(-1)).toEqual(['Reggae', 0]);
    await page.getByRole('button', { name: '＋ Nouveau style' }).click();
    await repondre(page, 'JAZZ');
    expect((await chapitreEnregistre(page)).vocab.styles).toEqual(['Rock', 'Funk', 'Folk', 'Jazz', 'Reggae']);
    await choisirVue(page, 'Travail');
    await page.getByRole('button', { name: '＋ Nouvel état' }).click();
    await expect(boite(page)).toContainText('Nouvel état');
    await repondre(page, 'À revoir');
    expect((await chapitreEnregistre(page)).vocab.work).toEqual(['En cours', 'À maîtriser', 'Maîtrisé', 'Plus tard', 'À revoir']);
  });

  test('un clic droit dans la colonne latérale sur un dossier calculé ouvre le même menu @ordinateur', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Styles');
    await expect(dossiersColonne(page)).toHaveText(['Rock', 'Funk', 'Folk', 'Jazz']);
    await page.locator('#sidebar-tree .song-tree-node .tree-row').filter({ hasText: 'Folk' }).click({ button: 'right' });
    expect(await entreesMenu(page)).toEqual(['Renommer…', 'Monter', 'Descendre', 'Supprimer ce style…']);
    await action(page, 'Monter').click();
    await expect(dossiersColonne(page)).toHaveText(['Rock', 'Folk', 'Funk', 'Jazz']);
  });

  test('les libellés s\'accordent : « Renommer la technique », « Supprimer cette technique… », « Supprimer cet état… »', async ({ ouvrirAppli }) => {
    test.fail(true, 'MZ-02 : l\'appli écrit « Renommer le technique », « Supprimer ce technique… », « Supprimer ce état… » et « Aucun technique pour l\'instant » (technique est féminin, « cet » devant état ; « style » est correct)');
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Techniques');
    await menuDossier(page, 'Slap');
    await expect(action(page, 'Supprimer cette technique…')).toBeVisible();
    await action(page, 'Renommer…').click();
    await expect(boite(page)).toContainText('Renommer la technique');
    await boite(page).getByRole('button', { name: 'Annuler' }).click();
    await choisirVue(page, 'Travail');
    await menuDossier(page, 'Maîtrisé');
    await expect(action(page, 'Supprimer cet état…')).toBeVisible();
  });
});
