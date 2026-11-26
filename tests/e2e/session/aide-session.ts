// MODULE « session » — AIDES communes aux fichiers *.spec.ts du dossier (pas un test : le nom ne finit pas par .spec.ts).
// Vocabulaire de l'appli, observé en boîte noire (playwright-cli, 25/11/2026) :
//   bouton « Session » du haut = écran « Session guidée » : liste des sessions (onglets À venir / Éphémères / Tout), « + Nouvelle session », trois icônes (Calendrier, Historique, Statistiques).
//   « + Nouvelle session » ouvre le CHOIX des exercices (recherche, onglets Exercices / Morceaux / Favoris / En cours, dossiers dépliables, ronds de rang cliquables, bandeau « Ma session »
//   à droite) ; « Terminer » mène à l'ÉDITEUR (nom, note, commentaire, durées, ordre glissable, Enregistrer / Annuler / Lancer la session / Enregistrer sous PDF).
//   « Lancer la session » ouvre le DÉROULÉ (chrono, Pause, −1 / +1 min, Précédent / Suivant, liste à droite ≥ 560 px) ; « Arrêter la session » → « Enregistrer cette séance ? ».
//   Sessions enregistrées : localStorage `trainhub.v1` → settings.guidedSessions ; calendrier : settings.sessionPlan ; journal : `trainhub.log.AAAA-MM` ; session en cours : `trainhub.gsLive.v1`.
//   Le chrono du déroulé suit l'horloge de la page : les tests la pilotent avec `page.clock` (voir `ouvrirAvecHorloge`).
import type { Locator, Page } from '@playwright/test';
import { expect } from '../support/fixtures';
import { etatFiche, idExerciceDepart, journal, type ExoFiche } from '../fiche/aide-fiche';
import { auTelephone, lireEtat } from '../bibliotheque/aide-bibliotheque';

export { etatFiche, idExerciceDepart, journal, auTelephone, lireEtat };

// ---------------------------------------------------------------------------------------------------------------------------------
// État de départ
// ---------------------------------------------------------------------------------------------------------------------------------
/** « 25/11/2026 10:00 » à Paris : l'instant où l'horloge de la page est posée. */
export const MAINT = new Date('2026-11-25T10:00:00+01:00');
export type SessionDepart = { nom: string; exercices: Array<string | [string, number]>; note?: number; commentaire?: string; id?: string; archivee?: boolean; ephemere?: boolean; onglets?: string[] };

/** Un espace « Basse », un chapitre « Technique » (exercices dont la fiche est repliée : sans effet ici), et des sessions enregistrées d'avance. Chaque exercice de session : `titre` ou `[titre, minutes]` (5 par défaut). */
export function etatSession(exos: Array<string | ExoFiche>, sessions: SessionDepart[] = [], extra: Record<string, unknown> = {}) {
  const base: any = etatFiche(exos);
  const guidedSessions = sessions.map((s, i) => ({
    id: s.id ?? `sess-${i}`, name: s.nom, instrumentId: 'esp-0', tabIds: [], createdAt: s.ephemere ? Date.now() - 60_000 : MAINT.getTime() - 86_400_000 * (i + 1),
    ...(s.note ? { rating: s.note } : {}), ...(s.commentaire ? { comment: s.commentaire } : {}), ...(s.archivee ? { archived: true } : {}), ...(s.ephemere ? { ephemeral: true } : {}), ...(s.onglets ? { tabIds: s.onglets } : {}),
    steps: s.exercices.map((e, j) => { const [titre, minutes] = typeof e === 'string' ? [e, 5] : e; return { id: `st-${i}-${j}`, exerciseId: idExerciceDepart(titre), minutes, note: '', hidden: [] }; }),
  }));
  base.settings = { guidedSessions, sessionPlan: [], ...extra };
  return base;
}

