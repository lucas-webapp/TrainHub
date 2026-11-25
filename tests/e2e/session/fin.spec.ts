// MODULE « session » — FIN de session et enregistrement de la séance dans le journal. Observé en boîte noire (playwright-cli, 25/11/2026) : « Arrêter la session » demande
// confirmation (« Continuer » / « Arrêter la session ») puis ouvre le panneau « Enregistrer cette séance ? » (temps par exercice modifiable, note, commentaire ; « Ne pas
// enregistrer », « Enregistrer », « Fermer ») ; sans connexion une 2e confirmation prévient que la séance restera sur l'appareil (« Enregistrer quand même »). La séance entre
// dans `trainhub.log.AAAA-MM` ; la session en cours (`trainhub.gsLive.v1`) disparaît.
import { test, expect } from '../support/fixtures';
import {
  arreter, arreterSession, avancer, chrono, enregistrerSeance, etatSession, fenetreSeance, journalDuMois, lancerDepuisListe, laisserPasser, minutes, ouvrirAvecHorloge, ouvrirSessions, secondes, sessionEnCours,
  suivant, titreEcran, titreExercice,
} from './aide-session';

const EXOS = ['Alpha', 'Bravo', 'Charlie'];
const grille = () => etatSession(EXOS, [{ nom: 'Grille', exercices: [['Alpha', 6], ['Bravo', 5], ['Charlie', 4]] }]);
/** Séance de 11 minutes (assez longue pour que l'appli propose de l'enregistrer d'elle-même) : 7 min sur Alpha (prévu 6), 4 min sur Bravo (prévu 5). */
async function arretLong(page: any, ouvrirAppli: any) {
  await ouvrirAvecHorloge(page, ouvrirAppli, { etat: grille() });
  await ouvrirSessions(page);
  await lancerDepuisListe(page, 'Grille');
  await avancer(page, minutes(7));
  await suivant(page).click();
  await avancer(page, minutes(4));
  await arreterSession(page);
}
/** Séance de 3 min 15 s : l'appli ne la propose pas, elle va dans « Non enregistrées ». */
async function arretCourt(page: any, ouvrirAppli: any) {
  await ouvrirAvecHorloge(page, ouvrirAppli, { etat: grille() });
  await ouvrirSessions(page);
  await lancerDepuisListe(page, 'Grille');
  await avancer(page, minutes(2) + secondes(30));
  await suivant(page).click();
  await avancer(page, secondes(45));
  await arreter(page).click();
  await page.getByRole('dialog', { name: 'Arrêter la session ?' }).getByRole('button', { name: 'Arrêter la session' }).click();
  await laisserPasser(page);
}

