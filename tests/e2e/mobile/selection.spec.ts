// MODULE « mobile » — BARRE D'ACTIONS DE LA SÉLECTION au doigt. Observé en boîte noire (playwright-cli, 26/11/2026) : l'appui long sur un exercice › « Plus d'actions » › « Sélectionner (plusieurs) » démarre la sélection ;
// la barre `toolbar « Actions sur la sélection »` est collée en bas (`.sel-bar`, `max-width: 100vw - 20 px`, passe à la ligne), au-dessus du bandeau du lecteur audio quand il est affiché. Le CONTENU de la barre
// (actions, « Annuler ») est éprouvé par `bibliotheque/selection.spec.ts` ; BI-03 (la barre recouvre le dernier exercice) y est déjà noté. Ici : la barre au téléphone — dans l'écran, en portrait et couché,
// boutons touchables, au-dessus du lecteur audio, et le message d'annulation lisible.
import { test, expect } from '../support/fixtures';
import { etatBibliotheque } from '../bibliotheque/aide-bibliotheque';
import {
  barreSelection, boutonHaut, bibliothequeLongue, commandesDehors, commencerSelection, dansLEcran, hauteurEcran, ligneDepart, ouvrirTel, pastilleChapitre, rangee, sansDefilementHorizontal, serecouvrent, taille,
  tailles, tientBientot, toucher,
} from './aide-mobile';

const quatre = () => etatBibliotheque([{ nom: 'Basse', chapitres: [{ nom: 'Technique', exercices: ['Un', 'Deux', 'Trois', 'Quatre'] }] }]);

test.describe('Barre de sélection au téléphone @mobile', () => {
  test('la sélection démarre à l\'appui long ; la barre tient dans l\'écran, ses boutons se touchent, « Tout » et ✕ marchent @critique', async ({ ouvrirAppli, page }) => {
    await ouvrirTel(ouvrirAppli, quatre());
    await commencerSelection(page, 'Deux');
    const barre = barreSelection(page);
    await expect(barre).toContainText('1 exercice sélectionné');
    await dansLEcran(page, barre, 'barre de sélection');
    expect(await commandesDehors(page, barre)).toEqual([]);
    for (const b of await barre.getByRole('button').all()) {
      const t = await taille(b);
      expect.soft(Math.min(t.l, t.h), `bouton « ${(await b.textContent() || await b.getAttribute('aria-label') || '').trim()} »`).toBeGreaterThanOrEqual(26);
    }
    await sansDefilementHorizontal(page);
    await toucher(rangee(ligneDepart(page, 'Un')));   // (« Quatre » est sous la barre : BI-03)
    await expect(barre).toContainText('2 exercices sélectionnés');
    await barre.getByRole('button', { name: 'Tout', exact: true }).tap();
    await expect(barre).toContainText('4 exercices sélectionnés');
    await barre.getByRole('button', { name: 'Désélectionner' }).tap();
    await expect(barre).toBeHidden();
  });

  test('la barre ne recouvre pas les boutons de la barre du haut et reste entièrement visible quand la page défile', async ({ ouvrirAppli, page }) => {
    await ouvrirTel(ouvrirAppli, bibliothequeLongue(25));
    await toucher(pastilleChapitre(page, 'Technique'));
    await commencerSelection(page, 'Technique 2');
    await page.evaluate(() => window.scrollTo(0, 700));
    const barre = barreSelection(page);
    await dansLEcran(page, barre, 'barre après défilement');
    const b = (await barre.boundingBox())!, h = await hauteurEcran(page);
    expect(b.height / h, 'la barre prend moins de 30 % de la hauteur').toBeLessThan(0.3);
    expect(serecouvrent(b, (await boutonHaut(page, 'Paramètres').boundingBox())!)).toBe(false);
  });

  // MO-06 (gênant) : au téléphone le lecteur audio est un panneau flottant en bas (`.audio-panel.panel-floating`), pas un bandeau « docké » : la règle qui remonte la barre de sélection au-dessus du lecteur
  // (`html.audio-docked`) ne s'applique pas. La barre (≈ 124 px) et le lecteur (≈ 97 px) se recouvrent : l'un cache les commandes de l'autre.
  test('le lecteur audio affiché, la barre de sélection se pose au-dessus de lui sans le recouvrir', async ({ ouvrirAppli, page }) => {
    test.fail(true, 'MO-06 : la barre de sélection (bas de l\'écran) recouvre le panneau flottant du lecteur audio.');
    await ouvrirTel(ouvrirAppli, quatre());
    await commencerSelection(page, 'Un');
    await boutonHaut(page, 'Lecteur audio').tap();
    const lecteur = page.locator('.audio-panel');
    await expect(lecteur).toBeVisible();
    const [b, l] = [(await barreSelection(page).boundingBox())!, (await lecteur.boundingBox())!];
    expect(serecouvrent(b, l), `barre ${Math.round(b.y)}–${Math.round(b.y + b.height)}, lecteur ${Math.round(l.y)}–${Math.round(l.y + l.height)}`).toBe(false);
  });

  test('téléphone couché, la barre tient dans l\'écran et ne prend pas plus de la moitié de la hauteur', async ({ ouvrirAppli, page }, testInfo) => {
    await ouvrirTel(ouvrirAppli, quatre());
    await commencerSelection(page, 'Trois');
    const { paysage } = tailles(page, testInfo.project.name);
    await page.setViewportSize(paysage);
    const barre = barreSelection(page);
    await tientBientot(page, barre, 'barre de sélection en paysage');
    expect((await barre.boundingBox())!.height / paysage.height).toBeLessThan(0.5);
    expect(await commandesDehors(page, barre)).toEqual([]);
    await barre.getByRole('button', { name: 'Désélectionner' }).tap();
    await expect(barre).toBeHidden();
  });

  test('« Favori » sur la sélection : le message « Annuler » est lisible, dans l\'écran et au-dessus de la barre @critique', async ({ ouvrirAppli, page }) => {
    await ouvrirTel(ouvrirAppli, quatre());
    await commencerSelection(page, 'Un');
    await barreSelection(page).getByRole('button', { name: /Favori/ }).tap();
    const message = page.locator('.toast').filter({ hasText: /favori/i });
    await expect(message).toBeVisible();
    await dansLEcran(page, message, 'message');
    await expect(message.getByRole('button', { name: 'Annuler' })).toBeInViewport();
    await message.getByRole('button', { name: 'Annuler' }).tap();
    await expect(message).toBeHidden();
  });
});
