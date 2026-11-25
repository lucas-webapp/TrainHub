// MODULE « fiche » — MISE EN PAGE ordinateur / téléphone (rupture à 700 px). Observé en boîte noire (playwright-cli, 24/11/2026) : l'onglet des liens et fichiers s'appelle « Liens et fichiers » à l'ordinateur,
// « Liens » au téléphone ; les boutons d'accès rapide de l'en-tête se regroupent (« Liens (n) » dès qu'il y a plusieurs liens, YouTube compris) et, au téléphone, un seul bouton « Liens, audio et images de
// l'exercice : … » quand il y a aussi de l'audio ou des images. Les mesures au pixel : bancs `barre_outils` (PLAN § 7).
import { test, expect } from '../support/fixtures';
import { ajouterLien, etatFiche, fiche, onglet, ouvrirTechnique } from './aide-fiche';

const YOUTUBE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

test.describe('Fiche : mise en page @fiche', () => {
  test('un lien YouTube et un lien web : un seul bouton « Liens (2) » dans l\'en-tête, dont le menu liste les deux ; les onglets séparent « Vidéos » et les liens', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await ajouterLien(f, YOUTUBE);
    await ajouterLien(f, 'https://exemple.fr/ressources');
    await expect(onglet(f, 'Vidéos')).toHaveText(/Vidéos\s*1/);
    await expect(onglet(f, 'Liens et fichiers')).toHaveText(/Liens( et fichiers)?\s*1/);   // « Liens et fichiers » à l'ordinateur, « Liens » sur un petit écran
    const rapide = f.locator('.exercise-row').getByRole('button', { name: /Liens \(2\)|Choisir un lien à ouvrir/ });
    await expect(rapide).toBeVisible();
    await rapide.click();
    await expect(page.getByRole('menu').getByRole('button')).toHaveText(['YouTube', 'exemple.fr']);
  });

  test('au téléphone : une fiche bien remplie ne dépasse pas de l\'écran (pas de défilement horizontal) @mobile', async ({ ouvrirAppli }) => {
    const metronome = { bpm: 96, beatsPerMeasure: 4, rhythmLabel: '4/4', subdivision: 1, advanced: false, pattern: [2, 1, 1, 1], beatPattern: [2, 1, 1, 1] };
    const page = await ouvrirAppli({ etat: etatFiche([{ titre: 'Une gamme au titre assez long pour prendre de la place sur un petit écran', extra: {
      inProgress: true, metronome, dice: { cfg: null }, fixedNotes: 'Garder le poignet souple et le pouce ancré sur la corde grave pendant tout l\'exercice',
      notes: '24/11/26 : plus lent\n23/11/26 : 90 puis 96', links: [{ id: 'l1', label: 'Un lien au nom plutôt long, pour voir', url: 'https://exemple.fr/long' }],
    } }]) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Une gamme au titre assez long pour prendre de la place sur un petit écran');
    await expect(f.getByPlaceholder('Coller un lien…')).toBeVisible();
    const largeurs = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, fenetre: window.innerWidth }));
    expect(largeurs.doc).toBeLessThanOrEqual(largeurs.fenetre + 1);
    // Les zones de la fiche restent dans l'écran.
    const dehors = await f.locator('input, textarea, button').evaluateAll((els, l) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > l + 1 || r.left < -1); }).length, largeurs.fenetre);
    expect(dehors).toBe(0);
  });
});
