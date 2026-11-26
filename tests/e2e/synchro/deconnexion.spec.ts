// MODULE « synchro » — DÉCONNEXION. Observé en boîte noire (playwright-cli, 26/11/2026) : « Se déconnecter » (menu du compte : « Ce qui est déjà envoyé reste dans le cloud ») remet la pilule
// « Se connecter avec Google » et fait disparaître la pastille d'état ; les exercices et le journal restent sur l'appareil, le cloud reste intact, l'écoute s'arrête (ce que les autres appareils
// font ensuite n'arrive plus). Ce qu'on modifie ensuite reste LOCAL et part à la prochaine connexion. La fenêtre d'accueil (« Retrouve ton travail partout ») ne revient pas toute seule.
import { test, expect, adresse, attendreSynchro, attendreTitresCloud, attendreTitresLocaux, connecter, deconnecter, documents, lancerConnexion, pastille, pilule, seancesCloud, seancesLocales, journalMois, T, titresCloud, titresLocaux } from './aide-synchro';
import { ajouterExercice, titresVue } from '../bibliotheque/aide-bibliotheque';

test.describe('Synchro : déconnexion @synchro', () => {
  test.describe.configure({ timeout: 90_000 });   // la synchro attend un émulateur et un SDK réseau : sous la charge de la matrice complète, WebKit met parfois plus de 20 s à acquitter une écriture
  test('« Se déconnecter » : la pilule redevient « Se connecter », la pastille disparaît, les exercices restent sur l\'appareil et dans le cloud @critique', async ({ page, ouvrirAppli, garde }, testInfo) => {
    await ouvrirAppli({ exercices: [{ titre: 'Walking bass' }, { titre: 'Arpèges' }], reglages: journalMois('2026-11', [{ id: 's-1', date: T('2026-11-10T18:00:00+01:00'), titres: ['Walking bass'] }]) });
    const uid = await connecter(page, adresse(testInfo.project.name, 'e2e-deconnexion'));
    await attendreTitresCloud(uid, ['Walking bass', 'Arpèges']);
    await expect.poll(async () => (await seancesCloud(uid)).length).toBe(1);

    await deconnecter(page);
    await expect(pilule(page)).toBeHidden();
    await expect(pastille(page)).toBeHidden();
    await expect(page.locator('#cloud-guard-modal')).toBeHidden();
    expect(await page.evaluate(() => (window as any).firebase.auth().currentUser)).toBeNull();
    // Sur l'appareil : tout est là, à l'écran et dans le navigateur.
    expect(await titresVue(page)).toEqual(['Walking bass', 'Arpèges']);
    await attendreTitresLocaux(page, ['Walking bass', 'Arpèges']);
    expect(await seancesLocales(page)).toHaveLength(1);
    // Dans le cloud : rien n'a été effacé.
    await attendreTitresCloud(uid, ['Walking bass', 'Arpèges']);
    expect(await documents(uid)).toEqual(['trainhub', 'trainhub-log-2026-11']);
    expect(garde.bloquees).toEqual([]);

    // Après un rechargement on reste déconnecté.
    await page.reload();
    await expect(page.locator('#google-signin-btn')).toBeVisible({ timeout: 15_000 });
    await expect(pilule(page)).toBeHidden();
    expect(await titresVue(page)).toEqual(['Walking bass', 'Arpèges']);
  });

  test('déconnecté, on modifie : rien n\'arrive dans le cloud ; reconnecté avec le même compte, la modification part @critique', async ({ page, ouvrirAppli }, testInfo) => {
    await ouvrirAppli({ exercices: [{ titre: 'Alpha' }] });
    const email = adresse(testInfo.project.name, 'e2e-hors-compte');
    const uid = await connecter(page, email);
    await attendreTitresCloud(uid, ['Alpha']);
    await deconnecter(page);

    await ajouterExercice(page, 'Ajouté déconnecté');
    await attendreTitresLocaux(page, ['Alpha', 'Ajouté déconnecté']);
    await expect(pastille(page)).toBeHidden();   // pas de pastille « en attente » : rien ne sera envoyé
    expect(await titresCloud(uid)).toEqual(['Alpha']);   // l'envoi différé n'est même pas armé (pas de pastille) : le cloud ne reçoit rien

    await lancerConnexion(page, email);
    await attendreSynchro(page);
    await attendreTitresCloud(uid, ['Alpha', 'Ajouté déconnecté']);
    expect(await titresVue(page)).toEqual(['Alpha', 'Ajouté déconnecté']);
  });

  test('une modification encore « en attente » d\'envoi quand on se déconnecte reste sur l\'appareil et part à la reconnexion', async ({ page, ouvrirAppli }, testInfo) => {
    await ouvrirAppli({ exercices: [{ titre: 'Alpha' }] });
    const email = adresse(testInfo.project.name, 'e2e-attente');
    const uid = await connecter(page, email);
    await attendreTitresCloud(uid, ['Alpha']);
    await ajouterExercice(page, 'Juste avant de partir');
    await expect(pastille(page)).toHaveAttribute('data-etat', 'pending');
    await deconnecter(page);
    await attendreTitresLocaux(page, ['Alpha', 'Juste avant de partir']);

    await lancerConnexion(page, email);
    await attendreSynchro(page);
    await attendreTitresCloud(uid, ['Alpha', 'Juste avant de partir']);
  });

  test('déconnecté, un appareil ne reçoit plus ce que l\'autre appareil fait (l\'écoute est arrêtée) @critique', async ({ page, ouvrirAppli, ouvrirAppareil }, testInfo) => {
    const email = adresse(testInfo.project.name, 'e2e-ecoute');
    await ouvrirAppli({ exercices: [{ titre: 'Alpha' }] });
    const uid = await connecter(page, email);
    const b = await ouvrirAppareil();
    await connecter(b, email);
    await expect.poll(() => titresVue(b)).toEqual(['Alpha']);

    await deconnecter(page);
    await ajouterExercice(b, 'Fait sur B');
    await attendreSynchro(b);
    await attendreTitresCloud(uid, ['Alpha', 'Fait sur B']);
    // A, déconnecté, ne reçoit rien ; en se reconnectant (plus ancien que le cloud) il reprend l'état en ligne.
    expect(await titresVue(page)).toEqual(['Alpha']);
    await expect.poll(() => titresLocaux(page)).toEqual(['Alpha']);
    await lancerConnexion(page, email);
    await attendreSynchro(page);
    await expect.poll(() => titresVue(page)).toEqual(['Alpha', 'Fait sur B']);
  });

  test('se connecter avec un AUTRE compte sur le même appareil : la bibliothèque de l\'appareil est envoyée dans ce compte (comportement observé, à arbitrer : appareil partagé)', async ({ page, ouvrirAppli }, testInfo) => {
    // OBSERVÉ, pas jugé : TrainHub est « local d'abord » ; ce qui est sur l'appareil est envoyé au compte qui se connecte, que ce soit ou non le compte précédent.
    // Sur un appareil partagé, le second utilisateur reçoit donc la bibliothèque du premier. À confirmer avec l'utilisateur (voir le rapport) ; aucun `test.fail` : l'attendu n'est pas tranché.
    await ouvrirAppli({ exercices: [{ titre: 'Bibliothèque de Anna' }] });
    const uidA = await connecter(page, adresse(testInfo.project.name, 'e2e-anna-partage'), 'Anna');
    await attendreTitresCloud(uidA, ['Bibliothèque de Anna']);
    await deconnecter(page);
    const uidB = await connecter(page, adresse(testInfo.project.name, 'e2e-boris-partage'), 'Boris');
    expect(uidB).not.toBe(uidA);
    await attendreTitresCloud(uidB, ['Bibliothèque de Anna']);
    await attendreTitresCloud(uidA, ['Bibliothèque de Anna']);   // le compte de Anna n'est pas touché
  });
});
