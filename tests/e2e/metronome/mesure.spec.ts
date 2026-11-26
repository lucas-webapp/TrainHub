// MODULE « metronome » — LA MESURE ET LES ACCENTS. Observé en boîte noire (playwright-cli, 25/11/2026) : les boutons 2/4, 3/4, 4/4, 5/4, 6/8 posent le nombre de temps (6/8 = six temps) et un temps fort sur le premier ;
// « None » = aucun temps accentué (une seule pastille normale… vue vide) ; « ⋯ » ouvre « Temps/mesure » (1 à 12) et « Subdivision » (Blanche, Noire, Croches, Triolet, Doubles-croches) ; une pastille par temps :
// un clic fait passer vide (0) → normal (1) → fort (2) → vide… ; tout est enregistré dans `settings.metronome` (`beatsPerMeasure`, `rhythmLabel`, `beatPattern`, `subdivision`).
import { test, expect } from '../support/fixtures';
import { accentsAffiches, attendreEtat, boutonAutres, champTemps, choixSubdivision, enLecture, formule, formuleAucune, jouer, metro, ouvrir, ouvrirMetro, pastille, pastilles, saisirTempo } from './aide-metronome';

const MESURES: Array<{ nom: '2/4' | '3/4' | '4/4' | '5/4' | '6/8'; temps: number }> = [
  { nom: '2/4', temps: 2 }, { nom: '3/4', temps: 3 }, { nom: '4/4', temps: 4 }, { nom: '5/4', temps: 5 }, { nom: '6/8', temps: 6 },
];

test.describe('Métronome : mesure et accents @metronome', () => {
  for (const { nom, temps } of MESURES) {
    test(`la formule ${nom} pose ${temps} temps, le premier accentué, et l'enregistre${nom === '3/4' ? ' @critique' : ''}`, async ({ page, ouvrirAppli }) => {
      await ouvrirMetro(ouvrirAppli);
      await ouvrir(page);
      // On part d'une autre mesure pour que le changement soit visible.
      await formule(page, nom === '2/4' ? '5/4' : '2/4').click();
      await formule(page, nom).click();
      await expect(pastilles(page)).toHaveCount(temps);
      expect(await accentsAffiches(page)).toEqual([2, ...Array(temps - 1).fill(1)]);
      await attendreEtat(page, (m) => [m.beatsPerMeasure, m.rhythmLabel, m.beatPattern], [temps, nom, [2, ...Array(temps - 1).fill(1)]]);
    });
  }

  test('« None » : aucun temps accentué (plus de pavé d\'accents) ; une formule le rétablit', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await formuleAucune(page).click();
    await expect(pastilles(page)).toHaveCount(0);
    await attendreEtat(page, (m) => m.rhythmLabel, 'None');
    await formule(page, '3/4').click();
    await expect(pastilles(page)).toHaveCount(3);
  });

  test('un clic sur une pastille fait passer le temps de normal à fort, puis à vide, puis à normal @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    expect(await accentsAffiches(page)).toEqual([2, 1, 1, 1]);
    await pastille(page, 2).click();
    expect(await accentsAffiches(page)).toEqual([2, 2, 1, 1]);
    await attendreEtat(page, (m) => m.beatPattern, [2, 2, 1, 1]);
    await pastille(page, 2).click();
    expect(await accentsAffiches(page)).toEqual([2, 0, 1, 1]);
    await attendreEtat(page, (m) => m.beatPattern, [2, 0, 1, 1]);
    await pastille(page, 2).click();
    expect(await accentsAffiches(page)).toEqual([2, 1, 1, 1]);
    await pastille(page, 1).click();
    await pastille(page, 1).click();
    expect(await accentsAffiches(page)).toEqual([1, 1, 1, 1]);   // fort → vide → normal : le premier temps n'est plus accentué
    await attendreEtat(page, (m) => m.beatPattern, [1, 1, 1, 1]);
  });

  test('glisser sur plusieurs pastilles les règle toutes d\'un coup', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    const a = (await pastille(page, 2).boundingBox())!, b = (await pastille(page, 4).boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
    // Chaque pastille survolée a été réglée (1 → 2) : les temps 2, 3 et 4 deviennent forts.
    await expect.poll(() => accentsAffiches(page)).toEqual([2, 2, 2, 2]);
    await attendreEtat(page, (m) => m.beatPattern, [2, 2, 2, 2]);
  });

  test('« ⋯ » : Temps/mesure de 1 à 12 et Subdivision (Croches double les pastilles)', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await expect(champTemps(page)).toBeHidden();
    await boutonAutres(page).click();
    await expect(champTemps(page)).toBeVisible();
    await expect(champTemps(page)).toHaveValue('4');
    await champTemps(page).fill('7');
    await champTemps(page).press('Tab');
    await expect(metro(page).locator('.metro-beat-group')).toHaveCount(7);
    await attendreEtat(page, (m) => m.beatsPerMeasure, 7);
    await choixSubdivision(page).selectOption({ label: 'Croches' });
    await expect(pastilles(page)).toHaveCount(14);
    await attendreEtat(page, (m) => m.subdivision, 2);
    await champTemps(page).fill('20');
    await champTemps(page).press('Tab');
    await expect(champTemps(page)).toHaveValue('12');   // le maximum
    await attendreEtat(page, (m) => m.beatsPerMeasure, 12);
    await champTemps(page).fill('1');
    await champTemps(page).press('Tab');
    await expect(pastilles(page).first()).toBeVisible();
    await attendreEtat(page, (m) => m.beatsPerMeasure, 1);   // un seul temps par mesure : permis
    await champTemps(page).fill('0');
    await champTemps(page).press('Tab');
    // 0 n'est pas une mesure : la saisie est refusée et une valeur valide revient (observé : 4, le réglage par défaut).
    await expect.poll(async () => Number(await champTemps(page).inputValue())).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => (await champTemps(page).inputValue())).not.toBe('0');
  });

  test('changer de mesure pendant la lecture ne l\'arrête pas', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await jouer(page).click();
    await enLecture(page);
    await formule(page, '5/4').click();
    await expect(pastilles(page)).toHaveCount(5);
    await enLecture(page);
    await formule(page, '6/8').click();
    await expect(pastilles(page)).toHaveCount(6);
    await enLecture(page);
    await expect(metro(page).locator('.metro-chrono-value')).not.toHaveText('00:00');
  });

  test('la mesure et les accents choisis survivent à un rechargement', async ({ page, ouvrirAppli }) => {
    await ouvrirMetro(ouvrirAppli);
    await ouvrir(page);
    await formule(page, '6/8').click();
    await pastille(page, 4).click();   // le 4ᵉ temps devient fort
    await saisirTempo(page, 90);
    await attendreEtat(page, (m) => [m.beatsPerMeasure, m.beatPattern], [6, [2, 1, 1, 2, 1, 1]]);
    await page.reload();
    await expect(page.locator('#folder-container')).toBeAttached();
    await ouvrir(page);
    await expect(pastilles(page)).toHaveCount(6);
    expect(await accentsAffiches(page)).toEqual([2, 1, 1, 2, 1, 1]);
  });
});