test.describe('Session : fin et journal @session', () => {
  test('arrêter puis enregistrer : la séance entre dans le journal du mois avec le temps passé par exercice, la session en cours disparaît @critique', async ({ page, ouvrirAppli, garde }) => {
    await arretLong(page, ouvrirAppli);
    await expect(fenetreSeance(page)).toContainText(/Enregistrer cette (session|séance) \?/);
    await expect(fenetreSeance(page)).toContainText('Grille');
    await expect(fenetreSeance(page)).toContainText(/11 min/);
    await expect(fenetreSeance(page)).toContainText('2 exercices');
    await expect(fenetreSeance(page).getByText('Alpha')).toBeVisible();
    await enregistrerSeance(page);

    const seances = await journalDuMois(page);
    expect(seances).toHaveLength(1);
    expect(seances[0]).toMatchObject({ name: 'Grille', totalSec: 660, plannedSec: 660 });
    expect(seances[0].steps.map((s: any) => [s.title, s.actualSec])).toEqual([['Alpha', 420], ['Bravo', 240]]);
    expect(await sessionEnCours(page)).toBeNull();
    expect(garde.bloquees).toEqual([]);
  });

  test('« Ne pas enregistrer » demande confirmation, ne touche pas au journal, et la séance reste récupérable dans Historique › Non enregistrées', async ({ page, ouvrirAppli }) => {
    await arretLong(page, ouvrirAppli);
    await fenetreSeance(page).getByRole('button', { name: 'Ne pas enregistrer' }).click();
    await laisserPasser(page);
    const confirmation = page.locator('.app-dialog');
    await expect(confirmation).toContainText('Ne pas enregistrer cette séance ?');
    await expect(confirmation).toContainText('Elle reste récupérable pendant 3 jours');
    await confirmation.getByRole('button', { name: "Revenir à l'enregistrement" }).click();
    await laisserPasser(page);
    await expect(fenetreSeance(page)).toBeVisible();
    await fenetreSeance(page).getByRole('button', { name: 'Ne pas enregistrer' }).click();
    await laisserPasser(page);
    await confirmation.getByRole('button', { name: 'Ne pas enregistrer', exact: true }).click();
    await laisserPasser(page);
    await expect(fenetreSeance(page)).toBeHidden();
    await expect(chrono(page)).toBeHidden();
    await expect(titreEcran(page)).toBeVisible();
    expect(await journalDuMois(page)).toHaveLength(0);
    expect(await sessionEnCours(page)).toBeNull();
    await page.getByRole('button', { name: /^Historique/ }).click();
    await laisserPasser(page);
    await expect(page.locator('.gs-history-panel')).toContainText('Non enregistrées (1)');
  });

  test('« Continuer » dans la confirmation reprend la session là où elle en était', async ({ page, ouvrirAppli }) => {
    await ouvrirAvecHorloge(page, ouvrirAppli, { etat: grille() });
    await ouvrirSessions(page);
    await lancerDepuisListe(page, 'Grille');
    await avancer(page, secondes(30));
    await arreter(page).click();
    const boite = page.getByRole('dialog', { name: 'Arrêter la session ?' });
    await expect(boite).toContainText("Tu pourras ensuite l'enregistrer dans l'historique.");
    await boite.getByRole('button', { name: 'Continuer' }).click();
    await expect(boite).toBeHidden();
    await expect(titreExercice(page)).toHaveText('Alpha');
    await avancer(page, secondes(30));
    await expect(chrono(page)).toHaveText('05:00');
  });

  test('la note et le commentaire donnés en fin de séance sont gardés avec elle', async ({ page, ouvrirAppli }) => {
    await arretLong(page, ouvrirAppli);
    await fenetreSeance(page).getByRole('radio', { name: /^4 sur 5/ }).click();
    await fenetreSeance(page).getByRole('textbox').fill('Trop court sur Alpha');
    await enregistrerSeance(page);
    const [s] = await journalDuMois(page);
    expect(s.rating).toBe(4);
    expect(s.comment).toBe('Trop court sur Alpha');
  });

  test('une séance de moins de 10 minutes n\'est pas proposée : un message l\'indique et elle attend dans Historique › Non enregistrées, où on peut l\'enregistrer @critique', async ({ page, ouvrirAppli }) => {
    await arretCourt(page, ouvrirAppli);
    await expect(fenetreSeance(page)).toBeHidden();
    const message = page.locator('.toast').filter({ hasText: 'Séance non enregistrée' });
    await expect(message).toContainText('Historique › Non enregistrées');
    expect(await journalDuMois(page)).toHaveLength(0);
    await message.getByRole('button', { name: 'Voir' }).click();
    await laisserPasser(page);
    const histo = page.locator('.gs-history-panel');
    await expect(histo).toContainText('Non enregistrées (1)');
    await expect(histo).toContainText('Moins de 10 min');
    await expect(histo).toContainText('Alpha (2 min 30 s) · Bravo (0 min 45 s)');
    await histo.getByRole('button', { name: 'Enregistrer…' }).click();
    await laisserPasser(page);
    await expect(fenetreSeance(page)).toBeVisible();
    await enregistrerSeance(page);
    const [s] = await journalDuMois(page);
    expect(s).toMatchObject({ name: 'Grille', totalSec: 195 });
    expect(s.steps.map((x: any) => [x.title, x.actualSec])).toEqual([['Alpha', 150], ['Bravo', 45]]);
    await expect(histo).toContainText('Grille');
  });

  test('sur le dernier exercice le bouton devient « Terminer » : il met fin à la session', async ({ page, ouvrirAppli }) => {
    await ouvrirAvecHorloge(page, ouvrirAppli, { etat: grille() });
    await ouvrirSessions(page);
    await lancerDepuisListe(page, 'Grille');
    await suivant(page).click();
    await suivant(page).click();
    await expect(titreExercice(page)).toHaveText('Charlie');
    await avancer(page, minutes(1));
    await expect(suivant(page)).toBeHidden();
    await page.getByRole('button', { name: 'Terminer', exact: true }).click();
    await laisserPasser(page);
    await expect(chrono(page)).toBeHidden();
    await expect(titreEcran(page)).toBeVisible();
    await expect(page.locator('.toast').filter({ hasText: 'Séance non enregistrée' })).toBeVisible();
  });
});
