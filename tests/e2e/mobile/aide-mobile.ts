// MODULE « mobile » — AIDES communes aux fichiers *.spec.ts du dossier (pas un test : le nom ne finit pas par .spec.ts).
// Vocabulaire de l'appli au téléphone (≤ 700 px), observé en boîte noire (playwright-cli et projets mobile-android / mobile-iphone, 26/11/2026) :
//   - en haut, `.top-bar` COLLANTE sur deux rangées : espace (liste, + , crayon, pilule du compte), puis neuf icônes (Session guidée, Entraînement libre, Métronome, Enregistreur rapide, Lecteur audio,
//     Outils de musique, Rechercher, Plus d'actions « ⋯ », Paramètres), 36 × 38 px ; dessous, `#chapter-bar` (pastilles des chapitres, à la place de la colonne latérale), COLLANTE aussi, qui passe à la ligne ;
//   - les panneaux (`.backups-panel` : Paramètres, Corbeille, Gammes, Harmonie, Aides, Enregistreur…) prennent TOUT l'écran (0,0 → largeur × hauteur) avec un bouton « Fermer » en bas ;
//     le Lecteur audio est un bandeau en bas (`.audio-panel`) ; la recherche, la liste des sessions et ses écrans (calendrier, historique, statistiques) s'affichent dans la page ;
//   - les menus (`.ctx-menu`, appui long ou « ⋯ ») sont bornés à la hauteur de l'écran et défilent ;
//   - en paysage les téléphones (Playwright : iPhone 15 734 × 343, Pixel 7 863 × 360) dépassent 700 px : la barre des chapitres RESTE (pas de colonne latérale à cette largeur).
//   LIMITES D'ENVIRONNEMENT : le clavier virtuel n'existe pas dans les navigateurs de test : on le simule en RÉDUISANT LA HAUTEUR de la fenêtre (comportement d'Android ; sous iOS le clavier recouvre
//   la page sans la redimensionner, ce que seul un vrai iPhone prouve). Les gestes tactiles : `page.touchscreen.tap` partout ; un vrai glisser (événements tactiles du navigateur) seulement sous
//   Chromium (CDP) ; ailleurs on envoie des événements « pointeur » de type tactile à la main (comme l'appui long de `aide-bibliotheque.ts`). La zone sûre (encoche) ne s'émule que sous Chromium (CDP).
import type { Locator, Page } from '@playwright/test';
import { devices } from '@playwright/test';
import { expect } from '../support/fixtures';
import { actionExercice, etatBibliotheque, appuiLong, auTelephone, lireEtat, ligneDepart, menuContextuel, rangee } from '../bibliotheque/aide-bibliotheque';

export { actionExercice, appuiLong, auTelephone, lireEtat, ligneDepart, menuContextuel, rangee };

// ---------------------------------------------------------------------------------------------------------------------------------
// États de départ
// ---------------------------------------------------------------------------------------------------------------------------------
export const exos = (n: number, prefixe = 'Exercice') => Array.from({ length: n }, (_, i) => `${prefixe} ${i + 1}`);

/** La bibliothèque de l'utilisateur : un espace, cinq chapitres (comme dans sa sauvegarde), de longues listes. */
export const bibliothequeLongue = (parChapitre = 20) => etatBibliotheque([{ nom: 'Basse', chapitres:
  ['Technique', 'Gammes', 'Improvisation', 'Jeu en groupe', 'Copie de morceaux'].map((nom) => ({ nom, exercices: exos(parChapitre, nom) })) }]);

/** Une petite bibliothèque avec des dossiers (menus, appui long). */
export const bibliothequeCourte = () => etatBibliotheque([{ nom: 'Basse', chapitres: [
  { nom: 'Technique', exercices: ['Gamme majeure', 'Arpèges', 'Croches'], dossiers: [{ nom: 'Rythme', exercices: ['Triolets'] }, { nom: 'Slap', exercices: ['Pouce'] }] },
  { nom: 'Improvisation', exercices: ['Blues en la'] },
] }, { nom: 'Guitare', chapitres: [{ nom: 'Accords', exercices: ['Barrés'] }] }]);

/** Des noms qui ne tiennent pas en une ligne : espace, chapitres, dossier, exercice. */
export const LONG = 'Un nom vraiment très long, pour vérifier que rien ne déborde de l\'écran du téléphone';
export const bibliothequeNomsLongs = () => etatBibliotheque([{ nom: 'Un espace au nom très long pour la liste du haut', chapitres: [
  { nom: LONG, exercices: [LONG + ' (exercice)', 'Court'], dossiers: [{ nom: LONG + ' (dossier)', exercices: ['Dedans'] }] },
  { nom: 'Autre chapitre au nom long, lui aussi', exercices: ['x'] },
] }]);

