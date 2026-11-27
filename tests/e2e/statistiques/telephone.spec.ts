// MODULE « statistiques » — TÉLÉPHONE (≤ 700 px). Observé en boîte noire (playwright-cli, 26/11/2026) : la fenêtre « Statistiques » occupe tout l'écran ; titre et icônes, liste « Période », quatre onglets, contenu
// qui défile, « Fermer » en bas ; le clic droit devient un APPUI LONG (retirer un point de tempo, menu d'un exercice). Mesures : onglets 34 px de haut, boutons de vue 38 px, flèches 34 × 30 px.
import { test, expect } from '../support/fixtures';
import { appuiLong, auTelephone, menuContextuel } from '../bibliotheque/aide-bibliotheque';
import { appuiLongSurBouton, defilementFini, aller, barres, bascule, carte, choisirPeriode, contenu, detailBarre, entreeCarte, fenetre, filtre, ilYa, message, ongletStats, ouvrirFenetre, ouvrirStats, periode, points, valeurTuile } from './aide-statistiques';

/** Cinq séances de la gamme (tempo qui monte) il y a 3 à 10 jours, plus un autre exercice. */
const DONNEES = () => [[10, 80], [8, 100], [6, 90], [4, 95], [3, 95]].map(([j, b]) => ({ quand: ilYa(j, '07:00'), pas: [{ ex: 'Gamme majeure', min: 6, bpm: b }] }))
  .concat([{ quand: ilYa(2, '07:00'), pas: [{ ex: 'Arpèges', min: 6 }] } as any]);
const sansDebordement = (page: any) => expect.poll(() => fenetre(page).evaluate((e) => e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().right <= window.innerWidth + 1)).toBe(true);

