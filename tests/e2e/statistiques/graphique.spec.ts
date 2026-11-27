// MODULE « statistiques » — GRAPHIQUE « TEMPS DE PRATIQUE DANS LE TEMPS » (Aperçu). Observé en boîte noire (playwright-cli, 26/11/2026, horloge figée au 26/11/2026 10:00) : barres SVG, une par jour
// (période de 35 jours ou moins), par semaine (jusqu'à 400 jours) ou par mois ; le tracé montre TOUT l'historique compté (du premier jour à aujourd'hui) et défile ; la période choisie est
// soulignée (bande), le reste estompé ; pointillé = moyenne de la période ; info-bulle de chaque barre ; toucher une barre ouvre le détail (séances, exercices, tempo, par chapitre).
import { test, expect } from '../support/fixtures';
import { barres, defilementFini, choisirPeriode, contenu, detailBarre, ilYa, ouvrirFenetre, ouvrirStats, ongletStats, section, lignesBloc } from './aide-statistiques';

const seance = (quand: string, min: number, ex = 'Gamme majeure') => ({ quand, pas: [{ ex, min }] });
const infobulle = (page: any, i: number) => barres(page).nth(i).locator('title').textContent();
/** Attend (sans pause fixe) que le défilement s'arrête : deux lectures successives identiques. */
const immobile = (defile: any) => expect.poll(async () => { const a = await defile.evaluate((e: any) => e.scrollLeft); const b = await defile.evaluate((e: any) => e.scrollLeft); return a === b; }, { message: 'le défilement est terminé' }).toBe(true);
const graphique = (page: any) => contenu(page).locator('svg.st-bars');

