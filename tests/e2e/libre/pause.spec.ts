// MODULE « libre » — PAUSE et REPRISE. Observé en boîte noire (playwright-cli, 25/11/2026) : le bouton ⏸ de la barre (aussi « double Espace ») fige le chrono (« En pause ») ; son libellé devient
// « Reprendre le décompte » ; reprendre relance le chrono tout de suite. Rien n'est compté pendant la pause, même si on affiche une autre fiche. Pendant la pause on peut arrêter la séance.
import { test, expect } from '../support/fixtures';
import {
  afficher, arreterEtEnregistrer, arreterLibre, barre, boutonPause, chrono, demarrerSur, ecouler, enregistrerSeance, etapesJournal, fenetreSeance, journalDuMois, lancerLibre, ouvrirLibre, passerA, puce,
  resumeRecap, sec, min, secondesChrono, secondesPuce, sessionEnCours, tempsPuce, verifierEtat,
} from './aide-libre';

test.describe('Libre : pause et reprise @libre', () => {
  test('« Pause » fige le chrono et l\'exercice ; bien plus tard « Reprendre » relance le chrono d\'où il était @critique', async ({ page, ouvrirAppli, garde }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, sec(20));
    await expect(boutonPause(page)).toHaveAccessibleName('Mettre en pause');
    await boutonPause(page).click();
    await verifierEtat(page, 'paused');
    await expect(barre(page)).toHaveAttribute('title', 'Entraînement libre — En pause');
    await expect(boutonPause(page)).toHaveAccessibleName('Reprendre le décompte');
    await expect(chrono(page)).toHaveText('0:20');
    await ecouler(page, min(1) + sec(30));
    await expect(chrono(page)).toHaveText('0:20');   // une minute et demie de pause : rien de compté
    await expect(tempsPuce(page, 'Alpha')).toHaveText('0:20');
    await boutonPause(page).click();
    await verifierEtat(page, 'run');
    await expect(boutonPause(page)).toHaveAccessibleName('Mettre en pause');
    await expect(barre(page)).toHaveAttribute('title', 'Entraînement libre — Alpha');
    await ecouler(page, sec(10));
    await expect(chrono(page)).toHaveText('0:30');
    await ecouler(page, sec(2));
    await expect(tempsPuce(page, 'Alpha')).toHaveText('0:32');
    expect(garde.bloquees).toEqual([]);
  });

  test('« double Espace » met en pause puis reprend, comme le bouton', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, sec(5));
    await page.keyboard.press('Space');
    await page.keyboard.press('Space');
    await verifierEtat(page, 'paused');
    await ecouler(page, sec(30));
    await expect(chrono(page)).toHaveText('0:05');
    await page.keyboard.press('Space');
    await page.keyboard.press('Space');
    await verifierEtat(page, 'run');
    await ecouler(page, sec(5));
    await expect(chrono(page)).toHaveText('0:10');
  });

  test('un seul appui sur Espace ne fait rien (pas de pause par mégarde)', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await page.keyboard.press('Space');
    await ecouler(page, sec(5));
    await verifierEtat(page, 'run');
    await expect(chrono(page)).toHaveText('0:05');
  });

  test('le temps passé en pause n\'apparaît pas dans la séance enregistrée', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, sec(40));
    await boutonPause(page).click();
    await ecouler(page, min(2));
    await boutonPause(page).click();
    await ecouler(page, sec(30));
    await arreterEtEnregistrer(page);
    const [s] = await journalDuMois(page);
    expect(s.totalSec).toBeGreaterThanOrEqual(70);
    expect(s.totalSec).toBeLessThanOrEqual(72);   // 40 s + 30 s, et non 2 minutes de plus
    expect(etapesJournal(s)[0][0]).toBe('Alpha');
  });

  test('arrêter pendant la pause ouvre le récapitulatif avec le temps déjà passé', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, min(1) + sec(15));
    await boutonPause(page).click();
    await ecouler(page, min(1));
    await arreterLibre(page);
    await expect(fenetreSeance(page)).toBeVisible();
    await expect(resumeRecap(page)).toContainText(/^1 min 1[5-6] s · 1 exercice$/);
    await expect(barre(page)).toBeHidden();
    expect(await sessionEnCours(page)).not.toBeNull();   // la séance reste « en cours » tant qu'on n'a pas répondu
  });

  test('en pause, afficher une autre fiche ne compte rien ; à la reprise le temps va au nouvel exercice', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, sec(20));
    await boutonPause(page).click();
    await afficher(page, 'Bravo');
    await ecouler(page, sec(15));
    await verifierEtat(page, 'paused');
    await expect(chrono(page)).toHaveText('0:20');
    await boutonPause(page).click();
    await ecouler(page, sec(12));
    await expect(barre(page)).toHaveAttribute('title', 'Entraînement libre — Bravo');
    await expect(chrono(page)).toHaveText('0:32');
    expect(await secondesPuce(page, 'Bravo')).toBeGreaterThanOrEqual(8);
    expect(await secondesPuce(page, 'Alpha')).toBe(20);
  });

  test('pendant le décompte avant départ la pause est possible ; la séance reste cohérente à la reprise', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, sec(10));
    await afficher(page, 'Bravo');
    await ecouler(page, sec(3));
    await verifierEtat(page, 'wait');
    await boutonPause(page).click();
    await verifierEtat(page, 'paused');
    await ecouler(page, sec(30));
    await boutonPause(page).click();
    await ecouler(page, sec(20));
    await verifierEtat(page, 'run');
    // Le temps de la pause n'a pas été compté : 10 s sur Alpha + au plus 20 s sur Bravo.
    expect(await secondesChrono(page)).toBeLessThanOrEqual(31);
    expect(await secondesChrono(page)).toBeGreaterThanOrEqual(20);
  });
});
