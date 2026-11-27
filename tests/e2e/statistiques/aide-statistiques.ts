// MODULE « statistiques » — AIDES communes aux fichiers *.spec.ts du dossier (pas un test : le nom ne finit pas par .spec.ts).
// Vocabulaire de l'appli, observé en boîte noire (playwright-cli, 26/11/2026) :
//   les STATISTIQUES sont une fenêtre (`.gs-stats-panel`, titre « Statistiques ») ouverte par l'icône « Statistiques d'entraînement » de l'écran « Session guidée » (la bulle de l'icône compte les
//   exercices « à attribuer à un chapitre »). En haut : liste « Période » (Aujourd'hui, Hier, 3 derniers jours, Un jour précis…, 7 / 28 / 90 jours, Ce mois, Mois dernier, Cette année, Année dernière, Tout ;
//   28 jours au départ) et, pour « Un jour précis… », un champ date « Jour ». Quatre onglets (`.st-tab`, réordonnables) : Aperçu (chiffres clés + comparaison avec la période d'avant, « Statistiques comptées
//   à partir du », graphique en barres jour / semaine / mois d'après la période, détail d'une barre touchée, séances à attribuer), Temps (régularité sur 12 mois = carte de 53 semaines, réel contre prévu),
//   Répartition (camembert des chapitres, des premiers sous-dossiers, les plus travaillés, favoris, sous-utilisés, politique « exercice déplacé »), Exercices (deux vues « Tempo progressif » / « Durées »,
//   filtres, tri, cartes dépliables avec alertes, courbe de tempo ou de durée). Il n'y a NI série de jours d'affilée, NI objectif de temps, NI export : rien de tel n'est testé.
//   Les chiffres viennent du JOURNAL (localStorage `trainhub.log.AAAA-MM`, un lot par mois) : les titres, chapitres et dossiers y sont FIGÉS à la date de la séance ; l'état actuel (`trainhub.v1`) ne sert qu'à
//   afficher les noms à jour et à repérer ce qui est ambigu. Réglages gardés avec les données : `settings.statsRules` (since, alias, chapterOf, resolved, movePolicy). Par appareil : `trainhub.statsSeen.v1`.
//   L'horloge est FIGÉE (`page.clock.setFixedTime`) : jeudi 26/11/2026 10:00 (Paris) ; les minuteries (messages « Annuler » de 8 s) restent réelles.
import type { Locator, Page } from '@playwright/test';
import { expect } from '../support/fixtures';
import { etatBibliotheque, idExerciceDepart, lireEtat, auTelephone, message, type EspaceDepart } from '../bibliotheque/aide-bibliotheque';
import { ouvrirSessions } from '../session/aide-session';

export { idExerciceDepart, lireEtat, auTelephone, message };

