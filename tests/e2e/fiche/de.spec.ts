// MODULE « fiche » — DÉ DE L'EXERCICE : l'allumer (choix « Dé de gammes » / « Dé d'harmonie »), le régler, « Tirer », le retirer (avec confirmation).
// Observé en boîte noire (playwright-cli, 24/11/2026) : le bouton dé de la barre d'outils demande « Quel dé pour « X » ? » ; le choix ouvre la fenêtre du dé (onglets Tirage / Réglages /
// Préréglages) ; une fois allumé, la ligne montre le dé (pressé), « Régler le dé… » et « Tirer » + le résultat (« C · Pentatonique mineure ») ; le résultat n'est pas gardé au rechargement ;
// cliquer le dé allumé demande confirmation avant de le retirer. Tirage sans remise, préréglages, aides : module `outils` ; détails de la ligne du dé : banc `ligne_de` (PLAN § 7).
import { test, expect } from '../support/fixtures';
import { boutonDe, boutonTirer, etatFiche, exo, fiche, resultatDe, ouvrirTechnique } from './aide-fiche';
import type { Page } from '@playwright/test';

const fenetreDe = (page: Page, titre: string) => page.getByText(titre, { exact: true });
const fermerFenetre = (page: Page) => page.getByRole('button', { name: 'Fermer', exact: true }).click();
const reglerDe = (f: ReturnType<typeof fiche>) => f.getByRole('button', { name: /^Régler le dé/ });

