// MODULE « synchro » — CONFLIT À LA PREMIÈRE SYNCHRO : un appareil qui se connecte à un compte déjà rempli.
// Observé en boîte noire (playwright-cli, 26/11/2026) : trois cas selon le contenu et la date de l'état local.
//   · local PLUS ANCIEN que le cloud : le cloud est repris sans question (une sauvegarde de secours de l'état remplacé est gardée) ;
//   · local PLUS RÉCENT et le cloud a plus d'UN exercice de plus : si l'appareil n'a aucun exercice, le cloud est repris (message « Données en ligne récupérées (N exercices). ») ;
//     sinon la fenêtre « Données en ligne trouvées » (« En ligne : 4 exercices. Sur cet appareil : 1 exercice. ») propose « Garder les données en ligne » (bouton d'Échap et d'un clic à côté)
//     ou « Remplacer par cet appareil… » qui demande une seconde confirmation (« Oui, remplacer » / « Non, garder les données en ligne ») ;
//   · local plus récent, écart d'un exercice au plus : aucune question, l'appareil écrase le cloud (« le plus récent gagne »).
// Tant que la question est ouverte, rien n'est écrit dans le cloud et la pastille reste sur « synchronisation en cours ».
import type { Page } from '@playwright/test';
import { test, expect, adresse, attendreSynchro, attendreTitresCloud, attendreTitresLocaux, connecter, etatDate, lancerConnexion, pastille, titresCloud } from './aide-synchro';
import { titresVue } from '../bibliotheque/aide-bibliotheque';

const EN_LIGNE = ['Cloud 1', 'Cloud 2', 'Cloud 3', 'Cloud 4'];
const lesTitres = (...t: string[]) => t.map((titre) => ({ titre }));
const dialogue = (page: Page, titre: string) => page.getByRole('dialog', { name: titre });
const question = (page: Page) => dialogue(page, 'Données en ligne trouvées');
const confirmation = (page: Page) => dialogue(page, 'Remplacer les données en ligne ?');
const PLUS_TARD = () => Date.now() + 120_000;

/** Un compte dont le cloud contient déjà `EN_LIGNE` (envoyé par un premier appareil, resté ouvert). Rend l'adresse, l'uid et le premier appareil. */
async function compteRempli(ouvrirAppli: (o?: any) => Promise<Page>, projet: string, prefixe: string, titres = EN_LIGNE) {
  const email = adresse(projet, prefixe);
  const a = await ouvrirAppli({ exercices: lesTitres(...titres) });
  const uid = await connecter(a, email);
  await attendreTitresCloud(uid, titres);
  return { email, uid, a };
}
/** Les sauvegardes de secours de l'appareil (`trainhub.backups.v1`) : motif, nombre d'exercices, titres. */
const sauvegardes = (page: Page) => page.evaluate(() => {
  const l = JSON.parse(localStorage.getItem('trainhub.backups.v1') || '[]');
  return l.map((b: any) => ({ motif: b.reason as string, n: b.count as number, json: b.json as string }));
});

