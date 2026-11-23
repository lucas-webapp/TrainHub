// FIXTURES COMMUNES : tout test importe `test` et `expect` d'ici, jamais de '@playwright/test' directement.
// GARDE-FOU N° 2 (automatique, pour chaque test) : toute requête vers un domaine de la PRODUCTION Firebase est interrompue ET le test échoue.
// Repris d'HarmoHub (tests/PLAN.md § 9) ; seule `ouvrirAppli` décrit TrainHub.
import { test as base, expect, Page } from '@playwright/test';
import { DOMAINES_PRODUCTION, exigerProjetDemo } from './emulateurs';
import { URL_EXTERNES_COUPEES, apiYouTubeFactice, etatDeDepart, ExerciceDeDepart, CLE_ETAT, CLE_NE_PLUS_PROPOSER } from './appli';

type Fixtures = {
  garde: { bloquees: string[] };
  ouvrirAppli: (options?: { exercices?: ExerciceDeDepart[]; etat?: unknown; reglages?: Record<string, string>; accueil?: 'passer' | 'garder' | 'jamais'; gapi?: boolean }) => Promise<Page>;
};

export const test = base.extend<Fixtures>({
  garde: [async ({ context, baseURL }, use, testInfo) => {
    exigerProjetDemo();
    const bloquees: string[] = [];
    // Ordre : la DERNIÈRE route déclarée l'emporte. D'abord la barrière générale, puis les ressources externes coupées, puis le faux YouTube.
    // Le SDK et la configuration de test sont servis par scripts/serveur-test.cjs (aucune route ici).
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (DOMAINES_PRODUCTION.test(url.hostname)) { bloquees.push(url.href); return route.abort('blockedbyclient'); }
      return route.fallback();
    });
    await context.route(URL_EXTERNES_COUPEES, (route) => route.abort('blockedbyclient'));
    const api = apiYouTubeFactice(baseURL!);
    await context.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: api }));
    await use({ bloquees });
    if (bloquees.length) {
      await testInfo.attach('requetes-production-bloquees.txt', { body: bloquees.join('\n'), contentType: 'text/plain' });
      throw new Error(`GARDE-FOU : ${bloquees.length} requête(s) vers la PRODUCTION Firebase ont été bloquées (première : ${bloquees[0]}). Le test échoue.`);
    }
  }, { auto: true }],

  ouvrirAppli: async ({ page, context }, use) => {
    await use(async (options = {}) => {
      // La fenêtre de connexion Google a besoin du chargeur public apis.google.com (pas le projet) : laissé passer seulement si un test le demande.
      if (options.gapi) await context.route(/^https:\/\/apis\.google\.com\//, (route) => route.continue());
      const etat = options.etat ?? (options.exercices ? etatDeDepart(options.exercices) : null);
      await page.addInitScript(([e, reglages, cleEtat, cleNePlus, jamais]) => {
        if (sessionStorage.getItem('e2e-graine')) return;   // une seule fois : un rechargement garde ce que l'utilisateur a fait
        sessionStorage.setItem('e2e-graine', '1');
        if (e) localStorage.setItem(cleEtat, JSON.stringify(e));
        if (jamais) localStorage.setItem(cleNePlus, '1');
        for (const [k, v] of Object.entries(reglages || {})) localStorage.setItem(k, v as string);
      }, [etat, options.reglages || {}, CLE_ETAT, CLE_NE_PLUS_PROPOSER, options.accueil === 'jamais'] as const);
      await page.goto('/index.html');
      await expect(page.locator('#folder-container')).toBeAttached();
      // Firebase (émulateur) répond « personne n'est connecté » : la fenêtre d'accueil du compte propose de se connecter.
      // Par défaut on la passe comme un utilisateur (« Continuer sans compte ») ; `accueil: 'garder'` la laisse au test qui l'éprouve ;
      // `accueil: 'jamais'` coche d'avance « Ne plus me le proposer sur cet appareil ».
      const accueil = page.locator('#cloud-guard-modal'), pilule = page.locator('#google-signin-btn, #account-info');
      await expect(accueil.or(pilule).first()).toBeVisible({ timeout: 15_000 });
      // compte-cloud.js montre la pilule et ouvre la fenêtre dans la MÊME fonction (authPrete) : quand l'une est visible, l'autre est décidée.
      if ((options.accueil ?? 'passer') === 'passer' && await accueil.isVisible()) {
        await page.locator('#cloud-guard-continue').click();
        await expect(accueil).toBeHidden();
      }
      return page;
    });
  },
});

export { expect };
