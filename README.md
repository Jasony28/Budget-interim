# 💶 Budget Intérim

Appli web (PWA) pour gérer son budget d'intérimaire : missions, paies, charges fixes, dépenses, épargne et coussin de sécurité. Elle peut aussi scanner une fiche de paie avec Gemini.

**L'appli :** https://jasony28.github.io/Budget-interim/

**Fonctions**
- 💶 Missions et paies (reçues / attendues), estimation du net à partir des heures
- 📷 Scan de fiche de paie avec Gemini : brut, net, retenues, heures, taux, en un clic
- 🧾 Scan de factures et tickets (photo ou PDF) : montant, catégorie, échéance, factures récurrentes → charges fixes
- 💸 Dépenses par catégorie, recherche, charges fixes mensuelles, factures à payer
- 📊 Budgets par catégorie avec alertes avant dépassement
- 📅 Budget par jour jusqu'à la fin du mois
- 🛟 Coussin de sécurité (combien de mois tu tiens sans mission) + versements / retraits
- 🎯 Objectifs d'épargne (permis, voiture…) avec montant à mettre de côté chaque mois
- ⏱️ Heures à faire par mois pour couvrir tes dépenses + simulateur de mission
- 📈 Stats annuelles : net, heures, net/heure réel, par agence, mois par mois
- 🔔 Alertes : fin de mission, paie en retard, budget dépassé, épargne à faire
- 📤 Export CSV (Excel / déclaration d'impôts) + sauvegarde JSON
- ✏️ Tout est modifiable : touche une ligne pour l'éditer
- 🎁 Prime de fin d'année (65 j / 494 h, 8,33 %) et 🏖️ pécule de vacances (ONVA) estimés
- 📑 Scan du contrat d'intérim : crée ou prolonge la mission (taux, heures, dates, primes)
- 🎬 Écran de démarrage animé
- 🚗 Frais de trajet : adresse de départ + adresse de mission → km, coût carburant par jour/mois, net réel par heure, couverture de la prime de mobilité (itinéraire © OpenStreetMap, calcul uniquement sur demande)
- 📋 Rappels des démarches belges : fiches 281.10, déclaration d'impôts, ONVA, Fonds social
- 📤 Partager vers l'appli : depuis la galerie ou un mail (appli installée), détection automatique du type de document
- 📚 Anciennes fiches de paie en lot : historique seulement (comptent pour la prime, le pécule et les stats, pas comme argent disponible)
- 🏦 Import du CSV de la banque (CBC/KBC, Belfius, ING…) : lu sur le téléphone, catégories devinées, doublons ignorés
- 🔁 Détection des abonnements → charges fixes
- ❤️ Score de santé financière du mois (/100) avec conseils
- 📄 Bilan PDF du mois
- 👆 Déverrouillage par empreinte (en plus du code PIN)
- 🗓️ Calendrier des missions + pointage des heures (jours fériés belges), contrôle automatique des fiches de paie
- 🍽️ Chèques-repas : solde et dates d'expiration
- 🤖 Assistant IA : « Analyse mon mois » + questions libres sur ton budget
- 🧾 Plusieurs tickets d'un coup, 🏦 import de relevé bancaire (capture ou PDF)
- 🔮 Prévision du mois prochain, courbe d'épargne, camembert, comparaison avec l'an dernier
- 🤝 Dettes & prêts, 💪 défi 52 semaines, catégories personnalisées
- 🔒 Code PIN, 🙈 mode discret, 🔔 rappels (factures, fins de mission, prélèvements), raccourcis sur l'icône
- 🖼️ Photos et PDF des factures et fiches de paie gardés et consultables (galerie, appareil photo ou fichier)

**Technique**
- Connexion avec Google (Firebase Auth)
- Données synchronisées entre appareils et disponibles hors ligne (Firestore)
- Scan de fiche de paie avec Gemini (Firebase AI Logic, offre gratuite)
- S'installe sur l'écran d'accueil comme une vraie appli

---

## Mise en place (une seule fois)

### 1. Créer le projet Firebase
1. Va sur https://console.firebase.google.com puis **Créer un projet**, par exemple « budget-interim ». Google Analytics n'est pas nécessaire.
2. Dans le projet, clique sur l'icône **Web `</>`** pour ajouter une appli Web, avec le surnom « Budget Intérim ». Ne coche pas Hosting.
3. Copie l'objet `firebaseConfig` affiché et colle les valeurs dans **`firebase-config.js`**.

### 2. Activer la connexion Google
1. **Build → Authentication → Commencer**
2. Onglet **Méthode de connexion**, choisis **Google**, active-le et indique ton e-mail d'assistance, puis **Enregistrer**.
3. Onglet **Paramètres → Domaines autorisés**, puis **Ajouter un domaine** : `jasony28.github.io`

### 3. Créer la base Firestore
1. **Build → Firestore Database → Créer une base de données**, emplacement `europe-west1` (Belgique).
2. Choisis le mode production.
3. Onglet **Règles** : colle le contenu du fichier **`firestore.rules`**, puis **Publier**.

### 4. Activer le scan de fiche de paie (facultatif)
1. **AI Services → AI Logic → Commencer**, puis choisis **Gemini Developer API**. C'est l'offre gratuite, sans carte bancaire.
2. L'assistant active **App Check** : choisis **reCAPTCHA Enterprise**, crée une clé pour le domaine `jasony28.github.io`, puis copie la **clé de site**.
3. Colle-la dans `firebase-config.js` → `recaptchaEnterpriseSiteKey`.
4. Si le modèle n'est plus disponible un jour, change `geminiModel` dans le même fichier.

### 5. Activer GitHub Pages
Sur le dépôt GitHub : **Settings → Pages → Source : Deploy from a branch → `main` / `(root)` → Save**. Après une minute, l'appli est en ligne.

### 6. Installer sur le téléphone
Ouvre l'adresse de l'appli dans Chrome, puis **⋮ → Ajouter à l'écran d'accueil**.

---

## Fichiers
| Fichier | Rôle |
|---|---|
| `index.html` | Interface et styles |
| `app.js` | Logique de l'appli, Firebase, scan Gemini |
| `firebase-config.js` | **Ta configuration** (à remplir) |
| `firestore.rules` | Règles de sécurité : chacun ne voit que son budget |
| `sw.js`, `manifest.webmanifest` | Fonctionnement hors ligne et installation |

> La config Firebase (apiKey, etc.) peut être publique sans risque : ce sont les règles Firestore et App Check qui protègent tes données et le quota Gemini.

## Publier une nouvelle version
Augmente le numéro au même endroit partout (ex. 7 → 8) :
- `version.json` → `"version": 8`
- `app.js` → `APP_VERSION=8` et `firebase-config.js?v=8`
- `index.html` → `app.js?v=8` et « Version 8 »
- `sw.js` → `CACHE = "budget-interim-v8"` et les `?v=8`

Les téléphones affichent alors le bandeau « Nouvelle version disponible ». Le bouton ↻ force la mise à jour à tout moment.

**Code et tests**
- `calculs.js` : toutes les règles de calcul belges (impôt, ONSS, bonus à l'emploi, prime de fin d'année, pécule, bilan fiscal), sans interface ni Firebase.
- `tests/calculs.test.js` : tests automatiques de ces calculs. Pour les lancer : `npm test` (Node.js 22 ou plus, rien à installer).
- Les tests tournent aussi tout seuls sur GitHub à chaque envoi (onglet *Actions*) : une croix rouge sur un commit veut dire qu'un calcul a changé.
