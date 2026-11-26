// MODULE « metronome » — AIDES communes aux fichiers *.spec.ts du dossier (pas un test : le nom ne finit pas par .spec.ts).
// Vocabulaire de l'appli, observé en boîte noire (playwright-cli, 25/11/2026) :
//   le bouton « Métronome » du haut ouvre la FENÊTRE FLOTTANTE (`.metronome-panel`, au centre par défaut ; Paramètres › Métronome règle position et taille) ; la punaise (`.metro-pin-btn`) l'ÉPINGLE
//   dans un volet intégré à la page (`aside#metro-dock`, classe `panel-docked`) : en bas sous 1 100 px, à droite au-dessus ; la même punaise le détache. « Fermer » (flottante) / ✕ (épinglé) le ferme ; ▾ le réduit.
//   Contenu : volume (bouton muet `.metro-volume-mute` + curseur ; au téléphone un bouton « Volume »), cadran rond (`.metro-dial-value` : clic = saisie au clavier `.metro-dial-input`, TAP, molette), − / + (±1) et − 10 / + 10
//   (le pas des gros boutons se règle dans Paramètres), tempo progressif (escalier : délai / seuil / paliers, enregistrés dans « Réglages enregistrés » = les PRÉRÉGLAGES `progPresets`), formules (None, 2/4, 3/4, 4/4, 5/4, 6/8, « ⋯ »
//   = Temps/mesure 1-12 + subdivision), pavé d'accents (une pastille par temps : clic = vide / normal / fort), chrono + remise à zéro, gros bouton Jouer / Arrêter.
//   Pendant la lecture, la pastille du temps joué porte `metro-step-current` (+ `metro-step-flash` à chaque clic). L'état se relit dans localStorage `trainhub.v1` → `settings.metronome`
//   (bpm, volume, sound, beatsPerMeasure, subdivision, rhythmLabel, pattern, beatPattern, progressive, progPresets) ; le réglage d'un exercice est dans `exercise.metronome`.
//   « Suivre l'exercice ouvert » (Paramètres, volet épinglé) : ouvrir une fiche pendant que le volet est épinglé charge SON réglage (message « Métronome réglé sur « X » … » + Annuler), même en lecture.
import type { Locator, Page } from '@playwright/test';
import { expect } from '../support/fixtures';
import { etatFiche, idExerciceDepart, type ExoFiche } from '../fiche/aide-fiche';
import { auTelephone, lireEtat, ligneDepart } from '../bibliotheque/aide-bibliotheque';
import { MAINT, ouvrirAvecHorloge } from '../session/aide-session';

export { etatFiche, idExerciceDepart, auTelephone, lireEtat, ligneDepart, MAINT, ouvrirAvecHorloge };

// ---------------------------------------------------------------------------------------------------------------------------------
// État de départ
// ---------------------------------------------------------------------------------------------------------------------------------
/** Les réglages d'une appli NEUVE, relevés sur un état créé par l'appli elle-même. Une graine qui n'en porte pas (état impossible en vrai) donne des comportements trompeurs : « Suivre l'exercice ouvert » ne suit alors rien
 *  (jusqu'à ce qu'on ait touché au métronome), alors que son interrupteur s'affiche allumé. */
