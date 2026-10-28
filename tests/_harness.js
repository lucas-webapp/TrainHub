// Harnais commun des bancs. Trois services, dont un seul est vraiment nouveau.
//
// LE PROBLÈME QU'IL RÉSOUT. Jusqu'ici chaque banc comptait ses PASS/FAIL localement :
//     let PASS = 0, FAIL = 0;
//     const check = (c, l) => { ... };
// Ce compteur mesure ce qui S'EST EXÉCUTÉ, jamais ce qui AURAIT DÛ l'être. Un banc qui perd la
// moitié de ses vérifications affiche donc « 12 PASS / 0 FAIL » et paraît en MEILLEURE santé qu'avant.
// C'est arrivé pour de vrai : avant_seq_short_note_body_test annonçait éprouver trois vues du
// séquenceur, en cherchait une à une adresse disparue (#grid-zoom-pinned-body, l'hôte de la vue plein
// écran retirée depuis), et sautait tout le bloc par un `if (epingle) { ... }` — silencieusement. Une
// vue entière n'était plus testée, et rien ne le disait. En la rebranchant, un vrai défaut
// d'application est apparu aussitôt (bande morte de 4px entre les cases, voir docs/dette-tests.md).
// Un banc qui renonce en silence est pire qu'un banc rouge : il compte comme une couverture qu'on n'a
// pas.
//
// LA PARADE : `plan(n)`. Le banc déclare combien de vérifications il doit exécuter au minimum ; si la
// campagne s'arrête avant, le harnais le signale de lui-même. C'est le mécanisme `plan` de TAP,
// éprouvé depuis trente ans. Il ne change AUCUNE assertion existante : on l'ajoute, et les
// disparitions deviennent bruyantes.
//
// POURQUOI UN PLANCHER ET NON UN COMPTE EXACT. Certains bancs font légitimement varier leur nombre de
// vérifications selon la géométrie MESURÉE (une note assez large reçoit trois zones, une note étroite
// deux : voir avant_seq_short_note_body_test). Exiger un compte exact y produirait de faux échecs à
// chaque changement de largeur de case. Un plancher attrape ce qui compte vraiment — « il en manque
// vingt » — sans punir cette variabilité voulue.

function creerHarnais(nomDuBanc = '') {
    let PASS = 0, FAIL = 0;
    let attendu = null;          // plancher déclaré par plan()
    let exigenceRompue = null;   // libellé de la première exigence non tenue
    let bilanFait = false;

    const check = (cond, libelle) => {
        if (cond) { PASS++; console.log('PASS - ' + libelle); }
        else { FAIL++; console.log('FAIL - ' + libelle); }
        return !!cond;
    };

    // Précondition dont dépend la SUITE du banc (« la vue est bien ouverte », « la case est
    // atteignable »). Se compte comme une vérification normale — donc visible en rouge si elle tombe —
    // mais retient en plus que tout ce qui suit a probablement été sauté, pour que le bilan le dise au
    // lieu de laisser croire à une campagne complète. À utiliser partout où l'on écrivait
    // `if (condition) { ...vérifications... }`.
    const exiger = (cond, libelle) => {
        const ok = check(cond, libelle);
        if (!ok && exigenceRompue === null) exigenceRompue = libelle;
        return ok;
    };

    // Nombre MINIMUM de vérifications que ce banc doit exécuter. À placer en tête.
    const plan = (n) => { attendu = n; };

    const rendreCompte = () => {
        if (bilanFait) return FAIL;
        bilanFait = true;
        const total = PASS + FAIL;
        if (attendu !== null && total < attendu) {
            FAIL++;
            console.log(`FAIL - COUVERTURE INCOMPLÈTE : ${attendu} vérification(s) attendue(s) au minimum, ${total} exécutée(s)`
                + (exigenceRompue ? ` — première exigence non tenue : « ${exigenceRompue} »` : '')
                + ' — le banc s\'est arrêté en route, ses PASS ne valent que pour ce qu\'il a eu le temps de faire.');
        } else if (exigenceRompue) {
            console.log(`  (note : l'exigence « ${exigenceRompue} » n'a pas été tenue — des vérifications ont pu être sautées)`);
        }
        console.log(`\n=== ${nomDuBanc ? nomDuBanc + ' : ' : ''}${PASS} PASS / ${FAIL} FAIL ===`);
        return FAIL;
    };

    // Bilan explicite en fin de banc.
    const bilan = () => { const f = rendreCompte(); process.exit(f ? 1 : 0); };

    // FILET DE SÉCURITÉ : un banc qui MEURT en route (exception non rattrapée, timeout Playwright)
    // n'atteint jamais son bilan. Sans ça, il laisse derrière lui une liste de PASS et un code de
    // sortie, sans jamais dire qu'il n'est pas allé au bout. On rend donc compte aussi à la sortie du
    // processus, quelle qu'en soit la cause.
    process.on('exit', () => {
        if (bilanFait) return;
        if (rendreCompte() && !process.exitCode) process.exitCode = 1;
    });

    return { check, exiger, plan, bilan };
}

module.exports = creerHarnais;

// LE BRUIT DU BAC À SABLE, EN UN SEUL ENDROIT.
// Le conteneur de test passe par un mandataire qui intercepte le TLS : la feuille de style Google
// Fonts et les échantillons de piano de Tone.js n'aboutissent jamais. Ces échecs n'ont rien à voir
// avec l'appli, mais ils remplissent la console et font échouer le contrôle « aucune erreur
// JavaScript » de dizaines de bancs.
// LE PIÈGE MESURÉ LE 17/09 : le message console de Chrome est « Failed to load resource:
// net::ERR_CERT_AUTHORITY_INVALID », SANS l'URL. Les filtres écrits sur `fonts.googleapis` ne
// pouvaient donc rien reconnaître — il faut filtrer sur le NOM DE L'ERREUR. Le jour où le mandataire
// a changé de mode d'échec, vingt-cinq bancs sont passés au rouge d'un coup sans qu'une ligne de
// l'appli ait bougé.
// Ce motif est aujourd'hui recopié dans une soixantaine de bancs (dette notée dans dette-tests.md) ;
// les nouveaux bancs passent par ici.
const BRUIT_RESEAU = /ERR_CONNECTION_RESET|ERR_TUNNEL_CONNECTION_FAILED|ERR_CERT_AUTHORITY_INVALID|ERR_NAME_NOT_RESOLVED|ERR_PROXY_CONNECTION_FAILED|fonts\.googleapis|fonts\.gstatic|tonejs\.github\.io/;
const estBruitReseau = (texte) => BRUIT_RESEAU.test(String(texte || ''));
module.exports.BRUIT_RESEAU = BRUIT_RESEAU;
module.exports.estBruitReseau = estBruitReseau;
