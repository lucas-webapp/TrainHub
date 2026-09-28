(function () {
    "use strict";

    var STORAGE_KEY = "trainhub.v1";
    var DEFAULT_CATEGORIES = ["Technique", "Gammes", "Improvisation", "Jeu en groupe", "Copie de morceaux"];
    var DEFAULT_INSTRUMENTS = ["Basse", "Guitare", "Piano"];
    var STATUSES = [
        { value: "a_faire", label: "À faire" },
        { value: "en_cours", label: "En cours" },
        { value: "termine", label: "Terminé" },
        { value: "a_revoir", label: "À revoir" }
    ];

    var state = load() || makeDefaultState();
    var filterARevoir = false;
    var searchQuery = "";

    function uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function makeCategory(name) {
        return { id: uid(), name: name, exercises: [] };
    }

    function makeInstrument(name) {
        return { id: uid(), name: name, categories: DEFAULT_CATEGORIES.map(makeCategory) };
    }

    function makeDefaultState() {
        var instruments = DEFAULT_INSTRUMENTS.map(makeInstrument);
        return { activeInstrumentId: instruments[0].id, instruments: instruments, updatedAt: 0 };
    }

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

    // ---------- rendering ----------

    var $tabs = document.getElementById("instrument-tabs");
    var $categories = document.getElementById("categories-container");
    var $empty = document.getElementById("empty-state");
    var $toggleARevoir = document.getElementById("toggle-a-revoir-btn");
    var $searchInput = document.getElementById("search-input");

    if ($searchInput) {
        $searchInput.addEventListener("input", function () {
            searchQuery = $searchInput.value;
            renderCategories();
        });
    }

    function render() {
        renderTabs();
        renderCategories();
    }

    function renderTabs() {
        $tabs.innerHTML = "";
        state.instruments.forEach(function (inst) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "instrument-tab" + (inst.id === state.activeInstrumentId ? " active" : "");
            btn.textContent = inst.name;
            btn.dataset.instrumentId = inst.id;
            btn.addEventListener("click", function () {
                state.activeInstrumentId = inst.id;
                save();
                render();
            });
            btn.addEventListener("dblclick", function (e) {
                e.preventDefault();
                renameInstrument(inst.id);
            });
            btn.title = "Double-clic pour renommer";
            $tabs.appendChild(btn);
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
            if (state.activeInstrumentId === instrumentId) state.activeInstrumentId = state.instruments[0].id;
        } else {
            inst.name = name;
        }
        save();
        render();
    }

    function renderCategories() {
        var inst = getActiveInstrument();
        $categories.innerHTML = "";

        var categories = inst.categories;
        var anyVisible = false;
        var hasFilter = filterARevoir || !!searchQuery;
        var orderingEnabled = !hasFilter;
        var query = searchQuery.trim().toLowerCase();

        categories.forEach(function (cat, idx) {
            var exercises = cat.exercises;
            if (filterARevoir) exercises = exercises.filter(function (ex) { return ex.status === "a_revoir"; });
            if (query) exercises = exercises.filter(function (ex) { return ex.title.toLowerCase().indexOf(query) !== -1; });
            if (hasFilter && exercises.length === 0) return;
            anyVisible = true;
            $categories.appendChild(renderCategory(inst, cat, exercises, idx, categories.length, orderingEnabled, hasFilter));
        });

        if (!hasFilter) {
            $categories.appendChild(renderAddCategoryForm(inst));
        }

        $empty.hidden = anyVisible || !hasFilter;
        if (hasFilter && !anyVisible) {
            $empty.hidden = false;
            $empty.textContent = filterARevoir ? "Rien à revoir pour l'instant sur cet instrument." : "Aucun exercice ne correspond à ta recherche.";
        }
    }

    function renderAddCategoryForm(inst) {
        var wrap = document.createElement("div");
        wrap.className = "add-category-row";
        var input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Nouvelle catégorie (ex: Technique, Gammes...)";
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn-accent";
        btn.textContent = "+ Catégorie";
        function commit() {
            var name = input.value.trim();
            if (!name) return;
            inst.categories.push(makeCategory(name));
            save();
            render();
        }
        btn.addEventListener("click", commit);
        input.addEventListener("keydown", function (e) { if (e.key === "Enter") commit(); });
        wrap.appendChild(input);
        wrap.appendChild(btn);
        return wrap;
    }

    function renderCategory(inst, cat, exercises, idx, total, orderingEnabled, forceExpand) {
        var el = document.createElement("div");
        el.className = "category" + (!forceExpand && cat.collapsed ? " collapsed" : "");

        var header = document.createElement("div");
        header.className = "category-header";

        var chevron = document.createElement("span");
        chevron.className = "chevron";
        chevron.innerHTML = "▾";
        header.appendChild(chevron);

        var name = document.createElement("span");
        name.className = "category-name";
        name.textContent = cat.name;
        header.appendChild(name);

        var count = document.createElement("span");
        count.className = "category-count";
        count.textContent = exercises.length;
        header.appendChild(count);

        var actions = document.createElement("div");
        actions.className = "category-actions";

        if (orderingEnabled) {
            var upBtn = iconButton("↑", "Monter la catégorie", function (e) {
                e.stopPropagation();
                if (moveArrayItem(inst.categories, idx, -1)) { save(); render(); }
            });
            if (idx === 0) upBtn.disabled = true;
            actions.appendChild(upBtn);

            var downBtn = iconButton("↓", "Descendre la catégorie", function (e) {
                e.stopPropagation();
                if (moveArrayItem(inst.categories, idx, 1)) { save(); render(); }
            });
            if (idx === total - 1) downBtn.disabled = true;
            actions.appendChild(downBtn);
        }

        var renameBtn = iconButton("✎", "Renommer / supprimer la catégorie", function (e) {
            e.stopPropagation();
            var newName = window.prompt("Renommer la catégorie :", cat.name);
            if (newName === null) return;
            newName = newName.trim();
            if (!newName) {
                if (!window.confirm("Supprimer la catégorie « " + cat.name + " » et ses exercices ?")) return;
                inst.categories = inst.categories.filter(function (c) { return c.id !== cat.id; });
            } else {
                cat.name = newName;
            }
            save();
            render();
        });
        actions.appendChild(renameBtn);
        header.appendChild(actions);

        header.addEventListener("click", function () {
            cat.collapsed = !cat.collapsed;
            save();
            render();
        });

        el.appendChild(header);

        var body = document.createElement("div");
        body.className = "category-body";

        exercises.forEach(function (ex, exIdx) {
            body.appendChild(renderExercise(cat, ex, exIdx, exercises.length, orderingEnabled));
        });

        if (!forceExpand) body.appendChild(renderAddExerciseForm(cat));

        el.appendChild(body);
        return el;
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

    function renderAddExerciseForm(cat) {
        var wrap = document.createElement("div");
        wrap.className = "add-exercise-row";
        var input = document.createElement("input");
        input.type = "text";
        input.placeholder = "+ Ajouter un exercice…";
        function commit() {
            var title = input.value.trim();
            if (!title) return;
            cat.exercises.push({
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

    function renderExercise(cat, ex, idx, total, orderingEnabled) {
        var el = document.createElement("div");
        el.className = "exercise" + (ex.collapsed ? " collapsed" : "");

        var row = document.createElement("div");
        row.className = "exercise-row";

        if (orderingEnabled) {
            var upBtn = iconButton("↑", "Monter l'exercice", function () {
                if (moveArrayItem(cat.exercises, idx, -1)) { save(); render(); }
            });
            if (idx === 0) upBtn.disabled = true;
            row.appendChild(upBtn);

            var downBtn = iconButton("↓", "Descendre l'exercice", function () {
                if (moveArrayItem(cat.exercises, idx, 1)) { save(); render(); }
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
            cat.exercises = cat.exercises.filter(function (e) { return e.id !== ex.id; });
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

        if (ex.updatedAt) {
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
        state = remote;
        if (!state.activeInstrumentId && state.instruments[0]) state.activeInstrumentId = state.instruments[0].id;
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
                state = parsed;
                if (!state.activeInstrumentId && state.instruments[0]) state.activeInstrumentId = state.instruments[0].id;
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