// ---------------------------------------------------------------------------------------------------------------------------------
// Le temps (Europe/Paris, comme le navigateur des tests)
// ---------------------------------------------------------------------------------------------------------------------------------
/** « 2026-11-20 18:30 » → instant (ms), heure de Paris, heure d'été comprise. */
export function paris(date: string): number {
  const [d, h = '12:00'] = date.split(' ');
  const [a, m, j] = d.split('-').map(Number), [hh, mm] = h.split(':').map(Number);
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  for (const decalage of [1, 2]) {
    const t = Date.UTC(a, m - 1, j, hh, mm) - decalage * 3_600_000;
    const p = Object.fromEntries(f.formatToParts(t).map((x) => [x.type, x.value]));
    if (Number(p.hour) === hh && Number(p.minute) === mm && Number(p.day) === j) return t;
  }
  throw new Error(`date de Paris introuvable : ${date}`);
}
/** L'instant figé des tests : jeudi 26/11/2026, 10:00. */
export const MAINTENANT = new Date(paris('2026-11-26 10:00'));
/** « il y a n jours » à une heure donnée (Paris), au format « AAAA-MM-JJ HH:MM » : pratique pour écrire des séances. */
export function ilYa(n: number, heure = '18:00'): string {
  const d = new Date(MAINTENANT.getTime() - n * 86_400_000 + 3_600_000);   // 26/11 + 1 h = 11:00 UTC : le jour civil de Paris est le même à n jours près (pas de changement d'heure fin novembre)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${heure}`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// État de départ : la bibliothèque et le journal
// ---------------------------------------------------------------------------------------------------------------------------------
/** Espace « Basse » (esp-0) : chapitres « Technique » (ch-0-0, dossier « Rythme » do-rythme) et « Improvisation » (ch-0-1) ; ids d'exercices `ex-<titre>`. */
export const BIBLIOTHEQUE_STATS: EspaceDepart[] = [{
  nom: 'Basse', chapitres: [
    { nom: 'Technique', exercices: ['Gamme majeure', 'Arpèges'], dossiers: [{ nom: 'Rythme', exercices: ['Croches'] }] },
    { nom: 'Improvisation', exercices: ['Blues en la'] },
  ],
}];
const sansAccents = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
/** Identifiant d'un chapitre de l'espace 0 (`ch-0-<rang>`, comme `etatBibliotheque`) ; un nom inconnu reçoit un identifiant qui n'existe pas dans l'état (chapitre disparu). */
function chapitreDe(nom: string, espaces: EspaceDepart[]) {
  const i = espaces[0].chapitres.findIndex((c) => c.nom === nom);
  return { id: i >= 0 ? `ch-0-${i}` : `ch-${sansAccents(nom)}-disparu`, nom };
}

/** Un exercice travaillé pendant une séance. `min` : minutes réellement passées ; `prevu` : minutes prévues ; `bpm` : tempo atteint (ou [départ, meilleur]) ; `chap` / `sous` : le rangement FIGÉ. */
export type Pas = { ex: string; min?: number; sec?: number; prevu?: number; bpm?: number | [number, number]; chap?: string; sous?: string; id?: string };
/** Une séance du journal. `quand` : « AAAA-MM-JJ HH:MM » (Paris). `libre` : séance libre (sans session). */
export type Seance = { quand: string; pas: Pas[]; nom?: string; id?: string; prevu?: number; total?: number; libre?: boolean; sessionId?: string; espace?: string };

function pasBrut(p: Pas, i: number, s: number, espaces: EspaceDepart[], libre = false) {
  const chap = chapitreDe(p.chap ?? 'Technique', espaces);
  const sous = p.sous ? { id: `do-${sansAccents(p.sous)}`, nom: p.sous } : null;
  const [premier, meilleur] = Array.isArray(p.bpm) ? p.bpm : p.bpm ? [p.bpm, p.bpm] : [null, null];
  return {
    sid: `s${s}-${i}`, exerciseId: p.id ?? idExerciceDepart(p.ex), title: p.ex, chapterId: chap.id, chapterName: chap.nom,
    path: sous ? [chap.nom, sous.nom] : [chap.nom], pathIds: sous ? [chap.id, sous.id] : [chap.id],
    plannedMin: p.prevu ?? (libre ? 0 : 5), actualSec: p.sec ?? (p.min ?? 5) * 60, bpmFirst: premier, bpmMax: meilleur, bpmEnd: meilleur,
  };
}
/** Les séances → les clés `trainhub.log.AAAA-MM` à passer dans `reglages` de `ouvrirAppli`. */
export function journalStats(seances: Seance[], espaces: EspaceDepart[] = BIBLIOTHEQUE_STATS): Record<string, string> {
  const mois: Record<string, any[]> = {};
  seances.forEach((s, n) => {
    const date = paris(s.quand), pas = s.pas.map((p, i) => pasBrut(p, i, n, espaces, !!s.libre));
    const total = s.total ?? pas.reduce((a, x) => a + x.actualSec, 0);
    const prevu = s.prevu !== undefined ? s.prevu * 60 : (s.libre ? 0 : pas.reduce((a, x) => a + x.plannedMin * 60, 0));
    const rec: any = { v: 2, id: s.id ?? `r${n}`, instrumentId: s.espace ?? 'esp-0', date, endedAt: date + total * 1000, totalSec: total, plannedSec: prevu, name: s.nom ?? (s.libre ? 'Session libre' : 'Routine'), steps: pas };
    if (s.libre) rec.free = true; else rec.sessionId = s.sessionId ?? 'sess-routine';
    const cle = s.quand.slice(0, 7);
    (mois[cle] = mois[cle] || []).push(rec);
  });
  return Object.fromEntries(Object.entries(mois).map(([m, records]) => [`trainhub.log.${m}`, JSON.stringify({ records, deleted: [], updatedAt: 1 })]));
}
/** La session « Routine » existe dans l'état (sinon l'appli n'en retrouve pas le nom et affiche celui du journal : « Routine » aussi). */
export type OptionsEtat = { espaces?: EspaceDepart[]; sansObjectif?: string[]; favoris?: string[]; archives?: string[]; reglagesStats?: Record<string, unknown>; extra?: Record<string, unknown> };
export function etatStats(o: OptionsEtat = {}) {
  const etat: any = etatBibliotheque(o.espaces ?? BIBLIOTHEQUE_STATS);
  const parcours = (n: any, f: (x: any) => void) => { (n.exercises || []).forEach(f); (n.folders || []).forEach((d: any) => parcours(d, f)); };
  for (const esp of etat.instruments) for (const c of esp.categories) parcours(c, (x) => {
    if (o.sansObjectif?.includes(x.title)) x.tempoGoal = false;
    if (o.favoris?.includes(x.title)) x.favorite = true;
    if (o.archives?.includes(x.title)) x.archived = true;
  });
  etat.settings = { guidedSessions: [], sessionPlan: [], ...(o.reglagesStats ? { statsRules: o.reglagesStats } : {}), ...(o.extra || {}) };
  return etat;
}

/** Ouvre l'appli avec l'horloge figée au 26/11/2026 10:00, la bibliothèque et le journal donnés. `setFixedTime` : le temps ne bouge pas, les minuteries restent réelles. */
export async function ouvrirStats(page: Page, ouvrirAppli: (o?: any) => Promise<Page>, seances: Seance[], options: OptionsEtat & { reglages?: Record<string, string>; etat?: unknown } = {}) {
  await page.clock.setFixedTime(MAINTENANT);
  const { reglages, etat, ...reste } = options;
  const p = await ouvrirAppli({ accueil: 'jamais', etat: etat ?? etatStats(reste), reglages: { ...journalStats(seances, reste.espaces ?? BIBLIOTHEQUE_STATS), ...(reglages || {}) } });
  return p;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// La fenêtre
// ---------------------------------------------------------------------------------------------------------------------------------
export const boutonStats = (page: Page) => page.getByRole('button', { name: /^Statistiques d'entraînement/ });
export const fenetre = (page: Page) => page.locator('.gs-stats-panel');
export const periode = (page: Page) => fenetre(page).getByRole('combobox', { name: 'Période' });
export const jourPrecis = (page: Page) => fenetre(page).getByLabel('Jour', { exact: true });
export const contenu = (page: Page) => fenetre(page).locator('.gs-history-list');
export const ongletStats = (page: Page, nom: 'Aperçu' | 'Temps' | 'Répartition' | 'Exercices') => fenetre(page).getByRole('tab', { name: new RegExp(`^${nom}`) });
export const fermer = (page: Page) => fenetre(page).getByRole('button', { name: 'Fermer' });

/** Ouvre « Session guidée » puis la fenêtre des statistiques (période : 28 jours). */
export async function ouvrirFenetre(page: Page) {
  await ouvrirSessions(page);
  await boutonStats(page).click();
  await expect(fenetre(page)).toBeVisible();
  await expect(ongletStats(page, 'Aperçu')).toBeVisible();
}
/** Choisit la période (libellé de la liste) ; « Un jour précis… » affiche le champ date. */
export async function choisirPeriode(page: Page, libelle: string) {
  await periode(page).selectOption({ label: libelle });
  await expect(periode(page).locator('option:checked')).toHaveText(libelle);
}
export async function aller(page: Page, onglet: 'Aperçu' | 'Temps' | 'Répartition' | 'Exercices') {
  await ongletStats(page, onglet).click();
  await expect(ongletStats(page, onglet)).toHaveAttribute('aria-selected', 'true');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Aperçu
// ---------------------------------------------------------------------------------------------------------------------------------
export const tuiles = (page: Page) => contenu(page).locator('.st-tile');
export const tuile = (page: Page, nom: string) => tuiles(page).filter({ has: page.locator('.st-tile-l', { hasText: new RegExp(`^${nom}$`) }) });
/** Valeur d'une tuile « Chiffres clés » (« 1 h 15 », « 4 », « 3 / 28 »…). */
export const valeurTuile = (page: Page, nom: string) => tuile(page, nom).locator('.st-tile-v');
export const deltaTuile = (page: Page, nom: string) => tuile(page, nom).locator('.st-tile-d');
export const noms = (page: Page) => tuiles(page).locator('.st-tile-l').allTextContents();
export const barres = (page: Page) => contenu(page).locator('svg.st-bars rect.st-bar');
export const infobulle = (r: Locator) => r.locator('title').textContent();
export const detailBarre = (page: Page) => contenu(page).locator('.st-pick');
/** Section (titre `.gs-stat-title` + bloc) : texte du bloc qui suit le titre. Les titres sont en majuscules par le CSS : on compare sans casse. */
export const section = (page: Page, titre: string | RegExp) =>
  contenu(page).locator('.gs-stat-title').filter({ hasText: typeof titre === 'string' ? new RegExp(`^${titre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i') : titre }).locator('xpath=following-sibling::*[1]');
/** Lignes (`.gs-stat-row`) d'un bloc : « gauche · droite ». */
export const lignesBloc = (bloc: Locator) => bloc.locator('.gs-stat-row').evaluateAll((els) => els.map((e) => {
  const g = e.querySelector('.gs-stat-l')?.cloneNode(true) as HTMLElement | undefined;
  g?.querySelectorAll('small').forEach((x) => x.remove());   // chemin ou chapitre noté en petit à côté du nom
  return `${g?.textContent ?? ''} | ${e.querySelector('.gs-stat-r')?.textContent ?? ''}`;
}));

// ---------------------------------------------------------------------------------------------------------------------------------
// Exercices
// ---------------------------------------------------------------------------------------------------------------------------------
export const bascule = (page: Page, mode: 'Tempo progressif' | 'Durées') => contenu(page).locator('.st-ex-mode-btn').filter({ hasText: new RegExp(`^${mode}`) });
export const cartes = (page: Page) => contenu(page).locator('.st-ex');
export const carte = (page: Page, titre: string) => cartes(page).filter({ has: page.locator('.st-ex-name', { hasText: new RegExp(`^${titre}`) }) });
export const titresCartes = (page: Page) => cartes(page).locator('.st-ex-name').evaluateAll((els) => els.map((e) => (e.childNodes[0].textContent ?? '').trim()));
export const entreeCarte = (c: Locator) => c.locator('.st-ex-row');
export const triExercices = (page: Page) => contenu(page).getByRole('combobox', { name: 'Trier' });
export const filtre = (page: Page, nom: 'Tous' | 'À surveiller') => contenu(page).locator('.st-ex-chips .cal-pick-chip').filter({ hasText: new RegExp(`^${nom}$`) });
export const infoExercices = (page: Page) => contenu(page).locator('.st-ex-info');
export const courbe = (c: Locator) => c.locator('svg.st-tempo');
export const points = (c: Locator) => c.locator('svg.st-tempo g.st-pt');
export const alertes = (c: Locator) => c.locator('.st-alert');

// ---------------------------------------------------------------------------------------------------------------------------------
// Lecture de ce qui est enregistré
// ---------------------------------------------------------------------------------------------------------------------------------
/** Séances d'un mois du journal (`trainhub.log.AAAA-MM`). */
export async function journalMois(page: Page, mois = '2026-11'): Promise<any[]> {
  return page.evaluate((m) => { const t = localStorage.getItem(`trainhub.log.${m}`); return t ? (JSON.parse(t).records || []) : []; }, mois);
}
export async function reglagesStats(page: Page): Promise<any> {
  return (await lireEtat(page))?.settings?.statsRules ?? {};
}
export async function alertesVues(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => { try { return JSON.parse(localStorage.getItem('trainhub.statsSeen.v1') || '{}'); } catch { return {}; } });
}

/** Appui long sur un élément qui EST un bouton (l'en-tête d'une carte d'exercice : `bindContextGesture(..., { selfButton: true })`) ; `appuiLong` de la bibliothèque écarte les boutons. Événements tactiles simulés comme les autres modules. */
export async function appuiLongSurBouton(page: Page, cible: Locator) {
  await cible.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await cible.evaluate((el) => {
    const b = el.getBoundingClientRect(), x = b.left + b.width * 0.5, y = b.top + b.height / 2;
    const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 9, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', init));
    (window as any).__appuiBouton = { el, init };
  });
  await expect(page.getByRole('menu').filter({ has: page.locator('button') })).toBeVisible();
  await page.evaluate(() => { const a = (window as any).__appuiBouton; if (a) a.el.dispatchEvent(new PointerEvent('pointerup', { ...a.init, buttons: 0 })); });
}

/** Ouvre le menu d'une CARTE d'exercice (l'en-tête est un bouton) : clic droit à l'ordinateur, appui long au téléphone. */
export async function ouvrirMenuCarte(page: Page, entree: Locator) {
  if (auTelephone(page)) await appuiLongSurBouton(page, entree);
  else await entree.click({ button: 'right' });
  await expect(page.getByRole('menu').filter({ has: page.locator('button') })).toBeVisible();
}

/** Attend (sans pause fixe) que le défilement du contenu soit fini : 8 images de suite à la même position. Toucher une barre fait défiler le détail jusqu'à l'écran (animation) ; cliquer pendant ce défilement,
 *  sous la charge de la série complète, a fait échouer 1 fois sur ~1 300 (Firefox) un clic sur « ✕ » du détail — l'élément bougeait encore. */
export async function defilementFini(page: Page) {
  await contenu(page).evaluate((el) => new Promise<void>((fin) => {
    let derniere = -1, stable = 0;
    const image = () => { const t = el.scrollTop + window.scrollY; if (t === derniere) stable++; else { stable = 0; derniere = t; } if (stable >= 8) fin(); else requestAnimationFrame(image); };
    image();
  }));
}
