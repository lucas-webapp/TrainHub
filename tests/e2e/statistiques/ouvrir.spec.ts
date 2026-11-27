// MODULE « statistiques » — OUVRIR ET FERMER la fenêtre, onglets, état vide. Observé en boîte noire (playwright-cli, 26/11/2026) : l'icône « Statistiques d'entraînement » de l'écran
// « Session guidée » ouvre la fenêtre « Statistiques » (période « 28 jours », onglet « Aperçu ») ; « Fermer », Échap et un clic à côté la ferment ; les icônes Calendrier / Historique
// de son titre ouvrent ces écrans, et l'Historique propose à son tour « Statistiques ». Sans séance : un message par onglet. Seules les séances de l'espace actif comptent.
import { test, expect } from '../support/fixtures';
import { aller, choisirPeriode, contenu, fenetre, fermer, ilYa, ongletStats, ouvrirFenetre, ouvrirStats, periode, boutonStats, tuile, valeurTuile } from './aide-statistiques';
import { ouvrirSessions } from '../session/aide-session';

const UNE_SEANCE = [{ quand: ilYa(1), pas: [{ ex: 'Gamme majeure', min: 10 }] }];

test.describe('Statistiques : ouvrir, fermer, onglets @statistiques', () => {
  test('l\'icône de l\'écran « Session guidée » ouvre la fenêtre : titre, période de 28 jours, quatre onglets, « Aperçu » d\'abord @critique', async ({ page, ouvrirAppli, garde }) => {
    await ouvrirStats(page, ouvrirAppli, UNE_SEANCE);
    await ouvrirSessions(page);
    await expect(boutonStats(page)).toHaveAttribute('title', 'Statistiques d\'entraînement');
    await boutonStats(page).click();
    await expect(fenetre(page)).toBeVisible();
    await expect(fenetre(page).locator('.gs-title-text')).toHaveText('Statistiques');
    await expect(periode(page)).toHaveValue('28');
    await expect(periode(page).locator('option')).toHaveText(['Aujourd\'hui', 'Hier', '3 derniers jours', 'Un jour précis…', '7 jours', '28 jours', '90 jours', 'Ce mois', 'Mois dernier', 'Cette année', 'Année dernière', 'Tout']);
    await expect(fenetre(page).getByRole('tab')).toHaveText(['Aperçu', 'Temps', 'Répartition', 'Exercices']);
    await expect(ongletStats(page, 'Aperçu')).toHaveAttribute('aria-selected', 'true');
    for (const autre of ['Temps', 'Répartition', 'Exercices'] as const) await expect(ongletStats(page, autre)).toHaveAttribute('aria-selected', 'false');
    await expect(contenu(page).getByText('Chiffres clés', { exact: true })).toBeVisible();
    expect(garde.bloquees).toEqual([]);
  });

  test('chaque onglet affiche son contenu et un seul est actif à la fois @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, UNE_SEANCE);
    await ouvrirFenetre(page);
    const titres = { Temps: /Régularité sur 12 mois/i, Répartition: /Les plus travaillés/i, Exercices: /Exercices avec objectif tempo/, Aperçu: /Chiffres clés/i } as const;
    for (const [onglet, attendu] of Object.entries(titres) as Array<[keyof typeof titres, RegExp]>) {
      await aller(page, onglet);
      await expect(contenu(page)).toContainText(attendu);
      await expect(fenetre(page).locator('.st-tab.active')).toHaveCount(1);
      await expect(fenetre(page).locator('.st-tab.active')).toHaveText(new RegExp(`^${onglet}`));
    }
  });

  test('« Fermer » ferme la fenêtre ; Échap aussi @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, UNE_SEANCE);
    await ouvrirFenetre(page);
    await fermer(page).click();
    await expect(fenetre(page)).toBeHidden();
    await boutonStats(page).click();
    await expect(fenetre(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(fenetre(page)).toBeHidden();
    await expect(boutonStats(page)).toBeVisible();
  });

  test('un clic à côté de la fenêtre la ferme (à l\'ordinateur ; au téléphone elle occupe tout l\'écran) @ordinateur', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, UNE_SEANCE);
    await ouvrirFenetre(page);
    await page.mouse.click(4, 4);
    await expect(fenetre(page)).toBeHidden();
    await expect(boutonStats(page)).toBeVisible();
  });

  test('rouverte, la fenêtre repart sur 28 jours et garde l\'onglet où on était', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, UNE_SEANCE);
    await ouvrirFenetre(page);
    await aller(page, 'Temps');
    await choisirPeriode(page, '7 jours');
    await fermer(page).click();
    await expect(fenetre(page)).toBeHidden();
    await boutonStats(page).click();
    await expect(fenetre(page)).toBeVisible();
    await expect(periode(page)).toHaveValue('28');
    await expect(ongletStats(page, 'Temps')).toHaveAttribute('aria-selected', 'true');
  });

  test('les icônes du titre mènent au Calendrier et à l\'Historique, qui proposent à leur tour les Statistiques', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, UNE_SEANCE);
    await ouvrirFenetre(page);
    await expect(fenetre(page).locator('.gs-nav-icons button')).toHaveCount(2);
    await expect(fenetre(page).getByRole('button', { name: 'Statistiques', exact: true })).toHaveCount(0);   // on y est déjà
    await fenetre(page).getByRole('button', { name: 'Historique', exact: true }).click();
    await expect(fenetre(page)).toBeHidden();
    const historique = page.locator('.gs-history-panel');
    await expect(historique).toContainText('Historique des sessions');
    await historique.getByRole('button', { name: 'Statistiques', exact: true }).click();
    await expect(fenetre(page)).toBeVisible();
    await fenetre(page).getByRole('button', { name: 'Calendrier', exact: true }).click();
    await expect(fenetre(page)).toBeHidden();
    await expect(page.locator('.backups-panel').filter({ hasText: /Calendrier/ }).first()).toBeVisible();
  });

  test('aucune séance : chaque onglet le dit (chiffres à zéro, rien à répartir, aucun exercice) @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, []);
    await ouvrirFenetre(page);
    await expect(contenu(page)).toContainText('Pas encore de session enregistrée sur cette période. Les statistiques se remplissent au fil des sessions que tu enregistres (10 min minimum).');
    await expect(valeurTuile(page, 'Temps total')).toHaveText('0 min');
    await expect(valeurTuile(page, 'Sessions')).toHaveText('0');
    await expect(valeurTuile(page, 'Moyenne / semaine')).toHaveText('0 min');
    await expect(valeurTuile(page, 'Durée moyenne')).toHaveText('–');
    await expect(valeurTuile(page, 'Réel / prévu')).toHaveText('–');
    await expect(contenu(page).locator('svg.st-bars')).toHaveCount(0);
    await aller(page, 'Temps');
    await expect(contenu(page)).toContainText('Pas encore de session enregistrée sur cette période.');
    await expect(contenu(page).locator('svg.st-heat')).toHaveCount(0);
    await aller(page, 'Répartition');
    await expect(contenu(page).getByText('Rien à répartir sur cette période.')).toHaveCount(2);   // chapitres et sous-dossiers
    await expect(contenu(page).locator('svg.st-pie')).toHaveCount(0);
    await aller(page, 'Exercices');
    await expect(contenu(page)).toHaveText(/Aucun exercice travaillé sur cette période\./);
    await expect(contenu(page).locator('.st-ex')).toHaveCount(0);
  });

  test('sans séance sur la période choisie mais avec un journal : même message, et « Tout » retrouve les séances', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(40), pas: [{ ex: 'Arpèges', min: 6 }] }]);
    await ouvrirFenetre(page);
    await expect(valeurTuile(page, 'Sessions')).toHaveText('0');
    await expect(contenu(page)).toContainText('Pas encore de session enregistrée sur cette période.');
    await choisirPeriode(page, 'Tout');
    await expect(valeurTuile(page, 'Sessions')).toHaveText('1');
    await expect(contenu(page)).not.toContainText('Pas encore de session enregistrée');
  });

  test('seules les séances de l\'espace actif comptent', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [
      { quand: ilYa(1), pas: [{ ex: 'Gamme majeure', min: 10 }] },
      { quand: ilYa(2), espace: 'esp-autre', pas: [{ ex: 'Accord de do', min: 30 }] },
    ]);
    await ouvrirFenetre(page);
    await expect(valeurTuile(page, 'Sessions')).toHaveText('1');
    await expect(valeurTuile(page, 'Temps total')).toHaveText('10 min');
    await aller(page, 'Exercices');
    await expect(contenu(page)).not.toContainText('Accord de do');
  });

  test('une séance sans espace noté (ancien journal) compte pour l\'espace actif', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(1), espace: '', pas: [{ ex: 'Gamme majeure', min: 10 }] }]);
    await ouvrirFenetre(page);
    await expect(valeurTuile(page, 'Sessions')).toHaveText('1');
    await expect(tuile(page, 'Temps total')).toBeVisible();
  });
});
