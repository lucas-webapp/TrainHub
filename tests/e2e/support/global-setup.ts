// GARDE-FOU N° 1 : refuse de démarrer si le projet n'est pas un projet `demo-…` ou si les émulateurs ne répondent pas, puis remet les émulateurs à zéro.
import { PROJET, FIRESTORE, AUTH, exigerProjetDemo, remettreAZero } from './emulateurs';

export default async function globalSetup(): Promise<void> {
  exigerProjetDemo(PROJET);
  for (const [nom, hote] of [['Firestore', FIRESTORE], ['Auth', AUTH]] as const) {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(hote)) throw new Error(`GARDE-FOU : l'émulateur ${nom} doit être local (reçu « ${hote} »).`);
    try {
      const r = await fetch(`http://${hote}/`);
      if (!r.ok && r.status !== 404) throw new Error(`statut ${r.status}`);
    } catch (e: any) {
      throw new Error(`GARDE-FOU : l'émulateur ${nom} ne répond pas sur ${hote} (${e.message}). Lancer les tests par « npm run test:e2e » (il démarre les émulateurs), ou démarrer « npm run emulateurs » d'abord.`);
    }
  }
  await remettreAZero();
}
