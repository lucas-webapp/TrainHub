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
    var TAGS_VIEW_ID = "__tags__";

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

    function makeInstrument(name, palette) {
        var pal = palette || COLOR_SCHEMES.default.colors;
        var categories = DEFAULT_CATEGORIES.map(function (catName, i) {
            return makeFolder(catName, pal[i % pal.length]);
        });
        return { id: uid(), name: name, categories: categories };
    }

    function makeDefaultState() {
        var instruments = DEFAULT_INSTRUMENTS.map(makeInstrument);
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
            // Remplace les statuts (à faire/en cours/terminé/à revoir), jugés trop compliqués au
            // quotidien : juste deux cases à cocher, accessibles par clic droit/appui long.
            if (typeof ex.favorite !== "boolean") ex.favorite = false;
            if (typeof ex.archived !== "boolean") ex.archived = false;
            if (!Array.isArray(ex.tags)) ex.tags = [];
            ex.tags = ex.tags.filter(function (t) { return TAGS.hasOwnProperty(t); });
        });
    }

    // Étiquettes prédéfinies posables sur un exercice (clic droit), simple classification en plus
    // des dossiers/favoris/archivés — pas de filtre dédié dessus, juste un repère visuel discret.
    var TAGS = {
        difficile: { label: "Difficile", color: "#f87171" },
        prioritaire: { label: "Prioritaire", color: "#fb923c" },
        termine: { label: "Terminé", color: "#4ade80" },
        arevoir: { label: "À revoir", color: "#60a5fa" }
    };

    // Ordre d'affichage des chapitres (bandeau mobile + arborescence), synchronisé : mélange les
    // vrais chapitres et les chapitres virtuels (Favoris, Archivés), tous glissables ensemble. Par
    // défaut (ou pour un instrument créé avant cette version), les virtuels sont en tête et les
    // vrais chapitres suivent dans leur ordre existant — rien ne bouge visuellement.
    function normalizePinnedOrder(inst) {
        var validIds = [FAVORITES_ID, ARCHIVED_ID, TAGS_VIEW_ID].concat(inst.categories.map(function (c) { return c.id; }));
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
        s.settings.guidedSessions.forEach(function (gs) {
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
        return s;
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

    // ---------- corbeille ----------
    // Filet de sécurité en plus d'annuler/rétablir : un élément supprimé (exercice/dossier/session)
    // reste récupérable ici même après d'autres actions qui auraient fait sortir l'annulation de
    // portée. Les fichiers joints d'un exercice mis à la corbeille restent en IndexedDB tant qu'il
    // n'est pas purgé (évincé par la limite ou supprimé définitivement) — sinon les rouvrir après
    // restauration échouerait.
    function filesOf(entry) {
        if (entry.type === "exercise") return entry.data.files || [];
        if (entry.type === "folder") {
            var files = [];
            function walk(f) {
                (f.exercises || []).forEach(function (ex) { files = files.concat(ex.files || []); });
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
    var TAG_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.6 12.3 12.3 20.6a2 2 0 0 1-2.8 0l-7-7a2 2 0 0 1 0-2.8L10.9 2.5a2 2 0 0 1 1.4-.6H19a2 2 0 0 1 2 2v6.9a2 2 0 0 1-.4 1.4Z"/><circle cx="16.5" cy="7.5" r="1.5" fill="currentColor" stroke="none"/></svg>';
    var FILE_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05 12.25 20.24a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';
    var METRONOME_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 21 10 4h4l3 17Z"/><path d="M12 4V2.3"/><path d="M12 18 15.2 6.5"/><circle cx="14.1" cy="10.8" r="1.3" fill="currentColor" stroke="none"/></svg>';
    var METRO_PLAY_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5Z"/></svg>';
    var METRO_STOP_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
    var METRO_VOLUME_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10Z"/><path d="M17 9a4.5 4.5 0 0 1 0 6"/><path d="M19.5 6.5a8.5 8.5 0 0 1 0 11"/></svg>';
    var METRO_MORE_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/></svg>';
    var METRO_CHRONO_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2h4"/><path d="M12 6v0"/><circle cx="12" cy="14" r="8"/><path d="M12 14V9.5"/><path d="M17.5 5.5l1.5-1.5"/></svg>';
    var RESET_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';

    function linkIconSvg(label) {
        var l = (label || "").toLowerCase();
        if (l.indexOf("youtube") !== -1) return LINK_ICONS.youtube;
        if (l.indexOf("ireal") !== -1) return LINK_ICONS.note;
        if (l.indexOf("pdf") !== -1) return LINK_ICONS.pdf;
        if (l.indexOf("mp3") !== -1 || l.indexOf("audio") !== -1) return LINK_ICONS.audio;
        return LINK_ICONS.link;
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
            tags: (ex.tags || []).slice(),
            links: cloneLinksForDuplicate(ex.links),
            files: cloneFilesForDuplicate(ex.files),
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

        var tagsSep = document.createElement("div");
        tagsSep.className = "ctx-title";
        tagsSep.textContent = "Étiquettes";
        menu.appendChild(tagsSep);
        Object.keys(TAGS).forEach(function (key) {
            var active = ex.tags.indexOf(key) !== -1;
            menu.appendChild(menuButton((active ? "✓ " : "") + TAGS[key].label, "", function () {
                var i = ex.tags.indexOf(key);
                if (i === -1) ex.tags.push(key); else ex.tags.splice(i, 1);
                touchExercise(ex);
                save();
                closeFolderMenu();
                render();
            }));
        });

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
                var target = under && under.closest ? under.closest("[data-drop-folder-id]") : null;
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
                opts.onDropOnTarget(droppedEl, dropTarget.dataset.dropFolderId, r.right, r.top + r.height / 2);
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
        if (path[0] === FAVORITES_ID || path[0] === ARCHIVED_ID || path[0] === TAGS_VIEW_ID) return;
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
        var accent = path[0] === FAVORITES_ID ? "#ffd60a" : path[0] === ARCHIVED_ID ? "#9ca3af" : path[0] === TAGS_VIEW_ID ? (TAGS[tagsViewSelectedTag] || {}).color || "#60a5fa" : ((rootChapter && rootChapter.color) || "#00e676");
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
        var name = window.prompt("Renommer l'instrument :", inst.name);
        if (name === null) return;
        name = name.trim();
        if (!name) {
            if (state.instruments.length <= 1) return;
            if (!window.confirm("Supprimer l'instrument « " + inst.name + " » et tous ses exercices ?")) return;
            state.instruments = state.instruments.filter(function (i) { return i.id !== instrumentId; });
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
        if (kind === TAGS_VIEW_ID) return { id: TAGS_VIEW_ID, name: "Étiquettes", color: "#60a5fa", icon: TAG_ICON_SVG, cls: "virtual-tags" };
        return { id: FAVORITES_ID, name: "Favoris", color: "#ffd60a", icon: STAR_FILLED_SVG, cls: "virtual-favorites" };
    }

    function orderedChapterItems(inst) {
        normalizePinnedOrder(inst);
        return inst.pinnedOrder.map(function (id) {
            if (id === FAVORITES_ID || id === ARCHIVED_ID || id === TAGS_VIEW_ID) return virtualChapterMeta(id);
            return findById(inst.categories, id);
        }).filter(Boolean);
    }

    function renderChapterBar() {
        var inst = getActiveInstrument();
        $chapterBar.innerHTML = "";
        var path = getNavPath(inst);
        var activeId = path[0];

        orderedChapterItems(inst).forEach(function (item) {
            var isVirtual = item.id === FAVORITES_ID || item.id === ARCHIVED_ID || item.id === TAGS_VIEW_ID;
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
            if (item.id === FAVORITES_ID || item.id === ARCHIVED_ID || item.id === TAGS_VIEW_ID) {
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
        if (path[0] === FAVORITES_ID || path[0] === ARCHIVED_ID || path[0] === TAGS_VIEW_ID) {
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
    // Étiquette actuellement choisie dans la vue "Étiquettes" (non synchronisée, juste l'état
    // d'affichage en cours — comme treeExpanded/navPaths).
    var tagsViewSelectedTag = Object.keys(TAGS)[0];

    function renderVirtualChapterView(inst, kind) {
        $contentHeading.innerHTML = "";
        var h2 = document.createElement("h2");
        h2.textContent = kind === ARCHIVED_ID ? "Archivés" : kind === TAGS_VIEW_ID ? "Étiquettes" : "★ Favoris";
        $contentHeading.appendChild(h2);

        if (kind === TAGS_VIEW_ID) {
            // Une seule vue "Étiquettes" avec un sélecteur, plutôt qu'un chapitre virtuel par
            // étiquette : ajouter de nouvelles étiquettes plus tard n'encombrera pas le bandeau.
            var tagsRow = document.createElement("div");
            tagsRow.className = "tags-view-row";
            Object.keys(TAGS).forEach(function (key) {
                var tag = TAGS[key];
                var chip = document.createElement("button");
                chip.type = "button";
                chip.className = "tags-view-chip" + (key === tagsViewSelectedTag ? " tags-view-chip-active" : "");
                chip.textContent = tag.label;
                chip.style.borderColor = tag.color;
                if (key === tagsViewSelectedTag) {
                    chip.style.color = tag.color;
                    chip.style.background = "color-mix(in srgb, " + tag.color + " 14%, transparent)";
                }
                chip.addEventListener("click", function () { tagsViewSelectedTag = key; render(); });
                tagsRow.appendChild(chip);
            });
            $contentHeading.appendChild(tagsRow);
        }

        var results, emptyText;
        if (kind === ARCHIVED_ID) {
            results = collectExercises(inst, function (ex) { return ex.archived; });
            emptyText = "Aucun exercice archivé pour l'instant. Range-en un depuis son menu (clic droit ou appui long dessus).";
        } else if (kind === TAGS_VIEW_ID) {
            results = collectExercises(inst, function (ex) { return !ex.archived && ex.tags.indexOf(tagsViewSelectedTag) !== -1; });
            emptyText = "Aucun exercice étiqueté « " + TAGS[tagsViewSelectedTag].label + " » pour l'instant.";
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
        currentFolder.exercises.filter(function (ex) { return !ex.archived; }).forEach(function (ex) {
            exercisesWrap.appendChild(renderExercise(currentFolder, ex, true));
        });
        exGroup.appendChild(exercisesWrap);
        setupDragReorder(exercisesWrap, ".exercise", function () { return currentFolder.exercises; }, "y", {
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
                tags: [],
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

        (ex.tags || []).forEach(function (key) {
            var tag = TAGS[key];
            if (!tag) return;
            var tagBadge = document.createElement("span");
            tagBadge.className = "exercise-tag-badge";
            tagBadge.textContent = tag.label;
            tagBadge.style.color = tag.color;
            tagBadge.style.borderColor = tag.color;
            row.appendChild(tagBadge);
        });

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
        icon.innerHTML = linkIconSvg(link.label);
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
                window.open(link.url, "_blank", "noopener,noreferrer");
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
            ex.notes = value;
            touchExercise(ex);
        }, notesStatus, {
            onLeave: function () {
                var text = ex.notes || "";
                askApplyToSameNamed(ex, text.trim() ? "Remplacer leur note par celle-ci ?" : "Effacer aussi leur note ?",
                    function (o) { return (o.notes || "") !== text; },
                    function (o) { o.notes = text; });
            }
        });
        details.appendChild(notesLabel);
        details.appendChild(notes);

        // Liens et fichiers regroupés sous un seul intitulé : un titre plus court, une seule liste
        // de puces mélangées, une seule ligne d'ajout — moins de texte à l'écran.
        var resourcesLabel = document.createElement("div");
        resourcesLabel.className = "section-label";
        resourcesLabel.textContent = "Liens & fichiers";
        details.appendChild(resourcesLabel);

        var resourcesList = document.createElement("div");
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
            iconSpan.innerHTML = linkIconSvg(link.label);
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
            resourcesList.appendChild(chip);
        });
        appendFileChips(resourcesList, ex);
        details.appendChild(resourcesList);

        // Vidéos YouTube de l'exercice : TOUJOURS masquées de base (un lecteur intégré est lourd : rien
        // n'est chargé tant qu'on n'a pas cliqué), en petit, et seulement dans l'exercice déplié.
        // Replier l'exercice referme aussi les vidéos (voir renderExercise).
        var exYtLinks = (ex.links || []).filter(function (l) { return !!youTubeVideoInfo(l.url); });
        if (exYtLinks.length) {
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
        details.appendChild(addLinkRow);

        return details;
    }

    function fileKindIcon(mimeOrName) {
        var isAudio = /audio|\.mp3$/i.test(mimeOrName);
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
            iconSpan.innerHTML = fileKindIcon(meta.type || meta.name);
            chip.appendChild(iconSpan);

            var openBtn = document.createElement("button");
            openBtn.type = "button";
            openBtn.className = "file-open";
            function fileCaption() { return meta.name + (meta.size ? " · " + humanFileSize(meta.size) : ""); }
            openBtn.textContent = fileCaption();
            openBtn.addEventListener("click", function () {
                getFileBlob(meta.id).then(function (blob) {
                    if (!blob) {
                        window.alert("Ce fichier n'est disponible que sur l'appareil où il a été ajouté (« " + meta.name + " »).");
                        return;
                    }
                    var url = URL.createObjectURL(blob);
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
        fileInput.accept = ".pdf,application/pdf,.mp3,audio/*";
        fileInput.multiple = true;
        var fileBtn = svgIconButton(FILE_ICON_SVG, "Ajouter un fichier (PDF, MP3…) — reste sur cet appareil", function () { fileInput.click(); });
        fileBtn.classList.add("btn-ghost");
        fileInput.addEventListener("change", function () {
            var files = Array.prototype.slice.call(fileInput.files || []);
            if (!files.length) return;
            ex.files = ex.files || [];
            Promise.all(files.map(function (file) {
                var id = uid();
                return storeFileBlob(id, file).then(function () {
                    ex.files.push({ id: id, name: file.name, type: file.type, size: file.size, addedAt: Date.now() });
                });
            })).then(function () {
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
        var name = window.prompt("Nom du nouvel instrument :");
        if (!name) return;
        var inst = makeInstrument(name.trim(), currentPalette());
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

    document.getElementById("export-btn").addEventListener("click", function () {
        downloadJson(state, "trainhub-sauvegarde-" + new Date().toISOString().slice(0, 10) + ".json");
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
    var closeDockedMetronome = null; // non nul tant que le métronome est dans le volet
    var metroDockCollapsed = false;  // volet réduit (en-tête + Jouer seulement) : retenu le temps de la page
    function updateMetroDockMetrics() {
        var root = document.documentElement;
        var bar = document.querySelector(".top-bar");
        if (bar) root.style.setProperty("--topbar-h", bar.offsetHeight + "px");
        if ($metroDock && !$metroDock.hidden) root.style.setProperty("--metro-dock-h", $metroDock.offsetHeight + "px");
    }
    function attachMetroDock(panel) {
        $metroDock.appendChild(panel);
        $metroDock.hidden = false;
        document.documentElement.classList.add("metro-docked");
        updateMetroDockMetrics();
    }
    function releaseMetroDock() {
        closeDockedMetronome = null;
        if ($metroDock) $metroDock.hidden = true;
        document.documentElement.classList.remove("metro-docked");
        document.documentElement.style.removeProperty("--metro-dock-h");
    }
    window.addEventListener("resize", updateMetroDockMetrics);
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
        if (m.progressive.version !== 2) {
            m.progressive.version = 2;
            m.progressive.incrementBpm = 1;
            m.progressive.everySeconds = 20;
            delete m.progressive.everyMeasures;
        }
        if (typeof m.progressive.incrementBpm !== "number" || isNaN(m.progressive.incrementBpm) || m.progressive.incrementBpm <= 0) m.progressive.incrementBpm = 1;
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
    var transportLastTouched = null; // "session" | "metro" : le dernier des deux lancé/arrêté, voir le raccourci Espace
    var metroTempoCallback = null; // prévenu quand le tempo progressif change le BPM (met l'affichage à jour)
    var metroProgNextAt = null;    // instant (horloge audio) de la prochaine augmentation du tempo progressif
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

    function metroScheduler() {
        var m = state.settings.metronome;
        while (metroNextNoteTime < metroAudioCtx.currentTime + METRO_SCHEDULE_AHEAD_S) {
            // Relu à chaque pas : changer de formule ou basculer "…" pendant la lecture prend effet
            // tout de suite, sans pas fantôme au-delà de la nouvelle longueur de motif.
            var layer = metroActiveLayer(m);
            var stepCount = Math.max(1, layer.pattern.length);
            if (metroCurrentStep >= stepCount) metroCurrentStep = 0;
            metroClick(metroNextNoteTime, layer.pattern[metroCurrentStep]);
            if (metroBeatCallback) {
                var step = metroCurrentStep, delayMs = Math.max(0, (metroNextNoteTime - metroAudioCtx.currentTime) * 1000);
                setTimeout(function () { if (metroPlaying && metroBeatCallback) metroBeatCallback(step); }, delayMs);
            }
            // Tempo progressif : mesuré sur l'horloge audio (temps écoulé réel de la lecture), donc le
            // rythme d'augmentation reste le même quel que soit le tempo.
            if (m.progressive.enabled) {
                if (metroProgNextAt === null) metroProgNextAt = metroNextNoteTime + m.progressive.everySeconds;
                while (metroNextNoteTime >= metroProgNextAt) {
                    m.bpm = Math.min(300, m.bpm + m.progressive.incrementBpm);
                    metroProgNextAt += m.progressive.everySeconds;
                    persist();
                    if (metroTempoCallback) metroTempoCallback();
                }
            } else {
                metroProgNextAt = null;
            }
            var secondsPerStep = 60 / m.bpm / layer.subdivision;
            metroNextNoteTime += secondsPerStep;
            metroCurrentStep = (metroCurrentStep + 1) % stepCount;
        }
        metroTimer = setTimeout(metroScheduler, METRO_LOOKAHEAD_MS);
    }

    function startMetronome() {
        if (metroPlaying) return;
        ensureMetroAudio();
        metroPlaying = true;
        metroCurrentStep = 0;
        metroProgNextAt = null; // le décompte du tempo progressif repart à chaque lancement
        metroNextNoteTime = metroAudioCtx.currentTime + 0.05;
        metroScheduler();
    }

    function stopMetronome() {
        metroPlaying = false;
        if (metroTimer) { clearTimeout(metroTimer); metroTimer = null; }
    }

    function openMetronomePanel() {
        // Déjà dans le volet : le bouton fait bascule (referme), plutôt que de ne rien faire.
        if (closeDockedMetronome) { closeDockedMetronome(); return; }
        var m = state.settings.metronome;
        var a = state.settings.appearance;
        var extraClass = "metronome-panel metro-pos-" + a.metronomePosition + " metro-size-" + a.metronomeSize;
        // Pendant une session guidée : écran scindé (session + métronome côte à côte) plutôt qu'une
        // fenêtre par-dessus la session.
        var docked = guidedSessionViewActive && !!$metroDock;

        var closeFn = openModal(extraClass, function (panel, close) {
            // -- en-tête : titre + volume (bien visible, en haut à droite) --
            var headerRow = document.createElement("div");
            headerRow.className = "metro-header-row";
            var title = document.createElement("div");
            title.className = "backups-title";
            title.textContent = "Métronome";
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
            headerRow.appendChild(volumeBtn);
            panel.appendChild(headerRow);
            volumeRow.appendChild(volumeSlider);
            panel.appendChild(volumeRow);

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
            var bpmUnit = document.createElement("div");
            bpmUnit.className = "metro-dial-unit";
            bpmUnit.textContent = "BPM";
            dial.appendChild(bpmValue);
            dial.appendChild(bpmUnit);

            var bpmUp = iconButton("+", "Accélérer", function () { setBpm(m.bpm + 1); });
            bpmUp.classList.add("metro-bpm-btn");
            var bpmUp10 = iconButton("+10", "Accélérer de 10", function () { setBpm(m.bpm + 10); });
            bpmUp10.classList.add("metro-bpm-btn", "metro-bpm-step10");
            transportRow.appendChild(bpmDown10);
            transportRow.appendChild(bpmDown);
            transportRow.appendChild(dial);
            transportRow.appendChild(bpmUp);
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
            tapBtn.className = "metro-mini-btn metro-tap-btn";
            tapBtn.textContent = "Tap";
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
            toolsRow.appendChild(tapBtn);

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
            var progToggle = document.createElement("button");
            progToggle.type = "button";
            progToggle.className = "metro-mini-btn metro-progressive-toggle";
            progToggle.textContent = "Progressif";
            toolsRow.appendChild(progToggle);

            var progFields = document.createElement("div");
            progFields.className = "metro-progressive-fields";
            panel.appendChild(progFields);

            var progIncField = document.createElement("label");
            progIncField.className = "metro-progressive-field";
            progIncField.textContent = "+ BPM";
            var progIncInput = document.createElement("input");
            progIncInput.type = "number";
            progIncInput.min = "1";
            progIncInput.max = "50";
            progIncInput.value = m.progressive.incrementBpm;
            progIncInput.addEventListener("change", function () {
                m.progressive.incrementBpm = Math.max(1, parseInt(progIncInput.value, 10) || 1);
                progIncInput.value = m.progressive.incrementBpm;
                save();
            });
            progIncField.appendChild(progIncInput);
            progFields.appendChild(progIncField);

            var progEveryField = document.createElement("label");
            progEveryField.className = "metro-progressive-field";
            progEveryField.textContent = "Toutes les (s)";
            var progEveryInput = document.createElement("input");
            progEveryInput.type = "number";
            progEveryInput.min = "1";
            progEveryInput.max = "600";
            progEveryInput.value = m.progressive.everySeconds;
            progEveryInput.addEventListener("change", function () {
                m.progressive.everySeconds = Math.min(600, Math.max(1, parseInt(progEveryInput.value, 10) || 20));
                progEveryInput.value = m.progressive.everySeconds;
                metroProgNextAt = null; // le nouveau délai repart du prochain pas
                save();
            });
            progEveryField.appendChild(progEveryInput);
            progFields.appendChild(progEveryField);

            function refreshProgToggle() {
                progToggle.classList.toggle("metro-progressive-active", m.progressive.enabled);
                progFields.hidden = !m.progressive.enabled;
            }
            progToggle.addEventListener("click", function () {
                m.progressive.enabled = !m.progressive.enabled;
                metroProgNextAt = null; // le délai part du moment où on l'active
                save();
                refreshProgToggle();
            });
            refreshProgToggle();

            // Le scheduler change le BPM lui-même (voir metroScheduler) : on ne fait que rafraîchir l'affichage.
            metroTempoCallback = function () { refreshBpmUI(); };

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
            // Purement visuel (pas persisté) : s'arrête à la pause et reprend là où il en était à
            // la relecture, sans jamais se remettre à zéro tout seul (seule la fermeture du
            // panneau, qui arrête aussi le métronome, le réinitialise).
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
            }
            refreshBpmUI();

            // On arrête le métronome en fermant le panneau : pas de son qui continue en arrière-plan
            // sans qu'on le voie.
            return function () {
                stopMetronome();
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
        sc("major", "Gammes", "Majeur (Ionien)", [0, 2, 4, 5, 7, 9, 11], ["1", "2", "3", "4", "5", "6", "7"]),
        sc("aeolian", "Gammes", "Mineur naturel (Éolien)", [0, 2, 3, 5, 7, 8, 10], ["1", "2", "♭3", "4", "5", "♭6", "♭7"]),
        sc("harmonicMinor", "Gammes", "Mineur harmonique", [0, 2, 3, 5, 7, 8, 11], ["1", "2", "♭3", "4", "5", "♭6", "7"]),
        sc("melodicMinor", "Gammes", "Mineur mélodique", [0, 2, 3, 5, 7, 9, 11], ["1", "2", "♭3", "4", "5", "6", "7"]),
        sc("majorPenta", "Gammes", "Pentatonique majeure", [0, 2, 4, 7, 9], ["1", "2", "3", "5", "6"]),
        sc("minorPenta", "Gammes", "Pentatonique mineure", [0, 3, 5, 7, 10], ["1", "♭3", "4", "5", "♭7"]),
        sc("blues", "Gammes", "Blues (mineur)", [0, 3, 5, 6, 7, 10], ["1", "♭3", "4", "♭5", "5", "♭7"]),
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
        { key: "bass4", label: "Basse (4 cordes)", midis: [28, 33, 38, 43] },
        { key: "bass5", label: "Basse (5 cordes)", midis: [23, 28, 33, 38, 43] },
        { key: "guitar", label: "Guitare", midis: [40, 45, 50, 55, 59, 64] }
    ];
    var FRETBOARD_DISPLAY_FRETS = 24;
    var FRETBOARD_SINGLE_MARKERS = [3, 5, 7, 9, 15, 17, 19, 21];
    var FRETBOARD_DOUBLE_MARKERS = [12, 24];

    function scaleNoteLabel(def, semiIdx, pc, labelMode) {
        return labelMode === "notes" ? NOTE_NAMES_SHARP[pc] : def.degrees[semiIdx];
    }

    function buildFretboardSvg(tuning, def, rootPc, labelMode, fretCount) {
        var FRETS = fretCount || FRETBOARD_DISPLAY_FRETS;
        var ns = "http://www.w3.org/2000/svg";
        // Espacements volontairement plus généreux que des proportions "réalistes" de manche
        // (stringGap > fretGap/2, au lieu d'un vrai manche plus large que haut) : le but est que les
        // pastilles de notes ne se touchent jamais, pas de reproduire un vrai manche à l'échelle.
        var stringGap = 26, fretGap = 38, marginLeft = 24, marginTop = 14, labelRowH = 26;
        var n = tuning.midis.length;
        var stringsSpan = stringGap * (n - 1);
        var width = marginLeft + fretGap * FRETS + 8;
        var height = marginTop + stringsSpan + labelRowH + 4;
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
        var labelY = marginTop + stringsSpan + 23; // sous les pastilles de la dernière corde, pas cachées par elles
        FRETBOARD_SINGLE_MARKERS.forEach(function (fret) {
            if (fret > FRETS) return;
            var mx = marginLeft + (fret - 0.5) * fretGap;
            svg.appendChild(el("circle", { cx: mx, cy: midY, r: 3, class: "fretboard-inlay" }));
            svg.appendChild(el("text", { x: mx, y: labelY, class: "fretboard-fret-label" })).textContent = fret;
        });
        FRETBOARD_DOUBLE_MARKERS.forEach(function (fret) {
            if (fret > FRETS) return;
            var mx = marginLeft + (fret - 0.5) * fretGap;
            svg.appendChild(el("circle", { cx: mx, cy: midY - stringGap, r: 3, class: "fretboard-inlay" }));
            svg.appendChild(el("circle", { cx: mx, cy: midY + stringGap, r: 3, class: "fretboard-inlay" }));
            svg.appendChild(el("text", { x: mx, y: labelY, class: "fretboard-fret-label" })).textContent = fret;
        });

        for (var s2 = 0; s2 < n; s2++) {
            for (var fret2 = 0; fret2 <= FRETS; fret2++) {
                var pc = (tuning.midis[s2] + fret2) % 12;
                var diff = (pc - rootPc + 12) % 12;
                var semiIdx = def.semis.indexOf(diff);
                if (semiIdx === -1) continue;
                var isRoot = diff === 0;
                var nx = fret2 === 0 ? marginLeft - 11 : marginLeft + (fret2 - 0.5) * fretGap;
                var ny = stringY(s2);
                var r = fret2 === 0 ? 9 : 11;
                svg.appendChild(el("circle", { cx: nx, cy: ny, r: r, class: "fretboard-note" + (isRoot ? " fretboard-note-root" : "") }));
                var t = el("text", { x: nx, y: ny + 3, class: "fretboard-note-label" });
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
        { key: "bass4", label: "Basse (4 cordes)", short: "Basse 4", type: "fretboard", tuning: FRETBOARD_TUNINGS[0] },
        { key: "bass5", label: "Basse (5 cordes)", short: "Basse 5", type: "fretboard", tuning: FRETBOARD_TUNINGS[1] },
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
            zoom: typeof p.zoom === "number" && p.zoom >= 0.6 && p.zoom <= 1.8 ? p.zoom : (isPhone ? 0.85 : 1.2)
        };
    }
    function saveScalesPrefs(p) {
        try { localStorage.setItem(SCALES_PREFS_KEY, JSON.stringify(p)); } catch (e) {}
    }

    function openScalesPanel() {
        openModal("scales-panel", function (panel) {
            var title = document.createElement("div");
            title.className = "backups-title";
            title.textContent = "Gammes & arpèges";
            panel.appendChild(title);

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

            var instSelect = select(row("Instrument", "scales-row-inst"), "Instrument", function (v) { prefs.instrument = v; update(); });
            SCALES_INSTRUMENTS.forEach(function (inst) { addOption(instSelect, inst.key, inst.label); });

            var rootSelect = select(row("Tonique", "scales-row-root"), "Tonique", function (v) { prefs.root = parseInt(v, 10); update(); });
            ROOT_MENU_NAMES.forEach(function (name, pc) { addOption(rootSelect, String(pc), name); });

            var typeRowChips = row("Gamme", "scales-row-types");
            var typeSelect = select(typeRowChips, "Gamme ou arpège", function (v) { prefs.type = v; update(); });
            var moreBtn = chip(typeRowChips, "…", "Afficher aussi les gammes peu utilisées ou complexes", function () { prefs.showAll = !prefs.showAll; update(); });
            moreBtn.classList.add("scales-more-btn");

            var viewChips = row("Affichage", "scales-row-view");
            var labelSeg = document.createElement("div");
            labelSeg.className = "scales-chips scales-segmented";
            viewChips.appendChild(labelSeg);
            var degreesBtn = chip(labelSeg, "Intervalles", null, function () { prefs.labelMode = "degrees"; update(); });
            var notesBtn = chip(labelSeg, "Notes", null, function () { prefs.labelMode = "notes"; update(); });
            var fretSeg = document.createElement("div");
            fretSeg.className = "scales-chips scales-segmented";
            viewChips.appendChild(fretSeg);
            var frets12Btn = chip(fretSeg, "12 cases", "Manche jusqu'à la 12e case", function () { prefs.frets = 12; update(); });
            var frets24Btn = chip(fretSeg, "24 cases", "Manche complet", function () { prefs.frets = 24; update(); });
            var zoomSeg = document.createElement("div");
            zoomSeg.className = "scales-chips scales-segmented";
            viewChips.appendChild(zoomSeg);
            var zoomOut = chip(zoomSeg, "−", "Diagramme plus petit", function () { prefs.zoom = Math.max(0.6, Math.round((prefs.zoom - 0.15) * 100) / 100); update(); });
            var zoomIn = chip(zoomSeg, "+", "Diagramme plus grand", function () { prefs.zoom = Math.min(1.8, Math.round((prefs.zoom + 0.15) * 100) / 100); update(); });
            zoomOut.classList.add("scales-chip-icon");
            zoomIn.classList.add("scales-chip-icon");

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
                // Menu des gammes reconstruit : familles courantes + (avec « … ») les autres. La famille
                // de la gamme choisie reste toujours listée, même « … » éteint.
                typeSelect.innerHTML = "";
                SCALE_MENU.forEach(function (g) {
                    if (g.extra && !prefs.showAll && g.keys.indexOf(prefs.type) === -1) return;
                    var og = document.createElement("optgroup");
                    og.label = g.label;
                    g.keys.forEach(function (key) {
                        var d = SCALE_DEFS.filter(function (x) { return x.key === key; })[0];
                        addOption(og, key, d.label);
                    });
                    typeSelect.appendChild(og);
                });
                typeSelect.value = prefs.type;
                moreBtn.classList.toggle("scales-chip-active", prefs.showAll);
                degreesBtn.classList.toggle("scales-chip-active", prefs.labelMode === "degrees");
                notesBtn.classList.toggle("scales-chip-active", prefs.labelMode === "notes");
                var inst = SCALES_INSTRUMENTS.filter(function (i) { return i.key === prefs.instrument; })[0];
                fretSeg.hidden = inst.type === "piano";
                frets12Btn.classList.toggle("scales-chip-active", prefs.frets === 12);
                frets24Btn.classList.toggle("scales-chip-active", prefs.frets === 24);
                zoomOut.disabled = prefs.zoom <= 0.6;
                zoomIn.disabled = prefs.zoom >= 1.8;

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
                var svg = inst.type === "piano" ? buildPianoScaleSvg(def, prefs.root, prefs.labelMode) : buildFretboardSvg(inst.tuning, def, prefs.root, prefs.labelMode, prefs.frets);
                // Taille fixe (en px) × zoom plutôt qu'étirée sur toute la hauteur dispo : les notes
                // gardent une taille lisible et constante, quelle que soit la taille de l'écran.
                svg.setAttribute("width", Math.round(parseFloat(svg.getAttribute("width")) * prefs.zoom));
                svg.setAttribute("height", Math.round(parseFloat(svg.getAttribute("height")) * prefs.zoom));
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

            function section(labelText) {
                var label = document.createElement("div");
                label.className = "section-label settings-section-label";
                label.textContent = labelText;
                panel.appendChild(label);
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
            panel.appendChild(selectField("Position", [
                ["center", "Centre"], ["top", "Haut"], ["bottom", "Bas"], ["corner", "Coin (bas à droite)"]
            ], a.metronomePosition, function (v) { a.metronomePosition = v; save(); }));
            panel.appendChild(selectField("Taille", [
                ["small", "Petite"], ["medium", "Moyenne"], ["large", "Grande"]
            ], a.metronomeSize, function (v) { a.metronomeSize = v; save(); }));

            section("Affichage");
            panel.appendChild(selectField("Couleurs des chapitres", Object.keys(COLOR_SCHEMES).map(function (key) {
                return [key, COLOR_SCHEMES[key].label];
            }), a.colorScheme, function (v) { applyColorScheme(v); }));
            panel.appendChild(selectField("Taille du texte des dossiers", [
                ["0.85", "Petite"], ["1", "Normale"], ["1.15", "Grande"], ["1.3", "Très grande"]
            ], a.treeFontScale, function (v) {
                a.treeFontScale = parseFloat(v);
                save();
                render();
            }));
            panel.appendChild(selectField("Densité de l'interface", [
                ["compact", "Compacte"], ["comfortable", "Confortable"], ["spacious", "Spacieuse"]
            ], a.density, function (v) { a.density = v; save(); render(); }));
            panel.appendChild(selectField("Disposition de l'écran principal", [
                ["vertical", "Verticale"], ["horizontal", "Horizontale (façon Finder)"]
            ], a.mainLayout, function (v) { a.mainLayout = v; save(); render(); }));
        });
    }

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
    var gsRefreshRunUi = null; // remet à jour bouton Pause/Reprendre + chrono de l'écran de guidage affiché (raccourci Espace)
    var gsLinksChecked = {}; // clé "link:<id>"/"file:<id>" -> coché ou non, le temps de l'écran
    // L'écran des liens/PJ s'ouvre aussi AVANT de lancer la session (depuis la liste ou l'édition) :
    // on ouvre tout d'un coup, puis on démarre, sans perdre de temps pendant l'entraînement.
    var gsLinksSession = null;   // session dont on affiche les liens/PJ
    var gsLinksBack = "list";    // écran où revenir : "list" | "edit" | "run"
    var gsFileBlobCache = {};    // id de pièce jointe -> Blob déjà lu (false = absent de cet appareil)

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
    var SCRUB_PX_PER_STEP = 9, SCRUB_START_PX = 4, SCRUB_SPINNER_PX = 24;
    function bindScrubInput(input, min, max) {
        var startY = 0, startVal = 0, active = false, scrubbing = false, changed = false;
        function clamp(v) { return Math.min(max, Math.max(min, v)); }
        input.addEventListener("pointerdown", function (e) {
            if (e.button !== undefined && e.button !== 0) return;
            var rect = input.getBoundingClientRect();
            if (e.clientX > rect.right - SCRUB_SPINNER_PX) return; // zone des chevrons natifs
            active = true; scrubbing = false; changed = false;
            startY = e.clientY;
            startVal = parseInt(input.value, 10) || min;
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
            var v = clamp(startVal + Math.round(dy / SCRUB_PX_PER_STEP));
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
        input.title = (input.title ? input.title + " — " : "") + "Glisser vers le haut/bas pour changer, ou chevrons / saisie";
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
            iconSpan.innerHTML = linkIconSvg(link.label);
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
            iconSpan.innerHTML = fileKindIcon(meta.type || meta.name);
            chip.appendChild(iconSpan);
            var label = document.createElement("span");
            label.className = "file-open";
            label.textContent = meta.name;
            chip.appendChild(label);
            chip.addEventListener("click", function () {
                getFileBlob(meta.id).then(function (blob) {
                    if (!blob) { window.alert("Ce fichier n'est disponible que sur l'appareil où il a été ajouté (« " + meta.name + " »)."); return; }
                    var url = URL.createObjectURL(blob);
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
    function openUrlsInTabs(urls) {
        var standalone = isStandaloneApp();
        var blocked = 0;
        urls.forEach(function (url) {
            if (standalone) {
                try { window.open(url, "_blank", "noopener,noreferrer"); } catch (e) { blocked++; }
                return;
            }
            var w = null;
            try { w = window.open(url, "_blank"); } catch (e) {}
            if (!w) { blocked++; return; }
            try { w.opener = null; } catch (e) {}
        });
        if (blocked) {
            showToast(blocked + " lien" + (blocked > 1 ? "s" : "") + " bloqué" + (blocked > 1 ? "s" : "") + " par le navigateur : autorisez les pop-ups pour TrainHub (icône dans la barre d'adresse) puis recommencez.", 8000);
        }
    }

    function gsOpenItems(items) {
        var urls = [], unavailable = [], pending = [];
        items.forEach(function (item) {
            if (item.type === "link") { urls.push(item.url); return; }
            var blob = gsFileBlobCache[item.meta.id];
            if (blob === false) { unavailable.push(item.label); return; }
            if (!blob) { pending.push(item.label); return; } // lecture pas encore terminée
            // Fichier déjà lu à l'affichage de l'écran : ouverture immédiate, comme un lien.
            var url = URL.createObjectURL(blob);
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
        if (gsScreen !== "links") gsFileBlobCache = {};
        if (gsScreen === "run" && gsRunSession) renderGsRunScreen(content);
        else if (gsScreen === "links" && gsLinksSession) renderGsLinksScreen(content);
        else if (gsScreen === "pick" && gsEditingSession) renderGsPickScreen(content);
        else if (gsScreen === "edit" && gsEditingSession) renderGsEditScreen(content);
        else renderGsListScreen(content);
    }

    // ---- écran liste ----
    function renderGsListScreen(content) {
        var sessions = state.settings.guidedSessions;
        if (!sessions.length) {
            var empty = document.createElement("div");
            empty.className = "gs-empty";
            empty.textContent = "Aucune session pour l'instant.";
            content.appendChild(empty);
        } else {
            var list = document.createElement("div");
            list.className = "gs-session-list";
            sessions.forEach(function (session) {
                var row = document.createElement("div");
                row.className = "gs-session-row";
                row.title = "Cliquer pour modifier les exercices de la session";
                row.addEventListener("click", function (e) {
                    if (e.target.closest("button")) return;
                    gsEditingSession = session;
                    gsScreen = "edit";
                    render();
                });
                var info = document.createElement("div");
                info.className = "gs-session-info";
                var name = document.createElement("div");
                name.className = "gs-session-name";
                name.textContent = session.name;
                var meta = document.createElement("div");
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
                var delBtn = iconButton("✕", "Supprimer cette session", function () {
                    if (!window.confirm("Supprimer la session « " + session.name + " » ?")) return;
                    addToTrash("session", session, {});
                    sessions.splice(sessions.indexOf(session), 1);
                    save();
                    render();
                });
                actions.appendChild(playBtn);
                if (linksBtn) actions.appendChild(linksBtn);
                actions.appendChild(delBtn);
                row.appendChild(actions);
                list.appendChild(row);
            });
            content.appendChild(list);
        }

        var addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "btn-accent gs-add-session-btn";
        addBtn.textContent = "+ Nouvelle session";
        addBtn.addEventListener("click", function () {
            var session = { id: uid(), name: "Nouvelle session", steps: [] };
            sessions.push(session);
            gsEditingSession = session;
            gsScreen = "edit";
            save();
            render();
        });
        content.appendChild(addBtn);
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
                var handle = document.createElement("span");
                handle.className = "gs-step-handle";
                handle.innerHTML = GRIP_ICON_SVG;
                row.appendChild(handle);
                if (found) row.appendChild(gsThemeBadge(found.pathNames, found.chapterColor));
                var label = document.createElement("span");
                label.className = "gs-step-label" + (found ? "" : " gs-step-missing");
                label.textContent = found ? found.ex.title : "(exercice supprimé)";
                row.appendChild(label);
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
                    save();
                    refreshTotal();
                });
                row.appendChild(minutesInput);
                var minLabel = document.createElement("span");
                minLabel.className = "gs-step-min-label";
                minLabel.textContent = "min";
                row.appendChild(minLabel);
                var detailsOpen = !!gsOpenStepDetails[step.id];
                var detailsBtn = iconButton(step.note && step.note.trim() ? "✎▾" : "▾", "Note et liens affichés pendant la session", function () {
                    gsOpenStepDetails[step.id] = !gsOpenStepDetails[step.id];
                    renderSteps();
                });
                detailsBtn.classList.add("gs-step-details-btn");
                if (detailsOpen) detailsBtn.classList.add("gs-step-details-open");
                row.appendChild(detailsBtn);
                var removeBtn = iconButton("✕", "Retirer cet exercice", function () {
                    session.steps.splice(session.steps.indexOf(step), 1);
                    save();
                    renderSteps();
                    refreshTotal();
                    editRunBtn.disabled = !session.steps.length;
                });
                row.appendChild(removeBtn);

                if (detailsOpen) {
                    var details = document.createElement("div");
                    details.className = "gs-step-details";
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
                        detailsBtn.textContent = value.trim() ? "✎▾" : "▾";
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
        }
        renderSteps();
        refreshTotal();

        var addStepBtn = document.createElement("button");
        addStepBtn.type = "button";
        addStepBtn.className = "btn-ghost gs-add-step-btn";
        addStepBtn.textContent = "+ Ajouter un exercice";
        addStepBtn.addEventListener("click", function () {
            gsPickCallback = function (ex) {
                session.steps.push({ id: uid(), exerciseId: ex.id, minutes: 5 });
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
                    exBtn.textContent = ex.title;
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
        gsRunSession = session;
        gsRunStepIndex = 0;
        gsEnterRunStep();
        gsScreen = "run";
        render();
    }

    function gsEnterRunStep() {
        gsRunAllocatedSec = gsRunSession.steps[gsRunStepIndex].minutes * 60;
        gsRunElapsedMs = 0;
        gsRunStartTs = Date.now();
        gsRunPaused = false;
        transportLastTouched = "session";
    }

    function gsRunElapsedNowMs() {
        return gsRunElapsedMs + (gsRunPaused ? 0 : Date.now() - gsRunStartTs);
    }

    function gsPauseRun() {
        if (gsRunPaused) return;
        gsRunElapsedMs += Date.now() - gsRunStartTs;
        gsRunPaused = true;
        transportLastTouched = "session";
    }

    function gsResumeRun() {
        if (!gsRunPaused) return;
        gsRunStartTs = Date.now();
        gsRunPaused = false;
        transportLastTouched = "session";
    }

    function gsEndRun() {
        if (gsRunInterval) { clearInterval(gsRunInterval); gsRunInterval = null; }
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
        function inFullscreen() { return document.fullscreenElement === frame; }
        function refreshSizeBtn() {
            var on = inFullscreen() || card.classList.contains("gs-yt-large");
            sizeBtn.textContent = on ? "⤡ Réduire" : "⤢ Plein écran";
        }
        sizeBtn.addEventListener("click", function () {
            if (inFullscreen()) { document.exitFullscreen(); return; }
            if (card.classList.contains("gs-yt-large")) { setYtOverlay(card, false); refreshSizeBtn(); return; }
            var req = frame.requestFullscreen ? frame.requestFullscreen() : null;
            if (req && req.catch) req.catch(function () { setYtOverlay(card, true); refreshSizeBtn(); });
            else if (!req) { setYtOverlay(card, true); refreshSizeBtn(); }
        });
        document.addEventListener("fullscreenchange", refreshSizeBtn);
        head.appendChild(sizeBtn);

        var ytLink = document.createElement("a");
        ytLink.className = "btn-ghost gs-yt-btn";
        ytLink.href = link.url;
        ytLink.target = "_blank";
        ytLink.rel = "noopener noreferrer";
        ytLink.textContent = "↗ YouTube";
        ytLink.title = "Ouvrir sur YouTube (nouvel onglet)";
        head.appendChild(ytLink);

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
        card.appendChild(head);

        var target = document.createElement("div");
        frame.appendChild(target);
        var msg = document.createElement("div");
        msg.className = "gs-yt-msg";
        msg.hidden = true;
        frame.appendChild(msg);
        card.appendChild(frame);

        function showMsg(text) { msg.textContent = text; msg.hidden = false; }
        loadYouTubeApi().then(function () {
            new window.YT.Player(target, {
                width: "100%", height: "100%",
                videoId: info.id,
                playerVars: { playsinline: 1, rel: 0, start: info.start || 0 },
                events: {
                    onError: function () { showMsg("Cette vidéo ne peut pas être lue ici : utilisez « ↗ YouTube »."); }
                }
            });
        }, function () {
            showMsg("Lecteur YouTube indisponible (hors ligne ?) : utilisez « ↗ YouTube ».");
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

        function refreshTimer() {
            var remaining = gsRunAllocatedSec - Math.floor(gsRunElapsedNowMs() / 1000);
            var overtime = remaining < 0;
            var abs = Math.abs(remaining);
            var mm = Math.floor(abs / 60), ss = abs % 60;
            timerEl.textContent = (overtime ? "+" : "") + (mm < 10 ? "0" : "") + mm + ":" + (ss < 10 ? "0" : "") + ss;
            timerEl.classList.toggle("gs-run-timer-overtime", overtime);
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
        pauseBtn.title = "Pause / reprise (barre espace)";
        pauseBtn.addEventListener("click", function () {
            if (gsRunPaused) gsResumeRun(); else gsPauseRun();
            refreshPauseBtn();
        });
        gsRefreshRunUi = function () { refreshPauseBtn(); refreshTimer(); };
        pauseStopRow.appendChild(pauseBtn);

        var stopBtn = document.createElement("button");
        stopBtn.type = "button";
        stopBtn.className = "btn-ghost gs-run-stop-btn";
        stopBtn.textContent = "Arrêter";
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
        linksBtn.className = "btn-ghost gs-run-links-btn";
        linksBtn.textContent = "Liens/PJ de toute la session…";
        linksBtn.addEventListener("click", function () { gsOpenLinks(gsRunSession, "run"); });
        toolsRow.appendChild(linksBtn);
        content.appendChild(toolsRow);

        var navRow = document.createElement("div");
        navRow.className = "gs-run-nav-row";
        var prevBtn = document.createElement("button");
        prevBtn.type = "button";
        prevBtn.className = "btn-ghost";
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

        // Lecteurs YouTube des liens de l'exercice en cours (volume/vitesse retenus par lien).
        if (found) {
            // Plusieurs liens YouTube : les lecteurs se suivent, les uns sous les autres.
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

    // ---------- raccourci clavier : barre espace = pause / reprise ----------
    // Agit sur ce qui est "présent" : la session guidée en cours de guidage et/ou le métronome (panneau
    // ouvert). Si l'un des deux tourne, Espace met en pause TOUT ce qui tourne (une pause d'entraînement
    // arrête le chrono de la session et le clic du métronome ensemble) et retient ce qu'il a arrêté ;
    // si rien ne tourne, il relance ce qu'il avait mis en pause — et à défaut (rien de retenu), celui des
    // deux qu'on a lancé/arrêté en dernier. Quand un seul des deux est présent, c'est lui, simplement.
    var spacePausedSet = [];      // ce que la dernière pression d'Espace a mis en pause : "session" et/ou "metro"
    var spaceKeyHandled = false;  // vrai entre le keydown pris en charge et son keyup (voir plus bas)

    function transportSessionPresent() { return !!gsRunSession && guidedSessionViewActive; }

    function transportToggleViaSpace() {
        var sessionOn = transportSessionPresent();
        var metroOn = !!metroPanelApi;
        if (!sessionOn && !metroOn) return;
        var sessionRunning = sessionOn && !gsRunPaused;
        var metroRunning = metroOn && metroPlaying;
        if (sessionRunning || metroRunning) {
            spacePausedSet = [];
            if (sessionRunning) { gsPauseRun(); spacePausedSet.push("session"); }
            if (metroRunning) { metroPanelApi.toggle(); spacePausedSet.push("metro"); }
        } else {
            var resume = spacePausedSet.filter(function (w) { return w === "session" ? sessionOn : metroOn; });
            if (!resume.length) {
                if (transportLastTouched === "metro" && metroOn) resume = ["metro"];
                else if (transportLastTouched === "session" && sessionOn) resume = ["session"];
                else resume = [sessionOn ? "session" : "metro"];
            }
            spacePausedSet = [];
            if (resume.indexOf("session") !== -1) gsResumeRun();
            if (resume.indexOf("metro") !== -1) metroPanelApi.toggle();
        }
        if (gsRefreshRunUi) gsRefreshRunUi();
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
        return !!document.querySelector(".ctx-menu");
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
        transportToggleViaSpace();
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
            navigator.serviceWorker.register("sw.js").catch(function () {});
        });
    }
})();
