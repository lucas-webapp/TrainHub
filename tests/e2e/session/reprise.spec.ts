// MODULE « session » — REPRISE après une fermeture brutale. Observé en boîte noire (playwright-cli, 25/11/2026) : la session en cours est sauvegardée en continu
// (`trainhub.gsLive.v1`) ; si on recharge la page (ou si le navigateur plante), l'appli ouvre « Séance interrompue » avec quatre choix : Reprendre, Plus tard,
// Enregistrer, Abandonner… (confirmation). Un vrai plantage ne se joue pas ici : on recharge la page (même état de stockage).
import { test, expect } from '../support/fixtures';
import { avancer, chrono, etatSession, journalDuMois, lancerDepuisListe, minutes, ouvrirSessions, secondes, sessionEnCours, suivant, titreExercice, rangExercice, fenetreSeance, totalChrono, ouvrirAvecHorloge, laisserPasser } from './aide-session';

const EXOS = ['Alpha', 'Bravo', 'Charlie'];
const grille = () => etatSession(EXOS, [{ nom: 'Grille', exercices: [['Alpha', 6], ['Bravo', 5], ['Charlie', 4]] }]);
const boite = (page: any) => page.getByRole('dialog', { name: 'Séance interrompue' });

/** Lance la session, passe à Bravo, laisse courir un peu, puis « ferme brutalement » (rechargement de la page). */
async function interrompre(page: any, ouvrirAppli: any) {
  await page.clock.install({ time: new Date('2026-11-25T10:00:00+01:00') });
  await ouvrirAppli({ etat: grille(), accueil: 'jamais' });
  await ouvrirSessions(page);
  await lancerDepuisListe(page, 'Grille');
  await suivant(page).click();
  await expect(titreExercice(page)).toHaveText('Bravo');
  await expect.poll(async () => (await sessionEnCours(page))?.stepIndex).toBe(1);
  await page.clock.fastForward(minutes(2));   // un moment passe avant la « fermeture brutale »
  await page.reload();
}

test.describe('Session : reprise après fermeture brutale @session', () => {
  test('recharger en pleine session propose de la reprendre ; « Reprendre » revient sur le bon exercice avec le temps déjà passé @critique', async ({ page, ouvrirAppli, garde }) => {
    await interrompre(page, ouvrirAppli);
    await expect(boite(page)).toBeVisible();
    await expect(boite(page)).toContainText('Grille');
    await boite(page).getByRole('button', { name: 'Reprendre', exact: true }).click();
    await expect(chrono(page)).toBeVisible();
    await expect(titreExercice(page)).toHaveText('Bravo');
    await expect(rangExercice(page)).toHaveText(/Exercice 2 \/ 3/i);
    await expect(totalChrono(page)).toHaveText(/^Total \d+:\d\d$/);
    expect(await sessionEnCours(page)).not.toBeNull();
    expect(garde.bloquees).toEqual([]);
  });

  test('« Plus tard » laisse la session en réserve : la proposition revient au prochain chargement', async ({ page, ouvrirAppli }) => {
    await interrompre(page, ouvrirAppli);
    await boite(page).getByRole('button', { name: 'Plus tard' }).click();
    await expect(boite(page)).toBeHidden();
    expect(await sessionEnCours(page)).not.toBeNull();
    await page.reload();
    await expect(boite(page)).toBeVisible();
  });

  test('« Abandonner… » demande confirmation puis efface la session en cours sans rien écrire dans le journal', async ({ page, ouvrirAppli }) => {
    await interrompre(page, ouvrirAppli);
    await boite(page).getByRole('button', { name: 'Abandonner…' }).click();
    const confirmation = page.getByRole('dialog').filter({ hasNotText: 'Séance interrompue' }).last();
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: /^(Abandonner|Supprimer|Oui)/ }).click();
    await expect.poll(() => sessionEnCours(page)).toBeNull();
    expect(await journalDuMois(page)).toHaveLength(0);
    await page.reload();
    await expect(boite(page)).toHaveCount(0);
  });

  test('« Enregistrer » ouvre l\'enregistrement de la séance interrompue, puis la reprise ne revient plus', async ({ page, ouvrirAppli }) => {
    await interrompre(page, ouvrirAppli);
    await boite(page).getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(fenetreSeance(page)).toBeVisible();
    await expect(fenetreSeance(page)).toContainText('Grille');
  });
});
