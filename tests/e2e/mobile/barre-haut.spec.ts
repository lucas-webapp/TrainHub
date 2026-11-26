// MODULE « mobile » — BARRE DU HAUT ET BARRE DES CHAPITRES au téléphone (≤ 700 px). Observé en boîte noire (playwright-cli, 26/11/2026) : la barre du haut (`.top-bar`, collante) a deux rangées
// (espace + compte, puis neuf icônes de 36 × 38 px) ; la barre des chapitres (`#chapter-bar`, collante aussi) remplace la colonne latérale et passe à la ligne. Les menus « Outils de musique » et « ⋯ »
// sont déjà éprouvés par leur contenu (`bibliotheque/annuler-retablir`, `outils`) : ici on vérifie qu'ils s'ouvrent au TOUCHER et tiennent dans l'écran.
import { test, expect } from '../support/fixtures';
import {
  ICONES, barreChapitres, barreHaut, bibliothequeLongue, bibliothequeNomsLongs, boutonHaut, commandesDehors, dansLEcran, hauteurEcran, largeurEcran, ouvrirTel, pastilles, sansDefilementHorizontal,
  serecouvrent, taille, toucher,
} from './aide-mobile';
import { chapitre, titreOuvert } from '../bibliotheque/aide-bibliotheque';

test.describe('Barre du haut au téléphone @mobile', () => {
  test('les neuf icônes et la ligne de l\'espace tiennent dans l\'écran, sans se recouvrir, avec une cible tactile d\'au moins 32 px @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirTel(ouvrirAppli);
    const boites: Array<{ nom: string; b: { x: number; y: number; width: number; height: number } }> = [];
    for (const nom of ICONES) {
      const bouton = boutonHaut(page, nom);
      await expect(bouton, nom).toBeVisible();
      await dansLEcran(page, bouton, nom);
      const t = await taille(bouton);
      expect.soft(t.l, `${nom} : largeur de la cible`).toBeGreaterThanOrEqual(32);
      expect.soft(t.h, `${nom} : hauteur de la cible`).toBeGreaterThanOrEqual(32);
      boites.push({ nom, b: (await bouton.boundingBox())! });
    }
    for (const sel of [page.getByRole('combobox', { name: 'Espace' }), page.getByRole('button', { name: 'Ajouter un espace' }), page.getByRole('button', { name: 'Renommer l\'espace' }), page.locator('#google-signin-btn, #account-info').first()]) {
      await expect(sel).toBeVisible();
      await dansLEcran(page, sel, 'ligne de l\'espace');
      const b = (await sel.boundingBox())!;
      expect.soft(b.height, 'ligne de l\'espace : hauteur de la cible').toBeGreaterThanOrEqual(30);
      boites.push({ nom: 'espace', b });
    }
    for (let i = 0; i < boites.length; i++) for (let j = i + 1; j < boites.length; j++) {
      expect(serecouvrent(boites[i].b, boites[j].b), `${boites[i].nom} et ${boites[j].nom} ne se recouvrent pas`).toBe(false);
    }
    await sansDefilementHorizontal(page);
  });

  test('chaque icône répond au TOUCHER (et non seulement au clic) : le panneau, le menu ou la barre promis s\'affiche @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirTel(ouvrirAppli);
    const cas: Array<[string, () => import('@playwright/test').Locator]> = [
      ['Session guidée', () => page.getByRole('button', { name: '+ Nouvelle session' })],
      ['Entraînement libre', () => page.locator('#free-bar')],
      ['Métronome', () => page.locator('.metronome-panel')],
      ['Enregistreur rapide', () => page.locator('.recorder-panel')],
      ['Lecteur audio', () => page.locator('.audio-panel')],
      ['Outils de musique', () => page.getByRole('menuitem', { name: 'Harmonie' })],
      ['Rechercher un exercice', () => page.getByPlaceholder(/^Rechercher un exercice/)],
      ['Plus d\'actions', () => page.getByRole('menuitem', { name: 'Corbeille' })],
      ['Paramètres', () => page.locator('.settings-panel')],
    ];
    expect(cas.map(([n]) => n)).toEqual(ICONES);
    for (const [nom, effet] of cas) {
      await page.reload();
      await expect(page.locator('#folder-container')).toBeAttached();
      await boutonHaut(page, nom).tap();
      await expect(effet(), `après un toucher sur « ${nom} »`).toBeVisible();
      await sansDefilementHorizontal(page, `« ${nom} » ouvert : pas de défilement horizontal`);
    }
  });

  test('les menus « Outils de musique » et « ⋯ » s\'ouvrent sous leur bouton, dans l\'écran, et se ferment en touchant à côté', async ({ ouvrirAppli }) => {
    const page = await ouvrirTel(ouvrirAppli);
    for (const [nom, entrees] of [['Outils de musique', ['Gammes et arpèges', 'Harmonie', 'Aides (cercle des quintes…)', 'Accordeur']], ['Plus d\'actions', ['Annuler', 'Rétablir', 'Corbeille']]] as const) {
      await boutonHaut(page, nom).tap();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem')).toHaveText([...entrees]);
      await dansLEcran(page, menu, `menu « ${nom} »`);
      const lignes = await menu.getByRole('menuitem').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
      for (const h of lignes) expect(h, 'hauteur d\'une entrée de menu').toBeGreaterThanOrEqual(30);
      const b = (await menu.boundingBox())!, bouton = (await boutonHaut(page, nom).boundingBox())!;
      expect(b.y, 'le menu s\'ouvre sous la barre d\'icônes').toBeGreaterThanOrEqual(bouton.y + bouton.height - 2);
      await page.touchscreen.tap(8, (await hauteurEcran(page)) - 8);   // un toucher hors du menu
      await expect(menu).toBeHidden();
    }
  });
});

