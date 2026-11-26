// MODULE « morceaux » — AJOUTER un morceau. Observé en boîte noire (playwright-cli, 26/11/2026) : deux champs « Artiste » (avec liste de complétion des artistes connus) et « Titre du morceau », le bouton « + »
// et Entrée valident ; le titre affiché est toujours « Artiste - Titre » ; la fiche du nouveau morceau s'ouvre aussitôt (un seul morceau ouvert) avec le message « … ajouté : complète sa fiche. » ;
// l'artiste saisi reste dans son champ pour enchaîner (rafale d'un même artiste) ; « Artiste - Titre » collé dans un seul champ est réparti ; un artiste déjà connu garde sa graphie (casse, accents).
import { test, expect } from '../support/fixtures';
import { ligne } from '../bibliotheque/aide-bibliotheque';
import {
  ajouterMorceau, attendreMorceau, attendreMorceaux, boite, boutonAjouter, champArtiste, champTitreAjout, champsArtiste, champsTitre, chapitreEnregistre, choisirVue, dossierCalcule, dossiersCalcules,
  etatMorceaux, message, morceauEnregistre, nomsDossiers, options, ouvrirDossierCalcule, ouvrirMorceaux, titresEnregistres, titresMorceaux, ligneDepart, titreEntete, effectif,
} from './aide-morceaux';

