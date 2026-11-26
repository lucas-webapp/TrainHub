// MODULE « libre » — CHANGER D'EXERCICE pendant que le chrono tourne, et PLUSIEURS exercices dans une même séance. Observé en boîte noire (playwright-cli, 25/11/2026) : ouvrir une autre fiche
// remet le décompte de 10 s ; le chrono total continue ensuite, mais le temps est compté sur le nouvel exercice. Une pastille par exercice (la plus récente en premier) montre son temps cumulé.
// Un exercice affiché moins de 10 s (jamais « parti ») ne laisse aucune trace. Le tic de 1 s : à l'instant où on change de fiche, l'ancien exercice peut encore gagner une seconde.
import { test, expect } from '../support/fixtures';
import { etatBibliotheque, ouvrirChapitre } from '../bibliotheque/aide-bibliotheque';
import { ouvrirAvecHorloge } from '../session/aide-session';
import {
  afficher, arreterEtEnregistrer, barre, chrono, ecouler, etapesJournal, journalDuMois, lancerLibre, ouvrirLibre, passerA, puce, puces, replier, sec, min, secondesChrono, secondesPuce, demarrerSur, tempsPuce,
  titresPuces, verifierEtat, formater, sessionEnCours, DELAI_DEPART,
} from './aide-libre';

