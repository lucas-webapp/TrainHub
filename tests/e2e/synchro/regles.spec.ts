// MODULE « synchro » — RÈGLES DE SÉCURITÉ Firestore (`firestore.rules`, copie de celles de la production, appliquées par l'émulateur) : seul l'utilisateur connecté lit et écrit
// `users/{son uid}/apps/{document}`. Les quatre familles de documents de TrainHub (état, journal, capture, morceau de fichier) sont sous ce chemin. Tout le reste est refusé (403), à
// l'inconnu comme à un AUTRE compte, en lecture comme en écriture, et même au propriétaire hors de `users/{uid}/apps/`. On vérifie aussi par le vrai SDK de l'appli (permission-denied).
// Les requêtes REST portent le jeton d'un compte fictif de l'émulateur Auth (jamais la production, jamais le jeton « owner » qui contourne les règles).
import type { Page } from '@playwright/test';
import { test, expect, adresse, attendreSynchro, connecter, document, documents, FIRESTORE, PROJET, poserDocument } from './aide-synchro';
import { creerCompte } from '../support/emulateurs';
import { etatFiche, exo, fiche, ouvrirTechnique, png, ajouterFichiers, sansBlobIndexedDB } from '../fiche/aide-fiche';

const RACINE = `http://${FIRESTORE}/v1/projects/${PROJET}/databases/(default)/documents`;
type Methode = 'GET' | 'PATCH' | 'DELETE';
/** Une requête REST vers l'émulateur, avec le jeton donné (aucun = inconnu). Rend le statut HTTP. */
async function requete(chemin: string, methode: Methode, jeton?: string): Promise<number> {
  const entetes: Record<string, string> = { 'Content-Type': 'application/json' };
  if (jeton) entetes.Authorization = `Bearer ${jeton}`;
  const r = await fetch(`${RACINE}/${chemin}`, { method: methode, headers: entetes, body: methode === 'PATCH' ? JSON.stringify({ fields: { piege: { stringValue: 'écrit par un intrus' } } }) : undefined });
  return r.status;
}
const jetonDe = (page: Page) => page.evaluate(() => (window as any).firebase.auth().currentUser.getIdToken() as Promise<string>);
/** Le code d'erreur que renvoie le SDK de la page pour une lecture / écriture du chemin donné ('ok' si elle réussit). */
const codeSdk = (page: Page, chemin: string, ecrire = false) => page.evaluate(async ([chemin, ecrire]) => {
  const ref = (window as any).firebase.firestore().doc(chemin as string);
  try { if (ecrire) await ref.set({ piege: 'écrit par un intrus' }); else await ref.get(); return 'ok'; } catch (e: any) { return String(e.code || e.message); }
}, [chemin, ecrire] as const);

/** Un compte avec les quatre familles de documents : état, journal du mois, capture (posée dans l'émulateur) et un morceau de fichier. */
async function compteComplet(ouvrirAppli: (o?: any) => Promise<Page>, projet: string, prefixe: string) {
  const page = await ouvrirAppli({ exercices: [{ titre: 'Secret' }], reglages: { 'trainhub.log.2026-11': JSON.stringify({ records: [{ v: 2, id: 's1', instrumentId: 'e2e-esp-0', date: Date.parse('2026-11-10T18:00:00+01:00'), totalSec: 300, steps: [] }], deleted: [], updatedAt: 1 }) } });
  const uid = await connecter(page, adresse(projet, prefixe));
  await poserDocument(uid, 'trainhub-img-i1', { data: 'data:image/png;base64,AAAA', type: 'image/png', name: 'x.png', updatedAt: 1 });
  await poserDocument(uid, 'trainhub-file-f1-0', { i: 0, n: 1, bytes: { octets: 'AAAA' }, updatedAt: 1 });
  await expect.poll(() => documents(uid)).toEqual(['trainhub', 'trainhub-file-f1-0', 'trainhub-img-i1', 'trainhub-log-2026-11']);
  return { page, uid };
}
const FAMILLES = ['trainhub', 'trainhub-log-2026-11', 'trainhub-img-i1', 'trainhub-file-f1-0'];

