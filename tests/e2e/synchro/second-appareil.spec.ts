// MODULE « synchro » — SECOND APPAREIL : un second contexte Playwright (stockage séparé, comme un autre navigateur ou un téléphone), MÊME compte fictif.
// Observé en boîte noire (playwright-cli, 26/11/2026) : un appareil vierge qui se connecte reçoit l'état du cloud aussitôt (aucune question : il n'a rien à perdre) ; un appareil déjà connecté
// écoute le document (onSnapshot) et se met à jour SANS rechargement quand un autre appareil enregistre ; l'état le plus récent gagne.
import { test, expect, adresse, attendreSynchro, attendreTitresCloud, attendreTitresLocaux, connecter, numerotes, pastille } from './aide-synchro';
import { actionExercice, ajouterExercice, confirmer, ligne, titresVue } from '../bibliotheque/aide-bibliotheque';

test.describe('Synchro : second appareil, même compte @synchro', () => {
  test.describe.configure({ timeout: 90_000 });   // la synchro attend un émulateur et un SDK réseau : sous la charge de la matrice complète, WebKit met parfois plus de 20 s à acquitter une écriture
  test('un appareil vierge qui se connecte reçoit tous les exercices du compte, sans fenêtre de conflit @critique', async ({ ouvrirAppli, ouvrirAppareil }, testInfo) => {
    const email = adresse(testInfo.project.name, 'e2e-relecture');
    const a = await ouvrirAppli({ exercices: [{ titre: 'Walking bass' }, { titre: 'Arpèges' }, { titre: 'Slap' }] });
    const uid = await connecter(a, email);
    await attendreTitresCloud(uid, ['Walking bass', 'Arpèges', 'Slap']);

    const b = await ouvrirAppareil();   // aucun état de départ : les exercices par défaut de l'appli (espace vide)
    expect(await titresVue(b)).toEqual([]);
    expect(await connecter(b, email)).toBe(uid);

    await expect(b.getByRole('dialog')).toBeHidden();   // aucun choix à faire
    await expect.poll(() => titresVue(b)).toEqual(['Walking bass', 'Arpèges', 'Slap']);
    await attendreTitresLocaux(b, ['Walking bass', 'Arpèges', 'Slap']);   // et gardés dans le navigateur de B
    // Le cloud n'a pas été touché par la connexion de B (mêmes exercices, dans le même ordre).
    await attendreTitresCloud(uid, ['Walking bass', 'Arpèges', 'Slap']);
    // Après rechargement de B, tout est encore là sans reconnexion.
    await b.reload();
    await expect(pastille(b)).toHaveAttribute('data-etat', 'synced', { timeout: 20_000 });
    await expect.poll(() => titresVue(b)).toEqual(['Walking bass', 'Arpèges', 'Slap']);
  });

  test('deux appareils connectés : un ajout, un renommage et une suppression faits sur l\'un apparaissent sur l\'autre sans rechargement, dans les deux sens @critique', async ({ ouvrirAppli, ouvrirAppareil }, testInfo) => {
    const email = adresse(testInfo.project.name, 'e2e-direct');
    const a = await ouvrirAppli({ exercices: [{ titre: 'Gamme de do' }] });
    const uid = await connecter(a, email);
    await attendreTitresCloud(uid, ['Gamme de do']);
    const b = await ouvrirAppareil();
    await connecter(b, email);
    await expect.poll(() => titresVue(b)).toEqual(['Gamme de do']);

    // A → B : ajout.
    await ajouterExercice(a, 'Ajouté sur A');
    await attendreSynchro(a);
    await expect.poll(() => titresVue(b), { message: 'B voit l\'ajout fait sur A' }).toEqual(['Gamme de do', 'Ajouté sur A']);
    await attendreSynchro(b);

    // B → A : renommage.
    const titreB = (await ligne(b, 'Gamme de do')).locator('input.exercise-title').first();
    await titreB.fill('Gamme de do majeur');
    await titreB.press('Enter');
    await attendreSynchro(b);
    await expect.poll(() => titresVue(a), { message: 'A voit le renommage fait sur B' }).toEqual(['Gamme de do majeur', 'Ajouté sur A']);
    await attendreTitresCloud(uid, ['Gamme de do majeur', 'Ajouté sur A']);

    // A → B : suppression.
    await actionExercice(a, await ligne(a, 'Ajouté sur A'), 'Supprimer…');
    await confirmer(a, 'Supprimer');
    await attendreSynchro(a);
    await expect.poll(() => titresVue(b), { message: 'B voit la suppression faite sur A' }).toEqual(['Gamme de do majeur']);
    await attendreTitresCloud(uid, ['Gamme de do majeur']);
  });

  test('le plus récent gagne : deux modifications successives du même exercice sur deux appareils, c\'est la dernière qui reste partout @critique', async ({ ouvrirAppli, ouvrirAppareil }, testInfo) => {
    const email = adresse(testInfo.project.name, 'e2e-recent');
    const a = await ouvrirAppli({ exercices: [{ titre: 'Titre d\'origine' }] });
    const uid = await connecter(a, email);
    const b = await ouvrirAppareil();
    await connecter(b, email);
    await expect.poll(() => titresVue(b)).toEqual(['Titre d\'origine']);

    const renommer = async (page: typeof a, de: string, vers: string) => {
      const champ = (await ligne(page, de)).locator('input.exercise-title').first();
      await champ.fill(vers);
      await champ.press('Enter');
      await attendreSynchro(page);
    };
    await renommer(a, 'Titre d\'origine', 'Version de A');
    await expect.poll(() => titresVue(b)).toEqual(['Version de A']);
    await renommer(b, 'Version de A', 'Version de B');   // plus tard, sur l'autre appareil
    await expect.poll(() => titresVue(a)).toEqual(['Version de B']);
    await attendreTitresCloud(uid, ['Version de B']);
    await attendreTitresLocaux(a, ['Version de B']);
    await attendreTitresLocaux(b, ['Version de B']);
  });

  test('un compte bien rempli arrive entier sur le second appareil : mêmes exercices, mêmes identifiants, même espace', async ({ ouvrirAppli, ouvrirAppareil }, testInfo) => {
    const email = adresse(testInfo.project.name, 'e2e-identique');
    const a = await ouvrirAppli({ exercices: numerotes('Gamme', 6) });
    const uid = await connecter(a, email);
    const b = await ouvrirAppareil();
    await connecter(b, email);
    const attendus = numerotes('Gamme', 6).map((e) => e.titre);
    await attendreTitresCloud(uid, attendus);
    await expect.poll(() => titresVue(b)).toEqual(attendus);
    // Les identifiants (ce qui relie un exercice à ses séances, ses copies liées…) sont ceux de A ; l'état normalisé de B peut avoir des champs vides en plus.
    const vue = (p: typeof a) => p.evaluate(() => { const e = JSON.parse(localStorage.getItem('trainhub.v1')!); return e.instruments.map((i: any) => ({ id: i.id, nom: i.name, chapitres: i.categories.map((c: any) => ({ id: c.id, nom: c.name, exos: c.exercises.map((x: any) => [x.id, x.title]) })) })); });
    await expect.poll(async () => JSON.stringify(await vue(b))).toBe(JSON.stringify(await vue(a)));
  });
});
