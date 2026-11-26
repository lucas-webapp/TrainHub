// MODULE « morceaux » — la FICHE d'un morceau : identité (champs « Artiste » et « Titre », titre de l'en-tête) et caractéristiques (menus « Style », « Technique », « Travail »). Observé en boîte noire
// (playwright-cli, 26/11/2026) : les champs de la fiche s'enregistrent à la sortie du champ (ou Entrée) ; l'artiste déjà connu garde sa graphie ; un titre vide est refusé avec un message ; un nom déjà pris
// demande confirmation ; l'en-tête reste un champ « Artiste - Titre » qui se redécoupe. Styles et techniques : plusieurs choix, le menu reste ouvert, valeurs rangées de la plus utilisée à la moins
// utilisée ; Travail : un seul choix, le menu se ferme, re-choisir la valeur la retire ; « ＋ Nouveau… » tout en bas ajoute une valeur au vocabulaire du chapitre.
import { test, expect } from '../support/fixtures';
import {
  attendreMorceau, boite, boutonPropriete, champsArtiste, champsTitre, chapitreEnregistre, deplier, etatMorceaux, ligneDepart, menuPropriete, message, morceauEnregistre, ouvrirMorceaux, ouvrirPropriete,
  repondre, titreEntete, valeurMenu, valeursMenu,
} from './aide-morceaux';

const base = () => etatMorceaux([
  { titre: 'Beatles - Something', styles: ['Rock'] }, 'Stevie Wonder - Superstition', { titre: 'Muse - Hysteria', styles: ['Rock', 'Funk'], techniques: ['Slap'] },
], { vocab: { styles: ['Rock', 'Funk', 'Jazz'], techniques: ['Médiator', 'Slap'] } });

