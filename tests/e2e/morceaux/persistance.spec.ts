// MODULE « morceaux » — PERSISTANCE ET REMISE EN FORME de ce qui est enregistré. Observé en boîte noire (playwright-cli, 26/11/2026) : à chaque affichage, l'appli remet les chapitres de morceaux en ordre — le titre
// « Artiste - Titre » fait foi sur les champs artiste / titre, les valeurs inconnues (style, technique, travail) d'un morceau entrent au vocabulaire du chapitre (casse et accents réunis), les dossiers faits à la main
// remontent à plat, un exercice rangé là devient un morceau, un morceau sorti du chapitre redevient un exercice — de sorte qu'une sauvegarde importée, ou fusionnée par la synchro, s'affiche juste. Annuler / rétablir
// suivent l'ajout d'un morceau. Les préférences d'affichage (rangement, tri, artistes repliés) ne voyagent pas avec les données : elles restent sur l'appareil.
import { test, expect } from '../support/fixtures';
import {
  ajouterMorceau, annuler, boutonVue, champsArtiste, champsTitre, chapitreEnregistre, choisirVue, effectifsDossiers, etatMorceaux, lireEtat, nomsDossiers, ouvrirDossierCalcule, ouvrirMorceaux,
  prefsAffichage, retablir, ouvrirChapitre, titresEnregistres, titresMorceaux, effectif, attendreMorceau,
} from './aide-morceaux';