test.describe('Statistiques : téléphone @statistiques @mobile', () => {
  test('la fenêtre occupe l\'écran, sans défilement horizontal, onglets et « Fermer » atteignables @critique', async ({ page, ouvrirAppli }) => {
    expect(auTelephone(page)).toBe(true);
    await ouvrirStats(page, ouvrirAppli, DONNEES());
    await ouvrirFenetre(page);
    const v = page.viewportSize()!, b = (await fenetre(page).boundingBox())!;
    expect([Math.round(b.x), Math.round(b.width)]).toEqual([0, v.width]);
    await sansDebordement(page);
    for (const o of ['Aperçu', 'Temps', 'Répartition', 'Exercices'] as const) {
      const t = (await ongletStats(page, o).boundingBox())!;
      expect(t.x, `${o} : bord gauche`).toBeGreaterThanOrEqual(0);
      expect(t.x + t.width, `${o} : bord droit`).toBeLessThanOrEqual(v.width);
    }
    await expect(fenetre(page).getByRole('button', { name: 'Fermer' })).toBeInViewport();
    await expect(periode(page)).toBeInViewport();
  });

  test('chaque onglet tient dans la largeur de l\'écran (contenu compris) @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, DONNEES());
    await ouvrirFenetre(page);
    for (const o of ['Aperçu', 'Temps', 'Répartition', 'Exercices'] as const) {
      await aller(page, o);
      await sansDebordement(page);
      await expect.poll(() => contenu(page).evaluate((e) => e.scrollWidth <= e.clientWidth + 1), { message: `${o} : le contenu ne déborde pas` }).toBe(true);
    }
  });

  test('la période se change avec la liste ; les chiffres suivent', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, DONNEES());
    await ouvrirFenetre(page);
    await expect(valeurTuile(page, 'Sessions')).toHaveText('6');
    await choisirPeriode(page, 'Hier');
    await expect(valeurTuile(page, 'Sessions')).toHaveText('0');
    await choisirPeriode(page, '7 jours');
    await expect(valeurTuile(page, 'Sessions')).toHaveText('4');   // il y a 6, 4, 3 et 2 jours
  });

  test('toucher une barre du graphique ouvre le détail, ✕ le ferme', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, DONNEES());
    await ouvrirFenetre(page);
    await barres(page).last().evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await barres(page).last().click();
    await expect(detailBarre(page)).toBeVisible();
    await expect(detailBarre(page).locator('.st-pick-sum')).toHaveText('6 min · 1 séance · 1 exercice');
    await defilementFini(page);
    await detailBarre(page).getByRole('button', { name: 'Fermer le détail' }).click();
    await expect(detailBarre(page)).toBeHidden();
  });

  test('les deux vues, le filtre et le tri de l\'onglet Exercices se manient au doigt', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, DONNEES(), { sansObjectif: ['Arpèges'] });
    await ouvrirFenetre(page);
    await aller(page, 'Exercices');
    await expect(carte(page, 'Gamme majeure')).toBeVisible();
    await bascule(page, 'Durées').click();
    await expect(carte(page, 'Arpèges')).toBeVisible();
    await filtre(page, 'À surveiller').click();
    await expect(contenu(page).locator('.gs-empty')).toHaveText('Aucun exercice à surveiller sur cette période.');
    await filtre(page, 'Tous').click();
    await entreeCarte(carte(page, 'Arpèges')).click();
    await expect(carte(page, 'Arpèges').locator('svg.st-dur')).toBeVisible();
    await sansDebordement(page);
  });

  test('appui long sur un point de la courbe : le menu « Retirer ce point » ; le retirer puis « Annuler » @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, DONNEES());
    await ouvrirFenetre(page);
    await aller(page, 'Exercices');
    await entreeCarte(carte(page, 'Gamme majeure')).click();
    const c = carte(page, 'Gamme majeure');
    await expect(points(c)).toHaveCount(5);
    await appuiLong(page, points(c).nth(1));
    const menu = page.locator('.st-pt-ctx');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.ctx-title')).toHaveText('18/11/26 07:00 · 100 BPM');
    const v = page.viewportSize()!, m = (await menu.boundingBox())!;
    expect(m.x).toBeGreaterThanOrEqual(0);
    expect(m.x + m.width).toBeLessThanOrEqual(v.width);
    await menu.getByRole('button', { name: 'Retirer ce point des statistiques' }).click();
    await expect(points(carte(page, 'Gamme majeure'))).toHaveCount(4);
    await message(page, 'retiré des statistiques').getByRole('button', { name: 'Annuler' }).click();
    await expect(points(carte(page, 'Gamme majeure'))).toHaveCount(5);
  });

  test('appui long sur une carte d\'exercice : le menu de l\'exercice', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, DONNEES());
    await ouvrirFenetre(page);
    await aller(page, 'Exercices');
    await appuiLongSurBouton(page, entreeCarte(carte(page, 'Gamme majeure')));
    await expect(menuContextuel(page).getByRole('button', { name: 'Ouvrir dans son dossier' })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('les commandes tactiles ont au moins 24 px de côté (onglets, vues, filtres, flèches, fermer)', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, DONNEES());
    await ouvrirFenetre(page);
    const petits: string[] = [];
    const mesurer = async (nom: string, l: any) => { const n = await l.count(); for (let i = 0; i < n; i++) { const b = await l.nth(i).boundingBox(); if (b && (b.width < 24 || b.height < 24)) petits.push(`${nom} ${Math.round(b.width)}×${Math.round(b.height)}`); } };
    await mesurer('onglet', fenetre(page).getByRole('tab'));
    await mesurer('Fermer', fenetre(page).getByRole('button', { name: 'Fermer' }));
    await mesurer('flèche', contenu(page).locator('.st-chart-arrow'));
    await mesurer('icône du titre', fenetre(page).locator('.gs-nav-icons button'));
    await aller(page, 'Exercices');
    await mesurer('vue', contenu(page).locator('.st-ex-mode-btn'));
    await mesurer('filtre', contenu(page).locator('.st-ex-chips .cal-pick-chip'));
    await mesurer('tri', triListe(page));
    expect(petits).toEqual([]);
  });

  test('la zone sensible d\'un point de la courbe de tempo fait au moins 24 px', async ({ page, ouvrirAppli }) => {
    test.fail(true, 'ST-05 : au téléphone, la zone qui reçoit l\'appui long d\'un point de la courbe de tempo mesure ≈ 17,6 px (cercle de rayon 12 en unités de la courbe, réduit avec l\'écran) : sous les 24 px recommandés (WCAG 2.2, 2.5.8), difficile à viser à côté d\'un point voisin.');
    await ouvrirStats(page, ouvrirAppli, DONNEES());
    await ouvrirFenetre(page);
    await aller(page, 'Exercices');
    await entreeCarte(carte(page, 'Gamme majeure')).click();
    const b = (await carte(page, 'Gamme majeure').locator('g.st-pt circle.st-hit').first().boundingBox())!;
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(24);
  });

  test('« Fermer » ramène à l\'écran Session guidée', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, DONNEES());
    await ouvrirFenetre(page);
    await fenetre(page).getByRole('button', { name: 'Fermer' }).click();
    await expect(fenetre(page)).toBeHidden();
    await expect(page.getByRole('button', { name: '+ Nouvelle session' })).toBeVisible();
  });
});

const triListe = (page: any) => contenu(page).getByRole('combobox', { name: 'Trier' });
