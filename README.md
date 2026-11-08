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

## Mettre à jour l'appli
Après une modification, change `CACHE = "budget-interim-v1"` dans `sw.js` (v2, v3…) pour que les téléphones récupèrent la nouvelle version.
