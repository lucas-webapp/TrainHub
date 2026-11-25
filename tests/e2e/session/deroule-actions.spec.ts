// MODULE « session » (lot 2) — ACTIONS PENDANT LE DÉROULÉ : ajouter un exercice à la session en cours, menu clic droit de la liste, réordonner par glisser, notes et liens de l'exercice,
// dé, fenêtre flottante. Observé en boîte noire (playwright-cli, 25/11/2026) : « ＋ Ajouter un exercice » (sous la liste de droite) ouvre le panneau « Ajouter à la session » ; l'exercice choisi
// s'insère juste APRÈS l'exercice en cours (5 min), le panneau se ferme, et la session enregistrée suit. Le clic droit d'une ligne propose « Passer à cet exercice », « Changer la durée (N min)… »,
// « Ajouter un exercice après celui-ci… », « Retirer de la session ». Le bouton « Fenêtre flottante de session » ouvre une petite fenêtre (popup) : titre de l'exercice, chrono, −1 min / Pause / +1 min, métronome.
// Le chrono est piloté par le test seulement quand une valeur exacte est vérifiée ; ailleurs le temps coule normalement.
import { test, expect } from '../support/fixtures';
import { glisser } from '../bibliotheque/aide-bibliotheque';
import { exerciceEnregistre } from '../bibliotheque/aide-bibliotheque';
import {
  actionListe, ajouterListe, chrono, elementsDeroule, etatSession, lancerDepuisListe, minutesListe, ouvrirSessions, rangeeListe, reprendre, sessionsEnregistrees, titreExercice, titresListe,
} from './aide-session';

const EXOS = ['Alpha', 'Bravo', 'Charlie', 'Delta'];
const grille = (exos: any[] = EXOS) => etatSession(exos, [{ nom: 'Grille', exercices: [['Alpha', 6], ['Bravo', 5], ['Charlie', 4]] }]);
async function demarrer(page: any, ouvrirAppli: any, exos: any[] = EXOS) {
  await ouvrirAppli({ etat: grille(exos), accueil: 'jamais' });
  await ouvrirSessions(page);
  await lancerDepuisListe(page, 'Grille');
}

