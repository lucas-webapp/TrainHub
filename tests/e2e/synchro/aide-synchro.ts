// MODULE « synchro » — AIDES communes aux fichiers *.spec.ts du dossier (pas un test : le nom ne finit pas par .spec.ts).
// Vocabulaire de l'appli, observé en boîte noire (playwright-cli, 26/11/2026) :
//   connecté (compte Google FICTIF de l'émulateur Auth), l'appli écrit sous `users/{uid}/apps/` : `trainhub` (l'état entier, champs Firestore natifs ; `settings.logRev` = révision de chaque
//   mois du journal), `trainhub-log-AAAA-MM` (journal du mois : `records`, `deleted`, `updatedAt`), `trainhub-img-<id>` (capture en base64 dans `data`), `trainhub-file-<cid>-<n>` (morceaux
//   de 800 Kio d'un fichier joint : `bytes`, `i`, `n`). La pastille `#sync-status` porte `data-etat` : `synced` | `pending` (modification en attente, envoi différé de 1,5 s) | `syncing` | `error`.
//   RÈGLE DE FUSION : l'état le plus récent gagne (`updatedAt`) ; le journal est fusionné séance par séance. À la 1re connexion d'un appareil dont l'état est PLUS RÉCENT que le cloud mais
//   qui a plus d'un exercice de MOINS que lui, l'appli demande quoi garder (fenêtre « Données en ligne trouvées ») ; appareil sans aucun exercice : le cloud est repris sans question.
//   Un second appareil = un SECOND contexte Playwright (stockage séparé), même compte ; il passe par `ouvrirAppareil` (même garde-fou anti-production que le premier).
import type { BrowserContext, Page } from '@playwright/test';
import { test as base, expect } from '../support/fixtures';
import { DOMAINES_PRODUCTION, FIRESTORE, PROJET, exigerProjetDemo, lireDocument } from '../support/emulateurs';
import { URL_EXTERNES_COUPEES, apiYouTubeFactice, etatDeDepart, ExerciceDeDepart, CLE_ETAT, CLE_NE_PLUS_PROPOSER } from '../support/appli';

export { lireDocument, PROJET, FIRESTORE };

// ---------------------------------------------------------------------------------------------------------------------------------
// Second appareil : un autre contexte, même profil (écran, agent, langue, fuseau) que le projet en cours
// ---------------------------------------------------------------------------------------------------------------------------------
type OptionsAppareil = { exercices?: ExerciceDeDepart[]; etat?: unknown; reglages?: Record<string, string>; accueil?: 'passer' | 'garder' | 'jamais' };

export const test = base.extend<{ ouvrirAppareil: (options?: OptionsAppareil) => Promise<Page> }>({
  ouvrirAppareil: async ({ browser, baseURL, garde }, use, testInfo) => {
    const contextes: BrowserContext[] = [];
    await use(async (options = {}) => {
      const u: any = testInfo.project.use;
      const context = await browser.newContext({
        baseURL, viewport: u.viewport, userAgent: u.userAgent, deviceScaleFactor: u.deviceScaleFactor, isMobile: u.isMobile, hasTouch: u.hasTouch,
        locale: u.locale, timezoneId: u.timezoneId, serviceWorkers: 'block',
      });
      contextes.push(context);
      // Le même garde-fou que la fixture `garde` du premier appareil : une requête de production est interrompue et NOTÉE dans la même liste (le test échoue à la fin).
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (DOMAINES_PRODUCTION.test(url.hostname)) { garde.bloquees.push(url.href); return route.abort('blockedbyclient'); }
        return route.fallback();
      });
      await context.route(URL_EXTERNES_COUPEES, (route) => route.abort('blockedbyclient'));
      const api = apiYouTubeFactice(baseURL!);
      await context.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: api }));

      const page = await context.newPage();
      const etat = options.etat ?? (options.exercices ? etatDeDepart(options.exercices) : null);
      await page.addInitScript(([e, reglages, cleEtat, cleNePlus, jamais]) => {
        if (sessionStorage.getItem('e2e-graine')) return;   // une seule fois : un rechargement garde ce que l'utilisateur a fait
        sessionStorage.setItem('e2e-graine', '1');
        if (e) localStorage.setItem(cleEtat, JSON.stringify(e));
        if (jamais) localStorage.setItem(cleNePlus, '1');
        for (const [k, v] of Object.entries(reglages || {})) localStorage.setItem(k, v as string);
      }, [etat, options.reglages || {}, CLE_ETAT, CLE_NE_PLUS_PROPOSER, options.accueil === 'jamais'] as const);
      await page.goto('/index.html');
      await expect(page.locator('#folder-container')).toBeAttached();
      const accueil = page.locator('#cloud-guard-modal'), pilule = page.locator('#google-signin-btn, #account-info');
      await expect(accueil.or(pilule).first()).toBeVisible({ timeout: 15_000 });
      if ((options.accueil ?? 'passer') === 'passer' && await accueil.isVisible()) {
        await page.locator('#cloud-guard-continue').click();
        await expect(accueil).toBeHidden();
      }
      return page;
    });
    for (const c of contextes) await c.close();
  },
});
export { expect };

