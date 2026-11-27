// MODULE « statistiques » — LES STATISTIQUES VIENNENT DU JOURNAL : une séance libre terminée, une session guidée terminée, une séance passée saisie à la main et une séance supprimée de
// l'Historique changent les chiffres aussitôt. (Les écrans qui ENREGISTRENT sont testés dans les modules `libre` et `session` ; ici on vérifie ce que les statistiques en font.)
// Observé en boîte noire (playwright-cli, 26/11/2026). Horloge de ces tests : 25/11/2026 10:02, pilotée par `page.clock` comme les autres modules.
import { test, expect } from '../support/fixtures';
import { arreterEtEnregistrer, demarrerSur, ecouler, min, ouvrirLibre, passerA, sec } from '../libre/aide-libre';
import { arreterSession, avancer, enregistrerSeance, etatSession, laisserPasser, lancerDepuisListe, minutes, ouvrirAvecHorloge, ouvrirSessions, suivant } from '../session/aide-session';
import { aller, barres, boutonStats, choisirPeriode, contenu, etatStats, fenetre, ilYa, journalMois, journalStats, lignesBloc, ouvrirFenetre, ouvrirStats, section, valeurTuile } from './aide-statistiques';

/** Ouvre les statistiques depuis l'écran « Session guidée » (horloge simulée : on laisse passer un instant pour l'animation d'ouverture). */
async function statistiquesDepuisSessions(page: any, listeDejaOuverte = false) {
  if (listeDejaOuverte) await expect(page.getByRole('button', { name: '+ Nouvelle session' })).toBeVisible(); else await ouvrirSessions(page);
  await boutonStats(page).click();
  await laisserPasser(page);
  await expect(fenetre(page)).toBeVisible();
}

