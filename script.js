(function () {
    "use strict";

    var STORAGE_KEY = "trainhub.v1";
    var DEFAULT_CATEGORIES = ["Technique", "Gammes", "Improvisation", "Jeu en groupe", "Copie de morceaux"];
    var DEFAULT_INSTRUMENTS = ["Basse", "Guitare", "Piano"];
    var FOLDER_PALETTE = ["#00e676", "#a78bfa", "#f472b6", "#2dd4bf", "#fb923c", "#f87171"];
    var STATUSES = [
        { value: "a_faire", label: "À faire" },
        { value: "en_cours", label: "En cours" },
        { value: "termine", label: "Terminé" },
        { value: "a_revoir", label: "À revoir" }
    ];
    var MAX_FOLDER_DEPTH = 5;

    var filterARevoir = false;
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
        });
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

    function save() {
        state.updatedAt = Date.now();
        saveLocal();
        scheduleCloudPush();
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
        filterARevoir = false;
        if ($toggleARevoir) $toggleARevoir.classList.remove("active");
        searchQuery = "";
        if ($searchInput) $searchInput.value = "";
    }

    function countAll(folder) {
        var n = folder.exercises.length;
        folder.folders.forEach(function (f) { n += countAll(f); });
        return n;
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

    function moveArrayItem(arr, index, delta) {
        var newIndex = index + delta;
        if (newIndex < 0 || newIndex >= arr.length) return false;
        var tmp = arr[index];
        arr[index] = arr[newIndex];
        arr[newIndex] = tmp;
        return true;
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

    // Renommer/déplacer sont des actions rares sur les chapitres/dossiers : plutôt que des boutons
    // toujours visibles, on utilise clic droit sur le nom (souris) pour renommer/supprimer, et
    // glisser-déposer pour réordonner. Pas de double-clic : un simple clic sur le nom navigue
    // désormais comme le reste de la ligne (un double-clic aurait sinon dû retarder CHAQUE clic
    // simple pour voir s'il en suit un second — le délai reproché sur mobile). `suppressNextClick`
    // évite qu'un clic de navigation se déclenche juste après un glisser (certains navigateurs
    // émettent quand même un "click" final).
    var suppressNextClick = false;
    var LONG_PRESS_MS = 550;
    var LONG_PRESS_TOLERANCE = 10;

    function bindRenameGestures(nameEl, getParentArray, folder, inst) {
        var triggeredByPress = false;

        nameEl.addEventListener("contextmenu", function (e) {
            e.preventDefault();
            e.stopPropagation();
            // Un appui long tactile a pu déjà déclencher le renommage via le minuteur ci-dessous
            // avant que "contextmenu" n'arrive (son délai varie selon l'appareil) — on évite alors
            // d'ouvrir une deuxième invite de renommage à la suite.
            if (triggeredByPress) { triggeredByPress = false; return; }
            renameOrDeleteFolder(getParentArray(), folder, inst);
        });

        // Détection manuelle de l'appui long tactile : contrairement à Android ou à un clic droit
        // sur ordinateur, Safari sur iPhone/iPad ne déclenche pas de façon fiable l'événement
        // "contextmenu" sur un appui long pour un élément quelconque de la page. On ne peut donc
        // pas compter dessus pour renommer/supprimer au doigt — d'où ce minuteur, indépendant du
        // navigateur, qui ne concerne que les pointeurs tactiles/stylet (la souris a déjà
        // dblclick/clic droit ci-dessus).
        var pressTimer = null;
        var startX = 0, startY = 0;

        function cancelPress() {
            if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
        }

        nameEl.addEventListener("pointerdown", function (e) {
            if (e.pointerType === "mouse") return;
            startX = e.clientX;
            startY = e.clientY;
            cancelPress();
            pressTimer = setTimeout(function () {
                pressTimer = null;
                triggeredByPress = true;
                suppressNextClick = true;
                renameOrDeleteFolder(getParentArray(), folder, inst);
                setTimeout(function () { triggeredByPress = false; }, 400);
            }, LONG_PRESS_MS);
        });
        nameEl.addEventListener("pointermove", function (e) {
            if (!pressTimer) return;
            if (Math.abs(e.clientX - startX) > LONG_PRESS_TOLERANCE || Math.abs(e.clientY - startY) > LONG_PRESS_TOLERANCE) cancelPress();
        });
        nameEl.addEventListener("pointerup", cancelPress);
        nameEl.addEventListener("pointercancel", cancelPress);
    }

    function setupDragReorder(container, itemSelector, getArray, axis) {
        var dragEl = null;
        var startX = 0, startY = 0;
        var moved = false;

        function directChildren() {
            return Array.prototype.filter.call(container.children, function (el) { return el.matches(itemSelector); });
        }

        container.addEventListener("pointerdown", function (e) {
            var item = e.target.closest(itemSelector);
            if (!item || item.parentNode !== container) return; // seuls les enfants directs de CE niveau sont concernés
            dragEl = item;
            startX = e.clientX;
            startY = e.clientY;
            moved = false;
            try { item.setPointerCapture(e.pointerId); } catch (err) {}
        });

        container.addEventListener("pointermove", function (e) {
            if (!dragEl) return;
            var delta = axis === "x" ? (e.clientX - startX) : (e.clientY - startY);
            if (!moved && Math.abs(delta) < 10) return;
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

        function finish() {
            if (dragEl && moved) {
                var arr = getArray();
                var order = directChildren().map(function (el) { return el.dataset.reorderId; });
                arr.sort(function (a, b) { return order.indexOf(a.id) - order.indexOf(b.id); });
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

    function renameOrDeleteFolder(parentArray, folder, inst) {
        var newName = window.prompt("Renommer :", folder.name);
        if (newName === null) return;
        newName = newName.trim();
        if (!newName) {
            var hasContent = folder.folders.length > 0 || folder.exercises.length > 0;
            if (!window.confirm("Supprimer « " + folder.name + " »" + (hasContent ? " et tout son contenu" : "") + " ?")) return;
            var pos = parentArray.indexOf(folder);
            if (pos !== -1) parentArray.splice(pos, 1);
            var path = getNavPath(inst);
            var inPath = path.indexOf(folder.id);
            if (inPath !== -1) setNavPath(inst, path.slice(0, inPath));
        } else {
            folder.name = newName;
        }
        save();
        render();
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
    var $toggleARevoir = document.getElementById("toggle-a-revoir-btn");
    var $toggleUpdatedAt = document.getElementById("toggle-updated-at-btn");
    var $searchInput = document.getElementById("search-input");

    if ($searchInput) {
        $searchInput.addEventListener("input", function () {
            searchQuery = $searchInput.value;
            render();
        });
    }

    function render() {
        var inst = getActiveInstrument();
        var path = inst ? getNavPath(inst) : [];
        var rootChapter = inst && path.length ? findById(inst.categories, path[0]) : null;
        document.documentElement.style.setProperty("--chapter-accent", (rootChapter && rootChapter.color) || "#00e676");
        renderInstrumentSelect();
        renderChapterBar();
        renderSidebarTree();
        renderMain();
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

    function renderChapterBar() {
        var inst = getActiveInstrument();
        $chapterBar.innerHTML = "";
        var path = getNavPath(inst);
        var activeId = path[0];

        inst.categories.forEach(function (chapter) {
            var isActive = chapter.id === activeId;
            var chip = document.createElement("div");
            chip.className = "chapter-chip" + (isActive ? " active" : "");
            chip.dataset.reorderId = chapter.id;
            // Encadré fin + fond très léger dans la couleur du chapitre, toujours visible (pas
            // seulement actif) : remplace le point de couleur, jugé pas assez discret.
            chip.style.borderColor = chapter.color;
            chip.style.background = "color-mix(in srgb, " + chapter.color + " " + (isActive ? "16%" : "7%") + ", transparent)";

            var label = document.createElement("span");
            label.className = "chapter-chip-label";
            label.textContent = chapter.name;
            label.title = "Clic droit (ordinateur) ou appui long (mobile) pour renommer/supprimer";
            if (isActive) label.style.color = chapter.color;
            bindRenameGestures(label, function () { return getActiveInstrument().categories; }, chapter, inst);
            chip.appendChild(label);

            chip.addEventListener("click", function (e) {
                if (suppressNextClick) { suppressNextClick = false; return; }
                clearFilters();
                setNavPath(inst, [chapter.id]);
                render();
            });

            $chapterBar.appendChild(chip);
        });

        setupDragReorder($chapterBar, ".chapter-chip", function () { return getActiveInstrument().categories; }, "x");

        var addBtn = iconButton("+ Chapitre", "Ajouter un grand chapitre", function () {
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
        addBtn.className = "btn-ghost";
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
        inst.categories.forEach(function (chapter) {
            list.appendChild(renderTreeNode(inst, chapter, [], path, chapter.color));
        });
        $sidebarTree.appendChild(list);
        setupDragReorder(list, ".tree-node", function () { return getActiveInstrument().categories; }, "y");

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

    function renderTreeNode(inst, folder, ancestorPath, currentPath, rootColor) {
        var fullPath = ancestorPath.concat(folder.id);
        var isSelected = folder.id === currentPath[currentPath.length - 1];
        var hasChildren = folder.folders.length > 0;
        var expanded = treeExpanded[folder.id] !== false;

        var wrap = document.createElement("div");
        wrap.className = "tree-node";
        wrap.dataset.reorderId = folder.id;

        var row = document.createElement("div");
        row.className = "tree-row" + (isSelected ? " selected" : "");

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

        // Bordure gauche fine + fond très léger dans la couleur du grand chapitre de la branche
        // (au lieu d'un point de couleur) : visible sur toute la ligne, discret.
        row.style.borderLeft = "3px solid " + rootColor;
        row.style.background = "color-mix(in srgb, " + rootColor + " " + (isSelected ? "16%" : "5%") + ", transparent)";

        var label = document.createElement("span");
        label.className = "tree-label";
        label.textContent = folder.name;
        label.title = "Clic droit (ordinateur) ou appui long (mobile) pour renommer/supprimer";
        row.appendChild(label);
        bindRenameGestures(label, function () { return getParentArrayFor(getActiveInstrument(), ancestorPath); }, folder, inst);

        var count = document.createElement("span");
        count.className = "tree-count";
        count.textContent = countAll(folder);
        row.appendChild(count);

        row.addEventListener("click", function (e) {
            if (suppressNextClick) { suppressNextClick = false; return; }
            clearFilters();
            setNavPath(inst, fullPath);
            render();
        });

        wrap.appendChild(row);

        if (expanded && (hasChildren || fullPath.length < MAX_FOLDER_DEPTH)) {
            var childWrap = document.createElement("div");
            childWrap.className = "tree-children";
            folder.folders.forEach(function (child) {
                childWrap.appendChild(renderTreeNode(inst, child, fullPath, currentPath, rootColor));
            });
            if (fullPath.length < MAX_FOLDER_DEPTH) {
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
        var hasFilter = filterARevoir || !!searchQuery.trim();
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

    function renderContentHeading(folder) {
        $contentHeading.innerHTML = "";
        if (!folder) return;
        var dot = document.createElement("span");
        dot.className = "heading-dot";
        dot.style.background = folder.color || "var(--chapter-accent)";
        $contentHeading.appendChild(dot);
        var h2 = document.createElement("h2");
        h2.textContent = folder.name;
        $contentHeading.appendChild(h2);
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

        renderContentHeading(currentFolder);
        $folderContainer.innerHTML = "";

        if (currentFolder.folders.length) {
            var foldersWrap = document.createElement("div");
            foldersWrap.className = "folders-wrap";
            currentFolder.folders.forEach(function (f, idx) {
                foldersWrap.appendChild(renderFolderRow(inst, currentFolder.folders, f, idx, currentFolder.folders.length, path));
            });
            $folderContainer.appendChild(foldersWrap);
            setupDragReorder(foldersWrap, ".folder-row", function () { return currentFolder.folders; }, "y");
        }

        if (depth < MAX_FOLDER_DEPTH) {
            $folderContainer.appendChild(renderAddFolderForm(currentFolder));
        }

        var exercisesWrap = document.createElement("div");
        exercisesWrap.className = "exercises-wrap";
        currentFolder.exercises.forEach(function (ex, idx) {
            exercisesWrap.appendChild(renderExercise(currentFolder, ex, idx, currentFolder.exercises.length, true));
        });
        $folderContainer.appendChild(exercisesWrap);

        $folderContainer.appendChild(renderAddExerciseForm(currentFolder));
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
        label.title = "Clic droit (ordinateur) ou appui long (mobile) pour renommer/supprimer";
        row.appendChild(label);
        bindRenameGestures(label, function () { return parentArray; }, folder, inst);

        var count = document.createElement("span");
        count.className = "folder-count";
        count.textContent = countAll(folder);
        row.appendChild(count);

        row.addEventListener("click", function (e) {
            if (suppressNextClick) { suppressNextClick = false; return; }
            setNavPath(inst, path.concat(folder.id));
            render();
        });

        return row;
    }

    function renderAddFolderForm(currentFolder) {
        var wrap = document.createElement("div");
        wrap.className = "add-category-row";
        var input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Nouveau sous-dossier…";
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn-accent";
        btn.textContent = "+ Sous-dossier";
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
            if (filterARevoir && ex.status !== "a_revoir") return false;
            if (query && ex.title.toLowerCase().indexOf(query) === -1) return false;
            return true;
        }
        var results = collectExercises(inst, matchFn);
        $folderContainer.innerHTML = "";

        if (results.length === 0) {
            $empty.hidden = false;
            $empty.textContent = filterARevoir && query
                ? "Rien à revoir ne correspond à ta recherche."
                : filterARevoir
                    ? "Rien à revoir pour l'instant sur cet instrument."
                    : "Aucun exercice ne correspond à ta recherche.";
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

            wrap.appendChild(renderExercise(r.folder, r.ex, 0, 1, false));
            $folderContainer.appendChild(wrap);
        });
    }

    function renderAddExerciseForm(folder) {
        var wrap = document.createElement("div");
        wrap.className = "add-exercise-row";
        var input = document.createElement("input");
        input.type = "text";
        input.placeholder = "+ Ajouter un exercice…";
        function commit() {
            var title = input.value.trim();
            if (!title) return;
            folder.exercises.push({
                id: uid(),
                title: title,
                notes: "",
                tempo: "",
                status: "a_faire",
                links: [],
                collapsed: true,
                updatedAt: Date.now()
            });
            input.value = "";
            save();
            render();
        }
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "Ajouter";
        btn.addEventListener("click", commit);
        input.addEventListener("keydown", function (e) { if (e.key === "Enter") commit(); });
        wrap.appendChild(input);
        wrap.appendChild(btn);
        return wrap;
    }

    function renderExercise(folder, ex, idx, total, orderingEnabled) {
        var el = document.createElement("div");
        el.className = "exercise" + (ex.collapsed ? " collapsed" : "");

        var row = document.createElement("div");
        row.className = "exercise-row";

        if (orderingEnabled) {
            var upBtn = iconButton("↑", "Monter l'exercice", function () {
                if (moveArrayItem(folder.exercises, idx, -1)) { save(); render(); }
            });
            if (idx === 0) upBtn.disabled = true;
            row.appendChild(upBtn);

            var downBtn = iconButton("↓", "Descendre l'exercice", function () {
                if (moveArrayItem(folder.exercises, idx, 1)) { save(); render(); }
            });
            if (idx === total - 1) downBtn.disabled = true;
            row.appendChild(downBtn);
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

        var status = document.createElement("select");
        status.className = "status-select";
        status.dataset.status = ex.status;
        STATUSES.forEach(function (s) {
            var opt = document.createElement("option");
            opt.value = s.value;
            opt.textContent = s.label;
            if (s.value === ex.status) opt.selected = true;
            status.appendChild(opt);
        });
        status.addEventListener("change", function () {
            ex.status = status.value;
            status.dataset.status = ex.status;
            touchExercise(ex);
            save();
            if (filterARevoir) render();
        });
        row.appendChild(status);

        var expandBtn = iconButton(ex.collapsed ? "▾" : "▴", "Détails (notes, tempo, liens)", function () {
            ex.collapsed = !ex.collapsed;
            save();
            render();
        });
        row.appendChild(expandBtn);

        var delBtn = iconButton("✕", "Supprimer l'exercice", function () {
            if (!window.confirm("Supprimer « " + ex.title + " » ?")) return;
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

        var fieldRow = document.createElement("div");
        fieldRow.className = "field-row";

        var tempoLabel = document.createElement("label");
        tempoLabel.textContent = "Tempo (BPM)";
        var tempoInput = document.createElement("input");
        tempoInput.type = "number";
        tempoInput.min = "0";
        tempoInput.className = "tempo-input";
        tempoInput.value = ex.tempo || "";
        tempoInput.placeholder = "—";
        tempoInput.addEventListener("change", function () {
            ex.tempo = tempoInput.value;
            touchExercise(ex);
            save();
        });
        fieldRow.appendChild(tempoLabel);
        fieldRow.appendChild(tempoInput);
        details.appendChild(fieldRow);

        var notesLabel = document.createElement("label");
        notesLabel.textContent = "Notes";
        var notes = document.createElement("textarea");
        notes.value = ex.notes || "";
        notes.placeholder = "Remarques, points à retravailler…";
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

        return details;
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
        state = normalizeState(remote);
        if (!state.activeInstrumentId && state.instruments[0]) state.activeInstrumentId = state.instruments[0].id;
        navPaths = {};
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

    $toggleARevoir.addEventListener("click", function () {
        filterARevoir = !filterARevoir;
        $toggleARevoir.classList.toggle("active", filterARevoir);
        render();
    });

    $toggleUpdatedAt.addEventListener("click", function () {
        state.settings.showUpdatedAt = !state.settings.showUpdatedAt;
        $toggleUpdatedAt.classList.toggle("active", state.settings.showUpdatedAt);
        save();
        render();
    });
    $toggleUpdatedAt.classList.toggle("active", !!state.settings.showUpdatedAt);

    document.getElementById("export-btn").addEventListener("click", function () {
        var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "trainhub-sauvegarde-" + new Date().toISOString().slice(0, 10) + ".json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

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
                state = normalizeState(parsed);
                if (!state.activeInstrumentId && state.instruments[0]) state.activeInstrumentId = state.instruments[0].id;
                navPaths = {};
                save();
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
