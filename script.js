(function () {
    "use strict";

    var STORAGE_KEY = "trainhub.v1";
    var DEFAULT_CATEGORIES = ["Technique", "Gammes", "Improvisation", "Jeu en groupe", "Copie de morceaux"];
    var DEFAULT_INSTRUMENTS = ["Basse", "Guitare", "Piano"];
    // Jeux de couleurs des chapitres, choisis dans les paramètres généraux (voir
    // openSettingsPanel) : currentPalette() renvoie toujours le jeu actif, à utiliser à la place
    // d'une constante fixe partout où une nouvelle couleur de chapitre est choisie.
    var COLOR_SCHEMES = {
        default: { label: "Défaut", colors: ["#00e676", "#a78bfa", "#f472b6", "#2dd4bf", "#fb923c", "#f87171"] },
        flashy: { label: "Flashy", colors: ["#ff2e63", "#08d9d6", "#f8b400", "#ea00ff", "#00ff87", "#ff6f00"] },
        sobre: { label: "Sobre", colors: ["#8892b0", "#6b8f71", "#a67c52", "#7c93a3", "#9d8189", "#7d7d7d"] },
        pastel: { label: "Pastel", colors: ["#a3c4f3", "#ffcfd2", "#b9fbc0", "#fde4cf", "#d0bdf4", "#98f5e1"] },
        contraste: { label: "Contrasté", colors: ["#ffffff", "#ffeb3b", "#00e5ff", "#ff1744", "#76ff03", "#d500f9"] }
    };
    // Variante sans dépendre de la variable globale `state` (encore non affectée lors de
    // normalizeState/makeDefaultState, qui construisent justement cet objet) : on lui passe
    // directement les `settings` en cours de normalisation.
    function paletteFor(settings) {
        var scheme = COLOR_SCHEMES[settings.appearance && settings.appearance.colorScheme];
        return (scheme || COLOR_SCHEMES.default).colors;
    }
    function currentPalette() {
        return paletteFor(state.settings);
    }
    // Change le jeu de couleurs ET recolore les chapitres existants (sinon le réglage ne
    // s'appliquerait qu'aux nouveaux chapitres créés après coup, pas à ceux déjà là).
    function applyColorScheme(key) {
        if (!COLOR_SCHEMES[key]) return;
        state.settings.appearance.colorScheme = key;
        var palette = COLOR_SCHEMES[key].colors;
        state.instruments.forEach(function (inst) {
            inst.categories.forEach(function (cat, i) { cat.color = palette[i % palette.length]; });
        });
        save();
        render();
    }
    var MAX_FOLDER_DEPTH = 5;
    // Chapitres virtuels : n'existent dans aucun tableau `categories`, juste des valeurs spéciales
    // de navigation reconnues par render()/renderMain(). Regroupent respectivement les exercices
    // marqués favoris et les exercices archivés de TOUT l'instrument, où qu'ils soient rangés.
    var FAVORITES_ID = "__favorites__";
    var ARCHIVED_ID = "__archived__";

    var searchQuery = "";
    var navPaths = {}; // instrumentId -> [folderId, ...] depuis le grand chapitre (non synchronisé, juste la navigation en cours)
    var treeExpanded = {}; // folderId -> bool, replié/déplié dans l'arborescence latérale (non synchronisé, déplié par défaut)

    function uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    // ---------- notification discrète (toast) ----------
    // Pour les cas où une action a un effet secondaire pas forcément évident (ex. dupliquer un
    // exercice archivé/favori ne reprend pas ce statut — la copie "disparaît" donc de la vue
    // Archivés/Favoris sans qu'on comprenne pourquoi au premier abord).
    var activeToastEl = null, activeToastTimer = null;
    function showToast(message, durationMs) {
        if (activeToastEl) { activeToastEl.remove(); clearTimeout(activeToastTimer); }
        var toast = document.createElement("div");
        toast.className = "toast";
        toast.textContent = message;
        document.body.appendChild(toast);
        activeToastEl = toast;
        activeToastTimer = setTimeout(function () {
            toast.remove();
            if (activeToastEl === toast) activeToastEl = null;
        }, durationMs || 3200);
    }

    function makeFolder(name, color) {
        var f = { id: uid(), name: name, folders: [], exercises: [] };
        if (color) f.color = color;
        return f;
    }

    // `withDefaultFolders` : chapitres pré-remplis (Technique, Gammes…). Seul l'espace « Basse » de départ
    // en reçoit ; les autres espaces (Guitare, Piano, et tout espace créé ensuite) démarrent vides.
    function makeInstrument(name, palette, withDefaultFolders) {
        var pal = palette || COLOR_SCHEMES.default.colors;
        var categories = withDefaultFolders ? DEFAULT_CATEGORIES.map(function (catName, i) {
            return makeFolder(catName, pal[i % pal.length]);
        }) : [];
        return { id: uid(), name: name, categories: categories };
    }

    function makeDefaultState() {
        var instruments = DEFAULT_INSTRUMENTS.map(function (name, i) { return makeInstrument(name, null, i === 0); });
        return { activeInstrumentId: instruments[0].id, instruments: instruments, updatedAt: 0, settings: {} };
    }

    function normalizeFolder(f) {
        if (!Array.isArray(f.folders)) f.folders = [];
        if (!Array.isArray(f.exercises)) f.exercises = [];
        f.folders.forEach(normalizeFolder);
        f.exercises.forEach(function (ex) {
            if (!Array.isArray(ex.links)) ex.links = [];
            // Chaque lien a un identifiant stable (les liens créés avant cette version en sont
            // dépourvus, on le complète ici) : nécessaire pour distinguer "le lien mis en avant"
            // (ex.pinnedLinkId) du reste, indépendamment de son libellé ou de son URL.
            ex.links.forEach(function (link) { if (!link.id) link.id = uid(); });
            if (ex.pinnedLinkId && !ex.links.some(function (l) { return l.id === ex.pinnedLinkId; })) ex.pinnedLinkId = null;
            // Fichiers (PDF/MP3) joints à l'exercice : seules les métadonnées sont stockées dans
            // l'état (donc synchronisées) — le contenu réel du fichier vit dans IndexedDB, sur cet
            // appareil uniquement (voir bloc "fichiers joints" plus bas).
            if (!Array.isArray(ex.files)) ex.files = [];
            // Images (captures de partition…) : métadonnées ici, contenu dans IndexedDB comme les fichiers.
            if (!Array.isArray(ex.images)) ex.images = [];
            // Métronome prédéfini de l'exercice (réglage complet, voir snapshotMetronome) ou absent.
            if (!ex.metronome || typeof ex.metronome !== "object") ex.metronome = null;
            // Archives de notes datées : [{ d: "AAAA-MM-JJ", t: "ligne" }] ; noteDates : date de chaque ligne de ex.notes.
            if (!Array.isArray(ex.notesArchive)) ex.notesArchive = [];
            ex.notesArchive = ex.notesArchive.filter(function (e) { return e && typeof e.t === "string"; });
            if (!Array.isArray(ex.noteDates)) ex.noteDates = [];
            // Remplace les statuts (à faire/en cours/terminé/à revoir), jugés trop compliqués au
            // quotidien : juste deux cases à cocher, accessibles par clic droit/appui long.
            if (typeof ex.favorite !== "boolean") ex.favorite = false;
            if (typeof ex.archived !== "boolean") ex.archived = false;
            delete ex.tags; // les étiquettes ont été retirées de l'application
        });
    }

    // Ordre d'affichage des chapitres (bandeau mobile + arborescence), synchronisé : mélange les
    // vrais chapitres et les chapitres virtuels (Favoris, Archivés), tous glissables ensemble. Par
    // défaut (ou pour un instrument créé avant cette version), les virtuels sont en tête et les
    // vrais chapitres suivent dans leur ordre existant — rien ne bouge visuellement.
    function normalizePinnedOrder(inst) {
        var validIds = [FAVORITES_ID, ARCHIVED_ID].concat(inst.categories.map(function (c) { return c.id; }));
        var order = Array.isArray(inst.pinnedOrder) ? inst.pinnedOrder.filter(function (id) { return validIds.indexOf(id) !== -1; }) : [];
        validIds.forEach(function (id) { if (order.indexOf(id) === -1) order.push(id); });
        inst.pinnedOrder = order;
    }

    var METRO_POSITIONS = ["center", "top", "bottom", "corner"];
    var MAIN_LAYOUTS = ["vertical", "horizontal"];
    var DENSITIES = ["compact", "comfortable", "spacious"];
    var METRO_SIZES = ["small", "medium", "large"];
    var TREE_FONT_SCALES = [0.85, 1, 1.15, 1.3];

    function normalizeAppearanceSettings(s) {
        if (!s.settings.appearance || typeof s.settings.appearance !== "object") s.settings.appearance = {};
        var a = s.settings.appearance;
        if (!COLOR_SCHEMES[a.colorScheme]) a.colorScheme = "default";
        if (METRO_POSITIONS.indexOf(a.metronomePosition) === -1) a.metronomePosition = "center";
        if (METRO_SIZES.indexOf(a.metronomeSize) === -1) a.metronomeSize = "medium";
        if (TREE_FONT_SCALES.indexOf(a.treeFontScale) === -1) a.treeFontScale = 1;
        if (MAIN_LAYOUTS.indexOf(a.mainLayout) === -1) a.mainLayout = "vertical";
        if (DENSITIES.indexOf(a.density) === -1) a.density = "comfortable";
    }

    // Une session guidée = un enchaînement d'exercices avec un temps alloué à chacun. Les pas
    // référencent l'exercice par son id (unique dans toute l'appli, voir uid()) plutôt que de
    // dupliquer son contenu : si l'exercice est supprimé depuis, le pas devient "introuvable"
    // (voir findExerciseById) et s'affiche/se saute proprement au lieu de planter.
    function normalizeGuidedSessions(s) {
        if (!Array.isArray(s.settings.guidedSessions)) s.settings.guidedSessions = [];
        // Dossiers de sessions (facultatifs, propres à chaque espace) : [{ id, name, instrumentId, collapsed }].
        // Aucun dossier au départ ; une session sans dossier valide reste simplement à la racine.
        if (!Array.isArray(s.settings.sessionFolders)) s.settings.sessionFolders = [];
        s.settings.sessionFolders = s.settings.sessionFolders.filter(function (f) { return f && typeof f === "object" && typeof f.name === "string"; });
        s.settings.sessionFolders.forEach(function (f) { if (!f.id) f.id = uid(); f.collapsed = f.collapsed === true; });
        s.settings.guidedSessions.forEach(function (gs) {
            // Onglets : une session peut figurer dans plusieurs onglets (l'ancien « dossier » devient un onglet).
            if (!Array.isArray(gs.tabIds)) gs.tabIds = [];
            if (gs.folderId) { if (gs.tabIds.indexOf(gs.folderId) === -1) gs.tabIds.push(gs.folderId); delete gs.folderId; }
            gs.tabIds = gs.tabIds.filter(function (id, i, arr) { return arr.indexOf(id) === i && s.settings.sessionFolders.some(function (f) { return f.id === id; }); });
            if (!gs.id) gs.id = uid();
            if (typeof gs.name !== "string" || !gs.name.trim()) gs.name = "Session guidée";
            if (!Array.isArray(gs.steps)) gs.steps = [];
            gs.steps.forEach(function (step) {
                if (!step.id) step.id = uid();
                if (typeof step.minutes !== "number" || isNaN(step.minutes) || step.minutes <= 0) step.minutes = 5;
                // Note propre à ce pas de la session (ex. "tempo progressif depuis 80 bpm") et liste des
                // liens/fichiers de l'exercice à NE PAS montrer pendant cette session (clés "link:<id>"/"file:<id>").
                if (typeof step.note !== "string") step.note = "";
                if (!Array.isArray(step.hidden)) step.hidden = [];
            });
        });
    }

    // Corbeille : garde un exercice/dossier/session supprimé assez longtemps pour être restauré par
    // erreur, en plus de l'annuler/rétablir (qui, lui, revient en arrière pas à pas et peut être
    // écrasé par des actions suivantes). Les fichiers joints ne sont réellement effacés
    // d'IndexedDB qu'à la suppression définitive (purge manuelle ou éviction au-delà de la limite).
    var TRASH_LIMIT = 50;

    function normalizeTrash(s) {
        if (!Array.isArray(s.settings.trash)) s.settings.trash = [];
    }

    function normalizeState(s) {
        if (!s.settings || typeof s.settings !== "object") s.settings = {};
        normalizeMetronomeSettings(s.settings);
        normalizeGuidedSessions(s);
        normalizeTrash(s);
        normalizeAppearanceSettings(s);
        if (!Array.isArray(s.instruments)) s.instruments = [];
        // Une fois : les espaces autres que « Basse » n'ont plus de dossiers pré-remplis. On ne retire que
        // les chapitres au nom d'origine encore VIDES (ni exercice ni sous-dossier) : rien de ce que
        // l'utilisateur a rempli ne disparaît.
        if (!s.settings.emptyDefaultFoldersPruned) {
            s.settings.emptyDefaultFoldersPruned = true;
            var keepInst = s.instruments.filter(function (i) { return (i.name || "").trim().toLowerCase() === "basse"; })[0] || s.instruments[0];
            s.instruments.forEach(function (inst) {
                if (inst === keepInst || !Array.isArray(inst.categories)) return;
                inst.categories = inst.categories.filter(function (cat) {
                    var isEmpty = (!cat.folders || !cat.folders.length) && (!cat.exercises || !cat.exercises.length);
                    return !(isEmpty && DEFAULT_CATEGORIES.indexOf(cat.name) !== -1);
                });
            });
        }
        s.instruments.forEach(function (inst) {
            if (!Array.isArray(inst.categories)) inst.categories = [];
            // La couleur se pose sur les grands chapitres (repérage des dossiers/sous-dossiers),
            // pas sur l'instrument : les 3 instruments partagent la même identité visuelle.
            inst.categories.forEach(function (cat, i) {
                if (!cat.color) cat.color = paletteFor(s.settings)[i % paletteFor(s.settings).length];
            });
            inst.categories.forEach(normalizeFolder);
            normalizePinnedOrder(inst);
        });
        assignSessionInstruments(s);
        return s;
    }

    // ---------- sessions propres à chaque espace ----------
    // Chaque session appartient à un espace (gs.instrumentId) et ne s'affiche que dans celui-ci. Les
    // sessions créées avant cette règle sont rattachées à l'espace qui contient le plus de leurs
    // exercices (à défaut, au premier espace).
    function assignSessionInstruments(s) {
        if (!s.instruments.length) return;
        var ids = {};
        s.instruments.forEach(function (inst) { ids[inst.id] = true; });
        function exerciseIds(folders, out) {
            (folders || []).forEach(function (f) {
                (f.exercises || []).forEach(function (ex) { out[ex.id] = true; });
                exerciseIds(f.folders, out);
            });
            return out;
        }
        var perInstrument = s.instruments.map(function (inst) { return { id: inst.id, ex: exerciseIds(inst.categories, {}) }; });
        s.settings.guidedSessions.forEach(function (gs) {
            if (gs.instrumentId && ids[gs.instrumentId]) return;
            var best = s.instruments[0].id, bestCount = 0;
            perInstrument.forEach(function (p) {
                var n = gs.steps.filter(function (step) { return p.ex[step.exerciseId]; }).length;
                if (n > bestCount) { best = p.id; bestCount = n; }
            });
            gs.instrumentId = best;
        });
    }

    var state = normalizeState(load() || makeDefaultState());

    function load() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            if (!parsed || !Array.isArray(parsed.instruments)) return null;
            return parsed;
        } catch (e) {
            return null;
        }
    }

    function saveLocal() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.error("Sauvegarde locale impossible", e);
        }
    }

    function persist() {
        state.updatedAt = Date.now();
        saveLocal();
        scheduleCloudPush();
    }

    function save() {
        persist();
        pushHistory();
    }

    // ---------- annuler / rétablir ----------
    // Historique de piles d'états complets (JSON), propre à cet appareil — chaque `save()` y ajoute
    // un instantané. Annuler/rétablir déplacent juste le curseur et republient l'état obtenu
    // (persist(), sans repasser par pushHistory sinon on écraserait le futur qu'on vient de
    // récupérer). Un remplacement complet de l'état (synchro distante, import JSON) redémarre
    // l'historique : les versions d'avant/après ne se comparent plus à ce qui vient d'arriver.
    // (Le branchement des boutons et le premier instantané sont plus bas, une fois les éléments
    // du DOM en main — voir "rendering".)
    var HISTORY_LIMIT = 200;
    var historyStack = [];
    var historyIndex = -1;

    function resetHistory() {
        historyStack = [JSON.stringify(state)];
        historyIndex = 0;
        updateUndoRedoButtons();
    }

    function pushHistory() {
        historyStack = historyStack.slice(0, historyIndex + 1);
        historyStack.push(JSON.stringify(state));
        if (historyStack.length > HISTORY_LIMIT) historyStack.shift();
        historyIndex = historyStack.length - 1;
        updateUndoRedoButtons();
    }

    function updateUndoRedoButtons() {
        if ($undoBtn) $undoBtn.disabled = historyIndex <= 0;
        if ($redoBtn) $redoBtn.disabled = historyIndex < 0 || historyIndex >= historyStack.length - 1;
    }

    function goToHistory(index) {
        if (index < 0 || index >= historyStack.length) return;
        historyIndex = index;
        state = normalizeState(JSON.parse(historyStack[historyIndex]));
        persist();
        render();
    }

    function undo() { goToHistory(historyIndex - 1); }
    function redo() { goToHistory(historyIndex + 1); }

    // ---------- fichiers joints (PDF/MP3) ----------
    // Le contenu des fichiers (potentiellement plusieurs Mo) vit dans IndexedDB, PAS dans `state` :
    // Firestore refuse les documents de plus de 1 Mo, et on ne veut pas alourdir chaque synchro
    // avec des PDF/MP3. Seules les métadonnées (nom, type, taille) sont sur l'exercice et donc
    // synchronisées ; le fichier réel, lui, ne quitte jamais l'appareil où il a été ajouté.
    var FILES_DB_NAME = "trainhub-files";
    var filesDbPromise = null;

    function openFilesDb() {
        if (filesDbPromise) return filesDbPromise;
        filesDbPromise = new Promise(function (resolve, reject) {
            if (!("indexedDB" in window)) { reject(new Error("IndexedDB indisponible")); return; }
            var req = indexedDB.open(FILES_DB_NAME, 1);
            req.onupgradeneeded = function () {
                if (!req.result.objectStoreNames.contains("files")) req.result.createObjectStore("files");
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
        return filesDbPromise;
    }

    function storeFileBlob(id, blob) {
        return openFilesDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction("files", "readwrite");
                tx.objectStore("files").put(blob, id);
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function getFileBlob(id) {
        return openFilesDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction("files", "readonly");
                var req = tx.objectStore("files").get(id);
                req.onsuccess = function () { resolve(req.result || null); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    function deleteFileBlob(id) {
        return openFilesDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction("files", "readwrite");
                tx.objectStore("files").delete(id);
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
            });
        }).catch(function () {});
    }

    // ---------- images des exercices ----------
    // Captures de partition / passages techniques : affichées en vignettes, en grand au clic. Comme les
    // fichiers joints, seules les métadonnées (ex.images) sont synchronisées ; l'image elle-même reste
    // sur l'appareil où elle a été ajoutée (IndexedDB).
    var IMG_HEIGHTS = { small: 90, medium: 150, large: 240 };
    var IMG_SIZE_KEYS = { ex: "trainhub.imgSize.ex.v1", gs: "trainhub.imgSize.gs.v1" };
    var IMG_SIZE_DEFAULTS = { ex: "medium", gs: "small" };
    function getImgSize(where) {
        try { var v = localStorage.getItem(IMG_SIZE_KEYS[where]); if (IMG_HEIGHTS[v]) return v; } catch (e) {}
        return IMG_SIZE_DEFAULTS[where];
    }
    function setImgSize(where, v) { try { localStorage.setItem(IMG_SIZE_KEYS[where], v); } catch (e) {} }
    var IMG_GS_SHOWN_KEY = "trainhub.imgShownSession.v1";
    function imagesShownInSession() { try { return localStorage.getItem(IMG_GS_SHOWN_KEY) === "1"; } catch (e) { return false; } }
    function setImagesShownInSession(on) { try { localStorage.setItem(IMG_GS_SHOWN_KEY, on ? "1" : "0"); } catch (e) {} }
    var imagesOpenInList = {}; // id d'exercice -> section Images dépliée (masquée de base)
    var imageUrlCache = {};    // id d'image -> adresse blob: (false = absente de cet appareil)

    function loadImageInto(img, meta, onMissing) {
        function apply(url) { if (url) img.src = url; else if (onMissing) onMissing(); }
        if (meta.id in imageUrlCache) { apply(imageUrlCache[meta.id]); return; }
        getFileBlob(meta.id).then(function (blob) {
            if (blob) return blob;
            // Absente de cet appareil : on la récupère dans le cloud si elle y a été envoyée.
            return cloudFetchImage(meta);
        }).then(function (blob) {
            imageUrlCache[meta.id] = blob ? URL.createObjectURL(blob) : false;
            apply(imageUrlCache[meta.id]);
        }, function () { imageUrlCache[meta.id] = false; apply(false); });
    }

    // ---- images dans le cloud (Firestore) ----
    // Chaque image est un petit document à part (users/<uid>/apps/trainhub-img-<id>, contenu en base64) :
    // Firebase Storage demande un abonnement payant, pas Firestore. Une image est réduite pour tenir sous
    // la limite de 1 Mo par document (voir shrinkImageBlob). meta.cloud = true une fois envoyée.
    function cloudImageDoc(id) {
        return db.collection("users").doc(currentUser.uid).collection("apps").doc("trainhub-img-" + id);
    }
    function blobToDataUrl(blob) {
        return new Promise(function (resolve, reject) {
            var r = new FileReader();
            r.onload = function () { resolve(r.result); };
            r.onerror = function () { reject(r.error); };
            r.readAsDataURL(blob);
        });
    }
    function cloudFetchImage(meta) {
        if (!meta.cloud || !db || !currentUser) return Promise.resolve(null);
        return cloudImageDoc(meta.id).get().then(function (snap) {
            if (!snap.exists) return null;
            return fetch(snap.data().data).then(function (r) { return r.blob(); }).then(function (blob) {
                storeFileBlob(meta.id, blob); // en cache local pour la prochaine fois
                return blob;
            });
        }).catch(function (e) { console.warn("Image absente du cloud", e); return null; });
    }
    function cloudUploadImage(meta) {
        if (!db || !currentUser) return Promise.resolve(false);
        return getFileBlob(meta.id).then(function (blob) {
            if (!blob) return false;
            return blobToDataUrl(blob).then(function (dataUrl) {
                return cloudImageDoc(meta.id).set({ data: dataUrl, type: meta.type || blob.type, name: meta.name || "", updatedAt: Date.now() });
            }).then(function () { meta.cloud = true; persist(); return true; });
        }).catch(function (e) { console.warn("Envoi de l'image vers le cloud impossible", e); return false; });
    }
    function cloudDeleteImage(id) {
        if (!db || !currentUser) return;
        cloudImageDoc(id).delete().catch(function () {});
    }
    // Après connexion : envoie les images encore locales (une à la fois) et réessaie celles qui manquaient.
    function syncImagesToCloud() {
        if (!db || !currentUser) return;
        Object.keys(imageUrlCache).forEach(function (k) { if (imageUrlCache[k] === false) delete imageUrlCache[k]; });
        var pending = [];
        (function walk(folders) {
            (folders || []).forEach(function (f) {
                (f.exercises || []).forEach(function (ex) { (ex.images || []).forEach(function (m) { if (!m.cloud) pending.push(m); }); });
                walk(f.folders);
            });
        })([].concat.apply([], state.instruments.map(function (i) { return i.categories || []; })));
        pending.reduce(function (p, m) { return p.then(function () { return cloudUploadImage(m); }); }, Promise.resolve());
    }

    // Réduit une image pour qu'elle tienne dans un document Firestore (≈ 700 Ko) : côté max 1800 px, JPEG
    // à qualité décroissante. Une image déjà assez légère est gardée telle quelle (PNG net conservé).
    var IMG_MAX_BYTES = 700 * 1024;
    function shrinkImageBlob(blob) {
        function decodable() { return typeof createImageBitmap === "function"; }
        if (blob.size <= IMG_MAX_BYTES && decodable()) {
            return createImageBitmap(blob).then(function (bmp) {
                var ok = Math.max(bmp.width, bmp.height) <= 1800;
                if (bmp.close) bmp.close();
                return ok ? blob : encode(blob);
            }, function () { return blob; });
        }
        return decodable() ? encode(blob).catch(function () { return blob; }) : Promise.resolve(blob);
        function encode(src) {
            return createImageBitmap(src).then(function (bmp) {
                var edge = 1800, q = 0.88;
                function attempt() {
                    var s = Math.min(1, edge / Math.max(bmp.width, bmp.height));
                    var cv = document.createElement("canvas");
                    cv.width = Math.max(1, Math.round(bmp.width * s));
                    cv.height = Math.max(1, Math.round(bmp.height * s));
                    var cx = cv.getContext("2d");
                    cx.fillStyle = "#fff";
                    cx.fillRect(0, 0, cv.width, cv.height);
                    cx.drawImage(bmp, 0, 0, cv.width, cv.height);
                    return new Promise(function (resolve) { cv.toBlob(resolve, "image/jpeg", q); }).then(function (out) {
                        if (!out) return src;
                        if (out.size <= IMG_MAX_BYTES || edge <= 700) { if (bmp.close) bmp.close(); return out; }
                        edge = Math.round(edge * 0.85); q = Math.max(0.6, q - 0.05);
                        return attempt();
                    });
                }
                return attempt();
            });
        }
    }

    function openImageLightbox(images, startIndex) {
        var idx = startIndex;
        var overlay = document.createElement("div");
        overlay.className = "img-lightbox";
        var img = document.createElement("img");
        img.alt = "";
        var close = document.createElement("button");
        close.type = "button";
        close.className = "img-lightbox-close";
        close.textContent = "✕";
        close.title = "Fermer (Échap)";
        var caption = document.createElement("div");
        caption.className = "img-lightbox-caption";
        function show() {
            var meta = images[idx];
            img.removeAttribute("src");
            loadImageInto(img, meta, function () { caption.textContent = "Image absente de cet appareil"; });
            caption.textContent = (images.length > 1 ? (idx + 1) + " / " + images.length + " · " : "") + (meta.name || "");
        }
        function step(d) { if (images.length > 1) { idx = (idx + d + images.length) % images.length; show(); } }
        function closeBox() { window.removeEventListener("keydown", onKey, true); overlay.remove(); }
        function onKey(e) {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeBox(); }
            else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
            else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
        }
        overlay.addEventListener("click", function (e) { if (e.target !== img) closeBox(); else step(1); });
        close.addEventListener("click", closeBox);
        overlay.appendChild(img); overlay.appendChild(close); overlay.appendChild(caption);
        document.body.appendChild(overlay);
        window.addEventListener("keydown", onKey, true);
        show();
    }

    // Vignettes d'un exercice. editable : bouton ✕ pour retirer.
    function buildImageStrip(ex, where, editable) {
        var strip = document.createElement("div");
        strip.className = "img-strip";
        strip.style.setProperty("--img-h", IMG_HEIGHTS[getImgSize(where)] + "px");
        var list = ex.images || [];
        list.forEach(function (meta, i) {
            var cell = document.createElement("div");
            cell.className = "img-thumb";
            var b = document.createElement("button");
            b.type = "button";
            b.className = "img-thumb-btn";
            b.title = (meta.name || "Image") + " — cliquer pour agrandir";
            var im = document.createElement("img");
            im.alt = meta.name || "Image";
            im.loading = "lazy";
            loadImageInto(im, meta, function () { b.classList.add("img-missing"); b.textContent = "Image absente de cet appareil"; });
            b.appendChild(im);
            b.addEventListener("click", function () { openImageLightbox(list, i); });
            cell.appendChild(b);
            if (editable) {
                var rm = document.createElement("button");
                rm.type = "button";
                rm.className = "img-thumb-remove";
                rm.textContent = "✕";
                rm.title = "Retirer cette image";
                rm.addEventListener("click", function () {
                    if (!window.confirm("Retirer cette image ?")) return;
                    ex.images = ex.images.filter(function (m) { return m.id !== meta.id; });
                    deleteFileBlob(meta.id);
                    cloudDeleteImage(meta.id);
                    delete imageUrlCache[meta.id];
                    touchExercise(ex);
                    save();
                    render();
                });
                cell.appendChild(rm);
            }
            strip.appendChild(cell);
        });
        return strip;
    }

    function addImagesToExercise(ex, files) {
        files = files.filter(function (f) { return f && /^image\//.test(f.type); });
        if (!files.length) return;
        ex.images = ex.images || [];
        var added = [];
        Promise.all(files.map(function (file) {
            var id = uid();
            return shrinkImageBlob(file).then(function (blob) {
                return storeFileBlob(id, blob).then(function () {
                    var meta = { id: id, name: file.name || "Capture", type: blob.type, size: blob.size, addedAt: Date.now() };
                    ex.images.push(meta);
                    added.push(meta);
                });
            });
        })).then(function () {
            imagesOpenInList[ex.id] = true;
            if (guidedSessionViewActive && gsScreen === "run") setImagesShownInSession(true); // collée pendant la session : on la voit aussitôt
            touchExercise(ex);
            save();
            render();
            added.forEach(function (m) { cloudUploadImage(m); });
        }).catch(function () {
            window.alert("Impossible d'enregistrer cette image sur cet appareil (stockage plein ou navigateur privé ?).");
        });
    }

    // Section « Images et fichiers » d'un exercice : une barre à cliquer, repliée de base, qui regroupe les liens
    // (hors vidéos YouTube, qui ont leur propre barre), les fichiers (PDF, audio…) et les images. N'existe que
    // s'il y a quelque chose à montrer ; l'ajout se fait depuis la barre unique placée sous les sections.
    function buildFilesSection(ex, chipsList) {
        var wrap = document.createElement("div");
        wrap.className = "images-section";
        var nImages = (ex.images || []).length;
        var nOther = chipsList ? chipsList.querySelectorAll(".link-chip, .file-chip").length : 0;
        var count = nImages + nOther;
        if (!count) return wrap;
        var open = !!imagesOpenInList[ex.id];
        var bar = document.createElement("button");
        bar.type = "button";
        bar.className = "btn-ghost images-toggle";
        bar.textContent = (open ? "▾ " : "▸ ") + "Images et fichiers (" + count + ") — " + (open ? "masquer" : "afficher");
        bar.addEventListener("click", function () { imagesOpenInList[ex.id] = !open; render(); });
        wrap.appendChild(bar);
        if (open) {
            if (nOther) wrap.appendChild(chipsList);
            if (nImages) wrap.appendChild(buildImageStrip(ex, "ex", true));
        }
        return wrap;
    }

    // ---- images : bouton dans la barre de l'exercice, ouverture dans un onglet du navigateur ----
    var NOTE_BUBBLE_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.5-4.4A8 8 0 1 1 21 12Z"/><path d="M8.5 11h7M8.5 14.5h4"/></svg>';
    var IMAGE_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>';
    function openExerciseImageInTab(meta) {
        var cached = imageUrlCache[meta.id];
        if (cached) { window.open(cached, "_blank"); return; }
        // Pas encore en mémoire : onglet ouvert tout de suite (geste de l'utilisateur), rempli dès que l'image est lue.
        var w = window.open("", "_blank");
        getFileBlob(meta.id).then(function (blob) { return blob || cloudFetchImage(meta); }).then(function (blob) {
            if (!blob) { if (w) w.close(); showToast("Image absente de cet appareil.", 4000); return; }
            var url = URL.createObjectURL(blob);
            imageUrlCache[meta.id] = url;
            if (w) w.location.href = url; else window.open(url, "_blank");
        });
    }
    function appendExerciseImageButton(row, ex) {
        var list = ex.images || [];
        if (!list.length) return;
        // Préchargées en arrière-plan : le clic peut alors ouvrir l'onglet directement.
        list.forEach(function (m) {
            if (m.id in imageUrlCache) return;
            getFileBlob(m.id).then(function (b) { if (b && !(m.id in imageUrlCache)) imageUrlCache[m.id] = URL.createObjectURL(b); });
        });
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "exercise-link-quick exercise-image-quick";
        btn.innerHTML = IMAGE_ICON_SVG + (list.length > 1 ? '<span class="exercise-image-count">' + list.length + "</span>" : "");
        btn.title = list.length > 1 ? "Ouvrir une image dans un onglet (" + list.length + ")" : "Ouvrir l'image dans un onglet";
        btn.setAttribute("aria-label", btn.title);
        btn.addEventListener("click", function (e) {
            e.stopPropagation();
            if (list.length === 1) { openExerciseImageInTab(list[0]); return; }
            var rect = btn.getBoundingClientRect();
            openLinksQuickMenu(rect.left, rect.bottom, list.map(function (m, i) {
                return { label: "Image " + (i + 1) + (m.name ? " · " + m.name : ""), open: function () { openExerciseImageInTab(m); } };
            }));
        });
        row.appendChild(btn);
    }

    // Collage (Ctrl+V / ⌘V) d'une capture n'importe où dans la fiche d'un exercice.
    function bindImagePaste(el, ex) {
        el.addEventListener("paste", function (e) {
            var items = (e.clipboardData && e.clipboardData.items) ? Array.prototype.slice.call(e.clipboardData.items) : [];
            var files = items.filter(function (it) { return it.kind === "file" && /^image\//.test(it.type); }).map(function (it) { return it.getAsFile(); }).filter(Boolean);
            if (!files.length) return;
            e.preventDefault();
            addImagesToExercise(ex, files);
        });
    }

    // Collage d'une capture d'écran (presse-papiers) n'importe où : l'image va à l'exercice ouvert — celui
    // de la session en cours, sinon l'exercice déplié (le dernier touché s'il y en a plusieurs).
    var lastTouchedExerciseId = null;
    function noteTouchedExercise(e) {
        var el = e.target && e.target.closest ? e.target.closest(".exercise") : null;
        if (el && el.dataset.reorderId) lastTouchedExerciseId = el.dataset.reorderId;
    }
    document.addEventListener("pointerdown", noteTouchedExercise, true);
    document.addEventListener("focusin", noteTouchedExercise, true);
    function pasteTargetExercise() {
        if (guidedSessionViewActive && gsScreen === "run" && gsRunSession) {
            var st = gsRunSession.steps[gsRunStepIndex];
            var f = st && findExerciseById(st.exerciseId);
            return f ? f.ex : null;
        }
        var open = Array.prototype.filter.call(document.querySelectorAll(".exercise"), function (el) { return !el.classList.contains("collapsed") && el.dataset.reorderId; });
        var pick = open.filter(function (el) { return el.dataset.reorderId === lastTouchedExerciseId; })[0] || (open.length === 1 ? open[0] : null);
        var found = pick && findExerciseById(pick.dataset.reorderId);
        return found ? found.ex : null;
    }
    document.addEventListener("paste", function (e) {
        if (e.defaultPrevented) return;
        var items = (e.clipboardData && e.clipboardData.items) ? Array.prototype.slice.call(e.clipboardData.items) : [];
        var files = items.filter(function (it) { return it.kind === "file" && /^image\//.test(it.type); }).map(function (it) { return it.getAsFile(); }).filter(Boolean);
        if (!files.length) return;
        var ex = pasteTargetExercise();
        e.preventDefault();
        if (!ex) { showToast("Ouvre d'abord un exercice (ou lance une session), puis colle l'image.", 4000); return; }
        addImagesToExercise(ex, files);
    });

    // ---------- corbeille ----------
    // Filet de sécurité en plus d'annuler/rétablir : un élément supprimé (exercice/dossier/session)
    // reste récupérable ici même après d'autres actions qui auraient fait sortir l'annulation de
    // portée. Les fichiers joints d'un exercice mis à la corbeille restent en IndexedDB tant qu'il
    // n'est pas purgé (évincé par la limite ou supprimé définitivement) — sinon les rouvrir après
    // restauration échouerait.
    function filesOf(entry) {
        if (entry.type === "exercise") return (entry.data.files || []).concat(entry.data.images || []);
        if (entry.type === "folder") {
            var files = [];
            function walk(f) {
                (f.exercises || []).forEach(function (ex) { files = files.concat(ex.files || [], ex.images || []); });
                (f.folders || []).forEach(walk);
            }
            walk(entry.data);
            return files;
        }
        return [];
    }

    function purgeTrashEntry(entry) {
        filesOf(entry).forEach(function (f) { deleteFileBlob(f.id); });
    }

    function addToTrash(type, data, extra) {
        var entry = Object.assign({ id: uid(), type: type, data: data, deletedAt: Date.now() }, extra || {});
        state.settings.trash.unshift(entry);
        var evicted = state.settings.trash.splice(TRASH_LIMIT);
        evicted.forEach(purgeTrashEntry);
    }

    function removeFromTrash(entryId) {
        var i = state.settings.trash.findIndex(function (e) { return e.id === entryId; });
        if (i !== -1) state.settings.trash.splice(i, 1);
    }

    function restoreFromTrash(entryId) {
        var entry = state.settings.trash.filter(function (e) { return e.id === entryId; })[0];
        if (!entry) return;
        if (entry.type === "session") {
            if (!findById(state.instruments, entry.data.instrumentId)) entry.data.instrumentId = state.activeInstrumentId;
            entry.data.tabIds = (entry.data.tabIds || []).filter(function (id) { return state.settings.sessionFolders.some(function (f) { return f.id === id; }); });
            state.settings.guidedSessions.push(entry.data);
        } else {
            var inst = findById(state.instruments, entry.instrumentId) || state.instruments[0];
            if (entry.type === "exercise") {
                var folder = entry.parentFolderId ? findFolderById(inst, entry.parentFolderId) : null;
                (folder || inst.categories[0]).exercises.push(entry.data);
            } else if (entry.type === "folder") {
                var parent = entry.parentFolderId ? findFolderById(inst, entry.parentFolderId) : null;
                if (parent) parent.folders.push(entry.data);
                else inst.categories.push(entry.data);
            }
        }
        removeFromTrash(entryId);
        save();
        render();
    }

    function purgeFromTrash(entryId) {
        var entry = state.settings.trash.filter(function (e) { return e.id === entryId; })[0];
        if (!entry) return;
        purgeTrashEntry(entry);
        removeFromTrash(entryId);
        save();
        render();
    }

    function emptyTrash() {
        state.settings.trash.forEach(purgeTrashEntry);
        state.settings.trash = [];
        save();
        render();
    }

    // Recherche un dossier (chapitre ou sous-dossier) par id dans TOUT l'instrument, pour retrouver
    // le parent d'un élément mis à la corbeille (voir restoreFromTrash).
    function findFolderById(inst, folderId) {
        var found = null;
        function walk(list) {
            list.forEach(function (f) {
                if (found) return;
                if (f.id === folderId) { found = f; return; }
                walk(f.folders);
            });
        }
        walk(inst.categories);
        return found;
    }

    // ---------- doublons de nom (dans UN MÊME dossier seulement) ----------
    // Le même exercice peut légitimement exister sous le même nom dans deux dossiers différents
    // (ex. un échauffement rangé à la fois dans "Technique" et dans "Gammes") : la vérification ne
    // porte donc que sur les frères directs d'un même parent, jamais à travers tout l'instrument.
    function folderNameTaken(siblingFolders, name, exclude) {
        var n = name.trim().toLowerCase();
        return siblingFolders.some(function (f) { return f !== exclude && f.name.trim().toLowerCase() === n; });
    }
    function exerciseTitleTaken(siblingExercises, title, exclude) {
        var t = title.trim().toLowerCase();
        return siblingExercises.some(function (ex) { return ex !== exclude && ex.title.trim().toLowerCase() === t; });
    }
    function confirmNameCollision(kind, name) {
        return window.confirm("Un " + kind + " nommé « " + name + " » existe déjà ici. Continuer quand même ?");
    }

    // ---------- déplacer / fusionner des dossiers ----------
    function folderSubtreeDepth(folder) {
        if (!folder.folders.length) return 1;
        return 1 + Math.max.apply(Math, folder.folders.map(folderSubtreeDepth));
    }
    function collectFolderAndDescendantIds(folder) {
        var ids = [folder.id];
        folder.folders.forEach(function (f) { ids = ids.concat(collectFolderAndDescendantIds(f)); });
        return ids;
    }

    function humanFileSize(bytes) {
        if (!bytes && bytes !== 0) return "";
        if (bytes < 1024) return bytes + " o";
        if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " Ko";
        return (bytes / (1024 * 1024)).toFixed(1) + " Mo";
    }

    // ---------- sauvegardes de secours ----------
    // Filet de sécurité indépendant de l'historique annuler/rétablir (qui, lui, ne garde que les
    // modifications faites SUR CET appareil). Ici, on prend un instantané à chaque moment où une
    // synchro pourrait effacer des données — avant qu'un autre appareil n'écrase l'état local, ou
    // avant qu'on n'écrase le cloud avec l'état local — pour pouvoir tout récupérer même si le
    // choix "le plus récent gagne" s'est trompé. Rangé en localStorage, donc propre à cet appareil.
    var BACKUPS_KEY = "trainhub.backups.v1";
    var BACKUPS_LIMIT = 12;

    function totalExerciseCount(s) {
        var n = 0;
        function walk(list) {
            list.forEach(function (f) {
                n += f.exercises.length;
                walk(f.folders);
            });
        }
        (s.instruments || []).forEach(function (inst) { walk(inst.categories || []); });
        return n;
    }

    function loadBackups() {
        try { return JSON.parse(localStorage.getItem(BACKUPS_KEY)) || []; } catch (e) { return []; }
    }

    function backupSnapshot(reason, stateObj) {
        try {
            var list = loadBackups();
            list.push({ at: Date.now(), reason: reason, count: totalExerciseCount(stateObj), json: JSON.stringify(stateObj) });
            if (list.length > BACKUPS_LIMIT) list = list.slice(list.length - BACKUPS_LIMIT);
            localStorage.setItem(BACKUPS_KEY, JSON.stringify(list));
        } catch (e) {
            console.error("Sauvegarde de secours impossible", e);
        }
    }

    function getActiveInstrument() {
        var found = state.instruments.filter(function (i) { return i.id === state.activeInstrumentId; })[0];
        return found || state.instruments[0];
    }

    function findById(list, id) {
        return list.filter(function (n) { return n.id === id; })[0];
    }

    function resolvePath(inst, path) {
        var nodes = [];
        var list = inst.categories;
        for (var i = 0; i < path.length; i++) {
            var node = findById(list, path[i]);
            if (!node) break;
            nodes.push(node);
            list = node.folders;
        }
        return nodes;
    }

    function getNavPath(inst) {
        var p = navPaths[inst.id];
        if (!p || p.length === 0) {
            p = inst.categories.length ? [inst.categories[0].id] : [];
            navPaths[inst.id] = p;
        }
        return p;
    }

    function setNavPath(inst, path) {
        navPaths[inst.id] = path;
    }

    function clearFilters() {
        searchQuery = "";
        if ($searchInput) $searchInput.value = "";
    }

    function collectExercises(inst, matchFn) {
        var results = [];
        function walk(list, names, ids) {
            list.forEach(function (folder) {
                var newNames = names.concat(folder.name);
                var newIds = ids.concat(folder.id);
                folder.exercises.forEach(function (ex) {
                    if (matchFn(ex)) results.push({ ex: ex, folder: folder, pathNames: newNames, pathIds: newIds });
                });
                walk(folder.folders, newNames, newIds);
            });
        }
        walk(inst.categories, [], []);
        return results;
    }

    // Recherche un exercice par id dans TOUS les instruments (les pas d'une session guidée n'ont
    // pas besoin de préciser l'instrument : l'id seul suffit, voir normalizeGuidedSessions).
    function findExerciseById(exerciseId) {
        for (var i = 0; i < state.instruments.length; i++) {
            var inst = state.instruments[i];
            var found = collectExercises(inst, function (ex) { return ex.id === exerciseId; })[0];
            if (found) {
                var rootChapter = findById(inst.categories, found.pathIds[0]);
                return { ex: found.ex, folder: found.folder, inst: inst, pathNames: found.pathNames, chapterColor: (rootChapter && rootChapter.color) || "#00e676" };
            }
        }
        return null;
    }

    // Où se trouve l'exercice : son chemin de dossiers, puis ceux des exercices de même nom rangés ailleurs
    // (copies dans d'autres dossiers). Une ou deux lignes discrètes, sous la barre de l'exercice déplié.
    function gsExercisePathLines(found) {
        if (!found) return null;
        function norm(t) { return String(t || "").replace(/ \(copie\)$/, "").trim().toLowerCase(); }
        var lines = [found.pathNames.join(" > ")];
        var others = collectExercises(found.inst, function (ex) {
            return ex !== found.ex && !ex.archived && norm(ex.title) === norm(found.ex.title);
        }).map(function (r) { return r.pathNames.join(" > "); }).filter(function (l) { return lines.indexOf(l) === -1; });
        others.slice(0, 2).forEach(function (l) { lines.push(l); });
        var wrap = document.createElement("div");
        wrap.className = "gs-pathlines";
        lines.forEach(function (l) {
            var d = document.createElement("div");
            d.className = "gs-pathline";
            d.textContent = l;
            d.title = l;
            wrap.appendChild(d);
        });
        if (others.length > 2) {
            var more = document.createElement("div");
            more.className = "gs-pathline gs-pathline-more";
            more.textContent = "+ " + (others.length - 2) + " autre" + (others.length - 2 > 1 ? "s" : "");
            wrap.appendChild(more);
        }
        return wrap;
    }

    function guessLinkLabel(url) {
        try {
            var host = new URL(url).hostname.replace(/^www\./, "");
            if (/youtube\.|youtu\.be/.test(host)) return "YouTube";
            if (/irealpro|ireal-pro/.test(host)) return "iReal Pro";
            if (/\.pdf($|\?)/i.test(url)) return "PDF";
            if (/\.mp3($|\?)/i.test(url)) return "MP3";
            if (/drive\.google/.test(host)) return "Google Drive";
            if (/dropbox/.test(host)) return "Dropbox";
            return host;
        } catch (e) {
            return "Lien";
        }
    }

    var LINK_ICONS = {
        youtube: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="3"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor" stroke="none"/></svg>',
        note: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>',
        pdf: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
        audio: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10v4"/><path d="M7 7v10"/><path d="M11 4v16"/><path d="M15 7v10"/><path d="M19 10v4"/></svg>',
        link: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l2-2a5 5 0 0 0-7.07-7.07l-1 1"/><path d="M14 11a5 5 0 0 0-7.07 0l-2 2a5 5 0 0 0 7.07 7.07l1-1"/></svg>'
    };
    var FOLDER_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';
    var CHEVRON_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
    var PENCIL_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
    var GRIP_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
    var STAR_FILLED_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.7l2.9 6 6.6.7-4.9 4.5 1.3 6.5L12 17.4l-5.9 3 1.3-6.5-4.9-4.5 6.6-.7Z"/></svg>';
    var ARCHIVE_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/></svg>';
    var FILE_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05 12.25 20.24a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';
    var METRONOME_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 21 10 4h4l3 17Z"/><path d="M12 4V2.3"/><path d="M12 18 15.2 6.5"/><circle cx="14.1" cy="10.8" r="1.3" fill="currentColor" stroke="none"/></svg>';
    var METRO_PLAY_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5Z"/></svg>';
    var METRO_STOP_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
    var METRO_VOLUME_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10Z"/><path d="M17 9a4.5 4.5 0 0 1 0 6"/><path d="M19.5 6.5a8.5 8.5 0 0 1 0 11"/></svg>';
    var METRO_PIN_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6l-1.2 6.2L17 13v2H7v-2l3.2-2.8L9 4Z"/><path d="M12 15v6"/></svg>';
    var METRO_UNPIN_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6l-1.2 6.2L17 13v2H7v-2l3.2-2.8L9 4Z"/><path d="M12 15v6"/><path d="M4 4l16 16"/></svg>';
    var METRO_MORE_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/></svg>';
    var METRO_CHRONO_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2h4"/><path d="M12 6v0"/><circle cx="12" cy="14" r="8"/><path d="M12 14V9.5"/><path d="M17.5 5.5l1.5-1.5"/></svg>';
    var RESET_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';

    function linkIconSvg(label, url) {
        var l = (label || "").toLowerCase();
        if (l.indexOf("youtube") !== -1 || /^https?:\/\/([a-z0-9-]+\.)?(youtube\.com|youtu\.be)\//i.test(url || "")) return LINK_ICONS.youtube;
        if (l.indexOf("ireal") !== -1) return LINK_ICONS.note;
        if (l.indexOf("pdf") !== -1) return LINK_ICONS.pdf;
        if (l.indexOf("mp3") !== -1 || l.indexOf("audio") !== -1) return LINK_ICONS.audio;
        return LINK_ICONS.link;
    }

    // ---------- notes : lignes datées et archives ----------
    // Les notes d'un exercice restent courtes : seules les NOTES_KEEP_LINES dernières lignes restent visibles,
    // les plus anciennes passent dans les archives, avec la date de leur écriture. On ne coupe jamais une ligne :
    // l'archivage se fait quand on quitte la zone de notes, sur des lignes entières (séparées par un retour à la ligne).
    var NOTES_KEEP_LINES = 6;
    function todayIso() {
        var d = new Date();
        return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
    }
    function formatNoteDate(iso) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
        return m ? m[3] + "/" + m[2] + "/" + m[1].slice(2) : "";
    }
    // Garde, pour chaque ligne de ex.notes, la date où elle a été écrite (ou modifiée pour la dernière fois).
    function updateNoteDates(ex, newText) {
        var oldLines = (ex.notes || "").split("\n"), oldDates = ex.noteDates || [];
        var fallback = ex.updatedAt ? (function (t) { var d = new Date(t); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); })(ex.updatedAt) : todayIso();
        var newLines = newText.split("\n"), used = {}, dates = new Array(newLines.length);
        newLines.forEach(function (l, i) { if (oldLines[i] === l) { dates[i] = oldDates[i] || fallback; used[i] = true; } });
        newLines.forEach(function (l, i) {
            if (dates[i]) return;
            if (!l.trim()) { dates[i] = todayIso(); return; }
            for (var j = 0; j < oldLines.length; j++) if (!used[j] && oldLines[j] === l) { used[j] = true; dates[i] = oldDates[j] || fallback; return; }
            dates[i] = todayIso();
        });
        ex.noteDates = dates;
    }
    // Déplace les lignes en trop (les plus anciennes) vers les archives. Renvoie true si quelque chose a bougé.
    function archiveOverflowNotes(ex) {
        var lines = (ex.notes || "").split("\n");
        var idx = [];
        lines.forEach(function (l, i) { if (l.trim()) idx.push(i); });
        if (idx.length <= NOTES_KEEP_LINES) return false;
        var keepFrom = idx[idx.length - NOTES_KEEP_LINES];
        var dates = ex.noteDates || [];
        var fallback = todayIso();
        ex.notesArchive = ex.notesArchive || [];
        for (var i = 0; i < keepFrom; i++) {
            if (lines[i].trim()) ex.notesArchive.push({ d: dates[i] || fallback, t: lines[i].trim() });
        }
        ex.notes = lines.slice(keepFrom).join("\n");
        ex.noteDates = dates.slice(keepFrom);
        return true;
    }

    function touchExercise(ex) {
        ex.updatedAt = Date.now();
    }

    function formatUpdatedAt(ts) {
        if (!ts) return "";
        var d = new Date(ts);
        var now = new Date();
        if (d.toDateString() === now.toDateString()) {
            return "aujourd'hui à " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
        }
        var diffDays = Math.floor((now - d) / 86400000);
        if (diffDays === 1) return "hier";
        if (diffDays >= 0 && diffDays < 7) return "il y a " + diffDays + " j";
        var opts = { day: "2-digit", month: "2-digit" };
        if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
        return d.toLocaleDateString("fr-FR", opts);
    }

    // ---------- notes : hauteur automatique ----------
    // 3 lignes de base, jusqu'à 8 lignes visibles ; au-delà, la zone garde sa taille max et devient
    // scrollable plutôt que de pousser toute la page.
    var NOTES_MIN_ROWS = 3;
    var NOTES_MAX_ROWS = 8;

    function autoGrowNotes(el) {
        try {
            el.style.height = "0px"; // force le recalcul de scrollHeight, sans la valeur précédente
            var cs = window.getComputedStyle(el);
            var lineHeight = parseFloat(cs.lineHeight) || 20;
            var vPad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
            if (isNaN(vPad)) vPad = 16;
            var minH = lineHeight * NOTES_MIN_ROWS + vPad;
            var maxH = lineHeight * NOTES_MAX_ROWS + vPad;
            var h = Math.min(Math.max(el.scrollHeight, minH), maxH);
            el.style.height = h + "px";
            el.style.overflowY = el.scrollHeight > maxH ? "auto" : "hidden";
        } catch (e) {}
    }

    // Ajuste la largeur du champ-titre d'un exercice à celle de son texte (au lieu de remplir
    // toute la ligne) : le reste de la barre (voir .exercise-row-spacer) redevient une zone
    // cliquable pour déplier/replier, seul le texte lui-même ouvre l'édition.
    var exerciseTitleMeasurer = null;
    function autoSizeExerciseTitle(input) {
        try {
            if (!exerciseTitleMeasurer) {
                exerciseTitleMeasurer = document.createElement("span");
                exerciseTitleMeasurer.style.position = "fixed";
                exerciseTitleMeasurer.style.visibility = "hidden";
                exerciseTitleMeasurer.style.whiteSpace = "pre";
                exerciseTitleMeasurer.style.left = "-9999px";
                document.body.appendChild(exerciseTitleMeasurer);
            }
            var cs = window.getComputedStyle(input);
            exerciseTitleMeasurer.style.font = cs.font;
            exerciseTitleMeasurer.textContent = input.value || input.placeholder || " ";
            input.style.width = (exerciseTitleMeasurer.offsetWidth + 22) + "px";
        } catch (e) {}
    }
    function autoSizeAllExerciseTitles() {
        if (typeof requestAnimationFrame !== "function") return;
        requestAnimationFrame(function () {
            var inputs = document.querySelectorAll(".exercise-title");
            for (var i = 0; i < inputs.length; i++) autoSizeExerciseTitle(inputs[i]);
        });
    }

    // À appeler après qu'un lot de rendu ait posé les zones de notes dans le DOM réel (pas au
    // moment de leur construction, où elles ne sont pas encore attachées : scrollHeight vaudrait
    // toujours 0, ce qui figerait tout le monde à la hauteur minimale).
    function autoGrowAllNotes() {
        if (typeof requestAnimationFrame !== "function") return;
        requestAnimationFrame(function () {
            var areas = document.querySelectorAll(".notes-textarea");
            for (var i = 0; i < areas.length; i++) autoGrowNotes(areas[i]);
        });
    }

    function iconButton(glyph, title, onClick) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "icon-btn btn-ghost";
        b.title = title;
        b.textContent = glyph;
        b.addEventListener("click", onClick);
        return b;
    }

    function svgIconButton(svg, title, onClick) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "icon-btn btn-ghost";
        b.title = title;
        b.setAttribute("aria-label", title);
        b.innerHTML = svg;
        b.addEventListener("click", onClick);
        return b;
    }

    // Renommer/supprimer passent par un petit menu contextuel intégré à la page : clic droit
    // (ordinateur) ou appui long (téléphone) sur toute la ligne du dossier. Pas de double-clic :
    // un simple clic navigue. `suppressNextClick` évite qu'un clic de navigation se déclenche juste
    // après un glisser ou un appui long (certains navigateurs émettent quand même un "click" final).
    var suppressNextClick = false;
    var LONG_PRESS_MS = 550;
    var LONG_PRESS_TOLERANCE = 10;

    // Geste partagé clic droit / appui long, indépendant de ce qu'il ouvre (menu de dossier ou
    // d'exercice ci-dessous). Sur un champ texte (renommage inline, titre d'exercice), on laisse
    // le menu natif du navigateur s'ouvrir (copier/coller) plutôt que le nôtre.
    function bindContextGesture(el, openFn) {
        var triggeredByPress = false;

        el.addEventListener("contextmenu", function (e) {
            // Le titre d'un exercice occupe la majeure partie de la ligne : un clic droit dessus
            // doit quand même ouvrir CE menu (favoris/archiver), pas le menu natif copier/coller —
            // sinon le clic droit ne marcherait presque jamais sur cette ligne. Un collage se fait
            // toujours au clavier (Ctrl+V) une fois le champ ciblé.
            e.preventDefault();
            e.stopPropagation();
            // L'appui long tactile a pu déjà ouvrir le menu via le minuteur ci-dessous.
            if (triggeredByPress) { triggeredByPress = false; return; }
            openFn(e.clientX, e.clientY);
        });

        // Safari sur iPhone/iPad ne déclenche pas "contextmenu" sur un appui long : minuteur
        // manuel, limité aux pointeurs tactiles/stylet (la souris a le clic droit).
        var pressTimer = null;
        var startX = 0, startY = 0;

        function cancelPress() {
            if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
        }

        el.addEventListener("pointerdown", function (e) {
            if (e.pointerType === "mouse") return;
            if (e.target.closest("button, input, textarea, select")) return;
            startX = e.clientX;
            startY = e.clientY;
            cancelPress();
            pressTimer = setTimeout(function () {
                pressTimer = null;
                triggeredByPress = true;
                suppressNextClick = true;
                // Le "click" éventuel suit immédiatement le relâchement : on ne l'ignore qu'une fois.
                document.addEventListener("pointerup", function onUp() {
                    document.removeEventListener("pointerup", onUp, true);
                    setTimeout(function () { suppressNextClick = false; }, 60);
                }, true);
                openFn(startX, startY);
                setTimeout(function () { triggeredByPress = false; }, 800);
            }, LONG_PRESS_MS);
        });
        el.addEventListener("pointermove", function (e) {
            if (!pressTimer) return;
            if (Math.abs(e.clientX - startX) > LONG_PRESS_TOLERANCE || Math.abs(e.clientY - startY) > LONG_PRESS_TOLERANCE) cancelPress();
        });
        el.addEventListener("pointerup", cancelPress);
        el.addEventListener("pointercancel", cancelPress);
    }

    // ---------- duplication (exercice / dossier) ----------
    // Les fichiers joints vivent dans IndexedDB (voir plus haut) : dupliquer un exercice recopie
    // aussi le blob réel sous un nouvel id, sinon les deux exercices partageraient le même fichier
    // et le supprimer sur l'un l'effacerait pour l'autre.
    function cloneLinksForDuplicate(links) {
        return (links || []).map(function (l) { return { id: uid(), label: l.label, url: l.url }; });
    }

    function cloneFilesForDuplicate(files) {
        return (files || []).map(function (f) {
            var newId = uid();
            getFileBlob(f.id).then(function (blob) { if (blob) storeFileBlob(newId, blob); });
            return { id: newId, name: f.name, type: f.type, size: f.size };
        });
    }

    function duplicateExercise(ex) {
        return {
            id: uid(),
            title: ex.title + " (copie)",
            notes: ex.notes || "",
            favorite: false,
            archived: false,
            links: cloneLinksForDuplicate(ex.links),
            files: cloneFilesForDuplicate(ex.files),
            images: cloneFilesForDuplicate(ex.images),
            metronome: ex.metronome ? JSON.parse(JSON.stringify(ex.metronome)) : null,
            notesArchive: (ex.notesArchive || []).map(function (e) { return { d: e.d, t: e.t }; }),
            noteDates: (ex.noteDates || []).slice(),
            lastMinutes: ex.lastMinutes || undefined,
            pinnedLinkId: null,
            collapsed: true,
            updatedAt: Date.now()
        };
    }

    function duplicateFolderDeep(folder) {
        var copy = {
            id: uid(),
            name: folder.name + " (copie)",
            folders: (folder.folders || []).map(duplicateFolderDeep),
            exercises: (folder.exercises || []).map(duplicateExercise)
        };
        if (folder.color) copy.color = folder.color;
        return copy;
    }

    function bindFolderMenu(el, getParentArray, folder, inst) {
        bindContextGesture(el, function (x, y) { openFolderMenu(x, y, getParentArray, folder, inst); });
    }

    function bindExerciseMenu(el, ex, folder) {
        bindContextGesture(el, function (x, y) { openExerciseMenu(x, y, ex, folder); });
    }

    // ---------- menu contextuel (renommer / supprimer) ----------

    var openMenu = null;

    function closeFolderMenu() {
        if (!openMenu) return;
        openMenu.backdrop.remove();
        openMenu.menu.remove();
        document.removeEventListener("keydown", openMenu.onKey, true);
        openMenu = null;
    }

    // Chemin d'ids menant au dossier `id` (null s'il est introuvable).
    function findPathTo(inst, id) {
        function walk(list, acc) {
            for (var i = 0; i < list.length; i++) {
                var p = acc.concat(list[i].id);
                if (list[i].id === id) return p;
                var sub = walk(list[i].folders, p);
                if (sub) return sub;
            }
            return null;
        }
        return walk(inst.categories, []);
    }

    function folderDepth(inst, id) {
        var p = findPathTo(inst, id);
        return p ? p.length : 0;
    }

    function deleteFolder(parentArray, folder, inst) {
        var pathToFolder = findPathTo(inst, folder.id) || [folder.id];
        var parentFolderId = pathToFolder.length > 1 ? pathToFolder[pathToFolder.length - 2] : null;
        var pos = parentArray.indexOf(folder);
        if (pos !== -1) parentArray.splice(pos, 1);
        addToTrash("folder", folder, { instrumentId: inst.id, parentFolderId: parentFolderId });
        var path = getNavPath(inst);
        var inPath = path.indexOf(folder.id);
        if (inPath !== -1) setNavPath(inst, path.slice(0, inPath));
        save();
        render();
    }

    function openFolderMenu(x, y, getParentArray, folder, inst, startScreen) {
        closeFolderMenu();

        // Fond transparent qui ferme le menu au prochain appui ailleurs. On écoute "pointerdown"
        // (et non "click") : le relâchement du doigt qui a ouvert le menu par appui long ne doit
        // pas le refermer aussitôt.
        var backdrop = document.createElement("div");
        backdrop.className = "ctx-backdrop";
        backdrop.addEventListener("pointerdown", function (e) { e.preventDefault(); closeFolderMenu(); });
        backdrop.addEventListener("contextmenu", function (e) { e.preventDefault(); closeFolderMenu(); });

        var menu = document.createElement("div");
        menu.className = "ctx-menu";
        menu.setAttribute("role", "menu");
        menu.addEventListener("contextmenu", function (e) { e.preventDefault(); });

        function menuButton(text, className, onClick) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "ctx-item" + (className ? " " + className : "");
            b.textContent = text;
            // Idem : un bouton ne réagit que si l'appui a COMMENCÉ dessus (ou au clavier,
            // e.detail === 0), pour ignorer le relâchement de l'appui long qui a ouvert le menu.
            var armed = false;
            b.addEventListener("pointerdown", function () { armed = true; });
            b.addEventListener("click", function (e) {
                if (!armed && e.detail !== 0) return;
                armed = false;
                onClick();
            });
            return b;
        }

        function showMain() {
            menu.innerHTML = "";
            var title = document.createElement("div");
            title.className = "ctx-title";
            title.textContent = folder.name;
            menu.appendChild(title);
            if (canAddSub) {
                menu.appendChild(menuButton("Nouveau sous-dossier", "", showAddSub));
            } else if (depth >= MAX_FOLDER_DEPTH) {
                var depthNote = document.createElement("div");
                depthNote.className = "ctx-message";
                depthNote.textContent = "Profondeur maximale atteinte (" + MAX_FOLDER_DEPTH + " niveaux)";
                menu.appendChild(depthNote);
            }
            menu.appendChild(menuButton("Renommer", "", showRename));
            menu.appendChild(menuButton("Dupliquer", "", function () {
                var parentArray = getParentArray();
                var dup = duplicateFolderDeep(folder);
                // Un grand chapitre dupliqué doit rester repérable : une couleur propre (suivant la
                // palette, comme un chapitre tout neuf), pas celle — identique — de l'original.
                if (dup.color) dup.color = currentPalette()[parentArray.length % currentPalette().length];
                parentArray.push(dup);
                save();
                closeFolderMenu();
                render();
            }));
            menu.appendChild(menuButton("Déplacer vers…", "", function () {
                closeFolderMenu();
                var excludeIds = collectFolderAndDescendantIds(folder);
                openFolderPickerModal("Déplacer « " + folder.name + " » vers…", excludeIds, function (dest) {
                    var destDepth = folderDepth(inst, dest.id);
                    if (destDepth + folderSubtreeDepth(folder) > MAX_FOLDER_DEPTH) {
                        window.alert("Impossible de déplacer ici : la profondeur maximale (" + MAX_FOLDER_DEPTH + " niveaux) serait dépassée.");
                        return;
                    }
                    if (folderNameTaken(dest.folders, folder.name) && !confirmNameCollision("dossier", folder.name)) return;
                    var parentArray = getParentArray();
                    var pos = parentArray.indexOf(folder);
                    if (pos !== -1) parentArray.splice(pos, 1);
                    dest.folders.push(folder);
                    // Si le dossier déplacé faisait partie du chemin affiché, on le suit à son nouvel
                    // emplacement plutôt que de laisser l'écran pointer vers un chemin qui n'existe plus.
                    var currentPath = getNavPath(inst);
                    if (currentPath.indexOf(folder.id) !== -1) {
                        var destPath = findPathTo(inst, dest.id) || [];
                        setNavPath(inst, destPath.concat(folder.id));
                    }
                    save();
                    render();
                    showToast("« " + folder.name + " » déplacé vers « " + dest.name + " »");
                });
            }));
            menu.appendChild(menuButton("Fusionner avec…", "", function () {
                closeFolderMenu();
                var excludeIds2 = collectFolderAndDescendantIds(folder);
                openFolderPickerModal("Fusionner « " + folder.name + " » dans…", excludeIds2, function (dest) {
                    var maxChildDepth = folder.folders.reduce(function (m, f) { return Math.max(m, folderSubtreeDepth(f)); }, 0);
                    var destDepth = folderDepth(inst, dest.id);
                    if (maxChildDepth > 0 && destDepth + maxChildDepth > MAX_FOLDER_DEPTH) {
                        window.alert("Impossible de fusionner ici : certains sous-dossiers dépasseraient la profondeur maximale (" + MAX_FOLDER_DEPTH + " niveaux).");
                        return;
                    }
                    if (!window.confirm("Fusionner « " + folder.name + " » dans « " + dest.name + " » ? Ses sous-dossiers et exercices seront déplacés dans « " + dest.name + " », et « " + folder.name + " » disparaîtra.")) return;
                    dest.folders = dest.folders.concat(folder.folders);
                    dest.exercises = dest.exercises.concat(folder.exercises);
                    var parentArray2 = getParentArray();
                    var pos2 = parentArray2.indexOf(folder);
                    if (pos2 !== -1) parentArray2.splice(pos2, 1);
                    var currentPath2 = getNavPath(inst);
                    if (currentPath2.indexOf(folder.id) !== -1) {
                        setNavPath(inst, findPathTo(inst, dest.id) || []);
                    }
                    save();
                    render();
                    showToast("« " + folder.name + " » fusionné dans « " + dest.name + " »");
                });
            }));
            menu.appendChild(menuButton("Supprimer", "ctx-danger", showDelete));
        }

        var depth = folderDepth(inst, folder.id);
        var canAddSub = depth > 0 && depth < MAX_FOLDER_DEPTH;

        function showAddSub() {
            menu.innerHTML = "";
            var input = document.createElement("input");
            input.type = "text";
            input.className = "ctx-input";
            input.placeholder = "Nom du sous-dossier…";
            function commit() {
                var name = input.value.trim();
                if (!name) return;
                if (folderNameTaken(folder.folders, name) && !confirmNameCollision("dossier", name)) return;
                var child = makeFolder(name);
                folder.folders.push(child);
                treeExpanded[folder.id] = true;
                // On ouvre directement le nouveau dossier (chemin = chemin du parent + enfant).
                var parentPath = findPathTo(inst, folder.id);
                if (parentPath) { clearFilters(); setNavPath(inst, parentPath.concat(child.id)); }
                save();
                closeFolderMenu();
                render();
            }
            input.addEventListener("keydown", function (e) {
                e.stopPropagation();
                if (e.key === "Enter") commit();
                if (e.key === "Escape") closeFolderMenu();
            });
            menu.appendChild(input);
            var actions = document.createElement("div");
            actions.className = "ctx-actions";
            actions.appendChild(menuButton("Annuler", "ctx-secondary", closeFolderMenu));
            actions.appendChild(menuButton("Créer", "ctx-primary", commit));
            menu.appendChild(actions);
            place();
            input.focus();
        }

        function showRename() {
            menu.innerHTML = "";
            var input = document.createElement("input");
            input.type = "text";
            input.className = "ctx-input";
            input.value = folder.name;
            function commit() {
                var name = input.value.trim();
                if (name && name !== folder.name) {
                    if (folderNameTaken(getParentArray(), name, folder) && !confirmNameCollision("dossier", name)) return;
                    folder.name = name;
                    save();
                }
                closeFolderMenu();
                render();
            }
            input.addEventListener("keydown", function (e) {
                e.stopPropagation();
                if (e.key === "Enter") commit();
                if (e.key === "Escape") closeFolderMenu();
            });
            menu.appendChild(input);
            var actions = document.createElement("div");
            actions.className = "ctx-actions";
            actions.appendChild(menuButton("Annuler", "ctx-secondary", closeFolderMenu));
            actions.appendChild(menuButton("Valider", "ctx-primary", commit));
            menu.appendChild(actions);
            place();
            input.focus();
            input.select();
        }

        function showDelete() {
            menu.innerHTML = "";
            var hasContent = folder.folders.length > 0 || folder.exercises.length > 0;
            var msg = document.createElement("div");
            msg.className = "ctx-message";
            msg.textContent = "Supprimer « " + folder.name + " »" + (hasContent ? " et tout son contenu (sous-dossiers et exercices)" : "") + " ?";
            menu.appendChild(msg);
            var actions = document.createElement("div");
            actions.className = "ctx-actions";
            actions.appendChild(menuButton("Annuler", "ctx-secondary", closeFolderMenu));
            actions.appendChild(menuButton("Supprimer", "ctx-danger-solid", function () {
                closeFolderMenu();
                deleteFolder(getParentArray(), folder, inst);
            }));
            menu.appendChild(actions);
            place();
        }

        // Garde le menu dans l'écran, légèrement décalé du doigt/curseur.
        function place() {
            var w = menu.offsetWidth || 200;
            var h = menu.offsetHeight || 120;
            var left = Math.min(Math.max(8, x + 6), Math.max(8, window.innerWidth - w - 8));
            var top = Math.min(Math.max(8, y + 6), Math.max(8, window.innerHeight - h - 8));
            menu.style.left = left + "px";
            menu.style.top = top + "px";
        }

        function onKey(e) { if (e.key === "Escape") closeFolderMenu(); }

        document.body.appendChild(backdrop);
        document.body.appendChild(menu);
        document.addEventListener("keydown", onKey, true);
        openMenu = { backdrop: backdrop, menu: menu, onKey: onKey };
        if (startScreen === "rename") showRename();
        else if (startScreen === "addSub" && canAddSub) showAddSub();
        else showMain();
        place();
    }

    // Menu, plus simple, d'un exercice : juste les deux cases "favoris" et "archiver" demandées
    // (le statu quo avec les statuts à faire/en cours/terminé/à revoir était jugé trop compliqué).
    function openExerciseMenu(x, y, ex, folder) {
        closeFolderMenu();

        var backdrop = document.createElement("div");
        backdrop.className = "ctx-backdrop";
        backdrop.addEventListener("pointerdown", function (e) { e.preventDefault(); closeFolderMenu(); });
        backdrop.addEventListener("contextmenu", function (e) { e.preventDefault(); closeFolderMenu(); });

        var menu = document.createElement("div");
        menu.className = "ctx-menu";
        menu.setAttribute("role", "menu");
        menu.addEventListener("contextmenu", function (e) { e.preventDefault(); });

        function menuButton(text, className, onClick) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "ctx-item" + (className ? " " + className : "");
            b.textContent = text;
            var armed = false;
            b.addEventListener("pointerdown", function () { armed = true; });
            b.addEventListener("click", function (e) {
                if (!armed && e.detail !== 0) return;
                armed = false;
                onClick();
            });
            return b;
        }

        function place() {
            var w = menu.offsetWidth || 200;
            var h = menu.offsetHeight || 100;
            var left = Math.min(Math.max(8, x + 6), Math.max(8, window.innerWidth - w - 8));
            var top = Math.min(Math.max(8, y + 6), Math.max(8, window.innerHeight - h - 8));
            menu.style.left = left + "px";
            menu.style.top = top + "px";
        }

        var title = document.createElement("div");
        title.className = "ctx-title";
        title.textContent = ex.title;
        menu.appendChild(title);

        menu.appendChild(menuButton(ex.favorite ? "★ Retirer des favoris" : "☆ Marquer en favori", "", function () {
            ex.favorite = !ex.favorite;
            touchExercise(ex);
            save();
            closeFolderMenu();
            render();
        }));
        menu.appendChild(menuButton(ex.archived ? "Désarchiver" : "Archiver", "", function () {
            ex.archived = !ex.archived;
            touchExercise(ex);
            save();
            closeFolderMenu();
            render();
        }));

        if (folder) {
            menu.appendChild(menuButton("Dupliquer", "", function () {
                folder.exercises.push(duplicateExercise(ex));
                save();
                closeFolderMenu();
                render();
                // La copie ne reprend pas le statut favori/archivé (voir duplicateExercise) : sans ce
                // message, dupliquer depuis la vue Archivés ferait "disparaître" la copie de cette vue
                // sans explication, l'air d'un bug plutôt que d'un choix.
                if (ex.favorite || ex.archived) {
                    showToast("Copie créée dans « " + folder.name + " » (non " + (ex.archived ? "archivée" : "favorite") + ")");
                }
            }));
            menu.appendChild(menuButton("Déplacer vers…", "", function () {
                closeFolderMenu();
                openFolderPickerModal("Déplacer « " + ex.title + " » vers…", [], function (dest) {
                    if (dest === folder) return;
                    if (exerciseTitleTaken(dest.exercises, ex.title) && !confirmNameCollision("exercice", ex.title)) return;
                    folder.exercises.splice(folder.exercises.indexOf(ex), 1);
                    dest.exercises.push(ex);
                    save();
                    render();
                    showToast("« " + ex.title + " » déplacé vers « " + dest.name + " »");
                });
            }));
        }

        function onKey(e) { if (e.key === "Escape") closeFolderMenu(); }

        document.body.appendChild(backdrop);
        document.body.appendChild(menu);
        document.addEventListener("keydown", onKey, true);
        openMenu = { backdrop: backdrop, menu: menu, onKey: onKey };
        place();
    }

    // ---------- exercices du même nom (plusieurs dossiers, plusieurs thèmes) ----------
    // Un même exercice peut servir plusieurs thèmes : il existe alors sous le même nom dans plusieurs
    // dossiers (copie, ou création à la main). Quand on modifie la note ou les liens de l'un, on
    // propose d'appliquer la même modification aux autres — jamais automatiquement.
    function findSameNamedExercises(ex) {
        var inst = getActiveInstrument();
        var key = (ex.title || "").trim().toLowerCase();
        if (!inst || !key) return [];
        return collectExercises(inst, function (o) { return o.id !== ex.id && (o.title || "").trim().toLowerCase() === key; });
    }

    // Petit dialogue centré à choix, sur le modèle des menus contextuels.
    function openChoiceMenu(heading, message, choices) {
        closeFolderMenu();
        var backdrop = document.createElement("div");
        backdrop.className = "ctx-backdrop";
        function close() { closeFolderMenu(); }
        backdrop.addEventListener("pointerdown", function (e) { e.preventDefault(); close(); });
        var menu = document.createElement("div");
        menu.className = "ctx-menu ctx-menu-dialog";
        menu.setAttribute("role", "dialog");
        var h = document.createElement("div");
        h.className = "ctx-menu-title ctx-menu-title-wrap";
        h.textContent = heading;
        menu.appendChild(h);
        if (message) {
            var m = document.createElement("div");
            m.className = "ctx-menu-text";
            m.textContent = message;
            menu.appendChild(m);
        }
        choices.forEach(function (c) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "ctx-item" + (c.muted ? " ctx-item-muted" : "");
            b.textContent = c.text;
            b.addEventListener("click", function () { close(); if (c.onClick) c.onClick(); });
            menu.appendChild(b);
        });
        function onKey(e) { if (e.key === "Escape") close(); }
        document.body.appendChild(backdrop);
        document.body.appendChild(menu);
        document.addEventListener("keydown", onKey, true);
        openMenu = { backdrop: backdrop, menu: menu, onKey: onKey };
        var w = menu.offsetWidth || 300, hh = menu.offsetHeight || 160;
        menu.style.left = Math.max(8, (window.innerWidth - w) / 2) + "px";
        menu.style.top = Math.max(8, (window.innerHeight - hh) / 3) + "px";
    }

    // `needsApply(other)` : cet autre exercice serait-il réellement modifié ? (sinon on ne demande rien)
    // `apply(other)` : applique la modification.
    function askApplyToSameNamed(ex, question, needsApply, apply) {
        var others = findSameNamedExercises(ex).filter(function (r) { return needsApply(r.ex); });
        if (!others.length) return;
        var where = others.slice(0, 4).map(function (r) { return r.pathNames.join(" › "); }).join(", ") + (others.length > 4 ? "…" : "");
        openChoiceMenu(
            "« " + ex.title + " » existe aussi dans " + (others.length === 1 ? "un autre dossier" : others.length + " autres dossiers"),
            where + "\n" + question,
            [
                { text: others.length === 1 ? "Appliquer aussi à l'autre" : "Appliquer à tous (" + others.length + ")", onClick: function () {
                    others.forEach(function (r) { apply(r.ex); touchExercise(r.ex); });
                    save();
                    render();
                    showToast("Appliqué à " + others.length + " autre" + (others.length > 1 ? "s" : "") + " exercice" + (others.length > 1 ? "s" : "") + " « " + ex.title + " »");
                } },
                { text: "Seulement ici", muted: true }
            ]);
    }

    function hasLinkUrl(o, url) { return (o.links || []).some(function (l) { return l.url === url; }); }

    // Exercice lâché sur un dossier de l'arborescence : on demande s'il faut le déplacer ou le copier.
    function openExerciseDropMenu(x, y, ex, fromFolder, destFolder) {
        closeFolderMenu();
        if (destFolder === fromFolder) {
            showToast("« " + ex.title + " » est déjà dans « " + destFolder.name + " »");
            render();
            return;
        }
        var backdrop = document.createElement("div");
        backdrop.className = "ctx-backdrop";
        function cancel() { closeFolderMenu(); render(); }
        backdrop.addEventListener("pointerdown", function (e) { e.preventDefault(); cancel(); });
        backdrop.addEventListener("contextmenu", function (e) { e.preventDefault(); cancel(); });

        var menu = document.createElement("div");
        menu.className = "ctx-menu";
        menu.setAttribute("role", "menu");
        var heading = document.createElement("div");
        heading.className = "ctx-menu-title";
        heading.textContent = "« " + ex.title + " » → « " + destFolder.name + " »";
        menu.appendChild(heading);
        function choice(text, className, onClick) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "ctx-item" + (className ? " " + className : "");
            b.textContent = text;
            b.addEventListener("click", onClick);
            menu.appendChild(b);
        }
        choice("Déplacer ici", "", function () {
            closeFolderMenu();
            if (exerciseTitleTaken(destFolder.exercises, ex.title) && !confirmNameCollision("exercice", ex.title)) { render(); return; }
            fromFolder.exercises.splice(fromFolder.exercises.indexOf(ex), 1);
            destFolder.exercises.push(ex);
            save();
            render();
            showToast("« " + ex.title + " » déplacé vers « " + destFolder.name + " »");
        });
        choice("Copier ici", "", function () {
            closeFolderMenu();
            var copy = duplicateExercise(ex);
            // Dans un autre dossier, pas besoin du suffixe « (copie) » sauf si le nom y existe déjà.
            if (!exerciseTitleTaken(destFolder.exercises, ex.title)) copy.title = ex.title;
            destFolder.exercises.push(copy);
            save();
            render();
            showToast("« " + ex.title + " » copié dans « " + destFolder.name + " »");
        });
        choice("Annuler", "ctx-item-muted", cancel);

        function onKey(e) { if (e.key === "Escape") cancel(); }
        document.body.appendChild(backdrop);
        document.body.appendChild(menu);
        document.addEventListener("keydown", onKey, true);
        openMenu = { backdrop: backdrop, menu: menu, onKey: onKey };
        var w = menu.offsetWidth || 220, h = menu.offsetHeight || 130;
        menu.style.left = Math.min(Math.max(8, x + 6), Math.max(8, window.innerWidth - w - 8)) + "px";
        menu.style.top = Math.min(Math.max(8, y - 20), Math.max(8, window.innerHeight - h - 8)) + "px";
    }

    function bindLinkMenu(el, ex, link) {
        bindContextGesture(el, function (x, y) { openLinkMenu(x, y, ex, link); });
    }

    // Clic droit / appui long sur un lien : le désigner comme LE lien mis en avant dans la barre
    // de l'exercice (voir renderExercise), pour y accéder sans déplier les détails. Sans lien mis
    // en avant, la barre propose tous les liens regroupés sous un seul bouton.
    function openLinkMenu(x, y, ex, link) {
        closeFolderMenu();

        var backdrop = document.createElement("div");
        backdrop.className = "ctx-backdrop";
        backdrop.addEventListener("pointerdown", function (e) { e.preventDefault(); closeFolderMenu(); });
        backdrop.addEventListener("contextmenu", function (e) { e.preventDefault(); closeFolderMenu(); });

        var menu = document.createElement("div");
        menu.className = "ctx-menu";
        menu.setAttribute("role", "menu");
        menu.addEventListener("contextmenu", function (e) { e.preventDefault(); });

        function menuButton(text, className, onClick) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "ctx-item" + (className ? " " + className : "");
            b.textContent = text;
            var armed = false;
            b.addEventListener("pointerdown", function () { armed = true; });
            b.addEventListener("click", function (e) {
                if (!armed && e.detail !== 0) return;
                armed = false;
                onClick();
            });
            return b;
        }

        function place() {
            var w = menu.offsetWidth || 200;
            var h = menu.offsetHeight || 100;
            var left = Math.min(Math.max(8, x + 6), Math.max(8, window.innerWidth - w - 8));
            var top = Math.min(Math.max(8, y + 6), Math.max(8, window.innerHeight - h - 8));
            menu.style.left = left + "px";
            menu.style.top = top + "px";
        }

        var title = document.createElement("div");
        title.className = "ctx-title";
        title.textContent = link.label;
        menu.appendChild(title);

        var isPinned = ex.pinnedLinkId === link.id;
        menu.appendChild(menuButton(isPinned ? "Ne plus mettre en avant" : "Mettre en avant dans la barre", "", function () {
            ex.pinnedLinkId = isPinned ? null : link.id;
            save();
            closeFolderMenu();
            render();
        }));

        function onKey(e) { if (e.key === "Escape") closeFolderMenu(); }

        document.body.appendChild(backdrop);
        document.body.appendChild(menu);
        document.addEventListener("keydown", onKey, true);
        openMenu = { backdrop: backdrop, menu: menu, onKey: onKey };
        place();
    }

    // Glisser-déposer façon "réorganiser des applications sur un téléphone" : une copie flottante
    // de l'élément (le "fantôme") suit le pointeur au pixel près, pendant que les AUTRES éléments
    // de la liste glissent doucement vers leur nouvelle place (technique FLIP : on capture leurs
    // positions avant le déplacement DOM, puis on anime depuis cette position vers la nouvelle au
    // lieu de les laisser sauter instantanément). L'élément d'origine reste à sa place dans le DOM
    // (pour que le tri final reste simple à lire) mais s'efface visuellement derrière le fantôme.
    // `opts.onDropOnTarget(el, folderId, x, y)` (facultatif) : permet de déposer l'élément sur une
    // ligne portant data-drop-folder-id (dossier de l'arborescence de gauche) au lieu de le
    // réordonner dans sa liste. Un seul glisser est actif à la fois : activeDragFinish permet à des
    // écouteurs sur la fenêtre de TOUJOURS le terminer (relâchement hors de la liste, perte du focus
    // de la fenêtre…), sans quoi la copie flottante restait affichée au milieu de la page.
    var activeDragFinish = null;
    function endActiveDrag() { if (activeDragFinish) activeDragFinish(); }
    window.addEventListener("pointerup", endActiveDrag);
    window.addEventListener("pointercancel", endActiveDrag);
    window.addEventListener("blur", endActiveDrag);
    function clearDropHover() {
        Array.prototype.forEach.call(document.querySelectorAll(".drop-hover"), function (el) { el.classList.remove("drop-hover"); });
    }

    function setupDragReorder(container, itemSelector, getArray, axis, opts) {
        var dragEl = null;
        var hoverTarget = null;
        var ghost = null;
        var startX = 0, startY = 0;
        var grabOffsetX = 0, grabOffsetY = 0;
        var moved = false;

        function directChildren() {
            return Array.prototype.filter.call(container.children, function (el) { return el.matches(itemSelector); });
        }

        function captureRects(list) {
            var map = {};
            list.forEach(function (el) { map[el.dataset.reorderId] = el.getBoundingClientRect(); });
            return map;
        }

        function flipSiblings(before) {
            var movable = directChildren().filter(function (el) { return el !== dragEl; });
            movable.forEach(function (el) {
                var a = before[el.dataset.reorderId];
                var b = el.getBoundingClientRect();
                if (!a) return;
                var dx = a.left - b.left, dy = a.top - b.top;
                if (!dx && !dy) return;
                el.style.transition = "none";
                el.style.transform = "translate(" + dx + "px," + dy + "px)";
                // Force le navigateur à appliquer cette position AVANT de retirer la transformation,
                // sinon les deux affectations sont fusionnées et l'élément saute directement à sa
                // position finale sans jamais être animé.
                el.getBoundingClientRect();
                el.style.transition = "transform .18s ease";
                el.style.transform = "";
                el.addEventListener("transitionend", function cleanup() {
                    el.style.transition = "";
                    el.removeEventListener("transitionend", cleanup);
                });
            });
        }

        container.addEventListener("pointerdown", function (e) {
            if (e.button !== undefined && e.button !== 0) return; // clic droit : menu contextuel, pas de glisser
            // Les boutons/champs internes (chevron, "+", saisie) gardent leur propre clic.
            if (e.target.closest("button, input, textarea, select")) return;
            var item = e.target.closest(itemSelector);
            if (!item || item.parentNode !== container) return; // seuls les enfants directs de CE niveau sont concernés
            // Empêche la sélection de texte que la souris (ou le doigt) déclenche sinon dès qu'on
            // bouge un peu avant le seuil des 10 px — le CSS `user-select: none` seul ne suffit pas
            // toujours (Safari notamment) une fois un vrai geste de glisser commencé.
            e.preventDefault();
            dragEl = item;
            startX = e.clientX;
            startY = e.clientY;
            moved = false;
            window.addEventListener("pointermove", onMove);
            // Pas de capture du pointeur ici : dans un vrai navigateur, capturer dès l'appui
            // redirige le "click" final vers le nœud entier, ce qui rendait inopérants le
            // chevron, le "+" et le clic sur un sous-dossier. On ne capture qu'une fois le
            // glisser réellement commencé (seuil de 10 px), voir pointermove.
        });

        // Écouté sur la fenêtre pendant un glisser (ajouté au pointerdown, retiré dans finish) : replacer
        // l'élément dans la liste (insertBefore) lui fait perdre la capture du pointeur, et les
        // mouvements suivants n'atteignaient plus la liste dès que la souris en sortait — le glisser
        // restait alors figé, copie flottante comprise.
        function onMove(e) {
            if (!dragEl) return;
            if (!moved && e.buttons === 0 && e.pointerType === "mouse") { dragEl = null; window.removeEventListener("pointermove", onMove); return; } // relâché hors de la zone
            var delta = axis === "x" ? (e.clientX - startX) : (e.clientY - startY);
            if (!moved && Math.abs(delta) < 10) return;
            if (!moved) {
                try { dragEl.setPointerCapture(e.pointerId); } catch (err) {}
                moved = true;
                var startRect = dragEl.getBoundingClientRect();
                grabOffsetX = startX - startRect.left;
                grabOffsetY = startY - startRect.top;
                ghost = dragEl.cloneNode(true);
                ghost.className = dragEl.className + " drag-ghost";
                ghost.style.position = "fixed";
                ghost.style.left = startRect.left + "px";
                ghost.style.top = startRect.top + "px";
                ghost.style.width = startRect.width + "px";
                ghost.style.height = startRect.height + "px";
                ghost.style.margin = "0";
                ghost.style.pointerEvents = "none";
                Array.prototype.forEach.call(document.querySelectorAll(".drag-ghost"), function (g) { g.remove(); });
                document.body.appendChild(ghost);
                dragEl.classList.add("dragging");
                activeDragFinish = finish;
            }
            ghost.style.left = (e.clientX - grabOffsetX) + "px";
            ghost.style.top = (e.clientY - grabOffsetY) + "px";

            // Au-dessus d'un dossier de l'arborescence : on le met en évidence et on ne réordonne plus.
            if (opts && opts.onDropOnTarget) {
                var under = document.elementFromPoint ? document.elementFromPoint(e.clientX, e.clientY) : null;
                var target = under && under.closest ? under.closest("[" + ((opts && opts.dropAttr) || "data-drop-folder-id") + "]") : null;
                if (target !== hoverTarget) {
                    clearDropHover();
                    hoverTarget = target;
                    if (target) target.classList.add("drop-hover");
                }
                if (hoverTarget) return;
            }

            var items = directChildren();
            var siblings = items.filter(function (el) { return el !== dragEl; });
            var before = captureRects(siblings);
            var nextItem = items[items.indexOf(dragEl) + 1] || null;
            for (var i = 0; i < siblings.length; i++) {
                var rect = siblings[i].getBoundingClientRect();
                var mid = axis === "x" ? (rect.left + rect.width / 2) : (rect.top + rect.height / 2);
                var pos = axis === "x" ? e.clientX : e.clientY;
                if (pos < mid) {
                    if (nextItem !== siblings[i]) { // ne replace l'élément que si l'ordre change réellement
                        container.insertBefore(dragEl, siblings[i]);
                        flipSiblings(before);
                    }
                    return;
                }
            }
            if (nextItem !== null) {
                container.appendChild(dragEl);
                flipSiblings(before);
            }
        }

        // `arr` peut être un tableau d'objets {id, ...} (dossiers, exercices) ou directement un
        // tableau d'identifiants bruts (l'ordre des chapitres, réels + virtuels — voir pinnedOrder).
        function idOf(x) { return (x && typeof x === "object") ? x.id : x; }

        function finish() {
            window.removeEventListener("pointermove", onMove);
            if (activeDragFinish === finish) activeDragFinish = null;
            if (ghost) { ghost.remove(); ghost = null; }
            Array.prototype.forEach.call(document.querySelectorAll(".drag-ghost"), function (g) { g.remove(); });
            var dropTarget = hoverTarget;
            hoverTarget = null;
            clearDropHover();
            if (dragEl && moved && dropTarget && opts && opts.onDropOnTarget) {
                var droppedEl = dragEl;
                dragEl.classList.remove("dragging");
                dragEl = null;
                moved = false;
                // Relâché sur une autre ligne : aucun clic ne suit sur celle-ci, le drapeau ne serait
                // jamais consommé et avalerait le prochain vrai clic — d'où la remise à zéro différée.
                suppressNextClick = true;
                setTimeout(function () { suppressNextClick = false; }, 60);
                var r = dropTarget.getBoundingClientRect();
                opts.onDropOnTarget(droppedEl, dropTarget.getAttribute((opts && opts.dropAttr) || "data-drop-folder-id"), r.right, r.top + r.height / 2);
                return;
            }
            if (dragEl && moved) {
                var arr = getArray();
                var order = directChildren().map(function (el) { return el.dataset.reorderId; });
                // Un élément absent du DOM (par ex. un exercice archivé, masqué de cette vue) doit
                // rester à sa place relative en fin de liste, pas être renvoyé en tête : indexOf
                // renvoyant -1 pour tous, on les glisse explicitement après tout élément trouvé.
                arr.sort(function (a, b) {
                    var ia = order.indexOf(idOf(a)), ib = order.indexOf(idOf(b));
                    if (ia === -1 && ib === -1) return 0;
                    if (ia === -1) return 1;
                    if (ib === -1) return -1;
                    return ia - ib;
                });
                dragEl.classList.remove("dragging");
                suppressNextClick = true;
                save();
                render();
            }
            dragEl = null;
            moved = false;
        }

        container.addEventListener("pointerup", finish);
        container.addEventListener("pointercancel", finish);
    }

    // ---------- rendering ----------

    var $instrumentSelect = document.getElementById("instrument-select");
    var $renameInstrumentBtn = document.getElementById("rename-instrument-btn");
    var $chapterBar = document.getElementById("chapter-bar");
    var $sidebarTree = document.getElementById("sidebar-tree");
    var $breadcrumb = document.getElementById("breadcrumb");
    var $contentHeading = document.getElementById("content-heading");
    var $folderContainer = document.getElementById("folder-container");
    var $empty = document.getElementById("empty-state");
    var $searchRow = document.getElementById("search-row");
    var $searchInput = document.getElementById("search-input");
    var $searchToggleBtn = document.getElementById("search-toggle-btn");
    var $searchCloseBtn = document.getElementById("search-close-btn");
    var $undoBtn = document.getElementById("undo-btn");
    var $redoBtn = document.getElementById("redo-btn");

    // ---------- largeur réglable du bandeau gauche (ordinateur) ----------
    // Réglage propre à chaque appareil (taille d'écran différente) : gardé en localStorage, pas
    // synchronisé. La zone principale s'adapte d'elle-même (flex: 1).
    // Bandeau des dossiers masquable (ordinateur) : plus de place pour la session, le métronome, les vidéos
    // et les images. Choix retenu sur cet appareil.
    var SIDEBAR_HIDDEN_KEY = "trainhub.sidebarHidden.v1";
    (function initSidebarToggle() {
        var btn = document.getElementById("sidebar-toggle-btn");
        function isHidden() { try { return localStorage.getItem(SIDEBAR_HIDDEN_KEY) === "1"; } catch (e) { return false; } }
        function apply(hidden) {
            document.documentElement.classList.toggle("sidebar-hidden", hidden);
            if (btn) btn.setAttribute("aria-pressed", hidden ? "true" : "false");
            try { localStorage.setItem(SIDEBAR_HIDDEN_KEY, hidden ? "1" : "0"); } catch (e) {}
        }
        apply(isHidden());
        if (btn) btn.addEventListener("click", function () { apply(!document.documentElement.classList.contains("sidebar-hidden")); });
        document.addEventListener("keydown", function (e) {
            if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "b") return;
            var t = e.target, tag = t && t.tagName ? t.tagName.toLowerCase() : "";
            if (tag === "input" || tag === "textarea" || tag === "select" || (t && t.isContentEditable)) return;
            e.preventDefault();
            apply(!document.documentElement.classList.contains("sidebar-hidden"));
        });
    })();

    var SIDEBAR_WIDTH_KEY = "trainhub.sidebarWidth";
    var SIDEBAR_DEFAULT = 280, SIDEBAR_MIN = 200, SIDEBAR_MAX = 560;
    var $sidebarResizer = document.getElementById("sidebar-resizer");

    function applySidebarWidth(w) {
        w = Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)));
        document.documentElement.style.setProperty("--sidebar-width", w + "px");
        return w;
    }

    (function initSidebarResizer() {
        var stored = null;
        try { stored = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY), 10); } catch (e) {}
        applySidebarWidth(stored || SIDEBAR_DEFAULT);
        if (!$sidebarResizer) return;

        var dragging = false;
        var current = stored || SIDEBAR_DEFAULT;

        $sidebarResizer.addEventListener("pointerdown", function (e) {
            if (e.button !== undefined && e.button !== 0) return;
            e.preventDefault();
            dragging = true;
            try { $sidebarResizer.setPointerCapture(e.pointerId); } catch (err) {}
            document.body.classList.add("resizing-sidebar");
        });
        $sidebarResizer.addEventListener("pointermove", function (e) {
            if (!dragging) return;
            var left = $sidebarTree.getBoundingClientRect().left;
            current = applySidebarWidth(e.clientX - left);
        });
        function stop() {
            if (!dragging) return;
            dragging = false;
            document.body.classList.remove("resizing-sidebar");
            try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(current)); } catch (err) {}
        }
        $sidebarResizer.addEventListener("pointerup", stop);
        $sidebarResizer.addEventListener("pointercancel", stop);
        $sidebarResizer.addEventListener("dblclick", function () {
            current = applySidebarWidth(SIDEBAR_DEFAULT);
            try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(current)); } catch (err) {}
        });
        // Clavier : flèches gauche/droite pour ajuster finement.
        $sidebarResizer.tabIndex = 0;
        $sidebarResizer.addEventListener("keydown", function (e) {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            current = applySidebarWidth(current + (e.key === "ArrowRight" ? 20 : -20));
            try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(current)); } catch (err) {}
        });
    })();

    if ($searchInput) {
        $searchInput.addEventListener("input", function () {
            searchQuery = $searchInput.value;
            render();
        });
    }

    // ---------- recherche repliable (loupe en haut à droite) ----------
    function openSearch() {
        $searchRow.hidden = false;
        $searchToggleBtn.classList.add("active");
        $searchInput.focus();
    }
    function closeSearch() {
        $searchRow.hidden = true;
        $searchToggleBtn.classList.remove("active");
        clearFilters();
        render();
    }
    if ($searchToggleBtn) {
        $searchToggleBtn.addEventListener("click", function () {
            if ($searchRow.hidden) openSearch(); else closeSearch();
        });
    }
    if ($searchCloseBtn) $searchCloseBtn.addEventListener("click", closeSearch);
    if ($searchInput) {
        $searchInput.addEventListener("keydown", function (e) {
            if (e.key === "Escape") closeSearch();
        });
    }

    if ($undoBtn) $undoBtn.addEventListener("click", undo);
    if ($redoBtn) $redoBtn.addEventListener("click", redo);
    // Comme dans un gestionnaire de fichiers (Ctrl/Cmd+Maj+N) : ajoute un sous-dossier au dossier
    // actuellement ouvert, sans bouton dédié à l'écran (voir aussi le clic droit/appui long sur le
    // titre du dossier, qui ouvre le même menu — bindFolderMenu dans renderContentHeading).
    function addSubfolderToCurrentFolder() {
        var inst = getActiveInstrument();
        if (!inst) return;
        var path = getNavPath(inst);
        if (path[0] === FAVORITES_ID || path[0] === ARCHIVED_ID) return;
        var nodes = resolvePath(inst, path);
        var currentFolder = nodes[nodes.length - 1];
        if (!currentFolder) return;
        var ancestorPath = path.slice(0, -1);
        openFolderMenu(window.innerWidth / 2, window.innerHeight / 2,
            function () { return getParentArrayFor(inst, ancestorPath); }, currentFolder, inst, "addSub");
    }

    document.addEventListener("keydown", function (e) {
        if (!(e.ctrlKey || e.metaKey)) return;
        var key = e.key.toLowerCase();
        if (key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
        else if (key === "y" || (key === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
        else if (key === "n" && e.shiftKey) { e.preventDefault(); addSubfolderToCurrentFolder(); }
    });
    resetHistory();

    function render() {
        flushPendingTextSaves();
        var inst = getActiveInstrument();
        var path = inst ? getNavPath(inst) : [];
        var rootChapter = inst && path.length ? findById(inst.categories, path[0]) : null;
        var accent = path[0] === FAVORITES_ID ? "#ffd60a" : path[0] === ARCHIVED_ID ? "#9ca3af" : ((rootChapter && rootChapter.color) || "#00e676");
        document.documentElement.style.setProperty("--chapter-accent", accent);
        document.documentElement.style.setProperty("--tree-font-scale", state.settings.appearance.treeFontScale);
        DENSITIES.forEach(function (d) { document.documentElement.classList.toggle("density-" + d, state.settings.appearance.density === d); });
        renderInstrumentSelect();
        renderChapterBar();
        renderSidebarTree();
        renderMain();
        updateUndoRedoButtons();
        autoGrowAllNotes();
        autoSizeAllExerciseTitles();
    }

    function renderInstrumentSelect() {
        $instrumentSelect.innerHTML = "";
        state.instruments.forEach(function (inst) {
            var opt = document.createElement("option");
            opt.value = inst.id;
            opt.textContent = inst.name;
            if (inst.id === state.activeInstrumentId) opt.selected = true;
            $instrumentSelect.appendChild(opt);
        });
    }

    function renameInstrument(instrumentId) {
        var inst = state.instruments.filter(function (i) { return i.id === instrumentId; })[0];
        if (!inst) return;
        var name = window.prompt("Renommer l'espace (laisser vide pour le supprimer) :", inst.name);
        if (name === null) return;
        name = name.trim();
        if (!name) {
            if (state.instruments.length <= 1) return;
            if (!window.confirm("Supprimer l'espace « " + inst.name + " », tous ses exercices et ses sessions ?")) return;
            state.instruments = state.instruments.filter(function (i) { return i.id !== instrumentId; });
            state.settings.guidedSessions = state.settings.guidedSessions.filter(function (gs) { return gs.instrumentId !== instrumentId; });
            state.settings.sessionFolders = state.settings.sessionFolders.filter(function (f) { return f.instrumentId !== instrumentId; });
            delete navPaths[instrumentId];
            if (state.activeInstrumentId === instrumentId) state.activeInstrumentId = state.instruments[0].id;
        } else {
            inst.name = name;
        }
        save();
        render();
    }

    // Construit une puce/ligne pour un chapitre VIRTUEL (Favoris, Archivés) : couleur fixe, pas de
    // renommer/supprimer, mais glissable au même titre que les vrais chapitres (voir pinnedOrder).
    function virtualChapterMeta(kind) {
        if (kind === ARCHIVED_ID) return { id: ARCHIVED_ID, name: "Archivés", color: "#9ca3af", icon: ARCHIVE_ICON_SVG, cls: "virtual-archived" };
        return { id: FAVORITES_ID, name: "Favoris", color: "#ffd60a", icon: STAR_FILLED_SVG, cls: "virtual-favorites" };
    }

    function orderedChapterItems(inst) {
        normalizePinnedOrder(inst);
        return inst.pinnedOrder.map(function (id) {
            if (id === FAVORITES_ID || id === ARCHIVED_ID) return virtualChapterMeta(id);
            return findById(inst.categories, id);
        }).filter(Boolean);
    }

    function renderChapterBar() {
        var inst = getActiveInstrument();
        $chapterBar.innerHTML = "";
        var path = getNavPath(inst);
        var activeId = path[0];

        orderedChapterItems(inst).forEach(function (item) {
            var isVirtual = item.id === FAVORITES_ID || item.id === ARCHIVED_ID;
            var isActive = item.id === activeId;
            var chip = document.createElement("div");
            chip.className = "chapter-chip" + (isVirtual ? " " + item.cls : "") + (isActive ? " active" : "");
            chip.dataset.reorderId = item.id;

            if (isVirtual) {
                var icon = document.createElement("span");
                icon.className = "chapter-chip-star";
                icon.innerHTML = item.icon;
                chip.appendChild(icon);
            } else {
                // Encadré fin + fond très léger dans la couleur du chapitre, toujours visible (pas
                // seulement actif) : remplace le point de couleur, jugé pas assez discret.
                chip.style.borderColor = item.color;
                chip.style.background = "color-mix(in srgb, " + item.color + " " + (isActive ? "16%" : "7%") + ", transparent)";
            }

            var label = document.createElement("span");
            label.className = "chapter-chip-label";
            label.textContent = item.name;
            if (isActive && !isVirtual) label.style.color = item.color;
            chip.appendChild(label);

            if (!isVirtual) {
                chip.title = "Clic droit (ordinateur) ou appui long (mobile) : renommer / supprimer";
                bindFolderMenu(chip, function () { return getActiveInstrument().categories; }, item, inst);
            }

            chip.addEventListener("click", function (e) {
                if (suppressNextClick) { suppressNextClick = false; return; }
                clearFilters();
                setNavPath(inst, [item.id]);
                render();
            });

            $chapterBar.appendChild(chip);
        });

        setupDragReorder($chapterBar, ".chapter-chip", function () { return getActiveInstrument().pinnedOrder; }, "x");

        var addBtn = iconButton("+", "Ajouter un grand chapitre", function () {
            var name = window.prompt("Nom du nouveau chapitre (ex : Technique, Morceaux, Gammes...) :");
            if (!name) return;
            name = name.trim();
            if (!name) return;
            var chapter = makeFolder(name, currentPalette()[inst.categories.length % currentPalette().length]);
            inst.categories.push(chapter);
            clearFilters();
            setNavPath(inst, [chapter.id]);
            save();
            render();
        });
        $chapterBar.appendChild(addBtn);
    }

    function getParentArrayFor(inst, ancestorPath) {
        if (!ancestorPath.length) return inst.categories;
        var nodes = resolvePath(inst, ancestorPath);
        var parent = nodes[nodes.length - 1];
        return parent ? parent.folders : inst.categories;
    }

    // ---------- arborescence latérale (ordinateur) ----------
    // Vue complète et permanente du même modèle de données que le bandeau/fil d'Ariane mobiles :
    // aucune nouvelle notion de navigation, juste une autre façon de l'afficher côte à côte plutôt
    // qu'un niveau à la fois. `treeExpanded` ne pilote que l'affichage (replié/déplié), jamais les
    // données elles-mêmes.

    // Chapitre virtuel dans l'arborescence : même enveloppe `.tree-node` que les vrais chapitres
    // (dataset.reorderId = son id virtuel) pour glisser dans la même liste, mais pas de sous-
    // niveau, pas de menu (rien à renommer/supprimer/ajouter dessous).
    function renderVirtualTreeNode(inst, kind, currentPath) {
        var meta = virtualChapterMeta(kind);
        var wrap = document.createElement("div");
        wrap.className = "tree-node " + meta.cls;
        wrap.dataset.reorderId = meta.id;

        var row = document.createElement("div");
        row.className = "tree-row tree-row-fixed tree-row-d0 " + meta.cls + (currentPath[0] === meta.id ? " selected" : "");
        var icon = document.createElement("span");
        icon.className = "tree-fixed-icon";
        icon.innerHTML = meta.icon;
        row.appendChild(icon);
        var label = document.createElement("span");
        label.className = "tree-label";
        label.textContent = meta.name;
        row.appendChild(label);
        row.addEventListener("click", function (e) {
            if (suppressNextClick) { suppressNextClick = false; return; }
            clearFilters();
            setNavPath(inst, [meta.id]);
            render();
        });
        wrap.appendChild(row);
        return wrap;
    }

    function renderSidebarTree() {
        var inst = getActiveInstrument();
        $sidebarTree.innerHTML = "";
        if (!inst) return;

        var header = document.createElement("div");
        header.className = "sidebar-header";
        var title = document.createElement("span");
        title.className = "sidebar-title";
        title.textContent = inst.name;
        header.appendChild(title);
        $sidebarTree.appendChild(header);

        var path = getNavPath(inst);

        var list = document.createElement("div");
        list.className = "tree-list";
        orderedChapterItems(inst).forEach(function (item) {
            if (item.id === FAVORITES_ID || item.id === ARCHIVED_ID) {
                list.appendChild(renderVirtualTreeNode(inst, item.id, path));
            } else {
                list.appendChild(renderTreeNode(inst, item, [], path, item.color, 0));
            }
        });
        $sidebarTree.appendChild(list);
        setupDragReorder(list, ".tree-node", function () { return getActiveInstrument().pinnedOrder; }, "y");

        var addWrap = document.createElement("div");
        addWrap.className = "tree-add-row sidebar-add-chapter";
        var addInput = document.createElement("input");
        addInput.type = "text";
        addInput.className = "tree-add-input";
        addInput.placeholder = "Nouveau chapitre…";
        var addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "tree-add-btn";
        addBtn.textContent = "+";
        addBtn.title = "Ajouter le chapitre";
        function commitChapter() {
            var name = addInput.value.trim();
            if (!name) return;
            if (folderNameTaken(inst.categories, name) && !confirmNameCollision("chapitre", name)) return;
            var chapter = makeFolder(name, currentPalette()[inst.categories.length % currentPalette().length]);
            inst.categories.push(chapter);
            clearFilters();
            setNavPath(inst, [chapter.id]);
            save();
            render();
        }
        addBtn.addEventListener("click", commitChapter);
        addInput.addEventListener("keydown", function (e) { if (e.key === "Enter") commitChapter(); });
        addWrap.appendChild(addInput);
        addWrap.appendChild(addBtn);
        $sidebarTree.appendChild(addWrap);
    }

    function renderTreeNode(inst, folder, ancestorPath, currentPath, rootColor, depth) {
        var fullPath = ancestorPath.concat(folder.id);
        var isSelected = folder.id === currentPath[currentPath.length - 1];
        var hasChildren = folder.folders.length > 0;
        var expanded = treeExpanded[folder.id] !== false;
        // Profondeur plafonnée pour le style (au-delà, même apparence que le niveau 2) : la
        // hiérarchie se lit déjà par l'indentation, pas besoin d'un 6e style différent.
        var depthClass = "tree-row-d" + Math.min(depth, 2);

        var wrap = document.createElement("div");
        wrap.className = "tree-node";
        wrap.dataset.reorderId = folder.id;

        var row = document.createElement("div");
        row.className = "tree-row " + depthClass + (isSelected ? " selected" : "");
        row.dataset.dropFolderId = folder.id; // cible de dépôt d'un exercice glissé (voir setupDragReorder)

        var twisty = document.createElement("button");
        twisty.type = "button";
        twisty.className = "tree-twisty" + (hasChildren ? "" : " tree-twisty-empty") + (expanded ? " expanded" : "");
        twisty.tabIndex = hasChildren ? 0 : -1;
        twisty.setAttribute("aria-label", expanded ? "Replier" : "Déplier");
        twisty.innerHTML = CHEVRON_ICON_SVG;
        if (hasChildren) {
            twisty.addEventListener("click", function (e) {
                e.stopPropagation();
                treeExpanded[folder.id] = !expanded;
                render();
            });
        }
        row.appendChild(twisty);

        // Seuls les grands chapitres (niveau 0) portent la couleur du chapitre en permanence :
        // bordure gauche + fond très léger. Les sous-dossiers restent neutres (voir style.css,
        // différenciés par la taille/le poids et l'imbrication) pour que la couleur reste un
        // repère de chapitre, pas un habillage répété à chaque niveau. La sélection, elle, reste
        // visible à tous les niveaux via la couleur du chapitre courant (--chapter-accent).
        if (depth === 0) {
            row.style.borderLeft = "3px solid " + rootColor;
            row.style.background = "color-mix(in srgb, " + rootColor + " " + (isSelected ? "16%" : "5%") + ", transparent)";
        } else if (isSelected) {
            row.style.background = "color-mix(in srgb, " + rootColor + " 14%, transparent)";
        }

        var label = document.createElement("span");
        label.className = "tree-label";
        label.textContent = folder.name;
        row.appendChild(label);
        row.title = "Clic droit (ordinateur) ou appui long (mobile) : renommer / supprimer";
        bindFolderMenu(row, function () { return getParentArrayFor(getActiveInstrument(), ancestorPath); }, folder, inst);

        row.addEventListener("click", function (e) {
            if (suppressNextClick) { suppressNextClick = false; return; }
            clearFilters();
            setNavPath(inst, fullPath);
            render();
        });

        wrap.appendChild(row);

        // Pas de champ "Nouveau sous-dossier" en permanence dans l'arborescence : uniquement via
        // clic droit / appui long (ou Ctrl+Maj+N) sur le dossier, pour garder la barre latérale
        // épurée.
        if (expanded && hasChildren) {
            var childWrap = document.createElement("div");
            childWrap.className = "tree-children";
            folder.folders.forEach(function (child) {
                childWrap.appendChild(renderTreeNode(inst, child, fullPath, currentPath, rootColor, depth + 1));
            });
            wrap.appendChild(childWrap);
            setupDragReorder(childWrap, ".tree-node", function () { return folder.folders; }, "y");
        }

        return wrap;
    }

    function renderMain() {
        var inst = getActiveInstrument();
        $empty.hidden = true;
        if (guidedSessionViewActive) {
            $breadcrumb.hidden = true;
            $breadcrumb.innerHTML = "";
            renderGuidedSessionMain();
            return;
        }
        var path = getNavPath(inst);
        if (path[0] === FAVORITES_ID || path[0] === ARCHIVED_ID) {
            $breadcrumb.hidden = true;
            $breadcrumb.innerHTML = "";
            renderVirtualChapterView(inst, path[0]);
            return;
        }
        var hasFilter = !!searchQuery.trim();
        if (hasFilter) {
            $breadcrumb.hidden = true;
            $breadcrumb.innerHTML = "";
            $contentHeading.innerHTML = "";
            renderFilteredResults(inst);
        } else {
            $breadcrumb.hidden = false;
            renderFolderBrowser(inst);
        }
    }

    // Rendu partagé entre le filtre plein-texte (renderFilteredResults) et les favoris
    // (renderFavoritesView) : une liste à plat, avec le chemin réel de chaque exercice.
    // `grouped` (Favoris, Archivés, Étiquettes) : les exercices d'un même dossier sont rangés ensemble
    // sous un seul titre de dossier (les morceaux ensemble, la technique ensemble…), dans l'ordre des
    // chapitres de la barre latérale puis des dossiers ; dans un dossier, l'ordre de ses exercices.
    function renderGroupedResults(inst, results) {
        var chapterOrder = {};
        orderedChapterItems(inst).forEach(function (item, i) { chapterOrder[item.id] = i; });
        var groups = [], byFolder = {};
        results.forEach(function (r) {
            var g = byFolder[r.folder.id];
            if (!g) { g = byFolder[r.folder.id] = { first: r, items: [], rank: chapterOrder[r.pathIds[0]], seq: groups.length }; groups.push(g); }
            g.items.push(r);
        });
        groups.sort(function (a, b) {
            var ra = a.rank === undefined ? 1e9 : a.rank, rb = b.rank === undefined ? 1e9 : b.rank;
            return ra - rb || a.seq - b.seq;
        });
        groups.forEach(function (g) {
            var r = g.first;
            var section = document.createElement("div");
            section.className = "result-group";
            var rootChapter = findById(inst.categories, r.pathIds[0]);
            if (rootChapter && rootChapter.color) section.style.setProperty("--group-color", rootChapter.color);
            var title = document.createElement("button");
            title.type = "button";
            title.className = "result-group-title";
            title.textContent = r.pathNames.join(" › ");
            var count = document.createElement("span");
            count.className = "result-group-count";
            count.textContent = String(g.items.length);
            title.appendChild(count);
            title.title = "Aller à ce dossier";
            title.addEventListener("click", function () {
                clearFilters();
                setNavPath(inst, r.pathIds);
                render();
            });
            section.appendChild(title);
            g.items.forEach(function (item) {
                var wrap = document.createElement("div");
                wrap.className = "result-item result-item-grouped";
                wrap.appendChild(renderExercise(item.folder, item.ex, false));
                section.appendChild(wrap);
            });
            $folderContainer.appendChild(section);
        });
    }

    function renderResultsList(inst, results, emptyText, grouped) {
        $folderContainer.innerHTML = "";
        if (results.length === 0) {
            $empty.hidden = false;
            $empty.textContent = emptyText;
            return;
        }
        if (grouped) { renderGroupedResults(inst, results); return; }
        results.forEach(function (r) {
            var wrap = document.createElement("div");
            wrap.className = "result-item";

            var pathBtn = document.createElement("button");
            pathBtn.type = "button";
            pathBtn.className = "result-path";
            pathBtn.textContent = r.pathNames.join(" › ");
            pathBtn.title = "Aller à cet emplacement";
            pathBtn.addEventListener("click", function () {
                clearFilters();
                setNavPath(inst, r.pathIds);
                render();
            });
            wrap.appendChild(pathBtn);

            wrap.appendChild(renderExercise(r.folder, r.ex, false));
            $folderContainer.appendChild(wrap);
        });
    }

    // Favoris et Archivés partagent le même rendu : une liste à plat de tout l'instrument, avec le
    // chemin réel de chaque exercice (voir renderResultsList) — seuls le titre et le critère de
    // recherche changent.
    function renderVirtualChapterView(inst, kind) {
        $contentHeading.innerHTML = "";
        var h2 = document.createElement("h2");
        h2.textContent = kind === ARCHIVED_ID ? "Archivés" : "★ Favoris";
        $contentHeading.appendChild(h2);

        var results, emptyText;
        if (kind === ARCHIVED_ID) {
            results = collectExercises(inst, function (ex) { return ex.archived; });
            emptyText = "Aucun exercice archivé pour l'instant. Range-en un depuis son menu (clic droit ou appui long dessus).";
        } else {
            results = collectExercises(inst, function (ex) { return ex.favorite && !ex.archived; });
            emptyText = "Aucun favori pour l'instant. Marque un exercice en favori depuis son menu (clic droit ou appui long dessus).";
        }
        renderResultsList(inst, results, emptyText, true);
    }

    function renderContentHeading(folder, getParentArray, inst) {
        $contentHeading.innerHTML = "";
        if (!folder) return;
        var h2 = document.createElement("h2");
        h2.textContent = folder.name;
        h2.title = "Clic droit (ordinateur) ou appui long (mobile) : nouveau sous-dossier / renommer / supprimer";
        // Comme pour les lignes de l'arborescence : le menu complet (dont "Nouveau sous-dossier")
        // reste accessible sur le titre du dossier courant, sans bouton dédié à l'écran.
        bindFolderMenu(h2, getParentArray, folder, inst);
        $contentHeading.appendChild(h2);

        var editBtn = svgIconButton(PENCIL_ICON_SVG, "Renommer ce dossier", function () {
            var rect = editBtn.getBoundingClientRect();
            openFolderMenu(rect.left, rect.bottom, getParentArray, folder, inst, "rename");
        });
        editBtn.classList.add("heading-edit-btn");
        $contentHeading.appendChild(editBtn);
    }

    function renderBreadcrumb(inst, nodes) {
        $breadcrumb.innerHTML = "";
        nodes.forEach(function (node, i) {
            if (i > 0) {
                var sep = document.createElement("span");
                sep.className = "crumb-sep";
                sep.textContent = "›";
                $breadcrumb.appendChild(sep);
            }
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "crumb" + (i === nodes.length - 1 ? " crumb-current" : "");
            btn.textContent = node.name;
            btn.addEventListener("click", function () {
                setNavPath(inst, nodes.slice(0, i + 1).map(function (n) { return n.id; }));
                render();
            });
            $breadcrumb.appendChild(btn);
        });
    }

    function renderFolderBrowser(inst) {
        var path = getNavPath(inst);
        var nodes = resolvePath(inst, path);
        if (nodes.length !== path.length) {
            path = nodes.map(function (n) { return n.id; });
            setNavPath(inst, path);
        }

        if (nodes.length === 0) {
            $breadcrumb.innerHTML = "";
            $contentHeading.innerHTML = "";
            $folderContainer.innerHTML = "";
            $empty.hidden = false;
            $empty.textContent = "Crée ton premier chapitre ci-dessus.";
            return;
        }

        renderBreadcrumb(inst, nodes);

        var currentFolder = nodes[nodes.length - 1];
        var depth = nodes.length;

        renderContentHeading(currentFolder, function () { return getParentArrayFor(inst, path.slice(0, -1)); }, inst);
        $folderContainer.innerHTML = "";

        // Sous-dossiers du dossier courant, dans le MÊME ordre que l'arborescence de gauche (même
        // tableau de données) : la zone principale reflète exactement la branche sélectionnée.
        var foldersGroup = document.createElement("div");
        foldersGroup.className = "section-group folders-group";
        if (currentFolder.folders.length) {
            var foldersLabel = document.createElement("div");
            foldersLabel.className = "section-label";
            foldersLabel.textContent = "Sous-dossiers";
            foldersGroup.appendChild(foldersLabel);
            var foldersWrap = document.createElement("div");
            foldersWrap.className = "folders-wrap";
            currentFolder.folders.forEach(function (f, idx) {
                foldersWrap.appendChild(renderFolderRow(inst, currentFolder.folders, f, idx, currentFolder.folders.length, path));
            });
            foldersGroup.appendChild(foldersWrap);
            setupDragReorder(foldersWrap, ".folder-row", function () { return currentFolder.folders; }, "y");
        }
        if (depth < MAX_FOLDER_DEPTH) {
            foldersGroup.appendChild(renderAddFolderForm(currentFolder));
        } else {
            // Sans ce message, le "+" disparaît simplement sans explication — on dirait un bug plutôt
            // qu'une limite volontaire (profondeur maximale des dossiers imbriqués).
            var depthNote = document.createElement("div");
            depthNote.className = "folder-depth-limit-note";
            depthNote.textContent = "Profondeur maximale atteinte (" + MAX_FOLDER_DEPTH + " niveaux) : pas de nouveau sous-dossier ici.";
            foldersGroup.appendChild(depthNote);
        }

        var exGroup = document.createElement("div");
        exGroup.className = "section-group exercises-group";
        if (currentFolder.folders.length) {
            var exLabel = document.createElement("div");
            exLabel.className = "section-label";
            exLabel.textContent = "Exercices";
            exGroup.appendChild(exLabel);
        }
        var exercisesWrap = document.createElement("div");
        exercisesWrap.className = "exercises-wrap";
        // Les exercices archivés sont rangés hors de la vue normale (voir le filtre "Archivés"
        // dans la recherche) ; ils restent dans le tableau réel, juste absents de ce rendu — voir
        // le commentaire dans setupDragReorder() sur les éléments absents du DOM lors d'un glisser.
        var allVisible = currentFolder.exercises.filter(function (ex) { return !ex.archived; });
        var view = loadExView();
        var shown = applyExView(allVisible, view);
        if (allVisible.length > 1) exGroup.appendChild(renderExViewBar(view, shown.length, allVisible.length));
        shown.forEach(function (ex) {
            exercisesWrap.appendChild(renderExercise(currentFolder, ex, true));
        });
        if (!shown.length && allVisible.length) {
            var none = document.createElement("div");
            none.className = "gs-empty";
            none.textContent = "Aucun exercice ne correspond aux filtres.";
            exercisesWrap.appendChild(none);
        }
        exGroup.appendChild(exercisesWrap);
        // Réordonner à la main n'a de sens que dans l'ordre manuel et sans filtre : sinon l'ordre affiché
        // n'est pas l'ordre réel.
        if (exViewIsDefault(view)) setupDragReorder(exercisesWrap, ".exercise", function () { return currentFolder.exercises; }, "y", {
            onDropOnTarget: function (el, destFolderId, x, y) {
                var ex = currentFolder.exercises.filter(function (e) { return e.id === el.dataset.reorderId; })[0];
                var dest = findFolderById(getActiveInstrument(), destFolderId);
                if (ex && dest) openExerciseDropMenu(x, y, ex, currentFolder, dest);
                else render();
            }
        });
        exGroup.appendChild(renderAddExerciseForm(currentFolder));

        // Disposition réglable dans les paramètres généraux : verticale (sous-dossiers au-dessus
        // des exercices, comme avant) ou horizontale façon Finder (sous-dossiers dans une colonne à
        // GAUCHE, comme la barre latérale du vrai Finder macOS, exercices dans le panneau principal
        // à droite).
        var horizontal = state.settings.appearance.mainLayout === "horizontal";
        var mainWrap = document.createElement("div");
        mainWrap.className = "folder-browser " + (horizontal ? "folder-browser-horizontal" : "folder-browser-vertical");
        mainWrap.appendChild(foldersGroup);
        mainWrap.appendChild(exGroup);
        $folderContainer.appendChild(mainWrap);
    }

    // ---------- tri et filtres de la liste d'exercices ----------
    // Réglage d'affichage propre à l'appareil (pas dans les données) : tri + filtres, valables pour tous
    // les dossiers. « Manuel » = l'ordre choisi à la main (glisser-déposer).
    var EX_VIEW_KEY = "trainhub.exView.v1";
    var EX_SORTS = [["manual", "Ordre manuel"], ["az", "A → Z"], ["za", "Z → A"], ["created-desc", "Création : récents d'abord"], ["created-asc", "Création : anciens d'abord"], ["updated", "Modifiés récemment"]];
    function loadExView() {
        var v = {};
        try { v = JSON.parse(localStorage.getItem(EX_VIEW_KEY)) || {}; } catch (e) {}
        return {
            sort: EX_SORTS.some(function (s) { return s[0] === v.sort; }) ? v.sort : "manual",
            att: ["with", "without"].indexOf(v.att) !== -1 ? v.att : "",       // pièces jointes (liens, fichiers, images)
            notes: ["with", "without"].indexOf(v.notes) !== -1 ? v.notes : "",
            video: v.video === true,
            fav: v.fav === true
        };
    }
    function saveExView(v) { try { localStorage.setItem(EX_VIEW_KEY, JSON.stringify(v)); } catch (e) {} }
    function exViewIsDefault(v) { return v.sort === "manual" && !v.att && !v.notes && !v.video && !v.fav; }
    function exCreatedAt(ex) { return ex.createdAt || parseInt(String(ex.id).slice(0, 8), 36) || 0; } // l'id commence par l'horodatage de création
    function exHasAttachments(ex) { return (ex.links || []).length + (ex.files || []).length + (ex.images || []).length > 0; }
    function applyExView(list, v) {
        var out = list.filter(function (ex) {
            if (v.fav && !ex.favorite) return false;
            if (v.att === "with" && !exHasAttachments(ex)) return false;
            if (v.att === "without" && exHasAttachments(ex)) return false;
            var hasNotes = !!(ex.notes && ex.notes.trim());
            if (v.notes === "with" && !hasNotes) return false;
            if (v.notes === "without" && hasNotes) return false;
            if (v.video && !(ex.links || []).some(function (l) { return !!youTubeVideoInfo(l.url); })) return false;
            return true;
        });
        var cmp = {
            az: function (a, b) { return a.title.localeCompare(b.title, "fr", { sensitivity: "base", numeric: true }); },
            za: function (a, b) { return b.title.localeCompare(a.title, "fr", { sensitivity: "base", numeric: true }); },
            "created-desc": function (a, b) { return exCreatedAt(b) - exCreatedAt(a); },
            "created-asc": function (a, b) { return exCreatedAt(a) - exCreatedAt(b); },
            updated: function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); }
        }[v.sort];
        if (cmp) out.sort(cmp);
        return out;
    }
    function renderExViewBar(view, shownCount, totalCount) {
        var bar = document.createElement("div");
        bar.className = "ex-view-bar";
        function change(patch) { var nv = Object.assign({}, view, patch); saveExView(nv); render(); }
        function sel(label, options, value, key) {
            var s = document.createElement("select");
            s.setAttribute("aria-label", label);
            s.title = label;
            options.forEach(function (o) {
                var op = document.createElement("option");
                op.value = o[0]; op.textContent = o[1];
                if (o[0] === value) op.selected = true;
                s.appendChild(op);
            });
            s.addEventListener("change", function () { var p = {}; p[key] = s.value; change(p); });
            return s;
        }
        bar.appendChild(sel("Tri", EX_SORTS, view.sort, "sort"));
        bar.appendChild(sel("Pièces jointes", [["", "PJ : toutes"], ["with", "Avec PJ"], ["without", "Sans PJ"]], view.att, "att"));
        bar.appendChild(sel("Notes", [["", "Notes : toutes"], ["with", "Avec notes"], ["without", "Sans notes"]], view.notes, "notes"));
        function chip(text, on, key) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "ex-view-chip" + (on ? " ex-view-chip-on" : "");
            b.textContent = text;
            b.setAttribute("aria-pressed", on ? "true" : "false");
            b.addEventListener("click", function () { var p = {}; p[key] = !on; change(p); });
            return b;
        }
        bar.appendChild(chip("★ Favoris", view.fav, "fav"));
        bar.appendChild(chip("Avec vidéo", view.video, "video"));
        if (!exViewIsDefault(view)) {
            var count = document.createElement("span");
            count.className = "ex-view-count";
            count.textContent = shownCount + " / " + totalCount;
            bar.appendChild(count);
            var reset = document.createElement("button");
            reset.type = "button";
            reset.className = "ex-view-chip";
            reset.textContent = "Réinitialiser";
            reset.addEventListener("click", function () { saveExView({}); render(); });
            bar.appendChild(reset);
            var note = document.createElement("span");
            note.className = "ex-view-note";
            note.textContent = "Glisser-déposer désactivé tant qu'un tri ou un filtre est actif";
            bar.appendChild(note);
        }
        return bar;
    }

    function renderFolderRow(inst, parentArray, folder, idx, total, path) {
        var row = document.createElement("div");
        row.className = "folder-row";
        row.dataset.reorderId = folder.id;

        var folderIcon = document.createElement("span");
        folderIcon.className = "folder-icon";
        folderIcon.innerHTML = FOLDER_ICON_SVG;
        row.appendChild(folderIcon);

        var label = document.createElement("span");
        label.className = "folder-name";
        label.textContent = folder.name;
        row.appendChild(label);
        row.title = "Clic droit (ordinateur) ou appui long (mobile) : renommer / supprimer";
        bindFolderMenu(row, function () { return parentArray; }, folder, inst);

        var editBtn = svgIconButton(PENCIL_ICON_SVG, "Renommer ce dossier", function (e) {
            e.stopPropagation();
            var rect = editBtn.getBoundingClientRect();
            openFolderMenu(rect.left, rect.bottom, function () { return parentArray; }, folder, inst, "rename");
        });
        editBtn.classList.add("folder-edit-btn");
        row.appendChild(editBtn);

        row.addEventListener("click", function (e) {
            if (suppressNextClick) { suppressNextClick = false; return; }
            setNavPath(inst, path.concat(folder.id));
            render();
        });

        return row;
    }

    // Discret à dessein (même habillage en pointillés que le "+" de l'arborescence côté
    // ordinateur) : ajouter un sous-dossier est bien plus rare qu'ajouter un exercice, il ne doit
    // pas rivaliser visuellement avec le bouton d'ajout d'exercice juste en dessous. Sur ordinateur,
    // le clic droit/appui long sur le titre du dossier (→ "Nouveau sous-dossier") et le raccourci
    // Ctrl/Cmd+Maj+N font la même chose sans occuper de place à l'écran.
    function renderAddFolderForm(currentFolder) {
        var wrap = document.createElement("div");
        wrap.className = "add-category-row tree-add-row";
        var input = document.createElement("input");
        input.type = "text";
        input.className = "tree-add-input";
        input.placeholder = "Nouveau sous-dossier…";
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tree-add-btn";
        btn.textContent = "+";
        btn.title = "Ajouter un sous-dossier";
        function commit() {
            var name = input.value.trim();
            if (!name) return;
            if (folderNameTaken(currentFolder.folders, name) && !confirmNameCollision("dossier", name)) return;
            currentFolder.folders.push(makeFolder(name));
            save();
            render();
        }
        btn.addEventListener("click", commit);
        input.addEventListener("keydown", function (e) { if (e.key === "Enter") commit(); });
        wrap.appendChild(input);
        wrap.appendChild(btn);
        return wrap;
    }

    function renderFilteredResults(inst) {
        var query = searchQuery.trim().toLowerCase();
        function matchFn(ex) {
            // Les archivés restent hors de la recherche classique : on les retrouve dans leur
            // propre chapitre virtuel "Archivés" (comme les favoris), voir renderVirtualChapterView.
            if (ex.archived) return false;
            if (!query) return true;
            if (ex.title.toLowerCase().indexOf(query) !== -1) return true;
            // La recherche trouve aussi un exercice par le nom d'un lien ou d'une pièce jointe
            // (ex. "Youtube bassless"), ou par le contenu de ses notes — pas seulement par son titre.
            if (ex.links.some(function (l) { return (l.label || "").toLowerCase().indexOf(query) !== -1; })) return true;
            if (ex.files.some(function (f) { return (f.name || "").toLowerCase().indexOf(query) !== -1; })) return true;
            if ((ex.notes || "").toLowerCase().indexOf(query) !== -1) return true;
            return false;
        }
        var results = collectExercises(inst, matchFn);
        renderResultsList(inst, results, "Aucun exercice ne correspond à ta recherche.");
    }

    function renderAddExerciseForm(folder) {
        var wrap = document.createElement("div");
        wrap.className = "add-exercise-row";
        var input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Ajouter un exercice…";
        function commit() {
            var title = input.value.trim();
            if (!title) return;
            if (exerciseTitleTaken(folder.exercises, title) && !confirmNameCollision("exercice", title)) return;
            folder.exercises.push({
                id: uid(),
                title: title,
                notes: "",
                favorite: false,
                archived: false,
                links: [],
                files: [],
                collapsed: true,
                updatedAt: Date.now()
            });
            input.value = "";
            save();
            render();
        }
        var btn = iconButton("+", "Ajouter l'exercice", commit);
        btn.className = "btn-accent icon-btn";
        input.addEventListener("keydown", function (e) { if (e.key === "Enter") commit(); });
        wrap.appendChild(input);
        wrap.appendChild(btn);
        return wrap;
    }

    function renderExercise(folder, ex, orderingEnabled) {
        var el = document.createElement("div");
        el.className = "exercise" + (ex.collapsed ? " collapsed" : "");
        el.dataset.reorderId = ex.id;

        var row = document.createElement("div");
        row.className = "exercise-row";
        row.title = "Cliquer pour les détails (notes, liens…) · clic droit ou appui long : favoris / archiver";
        bindExerciseMenu(row, ex, folder);
        row.addEventListener("click", function (e) {
            if (suppressNextClick) { suppressNextClick = false; return; }
            // Le titre (et les boutons) gardent leur propre clic : cliquer le reste de la ligne
            // déplie/replie les détails (remplace le chevron dédié, retiré pour épurer la ligne).
            if (e.target.closest("button, input, textarea, select")) return;
            ex.collapsed = !ex.collapsed;
            save();
            render();
        });

        // Poignée de glisser-déposer pour réordonner (remplace les flèches ↑/↓) : seulement dans
        // la vue normale d'un dossier, pas dans les listes à plat (recherche/favoris/archivés) où
        // les exercices viennent de dossiers différents et n'ont pas d'ordre commun.
        if (orderingEnabled) {
            var handle = document.createElement("span");
            handle.className = "exercise-drag-handle";
            handle.innerHTML = GRIP_ICON_SVG;
            handle.title = "Glisser pour réordonner";
            row.appendChild(handle);
        }

        if (ex.favorite) {
            var favBadge = document.createElement("span");
            favBadge.className = "exercise-favorite-badge";
            favBadge.innerHTML = STAR_FILLED_SVG;
            favBadge.title = "Favori";
            row.appendChild(favBadge);
        }

        var title = document.createElement("input");
        title.type = "text";
        title.className = "exercise-title";
        title.value = ex.title;
        title.addEventListener("input", function () { autoSizeExerciseTitle(title); });
        title.addEventListener("change", function () {
            var newTitle = title.value.trim();
            if (!newTitle || newTitle === ex.title) { title.value = ex.title; return; }
            if (exerciseTitleTaken(folder.exercises, newTitle, ex) && !confirmNameCollision("exercice", newTitle)) {
                title.value = ex.title;
                return;
            }
            ex.title = newTitle;
            touchExercise(ex);
            save();
        });
        row.appendChild(title);

        // Espace vide entre le titre (qui ne prend que la largeur de son texte) et les boutons de
        // droite : fait partie de la ligne cliquable pour déplier/replier, comme le reste de la
        // barre. Sans lui, le titre en flex:1 occuperait toute la largeur et rendrait le clic sur
        // "partout sauf le texte" impossible ailleurs qu'sur la petite poignée.
        var spacer = document.createElement("span");
        spacer.className = "exercise-row-spacer";
        row.appendChild(spacer);

        appendExerciseLinkButtons(row, ex);
        if (ex.notes && ex.notes.trim()) {
            var noteMark = document.createElement("span");
            noteMark.className = "exercise-note-mark";
            noteMark.innerHTML = NOTE_BUBBLE_SVG;
            noteMark.title = "Cet exercice a des notes";
            row.appendChild(noteMark);
        }
        appendExerciseImageButton(row, ex);
        var tempoChip = buildTempoChip({
            title: ex.title,
            exId: ex.id,
            get: function () { return ex.metronome; },
            set: function (p) { setExerciseMetronome(ex, p); }
        }, false);
        if (tempoChip) row.appendChild(tempoChip);

        if (ex.archived) {
            var archBadge = document.createElement("span");
            archBadge.className = "exercise-archived-badge";
            archBadge.textContent = "Archivé";
            row.appendChild(archBadge);
        }

        var delBtn = iconButton("✕", "Supprimer l'exercice", function () {
            if (!window.confirm("Supprimer « " + ex.title + " » ?")) return;
            addToTrash("exercise", ex, { instrumentId: getActiveInstrument().id, parentFolderId: folder.id });
            folder.exercises = folder.exercises.filter(function (e) { return e.id !== ex.id; });
            save();
            render();
        });
        row.appendChild(delBtn);

        el.appendChild(row);

        if (!ex.collapsed) {
            el.appendChild(renderExerciseDetails(ex));
        } else {
            delete exerciseVideosOpen[ex.id];
        }

        return el;
    }

    // ---------- accès rapide aux liens depuis la barre de l'exercice ----------
    // Sans lien mis en avant (clic droit/appui long sur un lien dans les détails, voir
    // renderExerciseDetails) : un seul lien -> son bouton directement ; plusieurs liens -> un
    // bouton groupé qui propose de choisir. Avec un lien mis en avant : uniquement ce dernier.
    function appendExerciseLinkButtons(row, ex) {
        var links = ex.links || [];
        if (!links.length) return;
        var pinned = ex.pinnedLinkId ? links.filter(function (l) { return l.id === ex.pinnedLinkId; })[0] : null;
        if (pinned) {
            row.appendChild(makeQuickLinkButton(pinned));
        } else if (links.length === 1) {
            row.appendChild(makeQuickLinkButton(links[0]));
        } else {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "exercise-link-quick exercise-link-quick-multi";
            btn.title = "Choisir un lien à ouvrir";
            var icon = document.createElement("span");
            icon.className = "link-icon";
            icon.innerHTML = LINK_ICONS.link;
            btn.appendChild(icon);
            var label = document.createElement("span");
            label.className = "exercise-link-quick-label";
            label.textContent = "Liens (" + links.length + ")";
            btn.appendChild(label);
            btn.addEventListener("click", function (e) {
                e.stopPropagation();
                var rect = btn.getBoundingClientRect();
                openLinksQuickMenu(rect.left, rect.bottom, links);
            });
            row.appendChild(btn);
        }
    }

    function makeQuickLinkButton(link) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "exercise-link-quick";
        btn.title = "Ouvrir : " + link.label;
        var icon = document.createElement("span");
        icon.className = "link-icon";
        icon.innerHTML = linkIconSvg(link.label, link.url);
        btn.appendChild(icon);
        var label = document.createElement("span");
        label.className = "exercise-link-quick-label";
        label.textContent = link.label;
        btn.appendChild(label);
        btn.addEventListener("click", function (e) {
            e.stopPropagation();
            window.open(link.url, "_blank", "noopener,noreferrer");
        });
        return btn;
    }

    function openLinksQuickMenu(x, y, links) {
        closeFolderMenu();

        var backdrop = document.createElement("div");
        backdrop.className = "ctx-backdrop";
        backdrop.addEventListener("pointerdown", function (e) { e.preventDefault(); closeFolderMenu(); });
        backdrop.addEventListener("contextmenu", function (e) { e.preventDefault(); closeFolderMenu(); });

        var menu = document.createElement("div");
        menu.className = "ctx-menu";
        menu.setAttribute("role", "menu");
        menu.addEventListener("contextmenu", function (e) { e.preventDefault(); });

        function menuButton(text, onClick) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "ctx-item";
            b.textContent = text;
            var armed = false;
            b.addEventListener("pointerdown", function () { armed = true; });
            b.addEventListener("click", function (e) {
                if (!armed && e.detail !== 0) return;
                armed = false;
                onClick();
            });
            return b;
        }

        function place() {
            var w = menu.offsetWidth || 200;
            var h = menu.offsetHeight || 100;
            var left = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - w - 8));
            var top = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - h - 8));
            menu.style.left = left + "px";
            menu.style.top = top + "px";
        }

        links.forEach(function (link) {
            menu.appendChild(menuButton(link.label, function () {
                if (link.open) link.open(); else window.open(link.url, "_blank", "noopener,noreferrer");
                closeFolderMenu();
            }));
        });

        function onKey(e) { if (e.key === "Escape") closeFolderMenu(); }

        document.body.appendChild(backdrop);
        document.body.appendChild(menu);
        document.addEventListener("keydown", onKey, true);
        openMenu = { backdrop: backdrop, menu: menu, onKey: onKey };
        place();
    }

    // ---------- enregistrement automatique des zones de note ----------
    // Avant, une note n'était enregistrée qu'à la perte du focus (événement "change") : si la zone
    // disparaissait avant (réaffichage de la page, onglet fermé…), la saisie était perdue, et rien
    // n'indiquait quand c'était fait. Maintenant : la valeur est dans les données dès la frappe,
    // enregistrée après une courte pause de frappe, et de toute façon avant tout réaffichage, perte
    // de focus, changement d'onglet ou fermeture de la page. Un indicateur dit où on en est.
    var newLinkPropagateId = null; // lien tout juste ajouté : à proposer aux exercices du même nom une fois son nom validé
    var pendingRenameKey = null; // "link:<id>" / "file:<id>" : ressource tout juste ajoutée, à renommer aussitôt
    var exerciseVideosOpen = {}; // id d'exercice -> vidéos YouTube affichées (le temps où il reste déplié)
    // Cliquer en dehors d'un champ de saisie en sort (et déclenche donc son enregistrement). Le
    // navigateur le ferait seul, mais le glisser-déposer des listes annule l'effet par défaut du
    // clic (preventDefault sur pointerdown), si bien que cliquer sur une ligne d'exercice ou à côté
    // laissait la saisie ouverte.
    document.addEventListener("pointerdown", function (e) {
        var a = document.activeElement;
        if (!a || a === document.body || !a.tagName) return;
        var tag = a.tagName;
        var isTextField = tag === "TEXTAREA" || (tag === "INPUT" && !/^(button|checkbox|radio|range|submit|reset|file|image)$/i.test(a.type));
        if (!isTextField) return;
        var t = e.target;
        if (t === a || (t && t.closest && t.closest("input, textarea, select, label"))) return;
        a.blur();
    }, true);

    var pendingTextFlushes = [];
    function flushPendingTextSaves() {
        pendingTextFlushes.slice().forEach(function (f) { f(); });
    }
    // `hooks.onLeave` (facultatif) : appelé quand on QUITTE la zone après l'avoir modifiée (pas à chaque
    // enregistrement automatique en cours de frappe) — c'est le bon moment pour poser une question.
    function bindAutosaveTextarea(textarea, apply, statusEl, hooks) {
        var timer = null, fadeTimer = null, dirty = false, changedSinceLeave = false;
        function setStatus(text, cls) {
            if (!statusEl) return;
            statusEl.textContent = text;
            statusEl.className = "save-status" + (cls ? " " + cls : "");
        }
        function flush() {
            clearTimeout(timer); timer = null;
            if (!dirty) return;
            dirty = false;
            var at = pendingTextFlushes.indexOf(flush);
            if (at !== -1) pendingTextFlushes.splice(at, 1);
            save();
            setStatus("Enregistré ✓", "saved");
            clearTimeout(fadeTimer);
            fadeTimer = setTimeout(function () { setStatus("", ""); }, 3000);
        }
        function leave() {
            flush();
            if (changedSinceLeave) {
                changedSinceLeave = false;
                if (hooks && hooks.onLeave) hooks.onLeave();
            }
        }
        textarea.addEventListener("input", function () {
            apply(textarea.value);
            dirty = true;
            changedSinceLeave = true;
            if (pendingTextFlushes.indexOf(flush) === -1) pendingTextFlushes.push(flush);
            setStatus("Modification en cours…", "pending");
            clearTimeout(fadeTimer);
            clearTimeout(timer);
            timer = setTimeout(flush, 700);
        });
        textarea.addEventListener("blur", leave);
        textarea.addEventListener("change", leave);
    }
    window.addEventListener("pagehide", flushPendingTextSaves);
    window.addEventListener("beforeunload", flushPendingTextSaves);
    document.addEventListener("visibilitychange", function () { if (document.hidden) flushPendingTextSaves(); });

    function renderExerciseDetails(ex) {
        var details = document.createElement("div");
        details.className = "exercise-details";

        // Tempo cible / métronome prédéfini : juste sous le titre, c'est le réglage le plus utile en un coup d'œil.
        details.appendChild(buildMetronomePresetRow({
            title: ex.title,
            exId: ex.id,
            get: function () { return ex.metronome; },
            set: function (p) { setExerciseMetronome(ex, p); }
        }));

        var notesLabel = document.createElement("div");
        notesLabel.className = "section-label";
        notesLabel.textContent = "Notes";
        var notesStatus = document.createElement("span");
        notesStatus.className = "save-status";
        notesLabel.appendChild(notesStatus);
        var notes = document.createElement("textarea");
        notes.className = "notes-textarea";
        notes.rows = NOTES_MIN_ROWS;
        notes.value = ex.notes || "";
        notes.placeholder = "Remarques, points à retravailler…";
        notes.addEventListener("input", function () { autoGrowNotes(notes); });
        bindAutosaveTextarea(notes, function (value) {
            updateNoteDates(ex, value);
            ex.notes = value;
            touchExercise(ex);
        }, notesStatus, {
            onLeave: function () {
                if (archiveOverflowNotes(ex)) {
                    save();
                    notes.value = ex.notes;
                    autoGrowNotes(notes);
                    refreshArchive();
                    showToast("Anciennes notes déplacées dans les archives.", 3000);
                }
                var text = ex.notes || "";
                askApplyToSameNamed(ex, text.trim() ? "Remplacer leur note par celle-ci ?" : "Effacer aussi leur note ?",
                    function (o) { return (o.notes || "") !== text; },
                    function (o) { o.notes = text; });
            }
        });
        // Archives datées (repliées de base) : bouton à côté du titre « Notes ».
        var archiveBtn = document.createElement("button");
        archiveBtn.type = "button";
        archiveBtn.className = "notes-archive-btn";
        notesLabel.appendChild(archiveBtn);
        var archiveBox = document.createElement("div");
        archiveBox.className = "notes-archive";
        archiveBox.hidden = true;
        function refreshArchive() {
            var list = ex.notesArchive || [];
            archiveBtn.textContent = "Archives" + (list.length ? " (" + list.length + ")" : "");
            archiveBtn.setAttribute("aria-expanded", archiveBox.hidden ? "false" : "true");
            archiveBox.innerHTML = "";
            if (!list.length) {
                var none = document.createElement("div");
                none.className = "gs-empty";
                none.textContent = "Rien d'archivé : au-delà de " + NOTES_KEEP_LINES + " lignes, les plus anciennes arrivent ici, datées.";
                archiveBox.appendChild(none);
                return;
            }
            list.forEach(function (entry, i) {
                var line = document.createElement("div");
                line.className = "notes-archive-line";
                var d = document.createElement("span");
                d.className = "notes-archive-date";
                d.textContent = formatNoteDate(entry.d);
                var t = document.createElement("span");
                t.className = "notes-archive-text";
                t.textContent = entry.t;
                var rm = document.createElement("button");
                rm.type = "button";
                rm.className = "notes-archive-rm";
                rm.textContent = "✕";
                rm.title = "Supprimer cette ligne des archives";
                rm.addEventListener("click", function () {
                    ex.notesArchive.splice(i, 1);
                    touchExercise(ex);
                    save();
                    refreshArchive();
                });
                line.appendChild(d); line.appendChild(t); line.appendChild(rm);
                archiveBox.appendChild(line);
            });
        }
        archiveBtn.addEventListener("click", function () { archiveBox.hidden = !archiveBox.hidden; refreshArchive(); });
        refreshArchive();
        details.appendChild(notesLabel);
        details.appendChild(notes);
        details.appendChild(archiveBox);

        // Ordre de la fiche : notes · vidéos YouTube · images et fichiers (liens hors vidéo, PDF, audio, images)
        // · barre d'ajout unique tout en bas.
        var videoChips = document.createElement("div"); // puces des liens YouTube (renommer / retirer), toujours visibles
        videoChips.className = "links-list";
        var resourcesList = document.createElement("div"); // liens hors vidéo + fichiers
        resourcesList.className = "links-list";
        (ex.links || []).forEach(function (link, idx) {
            var chip = document.createElement("a");
            chip.className = "link-chip";
            chip.href = link.url;
            chip.target = "_blank";
            chip.rel = "noopener noreferrer";
            bindLinkMenu(chip, ex, link);
            var iconSpan = document.createElement("span");
            iconSpan.className = "link-icon";
            iconSpan.innerHTML = linkIconSvg(link.label, link.url);
            chip.appendChild(iconSpan);
            var labelSpan = document.createElement("span");
            labelSpan.className = "link-label";
            labelSpan.textContent = link.label;
            chip.appendChild(labelSpan);

            function startRenameLink() {
                var input = document.createElement("input");
                input.type = "text";
                input.className = "link-label-input";
                input.value = link.label;
                labelSpan.replaceWith(input);
                input.focus();
                input.select();
                var done = false;
                var oldLabel = link.label;
                var isNewLink = newLinkPropagateId === link.id;
                function propagate() {
                    var url = link.url, label = link.label;
                    if (isNewLink) {
                        newLinkPropagateId = null;
                        askApplyToSameNamed(ex, "Ajouter aussi ce lien (« " + label + " ») ?",
                            function (o) { return !hasLinkUrl(o, url); },
                            function (o) { o.links = o.links || []; o.links.push({ id: uid(), label: label, url: url }); });
                    } else if (label !== oldLabel) {
                        askApplyToSameNamed(ex, "Renommer aussi ce lien en « " + label + " » ?",
                            function (o) { return (o.links || []).some(function (l) { return l.url === url && l.label !== label; }); },
                            function (o) { (o.links || []).forEach(function (l) { if (l.url === url) l.label = label; }); });
                    }
                }
                function commit() {
                    if (done) return;
                    done = true;
                    var name = input.value.trim();
                    if (name) { link.label = name; labelSpan.textContent = name; }
                    input.replaceWith(labelSpan);
                    touchExercise(ex);
                    save();
                    propagate();
                }
                function cancel() {
                    if (done) return;
                    done = true;
                    input.replaceWith(labelSpan);
                    propagate();
                }
                input.addEventListener("keydown", function (e) {
                    e.stopPropagation();
                    if (e.key === "Enter") { e.preventDefault(); commit(); }
                    if (e.key === "Escape") cancel();
                });
                input.addEventListener("blur", commit);
                input.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); });
            }

            // Lien tout juste ajouté : on passe directement en saisie du nom, sans cliquer sur le crayon.
            if (pendingRenameKey === "link:" + link.id) {
                pendingRenameKey = null;
                setTimeout(startRenameLink, 0);
            }

            var editBtn = document.createElement("span");
            editBtn.className = "link-edit";
            editBtn.innerHTML = PENCIL_ICON_SVG;
            editBtn.title = "Renommer ce lien";
            editBtn.addEventListener("click", function (e) {
                e.preventDefault();
                e.stopPropagation();
                startRenameLink();
            });
            chip.appendChild(editBtn);

            var removeBtn = document.createElement("span");
            removeBtn.className = "link-remove";
            removeBtn.textContent = "✕";
            removeBtn.title = "Retirer ce lien";
            removeBtn.addEventListener("click", function (e) {
                e.preventDefault();
                e.stopPropagation();
                ex.links.splice(idx, 1);
                if (ex.pinnedLinkId === link.id) ex.pinnedLinkId = null;
                touchExercise(ex);
                save();
                render();
                askApplyToSameNamed(ex, "Retirer aussi ce lien (« " + link.label + " ») ?",
                    function (o) { return hasLinkUrl(o, link.url); },
                    function (o) {
                        o.links = (o.links || []).filter(function (l) { return l.url !== link.url; });
                        if (o.pinnedLinkId && !(o.links || []).some(function (l) { return l.id === o.pinnedLinkId; })) o.pinnedLinkId = null;
                    });
            });
            chip.appendChild(removeBtn);
            (youTubeVideoInfo(link.url) ? videoChips : resourcesList).appendChild(chip);
        });
        appendFileChips(resourcesList, ex);

        // Vidéos YouTube de l'exercice : TOUJOURS masquées de base (un lecteur intégré est lourd : rien
        // n'est chargé tant qu'on n'a pas cliqué), en petit, et seulement dans l'exercice déplié.
        // Replier l'exercice referme aussi les vidéos (voir renderExercise).
        var exYtLinks = (ex.links || []).filter(function (l) { return !!youTubeVideoInfo(l.url); });
        if (exYtLinks.length) {
            details.appendChild(videoChips);
            var exVideosOpen = !!exerciseVideosOpen[ex.id];
            var exYtToggle = document.createElement("button");
            exYtToggle.type = "button";
            exYtToggle.className = "btn-ghost gs-yt-toggle gs-yt-toggle-ex";
            exYtToggle.textContent = (exVideosOpen ? "▾ " : "▸ ") + "Vidéos YouTube (" + exYtLinks.length + ") — " + (exVideosOpen ? "masquer" : "afficher");
            exYtToggle.addEventListener("click", function () {
                exerciseVideosOpen[ex.id] = !exVideosOpen;
                render();
            });
            details.appendChild(exYtToggle);
            if (exVideosOpen) {
                exYtLinks.forEach(function (link) {
                    var card = buildYouTubeCard(link, ex, youTubeVideoInfo(link.url), null);
                    card.classList.add("gs-yt-small");
                    details.appendChild(card);
                });
            }
        }

        details.appendChild(buildFilesSection(ex, resourcesList));

        var addLinkRow = document.createElement("div");
        addLinkRow.className = "add-link-row";
        var urlInput = document.createElement("input");
        urlInput.type = "url";
        urlInput.placeholder = "Coller un lien…";
        function commitLink() {
            var url = urlInput.value.trim();
            if (!url) return;
            if (!/^https?:\/\//i.test(url)) url = "https://" + url;
            ex.links = ex.links || [];
            var newLink = { id: uid(), label: guessLinkLabel(url), url: url };
            ex.links.push(newLink);
            pendingRenameKey = "link:" + newLink.id;
            newLinkPropagateId = newLink.id;
            if (!youTubeVideoInfo(url)) imagesOpenInList[ex.id] = true;
            urlInput.value = "";
            touchExercise(ex);
            save();
            render();
        }
        var addLinkBtn = iconButton("+", "Ajouter ce lien", commitLink);
        addLinkBtn.className = "btn-accent icon-btn";
        urlInput.addEventListener("keydown", function (e) { if (e.key === "Enter") commitLink(); });
        addLinkRow.appendChild(urlInput);
        addLinkRow.appendChild(addLinkBtn);
        addLinkRow.appendChild(makeAddFileButton(ex));
        var pasteImgBtn = document.createElement("button");
        pasteImgBtn.type = "button";
        pasteImgBtn.className = "add-paste-btn";
        pasteImgBtn.textContent = "Coller";
        pasteImgBtn.title = "Coller une capture ou une image copiée (ou Ctrl+V / ⌘V dans la fiche)";
        pasteImgBtn.addEventListener("click", function () { pasteImagesFromClipboard(ex); });
        addLinkRow.appendChild(pasteImgBtn);
        details.appendChild(addLinkRow);

        bindImagePaste(details, ex);

        return details;
    }

    // ---- fichiers audio : toutes les extensions se lisent de la même façon (lecteur intégré) ----
    // Le type MIME enregistré par le navigateur est parfois vide ou fantaisiste (m4a, mp4, wav… selon le
    // système) : on le déduit de l'extension, à l'ajout comme à la lecture, pour que tout se comporte pareil.
    var FILE_MIME_BY_EXT = {
        mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", wave: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg",
        opus: "audio/ogg", flac: "audio/flac", weba: "audio/webm", webm: "audio/webm", aif: "audio/aiff", aiff: "audio/aiff", caf: "audio/x-caf",
        mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", pdf: "application/pdf"
    };
    var AUDIO_EXTS = ["mp3", "m4a", "aac", "wav", "wave", "ogg", "oga", "opus", "flac", "weba", "webm", "aif", "aiff", "caf", "mp4", "m4v", "mov"];
    function fileExt(name) { var m = /\.([A-Za-z0-9]+)$/.exec(name || ""); return m ? m[1].toLowerCase() : ""; }
    function isAudioFile(meta) {
        return AUDIO_EXTS.indexOf(fileExt(meta.name)) !== -1 || /^audio\//.test(meta.type || "");
    }
    function mimeForFile(name, type) {
        var byExt = FILE_MIME_BY_EXT[fileExt(name)];
        if (byExt) return byExt;
        return type || "";
    }
    // Même contenu, type MIME corrigé : l'onglet ou le lecteur sait alors quoi en faire.
    function playableBlob(blob, meta) {
        var mime = mimeForFile(meta.name, meta.type || blob.type);
        return mime && blob.type !== mime ? new Blob([blob], { type: mime }) : blob;
    }
    // Lecteur intégré sous la liste de puces : un seul à la fois, avec la vitesse de lecture (utile pour travailler un morceau).
    function toggleAudioPlayer(container, meta) {
        var existing = container.querySelector(".audio-player");
        var sameId = existing && existing.getAttribute("data-file") === meta.id;
        if (existing) { if (existing._cleanup) existing._cleanup(); existing.remove(); }
        if (sameId) return;
        getFileBlob(meta.id).then(function (blob) {
            if (!blob) { window.alert("Ce fichier n'est disponible que sur l'appareil où il a été ajouté (« " + meta.name + " »)."); return; }
            var box = document.createElement("div");
            box.className = "audio-player";
            box.setAttribute("data-file", meta.id);
            var name = document.createElement("div");
            name.className = "audio-player-name";
            name.textContent = meta.name;
            var audio = document.createElement("audio");
            audio.controls = true;
            audio.preload = "auto";
            var url = URL.createObjectURL(playableBlob(blob, meta));
            audio.src = url;
            var rate = document.createElement("select");
            rate.className = "audio-player-rate";
            rate.title = "Vitesse de lecture";
            [50, 60, 70, 75, 80, 90, 100, 110, 125].forEach(function (r) {
                var o = document.createElement("option");
                o.value = String(r / 100); o.textContent = r + " %";
                if (r === 100) o.selected = true;
                rate.appendChild(o);
            });
            rate.addEventListener("change", function () { audio.playbackRate = parseFloat(rate.value); });
            var close = document.createElement("button");
            close.type = "button";
            close.className = "audio-player-close";
            close.textContent = "✕";
            close.title = "Fermer le lecteur";
            var msg = document.createElement("div");
            msg.className = "audio-player-error";
            msg.hidden = true;
            function cleanup() { try { audio.pause(); } catch (e) {} URL.revokeObjectURL(url); }
            box._cleanup = cleanup;
            close.addEventListener("click", function () { cleanup(); box.remove(); });
            audio.addEventListener("error", function () {
                msg.hidden = false;
                msg.textContent = "Ce navigateur ne sait pas lire ce format (." + (fileExt(meta.name) || "?") + "). Convertis le fichier en MP3 ou M4A, ou ouvre-le dans une autre application.";
            });
            box.appendChild(name); box.appendChild(audio); box.appendChild(rate); box.appendChild(close); box.appendChild(msg);
            container.appendChild(box);
            audio.addEventListener("loadedmetadata", function () { audio.playbackRate = parseFloat(rate.value); });
            var p = audio.play();
            if (p && p.catch) p.catch(function () {});
        });
    }

    function fileKindIcon(mimeOrName) {
        mimeOrName = String(mimeOrName || "").trim();
        var isAudio = /audio|video\/mp4|\.(mp3|m4a|aac|wav|wave|ogg|oga|opus|flac|weba|webm|aiff?|caf|mp4|m4v|mov)$/i.test(mimeOrName);
        return isAudio
            ? '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'
            : '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>';
    }

    // ---------- fichiers joints (PDF/MP3) : rendu ----------
    // Rappel (voir plus haut) : seules les métadonnées (ex.files) sont synchronisées. Le fichier
    // réel n'existe que dans IndexedDB, sur l'appareil où il a été ajouté — d'où le rappel dans le
    // "title" de chaque puce plutôt qu'un paragraphe permanent (moins de texte à l'écran).
    function appendFileChips(list, ex) {
        (ex.files || []).forEach(function (meta) {
            var chip = document.createElement("div");
            chip.className = "file-chip";
            chip.title = "Fichier stocké seulement sur cet appareil (non synchronisé)";

            var iconSpan = document.createElement("span");
            iconSpan.className = "link-icon";
            iconSpan.innerHTML = fileKindIcon((meta.type || "") + " " + (meta.name || ""));
            chip.appendChild(iconSpan);

            var openBtn = document.createElement("button");
            openBtn.type = "button";
            openBtn.className = "file-open";
            function fileCaption() { return meta.name + (meta.size ? " · " + humanFileSize(meta.size) : ""); }
            openBtn.textContent = fileCaption();
            openBtn.addEventListener("click", function () {
                if (isAudioFile(meta)) { toggleAudioPlayer(list, meta); return; }
                getFileBlob(meta.id).then(function (blob) {
                    if (!blob) {
                        window.alert("Ce fichier n'est disponible que sur l'appareil où il a été ajouté (« " + meta.name + " »).");
                        return;
                    }
                    var url = URL.createObjectURL(playableBlob(blob, meta));
                    window.open(url, "_blank");
                    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
                });
            });
            chip.appendChild(openBtn);

            // Renommer le fichier (PDF, MP3…) : seul le nom affiché change, pas le fichier stocké.
            function startRenameFile() {
                var input = document.createElement("input");
                input.type = "text";
                input.className = "link-label-input";
                input.value = meta.name;
                openBtn.replaceWith(input);
                input.focus();
                input.select();
                var done = false;
                function finishRename(save_) {
                    if (done) return;
                    done = true;
                    var name = input.value.trim();
                    if (save_ && name && name !== meta.name) {
                        meta.name = name;
                        touchExercise(ex);
                        save();
                    }
                    openBtn.textContent = fileCaption();
                    input.replaceWith(openBtn);
                }
                input.addEventListener("keydown", function (e) {
                    e.stopPropagation();
                    if (e.key === "Enter") { e.preventDefault(); finishRename(true); }
                    if (e.key === "Escape") finishRename(false);
                });
                input.addEventListener("blur", function () { finishRename(true); });
            }
            if (pendingRenameKey === "file:" + meta.id) {
                pendingRenameKey = null;
                setTimeout(startRenameFile, 0);
            }
            var fileEditBtn = document.createElement("span");
            fileEditBtn.className = "link-edit";
            fileEditBtn.innerHTML = PENCIL_ICON_SVG;
            fileEditBtn.title = "Renommer ce fichier";
            fileEditBtn.addEventListener("click", function (e) {
                e.preventDefault();
                e.stopPropagation();
                startRenameFile();
            });
            chip.appendChild(fileEditBtn);

            var removeBtn = document.createElement("span");
            removeBtn.className = "link-remove";
            removeBtn.textContent = "✕";
            removeBtn.title = "Retirer ce fichier";
            removeBtn.addEventListener("click", function () {
                if (!window.confirm("Retirer « " + meta.name + " » ?")) return;
                ex.files = ex.files.filter(function (f) { return f.id !== meta.id; });
                deleteFileBlob(meta.id);
                touchExercise(ex);
                save();
                render();
            });
            chip.appendChild(removeBtn);

            list.appendChild(chip);
        });
    }

    function makeAddFileButton(ex) {
        var wrap = document.createElement("span");
        wrap.className = "add-file-row";
        var fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.className = "add-file-input";
        fileInput.accept = ".pdf,application/pdf,audio/*,video/mp4,image/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.flac,.aif,.aiff,.mp4,.m4v,.mov,.weba,.webm";
        fileInput.multiple = true;
        var fileBtn = svgIconButton(FILE_ICON_SVG, "Ajouter un fichier (PDF, MP3…) ou une image — reste sur cet appareil", function () { fileInput.click(); });
        fileBtn.classList.add("btn-ghost");
        fileInput.addEventListener("change", function () {
            var all = Array.prototype.slice.call(fileInput.files || []);
            if (!all.length) return;
            // Les images vont dans la section Images (réduites, synchronisées) ; le reste reste en pièces jointes.
            var imgs = all.filter(function (f) { return /^image\//.test(f.type); });
            var files = all.filter(function (f) { return !/^image\//.test(f.type); });
            if (imgs.length) addImagesToExercise(ex, imgs);
            if (!files.length) { fileInput.value = ""; return; }
            ex.files = ex.files || [];
            Promise.all(files.map(function (file) {
                var id = uid();
                var mime = mimeForFile(file.name, file.type);
                var toStore = mime && file.type !== mime ? new Blob([file], { type: mime }) : file;
                return storeFileBlob(id, toStore).then(function () {
                    ex.files.push({ id: id, name: file.name, type: mime || file.type, size: file.size, addedAt: Date.now() });
                });
            })).then(function () {
                imagesOpenInList[ex.id] = true; // la section « Images et fichiers » s'ouvre pour montrer le nouveau fichier
                fileInput.value = "";
                // Un seul fichier ajouté : saisie du nom aussitôt (comme pour un lien).
                if (files.length === 1) pendingRenameKey = "file:" + ex.files[ex.files.length - 1].id;
                touchExercise(ex);
                save();
                render();
            }).catch(function () {
                window.alert("Impossible d'enregistrer ce fichier sur cet appareil (stockage plein ou navigateur privé ?).");
            });
        });
        wrap.appendChild(fileInput);
        wrap.appendChild(fileBtn);
        return wrap;
    }

    // ---------- synchro cloud (Firebase) ----------

    var firebaseApp = null;
    var auth = null;
    var db = null;
    var currentUser = null;
    var docRef = null;
    var unsubscribeSnapshot = null;
    var pushTimer = null;
    var PUSH_DEBOUNCE_MS = 1500;

    var $syncStatus = document.getElementById("sync-status");
    var $accountInfo = document.getElementById("account-info");
    var $accountName = document.getElementById("account-name");
    var $signinBtn = document.getElementById("google-signin-btn");
    var $signoutBtn = document.getElementById("signout-btn");

    function setSyncStatus(mode) {
        if (!$syncStatus) return;
        $syncStatus.classList.remove("synced", "syncing", "error");
        if (mode) $syncStatus.classList.add(mode);
        var titles = {
            synced: "Synchronisé",
            syncing: "Synchronisation en cours…",
            error: "Erreur de synchronisation (dernière version conservée en local)"
        };
        $syncStatus.title = titles[mode] || "Non synchronisé (hors ligne)";
    }

    // ---------- garde-fou : fermeture pendant une synchro en cours ou en échec ----------
    // La sauvegarde locale (localStorage) est, elle, toujours faite avant même d'essayer d'envoyer
    // au cloud (voir persist()) : rien n'est jamais perdu SUR CET appareil en fermant l'onglet. Ce
    // qui peut manquer, c'est la dernière version côté cloud — gênant seulement si on rouvre
    // l'appli ailleurs avant que l'envoi n'ait abouti. On prévient dans ce cas précis.
    window.addEventListener("beforeunload", function (e) {
        if (!$syncStatus) return;
        var pending = $syncStatus.classList.contains("syncing") || $syncStatus.classList.contains("error");
        if (!pending) return;
        e.preventDefault();
        e.returnValue = "";
        return "";
    });

    function updateAuthUI(user) {
        if (user) {
            $signinBtn.hidden = true;
            $accountInfo.hidden = false;
            $accountName.textContent = user.displayName || user.email || "Connecté";
        } else {
            $signinBtn.hidden = false;
            $accountInfo.hidden = true;
        }
    }

    function isRemoteNewer(remote) {
        return !!remote && typeof remote.updatedAt === "number" &&
            (typeof state.updatedAt !== "number" || remote.updatedAt > state.updatedAt);
    }

    function applyRemoteState(remote) {
        if (!remote || !Array.isArray(remote.instruments)) return;
        // Sauvegarde de secours de ce qu'il y avait sur CET appareil avant de le remplacer par la
        // version distante : si jamais la version distante ne devait pas gagner, rien n'est perdu.
        backupSnapshot("Avant remplacement par une version reçue d'un autre appareil", state);
        state = normalizeState(remote);
        if (!state.activeInstrumentId && state.instruments[0]) state.activeInstrumentId = state.instruments[0].id;
        navPaths = {};
        resetHistory();
        saveLocal();
        render();
    }

    function attachSnapshotListener() {
        if (!docRef) return;
        unsubscribeSnapshot = docRef.onSnapshot(function (snap) {
            if (!snap.exists || snap.metadata.hasPendingWrites) return;
            var remote = snap.data();
            if (!isRemoteNewer(remote)) {
                setSyncStatus("synced");
                return;
            }
            applyRemoteState(remote);
            setSyncStatus("synced");
        }, function (e) {
            console.error("Écoute de la synchro interrompue", e);
            setSyncStatus("error");
        });
    }

    function onAuthChanged(user) {
        currentUser = user;
        updateAuthUI(user);
        if (unsubscribeSnapshot) {
            unsubscribeSnapshot();
            unsubscribeSnapshot = null;
        }
        if (!user) {
            docRef = null;
            setSyncStatus(null);
            return;
        }
        docRef = db.collection("users").doc(user.uid).collection("apps").doc(FIREBASE_APP_SLUG);
        setSyncStatus("syncing");
        docRef.get().then(function (snap) {
            var remote = snap.exists ? snap.data() : null;
            if (isRemoteNewer(remote)) {
                applyRemoteState(remote);
                return null;
            }
            // L'état local a l'air "plus récent" (horodatage), mais sur un appareil/navigateur
            // qu'on vient tout juste d'ouvrir, "plus récent" peut juste vouloir dire "vidé, puis
            // touché il y a 10 secondes" — pas "contient vraiment plus que le cloud". Écraser le
            // cloud dans ce cas a déjà fait perdre du contenu. Avant de pousser par-dessus une
            // version distante qui contient sensiblement plus, on garde une sauvegarde de secours
            // de ce qui va être écrasé, et on demande confirmation.
            if (remote && totalExerciseCount(remote) > totalExerciseCount(state) + 1) {
                backupSnapshot("Version cloud sur le point d'être remplacée depuis " + (navigator.userAgent || "cet appareil"), remote);
                var keepLocal = window.confirm(
                    "Les données déjà enregistrées en ligne contiennent plus d'exercices (" + totalExerciseCount(remote) +
                    ") que celles de cet appareil/navigateur (" + totalExerciseCount(state) + ").\n\n" +
                    "OK = garder les données en ligne (recommandé)\nAnnuler = remplacer quand même par celles de cet appareil"
                );
                if (keepLocal) {
                    applyRemoteState(remote);
                    return null;
                }
            }
            return docRef.set(state);
        }).then(function () {
            setSyncStatus("synced");
            attachSnapshotListener();
            syncImagesToCloud();
            render();
        }).catch(function (e) {
            console.error("Synchro initiale impossible", e);
            setSyncStatus("error");
            attachSnapshotListener();
        });
    }

    function pushToCloud() {
        if (!currentUser || !docRef) return;
        docRef.set(state).then(function () {
            setSyncStatus("synced");
        }).catch(function (e) {
            console.error("Envoi vers le cloud impossible", e);
            setSyncStatus("error");
        });
    }

    function scheduleCloudPush() {
        if (!currentUser || !docRef) return;
        setSyncStatus("syncing");
        if (pushTimer) clearTimeout(pushTimer);
        pushTimer = setTimeout(pushToCloud, PUSH_DEBOUNCE_MS);
    }

    function initFirebase() {
        if (typeof firebase === "undefined" || typeof FIREBASE_CONFIG === "undefined") {
            console.warn("Firebase indisponible : mode local uniquement.");
            return;
        }
        try {
            firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);
            auth = firebase.auth();
            db = firebase.firestore();
            auth.onAuthStateChanged(onAuthChanged);
        } catch (e) {
            console.error("Initialisation Firebase impossible", e);
        }
    }

    $signinBtn.addEventListener("click", function () {
        if (!auth) return;
        var provider = new firebase.auth.GoogleAuthProvider();
        auth.signInWithPopup(provider).catch(function (e) {
            console.error("Connexion impossible", e);
            window.alert("Connexion impossible : " + (e && e.message ? e.message : "erreur inconnue"));
        });
    });

    $signoutBtn.addEventListener("click", function () {
        if (!auth) return;
        auth.signOut();
    });

    initFirebase();

    // ---------- top actions ----------

    $instrumentSelect.addEventListener("change", function () {
        state.activeInstrumentId = $instrumentSelect.value;
        save();
        render();
    });

    $renameInstrumentBtn.addEventListener("click", function () {
        renameInstrument(state.activeInstrumentId);
    });

    document.getElementById("add-instrument-btn").addEventListener("click", function () {
        var name = window.prompt("Nom du nouvel espace (instrument, groupe, projet…) :");
        if (!name) return;
        var inst = makeInstrument(name.trim(), currentPalette(), false);
        state.instruments.push(inst);
        state.activeInstrumentId = inst.id;
        save();
        render();
    });

    function downloadJson(obj, filename) {
        var blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ---------- export des images ----------
    // Avec l'export JSON, on propose (en demandant d'abord) d'exporter aussi les images : dans un dossier
    // « images » si le navigateur sait écrire dans un dossier choisi (Chrome/Edge sur ordinateur), sinon
    // dans une archive ZIP (dossier « images » à l'intérieur) à décompresser.
    function collectExportImages() {
        var out = [];
        state.instruments.forEach(function (inst) {
            (function walk(folders) {
                (folders || []).forEach(function (f) {
                    (f.exercises || []).forEach(function (ex) {
                        (ex.images || []).forEach(function (meta, i) { out.push({ meta: meta, ex: ex, inst: inst, n: i + 1 }); });
                    });
                    walk(f.folders);
                });
            })(inst.categories);
        });
        return out;
    }
    function safeFileName(s) { return String(s || "").replace(/[\\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 60) || "image"; }
    function imageExt(type) { return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" })[type] || "img"; }
    function exportImageName(it, used) {
        var base = safeFileName(it.inst.name) + " - " + safeFileName(it.ex.title) + " - " + it.n;
        var name = base + "." + imageExt(it.meta.type), k = 2;
        while (used[name]) name = base + " (" + (k++) + ")." + imageExt(it.meta.type);
        used[name] = true;
        return name;
    }
    var CRC_TABLE = null;
    function crc32(bytes) {
        if (!CRC_TABLE) {
            CRC_TABLE = [];
            for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
        }
        var crc = 0xFFFFFFFF;
        for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }
    // ZIP minimal sans compression (les images sont déjà compressées) : entrées { name, bytes }.
    function buildZip(entries) {
        var enc = new TextEncoder(), parts = [], central = [], offset = 0;
        var d = new Date();
        var dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
        var dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
        entries.forEach(function (e) {
            var nameBytes = enc.encode(e.name), crc = crc32(e.bytes), size = e.bytes.length;
            var h = new DataView(new ArrayBuffer(30));
            h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
            h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
            h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, nameBytes.length, true); h.setUint16(28, 0, true);
            parts.push(new Uint8Array(h.buffer), nameBytes, e.bytes);
            var c = new DataView(new ArrayBuffer(46));
            c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
            c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
            c.setUint32(20, size, true); c.setUint32(24, size, true); c.setUint16(28, nameBytes.length, true);
            c.setUint32(42, offset, true);
            central.push(new Uint8Array(c.buffer), nameBytes);
            offset += 30 + nameBytes.length + size;
        });
        var centralSize = central.reduce(function (s, p) { return s + p.length; }, 0);
        var end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
        end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
        return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: "application/zip" });
    }
    function downloadBlob(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }
    function exportImages(items, dateStr) {
        var used = {};
        var named = items.map(function (it) { return { it: it, name: exportImageName(it, used) }; });
        function blobOf(it) {
            return getFileBlob(it.meta.id).then(function (b) { return b || cloudFetchImage(it.meta); });
        }
        function done(missing, where) {
            showToast("Images exportées" + where + " (" + (named.length - missing) + "/" + named.length + (missing ? ", " + missing + " absentes de cet appareil" : "") + ").", 6000);
        }
        if (typeof window.showDirectoryPicker === "function") {
            return window.showDirectoryPicker({ mode: "readwrite" }).then(function (dir) {
                return dir.getDirectoryHandle("images", { create: true }).then(function (imgDir) {
                    var missing = 0;
                    return named.reduce(function (p, n) {
                        return p.then(function () {
                            return blobOf(n.it).then(function (blob) {
                                if (!blob) { missing++; return null; }
                                return imgDir.getFileHandle(n.name, { create: true }).then(function (fh) { return fh.createWritable(); }).then(function (w) { return w.write(blob).then(function () { return w.close(); }); });
                            });
                        });
                    }, Promise.resolve()).then(function () { done(missing, " dans le dossier « images »"); });
                });
            }, function (e) { if (e && e.name === "AbortError") return null; return exportImagesZip(); });
        }
        return exportImagesZip();
        function exportImagesZip() {
            var entries = [], missing = 0;
            return named.reduce(function (p, n) {
                return p.then(function () {
                    return blobOf(n.it).then(function (blob) {
                        if (!blob) { missing++; return null; }
                        return blob.arrayBuffer().then(function (buf) { entries.push({ name: "images/" + n.name, bytes: new Uint8Array(buf) }); });
                    });
                });
            }, Promise.resolve()).then(function () {
                if (!entries.length) { window.alert("Aucune image n'est disponible sur cet appareil."); return; }
                downloadBlob(buildZip(entries), "trainhub-images-" + dateStr + ".zip");
                done(missing, " (archive ZIP, dossier « images » à l'intérieur)");
            });
        }
    }

    // ---------- réimport des images ----------
    // Réinjecte des images exportées (fichiers « Espace - Titre - n.ext »). Chaque image retrouve son exercice
    // par l'espace et le titre ; une image déjà présente (même taille) est ignorée, ou simplement restaurée si
    // son contenu manquait sur cet appareil. Les images dont l'exercice est introuvable (renommé, supprimé) ou
    // ambigu sont présentées une à une : choisir l'exercice, ou ne pas les importer.
    function parseExportedImageName(fileName) {
        var base = fileName.replace(/\.[A-Za-z0-9]+$/, "").replace(/ \(\d+\)$/, "");
        var parts = base.split(" - ");
        if (parts.length < 3 || !/^\d+$/.test(parts[parts.length - 1].trim())) return null;
        return { inst: parts[0].trim(), title: parts.slice(1, -1).join(" - ").trim() };
    }
    function normName(s) { return safeFileName(s).toLowerCase(); } // même nettoyage que l'export, pour comparer
    function allExerciseChoices() {
        var out = [];
        state.instruments.forEach(function (inst) {
            collectExercises(inst, function () { return true; }).forEach(function (r) {
                out.push({ ex: r.ex, inst: inst, label: inst.name + " › " + r.pathNames.join(" › ") + " › " + r.ex.title });
            });
        });
        return out;
    }
    function reimportImages(files) {
        files = files.filter(function (f) { return /^image\//.test(f.type); });
        if (!files.length) { window.alert("Aucune image dans la sélection."); return; }
        var choices = allExerciseChoices();
        var matched = [], lost = [];
        files.forEach(function (file) {
            var parsed = parseExportedImageName(file.name);
            var cands = parsed ? choices.filter(function (c) { return normName(c.inst.name) === normName(parsed.inst) && normName(c.ex.title) === normName(parsed.title); }) : [];
            if (cands.length === 1) matched.push({ file: file, ex: cands[0].ex });
            else lost.push({ file: file, parsed: parsed, cands: cands });
        });
        function finish(extra) {
            var all = matched.concat(extra || []);
            var stats = { added: 0, restored: 0, skipped: 0 };
            all.reduce(function (p, m) {
                return p.then(function () { return placeImportedImage(m.file, m.ex, stats); });
            }, Promise.resolve()).then(function () {
                save();
                render();
                setTimeout(function () { all.forEach(function () {}); syncImagesToCloud(); }, 0);
                showToast("Images réimportées : " + stats.added + " ajoutée" + (stats.added > 1 ? "s" : "") + ", " + stats.restored + " restaurée" + (stats.restored > 1 ? "s" : "") + ", " + stats.skipped + " déjà présente" + (stats.skipped > 1 ? "s" : "") + ".", 7000);
            }).catch(function () { window.alert("Impossible d'enregistrer certaines images sur cet appareil."); });
        }
        if (!lost.length) { finish(); return; }
        askLostImages(lost, choices, matched.length, function (assigned) { finish(assigned); });
    }
    function placeImportedImage(file, ex, stats) {
        ex.images = ex.images || [];
        var same = ex.images.filter(function (m) { return m.size === file.size; })[0];
        if (same) {
            return getFileBlob(same.id).then(function (b) {
                if (b) { stats.skipped++; return null; }
                stats.restored++;
                return storeFileBlob(same.id, file).then(function () { delete imageUrlCache[same.id]; same.cloud = false; });
            });
        }
        var id = uid();
        return storeFileBlob(id, file).then(function () {
            ex.images.push({ id: id, name: file.name, type: file.type, size: file.size, addedAt: Date.now() });
            imagesOpenInList[ex.id] = true;
            touchExercise(ex);
            stats.added++;
        });
    }
    // Fenêtre des images « perdues » : une ligne par image, avec aperçu, choix de l'exercice ou « Ne pas importer ».
    function askLostImages(lost, choices, okCount, done) {
        var overlay = document.createElement("div");
        overlay.className = "reimport-overlay";
        var box = document.createElement("div");
        box.className = "reimport-box";
        var h = document.createElement("div");
        h.className = "backups-title";
        h.textContent = "Images à rattacher";
        box.appendChild(h);
        var intro = document.createElement("div");
        intro.className = "gs-empty";
        intro.textContent = (okCount ? okCount + " image" + (okCount > 1 ? "s" : "") + " retrouvée" + (okCount > 1 ? "s" : "") + " automatiquement. " : "") + lost.length + " n'ont pas trouvé leur exercice (nom changé, exercice supprimé, ou plusieurs exercices du même nom). Choisis l'exercice de chacune, ou ne l'importe pas.";
        box.appendChild(intro);
        var list = document.createElement("div");
        list.className = "reimport-list";
        var selects = [];
        var urls = [];
        lost.forEach(function (item) {
            var row = document.createElement("div");
            row.className = "reimport-row";
            var im = document.createElement("img");
            var url = URL.createObjectURL(item.file); urls.push(url);
            im.src = url; im.alt = "";
            var right = document.createElement("div");
            right.className = "reimport-right";
            var nm = document.createElement("div");
            nm.className = "reimport-name";
            nm.textContent = item.file.name;
            var sel = document.createElement("select");
            var skip = document.createElement("option");
            skip.value = ""; skip.textContent = "Ne pas importer";
            sel.appendChild(skip);
            // Exercices du même titre d'abord (même si l'espace a changé), puis tous les autres.
            var title = item.parsed ? normName(item.parsed.title) : "";
            var pool = item.cands.length ? item.cands : choices.filter(function (c) { return title && normName(c.ex.title) === title; });
            var rest = choices.filter(function (c) { return pool.indexOf(c) === -1; });
            [pool, rest].forEach(function (grp, gi) {
                grp.forEach(function (c) {
                    var o = document.createElement("option");
                    o.value = c.ex.id; o.textContent = (gi === 0 && pool.length ? "★ " : "") + c.label;
                    sel.appendChild(o);
                });
            });
            if (pool.length === 1) sel.value = pool[0].ex.id; // une seule piste : présélectionnée (à confirmer)
            selects.push(sel);
            right.appendChild(nm); right.appendChild(sel);
            row.appendChild(im); row.appendChild(right);
            list.appendChild(row);
        });
        box.appendChild(list);
        var actions = document.createElement("div");
        actions.className = "reimport-actions";
        function close() { urls.forEach(function (u) { URL.revokeObjectURL(u); }); overlay.remove(); }
        var cancel = document.createElement("button");
        cancel.type = "button"; cancel.textContent = "Annuler";
        cancel.addEventListener("click", close);
        var ok = document.createElement("button");
        ok.type = "button"; ok.className = "btn-accent"; ok.textContent = "Importer";
        ok.addEventListener("click", function () {
            var assigned = [];
            lost.forEach(function (item, i) {
                var f = selects[i].value ? choices.filter(function (c) { return c.ex.id === selects[i].value; })[0] : null;
                if (f) assigned.push({ file: item.file, ex: f.ex });
            });
            close();
            done(assigned);
        });
        actions.appendChild(cancel); actions.appendChild(ok);
        box.appendChild(actions);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
    }

    document.getElementById("export-btn").addEventListener("click", function () {
        var dateStr = new Date().toISOString().slice(0, 10);
        var images = collectExportImages();
        var withImages = images.length > 0 && window.confirm("Exporter aussi les " + images.length + " image" + (images.length > 1 ? "s" : "") + " des exercices, dans un dossier « images » indépendant du fichier JSON ?\n\nOK = sauvegarde JSON + images\nAnnuler = sauvegarde JSON seulement");
        downloadJson(state, "trainhub-sauvegarde-" + dateStr + ".json");
        if (withImages) exportImages(images, dateStr);
    });

    // ---------- panneau des sauvegardes de secours ----------
    var $backupsBtn = document.getElementById("backups-btn");
    if ($backupsBtn) {
        $backupsBtn.addEventListener("click", openBackupsPanel);
    }

    function openBackupsPanel() {
        closeFolderMenu();
        if (closeActiveModal) closeActiveModal();
        var backdrop = document.createElement("div");
        backdrop.className = "ctx-backdrop";
        var panel = document.createElement("div");
        panel.className = "backups-panel";
        var cleanupResize = makePanelResizable(panel, "backups-panel");
        var dragHandle = document.createElement("div");
        dragHandle.className = "panel-drag-handle";
        dragHandle.title = "Faire glisser pour déplacer la fenêtre";
        panel.appendChild(dragHandle);
        var cleanupDrag = makePanelDraggable(panel, "backups-panel", dragHandle);

        var title = document.createElement("div");
        title.className = "backups-title panel-drag-by-title";
        title.title = "Faire glisser pour déplacer la fenêtre";
        title.textContent = "Sauvegardes de secours (sur cet appareil)";
        panel.appendChild(title);
        var cleanupTitleDrag = makePanelDraggable(panel, "backups-panel", title);

        var intro = document.createElement("div");
        intro.className = "backups-intro";
        intro.textContent = "Instantanés automatiques avant une synchro ou un import risqué.";
        panel.appendChild(intro);

        var list = document.createElement("div");
        list.className = "backups-list";
        var backups = loadBackups().slice().reverse();
        if (!backups.length) {
            var empty = document.createElement("div");
            empty.className = "backups-empty";
            empty.textContent = "Aucune sauvegarde de secours pour l'instant.";
            list.appendChild(empty);
        }
        backups.forEach(function (entry) {
            var row = document.createElement("div");
            row.className = "backups-row";

            var info = document.createElement("div");
            info.className = "backups-info";
            var when = document.createElement("div");
            when.className = "backups-when";
            when.textContent = formatUpdatedAt(entry.at) || new Date(entry.at).toLocaleString("fr-FR");
            info.appendChild(when);
            var reason = document.createElement("div");
            reason.className = "backups-reason";
            reason.textContent = entry.reason + " · " + entry.count + " exercice(s)";
            info.appendChild(reason);
            row.appendChild(info);

            var actions = document.createElement("div");
            actions.className = "backups-actions";
            var dlBtn = document.createElement("button");
            dlBtn.type = "button";
            dlBtn.className = "btn-ghost";
            dlBtn.textContent = "Télécharger";
            dlBtn.addEventListener("click", function () {
                downloadJson(JSON.parse(entry.json), "trainhub-secours-" + entry.at + ".json");
            });
            actions.appendChild(dlBtn);
            var restoreBtn = document.createElement("button");
            restoreBtn.type = "button";
            restoreBtn.className = "ctx-danger-solid";
            restoreBtn.textContent = "Restaurer";
            restoreBtn.addEventListener("click", function () {
                if (!window.confirm("Remplacer les données actuelles par cette sauvegarde (" + entry.count + " exercice(s), " + when.textContent + ") ?")) return;
                backupSnapshot("Avant restauration d'une sauvegarde de secours", state);
                state = normalizeState(JSON.parse(entry.json));
                if (!state.activeInstrumentId && state.instruments[0]) state.activeInstrumentId = state.instruments[0].id;
                navPaths = {};
                resetHistory();
                save();
                render();
                closeBackupsPanel();
            });
            actions.appendChild(restoreBtn);
            row.appendChild(actions);

            list.appendChild(row);
        });
        panel.appendChild(list);

        var closeRow = document.createElement("div");
        closeRow.className = "backups-close-row";
        var closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "btn-ghost";
        closeBtn.textContent = "Fermer";
        closeBtn.addEventListener("click", closeBackupsPanel);
        closeRow.appendChild(closeBtn);
        panel.appendChild(closeRow);

        var fitTimer = null;
        function closeBackupsPanel() {
            cleanupResize();
            cleanupDrag();
            cleanupTitleDrag();
            if (fitTimer) clearInterval(fitTimer);
            backdrop.remove();
            panel.remove();
            document.removeEventListener("keydown", onKey, true);
            unlockBodyScroll();
            if (closeActiveModal === closeBackupsPanel) closeActiveModal = null;
        }
        closeActiveModal = closeBackupsPanel;
        function onKey(e) { if (e.key === "Escape") closeBackupsPanel(); }
        backdrop.addEventListener("click", closeBackupsPanel);
        document.addEventListener("keydown", onKey, true);

        lockBodyScroll();
        panel.style.visibility = "hidden";
        document.body.appendChild(backdrop);
        document.body.appendChild(panel);
        var baseMin = basePanelMinSize("backups-panel");
        requestAnimationFrame(function () {
            recalcPanelFit(panel, baseMin.w, baseMin.h);
            var rect = panel.getBoundingClientRect();
            var w = rect.width, h = rect.height;
            var stored = loadPanelPositions()["backups-panel"];
            var left, top;
            if (stored) {
                var restored = clampPanelPosition(stored.left, stored.top, w);
                left = restored.left;
                top = restored.top;
            } else {
                left = Math.max(8, (window.innerWidth - w) / 2);
                top = Math.max(8, (window.innerHeight - h) / 2);
            }
            panel.style.left = left + "px";
            panel.style.top = top + "px";
            panel.style.visibility = "visible";
        });
        fitTimer = setInterval(function () { recalcPanelFit(panel, baseMin.w, baseMin.h); }, 400);
    }

    var $trashBtn = document.getElementById("trash-btn");
    if ($trashBtn) $trashBtn.addEventListener("click", openTrashPanel);

    function trashEntryLabel(entry) {
        if (entry.type === "exercise") return "Exercice · " + entry.data.title;
        if (entry.type === "folder") return "Dossier · " + entry.data.name;
        return "Session guidée · " + entry.data.name;
    }

    function openTrashPanel() {
        openModal("trash-panel", function (panel) {
            var title = document.createElement("div");
            title.className = "backups-title";
            title.textContent = "Corbeille";
            panel.appendChild(title);

            var intro = document.createElement("div");
            intro.className = "backups-intro";
            intro.textContent = "Exercices, dossiers et sessions supprimés récemment.";
            panel.appendChild(intro);

            var list = document.createElement("div");
            list.className = "backups-list";
            var trash = state.settings.trash;
            if (!trash.length) {
                var empty = document.createElement("div");
                empty.className = "backups-empty";
                empty.textContent = "La corbeille est vide.";
                list.appendChild(empty);
            }
            trash.forEach(function (entry) {
                var row = document.createElement("div");
                row.className = "backups-row";

                var info = document.createElement("div");
                info.className = "backups-info";
                var when = document.createElement("div");
                when.className = "backups-when";
                when.textContent = trashEntryLabel(entry);
                info.appendChild(when);
                var reason = document.createElement("div");
                reason.className = "backups-reason";
                reason.textContent = new Date(entry.deletedAt).toLocaleString("fr-FR");
                info.appendChild(reason);
                row.appendChild(info);

                var actions = document.createElement("div");
                actions.className = "backups-actions";
                var restoreBtn = document.createElement("button");
                restoreBtn.type = "button";
                restoreBtn.className = "btn-ghost";
                restoreBtn.textContent = "Restaurer";
                restoreBtn.addEventListener("click", function () {
                    restoreFromTrash(entry.id);
                    openTrashPanel();
                });
                actions.appendChild(restoreBtn);
                var purgeBtn = document.createElement("button");
                purgeBtn.type = "button";
                purgeBtn.className = "ctx-danger-solid";
                purgeBtn.textContent = "Supprimer définitivement";
                purgeBtn.addEventListener("click", function () {
                    if (!window.confirm("Supprimer définitivement cet élément ? Impossible à annuler.")) return;
                    purgeFromTrash(entry.id);
                    openTrashPanel();
                });
                actions.appendChild(purgeBtn);
                row.appendChild(actions);

                list.appendChild(row);
            });
            panel.appendChild(list);

            if (trash.length) {
                var emptyRow = document.createElement("div");
                emptyRow.className = "backups-close-row";
                var emptyAllBtn = document.createElement("button");
                emptyAllBtn.type = "button";
                emptyAllBtn.className = "ctx-danger-solid";
                emptyAllBtn.textContent = "Vider la corbeille";
                emptyAllBtn.addEventListener("click", function () {
                    if (!window.confirm("Vider définitivement la corbeille ?")) return;
                    emptyTrash();
                    openTrashPanel();
                });
                emptyRow.appendChild(emptyAllBtn);
                panel.appendChild(emptyRow);
            }
        });
    }

    var importInput = document.getElementById("import-input");
    document.getElementById("import-btn").addEventListener("click", function () {
        importInput.click();
    });
    importInput.addEventListener("change", function () {
        var file = importInput.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
            try {
                var parsed = JSON.parse(reader.result);
                if (!parsed || !Array.isArray(parsed.instruments)) throw new Error("format invalide");
                if (!window.confirm("Remplacer les données actuelles par cette sauvegarde ?")) return;
                backupSnapshot("Avant import d'un fichier JSON", state);
                state = normalizeState(parsed);
                if (!state.activeInstrumentId && state.instruments[0]) state.activeInstrumentId = state.instruments[0].id;
                navPaths = {};
                resetHistory();
                persist();
                render();
            } catch (e) {
                window.alert("Fichier de sauvegarde invalide.");
            }
        };
        reader.readAsText(file);
        importInput.value = "";
    });

    // ---------- petit modal générique (métronome, aides) ----------
    // Même habillage que le panneau des sauvegardes (.backups-panel), sans dupliquer sa logique de
    // fermeture (clic dehors / Échap) à chaque nouvel outil.
    // `build(panel, close)` peut renvoyer une fonction de nettoyage, appelée à la fermeture (le
    // métronome s'en sert pour couper le son quand on ferme le panneau). Un seul de ces modals
    // reste ouvert à la fois : en ouvrir un ferme le précédent (sinon son fond transparent bloque
    // les clics sur le reste de la page, bouton "Aides"/"Métronome" compris).
    var closeActiveModal = null;
    var activeModalKind = null; // famille de la fenêtre flottante ouverte (voir openModal), pour le raccourci Espace

    // Sans ceci, le fond de page défile sous la fenêtre flottante au doigt sur mobile (le panneau
    // est en position fixed, mais le corps de la page reste scrollable derrière).
    function lockBodyScroll() { document.documentElement.classList.add("modal-open"); }
    function unlockBodyScroll() { document.documentElement.classList.remove("modal-open"); }

    // ---------- volet du métronome intégré à la page (session guidée) ----------
    // Écran scindé : la session reste à gauche, le métronome vit dans #metro-dock à droite (ou en
    // bandeau en bas quand l'écran est trop étroit, voir style.css). Contrairement à la fenêtre
    // flottante, il ne se referme pas quand on clique ailleurs : on règle la session sans le perdre.
    var $metroDock = document.getElementById("metro-dock");
    // Préférence « accroché à droite » du métronome : "1" = toujours dans le volet, "0" = toujours en
    // fenêtre flottante, absent = automatique (volet pendant une session guidée, fenêtre sinon).
    // Propre à cet appareil (taille d'écran) : localStorage, pas synchronisé.
    var METRO_DOCK_PREF_KEY = "trainhub.metroDock.v1";
    function getMetroDockPref() {
        try { var v = localStorage.getItem(METRO_DOCK_PREF_KEY); return v === "1" || v === "0" ? v : null; } catch (e) { return null; }
    }
    function setMetroDockPref(v) {
        try { localStorage.setItem(METRO_DOCK_PREF_KEY, v); } catch (e) {}
    }
    var closeDockedMetronome = null; // non nul tant que le métronome est dans le volet
    var metroDockCollapsed = false;  // volet réduit (en-tête + Jouer seulement) : retenu le temps de la page
    function updateMetroDockMetrics() {
        var root = document.documentElement;
        var bar = document.querySelector(".top-bar");
        if (bar) root.style.setProperty("--topbar-h", bar.offsetHeight + "px");
        if ($metroDock && !$metroDock.hidden) root.style.setProperty("--metro-dock-h", $metroDock.offsetHeight + "px");
    }
    // ---- taille réglable du volet (largeur et hauteur) ----
    // En colonne à droite : poignée sur le bord gauche (largeur) et sur le bord bas (hauteur) ; la zone
    // principale, en flex, suit toute seule. En bandeau en bas : poignée sur le bord haut (hauteur).
    // Le contenu du métronome se met à l'échelle pour tenir dans la taille choisie (voir
    // fitPanelContentZoom). Taille retenue sur cet appareil ; double-clic sur une poignée = taille d'origine.
    var METRO_DOCK_SIZE_KEY = "trainhub.metroDockSize.v1";
    function loadMetroDockSize() {
        try { return JSON.parse(localStorage.getItem(METRO_DOCK_SIZE_KEY)) || {}; } catch (e) { return {}; }
    }
    function saveMetroDockSize(sz) {
        try { localStorage.setItem(METRO_DOCK_SIZE_KEY, JSON.stringify(sz)); } catch (e) {}
    }
    function metroDockIsBottom() { return window.matchMedia && window.matchMedia("(max-width: 1099px)").matches; }
    function applyMetroDockSize() {
        if (!$metroDock) return;
        var sz = loadMetroDockSize(), st = $metroDock.style;
        var topbar = (document.querySelector(".top-bar") || { offsetHeight: 64 }).offsetHeight;
        ["--metro-dock-w", "--metro-panel-h", "--metro-dock-max-h"].forEach(function (v) { st.removeProperty(v); });
        if (metroDockIsBottom()) {
            if (typeof sz.bh === "number") {
                var bmax = Math.round(window.innerHeight * 0.85);
                st.setProperty("--metro-panel-h", Math.min(bmax, Math.max(150, sz.bh)) + "px");
                st.setProperty("--metro-dock-max-h", bmax + "px");
            }
        } else {
            if (typeof sz.w === "number") st.setProperty("--metro-dock-w", Math.min(Math.round(window.innerWidth * 0.6), 760, Math.max(300, sz.w)) + "px");
            if (typeof sz.h === "number") {
                var smax = window.innerHeight - topbar - 28;
                st.setProperty("--metro-panel-h", Math.min(smax, Math.max(220, sz.h)) + "px");
                st.setProperty("--metro-dock-max-h", smax + "px");
            }
        }
        updateMetroDockMetrics();
    }
    function makeMetroDockGrip(kind, panel) {
        var grip = document.createElement("div");
        grip.className = "metro-dock-grip metro-dock-grip-" + kind;
        grip.title = (kind === "w" ? "Glisser pour élargir ou rétrécir le métronome" : "Glisser pour agrandir ou réduire la hauteur du métronome") + " (double-clic : taille d'origine)";
        var startX = 0, startY = 0, startW = 0, startH = 0, dragging = false;
        grip.addEventListener("pointerdown", function (e) {
            if (e.button !== undefined && e.button !== 0) return;
            e.preventDefault();
            dragging = true;
            startX = e.clientX; startY = e.clientY;
            startW = $metroDock.getBoundingClientRect().width;
            startH = panel.getBoundingClientRect().height;
            try { grip.setPointerCapture(e.pointerId); } catch (err) {}
            document.documentElement.classList.add("metro-dock-resizing");
        });
        grip.addEventListener("pointermove", function (e) {
            if (!dragging) return;
            var sz = loadMetroDockSize();
            if (kind === "w") sz.w = startW + (startX - e.clientX); // bord gauche : tirer vers la gauche élargit
            else if (metroDockIsBottom()) sz.bh = startH + (startY - e.clientY); // bord haut du bandeau
            else sz.h = startH + (e.clientY - startY); // bord bas de la colonne
            saveMetroDockSize(sz);
            applyMetroDockSize();
        });
        function stop() { dragging = false; document.documentElement.classList.remove("metro-dock-resizing"); }
        grip.addEventListener("pointerup", stop);
        grip.addEventListener("pointercancel", stop);
        grip.addEventListener("dblclick", function () {
            var sz = loadMetroDockSize();
            if (kind === "w") delete sz.w; else if (metroDockIsBottom()) delete sz.bh; else delete sz.h;
            saveMetroDockSize(sz);
            applyMetroDockSize();
        });
        return grip;
    }

    function attachMetroDock(panel) {
        $metroDock.appendChild(panel);
        $metroDock.appendChild(makeMetroDockGrip("w", panel));
        $metroDock.appendChild(makeMetroDockGrip("h", panel));
        $metroDock.hidden = false;
        document.documentElement.classList.add("metro-docked");
        applyMetroDockSize();
    }
    function releaseMetroDock() {
        closeDockedMetronome = null;
        if ($metroDock) {
            $metroDock.hidden = true;
            Array.prototype.forEach.call($metroDock.querySelectorAll(".metro-dock-grip"), function (g) { g.remove(); });
        }
        document.documentElement.classList.remove("metro-docked");
        document.documentElement.style.removeProperty("--metro-dock-h");
    }
    window.addEventListener("resize", function () { if ($metroDock && !$metroDock.hidden) applyMetroDockSize(); else updateMetroDockMetrics(); });
    if ($metroDock && typeof ResizeObserver !== "undefined") new ResizeObserver(updateMetroDockMetrics).observe($metroDock);

    // ---------- taille des fenêtres flottantes (redimensionnables à la main) ----------
    // Persisté par "famille" de fenêtre (métronome, cercle des quintes, gammes…), pas par instance :
    // rouvrir le même outil retrouve sa dernière taille. Volontairement en localStorage (pas dans
    // `state`) : une préférence d'affichage liée à CET écran, pas une donnée à synchroniser entre
    // appareils aux résolutions différentes.
    var PANEL_SIZES_KEY = "trainhub.panelSizes.v1";
    function loadPanelSizes() {
        try { return JSON.parse(localStorage.getItem(PANEL_SIZES_KEY)) || {}; } catch (e) { return {}; }
    }
    function savePanelSize(kind, width, height) {
        try {
            var sizes = loadPanelSizes();
            sizes[kind] = { width: width, height: height };
            localStorage.setItem(PANEL_SIZES_KEY, JSON.stringify(sizes));
        } catch (e) {}
    }

    // Position retenue par famille de fenêtre, comme la taille ci-dessus — une vraie fenêtre de
    // bureau qu'on déplace à la souris doit se souvenir d'où on l'a laissée.
    var PANEL_POS_KEY = "trainhub.panelPos.v1";
    function loadPanelPositions() {
        try { return JSON.parse(localStorage.getItem(PANEL_POS_KEY)) || {}; } catch (e) { return {}; }
    }
    function savePanelPosition(kind, left, top) {
        try {
            var pos = loadPanelPositions();
            pos[kind] = { left: left, top: top };
            localStorage.setItem(PANEL_POS_KEY, JSON.stringify(pos));
        } catch (e) {}
    }
    function isMobilePanelLayout() {
        return window.matchMedia && window.matchMedia("(max-width: 700px)").matches;
    }

    // Taille minimale "de base" par famille de fenêtre (reflète les min-width/min-height posés en
    // CSS pour chaque .xxx-panel) : point de départ de recalcPanelFit, qui ne descend jamais en
    // dessous de ces valeurs même quand le contenu est très court.
    var PANEL_BASE_MIN_SIZE = {
        "aides-panel": { w: 300, h: 320 },
        "scales-panel": { w: 320, h: 200 },
        "folder-picker-panel": { w: 280, h: 280 }
    };
    function basePanelMinSize(kind) {
        return PANEL_BASE_MIN_SIZE[kind] || { w: 280, h: 180 };
    }

    // Comme une vraie fenêtre : elle peut dépasser en partie des bords de l'écran (sinon une fenêtre
    // aussi haute que l'écran ne pouvait plus bouger qu'à l'horizontale) ; seule sa barre du haut
    // reste toujours à l'écran, pour pouvoir la reprendre. Même règle au glisser et à la réouverture.
    function clampPanelPosition(left, top, width) {
        return {
            left: Math.min(Math.max(-(width - 120), left), window.innerWidth - 120),
            top: Math.min(Math.max(0, top), window.innerHeight - 48)
        };
    }

    // Permet de faire glisser `panel` à la souris/au doigt depuis `handle` — comme une vraie fenêtre
    // de bureau. Désactivé sur téléphone (le panneau y prend tout l'écran, voir CSS).
    function makePanelDraggable(panel, kind, handle) {
        var dragging = false;
        var startX = 0, startY = 0, startLeft = 0, startTop = 0;
        function onDown(e) {
            if (isMobilePanelLayout()) return;
            dragging = true;
            startX = e.clientX; startY = e.clientY;
            var rect = panel.getBoundingClientRect();
            startLeft = rect.left; startTop = rect.top;
            if (handle.setPointerCapture) { try { handle.setPointerCapture(e.pointerId); } catch (err) {} }
            e.preventDefault();
        }
        function onMove(e) {
            if (!dragging) return;
            var pos = clampPanelPosition(startLeft + (e.clientX - startX), startTop + (e.clientY - startY), panel.offsetWidth);
            panel.style.left = pos.left + "px";
            panel.style.top = pos.top + "px";
        }
        function onUp() {
            if (!dragging) return;
            dragging = false;
            savePanelPosition(kind, parseFloat(panel.style.left) || 0, parseFloat(panel.style.top) || 0);
        }
        handle.addEventListener("pointerdown", onDown);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        return function cleanup() {
            handle.removeEventListener("pointerdown", onDown);
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
    }

    // Recalcule en continu la taille minimale de `panel` pour qu'elle ne soit jamais inférieure à
    // ce que le contenu occupe réellement : plutôt que de faire apparaître un ascenseur, la fenêtre
    // grandit (min-width/min-height l'emportent sur une largeur/hauteur de base trop petite). Le cas
    // du manche (.fretboard-scroll, gammes/arpèges) est traité à part : son propre débordement
    // horizontal est ajouté au besoin en largeur du panneau, pour que le manche n'ait besoin de
    // défiler que quand l'écran est réellement trop petit (la limite haute ci-dessous).
    function recalcPanelFit(panel, baseMinW, baseMinH) {
        var maxW = Math.max(200, window.innerWidth - 24);
        var maxH = Math.max(150, window.innerHeight - 24);
        // On remet le plancher à la valeur de base AVANT de mesurer : sinon panel.scrollHeight/
        // scrollWidth reflète la taille déjà imposée par le précédent min-width/min-height (le
        // panneau ne pourrait alors plus jamais rétrécir après un contenu replié, puisque chaque
        // mesure se fonderait sur sa propre taille gonflée — un plancher qui ne fait que grandir).
        if (panel.style.minWidth !== baseMinW + "px") panel.style.minWidth = baseMinW + "px";
        if (panel.style.minHeight !== baseMinH + "px") panel.style.minHeight = baseMinH + "px";
        var neededH = Math.min(panel.scrollHeight, maxH);
        var neededW = panel.scrollWidth;
        var fb = panel.querySelector(".fretboard-scroll");
        if (fb && fb.scrollWidth > fb.clientWidth) neededW += (fb.scrollWidth - fb.clientWidth);
        neededW = Math.min(neededW, maxW);
        var w = Math.max(baseMinW, neededW) + "px";
        var h = Math.max(baseMinH, neededH) + "px";
        if (panel.style.minWidth !== w) panel.style.minWidth = w;
        if (panel.style.minHeight !== h) panel.style.minHeight = h;
    }
    // ---------- fenêtres "à contenu ajustable" (métronome) ----------
    // La taille de la fenêtre reste libre (poignée de redimensionnement, minimum fixé en CSS) et
    // c'est le contenu qui s'adapte à la place disponible : un zoom CSS uniforme (jamais au-delà de
    // 100 %) le réduit juste assez pour tout montrer, au lieu de bloquer la fenêtre à la taille du
    // contenu (impossible alors de la réduire) ou de faire apparaître un ascenseur. Tant qu'on ne l'a
    // pas redimensionnée à la main, la fenêtre suit d'elle-même la taille du contenu, bornée à l'écran.
    //
    // Le débordement se lit sur `box` (parent sans zoom, overflow hidden) : ses scrollWidth/Height
    // reflètent la taille réellement occupée par le contenu zoomé, quel que soit le navigateur —
    // les mesures de l'élément zoomé lui-même ne sont pas exprimées pareil partout.
    var PANEL_FIT_MIN_ZOOM = 0.3;
    function fitPanelContentZoom(box, inner) {
        if (!box.clientHeight || !box.clientWidth) return 1;
        function fitsAt(z) {
            inner.style.zoom = z >= 1 ? "" : String(z);
            return box.scrollHeight <= box.clientHeight + 1 && box.scrollWidth <= box.clientWidth + 1;
        }
        if (fitsAt(1)) return 1;
        var lo = PANEL_FIT_MIN_ZOOM, hi = 1;
        for (var i = 0; i < 9; i++) {
            var mid = (lo + hi) / 2;
            if (fitsAt(mid)) lo = mid; else hi = mid;
        }
        fitsAt(lo);
        return lo;
    }
    // Taille "naturelle" (zoom 100 %) d'une fenêtre à contenu ajustable : largeur par défaut de la
    // feuille de style, élargie si besoin pour que le pavé rythmique tienne sur une ligne, et
    // hauteur du contenu — le tout borné à l'écran.
    function autoSizeFitPanel(panel, inner) {
        inner.style.zoom = "";
        panel.style.width = "";
        panel.style.height = "";
        var w = panel.offsetWidth;
        var pad = inner.querySelector(".metro-pad");
        if (pad && !pad.hidden && pad.children.length) {
            var padGap = parseFloat(getComputedStyle(pad).columnGap) || 0;
            var padNeeded = 0;
            for (var gi = 0; gi < pad.children.length; gi++) padNeeded += pad.children[gi].offsetWidth;
            padNeeded += padGap * (pad.children.length - 1) + (panel.offsetWidth - pad.clientWidth);
            w = Math.max(w, Math.ceil(padNeeded));
        }
        w = Math.min(w, window.innerWidth - 16);
        panel.style.width = w + "px";
        var h = Math.min(panel.offsetHeight, window.innerHeight - 16);
        panel.style.height = h + "px";
        return { w: w, h: h };
    }

    // Rend `panel` redimensionnable (voir resize:both en CSS sur .backups-panel) et persiste la
    // taille choisie. Pas de ResizeObserver générique : il se déclencherait aussi pour des
    // changements de taille dus au CONTENU (déplier le volume, changer d'onglet…), pas seulement à
    // un vrai redimensionnement manuel — on ne retient donc que les redimensionnements commencés
    // depuis le coin bas-droit (la poignée native du navigateur).
    function makePanelResizable(panel, kind, onResizeStart) {
        var stored = loadPanelSizes()[kind];
        if (stored) {
            panel.style.width = stored.width + "px";
            panel.style.height = stored.height + "px";
        }
        var resizing = false;
        var HANDLE_ZONE = 24;
        function onPointerDown(e) {
            var rect = panel.getBoundingClientRect();
            if (e.clientX > rect.right - HANDLE_ZONE && e.clientY > rect.bottom - HANDLE_ZONE) {
                resizing = true;
                if (onResizeStart) onResizeStart();
            }
        }
        function onPointerUp() {
            if (!resizing) return;
            resizing = false;
            savePanelSize(kind, panel.offsetWidth, panel.offsetHeight);
        }
        panel.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("pointerup", onPointerUp);
        return function cleanup() {
            panel.removeEventListener("pointerdown", onPointerDown);
            window.removeEventListener("pointerup", onPointerUp);
        };
    }

    // `opts.fitContent` : fenêtre à contenu ajustable (voir fitPanelContentZoom) — réservé au
    // métronome pour l'instant ; les autres outils gardent un contenu qui fixe leur taille minimale.
    //
    // `opts.dock` : le panneau n'est plus une fenêtre flottante mais un volet intégré à la page
    // (colonne à droite sur grand écran, bandeau en bas sinon — voir #metro-dock). Il est alors non
    // modal : pas de fond qui capte les clics (sinon le moindre clic ailleurs le refermait), pas de
    // blocage du défilement, pas de fermeture par Échap ni par l'ouverture d'un autre outil, et pas
    // de déplacement/redimensionnement à la main. Réservé au métronome pendant une session guidée.
    function openModal(extraClass, build, opts) {
        var docked = !!(opts && opts.dock);
        closeFolderMenu();
        if (!docked) {
            if (closeActiveModal) closeActiveModal();
            lockBodyScroll();
        }
        var fitContent = !!(opts && opts.fitContent);
        var backdrop = docked ? null : document.createElement("div");
        if (backdrop) backdrop.className = "ctx-backdrop";
        var panel = document.createElement("div");
        panel.className = "backups-panel" + (extraClass ? " " + extraClass : "") + (fitContent ? " panel-fit-content" : "") + (docked ? " panel-docked" : "");
        var panelKind = extraClass ? extraClass.split(" ")[0] : "modal";
        var baseMin = basePanelMinSize(panelKind);
        // Redimensionnée à la main (maintenant ou lors d'une ouverture précédente) : la fenêtre garde
        // la taille choisie au lieu de suivre celle du contenu.
        var userSized = docked ? true : !!loadPanelSizes()[panelKind];
        var cleanupResize = docked ? function () {} : makePanelResizable(panel, panelKind, function () { userSized = true; });

        var dragHandle = document.createElement("div");
        dragHandle.className = "panel-drag-handle";
        dragHandle.title = "Faire glisser pour déplacer la fenêtre";
        var cleanupDrag = function () {};
        if (!docked) {
            panel.appendChild(dragHandle);
            cleanupDrag = makePanelDraggable(panel, panelKind, dragHandle);
        }
        var cleanupTitleDrag = null;

        var onClose = null;
        var fitTimer = null;
        var fitBox = null, fitInner = null;
        var resizeObs = null, mutationObs = null, fitFrame = null;

        function close() {
            if (onClose) onClose();
            cleanupResize();
            cleanupDrag();
            if (cleanupTitleDrag) cleanupTitleDrag();
            if (fitTimer) clearInterval(fitTimer);
            if (resizeObs) resizeObs.disconnect();
            if (mutationObs) mutationObs.disconnect();
            if (fitFrame) cancelAnimationFrame(fitFrame);
            if (backdrop) backdrop.remove();
            panel.remove();
            document.removeEventListener("keydown", onKey, true);
            if (docked) {
                releaseMetroDock();
            } else {
                unlockBodyScroll();
                if (closeActiveModal === close) { closeActiveModal = null; activeModalKind = null; }
            }
        }
        function onKey(e) { if (e.key === "Escape") close(); }
        if (!docked) {
            backdrop.addEventListener("click", close);
            document.addEventListener("keydown", onKey, true);
            closeActiveModal = close;
            activeModalKind = panelKind;
        }

        onClose = build(panel, close) || null;

        // Le titre de l'outil (visible, contrairement à la fine poignée du dessus) est lui aussi une
        // zone de prise pour déplacer la fenêtre — plus facile à trouver que la seule bande dédiée.
        var titleEl = panel.querySelector(".backups-title");
        if (titleEl && !docked) {
            titleEl.classList.add("panel-drag-by-title");
            titleEl.title = "Faire glisser pour déplacer la fenêtre";
            cleanupTitleDrag = makePanelDraggable(panel, panelKind, titleEl);
        }

        var closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "btn-ghost";
        closeBtn.addEventListener("click", close);
        if (docked) {
            // Volet intégré : pas de ligne "Fermer" en bas (de la hauteur gagnée pour le contenu),
            // une croix dans l'en-tête, à côté du bouton Volume.
            closeBtn.classList.add("panel-dock-close");
            closeBtn.textContent = "✕";
            closeBtn.title = "Fermer le métronome";
            closeBtn.setAttribute("aria-label", "Fermer le métronome");
            var dockHeader = panel.querySelector(".metro-header-row") || panel;
            // Réduire : ne garde que l'en-tête et le bouton Jouer/Arrêter (bandeau du bas, quand
            // l'écran est trop étroit pour une colonne : laisse la place au chrono de la session).
            var collapseBtn = document.createElement("button");
            collapseBtn.type = "button";
            collapseBtn.className = "btn-ghost panel-dock-collapse";
            function refreshCollapseBtn() {
                panel.classList.toggle("panel-dock-collapsed", metroDockCollapsed);
                collapseBtn.textContent = metroDockCollapsed ? "▴" : "▾";
                collapseBtn.title = metroDockCollapsed ? "Agrandir le métronome" : "Réduire le métronome";
                collapseBtn.setAttribute("aria-label", collapseBtn.title);
            }
            collapseBtn.addEventListener("click", function () { metroDockCollapsed = !metroDockCollapsed; refreshCollapseBtn(); });
            refreshCollapseBtn();
            dockHeader.appendChild(collapseBtn);
            dockHeader.appendChild(closeBtn);
        } else {
            var closeRow = document.createElement("div");
            closeRow.className = "backups-close-row";
            closeBtn.textContent = "Fermer";
            closeRow.appendChild(closeBtn);
            panel.appendChild(closeRow);
        }

        // Contenu ajustable : tout sauf la poignée passe dans une boîte (taille dispo, sans zoom) qui
        // contient le contenu zoomé — voir fitPanelContentZoom.
        if (fitContent) {
            fitBox = document.createElement("div");
            fitBox.className = "panel-fit-box";
            fitInner = document.createElement("div");
            fitInner.className = "panel-fit-inner";
            Array.prototype.slice.call(panel.children).forEach(function (child) {
                if (child !== dragHandle) fitInner.appendChild(child);
            });
            fitBox.appendChild(fitInner);
            panel.appendChild(fitBox);
        }

        function refit() {
            if (!fitContent) { recalcPanelFit(panel, baseMin.w, baseMin.h); return; }
            if (!userSized && !docked && !isMobilePanelLayout() && panel.isConnected) {
                var prevH = panel.offsetHeight, prevW = panel.offsetWidth;
                var size = autoSizeFitPanel(panel, fitInner);
                // Le contenu a grandi (ex. "…" déplié) : on remonte/décale la fenêtre si elle sort
                // maintenant de l'écran — seulement à ce moment-là, pour ne pas contrarier une fenêtre
                // qu'on a volontairement poussée en partie hors de l'écran.
                if (panel.style.visibility !== "hidden" && (size.h > prevH + 1 || size.w > prevW + 1)) {
                    var rect = panel.getBoundingClientRect();
                    if (rect.bottom > window.innerHeight - 8) panel.style.top = Math.max(8, window.innerHeight - 8 - size.h) + "px";
                    if (rect.right > window.innerWidth - 8) panel.style.left = Math.max(8, window.innerWidth - 8 - size.w) + "px";
                }
            }
            fitPanelContentZoom(fitBox, fitInner);
        }
        function scheduleRefit() {
            if (fitFrame) return;
            fitFrame = requestAnimationFrame(function () { fitFrame = null; refit(); });
        }

        panel.style.visibility = "hidden";
        if (docked) {
            attachMetroDock(panel);
        } else {
            document.body.appendChild(backdrop);
            document.body.appendChild(panel);
        }

        if (fitContent) {
            // Redimensionnement à la main : le zoom suit en direct. Changement de contenu (pavé
            // redessiné, réglages dépliés…) : la fenêtre et le zoom se réajustent tout de suite,
            // sans attendre le prochain passage de l'intervalle ci-dessous.
            if (typeof ResizeObserver !== "undefined") {
                resizeObs = new ResizeObserver(scheduleRefit);
                resizeObs.observe(panel);
            }
            if (typeof MutationObserver !== "undefined") {
                mutationObs = new MutationObserver(scheduleRefit);
                mutationObs.observe(fitInner, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
            }
        }

        // Position initiale : taille/position mémorisées si on a déjà ouvert cet outil, sinon centré
        // — posée en px une fois le panneau mesurable, pour ne jamais voir le saut depuis (0,0).
        requestAnimationFrame(function () {
            refit();
            if (docked) { panel.style.visibility = "visible"; return; }
            var rect = panel.getBoundingClientRect();
            var w = rect.width, h = rect.height;
            var stored = loadPanelPositions()[panelKind];
            var left, top;
            if (stored) {
                var restored = clampPanelPosition(stored.left, stored.top, w);
                left = restored.left;
                top = restored.top;
            } else if (panelKind === "metronome-panel") {
                // Pas encore déplacé à la main : on part du point de départ choisi dans les réglages
                // (centre/haut/bas/coin) plutôt que du centre pur.
                var pref = state.settings.appearance.metronomePosition;
                left = Math.max(8, (window.innerWidth - w) / 2);
                top = Math.max(8, (window.innerHeight - h) / 2);
                if (pref === "top") { top = 84; }
                else if (pref === "bottom") { top = Math.max(8, window.innerHeight - h - 16); }
                else if (pref === "corner") { left = Math.max(8, window.innerWidth - w - 16); top = Math.max(8, window.innerHeight - h - 16); }
            } else {
                left = Math.max(8, (window.innerWidth - w) / 2);
                top = Math.max(8, (window.innerHeight - h) / 2);
            }
            panel.style.left = left + "px";
            panel.style.top = top + "px";
            panel.style.visibility = "visible";
        });
        // Filet de sécurité (changements que les observateurs ne voient pas : classe qui change une
        // marge, taille de l'écran…) ; pour une fenêtre déjà ajustée, ne refait rien de visible.
        fitTimer = setInterval(refit, 400);

        return close;
    }

    // ---------- choisir un dossier de destination (déplacer / fusionner) ----------
    // Arborescence de TOUT l'instrument courant, dans le même style que le bandeau latéral —
    // `excludeIds` masque la branche qu'on déplace elle-même (impossible de la déposer dans l'un de
    // ses propres sous-dossiers, ce qui créerait un cycle).
    function openFolderPickerModal(titleText, excludeIds, onPick) {
        openModal("folder-picker-panel", function (panel, close) {
            var title = document.createElement("div");
            title.className = "backups-title";
            title.textContent = titleText;
            panel.appendChild(title);

            var hint = document.createElement("div");
            hint.className = "backups-intro";
            hint.textContent = "Clique le nom d'un dossier pour le choisir ; la flèche déplie ses sous-dossiers.";
            panel.appendChild(hint);

            var treeWrap = document.createElement("div");
            treeWrap.className = "folder-picker-tree";
            panel.appendChild(treeWrap);

            // Rendu local, pas le render() global : ce panneau flottant vit hors du cycle de rendu
            // normal de l'appli (comme tous les panneaux ouverts via openModal), un render() global
            // ne le rafraîchirait pas.
            function refreshTree() {
                treeWrap.innerHTML = "";
                renderNode(treeWrap, getActiveInstrument().categories, 0, null);
            }

            function renderNode(container, folders, depth, rootColor) {
                folders.forEach(function (folder) {
                    if (excludeIds.indexOf(folder.id) !== -1) return;
                    var color = depth === 0 ? folder.color : rootColor;
                    var hasChildren = folder.folders.length > 0;
                    var expanded = treeExpanded["picker:" + folder.id] !== false;

                    var node = document.createElement("div");
                    node.className = "gs-pick-node";
                    var row = document.createElement("div");
                    row.className = "gs-pick-tree-row";
                    if (depth === 0) {
                        row.style.borderLeft = "3px solid " + color;
                        row.style.background = "color-mix(in srgb, " + color + " 6%, transparent)";
                    }
                    var twisty = document.createElement("button");
                    twisty.type = "button";
                    twisty.className = "tree-twisty" + (hasChildren ? "" : " tree-twisty-empty") + (expanded ? " expanded" : "");
                    twisty.innerHTML = CHEVRON_ICON_SVG;
                    if (hasChildren) {
                        twisty.addEventListener("click", function (e) {
                            e.stopPropagation();
                            treeExpanded["picker:" + folder.id] = !expanded;
                            refreshTree();
                        });
                    }
                    row.appendChild(twisty);
                    var label = document.createElement("button");
                    label.type = "button";
                    label.className = "gs-pick-exercise-row folder-picker-choose-btn";
                    label.textContent = folder.name;
                    label.addEventListener("click", function () {
                        close();
                        onPick(folder);
                    });
                    row.appendChild(label);
                    node.appendChild(row);

                    if (expanded && hasChildren) {
                        var childWrap = document.createElement("div");
                        childWrap.className = "gs-pick-tree-children";
                        renderNode(childWrap, folder.folders, depth + 1, color);
                        node.appendChild(childWrap);
                    }
                    container.appendChild(node);
                });
            }
            refreshTree();
        });
    }

    // ---------- métronome ----------
    // Réglages persistés et synchronisés (state.settings.metronome) : tempo, nombre de temps par
    // mesure et motif d'accents (0 = silence, 1 = normal, 2 = temps fort), plus une subdivision -
    // le nombre de pas de pavé par temps (0.5 = blanche, un pas tous les 2 temps ; 1 = noire ; 2 =
    // croches ; 3 = triolet ; 4 = doubles-croches). Le son est généré à la volée (Web Audio API),
    // rien à télécharger.
    // Un "groupe" de pavé correspond à un temps pour une subdivision >= 1 (ex. 2 pas en croches) et
    // à un seul pas pour la blanche (0.5), où un pas couvre justement 2 temps à lui seul.
    function metroGroupSize(subdivision) { return subdivision >= 1 ? subdivision : 1; }
    function normalizeMetronomeSettings(settings) {
        if (!settings.metronome || typeof settings.metronome !== "object") settings.metronome = {};
        var m = settings.metronome;
        if (typeof m.bpm !== "number" || isNaN(m.bpm) || m.bpm < 30 || m.bpm > 300) m.bpm = 100;
        m.bpm = Math.round(m.bpm);
        if (typeof m.volume !== "number" || isNaN(m.volume) || m.volume < 0 || m.volume > 1) m.volume = 0.8;
        if (typeof m.beatsPerMeasure !== "number" || isNaN(m.beatsPerMeasure) || m.beatsPerMeasure < 1 || m.beatsPerMeasure > 12) m.beatsPerMeasure = 4;
        m.beatsPerMeasure = Math.round(m.beatsPerMeasure);
        if ([0.5, 1, 2, 3, 4].indexOf(m.subdivision) === -1) m.subdivision = 1;
        if (typeof m.rhythmLabel !== "string") m.rhythmLabel = null;
        var groupSize = metroGroupSize(m.subdivision);
        var stepCount = Math.max(1, Math.round(m.beatsPerMeasure * m.subdivision));
        // Ancien format (un seul accent par TEMPS, sans pavé rythmique) : migré vers un motif par PAS
        // en plaçant chaque ancien accent sur le 1er pas de son temps, le reste muet.
        if (!Array.isArray(m.pattern) && Array.isArray(m.accents)) {
            var migrated = [];
            for (var b = 0; b < m.beatsPerMeasure; b++) {
                for (var s = 0; s < groupSize; s++) migrated.push(s === 0 ? (m.accents[b] != null ? m.accents[b] : 1) : 0);
            }
            m.pattern = migrated;
            delete m.accents;
        }
        if (!Array.isArray(m.pattern)) m.pattern = [];
        while (m.pattern.length < stepCount) {
            var idx = m.pattern.length;
            m.pattern.push(idx === 0 ? 2 : (idx % groupSize === 0 ? 1 : 0));
        }
        m.pattern.length = stepCount;
        for (var i = 0; i < m.pattern.length; i++) {
            if ([0, 1, 2].indexOf(m.pattern[i]) === -1) m.pattern[i] = 1;
        }
        // Deux couches distinctes : le pavé simple (un pas par temps, ce que montre la formule
        // rythmique : 4/4 = 4 cases) et le pavé détaillé (subdivision + motif ci-dessus), qui ne sert
        // que quand "…" est activé (m.advanced). Chacune garde son propre motif : refermer "…" revient
        // aux temps de la formule sans perdre le rythme composé, qu'on retrouve en rouvrant "…".
        if (typeof m.advanced !== "boolean") m.advanced = m.subdivision !== 1; // réglages d'avant : ne pas changer ce qui se jouait
        if (!Array.isArray(m.beatPattern)) {
            m.beatPattern = [];
            for (var bp = 0; bp < m.beatsPerMeasure; bp++) {
                var fromPattern = m.subdivision >= 1 ? m.pattern[bp * m.subdivision] : null;
                m.beatPattern.push([0, 1, 2].indexOf(fromPattern) !== -1 ? fromPattern : (bp === 0 ? 2 : 1));
            }
        }
        while (m.beatPattern.length < m.beatsPerMeasure) m.beatPattern.push(m.beatPattern.length === 0 ? 2 : 1);
        m.beatPattern.length = m.beatsPerMeasure;
        for (var j = 0; j < m.beatPattern.length; j++) {
            if ([0, 1, 2].indexOf(m.beatPattern[j]) === -1) m.beatPattern[j] = 1;
        }
        // Tempo progressif (désactivé par défaut) : augmente le BPM tout seul pendant la lecture, selon
        // une DURÉE (toutes les N secondes) et non un nombre de mesures — sinon, à mesure que le tempo
        // monte, les mesures passent plus vite et l'augmentation s'accélère. Voir metroScheduler.
        // Version 2 : passage des mesures aux secondes ; les anciens réglages (en mesures) sont
        // remplacés une fois par les valeurs par défaut (+1 BPM toutes les 20 s).
        if (!m.progressive || typeof m.progressive !== "object") m.progressive = {};
        if (typeof m.progressive.enabled !== "boolean") m.progressive.enabled = false;
        if (!(m.progressive.version >= 2)) {
            m.progressive.incrementBpm = 1;
            m.progressive.everySeconds = 20;
            delete m.progressive.everyMeasures;
        }
        // Version 3 : seuil (le tempo monte jusque-là puis reste), paliers successifs et options.
        // limitBpm 0 = pas de seuil. stages : [{ inc, every, until }] ; le premier palier part du tempo
        // en cours, chacun monte jusqu'à son "until" puis laisse la place au suivant.
        m.progressive.version = 3;
        var pr = m.progressive;
        pr.limitBpm = (typeof pr.limitBpm === "number" && pr.limitBpm >= 30) ? Math.min(300, Math.round(pr.limitBpm)) : 0;
        pr.stagesMode = pr.stagesMode === true;
        if (!Array.isArray(pr.stages)) pr.stages = [];
        pr.stages = pr.stages.filter(function (st) { return st && typeof st === "object"; }).map(function (st) {
            return {
                inc: Math.min(50, Math.max(1, Math.round(Number(st.inc)) || 1)),
                every: Math.min(600, Math.max(1, Math.round(Number(st.every)) || 20)),
                until: Math.min(300, Math.max(30, Math.round(Number(st.until)) || 100))
            };
        });
        pr.stopAtLimit = pr.stopAtLimit === true;   // s'arrête une fois le seuil atteint (après un dernier palier de durée)
        pr.restoreOnStop = pr.restoreOnStop === true; // à l'arrêt, revient au tempo de départ
        // Entraînement (silences) : temps joués, mesures jouées/muettes, subdivisions, hasard, retrait progressif.
        if (!m.training || typeof m.training !== "object") m.training = {};
        var tr = m.training;
        tr.enabled = tr.enabled === true;
        if (!Array.isArray(tr.beats)) tr.beats = [];
        tr.beats = tr.beats.slice(0, 12).map(function (v) { return v !== false; });
        while (tr.beats.length < 12) tr.beats.push(true);   // true = temps joué ; seuls les premiers (temps/mesure) comptent
        if (["all", "on", "off"].indexOf(tr.subMode) === -1) tr.subMode = "all"; // subdivisions : toutes / sur le temps / contretemps
        tr.barsOn = Math.min(16, Math.max(1, Math.round(Number(tr.barsOn)) || 1));
        tr.barsOff = Math.min(16, Math.max(0, Math.round(Number(tr.barsOff)) || 0));
        tr.randomPct = Math.min(90, Math.max(0, Math.round(Number(tr.randomPct)) || 0));
        tr.keepFirst = tr.keepFirst !== false;              // le temps 1 n'est jamais retiré au hasard / progressivement
        tr.fade = tr.fade === true;                         // retrait progressif
        tr.fadeEvery = Math.min(600, Math.max(1, Math.round(Number(tr.fadeEvery)) || 20));
        if (["end", "random"].indexOf(tr.fadeOrder) === -1) tr.fadeOrder = "end";
        // Simplifications : le tempo progressif monte toujours de 1 BPM à la fois ; plus d'arrêt automatique au
        // seuil ; le mode « Entraînement » (silences) a été retiré du métronome.
        m.progressive.incrementBpm = 1;
        m.progressive.stages.forEach(function (st) { st.inc = 1; });
        m.progressive.stopAtLimit = false;
        tr.enabled = false;
        if (typeof m.progressive.everySeconds !== "number" || isNaN(m.progressive.everySeconds) || m.progressive.everySeconds <= 0) m.progressive.everySeconds = 20;
        return m;
    }

    var metroAudioCtx = null;
    var metroMasterGain = null; // volume général du métronome (voir la barre de volume du panneau)
    var metroPlaying = false;
    var metroTimer = null;
    var metroNextNoteTime = 0;
    var metroCurrentStep = 0;
    var metroBeatCallback = null; // met à jour l'affichage (pas qui clignote), posé par le panneau ouvert
    var metroPanelApi = null; // { toggle } du panneau ouvert (flottant ou dans le volet) : sert au raccourci Espace
    var transportLastTouched = null; // "session" | "metro" : le dernier des deux lancé/arrêté
    var metroTempoCallback = null; // prévenu quand le tempo progressif change le BPM (met l'affichage à jour)
    var metroProgNextAt = null;    // instant (horloge audio) de la prochaine augmentation du tempo progressif
    var metroProgIdx = -1;         // palier en cours (indice dans metroProgStages)
    var metroProgStopNow = false;
    var metroMeasureIdx = 0;       // mesures écoulées depuis le lancement (cycle jouées/muettes)
    var metroTrainRemoved = [];    // temps retirés par le retrait progressif pendant cette lecture
    var metroTrainNextAt = null;   // instant (horloge audio) du prochain retrait
    var metroProgRan = false;      // le tempo a déjà monté pendant cette lecture
    var metroProgHoldUntil = null; // "arrêter au seuil" : instant où l'on s'arrête
    var metroProgStartBpm = null;  // tempo au lancement, pour "revenir au tempo de départ"

    // Liste des paliers effectivement appliqués : les paliers du mode "…" ou, en mode simple, un seul
    // palier (+inc toutes les N s) jusqu'au seuil éventuel. Triés par seuil croissant.
    function metroProgStages(p) {
        var cap = p.limitBpm > 0 ? p.limitBpm : 300; // le seuil plafonne aussi les paliers
        if (p.stagesMode && p.stages.length) {
            return p.stages.slice().sort(function (a, b) { return a.until - b.until; }).map(function (st) {
                return { inc: 1, every: st.every, until: Math.min(st.until, cap) };
            });
        }
        return [{ inc: 1, every: p.everySeconds, until: cap }];
    }
    // Palier à appliquer au tempo donné : le premier dont le seuil n'est pas encore atteint (-1 = terminé).
    function metroProgStageIndex(stages, bpm) {
        for (var i = 0; i < stages.length; i++) if (bpm < stages[i].until) return i;
        return -1;
    }
    var METRO_LOOKAHEAD_MS = 25;
    var METRO_SCHEDULE_AHEAD_S = 0.12;

    function ensureMetroAudio() {
        if (!metroAudioCtx) {
            metroAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
            metroMasterGain = metroAudioCtx.createGain();
            metroMasterGain.gain.value = state.settings.metronome.volume;
            metroMasterGain.connect(metroAudioCtx.destination);
        }
        if (metroAudioCtx.state === "suspended") metroAudioCtx.resume();
        return metroAudioCtx;
    }

    function setMetroVolume(v) {
        state.settings.metronome.volume = v;
        if (metroMasterGain) metroMasterGain.gain.value = v;
    }

    // Son plus doux qu'un simple bip : un filtre passe-bas adoucit les harmoniques aiguës, et une
    // courte montée en volume (linearRamp, quelques ms) avant la décroissance évite le "clic" sec
    // d'un signal qui démarre net à son maximum.
    function metroClick(time, level) {
        if (!level) return; // pas rendu muet
        var ctx = metroAudioCtx;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        var filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 2000;
        filter.Q.value = 0.6;
        osc.type = "sine";
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(metroMasterGain);
        osc.frequency.value = level >= 2 ? 1100 : 780;
        var peak = level >= 2 ? 0.75 : 0.38;
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.linearRampToValueAtTime(peak, time + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.065);
        osc.start(time);
        osc.stop(time + 0.07);
    }

    // Ce qui se joue (et s'affiche dans le pavé) : le pavé détaillé seulement quand "…" est activé,
    // sinon les simples temps de la formule rythmique (un pas par temps).
    function metroActiveLayer(m) {
        if (m.advanced && m.rhythmLabel !== "None") return { subdivision: m.subdivision, pattern: m.pattern };
        return { subdivision: 1, pattern: m.beatPattern };
    }

    // Faut-il jouer ce pas ? (entraînement : on garde l'horloge, on coupe seulement le son)
    function metroTrainMuted(m, step, subdivision) {
        var t = m.training;
        if (!t || !t.enabled) return false;
        var beat = Math.floor(step / subdivision + 1e-9);
        if (t.beats[beat] === false) return true;
        if (metroTrainRemoved.indexOf(beat) !== -1) return true;
        if (subdivision > 1 && t.subMode !== "all") {
            var inBeat = step % subdivision;
            if (t.subMode === "on" ? inBeat !== 0 : inBeat === 0) return true;
        }
        if (t.barsOff > 0 && (metroMeasureIdx % (t.barsOn + t.barsOff)) >= t.barsOn) return true;
        if (t.randomPct > 0 && !(t.keepFirst && beat === 0 && step % subdivision === 0) && Math.random() * 100 < t.randomPct) return true;
        return false;
    }
    // Retrait progressif : toutes les N secondes (horloge audio), un temps de plus devient muet.
    function metroTrainFadeTick(m) {
        var t = m.training;
        if (!t.enabled || !t.fade) { metroTrainNextAt = null; return false; }
        if (metroTrainNextAt === null) metroTrainNextAt = metroNextNoteTime + t.fadeEvery;
        var changed = false;
        while (metroNextNoteTime >= metroTrainNextAt) {
            metroTrainNextAt += t.fadeEvery;
            var cand = [];
            for (var b = 0; b < m.beatsPerMeasure; b++) {
                if (t.beats[b] === false || metroTrainRemoved.indexOf(b) !== -1) continue;
                if (b === 0 && t.keepFirst) continue;
                cand.push(b);
            }
            if (!cand.length) break;
            metroTrainRemoved.push(t.fadeOrder === "random" ? cand[Math.floor(Math.random() * cand.length)] : cand[cand.length - 1]);
            changed = true;
        }
        return changed;
    }

    function metroScheduler() {
        var m = state.settings.metronome;
        while (metroNextNoteTime < metroAudioCtx.currentTime + METRO_SCHEDULE_AHEAD_S) {
            // Relu à chaque pas : changer de formule ou basculer "…" pendant la lecture prend effet
            // tout de suite, sans pas fantôme au-delà de la nouvelle longueur de motif.
            var layer = metroActiveLayer(m);
            var stepCount = Math.max(1, layer.pattern.length);
            if (metroCurrentStep >= stepCount) metroCurrentStep = 0;
            if (metroTrainFadeTick(m) && metroTempoCallback) metroTempoCallback();
            if (!metroTrainMuted(m, metroCurrentStep, layer.subdivision)) metroClick(metroNextNoteTime, layer.pattern[metroCurrentStep]);
            if (metroBeatCallback) {
                var step = metroCurrentStep, delayMs = Math.max(0, (metroNextNoteTime - metroAudioCtx.currentTime) * 1000);
                setTimeout(function () { if (metroPlaying && metroBeatCallback) metroBeatCallback(step); }, delayMs);
            }
            // Tempo progressif : mesuré sur l'horloge audio (temps écoulé réel de la lecture), donc le
            // rythme d'augmentation reste le même quel que soit le tempo.
            if (m.progressive.enabled) {
                var stages = metroProgStages(m.progressive), bpmChanged = false, guard = 0, bpmBefore = m.bpm;
                while (guard++ < 60) {
                    var idx = metroProgStageIndex(stages, m.bpm);
                    if (idx < 0) { // seuil atteint : le tempo reste là
                        metroProgNextAt = null; metroProgIdx = -1;
                        if (m.progressive.stopAtLimit && metroProgRan) {
                            if (metroProgHoldUntil === null) metroProgHoldUntil = metroNextNoteTime + stages[stages.length - 1].every;
                            else if (metroNextNoteTime >= metroProgHoldUntil) { metroProgStopNow = true; }
                        }
                        break;
                    }
                    var stg = stages[idx];
                    if (metroProgNextAt === null || metroProgIdx !== idx) { // nouveau palier : son délai part de maintenant
                        metroProgIdx = idx;
                        metroProgNextAt = metroNextNoteTime + stg.every;
                    }
                    if (metroNextNoteTime < metroProgNextAt) break;
                    m.bpm = Math.min(300, stg.until, m.bpm + stg.inc);
                    metroProgNextAt += stg.every;
                    metroProgRan = true;
                    bpmChanged = true;
                }
                if (bpmChanged) { metroAutoDelta += m.bpm - bpmBefore; persist(); if (metroTempoCallback) metroTempoCallback(); }
            } else {
                metroProgNextAt = null; metroProgIdx = -1;
            }
            var secondsPerStep = 60 / m.bpm / layer.subdivision;
            metroNextNoteTime += secondsPerStep;
            metroCurrentStep = (metroCurrentStep + 1) % stepCount;
            if (metroCurrentStep === 0) metroMeasureIdx++;
            if (metroProgStopNow) break;
        }
        if (metroProgStopNow) { // "arrêter au seuil" : même chemin que le bouton Jouer/Arrêter
            metroProgStopNow = false;
            if (metroPanelApi) metroPanelApi.toggle(); else stopMetronome();
            return;
        }
        metroTimer = setTimeout(metroScheduler, METRO_LOOKAHEAD_MS);
    }

    function startMetronome() {
        if (metroPlaying) return;
        ensureMetroAudio();
        metroPlaying = true;
        metroCurrentStep = 0;
        metroProgNextAt = null; // le décompte du tempo progressif repart à chaque lancement
        metroProgIdx = -1; metroProgRan = false; metroProgHoldUntil = null;
        metroMeasureIdx = 0; metroTrainRemoved = []; metroTrainNextAt = null;
        var pm = state.settings.metronome.progressive;
        metroProgStartBpm = (pm.enabled && pm.restoreOnStop) ? state.settings.metronome.bpm : null;
        metroNextNoteTime = metroAudioCtx.currentTime + 0.05;
        metroScheduler();
    }

    function stopMetronome() {
        metroPlaying = false;
        if (metroTimer) { clearTimeout(metroTimer); metroTimer = null; }
        // "Revenir au tempo de départ" : le prochain lancement repart du tempo d'origine.
        if (metroProgStartBpm !== null) {
            var mm = state.settings.metronome;
            metroAutoDelta = 0;
            if (mm.bpm !== metroProgStartBpm) {
                mm.bpm = metroProgStartBpm;
                persist();
                if (metroTempoCallback) metroTempoCallback();
            }
            metroProgStartBpm = null;
        }
    }

    // Épingle : accroche le métronome à droite de la fenêtre principale (ou le détache en fenêtre
    // flottante) et retient ce choix. Le métronome qui jouait continue de jouer après le changement.
    function switchMetronomeDock(toDock) {
        var wasPlaying = metroPlaying;
        if (closeDockedMetronome) closeDockedMetronome();
        else if (closeActiveModal && activeModalKind === "metronome-panel") closeActiveModal();
        setMetroDockPref(toDock ? "1" : "0");
        openMetronomePanel();
        if (wasPlaying && metroPanelApi) metroPanelApi.toggle();
    }

    // ---------- métronome prédéfini (exercices et sessions) ----------
    // Un préréglage = une copie des réglages du métronome (tempo, mesure, pavé, progressif, entraînement).
    // Il se rattache à un exercice (ex.metronome) et, pour une session, peut être surchargé pour un pas
    // précis (step.metronome). Pendant une session, le préréglage du pas (sinon celui de l'exercice) est
    // appliqué au métronome à chaque changement d'exercice.
    var METRO_PRESET_KEYS = ["bpm", "beatsPerMeasure", "rhythmLabel", "subdivision", "advanced", "pattern", "beatPattern", "progressive", "training"];
    function cloneJson(o) { return JSON.parse(JSON.stringify(o)); }
    function snapshotMetronome() {
        var m = state.settings.metronome, o = {};
        METRO_PRESET_KEYS.forEach(function (k) { o[k] = m[k] === undefined ? null : cloneJson(m[k]); });
        return o;
    }
    function applyMetronomePresetToSettings(p) {
        var m = state.settings.metronome;
        METRO_PRESET_KEYS.forEach(function (k) {
            if (p[k] !== undefined && p[k] !== null) m[k] = cloneJson(p[k]);
            else if (k === "rhythmLabel") m.rhythmLabel = null;
        });
        normalizeMetronomeSettings(state.settings);
        persist();
    }
    function metroPresetSummary(p) {
        var parts = [p.bpm + " BPM"];
        if (p.rhythmLabel && p.rhythmLabel !== "None") parts.push(p.rhythmLabel); // « None » : pas de figure à afficher
        if (p.advanced) parts.push("détaillé");
        if (p.progressive && p.progressive.enabled) parts.push("progressif");
        if (p.training && p.training.enabled) parts.push("entraînement");
        return parts.join(" · ");
    }
    function gsEffectiveMetronome(step, ex) { return step.metronome || (ex && ex.metronome) || null; }

    // Applique un préréglage. Le panneau du métronome (s'il est ouvert) est rouvert pour refléter les
    // nouveaux réglages ; un métronome qui jouait continue de jouer. opts.open : ouvrir le panneau ;
    // opts.play : lancer la lecture.
    // Métronome « relié » à un exercice : celui dont le réglage vient d'être chargé (▶, ou exercice en cours
    // d'une session). Si on modifie ensuite le métronome, le panneau propose de mettre à jour l'exercice (et donc
    // ses sessions). base = réglage de référence (null : l'exercice n'a pas encore de métronome).
    // metroAutoDelta = BPM ajoutés par le tempo progressif depuis : ce n'est pas une modification de l'utilisateur.
    var metroLink = null;     // { exId, title, base, fromSession }
    var metroAutoDelta = 0;
    function setMetroLink(link) {
        metroLink = link ? { exId: link.exId, title: link.title, base: link.base === undefined ? snapshotMetronome() : link.base, fromSession: !!link.fromSession } : null;
        metroAutoDelta = 0;
        if (metroLinkRefresh) metroLinkRefresh();
    }
    var metroLinkRefresh = null; // posé par le panneau ouvert
    function metroCurrentAsPreset() {
        var p = snapshotMetronome();
        p.bpm = Math.min(300, Math.max(30, p.bpm - metroAutoDelta));
        return p;
    }
    function metroLinkDirty() {
        if (!metroLink) return false;
        if (!metroLink.base) return true;
        return JSON.stringify(metroCurrentAsPreset()) !== JSON.stringify(metroLink.base);
    }
    function saveMetroToLinkedExercise() {
        if (!metroLink) return;
        var found = findExerciseById(metroLink.exId);
        if (!found) { showToast("Exercice introuvable (supprimé ?).", 4000); setMetroLink(null); return; }
        var preset = metroCurrentAsPreset();
        setExerciseMetronome(found.ex, preset);
        metroLink.base = cloneJson(preset);
        if (metroLinkRefresh) metroLinkRefresh();
        showToast("Métronome de « " + found.ex.title + " » mis à jour (exercice et sessions).", 3500);
    }

    function loadMetronomePreset(preset, opts) {
        opts = opts || {};
        var wasOpen = !!metroPanelApi, wasPlaying = metroPlaying;
        if (wasOpen) {
            if (closeDockedMetronome) closeDockedMetronome();
            else if (closeActiveModal && activeModalKind === "metronome-panel") closeActiveModal();
        }
        applyMetronomePresetToSettings(preset);
        if (opts.link) setMetroLink(opts.link); // base = réglage normalisé, juste appliqué
        if (wasOpen || opts.open) openMetronomePanel();
        if ((wasPlaying || opts.play) && metroPanelApi && !metroPlaying) metroPanelApi.toggle();
    }

    // Préréglage « vierge » : seulement un tempo, tout le reste par défaut (4/4 simple, sans progressif ni entraînement).
    function blankMetroPreset(bpm) {
        // Par défaut « None » (métronome simple, aucun temps accentué) : le réglage le plus courant.
        var tmp = { metronome: { bpm: bpm, beatsPerMeasure: 1, rhythmLabel: "None", beatPattern: [1], advanced: false } };
        normalizeMetronomeSettings(tmp);
        var o = {};
        METRO_PRESET_KEYS.forEach(function (k) { o[k] = tmp.metronome[k] === undefined ? null : cloneJson(tmp.metronome[k]); });
        return o;
    }
    function metroPresetExtras(p) { // résumé sans le tempo : figure rythmique + options
        return metroPresetSummary(p).split(" · ").slice(1).join(" · ");
    }
    // Tempo progressif d'un préréglage : { limit } (0 = pas de seuil) ou null s'il n'est pas progressif.
    function metroProgressiveTarget(p) {
        var pr = p.progressive;
        if (!pr || !pr.enabled) return null;
        var cap = pr.limitBpm > 0 ? pr.limitBpm : 0;
        if (pr.stagesMode && pr.stages && pr.stages.length) {
            var top = Math.max.apply(null, pr.stages.map(function (st) { return st.until; }));
            return { limit: cap ? Math.min(cap, top) : top };
        }
        return { limit: cap };
    }
    // Réglage « spécial » (au-delà d'un simple tempo) : progressif, entraînement ou pavé détaillé.
    function metroPresetIsSpecial(p) {
        return !!((p.progressive && p.progressive.enabled) || (p.training && p.training.enabled) || p.advanced);
    }
    var GEAR_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>';

    // Édition complexe d'un préréglage avec le vrai panneau du métronome (progressif, entraînement, rythme…) :
    // le panneau s'ouvre avec le préréglage, un bandeau propose Enregistrer / Annuler, et les réglages
    // habituels du métronome sont rétablis ensuite (l'édition ne dérange pas ton métronome courant).
    var metroEdit = null; // { title, onSave, prev }
    function startMetronomePresetEdit(opts) {
        if (metroEdit) finishMetronomePresetEdit(false);
        var prev = snapshotMetronome();
        if (closeDockedMetronome) closeDockedMetronome();
        else if (closeActiveModal && activeModalKind === "metronome-panel") closeActiveModal();
        metroEdit = { title: opts.title, onSave: opts.onSave, prev: prev };
        applyMetronomePresetToSettings(opts.preset);
        openMetronomePanel();
    }
    function finishMetronomePresetEdit(save) {
        var e = metroEdit;
        if (!e) return;
        metroEdit = null; // d'abord : la fermeture du panneau ne doit pas relancer l'annulation
        var preset = save ? snapshotMetronome() : null;
        if (closeDockedMetronome) closeDockedMetronome();
        else if (closeActiveModal && activeModalKind === "metronome-panel") closeActiveModal();
        applyMetronomePresetToSettings(e.prev);
        if (save) e.onSave(preset);
    }

    // Actions communes à la ligne de la fiche et à la pastille de tempo.
    // cfg : get() préréglage propre ; inherited() préréglage hérité (facultatif) ; set(preset|null) ; title.
    function tempoPresetActions(cfg) {
        var cur = cfg.get();
        var inh = cfg.inherited ? cfg.inherited() : null;
        var base = cur || inh;
        return {
            cur: cur, eff: base,
            setBpm: function (n) {
                if (!n) { if (cur) cfg.set(null); return; }
                var p = base ? cloneJson(base) : blankMetroPreset(n);
                p.bpm = Math.min(300, Math.max(30, n));
                cfg.set(p);
            },
            options: function () {
                startMetronomePresetEdit({ title: cfg.title || "cet exercice", preset: base ? cloneJson(base) : blankMetroPreset(state.settings.metronome.bpm), onSave: function (p) { cfg.set(p); } });
            },
            play: function () { if (base) loadMetronomePreset(base, { open: true, play: true, link: cfg.exId ? { exId: cfg.exId, title: cfg.title } : null }); },
            remove: function () { if (cur) cfg.set(null); }
        };
    }
    function tempoInput(act, className) {
        var inp = document.createElement("input");
        inp.type = "number";
        inp.min = "30"; inp.max = "300";
        inp.className = className;
        inp.placeholder = "—";
        inp.value = act.eff ? act.eff.bpm : "";
        inp.title = "Tempo cible : glisser vers le haut/bas, molette ou saisie";
        bindScrubInput(inp, 30, 300, { pxPerStep: 5, wheel: true, emptyStart: 100 });
        inp.addEventListener("change", function () { act.setBpm(parseInt(inp.value, 10) || 0); });
        return inp;
    }

    // Ligne « Tempo cible » d'un exercice ou d'un pas de session.
    function buildMetronomePresetRow(cfg) {
        var act = tempoPresetActions(cfg);
        var row = document.createElement("div");
        row.className = "metro-preset-row";
        var lab = document.createElement("span");
        lab.className = "metro-preset-icon";
        lab.innerHTML = METRONOME_ICON_SVG;
        lab.title = "Tempo cible et réglage du métronome";
        row.appendChild(lab);
        row.appendChild(tempoInput(act, "metro-preset-bpm"));
        if (act.eff) {
            var fig = act.eff.rhythmLabel && act.eff.rhythmLabel !== "None" ? act.eff.rhythmLabel : "";
            if (fig) {
                var figEl = document.createElement("span");
                figEl.className = "metro-preset-figure";
                figEl.textContent = fig;
                row.appendChild(figEl);
            }
            var tags = [];
            if (act.eff.progressive && act.eff.progressive.enabled) tags.push("progressif");
            if (act.eff.training && act.eff.training.enabled) tags.push("entraînement");
            if (act.eff.advanced) tags.push("détaillé");
            tags.forEach(function (t) {
                var tg = document.createElement("span");
                tg.className = "metro-preset-tag";
                tg.textContent = t;
                row.appendChild(tg);
            });
            if (!act.cur && cfg.inherited) {
                var inhEl = document.createElement("span");
                inhEl.className = "metro-preset-summary";
                inhEl.textContent = "(de l'exercice)";
                row.appendChild(inhEl);
            }
        }
        function btn(html, title, fn, cls) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "metro-preset-btn" + (cls ? " " + cls : "");
            b.innerHTML = html;
            b.title = title;
            b.setAttribute("aria-label", title);
            b.addEventListener("click", fn);
            row.appendChild(b);
        }
        btn(GEAR_ICON_SVG, "Options : préconfigurer un métronome complet (progressif, entraînement, rythme…)", act.options, "metro-preset-btn-icon");
        if (act.eff) btn("▶", "Charger ce réglage dans le métronome et le lancer", act.play, "metro-preset-btn-icon");
        if (act.cur) btn("✕", "Retirer ce réglage", act.remove, "metro-preset-btn-icon");
        return row;
    }

    // Pastille de tempo (barre de l'exercice, ligne d'un pas de session) : affiche le tempo cible ; un clic
    // ouvre une petite fenêtre pour le modifier ou ouvrir les options complètes.
    function buildTempoChip(cfg, showEmpty) {
        var act = tempoPresetActions(cfg);
        if (!act.eff && !showEmpty) return null;
        var chip = document.createElement("button");
        chip.type = "button";
        chip.className = "tempo-chip" + (act.eff ? "" : " tempo-chip-empty");
        var note = document.createElement("span");
        note.className = "tempo-chip-note";
        note.textContent = "♩";
        var num = document.createElement("span");
        num.textContent = act.eff ? String(act.eff.bpm) : "+";
        chip.appendChild(note);
        chip.appendChild(num);
        // Tempo progressif : « 80→100 » (avec seuil) ou « 80→ » (sans seuil : ça monte tant qu'on joue).
        var progTarget = act.eff ? metroProgressiveTarget(act.eff) : null;
        if (progTarget) {
            var arrow = document.createElement("span");
            arrow.className = "tempo-chip-arrow";
            arrow.innerHTML = '<svg viewBox="0 0 12 10" width="10" height="8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 5h9.5M7.3 1.6 10.7 5 7.3 8.4"/></svg>';
            chip.appendChild(arrow);
            if (progTarget.limit) { var lim = document.createElement("span"); lim.textContent = String(progTarget.limit); chip.appendChild(lim); }
        }
        chip.title = act.eff
            ? (progTarget ? "Tempo progressif : de " + act.eff.bpm + (progTarget.limit ? " à " + progTarget.limit : " (sans seuil)") + " BPM" : "Tempo cible : " + act.eff.bpm + " BPM") + " — cliquer pour modifier"
            : "Définir un tempo cible";
        chip.addEventListener("click", function (e) {
            e.stopPropagation();
            openTempoPopover(chip, cfg);
        });
        return chip;
    }
    function openTempoPopover(anchor, cfg) {
        var existing = document.querySelector(".tempo-pop");
        if (existing) { existing.remove(); }
        var act = tempoPresetActions(cfg);
        var pop = document.createElement("div");
        pop.className = "tempo-pop";
        var head = document.createElement("div");
        head.className = "tempo-pop-row";
        var lab = document.createElement("span");
        lab.className = "metro-preset-label";
        lab.textContent = "Tempo cible";
        var applied = false;
        var inp = tempoInput({ eff: act.eff, setBpm: function (n) { if (applied) return; applied = true; close(); act.setBpm(n); } }, "metro-preset-bpm");
        var unit = document.createElement("span");
        unit.className = "metro-preset-unit";
        unit.textContent = "BPM";
        head.appendChild(lab); head.appendChild(inp); head.appendChild(unit);
        pop.appendChild(head);
        if (act.eff) {
            var sum = document.createElement("div");
            sum.className = "metro-preset-summary";
            sum.textContent = metroPresetExtras(act.eff);
            if (sum.textContent) pop.appendChild(sum);
        }
        var btns = document.createElement("div");
        btns.className = "tempo-pop-row";
        function pb(text, title, fn) {
            var b = document.createElement("button");
            b.type = "button"; b.className = "metro-preset-btn" + (text.charAt(0) === "<" ? " metro-preset-btn-icon" : ""); b.innerHTML = text; b.title = title; b.setAttribute("aria-label", title);
            b.addEventListener("click", function () { close(); fn(); });
            btns.appendChild(b);
        }
        pb(GEAR_ICON_SVG, "Options : progressif, entraînement, rythme…", act.options);
        if (act.eff) pb("▶", "Charger et lancer", act.play);
        if (act.cur) pb("Retirer", "Retirer ce tempo", act.remove);
        pop.appendChild(btns);
        document.body.appendChild(pop);
        var r = anchor.getBoundingClientRect();
        pop.style.top = Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 6) + "px";
        pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left)) + "px";
        function onDown(e) { if (!pop.contains(e.target)) close(); }
        function onKey(e) { if (e.key === "Escape") close(); }
        var closed = false;
        function close() { if (closed) return; closed = true; document.removeEventListener("pointerdown", onDown, true); window.removeEventListener("keydown", onKey, true); pop.remove(); }
        setTimeout(function () { document.addEventListener("pointerdown", onDown, true); }, 0);
        window.addEventListener("keydown", onKey, true);
        inp.focus();
    }

    // Réglage d'un pas de session : surcharge propre au pas ; propose de l'enregistrer aussi dans l'exercice s'il n'en a pas.
    // Un exercice a UN métronome, le même partout : le régler depuis une session règle celui de l'exercice.
    function gsSetStepMetronome(step, found, p) {
        if (!found) { if (p) step.metronome = p; else delete step.metronome; save(); return; }
        found.ex.metronome = p ? cloneJson(p) : null;
        touchExercise(found.ex);
        clearStepMetronomeOverrides(found.ex.id);
        save();
    }
    function clearStepMetronomeOverrides(exId) {
        state.settings.guidedSessions.forEach(function (gs) {
            gs.steps.forEach(function (st) { if (st.exerciseId === exId) delete st.metronome; });
        });
    }

    // Mise à jour d'un préréglage d'exercice : propose de répercuter sur les sessions qui en avaient déjà un.
    // Mise à jour du métronome d'un exercice : vaut aussi pour toutes les sessions qui l'utilisent.
    function setExerciseMetronome(ex, preset) {
        ex.metronome = preset;
        touchExercise(ex);
        clearStepMetronomeOverrides(ex.id);
        save();
        render();
    }

    function openMetronomePanel() {
        // Déjà dans le volet : le bouton fait bascule (referme), plutôt que de ne rien faire.
        if (closeDockedMetronome) { closeDockedMetronome(); return; }
        var m = state.settings.metronome;
        var a = state.settings.appearance;
        var extraClass = "metronome-panel metro-pos-" + a.metronomePosition + " metro-size-" + a.metronomeSize;
        // Pendant une session guidée : écran scindé (session + métronome côte à côte) plutôt qu'une
        // fenêtre par-dessus la session.
        var dockPref = getMetroDockPref();
        var docked = !!$metroDock && (dockPref === "1" || (dockPref === null && guidedSessionViewActive));

        var closeFn = openModal(extraClass, function (panel, close) {
            // -- en-tête : titre + volume (bien visible, en haut à droite) --
            if (metroEdit) {
                var editBar = document.createElement("div");
                editBar.className = "metro-edit-bar";
                var editTxt = document.createElement("span");
                editTxt.textContent = "Réglage pour « " + metroEdit.title + " »";
                var editSave = document.createElement("button");
                editSave.type = "button"; editSave.className = "btn-accent"; editSave.textContent = "Enregistrer";
                editSave.addEventListener("click", function () { finishMetronomePresetEdit(true); });
                var editCancel = document.createElement("button");
                editCancel.type = "button"; editCancel.textContent = "Annuler";
                editCancel.addEventListener("click", function () { finishMetronomePresetEdit(false); });
                editBar.appendChild(editTxt); editBar.appendChild(editSave); editBar.appendChild(editCancel);
                panel.appendChild(editBar);
            }
            var headerRow = document.createElement("div");
            headerRow.className = "metro-header-row";
            // Bandeau « relié à l'exercice » : quel exercice a fourni ce réglage, et bouton pour l'y enregistrer
            // dès qu'on a modifié quelque chose (tempo, mesure, progressif…).
            var linkBar = document.createElement("div");
            linkBar.className = "metro-link-bar";
            linkBar.hidden = true;
            var linkTxt = document.createElement("span");
            linkTxt.className = "metro-link-text";
            var linkSave = document.createElement("button");
            linkSave.type = "button";
            linkSave.className = "btn-accent metro-link-save";
            linkSave.addEventListener("click", function () { saveMetroToLinkedExercise(); });
            var linkClose = document.createElement("button");
            linkClose.type = "button";
            linkClose.className = "metro-link-close";
            linkClose.textContent = "✕";
            linkClose.title = "Ne plus relier le métronome à cet exercice";
            linkClose.addEventListener("click", function () { setMetroLink(null); });
            linkBar.appendChild(linkTxt); linkBar.appendChild(linkSave); linkBar.appendChild(linkClose);
            function refreshLinkBar() {
                if (!metroLink || metroEdit) { linkBar.hidden = true; return; }
                var dirty = metroLinkDirty();
                linkBar.hidden = false;
                linkBar.classList.toggle("metro-link-dirty", dirty);
                if (!metroLink.base) {
                    linkTxt.textContent = "« " + metroLink.title + " » n'a pas encore de métronome";
                    linkSave.textContent = "Enregistrer pour l'exercice";
                } else {
                    linkTxt.textContent = dirty ? "Réglage modifié · « " + metroLink.title + " »" : "Réglage de « " + metroLink.title + " »";
                    linkSave.textContent = "Mettre à jour l'exercice";
                }
                linkSave.hidden = !dirty;
            }
            metroLinkRefresh = refreshLinkBar;
            // Toute action dans le panneau (clic, saisie, molette, fin de glisser) peut avoir modifié le réglage.
            ["click", "change", "input", "keyup", "wheel"].forEach(function (evt) {
                panel.addEventListener(evt, function () { setTimeout(refreshLinkBar, 0); }, true);
            });
            window.addEventListener("pointerup", onPanelPointerUp);
            function onPanelPointerUp() { setTimeout(refreshLinkBar, 0); }
            var title = document.createElement("div");
            title.className = "backups-title metro-title-icon";
            title.innerHTML = METRONOME_ICON_SVG; // logo à la place du mot (le mot gênait la barre de volume)
            title.title = "Métronome";
            title.setAttribute("aria-label", "Métronome");
            // BPM rappelé dans le titre, visible seulement quand le volet est réduit (voir CSS).
            var compactBpm = document.createElement("span");
            compactBpm.className = "metro-compact-bpm";
            title.appendChild(compactBpm);
            headerRow.appendChild(title);

            var volumeRow = document.createElement("div");
            volumeRow.className = "metro-volume-row";
            var volumeSlider = document.createElement("input");
            volumeSlider.type = "range";
            volumeSlider.min = "0";
            volumeSlider.max = "100";
            volumeSlider.value = Math.round(m.volume * 100);
            volumeSlider.className = "metro-volume-slider";
            volumeSlider.title = "Volume";
            volumeSlider.addEventListener("input", function () {
                setMetroVolume(parseInt(volumeSlider.value, 10) / 100);
                save();
            });
            var volumeBtn = document.createElement("button");
            volumeBtn.type = "button";
            volumeBtn.className = "metro-volume-btn";
            var volumeBtnIcon = document.createElement("span");
            volumeBtnIcon.className = "metro-volume-btn-icon";
            volumeBtnIcon.innerHTML = METRO_VOLUME_ICON_SVG;
            var volumeBtnLabel = document.createElement("span");
            volumeBtnLabel.textContent = "Volume";
            volumeBtn.appendChild(volumeBtnIcon);
            volumeBtn.appendChild(volumeBtnLabel);
            volumeBtn.addEventListener("click", function () {
                volumeRow.classList.toggle("metro-volume-expanded-row");
                volumeBtn.classList.toggle("metro-volume-expanded", volumeRow.classList.contains("metro-volume-expanded-row"));
                if (volumeRow.classList.contains("metro-volume-expanded-row")) volumeSlider.focus();
            });
            // Volume toujours visible (barre) ; sur petit écran, on garde le bouton qui déplie la barre (voir CSS).
            var volInline = document.createElement("label");
            volInline.className = "metro-volume-inline";
            volInline.title = "Volume";
            var volInlineIcon = document.createElement("span");
            volInlineIcon.className = "metro-volume-btn-icon";
            volInlineIcon.innerHTML = METRO_VOLUME_ICON_SVG;
            var volInlineSlider = document.createElement("input");
            volInlineSlider.type = "range";
            volInlineSlider.min = "0"; volInlineSlider.max = "100";
            volInlineSlider.value = Math.round(m.volume * 100);
            volInlineSlider.className = "metro-volume-inline-slider";
            volInlineSlider.setAttribute("aria-label", "Volume");
            volInlineSlider.addEventListener("input", function () {
                setMetroVolume(parseInt(volInlineSlider.value, 10) / 100);
                volumeSlider.value = volInlineSlider.value;
                save();
            });
            volumeSlider.addEventListener("input", function () { volInlineSlider.value = volumeSlider.value; });
            volInline.appendChild(volInlineIcon);
            volInline.appendChild(volInlineSlider);
            headerRow.appendChild(volInline);
            headerRow.appendChild(volumeBtn);
            // Épingle : accrocher à droite / détacher (voir switchMetronomeDock).
            var pinBtn = document.createElement("button");
            pinBtn.type = "button";
            pinBtn.className = "btn-ghost metro-pin-btn" + (docked ? " metro-pin-on" : "");
            pinBtn.innerHTML = docked ? METRO_UNPIN_ICON_SVG : METRO_PIN_ICON_SVG;
            pinBtn.title = docked ? "Détacher le métronome (fenêtre flottante)" : "Accrocher le métronome à droite de la fenêtre";
            pinBtn.setAttribute("aria-label", pinBtn.title);
            pinBtn.addEventListener("click", function () { switchMetronomeDock(!docked); });
            headerRow.appendChild(pinBtn);
            panel.appendChild(headerRow);
            volumeRow.appendChild(volumeSlider);
            panel.appendChild(volumeRow);
            panel.appendChild(linkBar);
            refreshLinkBar();

            // ---------- transport : cadran flanqué des boutons de vitesse ----------
            // Met le tempo en valeur au centre d'un cadran plutôt que sur une barre de réglage
            // (jugée peu lisible) : le chiffre reste la chose la plus visible du panneau, et se
            // clique pour une saisie directe au clavier. Les boutons ±1/±10 restent sur les côtés du
            // cadran (plus logique qu'au-dessus/en-dessous), et le bouton lecture est en bas du
            // panneau (voir plus loin), bien plus gros que ces réglages fins.
            var transportRow = document.createElement("div");
            transportRow.className = "metro-transport-row";
            var bpmDown10 = iconButton("−10", "Ralentir de 10", function () { setBpm(m.bpm - 10); });
            bpmDown10.classList.add("metro-bpm-btn", "metro-bpm-step10");
            var bpmDown = iconButton("−", "Ralentir", function () { setBpm(m.bpm - 1); });
            bpmDown.classList.add("metro-bpm-btn");

            var dial = document.createElement("div");
            dial.className = "metro-dial";
            var bpmValue = document.createElement("button");
            bpmValue.type = "button";
            bpmValue.className = "metro-dial-value";
            bpmValue.title = "Cliquer pour saisir le BPM au clavier";
            bpmValue.addEventListener("click", startEditBpm);
            dial.appendChild(bpmValue);

            var bpmUp = iconButton("+", "Accélérer", function () { setBpm(m.bpm + 1); });
            bpmUp.classList.add("metro-bpm-btn");
            var bpmUp10 = iconButton("+10", "Accélérer de 10", function () { setBpm(m.bpm + 10); });
            bpmUp10.classList.add("metro-bpm-btn", "metro-bpm-step10");
            // Quatre boutons en quarts de couronne autour du cadran : − et + en haut, −10 et +10 en bas.
            bpmDown.classList.add("metro-q", "metro-q-tl");
            bpmUp.classList.add("metro-q", "metro-q-tr");
            bpmDown10.classList.add("metro-q", "metro-q-bl");
            bpmUp10.classList.add("metro-q", "metro-q-br");
            // Texte des boutons en deux parties (signe / nombre) pour pouvoir le styler ; le texte reste « −10 », « +1 »…
            [[bpmDown, "−", ""], [bpmUp, "+", ""], [bpmDown10, "−", "10"], [bpmUp10, "+", "10"]].forEach(function (d) {
                d[0].innerHTML = '<span class="q-sign' + (d[2] ? "" : " q-sign-big") + '">' + d[1] + "</span>" + (d[2] ? '<span class="q-num">' + d[2] + "</span>" : "");
            });
            transportRow.classList.add("metro-transport-quad");
            transportRow.appendChild(dial);
            transportRow.appendChild(bpmDown);
            transportRow.appendChild(bpmUp);
            transportRow.appendChild(bpmDown10);
            transportRow.appendChild(bpmUp10);
            panel.appendChild(transportRow);

            // Le cadran se règle directement : glisser verticalement dessus (comme une molette)
            // change le tempo, et la molette de la souris l'affine d'un cran à la fois.
            // Un simple clic (sans dépasser le seuil) ne déclenche aucun réglage et laisse le clic
            // natif atteindre le chiffre (ouvre la saisie au clavier) : pas besoin d'exclure la zone
            // du chiffre du geste de glisser, qui fonctionne donc sur tout le cadran. Écoute sur
            // `window` (comme makePanelDraggable) plutôt que setPointerCapture sur le cadran, qui
            // empêchait le clic natif d'atteindre le bouton du chiffre dans certains navigateurs.
            var dialDragging = false, dialMoved = false, dialStartY = 0, dialStartBpm = 0;
            function onDialPointerDown(e) {
                dialDragging = true;
                dialMoved = false;
                dialStartY = e.clientY;
                dialStartBpm = m.bpm;
            }
            function onDialPointerMove(e) {
                if (!dialDragging) return;
                var dy = dialStartY - e.clientY;
                if (!dialMoved && Math.abs(dy) < 4) return;
                dialMoved = true;
                setBpm(dialStartBpm + Math.round(dy / 4));
            }
            function onDialPointerUp() { dialDragging = false; }
            dial.addEventListener("pointerdown", onDialPointerDown);
            window.addEventListener("pointermove", onDialPointerMove);
            window.addEventListener("pointerup", onDialPointerUp);
            dial.addEventListener("wheel", function (e) {
                e.preventDefault();
                setBpm(m.bpm + (e.deltaY < 0 ? 1 : -1));
            }, { passive: false });
            dial.title = "Glisser verticalement ou molette pour régler le tempo";

            function startEditBpm() {
                var input = document.createElement("input");
                input.type = "number";
                input.min = "30";
                input.max = "300";
                input.className = "metro-dial-input";
                input.value = m.bpm;
                bpmValue.replaceWith(input);
                input.focus();
                input.select();
                var done = false;
                function commit() {
                    if (done) return;
                    done = true;
                    var v = parseInt(input.value, 10);
                    if (!isNaN(v)) setBpm(v); else refreshBpmUI();
                    input.replaceWith(bpmValue);
                }
                function cancel() {
                    if (done) return;
                    done = true;
                    input.replaceWith(bpmValue);
                }
                input.addEventListener("keydown", function (e) {
                    e.stopPropagation();
                    if (e.key === "Enter") { e.preventDefault(); commit(); }
                    if (e.key === "Escape") cancel();
                });
                input.addEventListener("blur", commit);
            }

            // ---------- bascules secondaires : tap / progressif ----------
            // Les deux partagent la même pastille (metro-mini-btn). Le réglage progressif déplie ses
            // champs juste en dessous au clic, plutôt que de les laisser en permanence affichés.
            var toolsRow = document.createElement("div");
            toolsRow.className = "metro-tools-row";
            panel.appendChild(toolsRow);

            // -- tap tempo --
            var tapTimes = [];
            var tapBtn = document.createElement("button");
            tapBtn.type = "button";
            tapBtn.className = "metro-dial-tap metro-tap-btn";
            tapBtn.textContent = "TAP";
            // Le bouton est dans le cadran : son appui ne doit pas déclencher le réglage au glisser du cadran.
            tapBtn.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
            tapBtn.addEventListener("wheel", function (e) { e.stopPropagation(); });
            tapBtn.title = "Tapoter au tempo souhaité pour régler le BPM";
            tapBtn.addEventListener("click", function () {
                var now = Date.now();
                if (tapTimes.length && now - tapTimes[tapTimes.length - 1] > 2000) tapTimes = [];
                tapTimes.push(now);
                if (tapTimes.length > 8) tapTimes.shift();
                if (tapTimes.length >= 2) {
                    var intervals = [];
                    for (var i = 1; i < tapTimes.length; i++) intervals.push(tapTimes[i] - tapTimes[i - 1]);
                    var avg = intervals.reduce(function (a, b) { return a + b; }, 0) / intervals.length;
                    setBpm(Math.round(60000 / avg));
                }
            });
            dial.appendChild(tapBtn); // Tap tempo intégré au bas du cadran

            // -- formules rythmiques courantes : un clic règle le nombre de temps et remet le motif --
            // "None" (sur la gauche) sert justement à n'avoir aucun temps accentué et masque le pavé
            // (demandé explicitement) ; les autres accentuent le 1er temps par défaut. Le bouton "…"
            // (à droite, voir plus bas) ouvre les formules moins courantes et le pavé détaillé.
            var formulasRow = document.createElement("div");
            formulasRow.className = "metro-formulas-row";
            var METRO_FORMULAS = [
                { label: "None", beats: 1, noAccent: true },
                { label: "2/4", beats: 2 },
                { label: "3/4", beats: 3 },
                { label: "4/4", beats: 4 },
                { label: "6/8", beats: 6 }
            ];
            var formulaBtns = [];
            METRO_FORMULAS.forEach(function (f) {
                var btn = document.createElement("button");
                btn.type = "button";
                btn.className = "metro-mini-btn metro-formula-btn";
                btn.textContent = f.label;
                btn.title = f.label === "None" ? "Aucun temps accentué" : "Formule " + f.label;
                btn.addEventListener("click", function () {
                    m.beatsPerMeasure = f.beats;
                    m.rhythmLabel = f.label;
                    m.beatPattern = [];
                    for (var i = 0; i < f.beats; i++) m.beatPattern.push(i === 0 && !f.noAccent ? 2 : 1);
                    // Le pavé détaillé garde sa subdivision mais repart d'un motif par défaut à la
                    // nouvelle taille ; "None" (métronome tout simple, sans pavé) quitte le mode "…".
                    m.pattern = null;
                    if (f.noAccent) m.advanced = false;
                    normalizeMetronomeSettings(state.settings);
                    beatsInput.value = m.beatsPerMeasure;
            attachNumberStepper(beatsInput, 1, 12, {});
                    save();
                    refreshRhythmMode();
                });
                formulaBtns.push(btn);
                formulasRow.appendChild(btn);
            });

            // -- "plus" : formules moins courantes + pavé détaillé (temps/mesure + subdivision) --
            // C'est un mode : activé, il déplie les réglages et montre/joue le pavé détaillé ; refermé,
            // on revient aux simples temps de la formule (le rythme composé est gardé pour la suite).
            var rhythmBtn = document.createElement("button");
            rhythmBtn.type = "button";
            rhythmBtn.className = "metro-mini-btn metro-mini-btn-icon metro-rhythm-btn";
            rhythmBtn.innerHTML = METRO_MORE_ICON_SVG;
            rhythmBtn.setAttribute("aria-label", "Formules moins courantes et pavé détaillé");
            rhythmBtn.title = "Formules moins courantes et pavé détaillé";
            formulasRow.appendChild(rhythmBtn);
            panel.appendChild(formulasRow);

            function refreshRhythmMode() {
                formulaBtns.forEach(function (btn, i) {
                    btn.classList.toggle("metro-progressive-active", m.rhythmLabel === METRO_FORMULAS[i].label);
                });
                rhythmBtn.classList.toggle("metro-progressive-active", m.advanced);
                rhythmBtn.setAttribute("aria-pressed", m.advanced ? "true" : "false");
                rhythmFields.hidden = !m.advanced;
                renderPad();
            }

            var rhythmFields = document.createElement("div");
            rhythmFields.className = "metro-rhythm-fields";
            rhythmFields.hidden = !m.advanced;

            var beatsField = document.createElement("label");
            beatsField.className = "metro-field";
            beatsField.textContent = "Temps/mesure";
            var beatsInput = document.createElement("input");
            beatsInput.type = "number";
            beatsInput.min = "1";
            beatsInput.max = "12";
            beatsInput.value = m.beatsPerMeasure;
            beatsInput.addEventListener("change", function () {
                var n = Math.min(12, Math.max(1, parseInt(beatsInput.value, 10) || 4));
                m.beatsPerMeasure = n;
                m.rhythmLabel = null; // réglage manuel : on quitte toute formule prédéfinie
                // Les deux motifs sont seulement rallongés/raccourcis (normalizeMetronomeSettings) :
                // passer de 4 à 5 temps garde le rythme déjà composé sur les 4 premiers.
                normalizeMetronomeSettings(state.settings);
                beatsInput.value = m.beatsPerMeasure;
                save();
                refreshRhythmMode();
            });
            beatsField.appendChild(beatsInput);
            rhythmFields.appendChild(beatsField);

            var subField = document.createElement("label");
            subField.className = "metro-field";
            subField.textContent = "Subdivision";
            var subSelect = document.createElement("select");
            [[0.5, "Blanche"], [1, "Noire"], [2, "Croches"], [3, "Triolet"], [4, "Doubles-croches"]].forEach(function (opt) {
                var o = document.createElement("option");
                o.value = opt[0];
                o.textContent = opt[1];
                if (m.subdivision === opt[0]) o.selected = true;
                subSelect.appendChild(o);
            });
            subSelect.addEventListener("change", function () {
                // La subdivision ne change pas la formule (4/4 reste 4/4) : seul le pavé détaillé
                // repart d'un motif par défaut à la nouvelle finesse.
                m.subdivision = parseFloat(subSelect.value);
                m.pattern = null;
                normalizeMetronomeSettings(state.settings);
                save();
                refreshRhythmMode();
            });
            subField.appendChild(subSelect);
            rhythmFields.appendChild(subField);
            panel.appendChild(rhythmFields);
            rhythmBtn.addEventListener("click", function () {
                m.advanced = !m.advanced;
                // Depuis "None" (pas de pavé du tout), ouvrir "…" revient à vouloir composer : on
                // sort de "None" pour que le pavé détaillé apparaisse.
                if (m.advanced && m.rhythmLabel === "None") m.rhythmLabel = null;
                save();
                refreshRhythmMode();
            });

            // -- tempo progressif --
            // Toujours +1 BPM à la fois. Mode simple : « toutes les N s », jusqu'au seuil éventuel. Bouton « … » :
            // paliers successifs (chaque palier a son rythme et son tempo d'arrivée), toujours plafonnés par le seuil.
            var progToggle = document.createElement("button");
            progToggle.type = "button";
            progToggle.className = "metro-mini-btn metro-mini-btn-icon metro-progressive-toggle";
            // Logo : trois marches qui montent (le tempo grimpe pas à pas)
            progToggle.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 20h5v-5.5h5.5V9H19V4"/></svg>';
            progToggle.title = "Tempo progressif : le tempo monte tout seul, de 1 BPM en 1 BPM";
            progToggle.setAttribute("aria-label", "Tempo progressif");
            toolsRow.appendChild(progToggle);

            var progFields = document.createElement("div");
            progFields.className = "metro-progressive-fields";
            // Juste sous la rangée Tap / Progressif (et non tout en bas, sous les formules rythmiques).
            if (toolsRow.parentNode === panel) panel.insertBefore(progFields, toolsRow.nextSibling); else panel.appendChild(progFields);

            // Champ numérique réglable à la saisie, aux chevrons, à la molette et en glissant vers le haut/bas.
            function progNumber(value, min, max, onChange, extra) {
                var inp = document.createElement("input");
                inp.type = "number";
                inp.min = String(min);
                inp.max = String(max);
                inp.className = "metro-prog-input";
                inp.value = value > 0 || min > 0 ? value : "";
                if (extra && extra.placeholder) inp.placeholder = extra.placeholder;
                if (extra && extra.label) inp.setAttribute("aria-label", extra.label);
                inp.addEventListener("change", function () {
                    var n = parseInt(inp.value, 10);
                    n = onChange(isNaN(n) ? null : n);
                    inp.value = n > 0 ? n : "";
                });
                bindScrubInput(inp, min, max, { pxPerStep: (extra && extra.pxPerStep) || 6, wheel: true, emptyStart: extra && extra.emptyStart });
                return inp;
            }
            function progField(label, input) {
                var f = document.createElement("label");
                f.className = "metro-progressive-field";
                f.appendChild(document.createTextNode(label));
                f.appendChild(input);
                return f;
            }
            function progChanged() { metroProgNextAt = null; metroProgIdx = -1; save(); refreshProgStatus(); }

            var progStatus = document.createElement("div");
            progStatus.className = "metro-prog-status";
            // Où en est le tempo progressif : prochaine hausse, ou seuil atteint.
            function refreshProgStatus() {
                var p = m.progressive;
                if (!p.enabled) { progStatus.textContent = ""; return; }
                var stages = metroProgStages(p);
                var idx = metroProgStageIndex(stages, m.bpm);
                var capTxt = function (u) { return u < 300 ? " jusqu'à " + u : ""; };
                if (idx < 0) { progStatus.textContent = "Seuil atteint : le tempo reste à " + m.bpm + " BPM"; return; }
                var stg = stages[idx];
                if (metroPlaying && metroProgNextAt !== null && metroAudioCtx) {
                    var secs = Math.max(0, Math.ceil(metroProgNextAt - metroAudioCtx.currentTime));
                    progStatus.textContent = "+1 BPM dans " + secs + " s" + capTxt(stg.until);
                } else {
                    progStatus.textContent = "+1 BPM toutes les " + stg.every + " s" + capTxt(stg.until) + " (au lancement)";
                }
            }
            var progStatusTimer = setInterval(function () { if (m.progressive.enabled && metroPlaying) refreshProgStatus(); }, 500);

            function renderProgFields() {
                var p = m.progressive;
                progFields.innerHTML = "";
                var row = document.createElement("div");
                row.className = "metro-prog-row";
                progFields.appendChild(row);
                function inlineTxt(parent, t) { var sp = document.createElement("span"); sp.className = "metro-prog-txt"; sp.textContent = t; parent.appendChild(sp); }
                if (!p.stagesMode) {
                    // « +1 bpm / [20] sec » : une seule ligne courte.
                    var every = document.createElement("div");
                    every.className = "metro-prog-inline";
                    inlineTxt(every, "+1 bpm /");
                    every.appendChild(progNumber(p.everySeconds, 1, 600, function (n) {
                        p.everySeconds = Math.min(600, Math.max(1, n || 20)); progChanged(); return p.everySeconds;
                    }, { pxPerStep: 4, label: "Secondes entre deux hausses" }));
                    inlineTxt(every, "sec");
                    row.appendChild(every);
                }
                var seuil = document.createElement("div");
                seuil.className = "metro-prog-inline";
                inlineTxt(seuil, "Seuil");
                seuil.appendChild(progNumber(p.limitBpm, 0, 300, function (n) {
                    p.limitBpm = n ? Math.min(300, Math.max(30, n)) : 0; progChanged(); return p.limitBpm;
                }, { placeholder: "—", emptyStart: Math.min(300, m.bpm + 10), label: "Tempo seuil (BPM)" }));
                row.appendChild(seuil);
                // « … » : paliers, à l'endroit où on les règle.
                var more = document.createElement("button");
                more.type = "button";
                more.className = "metro-mini-btn metro-mini-btn-icon metro-prog-more" + (p.stagesMode ? " metro-progressive-active" : "");
                more.innerHTML = METRO_MORE_ICON_SVG;
                more.title = p.stagesMode ? "Revenir au réglage simple" : "Paliers successifs (ex. toutes les 10 s jusqu'à 90, puis toutes les 20 s jusqu'à 100)";
                more.setAttribute("aria-pressed", p.stagesMode ? "true" : "false");
                more.addEventListener("click", function () {
                    p.stagesMode = !p.stagesMode;
                    if (p.stagesMode && !p.stages.length) {
                        // Premier passage : un palier reprenant le réglage simple, à compléter.
                        p.stages.push({ inc: 1, every: p.everySeconds, until: p.limitBpm || Math.min(300, m.bpm + 20) });
                    }
                    progChanged(); renderProgFields();
                });
                row.appendChild(more);
                if (p.stagesMode) {
                    p.stages.forEach(function (st, i) {
                        var line = document.createElement("div");
                        line.className = "metro-prog-stage";
                        function txt(t) { var sp = document.createElement("span"); sp.textContent = t; line.appendChild(sp); }
                        txt((i + 1) + ".  +1 bpm /");
                        line.appendChild(progNumber(st.every, 1, 600, function (n) { st.every = Math.min(600, Math.max(1, n || 20)); progChanged(); return st.every; }, { pxPerStep: 4, label: "Secondes" }));
                        txt("sec → seuil");
                        line.appendChild(progNumber(st.until, 30, 300, function (n) { st.until = Math.min(300, Math.max(30, n || 100)); progChanged(); return st.until; }, { label: "Tempo d'arrivée" }));
                        var del = document.createElement("button");
                        del.type = "button";
                        del.className = "metro-prog-del";
                        del.textContent = "×";
                        del.title = "Supprimer ce palier";
                        del.addEventListener("click", function () {
                            p.stages.splice(i, 1);
                            if (!p.stages.length) p.stagesMode = false;
                            progChanged(); renderProgFields();
                        });
                        line.appendChild(del);
                        progFields.appendChild(line);
                    });
                    var add = document.createElement("button");
                    add.type = "button";
                    add.className = "metro-mini-btn metro-prog-add";
                    add.textContent = "+ Palier";
                    add.addEventListener("click", function () {
                        var last = p.stages.length ? p.stages[p.stages.length - 1] : null;
                        p.stages.push({ inc: 1, every: last ? last.every : 20, until: Math.min(300, (last ? last.until : m.bpm) + 10) });
                        progChanged(); renderProgFields();
                    });
                    progFields.appendChild(add);
                }
                var opt = document.createElement("label");
                opt.className = "metro-prog-check";
                var cb = document.createElement("input");
                cb.type = "checkbox";
                cb.checked = !!p.restoreOnStop;
                cb.addEventListener("change", function () { p.restoreOnStop = cb.checked; save(); });
                opt.appendChild(cb);
                opt.title = "À l'arrêt, le métronome revient au tempo de départ";
                opt.appendChild(document.createTextNode("Retour tempo après seuil"));
                progFields.appendChild(opt);
                progFields.appendChild(progStatus);
                refreshProgStatus();
            }

            function refreshProgToggle() {
                progToggle.classList.toggle("metro-progressive-active", m.progressive.enabled);
                progFields.hidden = !m.progressive.enabled;
                refreshProgStatus();
            }
            progToggle.addEventListener("click", function () {
                m.progressive.enabled = !m.progressive.enabled;
                metroProgNextAt = null; // le délai part du moment où on l'active
                metroProgIdx = -1;
                save();
                refreshProgToggle();
            });
            renderProgFields();
            refreshProgToggle();

            // Le scheduler change le BPM lui-même (voir metroScheduler) : on ne fait que rafraîchir l'affichage.
            metroTempoCallback = function () { refreshBpmUI(); refreshProgStatus(); };

            // ---------- pavé rythmique ----------
            // Sans "…" : une case par temps de la formule (4/4 = 4 cases, 6/8 = 6 cases). Avec "…" :
            // le pavé détaillé, une case par pas de la subdivision, groupées par temps. Dans les deux
            // cas, un clic fait tourner la case entre vide (silence), gris (normal) et vert (fort).
            // Masqué entièrement en mode "None" (aucun temps accentué).
            var padRow = document.createElement("div");
            padRow.className = "metro-pad";
            panel.appendChild(padRow);

            var footerRow = document.createElement("div");
            footerRow.className = "metro-footer-row";
            panel.appendChild(footerRow);

            // Les groupes (un temps chacun) sont posés dans un simple conteneur flex-wrap : ça tient
            // sur une seule ligne tant que la fenêtre est assez large, et ne revient à la ligne (par
            // groupe entier, jamais coupé en deux) que si la largeur manque vraiment.
            function renderPad() {
                padRow.innerHTML = "";
                padRow.hidden = m.rhythmLabel === "None";
                if (padRow.hidden) return;
                var layer = metroActiveLayer(m);
                var groupSize = metroGroupSize(layer.subdivision);
                var pattern = layer.pattern;
                var groupIdx = 0;
                for (var i = 0; i < pattern.length; i += groupSize) {
                    var groupEl = document.createElement("div");
                    groupEl.className = "metro-beat-group";
                    for (var s = 0; s < groupSize && i + s < pattern.length; s++) {
                        var step = document.createElement("button");
                        step.type = "button";
                        step.className = "metro-step metro-step-" + pattern[i + s];
                        step.dataset.idx = i + s;
                        step.title = (s === 0 ? "Temps " + (groupIdx + 1) : "Pas " + (i + s + 1)) + " : clic = vide / normal / fort (glisser pour en remplir plusieurs)";
                        groupEl.appendChild(step);
                    }
                    padRow.appendChild(groupEl);
                    groupIdx++;
                }
            }

            function setPadStep(stepEl, value) {
                var idx = parseInt(stepEl.dataset.idx, 10);
                metroActiveLayer(m).pattern[idx] = value;
                stepEl.classList.remove("metro-step-0", "metro-step-1", "metro-step-2");
                stepEl.classList.add("metro-step-" + value);
            }

            // Appuyer sur une case la fait tourner d'un cran (comme un clic) ; garder le bouton
            // enfoncé et glisser sur les cases voisines leur donne le même état — de quoi remplir
            // toute une série de doubles-croches d'un seul geste au lieu de les cliquer une à une.
            // Les classes sont mises à jour sur place (pas de nouveau rendu pendant le geste).
            var padPaintValue = null;
            padRow.addEventListener("pointerdown", function (e) {
                var stepEl = e.target.closest ? e.target.closest(".metro-step") : null;
                if (!stepEl || (e.button !== undefined && e.button !== 0)) return;
                e.preventDefault();
                var current = metroActiveLayer(m).pattern[parseInt(stepEl.dataset.idx, 10)];
                padPaintValue = (current + 1) % 3;
                setPadStep(stepEl, padPaintValue);
            });
            function onPadPointerMove(e) {
                if (padPaintValue === null) return;
                var el = document.elementFromPoint(e.clientX, e.clientY);
                var stepEl = el && el.closest ? el.closest(".metro-step") : null;
                if (stepEl && padRow.contains(stepEl) && !stepEl.classList.contains("metro-step-" + padPaintValue)) setPadStep(stepEl, padPaintValue);
            }
            function onPadPointerUp() {
                if (padPaintValue === null) return;
                padPaintValue = null;
                save();
            }
            window.addEventListener("pointermove", onPadPointerMove);
            window.addEventListener("pointerup", onPadPointerUp);
            window.addEventListener("pointercancel", onPadPointerUp);
            // Clavier (Entrée/Espace sur une case) : pas de pointerdown, juste un clic (detail = 0).
            padRow.addEventListener("click", function (e) {
                var stepEl = e.target.closest ? e.target.closest(".metro-step") : null;
                if (!stepEl || e.detail !== 0) return;
                setPadStep(stepEl, (metroActiveLayer(m).pattern[parseInt(stepEl.dataset.idx, 10)] + 1) % 3);
                save();
            });

            refreshRhythmMode();
            metroBeatCallback = function (step) {
                var steps = padRow.querySelectorAll(".metro-step");
                for (var i = 0; i < steps.length; i++) steps[i].classList.toggle("metro-step-current", i === step);
            };

            // ---------- chronomètre ----------
            // Purement visuel (pas persisté) : mesure la durée de la lecture en cours. Il se fige à
            // l'arrêt (on peut lire le temps joué) et repart de zéro au lancement suivant.
            var chronoRow = document.createElement("div");
            chronoRow.className = "metro-chrono-row";
            var chronoIcon = document.createElement("span");
            chronoIcon.className = "metro-chrono-icon";
            chronoIcon.innerHTML = METRO_CHRONO_ICON_SVG;
            var chronoValue = document.createElement("span");
            chronoValue.className = "metro-chrono-value";
            var chronoResetBtn = svgIconButton(RESET_ICON_SVG, "Réinitialiser le chronomètre", function () {
                chronoElapsedMs = 0;
                if (chronoStartTs) chronoStartTs = Date.now();
                refreshChrono();
            });
            chronoResetBtn.classList.add("metro-chrono-reset");
            chronoRow.appendChild(chronoIcon);
            chronoRow.appendChild(chronoValue);
            chronoRow.appendChild(chronoResetBtn);
            footerRow.appendChild(chronoRow);

            var chronoElapsedMs = 0;
            var chronoStartTs = null;
            var chronoInterval = null;
            function chronoCurrentMs() {
                return chronoElapsedMs + (chronoStartTs ? Date.now() - chronoStartTs : 0);
            }
            function refreshChrono() {
                var totalSec = Math.floor(chronoCurrentMs() / 1000);
                var mm = Math.floor(totalSec / 60), ss = totalSec % 60;
                chronoValue.textContent = (mm < 10 ? "0" : "") + mm + ":" + (ss < 10 ? "0" : "") + ss;
            }
            function startChrono() {
                chronoElapsedMs = 0; // chaque lancement repart de zéro (pas de chrono long)
                chronoStartTs = Date.now();
                if (chronoInterval) clearInterval(chronoInterval);
                chronoInterval = setInterval(refreshChrono, 250);
                refreshChrono();
            }
            function stopChrono() {
                if (chronoStartTs) { chronoElapsedMs += Date.now() - chronoStartTs; chronoStartTs = null; }
                if (chronoInterval) { clearInterval(chronoInterval); chronoInterval = null; }
                refreshChrono();
            }
            refreshChrono();

            // ---------- lecture ----------
            // Gros bouton rectangulaire (bords légèrement arrondis, comme le reste de l'appli) en bas
            // du panneau : c'est l'action la plus importante, elle doit rester la plus visible.
            var playBtn = document.createElement("button");
            playBtn.type = "button";
            playBtn.className = "metro-play-btn-big";
            var playBtnIcon = document.createElement("span");
            playBtnIcon.className = "metro-play-btn-icon";
            var playBtnLabel = document.createElement("span");
            playBtn.appendChild(playBtnIcon);
            playBtn.appendChild(playBtnLabel);
            function refreshPlayBtn() {
                playBtn.classList.toggle("metro-play-btn-active", metroPlaying);
                playBtnIcon.innerHTML = metroPlaying ? METRO_STOP_ICON_SVG : METRO_PLAY_ICON_SVG;
                playBtnLabel.textContent = metroPlaying ? "Arrêter" : "Jouer";
                playBtn.title = metroPlaying ? "Arrêter" : "Jouer";
            }
            refreshPlayBtn();
            // Aussi appelée par le raccourci Espace (voir metroPanelApi) : un seul chemin pour lancer
            // ou arrêter, que ce soit au clic ou au clavier.
            function toggleMetroPlayback() {
                if (metroPlaying) { stopMetronome(); stopChrono(); } else { startMetronome(); startChrono(); }
                refreshPlayBtn();
                transportLastTouched = "metro";
            }
            playBtn.addEventListener("click", toggleMetroPlayback);
            metroPanelApi = { toggle: toggleMetroPlayback };
            panel.appendChild(playBtn);

            function setBpm(v) {
                v = Math.min(300, Math.max(30, v));
                m.bpm = v;
                save();
                refreshBpmUI();
            }
            function refreshBpmUI() {
                bpmValue.textContent = m.bpm;
                compactBpm.textContent = m.bpm + " BPM";
                refreshLinkBar();
            }
            refreshBpmUI();

            // On arrête le métronome en fermant le panneau : pas de son qui continue en arrière-plan
            // sans qu'on le voie.
            return function () {
                stopMetronome();
                clearInterval(progStatusTimer);
                window.removeEventListener("pointerup", onPanelPointerUp);
                if (metroLinkRefresh === refreshLinkBar) metroLinkRefresh = null;
                // Fermé pendant l'édition d'un préréglage (sans Enregistrer) : annulation, réglages d'avant rétablis.
                if (metroEdit) { var abandoned = metroEdit; metroEdit = null; applyMetronomePresetToSettings(abandoned.prev); }
                if (chronoInterval) clearInterval(chronoInterval);
                metroBeatCallback = null;
                metroTempoCallback = null;
                metroPanelApi = null;
                window.removeEventListener("pointermove", onDialPointerMove);
                window.removeEventListener("pointerup", onDialPointerUp);
                window.removeEventListener("pointermove", onPadPointerMove);
                window.removeEventListener("pointerup", onPadPointerUp);
                window.removeEventListener("pointercancel", onPadPointerUp);
            };
        }, { fitContent: true, dock: docked });
        if (docked) closeDockedMetronome = closeFn;
    }

    // ---------- aides : cercle des quintes ----------
    var CIRCLE_OF_FIFTHS_MAJOR = ["C", "G", "D", "A", "E", "B", "F♯", "D♭", "A♭", "E♭", "B♭", "F"];
    var CIRCLE_OF_FIFTHS_MINOR = ["Am", "Em", "Bm", "F♯m", "C♯m", "G♯m", "E♭m", "B♭m", "Fm", "Cm", "Gm", "Dm"];
    var CIRCLE_OF_FIFTHS_ACCIDENTALS = ["0", "1♯", "2♯", "3♯", "4♯", "5♯", "6♯", "5♭", "4♭", "3♭", "2♭", "1♭"];

    function buildCircleOfFifthsSvg() {
        var size = 320, cx = size / 2, cy = size / 2;
        // Trois anneaux concentriques : majeur (extérieur), mineur relatif (milieu), altérations (intérieur).
        var outerR = 150, midR = 106, innerR = 62, coreR = 30;
        var labelMajorR = 128, labelMinorR = 84, labelAccR = 46; // position du texte dans chaque anneau
        var ns = "http://www.w3.org/2000/svg";
        var svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", "0 0 " + size + " " + size);
        svg.setAttribute("class", "circle-of-fifths");

        function el(tag, attrs) {
            var n = document.createElementNS(ns, tag);
            for (var k in attrs) n.setAttribute(k, attrs[k]);
            return n;
        }

        function polar(r, angleDeg) {
            var a = (angleDeg - 90) * Math.PI / 180;
            return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
        }

        function wedgePath(r1, r2, a0, a1) {
            var p1 = polar(r2, a0), p2 = polar(r2, a1), p3 = polar(r1, a1), p4 = polar(r1, a0);
            return "M" + p1.x + "," + p1.y +
                " A" + r2 + "," + r2 + " 0 0 1 " + p2.x + "," + p2.y +
                " L" + p3.x + "," + p3.y +
                " A" + r1 + "," + r1 + " 0 0 0 " + p4.x + "," + p4.y + " Z";
        }

        // Dégradé de teintes façon "roue des tonalités" : une couleur par quinte.
        for (var w = 0; w < 12; w++) {
            var hue = w * 30;
            var a0 = w * 30 - 15, a1 = w * 30 + 15;
            svg.appendChild(el("path", {
                d: wedgePath(midR, outerR, a0, a1),
                class: "cof-wedge cof-wedge-outer",
                style: "fill: hsl(" + hue + ", 70%, 55%);"
            }));
            svg.appendChild(el("path", {
                d: wedgePath(innerR, midR, a0, a1),
                class: "cof-wedge cof-wedge-mid",
                style: "fill: hsl(" + hue + ", 70%, 55%);"
            }));
            svg.appendChild(el("path", {
                d: wedgePath(coreR, innerR, a0, a1),
                class: "cof-wedge cof-wedge-core",
                style: "fill: hsl(" + hue + ", 70%, 55%);"
            }));
        }

        svg.appendChild(el("circle", { cx: cx, cy: cy, r: outerR, class: "cof-ring cof-ring-outer" }));
        svg.appendChild(el("circle", { cx: cx, cy: cy, r: midR, class: "cof-ring cof-ring-inner" }));
        svg.appendChild(el("circle", { cx: cx, cy: cy, r: innerR, class: "cof-ring cof-ring-acc" }));

        for (var i = 0; i < 12; i++) {
            var angle = (i * 30 - 90) * Math.PI / 180; // 0 en haut, sens horaire
            // Traits séparateurs entre chaque quinte, sur les trois anneaux.
            var sepAngle = ((i * 30) - 15 - 90) * Math.PI / 180;
            var cosS = Math.cos(sepAngle), sinS = Math.sin(sepAngle);
            svg.appendChild(el("line", {
                x1: cx + midR * cosS, y1: cy + midR * sinS,
                x2: cx + outerR * cosS, y2: cy + outerR * sinS,
                class: "cof-sep"
            }));
            svg.appendChild(el("line", {
                x1: cx + innerR * cosS, y1: cy + innerR * sinS,
                x2: cx + midR * cosS, y2: cy + midR * sinS,
                class: "cof-sep cof-sep-minor"
            }));
            svg.appendChild(el("line", {
                x1: cx + coreR * cosS, y1: cy + coreR * sinS,
                x2: cx + innerR * cosS, y2: cy + innerR * sinS,
                class: "cof-sep cof-sep-acc"
            }));

            var majorX = cx + labelMajorR * Math.cos(angle), majorY = cy + labelMajorR * Math.sin(angle);
            var majorText = el("text", { x: majorX, y: majorY, class: "cof-major" });
            majorText.textContent = CIRCLE_OF_FIFTHS_MAJOR[i];
            svg.appendChild(majorText);

            var minorX = cx + labelMinorR * Math.cos(angle), minorY = cy + labelMinorR * Math.sin(angle);
            var minorText = el("text", { x: minorX, y: minorY, class: "cof-minor" });
            minorText.textContent = CIRCLE_OF_FIFTHS_MINOR[i];
            svg.appendChild(minorText);

            var accX = cx + labelAccR * Math.cos(angle), accY = cy + labelAccR * Math.sin(angle);
            var accText = el("text", { x: accX, y: accY, class: "cof-acc" });
            accText.textContent = CIRCLE_OF_FIFTHS_ACCIDENTALS[i];
            svg.appendChild(accText);
        }

        svg.appendChild(el("circle", { cx: cx, cy: cy, r: coreR, class: "cof-ring cof-ring-core" }));
        return svg;
    }

    function openAidesPanel() {
        openModal("aides-panel", function (panel) {
            var title = document.createElement("div");
            title.className = "backups-title";
            title.textContent = "Cercle des quintes";
            panel.appendChild(title);

            var wrap = document.createElement("div");
            wrap.className = "cof-wrap";
            wrap.appendChild(buildCircleOfFifthsSvg());
            panel.appendChild(wrap);
        });
    }

    // ---------- gammes & arpèges ----------
    // Simple visualisation (pas de son) des gammes/modes/arpèges sur les manches (basse 4 et 5
    // cordes, guitare) et le clavier — géométrie du manche reprise de celle de HarmoHub
    // (buildGuitarDiagramSVG : mêmes espacements stringGap/fretGap/marginLeft/marginTop, sillet à
    // gauche, corde la plus AIGUË en haut), généralisée à un nombre de cordes quelconque au lieu de
    // 6 fixes, et augmentée d'un texte sur chaque note (intervalle ou nom, au choix).
    var NOTE_NAMES_SHARP = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

    // Catalogue complet. `semis` = demi-tons depuis la tonique (croissants, dans l'octave), `degrees` =
    // intervalles affichés. L'ordre d'affichage dans le menu est décidé par SCALE_MENU plus bas.
    function sc(key, kind, label, semis, degrees) { return { key: key, kind: kind, label: label, semis: semis, degrees: degrees }; }
    var SCALE_DEFS = [
        // Gammes courantes
        sc("major", "Gammes", "Majeur", [0, 2, 4, 5, 7, 9, 11], ["1", "2", "3", "4", "5", "6", "7"]),
        sc("aeolian", "Gammes", "Mineur naturel", [0, 2, 3, 5, 7, 8, 10], ["1", "2", "♭3", "4", "5", "♭6", "♭7"]),
        sc("harmonicMinor", "Gammes", "Mineur harmonique", [0, 2, 3, 5, 7, 8, 11], ["1", "2", "♭3", "4", "5", "♭6", "7"]),
        sc("melodicMinor", "Gammes", "Mineur mélodique", [0, 2, 3, 5, 7, 9, 11], ["1", "2", "♭3", "4", "5", "6", "7"]),
        sc("majorPenta", "Gammes", "Pentatonique majeure", [0, 2, 4, 7, 9], ["1", "2", "3", "5", "6"]),
        sc("minorPenta", "Gammes", "Pentatonique mineure", [0, 3, 5, 7, 10], ["1", "♭3", "4", "5", "♭7"]),
        sc("blues", "Gammes", "Blues", [0, 3, 5, 6, 7, 10], ["1", "♭3", "4", "♭5", "5", "♭7"]),
        // Modes de la gamme majeure
        sc("dorian", "Gammes", "Dorien", [0, 2, 3, 5, 7, 9, 10], ["1", "2", "♭3", "4", "5", "6", "♭7"]),
        sc("phrygian", "Gammes", "Phrygien", [0, 1, 3, 5, 7, 8, 10], ["1", "♭2", "♭3", "4", "5", "♭6", "♭7"]),
        sc("lydian", "Gammes", "Lydien", [0, 2, 4, 6, 7, 9, 11], ["1", "2", "3", "♯4", "5", "6", "7"]),
        sc("mixolydian", "Gammes", "Mixolydien", [0, 2, 4, 5, 7, 9, 10], ["1", "2", "3", "4", "5", "6", "♭7"]),
        sc("locrian", "Gammes", "Locrien", [0, 1, 3, 5, 6, 8, 10], ["1", "♭2", "♭3", "4", "♭5", "♭6", "♭7"]),
        // Modes du mineur mélodique
        sc("dorianb2", "Gammes", "Dorien ♭2 (Phrygien ♮6)", [0, 1, 3, 5, 7, 9, 10], ["1", "♭2", "♭3", "4", "5", "6", "♭7"]),
        sc("lydianAug", "Gammes", "Lydien augmenté", [0, 2, 4, 6, 8, 9, 11], ["1", "2", "3", "♯4", "♯5", "6", "7"]),
        sc("lydianDom", "Gammes", "Lydien dominant", [0, 2, 4, 6, 7, 9, 10], ["1", "2", "3", "♯4", "5", "6", "♭7"]),
        sc("mixolydianb6", "Gammes", "Mixolydien ♭6", [0, 2, 4, 5, 7, 8, 10], ["1", "2", "3", "4", "5", "♭6", "♭7"]),
        sc("locrianNat2", "Gammes", "Locrien ♮2", [0, 2, 3, 5, 6, 8, 10], ["1", "2", "♭3", "4", "♭5", "♭6", "♭7"]),
        sc("altered", "Gammes", "Altéré (Super-locrien)", [0, 1, 3, 4, 6, 8, 10], ["1", "♭2", "♭3", "♭4", "♭5", "♭6", "♭7"]),
        // Modes du mineur harmonique
        sc("locrianNat6", "Gammes", "Locrien ♮6", [0, 1, 3, 5, 6, 9, 10], ["1", "♭2", "♭3", "4", "♭5", "6", "♭7"]),
        sc("ionianAug", "Gammes", "Ionien ♯5", [0, 2, 4, 5, 8, 9, 11], ["1", "2", "3", "4", "♯5", "6", "7"]),
        sc("dorianSharp4", "Gammes", "Dorien ♯4", [0, 2, 3, 6, 7, 9, 10], ["1", "2", "♭3", "♯4", "5", "6", "♭7"]),
        sc("phrygianDominant", "Gammes", "Phrygien dominant (flamenco)", [0, 1, 4, 5, 7, 8, 10], ["1", "♭2", "3", "4", "5", "♭6", "♭7"]),
        sc("lydianSharp2", "Gammes", "Lydien ♯2", [0, 3, 4, 6, 7, 9, 11], ["1", "♯2", "3", "♯4", "5", "6", "7"]),
        sc("superLocrianbb7", "Gammes", "Super-locrien ♭♭7", [0, 1, 3, 4, 6, 8, 9], ["1", "♭2", "♭3", "♭4", "♭5", "♭6", "♭♭7"]),
        // Autres gammes
        sc("bluesMajor", "Gammes", "Blues majeur", [0, 2, 3, 4, 7, 9], ["1", "2", "♭3", "3", "5", "6"]),
        sc("wholeTone", "Gammes", "Gamme par tons", [0, 2, 4, 6, 8, 10], ["1", "2", "3", "♯4", "♯5", "♭7"]),
        sc("dimWH", "Gammes", "Diminuée (ton – demi-ton)", [0, 2, 3, 5, 6, 8, 9, 11], ["1", "2", "♭3", "4", "♭5", "♭6", "6", "7"]),
        sc("dimHW", "Gammes", "Diminuée (demi-ton – ton)", [0, 1, 3, 4, 6, 7, 9, 10], ["1", "♭2", "♭3", "3", "♭5", "5", "6", "♭7"]),
        sc("bebopDominant", "Gammes", "Bebop dominante", [0, 2, 4, 5, 7, 9, 10, 11], ["1", "2", "3", "4", "5", "6", "♭7", "7"]),
        sc("bebopMajor", "Gammes", "Bebop majeure", [0, 2, 4, 5, 7, 8, 9, 11], ["1", "2", "3", "4", "5", "♭6", "6", "7"]),
        sc("chromatic", "Gammes", "Chromatique", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], ["1", "♭2", "2", "♭3", "3", "4", "♭5", "5", "♭6", "6", "♭7", "7"]),
        // Gammes du monde
        sc("hungarianMinor", "Gammes", "Hongroise mineure", [0, 2, 3, 6, 7, 8, 11], ["1", "2", "♭3", "♯4", "5", "♭6", "7"]),
        sc("doubleHarmonic", "Gammes", "Double harmonique (byzantine)", [0, 1, 4, 5, 7, 8, 11], ["1", "♭2", "3", "4", "5", "♭6", "7"]),
        sc("neapolitanMinor", "Gammes", "Napolitaine mineure", [0, 1, 3, 5, 7, 8, 11], ["1", "♭2", "♭3", "4", "5", "♭6", "7"]),
        sc("neapolitanMajor", "Gammes", "Napolitaine majeure", [0, 1, 3, 5, 7, 9, 11], ["1", "♭2", "♭3", "4", "5", "6", "7"]),
        sc("persian", "Gammes", "Persane", [0, 1, 4, 5, 6, 8, 11], ["1", "♭2", "3", "4", "♭5", "♭6", "7"]),
        sc("hirajoshi", "Gammes", "Hirajoshi (japonaise)", [0, 2, 3, 7, 8], ["1", "2", "♭3", "5", "♭6"]),
        sc("inSen", "Gammes", "In-sen (japonaise)", [0, 1, 5, 7, 10], ["1", "♭2", "4", "5", "♭7"]),
        sc("iwato", "Gammes", "Iwato (japonaise)", [0, 1, 5, 6, 10], ["1", "♭2", "4", "♭5", "♭7"]),
        sc("egyptian", "Gammes", "Pentatonique suspendue (égyptienne)", [0, 2, 5, 7, 10], ["1", "2", "4", "5", "♭7"]),
        // Arpèges : triades
        sc("triadMaj", "Arpèges", "Triade majeure", [0, 4, 7], ["1", "3", "5"]),
        sc("triadMin", "Arpèges", "Triade mineure", [0, 3, 7], ["1", "♭3", "5"]),
        sc("triadDim", "Arpèges", "Triade diminuée", [0, 3, 6], ["1", "♭3", "♭5"]),
        sc("triadAug", "Arpèges", "Triade augmentée", [0, 4, 8], ["1", "3", "♯5"]),
        sc("sus2", "Arpèges", "Suspendue 2 (sus2)", [0, 2, 7], ["1", "2", "5"]),
        sc("sus4", "Arpèges", "Suspendue 4 (sus4)", [0, 5, 7], ["1", "4", "5"]),
        // Arpèges : septièmes et sixtes
        sc("maj7", "Arpèges", "Septième majeure (maj7)", [0, 4, 7, 11], ["1", "3", "5", "7"]),
        sc("dom7", "Arpèges", "Septième de dominante (7)", [0, 4, 7, 10], ["1", "3", "5", "♭7"]),
        sc("min7", "Arpèges", "Septième mineure (m7)", [0, 3, 7, 10], ["1", "♭3", "5", "♭7"]),
        sc("min7b5", "Arpèges", "Demi-diminuée (m7♭5)", [0, 3, 6, 10], ["1", "♭3", "♭5", "♭7"]),
        sc("dim7", "Arpèges", "Diminuée 7 (dim7)", [0, 3, 6, 9], ["1", "♭3", "♭5", "♭♭7"]),
        sc("minMaj7", "Arpèges", "Mineure/majeure 7 (mMaj7)", [0, 3, 7, 11], ["1", "♭3", "5", "7"]),
        sc("maj6", "Arpèges", "Sixte majeure (6)", [0, 4, 7, 9], ["1", "3", "5", "6"]),
        sc("min6", "Arpèges", "Sixte mineure (m6)", [0, 3, 7, 9], ["1", "♭3", "5", "6"]),
        // Arpèges : extensions et altérations
        sc("dom9", "Arpèges", "Neuvième de dominante (9)", [0, 2, 4, 7, 10], ["1", "9", "3", "5", "♭7"]),
        sc("maj9", "Arpèges", "Neuvième majeure (maj9)", [0, 2, 4, 7, 11], ["1", "9", "3", "5", "7"]),
        sc("min9", "Arpèges", "Neuvième mineure (m9)", [0, 2, 3, 7, 10], ["1", "9", "♭3", "5", "♭7"]),
        sc("dom7sus4", "Arpèges", "Septième sus4 (7sus4)", [0, 5, 7, 10], ["1", "4", "5", "♭7"]),
        sc("aug7", "Arpèges", "Septième augmentée (7♯5)", [0, 4, 8, 10], ["1", "3", "♯5", "♭7"]),
        sc("dom7b5", "Arpèges", "Septième ♭5 (7♭5)", [0, 4, 6, 10], ["1", "3", "♭5", "♭7"]),
        sc("maj7s5", "Arpèges", "Majeure 7 ♯5 (maj7♯5)", [0, 4, 8, 11], ["1", "3", "♯5", "7"])
    ];

    var FRETBOARD_TUNINGS = [
        { key: "bass4", label: "Basse", midis: [28, 33, 38, 43] },
        { key: "bass5", label: "Basse 5 cordes", midis: [23, 28, 33, 38, 43] },
        { key: "guitar", label: "Guitare", midis: [40, 45, 50, 55, 59, 64] }
    ];
    var FRETBOARD_DISPLAY_FRETS = 24;
    var FRETBOARD_SINGLE_MARKERS = [3, 5, 7, 9, 15, 17, 19, 21];
    var FRETBOARD_DOUBLE_MARKERS = [12, 24];

    function scaleNoteLabel(def, semiIdx, pc, labelMode) {
        return labelMode === "notes" ? NOTE_NAMES_SHARP[pc] : def.degrees[semiIdx];
    }

    // sz : { s: échelle de base (taille de l'écran), w / h: réglages de largeur et de hauteur propres à
    // l'instrument }. Largeur et hauteur ne changent que les ESPACEMENTS (cases et cordes) ; les pastilles
    // gardent leur taille, elles ne sont jamais déformées.
    function buildFretboardSvg(tuning, def, rootPc, labelMode, fretCount, sz) {
        sz = sz || { s: 1, w: 1, h: 1 };
        var S = sz.s;
        var FRETS = fretCount || FRETBOARD_DISPLAY_FRETS;
        var ns = "http://www.w3.org/2000/svg";
        var noteR = 9 * S, openR = 7.6 * S;
        var stringGap = 26 * S * sz.h, fretGap = 38 * S * sz.w, marginLeft = 24 * S, marginTop = 14 * S, labelRowH = 26 * S;
        stringGap = Math.max(stringGap, 2 * noteR + 3);
        var n = tuning.midis.length;
        var stringsSpan = stringGap * (n - 1);
        var width = Math.round(marginLeft + fretGap * FRETS + 8 * S);
        var height = Math.round(marginTop + stringsSpan + labelRowH + 4 * S);
        var svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", "0 0 " + width + " " + height);
        svg.setAttribute("width", width);
        svg.setAttribute("height", height);
        svg.setAttribute("class", "fretboard-svg");

        function el(tag, attrs) {
            var e = document.createElementNS(ns, tag);
            for (var k in attrs) e.setAttribute(k, attrs[k]);
            return e;
        }
        function stringY(s) { return marginTop + (n - 1 - s) * stringGap; }

        svg.appendChild(el("rect", { x: marginLeft - 2, y: marginTop, width: 3, height: stringsSpan, class: "fretboard-nut" }));
        for (var c = 1; c <= FRETS; c++) {
            var x = marginLeft + c * fretGap;
            svg.appendChild(el("line", { x1: x, y1: marginTop, x2: x, y2: marginTop + stringsSpan, class: "fretboard-fret" }));
        }
        for (var s = 0; s < n; s++) {
            var y = stringY(s);
            svg.appendChild(el("line", { x1: marginLeft, y1: y, x2: marginLeft + fretGap * FRETS, y2: y, class: "fretboard-string" }));
        }
        var midY = marginTop + stringsSpan / 2;
        var labelY = marginTop + stringsSpan + 23 * S; // sous les pastilles de la dernière corde, pas cachées par elles
        // Repères des vrais manches : un point aux cases 3, 5, 7, 9 (15, 17, 19, 21), deux à la 12 (et 24),
        // dessinés sous les notes, ENTRE deux cordes (jamais sous une pastille) : le rayon est borné par la
        // place qui reste entre le milieu de l'espace et la pastille voisine, pour ne jamais être tronqué.
        // Nombre impair de cordes : le centre tombe sur une corde, les repères sont alors décalés d'un demi-espace.
        var odd = n % 2 === 1;
        var singleY = odd ? midY + stringGap / 2 : midY;
        var doubleOffset = odd ? stringGap * 1.5 : stringGap;
        var inlayR = Math.max(1.6, Math.min(3.6 * S, stringGap / 2 - noteR - 0.8));
        function fretLabel(mx, fret) {
            var t = el("text", { x: mx, y: labelY, class: "fretboard-fret-label" });
            t.style.fontSize = (11 * S) + "px";
            t.textContent = fret;
            svg.appendChild(t);
        }
        FRETBOARD_SINGLE_MARKERS.forEach(function (fret) {
            if (fret > FRETS) return;
            var mx = marginLeft + (fret - 0.5) * fretGap;
            svg.appendChild(el("circle", { cx: mx, cy: singleY, r: inlayR, class: "fretboard-inlay" }));
            fretLabel(mx, fret);
        });
        FRETBOARD_DOUBLE_MARKERS.forEach(function (fret) {
            if (fret > FRETS) return;
            var mx = marginLeft + (fret - 0.5) * fretGap;
            svg.appendChild(el("circle", { cx: mx, cy: midY - doubleOffset, r: inlayR, class: "fretboard-inlay" }));
            svg.appendChild(el("circle", { cx: mx, cy: midY + doubleOffset, r: inlayR, class: "fretboard-inlay" }));
            fretLabel(mx, fret);
        });

        for (var s2 = 0; s2 < n; s2++) {
            for (var fret2 = 0; fret2 <= FRETS; fret2++) {
                var pc = (tuning.midis[s2] + fret2) % 12;
                var diff = (pc - rootPc + 12) % 12;
                var semiIdx = def.semis.indexOf(diff);
                if (semiIdx === -1) continue;
                var isRoot = diff === 0;
                var nx = fret2 === 0 ? marginLeft - 11 * S : marginLeft + (fret2 - 0.5) * fretGap;
                var ny = stringY(s2);
                var r = fret2 === 0 ? openR : noteR;
                svg.appendChild(el("circle", { cx: nx, cy: ny, r: r, class: "fretboard-note" + (isRoot ? " fretboard-note-root" : "") }));
                // Texte au centre exact du cercle : dy = 0,35 em (hauteur de ligne), plutôt qu'un
                // décalage en px qui le laissait trop bas.
                var t = el("text", { x: nx, y: ny, dy: "0.35em", class: "fretboard-note-label" });
                t.style.fontSize = (9.5 * S) + "px";
                t.textContent = scaleNoteLabel(def, semiIdx, pc, labelMode);
                svg.appendChild(t);
            }
        }
        return svg;
    }

    // ---------- clavier (piano) ----------
    function roundedBottomRectPath(x, y, w, h, r) {
        return "M" + x + "," + y + " H" + (x + w) + " V" + (y + h - r) + " Q" + (x + w) + "," + (y + h) + " " + (x + w - r) + "," + (y + h) +
            " H" + (x + r) + " Q" + x + "," + (y + h) + " " + x + "," + (y + h - r) + " Z";
    }
    var PIANO_LOW_MIDI = 48; // C3
    var PIANO_HIGH_MIDI = 72; // C5, deux octaves complètes
    var PIANO_BLACK_PCS = [1, 3, 6, 8, 10];

    function buildPianoScaleSvg(def, rootPc, labelMode) {
        var ns = "http://www.w3.org/2000/svg";
        var keyW = 36, keyH = 130, blackW = keyW * 0.62, blackH = keyH * 0.6;
        var whiteMidis = [];
        for (var m = PIANO_LOW_MIDI; m <= PIANO_HIGH_MIDI; m++) {
            if (PIANO_BLACK_PCS.indexOf(((m % 12) + 12) % 12) === -1) whiteMidis.push(m);
        }
        var width = whiteMidis.length * keyW;
        var svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", "0 0 " + width + " " + keyH);
        svg.setAttribute("width", width);
        svg.setAttribute("height", keyH);
        svg.setAttribute("class", "piano-scale-svg");

        function el(tag, attrs) {
            var e = document.createElementNS(ns, tag);
            for (var k in attrs) e.setAttribute(k, attrs[k]);
            return e;
        }
        function activeFor(midi) {
            var pc = ((midi % 12) + 12) % 12;
            var diff = (pc - rootPc + 12) % 12;
            var semiIdx = def.semis.indexOf(diff);
            if (semiIdx === -1) return null;
            return { isRoot: diff === 0, label: scaleNoteLabel(def, semiIdx, pc, labelMode) };
        }

        whiteMidis.forEach(function (midi, i) {
            var active = activeFor(midi);
            var x = i * keyW, w = keyW - 1;
            var path = el("path", { d: roundedBottomRectPath(x, 0, w, keyH, 3), class: "piano-key-white" + (active ? " piano-key-active" + (active.isRoot ? " piano-key-root" : "") : "") });
            svg.appendChild(path);
            if (active) {
                var t = el("text", { x: x + w / 2, y: keyH - 8, class: "piano-key-label" });
                t.textContent = active.label;
                svg.appendChild(t);
            }
        });
        var whiteSeen = 0;
        for (var midi2 = PIANO_LOW_MIDI; midi2 <= PIANO_HIGH_MIDI; midi2++) {
            var isBlack = PIANO_BLACK_PCS.indexOf(((midi2 % 12) + 12) % 12) !== -1;
            if (!isBlack) { whiteSeen++; continue; }
            var active2 = activeFor(midi2);
            var x2 = whiteSeen * keyW - blackW / 2;
            var path2 = el("path", { d: roundedBottomRectPath(x2, 0, blackW, blackH, 2.5), class: "piano-key-black" + (active2 ? " piano-key-active" + (active2.isRoot ? " piano-key-root" : "") : "") });
            svg.appendChild(path2);
            if (active2) {
                var t2 = el("text", { x: x2 + blackW / 2, y: blackH - 8, class: "piano-key-label piano-key-label-black" });
                t2.textContent = active2.label;
                svg.appendChild(t2);
            }
        }
        return svg;
    }

    // Un seul instrument affiché à la fois (menu déroulant) plutôt que 4 manches entassés : le piano
    // n'est qu'un choix de plus dans la même liste, à côté des accordages de cordes.
    var SCALES_INSTRUMENTS = [
        { key: "bass4", label: "Basse", short: "Basse", type: "fretboard", tuning: FRETBOARD_TUNINGS[0] },
        { key: "bass5", label: "Basse 5 cordes", short: "Basse 5 cordes", type: "fretboard", tuning: FRETBOARD_TUNINGS[1] },
        { key: "guitar", label: "Guitare", short: "Guitare", type: "fretboard", tuning: FRETBOARD_TUNINGS[2] },
        { key: "piano", label: "Piano", short: "Piano", type: "piano" }
    ];
    // Menu des gammes : les familles courantes toujours visibles, les autres (peu utilisées ou
    // complexes) derrière le bouton « … » à côté du menu. Toutes les entrées de SCALE_DEFS y figurent.
    var SCALE_MENU = [
        { label: "Gammes courantes", extra: false, keys: ["major", "aeolian", "majorPenta", "minorPenta", "blues", "harmonicMinor", "melodicMinor"] },
        { label: "Modes de la gamme majeure", extra: false, keys: ["dorian", "phrygian", "lydian", "mixolydian", "locrian"] },
        { label: "Arpèges : triades", extra: false, keys: ["triadMaj", "triadMin", "triadDim", "triadAug", "sus2", "sus4"] },
        { label: "Arpèges : septièmes et sixtes", extra: false, keys: ["maj7", "dom7", "min7", "min7b5", "dim7", "minMaj7", "maj6", "min6"] },
        { label: "Arpèges : extensions et altérations", extra: true, keys: ["dom9", "maj9", "min9", "dom7sus4", "aug7", "dom7b5", "maj7s5"] },
        { label: "Modes du mineur mélodique", extra: true, keys: ["dorianb2", "lydianAug", "lydianDom", "mixolydianb6", "locrianNat2", "altered"] },
        { label: "Modes du mineur harmonique", extra: true, keys: ["locrianNat6", "ionianAug", "dorianSharp4", "phrygianDominant", "lydianSharp2", "superLocrianbb7"] },
        { label: "Autres gammes", extra: true, keys: ["bluesMajor", "wholeTone", "dimWH", "dimHW", "bebopDominant", "bebopMajor", "chromatic"] },
        { label: "Gammes du monde", extra: true, keys: ["hungarianMinor", "doubleHarmonic", "neapolitanMinor", "neapolitanMajor", "persian", "hirajoshi", "inSen", "iwato", "egyptian"] }
    ];
    function scaleIsExtra(key) {
        return SCALE_MENU.some(function (g) { return g.extra && g.keys.indexOf(key) !== -1; });
    }
    var ROOT_MENU_NAMES = ["C", "C♯ / D♭", "D", "D♯ / E♭", "E", "F", "F♯ / G♭", "G", "G♯ / A♭", "A", "A♯ / B♭", "B"];
    var SCALES_PREFS_KEY = "trainhub.scalesPrefs.v1";
    var SIZE_MIN = 0.7, SIZE_MAX = 1.6, SIZE_STEP = 0.1;
    function loadScalesPrefs() {
        var p = {};
        try { p = JSON.parse(localStorage.getItem(SCALES_PREFS_KEY)) || {}; } catch (e) {}
        var isPhone = window.matchMedia && window.matchMedia("(max-width: 700px)").matches;
        return {
            root: typeof p.root === "number" && p.root >= 0 && p.root < 12 ? p.root : 0,
            type: SCALE_DEFS.some(function (d) { return d.key === p.type; }) ? p.type : "major",
            showAll: p.showAll === true || (SCALE_DEFS.some(function (d) { return d.key === p.type; }) && scaleIsExtra(p.type)),
            instrument: SCALES_INSTRUMENTS.some(function (i) { return i.key === p.instrument; }) ? p.instrument : "bass4",
            labelMode: p.labelMode === "notes" ? "notes" : "degrees",
            frets: p.frets === 24 ? 24 : 12,
            zoom: isPhone ? 0.85 : 1.2, // échelle de base selon l'écran (plus de réglage global : voir sizes)
            // Largeur / hauteur du diagramme, retenues pour chaque instrument : { bass4: { w: 1, h: 1 }, … }
            sizes: (function (src) {
                var out = {};
                SCALES_INSTRUMENTS.forEach(function (i) {
                    var v = src && src[i.key] || {};
                    function ok(x) { return typeof x === "number" && x >= SIZE_MIN && x <= SIZE_MAX ? x : 1; }
                    out[i.key] = { w: ok(v.w), h: ok(v.h) };
                });
                return out;
            })(p.sizes)
        };
    }
    function saveScalesPrefs(p) {
        try { localStorage.setItem(SCALES_PREFS_KEY, JSON.stringify(p)); } catch (e) {}
    }

    // Menu des gammes sur mesure (le menu natif pouvait dépasser de l'écran) : s'ouvre vers le haut ou le bas
    // selon la place disponible, hauteur bornée à l'écran, défile si besoin. Les familles rares n'apparaissent
    // qu'avec « … » (la famille de la gamme choisie reste toujours listée).
    function openScalePicker(anchor, prefs, onPick) {
        var old = document.querySelector(".scales-picker");
        if (old) old.remove();
        var pop = document.createElement("div");
        pop.className = "scales-picker";
        pop.setAttribute("role", "listbox");
        var current = null;
        SCALE_MENU.forEach(function (g) {
            if (g.extra && !prefs.showAll && g.keys.indexOf(prefs.type) === -1) return;
            var h = document.createElement("div");
            h.className = "scales-picker-group";
            h.textContent = g.label;
            pop.appendChild(h);
            g.keys.forEach(function (key) {
                var d = SCALE_DEFS.filter(function (x) { return x.key === key; })[0];
                var b = document.createElement("button");
                b.type = "button";
                b.className = "scales-picker-item" + (key === prefs.type ? " scales-picker-item-on" : "");
                b.textContent = d.label;
                b.setAttribute("role", "option");
                b.dataset.key = key;
                b.addEventListener("click", function () { close(); onPick(key); });
                pop.appendChild(b);
                if (key === prefs.type) current = b;
            });
        });
        document.body.appendChild(pop);
        var r = anchor.getBoundingClientRect();
        var below = window.innerHeight - r.bottom - 12, above = r.top - 12;
        var openBelow = below >= Math.min(360, above) || below >= above;
        pop.style.minWidth = Math.max(r.width, 240) + "px";
        pop.style.maxHeight = Math.max(140, openBelow ? below : above) + "px";
        pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left)) + "px";
        if (openBelow) pop.style.top = (r.bottom + 4) + "px";
        else pop.style.top = Math.max(8, r.top - 4 - pop.offsetHeight) + "px";
        if (current) current.scrollIntoView({ block: "center" });
        var closed = false;
        function onDown(e) { if (!pop.contains(e.target) && e.target !== anchor) close(); }
        function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
        function close() { if (closed) return; closed = true; document.removeEventListener("pointerdown", onDown, true); window.removeEventListener("keydown", onKey, true); pop.remove(); }
        setTimeout(function () { document.addEventListener("pointerdown", onDown, true); }, 0);
        window.addEventListener("keydown", onKey, true);
    }

    function openScalesPanel() {
        openModal("scales-panel", function (panel) {
            // Deux lignes : en-tête (titre à gauche, instrument à droite) puis une seule rangée de réglages.
            var headRow = document.createElement("div");
            headRow.className = "scales-head";
            var title = document.createElement("div");
            title.className = "backups-title";
            title.textContent = "Gammes & arpèges";
            headRow.appendChild(title);
            panel.appendChild(headRow);
            var controls = document.createElement("div");
            controls.className = "scales-controls";
            panel.appendChild(controls);

            var prefs = loadScalesPrefs();

            // Une rangée par question, dans l'ordre où on se la pose : sur quel instrument, quelle
            // tonique, quelle gamme, puis comment l'afficher. Des menus déroulants (peu d'encombrement
            // malgré le grand nombre de gammes) ; les gammes rares sont derrière le bouton « … ».
            function row(labelText, extraClass) {
                var r = document.createElement("div");
                r.className = "scales-row" + (extraClass ? " " + extraClass : "");
                var l = document.createElement("div");
                l.className = "scales-row-label";
                l.textContent = labelText;
                var chips = document.createElement("div");
                chips.className = "scales-chips";
                r.appendChild(l);
                r.appendChild(chips);
                panel.appendChild(r);
                return chips;
            }
            function chip(container, text, titleText, onClick) {
                var b = document.createElement("button");
                b.type = "button";
                b.className = "scales-chip";
                b.textContent = text;
                if (titleText) b.title = titleText;
                b.addEventListener("click", onClick);
                container.appendChild(b);
                return b;
            }
            function select(container, labelText, onChange) {
                var sel = document.createElement("select");
                sel.className = "scales-select";
                sel.setAttribute("aria-label", labelText);
                sel.addEventListener("change", function () { onChange(sel.value); });
                container.appendChild(sel);
                return sel;
            }
            function addOption(parent, value, text) {
                var o = document.createElement("option");
                o.value = value;
                o.textContent = text;
                parent.appendChild(o);
            }

            var instSelect = select(headRow, "Instrument", function (v) { prefs.instrument = v; update(); });
            instSelect.classList.add("scales-select-inst");
            SCALES_INSTRUMENTS.forEach(function (inst) { addOption(instSelect, inst.key, inst.label); });

            // Rangée de réglages : tonique · gamme (menu sur mesure, voir openScalePicker) · « … » · affichage
            // (intervalles/notes, 12/24 cases, largeur, hauteur). Sans libellés : des infobulles à la place.
            var rootSelect = select(controls, "Tonique", function (v) { prefs.root = parseInt(v, 10); update(); });
            rootSelect.classList.add("scales-select-root");
            ROOT_MENU_NAMES.forEach(function (name, pc) { addOption(rootSelect, String(pc), name); });

            var typeBtn = document.createElement("button");
            typeBtn.type = "button";
            typeBtn.className = "scales-pick-btn";
            typeBtn.setAttribute("aria-label", "Gamme ou arpège");
            typeBtn.setAttribute("aria-haspopup", "listbox");
            controls.appendChild(typeBtn);
            var moreBtn = chip(controls, "…", "Afficher aussi les gammes peu utilisées ou complexes", function () { prefs.showAll = !prefs.showAll; update(); });
            moreBtn.classList.add("scales-more-btn");
            typeBtn.addEventListener("click", function () { openScalePicker(typeBtn, prefs, function (key) { prefs.type = key; update(); }); });

            var labelSeg = document.createElement("div");
            labelSeg.className = "scales-chips scales-segmented";
            controls.appendChild(labelSeg);
            var degreesBtn = chip(labelSeg, "Intervalles", null, function () { prefs.labelMode = "degrees"; update(); });
            var notesBtn = chip(labelSeg, "Notes", null, function () { prefs.labelMode = "notes"; update(); });
            var fretSeg = document.createElement("div");
            fretSeg.className = "scales-chips scales-segmented";
            controls.appendChild(fretSeg);
            var frets12Btn = chip(fretSeg, "12", "Manche jusqu'à la 12e case", function () { prefs.frets = 12; update(); });
            var frets24Btn = chip(fretSeg, "24", "Manche complet (24 cases)", function () { prefs.frets = 24; update(); });
            // Largeur et hauteur du diagramme : « icône − + », retenus pour chaque instrument.
            var ICON_WIDTH = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg>';
            var ICON_HEIGHT = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/></svg>';
            function sizeSeg(iconSvg, titleText, key) {
                var seg = document.createElement("div");
                seg.className = "scales-chips scales-segmented scales-size-seg";
                seg.title = titleText;
                var lab = document.createElement("span");
                lab.className = "scales-seg-icon";
                lab.innerHTML = iconSvg;
                seg.appendChild(lab);
                function bump(d) {
                    var cur = prefs.sizes[prefs.instrument];
                    cur[key] = Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round((cur[key] + d) * 100) / 100));
                    update();
                }
                var minus = chip(seg, "−", titleText + " : réduire", function () { bump(-SIZE_STEP); });
                var plus = chip(seg, "+", titleText + " : augmenter", function () { bump(SIZE_STEP); });
                minus.classList.add("scales-chip-icon");
                plus.classList.add("scales-chip-icon");
                controls.appendChild(seg);
                return { minus: minus, plus: plus };
            }
            var widthCtl = sizeSeg(ICON_WIDTH, "Largeur du diagramme", "w");
            var heightCtl = sizeSeg(ICON_HEIGHT, "Hauteur du diagramme", "h");

            var summary = document.createElement("div");
            summary.className = "scales-summary";
            panel.appendChild(summary);

            var diagramsWrap = document.createElement("div");
            diagramsWrap.className = "scales-diagrams";
            panel.appendChild(diagramsWrap);

            // Légende des couleurs (communes au manche et au clavier).
            var legend = document.createElement("div");
            legend.className = "scales-legend";
            [["scales-dot-root", "Tonique"], ["scales-dot-note", "Note de la gamme"]].forEach(function (it) {
                var item = document.createElement("span");
                item.className = "scales-legend-item";
                var dot = document.createElement("span");
                dot.className = "scales-dot " + it[0];
                item.appendChild(dot);
                item.appendChild(document.createTextNode(it[1]));
                legend.appendChild(item);
            });
            panel.appendChild(legend);

            function setActive(btns, pred) { btns.forEach(function (b, i) { b.classList.toggle("scales-chip-active", !!pred(i)); }); }

            function update() {
                saveScalesPrefs(prefs);
                instSelect.value = prefs.instrument;
                rootSelect.value = String(prefs.root);
                var curDef = SCALE_DEFS.filter(function (d) { return d.key === prefs.type; })[0];
                typeBtn.textContent = curDef.label;
                typeBtn.title = curDef.label;
                typeBtn.dataset.key = prefs.type;
                moreBtn.classList.toggle("scales-chip-active", prefs.showAll);
                degreesBtn.classList.toggle("scales-chip-active", prefs.labelMode === "degrees");
                notesBtn.classList.toggle("scales-chip-active", prefs.labelMode === "notes");
                var inst = SCALES_INSTRUMENTS.filter(function (i) { return i.key === prefs.instrument; })[0];
                fretSeg.hidden = inst.type === "piano";
                frets12Btn.classList.toggle("scales-chip-active", prefs.frets === 12);
                frets24Btn.classList.toggle("scales-chip-active", prefs.frets === 24);
                var curSize = prefs.sizes[prefs.instrument];
                widthCtl.minus.disabled = curSize.w <= SIZE_MIN + 1e-9;
                widthCtl.plus.disabled = curSize.w >= SIZE_MAX - 1e-9;
                heightCtl.minus.disabled = curSize.h <= SIZE_MIN + 1e-9;
                heightCtl.plus.disabled = curSize.h >= SIZE_MAX - 1e-9;

                // Récapitulatif lisible : nom complet + notes de la gamme, utile en soi.
                var def = SCALE_DEFS.filter(function (d) { return d.key === prefs.type; })[0];
                var notes = def.semis.map(function (st) { return NOTE_NAMES_SHARP[(prefs.root + st) % 12]; });
                summary.innerHTML = "";
                var strong = document.createElement("strong");
                strong.textContent = NOTE_NAMES_SHARP[prefs.root] + " " + def.label;
                summary.appendChild(strong);
                summary.appendChild(document.createTextNode(" · " + notes.join(" ")));

                diagramsWrap.innerHTML = "";
                var scroll = document.createElement("div");
                scroll.className = "fretboard-scroll";
                var svg;
                if (inst.type === "piano") {
                    // Clavier : largeur et hauteur étirent le dessin (les touches s'adaptent sans souci).
                    svg = buildPianoScaleSvg(def, prefs.root, prefs.labelMode);
                    svg.setAttribute("preserveAspectRatio", "none");
                    svg.setAttribute("width", Math.round(parseFloat(svg.getAttribute("width")) * prefs.zoom * curSize.w));
                    svg.setAttribute("height", Math.round(parseFloat(svg.getAttribute("height")) * prefs.zoom * curSize.h));
                } else {
                    // Manche : taille réelle en px ; seuls les espacements suivent la largeur et la hauteur.
                    svg = buildFretboardSvg(inst.tuning, def, prefs.root, prefs.labelMode, prefs.frets, { s: prefs.zoom, w: curSize.w, h: curSize.h });
                }
                scroll.appendChild(svg);
                diagramsWrap.appendChild(scroll);
            }
            update();
        });
    }

    // ---------- accordeur ----------
    // Un accordeur chromatique classique, à la GarageBand : aucune étape à renseigner avant de
    // pouvoir s'en servir, l'écoute démarre toute seule à l'ouverture et la note est reconnue
    // automatiquement. L'entrée audio (micro OU carte son branchée en USB) est celle par défaut du
    // système — le navigateur ne fait pas la différence entre les deux, donc il suffit de deviner
    // laquelle c'est d'après le nom du périphérique pour l'indiquer, sans sélecteur à manipuler.
    function describeAudioSource(label) {
        var l = (label || "").toLowerCase();
        if (/usb|interface|carte|card|scarlett|focusrite|behringer|presonus|apogee|m-audio|steinberg|line\s*in/.test(l)) {
            return "Carte son" + (label ? " (" + label + ")" : "");
        }
        return "Microphone" + (label ? " (" + label + ")" : "");
    }

    function midiNoteName(midi) {
        return NOTE_NAMES_SHARP[((midi % 12) + 12) % 12];
    }

    // Détection plus robuste que l'autocorrélation brute pour un accordeur : différence cumulée
    // normalisée façon YIN (celle des accordeurs logiciels courants). Elle évite la plupart des
    // erreurs d'octave et donne un indice de netteté : en dessous du seuil, on considère qu'il n'y a
    // pas de note tenue (bruit, attaque, fin de note) plutôt que d'afficher une valeur fantaisiste.
    // Plage utile : ~30 Hz (si grave d'une basse 5 cordes) à ~1400 Hz.
    function yinFrequency(buf, sampleRate) {
        // Retire la composante continue (décalage de certains micros/cartes son) avant tout calcul.
        var mean = 0;
        for (var mi = 0; mi < buf.length; mi++) mean += buf[mi];
        mean /= buf.length;
        if (mean) for (var mj = 0; mj < buf.length; mj++) buf[mj] -= mean;
        var rms = 0;
        for (var i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
        rms = Math.sqrt(rms / buf.length);
        if (rms < 0.008) return { freq: -1, rms: rms };
        var maxTau = Math.min(Math.floor(sampleRate / 30), Math.floor(buf.length / 2));
        var minTau = Math.floor(sampleRate / 1400);
        var w = buf.length - maxTau;
        var d = new Float32Array(maxTau + 1);
        for (var tau = 1; tau <= maxTau; tau++) {
            var sum = 0;
            for (var j = 0; j < w; j++) { var diff = buf[j] - buf[j + tau]; sum += diff * diff; }
            d[tau] = sum;
        }
        var running = 0, best = -1;
        d[0] = 1;
        for (var t = 1; t <= maxTau; t++) {
            running += d[t];
            d[t] = running ? d[t] * t / running : 1;
        }
        for (var t2 = minTau; t2 < maxTau; t2++) {
            if (d[t2] < 0.12) {
                while (t2 + 1 < maxTau && d[t2 + 1] < d[t2]) t2++;
                best = t2;
                break;
            }
        }
        if (best === -1) return { freq: -1, rms: rms };
        var x0 = d[best - 1], x1 = d[best], x2 = d[best + 1];
        var denom = x0 + x2 - 2 * x1;
        var refined = denom ? best + (x0 - x2) / (2 * denom) : best;
        return { freq: sampleRate / refined, rms: rms, clarity: 1 - x1 };
    }

    // Cadran façon pédale d'accordeur : arc de -50 à +50 cents, graduations, zone verte de ±5 cents
    // au centre, aiguille unique.
    var TUNER_GAUGE_SPAN_DEG = 60; // ±50 cents -> ±60°
    function buildTunerGaugeSvg() {
        var ns = "http://www.w3.org/2000/svg";
        var cx = 150, cy = 158, r = 128;
        function el(tag, attrs) { var n = document.createElementNS(ns, tag); for (var k in attrs) n.setAttribute(k, attrs[k]); return n; }
        function pt(radius, cents) {
            var a = (cents / 50 * TUNER_GAUGE_SPAN_DEG - 90) * Math.PI / 180;
            return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
        }
        function arcPath(radius, c0, c1) {
            var p0 = pt(radius, c0), p1 = pt(radius, c1);
            return "M" + p0[0].toFixed(2) + " " + p0[1].toFixed(2) + " A" + radius + " " + radius + " 0 0 1 " + p1[0].toFixed(2) + " " + p1[1].toFixed(2);
        }
        var svg = el("svg", { viewBox: "0 0 300 172", "class": "tuner-gauge" });
        svg.appendChild(el("path", { d: arcPath(r, -50, 50), "class": "tuner-arc" }));
        svg.appendChild(el("path", { d: arcPath(r, -5, 5), "class": "tuner-arc-zone" }));
        for (var c = -50; c <= 50; c += 5) {
            var major = c % 25 === 0;
            var a = pt(r - 6, c), b = pt(r - (major ? 22 : 14), c);
            svg.appendChild(el("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], "class": "tuner-tick" + (major ? " tuner-tick-major" : "") }));
        }
        [[-50, "−50"], [-25, "−25"], [0, "0"], [25, "+25"], [50, "+50"]].forEach(function (l) {
            var p = pt(r - 36, l[0]);
            var t = el("text", { x: p[0], y: p[1], "class": "tuner-tick-label" });
            t.textContent = l[1];
            svg.appendChild(t);
        });
        var flat = el("text", { x: 34, y: 150, "class": "tuner-side tuner-side-flat" }); flat.textContent = "♭";
        var sharp = el("text", { x: 266, y: 150, "class": "tuner-side tuner-side-sharp" }); sharp.textContent = "♯";
        svg.appendChild(flat);
        svg.appendChild(sharp);
        var needle = el("g", { "class": "tuner-needle-g" });
        needle.appendChild(el("line", { x1: cx, y1: cy, x2: cx, y2: cy - r + 10, "class": "tuner-needle-line" }));
        svg.appendChild(needle);
        svg.appendChild(el("circle", { cx: cx, cy: cy, r: 7, "class": "tuner-hub" }));
        return { svg: svg, needle: needle, flat: flat, sharp: sharp, cx: cx, cy: cy };
    }

    function openTunerPanel() {
        openModal("tuner-panel", function (panel, close) {
            var title = document.createElement("div");
            title.className = "backups-title";
            title.textContent = "Accordeur";
            panel.appendChild(title);

            var gauge = buildTunerGaugeSvg();
            var gaugeWrap = document.createElement("div");
            gaugeWrap.className = "tuner-gauge-wrap";
            gaugeWrap.appendChild(gauge.svg);
            panel.appendChild(gaugeWrap);

            var display = document.createElement("div");
            display.className = "tuner-display tuner-idle";
            var noteEl = document.createElement("div");
            noteEl.className = "tuner-note";
            var noteName = document.createElement("span");
            noteName.textContent = "—";
            var noteOct = document.createElement("sub");
            noteOct.className = "tuner-octave";
            noteEl.appendChild(noteName);
            noteEl.appendChild(noteOct);
            var freqEl = document.createElement("div");
            freqEl.className = "tuner-freq";
            freqEl.textContent = "Joue une note";
            display.appendChild(noteEl);
            display.appendChild(freqEl);
            panel.appendChild(display);

            var sourceEl = document.createElement("div");
            sourceEl.className = "tuner-source";
            sourceEl.textContent = "Démarrage…";
            panel.appendChild(sourceEl);

            var audioCtx = null, analyser = null, source = null, currentStream = null, rafId = null;

            function stopAudio() {
                if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
                if (currentStream) { currentStream.getTracks().forEach(function (t) { t.stop(); }); currentStream = null; }
                if (source) { source.disconnect(); source = null; }
                if (audioCtx) { audioCtx.close(); audioCtx = null; }
            }

            // Ce qui rend un accordeur "calme" (pédale, GarageBand, GuitarTuna) :
            //  - la mesure n'est faite qu'une vingtaine de fois par seconde, et on garde la médiane
            //    des dernières mesures (une valeur aberrante isolée ne fait plus sauter l'aiguille) ;
            //  - la note affichée ne change qu'après quelques mesures concordantes (hystérésis) ;
            //  - l'aiguille ne saute pas à la valeur mesurée : elle la rejoint avec une inertie, à
            //    60 images/s, indépendamment du rythme des mesures ;
            //  - quand le son s'arrête, la dernière note reste affichée (estompée) et l'aiguille
            //    revient doucement au centre, au lieu de se figer ou de clignoter.
            var DETECT_INTERVAL_MS = 50, NEEDLE_TAU_MS = 110, HOLD_MS = 450, NOTE_CONFIRM = 3;
            var recentMidiFloat = [];
            var shownMidi = null, candidateMidi = null, candidateCount = 0;
            var targetCents = 0, needleCents = 0, lastSignalAt = 0, lastDetectAt = 0, lastFrameAt = 0;
            var lastShownCents = null, lastTextAt = 0, shownFreq = 0;

            function median(arr) {
                var s = arr.slice().sort(function (a, b) { return a - b; });
                return s[Math.floor(s.length / 2)];
            }

            function onDetection(freq, now) {
                var midiFloat = 69 + 12 * Math.log(freq / 440) / Math.LN2;
                // Changement net de note (> 1 demi-ton) : on repart d'une fenêtre vide pour ne pas
                // mélanger deux notes dans la médiane.
                if (recentMidiFloat.length && Math.abs(midiFloat - recentMidiFloat[recentMidiFloat.length - 1]) > 1) recentMidiFloat = [];
                recentMidiFloat.push(midiFloat);
                if (recentMidiFloat.length > 5) recentMidiFloat.shift();
                var m = median(recentMidiFloat);
                var nearest = Math.round(m);
                if (shownMidi === null || nearest === shownMidi) {
                    candidateMidi = null; candidateCount = 0;
                    if (shownMidi === null) shownMidi = nearest;
                } else if (nearest === candidateMidi) {
                    if (++candidateCount >= NOTE_CONFIRM) { shownMidi = nearest; candidateMidi = null; candidateCount = 0; }
                } else {
                    candidateMidi = nearest; candidateCount = 1;
                }
                targetCents = Math.max(-50, Math.min(50, (m - shownMidi) * 100));
                shownFreq = 440 * Math.pow(2, (m - 69) / 12);
                lastSignalAt = now;
            }

            function render(now) {
                var dt = lastFrameAt ? Math.min(100, now - lastFrameAt) : 16;
                lastFrameAt = now;
                var active = now - lastSignalAt < HOLD_MS && shownMidi !== null;
                var goal = active ? targetCents : 0;
                needleCents += (goal - needleCents) * (1 - Math.exp(-dt / NEEDLE_TAU_MS));
                gauge.needle.setAttribute("transform", "rotate(" + (needleCents / 50 * TUNER_GAUGE_SPAN_DEG).toFixed(2) + " " + gauge.cx + " " + gauge.cy + ")");

                var inTune = active && Math.abs(targetCents) <= 5 && Math.abs(needleCents) <= 6;
                display.classList.toggle("tuner-idle", !active);
                display.classList.toggle("tuner-in-tune", inTune);
                gaugeWrap.classList.toggle("tuner-in-tune", inTune);
                gaugeWrap.classList.toggle("tuner-idle", !active);
                gauge.flat.classList.toggle("tuner-side-on", active && targetCents < -5);
                gauge.sharp.classList.toggle("tuner-side-on", active && targetCents > 5);

                if (shownMidi !== null) {
                    noteName.textContent = midiNoteName(shownMidi);
                    noteOct.textContent = Math.floor(shownMidi / 12) - 1;
                }
                // Texte des cents mis à jour au plus ~6 fois/s : lisible au lieu de défiler.
                if (active && now - lastTextAt > 160) {
                    var c = Math.round(targetCents);
                    if (c !== lastShownCents) {
                        lastShownCents = c;
                        freqEl.textContent = (c > 0 ? "+" : c < 0 ? "−" : "±") + Math.abs(c) + " cents · " + shownFreq.toFixed(1) + " Hz";
                    }
                    lastTextAt = now;
                }
            }

            function connectStream(stream) {
                if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 4096; // fenêtre assez longue pour les notes graves de basse
                source = audioCtx.createMediaStreamSource(stream);
                source.connect(analyser);
                currentStream = stream;
                var buf = new Float32Array(analyser.fftSize);
                function loop(now) {
                    now = now || performance.now();
                    if (now - lastDetectAt >= DETECT_INTERVAL_MS) {
                        lastDetectAt = now;
                        analyser.getFloatTimeDomainData(buf);
                        var res = yinFrequency(buf, audioCtx.sampleRate);
                        if (res.freq > 28 && res.freq < 1500) onDetection(res.freq, now);
                    }
                    render(now);
                    rafId = requestAnimationFrame(loop);
                }
                rafId = requestAnimationFrame(loop);
            }

            // Démarrage automatique dès l'ouverture, sans rien à choisir d'abord (comme GarageBand) :
            // le navigateur utilise l'entrée par défaut du système (micro ou carte son déjà
            // sélectionnée dans l'OS), on se contente d'indiquer laquelle d'après son nom.
            navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then(function (stream) {
                var track = stream.getAudioTracks()[0];
                sourceEl.textContent = "Source : " + describeAudioSource(track && track.label);
                connectStream(stream);
            }).catch(function (err) {
                sourceEl.textContent = "Accès au micro/à la carte son refusé ou indisponible (" + err.name + ").";
            });

            return function () {
                stopAudio();
            };
        });
    }

    // ---------- paramètres généraux ----------
    function openSettingsPanel() {
        openModal("settings-panel", function (panel) {
            var a = state.settings.appearance;

            var title = document.createElement("div");
            title.className = "backups-title";
            title.textContent = "Paramètres";
            panel.appendChild(title);

            // Réglages rangés par onglets (un onglet = un thème) : ajouter un réglage = le mettre dans le bon
            // onglet, sans allonger une liste unique. Le dernier onglet ouvert est retenu.
            var pages = {}, cur = null;
            var tabBar = document.createElement("div");
            tabBar.className = "settings-tabs";
            panel.appendChild(tabBar);
            function section(labelText) {
                cur = document.createElement("div");
                cur.className = "settings-page";
                cur.hidden = true;
                panel.appendChild(cur);
                pages[labelText] = cur;
            }

            function selectField(labelText, options, value, onChange) {
                var field = document.createElement("label");
                field.className = "settings-field";
                var span = document.createElement("span");
                span.className = "settings-field-label";
                span.textContent = labelText;
                field.appendChild(span);
                var select = document.createElement("select");
                options.forEach(function (opt) {
                    var o = document.createElement("option");
                    o.value = opt[0];
                    o.textContent = opt[1];
                    if (String(opt[0]) === String(value)) o.selected = true;
                    select.appendChild(o);
                });
                select.addEventListener("change", function () { onChange(select.value); });
                field.appendChild(select);
                return field;
            }

            section("Métronome");
            cur.appendChild(selectField("Position", [
                ["center", "Centre"], ["top", "Haut"], ["bottom", "Bas"], ["corner", "Coin (bas à droite)"]
            ], a.metronomePosition, function (v) { a.metronomePosition = v; save(); }));
            cur.appendChild(selectField("Taille", [
                ["small", "Petite"], ["medium", "Moyenne"], ["large", "Grande"]
            ], a.metronomeSize, function (v) { a.metronomeSize = v; save(); }));

            section("Vidéos");
            var volOptions = [["auto", "Automatique (volume de YouTube)"]];
            for (var vv = 10; vv <= 100; vv += 10) volOptions.push([String(vv), vv + " %"]);
            var curStartVol = getYtStartVolume();
            cur.appendChild(selectField("Barres de réglage (temps, volume, vitesse)", [["1", "Affichées"], ["0", "Masquées"]], ytBarsEnabled() ? "1" : "0", function (v) {
                setYtBarsEnabled(v === "1");
                document.dispatchEvent(new Event("trainhub-yt-bars")); // les vidéos déjà affichées se mettent à jour
            }));
            cur.appendChild(selectField("Volume de départ", volOptions, curStartVol === null ? "auto" : String(Math.round(curStartVol / 10) * 10), function (v) {
                setYtStartVolume(v === "auto" ? null : parseInt(v, 10));
            }));

            section("Affichage");
            cur.appendChild(selectField("Couleurs des chapitres", Object.keys(COLOR_SCHEMES).map(function (key) {
                return [key, COLOR_SCHEMES[key].label];
            }), a.colorScheme, function (v) { applyColorScheme(v); }));
            cur.appendChild(selectField("Taille du texte des dossiers", [
                ["0.85", "Petite"], ["1", "Normale"], ["1.15", "Grande"], ["1.3", "Très grande"]
            ], a.treeFontScale, function (v) {
                a.treeFontScale = parseFloat(v);
                save();
                render();
            }));
            cur.appendChild(selectField("Densité de l'interface", [
                ["compact", "Compacte"], ["comfortable", "Confortable"], ["spacious", "Spacieuse"]
            ], a.density, function (v) { a.density = v; save(); render(); }));
            cur.appendChild(selectField("Disposition de l'écran principal", [
                ["vertical", "Verticale"], ["horizontal", "Horizontale (façon Finder)"]
            ], a.mainLayout, function (v) { a.mainLayout = v; save(); render(); }));

            section("Images");
            var imgSizes = [["small", "Petite"], ["medium", "Moyenne"], ["large", "Grande"]];
            cur.appendChild(selectField("Taille des images dans les exercices", imgSizes, getImgSize("ex"), function (v) { setImgSize("ex", v); render(); }));
            cur.appendChild(selectField("Taille des images dans les sessions", imgSizes, getImgSize("gs"), function (v) { setImgSize("gs", v); render(); }));

            section("Données");
            var dataNote = document.createElement("div");
            dataNote.className = "gs-empty";
            dataNote.textContent = "Réinjecte des images exportées (fichiers « Espace - Titre - n »). Elles retrouvent leur exercice ; celles dont l'exercice a changé de nom te sont proposées une à une.";
            cur.appendChild(dataNote);
            var reFile = document.createElement("input");
            reFile.type = "file"; reFile.accept = "image/*"; reFile.multiple = true; reFile.hidden = true;
            reFile.addEventListener("change", function () {
                var files = Array.prototype.slice.call(reFile.files || []);
                reFile.value = "";
                if (files.length) { if (closeActiveModal) closeActiveModal(); reimportImages(files); }
            });
            var reBtn = document.createElement("button");
            reBtn.type = "button";
            reBtn.className = "settings-data-btn";
            reBtn.textContent = "Réimporter des images…";
            reBtn.addEventListener("click", function () { reFile.click(); });
            cur.appendChild(reBtn);
            cur.appendChild(reFile);

            var TAB_ORDER = ["Affichage", "Métronome", "Vidéos", "Images", "Données"];
            function showTab(name) {
                settingsTab = name;
                TAB_ORDER.forEach(function (n) { pages[n].hidden = n !== name; });
                Array.prototype.forEach.call(tabBar.children, function (btn) { btn.classList.toggle("settings-tab-active", btn.dataset.tab === name); });
            }
            TAB_ORDER.forEach(function (n) {
                var tb = document.createElement("button");
                tb.type = "button";
                tb.className = "settings-tab";
                tb.dataset.tab = n;
                tb.textContent = n;
                tb.addEventListener("click", function () { showTab(n); });
                tabBar.appendChild(tb);
            });
            showTab(pages[settingsTab] ? settingsTab : TAB_ORDER[0]);
        });
    }
    var settingsTab = "Affichage";

    // ---------- session guidée ----------
    // Un enchaînement d'exercices choisis à l'avance, chacun avec un temps alloué : au lancement,
    // un chrono défile pour savoir quand changer d'exercice, mais reste librement ajustable
    // (Précédent/Suivant à tout moment, +1/-1 min sur l'exercice en cours) plutôt que de forcer un
    // minutage rigide. Affichée dans la zone principale (pas une fenêtre flottante) : on garde les
    // outils flottants (métronome, cercle des quintes) utilisables en même temps.
    var guidedSessionViewActive = false;
    var gsScreen = "list"; // "list" | "edit" | "pick" | "run" | "links"
    var gsEditingSession = null;
    var gsPickCallback = null;
    var gsRunSession = null, gsRunStepIndex = 0;
    var gsRunAllocatedSec = 0, gsRunElapsedMs = 0, gsRunStartTs = null, gsRunPaused = true, gsRunInterval = null;
    // Chrono de la session entière : cumule tous les exercices, s'arrête en pause et repart à la reprise.
    var gsTotalMs = 0, gsTotalStartTs = null;
    // Enchaînement automatique : à la fin du temps d'un exercice, on passe au suivant ; un petit carillon
    // doux prévient 10 s avant. Réglage propre à l'appareil.
    var GS_AUTO_KEY = "trainhub.gsAuto.v1";
    var GS_WARN_SECONDS = 10;
    var gsWarnKey = null; // "<pas>:warn" / "<pas>:end" : évite de rejouer le même carillon
    function gsAutoAdvanceOn() { try { return localStorage.getItem(GS_AUTO_KEY) === "1"; } catch (e) { return false; } }
    function setGsAutoAdvance(on) { try { localStorage.setItem(GS_AUTO_KEY, on ? "1" : "0"); } catch (e) {} }
    // Carillon : notes sinusoïdales à attaque lente et longue résonance, volume modeste (pas stressant).
    function playSoftChime(kind) {
        try {
            var ctx = ensureMetroAudio();
            var out = ctx.createGain();
            out.gain.value = 0.5;
            out.connect(ctx.destination);
            var notes = kind === "warn" ? [[659.25, 0], [523.25, 0.45]] : kind === "go" ? [[523.25, 0], [783.99, 0.25]] : [[523.25, 0], [392, 0.4]];
            var t0 = ctx.currentTime + 0.05;
            notes.forEach(function (n) {
                [[1, 0.16], [2, 0.04]].forEach(function (h) {
                    var osc = ctx.createOscillator(), g = ctx.createGain();
                    osc.type = "sine";
                    osc.frequency.value = n[0] * h[0];
                    var t = t0 + n[1];
                    g.gain.setValueAtTime(0.0001, t);
                    g.gain.linearRampToValueAtTime(h[1], t + 0.05);
                    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
                    osc.connect(g); g.connect(out);
                    osc.start(t); osc.stop(t + 1.7);
                });
            });
        } catch (e) {}
    }

    var gsRefreshRunUi = null; // remet à jour bouton Pause/Reprendre + chrono de l'écran de guidage affiché (raccourci Espace)
    var gsLinksChecked = {}; // clé "link:<id>"/"file:<id>" -> coché ou non, le temps de l'écran
    // L'écran des liens/PJ s'ouvre aussi AVANT de lancer la session (depuis la liste ou l'édition) :
    // on ouvre tout d'un coup, puis on démarre, sans perdre de temps pendant l'entraînement.
    var gsLinksSession = null;   // session dont on affiche les liens/PJ
    var gsLinksBack = "list";    // écran où revenir : "list" | "edit" | "run"
    var gsFileBlobCache = {};    // id de pièce jointe -> Blob déjà lu (false = absent de cet appareil)

    // Durée proposée pour un exercice ajouté à une session : la dernière durée réglée pour lui (ex.lastMinutes),
    // sinon celle d'un pas existant (n'importe quelle session), sinon celle d'un exercice du même nom, sinon 5.
    function gsDefaultMinutes(ex) {
        if (ex.lastMinutes > 0) return ex.lastMinutes;
        var found = 0;
        state.settings.guidedSessions.forEach(function (gs) {
            gs.steps.forEach(function (st) { if (st.exerciseId === ex.id && st.minutes > 0) found = st.minutes; });
        });
        if (found) return found;
        var title = (ex.title || "").replace(/ \(copie\)$/, "").trim().toLowerCase();
        state.settings.guidedSessions.forEach(function (gs) {
            gs.steps.forEach(function (st) {
                var o = findExerciseById(st.exerciseId);
                if (o && o.ex !== ex && st.minutes > 0 && (o.ex.title || "").replace(/ \(copie\)$/, "").trim().toLowerCase() === title) found = st.minutes;
            });
        });
        return found || 5;
    }
    var gsSyncTimers = {};
    function gsRememberMinutes(step) {
        var f = findExerciseById(step.exerciseId);
        if (f && f.ex.lastMinutes !== step.minutes) f.ex.lastMinutes = step.minutes;
    }
    // Autres pas (d'autres sessions) portant le même exercice.
    function gsOtherStepsOf(step) {
        var mine = null, rows = [];
        state.settings.guidedSessions.forEach(function (gs) { if (gs.steps.indexOf(step) !== -1) mine = gs; });
        state.settings.guidedSessions.forEach(function (gs) {
            if (gs === mine) return;
            gs.steps.forEach(function (st) { if (st.exerciseId === step.exerciseId) rows.push({ gs: gs, st: st }); });
        });
        return { mine: mine, rows: rows };
    }
    var GS_APPLY_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/><path d="M12 14h4M14 12v4"/></svg>';
    // Même exercice dans d'autres sessions avec une autre durée : liste à cocher (durée actuelle de chacune).
    function gsOfferSyncMinutes(step) {
        var other = gsOtherStepsOf(step), mine = other.mine, rows = other.rows;
        if (!mine || !rows.length) return;
        var found = findExerciseById(step.exerciseId);
        var newMin = step.minutes;
        openModal("gs-sync-panel", function (panel, close) {
            var title = document.createElement("div");
            title.className = "backups-title";
            title.textContent = "Durée de « " + (found ? found.ex.title : "l'exercice") + " »";
            panel.appendChild(title);
            var intro = document.createElement("div");
            intro.className = "gs-sync-intro";
            intro.textContent = newMin + " min dans « " + mine.name + " ». Appliquer à quelles autres sessions ?";
            panel.appendChild(intro);
            var list = document.createElement("div");
            list.className = "gs-sync-list";
            var boxes = [];
            rows.forEach(function (r) {
                var line = document.createElement("label");
                line.className = "gs-sync-row";
                var cb = document.createElement("input");
                cb.type = "checkbox";
                var same = r.st.minutes === newMin;
                cb.checked = !same;
                cb.disabled = same;
                boxes.push(cb);
                var nm = document.createElement("span");
                nm.className = "gs-sync-name";
                nm.textContent = r.gs.name;
                var du = document.createElement("span");
                du.className = "gs-sync-dur";
                du.textContent = same ? "déjà " + newMin + " min" : r.st.minutes + " min → " + newMin + " min";
                line.appendChild(cb); line.appendChild(nm); line.appendChild(du);
                list.appendChild(line);
            });
            panel.appendChild(list);
            var actions = document.createElement("div");
            actions.className = "gs-sync-actions";
            var no = document.createElement("button");
            no.type = "button"; no.className = "btn-ghost"; no.textContent = "Seulement ici";
            no.addEventListener("click", close);
            var yes = document.createElement("button");
            yes.type = "button"; yes.className = "btn-accent"; yes.textContent = "Appliquer aux sessions cochées";
            yes.addEventListener("click", function () {
                var n = 0;
                rows.forEach(function (r, i) { if (boxes[i].checked && !boxes[i].disabled) { r.st.minutes = newMin; n++; } });
                if (n) { save(); showToast("Durée mise à jour dans " + n + " session" + (n > 1 ? "s" : "")); }
                close();
                render();
            });
            actions.appendChild(no); actions.appendChild(yes);
            panel.appendChild(actions);
        });
    }

    function sessionTotalMinutes(session) {
        return session.steps.reduce(function (sum, s) { return sum + s.minutes; }, 0);
    }

    // Liens et pièces jointes d'un exercice, sous la forme utilisée par l'écran "Liens et pièces jointes".
    function gsExerciseItems(ex) {
        var items = [];
        (ex.links || []).forEach(function (link) { items.push({ type: "link", key: "link:" + link.id, label: link.label, url: link.url }); });
        (ex.files || []).forEach(function (meta) { items.push({ type: "file", key: "file:" + meta.id, label: meta.name, meta: meta }); });
        return items;
    }
    // Durée réglable au glisser, comme le cadran du métronome : cliquer sur le champ et monter/descendre
    // la souris (ou le doigt) change la valeur de 1 en 1. Les chevrons natifs et la saisie au clavier
    // restent possibles : le glisser ne démarre pas sur la zone des chevrons (bord droit) et un simple
    // clic (sous le seuil) garde son effet habituel (placer le curseur de saisie).
    // Sensibilité : une minute par 9 px — des durées de 3 à 30 min se règlent en ~250 px d'amplitude
    // sans que 1 px de tremblement ne change la valeur ; seuil de 4 px avant de considérer un glisser.
    // Champ numérique : boutons − et + de part et d'autre du nombre (à la place des chevrons natifs, peu pratiques),
    // largeur adaptée au nombre de chiffres (1–2 chiffres identiques, 3 chiffres un peu plus large).
    function attachNumberStepper(input, min, max, opts) {
        if (input._stepper) return;
        input._stepper = true;
        var emptyStart = opts && typeof opts.emptyStart === "number" ? opts.emptyStart : min;
        function wrap(retry) {
            var parent = input.parentNode;
            if (!parent) { if (retry) setTimeout(function () { wrap(false); }, 0); return; }
            var box = document.createElement("span");
            box.className = "num-stepper";
            function mk(sign, delta, label) {
                var b = document.createElement("button");
                b.type = "button";
                b.className = "num-stepper-btn";
                b.textContent = sign;
                b.tabIndex = -1;
                b.setAttribute("aria-label", label);
                var timer = null, rep = null;
                function bump() {
                    var cur = parseInt(input.value, 10);
                    if (isNaN(cur)) cur = emptyStart - (delta > 0 ? 0 : 0);
                    var v = Math.min(max, Math.max(min, (isNaN(parseInt(input.value, 10)) ? emptyStart : cur + delta)));
                    if (String(v) !== input.value) { input.value = String(v); input.dispatchEvent(new Event("change", { bubbles: true })); sizeIt(); }
                }
                function stop() { clearTimeout(timer); clearInterval(rep); timer = rep = null; }
                b.addEventListener("pointerdown", function (e) {
                    if (e.button !== undefined && e.button !== 0) return;
                    e.preventDefault(); e.stopPropagation();
                    bump();
                    timer = setTimeout(function () { rep = setInterval(bump, 70); }, 420);
                });
                b.addEventListener("pointerup", stop);
                b.addEventListener("pointerleave", stop);
                b.addEventListener("pointercancel", stop);
                b.addEventListener("click", function (e) { e.stopPropagation(); e.preventDefault(); });
                return b;
            }
            function sizeIt() { box.classList.toggle("num-wide", String(input.value || "").length >= 3); }
            parent.insertBefore(box, input);
            box.appendChild(mk("‹", -1, "Diminuer"));
            box.appendChild(input);
            box.appendChild(mk("›", 1, "Augmenter"));
            input.classList.add("num-in");
            input.addEventListener("input", sizeIt);
            input.addEventListener("change", sizeIt);
            sizeIt();
        }
        Promise.resolve().then(function () { wrap(true); });
    }

    var SCRUB_PX_PER_STEP = 9, SCRUB_START_PX = 4, SCRUB_SPINNER_PX = 24;
    // opts (facultatif) : pxPerStep = sensibilité du glisser ; wheel = la molette règle aussi la valeur
    // au survol ; emptyStart = valeur de départ quand le champ est vide.
    function bindScrubInput(input, min, max, opts) {
        opts = opts || {};
        attachNumberStepper(input, min, max, opts);
        var pxPerStep = opts.pxPerStep || SCRUB_PX_PER_STEP;
        var emptyStart = typeof opts.emptyStart === "number" ? opts.emptyStart : min;
        var startY = 0, startVal = 0, active = false, scrubbing = false, changed = false;
        function clamp(v) { return Math.min(max, Math.max(min, v)); }
        input.addEventListener("pointerdown", function (e) {
            if (e.button !== undefined && e.button !== 0) return;
            var rect = input.getBoundingClientRect();
            if (!input._stepper && e.clientX > rect.right - SCRUB_SPINNER_PX) return; // zone des chevrons natifs
            active = true; scrubbing = false; changed = false;
            startY = e.clientY;
            startVal = parseInt(input.value, 10) || emptyStart;
        });
        window.addEventListener("pointermove", function (e) {
            if (!active) return;
            var dy = startY - e.clientY; // vers le haut = plus
            if (!scrubbing) {
                if (Math.abs(dy) < SCRUB_START_PX) return;
                scrubbing = true;
                input.blur(); // pas de curseur de saisie pendant le glisser
                if (window.getSelection) window.getSelection().removeAllRanges();
                document.documentElement.classList.add("scrubbing");
            }
            e.preventDefault();
            var v = clamp(startVal + Math.round(dy / pxPerStep));
            if (String(v) !== input.value) { input.value = String(v); changed = true; }
        });
        function end() {
            if (!active) return;
            active = false;
            if (scrubbing) {
                scrubbing = false;
                document.documentElement.classList.remove("scrubbing");
                if (changed) input.dispatchEvent(new Event("change", { bubbles: true })); // même chemin que la saisie : enregistre
            }
        }
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
        if (opts.wheel) {
            input.addEventListener("wheel", function (e) {
                e.preventDefault();
                var v = clamp((parseInt(input.value, 10) || emptyStart) + (e.deltaY < 0 ? 1 : -1));
                if (String(v) !== input.value) {
                    input.value = String(v);
                    input.dispatchEvent(new Event("change", { bubbles: true }));
                }
            }, { passive: false });
        }
        input.title = (input.title ? input.title + " — " : "") + "Glisser vers le haut/bas pour changer" + (opts.wheel ? ", molette" : "") + ", ou chevrons / saisie";
    }

    function gsStepHides(step, key) { return (step.hidden || []).indexOf(key) !== -1; }
    function gsSetStepHidden(step, key, hide) {
        var list = (step.hidden || []).filter(function (k) { return k !== key; });
        if (hide) list.push(key);
        step.hidden = list;
    }
    function gsShortUrl(url) {
        var s = String(url || "").replace(/^https?:\/\/(www\.)?/i, "");
        return s.length > 40 ? s.slice(0, 39) + "…" : s;
    }
    var gsExDetailsOpen = null; // null = auto (déplié si l'exercice a une note), sinon choix de l'utilisateur
    var gsOpenStepEdit = {};    // id de pas -> édition de l'exercice dépliée dans l'écran d'édition
    var gsOpenStepDetails = {}; // id de pas -> bloc "notes et liens" déplié dans l'écran d'édition
    function gsSessionHasItems(session) {
        return session.steps.some(function (step) {
            var found = findExerciseById(step.exerciseId);
            return !!found && gsExerciseItems(found.ex).length > 0;
        });
    }
    function gsOpenLinks(session, back) {
        gsLinksSession = session;
        gsLinksBack = back;
        gsScreen = "links";
        render();
    }

    // ---------- export PDF d'une session guidée ----------
    // Vectoriel (texte jsPDF direct, pas de html2canvas) : le contenu n'est que du texte, un PDF
    // rastérisé serait plus lourd et moins net pour rien. "Enregistrer sous PDF" plutôt
    // qu'"Imprimer" : un fichier généré et téléchargé directement (pdf.save), sans dépendre d'un
    // pilote d'impression système qui se comporte différemment selon l'appareil.
    function exportSessionPdf(session) {
        var jsPDFcls = window.jspdf && window.jspdf.jsPDF;
        if (!jsPDFcls) { window.alert("Export PDF indisponible."); return; }
        var pdf = new jsPDFcls({ unit: "mm", format: "a4", orientation: "portrait" });
        var marginLeft = 18, marginRight = 18, y = 20;
        var pageWidth = pdf.internal.pageSize.getWidth();
        var pageHeight = pdf.internal.pageSize.getHeight();
        var maxWidth = pageWidth - marginLeft - marginRight;

        function ensureSpace(needed) {
            if (y + needed > pageHeight - 16) { pdf.addPage(); y = 20; }
        }
        function writeLines(text, fontSize, style, lineGap) {
            pdf.setFont("helvetica", style || "normal");
            pdf.setFontSize(fontSize);
            var lines = pdf.splitTextToSize(text, maxWidth);
            lines.forEach(function (line) {
                ensureSpace(lineGap || 6);
                pdf.text(line, marginLeft, y);
                y += lineGap || 6;
            });
        }

        pdf.setTextColor(20, 20, 20);
        writeLines(session.name || "Session guidée", 18, "bold", 8);
        writeLines("Durée totale : " + sessionTotalMinutes(session) + " min · " + session.steps.length + " exercice(s)", 10, "normal", 7);
        y += 2;

        session.steps.forEach(function (step, i) {
            var found = findExerciseById(step.exerciseId);
            ensureSpace(12);
            pdf.setDrawColor(210, 210, 210);
            pdf.line(marginLeft, y, pageWidth - marginRight, y);
            y += 6;
            var title = found ? found.ex.title : "(exercice supprimé)";
            writeLines((i + 1) + ". " + title + " — " + step.minutes + " min", 13, "bold", 7);
            if (step.note && step.note.trim()) writeLines("Note : " + step.note.trim(), 10, "bold", 5.5);
            if (found) {
                writeLines(found.pathNames.join(" › "), 9, "italic", 5.5);
                if (found.ex.notes && found.ex.notes.trim()) writeLines(found.ex.notes.trim(), 10, "normal", 5.5);
                (found.ex.links || []).forEach(function (link) {
                    writeLines("Lien : " + link.label + " — " + link.url, 9, "normal", 5.5);
                });
                (found.ex.files || []).forEach(function (f) {
                    writeLines("Pièce jointe : " + f.name, 9, "normal", 5.5);
                });
            }
            y += 3;
        });

        var fileName = "session-" + (session.name || "guidee").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + ".pdf";
        pdf.save(fileName);
    }

    function gsThemeBadge(pathNames, color) {
        var badge = document.createElement("span");
        badge.className = "gs-theme-badge";
        badge.textContent = pathNames[0];
        badge.title = pathNames.join(" › ");
        badge.style.color = color;
        badge.style.background = "color-mix(in srgb, " + color + " 16%, transparent)";
        return badge;
    }

    // Puces de liens/fichiers en lecture seule (pas de renommer/retirer) : juste de quoi cliquer
    // et ouvrir, depuis l'écran de guidage.
    function appendReadOnlyResourceChips(container, ex, include) {
        (ex.links || []).forEach(function (link) {
            if (include && !include("link", link)) return;
            var chip = document.createElement("a");
            chip.className = "link-chip gs-resource-chip";
            chip.href = link.url;
            chip.target = "_blank";
            chip.rel = "noopener noreferrer";
            var iconSpan = document.createElement("span");
            iconSpan.className = "link-icon";
            iconSpan.innerHTML = linkIconSvg(link.label, link.url);
            chip.appendChild(iconSpan);
            var labelSpan = document.createElement("span");
            labelSpan.className = "link-label";
            labelSpan.textContent = link.label;
            chip.appendChild(labelSpan);
            container.appendChild(chip);
        });
        (ex.files || []).forEach(function (meta) {
            if (include && !include("file", meta)) return;
            var chip = document.createElement("button");
            chip.type = "button";
            chip.className = "file-chip gs-resource-chip";
            chip.title = "Fichier stocké seulement sur cet appareil (non synchronisé)";
            var iconSpan = document.createElement("span");
            iconSpan.className = "link-icon";
            iconSpan.innerHTML = fileKindIcon((meta.type || "") + " " + (meta.name || ""));
            chip.appendChild(iconSpan);
            var label = document.createElement("span");
            label.className = "file-open";
            label.textContent = meta.name;
            chip.appendChild(label);
            chip.addEventListener("click", function () {
                if (isAudioFile(meta)) { toggleAudioPlayer(container, meta); return; }
                getFileBlob(meta.id).then(function (blob) {
                    if (!blob) { window.alert("Ce fichier n'est disponible que sur l'appareil où il a été ajouté (« " + meta.name + " »)."); return; }
                    var url = URL.createObjectURL(playableBlob(blob, meta));
                    window.open(url, "_blank");
                    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
                });
            });
            container.appendChild(chip);
        });
    }

    // ---------- ouverture de plusieurs liens/fichiers d'un coup ----------
    // Objectif : un ONGLET par lien, jamais une fenêtre à part.
    //  a. TrainHub ouvert dans un navigateur : window.open(adresse) — un nouvel onglet du même
    //     navigateur. Chaque appel est fait de façon synchrone dans le clic de l'utilisateur (sinon le
    //     navigateur le bloque comme un pop-up). Si l'un est bloqué (le navigateur n'autorise qu'un
    //     pop-up par défaut), window.open renvoie null : on le signale au lieu d'échouer en silence.
    //  b. TrainHub installé (dock, appli) : on ouvre avec « noopener » — sans lien avec la fenêtre de
    //     l'appli, l'adresse part dans le navigateur du système, en onglet, plutôt que dans une
    //     fenêtre d'appli supplémentaire. Le choix du navigateur (le navigateur par défaut) appartient
    //     au système : une appli web ne peut pas en désigner un.
    // L'ancienne méthode (ouvrir d'abord une fenêtre vide « about:blank » puis y charger l'adresse)
    // créait justement ces fenêtres d'appli séparées.
    function isStandaloneApp() {
        return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
    }
    // Ouverture ESPACÉE : le premier onglet tout de suite (dans le clic), puis un de plus toutes les
    // OPEN_TABS_DELAY_MS, dans l'ordre de la liste. Ouverts d'un seul bloc, les onglets pouvaient
    // s'afficher dans un ordre aléatoire (celui où les pages répondent) ; tout n'a pas besoin d'être
    // ouvert instantanément. Le délai reste court : l'autorisation d'ouvrir des onglets donnée par le
    // clic dure quelques secondes.
    var OPEN_TABS_DELAY_MS = 250;
    function openUrlsInTabs(urls) {
        var standalone = isStandaloneApp();
        var blocked = 0, i = 0;
        function openOne(url) {
            if (standalone) {
                try { window.open(url, "_blank", "noopener,noreferrer"); } catch (e) { blocked++; }
                return;
            }
            var w = null;
            try { w = window.open(url, "_blank"); } catch (e) {}
            if (!w) { blocked++; return; }
            try { w.opener = null; } catch (e) {}
        }
        function finish() {
            if (blocked) {
                showToast(blocked + " lien" + (blocked > 1 ? "s" : "") + " bloqué" + (blocked > 1 ? "s" : "") + " par le navigateur : autorisez les pop-ups pour TrainHub (icône dans la barre d'adresse) puis recommencez.", 8000);
            }
        }
        function next() {
            openOne(urls[i++]);
            if (i < urls.length) setTimeout(next, OPEN_TABS_DELAY_MS); else finish();
        }
        if (urls.length) next();
    }

    // Les éléments sont ouverts dans l'ordre où ils s'affichent (exercice par exercice).
    function gsOpenItems(items) {
        var urls = [], unavailable = [], pending = [];
        items.forEach(function (item) {
            if (item.type === "link") { urls.push(item.url); return; }
            var blob = gsFileBlobCache[item.meta.id];
            if (blob === false) { unavailable.push(item.label); return; }
            if (!blob) { pending.push(item.label); return; } // lecture pas encore terminée
            // Fichier déjà lu à l'affichage de l'écran : ouverture immédiate, comme un lien.
            var url = URL.createObjectURL(playableBlob(blob, item.meta));
            urls.push(url);
            setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        });
        openUrlsInTabs(urls);
        if (pending.length) showToast("Fichier en cours de lecture, réessayez dans un instant : " + pending.join(", "));
        if (unavailable.length) {
            window.alert("Ces fichiers ne sont disponibles que sur l'appareil où ils ont été ajoutés :\n" + unavailable.join("\n"));
        }
    }

    function renderGuidedSessionMain() {
        $contentHeading.innerHTML = "";
        var h2 = document.createElement("h2");
        h2.textContent = "Session guidée";
        $contentHeading.appendChild(h2);

        $folderContainer.innerHTML = "";
        var content = document.createElement("div");
        content.className = "gs-main";
        $folderContainer.appendChild(content);

        gsRefreshRunUi = null;
        // Changement d'espace pendant qu'on édite une session d'un autre espace : retour à la liste.
        var gsOpen = gsScreen === "edit" || gsScreen === "pick" ? gsEditingSession : gsScreen === "links" ? gsLinksSession : null;
        if (gsOpen && gsOpen.instrumentId !== state.activeInstrumentId) { gsEditingSession = null; gsScreen = "list"; }
        if (gsScreen !== "links") gsFileBlobCache = {};
        // Préparation des sessions (liste, édition, choix, liens) : colonne plus large pour des titres lisibles.
        if (gsScreen !== "run") content.classList.add("gs-main-roomy");
        if (gsScreen === "run" && gsRunSession) renderGsRunScreen(content);
        else if (gsScreen === "links" && gsLinksSession) renderGsLinksScreen(content);
        else if (gsScreen === "pick" && gsEditingSession) renderGsPickScreen(content);
        else if (gsScreen === "edit" && gsEditingSession) renderGsEditScreen(content);
        else renderGsListScreen(content);
    }

    // ---- écran liste : onglets (Tout + onglets libres), filtre de durée ----
    var GS_TAB_KEY = "trainhub.gsTab.v1";
    var GS_SORTS = [["manual", "Ordre manuel"], ["dur-asc", "Durée : courtes d'abord"], ["dur-desc", "Durée : longues d'abord"], ["created-desc", "Ajout : récentes d'abord"], ["created-asc", "Ajout : anciennes d'abord"], ["updated", "Modifiées récemment"], ["used-desc", "Les plus utilisées"], ["used-asc", "Les moins utilisées"], ["az", "A → Z"], ["za", "Z → A"]];
    var gsActiveTab = "all", gsDurMin = null, gsDurMax = null, gsSort = "manual";
    try {
        var gsSaved = JSON.parse(localStorage.getItem(GS_TAB_KEY)) || {};
        if (gsSaved.tab) gsActiveTab = gsSaved.tab;
        if (typeof gsSaved.min === "number") gsDurMin = gsSaved.min;
        if (typeof gsSaved.max === "number") gsDurMax = gsSaved.max;
        if (GS_SORTS.some(function (x) { return x[0] === gsSaved.sort; })) gsSort = gsSaved.sort;
    } catch (e) {}
    function gsSaveView() { try { localStorage.setItem(GS_TAB_KEY, JSON.stringify({ tab: gsActiveTab, min: gsDurMin, max: gsDurMax, sort: gsSort })); } catch (e) {} }
    function gsDurationMatches(session) {
        var m = sessionTotalMinutes(session);
        return (gsDurMin === null || m >= gsDurMin) && (gsDurMax === null || m <= gsDurMax);
    }
    function gsDurLabel() {
        if (gsDurMin === null && gsDurMax === null) return "Durée : toutes";
        if (gsDurMin !== null && gsDurMax !== null) return "Durée : " + gsDurMin + " – " + gsDurMax + " min";
        return gsDurMin !== null ? "Durée : ≥ " + gsDurMin + " min" : "Durée : ≤ " + gsDurMax + " min";
    }
    // Dates et usage des sessions : date d'ajout (déduite de l'identifiant pour les anciennes), date de
    // modification (détectée par comparaison du contenu à l'affichage de la liste), nombre de lancements.
    function gsCreatedAt(gs) {
        if (gs.createdAt) return gs.createdAt;
        var t = parseInt(String(gs.id).slice(0, 8), 36);
        return t > 1e12 && t < 4e12 ? t : 0;
    }
    function gsRefreshModified(list) {
        var changed = false;
        list.forEach(function (gs) {
            var sig = JSON.stringify([gs.name, gs.steps.map(function (st) { return [st.exerciseId, st.minutes]; })]);
            if (gs.sig === undefined) { gs.sig = sig; changed = true; }
            else if (gs.sig !== sig) { gs.sig = sig; gs.updatedAt = Date.now(); changed = true; }
        });
        if (changed) persist();
    }
    function gsSortList(list) {
        var arr = list.slice();
        var cmp = {
            "dur-asc": function (a, b) { return sessionTotalMinutes(a) - sessionTotalMinutes(b); },
            "dur-desc": function (a, b) { return sessionTotalMinutes(b) - sessionTotalMinutes(a); },
            "created-desc": function (a, b) { return gsCreatedAt(b) - gsCreatedAt(a); },
            "created-asc": function (a, b) { return gsCreatedAt(a) - gsCreatedAt(b); },
            "updated": function (a, b) { return (b.updatedAt || gsCreatedAt(b)) - (a.updatedAt || gsCreatedAt(a)); },
            "used-desc": function (a, b) { return (b.runCount || 0) - (a.runCount || 0); },
            "used-asc": function (a, b) { return (a.runCount || 0) - (b.runCount || 0); },
            "az": function (a, b) { return a.name.localeCompare(b.name, "fr", { sensitivity: "base" }); },
            "za": function (a, b) { return b.name.localeCompare(a.name, "fr", { sensitivity: "base" }); }
        }[gsSort];
        return cmp ? arr.sort(cmp) : arr;
    }

    // Petite fenêtre ancrée à un bouton (filtre de durée, tri).
    function openGsPopover(anchor, build) {
        closeFolderMenu();
        var backdrop = document.createElement("div");
        backdrop.className = "ctx-backdrop";
        var pop = document.createElement("div");
        pop.className = "ctx-menu gs-pop";
        function close() { closeFolderMenu(); }
        backdrop.addEventListener("pointerdown", function (e) { e.preventDefault(); close(); });
        backdrop.addEventListener("contextmenu", function (e) { e.preventDefault(); close(); });
        build(pop, close);
        function onKey(e) { if (e.key === "Escape") close(); }
        document.body.appendChild(backdrop);
        document.body.appendChild(pop);
        document.addEventListener("keydown", onKey, true);
        openMenu = { backdrop: backdrop, menu: pop, onKey: onKey };
        var r = anchor.getBoundingClientRect();
        var w = pop.offsetWidth || 240, h = pop.offsetHeight || 160;
        pop.style.left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - w - 8)) + "px";
        pop.style.top = Math.min(r.bottom + 6, Math.max(8, window.innerHeight - h - 8)) + "px";
    }

    function renderGsListScreen(content) {
        var allSessions = state.settings.guidedSessions;
        var tabs = state.settings.sessionFolders.filter(function (f) { return f.instrumentId === state.activeInstrumentId; });
        var activeInstId = state.activeInstrumentId;
        var sessions = allSessions.filter(function (gs) { return gs.instrumentId === activeInstId; });
        gsRefreshModified(sessions);
        if (gsActiveTab !== "all" && !tabs.some(function (t) { return t.id === gsActiveTab; })) gsActiveTab = "all";
        var activeTab = tabs.filter(function (t) { return t.id === gsActiveTab; })[0] || null;

        function newSession() {
            var session = { id: uid(), name: "Nouvelle session", steps: [], instrumentId: activeInstId, tabIds: activeTab ? [activeTab.id] : [], createdAt: Date.now() };
            allSessions.push(session);
            gsEditingSession = session;
            gsScreen = "edit";
            save();
            render();
        }

        function buildRow(session) {
            var row = document.createElement("div");
            row.className = "gs-session-row";
            row.dataset.reorderId = session.id;
            row.title = "Cliquer pour modifier les exercices de la session";
            row.addEventListener("click", function (e) {
                if (e.target.closest("button")) return;
                if (suppressNextClick) { suppressNextClick = false; return; }
                gsEditingSession = session;
                gsScreen = "edit";
                render();
            });
            var info = document.createElement("div");
            info.className = "gs-session-info";
            var name = document.createElement("span");
            name.className = "gs-session-name";
            name.textContent = session.name;
            var meta = document.createElement("span");
            meta.className = "gs-session-meta";
            meta.textContent = session.steps.length + " exercice" + (session.steps.length > 1 ? "s" : "") + " · " + sessionTotalMinutes(session) + " min";
            info.appendChild(name);
            info.appendChild(meta);
            row.appendChild(info);

            var actions = document.createElement("div");
            actions.className = "gs-session-actions";
            var playBtn = svgIconButton(METRO_PLAY_ICON_SVG, "Lancer cette session", function () {
                if (!session.steps.length) return;
                gsStartRun(session);
            });
            playBtn.classList.add("gs-session-play-btn");
            var linksBtn = null;
            if (gsSessionHasItems(session)) {
                linksBtn = svgIconButton(LINK_ICONS.link, "Ouvrir les liens et pièces jointes de la session (avant de la lancer)", function () {
                    gsOpenLinks(session, "list");
                });
                linksBtn.classList.add("gs-session-links-btn");
            }
            var delBtn = iconButton("✕", activeTab ? "Retirer de cet onglet (la session reste dans « Tout »)" : "Supprimer cette session", function () {
                if (activeTab) {
                    session.tabIds = session.tabIds.filter(function (id) { return id !== activeTab.id; });
                    save(); render();
                    return;
                }
                if (!window.confirm("Supprimer la session « " + session.name + " » ?")) return;
                addToTrash("session", session, {});
                allSessions.splice(allSessions.indexOf(session), 1);
                save();
                render();
            });
            actions.appendChild(playBtn);
            if (linksBtn) actions.appendChild(linksBtn);
            actions.appendChild(delBtn);
            row.appendChild(actions);
            return row;
        }

        // Session lâchée sur un onglet : déplacer / ajouter aussi / dupliquer.
        function openTabDropMenu(x, y, session, targetId) {
            closeFolderMenu();
            var target = tabs.filter(function (t) { return t.id === targetId; })[0] || null; // null = « Tout »
            var targetName = target ? target.name : "Tout";
            var already = target ? session.tabIds.indexOf(target.id) !== -1 : true;
            if ((target ? target.id : "all") === gsActiveTab) { render(); return; }
            var backdrop = document.createElement("div");
            backdrop.className = "ctx-backdrop";
            function cancel() { closeFolderMenu(); render(); }
            backdrop.addEventListener("pointerdown", function (e) { e.preventDefault(); cancel(); });
            backdrop.addEventListener("contextmenu", function (e) { e.preventDefault(); cancel(); });
            var menu = document.createElement("div");
            menu.className = "ctx-menu";
            menu.setAttribute("role", "menu");
            var heading = document.createElement("div");
            heading.className = "ctx-menu-title";
            heading.textContent = "« " + session.name + " » → « " + targetName + " »";
            menu.appendChild(heading);
            function choice(text, className, onClick) {
                var b = document.createElement("button");
                b.type = "button";
                b.className = "ctx-item" + (className ? " " + className : "");
                b.textContent = text;
                b.addEventListener("click", onClick);
                menu.appendChild(b);
            }
            function addTo(sess) { if (target && sess.tabIds.indexOf(target.id) === -1) sess.tabIds.push(target.id); }
            if (activeTab) choice(target ? "Déplacer ici" : "Retirer de « " + activeTab.name + " »", "", function () {
                closeFolderMenu();
                session.tabIds = session.tabIds.filter(function (id) { return id !== activeTab.id; });
                addTo(session);
                save(); render();
            });
            if (target && !already) choice(activeTab ? "Ajouter aussi ici" : "Ajouter à cet onglet", "", function () {
                closeFolderMenu();
                addTo(session);
                save(); render();
                showToast("« " + session.name + " » ajoutée à « " + targetName + " »");
            });
            choice("Dupliquer ici", "", function () {
                closeFolderMenu();
                var copy = JSON.parse(JSON.stringify(session));
                copy.id = uid();
                copy.createdAt = Date.now(); copy.runCount = 0; delete copy.updatedAt; delete copy.sig;
                copy.name = session.name + " (copie)";
                copy.steps.forEach(function (st) { st.id = uid(); });
                copy.tabIds = target ? [target.id] : (activeTab ? session.tabIds.slice() : []);
                allSessions.push(copy);
                save(); render();
                showToast("« " + session.name + " » dupliquée");
            });
            choice("Annuler", "ctx-item-muted", cancel);
            function onKey(e) { if (e.key === "Escape") cancel(); }
            document.body.appendChild(backdrop);
            document.body.appendChild(menu);
            document.addEventListener("keydown", onKey, true);
            openMenu = { backdrop: backdrop, menu: menu, onKey: onKey };
            var mw = menu.offsetWidth || 220, mh = menu.offsetHeight || 130;
            menu.style.left = Math.min(Math.max(8, x + 6), Math.max(8, window.innerWidth - mw - 8)) + "px";
            menu.style.top = Math.min(Math.max(8, y - 20), Math.max(8, window.innerHeight - mh - 8)) + "px";
        }

        // ---- barre d'onglets ----
        var bar = document.createElement("div");
        bar.className = "gs-tabbar";
        bar.setAttribute("role", "tablist");
        function tabBtn(id, label, count, dropId) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "gs-tab" + (gsActiveTab === id ? " active" : "");
            b.setAttribute("role", "tab");
            b.setAttribute("aria-selected", gsActiveTab === id ? "true" : "false");
            b.setAttribute("data-drop-session-folder", dropId);
            b.innerHTML = "";
            var l = document.createElement("span"); l.className = "gs-tab-name"; l.textContent = label;
            var c = document.createElement("span"); c.className = "gs-tab-count"; c.textContent = String(count);
            b.appendChild(l); b.appendChild(c);
            b.addEventListener("click", function () { gsActiveTab = id; gsSaveView(); render(); });
            if (id !== "all") b.addEventListener("dblclick", function () { renameTab(id); });
            bar.appendChild(b);
        }
        function renameTab(id) {
            var t = tabs.filter(function (x) { return x.id === id; })[0];
            if (!t) return;
            var n = window.prompt("Nom de l'onglet :", t.name);
            if (n === null || !n.trim()) return;
            t.name = n.trim(); save(); render();
        }
        tabBtn("all", "Tout", sessions.length, "__all__");
        tabs.forEach(function (t) {
            tabBtn(t.id, t.name, sessions.filter(function (gs) { return gs.tabIds.indexOf(t.id) !== -1; }).length, t.id);
        });
        content.appendChild(bar);

        // ---- filtre de durée + actions de l'onglet ----
        var tools = document.createElement("div");
        tools.className = "gs-listtools";
        var durBtn = document.createElement("button");
        durBtn.type = "button";
        durBtn.className = "gs-tool-btn" + (gsDurMin !== null || gsDurMax !== null ? " active" : "");
        durBtn.textContent = gsDurLabel();
        durBtn.title = "Filtrer par durée (min et max)";
        durBtn.addEventListener("click", function () {
            openGsPopover(durBtn, function (pop, close) {
                var title = document.createElement("div"); title.className = "ctx-menu-title"; title.textContent = "Durée de la session";
                pop.appendChild(title);
                var form = document.createElement("div"); form.className = "gs-dur-form";
                function field(label, value, onSet) {
                    var l = document.createElement("label"); l.className = "gs-dur-field";
                    var t = document.createElement("span"); t.textContent = label; l.appendChild(t);
                    var inp = document.createElement("input"); inp.type = "number"; inp.min = "0"; inp.max = "600"; inp.placeholder = "—";
                    inp.value = value === null ? "" : String(value);
                    l.appendChild(inp);
                    var u = document.createElement("span"); u.className = "gs-dur-unit"; u.textContent = "min"; l.appendChild(u);
                    inp.addEventListener("change", function () {
                        var n = parseInt(inp.value, 10);
                        onSet(isNaN(n) ? null : Math.max(0, n));
                        if (gsDurMin !== null && gsDurMax !== null && gsDurMin > gsDurMax) { var tmp = gsDurMin; gsDurMin = gsDurMax; gsDurMax = tmp; }
                        gsSaveView();
                        render(); // le popover (hors de la page) reste ouvert ; la liste et le bouton se mettent à jour
                    });
                    bindScrubInput(inp, 0, 600, { pxPerStep: 6, wheel: true, emptyStart: 30 });
                    form.appendChild(l);
                }
                field("Min", gsDurMin, function (n) { gsDurMin = n; });
                field("Max", gsDurMax, function (n) { gsDurMax = n; });
                pop.appendChild(form);
                var reset = document.createElement("button"); reset.type = "button"; reset.className = "ctx-item ctx-item-muted"; reset.textContent = "Réinitialiser";
                reset.addEventListener("click", function () { gsDurMin = null; gsDurMax = null; gsSaveView(); close(); render(); });
                pop.appendChild(reset);
                var ok = document.createElement("button"); ok.type = "button"; ok.className = "ctx-item"; ok.textContent = "OK";
                ok.addEventListener("click", function () { close(); render(); });
                pop.appendChild(ok);
            });
        });
        tools.appendChild(durBtn);
        var sortBtn = document.createElement("button");
        sortBtn.type = "button";
        sortBtn.className = "gs-tool-btn" + (gsSort !== "manual" ? " active" : "");
        sortBtn.textContent = "⇅ Tri" + (gsSort !== "manual" ? " : " + GS_SORTS.filter(function (x) { return x[0] === gsSort; })[0][1] : "");
        sortBtn.title = "Trier les sessions";
        sortBtn.addEventListener("click", function () {
            openGsPopover(sortBtn, function (pop, close) {
                var title = document.createElement("div"); title.className = "ctx-menu-title"; title.textContent = "Trier les sessions";
                pop.appendChild(title);
                GS_SORTS.forEach(function (x) {
                    var b = document.createElement("button"); b.type = "button";
                    b.className = "ctx-item" + (gsSort === x[0] ? " gs-sort-current" : "");
                    b.textContent = (gsSort === x[0] ? "✓ " : "") + x[1];
                    b.addEventListener("click", function () { gsSort = x[0]; gsSaveView(); close(); render(); });
                    pop.appendChild(b);
                });
            });
        });
        tools.appendChild(sortBtn);
        var spacer = document.createElement("span"); spacer.className = "gs-tools-spacer"; tools.appendChild(spacer);
        if (activeTab) {
            var tAct = document.createElement("div");
            tAct.className = "gs-session-actions";
            tAct.appendChild(iconButton("✎", "Renommer l'onglet", function () { renameTab(activeTab.id); }));
            tAct.appendChild(iconButton("✕", "Supprimer l'onglet (les sessions sont conservées dans « Tout »)", function () {
                if (!window.confirm("Supprimer l'onglet « " + activeTab.name + " » ? Ses sessions sont conservées.")) return;
                sessions.forEach(function (gs) { gs.tabIds = gs.tabIds.filter(function (id) { return id !== activeTab.id; }); });
                state.settings.sessionFolders.splice(state.settings.sessionFolders.indexOf(activeTab), 1);
                gsActiveTab = "all"; gsSaveView();
                save(); render();
            }));
            tools.appendChild(tAct);
        }
        content.appendChild(tools);

        // ---- liste ----
        var visible = gsSortList(sessions.filter(function (gs) {
            return (!activeTab || gs.tabIds.indexOf(activeTab.id) !== -1) && gsDurationMatches(gs);
        }));
        if (!visible.length) {
            var empty = document.createElement("div");
            empty.className = "gs-empty";
            empty.textContent = !sessions.length ? "Aucune session pour l'instant."
                : activeTab && !sessions.some(function (gs) { return gs.tabIds.indexOf(activeTab.id) !== -1; }) ? "Onglet vide : glisse une session sur son onglet."
                : "Aucune session ne correspond au filtre.";
            content.appendChild(empty);
        } else {
            var list = document.createElement("div");
            list.className = "gs-session-list";
            visible.forEach(function (gs) { list.appendChild(buildRow(gs)); });
            // Réordonner : seules les sessions affichées changent de place entre elles.
            var visibleProxy = { sort: function (cmp) {
                if (gsSort !== "manual") return; // ordre calculé : pas de réordonnancement à la main
                var slots = [];
                allSessions.forEach(function (gs, i) { if (visible.indexOf(gs) !== -1) slots.push(i); });
                var sorted = visible.slice().sort(cmp);
                slots.forEach(function (idx, k) { allSessions[idx] = sorted[k]; });
            } };
            setupDragReorder(list, ".gs-session-row", function () { return visibleProxy; }, "y", {
                dropAttr: "data-drop-session-folder",
                onDropOnTarget: function (el, target, x, y) {
                    var session = allSessions.filter(function (gs) { return gs.id === el.dataset.reorderId; })[0];
                    if (!session) return;
                    openTabDropMenu(x, y, session, target === "__all__" ? "" : target);
                }
            });
            content.appendChild(list);
        }

        // Boutons d'ajout : en haut, à droite du titre « Session guidée » (ou en tête de liste quand le titre est masqué).
        var addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "btn-accent gs-add-session-btn";
        addBtn.textContent = "+ Nouvelle session";
        addBtn.addEventListener("click", newSession);
        var addTabBtn = document.createElement("button");
        addTabBtn.type = "button";
        addTabBtn.className = "gs-add-folder-btn";
        addTabBtn.textContent = "+ Onglet";
        addTabBtn.title = "Nouvel onglet (ex. Sessions 1 heure, Favorites…)";
        addTabBtn.addEventListener("click", function () {
            var n = window.prompt("Nom du nouvel onglet (ex. Sessions 1 heure, Favorites) :", "");
            if (n === null || !n.trim()) return;
            var t = { id: uid(), name: n.trim(), instrumentId: activeInstId, collapsed: false };
            state.settings.sessionFolders.push(t);
            gsActiveTab = t.id; gsSaveView();
            save(); render();
        });
        var headActions = document.createElement("div");
        headActions.className = "gs-head-actions";
        headActions.appendChild(addBtn);
        headActions.appendChild(addTabBtn);
        if (window.matchMedia && window.matchMedia("(min-width: 880px)").matches) $contentHeading.appendChild(headActions);
        else content.insertBefore(headActions, content.firstChild);
    }

    // ---- écran édition ----
    function renderGsEditScreen(content) {
        var session = gsEditingSession;

        var backBtn = document.createElement("button");
        backBtn.type = "button";
        backBtn.className = "btn-ghost gs-back-btn";
        backBtn.textContent = "← Retour à la liste";
        backBtn.addEventListener("click", function () { gsEditingSession = null; gsScreen = "list"; render(); });
        content.appendChild(backBtn);

        var nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.className = "gs-name-input";
        nameInput.value = session.name;
        nameInput.placeholder = "Nom de la session";
        nameInput.addEventListener("change", function () {
            session.name = nameInput.value.trim() || session.name;
            save();
        });
        content.appendChild(nameInput);

        var sessTabs = state.settings.sessionFolders.filter(function (f) { return f.instrumentId === session.instrumentId; });
        if (sessTabs.length) {
            var tabPick = document.createElement("div");
            tabPick.className = "gs-tabpick";
            tabPick.setAttribute("aria-label", "Onglets de la session");
            sessTabs.forEach(function (t) {
                var chip = document.createElement("button");
                chip.type = "button";
                var on = session.tabIds.indexOf(t.id) !== -1;
                chip.className = "gs-tabpick-chip" + (on ? " active" : "");
                chip.setAttribute("aria-pressed", on ? "true" : "false");
                chip.textContent = t.name;
                chip.addEventListener("click", function () {
                    var i = session.tabIds.indexOf(t.id);
                    if (i === -1) session.tabIds.push(t.id); else session.tabIds.splice(i, 1);
                    save();
                    var now = i === -1;
                    chip.classList.toggle("active", now);
                    chip.setAttribute("aria-pressed", now ? "true" : "false");
                });
                tabPick.appendChild(chip);
            });
            content.appendChild(tabPick);
        }

        var runBtn = document.createElement("button");
        runBtn.type = "button";
        runBtn.className = "btn-accent gs-edit-run-btn";
        runBtn.textContent = "▶ Lancer la session";
        runBtn.title = session.steps.length ? "Lancer cette session maintenant" : "Ajoutez d'abord un exercice";
        runBtn.disabled = !session.steps.length;
        runBtn.addEventListener("click", function () { if (session.steps.length) gsStartRun(session); });
        content.appendChild(runBtn);
        var editRunBtn = runBtn;

        var editToolsRow = document.createElement("div");
        editToolsRow.className = "gs-edit-tools-row";
        var pdfBtn = document.createElement("button");
        pdfBtn.type = "button";
        pdfBtn.className = "btn-ghost gs-pdf-btn";
        pdfBtn.textContent = "Enregistrer sous PDF";
        pdfBtn.addEventListener("click", function () { exportSessionPdf(session); });
        editToolsRow.appendChild(pdfBtn);
        if (gsSessionHasItems(session)) {
            var editLinksBtn = document.createElement("button");
            editLinksBtn.type = "button";
            editLinksBtn.className = "btn-ghost gs-edit-links-btn";
            editLinksBtn.textContent = "Ouvrir les liens/PJ…";
            editLinksBtn.title = "Ouvrir d'un coup les liens et pièces jointes de la session, avant de la lancer";
            editLinksBtn.addEventListener("click", function () { gsOpenLinks(session, "edit"); });
            editToolsRow.appendChild(editLinksBtn);
        }
        content.appendChild(editToolsRow);

        var stepsLabel = document.createElement("div");
        stepsLabel.className = "section-label";
        stepsLabel.textContent = "Exercices de la session";
        content.appendChild(stepsLabel);

        var stepsList = document.createElement("div");
        stepsList.className = "gs-steps-list";
        content.appendChild(stepsList);

        var totalRow = document.createElement("div");
        totalRow.className = "gs-total-row";

        function refreshTotal() {
            totalRow.textContent = "Durée totale : " + sessionTotalMinutes(session) + " min";
        }

        function renderSteps() {
            stepsList.innerHTML = "";
            session.steps.forEach(function (step) {
                var found = findExerciseById(step.exerciseId);
                var row = document.createElement("div");
                row.className = "gs-step-row";
                row.dataset.reorderId = step.id;
                var line = document.createElement("div");
                line.className = "gs-step-line";
                row.appendChild(line);
                var handle = document.createElement("span");
                handle.className = "gs-step-handle";
                handle.innerHTML = GRIP_ICON_SVG;
                line.appendChild(handle);
                if (found) line.appendChild(gsThemeBadge(found.pathNames, found.chapterColor));
                var label = document.createElement("span");
                label.className = "gs-step-label" + (found ? "" : " gs-step-missing");
                label.textContent = found ? found.ex.title : "(exercice supprimé)";
                line.appendChild(label);
                var stepTempoCfg = {
                    title: found ? found.ex.title : "ce pas",
                    exId: found ? found.ex.id : null,
                    get: function () { return gsEffectiveMetronome(step, found && found.ex); },
                    set: function (p) { gsSetStepMetronome(step, found, p); renderSteps(); }
                };
                // Données propres à l'exercice : liens, images, bulle de notes, puis le tempo (colonne alignée à droite).
                var exData = document.createElement("div");
                exData.className = "gs-step-exdata";
                if (found) {
                    appendExerciseLinkButtons(exData, found.ex);
                    appendExerciseImageButton(exData, found.ex);
                }
                var detailsBtn = document.createElement("span");
                detailsBtn.className = "exercise-note-mark gs-step-note-mark";
                function refreshNoteMark() {
                    var has = !!((found && found.ex.notes && found.ex.notes.trim()) || (step.note && step.note.trim()));
                    detailsBtn.innerHTML = has ? NOTE_BUBBLE_SVG : "";
                    detailsBtn.title = "Cet exercice a des notes";
                }
                refreshNoteMark();
                exData.appendChild(detailsBtn);
                line.appendChild(exData);
                var tempoSlot = document.createElement("div");
                tempoSlot.className = "gs-step-tempo";
                tempoSlot.appendChild(buildTempoChip(stepTempoCfg, true));
                line.appendChild(tempoSlot);
                // Données de la session (durée de chaque exercice, recopier) : zone séparée, alignée à droite.
                var sessZone = document.createElement("div");
                sessZone.className = "gs-step-session";
                line.appendChild(sessZone);
                var minutesInput = document.createElement("input");
                minutesInput.type = "number";
                minutesInput.min = "1";
                minutesInput.max = "180";
                minutesInput.className = "gs-step-minutes";
                minutesInput.value = step.minutes;
                bindScrubInput(minutesInput, 1, 180);
                minutesInput.addEventListener("change", function () {
                    step.minutes = Math.max(1, parseInt(minutesInput.value, 10) || 5);
                    minutesInput.value = step.minutes;
                    gsRememberMinutes(step);
                    save();
                    refreshTotal();
                });
                sessZone.appendChild(minutesInput);
                var minLabel = document.createElement("span");
                minLabel.className = "gs-step-min-label";
                minLabel.textContent = "min";
                sessZone.appendChild(minLabel);
                if (gsOtherStepsOf(step).rows.length) {
                    var applyBtn = svgIconButton(GS_APPLY_ICON_SVG, "Appliquer cette durée à d'autres sessions contenant cet exercice", function () { gsOfferSyncMinutes(step); });
                    applyBtn.classList.add("gs-step-apply-btn");
                    sessZone.appendChild(applyBtn);
                } else {
                    var applySlot = document.createElement("span");
                    applySlot.className = "gs-step-apply-slot";
                    sessZone.appendChild(applySlot);
                }
                var detailsOpen = !!gsOpenStepDetails[step.id];
                // Un clic sur la barre de l'exercice (hors champs et boutons) déplie ou replie ses détails,
                // comme dans la liste des exercices.
                row.title = "Cliquer pour voir ou modifier les détails (note, liens, tempo)";
                row.style.cursor = "pointer";
                row.addEventListener("click", function (e) {
                    if (e.target.closest("button, input, textarea, select, label, .gs-step-details, .gs-step-handle")) return;
                    if (suppressNextClick) { suppressNextClick = false; return; }
                    gsOpenStepDetails[step.id] = !gsOpenStepDetails[step.id];
                    renderSteps();
                });
                var removeBtn = iconButton("✕", "Retirer cet exercice", function () {
                    session.steps.splice(session.steps.indexOf(step), 1);
                    save();
                    renderSteps();
                    refreshTotal();
                    editRunBtn.disabled = !session.steps.length;
                });
                sessZone.appendChild(removeBtn);

                if (detailsOpen) {
                    var details = document.createElement("div");
                    details.className = "gs-step-details";
                    var stepPaths = gsExercisePathLines(found);
                    if (stepPaths) details.appendChild(stepPaths);
                    // Modifier l'exercice lui-même (titre, tempo, notes, liens, fichiers, images) sans quitter la préparation.
                    if (found) {
                        var editOpen = !!gsOpenStepEdit[step.id];
                        var editToggle = document.createElement("button");
                        editToggle.type = "button";
                        editToggle.className = "btn-ghost gs-step-edit-toggle";
                        editToggle.textContent = (editOpen ? "▾ " : "▸ ") + "Modifier l'exercice (titre, notes, liens, images…)";
                        editToggle.addEventListener("click", function () { gsOpenStepEdit[step.id] = !editOpen; renderSteps(); });
                        details.appendChild(editToggle);
                        if (editOpen) {
                            var titleEdit = document.createElement("input");
                            titleEdit.type = "text";
                            titleEdit.className = "gs-step-title-edit";
                            titleEdit.value = found.ex.title;
                            titleEdit.setAttribute("aria-label", "Titre de l'exercice");
                            titleEdit.addEventListener("change", function () {
                                var v = titleEdit.value.trim();
                                if (!v) { titleEdit.value = found.ex.title; return; }
                                found.ex.title = v;
                                touchExercise(found.ex);
                                save();
                                renderSteps();
                            });
                            details.appendChild(titleEdit);
                            var exEditor = renderExerciseDetails(found.ex);
                            details.appendChild(exEditor);
                            var exTa = exEditor.querySelector(".notes-textarea");
                            if (exTa) setTimeout(function () { autoGrowNotes(exTa); }, 0);
                        }
                    }
                    details.appendChild(buildMetronomePresetRow(stepTempoCfg));
                    var noteLabel = document.createElement("div");
                    noteLabel.className = "section-label";
                    noteLabel.textContent = "Note pour cet exercice (affichée pendant la session)";
                    var noteStatus = document.createElement("span");
                    noteStatus.className = "save-status";
                    noteLabel.appendChild(noteStatus);
                    details.appendChild(noteLabel);
                    var noteInput = document.createElement("textarea");
                    noteInput.className = "gs-step-note";
                    noteInput.rows = 2;
                    noteInput.placeholder = "Ex. tempo progressif depuis 80 bpm";
                    noteInput.value = step.note || "";
                    bindAutosaveTextarea(noteInput, function (value) {
                        step.note = value;
                        refreshNoteMark();
                    }, noteStatus);
                    details.appendChild(noteInput);
                    var items = found ? gsExerciseItems(found.ex) : [];
                    var resLabel = document.createElement("div");
                    resLabel.className = "section-label";
                    resLabel.textContent = "Liens et fichiers affichés pendant la session";
                    details.appendChild(resLabel);
                    if (!items.length) {
                        var none = document.createElement("div");
                        none.className = "gs-empty";
                        none.textContent = "Aucun lien ni fichier dans cet exercice.";
                        details.appendChild(none);
                    }
                    items.forEach(function (item) {
                        var line = document.createElement("label");
                        line.className = "gs-links-item";
                        var cb = document.createElement("input");
                        cb.type = "checkbox";
                        cb.checked = !gsStepHides(step, item.key);
                        cb.addEventListener("change", function () {
                            gsSetStepHidden(step, item.key, !cb.checked);
                            save();
                        });
                        line.appendChild(cb);
                        var text = document.createElement("span");
                        text.textContent = item.type === "link" ? item.label + " · " + gsShortUrl(item.url) : item.label;
                        line.appendChild(text);
                        details.appendChild(line);
                    });
                    row.appendChild(details);
                }
                stepsList.appendChild(row);
            });
            setupDragReorder(stepsList, ".gs-step-row", function () { return session.steps; }, "y");
            // Colonne des dossiers : tous les badges prennent la largeur du plus large, pour aligner les titres.
            function alignBadges() {
                var w = 0, badges = stepsList.querySelectorAll(".gs-step-line > .gs-theme-badge");
                Array.prototype.forEach.call(badges, function (bd) { bd.style.minWidth = ""; w = Math.max(w, bd.offsetWidth); });
                if (w) Array.prototype.forEach.call(badges, function (bd) { bd.style.minWidth = w + "px"; });
            }
            alignBadges();
            requestAnimationFrame(alignBadges);
        }
        renderSteps();
        refreshTotal();

        var addStepBtn = document.createElement("button");
        addStepBtn.type = "button";
        addStepBtn.className = "btn-ghost gs-add-step-btn";
        addStepBtn.textContent = "+ Ajouter un exercice";
        addStepBtn.addEventListener("click", function () {
            gsPickCallback = function (ex) {
                session.steps.push({ id: uid(), exerciseId: ex.id, minutes: gsDefaultMinutes(ex) });
                save();
            };
            gsScreen = "pick";
            render();
        });
        content.appendChild(addStepBtn);
        content.appendChild(totalRow);
    }

    // ---- écran choix d'un exercice (instrument actif) ----
    // Arborescence en lecture seule (mêmes couleurs de chapitre et même logique de pli/dépli —
    // treeExpanded est partagé avec la barre latérale — que la navigation habituelle) : plus
    // simple pour choisir un exercice que la liste à plat de tous les exercices mélangés.
    // Dernière ligne de note d'un exercice (aperçu dans le choix d'un exercice) : aide à distinguer des exercices
    // de même nom (copies) et à retrouver celui où l'on a écrit ses derniers commentaires.
    function gsNotePreview(ex) {
        var lines = (ex.notes || "").split("\n").filter(function (l) { return l.trim(); });
        if (!lines.length) return null;
        var el = document.createElement("span");
        el.className = "gs-pick-note";
        var t = lines[lines.length - 1].trim();
        el.textContent = "✎ " + (t.length > 70 ? t.slice(0, 69) + "…" : t) + (lines.length > 1 ? "  (+" + (lines.length - 1) + ")" : "");
        el.title = ex.notes;
        return el;
    }
    function renderGsPickTree(container, folders, depth, rootColor) {
        folders.forEach(function (folder) {
            var color = depth === 0 ? folder.color : rootColor;
            var visibleExercises = folder.exercises.filter(function (ex) { return !ex.archived; });
            var hasContent = folder.folders.length > 0 || visibleExercises.length > 0;
            var expanded = treeExpanded[folder.id] !== false;

            var node = document.createElement("div");
            node.className = "gs-pick-node";
            var row = document.createElement("div");
            row.className = "gs-pick-tree-row";
            if (depth === 0) {
                row.style.borderLeft = "3px solid " + color;
                row.style.background = "color-mix(in srgb, " + color + " 6%, transparent)";
            }
            var twisty = document.createElement("button");
            twisty.type = "button";
            twisty.className = "tree-twisty" + (hasContent ? "" : " tree-twisty-empty") + (expanded ? " expanded" : "");
            twisty.innerHTML = CHEVRON_ICON_SVG;
            if (hasContent) {
                twisty.addEventListener("click", function (e) {
                    e.stopPropagation();
                    treeExpanded[folder.id] = !expanded;
                    render();
                });
            }
            row.appendChild(twisty);
            var label = document.createElement("span");
            label.className = "tree-label";
            label.textContent = folder.name;
            row.appendChild(label);
            row.addEventListener("click", function () { treeExpanded[folder.id] = !expanded; render(); });
            node.appendChild(row);

            if (expanded && hasContent) {
                var childWrap = document.createElement("div");
                childWrap.className = "gs-pick-tree-children";
                visibleExercises.forEach(function (ex) {
                    var exBtn = document.createElement("button");
                    exBtn.type = "button";
                    exBtn.className = "gs-pick-exercise-row";
                    var exTitle = document.createElement("span");
                    exTitle.className = "gs-pick-ex-title";
                    exTitle.textContent = ex.title;
                    exBtn.appendChild(exTitle);
                    var prev = gsNotePreview(ex);
                    if (prev) exBtn.appendChild(prev);
                    exBtn.addEventListener("click", function () {
                        gsPickCallback(ex);
                        gsScreen = "edit";
                        render();
                    });
                    childWrap.appendChild(exBtn);
                });
                renderGsPickTree(childWrap, folder.folders, depth + 1, color);
                node.appendChild(childWrap);
            }
            container.appendChild(node);
        });
    }

    function renderGsPickScreen(content) {
        var backBtn = document.createElement("button");
        backBtn.type = "button";
        backBtn.className = "btn-ghost gs-back-btn";
        backBtn.textContent = "← Retour";
        backBtn.addEventListener("click", function () { gsScreen = "edit"; render(); });
        content.appendChild(backBtn);

        var searchInput = document.createElement("input");
        searchInput.type = "text";
        searchInput.className = "gs-pick-search";
        searchInput.placeholder = "Rechercher un exercice…";
        content.appendChild(searchInput);

        var resultsWrap = document.createElement("div");
        content.appendChild(resultsWrap);

        function refreshResults() {
            resultsWrap.innerHTML = "";
            var q = searchInput.value.trim().toLowerCase();
            var inst = getActiveInstrument();

            // Recherche : liste à plat (peu importe le dossier, on cherche partout). Sans
            // recherche : l'arborescence complète, comme dans la barre latérale.
            if (!q) {
                resultsWrap.className = "gs-pick-tree";
                renderGsPickTree(resultsWrap, inst.categories, 0, null);
                return;
            }
            resultsWrap.className = "gs-pick-results";
            var results = collectExercises(inst, function (ex) {
                return !ex.archived && ex.title.toLowerCase().indexOf(q) !== -1;
            });
            if (!results.length) {
                var empty = document.createElement("div");
                empty.className = "gs-empty";
                empty.textContent = "Aucun exercice ne correspond.";
                resultsWrap.appendChild(empty);
                return;
            }
            results.forEach(function (r) {
                var btn = document.createElement("button");
                btn.type = "button";
                btn.className = "gs-pick-result";
                var head = document.createElement("span");
                head.className = "gs-pick-result-head";
                var rootChapter = findById(inst.categories, r.pathIds[0]);
                head.appendChild(gsThemeBadge(r.pathNames, (rootChapter && rootChapter.color) || "#00e676"));
                var titleSpan = document.createElement("span");
                titleSpan.className = "gs-pick-result-title";
                titleSpan.textContent = r.ex.title;
                head.appendChild(titleSpan);
                btn.appendChild(head);
                var prev2 = gsNotePreview(r.ex);
                if (prev2) btn.appendChild(prev2);
                btn.addEventListener("click", function () {
                    gsPickCallback(r.ex);
                    gsScreen = "edit";
                    render();
                });
                resultsWrap.appendChild(btn);
            });
        }
        searchInput.addEventListener("input", refreshResults);
        refreshResults();
        searchInput.focus();
    }

    // ---- écran de guidage (lecture) ----
    function gsStartRun(session) {
        session.runCount = (session.runCount || 0) + 1;
        session.lastRunAt = Date.now();
        persist();
        if (gsAutoAdvanceOn()) { try { ensureMetroAudio(); } catch (e) {} } // le clic de lancement autorise le son du carillon
        gsRunSession = session;
        gsRunStepIndex = 0;
        gsTotalMs = 0; gsTotalStartTs = null;
        gsEnterRunStep();
        gsScreen = "run";
        render();
    }

    function gsEnterRunStep() {
        var enteredStep = gsRunSession.steps[gsRunStepIndex];
        var enteredFound = findExerciseById(enteredStep.exerciseId);
        var presetForStep = gsEffectiveMetronome(enteredStep, enteredFound && enteredFound.ex);
        var stepLink = enteredFound ? { exId: enteredFound.ex.id, title: enteredFound.ex.title, fromSession: true } : null;
        if (presetForStep) loadMetronomePreset(presetForStep, { link: stepLink });
        else setMetroLink(stepLink ? { exId: stepLink.exId, title: stepLink.title, base: null, fromSession: true } : null);
        gsWarnKey = null;
        gsRunAllocatedSec = gsRunSession.steps[gsRunStepIndex].minutes * 60;
        gsRunElapsedMs = 0;
        gsRunStartTs = Date.now();
        gsRunPaused = false;
        if (gsTotalStartTs === null) gsTotalStartTs = Date.now(); // 1er exercice, ou changement d'exercice pendant une pause
        transportLastTouched = "session";
    }

    function gsTotalNowMs() {
        return gsTotalMs + (gsTotalStartTs === null ? 0 : Date.now() - gsTotalStartTs);
    }
    function gsFormatTotal(ms) {
        var t = Math.floor(ms / 1000), h = Math.floor(t / 3600), mn = Math.floor(t / 60) % 60, sc = t % 60;
        function p2(n) { return (n < 10 ? "0" : "") + n; }
        return (h ? h + ":" + p2(mn) : mn) + ":" + p2(sc);
    }

    function gsRunElapsedNowMs() {
        return gsRunElapsedMs + (gsRunPaused ? 0 : Date.now() - gsRunStartTs);
    }

    function gsPauseRun() {
        if (gsRunPaused) return;
        gsRunElapsedMs += Date.now() - gsRunStartTs;
        if (gsTotalStartTs !== null) { gsTotalMs += Date.now() - gsTotalStartTs; gsTotalStartTs = null; }
        gsRunPaused = true;
        transportLastTouched = "session";
    }

    function gsResumeRun() {
        if (!gsRunPaused) return;
        gsRunStartTs = Date.now();
        gsTotalStartTs = Date.now();
        gsRunPaused = false;
        transportLastTouched = "session";
    }

    function gsEndRun() {
        if (gsRunInterval) { clearInterval(gsRunInterval); gsRunInterval = null; }
        if (metroLink && metroLink.fromSession) setMetroLink(null);
        gsRunSession = null;
        gsScreen = "list";
        render();
    }

    // ---------- lecteurs YouTube intégrés (sous la session) ----------
    // Un lien YouTube d'un exercice se lit ici plutôt que dans un onglet. Volume et vitesse se règlent
    // dans les paramètres du lecteur YouTube lui-même (roue dentée) : aucun réglage n'est ajouté par-dessus,
    // pour ne pas perturber la vidéo. Un lien peu utile peut être masqué de cette liste (step.hidden de la session) :
    // il reste dans l'exercice et dans l'écran des liens, et on peut le réafficher.
    var ytApiPromise = null;

    // iOS/iPadOS ignorent setVolume dans un lecteur web : le volume y reste celui de l'appareil.
    function isIosDevice() {
        return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    }

    // Volume de départ des vidéos YouTube (Paramètres) : "auto" = on ne touche à rien (volume habituel de
    // YouTube). Sinon appliqué UNE fois quand le lecteur est prêt ; il vaut aussi pour les publicités
    // que YouTube insère, qui passent par le même lecteur. Propre à cet appareil.
    var YT_START_VOLUME_KEY = "trainhub.ytStartVolume.v1";
    function getYtStartVolume() {
        try { var v = localStorage.getItem(YT_START_VOLUME_KEY); var n = parseInt(v, 10); return n >= 0 && n <= 100 ? n : null; } catch (e) { return null; }
    }
    function setYtStartVolume(v) {
        try { if (v === null) localStorage.removeItem(YT_START_VOLUME_KEY); else localStorage.setItem(YT_START_VOLUME_KEY, String(v)); } catch (e) {}
    }

    // Barres temps/volume à côté des vidéos : affichées par défaut, désactivables d'un clic (et alors
    // plus aucun suivi du lecteur). Réglage propre à cet appareil.
    var YT_BARS_KEY = "trainhub.ytBars.v1";
    function ytBarsEnabled() {
        try { return localStorage.getItem(YT_BARS_KEY) !== "0"; } catch (e) { return true; }
    }
    function setYtBarsEnabled(on) {
        try { localStorage.setItem(YT_BARS_KEY, on ? "1" : "0"); } catch (e) {}
    }

    // Les lecteurs sont-ils affichés dans la session ? Réglage d'affichage propre à cet appareil, retenu.
    var YT_SHOWN_KEY = "trainhub.ytShown.v1";
    function ytVideosShown() {
        try { return localStorage.getItem(YT_SHOWN_KEY) !== "0"; } catch (e) { return true; }
    }
    function setYtVideosShown(on) {
        try { localStorage.setItem(YT_SHOWN_KEY, on ? "1" : "0"); } catch (e) {}
    }

    function youTubeVideoInfo(url) {
        try {
            var u = new URL(url);
            var host = u.hostname.replace(/^www\.|^m\./, "");
            var id = null;
            if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
            else if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
                if (u.pathname === "/watch") id = u.searchParams.get("v");
                else {
                    var m = u.pathname.match(/^\/(embed|shorts|live|v)\/([^/?]+)/);
                    if (m) id = m[2];
                }
            }
            if (!id || !/^[\w-]{6,}$/.test(id)) return null;
            var t = u.searchParams.get("t") || u.searchParams.get("start") || "";
            var start = 0;
            var tm = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
            if (tm && t) start = (parseInt(tm[1] || 0, 10) * 3600) + (parseInt(tm[2] || 0, 10) * 60) + parseInt(tm[3] || 0, 10);
            return { id: id, start: start };
        } catch (e) { return null; }
    }

    function loadYouTubeApi() {
        if (window.YT && window.YT.Player) return Promise.resolve();
        if (ytApiPromise) return ytApiPromise;
        ytApiPromise = new Promise(function (resolve, reject) {
            var prev = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = function () { if (prev) prev(); resolve(); };
            var s = document.createElement("script");
            s.src = "https://www.youtube.com/iframe_api";
            s.onerror = function () { ytApiPromise = null; reject(new Error("api")); };
            document.head.appendChild(s);
            setTimeout(function () { if (!(window.YT && window.YT.Player)) { ytApiPromise = null; reject(new Error("timeout")); } }, 10000);
        });
        return ytApiPromise;
    }

    // "Agrandir" = vrai plein écran du navigateur (Échap pour en sortir). Là où il n'existe pas pour un
    // élément quelconque (iPhone), repli sur un grand lecteur par-dessus la page.
    var gsYtOverlayCard = null;
    function setYtOverlay(card, on) {
        if (gsYtOverlayCard && gsYtOverlayCard !== card) gsYtOverlayCard.classList.remove("gs-yt-large");
        card.classList.toggle("gs-yt-large", on);
        document.documentElement.classList.toggle("gs-yt-large-open", on);
        gsYtOverlayCard = on ? card : null;
    }
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && gsYtOverlayCard) setYtOverlay(gsYtOverlayCard, false);
    });

    function buildYouTubeCard(link, ex, info, onHide) {
        var card = document.createElement("div");
        card.className = "gs-yt-card";

        var head = document.createElement("div");
        head.className = "gs-yt-head";
        var title = document.createElement("span");
        title.className = "gs-yt-title";
        title.textContent = link.label || "YouTube";
        head.appendChild(title);

        var frame = document.createElement("div");
        frame.className = "gs-yt-frame";

        var sizeBtn = document.createElement("button");
        sizeBtn.type = "button";
        sizeBtn.className = "btn-ghost gs-yt-btn gs-yt-full-btn";
        sizeBtn.textContent = "⤢ Plein écran";
        sizeBtn.title = "Afficher la vidéo en plein écran (Échap pour en sortir)";
        var ytPlayer = null; // lecteur YouTube, une fois prêt
        // Plein écran demandé sur l'iframe de YouTube elle-même (méthode documentée) plutôt que sur notre
        // boîte autour : c'est YouTube qui reçoit alors toute la surface. L'agencement des boutons en plein
        // écran (réglages, volume…) reste dessiné par YouTube, hors de notre contrôle.
        function fsTarget() { return (ytPlayer && ytPlayer.getIframe && ytPlayer.getIframe()) || frame; }
        function inFullscreen() { var fe = document.fullscreenElement; return !!fe && (fe === frame || fe === fsTarget()); }
        function refreshSizeBtn() {
            var on = inFullscreen() || card.classList.contains("gs-yt-large");
            sizeBtn.textContent = on ? "⤡ Réduire" : "⤢ Plein écran";
        }
        sizeBtn.addEventListener("click", function () {
            if (inFullscreen()) { document.exitFullscreen(); return; }
            if (card.classList.contains("gs-yt-large")) { setYtOverlay(card, false); refreshSizeBtn(); return; }
            var ft = fsTarget();
            var req = ft.requestFullscreen ? ft.requestFullscreen() : null;
            if (req && req.catch) req.catch(function () { setYtOverlay(card, true); refreshSizeBtn(); });
            else if (!req) { setYtOverlay(card, true); refreshSizeBtn(); }
        });
        document.addEventListener("fullscreenchange", refreshSizeBtn);
        head.appendChild(sizeBtn);

        var hideBtn = document.createElement("button");
        hideBtn.type = "button";
        hideBtn.className = "btn-ghost gs-yt-btn gs-yt-hide-btn";
        hideBtn.textContent = "✕";
        hideBtn.title = "Ne plus afficher ce lien dans cette session (le lien reste dans l'exercice ; à regérer dans l'édition de la session)";
        hideBtn.setAttribute("aria-label", "Masquer cette vidéo");
        // Pas de « ✕ » dans la liste des exercices (onHide absent) : le masquage par session n'y a pas de sens.
        if (onHide) {
            hideBtn.addEventListener("click", onHide);
            head.appendChild(hideBtn);
        }
        // Interrupteur des barres : coupe aussi toute interrogation du lecteur (voir tick ci-dessous).
        var barsBtn = document.createElement("button");
        barsBtn.type = "button";
        barsBtn.className = "btn-ghost gs-yt-btn gs-yt-bars-btn";
        barsBtn.textContent = "⏱";
        barsBtn.setAttribute("aria-label", "Barres temps et volume");
        function refreshBarsBtn() {
            var on = ytBarsEnabled();
            card.classList.toggle("gs-yt-bars-off", !on);
            barsBtn.classList.toggle("gs-yt-bars-btn-on", on);
            barsBtn.title = on ? "Masquer les barres temps et volume (coupe aussi leur suivi du lecteur)" : "Afficher les barres temps et volume à droite de la vidéo";
        }
        // Réglage commun à toutes les vidéos affichées : chaque carte se met à jour (et se désabonne quand
        // elle n'est plus dans la page).
        function onBarsChange() {
            if (!card.isConnected) { document.removeEventListener("trainhub-yt-bars", onBarsChange); return; }
            refreshBarsBtn();
            tick();
        }
        document.addEventListener("trainhub-yt-bars", onBarsChange);
        barsBtn.addEventListener("click", function () {
            setYtBarsEnabled(!ytBarsEnabled());
            document.dispatchEvent(new Event("trainhub-yt-bars"));
        });
        head.insertBefore(barsBtn, head.children[1] || null);
        card.appendChild(head);

        var body = document.createElement("div");
        body.className = "gs-yt-body";
        card.appendChild(body);
        var target = document.createElement("div");
        frame.appendChild(target);
        var msg = document.createElement("div");
        msg.className = "gs-yt-msg";
        msg.hidden = true;
        frame.appendChild(msg);
        body.appendChild(frame);

        // Barre de temps + volume, à droite de la vidéo (sous elle sur écran étroit). Pour caler deux
        // vidéos l'une sur l'autre (tablature + morceau sans basse). Prudence vis-à-vis du lecteur :
        //  - lecture seule 4 fois par seconde (position, durée, volume), uniquement onglet visible et
        //    barres affichées ; aucune commande envoyée au démarrage ;
        //  - une commande n'est envoyée que quand on agit : setVolume pendant qu'on déplace le curseur,
        //    seekTo UNE fois, au relâchement de la barre de temps (comme la barre de YouTube).
        var side = document.createElement("div");
        side.className = "gs-yt-side";
        body.appendChild(side);
        function sideRow(labelText) {
            var r = document.createElement("div");
            r.className = "gs-yt-side-row";
            var head2 = document.createElement("div");
            head2.className = "gs-yt-side-head";
            var l = document.createElement("span");
            l.textContent = labelText;
            var v = document.createElement("span");
            v.className = "gs-yt-side-value";
            head2.appendChild(l);
            head2.appendChild(v);
            var range = document.createElement("input");
            range.type = "range";
            r.appendChild(head2);
            r.appendChild(range);
            side.appendChild(r);
            return { range: range, value: v };
        }
        var seekRow = sideRow("Temps");
        seekRow.range.min = "0"; seekRow.range.max = "1000"; seekRow.range.value = "0"; seekRow.range.step = "1";
        seekRow.range.className = "gs-yt-seek";
        seekRow.range.disabled = true;
        seekRow.value.textContent = "–:– / –:–";
        var volRow = sideRow("Volume");
        volRow.range.min = "0"; volRow.range.max = "100"; volRow.range.step = "1"; volRow.range.value = "100";
        volRow.range.className = "gs-yt-vol";
        volRow.range.disabled = true;
        volRow.value.textContent = "–";
        // Vitesse : de 50 % à 125 % par pas de 5 %. La commande n'est envoyée qu'UNE fois, au relâchement
        // du curseur (comme le temps) ; l'affichage suit ensuite la vitesse réellement appliquée par
        // YouTube (lue dans tick), au cas où il n'accepterait que certaines valeurs.
        var rateRow = sideRow("Vitesse");
        rateRow.range.min = "50"; rateRow.range.max = "125"; rateRow.range.step = "5"; rateRow.range.value = "100";
        rateRow.range.className = "gs-yt-rate";
        rateRow.range.disabled = true;
        rateRow.value.textContent = "–";
        // La partie « remplie » de la barre se règle via --p (pourcentage de la course).
        function fillRange(r) {
            var span = parseFloat(r.max) - parseFloat(r.min);
            r.style.setProperty("--p", (span > 0 ? (parseFloat(r.value) - parseFloat(r.min)) / span * 100 : 0) + "%");
        }
        [seekRow.range, volRow.range, rateRow.range].forEach(function (r) {
            fillRange(r);
            r.addEventListener("input", function () { fillRange(r); });
        });
        var seeking = false, volTouching = false, rateTouching = false;
        function fmtTime(sec) {
            sec = Math.max(0, Math.floor(sec || 0));
            var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
            return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (s < 10 ? "0" : "") + s;
        }
        function durationOf() { try { return ytPlayer && ytPlayer.getDuration ? (ytPlayer.getDuration() || 0) : 0; } catch (e) { return 0; } }
        seekRow.range.addEventListener("pointerdown", function () { seeking = true; });
        seekRow.range.addEventListener("input", function () {
            seeking = true; // affichage seulement pendant qu'on déplace : aucune commande au lecteur
            seekRow.value.textContent = fmtTime(seekRow.range.value / 1000 * durationOf()) + " / " + fmtTime(durationOf());
        });
        seekRow.range.addEventListener("change", function () {
            seeking = false;
            var dur = durationOf();
            if (ytPlayer && ytPlayer.seekTo && dur > 0) ytPlayer.seekTo(seekRow.range.value / 1000 * dur, true);
        });
        volRow.range.addEventListener("pointerdown", function () { volTouching = true; });
        volRow.range.addEventListener("input", function () {
            volTouching = true;
            var v = parseInt(volRow.range.value, 10);
            volRow.value.textContent = v + " %";
            if (ytPlayer && ytPlayer.setVolume) {
                if (v > 0 && ytPlayer.isMuted && ytPlayer.isMuted() && ytPlayer.unMute) ytPlayer.unMute();
                ytPlayer.setVolume(v);
            }
        });
        volRow.range.addEventListener("change", function () { volTouching = false; });
        rateRow.range.addEventListener("pointerdown", function () { rateTouching = true; });
        rateRow.range.addEventListener("input", function () {
            rateTouching = true; // affichage seulement pendant le déplacement : aucune commande
            rateRow.value.textContent = rateRow.range.value + " %";
        });
        rateRow.range.addEventListener("change", function () {
            rateTouching = false;
            if (ytPlayer && ytPlayer.setPlaybackRate) ytPlayer.setPlaybackRate(parseInt(rateRow.range.value, 10) / 100);
        });
        window.addEventListener("pointerup", function () { seeking = false; volTouching = false; rateTouching = false; });
        var tickTimer = null;
        function tick() {
            if (!card.isConnected) { clearInterval(tickTimer); tickTimer = null; return; } // carte retirée de la page
            if (!ytPlayer || !ytBarsEnabled() || document.hidden) return;
            try {
                var dur = durationOf();
                var cur = ytPlayer.getCurrentTime ? (ytPlayer.getCurrentTime() || 0) : 0;
                if (dur > 0) {
                    seekRow.range.disabled = false;
                    if (!seeking) {
                        seekRow.range.value = String(Math.min(1000, Math.round(cur / dur * 1000)));
                        fillRange(seekRow.range);
                        seekRow.value.textContent = fmtTime(cur) + " / " + fmtTime(dur);
                    }
                }
                if (!isIosDevice() && ytPlayer.getVolume) {
                    volRow.range.disabled = false;
                    if (!volTouching) {
                        var vol = (ytPlayer.isMuted && ytPlayer.isMuted()) ? 0 : ytPlayer.getVolume();
                        volRow.range.value = String(vol);
                        fillRange(volRow.range);
                        volRow.value.textContent = vol + " %";
                    }
                }
                if (ytPlayer.getPlaybackRate) {
                    rateRow.range.disabled = false;
                    if (!rateTouching) {
                        var pr = Math.round((ytPlayer.getPlaybackRate() || 1) * 100);
                        rateRow.range.value = String(Math.round(pr / 5) * 5); // borné à la course de la barre
                        fillRange(rateRow.range);
                        rateRow.value.textContent = pr + " %";
                    }
                }
            } catch (e) { /* lecteur pas encore prêt : on réessaie au prochain passage */ }
        }
        if (isIosDevice()) volRow.value.textContent = "appareil"; // iOS ignore le volume d'une page web
        refreshBarsBtn();
        card.appendChild(body);

        // Message de repli (vidéo non lisible ici, YouTube injoignable) : le seul cas où on propose un lien
        // vers YouTube, puisque le lecteur n'affiche alors pas le sien.
        function showMsg(text) {
            msg.textContent = text + " ";
            var a = document.createElement("a");
            a.href = link.url; a.target = "_blank"; a.rel = "noopener noreferrer";
            a.textContent = "Ouvrir sur YouTube";
            msg.appendChild(a);
            msg.hidden = false;
        }
        loadYouTubeApi().then(function () {
            ytPlayer = new window.YT.Player(target, {
                width: "100%", height: "100%",
                videoId: info.id,
                playerVars: { playsinline: 1, rel: 0, start: info.start || 0 },
                events: {
                    onReady: function () {
                        // Seule commande envoyée au démarrage : le volume de départ choisi dans les Paramètres
                        // (rien du tout s'il est sur « automatique »). Ni vitesse, ni déplacement.
                        var startVol = getYtStartVolume();
                        if (startVol !== null && !isIosDevice() && ytPlayer.setVolume) ytPlayer.setVolume(startVol);
                        if (!tickTimer) tickTimer = setInterval(tick, 250);
                        tick();
                    },
                    onError: function () { showMsg("Cette vidéo ne peut pas être lue ici."); }
                }
            });
        }, function () {
            showMsg("Lecteur YouTube indisponible (hors ligne ?).");
        });
        return card;
    }

    // ---------- plan de la session pendant le guidage : ordre et durées modifiables ----------
    var gsRunPlanOpen = false;
    function renderGsRunPlan(content, session) {
        var wrap = document.createElement("div");
        wrap.className = "gs-plan";
        var toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "btn-ghost gs-plan-toggle";
        toggle.textContent = (gsRunPlanOpen ? "▾" : "▸") + " Plan de la session (ordre et durées)";
        toggle.addEventListener("click", function () { gsRunPlanOpen = !gsRunPlanOpen; render(); });
        wrap.appendChild(toggle);
        if (gsRunPlanOpen) {
            var list = document.createElement("div");
            list.className = "gs-plan-list";
            session.steps.forEach(function (step, i) {
                var found = findExerciseById(step.exerciseId);
                var row = document.createElement("div");
                row.className = "gs-plan-row" + (i === gsRunStepIndex ? " gs-plan-current" : "");
                var num = document.createElement("span");
                num.className = "gs-plan-num";
                num.textContent = String(i + 1);
                row.appendChild(num);
                var name = document.createElement("button");
                name.type = "button";
                name.className = "gs-plan-name";
                name.textContent = found ? found.ex.title : "(exercice supprimé)";
                name.title = "Passer à cet exercice";
                name.addEventListener("click", function () {
                    if (i === gsRunStepIndex) return;
                    gsRunStepIndex = i;
                    gsEnterRunStep();
                    render();
                });
                row.appendChild(name);
                var mins = document.createElement("input");
                mins.type = "number"; mins.min = "1"; mins.max = "180"; mins.step = "1";
                mins.className = "gs-plan-minutes";
                mins.value = String(step.minutes);
                mins.title = "Durée (minutes), enregistrée dans la session";
                bindScrubInput(mins, 1, 180);
                mins.addEventListener("change", function () {
                    var v = Math.round(parseFloat(mins.value));
                    if (!(v >= 1)) v = step.minutes;
                    step.minutes = Math.min(180, v);
                    gsRememberMinutes(step);
                    if (i === gsRunStepIndex) gsRunAllocatedSec = step.minutes * 60;
                    save();
                    render();
                });
                row.appendChild(mins);
                var unit = document.createElement("span");
                unit.className = "gs-plan-unit";
                unit.textContent = "min";
                row.appendChild(unit);
                function mover(label, title, delta) {
                    var b = document.createElement("button");
                    b.type = "button";
                    b.className = "btn-ghost gs-plan-move";
                    b.textContent = label;
                    b.title = title;
                    b.disabled = i + delta < 0 || i + delta >= session.steps.length;
                    b.addEventListener("click", function () {
                        var j = i + delta;
                        var tmp = session.steps[i]; session.steps[i] = session.steps[j]; session.steps[j] = tmp;
                        // L'exercice en cours reste le même, où qu'il soit passé dans la liste.
                        if (gsRunStepIndex === i) gsRunStepIndex = j; else if (gsRunStepIndex === j) gsRunStepIndex = i;
                        save();
                        render();
                    });
                    return b;
                }
                row.appendChild(mover("↑", "Monter", -1));
                row.appendChild(mover("↓", "Descendre", 1));
                list.appendChild(row);
            });
            wrap.appendChild(list);
        }
        content.appendChild(wrap);
    }

    // Appelée à chaque rafraîchissement du chrono : carillon d'avertissement, puis passage au suivant.
    function gsAutoAdvanceTick(remaining, step, session) {
        if (!gsAutoAdvanceOn() || gsRunPaused || gsRunSession !== session || session.steps[gsRunStepIndex] !== step) return;
        var key = step.id + ":" + gsRunStepIndex;
        if (remaining > GS_WARN_SECONDS) { if (gsWarnKey === key + ":warn") gsWarnKey = null; return; }
        if (remaining > 0) {
            if (gsWarnKey !== key + ":warn") { gsWarnKey = key + ":warn"; playSoftChime("warn"); }
            return;
        }
        if (gsWarnKey === key + ":end") return;
        if (gsRunStepIndex < session.steps.length - 1) {
            playSoftChime("go");
            gsRunStepIndex++;
            gsEnterRunStep();
            render();
        } else {
            gsWarnKey = key + ":end";
            playSoftChime("end"); // dernier exercice : on prévient, sans fermer la session
        }
    }

    function renderGsRunScreen(content) {
        var session = gsRunSession;
        var step = session.steps[gsRunStepIndex];
        var found = findExerciseById(step.exerciseId);

        var progress = document.createElement("div");
        progress.className = "gs-run-progress";
        progress.textContent = "Exercice " + (gsRunStepIndex + 1) + " / " + session.steps.length;
        content.appendChild(progress);

        if (found) content.appendChild(gsThemeBadge(found.pathNames, found.chapterColor));

        var exTitle = document.createElement("div");
        exTitle.className = "gs-run-title";
        exTitle.textContent = found ? found.ex.title : "(exercice supprimé)";
        content.appendChild(exTitle);

        var presetNow = gsEffectiveMetronome(step, found && found.ex);
        if (presetNow) {
            var presetLine = document.createElement("div");
            presetLine.className = "gs-run-preset";
            presetLine.textContent = "♩ " + metroPresetSummary(presetNow);
            presetLine.title = "Réglage du métronome prédéfini pour cet exercice (appliqué au changement d'exercice)";
            content.appendChild(presetLine);
        }

        // Les liens/fichiers de l'exercice en cours sont visibles tout de suite (pas besoin de
        // cliquer sur "Ouvrir liens/pièces jointes", qui ne sert qu'à ouvrir d'un coup ceux de
        // TOUTE la session).
        if (step.note && step.note.trim()) {
            var noteEl = document.createElement("div");
            noteEl.className = "gs-run-note";
            noteEl.textContent = step.note.trim();
            content.appendChild(noteEl);
        }

        // Liens et fichiers de l'exercice (sauf ceux masqués pour cette session, et sauf les liens
        // YouTube déjà lisibles dans un lecteur plus bas).
        if (found) {
            var resourcesRow = document.createElement("div");
            resourcesRow.className = "links-list gs-run-resources";
            var playersOn = ytVideosShown();
            appendReadOnlyResourceChips(resourcesRow, found.ex, function (kind, obj) {
                if (gsStepHides(step, (kind === "link" ? "link:" : "file:") + obj.id)) return false;
                if (kind === "link" && playersOn && youTubeVideoInfo(obj.url)) return false;
                return true;
            });
            if (resourcesRow.children.length) content.appendChild(resourcesRow);
        }

        var timerEl = document.createElement("div");
        timerEl.className = "gs-run-timer";
        content.appendChild(timerEl);
        var totalEl = document.createElement("div");
        totalEl.className = "gs-run-total";
        totalEl.title = "Durée totale de la session (s'arrête pendant la pause)";
        content.appendChild(totalEl);

        function refreshTimer() {
            var remaining = gsRunAllocatedSec - Math.floor(gsRunElapsedNowMs() / 1000);
            var overtime = remaining < 0;
            var abs = Math.abs(remaining);
            var mm = Math.floor(abs / 60), ss = abs % 60;
            timerEl.textContent = (overtime ? "+" : "") + (mm < 10 ? "0" : "") + mm + ":" + (ss < 10 ? "0" : "") + ss;
            timerEl.classList.toggle("gs-run-timer-overtime", overtime);
            totalEl.textContent = "Total " + gsFormatTotal(gsTotalNowMs());
            gsAutoAdvanceTick(remaining, step, session);
        }
        refreshTimer();
        if (gsRunInterval) clearInterval(gsRunInterval);
        gsRunInterval = setInterval(refreshTimer, 250);

        var adjustRow = document.createElement("div");
        adjustRow.className = "gs-run-adjust-row";
        adjustRow.appendChild(iconButton("−1 min", "Retirer une minute à cet exercice (juste pour cette fois)", function () {
            gsRunAllocatedSec = Math.max(60, gsRunAllocatedSec - 60);
            refreshTimer();
            refreshKeepBtn();
        }));
        adjustRow.appendChild(iconButton("+1 min", "Ajouter une minute à cet exercice (juste pour cette fois)", function () {
            gsRunAllocatedSec += 60;
            refreshTimer();
            refreshKeepBtn();
        }));
        content.appendChild(adjustRow);

        // −1/+1 min ne valent que pour cette fois ; ce bouton (visible seulement quand la durée a
        // changé) l'enregistre dans la session pour les prochaines fois.
        var keepBtn = document.createElement("button");
        keepBtn.type = "button";
        keepBtn.className = "btn-ghost gs-run-keep-btn";
        keepBtn.hidden = true;
        function refreshKeepBtn() {
            var m = Math.max(1, Math.round(gsRunAllocatedSec / 60));
            keepBtn.hidden = m === step.minutes;
            keepBtn.textContent = "Garder " + m + " min pour les prochaines fois";
        }
        keepBtn.addEventListener("click", function () {
            step.minutes = Math.max(1, Math.round(gsRunAllocatedSec / 60));
            save();
            refreshKeepBtn();
            showToast("Durée enregistrée : " + step.minutes + " min");
            if (gsRunPlanOpen) render();
        });
        content.appendChild(keepBtn);
        refreshKeepBtn();

        var pauseStopRow = document.createElement("div");
        pauseStopRow.className = "gs-run-pausestop-row";

        var pauseBtn = document.createElement("button");
        pauseBtn.type = "button";
        pauseBtn.className = "metro-play-btn gs-run-pause-btn";
        function refreshPauseBtn() {
            pauseBtn.textContent = gsRunPaused ? "Reprendre" : "Pause";
            pauseBtn.classList.toggle("metro-play-btn-active", !gsRunPaused);
        }
        refreshPauseBtn();
        pauseBtn.title = "Pause / reprise (double appui sur espace)";
        pauseBtn.addEventListener("click", function () {
            if (gsRunPaused) gsResumeRun(); else gsPauseRun();
            refreshPauseBtn();
            refreshTimer(); // l'affichage se fige tout de suite sur la valeur exacte (pas jusqu'à 250 ms plus tard)
        });
        gsRefreshRunUi = function () { refreshPauseBtn(); refreshTimer(); };
        pauseStopRow.appendChild(pauseBtn);

        var stopBtn = document.createElement("button");
        stopBtn.type = "button";
        stopBtn.className = "gs-run-stop-btn";
        stopBtn.textContent = "Arrêter la session";
        stopBtn.title = "Arrêter la session";
        stopBtn.addEventListener("click", function () {
            if (window.confirm("Arrêter la session en cours ?")) gsEndRun();
        });
        pauseStopRow.appendChild(stopBtn);
        content.appendChild(pauseStopRow);

        var toolsRow = document.createElement("div");
        toolsRow.className = "gs-run-tools-row";
        // Accès rapide au métronome, très utilisé pendant une session — mais pas besoin qu'il
        // prenne toute la largeur.
        var metroBtn = document.createElement("button");
        metroBtn.type = "button";
        metroBtn.className = "gs-run-metro-btn";
        metroBtn.innerHTML = METRONOME_ICON_SVG + "<span>Métronome</span>";
        metroBtn.addEventListener("click", openMetronomePanel);
        toolsRow.appendChild(metroBtn);

        var linksBtn = document.createElement("button");
        linksBtn.type = "button";
        linksBtn.className = "gs-run-links-btn";
        linksBtn.innerHTML = LINK_ICONS.link;
        linksBtn.title = "Liens et pièces jointes de toute la session";
        linksBtn.setAttribute("aria-label", "Liens et pièces jointes de toute la session");
        linksBtn.addEventListener("click", function () { gsOpenLinks(gsRunSession, "run"); });
        toolsRow.appendChild(linksBtn);

        var autoBtn = document.createElement("button");
        autoBtn.type = "button";
        autoBtn.className = "gs-run-auto-btn";
        autoBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M5 4l10 8-10 8z"/><path d="M19 5v14" fill="none" stroke-linecap="round"/></svg>';
        function refreshAutoBtn() {
            var on = gsAutoAdvanceOn();
            autoBtn.classList.toggle("gs-run-auto-on", on);
            autoBtn.setAttribute("aria-pressed", on ? "true" : "false");
            autoBtn.title = on ? "Enchaînement automatique activé (carillon 10 s avant) — cliquer pour désactiver" : "Passer automatiquement à l'exercice suivant à la fin du temps (carillon 10 s avant)";
        }
        refreshAutoBtn();
        autoBtn.addEventListener("click", function () {
            setGsAutoAdvance(!gsAutoAdvanceOn());
            if (gsAutoAdvanceOn()) ensureMetroAudio(); // réveille l'audio pendant ce clic (autorisé par le navigateur)
            gsWarnKey = null;
            refreshAutoBtn();
            refreshTimer();
        });
        toolsRow.appendChild(autoBtn);
        content.appendChild(toolsRow);

        var navRow = document.createElement("div");
        navRow.className = "gs-run-nav-row";
        var prevBtn = document.createElement("button");
        prevBtn.type = "button";
        prevBtn.textContent = "← Précédent";
        prevBtn.disabled = gsRunStepIndex === 0;
        prevBtn.addEventListener("click", function () {
            gsRunStepIndex--;
            gsEnterRunStep();
            render();
        });
        var nextBtn = document.createElement("button");
        nextBtn.type = "button";
        nextBtn.className = "btn-accent";
        nextBtn.textContent = gsRunStepIndex === session.steps.length - 1 ? "Terminer" : "Suivant →";
        nextBtn.addEventListener("click", function () {
            if (gsRunStepIndex === session.steps.length - 1) {
                gsEndRun();
            } else {
                gsRunStepIndex++;
                gsEnterRunStep();
                render();
            }
        });
        navRow.appendChild(prevBtn);
        navRow.appendChild(nextBtn);
        content.appendChild(navRow);

        // Notes et liens de l'exercice (ceux de l'exercice lui-même, pas de la session) : lisibles et
        // modifiables ici, enregistrés dans l'exercice pour la prochaine fois. Dépliés d'office quand
        // l'exercice a déjà une note ; le choix de l'utilisateur est ensuite retenu.
        if (found) {
            var exDetailsOpen = gsExDetailsOpen === null ? !!(found.ex.notes && found.ex.notes.trim()) : gsExDetailsOpen;
            var detailsWrap = document.createElement("div");
            detailsWrap.className = "gs-run-exdetails";
            var detailsToggle = document.createElement("button");
            detailsToggle.type = "button";
            detailsToggle.className = "gs-run-exdetails-toggle";
            detailsToggle.setAttribute("aria-expanded", exDetailsOpen ? "true" : "false");
            var dtLabel = document.createElement("span");
            dtLabel.textContent = "Notes et liens de l'exercice";
            var dtChev = document.createElement("span");
            dtChev.className = "gs-folder-chev";
            dtChev.textContent = exDetailsOpen ? "▾" : "▸";
            detailsToggle.appendChild(dtLabel);
            detailsToggle.appendChild(dtChev);
            detailsWrap.appendChild(detailsToggle);
            var runPaths = gsExercisePathLines(found);
            if (runPaths) detailsWrap.appendChild(runPaths);
            var detailsBody = null;
            function showDetails(open) {
                exDetailsOpen = open;
                if (runPaths) runPaths.hidden = !open;
                detailsToggle.setAttribute("aria-expanded", open ? "true" : "false");
                dtChev.textContent = open ? "▾" : "▸";
                if (open && !detailsBody) {
                    detailsBody = renderExerciseDetails(found.ex);
                    detailsWrap.appendChild(detailsBody);
                    var ta = detailsBody.querySelector(".notes-textarea");
                    if (ta) autoGrowNotes(ta);
                }
                if (detailsBody) detailsBody.hidden = !open;
            }
            detailsToggle.addEventListener("click", function () {
                gsExDetailsOpen = !exDetailsOpen;
                showDetails(gsExDetailsOpen);
            });
            content.appendChild(detailsWrap);
            showDetails(exDetailsOpen);
        }

        // Lecteurs YouTube des liens de l'exercice en cours (volume/vitesse retenus par lien).
        if (found) {
            // Plusieurs liens YouTube : les lecteurs se suivent, les uns sous les autres.
            // (un lecteur à l'écran : la colonne de guidage s'élargit un peu, voir .gs-main-wide)
            var hiddenVideos = [];
            var ytLinks = (found.ex.links || []).filter(function (link) { return !!youTubeVideoInfo(link.url); });
            var ytShown = ytVideosShown();
            if (ytLinks.length) {
                // Un clic affiche/masque toutes les vidéos de la session (masquées : rien n'est chargé).
                var ytToggle = document.createElement("button");
                ytToggle.type = "button";
                ytToggle.className = "btn-ghost gs-yt-toggle";
                ytToggle.textContent = (ytShown ? "▾ " : "▸ ") + "Vidéos YouTube (" + ytLinks.length + ") — " + (ytShown ? "masquer" : "afficher");
                ytToggle.title = "Afficher ou masquer les lecteurs YouTube de la session";
                ytToggle.addEventListener("click", function () { setYtVideosShown(!ytShown); render(); });
                content.appendChild(ytToggle);
            }
            if (ytShown) ytLinks.forEach(function (link) {
                var info = youTubeVideoInfo(link.url);
                if (gsStepHides(step, "link:" + link.id)) { hiddenVideos.push(link); return; }
                content.classList.add("gs-main-wide");
                content.appendChild(buildYouTubeCard(link, found.ex, info, function () {
                    gsSetStepHidden(step, "link:" + link.id, true);
                    save();
                    render();
                }));
            });
            if (ytShown && hiddenVideos.length) {
                var hiddenRow = document.createElement("div");
                hiddenRow.className = "gs-yt-hidden";
                hiddenVideos.forEach(function (link) {
                    var showBtn = document.createElement("button");
                    showBtn.type = "button";
                    showBtn.className = "btn-ghost gs-yt-show-btn";
                    showBtn.textContent = "▶ Réafficher « " + (link.label || "YouTube") + " »";
                    showBtn.title = "Réafficher cette vidéo dans la session";
                    showBtn.addEventListener("click", function () {
                        gsSetStepHidden(step, "link:" + link.id, false);
                        save();
                        render();
                    });
                    hiddenRow.appendChild(showBtn);
                });
                content.appendChild(hiddenRow);
            }
        }
        // Images de l'exercice (captures de partition), petites sous les vidéos ; masquées de base,
        // un clic sur la barre les affiche (choix retenu), un clic sur une vignette l'agrandit.
        if (found && (found.ex.images || []).length) {
            var imgShown = imagesShownInSession();
            var imgToggle = document.createElement("button");
            imgToggle.type = "button";
            imgToggle.className = "btn-ghost gs-yt-toggle gs-img-toggle";
            imgToggle.textContent = (imgShown ? "▾ " : "▸ ") + "Images (" + found.ex.images.length + ") — " + (imgShown ? "masquer" : "afficher");
            imgToggle.title = "Afficher ou masquer les images de l'exercice";
            imgToggle.addEventListener("click", function () { setImagesShownInSession(!imgShown); render(); });
            content.appendChild(imgToggle);
            if (imgShown) content.appendChild(buildImageStrip(found.ex, "gs", false));
        }
        renderGsRunPlan(content, session);
    }

    // ---- écran "ouvrir des liens/pièces jointes" (tous les exercices de la session) ----
    function renderGsLinksScreen(content) {
        var session = gsLinksSession;
        var fromRun = gsLinksBack === "run";

        var backBtn = document.createElement("button");
        backBtn.type = "button";
        backBtn.className = "btn-ghost gs-back-btn";
        backBtn.textContent = fromRun ? "← Retour au guidage" : gsLinksBack === "edit" ? "← Retour à la session" : "← Retour à la liste";
        backBtn.addEventListener("click", function () { gsScreen = gsLinksBack; render(); });
        content.appendChild(backBtn);

        var heading = document.createElement("div");
        heading.className = "section-label";
        heading.textContent = "Liens et pièces jointes";
        content.appendChild(heading);

        var allItems = [];
        var list = document.createElement("div");
        list.className = "gs-links-list";
        session.steps.forEach(function (step) {
            var found = findExerciseById(step.exerciseId);
            if (!found) return;
            var items = gsExerciseItems(found.ex);
            if (!items.length) return;
            // Pièces jointes lues dès l'affichage : le clic sur "Ouvrir" n'a alors plus rien
            // d'asynchrone à attendre (voir gsOpenItems).
            items.forEach(function (item) {
                if (item.type !== "file" || item.meta.id in gsFileBlobCache) return;
                getFileBlob(item.meta.id).then(function (b) { gsFileBlobCache[item.meta.id] = b || false; }, function () { gsFileBlobCache[item.meta.id] = false; });
            });

            var group = document.createElement("div");
            group.className = "gs-links-group";
            var groupTitle = document.createElement("div");
            groupTitle.className = "gs-links-group-title";
            groupTitle.textContent = found.ex.title;
            group.appendChild(groupTitle);

            items.forEach(function (item) {
                var row = document.createElement("label");
                row.className = "gs-links-item";
                var cb = document.createElement("input");
                cb.type = "checkbox";
                if (gsLinksChecked[item.key] === undefined) gsLinksChecked[item.key] = true;
                cb.checked = gsLinksChecked[item.key];
                cb.addEventListener("change", function () { gsLinksChecked[item.key] = cb.checked; });
                row.appendChild(cb);
                var span = document.createElement("span");
                span.textContent = item.label;
                row.appendChild(span);
                group.appendChild(row);
                allItems.push(item);
            });
            list.appendChild(group);
        });

        if (!allItems.length) {
            var empty = document.createElement("div");
            empty.className = "gs-empty";
            empty.textContent = "Aucun lien ni pièce jointe dans cette session.";
            content.appendChild(empty);
            return;
        }
        content.appendChild(list);

        function selectedItems() {
            return allItems.filter(function (item) { return gsLinksChecked[item.key]; });
        }
        var openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = fromRun || !session.steps.length ? "btn-accent gs-links-open-btn" : "btn-ghost gs-links-open-btn gs-links-open-only-btn";
        openBtn.textContent = "Ouvrir la sélection";
        openBtn.addEventListener("click", function () { gsOpenItems(selectedItems()); });
        content.appendChild(openBtn);

        // Avant le lancement : tout ouvrir puis démarrer d'un seul geste.
        if (!fromRun && session.steps.length) {
            var openAndRunBtn = document.createElement("button");
            openAndRunBtn.type = "button";
            openAndRunBtn.className = "btn-accent gs-links-open-run-btn";
            openAndRunBtn.textContent = "Ouvrir la sélection et lancer la session";
            openAndRunBtn.addEventListener("click", function () {
                gsOpenItems(selectedItems());
                gsStartRun(session);
            });
            content.appendChild(openAndRunBtn);
        }
    }

    // Une session en cours ne doit pas continuer à décompter pendant qu'on est ailleurs (un autre
    // onglet, une appli, l'écran verrouillé) : on la met en pause dès que la page n'est plus
    // visible. Reprise toujours manuelle (bouton Reprendre), pour ne pas relancer le chrono par
    // surprise au retour.
    document.addEventListener("visibilitychange", function () {
        if (document.hidden && gsRunSession && !gsRunPaused) {
            gsPauseRun();
            // Pas de render() ici : reconstruire l'écran détruirait les lecteurs YouTube en cours.
            if (guidedSessionViewActive && gsScreen === "run" && gsRefreshRunUi) gsRefreshRunUi();
        }
    });

    // ---------- raccourci clavier : barre espace ----------
    // Quand la session guidée ET le métronome sont présents :
    //   - un appui sur Espace = pause / reprise du MÉTRONOME ;
    //   - deux appuis brefs et rapprochés = pause / reprise de la SESSION (son chrono).
    // Pour ne pas confondre les deux, le premier appui attend SPACE_DOUBLE_MS : si un second arrive
    // dans ce délai c'est un double appui (le métronome n'a alors pas bougé), sinon c'est un simple appui.
    // 300 ms : assez large pour un double appui naturel, assez court pour que le métronome ne semble
    // pas réagir avec retard. Quand un seul des deux est présent, il n'y a rien à départager : un appui
    // agit tout de suite sur lui.
    var SPACE_DOUBLE_MS = 300;
    var spaceTapTimer = null;
    var spaceKeyHandled = false;  // vrai entre le keydown pris en charge et son keyup (voir plus bas)

    function transportSessionPresent() { return !!gsRunSession && guidedSessionViewActive; }
    function transportToggleSession() {
        if (!transportSessionPresent()) return;
        if (gsRunPaused) gsResumeRun(); else gsPauseRun();
        transportLastTouched = "session";
        if (gsRefreshRunUi) gsRefreshRunUi();
    }
    function transportToggleMetro() {
        if (metroPanelApi) metroPanelApi.toggle();
        if (gsRefreshRunUi) gsRefreshRunUi();
    }

    function transportSpaceTap() {
        var sessionOn = transportSessionPresent();
        var metroOn = !!metroPanelApi;
        if (!sessionOn && !metroOn) return;
        if (!(sessionOn && metroOn)) {
            if (sessionOn) transportToggleSession(); else transportToggleMetro();
            return;
        }
        if (spaceTapTimer) { // second appui dans le délai : double appui = session
            clearTimeout(spaceTapTimer);
            spaceTapTimer = null;
            transportToggleSession();
            return;
        }
        spaceTapTimer = setTimeout(function () {
            spaceTapTimer = null;
            transportToggleMetro();
        }, SPACE_DOUBLE_MS);
    }

    // Espace n'a de sens ici que hors saisie de texte : dans un champ, une liste, une case à cocher
    // ou une case du pavé rythmique (qui s'active à l'Espace au clavier), il garde son rôle habituel.
    function spaceKeyBelongsToTarget(el) {
        if (!el || !el.tagName) return false;
        var tag = el.tagName.toLowerCase();
        if (tag === "textarea" || tag === "select" || el.isContentEditable) return true;
        if (tag === "input") {
            var type = (el.type || "text").toLowerCase();
            return ["button", "range", "submit", "reset", "image"].indexOf(type) === -1;
        }
        return !!(el.closest && el.closest(".metro-step"));
    }
    // Pas de raccourci quand une autre fenêtre (réglages, accordeur, gammes…) ou un menu est ouvert
    // par-dessus : l'Espace ne doit pas agir sur la session qu'on ne voit plus.
    function spaceKeyBlockedByOverlay() {
        if (closeActiveModal && activeModalKind !== "metronome-panel") return true;
        return !!document.querySelector(".ctx-menu, .img-lightbox");
    }
    function isSpaceKeyEvent(e) { return e.code === "Space" || e.key === " " || e.key === "Spacebar"; }

    document.addEventListener("keydown", function (e) {
        if (!isSpaceKeyEvent(e) || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing) return;
        if (!transportSessionPresent() && !metroPanelApi) return;
        if (spaceKeyBelongsToTarget(e.target) || spaceKeyBlockedByOverlay()) return;
        // preventDefault : sinon un bouton qui a le focus (Pause, +, Suivant…) serait aussi "cliqué" par
        // l'Espace, et la page défilerait.
        e.preventDefault();
        if (e.repeat) return;
        spaceKeyHandled = true;
        transportSpaceTap();
    }, true);
    // Certains navigateurs (Firefox) déclenchent le clic du bouton au relâchement de la touche :
    // on annule donc aussi le keyup d'un Espace déjà pris en charge.
    document.addEventListener("keyup", function (e) {
        if (spaceKeyHandled && isSpaceKeyEvent(e)) { spaceKeyHandled = false; e.preventDefault(); }
    }, true);

    var $metronomeBtn = document.getElementById("metronome-btn");
    if ($metronomeBtn) $metronomeBtn.addEventListener("click", openMetronomePanel);
    var $aidesBtn = document.getElementById("aides-btn");
    if ($aidesBtn) $aidesBtn.addEventListener("click", openAidesPanel);
    var $scalesBtn = document.getElementById("scales-btn");
    if ($scalesBtn) $scalesBtn.addEventListener("click", openScalesPanel);
    var $tunerBtn = document.getElementById("tuner-btn");
    if ($tunerBtn) $tunerBtn.addEventListener("click", openTunerPanel);
    var $guidedSessionBtn = document.getElementById("guided-session-btn");
    if ($guidedSessionBtn) $guidedSessionBtn.addEventListener("click", function () {
        guidedSessionViewActive = !guidedSessionViewActive;
        $guidedSessionBtn.classList.toggle("active", guidedSessionViewActive);
        if (!guidedSessionViewActive && gsRunInterval) { clearInterval(gsRunInterval); gsRunInterval = null; }
        render();
    });
    var $settingsBtn = document.getElementById("settings-btn");
    if ($settingsBtn) $settingsBtn.addEventListener("click", openSettingsPanel);

    // ---------- init ----------
    render();

    if ("serviceWorker" in navigator) {
        window.addEventListener("load", function () {
            // Une nouvelle version s'installe en arrière-plan mais n'est utilisée qu'au rechargement suivant :
            // on prévient (sans recharger d'autorité, ce qui couperait le métronome ou une session).
            var hadController = !!navigator.serviceWorker.controller;
            navigator.serviceWorker.addEventListener("controllerchange", function () {
                if (!hadController || document.querySelector(".update-banner")) return;
                var bar = document.createElement("div");
                bar.className = "update-banner";
                var txt = document.createElement("span");
                txt.textContent = "Une nouvelle version de TrainHub est prête.";
                var reload = document.createElement("button");
                reload.type = "button";
                reload.className = "btn-accent";
                reload.textContent = "Recharger";
                reload.addEventListener("click", function () { window.location.reload(); });
                var later = document.createElement("button");
                later.type = "button";
                later.className = "btn-ghost";
                later.textContent = "Plus tard";
                later.addEventListener("click", function () { bar.remove(); });
                bar.appendChild(txt); bar.appendChild(reload); bar.appendChild(later);
                document.body.appendChild(bar);
            });
            navigator.serviceWorker.register("sw.js").catch(function () {});
        });
    }
})();
