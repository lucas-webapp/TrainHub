// MODULE « synchro » — JOURNAL DES SÉANCES : un document par mois (`users/{uid}/apps/trainhub-log-AAAA-MM`), FUSIONNÉ séance par séance entre appareils.
// Observé en boîte noire (playwright-cli, 26/11/2026) : à la connexion, chaque mois du journal local inconnu du cloud y est envoyé ; un mois présent des deux côtés est fusionné (union des séances,
// moins les séances supprimées d'un côté ou de l'autre : la liste `deleted` du document garde leur identifiant) ; une séance enregistrée sur un appareil connecté part aussitôt et apparaît sur les
// autres appareils connectés sans rechargement. Une séance enregistrée HORS connexion est signalée sur la pilule « Se connecter » (info-bulle) puis confirmée par un message à la connexion.
// Les séances sont posées dans `trainhub.log.AAAA-MM` avant le chargement (`journalMois`) ou saisies par « Session guidée › Historique › ＋ Séance passée ».
import { test, expect, adresse, ajouterSeancePassee, attendreSynchro, connecter, document, documents, idsSeances, journalMois, lancerConnexion, seancesCloud, seancesLocales, T } from './aide-synchro';
import type { Page } from '@playwright/test';
import { ajouterExercice } from '../bibliotheque/aide-bibliotheque';

const HISTORIQUE = (page: Page) => page.locator('.gs-history-panel');
const nov = (id: string, jour: number, ...titres: string[]) => ({ id, date: T(`2026-11-${String(jour).padStart(2, '0')}T18:00:00+01:00`), titres });

