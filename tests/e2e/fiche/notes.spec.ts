// MODULE « fiche » — NOTES FIXES et NOTES MOBILES. Observé en boîte noire (playwright-cli, 24/11/2026) : « ＋ Note fixe » / « ＋ Note mobile » font apparaître la zone (curseur dedans) ;
// une zone vide est masquée ; enregistrement automatique (≈ 1 s après la frappe, voyant « Enregistré ✓ ») ; « Ajouter la date d'aujourd'hui » écrit « JJ/MM/AA : » ;
// au-delà de 6 lignes, à la sortie du champ, les plus anciennes partent aux archives (datées, bouton « Archives (n) »).
// Les détails au pixel (hauteur de la fiche sans note…) sont tenus par le banc `notes_vides` (PLAN § 7) : ici, les PARCOURS.
import { test, expect } from '../support/fixtures';
import { attendreChamp, boutonArchives, boutonDate, boutonNoteFixe, boutonNoteMobile, etatFiche, exo, fiche, noteFixe, noteMobile, ouvrirTechnique } from './aide-fiche';

const DATE_FIGEE = new Date('2026-11-24T10:00:00+01:00');

test.describe('Fiche : notes fixes et mobiles @fiche', () => {
  test('« ＋ Note fixe » : la zone apparaît avec le curseur dedans, le texte est enregistré tout seul (sans quitter le champ) et survit au rechargement @critique', async ({ ouvrirAppli, garde }) => {
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme majeure']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme majeure');
    await expect(noteFixe(f)).toBeHidden();
    await boutonNoteFixe(f).click();
    await expect(noteFixe(f)).toBeVisible();
    await expect(noteFixe(f)).toBeFocused();
    await expect(boutonNoteFixe(f)).toBeHidden();   // le bouton laisse la place à la zone
    await page.keyboard.type('Garder le poignet souple');
    // Toujours dans le champ : l'enregistrement est automatique.
    await expect(noteFixe(f)).toBeFocused();
    await attendreChamp(page, 'Gamme majeure', 'fixedNotes', 'Garder le poignet souple');
    await expect(f.getByText('Enregistré ✓')).toBeVisible();

    await page.reload();
    await ouvrirTechnique(page);
    await expect(noteFixe(f)).toHaveValue('Garder le poignet souple');
    await expect(boutonNoteFixe(f)).toBeHidden();
    expect(garde.bloquees).toEqual([]);
  });

  test('« ＋ Note mobile » : la zone apparaît, le texte est enregistré tout seul et une date est gardée pour la ligne @critique', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme majeure']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme majeure');
    await expect(noteMobile(f)).toBeHidden();
    await boutonNoteMobile(f).click();
    await expect(noteMobile(f)).toBeFocused();
    await page.keyboard.type('plus lent, 80 puis 90');
    await attendreChamp(page, 'Gamme majeure', 'notes', 'plus lent, 80 puis 90');
    // Une date est gardée pour la ligne (elle servira aux archives).
    await expect.poll(async () => (await exo(page, 'Gamme majeure')).noteDates?.length).toBe(1);
    await page.reload();
    await ouvrirTechnique(page);
    await expect(noteMobile(f)).toHaveValue('plus lent, 80 puis 90');
    // Les deux notes sont indépendantes : la fixe est toujours à ajouter.
    await expect(boutonNoteFixe(f)).toBeVisible();
    expect((await exo(page, 'Gamme majeure')).fixedNotes).toBe('');
  });

  test('notes vides masquées : seules les zones écrites sont visibles, le bouton de l\'autre est proposé', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche([
      'Vide',
      { titre: 'Fixe seule', extra: { fixedNotes: 'Consigne importante' } },
      { titre: 'Mobile seule', extra: { notes: '10/11 : plus lent' } },
      { titre: 'Les deux', extra: { fixedNotes: 'Fixe', notes: 'Mobile' } },
    ]) });
    await ouvrirTechnique(page);
    const [vide, fixe, mobile, deux] = ['Vide', 'Fixe seule', 'Mobile seule', 'Les deux'].map((t) => fiche(page, t));
    // Sans aucune note : rien, deux boutons.
    await expect(noteFixe(vide)).toBeHidden();
    await expect(noteMobile(vide)).toBeHidden();
    await expect(vide.getByText('Notes fixes', { exact: true })).toBeHidden();
    await expect(boutonNoteFixe(vide)).toBeVisible();
    await expect(boutonNoteMobile(vide)).toBeVisible();
    // Fixe seule.
    await expect(noteFixe(fixe)).toHaveValue('Consigne importante');
    await expect(noteMobile(fixe)).toBeHidden();
    await expect(boutonNoteFixe(fixe)).toBeHidden();
    await expect(boutonNoteMobile(fixe)).toBeVisible();
    // Mobile seule.
    await expect(noteMobile(mobile)).toHaveValue('10/11 : plus lent');
    await expect(noteFixe(mobile)).toBeHidden();
    await expect(boutonNoteMobile(mobile)).toBeHidden();
    await expect(boutonNoteFixe(mobile)).toBeVisible();
    // Les deux : aucun bouton.
    await expect(noteFixe(deux)).toHaveValue('Fixe');
    await expect(noteMobile(deux)).toHaveValue('Mobile');
    await expect(boutonNoteFixe(deux)).toBeHidden();
    await expect(boutonNoteMobile(deux)).toBeHidden();
    // La fiche sans note est plus courte que celle qui en a deux.
    const h = (l: typeof vide) => l.evaluate((e) => e.getBoundingClientRect().height);
    expect(await h(vide)).toBeLessThan((await h(deux)) - 60);
  });

  test('une zone ouverte puis laissée vide se range à la sortie du champ ; effacer tout le texte la range aussi', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    // Note mobile ouverte, rien écrit : on sort, elle se range et le bouton revient.
    await boutonNoteMobile(f).click();
    await expect(noteMobile(f)).toBeVisible();
    await noteMobile(f).blur();
    await expect(noteMobile(f)).toBeHidden();
    await expect(boutonNoteMobile(f)).toBeVisible();
    // Note fixe : écrire puis tout effacer.
    await boutonNoteFixe(f).click();
    await page.keyboard.type('x');
    await attendreChamp(page, 'Gamme', 'fixedNotes', 'x');
    await page.keyboard.press('Backspace');
    await noteFixe(f).blur();
    await expect(noteFixe(f)).toBeHidden();
    await expect(boutonNoteFixe(f)).toBeVisible();
    await attendreChamp(page, 'Gamme', 'fixedNotes', '');
  });

  test('« Ajouter la date d\'aujourd\'hui » met « JJ/MM/AA : » en tête de la note mobile, sans perdre le texte déjà là', async ({ page: p, ouvrirAppli }) => {
    await p.clock.setFixedTime(DATE_FIGEE);   // avant le chargement : la date du jour est celle du test
    const page = await ouvrirAppli({ etat: etatFiche([{ titre: 'Gamme', extra: { notes: 'ancienne ligne' } }]) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await boutonDate(f).click();
    await expect(noteMobile(f)).toHaveValue(/^24\/11\/26 :/);
    await expect(noteMobile(f)).toHaveValue(/ancienne ligne/);
    await expect.poll(async () => (await exo(page, 'Gamme')).notes).toMatch(/^24\/11\/26 :/);
    await expect.poll(async () => (await exo(page, 'Gamme')).noteDates).toContain('2026-11-24');
  });

  test('« Ajouter la date d\'aujourd\'hui » sur une zone neuve et vide : la date est écrite, prête à être complétée', async ({ page: p, ouvrirAppli, browserName }) => {
    test.fixme(browserName === 'webkit' || browserName === 'firefox', 'FI-03 (intermittent) : sous Firefox et WebKit (Safari, iPhone, iPad), le clic sur le bouton calendrier d\'une zone « Note mobile » encore vide la range parfois (perte du focus) : la date n\'est alors pas écrite.');
    await p.clock.setFixedTime(DATE_FIGEE);
    const page = await ouvrirAppli({ etat: etatFiche(['Vide']) });
    await ouvrirTechnique(page);
    const v = fiche(page, 'Vide');
    await boutonNoteMobile(v).click();
    await boutonDate(v).click();
    await expect(noteMobile(v)).toHaveValue(/^24\/11\/26 :\s*$/);
    await page.keyboard.type('à retravailler');
    await expect(noteMobile(v)).toHaveValue(/^24\/11\/26 :\s*à retravailler$/);
  });

  test('au-delà de 6 lignes, les plus anciennes partent aux archives (datées) à la sortie du champ ; le bouton « Archives » les montre @critique', async ({ page: p, ouvrirAppli }) => {
    await p.clock.setFixedTime(DATE_FIGEE);
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await boutonNoteMobile(f).click();
    await noteMobile(f).fill(['ligne 1', 'ligne 2', 'ligne 3', 'ligne 4', 'ligne 5', 'ligne 6', 'ligne 7', 'ligne 8'].join('\n'));
    // Pendant la frappe rien ne part : c'est à la sortie du champ.
    await noteMobile(f).blur();
    await expect(noteMobile(f)).toHaveValue(['ligne 3', 'ligne 4', 'ligne 5', 'ligne 6', 'ligne 7', 'ligne 8'].join('\n'));
    await expect(boutonArchives(f)).toHaveText('Archives (2)');
    await expect.poll(async () => (await exo(page, 'Gamme')).notesArchive?.map((a: any) => a.t)).toEqual(['ligne 1', 'ligne 2']);

    // Le panneau des archives liste les deux lignes, datées du jour où elles ont été écrites.
    await boutonArchives(f).click();
    await expect(boutonArchives(f)).toHaveAttribute('aria-expanded', 'true');
    await expect(f.getByText('ligne 1', { exact: true })).toBeVisible();
    await expect(f.getByText('ligne 2', { exact: true })).toBeVisible();
    await expect(f.getByText('24/11/26').first()).toBeVisible();
    // Rechargement : archives et note courante restent.
    await page.reload();
    await ouvrirTechnique(page);
    await expect(boutonArchives(f)).toHaveText('Archives (2)');
    await expect(noteMobile(f)).toHaveValue(/^ligne 3\n/);
  });

  test('un exercice qui a déjà des archives garde sa zone « Notes mobiles » (avec « Archives ») même si la note courante est vide', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche([{ titre: 'Gamme', extra: { notesArchive: [{ d: '2026-10-01', t: 'ancienne ligne' }] } }]) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await expect(boutonArchives(f)).toHaveText('Archives (1)');
    await expect(boutonNoteMobile(f)).toBeHidden();   // la zone est là, pas de « ＋ Note mobile »
    await boutonArchives(f).click();
    await expect(f.getByText('ancienne ligne', { exact: true })).toBeVisible();
    await expect(f.getByText('01/10/26').first()).toBeVisible();
  });

  test('les notes d\'un exercice ne se retrouvent pas chez un autre', async ({ ouvrirAppli }) => {
    const page = await ouvrirAppli({ etat: etatFiche(['Alpha', 'Bravo']) });
    await ouvrirTechnique(page);
    const a = fiche(page, 'Alpha'), b = fiche(page, 'Bravo');
    await boutonNoteFixe(a).click();
    await page.keyboard.type('seulement pour Alpha');
    await attendreChamp(page, 'Alpha', 'fixedNotes', 'seulement pour Alpha');
    await expect(noteFixe(b)).toBeHidden();
    expect((await exo(page, 'Bravo')).fixedNotes).toBe('');
  });
});
