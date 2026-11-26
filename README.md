<img src="assets/logo-filigrane.svg" alt="" width="72" height="72" />

# Filigrane

Éditeur de devis et factures : application statique (HTML, CSS, JavaScript) pour écrire des devis et des factures A4 et les enregistrer en PDF.
Aucun serveur, aucun compte, aucune installation. Seules les polices viennent de Google Fonts : une connexion internet est nécessaire pour les afficher (sans connexion, l'outil fonctionne avec des polices de repli).

## Utilisation

1. Décompressez le dossier, puis double-cliquez sur `index.html` (Mac ou Windows, Chrome, Edge, Firefox ou Safari).
2. Cliquez sur **⚙ Profil** (tiroir à droite) et renseignez-le une fois : nom légal, EI, adresse, SIRET, mentions, mention TVA, coordonnées du pied de page.
3. Remplissez le document à gauche, l'aperçu A4 se met à jour à droite. Les montants acceptent la virgule (`12,50`) ; une saisie invalide est signalée en rouge et bloque l'impression.
4. **Imprimer / PDF** (sur téléphone : **PDF**), puis choisissez « Enregistrer au format PDF ». Désactivez « En-têtes et pieds de page » si le navigateur les propose. Seul le document est imprimé.
5. Dans le devis, **+ Nouveau > Facture depuis ce devis** demande confirmation puis ouvre une copie indépendante (client, prestation, lignes) : saisissez son numéro, sa date d'émission et ses références. Le devis n'est pas modifié.

Le nom du document (en haut à gauche, cliquez pour le modifier) ne contient que des lettres, chiffres et `_` : il sert de nom au fichier PDF. La colonne de saisie se redimensionne en glissant la barre centrale (double-clic : largeur par défaut). Sur téléphone, trois onglets : Saisie, Aperçu, Enregistrer en PDF.

Un document de plus d'une page est coupé proprement : le pied de page est repris sur chaque page et rien ne le recouvre.

## Données et sauvegardes

- Profil et documents sont gardés dans le stockage du navigateur (par ordinateur et par navigateur). Vider les données du site les efface.
- **Exporter un brouillon (JSON)** / **Ouvrir un brouillon** : pour sauvegarder, ou reprendre un document sur un autre ordinateur (le profil est inclus).
- Le dossier `exemples/` ne contient que des données fictives.

## Police

Le choix se fait dans **⚙ Profil > Police du document** :

- **Sans serif** : **Open Sans** (Google Fonts).
- **Serif** : **Lora** (Google Fonts).
- **Sans serif arrondie** : **Montserrat** (Google Fonts).

Le logotype « Filigrane » de la barre du haut est écrit en **Poppins** (Google Fonts).

Les polices Google sont chargées depuis `fonts.googleapis.com` par la balise `<link>` de `index.html` : l'ordinateur du visiteur contacte donc Google (adresse IP transmise). Aucun fichier de police n'est stocké dans le dépôt. Hors connexion, des polices de repli locales prennent le relais et l'interface le signale. Les polices n'ont pas exactement les mêmes largeurs qu'Avenir : les retours à la ligne peuvent différer légèrement des PDF de référence.

## Votre logo et votre nom de marque

Le dépôt ne contient que des images anonymes (`assets/`). Chaque artiste importe les siennes dans « Profil de l'émetteur » ; elles restent dans son navigateur et dans ses brouillons JSON, jamais dans le dépôt.

- **En-tête** : SVG de **190,5 unités de large** (hauteur libre, environ 40 ; `viewBox="0 0 190.5 40"`), affiché à **67,3 mm de large** en haut à gauche, centré dans cet espace. Texte vectorisé (tracés), fond transparent, couleur `#696e79`. PNG ou JPEG possibles : au moins 1 200 px de large. **Sans la baseline** : elle se saisit dans le profil (« Baseline sous le logo »), en 10 pt, centrée sous le logo, dans la police du document. Le champ « Taille du logo » (en % de l'espace réservé, 20 à 150) rectifie sa taille.
- **Petit logo du pied de page** : SVG de **29,9 × 18,8 unités** (rapport 1,6 : 1), affiché à **10,5 × 6,6 mm**, centré. PNG ou JPEG : au moins 300 × 188 px.
- 400 Ko maximum par image. Une image de proportions différentes est réduite pour tenir dans son cadre.

## Publication sur GitHub Pages

Le dossier est déjà prêt : pas de build, tous les chemins sont relatifs (il fonctionne à la racine d'un site comme dans un sous-dossier `utilisateur.github.io/depot/`), et le fichier `.nojekyll` évite tout traitement par GitHub.

1. Créez un dépôt GitHub et envoyez-y le contenu de ce dossier (`index.html` à la racine du dépôt).
2. Dans le dépôt : **Settings > Pages > Build and deployment**, source **Deploy from a branch**, branche `main`, dossier `/ (root)`.
3. Après une minute environ, l'outil est disponible à l'adresse `https://utilisateur.github.io/depot/`.

Les documents et le profil sont gardés dans le navigateur de chaque personne qui ouvre le site (rien n'est envoyé au dépôt ni à un serveur) : un autre navigateur ou un autre ordinateur repart d'un profil vide, d'où les exports JSON.
Un dépôt public rend le code visible de tous. Gardez-y uniquement les images anonymes et les données fictives.

## Vérification

`node tests/money.test.js` (facultatif) contrôle le calcul en centimes et la validation des saisies.