test.describe('Statistiques : alimentées par les séances terminées @statistiques', () => {
  test('une séance libre terminée apparaît dans les statistiques du jour : durée, exercices, nom « Session libre » @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, min(4));
    await passerA(page, 'Bravo');
    await ecouler(page, min(2));
    await arreterEtEnregistrer(page);
    await statistiquesDepuisSessions(page);
    await choisirPeriode(page, 'Aujourd\'hui');
    await expect(valeurTuile(page, 'Sessions')).toHaveText('1');
    await expect(valeurTuile(page, 'Exercices')).toHaveText('2');
    await expect(valeurTuile(page, 'Temps total')).toHaveText(/^[67] min$/);
    const lignes = await lignesBloc(section(page, 'Détail par chapitre'));
    expect(lignes[0]).toMatch(/^Technique \| [67] min · 100 %$/);
    expect(lignes[1]).toMatch(/^Alpha \| [45] min$/);
    expect(lignes[2]).toMatch(/^Bravo \| [23] min$/);
    expect(await lignesBloc(section(page, 'Séances'))).toEqual([expect.stringMatching(/^10:\d\d · Session libre \| [67] min$/)]);
  });

  test('une session guidée terminée : son nom, ses exercices et le temps réellement passé (pas le prévu) @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirAvecHorloge(page, ouvrirAppli, { etat: etatSession(['Alpha', 'Bravo'], [{ nom: 'Routine du soir', exercices: [['Alpha', 5], ['Bravo', 5]] }]) });
    await ouvrirSessions(page);
    await lancerDepuisListe(page, 'Routine du soir');
    await avancer(page, minutes(7));
    await suivant(page).click();
    await avancer(page, minutes(4));
    await arreterSession(page);
    await enregistrerSeance(page);
    await expect.poll(async () => (await journalMois(page, '2026-11')).length).toBe(1);
    await laisserPasser(page);
    await statistiquesDepuisSessions(page, true);   // après l'enregistrement, l'écran « Session guidée » est déjà revenu à la liste
    await choisirPeriode(page, 'Aujourd\'hui');
    await expect(valeurTuile(page, 'Sessions')).toHaveText('1');
    await expect(valeurTuile(page, 'Temps total')).toHaveText('11 min');
    const lignes = await lignesBloc(section(page, 'Détail par chapitre'));
    expect(lignes).toEqual(['Technique | 11 min · 100 %', 'Alpha | 7 min', 'Bravo | 4 min']);
    expect(await lignesBloc(section(page, 'Séances'))).toEqual([expect.stringMatching(/^10:\d\d · Routine du soir \| 11 min$/)]);
    await aller(page, 'Temps');
    await expect(contenu(page).locator('.st-pair .st-pair-r')).toHaveText('11 min / 10 min · 110 %');
  });

  test('une séance passée saisie à la main (Historique) compte à sa date ; la supprimer la retire des statistiques @critique', async ({ page, ouvrirAppli }) => {
    await page.clock.setFixedTime(new Date('2026-11-25T10:00:00+01:00'));
    await ouvrirAppli({ etat: etatSession(['Alpha', 'Bravo']), accueil: 'jamais' });
    await ouvrirSessions(page);
    await page.getByRole('button', { name: /^Historique/ }).click();
    const historique = page.locator('.gs-history-panel');
    await historique.getByRole('button', { name: /^＋ Séance passée/ }).click();
    const saisie = page.locator('.gs-save-run-panel:visible');
    await saisie.locator('input[type=text]').first().fill('Rattrapage');
    await saisie.locator('input[type=date]').fill('2026-11-20');
    await saisie.locator('input[type=time]').fill('18:30');
    await saisie.getByRole('button', { name: '＋ Ajouter un exercice' }).click();
    await page.getByRole('button', { name: 'Tout déplier' }).click();
    await page.getByRole('button', { name: 'Alpha', exact: true }).click();
    await saisie.locator('input[type=number]').first().fill('12');
    await saisie.locator('input[type=number]').first().press('Tab');
    await saisie.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.getByRole('button', { name: 'Enregistrer quand même' }).click();
    await expect.poll(async () => (await journalMois(page)).length).toBe(1);
    // le bouton « Statistiques » de l'Historique ouvre la fenêtre
    await historique.getByRole('button', { name: 'Statistiques', exact: true }).click();
    await expect(fenetre(page)).toBeVisible();
    await expect(valeurTuile(page, 'Sessions')).toHaveText('1');
    await expect(valeurTuile(page, 'Temps total')).toHaveText('12 min');
    await expect(barres(page)).toHaveCount(1);
    expect(await barres(page).first().locator('title').textContent()).toBe('20/11 : 12 min · 1 séance (touche pour voir les exercices)');
    // supprimée depuis l'Historique : les statistiques repartent à zéro
    await fenetre(page).getByRole('button', { name: 'Historique', exact: true }).click();
    await page.locator('.gs-history-panel').getByTitle('Supprimer cette entrée').first().click();
    await page.locator('.app-dialog').getByRole('button', { name: /^Supprimer/ }).click();
    await page.locator('.gs-history-panel').getByRole('button', { name: 'Statistiques', exact: true }).click();
    await expect(valeurTuile(page, 'Sessions')).toHaveText('0');
    await expect(contenu(page)).toContainText('Pas encore de session enregistrée sur cette période.');
  });

  test('une séance supprimée du journal (marquée « supprimée ») n\'est pas comptée', async ({ page, ouvrirAppli }) => {
    const brut = journalStats([{ quand: ilYa(1), pas: [{ ex: 'Gamme majeure', min: 10 }] }, { quand: ilYa(2), pas: [{ ex: 'Gamme majeure', min: 20 }] }]);
    const cle = Object.keys(brut)[0], lot = JSON.parse(brut[cle]);
    lot.records = lot.records.filter((r: any) => r.id !== 'r1'); lot.deleted = ['r1'];
    await ouvrirStats(page, ouvrirAppli, [], { reglages: { [cle]: JSON.stringify(lot) } });
    await ouvrirFenetre(page);
    await expect(valeurTuile(page, 'Sessions')).toHaveText('1');
    await expect(valeurTuile(page, 'Temps total')).toHaveText('10 min');
  });

  test('le nom d\'une session renommée depuis s\'affiche à la place de l\'ancien dans les statistiques', async ({ page, ouvrirAppli }) => {
    const etat: any = etatStats();
    etat.settings.guidedSessions = [{ id: 'sess-routine', name: 'Nouveau nom', instrumentId: 'esp-0', tabIds: [], createdAt: 1, steps: [] }];
    await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(1, '18:00'), nom: 'Ancien nom', pas: [{ ex: 'Gamme majeure', min: 10 }] }], { etat });
    await ouvrirFenetre(page);
    await choisirPeriode(page, 'Hier');
    expect(await lignesBloc(section(page, 'Séances'))).toEqual(['18:00 · Nouveau nom | 10 min']);
  });

  test('plusieurs mois de journal : les séances de tous les mois sont réunies (période « Tout »)', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [
      { quand: '2026-09-10 18:00', pas: [{ ex: 'Gamme majeure', min: 10 }] }, { quand: '2026-10-12 18:00', pas: [{ ex: 'Gamme majeure', min: 20 }] }, { quand: ilYa(1), pas: [{ ex: 'Gamme majeure', min: 30 }] },
    ]);
    await ouvrirFenetre(page);
    await choisirPeriode(page, 'Tout');
    await expect(valeurTuile(page, 'Sessions')).toHaveText('3');
    await expect(valeurTuile(page, 'Temps total')).toHaveText('1 h 00');
    expect(await barres(page).count()).toBe(3);
  });
});
