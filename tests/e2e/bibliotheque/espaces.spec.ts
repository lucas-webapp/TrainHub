// MODULE « bibliotheque » — ESPACES (instruments, groupes, projets…) : créer, renommer, supprimer, changer d'espace.
// Observé en boîte noire (playwright-cli, 23/11/2026) : la liste déroulante « Espace » du haut change d'espace ; « + » (Ajouter un espace) ouvre une
// boîte « Nouvel espace » (bouton Créer grisé tant que le nom est vide) ; le crayon (Renommer l'espace) ouvre une boîte qui porte aussi « Supprimer l'espace… ».
// Un espace neuf est vide (« Crée ton premier chapitre ci-dessus. ») et devient l'espace courant ; supprimer un espace envoie son contenu à la corbeille.
import { test, expect } from '../support/fixtures';
import { arbre, bibliothequeType, chapitre, espaceCourant, etatBibliotheque, lireEtat, message, nomsEspaces, selecteurEspace, ouvrirChapitre, annuler, titreOuvert } from './aide-bibliotheque';

const ajouter = (page: any) => page.getByRole('button', { name: 'Ajouter un espace' });
const renommer = (page: any) => page.getByRole('button', { name: "Renommer l'espace" });

test.describe('Espaces @bibliotheque', () => {
  test('créer un espace, y créer un chapitre, revenir à un autre espace : chacun garde son contenu, et le choix survit au rechargement @critique', async ({ ouvrirAppli, garde }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    expect(await nomsEspaces(page)).toEqual(['Basse', 'Guitare']);
    expect(await espaceCourant(page)).toBe('Basse');

    await ajouter(page).click();
    const boite = page.getByRole('dialog', { name: 'Nouvel espace' });
    await expect(boite).toBeVisible();
    await expect(boite.getByRole('button', { name: 'Créer' })).toBeDisabled();   // pas de nom, pas de création
    await boite.getByRole('textbox').fill('Piano');
    await expect(boite.getByRole('button', { name: 'Créer' })).toBeEnabled();
    await boite.getByRole('textbox').press('Enter');
    await expect(boite).toBeHidden();

    // Le nouvel espace est ouvert, vide ; il est dans la liste.
    await expect.poll(() => espaceCourant(page)).toBe('Piano');
    expect(await nomsEspaces(page)).toEqual(['Basse', 'Guitare', 'Piano']);
    await expect(page.getByText('Crée ton premier chapitre ci-dessus.')).toBeVisible();
    expect((await arbre(page)).find((e) => e.nom === 'Piano')!.chapitres).toEqual([]);

    // On y crée un chapitre (colonne latérale à l'ordinateur, bouton « + » de la barre au téléphone).
    await creerChapitreVia(page, 'Gammes de piano');
    await expect(titreOuvert(page)).toHaveText('Gammes de piano');

    // Retour à « Guitare » : son contenu, pas celui du piano.
    await selecteurEspace(page).selectOption({ label: 'Guitare' });
    await expect(chapitre(page, 'Accords')).toBeVisible();
    await expect(chapitre(page, 'Gammes de piano')).toHaveCount(0);

    // Le choix de l'espace est gardé après un rechargement.
    await page.reload();
    await expect(chapitre(page, 'Accords')).toBeVisible();
    expect(await espaceCourant(page)).toBe('Guitare');
    // Chaque espace garde son contenu dans l'état enregistré.
    expect(await arbre(page)).toEqual([
      expect.objectContaining({ nom: 'Basse', chapitres: [expect.objectContaining({ nom: 'Technique' }), expect.objectContaining({ nom: 'Improvisation' })] }),
      expect.objectContaining({ nom: 'Guitare', chapitres: [expect.objectContaining({ nom: 'Accords' })] }),
      expect.objectContaining({ nom: 'Piano', chapitres: [expect.objectContaining({ nom: 'Gammes de piano' })] }),
    ]);
    expect(garde.bloquees).toEqual([]);
  });

  test('changer d\'espace affiche les chapitres et les exercices de cet espace', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await expect(chapitre(page, 'Technique')).toBeVisible();
    await expect(chapitre(page, 'Improvisation')).toBeVisible();
    await expect(chapitre(page, 'Accords')).toHaveCount(0);

    await selecteurEspace(page).selectOption({ label: 'Guitare' });
    await expect(chapitre(page, 'Accords')).toBeVisible();
    await expect(chapitre(page, 'Technique')).toHaveCount(0);
    await ouvrirChapitre(page, 'Accords');
    await expect(page.locator('#folder-container .exercise-title')).toHaveValue('Barrés');

    await selecteurEspace(page).selectOption({ label: 'Basse' });
    await expect(chapitre(page, 'Technique')).toBeVisible();
    await expect(chapitre(page, 'Accords')).toHaveCount(0);
  });

  test('renommer l\'espace : le bouton reste grisé tant que le nom ne change pas ; le contenu est conservé', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await renommer(page).click();
    const boite = page.getByRole('dialog', { name: "Renommer l'espace" });
    const champ = boite.getByRole('textbox');
    await expect(champ).toHaveValue('Basse');
    await expect(boite.getByRole('button', { name: 'Renommer', exact: true })).toBeDisabled();

    await champ.fill('Contrebasse');
    await expect(boite.getByRole('button', { name: 'Renommer', exact: true })).toBeEnabled();
    await boite.getByRole('button', { name: 'Renommer', exact: true }).click();
    await expect(boite).toBeHidden();

    await expect.poll(() => nomsEspaces(page)).toEqual(['Contrebasse', 'Guitare']);
    expect(await espaceCourant(page)).toBe('Contrebasse');
    await expect(chapitre(page, 'Technique')).toBeVisible();
    const e = await arbre(page);
    expect(e[0].nom).toBe('Contrebasse');
    expect(e[0].chapitres.map((c) => c.nom)).toEqual(['Technique', 'Improvisation']);

    // Annuler la boîte ne change rien.
    await renommer(page).click();
    await page.getByRole('dialog').getByRole('textbox').fill('Autre nom');
    await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(await espaceCourant(page)).toBe('Contrebasse');
  });

  test('supprimer un espace : la boîte annonce ce qui part, « Annuler » garde tout, « Supprimer » ouvre un autre espace, et on peut revenir en arrière @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await renommer(page).click();
    await page.getByRole('dialog').getByRole('button', { name: "Supprimer l'espace…" }).click();
    const confirmation = page.getByRole('dialog', { name: /Supprimer l'espace « Basse » \?/ });
    await expect(confirmation).toBeVisible();
    // Basse : Gamme majeure, Arpèges, Croches, Triolets, Pouce, Pop simple, Blues en la = 7 exercices.
    await expect(confirmation).toContainText('7 exercices et 0 session');
    await expect(confirmation).toContainText('Récupérable dans la corbeille');

    // Annuler : rien n'est supprimé.
    await confirmation.getByRole('button', { name: 'Annuler' }).click();
    await expect(confirmation).toBeHidden();
    expect(await nomsEspaces(page)).toEqual(['Basse', 'Guitare']);

    // Supprimer : « Basse » disparaît, « Guitare » est ouvert.
    await renommer(page).click();
    await page.getByRole('dialog').getByRole('button', { name: "Supprimer l'espace…" }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect.poll(() => nomsEspaces(page)).toEqual(['Guitare']);
    expect(await espaceCourant(page)).toBe('Guitare');
    await expect(chapitre(page, 'Accords')).toBeVisible();
    await expect(chapitre(page, 'Technique')).toHaveCount(0);
    expect((await arbre(page)).map((e) => e.nom)).toEqual(['Guitare']);
    await expect(message(page, /Basse/)).toBeVisible();

    // Annuler (message ou bouton du haut) ramène l'espace, avec son contenu.
    await annuler(page);
    await expect.poll(() => nomsEspaces(page)).toEqual(expect.arrayContaining(['Basse', 'Guitare']));
    await selecteurEspace(page).selectOption({ label: 'Basse' });
    await expect(chapitre(page, 'Technique')).toBeVisible();
    await expect(chapitre(page, 'Improvisation')).toBeVisible();
  });

  test('on ne peut pas créer un espace sans nom ; Échap ferme la boîte sans rien créer', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: bibliothequeType() });
    await ajouter(page).click();
    const boite = page.getByRole('dialog', { name: 'Nouvel espace' });
    await boite.getByRole('textbox').fill('   ');
    await expect(boite.getByRole('button', { name: 'Créer' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(boite).toBeHidden();
    expect(await nomsEspaces(page)).toEqual(['Basse', 'Guitare']);
    expect((await lireEtat(page)).instruments).toHaveLength(2);
  });

  test('l\'espace supprimé part dans la corbeille de l\'appli (récupérable)', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatBibliotheque([
      { nom: 'Basse', chapitres: [{ nom: 'Technique', exercices: ['Walking'] }] },
      { nom: 'Violon', chapitres: [{ nom: 'Archets', exercices: ['Legato'] }] },
    ]) });
    await selecteurEspace(page).selectOption({ label: 'Violon' });
    await renommer(page).click();
    await page.getByRole('dialog').getByRole('button', { name: "Supprimer l'espace…" }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect.poll(() => nomsEspaces(page)).toEqual(['Basse']);
    // La corbeille (bouton du haut ; menu « ⋯ » au téléphone) le liste.
    const telephone = (page.viewportSize()?.width ?? 1440) <= 700;
    if (telephone) { await page.locator('#more-btn').click(); await page.getByRole('menuitem', { name: 'Corbeille' }).click(); }
    else await page.getByRole('button', { name: 'Corbeille' }).click();
    await expect(page.getByText('Violon').first()).toBeVisible();
  });
});

/** Crée un chapitre : champ « Nouveau chapitre… » de la colonne (ordinateur) ou bouton « + » de la barre de pastilles (téléphone). */
async function creerChapitreVia(page: any, nom: string) {
  if ((page.viewportSize()?.width ?? 1440) <= 700) {
    await page.getByTitle('Ajouter un grand chapitre').click();
    const boite = page.getByRole('dialog');
    await boite.getByRole('textbox').fill(nom);
    await boite.getByRole('textbox').press('Enter');
  } else {
    const champ = page.getByPlaceholder('Nouveau chapitre…');
    await champ.fill(nom);
    await champ.press('Enter');
  }
  await expect(chapitre(page, nom)).toBeVisible();
}
