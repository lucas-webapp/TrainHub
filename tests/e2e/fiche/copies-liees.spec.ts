// MODULE « fiche » — COPIES LIÉES : ce que deux exercices liés partagent. Observé en boîte noire (playwright-cli, 24/11/2026) : la boîte « Liaison de « X » » dit : pièces jointes (liens,
// fichiers, images) et réglages (métronome prédéfini, objectif tempo, dé, notes fixes) sont COMMUNS ; le titre, les notes mobiles et les favoris restent propres à chaque exercice ;
// « Rompre pour cet exercice » sépare (l'exercice garde ce qu'il a, en copies à lui). Le badge porte le nombre d'autres copies. Créer / lier / rompre (menus, annuler) : module `bibliotheque`.
import { test, expect } from '../support/fixtures';
import { actionExercice, ligne } from '../bibliotheque/aide-bibliotheque';
import { ajouterLien, attendreChamp, boutonNoteFixe, boutonObjectif, champTempo, etatFiche, exo, fiche, espaceEntete, noteFixe, noteMobile, boutonNoteMobile, ouvrirOnglet, ouvrirTechnique, boutonDe, boutonTirer } from './aide-fiche';
import type { Page } from '@playwright/test';

const lien = { linkId: 'L-blues' };
const deuxCopies = () => etatFiche([{ titre: 'Walking', extra: { ...lien } }, { titre: 'Walking (copie)', extra: { ...lien } }]);
const badge = (f: ReturnType<typeof fiche>) => f.getByRole('button', { name: 'Exercice lié : gérer la liaison' });

async function pairesDe(page: Page) { return [fiche(page, 'Walking'), fiche(page, 'Walking (copie)')] as const; }

