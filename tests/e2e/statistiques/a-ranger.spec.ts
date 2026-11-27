// MODULE « statistiques » — « SÉANCES À ATTRIBUER À UN CHAPITRE ». Chaque séance du journal garde FIGÉS le titre, le chapitre et le dossier de ses exercices ; quand l'état actuel ne permet pas de
// trancher (exercice déplacé dans un autre chapitre, supprimé mais recréé sous le même nom, supprimé avec son chapitre), l'appli POSE LA QUESTION au lieu de deviner : une bulle sur l'icône
// Statistiques, une bulle dans le titre de la fenêtre, une ligne dépliable en tête de l'Aperçu. Observé en boîte noire (playwright-cli, 26/11/2026, horloge figée au 26/11/2026 10:00).
import { test, expect } from '../support/fixtures';
import { etatStats, aller, boutonStats, carte, contenu, fenetre, ilYa, lignesBloc, ouvrirFenetre, ouvrirStats, reglagesStats, section, titresCartes, valeurTuile } from './aide-statistiques';
import { ouvrirSessions } from '../session/aide-session';

/** « Blues en la » est rangé aujourd'hui dans Improvisation ; ses séances disent « Technique » : il a changé de chapitre. */
const DEPLACE = () => [
  { quand: ilYa(5, '07:00'), pas: [{ ex: 'Blues en la', min: 6, chap: 'Technique' }] },
  { quand: ilYa(2, '07:00'), pas: [{ ex: 'Blues en la', min: 6, chap: 'Technique' }, { ex: 'Gamme majeure', min: 10 }] },
];
/** « Gamme majeure » (id ex-ancien-gamme) a été supprimé puis recréé (id ex-gamme-majeure). */
const RECREE = () => [
  { quand: ilYa(5, '07:00'), pas: [{ ex: 'Gamme majeure', id: 'ex-ancien-gamme', min: 4 }] },
  { quand: ilYa(2, '07:00'), pas: [{ ex: 'Gamme majeure', id: 'ex-ancien-gamme', min: 4 }, { ex: 'Gamme majeure', min: 10 }] },
];
/** « Vieil exo » et son chapitre « Ancien » n'existent plus. */
const ORPHELIN = () => [
  { quand: ilYa(5, '07:00'), pas: [{ ex: 'Vieil exo', id: 'ex-vieil', min: 8, chap: 'Ancien' }] },
  { quand: ilYa(2, '07:00'), pas: [{ ex: 'Vieil exo', id: 'ex-vieil', min: 8, chap: 'Ancien' }, { ex: 'Gamme majeure', min: 10 }] },
];
const question = (page: any, kind: 'moved' | 'recreated' | 'orphan') => contenu(page).locator(`.st-issue-${kind}`);
const deplier = async (page: any) => { const t = contenu(page).locator('.st-issues-toggle'); if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click(); await expect(t).toHaveAttribute('aria-expanded', 'true'); };
const chapitres = async (page: any) => { await aller(page, 'Répartition'); return contenu(page).locator('.st-pie-wrap').first().locator('.st-pie-row').evaluateAll((els) => els.map((e) => `${e.querySelector('.st-pie-name')!.textContent} | ${e.querySelector('.st-pie-val')!.textContent}`)); };
const bulleIcone = (page: any) => boutonStats(page).locator('.gs-icon-badge');