test.describe('Synchro : conflit à la première connexion @synchro', () => {
  test.describe.configure({ timeout: 90_000 });   // la synchro attend un émulateur et un SDK réseau : sous la charge de la matrice complète, WebKit met parfois plus de 20 s à acquitter une écriture
  test('« Garder les données en ligne » : la fenêtre annonce les deux comptes d\'exercices, rien n\'est écrit tant qu\'on n\'a pas choisi, puis l\'appareil reprend les exercices du cloud @critique', async ({ ouvrirAppli, ouvrirAppareil }, testInfo) => {
    const { email, uid } = await compteRempli(ouvrirAppli, testInfo.project.name, 'e2e-garder');
    const b = await ouvrirAppareil({ etat: etatDate(lesTitres('Seul sur B'), PLUS_TARD()) });
    await lancerConnexion(b, email);

    await expect(question(b)).toBeVisible({ timeout: 15_000 });
    await expect(question(b)).toContainText('En ligne : 4 exercices. Sur cet appareil : 1 exercice.');
    const garder = question(b).getByRole('button', { name: 'Garder les données en ligne' });
    const remplacer = question(b).getByRole('button', { name: 'Remplacer par cet appareil…' });
    await expect(garder).toBeVisible();
    await expect(remplacer).toBeVisible();
    // La fenêtre tient dans l'écran (téléphone compris) et la pastille attend la réponse.
    const largeur = b.viewportSize()!.width;
    for (const bouton of [garder, remplacer]) { const m = (await bouton.boundingBox())!; expect(m.x).toBeGreaterThanOrEqual(0); expect(m.x + m.width).toBeLessThanOrEqual(largeur); }
    await expect(pastille(b)).toHaveAttribute('data-etat', 'syncing');
    expect(await titresCloud(uid)).toEqual(EN_LIGNE);   // rien n'est écrit tant que la question est ouverte
    expect(await titresVue(b)).toEqual(['Seul sur B']);

    await garder.click();
    await expect(question(b)).toBeHidden();
    await attendreSynchro(b);
    await expect.poll(() => titresVue(b)).toEqual(EN_LIGNE);
    await attendreTitresLocaux(b, EN_LIGNE);
    expect(await titresCloud(uid)).toEqual(EN_LIGNE);   // le cloud n'a pas bougé
  });

  test('« Remplacer par cet appareil… » demande une seconde confirmation qui dit ce qui sera effacé ; « Oui, remplacer » met le cloud à jour partout, une sauvegarde de secours garde l\'ancienne version @critique', async ({ ouvrirAppli, ouvrirAppareil }, testInfo) => {
    const { email, uid, a } = await compteRempli(ouvrirAppli, testInfo.project.name, 'e2e-remplacer');
    const b = await ouvrirAppareil({ etat: etatDate(lesTitres('Seul sur B'), PLUS_TARD()) });
    await lancerConnexion(b, email);
    await expect(question(b)).toBeVisible({ timeout: 15_000 });
    await question(b).getByRole('button', { name: 'Remplacer par cet appareil…' }).click();

    await expect(confirmation(b)).toBeVisible();
    await expect(confirmation(b)).toContainText(/^Remplacer les données en ligne \?Les 4 exercices en ligne seront remplacés par .*1 exercice de cet appareil, sur tous tes appareils\./);   // la grammaire de « les 1 exercice » : test SY-01 plus bas
    await expect(confirmation(b)).toContainText('Une sauvegarde de secours de la version en ligne est gardée.');
    expect(await titresCloud(uid)).toEqual(EN_LIGNE);   // pas encore : il reste « Non, garder »
    await confirmation(b).getByRole('button', { name: 'Oui, remplacer' }).click();
    await expect(confirmation(b)).toBeHidden();

    await attendreSynchro(b);
    await attendreTitresCloud(uid, ['Seul sur B']);
    await expect.poll(() => titresVue(b)).toEqual(['Seul sur B']);
    // Le premier appareil, resté connecté, reçoit le remplacement.
    await expect.poll(() => titresVue(a), { message: 'A voit le remplacement décidé sur B' }).toEqual(['Seul sur B']);
    // La version en ligne écrasée est gardée dans les sauvegardes de secours de B.
    const copie = (await sauvegardes(b)).find((s) => /Version cloud sur le point d'être remplacée/.test(s.motif));
    expect(copie, 'sauvegarde de secours de la version en ligne').toBeTruthy();
    expect(copie!.n).toBe(4);
    for (const t of EN_LIGNE) expect(copie!.json).toContain(t);
  });

  test('à la seconde confirmation, « Non, garder les données en ligne » abandonne le remplacement @critique', async ({ ouvrirAppli, ouvrirAppareil }, testInfo) => {
    const { email, uid } = await compteRempli(ouvrirAppli, testInfo.project.name, 'e2e-non');
    const b = await ouvrirAppareil({ etat: etatDate(lesTitres('Seul sur B', 'Aussi sur B'), PLUS_TARD()) });
    await lancerConnexion(b, email);
    await expect(question(b)).toContainText('En ligne : 4 exercices. Sur cet appareil : 2 exercices.');
    await question(b).getByRole('button', { name: 'Remplacer par cet appareil…' }).click();
    await expect(confirmation(b)).toContainText('Les 4 exercices en ligne seront remplacés par les 2 exercices de cet appareil');
    await confirmation(b).getByRole('button', { name: 'Non, garder les données en ligne' }).click();
    await expect(confirmation(b)).toBeHidden();
    await attendreSynchro(b);
    await expect.poll(() => titresVue(b)).toEqual(EN_LIGNE);
    expect(await titresCloud(uid)).toEqual(EN_LIGNE);
  });

  test('Échap sur la première fenêtre vaut « Garder les données en ligne » (le choix sûr) ; un clic à côté aussi', async ({ ouvrirAppli, ouvrirAppareil }, testInfo) => {
    const { email, uid } = await compteRempli(ouvrirAppli, testInfo.project.name, 'e2e-echap');
    const b = await ouvrirAppareil({ etat: etatDate(lesTitres('Seul sur B'), PLUS_TARD()) });
    await lancerConnexion(b, email);
    await expect(question(b)).toBeVisible({ timeout: 15_000 });
    await b.keyboard.press('Escape');
    await expect(question(b)).toBeHidden();
    await attendreSynchro(b);
    await expect.poll(() => titresVue(b)).toEqual(EN_LIGNE);
    expect(await titresCloud(uid)).toEqual(EN_LIGNE);

    // Un autre appareil, même situation : clic hors de la fenêtre.
    const c = await ouvrirAppareil({ etat: etatDate(lesTitres('Seul sur C'), PLUS_TARD()) });
    await lancerConnexion(c, email);
    await expect(question(c)).toBeVisible({ timeout: 15_000 });
    await c.mouse.click(2, 2);
    await expect(question(c)).toBeHidden();
    await attendreSynchro(c);
    await expect.poll(() => titresVue(c)).toEqual(EN_LIGNE);
    expect(await titresCloud(uid)).toEqual(EN_LIGNE);
  });

  test('un appareil qui n\'a aucun exercice reprend le cloud sans question, avec un message qui le dit @critique', async ({ ouvrirAppli, ouvrirAppareil }, testInfo) => {
    const { email, uid } = await compteRempli(ouvrirAppli, testInfo.project.name, 'e2e-vide');
    // État vide mais « récent » (vidé puis touché il y a peu) : c'est le cas que l'appli veut empêcher d'écraser le cloud avec du vide.
    const b = await ouvrirAppareil({ etat: etatDate([], PLUS_TARD()) });
    await lancerConnexion(b, email);
    await expect(b.locator('.toast').filter({ hasText: 'Données en ligne récupérées (4 exercices).' })).toBeVisible({ timeout: 15_000 });
    await expect(b.getByRole('dialog')).toBeHidden();
    await expect.poll(() => titresVue(b)).toEqual(EN_LIGNE);
    await attendreSynchro(b);
    expect(await titresCloud(uid)).toEqual(EN_LIGNE);   // le vide n'a PAS écrasé le cloud
  });

  test('un appareil plus ancien que le cloud est remplacé sans question, même avec plus d\'exercices ; l\'état remplacé est gardé en sauvegarde de secours @critique', async ({ ouvrirAppli, ouvrirAppareil }, testInfo) => {
    const { email, uid } = await compteRempli(ouvrirAppli, testInfo.project.name, 'e2e-ancien', ['Cloud récent']);
    const vieux = lesTitres('Vieux 1', 'Vieux 2', 'Vieux 3', 'Vieux 4', 'Vieux 5');
    const b = await ouvrirAppareil({ etat: etatDate(vieux, 1_000) });
    await lancerConnexion(b, email);
    await attendreSynchro(b);
    await expect(b.getByRole('dialog')).toBeHidden();
    await expect.poll(() => titresVue(b)).toEqual(['Cloud récent']);
    expect(await titresCloud(uid)).toEqual(['Cloud récent']);
    const copie = (await sauvegardes(b)).find((s) => /Avant remplacement par une version reçue d'un autre appareil/.test(s.motif));
    expect(copie, 'sauvegarde de secours de l\'état remplacé').toBeTruthy();
    expect(copie!.n).toBe(5);
    for (const t of ['Vieux 1', 'Vieux 5']) expect(copie!.json).toContain(t);
  });

  test('plus récent mais à un exercice près : aucune question, l\'appareil écrase le cloud (le plus récent gagne)', async ({ ouvrirAppli, ouvrirAppareil }, testInfo) => {
    const { email, uid, a } = await compteRempli(ouvrirAppli, testInfo.project.name, 'e2e-ecart1', ['Cloud 1', 'Cloud 2']);
    const b = await ouvrirAppareil({ etat: etatDate(lesTitres('Seul sur B'), PLUS_TARD()) });
    await lancerConnexion(b, email);
    await attendreSynchro(b);
    await expect(b.getByRole('dialog')).toBeHidden();
    await attendreTitresCloud(uid, ['Seul sur B']);
    await expect.poll(() => titresVue(a)).toEqual(['Seul sur B']);
  });

  test('la seconde confirmation s\'écrit correctement au singulier : pas « les 1 exercice » (une seule fiche sur l\'appareil)', async ({ ouvrirAppli, ouvrirAppareil }, testInfo) => {
    test.fail(true, 'SY-01 : la seconde fenêtre dit « remplacés par les 1 exercice de cet appareil » (article pluriel devant un singulier)');
    const { email } = await compteRempli(ouvrirAppli, testInfo.project.name, 'e2e-grammaire');
    const b = await ouvrirAppareil({ etat: etatDate(lesTitres('Seul sur B'), PLUS_TARD()) });
    await lancerConnexion(b, email);
    await expect(question(b)).toBeVisible({ timeout: 15_000 });
    await question(b).getByRole('button', { name: 'Remplacer par cet appareil…' }).click();
    await expect(confirmation(b)).toContainText('remplacés par');
    await expect(confirmation(b)).not.toContainText(/\bles 1 exercice\b/);
  });
});
