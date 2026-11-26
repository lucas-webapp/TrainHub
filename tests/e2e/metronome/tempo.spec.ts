// MODULE « metronome » — LE TEMPO. Observé en boîte noire (playwright-cli, 25/11/2026) : de 30 à 300 BPM, 100 au départ ; − / + font ±1 ; − 10 / + 10 font ±10 (le pas des gros boutons se règle
// dans Paramètres › Métronome : ±2, ±5, ±10) ; un clic sur le chiffre du cadran ouvre la saisie au clavier (Entrée ou sortie du champ = valider, Échap = annuler, hors limites = ramené à 30 / 300) ;
// la molette sur le cadran fait ±1 ; TAP règle le tempo sur l'écart entre les appuis. Le tempo est enregistré dans `settings.metronome.bpm`.
import { test, expect } from '../support/fixtures';
import { appuyer, attendreEtat, etatEnregistre, ouvrirEtEpingler, boutonTap, champTempo, ouvrir, ouvrirMetro, moins1, moins10, plus1, plus10, saisirTempo, tempoAffiche, valeurTempo, metro, ouvrirAvecHorloge, etatMetro } from './aide-metronome';

test.describe('Métronome : tempo @metronome', () => {
  test('− / + (±1) et − 10 / + 10 (±10) règlent le tempo, et il est enregistré @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await expect(valeurTempo(page)).toHaveText('100');
    await appuyer(plus1(page));
    await appuyer(plus1(page));
    await expect(valeurTempo(page)).toHaveText('102');
    await appuyer(moins1(page));
    await expect(valeurTempo(page)).toHaveText('101');
    await appuyer(plus10(page));
    await expect(valeurTempo(page)).toHaveText('111');
    await appuyer(moins10(page));
    await appuyer(moins10(page));
    await expect(valeurTempo(page)).toHaveText('91');
    await attendreEtat(page, (m) => m.bpm, 91, 'tempo 91 enregistré');
  });

  test('saisie au clavier : clic sur le chiffre, valeur, Entrée @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await valeurTempo(page).click();
    await expect(champTempo(page)).toBeFocused();
    await expect(champTempo(page)).toHaveValue('100');
    await champTempo(page).fill('123');
    await champTempo(page).press('Enter');
    await expect(valeurTempo(page)).toHaveText('123');
    await attendreEtat(page, (m) => m.bpm, 123);
  });

  test('saisie : sortir du champ valide la valeur', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await valeurTempo(page).click();
    await champTempo(page).fill('88');
    await champTempo(page).blur();
    await expect(valeurTempo(page)).toHaveText('88');
    await attendreEtat(page, (m) => m.bpm, 88);
  });

  test('saisie dans le volet épinglé : Échap abandonne la valeur tapée, le tempo d\'avant est gardé', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrirEtEpingler(page);
    await saisirTempo(page, 88);
    await valeurTempo(page).click();
    await champTempo(page).fill('77');
    await champTempo(page).press('Escape');
    await expect(valeurTempo(page)).toHaveText('88');
    await attendreEtat(page, (m) => m.bpm, 88);
  });

  test('saisie dans la fenêtre flottante : Échap abandonne la valeur tapée (la fenêtre se ferme, le tempo d\'avant est gardé)', async ({ page, ouvrirAppli }, info) => {
    // Le défaut n'apparaît que sur les moteurs Chromium de bureau (chromium, edge), et SEULEMENT environ 6 fois sur 10 (mesuré : 12 réussites inattendues sur 20) : `test.fail` y serait lui-même instable, d'où un `fixme` ciblé.
    // Sur Firefox, WebKit et les appareils mobiles la même vérification passe : elle reste EXIGÉE partout ailleurs.
    test.fixme(['chromium', 'edge'].includes(info.project.name), 'ME-02 (intermittent, ≈ 60 %) : dans la fenêtre flottante, Échap pendant la saisie du tempo ferme la fenêtre ET valide la valeur tapée (77 au lieu de 88) ; dans le volet épinglé Échap abandonne bien la saisie');
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await saisirTempo(page, 88);
    await attendreEtat(page, (m) => m.bpm, 88);
    await valeurTempo(page).click();
    await champTempo(page).fill('77');
    await champTempo(page).press('Escape');
    // Attendu : 88 (saisie abandonnée) ; observé : 77 enregistré.
    await expect(metro(page)).toBeHidden();
    await expect.poll(async () => (await etatEnregistre(page)).bpm, { message: 'tempo enregistré après Échap' }).toBe(88);
  });

  test('bornes : une saisie hors limites est ramenée à 30 ou 300', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await saisirTempo(page, 500);
    await expect(valeurTempo(page)).toHaveText('300');
    await attendreEtat(page, (m) => m.bpm, 300);
    await saisirTempo(page, 10);
    await expect(valeurTempo(page)).toHaveText('30');
    await attendreEtat(page, (m) => m.bpm, 30);
  });

  test('bornes : + et + 10 s\'arrêtent à 300, − et − 10 à 30', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await saisirTempo(page, 295);
    await appuyer(plus10(page));
    await expect(valeurTempo(page)).toHaveText('300');
    await appuyer(plus10(page));
    await appuyer(plus1(page));
    await expect(valeurTempo(page)).toHaveText('300');
    await saisirTempo(page, 35);
    await appuyer(moins10(page));
    await expect(valeurTempo(page)).toHaveText('30');
    await appuyer(moins10(page));
    await appuyer(moins1(page));
    await expect(valeurTempo(page)).toHaveText('30');
    await attendreEtat(page, (m) => m.bpm, 30);
  });

  test('la molette sur le cadran règle le tempo de ±1 (vers le haut : plus vite)', async ({ page, ouvrirAppli, browserName, isMobile }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    const cadran = metro(page).locator('.metro-dial');
    // Limite d'environnement PROUVÉE : Playwright refuse `mouse.wheel` en WebKit mobile (« Mouse wheel is not supported in mobile WebKit ») ; on y envoie le même événement `wheel` au cadran, la vérification est identique.
    const molette = async (dy: number) => {
      if (browserName === 'webkit' && isMobile) await cadran.dispatchEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true });
      else { await cadran.hover(); await page.mouse.wheel(0, dy); }
    };
    await molette(-100);
    await expect(valeurTempo(page)).toHaveText('101');
    await molette(100);
    await molette(100);
    await expect(valeurTempo(page)).toHaveText('99');
  });

  test('TAP : des appuis espacés de 500 ms (horloge simulée) règlent le tempo sur 120 BPM', async ({ page, ouvrirAppli }) => {
    await ouvrirAvecHorloge(page, ouvrirAppli, { etat: etatMetro(['Gamme']) });
    await ouvrir(page, true);
    await expect(valeurTempo(page)).toHaveText('100');
    for (let i = 0; i < 5; i++) {
      await boutonTap(page).click();
      await page.clock.runFor(500);
    }
    await expect.poll(() => tempoAffiche(page)).toBe(120);
    await attendreEtat(page, (m) => m.bpm, 120);
  });

  test('TAP : le rythme change avec l\'écart (400 ms = 150 BPM) et un long silence recommence le comptage', async ({ page, ouvrirAppli }) => {
    await ouvrirAvecHorloge(page, ouvrirAppli, { etat: etatMetro(['Gamme']) });
    await ouvrir(page, true);
    for (let i = 0; i < 5; i++) {
      await boutonTap(page).click();
      await page.clock.runFor(400);
    }
    await expect.poll(() => tempoAffiche(page)).toBe(150);
    await page.clock.runFor(10_000);   // longue pause : les anciens appuis ne comptent plus
    for (let i = 0; i < 4; i++) {
      await boutonTap(page).click();
      await page.clock.runFor(1_000);
    }
    await expect.poll(() => tempoAffiche(page)).toBe(60);
  });

  test('un seul appui sur TAP ne change pas le tempo', async ({ page, ouvrirAppli }) => {
    await ouvrirAvecHorloge(page, ouvrirAppli, { etat: etatMetro(['Gamme']) });
    await ouvrir(page, true);
    await boutonTap(page).click();
    await page.clock.runFor(1_000);
    await expect(valeurTempo(page)).toHaveText('100');
  });

  test('le tempo choisi survit à un rechargement de la page', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await saisirTempo(page, 167);
    await attendreEtat(page, (m) => m.bpm, 167);
    await page.reload();
    await expect(page.locator('#folder-container')).toBeAttached();
    await ouvrir(page);
    await expect(valeurTempo(page)).toHaveText('167');
  });

  test('Paramètres › Pas des gros boutons : ±5 change l\'effet de − 10 / + 10', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await page.getByRole('button', { name: 'Paramètres' }).click();
    await page.getByRole('tab', { name: 'Métronome' }).click();
    await page.getByRole('radio', { name: '±5' }).check();
    await page.getByRole('button', { name: 'Fermer', exact: true }).click();
    await ouvrir(page);
    await appuyer(plus10(page));
    await expect(valeurTempo(page)).toHaveText('105');
    await appuyer(moins10(page));
    await appuyer(moins10(page));
    await expect(valeurTempo(page)).toHaveText('95');
    await appuyer(plus1(page));
    await expect(valeurTempo(page), 'les petits boutons font toujours ±1').toHaveText('96');
  });
});
