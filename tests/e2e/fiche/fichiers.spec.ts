// MODULE « fiche » — FICHIERS JOINTS (PDF, MP3) : ajout par le trombone (vrai sélecteur de fichiers), nom et taille, ouverture, renommer, retirer, accès rapide audio.
// Observé en boîte noire (playwright-cli, 24/11/2026) : sans connexion, le fichier reste dans IndexedDB (info-bulle « Fichier stocké seulement sur cet appareil ») ; un PDF s'ouvre dans un
// nouvel onglet ; un MP3 s'ouvre dans le lecteur audio (fenêtre flottante, durée lue) et l'en-tête de la fiche gagne un bouton « Écouter : <nom> » ; renommer garde le type mais pas l'extension
// affichée ; « Retirer » demande confirmation. Fichiers fabriqués dans le test (aide-fiche.ts). Envoi dans Firestore (connecté) : module `synchro`. Lecture audio / « Modifier le son » : module `audio`.
import { test, expect } from '../support/fixtures';
import { ajouterFichier, ajouterFichiers, etatFiche, exo, fiche, mp3, ouvrirOnglet, ouvrirTechnique, pdf, onglet, octetsDuPdfOuvert, sansBlobIndexedDB } from './aide-fiche';
import type { Locator } from '@playwright/test';

const boutonFichier = (f: Locator, nom: string) => f.getByRole('button', { name: new RegExp(`^${nom.replace('.', '\\.')}\\b`) });
const lecteur = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Fermer le lecteur' });

