// MODULE « morceaux » — le MÉNAGE (bouton « Ménage… » de la barre d'un chapitre de morceaux). Observé en boîte noire (playwright-cli, 26/11/2026) : la fenêtre « Ménage : artistes et titres en double » a deux parties.
// 1) « Artistes écrits de plusieurs façons » : groupes de variantes probables (ponctuation / « The » près, faute de frappe d'une ou deux lettres, sigle « RHCP » ↔ « Red Hot Chili Peppers »), un bouton radio par nom (le plus
// utilisé est coché), « Fusionner sous « X » » (jamais tout seul) et « Pas les mêmes » (mémorisé sur l'appareil). 2) « Exercices au même titre (à titre d'information) » : doublons montrés en LECTURE SEULE avec un bouton « Voir » ;
// un morceau et un exercice de même titre ne sont pas des doublons. Le Ménage ne supprime ni ne fusionne jamais un exercice. Les détails des règles de variantes sont tenus par le banc `menage` (PLAN § 7) : ici, les parcours.
import { test, expect } from '../support/fixtures';
import type { Page } from '@playwright/test';
import { boutonMenage, chapitreEnregistre, etatMorceaux, message, morceauEnregistre, ouvrirMorceaux, titresEnregistres, nomsDossiers, effectif } from './aide-morceaux';

const panneau = (page: Page) => page.locator('.songs-cleanup-panel');
const groupes = (page: Page) => panneau(page).locator('.songs-cleanup-group[data-kind="artist"]');
const doublons = (page: Page) => panneau(page).locator('.songs-cleanup-group[data-kind="dup"]');
const ouvrirMenage = async (page: Page) => { await boutonMenage(page).click(); await expect(panneau(page)).toBeVisible(); };
const ignores = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.artistIgnore.v1') || '[]') as string[]);

const etat = (extra: Parameters<typeof etatMorceaux>[1] = {}) => etatMorceaux([
  'Beatles - Help', 'Beatles - Michelle', 'The Beatles - Yesterday',
  'Red Hot Chili Peppers - Californication', 'Red Hot Chili Peppers - Snow', 'RHCP - By the Way',
  'Led Zeppelin - Kashmir', 'Led Zepellin - Black Dog',
  'Muse - Hysteria',
], extra);

