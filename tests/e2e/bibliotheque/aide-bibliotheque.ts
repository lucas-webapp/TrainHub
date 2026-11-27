// MODULE « bibliotheque » — AIDES communes aux fichiers *.spec.ts du dossier (pas un test : le nom ne finit pas par .spec.ts).
// Vocabulaire de l'appli, observé en boîte noire (playwright-cli, 23/11/2026) :
//   espace (liste déroulante du haut) > chapitre (colonne latérale ; barre de pastilles au téléphone) > dossiers (emboîtables) > exercices.
//   Un dossier s'ouvre en cliquant sa ligne (liste « Sous-dossiers ») ou le fil d'Ariane ; un clic droit (PC) ou un appui long (téléphone) ouvre son menu.
//   Les ids `data-ex-id` des exercices posés au départ sont déterministes (`ex-<titre sans accents>`) ; ceux qu'on crée par l'interface se retrouvent par leur titre.
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { CLE_ETAT } from '../support/appli';

// ---------------------------------------------------------------------------------------------------------------------------------
// État de départ (mode « sans connexion » : posé dans localStorage avant le chargement ; l'appli normalise le reste)
// ---------------------------------------------------------------------------------------------------------------------------------
export type ExerciceDepart = string | { titre: string; favori?: boolean; archive?: boolean; notes?: string };
export type DossierDepart = { nom: string; exercices?: ExerciceDepart[]; dossiers?: DossierDepart[] };
export type ChapitreDepart = { nom: string; exercices?: ExerciceDepart[]; dossiers?: DossierDepart[]; couleur?: string };
export type EspaceDepart = { nom: string; chapitres: ChapitreDepart[] };

const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
export const idExerciceDepart = (titre: string) => `ex-${sansAccents(titre)}`;
const COULEURS = ['#00e676', '#a259ff', '#ff3d9a', '#00d9ff', '#ff9100'];

export function etatBibliotheque(espaces: EspaceDepart[], actif = 0) {
  const maintenant = Date.now();
  const exos = (liste: ExerciceDepart[] = []) => liste.map((e) => {
    const x = typeof e === 'string' ? { titre: e } : e;
    return { id: idExerciceDepart(x.titre), title: x.titre, notes: x.notes ?? '', favorite: !!x.favori, archived: !!x.archive, links: [], files: [], collapsed: true, updatedAt: maintenant };
  });
  const dossiers = (liste: DossierDepart[] = []): any[] => liste.map((d) => ({ id: `do-${sansAccents(d.nom)}`, name: d.nom, folders: dossiers(d.dossiers), exercises: exos(d.exercices) }));
  const instruments = espaces.map((esp, i) => ({
    id: `esp-${i}`, name: esp.nom,
    categories: esp.chapitres.map((c, j) => ({ id: `ch-${i}-${j}`, name: c.nom, color: c.couleur ?? COULEURS[j % COULEURS.length], folders: dossiers(c.dossiers), exercises: exos(c.exercices) })),
  }));
  return { instruments, activeInstrumentId: instruments[actif].id, updatedAt: maintenant };
}

// Une bibliothèque classique pour la plupart des tests : espace « Basse », chapitre « Technique » avec 2 dossiers et des exercices.
export const bibliothequeType = () => etatBibliotheque([
  { nom: 'Basse', chapitres: [
    { nom: 'Technique', exercices: ['Gamme majeure', 'Arpèges'], dossiers: [
      { nom: 'Rythme', exercices: ['Croches', 'Triolets'] },
      { nom: 'Slap', exercices: ['Pouce'], dossiers: [{ nom: 'Pops', exercices: ['Pop simple'] }] },
    ] },
    { nom: 'Improvisation', exercices: ['Blues en la'] },
  ] },
  { nom: 'Guitare', chapitres: [{ nom: 'Accords', exercices: ['Barrés'] }] },
]);

// ---------------------------------------------------------------------------------------------------------------------------------
// Lecture de l'état enregistré (localStorage["trainhub.v1"]) — l'appli n'expose aucune variable globale
// ---------------------------------------------------------------------------------------------------------------------------------
export type Noeud = { nom: string; exercices: string[]; dossiers: Noeud[] };
export type VueEspace = { nom: string; chapitres: Noeud[] };