export const METRO_DEFAUT = {
  bpm: 100, volume: 0.8, sound: 'click', progPresets: [], beatsPerMeasure: 4, subdivision: 1, rhythmLabel: null, pattern: [2, 1, 1, 1], advanced: false, beatPattern: [2, 1, 1, 1],
  progressive: { enabled: false, incrementBpm: 1, everySeconds: 15, version: 3, limitBpm: 0, stagesMode: false, stages: [], stopAtLimit: false, restoreOnStop: false },
  training: { enabled: false, beats: Array(12).fill(true), subMode: 'all', barsOn: 1, barsOff: 0, randomPct: 0, keepFirst: true, fade: false, fadeEvery: 20, fadeOrder: 'end' },
};
export const PREFS_DEFAUT = { tempoStep: 10, defaultMinutes: 5, freeStartSec: 10, freeIdleMin: 15, freeChangeInPause: 'remind', metroFollowEx: true, cloudBudgetMB: 800, bellLeadSec: 10, miniMode: 'auto', noteNames: 'letters', pauseOnHidden: false };
/** Un réglage de métronome d'exercice (comme le pose la fenêtre « Réglage pour « X » »). */
export const reglage = (bpm: number, mesure = 4, extra: Record<string, unknown> = {}) => ({
  bpm, beatsPerMeasure: mesure, rhythmLabel: `${mesure}/4`, subdivision: 1, advanced: false, pattern: [2, ...Array(mesure - 1).fill(1)], beatPattern: [2, ...Array(mesure - 1).fill(1)], ...extra,
});
/** Exercices dont la fiche est REPLIÉE ; `reg` = le réglage de métronome posé dans la fiche. */
export function etatMetro(exos: Array<string | { titre: string; reg?: Record<string, unknown> }>, reglagesGlobaux: Record<string, unknown> = {}) {
  const liste: ExoFiche[] = exos.map((e) => { const x = typeof e === 'string' ? { titre: e } as { titre: string; reg?: Record<string, unknown> } : e; return { titre: x.titre, ferme: true, extra: x.reg ? { metronome: x.reg } : {} }; });
  const etat: any = etatFiche(liste);
  etat.settings = { metronome: METRO_DEFAUT, prefs: PREFS_DEFAUT, ...reglagesGlobaux };
  return etat;
}
/** Ouvre l'appli (sans horloge simulée) sur `etatMetro`. */
export async function ouvrirMetro(ouvrirAppli: (o?: any) => Promise<Page>, exos: Array<string | { titre: string; reg?: Record<string, unknown> }> = ['Gamme'], options: Record<string, unknown> = {}) {
  return ouvrirAppli({ accueil: 'jamais', etat: etatMetro(exos), ...options });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Ouvrir, fermer, épingler
// ---------------------------------------------------------------------------------------------------------------------------------
export const boutonMetronome = (page: Page) => page.getByRole('button', { name: 'Métronome', exact: true });
/** Le métronome affiché, flottant ou épinglé (un seul à la fois). */
export const metro = (page: Page) => page.locator('.metronome-panel');
export const flottant = (page: Page) => page.locator('.metronome-panel:not(.panel-docked)');
export const volet = (page: Page) => page.locator('aside#metro-dock');
export const punaise = (page: Page) => metro(page).locator('.metro-pin-btn');
/** `horloge` : la page tourne sous `page.clock` (temps figé) — l'ouverture, animée par minuteries, n'avance alors que si on laisse passer un peu de temps. */
export async function ouvrir(page: Page, horloge = false) {
  await boutonMetronome(page).click();
  if (horloge) await page.clock.runFor(600);
  await expect(metro(page)).toBeVisible();
}
/** Ouvre le métronome DÉJÀ épinglé (le choix est retenu dans `trainhub.metroDock.v1` : comme un utilisateur qui l'a épinglé hier). À préférer à `ouvrirEtEpingler` quand le test n'éprouve pas la punaise : déplier une fiche
 *  dans les centaines de ms qui suivent le clic sur la punaise (le panneau est reconstruit) n'est pas suivi par le métronome. */
export async function ouvrirEpingle(page: Page, horloge = false) {
  await boutonMetronome(page).click();
  if (horloge) await page.clock.runFor(600);
  await expect(volet(page)).toBeVisible();
  await attendreImmobile(volet(page));
  // Observé : « Suivre l'exercice ouvert » rate une fiche dépliée dans les premières secondes de la page (rarement, surtout au premier test d'un navigateur froid) ; personne ne clique si vite en vrai.
  await page.waitForFunction(() => performance.now() > 3000);
}
/** Attend que l'élément ait cessé de bouger / de changer de taille (deux mesures successives identiques) : le panneau se met en place en quelques centaines de ms après son ouverture. */
export async function attendreImmobile(cible: Locator) {
  let precedent = '';
  await expect.poll(async () => { const mesure = JSON.stringify(await cible.boundingBox()); const immobile = mesure === precedent; precedent = mesure; return immobile; }, { intervals: [200], timeout: 5_000, message: 'le panneau du métronome se stabilise' }).toBe(true);
}
export const DEJA_EPINGLE = { 'trainhub.metroDock.v1': '1' };
export async function ouvrirEtEpingler(page: Page, horloge = false) {
  await ouvrir(page, horloge);
  await punaise(page).click();
  if (horloge) await page.clock.runFor(600);
  await expect(volet(page)).toBeVisible();
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------------------------------------------------------------
export const jouer = (page: Page) => metro(page).locator('button.metro-play-btn-big');
export const valeurTempo = (page: Page) => metro(page).locator('.metro-dial-value');
export const champTempo = (page: Page) => metro(page).locator('input.metro-dial-input');
export const boutonTap = (page: Page) => metro(page).locator('.metro-tap-btn');
export const chrono = (page: Page) => metro(page).locator('.metro-chrono-value');
export const razChrono = (page: Page) => metro(page).getByRole('button', { name: 'Réinitialiser le chronomètre' });
// Les quatre boutons autour du cadran n'ont que leur info-bulle (`title`) pour nom parlant : leur nom accessible est « − », « + », « − 10 », « + 10 ».
export const moins1 = (page: Page) => metro(page).getByTitle('Ralentir', { exact: true });
export const plus1 = (page: Page) => metro(page).getByTitle('Accélérer', { exact: true });
// (le « 10 » suit le réglage « Pas des gros boutons » de Paramètres : ±2, ±5 ou ±10)
export const moins10 = (page: Page) => metro(page).getByTitle(/^Ralentir de \d+$/);
export const plus10 = (page: Page) => metro(page).getByTitle(/^Accélérer de \d+$/);
/** Clique un des quatre boutons du cadran sur sa partie libre : le cadran rond passe par-dessus leur centre (Playwright refuse alors le clic, « intercepts pointer events »), pas le doigt de l'utilisateur. */
export async function appuyer(bouton: Locator) {
  const titre = (await bouton.getAttribute('title')) ?? '';
  const r = (await bouton.boundingBox())!;
  await bouton.click({ position: { x: titre.startsWith('Accélérer') ? r.width * 0.88 : r.width * 0.12, y: /\d$/.test(titre) ? r.height * 0.85 : r.height * 0.15 } });
}
export const formule = (page: Page, nom: '2/4' | '3/4' | '4/4' | '5/4' | '6/8') => metro(page).getByRole('button', { name: `Formule ${nom}`, exact: true });
export const formuleAucune = (page: Page) => metro(page).getByRole('button', { name: 'Aucun temps accentué' });
export const boutonAutres = (page: Page) => metro(page).getByRole('button', { name: 'Formules moins courantes et pavé détaillé' });
export const champTemps = (page: Page) => metro(page).locator('.metro-rhythm-fields input[type=number]');
export const choixSubdivision = (page: Page) => metro(page).locator('.metro-rhythm-fields select');
export const pastilles = (page: Page) => metro(page).locator('.metro-step');
export const pastille = (page: Page, n: number) => pastilles(page).nth(n - 1);
export const muet = (page: Page) => metro(page).getByRole('button', { name: 'Couper ou rétablir le son du métronome' });
/** Le curseur de volume : « Volume » en ligne sur ordinateur ; au téléphone le curseur est dans la ligne `.metro-volume-row`, ouverte par le bouton « Volume ». */
export const curseurVolume = (page: Page) => metro(page).locator('input.metro-volume-inline-slider');
export const boutonVolume = (page: Page) => metro(page).locator('button.metro-volume-btn');
export const bascule = (page: Page) => metro(page).locator('button.metro-progressive-toggle');
export const reglerEnregistre = (page: Page) => metro(page).locator('.metro-link-save');

/** Règle le tempo par la saisie au clavier (clic sur le chiffre du cadran, valeur, Entrée). */
export async function saisirTempo(page: Page, valeur: number | string) {
  await valeurTempo(page).click();
  await champTempo(page).fill(String(valeur));
  await champTempo(page).press('Enter');
  await expect(valeurTempo(page)).toBeVisible();
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Ce qui est enregistré
// ---------------------------------------------------------------------------------------------------------------------------------
export type EtatMetro = { bpm: number; volume: number; sound: string; beatsPerMeasure: number; subdivision: number; rhythmLabel: string | null; pattern: number[]; beatPattern: number[]; advanced: boolean; progressive: any; progPresets: any[] };
export async function etatEnregistre(page: Page): Promise<EtatMetro> {
  return ((await lireEtat(page))?.settings?.metronome ?? {}) as EtatMetro;
}
/** Attend (sans pause fixe) que l'état enregistré vérifie la condition, puis le rend. */
export async function attendreEtat(page: Page, lire: (m: EtatMetro) => unknown, attendu: unknown, message = 'état du métronome enregistré') {
  await expect.poll(async () => lire(await etatEnregistre(page)), { message }).toEqual(attendu);
}
/** Les valeurs des pastilles du pavé, d'après leur classe : 0 = vide, 1 = normal, 2 = fort. */
export async function accentsAffiches(page: Page): Promise<number[]> {
  return pastilles(page).evaluateAll((els) => els.map((e) => { const m = /metro-step-(\d)/.exec(e.className); return m ? Number(m[1]) : -1; }));
}
/** Le tempo affiché (chiffre du cadran ou champ de saisie ouvert). */
export async function tempoAffiche(page: Page): Promise<number> {
  return Number((await valeurTempo(page).innerText()).trim());
}
/** Lit le chrono « mm:ss » en secondes. */
export async function secondesChrono(page: Page): Promise<number> {
  const t = (await chrono(page).innerText()).trim();
  const m = /^(?:(\d+):)?(\d+):(\d\d)$/.exec(t);
  if (!m) throw new Error(`chrono illisible : « ${t} »`);
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
/** Le chrono marque AU MOINS `n` secondes — lu tout de suite (interrogé 1 s au plus, pour absorber le moment où le panneau est reconstruit) : un chrono remis à zéro n'atteindrait pas 2 s dans ce délai. */
export const chronoAuMoins = (page: Page, n: number) => expect.poll(() => secondesChrono(page).catch(() => -1), { timeout: 1_000, intervals: [50], message: `le chrono marque au moins ${n} s` }).toBeGreaterThanOrEqual(n);
export const enLecture = (page: Page) => expect(jouer(page)).toHaveText(/Arrêter/);
export const alArret = (page: Page) => expect(jouer(page)).toHaveText(/Jouer/);
export type { Locator };
