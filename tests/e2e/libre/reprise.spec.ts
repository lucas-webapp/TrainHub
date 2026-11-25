// MODULE « libre » — REPRISE après une fermeture brutale. Observé en boîte noire (playwright-cli, 25/11/2026) : l'entraînement libre est sauvegardé en continu (`trainhub.gsLive.v1`, `kind: 'free'`) ;
// si la page se recharge (plantage, onglet fermé) pendant une séance d'au moins 60 s, l'appli ouvre « Séance interrompue » (« Session libre » · N min de pratique) avec Abandonner…, Plus tard,
// Enregistrer, Reprendre. Si la fenêtre de fin était ouverte, c'est « Séance non enregistrée » (sans « Reprendre »). Avant 60 s rien n'est proposé. Un vrai plantage ne se joue pas ici :
// on recharge la page (même stockage). « Reprendre » rouvre l'exercice et repasse par le décompte de 10 s.
import { test, expect } from '../support/fixtures';
import {
  arreterLibre, barre, boutonPause, chrono, demarrerSur, ecouler, enregistrerSeance, etapesJournal, fenetreSeance, journalDuMois, laisserPasser, ligneDepart, nonEnregistrees, ouvrirLibre, sec, min,
  secondesChrono, sessionEnCours, tempsPuce, verifierEtat, attendreTempsPasse, idPas, boutonLibre, recharger, champNomSeance, resumeRecap,
} from './aide-libre';

const interrompue = (page: any) => page.getByRole('dialog', { name: 'Séance interrompue' });
const nonEnregistree = (page: any) => page.getByRole('dialog', { name: 'Séance non enregistrée' });

/** Séance libre sur Alpha de `duree` ms, sauvegardée (on attend que la sauvegarde ait suivi), puis « fermeture brutale » = rechargement. */
async function interrompre(page: any, ouvrirAppli: any, duree = min(1) + sec(20)) {
  await ouvrirLibre(page, ouvrirAppli);
  await demarrerSur(page, 'Alpha');
  await ecouler(page, duree);
  await attendreTempsPasse(page, idPas('Alpha'), duree - sec(5));
  await recharger(page);
}