test.describe('Morceaux : la fiche, l\'identité @morceaux', () => {
  test('changer l\'artiste dans la fiche : le titre « Artiste - Titre » de l\'en-tête suit, c\'est enregistré et ça reste au rechargement @critique', async ({ ouvrirAppli, garde }) => {
    const page = await ouvrirAppli({ etat: base() });
    await ouvrirMorceaux(page);
    await deplier(page, 'Beatles - Something');
    const f = ligneDepart(page, 'Beatles - Something');
    await expect(champsArtiste(f)).toHaveValue('Beatles');
    await expect(champsTitre(f)).toHaveValue('Something');
    await champsArtiste(f).fill('The Beatles');
    await champsArtiste(f).press('Enter');
    const m = await attendreMorceau(page, 'The Beatles - Something', () => true);
    expect(m).toMatchObject({ artist: 'The Beatles', songName: 'Something', title: 'The Beatles - Something' });
    await expect(titreEntete(f)).toHaveValue('The Beatles - Something');
    await page.reload();
    await ouvrirMorceaux(page);
    await expect(page.locator('#folder-container .exercise-title')).toHaveCount(3);
    expect((await chapitreEnregistre(page)).exercises.map((e: any) => e.title).sort()).toEqual(['Muse - Hysteria', 'Stevie Wonder - Superstition', 'The Beatles - Something']);
    expect(garde.bloquees).toEqual([]);
  });

  test('changer le titre dans la fiche : le titre de l\'en-tête suit, l\'artiste ne bouge pas', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: base() });
    await ouvrirMorceaux(page);
    await deplier(page, 'Stevie Wonder - Superstition');
    const f = ligneDepart(page, 'Stevie Wonder - Superstition');
    await champsTitre(f).fill('Sir Duke');
    await champsTitre(f).press('Enter');
    const m = await attendreMorceau(page, 'Stevie Wonder - Sir Duke', () => true);
    expect(m).toMatchObject({ artist: 'Stevie Wonder', songName: 'Sir Duke' });
    await expect(titreEntete(f)).toHaveValue('Stevie Wonder - Sir Duke');
  });

  test('un artiste déjà connu garde sa graphie : « stevie wonder » saisi sur un autre morceau devient « Stevie Wonder »', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: base() });
    await ouvrirMorceaux(page);
    await deplier(page, 'Muse - Hysteria');
    const f = ligneDepart(page, 'Muse - Hysteria');
    await champsArtiste(f).fill('stevie wonder');
    await champsArtiste(f).press('Enter');
    await attendreMorceau(page, 'Stevie Wonder - Hysteria', (m) => m.artist === 'Stevie Wonder');
  });

  test('un titre vidé est refusé : message « Le titre du morceau ne peut pas être vide. », l\'ancien titre revient', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: base() });
    await ouvrirMorceaux(page);
    await deplier(page, 'Beatles - Something');
    const f = ligneDepart(page, 'Beatles - Something');
    await champsTitre(f).fill('   ');
    await champsTitre(f).press('Enter');
    await expect(message(page, 'Le titre du morceau ne peut pas être vide.')).toBeVisible();
    await expect(champsTitre(f)).toHaveValue('Something');
    expect((await morceauEnregistre(page, 'Beatles - Something')).songName).toBe('Something');
  });

  test('un artiste vidé donne un morceau sans artiste : son titre est le titre seul', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: base() });
    await ouvrirMorceaux(page);
    await deplier(page, 'Beatles - Something');
    const f = ligneDepart(page, 'Beatles - Something');
    await champsArtiste(f).fill('');
    await champsArtiste(f).press('Enter');
    const m = await attendreMorceau(page, 'Something', () => true);
    expect(m).toMatchObject({ artist: '', songName: 'Something', title: 'Something' });
  });

  test('rien n\'a changé : pas de boîte ni de message, rien n\'est réenregistré', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: base() });
    await ouvrirMorceaux(page);
    await deplier(page, 'Beatles - Something');
    const f = ligneDepart(page, 'Beatles - Something');
    const avant = (await morceauEnregistre(page, 'Beatles - Something')).updatedAt;
    await champsArtiste(f).fill('Beatles');
    await champsArtiste(f).press('Enter');
    await champsTitre(f).fill(' Something ');   // les espaces autour ne comptent pas
    await champsTitre(f).press('Enter');
    await expect(boite(page)).toBeHidden();
    await expect(page.locator('.toast')).toHaveCount(0);
    expect((await morceauEnregistre(page, 'Beatles - Something')).updatedAt).toBe(avant);
  });

  test('un nom déjà pris : « Ce nom existe déjà » ; Annuler remet les anciennes valeurs dans les champs, « Renommer quand même » crée le doublon', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(['Beatles - Something', 'Muse - Something']) });
    await ouvrirMorceaux(page);
    await deplier(page, 'Beatles - Something');
    const f = ligneDepart(page, 'Beatles - Something');
    await champsArtiste(f).fill('Muse');
    await champsArtiste(f).press('Enter');
    const d = boite(page);
    await expect(d).toContainText('Ce nom existe déjà');
    await expect(d).toContainText('Un morceau « Muse - Something » existe déjà ici.');
    await d.getByRole('button', { name: 'Annuler' }).click();
    await expect(d).toBeHidden();
    await expect(champsArtiste(f)).toHaveValue('Beatles');
    await expect(champsTitre(f)).toHaveValue('Something');
    expect((await chapitreEnregistre(page)).exercises.map((e: any) => e.title)).toEqual(['Beatles - Something', 'Muse - Something']);
    await champsArtiste(f).fill('Muse');
    await champsArtiste(f).press('Enter');
    await boite(page).getByRole('button', { name: 'Renommer quand même' }).click();
    await expect.poll(async () => (await chapitreEnregistre(page)).exercises.map((e: any) => e.title)).toEqual(['Muse - Something', 'Muse - Something']);
  });

  test('le titre de l\'en-tête se redécoupe : « Led Zeppelin - Kashmir » devient artiste « Led Zeppelin » et titre « Kashmir », la fiche suit', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: base() });
    await ouvrirMorceaux(page);
    await deplier(page, 'Beatles - Something');
    const f = ligneDepart(page, 'Beatles - Something');
    await titreEntete(f).fill('Led Zeppelin - Kashmir');
    await titreEntete(f).press('Enter');
    const m = await attendreMorceau(page, 'Led Zeppelin - Kashmir', () => true);
    expect(m).toMatchObject({ artist: 'Led Zeppelin', songName: 'Kashmir' });
    await expect(champsArtiste(f)).toHaveValue('Led Zeppelin');
    await expect(champsTitre(f)).toHaveValue('Kashmir');
  });

  test('le titre de l\'en-tête sans « - » : le morceau n\'a plus d\'artiste', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: base() });
    await ouvrirMorceaux(page);
    await deplier(page, 'Beatles - Something');
    const f = ligneDepart(page, 'Beatles - Something');
    await titreEntete(f).fill('Kashmir');
    await titreEntete(f).press('Enter');
    const m = await attendreMorceau(page, 'Kashmir', () => true);
    expect(m).toMatchObject({ artist: '', songName: 'Kashmir' });
    await expect(champsArtiste(f)).toHaveValue('');
  });

  test('le titre de l\'en-tête vers un nom déjà pris : boîte « Ce nom existe déjà » ; Annuler remet l\'ancien titre', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: base() });
    await ouvrirMorceaux(page);
    await deplier(page, 'Beatles - Something');
    const f = ligneDepart(page, 'Beatles - Something');
    await titreEntete(f).fill('Muse - Hysteria');
    await titreEntete(f).press('Enter');
    const d = boite(page);
    await expect(d).toContainText('Ce nom existe déjà');
    await d.getByRole('button', { name: 'Annuler' }).click();
    await expect(titreEntete(f)).toHaveValue('Beatles - Something');
    expect(await morceauEnregistre(page, 'Beatles - Something')).toBeTruthy();
  });
});

