# n8n-nodes-nextcloud-ext

[![npm version](https://img.shields.io/npm/v/n8n-nodes-nextcloud-ext.svg)](https://www.npmjs.com/package/n8n-nodes-nextcloud-ext)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![n8n community node](https://img.shields.io/badge/n8n-community%20node-orange)](https://docs.n8n.io/integrations/community-nodes/)

Nodes n8n communautaires pour **Nextcloud** — l'équivalent self-hosted des nodes Microsoft 365 (OneDrive + Excel + Word) avec en plus la gestion des formulaires PDF.

> Gérez vos fichiers Nextcloud, manipulez vos feuilles de calcul avec les **tables Excel nommées**, générez des documents depuis des templates DOCX/ODT, et lisez/remplissez vos **formulaires PDF AcroForm** — directement depuis vos workflows n8n, sans aucune dépendance au cloud Microsoft.

---

## Nodes inclus

| Node | Équivalent Microsoft 365 | Description |
|---|---|---|
| **NextCloud Folder** | OneDrive | Fichiers, dossiers et partages via WebDAV |
| **NextCloud Spreadsheet** | Excel | Lecture/écriture tableur `.xlsx`/`.ods`/`.csv` + tables nommées |
| **NextCloud Doc Template** | Word (Mail Merge) | Templates DOCX/ODT avec syntaxe Carbone — variables, boucles, sortie PDF |
| **NextCloud PDF** | — | Lecture et remplissage des champs de formulaire AcroForm |

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

## Node — NextCloud Folder

Gestion de fichiers, dossiers et partages via l'API WebDAV de Nextcloud.

### Resource : File

| Opération | Description |
|---|---|
| **List** | Liste les fichiers et dossiers d'un chemin |
| **Download** | Télécharge un fichier (retourne un binaire) |
| **Upload** | Envoie un fichier binaire vers Nextcloud |
| **Delete** | Supprime un fichier |
| **Move** | Déplace ou renomme un fichier |
| **Copy** | Copie un fichier vers un autre chemin |

### Resource : Folder

| Opération | Description |
|---|---|
| **List** | Liste le contenu d'un dossier |
| **Create** | Crée un dossier (et les parents si nécessaire) |
| **Delete** | Supprime un dossier et tout son contenu |

### Resource : Share

| Opération | Description |
|---|---|
| **Create** | Crée un lien de partage public, vers un utilisateur ou un groupe. Options : permissions, mot de passe, date d'expiration. |
| **Delete** | Supprime un partage par son ID |
| **Get All** | Liste tous vos partages actifs |

---

## Node — NextCloud Spreadsheet

Lit et écrit dans des fichiers tableur stockés sur Nextcloud. Supporte `.xlsx`, `.xls`, `.ods` et `.csv`.

> Les écritures utilisent **xlsx-populate** qui modifie uniquement les cellules demandées sans reconstruire le fichier — tableaux Excel nommés, styles, cellules fusionnées et mise en page sont préservés intégralement.

### Sélection du fichier

Deux modes disponibles pour tous les sélecteurs de fichiers :

```
Depuis   ▼  Depuis une liste     ← dropdown avec navigation par dossier
           Par chemin (expression) ← chemin direct, supporte les expressions n8n
```

En mode liste, un premier dropdown sélectionne le **dossier** (2 niveaux d'arborescence), puis un second liste les **fichiers compatibles** dans ce dossier.

---

### Resource : Sheet

Travaille sur les données brutes d'une feuille de calcul.

**Paramètre clé : `Header Row`** — numéro de la ligne contenant les en-têtes (défaut : 1). Tous les dropdowns de colonnes se rechargent automatiquement quand cette valeur change.

| Opération | Description |
|---|---|
| **Get Rows** | Retourne toutes les lignes en tant qu'items n8n |
| **Append Row** | Ajoute une ligne à la fin — hérite automatiquement des styles (police, couleurs, alignement, bordures) de la ligne précédente |
| **Update Row** | Modifie une ligne existante par son numéro (1 = première ligne de données) |
| **Delete Row** | Supprime une ligne par son numéro |
| **Get Columns** | Retourne la liste des en-têtes de colonnes |
| **Clear** | Supprime toutes les lignes de données en conservant l'en-tête |

#### Options pour Get Rows (Sheet)

| Option | Défaut | Description |
|---|---|---|
| **Return Last N Rows** | 0 (= toutes) | Retourner seulement les N dernières lignes |
| **Start From Column** | 1 | Ignorer les colonnes avant la position N |

**Exemple — fichier avec titre en ligne 1 et en-têtes en ligne 4 :**
```
Header Row : 4
Sheet      : Suivi

→ Colonnes chargées depuis la ligne 4 : N°, INTITULÉ, DATE, Service
→ Données lues depuis la ligne 5
```

---

### Resource : Table

Travaille sur une **table Excel nommée** (créée via *Insertion → Tableau* dans Excel, `Ctrl+T`).

> La table est détectée directement depuis le XML du fichier `.xlsx`. Les écritures préservent la plage de la table, les styles et les filtres automatiques.

| Opération | Description |
|---|---|
| **List** | Liste toutes les tables nommées du classeur avec leur feuille, plage et nombre de lignes |
| **Get Rows** | Retourne les lignes de la table avec filtres et options |
| **Append Row** | Ajoute une ligne et **étend automatiquement la plage de la table** — styles copiés depuis la ligne précédente |
| **Update Row** | Modifie une ligne par son numéro dans la table |
| **Delete Row** | Supprime une ligne et **rétracte la plage de la table** |
| **Get Columns** | Retourne les en-têtes de colonnes de la table |

#### Options pour Get Rows (Table)

| Option | Description |
|---|---|
| **Include Row Number** | Ajoute `__rowNumber` à chaque item (1 = première ligne de données). Utilisez `{{ $json.__rowNumber }}` dans Update Row ou Delete Row pour cibler la ligne exacte. |
| **Return Last N Rows** | Retourner seulement les N dernières lignes |
| **Start From Column** | Ignorer les colonnes avant la position N |
| **Filters** | Filtrer les lignes par valeur de colonne — plusieurs filtres = logique AND. Les colonnes disponibles sont chargées dynamiquement depuis la définition de la table. |

> **Important** : `__rowNumber` est assigné **avant** l'application des filtres, ce qui garantit que le numéro reflète toujours la position réelle dans la table.

#### Workflow type — trouver et modifier une ligne précise

```
1. Get Rows (Table)
   ├─ Table   : Suivi
   ├─ Filters : N° = {{ $json.numero }}
   └─ Options : Include Row Number ✓

2. Update Row (Table)
   ├─ Table      : Suivi
   ├─ Row Number : {{ $json.__rowNumber }}
   └─ Column Values:
        Statut → Validé
        DATE   → {{ $now.format('dd/MM/yyyy') }}
```

**Sortie de Get Rows avec Include Row Number :**
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
  DATE     → 15/05/2026
  Service  → D. MARTIN
```

→ La table passe automatiquement de `A4:D752` à `A4:D753`. Les styles sont copiés depuis la ligne précédente.

---

### Resource : Workbook

| Opération | Description |
|---|---|
| **Get Sheets** | Retourne tous les noms de feuilles du classeur |
| **Get Tables** | Retourne toutes les tables nommées de toutes les feuilles avec leur feuille, plage et nombre de lignes |

---

## Node — NextCloud Doc Template

Génère des documents Word/ODT à partir de **templates** stockés sur Nextcloud, en utilisant le moteur **Carbone** — syntaxe identique à `n8n-nodes-carbonejs` mais avec votre instance Nextcloud comme stockage.

> Supporte les variables simples ET les **boucles sur tableaux** pour générer plusieurs pages/sections dynamiquement, sans multiplier les templates.

### Sélection du template

Même système de sélection que le Spreadsheet :
- **From List** : dropdown dossier + dropdown fichiers `.docx`/`.odt`
- **By Path (Expression)** : chemin direct avec expressions n8n

### Syntaxe Carbone dans les templates

| Placeholder | Description |
|---|---|
| `{d.nom}` | Valeur simple |
| `{d.date:formatD('DD/MM/YYYY')}` | Formateur de date |
| `{d.montant:toFixed(2)}` | Valeur numérique formatée |
| `{d.actif ? 'Oui' : 'Non'}` | Condition ternaire |
| `{d.lignes[i].designation}` | Début d'une boucle — répète la ligne/section pour chaque item |
| `{d.lignes[i+1].designation}` | Fin de la boucle |

### Opérations

| Opération | Description |
|---|---|
| **Fill Template** | Télécharge le template, injecte les données, sauvegarde ou retourne en binaire |
| **Get Variables** | Scanne le template et retourne tous les placeholders `{d.xxx}` trouvés |

### Modes de données (Fill Template)

**Key-Value Pairs** — saisie variable par variable, avec dropdown auto-chargé depuis les placeholders du template :
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
→ Dans le template Word, un tableau avec `{d.lignes[i].designation}` se répète automatiquement pour chaque ligne. Pour des **pages entières** répétées, utilisez une section avec saut de page et `{d.pages[i].xxx}`.

### Format de sortie

| Format | Description |
|---|---|
| **DOCX** | Document Word — aucune dépendance externe |
| **PDF** | Nécessite **LibreOffice** installé sur le serveur n8n |

### Mode de sortie

**Save to Nextcloud** — deux sous-modes :
- **Choisir un dossier + nom de fichier** : dropdown dossier arborescent + champ nom de fichier (supporte les expressions)
- **Par chemin complet (expression)** : chemin libre, ex : `/Contrats/contrat_{{ $json.client }}.docx`

**Return as Binary** : retourne le document en binaire pour envoi email, téléchargement, etc.

### Workflow type — génération de contrat

```
1. Form Trigger (ou Webhook)
   └─ Données : nom_client, adresse, montant

2. NextCloud Doc Template  [Fill Template]
   ├─ Template : /Templates/contrat.docx
   ├─ Mode     : Key-Value Pairs
   │   nom_client → {{ $json.nom_client }}
   │   montant    → {{ $json.montant }}
   ├─ Format   : DOCX
   └─ Sortie   : Dossier /Contrats + Nom : contrat_{{ $json.nom_client }}.docx

3. (Optionnel) Send Email
   └─ Pièce jointe : binaire "data" du node précédent (mode Return as Binary)
```

---

## Node — NextCloud PDF

Lecture et remplissage des champs de formulaire **AcroForm** de PDFs stockés sur Nextcloud.

> Supporte tous les types de champs AcroForm : texte, case à cocher, bouton radio, liste déroulante, liste à sélection multiple, signature.

### Sélection du fichier PDF

Même système que les autres nodes :
- **Depuis une liste** : dropdown dossier + dropdown fichiers `.pdf`
- **Par chemin (expression)** : chemin direct avec expressions n8n

---

### Opération : Get Fields

Extrait tous les champs du formulaire PDF et les retourne en JSON structuré.

**Sortie JSON :**
```json
{
  "pdfPath": "/Documents/Formulaires/inscription.pdf",
  "count": 5,
  "values": {
    "Nom": "Dupont",
    "Etudiant": true,
    "Couleur": "Bleu",
    "Pays": "France",
    "Competences": ["TypeScript", "Python"]
  },
  "fields": [
    { "name": "Nom",         "type": "text",       "value": "Dupont",                        "required": false, "readOnly": false },
    { "name": "Etudiant",    "type": "checkbox",   "value": true,                            "required": false, "readOnly": false },
    { "name": "Couleur",     "type": "radio",      "value": "Bleu",    "options": ["Rouge", "Vert", "Bleu"],            "required": false, "readOnly": false },
    { "name": "Pays",        "type": "dropdown",   "value": "France",  "options": ["France", "Belgique", "Suisse"],     "required": false, "readOnly": false },
    { "name": "Competences", "type": "optionList", "value": ["TypeScript", "Python"], "options": ["TypeScript", "Python", "Go"], "required": false, "readOnly": false }
  ]
}
```

| Propriété | Description |
|---|---|
| `values` | Objet plat `{ nomChamp: valeur }` — accès direct par expression : `{{ $json.values.Nom }}` |
| `fields` | Tableau complet avec `type`, `value`, `options` disponibles, `required`, `readOnly` |

**Types de champs supportés :**

| Type | Description |
|---|---|
| `text` | Champ texte simple ou multiligne |
| `checkbox` | Case à cocher — valeur `true`/`false` |
| `radio` | Groupe de boutons radio — valeur = option sélectionnée, `options` = liste des choix |
| `dropdown` | Liste déroulante — même structure que radio |
| `optionList` | Liste à sélection multiple — valeur = tableau des options sélectionnées |
| `signature` | Champ signature — valeur `null` (lecture seule) |
| `button` | Bouton push — valeur `null` (lecture seule) |

---

### Opération : Fill Fields

Remplit les champs du formulaire PDF puis sauvegarde sur Nextcloud ou retourne en binaire.

### Modes de données

**Paires Clé-Valeur** — saisie champ par champ :
- Le dropdown **Nom du champ** charge automatiquement tous les champs du PDF sélectionné avec leur type et options
- Le champ **Valeur** supporte les expressions n8n : `{{ $json.body.nom }}`

**Objet JSON** — idéal pour les webhooks et formulaires en ligne :
```
Données (JSON) = {{ $json.body }}
```
→ Le node mappe directement chaque clé JSON sur le champ PDF du même nom.

#### Valeurs acceptées pour les cases à cocher (checkbox)

| Coché ✓ | Non coché ☐ |
|---|---|
| `true`, `True`, `TRUE` | `false`, `False`, `FALSE` |
| `Oui`, `oui`, `OUI` | `Non`, `non`, `NON` |
| `Yes`, `yes`, `YES` | `No`, `no`, `NO` |
| `Vrai`, `vrai` | `Faux`, `faux` |
| `1`, `on`, `checked` | `0` |

#### Option : Aplatir le formulaire

Si activé, les champs sont aplatis dans le document après remplissage — les valeurs deviennent du texte imprimé non modifiable.

### Mode de sortie

**Sauvegarder sur Nextcloud** — deux sous-modes :
- **Choisir un dossier + nom de fichier** : dropdown dossier + champ nom (supporte les expressions)
- **Par chemin complet (expression)** : chemin libre

**Retourner en binaire** : retourne le PDF rempli pour téléchargement, envoi email, etc.

### Workflow type — webhook → PDF rempli

```
1. Webhook
   └─ body: { "Nom": "Dupont", "Etudiant": "Oui", "Couleur": "Rouge" }

2. NextCloud PDF  [Fill Fields]
   ├─ Fichier PDF  : /Templates/inscription.pdf
   ├─ Mode         : Objet JSON → ={{ $json.body }}
   ├─ Aplatir      : Non
   └─ Sortie       : Dossier /Inscriptions + Nom : {{ $json.body.Nom }}_inscription.pdf
```

### Workflow type — webhook complexe avec Code node

Quand les clés du webhook ne correspondent pas exactement aux noms de champs PDF, ou quand des valeurs doivent être calculées :

```
1. Webhook

2. Code node
   └─ Calcule les champs dérivés (date de demande, combinaisons de champs, etc.)
      et recopie tout le body :
      return { json: { ...b, "Date de la demande": dateFormatée, ... } }

3. NextCloud PDF  [Fill Fields]
   └─ Mode : Objet JSON → ={{ $json }}
```

---

## Structure des chemins Nextcloud

Tous les chemins sont **relatifs à la racine de votre espace Nextcloud** :

```
/                              → racine
/Documents/rapport.xlsx        → fichier dans Documents
/Templates/formulaire.pdf      → fichier dans Templates
/Sorties/2026/                 → sous-dossier
```

---

## Développement local

```bash
git clone https://github.com/wdebonne/n8n-nodes-nextcloud-ext.git
cd n8n-nodes-nextcloud-ext
npm install
npm run build   # compile TypeScript → dist/
npm run dev     # mode watch
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
- [ ] Node **NextCloud Talk** (messages, salons)
- [ ] Node **NextCloud Contacts** (CardDAV)
- [ ] Node **NextCloud Calendar** (CalDAV)

---

## Licence

[MIT](LICENSE) — © 2025 wdebonne

---

## Liens

- [npmjs.com/package/n8n-nodes-nextcloud-ext](https://www.npmjs.com/package/n8n-nodes-nextcloud-ext)
- [GitHub](https://github.com/wdebonne/n8n-nodes-nextcloud-ext)
- [Changelog](CHANGELOG.md)
- [Documentation n8n — Community Nodes](https://docs.n8n.io/integrations/community-nodes/)
