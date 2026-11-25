// MODULE « libre » — DÉMARRER l'entraînement libre : un chrono suit l'exercice affiché à l'écran principal. Observé en boîte noire (playwright-cli, 25/11/2026) : le bouton « Libre » ouvre une
// barre (chrono total, pause, arrêt) ; tant qu'aucune fiche n'est dépliée elle dit « Aucun exercice affiché » ; dès qu'une fiche s'ouvre elle dit « Départ dans 10 s », puis le chrono court.
// Le temps de l'attente ne compte pas. Les tests pilotent l'horloge de la page (`page.clock`, voir `aide-libre.ts`).
import { test, expect } from '../support/fixtures';
import {
  afficher, barre, boutonArret, boutonLibre, boutonPause, chrono, DELAI_DEPART, ecouler, formater, lancerLibre, ouvrirLibre, puces, quoi, replier, secondesChrono, sec, min,
  sessionEnCours, verifierEtat, demarrerSur, laisserPasser, tempsPuce,
} from './aide-libre';

test.describe('Libre : démarrer @libre', () => {
  test('« Libre » ouvre la barre sans exercice affiché ; en ouvrir un lance le décompte, puis le chrono suit l\'exercice @critique', async ({ page, ouvrirAppli, garde }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await expect(barre(page)).toBeHidden();
    await expect(boutonLibre(page)).not.toHaveClass(/free-on/);
    await lancerLibre(page);
    // Rien n'est déplié : la barre l'indique, le chrono attend, la pause n'a rien à suspendre.
    await verifierEtat(page, 'idle');
    await expect(barre(page)).toHaveAttribute('title', 'Entraînement libre — Aucun exercice affiché');
    await expect(chrono(page)).toHaveText('0:00');
    await expect(boutonPause(page)).toBeDisabled();
    await expect(boutonArret(page)).toBeEnabled();
    await expect(boutonLibre(page)).toHaveClass(/free-on/);
    // On déplie la fiche d'« Alpha » : le décompte avant départ commence.
    await afficher(page, 'Alpha');
    await ecouler(page, sec(1));
    await verifierEtat(page, 'wait');
    await expect(barre(page)).toHaveAttribute('title', 'Entraînement libre — Départ dans 10 s');
    await expect(quoi(page)).toHaveText('10 s');
    await expect(chrono(page)).toHaveText('0:00');
    // Dix secondes plus tard le chrono part ; il suit « Alpha ».
    await ecouler(page, sec(10));
    await verifierEtat(page, 'run');
    await expect(barre(page)).toHaveAttribute('title', 'Entraînement libre — Alpha');
    await ecouler(page, sec(25));
    await expect(chrono(page)).toHaveText('0:25');
    await expect(puces(page)).toHaveCount(1);
    await expect(tempsPuce(page, 'Alpha')).toHaveText('0:25');
    await expect(boutonPause(page)).toBeEnabled();
    expect(garde.bloquees).toEqual([]);
  });

  test('les 10 premières secondes après l\'affichage de la fiche ne comptent pas dans le chrono', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await lancerLibre(page);
    await afficher(page, 'Alpha');
    await ecouler(page, sec(10));
    await verifierEtat(page, 'wait');   // dix secondes après l'affichage : le décompte finit son dernier tour
    await expect(chrono(page)).toHaveText('0:00');
    await ecouler(page, sec(1));
    await verifierEtat(page, 'run');
    await expect(chrono(page)).toHaveText('0:00');
    await ecouler(page, sec(3));
    await expect(chrono(page)).toHaveText('0:03');
  });

  test('le chrono total suit le temps sur plusieurs minutes (format m:ss)', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, min(2) + sec(5));
    await expect(chrono(page)).toHaveText('2:05');
    expect(await secondesChrono(page)).toBe(2 * 60 + 5);
    expect(formater(2 * 60 + 5)).toBe('2:05');
  });

  test('avec une fiche déjà dépliée, appuyer sur « Libre » lance directement le décompte', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await afficher(page, 'Bravo');
    await lancerLibre(page);
    await verifierEtat(page, 'wait');   // la fiche est déjà là : le décompte part tout de suite
    await expect(quoi(page)).toHaveText('10 s');
    await ecouler(page, sec(10));
    await verifierEtat(page, 'run');
    await expect(barre(page)).toHaveAttribute('title', 'Entraînement libre — Bravo');
    await ecouler(page, sec(7));
    await expect(chrono(page)).toHaveText('0:07');
  });

  test('replier la fiche suspend le chrono (« Aucun exercice affiché ») ; la rouvrir relance le décompte et le temps repart d\'où il était', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, sec(20));
    await expect(chrono(page)).toHaveText('0:20');
    await replier(page, 'Alpha');
    await ecouler(page, sec(1));   // l'appli remarque que plus rien n'est affiché au « tic » suivant
    await verifierEtat(page, 'idle');
    await expect(barre(page)).toHaveAttribute('title', 'Entraînement libre — Aucun exercice affiché');
    const fige = await secondesChrono(page);
    expect(fige).toBeGreaterThanOrEqual(20);
    expect(fige).toBeLessThanOrEqual(21);
    await ecouler(page, min(1));
    expect(await secondesChrono(page)).toBe(fige);   // une minute sans exercice affiché : rien de compté
    await afficher(page, 'Alpha');
    await ecouler(page, sec(1));
    await verifierEtat(page, 'wait');
    expect(await secondesChrono(page)).toBe(fige);
    await ecouler(page, sec(10));
    await verifierEtat(page, 'run');
    await ecouler(page, sec(5));
    expect(await secondesChrono(page)).toBe(fige + 5);
    await expect(tempsPuce(page, 'Alpha')).toHaveText(formater(fige + 5));
  });

  test('la séance en cours est sauvegardée en continu (trainhub.gsLive.v1) avec le temps passé sur chaque exercice', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    expect(await sessionEnCours(page)).toBeNull();
    await demarrerSur(page, 'Alpha');
    await ecouler(page, sec(30));
    await expect.poll(async () => (await sessionEnCours(page))?.spent?.['free:ex-alpha'] ?? 0).toBeGreaterThanOrEqual(25_000);
    const live = await sessionEnCours(page);
    expect(live).toMatchObject({ kind: 'free', sessionId: 'free', name: 'Session libre' });
    expect(live.steps.map((s: any) => s.exerciseId)).toEqual(['ex-alpha']);
  });

  test('« Libre » pendant la séance demande confirmation : « Continuer » garde tout, « Arrêter » ouvre le récapitulatif @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, min(1) + sec(5));
    await boutonLibre(page).click();
    const boite = page.getByRole('dialog', { name: /^Arrêter l'entraînement libre/ });
    await expect(boite).toBeVisible();
    await expect(boite).toContainText("Le récapitulatif s'ouvre ensuite.");
    await boite.getByRole('button', { name: 'Continuer' }).click();
    await expect(boite).toBeHidden();
    await verifierEtat(page, 'run');
    await ecouler(page, sec(5));
    await expect(chrono(page)).toHaveText('1:10');
    await boutonLibre(page).click();
    await boite.getByRole('button', { name: 'Arrêter', exact: true }).click();
    await laisserPasser(page, 500);
    await expect(page.locator('.gs-save-run-panel')).toBeVisible();
    await expect(barre(page)).toBeHidden();
    await expect(boutonLibre(page)).not.toHaveClass(/free-on/);
  });

  test('arrêter alors qu\'aucun exercice n\'a été affiché : message « trop court », rien n\'est gardé', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await lancerLibre(page);
    await ecouler(page, min(2));
    await boutonArret(page).click();
    await expect(page.locator('.toast').filter({ hasText: 'Entraînement trop court' })).toBeVisible();
    await expect(barre(page)).toBeHidden();
    expect(await sessionEnCours(page)).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('trainhub.recentRuns.v1'))).toBeNull();
  });
});
