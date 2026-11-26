// MODULE « morceaux » — les morceaux DANS LES SESSIONS (ce que le module `session` ne vérifie pas : l'onglet « Morceaux » et les favoris y sont déjà). Observé en boîte noire (playwright-cli, 26/11/2026) :
// l'onglet « En cours » du choix d'une session réunit les exercices « en cours » ET les morceaux dont l'état de Travail est celui que le chapitre désigne comme « en cours » (il suit le renommage de l'état) ;
// une session garde un morceau par son identifiant : le renommer (artiste, titre) ne casse pas la session, le déroulé affiche le nouveau titre ; un morceau archivé ou supprimé n'est plus proposé au choix.
import { test, expect } from '../support/fixtures';
import type { Page } from '@playwright/test';
import { actionExercice, choisirVue, deplier, champsArtiste, etatMorceaux, ligneDepart, lireEtat, menuDossier, ouvrirMorceaux, repondre } from './aide-morceaux';
import { ongletChoix, ouvrirChoix, ouvrirSessions, lancerDepuisListe, titreExercice, rondExercice, MAINT } from '../session/aide-session';

const session = (titres: string[]) => ({
  id: 'sess-1', name: 'Soirée', instrumentId: 'esp-0', tabIds: [], createdAt: MAINT.getTime() - 86_400_000,
  steps: titres.map((t, i) => ({ id: `st-${i}`, exerciseId: `ex-${t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`, minutes: 5, note: '', hidden: [] })),
});
const ronds = (page: Page, titre: string) => rondExercice(page, titre);

test.describe('Morceaux : dans les sessions @morceaux', () => {
  test('l\'onglet « En cours » du choix compte exercices et morceaux « en cours » ; l\'état de Travail renommé continue de compter', async ({ ouvrirAppli }) => {
    const e: any = etatMorceaux([{ titre: 'Beatles - Help', travail: 'En cours' }, { titre: 'Muse - Hysteria', travail: 'À maîtriser' }, 'Toto - Africa'], { exercices: ['Gamme', 'Arpèges'] });
    e.instruments[0].categories[0].exercises[0].inProgress = true;   // « Gamme » est un exercice en cours
    const page = await ouvrirAppli({ etat: e, accueil: 'jamais' });
    await ouvrirSessions(page);
    await ouvrirChoix(page);
    await expect(ongletChoix(page, 'En cours')).toHaveText(/En cours \(2\)/);
    await ongletChoix(page, 'En cours').click();
    await expect(ronds(page, 'Beatles - Help')).toBeVisible();
    await expect(ronds(page, 'Gamme')).toBeVisible();
    await expect(ronds(page, 'Muse - Hysteria')).toHaveCount(0);
  });

  test('renommer l\'état « En cours » du chapitre : l\'onglet « En cours » du choix suit le nouveau nom', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux([{ titre: 'Beatles - Help', travail: 'En cours' }, 'Muse - Hysteria']), accueil: 'jamais' });
    await ouvrirMorceaux(page);
    await choisirVue(page, 'Travail');
    await menuDossier(page, 'En cours');
    await page.locator('.ctx-menu').getByRole('button', { name: 'Renommer…', exact: true }).click();
    await repondre(page, 'Au boulot');
    await ouvrirSessions(page);
    await ouvrirChoix(page);
    await expect(ongletChoix(page, 'En cours')).toHaveText(/En cours \(1\)/);
    await ongletChoix(page, 'En cours').click();
    await expect(ronds(page, 'Beatles - Help')).toBeVisible();
  });

  test('renommer un morceau (artiste) ne casse pas la session qui le contient : le déroulé affiche le nouveau titre @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(['Beatles - Help', 'Muse - Hysteria'], { reglages: { guidedSessions: [session(['Beatles - Help'])], sessionPlan: [] } }), accueil: 'jamais' });
    await ouvrirMorceaux(page);
    await deplier(page, 'Beatles - Help');
    const f = ligneDepart(page, 'Beatles - Help');
    await champsArtiste(f).fill('The Beatles');
    await champsArtiste(f).press('Enter');
    await expect.poll(async () => (await lireEtat(page)).instruments[0].categories[1].exercises.map((x: any) => x.title)).toContain('The Beatles - Help');
    const e = await lireEtat(page);
    expect(e.settings.guidedSessions[0].steps.map((s: any) => s.exerciseId)).toEqual(['ex-beatles-help']);   // l'identifiant n'a pas changé
    await ouvrirSessions(page);
    await lancerDepuisListe(page, 'Soirée');
    await expect(titreExercice(page)).toHaveText('The Beatles - Help');
  });

  test('un morceau archivé n\'est plus proposé au choix d\'une session ; désarchivé, il revient', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(['Beatles - Help', 'Muse - Hysteria']), accueil: 'jamais' });
    await ouvrirMorceaux(page);
    await actionExercice(page, ligneDepart(page, 'Muse - Hysteria'), 'Archiver');
    await ouvrirSessions(page);
    await ouvrirChoix(page);
    await expect(ongletChoix(page, 'Morceaux')).toHaveText(/Morceaux \(1\)/);
    await ongletChoix(page, 'Morceaux').click();
    await expect(ronds(page, 'Beatles - Help')).toBeVisible();
    await expect(ronds(page, 'Muse - Hysteria')).toHaveCount(0);
  });

  test('« Ajouter à une session… » depuis le menu d\'un morceau : le morceau entre dans la session choisie', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatMorceaux(['Beatles - Help', 'Muse - Hysteria'], { reglages: { guidedSessions: [session(['Beatles - Help'])], sessionPlan: [] } }), accueil: 'jamais' });
    await ouvrirMorceaux(page);
    await actionExercice(page, ligneDepart(page, 'Muse - Hysteria'), 'Ajouter à une session…');
    await page.getByRole('menu').getByRole('button', { name: /Soirée/ }).click();
    await expect.poll(async () => (await lireEtat(page)).settings.guidedSessions[0].steps.map((s: any) => s.exerciseId)).toEqual(['ex-beatles-help', 'ex-muse-hysteria']);
  });
});
