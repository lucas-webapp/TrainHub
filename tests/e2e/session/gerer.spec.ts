// MODULE « session » — GÉRER la liste des sessions : rouvrir, renommer, dupliquer, archiver, supprimer (corbeille, Annuler), onglets, filtre de durée. Observé en boîte noire
// (playwright-cli, 25/11/2026) : le clic droit (appui long au téléphone) d'une ligne ouvre un menu (Lancer, Modifier les exercices, Renommer…, Dupliquer, Programmer au
// calendrier…, Archiver, tris, Supprimer…) ; supprimer envoie la session à la corbeille avec son planning ; une copie n'emporte ni note ni commentaire.
import { test, expect } from '../support/fixtures';
import {
  actionSession, ajouterExercice, champNom, etapes, etatSession, ligneSession, lignesSessions, ongletListe, rondExercice, ouvrirSessions, sessionsEnregistrees, sessionEnregistree, lireEtat, boutonEnregistrer,
} from './aide-session';
import { confirmer } from '../bibliotheque/aide-bibliotheque';

const EXOS = ['Alpha', 'Bravo', 'Charlie'];
const deux = () => etatSession(EXOS, [
  { nom: 'Grille', exercices: [['Alpha', 6], ['Bravo', 5]], note: 4, commentaire: 'Bon enchaînement' },
  { nom: 'Courte', exercices: [['Charlie', 3]] },
]);

test.describe('Session : gérer la liste @session', () => {
  test('la liste montre nom, note, effectif et durée ; un clic sur le nom rouvre la session dans l\'éditeur @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: deux() });
    await ouvrirSessions(page);
    await expect(lignesSessions(page)).toHaveCount(2);
    await expect(ligneSession(page, 'Grille')).toContainText('2 exercices · 11 min');
    await expect(ligneSession(page, 'Grille')).toContainText('Bon enchaînement');
    await expect(ligneSession(page, 'Grille').getByRole('radio', { name: /^4 sur 5/ })).toBeChecked();
    await expect(ligneSession(page, 'Courte')).toContainText('1 exercice · 3 min');
    await expect(ongletListe(page, /^Tout/)).toContainText('2');
    await ligneSession(page, 'Grille').locator('.gs-session-name').click();
    await expect(champNom(page)).toHaveValue('Grille');
    await expect(boutonEnregistrer(page)).toHaveText('Enregistré');
  });

  test('Renommer…, Dupliquer : le nom change ; la copie arrive avec ses exercices mais sans note ni commentaire', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: deux() });
    await ouvrirSessions(page);
    await actionSession(page, 'Grille', 'Dupliquer');
    await expect(ligneSession(page, 'Grille (copie)')).toBeVisible();
    expect(await sessionEnregistree(page, 'Grille (copie)')).toMatchObject({ exercices: ['Alpha', 'Bravo'], minutes: [6, 5], note: undefined, commentaire: undefined });
    expect(await sessionEnregistree(page, 'Grille')).toMatchObject({ note: 4, commentaire: 'Bon enchaînement' });

    await actionSession(page, 'Courte', 'Renommer…');
    const champ = page.getByRole('dialog').getByRole('textbox');
    await expect(champ).toHaveValue('Courte');
    await champ.fill('Éclair');
    await page.getByRole('dialog').getByRole('button', { name: /^(OK|Renommer|Enregistrer|Valider)$/ }).click();
    await expect(ligneSession(page, 'Éclair')).toBeVisible();
    await expect.poll(async () => (await sessionsEnregistrees(page)).map((s) => s.nom)).toEqual(['Grille', 'Éclair', 'Grille (copie)']);
  });

  test('supprimer demande confirmation, envoie la session à la corbeille, et « Annuler » la ramène @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: deux() });
    await ouvrirSessions(page);
    await actionSession(page, 'Courte', 'Supprimer…');
    const boite = page.getByRole('dialog', { name: /Supprimer « Courte » \?/ });
    await expect(boite).toContainText('Récupérable dans la corbeille');
    await boite.getByRole('button', { name: 'Annuler' }).click();
    await expect(ligneSession(page, 'Courte')).toBeVisible();

    await actionSession(page, 'Courte', 'Supprimer…');
    await confirmer(page);
    await expect(ligneSession(page, 'Courte')).toHaveCount(0);
    await expect.poll(async () => (await sessionsEnregistrees(page)).map((s) => s.nom)).toEqual(['Grille']);
    const corbeille = (await lireEtat(page)).settings.trash;
    expect(corbeille.map((t: any) => [t.type, t.data.name])).toEqual([['session', 'Courte']]);
    await page.locator('.toast').filter({ hasText: /mise à la corbeille/ }).getByRole('button', { name: 'Annuler' }).click();
    await expect(ligneSession(page, 'Courte')).toBeVisible();
    await expect.poll(async () => (await sessionsEnregistrees(page)).map((s) => s.nom).sort()).toEqual(['Courte', 'Grille']);
  });

  test('archiver masque la session de la liste sans la perdre : elle est dans l\'onglet « Archivées »', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: deux() });
    await ouvrirSessions(page);
    await ligneSession(page, 'Courte').getByRole('button', { name: /^Archiver cette session/ }).click();
    await expect(ligneSession(page, 'Courte')).toHaveCount(0);
    expect((await sessionEnregistree(page, 'Courte'))?.archivee).toBe(true);
    await expect(ongletListe(page, /^Archivées/)).toBeVisible();
    await ongletListe(page, /^Archivées/).click();
    await expect(ligneSession(page, 'Courte')).toBeVisible();
    await expect(ligneSession(page, 'Grille')).toHaveCount(0);
  });

  test('« Modifier les exercices » du menu ouvre la session dans l\'éditeur, d\'où « + Ajouter un exercice » rouvre le choix avec les exercices déjà numérotés', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: deux() });
    await ouvrirSessions(page);
    await actionSession(page, 'Grille', 'Modifier les exercices');
    await expect(champNom(page)).toHaveValue('Grille');
    await expect(etapes(page)).toHaveCount(2);
    await ajouterExercice(page).click();
    await expect(page.getByRole('complementary', { name: 'Ma session' })).toContainText('11 min');
    await page.getByRole('button', { name: 'Tout déplier' }).click();
    await expect(rondExercice(page, 'Alpha')).toHaveAccessibleName('1 Alpha');
    await expect(rondExercice(page, 'Charlie')).toHaveAccessibleName('Pas encore dans la session Charlie');
  });
});
