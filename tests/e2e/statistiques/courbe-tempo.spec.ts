// MODULE « statistiques » — COURBE DE TEMPO d'un exercice (meilleur BPM de chaque séance), retrait d'un point par clic droit (« Annuler » possible), graphique de DURÉE des exercices sans objectif.
// Observé en boîte noire (playwright-cli, 26/11/2026, horloge figée au 26/11/2026 10:00). Un point = une séance ; clic droit (appui long au téléphone) = menu « Retirer ce point des statistiques » :
// seul le tempo de la séance est vidé, le temps passé reste. Un message de 8 s propose « Annuler ».
import { test, expect } from '../support/fixtures';
import { aller, bascule, carte, choisirPeriode, contenu, courbe, entreeCarte, ilYa, journalMois, message, ouvrirFenetre, ouvrirStats, points } from './aide-statistiques';

/** Séances étalées de 2 jours en 2 jours (la dernière il y a 3 jours, à 7 h), une par tempo. Identifiants r0, r1…. */
const serie = (ex: string, bpms: Array<number | [number, number]>, plus: Record<string, unknown> = {}) => bpms.map((b, i) => ({ quand: ilYa(2 * (bpms.length - 1 - i) + 3, '07:00'), pas: [{ ex, min: 6, bpm: b, ...plus }] }));
const menuPoint = (page: any) => page.locator('.st-pt-ctx');
async function ouvrirCarte(page: any, titre = 'Gamme majeure') {
  await ouvrirFenetre(page);
  await aller(page, 'Exercices');
  await entreeCarte(carte(page, titre)).click();
  return carte(page, titre);
}

