// MODULE « morceaux » — AIDES communes aux fichiers *.spec.ts du dossier (pas un test : le nom ne finit pas par .spec.ts).
// Vocabulaire de l'appli, observé en boîte noire (playwright-cli, 26/11/2026) :
//   un chapitre « de morceaux » (`kind: 'songs'`) range ses morceaux À PLAT ; un morceau est un exercice dont le titre est toujours « Artiste - Titre » (champs `artist`, `songName`)
//   avec `styles[]`, `techniques[]` et `work` (un seul état de travail). Les « dossiers » sont CALCULÉS d'après la vue choisie dans la barre « Rangement des morceaux » :
//   Artistes (un dossier dès 2 morceaux, les autres sous « Autres morceaux »), Styles, Techniques, Travail (un dossier par valeur du vocabulaire du chapitre + « Sans style » /
//   « Sans technique » / « À classer »), Tous (à plat). Vocabulaire du chapitre : `ch.vocab = { styles, techniques, work, inProgress }` ; préférences d'affichage (vue, tri, artistes
//   repliés) : `trainhub.songsUi.v1`, par chapitre, sur l'appareil. Ajout : deux champs « Artiste » / « Titre du morceau » + « + », la fiche du nouveau morceau s'ouvre aussitôt.
//   Fiche : champs « Artiste » et « Titre » puis trois boutons-menus « Style », « Technique », « Travail ». Menu d'un morceau : pas de « Dupliquer » ni de liaison.
import type { Locator, Page } from '@playwright/test';
import { expect } from '../support/fixtures';
import { idExerciceDepart, lireEtat, ligneDepart, ouvrirChapitre, ouvrirMenu as ouvrirMenuBase, menuContextuel, choisirAction, auTelephone, message, confirmer, rangee, annuler, retablir, entreeArchives, entreeFavoris, ligne } from '../bibliotheque/aide-bibliotheque';

export { idExerciceDepart, lireEtat, ligneDepart, ouvrirChapitre, menuContextuel, choisirAction, auTelephone, message, confirmer, rangee, annuler, retablir, entreeArchives, entreeFavoris, ligne };

// ---------------------------------------------------------------------------------------------------------------------------------
// Menus : un appui long a besoin d'un point libre dans la ligne
// ---------------------------------------------------------------------------------------------------------------------------------
/** Ouvre le menu d'un élément (clic droit ; appui long au téléphone). Une ligne qui vient d'être redessinée a son titre sur toute la largeur jusqu'à l'image suivante (l'appli règle la largeur du titre à
 *  `requestAnimationFrame`) : sans point libre, l'appui long échoue (vu 1 fois sur 4 sur iPhone juste après une création). On attend donc l'espace libre de la ligne, sans pause fixe. */
