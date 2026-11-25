// MODULE « session » — le DÉROULÉ d'une session lancée : chrono, Pause / Reprendre, −1 / +1 min, Précédent / Suivant, enchaînement automatique, cloche, avancement, deux colonnes.
// Observé en boîte noire (playwright-cli, 25/11/2026) : le chrono décompte la durée prévue (« 06:00 »), passe en « +00:05 » en dépassement ; « Total » compte le temps réellement
// passé (arrêté en pause) ; la liste des exercices est à droite (≥ 560 px) et masquée au téléphone. Le temps est piloté par `page.clock` : rien n'attend pour de vrai.
// Le son de la cloche et du carillon est du module `metronome` : ici seulement l'état visible des boutons.
import { test, expect } from '../support/fixtures';
import {
  arreter, avancer, barre, chrono, cloche, colonneDroite, colonneGauche, elementsDeroule, enchainement, etatSession, lancerDepuisListe, listeDeroule, minutes, moinsUneMin,
  ouvrirAvecHorloge, ouvrirSessions, pause, plusUneMin, precedent, rangExercice, reprendre, secondes, secondesChrono, suivant, texteChrono, titreExercice, totalChrono, sessionsEnregistrees,
} from './aide-session';

const EXOS = ['Alpha', 'Bravo', 'Charlie'];
const grille = () => etatSession(EXOS, [{ nom: 'Grille', exercices: [['Alpha', 6], ['Bravo', 5], ['Charlie', 4]] }]);

async function demarrer(page: any, ouvrirAppli: any, etat = grille()) {
  await ouvrirAvecHorloge(page, ouvrirAppli, { etat });
  await ouvrirSessions(page);
  await lancerDepuisListe(page, 'Grille');
  return page;
}

