// MODULE « fiche » — MÉTRONOME PRÉDÉFINI de l'exercice (tempo cible, mesure) et OBJECTIF TEMPO. Observé en boîte noire (playwright-cli, 24/11/2026) : le champ ‹ n › de la barre d'outils
// fixe le tempo cible (un premier clic sur › crée le réglage à 100) ; l'engrenage ouvre la fenêtre du métronome en mode « Réglage pour « X » » (Enregistrer / Annuler) ; une fois un réglage posé,
// l'en-tête montre la pastille ♩ (clic : fenêtre avec « Retirer ce tempo »), la barre d'outils la mesure (ex. « 3/4 ») et un ▶ « Charger ce réglage dans le métronome et le lancer » ;
// « Objectif tempo (activé / désactivé) » est un interrupteur (`tempoGoal`). Le son du métronome lui-même : module `metronome` ; détails du préréglage : bancs `preset` et `tempo` (PLAN § 7).
import { test, expect } from '../support/fixtures';
import { boutonObjectif, boutonOptionsMetro, champTempo, etatFiche, exo, fiche, ouvrirTechnique } from './aide-fiche';
import type { Locator, Page } from '@playwright/test';

const reglage = (bpm: number, mesure = 4) => ({ bpm, beatsPerMeasure: mesure, rhythmLabel: `${mesure}/4`, subdivision: 1, advanced: false, pattern: [2, ...Array(mesure - 1).fill(1)], beatPattern: [2, ...Array(mesure - 1).fill(1)] });
const pastilleTempo = (f: Locator) => f.locator('.exercise-row').getByRole('button', { name: /^♩/ });
/** Les boutons « − 10 » / « + 10 » passent sous le cadran rond : Playwright refuse le clic au centre (« intercepts pointer events ») ; on vise leur partie libre, comme le doigt de l'utilisateur. */
async function pas10(page: Page, nom: '− 10' | '+ 10') {
  const b = page.getByRole('button', { name: nom });
  const r = (await b.boundingBox())!;
  await b.click({ position: { x: nom === '+ 10' ? r.width * 0.85 : r.width * 0.15, y: r.height * 0.8 } });
}
const fenetreReglage = (page: Page, titre: string) => page.getByText(`Réglage pour « ${titre} »`);

