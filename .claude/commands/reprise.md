---
description: Reprendre le travail après /clear ou /compact (relit CLAUDE-TRAINHUB.md, annonce la suite prévue)
---
Reprise du travail sur TrainHub après un `/clear` ou un `/compact`. Réponds en français, court. Le travail se fait dans `/home/user/trainhub` (pas dans HarmoHub).

1. Lis **en entier** `CLAUDE-TRAINHUB.md` (racine du dépôt `trainhub`) : c'est la mémoire de reprise (règles, architecture, tests, usage). Ne relis pas d'autres fichiers que ceux que la suite exige (`script.js` et `style.css` sont très longs : lecture par plages).
2. Regarde l'état git de `trainhub` : `git status -sb`, `git log --oneline -3`, et `git ls-remote origin main structure-dossiers` (les deux branches doivent pointer sur le même commit). Signale tout travail non commité ou non poussé.
3. Va à la section **« Suite à faire »** de `CLAUDE-TRAINHUB.md` :
   - **Une suite est prévue**, que l'utilisateur a demandée ou validée : annonce-la en deux ou trois lignes, puis fais-la en suivant le « Cycle de chaque demande ». Ne lui demande pas de te la réexpliquer.
   - **La suite attend une décision** (point ouvert, ou nouveauté importante : il aime en discuter d'abord) : pose cette seule question, avec ton avis.
   - **« Rien de prévu »**, ou section absente : dis-le en une ligne, rappelle en deux ou trois puces les idées déjà proposées (section « Idées proposées, pas encore faites ») et demande ce qui vient ensuite. Ne commence rien. Ne repropose jamais ce que « Ce que l'utilisateur ne veut PAS » exclut.
4. Si l'utilisateur ajoute une précision après `/reprise`, elle prime sur le fichier : $ARGUMENTS