test.describe('Morceaux : Ménage @morceaux', () => {
  test('sans rien à ranger : « Aucune variante repérée. » et « Aucun doublon de titre. » ; Fermer referme', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(['Beatles - Help', 'Muse - Hysteria']) });
    await ouvrirMorceaux(page);
    await ouvrirMenage(page);
    await expect(panneau(page).locator('.backups-title')).toHaveText('Ménage : artistes et titres en double');
    await expect(panneau(page).locator('.songs-cleanup-h')).toHaveText(['Artistes écrits de plusieurs façons', 'Exercices au même titre (à titre d\'information)']);
    await expect(panneau(page).locator('.gs-empty')).toHaveText(['Aucune variante repérée.', 'Aucun doublon de titre.']);
    await panneau(page).locator('.songs-cleanup-close').click();
    await expect(panneau(page)).toBeHidden();
  });

  test('les variantes probables sont proposées par groupes : « The », sigle, faute de frappe ; le nom le plus utilisé est coché @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await ouvrirMenage(page);
    await expect(groupes(page)).toHaveCount(3);
    const textes = await groupes(page).evaluateAll((gs) => gs.map((g) => Array.from(g.querySelectorAll('.songs-cleanup-opt')).map((o) => o.textContent!.trim())));
    expect(textes.map((g) => g.slice().sort())).toEqual(expect.arrayContaining([
      ['Beatles (2 morceaux)', 'The Beatles (1 morceau)'],
      ['RHCP (1 morceau)', 'Red Hot Chili Peppers (2 morceaux)'],
      ['Led Zepellin (1 morceau)', 'Led Zeppelin (1 morceau)'].sort(),
    ]));
    // Pour chaque groupe, le premier nom (le plus utilisé) est coché, et le bouton le dit.
    const beatles = groupes(page).filter({ hasText: 'The Beatles' });
    await expect(beatles.locator('input[type=radio]').first()).toBeChecked();
    await expect(beatles.locator('.songs-cleanup-go')).toHaveText('Fusionner sous « Beatles »');
    const rhcp = groupes(page).filter({ hasText: 'RHCP' });
    await expect(rhcp.locator('.songs-cleanup-go')).toHaveText('Fusionner sous « Red Hot Chili Peppers »');
    // Rien n'est fusionné tout seul.
    expect(await titresEnregistres(page)).toContain('The Beatles - Yesterday');
  });

  test('« Fusionner sous « Beatles » » renomme les morceaux de la variante ; le message propose « Annuler » ; aucun morceau n\'est supprimé @critique', async ({ ouvrirAppli, garde }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await ouvrirMenage(page);
    await groupes(page).filter({ hasText: 'The Beatles' }).locator('.songs-cleanup-go').click();
    await expect(message(page, 'Artistes fusionnés sous « Beatles »')).toBeVisible();
    await expect(groupes(page)).toHaveCount(2);   // le groupe a disparu de la fenêtre
    const m = await morceauEnregistre(page, 'Beatles - Yesterday');
    expect(m).toMatchObject({ artist: 'Beatles', songName: 'Yesterday' });
    expect(await titresEnregistres(page)).toHaveLength(9);
    // « Annuler » remet l'ancien nom d'artiste.
    await message(page, 'Artistes fusionnés').getByRole('button', { name: 'Annuler' }).click();
    await expect.poll(() => titresEnregistres(page)).toContain('The Beatles - Yesterday');
    expect(garde.bloquees).toEqual([]);
  });

  test('on peut choisir un autre nom à garder : le bouton annonce « Fusionner sous « The Beatles » » et c\'est ce nom que tous prennent', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await ouvrirMenage(page);
    const g = groupes(page).filter({ hasText: 'The Beatles' });
    await g.getByRole('radio').nth(1).check();
    await expect(g.locator('.songs-cleanup-go')).toHaveText('Fusionner sous « The Beatles »');
    await g.locator('.songs-cleanup-go').click();
    await expect.poll(() => titresEnregistres(page)).toEqual(expect.arrayContaining(['The Beatles - Help', 'The Beatles - Michelle', 'The Beatles - Yesterday']));
    expect(await titresEnregistres(page)).not.toContain('Beatles - Help');
  });

  test('fusionner un sigle : « RHCP » rejoint « Red Hot Chili Peppers », ses morceaux sont rangés dans le même dossier d\'artiste', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await expect.poll(() => nomsDossiers(page)).toEqual(['Beatles', 'Red Hot Chili Peppers']);   // « RHCP », « The Beatles » et les deux « Led Zep… » n'ont qu'un morceau : à plat
    await ouvrirMenage(page);
    await groupes(page).filter({ hasText: 'RHCP' }).locator('.songs-cleanup-go').click();
    await panneau(page).locator('.songs-cleanup-close').click();
    await expect(effectif(page)).toHaveText('9 morceaux');
    await expect.poll(async () => (await chapitreEnregistre(page)).exercises.filter((e: any) => e.artist === 'Red Hot Chili Peppers').length).toBe(3);
    expect(await titresEnregistres(page)).toContain('Red Hot Chili Peppers - By the Way');
  });

  test('« Pas les mêmes » écarte le groupe, le mémorise sur l\'appareil, même après rechargement @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await ouvrirMenage(page);
    await groupes(page).filter({ hasText: 'Led Zepellin' }).getByRole('button', { name: 'Pas les mêmes' }).click();
    await expect(groupes(page)).toHaveCount(2);
    expect(await ignores(page)).toEqual(['led zepellin|led zeppelin']);
    expect(await titresEnregistres(page)).toContain('Led Zepellin - Black Dog');   // rien n'a changé
    await page.reload();
    await ouvrirMorceaux(page);
    await ouvrirMenage(page);
    await expect(groupes(page)).toHaveCount(2);
    await expect(panneau(page)).not.toContainText('Led Zepellin');
  });

  test('doublons de titre : un exercice au même titre dans un autre chapitre est montré en lecture seule, avec « Voir » qui l\'ouvre ; rien n\'est fusionné ni supprimé', async ({ ouvrirAppli }) => {
    const e: any = etatMorceaux(['Beatles - Help'], { exercices: ['Gamme', 'Gamme'] });
    e.instruments[0].categories[0].exercises[1].id = 'ex-gamme-2';
    e.instruments[0].categories[0].exercises[1].notes = 'ma note';
    const page = await ouvrirAppli({ etat: e });
    await ouvrirMorceaux(page);
    await ouvrirMenage(page);
    await expect(doublons(page)).toHaveCount(1);
    await expect(doublons(page).locator('.songs-cleanup-dup-title')).toHaveText('« Gamme » × 2');
    await expect(doublons(page).locator('.songs-cleanup-dup-where')).toHaveText(['Technique — jamais jouée', 'Technique — une note, jamais jouée']);
    await expect(doublons(page).getByRole('button')).toHaveText(['Voir', 'Voir']);   // pas de bouton « Supprimer » ni « Fusionner »
    await doublons(page).getByRole('button', { name: 'Voir' }).nth(1).click();
    await expect(panneau(page)).toBeHidden();
    await expect(page.locator('#breadcrumb .crumb-current')).toHaveText('Technique');
    await expect(page.locator('#folder-container [data-ex-id="ex-gamme-2"]')).not.toHaveClass(/collapsed/);
    expect((await chapitreEnregistre(page, 'Technique')).exercises).toHaveLength(2);
  });

  test('un morceau et un exercice de même titre ne sont pas des doublons (le passage travaillé en exercice) ; deux morceaux de même titre, si', async ({ ouvrirAppli }) => {
    const e: any = etatMorceaux(['Beatles - Help', 'Muse - Hysteria', 'Muse - Hysteria'], { exercices: ['Beatles - Help'] });
    e.instruments[0].categories[1].exercises[2].id = 'ex-muse-2';
    const page = await ouvrirAppli({ etat: e });
    await ouvrirMorceaux(page);
    await ouvrirMenage(page);
    await expect(doublons(page)).toHaveCount(1);
    await expect(doublons(page).locator('.songs-cleanup-dup-title')).toHaveText('« Muse - Hysteria » × 2');
    await expect(doublons(page).locator('.songs-cleanup-dup-where')).toHaveText(['Morceaux — jamais jouée', 'Morceaux — jamais jouée']);
  });
});
