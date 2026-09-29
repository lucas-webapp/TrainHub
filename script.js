(function () {
    "use strict";

    var STORAGE_KEY = "trainhub.v1";
    var DEFAULT_CATEGORIES = ["Technique", "Gammes", "Improvisation", "Jeu en groupe", "Copie de morceaux"];
    var DEFAULT_INSTRUMENTS = ["Basse", "Guitare", "Piano"];
    var FOLDER_PALETTE = ["#00e676", "#a78bfa", "#f472b6", "#2dd4bf", "#fb923c", "#f87171"];
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

    function makeFolder(name, color) {
        var f = { id: uid(), name: name, folders: [], exercises: [] };
        if (color) f.color = color;
        return f;
    }

    function makeInstrument(name) {
        var categories = DEFAULT_CATEGORIES.map(function (catName, i) {
            return makeFolder(catName, FOLDER_PALETTE[i % FOLDER_PALETTE.length]);
        });
        return { id: uid(), name: name, categories: categories };
    }

    function makeDefaultState() {
        var instruments = DEFAULT_INSTRUMENTS.map(makeInstrument);
        return { activeInstrumentId: instruments[0].id, instruments: instruments, updatedAt: 0, settings: { showUpdatedAt: false } };
    }

    function normalizeFolder(f) {
        if (!Array.isArray(f.folders)) f.folders = [];
        if (!Array.isArray(f.exercises)) f.exercises = [];
        f.folders.forEach(normalizeFolder);
        f.exercises.forEach(function (ex) {
            if (!Array.isArray(ex.links)) ex.links = [];
            // Fichiers (PDF/MP3) joints à l'exercice : seules les métadonnées sont stockées dans
            // l'état (donc synchronisées) — le contenu réel du fichier vit dans IndexedDB, sur cet
            // appareil uniquement (voir bloc "fichiers joints" plus bas).
            if (!Array.isArray(ex.files)) ex.files = [];
            // Remplace les statuts (à faire/en cours/terminé/à revoir), jugés trop compliqués au
            // quotidien : juste deux cases à cocher, accessibles par clic droit/appui long.
            if (typeof ex.favorite !== "boolean") ex.favorite = false;
            if (typeof ex.archived !== "boolean") ex.archived = false;
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

    function normalizeState(s) {
        if (!s.settings || typeof s.settings !== "object") s.settings = { showUpdatedAt: false };
        if (typeof s.settings.showUpdatedAt !== "boolean") s.settings.showUpdatedAt = false;
        if (!Array.isArray(s.instruments)) s.instruments = [];
        s.instruments.forEach(function (inst) {
            if (!Array.isArray(inst.categories)) inst.categories = [];
            // La couleur se pose sur les grands chapitres (repérage des dossiers/sous-dossiers),
            // pas sur l'instrument : les 3 instruments partagent la même identité visuelle.
            inst.categories.forEach(function (cat, i) {
                if (!cat.color) cat.color = FOLDER_PALETTE[i % FOLDER_PALETTE.length];
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
    var HISTORY_LIMIT = 50;
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

    function bindFolderMenu(el, getParentArray, folder, inst) {
        bindContextGesture(el, function (x, y) { openFolderMenu(x, y, getParentArray, folder, inst); });
    }

    function bindExerciseMenu(el, ex) {
        bindContextGesture(el, function (x, y) { openExerciseMenu(x, y, ex); });
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
        var pos = parentArray.indexOf(folder);
        if (pos !== -1) parentArray.splice(pos, 1);
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
            if (canAddSub) menu.appendChild(menuButton("Nouveau sous-dossier", "", showAddSub));
            menu.appendChild(menuButton("Renommer", "", showRename));
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
    function openExerciseMenu(x, y, ex) {
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

        function onKey(e) { if (e.key === "Escape") closeFolderMenu(); }

        document.body.appendChild(backdrop);
        document.body.appendChild(menu);
        document.addEventListener("keydown", onKey, true);
        openMenu = { backdrop: backdrop, menu: menu, onKey: onKey };
        place();
    }

    function setupDragReorder(container, itemSelector, getArray, axis) {
        var dragEl = null;
        var startX = 0, startY = 0;
        var moved = false;

        function directChildren() {
            return Array.prototype.filter.call(container.children, function (el) { return el.matches(itemSelector); });
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
            }
            moved = true;
            dragEl.classList.add("dragging");
            var siblings = directChildren().filter(function (el) { return el !== dragEl; });
            for (var i = 0; i < siblings.length; i++) {
                var rect = siblings[i].getBoundingClientRect();
                var mid = axis === "x" ? (rect.left + rect.width / 2) : (rect.top + rect.height / 2);
                var pos = axis === "x" ? e.clientX : e.clientY;
                if (pos < mid) {
                    container.insertBefore(dragEl, siblings[i]);
                    return;
                }
            }
            container.appendChild(dragEl);
        });

        // `arr` peut être un tableau d'objets {id, ...} (dossiers, exercices) ou directement un
        // tableau d'identifiants bruts (l'ordre des chapitres, réels + virtuels — voir pinnedOrder).
        function idOf(x) { return (x && typeof x === "object") ? x.id : x; }

        function finish() {
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
    var $toggleUpdatedAt = document.getElementById("toggle-updated-at-btn");
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
        var inst = getActiveInstrument();
        var path = inst ? getNavPath(inst) : [];
        var rootChapter = inst && path.length ? findById(inst.categories, path[0]) : null;
        var accent = path[0] === FAVORITES_ID ? "#ffd60a" : path[0] === ARCHIVED_ID ? "#9ca3af" : ((rootChapter && rootChapter.color) || "#00e676");
        document.documentElement.style.setProperty("--chapter-accent", accent);
        renderInstrumentSelect();
        renderChapterBar();
        renderSidebarTree();
        renderMain();
        updateUndoRedoButtons();
        autoGrowAllNotes();
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
            var chapter = makeFolder(name, FOLDER_PALETTE[inst.categories.length % FOLDER_PALETTE.length]);
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
            var chapter = makeFolder(name, FOLDER_PALETTE[inst.categories.length % FOLDER_PALETTE.length]);
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

        // Le champ "Nouveau sous-dossier" n'apparaît que sous le dossier sélectionné, pour garder
        // l'arborescence épurée (ailleurs : clic droit / appui long → "Nouveau sous-dossier").
        var canAdd = isSelected && fullPath.length < MAX_FOLDER_DEPTH;
        if (expanded && (hasChildren || canAdd)) {
            var childWrap = document.createElement("div");
            childWrap.className = "tree-children";
            folder.folders.forEach(function (child) {
                childWrap.appendChild(renderTreeNode(inst, child, fullPath, currentPath, rootColor, depth + 1));
            });
            if (canAdd) {
                childWrap.appendChild(renderTreeAddFolder(folder));
            }
            wrap.appendChild(childWrap);
            if (hasChildren) setupDragReorder(childWrap, ".tree-node", function () { return folder.folders; }, "y");
        }

        return wrap;
    }

    function renderTreeAddFolder(parentFolder) {
        var wrap = document.createElement("div");
        wrap.className = "tree-add-row";
        var input = document.createElement("input");
        input.type = "text";
        input.className = "tree-add-input";
        input.placeholder = "Nouveau sous-dossier…";
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tree-add-btn";
        btn.textContent = "+";
        btn.title = "Ajouter le sous-dossier";
        function commit() {
            var name = input.value.trim();
            if (!name) return;
            parentFolder.folders.push(makeFolder(name));
            save();
            render();
        }
        btn.addEventListener("click", commit);
        input.addEventListener("keydown", function (e) {
            e.stopPropagation();
            if (e.key === "Enter") commit();
        });
        wrap.appendChild(input);
        wrap.appendChild(btn);
        return wrap;
    }

    function renderMain() {
        var inst = getActiveInstrument();
        $empty.hidden = true;
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
    function renderVirtualChapterView(inst, kind) {
        $contentHeading.innerHTML = "";
        var h2 = document.createElement("h2");
        h2.textContent = kind === ARCHIVED_ID ? "Archivés" : "★ Favoris";
        $contentHeading.appendChild(h2);

        var results = kind === ARCHIVED_ID
            ? collectExercises(inst, function (ex) { return ex.archived; })
            : collectExercises(inst, function (ex) { return ex.favorite && !ex.archived; });
        var emptyText = kind === ARCHIVED_ID
            ? "Aucun exercice archivé pour l'instant. Range-en un depuis son menu (clic droit ou appui long dessus)."
            : "Aucun favori pour l'instant. Marque un exercice en favori depuis son menu (clic droit ou appui long dessus).";
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
            $empty.textContent = "Crée ton premier grand chapitre ci-dessus (Technique, Morceaux, Gammes…).";
            return;
        }

        renderBreadcrumb(inst, nodes);

        var currentFolder = nodes[nodes.length - 1];
        var depth = nodes.length;

        renderContentHeading(currentFolder, function () { return getParentArrayFor(inst, path.slice(0, -1)); }, inst);
        $folderContainer.innerHTML = "";

        // Sous-dossiers du dossier courant, dans le MÊME ordre que l'arborescence de gauche (même
        // tableau de données) : la zone principale reflète exactement la branche sélectionnée.
        if (currentFolder.folders.length) {
            var foldersGroup = document.createElement("div");
            foldersGroup.className = "section-group";
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
            $folderContainer.appendChild(foldersGroup);
            setupDragReorder(foldersWrap, ".folder-row", function () { return currentFolder.folders; }, "y");
        }

        if (depth < MAX_FOLDER_DEPTH) {
            $folderContainer.appendChild(renderAddFolderForm(currentFolder));
        }

        var exGroup = document.createElement("div");
        exGroup.className = "section-group";
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
        $folderContainer.appendChild(exGroup);
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
            return !query || ex.title.toLowerCase().indexOf(query) !== -1;
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
        bindExerciseMenu(row, ex);
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
        title.addEventListener("change", function () {
            ex.title = title.value.trim() || ex.title;
            touchExercise(ex);
            save();
        });
        row.appendChild(title);

        if (ex.archived) {
            var archBadge = document.createElement("span");
            archBadge.className = "exercise-archived-badge";
            archBadge.textContent = "Archivé";
            row.appendChild(archBadge);
        }

        var delBtn = iconButton("✕", "Supprimer l'exercice", function () {
            if (!window.confirm("Supprimer « " + ex.title + " » ?")) return;
            (ex.files || []).forEach(function (f) { deleteFileBlob(f.id); });
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

    function renderExerciseDetails(ex) {
        var details = document.createElement("div");
        details.className = "exercise-details";

        if (ex.updatedAt && state.settings.showUpdatedAt) {
            var updatedNote = document.createElement("div");
            updatedNote.className = "updated-at-note";
            updatedNote.textContent = "Modifié " + formatUpdatedAt(ex.updatedAt);
            details.appendChild(updatedNote);
        }


        var notesLabel = document.createElement("label");
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

        var linksLabel = document.createElement("label");
        linksLabel.textContent = "Liens (YouTube, iReal Pro, PDF, backing track…)";
        details.appendChild(linksLabel);

        var linksList = document.createElement("div");
        linksList.className = "links-list";
        (ex.links || []).forEach(function (link, idx) {
            var chip = document.createElement("a");
            chip.className = "link-chip";
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
            var removeBtn = document.createElement("span");
            removeBtn.className = "link-remove";
            removeBtn.textContent = "✕";
            removeBtn.title = "Retirer ce lien";
            removeBtn.addEventListener("click", function (e) {
                e.preventDefault();
                e.stopPropagation();
                ex.links.splice(idx, 1);
                touchExercise(ex);
                save();
                render();
            });
            chip.appendChild(removeBtn);
            linksList.appendChild(chip);
        });
        details.appendChild(linksList);

        var addLinkRow = document.createElement("div");
        addLinkRow.className = "add-link-row";
        var urlInput = document.createElement("input");
        urlInput.type = "url";
        urlInput.placeholder = "Coller un lien (YouTube, iReal Pro, PDF…)";
        var labelInput = document.createElement("input");
        labelInput.type = "text";
        labelInput.placeholder = "Nom (optionnel)";
        labelInput.style.maxWidth = "140px";
        var addLinkBtn = document.createElement("button");
        addLinkBtn.type = "button";
        addLinkBtn.textContent = "+ Lien";
        function commitLink() {
            var url = urlInput.value.trim();
            if (!url) return;
            if (!/^https?:\/\//i.test(url)) url = "https://" + url;
            var label = labelInput.value.trim() || guessLinkLabel(url);
            ex.links = ex.links || [];
            ex.links.push({ label: label, url: url });
            urlInput.value = "";
            labelInput.value = "";
            touchExercise(ex);
            save();
            render();
        }
        addLinkBtn.addEventListener("click", commitLink);
        urlInput.addEventListener("keydown", function (e) { if (e.key === "Enter") commitLink(); });
        labelInput.addEventListener("keydown", function (e) { if (e.key === "Enter") commitLink(); });
        addLinkRow.appendChild(urlInput);
        addLinkRow.appendChild(labelInput);
        addLinkRow.appendChild(addLinkBtn);
        details.appendChild(addLinkRow);

        details.appendChild(renderFilesSection(ex));

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
    // réel n'existe que dans IndexedDB, sur l'appareil où il a été ajouté.
    function renderFilesSection(ex) {
        var wrap = document.createElement("div");
        wrap.className = "files-section";

        var filesLabel = document.createElement("label");
        filesLabel.textContent = "Fichiers (PDF, MP3…)";
        wrap.appendChild(filesLabel);

        var filesList = document.createElement("div");
        filesList.className = "files-list";
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

            filesList.appendChild(chip);
        });
        wrap.appendChild(filesList);

        var addFileRow = document.createElement("div");
        addFileRow.className = "add-file-row";
        var fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.className = "add-file-input";
        fileInput.accept = ".pdf,application/pdf,.mp3,audio/*";
        fileInput.multiple = true;
        var fileLabel = document.createElement("button");
        fileLabel.type = "button";
        fileLabel.className = "btn-ghost add-file-label";
        fileLabel.textContent = "+ Fichier (PDF, MP3…)";
        fileLabel.addEventListener("click", function () { fileInput.click(); });
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
        addFileRow.appendChild(fileInput);
        addFileRow.appendChild(fileLabel);
        wrap.appendChild(addFileRow);

        var hint = document.createElement("div");
        hint.className = "files-hint";
        hint.textContent = "Les fichiers restent sur cet appareil : ils ne sont pas synchronisés avec les autres.";
        wrap.appendChild(hint);

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
        var inst = makeInstrument(name.trim());
        state.instruments.push(inst);
        state.activeInstrumentId = inst.id;
        save();
        render();
    });

    $toggleUpdatedAt.addEventListener("click", function () {
        state.settings.showUpdatedAt = !state.settings.showUpdatedAt;
        $toggleUpdatedAt.classList.toggle("active", state.settings.showUpdatedAt);
        save();
        render();
    });
    $toggleUpdatedAt.classList.toggle("active", !!state.settings.showUpdatedAt);

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
        var backdrop = document.createElement("div");
        backdrop.className = "ctx-backdrop";
        var panel = document.createElement("div");
        panel.className = "backups-panel";

        var title = document.createElement("div");
        title.className = "backups-title";
        title.textContent = "Sauvegardes de secours (sur cet appareil)";
        panel.appendChild(title);

        var intro = document.createElement("div");
        intro.className = "backups-intro";
        intro.textContent = "Un instantané est gardé automatiquement avant chaque moment où une synchro ou un import pourrait remplacer des données. Utile en cas d'écrasement inattendu.";
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
            backdrop.remove();
            panel.remove();
            document.removeEventListener("keydown", onKey, true);
        }
        function onKey(e) { if (e.key === "Escape") closeBackupsPanel(); }
        backdrop.addEventListener("click", closeBackupsPanel);
        document.addEventListener("keydown", onKey, true);

        document.body.appendChild(backdrop);
        document.body.appendChild(panel);
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

    // ---------- init ----------
    render();

    if ("serviceWorker" in navigator) {
        window.addEventListener("load", function () {
            navigator.serviceWorker.register("sw.js").catch(function () {});
        });
    }
})();
