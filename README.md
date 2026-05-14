# n8n-nodes-nextcloud-ext

[![npm version](https://img.shields.io/npm/v/n8n-nodes-nextcloud-ext.svg)](https://www.npmjs.com/package/n8n-nodes-nextcloud-ext)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![n8n community node](https://img.shields.io/badge/n8n-community%20node-orange)](https://docs.n8n.io/integrations/community-nodes/)

Nodes n8n communautaires pour **Nextcloud** — l'équivalent self-hosted des nodes Microsoft 365 (OneDrive + Excel) intégrés à n8n.

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

> **Recommandé** : créez un **mot de passe d'application** dans Nextcloud → *Paramètres → Sécurité → Mots de passe d'application* pour ne pas exposer votre mot de passe principal.

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

**Exemple — Upload** (après un node qui produit des données binaires)
```
File Path       : /Rapports/rapport-{{ $now.format('yyyy-MM') }}.xlsx
Binary Property : data
```

---

### Resource : Folder

| Opération | Description |
|---|---|
| **List** | Liste le contenu d'un dossier |
| **Create** | Crée un dossier |
| **Delete** | Supprime un dossier et son contenu |

---

### Resource : Share

| Opération | Description |
|---|---|
| **Create** | Crée un lien de partage public ou vers un utilisateur/groupe |
| **Delete** | Supprime un partage par son ID |
| **Get All** | Liste tous vos partages actifs |

**Exemple — Créer un lien public protégé par mot de passe**
```
Path        : /Documents/rapport-annuel.pdf
Share Type  : Public Link
Permissions : Read Only (1)
Password    : MonMotDePasse
Expiry Date : 2025-12-31
```

---

## Node — Nextcloud Spreadsheet

Lit et écrit dans des fichiers tableur stockés sur Nextcloud. Supporte `.xlsx`, `.xls`, `.ods` et `.csv`.

**Principe** : le node télécharge le fichier depuis Nextcloud via WebDAV, applique l'opération en mémoire ([SheetJS](https://sheetjs.com/) + [JSZip](https://stuk.github.io/jszip/) pour les tables nommées), puis ré-uploade le fichier modifié.

---

### Sélection du fichier

La sélection d'un fichier se fait en 3 champs enchaînés :

```
From    ▼  From List           ← mode : liste ou chemin direct
Folder  ▼  📁 Documents        ← filtre la liste au dossier choisi
              └ Finance
           📁 Tableaux
           / (root)
File    ▼  Arrêtés.xlsx        ← fichiers du dossier sélectionné
           Suivi.xlsx
```

| Champ | Description |
|---|---|
| **From** | `From List` (menu déroulant) ou `By Path` (expression n8n) |
| **Folder** | Sélectionne le dossier (racine + 2 niveaux) — recharge la liste de fichiers |
| **File** | Fichiers tableur disponibles dans le dossier choisi |

Pour la feuille et la table, deux modes sont aussi disponibles : **From List** ou **By Name (Expression)**.

---

### Resource : Sheet

Travaille sur les données d'une feuille de calcul. La **première ligne est traitée comme les en-têtes de colonnes**.

| Opération | Description |
|---|---|
| **Get Rows** | Retourne toutes les lignes en tant qu'items n8n |
| **Append Row** | Ajoute une nouvelle ligne à la fin de la feuille |
| **Update Row** | Modifie une ligne existante par son numéro (1 = première ligne de données) |
| **Delete Row** | Supprime une ligne par son numéro |
| **Get Columns** | Retourne la liste des en-têtes de colonnes |
| **Clear** | Supprime toutes les lignes de données en conservant l'en-tête |

#### Sélection des colonnes (Get Rows)

Le champ **Column Names or IDs** est un sélecteur multiple :
- Laissez vide → toutes les colonnes sont retournées
- Sélectionnez une ou plusieurs colonnes → seules celles-ci apparaissent dans le résultat
- Les colonnes disponibles sont chargées dynamiquement depuis votre fichier

```
Column Names or IDs :  N°  ×   INTITULÉ  ×
                       ↓
                       N°          ✓
                       INTITULÉ    ✓
                       DATE
                       Service
```

**Exemple — Get Rows (colonnes filtrées)**
```
From    : From List
Folder  : 📁 Tableaux
File    : Arrêtés.xlsx
Sheet   : Suivi
Columns : N°  ×  INTITULÉ  ×
```
Retourne uniquement N° et INTITULÉ pour chaque ligne :
```json
{ "N°": "2024-001", "INTITULÉ": "Arrêté de voirie" }
```

**Exemple — Append Row**
```
File   : Arrêtés.xlsx  /  Sheet : Suivi

Column Values:
  N°          → {{ $json.numero }}
  INTITULÉ    → {{ $json.objet }}
  DATE        → {{ $now.format('dd/MM/yyyy') }}
  Service     → {{ $json.service }}
```

---

### Resource : Table

Travaille sur une **table Excel nommée** (créée via *Insertion → Tableau* dans Excel, ou `Ctrl+T`).

Les tables nommées sont lues directement depuis le XML interne du fichier `.xlsx` (via JSZip), ce qui garantit une **compatibilité totale** avec Excel, même pour des fichiers créés ou modifiés en dehors de n8n.

Contrairement à la resource Sheet, les opérations Table maintiennent automatiquement la **plage de la table** : Append étend le `ref`, Delete le rétracte — les styles et filtres automatiques Excel sont préservés.

| Opération | Description |
|---|---|
| **List** | Liste toutes les tables nommées du classeur (nom, feuille, plage, colonnes, nb de lignes) |
| **Get Rows** | Retourne les lignes de la table (avec sélection de colonnes) |
| **Append Row** | Ajoute une ligne à la fin **et étend la plage de la table** |
| **Update Row** | Modifie une ligne par son numéro (1 = première ligne de données) |
| **Delete Row** | Supprime une ligne et **rétracte la plage de la table** |
| **Get Columns** | Retourne les en-têtes de colonnes de la table |

**Exemple — List** (retourne une ligne par table)
```json
{
  "name": "Tableau1",
  "displayName": "Tableau1",
  "sheetName": "Suivi",
  "ref": "A1:E42",
  "columns": ["N°", "INTITULÉ", "DATE", "Responsable", "Service"],
  "dataRowCount": 41
}
```

**Exemple — Get Rows (colonnes filtrées)**
```
File    : Arrêtés.xlsx
Table   : Tableau1  [Suivi · A1:E42 · 41 rows]
Columns : N°  ×  INTITULÉ  ×
```

**Exemple — Append Row**
```
File  : Arrêtés.xlsx  /  Table : Tableau1

Column Values:
  N°          → {{ $json.numero }}
  INTITULÉ    → Arrêté de voirie
  DATE        → {{ $now.format('dd/MM/yyyy') }}
  Responsable → {{ $json.agent }}
  Service     → Travaux
```
→ La table passe automatiquement de `A1:E42` à `A1:E43`.

---

### Resource : Workbook

Inspecte la structure du classeur sans lire les données.

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
/Tableaux/Arrêtés/suivi.xlsx  → sous-dossier imbriqué
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

# Vérification des types seule
npx tsc --noEmit

# Mode watch (recompile à chaque sauvegarde)
npm run dev
```

### Tester dans n8n en local

```bash
npm run build
npm link

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
- [ ] Filtrage de lignes par valeur (column = value)
- [ ] Navigation de dossiers en cascade (3+ niveaux)

---

## Licence

[MIT](LICENSE) — © 2025 wdebonne

---

## Liens utiles

- [Documentation n8n — Community Nodes](https://docs.n8n.io/integrations/community-nodes/)
- [Documentation WebDAV Nextcloud](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/WebDAV/basic.html)
- [API OCS Partage Nextcloud](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/OCS/ocs-share-api.html)
- [SheetJS (xlsx)](https://sheetjs.com/)
- [Guide de déploiement npm](DEPLOY.md)
