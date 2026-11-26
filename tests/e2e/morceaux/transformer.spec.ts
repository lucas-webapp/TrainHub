// MODULE « morceaux » — TRANSFORMER : un chapitre ordinaire en chapitre de morceaux (et revenir en arrière), un exercice en morceau. Observé en boîte noire (playwright-cli, 26/11/2026) :
// menu d'un chapitre › « Transformer en chapitre de morceaux… » : sans sous-dossier, une simple confirmation ; avec des dossiers, une fenêtre qui demande ce que signifient les dossiers du 1er et du 2e niveau
// (Styles, Artistes, Techniques, Travail, Ignorer), annonce le résultat (« 6 morceaux · 1 doublon fusionné · 2 styles · 4 artistes »), fusionne les doublons (même artiste et même titre), met à jour les sessions et
// les statistiques, et fait une SAUVEGARDE DE SECOURS avant ; « Annuler » du message rétablit. Menu d'un exercice › Plus d'actions › « ♪ Transformer en morceau… » : le range dans un chapitre de morceaux.
// Le menu d'un chapitre de morceaux propose « Revenir à un chapitre ordinaire… » (les caractéristiques sont gardées au cas où). Les entrées de menu elles-mêmes : module `bibliotheque`.
import { test, expect } from '../support/fixtures';
import type { Page } from '@playwright/test';
import {
  actionExercice, boite, chapitreEnregistre, choisirAction, confirmer, entreeArchives, entreesMenu, etatMorceaux, etatOrdinaire, lireEtat, menuContextuel, message, morceauEnregistre, ouvrirChapitre,
  ouvrirMenu, ouvrirMorceaux, prefsAffichage, repondre, titresEnregistres, effectif, boutonVue, nomsDossiers,
} from './aide-morceaux';
import { chapitre } from '../bibliotheque/aide-bibliotheque';

const salle = (page: Page) => page.locator('.songs-convert-panel');
const sauvegardes = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.backups.v1') || '[]') as Array<{ reason: string; count: number; json: string }>);
const LIEN = { label: 'YouTube Help', url: 'https://www.youtube.com/watch?v=abc' };

/** Un chapitre « Chansons » rangé par style puis par artiste ; « Help » est dans deux dossiers (un doublon). */
const chansons = (extra: Parameters<typeof etatOrdinaire>[3] = {}) => etatOrdinaire('Chansons', ['Toto - Africa'], [
  { nom: 'Rock', dossiers: [
    { nom: 'Beatles', exercices: [{ titre: 'Help', id: 'e-help-rock', liens: [LIEN], notes: 'intro en do' }, 'Michelle'] },
    { nom: 'Queen', exercices: ['Bohemian Rhapsody'] },
  ] },
  { nom: 'Funk', dossiers: [
    { nom: 'Stevie Wonder', exercices: ['Superstition', 'Sir Duke'] },
    { nom: 'Beatles', exercices: [{ titre: 'Help', id: 'e-help-funk' }] },
  ] },
], extra);

