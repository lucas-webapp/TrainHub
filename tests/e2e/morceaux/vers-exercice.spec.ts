// MODULE « morceaux » — MORCEAU → EXERCICE : menu d'un morceau › Plus d'actions › « Travailler un passage en exercice… ». Observé en boîte noire (playwright-cli, 26/11/2026) : on choisit le dossier (un chapitre de morceaux
// ne se propose pas), puis un titre (celui du morceau par défaut) ; le nouvel exercice reprend le titre et COPIE les liens (nouveaux identifiants), rien des caractéristiques du morceau (artiste, style, technique,
// travail, favori, notes) ; il garde le souvenir du morceau d'où il vient : « Tiré du morceau : … » sur l'exercice, « Travaillé aussi en exercice : … » sur le morceau, chacun cliquable. Le dernier dossier choisi est proposé en
// premier la fois suivante. Le morceau reste tel quel.
import { test, expect } from '../support/fixtures';
import type { Page } from '@playwright/test';
import { actionExercice, boite, chapitreEnregistre, deplier, etatMorceaux, ligneDepart, message, morceauEnregistre, ouvrirChapitre, ouvrirMorceaux, repondre } from './aide-morceaux';

const LIEN = { label: 'Tuto du riff', url: 'https://www.youtube.com/watch?v=riff1' };
const etat = () => etatMorceaux([
  { titre: 'Muse - Hysteria', styles: ['Rock'], techniques: ['Médiator'], travail: 'En cours', favori: true, notes: 'bien serré', liens: [LIEN, { label: 'Partition', url: 'https://example.org/partition' }] },
  'Beatles - Help',
], { exercices: ['Gamme'], vocab: { styles: ['Rock'], techniques: ['Médiator'] } });
const picker = (page: Page) => page.locator('.folder-picker-panel');
const exercicesTechnique = async (page: Page) => (await chapitreEnregistre(page, 'Technique')).exercises;

async function travailler(page: Page, titre: string) {
  await actionExercice(page, ligneDepart(page, titre), 'Travailler un passage en exercice…');
}

