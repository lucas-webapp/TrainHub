#!/usr/bin/env node
// SERVEUR DE L'APPLI EN MODE TEST (tests @playwright/test ET exploration avec playwright-cli). Repris d'HarmoHub, adapté à TrainHub.
// Sert le dépôt tel quel, avec DEUX substitutions faites EN MÉMOIRE (jamais écrites dans le dépôt : l'appli publiée n'est pas modifiée) :
//   1. TrainHub charge le SDK Firebase compat depuis www.gstatic.com (bloqué dans la VM cloud) PAR script.js (adresse écrite en dur dans
//      loadFirebaseThenInit), et non par index.html comme HarmoHub : cette adresse est remplacée, dans script.js seulement, par /__e2e__/firebase/,
//      qui sert les fichiers de node_modules/firebase — la MÊME version (refus si elle diffère) ;
//   2. firebase-config.js (configuration de PRODUCTION) est remplacé par une configuration « demo-… » qui branche les émulateurs Auth et Firestore.
//      TrainHub charge ce fichier APRÈS le SDK : l'enveloppe de firebase.initializeApp est donc posée avant l'appel, comme dans HarmoHub.
// Toute autre ressource est servie à l'identique (aussi sur le port suivant : origine du faux lecteur YouTube). Refuse de démarrer si le projet n'est pas un projet « demo-… ».
const http = require('http');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT_APPLI || 8937);
const PROJET = process.env.GCLOUD_PROJECT || process.env.PROJET_TEST || 'demo-trainhub';
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8180';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9199';
const VERSION_SDK = require(path.join(RACINE, 'node_modules', 'firebase', 'package.json')).version;
const SLUG = process.env.SLUG_APPLI || 'trainhub';

if (!/^demo-[a-z0-9-]+$/.test(PROJET)) { console.error(`GARDE-FOU : projet « ${PROJET} » refusé (seuls les projets « demo-… » sont permis).`); process.exit(1); }
for (const [nom, hote] of [['Firestore', FIRESTORE], ['Auth', AUTH]]) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(hote)) { console.error(`GARDE-FOU : l'émulateur ${nom} doit être local (reçu « ${hote} »).`); process.exit(1); }
}

function configDeTest() {
  const [hf, pf] = FIRESTORE.split(':');
  return `// CONFIGURATION DE TEST (scripts/serveur-test.cjs) — projet « ${PROJET} », émulateurs locaux. Jamais servie en production.
var FIREBASE_CONFIG = { apiKey: 'demo-cle-de-test', authDomain: '${PROJET}.firebaseapp.com', projectId: '${PROJET}', storageBucket: '', messagingSenderId: '0', appId: '1:0:web:0' };
var FIREBASE_APP_SLUG = '${SLUG}';
window.__EMULATEURS_BRANCHES = false;
(function () {
  if (typeof firebase === 'undefined') return;
  var initialiser = firebase.initializeApp.bind(firebase);
  firebase.initializeApp = function (config, nom) {
    if (!config || !/^demo-/.test(config.projectId)) throw new Error('GARDE-FOU : initializeApp hors projet demo- refusé');
    var app = initialiser(config, nom);
    app.auth().useEmulator('http://${AUTH}', { disableWarnings: true });
    app.firestore().useEmulator('${hf}', ${pf});
    window.__EMULATEURS_BRANCHES = true;
    return app;
  };
})();
`;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const SDK = /https:\/\/www\.gstatic\.com\/firebasejs\/([\d.]+)\//g;

let scriptCache = { mtime: 0, corps: '' };
function scriptDeTest(p) {
  const mtime = fs.statSync(p).mtimeMs;
  if (mtime !== scriptCache.mtime) {
    let n = 0;
    const corps = fs.readFileSync(p, 'utf8').replace(SDK, (tout, version) => {
      if (version !== VERSION_SDK) throw new Error(`script.js charge le SDK Firebase ${version}, node_modules a ${VERSION_SDK} : mettre package.json à jour`);
      n++;
      return '/__e2e__/firebase/';
    });
    if (n !== 1) throw new Error(`script.js : adresse du SDK Firebase trouvée ${n} fois (attendu : 1) — adapter scripts/serveur-test.cjs`);
    scriptCache = { mtime, corps };
  }
  return scriptCache.corps;
}

function servir(req, res) {
  const envoyer = (code, type, corps) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(corps); };
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let chemin = decodeURIComponent(url.pathname);
    if (chemin === '/firebase-config.js') return envoyer(200, TYPES['.js'], configDeTest());
    if (chemin.startsWith('/__e2e__/firebase/')) {
      const fichier = path.basename(chemin);
      const p = path.join(RACINE, 'node_modules', 'firebase', fichier);
      if (!/^firebase-[a-z-]+\.js$/.test(fichier) || !fs.existsSync(p)) return envoyer(404, 'text/plain', 'SDK introuvable');
      return envoyer(200, TYPES['.js'], fs.readFileSync(p));
    }
    if (chemin.endsWith('/')) chemin += 'index.html';
    const p = path.join(RACINE, chemin);
    if (!p.startsWith(RACINE + path.sep) || /[\\/](node_modules|\.git)([\\/]|$)/.test(p) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return envoyer(404, 'text/plain', 'Introuvable');
    if (p === path.join(RACINE, 'script.js')) return envoyer(200, TYPES['.js'], scriptDeTest(p));
    return envoyer(200, TYPES[path.extname(p)] || 'application/octet-stream', fs.readFileSync(p));
  } catch (e) {
    console.error(e.message);
    return envoyer(500, 'text/plain; charset=utf-8', e.message);
  }
}
http.createServer(servir).listen(PORT, '127.0.0.1', () => console.log(`Appli en mode test : http://127.0.0.1:${PORT}/index.html (projet ${PROJET}, Firestore ${FIRESTORE}, Auth ${AUTH})`));
// Le faux lecteur YouTube des bancs (tests/playwright/yt_mock/embed.html) doit être d'une AUTRE ORIGINE que l'appli, comme le vrai : même
// dossier, servi aussi sur le port suivant (la fixture des tests y renvoie l'API YouTube factice).
http.createServer(servir).listen(PORT + 1, '127.0.0.1');
