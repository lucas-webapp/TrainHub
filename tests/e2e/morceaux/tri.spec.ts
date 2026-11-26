// MODULE « morceaux » — le TRI des morceaux (liste « Tri des morceaux » de la barre). Observé en boîte noire (playwright-cli, 26/11/2026) : « A → Z » (défaut, « The / Le / La / Les / Un / Une / L' » du début
// ne comptent pas), « Modifiés récemment », « Ajoutés récemment », « Ajoutés en premier » ; il range les morceaux ET les dossiers d'artistes (un dossier suit son morceau le plus récent, ou le plus
// ancien) ; le choix est gardé par chapitre sur l'appareil ; toucher à un morceau le fait remonter dans « Modifiés récemment ».
import { test, expect } from '../support/fixtures';
import {
  attendreMorceau, attendreMorceaux, choisirVue, deplier, dossiersColonne, etatMorceaux, ligneDepart, listeTri, nomsDossiers, ouvrirMorceaux, ouvrirPropriete, prefsAffichage, valeurMenu, boutonPropriete,
} from './aide-morceaux';

const T0 = 1_760_000_000_000;   // un instant de départ fixe : les dates de création et de modification sont posées à la main
const etat = () => etatMorceaux([
  { titre: 'Alpha - Zulu', cree: T0 + 1000, maj: T0 + 5000 },
  { titre: 'Beta - Yankee', cree: T0 + 3000, maj: T0 + 2000 },
  { titre: 'Gamma - X ray', cree: T0 + 2000, maj: T0 + 9000 },
  { titre: 'The Delta - Whisky', cree: T0 + 4000, maj: T0 + 1000 },
  { titre: 'Le Chat - Miaou', cree: T0 + 500, maj: T0 + 500 },
]);
const choisirTri = async (page: import('@playwright/test').Page, libelle: string) => { await listeTri(page).selectOption({ label: libelle }); await expect(listeTri(page)).toHaveValue(/.+/); };

test.describe('Morceaux : tri @morceaux', () => {
  test('les quatre tris de la liste : A → Z (sans « The », « Le »…), modifiés récemment, ajoutés récemment, ajoutés en premier @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Tous');
    await expect(listeTri(page).locator('option')).toHaveText(['A → Z', 'Modifiés récemment', 'Ajoutés récemment', 'Ajoutés en premier']);
    await expect(listeTri(page)).toHaveValue('az');
    // A → Z : Alpha, Beta, Le Chat (C), The Delta (D), Gamma.
    await attendreMorceaux(page, ['Alpha - Zulu', 'Beta - Yankee', 'Le Chat - Miaou', 'The Delta - Whisky', 'Gamma - X ray']);
    await choisirTri(page, 'Modifiés récemment');
    await attendreMorceaux(page, ['Gamma - X ray', 'Alpha - Zulu', 'Beta - Yankee', 'The Delta - Whisky', 'Le Chat - Miaou']);
    await choisirTri(page, 'Ajoutés récemment');
    await attendreMorceaux(page, ['The Delta - Whisky', 'Beta - Yankee', 'Gamma - X ray', 'Alpha - Zulu', 'Le Chat - Miaou']);
    await choisirTri(page, 'Ajoutés en premier');
    await attendreMorceaux(page, ['Le Chat - Miaou', 'Alpha - Zulu', 'Gamma - X ray', 'Beta - Yankee', 'The Delta - Whisky']);
    await choisirTri(page, 'A → Z');
    await attendreMorceaux(page, ['Alpha - Zulu', 'Beta - Yankee', 'Le Chat - Miaou', 'The Delta - Whisky', 'Gamma - X ray']);
  });

  test('le tri est gardé après rechargement (par chapitre, sur l\'appareil) et se lit dans les préférences', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Tous');
    await choisirTri(page, 'Ajoutés récemment');
    await expect.poll(async () => Object.values(await prefsAffichage(page)).map((p: any) => p.sort)).toEqual(['created-desc']);
    await page.reload();
    await ouvrirMorceaux(page);
    await expect(listeTri(page)).toHaveValue('created-desc');
    await attendreMorceaux(page, ['The Delta - Whisky', 'Beta - Yankee', 'Gamma - X ray', 'Alpha - Zulu', 'Le Chat - Miaou']);
  });

  test('toucher à un morceau (lui donner un état de travail) le fait remonter en tête de « Modifiés récemment »', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Tous');
    await choisirTri(page, 'Modifiés récemment');
    await attendreMorceaux(page, ['Gamma - X ray', 'Alpha - Zulu', 'Beta - Yankee', 'The Delta - Whisky', 'Le Chat - Miaou']);
    await deplier(page, 'Le Chat - Miaou');
    const f = ligneDepart(page, 'Le Chat - Miaou');
    await ouvrirPropriete(f, 'Travail');
    await valeurMenu(page, 'En cours').click();
    await attendreMorceau(page, 'Le Chat - Miaou', (m) => m.work === 'En cours' && m.updatedAt > T0 + 9000);
    await attendreMorceaux(page, ['Le Chat - Miaou', 'Gamma - X ray', 'Alpha - Zulu', 'Beta - Yankee', 'The Delta - Whisky']);
    await expect(boutonPropriete(f, 'Travail')).toHaveText('En cours');
  });

  test('en vue Artistes, le tri range aussi les dossiers d\'artistes : le plus récent / le plus ancien de leurs morceaux décide', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux([
      { titre: 'Beatles - Help', cree: T0 + 1000, maj: T0 + 1000 }, { titre: 'Beatles - Michelle', cree: T0 + 2000, maj: T0 + 8000 },
      { titre: 'Muse - Hysteria', cree: T0 + 3000, maj: T0 + 3000 }, { titre: 'Muse - Uprising', cree: T0 + 4000, maj: T0 + 4000 },
      { titre: 'The Cure - Lullaby', cree: T0 + 500, maj: T0 + 500 }, { titre: 'The Cure - Friday I\'m in Love', cree: T0 + 600, maj: T0 + 600 },
    ]) });
    await ouvrirMorceaux(page);
    expect(await nomsDossiers(page)).toEqual(['Beatles', 'The Cure', 'Muse']);   // A → Z : B, C (« The » ne compte pas), M
    await choisirTri(page, 'Modifiés récemment');
    await expect.poll(() => nomsDossiers(page)).toEqual(['Beatles', 'Muse', 'The Cure']);   // 8000, 4000, 600
    await choisirTri(page, 'Ajoutés récemment');
    await expect.poll(() => nomsDossiers(page)).toEqual(['Muse', 'Beatles', 'The Cure']);   // 4000, 2000, 600
    await choisirTri(page, 'Ajoutés en premier');
    await expect.poll(() => nomsDossiers(page)).toEqual(['The Cure', 'Beatles', 'Muse']);   // 500, 1000, 3000
    await expect(dossiersColonne(page)).toHaveText(['The Cure', 'Beatles', 'Muse']);   // la colonne latérale suit le même ordre
  });

  test('le tri s\'applique aussi aux morceaux d\'un dossier de style', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux([
      { titre: 'Alpha - Zulu', styles: ['Rock'], cree: T0 + 1000, maj: T0 + 1000 }, { titre: 'Beta - Yankee', styles: ['Rock'], cree: T0 + 2000, maj: T0 + 2000 },
    ], { vocab: { styles: ['Rock'] } }) });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Styles');
    await choisirTri(page, 'Ajoutés récemment');
    await page.locator('#folder-container .song-folder-row').filter({ hasText: 'Rock' }).click();
    await attendreMorceaux(page, ['Beta - Yankee', 'Alpha - Zulu']);
  });
});