test.describe('Fiche : fichiers joints @fiche', () => {
  test('ajouter un PDF par le trombone : il apparaît avec son nom et sa taille, il est enregistré, et il est toujours là (et ouvrable) après rechargement @critique', async ({ ouvrirAppli, garde, browserName }) => {
    sansBlobIndexedDB(test, browserName);
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await ajouterFichier(page, f, pdf('partition.pdf'));
    await expect(onglet(f, 'Liens et fichiers')).toHaveText(/Liens et fichiers\s*1/);
    await expect(boutonFichier(f, 'partition.pdf')).toHaveText('partition.pdf · 200 o');
    await expect(f.getByTitle('Fichier stocké seulement sur cet appareil (non synchronisé)')).toBeVisible();
    await expect.poll(async () => (await exo(page, 'Gamme')).files).toMatchObject([{ name: 'partition.pdf', type: 'application/pdf', size: 200 }]);

    await page.reload();
    await ouvrirTechnique(page);
    await ouvrirOnglet(f, 'Liens et fichiers');
    await expect(boutonFichier(f, 'partition.pdf')).toBeVisible();
    // Les octets sont revenus d'IndexedDB : le clic ouvre un nouvel onglet.
    expect(await octetsDuPdfOuvert(page, () => boutonFichier(f, 'partition.pdf').click())).toEqual(pdf().buffer);
    expect(garde.bloquees).toEqual([]);
  });

  test('ajouter un MP3 : un clic l\'ouvre dans le lecteur audio (nom, durée lue), et l\'en-tête propose « Écouter : boucle.mp3 » @critique', async ({ ouvrirAppli, browserName }) => {
    sansBlobIndexedDB(test, browserName);
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await ajouterFichier(page, f, mp3('boucle.mp3'));
    await expect(boutonFichier(f, 'boucle.mp3')).toContainText('boucle.mp3 ·');
    await expect.poll(async () => (await exo(page, 'Gamme')).files).toMatchObject([{ name: 'boucle.mp3', type: 'audio/mpeg' }]);
    // Accès rapide dans l'en-tête.
    const rapide = f.locator('.exercise-row').getByRole('button', { name: 'Écouter : boucle.mp3' });
    await expect(rapide).toBeVisible();

    await boutonFichier(f, 'boucle.mp3').click();
    await expect(lecteur(page)).toBeVisible();
    const fenetre = page.getByText('boucle.mp3', { exact: true }).last();
    await expect(fenetre).toBeVisible();
    // Le MP3 fabriqué est décodé : le lecteur connaît sa durée (≈ 1 s) et propose la lecture.
    await expect(page.getByText('0:01', { exact: true })).toBeVisible();
    await lecteur(page).click();
    await expect(lecteur(page)).toBeHidden();
    // Le bouton de l'en-tête rouvre le lecteur.
    await rapide.click();
    await expect(lecteur(page)).toBeVisible();
    await lecteur(page).click();
  });

  test('plusieurs fichiers d\'un coup : tous ajoutés, chacun avec sa taille', async ({ ouvrirAppli, browserName }) => {
    sansBlobIndexedDB(test, browserName);
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await ajouterFichiers(page, f, pdf('grille.pdf'), mp3('boucle.mp3'));
    await expect(onglet(f, 'Liens et fichiers')).toHaveText(/Liens et fichiers\s*2/);
    await expect(boutonFichier(f, 'grille.pdf')).toBeVisible();
    await expect(boutonFichier(f, 'boucle.mp3')).toBeVisible();
    await expect.poll(async () => (await exo(page, 'Gamme')).files.map((x: any) => x.name).sort()).toEqual(['boucle.mp3', 'grille.pdf']);
  });

  test('renommer un fichier (crayon, Entrée) : le nouveau nom s\'affiche et est enregistré, le type reste ; Échap n\'enregistre rien', async ({ ouvrirAppli, browserName }) => {
    sansBlobIndexedDB(test, browserName);
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await ajouterFichier(page, f, pdf('partition.pdf'));
    await expect(boutonFichier(f, 'partition.pdf')).toBeVisible();
    // Échap.
    await f.getByTitle('Renommer ce fichier').click();
    await expect(f.locator('input:focus')).toHaveValue('partition.pdf');
    await page.keyboard.press('Escape');
    expect((await exo(page, 'Gamme')).files[0].name).toBe('partition.pdf');
    // Entrée.
    await f.getByTitle('Renommer ce fichier').click();
    await expect(f.locator('input:focus')).toHaveValue('partition.pdf');
    await page.keyboard.type('Grille de blues');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await exo(page, 'Gamme')).files[0].name).toBe('Grille de blues');
    expect((await exo(page, 'Gamme')).files[0].type).toBe('application/pdf');
    await expect(boutonFichier(f, 'Grille de blues')).toBeVisible();
  });

  test('retirer un fichier : une confirmation s\'affiche, « Annuler » le garde, « Retirer » le supprime de la fiche @critique', async ({ ouvrirAppli, browserName }) => {
    sansBlobIndexedDB(test, browserName);
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await ajouterFichier(page, f, pdf('partition.pdf'));
    await expect(boutonFichier(f, 'partition.pdf')).toBeVisible();

    await f.getByTitle('Retirer ce fichier').click();
    const boite = page.getByRole('dialog', { name: 'Retirer « partition.pdf » ?' });
    await expect(boite).toContainText('Le fichier sera supprimé de l\'exercice.');
    await boite.getByRole('button', { name: 'Annuler' }).click();
    await expect(boite).toBeHidden();
    await expect(boutonFichier(f, 'partition.pdf')).toBeVisible();
    expect((await exo(page, 'Gamme')).files).toHaveLength(1);

    await f.getByTitle('Retirer ce fichier').click();
    await boite.getByRole('button', { name: 'Retirer', exact: true }).click();
    await expect(boite).toBeHidden();
    await expect(boutonFichier(f, 'partition.pdf')).toHaveCount(0);
    await expect.poll(async () => (await exo(page, 'Gamme')).files).toEqual([]);
    // Rechargement : il ne revient pas.
    await page.reload();
    await ouvrirTechnique(page);
    await expect(boutonFichier(f, 'partition.pdf')).toHaveCount(0);
  });
});
