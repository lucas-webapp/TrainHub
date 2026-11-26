// MODULE « metronome » — « TESTER LE SON » ET LE JOURNAL DU SON (Paramètres › Métronome › Dépannage). Observé en boîte noire (playwright-cli, 25/11/2026) : « Tester le son » joue deux bips (Web Audio puis
// lecteur audio) et affiche « Deux bips : … » ; « Journal du son » copie le journal dans le presse-papiers, ou, si la copie est impossible, ouvre une boîte « Journal du son » avec les dernières lignes ;
// les lignes se lisent « 11-25 23:14:26.874 visible+focus arrêt ctx:— bouée:— | test du son ». On vérifie l'ÉTAT visible (messages, lignes du journal), jamais le son lui-même (pas de mesure du signal dans la VM).
// Le presse-papiers réel varie selon les navigateurs : on le remplace par un faux (`navigator.clipboard.writeText`) qui réussit ou refuse, pour jouer les deux cas partout.
import type { Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { alArret, attendreImmobile, enLecture, jouer, ouvrir, ouvrirMetro } from './aide-metronome';

const ouvrirDepannage = async (page: Page) => {
  await page.getByRole('button', { name: 'Paramètres' }).click();
  await page.getByRole('tab', { name: 'Métronome' }).click();
  // La fenêtre se met en place (ajustement de taille) un instant après l'ouverture : un clic pendant ce mouvement peut tomber à côté (sur WebKit mobile il refermait Paramètres une fois sur quelques-unes).
  await attendreImmobile(page.getByRole('tabpanel').filter({ hasText: 'Dépannage' }));
};
const boutonTester = (page: Page) => page.getByRole('button', { name: /^Tester le son/ });
const boutonJournal = (page: Page) => page.getByRole('button', { name: /^Journal du son/ });
const boiteJournal = (page: Page) => page.getByRole('dialog', { name: 'Journal du son' });
// Les interrupteurs n'ont pas de nom accessible (il manque un `aria-label`) : on les retrouve par le libellé de leur ligne (le plus proche ancêtre du libellé qui contient un interrupteur).
const interrupteur = (page: Page, nom: RegExp) => page.getByText(nom.source.includes('Bouée') ? 'Bouée audio (essai)' : 'Son de secours', { exact: true }).locator('xpath=ancestor::*[.//*[@role="switch"]][1]').getByRole('switch');
const message = (page: Page, texte: string | RegExp) => page.locator('.toast').filter({ hasText: texte });
/** Presse-papiers truqué : `copie` réussit (le texte copié est gardé dans `window.__copie`) ou refuse. */
const fauxPressePapiers = (page: Page, copie: boolean) => page.addInitScript((ok) => {
  const faux = { writeText: (t: string) => { (window as any).__copie = t; return ok ? Promise.resolve() : Promise.reject(new Error('refusé')); } };
  Object.defineProperty(navigator, 'clipboard', { value: faux, configurable: true });
  const ancien = document.execCommand?.bind(document);
  if (!ok && ancien) document.execCommand = (c: string, ...r: any[]) => (c === 'copy' ? false : (ancien as any)(c, ...r));
}, copie);

test.describe('Métronome : tester le son et journal du son @metronome', () => {
  test('« Tester le son » explique les deux bips et écrit « test du son » au journal @critique', async ({ page, ouvrirAppli }) => {
    await fauxPressePapiers(page, false);
    await ouvrirMetro(ouvrirAppli);
    await ouvrirDepannage(page);
    await expect(boutonTester(page)).toContainText('Un bip par Web Audio, puis un par le lecteur audio');
    await boutonTester(page).click();
    await expect(message(page, /Deux bips : le 1er par Web Audio \(comme le métronome\), le 2e par le lecteur audio/)).toBeVisible();
    await boutonJournal(page).click();
    await expect(boiteJournal(page)).toBeVisible();
    await expect(boiteJournal(page).getByRole('listitem').filter({ hasText: 'test du son' })).toHaveCount(1);
    await boiteJournal(page).getByRole('button', { name: 'OK' }).click();
    await expect(boiteJournal(page)).toBeHidden();
  });

  test('« Journal du son » quand la copie est impossible : une boîte montre les dernières lignes, datées et avec l\'état du son @critique', async ({ page, ouvrirAppli }) => {
    await fauxPressePapiers(page, false);
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await jouer(page).click();
    await enLecture(page);
    await jouer(page).click();
    await alArret(page);
    await metroFermer(page);
    await ouvrirDepannage(page);
    await boutonJournal(page).click();
    await expect(boiteJournal(page)).toBeVisible();
    await expect(boiteJournal(page)).toContainText('Copie impossible depuis ici. Dernières lignes :');
    const lignes = boiteJournal(page).getByRole('listitem');
    await expect(lignes.filter({ hasText: /métronome lancé/ })).not.toHaveCount(0);
    await expect(lignes.filter({ hasText: /métronome arrêté/ })).not.toHaveCount(0);
    // Chaque ligne : date « MM-JJ hh:mm:ss.mmm », état de la page, état du son.
    for (const t of await lignes.allInnerTexts()) expect(t).toMatch(/^\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} \S+ (JOUE|arrêt) .* \| /);
  });

  test('« Journal du son » quand la copie réussit : le journal entier est dans le presse-papiers', async ({ page, ouvrirAppli }) => {
    await fauxPressePapiers(page, true);
    await ouvrirMetro(ouvrirAppli);
    await ouvrirDepannage(page);
    await boutonTester(page).click();
    await expect(message(page, /Deux bips/)).toBeVisible();
    await boutonJournal(page).click();
    await expect.poll(() => page.evaluate(() => (window as any).__copie || '')).toContain('test du son');
    expect(await page.evaluate(() => (window as any).__copie)).toMatch(/\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} /);
    await expect(boiteJournal(page)).toBeHidden();
  });

  test('le journal garde la trace d\'une lecture : « métronome lancé » puis « métronome arrêté »', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await jouer(page).click();
    await enLecture(page);
    await jouer(page).click();
    await alArret(page);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('trainhub.audioLog.v1') || ''), { message: 'journal du son enregistré' }).toMatch(/métronome lancé/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('trainhub.audioLog.v1') || '')).toMatch(/métronome arrêté/);
  });

  test('« Son de secours » et « Bouée audio » : deux interrupteurs éteints par défaut, qui s\'allument et s\'éteignent chacun de leur côté', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrirDepannage(page);
    const secours = interrupteur(page, /^Son de secours/), bouee = interrupteur(page, /^Bouée audio/);
    await expect(secours).not.toBeChecked();
    await expect(bouee).not.toBeChecked();
    await secours.click();
    await expect(secours).toBeChecked();
    await expect(bouee).not.toBeChecked();
    await secours.click();
    await expect(secours).not.toBeChecked();
    await bouee.click();
    await expect(bouee).toBeChecked();
    await expect(secours).not.toBeChecked();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('trainhub.audioLog.v1') || '')).toMatch(/son de secours activé/);
  });

  test('« Son de secours » allumé : l\'interrupteur garde son état après un rechargement', async ({ page, ouvrirAppli, browserName }) => {
    // ME-03 (intermittent, avis : WebKit sous Linux plutôt que l\'appli) : dans la série complète, le rechargement de la page ne rend parfois pas la main pendant 45 s sur WebKit (webkit, mobile-iphone : 4 passages complets sur 6) ;
    // 24 rechargements d\'affilée dans la même situation, hors série, n\'ont jamais bloqué. La vérification reste exigée sur Chromium, Edge, Firefox et Android.
    test.fixme(browserName === 'webkit' && !process.env.CI, 'ME-03 : rechargement WebKit qui ne rend pas la main dans la série complète (intermittent)');
    await ouvrirMetro(ouvrirAppli);
    await ouvrirDepannage(page);
    await interrupteur(page, /^Son de secours/).click();
    await expect(interrupteur(page, /^Son de secours/)).toBeChecked();
    await page.reload();
    await expect(page.locator('#folder-container')).toBeAttached();
    await ouvrirDepannage(page);
    await expect(interrupteur(page, /^Son de secours/)).toBeChecked();
    await expect(interrupteur(page, /^Bouée audio/)).not.toBeChecked();
  });

  test('avec le « Son de secours » allumé, le métronome se lance et s\'arrête comme d\'habitude', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrirDepannage(page);
    await interrupteur(page, /^Son de secours/).click();
    await page.getByRole('button', { name: 'Fermer', exact: true }).click();
    await ouvrir(page);
    await jouer(page).click();
    await enLecture(page);
    await expect(page.locator('.metronome-panel .metro-chrono-value')).not.toHaveText('00:00', { timeout: 5_000 });
    await jouer(page).click();
    await alArret(page);
  });
});

async function metroFermer(page: Page) {
  await page.locator('.metronome-panel').getByRole('button', { name: 'Fermer', exact: true }).click();
  await expect(page.locator('.metronome-panel')).toBeHidden();
}
