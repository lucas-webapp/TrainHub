// MODULE « morceaux » — le chapitre de morceaux AU TÉLÉPHONE (≤ 700 px). Observé en boîte noire (playwright-cli et projets mobile-android / mobile-iphone, 26/11/2026) : pas de colonne latérale (la barre de pastilles des chapitres
// la remplace), les dossiers calculés sont dans la zone principale ; la barre « Rangement des morceaux » doit tenir dans l'écran ; les menus (appui long sur un dossier calculé ou un morceau, menus Style / Technique / Travail
// de la fiche) restent dans l'écran ; l'ajout d'un morceau et le classement se font au toucher. Le détail des gestes tactiles et des seuils : module `mobile`.
import { test, expect } from '../support/fixtures';
import {
  attendreMorceau, boutonAjouter, boutonPropriete, champArtiste, champTitreAjout, choisirVue, chapitreEnregistre, dossierCalcule, etatMorceaux, ligneDepart, menuDossier, morceauEnregistre,
  nomsDossiers, ouvrirMenu, ouvrirMorceaux, ouvrirPropriete, rangee, valeurMenu, menuPropriete, deplier, effectif, repondre, menuContextuel, choisirAction, auTelephone,
} from './aide-morceaux';
import { dansLEcran, sansDefilementHorizontal } from '../mobile/aide-mobile';

const etat = () => etatMorceaux([{ titre: 'Beatles - Help', styles: ['Rock'] }, { titre: 'Beatles - Michelle', styles: ['Rock'] }, 'Muse - Hysteria'],
  { exercices: ['Gamme'], vocab: { styles: ['Rock', 'Funk'], techniques: ['Slap'] } });

test.describe('Morceaux : au téléphone @morceaux @mobile', () => {
  test('le chapitre de morceaux : pastille dans la barre des chapitres, barre de rangement et liste dans l\'écran, sans défilement horizontal @critique', async ({ ouvrirAppli, page }) => {
    await ouvrirAppli({ accueil: 'jamais', etat: etat() });
    expect(auTelephone(page)).toBe(true);
    await ouvrirMorceaux(page);
    await expect(page.locator('#sidebar-tree')).toBeHidden();
    await sansDefilementHorizontal(page);
    await dansLEcran(page, page.locator('#folder-container .songs-bar'), 'barre de rangement');
    for (const v of ['Artistes', 'Styles', 'Techniques', 'Travail', 'Tous']) await dansLEcran(page, page.getByRole('group', { name: 'Rangement des morceaux' }).getByRole('button', { name: v, exact: true }), `bouton ${v}`);
    await dansLEcran(page, page.getByRole('combobox', { name: 'Tri des morceaux' }), 'liste de tri');
    await dansLEcran(page, page.getByRole('button', { name: 'Ménage…' }), 'bouton Ménage');
    await expect(effectif(page)).toBeVisible();
    expect(await nomsDossiers(page)).toEqual(['Beatles']);
  });

  test('ajouter un morceau au toucher : artiste, titre, « + » ; la fiche s\'ouvre et tient dans l\'écran', async ({ ouvrirAppli, page }) => {
    await ouvrirAppli({ accueil: 'jamais', etat: etat() });
    await ouvrirMorceaux(page);
    await champArtiste(page).tap();
    await champArtiste(page).fill('Queen');
    await champTitreAjout(page).fill('Under Pressure');
    await boutonAjouter(page).tap();
    await attendreMorceau(page, 'Queen - Under Pressure', (m) => m.collapsed === false);
    await sansDefilementHorizontal(page);
    const f = page.locator(`#folder-container [data-ex-id="${(await morceauEnregistre(page, 'Queen - Under Pressure')).id}"]`);
    await expect(f).not.toHaveClass(/collapsed/);
    await dansLEcran(page, f.getByRole('combobox', { name: 'Artiste' }), 'champ artiste', { hauteur: false });
    await dansLEcran(page, boutonPropriete(f, 'Travail'), 'bouton Travail', { hauteur: false });
  });

  test('appui long sur un dossier calculé : le menu « Renommer… / Monter / Descendre / Supprimer… » tient dans l\'écran ; Renommer marche au toucher', async ({ ouvrirAppli, page }) => {
    await ouvrirAppli({ accueil: 'jamais', etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Styles');
    await menuDossier(page, 'Funk');
    await dansLEcran(page, page.locator('.ctx-menu'), 'menu du dossier');
    await expect(page.locator('.ctx-menu .ctx-item')).toHaveText(['Renommer…', 'Monter', 'Descendre', 'Supprimer ce style…']);
    await page.locator('.ctx-menu').getByRole('button', { name: 'Renommer…' }).tap();
    await repondre(page, 'Funk 70');
    await expect(dossierCalcule(page, 'Funk 70')).toBeVisible();
    expect((await chapitreEnregistre(page)).vocab.styles).toEqual(['Rock', 'Funk 70']);
  });

  test('les menus Style / Travail de la fiche tiennent dans l\'écran et se choisissent au toucher @critique', async ({ ouvrirAppli, page }) => {
    await ouvrirAppli({ accueil: 'jamais', etat: etat() });
    await ouvrirMorceaux(page);
    await deplier(page, 'Muse - Hysteria');
    const f = ligneDepart(page, 'Muse - Hysteria');
    await boutonPropriete(f, 'Style').tap();
    await expect(menuPropriete(page)).toBeVisible();
    await dansLEcran(page, menuPropriete(page), 'menu Style');
    await valeurMenu(page, 'Funk').tap();
    await attendreMorceau(page, 'Muse - Hysteria', (m) => JSON.stringify(m.styles) === JSON.stringify(['Funk']));
    await page.keyboard.press('Escape');
    await expect(menuPropriete(page)).toBeHidden();
    await ouvrirPropriete(f, 'Travail');
    await dansLEcran(page, menuPropriete(page), 'menu Travail');
    await valeurMenu(page, 'En cours').tap();
    await attendreMorceau(page, 'Muse - Hysteria', (m) => m.work === 'En cours');
  });

  test('appui long sur un morceau : son menu (« Classer… », favori, archiver…) ; « Classer… » ouvre la fiche', async ({ ouvrirAppli, page }) => {
    await ouvrirAppli({ accueil: 'jamais', etat: etat() });
    await ouvrirMorceaux(page);
    const f = ligneDepart(page, 'Muse - Hysteria');
    await ouvrirMenu(page, rangee(f));
    await expect(menuContextuel(page).getByRole('button', { name: 'Classer : style, technique, travail…' })).toBeVisible();
    await choisirAction(page, 'Classer : style, technique, travail…');
    await expect(f).not.toHaveClass(/collapsed/);
    await expect(boutonPropriete(f, 'Style')).toBeVisible();
  });

  test('un dossier d\'artiste s\'ouvre au toucher : fil d\'Ariane, morceaux, ajout avec l\'artiste prérempli', async ({ ouvrirAppli, page }) => {
    await ouvrirAppli({ accueil: 'jamais', etat: etat() });
    await ouvrirMorceaux(page);
    await dossierCalcule(page, 'Beatles').click();
    await expect(page.locator('#breadcrumb .crumb')).toHaveText(['Morceaux', 'Beatles']);
    await expect(champArtiste(page)).toHaveValue('Beatles');
    await champTitreAjout(page).fill('Yesterday');
    await champTitreAjout(page).press('Enter');
    await attendreMorceau(page, 'Beatles - Yesterday', () => true);
  });
});