test.describe('Synchro : règles de sécurité Firestore @synchro', () => {
  test.describe.configure({ timeout: 90_000 });   // la synchro attend un émulateur et un SDK réseau : sous la charge de la matrice complète, WebKit met parfois plus de 20 s à acquitter une écriture
  test('un inconnu (sans jeton) ne peut ni lire, ni écrire, ni supprimer aucune des quatre familles de documents d\'un compte ; rien n\'est modifié @critique', async ({ ouvrirAppli }, testInfo) => {
    const { uid } = await compteComplet(ouvrirAppli, testInfo.project.name, 'e2e-regle-inconnu');
    const avant = JSON.stringify(await Promise.all(FAMILLES.map((d) => document(uid, d))));
    for (const d of FAMILLES) {
      expect(await requete(`users/${uid}/apps/${d}`, 'GET'), `lecture de ${d} par un inconnu`).toBe(403);
      expect(await requete(`users/${uid}/apps/${d}`, 'PATCH'), `écriture de ${d} par un inconnu`).toBe(403);
      expect(await requete(`users/${uid}/apps/${d}`, 'DELETE'), `suppression de ${d} par un inconnu`).toBe(403);
    }
    expect(await requete(`users/${uid}/apps`, 'GET'), 'liste des documents par un inconnu').toBe(403);
    expect(JSON.stringify(await Promise.all(FAMILLES.map((d) => document(uid, d))))).toBe(avant);   // rien n'a bougé
  });

  test('un AUTRE compte (jeton valide mais pas le sien) reçoit 403 en lecture, écriture, suppression et liste ; rien n\'est modifié @critique', async ({ ouvrirAppli }, testInfo) => {
    const { uid } = await compteComplet(ouvrirAppli, testInfo.project.name, 'e2e-regle-autre');
    const intrus = await creerCompte(adresse(testInfo.project.name, 'e2e-intrus'));
    expect(intrus.uid).not.toBe(uid);
    const avant = JSON.stringify(await Promise.all(FAMILLES.map((d) => document(uid, d))));
    for (const d of FAMILLES) {
      expect(await requete(`users/${uid}/apps/${d}`, 'GET', intrus.idToken), `lecture de ${d} par un autre compte`).toBe(403);
      expect(await requete(`users/${uid}/apps/${d}`, 'PATCH', intrus.idToken), `écriture de ${d} par un autre compte`).toBe(403);
      expect(await requete(`users/${uid}/apps/${d}`, 'DELETE', intrus.idToken), `suppression de ${d} par un autre compte`).toBe(403);
    }
    expect(await requete(`users/${uid}/apps`, 'GET', intrus.idToken), 'liste des documents par un autre compte').toBe(403);
    expect(JSON.stringify(await Promise.all(FAMILLES.map((d) => document(uid, d))))).toBe(avant);
  });

  test('le propriétaire (jeton de la page connectée) lit ses quatre familles de documents et peut en écrire ; hors de users/{uid}/apps/ tout est refusé, même pour lui @critique', async ({ ouvrirAppli }, testInfo) => {
    const { page, uid } = await compteComplet(ouvrirAppli, testInfo.project.name, 'e2e-regle-proprio');
    const jeton = await jetonDe(page);
    for (const d of FAMILLES) expect(await requete(`users/${uid}/apps/${d}`, 'GET', jeton), `lecture de ${d} par son propriétaire`).toBe(200);
    expect(await requete(`users/${uid}/apps`, 'GET', jeton)).toBe(200);
    expect(await requete(`users/${uid}/apps/trainhub-log-2026-12`, 'PATCH', jeton), 'écriture d\'un nouveau document de l\'appli').toBe(200);
    expect(await requete(`users/${uid}/apps/trainhub-log-2026-12`, 'DELETE', jeton)).toBe(200);
    // Hors du chemin prévu : refusé.
    for (const chemin of [`users/${uid}`, `users/${uid}/autre/x`, `users/${uid}/apps/trainhub/sous/x`, 'public/x', `partage/${uid}`]) {
      expect(await requete(chemin, 'PATCH', jeton), `écriture de ${chemin} par son propriétaire`).toBe(403);
    }
    expect(await requete('users', 'GET', jeton), 'liste de tous les utilisateurs').toBe(403);
  });

  test('par le SDK de l\'appli : un autre compte reçoit « permission-denied » sur les documents d\'un compte, en lecture comme en écriture @critique', async ({ ouvrirAppli, ouvrirAppareil }, testInfo) => {
    const { uid } = await compteComplet(ouvrirAppli, testInfo.project.name, 'e2e-regle-sdk');
    const autre = await ouvrirAppareil({ exercices: [{ titre: 'Autre compte' }] });
    const uidAutre = await connecter(autre, adresse(testInfo.project.name, 'e2e-regle-sdk-autre'));
    expect(uidAutre).not.toBe(uid);
    for (const d of FAMILLES) {
      expect(await codeSdk(autre, `users/${uid}/apps/${d}`), `lecture de ${d}`).toBe('permission-denied');
      expect(await codeSdk(autre, `users/${uid}/apps/${d}`, true), `écriture de ${d}`).toBe('permission-denied');
    }
    expect(await codeSdk(autre, `users/${uidAutre}/apps/trainhub`), 'ses propres documents').toBe('ok');
    // L'autre compte ne voit rien d'étranger dans son appli, et ses propres exercices partent bien.
    await attendreSynchro(autre);
    await expect(autre.locator('#folder-container input.exercise-title')).toHaveCount(1);
    expect((await document(uid, 'trainhub')).instruments[0].categories[0].exercises[0].title).toBe('Secret');
  });

  test('par le SDK de l\'appli, sans être connecté : « permission-denied » partout ; l\'appli reste utilisable en local @critique', async ({ ouvrirAppli, ouvrirAppareil }, testInfo) => {
    const { uid } = await compteComplet(ouvrirAppli, testInfo.project.name, 'e2e-regle-sdk-anonyme');
    const anonyme = await ouvrirAppareil({ exercices: [{ titre: 'Sans compte' }] });
    expect(await anonyme.evaluate(() => (window as any).firebase.auth().currentUser)).toBeNull();
    for (const d of FAMILLES) {
      expect(await codeSdk(anonyme, `users/${uid}/apps/${d}`), `lecture de ${d}`).toBe('permission-denied');
      expect(await codeSdk(anonyme, `users/${uid}/apps/${d}`, true), `écriture de ${d}`).toBe('permission-denied');
    }
    await expect(anonyme.locator('#folder-container input.exercise-title').first()).toHaveValue('Sans compte');
  });

  test('une capture envoyée par l\'appli n\'est lisible que par son propriétaire : l\'identifiant du document ne protège pas, les règles oui', async ({ ouvrirAppli, browserName }, testInfo) => {
    sansBlobIndexedDB(test, browserName);
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']) });
    const uid = await connecter(page, adresse(testInfo.project.name, 'e2e-regle-capture'));
    await ouvrirTechnique(page);
    await ajouterFichiers(page, fiche(page, 'Gamme'), png('rouge.png'));
    await expect.poll(async () => (await exo(page, 'Gamme')).images?.[0]?.cloud, { timeout: 20_000 }).toBe(true);
    const id = (await exo(page, 'Gamme')).images[0].id;
    const chemin = `users/${uid}/apps/trainhub-img-${id}`;
    expect(await requete(chemin, 'GET')).toBe(403);
    expect(await requete(chemin, 'GET', (await creerCompte(adresse(testInfo.project.name, 'e2e-intrus-capture'))).idToken)).toBe(403);
    expect(await requete(chemin, 'GET', await jetonDe(page))).toBe(200);
  });
});
