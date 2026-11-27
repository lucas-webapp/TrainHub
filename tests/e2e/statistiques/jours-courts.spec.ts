// MODULE « statistiques » — PÉRIODES COURTES (Aujourd'hui, Hier, 3 derniers jours, un jour précis) : l'Aperçu montre le détail par chapitre, dossier et exercice, puis la liste des séances
// (la plus récente d'abord) plutôt que des moyennes hebdomadaires. Observé en boîte noire (playwright-cli, 26/11/2026, horloge figée au 26/11/2026 10:00).
import { test, expect } from '../support/fixtures';
import { aller, choisirPeriode, contenu, ilYa, lignesBloc, ouvrirFenetre, ouvrirStats, section } from './aide-statistiques';

const DONNEES = [
  { quand: ilYa(0, '08:00'), nom: 'Matin', pas: [{ ex: 'Gamme majeure', min: 10 }, { ex: 'Blues en la', min: 20, chap: 'Improvisation' }] },
  { quand: ilYa(1, '18:00'), nom: 'Routine', pas: [{ ex: 'Gamme majeure', min: 10 }, { ex: 'Croches', min: 5, sous: 'Rythme' }] },
  { quand: ilYa(1, '20:00'), nom: 'Soir', pas: [{ ex: 'Croches', min: 7, sous: 'Rythme' }] },
  { quand: ilYa(2, '19:00'), pas: [{ ex: 'Gamme majeure', min: 6 }] },
];

test.describe('Statistiques : périodes courtes @statistiques', () => {
  test('« Aujourd\'hui » : détail par chapitre (part du temps), exercices, puis la liste des séances @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, DONNEES);
    await ouvrirFenetre(page);
    await choisirPeriode(page, 'Aujourd\'hui');
    expect(await lignesBloc(section(page, 'Détail par chapitre'))).toEqual(['Improvisation | 20 min · 67 %', 'Blues en la | 20 min', 'Technique | 10 min · 33 %', 'Gamme majeure | 10 min']);
    expect(await lignesBloc(section(page, 'Séances'))).toEqual(['08:00 · Matin | 30 min']);
  });

  test('« Hier » : un dossier est une ligne entre le chapitre et ses exercices ; un exercice fait deux fois s\'écrit « 2× » ; la séance du soir passe avant @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, DONNEES);
    await ouvrirFenetre(page);
    await choisirPeriode(page, 'Hier');
    expect(await lignesBloc(section(page, 'Détail par chapitre'))).toEqual(['Technique | 22 min · 100 %', 'Gamme majeure | 10 min', 'Rythme | 12 min', 'Croches | 12 min · 2×']);
    expect(await lignesBloc(section(page, 'Séances'))).toEqual(['20:00 · Soir | 7 min', '18:00 · Routine | 15 min']);
    await expect(contenu(page).locator('.st-tree-ex.st-tree-lv1')).toHaveCount(1);   // Gamme majeure : posé directement dans le chapitre
    await expect(contenu(page).locator('.st-tree-ex.st-tree-lv2')).toHaveCount(1);   // Croches : sous « Rythme »
    await expect(contenu(page).locator('.st-tree-sub')).toHaveCount(1);
  });

  test('« 3 derniers jours » : les séances portent leur date, les exercices répétés sont comptés, le graphique suit', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, DONNEES);
    await ouvrirFenetre(page);
    await choisirPeriode(page, '3 derniers jours');
    expect(await lignesBloc(section(page, 'Séances'))).toEqual(['26/11 · 08:00 · Matin | 30 min', '25/11 · 20:00 · Soir | 7 min', '25/11 · 18:00 · Routine | 15 min', '24/11 · 19:00 · Routine | 6 min']);
    expect(await lignesBloc(section(page, 'Détail par chapitre'))).toEqual([
      'Technique | 38 min · 66 %', 'Gamme majeure | 26 min · 3×', 'Rythme | 12 min', 'Croches | 12 min · 2×', 'Improvisation | 20 min · 34 %', 'Blues en la | 20 min',
    ]);   // 58 min en tout : 38 en Technique (66 %), 20 en Improvisation (34 %)
    await expect(contenu(page).locator('svg.st-bars')).toHaveCount(1);
  });

  test('les exercices posés directement dans le chapitre passent avant ses sous-dossiers', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(1), pas: [{ ex: 'Croches', min: 30, sous: 'Rythme' }, { ex: 'Gamme majeure', min: 5 }] }]);
    await ouvrirFenetre(page);
    await choisirPeriode(page, 'Hier');
    expect(await lignesBloc(section(page, 'Détail par chapitre'))).toEqual(['Technique | 35 min · 100 %', 'Gamme majeure | 5 min', 'Rythme | 30 min', 'Croches | 30 min']);
  });

  test('une séance libre est nommée « Session libre » dans la liste', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(0, '07:00'), libre: true, pas: [{ ex: 'Arpèges', min: 12 }] }]);
    await ouvrirFenetre(page);
    await choisirPeriode(page, 'Aujourd\'hui');
    expect(await lignesBloc(section(page, 'Séances'))).toEqual(['07:00 · Session libre | 12 min']);
  });

  test('les autres onglets suivent la période courte : « Exercices » et « Répartition » ne montrent que ce jour-là', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, DONNEES);
    await ouvrirFenetre(page);
    await choisirPeriode(page, 'Aujourd\'hui');
    await aller(page, 'Exercices');
    await expect(contenu(page).locator('.st-ex-name').filter({ hasText: /^Blues en la/ })).toBeVisible();
    await expect(contenu(page).locator('.st-ex-name').filter({ hasText: /^Croches/ })).toHaveCount(0);
    await aller(page, 'Répartition');
    expect(await lignesBloc(section(page, 'Les plus travaillés'))).toEqual(['Blues en la | 20 min · 1×', 'Gamme majeure | 10 min · 1×']);
  });

  test('un jour sans séance : message, pas de liste', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, DONNEES);
    await ouvrirFenetre(page);
    await choisirPeriode(page, 'Un jour précis…');
    await page.getByLabel('Jour', { exact: true }).fill('2026-11-10');
    await expect(contenu(page)).toContainText('Pas encore de session enregistrée sur cette période.');
    await expect(contenu(page).locator('.st-tree-sess')).toHaveCount(0);
  });
});
