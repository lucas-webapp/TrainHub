// MODULE « demarrage » — LES DEUX MODES DE L'APPLI : sans connexion (tout reste dans le navigateur) et avec une connexion Google FICTIVE.
// La connexion passe par l'ÉMULATEUR Auth : jeton Google non signé, accepté par l'émulateur seulement (jamais un vrai compte Google).
// Les règles Firestore de production (firestore.rules) sont appliquées par l'émulateur : on vérifie aussi qu'un inconnu ne lit rien.
// Le détail de la synchro (2ᵉ appareil, conflit, journal, captures, fichiers…) est l'affaire du module `synchro`.
import { test, expect } from '../support/fixtures';
import { lireDocument, PROJET, FIRESTORE } from '../support/emulateurs';

const unique = (projet: string, prefixe: string) => `${prefixe}-${projet}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@exemple.test`;

test.describe('Deux modes : sans connexion, et connexion Google fictive @critique @demarrage', () => {
  test('sans connexion, l\'exercice reste dans le navigateur et rien n\'est écrit dans Firestore', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ exercices: [{ titre: 'Arpèges sans compte' }] });
    await expect(page.locator('#folder-container .exercise .exercise-title').first()).toHaveValue('Arpèges sans compte');
    await expect(page.locator('#google-signin-btn')).toBeVisible();
    await expect(page.locator('#account-info')).toBeHidden();
    const r = await fetch(`http://${FIRESTORE}/v1/projects/${PROJET}/databases/(default)/documents/users`, { headers: { Authorization: 'Bearer owner' } });
    const j: any = await r.json();
    expect(j.documents ?? []).toEqual([]);
  });

  test('connecté avec un compte Google FICTIF : les exercices partent dans Firestore, sous ce compte seulement', async ({ ouvrirAppli }, testInfo) => {
    const page = await ouvrirAppli({ exercices: [{ titre: 'Walking bass connecté' }] });
    const email = unique(testInfo.project.name, 'e2e-connexion');
    const uid = await page.evaluate(async (email) => {
      const fb = (window as any).firebase;
      const jeton = JSON.stringify({ sub: 'g-' + email, email, email_verified: true, name: 'Testeur E2E' });
      const r = await fb.auth().signInWithCredential(fb.auth.GoogleAuthProvider.credential(jeton));
      return r.user.uid as string;
    }, email);
    // la pilule devient le compte (pastille d'état + nom), puis « Synchronisé »
    await expect(page.locator('#account-info')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#sync-status')).toHaveAttribute('data-etat', 'synced', { timeout: 20_000 });
    // Le document de l'appli apparaît sous users/{uid}/apps/trainhub (lu par l'API de l'émulateur, en contournant les règles) et porte l'exercice.
    await expect.poll(async () => JSON.stringify(await lireDocument(`users/${uid}/apps/trainhub`)), { timeout: 20_000 }).toContain('Walking bass connecté');
    // Les règles de production : un inconnu (sans jeton) ne lit PAS ce document.
    const anonyme = await fetch(`http://${FIRESTORE}/v1/projects/${PROJET}/databases/(default)/documents/users/${uid}/apps/trainhub`);
    expect(anonyme.status).toBe(403);
  });

  test('la fenêtre « Se connecter avec Google » ouvre celle de l\'émulateur (compte fictif)', async ({ ouvrirAppli }, testInfo) => {
    // Le SDK Auth charge son chargeur de fenêtres depuis apis.google.com (script public de Google, pas le projet) : bloqué par le réseau
    // « Limité » de la VM cloud. Ce test tourne donc en CI ; dans la VM il est sauté, et le dit.
    const joignable = await fetch('https://apis.google.com/js/api.js', { method: 'HEAD' }).then(r => r.ok, () => false);
    test.skip(!joignable, 'apis.google.com injoignable depuis cet environnement (réseau « Limité ») : test de la fenêtre de connexion en CI seulement');
    const page = await ouvrirAppli({ accueil: 'garder', gapi: true });
    const email = unique(testInfo.project.name, 'e2e-fenetre');
    const fenetre = page.waitForEvent('popup');
    await page.locator('#cloud-guard-modal').getByRole('button', { name: 'Se connecter avec Google' }).click();
    const popup = await fenetre;
    await popup.waitForLoadState();
    expect(new URL(popup.url()).host).toMatch(/^127\.0\.0\.1:\d+$/);   // la fenêtre de l'émulateur local, jamais accounts.google.com
    await popup.getByRole('button', { name: /add new account/i }).click();
    await popup.getByLabel(/email/i).fill(email);
    await popup.getByRole('button', { name: /sign in with google\.com/i }).click();
    await expect(page.locator('#account-info')).toBeVisible({ timeout: 20_000 });
  });
});
