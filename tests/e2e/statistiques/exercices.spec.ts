// MODULE « statistiques » — ONGLET « EXERCICES » : deux vues (« Tempo progressif » = exercices avec objectif tempo ; « Durées » = exercices sans objectif), filtres, tris, cartes dépliables,
// alertes et conseils, bulle des alertes pas encore vues. Observé en boîte noire (playwright-cli, 26/11/2026, horloge figée au 26/11/2026 10:00).
// Alertes « à surveiller » (⚠) : durée trop courte / trop longue contre le prévu, tempo bloqué, tempo en recul ; informations (ℹ) : moins de 3 min, plus travaillé depuis 3 semaines, plus de 40 % du temps.
import { test, expect } from '../support/fixtures';
import { alertes, alertesVues, aller, bascule, carte, cartes, choisirPeriode, contenu, entreeCarte, filtre, ilYa, infoExercices, ongletStats, ouvrirFenetre, ouvrirStats, titresCartes, triExercices } from './aide-statistiques';

/** Une séance par tempo, étalées de 2 jours en 2 jours, la dernière il y a 3 jours. */
const serie = (ex: string, bpms: number[], plus: Record<string, unknown> = {}) => bpms.map((b, i) => ({ quand: ilYa(2 * (bpms.length - 1 - i) + 3, '07:00'), pas: [{ ex, min: 6, bpm: b, ...plus }] }));
/** n séances de `min` minutes (prévu `prevu`) étalées en remontant depuis il y a `depuis` jours. */
const duree = (ex: string, n: number, min: number, prevu: number, depuis = 3, plus: Record<string, unknown> = {}) => Array.from({ length: n }, (_, i) => ({ quand: ilYa(depuis + i, '07:00'), pas: [{ ex, min, prevu, ...plus }] }));
const SANS = ['Arpèges', 'Blues en la', 'Croches'];