test.describe('Fiche : métronome prédéfini et objectif tempo @fiche', () => {
  test('régler le tempo cible : saisie + Entrée crée le réglage de l\'exercice (pastille ♩ dans l\'en-tête, ▶ dans la barre), enregistré et conservé après rechargement @critique', async ({ ouvrirAppli, garde }) => {
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme', 'Autre']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await expect(champTempo(f)).toHaveValue('');
    await expect(pastilleTempo(f)).toHaveCount(0);
    await champTempo(f).fill('90');
    await champTempo(f).press('Enter');
    await expect.poll(async () => (await exo(page, 'Gamme')).metronome?.bpm).toBe(90);
    await expect(pastilleTempo(f)).toHaveText(/90/);
    await expect(f.getByRole('button', { name: 'Charger ce réglage dans le métronome et le lancer' })).toBeVisible();
    // L'autre exercice n'est pas touché.
    await expect(champTempo(fiche(page, 'Autre'))).toHaveValue('');
    expect((await exo(page, 'Autre')).metronome ?? null).toBeNull();

    await page.reload();
    await ouvrirTechnique(page);
    await expect(champTempo(f)).toHaveValue('90');
    await expect(pastilleTempo(f)).toHaveText(/90/);
    expect(garde.bloquees).toEqual([]);
  });

  test('chevrons ‹ › : le premier › crée le réglage à 100, puis ± 1 à chaque clic', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await f.getByRole('button', { name: 'Augmenter' }).click();
    await expect(champTempo(f)).toHaveValue('100');
    await f.getByRole('button', { name: 'Augmenter' }).click();
    await expect(champTempo(f)).toHaveValue('101');
    await f.getByRole('button', { name: 'Diminuer' }).click();
    await f.getByRole('button', { name: 'Diminuer' }).click();
    await expect(champTempo(f)).toHaveValue('99');
    await expect.poll(async () => (await exo(page, 'Gamme')).metronome?.bpm).toBe(99);
  });

  test('l\'engrenage ouvre « Réglage pour « Gamme » » : tempo + 10 et mesure 3/4, « Enregistrer » pose le réglage dans la fiche @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche([{ titre: 'Gamme', extra: { metronome: reglage(100) } }]) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await boutonOptionsMetro(f).click();
    await expect(fenetreReglage(page, 'Gamme')).toBeVisible();
    await pas10(page, '+ 10');
    await page.getByRole('button', { name: 'Formule 3/4' }).click();
    await fenetreReglage(page, 'Gamme').locator('..').getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(fenetreReglage(page, 'Gamme')).toBeHidden();
    await expect.poll(async () => { const m = (await exo(page, 'Gamme')).metronome; return [m.bpm, m.beatsPerMeasure, m.rhythmLabel]; }).toEqual([110, 3, '3/4']);
    await expect(champTempo(f)).toHaveValue('110');
    await expect(f.locator('.ex-tools-left').getByText('3/4', { exact: true })).toBeVisible();
    await expect(pastilleTempo(f)).toHaveText(/110/);
  });

  test('« Annuler » dans la fenêtre de réglage : rien n\'est enregistré', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche([{ titre: 'Gamme', extra: { metronome: reglage(100) } }]) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await boutonOptionsMetro(f).click();
    await expect(fenetreReglage(page, 'Gamme')).toBeVisible();
    await pas10(page, '+ 10');
    await page.getByRole('button', { name: 'Formule 5/4' }).click();
    await fenetreReglage(page, 'Gamme').locator('..').getByRole('button', { name: 'Annuler', exact: true }).click();   // (« Annuler » existe aussi en haut de page : défaire)
    await expect(fenetreReglage(page, 'Gamme')).toBeHidden();
    const m = (await exo(page, 'Gamme')).metronome;
    expect([m.bpm, m.beatsPerMeasure]).toEqual([100, 4]);
    await expect(champTempo(f)).toHaveValue('100');
  });

  test('▶ de la barre d\'outils : charge le réglage de l\'exercice dans le métronome (tempo, mesure) et le lance @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche([{ titre: 'Gamme', extra: { metronome: reglage(132, 3) } }]) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await f.getByRole('button', { name: 'Charger ce réglage dans le métronome et le lancer' }).click();
    // La fenêtre du métronome s'ouvre, joue (bouton « Arrêter »), au tempo et dans la mesure de l'exercice.
    const arreter = page.getByRole('button', { name: 'Arrêter', exact: true });
    await expect(arreter).toBeVisible();
    await expect(page.getByRole('button', { name: '132', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Formule 3/4' })).toHaveClass(/metro-progressive-active/);   // formule allumée (classe CSS : pas d'aria-pressed)
    await expect(page.getByRole('button', { name: 'Formule 4/4' })).not.toHaveClass(/metro-progressive-active/);
    await arreter.click();
    await expect(page.getByRole('button', { name: 'Jouer', exact: true })).toBeVisible();
  });

  test('la pastille ♩ de l\'en-tête règle le tempo et « Retirer ce tempo » enlève le réglage de l\'exercice', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche([{ titre: 'Gamme', extra: { metronome: reglage(90) } }]) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await pastilleTempo(f).click();
    await expect(page.getByText('Tempo cible', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Retirer ce tempo' }).click();
    await expect.poll(async () => (await exo(page, 'Gamme')).metronome ?? null).toBeNull();
    await expect(pastilleTempo(f)).toHaveCount(0);
    await expect(champTempo(f)).toHaveValue('');
    await expect(f.getByRole('button', { name: 'Charger ce réglage dans le métronome et le lancer' })).toHaveCount(0);
  });

  test('objectif tempo : l\'interrupteur s\'éteint et se rallume, l\'état est enregistré et conservé après rechargement @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await expect(boutonObjectif(f)).toHaveAccessibleName('Objectif tempo (activé)');   // actif par défaut
    await expect(boutonObjectif(f)).toHaveAttribute('aria-pressed', 'true');
    await boutonObjectif(f).click();
    await expect(boutonObjectif(f)).toHaveAccessibleName('Objectif tempo (désactivé)');
    await expect(boutonObjectif(f)).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await exo(page, 'Gamme')).tempoGoal).toBe(false);
    await page.reload();
    await ouvrirTechnique(page);
    await expect(boutonObjectif(f)).toHaveAttribute('aria-pressed', 'false');
    await boutonObjectif(f).click();
    await expect(boutonObjectif(f)).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await exo(page, 'Gamme')).tempoGoal).toBe(true);
  });
});
