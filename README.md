# n8n-nodes-nextcloud-ext

[![npm version](https://img.shields.io/npm/v/n8n-nodes-nextcloud-ext.svg)](https://www.npmjs.com/package/n8n-nodes-nextcloud-ext)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![n8n community node](https://img.shields.io/badge/n8n-community%20node-orange)](https://docs.n8n.io/integrations/community-nodes/)

Nodes n8n communautaires pour **Nextcloud** — l'équivalent self-hosted des nodes Microsoft 365 (OneDrive + Excel + Word) avec en plus la gestion des formulaires PDF.

> Gérez vos fichiers Nextcloud, manipulez vos feuilles de calcul (`.xlsx`, `.ods`, `.csv`) avec les **tables Excel nommées**, générez des documents depuis des templates, et lisez/remplissez vos **formulaires PDF** — directement depuis vos workflows n8n, sans aucune dépendance au cloud Microsoft.

---

## Nodes inclus

| Node | Équivalent Microsoft 365 | Description |
|---|---|---|
| **Nextcloud** | OneDrive | Gestion de fichiers et dossiers via WebDAV |
| **Nextcloud Spreadsheet** | Excel | Lecture/écriture de fichiers tableur + tables nommées |
| **Nextcloud Doc Template** | Word (Mail Merge) | Remplissage de templates DOCX/ODT via syntaxe Carbone ({d.variable}) |
| **Nextcloud PDF** | — | Lecture et remplissage des champs de formulaire AcroForm de PDFs |

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

---

## Node — Nextcloud Doc Template

Génère des documents Word/ODT à partir de templates stockés sur Nextcloud, en utilisant la syntaxe **Carbone** — identique à `n8n-nodes-carbonejs` mais avec votre instance Nextcloud.

> Supporte les variables simples ET les **boucles sur tableaux** pour générer plusieurs pages/sections dynamiquement, sans multiplier les templates.

### Syntaxe Carbone dans les templates

| Placeholder dans le document | Description |
|---|---|
| `{d.nom}` | Valeur simple |
| `{d.date:formatD('DD/MM/YYYY')}` | Valeur avec formateur de date |
| `{d.montant:toFixed(2)}` | Valeur numérique formatée |
| `{d.lignes[i].designation}` | Répétition d'un tableau ou d'une section pour chaque item |
| `{d.lignes[i+1].designation}` | Fin de la boucle (marque la dernière colonne) |
| `{d.actif ? 'Oui' : 'Non'}` | Condition |

### Operations

| Opération | Description |
|---|---|
| **Fill Template** | Télécharge le template Nextcloud, injecte les données, sauvegarde le résultat |
| **Get Variables** | Scanne le template et retourne tous les `{d.xxx}` trouvés |

### Modes de données (Fill Template)

**Key-Value Pairs** — pour les documents simples :
```
Template Variables:
  nom       → {{ $json.nom_client }}
  date      → {{ $now.format('DD/MM/YYYY') }}
  reference → REF-{{ $json.id }}
```

**JSON Object** — pour les boucles et pages dynamiques :
```json
{
  "client": "ACME Corp",
  "lignes": [
    { "designation": "Prestation A", "qte": 2, "prix": 150 },
    { "designation": "Prestation B", "qte": 1, "prix": 300 }
  ]
}
```
→ Dans le template, un tableau avec `{d.lignes[i].designation}` se répète automatiquement pour chaque ligne.

### Modes de sortie

| Mode | Description |
|---|---|
| **Save to Nextcloud** | Sauvegarde le document rempli sur Nextcloud (chemin à spécifier) |
| **Return as Binary** | Retourne le document en binaire (pour envoi par email, téléchargement, etc.) |

### Workflow typique — génération de contrat

```
1. Form Trigger (ou HTTP Request)
   └─ Données du formulaire : nom_client, adresse, montant

2. Nextcloud Doc Template
   ├─ Template : /Templates/contrat.docx
   ├─ Data Mode : Key-Value Pairs
   │   nom_client → {{ $json.nom_client }}
   │   adresse    → {{ $json.adresse }}
   │   montant    → {{ $json.montant }}
   └─ Output : Save to Nextcloud → /Contrats/contrat_{{ $json.nom_client }}.docx

3. (Optionnel) Send Email
   └─ Attachment : binary "data" du node précédent (mode Return as Binary)
```

### Pages dynamiques — exemple facture

Template Word avec un tableau :

| Désignation | Qté | Prix |
|---|---|---|
| `{d.lignes[i].designation}` | `{d.lignes[i].qte}` | `{d.lignes[i].prix}` |
| `{d.lignes[i+1].designation}` | | |

Données JSON passées au node :
```json
{
  "numero": "FAC-2025-001",
  "client": "ACME",
  "lignes": [
    { "designation": "Développement", "qte": 5, "prix": 800 },
    { "designation": "Formation", "qte": 2, "prix": 400 }
  ]
}
```
→ Carbone répète les lignes du tableau automatiquement. Pour répéter des **pages entières**, créez une section avec saut de page dans le template et utilisez `{d.pages[i].xxx}`.

---

## Node — Nextcloud PDF

Lecture et remplissage des champs de formulaire **AcroForm** de PDFs stockés sur Nextcloud (bibliothèque `pdf-lib`).

### Opération : Get Fields

Extrait tous les champs du formulaire PDF et les retourne en JSON.

**Sortie JSON :**
```json
{
  "pdfPath": "/Documents/Formulaires/inscription.pdf",
  "count": 5,
  "values": {
    "Nom": "Dupont",
    "Prénom": "Jean",
    "Etudiant": true,
    "Couleur": "Bleu",
    "Pays": "France"
  },
  "fields": [
    { "name": "Nom", "type": "text", "value": "Dupont", "required": false, "readOnly": false },
    { "name": "Etudiant", "type": "checkbox", "value": true, "required": false, "readOnly": false },
    { "name": "Couleur", "type": "radio", "value": "Bleu", "options": ["Rouge", "Vert", "Bleu"], "required": false, "readOnly": false },
    { "name": "Pays", "type": "dropdown", "value": "France", "options": ["France", "Belgique", "Suisse"], "required": false, "readOnly": false },
    { "name": "Compétences", "type": "optionList", "value": ["TypeScript", "Python"], "options": ["TypeScript", "Python", "Go"], "required": false, "readOnly": false }
  ]
}
```

- `values` : accès direct par nom de champ — `{{ $json.values.Nom }}`
- `fields` : détail complet avec type et options disponibles
- Types supportés : `text`, `checkbox`, `radio`, `dropdown`, `optionList`, `signature`, `button`

### Opération : Fill Fields

Remplit les champs du formulaire PDF puis sauvegarde sur Nextcloud ou retourne en binaire.

| Paramètre | Description |
|---|---|
| **Mode de saisie** | *Paires Clé-Valeur* (champ par champ) ou *Objet JSON* (depuis webhook, formulaire…) |
| **Aplatir le formulaire** | Rend les champs non modifiables après remplissage |
| **Mode de sortie** | *Sauvegarder sur Nextcloud* ou *Retourner en binaire* |

**Valeurs acceptées pour les cases à cocher :**

| Coché | Non coché |
|---|---|
| `true`, `True`, `TRUE` | `false`, `False`, `FALSE` |
| `Oui`, `oui`, `OUI` | `Non`, `non`, `NON` |
| `Yes`, `yes`, `YES` | `No`, `no`, `NO` |
| `1`, `Vrai`, `vrai` | `0`, `Faux`, `faux` |

**Exemple — workflow avec Webhook → PDF Fill :**

```
Webhook (formulaire en ligne)
  → Nextcloud PDF [Fill Fields, mode JSON]
      jsonData = {{ $json.body }}
      outputPath = /Inscriptions/{{ $json.body.Nom }}_inscription.pdf
```

Si le webhook reçoit `{ "Nom": "Dupont", "Etudiant": "Oui", "Couleur": "Rouge" }`, le PDF est automatiquement rempli et sauvegardé sur Nextcloud.

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
