// Tests de bout en bout de TrainHub (@playwright/test). Plan, modules et état : tests/PLAN.md. Repris d'HarmoHub.
// Les « bancs » historiques (tests/playwright/trainhub_*_test.js, scripts Node) ne passent PAS par ce fichier : voir CLAUDE-TRAINHUB.md, « Tests ».
import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;
const PORT = Number(process.env.PORT_APPLI || 8937);
// Tags d'appareil : un test « @ordinateur » ne tourne que sur les mises en page ordinateur (> 700 px), un test « @mobile » que sur celles
// du téléphone (≤ 700 px) ; sans tag, partout.
const ORDINATEUR = { grepInvert: /@mobile\b/ };
const MOBILE = { grepInvert: /@ordinateur\b/ };
// Faux micro (accordeur, enregistreur) : Chromium et Edge par options de lancement, Firefox par préférences. WebKit n'en a pas : tests @micro sautés.
const MICRO_CHROMIUM = { launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }, permissions: ['microphone'] };
const MICRO_FIREFOX = { launchOptions: { firefoxUserPrefs: { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true } } };

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  globalSetup: './tests/e2e/support/global-setup.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 2 : 3,
  timeout: 45_000,
  expect: { timeout: 7_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }], ['json', { outputFile: 'test-results/resultats.json' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',   // les fichiers « @smoke » forcent `video: 'on'` (toujours filmés)
    serviceWorkers: 'block',      // sw.js mettrait en cache la configuration de test ; un seul test (robustesse) l'autorise
  },
  webServer: {
    command: 'node scripts/serveur-test.cjs',
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, ...MICRO_CHROMIUM }, ...ORDINATEUR },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 }, ...MICRO_FIREFOX }, ...ORDINATEUR },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } }, grepInvert: /@mobile\b|@micro\b/ },
    { name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge', viewport: { width: 1440, height: 900 }, ...MICRO_CHROMIUM }, ...ORDINATEUR },
    { name: 'mobile-android', use: { ...devices['Pixel 7'], ...MICRO_CHROMIUM }, ...MOBILE },
    { name: 'mobile-iphone', use: { ...devices['iPhone 15'] }, grepInvert: /@ordinateur\b|@micro\b/ },
    { name: 'tablette', use: { ...devices['iPad Pro 11 landscape'] }, grepInvert: /@mobile\b|@micro\b/ },
  ],
});