test.describe('Statistiques : séances à attribuer à un chapitre @statistiques', () => {
  test.describe('signalement', () => {
    test('rien d\'ambigu : ni bulle, ni ligne à déplier', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(2, '07:00'), pas: [{ ex: 'Gamme majeure', min: 10 }] }]);
      await ouvrirSessions(page);
      await expect(bulleIcone(page)).toHaveCount(0);
      await expect(boutonStats(page)).toHaveAttribute('title', 'Statistiques d\'entraînement');
      await boutonStats(page).click();
      await expect(fenetre(page)).toBeVisible();
      await expect(fenetre(page).locator('.gs-title-text .st-issue-count')).toHaveCount(0);
      await expect(contenu(page).locator('.st-issues-toggle')).toHaveCount(0);
    });

    test('trois cas ambigus : la bulle de l\'icône, celle du titre et la ligne de l\'Aperçu disent « 3 » @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [...DEPLACE(), ...RECREE().slice(0, 1), ...ORPHELIN().slice(0, 1)]);
      await ouvrirSessions(page);
      await expect(bulleIcone(page)).toHaveText('3');
      await expect(boutonStats(page)).toHaveAttribute('title', 'Statistiques d\'entraînement — 3 exercices à attribuer à un chapitre');
      await boutonStats(page).click();
      await expect(fenetre(page).locator('.gs-title-text .st-issue-count')).toHaveText('3');
      await expect(contenu(page).locator('.st-issues-toggle')).toContainText('Séances à attribuer à un chapitre');
      await expect(contenu(page).locator('.st-issues-toggle .st-issue-count')).toHaveText('3');
      await expect(contenu(page).locator('.st-issues-toggle')).toHaveAttribute('aria-expanded', 'false');
      await expect(contenu(page).locator('.st-issue')).toHaveCount(0);   // repliée : l'essentiel d'abord
    });

    test('un seul cas : « 1 exercice à attribuer » au singulier', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, DEPLACE());
      await ouvrirSessions(page);
      await expect(boutonStats(page)).toHaveAttribute('title', 'Statistiques d\'entraînement — 1 exercice à attribuer à un chapitre');
    });

    test('« Voir » déplie les questions, « Masquer » les replie', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, DEPLACE());
      await ouvrirFenetre(page);
      const t = contenu(page).locator('.st-issues-toggle');
      await expect(t).toContainText('Voir ▾');
      await t.click();
      await expect(t).toContainText('Masquer ▴');
      await expect(question(page, 'moved')).toBeVisible();
      await t.click();
      await expect(question(page, 'moved')).toHaveCount(0);
    });

    test('un exercice à la corbeille n\'est pas signalé comme supprimé', async ({ page, ouvrirAppli }) => {
      const etat: any = etatStats();
      etat.settings.trash = [{ id: 'poubelle-1', type: 'exercise', deletedAt: Date.now(), data: { id: 'ex-vieil', title: 'Vieil exo' } }];
      await ouvrirStats(page, ouvrirAppli, ORPHELIN(), { etat });
      await ouvrirSessions(page);
      await expect(bulleIcone(page)).toHaveCount(0);
    });
  });

  test.describe('exercice déplacé', () => {
    test('la question nomme l\'exercice, l\'ancien et le nouveau chapitre, le nombre de séances et le temps @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, DEPLACE());
      await ouvrirFenetre(page);
      await deplier(page);
      await expect(question(page, 'moved')).toHaveText(/« Blues en la » a changé de chapitre : il était dans « Technique », il est maintenant dans « Improvisation »\. À quel chapitre attribuer ses 2 séances \(12 min\) \?/);
      await expect(question(page, 'moved').getByRole('button')).toHaveText(['Rester dans « Technique »', 'Compter dans « Improvisation »']);
    });

    test('« Rester dans l\'ancien chapitre » : la question disparaît, le temps reste en Technique, la bulle s\'éteint @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, DEPLACE());
      await ouvrirFenetre(page);
      await deplier(page);
      await question(page, 'moved').getByRole('button', { name: 'Rester dans « Technique »' }).click();
      await expect(contenu(page).locator('.st-issues-toggle')).toHaveCount(0);
      await expect(fenetre(page).locator('.gs-title-text .st-issue-count')).toHaveCount(0);
      expect(await chapitres(page)).toEqual(['Technique | 100 % · 22 min']);
      const r = await reglagesStats(page);
      expect(Object.values(r.resolved)).toEqual(['history']);
      await fenetre(page).getByRole('button', { name: 'Fermer' }).click();
      await expect(bulleIcone(page)).toHaveCount(0);
    });

    test('« Compter dans le chapitre actuel » : tout le temps de l\'exercice passe en Improvisation, et c\'est gardé @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, DEPLACE());
      await ouvrirFenetre(page);
      await deplier(page);
      await question(page, 'moved').getByRole('button', { name: 'Compter dans « Improvisation »' }).click();
      await expect(contenu(page).locator('.st-issues-toggle')).toHaveCount(0);
      expect(await chapitres(page)).toEqual(['Improvisation | 55 % · 12 min', 'Technique | 45 % · 10 min']);
      const r = await reglagesStats(page);
      expect(r.chapterOf).toEqual({ 'ex-blues-en-la': 'ch-0-1' });
      await page.reload();
      await expect(page.locator('#folder-container')).toBeAttached();
      await ouvrirSessions(page);
      await expect(bulleIcone(page)).toHaveCount(0);
    });

    test('réglage « garder les anciennes séances dans l\'ancien chapitre » : plus de question, ancien classement', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, DEPLACE(), { reglagesStats: { movePolicy: 'history' } });
      await ouvrirFenetre(page);
      await expect(contenu(page).locator('.st-issues-toggle')).toHaveCount(0);
      expect(await chapitres(page)).toEqual(['Technique | 100 % · 22 min']);
    });

    test('réglage « tout compter dans son chapitre actuel » : plus de question, tout dans le chapitre actuel', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, DEPLACE(), { reglagesStats: { movePolicy: 'follow' } });
      await ouvrirFenetre(page);
      await expect(contenu(page).locator('.st-issues-toggle')).toHaveCount(0);
      expect(await chapitres(page)).toEqual(['Improvisation | 55 % · 12 min', 'Technique | 45 % · 10 min']);
    });

    test('plusieurs exercices déplacés : une réponse groupée pour tous @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(2, '07:00'), pas: [{ ex: 'Blues en la', min: 6, chap: 'Technique' }, { ex: 'Arpèges', min: 6, chap: 'Improvisation' }] }]);
      await ouvrirFenetre(page);
      await deplier(page);
      await expect(question(page, 'moved')).toHaveCount(2);
      await expect(contenu(page).locator('.st-issue-bulk')).toContainText('Pour les 2 exercices qui ont changé de chapitre :');
      await contenu(page).locator('.st-issue-bulk').getByRole('button', { name: 'Tout compter dans les chapitres actuels' }).click();
      await expect(contenu(page).locator('.st-issues-toggle')).toHaveCount(0);
      const r = await reglagesStats(page);
      expect(r.chapterOf).toEqual({ 'ex-blues-en-la': 'ch-0-1', 'ex-arpeges': 'ch-0-0' });
    });

    test('réponse groupée « Tout laisser dans les anciens chapitres »', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(2, '07:00'), pas: [{ ex: 'Blues en la', min: 6, chap: 'Technique' }, { ex: 'Arpèges', min: 6, chap: 'Improvisation' }] }]);
      await ouvrirFenetre(page);
      await deplier(page);
      await contenu(page).locator('.st-issue-bulk').getByRole('button', { name: 'Tout laisser dans les anciens chapitres' }).click();
      await expect(contenu(page).locator('.st-issues-toggle')).toHaveCount(0);
      expect(Object.values((await reglagesStats(page)).resolved)).toEqual(['history', 'history']);
    });

    test('un seul exercice déplacé : pas de réponse groupée', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, DEPLACE());
      await ouvrirFenetre(page);
      await deplier(page);
      await expect(contenu(page).locator('.st-issue-bulk')).toHaveCount(0);
    });
  });

  test.describe('exercice supprimé puis recréé', () => {
    test('la question propose le jumeau (chemin) ; « Oui, compter avec lui » réunit les séances sous le nouvel exercice @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, RECREE());
      await ouvrirFenetre(page);
      await deplier(page);
      await expect(question(page, 'recreated')).toHaveText(/« Gamme majeure » a été supprimé, mais un exercice du même nom existe : « Technique »\. Ses 2 séances \(8 min\) doivent-elles compter avec ce nouvel exercice \?/);
      await aller(page, 'Exercices');
      expect(await titresCartes(page)).toHaveLength(2);
      await aller(page, 'Aperçu');
      await question(page, 'recreated').getByRole('button', { name: 'Oui, compter avec lui' }).click();
      await expect(contenu(page).locator('.st-issues-toggle')).toHaveCount(0);
      expect((await reglagesStats(page)).alias).toEqual({ 'ex-ancien-gamme': 'ex-gamme-majeure' });
      await aller(page, 'Exercices');
      expect(await titresCartes(page)).toEqual(['Gamme majeure']);
      await expect(carte(page, 'Gamme majeure').locator('.st-ex-meta')).toHaveText('3 séances');   // 4 + 4 + 10 min : les trois lignes sont réunies sous le nouvel exercice
    });

    test('« Non, garder à part » : les deux restent distincts et la question ne revient pas', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, RECREE());
      await ouvrirFenetre(page);
      await deplier(page);
      await question(page, 'recreated').getByRole('button', { name: 'Non, garder à part' }).click();
      await expect(contenu(page).locator('.st-issues-toggle')).toHaveCount(0);
      expect(Object.values((await reglagesStats(page)).resolved)).toEqual(['separate']);
      await aller(page, 'Exercices');
      expect(await titresCartes(page)).toHaveLength(2);
    });
  });

  test.describe('exercice supprimé avec son chapitre', () => {
    test('la question liste les chapitres actuels ; « Attribuer à ce chapitre » déplace le temps @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, ORPHELIN());
      await ouvrirFenetre(page);
      await deplier(page);
      await expect(question(page, 'orphan')).toHaveText(/« Vieil exo » a été supprimé, ainsi que son chapitre d'origine \(« Ancien »\)\. À quel chapitre attribuer ses 2 séances \(16 min\) \?/);
      await expect(question(page, 'orphan').getByRole('combobox', { name: 'Chapitre' }).locator('option')).toHaveText(['Technique', 'Improvisation']);
      expect(await chapitres(page)).toEqual(expect.arrayContaining(['Ancien | 62 % · 16 min']));
      await aller(page, 'Aperçu');
      await question(page, 'orphan').getByRole('combobox', { name: 'Chapitre' }).selectOption({ label: 'Improvisation' });
      await question(page, 'orphan').getByRole('button', { name: 'Attribuer à ce chapitre' }).click();
      await expect(contenu(page).locator('.st-issues-toggle')).toHaveCount(0);
      expect((await reglagesStats(page)).chapterOf).toEqual({ 'ex-vieil': 'ch-0-1' });
      expect(await chapitres(page)).toEqual(['Improvisation | 62 % · 16 min', 'Technique | 38 % · 10 min']);
    });

    test('« Ne pas compter » retire l\'exercice des statistiques (temps total compris)', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, ORPHELIN());
      await ouvrirFenetre(page);
      await expect(valeurTuile(page, 'Temps total')).toHaveText('26 min');
      await deplier(page);
      await question(page, 'orphan').getByRole('button', { name: 'Ne pas compter' }).click();
      await expect(contenu(page).locator('.st-issues-toggle')).toHaveCount(0);
      expect((await reglagesStats(page)).chapterOf).toEqual({ 'ex-vieil': '__ignore__' });
      await aller(page, 'Exercices');
      expect(await titresCartes(page)).toEqual(['Gamme majeure']);
      await aller(page, 'Répartition');
      expect(await lignesBloc(section(page, 'Les plus travaillés'))).toEqual(['Gamme majeure | 10 min · 1×']);
    });

    test('« Laisser sans chapitre » : la question disparaît, l\'exercice reste compté sous son ancien nom de chapitre', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, ORPHELIN());
      await ouvrirFenetre(page);
      await deplier(page);
      await question(page, 'orphan').getByRole('button', { name: 'Laisser sans chapitre' }).click();
      await expect(contenu(page).locator('.st-issues-toggle')).toHaveCount(0);
      expect(Object.values((await reglagesStats(page)).resolved)).toEqual(['keep']);
      expect(await chapitres(page)).toContain('Ancien | 62 % · 16 min');
    });
  });

  test('répondre à une question rafraîchit la bulle du titre et celle de l\'icône (3 → 2 → 0) @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [...DEPLACE(), ...RECREE().slice(0, 1), ...ORPHELIN().slice(0, 1)]);
    await ouvrirFenetre(page);
    await deplier(page);
    await question(page, 'moved').getByRole('button', { name: 'Rester dans « Technique »' }).click();
    await expect(fenetre(page).locator('.gs-title-text .st-issue-count')).toHaveText('2');
    await deplier(page);
    await question(page, 'recreated').getByRole('button', { name: 'Non, garder à part' }).click();
    await question(page, 'orphan').getByRole('button', { name: 'Laisser sans chapitre' }).click();
    await expect(fenetre(page).locator('.gs-title-text .st-issue-count')).toHaveCount(0);
    await fenetre(page).getByRole('button', { name: 'Fermer' }).click();
    await expect(bulleIcone(page)).toHaveCount(0);
    await expect(boutonStats(page)).toHaveAttribute('title', 'Statistiques d\'entraînement');
  });

  test('la bulle compte tout le journal de l\'espace, quelle que soit la période affichée', async ({ page, ouvrirAppli }) => {
    await ouvrirStats(page, ouvrirAppli, [{ quand: ilYa(60, '07:00'), pas: [{ ex: 'Blues en la', min: 6, chap: 'Technique' }] }, { quand: ilYa(2, '07:00'), pas: [{ ex: 'Gamme majeure', min: 10 }] }]);
    await ouvrirSessions(page);
    await expect(bulleIcone(page)).toHaveText('1');   // la séance ambiguë date de 60 jours : hors des 28 jours affichés au départ
    await boutonStats(page).click();
    await expect(contenu(page).locator('.st-issues-toggle')).toBeVisible();
  });
});
