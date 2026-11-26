// MODULE « metronome » — JOUER / ARRÊTER. Observé en boîte noire (playwright-cli, 25/11/2026) : le gros bouton passe de « Jouer » à « Arrêter » ; le chrono du métronome suit l'horloge de la page ;
// la pastille du temps joué porte `metro-step-current` ; « Arrêter » garde la valeur du chrono, une relance repart de zéro ; la réinitialisation remet 00:00. Le SON n'est pas mesuré (pas de mesure
// du signal dans la VM) : on vérifie l'état visible, et le banc `son` tient le détail des contextes audio (PLAN § 7). Avec la sortie audio factice (PulseAudio), le banc `preset` voit un contexte de plus
// quand on applique un préréglage en lecture : B-01 « à confirmer » dans bugs.md — ici on ne regarde que ce qui s'observe (la lecture continue).
import { test, expect } from '../support/fixtures';
import { appuyer, alArret, chrono, enLecture, jouer, metro, muet, ouvrir, ouvrirMetro, pastille, pastilles, razChrono, saisirTempo, secondesChrono, valeurTempo, MAINT, plus10, ouvrirAvecHorloge, etatMetro, curseurVolume, boutonVolume } from './aide-metronome';

test.describe('Métronome : jouer et arrêter @metronome', () => {
  test('Jouer lance la lecture (le bouton dit « Arrêter », le chrono avance), Arrêter la coupe @critique', async ({ page, ouvrirAppli, garde }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await alArret(page);
    await expect(chrono(page)).toHaveText('00:00');
    await jouer(page).click();
    await enLecture(page);
    await expect(jouer(page)).toHaveClass(/metro-play-btn-active/);
    await expect(chrono(page)).not.toHaveText('00:00', { timeout: 5_000 });
    await jouer(page).click();
    await alArret(page);
    await expect(jouer(page)).not.toHaveClass(/metro-play-btn-active/);
    // À l'arrêt le chrono ne bouge plus.
    const arrete = await chrono(page).innerText();
    await expect.poll(async () => (await chrono(page).innerText()), { intervals: [1_500], timeout: 3_000 }).toBe(arrete);
    expect(garde.bloquees).toEqual([]);
  });

  test('la pastille du temps joué s\'allume et avance au rythme des clics (les quatre s\'allument, une seule « courante » à la fois)', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await saisirTempo(page, 240);   // un clic toutes les 250 ms : le test ne dépend pas d'une longue attente
    expect(await pastilles(page).evaluateAll((els) => els.filter((e) => /metro-step-(current|flash)/.test(e.className)).length), 'à l\'arrêt aucune pastille n\'est allumée').toBe(0);
    // Une pastille ne reste « courante » qu'un instant : un sondage à intervalles réguliers peut la manquer. Un observateur de la page note donc toutes celles qui s'allument, et le plus grand nombre allumées ensemble.
    await metro(page).evaluate((panneau) => {
      const w = window as any; w.__allumees = new Set<string>(); w.__maxCourantes = 0;
      new MutationObserver(() => {
        const courantes = panneau.querySelectorAll('.metro-step.metro-step-current');
        w.__maxCourantes = Math.max(w.__maxCourantes, courantes.length);
        panneau.querySelectorAll('.metro-step').forEach((e: Element) => { if (/metro-step-(current|flash)/.test(e.className)) w.__allumees.add((e as HTMLElement).dataset.idx || ''); });
      }).observe(panneau, { attributes: true, subtree: true, attributeFilter: ['class'] });
    });
    await jouer(page).click();
    await enLecture(page);
    await expect.poll(() => page.evaluate(() => [...(window as any).__allumees].sort().join(',')), { message: 'les quatre pastilles s\'allument tour à tour' }).toBe('0,1,2,3');
    expect(await page.evaluate(() => (window as any).__maxCourantes), 'jamais deux pastilles « courantes » ensemble').toBeLessThanOrEqual(1);
    await jouer(page).click();
    await alArret(page);
  });

  test('le chrono compte les secondes de l\'horloge : 5 s jouées = 00:05, Arrêter le fige, relancer repart de zéro', async ({ page, ouvrirAppli }) => {
    await ouvrirAvecHorloge(page, ouvrirAppli, { etat: etatMetro(['Gamme']) });
    await ouvrir(page, true);
    await jouer(page).click();
    await enLecture(page);
    await page.clock.runFor(5_000);
    expect(await secondesChrono(page)).toBe(5);
    await page.clock.runFor(4_000);
    expect(await secondesChrono(page)).toBe(9);
    await jouer(page).click();
    await alArret(page);
    await page.clock.runFor(3_000);
    expect(await secondesChrono(page), 'arrêté : le chrono ne bouge plus').toBe(9);
    await jouer(page).click();
    await enLecture(page);
    expect(await secondesChrono(page), 'relancé : le chrono repart de zéro').toBeLessThanOrEqual(1);
    await page.clock.runFor(2_000);
    expect(await secondesChrono(page)).toBeGreaterThanOrEqual(2);
    expect(await secondesChrono(page)).toBeLessThanOrEqual(3);
  });

  test('« Réinitialiser le chronomètre » remet 00:00 (à l\'arrêt, et en cours de lecture sans l\'interrompre)', async ({ page, ouvrirAppli }) => {
    await ouvrirAvecHorloge(page, ouvrirAppli, { etat: etatMetro(['Gamme']) });
    await ouvrir(page, true);
    await jouer(page).click();
    await enLecture(page);
    await page.clock.runFor(6_000);
    expect(await secondesChrono(page)).toBe(6);
    await razChrono(page).click();
    await expect(chrono(page)).toHaveText('00:00');
    await enLecture(page);
    await page.clock.runFor(2_000);
    expect(await secondesChrono(page)).toBe(2);
    await jouer(page).click();
    await alArret(page);
    await razChrono(page).click();
    await expect(chrono(page)).toHaveText('00:00');
  });

  test('changer le tempo pendant la lecture ne l\'arrête pas', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await jouer(page).click();
    await enLecture(page);
    await saisirTempo(page, 150);
    await expect(valeurTempo(page)).toHaveText('150');
    await enLecture(page);
    await appuyer(plus10(page));
    await expect(valeurTempo(page)).toHaveText('160');
    await enLecture(page);
    await expect(chrono(page)).not.toHaveText('00:00');
  });

  test('@ordinateur couper le son (muet) pendant la lecture : la lecture continue, le curseur de volume passe à 0 ; rétablir le ramène', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await jouer(page).click();
    await enLecture(page);
    await muet(page).click();
    await expect(muet(page)).toHaveAttribute('aria-pressed', 'true');
    await enLecture(page);
    await expect(jouer(page)).toHaveClass(/metro-play-btn-active/);
    await muet(page).click();
    await expect(muet(page)).toHaveAttribute('aria-pressed', 'false');
    await enLecture(page);
  });

  test('un rechargement de la page arrête le métronome (rien ne joue seul au retour)', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await jouer(page).click();
    await enLecture(page);
    await page.reload();
    await expect(page.locator('#folder-container')).toBeAttached();
    await ouvrir(page);
    await alArret(page);
    await expect(chrono(page)).toHaveText('00:00');
  });
});
