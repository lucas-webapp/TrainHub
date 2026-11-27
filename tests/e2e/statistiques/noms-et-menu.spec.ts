// MODULE « statistiques » — NOMS À JOUR et MENU D'UN EXERCICE depuis les statistiques. Chaque séance du journal garde FIGÉS le titre, le chapitre et le dossier de ses exercices, mais les statistiques
// affichent les noms ACTUELS (un exercice, un chapitre ou un dossier renommé apparaît sous son nouveau nom) ; un exercice supprimé garde son titre d'alors. Un clic droit (appui long au téléphone) sur
// un exercice des statistiques ouvre son menu (« Ouvrir dans son dossier », « Renommer… »…). Observé en boîte noire (playwright-cli, 26/11/2026, horloge figée au 26/11/2026 10:00).
import { test, expect } from '../support/fixtures';
import { choisirAction, menuContextuel, ouvrirMenu, ligneDepart, fil, exercicesEnregistres } from '../bibliotheque/aide-bibliotheque';
import { aller, carte, ouvrirMenuCarte, choisirPeriode, contenu, entreeCarte, etatStats, fenetre, ilYa, lignesBloc, ouvrirFenetre, ouvrirStats, section } from './aide-statistiques';

const SEANCES = () => [{ quand: ilYa(2, '07:00'), pas: [{ ex: 'Gamme majeure', min: 10 }, { ex: 'Croches', min: 6, sous: 'Rythme' }] }];
const renommer = (etat: any, ancien: string, nouveau: string) => { const p = (n: any) => { (n.exercises || []).forEach((x: any) => { if (x.title === ancien) x.title = nouveau; }); (n.folders || []).forEach(p); }; etat.instruments[0].categories.forEach(p); return etat; };

