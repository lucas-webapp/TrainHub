// MODULE « statistiques » — ONGLET « TEMPS » : moyenne par jour, carte de régularité sur 12 mois (une case par jour, 53 semaines, lundi en haut), « Réel contre prévu » des dix dernières séances.
// Observé en boîte noire (playwright-cli, 26/11/2026, horloge figée au jeudi 26/11/2026 10:00). Les cases d'avant le premier jour du journal sont grisées (« non comptées »).
import { test, expect } from '../support/fixtures';
import { aller, choisirPeriode, contenu, ilYa, lignesBloc, ouvrirFenetre, ouvrirStats, section } from './aide-statistiques';

const cases = (page: any) => contenu(page).locator('svg.st-heat rect.st-cell');

test.describe('Statistiques : onglet Temps @statistiques', () => {
  test('moyenne par jour = temps total ÷ jours de la période @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [
      { quand: ilYa(2), prevu: 20, pas: [{ ex: 'Gamme majeure', min: 30 }] },
      { quand: ilYa(5), prevu: 30, pas: [{ ex: 'Arpèges', min: 30 }] },
      { quand: ilYa(9), libre: true, pas: [{ ex: 'Croches', min: 20, sous: 'Rythme' }] },
    ]);
    await ouvrirFenetre(page);
    await aller(page, 'Temps');
    expect(await lignesBloc(section(page, 'Temps de pratique'))).toEqual(['Moyenne par jour | 8 min']);   // 80 min sur les 10 jours du journal
    await choisirPeriode(page, '3 derniers jours');
    expect(await lignesBloc(section(page, 'Temps de pratique'))).toEqual(['Moyenne par jour | 10 min']);   // 30 min sur 3 jours
  });

  test.describe('carte de régularité', () => {
    test('53 semaines de cases jusqu\'à aujourd\'hui, repères « lun mer ven » et mois @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(1), pas: [{ ex: 'Gamme majeure', min: 10 }] }]);
      await ouvrirFenetre(page);
      await aller(page, 'Temps');
      await expect(section(page, 'Régularité sur 12 mois')).toBeVisible();
      await expect(contenu(page).locator('svg.st-heat')).toHaveAttribute('aria-label', 'Jours pratiqués sur les 12 derniers mois');
      await expect(cases(page)).toHaveCount(368);   // du lundi 24/11/2025 au jeudi 26/11/2026 inclus
      await expect(contenu(page).locator('svg.st-heat text.st-axis').filter({ hasText: /^(lun|mer|ven)$/ })).toHaveText(['lun', 'mer', 'ven']);
      const mois = await contenu(page).locator('svg.st-heat text.st-axis').allTextContents();
      expect(mois).toEqual(expect.arrayContaining(['janv.', 'mars', 'juin', 'sept.', 'nov.', 'déc.']));
      await expect(contenu(page).locator('rect.st-today')).toHaveCount(1);
    });

    test('une case par jour pratiqué, plus foncée quand le jour est plus chargé ; info-bulle « jour mois année : durée » @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [
        { quand: ilYa(0, '08:00'), pas: [{ ex: 'Gamme majeure', min: 10 }] },
        { quand: ilYa(1), pas: [{ ex: 'Gamme majeure', min: 25 }] },
        { quand: ilYa(2), pas: [{ ex: 'Gamme majeure', min: 12 }] },
        { quand: ilYa(3), pas: [{ ex: 'Gamme majeure', min: 4 }] },
        { quand: ilYa(4), pas: [{ ex: 'Gamme majeure', min: 4 }] },
      ]);
      await ouvrirFenetre(page);
      await aller(page, 'Temps');
      const pleines = await contenu(page).locator('svg.st-heat rect.st-cell').evaluateAll((els) => els
        .filter((e) => !/st-lv0|st-na/.test(e.getAttribute('class')!))
        .map((e) => `${e.querySelector('title')!.textContent}|${(e.getAttribute('class')!.match(/st-lv(\d)/) || [])[1]}`));
      expect(pleines).toEqual(['22 nov. 2026 : 4 min|1', '23 nov. 2026 : 4 min|1', '24 nov. 2026 : 12 min|2', '25 nov. 2026 : 25 min|4', '26 nov. 2026 : 10 min|2']);
      // 25 min = le maximum : niveau 4 ; 12 min → ⌈12/25×4⌉ = 2 ; 4 min → 1
      await expect(contenu(page).locator('rect.st-today')).toHaveAttribute('class', /st-lv2/);
    });

    test('un jour sans pratique dit « rien » ; les jours d\'avant le journal sont grisés et sans info-bulle de durée', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(3), pas: [{ ex: 'Gamme majeure', min: 10 }] }]);
      await ouvrirFenetre(page);
      await aller(page, 'Temps');
      const titre = (n: number) => cases(page).nth(n).locator('title').textContent();
      await expect(contenu(page).locator('rect.st-na')).toHaveCount(364);   // du 24/11/2025 au 22/11/2026 : avant le premier jour compté
      await expect(cases(page).first()).toHaveClass(/st-na/);
      expect(await titre(366)).toBe('25 nov. 2026 : rien');
      expect(await cases(page).first().locator('title').count()).toBe(0);
    });

    test('la date de début des statistiques grise aussi les jours d\'avant', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(10), pas: [{ ex: 'Gamme majeure', min: 10 }] }, { quand: ilYa(2), pas: [{ ex: 'Gamme majeure', min: 10 }] }]);
      await ouvrirFenetre(page);
      await contenu(page).getByLabel('Début des statistiques').fill('2026-11-20');
      await aller(page, 'Temps');
      await expect(contenu(page).locator('rect.st-na')).toHaveCount(361);   // jusqu'au 19/11 inclus
      await expect(contenu(page).locator('rect.st-cell:not(.st-na):not(.st-lv0)')).toHaveCount(1);
    });

    test('la carte montre 12 mois quelle que soit la période choisie (absente sur les périodes courtes : jours et 3 jours)', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(1), pas: [{ ex: 'Gamme majeure', min: 10 }] }]);
      await ouvrirFenetre(page);
      await aller(page, 'Temps');
      await choisirPeriode(page, '7 jours');
      await expect(cases(page)).toHaveCount(368);
      await choisirPeriode(page, '3 derniers jours');
      await expect(contenu(page).locator('svg.st-heat')).toHaveCount(0);
      await choisirPeriode(page, 'Hier');
      await expect(contenu(page).locator('svg.st-heat')).toHaveCount(0);
      await choisirPeriode(page, 'Aujourd\'hui');
      await expect(contenu(page).locator('svg.st-heat')).toHaveCount(0);
    });
  });

  test.describe('réel contre prévu', () => {
    test('chaque séance prévue : date, nom, durée réelle / prévue et pourcentage ; la plus récente d\'abord et en vert @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [
        { quand: ilYa(1), prevu: 10, nom: 'Hier soir', pas: [{ ex: 'Gamme majeure', min: 15 }] },
        { quand: ilYa(3), prevu: 20, nom: 'Matin', pas: [{ ex: 'Gamme majeure', min: 10 }] },
        { quand: ilYa(5), libre: true, pas: [{ ex: 'Arpèges', min: 30 }] },
      ]);
      await ouvrirFenetre(page);
      await aller(page, 'Temps');
      const lignes = contenu(page).locator('.st-pair');
      await expect(lignes).toHaveCount(2);                                // la séance libre n'a pas de prévu : absente
      await expect(lignes.nth(0).locator('.st-pair-l')).toHaveText('25/11 · Hier soir');
      await expect(lignes.nth(0).locator('.st-pair-r')).toHaveText('15 min / 10 min · 150 %');
      await expect(lignes.nth(1).locator('.st-pair-l')).toHaveText('23/11 · Matin');
      await expect(lignes.nth(1).locator('.st-pair-r')).toHaveText('10 min / 20 min · 50 %');
      await expect(lignes.nth(0)).toHaveClass(/st-pair-ok/);
      await expect(lignes.nth(1)).not.toHaveClass(/st-pair-ok/);
      await expect(lignes.nth(0).locator('.st-pair-plan')).toHaveAttribute('title', 'prévu : 10 min');
    });

    test('seulement les dix dernières séances prévues', async ({ page, ouvrirAppli }) => {
      const S = Array.from({ length: 12 }, (_, i) => ({ quand: ilYa(i + 1), prevu: 10, pas: [{ ex: 'Gamme majeure', min: 10 }] }));
      await ouvrirStats(page, ouvrirAppli, S);
      await ouvrirFenetre(page);
      await choisirPeriode(page, '90 jours');
      await aller(page, 'Temps');
      const lignes = contenu(page).locator('.st-pair .st-pair-l');
      await expect(lignes).toHaveCount(10);
      await expect(lignes.first()).toHaveText('25/11 · Routine');
      await expect(lignes.last()).toHaveText('16/11 · Routine');
    });

    test('la barre « réel » est proportionnelle à la plus grande valeur (réelle ou prévue)', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [
        { quand: ilYa(1), prevu: 10, pas: [{ ex: 'Gamme majeure', min: 40 }] },
        { quand: ilYa(2), prevu: 20, pas: [{ ex: 'Gamme majeure', min: 10 }] },
      ]);
      await ouvrirFenetre(page);
      await aller(page, 'Temps');
      const largeurs = await contenu(page).locator('.st-pair-real').evaluateAll((els) => els.map((e) => (e as HTMLElement).style.width));
      expect(largeurs).toEqual(['100%', '25%']);
    });

    test('aujourd\'hui : seule la séance du jour apparaît ; sans séance prévue le message renvoie à l\'Aperçu', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [
        { quand: ilYa(0, '08:00'), libre: true, pas: [{ ex: 'Gamme majeure', min: 10 }] },
        { quand: ilYa(1), prevu: 10, pas: [{ ex: 'Gamme majeure', min: 10 }] },
      ]);
      await ouvrirFenetre(page);
      await choisirPeriode(page, 'Aujourd\'hui');
      await aller(page, 'Temps');
      await expect(contenu(page)).toContainText('Rien de plus sur cette période : tout est dans l\'Aperçu.');
      await expect(contenu(page).locator('.st-pair')).toHaveCount(0);
      await choisirPeriode(page, 'Hier');
      await expect(contenu(page).locator('.st-pair')).toHaveCount(1);
      await expect(contenu(page)).not.toContainText('Rien de plus sur cette période');
    });
  });
});