// ---------------------------------------------------------------------------------------------------------------------------------
// Connexion (compte fictif de l'émulateur Auth : jeton Google non signé, accepté par l'émulateur seulement)
// ---------------------------------------------------------------------------------------------------------------------------------
/** Une adresse fictive unique (un compte par test : les tests tournent en parallèle sur les mêmes émulateurs). */
export const adresse = (projet: string, prefixe: string) => `${prefixe}-${projet}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@exemple.test`;

/** Lance la connexion (même compte = même uid) et rend l'uid ; n'attend PAS la fin de la synchro (voir `connecter`). */
export async function lancerConnexion(page: Page, email: string, nom = 'Testeur E2E'): Promise<string> {
  return page.evaluate(async ([email, nom]) => {
    const fb = (window as any).firebase;
    const jeton = JSON.stringify({ sub: 'g-' + email, email, email_verified: true, name: nom });
    const r = await fb.auth().signInWithCredential(fb.auth.GoogleAuthProvider.credential(jeton));
    return r.user.uid as string;
  }, [email, nom]);
}
export const pastille = (page: Page) => page.locator('#sync-status');
/** Note, dans la page, chaque état que prend la pastille (`data-etat`) à partir de maintenant : « en attente » ne dure que 1,5 s, et une machine
 *  chargée peut ne le regarder qu'après coup. On vérifie alors que l'état a bien été traversé (sans dépendre de l'instant où on le regarde). */
