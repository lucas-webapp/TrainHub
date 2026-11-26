// MODULE « metronome » — LE MÉTRONOME D'UN EXERCICE (réglage rattaché à la fiche). Observé en boîte noire (playwright-cli, 25/11/2026) : le métronome ÉPINGLÉ « suit l'exercice ouvert » (Paramètres › Métronome ›
// Volet épinglé, allumé par défaut) : déplier une fiche qui a un réglage charge SON tempo et SA mesure dans le métronome, même en pleine lecture (la lecture continue), avec le message
// « Métronome réglé sur « X » (80 BPM · 3/4). » + « Annuler ». Une icône disquette apparaît alors dans l'en-tête du métronome : « Identique au réglage de « X » » ; après une modification,
// « Mettre à jour ce réglage dans l'exercice « X » » l'enregistre dans la fiche. La fenêtre flottante, elle, ne suit pas. Le détail (fenêtre « Réglage pour « X » », pastille ♩) : module `fiche`.
// B-01 (bugs.md) : le banc `preset` voit un contexte audio de plus quand un réglage est appliqué en lecture ; ici seul l'observable compte : la lecture continue.
import type { Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { chronoAuMoins, DEJA_EPINGLE, ouvrirEpingle, alArret, attendreEtat, boutonMetronome, accentsAffiches, chrono, enLecture, etatMetro, jouer, metro, ouvrir, ouvrirEtEpingler, ouvrirMetro, pastilles, reglage, reglerEnregistre, saisirTempo, tempoAffiche, valeurTempo, ligneDepart } from './aide-metronome';
import { exo } from '../fiche/aide-fiche';

const EXOS = [{ titre: 'Gamme', reg: reglage(80, 3) }, { titre: 'Arpeges', reg: reglage(140, 5) }, 'Libre'];
const deplier = (page: Page, titre: string) => ligneDepart(page, titre).locator('.exercise-row-spacer').first().click();
const message = (page: Page, texte: string | RegExp) => page.locator('.toast').filter({ hasText: texte });
const reglageExo = async (page: Page, titre: string) => (await exo(page, titre)).metronome;

test.describe('Métronome : réglage rattaché à un exercice @metronome', () => {
  test('volet épinglé : déplier une fiche charge son tempo et sa mesure dans le métronome, et le dit @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli, EXOS, { reglages: DEJA_EPINGLE });
    await ouvrirEpingle(page);
    await expect(valeurTempo(page)).toHaveText('100');
    await deplier(page, 'Gamme');
    await expect(valeurTempo(page)).toHaveText('80');
    await expect(pastilles(page)).toHaveCount(3);
    await expect(message(page, 'Métronome réglé sur « Gamme » (80 BPM · 3/4).')).toBeVisible();
    await attendreEtat(page, (m) => [m.bpm, m.beatsPerMeasure], [80, 3]);
    await expect(reglerEnregistre(page)).toHaveAttribute('title', 'Identique au réglage de « Gamme »');
    await deplier(page, 'Arpeges');
    await expect(valeurTempo(page)).toHaveText('140');
    await expect(pastilles(page)).toHaveCount(5);
  });

  test('en pleine lecture, déplier une autre fiche change le tempo SANS arrêter le métronome ni son chrono (cf. B-01) @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli, EXOS, { reglages: DEJA_EPINGLE });
    await ouvrirEpingle(page);
    await jouer(page).click();
    await enLecture(page);
    await expect.poll(async () => Number((await chrono(page).innerText()).split(':')[1])).toBeGreaterThanOrEqual(2);
    await deplier(page, 'Arpeges');
    await expect(valeurTempo(page)).toHaveText('140');
    await expect(pastilles(page)).toHaveCount(5);
    await enLecture(page);
    await chronoAuMoins(page, 2);   // le chrono n'est pas remis à zéro
    await deplier(page, 'Gamme');
    await expect(valeurTempo(page)).toHaveText('80');
    await enLecture(page);
    await jouer(page).click();
    await alArret(page);
  });

  test('« Annuler » dans le message rend le réglage d\'avant (tempo et mesure)', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli, EXOS, { reglages: DEJA_EPINGLE });
    await ouvrirEpingle(page);
    await saisirTempo(page, 111);
    await deplier(page, 'Gamme');
    await expect(valeurTempo(page)).toHaveText('80');
    await message(page, /Métronome réglé sur « Gamme »/).getByRole('button', { name: 'Annuler' }).click();
    await expect(valeurTempo(page)).toHaveText('111');
    await expect(pastilles(page)).toHaveCount(4);
    await attendreEtat(page, (m) => [m.bpm, m.beatsPerMeasure], [111, 4]);
  });

  test('un exercice SANS réglage laisse le métronome tel qu\'il est', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli, EXOS, { reglages: DEJA_EPINGLE });
    await ouvrirEpingle(page);
    await deplier(page, 'Gamme');
    await expect(valeurTempo(page)).toHaveText('80');
    await deplier(page, 'Libre');
    await expect(ligneDepart(page, 'Libre')).not.toHaveClass(/collapsed/);
    await expect(valeurTempo(page)).toHaveText('80');
    await expect(pastilles(page)).toHaveCount(3);
  });

  test('Paramètres › « Suivre l\'exercice ouvert » éteint : déplier une fiche ne touche plus au métronome', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli, EXOS, { reglages: DEJA_EPINGLE });
    await page.getByRole('button', { name: 'Paramètres' }).click();
    await page.getByRole('tab', { name: 'Métronome' }).click();
    const interrupteur = page.getByRole('switch').first();
    await expect(interrupteur).toBeChecked();
    await interrupteur.click();
    await expect(interrupteur).not.toBeChecked();
    await page.getByRole('button', { name: 'Fermer', exact: true }).click();
    await ouvrirEpingle(page);
    await deplier(page, 'Gamme');
    await expect(ligneDepart(page, 'Gamme')).not.toHaveClass(/collapsed/);
    await expect(valeurTempo(page)).toHaveText('100');
    await expect(message(page, /Métronome réglé sur/)).toHaveCount(0);
  });

  test('la fenêtre flottante ne suit pas l\'exercice ouvert (seul le volet épinglé le fait)', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli, EXOS);
    await ouvrir(page);
    await metro(page).getByRole('button', { name: 'Fermer', exact: true }).click();
    await deplier(page, 'Gamme');
    await expect(ligneDepart(page, 'Gamme')).not.toHaveClass(/collapsed/);
    await ouvrir(page);
    await expect(valeurTempo(page)).toHaveText('100');
  });

  test('la disquette « Mettre à jour ce réglage dans l\'exercice » enregistre le tempo et la mesure dans la fiche @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli, EXOS, { reglages: DEJA_EPINGLE });
    await ouvrirEpingle(page);
    await deplier(page, 'Gamme');
    await expect(valeurTempo(page)).toHaveText('80');
    await saisirTempo(page, 95);
    await metro(page).getByRole('button', { name: '4/4' }).click();
    await expect(reglerEnregistre(page)).toHaveAttribute('title', 'Mettre à jour ce réglage dans l\'exercice « Gamme »');
    expect((await reglageExo(page, 'Gamme')).bpm, 'pas encore enregistré dans la fiche').toBe(80);
    await reglerEnregistre(page).click();
    await expect(message(page, 'Métronome de « Gamme » mis à jour')).toBeVisible();
    await expect.poll(async () => { const r = await reglageExo(page, 'Gamme'); return [r.bpm, r.beatsPerMeasure]; }).toEqual([95, 4]);
    await expect(reglerEnregistre(page)).toHaveAttribute('title', 'Identique au réglage de « Gamme »');
    // Les autres exercices ne sont pas touchés.
    expect((await reglageExo(page, 'Arpeges')).bpm).toBe(140);
    // … et en repliant puis dépliant la fiche, le métronome reprend ce réglage.
    await deplier(page, 'Arpeges');
    await expect(valeurTempo(page)).toHaveText('140');
    await deplier(page, 'Gamme');
    await expect(valeurTempo(page)).toHaveText('95');
    await expect(pastilles(page)).toHaveCount(4);
  });

  test('le ▶ de la fiche « Charger ce réglage dans le métronome et le lancer » ouvre le métronome et joue à ce tempo @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli, EXOS);
    await deplier(page, 'Gamme');
    await expect(metro(page)).toBeHidden();
    await ligneDepart(page, 'Gamme').getByRole('button', { name: 'Charger ce réglage dans le métronome et le lancer' }).click();
    await expect(metro(page)).toBeVisible();
    await expect(valeurTempo(page)).toHaveText('80');
    await expect(pastilles(page)).toHaveCount(3);
    await enLecture(page);
    await expect(chrono(page)).not.toHaveText('00:00', { timeout: 5_000 });
    await jouer(page).click();
    await alArret(page);
  });

  test('le ▶ d\'une AUTRE fiche pendant la lecture : le tempo change, la lecture continue (cf. B-01)', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli, EXOS, { reglages: DEJA_EPINGLE });
    await ouvrirEpingle(page);
    await deplier(page, 'Gamme');
    await ligneDepart(page, 'Gamme').getByRole('button', { name: 'Charger ce réglage dans le métronome et le lancer' }).click();
    await expect(valeurTempo(page)).toHaveText('80');
    await enLecture(page);
    await expect.poll(async () => Number((await chrono(page).innerText()).split(':')[1])).toBeGreaterThanOrEqual(2);
    await deplier(page, 'Arpeges');
    await ligneDepart(page, 'Arpeges').getByRole('button', { name: 'Charger ce réglage dans le métronome et le lancer' }).click();
    await expect(valeurTempo(page)).toHaveText('140');
    await expect(pastilles(page)).toHaveCount(5);
    await enLecture(page);
    await chronoAuMoins(page, 2);   // le chrono n'est pas remis à zéro
  });
});
