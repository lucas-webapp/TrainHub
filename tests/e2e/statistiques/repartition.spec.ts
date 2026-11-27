// MODULE « statistiques » — ONGLET « RÉPARTITION » : camembert des chapitres, camembert des premiers sous-dossiers (filtrable par chapitre), « Les plus travaillés », « Mes favoris »,
// « Exercices sous-utilisés », réglage « Quand un exercice change de chapitre ». Observé en boîte noire (playwright-cli, 26/11/2026, horloge figée au 26/11/2026 10:00).
import { test, expect } from '../support/fixtures';
import type { EspaceDepart } from '../bibliotheque/aide-bibliotheque';
import { aller, choisirPeriode, contenu, ilYa, lignesBloc, ouvrirFenetre, ouvrirStats, reglagesStats, section } from './aide-statistiques';

const legende = (page: any, i: 0 | 1) => contenu(page).locator('.st-pie-wrap').nth(i).locator('.st-pie-row').evaluateAll((els) => els.map((e) => {
  const nom = e.querySelector('.st-pie-name')!.cloneNode(true) as HTMLElement;
  const petit = nom.querySelector('small')?.textContent ?? '';
  nom.querySelector('small')?.remove();
  return `${nom.textContent}${petit ? ` (${petit})` : ''} | ${e.querySelector('.st-pie-val')!.textContent}`;
}));
const parts = (page: any, i: 0 | 1) => contenu(page).locator('.st-pie-wrap').nth(i).locator('svg.st-pie .st-slice');

