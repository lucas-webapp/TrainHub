// MODULE « mobile » — CLAVIER VIRTUEL. Aucun navigateur de test n'a de clavier à l'écran : on le SIMULE comme le fait Android (Chrome), en RÉDUISANT LA HAUTEUR de la fenêtre à 58 % (le clavier prend ≈ 42 %),
// puis on met le focus dans le champ (le navigateur le fait alors défiler dans la partie visible, comme à l'ouverture du clavier). Limite : sous iOS le clavier recouvre la page sans redimensionner la fenêtre
// (`visualViewport` rétrécit, pas `innerHeight`) ; ce comportement-là ne se prouve que sur un vrai iPhone (liste « à vérifier » du rapport). On vérifie que le champ est ENTIÈREMENT dans la fenêtre réduite et que
// RIEN ne le recouvre (barres collantes du haut, volet du métronome, messages), et que les boutons des fenêtres de saisie restent atteignables.
import { test, expect } from '../support/fixtures';
import { etatFiche, fiche } from '../fiche/aide-fiche';
import { DEJA_EPINGLE, champTempo, etatMetro, jouer, metro, ouvrir, ouvrirEpingle, valeurTempo, volet } from '../metronome/aide-metronome';
import { bibliothequeLongue, boutonHaut, champAccessible, dansLEcran, decouverte, hauteurEcran, ouvrirClavier, ouvrirTel, tientBientot } from './aide-mobile';
import { etatSession } from '../session/aide-session';

