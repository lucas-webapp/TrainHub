# TrainHub

Application (PWA) pour structurer l'entraînement musical quotidien (basse, guitare, piano) : catégories libres (technique, gammes, improvisation, jeu en groupe, copie de morceaux…), exercices librement nommés, et surtout des **liens cliquables** (YouTube, iReal Pro, PDF, backing tracks…) attachés à chaque exercice.

## Utilisation

Ouvrir `index.html` dans un navigateur, ou héberger le dossier statique (aucune installation/build nécessaire). Installable comme application (bouton « Installer » du navigateur) grâce au `manifest.json`.

## Fonctionnalités v1

- Un espace par instrument (Basse / Guitare / Piano par défaut, ajout/renommage/suppression libres — double-clic sur un onglet).
- Catégories personnalisables par instrument (ajout, renommage, suppression).
- Exercices : titre modifiable librement, statut (à faire / en cours / terminé / à revoir), tempo (BPM), notes libres, liens multiples ouverts en un clic.
- Filtre « À revoir » pour retrouver rapidement les exercices marqués comme intéressants à retravailler plus tard.
- Sauvegarde locale automatique (`localStorage`), export/import JSON pour transférer les données entre appareils.

## Ce qui n'est pas inclus (volontairement)

Pas d'enregistrement audio/vidéo, pas de streak/calendrier, pas de suggestions automatiques : l'app reste volontairement simple et rapide pour un usage quotidien.
