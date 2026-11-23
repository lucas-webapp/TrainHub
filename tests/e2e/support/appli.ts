// CE QUI EST PROPRE À TRAINHUB pour les tests (le reste de `support/` est commun aux trois applis, repris d'HarmoHub).
// Le SDK Firebase (compat 10.13.2, depuis node_modules) et la configuration `demo-…` branchée sur les émulateurs sont servis par
// scripts/serveur-test.cjs, sans modifier l'appli. TrainHub n'expose aucune variable globale : on relit son état dans localStorage.
import fs from 'fs';
import path from 'path';

// Ressources externes sans rapport avec Firebase, interrompues partout pour que la VM et la CI testent la même chose :
// police Google (la police de repli suffit) ; scripts Google que le SDK Auth précharge pour sa fenêtre de connexion (l'émulateur n'en a pas
// besoin) ; YouTube (remplacé par le faux lecteur ci-dessous) et ses vignettes ; Google Drive (liens de fichiers).
export const URL_EXTERNES_COUPEES = /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|apis\.google\.com|accounts\.google\.com|www\.youtube\.com|www\.youtube-nocookie\.com|i\.ytimg\.com|img\.youtube\.com|drive\.google\.com|drive\.usercontent\.google\.com)\//;

// Faux lecteur YouTube : celui des bancs (tests/playwright/yt_mock_api.js, inchangé), dont l'iframe est servie par le serveur de test
// sur le port suivant (autre origine que l'appli, comme le vrai YouTube).
export function apiYouTubeFactice(baseURL: string): string {
  const u = new URL(baseURL);
  const origineLecteur = `http://${u.hostname}:${Number(u.port) + 1}/tests/playwright/yt_mock/`;
  const api = fs.readFileSync(path.join(__dirname, '..', '..', 'playwright', 'yt_mock_api.js'), 'utf8');
  return api.replace('http://localhost:8766/', origineLecteur);
}

// Clés de stockage de TrainHub.
export const CLE_ETAT = 'trainhub.v1';
export const CLE_NE_PLUS_PROPOSER = 'compteCloud.trainhub.nePlusProposer';

// Un état de départ minimal, posé dans localStorage AVANT le chargement (mode « sans connexion »). L'appli normalise le reste.
export type ExerciceDeDepart = { titre: string; notes?: string };
export function etatDeDepart(exercices: ExerciceDeDepart[], chapitre = 'Technique', espace = 'Basse') {
  const maintenant = Date.now();
  const id = (p: string, i: number) => `e2e-${p}-${i}`;
  return {
    instruments: [{
      id: id('esp', 0), name: espace,
      categories: [{ id: id('ch', 0), name: chapitre, folders: [], exercises: exercices.map((e, i) => ({ id: id('ex', i), title: e.titre, notes: e.notes ?? '', updatedAt: maintenant })) }],
    }],
    activeInstrumentId: id('esp', 0),
    updatedAt: maintenant,
  };
}