test.describe('Synchro : journal des séances @synchro', () => {
  test.describe.configure({ timeout: 90_000 });   // la synchro attend un émulateur et un SDK réseau : sous la charge de la matrice complète, WebKit met parfois plus de 20 s à acquitter une écriture
  test('à la connexion, le journal local part dans un document par mois (novembre, octobre) avec toutes les séances @critique', async ({ ouvrirAppli }, testInfo) => {
    const reglages = {
      ...journalMois('2026-11', [nov('s-nov-1', 10, 'Alpha'), nov('s-nov-2', 17, 'Alpha', 'Bravo')]),
      ...journalMois('2026-10', [{ id: 's-oct-1', date: T('2026-10-20T18:00:00+02:00'), titres: ['Alpha'] }]),
    };
    const page = await ouvrirAppli({ exercices: [{ titre: 'Alpha' }, { titre: 'Bravo' }], reglages });
    const uid = await connecter(page, adresse(testInfo.project.name, 'e2e-journal'));

    await expect.poll(() => documents(uid), { timeout: 20_000 }).toEqual(['trainhub', 'trainhub-log-2026-10', 'trainhub-log-2026-11']);
    const novembre = await document(uid, 'trainhub-log-2026-11');
    expect(novembre.month).toBe('2026-11');
    expect(idsSeances(novembre.records)).toEqual(['s-nov-1', 's-nov-2']);
    expect(novembre.deleted).toEqual([]);
    expect(novembre.records.find((s: any) => s.id === 's-nov-2').steps.map((x: any) => [x.title, x.actualSec])).toEqual([['Alpha', 300], ['Bravo', 300]]);
    expect(idsSeances((await document(uid, 'trainhub-log-2026-10')).records)).toEqual(['s-oct-1']);
    // Le document principal note la révision de chaque mois (c'est ce qui dit à un autre appareil qu'il doit relire le journal).
    const principal = await document(uid, 'trainhub');
    expect(Object.keys(principal.settings.logRev).sort()).toEqual(['2026-10', '2026-11']);
  });

  test('fusion : le journal du cloud et celui d\'un appareil qui a d\'autres séances le même mois s\'additionnent, dans le cloud et sur l\'appareil qui se connecte, sans doublon @critique', async ({ ouvrirAppli, ouvrirAppareil }, testInfo) => {
    const email = adresse(testInfo.project.name, 'e2e-fusion');
    const a = await ouvrirAppli({ exercices: [{ titre: 'Alpha' }], reglages: journalMois('2026-11', [nov('s-a1', 3, 'Alpha'), nov('s-a2', 5, 'Alpha')]) });
    const uid = await connecter(a, email);
    await expect.poll(async () => idsSeances(await seancesCloud(uid))).toEqual(['s-a1', 's-a2']);

    const b = await ouvrirAppareil({ reglages: journalMois('2026-11', [nov('s-b1', 8, 'Alpha'), nov('s-b2', 9, 'Alpha')], [], 5) });
    await connecter(b, email);
    const toutes = ['s-a1', 's-a2', 's-b1', 's-b2'];
    await expect.poll(async () => idsSeances(await seancesCloud(uid)), { message: 'le cloud a les séances des deux appareils', timeout: 20_000 }).toEqual(toutes);
    await expect.poll(async () => idsSeances(await seancesLocales(b)), { message: 'B a reçu celles de A' }).toEqual(toutes);
    expect((await seancesCloud(uid)).length).toBe(4);   // une seule fois chaque séance
    // B rouvert : rien ne change (pas de doublon, rien de perdu).
    await b.reload();
    await attendreSynchro(b);
    await expect.poll(async () => idsSeances(await seancesLocales(b))).toEqual(toutes);
    expect(idsSeances(await seancesCloud(uid))).toEqual(toutes);
  });

  test('fusion : dès que l\'appareil qui a apporté des séances modifie quoi que ce soit, le premier appareil les reçoit (le document principal annonce alors le journal à jour)', async ({ ouvrirAppli, ouvrirAppareil }, testInfo) => {
    const email = adresse(testInfo.project.name, 'e2e-fusion-relance');
    const a = await ouvrirAppli({ exercices: [{ titre: 'Alpha' }], reglages: journalMois('2026-11', [nov('s-a1', 3, 'Alpha')]) });
    const uid = await connecter(a, email);
    await expect.poll(async () => idsSeances(await seancesCloud(uid))).toEqual(['s-a1']);
    const b = await ouvrirAppareil({ reglages: journalMois('2026-11', [nov('s-b1', 8, 'Alpha')], [], 5) });
    await connecter(b, email);
    await expect.poll(async () => idsSeances(await seancesCloud(uid)), { timeout: 20_000 }).toEqual(['s-a1', 's-b1']);
    await ajouterExercice(b, 'Un exercice de plus');   // n'importe quel envoi du document principal
    await attendreSynchro(b);
    await expect.poll(async () => idsSeances(await seancesLocales(a)), { message: 'A reçoit le journal fusionné', timeout: 20_000 }).toEqual(['s-a1', 's-b1']);
  });

  test('fusion : le premier appareil, resté ouvert, reçoit les séances apportées par le second sans rien faire de plus', async ({ ouvrirAppli, ouvrirAppareil }, testInfo) => {
    test.fail(true, 'SY-02 : la fusion à la connexion d\'un autre appareil écrit le journal du cloud mais pas le document principal : l\'appareil déjà connecté ne relit pas son journal');
    const email = adresse(testInfo.project.name, 'e2e-fusion-direct');
    const a = await ouvrirAppli({ exercices: [{ titre: 'Alpha' }], reglages: journalMois('2026-11', [nov('s-a1', 3, 'Alpha')]) });
    const uid = await connecter(a, email);
    await expect.poll(async () => idsSeances(await seancesCloud(uid))).toEqual(['s-a1']);
    const b = await ouvrirAppareil({ reglages: journalMois('2026-11', [nov('s-b1', 8, 'Alpha')], [], 5) });
    await connecter(b, email);
    await expect.poll(async () => idsSeances(await seancesCloud(uid)), { timeout: 20_000 }).toEqual(['s-a1', 's-b1']);
    await expect.poll(async () => idsSeances(await seancesLocales(a)), { message: 'A (resté connecté) reçoit la séance de B', timeout: 15_000 }).toEqual(['s-a1', 's-b1']);
  });

  test('fusion : même en rouvrant l\'appli, le premier appareil retrouve les séances apportées par le second', async ({ ouvrirAppli, ouvrirAppareil }, testInfo) => {
    test.fail(true, 'SY-02 : même cause ; à la réouverture, le premier appareil compare la révision du journal notée dans le document principal (périmée) et ne relit pas le mois');
    const email = adresse(testInfo.project.name, 'e2e-fusion-recharge');
    const a = await ouvrirAppli({ exercices: [{ titre: 'Alpha' }], reglages: journalMois('2026-11', [nov('s-a1', 3, 'Alpha')]) });
    const uid = await connecter(a, email);
    await expect.poll(async () => idsSeances(await seancesCloud(uid))).toEqual(['s-a1']);
    const b = await ouvrirAppareil({ reglages: journalMois('2026-11', [nov('s-b1', 8, 'Alpha')], [], 5) });
    await connecter(b, email);
    await expect.poll(async () => idsSeances(await seancesCloud(uid)), { timeout: 20_000 }).toEqual(['s-a1', 's-b1']);
    await a.reload();
    await attendreSynchro(a);
    await expect.poll(async () => idsSeances(await seancesLocales(a)), { message: 'A rouvert reçoit la séance de B', timeout: 15_000 }).toEqual(['s-a1', 's-b1']);
  });

  test('une séance saisie sur un appareil connecté part dans le document du mois et apparaît dans l\'historique de l\'autre appareil, sans rechargement @critique', async ({ ouvrirAppli, ouvrirAppareil }, testInfo) => {
    const email = adresse(testInfo.project.name, 'e2e-live');
    const a = await ouvrirAppli({ exercices: [{ titre: 'Alpha' }] });
    const uid = await connecter(a, email);
    const b = await ouvrirAppareil();
    await connecter(b, email);
    await expect(b.locator('#folder-container input.exercise-title')).toHaveCount(1);   // B a reçu la bibliothèque de A

    await ajouterSeancePassee(b, { nom: 'Séance du week-end', date: '2026-11-20', exercice: 'Alpha', minutes: 12 });
    await attendreSynchro(b);
    await expect.poll(async () => (await seancesCloud(uid)).map((s: any) => s.name)).toEqual(['Séance du week-end']);
    const [s] = await seancesCloud(uid);
    expect(s.totalSec).toBe(720);
    expect(s.steps.map((x: any) => [x.title, x.actualSec])).toEqual([['Alpha', 720]]);
    expect(new Date(s.date).toISOString()).toBe('2026-11-20T17:30:00.000Z');

    await expect.poll(async () => (await seancesLocales(a)).map((x: any) => x.name), { message: 'A reçoit la séance saisie sur B', timeout: 20_000 }).toEqual(['Séance du week-end']);
    // … et l'historique de A la montre.
    await a.getByRole('button', { name: 'Session guidée' }).click();
    await a.getByRole('button', { name: /^Historique/ }).click();
    await expect(HISTORIQUE(a)).toContainText('Séance du week-end');
    await expect(HISTORIQUE(a)).toContainText('20/11/26 18:30 · 12 min');
  });

  test('une séance supprimée sur un appareil disparaît partout : le cloud en garde la trace, et un appareil qui l\'avait encore la perd à sa connexion @critique', async ({ ouvrirAppli, ouvrirAppareil }, testInfo) => {
    const email = adresse(testInfo.project.name, 'e2e-suppression');
    const seances = [nov('s-garde', 4, 'Alpha'), nov('s-perdue', 6, 'Alpha')];
    const a = await ouvrirAppli({ exercices: [{ titre: 'Alpha' }], reglages: journalMois('2026-11', seances) });
    const uid = await connecter(a, email);
    await expect.poll(async () => idsSeances(await seancesCloud(uid))).toEqual(['s-garde', 's-perdue']);
    const b = await ouvrirAppareil();
    await connecter(b, email);
    await expect.poll(async () => idsSeances(await seancesLocales(b))).toEqual(['s-garde', 's-perdue']);

    // A supprime la séance du 6 novembre (✕ › « Supprimer cette séance ? »).
    await a.getByRole('button', { name: 'Session guidée' }).click();
    await a.getByRole('button', { name: /^Historique/ }).click();
    await expect(HISTORIQUE(a).locator('.gs-history-entry')).toHaveCount(2);
    await HISTORIQUE(a).locator('.gs-history-entry').filter({ hasText: '06/11/26' }).getByTitle('Supprimer cette entrée').click();
    await a.getByRole('dialog', { name: 'Supprimer cette séance ?' }).getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect(HISTORIQUE(a).locator('.gs-history-entry')).toHaveCount(1);

    await expect.poll(async () => idsSeances(await seancesCloud(uid)), { timeout: 20_000 }).toEqual(['s-garde']);
    expect((await document(uid, 'trainhub-log-2026-11')).deleted).toEqual(['s-perdue']);
    await expect.poll(async () => idsSeances(await seancesLocales(b)), { message: 'B voit la suppression', timeout: 20_000 }).toEqual(['s-garde']);

    // Un troisième appareil qui avait encore l'ancienne séance (journal posé avant sa connexion) la perd : la suppression est plus forte que la présence.
    const c = await ouvrirAppareil({ reglages: journalMois('2026-11', seances, [], 3) });
    await connecter(c, email);
    await expect.poll(async () => idsSeances(await seancesLocales(c)), { message: 'C perd la séance supprimée', timeout: 20_000 }).toEqual(['s-garde']);
    expect(idsSeances(await seancesCloud(uid))).toEqual(['s-garde']);
  });

  test('une séance corrigée sur un appareil (durée modifiée) arrive corrigée sur l\'autre', async ({ ouvrirAppli, ouvrirAppareil }, testInfo) => {
    const email = adresse(testInfo.project.name, 'e2e-correction');
    const a = await ouvrirAppli({ exercices: [{ titre: 'Alpha' }], reglages: journalMois('2026-11', [nov('s-corr', 12, 'Alpha')]) });
    const uid = await connecter(a, email);
    await expect.poll(async () => idsSeances(await seancesCloud(uid))).toEqual(['s-corr']);
    const b = await ouvrirAppareil();
    await connecter(b, email);
    await expect.poll(async () => idsSeances(await seancesLocales(b))).toEqual(['s-corr']);

    await b.getByRole('button', { name: 'Session guidée' }).click();
    await b.getByRole('button', { name: /^Historique/ }).click();
    await HISTORIQUE(b).getByTitle('Modifier cette séance (durées, tempo)').click();
    const panneau = b.locator('.gs-save-run-panel:visible');
    await panneau.locator('input[type=number]').first().fill('9');
    await panneau.locator('input[type=number]').first().press('Tab');
    await panneau.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(HISTORIQUE(b)).toContainText('Alpha (9 min)');

    await expect.poll(async () => (await seancesCloud(uid))[0]?.steps?.[0]?.actualSec, { timeout: 20_000 }).toBe(540);
    await expect.poll(async () => (await seancesLocales(a))[0]?.steps?.[0]?.actualSec, { message: 'A reçoit la durée corrigée', timeout: 20_000 }).toBe(540);
    expect((await seancesCloud(uid)).length).toBe(1);
  });

  test('une séance enregistrée hors connexion est signalée sur la pilule, puis envoyée et confirmée à la connexion @critique', async ({ ouvrirAppli }, testInfo) => {
    const page = await ouvrirAppli({ exercices: [{ titre: 'Alpha' }] });
    // Hors connexion : « Enregistrer » prévient que la séance restera sur l'appareil ; on enregistre quand même.
    await page.getByRole('button', { name: 'Session guidée' }).click();
    await page.getByRole('button', { name: /^Historique/ }).click();
    await HISTORIQUE(page).getByRole('button', { name: /^＋ Séance passée/ }).click();
    const p = page.locator('.gs-save-run-panel:visible');
    await p.locator('input[type=date]').fill('2026-11-18');
    await p.getByRole('button', { name: '＋ Ajouter un exercice' }).click();
    await page.getByRole('button', { name: 'Tout déplier' }).click();
    await page.getByRole('button', { name: 'Alpha', exact: true }).click();
    await p.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.getByRole('dialog', { name: 'Pas connecté à Google' }).getByRole('button', { name: 'Enregistrer quand même' }).click();
    await expect.poll(async () => (await seancesLocales(page)).length).toBe(1);
    // La pilule porte une pastille de message et la dit dans son info-bulle.
    await expect(page.locator('#google-signin-btn')).toHaveClass(/cc-message/);
    await expect(page.locator('#google-signin-btn')).toHaveAttribute('title', '1 séance enregistrée hors connexion : connecte-toi pour l\'envoyer');

    const uid = await connecter(page, adresse(testInfo.project.name, 'e2e-hors-connexion'));
    await expect(page.locator('.toast').filter({ hasText: '1 séance enregistrée hors connexion a bien été envoyée vers ton compte.' })).toBeVisible();
    await expect.poll(async () => (await seancesCloud(uid)).length, { timeout: 20_000 }).toBe(1);
    expect(await documents(uid)).toContain('trainhub-log-2026-11');
  });
});