test.describe('Fiche : copies liées @fiche', () => {
  test('dupliquer un exercice : la copie arrive liée avec ses liens, le badge indique le nombre d\'autres copies, et un lien ajouté sur la copie apparaît sur l\'original @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche([{ titre: 'Walking', extra: { links: [{ id: 'l1', label: 'Mon site', url: 'https://exemple.fr/walking' }] } }]) });
    await ouvrirTechnique(page);
    await actionExercice(page, fiche(page, 'Walking'), 'Dupliquer');
    const original = fiche(page, 'Walking');
    const copie = await ligne(page, 'Walking (copie)');   // la copie reçoit un identifiant à elle
    await expect(copie).toBeVisible();
    await expect(badge(original)).toHaveText('1');
    await expect(badge(copie)).toHaveText('1');
    await expect(copie.getByPlaceholder('Coller un lien…')).toBeHidden();   // la copie arrive repliée
    await espaceEntete(copie).click();
    await ouvrirOnglet(copie, 'Liens et fichiers');
    await expect(copie.getByRole('link', { name: /Mon site/ })).toBeVisible();   // les pièces jointes ont suivi
    // Ouvrir une fiche replie les autres (voir ouvrir-replier.spec.ts) : la jumelle est maintenant repliée.
    await expect(original.getByPlaceholder('Coller un lien…')).toBeHidden();

    await ajouterLien(copie, 'https://exemple.fr/ajout-sur-la-copie');
    await expect.poll(async () => (await exo(page, 'Walking')).links.length).toBe(2);
    await espaceEntete(original).click();
    await ouvrirOnglet(original, 'Liens et fichiers');
    await expect(original.getByRole('link', { name: /exemple\.fr|Mon site/ })).toHaveCount(2);
    await expect(copie.getByPlaceholder('Coller un lien…')).toBeHidden();   // et c'est la copie qui se replie à son tour
  });

  test('pièces jointes communes : retirer un lien d\'un côté le retire de l\'autre', async ({ ouvrirAppli }) => {
    const liens = [{ id: 'l1', label: 'Un', url: 'https://exemple.fr/1' }, { id: 'l2', label: 'Deux', url: 'https://exemple.fr/2' }];
    const page = await ouvrirAppli({ etat: etatFiche([{ titre: 'Walking', extra: { ...lien, links: liens } }, { titre: 'Walking (copie)', extra: { ...lien, links: liens.map((l) => ({ ...l, id: l.id + 'c' })) } }]) });
    await ouvrirTechnique(page);
    const [original, copie] = await pairesDe(page);
    await ouvrirOnglet(original, 'Liens et fichiers');
    await original.getByRole('link', { name: /Un/ }).getByTitle('Retirer ce lien').click();
    await expect.poll(async () => (await exo(page, 'Walking (copie)')).links.map((l: any) => l.label)).toEqual(['Deux']);
    await ouvrirOnglet(copie, 'Liens et fichiers');
    await expect(copie.getByRole('link', { name: /Un/ })).toHaveCount(0);
    await expect(copie.getByRole('link', { name: /Deux/ })).toBeVisible();
  });

  test('réglages communs : tempo cible, objectif tempo, dé et note fixe suivent d\'une copie à l\'autre @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: deuxCopies() });
    await ouvrirTechnique(page);
    const [original, copie] = await pairesDe(page);
    // Tempo cible.
    await champTempo(original).fill('84');
    await champTempo(original).press('Enter');
    await expect(champTempo(copie)).toHaveValue('84');
    expect((await exo(page, 'Walking (copie)')).metronome.bpm).toBe(84);
    // Objectif tempo.
    await boutonObjectif(copie).click();
    await expect(boutonObjectif(original)).toHaveAttribute('aria-pressed', 'false');
    expect((await exo(page, 'Walking')).tempoGoal).toBe(false);
    // Note fixe (son AFFICHAGE sur l'autre fiche : test FI-01 plus bas) : l'état de la copie est à jour.
    await boutonNoteFixe(original).click();
    await page.keyboard.type('Quarte juste, pouce ancré');
    await attendreChamp(page, 'Walking (copie)', 'fixedNotes', 'Quarte juste, pouce ancré');
    // Dé : allumé sur la copie, présent sur l'original.
    await boutonDe(copie).click();
    await page.getByRole('dialog', { name: 'Quel dé pour « Walking (copie) » ?' }).getByRole('button', { name: 'Dé de gammes' }).click();
    await page.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect.poll(async () => !!(await exo(page, 'Walking')).dice).toBe(true);   // (affichage sur l'autre fiche : FI-01 plus bas)
    await page.reload();
    await ouvrirTechnique(page);
    await expect(boutonTirer(original)).toBeVisible();
    await expect(champTempo(original)).toHaveValue('84');
  });

  test('dé commun : allumé sur un exercice, il apparaît aussitôt (« Régler », « Tirer ») sur la copie liée, sans recharger', async ({ ouvrirAppli }) => {
    test.fail(true, "FI-01 : (copies liées dépliées toutes les deux) le dé allumé sur un exercice lié est bien enregistré sur la copie, mais la fiche de la copie ne le montre qu'après un rechargement.");
    const page = await ouvrirAppli({ etat: deuxCopies() });
    await ouvrirTechnique(page);
    const [original, copie] = await pairesDe(page);
    await boutonDe(copie).click();
    await page.getByRole('dialog', { name: 'Quel dé pour « Walking (copie) » ?' }).getByRole('button', { name: 'Dé de gammes' }).click();
    await page.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect.poll(async () => !!(await exo(page, 'Walking')).dice).toBe(true);
    await expect(boutonTirer(original)).toBeVisible();
  });

  test('note fixe commune : écrite sur un exercice, elle apparaît aussitôt sur la copie liée (sans recharger)', async ({ ouvrirAppli }) => {
    test.fail(true, "FI-01 : (copies liées dépliées toutes les deux) la note fixe écrite sur un exercice lié est bien enregistrée sur la copie, mais la fiche de la copie ne la montre qu'après un rechargement (zone toujours masquée, « ＋ Note fixe » proposé).");
    const page = await ouvrirAppli({ etat: deuxCopies() });
    await ouvrirTechnique(page);
    const [original, copie] = await pairesDe(page);
    await boutonNoteFixe(original).click();
    await page.keyboard.type('Quarte juste, pouce ancré');
    await attendreChamp(page, 'Walking (copie)', 'fixedNotes', 'Quarte juste, pouce ancré');
    await expect(noteFixe(copie)).toBeVisible();
    await expect(noteFixe(copie)).toHaveValue('Quarte juste, pouce ancré');
  });

  test('note fixe commune : après rechargement, la copie liée montre la note écrite sur l\'autre exercice', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: deuxCopies() });
    await ouvrirTechnique(page);
    const [original, copie] = await pairesDe(page);
    await boutonNoteFixe(original).click();
    await page.keyboard.type('Quarte juste, pouce ancré');
    await attendreChamp(page, 'Walking (copie)', 'fixedNotes', 'Quarte juste, pouce ancré');
    await page.reload();
    await ouvrirTechnique(page);
    await expect(noteFixe(copie)).toHaveValue('Quarte juste, pouce ancré');
  });

  test('propres à chaque exercice : le titre, la note mobile et le favori ne se partagent pas', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: deuxCopies() });
    await ouvrirTechnique(page);
    const [original, copie] = await pairesDe(page);
    await boutonNoteMobile(original).click();
    await page.keyboard.type('seulement sur l\'original');
    await attendreChamp(page, 'Walking', 'notes', 'seulement sur l\'original');
    await expect(noteMobile(copie)).toBeHidden();
    expect((await exo(page, 'Walking (copie)')).notes).toBe('');

    await actionExercice(page, original, /Marquer en favori/);
    await expect.poll(async () => (await exo(page, 'Walking')).favorite).toBe(true);
    expect((await exo(page, 'Walking (copie)')).favorite).toBe(false);

    const titre = original.locator('input.exercise-title');
    await titre.fill('Walking bass');
    await titre.press('Enter');
    await expect.poll(async () => (await exo(page, 'Walking bass'))?.title).toBe('Walking bass');
    await expect(copie.locator('input.exercise-title')).toHaveValue('Walking (copie)');
  });

  test('rompre la liaison : les deux exercices gardent ce qu\'ils ont, et ne se suivent plus @critique', async ({ ouvrirAppli }) => {
    const liens = [{ id: 'l1', label: 'Un', url: 'https://exemple.fr/1' }];
    const page = await ouvrirAppli({ etat: etatFiche([{ titre: 'Walking', extra: { ...lien, links: liens, fixedNotes: 'Consigne' } }, { titre: 'Walking (copie)', extra: { ...lien, links: [{ ...liens[0], id: 'l1c' }], fixedNotes: 'Consigne' } }]) });
    await ouvrirTechnique(page);
    const [original, copie] = await pairesDe(page);
    await badge(original).click();
    const boite = page.getByRole('dialog', { name: 'Liaison de « Walking »' });
    await expect(boite).toContainText('Walking (copie)');
    await boite.getByRole('button', { name: 'Rompre pour cet exercice' }).click();
    await expect(badge(original)).toHaveCount(0);
    await expect(badge(copie)).toHaveCount(0);
    // Chacun garde ce qu'il avait…
    expect((await exo(page, 'Walking')).links).toHaveLength(1);
    expect((await exo(page, 'Walking (copie)')).fixedNotes).toBe('Consigne');
    // … mais plus rien ne se propage.
    await champTempo(original).fill('120');
    await champTempo(original).press('Enter');
    await expect.poll(async () => (await exo(page, 'Walking')).metronome?.bpm).toBe(120);
    await expect(champTempo(copie)).toHaveValue('');
    expect((await exo(page, 'Walking (copie)')).metronome ?? null).toBeNull();
    await ajouterLien(original, 'https://exemple.fr/2');
    await expect.poll(async () => (await exo(page, 'Walking')).links.length).toBe(2);
    expect((await exo(page, 'Walking (copie)')).links).toHaveLength(1);
  });

  test('fiche repliée : le badge de copie liée reste dans l\'en-tête et ouvre la boîte de liaison', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche([{ titre: 'Walking', ferme: true, extra: { ...lien } }, { titre: 'Walking (copie)', ferme: true, extra: { ...lien } }]) });
    await ouvrirTechnique(page);
    const [original] = await pairesDe(page);
    await expect(original.getByPlaceholder('Coller un lien…')).toBeHidden();
    await expect(badge(original)).toHaveText('1');
    await badge(original).click();
    await expect(page.getByRole('dialog', { name: 'Liaison de « Walking »' })).toBeVisible();
  });
});