export async function noterEtatsPastille(page: Page) {
  await page.evaluate(() => {
    const el = document.querySelector('#sync-status')!;
    const w = window as any;
    w.__etatsPastille = [el.getAttribute('data-etat')];
    new MutationObserver(() => { const e = el.getAttribute('data-etat'); if (w.__etatsPastille[w.__etatsPastille.length - 1] !== e) w.__etatsPastille.push(e); })
      .observe(el, { attributes: true, attributeFilter: ['data-etat'] });
  });
}
/** Les états notés par `noterEtatsPastille`, dans l'ordre. */
export const etatsPastille = (page: Page) => page.evaluate(() => (window as any).__etatsPastille as string[]);
export const pilule = (page: Page) => page.locator('#account-info');
/** Attend la pastille « Synchronisé » (`data-etat="synced"`). */
export const attendreSynchro = (page: Page) => expect(pastille(page)).toHaveAttribute('data-etat', 'synced', { timeout: 30_000 });
/** Connecte la page et attend « Synchronisé » ; rend l'uid. */
export async function connecter(page: Page, email: string, nom = 'Testeur E2E'): Promise<string> {
  const uid = await lancerConnexion(page, email, nom);
  await expect(pilule(page)).toBeVisible({ timeout: 15_000 });
  await attendreSynchro(page);
  return uid;
}
/** Déconnecte par le menu du compte (pastille › « Se déconnecter »). */
export async function deconnecter(page: Page) {
  await pilule(page).click();
  await page.getByRole('menuitem', { name: /^Se déconnecter/ }).click();
  await expect(page.locator('#google-signin-btn')).toBeVisible();
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Lire et écrire Firestore (émulateur seulement, jeton « owner » qui contourne les règles : pour VÉRIFIER et pour PRÉPARER, jamais pour faire à la place de l'appli)
// ---------------------------------------------------------------------------------------------------------------------------------
const RACINE = () => `http://${FIRESTORE}/v1/projects/${PROJET}/databases/(default)/documents`;
/** Valeur Firestore (REST) → valeur JavaScript. Les octets restent en base64 (chaîne). */
export function decoder(v: any): any {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('bytesValue' in v) return v.bytesValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decoder);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, decoder(x)]));
  return v;
}
/** Valeur JavaScript → valeur Firestore (REST). `{ octets: 'base64' }` donne un champ d'octets. */
export function encoder(v: any): any {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encoder) } };
  if (typeof v === 'object' && 'octets' in v) return { bytesValue: v.octets };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encoder(x)])) } };
}
/** Le document `users/{uid}/apps/{doc}` décodé (null s'il n'existe pas). */
export async function document(uid: string, doc: string): Promise<any | null> {
  const brut = await lireDocument(`users/${uid}/apps/${doc}`);
  return brut ? decoder({ mapValue: { fields: brut.fields || {} } }) : null;
}
/** Les identifiants des documents sous `users/{uid}/apps/` (état, journal, images, morceaux de fichiers). */
export async function documents(uid: string): Promise<string[]> {
  exigerProjetDemo();
  const r = await fetch(`${RACINE()}/users/${uid}/apps?pageSize=300`, { headers: { Authorization: 'Bearer owner' } });
  const j: any = await r.json();
  return (j.documents || []).map((d: any) => String(d.name).split('/').pop()).sort();
}
/** Prépare un document dans l'émulateur (jeton « owner »). Réservé aux tests qui éprouvent la LECTURE d'un second appareil ; le reste du temps, c'est l'appli qui écrit. */
export async function poserDocument(uid: string, doc: string, valeur: Record<string, unknown>) {
  exigerProjetDemo();
  const champs = (encoder(valeur) as any).mapValue.fields;
  const r = await fetch(`${RACINE()}/users/${uid}/apps/${doc}`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: champs }) });
  if (!r.ok) throw new Error(`Écriture de ${doc} impossible : ${r.status} ${await r.text()}`);
}
/** Tous les exercices d'un état (cloud ou local), dossiers compris. */
export function exercicesDe(etat: any): any[] {
  const sortie: any[] = [];
  const dossier = (n: any) => { (n.exercises || []).forEach((e: any) => sortie.push(e)); (n.folders || []).forEach(dossier); };
  (etat?.instruments || []).forEach((i: any) => (i.categories || []).forEach(dossier));
  return sortie;
}
/** Titres des exercices du document principal du cloud. */
export async function titresCloud(uid: string): Promise<string[]> {
  return exercicesDe(await document(uid, 'trainhub')).map((e) => e.title);
}
/** Attend (sans pause fixe) que les titres du cloud soient exactement ceux-ci (dans l'ordre). */
export async function attendreTitresCloud(uid: string, attendus: string[]) {
  await expect.poll(() => titresCloud(uid), { message: 'exercices du document trainhub dans Firestore', timeout: 20_000 }).toEqual(attendus);
}
/** Titres des exercices de l'état enregistré dans la page (`trainhub.v1`), tous dossiers confondus. */
export async function titresLocaux(page: Page): Promise<string[]> {
  const etat = await page.evaluate((cle) => { const t = localStorage.getItem(cle); return t ? JSON.parse(t) : null; }, CLE_ETAT);
  return exercicesDe(etat).map((e) => e.title);
}
export async function attendreTitresLocaux(page: Page, attendus: string[]) {
  await expect.poll(() => titresLocaux(page), { message: 'exercices enregistrés dans le navigateur', timeout: 20_000 }).toEqual(attendus);
}
/** Les séances d'un mois dans le cloud (`trainhub-log-AAAA-MM`). */
export async function seancesCloud(uid: string, mois = '2026-11'): Promise<any[]> {
  return (await document(uid, `trainhub-log-${mois}`))?.records ?? [];
}
/** Les séances d'un mois dans le navigateur (`trainhub.log.AAAA-MM`). */
export async function seancesLocales(page: Page, mois = '2026-11'): Promise<any[]> {
  return page.evaluate((m) => { const t = localStorage.getItem('trainhub.log.' + m); return t ? JSON.parse(t).records : []; }, mois);
}
export const idsSeances = (liste: any[]) => liste.map((s) => s.id).sort();