test.describe('Libre : changer d\'exercice @libre', () => {
  test('ouvrir une autre fiche pendant que ça tourne : le décompte repart, puis le chrono bascule sur l\'exercice affiché @critique', async ({ page, ouvrirAppli, garde }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, sec(30));
    await expect(chrono(page)).toHaveText('0:30');
    await expect(puce(page, 'Alpha')).toHaveClass(/free-chip-now/);
    // On passe à « Bravo » : fiche d'« Alpha » repliée, décompte avant départ.
    await afficher(page, 'Bravo');
    await ecouler(page, sec(1));
    await verifierEtat(page, 'wait');
    await expect(barre(page)).toHaveAttribute('title', 'Entraînement libre — Départ dans 10 s');
    await expect(puce(page, 'Alpha')).not.toHaveClass(/free-chip-now/);
    const total = await secondesChrono(page);
    expect(total).toBeGreaterThanOrEqual(30);
    expect(total).toBeLessThanOrEqual(31);
    await ecouler(page, sec(10));   // pendant l'attente rien n'est compté
    await verifierEtat(page, 'run');
    expect(await secondesChrono(page)).toBe(total);
    await expect(barre(page)).toHaveAttribute('title', 'Entraînement libre — Bravo');
    await ecouler(page, sec(20));
    expect(await secondesChrono(page)).toBe(total + 20);
    await expect(puce(page, 'Bravo')).toHaveClass(/free-chip-now/);
    await expect(tempsPuce(page, 'Bravo')).toHaveText('0:20');
    expect(await secondesPuce(page, 'Alpha')).toBe(total);   // l'ancien exercice est figé
    expect(await titresPuces(page)).toEqual(['Bravo', 'Alpha']);   // le plus récent en premier
    expect(garde.bloquees).toEqual([]);
  });

  test('revenir sur un exercice déjà travaillé : son temps reprend où il s\'était arrêté, une seule pastille par exercice', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, sec(40));
    await passerA(page, 'Bravo');
    await ecouler(page, sec(15));
    await passerA(page, 'Alpha');
    await ecouler(page, sec(10));
    expect(await titresPuces(page)).toEqual(['Alpha', 'Bravo']);
    await expect(puces(page)).toHaveCount(2);
    const a = await secondesPuce(page, 'Alpha'), b = await secondesPuce(page, 'Bravo');
    expect(a).toBeGreaterThanOrEqual(50);   // 40 s puis 10 s, à la seconde du changement près
    expect(a).toBeLessThanOrEqual(52);
    expect(b).toBeGreaterThanOrEqual(15);
    expect(b).toBeLessThanOrEqual(16);
    expect(await secondesChrono(page)).toBe(a + b);
  });

  test('changer de fiche avant la fin des 10 s : le premier exercice n\'a jamais couru, il ne laisse aucune pastille', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await lancerLibre(page);
    await afficher(page, 'Alpha');
    await ecouler(page, sec(4));
    await verifierEtat(page, 'wait');
    await afficher(page, 'Bravo');
    await ecouler(page, sec(1));
    await expect(barre(page)).toHaveAttribute('title', 'Entraînement libre — Départ dans 10 s');   // le décompte repart de zéro
    await ecouler(page, DELAI_DEPART - sec(1));
    await verifierEtat(page, 'run');
    await ecouler(page, sec(12));
    await expect(chrono(page)).toHaveText('0:12');
    expect(await titresPuces(page)).toEqual(['Bravo']);
    expect((await sessionEnCours(page)).steps.map((s: any) => s.exerciseId)).toEqual(['ex-bravo']);
  });

  test('trois exercices dans la même séance : une pastille chacun, et le journal garde l\'ordre de travail et le temps passé sur chacun @critique', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, min(1) + sec(10));
    await passerA(page, 'Bravo');
    await ecouler(page, sec(45));
    await passerA(page, 'Charlie');
    await ecouler(page, sec(30));
    expect(await titresPuces(page)).toEqual(['Charlie', 'Bravo', 'Alpha']);
    const [c, b, a] = [await secondesPuce(page, 'Charlie'), await secondesPuce(page, 'Bravo'), await secondesPuce(page, 'Alpha')];
    expect(c).toBe(30);
    expect(b).toBeGreaterThanOrEqual(45);
    expect(b).toBeLessThanOrEqual(46);
    expect(a).toBeGreaterThanOrEqual(70);
    expect(a).toBeLessThanOrEqual(71);
    expect(await secondesChrono(page)).toBe(a + b + c);
    await arreterEtEnregistrer(page);
    const seances = await journalDuMois(page);
    expect(seances).toHaveLength(1);
    const etapes = etapesJournal(seances[0]);
    expect(etapes.map(([t]) => t)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    // Le journal arrondit à la seconde : au plus une seconde de plus que la pastille (la fraction de seconde en cours à l'arrêt).
    for (const [t, vu] of [['Alpha', a], ['Bravo', b], ['Charlie', c]] as const) {
      const note = etapes.find(([x]) => x === t)![1];
      expect(note, t).toBeGreaterThanOrEqual(vu);
      expect(note, t).toBeLessThanOrEqual(vu + 1);
    }
    expect(seances[0]).toMatchObject({ free: true, sessionId: 'free', name: 'Session libre' });
    expect(seances[0].totalSec).toBe(etapes.reduce((n, [, s]) => n + s, 0));
  });

  test('un exercice affiché puis replié sans avoir couru n\'entre pas dans la séance', async ({ page, ouvrirAppli }) => {
    await ouvrirLibre(page, ouvrirAppli);
    await demarrerSur(page, 'Alpha');
    await ecouler(page, sec(20));
    await afficher(page, 'Bravo');
    await ecouler(page, sec(3));
    await replier(page, 'Bravo');
    await ecouler(page, sec(2));
    await verifierEtat(page, 'idle');
    expect(await titresPuces(page)).toEqual(['Alpha']);
    expect(formater(await secondesPuce(page, 'Alpha'))).toMatch(/^0:2[01]$/);
  });

  test('aller dans un autre chapitre : l\'exercice n\'est plus à l\'écran, le chrono attend ; en afficher un là-bas continue la même séance', async ({ page, ouvrirAppli }) => {
    const etat = etatBibliotheque([{ nom: 'Basse', chapitres: [{ nom: 'Technique', exercices: ['Alpha'] }, { nom: 'Impro', exercices: ['Delta'] }] }]);
    await ouvrirAvecHorloge(page, ouvrirAppli, { etat });
    await demarrerSur(page, 'Alpha');
    await ecouler(page, sec(20));
    await ouvrirChapitre(page, 'Impro');
    await ecouler(page, sec(2));
    await verifierEtat(page, 'idle');   // « Alpha » n'est plus affiché
    const fige = await secondesChrono(page);
    expect(fige).toBeGreaterThanOrEqual(20);
    expect(fige).toBeLessThanOrEqual(22);
    await ecouler(page, sec(30));
    expect(await secondesChrono(page)).toBe(fige);
    await passerA(page, 'Delta');
    await ecouler(page, sec(15));
    expect(await secondesChrono(page)).toBe(fige + 15);
    expect(await titresPuces(page)).toEqual(['Delta', 'Alpha']);
  });
});
