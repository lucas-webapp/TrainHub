// MODULE « mobile » — SEUILS DE MISE EN PAGE, vus depuis les projets ORDINATEUR (chromium, firefox, webkit, edge, tablette) en faisant varier la largeur de la fenêtre. Mesuré en boîte noire (26/11/2026, 13 largeurs de 480 à 1 440 px) :
//   ≤ 760 px : barre du haut « téléphone » (neuf icônes, menu « ⋯ ») + barre des chapitres ; 761 → 879 px : barre du haut « ordinateur » (Annuler, Rétablir, Gammes… séparés) + barre des chapitres ; ≥ 880 px : colonne latérale.
//   (`tests/PLAN.md` et `CLAUDE-TRAINHUB.md` parlent d'une rupture à 700 px : les seuils mesurés de la barre du haut (760) et de la colonne (880) sont ailleurs ; la fonction `auTelephone` des aides (≤ 700) reste exacte pour les projets de test ; sans conséquence pour les tags `@mobile` / `@ordinateur`
//   — aucun projet n'est entre 700 et 880 px —, mais un téléphone COUCHÉ (734 ou 863 px) tombe dans la zone intermédiaire : voir `rotation.spec.ts`.) Nulle part la page ne doit défiler de côté.
import { test, expect } from '../support/fixtures';
import { bibliothequeLongue, sansDefilementHorizontal } from './aide-mobile';
import { chapitre, titreOuvert } from '../bibliotheque/aide-bibliotheque';

const visible = (page: import('@playwright/test').Page, sel: string) => page.evaluate((s) => { const e = document.querySelector(s) as HTMLElement | null; return !!e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden'; }, sel);
const mise = async (page: import('@playwright/test').Page) => ({ barreChapitres: await visible(page, '#chapter-bar'), colonne: await visible(page, '#sidebar-tree'), menuPlus: await visible(page, '#more-btn'), annuler: await visible(page, '#undo-btn') });

test.describe('Seuils de mise en page @ordinateur', () => {
  test('à la largeur du projet : colonne latérale, barre d\'ordinateur, ni barre des chapitres ni menu « ⋯ », rien ne défile de côté @critique', async ({ ouvrirAppli, page }) => {
    await ouvrirAppli({ accueil: 'jamais', etat: bibliothequeLongue(5) });
    expect(await mise(page)).toEqual({ barreChapitres: false, colonne: true, menuPlus: false, annuler: true });
    await sansDefilementHorizontal(page);
  });

  test('en rétrécissant la fenêtre : colonne dès 880 px, barre des chapitres de 879 à 761 px, barre « téléphone » en dessous ; le chapitre ouvert reste le même et la page ne défile jamais de côté', async ({ ouvrirAppli, page }) => {
    await ouvrirAppli({ accueil: 'jamais', etat: bibliothequeLongue(5) });
    await chapitre(page, 'Gammes').click();
    await expect(titreOuvert(page)).toHaveText('Gammes');
    const paliers: Array<[number, { barreChapitres: boolean; colonne: boolean; menuPlus: boolean; annuler: boolean }]> = [
      [880, { barreChapitres: false, colonne: true, menuPlus: false, annuler: true }],
      [879, { barreChapitres: true, colonne: false, menuPlus: false, annuler: true }],
      [761, { barreChapitres: true, colonne: false, menuPlus: false, annuler: true }],
      [760, { barreChapitres: true, colonne: false, menuPlus: true, annuler: false }],
      [700, { barreChapitres: true, colonne: false, menuPlus: true, annuler: false }],
      [480, { barreChapitres: true, colonne: false, menuPlus: true, annuler: false }],
    ];
    for (const [largeur, attendu] of paliers) {
      await page.setViewportSize({ width: largeur, height: 800 });
      await expect.poll(() => mise(page), { message: `mise en page à ${largeur} px` }).toEqual(attendu);
      await sansDefilementHorizontal(page, `à ${largeur} px`);
      await expect(titreOuvert(page)).toHaveText('Gammes');
    }
    // et en réagrandissant : tout revient
    await page.setViewportSize({ width: 1200, height: 800 });
    await expect.poll(() => mise(page)).toEqual({ barreChapitres: false, colonne: true, menuPlus: false, annuler: true });
    await expect(titreOuvert(page)).toHaveText('Gammes');
  });
});
