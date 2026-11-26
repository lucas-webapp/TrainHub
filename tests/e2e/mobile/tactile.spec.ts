// MODULE « mobile » — GESTES TACTILES : appui long (menu), défilement au doigt, glisser-déposer au doigt, commandes qui ne dépendent pas du survol. Observé en boîte noire (playwright-cli, 26/11/2026) :
// un appui long sur une pastille de chapitre, un dossier ou une ligne d'exercice ouvre le menu (≈ 0,5 s) ; la poignée ⠿ des exercices et les pastilles de chapitre ont `touch-action: none` (le doigt les fait glisser
// au lieu de faire défiler la page) ; les menus ne dépassent jamais l'écran (hauteur bornée, défilement interne). Les menus eux-mêmes (leur contenu) sont éprouvés par le module `bibliotheque` ;
// l'appui long sur un EXERCICE aussi (`menu-contextuel.spec.ts`) : ici, pastilles, dossiers, bords de l'écran, annulation par le mouvement et glisser au doigt. LIMITE : sous WebKit (iPhone) le glisser et l'appui long
// sont envoyés comme événements « pointeur » tactiles à la main (Playwright n'a pas de geste tactile réel hors Chromium) ; Chromium (Pixel) utilise de vrais événements tactiles (CDP).
import type { Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { etatBibliotheque, appuiLong, ordreChapitres, attendreTitres } from '../bibliotheque/aide-bibliotheque';
import { ouvrirAvecHorloge } from '../session/aide-session';
import {
  bibliothequeCourte, bibliothequeLongue, boutonHaut, dansLEcran, doigt, exos, glisserAuDoigt, hauteurEcran, ligneDepart, menuContextuel, ouvrirTel, pastilleChapitre, rangee, sansDefilementHorizontal, taille, toucher,
} from './aide-mobile';

const sousDossier = (page: Page, nom: string) => page.locator('#folder-container .folder-row').filter({ has: page.locator('.folder-name', { hasText: nom }) });
const ordreEnregistre = async (page: Page, chapitre = 'Technique') => {
  const e = await page.evaluate(() => JSON.parse(localStorage.getItem('trainhub.v1')!));
  return e.instruments[0].categories.find((c: any) => c.name === chapitre).exercises.map((x: any) => x.title);
};

test.describe('Appui long au téléphone @mobile', () => {
  test('un appui long ouvre le menu d\'une pastille de chapitre et d\'un dossier ; le menu tient dans l\'écran et ses entrées se touchent @critique', async ({ ouvrirAppli, page }) => {
    await ouvrirTel(ouvrirAppli);
    await appuiLong(page, pastilleChapitre(page, 'Technique'));
    const menu = menuContextuel(page);
    await expect(menu.getByRole('button')).toHaveText(['Nouveau sous-dossier', 'Renommer', 'Dupliquer', 'Déplacer vers…', 'Fusionner avec…', 'Transformer en chapitre de morceaux…', 'Supprimer']);
    await dansLEcran(page, menu, 'menu d\'un chapitre');
    for (const b of await menu.getByRole('button').all()) expect.soft((await taille(b)).h, `entrée « ${(await b.textContent())!.trim()} »`).toBeGreaterThanOrEqual(30);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    await toucher(pastilleChapitre(page, 'Technique'));
    await appuiLong(page, sousDossier(page, 'Rythme'));
    await expect(menu.getByRole('button')).toHaveText(['Nouveau sous-dossier', 'Renommer', 'Dupliquer', 'Déplacer vers…', 'Fusionner avec…', 'Supprimer']);
    await dansLEcran(page, menu, 'menu d\'un dossier');
    await page.touchscreen.tap(6, 6);   // un toucher à côté ferme le menu
    await expect(menu).toBeHidden();
    // le dossier n'a pas été ouvert par l'appui long
    await expect(page.locator('#breadcrumb .crumb-current')).toHaveText('Technique');
  });

  test('la dernière pastille (bord droit) et le dernier exercice (bas de l\'écran) ouvrent un menu qui reste dans l\'écran', async ({ ouvrirAppli, page }) => {
    await ouvrirTel(ouvrirAppli, bibliothequeLongue(12));
    await appuiLong(page, pastilleChapitre(page, 'Copie de morceaux'));
    await dansLEcran(page, menuContextuel(page), 'menu de la dernière pastille');
    await page.keyboard.press('Escape');
    await toucher(pastilleChapitre(page, 'Technique'));
    const derniere = ligneDepart(page, 'Technique 12');
    await derniere.scrollIntoViewIfNeeded();
    await derniere.evaluate((e) => window.scrollTo(0, document.documentElement.scrollHeight));
    await appuiLong(page, rangee(derniere));
    await dansLEcran(page, menuContextuel(page), 'menu du dernier exercice');
    // « Plus d'actions » allonge le menu : il reste dans l'écran et défile.
    await menuContextuel(page).getByRole('button', { name: /Plus d'actions/ }).tap();
    await dansLEcran(page, menuContextuel(page), 'menu étendu');
    const defile = await menuContextuel(page).evaluate((m) => getComputedStyle(m).overflowY);
    expect(['auto', 'scroll']).toContain(defile);
  });

  test('l\'écran étant bas (téléphone couché), le menu d\'un exercice est borné à la hauteur de l\'écran et son dernier choix s\'atteint en le faisant défiler', async ({ ouvrirAppli, page }, testInfo) => {
    await ouvrirTel(ouvrirAppli, bibliothequeCourte());
    await toucher(pastilleChapitre(page, 'Technique'));
    await page.setViewportSize({ width: page.viewportSize()!.width, height: 360 });
    await appuiLong(page, rangee(ligneDepart(page, 'Arpèges')));
    await menuContextuel(page).getByRole('button', { name: /Plus d'actions/ }).tap();
    const menu = menuContextuel(page);
    await dansLEcran(page, menu, 'menu étendu (écran bas)');
    const dernier = menu.getByRole('button', { name: /^Supprimer/ }).last();
    await dernier.scrollIntoViewIfNeeded();
    await expect(dernier).toBeInViewport();
    await dansLEcran(page, menu, 'menu après défilement');
    testInfo.annotations.push({ type: 'écran bas', description: `${await hauteurEcran(page)} px` });
  });

  test('un doigt qui défile n\'ouvre PAS de menu (l\'appui long est annulé par le mouvement) ; le même doigt immobile en ouvre un', async ({ ouvrirAppli, page, browserName }) => {
    test.fixme(browserName === 'webkit', 'ENV-MO-02 : le WebKit de Playwright n\'a aucun geste tactile réel (ni toucher prolongé ni balayage : « mouse.wheel is not supported in mobile WebKit ») ; à vérifier sur iPhone.');
    await ouvrirAvecHorloge(page, ouvrirAppli, { etat: bibliothequeCourte() });
    const b = (await rangee(ligneDepart(page, 'Gamme majeure')).boundingBox())!;
    const [x, y] = [b.x + b.width * 0.92, b.y + b.height / 2];   // à droite du titre : ni champ ni bouton
    const d = await doigt(page);
    await d.pose(x, y);
    await d.bouge(x, y - 12);
    await d.bouge(x, y - 40);
    await page.clock.runFor(1500);
    await expect(menuContextuel(page)).toHaveCount(0);
    await d.leve();
    // contrôle : posé sans bouger, le doigt ouvre le menu
    await d.pose(x, y);
    await page.clock.runFor(1500);
    await expect(menuContextuel(page)).toBeVisible();
    await d.leve();
    await d.ferme();
  });
});

test.describe('Défilement et glisser au doigt @mobile', () => {
  test('les zones qui doivent défiler au doigt n\'ont pas `touch-action: none`, les poignées de glisser l\'ont @critique', async ({ ouvrirAppli, page }) => {
    await ouvrirTel(ouvrirAppli, bibliothequeLongue(8));
    await toucher(pastilleChapitre(page, 'Technique'));
    const ta = (loc: import('@playwright/test').Locator) => loc.first().evaluate((e) => getComputedStyle(e).touchAction);
    for (const [nom, loc] of [['la page', page.locator('body')], ['la liste', page.locator('#folder-container')], ['une ligne d\'exercice', rangee(ligneDepart(page, 'Technique 3'))], ['le titre d\'un exercice', ligneDepart(page, 'Technique 3').locator('input.exercise-title')]] as const) {
      expect(await ta(loc), `touch-action de ${nom}`).not.toBe('none');
    }
    expect(await ta(ligneDepart(page, 'Technique 3').locator('.exercise-drag-handle')), 'touch-action de la poignée ⠿').toBe('none');
    expect(await ta(pastilleChapitre(page, 'Gammes')), 'touch-action d\'une pastille de chapitre').toBe('none');
  });

  // Horloge de la page FIGÉE (ouvrirAvecHorloge) : seul `runFor` fait avancer les minuteries de l'appli, donc un doigt un peu lent entre deux événements CDP ne déclenche pas l'appui long (menu / glisser voulus).
  async function balayerLaListe(page: Page, ouvrirAppli: any, departs: number[]) {
    await ouvrirAvecHorloge(page, ouvrirAppli, { etat: bibliothequeLongue(25) });
    await toucher(pastilleChapitre(page, 'Technique'));
    await page.clock.runFor(600);
    const avant = await ordreEnregistre(page);
    const y0 = await page.evaluate(() => window.scrollY);
    const h = await hauteurEcran(page);
    const d = await doigt(page);
    for (const x of departs) await d.balaie(x, h * 0.8, 260);   // du bas vers le haut
    await d.ferme();
    await page.clock.runFor(1500);   // le temps d'un appui long : la liste a défilé, aucun menu ne s'est ouvert
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(y0 + 300);
    await expect(menuContextuel(page)).toHaveCount(0);
    await sansDefilementHorizontal(page);
    return { avant, apres: await ordreEnregistre(page) };
  }

  test('balayer la liste au doigt par la marge de la page la fait défiler, sans ouvrir de menu ni déplacer d\'exercice @critique', async ({ ouvrirAppli, page, browserName }) => {
    test.fixme(browserName === 'webkit', 'ENV-MO-02 : le WebKit de Playwright n\'a aucun geste tactile réel (« mouse.wheel is not supported in mobile WebKit ») ; à vérifier sur iPhone.');
    const l = page.viewportSize()!.width;
    const { avant, apres } = await balayerLaListe(page, ouvrirAppli, [l - 8, l - 8, l - 8]);   // marge droite : hors des lignes
    expect(apres).toEqual(avant);
  });

  // MO-08 (gênant, intermittent ≈ 3 % des essais sous Chromium / Pixel 7, 6 sur 180 mesurés) : un balayage pour faire défiler qui COMMENCE SUR UNE LIGNE d'exercice intervertit parfois deux exercices voisins.
  // Journal des événements relevé : « pointerdown (x, 671) · pointercancel (0, 0) » — le navigateur reprend le geste pour défiler (pointercancel), l'appli semble le traiter comme un lâcher du glisser-déposer et déplace la ligne.
  // Le même balayage commençant dans la marge de la page ne déplace jamais rien (test d'au-dessus). Pas de rejeu déterministe possible : `test.fixme` (bug intermittent), à corriger puis réactiver.
  test('balayer la liste au doigt en partant d\'une ligne d\'exercice ne déplace jamais d\'exercice', async ({ ouvrirAppli, page, browserName }) => {
    test.fixme(true, browserName === 'webkit' ? 'ENV-MO-02 : pas de geste tactile réel sous le WebKit de Playwright.' : 'MO-08 : intermittent (≈ 3 %), un balayage qui part d\'une ligne intervertit parfois deux exercices voisins.');
    const { avant, apres } = await balayerLaListe(page, ouvrirAppli, [60, 200, 330]);
    expect(apres).toEqual(avant);
  });

  test('glisser un exercice par sa poignée avec le doigt le déplace, sans faire défiler la page, et l\'ordre est enregistré @critique', async ({ ouvrirAppli, page }) => {
    const etat = etatBibliotheque([{ nom: 'Basse', chapitres: [{ nom: 'Technique', exercices: ['Un', 'Deux', 'Trois', 'Quatre', 'Cinq'] }] }]);
    await ouvrirTel(ouvrirAppli, etat);
    await attendreTitres(page, ['Un', 'Deux', 'Trois', 'Quatre', 'Cinq']);
    const y0 = await page.evaluate(() => window.scrollY);
    await glisserAuDoigt(page, ligneDepart(page, 'Quatre').locator('.exercise-drag-handle'), rangee(ligneDepart(page, 'Deux')), 'haut');
    await attendreTitres(page, ['Un', 'Quatre', 'Deux', 'Trois', 'Cinq']);
    await expect.poll(() => ordreEnregistre(page)).toEqual(['Un', 'Quatre', 'Deux', 'Trois', 'Cinq']);
    expect(await page.evaluate(() => window.scrollY), 'la page n\'a pas défilé pendant le glisser').toBe(y0);
    await page.reload();
    await toucher(pastilleChapitre(page, 'Technique'));
    await attendreTitres(page, ['Un', 'Quatre', 'Deux', 'Trois', 'Cinq']);
  });

  test('glisser une pastille de chapitre avec le doigt change l\'ordre des chapitres, enregistré après rechargement', async ({ ouvrirAppli, page }) => {
    const etat = etatBibliotheque([{ nom: 'Basse', chapitres: [{ nom: 'Technique', exercices: ['a'] }, { nom: 'Gammes', exercices: ['b'] }, { nom: 'Impro', exercices: ['c'] }] }]);
    await ouvrirTel(ouvrirAppli, etat);
    expect(await ordreChapitres(page)).toEqual(['Technique', 'Gammes', 'Impro']);
    await glisserAuDoigt(page, pastilleChapitre(page, 'Impro'), pastilleChapitre(page, 'Technique'), 'gauche');
    await expect.poll(() => ordreChapitres(page)).toEqual(['Impro', 'Technique', 'Gammes']);
    await page.reload();
    await expect.poll(() => ordreChapitres(page)).toEqual(['Impro', 'Technique', 'Gammes']);
    await sansDefilementHorizontal(page);
  });

});

test.describe('Commandes sans survol @mobile', () => {
  test('aucune commande n\'est invisible en attendant un survol : bibliothèque, fiche ouverte et écran des sessions', async ({ ouvrirAppli, page }) => {
    const { etatSession } = await import('../session/aide-session');
    await ouvrirTel(ouvrirAppli, etatSession(['Alpha', 'Bravo', 'Charlie'], [{ nom: 'Matin', exercices: [['Alpha', 5], ['Bravo', 10]] }]));
    const cachees = (nom: string) => page.evaluate((nom) => [...document.querySelectorAll('button, a[href], [role=button], [role=tab], [role=radio], [role=switch], select, input:not([type=hidden])')]
      .filter((e) => { const b = e.getBoundingClientRect(), s = getComputedStyle(e); return b.width > 0 && b.height > 0 && b.left < innerWidth && (parseFloat(s.opacity) < 0.3 || (s.pointerEvents === 'none' && !(e as HTMLInputElement).disabled)); })
      .map((e) => `${nom} : ${e.getAttribute('aria-label') || e.getAttribute('title') || (e.textContent || '').trim().slice(0, 25) || e.className}`), nom);
    const trouvees: string[] = [...await cachees('bibliothèque')];
    await expect(ligneDepart(page, 'Alpha').getByPlaceholder('Coller un lien…')).toBeVisible();   // la fiche est dépliée au départ
    trouvees.push(...await cachees('fiche ouverte'));
    await boutonHaut(page, 'Session guidée').tap();
    await expect(page.getByRole('button', { name: '+ Nouvelle session' })).toBeVisible();
    trouvees.push(...await cachees('sessions'));
    expect(trouvees, 'commandes à peine visibles ou sans réaction au toucher').toEqual([]);
  });
});
