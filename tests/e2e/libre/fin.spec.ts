// MODULE « libre » — FIN de l'entraînement libre et enregistrement de la séance dans le journal. Observé en boîte noire (playwright-cli, 25/11/2026) : le bouton ■ de la barre arrête sans confirmation et
// ouvre « Enregistrer cet entraînement ? » (nom, durée par exercice modifiable, tempo atteint, note, commentaire ; « Ne pas enregistrer », « Enregistrer », « Fermer ») ; sans connexion une 2e
// fenêtre (« Pas connecté à Google ») prévient que la séance restera sur l'appareil. SEUIL : 60 s. En dessous, le message « Entraînement trop court (moins d'une minute) : rien à enregistrer »
// et rien n'est gardé. « Ne pas enregistrer » (avec confirmation) garde la séance 3 jours dans Historique › Non enregistrées (`trainhub.recentRuns.v1`).
// Le journal est `trainhub.log.AAAA-MM` ; la séance libre porte `free: true`, `sessionId: 'free'`.
import { test, expect } from '../support/fixtures';
import {
  arreterEtEnregistrer, arreterLibre, barre, boutonLibre, champNomSeance, demarrerSur, ecouler, enregistrerSeance, etapesJournal, fenetreSeance, journalDuMois, laisserPasser, minutesRecap, nonEnregistrees,
  ouvrirLibre, ouvrirSessions, passerA, resumeRecap, retablirRecap, retirerRecap, ligneRecap, sec, min, secondesRecap, sessionEnCours, tempoRecap, boutonPause,
} from './aide-libre';

/** Séance de 1 min 30 s sur Alpha (puis rien) : assez longue pour être proposée. */
async function seanceLongue(page: any, ouvrirAppli: any) {
  await ouvrirLibre(page, ouvrirAppli);
  await demarrerSur(page, 'Alpha');
  await ecouler(page, min(1) + sec(30));
}
/** Séance de 1 min 30 s sur Alpha puis 40 s sur Bravo. */
async function deuxExercices(page: any, ouvrirAppli: any) {
  await ouvrirLibre(page, ouvrirAppli);
  await demarrerSur(page, 'Alpha');
  await ecouler(page, min(1) + sec(30));
  await passerA(page, 'Bravo');
  await ecouler(page, sec(40));
}
const toast = (page: any, texte: string) => page.locator('.toast').filter({ hasText: texte });

