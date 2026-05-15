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

### Installation manuelle

```bash
npm install n8n-nodes-nextcloud-ext
```

Puis redémarrez n8n.

---

## Configuration des credentials

1. Dans n8n → **Credentials** → **New** → cherchez **Nextcloud API**
2. Renseignez les trois champs :

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

**Architecture technique :**
- **Lecture** → ExcelJS (fiable, gère toutes les structures)
- **Écriture Sheet** → xlsx-populate (modifie uniquement les cellules demandées, préserve tout le reste)
- **Écriture Table** → ExcelJS + JSZip (modification des cellules + mise à jour du ref XML de la table)
- **Détection tables** → JSZip + parsing XML direct du fichier xlsx

---

### Sélection du fichier

```
From    ▼  From List           ← mode : liste ou chemin direct
Folder  ▼  📁 Documents        ← filtre la liste de fichiers
File    ▼  Arrêtés.xlsx        ← fichiers dans le dossier choisi
```

| Champ | Description |
|---|---|
| **From** | `From List` (menu déroulant) ou `By Path` (expression n8n) |
| **Folder** | Sélectionne le dossier (racine + 2 niveaux) — recharge automatiquement la liste |
| **File** | Fichiers tableur disponibles dans le dossier choisi |

---

### Resource : Sheet

Travaille sur les données d'une feuille de calcul.

**⚙️ Paramètre clé : `Header Row`** — numéro de la ligne contenant les en-têtes de colonnes (défaut : 1). Changez-le si vos colonnes ne sont pas sur la première ligne. Tous les dropdowns de colonnes se rechargent automatiquement.

| Opération | Description |
|---|---|
| **Get Rows** | Retourne toutes les lignes en tant qu'items n8n |
| **Append Row** | Ajoute une nouvelle ligne à la fin de la feuille |
| **Update Row** | Modifie une ligne existante par son numéro (1 = première ligne après l'en-tête) |
| **Delete Row** | Supprime une ligne par son numéro |
| **Get Columns** | Retourne la liste des en-têtes de colonnes |
| **Clear** | Supprime toutes les lignes de données en conservant l'en-tête |

#### Options pour Get Rows

| Option | Défaut | Description |
|---|---|---|
| **Return Last N Rows** | 0 (= toutes) | `1` = dernière ligne seulement, `2` = 2 dernières, etc. |
| **Start From Column** | 1 | Ignore les colonnes avant la position N |

#### Sélection des colonnes (Get Rows)

Le champ **Column Names or IDs** est un sélecteur multiple chargé dynamiquement. Vide = toutes les colonnes.

**Exemple — Append Row avec Header Row = 4**
```
Header Row : 4              ← ligne avec N°, INTITULÉ, DATE, Service
Sheet      : Suivi

Column Values:
  N°       → {{ $json.numero }}
  INTITULÉ → {{ $json.objet }}
  DATE     → {{ $now.format('dd/MM/yyyy') }}
  Service  → Travaux
```

---

### Resource : Table

Travaille sur une **table Excel nommée** (créée via *Insertion → Tableau* dans Excel, ou `Ctrl+T`).

Les tables sont détectées directement depuis le XML interne du fichier `.xlsx`. Les opérations d'écriture preservent intégralement la structure de la table (plage, styles, filtres automatiques).

| Opération | Description |
|---|---|
| **List** | Liste toutes les tables nommées du classeur |
| **Get Rows** | Retourne les lignes de la table (avec sélection de colonnes) |
| **Append Row** | Ajoute une ligne et **étend automatiquement la plage de la table** |
| **Update Row** | Modifie une ligne par son numéro |
| **Delete Row** | Supprime une ligne et **rétracte la plage de la table** |
| **Get Columns** | Retourne les en-têtes de colonnes de la table |

**Exemple — Append Row sur une table**
```
File  : Arrêtés.xlsx
Table : Tableau1  [Suivi · A4:E42 · 38 rows]

Column Values:
  N°          → 2025-039
  INTITULÉ    → Arrêté de voirie
  DATE        → 15/05/2025
  Responsable → Martin
  Service     → Travaux
```
→ La table passe automatiquement de `A4:E42` à `A4:E43`.

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
/Documents/                    → dossier Documents
/Documents/rapport.xlsx        → fichier dans Documents
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

# Mode watch (recompile à chaque sauvegarde)
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
- [ ] Filtrage de lignes par valeur (column = value)
- [ ] Node **Nextcloud Talk** (messages, salons)
- [ ] Node **Nextcloud Contacts** (CardDAV)
- [ ] Node **Nextcloud Calendar** (CalDAV)
- [ ] Navigation de dossiers en cascade (3+ niveaux)

---

## Licence

[MIT](LICENSE) — © 2025 wdebonne

---

## Liens utiles

- [Documentation n8n — Community Nodes](https://docs.n8n.io/integrations/community-nodes/)
- [Documentation WebDAV Nextcloud](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/WebDAV/basic.html)
- [Guide de déploiement npm](DEPLOY.md)
- [Changelog](CHANGELOG.md)
