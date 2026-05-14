# Bibliothèque Anki

Un site simple qui regroupe tes paquets Anki et leurs tableaux de vocabulaire.
Tout est sur **une seule page**, organisé par cours.

- Téléchargement des paquets `.apkg`
- Tableau de vocabulaire pour chaque cours (avec recherche)
- Recherche globale + filtre par catégorie
- Design sombre élégant inspiré de tes cartes Anki (bleu nuit, or, vert émeraude)
- Pensé pour rester fluide même avec **plus de 1000 mots** par cours
- Responsive : marche sur téléphone, tablette et ordinateur

---

## 🚀 Démarrer en local

Tu as besoin de **Node.js** installé (version 18 ou plus récente — télécharger sur https://nodejs.org).

```bash
npm install     # à faire une seule fois, installe les dépendances
npm run dev     # lance le site sur http://localhost:5173
```

Ouvre http://localhost:5173 dans ton navigateur. Le site se rafraîchit automatiquement quand tu modifies un fichier.

Pour construire la version finale (celle qui sera déployée) :

```bash
npm run build       # crée le dossier dist/
npm run preview     # teste la version finale localement
```

---

## 📁 Structure du projet

```
bibliotheque-anki/
├── public/                          ← Fichiers servis tels quels par le site
│   ├── anki/
│   │   └── sourate-furqan.apkg      ← TES PAQUETS ANKI ICI
│   └── data/
│       ├── courses.json             ← LA LISTE DE TES COURS
│       └── vocabulary/
│           └── sourate-furqan.json  ← UN FICHIER PAR COURS
│
├── src/
│   ├── App.jsx                      ← Le code du site (à ne pas toucher)
│   ├── main.jsx
│   └── App.css                      ← Le design
│
├── index.html
├── package.json
├── vite.config.js
├── netlify.toml                     ← Config pour Netlify
└── README.md                        ← Ce fichier
```

👉 **En pratique, pour ajouter du contenu, tu ne modifies que `public/data/` et `public/anki/`.**

---

## ➕ Ajouter un nouveau cours (exemple : Sourate Al-Mulk)

Imagine que tu veuilles ajouter le cours "Sourate Al-Mulk".

### Étape 1 — Mettre le paquet Anki en place

Place ton fichier dans `public/anki/` :

```
public/anki/sourate-mulk.apkg
```

> ⚠️ **Important** : le nom du fichier doit être **sans espaces ni accents** (utilise des tirets `-`).
> ✅ `sourate-mulk.apkg`
> ❌ `Sourate Al-Mulk.apkg`

### Étape 2 — Créer le fichier de vocabulaire

Crée un nouveau fichier `public/data/vocabulary/sourate-mulk.json` avec ce modèle :

```json
[
  {
    "type": "nom",
    "arabic": "كِتَاب",
    "translation": "Livre",
    "singular": "كِتَاب",
    "plural": "كُتُب",
    "synonym": "",
    "opposite": ""
  },
  {
    "type": "verbe",
    "arabic": "كَتَبَ",
    "translation": "Écrire",
    "past": "كَتَبَ",
    "present": "يَكْتُبُ",
    "masdar": "كِتَابَة",
    "harfJarr": ""
  }
]
```

**Règles importantes pour le JSON :**

- **Verbes** : champs attendus → `type: "verbe"`, `arabic`, `translation`, `past`, `present`, `masdar`, `harfJarr` (optionnel)
- **Noms/adjectifs** : champs attendus → `type: "nom"`, `arabic`, `translation`, `singular`, `plural`, `synonym` (optionnel), `opposite` (optionnel)
- Les **champs vides** (`""`) ne s'affichent pas dans le tableau — laisse-les vides plutôt que de les supprimer, c'est plus sûr.
- Le champ `arabic` est ce qui est affiché en gros dans la colonne arabe du tableau.

### Étape 3 — Inscrire le cours dans `courses.json`

Ouvre `public/data/courses.json` et **ajoute** ton nouveau cours dans la liste (attention aux virgules entre cours) :

```json
[
  {
    "id": "sourate-furqan",
    "title": "Sourate Al-Furqan",
    ...
  },
  {
    "id": "sourate-mulk",
    "title": "Sourate Al-Mulk",
    "category": "Arabe - Coran",
    "description": "Vocabulaire lié à la sourate Al-Mulk.",
    "level": "Intermédiaire",
    "ankiFiles": [
      {
        "title": "Télécharger le paquet Anki - Sourate Al-Mulk",
        "file": "/anki/sourate-mulk.apkg"
      }
    ],
    "vocabularyFile": "/data/vocabulary/sourate-mulk.json"
  }
]
```

> 💡 Le `id` doit être unique et identique au nom de ton fichier JSON (sans `.json`).

### Étape 4 — Tester en local

```bash
npm run dev
```

Vérifie que le nouveau cours apparaît, que le bouton de téléchargement marche, et que le tableau de vocabulaire s'affiche correctement.

### Étape 5 — Pousser sur GitHub

```bash
git add .
git commit -m "Ajout du cours Sourate Al-Mulk"
git push
```

Netlify détecte le push, reconstruit et redéploie automatiquement le site (1 à 2 minutes).

---

## 🌐 Déployer sur Netlify (première fois)

1. **Créer un dépôt GitHub** : mets tout ce projet sur GitHub.
2. **Aller sur https://app.netlify.com** → "Add new site" → "Import an existing project" → choisis ton dépôt GitHub.
3. Netlify détecte automatiquement les bons réglages grâce au fichier `netlify.toml` :
   - Commande de build : `npm run build`
   - Dossier publié : `dist`
4. Clique sur "Deploy site". Le premier déploiement prend ~1 minute.

C'est tout. Désormais, **chaque fois que tu pousses sur GitHub, Netlify redéploie automatiquement**.

---

## 🛠 Fonctionnalités

### Recherche dans le tableau
- Marche en français (insensible aux accents : "preparer" trouve "Préparer")
- Marche en arabe **sans avoir à taper les diacritiques** (tachkīl) : "فتح" trouve "فَتَحَ"
- Cherche dans : arabe, traduction, passé, présent, masdar, singulier, pluriel, synonyme, contraire, harf jarr

### Chargement progressif
- Le vocabulaire n'est téléchargé que quand tu cliques sur "Voir le tableau" → le site s'ouvre instantanément même avec des dizaines de cours.
- Affichage par tranches de **50 mots**, bouton "Afficher 50 mots de plus" — testé avec 1200 entrées, ça reste fluide.
- Quand tu fermes puis rouvres un tableau, il est déjà en mémoire (instantané).

### Responsive
- Sur ordinateur : tableau classique.
- Sur mobile : chaque mot devient une carte, plus lisible que de scroller horizontalement.

---

## ⚠️ Erreurs fréquentes à éviter

| Problème | Solution |
|---|---|
| Le cours n'apparaît pas | Vérifie que tu as bien ajouté la **virgule** entre cours dans `courses.json` |
| Le bouton de téléchargement renvoie une page d'erreur | Le fichier `.apkg` n'est pas dans `public/anki/` ou le nom ne correspond pas au champ `file` |
| Le tableau affiche "Erreur lors du chargement du vocabulaire" | Le chemin `vocabularyFile` ne correspond pas au vrai fichier, ou il y a une erreur de syntaxe dans le JSON |
| Erreur de JSON au lancement | Une virgule en trop, une virgule manquante, ou un guillemet oublié. Colle ton JSON sur **https://jsonlint.com** pour le vérifier |
| Les caractères arabes s'affichent bizarrement | Vérifie que ton fichier JSON est bien enregistré en **UTF-8** |
| Le fichier `.apkg` est très lourd | Aucun problème pour le site, mais évite > 100 Mo pour rester sympa avec les visiteurs |
| Le filtre par catégorie ne montre pas ma nouvelle catégorie | Les catégories sont générées automatiquement depuis `courses.json` — rafraîchis la page |

### Vérifier qu'un JSON est valide

Avant chaque commit, copie ton fichier sur **https://jsonlint.com** et clique sur "Validate JSON". Si c'est rouge, l'erreur est indiquée ligne par ligne.

---

## 🎨 Modifier les catégories

Les catégories sont **automatiquement** extraites de `courses.json`. Pour en ajouter une, il suffit de mettre une nouvelle valeur dans le champ `category` d'un cours :

```json
"category": "Hadith"
```

Le bouton "Hadith" apparaîtra dans le filtre dès que le cours est en place.

---

## 🔮 Plus tard : interface admin (optionnel)

Pour la première version, le plus simple reste **GitHub + édition des JSON à la main**. C'est rapide, fiable, gratuit, et sans dépendance.

Si plus tard tu veux éviter d'éditer les JSON manuellement, voici les options par ordre de simplicité :

1. **Decap CMS** (anciennement Netlify CMS, gratuit) : ajoute une page `/admin` qui te donne une interface graphique pour éditer `courses.json` et les fichiers de vocabulaire. Ça se branche sur GitHub par derrière, donc rien ne change côté déploiement.
2. **Google Sheets → JSON** : tu maintiens tes mots dans un Google Sheets et un petit script (ou un service comme "SheetDB") convertit en JSON.
3. **Formulaire protégé maison** plus tard, mais c'est plus de travail.

Tu peux commencer sans rien de tout ça et ajouter Decap CMS quand le besoin se présente.

---

## 📦 Technologies utilisées

- **React 18** + **Vite** (rapide, simple, parfait pour Netlify)
- Aucune base de données — tout est en JSON statique
- Aucun framework CSS externe — CSS écrit à la main pour rester léger (~50 KB gzippé)

Bonne route avec Bibliothèque Anki ! 🌙