test.describe('Libre : fin et journal @libre', () => {
  test('arrêter après plus d\'une minute : « Enregistrer cet entraînement ? », puis la séance entre dans le journal du mois avec le temps de chaque exercice @critique', async ({ page, ouvrirAppli, garde }) => {
    await deuxExercices(page, ouvrirAppli);
    await arreterLibre(page);
    await expect(fenetreSeance(page)).toBeVisible();
    await expect(fenetreSeance(page)).toContainText('Enregistrer cet entraînement ?');
    await expect(champNomSeance(page)).toHaveAttribute('placeholder', 'Session libre');
    await expect(resumeRecap(page)).toHaveText(/^2 min 1\d s · 2 exercices$/);
    await expect(ligneRecap(page, 'Alpha')).toBeVisible();
    await expect(ligneRecap(page, 'Bravo')).toBeVisible();
    await expect(minutesRecap(page, 'Alpha')).toHaveValue('1');
    await expect(secondesRecap(page, 'Alpha')).toHaveValue(/^(30|31)$/);
    await expect(barre(page)).toBeHidden();
    await expect(boutonLibre(page)).not.toHaveClass(/free-on/);
    expect(await journalDuMois(page)).toHaveLength(0);   // rien n'est écrit tant qu'on n'a pas répondu

    await fenetreSeance(page).getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await laisserPasser(page);
    const avertissement = page.getByRole('dialog', { name: 'Pas connecté à Google' });
    await expect(avertissement).toContainText('Cette séance sera enregistrée sur cet appareil seulement');
    await avertissement.getByRole('button', { name: 'Enregistrer quand même' }).click();
    await laisserPasser(page);
    await expect(fenetreSeance(page)).toBeHidden();

    const seances = await journalDuMois(page);
    expect(seances).toHaveLength(1);
    expect(seances[0]).toMatchObject({ free: true, sessionId: 'free', name: 'Session libre', plannedSec: 0 });
    const etapes = etapesJournal(seances[0]);
    expect(etapes.map(([t]) => t)).toEqual(['Alpha', 'Bravo']);
    expect(etapes[0][1]).toBeGreaterThanOrEqual(90);
    expect(etapes[0][1]).toBeLessThanOrEqual(91);
    expect(etapes[1][1]).toBeGreaterThanOrEqual(40);
    expect(etapes[1][1]).toBeLessThanOrEqual(41);
    expect(seances[0].totalSec).toBe(etapes[0][1] + etapes[1][1]);
    expect(await sessionEnCours(page)).toBeNull();
    await expect(toast(page, 'Entraînement enregistré dans l\'historique')).toContainText('en faire une session ?');
    await expect(toast(page, 'Entraînement enregistré').getByRole('button', { name: 'Créer une session' })).toBeVisible();
    expect(garde.bloquees).toEqual([]);
  });

  test('moins d\'une minute (59 s) : message « trop court », rien dans le journal ni dans « Non enregistrées » @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, sec(59));
    await expect(barre(page).locator('.free-time')).toHaveText('0:59');
    await arreterLibre(page);
    await expect(toast(page, 'Entraînement trop court')).toHaveText("Entraînement trop court (moins d'une minute) : rien à enregistrer.");
    await expect(fenetreSeance(page)).toBeHidden();
    await expect(barre(page)).toBeHidden();
    expect(await journalDuMois(page)).toHaveLength(0);
    expect(await nonEnregistrees(page)).toHaveLength(0);
    expect(await sessionEnCours(page)).toBeNull();
  });

  test('pile une minute (60 s) : la séance est proposée', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, sec(60));
    await arreterLibre(page);
    await expect(fenetreSeance(page)).toBeVisible();
    await expect(resumeRecap(page)).toHaveText(/^1 min 0\d s · 1 exercice$/);
    await expect(toast(page, 'Entraînement trop court')).toHaveCount(0);
  });

  test('« Ne pas enregistrer » demande confirmation ; la séance attend 3 jours dans Historique › Non enregistrées, d\'où on peut l\'enregistrer', async ({ page, ouvrirAppli }) => {
    await seanceLongue(page, ouvrirAppli);
    await arreterLibre(page);
    await fenetreSeance(page).getByRole('button', { name: 'Ne pas enregistrer' }).click();
    await laisserPasser(page);
    const confirmation = page.locator('.app-dialog');
    await expect(confirmation).toContainText('Ne pas enregistrer cette séance ?');
    await expect(confirmation).toContainText(/« Session libre » \(1 min 3\d s\) ne sera ajoutée ni à l'historique ni aux statistiques\./);
    await expect(confirmation).toContainText('Elle reste récupérable pendant 3 jours');
    await confirmation.getByRole('button', { name: "Revenir à l'enregistrement" }).click();
    await laisserPasser(page);
    await expect(fenetreSeance(page)).toBeVisible();
    await fenetreSeance(page).getByRole('button', { name: 'Ne pas enregistrer' }).click();
    await laisserPasser(page);
    await confirmation.getByRole('button', { name: 'Ne pas enregistrer', exact: true }).click();
    await laisserPasser(page);
    await expect(fenetreSeance(page)).toBeHidden();
    await expect(toast(page, 'Séance non enregistrée')).toContainText('Historique › Non enregistrées');
    expect(await journalDuMois(page)).toHaveLength(0);
    expect(await sessionEnCours(page)).toBeNull();
    const refusees = await nonEnregistrees(page);
    expect(refusees).toHaveLength(1);
    expect(refusees[0].record).toMatchObject({ free: true, name: 'Session libre' });

    await toast(page, 'Séance non enregistrée').getByRole('button', { name: 'Voir' }).click();
    await laisserPasser(page);
    const histo = page.locator('.gs-history-panel');
    await expect(histo).toContainText('Non enregistrées (1)');
    await expect(histo).toContainText(/Alpha \(1 min 3\d s\)/);
    await histo.getByRole('button', { name: 'Enregistrer…' }).click();
    await laisserPasser(page);
    await expect(fenetreSeance(page)).toBeVisible();
    await enregistrerSeance(page);
    const [s] = await journalDuMois(page);
    expect(s).toMatchObject({ free: true, name: 'Session libre' });
    expect(etapesJournal(s)[0][0]).toBe('Alpha');
  });

  test('nom, note, commentaire et durée corrigés dans la fenêtre de fin sont gardés avec la séance', async ({ page, ouvrirAppli }) => {
    await deuxExercices(page, ouvrirAppli);
    await arreterLibre(page);
    await champNomSeance(page).fill('Soirée basse');
    await fenetreSeance(page).getByRole('radio', { name: /^4 sur 5/ }).click();
    await fenetreSeance(page).getByRole('textbox', { name: 'Commentaire sur la séance' }).fill('Bravo trop court');
    await minutesRecap(page, 'Alpha').fill('3');
    await secondesRecap(page, 'Alpha').fill('0');
    await expect(resumeRecap(page)).toContainText(/^3 min 4\d s · 2 exercices$/);
    await enregistrerSeance(page);
    const [s] = await journalDuMois(page);
    expect(s).toMatchObject({ name: 'Soirée basse', rating: 4, comment: 'Bravo trop court', free: true });
    const etapes = etapesJournal(s);
    expect(etapes[0]).toEqual(['Alpha', 180]);
    expect(etapes[1][1]).toBeGreaterThanOrEqual(40);
    expect(s.totalSec).toBe(180 + etapes[1][1]);
  });

  test('retirer un exercice (✕) de la fenêtre de fin : il n\'entre pas dans le journal', async ({ page, ouvrirAppli }) => {
    await deuxExercices(page, ouvrirAppli);
    await arreterLibre(page);
    await retirerRecap(page, 'Bravo').click();
    await expect(retablirRecap(page, 'Bravo')).toBeVisible();   // la ligne reste, barrée, avec un bouton ↶
    await expect(minutesRecap(page, 'Bravo')).toBeDisabled();
    await expect(resumeRecap(page)).toContainText(/ · 1 exercice · 1 retiré \(↶ ou Ctrl\+Z pour rétablir\)$/);
    await enregistrerSeance(page);
    const [s] = await journalDuMois(page);
    expect(etapesJournal(s).map(([t]) => t)).toEqual(['Alpha']);
    expect(s.totalSec).toBe(etapesJournal(s)[0][1]);
  });

  test('un exercice retiré par mégarde se rétablit avec Ctrl+Z', async ({ page, ouvrirAppli }) => {
    await deuxExercices(page, ouvrirAppli);
    await arreterLibre(page);
    await retirerRecap(page, 'Bravo').click();
    await expect(retablirRecap(page, 'Bravo')).toBeVisible();
    await page.keyboard.press('Control+z');
    await expect(retablirRecap(page, 'Bravo')).toBeHidden();
    await expect(minutesRecap(page, 'Bravo')).toBeEnabled();
    await expect(resumeRecap(page)).toHaveText(/ · 2 exercices$/);
    await enregistrerSeance(page);
    const [s] = await journalDuMois(page);
    expect(etapesJournal(s).map(([t]) => t)).toEqual(['Alpha', 'Bravo']);
  });

  test('deux séances libres le même jour s\'ajoutent à la même entrée du journal (comportement observé : une « Session libre » par jour)', async ({ page, ouvrirAppli }) => {
    await seanceLongue(page, ouvrirAppli);
    await arreterEtEnregistrer(page);
    expect(await journalDuMois(page)).toHaveLength(1);
    const premiere = (await journalDuMois(page))[0];
    // Deuxième séance, un peu plus tard le même jour, sur un autre exercice.
    await ecouler(page, min(1));
    await demarrerSur(page, 'Bravo');
    await ecouler(page, sec(70));
    await arreterEtEnregistrer(page);
    const seances = await journalDuMois(page);
    expect(seances).toHaveLength(1);
    expect(seances[0].id).toBe(premiere.id);
    expect(etapesJournal(seances[0]).map(([t]) => t)).toEqual(['Alpha', 'Bravo']);
    expect(seances[0].totalSec).toBeGreaterThanOrEqual(premiere.totalSec + 70);
    expect(seances[0].totalSec).toBeLessThanOrEqual(premiere.totalSec + 71);
  });

  test('l\'entraînement libre peut être relancé juste après un enregistrement, avec un chrono remis à zéro', async ({ page, ouvrirAppli }) => {
    await seanceLongue(page, ouvrirAppli);
    await arreterEtEnregistrer(page);
    await expect(barre(page)).toBeHidden();
    await demarrerSur(page, 'Bravo');
    await ecouler(page, sec(5));
    await expect(barre(page).locator('.free-time')).toHaveText('0:05');
    const live = await sessionEnCours(page);
    expect(live.steps.map((s: any) => s.exerciseId)).toEqual(['ex-bravo']);
  });
});
