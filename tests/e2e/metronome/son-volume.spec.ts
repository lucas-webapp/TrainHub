// MODULE « metronome » — SON ET VOLUME. Le SON lui-même n'est pas mesuré (voir lecture.spec.ts) : on vérifie les réglages visibles et enregistrés. Observé en boîte noire (playwright-cli, 25/11/2026) :
// curseur « Volume » de 0 à 100 (défaut 80, enregistré en `settings.metronome.volume`, 0 à 1) ; le bouton haut-parleur coupe / rétablit (aria-pressed ; coupé = volume 0, rétabli = volume d'avant) ;
// Paramètres › Métronome › « Son du clic » : Clic classique, Bois, Clave, Marimba, Goutte (`settings.metronome.sound`) + « Écouter ce son ».
import { test, expect } from '../support/fixtures';
import { attendreEtat, curseurVolume, enLecture, jouer, muet, ouvrir, ouvrirMetro } from './aide-metronome';

const ouvrirReglagesMetro = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Paramètres' }).click();
  await page.getByRole('tab', { name: 'Métronome' }).click();
};

test.describe('Métronome : son et volume @metronome', () => {
  test('@ordinateur le curseur de volume (80 au départ) règle le volume et il est enregistré @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await expect(curseurVolume(page)).toHaveValue('80');
    await curseurVolume(page).fill('40');
    await attendreEtat(page, (m) => m.volume, 0.4);
    await curseurVolume(page).fill('100');
    await attendreEtat(page, (m) => m.volume, 1);
    await curseurVolume(page).fill('0');
    await attendreEtat(page, (m) => m.volume, 0);
  });

  test('@ordinateur le haut-parleur coupe le son (volume 0) et le rétablit au volume d\'avant', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await curseurVolume(page).fill('60');
    await attendreEtat(page, (m) => m.volume, 0.6);
    await expect(muet(page)).toHaveAttribute('aria-pressed', 'false');
    await muet(page).click();
    await expect(muet(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(curseurVolume(page)).toHaveValue('0');
    await attendreEtat(page, (m) => m.volume, 0);
    await muet(page).click();
    await expect(muet(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(curseurVolume(page)).toHaveValue('60');
    await attendreEtat(page, (m) => m.volume, 0.6);
  });

  test('@ordinateur le volume choisi survit à un rechargement, et on règle le volume pendant la lecture sans l\'arrêter', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await jouer(page).click();
    await enLecture(page);
    await curseurVolume(page).fill('35');
    await enLecture(page);
    await attendreEtat(page, (m) => m.volume, 0.35);
    await page.reload();
    await expect(page.locator('#folder-container')).toBeAttached();
    await ouvrir(page);
    await expect(curseurVolume(page)).toHaveValue('35');
  });

  test('Paramètres › « Son du clic » : cinq sons, le choix est enregistré, affiché et gardé après rechargement', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrirReglagesMetro(page);
    const choix = page.getByRole('tabpanel').getByRole('combobox').nth(1);   // le 1er est « Position » de la fenêtre
    await expect(choix.locator('option')).toHaveText(['Clic classique', 'Bois', 'Clave', 'Marimba', 'Goutte']);
    await expect(choix).toHaveValue('click');
    await choix.selectOption({ label: 'Marimba' });
    const valeur = await choix.inputValue();
    expect(valeur).not.toBe('click');
    await attendreEtat(page, (m) => m.sound, valeur, 'son enregistré');
    await page.reload();
    await expect(page.locator('#folder-container')).toBeAttached();
    await ouvrirReglagesMetro(page);
    await expect(choix).toHaveValue(valeur);
    await expect(choix.locator('option:checked')).toHaveText('Marimba');
  });

  test('« Écouter ce son » joue un aperçu sans erreur et laisse le choix en place', async ({ page, ouvrirAppli }) => {
    const erreurs: string[] = [];
    page.on('pageerror', (e) => erreurs.push(e.message));
    await ouvrirMetro(ouvrirAppli);
    await ouvrirReglagesMetro(page);
    await page.getByRole('tabpanel').getByRole('combobox').nth(1).selectOption({ label: 'Clave' });
    await page.getByRole('button', { name: 'Écouter ce son' }).click();
    await expect(page.getByRole('tabpanel').getByRole('combobox').nth(1).locator('option:checked')).toHaveText('Clave');
    await expect(page.getByRole('button', { name: 'Écouter ce son' })).toBeEnabled();
    expect(erreurs).toEqual([]);
  });
});