test.describe('Morceaux : transformer un chapitre @morceaux', () => {
  test('chapitre sans sous-dossier : une confirmation, puis ses exercices deviennent des morceaux « Artiste - Titre » ; « Annuler » rend un chapitre ordinaire @critique', async ({ ouvrirAppli, garde }) => {
    const page = await ouvrirAppli({ etat: etatOrdinaire('Chansons', ['Beatles - Help', 'Queen - Bohemian Rhapsody', 'Gamme libre']) });
    await ouvrirChapitre(page, 'Chansons');
    await ouvrirMenu(page, chapitre(page, 'Chansons'));
    await choisirAction(page, 'Transformer en chapitre de morceaux…');
    const d = boite(page);
    await expect(d).toContainText('Transformer « Chansons » en chapitre de morceaux ?');
    await expect(d).toContainText('Les exercices du chapitre deviennent des morceaux (« Artiste - Titre »).');
    await d.getByRole('button', { name: 'Annuler' }).click();   // refus : rien ne change
    expect((await chapitreEnregistre(page, 'Chansons')).kind).toBeUndefined();
    await ouvrirMenu(page, chapitre(page, 'Chansons'));
    await choisirAction(page, 'Transformer en chapitre de morceaux…');
    await confirmer(page, 'Transformer');
    await expect.poll(async () => (await chapitreEnregistre(page, 'Chansons')).kind).toBe('songs');
    const ch = await chapitreEnregistre(page, 'Chansons');
    expect(ch.exercises.map((e: any) => [e.title, e.artist, e.songName, e.isSong])).toEqual([
      ['Beatles - Help', 'Beatles', 'Help', true], ['Queen - Bohemian Rhapsody', 'Queen', 'Bohemian Rhapsody', true], ['Gamme libre', '', 'Gamme libre', true]]);
    expect(ch.vocab.work).toEqual(['En cours', 'À maîtriser', 'Maîtrisé', 'Plus tard']);
    await expect(message(page, '« Chansons » est un chapitre de morceaux')).toBeVisible();
    await expect(page.locator('#sidebar-tree .tz-songs .tree-row-d0 .tree-label')).toHaveText(['Chansons']);   // il est passé dans la zone « Morceaux »
    await expect(boutonVue(page, 'Artistes')).toHaveAttribute('aria-pressed', 'true');
    await expect(effectif(page)).toHaveText('3 morceaux');
    await message(page, 'est un chapitre de morceaux').getByRole('button', { name: 'Annuler' }).click();
    await expect.poll(async () => (await chapitreEnregistre(page, 'Chansons')).kind).toBeUndefined();
    expect(garde.bloquees).toEqual([]);
  });

  test('chapitre à dossiers : la fenêtre demande ce que sont les dossiers, annonce le résultat (doublons fusionnés), et ne change rien tant qu\'on ne valide pas @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: chansons() });
    await ouvrirChapitre(page, 'Chansons');
    await ouvrirMenu(page, chapitre(page, 'Chansons'));
    await choisirAction(page, 'Transformer en chapitre de morceaux…');
    await expect(salle(page)).toBeVisible();
    await expect(salle(page).locator('.backups-title')).toHaveText('Transformer « Chansons » en chapitre de morceaux');
    await expect(salle(page).locator('.songs-convert-intro')).toContainText('Une sauvegarde de secours est faite avant');
    const choix = salle(page).locator('.songs-convert-row select');
    await expect(choix).toHaveCount(2);   // deux niveaux de dossiers
    await expect(salle(page).locator('.songs-convert-row').first()).toContainText('Dossiers du 1er niveau (« Rock », « Funk »…)');
    await expect(salle(page).locator('.songs-convert-row').nth(1)).toContainText('Dossiers du 2e niveau');
    await expect(choix.nth(0)).toHaveValue('style');
    await expect(choix.nth(1)).toHaveValue('artist');
    await expect(choix.nth(0).locator('option')).toHaveText(['Styles', 'Artistes', 'Techniques', 'Travail', 'Ignorer']);
    await expect(salle(page).locator('.songs-convert-sum')).toHaveText('Résultat : 6 morceaux · 1 doublon fusionné · 2 styles · 4 artistes');
    // On change la signification : la ligne du résultat suit.
    await choix.nth(0).selectOption('');
    await choix.nth(1).selectOption('');
    await expect(salle(page).locator('.songs-convert-sum')).toHaveText('Résultat : 6 morceaux · 1 doublon fusionné · 1 artiste');
    await salle(page).getByRole('button', { name: 'Annuler' }).click();
    await expect(salle(page)).toBeHidden();
    expect((await chapitreEnregistre(page, 'Chansons')).kind).toBeUndefined();
    expect((await chapitreEnregistre(page, 'Chansons')).folders).toHaveLength(2);   // les dossiers sont toujours là
  });

  test('transformer : styles et artistes déduits des dossiers, doublon fusionné (liens et notes réunis), sauvegarde de secours faite, rangement par style au départ @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: chansons() });
    await ouvrirChapitre(page, 'Chansons');
    await ouvrirMenu(page, chapitre(page, 'Chansons'));
    await choisirAction(page, 'Transformer en chapitre de morceaux…');
    await salle(page).getByRole('button', { name: 'Transformer' }).click();
    await expect(salle(page)).toBeHidden();
    await expect.poll(async () => (await chapitreEnregistre(page, 'Chansons')).kind).toBe('songs');
    const ch = await chapitreEnregistre(page, 'Chansons');
    expect(ch.folders).toEqual([]);   // les dossiers disparaissent : tout est à plat
    expect(ch.exercises.map((e: any) => e.title).sort()).toEqual(['Beatles - Help', 'Beatles - Michelle', 'Queen - Bohemian Rhapsody', 'Stevie Wonder - Sir Duke', 'Stevie Wonder - Superstition', 'Toto - Africa']);
    expect(ch.vocab.styles).toEqual(['Rock', 'Funk']);   // dans l'ordre des dossiers d'origine
    const help = ch.exercises.find((e: any) => e.title === 'Beatles - Help');
    expect(help).toMatchObject({ isSong: true, artist: 'Beatles', songName: 'Help', styles: ['Rock', 'Funk'], id: 'e-help-rock', notes: 'intro en do' });   // le doublon qui a le plus de contenu survit
    expect(help.links.map((l: any) => l.label)).toEqual(['YouTube Help']);
    expect(ch.exercises.find((e: any) => e.title === 'Stevie Wonder - Sir Duke')).toMatchObject({ styles: ['Funk'] });
    expect(ch.exercises.find((e: any) => e.title === 'Toto - Africa')).toMatchObject({ styles: [] });
    await expect(message(page, '« Chansons » : 6 morceaux, 1 doublon fusionné')).toBeVisible();
    // Le premier niveau était des styles : le chapitre s'ouvre rangé par style.
    await expect(boutonVue(page, 'Styles')).toHaveAttribute('aria-pressed', 'true');
    expect(Object.values(await prefsAffichage(page)).map((p: any) => p.view)).toEqual(['style']);
    await expect.poll(() => nomsDossiers(page)).toEqual(['Rock', 'Funk', 'Sans style']);
    // Une sauvegarde de secours, faite AVANT, garde les dossiers d'origine.
    const sauv = (await sauvegardes(page)).find((s) => s.reason.startsWith('Avant transformation'));
    expect(sauv?.reason).toBe('Avant transformation de « Chansons » en chapitre de morceaux');
    expect(sauv!.count).toBe(7);
    expect(JSON.parse(sauv!.json).instruments[0].categories[0].folders).toHaveLength(2);
  });

  test('les sessions qui pointaient vers un doublon pointent vers le morceau conservé ; les statistiques gardent un alias', async ({ ouvrirAppli }) => {
    const session = { id: 'sess-1', name: 'Soirée Beatles', instrumentId: 'esp-0', tabIds: [], createdAt: Date.now() - 86_400_000, steps: [
      { id: 'st-1', exerciseId: 'e-help-funk', minutes: 5, note: '', hidden: [] }, { id: 'st-2', exerciseId: 'e-help-rock', minutes: 7, note: '', hidden: [] }] };
    const page = await ouvrirAppli({ etat: chansons({ reglages: { guidedSessions: [session], sessionPlan: [] } }) });
    await ouvrirChapitre(page, 'Chansons');
    await ouvrirMenu(page, chapitre(page, 'Chansons'));
    await choisirAction(page, 'Transformer en chapitre de morceaux…');
    await salle(page).getByRole('button', { name: 'Transformer' }).click();
    await expect.poll(async () => (await chapitreEnregistre(page, 'Chansons')).kind).toBe('songs');
    const e = await lireEtat(page);
    expect(e.settings.guidedSessions[0].steps.map((s: any) => s.exerciseId)).toEqual(['e-help-rock', 'e-help-rock']);
    expect(e.settings.statsRules.alias).toMatchObject({ 'e-help-funk': 'e-help-rock' });
    expect(JSON.stringify(e)).not.toContain('"e-help-funk","title"');   // le doublon n'existe plus comme exercice
  });

  test('« Revenir à un chapitre ordinaire… » : les morceaux restent dans le chapitre sans rangement ; leurs caractéristiques sont gardées dans les données', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux([{ titre: 'Beatles - Help', styles: ['Rock'], travail: 'En cours' }, 'Muse - Hysteria'], { vocab: { styles: ['Rock'] } }) });
    await ouvrirMorceaux(page);
    await ouvrirMenu(page, chapitre(page, 'Morceaux'));
    expect(await entreesMenu(page)).toContain('Revenir à un chapitre ordinaire…');
    expect(await entreesMenu(page)).not.toContain('Transformer en chapitre de morceaux…');
    await choisirAction(page, 'Revenir à un chapitre ordinaire…');
    await expect(boite(page)).toContainText('Revenir à un chapitre ordinaire ?');
    await expect(boite(page)).toContainText('Les morceaux restent dans « Morceaux », sans rangement par style, artiste, technique ou travail (leurs caractéristiques sont gardées au cas où).');
    await confirmer(page, 'Revenir');
    await expect.poll(async () => (await chapitreEnregistre(page)).kind).toBeUndefined();
    const ch = await chapitreEnregistre(page);
    expect(ch.exercises.map((e: any) => [e.title, e.isSong])).toEqual([['Beatles - Help', undefined], ['Muse - Hysteria', undefined]]);
    expect(ch.exercises[0]).toMatchObject({ styles: ['Rock'], work: 'En cours', artist: 'Beatles' });   // gardées au cas où
    await expect(message(page, '« Morceaux » est de nouveau un chapitre ordinaire')).toBeVisible();
    await expect(page.locator('#folder-container .songs-bar')).toHaveCount(0);   // plus de barre de rangement
    await expect(page.locator('#folder-container .exercise-title')).toHaveCount(2);
    await expect(page.locator('#sidebar-tree .tz-ex .tree-row-d0 .tree-label')).toHaveText(['Technique', 'Morceaux']);   // il est passé dans la zone « Exercices »
    await expect(page.locator('#sidebar-tree .tz-songs')).toHaveCount(0);
  });
});