export async function lireEtat(page: Page): Promise<any> {
  return page.evaluate((cle) => { const t = localStorage.getItem(cle); return t ? JSON.parse(t) : null; }, CLE_ETAT);
}
const vueNoeud = (n: any, archives = false): Noeud => ({
  nom: n.name,
  exercices: (n.exercises || []).filter((e: any) => archives || !e.archived).map((e: any) => e.title),
  dossiers: (n.folders || []).map((d: any) => vueNoeud(d, archives)),
});
/** Arbre enregistré, réduit aux noms : [{ nom, chapitres: [{ nom, exercices, dossiers: [...] }] }]. Les exercices archivés sont exclus (voir `archivesEnregistres`). */
export async function arbre(page: Page): Promise<VueEspace[]> {
  const e = await lireEtat(page);
  return (e?.instruments || []).map((i: any) => ({ nom: i.name, chapitres: (i.categories || []).map((c: any) => vueNoeud(c)) }));
}
export async function espaceEnregistre(page: Page, nom: string): Promise<VueEspace | undefined> {
  return (await arbre(page)).find((e) => e.nom === nom);
}
/** Tous les exercices de l'état (objets bruts), avec leur chemin « Espace › Chapitre › Dossier ». */
export async function exercicesEnregistres(page: Page): Promise<Array<{ chemin: string; exo: any }>> {
  const e = await lireEtat(page);
  const sortie: Array<{ chemin: string; exo: any }> = [];
  const parcourir = (n: any, chemin: string) => {
    for (const x of n.exercises || []) sortie.push({ chemin, exo: x });
    for (const d of n.folders || []) parcourir(d, `${chemin} › ${d.name}`);
  };
  for (const i of e?.instruments || []) for (const c of i.categories || []) parcourir(c, `${i.name} › ${c.name}`);
  return sortie;
}
export async function exerciceEnregistre(page: Page, titre: string) {
  return (await exercicesEnregistres(page)).filter((x) => x.exo.title === titre);
}
/** Ordre d'AFFICHAGE des chapitres de l'espace actif, tel qu'enregistré (`pinnedOrder` : un glisser-déposer ne change pas l'ordre de `categories`). */
export async function ordreChapitres(page: Page): Promise<string[]> {
  const e = await lireEtat(page);
  const esp = (e?.instruments || []).find((i: any) => i.id === e.activeInstrumentId);
  if (!esp) return [];
  const noms = new Map<string, string>((esp.categories || []).map((c: any) => [c.id, c.name]));
  const ordre: string[] = (esp.pinnedOrder || []).filter((id: string) => noms.has(id));
  // les chapitres absents de pinnedOrder (jamais déplacés) suivent dans leur ordre de création
  for (const c of esp.categories || []) if (!ordre.includes(c.id)) ordre.push(c.id);
  return ordre.map((id) => noms.get(id)!);
}
export async function corbeilleEnregistree(page: Page): Promise<any[]> {
  const e = await lireEtat(page);
  const t = e?.settings?.trash;
  return Array.isArray(t) ? t : (t?.items ?? []);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Mise en page
// ---------------------------------------------------------------------------------------------------------------------------------
/** Téléphone = ≤ 700 px (barre de pastilles à la place de la colonne latérale, menu « ⋯ »). */
export const auTelephone = (page: Page) => (page.viewportSize()?.width ?? 1440) <= 700;

// ---------------------------------------------------------------------------------------------------------------------------------
// Zone des exercices
// ---------------------------------------------------------------------------------------------------------------------------------
export const lignesExercices = (page: Page) => page.locator('#folder-container .exercises-wrap .exercise');
/** Titres affichés, dans l'ordre de l'écran (les titres sont des champs de saisie). */
export const titresAffiches = (page: Page) => page.locator('#folder-container .exercises-wrap .exercise-title').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
/** Tous les titres de la zone principale, y compris dans les vues « Favoris », « Archivés » et les résultats de recherche (groupes de dossiers). */
export const titresVue = (page: Page) => page.locator('#folder-container .exercise-title').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
export async function attendreTitres(page: Page, attendus: string[]) {
  await expect.poll(() => titresAffiches(page)).toEqual(attendus);
}
/** Ligne d'un exercice posé au départ (id déterministe). */
export const ligneDepart = (page: Page, titre: string) => page.locator(`#folder-container [data-ex-id="${idExerciceDepart(titre)}"]`);
/** Ligne d'un exercice (créé ou non) retrouvée par son titre, via l'état enregistré (id) : le titre affiché peut avoir changé depuis. */
export async function ligne(page: Page, titre: string): Promise<Locator> {
  let id = '';
  await expect.poll(async () => {
    // Plusieurs exercices de même titre : celui qui est affiché à l'écran.
    const ids = (await exerciceEnregistre(page, titre)).map((x) => x.exo.id as string);
    for (const i of ids) if (await page.locator(`#folder-container [data-ex-id="${i}"]`).count()) { id = i; return true; }
    return false;
  }, { message: `exercice « ${titre} » affiché et enregistré` }).toBe(true);
  return page.locator(`#folder-container [data-ex-id="${id}"]`);
}
export const rangee = (l: Locator) => l.locator('.exercise-row').first();
export const champTitre = (l: Locator) => l.locator('input.exercise-title').first();

/** Ajoute un exercice dans le dossier ouvert : saisie + Entrée (le champ reste prêt pour le suivant). */
export async function ajouterExercice(page: Page, titre: string) {
  const saisie = page.locator('#folder-container .add-exercise-row input');
  await saisie.fill(titre);
  await saisie.press('Enter');
  await expect(saisie).toHaveValue('');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Menu contextuel : clic droit à l'ordinateur, appui long au téléphone
// ---------------------------------------------------------------------------------------------------------------------------------
export const menuContextuel = (page: Page) => page.getByRole('menu').filter({ has: page.locator('button') });
/** Appui long simulé : l'appli écoute `pointerdown` de type tactile ; Playwright n'a pas de geste « appui long » (WebKit non plus par CDP). */
export async function appuiLong(page: Page, cible: Locator) {
  await cible.evaluate((el) => el.scrollIntoView({ block: 'center' }));   // au centre : un bandeau collant ne doit pas recouvrir le point visé
  const appuyer = () => cible.evaluate((racine) => {
    // Un point de l'élément qui n'est ni un champ ni un bouton (un champ de saisie ou un bouton n'ouvre pas le menu à l'appui long).
    // On essaie plusieurs hauteurs de la ligne : un bandeau, un message ou une ligne en cours de réaffichage peut en recouvrir une.
    const b = racine.getBoundingClientRect();
    const vue = { h: window.innerHeight, w: window.innerWidth };
    const recouvrant: string[] = [];
    // Les points essayés : d'abord le milieu de l'espace libre que l'appli laisse dans la ligne (`.exercise-row-spacer`, parfois quelques pixels seulement
    // quand le titre est long), puis toute la largeur de la ligne de 4 px en 4 px, en partant du milieu.
    const sp = racine.querySelector('.exercise-row-spacer')?.getBoundingClientRect();
    const fractions: number[] = [];
    if (sp && sp.width > 0) fractions.push((sp.left + sp.width / 2 - b.left) / b.width);
    for (let px = 0; px < b.width; px += 4) { fractions.push(0.5 + (px % 8 === 0 ? 1 : -1) * Math.ceil(px / 8) * 8 / b.width); }
    for (const g of [0.5, 0.3, 0.7]) {
      for (const f of fractions) {
        if (f < 0 || f > 1) continue;
        const x = b.left + b.width * f, y = b.top + b.height * g;
        if (x < 0 || y < 0 || x >= vue.w || y >= vue.h) continue;
        const el = document.elementFromPoint(x, y);
        if (el && racine.contains(el) && !el.closest('input, button, textarea, select, a')) {
          const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 };
          el.dispatchEvent(new PointerEvent('pointerdown', init));
          (window as any).__appuiLong = { el, init };
          return { ok: true, vu: '' };
        }
        if (g === 0.5 && el) recouvrant.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}`);
      }
    }
    return { ok: false, vu: `ligne ${Math.round(b.width)}×${Math.round(b.height)} à (${Math.round(b.left)},${Math.round(b.top)}) dans ${vue.w}×${vue.h} ; éléments au centre : ${[...new Set(recouvrant)].join(' | ') || 'aucun'}` };
  });
  const relacher = () => page.evaluate(() => {
    const a = (window as any).__appuiLong; if (!a) return;
    a.el.dispatchEvent(new PointerEvent('pointerup', { ...a.init, buttons: 0 }));
    (window as any).__appuiLong = null;
  });
  // Comme un doigt : si le menu ne s'ouvre pas (ligne en cours de réaffichage juste après une action), on relève et on réappuie.
  for (let essai = 1; essai <= 3; essai++) {
    // La ligne peut être en cours de réaffichage juste après une action : on attend qu'un point libre existe (état, pas de pause fixe).
    let dernier = { ok: false, vu: '' };
    await expect.poll(async () => { dernier = await appuyer(); return dernier.ok; }, { timeout: 8_000, message: 'appuiLong : un point libre (hors champ et bouton) sur cet élément' }).toBe(true)
      .catch((e) => { throw new Error(`appuiLong : aucun point libre (hors champ et bouton) sur cet élément — ${dernier.vu}\n${e.message}`); });
    const ouvert = await menuContextuel(page).waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false);
    await relacher();
    if (ouvert) { if (essai > 1) test.info().annotations.push({ type: 'appui-long', description: `menu ouvert au ${essai}e appui` }); return; }
  }
  await expect(menuContextuel(page)).toBeVisible();
}
/** Ouvre le menu d'un élément : appui long si l'écran est celui d'un téléphone, clic droit sinon. */
export async function ouvrirMenu(page: Page, cible: Locator) {
  if (auTelephone(page)) await appuiLong(page, cible);
  else await cible.click({ button: 'right' });
  await expect(menuContextuel(page)).toBeVisible();
}
/** Choisit une action du menu contextuel d'un exercice ; ouvre « Plus d'actions » si elle n'est pas au premier niveau. */
export async function actionExercice(page: Page, exo: Locator, action: string | RegExp) {
  await ouvrirMenu(page, rangee(exo));
  await choisirAction(page, action);
}
export async function choisirAction(page: Page, action: string | RegExp) {
  const menu = menuContextuel(page);
  const item = menu.getByRole('button', typeof action === 'string' ? { name: action, exact: true } : { name: action });
  if (!(await item.isVisible())) {
    await menu.getByRole('button', { name: /Plus d'actions/ }).click();
    await expect(item).toBeVisible();
  }
  await item.click();
}
/** Confirme une boîte « Supprimer … ? ». */
export async function confirmer(page: Page, bouton: string | RegExp = 'Supprimer') {
  const d = page.getByRole('dialog');
  await expect(d).toBeVisible();
  await d.getByRole('button', typeof bouton === 'string' ? { name: bouton, exact: true } : { name: bouton }).click();
  await expect(d).toBeHidden();
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Navigation : chapitres, dossiers, espaces
// ---------------------------------------------------------------------------------------------------------------------------------
const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exact = (s: string) => new RegExp(`^\\s*${echapper(s)}\\s*$`);
/** Un chapitre : ligne de la colonne latérale (ordinateur) ou pastille de la barre (téléphone). */
export const chapitre = (page: Page, nom: string) => auTelephone(page)
  ? page.locator('#chapter-bar .chapter-chip:not(.virtual-favorites):not(.virtual-archived)').filter({ has: page.locator('.chapter-chip-label', { hasText: exact(nom) }) })
  : page.locator('#sidebar-tree .tree-row-d0:not(.tree-row-fixed)').filter({ has: page.locator('.tree-label', { hasText: exact(nom) }) });
/** Un dossier (n'importe quelle profondeur) dans la colonne latérale — ordinateur seulement. */
export const noeudColonne = (page: Page, nom: string) => page.locator('#sidebar-tree .tree-row:not(.tree-row-fixed)').filter({ has: page.locator('.tree-label', { hasText: exact(nom) }) });
/** Un sous-dossier dans la liste « Sous-dossiers » de la zone principale (ordinateur et téléphone). */
export const sousDossier = (page: Page, nom: string) => page.locator('#folder-container .folder-row').filter({ has: page.locator('.folder-name', { hasText: exact(nom) }) });
export const sousDossiers = (page: Page) => page.locator('#folder-container .folder-row .folder-name');
/** Dossier ou chapitre ouvert : dernier élément du fil d'Ariane (le grand titre n'existe pas au téléphone). */
export const titreOuvert = (page: Page) => page.locator('#breadcrumb .crumb-current');
export const fil = (page: Page) => page.locator('#breadcrumb');
export async function ouvrirChapitre(page: Page, nom: string) {
  await chapitre(page, nom).click();
  await expect(titreOuvert(page)).toHaveText(nom);
}
export async function ouvrirDossier(page: Page, nom: string) {
  await sousDossier(page, nom).click();
  await expect(titreOuvert(page)).toHaveText(nom);
}
/** Dossiers du chemin donné, depuis le chapitre : ouvrirChemin(page, 'Technique', 'Slap', 'Pops'). */
export async function ouvrirChemin(page: Page, chapitreNom: string, ...dossiers: string[]) {
  await ouvrirChapitre(page, chapitreNom);
  for (const d of dossiers) await ouvrirDossier(page, d);
}
/** Entrées fixes « Favoris » et « Archivés » : lignes de la colonne (ordinateur) ou pastilles de la barre (téléphone). */
export const entreeFavoris = (page: Page) => auTelephone(page) ? page.locator('#chapter-bar .chapter-chip.virtual-favorites') : page.locator('#sidebar-tree .tree-row.virtual-favorites');
export const entreeArchives = (page: Page) => auTelephone(page) ? page.locator('#chapter-bar .chapter-chip.virtual-archived') : page.locator('#sidebar-tree .tree-row.virtual-archived');
export const selecteurEspace = (page: Page) => page.getByRole('combobox', { name: 'Espace' });
export async function nomsEspaces(page: Page): Promise<string[]> {
  return selecteurEspace(page).locator('option').evaluateAll((os) => os.map((o) => (o.textContent || '').trim()));
}
export async function espaceCourant(page: Page): Promise<string> {
  return selecteurEspace(page).evaluate((s) => { const o = (s as HTMLSelectElement).selectedOptions[0]; return (o?.textContent || '').trim(); });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Annuler / rétablir : boutons du haut à l'ordinateur ; menu « ⋯ » au téléphone
// ---------------------------------------------------------------------------------------------------------------------------------
export async function annuler(page: Page) { await actionHaut(page, 'Annuler', '#undo-btn'); }
export async function retablir(page: Page) { await actionHaut(page, 'Rétablir', '#redo-btn'); }
async function actionHaut(page: Page, nom: string, bouton: string) {
  if (auTelephone(page)) {
    await page.locator('#more-btn').click();
    await page.getByRole('menuitem', { name: nom, exact: true }).click();
  } else {
    await expect(page.locator(bouton)).toBeEnabled();
    await page.locator(bouton).click();
  }
}
/** Message (toast) visible ; renvoie son bouton d'action éventuel (« Annuler »). */
export const message = (page: Page, texte: string | RegExp) => page.locator('.toast').filter({ hasText: texte });

// ---------------------------------------------------------------------------------------------------------------------------------
// Glisser-déposer
// ---------------------------------------------------------------------------------------------------------------------------------
/** Glisser-déposer d'un élément de liste (chapitre, dossier, exercice) sur la moitié haute ou basse d'un autre. Gestes souris à la main :
 *  l'appli suit le pointeur (pas de glisser-déposer HTML5), ce qui marche pareil sur tous les navigateurs. */
export async function glisser(page: Page, source: Locator, cible: Locator, moitie: 'haut' | 'bas' | 'milieu' = 'milieu') {
  await source.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const bs = (await source.boundingBox())!, bc = (await cible.boundingBox())!;
  const horizontal = auTelephone(page) && bs.height < 60 && bs.y === bc.y;   // pastilles côte à côte
  await page.mouse.move(bs.x + bs.width / 2, bs.y + bs.height / 2);
  await page.mouse.down();
  await page.mouse.move(bs.x + bs.width / 2 + 6, bs.y + bs.height / 2 + 6, { steps: 3 });
  const tx = horizontal ? (moitie === 'haut' ? bc.x + 4 : bc.x + bc.width - 4) : bc.x + bc.width / 2;
  const ty = horizontal ? bc.y + bc.height / 2 : (moitie === 'haut' ? bc.y + bc.height * 0.2 : moitie === 'bas' ? bc.y + bc.height * 0.8 : bc.y + bc.height / 2);
  await page.mouse.move(tx, ty, { steps: 12 });
  await page.mouse.up();
}

export type { TestInfo };
