// MODULE « morceaux » — les cinq RANGEMENTS d'un chapitre de morceaux (Artistes, Styles, Techniques, Travail, Tous) et leurs « dossiers » CALCULÉS. Observé en boîte noire (playwright-cli, 26/11/2026) :
// Artistes = un dossier par artiste dès 2 morceaux, les autres à plat sous « Autres morceaux » (ou « Morceaux » s'il n'y a aucun dossier) ; Styles / Techniques / Travail = un dossier par valeur du
// vocabulaire du chapitre (dans l'ordre du chapitre, même vide) puis « Sans style » / « Sans technique » / « À classer » s'il y a des morceaux concernés ; un morceau à plusieurs styles est dans chacun ;
// dans un dossier de style / technique / travail, les artistes à 2 morceaux ou plus se regroupent sous un bandeau repliable ; les morceaux archivés n'apparaissent dans aucun rangement.
// Le choix du rangement, du tri et des artistes repliés est gardé par chapitre sur l'appareil (`trainhub.songsUi.v1`).
import { test, expect } from '../support/fixtures';
import {
  attendreMorceaux, blocsArtiste, boutonVue, choisirVue, dossierCalcule, dossiersColonne, effectif, effectifsDossiers, enteteArtiste, entreeArchives, etatMorceaux, etiquetteSection, messageVide, nomsDossiers,
  ouvrirDossierCalcule, ouvrirMorceaux, prefsAffichage, titresMorceaux, auTelephone, ligneDepart,
} from './aide-morceaux';

const morceaux = () => [
  { titre: 'Beatles - Help', styles: ['Rock'], travail: 'En cours' },
  { titre: 'Beatles - Michelle', styles: ['Rock'] },
  { titre: 'Beatles - Yesterday', styles: ['Rock'] },
  { titre: 'Muse - Hysteria', styles: ['Rock', 'Funk'], techniques: ['Slap'] },
  { titre: 'Stevie Wonder - Superstition', styles: ['Funk'], techniques: ['Slap'], travail: 'À maîtriser' },
  { titre: 'The Doors - Roadhouse Blues', styles: ['Rock'] },
  'Impro en mi',
  { titre: 'Toto - Africa', styles: ['Rock'], archive: true },
];
const etat = () => etatMorceaux(morceaux(), { vocab: { styles: ['Rock', 'Funk', 'Jazz'], techniques: ['Slap', 'Médiator'] } });