test.describe('Fiche : dé de l\'exercice @fiche', () => {
  test('allumer le dé de gammes : choix du dé, fenêtre « Dé de gammes · Gamme », puis la ligne montre « Régler » et « Tirer » ; enregistré @critique', async ({ ouvrirAppli, garde }) => {
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme', 'Sans dé']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await expect(boutonTirer(f)).toBeHidden();
    await expect(reglerDe(f)).toBeHidden();
    await boutonDe(f).click();
    const choix = page.getByRole('dialog', { name: 'Quel dé pour « Gamme » ?' });
    await expect(choix).toBeVisible();
    await expect(choix.getByRole('button')).toHaveText(['Annuler', 'Dé de gammes', 'Dé d\'harmonie']);
    await choix.getByRole('button', { name: 'Dé de gammes' }).click();
    await expect(fenetreDe(page, 'Dé de gammes · Gamme')).toBeVisible();
    await fermerFenetre(page);
    await expect(fenetreDe(page, 'Dé de gammes · Gamme')).toBeHidden();

    await expect(boutonDe(f)).toHaveAttribute('aria-pressed', 'true');
    await expect(reglerDe(f)).toBeVisible();
    await expect(boutonTirer(f)).toBeVisible();
    await expect.poll(async () => !!(await exo(page, 'Gamme')).dice).toBe(true);
    // L'autre exercice n'a pas de dé.
    await expect(boutonTirer(fiche(page, 'Sans dé'))).toBeHidden();
    expect((await exo(page, 'Sans dé')).dice ?? null).toBeNull();
    // Annuler au choix : rien n'est allumé.
    await boutonDe(fiche(page, 'Sans dé')).click();
    await page.getByRole('dialog', { name: 'Quel dé pour « Sans dé » ?' }).getByRole('button', { name: 'Annuler' }).click();
    expect((await exo(page, 'Sans dé')).dice ?? null).toBeNull();

    await page.reload();
    await ouvrirTechnique(page);
    await expect(boutonTirer(f)).toBeVisible();   // le dé est resté
    await expect(resultatDe(f)).toHaveText('');   // le tirage, lui, n'est pas gardé
    expect(garde.bloquees).toEqual([]);
  });

  test('« Tirer » : un tirage s\'affiche (tonalité · gamme) et chaque nouveau clic en donne un autre valide @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche([{ titre: 'Gamme', extra: { dice: { cfg: null } } }]) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await expect(resultatDe(f)).toHaveText('');
    for (let i = 0; i < 4; i++) {
      await boutonTirer(f).click();
      await expect(resultatDe(f)).toHaveText(/^[A-G][♯♭#b]? · \S.*$/);
    }
    await expect(resultatDe(f)).toHaveAttribute('title', 'Voir sur le manche');
  });

  test('régler le dé : une seule tonalité possible (Do) ; « Tirer » donne alors toujours une gamme en Do ; le réglage est enregistré @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche([{ titre: 'Gamme', extra: { dice: { cfg: null } } }]) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await reglerDe(f).click();
    await expect(fenetreDe(page, 'Dé de gammes · Gamme')).toBeVisible();
    await page.getByRole('tab', { name: 'Réglages', exact: true }).click();
    await page.getByRole('button', { name: /^Tonalités possibles/ }).click();
    const tonalites = page.getByRole('dialog', { name: 'Tonalités possibles' });
    await expect(tonalites).toBeVisible();
    await tonalites.getByRole('button', { name: 'Aucune' }).click();
    await tonalites.getByRole('button', { name: 'C', exact: true }).click();
    await tonalites.getByRole('button', { name: 'OK' }).click();
    await expect(tonalites).toBeHidden();
    await expect(page.getByRole('button', { name: /^Tonalités possibles/ })).toContainText('1 sur 12');
    await fermerFenetre(page);
    await expect.poll(async () => (await exo(page, 'Gamme')).dice.cfg.key.filter(Boolean).length).toBe(1);

    for (let i = 0; i < 4; i++) {
      await boutonTirer(f).click();
      await expect(resultatDe(f)).toHaveText(/^C · \S/);
    }
  });

  test('retirer le dé : le cliquer demande confirmation ; « Annuler » le garde, « Retirer » l\'enlève de la fiche', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche([{ titre: 'Gamme', extra: { dice: { cfg: null } } }]) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await boutonDe(f).click();
    const boite = page.getByRole('dialog').filter({ hasText: 'Retirer le dé' });
    await expect(boite).toBeVisible();
    await boite.getByRole('button', { name: /Annuler|Non|Garder/ }).first().click();
    await expect(boite).toBeHidden();
    await expect(boutonTirer(f)).toBeVisible();
    expect((await exo(page, 'Gamme')).dice).toBeTruthy();

    await boutonDe(f).click();
    await boite.getByRole('button', { name: 'Retirer', exact: true }).click();
    await expect(boite).toBeHidden();
    await expect(boutonTirer(f)).toBeHidden();
    await expect.poll(async () => (await exo(page, 'Gamme')).dice ?? null).toBeNull();
    // Le dé éteint redemande quel dé on veut (pas de confirmation).
    await boutonDe(f).click();
    await expect(page.getByRole('dialog', { name: 'Quel dé pour « Gamme » ?' })).toBeVisible();
  });

  test('dé d\'harmonie : « Dé d\'harmonie · Gamme », « Tirer » donne un tirage, retrait avec confirmation', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await boutonDe(f).click();
    await page.getByRole('dialog', { name: 'Quel dé pour « Gamme » ?' }).getByRole('button', { name: 'Dé d\'harmonie' }).click();
    await expect(fenetreDe(page, 'Dé d\'harmonie · Gamme')).toBeVisible();
    await fermerFenetre(page);
    await expect.poll(async () => !!(await exo(page, 'Gamme')).harm).toBe(true);
    expect((await exo(page, 'Gamme')).dice ?? null).toBeNull();   // un exercice a l'un OU l'autre
    await expect(reglerDe(f)).toHaveAccessibleName("Régler le dé d'harmonie");
    await boutonTirer(f).click();
    await expect(resultatDe(f)).not.toHaveText('');
    // Retrait.
    await boutonDe(f).click();
    const boite = page.getByRole('dialog').filter({ hasText: "Retirer le dé d'harmonie" });
    await expect(boite).toBeVisible();
    await boite.getByRole('button', { name: 'Retirer', exact: true }).click();
    await expect.poll(async () => (await exo(page, 'Gamme')).harm ?? null).toBeNull();
    await expect(boutonTirer(f)).toBeHidden();
  });
});