const LONG_CHAPITRE = 'Un nom vraiment très long, pour vérifier que rien ne déborde de l\'écran du téléphone';

test.describe('Barre des chapitres au téléphone @mobile', () => {
  test('toucher une pastille ouvre le chapitre ; les pastilles passent à la ligne sans déborder ni défiler @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirTel(ouvrirAppli, bibliothequeLongue(3));
    await expect(pastilles(page)).toHaveText(['Favoris', 'Technique', 'Gammes', 'Improvisation', 'Jeu en groupe', 'Copie de morceaux', 'Archivés']);
    expect(await commandesDehors(page, barreChapitres(page))).toEqual([]);
    for (const nom of ['Gammes', 'Copie de morceaux', 'Technique']) {
      await toucher(chapitre(page, nom));
      await expect(titreOuvert(page)).toHaveText(nom);
      await expect(chapitre(page, nom)).toHaveClass(/\bactive\b/);
    }
    for (const p of await pastilles(page).all()) {
      const t = await taille(p);
      expect.soft(t.h, `pastille « ${(await p.textContent())!.trim()} » : hauteur`).toBeGreaterThanOrEqual(28);
    }
    await sansDefilementHorizontal(page);
  });

  test('beaucoup de chapitres aux noms longs : la barre reste dans la largeur, la dernière pastille se touche, la page ne déborde pas', async ({ ouvrirAppli }) => {
    const chapitres = Array.from({ length: 14 }, (_, i) => ({ nom: i % 3 === 0 ? `Un chapitre au nom assez long numéro ${i + 1}` : `Chapitre ${i + 1}`, exercices: [`Exo du chapitre ${i + 1}`] }));
    const { etatBibliotheque } = await import('../bibliotheque/aide-bibliotheque');
    const page = await ouvrirTel(ouvrirAppli, etatBibliotheque([{ nom: 'Basse', chapitres }]));
    expect(await commandesDehors(page, barreChapitres(page))).toEqual([]);
    await sansDefilementHorizontal(page);
    const derniere = page.locator('#chapter-bar .chapter-chip.virtual-archived');
    await derniere.scrollIntoViewIfNeeded();
    await expect(derniere).toBeInViewport();
    await toucher(derniere);
    await expect(derniere).toHaveClass(/\bactive\b/);
    // Les noms longs s'adaptent à la largeur (retour à la ligne ou points de suspension), jamais plus large que l'écran.
    const l = await largeurEcran(page);
    for (const p of await pastilles(page).all()) expect((await p.boundingBox())!.width).toBeLessThanOrEqual(l);
  });

  test('un chapitre, un dossier et un exercice aux noms très longs ne font pas déborder la page @critique', async ({ ouvrirAppli }) => {
    const { etatBibliotheque } = await import('../bibliotheque/aide-bibliotheque');
    const page = await ouvrirTel(ouvrirAppli, etatBibliotheque([{ nom: 'Basse', chapitres: [
      { nom: LONG_CHAPITRE, exercices: [LONG_CHAPITRE + ' (exercice)', 'Court'], dossiers: [{ nom: LONG_CHAPITRE + ' (dossier)', exercices: ['Dedans'] }] }, { nom: 'Autre chapitre au nom long, lui aussi', exercices: ['x'] }] }]));
    await sansDefilementHorizontal(page, 'accueil');
    expect(await commandesDehors(page, barreHaut(page))).toEqual([]);
    await toucher(chapitre(page, LONG_CHAPITRE));
    await expect(page.locator('#folder-container .folder-row').first()).toBeVisible();
    await sansDefilementHorizontal(page, 'chapitre au nom long');
    expect(await commandesDehors(page, page.locator('#folder-container'))).toEqual([]);
    await toucher(page.locator('#folder-container .folder-row').first());
    await expect(page.locator('#breadcrumb')).toContainText('(dossier)');
    await sansDefilementHorizontal(page, 'dossier au nom long');
    expect(await commandesDehors(page, page.locator('#folder-container'))).toEqual([]);
    expect(await commandesDehors(page, page.locator('#breadcrumb'))).toEqual([]);
  });

  // MO-02 (mineur) : une pastille de chapitre est haute de 30 px ; un nom de deux lignes déborde du cadre (texte par-dessus la bordure).
  test('le nom d\'un chapitre très long reste dans le cadre de sa pastille', async ({ ouvrirAppli }) => {
    test.fail(true, 'MO-02 : le nom long d\'un chapitre passe à la ligne mais la pastille garde 30 px de haut : le texte déborde sur la bordure.');
    const page = await ouvrirTel(ouvrirAppli, bibliothequeNomsLongs());
    const p = chapitre(page, LONG_CHAPITRE);
    const [cadre, texte] = [(await p.boundingBox())!, (await p.locator('.chapter-chip-label').boundingBox())!];
    expect(texte.y, 'haut du texte').toBeGreaterThanOrEqual(cadre.y - 1);
    expect(texte.y + texte.height, 'bas du texte').toBeLessThanOrEqual(cadre.y + cadre.height + 1);
  });

  // MO-03 (mineur, WebKit) : la liste des espaces prend la largeur de son plus long nom (« UN ESPACE AU NOM TRÈS LONG… ») : le contenu de la barre du haut est coupé à l'écran
  // mais la page devient plus large que l'écran (551 px pour 393) et se laisse faire glisser de côté.
  test('un espace au nom très long ne rend pas la page plus large que l\'écran', async ({ ouvrirAppli, browserName }) => {
    test.fail(browserName === 'webkit', 'MO-03 : sous WebKit, la liste des espaces au nom très long élargit la barre du haut (scrollWidth 551 pour 393).');
    const page = await ouvrirTel(ouvrirAppli, bibliothequeNomsLongs());
    await dansLEcran(page, page.getByRole('combobox', { name: 'Espace' }), 'liste des espaces', { hauteur: false });
    await sansDefilementHorizontal(page, 'barre du haut avec un espace au nom long');
    await page.evaluate(() => window.scrollTo(300, 0));
    expect(await page.evaluate(() => window.scrollX), 'la page ne glisse pas de côté').toBe(0);
  });
});

