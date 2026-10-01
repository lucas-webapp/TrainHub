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
    function showToast(message) {
        if (activeToastEl) { activeToastEl.remove(); clearTimeout(activeToastTimer); }
        var toast = document.createElement("div");
        toast.className = "toast";
        toast.textContent = message;
        document.body.appendChild(toast);
        activeToastEl = toast;
        activeToastTimer = setTimeout(function () {
            toast.remove();
            if (activeToastEl === toast) activeToastEl = null;
        }, 3200);
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
    function setupDragReorder(container, itemSelector, getArray, axis) {
        var dragEl = null;
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
            // Pas de capture du pointeur ici : dans un vrai navigateur, capturer dès l'appui
            // redirige le "click" final vers le nœud entier, ce qui rendait inopérants le
            // chevron, le "+" et le clic sur un sous-dossier. On ne capture qu'une fois le
            // glisser réellement commencé (seuil de 10 px), voir pointermove.
        });

        container.addEventListener("pointermove", function (e) {
            if (!dragEl) return;
            if (!moved && e.buttons === 0 && e.pointerType === "mouse") { dragEl = null; return; } // relâché hors de la zone
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
                document.body.appendChild(ghost);
                dragEl.classList.add("dragging");
            }
            ghost.style.left = (e.clientX - grabOffsetX) + "px";
            ghost.style.top = (e.clientY - grabOffsetY) + "px";

            var siblings = directChildren().filter(function (el) { return el !== dragEl; });
            var before = captureRects(siblings);
            for (var i = 0; i < siblings.length; i++) {
                var rect = siblings[i].getBoundingClientRect();
                var mid = axis === "x" ? (rect.left + rect.width / 2) : (rect.top + rect.height / 2);
                var pos = axis === "x" ? e.clientX : e.clientY;
                if (pos < mid) {
                    container.insertBefore(dragEl, siblings[i]);
                    flipSiblings(before);
                    return;
                }
            }
            container.appendChild(dragEl);
            flipSiblings(before);
        });

        // `arr` peut être un tableau d'objets {id, ...} (dossiers, exercices) ou directement un
        // tableau d'identifiants bruts (l'ordre des chapitres, réels + virtuels — voir pinnedOrder).
        function idOf(x) { return (x && typeof x === "object") ? x.id : x; }

        function finish() {
            if (ghost) { ghost.remove(); ghost = null; }
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
    function renderResultsList(inst, results, emptyText) {
        $folderContainer.innerHTML = "";
        if (results.length === 0) {
            $empty.hidden = false;
            $empty.textContent = emptyText;
            return;
        }
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
        renderResultsList(inst, results, emptyText);
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
        setupDragReorder(exercisesWrap, ".exercise", function () { return currentFolder.exercises; }, "y");
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

    function renderExerciseDetails(ex) {
        var details = document.createElement("div");
        details.className = "exercise-details";

        var notesLabel = document.createElement("div");
        notesLabel.className = "section-label";
        notesLabel.textContent = "Notes";
        var notes = document.createElement("textarea");
        notes.className = "notes-textarea";
        notes.rows = NOTES_MIN_ROWS;
        notes.value = ex.notes || "";
        notes.placeholder = "Remarques, points à retravailler…";
        notes.addEventListener("input", function () { autoGrowNotes(notes); });
        notes.addEventListener("change", function () {
            ex.notes = notes.value;
            touchExercise(ex);
            save();
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
                function commit() {
                    if (done) return;
                    done = true;
                    var name = input.value.trim();
                    if (name) { link.label = name; labelSpan.textContent = name; }
                    input.replaceWith(labelSpan);
                    touchExercise(ex);
                    save();
                }
                function cancel() {
                    if (done) return;
                    done = true;
                    input.replaceWith(labelSpan);
                }
                input.addEventListener("keydown", function (e) {
                    e.stopPropagation();
                    if (e.key === "Enter") { e.preventDefault(); commit(); }
                    if (e.key === "Escape") cancel();
                });
                input.addEventListener("blur", commit);
                input.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); });
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
            });
            chip.appendChild(removeBtn);
            resourcesList.appendChild(chip);
        });
        appendFileChips(resourcesList, ex);
        details.appendChild(resourcesList);

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
            ex.links.push({ id: uid(), label: guessLinkLabel(url), url: url });
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
            openBtn.textContent = meta.name + (meta.size ? " · " + humanFileSize(meta.size) : "");
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

        var title = document.createElement("div");
        title.className = "backups-title";
        title.textContent = "Sauvegardes de secours (sur cet appareil)";
        panel.appendChild(title);

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

        function closeBackupsPanel() {
            cleanupResize();
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
        document.body.appendChild(backdrop);
        document.body.appendChild(panel);
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

    // Sans ceci, le fond de page défile sous la fenêtre flottante au doigt sur mobile (le panneau
    // est en position fixed, mais le corps de la page reste scrollable derrière).
    function lockBodyScroll() { document.documentElement.classList.add("modal-open"); }
    function unlockBodyScroll() { document.documentElement.classList.remove("modal-open"); }

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
    // Rend `panel` redimensionnable (voir resize:both en CSS sur .backups-panel) et persiste la
    // taille choisie. Pas de ResizeObserver générique : il se déclencherait aussi pour des
    // changements de taille dus au CONTENU (déplier le volume, changer d'onglet…), pas seulement à
    // un vrai redimensionnement manuel — on ne retient donc que les redimensionnements commencés
    // depuis le coin bas-droit (la poignée native du navigateur).
    function makePanelResizable(panel, kind) {
        var stored = loadPanelSizes()[kind];
        if (stored) {
            panel.style.width = stored.width + "px";
            panel.style.height = stored.height + "px";
        }
        var resizing = false;
        var HANDLE_ZONE = 24;
        function onPointerDown(e) {
            var rect = panel.getBoundingClientRect();
            if (e.clientX > rect.right - HANDLE_ZONE && e.clientY > rect.bottom - HANDLE_ZONE) resizing = true;
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

    function openModal(extraClass, build) {
        closeFolderMenu();
        if (closeActiveModal) closeActiveModal();
        lockBodyScroll();
        var backdrop = document.createElement("div");
        backdrop.className = "ctx-backdrop";
        var panel = document.createElement("div");
        panel.className = "backups-panel" + (extraClass ? " " + extraClass : "");
        var panelKind = extraClass ? extraClass.split(" ")[0] : "modal";
        var cleanupResize = makePanelResizable(panel, panelKind);
        var onClose = null;

        function close() {
            if (onClose) onClose();
            cleanupResize();
            backdrop.remove();
            panel.remove();
            document.removeEventListener("keydown", onKey, true);
            unlockBodyScroll();
            if (closeActiveModal === close) closeActiveModal = null;
        }
        function onKey(e) { if (e.key === "Escape") close(); }
        backdrop.addEventListener("click", close);
        document.addEventListener("keydown", onKey, true);
        closeActiveModal = close;

        onClose = build(panel, close) || null;

        var closeRow = document.createElement("div");
        closeRow.className = "backups-close-row";
        var closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "btn-ghost";
        closeBtn.textContent = "Fermer";
        closeBtn.addEventListener("click", close);
        closeRow.appendChild(closeBtn);
        panel.appendChild(closeRow);

        document.body.appendChild(backdrop);
        document.body.appendChild(panel);
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
    // mesure et motif d'accents (0 = silence, 1 = normal, 2 = temps fort), plus une subdivision
    // (noire/croches/triolet). Le son est généré à la volée (Web Audio API), rien à télécharger.
    function normalizeMetronomeSettings(settings) {
        if (!settings.metronome || typeof settings.metronome !== "object") settings.metronome = {};
        var m = settings.metronome;
        if (typeof m.bpm !== "number" || isNaN(m.bpm) || m.bpm < 30 || m.bpm > 300) m.bpm = 100;
        m.bpm = Math.round(m.bpm);
        if (typeof m.volume !== "number" || isNaN(m.volume) || m.volume < 0 || m.volume > 1) m.volume = 0.8;
        if (typeof m.beatsPerMeasure !== "number" || isNaN(m.beatsPerMeasure) || m.beatsPerMeasure < 1 || m.beatsPerMeasure > 12) m.beatsPerMeasure = 4;
        m.beatsPerMeasure = Math.round(m.beatsPerMeasure);
        if ([1, 2, 3, 4].indexOf(m.subdivision) === -1) m.subdivision = 1;
        var stepCount = m.beatsPerMeasure * m.subdivision;
        // Ancien format (un seul accent par TEMPS, sans pavé rythmique) : migré vers un motif par PAS
        // en plaçant chaque ancien accent sur le 1er pas de son temps, le reste muet.
        if (!Array.isArray(m.pattern) && Array.isArray(m.accents)) {
            var migrated = [];
            for (var b = 0; b < m.beatsPerMeasure; b++) {
                for (var s = 0; s < m.subdivision; s++) migrated.push(s === 0 ? (m.accents[b] != null ? m.accents[b] : 1) : 0);
            }
            m.pattern = migrated;
            delete m.accents;
        }
        if (!Array.isArray(m.pattern)) m.pattern = [];
        while (m.pattern.length < stepCount) {
            var idx = m.pattern.length;
            m.pattern.push(idx === 0 ? 2 : (idx % m.subdivision === 0 ? 1 : 0));
        }
        m.pattern.length = stepCount;
        for (var i = 0; i < m.pattern.length; i++) {
            if ([0, 1, 2].indexOf(m.pattern[i]) === -1) m.pattern[i] = 1;
        }
        // Tempo progressif (peu utilisé au quotidien, désactivé par défaut) : augmente le BPM tout
        // seul toutes les N mesures pendant la lecture — voir metroScheduler.
        if (!m.progressive || typeof m.progressive !== "object") m.progressive = {};
        if (typeof m.progressive.enabled !== "boolean") m.progressive.enabled = false;
        if (typeof m.progressive.incrementBpm !== "number" || isNaN(m.progressive.incrementBpm) || m.progressive.incrementBpm <= 0) m.progressive.incrementBpm = 5;
        if (typeof m.progressive.everyMeasures !== "number" || isNaN(m.progressive.everyMeasures) || m.progressive.everyMeasures <= 0) m.progressive.everyMeasures = 4;
        return m;
    }

    var metroAudioCtx = null;
    var metroMasterGain = null; // volume général du métronome (voir la barre de volume du panneau)
    var metroPlaying = false;
    var metroTimer = null;
    var metroNextNoteTime = 0;
    var metroCurrentStep = 0;
    var metroBeatCallback = null; // met à jour l'affichage (pas qui clignote), posé par le panneau ouvert
    var metroMeasureCallback = null; // prévenu à chaque nouvelle mesure (voir tempo progressif)
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

    function metroScheduler() {
        var m = state.settings.metronome;
        var stepCount = m.beatsPerMeasure * m.subdivision;
        while (metroNextNoteTime < metroAudioCtx.currentTime + METRO_SCHEDULE_AHEAD_S) {
            metroClick(metroNextNoteTime, m.pattern[metroCurrentStep]);
            if (metroBeatCallback) {
                var step = metroCurrentStep, delayMs = Math.max(0, (metroNextNoteTime - metroAudioCtx.currentTime) * 1000);
                setTimeout(function () { if (metroPlaying && metroBeatCallback) metroBeatCallback(step); }, delayMs);
            }
            var secondsPerStep = 60 / m.bpm / m.subdivision;
            metroNextNoteTime += secondsPerStep;
            metroCurrentStep = (metroCurrentStep + 1) % stepCount;
            if (metroCurrentStep === 0 && metroMeasureCallback) metroMeasureCallback();
        }
        metroTimer = setTimeout(metroScheduler, METRO_LOOKAHEAD_MS);
    }

    function startMetronome() {
        if (metroPlaying) return;
        ensureMetroAudio();
        metroPlaying = true;
        metroCurrentStep = 0;
        metroNextNoteTime = metroAudioCtx.currentTime + 0.05;
        metroScheduler();
    }

    function stopMetronome() {
        metroPlaying = false;
        if (metroTimer) { clearTimeout(metroTimer); metroTimer = null; }
    }

    function openMetronomePanel() {
        var m = state.settings.metronome;
        var a = state.settings.appearance;
        var extraClass = "metronome-panel metro-pos-" + a.metronomePosition + " metro-size-" + a.metronomeSize;

        openModal(extraClass, function (panel, close) {
            var title = document.createElement("div");
            title.className = "backups-title";
            title.textContent = "Métronome";
            panel.appendChild(title);

            var bpmRow = document.createElement("div");
            bpmRow.className = "metro-bpm-row";
            var bpmDown10 = iconButton("−10", "Ralentir de 10", function () { setBpm(m.bpm - 10); });
            bpmDown10.classList.add("metro-bpm-btn", "metro-bpm-step10");
            var bpmDown = iconButton("−", "Ralentir", function () { setBpm(m.bpm - 1); });
            bpmDown.classList.add("metro-bpm-btn");
            var bpmValue = document.createElement("button");
            bpmValue.type = "button";
            bpmValue.className = "metro-bpm-value";
            bpmValue.title = "Cliquer pour saisir le BPM au clavier";
            bpmValue.addEventListener("click", startEditBpm);
            var bpmUp = iconButton("+", "Accélérer", function () { setBpm(m.bpm + 1); });
            bpmUp.classList.add("metro-bpm-btn");
            var bpmUp10 = iconButton("+10", "Accélérer de 10", function () { setBpm(m.bpm + 10); });
            bpmUp10.classList.add("metro-bpm-btn", "metro-bpm-step10");
            bpmRow.appendChild(bpmDown10);
            bpmRow.appendChild(bpmDown);
            bpmRow.appendChild(bpmValue);
            bpmRow.appendChild(bpmUp);
            bpmRow.appendChild(bpmUp10);
            panel.appendChild(bpmRow);

            function startEditBpm() {
                var input = document.createElement("input");
                input.type = "number";
                input.min = "30";
                input.max = "300";
                input.className = "metro-bpm-input";
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

            var bpmSlider = document.createElement("input");
            bpmSlider.type = "range";
            bpmSlider.min = "30";
            bpmSlider.max = "300";
            bpmSlider.className = "metro-bpm-slider";
            bpmSlider.addEventListener("input", function () { setBpm(parseInt(bpmSlider.value, 10)); });
            panel.appendChild(bpmSlider);

            // ---------- tap tempo ----------
            // Taper le rythme au doigt/clic déduit le BPM des écarts entre appuis, plutôt que de le
            // saisir au clavier. Une pause de plus de 2s entre deux appuis repart de zéro (on a
            // changé d'idée) au lieu de fausser la moyenne avec un tempo sans rapport.
            var tapTimes = [];
            var tapBtn = document.createElement("button");
            tapBtn.type = "button";
            tapBtn.className = "metro-mini-btn metro-tap-btn";
            tapBtn.textContent = "Tap tempo";
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

            var tapProgRow = document.createElement("div");
            tapProgRow.className = "metro-tap-progressive-row";
            tapProgRow.appendChild(tapBtn);
            panel.appendChild(tapProgRow);

            // ---------- tempo progressif ----------
            // Peu utilisé au quotidien (voir demande utilisateur) : bouton dédié qui replie/déplie
            // ses deux réglages plutôt que de les laisser en permanence dans le panneau principal.
            var progRow = document.createElement("div");
            progRow.className = "metro-progressive-row";
            var progToggle = document.createElement("button");
            progToggle.type = "button";
            progToggle.className = "metro-mini-btn metro-progressive-toggle";
            var progFields = document.createElement("div");
            progFields.className = "metro-progressive-fields";

            var progIncField = document.createElement("label");
            progIncField.className = "metro-progressive-field";
            progIncField.textContent = "+ BPM";
            var progIncInput = document.createElement("input");
            progIncInput.type = "number";
            progIncInput.min = "1";
            progIncInput.max = "50";
            progIncInput.value = m.progressive.incrementBpm;
            progIncInput.addEventListener("change", function () {
                m.progressive.incrementBpm = Math.max(1, parseInt(progIncInput.value, 10) || 5);
                progIncInput.value = m.progressive.incrementBpm;
                save();
            });
            progIncField.appendChild(progIncInput);
            progFields.appendChild(progIncField);

            var progEveryField = document.createElement("label");
            progEveryField.className = "metro-progressive-field";
            progEveryField.textContent = "Toutes les X mesures";
            var progEveryInput = document.createElement("input");
            progEveryInput.type = "number";
            progEveryInput.min = "1";
            progEveryInput.max = "64";
            progEveryInput.value = m.progressive.everyMeasures;
            progEveryInput.addEventListener("change", function () {
                m.progressive.everyMeasures = Math.max(1, parseInt(progEveryInput.value, 10) || 4);
                progEveryInput.value = m.progressive.everyMeasures;
                save();
            });
            progEveryField.appendChild(progEveryInput);
            progFields.appendChild(progEveryField);

            function refreshProgToggle() {
                progToggle.textContent = "Tempo progressif : " + (m.progressive.enabled ? "activé" : "désactivé");
                progToggle.classList.toggle("metro-progressive-active", m.progressive.enabled);
                progFields.hidden = !m.progressive.enabled;
            }
            progToggle.addEventListener("click", function () {
                m.progressive.enabled = !m.progressive.enabled;
                save();
                refreshProgToggle();
            });
            refreshProgToggle();
            progRow.appendChild(progFields);
            tapProgRow.appendChild(progToggle);
            panel.appendChild(progRow);

            var progMeasureCount = 0;
            metroMeasureCallback = function () {
                if (!m.progressive.enabled) return;
                progMeasureCount++;
                if (progMeasureCount >= m.progressive.everyMeasures) {
                    progMeasureCount = 0;
                    setBpm(m.bpm + m.progressive.incrementBpm);
                }
            };

            var fieldsRow = document.createElement("div");
            fieldsRow.className = "metro-fields-row";

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
                m.pattern = null; // sera reconstruit par normalizeMetronomeSettings, motif adapté à la nouvelle taille
                normalizeMetronomeSettings(state.settings);
                beatsInput.value = m.beatsPerMeasure;
                save();
                renderPad();
            });
            beatsField.appendChild(beatsInput);
            fieldsRow.appendChild(beatsField);

            var subField = document.createElement("label");
            subField.className = "metro-field";
            subField.textContent = "Subdivision";
            var subSelect = document.createElement("select");
            [[1, "Noire"], [2, "Croches"], [3, "Triolet"], [4, "Doubles-croches"]].forEach(function (opt) {
                var o = document.createElement("option");
                o.value = opt[0];
                o.textContent = opt[1];
                if (m.subdivision === opt[0]) o.selected = true;
                subSelect.appendChild(o);
            });
            subSelect.addEventListener("change", function () {
                m.subdivision = parseInt(subSelect.value, 10);
                m.pattern = null;
                normalizeMetronomeSettings(state.settings);
                save();
                renderPad();
            });
            subField.appendChild(subSelect);
            fieldsRow.appendChild(subField);

            // Le réglage de volume est discret : juste une icône, à droite de la subdivision. La
            // barre ne se déplie (en pleine largeur, sous les champs) que sur clic, sinon elle
            // serait en permanence visible alors qu'on y touche rarement.
            var volumeField = document.createElement("div");
            volumeField.className = "metro-volume-field";
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
            var volumeRow = document.createElement("div");
            volumeRow.className = "metro-volume-row";
            var volumeBtn = svgIconButton(METRO_VOLUME_ICON_SVG, "Volume", function () {
                volumeRow.classList.toggle("metro-volume-expanded");
                if (volumeRow.classList.contains("metro-volume-expanded")) volumeSlider.focus();
            });
            volumeBtn.classList.add("metro-volume-btn");
            volumeField.appendChild(volumeBtn);
            fieldsRow.appendChild(volumeField);

            panel.appendChild(fieldsRow);

            volumeRow.appendChild(volumeSlider);
            panel.appendChild(volumeRow);

            // ---------- pavé rythmique ----------
            // Un pas par case, groupées par temps : clique une case pour la faire tourner entre
            // silence / normal / fort. De quoi composer n'importe quel groove (double-croches pour
            // un shuffle, ne garder que les contretemps pour s'entraîner dessus, etc.), pas
            // seulement accentuer le 1er temps de la mesure.
            var padLabel = document.createElement("div");
            padLabel.className = "section-label metro-pad-label";
            padLabel.textContent = "Pavé rythmique";
            panel.appendChild(padLabel);

            var padRow = document.createElement("div");
            padRow.className = "metro-pad";
            panel.appendChild(padRow);

            var resetPadBtn = document.createElement("button");
            resetPadBtn.type = "button";
            resetPadBtn.className = "metro-mini-btn metro-pad-reset";
            resetPadBtn.textContent = "Réinitialiser";
            resetPadBtn.title = "Revenir au 1er temps accentué";
            resetPadBtn.addEventListener("click", function () {
                for (var i = 0; i < m.pattern.length; i++) m.pattern[i] = i === 0 ? 2 : (i % m.subdivision === 0 ? 1 : 0);
                save();
                renderPad();
            });
            panel.appendChild(resetPadBtn);

            // Le pavé est groupé par temps (un mini-groupe de `subdivision` pas), et ces groupes
            // sont eux-mêmes répartis en lignes de longueur égale (ex. 4 temps -> 2 en haut, 2 en
            // bas) plutôt que laissés au retour à la ligne du flex-wrap, qui casserait au milieu
            // d'un temps et donnerait un rendu asymétrique sur petit écran (doubles-croches...).
            function renderPad() {
                padRow.innerHTML = "";
                var beats = m.beatsPerMeasure;
                var totalSteps = m.pattern.length;
                var rows = totalSteps > 8 ? Math.min(beats, Math.ceil(totalSteps / 8)) : 1;
                var beatsPerRowBase = Math.floor(beats / rows);
                var extra = beats % rows;
                var beatIdx = 0;
                for (var r = 0; r < rows; r++) {
                    var rowBeats = beatsPerRowBase + (r < extra ? 1 : 0);
                    var rowEl = document.createElement("div");
                    rowEl.className = "metro-pad-row";
                    for (var b = 0; b < rowBeats; b++) {
                        var groupEl = document.createElement("div");
                        groupEl.className = "metro-beat-group";
                        for (var s = 0; s < m.subdivision; s++) {
                            (function (idx) {
                                var step = document.createElement("button");
                                step.type = "button";
                                step.className = "metro-step metro-step-" + m.pattern[idx];
                                step.title = (s === 0 ? "Temps " + (beatIdx + 1) : "Pas " + (idx + 1)) + " : silence / normal / fort";
                                step.addEventListener("click", function () {
                                    m.pattern[idx] = (m.pattern[idx] + 1) % 3;
                                    save();
                                    renderPad();
                                });
                                groupEl.appendChild(step);
                            })(beatIdx * m.subdivision + s);
                        }
                        rowEl.appendChild(groupEl);
                        beatIdx++;
                    }
                    padRow.appendChild(rowEl);
                }
            }
            renderPad();
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
            panel.appendChild(chronoRow);

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

            var playBtn = document.createElement("button");
            playBtn.type = "button";
            playBtn.className = "metro-play-btn";
            var playBtnIcon = document.createElement("span");
            playBtnIcon.className = "metro-play-btn-icon";
            var playBtnLabel = document.createElement("span");
            playBtn.appendChild(playBtnIcon);
            playBtn.appendChild(playBtnLabel);
            function refreshPlayBtn() {
                playBtn.classList.toggle("metro-play-btn-active", metroPlaying);
                playBtnIcon.innerHTML = metroPlaying ? METRO_STOP_ICON_SVG : METRO_PLAY_ICON_SVG;
                playBtnLabel.textContent = metroPlaying ? "Arrêter" : "Jouer";
            }
            refreshPlayBtn();
            playBtn.addEventListener("click", function () {
                if (metroPlaying) { stopMetronome(); stopChrono(); } else { progMeasureCount = 0; startMetronome(); startChrono(); }
                refreshPlayBtn();
            });
            panel.appendChild(playBtn);

            function setBpm(v) {
                v = Math.min(300, Math.max(30, v));
                m.bpm = v;
                save();
                refreshBpmUI();
            }
            function refreshBpmUI() {
                bpmValue.textContent = m.bpm + " BPM";
                bpmSlider.value = m.bpm;
            }
            refreshBpmUI();

            // On arrête le métronome en fermant le panneau : pas de son qui continue en arrière-plan
            // sans qu'on le voie.
            return function () {
                stopMetronome();
                if (chronoInterval) clearInterval(chronoInterval);
                metroBeatCallback = null;
                metroMeasureCallback = null;
            };
        });
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

    var SCALE_DEFS = [
        { key: "major", kind: "Gammes", label: "Majeur (Ionien)", semis: [0, 2, 4, 5, 7, 9, 11], degrees: ["1", "2", "3", "4", "5", "6", "7"] },
        { key: "dorian", kind: "Gammes", label: "Dorien", semis: [0, 2, 3, 5, 7, 9, 10], degrees: ["1", "2", "♭3", "4", "5", "6", "♭7"] },
        { key: "phrygian", kind: "Gammes", label: "Phrygien", semis: [0, 1, 3, 5, 7, 8, 10], degrees: ["1", "♭2", "♭3", "4", "5", "♭6", "♭7"] },
        { key: "lydian", kind: "Gammes", label: "Lydien", semis: [0, 2, 4, 6, 7, 9, 11], degrees: ["1", "2", "3", "♯4", "5", "6", "7"] },
        { key: "mixolydian", kind: "Gammes", label: "Mixolydien", semis: [0, 2, 4, 5, 7, 9, 10], degrees: ["1", "2", "3", "4", "5", "6", "♭7"] },
        { key: "aeolian", kind: "Gammes", label: "Mineur naturel (Éolien)", semis: [0, 2, 3, 5, 7, 8, 10], degrees: ["1", "2", "♭3", "4", "5", "♭6", "♭7"] },
        { key: "locrian", kind: "Gammes", label: "Locrien", semis: [0, 1, 3, 5, 6, 8, 10], degrees: ["1", "♭2", "♭3", "4", "♭5", "♭6", "♭7"] },
        { key: "harmonicMinor", kind: "Gammes", label: "Mineur harmonique", semis: [0, 2, 3, 5, 7, 8, 11], degrees: ["1", "2", "♭3", "4", "5", "♭6", "7"] },
        { key: "melodicMinor", kind: "Gammes", label: "Mineur mélodique", semis: [0, 2, 3, 5, 7, 9, 11], degrees: ["1", "2", "♭3", "4", "5", "6", "7"] },
        { key: "majorPenta", kind: "Gammes", label: "Pentatonique majeure", semis: [0, 2, 4, 7, 9], degrees: ["1", "2", "3", "5", "6"] },
        { key: "minorPenta", kind: "Gammes", label: "Pentatonique mineure", semis: [0, 3, 5, 7, 10], degrees: ["1", "♭3", "4", "5", "♭7"] },
        { key: "blues", kind: "Gammes", label: "Blues", semis: [0, 3, 5, 6, 7, 10], degrees: ["1", "♭3", "4", "♭5", "5", "♭7"] },
        { key: "wholeTone", kind: "Gammes", label: "Gamme par tons", semis: [0, 2, 4, 6, 8, 10], degrees: ["1", "2", "3", "4", "5", "6"] },
        { key: "triadMaj", kind: "Arpèges", label: "Triade majeure", semis: [0, 4, 7], degrees: ["1", "3", "5"] },
        { key: "triadMin", kind: "Arpèges", label: "Triade mineure", semis: [0, 3, 7], degrees: ["1", "♭3", "5"] },
        { key: "triadDim", kind: "Arpèges", label: "Triade diminuée", semis: [0, 3, 6], degrees: ["1", "♭3", "♭5"] },
        { key: "triadAug", kind: "Arpèges", label: "Triade augmentée", semis: [0, 4, 8], degrees: ["1", "3", "♯5"] },
        { key: "maj7", kind: "Arpèges", label: "Septième majeure (maj7)", semis: [0, 4, 7, 11], degrees: ["1", "3", "5", "7"] },
        { key: "dom7", kind: "Arpèges", label: "Septième de dominante (7)", semis: [0, 4, 7, 10], degrees: ["1", "3", "5", "♭7"] },
        { key: "min7", kind: "Arpèges", label: "Septième mineure (m7)", semis: [0, 3, 7, 10], degrees: ["1", "♭3", "5", "♭7"] },
        { key: "min7b5", kind: "Arpèges", label: "Demi-diminuée (m7♭5)", semis: [0, 3, 6, 10], degrees: ["1", "♭3", "♭5", "♭7"] },
        { key: "dim7", kind: "Arpèges", label: "Diminuée 7 (dim7)", semis: [0, 3, 6, 9], degrees: ["1", "♭3", "♭5", "6"] },
        { key: "minMaj7", kind: "Arpèges", label: "Mineure/majeure 7 (mMaj7)", semis: [0, 3, 7, 11], degrees: ["1", "♭3", "5", "7"] }
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

    function buildFretboardSvg(tuning, def, rootPc, labelMode) {
        var ns = "http://www.w3.org/2000/svg";
        // Espacements volontairement plus généreux que des proportions "réalistes" de manche
        // (stringGap > fretGap/2, au lieu d'un vrai manche plus large que haut) : le but est que les
        // pastilles de notes ne se touchent jamais, pas de reproduire un vrai manche à l'échelle.
        var stringGap = 26, fretGap = 38, marginLeft = 24, marginTop = 10, labelRowH = 16;
        var n = tuning.midis.length;
        var stringsSpan = stringGap * (n - 1);
        var width = marginLeft + fretGap * FRETBOARD_DISPLAY_FRETS + 8;
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
        for (var c = 1; c <= FRETBOARD_DISPLAY_FRETS; c++) {
            var x = marginLeft + c * fretGap;
            svg.appendChild(el("line", { x1: x, y1: marginTop, x2: x, y2: marginTop + stringsSpan, class: "fretboard-fret" }));
        }
        for (var s = 0; s < n; s++) {
            var y = stringY(s);
            svg.appendChild(el("line", { x1: marginLeft, y1: y, x2: marginLeft + fretGap * FRETBOARD_DISPLAY_FRETS, y2: y, class: "fretboard-string" }));
        }
        var midY = marginTop + stringsSpan / 2;
        var labelY = marginTop + stringsSpan + 11;
        FRETBOARD_SINGLE_MARKERS.forEach(function (fret) {
            var mx = marginLeft + (fret - 0.5) * fretGap;
            svg.appendChild(el("circle", { cx: mx, cy: midY, r: 3, class: "fretboard-inlay" }));
            svg.appendChild(el("text", { x: mx, y: labelY, class: "fretboard-fret-label" })).textContent = fret;
        });
        FRETBOARD_DOUBLE_MARKERS.forEach(function (fret) {
            var mx = marginLeft + (fret - 0.5) * fretGap;
            svg.appendChild(el("circle", { cx: mx, cy: midY - stringGap, r: 3, class: "fretboard-inlay" }));
            svg.appendChild(el("circle", { cx: mx, cy: midY + stringGap, r: 3, class: "fretboard-inlay" }));
            svg.appendChild(el("text", { x: mx, y: labelY, class: "fretboard-fret-label" })).textContent = fret;
        });

        for (var s2 = 0; s2 < n; s2++) {
            for (var fret2 = 0; fret2 <= FRETBOARD_DISPLAY_FRETS; fret2++) {
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
        { key: "bass4", label: "Basse (4 cordes)", type: "fretboard", tuning: FRETBOARD_TUNINGS[0] },
        { key: "bass5", label: "Basse (5 cordes)", type: "fretboard", tuning: FRETBOARD_TUNINGS[1] },
        { key: "guitar", label: "Guitare", type: "fretboard", tuning: FRETBOARD_TUNINGS[2] },
        { key: "piano", label: "Piano", type: "piano" }
    ];

    function openScalesPanel() {
        openModal("scales-panel", function (panel) {
            var title = document.createElement("div");
            title.className = "backups-title";
            title.textContent = "Gammes & arpèges";
            panel.appendChild(title);

            // Ordre logique : d'abord la tonique, puis ce qu'on construit dessus (gamme/arpège),
            // enfin sur quel instrument le voir — chaque menu porte son étiquette, plutôt qu'une
            // rangée de select nus dont l'ordre/le rôle ne sont pas évidents au premier coup d'œil.
            function selectField(labelText, select) {
                var field = document.createElement("label");
                field.className = "scales-field";
                var span = document.createElement("span");
                span.className = "scales-field-label";
                span.textContent = labelText;
                field.appendChild(span);
                field.appendChild(select);
                return field;
            }

            var controlsRow = document.createElement("div");
            controlsRow.className = "scales-controls-row";

            var rootSelect = document.createElement("select");
            NOTE_NAMES_SHARP.forEach(function (name, pc) {
                var o = document.createElement("option");
                o.value = pc;
                o.textContent = name;
                rootSelect.appendChild(o);
            });
            controlsRow.appendChild(selectField("Tonique", rootSelect));

            var typeSelect = document.createElement("select");
            var currentGroup = null, optgroup = null;
            SCALE_DEFS.forEach(function (def) {
                if (def.kind !== currentGroup) {
                    currentGroup = def.kind;
                    optgroup = document.createElement("optgroup");
                    optgroup.label = def.kind;
                    typeSelect.appendChild(optgroup);
                }
                var o = document.createElement("option");
                o.value = def.key;
                o.textContent = def.label;
                optgroup.appendChild(o);
            });
            controlsRow.appendChild(selectField("Gamme / arpège", typeSelect));

            var instrumentSelect = document.createElement("select");
            SCALES_INSTRUMENTS.forEach(function (inst) {
                var o = document.createElement("option");
                o.value = inst.key;
                o.textContent = inst.label;
                instrumentSelect.appendChild(o);
            });
            controlsRow.appendChild(selectField("Instrument", instrumentSelect));
            panel.appendChild(controlsRow);

            var labelModeRow = document.createElement("div");
            labelModeRow.className = "scales-label-mode-row";
            var labelMode = "degrees";
            var intervalsBtn = document.createElement("button");
            intervalsBtn.type = "button";
            intervalsBtn.className = "metro-mini-btn scales-label-btn";
            intervalsBtn.textContent = "Intervalles";
            var notesBtn = document.createElement("button");
            notesBtn.type = "button";
            notesBtn.className = "metro-mini-btn scales-label-btn";
            notesBtn.textContent = "Noms des notes";
            labelModeRow.appendChild(intervalsBtn);
            labelModeRow.appendChild(notesBtn);
            panel.appendChild(labelModeRow);

            var diagramsWrap = document.createElement("div");
            diagramsWrap.className = "scales-diagrams";
            panel.appendChild(diagramsWrap);

            function refreshLabelButtons() {
                intervalsBtn.classList.toggle("scales-label-btn-active", labelMode === "degrees");
                notesBtn.classList.toggle("scales-label-btn-active", labelMode === "notes");
            }
            intervalsBtn.addEventListener("click", function () { labelMode = "degrees"; refreshLabelButtons(); renderDiagram(); });
            notesBtn.addEventListener("click", function () { labelMode = "notes"; refreshLabelButtons(); renderDiagram(); });
            refreshLabelButtons();

            function renderDiagram() {
                diagramsWrap.innerHTML = "";
                var rootPc = parseInt(rootSelect.value, 10);
                var def = SCALE_DEFS.filter(function (d) { return d.key === typeSelect.value; })[0] || SCALE_DEFS[0];
                var inst = SCALES_INSTRUMENTS.filter(function (i) { return i.key === instrumentSelect.value; })[0] || SCALES_INSTRUMENTS[0];
                var scroll = document.createElement("div");
                scroll.className = "fretboard-scroll";
                scroll.appendChild(inst.type === "piano" ? buildPianoScaleSvg(def, rootPc, labelMode) : buildFretboardSvg(inst.tuning, def, rootPc, labelMode));
                diagramsWrap.appendChild(scroll);
            }
            rootSelect.addEventListener("change", renderDiagram);
            typeSelect.addEventListener("change", renderDiagram);
            instrumentSelect.addEventListener("change", renderDiagram);
            renderDiagram();
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

    // Détection de fréquence par autocorrélation temporelle (technique standard pour un accordeur :
    // on cherche le décalage qui fait le mieux correspondre le signal avec lui-même, ce décalage
    // correspond à la période du son). Renvoie -1 si le signal est trop faible pour être fiable.
    function autoCorrelateFrequency(buf, sampleRate) {
        var size = buf.length;
        var rms = 0;
        for (var i = 0; i < size; i++) rms += buf[i] * buf[i];
        rms = Math.sqrt(rms / size);
        if (rms < 0.01) return -1;

        var threshold = 0.2, start = 0, end = size - 1;
        for (var a = 0; a < size / 2; a++) { if (Math.abs(buf[a]) >= threshold) { start = a; break; } }
        for (var b = size - 1; b > size / 2; b--) { if (Math.abs(buf[b]) >= threshold) { end = b; break; } }
        var trimmed = buf.slice(start, end);
        var n = trimmed.length;
        if (n < 8) return -1;

        var corr = new Array(n).fill(0);
        for (var lag = 0; lag < n; lag++) {
            for (var j = 0; j < n - lag; j++) corr[lag] += trimmed[j] * trimmed[j + lag];
        }
        var d = 0;
        while (d < n - 1 && corr[d] > corr[d + 1]) d++;
        var bestLag = -1, bestVal = -1;
        for (var k = d; k < n; k++) {
            if (corr[k] > bestVal) { bestVal = corr[k]; bestLag = k; }
        }
        if (bestLag <= 0) return -1;
        // Interpolation parabolique autour du pic pour affiner la période au-delà de la résolution
        // entière de l'échantillonnage.
        var x1 = corr[bestLag - 1] || 0, x2 = corr[bestLag], x3 = corr[bestLag + 1] || 0;
        var a2 = (x1 + x3 - 2 * x2) / 2, b2 = (x3 - x1) / 2;
        var refinedLag = a2 ? bestLag - b2 / (2 * a2) : bestLag;
        return sampleRate / refinedLag;
    }

    function freqToNoteInfo(freq) {
        var noteNum = 12 * (Math.log(freq / 440) / Math.log(2));
        var midi = Math.round(69 + noteNum);
        var cents = Math.round((69 + noteNum - midi) * 100);
        return { midi: midi, name: midiNoteName(midi), octave: Math.floor(midi / 12) - 1, cents: cents };
    }

    function openTunerPanel() {
        openModal("tuner-panel", function (panel, close) {
            var title = document.createElement("div");
            title.className = "backups-title";
            title.textContent = "Accordeur";
            panel.appendChild(title);

            var sourceEl = document.createElement("div");
            sourceEl.className = "tuner-source";
            sourceEl.textContent = "Démarrage…";
            panel.appendChild(sourceEl);

            var display = document.createElement("div");
            display.className = "tuner-display";
            var noteEl = document.createElement("div");
            noteEl.className = "tuner-note";
            noteEl.textContent = "—";
            var freqEl = document.createElement("div");
            freqEl.className = "tuner-freq";
            display.appendChild(noteEl);
            display.appendChild(freqEl);
            panel.appendChild(display);

            var needleTrack = document.createElement("div");
            needleTrack.className = "tuner-needle-track";
            var needleCenter = document.createElement("div");
            needleCenter.className = "tuner-needle-center";
            needleTrack.appendChild(needleCenter);
            var needle = document.createElement("div");
            needle.className = "tuner-needle";
            needleTrack.appendChild(needle);
            panel.appendChild(needleTrack);

            var audioCtx = null, analyser = null, source = null, currentStream = null, rafId = null;

            function stopAudio() {
                if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
                if (currentStream) { currentStream.getTracks().forEach(function (t) { t.stop(); }); currentStream = null; }
                if (source) { source.disconnect(); source = null; }
                if (audioCtx) { audioCtx.close(); audioCtx = null; }
            }

            function connectStream(stream) {
                if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 2048;
                source = audioCtx.createMediaStreamSource(stream);
                source.connect(analyser);
                currentStream = stream;
                var buf = new Float32Array(analyser.fftSize);
                function loop() {
                    analyser.getFloatTimeDomainData(buf);
                    var freq = autoCorrelateFrequency(buf, audioCtx.sampleRate);
                    if (freq !== -1 && freq > 25 && freq < 2000) {
                        var info = freqToNoteInfo(freq);
                        noteEl.textContent = info.name + info.octave;
                        freqEl.textContent = freq.toFixed(1) + " Hz · " + (info.cents > 0 ? "+" : "") + info.cents + " cents";
                        var clamped = Math.max(-50, Math.min(50, info.cents));
                        needle.style.transform = "translateX(-50%) rotate(" + (clamped * 0.9) + "deg)";
                        needle.classList.toggle("tuner-needle-in-tune", Math.abs(info.cents) <= 5);
                    }
                    rafId = requestAnimationFrame(loop);
                }
                loop();
            }

            // Démarrage automatique dès l'ouverture, sans rien à choisir d'abord (comme GarageBand) :
            // le navigateur utilise l'entrée par défaut du système (micro ou carte son déjà
            // sélectionnée dans l'OS), on se contente d'indiquer laquelle d'après son nom.
            navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
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
    var gsLinksChecked = {}; // clé "link:<id>"/"file:<id>" -> coché ou non, le temps de l'écran

    function sessionTotalMinutes(session) {
        return session.steps.reduce(function (sum, s) { return sum + s.minutes; }, 0);
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
    function appendReadOnlyResourceChips(container, ex) {
        (ex.links || []).forEach(function (link) {
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

    // Ouvre plusieurs liens/fichiers d'un coup dans des onglets séparés. Les onglets sont ouverts
    // tout de suite, de façon synchrone dans le clic (sinon le navigateur bloque les popups
    // ouverts depuis un callback asynchrone comme la lecture d'un fichier dans IndexedDB) ; leur
    // contenu (URL du lien, ou blob du fichier une fois lu) est posé dessus une fois prêt.
    function gsOpenItems(items) {
        items.forEach(function (item) {
            var win = window.open("", "_blank");
            if (item.type === "link") {
                if (win) win.location.href = item.url;
            } else {
                getFileBlob(item.meta.id).then(function (blob) {
                    if (!blob) { if (win) win.close(); return; }
                    var url = URL.createObjectURL(blob);
                    if (win) win.location.href = url;
                    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
                });
            }
        });
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

        if (gsScreen === "run" && gsRunSession) renderGsRunScreen(content);
        else if (gsScreen === "links" && gsRunSession) renderGsLinksScreen(content);
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
                var delBtn = iconButton("✕", "Supprimer cette session", function () {
                    if (!window.confirm("Supprimer la session « " + session.name + " » ?")) return;
                    addToTrash("session", session, {});
                    sessions.splice(sessions.indexOf(session), 1);
                    save();
                    render();
                });
                actions.appendChild(playBtn);
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

        var pdfBtn = document.createElement("button");
        pdfBtn.type = "button";
        pdfBtn.className = "btn-ghost gs-pdf-btn";
        pdfBtn.textContent = "Enregistrer sous PDF";
        pdfBtn.addEventListener("click", function () { exportSessionPdf(session); });
        content.appendChild(pdfBtn);

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
                var removeBtn = iconButton("✕", "Retirer cet exercice", function () {
                    session.steps.splice(session.steps.indexOf(step), 1);
                    save();
                    renderSteps();
                    refreshTotal();
                });
                row.appendChild(removeBtn);
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
    }

    function gsRunElapsedNowMs() {
        return gsRunElapsedMs + (gsRunPaused ? 0 : Date.now() - gsRunStartTs);
    }

    function gsPauseRun() {
        if (gsRunPaused) return;
        gsRunElapsedMs += Date.now() - gsRunStartTs;
        gsRunPaused = true;
    }

    function gsResumeRun() {
        if (!gsRunPaused) return;
        gsRunStartTs = Date.now();
        gsRunPaused = false;
    }

    function gsEndRun() {
        if (gsRunInterval) { clearInterval(gsRunInterval); gsRunInterval = null; }
        gsRunSession = null;
        gsScreen = "list";
        render();
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
        if (found) {
            var resourcesRow = document.createElement("div");
            resourcesRow.className = "links-list gs-run-resources";
            appendReadOnlyResourceChips(resourcesRow, found.ex);
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
        }));
        adjustRow.appendChild(iconButton("+1 min", "Ajouter une minute à cet exercice (juste pour cette fois)", function () {
            gsRunAllocatedSec += 60;
            refreshTimer();
        }));
        content.appendChild(adjustRow);

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
        pauseBtn.addEventListener("click", function () {
            if (gsRunPaused) gsResumeRun(); else gsPauseRun();
            refreshPauseBtn();
        });
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
        linksBtn.addEventListener("click", function () { gsScreen = "links"; render(); });
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
    }

    // ---- écran "ouvrir des liens/pièces jointes" (tous les exercices de la session) ----
    function renderGsLinksScreen(content) {
        var session = gsRunSession;

        var backBtn = document.createElement("button");
        backBtn.type = "button";
        backBtn.className = "btn-ghost gs-back-btn";
        backBtn.textContent = "← Retour au guidage";
        backBtn.addEventListener("click", function () { gsScreen = "run"; render(); });
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
            var items = [];
            (found.ex.links || []).forEach(function (link) { items.push({ type: "link", key: "link:" + link.id, label: link.label, url: link.url }); });
            (found.ex.files || []).forEach(function (meta) { items.push({ type: "file", key: "file:" + meta.id, label: meta.name, meta: meta }); });
            if (!items.length) return;

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

        var openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "btn-accent gs-links-open-btn";
        openBtn.textContent = "Ouvrir la sélection";
        openBtn.addEventListener("click", function () {
            gsOpenItems(allItems.filter(function (item) { return gsLinksChecked[item.key]; }));
        });
        content.appendChild(openBtn);
    }

    // Une session en cours ne doit pas continuer à décompter pendant qu'on est ailleurs (un autre
    // onglet, une appli, l'écran verrouillé) : on la met en pause dès que la page n'est plus
    // visible. Reprise toujours manuelle (bouton Reprendre), pour ne pas relancer le chrono par
    // surprise au retour.
    document.addEventListener("visibilitychange", function () {
        if (document.hidden && gsRunSession && !gsRunPaused) {
            gsPauseRun();
            if (guidedSessionViewActive && gsScreen === "run") render();
        }
    });

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
