// MODULE « synchro » — CONNEXION et ENVOI de l'état vers Firestore (compte Google FICTIF de l'émulateur Auth ; jamais la production).
// Observé en boîte noire (playwright-cli, 26/11/2026) : après la connexion la pilule « Se connecter » devient le compte (pastille d'état + nom ; au téléphone, l'initiale seule) ; son menu donne
// le nom, l'adresse, l'état (« Synchronisé avec le cloud ») et « Se déconnecter » ; l'état entier part dans `users/{uid}/apps/trainhub` ; une modification passe par « en attente » (envoi différé de
// 1,5 s) puis « Synchronisé ». La vraie fenêtre Google (celle de l'émulateur) reste dans demarrage/deux-modes (CI seulement : apis.google.com est bloqué dans la VM).
import { test, expect, adresse, attendreSynchro, attendreTitresCloud, connecter, documents, document, lancerConnexion, pastille, pilule, titresCloud, noterEtatsPastille, etatsPastille } from './aide-synchro';
import { actionExercice, ajouterExercice, auTelephone, confirmer, ligne } from '../bibliotheque/aide-bibliotheque';

test.describe('Synchro : connexion et envoi de l\'état @synchro', () => {
  test.describe.configure({ timeout: 90_000 });   // la synchro attend un émulateur et un SDK réseau : sous la charge de la matrice complète, WebKit met parfois plus de 20 s à acquitter une écriture
  test('connecté avec un compte fictif, la pilule devient le compte, le menu le décrit, et l\'état entier part dans Firestore @critique', async ({ ouvrirAppli, garde }, testInfo) => {
    const page = await ouvrirAppli({ exercices: [{ titre: 'Walking bass' }, { titre: 'Arpèges' }, { titre: 'Slap' }] });
    await expect(page.locator('#google-signin-btn')).toBeVisible();
    await expect(pastille(page)).toBeHidden();
    const email = adresse(testInfo.project.name, 'e2e-envoi');
    const uid = await connecter(page, email, 'Marie Test');

    await expect(page.locator('#google-signin-btn')).toBeHidden();
    await expect(pilule(page)).toHaveAttribute('title', 'Marie Test — Synchronisé avec le cloud');
    await expect(pastille(page)).toHaveAttribute('aria-label', 'Synchronisé avec le cloud');
    await pilule(page).click();
    const menu = page.getByRole('menu');
    await expect(menu).toContainText('Marie Test');
    await expect(menu).toContainText(email);
    await expect(menu).toContainText('Synchronisé avec le cloud');
    await expect(menu.getByRole('menuitem', { name: /^Se déconnecter/ })).toContainText('Ce qui est déjà envoyé reste dans le cloud');

    await attendreTitresCloud(uid, ['Walking bass', 'Arpèges', 'Slap']);
    // Un seul document à ce stade : l'état (pas de journal, d'image ni de fichier).
    expect(await documents(uid)).toEqual(['trainhub']);
    const doc = await document(uid, 'trainhub');
    expect(doc.instruments).toHaveLength(1);
    expect(doc.instruments[0].name).toBe('Basse');
    expect(doc.instruments[0].categories[0].name).toBe('Technique');
    expect(typeof doc.updatedAt).toBe('number');
    expect(garde.bloquees).toEqual([]);
  });

  test('un exercice ajouté une fois connecté passe par « en attente » puis part dans Firestore ; renommé puis supprimé, le document suit @critique', async ({ ouvrirAppli }, testInfo) => {
    const page = await ouvrirAppli({ exercices: [{ titre: 'Gamme de do' }] });
    const uid = await connecter(page, adresse(testInfo.project.name, 'e2e-suivi'));
    await attendreTitresCloud(uid, ['Gamme de do']);

    await noterEtatsPastille(page);
    await ajouterExercice(page, 'Gamme de ré');
    // modification faite, envoi différé de 1,5 s : la pastille passe par « en attente » (état noté, pas guetté à un instant précis), puis revient à « Synchronisé »
    await expect.poll(() => etatsPastille(page)).toContain('pending');
    await attendreSynchro(page);
    expect((await etatsPastille(page)).slice(-1)).toEqual(['synced']);
    await attendreTitresCloud(uid, ['Gamme de do', 'Gamme de ré']);

    // Renommer : le titre est un champ de saisie, validé en le quittant.
    const titre = page.locator('#folder-container input.exercise-title').first();
    await titre.fill('Gamme de do majeur');
    await titre.press('Enter');
    await attendreTitresCloud(uid, ['Gamme de do majeur', 'Gamme de ré']);

    // Supprimer (clic droit › Supprimer… › confirmation).
    await actionExercice(page, await ligne(page, 'Gamme de ré'), 'Supprimer…');
    await confirmer(page, 'Supprimer');
    await attendreTitresCloud(uid, ['Gamme de do majeur']);
    await attendreSynchro(page);
  });

  test('après un rechargement, on est toujours connecté : pas de fenêtre d\'accueil, pastille « Synchronisé », mêmes exercices @critique', async ({ page, ouvrirAppli }, testInfo) => {
    await ouvrirAppli({ exercices: [{ titre: 'Walking bass' }, { titre: 'Slap' }] });
    const uid = await connecter(page, adresse(testInfo.project.name, 'e2e-recharge'), 'Rechargé');
    await attendreTitresCloud(uid, ['Walking bass', 'Slap']);

    await page.reload();
    await expect(page.locator('#folder-container')).toBeAttached();
    await expect(pilule(page)).toBeVisible({ timeout: 15_000 });
    await attendreSynchro(page);
    await expect(page.locator('#cloud-guard-modal')).toBeHidden();
    await expect(page.locator('#google-signin-btn')).toBeHidden();
    await expect(pilule(page)).toHaveAttribute('title', 'Rechargé — Synchronisé avec le cloud');
    await expect(page.locator('#folder-container input.exercise-title')).toHaveCount(2);
    expect(await titresCloud(uid)).toEqual(['Walking bass', 'Slap']);   // rien n'a été perdu ni dupliqué par la reconnexion
  });

  test('deux comptes : chacun ses documents, l\'un ne voit pas les exercices de l\'autre @critique', async ({ ouvrirAppli, ouvrirAppareil }, testInfo) => {
    const a = await ouvrirAppli({ exercices: [{ titre: 'Secret de Anna' }] });
    const uidA = await connecter(a, adresse(testInfo.project.name, 'e2e-anna'), 'Anna');
    const b = await ouvrirAppareil({ exercices: [{ titre: 'Secret de Boris' }, { titre: 'Autre de Boris' }] });
    const uidB = await connecter(b, adresse(testInfo.project.name, 'e2e-boris'), 'Boris');
    expect(uidA).not.toBe(uidB);
    await attendreTitresCloud(uidA, ['Secret de Anna']);
    await attendreTitresCloud(uidB, ['Secret de Boris', 'Autre de Boris']);
    expect(await documents(uidA)).toEqual(['trainhub']);
    expect(await documents(uidB)).toEqual(['trainhub']);
    // Rien d'étranger à l'écran.
    await expect(a.locator('#folder-container input.exercise-title')).toHaveCount(1);
    await expect(a.locator('#folder-container input.exercise-title').first()).toHaveValue('Secret de Anna');
    await expect(b.locator('#folder-container input.exercise-title')).toHaveCount(2);
  });

  test('à l\'ordinateur, la pilule affiche la pastille d\'état et le nom du compte @ordinateur', async ({ ouvrirAppli }, testInfo) => {
    const page = await ouvrirAppli({ exercices: [{ titre: 'A' }] });
    await connecter(page, adresse(testInfo.project.name, 'e2e-ordi'), 'Camille Ordinateur');
    await expect(pilule(page).locator('.cc-libelle')).toBeVisible();
    await expect(pilule(page).locator('.cc-libelle')).toHaveText('Camille Ordinateur');
    await expect(pastille(page)).toBeVisible();
  });

  test('au téléphone, la pilule n\'est plus que la pastille et l\'initiale ; le menu du compte reste dans l\'écran et se ferme @mobile', async ({ ouvrirAppli }, testInfo) => {
    const page = await ouvrirAppli({ exercices: [{ titre: 'A' }] });
    expect(auTelephone(page)).toBe(true);
    await connecter(page, adresse(testInfo.project.name, 'e2e-tel'), 'Camille Téléphone');
    await expect(pilule(page).locator('.cc-libelle')).toBeHidden();
    await expect(pilule(page).locator('.cc-initiale')).toHaveText('C');
    const boite = await pilule(page).boundingBox();
    expect(boite!.width).toBeGreaterThanOrEqual(30);
    expect(boite!.height).toBeGreaterThanOrEqual(30);

    await pilule(page).tap();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('Camille Téléphone');
    const m = await menu.boundingBox();
    const largeur = page.viewportSize()!.width;
    expect(m!.x).toBeGreaterThanOrEqual(0);
    expect(m!.x + m!.width).toBeLessThanOrEqual(largeur);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });
});