test.describe('Place prise par les barres collantes au téléphone @mobile', () => {
  test('avec les cinq chapitres de l\'utilisateur, les deux barres du haut laissent au moins 60 % de la hauteur à la liste @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirTel(ouvrirAppli, bibliothequeLongue(20));
    const h = await hauteurEcran(page);
    const bas = await page.evaluate(() => Math.max(...['.top-bar', '#chapter-bar'].map((s) => document.querySelector(s)!.getBoundingClientRect().bottom)));
    expect(bas / h, `barres du haut : ${Math.round(bas)} px sur ${h}`).toBeLessThanOrEqual(0.4);
    // la première ligne d'exercice est visible sans défiler
    await toucher(chapitre(page, 'Technique'));
    await expect(page.locator('#folder-container .exercise').first()).toBeInViewport();
  });

  // MO-01 (mineur) : la barre des chapitres est collante en `top: 0` alors que la barre du haut, collante aussi, la recouvre : après un défilement, seule une bande de ~23 px, aux pastilles coupées en deux,
  // dépasse sous la barre du haut. Attendu : barre des chapitres entièrement visible sous la barre du haut, ou entièrement masquée.
  test('après un défilement, la barre des chapitres n\'est jamais coupée en deux sous la barre du haut', async ({ ouvrirAppli }) => {
    test.fail(true, 'MO-01 : la barre des chapitres glisse sous la barre du haut et n\'en laisse voir qu\'une bande coupée (~23 px).');
    const page = await ouvrirTel(ouvrirAppli, bibliothequeLongue(30));
    await toucher(chapitre(page, 'Technique'));
    await page.evaluate(() => window.scrollTo(0, 900));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    const m = await page.evaluate(() => {
      const haut = document.querySelector('.top-bar')!.getBoundingClientRect(), ch = document.querySelector('#chapter-bar')!.getBoundingClientRect();
      return { hautBas: haut.bottom, chTop: ch.top, chBottom: ch.bottom, chHauteur: ch.height };
    });
    const visible = Math.max(0, m.chBottom - Math.max(m.chTop, m.hautBas));   // partie de la barre des chapitres qui n'est pas sous la barre du haut
    expect(visible === 0 || visible >= m.chHauteur - 1, `partie visible de la barre des chapitres : ${Math.round(visible)} px sur ${Math.round(m.chHauteur)}`).toBe(true);
  });

  test('la fenêtre de l\'appli est adaptée au téléphone : largeur de l\'appareil, échelle 1, pas de zoom accidentel au double toucher', async ({ ouvrirAppli }) => {
    const page = await ouvrirTel(ouvrirAppli);
    const meta = await page.evaluate(() => document.querySelector('meta[name=viewport]')?.getAttribute('content') ?? '');
    expect(meta).toContain('width=device-width');
    expect(meta).toContain('initial-scale=1');
    // Observé : maximum-scale=1 et user-scalable=no (la page ne se zoome pas au pincement et les champs de moins de 16 px ne déclenchent pas le zoom automatique d'iOS).
    expect(meta).toContain('maximum-scale=1');
    const zoom0 = await page.evaluate(() => window.visualViewport!.scale);
    const pastille = chapitre(page, 'Technique'), b = (await pastille.boundingBox())!;
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);   // deux touchers rapprochés au même endroit
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(zoom0);
    expect(zoom0).toBe(1);
  });
});
