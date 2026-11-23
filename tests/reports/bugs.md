# Bugs trouvés par les tests de bout en bout

Tenu par le sous-agent `testeur-e2e` (phase 5 de `tests/PLAN.md`). Les bugs ne sont PAS corrigés pendant l'écriture des tests : l'utilisateur décide quand.
Gravité : **bloquant** (empêche un parcours principal), **gênant** (contournable mais pénible), **mineur** (cosmétique, ou comportement à arbitrer).

| # | Date | Module | Navigateur / appareil | Gravité | Résumé | Statut |
|---|---|---|---|---|---|---|
| D-01 | 2026-11-23 | demarrage | tous écrans > 700 px (Chromium) | mineur | Hors ligne, la pilule affiche « Se connecter (indispo… » : « (indisponible) » est coupé (libellé 151 px, contenu 170 px, ellipsis). L'info-bulle et le message au clic sont complets. Détail : `tests/reports/2026-11-23-demarrage.md` | ouvert |
| B-01 | 23/11 | metronome (banc `preset`) | Chromium de la VM, avec sortie audio (PulseAudio factice) | mineur (à confirmer) | Appliquer un préréglage du métronome PENDANT la lecture crée un contexte audio de plus (1 → 2) quand une sortie audio existe ; sans sortie audio le banc `preset` passe. Le banc attend « pas de contexte neuf » (v240). Trouvé en rejouant les 34 bancs ; à reproduire sur Safari / avec une vraie carte son avant d'y toucher (sujet délicat : bug « plus de son » du 7 nov.) | ouvert |
