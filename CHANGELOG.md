# Changelog

## [1.0.32] — 2026-05-15

### Ajouté
- **Node Nextcloud Doc Template** : nouveau node pour générer des documents DOCX/ODT à partir de templates stockés sur Nextcloud, en utilisant le moteur **Carbone** (syntaxe identique à `n8n-nodes-carbonejs`).
  - Opération **Fill Template** : télécharge le template via WebDAV, injecte les données, sauvegarde le résultat sur Nextcloud ou retourne un binaire.
  - Opération **Get Variables** : scanne le template et retourne tous les placeholders `{d.xxx}` trouvés.
  - Mode **Key-Value Pairs** : saisie variable par variable avec dropdown auto-chargé depuis le template.
  - Mode **JSON Object** : passage d'un objet JSON complet pour les boucles (`{d.lignes[i].champ}`) et la génération de pages dynamiques sans multiplier les templates.
  - Sortie **Save to Nextcloud** : chemin de sortie configurable avec expressions n8n.
  - Sortie **Return as Binary** : retourne le DOCX rempli pour envoi email ou téléchargement.
- **GUIDE_NEXTCLOUD_DOC.md** : guide complet avec exemples de templates, syntaxe Carbone, workflows et dépannage.

---

## [1.0.31] — 2025-05-15

### Corrigé
- **`__rowNumber` incorrect après filtre** : quand un filtre de valeur (N° = 8271) était appliqué, `__rowNumber` retournait la position dans les résultats filtrés (toujours `1`) au lieu de la position réelle dans la table. La ligne ciblée par Update Row ou Delete Row était donc erronée. Correction : `__rowNumber` est maintenant attribué AVANT l'application des filtres.

---

## [1.0.30] — 2025-05-15

### Modifié
- README mis à jour sur npmjs.com avec la documentation complète de toutes les fonctionnalités (Header Row, Table Get Rows options, workflow Get Rows → Update Row, etc.).

---

## [1.0.29] — 2025-05-15

### Ajouté
- **Table → Get Rows — Include Row Number** : nouvelle option dans le bloc Options. Ajoute un champ `__rowNumber` (1-basé) à chaque ligne retournée. Permet de cibler précisément une ligne dans Update Row ou Delete Row via `{{ $json.__rowNumber }}`.
- **Table → Get Rows — Filters** : nouveau champ `fixedCollection` pour filtrer les lignes par valeur de colonne (ex: N° = 8287). Plusieurs filtres = logique AND. Les colonnes disponibles sont chargées dynamiquement depuis la définition de la table.

---

## [1.0.28] — 2025-05-15

### Ajouté
- **Copie automatique des styles** lors d'un Append Row (Sheet et Table) : les styles de la ligne précédente (alignement, police, couleurs, bordures, format de nombre) sont copiés vers la nouvelle ligne pour qu'elle corresponde visuellement aux lignes existantes.

---

## [1.0.27] — 2025-05-15

### Corrigé
- **Fichier xlsx corrompu après Table → Append/Update/Delete Row** : `appendRowToTable`, `updateRowInTable` et `deleteRowFromTable` utilisaient encore `saveWorkbook()` (ExcelJS) en interne. Migré vers la nouvelle fonction `writeTableWithPopulate` qui utilise xlsx-populate pour les cellules et JSZip uniquement pour patcher le ref XML de la table.

---

## [1.0.26] — 2025-05-15