export async function ouvrirMenu(page: Page, cible: Locator) {
  const espace = cible.locator('.exercise-row-spacer').first();
  if (await espace.count()) await expect.poll(async () => (await espace.boundingBox())?.width ?? 0, { message: 'le titre de la ligne a pris sa largeur (espace libre pour l\'appui long)' }).toBeGreaterThan(8);
  await ouvrirMenuBase(page, cible);
}
/** Choisit une action du menu d'un exercice ou d'un morceau (voir `ouvrirMenu`). */
export async function actionExercice(page: Page, exo: Locator, action: string | RegExp) {
  await ouvrirMenu(page, rangee(exo));
  await choisirAction(page, action);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// État de départ
// ---------------------------------------------------------------------------------------------------------------------------------
export type MorceauDepart = string | {
  /** « Artiste - Titre » (le titre de l'exercice) ; ou `artiste` + `titre` séparés. */
  titre: string; artiste?: string; styles?: string[]; techniques?: string[]; travail?: string; favori?: boolean; archive?: boolean; notes?: string;
  liens?: Array<{ label: string; url: string }>; cree?: number; maj?: number; deploye?: boolean;
};
export type VocabulaireDepart = { styles?: string[]; techniques?: string[]; travail?: string[]; enCours?: string };
export type OptionsMorceaux = {
  /** Nom du chapitre de morceaux (« Morceaux » par défaut). */
  chapitre?: string; vocab?: VocabulaireDepart;
  /** Exercices du chapitre ordinaire « Technique » (aucun par défaut : le chapitre n'est pas créé sans exercice si `sansTechnique`). */
  exercices?: string[]; sansTechnique?: boolean;
  /** Un second chapitre de morceaux. */
  autreChapitre?: { nom: string; morceaux: MorceauDepart[] };
  /** Réglages (settings) : sessions, etc. */
  reglages?: Record<string, unknown>;
};

/** Sépare « Artiste - Titre » (même règle que l'appli : tiret entouré d'espaces). */
export function separer(titre: string): { artiste: string; nom: string } {
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(titre.trim());
  return m ? { artiste: m[1].trim(), nom: m[2].trim() } : { artiste: '', nom: titre.trim() };
}
const IL_Y_A = Date.now();
function morceau(m: MorceauDepart, i: number) {
  const x = typeof m === 'string' ? { titre: m } as Exclude<MorceauDepart, string> : m;
  const p = x.artiste !== undefined ? { artiste: x.artiste, nom: x.titre } : separer(x.titre);
  const titre = p.artiste ? `${p.artiste} - ${p.nom}` : p.nom;
  return {
    id: idExerciceDepart(titre), title: titre, isSong: true, artist: p.artiste, songName: p.nom, styles: x.styles ?? [], techniques: x.techniques ?? [], work: x.travail ?? '',
    notes: x.notes ?? '', favorite: !!x.favori, archived: !!x.archive, tempoGoal: false, collapsed: !x.deploye,
    links: (x.liens ?? []).map((l, j) => ({ id: `lien-${i}-${j}`, label: l.label, url: l.url })), files: [], images: [],
    createdAt: x.cree ?? IL_Y_A - 1_000_000 + i * 1000, updatedAt: x.maj ?? IL_Y_A - 1_000_000 + i * 1000,
  };
}
/** Titre affiché d'un morceau de départ. */
export const titreDe = (m: MorceauDepart) => { const t = typeof m === 'string' ? m : m.titre; const x = typeof m === 'string' ? undefined : m; if (x?.artiste !== undefined) return x.artiste ? `${x.artiste} - ${x.titre}` : x.titre; const p = separer(t); return p.artiste ? `${p.artiste} - ${p.nom}` : p.nom; };

/** Espace « Basse » : un chapitre « Technique » (exercices ordinaires), un chapitre de MORCEAUX « Morceaux », et éventuellement un second chapitre de morceaux. */
export function etatMorceaux(morceaux: MorceauDepart[], o: OptionsMorceaux = {}) {
  const maintenant = Date.now();
  const categories: any[] = [];
  if (!o.sansTechnique) categories.push({ id: 'ch-tech', name: 'Technique', color: '#00e676', folders: [], exercises: (o.exercices ?? []).map((t) => ({ id: idExerciceDepart(t), title: t, notes: '', links: [], files: [], collapsed: true, updatedAt: maintenant })) });
  const vocab = o.vocab ? { styles: o.vocab.styles ?? [], techniques: o.vocab.techniques ?? [], ...(o.vocab.travail ? { work: o.vocab.travail } : {}), ...(o.vocab.enCours !== undefined ? { inProgress: o.vocab.enCours } : {}) } : undefined;
  categories.push({ id: 'ch-morceaux', name: o.chapitre ?? 'Morceaux', kind: 'songs', color: '#ff3d9a', folders: [], ...(vocab ? { vocab } : {}), exercises: morceaux.map(morceau) });
  if (o.autreChapitre) categories.push({ id: 'ch-autre', name: o.autreChapitre.nom, kind: 'songs', color: '#00d9ff', folders: [], exercises: o.autreChapitre.morceaux.map(morceau) });
  const etat: any = { instruments: [{ id: 'esp-0', name: 'Basse', categories }], activeInstrumentId: 'esp-0', updatedAt: maintenant };
  if (o.reglages) etat.settings = o.reglages;
  return etat;
}
/** Un chapitre ORDINAIRE (pas de morceaux) avec des dossiers, pour les transformations. Un exercice : son titre, ou `{ titre, id?, liens?, notes?, favori?, archive? }` (deux exercices de même titre ont besoin d'un `id` chacun). */
export type ExoOrdinaire = string | { titre: string; id?: string; liens?: Array<{ label: string; url: string }>; notes?: string; favori?: boolean; archive?: boolean };
export type DossierO = { nom: string; exercices?: ExoOrdinaire[]; dossiers?: DossierO[] };
export function etatOrdinaire(chapitre: string, exercices: ExoOrdinaire[], dossiers: DossierO[] = [], extra: { reglages?: Record<string, unknown>; autres?: any[] } = {}) {
  const maintenant = Date.now();
  let n = 0;
  const exos = (l: ExoOrdinaire[] = []) => l.map((e) => {
    const x = typeof e === 'string' ? { titre: e } as Exclude<ExoOrdinaire, string> : e; n++;
    return { id: x.id ?? idExerciceDepart(x.titre), title: x.titre, notes: x.notes ?? '', favorite: !!x.favori, archived: !!x.archive, links: (x.liens ?? []).map((l, j) => ({ id: `lien-${n}-${j}`, label: l.label, url: l.url })), files: [], collapsed: true, updatedAt: maintenant };
  });
  const dos = (l: DossierO[] = []): any[] => l.map((d) => ({ id: `do-${d.nom}`, name: d.nom, folders: dos(d.dossiers), exercises: exos(d.exercices) }));
  const etat: any = { instruments: [{ id: 'esp-0', name: 'Basse', categories: [{ id: 'ch-ord', name: chapitre, color: '#ff3d9a', folders: dos(dossiers), exercises: exos(exercices) }, ...(extra.autres ?? [])] }], activeInstrumentId: 'esp-0', updatedAt: maintenant };
  if (extra.reglages) etat.settings = extra.reglages;
  return etat;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Lecture de l'état enregistré
// ---------------------------------------------------------------------------------------------------------------------------------
/** Le chapitre de morceaux (objet brut de l'état), par son nom. */
export async function chapitreEnregistre(page: Page, nom = 'Morceaux'): Promise<any> {
  const e = await lireEtat(page);
  for (const i of e?.instruments || []) for (const c of i.categories || []) if (c.name === nom) return c;
  return undefined;
}
/** Un morceau enregistré, par son titre complet « Artiste - Titre ». */
export async function morceauEnregistre(page: Page, titre: string, chapitre = 'Morceaux'): Promise<any> {
  return ((await chapitreEnregistre(page, chapitre))?.exercises || []).find((x: any) => x.title === titre);
}
export async function titresEnregistres(page: Page, chapitre = 'Morceaux'): Promise<string[]> {
  return ((await chapitreEnregistre(page, chapitre))?.exercises || []).map((x: any) => x.title);
}
/** Attend (sans pause fixe) qu'un morceau enregistré vérifie une condition ; rend le morceau. */
export async function attendreMorceau(page: Page, titre: string, condition: (m: any) => boolean, message = `morceau « ${titre} » enregistré comme attendu`, chapitre = 'Morceaux'): Promise<any> {
  await expect.poll(async () => { const m = await morceauEnregistre(page, titre, chapitre); return !!m && condition(m); }, { message }).toBe(true);
  return morceauEnregistre(page, titre, chapitre);
}
/** Préférences d'affichage des morceaux (par chapitre) : `trainhub.songsUi.v1`. */
export async function prefsAffichage(page: Page): Promise<Record<string, any>> {
  return page.evaluate(() => { try { return JSON.parse(localStorage.getItem('trainhub.songsUi.v1') || '{}'); } catch { return {}; } });
}
export const idChapitreMorceaux = 'ch-morceaux';

// ---------------------------------------------------------------------------------------------------------------------------------
// L'écran du chapitre de morceaux
// ---------------------------------------------------------------------------------------------------------------------------------
export const ouvrirMorceaux = (page: Page, nom = 'Morceaux') => ouvrirChapitre(page, nom);
export type Vue = 'Artistes' | 'Styles' | 'Techniques' | 'Travail' | 'Tous';
export const barreRangement = (page: Page) => page.getByRole('group', { name: 'Rangement des morceaux' });
export const boutonVue = (page: Page, vue: Vue) => barreRangement(page).getByRole('button', { name: vue, exact: true });
/** Choisit une vue (le bouton « enfoncé » dit laquelle est active). */
export async function choisirVue(page: Page, vue: Vue) {
  await boutonVue(page, vue).click();
  await expect(boutonVue(page, vue)).toHaveAttribute('aria-pressed', 'true');
}
export const listeTri = (page: Page) => page.getByRole('combobox', { name: 'Tri des morceaux' });
export const boutonMenage = (page: Page) => page.getByRole('button', { name: 'Ménage…' });
/** Effectif écrit à droite de la barre : « 4 morceaux ». */
export const effectif = (page: Page) => page.locator('#folder-container .songs-bar .ex-view-count');
/** Dossiers calculés affichés dans la zone principale (lignes `.song-folder-row`) : nom et effectif. */
export const dossiersCalcules = (page: Page) => page.locator('#folder-container .song-folder-row');
export async function nomsDossiers(page: Page): Promise<string[]> {
  return page.locator('#folder-container .song-folder-row .folder-name').allTextContents();
}
export async function effectifsDossiers(page: Page): Promise<Array<[string, number]>> {
  return page.locator('#folder-container .song-folder-row').evaluateAll((rows) => rows.map((r) => [r.querySelector('.folder-name')!.textContent!.trim(), Number(r.querySelector('.song-folder-count')!.textContent)] as [string, number]));
}
export const dossierCalcule = (page: Page, nom: string) => page.locator('#folder-container .song-folder-row').filter({ has: page.locator('.folder-name', { hasText: new RegExp(`^${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
export async function ouvrirDossierCalcule(page: Page, nom: string) {
  await dossierCalcule(page, nom).click();
  await expect(page.locator('#breadcrumb .crumb-current')).toHaveText(nom);
}
/** Titres des morceaux affichés dans la zone principale, dans l'ordre de l'écran. */
export const titresMorceaux = (page: Page) => page.locator('#folder-container .songs-wrap .exercise-title').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
export async function attendreMorceaux(page: Page, attendus: string[]) {
  await expect.poll(() => titresMorceaux(page)).toEqual(attendus);
}
/** Titre de la section qui précède les morceaux libres (vue Artistes) : « Autres morceaux » ou « Morceaux ». */
export const etiquetteSection = (page: Page) => page.locator('#folder-container .songs-wrap .section-label');
/** Les blocs « artiste » (dès 2 morceaux du même artiste dans un dossier de style, de technique ou de travail). */
export const blocsArtiste = (page: Page) => page.locator('#folder-container .song-artist-block');
export const enteteArtiste = (page: Page, artiste: string) => page.locator('#folder-container .song-artist-head').filter({ has: page.locator('.song-artist-name', { hasText: new RegExp(`^${artiste}$`) }) });
/** Dossiers du chapitre dans la colonne latérale (ordinateur seulement). */
export const dossiersColonne = (page: Page) => page.locator('#sidebar-tree .song-tree-node .tree-label');
export const messageVide = (page: Page) => page.locator('#folder-container .songs-wrap .gs-empty');

// ---------------------------------------------------------------------------------------------------------------------------------
// Ajouter un morceau
// ---------------------------------------------------------------------------------------------------------------------------------
export const champArtiste = (page: Page) => page.locator('#folder-container .add-song-row .add-song-artist');
export const champTitreAjout = (page: Page) => page.locator('#folder-container .add-song-row .add-song-title');
export const boutonAjouter = (page: Page) => page.locator('#folder-container .add-song-row').getByTitle('Ajouter le morceau');
/** Saisit artiste et titre (dans leur champ) et valide avec Entrée dans le champ du titre. */
export async function ajouterMorceau(page: Page, artiste: string, titre: string) {
  await champArtiste(page).fill(artiste);
  await champTitreAjout(page).fill(titre);
  await champTitreAjout(page).press('Enter');
}
export const options = (page: Page) => page.locator('#song-artists-list option');

// ---------------------------------------------------------------------------------------------------------------------------------
// La fiche d'un morceau
// ---------------------------------------------------------------------------------------------------------------------------------
/** Déplie la fiche d'un morceau (clic sur l'espace libre de son en-tête) ; sans effet si elle est déjà dépliée. */
export async function deplier(page: Page, titre: string) {
  const f = ligneDepart(page, titre);
  await expect(f).toBeVisible();
  if (/\bcollapsed\b/.test((await f.getAttribute('class')) || '')) await f.locator('.exercise-row-spacer').first().click();
  await expect(f).not.toHaveClass(/collapsed/);
}
export const champsArtiste = (f: Locator) => f.getByRole('combobox', { name: 'Artiste' });
export const champsTitre = (f: Locator) => f.getByRole('textbox', { name: 'Titre', exact: true });
export const titreEntete = (f: Locator) => f.locator('input.exercise-title').first();
export type Propriete = 'Style' | 'Technique' | 'Travail';
export const boutonPropriete = (f: Locator, p: Propriete) => f.getByRole('button', { name: new RegExp(`^${p} :`) });
/** Le menu déroulant d'une caractéristique (un seul est ouvert à la fois). */
export const menuPropriete = (page: Page) => page.locator('.song-prop-menu');
export const valeurMenu = (page: Page, nom: string) => menuPropriete(page).locator('.song-prop-item').filter({ has: page.locator('.song-prop-name', { hasText: new RegExp(`^${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
export async function valeursMenu(page: Page): Promise<string[]> {
  return menuPropriete(page).locator('.song-prop-item .song-prop-name').allTextContents();
}
export async function ouvrirPropriete(f: Locator, p: Propriete) {
  await boutonPropriete(f, p).click();
  await expect(menuPropriete(f.page())).toBeVisible();
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Fenêtres de dialogue
// ---------------------------------------------------------------------------------------------------------------------------------
export const boite = (page: Page) => page.getByRole('dialog');
/** Répond à une boîte de saisie (« Nouveau style », « Renommer l'artiste »…) : remplit le champ et valide. */
export async function repondre(page: Page, texte: string, bouton: string | RegExp = /^(Ajouter|Renommer|Créer|Transformer)$/) {
  const d = boite(page);
  await expect(d).toBeVisible();
  await d.getByRole('textbox').fill(texte);
  await d.getByRole('button', typeof bouton === 'string' ? { name: bouton, exact: true } : { name: bouton }).click();
  await expect(d).toBeHidden();
}
/** Menu d'un « dossier calculé » (clic droit, appui long au téléphone) : renvoie le menu. */
export async function menuDossier(page: Page, nom: string) {
  await ouvrirMenu(page, dossierCalcule(page, nom));
  return page.locator('.ctx-menu');
}
export const entreesMenu = (page: Page) => page.locator('.ctx-menu .ctx-item').allTextContents();