test.describe('Session : actions pendant le déroulé @session', () => {
  test('« ＋ Ajouter un exercice » insère l\'exercice juste après celui en cours, et la session enregistrée le garde @critique @ordinateur', async ({ page, ouvrirAppli }) => {
    await demarrer(page, ouvrirAppli);
    await ajouterListe(page).click();
    const panneau = page.locator('.backups-panel').filter({ hasText: 'Ajouter à la session' });
    await expect(panneau).toBeVisible();
    await page.getByRole('button', { name: 'Tout déplier' }).click();
    await page.getByRole('button', { name: 'Delta', exact: true }).click();
    await expect(panneau).toBeHidden();
    await expect.poll(() => titresListe(page)).toEqual(['Alpha', 'Delta', 'Bravo', 'Charlie']);
    await expect.poll(() => minutesListe(page)).toEqual(['6 min', '5 min', '5 min', '4 min']);
    await expect.poll(async () => (await sessionsEnregistrees(page))[0].exercices).toEqual(['Alpha', 'Delta', 'Bravo', 'Charlie']);
    await expect(titreExercice(page)).toHaveText('Alpha');   // l'exercice en cours ne change pas
  });

  test('clic droit sur un exercice de la liste : « Passer à cet exercice », « Changer la durée… », « Retirer de la session » @ordinateur', async ({ page, ouvrirAppli }) => {
    await demarrer(page, ouvrirAppli);
    await actionListe(page, 'Charlie', 'Passer à cet exercice');
    await expect(titreExercice(page)).toHaveText('Charlie');
    await expect(chrono(page)).toHaveText('04:00');

    await actionListe(page, 'Bravo', /^Changer la durée \(5 min\)/);
    const boite = page.locator('.app-dialog');
    await expect(boite).toContainText('Durée de l\'exercice');
    await boite.getByRole('textbox').fill('9');
    await boite.getByRole('button', { name: 'Valider' }).click();
    await expect.poll(() => minutesListe(page)).toEqual(['6 min', '9 min', '4 min']);
    await expect.poll(async () => (await sessionsEnregistrees(page))[0].minutes).toEqual([6, 9, 4]);

    await actionListe(page, 'Bravo', 'Retirer de la session');
    await expect.poll(() => titresListe(page)).toEqual(['Alpha', 'Charlie']);
    await expect(titreExercice(page)).toHaveText('Charlie');
    await expect.poll(async () => (await sessionsEnregistrees(page))[0].exercices).toEqual(['Alpha', 'Charlie']);
  });

  test('« Ajouter un exercice après celui-ci… » du menu insère l\'exercice choisi à cet endroit @ordinateur', async ({ page, ouvrirAppli }) => {
    await demarrer(page, ouvrirAppli);
    await actionListe(page, 'Bravo', 'Ajouter un exercice après celui-ci…');
    await page.getByRole('button', { name: 'Tout déplier' }).click();
    await page.getByRole('button', { name: 'Delta', exact: true }).click();
    await expect.poll(() => titresListe(page)).toEqual(['Alpha', 'Bravo', 'Delta', 'Charlie']);
    await expect.poll(async () => (await sessionsEnregistrees(page))[0].exercices).toEqual(['Alpha', 'Bravo', 'Delta', 'Charlie']);
  });

  test('glisser un exercice de la liste change l\'ordre, y compris dans la session enregistrée @ordinateur', async ({ page, ouvrirAppli }) => {
    await demarrer(page, ouvrirAppli);
    await glisser(page, rangeeListe(page, 'Charlie'), rangeeListe(page, 'Bravo'), 'haut');
    await expect.poll(() => titresListe(page)).toEqual(['Alpha', 'Charlie', 'Bravo']);
    await expect(titreExercice(page)).toHaveText('Alpha');
    await expect.poll(async () => (await sessionsEnregistrees(page))[0].exercices).toEqual(['Alpha', 'Charlie', 'Bravo']);
    await expect(elementsDeroule(page).first()).toHaveAttribute('aria-current', 'step');
  });

  test('sous le guidage : les liens de l\'exercice et sa note fixe ; « Notes et liens de l\'exercice » déplie la fiche et ce qu\'on y écrit est enregistré @critique', async ({ page, ouvrirAppli }) => {
    const exos = [{ titre: 'Alpha', extra: { fixedNotes: 'Penser au pouce', links: [{ id: 'l1', label: 'Mon site', url: 'https://exemple.fr/a' }] } }, 'Bravo', 'Charlie', 'Delta'];
    await demarrer(page, ouvrirAppli, exos);
    const lien = page.locator('.gs-run-resources').getByRole('link', { name: 'Mon site' });
    await expect(lien).toHaveAttribute('href', 'https://exemple.fr/a');
    await expect(lien).toHaveAttribute('target', '_blank');
    await expect(page.getByText('Penser au pouce').first()).toBeVisible();
    const bascule = page.getByRole('button', { name: /Notes et liens de l'exercice/ });
    await expect(bascule).toHaveAttribute('aria-expanded', 'false');
    await bascule.click();
    await expect(bascule).toHaveAttribute('aria-expanded', 'true');
    const note = page.locator('.gs-run-exdetails .notes-fixed-textarea');
    await expect(note).toHaveValue('Penser au pouce');
    await note.fill('Penser au pouce et au poignet');
    await note.blur();
    await expect.poll(async () => (await exerciceEnregistre(page, 'Alpha'))[0].exo.fixedNotes).toBe('Penser au pouce et au poignet');
    // Un exercice sans lien ni note n'affiche rien sous son titre.
    await page.getByRole('button', { name: 'Suivant →' }).click();
    await expect(titreExercice(page)).toHaveText('Bravo');
    await expect(page.locator('.gs-run-resources a')).toHaveCount(0);
  });

  test('le dé : « Ajouter un dé » l\'allume pour l\'exercice, un clic sur le dé tire un résultat, qui reste affiché', async ({ page, ouvrirAppli }) => {
    await demarrer(page, ouvrirAppli);
    await expect(page.locator('.gs-run-dice')).toHaveCount(0);
    await page.locator('.gs-run-dice-add').click();
    await expect(page.locator('.toast').filter({ hasText: 'Dé ajouté' })).toBeVisible();
    await expect(page.getByText(/À tirer au sort/)).toBeVisible();
    await expect(page.locator('.gs-run-dice-add')).toHaveCount(0);
    await page.locator('.gs-run-dice').click();
    await expect(page.getByRole('button', { name: 'Voir sur le manche' })).toBeVisible();
    await expect(page.getByText(/À tirer au sort/)).toBeHidden();
    await expect.poll(async () => (await exerciceEnregistre(page, 'Alpha'))[0].exo.dice?.cfg?.v).toBe(2);
    // Le dé est propre à l'exercice : Bravo n'en a pas.
    await page.getByRole('button', { name: 'Suivant →' }).click();
    await expect(titreExercice(page)).toHaveText('Bravo');
    await expect(page.locator('.gs-run-dice')).toHaveCount(0);
  });

  test('la fenêtre flottante montre l\'exercice et le chrono, et la pause s\'y commande', async ({ page, ouvrirAppli }) => {
    await demarrer(page, ouvrirAppli);
    const ouverture = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Fenêtre flottante de session' }).click();
    const flottante = await ouverture;
    await flottante.waitForLoadState('domcontentloaded');
    await expect(flottante.locator('#t')).toHaveText('Alpha');
    await expect(flottante.locator('#tm')).toHaveText(/^\d\d:\d\d$/);
    // Le mode dépend du navigateur : « reste au-dessus » (Chrome, Edge, Firefox sur ordinateur) ou « fenêtre simple » (WebKit, téléphone), chacun avec son explication.
    const mode = flottante.locator('.mode');
    await expect(mode).toBeVisible();
    expect((await mode.evaluate((e) => `${e.textContent}|${(e as HTMLElement).title}`))).toMatch(/^📌 reste au-dessus\|Cette fenêtre reste au-dessus|^fenêtre simple\|Ce navigateur n'offre pas/);
    await flottante.getByRole('button', { name: 'Pause' }).click();
    await expect(reprendre(page)).toBeVisible();
    // On referme la fenêtre : laissée ouverte, elle fait échouer la fermeture du contexte sous Firefox.
    await flottante.getByRole('button', { name: 'Masquer' }).evaluate((b) => { setTimeout(() => (b as HTMLElement).click(), 0); });
    await expect.poll(() => flottante.isClosed()).toBe(true);
  });

  test('« Masquer » ferme la fenêtre flottante, la session continue @ordinateur', async ({ page, ouvrirAppli }) => {
    await demarrer(page, ouvrirAppli);
    const ouverture = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Fenêtre flottante de session' }).click();
    const flottante = await ouverture;
    await flottante.waitForLoadState('domcontentloaded');
    const bouton = flottante.getByRole('button', { name: 'Masquer' });
    await expect(bouton).toBeVisible();
    // Le clic ferme la fenêtre : on le déclenche dans la page (au prochain tour) pour que Playwright n'attende pas un résultat d'une page qui disparaît.
    await bouton.evaluate((b) => { setTimeout(() => (b as HTMLElement).click(), 0); });
    await expect.poll(() => flottante.isClosed()).toBe(true);
    await expect(titreExercice(page)).toHaveText('Alpha');
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  });
});