export async function ouvrirTel(ouvrirAppli: (o?: any) => Promise<Page>, etat: unknown = bibliothequeCourte(), options: Record<string, unknown> = {}) {
  const page = await ouvrirAppli({ accueil: 'jamais', etat, ...options });
  expect(auTelephone(page), 'ce test vaut pour un téléphone (≤ 700 px)').toBe(true);
  return page;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Mesures de mise en page
// ---------------------------------------------------------------------------------------------------------------------------------
export const largeurEcran = (page: Page) => page.evaluate(() => document.documentElement.clientWidth);
export const hauteurEcran = (page: Page) => page.evaluate(() => window.innerHeight);
/** La page ne défile pas horizontalement. */
export const sansDefilementHorizontal = (page: Page, message = 'la page ne défile pas horizontalement') =>
  expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message }).toBeLessThanOrEqual(1);
/** Un élément visible tient dans la largeur et dans la hauteur de l'écran. */
export async function dansLEcran(page: Page, loc: Locator, nom: string, { hauteur = true }: { hauteur?: boolean } = {}) {
  const b = await loc.boundingBox();
  expect(b, `${nom} : visible`).not.toBeNull();
  const [l, h] = [await largeurEcran(page), await hauteurEcran(page)];
  expect(b!.x, `${nom} : bord gauche`).toBeGreaterThanOrEqual(-1);
  expect(b!.x + b!.width, `${nom} : bord droit`).toBeLessThanOrEqual(l + 1);
  if (hauteur) {
    expect(b!.y, `${nom} : bord haut`).toBeGreaterThanOrEqual(-1);
    expect(b!.y + b!.height, `${nom} : bord bas`).toBeLessThanOrEqual(h + 1);
  }
}
/** Après une rotation l'appli recalcule la taille de ses panneaux avec un léger retard (≈ 0,5 s mesuré) : on attend qu'ils tiennent dans l'écran (jusqu'à 7 s), sans pause fixe. `margeBas` : tolérance en px sur le bord bas. */
export async function tientBientot(page: Page, loc: Locator, nom: string, margeBas = 1) {
  await expect.poll(async () => {
    const b = await loc.boundingBox(); if (!b) return 'invisible';
    const [l, h] = [await largeurEcran(page), await hauteurEcran(page)];
    return b.x >= -1 && b.y >= -1 && b.x + b.width <= l + 1 && b.y + b.height <= h + margeBas ? 'ok' : `hors de l'écran : ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}×${Math.round(b.height)} dans ${l}×${h}`;
  }, { message: `${nom} tient dans l'écran` }).toBe('ok');
}

/** Les commandes (champs, boutons, listes, liens) de la zone qui sortent de l'écran à gauche ou à droite ET qu'on ne peut pas atteindre en faisant défiler un bandeau (un ancêtre en `overflow-x: auto | scroll`
 *  qui déborde : ses onglets se trouvent au glissement du doigt, c'est un choix de mise en page, pas un défaut). */
export async function commandesDehors(page: Page, racine: Locator): Promise<string[]> {
  const l = await largeurEcran(page);
  return racine.evaluate((r, largeur) => [...r.querySelectorAll('input, textarea, button, select, a, [role=button], [role=tab]')]
    .filter((e) => {
      const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
      if (!(b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && (b.right > largeur + 1 || b.left < -1))) return false;
      for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
        const o = getComputedStyle(a).overflowX;
        if ((o === 'auto' || o === 'scroll') && a.scrollWidth > a.clientWidth + 1) return false;   // atteignable en faisant défiler ce bandeau
      }
      return true;
    })
    .map((e) => `${e.getAttribute('aria-label') || e.getAttribute('title') || (e.textContent || '').trim().slice(0, 25) || e.className} (${Math.round(e.getBoundingClientRect().left)} → ${Math.round(e.getBoundingClientRect().right)})`), l);
}
/** Dimensions d'une commande, arrondies. */
export async function taille(loc: Locator) { const b = (await loc.boundingBox())!; return { l: Math.round(b.width), h: Math.round(b.height), x: b.x, y: b.y }; }
/** Deux boîtes se recouvrent-elles (plus de 1 px dans les deux sens) ? */
export const serecouvrent = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

