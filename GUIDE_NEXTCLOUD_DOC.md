# Guide — NextCloud Doc Template

Ce guide explique comment utiliser le node **NextCloud Doc Template** pour générer des documents Word (DOCX) ou LibreOffice Writer (ODT) à partir de templates stockés sur votre Nextcloud.

---

## Principe de fonctionnement

```
Template DOCX sur Nextcloud
        │
        ▼
  NextCloud Doc Template (n8n)
  ├─ Télécharge le template via WebDAV
  ├─ Injecte vos données (moteur Carbone)
  ├─ [Optionnel] Fusionne les annexes conditionnelles
  └─ Sauvegarde sur Nextcloud ou retourne en binaire
        │
        ▼
   • /Documents/Contrats/contrat_ACME.docx
   • OU binaire → email, téléchargement...
```

Le node utilise **Carbone** comme moteur de templating — même syntaxe que `n8n-nodes-carbonejs`. Vos templates existants fonctionnent directement.

---

## Étape 1 — Créer votre template DOCX

Ouvrez Word ou LibreOffice Writer et insérez des **placeholders** dans le texte :

```
Bonjour {d.prenom} {d.nom},

Votre commande du {d.date_commande:formatD('DD/MM/YYYY')} a bien été enregistrée.
Référence : {d.reference}
Montant total : {d.montant:toFixed(2)} €
```

> **Règle clé** : tous les placeholders commencent par `{d.` — le `d` représente l'objet de données.

> **Dans Word** : tapez `{d.nom}` directement au clavier dans du texte normal. N'utilisez **jamais** *Insertion → Champ* (`Ctrl+F9`) — ce sont des champs Word différents.

---

## Syntaxe Carbone complète

### Variables simples

| Placeholder | Description |
|---|---|
| `{d.nom}` | Valeur brute du champ "nom" |
| `{d.personne.nom}` | Valeur imbriquée (objet dans objet) |

### Formateurs

| Placeholder | Résultat |
|---|---|
| `{d.montant:toFixed(2)}` | `1500.00` |
| `{d.date:formatD('DD/MM/YYYY')}` | `15/05/2025` |
| `{d.date:formatD('dddd D MMMM YYYY')}` | `jeudi 15 mai 2025` |
| `{d.date:formatD('MMMM YYYY')}` | `mai 2025` |
| `{d.nom:upper()}` | `MARTIN` |
| `{d.nom:lower()}` | `martin` |
| `{d.nom:ucFirst()}` | `Martin` |
| `{d.note:ifEmpty('N/A')}` | `N/A` si le champ est vide |
| `{d.montant:convCurr('EUR','fr-FR')}` | `1 500,00 €` |

