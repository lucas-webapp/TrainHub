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
- Médias d'un exercice en onglets (Vidéos · Images · Liens et fichiers), un seul volet ouvert à la fois : moins de défilement pour retrouver une capture.
- Gammes & arpèges : le dé ouvre une fenêtre de tirage au sort (altérations, familles, gammes une à une, toniques, historique). Dans une session, un petit dé à côté du chrono tire la gamme de certains exercices (réglable à l'édition de la session ou pendant le guidage) ; une horloge discrète affiche l'heure en session et en entraînement libre ; l'alerte de fin d'exercice est une note douce, quelques secondes avant la fin.
- Sauvegarde locale automatique (`localStorage`) + synchro cloud optionnelle (connexion Google / Firebase), export/import JSON en secours.
- Session guidée : le chrono continue quand TrainHub passe au second plan (autre fenêtre, plein écran d'un autre logiciel ; la pause automatique est un réglage, Paramètres › Sessions). On peut parcourir les dossiers pendant une session : une bande reste en haut avec l'exercice, le temps restant, pause/reprise et « Session » pour revenir. Les captures de l'exercice s'affichent d'office sous les boutons de l'écran de session.
- Petite fenêtre de session : vraie fenêtre toujours au-dessus des autres applications sur Chrome/Edge ; sur Safari/Firefox, vidéo en image dans l'image (chrono, pause, précédent/suivant), à défaut une fenêtre ordinaire (réglage « Petite fenêtre »).
- Lecteur audio : vitesse de 25 à 115 %, boutons − et + par pas de 5 %.
- Captures d'écran jointes : un nom sous chaque vignette, modifiable d'un clic (aussi pendant une session) et retrouvé par la recherche. Onglets des médias plus visibles (logo, reflet lumineux dans le verre dépoli). Volume du métronome : l'icône coupe / rétablit le son, la barre se réduit sans chevaucher.
- Fichiers joints (audio, PDF) et images envoyés dans le compte (Firestore, offre gratuite, sans Firebase Storage) : un fichier est coupé en morceaux de 800 Ko, 30 Mo au plus par fichier, téléchargé à la demande puis gardé sur l'appareil. Paramètres › Données › « Espace de stockage » : total utilisé sur la limite gratuite de 1 Go, détail (exercices, journal, images, audio, PDF, corbeille), fichiers les plus lourds, taille du document principal (1 Mio au plus) et plafond réglable pour TrainHub (le projet Firebase est partagé avec d'autres applis).

## Ce qui n'est pas inclus (volontairement)

Pas d'enregistrement audio/vidéo, pas de streak/calendrier, pas de suggestions automatiques : l'app reste volontairement simple et rapide pour un usage quotidien.
