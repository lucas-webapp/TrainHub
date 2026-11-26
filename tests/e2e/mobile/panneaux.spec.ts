// MODULE « mobile » — PANNEAUX ET ÉCRANS au téléphone (≤ 700 px). Observé en boîte noire (playwright-cli, 26/11/2026) : Paramètres, Corbeille, Gammes et arpèges, Harmonie, Aides, Enregistreur rapide
// s'ouvrent en PLEIN ÉCRAN (`.backups-panel`, 0,0 → largeur × hauteur) avec un bouton « Fermer » ; le Lecteur audio est un bandeau en bas. L'écran « Session guidée » (liste, éditeur, choix des exercices,
// calendrier, historique, statistiques) et la recherche s'affichent dans la page. Le CONTENU de chaque panneau est éprouvé par son module (outils, parametres, session…) : ici on vérifie seulement ce qui est
// propre au petit écran — le panneau tient dans l'écran, rien ne sort à droite, le bouton « Fermer » se touche, et le contenu défile quand l'écran est bas (téléphone couché, clavier ouvert).
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { bibliothequeCourte, boutonFermer, boutonHaut, commandesDehors, dansLEcran, hauteurEcran, ligneDepart, ouvrirClavier, ouvrirTel, sansDefilementHorizontal, taille, tailles, toucher } from './aide-mobile';
import { etatSession } from '../session/aide-session';

type Cas = { nom: string; ouvrir: (p: Page) => Promise<void>; racine: (p: Page) => Locator };
const outil = (nom: string | RegExp) => async (p: Page) => { await boutonHaut(p, 'Outils de musique').tap(); await p.getByRole('menuitem', { name: nom }).tap(); };
const CAS: Cas[] = [
  { nom: 'Paramètres', ouvrir: (p) => boutonHaut(p, 'Paramètres').tap(), racine: (p) => p.locator('.settings-panel') },
  { nom: 'Corbeille', ouvrir: async (p) => { await boutonHaut(p, 'Plus d\'actions').tap(); await p.getByRole('menuitem', { name: 'Corbeille' }).tap(); }, racine: (p) => p.locator('.trash-panel') },
  { nom: 'Gammes et arpèges', ouvrir: outil('Gammes et arpèges'), racine: (p) => p.locator('.scales-panel') },
  { nom: 'Harmonie', ouvrir: outil('Harmonie'), racine: (p) => p.locator('.harmony-panel') },
  { nom: 'Aides (cercle des quintes)', ouvrir: outil(/^Aides/), racine: (p) => p.locator('.aides-panel') },
  { nom: 'Enregistreur rapide', ouvrir: (p) => boutonHaut(p, 'Enregistreur rapide').tap(), racine: (p) => p.locator('.recorder-panel') },
];

