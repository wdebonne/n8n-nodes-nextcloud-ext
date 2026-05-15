# Guide — Nextcloud Doc Template

Ce guide explique comment utiliser le node **Nextcloud Doc Template** pour générer des documents Word (DOCX) ou LibreOffice Writer (ODT) à partir de templates stockés sur votre Nextcloud.

---

## Principe de fonctionnement

```
Template DOCX sur Nextcloud
        │
        ▼
  Nextcloud Doc Template (n8n)
  ├─ Télécharge le template via WebDAV
  ├─ Injecte vos données (Carbone engine)
  └─ Retourne le document rempli
        │
        ▼
   • Sauvegarde sur Nextcloud (/Documents/Contrats/...)
   • OU retourne en binaire (email, téléchargement...)
```

Le node utilise **Carbone** comme moteur de templating — la même bibliothèque que `n8n-nodes-carbonejs`. Si vous avez déjà des templates Carbone, ils fonctionnent directement.

---

## Étape 1 — Créer votre template DOCX

Ouvrez Word ou LibreOffice Writer et insérez des **placeholders** dans le texte :

```
Bonjour {d.prenom} {d.nom},

Votre commande du {d.date_commande} a bien été enregistrée.
Montant total : {d.montant} €
```

> **Règle clé** : tous les placeholders commencent par `{d.` (d = data).

### Syntaxe complète

| Placeholder | Résultat |
|---|---|
| `{d.nom}` | Valeur brute du champ "nom" |
| `{d.montant:toFixed(2)}` | Nombre avec 2 décimales : `1500.00` |
| `{d.date:formatD('DD/MM/YYYY')}` | Date formatée : `15/05/2025` |
| `{d.actif ? 'Oui' : 'Non'}` | Condition ternaire |
| `{d.lignes[i].designation}` | Répétition — début de boucle |
| `{d.lignes[i+1].designation}` | Répétition — fin de boucle (dernière colonne/cellule) |

> **Astuce** : dans Word, les accolades `{` `}` ne sont pas des champs Word — tapez-les directement au clavier dans le texte normal (pas avec Ctrl+F9).

### Boucle sur un tableau

Pour un tableau qui se répète pour chaque ligne de données :

| Désignation | Quantité | Prix unitaire | Total |
|---|---|---|---|
| `{d.lignes[i].designation}` | `{d.lignes[i].qte}` | `{d.lignes[i].prix_u}` | `{d.lignes[i+1].total}` |

Carbone va automatiquement répéter la ligne du tableau pour chaque item de `lignes`.

### Pages dynamiques (plusieurs pages générées automatiquement)

Pour générer **N pages** à partir d'un tableau :

1. Dans le template, créez une section complète (texte + mise en page) terminée par un **saut de page** (Ctrl+Entrée dans Word)
2. Entourez la section avec `{d.pages[i].xxx}` ... `{d.pages[i+1].xxx}` à la fin

```
────────────────────────────────
ATTESTATION N° {d.pages[i].numero}

Nom : {d.pages[i].nom}
Date : {d.pages[i].date}

[Saut de page]
────────────────────────────────
ATTESTATION N° {d.pages[i+1].numero}   ← dernière cellule de la "boucle"
```

Avec des données :
```json
{
  "pages": [
    { "numero": 1, "nom": "MARTIN Jean", "date": "15/05/2025" },
    { "numero": 2, "nom": "DUPONT Marie", "date": "16/05/2025" },
    { "numero": 3, "nom": "BERNARD Paul", "date": "17/05/2025" }
  ]
}
```
→ Carbone génère un document de 3 pages, une par personne.

---

## Étape 2 — Uploader le template sur Nextcloud

Mettez votre fichier `.docx` dans un dossier dédié, par exemple :
```
/Templates/contrat.docx
/Templates/facture.docx
/Templates/attestation.docx
```

---

## Étape 3 — Configurer le node dans n8n

### Sélectionner le template

```
From          : From List
Folder        : 📁 Templates
Template File : contrat.docx
```

Ou par chemin direct (supporte les expressions) :
```
From               : By Path (Expression)
Template File Path : /Templates/{{ $json.type_document }}.docx
```

### Choisir le mode de données

#### Mode "Key-Value Pairs" — pour les documents simples

Cliquez **Add Variable** pour chaque placeholder :

| Variable Name | Value |
|---|---|
| `{d.prenom}` | `{{ $json.prenom }}` |
| `{d.nom}` | `{{ $json.nom }}` |
| `{d.date_commande}` | `{{ $now.format('DD/MM/YYYY') }}` |
| `{d.montant}` | `{{ $json.total }}` |

> Le dropdown **Variable Name** charge automatiquement tous les `{d.xxx}` trouvés dans le template — cliquez simplement pour sélectionner.

#### Mode "JSON Object" — pour les boucles et pages dynamiques

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

### Choisir la sortie

**Sauvegarder sur Nextcloud :**
```
Output Mode      : Save to Nextcloud
Output File Path : /Documents/Contrats/contrat_{{ $json.nom_client }}_{{ $now.format('YYYY-MM-DD') }}.docx
```