test.describe('Morceaux : transformer un exercice en morceau @morceaux', () => {
  const avecChapitre = () => etatMorceaux(['Beatles - Help'], { exercices: [] });
  const exoTechnique = (titre: string, extra: Record<string, unknown> = {}) => {
    const e: any = avecChapitre();
    e.instruments[0].categories[0].exercises.push({ id: 'ex-a-transformer', title: titre, notes: 'à travailler lentement', favorite: true, archived: false, links: [{ id: 'l1', label: 'Tuto', url: 'https://www.youtube.com/watch?v=xyz' }], files: [], collapsed: true, updatedAt: Date.now(), ...extra });
    return e;
  };
  const exo = (page: Page) => page.locator('#folder-container [data-ex-id="ex-a-transformer"]');

  test('« ♪ Transformer en morceau… » : la boîte propose « Artiste - Titre » d\'après le titre ; l\'exercice est rangé dans le chapitre de morceaux avec ses notes, liens et favori @critique', async ({ ouvrirAppli, garde }) => {
    const page = await ouvrirAppli({ etat: exoTechnique('Queen - Bohemian Rhapsody') });
    await ouvrirChapitre(page, 'Technique');
    await actionExercice(page, exo(page), '♪ Transformer en morceau…');
    const d = boite(page);
    await expect(d).toContainText('Transformer en morceau');
    await expect(d).toContainText('Format « Artiste - Titre ». Il sera rangé dans le chapitre « Morceaux », avec ses notes, liens et fichiers.');
    await expect(d.getByRole('textbox')).toHaveValue('Queen - Bohemian Rhapsody');
    await expect(d.getByRole('textbox')).toHaveAttribute('placeholder', 'Artiste - Titre');
    await d.getByRole('button', { name: 'Transformer' }).click();
    await expect.poll(async () => (await chapitreEnregistre(page, 'Technique')).exercises.length).toBe(0);
    const m = await morceauEnregistre(page, 'Queen - Bohemian Rhapsody');
    expect(m).toMatchObject({ id: 'ex-a-transformer', isSong: true, artist: 'Queen', songName: 'Bohemian Rhapsody', notes: 'à travailler lentement', favorite: true });
    expect(m.links.map((l: any) => l.label)).toEqual(['Tuto']);
    await expect(message(page, '« Queen - Bohemian Rhapsody » est maintenant un morceau, rangé dans « Morceaux »')).toBeVisible();
    await ouvrirMorceaux(page);
    await expect(effectif(page)).toHaveText('2 morceaux');
    // « Annuler » : il redevient l'exercice qu'il était.
    await message(page, 'est maintenant un morceau').getByRole('button', { name: 'Annuler' }).click();
    await expect.poll(async () => (await chapitreEnregistre(page, 'Technique')).exercises.map((e: any) => e.title)).toEqual(['Queen - Bohemian Rhapsody']);
    expect(garde.bloquees).toEqual([]);
  });

  test('on peut corriger l\'« Artiste - Titre » proposé ; un artiste déjà connu garde sa graphie ; un titre sans artiste donne un morceau sans artiste', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: exoTechnique('Help (intro)') });
    await ouvrirChapitre(page, 'Technique');
    await actionExercice(page, exo(page), '♪ Transformer en morceau…');
    await expect(boite(page).getByRole('textbox')).toHaveValue('Help (intro)');
    await repondre(page, 'beatles - Help (intro)');
    const m = await morceauEnregistre(page, 'Beatles - Help (intro)');
    expect(m).toMatchObject({ artist: 'Beatles', songName: 'Help (intro)' });
  });

  test('un titre sans « - » proposé tel quel : le morceau n\'a pas d\'artiste', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: exoTechnique('Impro en mi') });
    await ouvrirChapitre(page, 'Technique');
    await actionExercice(page, exo(page), '♪ Transformer en morceau…');
    await boite(page).getByRole('button', { name: 'Transformer', exact: true }).click();
    await expect.poll(async () => (await morceauEnregistre(page, 'Impro en mi'))?.isSong).toBe(true);
    expect(await morceauEnregistre(page, 'Impro en mi')).toMatchObject({ artist: '', songName: 'Impro en mi' });
  });

  test('un nom déjà pris dans le chapitre de morceaux : « Transformer quand même » ou on laisse l\'exercice où il est', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: exoTechnique('Beatles - Help') });
    await ouvrirChapitre(page, 'Technique');
    await actionExercice(page, exo(page), '♪ Transformer en morceau…');
    await boite(page).getByRole('button', { name: 'Transformer', exact: true }).click();
    await expect(boite(page)).toContainText('Un morceau « Beatles - Help » existe déjà ici.');
    await boite(page).getByRole('button', { name: 'Annuler' }).click();
    expect((await chapitreEnregistre(page, 'Technique')).exercises).toHaveLength(1);
    await actionExercice(page, exo(page), '♪ Transformer en morceau…');
    await boite(page).getByRole('button', { name: 'Transformer', exact: true }).click();
    await boite(page).getByRole('button', { name: 'Transformer quand même' }).click();
    await expect.poll(() => titresEnregistres(page)).toEqual(['Beatles - Help', 'Beatles - Help']);
  });

  test('plusieurs chapitres de morceaux : la boîte « Dans quel chapitre de morceaux le ranger ? » propose chacun', async ({ ouvrirAppli }) => {
    const e: any = exoTechnique('Toto - Africa');
    e.instruments[0].categories.push({ id: 'ch-chansons', name: 'Chansons', kind: 'songs', color: '#00d9ff', folders: [], exercises: [] });
    const page = await ouvrirAppli({ etat: e });
    await ouvrirChapitre(page, 'Technique');
    await actionExercice(page, exo(page), '♪ Transformer en morceau…');
    const d = boite(page);
    await expect(d).toContainText('Dans quel chapitre de morceaux le ranger ?');
    await expect(d.getByRole('button', { name: 'Morceaux', exact: true })).toBeVisible();
    await expect(d.getByRole('button', { name: 'Chansons', exact: true })).toBeVisible();
    await d.getByRole('button', { name: 'Chansons', exact: true }).click();
    await expect(boite(page).getByRole('textbox')).toHaveValue('Toto - Africa');
    await expect(boite(page)).toContainText('rangé dans le chapitre « Chansons »');
    await boite(page).getByRole('button', { name: 'Transformer', exact: true }).click();
    await expect.poll(async () => (await morceauEnregistre(page, 'Toto - Africa', 'Chansons'))?.isSong).toBe(true);
    expect(await titresEnregistres(page, 'Morceaux')).toEqual(['Beatles - Help']);
  });

  test('aucun chapitre de morceaux : « Pas encore de chapitre de morceaux » propose d\'en créer un, qui se nomme « Morceaux » et reçoit l\'exercice @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatOrdinaire('Technique', [{ titre: 'Toto - Africa', id: 'ex-a-transformer' }]) });
    await ouvrirChapitre(page, 'Technique');
    await actionExercice(page, exo(page), '♪ Transformer en morceau…');
    const d = boite(page);
    await expect(d).toContainText('Pas encore de chapitre de morceaux');
    await expect(d).toContainText('Un morceau vit dans un chapitre de morceaux (rangement par artiste, style, technique). Transforme un de tes chapitres, ou crée-en un nouveau pour y ranger « Toto - Africa ».');
    await d.getByRole('button', { name: 'Créer un chapitre de morceaux' }).click();
    await expect(boite(page)).toContainText('Il sera rangé dans le chapitre « Morceaux »');
    await boite(page).getByRole('button', { name: 'Transformer', exact: true }).click();
    await expect.poll(async () => (await chapitreEnregistre(page, 'Morceaux'))?.kind).toBe('songs');
    expect(await titresEnregistres(page)).toEqual(['Toto - Africa']);
    await expect(page.locator('#sidebar-tree .tz-songs .tree-row-d0 .tree-label')).toHaveText(['Morceaux']);
  });

  test('aucun chapitre de morceaux mais un chapitre nommé « Mes chansons » : la boîte propose de le transformer ; « Morceaux » étant pris par un chapitre ordinaire, le nouveau s\'appelle « Mes morceaux »', async ({ ouvrirAppli }) => {
    const e = etatOrdinaire('Technique', [{ titre: 'Toto - Africa', id: 'ex-a-transformer' }], [], { autres: [{ id: 'ch-chansons', name: 'Mes chansons', color: '#00d9ff', folders: [], exercises: [] }, { id: 'ch-pris', name: 'Morceaux', color: '#ff9100', folders: [], exercises: [] }] });
    const page = await ouvrirAppli({ etat: e });
    await ouvrirChapitre(page, 'Technique');
    await actionExercice(page, exo(page), '♪ Transformer en morceau…');
    const d = boite(page);
    await expect(d.getByRole('button', { name: 'Transformer « Mes chansons »…' })).toBeVisible();
    await expect(d.getByRole('button', { name: 'Transformer « Morceaux »…' })).toBeVisible();
    await d.getByRole('button', { name: 'Créer un chapitre de morceaux' }).click();
    await expect(boite(page)).toContainText('Il sera rangé dans le chapitre « Mes morceaux »');
    await boite(page).getByRole('button', { name: 'Transformer', exact: true }).click();
    await expect.poll(async () => (await chapitreEnregistre(page, 'Mes morceaux'))?.kind).toBe('songs');
  });

  test('un exercice archivé ne propose pas « Transformer en morceau »', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: exoTechnique('Toto - Africa', { archived: true }) });
    await entreeArchives(page).click();
    await ouvrirMenu(page, exo(page).locator('.exercise-row').first());
    await menuContextuel(page).getByRole('button', { name: /Plus d'actions/ }).click();
    await expect(menuContextuel(page).getByRole('button', { name: '♪ Transformer en morceau…' })).toHaveCount(0);
  });
});
