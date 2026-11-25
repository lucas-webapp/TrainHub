// MODULE « fiche » — AIDES communes aux fichiers *.spec.ts du dossier (pas un test : le nom ne finit pas par .spec.ts).
// Vocabulaire de l'appli, observé en boîte noire (playwright-cli, 24/11/2026) :
//   la FICHE d'un exercice = la ligne de l'exercice dépliée (`.exercise[data-ex-id]`). En-tête (titre, pastille « En cours », accès rapides aux liens / fichiers audio /
//   captures, pastille ♩ du tempo), puis barre d'outils (tempo cible ‹ n ›, engrenage, ▶, objectif tempo, dé), « ＋ Note fixe » / « ＋ Note mobile » (les zones vides
//   sont masquées), onglets « Vidéos » / « Images » / « Liens et fichiers », champ « Coller un lien… », bouton trombone (fichier ou image) et « Dernière fois jouée ».
//   Un clic sur l'espace libre de l'en-tête (`.exercise-row-spacer`) replie / déplie la fiche. Liens, fichiers et captures : onglets de la fiche.
//   Fichiers joints et captures : octets dans IndexedDB (et Firestore seulement connecté : tests de synchro = module `synchro`), fiche dans localStorage `trainhub.v1`.
import zlib from 'zlib';
import { readFile } from 'fs/promises';
import type { Download, Locator, Page } from '@playwright/test';
import { expect } from '../support/fixtures';
import { exerciceEnregistre, idExerciceDepart, ligneDepart, ouvrirChapitre } from '../bibliotheque/aide-bibliotheque';

export { exerciceEnregistre, idExerciceDepart, ligneDepart, ouvrirChapitre };

// ---------------------------------------------------------------------------------------------------------------------------------
// État de départ
// ---------------------------------------------------------------------------------------------------------------------------------
export type ExoFiche = { titre: string; ferme?: boolean; extra?: Record<string, unknown> };
/** Un espace « Basse » (id esp-0), un chapitre « Technique » (id ch-0), des exercices dont la fiche est OUVERTE (sauf `ferme`). `extra` : champs bruts de l'exercice (dice, metronome, linkId…). */
export function etatFiche(exos: Array<string | ExoFiche>, chapitre = 'Technique') {
  const maintenant = Date.now();
  const exercises = exos.map((e) => {
    const x = typeof e === 'string' ? { titre: e } as ExoFiche : e;
    return { id: idExerciceDepart(x.titre), title: x.titre, notes: '', fixedNotes: '', collapsed: !!x.ferme, links: [], files: [], images: [], favorite: false, archived: false, updatedAt: maintenant, ...(x.extra || {}) };
  });
  return {
    instruments: [{ id: 'esp-0', name: 'Basse', categories: [{ id: 'ch-0', name: chapitre, color: '#00e676', folders: [], exercises }] }],
    activeInstrumentId: 'esp-0', updatedAt: maintenant,
  };
}
/** Journal de séances du mois (clé `trainhub.log.AAAA-MM`), à passer dans `reglages` de `ouvrirAppli`. Une séance = une liste d'exercices (id), un tempo facultatif. */
export function journal(mois: string, seances: Array<{ date: number; exercices: Array<{ id: string; titre: string; bpm?: number }> }>) {
  const records = seances.map((s, i) => ({
    v: 2, id: `r${i}`, instrumentId: 'esp-0', date: s.date, endedAt: s.date + 1_200_000, totalSec: 300 * s.exercices.length, plannedSec: 300 * s.exercices.length,
    steps: s.exercices.map((x, j) => ({ sid: `s${i}-${j}`, exerciseId: x.id, title: x.titre, chapterId: 'ch-0', chapterName: 'Technique', path: ['Technique'], pathIds: ['ch-0'], plannedMin: 5, actualSec: 300,
      bpmFirst: x.bpm ?? null, bpmMax: x.bpm ?? null, bpmEnd: x.bpm ?? null })),
  }));
  return { [`trainhub.log.${mois}`]: JSON.stringify({ records, deleted: [], updatedAt: 1 }) };
}

/** Ouvre le chapitre « Technique » (là où sont posés les exercices de test). */
export const ouvrirTechnique = (page: Page) => ouvrirChapitre(page, 'Technique');
export const fiche = (page: Page, titre: string) => ligneDepart(page, titre);
export const entete = (f: Locator) => f.locator('.exercise-row').first();
/** Espace libre de l'en-tête : un clic replie ou déplie la fiche (le titre, la pastille et les boutons ont leur propre rôle). */
export const espaceEntete = (f: Locator) => f.locator('.exercise-row-spacer').first();