test.describe('Statistiques : onglet Exercices @statistiques', () => {
  test.describe('deux vues', () => {
    test('au départ « Tempo progressif » s\'il y a des exercices à objectif tempo ; les boutons portent le nombre d\'exercices @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [...serie('Gamme majeure', [80, 90]), ...duree('Arpèges', 2, 10, 10)], { sansObjectif: SANS });
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      await expect(bascule(page, 'Tempo progressif')).toHaveAttribute('aria-pressed', 'true');
      await expect(bascule(page, 'Durées')).toHaveAttribute('aria-pressed', 'false');
      await expect(bascule(page, 'Tempo progressif').locator('.st-ex-mode-n')).toHaveText('1');
      await expect(bascule(page, 'Durées').locator('.st-ex-mode-n')).toHaveText('1');
      await expect(contenu(page).locator('.st-ex-caption')).toHaveText('Exercices avec objectif tempo : progression du tempo, séance après séance.');
      expect(await titresCartes(page)).toEqual(['Gamme majeure']);
    });

    test('« Durées » montre les exercices sans objectif tempo, seulement leur temps passé @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [...serie('Gamme majeure', [80, 90]), ...duree('Arpèges', 2, 10, 10)], { sansObjectif: SANS });
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      await bascule(page, 'Durées').click();
      await expect(bascule(page, 'Durées')).toHaveAttribute('aria-pressed', 'true');
      await expect(contenu(page).locator('.st-ex-caption')).toHaveText('Exercices sans objectif tempo : temps passé sur chacun, réel contre prévu.');
      expect(await titresCartes(page)).toEqual(['Arpèges']);
      await expect(carte(page, 'Arpèges').locator('.st-ex-meta')).toHaveText('2 séances · 20 min');
      await expect(carte(page, 'Arpèges').locator('.st-ex-dur')).toHaveText('10 / 10 min · 100 %');
      await expect(carte(page, 'Arpèges').locator('.st-ex-tempo')).toHaveCount(0);
    });

    test('sans exercice à objectif tempo, la vue « Durées » s\'ouvre d\'elle-même', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, duree('Arpèges', 2, 10, 10), { sansObjectif: SANS });
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      await expect(bascule(page, 'Durées')).toHaveAttribute('aria-pressed', 'true');
      await expect(bascule(page, 'Tempo progressif').locator('.st-ex-mode-n')).toHaveText('0');
    });

    test('une vue vide explique pourquoi (et où régler l\'objectif tempo)', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, duree('Arpèges', 2, 10, 10), { sansObjectif: SANS });
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      await bascule(page, 'Tempo progressif').click();
      await expect(contenu(page).locator('.gs-empty')).toHaveText('Aucun exercice avec objectif tempo travaillé sur cette période. L\'objectif tempo se règle dans la fiche d\'un exercice (bouton métronome + flèche).');
      await expect(cartes(page)).toHaveCount(0);
    });

    test('une vue sans exercice sans objectif : message de la vue « Durées »', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, serie('Gamme majeure', [80, 90]));
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      await bascule(page, 'Durées').click();
      await expect(contenu(page).locator('.gs-empty')).toHaveText('Aucun exercice sans objectif tempo travaillé sur cette période.');
    });

    test('la vue choisie est gardée quand on change d\'onglet', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [...serie('Gamme majeure', [80, 90]), ...duree('Arpèges', 2, 10, 10)], { sansObjectif: SANS });
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      await bascule(page, 'Durées').click();
      await aller(page, 'Temps');
      await aller(page, 'Exercices');
      await expect(bascule(page, 'Durées')).toHaveAttribute('aria-pressed', 'true');
    });
  });

  test.describe('cartes', () => {
    test('exercice à objectif tempo : séances avec tempo, « du premier au dernier BPM » avec l\'écart, nom et chapitre @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [...serie('Gamme majeure', [80, 90, 100]), ...serie('Blues en la', [70], { chap: 'Improvisation' }).map((s) => ({ ...s, quand: ilYa(9, '07:00') })), ...duree('Croches', 1, 5, 5, 4, { sous: 'Rythme' })]);
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      const g = carte(page, 'Gamme majeure');
      await expect(g.locator('.st-ex-name small')).toHaveText('Technique');
      await expect(g.locator('.st-ex-meta')).toHaveText('3 séances avec tempo');
      await expect(g.locator('.st-ex-tempo')).toContainText('80 → 100 BPM (+20)');
      await expect(g.locator('.st-ex-tempo .st-ex-gain')).toHaveCount(1);
      await expect(g.locator('.st-ex-tempo svg.gs-spark')).toHaveCount(1);
      await expect(carte(page, 'Blues en la').locator('.st-ex-meta')).toHaveText('1 séance avec tempo');
      await expect(carte(page, 'Blues en la').locator('.st-ex-tempo')).toHaveText('70 → 70 BPM');
      await expect(carte(page, 'Blues en la').locator('svg.gs-spark')).toHaveCount(0);   // une seule séance : pas de petite courbe
      await expect(carte(page, 'Croches').locator('.st-ex-meta')).toHaveText('1 séance');
      await expect(carte(page, 'Croches').locator('.st-ex-tempo')).toHaveText('aucun tempo noté');
    });

    test('un recul s\'écrit avec le signe − sans la classe « gain »', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, serie('Gamme majeure', [100, 90]));
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      await expect(carte(page, 'Gamme majeure').locator('.st-ex-tempo')).toContainText('100 → 90 BPM (-10)');
      await expect(carte(page, 'Gamme majeure').locator('.st-ex-gain')).toHaveCount(0);
    });

    test('exercice sans objectif : séances et temps total ; durée moyenne réelle / prévue ; sans prévu « n min en moyenne »', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [...duree('Arpèges', 3, 10, 20), { quand: ilYa(5, '09:00'), libre: true, pas: [{ ex: 'Blues en la', min: 12, chap: 'Improvisation' }] }], { sansObjectif: SANS });
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      await bascule(page, 'Durées').click();
      await expect(carte(page, 'Arpèges').locator('.st-ex-meta')).toHaveText('3 séances · 30 min');
      await expect(carte(page, 'Arpèges').locator('.st-ex-dur')).toHaveText('10 / 20 min · 50 %');
      await expect(carte(page, 'Blues en la').locator('.st-ex-dur')).toHaveText('12 min en moyenne');   // séance libre : aucun prévu
      await expect(carte(page, 'Blues en la').locator('.st-ex-dur')).toHaveAttribute('title', 'Durée moyenne réelle / durée moyenne prévue');
    });

    test('une carte se déplie (aria-expanded) et se replie ; l\'état est gardé en changeant d\'onglet', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, serie('Gamme majeure', [80, 90]));
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      const c = carte(page, 'Gamme majeure');
      await expect(entreeCarte(c)).toHaveAttribute('aria-expanded', 'false');
      await expect(c.locator('.st-ex-body')).toHaveCount(0);
      await entreeCarte(c).click();
      await expect(entreeCarte(c)).toHaveAttribute('aria-expanded', 'true');
      await expect(c.locator('.st-ex-body')).toBeVisible();
      await expect(c.locator('.st-ex-fine')).toHaveText('Rien à signaler : le tempo évolue normalement.');
      await aller(page, 'Temps');
      await aller(page, 'Exercices');
      await expect(entreeCarte(carte(page, 'Gamme majeure'))).toHaveAttribute('aria-expanded', 'true');
      await entreeCarte(carte(page, 'Gamme majeure')).click();
      await expect(carte(page, 'Gamme majeure').locator('.st-ex-body')).toHaveCount(0);
    });

    test('sans alerte, une carte « durées » dit que les durées sont régulières', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, duree('Arpèges', 3, 10, 10), { sansObjectif: SANS });
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      await entreeCarte(carte(page, 'Arpèges')).click();
      await expect(carte(page, 'Arpèges').locator('.st-ex-fine')).toHaveText('Rien à signaler : les durées sont régulières.');
      await expect(carte(page, 'Arpèges').locator('svg.st-dur')).toHaveCount(1);
    });
  });

  test.describe('alertes et conseils', () => {
    type Cas = { nom: string; donnees: any[]; options?: any; vue: 'Tempo progressif' | 'Durées'; exercice: string; niveau: 'warn' | 'info'; texte: string; conseil: RegExp; essentiel?: boolean };
    const CAS: Cas[] = [
      { nom: 'tempo bloqué (5 séances à ±1 BPM du dernier)', donnees: serie('Gamme majeure', [99, 100, 101, 100, 100]), vue: 'Tempo progressif', exercice: 'Gamme majeure', niveau: 'warn', texte: '⚠ Tempo bloqué autour de 100 BPM depuis 5 séances.', conseil: /^Conseil : Essaie un palier plus petit \(\+2 BPM\)/, essentiel: true },
      { nom: 'tempo en recul (moins de 90 % du record)', donnees: serie('Gamme majeure', [100, 120, 90]), vue: 'Tempo progressif', exercice: 'Gamme majeure', niveau: 'warn', texte: '⚠ Tempo en recul : 90 BPM aujourd\'hui pour un record de 120 BPM.', conseil: /^Conseil : Reviens à environ 110 BPM, puis remonte par paliers de 2 à 4 BPM\./, essentiel: true },
      { nom: 'durée trop courte contre le prévu (moins de 70 %)', donnees: duree('Arpèges', 3, 2, 10), options: { sansObjectif: SANS }, vue: 'Durées', exercice: 'Arpèges', niveau: 'warn', texte: '⚠ Tu n\'y passes en moyenne que 2 min sur 10 min prévues (20 %).', conseil: /^Conseil : Ramène la durée prévue à environ 2 min/, essentiel: true },
      { nom: 'durée trop longue contre le prévu (plus de 130 %)', donnees: duree('Arpèges', 3, 20, 10), options: { sansObjectif: SANS }, vue: 'Durées', exercice: 'Arpèges', niveau: 'warn', texte: '⚠ Tu dépasses souvent le temps prévu : 20 min en moyenne pour 10 min prévues (200 %).', conseil: /^Conseil : Prévois plutôt environ 20 min/ },
      { nom: 'moins de 3 min par séance', donnees: duree('Arpèges', 3, 2, 2), options: { sansObjectif: SANS }, vue: 'Durées', exercice: 'Arpèges', niveau: 'info', texte: 'ℹ Moins de 3 min par séance en moyenne (2 min).', conseil: /^Conseil : C'est court pour progresser/ },
      { nom: 'plus travaillé depuis 3 semaines', donnees: duree('Arpèges', 3, 10, 10, 30), options: { sansObjectif: SANS }, vue: 'Durées', exercice: 'Arpèges', niveau: 'info', texte: 'ℹ Plus travaillé depuis 30 jours.', conseil: /^Conseil : Glisse-le dans une prochaine session/ },
      { nom: 'plus de 40 % du temps de pratique (quatre exercices au moins)', donnees: [{ quand: ilYa(2, '07:00'), pas: [{ ex: 'Arpèges', min: 40, prevu: 40 }, { ex: 'Croches', min: 5, prevu: 5, sous: 'Rythme' }, { ex: 'Blues en la', min: 5, prevu: 5, chap: 'Improvisation' }, { ex: 'Gamme majeure', min: 10 }] }], options: { sansObjectif: SANS }, vue: 'Durées', exercice: 'Arpèges', niveau: 'info', texte: 'ℹ Cet exercice représente 67 % de ton temps de pratique.', conseil: /^Conseil : Vérifie que cela correspond à ta priorité/ },
    ];
    for (const c of CAS) {
      test(`${c.nom} : ${c.niveau === 'warn' ? 'alerte' : 'information'} et conseil${c.essentiel ? ' @critique' : ''}`, async ({ page, ouvrirAppli }) => {
        await ouvrirStats(page, ouvrirAppli, c.donnees, c.options ?? {});
        await ouvrirFenetre(page);
        if (c.nom.includes('3 semaines')) await choisirPeriode(page, '90 jours');
        await aller(page, 'Exercices');
        await bascule(page, c.vue).click();
        const k = carte(page, c.exercice);
        await expect(k).toBeVisible();
        await entreeCarte(k).click();
        await expect(alertes(k)).toHaveCount(1);
        await expect(alertes(k).locator('.st-alert-text')).toHaveText(c.texte);
        await expect(alertes(k).locator('.st-alert-advice')).toHaveText(c.conseil);
        await expect(alertes(k)).toHaveClass(new RegExp(`st-alert-${c.niveau}`));
        await expect(k.locator('.st-ex-badges .gs-tab-count')).toHaveText('1');
        if (c.niveau === 'warn') await expect(k).toHaveClass(/st-ex-warn/); else await expect(k).not.toHaveClass(/st-ex-warn/);
      });
    }

    test('un exercice à objectif tempo n\'a jamais d\'alerte de durée (courte, longue, 3 min, dominant)', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, duree('Gamme majeure', 3, 2, 10));
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      await entreeCarte(carte(page, 'Gamme majeure')).click();
      await expect(alertes(carte(page, 'Gamme majeure'))).toHaveCount(0);
      await expect(carte(page, 'Gamme majeure').locator('.st-ex-fine')).toBeVisible();
    });

    test('le tempo n\'est suivi que pour un exercice à objectif tempo : un BPM noté sur un exercice sans objectif est ignoré', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, duree('Arpèges', 3, 10, 10, 3, { bpm: 90 }), { sansObjectif: SANS });
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      await bascule(page, 'Durées').click();
      await entreeCarte(carte(page, 'Arpèges')).click();
      await expect(carte(page, 'Arpèges').locator('svg.st-tempo')).toHaveCount(0);
      await expect(carte(page, 'Arpèges')).not.toContainText('BPM');
    });

    test('quatre séances au même tempo ne font pas encore d\'alerte « bloqué » (il en faut cinq)', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, serie('Gamme majeure', [100, 100, 100, 100]));
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      await expect(infoExercices(page)).toHaveText('1 exercice analysé · rien d\'inquiétant');
    });
  });

  test.describe('filtre et tri', () => {
    const DONNEES = () => [
      ...serie('Gamme majeure', [80, 85, 95]),                                    // +15, en progrès
      ...serie('Croches', [100, 120, 90], { sous: 'Rythme' }),                    // en recul : à surveiller
      ...serie('Blues en la', [60, 62], { chap: 'Improvisation' }).map((s) => ({ ...s, quand: ilYa(12, '07:00') })),   // le moins récent
    ];

    test('« À surveiller » ne garde que les exercices en alerte ; le compte est dit en haut @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, DONNEES());
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      await expect(infoExercices(page)).toHaveText('3 exercices analysés · 1 à surveiller');
      await expect(filtre(page, 'Tous')).toHaveClass(/active/);
      await filtre(page, 'À surveiller').click();
      await expect(filtre(page, 'À surveiller')).toHaveClass(/active/);
      expect(await titresCartes(page)).toEqual(['Croches']);
      await filtre(page, 'Tous').click();
      expect(await titresCartes(page)).toHaveLength(3);
    });

    test('« À surveiller » sans alerte : message clair', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, serie('Gamme majeure', [80, 90]));
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      await filtre(page, 'À surveiller').click();
      await expect(contenu(page).locator('.gs-empty')).toHaveText('Aucun exercice à surveiller sur cette période.');
      await expect(infoExercices(page)).toHaveText('1 exercice analysé · rien d\'inquiétant');
    });

    test('tri : à surveiller d\'abord (par défaut), meilleure progression, moins récents d\'abord, ordre alphabétique @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, DONNEES());
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      await expect(triExercices(page).locator('option')).toHaveText(['À surveiller d\'abord', 'Meilleure progression du tempo', 'Moins récents d\'abord', 'Ordre alphabétique']);
      expect(await titresCartes(page)).toEqual(['Croches', 'Gamme majeure', 'Blues en la']);   // alerte d'abord, puis le plus de temps
      await triExercices(page).selectOption({ label: 'Meilleure progression du tempo' });
      expect(await titresCartes(page)).toEqual(['Gamme majeure', 'Blues en la', 'Croches']);   // +15, +2, −10
      await triExercices(page).selectOption({ label: 'Moins récents d\'abord' });
      expect((await titresCartes(page))[0]).toBe('Blues en la');
      await triExercices(page).selectOption({ label: 'Ordre alphabétique' });
      expect(await titresCartes(page)).toEqual(['Blues en la', 'Croches', 'Gamme majeure']);
    });

    test('la vue « Durées » propose « Plus travaillés » à la place de « Meilleure progression du tempo »', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [...duree('Arpèges', 2, 10, 10), ...duree('Croches', 2, 30, 30, 5, { sous: 'Rythme' }), ...duree('Blues en la', 1, 5, 5, 8, { chap: 'Improvisation' })], { sansObjectif: SANS });
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      await bascule(page, 'Durées').click();
      await expect(triExercices(page).locator('option')).toHaveText(['À surveiller d\'abord', 'Plus travaillés', 'Moins récents d\'abord', 'Ordre alphabétique']);
      await triExercices(page).selectOption({ label: 'Plus travaillés' });
      expect(await titresCartes(page)).toEqual(['Croches', 'Arpèges', 'Blues en la']);
    });

    test('un tri propre à une vue retombe sur « À surveiller d\'abord » quand on change de vue', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [...serie('Gamme majeure', [80, 90]), ...duree('Arpèges', 2, 10, 10)], { sansObjectif: SANS });
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      await triExercices(page).selectOption({ label: 'Meilleure progression du tempo' });
      await bascule(page, 'Durées').click();
      await expect(triExercices(page)).toHaveValue('alerts');
    });
  });

  test.describe('alertes pas encore vues', () => {
    const DONNEES = () => [...serie('Gamme majeure', [100, 120, 90])];   // une alerte à surveiller

    test('la bulle de l\'onglet Exercices compte les exercices à surveiller ; elle disparaît quand on ouvre l\'onglet et ne revient pas @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, DONNEES());
      await ouvrirFenetre(page);
      await expect(ongletStats(page, 'Exercices').locator('.st-issue-count')).toHaveText('1');
      await expect(ongletStats(page, 'Exercices').locator('.st-issue-count')).toHaveAttribute('title', '1 exercice(s) à surveiller, pas encore consultés');
      await aller(page, 'Exercices');
      await expect(ongletStats(page, 'Exercices').locator('.st-issue-count')).toHaveCount(0);
      await aller(page, 'Aperçu');
      await expect(ongletStats(page, 'Exercices').locator('.st-issue-count')).toHaveCount(0);
      expect(Object.keys(await alertesVues(page))).toEqual(['ex-gamme-majeure']);
      await page.reload();
      await expect(page.locator('#folder-container')).toBeAttached();
      await ouvrirFenetre(page);
      await expect(ongletStats(page, 'Exercices').locator('.st-issue-count')).toHaveCount(0);
    });

    test('une alerte DIFFÉRENTE pour le même exercice fait revenir la bulle', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, DONNEES(), { reglages: { 'trainhub.statsSeen.v1': JSON.stringify({ 'ex-gamme-majeure': 'stagnant' }) } });
      await ouvrirFenetre(page);
      await expect(ongletStats(page, 'Exercices').locator('.st-issue-count')).toHaveText('1');
    });

    test('l\'Aperçu annonce « N exercice(s) à surveiller » ; « Voir » ouvre l\'onglet Exercices sur le filtre « À surveiller » @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [...DONNEES(), ...serie('Blues en la', [60, 62], { chap: 'Improvisation' })]);
      await ouvrirFenetre(page);
      const rappel = contenu(page).locator('.st-teaser');
      await expect(rappel).toContainText('1 exercice à surveiller (durées, tempo) — détail et conseils dans l\'onglet Exercices.');
      await rappel.getByRole('button', { name: 'Voir' }).click();
      await expect(ongletStats(page, 'Exercices')).toHaveAttribute('aria-selected', 'true');
      await expect(filtre(page, 'À surveiller')).toHaveClass(/active/);
      expect(await titresCartes(page)).toEqual(['Gamme majeure']);
    });

    test('sans alerte, ni bulle ni rappel', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, serie('Gamme majeure', [80, 90]));
      await ouvrirFenetre(page);
      await expect(ongletStats(page, 'Exercices').locator('.st-issue-count')).toHaveCount(0);
      await expect(contenu(page).locator('.st-teaser')).toHaveCount(0);
    });

    test('le rappel compte aussi les exercices de l\'autre vue (« Durées ») et met le pluriel', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [...DONNEES(), ...duree('Arpèges', 3, 2, 10)], { sansObjectif: SANS });
      await ouvrirFenetre(page);
      await expect(contenu(page).locator('.st-teaser')).toContainText('2 exercices à surveiller');
      await expect(ongletStats(page, 'Exercices').locator('.st-issue-count')).toHaveText('2');
    });
  });
});
