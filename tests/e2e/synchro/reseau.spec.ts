// MODULE « synchro » — RÉSEAU COUPÉ puis REPRIS (`context.setOffline`). Observé en boîte noire (playwright-cli et sonde, 26/11/2026) : réseau coupé, une modification est enregistrée aussitôt dans le
// navigateur ; la pastille passe à « en attente » (envoi différé de 1,5 s) puis reste sur « synchronisation en cours » (jamais « Synchronisé ») ; le cloud ne bouge pas. Au retour du réseau l'envoi
// part tout seul, la pastille revient à « Synchronisé ». Même chose pour le journal (séance saisie), les captures (document trainhub-img-<id>, fiche notée `cloud` ensuite) et pour un
// rechargement fait Firestore/Auth injoignables (pastille « erreur », données du navigateur affichées, l'appli reste utilisable). Un appareil resté sans réseau rattrape ce que l'autre a fait.
import { test, expect, adresse, ajouterSeancePassee, attendreSynchro, attendreTitresCloud, attendreTitresLocaux, connecter, documents, pastille, pilule, seancesCloud, seancesLocales, titresCloud, titresLocaux } from './aide-synchro';
import { ajouterExercice, titresVue } from '../bibliotheque/aide-bibliotheque';
import { ajouterFichiers, etatFiche, exo, fiche, onglet, ouvrirTechnique, png, sansBlobIndexedDB } from '../fiche/aide-fiche';