test.describe('Clavier virtuel @mobile', () => {
  test('« Ajouter un exercice… » tout en bas d\'une longue liste : le champ reste entièrement visible et non recouvert quand le clavier s\'ouvre @critique', async ({ ouvrirAppli, page }, testInfo) => {
    await ouvrirTel(ouvrirAppli, bibliothequeLongue(25));
    const champ = page.locator('#folder-container .add-exercise-row input');
    await ouvrirClavier(page, testInfo.project.name);
    await champ.focus();
    await expect(champ).toBeFocused();
    await champAccessible(page, champ, '« Ajouter un exercice… »');
    await champ.pressSequentially('Un nouvel exercice');
    await expect(champ).toHaveValue('Un nouvel exercice');
  });

  test('le champ « Coller un lien… » d\'une fiche ouverte n\'est pas caché sous les barres du haut ni sous le clavier', async ({ ouvrirAppli, page }, testInfo) => {
    await ouvrirTel(ouvrirAppli, etatFiche(['Gamme majeure', 'Arpèges', 'Croches', 'Triolets', 'Pouce', 'Slap'], 'Technique'));
    await ouvrirClavier(page, testInfo.project.name);
    const champ = fiche(page, 'Pouce').getByPlaceholder('Coller un lien…');
    await champ.focus();
    await champAccessible(page, champ, 'champ « Coller un lien… »');
    const bas = await page.evaluate(() => Math.max(...['.top-bar', '#chapter-bar'].map((s) => document.querySelector(s)!.getBoundingClientRect().bottom)));
    expect((await champ.boundingBox())!.y, 'sous les barres collantes du haut').toBeGreaterThanOrEqual(bas - 1);
  });

  // Le navigateur amène le champ touché vers le CENTRE de la zone visible quand le clavier réduit la fenêtre : il ne doit pas se retrouver sous les barres collantes du haut (221 px d'iPhone au repos, 122 en défilement).
  test('un champ touché au milieu de l\'écran n\'est pas recouvert par les barres collantes quand le clavier s\'ouvre et que le navigateur le recentre', async ({ ouvrirAppli, page }, testInfo) => {
    await ouvrirTel(ouvrirAppli, etatFiche(Array.from({ length: 25 }, (_, i) => `Exercice ${i + 1}`), 'Technique'));
    const champ = fiche(page, 'Exercice 10').getByPlaceholder('Coller un lien…');
    // le champ est placé aux deux tiers de l'écran, entièrement visible : le doigt peut le toucher
    await champ.evaluate((e) => { const b = e.getBoundingClientRect(); window.scrollBy(0, b.top - innerHeight * 0.66); });
    await expect(champ).toBeInViewport({ ratio: 1 });
    await champ.focus();
    await ouvrirClavier(page, testInfo.project.name);
    await champAccessible(page, champ, 'champ « Coller un lien… » touché au milieu de l\'écran');
  });

  test('métronome épinglé et clavier ouvert : un champ de la liste reste visible au-dessus du volet', async ({ ouvrirAppli, page }, testInfo) => {
    await ouvrirTel(ouvrirAppli, etatMetro(['Gamme', 'Arpège']), { reglages: DEJA_EPINGLE });
    await ouvrirEpingle(page);
    await ouvrirClavier(page, testInfo.project.name);
    const champ = page.locator('#folder-container .add-exercise-row input');
    await champ.focus();
    await champAccessible(page, champ, 'champ « Ajouter un exercice… » avec le volet');
    const v = (await volet(page).boundingBox())!, c = (await champ.boundingBox())!;
    expect(c.y + c.height, 'le champ est au-dessus du volet').toBeLessThanOrEqual(v.y + 1);
  });

  test('la fenêtre du métronome : saisir le tempo au clavier garde le champ et la fenêtre dans l\'écran réduit', async ({ ouvrirAppli, page }, testInfo) => {
    await ouvrirTel(ouvrirAppli, etatMetro(['Gamme']));
    await ouvrir(page);
    await valeurTempo(page).tap();
    await expect(champTempo(page)).toBeFocused();
    await ouvrirClavier(page, testInfo.project.name);
    await tientBientot(page, metro(page), 'fenêtre du métronome avec le clavier', 8);
    await champAccessible(page, champTempo(page), 'champ du tempo');
    await champTempo(page).fill('84');
    await champTempo(page).press('Enter');
    await expect(valeurTempo(page)).toHaveText('84');
    await expect(jouer(page)).toBeInViewport();
  });

  test('« Renommer l\'espace » : la fenêtre de saisie, son champ et ses boutons tiennent dans l\'écran réduit par le clavier', async ({ ouvrirAppli, page }, testInfo) => {
    await ouvrirTel(ouvrirAppli);
    await page.getByRole('button', { name: 'Renommer l\'espace' }).tap();
    const fenetre = page.getByRole('dialog');
    await expect(fenetre).toBeVisible();
    const champ = fenetre.getByRole('textbox');
    await expect(champ).toBeFocused();
    await ouvrirClavier(page, testInfo.project.name);
    await tientBientot(page, fenetre, 'fenêtre « Renommer l\'espace »');
    await champAccessible(page, champ, 'champ du nom');
    for (const b of await fenetre.getByRole('button').all()) await expect(b).toBeInViewport();
    await champ.fill('Basse électrique');
    await fenetre.getByRole('button', { name: /^(OK|Renommer|Enregistrer|Valider)/ }).tap();
    await expect(fenetre).toBeHidden();
    await expect(page.getByRole('combobox', { name: 'Espace' })).toContainText('Basse électrique');
  });

  test('la recherche : le champ reste visible et au-dessus du clavier, et les résultats s\'affichent dans la fenêtre réduite', async ({ ouvrirAppli, page }, testInfo) => {
    await ouvrirTel(ouvrirAppli, bibliothequeLongue(10));
    await boutonHaut(page, 'Rechercher un exercice').tap();
    const champ = page.getByPlaceholder(/^Rechercher un exercice/);
    await ouvrirClavier(page, testInfo.project.name);
    await champ.focus();
    await champAccessible(page, champ, 'champ de recherche');
    await champ.fill('Technique 3');
    await expect(page.locator('#folder-container [data-ex-id="ex-technique-3"]')).toBeVisible();
    expect(await hauteurEcran(page)).toBeLessThan(testInfo.project.use.viewport!.height);
  });

  test('l\'éditeur de session : le nom et le commentaire restent saisissables avec le clavier ouvert', async ({ ouvrirAppli, page }, testInfo) => {
    await ouvrirTel(ouvrirAppli, etatSession(['Alpha', 'Bravo'], [{ nom: 'Matin', exercices: [['Alpha', 5]] }]));
    await boutonHaut(page, 'Session guidée').tap();
    const { toucher } = await import('./aide-mobile');
    await toucher(page.locator('.gs-session-row .gs-session-name').first());
    const nom = page.getByRole('textbox', { name: 'Nom de la session' });
    await expect(nom).toBeVisible();
    await ouvrirClavier(page, testInfo.project.name);
    await nom.focus();
    await champAccessible(page, nom, 'nom de la session');
    await nom.fill('Matin long');
    await expect(nom).toHaveValue('Matin long');
    const lancer = page.getByRole('button', { name: '▶ Lancer la session' });
    await lancer.scrollIntoViewIfNeeded();
    await expect(lancer).toBeInViewport();
  });
});