test.describe('Statistiques : courbe de tempo et durées @statistiques', () => {
  test.describe('courbe de tempo', () => {
    test('un point par séance, relié par une ligne ; premier et dernier tempo écrits ; dates aux extrémités @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, serie('Gamme majeure', [80, 85, 90, 95]));
      const c = await ouvrirCarte(page);
      await expect(courbe(c)).toBeVisible();
      await expect(courbe(c)).toHaveAttribute('aria-label', 'Progression du tempo');
      await expect(points(c)).toHaveCount(4);
      await expect(c.locator('svg.st-tempo polyline.st-line')).toHaveCount(1);
      await expect(c.locator('svg.st-tempo circle.st-dot-hi')).toHaveCount(1);   // le dernier point est mis en avant
      const textes = await c.locator('svg.st-tempo text.st-axis-strong').allTextContents();
      expect(textes).toEqual(['80', '95']);
      const dates = await c.locator('svg.st-tempo text.st-axis').filter({ hasText: /^\d{1,2}\/\d{1,2}$/ }).allTextContents();
      expect(dates).toEqual(['17/11', '23/11']);
      await expect(c.locator('.st-sub-title')).toHaveText(/Progression du tempo \(meilleur BPM de chaque séance\)/i);
    });

    test('l\'info-bulle d\'un point donne la date, le tempo et le tempo de départ s\'il diffère', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, serie('Gamme majeure', [80, [85, 100], 90]));
      const c = await ouvrirCarte(page);
      const bulles = await points(c).evaluateAll((els) => els.map((e) => e.querySelector('title')!.textContent));
      expect(bulles).toEqual(['19/11 : 80 BPM', '21/11 : 100 BPM (départ 85)', '23/11 : 90 BPM']);
    });

    test('chaque point est atteignable au clavier et décrit son menu', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, serie('Gamme majeure', [80, 90]));
      const c = await ouvrirCarte(page);
      await expect(points(c).first()).toHaveAttribute('tabindex', '0');
      await expect(points(c).first()).toHaveAttribute('aria-label', '21/11 : 80 BPM — menu : retirer ce point');
    });

    test('une seule séance avec tempo : pas de courbe, un texte explique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, serie('Gamme majeure', [80]));
      const c = await ouvrirCarte(page);
      await expect(courbe(c)).toHaveCount(0);
      await expect(c.locator('.st-hint')).toHaveText('Un seul tempo noté pour l\'instant : la courbe apparaît à partir de deux séances.');
    });

    test('aucun tempo noté : le texte invite à lancer le métronome', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(2), pas: [{ ex: 'Gamme majeure', min: 6 }] }, { quand: ilYa(3), pas: [{ ex: 'Gamme majeure', min: 6 }] }]);
      const c = await ouvrirCarte(page);
      await expect(courbe(c)).toHaveCount(0);
      await expect(c.locator('.st-hint')).toHaveText('Aucun tempo noté sur cette période : lancez le métronome pendant l\'exercice pour que son tempo soit suivi.');
    });

    test('la courbe ne couvre que la période choisie', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [...serie('Gamme majeure', [80, 85, 90]), { quand: ilYa(40, '07:00'), pas: [{ ex: 'Gamme majeure', min: 6, bpm: 60 }] }]);
      const c = await ouvrirCarte(page);
      await expect(points(c)).toHaveCount(3);
      await choisirPeriode(page, '90 jours');
      await expect(points(carte(page, 'Gamme majeure'))).toHaveCount(4);
    });

    test('un exercice qui a eu deux tempos dans une même séance garde le meilleur', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, serie('Gamme majeure', [[70, 95], [80, 85]]));
      const c = await ouvrirCarte(page);
      const bulles = await points(c).evaluateAll((els) => els.map((e) => e.querySelector('title')!.textContent));
      expect(bulles).toEqual(['21/11 : 95 BPM (départ 70)', '23/11 : 85 BPM (départ 80)']);
    });
  });

  test.describe('retirer un point', () => {
    const SERIE = () => serie('Gamme majeure', [80, 85, 90, 95]);

    test('clic droit : un menu dit quel point, de quelle séance, et que le temps passé reste compté @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, SERIE());
      const c = await ouvrirCarte(page);
      await points(c).nth(1).click({ button: 'right' });
      await expect(menuPoint(page)).toBeVisible();
      await expect(menuPoint(page).locator('.ctx-title')).toHaveText('19/11/26 07:00 · 85 BPM');
      await expect(menuPoint(page).locator('.ctx-message')).toHaveText('Gamme majeure — séance « Routine ». Seul le tempo de cette séance est retiré : le temps passé reste compté.');
      await expect(menuPoint(page).getByRole('button', { name: 'Retirer ce point des statistiques' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menuPoint(page)).toHaveCount(0);
      await expect(points(c)).toHaveCount(4);
    });

    test('« Retirer ce point » : le point disparaît, le tempo est vidé dans le journal mais pas le temps passé ; un message propose « Annuler » @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, SERIE());
      const c = await ouvrirCarte(page);
      await points(c).nth(1).click({ button: 'right' });
      await menuPoint(page).getByRole('button', { name: 'Retirer ce point des statistiques' }).click();
      await expect(points(carte(page, 'Gamme majeure'))).toHaveCount(3);
      const m = message(page, 'Point du 19/11/26 07:00 (85 BPM) retiré des statistiques');
      await expect(m).toBeVisible();
      await expect(m.getByRole('button', { name: 'Annuler' })).toBeVisible();
      const rec = (await journalMois(page)).find((r) => r.id === 'r1');
      expect(rec.steps[0]).toMatchObject({ bpmFirst: null, bpmMax: null, bpmEnd: null, actualSec: 360, title: 'Gamme majeure' });
      await expect(carte(page, 'Gamme majeure').locator('.st-ex-meta')).toHaveText('3 séances avec tempo');
      await expect(carte(page, 'Gamme majeure').locator('.st-ex-tempo')).toContainText('80 → 95 BPM (+15)');
    });

    test('« Annuler » remet le point (et le message le confirme) @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, SERIE());
      const c = await ouvrirCarte(page);
      await points(c).nth(1).click({ button: 'right' });
      await menuPoint(page).getByRole('button', { name: 'Retirer ce point des statistiques' }).click();
      await expect(points(carte(page, 'Gamme majeure'))).toHaveCount(3);
      await message(page, 'retiré des statistiques').getByRole('button', { name: 'Annuler' }).click();
      await expect(points(carte(page, 'Gamme majeure'))).toHaveCount(4);
      await expect(message(page, 'Point remis dans les statistiques')).toBeVisible();
      const rec = (await journalMois(page)).find((r) => r.id === 'r1');
      expect(rec.steps[0]).toMatchObject({ bpmFirst: 85, bpmMax: 85, bpmEnd: 85 });
    });

    test('retirer le dernier point change le « dernier tempo » de la carte ; il n\'en reste qu\'un : la courbe laisse place au texte', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, serie('Gamme majeure', [80, 90]));
      const c = await ouvrirCarte(page);
      await expect(c.locator('.st-ex-tempo')).toContainText('80 → 90 BPM');
      await points(c).last().click({ button: 'right' });
      await menuPoint(page).getByRole('button', { name: 'Retirer ce point des statistiques' }).click();
      await expect(courbe(carte(page, 'Gamme majeure'))).toHaveCount(0);
      await expect(carte(page, 'Gamme majeure').locator('.st-hint')).toHaveText('Un seul tempo noté pour l\'instant : la courbe apparaît à partir de deux séances.');
      await expect(carte(page, 'Gamme majeure').locator('.st-ex-tempo')).toContainText('80 → 80 BPM');
    });

    test('retirer un point lève une alerte « tempo en recul » devenue sans objet', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, serie('Gamme majeure', [100, 120, 90]));
      const c = await ouvrirCarte(page);
      await expect(c.locator('.st-alert')).toHaveCount(1);
      await points(c).last().click({ button: 'right' });   // le point à 90 BPM
      await menuPoint(page).getByRole('button', { name: 'Retirer ce point des statistiques' }).click();
      await expect(carte(page, 'Gamme majeure').locator('.st-alert')).toHaveCount(0);
      await expect(carte(page, 'Gamme majeure').locator('.st-ex-fine')).toBeVisible();
    });

    test('retirer un point change aussi le détail d\'une barre du graphique de l\'Aperçu (plus de tempo sur cette ligne)', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, serie('Gamme majeure', [80, 90]));
      const c = await ouvrirCarte(page);
      await points(c).first().click({ button: 'right' });
      await menuPoint(page).getByRole('button', { name: 'Retirer ce point des statistiques' }).click();
      await aller(page, 'Aperçu');
      await contenu(page).locator('svg.st-bars rect.st-bar').first().click();
      await expect(contenu(page).locator('.st-pick .st-tree-ex').first()).not.toContainText('BPM');
    });

    test('le tempo retiré le reste après un rechargement', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, SERIE());
      const c = await ouvrirCarte(page);
      await points(c).first().click({ button: 'right' });
      await menuPoint(page).getByRole('button', { name: 'Retirer ce point des statistiques' }).click();
      await expect.poll(async () => (await journalMois(page)).find((r) => r.id === 'r0').steps[0].bpmMax).toBeNull();
      await page.reload();
      await expect(page.locator('#folder-container')).toBeAttached();
      const c2 = await ouvrirCarte(page);
      await expect(points(c2)).toHaveCount(3);
    });
  });

  test.describe('graphique des durées (exercices sans objectif tempo)', () => {
    const duree = (n: number, min: (i: number) => number, prevu = 10) => Array.from({ length: n }, (_, i) => ({ quand: ilYa(n - i + 1, '07:00'), pas: [{ ex: 'Arpèges', min: min(i), prevu }] }));
    async function ouvrirDuree(page: any) {
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      await bascule(page, 'Durées').click();
      await entreeCarte(carte(page, 'Arpèges')).click();
      return carte(page, 'Arpèges');
    }

    test('une barre par séance, un trait pour la durée prévue, une info-bulle « date : durée (prévu …) » @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, duree(3, (i) => 4 + i * 4), { sansObjectif: ['Arpèges'] });
      const c = await ouvrirDuree(page);
      await expect(c.locator('svg.st-dur')).toHaveAttribute('aria-label', 'Durée réelle contre durée prévue, séance par séance');
      await expect(c.locator('svg.st-dur rect.st-bar')).toHaveCount(3);
      await expect(c.locator('svg.st-dur line.st-plan-tick')).toHaveCount(3);
      await expect(c.locator('svg.st-dur rect.st-bar').last()).toHaveClass(/st-bar-hi/);
      const bulles = await c.locator('svg.st-dur rect.st-bar title').allTextContents();
      expect(bulles).toEqual(['22/11 : 4 min (prévu 10 min)', '23/11 : 8 min (prévu 10 min)', '24/11 : 12 min (prévu 10 min)']);
      await expect(c.locator('.st-sub-title')).toHaveText(/Durée réelle de chaque séance \(trait = durée prévue\)/i);
    });

    test('sans durée prévue : pas de trait ni de mention « trait = durée prévue »', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(2), libre: true, pas: [{ ex: 'Arpèges', min: 8 }] }], { sansObjectif: ['Arpèges'] });
      const c = await ouvrirDuree(page);
      await expect(c.locator('svg.st-dur rect.st-bar')).toHaveCount(1);
      await expect(c.locator('svg.st-dur line.st-plan-tick')).toHaveCount(0);
      await expect(c.locator('.st-sub-title')).not.toContainText('trait');
    });

    test('au plus les 24 dernières séances', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, duree(30, () => 10), { sansObjectif: ['Arpèges'] });
      await ouvrirFenetre(page);
      await choisirPeriode(page, '90 jours');
      await aller(page, 'Exercices');
      await bascule(page, 'Durées').click();
      await entreeCarte(carte(page, 'Arpèges')).click();
      await expect(carte(page, 'Arpèges').locator('svg.st-dur rect.st-bar')).toHaveCount(24);
      await expect(carte(page, 'Arpèges').locator('svg.st-dur rect.st-bar title').last()).toHaveText(/^24\/11 : 10 min/);
    });
  });
});
