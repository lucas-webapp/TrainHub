// MODULE « fiche » — PASTILLE « EN COURS » de l'en-tête. Observé en boîte noire (playwright-cli, 24/11/2026) : la fiche ouverte porte une pastille « En cours » (bouton à bascule,
// aria-pressed) à droite du titre ; allumée, l'exercice se retrouve dans l'onglet « En cours » du choix d'une session ; repliée, la fiche ne montre plus la pastille mais un petit point (image
// « En cours ») ; le menu clic droit / appui long propose la même bascule. Le menu et le filtre « ● En cours » de la liste sont aussi couverts par le module `bibliotheque`.
import { test, expect } from '../support/fixtures';
import { actionExercice } from '../bibliotheque/aide-bibliotheque';
import { attendreChamp, entete, espaceEntete, etatFiche, exo, fiche, ouvrirTechnique } from './aide-fiche';

test.describe('Fiche : pastille « En cours » @fiche', () => {
  test('la pastille s\'allume et s\'éteint d\'un clic, c\'est enregistré et gardé après rechargement @critique', async ({ ouvrirAppli, garde }) => {
    const page = await ouvrirAppli({ etat: etatFiche(['Alpha', 'Bravo']) });
    await ouvrirTechnique(page);
    const a = fiche(page, 'Alpha');
    const pastille = a.getByRole('button', { name: 'En cours', exact: true });
    await expect(pastille).toHaveAttribute('aria-pressed', 'false');
    await pastille.click();
    await expect(pastille).toHaveAttribute('aria-pressed', 'true');
    await attendreChamp(page, 'Alpha', 'inProgress', true);
    // L'autre fiche n'est pas touchée.
    await expect(fiche(page, 'Bravo').getByRole('button', { name: 'En cours', exact: true })).toHaveAttribute('aria-pressed', 'false');
    expect((await exo(page, 'Bravo')).inProgress).toBeFalsy();

    await page.reload();
    await ouvrirTechnique(page);
    await expect(pastille).toHaveAttribute('aria-pressed', 'true');
    await pastille.click();
    await expect(pastille).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => !!(await exo(page, 'Alpha')).inProgress).toBe(false);
    expect(garde.bloquees).toEqual([]);
  });

  test('fiche repliée : plus de pastille, un petit point si l\'exercice est en cours ; rouvrir la fiche rend la pastille allumée', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche([{ titre: 'Alpha', extra: { inProgress: true } }, 'Bravo']) });
    await ouvrirTechnique(page);
    const a = fiche(page, 'Alpha'), b = fiche(page, 'Bravo');
    await espaceEntete(a).click();
    await espaceEntete(b).click();
    await expect(a.getByRole('button', { name: 'En cours', exact: true })).toBeHidden();
    await expect(entete(a).getByRole('img', { name: 'En cours' })).toHaveCount(1);
    await expect(entete(b).getByRole('img', { name: 'En cours' })).toHaveCount(0);
    await espaceEntete(a).click();
    await expect(a.getByRole('button', { name: 'En cours', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('la pastille et le menu clic droit (appui long au téléphone) restent d\'accord', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche(['Alpha']) });
    await ouvrirTechnique(page);
    const a = fiche(page, 'Alpha');
    const pastille = a.getByRole('button', { name: 'En cours', exact: true });
    await actionExercice(page, a, /Marquer « En cours »/);
    await expect(pastille).toHaveAttribute('aria-pressed', 'true');
    await pastille.click();
    await expect(pastille).toHaveAttribute('aria-pressed', 'false');
    await actionExercice(page, a, /Marquer « En cours »/);
    await expect(pastille).toHaveAttribute('aria-pressed', 'true');
    await attendreChamp(page, 'Alpha', 'inProgress', true);
  });
});