/** L'élément du dessus au centre de la commande est bien elle (ou l'un de ses descendants) : rien ne la recouvre. */
export const decouverte = (loc: Locator) => loc.evaluate((e) => {
  const b = e.getBoundingClientRect();
  const dessus = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  return !!dessus && (e === dessus || e.contains(dessus));
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Orientation et clavier virtuel (simulés par la taille de la fenêtre)
// ---------------------------------------------------------------------------------------------------------------------------------
/** Tailles de la fenêtre en portrait (celle du projet) et en paysage (profil « landscape » de Playwright pour le même téléphone). */
export function tailles(page: Page, projet: string) {
  const portrait = page.viewportSize()!;
  const paysage = (projet === 'mobile-iphone' ? devices['iPhone 15 landscape'] : devices['Pixel 7 landscape']).viewport;
  return { portrait, paysage };
}
/** Hauteur de la fenêtre quand le clavier virtuel est ouvert (≈ 40 % de l'écran pris par le clavier). */
export const AVEC_CLAVIER = 0.58;
export async function ouvrirClavier(page: Page, projet: string) {
  const { portrait } = tailles(page, projet);
  await page.setViewportSize({ width: portrait.width, height: Math.round(portrait.height * AVEC_CLAVIER) });
}
export async function fermerClavier(page: Page, projet: string) {
  await page.setViewportSize(tailles(page, projet).portrait);
}
/** Le champ est entièrement dans la partie visible de la fenêtre, et rien ne le recouvre (barres collantes, volet, message).
 *  À l'ouverture du clavier les navigateurs mobiles font défiler le champ actif vers le CENTRE de la zone visible (Chrome et Safari) ; `focus()` de Playwright, lui, ne défile que si le champ est
 *  entièrement caché (WebKit sous Linux laisse un champ à moitié coupé). On rejoue donc ce défilement vers le centre quand le champ n'est pas entièrement visible : il prouve que la page PEUT amener le champ en vue (marge en bas de page, barres collantes). */
export async function champAccessible(page: Page, champ: Locator, nom: string) {
  // « si besoin » : un champ déjà entièrement visible ne bouge pas (comme sur un téléphone) ; sinon on le centre.
  await champ.evaluate((e) => { const b = e.getBoundingClientRect(); if (b.top < 0 || b.bottom > innerHeight) e.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior }); });
  await expect.poll(async () => {
    const b = await champ.boundingBox(); const h = await hauteurEcran(page);
    return !!b && b.y >= -1 && b.y + b.height <= h + 1;
  }, { message: `${nom} : entièrement dans la fenêtre` }).toBe(true);
  await expect.poll(() => decouverte(champ), { message: `${nom} : rien ne le recouvre` }).toBe(true);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Gestes
// ---------------------------------------------------------------------------------------------------------------------------------
/** Toucher bref. Chromium : vrai toucher (`tap`). WebKit sous Linux : ENV-MO-01 — sur une pastille de chapitre ou une ligne d'exercice (dont `pointerdown` est annulé par le glisser-déposer de l'appli), `tap()`
 *  envoie bien pointerdown / touchstart / pointerup / touchend mais AUCUN `click` (mesuré : 5 événements sur Chromium, 4 sur WebKit, alors qu'un bouton ordinaire reçoit son `click` des deux côtés) ; sur un vrai
 *  iPhone le toucher ouvre le chapitre (l'utilisateur s'en sert tous les jours) : on utilise donc `click()` sur WebKit pour ces deux familles d'éléments. À rejouer à la main sur iPhone. */
export async function toucher(loc: Locator) {
  if (loc.page().context().browser()?.browserType().name() === 'webkit') await loc.click();
  else await loc.tap();
}

/** Glisser au doigt de `source` à `cible`. Chromium : vrais événements tactiles (CDP, la page ne défile pas si `touch-action` est bien posé) ; WebKit : événements « pointeur » tactiles à la main. */
export async function glisserAuDoigt(page: Page, source: Locator, cible: Locator, moitie: 'haut' | 'bas' | 'gauche' | 'droite' | 'milieu' = 'milieu') {
  await source.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const bs = (await source.boundingBox())!, bc = (await cible.boundingBox())!;
  const de = { x: bs.x + bs.width / 2, y: bs.y + bs.height / 2 };
  const vers = {
    x: moitie === 'gauche' ? bc.x + 4 : moitie === 'droite' ? bc.x + bc.width - 4 : bc.x + bc.width / 2,
    y: moitie === 'haut' ? bc.y + bc.height * 0.2 : moitie === 'bas' ? bc.y + bc.height * 0.8 : bc.y + bc.height / 2,
  };
  const pas = 14;
  const chemin = Array.from({ length: pas }, (_, i) => ({ x: de.x + (vers.x - de.x) * (i + 1) / pas, y: de.y + (vers.y - de.y) * (i + 1) / pas }));
  if (page.context().browser()?.browserType().name() === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    const evt = (type: string, p: { x: number; y: number }) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: p.x, y: p.y, id: 1 }] });
    await evt('touchStart', de);
    for (const p of chemin) await evt('touchMove', p);
    await evt('touchEnd', vers);
    await cdp.detach();
    return;
  }
  const init = (p: { x: number; y: number }, buttons: number) => ({ bubbles: true, cancelable: true, composed: true, clientX: p.x, clientY: p.y, pointerId: 9, pointerType: 'touch', isPrimary: true, button: 0, buttons });
  await page.evaluate(([p, i]) => { const el = document.elementFromPoint(p.x, p.y)!; (window as any).__doigt = el; el.dispatchEvent(new PointerEvent('pointerdown', i as any)); }, [de, init(de, 1)] as const);
  for (const p of chemin) await page.evaluate(([q, i]) => { const el = document.elementFromPoint(q.x, q.y) || document.body; ((window as any).__doigt || el).dispatchEvent(new PointerEvent('pointermove', i as any)); document.dispatchEvent(new PointerEvent('pointermove', i as any)); }, [p, init(p, 1)] as const);
  await page.evaluate(([q, i]) => { const el = document.elementFromPoint(q.x, q.y) || document.body; ((window as any).__doigt || el).dispatchEvent(new PointerEvent('pointerup', i as any)); document.dispatchEvent(new PointerEvent('pointerup', i as any)); (window as any).__doigt = null; }, [vers, init(vers, 0)] as const);
}

