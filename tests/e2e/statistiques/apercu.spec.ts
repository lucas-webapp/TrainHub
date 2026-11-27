// MODULE « statistiques » — ONGLET « APERÇU » : chiffres clés, périodes, comparaison avec la période d'avant, début des statistiques. Observé en boîte noire (playwright-cli, 26/11/2026,
// horloge figée au jeudi 26/11/2026 10:00) : six tuiles (Temps total, Sessions, Jours pratiqués « n / jours de la période », Moyenne / semaine, Durée moyenne, Réel / prévu) ; pour « Aujourd'hui »,
// « Hier » et « Un jour précis… » quatre tuiles (Temps total, Sessions, Exercices, Durée moyenne) et « 3 derniers jours » remplace la durée moyenne par « Jours pratiqués ». Sous les tuiles,
// « Comparé à … » (mois et années : le même laps du mois / de l'année d'avant ; jours : la veille…) ou « … : pas de comparaison possible ». Les jours d'avant la première séance (ou d'avant la
// date choisie dans « Statistiques comptées à partir du ») ne comptent pas.
import { test, expect } from '../support/fixtures';
import { choisirPeriode, contenu, deltaTuile, ilYa, jourPrecis, noms, ouvrirFenetre, ouvrirStats, reglagesStats, valeurTuile, tuile, fenetre, ongletStats } from './aide-statistiques';

const dix = (quand: string) => ({ quand, pas: [{ ex: 'Gamme majeure', min: 10 }] });
/** Sept séances de 10 min, à 0, 1, 3, 8, 20, 40 et 100 jours d'écart. */
const SEPT = [dix(ilYa(0, '08:00')), dix(ilYa(1)), dix(ilYa(3)), dix(ilYa(8)), dix(ilYa(20)), dix(ilYa(40)), dix(ilYa(100))];