test.describe('Morceaux : la fiche, l\'en-tête (bug)', () => {
  test('le titre de l\'en-tête vers un nom déjà pris parle d\'un « morceau », comme les champs de la fiche @morceaux', async ({ ouvrirAppli }) => {
    test.fail(true, 'MZ-01 : la boîte « Ce nom existe déjà » de l\'en-tête d\'un morceau dit « Un exercice « … » existe déjà ici. » (les champs de la fiche et l\'ajout disent « Un morceau »)');
    const page = await ouvrirAppli({ etat: base() });
    await ouvrirMorceaux(page);
    await deplier(page, 'Beatles - Something');
    const f = ligneDepart(page, 'Beatles - Something');
    await titreEntete(f).fill('Muse - Hysteria');
    await titreEntete(f).press('Enter');
    await expect(boite(page)).toContainText('Un morceau « Muse - Hysteria » existe déjà ici.');
  });
});

test.describe('Morceaux : la fiche, les caractéristiques @morceaux', () => {
  test('menu « Style » : plusieurs choix, le menu reste ouvert, le bouton liste les valeurs cochées, l\'état est enregistré @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: base() });
    await ouvrirMorceaux(page);
    await deplier(page, 'Stevie Wonder - Superstition');
    const f = ligneDepart(page, 'Stevie Wonder - Superstition');
    await expect(boutonPropriete(f, 'Style')).toHaveAttribute('aria-label', 'Style : aucun (cliquer pour choisir)');
    await expect(boutonPropriete(f, 'Style')).toHaveText('Style');
    await ouvrirPropriete(f, 'Style');
    await valeurMenu(page, 'Funk').click();
    await expect(valeurMenu(page, 'Funk')).toHaveAttribute('aria-checked', 'true');
    await expect(menuPropriete(page)).toBeVisible();   // le menu reste ouvert pour cocher d'autres valeurs
    await valeurMenu(page, 'Jazz').click();
    await expect(valeurMenu(page, 'Jazz')).toHaveAttribute('aria-checked', 'true');
    await attendreMorceau(page, 'Stevie Wonder - Superstition', (m) => JSON.stringify(m.styles) === JSON.stringify(['Funk', 'Jazz']));
    await page.keyboard.press('Escape');
    await expect(menuPropriete(page)).toBeHidden();
    await expect(boutonPropriete(f, 'Style')).toHaveText('Funk, Jazz');
    await expect(boutonPropriete(f, 'Style')).toHaveAttribute('aria-label', 'Style : Funk, Jazz (cliquer pour choisir)');
    // On décoche.
    await ouvrirPropriete(f, 'Style');
    await valeurMenu(page, 'Funk').click();
    await expect(valeurMenu(page, 'Funk')).toHaveAttribute('aria-checked', 'false');
    await attendreMorceau(page, 'Stevie Wonder - Superstition', (m) => JSON.stringify(m.styles) === JSON.stringify(['Jazz']));
    await page.keyboard.press('Escape');
    await page.reload();
    await ouvrirMorceaux(page);
    await deplier(page, 'Stevie Wonder - Superstition');
    await expect(boutonPropriete(ligneDepart(page, 'Stevie Wonder - Superstition'), 'Style')).toHaveText('Jazz');
  });

  test('les valeurs du menu sont rangées de la plus utilisée à la moins utilisée (à égalité : l\'ordre du chapitre), avec le nombre de morceaux ; « Travail » garde l\'ordre du chapitre', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: base() });
    await ouvrirMorceaux(page);
    await deplier(page, 'Beatles - Something');
    const f = ligneDepart(page, 'Beatles - Something');
    await ouvrirPropriete(f, 'Style');
    expect(await valeursMenu(page)).toEqual(['Rock', 'Funk', 'Jazz']);   // Rock : 2 morceaux, Funk : 1, Jazz : 0
    await expect(valeurMenu(page, 'Rock').locator('.song-prop-count')).toHaveText('2');
    await expect(valeurMenu(page, 'Funk').locator('.song-prop-count')).toHaveText('1');
    await expect(valeurMenu(page, 'Jazz').locator('.song-prop-count')).toHaveText('');
    await page.keyboard.press('Escape');
    await ouvrirPropriete(f, 'Technique');
    expect(await valeursMenu(page)).toEqual(['Slap', 'Médiator']);   // Slap : 1 morceau, Médiator : 0, malgré l'ordre du vocabulaire
    await page.keyboard.press('Escape');
    await ouvrirPropriete(f, 'Travail');
    expect(await valeursMenu(page)).toEqual(['En cours', 'À maîtriser', 'Maîtrisé', 'Plus tard']);
  });

  test('menu « Travail » : un seul choix à la fois, le menu se ferme, re-choisir la valeur cochée la retire', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: base() });
    await ouvrirMorceaux(page);
    await deplier(page, 'Beatles - Something');
    const f = ligneDepart(page, 'Beatles - Something');
    await expect(boutonPropriete(f, 'Travail')).toHaveText('Travail');
    await ouvrirPropriete(f, 'Travail');
    await expect(valeurMenu(page, 'À maîtriser')).toHaveAttribute('role', 'menuitemradio');
    await valeurMenu(page, 'À maîtriser').click();
    await expect(menuPropriete(page)).toBeHidden();
    await attendreMorceau(page, 'Beatles - Something', (m) => m.work === 'À maîtriser');
    await expect(boutonPropriete(f, 'Travail')).toHaveText('À maîtriser');
    await ouvrirPropriete(f, 'Travail');
    await expect(valeurMenu(page, 'À maîtriser')).toHaveAttribute('aria-checked', 'true');
    await valeurMenu(page, 'Maîtrisé').click();   // une autre valeur remplace la première
    await attendreMorceau(page, 'Beatles - Something', (m) => m.work === 'Maîtrisé');
    await ouvrirPropriete(f, 'Travail');
    await valeurMenu(page, 'Maîtrisé').click();   // la même : retirée
    await attendreMorceau(page, 'Beatles - Something', (m) => m.work === '');
    await expect(boutonPropriete(f, 'Travail')).toHaveText('Travail');
  });

  test('« ＋ Nouveau style… » : la boîte de saisie ajoute la valeur au vocabulaire du chapitre ET la donne au morceau ; une valeur déjà connue (casse, accents) reprend sa graphie', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: base() });
    await ouvrirMorceaux(page);
    await deplier(page, 'Stevie Wonder - Superstition');
    const f = ligneDepart(page, 'Stevie Wonder - Superstition');
    await ouvrirPropriete(f, 'Style');
    await menuPropriete(page).getByRole('button', { name: '＋ Nouveau style…' }).click();
    await expect(boite(page)).toContainText('Nouveau style');
    await expect(boite(page).getByRole('textbox')).toHaveAttribute('placeholder', 'ex. Rock, Funk, Jazz');
    await repondre(page, 'Reggae');
    await attendreMorceau(page, 'Stevie Wonder - Superstition', (m) => JSON.stringify(m.styles) === JSON.stringify(['Reggae']));
    expect((await chapitreEnregistre(page)).vocab.styles).toEqual(['Rock', 'Funk', 'Jazz', 'Reggae']);
    await ouvrirPropriete(f, 'Style');
    await menuPropriete(page).getByRole('button', { name: '＋ Nouveau style…' }).click();
    await repondre(page, 'funk');   // « Funk » existe : pas de doublon
    await attendreMorceau(page, 'Stevie Wonder - Superstition', (m) => JSON.stringify(m.styles) === JSON.stringify(['Reggae', 'Funk']));
    expect((await chapitreEnregistre(page)).vocab.styles).toEqual(['Rock', 'Funk', 'Jazz', 'Reggae']);
  });

  test('« ＋ Nouvelle technique… » et « ＋ Nouvel état… » : mêmes boîtes, mêmes effets (le travail remplace l\'ancien état)', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: base() });
    await ouvrirMorceaux(page);
    await deplier(page, 'Beatles - Something');
    const f = ligneDepart(page, 'Beatles - Something');
    await ouvrirPropriete(f, 'Technique');
    await menuPropriete(page).getByRole('button', { name: '＋ Nouvelle technique…' }).click();
    await expect(boite(page).getByRole('textbox')).toHaveAttribute('placeholder', 'ex. Slap, Médiator, Accords');
    await repondre(page, 'Tapping');
    await attendreMorceau(page, 'Beatles - Something', (m) => JSON.stringify(m.techniques) === JSON.stringify(['Tapping']));
    await ouvrirPropriete(f, 'Travail');
    await menuPropriete(page).getByRole('button', { name: '＋ Nouvel état…' }).click();
    await expect(boite(page).getByRole('textbox')).toHaveAttribute('placeholder', 'ex. En cours');
    await repondre(page, 'À fignoler');
    await attendreMorceau(page, 'Beatles - Something', (m) => m.work === 'À fignoler');
    const ch = await chapitreEnregistre(page);
    expect(ch.vocab.techniques).toEqual(['Médiator', 'Slap', 'Tapping']);
    expect(ch.vocab.work).toEqual(['En cours', 'À maîtriser', 'Maîtrisé', 'Plus tard', 'À fignoler']);
  });

  test('sans aucune valeur au vocabulaire : le menu dit « Aucun style pour l\'instant. » et propose de créer', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(['Beatles - Something']) });
    await ouvrirMorceaux(page);
    await deplier(page, 'Beatles - Something');
    const f = ligneDepart(page, 'Beatles - Something');
    await ouvrirPropriete(f, 'Style');
    await expect(menuPropriete(page)).toContainText('Aucun style pour l\'instant.');
    await expect(menuPropriete(page).getByRole('button', { name: '＋ Nouveau style…' })).toBeVisible();
    await page.keyboard.press('Escape');
    await ouvrirPropriete(f, 'Technique');
    await expect(menuPropriete(page)).toContainText(/Aucune? technique pour l'instant\./);   // le genre : voir MZ-02 (valeurs.spec.ts)
    await expect(menuPropriete(page).getByRole('button', { name: /^＋ Nouvelle technique…$/ })).toBeVisible();
  });

  test('un morceau neuf n\'a pas d\'objectif tempo allumé ; la fiche offre liens, notes et métronome comme pour un exercice', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(['Beatles - Something']) });
    await ouvrirMorceaux(page);
    await deplier(page, 'Beatles - Something');
    const f = ligneDepart(page, 'Beatles - Something');
    await expect(f.getByRole('button', { name: /^Objectif tempo/ })).toHaveAttribute('aria-pressed', 'false');
    await expect(f.getByRole('button', { name: '＋ Note fixe' })).toBeVisible();
    await expect(f.getByRole('button', { name: '＋ Note mobile' })).toBeVisible();
    await expect(f.getByPlaceholder('Coller un lien…')).toBeVisible();
  });
});
