#!/bin/bash
# Lance les 17 bancs Playwright (Chromium) de TrainHub. Usage : tests/playwright/lancer.sh [nom ...]   (ex. : lancer.sh morceaux choix)
# Sert l'appli sur :8765 et le faux lecteur YouTube sur :8766, puis arrête les deux serveurs.
cd "$(dirname "$0")/../.." || exit 1
export NODE_PATH=${NODE_PATH:-/opt/node22/lib/node_modules}
(python3 -m http.server 8765 >/dev/null 2>&1 &)
(cd tests/playwright/yt_mock && python3 -m http.server 8766 >/dev/null 2>&1 &)
sleep 1
NOMS=("$@"); [ ${#NOMS[@]} -eq 0 ] && NOMS=(de rafale choix morceaux compte note note_session favoris rideau session_ui son video preset point lecteur audio_rate audio_edit)
for t in "${NOMS[@]}"; do
  echo "--- $t"
  timeout 900 node "tests/playwright/trainhub_${t}_test.js" 2>&1 | grep -E "^FAIL|===" | cut -c1-260
done
pkill -f "^python3 -m http.server"
