// MODULE « libre » — LE TEMPO NOTÉ pendant la séance. Observé en boîte noire (playwright-cli, 25/11/2026) : dans la fenêtre de fin, chaque exercice a un champ « Tempo atteint (BPM) » (à saisir, ou pré-rempli
// quand le métronome a joué assez longtemps sur l'exercice affiché : seuil mesuré sur le temps RÉEL de l'audio, pas sur l'horloge simulée — non testé ici). Le tempo saisi va dans le journal
// (`bpmFirst`, `bpmMax`, `bpmEnd`) et se lit dans l'Historique (« Alpha (1 min 31 s, 85 BPM) »). Pendant la séance, lancer le métronome (▶ de la fiche) enregistre déjà le tempo joué dans `trainhub.gsLive.v1`.
// Le métronome lui-même (son, tempo, mesure) = module `metronome` : ici seulement ce que la séance en retient.
import { test, expect } from '../support/fixtures';
import {
  arreterEtEnregistrer, arreterLibre, demarrerSur, ecouler, enregistrerSeance, etapesJournal, journalDuMois, laisserPasser, ligneDepart, ligneRecap, ouvrirLibre, ouvrirSessions, passerA, sec, min, sessionEnCours, tempoRecap,
} from './aide-libre';

test.describe('Libre : tempo noté @libre', () => {
  test('le tempo saisi dans la fenêtre de fin va dans le journal et s\'affiche dans l\'Historique @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, min(1) + sec(10));
    await passerA(page, 'Bravo');
    await ecouler(page, sec(30));
    await arreterLibre(page);
    await expect(tempoRecap(page, 'Alpha')).toHaveValue('');
    await expect(tempoRecap(page, 'Alpha')).toHaveAttribute('placeholder', '—');
    await tempoRecap(page, 'Alpha').fill('85');
    await enregistrerSeance(page);
    const [s] = await journalDuMois(page);
    const alpha = s.steps.find((x: any) => x.title === 'Alpha');
    const bravo = s.steps.find((x: any) => x.title === 'Bravo');
    expect([alpha.bpmFirst, alpha.bpmMax, alpha.bpmEnd]).toEqual([85, 85, 85]);
    expect([bravo.bpmFirst, bravo.bpmMax, bravo.bpmEnd]).toEqual([null, null, null]);   // non saisi = pas de tempo noté

    await ouvrirSessions(page);
    await page.getByRole('button', { name: /^Historique/ }).click();
    await laisserPasser(page);
    const histo = page.locator('.gs-history-panel');
    await expect(histo).toContainText(/Alpha \(1 min \d+ s, 85 BPM\)/);
    await expect(histo).toContainText(/Bravo \(0 min \d+ s\)/);
    await expect(histo).not.toContainText(/Bravo \([^)]*BPM\)/);
  });

  test('« Tempo atteint » se règle aussi aux chevrons, et seul le tempo de l\'exercice concerné est noté', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, min(1) + sec(5));
    await arreterLibre(page);
    await tempoRecap(page, 'Alpha').fill('100');
    await ligneRecap(page, 'Alpha').getByRole('button', { name: 'Augmenter' }).nth(2).click();   // les chevrons d'« Alpha » : minutes, secondes, tempo
    await expect(tempoRecap(page, 'Alpha')).toHaveValue('101');
    await ligneRecap(page, 'Alpha').getByRole('button', { name: 'Diminuer' }).nth(2).click();
    await ligneRecap(page, 'Alpha').getByRole('button', { name: 'Diminuer' }).nth(2).click();
    await expect(tempoRecap(page, 'Alpha')).toHaveValue('99');
    await enregistrerSeance(page);
    const [s] = await journalDuMois(page);
    expect([s.steps[0].bpmFirst, s.steps[0].bpmMax, s.steps[0].bpmEnd]).toEqual([99, 99, 99]);
  });

  test('lancer le métronome de la fiche pendant la séance : le tempo joué est noté sur l\'exercice affiché', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    const tempoCible = ligneDepart(page, 'Alpha').locator('input.metro-preset-bpm');
    await tempoCible.fill('80');
    await tempoCible.press('Enter');
    await ligneDepart(page, 'Alpha').getByRole('button', { name: 'Charger ce réglage dans le métronome et le lancer' }).click();
    await ecouler(page, sec(8));
    await expect.poll(async () => (await sessionEnCours(page))?.bpm?.['free:ex-alpha']?.first, { message: 'tempo joué noté dans la séance en cours' }).toBe(80);
    expect((await sessionEnCours(page)).bpm['free:ex-alpha']).toMatchObject({ first: 80, max: 80, end: 80 });
    // Arrêter le métronome ne coupe pas la séance.
    await page.locator('.metro-play-btn-big').click();
    await expect(page.locator('#free-bar')).toHaveClass(/free-bar-run/);
  });

  test('un tempo hors limites (500) n\'est pas laissé dans le champ pour être perdu en silence à l\'enregistrement', async ({ page, ouvrirAppli }) => {
    test.fail(true, 'LI-01 : « Tempo atteint » garde 500 affiché (le champ va de 30 à 300) puis l\'enregistrement l\'écarte sans rien dire (bpm = null)');
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, min(1) + sec(5));
    await arreterLibre(page);
    await tempoRecap(page, 'Alpha').fill('500');
    await tempoRecap(page, 'Alpha').blur();
    // Attendu : la saisie est ramenée dans la plage (300) ou refusée ; observé : 500 reste affiché, puis rien n'est noté.
    await expect(tempoRecap(page, 'Alpha')).not.toHaveValue('500');
  });
});
