// MODULE « session » — EXPORT PDF d'une session. Observé en boîte noire (playwright-cli, 25/11/2026) : « Enregistrer sous PDF » (bas de l'éditeur) télécharge
// `session-<nom>.pdf` (Chromium) ; selon le navigateur le PDF se télécharge ou s'ouvre dans un onglet `blob:` : on relit les octets réellement produits.
import { test, expect } from '../support/fixtures';
import { octetsDuPdfOuvert } from '../fiche/aide-fiche';
import { etatSession, ligneSession, ouvrirSessions } from './aide-session';

test.describe('Session : export PDF @session', () => {
  test('« Enregistrer sous PDF » produit un vrai fichier PDF, lisible et non vide @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatSession(['Alpha', 'Bravo'], [{ nom: 'Grille du soir', exercices: [['Alpha', 6], ['Bravo', 5]], commentaire: 'Bon enchaînement' }]) });
    await ouvrirSessions(page);
    await ligneSession(page, 'Grille du soir').locator('.gs-session-name').click();
    const octets = await octetsDuPdfOuvert(page, () => page.getByRole('button', { name: 'Enregistrer sous PDF' }).click());
    expect(octets.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(octets.subarray(-1024).toString('latin1')).toContain('%%EOF');
    expect(octets.length).toBeGreaterThan(1500);
    expect(octets.toString('latin1')).toMatch(/\/Type\s*\/Page\b/);
  });

  test('le fichier téléchargé porte le nom de la session', async ({ ouvrirAppli, browserName }) => {
    const page = await ouvrirAppli({ etat: etatSession(['Alpha'], [{ nom: 'Grille du soir', exercices: ['Alpha'] }]) });
    await ouvrirSessions(page);
    await ligneSession(page, 'Grille du soir').locator('.gs-session-name').click();
    const telechargements: string[] = [];
    page.on('download', (d) => telechargements.push(d.suggestedFilename()));
    const onglets: string[] = [];
    page.context().on('page', (p) => onglets.push(p.url()));
    await page.getByRole('button', { name: 'Enregistrer sous PDF' }).click();
    await expect.poll(() => telechargements.length + onglets.length).toBeGreaterThan(0);
    // Quand le navigateur ouvre le PDF au lieu de le télécharger, le nom n'est pas observable : seul l'onglet `blob:` l'est.
    if (telechargements.length) expect(telechargements[0]).toBe('session-grille-du-soir.pdf');
    else expect(onglets.some((u) => u.startsWith('blob:'))).toBe(true);
  });
});