/** Ajoute à l'état de départ un chapitre de MORCEAUX (`kind: 'songs'`) rangé après « Technique ». `favori` : le morceau est un favori. */
export function avecMorceaux(etat: any, morceaux: Array<string | { titre: string; favori?: boolean }>, nom = 'Mes morceaux') {
  etat.instruments[0].categories.push({
    id: 'ch-songs', name: nom, kind: 'songs', color: '#ff3d9a', folders: [],
    exercises: morceaux.map((m) => { const x = typeof m === 'string' ? { titre: m } as { titre: string; favori?: boolean } : m; return { id: idExerciceDepart(x.titre), title: x.titre, notes: '', fixedNotes: '', collapsed: true, links: [], files: [], images: [], favorite: !!x.favori, archived: false, updatedAt: Date.now() }; }),
  });
  return etat;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Horloge
// ---------------------------------------------------------------------------------------------------------------------------------
/** Pose l'horloge de la page au 25/11/2026 10:00, ouvre l'appli, puis FIGE le temps : il n'avance plus que par `avancer(page, ms)`. À appeler à la place de `ouvrirAppli` seul. */
export async function ouvrirAvecHorloge(page: Page, ouvrirAppli: (o?: any) => Promise<Page>, options: any = {}): Promise<Page> {
  await page.clock.install({ time: MAINT });
  const p = await ouvrirAppli({ accueil: 'jamais', ...options });   // la fenêtre « Retrouve ton travail partout » reviendrait par-dessus le déroulé quand le temps saute
  await page.clock.pauseAt(new Date(MAINT.getTime() + 120_000));
  return p;
}
/** Fait avancer le temps de la page. Les grands écarts sont sautés d'un bloc (`fastForward`, comme un ordinateur qu'on rouvre) puis les 3 dernières secondes sont jouées seconde par seconde :
 *  l'appli calcule le temps écoulé sur l'horloge, et ses minuteries se déclenchent comme en vrai (jouer 6 minutes au pas d'une seconde coûterait 30 s de test). */
export async function avancer(page: Page, ms: number) {
  if (ms > 6_000) { await page.clock.fastForward(ms - 3_000); await page.clock.runFor(3_000); }
  else await page.clock.runFor(ms);
}
/** L'horloge étant figée, les animations pilotées par minuteries (ouverture d'un panneau, message) n'avancent pas toutes seules : on lui laisse un instant. */
export const laisserPasser = (page: Page, ms = 1_000) => page.clock.runFor(ms);
export const secondes = (n: number) => n * 1000;
export const minutes = (n: number) => n * 60_000;

// ---------------------------------------------------------------------------------------------------------------------------------
// Lecture de l'état enregistré
// ---------------------------------------------------------------------------------------------------------------------------------
export type SessionVue = { nom: string; exercices: string[]; minutes: number[]; note?: number; commentaire?: string; id: string; archivee: boolean };
export async function sessionsEnregistrees(page: Page): Promise<SessionVue[]> {
  const e = await lireEtat(page);
  const titres: Record<string, string> = {};
  const parcours = (n: any) => { for (const x of n.exercises || []) titres[x.id] = x.title; for (const d of n.folders || []) parcours(d); };
  for (const esp of e?.instruments || []) for (const c of esp.categories || []) parcours(c);
  return (e?.settings?.guidedSessions || []).map((s: any) => ({
    id: s.id, nom: s.name, exercices: (s.steps || []).map((x: any) => titres[x.exerciseId] ?? x.exerciseId), minutes: (s.steps || []).map((x: any) => x.minutes),
    note: s.rating, commentaire: s.comment, archivee: !!s.archived,
  }));
}
export async function sessionEnregistree(page: Page, nom: string) { return (await sessionsEnregistrees(page)).find((s) => s.nom === nom); }
export async function planEnregistre(page: Page): Promise<Array<{ date: string; sessionId: string }>> {
  return ((await lireEtat(page))?.settings?.sessionPlan || []).map((p: any) => ({ date: p.date, sessionId: p.sessionId }));
}
/** Séances du journal d'un mois (`trainhub.log.AAAA-MM`). */
export async function journalDuMois(page: Page, mois = '2026-11'): Promise<any[]> {
  return page.evaluate((m) => { const t = localStorage.getItem(`trainhub.log.${m}`); return t ? (JSON.parse(t).records || []) : []; }, mois);
}
export async function sessionEnCours(page: Page): Promise<any | null> {
  return page.evaluate(() => { const t = localStorage.getItem('trainhub.gsLive.v1'); return t ? JSON.parse(t) : null; });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------------------------------------------------------------
export const boutonSession = (page: Page) => page.getByRole('button', { name: 'Session guidée' });
/** L'écran « Session guidée » est affiché (au téléphone son titre est masqué : on reconnaît la liste à son bouton « + Nouvelle session » ou à un éditeur / un choix ouvert). */
export const titreEcran = (page: Page) => page.getByRole('button', { name: '+ Nouvelle session' });
export async function ouvrirSessions(page: Page) {
  await boutonSession(page).click();
  await expect(titreEcran(page)).toBeVisible();
}
export const lignesSessions = (page: Page) => page.locator('.gs-session-row');
export const nomsSessions = (page: Page) => lignesSessions(page).locator('.gs-session-name').allTextContents();
export const ligneSession = (page: Page, nom: string) => lignesSessions(page).filter({ has: page.locator('.gs-session-name', { hasText: new RegExp(`^${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
export const nouvelleSession = (page: Page) => page.getByRole('button', { name: '+ Nouvelle session' });
export const ongletListe = (page: Page, nom: string | RegExp) => page.getByRole('tab', { name: nom });

/** Menu clic droit (appui long au téléphone) d'une ligne de session : choisit une action. */
export async function actionSession(page: Page, nom: string, action: string | RegExp) {
  const l = ligneSession(page, nom);
  await expect(l).toBeVisible();
  if (auTelephone(page)) { const { appuiLong } = await import('../bibliotheque/aide-bibliotheque'); await appuiLong(page, l.locator('.gs-session-info')); }
  else await l.locator('.gs-session-name').click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: action, exact: typeof action === 'string' }).click();
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Choix des exercices
// ---------------------------------------------------------------------------------------------------------------------------------
export const champRecherche = (page: Page) => page.getByRole('textbox', { name: 'Rechercher un exercice…' });
export const ongletChoix = (page: Page, nom: string) => page.getByRole('tab', { name: new RegExp(`^(${nom === 'Favoris' ? '★ ' : nom === 'En cours' ? '● ' : ''})${nom}`) });
export const toutDeplier = (page: Page) => page.getByRole('button', { name: 'Tout déplier' });
export const toutReplier = (page: Page) => page.getByRole('button', { name: 'Tout replier' });
/** Le rond de rang d'un exercice dans le choix : « Pas encore dans la session X » ou « N X ». */
export const rondExercice = (page: Page, titre: string) => page.getByRole('button', { name: new RegExp(`^(Pas encore dans la session |\\d+ )(Technique )?${titre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });
export const bandeau = (page: Page) => page.getByRole('complementary', { name: 'Ma session' });
export const retraitsBandeau = (page: Page) => bandeau(page).getByRole('button', { name: 'Retirer de la session' });
export const ajouterExercice = (page: Page) => page.getByRole('button', { name: '+ Ajouter un exercice' });
export const annulerEdition = (page: Page) => page.locator('.gs-cancel-btn');
export const termine = (page: Page) => page.getByRole('button', { name: 'Terminer' });
export async function choisir(page: Page, ...titres: string[]) {
  for (const t of titres) await rondExercice(page, t).click();
}
/** Ouvre le choix d'une nouvelle session, déplie les dossiers pour voir les exercices. */
export async function ouvrirChoix(page: Page) {
  await nouvelleSession(page).click();
  await ajouterExercice(page).click();   // la session neuve s'ouvre d'abord dans l'éditeur, vide
  await expect(champRecherche(page)).toBeVisible();
  await toutDeplier(page).click();
}
/** Titres des exercices dans l'ordre du bandeau « Ma session » (choix) ou de l'éditeur. */
export const titresBandeau = (page: Page) => bandeau(page).locator('[title]').evaluateAll((els) => els.map((e) => e.getAttribute('title')!).filter((t) => t && !/Répartition/.test(t)));

// ---------------------------------------------------------------------------------------------------------------------------------
// Éditeur
// ---------------------------------------------------------------------------------------------------------------------------------
export const champNom = (page: Page) => page.getByRole('textbox', { name: 'Nom de la session' });
export const champCommentaire = (page: Page) => page.getByRole('textbox', { name: 'Commentaire sur la session' });
export const etoile = (page: Page, n: number) => page.getByRole('radio', { name: new RegExp(`^${n} sur 5`) });
export const boutonEnregistrer = (page: Page) => page.getByRole('button', { name: /^(Enregistrer|Enregistré)$/ });
export const boutonLancerEditeur = (page: Page) => page.getByRole('button', { name: '▶ Lancer la session' });
export const retourListe = (page: Page) => page.getByRole('button', { name: '← Retour à la liste' });
export const totalEditeur = (page: Page) => page.getByText(/^Durée totale : /);
/** Les lignes d'exercices de l'éditeur (une par étape). */
export const etapes = (page: Page) => page.locator('.gs-step-row');
export const etape = (page: Page, titre: string) => etapes(page).filter({ has: page.locator('.gs-step-label', { hasText: new RegExp(`^${titre}$`) }) });
export const dureeEtape = (page: Page, titre: string) => etape(page, titre).locator('input.gs-step-minutes');
export const poigneeEtape = (page: Page, titre: string) => etape(page, titre).locator('.gs-step-handle');
export const titresEtapes = (page: Page) => page.locator('.gs-step-row .gs-step-label').allTextContents();
/** Enchaîne : choix de ces exercices → Terminer → éditeur, nom donné, Enregistrer. */
export async function creerSession(page: Page, nom: string, ...titres: string[]) {
  await ouvrirChoix(page);
  await choisir(page, ...titres);
  await termine(page).click();
  await expect(champNom(page)).toBeVisible();
  await champNom(page).fill(nom);
  await boutonEnregistrer(page).click();
  await expect(page.getByRole('button', { name: 'Enregistré' })).toBeDisabled();
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Déroulé
// ---------------------------------------------------------------------------------------------------------------------------------
export const chrono = (page: Page) => page.locator('.gs-run-timer');
export const totalChrono = (page: Page) => page.locator('.gs-run-total');
export const titreExercice = (page: Page) => page.locator('.gs-run-title');
export const rangExercice = (page: Page) => page.locator('.gs-run-progress');
export const barre = (page: Page) => page.getByRole('progressbar', { name: 'Avancement de la session' });
export const pause = (page: Page) => page.getByRole('button', { name: 'Pause', exact: true });
export const reprendre = (page: Page) => page.getByRole('button', { name: 'Reprendre', exact: true });
export const precedent = (page: Page) => page.getByRole('button', { name: '← Précédent' });
export const suivant = (page: Page) => page.getByRole('button', { name: 'Suivant →' });
export const moinsUneMin = (page: Page) => page.getByRole('button', { name: '−1 min' });
export const plusUneMin = (page: Page) => page.getByRole('button', { name: '+1 min' });
export const arreter = (page: Page) => page.getByRole('button', { name: 'Arrêter la session' });
export const enchainement = (page: Page) => page.locator('.gs-run-auto-btn');
export const cloche = (page: Page) => page.locator('.gs-run-bell-btn');
export const listeDeroule = (page: Page) => page.getByRole('list', { name: 'Exercices de la session' });
export const rangeeListe = (page: Page, titre: string) => page.locator('.gs-run-up-row').filter({ has: page.locator('.gs-run-up-title', { hasText: new RegExp(`^${titre}$`) }) });
export const titresListe = (page: Page) => page.locator('.gs-run-up-row .gs-run-up-title').allTextContents();
export const minutesListe = (page: Page) => page.locator('.gs-run-up-row .gs-run-up-min').allTextContents();
export const ajouterListe = (page: Page) => page.locator('.gs-run-up-add');
/** Clic droit (appui long au téléphone) sur un exercice de la liste du déroulé, puis une action du menu. */
export async function actionListe(page: Page, titre: string, action: string | RegExp) {
  await rangeeListe(page, titre).click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: action, exact: typeof action === 'string' }).click();
}
export const elementsDeroule = (page: Page) => listeDeroule(page).getByRole('listitem');
export const colonneGauche = (page: Page) => page.locator('.gs-run-colmain');
export const colonneDroite = (page: Page) => page.locator('.gs-run-colside');
/** Le chrono affiche « mm:ss » (ou « +mm:ss » en dépassement) : en secondes (négatif = dépassement). */
export async function secondesChrono(page: Page): Promise<number> {
  const t = (await chrono(page).innerText()).trim();
  const m = /^(\+)?(\d+):(\d\d)$/.exec(t);
  if (!m) throw new Error(`chrono illisible : « ${t} »`);
  const s = Number(m[2]) * 60 + Number(m[3]);
  return m[1] ? -s : s;
}
export const texteChrono = async (page: Page) => (await chrono(page).innerText()).trim();
/** Lance une session de la liste (bouton ▶ de sa ligne) et attend que le déroulé soit là. */
export async function lancerDepuisListe(page: Page, nom: string) {
  await ligneSession(page, nom).getByRole('button', { name: 'Lancer cette session' }).click();
  await expect(chrono(page)).toBeVisible();
}
/** Arrête la session (confirmation), jusqu'à la fenêtre « Enregistrer cette séance ? ». */
export async function arreterSession(page: Page) {
  await arreter(page).click();
  await page.getByRole('dialog', { name: 'Arrêter la session ?' }).getByRole('button', { name: 'Arrêter la session' }).click();
  await laisserPasser(page);
  await expect(fenetreSeance(page)).toBeVisible();
}
/** La fenêtre « Enregistrer cette séance ? » (panneau flottant, pas une boîte `dialog`). */
export const fenetreSeance = (page: Page) => page.locator('.gs-save-run-panel');
export async function enregistrerSeance(page: Page) {
  await fenetreSeance(page).getByRole('button', { name: 'Enregistrer', exact: true }).click();
  // Sans connexion, l'appli prévient que la séance restera sur l'appareil.
  const quandMeme = page.getByRole('button', { name: 'Enregistrer quand même' });
  await laisserPasser(page);
  await quandMeme.click();
  await laisserPasser(page);
  await expect(fenetreSeance(page)).toBeHidden();
}
export type { Locator };
