// MODULE « fiche » — « DERNIÈRE FOIS JOUÉE » (légende en bas de la fiche ouverte). Observé en boîte noire (playwright-cli, 24/11/2026) : avec un journal de séances
// (localStorage `trainhub.log.AAAA-MM`), une fiche ouverte dit « Dernière fois jouée : il y a 2 jours (dimanche 22 novembre). 1 séance en tout. Dernier tempo atteint : 90 BPM. »
// ou « Jamais jouée en session depuis le <date> (début du journal). » ; sans journal, légende vide ; repliée, aucune légende ; l'objectif tempo décide de la mention du tempo.
// La date est figée par `page.clock.setFixedTime` (24/11/2026 10:00, Paris). Le détail des phrases (rythme par mois…) est tenu par le banc `derniere_ligne` (PLAN § 7).
import { test, expect } from '../support/fixtures';
import { boutonObjectif, espaceEntete, etatFiche, fiche, ilYaJours, journal, legendeJouee, MAINTENANT, ouvrirTechnique } from './aide-fiche';

const idDe = (titre: string) => `ex-${titre.toLowerCase()}`;
const seance = (jours: number, ...exos: Array<[string, number?]>) => ({ date: ilYaJours(jours), exercices: exos.map(([titre, bpm]) => ({ id: idDe(titre), titre, bpm })) });

test.describe('Fiche : « Dernière fois jouée » @fiche', () => {
  test('exercice joué il y a 2 jours : la date, le nombre de séances et le dernier tempo atteint s\'affichent @critique', async ({ page: p, ouvrirAppli, garde }) => {
    await p.clock.setFixedTime(MAINTENANT);
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']), reglages: journal('2026-11', [seance(2, ['Gamme', 90])]) });
    await ouvrirTechnique(page);
    await expect(legendeJouee(fiche(page, 'Gamme'))).toHaveText('Dernière fois jouée : il y a 2 jours (dimanche 22 novembre). 1 séance en tout. Dernier tempo atteint : 90 BPM.');
    expect(garde.bloquees).toEqual([]);
  });

  test('plusieurs séances : « il y a » suit la plus récente et le dernier tempo est celui de la séance la plus récente qui en a un', async ({ page: p, ouvrirAppli }) => {
    await p.clock.setFixedTime(MAINTENANT);
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']), reglages: journal('2026-11', [seance(10, ['Gamme', 80]), seance(5, ['Gamme', 100]), seance(1, ['Gamme'])]) });
    await ouvrirTechnique(page);
    const l = legendeJouee(fiche(page, 'Gamme'));
    await expect(l).toContainText('Dernière fois jouée : hier (lundi 23 novembre).');
    await expect(l).toContainText('3 séances en tout.');
    await expect(l).toContainText('Dernier tempo atteint : 100 BPM.');
  });

  test('exercice jamais joué alors que le journal existe : « Jamais jouée en session depuis le … (début du journal) » @critique', async ({ page: p, ouvrirAppli }) => {
    await p.clock.setFixedTime(MAINTENANT);
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme', 'Jamais']), reglages: journal('2026-11', [seance(2, ['Gamme', 90])]) });
    await ouvrirTechnique(page);
    await expect(legendeJouee(fiche(page, 'Jamais'))).toHaveText('Jamais jouée en session depuis le dimanche 22 novembre (début du journal).');
  });

  test('sans journal de séances : rien n\'est écrit (légende vide)', async ({ page: p, ouvrirAppli }) => {
    await p.clock.setFixedTime(MAINTENANT);
    const sans = await ouvrirAppli({ etat: etatFiche(['Gamme']) });
    await ouvrirTechnique(sans);
    await expect(fiche(sans, 'Gamme').getByPlaceholder('Coller un lien…')).toBeVisible();
    await expect(legendeJouee(fiche(sans, 'Gamme'))).toHaveText('');
  });

  test('fiche repliée : pas de légende ; la rouvrir la montre', async ({ page: p, ouvrirAppli }) => {
    await p.clock.setFixedTime(MAINTENANT);
    const page = await ouvrirAppli({ etat: etatFiche([{ titre: 'Gamme', ferme: true }]), reglages: journal('2026-11', [seance(2, ['Gamme', 90])]) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await expect(legendeJouee(f)).toHaveCount(0);
    await espaceEntete(f).click();
    await expect(legendeJouee(f)).toContainText('Dernière fois jouée : il y a 2 jours');
  });

  test('objectif tempo désactivé au départ : la légende ne parle pas du tempo', async ({ page: p, ouvrirAppli }) => {
    await p.clock.setFixedTime(MAINTENANT);
    const page = await ouvrirAppli({ etat: etatFiche([{ titre: 'Gamme', extra: { tempoGoal: false } }]), reglages: journal('2026-11', [seance(2, ['Gamme', 90])]) });
    await ouvrirTechnique(page);
    const l = legendeJouee(fiche(page, 'Gamme'));
    await expect(l).toHaveText('Dernière fois jouée : il y a 2 jours (dimanche 22 novembre). 1 séance en tout.');
    await expect(boutonObjectif(fiche(page, 'Gamme'))).toHaveAttribute('aria-pressed', 'false');
  });

  test('basculer l\'objectif tempo met la légende à jour tout de suite (sans recharger)', async ({ page: p, ouvrirAppli }) => {
    test.fail(true, 'FI-02 : éteindre ou allumer « Objectif tempo » ne met pas la légende « Dernière fois jouée » à jour : « Dernier tempo atteint » reste (ou manque) jusqu\'au rechargement de la page.');
    await p.clock.setFixedTime(MAINTENANT);
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']), reglages: journal('2026-11', [seance(2, ['Gamme', 90])]) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await expect(legendeJouee(f)).toContainText('Dernier tempo atteint : 90 BPM.');
    await boutonObjectif(f).click();
    await expect(boutonObjectif(f)).toHaveAttribute('aria-pressed', 'false');
    await expect(legendeJouee(f)).not.toContainText('Dernier tempo');
  });

  test('basculer l\'objectif tempo : après rechargement, la légende suit le nouvel état', async ({ page: p, ouvrirAppli }) => {
    await p.clock.setFixedTime(MAINTENANT);
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']), reglages: journal('2026-11', [seance(2, ['Gamme', 90])]) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await boutonObjectif(f).click();
    await expect(boutonObjectif(f)).toHaveAttribute('aria-pressed', 'false');
    await page.reload();
    await ouvrirTechnique(page);
    await expect(legendeJouee(f)).toHaveText('Dernière fois jouée : il y a 2 jours (dimanche 22 novembre). 1 séance en tout.');
    await boutonObjectif(f).click();
    await page.reload();
    await ouvrirTechnique(page);
    await expect(legendeJouee(f)).toContainText('Dernier tempo atteint : 90 BPM.');
  });
});
