// MODULE « demarrage » — LE GARDE-FOU LUI-MÊME est éprouvé (sur chromium seulement : c'est une vérification d'infrastructure).
// 1. une requête vers la production Firebase est INTERROMPUE et le test ÉCHOUE (test marqué `fail` : il doit échouer, sinon il rougit) ;
// 2. un projet qui n'est pas « demo-… » est refusé par la fonction qu'utilisent le globalSetup et la fixture.
import { test, expect } from '../support/fixtures';
import { exigerProjetDemo } from '../support/emulateurs';

test.describe('Garde-fou production @critique @demarrage', () => {
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'chromium', 'vérification d\'infrastructure : chromium seulement'); });

  test('une requête vers firestore.googleapis.com est bloquée et fait échouer le test', async ({ ouvrirAppli }) => {
    test.fail(true, 'ce test DOIT échouer : la fixture « garde » le fait tomber dès qu\'une requête vise la production');
    const page = await ouvrirAppli();
    const resultat = await page.evaluate(() => fetch('https://firestore.googleapis.com/v1/projects/lucas-apps-479b9/databases/(default)/documents/x').then(() => 'passée', () => 'bloquée'));
    expect(resultat).toBe('bloquée');   // la requête n'est jamais partie… et le garde-fou fait quand même échouer le test à la fin
  });

  test('une requête vers Firebase Storage (production) est bloquée aussi', async ({ ouvrirAppli }) => {
    test.fail(true, 'ce test DOIT échouer : Storage n\'est pas utilisé par TrainHub, mais une requête vers lui serait bloquée et ferait échouer le test');
    const page = await ouvrirAppli();
    const resultat = await page.evaluate(() => fetch('https://firebasestorage.googleapis.com/v0/b/lucas-apps-479b9.firebasestorage.app/o').then(() => 'passée', () => 'bloquée'));
    expect(resultat).toBe('bloquée');
  });

  test('un projet qui n\'est pas « demo- » est refusé', () => {
    expect(() => exigerProjetDemo('lucas-apps-479b9')).toThrow(/GARDE-FOU/);
    expect(() => exigerProjetDemo('demo-trainhub')).not.toThrow();
  });
});