/** Un exercice de départ à `n` exemplaires numérotés : « Gamme 1 »… */
export const numerotes = (prefixe: string, n: number): ExerciceDeDepart[] => Array.from({ length: n }, (_, i) => ({ titre: `${prefixe} ${i + 1}` }));

/** Un état de départ daté (`updatedAt` choisi) : « plus ancien » ou « plus récent » que le cloud, ce qui décide qui gagne à la connexion. */
export function etatDate(exercices: ExerciceDeDepart[], updatedAt: number) {
  return { ...etatDeDepart(exercices), updatedAt };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Journal des séances
// ---------------------------------------------------------------------------------------------------------------------------------
export const T = (iso: string) => new Date(iso).getTime();
export type SeanceDepart = { id: string; date: number; titres: string[]; minutes?: number; maj?: number };
/** Le journal d'un mois posé dans `trainhub.log.AAAA-MM` (à passer dans `reglages`), avec des identifiants de séance choisis (deux appareils ne doivent pas se ressembler par hasard). */
export function journalMois(mois: string, seances: SeanceDepart[], supprimees: string[] = [], maj = 1) {
  const records = seances.map((s) => ({
    v: 2, id: s.id, instrumentId: 'e2e-esp-0', date: s.date, endedAt: s.date + 1_200_000, totalSec: 60 * (s.minutes ?? 5) * s.titres.length, plannedSec: 60 * (s.minutes ?? 5) * s.titres.length,
    steps: s.titres.map((t, j) => ({ sid: `${s.id}-${j}`, exerciseId: `e2e-ex-${j}`, title: t, chapterId: 'e2e-ch-0', chapterName: 'Technique', path: ['Technique'], pathIds: ['e2e-ch-0'], plannedMin: s.minutes ?? 5,
      actualSec: 60 * (s.minutes ?? 5), bpmFirst: null, bpmMax: null, bpmEnd: null })),
  }));
  return { [`trainhub.log.${mois}`]: JSON.stringify({ records, deleted: supprimees, updatedAt: maj }) };
}

/** « Session guidée › Historique › ＋ Séance passée » : une séance saisie à la main (date choisie) avec un exercice de la bibliothèque. Connecté, aucune question « Pas connecté à Google ». */
export async function ajouterSeancePassee(page: Page, o: { nom: string; date: string; heure?: string; exercice: string; minutes: number }) {
  await page.getByRole('button', { name: 'Session guidée' }).click();
  await expect(page.getByRole('button', { name: '+ Nouvelle session' })).toBeVisible();
  await page.getByRole('button', { name: /^Historique/ }).click();
  const historique = page.locator('.gs-history-panel');
  await expect(historique).toBeVisible();
  await historique.getByRole('button', { name: /^＋ Séance passée/ }).click();
  const p = page.locator('.gs-save-run-panel:visible');
  await p.locator('input[type=text]').first().fill(o.nom);
  await p.locator('input[type=date]').fill(o.date);
  await p.locator('input[type=time]').fill(o.heure ?? '18:30');
  await p.getByRole('button', { name: '＋ Ajouter un exercice' }).click();
  await page.getByRole('button', { name: 'Tout déplier' }).click();
  await page.getByRole('button', { name: o.exercice, exact: true }).click();
  await p.locator('input[type=number]').first().fill(String(o.minutes));
  await p.locator('input[type=number]').first().press('Tab');
  await p.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(historique).toContainText(o.nom);
  return historique;
}
