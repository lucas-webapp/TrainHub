# TrainHub

Application (PWA) pour structurer l'entraînement musical quotidien (basse, guitare, piano) : grands chapitres personnalisables (technique, gammes, improvisation, jeu en groupe, copie de morceaux…) avec des sous-dossiers imbriqués si besoin, exercices librement nommés, et surtout des **liens cliquables** (YouTube, iReal Pro, PDF, backing tracks…) attachés à chaque exercice.

## Utilisation

Ouvrir `index.html` dans un navigateur, ou héberger le dossier statique (aucune installation/build nécessaire). Installable comme application (bouton « Installer » du navigateur) grâce au `manifest.json`.

## Fonctionnalités v1

- Un espace par instrument, groupe ou projet (Basse / Guitare / Piano par défaut — seule la Basse a des dossiers de départ —, ajout/renommage/suppression libres — double-clic sur un onglet).
- Bandeau de « grands chapitres » personnalisables par instrument (ajout, renommage, suppression, réorganisation), chacun pouvant contenir des sous-dossiers imbriqués (jusqu'à 5 niveaux, ex. Technique / Elie / Vitesse / Extraits morceaux / Funk), avec fil d'Ariane pour naviguer.
- Exercices (à n'importe quel niveau) : titre modifiable librement, statut (à faire / en cours / terminé / à revoir), tempo (BPM), notes libres, liens multiples ouverts en un clic, réorganisation manuelle.
- Recherche par titre dans tout l'instrument (tous chapitres/sous-dossiers confondus), avec le chemin affiché pour chaque résultat.
- Filtre « À revoir » (tree-wide) pour retrouver rapidement les exercices marqués comme intéressants à retravailler plus tard.
- Date de dernière modification par exercice, masquée par défaut — activable via le bouton horloge de la barre du haut.
- Sauvegarde locale automatique (`localStorage`) + synchro cloud optionnelle (connexion Google / Firebase), export/import JSON en secours.
- Fichiers joints (audio, PDF) et images envoyés dans le compte (Firestore, offre gratuite, sans Firebase Storage) : un fichier est coupé en morceaux de 800 Ko, 30 Mo au plus par fichier, téléchargé à la demande puis gardé sur l'appareil. Paramètres › Données › « Espace de stockage » : total utilisé sur la limite gratuite de 1 Go, détail (exercices, journal, images, audio, PDF, corbeille), fichiers les plus lourds, taille du document principal (1 Mio au plus) et plafond réglable pour TrainHub (le projet Firebase est partagé avec d'autres applis).

## Ce qui n'est pas inclus (volontairement)

Pas d'enregistrement audio/vidéo, pas de streak/calendrier, pas de suggestions automatiques : l'app reste volontairement simple et rapide pour un usage quotidien.
