#!/usr/bin/env bash
# PRÉPARATION DES TESTS (idempotent : ne refait rien de ce qui est déjà fait). Lancé par le hook SessionStart dans le cloud (.claude/settings.json),
# ou à la main : `bash scripts/setup-tests.sh`. Voir la section « Tests » de CLAUDE.md et tests/PLAN.md.
set -uo pipefail
cd "$(dirname "$0")/.."
log() { echo "[setup-tests] $*"; }
debut=$(date +%s)

# 1. Dépendances du projet (@playwright/test, firebase pour le SDK servi en test, firebase-tools pour les émulateurs).
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  log "npm ci"; npm ci --no-fund --no-audit --loglevel=error || { log "ÉCHEC npm ci"; exit 1; }
else log "dépendances déjà installées"; fi

# 2. playwright-cli (exploration) et son skill, versionné dans .claude/skills/.
command -v playwright-cli >/dev/null 2>&1 || { log "installation de playwright-cli"; npm install -g @playwright/cli@latest --loglevel=error; }
[ -f .claude/skills/playwright-cli/SKILL.md ] || playwright-cli install --skills
# son propre Chromium (sa version de Playwright n'est pas celle du projet ; .playwright/cli.config.json lui demande « chromium », pas Google Chrome).
# Constat du 23/11 : sans ce téléchargement, `playwright-cli open` échoue. Idempotent (rien n'est retéléchargé s'il est déjà là).
playwright-cli install-browser chromium >/dev/null 2>&1 && log "navigateur de playwright-cli prêt" || log "ÉCHEC du navigateur de playwright-cli (cdn.playwright.dev ?)"

# 3. Navigateurs, avec la version de Playwright DU PROJET (pas celle installée en global).
present() { node -e "const fs=require('fs');const p=require('@playwright/test')['$1'].executablePath();process.exit(fs.existsSync(p)?0:1)" 2>/dev/null; }
for b in chromium firefox webkit; do
  if present "$b"; then log "$b déjà là"; continue; fi
  if [ "$b" != chromium ] && ! curl -s -o /dev/null -m 8 https://cdn.playwright.dev/ ; then
    log "$b : téléchargement BLOQUÉ par le réseau (cdn.playwright.dev) — ce navigateur ne tourne qu'en CI"; continue
  fi
  log "installation de $b"; npx playwright install --with-deps "$b" || log "ÉCHEC de l'installation de $b"
done
if command -v microsoft-edge-stable >/dev/null 2>&1; then log "edge déjà là"; else log "installation d'Edge"; npx playwright install msedge || log "ÉCHEC de l'installation d'Edge (packages.microsoft.com)"; fi

# 4. Émulateur Firestore (archive Java, téléchargée une fois depuis storage.googleapis.com). L'émulateur Auth est en JavaScript.
command -v java >/dev/null 2>&1 || log "ATTENTION : Java manque (les émulateurs Firebase en ont besoin)"
ls ~/.cache/firebase/emulators/cloud-firestore-emulator-*.jar >/dev/null 2>&1 || npx firebase setup:emulators:firestore >/dev/null 2>&1 || log "ÉCHEC du téléchargement de l'émulateur Firestore"

# 5. Une SORTIE AUDIO FACTICE (Linux) : sans carte son, Firefox laisse l'AudioContext « suspended » et la lecture ne démarre jamais (constaté le 16/11 ;
#    Chromium et WebKit ont leur propre sortie factice). Un vrai utilisateur a une carte son : ce n'est pas un défaut de l'appli.
if [ "$(uname)" = Linux ]; then
  command -v pulseaudio >/dev/null 2>&1 || { log "installation de PulseAudio"; (sudo -n true 2>/dev/null && SUDO=sudo || SUDO=""; DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -q pulseaudio >/dev/null 2>&1) || log "ÉCHEC de l'installation de PulseAudio"; }
  if command -v pulseaudio >/dev/null 2>&1 && ! pactl info >/dev/null 2>&1; then
    pulseaudio -D --exit-idle-time=-1 2>/dev/null; sleep 1; pactl load-module module-null-sink sink_name=factice >/dev/null 2>&1 || true
  fi
  pactl info >/dev/null 2>&1 && log "sortie audio factice prête" || log "ATTENTION : pas de sortie audio (les tests de lecture échoueront sous Firefox)"
fi

log "terminé en $(( $(date +%s) - debut )) s"