test.describe('Morceaux : rangements et dossiers calculés @morceaux', () => {
  test('vue Artistes (celle du départ) : un dossier « Beatles » (3), les autres morceaux à plat sous « Autres morceaux », triés A → Z sans « The » ; l\'archivé n\'y est pas @critique', async ({ ouvrirAppli, garde }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await expect(boutonVue(page, 'Artistes')).toHaveAttribute('aria-pressed', 'true');
    for (const v of ['Styles', 'Techniques', 'Travail', 'Tous'] as const) await expect(boutonVue(page, v)).toHaveAttribute('aria-pressed', 'false');
    expect(await effectifsDossiers(page)).toEqual([['Beatles', 3]]);
    await expect(etiquetteSection(page)).toHaveText('Autres morceaux');
    await attendreMorceaux(page, ['The Doors - Roadhouse Blues', 'Impro en mi', 'Muse - Hysteria', 'Stevie Wonder - Superstition']);   // « The Doors » se range à D
    await expect(effectif(page)).toHaveText('7 morceaux');   // Toto - Africa est archivé
    await expect(page.locator('#folder-container .exercise-title')).toHaveCount(4);
    expect(garde.bloquees).toEqual([]);
  });

  test('sans aucun dossier d\'artiste, la section des morceaux libres s\'appelle « Morceaux »', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(['Beatles - Help', 'Muse - Hysteria']) });
    await ouvrirMorceaux(page);
    expect(await nomsDossiers(page)).toEqual([]);
    await expect(etiquetteSection(page)).toHaveText('Morceaux');
    await attendreMorceaux(page, ['Beatles - Help', 'Muse - Hysteria']);
  });

  test('un dossier d\'artiste : le fil d\'Ariane « Morceaux › Beatles », son titre, ses morceaux ; cliquer « Morceaux » revient à la page du chapitre @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await ouvrirDossierCalcule(page, 'Beatles');
    await expect(page.locator('#breadcrumb .crumb')).toHaveText(['Morceaux', 'Beatles']);
    if (!auTelephone(page)) await expect(page.locator('#content-heading h2')).toHaveText('Beatles');
    await attendreMorceaux(page, ['Beatles - Help', 'Beatles - Michelle', 'Beatles - Yesterday']);
    await page.locator('#breadcrumb .crumb', { hasText: 'Morceaux' }).click();
    await expect(page.locator('#breadcrumb .crumb-current')).toHaveText('Morceaux');
    expect(await nomsDossiers(page)).toEqual(['Beatles']);
  });

  test('vue Styles : un dossier par style dans l\'ordre du chapitre (même vide), puis « Sans style » ; un morceau à deux styles est dans les deux @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Styles');
    // Rock : 3 Beatles + Muse + The Doors ; Funk : Muse + Stevie ; Jazz : vide ; Sans style : « Impro en mi » (Toto, archivé, n'y est pas).
    expect(await effectifsDossiers(page)).toEqual([['Rock', 5], ['Funk', 2], ['Jazz', 0], ['Sans style', 1]]);
    await expect(dossierCalcule(page, 'Jazz')).toHaveClass(/song-folder-empty/);
    await expect(dossierCalcule(page, 'Sans style')).toHaveClass(/song-folder-none/);
    await expect(page.getByRole('button', { name: '＋ Nouveau style' })).toBeVisible();
    await ouvrirDossierCalcule(page, 'Funk');
    await attendreMorceaux(page, ['Muse - Hysteria', 'Stevie Wonder - Superstition']);
    await ouvrirMorceaux(page);
    await ouvrirDossierCalcule(page, 'Sans style');
    await attendreMorceaux(page, ['Impro en mi']);
  });

  test('vue Techniques : « Slap », « Médiator » (vide), « Sans technique » ; vue Travail : les quatre états du chapitre dans leur ordre, puis « À classer »', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Techniques');
    expect(await effectifsDossiers(page)).toEqual([['Slap', 2], ['Médiator', 0], ['Sans technique', 5]]);
    await expect(page.getByRole('button', { name: '＋ Nouvelle technique' })).toBeVisible();
    await choisirVue(page, 'Travail');
    expect(await effectifsDossiers(page)).toEqual([['En cours', 1], ['À maîtriser', 1], ['Maîtrisé', 0], ['Plus tard', 0], ['À classer', 5]]);
    await expect(page.getByRole('button', { name: '＋ Nouvel état' })).toBeVisible();
    await ouvrirDossierCalcule(page, 'À classer');
    await expect(page.locator('#folder-container .exercise-title')).toHaveCount(5);
  });

  test('vue Tous : pas de dossier, tous les morceaux à plat, triés A → Z ; la barre dit « 7 morceaux »', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Tous');
    expect(await nomsDossiers(page)).toEqual([]);
    await attendreMorceaux(page, ['Beatles - Help', 'Beatles - Michelle', 'Beatles - Yesterday', 'The Doors - Roadhouse Blues', 'Impro en mi', 'Muse - Hysteria', 'Stevie Wonder - Superstition']);
    await expect(effectif(page)).toHaveText('7 morceaux');
  });

  test('dans un dossier de style, les artistes à 2 morceaux ou plus se regroupent sous un bandeau « Artiste — N morceaux » ; les autres restent à plat, dans l\'ordre du tri', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Styles');
    await ouvrirDossierCalcule(page, 'Rock');
    await expect(blocsArtiste(page)).toHaveCount(1);
    await expect(enteteArtiste(page, 'Beatles')).toBeVisible();
    await expect(enteteArtiste(page, 'Beatles').locator('.song-artist-count')).toHaveText('3 morceaux');
    await expect(blocsArtiste(page).locator('.exercise-title')).toHaveCount(3);
    // Le bloc prend la place de son premier morceau : Beatles (B), puis The Doors (D, « The » ne compte pas), puis Muse (M).
    await attendreMorceaux(page, ['Beatles - Help', 'Beatles - Michelle', 'Beatles - Yesterday', 'The Doors - Roadhouse Blues', 'Muse - Hysteria']);
    // Dans un dossier d'artiste, pas de bandeau : les morceaux sont directement là.
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Artistes');
    await ouvrirDossierCalcule(page, 'Beatles');
    await expect(blocsArtiste(page)).toHaveCount(0);
  });

  test('replier le bandeau d\'un artiste cache ses morceaux, le garde après rechargement (par chapitre, sur l\'appareil), et le rouvrir les remontre', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Styles');
    await ouvrirDossierCalcule(page, 'Rock');
    const tete = enteteArtiste(page, 'Beatles');
    await expect(tete).toHaveAttribute('aria-expanded', 'true');
    await tete.click();
    await expect(tete).toHaveAttribute('aria-expanded', 'false');
    await expect(tete).toHaveAttribute('title', 'Déplier les morceaux de Beatles');
    await expect(blocsArtiste(page).locator('.song-artist-list')).toBeHidden();
    const prefs = await prefsAffichage(page);
    expect(Object.values(prefs)[0].artistClosed).toBeTruthy();
    await page.reload();
    await ouvrirMorceaux(page);
    await ouvrirDossierCalcule(page, 'Rock');
    await expect(enteteArtiste(page, 'Beatles')).toHaveAttribute('aria-expanded', 'false');
    await enteteArtiste(page, 'Beatles').click();
    await expect(enteteArtiste(page, 'Beatles')).toHaveAttribute('aria-expanded', 'true');
    await expect(blocsArtiste(page).locator('.exercise-title')).toHaveCount(3);
    expect(Object.values(await prefsAffichage(page))[0].artistClosed).toEqual({});
  });

  test('le rangement choisi est gardé après rechargement, chapitre par chapitre : un second chapitre de morceaux garde le sien @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(morceaux(), { vocab: { styles: ['Rock', 'Funk', 'Jazz'] }, autreChapitre: { nom: 'Chansons', morceaux: ['Brassens - Les Copains d\'abord'] } }) });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Styles');
    await ouvrirMorceaux(page, 'Chansons');
    await expect(boutonVue(page, 'Artistes')).toHaveAttribute('aria-pressed', 'true');   // l'autre chapitre n'a pas bougé
    await choisirVue(page, 'Tous');
    await page.reload();
    await ouvrirMorceaux(page, 'Chansons');
    await expect(boutonVue(page, 'Tous')).toHaveAttribute('aria-pressed', 'true');
    await ouvrirMorceaux(page);
    await expect(boutonVue(page, 'Styles')).toHaveAttribute('aria-pressed', 'true');
    const prefs = await prefsAffichage(page);
    expect(Object.values(prefs).map((p: any) => p.view).sort()).toEqual(['all', 'style']);
  });

  test('changer de rangement ramène à la page du chapitre (on quitte le dossier calculé qui n\'existe peut-être plus dans l\'autre vue)', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await ouvrirDossierCalcule(page, 'Beatles');
    await boutonVue(page, 'Styles').click();
    await expect(page.locator('#breadcrumb .crumb')).toHaveText(['Morceaux']);
    expect((await effectifsDossiers(page)).map((x) => x[0])).toEqual(['Rock', 'Funk', 'Jazz', 'Sans style']);
  });

  test('un dossier vide : « Aucun morceau ici pour l\'instant. » ; un chapitre sans aucun morceau : l\'invitation à ajouter le premier ; sans valeur au vocabulaire : l\'invitation à en créer', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Styles');
    await ouvrirDossierCalcule(page, 'Jazz');
    await expect(messageVide(page)).toHaveText('Aucun morceau ici pour l\'instant.');
    await expect(page.locator('#folder-container .add-song-row')).toBeVisible();   // on peut y ajouter un morceau
  });

  test('chapitre vide : toutes les vues invitent à ajouter le premier morceau ; chapitre sans style : « Aucun style pour l\'instant : crée-en un… »', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux([]) });
    await ouvrirMorceaux(page);
    const invitation = 'Aucun morceau pour l\'instant : ajoute le premier ci-dessous (artiste, puis titre).';
    await expect(messageVide(page)).toHaveText(invitation);
    for (const v of ['Styles', 'Techniques', 'Travail', 'Tous'] as const) {
      await choisirVue(page, v);
      await expect(messageVide(page)).toHaveText(invitation);
    }
    await expect(effectif(page)).toHaveText('0 morceau');
  });

  test('des morceaux sans aucun style au vocabulaire : le rangement Styles invite à en créer', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(['Beatles - Help']) });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Styles');
    await expect(messageVide(page)).toHaveText('Aucun style pour l\'instant : crée-en un avec le bouton ci-dessus, ou classe un morceau depuis sa fiche.');
    expect(await effectifsDossiers(page)).toEqual([['Sans style', 1]]);
  });

  test('un morceau archivé n\'est dans aucun rangement ni compte ; on le retrouve dans « Archivés »', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Tous');
    expect(await titresMorceaux(page)).not.toContain('Toto - Africa');
    await choisirVue(page, 'Styles');
    expect((await effectifsDossiers(page))[0]).toEqual(['Rock', 5]);   // 6 avec Toto s'il comptait
    await entreeArchives(page).click();
    await expect(ligneDepart(page, 'Toto - Africa')).toBeVisible();
  });

  test('la colonne latérale montre les dossiers calculés du rangement choisi avec leur effectif, et un clic ouvre le dossier @ordinateur', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await expect(dossiersColonne(page)).toHaveText(['Beatles']);
    await choisirVue(page, 'Styles');
    await expect(dossiersColonne(page)).toHaveText(['Rock', 'Funk', 'Jazz', 'Sans style']);
    await expect(page.locator('#sidebar-tree .song-tree-node .tree-count')).toHaveText(['5', '2', '0', '1']);
    await page.locator('#sidebar-tree .song-tree-node .tree-row').filter({ hasText: 'Funk' }).click();
    await expect(page.locator('#breadcrumb .crumb-current')).toHaveText('Funk');
    await expect(page.locator('#sidebar-tree .song-tree-node .tree-row.selected .tree-label')).toHaveText('Funk');
    await choisirVue(page, 'Tous');
    await expect(dossiersColonne(page)).toHaveCount(0);
  });

  test('la colonne latérale range les chapitres de morceaux dans leur zone « Morceaux » (7 morceaux, hors archivés), à part de la zone « Exercices » @ordinateur', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(morceaux(), { exercices: ['Gamme', 'Arpèges'] }) });
    await expect(page.locator('#sidebar-tree .tz-songs .tz-count')).toHaveText('7');
    await expect(page.locator('#sidebar-tree .tz-songs .tz-count')).toHaveAttribute('title', '7 morceaux');
    await expect(page.locator('#sidebar-tree .tz-ex .tz-count')).toHaveText('2');
    await expect(page.locator('#sidebar-tree .tz-songs .tree-row-d0 .tree-label')).toHaveText(['Morceaux']);
    await expect(page.locator('#sidebar-tree .tz-ex .tree-row-d0 .tree-label')).toHaveText(['Technique']);
  });
});