test.describe('Libre : reprise après fermeture brutale @libre', () => {
  test('recharger en pleine séance propose de la reprendre ; « Reprendre » rouvre l\'exercice et le chrono repart du temps déjà passé @critique', async ({ page, ouvrirAppli, garde }) => {
    await interrompre(page, ouvrirAppli);
    await expect(interrompue(page)).toBeVisible();
    await expect(interrompue(page)).toContainText(/« Session libre » · 1 min \d+ s de pratique/);
    await expect(interrompue(page)).toContainText('Plus tard : tu pourras la retrouver au prochain lancement.');
    await expect(barre(page)).toBeHidden();   // en attendant la réponse, rien ne court
    await interrompue(page).getByRole('button', { name: 'Reprendre', exact: true }).click();
    await laisserPasser(page);
    await expect(barre(page)).toBeVisible();
    await expect(ligneDepart(page, 'Alpha')).not.toHaveClass(/collapsed/);   // l'exercice est de nouveau affiché
    await expect(boutonLibre(page)).toHaveClass(/free-on/);
    const repris = await secondesChrono(page);
    expect(repris).toBeGreaterThanOrEqual(80 - 6);
    expect(repris).toBeLessThanOrEqual(81);
    await verifierEtat(page, 'wait');   // le décompte de 10 s repart avant de recompter
    await ecouler(page, sec(10));
    await verifierEtat(page, 'run');
    await ecouler(page, sec(10));
    const apres = await secondesChrono(page);
    expect(apres).toBeGreaterThanOrEqual(repris + 10);
    expect(apres).toBeLessThanOrEqual(repris + 11);
    await expect(tempsPuce(page, 'Alpha')).toHaveText(await chrono(page).innerText());
    expect(garde.bloquees).toEqual([]);
  });

  test('« Plus tard » laisse la séance en réserve : la proposition revient au prochain chargement', async ({ page, ouvrirAppli }) => {
    await interrompre(page, ouvrirAppli);
    await interrompue(page).getByRole('button', { name: 'Plus tard' }).click();
    await expect(interrompue(page)).toBeHidden();
    await expect(barre(page)).toBeHidden();
    expect(await sessionEnCours(page)).toMatchObject({ kind: 'free' });
    await recharger(page);
    await expect(interrompue(page)).toBeVisible();
  });

  test('« Abandonner… » demande confirmation, puis la séance quitte la reprise sans entrer au journal (elle reste 3 jours dans « Non enregistrées »)', async ({ page, ouvrirAppli }) => {
    await interrompre(page, ouvrirAppli);
    await interrompue(page).getByRole('button', { name: 'Abandonner…' }).click();
    const confirmation = page.getByRole('dialog', { name: 'Abandonner cette séance ?' });
    await expect(confirmation).toContainText('Elle ne sera pas enregistrée, mais tu pourras la retrouver pendant 3 jours dans Historique › Non enregistrées.');
    await confirmation.getByRole('button', { name: 'Annuler' }).click();
    await expect(confirmation).toBeHidden();
    await expect(interrompue(page)).toBeVisible();   // Annuler = on revient au choix
    await interrompue(page).getByRole('button', { name: 'Abandonner…' }).click();
    await confirmation.getByRole('button', { name: 'Abandonner', exact: true }).click();
    await expect.poll(() => sessionEnCours(page)).toBeNull();
    expect(await journalDuMois(page)).toHaveLength(0);
    const refusees = await nonEnregistrees(page);
    expect(refusees).toHaveLength(1);
    expect(refusees[0].record).toMatchObject({ free: true });
    await recharger(page);
    await expect(interrompue(page)).toHaveCount(0);
  });

  test('« Enregistrer » ouvre la fenêtre de fin de la séance interrompue ; une fois enregistrée la reprise ne revient plus', async ({ page, ouvrirAppli }) => {
    await interrompre(page, ouvrirAppli);
    await interrompue(page).getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await laisserPasser(page);
    await expect(fenetreSeance(page)).toBeVisible();
    await expect(champNomSeance(page)).toHaveValue('Session libre');
    await expect(resumeRecap(page)).toHaveText(/^1 min \d+ s · 1 exercice$/);
    await enregistrerSeance(page);
    const seances = await journalDuMois(page);
    expect(seances).toHaveLength(1);
    expect(seances[0]).toMatchObject({ free: true });
    expect(etapesJournal(seances[0])[0][0]).toBe('Alpha');
    expect(etapesJournal(seances[0])[0][1]).toBeGreaterThanOrEqual(70);
    await recharger(page);
    await expect(interrompue(page)).toHaveCount(0);
    await expect(nonEnregistree(page)).toHaveCount(0);
  });

  test('une séance de moins d\'une minute interrompue n\'est pas proposée à la reprise', async ({ page, ouvrirAppli }) => {
    await interrompre(page, ouvrirAppli, sec(35));
    await laisserPasser(page);
    await expect(interrompue(page)).toHaveCount(0);
    await expect(nonEnregistree(page)).toHaveCount(0);
    await expect(barre(page)).toBeHidden();
    await expect(boutonLibre(page)).not.toHaveClass(/free-on/);
  });

  test('recharger alors que la fenêtre « Enregistrer cet entraînement ? » était ouverte : « Séance non enregistrée », qu\'on peut enregistrer', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, min(1) + sec(20));
    await arreterLibre(page);
    await expect(fenetreSeance(page)).toBeVisible();
    await recharger(page);
    await expect(nonEnregistree(page)).toBeVisible();
    await expect(nonEnregistree(page)).toContainText(/« Session libre » · 1 min \d+ s de pratique/);
    await expect(nonEnregistree(page).getByRole('button', { name: 'Reprendre' })).toHaveCount(0);   // la séance est finie : pas de reprise possible
    await nonEnregistree(page).getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await laisserPasser(page);
    await expect(fenetreSeance(page)).toBeVisible();
    await enregistrerSeance(page);
    expect(await journalDuMois(page)).toHaveLength(1);
  });

  test('recharger pendant une pause : à la reprise le temps passé est celui d\'avant la pause', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, min(1) + sec(10));
    await boutonPause(page).click();
    await attendreTempsPasse(page, idPas('Alpha'), sec(65));
    await ecouler(page, min(1));
    await recharger(page);
    await expect(interrompue(page)).toBeVisible();
    await interrompue(page).getByRole('button', { name: 'Reprendre', exact: true }).click();
    await laisserPasser(page);
    const repris = await secondesChrono(page);
    expect(repris).toBeGreaterThanOrEqual(70);
    expect(repris).toBeLessThanOrEqual(71);   // la minute de pause n'est pas comptée
  });
});