test.describe('Morceaux : ajouter @morceaux', () => {
  test('artiste + titre + Entrée : le morceau « Artiste - Titre » est créé, sa fiche s\'ouvre, le message invite à la compléter, tout reste après rechargement @critique', async ({ ouvrirAppli, garde }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux([]) });
    await ouvrirMorceaux(page);
    await expect(page.locator('#folder-container .songs-wrap .gs-empty')).toHaveText('Aucun morceau pour l\'instant : ajoute le premier ci-dessous (artiste, puis titre).');
    await expect(effectif(page)).toHaveText('0 morceau');
    await ajouterMorceau(page, 'Beatles', 'Something');
    const m = await attendreMorceau(page, 'Beatles - Something', () => true);
    expect(m).toMatchObject({ isSong: true, artist: 'Beatles', songName: 'Something', title: 'Beatles - Something', styles: [], techniques: [], work: '', favorite: false, archived: false });
    expect(m.collapsed).toBe(false);   // sa fiche s'est ouverte
    const f = await ligne(page, 'Beatles - Something');
    await expect(f).not.toHaveClass(/collapsed/);
    await expect(titreEntete(f)).toHaveValue('Beatles - Something');
    await expect(champsArtiste(f)).toHaveValue('Beatles');
    await expect(champsTitre(f)).toHaveValue('Something');
    await expect(message(page, '« Beatles - Something » ajouté : complète sa fiche.')).toBeVisible();
    await expect(effectif(page)).toHaveText('1 morceau');
    // Les champs d'ajout : le titre est vidé, l'artiste est gardé pour le morceau suivant.
    await expect(champTitreAjout(page)).toHaveValue('');
    await expect(champArtiste(page)).toHaveValue('Beatles');

    await page.reload();
    await ouvrirMorceaux(page);
    await expect(page.locator('#folder-container .exercise-title')).toHaveValue('Beatles - Something');
    expect(await titresEnregistres(page)).toEqual(['Beatles - Something']);
    expect(garde.bloquees).toEqual([]);
  });

  test('le bouton « + » ajoute comme Entrée ; deux cases vides ou faites d\'espaces ne créent rien', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux([]) });
    await ouvrirMorceaux(page);
    await champArtiste(page).fill('   ');
    await champTitreAjout(page).fill('   ');
    await boutonAjouter(page).click();
    await champTitreAjout(page).press('Enter');
    await expect(page.locator('#folder-container .exercise-title')).toHaveCount(0);
    expect(await titresEnregistres(page)).toEqual([]);
    await champArtiste(page).fill('Queen');
    await champTitreAjout(page).fill('Under Pressure');
    await boutonAjouter(page).click();
    await attendreMorceau(page, 'Queen - Under Pressure', () => true);
    expect(await titresEnregistres(page)).toEqual(['Queen - Under Pressure']);
    // Entrée sans rien du tout : rien non plus.
    await champArtiste(page).fill('');
    await champTitreAjout(page).fill('');
    await champTitreAjout(page).press('Enter');
    await expect(message(page, 'ajouté')).toHaveCount(1);
    expect(await titresEnregistres(page)).toEqual(['Queen - Under Pressure']);
  });

  test('« + » avec seulement la case de l\'artiste remplie : ce qui est écrit devient le titre d\'un morceau sans artiste', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux([]) });
    await ouvrirMorceaux(page);
    await champArtiste(page).fill('Queen');
    await boutonAjouter(page).click();
    const m = await attendreMorceau(page, 'Queen', () => true);
    expect(m).toMatchObject({ artist: '', songName: 'Queen' });
  });

  test('« Artiste - Titre » saisi dans la case de l\'artiste est réparti dans les deux cases, le curseur passe dans la case du titre', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux([]) });
    await ouvrirMorceaux(page);
    await champArtiste(page).fill('Muse - Hysteria');
    await expect(champArtiste(page)).toHaveValue('Muse');
    await expect(champTitreAjout(page)).toHaveValue('Hysteria');
    await expect(champTitreAjout(page)).toBeFocused();
    await champTitreAjout(page).press('Enter');
    const m = await attendreMorceau(page, 'Muse - Hysteria', () => true);
    expect(m).toMatchObject({ artist: 'Muse', songName: 'Hysteria' });
  });

  test('« Artiste - Titre » saisi dans la case du titre est réparti de la même façon', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux([]) });
    await ouvrirMorceaux(page);
    await champTitreAjout(page).fill('Daft Punk - Get Lucky');
    await expect(champArtiste(page)).toHaveValue('Daft Punk');
    await expect(champTitreAjout(page)).toHaveValue('Get Lucky');
    await boutonAjouter(page).click();
    const m = await attendreMorceau(page, 'Daft Punk - Get Lucky', () => true);
    expect(m).toMatchObject({ artist: 'Daft Punk', songName: 'Get Lucky' });
  });

  test('Entrée dans la case de l\'artiste : passe au titre ; si l\'artiste est « Artiste - Titre », ajoute directement', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux([]) });
    await ouvrirMorceaux(page);
    await champArtiste(page).fill('Toto');
    await champArtiste(page).press('Enter');
    await expect(champTitreAjout(page)).toBeFocused();
    expect(await titresEnregistres(page)).toEqual([]);
    await champTitreAjout(page).fill('Africa');
    await champArtiste(page).press('Enter');   // les deux cases sont remplies : Entrée dans l'artiste ajoute
    await attendreMorceau(page, 'Toto - Africa', () => true);
  });

  test('un titre sans artiste est un morceau sans artiste : son titre est le titre seul', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux([]) });
    await ouvrirMorceaux(page);
    await champTitreAjout(page).fill('Impro en mi');
    await champTitreAjout(page).press('Enter');
    const m = await attendreMorceau(page, 'Impro en mi', () => true);
    expect(m).toMatchObject({ artist: '', songName: 'Impro en mi', title: 'Impro en mi' });
    // Un titre seul dans la case de l'artiste devient aussi le titre.
    await champArtiste(page).fill('Solo de basse');
    await champArtiste(page).press('Enter');   // artiste non vide, titre vide, pas de tiret : Entrée va au titre
    await expect(champTitreAjout(page)).toBeFocused();
  });

  test('rafale : l\'artiste reste, on enchaîne trois morceaux du même artiste ; il y en a alors un dossier « Beatles » de 3 @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux([]) });
    await ouvrirMorceaux(page);
    await ajouterMorceau(page, 'Beatles', 'Help');
    await attendreMorceau(page, 'Beatles - Help', () => true);
    for (const t of ['Yesterday', 'Michelle']) {
      await expect(champArtiste(page)).toHaveValue('Beatles');
      await champTitreAjout(page).fill(t);
      await champTitreAjout(page).press('Enter');
      await attendreMorceau(page, `Beatles - ${t}`, () => true);
    }
    expect(await titresEnregistres(page)).toEqual(['Beatles - Help', 'Beatles - Yesterday', 'Beatles - Michelle']);
    // Dès le 2ᵉ morceau, la vue Artistes range les morceaux dans un dossier au nom de l'artiste : l'écran reste sur la page où se trouve le dernier morceau.
    await expect(page.locator('#breadcrumb .crumb-current')).toHaveText('Beatles');
    await expect(page.locator('#folder-container .exercise-title')).toHaveCount(3);
    await ouvrirMorceaux(page);
    expect(await nomsDossiers(page)).toEqual(['Beatles']);
  });

  test('un artiste déjà connu garde sa graphie : « beatles » devient « Beatles », « beyoncé » reste « Beyoncé » même tapé « beyonce »', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(['Beatles - Help', 'Beyoncé - Halo']) });
    await ouvrirMorceaux(page);
    await ajouterMorceau(page, 'beatles', 'Michelle');
    await attendreMorceau(page, 'Beatles - Michelle', (m) => m.artist === 'Beatles');
    await ouvrirMorceaux(page);
    await champArtiste(page).fill('beyonce');
    await champTitreAjout(page).fill('Crazy in Love');
    await champTitreAjout(page).press('Enter');
    await attendreMorceau(page, 'Beyoncé - Crazy in Love', (m) => m.artist === 'Beyoncé');
  });

  test('la liste de complétion de la case « Artiste » propose les artistes connus, triés sans « The » ni accent, sans doublon', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(['The Doors - Roadhouse Blues', 'Beatles - Help', 'Beatles - Michelle', 'Étienne Daho - Week-end à Rome', 'Cure - Lullaby']) });
    await ouvrirMorceaux(page);
    await expect(champArtiste(page)).toHaveAttribute('list', 'song-artists-list');
    await expect.poll(async () => options(page).evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))).toEqual(['Beatles', 'Cure', 'The Doors', 'Étienne Daho']);
  });

  test('un titre déjà pris dans le chapitre : la boîte « Ce nom existe déjà » ; « Ajouter quand même » crée le doublon, Annuler n\'ajoute rien', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(['Beatles - Help']) });
    await ouvrirMorceaux(page);
    await ajouterMorceau(page, 'beatles', 'HELP');   // même titre à la casse près
    const d = boite(page);
    await expect(d).toBeVisible();
    await expect(d).toContainText('Ce nom existe déjà');
    await expect(d).toContainText('Un morceau « Beatles - HELP » existe déjà ici.');
    await d.getByRole('button', { name: 'Annuler' }).click();
    await expect(d).toBeHidden();
    expect(await titresEnregistres(page)).toEqual(['Beatles - Help']);
    await champTitreAjout(page).press('Enter');
    await boite(page).getByRole('button', { name: 'Ajouter quand même' }).click();
    await expect.poll(() => titresEnregistres(page)).toEqual(['Beatles - Help', 'Beatles - HELP']);
  });

  test('ajouter depuis un dossier calculé : dans un dossier d\'artiste l\'artiste est prérempli ; dans un style, le morceau reçoit ce style ; dans un état de travail, cet état', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux([
      { titre: 'Beatles - Help', styles: ['Rock'], travail: 'En cours' }, { titre: 'Beatles - Michelle', styles: ['Rock'] }, 'Muse - Hysteria',
    ], { vocab: { styles: ['Rock', 'Funk'] } }) });
    await ouvrirMorceaux(page);
    // Dossier d'artiste.
    await ouvrirDossierCalcule(page, 'Beatles');
    await expect(champArtiste(page)).toHaveValue('Beatles');
    await champTitreAjout(page).fill('Yesterday');
    await champTitreAjout(page).press('Enter');
    await attendreMorceau(page, 'Beatles - Yesterday', (m) => m.artist === 'Beatles' && m.styles.length === 0);
    // Dossier de style.
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Styles');
    await ouvrirDossierCalcule(page, 'Funk');
    await ajouterMorceau(page, 'Stevie Wonder', 'Superstition');
    await attendreMorceau(page, 'Stevie Wonder - Superstition', (m) => m.styles.length === 1 && m.styles[0] === 'Funk');
    // Dossier de travail.
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Travail');
    await ouvrirDossierCalcule(page, 'Maîtrisé');
    await ajouterMorceau(page, 'Muse', 'Uprising');
    await attendreMorceau(page, 'Muse - Uprising', (m) => m.work === 'Maîtrisé');
  });

  test('le message dit dans quel dossier le nouveau morceau est rangé quand ce n\'est pas la page affichée', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(['Beatles - Help', 'Muse - Hysteria']) });
    await ouvrirMorceaux(page);
    // Vue Artistes, page du chapitre : un 2ᵉ morceau de Beatles crée le dossier « Beatles », où le morceau est rangé.
    await ajouterMorceau(page, 'Beatles', 'Michelle');
    await expect(message(page, '« Beatles - Michelle » ajouté dans « Beatles » : complète sa fiche.')).toBeVisible();
    await expect(page.locator('#breadcrumb .crumb-current')).toHaveText('Beatles');
  });

  test('un morceau ajouté referme la fiche ouverte d\'un autre : une seule fiche ouverte à la fois', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux([{ titre: 'Muse - Hysteria', deploye: true }]) });
    await ouvrirMorceaux(page);
    await expect(ligneDepart(page, 'Muse - Hysteria')).not.toHaveClass(/collapsed/);
    await ajouterMorceau(page, 'Toto', 'Africa');
    await attendreMorceau(page, 'Toto - Africa', (m) => m.collapsed === false);
    await expect(ligneDepart(page, 'Muse - Hysteria')).toHaveClass(/collapsed/);
    await expect.poll(async () => (await morceauEnregistre(page, 'Muse - Hysteria')).collapsed).toBe(true);
  });

  test('un morceau ajouté est dans le chapitre de morceaux, pas dans « Technique » ; l\'effectif de la colonne et celui de la barre suivent', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(['Beatles - Help'], { exercices: ['Gamme'] }) });
    await ouvrirMorceaux(page);
    await ajouterMorceau(page, 'Queen', 'Bohemian Rhapsody');
    await attendreMorceau(page, 'Queen - Bohemian Rhapsody', () => true);
    const tech = await chapitreEnregistre(page, 'Technique');
    expect(tech.exercises.map((e: any) => e.title)).toEqual(['Gamme']);
    await expect(effectif(page)).toHaveText('2 morceaux');
    expect(await dossiersCalcules(page).count()).toBe(0);   // 2 artistes différents : aucun dossier
  });
});