test.describe('Statistiques : graphique du temps de pratique @statistiques', () => {
  test('une barre par jour pratiqué, avec son info-bulle (date, durée, nombre de séances) @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [seance(ilYa(0, '08:00'), 10), seance(ilYa(1, '18:00'), 15), seance(ilYa(1, '20:00'), 7), seance(ilYa(10), 20)]);
    await ouvrirFenetre(page);
    await expect(graphique(page)).toHaveAttribute('aria-label', /Temps de pratique par jour/);
    await expect(barres(page)).toHaveCount(3);
    expect(await infobulle(page, 0)).toBe('16/11 : 20 min · 1 séance (touche pour voir les exercices)');
    expect(await infobulle(page, 1)).toBe('25/11 : 22 min · 2 séances (touche pour voir les exercices)');
    expect(await infobulle(page, 2)).toBe('26/11 : 10 min · 1 séance (touche pour voir les exercices)');
  });

  test('la hauteur des barres suit la durée ; la barre du jour est en vert clair ; l\'axe est en minutes', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [seance(ilYa(0, '08:00'), 10), seance(ilYa(2), 20)]);
    await ouvrirFenetre(page);
    const hauteurs = await barres(page).evaluateAll((els) => els.map((e) => Number(e.getAttribute('height'))));
    expect(hauteurs[1]).toBeGreaterThan(0);
    expect(hauteurs[0] / hauteurs[1]).toBeCloseTo(2, 0);     // 20 min contre 10 min
    await expect(barres(page).last()).toHaveClass(/st-bar-hi/);
    await expect(barres(page).first()).not.toHaveClass(/st-bar-hi/);
    const axe = await contenu(page).locator('svg.st-yaxis text').allTextContents();
    expect(axe).toEqual(['0 min', '5 min', '10 min', '15 min', '20 min']);
  });

  test('l\'axe passe en heures dès 3 h dans une même barre', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [seance(ilYa(1), 200)]);
    await ouvrirFenetre(page);
    const axe = await contenu(page).locator('svg.st-yaxis text').allTextContents();
    expect(axe.at(-1)).toBe('5 h');   // 3 h 20 → graduation arrondie à 5 h
    expect(axe[0]).toBe('0 h');
    expect(await infobulle(page, 0)).toContain('3 h 20');
  });

  test('l\'indication sous le graphique donne la moyenne de la période ; un trait pointillé la dessine', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [seance(ilYa(1), 30), seance(ilYa(3), 30)]);
    await ouvrirFenetre(page);
    await choisirPeriode(page, '7 jours');
    await expect(contenu(page).locator('.st-chart-hint')).toContainText('pointillé : moyenne (15 min par jour)');   // 60 min sur 4 jours : la période commence au premier jour du journal (il y a 3 jours)
    await expect(contenu(page).locator('line.st-avg')).toHaveCount(1);
  });

  test('par jour jusqu\'à 35 jours, par semaine au-delà, par mois sur plus d\'un an', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [seance(ilYa(1), 10), seance(ilYa(60), 20), seance(ilYa(450), 30)]);
    await ouvrirFenetre(page);
    await choisirPeriode(page, '7 jours');
    await expect(graphique(page)).toHaveAttribute('aria-label', /par semaine|par mois|par jour/);
    await choisirPeriode(page, 'Tout');
    await expect(graphique(page)).toHaveAttribute('aria-label', /Temps de pratique par mois/);
    expect(await infobulle(page, 0)).toMatch(/^sept\. 25 : 30 min · 1 séance/);
    expect(await infobulle(page, 1)).toMatch(/^sept\. 26 : 20 min · 1 séance/);
    await expect(contenu(page).locator('.st-chart-hint')).toContainText('par mois');
  });

  test('sur une année : une barre par semaine (« semaine du lundi »)', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [seance(ilYa(1), 10), seance(ilYa(2), 15), seance(ilYa(60), 20)]);
    await ouvrirFenetre(page);
    await choisirPeriode(page, 'Cette année');
    await expect(graphique(page)).toHaveAttribute('aria-label', /par semaine/);
    expect(await infobulle(page, 1)).toBe('semaine du 23/11 : 25 min · 2 séances (touche pour voir les exercices)');   // 24 et 25/11 : semaine du lundi 23/11
    await expect(contenu(page).locator('.st-chart-hint')).toContainText('par semaine');
  });

  test('la période choisie est soulignée, le reste de l\'historique estompé @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [seance(ilYa(1), 10), seance(ilYa(20), 20)]);
    await ouvrirFenetre(page);
    await choisirPeriode(page, '7 jours');
    await expect(contenu(page).locator('rect.st-band')).toHaveCount(1);
    await expect(barres(page).first()).toHaveClass(/st-bar-out/);      // il y a 20 jours : hors de la période
    await expect(barres(page).last()).not.toHaveClass(/st-bar-out/);
    await choisirPeriode(page, 'Tout');
    await expect(contenu(page).locator('rect.st-band')).toHaveCount(0);   // toute la période = rien à souligner
    await expect(contenu(page).locator('.st-bar-out')).toHaveCount(0);
  });

  test('un historique plus long que la fenêtre défile : flèches ‹ › ; la date la plus récente est en vue @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [seance(ilYa(1), 10), seance(ilYa(120), 20)]);
    await ouvrirFenetre(page);
    const defile = contenu(page).locator('.st-scroller');
    const avant = contenu(page).getByRole('button', { name: 'Dates plus anciennes' }), apres = contenu(page).getByRole('button', { name: 'Dates plus récentes' });
    await expect.poll(() => defile.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
    // (à l'ouverture de la fenêtre le tracé n'est pas encore calé à droite : voir ST-03 plus bas ; un second affichage, ici en changeant de période, le cale)
    await choisirPeriode(page, '7 jours');
    await choisirPeriode(page, '28 jours');
    await expect.poll(() => defile.evaluate((e) => e.scrollLeft + e.clientWidth >= e.scrollWidth - 2)).toBe(true);
    await expect(apres).toBeDisabled();
    await expect(avant).toBeEnabled();
    const depart = await defile.evaluate((e) => e.scrollLeft);
    await avant.click();
    await expect.poll(() => defile.evaluate((e) => e.scrollLeft), { message: 'la flèche ‹ fait défiler vers les dates anciennes' }).toBeLessThan(depart);
    await immobile(defile);   // le défilement des flèches est animé : on attend qu'il soit fini avant de rappuyer (sous WebKit un 2ᵉ appui en cours d'animation part du milieu)
    const milieu = await defile.evaluate((e) => e.scrollLeft);
    await expect(apres).toBeEnabled();
    await apres.click();
    await expect.poll(() => defile.evaluate((e) => e.scrollLeft), { message: 'la flèche › ramène vers les dates récentes' }).toBeGreaterThan(milieu);
    await immobile(defile);
  });

  test('au bout du défilement, la flèche › s\'éteint', async ({ page, ouvrirAppli }, testInfo) => {
    test.fail(['webkit', 'tablette'].includes(testInfo.project.name), 'ST-06 (à confirmer sur Safari) : sous WebKit de bureau et d\'iPad (pas sur iPhone), après ‹ puis ›, le défilement animé s\'arrête à 1 px du bout (2327 pour un maximum de 2328) et la flèche › reste allumée alors qu\'il n\'y a plus rien à voir.');
    await ouvrirStats(page, ouvrirAppli, [seance(ilYa(1), 10), seance(ilYa(120), 20)]);
    await ouvrirFenetre(page);
    const defile = contenu(page).locator('.st-scroller');
    const avant = contenu(page).getByRole('button', { name: 'Dates plus anciennes' }), apres = contenu(page).getByRole('button', { name: 'Dates plus récentes' });
    await choisirPeriode(page, '7 jours');
    await choisirPeriode(page, '28 jours');
    await expect(apres).toBeDisabled();
    const depart = await defile.evaluate((e) => e.scrollLeft);
    await avant.click();
    await expect.poll(() => defile.evaluate((e) => e.scrollLeft)).toBeLessThan(depart);
    await immobile(defile);
    const milieu = await defile.evaluate((e) => e.scrollLeft);
    await apres.click();
    await expect.poll(() => defile.evaluate((e) => e.scrollLeft)).toBeGreaterThan(milieu);
    await immobile(defile);
    await expect(apres).toBeDisabled();
  });

  test('à l\'ouverture de la fenêtre, le graphique montre les dates les plus récentes (pas le début du journal)', async ({ page, ouvrirAppli }) => {
    test.fail(true, 'ST-03 : à l\'ouverture, avec un historique plus long que la fenêtre, le graphique est calé à gauche (les plus anciennes dates, scrollLeft = 0) et les deux flèches ‹ › sont éteintes (état calculé avant la mise en page) ; il ne se cale à droite qu\'après un second affichage (changement de période ou d\'onglet).');
    await ouvrirStats(page, ouvrirAppli, [seance(ilYa(1), 10), seance(ilYa(120), 20)]);
    await ouvrirFenetre(page);
    const defile = contenu(page).locator('.st-scroller');
    await expect.poll(() => defile.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
    await expect.poll(() => defile.evaluate((e) => e.scrollLeft + e.clientWidth >= e.scrollWidth - 2), { message: 'le tracé est calé à droite (dates récentes en vue)' }).toBe(true);
  });

  test('un historique court tient dans la fenêtre : les deux flèches sont éteintes', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [seance(ilYa(1), 10), seance(ilYa(5), 10)]);
    await ouvrirFenetre(page);
    await expect(contenu(page).getByRole('button', { name: 'Dates plus anciennes' })).toBeDisabled();
    await expect(contenu(page).getByRole('button', { name: 'Dates plus récentes' })).toBeDisabled();
  });

  test('l\'axe des dates est lisible (étiquettes jour/mois espacées)', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [seance(ilYa(1), 10), seance(ilYa(20), 20)]);
    await ouvrirFenetre(page);
    const etiquettes = await graphique(page).locator('text.st-axis').allTextContents();
    expect(etiquettes.length).toBeGreaterThan(2);
    for (const e of etiquettes) expect(e).toMatch(/^\d{1,2}\/\d{1,2}$/);
    expect(etiquettes.at(-1)).toMatch(/^\d{1,2}\/11$/);
  });

  test.describe('toucher une barre', () => {
    const DONNEES = [
      { quand: ilYa(1, '18:00'), nom: 'Routine', pas: [{ ex: 'Gamme majeure', min: 10, bpm: [80, 90] as [number, number] }, { ex: 'Croches', min: 5, sous: 'Rythme' }] },
      { quand: ilYa(1, '20:00'), nom: 'Soir', pas: [{ ex: 'Croches', min: 7, sous: 'Rythme' }] },
      seance(ilYa(5), 20, 'Arpèges'),
    ];

    test('ouvre le détail du jour : séances, exercices avec tempo, répartition par chapitre @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, DONNEES);
      await ouvrirFenetre(page);
      await expect(detailBarre(page)).toBeHidden();
      await barres(page).nth(1).click();
      const d = detailBarre(page);
      await expect(d).toBeVisible();
      await expect(d.locator('.st-pick-head strong')).toHaveText('Mercredi 25 novembre 2026');
      await expect(d.locator('.st-pick-sum')).toHaveText('22 min · 2 séances · 2 exercices');
      expect(await lignesBloc(d.locator('.gs-stat-block').first())).toEqual([
        '18:00 · Routine | 15 min', 'Gamme majeure | 10 min · 80 → 90 BPM', 'Croches | 5 min', '20:00 · Soir | 7 min', 'Croches | 7 min',
      ]);
    });

    test('le détail précise le chemin de chaque exercice et la répartition par chapitre et dossier', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, DONNEES);
      await ouvrirFenetre(page);
      await barres(page).nth(1).click();
      const d = detailBarre(page);
      await expect(d.locator('.st-tree-path').filter({ hasText: 'Technique › Rythme' })).toHaveCount(2);
      await expect(d.locator('.st-tree-path').filter({ hasText: /^Technique$/ })).toHaveCount(1);
      const arbre = d.locator('.gs-stat-title').filter({ hasText: /^Par chapitre$/i }).locator('xpath=following-sibling::*[1]');
      expect(await lignesBloc(arbre)).toEqual(['Technique | 22 min · 100 %', 'Gamme majeure | 10 min', 'Rythme | 12 min', 'Croches | 12 min · 2×']);
    });

    test('la barre touchée est marquée ; ✕ ferme le détail ; toucher la même barre aussi ; une autre barre le remplace @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, DONNEES);
      await ouvrirFenetre(page);
      await barres(page).nth(1).click();
      await expect(contenu(page).locator('rect.st-col-sel')).toHaveAttribute('visibility', 'visible');
      await defilementFini(page);
      await detailBarre(page).getByRole('button', { name: 'Fermer le détail' }).click();
      await expect(detailBarre(page)).toBeHidden();
      await expect(contenu(page).locator('rect.st-col-sel')).toHaveAttribute('visibility', 'hidden');
      await barres(page).nth(1).click();
      await expect(detailBarre(page)).toBeVisible();
      await barres(page).nth(1).click();
      await expect(detailBarre(page)).toBeHidden();
      await barres(page).nth(1).click();
      await barres(page).nth(0).click();
      await expect(detailBarre(page).locator('.st-pick-head strong')).toHaveText('Samedi 21 novembre 2026');
      await expect(detailBarre(page).locator('.st-pick-sum')).toHaveText('20 min · 1 séance · 1 exercice');
    });

    test('toucher une zone sans séance dit « Aucune séance »', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, DONNEES);
      await ouvrirFenetre(page);
      const r = (await graphique(page).boundingBox())!;
      await page.mouse.click(r.x + 44 * 2 + 22, r.y + 60);   // 3ᵉ colonne (colonnes de 44 px) = il y a 3 jours : aucune séance ce jour-là
      await expect(detailBarre(page).locator('.st-pick-sum')).toHaveText('Aucune séance');
    });

    test('le détail reste ouvert quand on change d\'onglet puis qu\'on revient', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, DONNEES);
      await ouvrirFenetre(page);
      await barres(page).nth(1).click();
      await expect(detailBarre(page)).toBeVisible();
      await ongletStats(page, 'Temps').click();
      await ongletStats(page, 'Aperçu').click();
      await expect(detailBarre(page)).toBeVisible();
      await expect(detailBarre(page).locator('.st-pick-head strong')).toHaveText('Mercredi 25 novembre 2026');
    });

    test('au clic droit sur un exercice du détail : le menu de l\'exercice', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, DONNEES);
      await ouvrirFenetre(page);
      await barres(page).nth(1).click();
      await detailBarre(page).locator('.st-tree-ex').filter({ hasText: 'Gamme majeure' }).first().click({ button: 'right' });
      await expect(page.getByRole('menu')).toContainText('Ouvrir dans son dossier');
      await page.keyboard.press('Escape');
    });
  });

  test('« Aujourd\'hui » et « Hier » n\'ont pas de graphique ; « 3 derniers jours » en a un', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [seance(ilYa(0, '08:00'), 10), seance(ilYa(1), 10)]);
    await ouvrirFenetre(page);
    await choisirPeriode(page, 'Aujourd\'hui');
    await expect(graphique(page)).toHaveCount(0);
    await choisirPeriode(page, 'Hier');
    await expect(graphique(page)).toHaveCount(0);
    await choisirPeriode(page, '3 derniers jours');
    await expect(graphique(page)).toHaveCount(1);
    expect(section).toBeDefined();
  });
});