**Retourner en binaire** (pour email, téléchargement, etc.) :
```
Output Mode      : Return as Binary
Binary Property  : data
Output File Name : contrat_{{ $json.nom_client }}.docx
```

---

## Opération "Get Variables"

Utilisez cette opération pour **découvrir** les placeholders d'un template sans avoir à l'ouvrir :

```
Operation     : Get Variables
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

### Workflow 1 — Contrat signé depuis un formulaire

```
1. n8n Form Trigger
   └─ Champs : nom_client, adresse, date_debut, duree_mois, montant_mensuel

2. Nextcloud Doc Template
   ├─ Template : /Templates/contrat_location.docx
   ├─ Data Mode : Key-Value Pairs
   │   nom_client     → {{ $json.nom_client }}
   │   adresse        → {{ $json.adresse }}
   │   date_debut     → {{ $json.date_debut }}
   │   duree_mois     → {{ $json.duree_mois }}
   │   montant        → {{ $json.montant_mensuel }}
   └─ Output : Return as Binary

3. Send Email (Gmail / SMTP)
   ├─ To : {{ $('Form Trigger').item.json.email }}
   ├─ Subject : Votre contrat de location
   └─ Attachments : binary["data"]
```

### Workflow 2 — Facture avec tableau de lignes

```
1. HTTP Request (récupère commande depuis API)
   └─ Retourne : { id, client, lignes: [{...}, {...}] }

2. Code Node (optionnel — formatage)
   └─ Calcule les totaux, formate les dates

3. Nextcloud Doc Template
   ├─ Template : /Templates/facture.docx
   ├─ Data Mode : JSON Object
   │   ={{ { "numero": $json.id, "client": $json.client, "lignes": $json.lignes } }}
   └─ Output : Save to Nextcloud → /Factures/FAC-{{ $json.id }}.docx

4. Nextcloud (Share → Create)
   └─ Crée un lien de partage public vers la facture
```

### Workflow 3 — Attestations en masse (pages dynamiques)

```
1. Nextcloud Spreadsheet — Get Rows
   └─ Liste de bénéficiaires : [{ nom, prenom, date }, ...]

2. Aggregate (regroupe tous les items en un seul)
   └─ Produit : { items: [{...}, {...}, ...] }

3. Nextcloud Doc Template
   ├─ Template : /Templates/attestation.docx
   ├─ Data Mode : JSON Object
   │   ={{ { "pages": $json.items } }}
   └─ Output : Save to Nextcloud → /Attestations/attestations_{{ $now.format('YYYY-MM') }}.docx
```
→ Un seul fichier DOCX avec N pages, une attestation par bénéficiaire.

---

## Formateurs Carbone utiles

| Formateur | Exemple | Résultat |
|---|---|---|
| `:toFixed(2)` | `{d.prix:toFixed(2)}` | `1500.00` |
| `:formatD('DD/MM/YYYY')` | `{d.date:formatD('DD/MM/YYYY')}` | `15/05/2025` |
| `:formatD('MMMM YYYY')` | `{d.date:formatD('MMMM YYYY')}` | `mai 2025` |
| `:upper()` | `{d.nom:upper()}` | `MARTIN` |
| `:lower()` | `{d.nom:lower()}` | `martin` |
| `:ucFirst()` | `{d.nom:ucFirst()}` | `Martin` |
| `:ifEmpty('N/A')` | `{d.commentaire:ifEmpty('N/A')}` | `N/A` si vide |
| `:convCurr('EUR','fr-FR')` | `{d.montant:convCurr('EUR','fr-FR')}` | `1 500,00 €` |

> Liste complète : [documentation Carbone](https://carbone.io/documentation.html#formatters)

---

## Dépannage

| Problème | Solution |
|---|---|
| Variable non remplacée (`{d.nom}` reste tel quel) | Vérifiez que le champ "nom" existe dans vos données. Utilisez "Get Variables" pour lister les placeholders. |
| Boucle ne se répète pas | Vérifiez que `{d.lignes[i].xxx}` et `{d.lignes[i+1].xxx}` sont dans la même ligne de tableau / même section. |
| Erreur "Carbone render error" | Le template contient un placeholder mal formé. Vérifiez la syntaxe dans Word (pas d'espace dans `{d.xxx}`). |
| Dossier de sortie introuvable | Le dossier parent du chemin de sortie doit exister sur Nextcloud avant l'exécution. |
| Les accolades sont cassées dans Word | Word peut reformater `{d.` en champ Word. Tapez le placeholder en texte brut, pas via Insertion → Champ. |

---

## Compatibilité

| Format template | Rendu en DOCX | Rendu en ODT | Rendu en PDF |
|---|---|---|---|
| `.docx` | ✅ | — | ⚠ LibreOffice requis sur le serveur n8n |
| `.odt` | — | ✅ | ⚠ LibreOffice requis sur le serveur n8n |

> Le node génère par défaut un DOCX depuis un template DOCX — aucune dépendance externe requise.
