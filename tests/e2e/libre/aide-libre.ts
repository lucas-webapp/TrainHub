// MODULE « libre » — AIDES communes aux fichiers *.spec.ts du dossier (pas un test : le nom ne finit pas par .spec.ts).
// Vocabulaire de l'appli, observé en boîte noire (playwright-cli, 25/11/2026) :
//   le bouton « Libre » (« Entraînement libre ») du haut lance un chrono qui SUIT L'EXERCICE AFFICHÉ à l'écran principal (fiche dépliée). Une barre `#free-bar` apparaît à gauche
//   du bouton : chrono TOTAL de la séance (`.free-time`), pause, arrêt. Cinq états (classe de la barre) : `free-bar-idle` (« Aucun exercice affiché »), `free-bar-wait`
//   (« Départ dans N s » : 1 s après l'ouverture d'une fiche la barre passe à « Départ dans 10 s » ; ces 10 s ne comptent pas), `free-bar-run`, `free-bar-paused` (« En pause »).
//   Sous la barre, `#free-recap` : une pastille par exercice travaillé (`.free-chip`, nom + temps cumulé ; `.free-chip-now` = celui qui court), la plus récente en premier ; masquées au téléphone.
//   Le temps ne court que si une fiche est dépliée (replier la fiche = « Aucun exercice affiché »). Une fiche dépliée en replie une autre (une seule ouverte à la fois).
//   Arrêt : le bouton ■ de la barre ouvre aussitôt « Enregistrer cet entraînement ? » (`.gs-save-run-panel`) si la séance dure au moins 60 s ; sinon un message « trop court » et rien n'est gardé.
//   Journal : `trainhub.log.AAAA-MM` (séance `free: true`, `sessionId: 'free'`) ; séance en cours : `trainhub.gsLive.v1` (`kind: 'free'`) ; séances refusées : `trainhub.recentRuns.v1` (3 jours).
//   LE CHRONO NE SUIT QUE LES SECONDES JOUÉES : un saut d'horloge (`fastForward`) ne compte que pour ~2 s. Les tests font donc avancer le temps par `runFor` (voir `ecouler`).
import type { Locator, Page } from '@playwright/test';
import { expect } from '../support/fixtures';
import { etatFiche, idExerciceDepart, journal, type ExoFiche } from '../fiche/aide-fiche';
import { auTelephone, lireEtat, ligneDepart } from '../bibliotheque/aide-bibliotheque';
import { MAINT, enregistrerSeance, fenetreSeance, journalDuMois, laisserPasser, ouvrirAvecHorloge, ouvrirSessions, sessionEnCours } from '../session/aide-session';

export { etatFiche, idExerciceDepart, journal, auTelephone, lireEtat, ligneDepart, MAINT, enregistrerSeance, fenetreSeance, journalDuMois, laisserPasser, ouvrirAvecHorloge, ouvrirSessions, sessionEnCours };

// ---------------------------------------------------------------------------------------------------------------------------------
// État de départ et horloge
// ---------------------------------------------------------------------------------------------------------------------------------
/** Un espace « Basse », un chapitre « Technique » dont TOUTES les fiches sont repliées : c'est le test qui décide quelle fiche s'affiche. */
export function etatLibre(titres: string[], extra: Record<string, unknown> = {}) {
  const exos: ExoFiche[] = titres.map((titre) => ({ titre, ferme: true }));
  const base: any = etatFiche(exos);
  if (Object.keys(extra).length) base.settings = { ...extra };
  return base;
}
/** Horloge figée au 25/11/2026 10:02 (le temps n'avance que par `ecouler`), appli ouverte sur `etatLibre(titres)`. */
export async function ouvrirLibre(page: Page, ouvrirAppli: (o?: any) => Promise<Page>, titres: string[] = ['Alpha', 'Bravo', 'Charlie'], options: Record<string, unknown> = {}) {
  await ouvrirAvecHorloge(page, ouvrirAppli, { etat: etatLibre(titres), ...options });
  await expect(ligneDepart(page, titres[0])).toBeVisible();   // le chapitre « Technique » est celui qui s'affiche au départ
}
/** Fait COURIR le temps seconde par seconde (l'appli ignore les sauts d'horloge : voir l'en-tête). */
export const ecouler = (page: Page, ms: number) => page.clock.runFor(ms);
export const sec = (n: number) => n * 1000;
export const min = (n: number) => n * 60_000;
/** Du clic qui affiche la fiche au premier instant où le chrono court : 1 s (l'appli ne remarque la fiche qu'au « tic » suivant, la barre passe alors à « Départ dans 10 s »), puis 10 s de décompte. */
export const DELAI_DEPART = 11_000;

