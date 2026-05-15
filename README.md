# n8n-nodes-nextcloud-ext

[![npm version](https://img.shields.io/npm/v/n8n-nodes-nextcloud-ext.svg)](https://www.npmjs.com/package/n8n-nodes-nextcloud-ext)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![n8n community node](https://img.shields.io/badge/n8n-community%20node-orange)](https://docs.n8n.io/integrations/community-nodes/)

Nodes n8n communautaires pour **Nextcloud** — l'équivalent self-hosted des nodes Microsoft 365 (OneDrive + Excel).

> Gérez vos fichiers Nextcloud et manipulez vos feuilles de calcul (`.xlsx`, `.ods`, `.csv`) — y compris les **tables Excel nommées** — directement depuis vos workflows n8n, sans aucune dépendance au cloud Microsoft.

---

## Nodes inclus

| Node | Équivalent Microsoft 365 | Description |
|---|---|---|
| **Nextcloud** | OneDrive | Gestion de fichiers et dossiers via WebDAV |
| **Nextcloud Spreadsheet** | Excel | Lecture/écriture de fichiers tableur + tables nommées |

---

## Prérequis

- n8n **≥ 1.0.0**
- Instance Nextcloud **≥ 20** accessible en HTTPS
- Node.js **≥ 18.10**

---

## Installation

### Via l'interface n8n (recommandé)

1. Ouvrez n8n → **Settings** → **Community Nodes**
2. Cliquez **Install a community node**
3. Entrez `n8n-nodes-nextcloud-ext`
4. Cliquez **Install**
5. **Redémarrez n8n** pour activer les nodes

### Installation manuelle

```bash
npm install n8n-nodes-nextcloud-ext
```

---

## Configuration des credentials

1. Dans n8n → **Credentials** → **New** → cherchez **Nextcloud API**
2. Renseignez :

| Champ | Description | Exemple |
|---|---|---|
| **Server URL** | URL de base de votre Nextcloud (sans slash final) | `https://cloud.mondomaine.fr` |
| **Username** | Votre identifiant Nextcloud | `admin` |
| **Password / App Password** | Mot de passe ou mot de passe d'application | `xxxx-xxxx-xxxx-xxxx` |

> **Recommandé** : créez un **mot de passe d'application** dans Nextcloud → *Paramètres → Sécurité → Mots de passe d'application*.

---

## Node — Nextcloud

Gestion de fichiers, dossiers et partages via l'API WebDAV de Nextcloud.

### Resource : File

| Opération | Description |
|---|---|
| **List** | Liste les fichiers d'un dossier |
| **Download** | Télécharge un fichier (sortie binaire) |
| **Upload** | Envoie un fichier binaire vers Nextcloud |
| **Delete** | Supprime un fichier |
| **Move** | Déplace ou renomme un fichier |
| **Copy** | Copie un fichier vers un autre chemin |

### Resource : Folder

| Opération | Description |
|---|---|
| **List** | Liste le contenu d'un dossier |
| **Create** | Crée un dossier |
| **Delete** | Supprime un dossier et son contenu |

### Resource : Share

| Opération | Description |
|---|---|
| **Create** | Crée un lien de partage public ou vers un utilisateur/groupe |
| **Delete** | Supprime un partage par son ID |
| **Get All** | Liste tous vos partages actifs |

---

## Node — Nextcloud Spreadsheet

Lit et écrit dans des fichiers tableur stockés sur Nextcloud. Supporte `.xlsx`, `.xls`, `.ods` et `.csv`.

> Les écritures utilisent **xlsx-populate** qui modifie uniquement les cellules demandées sans reconstruire le fichier — tableaux Excel nommés, styles, cellules fusionnées et mise en page sont préservés intégralement.

---

### Sélection du fichier

```
From    ▼  From List           ← liste dynamique ou chemin direct
Folder  ▼  📁 Documents        ← filtre la liste par dossier (2 niveaux)
File    ▼  Arrêtés.xlsx        ← fichiers du dossier sélectionné
```

---

### Resource : Sheet

Travaille sur les données d'une feuille de calcul.

**⚙️ Paramètre clé : `Header Row`** — numéro de la ligne contenant les en-têtes (défaut : 1). Tous les dropdowns de colonnes se rechargent automatiquement quand cette valeur change.

| Opération | Description |
|---|---|
| **Get Rows** | Retourne toutes les lignes en tant qu'items n8n |
| **Append Row** | Ajoute une ligne à la fin (hérite des styles de la ligne précédente) |
| **Update Row** | Modifie une ligne existante par son numéro |
| **Delete Row** | Supprime une ligne par son numéro |
| **Get Columns** | Retourne la liste des en-têtes de colonnes |
| **Clear** | Supprime toutes les lignes de données en conservant l'en-tête |

**Options pour Get Rows :**

| Option | Défaut | Description |
|---|---|---|
| **Return Last N Rows** | 0 (= toutes) | Retourner seulement les N dernières lignes |
| **Start From Column** | 1 | Ignorer les colonnes avant la position N |

**Exemple — fichier avec titre en ligne 1 et en-têtes en ligne 4 :**
```
Header Row   : 4
Sheet        : Suivi

→ Colonnes chargées : N°, INTITULÉ, DATE, Service
→ Données lues depuis la ligne 5
```

---

### Resource : Table

Travaille sur une **table Excel nommée** (créée via *Insertion → Tableau* dans Excel, `Ctrl+T`).

> La table est détectée directement depuis le XML du fichier `.xlsx`. Les écritures préservent la plage de la table, les styles et les filtres automatiques.

| Opération | Description |
|---|---|
| **List** | Liste toutes les tables nommées du classeur |
| **Get Rows** | Retourne les lignes de la table (filtres et options disponibles) |
| **Append Row** | Ajoute une ligne et **étend automatiquement la plage de la table** |
| **Update Row** | Modifie une ligne par son numéro dans la table |
| **Delete Row** | Supprime une ligne et **rétracte la plage de la table** |
| **Get Columns** | Retourne les en-têtes de colonnes de la table |

#### Options pour Get Rows (Table)

| Option / Champ | Description |
|---|---|
| **Include Row Number** | Ajoute `__rowNumber` à chaque item (1 = première ligne de données). Utilisez-le dans Update Row ou Delete Row pour cibler la ligne exacte. |
| **Return Last N Rows** | Retourner seulement les N dernières lignes |
| **Start From Column** | Ignorer les colonnes avant la position N |
| **Filters** | Filtrer les lignes par valeur de colonne (plusieurs filtres = AND) |

#### Workflow : trouver et modifier une ligne précise

```
1. Get Rows (Table)
   ├─ Table   : Suivi
   ├─ Filters : N° = {{ $json.numero }}   ← valeur à chercher
   └─ Options : Include Row Number ✓

2. Update Row (Table)
   ├─ Table      : Suivi
   ├─ Row Number : {{ $json.__rowNumber }} ← numéro retourné par Get Rows
   └─ Column Values:
        Statut → Validé
        DATE   → {{ $now.format('dd/MM/yyyy') }}
```

**Résultat de Get Rows avec Include Row Number :**
```json
{
  "__rowNumber": 42,
  "N°": 8287,
  "INTITULÉ": "Arrêté de voirie",
  "DATE": "11/05/2026",
  "Service": "D. BOURDON"
}
```

#### Exemple — Append Row sur une table

```
Table : Suivi  [Suivi · A4:D752 · 748 rows]

Column Values:
  N°       → 8289
  INTITULÉ → Arrêté de circulation
  DATE     → 15/05/2025
  Service  → D. MARTIN
```

→ La table passe automatiquement de `A4:D752` à `A4:D753`. Les styles (alignement, couleurs) sont copiés depuis la ligne précédente.

---

### Resource : Workbook

| Opération | Description |
|---|---|
| **Get Sheets** | Retourne tous les noms de feuilles du classeur |
| **Get Tables** | Retourne toutes les tables nommées de toutes les feuilles |

---

## Structure des chemins

Tous les chemins sont **relatifs à la racine de votre espace Nextcloud** :

```
/                              → racine
/Documents/rapport.xlsx        → fichier dans Documents
/Tableaux/Arrêtés/suivi.xlsx  → sous-dossier
```

---

## Développement local

```bash
git clone https://github.com/wdebonne/n8n-nodes-nextcloud-ext.git
cd n8n-nodes-nextcloud-ext

# Installer les dépendances (Windows avec proxy SSL)
NODE_OPTIONS=--use-system-ca npm install

# Compiler TypeScript → dist/
npm run build

# Mode watch
npm run dev
```

### Tester dans n8n en local

```bash
npm run build && npm link

# Dans le répertoire de données n8n :
npm link n8n-nodes-nextcloud-ext
# Redémarrer n8n
```

---

## Roadmap

- [ ] Support OAuth2 Nextcloud (PKCE)
- [ ] Node **Nextcloud Talk** (messages, salons)
- [ ] Node **Nextcloud Contacts** (CardDAV)
- [ ] Node **Nextcloud Calendar** (CalDAV)

---

## Licence

[MIT](LICENSE) — © 2025 wdebonne

---

## Liens

- [npmjs.com/package/n8n-nodes-nextcloud-ext](https://www.npmjs.com/package/n8n-nodes-nextcloud-ext)
- [GitHub](https://github.com/wdebonne/n8n-nodes-nextcloud-ext)
- [Changelog](CHANGELOG.md)
- [Guide de déploiement](DEPLOY.md)
- [Documentation n8n — Community Nodes](https://docs.n8n.io/integrations/community-nodes/)