/** Doigt posé / levé à la main (Chromium seulement, CDP) : vrais événements tactiles, donc vrai défilement ou vrai appui long du navigateur. */
export async function doigt(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const evt = (type: string, x = 0, y = 0) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  return {
    pose: (x: number, y: number) => evt('touchStart', x, y),
    bouge: (x: number, y: number) => evt('touchMove', x, y),
    leve: () => evt('touchEnd'),
    ferme: () => cdp.detach(),
    /** Balayage de (x, y) de `dy` px vers le haut (dy > 0) ou le bas (dy < 0), par petits pas. */
    async balaie(x: number, y: number, dy: number, pas = 12) {
      await evt('touchStart', x, y);
      for (let i = 1; i <= pas; i++) await evt('touchMove', x, y - (dy * i) / pas);
      await evt('touchEnd');
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Éléments de l'écran
// ---------------------------------------------------------------------------------------------------------------------------------
export const barreHaut = (page: Page) => page.locator('.top-bar');
export const barreChapitres = (page: Page) => page.locator('#chapter-bar');
export const pastilles = (page: Page) => page.locator('#chapter-bar .chapter-chip');
/** Une pastille de chapitre, quelle que soit la largeur (le `chapitre()` de la bibliothèque choisit la colonne latérale au-dessus de 700 px, or téléphone couché la barre des chapitres reste). */
export const pastilleChapitre = (page: Page, nom: string) => page.locator('#chapter-bar .chapter-chip:not(.virtual-favorites):not(.virtual-archived)').filter({ has: page.locator('.chapter-chip-label', { hasText: new RegExp(`^\\s*${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }) });
/** Les boutons de la rangée d'icônes (noms accessibles). */
export const ICONES = ['Session guidée', 'Entraînement libre', 'Métronome', 'Enregistreur rapide', 'Lecteur audio', 'Outils de musique', 'Rechercher un exercice', 'Plus d\'actions', 'Paramètres'];
export const boutonHaut = (page: Page, nom: string) => page.locator('.top-bar').getByRole('button', { name: nom, exact: true });
/** Un panneau plein écran (`.backups-panel`) affiché. */
export const panneau = (page: Page) => page.locator('.backups-panel');
/** Le bouton qui ferme un panneau : « Fermer », ou « Fermer l'outil Harmonie »… */
/** La barre d'actions de la sélection (en bas de l'écran). */
export const barreSelection = (page: Page) => page.getByRole('toolbar', { name: 'Actions sur la sélection' });
/** Commence une sélection par l'appui long sur un exercice (menu › « Plus d'actions » › « Sélectionner (plusieurs) »). */
export async function commencerSelection(page: Page, titre: string) {
  await actionExercice(page, ligneDepart(page, titre), /Sélectionner \(plusieurs\)/);
  await expect(barreSelection(page)).toBeVisible();
}
export const boutonFermer = (p: Locator) => p.getByRole('button', { name: /^Fermer/ }).first();