// ---------------------------------------------------------------------------------------------------------------------------------
// La barre
// ---------------------------------------------------------------------------------------------------------------------------------
export const boutonLibre = (page: Page) => page.getByRole('button', { name: 'Entraînement libre', exact: true });
export const barre = (page: Page) => page.locator('#free-bar');
export const chrono = (page: Page) => barre(page).locator('.free-time');
export const quoi = (page: Page) => barre(page).locator('.free-what');
export const boutonPause = (page: Page) => barre(page).getByRole('button', { name: /^(Mettre en pause|Reprendre le décompte)$/ });
export const boutonArret = (page: Page) => barre(page).getByRole('button', { name: "Arrêter l'entraînement libre" });
export type EtatBarre = 'idle' | 'wait' | 'run' | 'paused';
export const verifierEtat = (page: Page, etat: EtatBarre) => expect(barre(page)).toHaveClass(new RegExp(`free-bar-${etat}\\b`));
/** Lit le chrono : « m:ss » ou « h:mm:ss » → secondes. */
export async function secondesChrono(page: Page): Promise<number> {
  const t = (await chrono(page).innerText()).trim();
  const m = /^(?:(\d+):)?(\d+):(\d\d)$/.exec(t);
  if (!m) throw new Error(`chrono libre illisible : « ${t} »`);
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
export const formater = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// Les pastilles par exercice
export const puces = (page: Page) => page.locator('#free-recap .free-chip');
export const puce = (page: Page, titre: string) => puces(page).filter({ has: page.locator('.free-chip-name', { hasText: new RegExp(`^${titre}$`) }) });
export const tempsPuce = (page: Page, titre: string) => puce(page, titre).locator('.free-chip-time');
/** Temps cumulé affiché sur la pastille d'un exercice, en secondes. */
export async function secondesPuce(page: Page, titre: string): Promise<number> {
  const t = (await tempsPuce(page, titre).innerText()).trim();
  const m = /^(?:(\d+):)?(\d+):(\d\d)$/.exec(t);
  if (!m) throw new Error(`pastille illisible : « ${t} »`);
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
export const titresPuces = (page: Page) => page.locator('#free-recap .free-chip .free-chip-name').allTextContents();

// ---------------------------------------------------------------------------------------------------------------------------------
// Fiches
// ---------------------------------------------------------------------------------------------------------------------------------
/** Déplie la fiche d'un exercice (clic sur l'espace libre de son en-tête) ; les autres se replient d'elles-mêmes. */
export async function afficher(page: Page, titre: string) {
  const f = ligneDepart(page, titre);
  await expect(f).toHaveClass(/collapsed/);
  await f.locator('.exercise-row-spacer').first().click();
  await expect(f).not.toHaveClass(/collapsed/);
}
/** Replie la fiche : plus aucun exercice n'est affiché. */
export async function replier(page: Page, titre: string) {
  const f = ligneDepart(page, titre);
  await expect(f).not.toHaveClass(/collapsed/);
  await f.locator('.exercise-row-spacer').first().click();
  await expect(f).toHaveClass(/collapsed/);
}
export const estAffiche = (page: Page, titre: string) => expect(ligneDepart(page, titre)).not.toHaveClass(/collapsed/);

// ---------------------------------------------------------------------------------------------------------------------------------
// Parcours
// ---------------------------------------------------------------------------------------------------------------------------------
/** Allume l'entraînement libre (rien n'est affiché : barre « Aucun exercice affiché »). */
export async function lancerLibre(page: Page) {
  await boutonLibre(page).click();
  await expect(barre(page)).toBeVisible();
}
/** Allume le libre puis affiche l'exercice et laisse passer les 10 s d'attente : le chrono court. */
export async function demarrerSur(page: Page, titre: string) {
  await lancerLibre(page);
  await afficher(page, titre);
  await ecouler(page, DELAI_DEPART);
  await verifierEtat(page, 'run');
}
/** Change d'exercice pendant la séance : affiche le nouveau, laisse passer l'attente. */
export async function passerA(page: Page, titre: string) {
  await afficher(page, titre);
  await ecouler(page, DELAI_DEPART);
  await verifierEtat(page, 'run');
}
/** Arrête avec le bouton ■ de la barre. Si la séance dure au moins 60 s, la fenêtre « Enregistrer cet entraînement ? » s'ouvre. */
export async function arreterLibre(page: Page) {
  await boutonArret(page).click();
  await laisserPasser(page, 50);   // la fenêtre s'ouvre par une minuterie ; 50 ms seulement : une seconde entière ajouterait un « tic » au dernier exercice
}
/** Arrête puis enregistre (sans connexion : la 2ᵉ confirmation « Enregistrer quand même »). */
export async function arreterEtEnregistrer(page: Page) {
  await arreterLibre(page);
  await expect(fenetreSeance(page)).toBeVisible();
  await enregistrerSeance(page);
}

/** Recharge la page (« fermeture brutale ») ; l'horloge restant figée, on la laisse courir 2 s pour que les fenêtres de reprise, qui s'ouvrent par minuterie, apparaissent. */
export async function recharger(page: Page) {
  await page.reload();
  await expect(page.locator('#folder-container')).toBeAttached();
  await laisserPasser(page, 2000);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Ce qui est enregistré
// ---------------------------------------------------------------------------------------------------------------------------------
/** Séances refusées (« Non enregistrées », 3 jours) : `trainhub.recentRuns.v1`. */
export async function nonEnregistrees(page: Page): Promise<any[]> {
  return page.evaluate(() => { const t = localStorage.getItem('trainhub.recentRuns.v1'); return t ? JSON.parse(t) : []; });
}
/** Les étapes d'une séance du journal : [titre, secondes passées]. */
export const etapesJournal = (s: any): Array<[string, number]> => (s.steps || []).map((x: any) => [x.title, x.actualSec]);
/** Attend (sans pause fixe) que la séance en cours enregistre ce temps passé sur un exercice. */
export async function attendreTempsPasse(page: Page, idStep: string, ms: number) {
  await expect.poll(async () => (await sessionEnCours(page))?.spent?.[idStep] ?? 0, { message: `temps passé sur ${idStep} enregistré` }).toBeGreaterThanOrEqual(ms);
}
export const idPas = (titre: string) => `free:${idExerciceDepart(titre)}`;

// ---------------------------------------------------------------------------------------------------------------------------------
// Fenêtre de fin
// ---------------------------------------------------------------------------------------------------------------------------------
export const champNomSeance = (page: Page) => fenetreSeance(page).getByRole('textbox', { name: 'Nom de la séance' });
/** La ligne d'un exercice dans la fenêtre de fin. */
export const ligneRecap = (page: Page, titre: string) => fenetreSeance(page).locator('.gs-rec-item').filter({ has: page.locator('.gs-rec-name', { hasText: new RegExp(`^${titre}`) }) });
export const minutesRecap = (page: Page, titre: string) => ligneRecap(page, titre).getByRole('spinbutton', { name: 'Minutes' });
export const secondesRecap = (page: Page, titre: string) => ligneRecap(page, titre).getByRole('spinbutton', { name: 'Secondes' });
export const tempoRecap = (page: Page, titre: string) => ligneRecap(page, titre).getByRole('spinbutton', { name: 'Tempo atteint (BPM)' });
export const retirerRecap = (page: Page, titre: string) => ligneRecap(page, titre).getByRole('button', { name: '✕' });
export const retablirRecap = (page: Page, titre: string) => ligneRecap(page, titre).getByRole('button', { name: 'Rétablir cet exercice dans la séance' });
export const resumeRecap = (page: Page) => fenetreSeance(page).locator('.gs-rec-sum');
export const boiteSeanceInterrompue = (page: Page) => page.getByRole('dialog', { name: /^Séance (interrompue|non enregistrée)$/ });
export type { Locator };