test.describe('Statistiques : onglet Répartition @statistiques', () => {
  test.describe('camembert des chapitres', () => {
    test('chaque chapitre : part du temps et durée, le plus gros d\'abord et mis en avant @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(1), pas: [{ ex: 'Gamme majeure', min: 30 }, { ex: 'Blues en la', min: 20, chap: 'Improvisation' }] }, { quand: ilYa(2), pas: [{ ex: 'Arpèges', min: 10 }] }]);
      await ouvrirFenetre(page);
      await aller(page, 'Répartition');
      expect(await legende(page, 0)).toEqual(['Technique | 67 % · 40 min', 'Improvisation | 33 % · 20 min']);
      await expect(parts(page, 0)).toHaveCount(2);
      await expect(contenu(page).locator('.st-pie-wrap').first().locator('.st-pie-row').first()).toHaveClass(/st-pie-top/);
      await expect(contenu(page).locator('.st-pie-wrap').first().locator('svg.st-pie')).toHaveAttribute('aria-label', 'Répartition du temps');
      expect(await parts(page, 0).first().locator('title').textContent()).toBe('Technique : 67 % · 40 min');
    });

    test('un seul chapitre : un disque entier', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(1), pas: [{ ex: 'Gamme majeure', min: 30 }] }]);
      await ouvrirFenetre(page);
      await aller(page, 'Répartition');
      expect(await legende(page, 0)).toEqual(['Technique | 100 % · 30 min']);
      await expect(contenu(page).locator('.st-pie-wrap').first().locator('circle.st-slice')).toHaveCount(1);
    });

    const NEUF: EspaceDepart[] = [{ nom: 'Basse', chapitres: Array.from({ length: 9 }, (_, i) => ({ nom: `Chap ${i + 1}`, exercices: [`Exo ${i + 1}`] })) }];
    test('au-delà de huit chapitres, les plus petits sont regroupés sous « Autres (n) »', async ({ page, ouvrirAppli }) => {
      const S = [{ quand: ilYa(1), pas: Array.from({ length: 9 }, (_, i) => ({ ex: `Exo ${i + 1}`, min: 10 + (9 - i) * 2, chap: `Chap ${i + 1}` })) }];   // 28, 26, … 12 min
      await ouvrirStats(page, ouvrirAppli, S, { espaces: NEUF });
      await ouvrirFenetre(page);
      await aller(page, 'Répartition');
      const l = await legende(page, 0);
      expect(l).toHaveLength(8);
      expect(l[0]).toBe('Chap 1 | 16 % · 28 min');       // 28 min sur 180
      expect(l[6]).toBe('Chap 7 | 9 % · 16 min');
      expect(l[7]).toBe('Autres (2) | 14 % · 26 min');   // Chap 8 (14 min) + Chap 9 (12 min)
    });
  });

  test.describe('premiers sous-dossiers', () => {
    const S = [{ quand: ilYa(1), pas: [{ ex: 'Gamme majeure', min: 20 }, { ex: 'Croches', min: 10, sous: 'Rythme' }, { ex: 'Blues en la', min: 30, chap: 'Improvisation' }] }];

    test('tous les chapitres : « Directement dans le chapitre » et chaque dossier, avec le chapitre en petit', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, S);
      await ouvrirFenetre(page);
      await aller(page, 'Répartition');
      expect(await legende(page, 1)).toEqual(['Directement dans le chapitre | 83 % · 50 min', 'Rythme (Technique) | 17 % · 10 min']);
    });

    test('la liste « Chapitre » filtre les dossiers d\'un seul chapitre @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, S);
      await ouvrirFenetre(page);
      await aller(page, 'Répartition');
      const choix = contenu(page).getByRole('combobox', { name: 'Chapitre' });
      await expect(choix.locator('option')).toHaveText(['Tous les chapitres', 'Technique', 'Improvisation']);
      await choix.selectOption({ label: 'Technique' });
      expect(await legende(page, 1)).toEqual(['Directement dans le chapitre | 67 % · 20 min', 'Rythme | 33 % · 10 min']);
      await choix.selectOption({ label: 'Improvisation' });
      expect(await legende(page, 1)).toEqual(['Directement dans le chapitre | 100 % · 30 min']);
      await choix.selectOption({ label: 'Tous les chapitres' });
      await expect(parts(page, 1)).toHaveCount(2);
    });

    test('un chapitre qui n\'a plus de temps sur une autre période disparaît de la liste (retour à « Tous »)', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(1), pas: [{ ex: 'Gamme majeure', min: 20 }] }, { quand: ilYa(20), pas: [{ ex: 'Blues en la', min: 30, chap: 'Improvisation' }] }]);
      await ouvrirFenetre(page);
      await choisirPeriode(page, '28 jours');
      await aller(page, 'Répartition');
      const choix = contenu(page).getByRole('combobox', { name: 'Chapitre' });
      await choix.selectOption({ label: 'Improvisation' });
      await choisirPeriode(page, '3 derniers jours');
      await expect(choix).toHaveValue('');
      await expect(choix.locator('option')).toHaveText(['Tous les chapitres', 'Technique']);
    });
  });

  test.describe('les plus travaillés', () => {
    test('cinq exercices au plus, par temps décroissant, avec le nombre de séances ; le premier en avant @critique', async ({ page, ouvrirAppli }) => {
      const exos = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7'];
      const espaces: EspaceDepart[] = [{ nom: 'Basse', chapitres: [{ nom: 'Technique', exercices: exos }] }];
      const S = exos.map((e, i) => ({ quand: ilYa(i + 1), pas: [{ ex: e, min: 5 + i * 5 }] }));
      S.push({ quand: ilYa(10), pas: [{ ex: 'E1', min: 5 }] });
      await ouvrirStats(page, ouvrirAppli, S, { espaces });
      await ouvrirFenetre(page);
      await aller(page, 'Répartition');
      expect(await lignesBloc(section(page, 'Les plus travaillés'))).toEqual(['E7 | 35 min · 1×', 'E6 | 30 min · 1×', 'E5 | 25 min · 1×', 'E4 | 20 min · 1×', 'E3 | 15 min · 1×']);
      await expect(section(page, 'Les plus travaillés').locator('.gs-stat-row').first()).toHaveClass(/st-top/);
    });

    test('un exercice fait plusieurs fois cumule son temps et affiche « n× »', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(1), pas: [{ ex: 'Gamme majeure', min: 10 }] }, { quand: ilYa(2), pas: [{ ex: 'Gamme majeure', min: 12 }] }, { quand: ilYa(3), pas: [{ ex: 'Arpèges', min: 15 }] }]);
      await ouvrirFenetre(page);
      await aller(page, 'Répartition');
      expect(await lignesBloc(section(page, 'Les plus travaillés'))).toEqual(['Gamme majeure | 22 min · 2×', 'Arpèges | 15 min · 1×']);
    });

    test('deux exercices de même titre dans deux chapitres : le chapitre les distingue', async ({ page, ouvrirAppli }) => {
      const espaces: EspaceDepart[] = [{ nom: 'Basse', chapitres: [{ nom: 'Technique', exercices: ['Gamme'] }, { nom: 'Improvisation', exercices: ['Gamme'] }] }];
      // deux exercices ont le même identifiant dans cet état : on pose donc des identifiants différents dans le journal
      await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(1), pas: [{ ex: 'Gamme', min: 10, id: 'ex-gamme-a' }, { ex: 'Gamme', min: 8, chap: 'Improvisation', id: 'ex-gamme-b' }] }], { espaces });
      await ouvrirFenetre(page);
      await aller(page, 'Répartition');
      const l = await lignesBloc(section(page, 'Les plus travaillés'));
      expect(l).toEqual(['Gamme (Technique) | 10 min · 1×', 'Gamme (Improvisation) | 8 min · 1×']);
    });

    test('sur une période courte, jusqu\'à quinze exercices', async ({ page, ouvrirAppli }) => {
      const exos = Array.from({ length: 16 }, (_, i) => `X${String(i + 1).padStart(2, '0')}`);
      const espaces: EspaceDepart[] = [{ nom: 'Basse', chapitres: [{ nom: 'Technique', exercices: exos }] }];
      await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(1), pas: exos.map((e, i) => ({ ex: e, min: 1 + i })) }], { espaces });
      await ouvrirFenetre(page);
      await choisirPeriode(page, 'Hier');
      await aller(page, 'Répartition');
      await expect(section(page, 'Les plus travaillés').locator('.gs-stat-row')).toHaveCount(15);
      await choisirPeriode(page, '7 jours');
      await expect(section(page, 'Les plus travaillés').locator('.gs-stat-row')).toHaveCount(5);
    });
  });

  test.describe('favoris', () => {
    test('un favori travaillé : durée et « il y a » ; un favori pas travaillé sur la période : « pas travaillé (…) » @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [
        { quand: ilYa(1, '07:00'), pas: [{ ex: 'Gamme majeure', min: 20 }] },
        { quand: ilYa(40, '07:00'), pas: [{ ex: 'Arpèges', min: 10 }] },
      ], { favoris: ['Gamme majeure', 'Arpèges', 'Blues en la'] });
      await ouvrirFenetre(page);
      await aller(page, 'Répartition');
      const l = await lignesBloc(section(page, /^Mes favoris/i));
      expect(l).toEqual(['Gamme majeure | 20 min · hier', 'Arpèges | pas travaillé (il y a 40 j)', 'Blues en la | pas travaillé (jamais)']);
    });

    test('une séance d\'hier soir est dite « hier » (et non « aujourd\'hui ») le lendemain matin', async ({ page, ouvrirAppli }) => {
      test.fail(true, 'ST-04 : « il y a N jours » compte des blocs de 24 h écoulées, pas des jours civils : une séance d\'hier 18 h vue à 10 h est dite « aujourd\'hui » (et celle d\'il y a 40 jours « il y a 39 j »), alors que la fiche d\'un exercice dit « hier ».');
      await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(1, '18:00'), pas: [{ ex: 'Gamme majeure', min: 20 }] }], { favoris: ['Gamme majeure'] });
      await ouvrirFenetre(page);
      await aller(page, 'Répartition');
      expect(await lignesBloc(section(page, /^Mes favoris/i))).toEqual(['Gamme majeure | 20 min · hier']);
    });

    test('sans favori, la section n\'existe pas ; un favori archivé n\'y figure pas', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(1), pas: [{ ex: 'Gamme majeure', min: 20 }] }], { favoris: ['Blues en la'], archives: ['Blues en la'] });
      await ouvrirFenetre(page);
      await aller(page, 'Répartition');
      await expect(contenu(page).locator('.gs-stat-title').filter({ hasText: /favoris/i })).toHaveCount(0);
    });

    test('« aujourd\'hui » pour un favori travaillé ce matin', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(0, '08:00'), pas: [{ ex: 'Gamme majeure', min: 20 }] }], { favoris: ['Gamme majeure'] });
      await ouvrirFenetre(page);
      await aller(page, 'Répartition');
      expect(await lignesBloc(section(page, /^Mes favoris/i))).toEqual(['Gamme majeure | 20 min · aujourd\'hui']);
    });
  });

  test.describe('exercices sous-utilisés', () => {
    test('ceux qui n\'ont pas servi sur la période, le plus ancien passage d\'abord ; « jamais travaillé » en tête @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [
        { quand: ilYa(1, '07:00'), pas: [{ ex: 'Gamme majeure', min: 20 }] },
        { quand: ilYa(60, '07:00'), pas: [{ ex: 'Arpèges', min: 10 }] },
      ]);
      await ouvrirFenetre(page);
      await aller(page, 'Répartition');
      expect(await lignesBloc(section(page, 'Exercices sous-utilisés'))).toEqual(['Croches | jamais travaillé', 'Blues en la | jamais travaillé', 'Arpèges | dernier passage il y a 60 j']);
    });

    test('au-delà de huit : « … et N autres » ; les exercices archivés n\'y sont pas', async ({ page, ouvrirAppli }) => {
      const exos = Array.from({ length: 12 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`);
      const espaces: EspaceDepart[] = [{ nom: 'Basse', chapitres: [{ nom: 'Technique', exercices: ['Joué', ...exos] }] }];
      await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(1), pas: [{ ex: 'Joué', min: 10 }] }], { espaces, archives: ['S12'] });
      await ouvrirFenetre(page);
      await aller(page, 'Répartition');
      await expect(section(page, 'Exercices sous-utilisés').locator('.gs-stat-row')).toHaveCount(8);
      await expect(section(page, 'Exercices sous-utilisés')).toContainText('… et 3 autres');   // 11 non archivés − 8 affichés
    });

    test('tous les exercices ont été joués : message ; un exercice dans un dossier montre son chemin en info-bulle', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(1), pas: [{ ex: 'Gamme majeure', min: 10 }, { ex: 'Arpèges', min: 10 }, { ex: 'Blues en la', min: 10, chap: 'Improvisation' }] }]);
      await ouvrirFenetre(page);
      await aller(page, 'Répartition');
      expect(await lignesBloc(section(page, 'Exercices sous-utilisés'))).toEqual(['Croches | jamais travaillé']);
      await expect(section(page, 'Exercices sous-utilisés').locator('.gs-stat-row').first()).toHaveAttribute('title', 'Technique › Rythme');
    });

    test('sur une période courte la section n\'existe pas', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(0, '08:00'), pas: [{ ex: 'Gamme majeure', min: 10 }] }]);
      await ouvrirFenetre(page);
      await choisirPeriode(page, 'Aujourd\'hui');
      await aller(page, 'Répartition');
      await expect(contenu(page).locator('.gs-stat-title').filter({ hasText: /sous-utilisés/i })).toHaveCount(0);
    });
  });

  test.describe('exercice qui change de chapitre', () => {
    test('trois choix, « me demander » au départ ; le choix est gardé avec les données @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(1), pas: [{ ex: 'Gamme majeure', min: 10 }] }]);
      await ouvrirFenetre(page);
      await aller(page, 'Répartition');
      const choix = contenu(page).getByRole('combobox', { name: 'Exercice déplacé' });
      await expect(choix.locator('option')).toHaveText(['me demander', 'garder les anciennes séances dans l\'ancien chapitre', 'tout compter dans son chapitre actuel']);
      await expect(choix).toHaveValue('ask');
      await choix.selectOption('follow');
      await expect(choix).toHaveValue('follow');
      expect((await reglagesStats(page)).movePolicy).toBe('follow');
      await page.reload();
      await expect(page.locator('#folder-container')).toBeAttached();
      await ouvrirFenetre(page);
      await aller(page, 'Répartition');
      await expect(contenu(page).getByRole('combobox', { name: 'Exercice déplacé' })).toHaveValue('follow');
    });
  });
});