test.describe('Morceaux : persistance et remise en forme @morceaux', () => {
  test('un chapitre importé « à l\'ancienne » (sans artiste ni titre séparés, valeurs absentes du vocabulaire, doublons de casse) s\'affiche juste, et le vocabulaire se complète @critique', async ({ ouvrirAppli, garde }) => {
    const etat: any = etatMorceaux([]);
    const maintenant = Date.now();
    const brut = (id: string, title: string, o: Record<string, unknown> = {}) => ({ id, title, notes: '', links: [], files: [], collapsed: true, updatedAt: maintenant, ...o });
    etat.instruments[0].categories[1].vocab = { styles: ['Rock'], techniques: [] };   // pas de « work » ni d'état « en cours » : à reconstruire
    etat.instruments[0].categories[1].exercises = [
      brut('b1', 'Beatles - Help', { styles: ['rock', 'Jazz', ' ', 'JAZZ'], techniques: ['Médiator', 'mediator'] }),
      brut('b2', 'Beatles - Michelle', { styles: ['Folk'], work: 'à maîtriser' }),
      brut('b3', 'Solo à la basse', { work: 'Mon état' }),
    ];
    const page = await ouvrirAppli({ etat });
    await ouvrirMorceaux(page);
    expect(await nomsDossiers(page)).toEqual(['Beatles']);   // l'artiste vient du titre
    await choisirVue(page, 'Styles');
    // Rock (existant, « rock » réuni), puis Jazz et Folk ajoutés dans l'ordre où ils apparaissent ; chaque morceau a ses styles sans doublon.
    expect(await effectifsDossiers(page)).toEqual([['Rock', 1], ['Jazz', 1], ['Folk', 1], ['Sans style', 1]]);
    await choisirVue(page, 'Techniques');
    expect(await effectifsDossiers(page)).toEqual([['Médiator', 1], ['Sans technique', 2]]);
    await choisirVue(page, 'Travail');
    // Les quatre états du départ, « à maîtriser » ramené à la graphie « À maîtriser », puis l'état inconnu.
    expect(await effectifsDossiers(page)).toEqual([['En cours', 0], ['À maîtriser', 1], ['Maîtrisé', 0], ['Plus tard', 0], ['Mon état', 1], ['À classer', 1]]);
    // La remise en forme s'enregistre à la première modification venue.
    await ouvrirMorceaux(page);
    await ajouterMorceau(page, 'Muse', 'Hysteria');
    await attendreMorceau(page, 'Muse - Hysteria', () => true);
    const ch = await chapitreEnregistre(page);
    expect(ch.vocab).toMatchObject({ styles: ['Rock', 'Jazz', 'Folk'], techniques: ['Médiator'], work: ['En cours', 'À maîtriser', 'Maîtrisé', 'Plus tard', 'Mon état'], inProgress: 'En cours' });
    expect(ch.exercises.find((e: any) => e.id === 'b1')).toMatchObject({ artist: 'Beatles', songName: 'Help', isSong: true, styles: ['Rock', 'Jazz'], techniques: ['Médiator'] });
    expect(ch.exercises.find((e: any) => e.id === 'b3')).toMatchObject({ artist: '', songName: 'Solo à la basse', work: 'Mon état' });
    expect(garde.bloquees).toEqual([]);
  });

  test('un chapitre de morceaux qui contient encore des dossiers faits à la main : leurs morceaux remontent à plat, les dossiers disparaissent', async ({ ouvrirAppli }) => {
    const etat: any = etatMorceaux(['Beatles - Help']);
    const maintenant = Date.now();
    const brut = (id: string, title: string) => ({ id, title, notes: '', links: [], files: [], collapsed: true, updatedAt: maintenant });
    etat.instruments[0].categories[1].folders = [{ id: 'do-1', name: 'Rock', exercises: [brut('r1', 'Queen - Bohemian Rhapsody')], folders: [{ id: 'do-2', name: 'Années 70', exercises: [brut('r2', 'Led Zeppelin - Kashmir')], folders: [] }] }];
    const page = await ouvrirAppli({ etat });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Tous');
    await expect.poll(() => titresMorceaux(page)).toEqual(['Beatles - Help', 'Led Zeppelin - Kashmir', 'Queen - Bohemian Rhapsody']);
    await expect(effectif(page)).toHaveText('3 morceaux');
    await expect(page.locator('#folder-container .folder-row:not(.song-folder-row)')).toHaveCount(0);
  });

  test('un exercice ordinaire posé dans un chapitre de morceaux devient un morceau ; un morceau resté dans un chapitre ordinaire redevient un exercice ordinaire', async ({ ouvrirAppli }) => {
    const etat: any = etatMorceaux(['Beatles - Help'], { exercices: [] });
    const maintenant = Date.now();
    etat.instruments[0].categories[1].exercises.push({ id: 'n1', title: 'Toto - Africa', notes: '', links: [], files: [], collapsed: true, updatedAt: maintenant });   // pas de isSong
    etat.instruments[0].categories[0].exercises.push({ id: 'n2', title: 'Queen - Innuendo', isSong: true, artist: 'Queen', songName: 'Innuendo', styles: ['Rock'], notes: '', links: [], files: [], collapsed: true, updatedAt: maintenant });
    const page = await ouvrirAppli({ etat });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Tous');
    await expect.poll(() => titresMorceaux(page)).toEqual(['Beatles - Help', 'Toto - Africa']);
    const toto = page.locator('#folder-container [data-ex-id="n1"]');
    await toto.locator('.exercise-row-spacer').first().click();
    await expect(champsArtiste(toto)).toHaveValue('Toto');
    await ouvrirChapitre(page, 'Technique');
    await expect(page.locator('#folder-container .exercise-title')).toHaveValue('Queen - Innuendo');
    const queen = page.locator('#folder-container [data-ex-id="n2"]');
    await queen.locator('.exercise-row-spacer').first().click();
    await expect(queen).not.toHaveClass(/collapsed/);
    await expect(champsArtiste(queen)).toHaveCount(0);   // plus de fiche de morceau
    await expect(champsTitre(queen)).toHaveCount(0);
  });

  test('le titre « Artiste - Titre » fait foi : un morceau dont les champs artiste / titre ne le suivent plus est redécoupé d\'après son titre', async ({ ouvrirAppli }) => {
    const etat: any = etatMorceaux([]);
    etat.instruments[0].categories[1].exercises = [{ id: 'c1', title: 'Muse - Hysteria', isSong: true, artist: 'Beatles', songName: 'Help', styles: [], techniques: [], work: '', notes: '', links: [], files: [], collapsed: true, updatedAt: Date.now() }];
    const page = await ouvrirAppli({ etat });
    await ouvrirMorceaux(page);
    const f = page.locator('#folder-container [data-ex-id="c1"]');
    await f.locator('.exercise-row-spacer').first().click();
    await expect(champsArtiste(f)).toHaveValue('Muse');
    await expect(champsTitre(f)).toHaveValue('Hysteria');
  });

  test('« Annuler » défait l\'ajout d\'un morceau, « Rétablir » le remet', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(['Beatles - Help']) });
    await ouvrirMorceaux(page);
    await ajouterMorceau(page, 'Muse', 'Hysteria');
    await expect.poll(() => titresEnregistres(page)).toEqual(['Beatles - Help', 'Muse - Hysteria']);
    await annuler(page);
    await expect.poll(() => titresEnregistres(page)).toEqual(['Beatles - Help']);
    await expect(effectif(page)).toHaveText('1 morceau');
    await retablir(page);
    await expect.poll(() => titresEnregistres(page)).toEqual(['Beatles - Help', 'Muse - Hysteria']);
    await expect(effectif(page)).toHaveText('2 morceaux');
  });

  test('les préférences d\'affichage restent sur l\'appareil : elles ne sont pas dans les données synchronisées (`trainhub.v1`)', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(['Beatles - Help', 'Beatles - Michelle'], { vocab: { styles: ['Rock'] } }) });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Styles');
    await ouvrirDossierCalcule(page, 'Sans style');
    await expect.poll(async () => Object.values(await prefsAffichage(page)).map((p: any) => p.view)).toEqual(['style']);
    await ouvrirMorceaux(page);
    await page.getByRole('button', { name: '＋ Nouveau style' }).click();
    await page.getByRole('dialog').getByRole('textbox').fill('Funk');
    await page.getByRole('dialog').getByRole('button', { name: 'Ajouter' }).click();   // une vraie sauvegarde de l'état
    await expect.poll(async () => (await chapitreEnregistre(page)).vocab.styles).toEqual(['Rock', 'Funk']);
    const brut = JSON.stringify(await lireEtat(page));
    expect(brut).not.toContain('"view"');
    expect(brut).not.toContain('artistClosed');
    // Un autre navigateur (autre appareil) n'a pas ces préférences : le rangement revient au départ (Artistes).
    await page.evaluate(() => localStorage.removeItem('trainhub.songsUi.v1'));
    await page.reload();
    await ouvrirMorceaux(page);
    await expect(boutonVue(page, 'Artistes')).toHaveAttribute('aria-pressed', 'true');
  });

  test('un rangement ou un tri inconnus dans les préférences (version plus ancienne, fichier abîmé) retombent sur Artistes et A → Z', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(['Beatles - Help', 'Beatles - Michelle']), reglages: { 'trainhub.songsUi.v1': JSON.stringify({ 'ch-morceaux': { view: 'couleur', sort: 'hasard' } }) } });
    await ouvrirMorceaux(page);
    await expect(boutonVue(page, 'Artistes')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('combobox', { name: 'Tri des morceaux' })).toHaveValue('az');
    expect(await nomsDossiers(page)).toEqual(['Beatles']);
  });

  test('des préférences illisibles (JSON abîmé) ne bloquent pas le chapitre', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(['Beatles - Help', 'Beatles - Michelle']), reglages: { 'trainhub.songsUi.v1': '{pas du json' } });
    await ouvrirMorceaux(page);
    expect(await nomsDossiers(page)).toEqual(['Beatles']);
  });
});
