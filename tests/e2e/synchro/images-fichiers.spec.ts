// MODULE « synchro » — CAPTURES et FICHIERS JOINTS dans Firestore (jamais Firebase Storage : l'appli n'appelle pas `firebase.storage()`).
// Observé en boîte noire (playwright-cli, 26/11/2026) : connecté, une capture devient le document `users/{uid}/apps/trainhub-img-<id>` (image en base64 dans `data`, avec `type` et `name`) et
// sa fiche (`ex.images[]`) porte `cloud: true` ; un fichier joint est découpé en morceaux de 800 Kio, un document `trainhub-file-<cid>-<n>` chacun (`bytes`, `i`, `n`), et sa fiche porte
// `cloud: true` et `chunks`. L'info-bulle du bouton trombone dit « envoyé dans votre compte ». Un ajout fait HORS connexion part à la connexion. Retirer un fichier ou une capture supprime ses
// documents. Un second appareil recompose le fichier (tous les morceaux, taille vérifiée) et affiche la capture. Au-delà de 30 Mo un fichier reste sur l'appareil, avec un message.
// LIMITE D'ENVIRONNEMENT (ENV-FI-01, voir module `fiche`) : WebKit sous Linux refuse de ranger un Blob dans IndexedDB, donc AJOUTER un fichier ou une capture est impossible sur webkit, tablette et
// mobile-iphone sous Linux (`test.fixme` annoncé) ; leur LECTURE depuis le cloud (documents posés dans l'émulateur) est, elle, testée sur tous les projets.
import type { Locator, Page } from '@playwright/test';
import { test, expect, adresse, attendreSynchro, connecter, document, documents, lancerConnexion, pastille, poserDocument } from './aide-synchro';
import { ajouterFichier, ajouterFichiers, etatFiche, exo, fiche, onglet, ouvrirOnglet, ouvrirTechnique, octetsDuPdfOuvert, pdf, png, sansBlobIndexedDB, type FichierFabrique } from '../fiche/aide-fiche';

const vignettes = (f: Locator) => f.locator('.img-fig');
const boutonFichier = (f: Locator, nom: string) => f.getByRole('button', { name: new RegExp(`^${nom.replace('.', '\\.')}\\b`) });
const toast = (page: Page, texte: string | RegExp) => page.locator('.toast').filter({ hasText: texte });
const decoderImage = (data: string) => Buffer.from(data.replace(/^data:[^;]+;base64,/, ''), 'base64');

/** Un « PDF » de `octets` octets au contenu reconnaissable (chaque octet dépend de sa position : un morceau perdu ou permuté se voit). */
function grosFichier(nom: string, octets: number): FichierFabrique {
  const tete = Buffer.from('%PDF-1.4\n');
  const corps = Buffer.alloc(octets - tete.length);
  for (let i = 0; i < corps.length; i++) corps[i] = (i * 7 + (i >> 8)) & 0xff;
  return { name: nom, mimeType: 'application/pdf', buffer: Buffer.concat([tete, corps]) };
}
/** Fabrique la liste des morceaux de 800 Kio exactement comme l'appli les range. */
const morceaux = (buffer: Buffer) => { const m: Buffer[] = []; for (let i = 0; i < buffer.length; i += 800 * 1024) m.push(buffer.subarray(i, i + 800 * 1024)); return m; };

/** Un compte connecté dont le cloud n'a RIEN encore (état par défaut poussé) : sert de second appareil à qui l'on fait « arriver » des documents posés dans l'émulateur. */
async function appareilConnecteVide(ouvrirAppli: (o?: any) => Promise<Page>, projet: string, prefixe: string) {
  const page = await ouvrirAppli();
  const uid = await connecter(page, adresse(projet, prefixe));
  return { page, uid };
}