test.describe('Statistiques : noms à jour et menu d\'un exercice @statistiques', () => {
  test.describe('noms à jour', () => {
    test('un exercice renommé depuis apparaît sous son nouveau nom partout @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, SEANCES(), { etat: renommer(etatStats(), 'Gamme majeure', 'Gamme majeure à deux octaves') });
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      await expect(carte(page, 'Gamme majeure à deux octaves')).toBeVisible();
      await expect(contenu(page).locator('.st-ex-name').filter({ hasText: /^Gamme majeure(?! à)/ })).toHaveCount(0);
      await aller(page, 'Répartition');
      expect(await lignesBloc(section(page, 'Les plus travaillés'))).toEqual(['Gamme majeure à deux octaves | 10 min · 1×', 'Croches | 6 min · 1×']);
    });

    test('un chapitre et un dossier renommés : le journal garde les anciens noms, l\'écran montre les nouveaux @critique', async ({ page, ouvrirAppli }) => {
      const etat: any = etatStats();
      etat.instruments[0].categories[0].name = 'Technique avancée';
      etat.instruments[0].categories[0].folders[0].name = 'Rythmes';
      await ouvrirStats(page, ouvrirAppli, SEANCES(), { etat });
      await ouvrirFenetre(page);
      await aller(page, 'Répartition');
      expect(await contenu(page).locator('.st-pie-wrap').first().locator('.st-pie-row .st-pie-name').allTextContents()).toEqual(['Technique avancée']);
      expect(await contenu(page).locator('.st-pie-wrap').nth(1).locator('.st-pie-row .st-pie-name').allTextContents()).toEqual(['Directement dans le chapitre', 'RythmesTechnique avancée']);
    });

    test('le détail d\'une journée utilise aussi les noms actuels du chapitre et du dossier', async ({ page, ouvrirAppli }) => {
      const etat: any = etatStats();
      etat.instruments[0].categories[0].name = 'Technique avancée';
      etat.instruments[0].categories[0].folders[0].name = 'Rythmes';
      await ouvrirStats(page, ouvrirAppli, SEANCES(), { etat });
      await ouvrirFenetre(page);
      await choisirPeriode(page, '3 derniers jours');
      expect(await lignesBloc(section(page, 'Détail par chapitre'))).toEqual(['Technique avancée | 16 min · 100 %', 'Gamme majeure | 10 min', 'Rythmes | 6 min', 'Croches | 6 min']);
    });

    test('un exercice supprimé (son chapitre existe encore) garde le titre qu\'il avait dans la séance', async ({ page, ouvrirAppli }) => {
      const etat: any = etatStats();
      etat.instruments[0].categories[0].exercises = etat.instruments[0].categories[0].exercises.filter((x: any) => x.title !== 'Gamme majeure');
      await ouvrirStats(page, ouvrirAppli, SEANCES(), { etat });
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      await expect(carte(page, 'Gamme majeure')).toBeVisible();
      await expect(carte(page, 'Gamme majeure').locator('.st-ex-name small')).toHaveText('Technique');
    });
  });

  test.describe('menu d\'un exercice', () => {
    test('clic droit sur une carte de l\'onglet Exercices : le menu de l\'exercice, avec « Ouvrir dans son dossier » en premier', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, SEANCES());
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      await ouvrirMenuCarte(page, entreeCarte(carte(page, 'Croches')));
      const menu = menuContextuel(page);
      await expect(menu).toContainText('Croches');
      await expect(menu.getByRole('button', { name: 'Ouvrir dans son dossier' })).toBeVisible();
      await expect(menu.getByRole('button', { name: 'Renommer…' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(fenetre(page)).toBeVisible();
    });

    test('« Ouvrir dans son dossier » ferme les statistiques et affiche l\'exercice dans son dossier @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, SEANCES());
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      await ouvrirMenuCarte(page, entreeCarte(carte(page, 'Croches')));
      await choisirAction(page, 'Ouvrir dans son dossier');
      await expect(fenetre(page)).toBeHidden();
      await expect(fil(page)).toContainText('Rythme');
      await expect(ligneDepart(page, 'Croches')).toBeVisible();
    });

    test('« Renommer… » depuis les statistiques : le nouveau nom apparaît aussitôt dans la liste @critique', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, SEANCES());
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      await ouvrirMenuCarte(page, entreeCarte(carte(page, 'Croches')));
      await choisirAction(page, 'Renommer…');
      const boite = page.getByRole('dialog', { name: 'Renommer l\'exercice' });
      await boite.getByRole('textbox').fill('Croches swing');
      await boite.getByRole('textbox').press('Enter');
      await expect(boite).toBeHidden();
      await expect(fenetre(page)).toBeVisible();
      await expect(carte(page, 'Croches swing')).toBeVisible();
      await expect.poll(async () => (await exercicesEnregistres(page)).map((x) => x.exo.title)).toContain('Croches swing');
    });

    test('clic droit sur une ligne de « Les plus travaillés », du détail d\'une barre et du détail du jour ouvre le même menu', async ({ page, ouvrirAppli }) => {
      await ouvrirStats(page, ouvrirAppli, SEANCES());
      await ouvrirFenetre(page);
      await aller(page, 'Répartition');
      await ouvrirMenu(page, contenu(page).locator('.gs-stat-row').filter({ hasText: /^Gamme majeure/ }).first());
      await expect(menuContextuel(page).getByRole('button', { name: 'Ouvrir dans son dossier' })).toBeVisible();
      await page.keyboard.press('Escape');
      await aller(page, 'Aperçu');
      await contenu(page).locator('svg.st-bars rect.st-bar').first().click();
      await ouvrirMenu(page, contenu(page).locator('.st-pick .st-tree-ex').filter({ hasText: /^Croches/ }).first());
      await expect(menuContextuel(page).getByRole('button', { name: 'Renommer…' })).toBeVisible();
      await page.keyboard.press('Escape');
      await choisirPeriode(page, '3 derniers jours');
      await ouvrirMenu(page, section(page, 'Détail par chapitre').locator('.st-tree-ex').filter({ hasText: /^Gamme majeure/ }).first());
      await expect(menuContextuel(page).getByRole('button', { name: 'Ouvrir dans son dossier' })).toBeVisible();
      await page.keyboard.press('Escape');
    });

    test('un exercice supprimé n\'a pas de menu (rien à ouvrir) ; la carte reste lisible', async ({ page, ouvrirAppli }) => {
      const etat: any = etatStats();
      etat.instruments[0].categories[0].exercises = etat.instruments[0].categories[0].exercises.filter((x: any) => x.title !== 'Gamme majeure');
      await ouvrirStats(page, ouvrirAppli, SEANCES(), { etat });
      await ouvrirFenetre(page);
      await aller(page, 'Exercices');
      await expect(entreeCarte(carte(page, 'Gamme majeure'))).not.toHaveClass(/st-has-menu/);
      await expect(entreeCarte(carte(page, 'Croches'))).toHaveClass(/st-has-menu/);
      await entreeCarte(carte(page, 'Gamme majeure')).click({ button: 'right' });
      await expect(menuContextuel(page)).toHaveCount(0);
    });
  });
});
