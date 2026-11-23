// Réglages des émulateurs Firebase et garde-fous COMMUNS (rien de propre à une appli ici : l'appli se décrit dans `appli.ts`).
// Le projet de test est TOUJOURS un projet `demo-…` : Firebase n'y attache aucune ressource réelle, donc même une erreur de configuration
// ne peut pas atteindre la production.
export const PROJET = process.env.GCLOUD_PROJECT || process.env.PROJET_TEST || 'demo-trainhub';
export const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8180';
export const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9199';

export function exigerProjetDemo(projet: string = PROJET): void {
  if (!/^demo-[a-z0-9-]+$/.test(projet)) {
    throw new Error(`GARDE-FOU : le projet de test « ${projet} » n'est pas un projet « demo-… ». Refus de démarrer (aucune requête ne doit pouvoir atteindre un vrai projet Firebase).`);
  }
}

// Domaines de la PRODUCTION Firebase / Google : toute requête vers eux est interrompue et fait échouer le test (fixture `garde`).
export const DOMAINES_PRODUCTION = /(^|\.)(firestore|identitytoolkit|securetoken|firebaseinstallations|firebasestorage|firebase|firebaseremoteconfig|firebaselogging-pa|cloudfunctions|analytics)\.googleapis\.com$|\.firebaseio\.com$|\.firebaseapp\.com$|\.cloudfunctions\.net$|\.web\.app$|^www\.googleapis\.com$/;

// Remise à zéro des émulateurs (API REST de l'émulateur) : entre deux passages, dans le globalSetup.
export async function remettreAZero(): Promise<void> {
  exigerProjetDemo();
  const r1 = await fetch(`http://${FIRESTORE}/emulator/v1/projects/${PROJET}/databases/(default)/documents`, { method: 'DELETE' });
  const r2 = await fetch(`http://${AUTH}/emulator/v1/projects/${PROJET}/accounts`, { method: 'DELETE' });
  if (!r1.ok || !r2.ok) throw new Error(`Remise à zéro des émulateurs impossible (Firestore ${r1.status}, Auth ${r2.status})`);
}

// Un compte FICTIF dans l'émulateur Auth (jamais un vrai compte Google) : rend son uid et son jeton.
export async function creerCompte(email: string, motDePasse = 'mot-de-passe-de-test'): Promise<{ uid: string; idToken: string }> {
  exigerProjetDemo();
  const r = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-cle-de-test`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: motDePasse, returnSecureToken: true }),
  });
  const j: any = await r.json();
  if (!r.ok) throw new Error(`Compte fictif non créé : ${JSON.stringify(j)}`);
  return { uid: j.localId, idToken: j.idToken };
}

// Lire un document de l'émulateur Firestore en contournant les règles (jeton « owner » de l'émulateur) : pour VÉRIFIER ce que l'appli a écrit.
export async function lireDocument(chemin: string): Promise<any | null> {
  exigerProjetDemo();
  const r = await fetch(`http://${FIRESTORE}/v1/projects/${PROJET}/databases/(default)/documents/${chemin}`, { headers: { Authorization: 'Bearer owner' } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Lecture de ${chemin} : ${r.status}`);
  return r.json();
}