> Liste complète des formateurs : [documentation Carbone](https://carbone.io/documentation.html#formatters)

### Conditions

| Placeholder | Résultat |
|---|---|
| `{d.actif ? 'Oui' : 'Non'}` | Condition ternaire |
| `{!d.champ}` | Affiché seulement si vide/falsy |
| `{d.statut === 'valide' ? '✓' : '✗'}` | Comparaison |

### Boucles sur tableaux (répétition de lignes)

Insérez un tableau dans Word/LibreOffice avec une ligne modèle :

| Désignation | Quantité | Prix unitaire | Total |
|---|---|---|---|
| `{d.lignes[i].designation}` | `{d.lignes[i].qte}` | `{d.lignes[i].prix_u}` | `{d.lignes[i+1].total}` |

- `{d.lignes[i].xxx}` marque le **début** de la boucle
- `{d.lignes[i+1].xxx}` marque la **fin** de la boucle (dernière cellule)
- Carbone répète automatiquement la ligne pour chaque item du tableau `lignes`

### Pages dynamiques (une page par item)

Pour générer **N pages** depuis un seul template :

1. Créez une section complète dans le template (texte + mise en page)
2. Terminez-la par un **saut de page** (Ctrl+Entrée dans Word)
3. Encadrez-la avec `{d.pages[i].xxx}` au début et `{d.pages[i+1].xxx}` à la fin

```
┌─────────────────────────────────────┐
│ ATTESTATION N° {d.pages[i].numero}  │
│                                     │
│ Bénéficiaire : {d.pages[i].nom}     │
│ Date : {d.pages[i].date}            │
│                                     │
│ [Saut de page]                      │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│ ATTESTATION N° {d.pages[i+1].numero}│  ← fin de boucle
└─────────────────────────────────────┘
```

Données JSON :
```json
{
  "pages": [
    { "numero": 1, "nom": "MARTIN Jean",  "date": "15/05/2025" },
    { "numero": 2, "nom": "DUPONT Marie", "date": "16/05/2025" },
    { "numero": 3, "nom": "BERNARD Paul", "date": "17/05/2025" }
  ]
}
```
→ Document final : **3 pages**, une attestation par personne.

---

## Étape 2 — Uploader le template sur Nextcloud

Organisez vos fichiers, par exemple :

```
/Templates/
  contrat.docx
  facture.docx
  demande_manifestation.docx
  Annexes/
    annexe_trottoir.docx
    annexe_chaussee.docx
    annexe_barriere.docx
```

---

## Étape 3 — Configurer le node dans n8n

### Sélectionner le template

```
Template From   ▼  From List
Template Folder ▼  📁 Templates
Template File   ▼  contrat.docx
```

Ou par chemin direct (supporte les expressions) :
```
Template From       ▼  By Path (Expression)
Template File Path  :  /Templates/{{ $json.type_document }}.docx
```

### Choisir le mode de données

#### Mode Key-Value Pairs — pour les documents simples

Cliquez **Add Variable** pour chaque placeholder. Le dropdown **Variable Name or ID** charge automatiquement tous les `{d.xxx}` trouvés dans le template.

| Variable Name | Value |
|---|---|
| `{d.prenom}` | `{{ $json.prenom }}` |
| `{d.nom}` | `{{ $json.nom }}` |
| `{d.date_commande}` | `{{ $now.format('DD/MM/YYYY') }}` |
| `{d.montant}` | `{{ $json.total }}` |

#### Mode JSON Object — pour les boucles et pages dynamiques

Utilisez une expression n8n pour construire l'objet complet :

```javascript
={{
  {
    "client": $json.nom_client,
    "adresse": $json.adresse,
    "date": $now.format('DD/MM/YYYY'),
    "lignes": $json.items.map(item => ({
      "designation": item.name,
      "qte": item.quantity,
      "prix_u": item.unit_price,
      "total": item.quantity * item.unit_price
    }))
  }
}}
```

### Choisir le format de sortie

| Format | Utilisation |
|---|---|
| **DOCX** (défaut) | Fonctionne partout, aucune dépendance |
| **PDF** | Nécessite LibreOffice installé sur le serveur n8n |

### Choisir la destination de sortie

**Save to Nextcloud — sélecteur de dossier :**
```
Output Destination  ▼  Select Folder + File Name
Output Folder       ▼  📁 Documents / Contrats
Output File Name    :  contrat_{{ $json.nom_client }}_{{ $now.format('YYYY-MM-DD') }}.docx
```

**Save to Nextcloud — chemin par expression :**
```
Output Destination  ▼  By Path (Expression)
Output File Path    :  /Documents/Contrats/contrat_{{ $json.id }}.docx
```

**Return as Binary (pour email, téléchargement) :**
```
Binary Property  : data
Output File Name : contrat_{{ $json.nom_client }}.docx
```

---

## Étape 4 — Configurer les annexes conditionnelles

Les annexes permettent de **fusionner des fichiers DOCX supplémentaires** après le template rempli, selon des conditions évaluées à l'exécution.

### Fonctionnement

```
Template rempli (2 pages)
  + annexe_trottoir.docx (1 page)   ← si $json.trottoir est renseigné
  + annexe_chaussee.docx (1 page)   ← si $json.chaussee est renseigné
= Document final (2, 3 ou 4 pages selon les conditions)
```

Un **saut de page** est automatiquement inséré avant chaque annexe. Les images et hyperliens des annexes sont préservés.

### Configuration dans le node

```
Annexes Folder  ▼  📁 Templates / Annexes    ← dossier partagé (1 clic)

[+ Add Annexe]

  Condition — Value to Check : {{ $json.trottoir }}
  Condition                  : Is Not Empty ▼
  Annexe File                : annexe_trottoir.docx ▼   ← chargé depuis Annexes Folder
  Or: Annexe File Path       : (vide)

[+ Add Annexe]

  Condition — Value to Check : {{ $json.chaussee }}
  Condition                  : Is Not Empty ▼
  Annexe File                : annexe_chaussee.docx ▼
  Or: Annexe File Path       : (vide)
```

### Conditions disponibles

| Condition | Quand ajouter l'annexe |
|---|---|
| **Is Not Empty** | La valeur n'est pas vide / null / 0 / false / "false" |
| **Equals** | La valeur est exactement égale à *Compare To* |
| **Not Equals** | La valeur est différente de *Compare To* |
| **Contains** | La valeur contient la chaîne *Compare To* |
| **Always Append** | Toujours ajouter, quelle que soit la valeur |

### Chemin dynamique par expression

Si le nom du fichier d'annexe dépend d'une valeur du workflow, utilisez le champ **Or: Annexe File Path (Expression)** — il prend la priorité sur le dropdown :

```
Or: Annexe File Path : /Templates/Annexes/annexe_{{ $json.type_voirie }}.docx
```

---

## Opération Get Variables

Utilisez cette opération pour **découvrir les placeholders** d'un template sans l'ouvrir :

```
Operation     : Get Variables
Template From : From List
Template File : contrat.docx
```

Résultat :
```json
{
  "variables": ["{d.prenom}", "{d.nom}", "{d.montant}", "{d.lignes[i].designation}"],
  "rawKeys": ["prenom", "nom", "montant", "lignes[i].designation"],
  "count": 4,
  "templatePath": "/Templates/contrat.docx"
}
```

---

## Exemples de workflows complets

### Workflow 1 — Contrat depuis un formulaire n8n

```
1. n8n Form Trigger
   └─ Champs : nom_client, adresse, date_debut, duree_mois, montant_mensuel

2. NextCloud Doc Template — Fill Template
   ├─ Template     : /Templates/contrat_location.docx
   ├─ Data Mode    : Key-Value Pairs
   │   nom_client     → {{ $json.nom_client }}
   │   adresse        → {{ $json.adresse }}
   │   date_debut     → {{ $json.date_debut }}
   │   duree_mois     → {{ $json.duree_mois }}
   │   montant        → {{ $json.montant_mensuel }}
   ├─ Output Format: DOCX
   └─ Output Mode  : Return as Binary

3. Send Email (Gmail / SMTP)
   ├─ To : {{ $('Form Trigger').item.json.email }}
   └─ Attachments : binary["data"]
```

### Workflow 2 — Demande de manifestation avec annexes

```
1. Webhook (formulaire en ligne)
   └─ Body : { "Nom": "Fêtes du CAP", "trottoir": "Impasse...", "chaussee": "" }

2. NextCloud Doc Template — Fill Template
   ├─ Template     : /Templates/demande_manifestation.docx
   ├─ Data Mode    : JSON Object  ={{ $json.body }}
   ├─ Output Format: PDF
   ├─ Output Mode  : Save to Nextcloud
   │   Output Folder    : 📁 Documents / Demandes
   │   Output File Name : demande_{{ $json.body["Nom"] }}.pdf
   └─ Annexes conditionnelles :
       Annexes Folder : 📁 Templates / Annexes
       • {{ $json.body.trottoir }}  Is Not Empty → annexe_trottoir.docx
       • {{ $json.body.chaussee }}  Is Not Empty → annexe_chaussee.docx
```

### Workflow 3 — Facture avec lignes dynamiques

```
1. HTTP Request (API commandes)
   └─ { id, client, lignes: [{ designation, qte, prix_u }, ...] }

2. Code (calcul des totaux)
   └─ Ajoute total_ht, tva, total_ttc à chaque ligne

3. NextCloud Doc Template — Fill Template
   ├─ Template  : /Templates/facture.docx
   ├─ Data Mode : JSON Object
   │   ={{ {
   │       "numero": $json.id,
   │       "client": $json.client,
   │       "date": $now.format('DD/MM/YYYY'),
   │       "lignes": $json.lignes
   │   } }}
   └─ Output    : Save → /Factures/FAC-{{ $json.id }}.docx
```
→ Le tableau du template avec `{d.lignes[i].designation}` génère automatiquement une ligne par item.

### Workflow 4 — Attestations en masse (1 page par bénéficiaire)

```
1. NextCloud Spreadsheet — Get Rows (Table)
   └─ Table : Bénéficiaires → [{ nom, prenom, date }, ...]

2. Aggregate (tous les items en un seul)

3. NextCloud Doc Template — Fill Template
   ├─ Template  : /Templates/attestation.docx
   ├─ Data Mode : JSON Object
   │   ={{ { "pages": $json.items } }}
   └─ Output    : Save → /Attestations/attestations_{{ $now.format('YYYY-MM') }}.docx
```
→ Un seul fichier DOCX avec N pages (une attestation par bénéficiaire).

---

## Dépannage

| Problème | Solution |
|---|---|
| Variable non remplacée (`{d.nom}` reste tel quel) | Vérifiez que la clé existe dans vos données. Utilisez *Get Variables* pour lister les placeholders détectés. |
| Boucle ne se répète pas | Vérifiez que `{d.lignes[i].xxx}` et `{d.lignes[i+1].xxx}` sont dans la même ligne de tableau. |
| Erreur "Carbone render error" | Le template contient un placeholder mal formé. Ouvrez le DOCX et vérifiez la syntaxe — pas d'espace dans `{d.xxx}`. |
| Les accolades sont cassées dans Word | Word a reformaté le texte. Retapez le placeholder en mode texte brut. |
| Dossier de sortie introuvable | Le dossier parent du fichier de sortie doit exister sur Nextcloud avant l'exécution. |
| Annexe non trouvée | Vérifiez que le fichier existe dans le dossier *Annexes Folder* sélectionné. Utilisez *Annexe File Path* par expression pour déboguer le chemin. |
| Génération PDF échoue | LibreOffice doit être installé sur le serveur n8n. Utilisez DOCX si LibreOffice n'est pas disponible. |
| Image manquante dans le document fusionné | Les images sont copiées depuis les annexes. Si elles sont corrompues, vérifiez que le DOCX de l'annexe s'ouvre correctement dans Word. |

---

## Compatibilité

| Format template | Sortie DOCX | Sortie PDF |
|---|---|---|
| `.docx` | ✅ Sans dépendance | ⚠ LibreOffice requis sur le serveur n8n |
| `.odt` | ✅ Sans dépendance | ⚠ LibreOffice requis |

> Le node génère un DOCX depuis un template DOCX par défaut — aucune installation supplémentaire requise.