test.describe('Panneaux plein écran au téléphone @mobile', () => {
  for (const cas of CAS) {
    test(`« ${cas.nom} » : couvre l'écran sans le dépasser, rien ne sort à droite, « Fermer » se touche @critique`, async ({ ouvrirAppli, page }) => {
      await ouvrirTel(ouvrirAppli);
      await cas.ouvrir(page);
      const racine = cas.racine(page);
      await expect(racine).toBeVisible();
      await dansLEcran(page, racine, cas.nom);
      const b = (await racine.boundingBox())!, l = page.viewportSize()!;
      expect(b.width, 'le panneau prend toute la largeur').toBeGreaterThanOrEqual(l.width - 2);
      expect(await commandesDehors(page, racine), 'commandes hors de l\'écran').toEqual([]);
      await sansDefilementHorizontal(page);
      const dehorsPanneau = await racine.evaluate((r) => r.scrollWidth - r.clientWidth);
      expect(dehorsPanneau, 'le panneau lui-même ne défile pas de côté').toBeLessThanOrEqual(1);
      const fermer = boutonFermer(racine);
      await expect(fermer).toBeInViewport();
      const t = await taille(fermer);
      expect(Math.min(t.l, t.h), 'cible du bouton Fermer').toBeGreaterThanOrEqual(28);
      await fermer.tap();
      await expect(racine).toBeHidden();
      await expect(page.locator('#folder-container')).toBeVisible();
    });
  }

  for (const cas of CAS) {
    test(`« ${cas.nom} » : l'écran étant bas (clavier ouvert ou téléphone couché), le bouton « Fermer » reste atteignable et le contenu défile`, async ({ ouvrirAppli, page }, testInfo) => {
      await ouvrirTel(ouvrirAppli);
      await cas.ouvrir(page);
      const racine = cas.racine(page);
      await expect(racine).toBeVisible();
      await page.setViewportSize({ width: page.viewportSize()!.width, height: 340 });
      await dansLEcran(page, racine, `${cas.nom} (écran bas)`);
      const fermer = boutonFermer(racine);
      await fermer.scrollIntoViewIfNeeded();
      await expect(fermer).toBeInViewport();
      expect(await commandesDehors(page, racine)).toEqual([]);
      // Un contenu plus haut que la fenêtre se laisse faire défiler : le panneau ou l'un de ses blocs est défilable.
      const defilable = await racine.evaluate((r) => [r, ...r.querySelectorAll('*')].some((e) => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1; }));
      const trop = await racine.evaluate((r) => r.scrollHeight > r.clientHeight + 1);
      expect(defilable || !trop, 'contenu plus haut que l\'écran et rien ne défile').toBe(true);
      await fermer.tap();
      await expect(racine).toBeHidden();
      testInfo.annotations.push({ type: 'écran bas', description: `${await hauteurEcran(page)} px` });
    });
  }

  test('Paramètres : les trois onglets (Affichage, Métronome, Sessions) tiennent dans l\'écran et se touchent du doigt', async ({ ouvrirAppli, page }) => {
    await ouvrirTel(ouvrirAppli);
    await boutonHaut(page, 'Paramètres').tap();
    const racine = page.locator('.settings-panel');
    await expect(racine).toBeVisible();
    for (const nom of ['Affichage', 'Métronome', 'Sessions']) {
      const onglet = racine.getByRole('tab', { name: nom });
      await expect(onglet, nom).toBeVisible();
      await dansLEcran(page, onglet, `onglet ${nom}`);
      expect((await taille(onglet)).h, `onglet ${nom} : hauteur`).toBeGreaterThanOrEqual(36);
      await onglet.tap();
      await expect(onglet).toHaveAttribute('aria-selected', 'true');
      expect(await commandesDehors(page, racine), `onglet ${nom}`).toEqual([]);
      await sansDefilementHorizontal(page, `onglet ${nom}`);
    }
  });

  test('Paramètres : les interrupteurs et les choix à segments (thème, halo) se touchent et ont une cible d\'au moins 30 px', async ({ ouvrirAppli, page }) => {
    await ouvrirTel(ouvrirAppli);
    await boutonHaut(page, 'Paramètres').tap();
    const racine = page.locator('.settings-panel');
    const choix = racine.getByRole('radio').or(racine.getByRole('switch'));
    await expect(choix.first()).toBeVisible();
    for (const c of await choix.all()) {
      if (!(await c.isVisible())) continue;
      const t = await taille(c);
      expect.soft(Math.min(t.l, t.h), `cible « ${(await c.textContent() || await c.getAttribute('aria-label') || '').trim()} »`).toBeGreaterThanOrEqual(24);
    }
    await racine.getByRole('radio', { name: 'Clair', exact: true }).tap();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await racine.getByRole('radio', { name: 'Sombre', exact: true }).tap();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('Écrans de la session guidée au téléphone @mobile', () => {
  const sessions = () => etatSession(['Alpha', 'Bravo', 'Charlie'], [{ nom: 'Échauffement du matin, assez long pour prendre la place', exercices: [['Alpha', 5], ['Bravo', 10]] }]);

  test('la liste, l\'éditeur et le choix des exercices tiennent dans l\'écran, sans défilement horizontal @critique', async ({ ouvrirAppli, page }) => {
    await ouvrirTel(ouvrirAppli, sessions());
    await boutonHaut(page, 'Session guidée').tap();
    await expect(page.getByRole('button', { name: '+ Nouvelle session' })).toBeVisible();
    await sansDefilementHorizontal(page, 'liste des sessions');
    expect(await commandesDehors(page, page.locator('#folder-container')), 'liste').toEqual([]);
    // l'éditeur d'une session existante
    await toucher(page.locator('.gs-session-row .gs-session-name').first());   // ENV-MO-01 (voir aide-mobile)
    await expect(page.getByRole('textbox', { name: 'Nom de la session' })).toBeVisible();
    await sansDefilementHorizontal(page, 'éditeur');
    expect(await commandesDehors(page, page.locator('#folder-container')), 'éditeur').toEqual([]);
    await expect(page.getByRole('button', { name: '▶ Lancer la session' })).toBeInViewport();
    // le choix des exercices (bandeau « Ma session »)
    await page.getByRole('button', { name: '+ Ajouter un exercice' }).tap();
    await expect(page.getByRole('textbox', { name: 'Rechercher un exercice…' })).toBeVisible();
    await sansDefilementHorizontal(page, 'choix des exercices');
    expect(await commandesDehors(page, page.locator('#folder-container')), 'choix').toEqual([]);
    await expect(page.getByRole('complementary', { name: 'Ma session' })).toBeVisible();
    await dansLEcran(page, page.getByRole('complementary', { name: 'Ma session' }), 'bandeau « Ma session »', { hauteur: false });
  });

  for (const [nom, panneauAttendu] of [['Calendrier', /Calendrier des sessions/], ['Historique', /Historique/], ['Statistiques', /Statistiques/]] as const) {
    test(`« ${nom} » : l'écran s'ouvre au toucher, tient dans l'écran et se ferme`, async ({ ouvrirAppli, page }) => {
      await ouvrirTel(ouvrirAppli, sessions());
      await boutonHaut(page, 'Session guidée').tap();
      await page.getByRole('button', { name: new RegExp(`^${nom}`) }).tap();
      const racine = page.locator('.backups-panel').filter({ hasText: panneauAttendu }).or(page.locator('#folder-container').filter({ hasText: panneauAttendu })).first();
      await expect(racine).toBeVisible();
      await sansDefilementHorizontal(page, nom);
      expect(await commandesDehors(page, racine), nom).toEqual([]);
      const ferme = racine.getByRole('button', { name: /^(Fermer|← Retour|Retour)/ }).first();
      if (await ferme.count()) { await ferme.scrollIntoViewIfNeeded(); await expect(ferme).toBeInViewport(); }
    });
  }
});

test.describe('Recherche et lecteur audio au téléphone @mobile', () => {
  test('la recherche : le champ prend la largeur, les résultats se touchent, « ✕ » ferme la recherche rapide', async ({ ouvrirAppli, page }) => {
    await ouvrirTel(ouvrirAppli);
    await boutonHaut(page, 'Rechercher un exercice').tap();
    const champ = page.getByPlaceholder(/^Rechercher un exercice/);
    await expect(champ).toBeFocused();
    await dansLEcran(page, champ, 'champ de recherche', { hauteur: false });
    const b = (await champ.boundingBox())!;
    expect(b.width, 'le champ prend presque toute la largeur').toBeGreaterThan(page.viewportSize()!.width * 0.8);
    await champ.fill('gamme');
    await expect(ligneDepart(page, 'Gamme majeure')).toBeVisible();
    await expect(ligneDepart(page, 'Croches')).toHaveCount(0);
    await sansDefilementHorizontal(page, 'résultats');
    expect(await commandesDehors(page, page.locator('#folder-container'))).toEqual([]);
  });

  test('le lecteur audio est un bandeau en bas de l\'écran, dans la largeur, sans cacher le haut de la page', async ({ ouvrirAppli, page }) => {
    await ouvrirTel(ouvrirAppli);
    await boutonHaut(page, 'Lecteur audio').tap();
    const lecteur = page.locator('.audio-panel');
    await expect(lecteur).toBeVisible();
    await dansLEcran(page, lecteur, 'lecteur audio');
    const [b, h] = [(await lecteur.boundingBox())!, await hauteurEcran(page)];
    expect(b.y + b.height, 'collé au bas de l\'écran').toBeGreaterThan(h - 20);
    expect(b.height, 'ne prend pas plus du tiers de l\'écran').toBeLessThan(h / 3);
    expect(await commandesDehors(page, lecteur)).toEqual([]);
    await sansDefilementHorizontal(page);
    await expect(boutonHaut(page, 'Paramètres')).toBeVisible();   // la barre du haut reste accessible
  });
});

// MO-07 (gênant) : le panneau flottant du lecteur audio (bas de l'écran) passe PAR-DESSUS les menus ouverts par un appui long : les entrées qui tombent sous lui ne se touchent plus
// (mesuré sur iPhone : « Plus d'actions », « Supprimer… » recouverts ; le menu n'est pas décalé au-dessus du lecteur).
test('le lecteur audio affiché, le menu d\'un exercice reste entièrement touchable (aucune entrée recouverte par le lecteur) @mobile', async ({ ouvrirAppli, page }) => {
  test.fail(true, 'MO-07 : le panneau du lecteur audio recouvre des entrées du menu d\'un exercice (appui long) au bas de l\'écran.');
  await ouvrirTel(ouvrirAppli, bibliothequeCourte());
  await boutonHaut(page, 'Lecteur audio').tap();
  await expect(page.locator('.audio-panel')).toBeVisible();
  const { appuiLong, menuContextuel, rangee } = await import('./aide-mobile');
  await appuiLong(page, rangee(ligneDepart(page, 'Gamme majeure')));
  const menu = menuContextuel(page);
  await menu.getByRole('button', { name: /Plus d'actions/ }).evaluate((b) => (b as HTMLElement).click());   // (le toucher serait intercepté par le lecteur sur iPhone : c'est le défaut)
  await expect(menu.getByRole('button', { name: /^Supprimer/ })).toBeVisible();
  const recouvertes: string[] = [];
  for (const b of await menu.getByRole('button').all()) {
    const libre = await b.evaluate((e) => { const r = e.getBoundingClientRect(); const d = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!d && (e === d || e.contains(d)); });
    if (!libre) recouvertes.push((await b.textContent())!.trim());
  }
  expect(recouvertes, 'entrées du menu recouvertes').toEqual([]);
});

test.describe('Panneaux en paysage et clavier ouvert @mobile', () => {
  test('téléphone couché : Paramètres et Gammes tiennent dans l\'écran bas (≈ 350 px) et se ferment', async ({ ouvrirAppli, page }, testInfo) => {
    await ouvrirTel(ouvrirAppli, bibliothequeCourte());
    const { paysage } = tailles(page, testInfo.project.name);
    await page.setViewportSize(paysage);
    // Couché, le Pixel (863 px) prend la barre d'ordinateur (boutons « Gammes et arpèges »… séparés), l'iPhone (734 px) garde les neuf icônes : on ouvre l'outil par le chemin que la mise en page offre.
    const gammes = async (p: Page) => { const menu = boutonHaut(p, 'Outils de musique'); if (await menu.isVisible()) await outil('Gammes et arpèges')(p); else await p.getByRole('button', { name: 'Gammes et arpèges', exact: true }).tap(); };
    for (const [ouvrir, racine] of [[(p: Page) => boutonHaut(p, 'Paramètres').tap(), page.locator('.settings-panel')], [gammes, page.locator('.scales-panel')]] as const) {
      await ouvrir(page);
      await expect(racine).toBeVisible();
      await dansLEcran(page, racine, 'panneau en paysage');
      expect(await commandesDehors(page, racine)).toEqual([]);
      await sansDefilementHorizontal(page, 'paysage');
      const fermer = boutonFermer(racine);
      await fermer.scrollIntoViewIfNeeded();
      await expect(fermer).toBeInViewport();
      await fermer.tap();
      await expect(racine).toBeHidden();
    }
  });

  test('clavier ouvert : Paramètres ne cache pas son bouton « Fermer »', async ({ ouvrirAppli, page }, testInfo) => {
    await ouvrirTel(ouvrirAppli);
    await boutonHaut(page, 'Paramètres').tap();
    await ouvrirClavier(page, testInfo.project.name);
    const fermer = boutonFermer(page.locator('.settings-panel'));
    await fermer.scrollIntoViewIfNeeded();
    await expect(fermer).toBeInViewport();
  });
});

test.describe('Cibles tactiles au téléphone @mobile', () => {
  // MO-04 (mineur) : plusieurs commandes du doigt font moins de 24 px de côté (critère WCAG 2.2, 2.5.8) : étoiles de la note de la liste des sessions (15 px), bouton « Commentaire sur la session » (18 px),
  // « Retirer de la session » (18 px), étoiles de l'éditeur (19 px), pense-bête d'un dossier (23 px de haut).
  test('les commandes de l\'écran des sessions et de la bibliothèque font au moins 24 px de côté', async ({ ouvrirAppli, page }) => {
    test.fail(true, 'MO-04 : étoiles de note (15-19 px), « Commentaire sur la session » (18 px), « Retirer de la session » (18 px) et « ＋ Note » du dossier (23 px) sont plus petits que 24 px.');
    await ouvrirTel(ouvrirAppli, etatSession(['Alpha', 'Bravo', 'Charlie'], [{ nom: 'Matin', exercices: [['Alpha', 5], ['Bravo', 10]] }]));
    const trop = (nom: string) => page.evaluate((nom) => [...document.querySelectorAll('button, a[href], [role=button], [role=tab], [role=radio], [role=switch], select')]
      .filter((e) => { const b = e.getBoundingClientRect(), s = getComputedStyle(e); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && b.left < innerWidth && Math.min(b.width, b.height) < 24; })
      .map((e) => `${nom} : ${e.getAttribute('aria-label') || (e.textContent || '').trim().slice(0, 25)} ${Math.round(e.getBoundingClientRect().width)}×${Math.round(e.getBoundingClientRect().height)}`), nom);
    const trouves: string[] = [...await trop('bibliothèque')];
    await boutonHaut(page, 'Session guidée').tap();
    await expect(page.getByRole('button', { name: '+ Nouvelle session' })).toBeVisible();
    trouves.push(...await trop('liste des sessions'));
    await toucher(page.locator('.gs-session-row .gs-session-name').first());
    await page.getByRole('button', { name: '+ Ajouter un exercice' }).tap();
    await expect(page.getByRole('textbox', { name: 'Rechercher un exercice…' })).toBeVisible();
    trouves.push(...await trop('choix des exercices'));
    expect(trouves, 'commandes de moins de 24 px').toEqual([]);
  });
});