test.describe('Synchro : captures et fichiers dans Firestore @synchro', () => {
  test.describe.configure({ timeout: 90_000 });   // la synchro attend un émulateur et un SDK réseau : sous la charge de la matrice complète, WebKit met parfois plus de 20 s à acquitter une écriture
  test('une capture ajoutée une fois connecté devient un document trainhub-img-<id> (octets identiques) et la fiche est marquée « dans le cloud » @critique', async ({ ouvrirAppli, browserName }, testInfo) => {
    sansBlobIndexedDB(test, browserName);
    const page = await ouvrirAppli({ etat: etatFiche(['Tablatures']) });
    const uid = await connecter(page, adresse(testInfo.project.name, 'e2e-capture'));
    await ouvrirTechnique(page);
    const f = fiche(page, 'Tablatures');
    await expect(f.getByRole('button', { name: /envoyé dans votre compte$/ })).toBeVisible();   // le trombone annonce où ira le fichier
    const rouge = png('rouge.png', [192, 57, 43]);
    await ajouterFichiers(page, f, rouge);
    await expect(onglet(f, 'Images')).toHaveText(/Images\s*1/);

    await expect.poll(async () => (await exo(page, 'Tablatures')).images?.[0]?.cloud, { message: 'la fiche note que la capture est dans le cloud', timeout: 20_000 }).toBe(true);
    const meta = (await exo(page, 'Tablatures')).images[0];
    expect(await documents(uid)).toEqual(['trainhub', `trainhub-img-${meta.id}`]);
    const doc = await document(uid, `trainhub-img-${meta.id}`);
    expect(doc).toMatchObject({ type: 'image/png', name: 'rouge.png' });
    expect(doc.data).toMatch(/^data:image\/png;base64,/);
    expect(decoderImage(doc.data).equals(rouge.buffer)).toBe(true);
    // La fiche envoyée dans le document principal porte aussi `cloud: true` (c'est ce qui dit aux autres appareils d'aller chercher l'image).
    await attendreSynchro(page);
    await expect.poll(async () => (await document(uid, 'trainhub')).instruments[0].categories[0].exercises[0].images?.[0]?.cloud).toBe(true);
  });

  test('un second appareil affiche la capture venue du cloud (image décodée, nom conservé) @critique', async ({ ouvrirAppli, ouvrirAppareil, browserName }, testInfo) => {
    sansBlobIndexedDB(test, browserName);
    const email = adresse(testInfo.project.name, 'e2e-capture-b');
    const a = await ouvrirAppli({ etat: etatFiche(['Tablatures']) });
    const uid = await connecter(a, email);
    await ouvrirTechnique(a);
    await ajouterFichiers(a, fiche(a, 'Tablatures'), png('rouge.png', [192, 57, 43]));
    await expect.poll(async () => (await exo(a, 'Tablatures')).images?.[0]?.cloud, { timeout: 20_000 }).toBe(true);

    const b = await ouvrirAppareil();
    await connecter(b, email);
    await ouvrirTechnique(b);
    const fb = fiche(b, 'Tablatures');
    await expect(onglet(fb, 'Images')).toHaveText(/Images\s*1/, { timeout: 20_000 });
    await ouvrirOnglet(fb, 'Images');
    await expect(vignettes(fb)).toHaveCount(1);
    await expect.poll(() => vignettes(fb).locator('img').first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth), { message: 'image décodée sur B', timeout: 20_000 }).toBe(400);
    expect((await exo(b, 'Tablatures')).images[0]).toMatchObject({ name: 'rouge.png', type: 'image/png', cloud: true });
    expect(uid).toBeTruthy();
  });

  test('capture déjà dans le compte (document posé dans l\'émulateur) : l\'appareil qui se connecte l\'affiche, sur tous les navigateurs @critique', async ({ ouvrirAppli }, testInfo) => {
    const { page, uid } = await appareilConnecteVide(ouvrirAppli, testInfo.project.name, 'e2e-capture-lecture');
    const bleu = png('bleu.png', [41, 128, 185]);
    await poserDocument(uid, 'trainhub-img-img-semee', { data: `data:image/png;base64,${bleu.buffer.toString('base64')}`, type: 'image/png', name: 'bleu.png', updatedAt: Date.now() });
    const etat: any = etatFiche([{ titre: 'Tablatures', extra: { images: [{ id: 'img-semee', name: 'bleu.png', type: 'image/png', size: bleu.buffer.length, addedAt: Date.now(), cloud: true }] } }]);
    await poserDocument(uid, 'trainhub', { ...etat, updatedAt: Date.now() + 120_000 });   // plus récent : l'appareil le reçoit par son écoute

    await ouvrirTechnique(page);
    const f = fiche(page, 'Tablatures');
    await expect(onglet(f, 'Images')).toHaveText(/Images\s*1/, { timeout: 20_000 });
    await ouvrirOnglet(f, 'Images');
    await expect(vignettes(f)).toHaveCount(1);
    await expect.poll(() => vignettes(f).locator('img').first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth), { timeout: 20_000 }).toBe(400);
  });

  test('un fichier PDF ajouté une fois connecté devient un document trainhub-file-<id>-0 aux octets identiques, avec un message ; sa fiche porte « cloud » et le nombre de morceaux @critique', async ({ ouvrirAppli, browserName }, testInfo) => {
    sansBlobIndexedDB(test, browserName);
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']) });
    const uid = await connecter(page, adresse(testInfo.project.name, 'e2e-fichier'));
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    const partition = pdf('partition.pdf');
    await ajouterFichier(page, f, partition);
    await expect(toast(page, '« partition.pdf » est dans votre compte : disponible sur tous vos appareils.')).toBeVisible({ timeout: 20_000 });

    const meta = (await exo(page, 'Gamme')).files[0];
    expect(meta).toMatchObject({ name: 'partition.pdf', type: 'application/pdf', size: partition.buffer.length, cloud: true, chunks: 1 });
    expect(await documents(uid)).toEqual(['trainhub', `trainhub-file-${meta.cid || meta.id}-0`]);
    const doc = await document(uid, `trainhub-file-${meta.cid || meta.id}-0`);
    expect(doc).toMatchObject({ i: 0, n: 1 });
    expect(Buffer.from(doc.bytes, 'base64').equals(partition.buffer)).toBe(true);
  });

  test('l\'info-bulle d\'un fichier qui est dans le compte ne prétend plus qu\'il est « stocké seulement sur cet appareil »', async ({ ouvrirAppli, browserName }, testInfo) => {
    test.fail(true, 'SY-03 : l\'info-bulle de la pastille du fichier dit toujours « Fichier stocké seulement sur cet appareil (non synchronisé) », même quand le fichier est dans le compte');
    sansBlobIndexedDB(test, browserName);
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']) });
    await connecter(page, adresse(testInfo.project.name, 'e2e-infobulle'));
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await ajouterFichier(page, f, pdf('partition.pdf'));
    await expect.poll(async () => (await exo(page, 'Gamme')).files?.[0]?.cloud, { timeout: 20_000 }).toBe(true);
    await page.reload();
    await ouvrirTechnique(page);
    await ouvrirOnglet(f, 'Liens et fichiers');
    await expect(boutonFichier(f, 'partition.pdf')).toBeVisible();
    await expect(f.getByTitle('Fichier stocké seulement sur cet appareil (non synchronisé)')).toHaveCount(0);
  });

  test('un gros fichier (1,7 Mo) est découpé en 3 morceaux de 800 Kio au plus ; recollés, ils redonnent les mêmes octets, et un second appareil l\'ouvre @critique', async ({ ouvrirAppli, ouvrirAppareil, browserName }, testInfo) => {
    sansBlobIndexedDB(test, browserName);
    const email = adresse(testInfo.project.name, 'e2e-gros');
    const a = await ouvrirAppli({ etat: etatFiche(['Gamme']) });
    const uid = await connecter(a, email);
    await ouvrirTechnique(a);
    const gros = grosFichier('recueil.pdf', 1_700_000);
    await ajouterFichier(a, fiche(a, 'Gamme'), gros);
    await expect.poll(async () => (await exo(a, 'Gamme')).files?.[0]?.cloud, { timeout: 30_000 }).toBe(true);
    const meta = (await exo(a, 'Gamme')).files[0];
    const cid = meta.cid || meta.id;
    expect(meta.chunks).toBe(3);
    expect(await documents(uid)).toEqual(['trainhub', `trainhub-file-${cid}-0`, `trainhub-file-${cid}-1`, `trainhub-file-${cid}-2`]);
    const morceauxCloud = await Promise.all([0, 1, 2].map((i) => document(uid, `trainhub-file-${cid}-${i}`)));
    expect(morceauxCloud.map((m) => [m.i, m.n])).toEqual([[0, 3], [1, 3], [2, 3]]);
    const octets = morceauxCloud.map((m) => Buffer.from(m.bytes, 'base64'));
    expect(octets.map((o) => o.length)).toEqual([800 * 1024, 800 * 1024, 1_700_000 - 2 * 800 * 1024]);
    expect(Buffer.concat(octets).equals(gros.buffer)).toBe(true);

    // Second appareil : le fichier est dans la fiche, absent de l'appareil ; un clic le télécharge du compte et l'ouvre, octet pour octet.
    const b = await ouvrirAppareil();
    await connecter(b, email);
    await ouvrirTechnique(b);
    const fb = fiche(b, 'Gamme');
    await ouvrirOnglet(fb, 'Liens et fichiers');
    await expect(boutonFichier(fb, 'recueil.pdf')).toBeVisible({ timeout: 20_000 });
    expect(await octetsDuPdfOuvert(b, () => boutonFichier(fb, 'recueil.pdf').click())).toEqual(gros.buffer);
  });

  test('fichier déjà dans le compte (3 morceaux posés dans l\'émulateur) : l\'appareil qui se connecte le recompose et l\'ouvre, sur tous les navigateurs @critique', async ({ ouvrirAppli }, testInfo) => {
    const { page, uid } = await appareilConnecteVide(ouvrirAppli, testInfo.project.name, 'e2e-fichier-lecture');
    const gros = grosFichier('recueil.pdf', 1_700_000);
    const parts = morceaux(gros.buffer);
    await Promise.all(parts.map((m, i) => poserDocument(uid, `trainhub-file-fich-seme-${i}`, { i, n: parts.length, bytes: { octets: m.toString('base64') }, updatedAt: Date.now() })));
    const etat: any = etatFiche([{ titre: 'Gamme', extra: { files: [{ id: 'fich-seme', name: 'recueil.pdf', type: 'application/pdf', size: gros.buffer.length, addedAt: Date.now(), cloud: true, chunks: parts.length }] } }]);
    await poserDocument(uid, 'trainhub', { ...etat, updatedAt: Date.now() + 120_000 });

    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await ouvrirOnglet(f, 'Liens et fichiers');
    await expect(boutonFichier(f, 'recueil.pdf')).toBeVisible({ timeout: 20_000 });
    expect(await octetsDuPdfOuvert(page, () => boutonFichier(f, 'recueil.pdf').click())).toEqual(gros.buffer);
  });

  test('retirer une capture ou un fichier supprime leurs documents dans Firestore @critique', async ({ ouvrirAppli, browserName }, testInfo) => {
    sansBlobIndexedDB(test, browserName);
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']) });
    const uid = await connecter(page, adresse(testInfo.project.name, 'e2e-retrait'));
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    await ajouterFichiers(page, f, png('rouge.png'));
    await ajouterFichier(page, f, pdf('partition.pdf'));
    await expect.poll(async () => { const e = await exo(page, 'Gamme'); return [e.images?.[0]?.cloud, e.files?.[0]?.cloud]; }, { timeout: 30_000 }).toEqual([true, true]);
    await expect.poll(async () => (await documents(uid)).length).toBe(3);

    // Retirer le fichier.
    await ouvrirOnglet(f, 'Liens et fichiers');
    await f.getByTitle(/^(Retirer|Supprimer) ce fichier/).click();
    await page.getByRole('dialog', { name: 'Retirer « partition.pdf » ?' }).getByRole('button', { name: 'Retirer', exact: true }).click();
    await expect.poll(async () => (await documents(uid)).filter((d) => d.startsWith('trainhub-file-')), { message: 'les morceaux du fichier sont supprimés' }).toEqual([]);
    expect((await documents(uid)).filter((d) => d.startsWith('trainhub-img-'))).toHaveLength(1);

    // Retirer la capture.
    await ouvrirOnglet(f, 'Images');
    await vignettes(f).first().getByRole('button', { name: '✕' }).click();
    await page.getByRole('dialog', { name: 'Retirer cette image ?' }).getByRole('button', { name: 'Retirer', exact: true }).click();
    await expect.poll(async () => (await documents(uid)).filter((d) => d.startsWith('trainhub-img-')), { message: 'le document de la capture est supprimé' }).toEqual([]);
    await attendreSynchro(page);
    expect(await documents(uid)).toEqual(['trainhub']);
  });

  test('capture et fichier ajoutés HORS connexion : rien dans Firestore tant qu\'on n\'est pas connecté, puis tout part à la connexion @critique', async ({ ouvrirAppli, browserName }, testInfo) => {
    sansBlobIndexedDB(test, browserName);
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']) });
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    const rouge = png('rouge.png'), partition = pdf('partition.pdf');
    await ajouterFichiers(page, f, rouge);
    await ajouterFichier(page, f, partition);
    await expect(f.getByTitle('Fichier stocké seulement sur cet appareil (non synchronisé)')).toBeVisible();
    expect((await exo(page, 'Gamme')).files[0].cloud).toBeFalsy();

    const uid = await connecter(page, adresse(testInfo.project.name, 'e2e-hors-connexion-pj'));
    await expect.poll(async () => { const e = await exo(page, 'Gamme'); return [e.images?.[0]?.cloud, e.files?.[0]?.cloud]; }, { timeout: 30_000 }).toEqual([true, true]);
    const e = await exo(page, 'Gamme');
    const cid = e.files[0].cid || e.files[0].id;
    expect(await documents(uid)).toEqual(['trainhub', `trainhub-file-${cid}-0`, `trainhub-img-${e.images[0].id}`].sort());
    expect(decoderImage((await document(uid, `trainhub-img-${e.images[0].id}`)).data).equals(rouge.buffer)).toBe(true);
    expect(Buffer.from((await document(uid, `trainhub-file-${cid}-0`)).bytes, 'base64').equals(partition.buffer)).toBe(true);
  });

  test('un fichier de plus de 30 Mo n\'est pas envoyé : message « gardé sur cet appareil seulement », rien dans Firestore', async ({ ouvrirAppli, browserName }, testInfo) => {
    sansBlobIndexedDB(test, browserName);
    const page = await ouvrirAppli({ etat: etatFiche(['Gamme']) });
    const uid = await connecter(page, adresse(testInfo.project.name, 'e2e-trop-gros'));
    await ouvrirTechnique(page);
    const f = fiche(page, 'Gamme');
    const enorme: FichierFabrique = { name: 'enregistrement.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(31 * 1024 * 1024)]) };
    await ajouterFichier(page, f, enorme);
    await expect(toast(page, /dépasse 30 Mo : gardé sur cet appareil seulement\./)).toBeVisible({ timeout: 30_000 });
    expect((await exo(page, 'Gamme')).files[0].cloud).toBeFalsy();
    await attendreSynchro(page);
    expect(await documents(uid)).toEqual(['trainhub']);
  });
});
