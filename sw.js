const CACHE_NAME = "trainhub-v162";
const ASSETS = [
    "./",
    "index.html",
    "style.css",
    "script.js",
    "firebase-config.js",
    "jspdf.umd.min.js",
    "manifest.json",
    "icons/favicon.svg",
    "icons/icon-192.png",
    "icons/icon-512.png"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
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
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
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