test.describe('Session : déroulé @session', () => {
  test('le chrono décompte la durée prévue, « Total » compte le temps passé, la pause les fige tous les deux @critique', async ({ page, ouvrirAppli, garde }) => {
    await demarrer(page, ouvrirAppli);
    await expect(rangExercice(page)).toHaveText(/Exercice 1 \/ 3/i);
    await expect(titreExercice(page)).toHaveText('Alpha');
    await expect(chrono(page)).toHaveText('06:00');
    await expect(totalChrono(page)).toHaveText('Total 0:00');
    await avancer(page, secondes(75));
    await expect(chrono(page)).toHaveText('04:45');
    await expect(totalChrono(page)).toHaveText('Total 1:15');

    await pause(page).click();
    await expect(reprendre(page)).toBeVisible();
    await avancer(page, secondes(120));
    await expect(chrono(page)).toHaveText('04:45');          // figé pendant la pause
    await expect(totalChrono(page)).toHaveText('Total 1:15');

    await reprendre(page).click();
    await expect(pause(page)).toBeVisible();
    await avancer(page, secondes(45));
    await expect(chrono(page)).toHaveText('04:00');
    await expect(totalChrono(page)).toHaveText('Total 2:00');
    expect(garde.bloquees).toEqual([]);
  });

  test('+1 min et −1 min changent le temps de l\'exercice en cours, et « Garder … pour les prochaines fois » l\'inscrit dans la session', async ({ page, ouvrirAppli }) => {
    await demarrer(page, ouvrirAppli);
    await plusUneMin(page).click();
    await expect(chrono(page)).toHaveText('07:00');
    await plusUneMin(page).click();
    await expect(chrono(page)).toHaveText('08:00');
    await moinsUneMin(page).click();
    await expect(chrono(page)).toHaveText('07:00');
    await avancer(page, secondes(30));
    await expect(chrono(page)).toHaveText('06:30');
    await page.getByRole('button', { name: /^Garder 7 min pour les prochaines fois/ }).click();
    await expect.poll(async () => (await sessionsEnregistrees(page))[0].minutes).toEqual([7, 5, 4]);
  });

  test('Suivant et Précédent changent d\'exercice : le chrono repart de la durée prévue, le rang et le titre suivent @critique', async ({ page, ouvrirAppli }) => {
    await demarrer(page, ouvrirAppli);
    await expect(precedent(page)).toBeDisabled();
    await avancer(page, secondes(20));
    await suivant(page).click();
    await expect(rangExercice(page)).toHaveText(/Exercice 2 \/ 3/i);
    await expect(titreExercice(page)).toHaveText('Bravo');
    await expect(chrono(page)).toHaveText('05:00');
    await expect(precedent(page)).toBeEnabled();
    await expect(totalChrono(page)).toHaveText('Total 0:20');   // le total continue de courir d'un exercice à l'autre
    await suivant(page).click();
    await expect(titreExercice(page)).toHaveText('Charlie');
    await expect(chrono(page)).toHaveText('04:00');
    await precedent(page).click();
    await expect(titreExercice(page)).toHaveText('Bravo');
    await precedent(page).click();
    await expect(titreExercice(page)).toHaveText('Alpha');
    await expect(precedent(page)).toBeDisabled();
  });

  test('sans enchaînement automatique, le temps dépassé s\'affiche en « + » et l\'exercice reste affiché', async ({ page, ouvrirAppli }) => {
    await demarrer(page, ouvrirAppli);
    await expect(enchainement(page)).toHaveAttribute('aria-pressed', 'false');
    await avancer(page, minutes(6) + secondes(5));
    await expect(chrono(page)).toHaveText('+00:05');
    await expect(titreExercice(page)).toHaveText('Alpha');
    await avancer(page, secondes(55));
    await expect(chrono(page)).toHaveText('+01:00');
    await expect(titreExercice(page)).toHaveText('Alpha');
  });

  test('l\'enchaînement automatique passe seul à l\'exercice suivant à la fin du temps, l\'état du bouton est gardé @critique', async ({ page, ouvrirAppli }) => {
    await demarrer(page, ouvrirAppli);
    await enchainement(page).click();
    await expect(enchainement(page)).toHaveAttribute('aria-pressed', 'true');
    await avancer(page, minutes(5) + secondes(55));
    await expect(titreExercice(page)).toHaveText('Alpha');
    await avancer(page, secondes(10));
    await expect(titreExercice(page)).toHaveText('Bravo');
    await expect(rangExercice(page)).toHaveText(/Exercice 2 \/ 3/i);
    expect(await secondesChrono(page)).toBeGreaterThan(4 * 60 + 50);
    await avancer(page, minutes(5) + secondes(5));
    await expect(titreExercice(page)).toHaveText('Charlie');
    // Le réglage est mémorisé pour les prochaines sessions.
    await expect.poll(() => page.evaluate(() => localStorage.getItem('trainhub.gsAuto.v1'))).toBe('1');
  });

  test('la cloche (alerte avant la fin) s\'allume et s\'éteint ; son état se lit sur le bouton', async ({ page, ouvrirAppli }) => {
    await demarrer(page, ouvrirAppli);
    await expect(cloche(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(cloche(page)).toHaveAccessibleName(/désactivée/);
    await cloche(page).click();
    await expect(cloche(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(cloche(page)).not.toHaveAccessibleName(/désactivée/);
    await cloche(page).click();
    await expect(cloche(page)).toHaveAttribute('aria-pressed', 'false');
  });

  test('la barre d\'avancement suit le temps prévu de toute la session', async ({ page, ouvrirAppli }) => {
    await demarrer(page, ouvrirAppli);   // 6 + 5 + 4 = 15 min
    await expect(barre(page)).toHaveAttribute('aria-valuenow', '0');
    await avancer(page, minutes(3));
    await expect(barre(page)).toHaveAttribute('aria-valuenow', '20');
    await expect(barre(page)).toHaveAttribute('title', /20 % de la durée prévue : 3:00 sur 15:00 \(exercice 1 sur 3\)/);
    await suivant(page).click();
    await avancer(page, minutes(1));
    await expect(barre(page)).toHaveAttribute('title', /exercice 2 sur 3/);
    expect(Number(await barre(page).getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(26);
  });

  test('la liste des exercices : un clic va à l\'exercice, l\'exercice en cours est marqué ▶ @ordinateur', async ({ page, ouvrirAppli }) => {
    await demarrer(page, ouvrirAppli);
    await expect(elementsDeroule(page)).toHaveCount(3);
    await expect(elementsDeroule(page).first()).toHaveAttribute('aria-current', 'step');
    await expect(elementsDeroule(page).first()).toContainText('Alpha');
    await expect(elementsDeroule(page).nth(2)).toContainText('4 min');
    await elementsDeroule(page).nth(2).click();
    await expect(titreExercice(page)).toHaveText('Charlie');
    await expect(elementsDeroule(page).nth(2)).toHaveAttribute('aria-current', 'step');
    await expect(chrono(page)).toHaveText('04:00');
  });

  test('plein écran d\'ordinateur : le guidage est à gauche et la liste des exercices à droite, côte à côte @ordinateur', async ({ page, ouvrirAppli }) => {
    await demarrer(page, ouvrirAppli);
    await expect(listeDeroule(page)).toBeVisible();
    const g = (await colonneGauche(page).boundingBox())!, d = (await colonneDroite(page).boundingBox())!;
    expect(d.x).toBeGreaterThanOrEqual(g.x + g.width - 1);            // à droite, pas dessous
    expect(Math.abs(d.y - g.y)).toBeLessThan(40);                      // en haut, alignées
  });

  test('au téléphone la liste des exercices est masquée faute de place, le guidage reste complet @mobile', async ({ page, ouvrirAppli }) => {
    await demarrer(page, ouvrirAppli);
    await expect(listeDeroule(page)).toBeHidden();
    await expect(titreExercice(page)).toHaveText('Alpha');
    for (const b of [pause(page), suivant(page), arreter(page), moinsUneMin(page), plusUneMin(page)]) await expect(b).toBeVisible();
    const largeur = page.viewportSize()!.width;
    const m = (await colonneGauche(page).boundingBox())!;
    expect(m.x + m.width).toBeLessThanOrEqual(largeur + 1);            // rien ne déborde à droite
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    expect(await texteChrono(page)).toBe('06:00');
  });
});
