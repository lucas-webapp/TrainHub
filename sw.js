const CACHE_NAME = "trainhub-v198";
// Piano du lecteur d'harmonie (17 échantillons, ~1,2 Mo) : un cache à part, gardé d'une version à l'autre (il ne change pas).
const PIANO_CACHE = "trainhub-piano-v1";
const PIANO = ["C2", "Ds2", "Fs2", "A2", "C3", "Ds3", "Fs3", "A3", "C4", "Ds4", "Fs4", "A4", "C5", "Ds5", "Fs5", "A5", "C6"].map((n) => "audio/piano/" + n + ".mp3");
const ASSETS = [
    "./",
    "index.html",
    "style.css",
    "script.js",
    "firebase-config.js",
    "jspdf.umd.min.js",
    "lamejs.iife.js",
    "manifest.json",
    "icons/favicon.svg",
    "icons/icon-192.png",
    "icons/icon-512.png"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        Promise.all([
            caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)),
            // hors ligne dès la première visite ; un échec ici ne bloque pas l'installation (le lecteur a une doublure synthétisée)
            caches.open(PIANO_CACHE).then((cache) => cache.addAll(PIANO)).catch(() => {})
        ])
    );
    // Sans ceci, une nouvelle version installée reste "en attente" et ne prend le contrôle qu'au
    // prochain lancement complet de l'app (onglet fermé puis rouvert) — sur iPhone/Safari en
    // particulier, ça donnait l'impression que les mises à jour n'arrivaient jamais tant qu'on
    // se contentait de recharger la page. skipWaiting() force la nouvelle version à s'activer
    // tout de suite.
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== PIANO_CACHE).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim()) // prend le contrôle des onglets déjà ouverts immédiatement
    );
});

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;
    // Requêtes vers d'autres sites (API du lecteur YouTube…) : le navigateur s'en charge seul.
    if (new URL(event.request.url).origin !== self.location.origin) return;
    event.respondWith(
        caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
});
