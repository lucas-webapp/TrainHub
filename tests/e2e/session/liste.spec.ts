// MODULE « session » (lot 2) — LISTE DES SESSIONS : onglets (« Éphémères », onglets personnalisés), filtre de durée, tri, sélection multiple. Observé en boîte noire (playwright-cli,
// 25/11/2026) : « + Onglet » demande un nom et crée un onglet vide ; une session s'y range par la barre de sélection (« Onglet… ») ; « Durée : toutes » ouvre un réglage Min / Max (minutes) ;
// « ⇅ Tri » propose dix ordres ; « ☑ Sélectionner (plusieurs) » (menu clic droit) ouvre la barre « N sessions sélectionnées » (Archiver, Onglet…, Supprimer…, Tout, ✕).
import { test, expect } from '../support/fixtures';
import { actionSession, etatSession, ligneSession, nomsSessions, ongletListe, ouvrirSessions, sessionsEnregistrees, lireEtat } from './aide-session';
import { confirmer } from '../bibliotheque/aide-bibliotheque';

const EXOS = ['Alpha', 'Bravo'];
const trois = (extra: any[] = []) => etatSession(EXOS, [
  { nom: 'Courte', exercices: [['Alpha', 10]] },
  { nom: 'Moyenne', exercices: [['Alpha', 40]] },
  { nom: 'Longue', exercices: [['Alpha', 70]] },
  ...extra,
]);
const durée = (page: any) => page.getByRole('button', { name: /^Durée/ });

