// MODULE « metronome » — LES PRÉRÉGLAGES = « Réglages enregistrés » du tempo progressif. Observé en boîte noire (playwright-cli, 25/11/2026) : l'escalier (« Tempo progressif ») ouvre la table Délai (s) /
// Seuil (BPM) ; le signet « Réglages de tempo progressif enregistrés » ouvre un menu : « + Enregistrer le réglage actuel » crée un préréglage nommé « Paliers N » (le champ du nom s'ouvre, Entrée valide),
// cliquer son nom l'applique (et ferme le menu), ✎ le renomme, ✕ le supprime. Enregistrés dans `settings.metronome.progPresets` ([{ id, name, progressive }]).
// Appliquer un préréglage change le tempo progressif, pas le tempo affiché. B-01 (bugs.md, « à confirmer ») : le banc `preset` voit, avec la sortie audio factice, un contexte audio de plus quand on applique
// un préréglage PENDANT la lecture ; ici on ne vérifie que l'observable : la lecture continue.
import type { Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { chronoAuMoins, attendreEtat, bascule, chrono, enLecture, etatEnregistre, jouer, metro, ouvrir, ouvrirMetro, ouvrirEtEpingler } from './aide-metronome';

const delai = (page: Page) => metro(page).locator('.metro-prog-stage input').first();
const boutonReglages = (page: Page) => metro(page).getByRole('button', { name: 'Réglages de tempo progressif enregistrés' });
const menu = (page: Page) => page.locator('.metro-presets-pop');
const lignes = (page: Page) => menu(page).locator('.metro-preset-row');
const nomsMenu = (page: Page) => menu(page).locator('.metro-preset-name');
const enregistrerActuel = (page: Page) => menu(page).getByRole('button', { name: '+ Enregistrer le réglage actuel' });
const champNom = (page: Page) => menu(page).getByRole('textbox', { name: 'Nom du réglage' });
const ligne = (page: Page, nom: string) => lignes(page).filter({ has: page.locator('.metro-preset-name', { hasText: new RegExp(`^${nom}$`) }) });

async function regler(page: Page, secondes: number) {
  await delai(page).fill(String(secondes));
  await delai(page).press('Tab');
  await expect.poll(async () => (await etatEnregistre(page)).progressive?.everySeconds).toBe(secondes);
}
/** Ouvre le métronome, allume le tempo progressif et enregistre un préréglage (nommé `nom`) avec ce délai. */
async function creer(page: Page, secondes: number, nom?: string) {
  await regler(page, secondes);
  await boutonReglages(page).click();
  await expect(menu(page)).toBeVisible();
  await enregistrerActuel(page).click();
  await expect(champNom(page)).toBeFocused();
  if (nom) await champNom(page).fill(nom);
  await champNom(page).press('Enter');
  await expect(champNom(page)).toBeHidden();
  await page.keyboard.press('Escape');   // referme le menu (le volet épinglé reste ouvert)
  await expect(menu(page)).toBeHidden();
}
async function ouvrirAvecProgressif(page: Page) {
  await ouvrirEtEpingler(page);
  await bascule(page).click();
  await expect(delai(page)).toBeVisible();
}

test.describe('Métronome : préréglages (réglages de tempo progressif enregistrés) @metronome', () => {
  test('« Tempo progressif » ouvre la table Délai / Seuil, un second clic la referme, et l\'état est enregistré', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrirEtEpingler(page);
    await expect(delai(page)).toBeHidden();
    await bascule(page).click();
    await expect(delai(page)).toBeVisible();
    await expect(delai(page)).toHaveValue('15');
    await attendreEtat(page, (m) => m.progressive?.enabled, true);
    await bascule(page).click();
    await expect(delai(page)).toBeHidden();
    await attendreEtat(page, (m) => m.progressive?.enabled, false);
  });

  test('créer un préréglage : « + Enregistrer le réglage actuel » le nomme « Paliers 1 », Entrée le valide, il est enregistré @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrirEtEpingler(page);
    await bascule(page).click();
    await regler(page, 20);
    await boutonReglages(page).click();
    await expect(menu(page)).toContainText('Aucun réglage enregistré');
    await enregistrerActuel(page).click();
    await expect(champNom(page)).toHaveValue('Paliers 1');
    await champNom(page).press('Enter');
    await expect(nomsMenu(page)).toHaveText(['Paliers 1']);
    await attendreEtat(page, (m) => (m.progPresets || []).map((p: any) => [p.name, p.progressive.everySeconds]), [['Paliers 1', 20]]);
  });

  test('appliquer un préréglage remet le réglage qu\'il contient et referme le menu @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrirAvecProgressif(page);
    await creer(page, 15, 'Lent');
    await regler(page, 40);
    await expect(delai(page)).toHaveValue('40');
    await boutonReglages(page).click();
    await ligne(page, 'Lent').getByTitle('Appliquer ce réglage').click();
    await expect(menu(page)).toBeHidden();
    await expect(delai(page)).toHaveValue('15');
    await expect.poll(async () => (await etatEnregistre(page)).progressive?.everySeconds).toBe(15);
  });

  test('deux préréglages s\'appliquent chacun à leur tour', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrirAvecProgressif(page);
    await creer(page, 10, 'Rapide');
    await creer(page, 45, 'Calme');
    await boutonReglages(page).click();
    await expect(nomsMenu(page)).toHaveText(['Rapide', 'Calme']);
    await expect(ligne(page, 'Rapide').locator('.metro-preset-sum')).toHaveText('10 s');
    await expect(ligne(page, 'Calme').locator('.metro-preset-sum')).toHaveText('45 s');
    await ligne(page, 'Rapide').getByTitle('Appliquer ce réglage').click();
    await expect(delai(page)).toHaveValue('10');
    await boutonReglages(page).click();
    await ligne(page, 'Calme').getByTitle('Appliquer ce réglage').click();
    await expect(delai(page)).toHaveValue('45');
  });

  test('renommer : ✎, nouveau nom, Entrée ; le préréglage garde son réglage', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrirAvecProgressif(page);
    await creer(page, 25);
    await boutonReglages(page).click();
    await expect(nomsMenu(page)).toHaveText(['Paliers 1']);
    await ligne(page, 'Paliers 1').getByTitle('Renommer', { exact: true }).click();
    await expect(champNom(page)).toBeVisible();
    await champNom(page).fill('Gamme du soir');
    await champNom(page).press('Enter');
    await expect(nomsMenu(page)).toHaveText(['Gamme du soir']);
    await expect(ligne(page, 'Gamme du soir').locator('.metro-preset-sum')).toHaveText('25 s');
    await attendreEtat(page, (m) => (m.progPresets || []).map((p: any) => [p.name, p.progressive.everySeconds]), [['Gamme du soir', 25]]);
  });

  test('supprimer : ✕ retire le préréglage (et seulement celui-là)', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrirAvecProgressif(page);
    await creer(page, 10, 'Un');
    await creer(page, 20, 'Deux');
    await boutonReglages(page).click();
    await expect(nomsMenu(page)).toHaveText(['Un', 'Deux']);
    await ligne(page, 'Un').getByTitle('Supprimer ce réglage').click();
    await expect(nomsMenu(page)).toHaveText(['Deux']);
    await attendreEtat(page, (m) => (m.progPresets || []).map((p: any) => p.name), ['Deux']);
    await ligne(page, 'Deux').getByTitle('Supprimer ce réglage').click();
    await expect(menu(page)).toContainText('Aucun réglage enregistré');
    await attendreEtat(page, (m) => (m.progPresets || []).length, 0);
  });

  test('les préréglages survivent à un rechargement', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrirAvecProgressif(page);
    await creer(page, 30, 'Durable');
    await page.reload();
    await expect(page.locator('#folder-container')).toBeAttached();
    await ouvrir(page);
    await boutonReglages(page).click();
    await expect(nomsMenu(page)).toHaveText(['Durable']);
  });

  test('appliquer un préréglage PENDANT la lecture : la lecture continue (le chrono n\'est pas remis à zéro) — cf. B-01 pour le contexte audio @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrirAvecProgressif(page);
    await creer(page, 15, 'Départ');
    await regler(page, 50);
    await jouer(page).click();
    await enLecture(page);
    await expect.poll(async () => Number((await chrono(page).innerText()).split(':')[1])).toBeGreaterThanOrEqual(2);
    await boutonReglages(page).click();
    await ligne(page, 'Départ').getByTitle('Appliquer ce réglage').click();
    await expect(delai(page)).toHaveValue('15');
    await enLecture(page);
    // Le chrono, lui, n'est pas remis à zéro par l'application du préréglage.
    await chronoAuMoins(page, 2);
    await jouer(page).click();
    await expect(jouer(page)).toHaveText(/Jouer/);
  });
});