test.describe('Synchro : réseau coupé puis repris @synchro', () => {
  test.describe.configure({ timeout: 90_000 });   // la synchro attend un émulateur et un SDK réseau : sous la charge de la matrice complète, WebKit met parfois plus de 20 s à acquitter une écriture
  test('réseau coupé : la modification reste dans le navigateur, la pastille n\'affiche jamais « Synchronisé », le cloud ne bouge pas ; au retour du réseau tout part @critique', async ({ page, ouvrirAppli }, testInfo) => {
    await ouvrirAppli({ exercices: [{ titre: 'Alpha' }] });
    const uid = await connecter(page, adresse(testInfo.project.name, 'e2e-coupure'));
    await attendreTitresCloud(uid, ['Alpha']);

    await page.context().setOffline(true);
    await ajouterExercice(page, 'Ajouté hors réseau');
    await expect(pastille(page)).toHaveAttribute('data-etat', 'pending');
    await attendreTitresLocaux(page, ['Alpha', 'Ajouté hors réseau']);   // gardé sur l'appareil tout de suite
    await expect(pastille(page)).toHaveAttribute('data-etat', 'syncing', { timeout: 10_000 });   // l'envoi est tenté mais ne peut pas aboutir
    expect(await titresCloud(uid)).toEqual(['Alpha']);
    await expect(pastille(page)).not.toHaveAttribute('data-etat', 'synced');
    await expect(page.locator('#folder-container input.exercise-title')).toHaveCount(2);   // l'appli reste utilisable

    await page.context().setOffline(false);
    await attendreSynchro(page);
    await attendreTitresCloud(uid, ['Alpha', 'Ajouté hors réseau']);
  });

  test('plusieurs modifications pendant la coupure : au retour du réseau, le cloud a l\'état final (pas de doublon ni de manque) @critique', async ({ page, ouvrirAppli }, testInfo) => {
    await ouvrirAppli({ exercices: [{ titre: 'Alpha' }, { titre: 'Bravo' }] });
    const uid = await connecter(page, adresse(testInfo.project.name, 'e2e-coupure-multiple'));
    await attendreTitresCloud(uid, ['Alpha', 'Bravo']);
    await page.context().setOffline(true);
    await ajouterExercice(page, 'Charlie');
    await ajouterExercice(page, 'Delta');
    const titre = page.locator('#folder-container input.exercise-title').first();
    await titre.fill('Alpha renommé');
    await titre.press('Enter');
    await attendreTitresLocaux(page, ['Alpha renommé', 'Bravo', 'Charlie', 'Delta']);
    expect(await titresCloud(uid)).toEqual(['Alpha', 'Bravo']);
    await page.context().setOffline(false);
    await attendreSynchro(page);
    await attendreTitresCloud(uid, ['Alpha renommé', 'Bravo', 'Charlie', 'Delta']);
  });

  test('séance saisie pendant la coupure : elle part dans le document du mois au retour du réseau @critique', async ({ page, ouvrirAppli }, testInfo) => {
    await ouvrirAppli({ exercices: [{ titre: 'Alpha' }] });
    const uid = await connecter(page, adresse(testInfo.project.name, 'e2e-coupure-seance'));
    await page.context().setOffline(true);
    await ajouterSeancePassee(page, { nom: 'Séance dans le train', date: '2026-11-19', exercice: 'Alpha', minutes: 15 });
    await expect.poll(async () => (await seancesLocales(page)).map((s: any) => s.name)).toEqual(['Séance dans le train']);
    expect(await documents(uid)).toEqual(['trainhub']);   // rien dans le cloud : ni journal, ni quoi que ce soit d'autre
    await page.context().setOffline(false);
    await expect.poll(async () => (await seancesCloud(uid)).map((s: any) => s.name), { message: 'la séance part au retour du réseau', timeout: 25_000 }).toEqual(['Séance dans le train']);
    await attendreSynchro(page);
  });

  test('capture ajoutée pendant la coupure : le document trainhub-img-<id> est créé au retour du réseau et la fiche est marquée « dans le cloud »', async ({ page, ouvrirAppli, browserName }, testInfo) => {
    sansBlobIndexedDB(test, browserName);
    await ouvrirAppli({ etat: etatFiche(['Gamme']) });
    const uid = await connecter(page, adresse(testInfo.project.name, 'e2e-coupure-capture'));
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await page.context().setOffline(true);
    await ajouterFichiers(page, f, png('rouge.png'));
    await expect(onglet(f, 'Images')).toHaveText(/Images\s*1/);
    expect(await documents(uid)).toEqual(['trainhub']);
    expect((await exo(page, 'Gamme')).images[0].cloud).toBeFalsy();
    await page.context().setOffline(false);
    await expect.poll(async () => (await exo(page, 'Gamme')).images[0].cloud, { message: 'la capture est marquée dans le cloud', timeout: 30_000 }).toBe(true);
    const id = (await exo(page, 'Gamme')).images[0].id;
    await expect.poll(() => documents(uid)).toEqual(['trainhub', `trainhub-img-${id}`]);
  });

  test('un appareil resté sans réseau, qui n\'a rien modifié, rattrape au retour ce que l\'autre a fait entre-temps @critique', async ({ page, ouvrirAppli, ouvrirAppareil }, testInfo) => {
    const email = adresse(testInfo.project.name, 'e2e-rattrape');
    await ouvrirAppli({ exercices: [{ titre: 'Alpha' }] });
    const uid = await connecter(page, email);
    const b = await ouvrirAppareil();
    await connecter(b, email);
    await expect.poll(() => titresVue(b)).toEqual(['Alpha']);

    await page.context().setOffline(true);
    await ajouterExercice(b, 'Fait pendant que A était coupé');
    await attendreSynchro(b);
    await attendreTitresCloud(uid, ['Alpha', 'Fait pendant que A était coupé']);
    expect(await titresVue(page)).toEqual(['Alpha']);   // A ne sait encore rien

    await page.context().setOffline(false);
    await expect.poll(() => titresVue(page), { message: 'A rattrape le retard', timeout: 25_000 }).toEqual(['Alpha', 'Fait pendant que A était coupé']);
    await attendreSynchro(page);
  });

  test('rechargement pendant que Firestore et Auth sont injoignables : l\'appli s\'ouvre avec les données du navigateur, reste utilisable, et se resynchronise au retour @critique', async ({ page, ouvrirAppli }, testInfo) => {
    await ouvrirAppli({ exercices: [{ titre: 'Alpha' }] });
    const uid = await connecter(page, adresse(testInfo.project.name, 'e2e-recharge-coupe'));
    await attendreTitresCloud(uid, ['Alpha']);

    // On coupe seulement les émulateurs (la page, elle, se recharge depuis le serveur de test) : c'est un navigateur qui rouvre l'appli sans réseau vers Google.
    const emulateurs = /127\.0\.0\.1:(8180|9199)\//;
    await page.context().route(emulateurs, (r) => r.abort('internetdisconnected'));
    await page.reload();
    await expect(page.locator('#folder-container')).toBeAttached();
    await expect(pilule(page)).toBeVisible({ timeout: 15_000 });   // le compte reste affiché (connexion mémorisée)
    await expect(pastille(page)).toHaveAttribute('data-etat', 'error', { timeout: 20_000 });
    await expect(page.locator('#cloud-guard-modal')).toBeHidden();
    expect(await titresVue(page)).toEqual(['Alpha']);
    await ajouterExercice(page, 'Pendant la coupure');
    await attendreTitresLocaux(page, ['Alpha', 'Pendant la coupure']);

    await page.context().unroute(emulateurs);
    await attendreSynchro(page);
    await attendreTitresCloud(uid, ['Alpha', 'Pendant la coupure']);
  });

  test('deux appareils, l\'un coupé du réseau : la modification la plus récente reste celle du cloud quand l\'appareil coupé revient', async ({ page, ouvrirAppli, ouvrirAppareil }, testInfo) => {
    test.fail(true, 'SY-04 : l\'envoi en attente de l\'appareil coupé (modifié AVANT) écrase le cloud au retour du réseau ; l\'autre appareil, plus récent, ne le renvoie pas et reste divergent sous « Synchronisé »');
    const email = adresse(testInfo.project.name, 'e2e-recent-coupure');
    await ouvrirAppli({ exercices: [{ titre: 'Alpha' }] });
    const uid = await connecter(page, email);
    const b = await ouvrirAppareil();
    await connecter(b, email);
    await expect.poll(() => titresVue(b)).toEqual(['Alpha']);

    await page.context().setOffline(true);
    await ajouterExercice(page, 'A hors réseau');   // t1 : la première modification
    await expect(pastille(page)).toHaveAttribute('data-etat', 'syncing', { timeout: 10_000 });
    await ajouterExercice(b, 'B en ligne');          // t2 > t1 : la plus récente
    await attendreSynchro(b);
    await attendreTitresCloud(uid, ['Alpha', 'B en ligne']);

    await page.context().setOffline(false);
    await attendreSynchro(page);
    // Le plus récent (B, t2) devrait gagner partout : cloud, A et B identiques.
    await expect.poll(async () => JSON.stringify([await titresCloud(uid), await titresLocaux(page), await titresLocaux(b)]), { timeout: 15_000 })
      .toBe(JSON.stringify(Array(3).fill(['Alpha', 'B en ligne'])));
  });
});
