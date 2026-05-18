# n8n-nodes-nextcloud-ext

[![npm version](https://img.shields.io/npm/v/n8n-nodes-nextcloud-ext.svg)](https://www.npmjs.com/package/n8n-nodes-nextcloud-ext)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![n8n community node](https://img.shields.io/badge/n8n-community%20node-orange)](https://docs.n8n.io/integrations/community-nodes/)

Nodes n8n communautaires pour **Nextcloud** — l'équivalent self-hosted des nodes Microsoft 365.

> Gérez vos fichiers, manipulez vos tableurs, générez des documents Word/ODT depuis des templates, et lisez/remplissez des formulaires PDF — directement depuis vos workflows n8n, sans aucune dépendance au cloud Microsoft ou Google.

---

## Nodes inclus

| Node | Équivalent MS 365 | Description |
|---|---|---|
| **NextCloud Folder** | OneDrive | Gestion de fichiers et dossiers via WebDAV |
| **NextCloud Spreadsheet** | Excel | Lecture/écriture de fichiers tableur + tables Excel nommées |
| **NextCloud Search** | Excel VLOOKUP | Recherche une valeur dans une colonne et retourne une valeur correspondante (RECHERCHEV) |
| **NextCloud Doc Template** | Word (Mail Merge) | Remplissage de templates DOCX/ODT (syntaxe Carbone) + fusion d'annexes conditionnelles |
| **NextCloud PDF** | — | Lecture et remplissage de formulaires PDF AcroForm |

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
4. Cliquez **Install** puis **redémarrez n8n**

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

## Node — NextCloud Folder

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
| **Create** | Crée un nouveau dossier |
| **Delete** | Supprime un dossier et tout son contenu |

### Resource : Share

| Opération | Description |
|---|---|
| **Create** | Crée un lien de partage public ou vers un utilisateur/groupe |
| **Delete** | Supprime un partage par son ID |
| **Get All** | Liste tous vos partages actifs |

---

## Node — NextCloud Spreadsheet

Lit et écrit dans des fichiers tableur stockés sur Nextcloud. Supporte `.xlsx`, `.xls`, `.ods` et `.csv`.

> Les écritures utilisent **xlsx-populate** qui modifie uniquement les cellules demandées sans reconstruire le fichier — tableaux Excel nommés, styles, cellules fusionnées et mise en page sont préservés intégralement.

### Sélection du fichier

```
Depuis  ▼  Depuis une liste  ← ou "Par chemin (expression)"
Dossier ▼  📁 Documents       ← liste à 2 niveaux
Fichier ▼  Arrêtés.xlsx       ← fichiers du dossier sélectionné
```

### Resource : Sheet

Travaille sur les données d'une feuille de calcul. La **première ligne** est traitée comme en-tête par défaut.

**Paramètre clé : `Header Row`** — numéro de la ligne contenant les en-têtes (défaut : 1). Tous les dropdowns de colonnes se rechargent automatiquement quand cette valeur change.

| Opération | Description |
|---|---|
| **Get Rows** | Retourne toutes les lignes en tant qu'items n8n |
| **Append Row** | Ajoute une ligne à la fin (hérite des styles de la ligne précédente) |
| **Update Row** | Modifie une ligne existante par son numéro |
| **Delete Row** | Supprime une ligne par son numéro |
| **Get Columns** | Retourne la liste des en-têtes de colonnes |
| **Clear** | Supprime toutes les lignes de données en conservant l'en-tête |

**Options pour Get Rows (Sheet) :**

| Option | Défaut | Description |
|---|---|---|
| **Return Last N Rows** | 0 (= toutes) | Retourner seulement les N dernières lignes |
| **Start From Column** | 1 | Ignorer les colonnes avant la position N |
| **Column Names or IDs** | (toutes) | Sélectionner les colonnes à inclure dans la sortie |

### Resource : Table

Travaille sur une **table Excel nommée** (créée via *Insertion → Tableau* dans Excel, `Ctrl+T`).

| Opération | Description |
|---|---|
| **List** | Liste toutes les tables nommées du classeur |
| **Get Rows** | Retourne les lignes de la table (filtres et options disponibles) |
| **Append Row** | Ajoute une ligne et **étend automatiquement la plage de la table** |
| **Update Row** | Modifie une ligne par son numéro dans la table |
| **Delete Row** | Supprime une ligne et **rétracte la plage de la table** |
| **Get Columns** | Retourne les en-têtes de colonnes de la table |

**Options et filtres pour Get Rows (Table) :**

| Option / Champ | Description |
|---|---|
| **Include Row Number** | Ajoute `__rowNumber` à chaque item (1 = première ligne de données). Attribué **avant** les filtres — reflète la position réelle dans la table. Utilisez-le dans Update Row ou Delete Row pour cibler la ligne exacte. |
| **Return Last N Rows** | Retourner seulement les N dernières lignes |
| **Start From Column** | Ignorer les colonnes avant la position N |
| **Filters** | Filtrer les lignes par valeur de colonne (plusieurs filtres = logique AND) |
| **Column Names or IDs** | Sélectionner les colonnes à inclure dans la sortie |

**Workflow : trouver et modifier une ligne précise**

```
1. Get Rows (Table)
   ├─ Table   : Suivi
   ├─ Options : Include Row Number ✓
   └─ Filters : N° = {{ $json.numero }}

2. Update Row (Table)
   ├─ Table      : Suivi
   ├─ Row Number : {{ $json.__rowNumber }}
   └─ Column Values : Statut → Validé
```

### Resource : Workbook

| Opération | Description |
|---|---|
| **Get Sheets** | Retourne tous les noms de feuilles du classeur |
| **Get Tables** | Retourne toutes les tables nommées de toutes les feuilles |

---

## Node — NextCloud Search

Recherche une valeur dans une colonne d'un fichier tableur Nextcloud et retourne la valeur d'une autre colonne sur la même ligne — l'équivalent d'un **VLOOKUP / RECHERCHEV** directement dans n8n.

> L'item d'entrée est enrichi avec les valeurs trouvées. Plusieurs lookups peuvent être configurés en une seule exécution (un seul téléchargement du fichier).

### Sélection de la source

```
Source Type ▼  Sheet  ← ou "Table" (table Excel nommée)
From        ▼  From List
Dossier     ▼  📁 Documents
Fichier     ▼  catalogue.xlsx
Sheet       ▼  Tarifs         ← ou "Table" si Source Type = Table
```

### Lookups

Chaque entrée du bloc **Lookups** configure une recherche indépendante :

| Champ | Exemple | Description |
|---|---|---|
| **Search Column** | `Nom du matériel` | Colonne où chercher (dropdown auto-chargé depuis le fichier) |
| **Search Value** | `{{ $json.materiel_nom_1 }}` | Valeur à trouver — supporte les expressions n8n |
| **Return Column** | `Prix` | Colonne dont la valeur est retournée (dropdown auto-chargé depuis le fichier) |
| **Output Field Name** | `materiel_prix_1` | Nom du champ JSON écrit dans l'item de sortie |

Exemple de résultat avec `Pass Through` activé (défaut) :

```json
{
  "materiel_nom_1": "Table",
  "materiel_prix_1": "50€"
}
```

### Options

| Option | Défaut | Description |
|---|---|---|
| **Case Sensitive** | `false` | Correspondance exacte de la casse |
| **If Not Found** | `Set to Null` | `Set to Null` : null silencieux · `Throw Error` : arrêt avec erreur |
| **Pass Through Original Data** | `true` | Conserver tous les champs d'entrée dans l'item de sortie |

### Workflow typique — enrichir un bon de commande

```
Webhook (reçoit materiel_nom_1 = "Table")
  → NextCloud Search
      Lookup 1 : Nom du matériel = {{ $json.materiel_nom_1 }} → Prix → materiel_prix_1
      Lookup 2 : Nom du matériel = {{ $json.materiel_nom_2 }} → Prix → materiel_prix_2
  → NextCloud Doc Template (utilise materiel_prix_1, materiel_prix_2 dans le template)
```

---

## Node — NextCloud Doc Template

Génère des documents Word (DOCX) ou LibreOffice Writer (ODT) à partir de templates stockés sur Nextcloud, en utilisant le moteur **Carbone** — syntaxe identique à `n8n-nodes-carbonejs`.

### Syntaxe Carbone dans les templates

| Placeholder dans le document | Description |
|---|---|
| `{d.nom}` | Valeur simple |
| `{d.date:formatD('DD/MM/YYYY')}` | Date formatée |
| `{d.montant:toFixed(2)}` | Nombre avec 2 décimales |
| `{d.lignes[i].designation}` | Début de boucle — répète la ligne/section pour chaque item du tableau |
| `{d.lignes[i+1].designation}` | Fin de boucle (dernière cellule de la boucle) |
| `{d.actif ? 'Oui' : 'Non'}` | Condition ternaire |
| `{!d.champ}` | Affiché uniquement si vide/falsy |

> **Important** : tapez les accolades `{ }` directement au clavier dans du texte normal dans Word. N'utilisez pas *Insertion → Champ* (`Ctrl+F9`).

### Opération : Fill Template

**Sélection du template :**

```
Template From   ▼  From List
Template Folder ▼  📁 Templates
Template File   ▼  contrat.docx
```
Ou mode *By Path (Expression)* pour un chemin dynamique.

**Mode de données :**

| Mode | Utilisation |
|---|---|
| **Key-Value Pairs** | Saisie variable par variable. Le dropdown *Variable Name or ID* charge automatiquement tous les `{d.xxx}` trouvés dans le template. |
| **JSON Object** | Passage d'un objet JSON complet — obligatoire pour les boucles et les pages dynamiques. Supporte les expressions n8n : `={{ { "lignes": $json.items } }}` |

**Format de sortie :**

| Format | Dépendance |
|---|---|
| **DOCX** (défaut) | Aucune — fonctionne sur toutes les installations n8n |
| **PDF** | Nécessite LibreOffice installé sur le serveur n8n |

**Mode de sortie — Save to Nextcloud :**

```
Output Destination  ▼  Select Folder + File Name
Output Folder       ▼  📁 Documents / Filled
Output File Name       contrat_{{ $json.client }}.docx
```
Ou mode *By Path (Expression)* pour un chemin complet dynamique.

**Mode de sortie — Return as Binary :**
```
Binary Property  : data
Output File Name : contrat_{{ $json.client }}.docx
```

### Opération : Get Variables

Scanne le template et retourne tous les placeholders `{d.xxx}` trouvés.

```json
{
  "variables": ["{d.nom}", "{d.date}", "{d.lignes[i].designation}"],
  "rawKeys": ["nom", "date", "lignes[i].designation"],
  "count": 3,
  "templatePath": "/Templates/contrat.docx"
}
```

---

## NextCloud Doc Template — Annexes conditionnelles

> Cette fonctionnalité permet d'**ajouter automatiquement des fichiers DOCX supplémentaires** (règlements, schémas, annexes légales…) à la fin du document généré, selon des conditions évaluées à l'exécution. Un saut de page est inséré automatiquement avant chaque annexe.

**Exemple :** template principal (2 pages) + annexe trottoir (1 page) + annexe chaussée (1 page) → document final de **4 pages**, sans créer de template combiné.

### Configuration

**1. Sélectionner le dossier des annexes (partagé) :**

```
Annexes Folder  ▼  📁 Templates / Annexes
```

**2. Ajouter une entrée par annexe ([+ Add Annexe]) :**

```
Condition — Value to Check : {{ $json.trottoir }}
Condition                  : Is Not Empty ▼
Annexe File                : annexe_trottoir.docx ▼   ← dropdown chargé depuis Annexes Folder
Or: Annexe File Path       : (vide)
```

### Conditions disponibles

| Condition | L'annexe est ajoutée quand… |
|---|---|
| **Is Not Empty** | La valeur n'est pas vide / null / 0 / false |
| **Equals** | La valeur correspond exactement à *Compare To* |
| **Not Equals** | La valeur est différente de *Compare To* |
| **Contains** | La valeur contient la chaîne *Compare To* |
| **Always Append** | Toujours ajouter, quelle que soit la valeur |

### Chemin dynamique par expression

Le champ **Or: Annexe File Path (Expression)** prend la priorité sur le dropdown — utile quand le nom du fichier dépend d'une donnée du workflow :

```
Or: Annexe File Path : /Templates/Annexes/annexe_{{ $json.type_voirie }}.docx
```

### Cumul de plusieurs annexes

Toutes les annexes dont la condition est vraie sont fusionnées **dans l'ordre** de la liste. La fusion gère les **images** (copie et renommage automatique pour éviter les conflits de rId) et les **hyperliens**.

```
[Annexe 1] trottoir   Is Not Empty → annexe_trottoir.docx   ✓ ajoutée
[Annexe 2] chaussee   Is Not Empty → annexe_chaussee.docx   ✗ ignorée (champ vide)
[Annexe 3] securite   Equals "Barrières" → annexe_barriere.docx  ✓ ajoutée

Résultat : template (2p) + annexe_trottoir (1p) + annexe_barriere (1p) = 4 pages
```

---

## Node — NextCloud Doc Template (suite)

### Formateurs Carbone

| Formateur | Résultat |
|---|---|
| `{d.montant:toFixed(2)}` | `1500.00` |
| `{d.date:formatD('DD/MM/YYYY')}` | `15/05/2025` |
| `{d.nom:upper()}` | `MARTIN` |
| `{d.nom:ucFirst()}` | `Martin` |
| `{d.note:ifEmpty('N/A')}` | `N/A` si vide |
| `{d.montant:convCurr('EUR','fr-FR')}` | `1 500,00 €` |

---

## Node — NextCloud PDF

Lit et remplit les champs de **formulaires PDF AcroForm** stockés sur Nextcloud.

### Opération : Get Fields

Retourne tous les champs du formulaire en JSON structuré avec deux niveaux :
- `values` : objet plat `{ NomChamp: valeur }` — utilisable directement dans les expressions (`$json.values.NomChamp`)
- `fields` : tableau détaillé avec `name`, `type`, `value`, `options`, `required`, `readOnly`

**Types de champs supportés :**

| Type | Description | Valeur retournée |
|---|---|---|
| `text` | Champ texte | `string` |
| `checkbox` | Case à cocher | `true` / `false` |
| `radio` | Bouton radio | `string` (option sélectionnée) |
| `dropdown` | Liste déroulante | `string` |
| `optionList` | Liste à sélection multiple | `string[]` |
| `signature` | Champ de signature | `null` |
| `button` | Bouton | `null` |

### Opération : Fill Fields

**Mode de saisie :**

| Mode | Description |
|---|---|
| **Paires Clé-Valeur** | Le dropdown *Nom du champ* charge automatiquement tous les champs du PDF avec leur type et leurs options. |
| **Objet JSON** | Passage d'un objet JSON complet — idéal pour les webhooks : `={{ $json.body }}` |

**Valeurs acceptées pour les cases à cocher :**

| Coché | Non coché |
|---|---|
| `Oui`, `Yes`, `True`, `1`, `Vrai`, `checked`, `on` | `Non`, `No`, `False`, `0`, `Faux` |

*(insensible à la casse)*

**Option Aplatir le formulaire :** les champs deviennent du texte imprimé non modifiable.

**Mode de sortie — Save to Nextcloud :**

```
Destination de sortie   ▼  Choisir un dossier + nom de fichier
Dossier de sortie       ▼  📁 Documents / Remplis
Nom du fichier de sortie   formulaire_{{ $json["Nom"] }}.pdf
```
Ou mode *Par chemin complet (expression)*.

---

## Chemins Nextcloud

Tous les chemins sont **relatifs à la racine de votre espace Nextcloud** :

```
/                                → racine
/Documents/rapport.xlsx          → fichier dans Documents
/Templates/Annexes/trottoir.docx → sous-dossier
```

---

## Workflows typiques

### Contrat depuis un formulaire n8n

```
Form Trigger → NextCloud Doc Template (Fill Template, Return Binary) → Send Email
```

### Remplir un PDF depuis un webhook

```
Webhook → NextCloud PDF (Fill Fields, Save to Nextcloud)
```

### Facture avec tableau de lignes dynamiques

```
HTTP Request → NextCloud Doc Template (JSON Object mode, {d.lignes[i].xxx})
```

### Demande avec annexes conditionnelles

```
Webhook → NextCloud Doc Template (Fill Template + Conditional Annexes)
```

---

## Développement local

```bash
git clone https://github.com/wdebonne/n8n-nodes-nextcloud-ext.git
cd n8n-nodes-nextcloud-ext

NODE_OPTIONS=--use-system-ca npm install
npm run build   # TypeScript → dist/
npm run dev     # mode watch
```

### Tester dans n8n

```bash
npm run build && npm link
# Dans le répertoire de données n8n :
npm link n8n-nodes-nextcloud-ext
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
- [Guide Doc Template](GUIDE_NEXTCLOUD_DOC.md)
- [Documentation n8n — Community Nodes](https://docs.n8n.io/integrations/community-nodes/)