Toutes les modifications notables de ce projet sont documentées dans ce fichier.

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/)
Versionnement : [Semantic Versioning](https://semver.org/lang/fr/)

---

## [1.0.26] — 2025-05-15

### Corrigé
- **Fichier xlsx corrompu** (message "Nous avons trouvé un problème" à l'ouverture dans Excel) : migré vers **xlsx-populate** pour toutes les opérations d'écriture Sheet. xlsx-populate modifie uniquement les cellules demandées dans le ZIP original, sans reconstruire le fichier — tableaux, styles, cellules fusionnées et mise en page sont préservés intégralement.

### Technique
- `appendRowXml`, `updateRowXml`, `deleteRowXml`, `clearSheetXml` utilisent maintenant xlsx-populate
- ExcelJS conservé pour les lectures (Get Rows, Get Columns) et les opérations Table

---

## [1.0.25] — 2025-05-15

### Corrigé
- **Corruption xlsx** due à `updateSheetTableRefs` qui modifiait les objets internes d'ExcelJS via un cast TypeScript forcé, produisant des valeurs invalides (`"undefinedN"`) dans le XML des tables.

---

## [1.0.24] — 2025-05-15

### Corrigé
- **"Error fetching options from Nextcloud Spreadsheet"** : l'API `worksheet.tables` d'ExcelJS n'est pas fiable pour lire les tables des fichiers xlsx existants. Restauration de la détection par JSZip (lecture directe du XML `xl/tables/*.xml`), combinée à ExcelJS pour les écritures.
- `getTablesForFile` ne lève plus d'exception — retourne un message descriptif si aucune table trouvée.

### Technique
- Architecture hybride : JSZip pour détecter les tables, ExcelJS pour modifier les cellules, JSZip pour patcher le `ref` XML de la table après écriture.

---

## [1.0.23] — 2025-05-15

### Corrigé
- **Erreur d'installation** `ENOENT: no such file or directory, open '.../jszip/lib/index.js'` : jszip est une dépendance interne d'ExcelJS. Re-déclaré comme dépendance directe pour garantir son installation par n8n.

---

## [1.0.22] — 2025-05-15

### Modifié — Migration complète vers ExcelJS
- Suppression de `xlsx` (SheetJS) et `jszip` comme dépendances directes
- Toutes les opérations de lecture et d'écriture utilisent ExcelJS
- `parseWorkbook()` retourne désormais un `ExcelJS.Workbook` (async)
- `getWorkbookTables()` utilise l'API native `worksheet.tables` d'ExcelJS

### Dépendances
- `xlsx` (SheetJS) : **supprimé** — causait la destruction des tableaux Excel à chaque écriture
- `jszip` : **supprimé** (remplacé par ExcelJS en interne)
- `exceljs` : ajouté

---

## [1.0.21] — 2025-05-15

### Ajouté
- **ExcelJS** pour les opérations d'écriture Sheet : `appendRowXml`, `updateRowXml`, `deleteRowXml`, `clearSheetXml` utilisent ExcelJS pour préserver tableaux, styles et cellules fusionnées.

### Dépendances
- `exceljs ^4.4.0` : ajouté

---

## [1.0.20] — 2025-05-15

### Modifié
- Réécriture complète des opérations Sheet en manipulation XML pure (sans SheetJS pour l'écriture) : `appendRowXml`, `updateRowXml`, `deleteRowXml`, `clearSheetXml`.
- Aucune reconstruction du ZIP — modification chirurgicale du XML uniquement.

---

## [1.0.19] — 2025-05-15

### Corrigé
- Remplacement de `<sheetData>` uniquement (au lieu du XML entier de la feuille) pour préserver `<tableParts>`, styles et cellules fusionnées.

---

## [1.0.18] — 2025-05-15

### Corrigé
- Mise à jour du `ref` de la table XML après chaque opération d'écriture Sheet (Append/Delete) pour éviter la désynchronisation entre les données et la définition de la table.

---

## [1.0.17] — 2025-05-15

### Ajouté
- `writeSheetPreservingFormat` : fonction de sauvegarde chirurgicale qui conserve les fichiers table XML, styles et relations du ZIP original après l'écriture SheetJS.

---

## [1.0.16] — 2025-05-15

### Ajouté
- Message d'erreur diagnostique dans la liste des tables : distingue maintenant "aucun fichier table XML dans le ZIP" (pas de tableau Excel nommé) de "fichiers trouvés mais liaison impossible".

### Corrigé
- Détection des tables : réécriture de `extractTablesFromZip` pour chercher d'abord tous les fichiers `xl/tables/*.xml` puis résoudre l'association feuille via les fichiers `_rels`.
- Fallback par contenu de cellule : si les relations échouent, la feuille est identifiée en cherchant quelle feuille contient des données aux coordonnées de la table.

---

## [1.0.15] — 2025-05-15

### Corrigé
- `extractTablesFromZip` : recherche insensible à la casse pour les chemins ZIP, gestion des chemins relatifs `../tables/tableN.xml`, fallback vers la première feuille pour les classeurs mono-feuille.

---

## [1.0.14] — 2025-05-15

### Corrigé
- Détection des tables nommées : les fichiers `xl/tables/*.xml` sont maintenant cherchés en premier (sans dépendre de la chaîne de relations), puis liés aux feuilles via les `_rels`.

---

## [1.0.13] — 2025-05-15

### Ajouté
- **Champ `Header Row` global** pour la resource Sheet : visible pour toutes les opérations (Get Rows, Get Columns, Append Row, Update Row, Delete Row). Tous les dropdowns de colonnes se rechargent automatiquement quand cette valeur change.

### Corrigé
- Get Columns, Append Row et Update Row lisaient toujours les en-têtes depuis la ligne 1 indépendamment du paramètre Header Row.
- `deleteRowFromSheet` accepte maintenant un paramètre `headerRowIdx` optionnel.

---

## [1.0.12] — 2025-05-15

### Corrigé
- **Noms de colonnes incorrects** ("REGISTRE DES ARRÊTÉS", "Column2"…) : `columnsFromCells` sonde maintenant jusqu'à 5 lignes en profondeur et sélectionne la première ligne où au moins 75% des cellules sont remplies comme ligne d'en-tête. Gère les fichiers avec une ligne de titre au-dessus des vraies en-têtes.

---

## [1.0.11] — 2025-05-15

### Ajouté
- **Options pour Get Rows** (Sheet et Table) :
  - `Return Last N Rows` : filtrer les N dernières lignes
  - `Start From Column (Position)` : ignorer les colonnes avant la position N

---

## [1.0.10] — 2025-05-15

### Corrigé
- Détection automatique de la ligne d'en-tête dans les tables Excel nommées : utilise le contenu des cellules plutôt que l'attribut XML `tableColumn[@name]` (souvent obsolète ou auto-généré).

---

## [1.0.9] — 2025-05-15

### Corrigé
- Noms de colonnes des tables : lecture depuis les cellules réelles de la ligne d'en-tête plutôt que depuis les attributs XML `tableColumn[@name]` qui peuvent être désynchronisés.

---

## [1.0.8] — 2025-05-15

### Modifié
- README mis à jour avec la documentation complète (sélecteur Folder/File, Header Row, Column Names or IDs).

---

## [1.0.7] — 2025-05-15

### Ajouté
- **Champ `Folder`** au-dessus du sélecteur de fichier : filtre la liste des fichiers au dossier choisi (racine + 2 niveaux, chargement en parallèle).
- `loadOptionsDependsOn` sur le champ `File` : recharge automatiquement quand le dossier change.

### Modifié
- Le champ `File` (sélecteur de mode) renommé en **`From`** pour éviter le doublon avec le sélecteur de fichier.

---

## [1.0.6] — 2025-05-15

### Corrigé
- **"No data"** dans le sélecteur de fichier : `searchListMethod` n'est pas compatible avec `type: 'options'` dans toutes les versions de n8n. Retour à `loadOptionsMethod` (fiable).
- `getSpreadsheetFiles` étend maintenant le listing à 2 niveaux (racine + sous-dossiers directs) en parallèle.

---

## [1.0.5] — 2025-05-15

### Corrigé
- **"No data"** persistant dans le sélecteur de fichier : `PROPFIND Depth:infinity` est bloqué sur la plupart des configurations Nextcloud. Remplacé par une stratégie en 2 niveaux avec gestion d'erreur par dossier.

---

## [1.0.4] — 2025-05-15

### Ajouté
- **Champ recherche dans les dropdowns** via `searchListMethod` pour les sélecteurs Fichier, Feuille et Table.
- Recherche récursive dans les sous-dossiers Nextcloud pour le sélecteur de fichier.

---

## [1.0.3] — 2025-05-15

### Modifié
- **Filters** (Get Rows) transformé en **`Column Names or IDs`** multiOptions : sélection des colonnes à retourner en sortie (plus de filtre column=value).
- Les dropdowns de colonnes se rechargent automatiquement quand le fichier ou la feuille change.

---

## [1.0.2] — 2025-05-15

### Ajouté
- **Dropdowns dynamiques pour les noms de colonnes** dans tous les champs "Column Name or ID" (Filters, Column Values) : chargés automatiquement depuis le fichier sélectionné.
- `getSheetColumnNames` et `getTableColumnNames` comme méthodes `loadOptions`.

---

## [1.0.1] — 2025-05-15

### Corrigé
- **Tables Excel nommées non détectées** : SheetJS (0.18.x communauté) ignore complètement les fichiers `xl/tables/*.xml`. Remplacement par JSZip pour lire directement la structure ZIP du fichier xlsx et détecter les tables.
- Les opérations d'écriture sur les tables préservent maintenant le XML de la table (via JSZip) en plus des modifications de cellules (SheetJS).

### Ajouté
- `jszip ^3.10.1` comme dépendance directe.

---

## [1.0.0] — 2025-05-15

### Ajouté — Version initiale

**Node Nextcloud (gestion de fichiers)**
- Resource File : List, Download, Upload, Delete, Move, Copy
- Resource Folder : List, Create, Delete
- Resource Share : Create (lien public / utilisateur / groupe), Delete, Get All

**Node Nextcloud Spreadsheet (Excel-équivalent)**
- Resource Sheet : Get Rows (avec filtres), Append Row, Update Row, Delete Row, Get Columns, Clear
- Resource Table : List, Get Rows, Append Row, Update Row, Delete Row, Get Columns
- Resource Workbook : Get Sheets, Get Tables
- Sélecteurs dynamiques (From List / By Name) pour fichier, feuille et table
- Support `.xlsx`, `.xls`, `.ods`, `.csv`

**Credentials**
- Nextcloud API : Server URL + Username + App Password (Basic Auth, test via OCS)

**Dépendances initiales**
- `xlsx` (SheetJS) : lecture/écriture tableur
- `fast-xml-parser` : parsing XML WebDAV
- `jszip` : manipulation ZIP xlsx
