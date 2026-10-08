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
    // `action` (facultatif) : { label, run } — un bouton dans le message (ex. « Annuler » après une suppression).
    function showToast(message, durationMs, action) {
        if (activeToastEl) { activeToastEl.remove(); clearTimeout(activeToastTimer); }
        var toast = document.createElement("div");
        toast.className = "toast" + (action ? " toast-with-action" : "");
        if (action) {
            toast.setAttribute("role", "status");
            var txt = document.createElement("span"); txt.className = "toast-text"; txt.textContent = message;
            var btn = document.createElement("button"); btn.type = "button"; btn.className = "toast-action"; btn.textContent = action.label;
            btn.addEventListener("click", function () {
                toast.remove(); clearTimeout(activeToastTimer);
                if (activeToastEl === toast) activeToastEl = null;
                action.run();
            });
            toast.appendChild(txt); toast.appendChild(btn);
        } else {
            toast.textContent = message;
        }
        document.body.appendChild(toast);
        activeToastEl = toast;
        activeToastTimer = setTimeout(function () {
            toast.remove();
            if (activeToastEl === toast) activeToastEl = null;
        }, durationMs || (action ? 7000 : 3200));
    }
    // Après un changement important (suppression, déplacement…) : message avec « Annuler ». Le bouton ne défait
    // QUE ce changement-là : si autre chose a été modifié entre-temps, il renvoie vers le bouton ↶ (pas à pas).
    function toastUndo(message) {
        var stamp = historyStamp;
        showToast(message, 8000, { label: "Annuler", run: function () {
            if (historyStamp === stamp) { undo(); showToast("Modification annulée"); }
            else showToast("D'autres modifications ont suivi : utilise le bouton ↶ (Annuler) pour revenir en arrière pas à pas.", 5500);
        } });
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
            // Notes fixes (toujours visibles, sans date) ; ex.notes = notes mobiles (suivi daté au jour le jour).
            if (typeof ex.fixedNotes !== "string") ex.fixedNotes = "";
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

    var METRO_SOUNDS = ["click", "wood", "clave", "bell"];
    var METRO_SOUND_LABELS = { click: "Clic classique", wood: "Bois", clave: "Clave", bell: "Cloche douce" };
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
        // Historique des sessions réalisées : vit à part (voir « journal des sessions »). Une ancienne copie rangée
        // dans les réglages (ancienne version, import, version distante) est recueillie puis retirée de l'état.
        if (Array.isArray(s.settings.sessionLog) && s.settings.sessionLog.length) logMigrateIn(s.settings.sessionLog);
        delete s.settings.sessionLog;
        delete s.settings.logRev;
        // Planning : sessions programmées [{ id, date: "AAAA-MM-JJ", sessionId, instrumentId }]
        if (!Array.isArray(s.settings.sessionPlan)) s.settings.sessionPlan = [];
        s.settings.sessionPlan = s.settings.sessionPlan.filter(function (e) { return e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.sessionId; });
        s.settings.sessionPlan.forEach(function (e) { if (!e.id) e.id = uid(); });
        // Le passé n'est fait que de sessions réalisées et enregistrées : une programmation dont le jour est passé disparaît.
        (function () { var d = new Date(), t = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); s.settings.sessionPlan = s.settings.sessionPlan.filter(function (e) { return e.date >= t; }); })();
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
            // Session éphémère (programmée depuis le calendrier pour UN jour, absente de la liste des sessions) :
            // sans date valide elle devient une session ordinaire (rien ne se perd).
            gs.ephemeral = gs.ephemeral === true;
            if (gs.ephemeral && !/^\d{4}-\d{2}-\d{2}$/.test(gs.date || "")) gs.ephemeral = false;
            if (!gs.ephemeral) delete gs.date;
        });
        purgeOrphanEphemerals(s, null);
    }
    // Une session éphémère n'existe que par son jour au planning : plus de séance programmée = elle disparaît.
    // `keep` : identifiants à ne pas toucher (session en cours d'édition ou de lancement). Renvoie le nombre retiré.
    function purgeOrphanEphemerals(s, keep) {
        var used = {}, list = s.settings.guidedSessions, removed = 0;
        s.settings.sessionPlan.forEach(function (pe) { used[pe.sessionId] = true; });
        for (var i = list.length - 1; i >= 0; i--) {
            var g = list[i];
            if (g.ephemeral && !used[g.id] && !(keep && keep[g.id])) { list.splice(i, 1); removed++; }
        }
        return removed;
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
        normalizeStatsRules(s);
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

    // ---------- journal des sessions réalisées : stockage à part, un lot par mois ----------
    // Le journal grossit avec les années. Dans l'état principal il alourdissait chaque enregistrement (copie
    // complète à chaque modification, envoi complet au cloud, limite de 1 Mio par document Firestore). Il vit
    // donc à part : un lot par mois, en local (« trainhub.log.AAAA-MM ») et dans le cloud
    // (users/<uid>/apps/trainhub-log-AAAA-MM, comme les images). Chaque lot garde aussi les identifiants des
    // séances supprimées (« deleted ») pour qu'une suppression survive à la fusion entre appareils.
    // Chaque séance garde, figés au moment où elle a été faite, le nom, le chemin et les identifiants de ses
    // exercices : renommer, déplacer ou supprimer un exercice ensuite ne réécrit pas le passé.
    var LOG_LS_PREFIX = "trainhub.log.";
    var LOG_DOC_PREFIX = "trainhub-log-";
    var logMonths = {};   // "AAAA-MM" -> { records: [], deleted: [ids], updatedAt: ts }
    var logDirty = {};    // mois à renvoyer au cloud
    var logFlat = null;   // cache : toutes les séances, de la plus ancienne à la plus récente
    function logMonthOf(ts) { var d = new Date(ts); return d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1); }
    function logBucket(m) { return logMonths[m] || (logMonths[m] = { records: [], deleted: [], updatedAt: 0 }); }
    function logSaveMonth(m) {
        try { localStorage.setItem(LOG_LS_PREFIX + m, JSON.stringify(logMonths[m])); }
        catch (e) { console.error("Journal : écriture locale impossible", e); }
    }
    function logLoadLocal() {
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (!k || k.indexOf(LOG_LS_PREFIX) !== 0) continue;
                var m = k.slice(LOG_LS_PREFIX.length);
                if (!/^\d{4}-\d{2}$/.test(m)) continue;
                var d = JSON.parse(localStorage.getItem(k));
                if (d && Array.isArray(d.records)) logMonths[m] = { records: d.records, deleted: Array.isArray(d.deleted) ? d.deleted : [], updatedAt: d.updatedAt || 0 };
            }
        } catch (e) { console.error("Journal : lecture locale impossible", e); }
        logFlat = null;
    }
    logLoadLocal();
    function logAll() {
        if (!logFlat) {
            logFlat = [];
            Object.keys(logMonths).forEach(function (m) { logFlat = logFlat.concat(logMonths[m].records); });
            logFlat.sort(function (a, b) { return a.date - b.date; });
        }
        return logFlat;
    }
    function logTouch(m) { logMonths[m].updatedAt = Date.now(); logFlat = null; logDirty[m] = true; logSaveMonth(m); }
    function logAdd(rec) {
        rec = JSON.parse(JSON.stringify(rec)); // sans valeur « undefined » (refusée par Firestore)
        var m = logMonthOf(rec.date), b = logBucket(m);
        b.records = b.records.filter(function (x) { return x.id !== rec.id; });
        b.records.push(rec);
        b.deleted = b.deleted.filter(function (id) { return id !== rec.id; });
        logTouch(m);
    }
    function logRemove(id) {
        Object.keys(logMonths).forEach(function (m) {
            var b = logMonths[m];
            if (!b.records.some(function (x) { return x.id === id; })) return;
            b.records = b.records.filter(function (x) { return x.id !== id; });
            if (b.deleted.indexOf(id) === -1) b.deleted.push(id);
            logTouch(m);
        });
    }
    // Anciens formats (journal rangé dans les réglages, fichier importé, version reçue d'un ancien appareil).
    function logMigrateIn(arr) {
        var touched = {};
        arr.forEach(function (rec) {
            if (!rec || typeof rec !== "object" || !rec.id) return;
            if (typeof rec.date !== "number") rec.date = rec.endedAt || 0;
            var m = logMonthOf(rec.date), b = logBucket(m);
            if (b.deleted.indexOf(rec.id) !== -1 || b.records.some(function (x) { return x.id === rec.id; })) return;
            b.records.push(rec);
            touched[m] = true;
        });
        Object.keys(touched).forEach(logTouch);
    }
    // Pour l'export complet (fichier JSON de sauvegarde) : l'état + le journal.
    function exportState() {
        var s = Object.assign({}, state);
        s.settings = Object.assign({}, state.settings, { sessionLog: logAll() });
        return s;
    }
    // Ce qui part dans le document cloud principal : l'état + la « révision » de chaque lot du journal.
    function logRevMap() { var r = {}; Object.keys(logMonths).forEach(function (m) { r[m] = logMonths[m].updatedAt; }); return r; }
    function cloudState() {
        var s = Object.assign({}, state);
        s.settings = Object.assign({}, state.settings, { logRev: logRevMap() });
        return s;
    }

    var state = normalizeState(load() || makeDefaultState());
    // Anciennes séances : seul le NOM du chapitre était gardé. Tant que le nom d'alors est encore celui du chapitre
    // actuel de l'exercice, on y rattache l'identifiant du chapitre : un renommage ultérieur ne les séparera plus.
    (function logBackfillChapterIds() {
        var touched = {};
        Object.keys(logMonths).forEach(function (m) {
            logMonths[m].records.forEach(function (rec) {
                (rec.steps || []).forEach(function (st) {
                    if (st.chapterId || !st.chapterName || !st.exerciseId) return;
                    var f = findExerciseById(st.exerciseId);
                    if (f && f.pathIds && f.pathNames[0] === st.chapterName) { st.chapterId = f.pathIds[0]; touched[m] = true; }
                });
            });
        });
        Object.keys(touched).forEach(logTouch);
    })();

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

    // Écriture « au fil du geste » (molette, cadran, curseur de volume) : une écriture complète par cran coûtait
    // des dizaines de millisecondes et ajoutait une entrée d'historique par cran. Ici : au plus une écriture
    // toutes les 300 ms pendant le geste, puis UNE entrée d'historique quand il s'arrête. Rien n'est perdu à
    // la fermeture de la page (voir flushSaveSoon).
    var saveSoonTimer = null, saveSoonLast = 0;
    function saveSoon() {
        var now = Date.now();
        if (now - saveSoonLast >= 300) { saveSoonLast = now; persist(); }
        clearTimeout(saveSoonTimer);
        saveSoonTimer = setTimeout(function () { saveSoonTimer = null; save(); }, 300);
    }
    function flushSaveSoon() { if (saveSoonTimer) { clearTimeout(saveSoonTimer); saveSoonTimer = null; save(); } }
    window.addEventListener("pagehide", flushSaveSoon);
    document.addEventListener("visibilitychange", function () { if (document.hidden) flushSaveSoon(); });

    function persist() {
        state.updatedAt = Date.now();
        saveLocal();
        scheduleCloudPush();
    }

    function save() {
        if (saveSoonTimer) { clearTimeout(saveSoonTimer); saveSoonTimer = null; }
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
    var HISTORY_MAX_BYTES = 48 * 1024 * 1024; // plafond de mémoire (estimé) des instantanés conservés
    var historyStack = [];
    var historyIndex = -1;
    var historyStamp = 0; // change à chaque enregistrement / annuler / rétablir (sert au bouton « Annuler » des messages)
    var historyBytes = 0;

    // Un instantané n'est plus une copie complète de l'état : l'état est découpé en tranches JSON (réglages
    // généraux, chaque réglage, chaque instrument, chaque chapitre). Une tranche inchangée depuis l'instantané
    // précédent réutilise la MÊME chaîne (aucune mémoire en plus) : modifier un exercice ne coûte plus que le
    // chapitre concerné, au lieu de tout l'état à chaque fois.
    function snapshotState(prev) {
        var fresh = 0;
        function piece(str, old) { if (old !== undefined && old === str) return old; fresh += str.length; return str; }
        var top = {};
        Object.keys(state).forEach(function (k) { if (k !== "instruments" && k !== "settings") top[k] = state[k]; });
        var snap = { top: piece(JSON.stringify(top), prev && prev.top), instruments: [], settings: {} };
        state.instruments.forEach(function (inst, i) {
            var pi = prev && prev.instruments[i];
            var meta = {};
            Object.keys(inst).forEach(function (k) { if (k !== "categories") meta[k] = inst[k]; });
            snap.instruments.push({
                meta: piece(JSON.stringify(meta), pi && pi.meta),
                cats: (inst.categories || []).map(function (c, j) { return piece(JSON.stringify(c), pi && pi.cats[j]); })
            });
        });
        Object.keys(state.settings).forEach(function (k) {
            var str = JSON.stringify(state.settings[k]);
            if (str !== undefined) snap.settings[k] = piece(str, prev && prev.settings[k]);
        });
        snap.bytes = fresh * 2;
        return snap;
    }
    function restoreSnapshot(snap) {
        var out = JSON.parse(snap.top);
        out.instruments = snap.instruments.map(function (pi) {
            var inst = JSON.parse(pi.meta);
            inst.categories = pi.cats.map(function (c) { return JSON.parse(c); });
            return inst;
        });
        out.settings = {};
        Object.keys(snap.settings).forEach(function (k) { out.settings[k] = JSON.parse(snap.settings[k]); });
        return out;
    }

    function resetHistory() {
        var snap = snapshotState(null);
        historyStack = [snap];
        historyBytes = snap.bytes;
        historyIndex = 0;
        historyStamp++;
        updateUndoRedoButtons();
    }

    function pushHistory() {
        var prev = historyStack[historyIndex];
        historyStack.slice(historyIndex + 1).forEach(function (sn) { historyBytes -= sn.bytes; });
        historyStack = historyStack.slice(0, historyIndex + 1);
        var snap = snapshotState(prev);
        historyStack.push(snap);
        historyBytes += snap.bytes;
        while (historyStack.length > 1 && (historyStack.length > HISTORY_LIMIT || historyBytes > HISTORY_MAX_BYTES)) historyBytes -= historyStack.shift().bytes;
        historyIndex = historyStack.length - 1;
        historyStamp++;
        updateUndoRedoButtons();
    }

    function updateUndoRedoButtons() {
        if ($undoBtn) $undoBtn.disabled = historyIndex <= 0;
        if ($redoBtn) $redoBtn.disabled = historyIndex < 0 || historyIndex >= historyStack.length - 1;
    }

    var historyListeners = []; // fonctions rappelées après un annuler/rétablir (ex. le calendrier ouvert se rafraîchit)
    function goToHistory(index) {
        if (index < 0 || index >= historyStack.length) return;
        historyIndex = index;
        historyStamp++;
        state = normalizeState(restoreSnapshot(historyStack[historyIndex]));
        // Sessions : un brouillon sans modification n'est qu'une copie de l'ancienne version (on le jette, il sera
        // refait depuis la session restaurée) ; un brouillon modifié reste, c'est du travail non enregistré.
        Object.keys(gsDrafts).forEach(function (id) { if (!gsDraftDirty(id)) delete gsDrafts[id]; });
        [["gsEditingSession", ["edit", "pick"]], ["gsLinksSession", ["links"]]].forEach(function (pair) {
            var cur = pair[0] === "gsEditingSession" ? gsEditingSession : gsLinksSession;
            if (!cur) return;
            var again = gsFindSession(cur.id);
            if (pair[0] === "gsEditingSession") gsEditingSession = again; else gsLinksSession = again;
            if (!again && pair[1].indexOf(gsScreen) !== -1) gsScreen = "list";
        });
        persist();
        render();
        historyListeners.forEach(function (fn) { try { fn(); } catch (e) {} });
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

    // Type réel d'une image d'après ses premiers octets (un type MIME absent ou faux empêche certains navigateurs de l'afficher).
    function sniffImageBlob(blob) {
        return new Promise(function (resolve) {
            var fr = new FileReader();
            fr.onload = function () {
                var b = new Uint8Array(fr.result), t = "";
                function at(i, str) { for (var k = 0; k < str.length; k++) if (b[i + k] !== str.charCodeAt(k)) return false; return true; }
                if (b[0] === 0x89 && at(1, "PNG")) t = "image/png";
                else if (b[0] === 0xFF && b[1] === 0xD8) t = "image/jpeg";
                else if (at(0, "GIF8")) t = "image/gif";
                else if (at(0, "RIFF") && at(8, "WEBP")) t = "image/webp";
                else if (at(0, "BM")) t = "image/bmp";
                else if (at(4, "ftyp")) t = at(8, "heic") || at(8, "heix") || at(8, "mif1") ? "image/heic" : "";
                resolve(t && blob.type !== t ? new Blob([blob], { type: t }) : blob);
            };
            fr.onerror = function () { resolve(blob); };
            fr.readAsArrayBuffer(blob.slice(0, 16));
        });
    }
    // Dernier recours si l'image ne s'affiche pas : on la redessine (canvas) en JPEG.
    function repairImageBlob(blob) {
        if (typeof createImageBitmap !== "function") return Promise.resolve(null);
        return createImageBitmap(blob).then(function (bmp) {
            var cv = document.createElement("canvas");
            cv.width = bmp.width; cv.height = bmp.height;
            var cx = cv.getContext("2d");
            cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
            cx.drawImage(bmp, 0, 0);
            if (bmp.close) bmp.close();
            return new Promise(function (resolve) { cv.toBlob(resolve, "image/jpeg", 0.9); });
        }).catch(function () { return null; });
    }
    var imageBlobCache = {};
    function loadImageInto(img, meta, onMissing) {
        function apply(url) {
            if (!url) { if (onMissing) onMissing("absente"); return; }
            var repaired = false;
            img.onerror = function () {
                if (repaired) { if (onMissing) onMissing("illisible"); return; }
                repaired = true;
                var src = imageBlobCache[meta.id];
                if (!src) { if (onMissing) onMissing("illisible"); return; }
                repairImageBlob(src).then(function (fixed) {
                    if (!fixed) { if (onMissing) onMissing("illisible"); return; }
                    imageBlobCache[meta.id] = fixed;
                    imageUrlCache[meta.id] = URL.createObjectURL(fixed);
                    storeFileBlob(meta.id, fixed); // la version réparée remplace l'originale
                    img.src = imageUrlCache[meta.id];
                });
            };
            img.src = url;
        }
        if (meta.id in imageUrlCache) { apply(imageUrlCache[meta.id]); return; }
        getFileBlob(meta.id).then(function (blob) {
            if (blob) return blob;
            // Absente de cet appareil : on la récupère dans le cloud si elle y a été envoyée.
            return cloudFetchImage(meta);
        }).then(function (blob) {
            if (!blob) { imageUrlCache[meta.id] = false; apply(false); return; }
            return sniffImageBlob(blob).then(function (fixed) {
                imageBlobCache[meta.id] = fixed;
                imageUrlCache[meta.id] = URL.createObjectURL(fixed);
                apply(imageUrlCache[meta.id]);
            });
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

    // Visionneuse d'images : une fenêtre flottante NON modale (le métronome, la session… restent visibles et
    // utilisables, et la barre espace garde son effet). Déplaçable à la main, redimensionnable (taille et position
    // retenues pour la prochaine image), ou en plein écran (bouton ⛶, ou ouverture directe depuis la vignette).
    var EXPAND_ICON_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></svg>';
    var imageViewerClose = null;
    function openImageViewer(images, startIndex, startFull) {
        if (imageViewerClose) imageViewerClose();
        var idx = startIndex;
        var full = !!startFull || isMobilePanelLayout();
        var panel = document.createElement("div");
        panel.className = "img-viewer";
        var head = document.createElement("div");
        head.className = "img-viewer-head";
        head.title = "Faire glisser pour déplacer la fenêtre";
        var caption = document.createElement("div");
        caption.className = "img-viewer-caption";
        function mkBtn(html, title, fn) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "img-viewer-btn";
            b.innerHTML = html;
            b.title = title; b.setAttribute("aria-label", title);
            b.tabIndex = -1; // la barre espace ne doit jamais « cliquer » un de ces boutons
            b.addEventListener("mousedown", function (e) { e.preventDefault(); e.stopPropagation(); });
            b.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
            b.addEventListener("click", function (e) { e.stopPropagation(); fn(); });
            return b;
        }
        var prevBtn = mkBtn("‹", "Image précédente", function () { step(-1); });
        var nextBtn = mkBtn("›", "Image suivante", function () { step(1); });
        var fullBtn = mkBtn(EXPAND_ICON_SVG, "Plein écran / fenêtre", function () { setFull(!full); });
        var closeBtn = mkBtn("✕", "Fermer (Échap)", function () { closeBox(); });
        head.appendChild(caption);
        if (images.length > 1) { head.appendChild(prevBtn); head.appendChild(nextBtn); }
        head.appendChild(fullBtn);
        head.appendChild(closeBtn);
        var body = document.createElement("div");
        body.className = "img-viewer-body";
        var img = document.createElement("img");
        img.alt = "";
        body.appendChild(img);
        panel.appendChild(head);
        panel.appendChild(body);

        var cleanupResize = makePanelResizable(panel, "img-viewer");
        var cleanupDrag = makePanelDraggable(panel, "img-viewer", head);
        function setFull(on) {
            full = on;
            panel.classList.toggle("img-viewer-full", on);
            fullBtn.classList.toggle("img-viewer-btn-on", on);
        }
        function show() {
            var meta = images[idx];
            img.removeAttribute("src");
            loadImageInto(img, meta, function (why) { caption.textContent = why === "illisible" ? "Image illisible : format non pris en charge par ce navigateur" : "Image absente de cet appareil"; });
            caption.textContent = (images.length > 1 ? (idx + 1) + " / " + images.length + " · " : "") + (meta.name || "");
        }
        function step(d) { if (images.length > 1) { idx = (idx + d + images.length) % images.length; show(); } }
        function closeBox() {
            window.removeEventListener("keydown", onKey, true);
            cleanupResize(); cleanupDrag();
            panel.remove();
            if (imageViewerClose === closeBox) imageViewerClose = null;
        }
        function typing() { var t = document.activeElement; return !!(t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); }
        function onKey(e) {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeBox(); }
            else if (!typing() && e.key === "ArrowRight") { step(1); }
            else if (!typing() && e.key === "ArrowLeft") { step(-1); }
            // les autres touches (barre espace…) ne sont pas interceptées
        }
        img.addEventListener("click", function () { step(1); });
        body.addEventListener("dblclick", function () { setFull(!full); });
        imageViewerClose = closeBox;
        panel.style.visibility = "hidden";
        document.body.appendChild(panel);
        window.addEventListener("keydown", onKey, true);
        setFull(full);
        show();
        requestAnimationFrame(function () {
            var rect = panel.getBoundingClientRect();
            var stored = loadPanelPositions()["img-viewer"];
            var pos = stored ? clampPanelPosition(stored.left, stored.top, rect.width)
                : { left: Math.max(8, (window.innerWidth - rect.width) / 2), top: Math.max(8, (window.innerHeight - rect.height) / 3) };
            panel.style.left = pos.left + "px";
            panel.style.top = pos.top + "px";
            panel.style.visibility = "visible";
        });
    }
    function openImageLightbox(images, startIndex) { openImageViewer(images, startIndex, false); }

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
            loadImageInto(im, meta, function (why) { b.classList.add("img-missing"); b.textContent = why === "illisible" ? "Image illisible : format non pris en charge par ce navigateur" : "Image absente de cet appareil"; });
            b.appendChild(im);
            b.addEventListener("click", function () { openImageViewer(list, i, false); });
            cell.appendChild(b);
            var fs = document.createElement("button");
            fs.type = "button";
            fs.className = "img-thumb-full";
            fs.innerHTML = EXPAND_ICON_SVG;
            fs.title = "Ouvrir en plein écran";
            fs.setAttribute("aria-label", "Ouvrir en plein écran");
            fs.addEventListener("click", function (e) { e.stopPropagation(); openImageViewer(list, i, true); });
            var side = document.createElement("div");
            side.className = "img-thumb-side";
            side.appendChild(fs);
            cell.appendChild(side);
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
                side.appendChild(rm);
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
    var NOTE_BUBBLE_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 8.2V7a3.5 3.5 0 0 1 3.5-3.5H18A3.5 3.5 0 0 1 21.5 7v3a3.5 3.5 0 0 1-3.5 3.5h-.4l.8 3.2-3.9-3.2h-.5"/><path d="M6 8.5h5a3.5 3.5 0 0 1 3.5 3.5v2a3.5 3.5 0 0 1-3.5 3.5H8l-3.6 3.2.7-3.3A3.5 3.5 0 0 1 2.5 14v-2A3.5 3.5 0 0 1 6 8.5Z"/></svg>';
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
        if (entry.type === "instrument") {
            var all = [];
            (entry.data.categories || []).forEach(function (c) { all = all.concat(filesOf({ type: "folder", data: c })); });
            return all;
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
        if (entry.type === "instrument") { // un espace entier, avec ses sessions, ses onglets et son planning à venir
            if (!findById(state.instruments, entry.data.id)) state.instruments.push(entry.data);
            var t0 = calTodayKey();
            (entry.sessions || []).forEach(function (g) { if (!state.settings.guidedSessions.some(function (x) { return x.id === g.id; })) state.settings.guidedSessions.push(g); });
            (entry.sessionFolders || []).forEach(function (f) { if (!state.settings.sessionFolders.some(function (x) { return x.id === f.id; })) state.settings.sessionFolders.push(f); });
            (entry.plan || []).forEach(function (pe) { if (pe.date >= t0 && !state.settings.sessionPlan.some(function (x) { return x.id === pe.id; })) state.settings.sessionPlan.push(pe); });
            state.activeInstrumentId = entry.data.id;
        } else if (entry.type === "session") {
            if (!findById(state.instruments, entry.data.instrumentId)) entry.data.instrumentId = state.activeInstrumentId;
            entry.data.tabIds = (entry.data.tabIds || []).filter(function (id) { return state.settings.sessionFolders.some(function (f) { return f.id === id; }); });
            state.settings.guidedSessions.push(entry.data);
            var today = calTodayKey(), back = 0;
            (entry.plan || []).forEach(function (pe) { // son planning à venir revient avec elle
                if (pe.date < today || state.settings.sessionPlan.some(function (x) { return x.date === pe.date && x.sessionId === pe.sessionId; })) return;
                state.settings.sessionPlan.push(pe); back++;
            });
            if (back) setTimeout(function () { showToast("« " + entry.data.name + " » restaurée, avec " + back + " séance" + (back > 1 ? "s" : "") + " au calendrier"); }, 0);
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
                return { ex: found.ex, folder: found.folder, inst: inst, pathNames: found.pathNames, pathIds: found.pathIds, chapterColor: (rootChapter && rootChapter.color) || "#00e676" };
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

    // Liens iReal Pro (irealb:// ou irealbook:// : le morceau est dans le lien lui-même, fourni par la fonction
    // de partage d'iReal Pro). Ils s'ouvrent via l'application du système, pas dans un onglet.
    var IREAL_SCHEME_RE = /^(irealb|irealbook|ireal):\/\//i;
    function openExternalLink(url) {
        if (IREAL_SCHEME_RE.test(url)) {
            var a = document.createElement("a");
            a.href = url;
            a.rel = "noopener";
            a.style.display = "none";
            document.body.appendChild(a);
            a.click();
            setTimeout(function () { a.remove(); }, 0);
            return;
        }
        window.open(url, "_blank", "noopener,noreferrer");
    }

    function guessLinkLabel(url) {
        if (IREAL_SCHEME_RE.test(url)) return "iReal Pro";
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
        youtube: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="0.8" y="4" width="22.4" height="16" rx="4.2"/><path d="M9.6 8.2v7.6l6.6-3.8z" fill="currentColor" stroke="none"/></svg>',
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
            // Largeur MAXIMALE = celle du texte : le titre n'occupe pas plus que son texte (le reste de la ligne reste
            // cliquable pour déplier), mais il peut rétrécir (points de suspension) quand la place manque.
            input.style.width = "";
            input.style.maxWidth = (exerciseTitleMeasurer.offsetWidth + 22) + "px";
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
            var areas = document.querySelectorAll(".notes-textarea, .notes-fixed-textarea");
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
    function bindContextGesture(el, openFn, opts) {
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
            var inner = e.target.closest("button, input, textarea, select");
            // Un bouton garde son propre clic ; `opts.selfButton` : l'élément est lui-même un bouton dont
            // le clic vérifie suppressNextClick (l'appui long y ouvre donc le menu sans déclencher le clic).
            if (inner && !(opts && opts.selfButton && inner === el)) return;
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
            fixedNotes: ex.fixedNotes || "",
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
        toastUndo("« " + folder.name + " » mis à la corbeille");
    }

    // Suppression d'un exercice : si des sessions l'utilisent, on le dit (avec leurs noms) avant de confirmer.
    function deleteExerciseGuarded(ex, folder, inst) {
        var u = exerciseUsage(ex.id);
        var msg = "Supprimer « " + ex.title + " » ?";
        if (u.sessions.length) msg += "\n\n⚠ " + exerciseUsageText(u) + "\nCes sessions afficheront « exercice supprimé » à sa place. Il reste récupérable dans la corbeille.";
        if (!window.confirm(msg)) return false;
        addToTrash("exercise", ex, { instrumentId: (inst || getActiveInstrument()).id, parentFolderId: folder.id });
        var i = folder.exercises.indexOf(ex);
        if (i !== -1) folder.exercises.splice(i, 1);
        save();
        render();
        toastUndo("« " + ex.title + " » mis à la corbeille");
        return true;
    }

    // Met une session à la corbeille avec son planning à venir (sans demander) ; renvoie le nombre de séances retirées du calendrier.
    function gsTrashSession(session) {
        var today = calTodayKey();
        var plan = state.settings.sessionPlan.filter(function (pe) { return pe.sessionId === session.id; });
        var future = plan.filter(function (pe) { return pe.date >= today; }).length;
        addToTrash("session", session, { plan: cloneJson(plan) });
        state.settings.sessionPlan = state.settings.sessionPlan.filter(function (pe) { return pe.sessionId !== session.id; });
        delete gsDrafts[session.id];
        if (gsEditingSession && gsEditingSession.id === session.id) { gsEditingSession = null; if (gsScreen === "edit" || gsScreen === "pick") gsScreen = "list"; }
        var arr = state.settings.guidedSessions, k = arr.indexOf(session);
        if (k !== -1) arr.splice(k, 1);
        return future;
    }
    // Suppression d'une session : ses séances prévues au calendrier partent avec elle (et reviennent si on la
    // restaure depuis la corbeille) ; l'historique des séances déjà faites, lui, ne bouge pas.
    function deleteSessionGuarded(session, after) {
        var today = calTodayKey();
        var future = state.settings.sessionPlan.filter(function (pe) { return pe.sessionId === session.id && pe.date >= today; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
        var msg = "Supprimer la session « " + session.name + " » ?";
        if (future.length) msg += "\n\n⚠ Elle est prévue " + future.length + " fois au calendrier (prochaine : " + calLongDate(future[0].date) + ") : ces séances seront retirées du calendrier.";
        if (gsDraftDirty(session.id)) msg += "\n⚠ Ses modifications non enregistrées seront perdues.";
        msg += "\n\nLes séances déjà faites restent dans l'historique. La session reste récupérable dans la corbeille" + (future.length ? ", avec son planning." : ".");
        if (!window.confirm(msg)) return false;
        var nFuture = gsTrashSession(session);
        save();
        render();
        if (after) after();
        toastUndo("Session « " + session.name + " » mise à la corbeille" + (nFuture ? " (et " + nFuture + " séance" + (nFuture > 1 ? "s" : "") + " du calendrier)" : ""));
        return true;
    }
    function deleteSessionsGuarded(list) {
        if (list.length === 1) return deleteSessionGuarded(list[0]);
        var today = calTodayKey(), ids = {}, dirty = 0;
        list.forEach(function (g) { ids[g.id] = true; if (gsDraftDirty(g.id)) dirty++; });
        var nPlan = state.settings.sessionPlan.filter(function (pe) { return ids[pe.sessionId] && pe.date >= today; }).length;
        var msg = "Supprimer " + list.length + " sessions ?\n\n" + list.slice(0, 8).map(function (g) { return "• " + g.name; }).join("\n") + (list.length > 8 ? "\n… et " + (list.length - 8) + " autres" : "");
        if (nPlan) msg += "\n\n⚠ " + nPlan + " séance" + (nPlan > 1 ? "s" : "") + " au calendrier seront retirées.";
        if (dirty) msg += "\n⚠ " + dirty + " session" + (dirty > 1 ? "s ont" : " a") + " des modifications non enregistrées, perdues.";
        msg += "\n\nLes séances déjà faites restent dans l'historique. Tout reste récupérable dans la corbeille" + (nPlan ? ", avec le planning." : ".");
        if (state.settings.trash.length + list.length > TRASH_LIMIT) msg += "\n⚠ La corbeille garde au plus " + TRASH_LIMIT + " éléments : les plus anciens seront supprimés pour de bon.";
        if (!window.confirm(msg)) return false;
        list.forEach(gsTrashSession);
        sessSel = {}; sessSelAnchor = null;
        save();
        render();
        toastUndo(list.length + " sessions mises à la corbeille" + (nPlan ? " (et " + nPlan + " séance" + (nPlan > 1 ? "s" : "") + " du calendrier)" : ""));
        return true;
    }

    // Tableau qui contient un dossier (les chapitres de l'espace, ou les sous-dossiers de son parent).
    function parentArrayOf(inst, folder) {
        var p = findPathTo(inst, folder.id);
        if (!p) return null;
        if (p.length === 1) return inst.categories;
        var parent = findFolderById(inst, p[p.length - 2]);
        return parent ? parent.folders : null;
    }
    // Range un dossier (et tout son contenu) dans un autre dossier. Les sessions et les statistiques suivent :
    // elles désignent les exercices par identifiant, pas par emplacement.
    function moveFolderInto(inst, folder, dest) {
        if (dest === folder || collectFolderAndDescendantIds(folder).indexOf(dest.id) !== -1) { showToast("Impossible de ranger un dossier dans lui-même ou dans un de ses sous-dossiers."); return false; }
        var parentArray = parentArrayOf(inst, folder);
        if (!parentArray) return false;
        if (dest.folders === parentArray) { showToast("« " + folder.name + " » est déjà dans « " + dest.name + " »"); return false; }
        if (folderDepth(inst, dest.id) + folderSubtreeDepth(folder) > MAX_FOLDER_DEPTH) {
            window.alert("Impossible de déplacer ici : la profondeur maximale (" + MAX_FOLDER_DEPTH + " niveaux) serait dépassée.");
            return false;
        }
        if (folderNameTaken(dest.folders, folder.name) && !confirmNameCollision("dossier", folder.name)) return false;
        parentArray.splice(parentArray.indexOf(folder), 1);
        dest.folders.push(folder);
        var currentPath = getNavPath(inst);
        if (currentPath.indexOf(folder.id) !== -1) setNavPath(inst, (findPathTo(inst, dest.id) || []).concat(folder.id));
        treeExpanded[dest.id] = true;
        save();
        render();
        toastUndo("« " + folder.name + " » rangé dans « " + dest.name + " »");
        return true;
    }
    // Copie d'un dossier placée ailleurs : le suffixe « (copie) » n'est gardé que si le nom est déjà pris là-bas.
    function copyFolderInto(inst, folder, dest) {
        if (folderDepth(inst, dest.id) + folderSubtreeDepth(folder) > MAX_FOLDER_DEPTH) {
            window.alert("Impossible de copier ici : la profondeur maximale (" + MAX_FOLDER_DEPTH + " niveaux) serait dépassée.");
            return false;
        }
        var copy = duplicateFolderDeep(folder);
        (function strip(f) {
            f.folders.forEach(function (sub) { sub.name = sub.name.replace(/ \(copie\)$/, ""); strip(sub); });
            f.exercises.forEach(function (e) { e.title = e.title.replace(/ \(copie\)$/, ""); });
        })(copy);
        if (!folderNameTaken(dest.folders, folder.name)) copy.name = folder.name;
        delete copy.color;
        dest.folders.push(copy);
        treeExpanded[dest.id] = true;
        save();
        render();
        toastUndo("« " + folder.name + " » copié dans « " + dest.name + " »");
        return true;
    }
    function openFolderDropMenu(x, y, inst, folder, dest) {
        if (dest === folder) { render(); return; }
        openLinksQuickMenu(x, y, [
            { label: "Ranger « " + folder.name + " » dans « " + dest.name + " »", open: function () { moveFolderInto(inst, folder, dest); } },
            { label: "Copier dans « " + dest.name + " »", open: function () { copyFolderInto(inst, folder, dest); } },
            { label: "Annuler", open: function () { render(); } }
        ]);
    }

    // Choix d'un exercice pour une session : glisser (souris) un exercice ou un dossier sur un dossier
    // (attribut data-pick-folder) pour le ranger ; clic droit, ou appui long au doigt, pour son menu.
    // Au doigt, pas de glisser : le geste sert à faire défiler la liste (le menu propose « Déplacer vers… »).
    function bindPickGesture(el, onMenu, onDrop) {
        var sx = 0, sy = 0, pid = null, ghost = null, moved = false, timer = null, menuAt = 0, hover = null, offX = 0, offY = 0;
        el.addEventListener("contextmenu", function (e) {
            e.preventDefault(); e.stopPropagation();
            if (Date.now() - menuAt < 900) return; // déjà ouvert par l'appui long
            onMenu(e.clientX, e.clientY);
        });
        function cleanup() {
            if (timer) { clearTimeout(timer); timer = null; }
            window.removeEventListener("pointermove", mv);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", cleanup);
            if (ghost) { ghost.remove(); ghost = null; }
            if (hover) { hover.classList.remove("drop-hover"); hover = null; }
            el.classList.remove("dragging");
            pid = null; moved = false;
        }
        el.addEventListener("pointerdown", function (e) {
            if (e.button !== undefined && e.button !== 0) return;
            if (e.target.closest(".tree-twisty")) return;
            cleanup();
            sx = e.clientX; sy = e.clientY; pid = e.pointerId;
            if (e.pointerType !== "mouse") timer = setTimeout(function () {
                timer = null; menuAt = Date.now();
                suppressNextClick = true;
                setTimeout(function () { suppressNextClick = false; }, 700);
                cleanup();
                onMenu(sx, sy);
            }, LONG_PRESS_MS);
            window.addEventListener("pointermove", mv);
            window.addEventListener("pointerup", up);
            window.addEventListener("pointercancel", cleanup);
        });
        function mv(e) {
            if (e.pointerId !== pid) return;
            if (!moved) {
                if (Math.abs(e.clientX - sx) < 10 && Math.abs(e.clientY - sy) < 10) return;
                if (timer) { clearTimeout(timer); timer = null; }
                if (e.pointerType !== "mouse" || !onDrop) { cleanup(); return; }
                moved = true;
                var r = el.getBoundingClientRect();
                offX = sx - r.left; offY = sy - r.top;
                ghost = el.cloneNode(true);
                ghost.classList.add("drag-ghost", "gs-pick-ghost");
                ghost.style.position = "fixed"; ghost.style.width = r.width + "px"; ghost.style.margin = "0"; ghost.style.pointerEvents = "none";
                document.body.appendChild(ghost);
                el.classList.add("dragging");
            }
            e.preventDefault();
            ghost.style.left = (e.clientX - offX) + "px";
            ghost.style.top = (e.clientY - offY) + "px";
            var under = document.elementFromPoint ? document.elementFromPoint(e.clientX, e.clientY) : null;
            var t = under && under.closest ? under.closest("[data-pick-folder]") : null;
            if (t && el.contains(t)) t = null;
            if (t !== hover) { if (hover) hover.classList.remove("drop-hover"); hover = t; if (t) t.classList.add("drop-hover"); }
        }
        function up(e) {
            if (e.pointerId !== pid) return;
            var target = hover, wasMoved = moved;
            cleanup();
            if (!wasMoved) return;
            suppressNextClick = true;
            setTimeout(function () { suppressNextClick = false; }, 60);
            if (target) { var rr = target.getBoundingClientRect(); onDrop(target.getAttribute("data-pick-folder"), rr.right, rr.top + rr.height / 2); }
        }
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
        if (closeActiveModal) { backdrop.classList.add("ctx-over-modal"); menu.classList.add("ctx-over-modal"); } // ouvert depuis une fenêtre (statistiques, calendrier) : au-dessus d'elle

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
                // Si le dossier déplacé faisait partie du chemin affiché, on le suit à son nouvel emplacement (voir moveFolderInto).
                openFolderPickerModal("Déplacer « " + folder.name + " » vers…", excludeIds, function (dest) { moveFolderInto(inst, folder, dest); });
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
                    toastUndo("« " + folder.name + " » fusionné dans « " + dest.name + " »");
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
            var nEx = folderExerciseIds(folder).length, u = exerciseUsage(folderExerciseIds(folder));
            if (nEx || u.sessions.length) {
                var warn = document.createElement("div");
                warn.className = "ctx-message ctx-warn";
                warn.textContent = (nEx ? nEx + " exercice" + (nEx > 1 ? "s" : "") + " dedans. " : "") + (u.sessions.length ? "⚠ " + u.steps + " pas de session" + (u.steps > 1 ? "s" : "") + " les utilise" + (u.steps > 1 ? "nt" : "") + " (" + u.sessions.slice(0, 3).map(function (g) { return "« " + g.name + " »"; }).join(", ") + (u.sessions.length > 3 ? "…" : "") + ") : ils afficheront « exercice supprimé ». " : "") + "Tout reste récupérable dans la corbeille.";
                menu.appendChild(warn);
            }
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

    // Renommer un exercice : le nouveau nom apparaît partout (sessions, calendrier, statistiques), car tout
    // y fait référence par identifiant ; seul l'historique garde aussi le nom d'alors.
    function renameExercisePrompt(ex, folder, after) {
        var n = window.prompt("Nouveau nom de l'exercice :", ex.title);
        if (n === null) return false;
        n = n.trim();
        if (!n || n === ex.title) return false;
        if (folder && exerciseTitleTaken(folder.exercises, n, ex) && !confirmNameCollision("exercice", n)) return false;
        var old = ex.title;
        ex.title = n;
        touchExercise(ex);
        save();
        render();
        if (after) after();
        var u = exerciseUsage(ex.id);
        toastUndo("« " + old + " » renommé en « " + n + " »" + (u.sessions.length ? " (à jour dans " + u.sessions.length + " session" + (u.sessions.length > 1 ? "s" : "") + ")" : ""));
        return true;
    }
    // Ajoute un ou plusieurs exercices à une session enregistrée (et à son brouillon ouvert, pour que rien ne s'écrase).
    function gsAddExerciseToSession(session, exs) {
        exs = Array.isArray(exs) ? exs : [exs];
        var de = gsDrafts[session.id], clean = de ? !gsDraftDirty(session.id) : true, total = 0;
        exs.forEach(function (ex) {
            var step = { id: uid(), exerciseId: ex.id, minutes: gsDefaultMinutes(ex) };
            session.steps.push(step);
            if (de) de.draft.steps.push(cloneJson(step));
            total += step.minutes;
        });
        if (de && clean) de.base = gsDraftSig(de);
        save();
        render();
        toastUndo(exs.length === 1 ? "« " + exs[0].title + " » ajouté à « " + session.name + " » (" + total + " min)" : exs.length + " exercices ajoutés à « " + session.name + " » (" + total + " min)");
    }
    function openAddToSessionMenu(x, y, exs, above) {
        exs = Array.isArray(exs) ? exs : [exs];
        var first = exs[0], inst = (findExerciseById(first.id) || {}).inst || getActiveInstrument();
        var list = state.settings.guidedSessions.filter(function (g) { return g.instrumentId === inst.id && !g.archived && !g.ephemeral; })
            .sort(function (a, b) { return a.name.localeCompare(b.name, "fr", { sensitivity: "base" }); });
        var items = [{ label: "＋ Nouvelle session avec " + (exs.length > 1 ? "ces " + exs.length + " exercices" : "cet exercice"), open: function () {
            var name = window.prompt("Nom de la nouvelle session :", first.title);
            if (name === null || !name.trim()) return;
            var sess = { id: uid(), name: name.trim(), steps: [], instrumentId: inst.id, tabIds: [], createdAt: Date.now() };
            state.settings.guidedSessions.push(sess);
            gsAddExerciseToSession(sess, exs);
            exSelClear();
        } }];
        list.forEach(function (g) {
            var n = g.steps.filter(function (st) { return exs.some(function (ex) { return ex.id === st.exerciseId; }); }).length;
            items.push({ label: g.name + (n ? "  (" + (exs.length === 1 ? "déjà dedans" : n + " déjà dedans") + ")" : ""), open: function () { gsAddExerciseToSession(g, exs); exSelClear(); } });
        });
        openLinksQuickMenu(x, y, items, above);
    }

    // ---------- sélection multiple d'exercices (Ctrl/⌘ + clic, Maj + clic) ----------
    // Une sélection d'exercices peut traverser plusieurs dossiers : on retient leurs identifiants (dans l'ordre des
    // clics) et on les retrouve au moment d'agir. Une barre en bas propose les actions groupées.
    var exSel = {}, exSelSeq = 0, exSelAnchor = null;
    function exSelCount() { return Object.keys(exSel).length; }
    function exSelIds() { return Object.keys(exSel).sort(function (a, b) { return exSel[a] - exSel[b]; }); }
    function exSelItems() {
        return exSelIds().map(function (id) { var f = findExerciseById(id); return f ? { ex: f.ex, folder: f.folder, inst: f.inst, pathNames: f.pathNames } : null; }).filter(Boolean);
    }
    function exSelSet(id, on) { if (on) { if (!(id in exSel)) exSel[id] = ++exSelSeq; } else delete exSel[id]; }
    function exSelClear() { exSel = {}; exSelAnchor = null; exSelRefreshUI(); }
    function exSelToggle(id) { exSelSet(id, !(id in exSel)); exSelAnchor = id; exSelRefreshUI(); }
    function exSelVisibleIds() { return Array.prototype.map.call($folderContainer.querySelectorAll("[data-ex-id]"), function (el) { return el.dataset.exId; }); }
    function exSelRange(toId) {
        var ids = exSelVisibleIds(), a = ids.indexOf(exSelAnchor), b = ids.indexOf(toId);
        if (a === -1 || b === -1) { exSelToggle(toId); return; }
        for (var i = Math.min(a, b); i <= Math.max(a, b); i++) exSelSet(ids[i], true);
        exSelRefreshUI();
    }
    // Ce clic sur une ligne d'exercice sert-il à (dé)sélectionner ? Oui avec Ctrl/⌘/Maj, ou dès qu'une sélection existe.
    function exSelWantsClick(e) {
        var inner = e.target.closest && e.target.closest("button, a, textarea, select");
        if (inner && inner !== e.currentTarget) return false; // un bouton DANS la ligne garde son rôle (la ligne peut elle-même être un bouton)
        return !!(e.ctrlKey || e.metaKey || e.shiftKey) || exSelCount() > 0;
    }
    function exSelClick(e, id) {
        if (e.target.closest && e.target.closest("input") && document.activeElement && document.activeElement.blur) document.activeElement.blur();
        if (e.shiftKey && exSelAnchor) exSelRange(id); else exSelToggle(id);
    }

    function exSelMove(items, dest) {
        var moved = items.filter(function (it) { return it.folder !== dest; });
        if (!moved.length) { showToast("Déjà dans « " + dest.name + " »"); return false; }
        var coll = moved.filter(function (it) { return exerciseTitleTaken(dest.exercises, it.ex.title); }).length;
        if (coll && !window.confirm(coll + " exercice" + (coll > 1 ? "s portent" : " porte") + " déjà le même nom dans « " + dest.name + " ». Continuer quand même ?")) return false;
        moved.forEach(function (it) { it.folder.exercises.splice(it.folder.exercises.indexOf(it.ex), 1); dest.exercises.push(it.ex); });
        exSel = {}; exSelAnchor = null;
        save(); render();
        toastUndo(moved.length + " exercice" + (moved.length > 1 ? "s" : "") + " déplacé" + (moved.length > 1 ? "s" : "") + " vers « " + dest.name + " »");
        return true;
    }
    function exSelCopy(items, dest) {
        items.forEach(function (it) {
            var copy = duplicateExercise(it.ex);
            if (!exerciseTitleTaken(dest.exercises, it.ex.title)) copy.title = it.ex.title; // dans un autre dossier : pas de « (copie) » sauf si le nom y existe déjà
            dest.exercises.push(copy);
        });
        exSel = {}; exSelAnchor = null;
        save(); render();
        toastUndo(items.length + " exercice" + (items.length > 1 ? "s" : "") + " copié" + (items.length > 1 ? "s" : "") + " dans « " + dest.name + " »");
    }
    function exSelDelete(items) {
        var u = exerciseUsage(items.map(function (it) { return it.ex.id; }));
        var msg = "Supprimer " + items.length + " exercice" + (items.length > 1 ? "s" : "") + " ?\n\n" + items.slice(0, 8).map(function (it) { return "• " + it.ex.title; }).join("\n") + (items.length > 8 ? "\n… et " + (items.length - 8) + " autres" : "");
        if (u.sessions.length) msg += "\n\n⚠ " + u.steps + " pas de " + u.sessions.length + " session" + (u.sessions.length > 1 ? "s" : "") + " les utilisent (" + u.sessions.slice(0, 4).map(function (g) { return "« " + g.name + " »"; }).join(", ") + (u.sessions.length > 4 ? "…" : "") + ") : ils afficheront « exercice supprimé ».";
        if (state.settings.trash.length + items.length > TRASH_LIMIT) msg += "\n\n⚠ La corbeille garde au plus " + TRASH_LIMIT + " éléments : les plus anciens seront supprimés pour de bon.";
        msg += "\n\nIls restent récupérables dans la corbeille.";
        if (!window.confirm(msg)) return false;
        items.forEach(function (it) {
            addToTrash("exercise", it.ex, { instrumentId: it.inst.id, parentFolderId: it.folder.id });
            it.folder.exercises.splice(it.folder.exercises.indexOf(it.ex), 1);
        });
        exSel = {}; exSelAnchor = null;
        save(); render();
        toastUndo(items.length + " exercice" + (items.length > 1 ? "s" : "") + " mis à la corbeille");
        return true;
    }
    // Favori / archivé : si tous l'ont déjà, on le retire à tous ; sinon on l'ajoute à tous.
    function exSelFlag(items, field, labelOn, labelOff) {
        var all = items.every(function (it) { return !!it.ex[field]; });
        items.forEach(function (it) { it.ex[field] = !all; touchExercise(it.ex); });
        exSel = {}; exSelAnchor = null;
        save(); render();
        toastUndo(items.length + " exercice" + (items.length > 1 ? "s" : "") + " " + (all ? labelOff : labelOn));
    }
    function exSelPlace(items, move, btn) {
        openFolderPickerModal((move ? "Déplacer " : "Copier ") + items.length + " exercice" + (items.length > 1 ? "s" : "") + " vers…", [], function (dest) {
            var fresh = exSelItems();
            if (move) exSelMove(fresh.length ? fresh : items, dest); else exSelCopy(fresh.length ? fresh : items, dest);
        });
    }
    // Les actions groupées (barre du bas et clic droit sur une sélection).
    function exSelActions() {
        var items = exSelItems(), n = items.length, acts = [];
        if (!n) return acts;
        var plural = n > 1 ? "s" : "";
        if (guidedSessionViewActive && gsScreen === "pick" && gsPickMulti) {
            acts.push({ text: "＋ Ajouter à la session", primary: true, run: function () {
                var list = exSelItems().map(function (it) { return it.ex; });
                exSel = {}; exSelAnchor = null;
                gsPickMulti(list);
                gsScreen = "edit";
                render();
            } });
        } else {
            acts.push({ text: "＋ Session…", run: function (btn) { var r = btn.getBoundingClientRect(); openAddToSessionMenu(r.left, r.top, exSelItems().map(function (it) { return it.ex; }), true); } });
        }
        acts.push({ text: "Déplacer vers…", run: function () { exSelPlace(exSelItems(), true); } });
        acts.push({ text: "Copier vers…", run: function () { exSelPlace(exSelItems(), false); } });
        acts.push({ text: items.every(function (it) { return it.ex.favorite; }) ? "★ Retirer des favoris" : "☆ Favori", run: function () { exSelFlag(exSelItems(), "favorite", "ajouté" + plural + " aux favoris", "retiré" + plural + " des favoris"); } });
        acts.push({ text: items.every(function (it) { return it.ex.archived; }) ? "Désarchiver" : "Archiver", run: function () { exSelFlag(exSelItems(), "archived", "archivé" + plural, "désarchivé" + plural); } });
        acts.push({ text: "Supprimer…", danger: true, run: function () { exSelDelete(exSelItems()); } });
        return acts;
    }
    // Exercices lâchés (glisser) sur un dossier : déplacer ou copier toute la sélection.
    function openExercisesDropMenu(x, y, items, dest) {
        render(); // remet la liste en ordre (le glisser a pu la réordonner à l'écran)
        var n = items.length;
        openLinksQuickMenu(x, y, [
            { label: "Déplacer ici (" + n + " exercices)", open: function () { exSelMove(items, dest); } },
            { label: "Copier ici (" + n + " exercices)", open: function () { exSelCopy(items, dest); } },
            { label: "Annuler", open: function () {} }
        ]);
    }

    // Sessions : même principe (Ctrl/⌘ + clic) pour archiver, ranger dans un onglet ou supprimer plusieurs d'un coup.
    var sessSel = {}, sessSelAnchor = null;
    function sessSelCount() { return Object.keys(sessSel).length; }
    function sessSelList() { return state.settings.guidedSessions.filter(function (g) { return sessSel[g.id]; }); }
    function sessSelClear() { sessSel = {}; sessSelAnchor = null; exSelRefreshUI(); }
    function sessSelToggle(id) { if (sessSel[id]) delete sessSel[id]; else sessSel[id] = true; sessSelAnchor = id; exSelRefreshUI(); }
    function sessSelRange(toId) {
        var ids = Array.prototype.map.call($folderContainer.querySelectorAll(".gs-session-row[data-reorder-id]"), function (el) { return el.dataset.reorderId; });
        var a = ids.indexOf(sessSelAnchor), b = ids.indexOf(toId);
        if (a === -1 || b === -1) { sessSelToggle(toId); return; }
        for (var i = Math.min(a, b); i <= Math.max(a, b); i++) sessSel[ids[i]] = true;
        exSelRefreshUI();
    }
    function sessSelWantsClick(e) {
        var inner = e.target.closest && e.target.closest("button, a, input, textarea, select");
        if (inner && inner !== e.currentTarget) return false;
        return !!(e.ctrlKey || e.metaKey || e.shiftKey) || sessSelCount() > 0;
    }
    function sessSelClick(e, id) { if (e.shiftKey && sessSelAnchor) sessSelRange(id); else sessSelToggle(id); }
    function sessSelActions() {
        var list = sessSelList(), n = list.length, acts = [];
        if (!n) return acts;
        var tabs = state.settings.sessionFolders.filter(function (f) { return f.instrumentId === state.activeInstrumentId; });
        acts.push({ text: list.every(function (g) { return g.archived; }) ? "Désarchiver" : "Archiver", run: function () {
            var all = list.every(function (g) { return g.archived; });
            list.forEach(function (g) { g.archived = !all; });
            sessSel = {}; sessSelAnchor = null; save(); render();
            toastUndo(n + " session" + (n > 1 ? "s" : "") + (all ? " désarchivée" : " archivée") + (n > 1 ? "s" : ""));
        } });
        if (tabs.length) acts.push({ text: "Onglet…", run: function (btn) {
            var r = btn.getBoundingClientRect();
            openLinksQuickMenu(r.left, r.top, tabs.map(function (t) {
                var all = list.every(function (g) { return g.tabIds.indexOf(t.id) !== -1; });
                return { label: (all ? "✓ " : "＋ ") + "Onglet « " + t.name + " »" + (all ? " (retirer)" : ""), open: function () {
                    list.forEach(function (g) {
                        if (all) g.tabIds = g.tabIds.filter(function (id) { return id !== t.id; }); else if (g.tabIds.indexOf(t.id) === -1) g.tabIds.push(t.id);
                        var de = gsDrafts[g.id];
                        if (de) { var clean = !gsDraftDirty(g.id); de.draft.tabIds = g.tabIds.slice(); if (clean) de.base = gsDraftSig(de); }
                    });
                    sessSel = {}; sessSelAnchor = null; save(); render();
                    toastUndo(n + " session" + (n > 1 ? "s" : "") + (all ? " retirée" : " ajoutée") + (n > 1 ? "s" : "") + " de l'onglet « " + t.name + " »");
                } };
            }), true);
        } });
        acts.push({ text: "Supprimer…", danger: true, run: function () { deleteSessionsGuarded(list); } });
        return acts;
    }

    // La barre d'actions (sélection d'exercices OU de sessions) et la mise en évidence des lignes sélectionnées.
    var selBarEl = null;
    function selBarRender(cfg) {
        if (!cfg) { if (selBarEl) { selBarEl.remove(); selBarEl = null; } return; }
        if (!selBarEl) { selBarEl = document.createElement("div"); selBarEl.className = "sel-bar"; selBarEl.setAttribute("role", "toolbar"); selBarEl.setAttribute("aria-label", "Actions sur la sélection"); document.body.appendChild(selBarEl); }
        selBarEl.innerHTML = "";
        var lb = document.createElement("span"); lb.className = "sel-bar-count"; lb.textContent = cfg.label; selBarEl.appendChild(lb);
        cfg.actions.forEach(function (a) {
            var b = document.createElement("button"); b.type = "button";
            b.className = "sel-bar-btn" + (a.primary ? " sel-bar-primary" : "") + (a.danger ? " sel-bar-danger" : "");
            b.textContent = a.text;
            b.addEventListener("click", function () { a.run(b); });
            selBarEl.appendChild(b);
        });
        var all = document.createElement("button"); all.type = "button"; all.className = "sel-bar-btn sel-bar-ghost"; all.textContent = "Tout"; all.title = "Tout sélectionner dans cette liste";
        all.addEventListener("click", cfg.selectAll);
        selBarEl.appendChild(all);
        var x = document.createElement("button"); x.type = "button"; x.className = "sel-bar-btn sel-bar-ghost sel-bar-x"; x.textContent = "✕"; x.title = "Désélectionner (Échap)"; x.setAttribute("aria-label", "Désélectionner");
        x.addEventListener("click", cfg.clear);
        selBarEl.appendChild(x);
    }
    function exSelRefreshUI() {
        if (!$folderContainer) return;
        // Cas courant (rien de sélectionné, pas de barre à retirer) : aucun travail. Ce rafraîchissement a lieu à CHAQUE
        // affichage ; son coût entre dans la mesure `lastRenderMs`, qui décide si la recherche attend la fin de la frappe.
        if (!selBarEl && !exSelCount() && !sessSelCount()) return;
        var exOn = exSelCount() > 0, sessOn = false;
        if (exOn) { // exercices disparus (supprimés, autre espace) : retirés de la sélection
            var live = exerciseIdSet();
            Object.keys(exSel).forEach(function (id) { if (!live[id]) delete exSel[id]; });
            if (guidedSessionViewActive && gsScreen !== "pick") exSel = {}; // les écrans de session n'affichent pas ces exercices
            exOn = exSelCount() > 0;
        }
        var inList = guidedSessionViewActive && gsScreen === "list";
        if (!inList) sessSel = {};
        else { var ids = {}; state.settings.guidedSessions.forEach(function (g) { ids[g.id] = true; }); Object.keys(sessSel).forEach(function (id) { if (!ids[id]) delete sessSel[id]; }); }
        sessOn = sessSelCount() > 0;
        Array.prototype.forEach.call($folderContainer.querySelectorAll("[data-ex-id]"), function (el) { el.classList.toggle("selected", el.dataset.exId in exSel); });
        Array.prototype.forEach.call($folderContainer.querySelectorAll(".gs-session-row[data-reorder-id]"), function (el) { el.classList.toggle("selected", !!sessSel[el.dataset.reorderId]); });
        document.body.classList.toggle("ex-selecting", exOn);
        document.body.classList.toggle("sess-selecting", sessOn);
        if (exOn) {
            var n = exSelCount();
            selBarRender({ label: n + " exercice" + (n > 1 ? "s" : "") + " sélectionné" + (n > 1 ? "s" : ""), actions: exSelActions(), clear: exSelClear,
                selectAll: function () { exSelVisibleIds().forEach(function (id) { exSelSet(id, true); }); exSelRefreshUI(); } });
        } else if (sessOn) {
            var m = sessSelCount();
            selBarRender({ label: m + " session" + (m > 1 ? "s" : "") + " sélectionnée" + (m > 1 ? "s" : ""), actions: sessSelActions(), clear: sessSelClear,
                selectAll: function () { Array.prototype.forEach.call($folderContainer.querySelectorAll(".gs-session-row[data-reorder-id]"), function (el) { sessSel[el.dataset.reorderId] = true; }); exSelRefreshUI(); } });
        } else selBarRender(null);
    }
    document.addEventListener("keydown", function (e) {
        var t = e.target, typing = t && t.tagName && (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable);
        if (e.key === "Escape" && (exSelCount() || sessSelCount()) && !document.querySelector(".ctx-menu, .backups-panel")) { exSel = {}; exSelAnchor = null; sessSel = {}; sessSelAnchor = null; exSelRefreshUI(); }
        else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "a" && !typing && (exSelCount() || sessSelCount()) && !document.querySelector(".ctx-menu, .backups-panel")) {
            e.preventDefault();
            if (exSelCount()) exSelVisibleIds().forEach(function (id) { exSelSet(id, true); });
            else Array.prototype.forEach.call($folderContainer.querySelectorAll(".gs-session-row[data-reorder-id]"), function (el) { sessSel[el.dataset.reorderId] = true; });
            exSelRefreshUI();
        }
    }, true); // en phase de capture : un menu ouvert se referme d'abord (Échap), la sélection ne part qu'au 2e appui

    // Menu d'un exercice (clic droit / appui long), le même partout : liste des exercices, choix d'un exercice
    // pour une session, statistiques. `opts.reveal` : proposer « Ouvrir dans son dossier » ; `opts.after` :
    // rafraîchir la fenêtre d'où l'on vient ; `opts.noAddToSession` : déjà en train de choisir pour une session.
    function openExerciseMenu(x, y, ex, folder, opts) {
        opts = opts || {};
        closeFolderMenu();
        function done() { closeFolderMenu(); render(); if (opts.after) opts.after(); }

        var backdrop = document.createElement("div");
        backdrop.className = "ctx-backdrop";
        backdrop.addEventListener("pointerdown", function (e) { e.preventDefault(); closeFolderMenu(); });
        backdrop.addEventListener("contextmenu", function (e) { e.preventDefault(); closeFolderMenu(); });

        var menu = document.createElement("div");
        menu.className = "ctx-menu";
        menu.setAttribute("role", "menu");
        menu.addEventListener("contextmenu", function (e) { e.preventDefault(); });
        if (closeActiveModal) { backdrop.classList.add("ctx-over-modal"); menu.classList.add("ctx-over-modal"); } // ouvert depuis une fenêtre (statistiques, calendrier) : au-dessus d'elle

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
        var usage = exerciseUsage(ex.id);
        if (usage.sessions.length) {
            var useLine = document.createElement("div");
            useLine.className = "ctx-message ctx-usage";
            useLine.textContent = exerciseUsageText(usage);
            menu.appendChild(useLine);
        }

        if (opts.reveal) menu.appendChild(menuButton("Ouvrir dans son dossier", "", function () { closeFolderMenu(); revealExercise(ex.id); }));
        menu.appendChild(menuButton("Renommer…", "", function () { closeFolderMenu(); renameExercisePrompt(ex, folder, opts.after); }));
        if (!opts.noAddToSession) menu.appendChild(menuButton("Ajouter à une session…", "", function () { closeFolderMenu(); openAddToSessionMenu(x, y, ex); }));
        menu.appendChild(menuButton("Remplacer partout par…", "", function () { closeFolderMenu(); startReplaceEverywhere(ex.id, ex.title); }));
        if (!opts.noSelect) menu.appendChild(menuButton(ex.id in exSel ? "☐ Désélectionner" : "☑ Sélectionner (plusieurs)", "", function () { closeFolderMenu(); exSelToggle(ex.id); }));
        menu.appendChild(menuButton(ex.favorite ? "★ Retirer des favoris" : "☆ Marquer en favori", "", function () {
            ex.favorite = !ex.favorite;
            touchExercise(ex);
            save();
            done();
        }));
        menu.appendChild(menuButton(ex.archived ? "Désarchiver" : "Archiver", "", function () {
            ex.archived = !ex.archived;
            touchExercise(ex);
            save();
            done();
            if (ex.archived && usage.sessions.length) showToast("« " + ex.title + " » archivé : il reste dans ses sessions (rien n'est perdu).", 4500);
        }));

        if (folder) {
            menu.appendChild(menuButton("Dupliquer", "", function () {
                folder.exercises.push(duplicateExercise(ex));
                save();
                done();
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
                    if (opts.after) opts.after();
                    toastUndo("« " + ex.title + " » déplacé vers « " + dest.name + " »");
                });
            }));
            menu.appendChild(menuButton("Supprimer…", "ctx-danger", function () {
                closeFolderMenu();
                if (deleteExerciseGuarded(ex, folder, (findExerciseById(ex.id) || {}).inst) && opts.after) opts.after();
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
        if (closeActiveModal) { backdrop.classList.add("ctx-over-modal"); menu.classList.add("ctx-over-modal"); }
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
            toastUndo("« " + ex.title + " » déplacé vers « " + destFolder.name + " »");
        });
        choice("Copier ici", "", function () {
            closeFolderMenu();
            var copy = duplicateExercise(ex);
            // Dans un autre dossier, pas besoin du suffixe « (copie) » sauf si le nom y existe déjà.
            if (!exerciseTitleTaken(destFolder.exercises, ex.title)) copy.title = ex.title;
            destFolder.exercises.push(copy);
            save();
            render();
            toastUndo("« " + ex.title + " » copié dans « " + destFolder.name + " »");
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
        if (closeActiveModal) { backdrop.classList.add("ctx-over-modal"); menu.classList.add("ctx-over-modal"); } // ouvert depuis une fenêtre (statistiques, calendrier) : au-dessus d'elle

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
    var $quickFindBtn = document.getElementById("quickfind-btn");
    if ($quickFindBtn) $quickFindBtn.addEventListener("click", function () { openQuickFind(""); });
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
        var searchTimer = null;
        $searchInput.addEventListener("input", function () {
            searchQuery = $searchInput.value;
            clearTimeout(searchTimer);
            // affichage rapide : tout de suite ; affichage lent (beaucoup d'exercices, téléphone) : on attend la fin de la frappe
            if (lastRenderMs < 30) render(); else searchTimer = setTimeout(render, 140);
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

    var lastRenderMs = 0;
    function render() {
        var renderT0 = performance.now();
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
        exSelRefreshUI();
        lastRenderMs = performance.now() - renderT0;
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
        fitInstrumentSelect();
    }
    // La liste des espaces s'ajuste à la largeur du nom choisi (un <select> prend sinon la largeur du plus long nom).
    function fitInstrumentSelect() {
        var sel = $instrumentSelect, opt = sel.options[sel.selectedIndex];
        if (!opt) return;
        var cs = window.getComputedStyle(sel), probe = document.createElement("span");
        probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;left:-9999px;top:0;font:" + cs.font + ";letter-spacing:" + cs.letterSpacing;
        probe.textContent = opt.textContent;
        document.body.appendChild(probe);
        var w = probe.getBoundingClientRect().width;
        probe.remove();
        if (w > 0) sel.style.width = Math.ceil(w + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) + 22) + "px"; // 22 px : la flèche
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { fitInstrumentSelect(); });

    function renameInstrument(instrumentId) {
        var inst = state.instruments.filter(function (i) { return i.id === instrumentId; })[0];
        if (!inst) return;
        var name = window.prompt("Renommer l'espace (laisser vide pour le supprimer) :", inst.name);
        if (name === null) return;
        name = name.trim();
        if (!name) {
            if (state.instruments.length <= 1) return;
            var nEx = 0; (inst.categories || []).forEach(function (c) { nEx += folderExerciseIds(c).length; });
            var nSess = state.settings.guidedSessions.filter(function (gs) { return gs.instrumentId === instrumentId; }).length;
            if (!window.confirm("Supprimer l'espace « " + inst.name + " » ?\n\n⚠ " + nEx + " exercice" + (nEx > 1 ? "s" : "") + " et " + nSess + " session" + (nSess > 1 ? "s" : "") + " (avec leur planning) seront mis à la corbeille, d'où tu pourras tout restaurer d'un coup.")) return;
            addToTrash("instrument", inst, {
                sessions: state.settings.guidedSessions.filter(function (gs) { return gs.instrumentId === instrumentId; }),
                sessionFolders: state.settings.sessionFolders.filter(function (f) { return f.instrumentId === instrumentId; }),
                plan: state.settings.sessionPlan.filter(function (pe) { return pe.instrumentId === instrumentId; })
            });
            state.instruments = state.instruments.filter(function (i) { return i.id !== instrumentId; });
            state.settings.guidedSessions = state.settings.guidedSessions.filter(function (gs) { return gs.instrumentId !== instrumentId; });
            state.settings.sessionFolders = state.settings.sessionFolders.filter(function (f) { return f.instrumentId !== instrumentId; });
            state.settings.sessionPlan = state.settings.sessionPlan.filter(function (pe) { return pe.instrumentId !== instrumentId; });
            delete navPaths[instrumentId];
            if (state.activeInstrumentId === instrumentId) state.activeInstrumentId = state.instruments[0].id;
            save();
            render();
            toastUndo("Espace « " + inst.name + " » mis à la corbeille");
            return;
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
                if (ex && dest && exSelCount() > 1 && (ex.id in exSel)) openExercisesDropMenu(x, y, exSelItems(), dest); // toute la sélection suit
                else if (ex && dest) openExerciseDropMenu(x, y, ex, currentFolder, dest);
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
            var hasNotes = !!((ex.notes && ex.notes.trim()) || (ex.fixedNotes && ex.fixedNotes.trim()));
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
            if ((ex.notes || "").toLowerCase().indexOf(query) !== -1 || (ex.fixedNotes || "").toLowerCase().indexOf(query) !== -1) return true;
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
        el.className = "exercise" + (ex.collapsed ? " collapsed" : "") + (ex.id in exSel ? " selected" : "");
        el.dataset.reorderId = ex.id;
        el.dataset.exId = ex.id; // sélection multiple

        var row = document.createElement("div");
        row.className = "exercise-row";
        
        // Hors de la vue d'un dossier (recherche, favoris, archivés) : le menu propose aussi d'ouvrir son dossier.
        bindContextGesture(row, function (x, y) {
            if (exSelCount() > 1 && ex.id in exSel) openLinksQuickMenu(x, y, exSelActions().map(function (a) { return { label: a.text, open: function () { a.run(row); } }; }));
            else openExerciseMenu(x, y, ex, folder, { reveal: !orderingEnabled });
        });
        row.addEventListener("click", function (e) {
            if (suppressNextClick) { suppressNextClick = false; return; }
            if (exSelWantsClick(e)) { exSelClick(e, ex.id); return; } // Ctrl/⌘/Maj + clic, ou sélection en cours
            // Le titre (et les boutons) gardent leur propre clic : cliquer le reste de la ligne
            // déplie/replie les détails (remplace le chevron dédié, retiré pour épurer la ligne).
            if (e.target.closest("button, input, textarea, select")) return;
            ex.collapsed = !ex.collapsed;
            save();
            render();
        });

        var selBox = document.createElement("span");
        selBox.className = "ex-sel-box";
        selBox.setAttribute("aria-hidden", "true");
        selBox.textContent = "✓";
        row.appendChild(selBox);

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

        // Vignettes et bouton ✕ regroupés : sur un écran étroit, ce groupe passe en bloc sous le titre au lieu de déborder.
        var tools = document.createElement("div");
        tools.className = "exercise-row-tools";
        row.appendChild(tools);
        appendExerciseLinkButtons(tools, ex);
        if ((ex.notes && ex.notes.trim()) || (ex.fixedNotes && ex.fixedNotes.trim())) {
            var noteMark = document.createElement("span");
            noteMark.className = "exercise-note-mark";
            noteMark.innerHTML = NOTE_BUBBLE_SVG;
            noteMark.title = "Cet exercice a des notes";
            tools.appendChild(noteMark);
        }
        appendExerciseImageButton(tools, ex);
        var tempoChip = buildTempoChip({
            title: ex.title,
            exId: ex.id,
            get: function () { return ex.metronome; },
            set: function (p) { setExerciseMetronome(ex, p); }
        }, false);
        if (tempoChip) tools.appendChild(tempoChip);

        if (ex.archived) {
            var archBadge = document.createElement("span");
            archBadge.className = "exercise-archived-badge";
            archBadge.textContent = "Archivé";
            tools.appendChild(archBadge);
        }

        var delBtn = iconButton("✕", "Supprimer l'exercice", function () {
            deleteExerciseGuarded(ex, folder, getActiveInstrument());
        });
        tools.appendChild(delBtn);

        el.appendChild(row);

        if (!ex.collapsed) {
            el.appendChild(renderExerciseDetails(ex));
        } else {
            delete exerciseVideosOpen[ex.id];
            if (ex.fixedNotes && ex.fixedNotes.trim()) { // les notes fixes restent visibles même exercice replié
                var fixedView = document.createElement("div");
                fixedView.className = "exercise-fixed-view";
                fixedView.textContent = ex.fixedNotes.trim();
                fixedView.title = "Note fixe (clic : ouvrir l'exercice)";
                fixedView.addEventListener("click", function () { ex.collapsed = false; save(); render(); });
                el.appendChild(fixedView);
            }
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
            openExternalLink(link.url);
        });
        return btn;
    }

    function openLinksQuickMenu(x, y, links, above) { // above : le menu s'ouvre AU-DESSUS du point (y), ex. depuis la barre du bas
        closeFolderMenu();

        var backdrop = document.createElement("div");
        backdrop.className = "ctx-backdrop";
        backdrop.addEventListener("pointerdown", function (e) { e.preventDefault(); closeFolderMenu(); });
        backdrop.addEventListener("contextmenu", function (e) { e.preventDefault(); closeFolderMenu(); });

        var menu = document.createElement("div");
        menu.className = "ctx-menu";
        menu.setAttribute("role", "menu");
        menu.addEventListener("contextmenu", function (e) { e.preventDefault(); });
        if (closeActiveModal) { backdrop.classList.add("ctx-over-modal"); menu.classList.add("ctx-over-modal"); } // ouvert depuis une fenêtre : au-dessus d'elle

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
            var top = above ? Math.max(8, y - h - 6) : Math.min(Math.max(8, y), Math.max(8, window.innerHeight - h - 8));
            menu.style.left = left + "px";
            menu.style.top = top + "px";
        }

        links.forEach(function (link) {
            menu.appendChild(menuButton(link.label, function () {
                closeFolderMenu(); // d'abord : l'action peut ouvrir une fenêtre ou un popover qu'il ne faut pas refermer aussitôt
                if (link.open) link.open(); else openExternalLink(link.url);
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

    // Petit bouton « + date » au-dessus d'une zone de notes : insère « jj/mm/aa : » au début de la ligne du curseur.
    function buildDateStampBtn(ta) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "note-date-btn";
        b.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/></svg>';
        b.setAttribute("aria-label", "Ajouter la date d'aujourd'hui");
        b.title = "Ajouter la date d'aujourd'hui en haut de la note";
        b.addEventListener("mousedown", function (e) { e.preventDefault(); }); // garde le curseur dans la zone
        b.addEventListener("click", function () {
            // La date se pose toujours tout en haut, sur sa propre ligne ; le reste de la note descend d'une ligne.
            var stamp = formatNoteDate(todayIso()) + " : ";
            var v = ta.value;
            if (v.indexOf(stamp) === 0) { ta.focus(); var e1 = v.indexOf("\n"); var ep = e1 === -1 ? v.length : e1; ta.setSelectionRange(ep, ep); return; }
            ta.value = stamp + (v ? "\n" + v : "");
            ta.focus();
            ta.setSelectionRange(stamp.length, stamp.length);
            ta.scrollTop = 0;
            ta.dispatchEvent(new Event("input", { bubbles: true }));
        });
        return b;
    }

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

        // Notes fixes : consignes importantes, sans date, toujours visibles (aussi exercice replié et en session).
        var fixedLabel = document.createElement("div");
        fixedLabel.className = "section-label";
        fixedLabel.textContent = "Notes fixes";
        fixedLabel.title = "Toujours visibles : consignes importantes de l'exercice";
        var fixedStatus = document.createElement("span");
        fixedStatus.className = "save-status";
        fixedLabel.appendChild(fixedStatus);
        var fixedTa = document.createElement("textarea");
        fixedTa.className = "notes-fixed-textarea";
        fixedTa.rows = NOTES_MIN_ROWS;
        fixedTa.value = ex.fixedNotes || "";
        fixedTa.placeholder = "À ne pas oublier…";
        fixedTa.addEventListener("input", function () { autoGrowNotes(fixedTa); });
        bindAutosaveTextarea(fixedTa, function (value) {
            ex.fixedNotes = value;
            touchExercise(ex);
        }, fixedStatus, {
            onLeave: function () {
                var ft = ex.fixedNotes || "";
                askApplyToSameNamed(ex, ft.trim() ? "Remplacer leur note fixe par celle-ci ?" : "Effacer aussi leur note fixe ?",
                    function (o) { return (o.fixedNotes || "") !== ft; },
                    function (o) { o.fixedNotes = ft; });
            }
        });
        details.appendChild(fixedLabel);
        details.appendChild(fixedTa);

        var notesLabel = document.createElement("div");
        notesLabel.className = "section-label";
        notesLabel.textContent = "Notes mobiles";
        notesLabel.title = "Suivi au jour le jour : une date en tête de ligne, les plus anciennes lignes partent aux archives";
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
        notesLabel.appendChild(buildDateStampBtn(notes));
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
            if (!IREAL_SCHEME_RE.test(url) && !/^https?:\/\//i.test(url)) url = "https://" + url;
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
    // Clic droit / appui long sur un fichier joint : lire dans l'app, onglet du navigateur, ou « ouvrir avec » une autre
    // application (feuille de partage du système quand le navigateur la propose, sinon enregistrement du fichier).
    function openFileMenu(x, y, meta, container) {
        var items = [];
        if (isAudioFile(meta)) items.push({ label: "Lire dans TrainHub (vitesse réglable)", open: function () { toggleAudioPlayer(container, meta); } });
        items.push({ label: "Ouvrir dans un onglet du navigateur", open: function () {
            getFileBlob(meta.id).then(function (blob) {
                if (!blob) { window.alert("Ce fichier n'est disponible que sur l'appareil où il a été ajouté (« " + meta.name + " »)."); return; }
                var url = URL.createObjectURL(playableBlob(blob, meta));
                window.open(url, "_blank");
                setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
            });
        } });
        items.push({ label: "Ouvrir avec une autre application…", open: function () {
            getFileBlob(meta.id).then(function (blob) {
                if (!blob) { window.alert("Ce fichier n'est disponible que sur l'appareil où il a été ajouté (« " + meta.name + " »)."); return; }
                var pb = playableBlob(blob, meta);
                var file = null;
                try { file = new File([pb], meta.name || "fichier", { type: pb.type }); } catch (e) {}
                if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
                    navigator.share({ files: [file], title: meta.name }).catch(function () {});
                    return;
                }
                saveBlobAs(pb, meta.name);
                showToast("Fichier enregistré : ouvre-le depuis les téléchargements avec l'application de ton choix (clic droit → Ouvrir avec).", 7000);
            });
        } });
        items.push({ label: "Enregistrer le fichier…", open: function () {
            getFileBlob(meta.id).then(function (blob) { if (blob) saveBlobAs(playableBlob(blob, meta), meta.name); });
        } });
        openLinksQuickMenu(x, y, items);
    }
    function saveBlobAs(blob, name) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url; a.download = name || "fichier";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 4000);
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
            function lsGet(k, d) { try { var v = parseFloat(localStorage.getItem(k)); return isNaN(v) ? d : v; } catch (e) { return d; } }
            function lsSet(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }
            // Volume : barre réglable, retenue pour les prochains fichiers.
            var volWrap = document.createElement("label");
            volWrap.className = "audio-player-ctl";
            var volIcon = document.createElement("span"); volIcon.innerHTML = METRO_VOLUME_ICON_SVG; volIcon.className = "audio-player-ctl-icon";
            var vol = document.createElement("input");
            vol.type = "range"; vol.min = "0"; vol.max = "100"; vol.step = "1";
            vol.className = "audio-player-vol";
            vol.title = "Volume";
            vol.value = String(Math.round(lsGet("trainhub.audioVol", 1) * 100));
            audio.volume = vol.value / 100;
            vol.addEventListener("input", function () { audio.volume = vol.value / 100; lsSet("trainhub.audioVol", vol.value / 100); });
            volWrap.appendChild(volIcon); volWrap.appendChild(vol);
            // Vitesse : barre de 50 % à 125 % (pour travailler un passage plus lentement), retenue elle aussi.
            var rateWrap = document.createElement("label");
            rateWrap.className = "audio-player-ctl";
            var rateIcon = document.createElement("span"); rateIcon.innerHTML = METRO_CHRONO_ICON_SVG; rateIcon.className = "audio-player-ctl-icon";
            var rate = document.createElement("input");
            rate.type = "range"; rate.min = "50"; rate.max = "125"; rate.step = "5";
            rate.className = "audio-player-rate";
            rate.title = "Vitesse de lecture";
            rate.value = String(Math.round(lsGet("trainhub.audioRate", 1) * 100));
            var rateTxt = document.createElement("span"); rateTxt.className = "audio-player-rate-txt";
            function applyRate() { audio.playbackRate = rate.value / 100; rateTxt.textContent = rate.value + " %"; }
            rate.addEventListener("input", function () { applyRate(); lsSet("trainhub.audioRate", rate.value / 100); });
            rateTxt.title = "Double clic : vitesse normale";
            rateTxt.addEventListener("dblclick", function () { rate.value = "100"; applyRate(); lsSet("trainhub.audioRate", 1); });
            applyRate();
            rateWrap.appendChild(rateIcon); rateWrap.appendChild(rate); rateWrap.appendChild(rateTxt);
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
            box.appendChild(name); box.appendChild(audio); box.appendChild(volWrap); box.appendChild(rateWrap); box.appendChild(close); box.appendChild(msg);
            container.appendChild(box);
            audio.addEventListener("loadedmetadata", function () { applyRate(); });
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
            bindContextGesture(chip, function (x, y) { openFileMenu(x, y, meta, list); });

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
    var remoteLogRev = null;
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

    // ---- journal des sessions dans le cloud (un document par mois) ----
    function logCloudDoc(m) { return db.collection("users").doc(currentUser.uid).collection("apps").doc(LOG_DOC_PREFIX + m); }
    function logPushDirty() {
        if (!db || !currentUser) return Promise.resolve();
        return Promise.all(Object.keys(logDirty).map(function (m) {
            var b = logMonths[m], at = b.updatedAt;
            return logCloudDoc(m).set({ month: m, records: b.records, deleted: b.deleted, updatedAt: at }).then(function () {
                if (logMonths[m].updatedAt === at) delete logDirty[m];
            });
        }));
    }
    // Fusion d'un lot reçu avec le lot local : union des séances, moins les suppressions des deux côtés.
    // Renvoie true si le lot local a changé ; marque le lot « à envoyer » si le cloud n'avait pas tout.
    function logMergeRemote(m, data) {
        var b = logBucket(m);
        var del = {};
        b.deleted.concat(data.deleted || []).forEach(function (id) { del[id] = true; });
        var byId = {};
        b.records.concat(data.records || []).forEach(function (r) { if (r && r.id && !del[r.id] && !byId[r.id]) byId[r.id] = r; });
        var merged = Object.keys(byId).map(function (k) { return byId[k]; });
        var delList = Object.keys(del);
        var changedLocal = merged.length !== b.records.length || delList.length !== b.deleted.length;
        var cloudLacks = merged.length !== (data.records || []).length || delList.length !== (data.deleted || []).length;
        b.records = merged; b.deleted = delList; b.updatedAt = Math.max(b.updatedAt, data.updatedAt || 0);
        logFlat = null; logSaveMonth(m);
        if (cloudLacks) logDirty[m] = true;
        return changedLocal;
    }
    function logSyncFromCloud(remoteRev) {
        if (!db || !currentUser) return Promise.resolve();
        remoteRev = remoteRev || {};
        var months = {};
        Object.keys(remoteRev).forEach(function (m) { months[m] = true; });
        Object.keys(logMonths).forEach(function (m) { months[m] = true; });
        var tasks = Object.keys(months).filter(function (m) {
            return !logMonths[m] || remoteRev[m] === undefined || remoteRev[m] !== logMonths[m].updatedAt;
        }).map(function (m) {
            if (remoteRev[m] === undefined) { logDirty[m] = true; return Promise.resolve(false); } // inconnu du cloud : à envoyer
            return logCloudDoc(m).get().then(function (snap) {
                if (!snap.exists) { if (logMonths[m]) logDirty[m] = true; return false; }
                return logMergeRemote(m, snap.data());
            });
        });
        return Promise.all(tasks).then(function (changed) {
            return logPushDirty().then(function () { if (changed.some(Boolean)) render(); });
        }).catch(function (e) { console.error("Synchro du journal impossible", e); setSyncStatus("error"); });
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
            var rev = remote.settings ? remote.settings.logRev : null;
            applyRemoteState(remote);
            logSyncFromCloud(rev);
            setSyncStatus("synced");
        }, function (e) {
            console.error("Écoute de la synchro interrompue", e);
            setSyncStatus("error");
        });
    }

    // Conflit de première synchronisation : le cloud contient nettement plus d'exercices que cet appareil. Le choix sûr
    // (garder les données en ligne) est le premier bouton, celui d'Échap et d'un clic à côté ; remplacer demande une
    // seconde confirmation qui dit ce qui sera effacé.
    function askSyncConflict(remoteN, localN) {
        return new Promise(function (resolve) {
            var backdrop = document.createElement("div");
            backdrop.className = "ctx-backdrop";
            var menu = document.createElement("div");
            menu.className = "ctx-menu ctx-menu-dialog";
            menu.setAttribute("role", "dialog");
            function plural(n) { return n + " exercice" + (n > 1 ? "s" : ""); }
            function done(keepRemote) {
                backdrop.remove(); menu.remove(); document.removeEventListener("keydown", onKey, true);
                resolve(keepRemote);
            }
            function onKey(e) { if (e.key === "Escape") { e.preventDefault(); done(true); } }
            function put(title, text, buttons) {
                menu.innerHTML = "";
                var h = document.createElement("div"); h.className = "ctx-menu-title ctx-menu-title-wrap"; h.textContent = title; menu.appendChild(h);
                var t = document.createElement("div"); t.className = "ctx-menu-text"; t.textContent = text; menu.appendChild(t);
                buttons.forEach(function (c) {
                    var b = document.createElement("button"); b.type = "button";
                    b.className = "ctx-item" + (c.muted ? " ctx-item-muted" : "") + (c.main ? " ctx-item-main" : "");
                    b.textContent = c.text; b.addEventListener("click", c.run); menu.appendChild(b);
                });
            }
            function step1() {
                put("Données en ligne trouvées", "En ligne : " + plural(remoteN) + ". Sur cet appareil : " + plural(localN) + ".", [
                    { text: "Garder les données en ligne (recommandé)", main: true, run: function () { done(true); } },
                    { text: "Remplacer les données en ligne par celles de cet appareil…", muted: true, run: step2 }
                ]);
            }
            function step2() {
                put("Remplacer les données en ligne ?", "Les " + plural(remoteN) + " en ligne seront remplacés par les " + plural(localN) + " de cet appareil, sur tous tes appareils. Une sauvegarde de secours de la version en ligne est gardée sur cet appareil.", [
                    { text: "Non, garder les données en ligne", main: true, run: function () { done(true); } },
                    { text: "Oui, remplacer", muted: true, run: function () { done(false); } }
                ]);
            }
            backdrop.addEventListener("pointerdown", function (e) { e.preventDefault(); done(true); });
            step1();
            document.body.appendChild(backdrop);
            document.body.appendChild(menu);
            document.addEventListener("keydown", onKey, true);
            var w = menu.offsetWidth || 320, h2 = menu.offsetHeight || 180;
            menu.style.left = Math.max(8, (window.innerWidth - w) / 2) + "px";
            menu.style.top = Math.max(8, (window.innerHeight - h2) / 3) + "px";
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
            remoteLogRev = remote && remote.settings ? remote.settings.logRev : null;
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
                var remoteN = totalExerciseCount(remote), localN = totalExerciseCount(state);
                if (localN === 0) {
                    // Appareil (ou navigateur) vide : rien à « garder » ici, et pousser du vide effacerait les données en
                    // ligne sur tous les appareils. On récupère simplement la version en ligne, sans rien demander.
                    applyRemoteState(remote);
                    showToast("Données en ligne récupérées (" + remoteN + " exercice" + (remoteN > 1 ? "s" : "") + ").", 4000);
                    return null;
                }
                return askSyncConflict(remoteN, localN).then(function (keepRemote) {
                    if (keepRemote) { applyRemoteState(remote); return null; }
                    return docRef.set(cloudState());
                });
            }
            return docRef.set(cloudState());
        }).then(function () {
            setSyncStatus("synced");
            attachSnapshotListener();
            syncImagesToCloud();
            logSyncFromCloud(remoteLogRev);
            render();
        }).catch(function (e) {
            console.error("Synchro initiale impossible", e);
            setSyncStatus("error");
            attachSnapshotListener();
        });
    }

    function pushToCloud() {
        if (!currentUser || !docRef) return;
        // le journal d'abord : un autre appareil qui voit le document principal doit trouver les lots à jour
        logPushDirty().catch(function (e) { console.error("Envoi du journal impossible", e); }).then(function () { return docRef.set(cloudState()); }).then(function () {
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
        if (!auth) { showToast("La connexion se prépare… réessaie dans un instant (ou vérifie ta connexion internet)."); return; }
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

    // Firebase (plusieurs centaines de Ko) se charge après le premier affichage : l'application s'ouvre sans
    // attendre ce téléchargement (hors ligne ou réseau lent : plus de blocage au démarrage).
    function loadScriptOnce(src) {
        return new Promise(function (resolve, reject) {
            var el = document.createElement("script");
            el.src = src; el.async = false;
            el.onload = resolve;
            el.onerror = function () { reject(new Error("chargement impossible : " + src)); };
            document.head.appendChild(el);
        });
    }
    function loadFirebaseThenInit() {
        var base = "https://www.gstatic.com/firebasejs/10.13.2/";
        loadScriptOnce(base + "firebase-app-compat.js")
            .then(function () { return Promise.all([loadScriptOnce(base + "firebase-auth-compat.js"), loadScriptOnce(base + "firebase-firestore-compat.js"), loadScriptOnce("firebase-config.js")]); })
            .then(initFirebase)
            .catch(function (e) { console.warn("Firebase indisponible : mode local uniquement.", e); });
    }
    (window.requestIdleCallback || function (f) { setTimeout(f, 60); })(loadFirebaseThenInit, { timeout: 1500 });

    // ---------- top actions ----------

    $instrumentSelect.addEventListener("change", function () {
        exSel = {}; exSelAnchor = null; sessSel = {}; sessSelAnchor = null;
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
        downloadJson(exportState(), "trainhub-sauvegarde-" + dateStr + ".json");
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
        if (entry.type === "instrument") {
            var n = 0; (entry.data.categories || []).forEach(function (c) { n += folderExerciseIds(c).length; });
            return "Espace · " + entry.data.name + " (" + n + " exercice" + (n > 1 ? "s" : "") + ", " + (entry.sessions || []).length + " session" + ((entry.sessions || []).length > 1 ? "s" : "") + ")";
        }
        return "Session guidée · " + entry.data.name;
    }

    function openTrashPanel() {
        openModal("trash-panel", function (panel) {
            var title = document.createElement("div");
            title.className = "backups-title";
            title.textContent = "Corbeille";
            panel.appendChild(title);

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
                    var ids = entry.type === "exercise" && entry.data ? [entry.data.id] : entry.type === "folder" && entry.data ? folderExerciseIds(entry.data) : [];
                    var u = ids.length ? exerciseUsage(ids) : { sessions: [] };
                    var warnTxt = u.sessions.length ? "\n\n⚠ " + exerciseUsageText(u).replace(/^Utilisé/, ids.length > 1 ? "Ses exercices sont utilisés" : "Utilisé") + " Ces pas resteront « exercice supprimé » pour de bon." : "";
                    if (!window.confirm("Supprimer définitivement cet élément ? Impossible à annuler." + warnTxt)) return;
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
    var PANEL_FIT_MAX_ZOOM = 2.4;
    // `allowGrow` : seulement quand la HAUTEUR de la boîte est imposée (fenêtre flottante à taille fixée, volet dont la
    // hauteur a été choisie). Sinon (volet « auto »), un contenu qui grossit agrandirait la boîte, qui laisserait encore
    // grossir le contenu… jusqu'au maximum : on garde alors le comportement d'avant (jamais au-delà de 100 %).
    function fitPanelContentZoom(box, inner, allowGrow) {
        if (!box.clientHeight || !box.clientWidth) return 1;
        var maxZ = allowGrow ? PANEL_FIT_MAX_ZOOM : 1;
        function fitsAt(z) {
            inner.style.zoom = z === 1 ? "" : String(z);
            return box.scrollHeight <= box.clientHeight + 1 && box.scrollWidth <= box.clientWidth + 1;
        }
        // Déjà bien ajusté (le zoom actuel tient et un cran de plus ne tiendrait plus) : rien à recalculer — évite une
        // recherche complète à chaque changement de texte (tap tempo, tempo qui monte…).
        var z0 = parseFloat(inner.style.zoom) || 1;
        if (z0 <= maxZ + 1e-6 && fitsAt(z0) && (z0 >= maxZ - 1e-6 || !fitsAt(Math.min(maxZ, z0 * 1.015)))) { fitsAt(z0); return z0; }
        var lo, hi;
        if (fitsAt(1)) {
            if (maxZ <= 1) return 1;
            // Plus de place que de contenu (fenêtre agrandie) : le contenu grossit pour la remplir.
            lo = 1; hi = maxZ;
            if (fitsAt(hi)) return hi;
        } else { lo = PANEL_FIT_MIN_ZOOM; hi = 1; }
        for (var i = 0; i < 10; i++) {
            var mid = (lo + hi) / 2;
            if (fitsAt(mid)) lo = mid; else hi = mid;
        }
        if (lo < 1.02 && lo >= 1) { fitsAt(1); return 1; } // pas de micro-zoom pour un écart négligeable
        fitsAt(lo);
        return lo;
    }
    // Facteur de taille par défaut d'une fenêtre d'outil selon l'écran : à l'aise sur un grand écran, inchangé sur un petit.
    function panelGrowFactor() { return Math.max(1, Math.min(1.6, Math.min(window.innerWidth / 1100, window.innerHeight / 780))); }
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
        var grow = panelGrowFactor();
        w = Math.min(Math.round(w * grow), window.innerWidth - 16);
        panel.style.width = w + "px";
        var h = Math.min(Math.round(panel.offsetHeight * grow), window.innerHeight - 16);
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
        function onKey(e) { if (e.key === "Escape") { if (document.querySelector(".ctx-menu")) return; close(); } } // un menu ouvert par-dessus (popover, clic droit) se referme seul : Échap ne ferme que lui
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
            if (!fitContent) {
                if (userSized || panel.dataset.userSized) { panel.style.minWidth = baseMin.w + "px"; panel.style.minHeight = baseMin.h + "px"; return; } // taille choisie à la main : on ne la « cliquette » plus vers le haut
                recalcPanelFit(panel, baseMin.w, baseMin.h); return;
            }
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
            var dockFixedH = docked && $metroDock && !!$metroDock.style.getPropertyValue("--metro-panel-h");
            fitPanelContentZoom(fitBox, fitInner, !isMobilePanelLayout() && (!docked || dockFixedH));
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
        if (METRO_SOUNDS.indexOf(m.sound) === -1) m.sound = "click"; // timbre du clic (réglage général, voir Paramètres)
        // Réglages de tempo progressif enregistrés (à retrouver d'un clic) : [{ id, name, progressive }].
        if (!Array.isArray(m.progPresets)) m.progPresets = [];
        m.progPresets = m.progPresets.filter(function (pr) { return pr && typeof pr === "object" && pr.progressive && typeof pr.progressive === "object"; }).map(function (pr) {
            var q = pr.progressive, stages = Array.isArray(q.stages) ? q.stages : [];
            return {
                id: typeof pr.id === "string" && pr.id ? pr.id : uid(),
                name: typeof pr.name === "string" && pr.name.trim() ? pr.name.trim().slice(0, 40) : "Réglage",
                progressive: {
                    stagesMode: q.stagesMode === true && stages.length > 0,
                    everySeconds: Math.min(600, Math.max(1, Math.round(Number(q.everySeconds)) || 20)),
                    limitBpm: Math.min(300, Math.max(0, Math.round(Number(q.limitBpm)) || 0)),
                    restoreOnStop: q.restoreOnStop === true,
                    stages: stages.map(function (st) { return { inc: 1, every: Math.min(600, Math.max(1, Math.round(Number(st && st.every)) || 20)), until: Math.min(300, Math.max(30, Math.round(Number(st && st.until)) || 100)) }; })
                }
            };
        });
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
    // Page masquée ou vidéo en plein écran : le fil principal peut être ralenti → on programme plus loin à l'avance.
    function metroAheadS() { return (document.hidden || document.fullscreenElement || document.webkitFullscreenElement) ? 0.4 : METRO_SCHEDULE_AHEAD_S; }

    // Le contexte audio peut être « interrupted » (iOS : autre appli, écran verrouillé) ou « suspended » : seul un
    // resume() lancé pendant un geste le réveille, et il arrive qu'il reste mort. Dans ce cas on en reconstruit un
    // neuf au prochain geste (lancer le métronome) plutôt que de laisser un son muet jusqu'au redémarrage de l'appli.
    var metroCtxLost = false;       // la page a quitté l'avant-plan : le contexte est peut-être mort
    function metroBuildAudio() {
        var old = metroAudioCtx;
        metroAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        metroMasterGain = metroAudioCtx.createGain();
        metroMasterGain.gain.value = state.settings.metronome.volume;
        metroMasterGain.connect(metroAudioCtx.destination);
        metroCtxLost = false;
        var built = metroAudioCtx;
        built.onstatechange = function () { // coupé puis rendu (vidéo plein écran, appel, autre appli) : on relance le son tout seul
            if (built !== metroAudioCtx || !metroPlaying) return;
            if (built.state === "running") metroNextNoteTime = Math.max(metroNextNoteTime, built.currentTime + 0.05);
            else metroReviveAudio();
        };
        if (old) { try { old.close(); } catch (e) {} }
        try { // note muette : « débloque » la sortie son sur iOS dès ce geste
            var b = metroAudioCtx.createBuffer(1, 1, 22050), src = metroAudioCtx.createBufferSource();
            src.buffer = b; src.connect(metroAudioCtx.destination); src.start(0);
        } catch (e) {}
    }
    function ensureMetroAudio(fromGesture) {
        var ctx = metroAudioCtx;
        if (!ctx || ctx.state === "closed" || (fromGesture && metroCtxLost && !metroPlaying)) metroBuildAudio();
        if (metroAudioCtx.state !== "running") {
            try { var pr = metroAudioCtx.resume(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
        }
        return metroAudioCtx;
    }
    // Tant que le métronome joue et que le contexte audio n'est pas en marche, on tente de le réveiller (toutes les 0,5 s).
    var metroReviveTimer = null;
    function metroReviveAudio() {
        if (metroReviveTimer || !metroPlaying) return;
        (function again() {
            metroReviveTimer = null;
            if (!metroPlaying || !metroAudioCtx || metroAudioCtx.state === "running") return;
            try { var pr = metroAudioCtx.resume(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
            metroReviveTimer = setTimeout(again, 500);
        })();
    }
    ["fullscreenchange", "webkitfullscreenchange"].forEach(function (ev) {
        document.addEventListener(ev, function () { if (metroPlaying) { metroReviveAudio(); if (metroAudioCtx && metroAudioCtx.state === "running") metroNextNoteTime = Math.max(metroNextNoteTime, metroAudioCtx.currentTime + 0.05); } });
    });
    // Le contexte avance-t-il vraiment ? (une horloge figée = sortie morte)
    function metroAudioAlive() { return !!metroAudioCtx && metroAudioCtx.state === "running"; }

    // Retour sur la page : le métronome qui « jouait » a pu être coupé par le système. On tente de réveiller le son ;
    // si le contexte ne repart pas, on arrête proprement le métronome (le bouton repasse sur « Jouer ») : un appui
    // suffit alors pour repartir, avec un contexte neuf.
    function metroOnReturn() {
        if (!metroAudioCtx) return;
        if (metroAudioCtx.state !== "running") { try { var pr = metroAudioCtx.resume(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {} }
        if (!metroPlaying) return;
        setTimeout(function () {
            if (!metroPlaying || document.hidden) return;
            if (metroAudioAlive()) { metroNextNoteTime = Math.max(metroNextNoteTime, metroAudioCtx.currentTime + 0.05); return; }
            if (!metroCtxLost) return; // simple retour de focus, sans passage en arrière-plan : on ne coupe rien
            metroCtxLost = true;
            if (metroPanelApi) metroPanelApi.toggle(); else stopMetronome();
            showToast("Le son du métronome a été coupé par le système : appuie sur Jouer pour le relancer.", 5000);
        }, 450);
    }
    document.addEventListener("visibilitychange", function () {
        if (document.hidden) metroCtxLost = true; else metroOnReturn();
    });
    window.addEventListener("pageshow", function () { metroOnReturn(); });
    window.addEventListener("focus", function () { if (metroAudioCtx && metroAudioCtx.state !== "running") metroOnReturn(); });

    function setMetroVolume(v) {
        state.settings.metronome.volume = v;
        if (metroMasterGain) metroMasterGain.gain.value = v;
    }

    // Quatre timbres au choix (Paramètres › Métronome). Tous sont synthétisés ici (aucun fichier audio) et
    // distinguent le temps accentué (level 2) du temps normal (level 1) par la hauteur et le niveau.
    // Le « clic classique » : un filtre passe-bas adoucit les harmoniques aiguës, et une courte montée en volume
    // (quelques ms) avant la décroissance évite le « clic » sec d'un signal qui démarre net à son maximum.
    function metroNoiseBuffer(ctx) {
        if (!ctx._trNoise) {
            var n = Math.floor(ctx.sampleRate * 0.08), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0), last = 0;
            for (var i = 0; i < n; i++) { var w = Math.random() * 2 - 1; last = 0.55 * last + 0.45 * w; d[i] = last * 1.6; } // bruit « rose » léger
            ctx._trNoise = buf;
        }
        return ctx._trNoise;
    }
    function metroClick(time, level) {
        if (!level) return; // pas rendu muet
        var ctx = metroAudioCtx, accent = level >= 2, kind = state.settings.metronome.sound || "click";
        if (kind === "wood") { // bloc de bois : un bruit bref coloré par une résonance étroite, plus un petit corps grave
            var src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
            src.buffer = metroNoiseBuffer(ctx);
            bp.type = "bandpass"; bp.frequency.value = accent ? 1250 : 880; bp.Q.value = 2.4;
            g.gain.setValueAtTime(0.0001, time);
            g.gain.linearRampToValueAtTime(accent ? 3.1 : 2.1, time + 0.002);
            g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
            src.connect(bp); bp.connect(g); g.connect(metroMasterGain);
            src.start(time); src.stop(time + 0.06);
            var body = ctx.createOscillator(), bg = ctx.createGain();
            body.type = "sine"; body.frequency.setValueAtTime(accent ? 420 : 320, time);
            bg.gain.setValueAtTime(0.0001, time); bg.gain.linearRampToValueAtTime(accent ? 0.28 : 0.2, time + 0.002); bg.gain.exponentialRampToValueAtTime(0.001, time + 0.045);
            body.connect(bg); bg.connect(metroMasterGain); body.start(time); body.stop(time + 0.05);
            return;
        }
        if (kind === "clave") { // claves : deux résonances aiguës très brèves, non harmoniques
            [[1, 1], [2.47, 0.32]].forEach(function (p) {
                var o = ctx.createOscillator(), g2 = ctx.createGain();
                o.type = "sine"; o.frequency.value = (accent ? 2750 : 2250) * p[0];
                g2.gain.setValueAtTime(0.0001, time);
                g2.gain.linearRampToValueAtTime((accent ? 0.62 : 0.42) * p[1], time + 0.001);
                g2.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
                o.connect(g2); g2.connect(metroMasterGain); o.start(time); o.stop(time + 0.08);
            });
            return;
        }
        if (kind === "bell") { // cloche douce : fondamentale + partiels inharmoniques qui s'éteignent plus vite
            var f0 = accent ? 1046.5 : 784;
            [[1, 0.32, 0.42], [2.76, 0.085, 0.22], [5.4, 0.03, 0.1]].forEach(function (p) {
                var o = ctx.createOscillator(), g3 = ctx.createGain();
                o.type = "sine"; o.frequency.value = f0 * p[0];
                g3.gain.setValueAtTime(0.0001, time);
                g3.gain.linearRampToValueAtTime(p[1] * (accent ? 1.25 : 1), time + 0.006);
                g3.gain.exponentialRampToValueAtTime(0.001, time + p[2]);
                o.connect(g3); g3.connect(metroMasterGain); o.start(time); o.stop(time + p[2] + 0.02);
            });
            return;
        }
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
        osc.frequency.value = accent ? 1100 : 780;
        var peak = accent ? 0.75 : 0.38;
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.linearRampToValueAtTime(peak, time + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.065);
        osc.start(time);
        osc.stop(time + 0.07);
    }
    // Écoute d'un timbre (Paramètres) : un temps accentué puis deux temps normaux.
    function metroPreviewSound(kind) {
        var m = state.settings.metronome, prev = m.sound;
        try {
            var ctx = ensureMetroAudio(true), t = ctx.currentTime + 0.06;
            m.sound = kind;
            [2, 1, 1].forEach(function (lvl, i) { metroClick(t + i * 0.42, lvl); });
        } catch (e) {}
        m.sound = prev; // le timbre ne change réellement qu'une fois choisi dans la liste
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

    var metroBeatLog = []; // derniers temps programmés { t : instant (horloge audio), d : durée du temps (s), a : accent } — sert à l'anneau lumineux du cadran
    var metroBeatListeners = []; // fonctions (pas, estUnTemps, force) appelées à chaque clic — ex. la fenêtre flottante
    function metroScheduler() {
        var m = state.settings.metronome;
        // Minuteur ralenti (onglet en arrière-plan) : si l'on a pris plus de 0,25 s de retard, on repart de
        // maintenant plutôt que de rattraper d'un coup une rafale de clics.
        if (metroNextNoteTime < metroAudioCtx.currentTime - 0.25) metroNextNoteTime = metroAudioCtx.currentTime + 0.05;
        var ahead = metroAheadS();
        while (metroNextNoteTime < metroAudioCtx.currentTime + ahead) {
            // Relu à chaque pas : changer de formule ou basculer "…" pendant la lecture prend effet
            // tout de suite, sans pas fantôme au-delà de la nouvelle longueur de motif.
            var layer = metroActiveLayer(m);
            var stepCount = Math.max(1, layer.pattern.length);
            if (metroCurrentStep >= stepCount) metroCurrentStep = 0;
            if (metroTrainFadeTick(m) && metroTempoCallback) metroTempoCallback();
            if (metroCurrentStep % Math.max(1, layer.subdivision) === 0) { // un temps : l'anneau lumineux du cadran repart du bas
                metroBeatLog.push({ t: metroNextNoteTime, d: layer.subdivision < 1 ? 60 / m.bpm / layer.subdivision : 60 / m.bpm, a: layer.pattern[metroCurrentStep] >= 2 });
                if (metroBeatLog.length > 6) metroBeatLog.shift();
            }
            if (!metroTrainMuted(m, metroCurrentStep, layer.subdivision)) metroClick(metroNextNoteTime, layer.pattern[metroCurrentStep]);
            if (metroBeatCallback || metroBeatListeners.length) {
                var step = metroCurrentStep, delayMs = Math.max(0, (metroNextNoteTime - metroAudioCtx.currentTime) * 1000);
                var isBeat = step % Math.max(1, layer.subdivision) === 0, strength = layer.pattern[step];
                setTimeout(function () {
                    if (!metroPlaying) return;
                    if (metroBeatCallback) metroBeatCallback(step);
                    metroBeatListeners.forEach(function (fn) { try { fn(step, isBeat, strength); } catch (e) {} });
                }, delayMs);
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
        if (!metroWorker) metroTimer = setTimeout(metroScheduler, METRO_LOOKAHEAD_MS);
    }

    // Cadence du planificateur : un Web Worker (ses minuteries ne sont pas ralenties quand la page est en arrière-plan,
    // masquée ou recouverte par une vidéo en plein écran, contrairement à setTimeout). Repli sur setTimeout sans Worker.
    var metroWorker = null, metroWorkerUrl = null;
    function metroStartTicker() {
        if (typeof Worker !== "function" || typeof Blob !== "function" || !window.URL || !URL.createObjectURL) return;
        try {
            if (!metroWorker) {
                var src = "var t=null;onmessage=function(e){if(e.data==='start'){if(t)clearInterval(t);t=setInterval(function(){postMessage(1)}," + METRO_LOOKAHEAD_MS + ")}else if(e.data==='stop'){if(t){clearInterval(t);t=null}}};";
                metroWorkerUrl = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
                metroWorker = new Worker(metroWorkerUrl);
                metroWorker.onmessage = function () { if (metroPlaying) metroScheduler(); };
                metroWorker.onerror = function () { metroWorker = null; if (metroPlaying && !metroTimer) metroTimer = setTimeout(metroScheduler, METRO_LOOKAHEAD_MS); };
            }
            metroWorker.postMessage("start");
        } catch (e) { metroWorker = null; }
    }
    function metroStopTicker() { if (metroWorker) { try { metroWorker.postMessage("stop"); } catch (e) {} } }

    function startMetronome() {
        if (metroPlaying) return;
        ensureMetroAudio(true);
        metroPlaying = true;
        metroCurrentStep = 0;
        metroProgNextAt = null; // le décompte du tempo progressif repart à chaque lancement
        metroProgIdx = -1; metroProgRan = false; metroProgHoldUntil = null;
        metroMeasureIdx = 0; metroTrainRemoved = []; metroTrainNextAt = null;
        metroBeatLog.length = 0;
        var pm = state.settings.metronome.progressive;
        metroProgStartBpm = (pm.enabled && pm.restoreOnStop) ? state.settings.metronome.bpm : null;
        metroNextNoteTime = metroAudioCtx.currentTime + 0.05;
        metroStartTicker();
        metroScheduler();
    }

    var metroStopListeners = []; // appelées à l'arrêt du métronome, AVANT qu'un retour au tempo de départ ne change le BPM
    function stopMetronome() {
        if (metroPlaying) metroStopListeners.forEach(function (fn) { try { fn(); } catch (e) {} });
        metroPlaying = false;
        metroStopTicker();
        if (metroTimer) { clearTimeout(metroTimer); metroTimer = null; }
        if (metroReviveTimer) { clearTimeout(metroReviveTimer); metroReviveTimer = null; }
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
        if (cfg.own && cfg.own() && act.eff) { chip.classList.add("tempo-chip-own"); chip.title += " (tempo propre à cette session)"; }
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
        save();
    }

    // Mise à jour du métronome d'un exercice : vaut pour toutes les sessions qui l'utilisent, sauf celles où le pas
    // a son propre tempo (case « Tempo propre à cette session » : step.metronome), qui reste indépendant.
    function setExerciseMetronome(ex, preset) {
        ex.metronome = preset;
        touchExercise(ex);
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
                linkBar.hidden = !dirty; // discret : visible seulement quand le réglage diffère de celui de l'exercice
                linkBar.classList.toggle("metro-link-dirty", dirty);
                linkTxt.textContent = metroLink.title;
                linkTxt.title = "Réglage modifié · « " + metroLink.title + " »";
                linkSave.textContent = metroLink.base ? "Mettre à jour" : "Enregistrer";
                linkSave.title = "Enregistrer ce réglage dans l'exercice";
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
                saveSoon();
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
                saveSoon();
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
            // Anneau lumineux discret : à chaque temps, un petit éclat part du bas du cadran et fait le tour, dans le sens
            // des aiguilles d'une montre, en un temps. Calé sur l'horloge audio (comme le son), pas sur un minuteur.
            var dialFlash = document.createElement("div");
            dialFlash.className = "metro-dial-flash";
            dialFlash.setAttribute("aria-hidden", "true");
            dial.appendChild(dialFlash);
            var flashRaf = null;
            var flashReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            function dialFlashFrame() {
                flashRaf = null;
                if (!metroPlaying || !metroAudioCtx || !dialFlash.isConnected) { dial.classList.remove("metro-flash-on"); return; }
                var now = metroAudioCtx.currentTime - (metroAudioCtx.outputLatency || 0), cur = null;
                for (var bi = metroBeatLog.length - 1; bi >= 0; bi--) if (metroBeatLog[bi].t <= now) { cur = metroBeatLog[bi]; break; }
                if (cur) {
                    var ph = Math.max(0, Math.min(1, (now - cur.t) / cur.d));
                    dialFlash.style.setProperty("--fa", (180 + ph * 360).toFixed(1) + "deg"); // 180° = bas du cadran ; l'angle croît dans le sens horaire
                    dialFlash.style.setProperty("--fs", cur.a ? "0.62" : "0.42");
                    dial.classList.add("metro-flash-on");
                } else dial.classList.remove("metro-flash-on");
                flashRaf = requestAnimationFrame(dialFlashFrame);
            }
            function dialFlashStart() { if (!flashRaf && !flashReduced) flashRaf = requestAnimationFrame(dialFlashFrame); }
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

            // Options à droite du bouton (deux lignes : « +1 BPM toutes les 20 s » puis « Seuil … ⋯ ») ; le reste dessous.
            var progSide = document.createElement("div");
            progSide.className = "metro-prog-side";
            toolsRow.appendChild(progSide);
            var progFields = document.createElement("div");
            progFields.className = "metro-progressive-fields";

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

            function refreshProgStatus() {} // l'ancienne phrase d'état (« +1 BPM toutes les … ») n'est plus affichée

            function renderProgFields() {
                var p = m.progressive;
                progFields.innerHTML = "";
                progSide.innerHTML = "";
                // Un seul tableau, simple ou par paliers : « Délai (s) » avant chaque +1 BPM | « Seuil (BPM) » du palier.
                // Réglage simple = une ligne (délai et seuil facultatif) ; « + » ajoute un palier (donc des lignes en plus).
                var rows = p.stagesMode ? p.stages : [{ every: p.everySeconds, until: p.limitBpm, simple: true }];
                var tbl = document.createElement("table");
                tbl.className = "metro-prog-table";
                var head = document.createElement("thead");
                var hr = document.createElement("tr");
                ["Délai (s)", "Seuil (BPM)"].forEach(function (t) { var th = document.createElement("th"); th.textContent = t; hr.appendChild(th); });
                var th3 = document.createElement("th");
                // À l'arrêt, retour au tempo de départ : une icône à activer plutôt qu'une phrase.
                var ret = document.createElement("button");
                ret.type = "button";
                ret.className = "metro-mini-btn metro-prog-return" + (p.restoreOnStop ? " metro-progressive-active" : "");
                ret.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';
                ret.title = "À l'arrêt, revenir au tempo de départ";
                ret.setAttribute("aria-label", "Revenir au tempo de départ à l'arrêt");
                ret.setAttribute("aria-pressed", p.restoreOnStop ? "true" : "false");
                ret.addEventListener("click", function () {
                    p.restoreOnStop = !p.restoreOnStop;
                    ret.classList.toggle("metro-progressive-active", p.restoreOnStop);
                    ret.setAttribute("aria-pressed", p.restoreOnStop ? "true" : "false");
                    save();
                });
                th3.appendChild(ret);
                hr.appendChild(th3);
                head.appendChild(hr);
                tbl.appendChild(head);
                var body = document.createElement("tbody");
                rows.forEach(function (st, i) {
                    var line = document.createElement("tr");
                    line.className = "metro-prog-stage";
                    var c1 = document.createElement("td"), c2 = document.createElement("td"), c3 = document.createElement("td");
                    c1.appendChild(progNumber(st.every, 1, 600, function (n) {
                        var v = Math.min(600, Math.max(1, n || 20));
                        if (st.simple) p.everySeconds = v; else st.every = v;
                        progChanged(); return v;
                    }, { pxPerStep: 4, label: "Délai en secondes avant chaque hausse de 1 BPM" }));
                    c2.appendChild(progNumber(st.until, st.simple ? 0 : 30, 300, function (n) {
                        var v;
                        if (st.simple) { v = n ? Math.min(300, Math.max(30, n)) : 0; p.limitBpm = v; }
                        else { v = Math.min(300, Math.max(30, n || 100)); st.until = v; }
                        progChanged(); return v;
                    }, st.simple ? { placeholder: "—", emptyStart: Math.min(300, m.bpm + 10), label: "Tempo seuil (BPM)" } : { label: "Tempo seuil du palier (BPM)" }));
                    if (!st.simple) {
                        var del = document.createElement("button");
                        del.type = "button";
                        del.className = "metro-prog-del";
                        del.textContent = "×";
                        del.title = "Supprimer ce palier";
                        del.addEventListener("click", function () {
                            p.stages.splice(i, 1);
                            if (p.stages.length <= 1) { // un seul palier restant = réglage simple
                                if (p.stages[0]) { p.everySeconds = p.stages[0].every; p.limitBpm = p.stages[0].until; }
                                p.stages = []; p.stagesMode = false;
                            }
                            progChanged(); renderProgFields();
                        });
                        c3.appendChild(del);
                    }
                    line.appendChild(c1); line.appendChild(c2); line.appendChild(c3);
                    body.appendChild(line);
                });
                tbl.appendChild(body);
                progSide.appendChild(tbl);
                var foot = document.createElement("div");
                foot.className = "metro-prog-foot";
                var add = document.createElement("button");
                add.type = "button";
                add.className = "metro-mini-btn metro-prog-add";
                add.textContent = "+";
                add.title = "Ajouter un palier (ex. toutes les 10 s jusqu'à 90, puis toutes les 20 s jusqu'à 100)";
                add.setAttribute("aria-label", "Ajouter un palier");
                add.addEventListener("click", function () {
                    if (!p.stagesMode) { // premier palier = le réglage simple actuel
                        p.stagesMode = true;
                        p.stages = [{ inc: 1, every: p.everySeconds, until: p.limitBpm || Math.min(300, m.bpm + 20) }];
                    }
                    var last = p.stages[p.stages.length - 1];
                    p.stages.push({ inc: 1, every: last ? last.every : 20, until: Math.min(300, (last ? last.until : m.bpm) + 10) });
                    progChanged(); renderProgFields();
                });
                foot.appendChild(add);
                // Réglages enregistrés : retrouver d'un clic des paliers souvent utilisés (nommés, renommables).
                var presetsBtn = document.createElement("button");
                presetsBtn.type = "button";
                presetsBtn.className = "metro-mini-btn metro-prog-presets";
                presetsBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h12v17l-6-4-6 4z"/></svg>';
                presetsBtn.title = "Réglages enregistrés";
                presetsBtn.setAttribute("aria-label", "Réglages de tempo progressif enregistrés");
                presetsBtn.addEventListener("click", function () { openProgPresets(presetsBtn); });
                foot.appendChild(presetsBtn);
                progSide.appendChild(foot);
                refreshProgStatus();
            }

            function progSummary(q) {
                if (q.stagesMode) return q.stages.map(function (st) { return st.every + " s → " + st.until; }).join(" · ");
                return q.everySeconds + " s" + (q.limitBpm ? " → " + q.limitBpm : "");
            }
            function applyProgPreset(pr) {
                var p = m.progressive, q = pr.progressive;
                p.enabled = true; p.stagesMode = q.stagesMode; p.everySeconds = q.everySeconds; p.limitBpm = q.limitBpm;
                p.restoreOnStop = q.restoreOnStop; p.stages = cloneJson(q.stages);
                metroProgNextAt = null; metroProgIdx = -1;
                save(); refreshProgToggle(); renderProgFields();
                showToast("« " + pr.name + " » appliqué", 1800);
            }
            function openProgPresets(anchor) {
                openGsPopover(anchor, function (pop, close) {
                    pop.classList.add("metro-presets-pop");
                    function build(renameId) {
                        pop.innerHTML = "";
                        var list = m.progPresets;
                        if (!list.length) { var none = document.createElement("div"); none.className = "gs-empty"; none.textContent = "Aucun réglage enregistré"; pop.appendChild(none); }
                        list.forEach(function (pr, i) {
                            var row = document.createElement("div");
                            row.className = "metro-preset-row";
                            var main = document.createElement("button");
                            main.type = "button"; main.className = "metro-preset-main";
                            var nm = document.createElement("span"); nm.className = "metro-preset-name"; nm.textContent = pr.name;
                            var sm = document.createElement("span"); sm.className = "metro-preset-sum"; sm.textContent = progSummary(pr.progressive);
                            main.appendChild(nm); main.appendChild(sm);
                            main.title = "Appliquer ce réglage";
                            main.addEventListener("click", function () { close(); applyProgPreset(pr); });
                            var ren = iconButton("✎", "Renommer", function () { startRename(); });
                            var del = iconButton("✕", "Supprimer ce réglage", function () { m.progPresets.splice(i, 1); save(); build(); });
                            function startRename() {
                                var inp = document.createElement("input");
                                inp.type = "text"; inp.className = "metro-preset-input"; inp.value = pr.name; inp.maxLength = 40;
                                inp.setAttribute("aria-label", "Nom du réglage");
                                row.replaceChild(inp, main);
                                inp.focus(); inp.select();
                                var done = false;
                                function commit(ok) {
                                    if (done) return; done = true;
                                    var v = inp.value.trim();
                                    if (ok && v && v !== pr.name) { pr.name = v.slice(0, 40); save(); }
                                    build();
                                }
                                inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); commit(true); } else if (e.key === "Escape") { e.stopPropagation(); commit(false); } });
                                inp.addEventListener("blur", function () { commit(true); });
                            }
                            row.appendChild(main); row.appendChild(ren); row.appendChild(del);
                            pop.appendChild(row);
                            if (renameId === pr.id) setTimeout(startRename, 0);
                        });
                        var save1 = document.createElement("button");
                        save1.type = "button"; save1.className = "metro-preset-add";
                        save1.textContent = "+ Enregistrer le réglage actuel";
                        save1.addEventListener("click", function () {
                            var p = m.progressive;
                            var pr = { id: uid(), name: "Paliers " + (m.progPresets.length + 1), progressive: {
                                stagesMode: p.stagesMode && p.stages.length > 0, everySeconds: p.everySeconds, limitBpm: p.limitBpm || 0,
                                restoreOnStop: p.restoreOnStop === true, stages: cloneJson(p.stages || [])
                            } };
                            m.progPresets.push(pr); save(); build(pr.id); // le nom s'édite tout de suite
                        });
                        pop.appendChild(save1);
                    }
                    build();
                });
            }

            function refreshProgToggle() {
                progToggle.classList.toggle("metro-progressive-active", m.progressive.enabled);
                progSide.hidden = !m.progressive.enabled;
                toolsRow.classList.toggle("metro-tools-prog-open", m.progressive.enabled);
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
                dialFlashStart();
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
            metroPanelApi = { toggle: toggleMetroPlayback, setBpm: function (v) { setBpm(v); } };
            panel.appendChild(playBtn);

            function setBpm(v) {
                v = Math.min(300, Math.max(30, v));
                m.bpm = v;
                saveSoon();
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
                window.removeEventListener("pointerup", onPanelPointerUp);
                if (metroLinkRefresh === refreshLinkBar) metroLinkRefresh = null;
                // Fermé pendant l'édition d'un préréglage (sans Enregistrer) : annulation, réglages d'avant rétablis.
                if (metroEdit) { var abandoned = metroEdit; metroEdit = null; applyMetronomePresetToSettings(abandoned.prev); }
                if (chronoInterval) clearInterval(chronoInterval);
                if (flashRaf) { cancelAnimationFrame(flashRaf); flashRaf = null; }
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
            var fretFitObs = null;
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
                // Plus de place que la taille réglée (fenêtre agrandie) : le dessin s'étire à la largeur disponible, proportions gardées.
                var natW = parseFloat(svg.getAttribute("width")), natH = parseFloat(svg.getAttribute("height"));
                if (fretFitObs) { fretFitObs.disconnect(); fretFitObs = null; }
                function stretchToFit() {
                    var avail = scroll.clientWidth - 8, w = Math.min(Math.max(natW, avail), natW * 2.6);
                    if (!(natW > 0 && natH > 0 && avail > 0)) return;
                    svg.style.width = Math.round(w) + "px"; svg.style.height = Math.round(natH * w / natW) + "px";
                }
                stretchToFit();
                if (typeof ResizeObserver !== "undefined") { fretFitObs = new ResizeObserver(stretchToFit); fretFitObs.observe(scroll); }
            }
            update();
            return function () { if (fretFitObs) fretFitObs.disconnect(); };
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
    // ---------- raccourcis et astuces (ampoule des paramètres) ----------
    var IS_APPLE = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
    function openShortcutsPanel() {
        openModal("gs-keys-panel", function (panel, close) {
            var MOD = IS_APPLE ? "⌘" : "Ctrl";
            var head = document.createElement("div"); head.className = "settings-head";
            var back = document.createElement("button"); back.type = "button"; back.className = "btn-ghost keys-back-btn"; back.textContent = "‹ Paramètres"; back.setAttribute("aria-label", "Retour aux paramètres");
            back.addEventListener("click", function () { close(); openSettingsPanel(); });
            var title = document.createElement("div"); title.className = "backups-title"; title.textContent = "Raccourcis et astuces";
            head.appendChild(title); head.appendChild(back);
            panel.appendChild(head);
            var body = document.createElement("div"); body.className = "keys-body"; panel.appendChild(body);
            function group(name, rows) {
                var g = document.createElement("div"); g.className = "keys-group";
                var h = document.createElement("div"); h.className = "keys-group-title"; h.textContent = name; g.appendChild(h);
                rows.forEach(function (r) {
                    var row = document.createElement("div"); row.className = "keys-row";
                    var k = document.createElement("div"); k.className = "keys-keys";
                    r[0].forEach(function (part) {
                        if (part === "+" || part === "|") { var o = document.createElement("span"); o.className = "keys-or"; o.textContent = part === "|" ? "ou" : "+"; k.appendChild(o); return; }
                        var kb = document.createElement("kbd"); kb.textContent = part; k.appendChild(kb);
                    });
                    row.appendChild(k);
                    var d = document.createElement("div"); d.className = "keys-desc"; d.textContent = r[1]; row.appendChild(d);
                    g.appendChild(row);
                });
                body.appendChild(g);
            }
            // [touches, description] ; dans « touches », « + » = combinaison, « | » = ou
            group("Clavier", [
                [["Espace"], "Démarrer / arrêter le métronome. Pendant une session guidée avec le métronome ouvert : appui simple = métronome, double appui rapide = pause / reprise de la session. Sans effet dans un champ de saisie ou sous une fenêtre."],
                [[MOD, "+", "Z"], "Annuler la dernière modification (aussi dans le calendrier)."],
                [[MOD, "+", "Y", "|", MOD, "+", "Maj", "+", "Z"], "Rétablir."],
                [[MOD, "+", "B"], "Masquer / afficher la barre latérale."],
                [[MOD, "+", "Maj", "+", "N"], "Nouveau sous-dossier dans le dossier ouvert."],
                [[MOD, "+", "V"], "Coller une capture d'écran dans l'exercice ouvert (ou celui de la session en cours)."],
                [["Échap"], "Fermer la fenêtre, le menu ou la recherche."],
                [["←", "|", "→"], "Image précédente / suivante dans la visionneuse (clic = suivante, double-clic = plein écran)."]
            ]);
            group("Souris et doigts", [
                [["Clic droit"], "Menus d'actions : exercices, dossiers, chapitres, liens, fichiers, titres de session, jours du calendrier. Sur téléphone : appui long."],
                [["Glisser-déposer"], "Réordonner exercices, dossiers et chapitres ; déposer un exercice sur un dossier, une session sur un onglet (déplacer ou dupliquer, au choix, au lâcher)."],
                [["Glisser", "|", "Molette"], "Sur un nombre (durée, BPM…) : le faire varier ; ou chevrons ‹ › et saisie au clavier."],
                [["Molette"], "Sur le cadran du métronome : ±1 BPM."],
                [["Double-clic"], "Sur un onglet de sessions : le renommer. Sur la barre entre la liste et le contenu : largeur par défaut (← → pour l'ajuster)."],
                [["Maj", "+", "clic ‹ ›"], "Dans la mini-fenêtre de session : ±5 BPM (molette sur le tempo : ±1)."]
            ]);
            group("Calendrier", [
                [["Clic"], "Sur un jour : propose d'y ajouter une session (dossiers + filtres)."],
                [["Clic droit"], "Sur un jour : ajouter, retirer, lancer, copier sur la semaine suivante…"],
                [["Bords de la fenêtre"], "Tirer le bord droit, le bord bas ou le coin pour l'élargir à volonté."]
            ]);
        });
    }

    function openSettingsPanel() {
        openModal("settings-panel", function (panel) {
            var a = state.settings.appearance;

            var head = document.createElement("div");
            head.className = "settings-head";
            var title = document.createElement("div");
            title.className = "backups-title";
            title.textContent = "Paramètres";
            var bulb = document.createElement("button");
            bulb.type = "button"; bulb.className = "settings-bulb-btn btn-ghost"; bulb.title = "Raccourcis et astuces"; bulb.setAttribute("aria-label", "Raccourcis et astuces");
            bulb.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>';
            bulb.addEventListener("click", function () { openShortcutsPanel(); });
            head.appendChild(title); head.appendChild(bulb);
            panel.appendChild(head);

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

            var soundField = selectField("Son", METRO_SOUNDS.map(function (k) { return [k, METRO_SOUND_LABELS[k]]; }), state.settings.metronome.sound, function (v) {
                state.settings.metronome.sound = v; save(); metroPreviewSound(v);
            });
            var soundSel = soundField.querySelector("select");
            var soundPlay = document.createElement("button");
            soundPlay.type = "button"; soundPlay.className = "btn-ghost settings-sound-play"; soundPlay.title = "Écouter ce son"; soundPlay.setAttribute("aria-label", "Écouter ce son");
            soundPlay.innerHTML = METRO_PLAY_ICON_SVG;
            soundPlay.addEventListener("click", function () { metroPreviewSound(soundSel.value); });
            soundField.appendChild(soundPlay);
            cur.appendChild(soundField);

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
            [["Sauvegardes de secours", "backups-btn"], ["Exporter (sauvegarde JSON)", "export-btn"], ["Importer une sauvegarde JSON", "import-btn"]].forEach(function (d) {
                var row = document.createElement("div");
                row.className = "settings-field";
                var btn = document.createElement("button");
                btn.type = "button"; btn.className = "btn-ghost settings-data-btn"; btn.textContent = d[0];
                btn.addEventListener("click", function () { var target = document.getElementById(d[1]); if (target) target.click(); });
                row.appendChild(btn);
                cur.appendChild(row);
            });

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
    var gsPickMulti = null; // choix de plusieurs exercices d'un coup (seulement quand on AJOUTE des exercices à une session)
    var gsRunSession = null, gsRunStepIndex = 0;
    var gsRunAllocatedSec = 0, gsRunElapsedMs = 0, gsRunStartTs = null, gsRunPaused = true, gsRunInterval = null;
    // Chrono de la session entière : cumule tous les exercices, s'arrête en pause et repart à la reprise.
    var gsTotalMs = 0, gsTotalStartTs = null;
    // Enchaînement automatique : à la fin du temps d'un exercice, on passe au suivant ; un petit carillon
    // doux prévient 10 s avant. Réglage propre à l'appareil.
    var GS_AUTO_KEY = "trainhub.gsAuto.v1";
    var GS_WARN_SECONDS = 10;
    var gsWarnKey = null; // "<pas>:warn" / "<pas>:end" : évite de rejouer le même carillon
    // Cloche : un bip à la fin du temps de l'exercice (hors enchaînement automatique, qui a déjà son carillon). Réglage propre à l'appareil.
    var GS_BELL_KEY = "trainhub.gsBell.v1";
    var gsBellKeyDone = null;
    function gsBellOn() { try { return localStorage.getItem(GS_BELL_KEY) === "1"; } catch (e) { return false; } }
    function setGsBell(on) { try { localStorage.setItem(GS_BELL_KEY, on ? "1" : "0"); } catch (e) {} }
    function playEndBeep() { // trois « bip » nets
        try {
            var ctx = ensureMetroAudio(), t0 = ctx.currentTime + 0.03;
            [0, 0.28, 0.56].forEach(function (off) {
                var osc = ctx.createOscillator(), g = ctx.createGain();
                osc.type = "sine"; osc.frequency.value = 988;
                g.gain.setValueAtTime(0.0001, t0 + off);
                g.gain.linearRampToValueAtTime(0.35, t0 + off + 0.01);
                g.gain.exponentialRampToValueAtTime(0.0001, t0 + off + 0.2);
                osc.connect(g); g.connect(ctx.destination);
                osc.start(t0 + off); osc.stop(t0 + off + 0.22);
            });
        } catch (e) {}
    }
    function playEndBeepShort() { try { var ctx = ensureMetroAudio(), o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + 0.02; o.type = "sine"; o.frequency.value = 988; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.25, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15); o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.17); } catch (e) {} }
    function gsBellTick(remaining, step, session) {
        if (!gsBellOn() || gsAutoAdvanceOn() || gsRunPaused || gsRunSession !== session || session.steps[gsRunStepIndex] !== step) return;
        var key = step.id + ":" + gsRunStepIndex;
        if (remaining > 0) { if (gsBellKeyDone === key) gsBellKeyDone = null; return; } // +1 min : la cloche se réarme
        if (gsBellKeyDone === key) return;
        gsBellKeyDone = key;
        playEndBeep();
    }
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
        var mineId = null, mine = null, rows = [];
        Object.keys(gsDrafts).forEach(function (id) { if (gsDrafts[id].draft.steps.indexOf(step) !== -1) mineId = id; });
        state.settings.guidedSessions.forEach(function (gs) { if (gs.steps.indexOf(step) !== -1) mineId = gs.id; });
        state.settings.guidedSessions.forEach(function (gs) { if (gs.id === mineId) mine = gs; });
        state.settings.guidedSessions.forEach(function (gs) {
            if (gs.id === mineId || gs.ephemeral) return; // une durée réglée ici ne se propage pas aux sessions éphémères d'autres jours
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
                rows.forEach(function (r, i) {
                    if (!(boxes[i].checked && !boxes[i].disabled)) return;
                    r.st.minutes = newMin; n++;
                    var de = gsDrafts[r.gs.id];
                    if (de) { var clean = !gsDraftDirty(r.gs.id); de.draft.steps.forEach(function (ds) { if (ds.id === r.st.id) ds.minutes = newMin; }); if (clean) de.base = gsDraftSig(de); }
                });
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
                    // relâché n'importe où (hors du bouton, autre fenêtre…) : la répétition s'arrête toujours
                    var stopOnce = function () { stop(); window.removeEventListener("pointerup", stopOnce, true); window.removeEventListener("pointercancel", stopOnce, true); window.removeEventListener("blur", stopOnce); };
                    window.addEventListener("pointerup", stopOnce, true);
                    window.addEventListener("pointercancel", stopOnce, true);
                    window.addEventListener("blur", stopOnce);
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
    // jsPDF (≈ 115 Ko compressés) n'est chargé qu'au premier export.
    function exportSessionPdf(session) {
        if (window.jspdf && window.jspdf.jsPDF) { exportSessionPdfNow(session); return; }
        loadScriptOnce("jspdf.umd.min.js").then(function () { exportSessionPdfNow(session); }, function () { window.alert("Export PDF indisponible."); });
    }
    function exportSessionPdfNow(session) {
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
                if (found.ex.fixedNotes && found.ex.fixedNotes.trim()) writeLines(found.ex.fixedNotes.trim(), 10, "bold", 5.5);
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
            bindContextGesture(chip, function (x, y) { openFileMenu(x, y, meta, container); });
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
            if (IREAL_SCHEME_RE.test(url)) { openExternalLink(url); return; }
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

    // ---- brouillons de session : les modifications faites dans l'écran d'édition ne sont appliquées à la session
    // qu'au clic sur « Enregistrer » (rien n'est écrit en douce) ----
    var gsDrafts = {}; // id de session -> { draft: copie de travail, base: signature enregistrée, metro: tempos d'exercice en attente }
    function gsDraftSig(e) { return JSON.stringify([e.draft.name, e.draft.tabIds, e.draft.steps, e.metro]); }
    function gsDraftFor(real) {
        var e = gsDrafts[real.id];
        if (!e) {
            e = { draft: cloneJson(real), metro: {} };
            if (!Array.isArray(e.draft.tabIds)) e.draft.tabIds = [];
            e.base = gsDraftSig(e);
            gsDrafts[real.id] = e;
        }
        return e;
    }
    function gsDraftDirty(id) { var e = gsDrafts[id]; return !!e && gsDraftSig(e) !== e.base; }
    function gsAnyDraftDirty() { return Object.keys(gsDrafts).some(gsDraftDirty); }
    function gsCommitDraft(id) {
        var e = gsDrafts[id];
        var real = state.settings.guidedSessions.filter(function (g) { return g.id === id; })[0];
        if (!e || !real) return;
        var d = e.draft;
        d.steps.forEach(function (st) { // « dernière durée réglée » d'un exercice : mémorisée seulement à l'enregistrement
            var orig = real.steps.filter(function (o) { return o.id === st.id; })[0];
            if (!orig || orig.minutes !== st.minutes) gsRememberMinutes(st);
        });
        real.name = d.name;
        real.steps = cloneJson(d.steps);
        real.tabIds = d.tabIds.slice();
        Object.keys(e.metro).forEach(function (exId) { // tempo d'un exercice : propre à l'exercice, donc appliqué ici aussi
            var f = findExerciseById(exId), p2 = e.metro[exId];
            if (f) { f.ex.metronome = p2 ? cloneJson(p2) : null; touchExercise(f.ex); }
        });
        e.metro = {};
        save();
        e.base = gsDraftSig(e);
    }
    // Trois choix quand des modifications ne sont pas enregistrées : enregistrer, les annuler, ou continuer à modifier.
    function gsDraftPrompt(id, opts, onProceed) {
        var real = state.settings.guidedSessions.filter(function (g) { return g.id === id; })[0];
        openModal("gs-leave-panel", function (panel, close) {
            var title = document.createElement("div");
            title.className = "backups-title";
            title.textContent = opts.title || "Enregistrer les modifications ?";
            panel.appendChild(title);
            var msg = document.createElement("div");
            msg.className = "gs-sync-intro";
            msg.textContent = "« " + (gsDrafts[id] ? gsDrafts[id].draft.name : real ? real.name : "") + " » a des modifications non enregistrées.";
            panel.appendChild(msg);
            var actions = document.createElement("div");
            actions.className = "gs-sync-actions gs-leave-actions";
            var stay = document.createElement("button"); stay.type = "button"; stay.className = "btn-ghost gs-leave-stay"; stay.textContent = "Continuer à modifier";
            stay.addEventListener("click", close);
            actions.appendChild(stay);
            if (opts.discard !== false) {
                var disc = document.createElement("button"); disc.type = "button"; disc.className = "btn-ghost gs-leave-discard"; disc.textContent = "Annuler les modifications";
                disc.addEventListener("click", function () { delete gsDrafts[id]; close(); onProceed(); });
                actions.appendChild(disc);
            }
            var yes = document.createElement("button"); yes.type = "button"; yes.className = "btn-accent gs-leave-save"; yes.textContent = opts.saveLabel || "Enregistrer";
            yes.addEventListener("click", function () { gsCommitDraft(id); close(); onProceed(); });
            actions.appendChild(yes);
            panel.appendChild(actions);
        });
    }
    window.addEventListener("beforeunload", function (e) {
        if (gsAnyDraftDirty()) { e.preventDefault(); e.returnValue = ""; return ""; }
    });

    // ---- accès direct depuis n'importe où (calendrier, « À venir », statistiques, menus clic droit) ----
    function gsFindSession(id) { return state.settings.guidedSessions.filter(function (g) { return g.id === id; })[0] || null; }
    function gsRunActive() { return !!(gsRunSession && gsScreen === "run"); }
    // ---- sessions éphémères : « Session du 08-10-2026 », créées depuis le calendrier pour un seul jour ----
    var gsAutoPick = null; // id de la session éphémère qu'on vient de créer : on ouvre tout de suite le choix des exercices
    function gsProtectedIds() { var k = {}; if (gsRunSession) k[gsRunSession.id] = true; if (gsEditingSession) k[gsEditingSession.id] = true; return k; }
    function gsEphemeralDateText(key) { var d = calParse(key), p2 = function (n) { return (n < 10 ? "0" : "") + n; }; return p2(d.getDate()) + "-" + p2(d.getMonth() + 1) + "-" + d.getFullYear(); }
    function gsEphemeralName(key) {
        var n = state.settings.guidedSessions.filter(function (g) { return g.ephemeral && g.date === key; }).length;
        return "Session éphémère" + (n ? " (" + (n + 1) + ")" : "");
    }
    function gsNewEphemeralObject(key, steps) {
        return { id: uid(), name: gsEphemeralName(key), steps: steps || [], instrumentId: state.activeInstrumentId, tabIds: [], createdAt: Date.now(), ephemeral: true, date: key };
    }
    // Crée la session éphémère ET sa séance au planning (une seule entrée d'historique : « Annuler » défait les deux).
    function gsCreateEphemeral(key) {
        var s = gsNewEphemeralObject(key);
        state.settings.guidedSessions.push(s);
        state.settings.sessionPlan.push({ id: uid(), date: key, sessionId: s.id, instrumentId: state.activeInstrumentId });
        save();
        return s;
    }
    // Depuis le calendrier : nouvelle session pour ce jour, puis choix des exercices un à un.
    function gsStartEphemeral(key) {
        if (key < calTodayKey()) { showToast("Impossible de programmer dans le passé"); return null; }
        if (gsRunActive()) { showToast("Une session est en cours : termine-la avant d'en préparer une autre.", 4500); return null; }
        var s = gsCreateEphemeral(key);
        gsAutoPick = s.id;
        gsOpenSessionEditor(s);
        return s;
    }
    // Retire une session éphémère et sa séance au planning (sans corbeille : elle n'existe que pour ce jour-là ; « Annuler » la rend).
    function gsDropEphemeral(session) {
        state.settings.sessionPlan = state.settings.sessionPlan.filter(function (pe) { return pe.sessionId !== session.id; });
        delete gsDrafts[session.id];
        var arr = state.settings.guidedSessions, k = arr.indexOf(session);
        if (k !== -1) arr.splice(k, 1);
        save();
    }
    // Copie d'une éphémère vers un autre jour : une NOUVELLE session éphémère (nom daté du nouveau jour), mêmes exercices.
    function gsCloneEphemeralTo(session, key) {
        var steps = cloneJson(session.steps); steps.forEach(function (st) { st.id = uid(); });
        var c = gsNewEphemeralObject(key, steps);
        state.settings.guidedSessions.push(c);
        return c;
    }
    // Enregistrer une éphémère parmi les sessions ordinaires : on demande le nom et le(s) dossier(s) (onglets) où la ranger.
    function gsKeepEphemeral(session, after) {
        closeFolderMenu();
        var tabs = state.settings.sessionFolders.filter(function (f) { return f.instrumentId === session.instrumentId; });
        var chosen = {};
        var backdrop = document.createElement("div"); backdrop.className = "ctx-backdrop";
        var pop = document.createElement("div"); pop.className = "ctx-menu gs-pop gs-keep-pop"; pop.setAttribute("role", "dialog");
        if (closeActiveModal) { backdrop.classList.add("ctx-over-modal"); pop.classList.add("ctx-over-modal"); }
        function close() { closeFolderMenu(); }
        backdrop.addEventListener("pointerdown", function (e) { e.preventDefault(); close(); });
        backdrop.addEventListener("contextmenu", function (e) { e.preventDefault(); close(); });
        var t = document.createElement("div"); t.className = "ctx-menu-title ctx-menu-title-wrap"; t.textContent = "Enregistrer dans mes sessions"; pop.appendChild(t);
        var inp = document.createElement("input"); inp.type = "text"; inp.className = "ctx-input gs-keep-name"; inp.setAttribute("aria-label", "Nom de la session");
        inp.value = session.date ? "Session du " + gsEphemeralDateText(session.date) : "Ma session"; pop.appendChild(inp);
        if (tabs.length) {
            var row = document.createElement("div"); row.className = "gs-keep-tabs";
            tabs.forEach(function (tb) {
                var b = document.createElement("button"); b.type = "button"; b.className = "gs-tabpick-chip"; b.textContent = tb.name; b.setAttribute("aria-pressed", "false");
                b.addEventListener("click", function () { chosen[tb.id] = !chosen[tb.id]; b.classList.toggle("active", chosen[tb.id]); b.setAttribute("aria-pressed", chosen[tb.id] ? "true" : "false"); });
                row.appendChild(b);
            });
            pop.appendChild(row);
        }
        var acts = document.createElement("div"); acts.className = "ctx-actions";
        var no = document.createElement("button"); no.type = "button"; no.className = "ctx-item ctx-secondary"; no.textContent = "Annuler"; no.addEventListener("click", close);
        var ok = document.createElement("button"); ok.type = "button"; ok.className = "ctx-item ctx-primary gs-keep-ok"; ok.textContent = "Enregistrer";
        function commit() {
            var n = inp.value.trim();
            if (!n) { inp.focus(); return; }
            close();
            session.ephemeral = false; delete session.date; session.name = n;
            session.tabIds = tabs.filter(function (tb) { return chosen[tb.id]; }).map(function (tb) { return tb.id; });
            var de = gsDrafts[session.id];
            if (de) { var clean = !gsDraftDirty(session.id); de.draft.name = session.name; de.draft.tabIds = session.tabIds.slice(); delete de.draft.ephemeral; delete de.draft.date; if (clean) de.base = gsDraftSig(de); }
            save(); render();
            if (after) after();
            showToast("« " + session.name + " » enregistrée dans tes sessions");
        }
        ok.addEventListener("click", commit);
        inp.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") commit(); if (e.key === "Escape") close(); });
        acts.appendChild(no); acts.appendChild(ok); pop.appendChild(acts);
        function onKey(e) { if (e.key === "Escape") close(); }
        document.body.appendChild(backdrop); document.body.appendChild(pop);
        document.addEventListener("keydown", onKey, true);
        openMenu = { backdrop: backdrop, menu: pop, onKey: onKey };
        pop.style.left = Math.max(8, (window.innerWidth - pop.offsetWidth) / 2) + "px";
        pop.style.top = Math.max(8, (window.innerHeight - pop.offsetHeight) / 3) + "px";
        setTimeout(function () { try { inp.focus(); inp.select(); } catch (e) {} }, 20);
        return true;
    }
    function gsIsEphemeralId(id) { var g = gsFindSession(id); return !!(g && g.ephemeral); }
    function gsIsEphemeralRec(rec) { return !!(rec && (rec.ephemeral || gsIsEphemeralId(rec.sessionId))); } // la séance enregistrée garde le repère après la disparition de la session
    function gsNameActionLabel(sess, nm) { return sess && sess.ephemeral ? "Enregistrer dans mes sessions…" : "Renommer « " + nm + " »…"; }
    // Ouvre l'écran d'édition d'une session (ses exercices) en fermant la fenêtre d'où l'on vient.
    function gsOpenSessionEditor(session) {
        if (!session) { showToast("Cette session n'existe plus (voir la corbeille)"); return false; }
        if (gsRunActive()) { showToast("Une session est en cours : termine-la avant d'en modifier une.", 4500); return false; }
        function go() {
            if (closeActiveModal) closeActiveModal();
            closeFolderMenu();
            if (session.instrumentId && session.instrumentId !== state.activeInstrumentId && findById(state.instruments, session.instrumentId)) { state.activeInstrumentId = session.instrumentId; persist(); }
            guidedSessionViewActive = true;
            if ($guidedSessionBtn) $guidedSessionBtn.classList.add("active");
            gsEditingSession = session;
            gsScreen = "edit";
            render();
            try { window.scrollTo(0, 0); } catch (e) {}
        }
        var cur = guidedSessionViewActive && (gsScreen === "edit" || gsScreen === "pick") ? gsEditingSession : null;
        if (cur && cur.id !== session.id && gsDraftDirty(cur.id)) { gsDraftPrompt(cur.id, {}, go); return true; }
        go();
        return true;
    }
    // Renomme une session (et son brouillon s'il n'a pas été renommé à part). Le calendrier, « À venir »,
    // l'historique et les statistiques affichent tous le nom actuel.
    function gsRenameSession(session, after) {
        if (!session) return false;
        if (session.ephemeral) return gsKeepEphemeral(session, after); // lui donner un nom = la garder
        var n = window.prompt("Nouveau nom de la session :", session.name);
        if (n === null || !n.trim() || n.trim() === session.name) return false;
        var old = session.name;
        var de = gsDrafts[session.id], clean = de ? !gsDraftDirty(session.id) : true;
        session.name = n.trim();
        if (de) { if (de.draft.name === old) de.draft.name = session.name; if (clean) de.base = gsDraftSig(de); }
        save();
        render();
        if (after) after();
        showToast("Session renommée : « " + session.name + " »");
        return true;
    }
    // Nom à afficher pour une séance enregistrée : celui d'aujourd'hui si la session existe encore, sinon celui
    // d'alors (figé dans le journal). `frozen` : le nom d'alors, s'il diffère.
    function logRecName(rec) {
        var g = rec && rec.sessionId ? gsFindSession(rec.sessionId) : null;
        return g ? g.name : (rec && rec.name) || "(session)";
    }
    function logRecOldName(rec) {
        var cur = logRecName(rec);
        return rec && rec.name && rec.name !== cur ? rec.name : null;
    }
    // Titre à afficher pour un exercice d'une séance enregistrée : titre actuel s'il existe encore.
    function logStepTitle(st) {
        var f = st && st.exerciseId ? findExerciseById(st.exerciseId) : null;
        return f ? f.ex.title : (st && st.title) || "(exercice)";
    }
    // Sessions (et pas) qui utilisent un exercice — brouillons non enregistrés compris.
    function exerciseUsage(exIds) {
        var set = {}, out = { sessions: [], steps: 0, planned: 0 };
        (Array.isArray(exIds) ? exIds : [exIds]).forEach(function (id) { set[id] = true; });
        var today = calTodayKey();
        state.settings.guidedSessions.forEach(function (g) {
            var de = gsDrafts[g.id], steps = de ? de.draft.steps : g.steps;
            var n = steps.filter(function (st) { return set[st.exerciseId]; }).length;
            if (!n) return;
            out.sessions.push(g); out.steps += n;
            out.planned += state.settings.sessionPlan.filter(function (pe) { return pe.sessionId === g.id && pe.date >= today; }).length;
        });
        return out;
    }
    function exerciseUsageText(u) {
        if (!u.sessions.length) return "";
        var names = u.sessions.slice(0, 4).map(function (g) { return "« " + g.name + " »"; }).join(", ") + (u.sessions.length > 4 ? "…" : "");
        return "Utilisé dans " + u.sessions.length + " session" + (u.sessions.length > 1 ? "s" : "") + " : " + names + (u.planned ? " (dont " + u.planned + " séance" + (u.planned > 1 ? "s" : "") + " au calendrier)" : "") + ".";
    }
    function folderExerciseIds(folder) {
        var ids = [];
        (function walk(f) { (f.exercises || []).forEach(function (e) { ids.push(e.id); }); (f.folders || []).forEach(walk); })(folder);
        return ids;
    }

    // Ensemble des identifiants d'exercices qui existent (tous espaces) : pour repérer d'un coup les pas « supprimés ».
    function exerciseIdSet() {
        var set = {};
        state.instruments.forEach(function (inst) { collectExercises(inst, function (ex) { set[ex.id] = true; return false; }); });
        return set;
    }

    // Fenêtre de choix d'un exercice (recherche + arborescence) : sert à « Remplacer partout par… ».
    function openExercisePickerModal(titleText, opts, onPick) {
        opts = opts || {};
        var inst = opts.inst || getActiveInstrument(), exclude = opts.exclude || [];
        openModal("exercise-picker-panel", function (panel, close) {
            var title = document.createElement("div");
            title.className = "backups-title";
            title.textContent = titleText;
            panel.appendChild(title);
            var search = document.createElement("input");
            search.type = "search"; search.className = "gs-pick-search"; search.placeholder = "Rechercher un exercice…"; search.setAttribute("aria-label", "Rechercher un exercice");
            panel.appendChild(search);
            var wrap = document.createElement("div");
            wrap.className = "folder-picker-tree";
            panel.appendChild(wrap);
            function choose(ex) { close(); onPick(ex); }
            function exButton(ex, pathNames, color) {
                var b = document.createElement("button");
                b.type = "button"; b.className = "gs-pick-exercise-row"; b.dataset.exId = ex.id;
                if (pathNames) { b.appendChild(gsThemeBadge(pathNames, color)); }
                var t = document.createElement("span"); t.className = "gs-pick-ex-title"; t.textContent = ex.title; b.appendChild(t);
                var prev = gsNotePreview(ex); if (prev) b.appendChild(prev);
                b.addEventListener("click", function () { choose(ex); });
                return b;
            }
            function node(container, folders, depth, rootColor) {
                folders.forEach(function (folder) {
                    var color = depth === 0 ? folder.color : rootColor;
                    var exs = folder.exercises.filter(function (ex) { return !ex.archived && exclude.indexOf(ex.id) === -1; });
                    var open = treeExpanded["xpick:" + folder.id] !== false, hasContent = exs.length > 0 || folder.folders.length > 0;
                    var n = document.createElement("div"); n.className = "gs-pick-node";
                    var row = document.createElement("div"); row.className = "gs-pick-tree-row";
                    if (depth === 0) { row.style.borderLeft = "3px solid " + color; row.style.background = "color-mix(in srgb, " + color + " 6%, transparent)"; }
                    var tw = document.createElement("button"); tw.type = "button"; tw.className = "tree-twisty" + (hasContent ? "" : " tree-twisty-empty") + (open ? " expanded" : ""); tw.innerHTML = CHEVRON_ICON_SVG;
                    var lb = document.createElement("span"); lb.className = "tree-label"; lb.textContent = folder.name;
                    row.appendChild(tw); row.appendChild(lb);
                    if (hasContent) row.addEventListener("click", function () { treeExpanded["xpick:" + folder.id] = !open; refresh(); });
                    n.appendChild(row);
                    if (open && hasContent) {
                        var kids = document.createElement("div"); kids.className = "gs-pick-tree-children";
                        exs.forEach(function (ex) { kids.appendChild(exButton(ex)); });
                        node(kids, folder.folders, depth + 1, color);
                        n.appendChild(kids);
                    }
                    container.appendChild(n);
                });
            }
            function refresh() {
                wrap.innerHTML = "";
                var q = search.value.trim().toLowerCase();
                if (!q) { node(wrap, inst.categories, 0, null); return; }
                var res = collectExercises(inst, function (ex) { return !ex.archived && exclude.indexOf(ex.id) === -1 && ex.title.toLowerCase().indexOf(q) !== -1; });
                if (!res.length) { var none = document.createElement("div"); none.className = "gs-empty"; none.textContent = "Aucun exercice ne correspond."; wrap.appendChild(none); return; }
                res.forEach(function (r) { var root = findById(inst.categories, r.pathIds[0]); wrap.appendChild(exButton(r.ex, r.pathNames, (root && root.color) || "#00e676")); });
            }
            search.addEventListener("input", refresh);
            refresh();
            setTimeout(function () { try { search.focus(); } catch (e) {} }, 30);
        });
    }

    // Remplace un exercice par un autre dans TOUTES les sessions (brouillons ouverts compris). Chaque pas garde sa
    // durée, sa note et son éventuel tempo propre ; les liens masqués (propres à l'ancien exercice) sont oubliés.
    // opts.regroup : l'historique des séances de l'ancien exercice est compté sous le nouveau (statistiques) ;
    // opts.trashOld : l'ancien exercice part à la corbeille.
    function replaceExerciseEverywhere(oldId, newEx, opts) {
        opts = opts || {};
        var res = { sessions: 0, steps: 0, dup: [] };
        function swap(st) { if (st.exerciseId === oldId) { st.exerciseId = newEx.id; delete st.hidden; } }
        state.settings.guidedSessions.forEach(function (g) {
            var de = gsDrafts[g.id], clean = de ? !gsDraftDirty(g.id) : true, view = de ? de.draft.steps : g.steps;
            var hit = view.filter(function (st) { return st.exerciseId === oldId; }).length;
            if (!hit) return;
            if (view.some(function (st) { return st.exerciseId === newEx.id; })) res.dup.push(g.name);
            res.sessions++; res.steps += hit;
            g.steps.forEach(swap);
            if (de) { de.draft.steps.forEach(swap); delete de.metro[oldId]; if (clean) de.base = gsDraftSig(de); }
        });
        if (opts.regroup) {
            var rules = statsRules(), cur = newEx.id, prev = null, guard = 0;
            while (cur && cur !== oldId && guard++ < 10) { prev = cur; cur = rules.alias[cur]; }
            if (cur === oldId && prev) delete rules.alias[prev]; // le nouvel exercice était regroupé sous l'ancien : on inverse
            Object.keys(rules.alias).forEach(function (k) { if (rules.alias[k] === oldId) rules.alias[k] = newEx.id; });
            rules.alias[oldId] = newEx.id;
        }
        var old = findExerciseById(oldId);
        if (opts.trashOld && old) {
            addToTrash("exercise", old.ex, { instrumentId: old.inst.id, parentFolderId: old.folder.id });
            old.folder.exercises.splice(old.folder.exercises.indexOf(old.ex), 1);
        }
        save();
        render();
        toastUndo("« " + (opts.oldTitle || "exercice") + " » remplacé par « " + newEx.title + " » dans " + res.sessions + " session" + (res.sessions > 1 ? "s" : "") + (res.sessions ? " (" + res.steps + " pas)" : "") + (res.dup.length ? " — attention, présent deux fois dans " + res.dup.length + " session" + (res.dup.length > 1 ? "s" : "") : ""));
        return res;
    }

    function openReplaceEverywhereDialog(oldId, oldTitle, newEx) {
        var old = findExerciseById(oldId), u = exerciseUsage(oldId);
        openModal("gs-replace-panel", function (panel, close) {
            var title = document.createElement("div");
            title.className = "backups-title";
            title.textContent = "Remplacer partout";
            panel.appendChild(title);
            var intro = document.createElement("div");
            intro.className = "gs-sync-intro";
            var nf = findExerciseById(newEx.id);
            intro.textContent = "« " + oldTitle + " »" + (old ? " (" + old.pathNames.join(" › ") + ")" : " (supprimé)") + "  →  « " + newEx.title + " »" + (nf ? " (" + nf.pathNames.join(" › ") + ")" : "");
            panel.appendChild(intro);
            var list = document.createElement("div");
            list.className = "gs-sync-list";
            if (!u.sessions.length) { var none = document.createElement("div"); none.className = "gs-empty"; none.textContent = "Aucune session ne l'utilise pour l'instant."; list.appendChild(none); }
            u.sessions.forEach(function (g) {
                var de = gsDrafts[g.id], view = de ? de.draft.steps : g.steps;
                var n = view.filter(function (st) { return st.exerciseId === oldId; }).length, dup = view.some(function (st) { return st.exerciseId === newEx.id; });
                var line = document.createElement("div"); line.className = "gs-sync-row";
                var nm = document.createElement("span"); nm.className = "gs-sync-name"; nm.textContent = g.name;
                var du = document.createElement("span"); du.className = "gs-sync-dur"; du.textContent = n + " pas" + (dup ? " · ⚠ contient déjà le nouveau" : "");
                line.appendChild(nm); line.appendChild(du); list.appendChild(line);
            });
            panel.appendChild(list);
            function check(text, on) {
                var l = document.createElement("label"); l.className = "gs-replace-check";
                var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = on;
                var sp = document.createElement("span"); sp.textContent = text;
                l.appendChild(cb); l.appendChild(sp); panel.appendChild(l);
                return cb;
            }
            var regroup = check("Compter aussi les séances passées de l'ancien exercice sous le nouveau (statistiques)", true);
            var trash = old ? check("Mettre « " + oldTitle + " » à la corbeille ensuite", false) : null;
            var actions = document.createElement("div");
            actions.className = "gs-sync-actions";
            var no = document.createElement("button"); no.type = "button"; no.className = "btn-ghost"; no.textContent = "Annuler";
            no.addEventListener("click", close);
            var yes = document.createElement("button"); yes.type = "button"; yes.className = "btn-accent gs-replace-go"; yes.textContent = "Remplacer partout";
            yes.addEventListener("click", function () {
                close();
                replaceExerciseEverywhere(oldId, newEx, { regroup: regroup.checked, trashOld: !!(trash && trash.checked), oldTitle: oldTitle });
            });
            actions.appendChild(no); actions.appendChild(yes);
            panel.appendChild(actions);
        });
    }
    function startReplaceEverywhere(oldId, oldTitle) {
        var old = findExerciseById(oldId);
        openExercisePickerModal("Remplacer « " + oldTitle + " » partout par…", { inst: old ? old.inst : getActiveInstrument(), exclude: [oldId] }, function (newEx) { openReplaceEverywhereDialog(oldId, oldTitle, newEx); });
    }

    // Quitte la vue « session guidée » pour aller dans les dossiers ; renvoie le nom d'une session dont les
    // modifications ne sont pas enregistrées (elles restent en attente), ou null.
    function leaveGuidedViewForNav() {
        var kept = guidedSessionViewActive && gsEditingSession && gsDraftDirty(gsEditingSession.id) ? gsDrafts[gsEditingSession.id].draft.name : null;
        if (guidedSessionViewActive) {
            guidedSessionViewActive = false;
            if ($guidedSessionBtn) $guidedSessionBtn.classList.remove("active");
            if (gsRunInterval) { clearInterval(gsRunInterval); gsRunInterval = null; }
        }
        return kept;
    }
    // Va dans un dossier (déplié, chemin affiché) depuis n'importe où.
    function revealFolder(instId, pathIds) {
        var inst = findById(state.instruments, instId);
        if (!inst) return false;
        if (gsRunActive() && guidedSessionViewActive) { showToast("Une session est en cours : termine-la avant d'aller dans les dossiers.", 4500); return false; }
        if (closeActiveModal) closeActiveModal();
        closeFolderMenu();
        var keptDraft = leaveGuidedViewForNav();
        if (inst.id !== state.activeInstrumentId) { state.activeInstrumentId = inst.id; persist(); }
        clearFilters();
        setNavPath(inst, pathIds.slice());
        pathIds.forEach(function (id) { treeExpanded[id] = true; });
        render();
        try { window.scrollTo(0, 0); } catch (e) {}
        if (keptDraft) showToast("« " + keptDraft + " » n'est pas encore enregistrée : tes modifications t'attendent (bouton Session guidée).", 6000);
        return true;
    }
    // Lance une session depuis n'importe où (recherche rapide…).
    function gsLaunch(session) {
        if (!session || !session.steps.length) { showToast("Cette session n'a pas encore d'exercice"); return false; }
        if (gsRunActive()) { showToast("Une session est déjà en cours.", 4000); return false; }
        if (closeActiveModal) closeActiveModal();
        closeFolderMenu();
        if (session.instrumentId && session.instrumentId !== state.activeInstrumentId && findById(state.instruments, session.instrumentId)) { state.activeInstrumentId = session.instrumentId; persist(); }
        guidedSessionViewActive = true;
        if ($guidedSessionBtn) $guidedSessionBtn.classList.add("active");
        gsStartRun(session);
        return true;
    }

    // ---------- recherche rapide (Ctrl+F) : exercices, sessions et dossiers de tous les espaces ----------
    // Normalisation qui GARDE la longueur du texte (une lettre accentuée devient sa lettre de base, en minuscule) :
    // les positions trouvées servent à surligner le texte d'origine.
    function qfNorm(t) {
        return String(t || "").replace(/[A-ZÀ-ɏ]/g, function (ch) { return ch.normalize("NFD").charAt(0).toLowerCase(); });
    }
    var qfCache = typeof WeakMap === "function" ? new WeakMap() : null;
    function qfExtra(ex) { // liens, fichiers et notes, normalisés une fois (recalculés si l'exercice change)
        var key = (ex.updatedAt || 0) + ":" + (ex.notes || "").length + ":" + (ex.fixedNotes || "").length + ":" + (ex.links || []).length + ":" + (ex.files || []).length;
        var c = qfCache && qfCache.get(ex);
        if (c && c.key === key) return c.text;
        var text = qfNorm([ex.notes || "", ex.fixedNotes || ""].concat((ex.links || []).map(function (l) { return l.label || ""; }), (ex.files || []).map(function (f) { return f.name || ""; })).join(" \n "));
        if (qfCache) qfCache.set(ex, { key: key, text: text });
        return text;
    }
    // Score (plus petit = meilleur) ; -1 si un des mots n'est trouvé nulle part.
    function qfScore(tokens, title, path, extra) {
        var score = 0;
        for (var i = 0; i < tokens.length; i++) {
            var t = tokens[i], pos = title.indexOf(t);
            if (pos === 0) score += 0;
            else if (pos > 0 && /[\s\-'’(\/]/.test(title.charAt(pos - 1))) score += 1;
            else if (pos > 0) score += 2;
            else if (path.indexOf(t) !== -1) score += 4;
            else if (extra && extra.indexOf(t) !== -1) score += 6;
            else return -1;
        }
        return score + (title === tokens.join(" ") ? 0 : 1); // titre exactement égal à la recherche : en tête (jamais négatif : -1 = « pas trouvé »)
    }
    function qfSearch(q) {
        var tokens = qfNorm(q).split(/\s+/).filter(Boolean), out = { exercises: [], sessions: [], folders: [], recent: false };
        if (!tokens.length) {
            out.recent = true;
            var all = [];
            state.instruments.forEach(function (inst) {
                (function walk(list, names, ids) { list.forEach(function (f) { var nn = names.concat(f.name), ii = ids.concat(f.id); f.exercises.forEach(function (ex) { if (!ex.archived && ex.updatedAt) all.push({ type: "exercise", ex: ex, folder: f, inst: inst, names: nn, ids: ii, score: -ex.updatedAt }); }); walk(f.folders, nn, ii); }); })(inst.categories, [], []);
            });
            out.exercises = all.sort(function (a, b) { return a.score - b.score; }).slice(0, 6);
            out.sessions = state.settings.guidedSessions.filter(function (g) { return !g.archived && !g.ephemeral && g.lastRunAt; }).sort(function (a, b) { return b.lastRunAt - a.lastRunAt; }).slice(0, 4).map(function (g) { return { type: "session", g: g, score: 0 }; });
            return out;
        }
        state.instruments.forEach(function (inst) {
            (function walk(list, names, ids) {
                list.forEach(function (f) {
                    var nn = names.concat(f.name), ii = ids.concat(f.id), pathStr = qfNorm(nn.join(" "));
                    var fs = qfScore(tokens, qfNorm(f.name), qfNorm(names.join(" ")), "");
                    if (fs >= 0) out.folders.push({ type: "folder", folder: f, inst: inst, names: nn, ids: ii, score: fs });
                    f.exercises.forEach(function (ex) {
                        var sc = qfScore(tokens, qfNorm(ex.title), pathStr, qfExtra(ex));
                        if (sc >= 0) out.exercises.push({ type: "exercise", ex: ex, folder: f, inst: inst, names: nn, ids: ii, score: sc + (ex.archived ? 3 : 0) });
                    });
                    walk(f.folders, nn, ii);
                });
            })(inst.categories, [], []);
        });
        state.settings.guidedSessions.forEach(function (g) {
            if (g.ephemeral) return;
            var sc = qfScore(tokens, qfNorm(g.name), "", "");
            if (sc >= 0) out.sessions.push({ type: "session", g: g, score: sc + (g.archived ? 3 : 0) });
        });
        function byScore(a, b) { return a.score - b.score; }
        out.exercises.sort(byScore); out.sessions.sort(byScore); out.folders.sort(byScore);
        out.tokens = tokens;
        return out;
    }
    // Écrit `text` dans `el` en surlignant les mots cherchés.
    function qfFill(el, text, tokens) {
        el.textContent = "";
        if (!tokens || !tokens.length) { el.textContent = text; return; }
        var norm = qfNorm(text), marks = [];
        tokens.forEach(function (t) { var from = 0, i; while ((i = norm.indexOf(t, from)) !== -1) { marks.push([i, i + t.length]); from = i + t.length; } });
        marks.sort(function (a, b) { return a[0] - b[0]; });
        var merged = [];
        marks.forEach(function (m) { var last = merged[merged.length - 1]; if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]); else merged.push(m.slice()); });
        var pos = 0;
        merged.forEach(function (m) {
            if (m[0] > pos) el.appendChild(document.createTextNode(text.slice(pos, m[0])));
            var mk = document.createElement("mark"); mk.textContent = text.slice(m[0], m[1]); el.appendChild(mk);
            pos = m[1];
        });
        if (pos < text.length) el.appendChild(document.createTextNode(text.slice(pos)));
    }
    var QF_LIMITS = { exercises: 10, sessions: 6, folders: 6 };
    function openQuickFind(initial) {
        openModal("quickfind-panel", function (panel, close) {
            var input = document.createElement("input");
            input.type = "text"; input.className = "quickfind-input";
            input.placeholder = "Chercher un exercice, une session, un dossier…";
            input.setAttribute("aria-label", "Recherche rapide"); input.setAttribute("autocomplete", "off"); input.spellcheck = false;
            panel.appendChild(input);
            var list = document.createElement("div");
            list.className = "quickfind-list"; list.setAttribute("role", "listbox");
            panel.appendChild(list);
            var flat = [], active = 0;
            function setActive(i, scroll) {
                if (!flat.length) { active = 0; return; }
                active = (i + flat.length) % flat.length;
                flat.forEach(function (it, k) { it.el.classList.toggle("active", k === active); it.el.setAttribute("aria-selected", k === active ? "true" : "false"); });
                if (scroll) { try { flat[active].el.scrollIntoView({ block: "nearest" }); } catch (e) {} }
            }
            function activate(it) {
                if (!it) return;
                if (it.type === "exercise") revealExercise(it.ex.id);
                else if (it.type === "session") gsOpenSessionEditor(it.g);
                else revealFolder(it.inst.id, it.ids);
            }
            function section(title) { var h = document.createElement("div"); h.className = "quickfind-section"; h.textContent = title; list.appendChild(h); }
            function row(it, tokens) {
                var el = document.createElement("div");
                el.className = "quickfind-row quickfind-" + it.type; el.setAttribute("role", "option"); el.dataset.kind = it.type;
                var main = document.createElement("div"); main.className = "quickfind-main";
                var t = document.createElement("span"); t.className = "quickfind-title";
                var sub = document.createElement("span"); sub.className = "quickfind-sub";
                var multi = state.instruments.length > 1;
                if (it.type === "exercise") {
                    var root = findById(it.inst.categories, it.ids[0]);
                    el.style.setProperty("--qf-color", (root && root.color) || "#00e676");
                    qfFill(t, it.ex.title, tokens);
                    sub.textContent = (multi && it.inst.id !== state.activeInstrumentId ? it.inst.name + " · " : "") + it.names.join(" › ") + (it.ex.archived ? " · archivé" : "") + (it.ex.favorite ? " · ★" : "");
                } else if (it.type === "session") {
                    el.style.setProperty("--qf-color", "#4dabf7");
                    qfFill(t, it.g.name, tokens);
                    var inst = findById(state.instruments, it.g.instrumentId);
                    sub.textContent = "Session · " + it.g.steps.length + " exercice" + (it.g.steps.length > 1 ? "s" : "") + " · " + sessionTotalMinutes(it.g) + " min" + (multi && inst && inst.id !== state.activeInstrumentId ? " · " + inst.name : "") + (it.g.archived ? " · archivée" : "");
                } else {
                    var rootF = findById(it.inst.categories, it.ids[0]);
                    el.style.setProperty("--qf-color", (rootF && rootF.color) || "#00e676");
                    qfFill(t, it.folder.name, tokens);
                    var n = folderExerciseIds(it.folder).length;
                    sub.textContent = "Dossier · " + (it.names.length > 1 ? it.names.slice(0, -1).join(" › ") + " · " : "") + n + " exercice" + (n > 1 ? "s" : "") + (multi && it.inst.id !== state.activeInstrumentId ? " · " + it.inst.name : "");
                }
                main.appendChild(t); main.appendChild(sub); el.appendChild(main);
                if (it.type === "session" && it.g.steps.length) {
                    var go = svgIconButton(METRO_PLAY_ICON_SVG, "Lancer cette session maintenant", function (e) { e.stopPropagation(); gsLaunch(it.g); });
                    go.classList.add("quickfind-go"); el.appendChild(go);
                }
                el.addEventListener("click", function () { activate(it); });
                el.addEventListener("mousemove", function () { var k = flat.indexOf(it); if (k !== -1 && k !== active) setActive(k, false); });
                if (it.type === "exercise") bindContextGesture(el, function (x, y) { openExerciseMenu(x, y, it.ex, it.folder, { reveal: true, after: refresh }); });
                else if (it.type === "session") bindContextGesture(el, function (x, y) {
                    var its = [{ label: "✎ Modifier les exercices", open: function () { gsOpenSessionEditor(it.g); } }, { label: "Renommer…", open: function () { gsRenameSession(it.g, refresh); } }];
                    if (it.g.steps.length) its.unshift({ label: "▶ Lancer maintenant", open: function () { gsLaunch(it.g); } });
                    openLinksQuickMenu(x, y, its);
                });
                else bindContextGesture(el, function (x, y) { openFolderMenu(x, y, function () { return parentArrayOf(it.inst, it.folder) || []; }, it.folder, it.inst); });
                it.el = el;
                flat.push(it);
                list.appendChild(el);
            }
            function refresh() {
                var q = input.value, res = qfSearch(q), tokens = res.tokens || [];
                list.innerHTML = ""; flat = [];
                var shown = 0;
                [["exercises", res.recent ? "Modifiés récemment" : "Exercices"], ["sessions", res.recent ? "Sessions lancées récemment" : "Sessions"], ["folders", "Dossiers"]].forEach(function (c) {
                    var items = res[c[0]];
                    if (!items.length) return;
                    section(c[1] + (!res.recent && items.length > QF_LIMITS[c[0]] ? " (" + items.length + ")" : ""));
                    items.slice(0, QF_LIMITS[c[0]]).forEach(function (it) { row(it, tokens); shown++; });
                    if (!res.recent && items.length > QF_LIMITS[c[0]]) { var more = document.createElement("div"); more.className = "quickfind-more"; more.textContent = "… " + (items.length - QF_LIMITS[c[0]]) + " autres : précise ta recherche"; list.appendChild(more); }
                });
                if (!shown) { var none = document.createElement("div"); none.className = "gs-empty quickfind-none"; none.textContent = q.trim() ? "Aucun résultat pour « " + q.trim() + " »." : "Rien à proposer pour l'instant : tape un nom."; list.appendChild(none); }
                setActive(0, false);
            }
            input.addEventListener("input", refresh);
            input.addEventListener("keydown", function (e) {
                if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1, true); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1, true); }
                else if (e.key === "Enter") { e.preventDefault(); if (e.ctrlKey || e.metaKey) { var it = flat[active]; if (it && it.type === "session") { gsLaunch(it.g); return; } } activate(flat[active]); }
            });
            if (initial) input.value = initial;
            refresh();
            setTimeout(function () { try { input.focus(); input.select(); } catch (e) {} }, 30);
        });
    }
    document.addEventListener("keydown", function (e) {
        if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "f") return;
        e.preventDefault(); // remplace la recherche du navigateur par la recherche rapide de TrainHub
        if (activeModalKind === "quickfind-panel") { var i = document.querySelector(".quickfind-input"); if (i) { i.focus(); i.select(); } return; }
        var sel = ""; try { sel = String(window.getSelection() || "").trim(); } catch (err) {}
        openQuickFind(sel && sel.length <= 60 && sel.indexOf("\n") === -1 ? sel : "");
    }, true);

    // Montre un exercice dans son dossier (quitte la session guidée si besoin, déplie l'exercice, le met en évidence).
    function revealExercise(exId) {
        var f = findExerciseById(exId);
        if (!f) { showToast("Exercice introuvable : il a peut-être été supprimé (voir la corbeille)."); return false; }
        if (gsRunActive() && guidedSessionViewActive) { showToast("Une session est en cours : termine-la avant d'aller dans les dossiers.", 4500); return false; }
        if (closeActiveModal) closeActiveModal();
        closeFolderMenu();
        var keptDraft = leaveGuidedViewForNav();
        if (f.inst.id !== state.activeInstrumentId) { state.activeInstrumentId = f.inst.id; persist(); }
        clearFilters();
        setNavPath(f.inst, f.ex.archived ? [ARCHIVED_ID] : f.pathIds.slice());
        f.pathIds.forEach(function (id) { treeExpanded[id] = true; });
        if (f.ex.collapsed) { f.ex.collapsed = false; persist(); }
        render();
        function flash() {
            var el = document.querySelector('.exercise[data-reorder-id="' + exId + '"]');
            if (!el) return false;
            try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) { el.scrollIntoView(); }
            el.classList.add("reveal-flash");
            setTimeout(function () { el.classList.remove("reveal-flash"); }, 2200);
            return true;
        }
        if (!flash()) {
            var v = loadExView();
            if (!exViewIsDefault(v)) { saveExView({ sort: v.sort, att: "", notes: "", video: false, fav: false }); render(); flash(); showToast("Filtres d'affichage des exercices retirés pour montrer « " + f.ex.title + " »", 4500); return true; }
        }
        if (keptDraft) showToast("« " + keptDraft + " » n'est pas encore enregistrée : tes modifications t'attendent (bouton Session guidée).", 6000);
        return true;
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
        if (closeActiveModal) { backdrop.classList.add("ctx-over-modal"); pop.classList.add("ctx-over-modal"); }
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
        var sessions = allSessions.filter(function (gs) { return gs.instrumentId === activeInstId && !gs.ephemeral; }); // les éphémères n'apparaissent que dans le calendrier et « À venir »
        gsRefreshModified(sessions);
        var archivedAll = sessions.filter(function (gs) { return gs.archived; });
        sessions = sessions.filter(function (gs) { return !gs.archived; });
        var showArchived = gsActiveTab === "__archived__";
        var showUpcoming = gsActiveTab === "upcoming";
        if (gsActiveTab !== "all" && !showArchived && !showUpcoming && !tabs.some(function (t) { return t.id === gsActiveTab; })) gsActiveTab = "all";
        var activeTab = tabs.filter(function (t) { return t.id === gsActiveTab; })[0] || null;

        var liveIds = exerciseIdSet(); // pour repérer les pas dont l'exercice a été supprimé
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
            if (sessSel[session.id]) row.classList.add("selected");
           
            row.addEventListener("click", function (e) {
                if (e.target.closest("button")) return;
                if (suppressNextClick) { suppressNextClick = false; return; }
                if (sessSelWantsClick(e)) { sessSelClick(e, session.id); return; }
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
            var plannedToday = state.settings.sessionPlan.some(function (pe) { return pe.sessionId === session.id && pe.date === calKey(new Date()); });
            if (plannedToday && !calDayItems(calKey(new Date())).done.some(function (e) { return e.sessionId === session.id; })) {
                var todayPill = document.createElement("span");
                todayPill.className = "gs-session-today";
                todayPill.textContent = "prévue aujourd'hui";
                info.appendChild(todayPill);
            }
            var missing = session.steps.filter(function (st) { return !liveIds[st.exerciseId]; }).length;
            if (missing) {
                var broken = document.createElement("span");
                broken.className = "gs-session-broken";
                broken.textContent = "⚠ " + missing + " exercice" + (missing > 1 ? "s" : "") + " supprimé" + (missing > 1 ? "s" : "");
                info.appendChild(broken);
            }
            if (gsDraftDirty(session.id)) {
                var unsaved = document.createElement("span");
                unsaved.className = "gs-session-unsaved";
                unsaved.textContent = "● non enregistrée";
                unsaved.title = "Des modifications de cette session n'ont pas été enregistrées : ouvre-la pour les enregistrer ou les annuler";
                info.appendChild(unsaved);
            }
            row.appendChild(info);
            bindContextGesture(row, function (x, y) {
                if (sessSelCount() > 1 && sessSel[session.id]) openLinksQuickMenu(x, y, sessSelActions().map(function (a) { return { label: a.text, open: function () { a.run(row); } }; }));
                else openSessionMenu(x, y, session);
            });

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
                if (activeTab && !session.archived) {
                    session.tabIds = session.tabIds.filter(function (id) { return id !== activeTab.id; });
                    save(); render();
                    return;
                }
                deleteSessionGuarded(session);
            });
            var archBtn = svgIconButton(ARCHIVE_ICON_SVG, session.archived ? "Désarchiver cette session (elle revient dans « Tout »)" : "Archiver cette session (masquée, jamais perdue : onglet « Archivées »)", function () {
                session.archived = !session.archived;
                if (session.archived) showToast("« " + session.name + " » archivée (onglet « Archivées »)");
                save(); render();
            });
            archBtn.classList.add("gs-session-archive-btn");
            if (session.archived) delBtn.title = "Supprimer définitivement cette session";
            actions.appendChild(playBtn);
            if (linksBtn) actions.appendChild(linksBtn);
            actions.appendChild(archBtn);
            actions.appendChild(delBtn);
            row.appendChild(actions);
            return row;
        }

        // Clic droit / appui long sur une session : toutes les actions à portée de main.
        function openSessionMenu(x, y, session) {
            var items = [];
            if (!session.archived) items.push({ label: "▶ Lancer la session", open: function () { if (session.steps.length) gsStartRun(session); else showToast("Cette session n'a pas encore d'exercice"); } });
            items.push({ label: "Modifier les exercices", open: function () { gsEditingSession = session; gsScreen = "edit"; render(); } });
            items.push({ label: "Renommer…", open: function () { gsRenameSession(session); } });
            items.push({ label: sessSel[session.id] ? "☐ Désélectionner" : "☑ Sélectionner (plusieurs)", open: function () { sessSelToggle(session.id); } });
            items.push({ label: "Dupliquer", open: function () {
                var copy = cloneJson(session);
                copy.id = uid(); copy.createdAt = Date.now(); copy.runCount = 0; copy.name = session.name + " (copie)";
                delete copy.updatedAt; delete copy.sig; delete copy.lastRunAt;
                copy.steps.forEach(function (st) { st.id = uid(); });
                allSessions.push(copy);
                save(); render();
                showToast("« " + session.name + " » dupliquée");
            } });
            if (typeof openSessionCalendar === "function") items.push({ label: "Programmer au calendrier…", open: function () { openSessionCalendar({ sessionId: session.id }); } });
            tabs.forEach(function (t) {
                var on = session.tabIds.indexOf(t.id) !== -1;
                items.push({ label: (on ? "✓ " : "＋ ") + "Onglet « " + t.name + " »", open: function () {
                    if (on) session.tabIds = session.tabIds.filter(function (id) { return id !== t.id; }); else session.tabIds.push(t.id);
                    var de = gsDrafts[session.id];
                    if (de) { var clean = !gsDraftDirty(session.id); de.draft.tabIds = session.tabIds.slice(); if (clean) de.base = gsDraftSig(de); }
                    save(); render();
                } });
            });
            items.push({ label: session.archived ? "Désarchiver" : "Archiver", open: function () {
                session.archived = !session.archived;
                if (session.archived) showToast("« " + session.name + " » archivée (onglet « Archivées »)");
                save(); render();
            } });
            [["dur-asc", "Trier la liste : durée croissante"], ["used-desc", "Trier la liste : les plus utilisées"], ["az", "Trier la liste : A → Z"], ["manual", "Trier la liste : ordre manuel"]].forEach(function (o) {
                items.push({ label: (gsSort === o[0] ? "✓ " : "") + o[1], open: function () { gsSort = o[0]; gsSaveView(); render(); } });
            });
            items.push({ label: "Supprimer…", open: function () { deleteSessionGuarded(session); } });
            openLinksQuickMenu(x, y, items);
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

        var addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "btn-accent gs-add-session-btn";
        addBtn.textContent = "+ Nouvelle session";
        addBtn.addEventListener("click", newSession);
        var addTabBtn = document.createElement("button");
        addTabBtn.type = "button";
        addTabBtn.className = "gs-add-folder-btn gs-tab gs-tab-new";
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

        // Sessions prévues dans les 30 prochains jours, groupées par jour.
        function buildUpcomingList() {
            var wrap = document.createElement("div"); wrap.className = "gs-upcoming";
            var items = calUpcoming(30), lastKey = null;
            if (!items.length) {
                var e = document.createElement("div"); e.className = "gs-empty";
                e.textContent = "Rien de prévu dans les 30 prochains jours. Programme une session depuis le calendrier (clic sur un jour) ou par clic droit sur une session.";
                wrap.appendChild(e); return wrap;
            }
            items.forEach(function (en) {
                if (en.date !== lastKey) { lastKey = en.date; var h = document.createElement("div"); h.className = "gs-up-day" + (en.date === calTodayKey() ? " gs-up-today" : ""); h.textContent = calRelLabel(en.date); wrap.appendChild(h); }
                var sess = allSessions.filter(function (g) { return g.id === en.sessionId; })[0];
                var row = document.createElement("div"); row.className = "gs-up-row" + (sess && sess.ephemeral ? " gs-up-eph" : ""); row.dataset.date = en.date; row.title = "Ouvrir ce jour dans le calendrier";
                var info = document.createElement("div"); info.className = "gs-up-info";
                var nm = document.createElement("span"); nm.className = "gs-up-name"; nm.textContent = gsSessionNameById(en.sessionId);
                var meta = document.createElement("span"); meta.className = "gs-up-meta";
                meta.textContent = (sess ? sess.steps.length + " exercice" + (sess.steps.length > 1 ? "s" : "") + " · " + sessionTotalMinutes(sess) + " min" + (sess.steps.some(function (st) { return !liveIds[st.exerciseId]; }) ? " · ⚠ exercice supprimé" : "") : "session supprimée") + (en.seriesId ? " · ↻ " + calRuleLabel(en.rule) : "");
                info.appendChild(nm); info.appendChild(meta); row.appendChild(info);
                var acts = document.createElement("div"); acts.className = "gs-session-actions";
                if (en.date === calTodayKey() && sess && sess.steps.length) { var pb = svgIconButton(METRO_PLAY_ICON_SVG, "Lancer cette session maintenant", function () { gsStartRun(sess); }); pb.classList.add("gs-session-play-btn"); acts.appendChild(pb); }
                if (sess) { var ed = iconButton("✎", "Modifier les exercices de cette session", function () { gsOpenSessionEditor(sess); }); ed.classList.add("gs-up-edit"); acts.appendChild(ed); }
                var rm = iconButton("✕", en.seriesId ? "Retirer du planning (cette session ou toute la série)" : "Retirer du planning", function () { calRemovePlanEntry(en, rm, function () { render(); }); });
                acts.appendChild(rm); row.appendChild(acts);
                row.addEventListener("click", function (ev) { if (ev.target.closest("button")) return; if (suppressNextClick) { suppressNextClick = false; return; } openSessionCalendar({ focusDate: en.date }); });
                bindContextGesture(row, function (x, y) {
                    var its = [];
                    if (en.date === calTodayKey() && sess && sess.steps.length) its.push({ label: "▶ Lancer maintenant", open: function () { gsStartRun(sess); } });
                    if (sess) its.push({ label: "✎ Modifier les exercices", open: function () { gsOpenSessionEditor(sess); } });
                    if (sess) its.push({ label: sess.ephemeral ? "Enregistrer dans mes sessions…" : "Renommer…", open: function () { gsRenameSession(sess); } });
                    its.push({ label: "Ouvrir ce jour dans le calendrier", open: function () { openSessionCalendar({ focusDate: en.date }); } });
                    its.push({ label: "✕ Retirer du planning" + (en.seriesId ? " (série)" : ""), open: function () { calRemovePlanEntry(en, rm, function () { render(); }); } });
                    openLinksQuickMenu(x, y, its);
                });
                wrap.appendChild(row);
            });
            return wrap;
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
            if (dropId) b.setAttribute("data-drop-session-folder", dropId);
            b.innerHTML = "";
            var l = document.createElement("span"); l.className = "gs-tab-name"; l.textContent = label;
            var c = document.createElement("span"); c.className = "gs-tab-count"; c.textContent = String(count);
            b.appendChild(l); b.appendChild(c);
            b.addEventListener("click", function () { gsActiveTab = id; gsSaveView(); render(); });
            if (id !== "all" && id !== "upcoming") b.addEventListener("dblclick", function () { renameTab(id); });
            bar.appendChild(b);
        }
        function renameTab(id) {
            var t = tabs.filter(function (x) { return x.id === id; })[0];
            if (!t) return;
            var n = window.prompt("Nom de l'onglet :", t.name);
            if (n === null || !n.trim()) return;
            t.name = n.trim(); save(); render();
        }
        tabBtn("upcoming", "À venir", calUpcoming(30).length, null); // à gauche de « Tout »
        bar.lastChild.classList.add("gs-tab-upcoming");
        tabBtn("all", "Tout", sessions.length, "__all__");
        tabs.forEach(function (t) {
            tabBtn(t.id, t.name, sessions.filter(function (gs) { return gs.tabIds.indexOf(t.id) !== -1; }).length, t.id);
        });
        bar.appendChild(addTabBtn); // « + Onglet » : à droite des onglets existants
        if (archivedAll.length || showArchived) {
            tabBtn("__archived__", "Archivées", archivedAll.length, "__archived__");
            bar.lastChild.classList.add("gs-tab-archive");
        }
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
        if (!showUpcoming) content.appendChild(tools);

        // ---- liste ---- (« + Nouvelle session » juste au-dessus des sessions)
        var newBar = document.createElement("div");
        newBar.className = "gs-newbar";
        newBar.appendChild(addBtn);
        if (!showUpcoming) content.appendChild(newBar);
        var visible = gsSortList((showArchived ? archivedAll : sessions).filter(function (gs) {
            return (showArchived || !activeTab || gs.tabIds.indexOf(activeTab.id) !== -1) && gsDurationMatches(gs);
        }));
        if (showUpcoming) {
            content.appendChild(buildUpcomingList());
        } else if (!visible.length) {
            var empty = document.createElement("div");
            empty.className = "gs-empty";
            empty.textContent = showArchived && !archivedAll.length ? "Aucune session archivée."
                : !sessions.length && !showArchived ? "Aucune session pour l'instant."
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
                    if (target === "__archived__") { session.archived = true; save(); showToast("« " + session.name + " » archivée"); render(); return; }
                    if (session.archived) { session.archived = false; save(); }
                    openTabDropMenu(x, y, session, target === "__all__" ? "" : target);
                }
            });
            content.appendChild(list);
        }

        // À côté du titre : calendrier (programmation) et historique/statistiques.
        var headActions = document.createElement("div");
        headActions.className = "gs-head-actions";
        var calBtn = document.createElement("button");
        calBtn.type = "button";
        calBtn.className = "gs-calendar-btn";
        calBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/></svg><span>Calendrier</span>';
        calBtn.title = "Programmer des sessions pour les prochaines semaines";
        calBtn.addEventListener("click", function () { if (typeof openSessionCalendar === "function") openSessionCalendar({}); });
        headActions.appendChild(calBtn);
        var histBtn = document.createElement("button");
        histBtn.type = "button";
        histBtn.className = "gs-history-btn";
        histBtn.textContent = "Historique";
        histBtn.title = "Sessions réalisées et statistiques d'entraînement";
        histBtn.addEventListener("click", function () { openSessionHistory(); });
        var nToSort = statsIssueCount();
        if (nToSort) {
            var hb = document.createElement("span"); hb.className = "gs-tab-count st-issue-count"; hb.textContent = String(nToSort);
            histBtn.appendChild(hb);
            histBtn.title += " — " + nToSort + " exercice" + (nToSort > 1 ? "s" : "") + " à ranger pour les statistiques";
        }
        headActions.appendChild(histBtn);
        if (window.matchMedia && window.matchMedia("(min-width: 880px)").matches) $contentHeading.appendChild(headActions);
        else content.insertBefore(headActions, content.firstChild);
    }

    // ---- écran édition ----
    function renderGsEditScreen(content) {
        var real = gsEditingSession;
        var entry = gsDraftFor(real);
        var session = entry.draft; // tout ce qui suit modifie cette copie de travail, pas la session enregistrée

        function leaveEdit() {
            delete gsDrafts[real.id]; gsEditingSession = null; gsScreen = "list";
            if (real.ephemeral) { // éphémère : on revient au calendrier, et une session restée vide n'est pas programmée
                var cur = gsFindSession(real.id), key = real.date, dropped = false;
                if (cur && cur.ephemeral && !cur.steps.length) { gsDropEphemeral(cur); dropped = true; }
                render();
                if (dropped) showToast("Session vide : rien n'a été programmé pour ce jour-là.", 4000);
                if (key) setTimeout(function () { openSessionCalendar({ focusDate: key }); }, 0);
                return;
            }
            render();
        }
        // Barre du haut : retour à gauche, annuler / enregistrer à droite (collée en haut pendant le défilement)
        var topRow = document.createElement("div");
        topRow.className = "gs-edit-topbar";
        var backBtn = document.createElement("button");
        backBtn.type = "button";
        backBtn.className = "btn-ghost gs-back-btn";
        backBtn.textContent = real.ephemeral ? "← Retour au calendrier" : "← Retour à la liste";
        backBtn.addEventListener("click", function () {
            if (gsDraftDirty(real.id)) gsDraftPrompt(real.id, {}, leaveEdit); else leaveEdit();
        });
        topRow.appendChild(backBtn);
        var spacerTop = document.createElement("span"); spacerTop.className = "gs-edit-topspacer"; topRow.appendChild(spacerTop);
        var cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "btn-ghost gs-cancel-btn";
        cancelBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg><span>Annuler</span>';
        cancelBtn.title = "Annuler toutes les modifications non enregistrées";
        cancelBtn.addEventListener("click", function () { delete gsDrafts[real.id]; render(); });
        topRow.appendChild(cancelBtn);
        var saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "btn-accent gs-save-btn";
        saveBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M8 3v5h7V3"/><path d="M8 21v-7h8v7"/></svg><span>Enregistrer</span>';
        saveBtn.addEventListener("click", function () {
            gsCommitDraft(real.id);
            showToast("Session enregistrée");
            render();
        });
        topRow.appendChild(saveBtn);
        content.appendChild(topRow);
        function refreshDirty() {
            var dirty = gsDraftDirty(real.id);
            saveBtn.disabled = !dirty;
            cancelBtn.hidden = !dirty;
            saveBtn.classList.toggle("gs-save-dirty", dirty);
            saveBtn.querySelector("span").textContent = dirty ? "Enregistrer" : "Enregistré";
            topRow.classList.toggle("gs-edit-dirty", dirty);
        }
        refreshDirty();
        // Après chaque saisie ou clic dans l'écran, on relit l'état (rien à brancher bouton par bouton)
        ["input", "change", "click"].forEach(function (evt) { content.addEventListener(evt, function () { setTimeout(refreshDirty, 0); }, true); });

        if (real.ephemeral) {
            // Session éphémère : « Session du JJ-MM-AAAA », pas de nom à saisir ni d'onglets ; on peut la garder en lui donnant un nom.
            var eb = document.createElement("div");
            eb.className = "gs-ephemeral-banner";
            var et = document.createElement("div"); et.className = "gs-ephemeral-title"; et.textContent = session.name;
            var es = document.createElement("div"); es.className = "gs-ephemeral-sub";
            es.textContent = real.date ? calLongDate(real.date) : "";
            var ek = document.createElement("button"); ek.type = "button"; ek.className = "btn-ghost gs-ephemeral-keep"; ek.textContent = "Enregistrer dans mes sessions…";
            ek.addEventListener("click", function () { gsKeepEphemeral(real); });
            eb.appendChild(et); eb.appendChild(es); eb.appendChild(ek);
            content.appendChild(eb);
        }
        var nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.className = "gs-name-input";
        nameInput.value = session.name;
        nameInput.placeholder = "Nom de la session";
        nameInput.addEventListener("change", function () {
            session.name = nameInput.value.trim() || session.name;
            save();
        });
        if (!real.ephemeral) content.appendChild(nameInput);

        var sessTabs = real.ephemeral ? [] : state.settings.sessionFolders.filter(function (f) { return f.instrumentId === session.instrumentId; });
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
        runBtn.addEventListener("click", function () {
            if (!session.steps.length) return;
            var go = function () { delete gsDrafts[real.id]; gsStartRun(state.settings.guidedSessions.filter(function (g) { return g.id === real.id; })[0] || real); };
            if (gsDraftDirty(real.id)) gsDraftPrompt(real.id, { title: "Enregistrer avant de lancer ?", saveLabel: "Enregistrer et lancer", discard: false }, go); else go();
        });
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

        // Exercice introuvable : est-il à la corbeille (seul, ou dans un dossier supprimé) ?
        function trashEntryFor(exId) {
            return (state.settings.trash || []).filter(function (t) {
                if (t.type === "exercise") return t.data && t.data.id === exId;
                if (t.type === "folder") return folderExerciseIds(t.data || { exercises: [], folders: [] }).indexOf(exId) !== -1;
                return false;
            })[0] || null;
        }
        // Clic droit / appui long sur un exercice de la session : tout ce qu'on peut vouloir y changer.
        function openStepMenu(x, y, step, found) {
            var items = [];
            if (found) {
                items.push({ label: "✎ Modifier l'exercice (titre, notes, liens, tempo…)", open: function () {
                    gsOpenStepDetails[step.id] = true; gsOpenStepEdit[step.id] = true; renderSteps();
                    var r = stepsList.querySelector('.gs-step-row[data-reorder-id="' + step.id + '"]');
                    if (r) { try { r.scrollIntoView({ block: "nearest" }); } catch (e) {} var t = r.querySelector(".gs-step-title-edit"); if (t) t.focus(); }
                } });
                items.push({ label: "Renommer l'exercice…", open: function () { renameExercisePrompt(found.ex, found.folder); } });
                items.push({ label: "Ouvrir dans son dossier", open: function () { revealExercise(found.ex.id); } });
            } else {
                var te = trashEntryFor(step.exerciseId);
                if (te) items.push({ label: "♻ Restaurer l'exercice (corbeille" + (te.type === "folder" ? ", avec le dossier « " + te.data.name + " »" : "") + ")", open: function () { restoreFromTrash(te.id); showToast("Exercice restauré"); } });
            }
            items.push({ label: "⇄ Remplacer partout par…", open: function () { startReplaceEverywhere(step.exerciseId, found ? found.ex.title : "exercice supprimé"); } });
            items.push({ label: "⇄ Remplacer ce pas seulement…", open: function () {
                gsPickMulti = null; exSel = {}; exSelAnchor = null;
                gsPickCallback = function (ex) { step.exerciseId = ex.id; delete step.hidden; }; // durée, note et tempo propre du pas sont conservés
                gsScreen = "pick";
                render();
                showToast("Choisis l'exercice qui remplace celui-ci (même durée, même note)", 4000);
            } });
            items.push({ label: "Dupliquer ce pas", open: function () {
                var copy = cloneJson(step); copy.id = uid();
                session.steps.splice(session.steps.indexOf(step) + 1, 0, copy);
                renderSteps(); refreshTotal(); refreshDirty();
            } });
            items.push({ label: "✕ Retirer de la session", open: function () {
                session.steps.splice(session.steps.indexOf(step), 1);
                renderSteps(); refreshTotal(); refreshDirty();
                editRunBtn.disabled = !session.steps.length;
            } });
            openLinksQuickMenu(x, y, items);
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
                    // « Tempo propre à cette session » (step.metronome) : indépendant de celui de l'exercice.
                    own: function () { return !!step.metronome; },
                    get: function () {
                        if (step.metronome) return step.metronome;
                        if (found && found.ex.id in entry.metro) return entry.metro[found.ex.id];
                        return gsEffectiveMetronome(step, found && found.ex);
                    },
                    set: function (p) {
                        if (step.metronome) { if (p) step.metronome = cloneJson(p); else delete step.metronome; } // « Retirer » : retour au tempo de l'exercice
                        else if (found) entry.metro[found.ex.id] = p ? cloneJson(p) : null; // en attente jusqu'à « Enregistrer »
                        else if (p) step.metronome = p;
                        renderSteps();
                    }
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
                    var has = !!((found && ((found.ex.notes && found.ex.notes.trim()) || (found.ex.fixedNotes && found.ex.fixedNotes.trim()))) || (step.note && step.note.trim()));
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
                    refreshTotal();
                });
                sessZone.appendChild(minutesInput);
                var minLabel = document.createElement("span");
                minLabel.className = "gs-step-min-label";
                minLabel.textContent = "min";
                sessZone.appendChild(minLabel);
                if (!real.ephemeral && gsOtherStepsOf(step).rows.length) {
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
                bindContextGesture(line, function (x, y) { openStepMenu(x, y, step, found); }); // la barre seulement : les détails gardent le menu natif (copier/coller)

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
                                if (v !== found.ex.title && exerciseTitleTaken(found.folder.exercises, v, found.ex) && !confirmNameCollision("exercice", v)) { titleEdit.value = found.ex.title; return; }
                                found.ex.title = v;
                                touchExercise(found.ex);
                                save();
                                renderSteps();
                            });
                            details.appendChild(titleEdit);
                            var exEditor = renderExerciseDetails(found.ex);
                            details.appendChild(exEditor);
                            Array.prototype.forEach.call(exEditor.querySelectorAll(".notes-textarea, .notes-fixed-textarea"), function (exTa) { setTimeout(function () { autoGrowNotes(exTa); }, 0); });
                        }
                    }
                    details.appendChild(buildMetronomePresetRow(stepTempoCfg));
                    var ownRow = document.createElement("label");
                    ownRow.className = "gs-step-owntempo";
                    var ownCb = document.createElement("input");
                    ownCb.type = "checkbox";
                    ownCb.checked = !!step.metronome;
                    ownCb.addEventListener("change", function () {
                        if (ownCb.checked) {
                            var base = stepTempoCfg.get();
                            step.metronome = base ? cloneJson(base) : blankMetroPreset(state.settings.metronome.bpm || 100);
                        } else delete step.metronome;
                        renderSteps();
                    });
                    var ownTxt = document.createElement("span");
                    ownTxt.textContent = "Tempo propre à cette session";
                    ownTxt.title = "Coché : ce tempo ne change que dans cette session. Décoché : le tempo de l'exercice, le même partout.";
                    ownRow.appendChild(ownCb); ownRow.appendChild(ownTxt);
                    details.appendChild(ownRow);
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
                    noteLabel.appendChild(buildDateStampBtn(noteInput));
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
        function startAddStep() {
            gsPickCallback = function (ex) {
                session.steps.push({ id: uid(), exerciseId: ex.id, minutes: gsDefaultMinutes(ex) });
                save();
            };
            gsPickMulti = function (exs) { // Ctrl/⌘ + clic : plusieurs exercices d'un coup, dans l'ordre des clics
                exs.forEach(function (ex) { session.steps.push({ id: uid(), exerciseId: ex.id, minutes: gsDefaultMinutes(ex) }); });
                save();
            };
            exSel = {}; exSelAnchor = null;
            gsScreen = "pick";
            render();
        }
        addStepBtn.addEventListener("click", startAddStep);
        content.appendChild(addStepBtn);
        content.appendChild(totalRow);
        if (gsAutoPick === real.id) { // session éphémère qu'on vient de créer : le choix du 1er exercice s'ouvre tout de suite
            gsAutoPick = null;
            setTimeout(function () { if (gsScreen === "edit" && gsEditingSession && gsEditingSession.id === real.id) startAddStep(); }, 0);
        }
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
        var inst = getActiveInstrument(), parentList = folders;
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
            row.dataset.pickFolder = folder.id;
            row.addEventListener("click", function () {
                if (suppressNextClick) { suppressNextClick = false; return; }
                treeExpanded[folder.id] = !expanded; render();
            });
            bindPickGesture(row, function (x, y) { openFolderMenu(x, y, function () { return parentList; }, folder, inst); }, function (destId, x, y) {
                var dest = findFolderById(inst, destId);
                if (dest) openFolderDropMenu(x, y, inst, folder, dest);
            });
            node.appendChild(row);

            if (expanded && hasContent) {
                var childWrap = document.createElement("div");
                childWrap.className = "gs-pick-tree-children";
                visibleExercises.forEach(function (ex) {
                    var exBtn = document.createElement("button");
                    exBtn.type = "button";
                    exBtn.className = "gs-pick-exercise-row" + (ex.id in exSel ? " selected" : "");
                    exBtn.dataset.exId = ex.id;
                    var exTitle = document.createElement("span");
                    exTitle.className = "gs-pick-ex-title";
                    exTitle.textContent = ex.title;
                    exBtn.appendChild(exTitle);
                    var prev = gsNotePreview(ex);
                    if (prev) exBtn.appendChild(prev);
                    exBtn.addEventListener("click", function (e) {
                        if (suppressNextClick) { suppressNextClick = false; return; }
                        if (gsPickMulti && exSelWantsClick(e)) { exSelClick(e, ex.id); return; } // Ctrl/⌘/Maj + clic : sélection multiple
                        gsPickCallback(ex);
                        gsScreen = "edit";
                        render();
                    });
                    bindPickGesture(exBtn, function (x, y) {
                        if (exSelCount() > 1 && ex.id in exSel) openLinksQuickMenu(x, y, exSelActions().map(function (a) { return { label: a.text, open: function () { a.run(exBtn); } }; }));
                        else openExerciseMenu(x, y, ex, folder, { reveal: true, noAddToSession: true, noSelect: !gsPickMulti });
                    }, function (destId, x, y) {
                        var dest = findFolderById(inst, destId);
                        if (dest && exSelCount() > 1 && (ex.id in exSel)) openExercisesDropMenu(x, y, exSelItems(), dest);
                        else if (dest) openExerciseDropMenu(x, y, ex, folder, dest);
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
                btn.className = "gs-pick-result" + (r.ex.id in exSel ? " selected" : "");
                btn.dataset.exId = r.ex.id;
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
                bindPickGesture(btn, function (x, y) {
                    if (exSelCount() > 1 && r.ex.id in exSel) openLinksQuickMenu(x, y, exSelActions().map(function (a) { return { label: a.text, open: function () { a.run(btn); } }; }));
                    else openExerciseMenu(x, y, r.ex, r.folder, { reveal: true, noAddToSession: true, noSelect: !gsPickMulti });
                }, null);
                btn.addEventListener("click", function (e) {
                    if (suppressNextClick) { suppressNextClick = false; return; }
                    if (gsPickMulti && exSelWantsClick(e)) { exSelClick(e, r.ex.id); return; }
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
        if (freeRun) { showToast("Arrête d'abord l'entraînement libre.", 3500); return; }
        session.runCount = (session.runCount || 0) + 1;
        session.lastRunAt = Date.now();
        persist();
        if (gsAutoAdvanceOn()) { try { ensureMetroAudio(true); } catch (e) {} } // le clic de lancement autorise le son du carillon
        gsRunSession = session;
        gsRunStepIndex = 0;
        gsRunSpent = {}; gsRunBpm = {}; gsRunCurrentStepId = null; gsRunStartedAt = Date.now();
        gsTrackBpm(true);
        gsTotalMs = 0; gsTotalStartTs = null;
        gsEnterRunStep();
        gsScreen = "run";
        render();
    }

    // Temps réellement passé sur chaque exercice (pour l'historique) : cumulé quand on change d'exercice ou qu'on termine.
    var gsRunSpent = {}, gsRunCurrentStepId = null, gsRunStartedAt = 0;
    var GS_MIN_RECORD_SEC = 600; // en dessous de 10 min de pratique, on ne propose pas d'enregistrer la session
    // Tempo réellement joué pendant chaque exercice (pour la progression) : alimenté à chaque temps du métronome.
    var gsRunBpm = {};
    function gsBpmBeat(stepIdx, isBeat) {
        if (!gsRunSession || !gsRunCurrentStepId) return;
        var bpm = state.settings.metronome.bpm;
        var t = gsRunBpm[gsRunCurrentStepId] || (gsRunBpm[gsRunCurrentStepId] = { first: bpm, max: bpm, end: bpm, playedMs: 0 });
        if (bpm > t.max) t.max = bpm;
        t.end = bpm;
        t.stopped = false; // le métronome tourne : un éventuel arrêt précédent n'est plus d'actualité
        if (isBeat) t.playedMs += 60000 / bpm;
    }
    // Arrêt du métronome pendant un exercice : si le tempo était progressif vers un seuil et qu'on coupe avant de
    // l'atteindre, on le note (le tempo réglé n'est pas forcément celui qu'on a réussi à tenir) : confirmation à l'enregistrement.
    function gsBpmStop() {
        if (!gsRunSession || !gsRunCurrentStepId) return;
        var t = gsRunBpm[gsRunCurrentStepId];
        if (!t || !(t.playedMs > 0)) return;
        var m = state.settings.metronome, tg = metroProgressiveTarget(m);
        t.stopped = true; t.stopBpm = m.bpm; t.target = tg && tg.limit > 0 ? tg.limit : 0;
    }
    function gsTrackBpm(on) {
        metroBeatListeners = metroBeatListeners.filter(function (fn) { return fn !== gsBpmBeat; });
        metroStopListeners = metroStopListeners.filter(function (fn) { return fn !== gsBpmStop; });
        if (on) { metroBeatListeners.push(gsBpmBeat); metroStopListeners.push(gsBpmStop); }
    }
    function gsAccumulateStep() {
        if (!gsRunSession || !gsRunCurrentStepId) return;
        gsRunSpent[gsRunCurrentStepId] = (gsRunSpent[gsRunCurrentStepId] || 0) + gsRunElapsedNowMs();
        gsRunCurrentStepId = null;
    }
    // Une entrée d'historique (schéma v2) : de quoi calculer des statistiques plus tard sans rien deviner —
    // chaque exercice garde son identifiant, son chapitre, le temps réellement passé et le tempo joué.
    // Un pas de la séance enregistrée (ms = temps passé dessus). `bpmShort` : on a coupé avant le seuil visé.
    function gsStepRecord(st, ms, bpmMap) {
        var f = findExerciseById(st.exerciseId), t = (bpmMap || gsRunBpm)[st.id], played = t && t.playedMs > 0;
        var o = {
            sid: st.id,
            exerciseId: st.exerciseId,
            title: f ? f.ex.title : "(exercice supprimé)",
            chapterId: f && f.pathIds ? f.pathIds[0] : null,
            chapterName: f ? f.pathNames[0] : null,
            path: f ? f.pathNames.slice() : [],
            pathIds: f && f.pathIds ? f.pathIds.slice() : [],
            plannedMin: st.minutes,
            actualSec: Math.round(ms / 1000),
            bpmFirst: played ? t.first : null,
            bpmMax: played ? t.max : null,
            bpmEnd: played ? t.end : null,
            playedSec: t ? Math.round(t.playedMs / 1000) : 0
        };
        if (played && t.stopped && t.target && t.stopBpm < t.target) { o.bpmShort = true; o.bpmTarget = t.target; o.bpmStop = t.stopBpm; }
        return o;
    }
    // Exercices de la session sans temps enregistré (chrono oublié) : proposés à 0 min dans la fenêtre d'enregistrement.
    function gsRunMissingSteps(record) {
        var have = {}; record.steps.forEach(function (x) { if (x.sid) have[x.sid] = true; });
        return gsRunSession ? gsRunSession.steps.filter(function (st) { return !have[st.id]; }).map(function (st) { return gsStepRecord(st, 0); }) : [];
    }
    function gsBuildRunRecord() {
        if (!gsRunSession) return null;
        gsAccumulateStep();
        var steps = [], total = 0, plannedTotal = 0;
        gsRunSession.steps.forEach(function (st) {
            var ms = gsRunSpent[st.id] || 0;
            if (ms < 3000) return;
            steps.push(gsStepRecord(st, ms));
            total += ms;
            plannedTotal += st.minutes * 60;
        });
        if (total < GS_MIN_RECORD_SEC * 1000) return null; // moins de 10 min de pratique : rien à enregistrer
        var rec = { v: 2, id: uid(), sessionId: gsRunSession.id, name: gsRunSession.name, instrumentId: gsRunSession.instrumentId, date: gsRunStartedAt || Date.now(), endedAt: Date.now(), totalSec: Math.round(total / 1000), plannedSec: plannedTotal, steps: steps }
        if (gsRunSession.ephemeral) rec.ephemeral = true;
        return rec;
    }
    function gsFmtDur(sec) { var m = Math.floor(sec / 60), r = sec % 60; return m + " min" + (r ? " " + (r < 10 ? "0" : "") + r + " s" : ""); }
    function gsFmtDate(ts) { var d = new Date(ts); function p2(n) { return (n < 10 ? "0" : "") + n; } return p2(d.getDate()) + "/" + p2(d.getMonth() + 1) + "/" + String(d.getFullYear()).slice(2) + " " + p2(d.getHours()) + ":" + p2(d.getMinutes()); }
    // Fenêtre de relecture d'une séance : durée et tempo atteint de chaque exercice, modifiables. Sert à l'enregistrement
    // de fin de session (opts.requireConfirm : les exercices arrêtés avant leur seuil demandent une confirmation) et à la
    // correction d'une séance déjà enregistrée dans l'historique.
    function openRunRecordEditor(record, opts) {
        opts = opts || {};
        var items = record.steps.concat(opts.extraSteps || []).map(function (st) { var c = cloneJson(st); return { st: c, ask: !!c.bpmShort, answered: false, extra: (record.steps.indexOf(st) === -1) }; });
        openModal("gs-save-run-panel", function (panel, close) {
            var title = document.createElement("div");
            title.className = "backups-title";
            title.textContent = opts.title || "Enregistrer cette session ?";
            panel.appendChild(title);
            var sum = document.createElement("div");
            sum.className = "gs-sync-intro gs-rec-sum";
            panel.appendChild(sum);
            var list = document.createElement("div");
            list.className = "gs-rec-list";
            panel.appendChild(list);
            var yes;
            function numVal(inp) { var n = parseInt(inp.value, 10); return isNaN(n) || n < 0 ? 0 : n; }
            function totalSec() { return items.reduce(function (a, it) { return a + (it.removed ? 0 : numVal(it.mi) * 60 + numVal(it.si)); }, 0); }
            function bpmOf(it) { var n = parseInt(it.bi.value, 10); return n >= 30 && n <= 300 ? n : null; }
            function refresh() {
                var n = items.filter(function (it) { return !it.removed && numVal(it.mi) * 60 + numVal(it.si) > 0; }).length;
                sum.textContent = "« " + record.name + " » · " + gsFmtDur(totalSec()) + " · " + n + " exercice" + (n > 1 ? "s" : "");
                var blocked = items.some(function (it) { return it.ask && !it.answered && !it.removed; });
                yes.disabled = blocked || totalSec() <= 0;
                yes.title = blocked ? "Confirme le tempo des exercices arrêtés avant leur seuil" : "";
            }
            items.forEach(function (it) {
                var st = it.st;
                var box = document.createElement("div");
                box.className = "gs-rec-item" + (it.extra ? " gs-rec-extra" : "");
                var line = document.createElement("div");
                line.className = "gs-rec-row";
                var nm = document.createElement("span"); nm.className = "gs-rec-name"; nm.textContent = logStepTitle(st); nm.title = st.plannedMin + " min prévues";
                function num(max, ph, label) { var i = document.createElement("input"); i.type = "number"; i.min = "0"; i.max = String(max); i.className = "gs-rec-in"; i.placeholder = ph; i.setAttribute("aria-label", label); return i; }
                var mi = num(600, "0", "Minutes"), si = num(59, "0", "Secondes");
                mi.value = String(Math.floor((st.actualSec || 0) / 60)); si.value = String((st.actualSec || 0) % 60);
                var bi = num(300, "—", "Tempo atteint (BPM)"); bi.min = "30"; bi.className += " gs-rec-bpm";
                bi.value = st.bpmMax ? String(st.bpmMax) : "";
                it.mi = mi; it.si = si; it.bi = bi;
                [mi, si, bi].forEach(function (i) { i.addEventListener("input", refresh); bindScrubInput(i, 0, i === bi ? 300 : (i === si ? 59 : 600), { emptyStart: i === bi ? 80 : 0 }); });
                var dur = document.createElement("span"); dur.className = "gs-rec-dur";
                dur.appendChild(mi); dur.appendChild(document.createTextNode("′")); dur.appendChild(si); dur.appendChild(document.createTextNode("″"));
                var bw = document.createElement("span"); bw.className = "gs-rec-bw"; bw.appendChild(document.createTextNode("♩ ")); bw.appendChild(bi);
                var rm = iconButton("✕", "Retirer cet exercice de la séance", function () { it.removed = true; box.hidden = true; refresh(); });
                line.appendChild(nm); line.appendChild(dur); line.appendChild(bw); line.appendChild(rm);
                box.appendChild(line);
                if (it.ask) { // coupé avant le seuil : « est-ce bien ce tempo qu'il faut retenir ? »
                    var q = document.createElement("div"); q.className = "gs-rec-ask";
                    var qt = document.createElement("span"); qt.textContent = "Arrêté à " + st.bpmStop + " BPM (visé : " + st.bpmTarget + ")";
                    var keep = document.createElement("button"); keep.type = "button"; keep.className = "btn-accent gs-rec-keep"; keep.textContent = "Retenir " + st.bpmStop;
                    var none = document.createElement("button"); none.type = "button"; none.className = "btn-ghost gs-rec-none"; none.textContent = "Sans BPM";
                    function answer(v) { it.answered = true; bi.value = v ? String(v) : ""; q.classList.add("gs-rec-answered"); keep.classList.toggle("active", v === st.bpmStop); none.classList.toggle("active", !v); refresh(); }
                    keep.addEventListener("click", function () { answer(st.bpmStop); });
                    none.addEventListener("click", function () { answer(0); });
                    bi.addEventListener("input", function () { it.answered = true; q.classList.add("gs-rec-answered"); refresh(); }); // un autre tempo saisi = réponse
                    q.appendChild(qt); q.appendChild(keep); q.appendChild(none);
                    box.appendChild(q);
                }
                list.appendChild(box);
            });
            var actions = document.createElement("div");
            actions.className = "gs-sync-actions";
            var no = document.createElement("button"); no.type = "button"; no.className = "btn-ghost"; no.textContent = opts.cancelLabel || "Ne pas enregistrer";
            no.addEventListener("click", function () { close(); if (opts.onCancel) opts.onCancel(); });
            yes = document.createElement("button"); yes.type = "button"; yes.className = "btn-accent gs-rec-save"; yes.textContent = "Enregistrer";
            yes.addEventListener("click", function () {
                var out = cloneJson(record);
                out.steps = [];
                items.forEach(function (it) {
                    if (it.removed) return;
                    var sec = numVal(it.mi) * 60 + numVal(it.si);
                    if (sec <= 0) return;
                    var st = it.st, v = bpmOf(it);
                    st.actualSec = sec;
                    if (v) { st.bpmFirst = st.bpmFirst && st.bpmFirst <= v ? st.bpmFirst : v; st.bpmMax = v; st.bpmEnd = v; }
                    else { st.bpmFirst = null; st.bpmMax = null; st.bpmEnd = null; }
                    delete st.bpmShort; delete st.bpmTarget; delete st.bpmStop;
                    out.steps.push(st);
                });
                out.totalSec = out.steps.reduce(function (a, x) { return a + x.actualSec; }, 0);
                close();
                opts.onSave(out);
            });
            actions.appendChild(no); actions.appendChild(yes);
            panel.appendChild(actions);
            refresh();
        });
    }
    // À la fin d'une session : on propose de l'enregistrer dans l'historique (durées et tempos relisibles avant de valider).
    function gsAskSaveRun(record, extraSteps, title) {
        gsLiveWrite({ v: 1, kind: "record", savedAt: Date.now(), record: record, extraSteps: extraSteps || [] }); // gardée tant que rien n'est décidé
        openRunRecordEditor(record, {
            title: title,
            extraSteps: extraSteps || [],
            onSave: function (rec) { logAdd(rec); save(); gsLiveClear(); showToast(rec.free ? "Entraînement enregistré dans l'historique" : "Session enregistrée dans l'historique"); },
            onCancel: function () { gsLiveClear(); }
        });
    }
    // ---------- session en cours : sauvegarde continue, reprise après une fermeture brutale ----------
    // Propre à cet appareil (localStorage) : l'état de la session (ou de l'entraînement libre) en cours est recopié
    // toutes les quelques secondes. Au prochain lancement de l'appli, s'il en reste une trace, on propose de la
    // reprendre ou de l'enregistrer dans les statistiques (récapitulatif modifiable) — rien n'est perdu.
    var GS_LIVE_KEY = "trainhub.gsLive.v1";
    var GS_LIVE_MIN_MS = 60000;   // en dessous d'une minute de pratique, la trace est écartée sans rien demander
    function gsLiveRead() { try { var o = JSON.parse(localStorage.getItem(GS_LIVE_KEY)); return o && o.v === 1 ? o : null; } catch (e) { return null; } }
    function gsLiveWrite(o) { try { localStorage.setItem(GS_LIVE_KEY, JSON.stringify(o)); } catch (e) {} }
    function gsLiveClear() { try { localStorage.removeItem(GS_LIVE_KEY); } catch (e) {} }
    function gsLiveSnapshot() {
        if (gsRunSession) {
            var spent = {};
            Object.keys(gsRunSpent).forEach(function (k) { spent[k] = gsRunSpent[k]; });
            if (gsRunCurrentStepId) spent[gsRunCurrentStepId] = (spent[gsRunCurrentStepId] || 0) + gsRunElapsedNowMs();
            return { v: 1, kind: "session", savedAt: Date.now(), startedAt: gsRunStartedAt, sessionId: gsRunSession.id, name: gsRunSession.name,
                instrumentId: gsRunSession.instrumentId, ephemeral: !!gsRunSession.ephemeral, stepIndex: gsRunStepIndex, curStepId: gsRunCurrentStepId,
                elapsedMs: gsRunElapsedNowMs(), allocatedSec: gsRunAllocatedSec, totalMs: gsTotalNowMs(), spent: spent, bpm: cloneJson(gsRunBpm),
                steps: gsRunSession.steps.map(function (st) { return { id: st.id, exerciseId: st.exerciseId, minutes: st.minutes }; }) };
        }
        if (freeRun) return freeSnapshot();
        return null;
    }
    var gsLiveTimer = null;
    function gsLiveSave() {
        var snap = gsLiveSnapshot();
        if (!snap) return;
        gsLiveWrite(snap);
        if (!gsLiveTimer) gsLiveTimer = setInterval(function () { // recopie régulière, seulement tant qu'une session ou un entraînement libre est en cours
            if (!gsRunSession && !freeRun) { clearInterval(gsLiveTimer); gsLiveTimer = null; return; }
            gsLiveSave();
        }, 5000);
    }
    // Séance (schéma v2) reconstruite depuis une trace : mêmes champs qu'à la fin normale d'une session.
    function gsRecordFromSnap(snap, minTotalMs) {
        var steps = [], total = 0, planned = 0;
        (snap.steps || []).forEach(function (st) {
            var ms = (snap.spent || {})[st.id] || 0;
            if (ms < 3000) return;
            steps.push(gsStepRecord(st, ms, snap.bpm || {}));
            total += ms; planned += (st.minutes || 0) * 60;
        });
        if (!steps.length || total < minTotalMs) return null;
        var rec = { v: 2, id: uid(), sessionId: snap.sessionId, name: snap.name, instrumentId: snap.instrumentId, date: snap.startedAt || snap.savedAt, endedAt: snap.savedAt, totalSec: Math.round(total / 1000), plannedSec: planned, steps: steps };
        if (snap.ephemeral) rec.ephemeral = true;
        if (snap.kind === "free") rec.free = true;
        return rec;
    }
    function gsLiveResumeSession(snap, session) {
        var idx = -1;
        session.steps.forEach(function (st, i) { if (st.id === snap.curStepId) idx = i; });
        if (idx < 0) idx = Math.min(Math.max(0, snap.stepIndex || 0), session.steps.length - 1);
        var cur = session.steps[idx], same = snap.curStepId === cur.id;
        gsRunSession = session; gsRunStepIndex = idx;
        gsRunSpent = cloneJson(snap.spent || {}); gsRunBpm = cloneJson(snap.bpm || {}); gsRunCurrentStepId = null;
        gsRunStartedAt = snap.startedAt || Date.now();
        if (same) gsRunSpent[cur.id] = Math.max(0, (gsRunSpent[cur.id] || 0) - (snap.elapsedMs || 0)); // le temps de l'exercice en cours repart de son compteur
        gsTrackBpm(true);
        gsTotalMs = snap.totalMs || 0; gsTotalStartTs = null;
        gsEnterRunStep();
        if (same) { gsRunElapsedMs = snap.elapsedMs || 0; if (snap.allocatedSec) gsRunAllocatedSec = snap.allocatedSec; }
        gsPauseRun(); // la reprise reste manuelle : on remet les mains à l'instrument avant de relancer le chrono
        guidedSessionViewActive = true;
        if ($guidedSessionBtn) $guidedSessionBtn.classList.add("active");
        gsScreen = "run";
        render();
    }
    function gsLiveCheck() {
        var snap = gsLiveRead();
        if (!snap || gsRunSession || freeRun) return;
        var rec = null, extra = [];
        if (snap.kind === "record") { rec = snap.record; extra = snap.extraSteps || []; }
        else rec = gsRecordFromSnap(snap, GS_LIVE_MIN_MS);
        if (!rec) { gsLiveClear(); return; }
        var session = snap.kind === "session" ? gsFindSession(snap.sessionId) : null;
        var canResume = snap.kind === "free" || (snap.kind === "session" && session && session.steps.length > 0);
        openModal("gs-live-panel", function (panel, close) {
            var title = document.createElement("div");
            title.className = "backups-title";
            title.textContent = snap.kind === "record" ? "Séance non enregistrée" : "Séance interrompue";
            panel.appendChild(title);
            var intro = document.createElement("div");
            intro.className = "gs-sync-intro gs-live-intro";
            intro.textContent = "« " + rec.name + " » · " + gsFmtDur(rec.totalSec) + " de pratique · " + gsFmtDate(snap.savedAt || rec.endedAt || Date.now());
            panel.appendChild(intro);
            var actions = document.createElement("div");
            actions.className = "gs-live-actions";
            if (canResume) {
                var resume = document.createElement("button"); resume.type = "button"; resume.className = "btn-accent gs-live-resume"; resume.textContent = "Reprendre";
                resume.addEventListener("click", function () {
                    close();
                    if (snap.kind === "free") freeResume(snap); else gsLiveResumeSession(snap, session);
                });
                actions.appendChild(resume);
            }
            var saveBtn = document.createElement("button"); saveBtn.type = "button"; saveBtn.className = (canResume ? "btn-ghost" : "btn-accent") + " gs-live-save"; saveBtn.textContent = "Enregistrer dans les statistiques";
            saveBtn.addEventListener("click", function () {
                close();
                openRunRecordEditor(rec, {
                    title: "Enregistrer cette séance ?", extraSteps: extra,
                    onSave: function (out) { logAdd(out); save(); gsLiveClear(); showToast("Séance enregistrée dans l'historique"); },
                    onCancel: function () { gsLiveClear(); }
                });
            });
            actions.appendChild(saveBtn);
            var drop = document.createElement("button"); drop.type = "button"; drop.className = "btn-ghost gs-live-drop"; drop.textContent = "Abandonner";
            var armed = false;
            drop.addEventListener("click", function () {
                if (!armed) { armed = true; drop.textContent = "Confirmer l'abandon"; drop.classList.add("gs-live-drop-armed"); return; }
                gsLiveClear(); close();
            });
            actions.appendChild(drop);
            panel.appendChild(actions);
        });
    }
    window.addEventListener("pagehide", gsLiveSave);
    window.addEventListener("beforeunload", gsLiveSave);
    document.addEventListener("visibilitychange", function () { if (document.hidden) gsLiveSave(); });

    // ---------- entraînement libre : un chrono qui suit l'exercice affiché à l'écran principal ----------
    // Hors session : le décompte démarre quand un exercice déplié reste visible plus de 10 s, se met en pause dès
    // qu'on change d'exercice (puis repart 10 s après), et reste grisé tant qu'aucun exercice n'est affiché.
    // « Arrêter » ouvre le récapitulatif modifiable (comme une session), puis la séance « Session libre » entre
    // dans l'historique et les statistiques.
    var FREE_START_DELAY_MS = 10000, FREE_MIN_RECORD_MS = 60000, FREE_MIN_VISIBLE_PX = 80;
    var freeRun = null, freeTimer = null, freeBarEl = null, freeRecapEl = null;
    function freeStepId(exId) { return "free:" + exId; }
    // Exercice déplié le plus visible dans la zone principale (sous la barre du haut) ; null si aucun.
    function freeVisibleExercise() {
        if (document.hidden || guidedSessionViewActive) return null;
        var cont = document.getElementById("folder-container");
        if (!cont) return null;
        var bar = document.querySelector(".top-bar"), top = bar ? bar.getBoundingClientRect().bottom : 0;
        var bottom = window.innerHeight || document.documentElement.clientHeight;
        var els = cont.querySelectorAll(".exercise:not(.collapsed)"), best = null, bestH = 0;
        for (var i = 0; i < els.length; i++) {
            var r = els[i].getBoundingClientRect(), h = Math.min(r.bottom, bottom) - Math.max(r.top, top);
            if (h > bestH) { bestH = h; best = els[i]; }
        }
        return best && bestH >= FREE_MIN_VISIBLE_PX && best.dataset.exId ? best.dataset.exId : null;
    }
    function freeSnapshot() {
        var fr = freeRun, steps = Object.keys(fr.spent).map(function (id) { return { id: id, exerciseId: id.slice(5), minutes: 0 }; });
        return { v: 1, kind: "free", savedAt: Date.now(), startedAt: fr.startedAt, sessionId: "free", name: "Session libre", instrumentId: fr.instrumentId,
            spent: cloneJson(fr.spent), bpm: cloneJson(fr.bpm), totalMs: fr.totalMs, steps: steps };
    }
    function freeBeat(step, isBeat) {
        if (!freeRun || !freeRun.counting || !freeRun.cur) return;
        var id = freeStepId(freeRun.cur), bpm = state.settings.metronome.bpm;
        var t = freeRun.bpm[id] || (freeRun.bpm[id] = { first: bpm, max: bpm, end: bpm, playedMs: 0 });
        if (bpm > t.max) t.max = bpm;
        t.end = bpm;
        if (isBeat) t.playedMs += 60000 / bpm;
    }
    function freeTick() {
        if (!freeRun) return;
        var now = Date.now(), dt = Math.min(2000, Math.max(0, now - freeRun.last)), cur = freeVisibleExercise();
        freeRun.last = now;
        if (cur !== freeRun.cur) { freeRun.cur = cur; freeRun.seen = now; freeRun.counting = false; } // changement d'exercice : pause automatique
        if (!cur) freeRun.counting = false;
        else if (!freeRun.manual && !freeRun.counting && now - freeRun.seen >= FREE_START_DELAY_MS) freeRun.counting = true;
        if (freeRun.counting && cur && !freeRun.manual) {
            var id = freeStepId(cur);
            freeRun.spent[id] = (freeRun.spent[id] || 0) + dt;
            freeRun.lastAt[id] = now;
            freeRun.totalMs += dt;
        }
        freeRefreshBar();
    }
    function freeStatus() { // "run" | "wait" | "paused" | "idle"
        if (!freeRun) return "idle";
        if (freeRun.manual) return "paused";
        if (!freeRun.cur) return "idle";
        return freeRun.counting ? "run" : "wait";
    }
    var FREE_PAUSE_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
    var FREE_STOP_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
    function freeRefreshBar() {
        if (!freeBarEl || !freeRun) return;
        var st = freeStatus(), f = freeRun.cur ? findExerciseById(freeRun.cur) : null;
        freeBarEl.className = "free-bar free-bar-" + st;
        freeBarEl.querySelector(".free-time").textContent = gsFormatTotal(freeRun.totalMs);
        var left = Math.max(1, Math.ceil((FREE_START_DELAY_MS - (Date.now() - freeRun.seen)) / 1000));
        var full = st === "run" ? (f ? f.ex.title : "") : st === "wait" ? "Départ dans " + left + " s" : st === "paused" ? "En pause" : "Aucun exercice affiché";
        freeBarEl.querySelector(".free-what").textContent = st === "wait" ? left + " s" : ""; // le détail est dans l'info-bulle : peu de texte dans la barre
        freeBarEl.title = "Entraînement libre — " + full;
        var pb = freeBarEl.querySelector(".free-pause");
        pb.innerHTML = freeRun.manual ? METRO_PLAY_ICON_SVG : FREE_PAUSE_SVG;
        var pbTxt = freeRun.manual ? "Reprendre le décompte" : "Mettre en pause";
        pb.title = pbTxt; pb.setAttribute("aria-label", pbTxt);
        pb.disabled = !freeRun.manual && st === "idle";
        freeRecapRefresh();
    }
    // Récapitulatif en direct (grands écrans seulement) : un repère par exercice libre déjà pratiqué, nom puis durée.
    function freeRecapRefresh() {
        if (!freeRecapEl || !freeRun) return;
        var ids = Object.keys(freeRun.spent).filter(function (id) { return freeRun.spent[id] >= 5000; });
        ids.sort(function (a, b) { return (freeRun.lastAt[b] || 0) - (freeRun.lastAt[a] || 0) || freeRun.spent[b] - freeRun.spent[a]; });
        var sig = ids.join(",");
        if (freeRecapEl.getAttribute("data-sig") !== sig) {
            freeRecapEl.setAttribute("data-sig", sig);
            freeRecapEl.innerHTML = "";
            ids.forEach(function (id) {
                var chip = document.createElement("div"); chip.className = "free-chip"; chip.setAttribute("data-id", id);
                var nm = document.createElement("span"); nm.className = "free-chip-name";
                var du = document.createElement("span"); du.className = "free-chip-time";
                chip.appendChild(nm); chip.appendChild(du); freeRecapEl.appendChild(chip);
            });
        }
        var curId = freeRun.cur && freeRun.counting && !freeRun.manual ? freeStepId(freeRun.cur) : null;
        Array.prototype.forEach.call(freeRecapEl.children, function (chip) {
            var id = chip.getAttribute("data-id"), f = findExerciseById(id.slice(5)), title = f ? f.ex.title : "(exercice supprimé)";
            var nm = chip.firstChild, du = chip.lastChild, t = gsFormatTotal(freeRun.spent[id] || 0);
            if (nm.textContent !== title) { nm.textContent = title; chip.title = title; }
            if (du.textContent !== t) du.textContent = t;
            chip.classList.toggle("free-chip-now", id === curId);
        });
    }
    function freeShowBar() {
        if (freeBarEl) return;
        var bar = document.createElement("div");
        bar.id = "free-bar";
        bar.className = "free-bar free-bar-idle";
        var tm = document.createElement("span"); tm.className = "free-time"; tm.textContent = "0:00";
        var wh = document.createElement("span"); wh.className = "free-what";
        function sep() { var x = document.createElement("span"); x.className = "free-sep"; x.setAttribute("aria-hidden", "true"); return x; }
        var pb = document.createElement("button"); pb.type = "button"; pb.className = "btn-ghost free-pause";
        pb.addEventListener("click", function () {
            if (!freeRun) return;
            freeRun.manual = !freeRun.manual;
            if (!freeRun.manual && freeRun.cur) freeRun.counting = true; // relancé à la main : pas d'attente de 10 s
            if (freeRun.manual) freeRun.counting = false;
            freeRefreshBar();
        });
        var sp = document.createElement("button"); sp.type = "button"; sp.className = "btn-ghost free-stop"; sp.innerHTML = FREE_STOP_SVG;
        sp.title = "Arrêter l'entraînement libre"; sp.setAttribute("aria-label", "Arrêter l'entraînement libre");
        sp.addEventListener("click", freeStop);
        [tm, wh, sep(), pb, sep(), sp].forEach(function (n) { bar.appendChild(n); });
        var anchor = document.getElementById("free-btn"), actions = document.querySelector(".top-bar .top-actions");
        var recap = document.createElement("div"); recap.id = "free-recap"; recap.className = "free-recap";
        if (actions) { actions.insertBefore(recap, actions.firstChild); actions.insertBefore(bar, actions.firstChild); } // sur la ligne des outils, collé à gauche
        if (anchor) anchor.classList.add("free-on");
        freeRecapEl = recap;
        freeBarEl = bar;
        updateMetroDockMetrics();
    }
    function freeHideBar() {
        var anchor = document.getElementById("free-btn");
        if (anchor) anchor.classList.remove("free-on");
        if (freeBarEl && freeBarEl.parentNode) freeBarEl.parentNode.removeChild(freeBarEl);
        if (freeRecapEl && freeRecapEl.parentNode) freeRecapEl.parentNode.removeChild(freeRecapEl);
        freeBarEl = null; freeRecapEl = null;
        updateMetroDockMetrics();
    }
    function freeAttach(fr) {
        freeRun = fr;
        metroBeatListeners = metroBeatListeners.filter(function (fn) { return fn !== freeBeat; });
        metroBeatListeners.push(freeBeat);
        freeShowBar();
        if (freeTimer) clearInterval(freeTimer);
        freeTimer = setInterval(freeTick, 500);
        freeTick();
    }
    function freeDetach() {
        if (freeTimer) { clearInterval(freeTimer); freeTimer = null; }
        metroBeatListeners = metroBeatListeners.filter(function (fn) { return fn !== freeBeat; });
        freeRun = null;
        freeHideBar();
    }
    function freeLeaveSessionsView() {
        if (!guidedSessionViewActive) return;
        guidedSessionViewActive = false;
        if ($guidedSessionBtn) $guidedSessionBtn.classList.remove("active");
        if (gsRunInterval) { clearInterval(gsRunInterval); gsRunInterval = null; }
        render();
    }
    function freeStart() {
        if (freeRun) { freeLeaveSessionsView(); return; }
        if (gsRunSession) { showToast("Termine d'abord la session en cours.", 3500); return; }
        var now = Date.now();
        freeAttach({ startedAt: now, instrumentId: state.activeInstrumentId, spent: {}, lastAt: {}, bpm: {}, totalMs: 0, cur: null, seen: now, counting: false, manual: false, last: now });
        freeLeaveSessionsView();
        gsLiveSave();
        showToast("Ouvre un exercice : le décompte démarre après 10 s.", 4500);
    }
    function freeResume(snap) {
        var now = Date.now();
        freeAttach({ startedAt: snap.startedAt || now, instrumentId: snap.instrumentId, spent: cloneJson(snap.spent || {}), lastAt: {}, bpm: cloneJson(snap.bpm || {}), totalMs: snap.totalMs || 0, cur: null, seen: now, counting: false, manual: false, last: now });
        freeLeaveSessionsView();
        gsLiveSave();
    }
    function freeStop() {
        if (!freeRun) return;
        var snap = freeSnapshot();
        freeDetach();
        var rec = gsRecordFromSnap(snap, FREE_MIN_RECORD_MS);
        if (!rec) { gsLiveClear(); showToast("Entraînement trop court (moins d'une minute) : rien à enregistrer.", 4000); return; }
        gsAskSaveRun(rec, [], "Enregistrer cet entraînement ?");
    }
    // Séance déjà enregistrée : corriger une durée oubliée ou un tempo erroné.
    function editLoggedRecord(rec, afterClose) {
        openRunRecordEditor(rec, {
            title: "Modifier la séance",
            cancelLabel: "Annuler",
            onSave: function (out) { logAdd(out); save(); showToast("Séance modifiée"); if (afterClose) afterClose(); },
            onCancel: afterClose
        });
    }
    // ---------- calendrier : programmer des sessions (futur) ; le passé = sessions réalisées et enregistrées ----------
    function calKey(d) { function p2(n) { return (n < 10 ? "0" : "") + n; } return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); }
    function calParse(k) { var m = k.split("-"); return new Date(+m[0], +m[1] - 1, +m[2]); }
    var CAL_MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
    var CAL_DAYS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];
    var CAL_DAYS_FULL = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
    function calTodayKey() { return calKey(new Date()); }
    function calLongDate(key) { var d = calParse(key); return CAL_DAYS_FULL[d.getDay()] + " " + d.getDate() + " " + CAL_MONTHS[d.getMonth()]; }
    // Retire les programmations dont le jour est passé (elles n'ont pas été réalisées : l'historique ne les contient pas).
    function calPurgePast() {
        var t = calTodayKey(), before = state.settings.sessionPlan.length;
        state.settings.sessionPlan = state.settings.sessionPlan.filter(function (e) { return e.date >= t; });
        return before - state.settings.sessionPlan.length + purgeOrphanEphemerals(state, gsProtectedIds()); // les éphémères d'un jour passé partent avec leur séance
    }
    // Sessions programmées pour un jour (hors celles déjà réalisées ce jour-là) et séances enregistrées ce jour-là.
    function calDayItems(key) {
        var instId = state.activeInstrumentId;
        var done = logAll().filter(function (e) { return (!e.instrumentId || e.instrumentId === instId) && calKey(new Date(e.date)) === key; });
        var doneIds = {}; done.forEach(function (e) { doneIds[e.sessionId] = true; });
        var planned = state.settings.sessionPlan.filter(function (e) { return e.date === key && (!e.instrumentId || e.instrumentId === instId); });
        return { planned: planned.filter(function (e) { return !doneIds[e.sessionId]; }), fulfilled: planned.filter(function (e) { return doneIds[e.sessionId]; }), done: done };
    }
    function gsSessionNameById(id) {
        var g = state.settings.guidedSessions.filter(function (x) { return x.id === id; })[0];
        return g ? g.name : "(session supprimée)";
    }
    // ---- récurrence : « tous les mercredis jusqu'au… », « un lundi sur 2 »… ----
    // freq : "1" = une seule fois ; "w1".."w4" = chaque semaine / toutes les 2, 3, 4 semaines ; "m1" = chaque mois (même jour du mois).
    var CAL_FREQS = [["1", "Une seule fois"], ["w1", "Chaque semaine"], ["w2", "Toutes les 2 semaines"], ["w3", "Toutes les 3 semaines"], ["w4", "Toutes les 4 semaines"], ["m1", "Chaque mois (même jour)"]];
    function calDefaultUntil(key, freq) { var d = calParse(key); d.setDate(d.getDate() + (freq === "m1" ? 180 : 84)); return calKey(d); } // ≈ 6 mois / 12 semaines
    function calOccurrences(startKey, rule) {
        if (!rule || rule.freq === "1") return [startKey];
        var out = [], start = calParse(startKey), until = calParse(rule.until);
        if (rule.freq === "m1") {
            var dom = start.getDate();
            for (var m = 0; m < 60; m++) {
                var first = new Date(start.getFullYear(), start.getMonth() + m, 1), last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
                var d = new Date(first.getFullYear(), first.getMonth(), Math.min(dom, last));
                if (d > until) break;
                if (d >= start) out.push(calKey(d));
            }
            return out;
        }
        var every = parseInt(rule.freq.slice(1), 10) || 1;
        var days = (rule.days && rule.days.length ? rule.days : [start.getDay()]).slice().sort(function (a, b) { return ((a + 6) % 7) - ((b + 6) % 7); });
        var monday = new Date(start); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
        for (var w = 0; w < 400 && out.length < 500; w++) {
            var base = new Date(monday); base.setDate(base.getDate() + 7 * every * w);
            if (base > until) break;
            days.forEach(function (wd) { var dd = new Date(base); dd.setDate(dd.getDate() + ((wd + 6) % 7)); if (dd >= start && dd <= until) out.push(calKey(dd)); });
        }
        return out;
    }
    function calShortDate(key) { var d = calParse(key); return d.getDate() + " " + CAL_MONTHS[d.getMonth()]; }
    function calRuleLabel(rule) {
        if (!rule || rule.freq === "1") return "";
        var until = rule.until ? " jusqu'au " + calShortDate(rule.until) : "";
        if (rule.freq === "m1") return "chaque mois" + until;
        var every = parseInt(rule.freq.slice(1), 10) || 1, days = rule.days || [];
        if (every === 1 && days.length === 1) return "tous les " + CAL_DAYS_FULL[days[0]] + "s" + until;
        return (every === 1 ? "chaque semaine" : "toutes les " + every + " semaines") + (days.length ? " (" + days.map(function (d) { return CAL_DAYS_FULL[d] + "s"; }).join(", ") + ")" : "") + until;
    }
    // Programme une session, une fois ou en série. Refuse tout jour passé. rule = { freq, days, until }.
    function calAddPlan(sessionId, key, rule) {
        if (key < calTodayKey()) return { error: "Impossible de programmer dans le passé : les jours passés ne contiennent que les sessions réalisées et enregistrées." };
        rule = rule && rule.freq && rule.freq !== "1" ? { freq: rule.freq, days: rule.days, until: rule.until } : { freq: "1" };
        if (rule.freq !== "1") {
            if (!rule.until || rule.until < key) return { error: "Choisis une date de fin, après le premier jour." };
            var cap = calParse(key); cap.setDate(cap.getDate() + 730); if (calParse(rule.until) > cap) rule.until = calKey(cap); // 2 ans au plus
            if (rule.freq.charAt(0) === "w" && (!rule.days || !rule.days.length)) rule.days = [calParse(key).getDay()];
        }
        var today = calTodayKey(), dates = calOccurrences(key, rule).filter(function (k) { return k >= today; });
        var seriesId = dates.length > 1 ? uid() : null, meta = seriesId ? { freq: rule.freq, days: rule.days || null, until: rule.until } : null;
        var added = 0, dup = 0, lastKey = key;
        dates.forEach(function (kk) {
            if (state.settings.sessionPlan.some(function (x) { return x.date === kk && x.sessionId === sessionId; })) { dup++; return; }
            var entry = { id: uid(), date: kk, sessionId: sessionId, instrumentId: state.activeInstrumentId };
            if (seriesId) { entry.seriesId = seriesId; entry.rule = meta; }
            state.settings.sessionPlan.push(entry);
            added++; lastKey = kk;
        });
        if (added) save();
        return { added: added, dup: dup, series: !!seriesId, last: lastKey, rule: meta };
    }
    // Retire une session programmée ; si elle fait partie d'une série, on demande : seulement celle-ci, les suivantes, ou toute la série.
    function calRemovePlanEntry(entry, anchor, after) {
        function finish() { save(); if (after) after(); }
        function drop(pred) {
            var before = state.settings.sessionPlan.length;
            state.settings.sessionPlan = state.settings.sessionPlan.filter(function (x) { return !pred(x); });
            var n = before - state.settings.sessionPlan.length;
            purgeOrphanEphemerals(state, gsProtectedIds()); // une session éphémère retirée du planning disparaît avec lui
            finish();
            if (n) toastUndo(n > 1 ? n + " séances de « " + gsSessionNameById(entry.sessionId) + " » retirées du calendrier" : "« " + gsSessionNameById(entry.sessionId) + " » retirée du " + calLongDate(entry.date));
        }
        if (!entry.seriesId || !anchor) { drop(function (x) { return x.id === entry.id; }); return; }
        var same = state.settings.sessionPlan.filter(function (x) { return x.seriesId === entry.seriesId; });
        var later = same.filter(function (x) { return x.date >= entry.date; });
        openGsPopover(anchor, function (pop, close) {
            pop.classList.add("cal-series-pop");
            var t = document.createElement("div"); t.className = "ctx-menu-title ctx-menu-title-wrap";
            t.textContent = "« " + gsSessionNameById(entry.sessionId) + " » est répétée" + (entry.rule ? " (" + calRuleLabel(entry.rule) + ")" : "") + ". Que retirer ?";
            pop.appendChild(t);
            function choice(label, fn, muted) {
                var b = document.createElement("button"); b.type = "button"; b.className = "ctx-item" + (muted ? " ctx-item-muted" : ""); b.textContent = label;
                b.addEventListener("click", function () { close(); fn(); });
                pop.appendChild(b);
            }
            choice("Seulement celle du " + calLongDate(entry.date), function () { drop(function (x) { return x.id === entry.id; }); });
            if (later.length > 1 && later.length < same.length) choice("Celle-ci et les suivantes (" + later.length + ")", function () { drop(function (x) { return x.seriesId === entry.seriesId && x.date >= entry.date; }); });
            choice("Toute la série (" + same.length + " séances)", function () { drop(function (x) { return x.seriesId === entry.seriesId; }); });
            choice("Annuler", function () {}, true);
        });
    }
    // Sessions programmées dans les prochains jours (aujourd'hui compris), hors celles déjà réalisées aujourd'hui.
    function calUpcoming(days) {
        var today = calTodayKey(), end = new Date(); end.setDate(end.getDate() + days);
        var endKey = calKey(end), instId = state.activeInstrumentId, doneToday = {};
        logAll().forEach(function (e) { if ((!e.instrumentId || e.instrumentId === instId) && calKey(new Date(e.date)) === today) doneToday[e.sessionId] = true; });
        return state.settings.sessionPlan.filter(function (e) {
            return e.date >= today && e.date <= endKey && (!e.instrumentId || e.instrumentId === instId) && !(e.date === today && doneToday[e.sessionId]);
        }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (gsSessionNameById(a.sessionId) < gsSessionNameById(b.sessionId) ? -1 : 1); });
    }
    function calRelLabel(key) {
        var t = calTodayKey(), tm = calParse(t); tm.setDate(tm.getDate() + 1);
        var long = calLongDate(key);
        return key === t ? "Aujourd'hui · " + long : key === calKey(tm) ? "Demain · " + long : long;
    }
    // Récapitulatif d'une session réalisée : nom, durée totale, exercices et durée de chacun (valeurs figées au jour de la séance).
    function calOpenRecap(anchor, rec) {
        if (!rec) return;
        openGsPopover(anchor, function (pop, close) {
            pop.classList.add("cal-recap");
            var h = document.createElement("div"); h.className = "cal-recap-title"; h.textContent = logRecName(rec);
            var d = new Date(rec.date), p2 = function (n) { return (n < 10 ? "0" : "") + n; };
            var sub = document.createElement("div"); sub.className = "cal-recap-sub"; sub.textContent = calLongDate(calKey(d)) + " · " + p2(d.getHours()) + ":" + p2(d.getMinutes());
            var tot = document.createElement("div"); tot.className = "cal-recap-total";
            var tv = document.createElement("strong"); tv.textContent = gsFmtDur(rec.totalSec || 0);
            tot.appendChild(document.createTextNode("Durée totale : ")); tot.appendChild(tv);
            if (rec.plannedSec) tot.appendChild(document.createTextNode(" (prévu : " + gsFmtDur(rec.plannedSec) + ")"));
            pop.appendChild(h); pop.appendChild(sub);
            if (logRecOldName(rec)) { var was = document.createElement("div"); was.className = "cal-recap-was"; was.textContent = "Nom au moment de la séance : « " + logRecOldName(rec) + " »"; pop.appendChild(was); }
            pop.appendChild(tot);
            var list = document.createElement("div"); list.className = "cal-recap-list";
            (rec.steps || []).forEach(function (st) {
                var r = document.createElement("div"); r.className = "cal-recap-row";
                var n = document.createElement("span"); n.className = "cal-recap-name"; n.textContent = logStepTitle(st);
                var v = document.createElement("span"); v.className = "cal-recap-dur"; v.textContent = gsFmtDur(st.actualSec || 0) + (st.bpmMax ? " · " + st.bpmMax + " BPM" : "");
                r.appendChild(n); r.appendChild(v); list.appendChild(r);
                var live = st.exerciseId ? findExerciseById(st.exerciseId) : null;
                if (live) {
                    bindContextGesture(r, function (x, y) { openExerciseMenu(x, y, live.ex, live.folder, { reveal: true, after: function () { close(); } }); });
                } else if (st.exerciseId) { n.classList.add("cal-recap-gone"); n.title = "Exercice supprimé depuis (nom d'alors)"; }
            });
            if (!(rec.steps || []).length) { var none = document.createElement("div"); none.className = "gs-empty"; none.textContent = "Aucun détail d'exercice enregistré."; list.appendChild(none); }
            pop.appendChild(list);
            var g = gsFindSession(rec.sessionId);
            var acts = document.createElement("div"); acts.className = "cal-recap-actions";
            var editRec = document.createElement("button"); editRec.type = "button"; editRec.className = "btn-ghost cal-recap-open"; editRec.textContent = "✎ Modifier la séance";
            editRec.addEventListener("click", function () { close(); editLoggedRecord(rec, function () { openSessionCalendar({ focusDate: calKey(new Date(rec.date)) }); }); });
            acts.appendChild(editRec); pop.appendChild(acts);
            if (g) {
                acts = document.createElement("div"); acts.className = "cal-recap-actions";
                var open = document.createElement("button"); open.type = "button"; open.className = "btn-ghost cal-recap-open"; open.textContent = "✎ Modifier les exercices de la session";
                open.addEventListener("click", function () { close(); gsOpenSessionEditor(g); });
                acts.appendChild(open); pop.appendChild(acts);
            }
        });
    }

    // Réglage de la répétition : fréquence, jours de la semaine, date de fin.
    function calRuleControls(startKey, opts) {
        opts = opts || {};
        var wrap = document.createElement("div"); wrap.className = "cal-rule";
        var freq = document.createElement("select"); freq.className = "cal-repeat-sel"; freq.setAttribute("aria-label", "Répétition");
        CAL_FREQS.forEach(function (o) { var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; freq.appendChild(op); });
        var daysRow = document.createElement("div"); daysRow.className = "cal-rule-days"; daysRow.hidden = true;
        var untilRow = document.createElement("label"); untilRow.className = "cal-rule-until-row"; untilRow.hidden = true;
        var ul = document.createElement("span"); ul.textContent = "Jusqu'au";
        var until = document.createElement("input"); until.type = "date"; until.className = "cal-rule-until"; until.setAttribute("aria-label", "Répéter jusqu'au");
        untilRow.appendChild(ul); untilRow.appendChild(until);
        var chosen = {}, key = startKey, dayBtns = {};
        [[1, "L", "lundi"], [2, "M", "mardi"], [3, "M", "mercredi"], [4, "J", "jeudi"], [5, "V", "vendredi"], [6, "S", "samedi"], [0, "D", "dimanche"]].forEach(function (d) {
            var b = document.createElement("button"); b.type = "button"; b.className = "cal-rule-day"; b.textContent = d[1]; b.title = d[2]; b.setAttribute("aria-label", d[2]);
            b.addEventListener("click", function () {
                if (chosen[d[0]] && Object.keys(chosen).length === 1) return; // au moins un jour
                if (chosen[d[0]]) delete chosen[d[0]]; else chosen[d[0]] = true;
                paintDays();
            });
            dayBtns[d[0]] = b; daysRow.appendChild(b);
        });
        function paintDays() { Object.keys(dayBtns).forEach(function (k) { var on = !!chosen[k]; dayBtns[k].classList.toggle("active", on); dayBtns[k].setAttribute("aria-pressed", on ? "true" : "false"); }); }
        function refresh() {
            var f = freq.value;
            daysRow.hidden = opts.noDays || f.charAt(0) !== "w";
            untilRow.hidden = f === "1";
            until.min = key;
            if (f !== "1" && (!until.value || until.value < key)) until.value = calDefaultUntil(key, f);
        }
        function setStart(k) { key = k; chosen = {}; chosen[calParse(k).getDay()] = true; paintDays(); refresh(); }
        freq.addEventListener("change", refresh);
        wrap.appendChild(freq); wrap.appendChild(daysRow); wrap.appendChild(untilRow);
        setStart(startKey);
        return {
            el: wrap, setStart: setStart,
            getRule: function () {
                var f = freq.value;
                if (f === "1") return { freq: "1" };
                var days = f.charAt(0) === "w" ? (opts.noDays ? [calParse(key).getDay()] : Object.keys(chosen).map(Number)) : null;
                return { freq: f, days: days, until: until.value };
            }
        };
    }

    // Popover « Ajouter une session » : dossiers (onglets) + filtres (recherche, durée) + liste, puis la répétition.
    function calOpenAddPopover(anchor, key, onAdded) {
        if (key < calTodayKey()) { showToast("Impossible de programmer dans le passé"); return; }
        openGsPopover(anchor, function (pop, close) {
            pop.classList.add("cal-pick-pop");
            var instId = state.activeInstrumentId;
            var tabs = state.settings.sessionFolders.filter(function (f) { return f.instrumentId === instId; });
            var activeTab = "all", dur = "", q = "";
            var title = document.createElement("div"); title.className = "ctx-menu-title ctx-menu-title-wrap"; title.textContent = "Ajouter le " + calLongDate(key);
            pop.appendChild(title);
            var newBtn = document.createElement("button"); newBtn.type = "button"; newBtn.className = "cal-pick-new";
            newBtn.textContent = "＋ Nouvelle session pour ce jour";
            newBtn.title = "Choisis tes exercices un à un : « Session du " + gsEphemeralDateText(key) + " », seulement pour ce jour-là (elle n'est pas gardée dans tes sessions)";
            newBtn.addEventListener("click", function () { close(); gsStartEphemeral(key); });
            pop.appendChild(newBtn);
            var search = document.createElement("input"); search.type = "search"; search.className = "cal-pick-search"; search.placeholder = "Rechercher une session…"; search.setAttribute("aria-label", "Rechercher une session");
            pop.appendChild(search);
            var chipsRow = document.createElement("div"); chipsRow.className = "cal-pick-tabs"; pop.appendChild(chipsRow);
            var durSel = document.createElement("select"); durSel.className = "cal-pick-dur"; durSel.setAttribute("aria-label", "Durée");
            [["", "Toutes durées"], ["30", "≤ 30 min"], ["45", "31 – 45 min"], ["60", "46 – 60 min"], ["61", "> 60 min"]].forEach(function (o) { var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; durSel.appendChild(op); });
            pop.appendChild(durSel);
            var list = document.createElement("div"); list.className = "cal-pick-list"; pop.appendChild(list);
            var repLbl = document.createElement("div"); repLbl.className = "cal-pick-replabel"; repLbl.textContent = "Répétition";
            var ctl = calRuleControls(key);
            pop.appendChild(repLbl); pop.appendChild(ctl.el);
            function inDur(g) { var m = sessionTotalMinutes(g); return !dur || (dur === "30" ? m <= 30 : dur === "45" ? m > 30 && m <= 45 : dur === "60" ? m > 45 && m <= 60 : m > 60); }
            function renderTabs() {
                chipsRow.innerHTML = "";
                [["all", "Tout"]].concat(tabs.map(function (t) { return [t.id, t.name]; })).forEach(function (t) {
                    var b = document.createElement("button"); b.type = "button"; b.className = "cal-pick-chip" + (activeTab === t[0] ? " active" : ""); b.textContent = t[1];
                    b.addEventListener("click", function () { activeTab = t[0]; renderTabs(); renderList(); });
                    chipsRow.appendChild(b);
                });
            }
            function renderList() {
                list.innerHTML = "";
                var items = state.settings.guidedSessions.filter(function (g) {
                    return g.instrumentId === instId && !g.archived && !g.ephemeral && (activeTab === "all" || (g.tabIds || []).indexOf(activeTab) !== -1) && inDur(g) && (!q || g.name.toLowerCase().indexOf(q) !== -1);
                }).sort(function (a, b) { return (b.runCount || 0) - (a.runCount || 0) || a.name.localeCompare(b.name, "fr", { sensitivity: "base" }); });
                if (!items.length) { var none = document.createElement("div"); none.className = "gs-empty"; none.textContent = "Aucune session ne correspond."; list.appendChild(none); return; }
                items.forEach(function (g) {
                    var already = state.settings.sessionPlan.some(function (x) { return x.date === key && x.sessionId === g.id; });
                    var b = document.createElement("button"); b.type = "button"; b.className = "cal-pick-row"; b.disabled = already;
                    var nm = document.createElement("span"); nm.className = "cal-pick-name"; nm.textContent = g.name;
                    var mt = document.createElement("span"); mt.className = "cal-pick-meta"; mt.textContent = already ? "déjà prévue" : g.steps.length + " ex. · " + sessionTotalMinutes(g) + " min";
                    b.appendChild(nm); b.appendChild(mt);
                    b.addEventListener("click", function () {
                        var res = calAddPlan(g.id, key, ctl.getRule());
                        if (res.error) { showToast(res.error, 5000); return; }
                        close();
                        showToast(res.series ? "« " + g.name + " » programmée : " + res.added + " séances, " + calRuleLabel(res.rule) : "« " + g.name + " » programmée le " + calLongDate(key));
                        if (onAdded) onAdded(res);
                    });
                    list.appendChild(b);
                });
            }
            search.addEventListener("input", function () { q = search.value.trim().toLowerCase(); renderList(); });
            durSel.addEventListener("change", function () { dur = durSel.value; renderList(); });
            renderTabs(); renderList();
            setTimeout(function () { try { search.focus(); } catch (e) {} }, 30);
        });
    }

    // Poignées de redimensionnement (bord droit, bord bas, coin) : élargir ou réduire à volonté ; taille retenue.
    function attachResizeGrips(panel, kind) {
        function grip(cls, dx, dy) {
            var g = document.createElement("div"); g.className = "panel-grip " + cls; panel.appendChild(g);
            g.addEventListener("pointerdown", function (e) {
                e.preventDefault(); e.stopPropagation();
                panel.dataset.userSized = "1";
                var r = panel.getBoundingClientRect(), sx = e.clientX, sy = e.clientY, sw = r.width, sh = r.height;
                try { g.setPointerCapture(e.pointerId); } catch (err) {}
                function mv(ev) {
                    // la fenêtre grandit à volonté ; si elle atteint le bord de l'écran, elle se décale au lieu de déborder
                    if (dx) {
                        var w = Math.min(window.innerWidth - 16, Math.max(320, sw + ev.clientX - sx)), l = parseFloat(panel.style.left) || r.left;
                        panel.style.width = w + "px";
                        if (l + w > window.innerWidth - 8) panel.style.left = Math.max(8, window.innerWidth - 8 - w) + "px";
                    }
                    if (dy) {
                        var hh = Math.min(window.innerHeight - 16, Math.max(280, sh + ev.clientY - sy)), tp = parseFloat(panel.style.top) || r.top;
                        panel.style.height = hh + "px";
                        if (tp + hh > window.innerHeight - 8) panel.style.top = Math.max(8, window.innerHeight - 8 - hh) + "px";
                    }
                    panel.style.minWidth = "320px"; panel.style.minHeight = "280px";
                }
                function up() { g.removeEventListener("pointermove", mv); g.removeEventListener("pointerup", up); g.removeEventListener("pointercancel", up); savePanelSize(kind, panel.offsetWidth, panel.offsetHeight); }
                g.addEventListener("pointermove", mv); g.addEventListener("pointerup", up); g.addEventListener("pointercancel", up);
            });
        }
        grip("panel-grip-e", true, false); grip("panel-grip-s", false, true); grip("panel-grip-se", true, true);
        // la fenêtre défile : les poignées restent collées aux bords visibles
        panel.addEventListener("scroll", function () { panel.style.setProperty("--gx", panel.scrollLeft + "px"); panel.style.setProperty("--gy", panel.scrollTop + "px"); });
    }

    function openSessionCalendar(opts) {
        opts = opts || {};
        if (calPurgePast()) save();
        openModal("gs-cal-panel", function (panel, close) {
            var todayKey = calTodayKey(), today = calParse(todayKey);
            var focus = opts.focusDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.focusDate) ? opts.focusDate : null;
            var cur = focus ? new Date(calParse(focus).getFullYear(), calParse(focus).getMonth(), 1) : new Date(today.getFullYear(), today.getMonth(), 1);
            var selected = focus || todayKey;
            var pickSession = opts.sessionId || null; // mode « choisis le(s) jour(s) » (depuis le clic droit sur une session)
            var pickCtl = null;
            var title = document.createElement("div");
            title.className = "backups-title";
            title.textContent = "Calendrier des sessions";
            panel.appendChild(title);
            var errBox = document.createElement("div"); errBox.className = "cal-error"; errBox.hidden = true; errBox.setAttribute("role", "alert");
            var errTimer = null;
            function showError(msg) { errBox.textContent = msg; errBox.hidden = false; clearTimeout(errTimer); errTimer = setTimeout(function () { errBox.hidden = true; }, 5000); }
            var pickBar = document.createElement("div"); pickBar.className = "cal-pickbar"; panel.appendChild(pickBar);
            panel.appendChild(errBox);
            var nav = document.createElement("div");
            nav.className = "cal-nav";
            function navBtn(txt, ttl, cls) { var b = document.createElement("button"); b.type = "button"; b.className = cls || "cal-nav-btn"; b.textContent = txt; b.title = ttl; b.setAttribute("aria-label", ttl); return b; }
            var undoB = navBtn("", "Annuler (Ctrl+Z)", "cal-nav-btn cal-undo-btn"); undoB.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>';
            var redoB = navBtn("", "Rétablir (Ctrl+Y)", "cal-nav-btn cal-redo-btn"); redoB.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/></svg>';
            var prev = navBtn("‹", "Mois précédent"), next = navBtn("›", "Mois suivant");
            var monthLbl = document.createElement("div"); monthLbl.className = "cal-month";
            var todayBtn = navBtn("Aujourd'hui", "Revenir à aujourd'hui", "cal-today-btn");
            nav.appendChild(undoB); nav.appendChild(redoB); nav.appendChild(prev); nav.appendChild(monthLbl); nav.appendChild(next); nav.appendChild(todayBtn);
            panel.appendChild(nav);
            var grid = document.createElement("div"); grid.className = "cal-grid"; panel.appendChild(grid);
            var detail = document.createElement("div"); detail.className = "cal-detail"; panel.appendChild(detail);
            attachResizeGrips(panel, "gs-cal-panel");

            function refreshUndo() { undoB.disabled = historyIndex <= 0; redoB.disabled = historyIndex < 0 || historyIndex >= historyStack.length - 1; }
            function refreshAll() { calPurgePast(); renderPickBar(); renderGrid(); renderDetail(); refreshUndo(); }
            function renderPickBar() {
                pickBar.innerHTML = ""; pickBar.hidden = !pickSession;
                if (!pickSession) { pickCtl = null; return; }
                var t = document.createElement("span"); t.className = "cal-pickbar-txt"; t.textContent = "Choisis le ou les jours pour « " + gsSessionNameById(pickSession) + " »";
                pickCtl = pickCtl || calRuleControls(todayKey, { noDays: true });
                var done = document.createElement("button"); done.type = "button"; done.className = "btn-accent cal-pick-done"; done.textContent = "Terminer";
                done.addEventListener("click", function () { pickSession = null; renderPickBar(); renderGrid(); });
                pickBar.appendChild(t); pickBar.appendChild(pickCtl.el); pickBar.appendChild(done);
            }
            function addTo(key, sessionId, rule) {
                var res = calAddPlan(sessionId, key, rule);
                if (res.error) { showError(res.error); return res; }
                showToast(res.added ? (res.series ? "« " + gsSessionNameById(sessionId) + " » programmée : " + res.added + " séances, " + calRuleLabel(res.rule) : "« " + gsSessionNameById(sessionId) + " » programmée le " + calLongDate(key)) : "Déjà programmée ce jour-là");
                refreshAll();
                return res;
            }
            function copyToNextWeek(key) {
                var it = calDayItems(key), n = 0, d = calParse(key); d.setDate(d.getDate() + 7);
                it.planned.forEach(function (e) {
                    var sess = gsFindSession(e.sessionId), sid = e.sessionId;
                    if (sess && sess.ephemeral) sid = gsCloneEphemeralTo(sess, calKey(d)).id; // éphémère : une copie propre à l'autre jour
                    var r = calAddPlan(sid, calKey(d), { freq: "1" }); n += r.added || 0;
                });
                showToast(n ? n + " session" + (n > 1 ? "s copiée" + "s" : " copiée") + " sur le " + calLongDate(calKey(d)) : "Rien à copier (déjà présent)");
                refreshAll();
            }
            function openDayMenu(x, y, key, cell) {
                var it = calDayItems(key), past = key < todayKey, items = [];
                if (!past) items.push({ label: "＋ Nouvelle session pour ce jour…", open: function () { gsStartEphemeral(key); } });
                if (!past) items.push({ label: "＋ Ajouter une session…", open: function () { selected = key; renderGrid(); renderDetail(); calOpenAddPopover(grid.querySelector('.cal-cell[data-key="' + key + '"]') || cell, key, refreshAll); } });
                it.done.forEach(function (rec) {
                    items.push({ label: "Voir « " + logRecName(rec) + " » (récapitulatif)", open: function () { selected = key; renderGrid(); renderDetail(); calOpenRecap(grid.querySelector('.cal-cell[data-key="' + key + '"]') || cell, rec); } });
                    var g = gsFindSession(rec.sessionId);
                    if (g && !it.planned.some(function (e) { return e.sessionId === g.id; })) items.push({ label: "✎ Modifier les exercices de « " + g.name + " »", open: function () { gsOpenSessionEditor(g); } });
                });
                it.planned.forEach(function (e) {
                    var sess = gsFindSession(e.sessionId), nm = gsSessionNameById(e.sessionId);
                    if (key === todayKey && sess && sess.steps.length) items.push({ label: "▶ Lancer « " + nm + " »", open: function () { close(); gsStartRun(sess); } });
                    if (sess) items.push({ label: "✎ Modifier les exercices de « " + nm + " »", open: function () { gsOpenSessionEditor(sess); } });
                    if (sess) items.push({ label: gsNameActionLabel(sess, nm), open: function () { gsRenameSession(sess, refreshAll); } });
                    items.push({ label: "✕ Retirer « " + nm + " »" + (e.seriesId ? " (série)" : ""), open: function () { calRemovePlanEntry(e, grid.querySelector('.cal-cell[data-key="' + key + '"]') || cell, refreshAll); } });
                });
                if (it.planned.length > 1) items.push({ label: "✕ Retirer toutes les sessions de ce jour", open: function () {
                    var n = it.planned.length;
                    state.settings.sessionPlan = state.settings.sessionPlan.filter(function (e) { return !(e.date === key && (!e.instrumentId || e.instrumentId === state.activeInstrumentId)); });
                    purgeOrphanEphemerals(state, gsProtectedIds());
                    save(); refreshAll();
                    toastUndo(n + " sessions retirées du " + calLongDate(key));
                } });
                if (!past && it.planned.length) items.push({ label: "Copier ce jour sur la semaine suivante", open: function () { copyToNextWeek(key); } });
                items.push({ label: "Aller à aujourd'hui", open: function () { cur = new Date(today.getFullYear(), today.getMonth(), 1); selected = todayKey; renderGrid(); renderDetail(); } });
                openLinksQuickMenu(x, y, items);
            }
            function renderGrid() {
                monthLbl.textContent = CAL_MONTHS[cur.getMonth()] + " " + cur.getFullYear();
                grid.innerHTML = "";
                CAL_DAYS.forEach(function (n) { var h = document.createElement("div"); h.className = "cal-dow"; h.textContent = n; grid.appendChild(h); });
                var first = new Date(cur.getFullYear(), cur.getMonth(), 1);
                var offset = (first.getDay() + 6) % 7; // semaine commençant le lundi
                var start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
                for (var i = 0; i < 42; i++) {
                    (function (d) {
                        var key = calKey(d), it = calDayItems(key), past = key < todayKey;
                        var cell = document.createElement("button");
                        cell.type = "button";
                        cell.dataset.key = key;
                        cell.className = "cal-cell" + (d.getMonth() !== cur.getMonth() ? " cal-out" : "") + (key === todayKey ? " cal-today" : "") + (key === selected ? " cal-selected" : "") + (past ? " cal-past" : "");
                        cell.setAttribute("aria-label", d.getDate() + " " + CAL_MONTHS[d.getMonth()]);
                        var names = it.planned.map(function (e) { return (e.seriesId ? "↻ " : "") + gsSessionNameById(e.sessionId); }).concat(it.done.map(function (e) { return "✓ " + logRecName(e); }));
                        if (names.length) cell.title = names.join("\n");
                        var num = document.createElement("span"); num.className = "cal-num"; num.textContent = String(d.getDate()); cell.appendChild(num);
                        var chips = document.createElement("span"); chips.className = "cal-chips";
                        it.planned.forEach(function (e) { var c = document.createElement("span"); var es = gsFindSession(e.sessionId); c.className = "cal-chip cal-chip-plan" + (es && es.ephemeral ? " cal-chip-eph" : ""); c.textContent = (e.seriesId ? "↻ " : "") + gsSessionNameById(e.sessionId); chips.appendChild(c); });
                        it.done.forEach(function (e) { var c = document.createElement("span"); c.className = "cal-chip cal-chip-done" + (gsIsEphemeralRec(e) ? " cal-chip-eph" : ""); c.dataset.rec = e.id; c.textContent = "✓ " + logRecName(e); chips.appendChild(c); });
                        cell.appendChild(chips);
                        var dots = document.createElement("span"); dots.className = "cal-dots";
                        it.planned.forEach(function (e) { var dt = document.createElement("i"); dt.className = "cal-dot cal-dot-plan" + (gsIsEphemeralId(e.sessionId) ? " cal-dot-eph" : ""); dots.appendChild(dt); });
                        it.done.forEach(function (e) { var dt = document.createElement("i"); dt.className = "cal-dot cal-dot-done" + (gsIsEphemeralRec(e) ? " cal-dot-eph" : ""); dots.appendChild(dt); });
                        cell.appendChild(dots);
                        cell.addEventListener("click", function (ev) {
                            var chipEl = ev.target && ev.target.closest ? ev.target.closest(".cal-chip-done") : null, recId = chipEl && chipEl.dataset ? chipEl.dataset.rec : null;
                            selected = key;
                            if (d.getMonth() !== cur.getMonth()) cur = new Date(d.getFullYear(), d.getMonth(), 1);
                            if (pickSession) { pickCtl.setStart(key); addTo(key, pickSession, pickCtl.getRule()); return; }
                            renderGrid(); renderDetail();
                            var fresh = grid.querySelector('.cal-cell[data-key="' + key + '"]') || cell, now = calDayItems(key);
                            if (recId) { // clic sur une session terminée : récapitulatif
                                var rec = now.done.filter(function (x) { return x.id === recId; })[0];
                                calOpenRecap(fresh.querySelector('.cal-chip-done[data-rec="' + recId + '"]') || fresh, rec);
                                return;
                            }
                            if (past) { if (now.done.length === 1) calOpenRecap(fresh, now.done[0]); return; } // jour passé : rien à programmer
                            calOpenAddPopover(fresh, key, refreshAll); // « ajouter une session ? » dès le clic sur un jour
                        });
                        bindContextGesture(cell, function (x, y) { selected = key; renderGrid(); renderDetail(); openDayMenu(x, y, key, grid.querySelector('.cal-cell[data-key="' + key + '"]') || cell); });
                        grid.appendChild(cell);
                    })(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
                }
            }
            function renderDetail() {
                detail.innerHTML = "";
                var it = calDayItems(selected), past = selected < todayKey;
                var h = document.createElement("div"); h.className = "cal-detail-title"; h.textContent = calLongDate(selected);
                detail.appendChild(h);
                it.planned.forEach(function (e) {
                    var r = document.createElement("div"); r.className = "cal-item cal-item-plan" + (gsIsEphemeralId(e.sessionId) ? " cal-item-eph-row" : "");
                    var nm = document.createElement("span"); nm.className = "cal-item-name"; nm.textContent = gsSessionNameById(e.sessionId);
                    r.appendChild(nm);
                    if (e.seriesId) { var rep = document.createElement("span"); rep.className = "cal-item-rep"; rep.textContent = "↻ " + calRuleLabel(e.rule); rep.title = "Session répétée"; r.appendChild(rep); }
                    var sess = state.settings.guidedSessions.filter(function (x) { return x.id === e.sessionId; })[0];
                    if (sess) { var mt = document.createElement("span"); mt.className = "cal-item-meta"; mt.textContent = "prévu " + sessionTotalMinutes(sess) + " min"; r.appendChild(mt); }
                    if (selected === todayKey && sess && sess.steps.length) r.appendChild(svgIconButton(METRO_PLAY_ICON_SVG, "Lancer cette session maintenant", function () { close(); gsStartRun(sess); }));
                    if (sess) { var ed = iconButton("✎", "Modifier les exercices de cette session", function () { gsOpenSessionEditor(sess); }); ed.classList.add("cal-item-edit"); r.appendChild(ed); }
                    var rm = iconButton("✕", e.seriesId ? "Retirer du planning (cette session ou toute la série)" : "Retirer du planning", function () { calRemovePlanEntry(e, rm, refreshAll); });
                    r.appendChild(rm);
                    bindContextGesture(r, function (x, y) {
                        var its = [];
                        if (selected === todayKey && sess && sess.steps.length) its.push({ label: "▶ Lancer maintenant", open: function () { close(); gsStartRun(sess); } });
                        if (sess) its.push({ label: "✎ Modifier les exercices", open: function () { gsOpenSessionEditor(sess); } });
                        if (sess) its.push({ label: sess.ephemeral ? "Enregistrer dans mes sessions…" : "Renommer…", open: function () { gsRenameSession(sess, refreshAll); } });
                        its.push({ label: "✕ Retirer du planning" + (e.seriesId ? " (série)" : ""), open: function () { calRemovePlanEntry(e, rm, refreshAll); } });
                        openLinksQuickMenu(x, y, its);
                    });
                    detail.appendChild(r);
                });
                it.done.forEach(function (e) {
                    var r = document.createElement("div"); r.className = "cal-item cal-item-done" + (gsIsEphemeralRec(e) ? " cal-item-eph-row" : ""); r.tabIndex = 0; r.title = "Voir le récapitulatif de la session";
                    var nm = document.createElement("span"); nm.className = "cal-item-name"; nm.textContent = "✓ " + logRecName(e);
                    var du = document.createElement("span"); du.className = "cal-item-meta"; du.textContent = "réel " + gsFmtDur(e.totalSec) + (e.plannedSec ? " / prévu " + gsFmtDur(e.plannedSec) : "");
                    r.appendChild(nm); r.appendChild(du);
                    r.addEventListener("click", function () { calOpenRecap(r, e); });
                    bindContextGesture(r, function (x, y) {
                        var g = gsFindSession(e.sessionId), its = [{ label: "Voir le récapitulatif", open: function () { calOpenRecap(r, e); } }];
                        if (g) its.push({ label: "✎ Modifier les exercices de « " + g.name + " »", open: function () { gsOpenSessionEditor(g); } });
                        if (g) its.push({ label: "Renommer la session…", open: function () { gsRenameSession(g, refreshAll); } });
                        openLinksQuickMenu(x, y, its);
                    });
                    r.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); calOpenRecap(r, e); } });
                    detail.appendChild(r);
                });
                if (!it.planned.length && !it.done.length) { var none = document.createElement("div"); none.className = "gs-empty"; none.textContent = past ? "Aucune session réalisée ce jour-là." : "Rien de prévu ce jour-là."; detail.appendChild(none); }
            }
            prev.addEventListener("click", function () { cur = new Date(cur.getFullYear(), cur.getMonth() - 1, 1); renderGrid(); });
            next.addEventListener("click", function () { cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1); renderGrid(); });
            todayBtn.addEventListener("click", function () { cur = new Date(today.getFullYear(), today.getMonth(), 1); selected = todayKey; renderGrid(); renderDetail(); });
            undoB.addEventListener("click", function () { undo(); });
            redoB.addEventListener("click", function () { redo(); });
            historyListeners.push(refreshAll);
            renderPickBar(); renderGrid(); renderDetail(); refreshUndo();
            return function onClose() { historyListeners = historyListeners.filter(function (fn) { return fn !== refreshAll; }); };
        });
    }

    // ---------- statistiques d'entraînement (calculées à partir du journal) ----------
    // Principe : chaque séance enregistrée garde, FIGÉS, le titre, le chemin et les identifiants de ses exercices.
    // Les statistiques s'appuient sur ces valeurs, pas sur l'état actuel de tes dossiers. L'état actuel ne sert
    // qu'à AFFICHER les noms à jour (un exercice ou un chapitre renommé apparaît sous son nouveau nom) et à
    // repérer ce qui est ambigu (exercice déplacé dans un autre chapitre, supprimé, recréé, en double) :
    // l'appli le propose alors dans « À ranger » au lieu de deviner.
    var STATS_IGNORE = "__ignore__";
    var STATS_DAY = 86400000;
    function statsRules() { return normalizeStatsRules(state); }
    function normalizeStatsRules(st) {
        var r = st.settings.statsRules;
        if (!r || typeof r !== "object") r = st.settings.statsRules = {};
        if (!r.alias || typeof r.alias !== "object") r.alias = {};             // ancien id d'exercice -> id de l'exercice regroupé
        if (!r.chapterOf || typeof r.chapterOf !== "object") r.chapterOf = {}; // id d'exercice -> id de chapitre (ou STATS_IGNORE)
        if (!r.resolved || typeof r.resolved !== "object") r.resolved = {};    // questions déjà tranchées
        if (["ask", "history", "follow"].indexOf(r.movePolicy) === -1) r.movePolicy = "ask";
        return r;
    }
    function statsNorm(t) { return String(t || "").replace(/\s*\(copie\)\s*$/i, "").trim().toLowerCase(); }

    // État actuel utile aux statistiques : exercices et chapitres existants, exercices à la corbeille.
    function statsContext() {
        var ex = {}, chapters = {}, inTrash = {}, folders = {};
        function walkFolders(list) { (list || []).forEach(function (f) { folders[f.id] = { id: f.id, name: f.name }; walkFolders(f.folders); }); }
        state.instruments.forEach(function (inst) {
            walkFolders(inst.categories);
            inst.categories.forEach(function (c) { chapters[c.id] = { id: c.id, name: c.name, color: c.color || null, instrumentId: inst.id }; });
            collectExercises(inst, function () { return true; }).forEach(function (r) { ex[r.ex.id] = { ex: r.ex, pathIds: r.pathIds, pathNames: r.pathNames, instrumentId: inst.id }; });
        });
        (state.settings.trash || []).forEach(function (t) {
            if (t.type === "exercise" && t.data) inTrash[t.data.id] = true;
            else if (t.type === "folder" && t.data) (function w(f) { (f.exercises || []).forEach(function (e) { inTrash[e.id] = true; }); (f.folders || []).forEach(w); })(t.data);
        });
        return { ex: ex, chapters: chapters, folders: folders, inTrash: inTrash, rules: statsRules() };
    }

    // Une ligne par exercice travaillé dans une séance, avec le rangement retenu pour les statistiques.
    function chapterKeyOf(chapId, frozenName) { return chapId || ("n:" + frozenName); }
    function statsRows(log, ctx) {
        var rows = [], rules = ctx.rules;
        log.forEach(function (rec) {
            (rec.steps || []).forEach(function (st) {
                var id0 = st.exerciseId || null, id = id0, guard = 0;
                while (id && rules.alias[id] && guard++ < 8) id = rules.alias[id];
                var live = id ? ctx.ex[id] : null;
                var ov = id && rules.chapterOf[id];
                if (ov === STATS_IGNORE) return; // exercice écarté des statistiques
                var frozenId = st.chapterId || (st.pathIds && st.pathIds[0]) || null;
                var frozenName = st.chapterName || (st.path && st.path[0]) || "Autre";
                var chapId = null;
                if (ov && ctx.chapters[ov]) chapId = ov;
                else if (live && rules.movePolicy === "follow") chapId = live.pathIds[0];
                else if (frozenId && ctx.chapters[frozenId]) chapId = frozenId;
                else if (live && !frozenId && live.pathNames[0] === frozenName) chapId = live.pathIds[0]; // ancien enregistrement sans identifiant : même nom qu'aujourd'hui
                var chap = chapId ? ctx.chapters[chapId] : null;
                // premier sous-dossier : celui d'alors (figé) ; celui d'aujourd'hui si le chapitre a été imposé ou suivi
                var imposed = !!((ov && ctx.chapters[ov]) || (live && rules.movePolicy === "follow")), subId = null, subName = null;
                if (imposed) { if (live) { subId = live.pathIds[1] || null; subName = live.pathNames[1] || null; } }
                else { subId = (st.pathIds && st.pathIds[1]) || null; subName = (st.path && st.path[1]) || null; }
                if (subId && ctx.folders[subId]) subName = ctx.folders[subId].name; // renommé depuis : nom actuel
                rows.push({
                    rec: rec, date: rec.date,
                    exKey: id || ("t:" + (st.title || "?")),
                    title: live ? live.ex.title : (st.title || "(sans titre)"),
                    frozenTitle: st.title || "(sans titre)",
                    chapterId: chapId,
                    chapterKey: chapId || ("n:" + frozenName),
                    chapterName: chap ? chap.name : frozenName,
                    chapterColor: chap ? chap.color : null,
                    frozenChapterName: frozenName,
                    sec: st.actualSec || 0,
                    plannedSec: (st.plannedMin || 0) * 60,
                    subKey: subName ? (subId || "n:" + chapterKeyOf(chapId, frozenName) + "|" + subName) : null,
                    subName: subName,
                    bpmFirst: st.bpmFirst || null, bpmMax: st.bpmMax || null, bpmEnd: st.bpmEnd || null
                });
            });
        });
        return rows;
    }

    // Ce que l'appli ne peut pas trancher seule.
    function statsIssues(rows, ctx) {
        var rules = ctx.rules, byEx = {}, issues = [];
        rows.forEach(function (r) {
            if (r.exKey.indexOf("t:") === 0) return;
            var o = byEx[r.exKey] || (byEx[r.exKey] = { rows: [], sec: 0 });
            o.rows.push(r); o.sec += r.sec;
        });
        function chapName(id) { var c = ctx.chapters[id]; return c ? c.name : "?"; }
        var liveByTitle = {};
        Object.keys(ctx.ex).forEach(function (id) { var k = statsNorm(ctx.ex[id].ex.title); if (k) (liveByTitle[k] = liveByTitle[k] || []).push(id); });
        Object.keys(byEx).forEach(function (id) {
            var o = byEx[id], live = ctx.ex[id], last = o.rows[o.rows.length - 1];
            if (rules.chapterOf[id]) return; // déjà rangé à la main
            if (live) {
                var liveChap = live.pathIds[0], key = "moved:" + id + ":" + liveChap;
                var off = o.rows.filter(function (r) { return r.chapterId !== liveChap; });
                if (off.length && !rules.resolved[key] && rules.movePolicy === "ask") {
                    var from = {}; off.forEach(function (r) { from[r.chapterName] = true; });
                    issues.push({ kind: "moved", key: key, exId: id, title: live.ex.title, from: Object.keys(from), to: chapName(liveChap), toId: liveChap, count: off.length, sec: off.reduce(function (a, r) { return a + r.sec; }, 0) });
                }
            } else if (!ctx.inTrash[id]) {
                var key2 = "gone:" + id;
                if (rules.resolved[key2]) return;
                var twins = (liveByTitle[statsNorm(last.frozenTitle)] || []).filter(function (t) { return t !== id; });
                var lost = o.rows.every(function (r) { return !r.chapterId; });
                if (twins.length) issues.push({ kind: "recreated", key: key2, exId: id, title: last.frozenTitle, twinId: twins[0], twinPath: ctx.ex[twins[0]].pathNames.join(" › "), count: o.rows.length, sec: o.sec });
                else if (lost) issues.push({ kind: "orphan", key: key2, exId: id, title: last.frozenTitle, chapterName: last.frozenChapterName, count: o.rows.length, sec: o.sec });
            }
        });
        var groups = {};
        Object.keys(byEx).forEach(function (id) {
            if (!ctx.ex[id]) return;
            var k = statsNorm(ctx.ex[id].ex.title);
            (groups[k] = groups[k] || []).push(id);
        });
        Object.keys(groups).forEach(function (k) {
            var ids = groups[k];
            if (ids.length < 2) return;
            ids.sort(function (a, b) { return byEx[b].rows.length - byEx[a].rows.length || (a < b ? -1 : 1); });
            var key = "dup:" + ids.slice().sort().join(",");
            if (rules.resolved[key]) return;
            issues.push({ kind: "dup", key: key, ids: ids, title: ctx.ex[ids[0]].ex.title, paths: ids.map(function (id) { return "« " + ctx.ex[id].ex.title + " » (" + ctx.ex[id].pathNames.join(" › ") + ")"; }) });
        });
        return issues;
    }
    function statsIssueCount() {
        var ctx = statsContext();
        var log = logAll().filter(function (e) { return !e.instrumentId || e.instrumentId === state.activeInstrumentId; });
        return log.length ? statsIssues(statsRows(log, ctx), ctx).length : 0;
    }

    function gsFmtMin(sec) { var m = Math.round(sec / 60); return m >= 60 ? Math.floor(m / 60) + " h " + (m % 60 < 10 ? "0" : "") + (m % 60) : m + " min"; }
    function gsFmtAgo(ts, now) {
        if (!ts) return "jamais";
        var d = Math.floor((now - ts) / 86400000);
        return d <= 0 ? "aujourd'hui" : d === 1 ? "hier" : "il y a " + d + " j";
    }
    function gsStatsSparkline(pts) {
        var w = 90, h = 24, vals = pts.map(function (p) { return p.bpm; });
        var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), span = Math.max(1, mx - mn);
        var d = vals.map(function (v, i) { return (vals.length === 1 ? w / 2 : i * (w - 4) / (vals.length - 1) + 2).toFixed(1) + "," + (h - 3 - (v - mn) * (h - 6) / span).toFixed(1); }).join(" ");
        return '<svg class="gs-spark" viewBox="0 0 ' + w + " " + h + '" width="' + w + '" height="' + h + '" aria-hidden="true"><polyline points="' + d + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>';
    }

    // Agrégats d'une période (days = 0 : tout).
    function statsCompute(log, rows, ctx, range, now) {
        var start = range.start, end = range.end;
        var recs = log.filter(function (r) { return r.date >= start && r.date < end; });
        var rws = rows.filter(function (r) { return r.date >= start && r.date < end; });
        var totalSec = 0, plannedSum = 0, realOfPlanned = 0, dayMap = {};
        recs.forEach(function (r) {
            totalSec += r.totalSec || 0;
            if (r.plannedSec) { plannedSum += r.plannedSec; realOfPlanned += r.totalSec || 0; }
        });
        log.forEach(function (r) { var k = calKey(new Date(r.date)); dayMap[k] = (dayMap[k] || 0) + (r.totalSec || 0); });
        var periodMap = {};
        recs.forEach(function (r) { periodMap[calKey(new Date(r.date))] = true; });
        var first = log.length ? log[0].date : now;
        var periodDays = Math.max(1, Math.ceil((Math.min(end, now + 1) - 1 - (start || first)) / STATS_DAY));
        // chapitres, exercices
        var chap = {}, byEx = {}, allEx = {};
        rows.forEach(function (r) { var o = allEx[r.exKey] || (allEx[r.exKey] = { last: 0 }); if (r.date > o.last) o.last = r.date; });
        rws.forEach(function (r) {
            var c = chap[r.chapterKey] || (chap[r.chapterKey] = { key: r.chapterKey, name: r.chapterName, color: r.chapterColor, sec: 0 });
            c.sec += r.sec; c.name = r.chapterName; if (r.chapterColor) c.color = r.chapterColor;
            var o = byEx[r.exKey] || (byEx[r.exKey] = { key: r.exKey, title: r.title, sec: 0, count: 0, last: 0 });
            o.sec += r.sec; o.count++; o.title = r.title; if (r.date > o.last) o.last = r.date;
        });
        var chapSum = 0; Object.keys(chap).forEach(function (k) { chapSum += chap[k].sec; });
        var chapters = Object.keys(chap).map(function (k) { var c = chap[k]; c.pct = chapSum ? Math.round(c.sec * 100 / chapSum) : 0; return c; }).sort(function (a, b) { return b.sec - a.sec; });
        var top = Object.keys(byEx).map(function (k) { return byEx[k]; }).sort(function (a, b) { return b.sec - a.sec; });
        var mine = Object.keys(ctx.ex).filter(function (id) { return ctx.ex[id].instrumentId === state.activeInstrumentId && !ctx.ex[id].ex.archived && !ctx.rules.alias[id]; });
        var favorites = mine.filter(function (id) { return ctx.ex[id].ex.favorite; }).map(function (id) {
            var o = byEx[id]; return { id: id, title: ctx.ex[id].ex.title, sec: o ? o.sec : 0, count: o ? o.count : 0, last: (allEx[id] || {}).last || 0 };
        }).sort(function (a, b) { return b.sec - a.sec; });
        var underused = mine.filter(function (id) { return !byEx[id]; }).map(function (id) {
            return { id: id, title: ctx.ex[id].ex.title, last: (allEx[id] || {}).last || 0, path: ctx.ex[id].pathNames.join(" › ") };
        }).sort(function (a, b) { return a.last - b.last; });
        return {
            recs: recs, sessions: recs.length, totalSec: totalSec, activeDays: Object.keys(periodMap).length, periodDays: periodDays,
            avgPerWeekSec: totalSec / (periodDays / 7), avgSessionSec: recs.length ? totalSec / recs.length : 0,
            ratio: plannedSum ? realOfPlanned / plannedSum : null, dayMap: dayMap,
            chapters: chapters, top: top, favorites: favorites, underused: underused
        };
    }

    // ---- graphiques en SVG (aucune bibliothèque) ----
    var SVGNS = "http://www.w3.org/2000/svg";
    function svgNode(tag, attrs, parent, text) {
        var n = document.createElementNS(SVGNS, tag);
        Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
        if (text !== undefined && text !== null) n.textContent = text;
        if (parent) parent.appendChild(n);
        return n;
    }
    function svgTip(node, text) { svgNode("title", {}, node, text); return node; }
    function statsNiceMax(v) {
        if (v <= 0) return 1;
        var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10)), f = v / p;
        return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
    }
    function statsNum(v) { return String(Math.round(v * 10) / 10).replace(".", ","); }
    function statsShortDate(ts) { var d = new Date(ts); return d.getDate() + "/" + (d.getMonth() + 1); }
    var STATS_MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

    // Temps de pratique par jour (période courte), par semaine ou par mois (longue).
    function statsBuckets(recs, range, now, firstTs) {
        var first = range.start || firstTs || (recs.length ? recs[0].date : now), last = Math.min(range.end - 1, now);
        var span = Math.ceil((last - first) / STATS_DAY), mode = span <= 35 ? "day" : span <= 400 ? "week" : "month";
        function startOf(ts) {
            var d = new Date(ts); d.setHours(0, 0, 0, 0);
            if (mode === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
            else if (mode === "month") d.setDate(1);
            return d;
        }
        function nextOf(d) { var n = new Date(d); if (mode === "day") n.setDate(n.getDate() + 1); else if (mode === "week") n.setDate(n.getDate() + 7); else n.setMonth(n.getMonth() + 1); return n; }
        var map = {}, order = [], nowKey = startOf(now).getTime(), cur = -1;
        for (var d = startOf(first); d.getTime() <= last; d = nextOf(d)) { var k = d.getTime(); if (k === nowKey) cur = order.length; order.push(k); map[k] = { t: k, sec: 0, n: 0 }; }
        recs.forEach(function (r) { var k = startOf(r.date).getTime(); if (map[k]) { map[k].sec += r.totalSec || 0; map[k].n++; } });
        return { mode: mode, cur: cur, items: order.map(function (k) { return map[k]; }) };
    }
    function statsBarChart(bk) {
        var items = bk.items, mode = bk.mode, W = 600, H = 190, L = 44, R = 66, T = 10, B = 26; // marge droite : étiquette de la moyenne
        var svg = svgNode("svg", { viewBox: "0 0 " + W + " " + H, "class": "st-chart st-bars", role: "img", "aria-label": "Temps de pratique par " + (mode === "day" ? "jour" : mode === "week" ? "semaine" : "mois") });
        var maxSec = 60; items.forEach(function (i) { if (i.sec > maxSec) maxSec = i.sec; });
        var hours = maxSec >= 3 * 3600, unit = hours ? 3600 : 60, top = statsNiceMax(maxSec / unit);
        var plotW = W - L - R, plotH = H - T - B, n = items.length;
        for (var g = 0; g <= 4; g++) {
            var y = T + plotH - plotH * g / 4;
            svgNode("line", { x1: L, x2: W - R, y1: y, y2: y, "class": "st-grid" }, svg);
            svgNode("text", { x: L - 6, y: y + 3.5, "class": "st-axis", "text-anchor": "end" }, svg, statsNum(top * g / 4) + (hours ? " h" : " min"));
        }
        var bw = plotW / n, barW = Math.max(2, Math.min(28, bw * 0.68)), every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 52))));
        var sum = 0; items.forEach(function (i) { sum += i.sec; });
        var avgSec = n ? sum / n : 0;
        items.forEach(function (it, i) {
            var x = L + i * bw + (bw - barW) / 2, h = it.sec / unit / top * plotH;
            var d = new Date(it.t);
            var label = mode === "month" ? STATS_MONTHS_SHORT[d.getMonth()] + " " + String(d.getFullYear()).slice(2) : statsShortDate(it.t);
            var current = i === bk.cur; // période en cours : la donnée importante, en vert clair
            if (it.sec > 0) svgTip(svgNode("rect", { x: x, y: T + plotH - h, width: barW, height: Math.max(1.5, h), rx: 2, "class": "st-bar" + (current ? " st-bar-hi" : "") }, svg), (mode === "week" ? "semaine du " : "") + label + " : " + gsFmtMin(it.sec) + " · " + it.n + " session" + (it.n > 1 ? "s" : "") + (current ? " (en cours)" : ""));
            if (i % every === 0) svgNode("text", { x: x + barW / 2, y: H - 8, "class": "st-axis", "text-anchor": "middle" }, svg, label);
        });
        if (avgSec > 0) { // moyenne de la période : trait pointillé gris
            var ay = T + plotH - avgSec / unit / top * plotH;
            svgNode("line", { x1: L, x2: W - R, y1: ay, y2: ay, "class": "st-avg" }, svg);
            svgNode("text", { x: W - R + 6, y: ay + 3.5, "class": "st-axis st-avg-label", "text-anchor": "start" }, svg, "moy. " + gsFmtMin(avgSec));
        }
        return svg;
    }
    // Carte de l'année : une case par jour, 53 semaines (lundi en haut).
    function statsHeatmap(dayMap, now) {
        var cell = 11, gap = 3, L = 26, T = 16, weeks = 53, step = cell + gap;
        var W = L + weeks * step, H = T + 7 * step;
        var svg = svgNode("svg", { viewBox: "0 0 " + W + " " + H, "class": "st-chart st-heat", role: "img", "aria-label": "Jours pratiqués sur les 12 derniers mois" });
        var today = new Date(now); today.setHours(0, 0, 0, 0);
        var startWeek = new Date(today); startWeek.setDate(startWeek.getDate() - ((startWeek.getDay() + 6) % 7) - 7 * (weeks - 1));
        var max = 0, w, d;
        for (w = 0; w < weeks; w++) for (d = 0; d < 7; d++) { var dt = new Date(startWeek); dt.setDate(dt.getDate() + w * 7 + d); var v = dayMap[calKey(dt)] || 0; if (v > max) max = v; }
        ["lun", "mer", "ven"].forEach(function (nm, i) { svgNode("text", { x: L - 5, y: T + i * 2 * step + cell - 1.5, "class": "st-axis", "text-anchor": "end" }, svg, nm); });
        var lastMonth = -1;
        for (w = 0; w < weeks; w++) {
            var mon = new Date(startWeek); mon.setDate(mon.getDate() + w * 7);
            if (mon.getMonth() !== lastMonth && (mon.getDate() <= 7 || w === 0)) { lastMonth = mon.getMonth(); svgNode("text", { x: L + w * step, y: T - 5, "class": "st-axis" }, svg, STATS_MONTHS_SHORT[mon.getMonth()]); }
            for (d = 0; d < 7; d++) {
                var day = new Date(startWeek); day.setDate(day.getDate() + w * 7 + d);
                if (day > today) continue;
                var sec = dayMap[calKey(day)] || 0, level = sec ? Math.min(4, Math.max(1, Math.ceil(sec / max * 4))) : 0;
                var r = svgNode("rect", { x: L + w * step, y: T + d * step, width: cell, height: cell, rx: 2.5, "class": "st-cell st-lv" + level + (day.getTime() === today.getTime() ? " st-today" : "") }, svg);
                svgTip(r, day.getDate() + " " + STATS_MONTHS_SHORT[day.getMonth()] + " " + day.getFullYear() + " : " + (sec ? gsFmtMin(sec) : "rien"));
            }
        }
        return svg;
    }
    // Progression du tempo d'un exercice : meilleur BPM de chaque séance.
    function statsTempoChart(pts) {
        var W = 600, H = 190, L = 44, R = 14, T = 12, B = 26, plotW = W - L - R, plotH = H - T - B;
        var svg = svgNode("svg", { viewBox: "0 0 " + W + " " + H, "class": "st-chart st-tempo", role: "img", "aria-label": "Progression du tempo" });
        var vals = pts.map(function (p) { return p.bpm; }), mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
        var span = Math.max(10, mx - mn), pad = Math.max(2, Math.round(span * 0.15)), lo = mn - pad, hi = mx + pad;
        var stepV = span <= 20 ? 5 : span <= 50 ? 10 : 20;
        lo = Math.floor(lo / stepV) * stepV; hi = Math.ceil(hi / stepV) * stepV;
        function yOf(v) { return T + plotH - (v - lo) / (hi - lo) * plotH; }
        for (var v = lo; v <= hi + 0.001; v += stepV) {
            svgNode("line", { x1: L, x2: W - R, y1: yOf(v), y2: yOf(v), "class": "st-grid" }, svg);
            svgNode("text", { x: L - 6, y: yOf(v) + 3.5, "class": "st-axis", "text-anchor": "end" }, svg, String(v));
        }
        var t0 = pts[0].date, t1 = pts[pts.length - 1].date, dt = Math.max(1, t1 - t0);
        function xOf(t) { return pts.length === 1 || t1 === t0 ? L + plotW / 2 : L + (t - t0) / dt * plotW; }
        svgNode("polyline", { points: pts.map(function (p) { return xOf(p.date).toFixed(1) + "," + yOf(p.bpm).toFixed(1); }).join(" "), "class": "st-line", fill: "none" }, svg);
        pts.forEach(function (p, i) {
            svgTip(svgNode("circle", { cx: xOf(p.date), cy: yOf(p.bpm), r: 4, "class": "st-dot" + (i === pts.length - 1 ? " st-dot-hi" : "") }, svg), statsShortDate(p.date) + " : " + p.bpm + " BPM" + (p.first && p.first !== p.bpm ? " (départ " + p.first + ")" : ""));
            if (i === 0 || i === pts.length - 1) svgNode("text", { x: xOf(p.date), y: yOf(p.bpm) - 9, "class": "st-axis st-axis-strong" + (i === pts.length - 1 ? " st-axis-hi" : ""), "text-anchor": i === 0 && pts.length > 1 ? "start" : "end" }, svg, String(p.bpm));
        });
        svgNode("text", { x: L, y: H - 8, "class": "st-axis", "text-anchor": "start" }, svg, statsShortDate(t0));
        if (pts.length > 1) svgNode("text", { x: W - R, y: H - 8, "class": "st-axis", "text-anchor": "end" }, svg, statsShortDate(t1));
        return svg;
    }

    // ---- périodes et comparaison ----
    // Période : "7"/"28"/"90" = jours glissants, "m0" = ce mois, "m1" = mois dernier, "y0" = cette année, "y1" = année dernière, "0" = tout.
    // La comparaison avec la période précédente n'existe que pour les mois et les années (pas pour les semaines).
    function statsPeriod(spec, now) {
        var d = new Date(now), out = { spec: spec, start: 0, end: now + 1, compare: null };
        if (spec === "m0" || spec === "m1") {
            var off = spec === "m1" ? 1 : 0;
            var ms = new Date(d.getFullYear(), d.getMonth() - off, 1).getTime(), me = new Date(d.getFullYear(), d.getMonth() - off + 1, 1).getTime();
            var pms = new Date(d.getFullYear(), d.getMonth() - off - 1, 1).getTime();
            out.start = ms; out.end = off ? me : now + 1;
            out.compare = { start: pms, end: off ? ms : Math.min(ms, pms + (now + 1 - ms)), label: CAL_MONTHS[new Date(pms).getMonth()] + (off ? "" : " (à la même date)") };
        } else if (spec === "y0" || spec === "y1") {
            var yo = spec === "y1" ? 1 : 0;
            var ys = new Date(d.getFullYear() - yo, 0, 1).getTime(), ye = new Date(d.getFullYear() - yo + 1, 0, 1).getTime();
            var pys = new Date(d.getFullYear() - yo - 1, 0, 1).getTime();
            out.start = ys; out.end = yo ? ye : now + 1;
            out.compare = { start: pys, end: yo ? ys : Math.min(ys, pys + (now + 1 - ys)), label: String(new Date(pys).getFullYear()) + (yo ? "" : " (à la même date)") };
        } else if (spec !== "0") {
            out.start = now - (parseInt(spec, 10) || 28) * STATS_DAY;
        }
        return out;
    }
    function stDeltaPct(cur, prev) {
        if (!prev) return "";
        var p = Math.round((cur - prev) / prev * 100);
        return p === 0 ? "＝ stable" : (p > 0 ? "▲ +" + p : "▼ −" + Math.abs(p)) + " %";
    }
    function stDeltaAbs(cur, prev, unit) {
        var d = cur - prev;
        return d === 0 ? "＝ stable" : (d > 0 ? "▲ +" + d : "▼ −" + Math.abs(d)) + " " + unit;
    }

    // ---- camembert (SVG) : la plus grosse part en vert clair, les autres en nuances de gris ----
    function statsPie(items, labelOf) {
        items = items.filter(function (i) { return i.sec > 0; }).sort(function (a, b) { return b.sec - a.sec; });
        var wrap = document.createElement("div"); wrap.className = "st-pie-wrap";
        var total = 0; items.forEach(function (i) { total += i.sec; });
        if (!total) { var none = document.createElement("div"); none.className = "gs-empty"; none.textContent = "Rien à répartir sur cette période."; wrap.appendChild(none); return wrap; }
        var MAXS = 7;
        if (items.length > MAXS + 1) {
            var rest = items.slice(MAXS), osum = 0; rest.forEach(function (i) { osum += i.sec; });
            items = items.slice(0, MAXS).concat([{ key: "__other__", name: "Autres (" + rest.length + ")", sec: osum, other: true }]);
        }
        var R = 92, C = 100, svg = svgNode("svg", { viewBox: "0 0 200 200", "class": "st-pie", role: "img", "aria-label": "Répartition du temps" });
        var legend = document.createElement("div"); legend.className = "st-pie-legend";
        var ang = -Math.PI / 2;
        items.forEach(function (it, i) {
            var frac = it.sec / total, cls = it.other ? "st-pie-o" : "st-pie-" + Math.min(i, 7), pct = Math.round(frac * 100);
            var tip = it.name + " : " + pct + " % · " + gsFmtMin(it.sec);
            if (items.length === 1) svgTip(svgNode("circle", { cx: C, cy: C, r: R, "class": "st-slice " + cls }, svg), tip);
            else {
                var a2 = ang + frac * Math.PI * 2, x1 = C + R * Math.cos(ang), y1 = C + R * Math.sin(ang), x2 = C + R * Math.cos(a2), y2 = C + R * Math.sin(a2);
                svgTip(svgNode("path", { d: "M" + C + "," + C + " L" + x1.toFixed(2) + "," + y1.toFixed(2) + " A" + R + "," + R + " 0 " + (frac > 0.5 ? 1 : 0) + " 1 " + x2.toFixed(2) + "," + y2.toFixed(2) + " Z", "class": "st-slice " + cls }, svg), tip);
                ang = a2;
            }
            var row = document.createElement("div"); row.className = "st-pie-row" + (i === 0 ? " st-pie-top" : "");
            var sw = document.createElement("i"); sw.className = "st-sw " + cls;
            var nm = document.createElement("span"); nm.className = "st-pie-name"; nm.textContent = it.name;
            if (labelOf && labelOf(it)) { var sub = document.createElement("small"); sub.textContent = labelOf(it); nm.appendChild(sub); }
            var vl = document.createElement("span"); vl.className = "st-pie-val"; vl.textContent = pct + " % · " + gsFmtMin(it.sec);
            row.appendChild(sw); row.appendChild(nm); row.appendChild(vl); legend.appendChild(row);
        });
        wrap.appendChild(svg); wrap.appendChild(legend);
        return wrap;
    }
    // Part du temps par premier sous-dossier (filtrable par chapitre).
    function statsSubSplit(rws, chapterKey) {
        var m = {};
        rws.forEach(function (r) {
            if (chapterKey && r.chapterKey !== chapterKey) return;
            var key = r.subKey || "__none__";
            var o = m[key] || (m[key] = { key: key, name: r.subKey ? r.subName : "Directement dans un chapitre", chapter: r.subKey ? r.chapterName : "", sec: 0 });
            o.sec += r.sec; if (r.subKey) { o.name = r.subName; o.chapter = r.chapterName; }
        });
        return Object.keys(m).map(function (k) { return m[k]; });
    }

    // ---- analyse de chaque exercice : durées, tempo, alertes et conseils ----
    function statsExerciseReport(rws, rows, now, periodSec) {
        var by = {}, lastAll = {};
        rows.forEach(function (r) { if (r.date > (lastAll[r.exKey] || 0)) lastAll[r.exKey] = r.date; });
        rws.forEach(function (r) {
            var o = by[r.exKey] || (by[r.exKey] = { key: r.exKey, title: r.title, chapterName: r.chapterName, rows: [], sec: 0, plannedSec: 0, plannedN: 0, realOfPlanned: 0, pts: [] });
            o.rows.push(r); o.sec += r.sec; o.title = r.title; o.chapterName = r.chapterName;
            if (r.plannedSec) { o.plannedSec += r.plannedSec; o.plannedN++; o.realOfPlanned += r.sec; }
            if (r.bpmMax && r.exKey.indexOf("t:") !== 0) o.pts.push({ date: r.date, bpm: r.bpmMax, first: r.bpmFirst, end: r.bpmEnd });
        });
        function mins(sec) { var m = sec / 60; return m < 10 ? Math.max(1, Math.round(m)) : Math.max(5, Math.round(m / 5) * 5); }
        var nEx = Object.keys(by).length;
        var list = Object.keys(by).map(function (k) {
            var o = by[k], n = o.rows.length;
            o.rows.sort(function (a, b) { return a.date - b.date; });
            o.n = n; o.last = lastAll[k] || 0; o.avgSec = o.sec / n;
            o.avgPlannedSec = o.plannedN ? o.plannedSec / o.plannedN : 0;
            o.ratio = o.plannedSec ? o.realOfPlanned / o.plannedSec : null;
            o.pts.sort(function (a, b) { return a.date - b.date; });
            o.from = o.pts.length ? o.pts[0].bpm : null; o.to = o.pts.length ? o.pts[o.pts.length - 1].bpm : null; o.delta = o.pts.length ? o.to - o.from : 0;
            o.best = o.pts.reduce(function (m, p) { return Math.max(m, p.bpm); }, 0);
            var al = o.alerts = [];
            // durée réellement passée, comparée à celle prévue dans les sessions
            if (o.plannedN >= 3 && o.ratio !== null) {
                var A = Math.round(o.avgSec / 60), P = Math.round(o.avgPlannedSec / 60), R = Math.round(o.ratio * 100);
                if (o.ratio < 0.7) al.push({ kind: "short", level: "warn", text: "Tu n'y passes en moyenne que " + A + " min sur " + P + " min prévues (" + R + " %).", advice: "Ramène la durée prévue à environ " + mins(o.avgSec) + " min dans tes sessions : un temps prévu jamais tenu fausse tes bilans. Si tu le coupes parce qu'il ennuie, essaie plutôt de le placer plus tôt dans la session." });
                else if (o.ratio > 1.3) al.push({ kind: "long", level: "warn", text: "Tu dépasses souvent le temps prévu : " + A + " min en moyenne pour " + P + " min prévues (" + R + " %).", advice: "Prévois plutôt environ " + mins(o.avgSec) + " min, ou coupe l'exercice en deux (un morceau par session) pour garder le reste de la session." });
            }
            if (n >= 3 && o.avgSec < 180 && !al.some(function (a) { return a.kind === "short"; })) al.push({ kind: "tiny", level: "info", text: "Moins de 3 min par séance en moyenne (" + Math.round(o.avgSec / 60 * 10) / 10 + " min).", advice: "C'est court pour progresser : prévois au moins 5 min, ou retire-le de la session et garde-le pour un échauffement." });
            // tempo
            if (o.pts.length >= 5) {
                var lastBpm = o.to, same = 0;
                for (var i = o.pts.length - 1; i >= 0 && Math.abs(o.pts[i].bpm - lastBpm) <= 1; i--) same++;
                if (same >= 5) al.push({ kind: "stagnant", level: "warn", text: "Tempo bloqué autour de " + lastBpm + " BPM depuis " + same + " séances.", advice: "Essaie un palier plus petit (+2 BPM), ou travaille 10 BPM plus lentement pendant une séance pour consolider avant de remonter." });
            }
            if (o.pts.length >= 3 && o.to < o.best * 0.9) al.push({ kind: "regress", level: "warn", text: "Tempo en recul : " + o.to + " BPM aujourd'hui pour un record de " + o.best + " BPM.", advice: "Reviens à environ " + Math.max(30, o.best - 10) + " BPM, puis remonte par paliers de 2 à 4 BPM." });
            // fréquence
            var idle = Math.floor((now - o.last) / STATS_DAY);
            if (n >= 3 && idle >= 21) al.push({ kind: "dormant", level: "info", text: "Plus travaillé depuis " + idle + " jours.", advice: "Glisse-le dans une prochaine session pour ne pas perdre le bénéfice." });
            if (nEx >= 4 && periodSec > 0 && o.sec / periodSec > 0.4) al.push({ kind: "dominant", level: "info", text: "Cet exercice représente " + Math.round(o.sec / periodSec * 100) + " % de ton temps de pratique.", advice: "Vérifie que cela correspond à ta priorité du moment." });
            o.warn = al.filter(function (a) { return a.level === "warn"; }).length;
            return o;
        });
        return list;
    }
    // Durée réelle de chaque séance (barre) contre durée prévue (trait).
    function statsDurationChart(items) {
        items = items.slice(-24);
        var W = 600, H = 150, L = 40, R = 10, T = 8, B = 24, plotW = W - L - R, plotH = H - T - B;
        var svg = svgNode("svg", { viewBox: "0 0 " + W + " " + H, "class": "st-chart st-dur", role: "img", "aria-label": "Durée réelle contre durée prévue, séance par séance" });
        var maxSec = 60; items.forEach(function (i) { maxSec = Math.max(maxSec, i.sec, i.plannedSec || 0); });
        var top = statsNiceMax(maxSec / 60);
        for (var g = 0; g <= 2; g++) {
            var y = T + plotH - plotH * g / 2;
            svgNode("line", { x1: L, x2: W - R, y1: y, y2: y, "class": "st-grid" }, svg);
            svgNode("text", { x: L - 6, y: y + 3.5, "class": "st-axis", "text-anchor": "end" }, svg, statsNum(top * g / 2) + " min");
        }
        var n = items.length, bw = plotW / n, barW = Math.max(3, Math.min(26, bw * 0.66)), every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 50))));
        items.forEach(function (it, i) {
            var x = L + i * bw + (bw - barW) / 2, h = it.sec / 60 / top * plotH;
            svgTip(svgNode("rect", { x: x, y: T + plotH - h, width: barW, height: Math.max(1.5, h), rx: 2, "class": "st-bar" + (i === n - 1 ? " st-bar-hi" : "") }, svg), statsShortDate(it.date) + " : " + gsFmtMin(it.sec) + (it.plannedSec ? " (prévu " + gsFmtMin(it.plannedSec) + ")" : ""));
            if (it.plannedSec) { var py = T + plotH - it.plannedSec / 60 / top * plotH; svgNode("line", { x1: x - 2, x2: x + barW + 2, y1: py, y2: py, "class": "st-plan-tick" }, svg); }
            if (i % every === 0) svgNode("text", { x: x + barW / 2, y: H - 7, "class": "st-axis", "text-anchor": "middle" }, svg, statsShortDate(it.date));
        });
        return svg;
    }

    // ---- écran Statistiques : sous-onglets (l'essentiel d'abord) ----
    var STATS_TABS = [["overview", "Aperçu"], ["time", "Temps"], ["split", "Répartition"], ["ex", "Exercices"]];
    var statsTab = "overview", statsSubChapter = "", statsExFilter = "all", statsExSort = "alerts", statsExOpen = {}, statsIssuesOpen = false;
    function stSection(box, title, extra) {
        var h = document.createElement("div"); h.className = "gs-stat-title"; h.textContent = title;
        if (extra) h.appendChild(extra);
        box.appendChild(h);
        var b = document.createElement("div"); b.className = "gs-stat-block"; box.appendChild(b); return b;
    }
    // hi = donnée importante : affichée en vert clair ; le reste est en gris clair
    function stRow(parent, left, right, pct, hi) {
        var r = document.createElement("div"); r.className = "gs-stat-row" + (hi ? " st-top" : "");
        if (pct !== undefined) { var bar = document.createElement("span"); bar.className = "gs-stat-bar"; bar.style.width = Math.max(2, pct) + "%"; r.appendChild(bar); }
        var l = document.createElement("span"); l.className = "gs-stat-l"; l.textContent = left;
        var v = document.createElement("span"); v.className = "gs-stat-r"; v.textContent = right;
        r.appendChild(l); r.appendChild(v); parent.appendChild(r); return r;
    }
    function stBtn(label, cls, fn) { var b = document.createElement("button"); b.type = "button"; b.className = cls; b.textContent = label; b.addEventListener("click", fn); return b; }

    // Fenêtre dont le contenu a grandi : on la rentre dans l'écran (sans écraser une position choisie à la main).
    function clampPanelToViewport(panel) {
        if (!panel) return;
        var top = parseFloat(panel.style.top) || 0, left = parseFloat(panel.style.left) || 0;
        var maxTop = Math.max(8, window.innerHeight - panel.offsetHeight - 8), maxLeft = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
        if (top > maxTop) panel.style.top = maxTop + "px";
        if (left > maxLeft) panel.style.left = maxLeft + "px";
    }
    function renderStatsScreen(box, spec, onIssues) {
        box.innerHTML = "";
        var now = Date.now(), ctx = statsContext();
        var log = logAll().filter(function (e) { return !e.instrumentId || e.instrumentId === state.activeInstrumentId; });
        var range = statsPeriod(spec, now), first = log.length ? log[0].date : now;
        var rows = statsRows(log, ctx), st = statsCompute(log, rows, ctx, range, now), issues = statsIssues(rows, ctx);
        var rws = rows.filter(function (r) { return r.date >= range.start && r.date < range.end; });
        var exList = statsExerciseReport(rws, rows, now, st.totalSec);
        var warnCount = exList.filter(function (o) { return o.warn > 0; }).length;
        if (onIssues) onIssues(issues.length);
        function rerender() { renderStatsScreen(box, spec, onIssues); }
        function done(fn) { return function () { fn(); save(); rerender(); }; }
        // Clic droit (appui long) sur un exercice des statistiques : l'ouvrir dans son dossier, le renommer…
        function bindExMenu(el, exId) {
            var f = exId && exId.indexOf("t:") !== 0 ? findExerciseById(exId) : null;
            if (!f) return;
            el.classList.add("st-has-menu");
            bindContextGesture(el, function (x, y) { openExerciseMenu(x, y, f.ex, f.folder, { reveal: true, after: rerender }); }, { selfButton: true });
        }

        // --- barre de sous-onglets
        var bar = document.createElement("div"); bar.className = "st-tabs"; bar.setAttribute("role", "tablist");
        STATS_TABS.forEach(function (t) {
            var b = document.createElement("button"); b.type = "button"; b.className = "st-tab" + (statsTab === t[0] ? " active" : ""); b.dataset.tab = t[0];
            b.setAttribute("role", "tab"); b.setAttribute("aria-selected", statsTab === t[0] ? "true" : "false"); b.textContent = t[1];
            if (t[0] === "ex" && warnCount) { var bub = document.createElement("span"); bub.className = "gs-tab-count st-issue-count"; bub.textContent = String(warnCount); bub.title = warnCount + " exercice(s) à surveiller"; b.appendChild(bub); }
            b.addEventListener("click", function () { statsTab = t[0]; rerender(); });
            bar.appendChild(b);
        });
        box.appendChild(bar);

        // ============ APERÇU : l'essentiel ============
        function tabOverview() {
            if (issues.length) renderIssues();
            if (!st.sessions) { var none = document.createElement("div"); none.className = "gs-empty"; none.textContent = "Pas encore de session enregistrée sur cette période. Les statistiques se remplissent au fil des sessions que tu enregistres (10 min minimum)."; box.appendChild(none); }
            var pv = range.compare ? statsCompute(log, rows, ctx, range.compare, now) : null;
            var hasPrev = pv && pv.sessions > 0;
            var tiles = document.createElement("div"); tiles.className = "st-tiles";
            var rNow = st.ratio === null ? null : Math.round(st.ratio * 100), rPrev = hasPrev && pv.ratio !== null ? Math.round(pv.ratio * 100) : null;
            [["Temps total", gsFmtMin(st.totalSec), true, hasPrev ? stDeltaPct(st.totalSec, pv.totalSec) : ""],
             ["Sessions", String(st.sessions), false, hasPrev ? stDeltaAbs(st.sessions, pv.sessions, "") : ""],
             ["Jours pratiqués", st.activeDays + " / " + st.periodDays, false, hasPrev ? stDeltaAbs(st.activeDays, pv.activeDays, "j") : ""],
             ["Moyenne / semaine", gsFmtMin(st.avgPerWeekSec), true, hasPrev ? stDeltaPct(st.avgPerWeekSec, pv.avgPerWeekSec) : ""],
             ["Durée moyenne", st.sessions ? gsFmtMin(st.avgSessionSec) : "–", false, hasPrev ? stDeltaPct(st.avgSessionSec, pv.avgSessionSec) : ""],
             ["Réel / prévu", rNow === null ? "–" : rNow + " %", false, rNow !== null && rPrev !== null ? stDeltaAbs(rNow, rPrev, "pts") : ""]]
                .forEach(function (t) {
                    var el = document.createElement("div"); el.className = "st-tile" + (t[2] ? " st-tile-hi" : "");
                    var v = document.createElement("div"); v.className = "st-tile-v"; v.textContent = t[1];
                    var l = document.createElement("div"); l.className = "st-tile-l"; l.textContent = t[0];
                    el.appendChild(v); el.appendChild(l);
                    if (t[3]) { var d = document.createElement("div"); d.className = "st-tile-d" + (t[3].charAt(0) === "▲" ? " st-up" : ""); d.textContent = t[3].replace(/\s+$/, ""); el.appendChild(d); }
                    tiles.appendChild(el);
                });
            var s0 = stSection(box, "Chiffres clés"); s0.appendChild(tiles);
            if (range.compare) {
                var cc = document.createElement("div"); cc.className = "st-caption st-compare";
                cc.textContent = hasPrev ? "Comparé à " + range.compare.label : "Aucune séance en " + range.compare.label + " : pas de comparaison possible.";
                s0.appendChild(cc);
            }
            if (st.sessions) {
                var sb = stSection(box, "Temps de pratique dans le temps");
                var bk = statsBuckets(st.recs, range, now, first);
                var wrap = document.createElement("div"); wrap.className = "st-chart-wrap"; wrap.appendChild(statsBarChart(bk)); sb.appendChild(wrap);
            }
            if (warnCount) {
                var al = document.createElement("div"); al.className = "st-teaser";
                var at = document.createElement("span"); at.textContent = warnCount + " exercice" + (warnCount > 1 ? "s" : "") + " à surveiller (durées, tempo) — détail et conseils dans l'onglet Exercices.";
                al.appendChild(at); al.appendChild(stBtn("Voir", "btn-ghost", function () { statsTab = "ex"; statsExFilter = "alerts"; rerender(); }));
                box.appendChild(al);
            }
        }
        function renderIssues() {
            // une seule ligne, dépliable : l'essentiel d'abord
            var tg = document.createElement("button"); tg.type = "button"; tg.className = "st-issues-toggle" + (statsIssuesOpen ? " open" : ""); tg.setAttribute("aria-expanded", statsIssuesOpen ? "true" : "false");
            var tl = document.createElement("span"); tl.className = "st-issues-label"; tl.textContent = "À ranger pour les statistiques";
            var bubble = document.createElement("span"); bubble.className = "gs-tab-count st-issue-count"; bubble.textContent = String(issues.length);
            var chev = document.createElement("span"); chev.className = "st-issues-chev"; chev.textContent = statsIssuesOpen ? "Masquer ▴" : "Voir ▾";
            tg.appendChild(tl); tg.appendChild(bubble); tg.appendChild(chev);
            tg.addEventListener("click", function () { statsIssuesOpen = !statsIssuesOpen; rerender(); });
            box.appendChild(tg);
            if (!statsIssuesOpen) return;
            var rv = document.createElement("div"); rv.className = "gs-stat-block st-issues-list"; box.appendChild(rv);
            issues.forEach(function (it) {
                var card = document.createElement("div"); card.className = "st-issue st-issue-" + it.kind;
                var tx = document.createElement("div"); tx.className = "st-issue-text";
                var acts = document.createElement("div"); acts.className = "st-issue-actions";
                var rules = statsRules();
                if (it.kind === "moved") {
                    tx.textContent = "« " + it.title + " » a changé de chapitre : ses " + it.count + " séance" + (it.count > 1 ? "s" : "") + " (" + gsFmtMin(it.sec) + ") étaient dans « " + it.from.join(" », « ") + " », il est maintenant dans « " + it.to + " ».";
                    acts.appendChild(stBtn("Garder l'historique", "btn-ghost", done(function () { rules.resolved[it.key] = "history"; })));
                    acts.appendChild(stBtn("Tout compter dans « " + it.to + " »", "btn-accent", done(function () { rules.chapterOf[it.exId] = it.toId; rules.resolved[it.key] = "follow"; })));
                } else if (it.kind === "recreated") {
                    tx.textContent = "« " + it.title + " » n'existe plus (" + it.count + " séance" + (it.count > 1 ? "s" : "") + ", " + gsFmtMin(it.sec) + "), mais un exercice du même nom existe : « " + it.twinPath + " ».";
                    acts.appendChild(stBtn("Garder séparé", "btn-ghost", done(function () { rules.resolved[it.key] = "separate"; })));
                    acts.appendChild(stBtn("Regrouper avec cet exercice", "btn-accent", done(function () { rules.alias[it.exId] = it.twinId; })));
                } else if (it.kind === "orphan") {
                    tx.textContent = "« " + it.title + " » a été supprimé, et son chapitre d'origine (« " + it.chapterName + " ») aussi (" + it.count + " séance" + (it.count > 1 ? "s" : "") + ", " + gsFmtMin(it.sec) + "). Où le ranger ?";
                    var sel = document.createElement("select"); sel.className = "st-issue-select"; sel.setAttribute("aria-label", "Chapitre");
                    var inst = getActiveInstrument();
                    (inst ? inst.categories : []).forEach(function (c) { var op = document.createElement("option"); op.value = c.id; op.textContent = c.name; sel.appendChild(op); });
                    acts.appendChild(sel);
                    acts.appendChild(stBtn("Ranger ici", "btn-accent", done(function () { if (sel.value) rules.chapterOf[it.exId] = sel.value; })));
                    acts.appendChild(stBtn("Ne pas compter", "btn-ghost", done(function () { rules.chapterOf[it.exId] = STATS_IGNORE; })));
                    acts.appendChild(stBtn("Laisser tel quel", "btn-ghost", done(function () { rules.resolved[it.key] = "keep"; })));
                } else if (it.kind === "dup") {
                    tx.textContent = "Cet exercice existe en " + it.ids.length + " exemplaires, tous travaillés : " + it.paths.join(" et ") + ". Même exercice pour les statistiques ?";
                    acts.appendChild(stBtn("Garder séparés", "btn-ghost", done(function () { rules.resolved[it.key] = "separate"; })));
                    acts.appendChild(stBtn("Regrouper", "btn-accent", done(function () { it.ids.slice(1).forEach(function (id) { rules.alias[id] = it.ids[0]; }); })));
                }
                card.appendChild(tx); card.appendChild(acts); rv.appendChild(card);
            });
            // Plusieurs exercices déplacés d'un coup (un chapitre fusionné dans un autre) : réponse groupée.
            var movedAll = issues.filter(function (i) { return i.kind === "moved"; });
            if (movedAll.length >= 2) {
                var bulk = document.createElement("div"); bulk.className = "st-issue-bulk";
                var bl = document.createElement("span"); bl.textContent = "Pour les " + movedAll.length + " exercices déplacés :";
                bulk.appendChild(bl);
                bulk.appendChild(stBtn("Tout garder dans l'historique", "btn-ghost", done(function () { var r = statsRules(); movedAll.forEach(function (i) { r.resolved[i.key] = "history"; }); })));
                bulk.appendChild(stBtn("Tout compter dans le chapitre actuel", "btn-accent", done(function () { var r = statsRules(); movedAll.forEach(function (i) { r.chapterOf[i.exId] = i.toId; r.resolved[i.key] = "follow"; }); })));
                rv.appendChild(bulk);
            }
        }

        // ============ TEMPS ============
        function tabTime() {
            var s1 = stSection(box, "Temps de pratique");
            stRow(s1, "Sessions enregistrées", String(st.sessions));
            stRow(s1, "Total", gsFmtMin(st.totalSec));
            stRow(s1, "Moyenne par jour (période entière)", gsFmtMin(st.totalSec / st.periodDays));
            stRow(s1, "Moyenne par semaine", gsFmtMin(st.avgPerWeekSec));
            stRow(s1, "Jours pratiqués", st.activeDays + " / " + st.periodDays);
            if (log.length) {
                var sh = stSection(box, "Régularité sur 12 mois");
                var hw = document.createElement("div"); hw.className = "st-chart-wrap st-heat-wrap"; hw.appendChild(statsHeatmap(st.dayMap, now)); sh.appendChild(hw);
            }
            var withPlan = st.recs.filter(function (r) { return r.plannedSec; }).slice(-10).reverse();
            if (withPlan.length) {
                var s7 = stSection(box, "Réel contre prévu");
                var scale = 1; withPlan.forEach(function (r) { scale = Math.max(scale, r.plannedSec, r.totalSec || 0); });
                withPlan.forEach(function (r, idx) {
                    var line = document.createElement("div"); line.className = "st-pair" + (idx === 0 ? " st-pair-ok" : ""); // dernière séance en vert clair
                    var lb = document.createElement("span"); lb.className = "st-pair-l"; lb.textContent = statsShortDate(r.date) + " · " + logRecName(r);
                    var tr = document.createElement("span"); tr.className = "st-pair-track";
                    var real = document.createElement("span"); real.className = "st-pair-real"; real.style.width = Math.round((r.totalSec || 0) / scale * 100) + "%";
                    var mk = document.createElement("span"); mk.className = "st-pair-plan"; mk.style.left = Math.round(r.plannedSec / scale * 100) + "%"; mk.title = "prévu : " + gsFmtMin(r.plannedSec);
                    tr.appendChild(real); tr.appendChild(mk);
                    var tx = document.createElement("span"); tx.className = "st-pair-r"; tx.textContent = gsFmtMin(r.totalSec || 0) + " / " + gsFmtMin(r.plannedSec) + " · " + Math.round((r.totalSec || 0) / r.plannedSec * 100) + " %";
                    line.appendChild(lb); line.appendChild(tr); line.appendChild(tx); s7.appendChild(line);
                });
            }
        }

        // ============ RÉPARTITION ============
        function tabSplit() {
            var s2 = stSection(box, "Dossiers principaux");
            s2.appendChild(statsPie(st.chapters.map(function (c) { return { key: c.key, name: c.name, sec: c.sec }; })));
            var chapterNames = {}; st.chapters.forEach(function (c) { chapterNames[c.key] = c.name; });
            if (statsSubChapter && !chapterNames[statsSubChapter]) statsSubChapter = "";
            var pick = document.createElement("select"); pick.className = "st-sub-pick"; pick.setAttribute("aria-label", "Chapitre");
            var o0 = document.createElement("option"); o0.value = ""; o0.textContent = "Tous les dossiers principaux"; pick.appendChild(o0);
            st.chapters.forEach(function (c) { var op = document.createElement("option"); op.value = c.key; op.textContent = c.name; if (statsSubChapter === c.key) op.selected = true; pick.appendChild(op); });
            pick.addEventListener("change", function () { statsSubChapter = pick.value; rerender(); });
            var s2b = stSection(box, "Premiers sous-dossiers");
            s2b.appendChild(pick);
            s2b.appendChild(statsPie(statsSubSplit(rws, statsSubChapter), function (it) { return it.chapter && !statsSubChapter ? it.chapter : ""; }));
            if (st.top.length) {
                var s3 = stSection(box, "Les plus travaillés");
                st.top.slice(0, 5).forEach(function (x, i) { bindExMenu(stRow(s3, x.title, gsFmtMin(x.sec) + " · " + x.count + "×", undefined, i === 0), x.key); });
            }
            if (st.favorites.length) {
                var s4 = stSection(box, "Mes favoris ★");
                st.favorites.slice(0, 8).forEach(function (x) { bindExMenu(stRow(s4, x.title, x.count ? gsFmtMin(x.sec) + " · " + gsFmtAgo(x.last, now) : "pas travaillé (" + gsFmtAgo(x.last, now) + ")"), x.id); });
            }
            var s5 = stSection(box, "Exercices sous-utilisés");
            if (!st.underused.length) { var ok = document.createElement("div"); ok.className = "gs-empty"; ok.textContent = "Tous tes exercices ont été travaillés sur cette période."; s5.appendChild(ok); }
            st.underused.slice(0, 8).forEach(function (x) { var ur = stRow(s5, x.title, x.last ? "dernier passage " + gsFmtAgo(x.last, now) : "jamais travaillé"); ur.title = x.path; bindExMenu(ur, x.id); });
            if (st.underused.length > 8) { var more = document.createElement("div"); more.className = "gs-empty"; more.textContent = "… et " + (st.underused.length - 8) + " autres"; s5.appendChild(more); }
            var sp2 = stSection(box, "Exercices déplacés");
            var prow = document.createElement("label"); prow.className = "st-policy";
            var pl = document.createElement("span"); pl.textContent = "Quand un exercice change de chapitre :";
            var ps = document.createElement("select"); ps.className = "st-policy-sel"; ps.setAttribute("aria-label", "Exercice déplacé");
            [["ask", "me demander"], ["history", "garder l'historique là où il était"], ["follow", "suivre l'exercice partout"]].forEach(function (o) { var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; if (statsRules().movePolicy === o[0]) op.selected = true; ps.appendChild(op); });
            ps.addEventListener("change", function () { statsRules().movePolicy = ps.value; save(); rerender(); });
            prow.appendChild(pl); prow.appendChild(ps); sp2.appendChild(prow);
        }

        // ============ EXERCICES : analyse, alertes, conseils, progression du tempo ============
        function tabExercises() {
            if (!exList.length) { var none = document.createElement("div"); none.className = "gs-empty"; none.textContent = "Aucun exercice travaillé sur cette période."; box.appendChild(none); return; }
            var head = document.createElement("div"); head.className = "st-ex-head-bar";
            var info = document.createElement("span"); info.className = "st-ex-info";
            info.textContent = exList.length + " exercice" + (exList.length > 1 ? "s" : "") + " analysé" + (exList.length > 1 ? "s" : "") + " · " + (warnCount ? warnCount + " à surveiller" : "rien d'inquiétant");
            var chips = document.createElement("span"); chips.className = "st-ex-chips";
            [["all", "Tous"], ["alerts", "À surveiller"]].forEach(function (c) {
                var b = stBtn(c[1], "cal-pick-chip" + (statsExFilter === c[0] ? " active" : ""), function () { statsExFilter = c[0]; rerender(); }); chips.appendChild(b);
            });
            var sort = document.createElement("select"); sort.className = "st-ex-sort"; sort.setAttribute("aria-label", "Trier");
            [["alerts", "À surveiller d'abord"], ["time", "Plus travaillés"], ["gain", "Meilleure progression du tempo"], ["idle", "Moins récents d'abord"], ["name", "Ordre alphabétique"]].forEach(function (o) { var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; if (statsExSort === o[0]) op.selected = true; sort.appendChild(op); });
            sort.addEventListener("change", function () { statsExSort = sort.value; rerender(); });
            head.appendChild(info); head.appendChild(chips); head.appendChild(sort); box.appendChild(head);
            var list = exList.filter(function (o) { return statsExFilter === "all" || o.warn > 0; });
            var cmp = { alerts: function (a, b) { return b.warn - a.warn || b.alerts.length - a.alerts.length || b.sec - a.sec; }, time: function (a, b) { return b.sec - a.sec; }, gain: function (a, b) { return b.delta - a.delta || b.sec - a.sec; }, idle: function (a, b) { return a.last - b.last; }, name: function (a, b) { return a.title.localeCompare(b.title, "fr", { sensitivity: "base" }); } }[statsExSort] || function () { return 0; };
            list.sort(cmp);
            if (!list.length) { var ok = document.createElement("div"); ok.className = "gs-empty"; ok.textContent = "Aucun exercice à surveiller sur cette période."; box.appendChild(ok); }
            list.forEach(function (o) {
                var open = !!statsExOpen[o.key];
                var card = document.createElement("div"); card.className = "st-ex" + (open ? " open" : "") + (o.warn ? " st-ex-warn" : ""); card.dataset.key = o.key;
                var hd = document.createElement("button"); hd.type = "button"; hd.className = "st-ex-row"; hd.setAttribute("aria-expanded", open ? "true" : "false");
                var nm = document.createElement("span"); nm.className = "st-ex-name"; nm.textContent = o.title;
                var ch = document.createElement("small"); ch.textContent = o.chapterName; nm.appendChild(ch);
                var meta = document.createElement("span"); meta.className = "st-ex-meta"; meta.textContent = o.n + " séance" + (o.n > 1 ? "s" : "") + " · " + gsFmtMin(o.sec);
                var dur = document.createElement("span"); dur.className = "st-ex-dur";
                dur.textContent = o.plannedN ? Math.round(o.avgSec / 60) + " / " + Math.round(o.avgPlannedSec / 60) + " min" + (o.ratio !== null ? " · " + Math.round(o.ratio * 100) + " %" : "") : Math.round(o.avgSec / 60) + " min en moyenne";
                dur.title = "Durée moyenne réelle / durée moyenne prévue";
                var tp = document.createElement("span"); tp.className = "st-ex-tempo";
                if (o.pts.length) {
                    var tt = document.createElement("span"); tt.className = o.delta > 0 ? "st-ex-gain" : ""; tt.textContent = o.from + " → " + o.to + " BPM" + (o.delta ? " (" + (o.delta > 0 ? "+" : "") + o.delta + ")" : "");
                    tp.appendChild(tt);
                    if (o.pts.length >= 2) { var sp = document.createElement("span"); sp.className = "gs-stat-spark"; sp.innerHTML = gsStatsSparkline(o.pts); tp.appendChild(sp); }
                } else tp.textContent = "–";
                var bd = document.createElement("span"); bd.className = "st-ex-badges";
                if (o.alerts.length) { var b1 = document.createElement("span"); b1.className = "gs-tab-count" + (o.warn ? " st-issue-count" : ""); b1.textContent = String(o.alerts.length); b1.title = o.alerts.length + " alerte(s)"; bd.appendChild(b1); }
                hd.appendChild(nm); hd.appendChild(meta); hd.appendChild(dur); hd.appendChild(tp); hd.appendChild(bd);
                hd.addEventListener("click", function () { if (suppressNextClick) { suppressNextClick = false; return; } statsExOpen[o.key] = !statsExOpen[o.key]; rerender(); });
                bindExMenu(hd, o.key);
                card.appendChild(hd);
                if (open) {
                    var body = document.createElement("div"); body.className = "st-ex-body";
                    if (o.alerts.length) {
                        o.alerts.forEach(function (a) {
                            var al = document.createElement("div"); al.className = "st-alert st-alert-" + a.level;
                            var at = document.createElement("div"); at.className = "st-alert-text"; at.textContent = (a.level === "warn" ? "⚠ " : "ℹ ") + a.text;
                            var av = document.createElement("div"); av.className = "st-alert-advice"; av.textContent = "Conseil : " + a.advice;
                            al.appendChild(at); al.appendChild(av); body.appendChild(al);
                        });
                    } else { var fine = document.createElement("div"); fine.className = "st-ex-fine"; fine.textContent = "Rien à signaler : durées et tempo sont réguliers."; body.appendChild(fine); }
                    if (o.pts.length >= 2) {
                        var t1 = document.createElement("div"); t1.className = "st-sub-title"; t1.textContent = "Progression du tempo (meilleur BPM de chaque séance)"; body.appendChild(t1);
                        var tw = document.createElement("div"); tw.className = "st-chart-wrap"; tw.appendChild(statsTempoChart(o.pts)); body.appendChild(tw);
                    }
                    var t2 = document.createElement("div"); t2.className = "st-sub-title"; t2.textContent = "Durée réelle de chaque séance" + (o.plannedN ? " (trait = durée prévue)" : ""); body.appendChild(t2);
                    var dw = document.createElement("div"); dw.className = "st-chart-wrap"; dw.appendChild(statsDurationChart(o.rows.map(function (r) { return { date: r.date, sec: r.sec, plannedSec: r.plannedSec }; }))); body.appendChild(dw);
                    card.appendChild(body);
                }
                box.appendChild(card);
            });
        }

        ({ overview: tabOverview, time: tabTime, split: tabSplit, ex: tabExercises }[statsTab] || tabOverview)();
        requestAnimationFrame(function () { clampPanelToViewport(box.closest(".backups-panel")); });
    }

    // Historique : séances enregistrées (de la plus récente à la plus ancienne) et statistiques.
    function openSessionHistory(startTab) {
        openModal("gs-history-panel", function (panel, close) {
            var title = document.createElement("div");
            title.className = "backups-title";
            title.textContent = "Historique des sessions";
            panel.appendChild(title);
            var tabs = document.createElement("div");
            tabs.className = "gs-history-tabs";
            var tabLog = document.createElement("button"); tabLog.type = "button"; tabLog.className = "gs-hist-tab"; tabLog.textContent = "Séances";
            var tabStats = document.createElement("button"); tabStats.type = "button"; tabStats.className = "gs-hist-tab"; tabStats.textContent = "Statistiques";
            var period = document.createElement("select"); period.className = "gs-hist-period"; period.setAttribute("aria-label", "Période");
            [["7", "7 jours"], ["28", "28 jours"], ["90", "90 jours"], ["m0", "Ce mois"], ["m1", "Mois dernier"], ["y0", "Cette année"], ["y1", "Année dernière"], ["0", "Tout"]].forEach(function (o) { var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; if (o[0] === "28") op.selected = true; period.appendChild(op); });
            tabs.appendChild(tabLog); tabs.appendChild(tabStats); tabs.appendChild(period);
            function markStatsIssues(n) {
                tabStats.textContent = "Statistiques";
                if (n > 0) { var bub = document.createElement("span"); bub.className = "gs-tab-count st-issue-count"; bub.textContent = String(n); bub.title = n + " exercice(s) à ranger pour les statistiques"; tabStats.appendChild(bub); }
            }
            markStatsIssues(statsIssueCount());
            panel.appendChild(tabs);
            var list = document.createElement("div");
            list.className = "gs-sync-list gs-history-list";
            panel.appendChild(list);
            var mode = startTab === "stats" ? "stats" : "log";
            panel.classList.toggle("gs-history-wide", mode === "stats");
            function myLog() { return logAll().filter(function (e) { return !e.instrumentId || e.instrumentId === state.activeInstrumentId; }); }
            function fill() {
                panel.classList.toggle("gs-history-wide", mode === "stats");
                // le mode Statistiques est plus haut : on rentre la fenêtre dans l'écran (sans écraser une position choisie à la main)
                requestAnimationFrame(function () { clampPanelToViewport(panel); });
                tabLog.classList.toggle("active", mode === "log");
                tabStats.classList.toggle("active", mode === "stats");
                period.hidden = mode !== "stats";
                list.innerHTML = "";
                if (mode === "stats") {
                    renderStatsScreen(list, period.value, markStatsIssues);
                    return;
                }
                var log = myLog().slice().reverse();
                if (!log.length) { var none = document.createElement("div"); none.className = "gs-empty"; none.textContent = "Aucune session enregistrée pour l'instant. À la fin d'une session d'au moins 10 min, on te propose de l'enregistrer."; list.appendChild(none); return; }
                log.forEach(function (e) {
                    var box = document.createElement("div");
                    box.className = "gs-history-entry";
                    var head = document.createElement("div");
                    head.className = "gs-sync-row";
                    var nm = document.createElement("span"); nm.className = "gs-sync-name"; nm.textContent = logRecName(e);
                    if (logRecOldName(e)) nm.title = "Nom au moment de la séance : « " + logRecOldName(e) + " »";
                    var du = document.createElement("span"); du.className = "gs-sync-dur"; du.textContent = gsFmtDate(e.date) + " · " + gsFmtDur(e.totalSec);
                    // Une séance supprimée du journal ne se rattrape plus par « Annuler » : confirmation en deux clics.
                    var del = iconButton("✕", "Supprimer cette entrée", function () {
                        if (!del.dataset.armed) {
                            del.dataset.armed = "1"; del.textContent = "Supprimer ?"; del.classList.add("gs-del-armed"); del.title = "Cliquer encore pour confirmer";
                            setTimeout(function () { if (del.isConnected) { delete del.dataset.armed; del.textContent = "✕"; del.classList.remove("gs-del-armed"); del.title = "Supprimer cette entrée"; } }, 3000);
                            return;
                        }
                        var removed = cloneJson(e);
                        logRemove(e.id);
                        save(); fill();
                        showToast("Séance du " + gsFmtDate(e.date) + " supprimée de l'historique", 8000, { label: "Annuler", run: function () { logAdd(removed); save(); fill(); showToast("Séance remise dans l'historique"); } });
                    });
                    var edit = iconButton("✎", "Modifier cette séance (durées, tempo)", function () { editLoggedRecord(e, function () { openSessionHistory(); }); });
                    head.appendChild(nm); head.appendChild(du); head.appendChild(edit); head.appendChild(del);
                    var det = document.createElement("div");
                    det.className = "gs-history-steps";
                    det.textContent = e.steps.map(function (st) { return logStepTitle(st) + " (" + gsFmtDur(st.actualSec) + (st.bpmMax ? ", " + (st.bpmFirst && st.bpmFirst !== st.bpmMax ? st.bpmFirst + "→" : "") + st.bpmMax + " BPM" : "") + ")"; }).join(" · ");
                    box.appendChild(head); box.appendChild(det);
                    var g = gsFindSession(e.sessionId);
                    if (g) bindContextGesture(box, function (x, y) {
                        openLinksQuickMenu(x, y, [
                            { label: "✎ Modifier les exercices de « " + g.name + " »", open: function () { gsOpenSessionEditor(g); } },
                            { label: g.ephemeral ? "Enregistrer dans mes sessions…" : "Renommer la session…", open: function () { gsRenameSession(g, fill); } }
                        ]);
                    });
                    list.appendChild(box);
                });
            }
            tabLog.addEventListener("click", function () { mode = "log"; fill(); });
            tabStats.addEventListener("click", function () { mode = "stats"; fill(); });
            period.addEventListener("change", fill);
            fill();
        });
    }

    function gsEnterRunStep() {
        gsAccumulateStep();
        var enteredStep = gsRunSession.steps[gsRunStepIndex];
        gsRunCurrentStepId = enteredStep.id;
        var enteredFound = findExerciseById(enteredStep.exerciseId);
        var presetForStep = gsEffectiveMetronome(enteredStep, enteredFound && enteredFound.ex);
        var stepLink = enteredFound && !enteredStep.metronome ? { exId: enteredFound.ex.id, title: enteredFound.ex.title, fromSession: true } : null; // tempo propre à la session : on ne propose pas de modifier l'exercice
        if (presetForStep) loadMetronomePreset(presetForStep, { link: stepLink });
        else setMetroLink(stepLink ? { exId: stepLink.exId, title: stepLink.title, base: null, fromSession: true } : null);
        gsWarnKey = null;
        gsRunAllocatedSec = gsRunSession.steps[gsRunStepIndex].minutes * 60;
        gsRunElapsedMs = 0;
        gsRunStartTs = Date.now();
        gsRunPaused = false;
        if (gsTotalStartTs === null) gsTotalStartTs = Date.now(); // 1er exercice, ou changement d'exercice pendant une pause
        transportLastTouched = "session";
        gsLiveSave();
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
        gsLiveSave();
    }

    function gsResumeRun() {
        if (!gsRunPaused) return;
        gsRunStartTs = Date.now();
        gsTotalStartTs = Date.now();
        gsRunPaused = false;
        transportLastTouched = "session";
    }

    function gsEndRun() {
        var runRecord = gsBuildRunRecord();
        var extraSteps = runRecord ? gsRunMissingSteps(runRecord) : [];
        if (gsRunInterval) { clearInterval(gsRunInterval); gsRunInterval = null; }
        if (miniWinOpen()) closeMiniWindow();
        gsTrackBpm(false);
        if (metroLink && metroLink.fromSession) setMetroLink(null);
        gsRunSession = null;
        gsScreen = "list";
        render();
        if (runRecord) gsAskSaveRun(runRecord, extraSteps); else gsLiveClear();
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
    // Ajoute un exercice à la session EN COURS, à la position voulue : il fait partie de la session pour les fois suivantes
    // et de l'enregistrement de cette séance (statistiques).
    function gsRunInsertExercise(idx) {
        var session = gsRunSession;
        if (!session) return;
        var old = findExerciseById((session.steps[0] || {}).exerciseId);
        openExercisePickerModal("Ajouter à la session", { inst: old ? old.inst : getActiveInstrument(), exclude: [] }, function (ex) {
            if (gsRunSession !== session) return;
            var step = { id: uid(), exerciseId: ex.id, minutes: gsDefaultMinutes(ex), note: "", hidden: [] };
            var at = Math.max(0, Math.min(idx, session.steps.length));
            session.steps.splice(at, 0, step);
            if (at <= gsRunStepIndex) gsRunStepIndex++; // l'exercice en cours reste le même
            var de = gsDrafts[session.id];
            if (de) { var clean = !gsDraftDirty(session.id); de.draft.steps.splice(Math.min(at, de.draft.steps.length), 0, cloneJson(step)); if (clean) de.base = gsDraftSig(de); }
            save();
            render();
            showToast("« " + ex.title + " » ajouté (" + step.minutes + " min)");
        });
    }
    function renderGsRunPlan(content, session) {
        var wrap = document.createElement("div");
        wrap.className = "gs-plan";
        var toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "btn-ghost gs-plan-toggle";
        toggle.textContent = (gsRunPlanOpen ? "▾" : "▸") + " Plan de la session (ordre et durées)";
        toggle.addEventListener("click", function () { gsRunPlanOpen = !gsRunPlanOpen; render(); });
        var head = document.createElement("div");
        head.className = "gs-plan-head";
        head.appendChild(toggle);
        var addNow = document.createElement("button");
        addNow.type = "button";
        addNow.className = "btn-ghost gs-plan-add";
        addNow.textContent = "＋";
        addNow.title = "Ajouter un exercice après celui-ci";
        addNow.setAttribute("aria-label", addNow.title);
        addNow.addEventListener("click", function () { gsRunInsertExercise(gsRunStepIndex + 1); });
        head.appendChild(addNow);
        wrap.appendChild(head);
        if (gsRunPlanOpen) {
            var list = document.createElement("div");
            list.className = "gs-plan-list";
            function insertBtn(at, label) {
                var b = document.createElement("button");
                b.type = "button"; b.className = "btn-ghost gs-plan-insert"; b.textContent = "＋"; b.title = label; b.setAttribute("aria-label", label);
                b.addEventListener("click", function () { gsRunInsertExercise(at); });
                return b;
            }
            list.appendChild(insertBtn(0, "Ajouter un exercice au début"));
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
                list.appendChild(insertBtn(i + 1, "Ajouter un exercice ici"));
            });
            wrap.appendChild(list);
        }
        content.appendChild(wrap);
    }

    // Appelée à chaque rafraîchissement du chrono : carillon d'avertissement, puis passage au suivant.
    function gsAutoAdvanceTick(remaining, step, session) {
        gsBellTick(remaining, step, session);
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

    // ---------- fenêtre flottante de session (toujours visible) ----------
    // Pour garder le chrono sous les yeux quand la page TrainHub est cachée (PDF, iReal Pro, vidéo…) : une petite
    // fenêtre séparée, avec le nom de l'exercice, le temps restant (−1/+1 min, pause) et le métronome (tempo qui
    // clignote à chaque temps, lecture/pause). Sur Chrome/Edge (bureau) c'est une vraie fenêtre « image dans l'image »
    // qui reste AU-DESSUS des autres applications ; ailleurs (Safari, Firefox) c'est une petite fenêtre ordinaire,
    // à garder visible à côté.
    var miniWin = null, miniIsPip = false, miniTimerId = null;
    var MINI_SIZE_KEY = "trainhub.miniSize.v1";
    function miniWinOpen() { return !!(miniWin && !miniWin.closed); }
    function miniLoadSize() {
        try { var v = JSON.parse(localStorage.getItem(MINI_SIZE_KEY)); if (v && v.w > 100 && v.h > 80) return v; } catch (e) {}
        return { w: 252, h: 252 };
    }
    function closeMiniWindow() {
        var w = miniWin;
        miniWin = null;
        if (miniTimerId && w) { try { w.clearInterval(miniTimerId); } catch (e) {} }
        miniTimerId = null;
        metroBeatListeners = metroBeatListeners.filter(function (fn) { return fn !== miniBeat; });
        if (w && !w.closed) { try { w.close(); } catch (e) {} }
        refreshMiniButtons();
    }
    var miniBeat = function () {};
    function refreshMiniButtons() {
        Array.prototype.forEach.call(document.querySelectorAll(".gs-run-mini-btn"), function (b) {
            b.classList.toggle("active", miniWinOpen());
            b.setAttribute("aria-pressed", miniWinOpen() ? "true" : "false");
        });
    }
    function openMiniWindow() {
        if (miniWinOpen()) { closeMiniWindow(); return; }
        if (!gsRunSession) return;
        var size = miniLoadSize();
        var request;
        if (window.documentPictureInPicture && documentPictureInPicture.requestWindow) {
            miniIsPip = true;
            request = documentPictureInPicture.requestWindow({ width: size.w, height: size.h }).catch(function () { return null; });
        } else {
            miniIsPip = false;
            var w0 = null;
            try { w0 = window.open("", "trainhub-mini", "popup=yes,width=" + size.w + ",height=" + size.h + ",left=40,top=80"); } catch (e) {}
            request = Promise.resolve(w0);
        }
        request.then(function (win) {
            if (!win && miniIsPip) { // l'« image dans l'image » a été refusée : on se rabat sur une petite fenêtre ordinaire
                miniIsPip = false;
                try { win = window.open("", "trainhub-mini", "popup=yes,width=" + size.w + ",height=" + size.h + ",left=40,top=80"); } catch (e) {}
            }
            if (!win) { showToast("Fenêtre flottante impossible : autorise les pop-ups pour TrainHub, ou utilise Chrome/Edge."); return; }
            setupMiniWindow(win);
        });
    }
    function setupMiniWindow(win) {
        miniWin = win;
        var doc = win.document;
        doc.title = "TrainHub";
        doc.body.innerHTML = "";
        var css = doc.createElement("style");
        css.textContent =
            ":root{color-scheme:dark;--ac:#00e676;--bd:#3a3a3a;--bg:#121212;--tx:#eee;--mu:#9a9a9a}" +
            "*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--tx);font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden}" +
            "button{font:inherit;color:var(--tx);background:#222;border:1px solid var(--bd);border-radius:7px;cursor:pointer;padding:0 8px;height:28px}button:hover{border-color:var(--ac)}" +
            ".m{height:100%;display:flex;flex-direction:column;justify-content:center;align-items:stretch;gap:6px;padding:8px 10px}" +
            ".t{font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}" +
            ".tm{font-size:40px;font-weight:800;text-align:center;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.02em}.tm.over{color:#ff8a65}" +
            ".r{display:flex;gap:6px}.r button{flex:1;white-space:nowrap}.pp{background:color-mix(in srgb,var(--ac) 18%,#222);border-color:color-mix(in srgb,var(--ac) 55%,var(--bd));color:var(--ac);font-weight:700}.pp.run{color:var(--tx);background:#222;border-color:var(--bd)}" +
            ".mt{display:flex;align-items:center;gap:8px;border-top:1px solid var(--bd);padding-top:6px}.bpm{flex:1;text-align:center;font-size:24px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--mu);border-radius:7px;transition:none;line-height:1.3}.bpm small{font-size:11px;font-weight:600;margin-left:3px}" +
            ".bpm.on{color:#04140a;background:var(--ac)}.bpm.on.acc{background:#fff}.bpm.idle{opacity:.75}" +
            ".mt button{width:34px;flex:none;padding:0}.tools{display:flex;gap:4px;align-items:center;flex-wrap:wrap}.tools button{height:22px;font-size:11px;padding:0 6px;color:var(--mu)}.tools .x{margin-left:auto}.tools .mode{font-size:10px;color:var(--mu)}" +
            "@media (min-aspect-ratio:2/1){.m{flex-direction:row;align-items:center;flex-wrap:wrap;gap:8px 12px}.m .head{flex:1 1 140px;min-width:0}.m .r{flex:0 0 auto}.m .r button{flex:none}.m .mt{border-top:none;padding-top:0;border-left:1px solid var(--bd);padding-left:10px}.m .tools{flex:1 1 100%}.tm{font-size:34px}}" +
            "@media (max-width:230px){.t{font-size:12px}.tm{font-size:34px}.r button{padding:0 4px;font-size:12px}}" +
            "@media (max-height:150px) and (max-width:300px){.t,.tools{display:none}.tm{font-size:32px}.mt{padding-top:4px}.bpm{font-size:18px}}" +
            "@media (max-height:150px){.tools{display:none}}" +
            "@media (min-width:380px) and (min-height:280px){.tm{font-size:72px}.t{font-size:17px}.bpm{font-size:40px}button{height:36px;font-size:15px}.mt button{width:48px}.tools button{height:26px;font-size:12px}}";
        doc.head.appendChild(css);
        var root = doc.createElement("div");
        root.className = "m";
        root.innerHTML =
            '<div class="head"><div class="t" id="t"></div><div class="tm" id="tm">--:--</div></div>' +
            '<div class="r"><button id="minus" title="Retirer une minute">−1 min</button><button id="pp" class="pp" title="Pause / reprise de la session">Pause</button><button id="plus" title="Ajouter une minute">+1 min</button></div>' +
            '<div class="mt" id="mt" title="Molette de la souris : régler le tempo"><button id="bm" title="Tempo −1 (Maj : −5)">−</button><div class="bpm idle" id="bpm">--<small>BPM</small></div><button id="bp" title="Tempo +1 (Maj : +5)">+</button><button id="mp" title="Lecture / pause du métronome">▶</button></div>' +
            '<div class="tools" id="tools"></div>';
        doc.body.appendChild(root);
        function $(id) { return doc.getElementById(id); }
        var tools = $("tools");
        var modeTxt = doc.createElement("span");
        modeTxt.className = "mode";
        modeTxt.textContent = miniIsPip ? "📌 reste au-dessus" : "fenêtre simple";
        modeTxt.title = miniIsPip ? "Cette fenêtre reste au-dessus des autres applications." : "Ce navigateur n'offre pas la fenêtre « toujours au-dessus » : utilise Chrome ou Edge sur ordinateur.";
        tools.appendChild(modeTxt);
        var hide = doc.createElement("button");
        hide.className = "x"; hide.textContent = "Masquer"; hide.title = "Fermer cette fenêtre (le bouton de la session la rouvre)";
        hide.addEventListener("click", closeMiniWindow);
        tools.appendChild(hide);

        function adjust(delta) {
            if (!gsRunSession) return;
            gsRunAllocatedSec = Math.max(60, gsRunAllocatedSec + delta);
            if (gsRefreshRunUi) gsRefreshRunUi();
            refresh();
        }
        $("minus").addEventListener("click", function () { adjust(-60); });
        $("plus").addEventListener("click", function () { adjust(60); });
        $("pp").addEventListener("click", function () {
            if (!gsRunSession) return;
            if (gsRunPaused) gsResumeRun(); else gsPauseRun();
            if (gsRefreshRunUi) gsRefreshRunUi();
            refresh();
        });
        function setMiniBpm(v) {
            v = Math.min(300, Math.max(30, v));
            if (metroPanelApi && metroPanelApi.setBpm) metroPanelApi.setBpm(v);
            else { state.settings.metronome.bpm = v; saveSoon(); }
            refresh();
        }
        $("bm").addEventListener("click", function (e) { setMiniBpm(state.settings.metronome.bpm - (e.shiftKey ? 5 : 1)); });
        $("bp").addEventListener("click", function (e) { setMiniBpm(state.settings.metronome.bpm + (e.shiftKey ? 5 : 1)); });
        $("mt").addEventListener("wheel", function (e) {
            e.preventDefault();
            setMiniBpm(state.settings.metronome.bpm + (e.deltaY < 0 ? 1 : -1));
        }, { passive: false });
        $("mp").addEventListener("click", function () {
            try { if (metroPanelApi) metroPanelApi.toggle(); else if (metroPlaying) stopMetronome(); else startMetronome(); } catch (e) {}
            refresh();
        });
        function refresh() {
            if (!gsRunSession) { closeMiniWindow(); return; }
            var step = gsRunSession.steps[gsRunStepIndex];
            var found = step && findExerciseById(step.exerciseId);
            $("t").textContent = found ? found.ex.title : "(exercice)";
            var remaining = gsRunAllocatedSec - Math.floor(gsRunElapsedNowMs() / 1000);
            var abs = Math.abs(remaining), mm = Math.floor(abs / 60), ss = abs % 60;
            $("tm").textContent = (remaining < 0 ? "+" : "") + (mm < 10 ? "0" : "") + mm + ":" + (ss < 10 ? "0" : "") + ss;
            $("tm").classList.toggle("over", remaining < 0);
            $("pp").textContent = gsRunPaused ? "Reprendre" : "Pause";
            $("pp").classList.toggle("run", !gsRunPaused);
            $("bpm").innerHTML = state.settings.metronome.bpm + "<small>BPM</small>";
            $("bpm").classList.toggle("idle", !metroPlaying);
            $("mp").textContent = metroPlaying ? "❚❚" : "▶";
            // la page principale peut être cachée (timers ralentis) : c'est cette fenêtre qui fait avancer l'enchaînement automatique
            if (step) gsAutoAdvanceTick(remaining, step, gsRunSession);
        }
        miniBeat = function (stepIdx, isBeat, strength) {
            if (!isBeat || !miniWinOpen()) return;
            var el = $("bpm");
            if (!el) return;
            el.classList.add("on");
            el.classList.toggle("acc", strength === 2);
            win.setTimeout(function () { el.classList.remove("on"); }, 90);
        };
        metroBeatListeners.push(miniBeat);
        refresh();
        miniTimerId = win.setInterval(refresh, 250);
        win.addEventListener("pagehide", function () { if (miniWin === win) { miniWin = null; closeMiniWindow(); } });
        refreshMiniButtons();
    }

    function renderGsRunScreen(content) {
        var session = gsRunSession;
        var step = session.steps[gsRunStepIndex];
        var found = findExerciseById(step.exerciseId);

        var topLine = document.createElement("div");
        topLine.className = "gs-run-topline";
        var progress = document.createElement("div");
        progress.className = "gs-run-progress";
        progress.textContent = "Exercice " + (gsRunStepIndex + 1) + " / " + session.steps.length;
        topLine.appendChild(progress);
        var miniBtn = document.createElement("button");
        miniBtn.type = "button";
        miniBtn.className = "gs-run-mini-btn";
        miniBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><rect x="12" y="12" width="7" height="5" rx="1" fill="currentColor"/></svg>';
        miniBtn.title = "Fenêtre flottante toujours visible : chrono, pause, métronome (utile quand on cache TrainHub pour lire un PDF, iReal Pro, une vidéo…)";
        miniBtn.setAttribute("aria-label", "Fenêtre flottante de session");
        miniBtn.addEventListener("click", openMiniWindow);
        topLine.appendChild(miniBtn);
        content.appendChild(topLine);

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
                return true; // les liens YouTube restent accessibles ici d'un clic, sans descendre jusqu'au lecteur
            });
            if ((found.ex.images || []).length) {
                var imgChip = document.createElement("button");
                imgChip.type = "button";
                imgChip.className = "file-chip gs-resource-chip";
                imgChip.innerHTML = '<span class="link-icon">' + IMAGE_ICON_SVG + '</span><span class="file-open">Image' + (found.ex.images.length > 1 ? "s (" + found.ex.images.length + ")" : "") + '</span>';
                imgChip.title = "Ouvrir l'image dans une fenêtre déplaçable ";
                imgChip.addEventListener("click", function () { openImageViewer(found.ex.images, 0, false); });
                imgChip.addEventListener("contextmenu", function (e) { e.preventDefault(); openImageViewer(found.ex.images, 0, true); });
                resourcesRow.appendChild(imgChip);
                found.ex.images.forEach(function (m) { loadImageInto(new Image(), m, function () {}); }); // préchargées
            }
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
        pauseStopRow.className = "gs-run-controls";

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
        pauseStopRow.appendChild(metroBtn);

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
            if (gsAutoAdvanceOn()) ensureMetroAudio(true); // réveille l'audio pendant ce clic (autorisé par le navigateur)
            gsWarnKey = null;
            refreshAutoBtn();
            refreshTimer();
        });
        toolsRow.appendChild(autoBtn);
        var bellBtn = document.createElement("button");
        bellBtn.type = "button";
        bellBtn.className = "gs-run-bell-btn";
        bellBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
        function refreshBellBtn() {
            var on = gsBellOn();
            bellBtn.classList.toggle("gs-run-auto-on", on);
            bellBtn.setAttribute("aria-pressed", on ? "true" : "false");
            bellBtn.title = on ? "Bip en fin d'exercice : activé" : "Bip en fin d'exercice : désactivé";
            bellBtn.setAttribute("aria-label", bellBtn.title);
        }
        refreshBellBtn();
        bellBtn.addEventListener("click", function () {
            setGsBell(!gsBellOn());
            if (gsBellOn()) { ensureMetroAudio(true); playEndBeepShort(); } // essai audible, et réveille l'audio pendant ce clic
            gsBellKeyDone = null;
            refreshBellBtn();
        });
        toolsRow.appendChild(bellBtn);
        pauseStopRow.appendChild(toolsRow);

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
            var runFixed = null;
            if (found.ex.fixedNotes && found.ex.fixedNotes.trim()) { // notes fixes : toujours sous les yeux pendant la session
                runFixed = document.createElement("div");
                runFixed.className = "gs-run-fixed";
                runFixed.textContent = found.ex.fixedNotes.trim();
                content.appendChild(runFixed);
            }
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
                if (runFixed) runFixed.hidden = open; // dépliées, les notes fixes sont déjà dans la zone d'édition
                detailsToggle.setAttribute("aria-expanded", open ? "true" : "false");
                dtChev.textContent = open ? "▾" : "▸";
                if (open && !detailsBody) {
                    detailsBody = renderExerciseDetails(found.ex);
                    detailsWrap.appendChild(detailsBody);
                    Array.prototype.forEach.call(detailsBody.querySelectorAll(".notes-textarea, .notes-fixed-textarea"), autoGrowNotes);
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
        if (document.hidden && gsRunSession && !gsRunPaused && !miniWinOpen()) {
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
        var editing = guidedSessionViewActive && gsScreen === "edit" && gsEditingSession;
        if (editing && gsDraftDirty(gsEditingSession.id)) {
            gsDraftPrompt(gsEditingSession.id, {}, function () { gsEditingSession = null; gsScreen = "list"; $guidedSessionBtn.click(); });
            return;
        }
        guidedSessionViewActive = !guidedSessionViewActive;
        $guidedSessionBtn.classList.toggle("active", guidedSessionViewActive);
        if (!guidedSessionViewActive && gsRunInterval) { clearInterval(gsRunInterval); gsRunInterval = null; }
        render();
    });
    var $freeBtn = document.getElementById("free-btn");
    if ($freeBtn) $freeBtn.addEventListener("click", function () {
        if (!freeRun) { freeStart(); return; }
        // Entraînement libre en cours : un nouveau clic propose de l'arrêter (récapitulatif ensuite).
        openChoiceMenu("Arrêter l'entraînement libre ?", "", [
            { text: "Arrêter et voir le récapitulatif", onClick: freeStop },
            { text: "Continuer", muted: true }
        ]);
    });
    var $settingsBtn = document.getElementById("settings-btn");
    if ($settingsBtn) $settingsBtn.addEventListener("click", openSettingsPanel);

    // ---------- init ----------
    render();
    setTimeout(gsLiveCheck, 400); // trace d'une session interrompée (fermeture brutale) : reprendre ou enregistrer

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