test.describe('Morceaux : morceau → exercice @morceaux', () => {
  test('« Travailler un passage en exercice… » : choisir le dossier, confirmer le titre ; l\'exercice reprend le titre et les liens, sans rien du morceau @critique', async ({ ouvrirAppli, garde }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await travailler(page, 'Muse - Hysteria');
    await expect(picker(page)).toContainText('Exercice tiré de « Muse - Hysteria » : dans quel dossier ?');
    await expect(picker(page).getByRole('button', { name: 'Technique', exact: true })).toBeVisible();
    await expect(picker(page).getByRole('button', { name: 'Morceaux', exact: true })).toHaveCount(0);   // un chapitre de morceaux ne se propose pas
    await picker(page).getByRole('button', { name: 'Technique', exact: true }).click();
    const d = boite(page);
    await expect(d).toContainText('Exercice tiré d\'un morceau');
    await expect(d).toContainText('Il reprend le titre et les liens de « Muse - Hysteria », puis vit sa vie à part (liens, métronome, notes). Les caractéristiques du morceau ne le suivent pas.');
    await expect(d.getByRole('textbox')).toHaveValue('Muse - Hysteria');
    await repondre(page, 'Hysteria - riff de basse', 'Créer');
    await expect.poll(async () => (await exercicesTechnique(page)).map((e: any) => e.title)).toEqual(['Gamme', 'Hysteria - riff de basse']);
    const ex = (await exercicesTechnique(page))[1];
    expect(ex.fromSongId).toBe('ex-muse-hysteria');
    expect(ex.isSong).toBeUndefined();
    expect(ex.links.map((l: any) => [l.label, l.url])).toEqual([[LIEN.label, LIEN.url], ['Partition', 'https://example.org/partition']]);
    const song = await morceauEnregistre(page, 'Muse - Hysteria');
    expect(ex.links.map((l: any) => l.id).filter((id: string) => song.links.some((l: any) => l.id === id))).toEqual([]);   // de NOUVEAUX identifiants : liens indépendants
    for (const c of ['artist', 'songName', 'styles', 'techniques', 'work']) expect(ex[c], c).toBeUndefined();
    expect(ex).toMatchObject({ favorite: false, notes: '', archived: false });
    // Le morceau n'a pas changé.
    expect(song).toMatchObject({ artist: 'Muse', styles: ['Rock'], techniques: ['Médiator'], work: 'En cours', favorite: true, notes: 'bien serré' });
    expect(song.links).toHaveLength(2);
    await expect(message(page, 'Exercice « Hysteria - riff de basse » créé dans « Technique »')).toBeVisible();
    expect(garde.bloquees).toEqual([]);
  });

  test('« Annuler » du message supprime l\'exercice créé et le souvenir du morceau disparaît de sa fiche', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await travailler(page, 'Beatles - Help');
    await picker(page).getByRole('button', { name: 'Technique', exact: true }).click();
    await boite(page).getByRole('button', { name: 'Créer', exact: true }).click();
    await expect.poll(async () => (await exercicesTechnique(page)).length).toBe(2);
    await message(page, 'Exercice « Beatles - Help » créé').getByRole('button', { name: 'Annuler' }).click();
    await expect.poll(async () => (await exercicesTechnique(page)).map((e: any) => e.title)).toEqual(['Gamme']);
  });

  test('les deux fiches se renvoient l\'une à l\'autre : « Tiré du morceau : … » sur l\'exercice, « Travaillé aussi en exercice : … » sur le morceau, chacun cliquable @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await travailler(page, 'Muse - Hysteria');
    await picker(page).getByRole('button', { name: 'Technique', exact: true }).click();
    await boite(page).getByRole('button', { name: 'Créer', exact: true }).click();
    await expect.poll(async () => (await exercicesTechnique(page)).length).toBe(2);
    // La fiche du morceau, dépliée, parle de l'exercice.
    await deplier(page, 'Muse - Hysteria');
    const fm = ligneDepart(page, 'Muse - Hysteria');
    await expect(fm.locator('.ex-kin-to')).toContainText('Travaillé aussi en exercice : Technique › Muse - Hysteria');
    await fm.locator('.ex-kin-to .ex-kin-link').click();   // ouvre l'exercice dans son chapitre
    await expect(page.locator('#breadcrumb .crumb-current')).toHaveText('Technique');
    const idEx = (await exercicesTechnique(page))[1].id as string;
    const fe = page.locator(`#folder-container [data-ex-id="${idEx}"]`);
    await expect(fe).not.toHaveClass(/collapsed/);
    await expect(fe.locator('.ex-kin-from')).toContainText('Tiré du morceau : Muse - Hysteria');
    await fe.locator('.ex-kin-from .ex-kin-link').click();   // et revient au morceau
    await expect(page.locator('#breadcrumb .crumb-current')).toHaveText('Morceaux');
    await expect(ligneDepart(page, 'Muse - Hysteria')).not.toHaveClass(/collapsed/);
  });

  test('un morceau qui a plusieurs exercices tirés les liste tous (un déjà là, un créé maintenant)', async ({ ouvrirAppli }) => {
    const e: any = etat();
    e.instruments[0].categories[0].exercises.push({ id: 'ex-intro', title: 'Help - Intro', notes: '', fromSongId: 'ex-beatles-help', links: [], files: [], collapsed: true, updatedAt: Date.now() });
    const page = await ouvrirAppli({ etat: e });
    await ouvrirMorceaux(page);
    await travailler(page, 'Beatles - Help');
    await picker(page).getByRole('button', { name: 'Technique', exact: true }).click();
    await repondre(page, 'Help - Pont', 'Créer');
    await expect.poll(async () => (await exercicesTechnique(page)).map((x: any) => x.title)).toEqual(['Gamme', 'Help - Intro', 'Help - Pont']);
    await deplier(page, 'Beatles - Help');
    await expect(ligneDepart(page, 'Beatles - Help').locator('.ex-kin-to .ex-kin-link')).toHaveText(['Technique › Help - Intro', 'Technique › Help - Pont']);
  });

  test('la deuxième fois, le dernier dossier choisi est proposé en premier ; « Un autre dossier… » rouvre le choix @critique', async ({ ouvrirAppli }) => {
    const e: any = etat();
    e.instruments[0].categories[0].folders.push({ id: 'do-riffs', name: 'Riffs', folders: [], exercises: [] });
    const page = await ouvrirAppli({ etat: e });
    await ouvrirMorceaux(page);
    await travailler(page, 'Muse - Hysteria');
    await picker(page).getByRole('button', { name: 'Riffs', exact: true }).click();
    await boite(page).getByRole('button', { name: 'Créer', exact: true }).click();
    await expect.poll(async () => ((await chapitreEnregistre(page, 'Technique')).folders[0].exercises).length).toBe(1);
    await travailler(page, 'Beatles - Help');
    const d = boite(page);
    await expect(d).toContainText('Travailler en exercice');
    await expect(d).toContainText('« Beatles - Help » : dans quel dossier créer l\'exercice ?');
    await expect(d.locator('.song-to-ex-last')).toHaveText('Technique › Riffs');
    await d.locator('.song-to-ex-last').click();
    await repondre(page, 'Help - accords', 'Créer');
    await expect.poll(async () => ((await chapitreEnregistre(page, 'Technique')).folders[0].exercises).map((x: any) => x.title)).toEqual(['Muse - Hysteria', 'Help - accords']);
    // « Un autre dossier… » rouvre la fenêtre de choix.
    await travailler(page, 'Beatles - Help');
    await boite(page).locator('.song-to-ex-other').click();
    await expect(picker(page)).toContainText('Exercice tiré de « Beatles - Help » : dans quel dossier ?');
    await picker(page).getByRole('button', { name: 'Technique', exact: true }).click();
    await boite(page).getByRole('button', { name: 'Annuler' }).click();   // on peut renoncer à la dernière étape
    expect((await chapitreEnregistre(page, 'Technique')).exercises.map((x: any) => x.title)).toEqual(['Gamme']);
  });

  test('un titre déjà pris dans le dossier : « Ce nom existe déjà » ; « Créer quand même » crée le doublon', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await travailler(page, 'Beatles - Help');
    await picker(page).getByRole('button', { name: 'Technique', exact: true }).click();
    await boite(page).getByRole('textbox').fill('Gamme');
    await boite(page).getByRole('button', { name: 'Créer', exact: true }).click();
    await expect(boite(page)).toContainText('Ce nom existe déjà');
    await expect(boite(page)).toContainText('Un exercice « Gamme » existe déjà ici.');
    await boite(page).getByRole('button', { name: 'Créer quand même' }).click();
    await expect.poll(async () => (await exercicesTechnique(page)).map((x: any) => x.title)).toEqual(['Gamme', 'Gamme']);
  });

  test('modifier l\'exercice tiré ne touche pas au morceau : liens indépendants, notes à part', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etat() });
    await ouvrirMorceaux(page);
    await travailler(page, 'Muse - Hysteria');
    await picker(page).getByRole('button', { name: 'Technique', exact: true }).click();
    await boite(page).getByRole('button', { name: 'Créer', exact: true }).click();
    await expect.poll(async () => (await exercicesTechnique(page)).length).toBe(2);
    const idEx = (await exercicesTechnique(page))[1].id as string;
    await ouvrirChapitre(page, 'Technique');
    const fe = page.locator(`#folder-container [data-ex-id="${idEx}"]`);
    await fe.locator('.exercise-row-spacer').first().click();
    await fe.getByRole('button', { name: '＋ Note fixe' }).click();
    await fe.getByPlaceholder('À ne pas oublier…').fill('seulement le pont');
    await fe.getByPlaceholder('À ne pas oublier…').blur();
    await expect.poll(async () => (await exercicesTechnique(page))[1].fixedNotes).toBe('seulement le pont');
    const song = await morceauEnregistre(page, 'Muse - Hysteria');
    expect(song.fixedNotes || '').toBe('');
    expect(song.notes).toBe('bien serré');
  });
});