/** L'exercice tel qu'enregistré dans `trainhub.v1`. */
export async function exo(page: Page, titre: string): Promise<any> {
  return (await exerciceEnregistre(page, titre))[0]?.exo;
}
/** Attend (sans pause fixe) que le champ enregistré de l'exercice vaille la valeur attendue. */
export async function attendreChamp(page: Page, titre: string, champ: string, attendu: unknown) {
  await expect.poll(async () => (await exo(page, titre))?.[champ], { message: `« ${titre} » : ${champ} enregistré` }).toEqual(attendu);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------------------------------------------------------------
export const boutonNoteFixe = (f: Locator) => f.getByRole('button', { name: /Note fixe/ });
export const boutonNoteMobile = (f: Locator) => f.getByRole('button', { name: /Note mobile/ });
export const noteFixe = (f: Locator) => f.getByPlaceholder('À ne pas oublier…');
export const noteMobile = (f: Locator) => f.getByPlaceholder('Remarques, points à retravailler…');
export const boutonDate = (f: Locator) => f.getByRole('button', { name: "Ajouter la date d'aujourd'hui" });
export const boutonArchives = (f: Locator) => f.getByRole('button', { name: /^Archives/ });

// ---------------------------------------------------------------------------------------------------------------------------------
// Liens, fichiers, captures
// ---------------------------------------------------------------------------------------------------------------------------------
export const champLien = (f: Locator) => f.getByPlaceholder('Coller un lien…');
export const boutonPlusLien = (f: Locator) => f.getByRole('button', { name: '+', exact: true });
export const boutonFichier = (f: Locator) => f.getByRole('button', { name: /Ajouter un fichier/ });
/** Onglet de la fiche (« Vidéos », « Images », « Liens et fichiers ») ; il porte le nombre d'éléments à la fin de son nom. */
export const onglet = (f: Locator, nom: string) => f.getByRole('tab', { name: new RegExp(`^${nom === 'Liens et fichiers' ? '(Liens et fichiers|Liens)' : nom}`) });   // au téléphone (≤ 700 px) l'onglet s'appelle « Liens » (liens + fichiers)
/** Ouvre l'onglet s'il n'est pas déjà celui qu'on voit. */
export async function ouvrirOnglet(f: Locator, nom: string) {
  const o = onglet(f, nom);
  await expect(o).toBeVisible();
  if ((await o.getAttribute('aria-selected')) !== 'true') await o.click();
  await expect(o).toHaveAttribute('aria-selected', 'true');
}
/** Un PDF s'ouvre dans un nouvel onglet à partir d'une adresse `blob:` ; selon le navigateur de test, il s'y affiche (visionneuse de Chrome / Edge) ou il est téléchargé
 *  (Chromium sans visionneuse, Firefox). Dans les deux cas on relit les octets réellement ouverts. */
export async function octetsDuPdfOuvert(page: Page, action: () => Promise<unknown>): Promise<Buffer> {
  const telechargements: Download[] = [];
  const onglets: Page[] = [];
  page.on('download', (d) => telechargements.push(d));
  page.context().on('page', (p) => onglets.push(p));
  await action();
  await expect.poll(() => telechargements.length > 0 || onglets.some((p) => p.url().startsWith('blob:')), { message: 'le PDF s\'ouvre (onglet blob: ou téléchargement)' }).toBe(true);
  if (telechargements.length) { expect(telechargements[0].url()).toMatch(/^blob:/); return readFile((await telechargements[0].path())!); }
  const ouvert = onglets.find((p) => p.url().startsWith('blob:'))!;
  return Buffer.from(await ouvert.evaluate(async () => Array.from(new Uint8Array(await (await fetch(location.href)).arrayBuffer()))));
}
export const puceLien = (f: Locator, libelle: string) => f.locator('a').filter({ has: f.page().getByText(libelle, { exact: true }) });

/** Colle un lien dans le champ de la fiche (Entrée). */
export async function ajouterLien(f: Locator, adresse: string) {
  await champLien(f).fill(adresse);
  await champLien(f).press('Enter');
  await expect(champLien(f)).toHaveValue('');
}

export type FichierFabrique = { name: string; mimeType: string; buffer: Buffer };
/** PDF minimal mais valide (une page blanche). */
export function pdf(name = 'partition.pdf'): FichierFabrique {
  const corps = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R/Size 4>>\n%%EOF\n';
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(corps) };
}
/** MP3 valide : 40 trames MPEG-1 couche III 128 kbit/s 44,1 kHz de silence (≈ 1 s) ; le navigateur le décode et en lit la durée. */
export function mp3(name = 'boucle.mp3', trames = 40): FichierFabrique {
  const trame = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(413)]);
  return { name, mimeType: 'audio/mpeg', buffer: Buffer.concat(Array(trames).fill(trame)) };
}
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const o of b) c = crcTable[(c ^ o) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** Image PNG unie, vraie (décodable par tous les navigateurs). */
export function png(name = 'rouge.png', [r, g, b] = [192, 57, 43], largeur = 400, hauteur = 200): FichierFabrique {
  const brut = Buffer.alloc((largeur * 3 + 1) * hauteur);
  for (let y = 0; y < hauteur; y++) for (let x = 0; x < largeur; x++) { const o = y * (largeur * 3 + 1) + 1 + x * 3; brut[o] = r; brut[o + 1] = g; brut[o + 2] = b; }
  const bloc = (type: string, data: Buffer) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
    return Buffer.concat([l, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(largeur, 0); ihdr.writeUInt32BE(hauteur, 4); ihdr[8] = 8; ihdr[9] = 2;
  const buffer = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloc('IHDR', ihdr), bloc('IDAT', zlib.deflateSync(brut)), bloc('IEND', Buffer.alloc(0))]);
  return { name, mimeType: 'image/png', buffer };
}

/** WebKit sous Playwright pour Linux (VM et CI ubuntu) refuse de ranger un Blob dans IndexedDB (mesuré : « blob » → erreur, ArrayBuffer et texte → ok) : l'appli
 *  répond alors, à juste titre, « Fichier non enregistré — Stockage plein, ou navigation privée ». Les tests qui ajoutent un fichier ou une capture ne peuvent donc pas
 *  aboutir sur webkit, tablette et mobile-iphone TANT QU'ils tournent sous Linux : `test.fixme` annoncé (ENV-FI-01, voir tests/reports/), à rejouer sur un WebKit de macOS. */
export function sansBlobIndexedDB(test: { fixme: (condition: boolean, description: string) => void }, browserName: string) {
  test.fixme(browserName === 'webkit' && process.platform === 'linux', 'ENV-FI-01 : le WebKit de Playwright sous Linux ne sait pas ranger un Blob dans IndexedDB (fichier joint et capture impossibles) ; à rejouer sur macOS.');
}

/** Ajoute des fichiers (ou des images) par le bouton trombone de la fiche : vrai sélecteur de fichiers du navigateur. */
export async function ajouterFichiers(page: Page, f: Locator, ...fichiers: FichierFabrique[]) {
  const [choix] = await Promise.all([page.waitForEvent('filechooser'), boutonFichier(f).click()]);
  await choix.setFiles(fichiers);
}

/** Ajoute UN fichier : l'appli ouvre aussitôt son nom à la modification (comme pour un lien) ; on le garde tel quel (Entrée). */
export async function ajouterFichier(page: Page, f: Locator, fichier: FichierFabrique) {
  await ajouterFichiers(page, f, fichier);
  const saisie = f.locator('input:focus');
  await expect(saisie).toHaveValue(fichier.name);
  await saisie.press('Enter');
  await expect(saisie).toHaveCount(0);
}

/** Ce que renvoie un lien ouvert dans un nouvel onglet : on répond à la place du site (aucun accès réseau réel). */
export async function repondreAuxSites(page: Page) {
  await page.context().route(/^https:\/\/(exemple\.fr|www\.youtube\.com\/watch)/, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>site de test</title><p>ok</p>' }));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Métronome prédéfini, objectif tempo, dé
// ---------------------------------------------------------------------------------------------------------------------------------
export const champTempo = (f: Locator) => f.getByRole('spinbutton', { name: /Tempo cible/ });
export const boutonObjectif = (f: Locator) => f.getByRole('button', { name: /^Objectif tempo/ });
export const boutonOptionsMetro = (f: Locator) => f.getByRole('button', { name: /^Options : préconfigurer/ });
export const boutonDe = (f: Locator) => f.getByRole('button', { name: /^(Allumer un dé|Un dé tire au sort|Dé d'harmonie)/ });
export const boutonTirer = (f: Locator) => f.getByRole('button', { name: 'Tirer', exact: true });
export const resultatDe = (f: Locator) => f.locator('.dice-ex-res');

/** Légende « Dernière fois jouée … » (une seule par fiche ouverte). */
export const legendeJouee = (f: Locator) => f.locator('.ex-last-played');

/** Date figée (fuseau du navigateur : Europe/Paris). */
export const MAINTENANT = new Date('2026-11-24T10:00:00+01:00');
export const ilYaJours = (n: number, heure = 18) => new Date(MAINTENANT.getTime() - n * 86_400_000 + (heure - 10) * 3_600_000).getTime();