test.describe('Session : liste, onglets, filtre, tri, sélection @session', () => {
  test('un onglet personnalisé : créé par « + Onglet », rempli par la barre de sélection, renommé puis supprimé sans perdre les sessions @critique', async ({ ouvrirAppli, page }) => {
    await ouvrirAppli({ etat: trois(), accueil: 'jamais' });
    await ouvrirSessions(page);
    await page.getByRole('button', { name: '+ Onglet' }).click();
    const boite = page.locator('.app-dialog');
    await expect(boite).toContainText('Nouvel onglet');
    await boite.getByRole('textbox').fill('Échauffements');
    await boite.getByRole('button', { name: 'Créer' }).click();
    const onglet = ongletListe(page, /^Échauffements/);
    await expect(onglet).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(/Onglet vide/)).toBeVisible();
    expect((await lireEtat(page)).settings.sessionFolders.map((f: any) => f.name)).toEqual(['Échauffements']);

    // Ranger deux sessions dans l'onglet : sélection multiple puis « Onglet… ».
    await ongletListe(page, /^Tout/).click();
    await actionSession(page, 'Courte', /Sélectionner/);
    await ligneSession(page, 'Moyenne').locator('.gs-session-name').click();
    await expect(page.getByText('2 sessions sélectionnées')).toBeVisible();
    await page.getByRole('button', { name: 'Onglet…' }).click();
    await page.getByRole('button', { name: /Onglet « Échauffements »/ }).click();
    await expect(onglet).toContainText('2');
    await onglet.click();
    await expect.poll(async () => (await nomsSessions(page)).sort()).toEqual(['Courte', 'Moyenne']);
    expect((await lireEtat(page)).settings.guidedSessions.filter((s: any) => s.tabIds.length).map((s: any) => s.name).sort()).toEqual(['Courte', 'Moyenne']);

    // Renommer l'onglet, puis le supprimer : les sessions restent dans « Tout ».
    await page.getByTitle("Renommer l'onglet").click();
    await boite.getByRole('textbox').fill('Routine');
    await boite.getByRole('button', { name: 'Renommer' }).click();
    await expect(ongletListe(page, /^Routine/)).toHaveAttribute('aria-selected', 'true');
    expect((await lireEtat(page)).settings.sessionFolders.map((f: any) => f.name)).toEqual(['Routine']);
    await page.getByTitle(/^Supprimer l'onglet/).click();
    await confirmer(page, /Supprimer/);
    await expect(ongletListe(page, /^Routine/)).toHaveCount(0);
    await ongletListe(page, /^Tout/).click();
    await expect.poll(async () => (await sessionsEnregistrees(page)).length).toBe(3);
  });

  test('le filtre de durée garde les sessions entre Min et Max ; « Réinitialiser » les rend toutes', async ({ ouvrirAppli, page }) => {
    await ouvrirAppli({ etat: trois(), accueil: 'jamais' });
    await ouvrirSessions(page);
    await expect(durée(page)).toHaveText('Durée : toutes');
    await durée(page).click();
    const fenetre = page.getByText('Durée de la session', { exact: true }).locator('xpath=..');
    const champs = fenetre.locator('input');
    await champs.nth(0).fill('20');
    await champs.nth(0).press('Tab');
    await expect(durée(page)).toHaveText('Durée : ≥ 20 min');
    await expect.poll(() => nomsSessions(page)).toEqual(['Moyenne', 'Longue']);
    await champs.nth(1).fill('50');
    await champs.nth(1).press('Tab');
    await expect(durée(page)).toHaveText('Durée : 20 – 50 min');
    await expect.poll(() => nomsSessions(page)).toEqual(['Moyenne']);
    await fenetre.getByRole('button', { name: 'Réinitialiser' }).click();
    await expect.poll(() => nomsSessions(page)).toEqual(['Courte', 'Moyenne', 'Longue']);
    await expect(durée(page)).toHaveText('Durée : toutes');
  });

  test('le tri change l\'ordre de la liste : durée, A → Z, Z → A, puis retour à l\'ordre manuel', async ({ ouvrirAppli, page }) => {
    await ouvrirAppli({ etat: trois(), accueil: 'jamais' });
    await ouvrirSessions(page);
    const trier = async (ordre: string) => { await page.getByRole('button', { name: /^⇅/ }).click(); await page.getByRole('button', { name: ordre }).last().click(); };
    await expect.poll(() => nomsSessions(page)).toEqual(['Courte', 'Moyenne', 'Longue']);
    await trier("Durée : longues d'abord");
    await expect.poll(() => nomsSessions(page)).toEqual(['Longue', 'Moyenne', 'Courte']);
    await trier("Durée : courtes d'abord");
    await expect.poll(() => nomsSessions(page)).toEqual(['Courte', 'Moyenne', 'Longue']);
    await trier('A → Z');
    await expect.poll(() => nomsSessions(page)).toEqual(['Courte', 'Longue', 'Moyenne']);
    await trier('Z → A');
    await expect.poll(() => nomsSessions(page)).toEqual(['Moyenne', 'Longue', 'Courte']);
    await trier('Ordre manuel');
    await expect.poll(() => nomsSessions(page)).toEqual(['Courte', 'Moyenne', 'Longue']);
  });

  test('sélection multiple : la barre compte les sessions, « Archiver » les range, « Supprimer… » les envoie à la corbeille, ✕ quitte la sélection', async ({ ouvrirAppli, page }) => {
    await ouvrirAppli({ etat: trois(), accueil: 'jamais' });
    await ouvrirSessions(page);
    await actionSession(page, 'Courte', /Sélectionner/);
    await expect(page.getByText('1 session sélectionnée')).toBeVisible();
    await page.getByRole('button', { name: 'Tout', exact: true }).click();
    await expect(page.getByText('3 sessions sélectionnées')).toBeVisible();
    await ligneSession(page, 'Longue').locator('.gs-session-name').click();   // un clic sur une ligne la retire de la sélection
    await expect(page.getByText('2 sessions sélectionnées')).toBeVisible();
    await page.getByRole('button', { name: 'Archiver', exact: true }).click();
    await expect.poll(async () => (await sessionsEnregistrees(page)).filter((s) => s.archivee).map((s) => s.nom).sort()).toEqual(['Courte', 'Moyenne']);
    await expect.poll(() => nomsSessions(page)).toEqual(['Longue']);

    await actionSession(page, 'Longue', /Sélectionner/);
    await page.getByRole('button', { name: 'Supprimer…' }).click();
    await confirmer(page);
    await expect.poll(() => nomsSessions(page)).toEqual([]);
    expect((await lireEtat(page)).settings.trash.map((t: any) => [t.type, t.data.name])).toEqual([['session', 'Longue']]);
  });
});
