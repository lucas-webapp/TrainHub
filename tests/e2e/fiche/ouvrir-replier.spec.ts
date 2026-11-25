// MODULE « fiche » — OUVRIR / REPLIER la fiche d'un exercice. Observé en boîte noire (playwright-cli, 24/11/2026) : un clic sur l'espace libre de l'en-tête replie ou déplie la fiche
// (`collapsed` dans l'état) ; repliée, elle ne garde que le titre, la note fixe écrite (lecture seule, clic = ouvrir) et des pastilles de résumé (pièces jointes, copies liées, tempo).
// Ouvrir une fiche replie les autres (accordéon) ; replier n'en touche aucune autre. Les mesures au pixel (hauteurs, alignements) sont tenues par les bancs `notes_vides` et `barre_outils` (PLAN § 7) : ici, les PARCOURS.
import { test, expect } from '../support/fixtures';
import { attendreChamp, boutonNoteFixe, entete, espaceEntete, etatFiche, exo, fiche, noteFixe, ouvrirTechnique } from './aide-fiche';

test.describe('Fiche : ouvrir et replier @fiche', () => {
  test('replier puis rouvrir une fiche en cliquant son en-tête : la barre d\'outils disparaît puis revient, et l\'état est gardé après rechargement @critique', async ({ ouvrirAppli, garde }) => {
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme majeure']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme majeure');
    // Fiche ouverte : tempo cible, notes à ajouter, champ de lien.
    await expect(f.getByRole('spinbutton', { name: /Tempo cible/ })).toBeVisible();
    await expect(boutonNoteFixe(f)).toBeVisible();
    await expect(f.getByPlaceholder('Coller un lien…')).toBeVisible();

    await espaceEntete(f).click();
    await attendreChamp(page, 'Gamme majeure', 'collapsed', true);
    await expect(f.getByRole('spinbutton', { name: /Tempo cible/ })).toBeHidden();
    await expect(boutonNoteFixe(f)).toBeHidden();
    await expect(f.getByPlaceholder('Coller un lien…')).toBeHidden();
    await expect(f.locator('input.exercise-title')).toHaveValue('Gamme majeure');   // le titre reste

    // Rechargement : toujours repliée.
    await page.reload();
    await ouvrirTechnique(page);
    await expect(f.getByRole('spinbutton', { name: /Tempo cible/ })).toBeHidden();

    await espaceEntete(f).click();
    await attendreChamp(page, 'Gamme majeure', 'collapsed', false);
    await expect(f.getByRole('spinbutton', { name: /Tempo cible/ })).toBeVisible();
    await expect(boutonNoteFixe(f)).toBeVisible();
    expect(garde.bloquees).toEqual([]);
  });

  test('les fiches sont indépendantes : en replier une ne touche pas à la voisine', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche(['Alpha', 'Bravo', 'Charlie']) });
    await ouvrirTechnique(page);
    await espaceEntete(fiche(page, 'Bravo')).click();
    await expect(fiche(page, 'Bravo').getByPlaceholder('Coller un lien…')).toBeHidden();
    await expect(fiche(page, 'Alpha').getByPlaceholder('Coller un lien…')).toBeVisible();
    await expect(fiche(page, 'Charlie').getByPlaceholder('Coller un lien…')).toBeVisible();
    expect((await exo(page, 'Alpha')).collapsed).toBeFalsy();
    expect((await exo(page, 'Charlie')).collapsed).toBeFalsy();
  });

  test('une seule fiche dépliée à la fois : en ouvrir une (clic sur l\'en-tête) replie toutes les autres', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche([{ titre: 'Alpha', ferme: true }, 'Bravo', 'Charlie']) });
    await ouvrirTechnique(page);
    const ouverte = (t: string) => fiche(page, t).getByPlaceholder('Coller un lien…');
    // Au départ Bravo et Charlie sont dépliées (état enregistré).
    await expect(ouverte('Bravo')).toBeVisible();
    await expect(ouverte('Charlie')).toBeVisible();
    await espaceEntete(fiche(page, 'Alpha')).click();
    await expect(ouverte('Alpha')).toBeVisible();
    await expect(ouverte('Bravo')).toBeHidden();
    await expect(ouverte('Charlie')).toBeHidden();
    await expect.poll(async () => [(await exo(page, 'Alpha')).collapsed, (await exo(page, 'Bravo')).collapsed, (await exo(page, 'Charlie')).collapsed]).toEqual([false, true, true]);
    // Ouvrir Bravo replie Alpha.
    await espaceEntete(fiche(page, 'Bravo')).click();
    await expect(ouverte('Bravo')).toBeVisible();
    await expect(ouverte('Alpha')).toBeHidden();
  });

  test('modifier le titre dans la fiche ouverte ne la replie pas, et le nouveau titre est enregistré', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche(['Alpha']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Alpha');
    const titre = f.locator('input.exercise-title');
    await titre.click();
    await titre.fill('Alpha revu');
    await titre.press('Enter');
    await expect.poll(async () => (await exo(page, 'Alpha revu'))?.title).toBe('Alpha revu');
    await expect(f.getByPlaceholder('Coller un lien…')).toBeVisible();   // toujours ouverte
  });

  test('fiche repliée : la note fixe écrite reste lisible, un clic dessus rouvre la fiche', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche([{ titre: 'Gamme', ferme: true, extra: { fixedNotes: 'Garder le poignet souple' } }, { titre: 'Sans note', ferme: true }]) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    const lecture = f.getByTitle("Note fixe (clic : ouvrir l'exercice)");
    await expect(lecture).toHaveText('Garder le poignet souple');
    // Sans note fixe : rien de tel.
    await expect(fiche(page, 'Sans note').getByTitle("Note fixe (clic : ouvrir l'exercice)")).toHaveCount(0);

    await lecture.click();
    await attendreChamp(page, 'Gamme', 'collapsed', false);
    await expect(noteFixe(f)).toHaveValue('Garder le poignet souple');
  });

  test('fiche repliée : le résumé reste visible (tempo, pièces jointes), et la rouvrir rend le tempo réglable', async ({ ouvrirAppli }) => {
    const etat = etatFiche([{ titre: 'Gamme', ferme: true, extra: {
      links: [{ id: 'l1', label: 'Site', url: 'https://exemple.fr/a' }, { id: 'l2', label: 'Autre', url: 'https://exemple.fr/b' }],
      metronome: { bpm: 96, beatsPerMeasure: 4, rhythmLabel: '4/4', subdivision: 1, advanced: false, pattern: [2, 1, 1, 1], beatPattern: [2, 1, 1, 1] },
    } }]);
    const page = await ouvrirAppli({ etat });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    // Repliée : pastille ♩ du tempo et compteur de pièces jointes dans l'en-tête, pas de barre d'outils.
    await expect(entete(f).getByRole('button', { name: /♩\s*96/ })).toBeVisible();
    await expect(f.getByRole('spinbutton', { name: /Tempo cible/ })).toBeHidden();
    await expect(entete(f)).toContainText('2');
    await espaceEntete(f).click();
    await expect(f.getByRole('spinbutton', { name: /Tempo cible/ })).toHaveValue('96');
  });
});
