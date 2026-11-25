// MODULE « session » — CRÉER une session : du bouton « Session » à la session enregistrée dans la liste. Observé en boîte noire (playwright-cli, 25/11/2026) :
// « + Nouvelle session » ouvre le choix des exercices ; chaque exercice a un rond (vide, puis son rang dans la session) ; « Terminer » mène à l'éditeur où la session
// s'appelle « Nouvelle session » ; « Enregistrer » devient « Enregistré » (désactivé) ; la session apparaît dans la liste (« 3 exercices · 16 min »). Les détails fins
// du choix et de la rafale sont tenus par les bancs `choix` et `rafale` (PLAN § 7).
import { test, expect } from '../support/fixtures';
import {
  ajouterExercice, annulerEdition, bandeau, boutonEnregistrer, boutonLancerEditeur, champCommentaire, champNom, choisir, etoile, etapes, etatSession, ligneSession, nouvelleSession, ouvrirChoix,
  ouvrirSessions, rondExercice, sessionEnregistree, sessionsEnregistrees, termine, totalEditeur, titreEcran, retourListe, dureeEtape, retraitsBandeau,
} from './aide-session';

const EXOS = ['Alpha', 'Bravo', 'Charlie', 'Delta'];

test.describe('Session : créer @session', () => {
  test('du bouton « Session » à la liste : choisir trois exercices, nommer, noter, commenter, enregistrer @critique', async ({ ouvrirAppli, garde }) => {
    const page = await ouvrirAppli({ etat: etatSession(EXOS) });
    await ouvrirSessions(page);
    await expect(page.getByText("Aucune session pour l'instant.")).toBeVisible();
    await ouvrirChoix(page);
    await choisir(page, 'Alpha', 'Bravo', 'Charlie');
    await termine(page).click();

    // L'éditeur : nom par défaut, trois étapes de 5 minutes, « Enregistrer » prêt, « Lancer la session » prêt.
    await expect(champNom(page)).toHaveValue('Nouvelle session');
    await expect(etapes(page)).toHaveCount(3);
    await expect(totalEditeur(page)).toHaveText('Durée totale : 15 min');
    await expect(boutonEnregistrer(page)).toHaveText('Enregistrer');
    await champNom(page).fill('Échauffement du soir');
    await champCommentaire(page).fill('Bon enchaînement');
    await etoile(page, 4).click();
    await expect(etoile(page, 4)).toBeChecked();
    await boutonEnregistrer(page).click();
    await expect(page.getByRole('button', { name: 'Enregistré' })).toBeDisabled();

    // Enregistré tel quel dans l'état de l'appli.
    await expect.poll(() => sessionEnregistree(page, 'Échauffement du soir')).toMatchObject({ exercices: ['Alpha', 'Bravo', 'Charlie'], minutes: [5, 5, 5], note: 4, commentaire: 'Bon enchaînement' });

    // La liste la montre, et elle survit au rechargement.
    await retourListe(page).click();
    await expect(titreEcran(page)).toBeVisible();
    await expect(ligneSession(page, 'Échauffement du soir')).toContainText('3 exercices · 15 min');
    await expect(ligneSession(page, 'Échauffement du soir').getByRole('radio', { name: /^4 sur 5/ })).toBeChecked();
    await page.reload();
    await ouvrirSessions(page);
    await expect(ligneSession(page, 'Échauffement du soir')).toHaveCount(1);
    expect(garde.bloquees).toEqual([]);
  });

  test('le rond de rang numérote dans l\'ordre du clic ; cliquer un rond numéroté retire l\'exercice et renumérote les suivants', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatSession(EXOS) });
    await ouvrirSessions(page);
    await ouvrirChoix(page);
    await expect(rondExercice(page, 'Alpha')).toHaveAccessibleName('Pas encore dans la session Alpha');
    // En rafale : Charlie, Alpha, Delta, dans cet ordre.
    await choisir(page, 'Charlie', 'Alpha', 'Delta');
    await expect(rondExercice(page, 'Charlie')).toHaveAccessibleName('1 Charlie');
    await expect(rondExercice(page, 'Alpha')).toHaveAccessibleName('2 Alpha');
    await expect(rondExercice(page, 'Delta')).toHaveAccessibleName('3 Delta');
    await expect(rondExercice(page, 'Bravo')).toHaveAccessibleName('Pas encore dans la session Bravo');
    await expect(page.getByText('3 ajoutés à la session')).toBeVisible();
    // Retirer Alpha (rang 2) : Delta passe au rang 2.
    await rondExercice(page, 'Alpha').click();
    await expect(rondExercice(page, 'Alpha')).toHaveAccessibleName('Pas encore dans la session Alpha');
    await expect(rondExercice(page, 'Delta')).toHaveAccessibleName('2 Delta');
    await expect(rondExercice(page, 'Charlie')).toHaveAccessibleName('1 Charlie');
  });

  test('le bandeau « Ma session » suit les choix : durées, total, retrait par ✕ ; le même exercice peut revenir', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatSession(EXOS) });
    await ouvrirSessions(page);
    await ouvrirChoix(page);
    await expect(bandeau(page)).toContainText('Clique sur des exercices');
    await choisir(page, 'Alpha', 'Bravo');
    await expect(bandeau(page)).toContainText('Alpha');
    await expect(bandeau(page)).toContainText('Bravo');
    await expect(bandeau(page)).toContainText('10 min');
    // Durée modifiable : › ajoute une minute, la saisie remplace.
    await bandeau(page).getByRole('button', { name: 'Augmenter' }).first().click();
    await expect(bandeau(page)).toContainText('11 min');
    await bandeau(page).getByRole('spinbutton', { name: 'Durée en minutes' }).nth(1).fill('20');
    await bandeau(page).getByRole('spinbutton', { name: 'Durée en minutes' }).nth(1).press('Tab');
    await expect(bandeau(page)).toContainText('26 min');
    // ✕ retire Alpha ; le rond d'Alpha redevient vide et Bravo passe au rang 1.
    await retraitsBandeau(page).first().click();
    await expect(retraitsBandeau(page)).toHaveCount(1);
    await expect(rondExercice(page, 'Alpha')).toHaveAccessibleName('Pas encore dans la session Alpha');
    await expect(rondExercice(page, 'Bravo')).toHaveAccessibleName('1 Bravo');
    await expect(bandeau(page)).toContainText('20 min');
    await choisir(page, 'Alpha');
    await expect(rondExercice(page, 'Alpha')).toHaveAccessibleName('2 Alpha');
  });

  test('l\'éditeur : durées modifiables par chevrons et par saisie, ✕ retire une étape, le total suit, « + Ajouter un exercice » rouvre le choix', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatSession(EXOS) });
    await ouvrirSessions(page);
    await ouvrirChoix(page);
    await choisir(page, 'Alpha', 'Bravo', 'Charlie');
    await termine(page).click();
    await expect(totalEditeur(page)).toHaveText('Durée totale : 15 min');
    await dureeEtape(page, 'Alpha').fill('12');
    await dureeEtape(page, 'Alpha').press('Tab');
    await expect(totalEditeur(page)).toHaveText('Durée totale : 22 min');
    await etapes(page).nth(1).getByRole('button', { name: 'Diminuer' }).click();
    await expect(dureeEtape(page, 'Bravo')).toHaveValue('4');
    await expect(totalEditeur(page)).toHaveText('Durée totale : 21 min');
    await etapes(page).nth(2).getByRole('button', { name: '✕' }).click();
    await expect(etapes(page)).toHaveCount(2);
    await expect(totalEditeur(page)).toHaveText('Durée totale : 16 min');
    // Ajouter un exercice : le choix revient avec les deux premiers déjà numérotés.
    await ajouterExercice(page).click();
    await page.getByRole('button', { name: 'Tout déplier' }).click();
    await expect(rondExercice(page, 'Alpha')).toHaveAccessibleName('1 Alpha');
    await choisir(page, 'Delta');
    await expect(rondExercice(page, 'Delta')).toHaveAccessibleName('3 Delta');
    await termine(page).click();
    await expect(etapes(page)).toHaveCount(3);
    await boutonEnregistrer(page).click();
    await expect.poll(() => sessionsEnregistrees(page).then((l) => l[0])).toMatchObject({ exercices: ['Alpha', 'Bravo', 'Delta'], minutes: [12, 4, 5] });
  });

  test('« Annuler » défait les changements non enregistrés ; la note s\'efface en recliquant l\'étoile', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatSession(EXOS, [{ nom: 'Grille', exercices: [['Alpha', 6], ['Bravo', 5]], note: 3 }]) });
    await ouvrirSessions(page);
    await ligneSession(page, 'Grille').locator('.gs-session-name').click();
    await expect(champNom(page)).toHaveValue('Grille');
    await expect(boutonEnregistrer(page)).toHaveText('Enregistré');
    await champNom(page).fill('Autre nom');
    await dureeEtape(page, 'Alpha').fill('9');
    await dureeEtape(page, 'Alpha').press('Tab');
    await expect(boutonEnregistrer(page)).toHaveText('Enregistrer');
    await annulerEdition(page).click();
    await expect(champNom(page)).toHaveValue('Grille');
    await expect(dureeEtape(page, 'Alpha')).toHaveValue('6');
    expect(await sessionEnregistree(page, 'Grille')).toMatchObject({ minutes: [6, 5], note: 3 });
    // Re-cliquer l'étoile cochée efface la note, et c'est enregistré aussitôt (la note n'est pas un changement « à valider »).
    await etoile(page, 3).click();
    await expect(etoile(page, 3)).not.toBeChecked();
    await expect(boutonEnregistrer(page)).toHaveText('Enregistré');
    await expect.poll(async () => (await sessionEnregistree(page, 'Grille'))?.note).toBeUndefined();
  });

  test('« Lancer la session » reste grisé tant qu\'il n\'y a aucun exercice ; « Terminer » n\'apparaît qu\'après un choix', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatSession(EXOS) });
    await ouvrirSessions(page);
    await nouvelleSession(page).click();
    await expect(champNom(page)).toHaveValue('Nouvelle session');
    await expect(boutonLancerEditeur(page)).toBeDisabled();
    await ajouterExercice(page).click();
    await page.getByRole('button', { name: 'Tout déplier' }).click();
    await expect(termine(page)).toBeHidden();
    await choisir(page, 'Bravo');
    await expect(termine(page)).toBeVisible();
    await termine(page).click();
    await expect(boutonLancerEditeur(page)).toBeEnabled();
    // Retirer l'unique étape : plus rien à lancer.
    await etapes(page).first().getByRole('button', { name: '✕' }).click();
    await expect(etapes(page)).toHaveCount(0);
    await expect(boutonLancerEditeur(page)).toBeDisabled();
  });
});