test.describe('Statistiques : Aperçu, chiffres clés par période @statistiques', () => {
  // [période, séances, temps, jours pratiqués, essentiel]
  const PERIODES: Array<[string, number, string, string | null, boolean]> = [
    ['Aujourd\'hui', 1, '10 min', null, true],
    ['Hier', 1, '10 min', null, false],
    ['3 derniers jours', 2, '20 min', '2 / 3', false],
    ['7 jours', 3, '30 min', '3 / 7', false],
    ['28 jours', 5, '50 min', '5 / 28', true],
    ['90 jours', 6, '1 h 00', '6 / 90', false],
    ['Ce mois', 5, '50 min', '5 / 26', true],
    ['Mois dernier', 1, '10 min', null, false],
    ['Cette année', 7, '1 h 10', '7 / 101', false],
    ['Année dernière', 0, '0 min', null, false],
    ['Tout', 7, '1 h 10', '7 / 101', true],
  ];
  for (const [libelle, seances, temps, jours, essentiel] of PERIODES) {
    test(`période « ${libelle} » : ${seances} séance(s), ${temps}${jours ? `, ${jours} jours pratiqués` : ''}${essentiel ? ' @critique' : ''}`, async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, SEPT);
      await ouvrirFenetre(page);
      await choisirPeriode(page, libelle);
      await expect(valeurTuile(page, 'Sessions')).toHaveText(String(seances));
      await expect(valeurTuile(page, 'Temps total')).toHaveText(temps);
      if (jours) await expect(valeurTuile(page, 'Jours pratiqués')).toHaveText(jours);
      if (seances === 0) await expect(contenu(page)).toContainText('Pas encore de session enregistrée sur cette période.');
    });
  }

  test('« Mois dernier » (octobre, 31 jours) : « Jours pratiqués » compte 31 jours', async ({ page, ouvrirAppli }) => {
    test.fail(true, 'ST-02 : octobre 2026 compte « 1 / 32 » jours : le passage à l\'heure d\'hiver (25/10) ajoute une heure à la période et l\'arrondi au jour supérieur ajoute un jour entier.');
    await ouvrirStats(page, ouvrirAppli, SEPT);
    await ouvrirFenetre(page);
    await choisirPeriode(page, 'Mois dernier');
    await expect(valeurTuile(page, 'Jours pratiqués')).toHaveText('1 / 31');
  });

  test('six tuiles sur une longue période, quatre sur un jour, « Jours pratiqués » à la place de la durée moyenne sur 3 jours @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, SEPT);
    await ouvrirFenetre(page);
    expect(await noms(page)).toEqual(['Temps total', 'Sessions', 'Jours pratiqués', 'Moyenne / semaine', 'Durée moyenne', 'Réel / prévu']);
    await choisirPeriode(page, 'Aujourd\'hui');
    expect(await noms(page)).toEqual(['Temps total', 'Sessions', 'Exercices', 'Durée moyenne']);
    await choisirPeriode(page, 'Hier');
    expect(await noms(page)).toEqual(['Temps total', 'Sessions', 'Exercices', 'Durée moyenne']);
    await choisirPeriode(page, '3 derniers jours');
    expect(await noms(page)).toEqual(['Temps total', 'Sessions', 'Exercices', 'Jours pratiqués']);
    await choisirPeriode(page, 'Un jour précis…');
    expect(await noms(page)).toEqual(['Temps total', 'Sessions', 'Exercices', 'Durée moyenne']);
  });

  test('les calculs : temps total, durée moyenne, moyenne par semaine, réel contre prévu (une séance libre ne compte pas dans le prévu) @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [
      { quand: ilYa(2), prevu: 20, pas: [{ ex: 'Gamme majeure', min: 30 }] },
      { quand: ilYa(5), prevu: 30, pas: [{ ex: 'Arpèges', min: 30 }] },
      { quand: ilYa(9), libre: true, pas: [{ ex: 'Croches', min: 20, sous: 'Rythme' }] },
    ]);
    await ouvrirFenetre(page);
    await expect(valeurTuile(page, 'Temps total')).toHaveText('1 h 20');
    await expect(valeurTuile(page, 'Sessions')).toHaveText('3');
    await expect(valeurTuile(page, 'Jours pratiqués')).toHaveText('3 / 10');   // le journal commence il y a 9 jours : 10 jours comptés
    await expect(valeurTuile(page, 'Durée moyenne')).toHaveText('27 min');      // 80 min / 3 séances
    await expect(valeurTuile(page, 'Moyenne / semaine')).toHaveText('56 min');  // 80 min sur 10 jours = 56 min par semaine
    await expect(valeurTuile(page, 'Réel / prévu')).toHaveText('120 %');         // 60 min faites sur 50 prévues (la séance libre est hors prévu)
  });

  test('le journal commence le jour de la première séance : « Jours pratiqués » ne compte pas les jours d\'avant', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [dix(ilYa(2)), dix(ilYa(3))]);
    await ouvrirFenetre(page);
    await expect(valeurTuile(page, 'Jours pratiqués')).toHaveText('2 / 4');    // 28 jours demandés, mais seulement 4 jours depuis la première séance
  });

  test('une séance libre compte comme les autres (temps, séances, exercices)', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(1), libre: true, pas: [{ ex: 'Gamme majeure', min: 12 }, { ex: 'Croches', min: 8, sous: 'Rythme' }] }]);
    await ouvrirFenetre(page);
    await choisirPeriode(page, 'Hier');
    await expect(valeurTuile(page, 'Temps total')).toHaveText('20 min');
    await expect(valeurTuile(page, 'Sessions')).toHaveText('1');
    await expect(valeurTuile(page, 'Exercices')).toHaveText('2');
    await expect(contenu(page).locator('.st-tree-sess')).toContainText('Session libre');
  });

  test.describe('comparaison avec la période d\'avant', () => {
    test('« Ce mois » : écarts en pourcentage et en nombre, comparés au mois d\'octobre à la même date @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [
        dix(ilYa(1)), { quand: ilYa(2), pas: [{ ex: 'Gamme majeure', min: 30 }] },                          // novembre : 40 min, 2 séances, 2 jours
        { quand: '2026-10-10 18:00', pas: [{ ex: 'Gamme majeure', min: 20 }] },                              // octobre (avant le 26 à 10 h) : 20 min
        { quand: '2026-10-28 18:00', pas: [{ ex: 'Gamme majeure', min: 99 }] },                              // octobre, APRÈS « la même date » : ne compte pas
      ]);
      await ouvrirFenetre(page);
      await choisirPeriode(page, 'Ce mois');
      await expect(contenu(page)).toContainText('Comparé à octobre (à la même date)');
      await expect(deltaTuile(page, 'Temps total')).toHaveText('▲ +100 %');
      await expect(deltaTuile(page, 'Sessions')).toHaveText('▲ +1');
      await expect(deltaTuile(page, 'Jours pratiqués')).toHaveText('▲ +1 j');
      await expect(deltaTuile(page, 'Durée moyenne')).toHaveText('＝ stable');
    });

    test('« Mois dernier » : un recul s\'écrit ▼ avec le signe moins ; comparé à septembre', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [
        { quand: '2026-10-10 18:00', pas: [{ ex: 'Gamme majeure', min: 20 }] },
        { quand: '2026-09-05 18:00', pas: [{ ex: 'Gamme majeure', min: 20 }] }, { quand: '2026-09-12 18:00', pas: [{ ex: 'Gamme majeure', min: 20 }] },
      ]);
      await ouvrirFenetre(page);
      await choisirPeriode(page, 'Mois dernier');
      await expect(contenu(page)).toContainText('Comparé à septembre');
      await expect(contenu(page)).not.toContainText('à la même date');
      await expect(deltaTuile(page, 'Temps total')).toHaveText('▼ −50 %');
      await expect(deltaTuile(page, 'Sessions')).toHaveText('▼ −1');
      await expect(deltaTuile(page, 'Jours pratiqués')).toHaveText('▼ −1 j');
    });

    test('« Cette année » : comparée à l\'année d\'avant à la même date', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [dix(ilYa(5)), dix(ilYa(6)), { quand: '2025-03-10 18:00', pas: [{ ex: 'Gamme majeure', min: 10 }] }]);
      await ouvrirFenetre(page);
      await choisirPeriode(page, 'Cette année');
      await expect(contenu(page)).toContainText('Comparé à 2025 (à la même date)');
      await expect(deltaTuile(page, 'Temps total')).toHaveText('▲ +100 %');
      await choisirPeriode(page, 'Année dernière');
      await expect(contenu(page)).toContainText('Aucune séance en 2024 : pas de comparaison possible.');
    });

    test('« Hier » : comparé à avant-hier ; mêmes durées = « stable »', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [dix(ilYa(1)), dix(ilYa(2))]);
      await ouvrirFenetre(page);
      await choisirPeriode(page, 'Hier');
      await expect(contenu(page)).toContainText('Comparé à avant-hier');
      await expect(deltaTuile(page, 'Temps total')).toHaveText('＝ stable');
      await expect(deltaTuile(page, 'Sessions')).toHaveText('＝ stable');
    });

    test('« Aujourd\'hui » : comparé à hier À LA MÊME HEURE (la séance d\'hier au soir ne compte pas) @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [dix(ilYa(0, '08:00')), dix(ilYa(1, '18:00'))]);
      await ouvrirFenetre(page);
      await choisirPeriode(page, 'Aujourd\'hui');
      await expect(contenu(page)).toContainText('Aucune séance hier à la même heure : pas de comparaison possible.');
      await expect(deltaTuile(page, 'Temps total')).toHaveCount(0);
    });

    test('« Aujourd\'hui » avec une séance d\'hier avant 10 h : « Comparé à hier (à la même heure) »', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(0, '08:00'), pas: [{ ex: 'Gamme majeure', min: 30 }] }, dix(ilYa(1, '07:30'))]);
      await ouvrirFenetre(page);
      await choisirPeriode(page, 'Aujourd\'hui');
      await expect(contenu(page)).toContainText('Comparé à hier (à la même heure)');
      await expect(deltaTuile(page, 'Temps total')).toHaveText('▲ +200 %');
    });

    test('« 3 derniers jours » : comparé aux 3 jours d\'avant, et la phrase est correcte', async ({ page, ouvrirAppli }) => {
      test.fail(true, 'ST-01 : la phrase s\'écrit « Comparé à aux 3 jours d\'avant » (le « à » est en double).');
      await ouvrirStats(page, ouvrirAppli, [dix(ilYa(1)), dix(ilYa(4))]);
      await ouvrirFenetre(page);
      await choisirPeriode(page, '3 derniers jours');
      await expect(deltaTuile(page, 'Temps total')).toHaveText('＝ stable');   // la comparaison existe bien : seul le libellé est faux
      await expect(contenu(page).locator('.st-compare')).toHaveText(/^Comparé aux 3 jours d'avant$/);
    });

    test('« Un jour précis » : comparé à la veille', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [dix(ilYa(3)), { quand: ilYa(4), pas: [{ ex: 'Gamme majeure', min: 40 }] }]);
      await ouvrirFenetre(page);
      await choisirPeriode(page, 'Un jour précis…');
      await jourPrecis(page).fill('2026-11-23');
      await expect(valeurTuile(page, 'Temps total')).toHaveText('10 min');
      await expect(contenu(page)).toContainText('Comparé à la veille');
      await expect(deltaTuile(page, 'Temps total')).toHaveText('▼ −75 %');
    });

    test('périodes en jours glissants (7, 28, 90, Tout) : pas de comparaison', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, SEPT);
      await ouvrirFenetre(page);
      for (const p of ['7 jours', '28 jours', '90 jours', 'Tout']) {
        await choisirPeriode(page, p);
        await expect(contenu(page).locator('.st-compare')).toHaveCount(0);
        await expect(contenu(page).locator('.st-tile-d')).toHaveCount(0);
      }
    });
  });

  test.describe('un jour précis', () => {
    test('le champ date n\'apparaît que pour « Un jour précis… » ; il propose aujourd\'hui et refuse l\'avenir', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, SEPT);
      await ouvrirFenetre(page);
      await expect(jourPrecis(page)).toBeHidden();
      await choisirPeriode(page, 'Un jour précis…');
      await expect(jourPrecis(page)).toBeVisible();
      await expect(jourPrecis(page)).toHaveValue('2026-11-26');
      await expect(jourPrecis(page)).toHaveAttribute('max', '2026-11-26');
      await choisirPeriode(page, '7 jours');
      await expect(jourPrecis(page)).toBeHidden();
    });

    test('choisir un jour affiche ses séances seulement ; un jour sans séance le dit @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [
        { quand: ilYa(3, '07:15'), nom: 'Matin', pas: [{ ex: 'Gamme majeure', min: 10 }] },
        { quand: ilYa(3, '21:00'), nom: 'Soir', pas: [{ ex: 'Croches', min: 15, sous: 'Rythme' }] },
        dix(ilYa(2)),
      ]);
      await ouvrirFenetre(page);
      await choisirPeriode(page, 'Un jour précis…');
      await jourPrecis(page).fill('2026-11-23');
      await expect(valeurTuile(page, 'Sessions')).toHaveText('2');
      await expect(valeurTuile(page, 'Temps total')).toHaveText('25 min');
      await expect(valeurTuile(page, 'Exercices')).toHaveText('2');
      await expect(valeurTuile(page, 'Durée moyenne')).toHaveText('13 min');
      await expect(contenu(page).locator('.st-tree-sess .gs-stat-l')).toHaveText(['21:00 · Soir', '07:15 · Matin']);   // la plus récente d'abord
      await jourPrecis(page).fill('2026-11-20');
      await expect(valeurTuile(page, 'Sessions')).toHaveText('0');
      await expect(contenu(page)).toContainText('Pas encore de session enregistrée sur cette période.');
    });
  });

  test.describe('« Statistiques comptées à partir du »', () => {
    const SEANCES = [dix(ilYa(20)), dix(ilYa(10)), dix(ilYa(2))];

    test('le champ propose le jour de la première séance', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, SEANCES);
      await ouvrirFenetre(page);
      await expect(contenu(page).getByLabel('Début des statistiques')).toHaveValue('2026-11-06');
      await expect(contenu(page).getByRole('button', { name: 'Automatique' })).toHaveCount(0);
    });

    test('choisir une date exclut les séances d\'avant (et les jours d\'avant) ; « Automatique » revient au premier jour @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, SEANCES);
      await ouvrirFenetre(page);
      await expect(valeurTuile(page, 'Sessions')).toHaveText('3');
      await expect(valeurTuile(page, 'Jours pratiqués')).toHaveText('3 / 21');
      await contenu(page).getByLabel('Début des statistiques').fill('2026-11-20');
      await expect(valeurTuile(page, 'Sessions')).toHaveText('1');
      await expect(valeurTuile(page, 'Jours pratiqués')).toHaveText('1 / 7');
      await expect(contenu(page).getByLabel('Début des statistiques')).toHaveValue('2026-11-20');
      expect((await reglagesStats(page)).since).toBe('2026-11-20');
      await contenu(page).getByRole('button', { name: 'Automatique' }).click();
      await expect(valeurTuile(page, 'Sessions')).toHaveText('3');
      await expect(contenu(page).getByLabel('Début des statistiques')).toHaveValue('2026-11-06');
      await expect(contenu(page).getByRole('button', { name: 'Automatique' })).toHaveCount(0);
      expect((await reglagesStats(page)).since).toBe('');
    });

    test('la date choisie est gardée avec les données : elle survit au rechargement', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, SEANCES);
      await ouvrirFenetre(page);
      await contenu(page).getByLabel('Début des statistiques').fill('2026-11-20');
      await expect(valeurTuile(page, 'Sessions')).toHaveText('1');
      await page.reload();
      await expect(page.locator('#folder-container')).toBeAttached();
      await ouvrirFenetre(page);
      await expect(contenu(page).getByLabel('Début des statistiques')).toHaveValue('2026-11-20');
      await expect(valeurTuile(page, 'Sessions')).toHaveText('1');
    });

    test('le champ n\'accepte pas une date dans le futur (maximum = aujourd\'hui)', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, SEANCES);
      await ouvrirFenetre(page);
      await expect(contenu(page).getByLabel('Début des statistiques')).toHaveAttribute('max', '2026-11-26');
    });

    test('elle vaut pour tous les onglets : les exercices d\'avant la date disparaissent de « Exercices »', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(20), pas: [{ ex: 'Arpèges', min: 10 }] }, { quand: ilYa(2), pas: [{ ex: 'Gamme majeure', min: 10 }] }]);
      await ouvrirFenetre(page);
      await contenu(page).getByLabel('Début des statistiques').fill('2026-11-20');
      await ongletStats(page, 'Exercices').click();
      await expect(contenu(page).locator('.st-ex-name').filter({ hasText: /^Gamme majeure/ })).toBeVisible();
      await expect(contenu(page).locator('.st-ex-name').filter({ hasText: /^Arpèges/ })).toHaveCount(0);
    });
  });

  test('changer d\'onglet puis revenir garde la période choisie', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, SEPT);
    await ouvrirFenetre(page);
    await choisirPeriode(page, '7 jours');
    await ongletStats(page, 'Répartition').click();
    await ongletStats(page, 'Aperçu').click();
    await expect(fenetre(page).getByRole('combobox', { name: 'Période' })).toHaveValue('7');
    await expect(valeurTuile(page, 'Sessions')).toHaveText('3');
    await expect(tuile(page, 'Sessions')).toBeVisible();
  });
});
