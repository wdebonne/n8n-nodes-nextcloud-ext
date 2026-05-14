# Guide de déploiement sur npmjs.com

Ce guide couvre toutes les étapes pour publier `n8n-nodes-nextcloud-ext` sur le registre npm public, de la création de votre compte jusqu'à la vérification post-publication.

---

## Étape 0 — Prérequis

| Outil | Version minimale | Vérification |
|---|---|---|
| Node.js | 18.10 | `node --version` |
| npm | 9.0 | `npm --version` |
| Git | toute | `git --version` |

---

## Étape 1 — Vérifier le package

Le package est déjà configuré avec vos informations. Vérifiez que [package.json](package.json) contient bien :

```json
"author": {
  "name": "wdebonne",
  "email": "wdebonne@gmail.com"
},
"homepage": "https://github.com/wdebonne/n8n-nodes-nextcloud-ext#readme",
"bugs": {
  "url": "https://github.com/wdebonne/n8n-nodes-nextcloud-ext/issues"
},
"repository": {
  "type": "git",
  "url": "git+https://github.com/wdebonne/n8n-nodes-nextcloud-ext.git"
}
```

> Si vous n'avez pas de dépôt GitHub, laissez `homepage`, `bugs` et `repository` avec des chaînes vides — npm accepte quand même la publication.

### `README.md`

Remplacez les deux occurrences de `VOTRE_GITHUB` et `VOTRE_NOM` par vos vrais identifiants.

### `LICENSE`

Remplacez `VOTRE_NOM` par votre nom ou votre organisation.

---

## Étape 2 — Créer un compte npmjs.com

1. Rendez-vous sur **[https://www.npmjs.com/signup](https://www.npmjs.com/signup)**
2. Choisissez un **username** (il apparaîtra dans l'URL de votre package : `npmjs.com/~username`)
3. Confirmez votre adresse e-mail (vérifiez vos spams)
4. **Activez la 2FA** (obligatoire pour publier depuis npm 9+) :
   - Compte → **Access Tokens** → **Two-Factor Authentication**
   - Utilisez une app comme Google Authenticator ou Authy

---

## Étape 3 — Se connecter à npm en local

```powershell
# Windows (PowerShell) — avec contournement SSL si nécessaire
$env:NODE_OPTIONS = "--use-system-ca"
npm login
```

npm demande :
- **Username** → votre identifiant npmjs.com
- **Password** → votre mot de passe
- **Email** → votre e-mail
- **One-time password** → code 2FA de votre application

Vérifiez que vous êtes bien connecté :

```powershell
npm whoami
# Affiche : votre-username
```

---

## Étape 4 — Vérifier le nom du package

Avant de publier, vérifiez que le nom `n8n-nodes-nextcloud-ext` est disponible :

```powershell
npm search n8n-nodes-nextcloud-ext
```

Si le nom est déjà pris, modifiez le champ `"name"` dans `package.json`. Options :

```json
"name": "n8n-nodes-nextcloud-ext-[votre-username]"
"name": "@votre-username/n8n-nodes-nextcloud-ext"
```

> Un **package scopé** (`@username/...`) est toujours disponible dans votre scope personnel, mais nécessite `npm publish --access public` pour être public.

---

## Étape 5 — Build final

```powershell
# Nettoyer l'ancien build
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue

# Compiler TypeScript + copier les icônes SVG
$env:NODE_OPTIONS = "--use-system-ca"
npm run build
```

Vérifiez que le dossier `dist/` contient bien :

```
dist/
├── credentials/
│   └── NextCloudApi.credentials.js   ✓
├── nodes/
│   ├── NextCloud/
│   │   ├── NextCloud.node.js         ✓
│   │   └── nextcloud.svg             ✓
│   ├── NextCloudSpreadsheet/
│   │   ├── NextCloudSpreadsheet.node.js  ✓
│   │   └── nextcloud.svg             ✓
│   └── shared/
│       └── GenericFunctions.js       ✓
└── index.js                          ✓
```

---

## Étape 6 — Checklist pré-publication

Exécutez chaque commande et corrigez les éventuelles erreurs avant de publier.

### 6a — Vérification TypeScript

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npx tsc --noEmit
# Résultat attendu : aucune sortie (= 0 erreur)
```

### 6b — Linter

```powershell
npm run lint
# Corrigez tous les "error" (les "warning" sont acceptables)
```

### 6c — Simulation du pack (dry-run)

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm pack --dry-run
```

Vérifiez que la liste des fichiers contient **uniquement** :
- `dist/**` (vos fichiers compilés)
- `README.md`
- `LICENSE`
- `package.json`

Elle ne doit **pas** contenir : `node_modules/`, `credentials/*.ts`, `nodes/**/*.ts`, `.env`.

### 6d — Audit de sécurité

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm audit --omit=dev
# Vérifiez qu'il n'y a pas de vulnérabilités "critical" dans vos dépendances de production
```

---

## Étape 7 — Publier

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm publish
```

Pour un package scopé (ex: `@username/n8n-nodes-nextcloud-ext`) :

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm publish --access public
```

npm affiche :
```
npm notice Publishing to https://registry.npmjs.org/
+ n8n-nodes-nextcloud-ext@1.0.0
```

> La propagation sur le CDN npmjs prend **2 à 5 minutes**. Votre package sera visible sur `https://www.npmjs.com/package/n8n-nodes-nextcloud-ext`.

---

## Étape 8 — Vérifier la publication

### Sur npmjs.com

Ouvrez `https://www.npmjs.com/package/n8n-nodes-nextcloud-ext` et vérifiez :

- [ ] Le README s'affiche correctement (images, tableaux, code)
- [ ] La version est bien `1.0.0`
- [ ] L'onglet **Code** liste bien les fichiers `dist/`
- [ ] Les dépendances `fast-xml-parser` et `xlsx` apparaissent

### En installant dans n8n

Dans une instance n8n de test :

1. **Settings** → **Community Nodes** → **Install**
2. Entrez : `n8n-nodes-nextcloud-ext`
3. Redémarrez n8n
4. Vérifiez que les deux nodes apparaissent dans la palette : **Nextcloud** et **Nextcloud Spreadsheet**
5. Testez avec une credential valide

---

## Étape 9 — Soumettre à la liste officielle n8n (optionnel)

Pour apparaître dans le moteur de recherche intégré de n8n :

1. Assurez-vous que votre `package.json` contient le keyword `n8n-community-node-package` ✓ (déjà présent)
2. Ouvrez une issue ou PR sur [n8n-io/n8n](https://github.com/n8n-io/n8n) pour signaler votre package
3. n8n indexe automatiquement les packages npm portant ce keyword — cela peut prendre 24-48 h

---

## Publier une mise à jour

### Incrémenter la version (semantic versioning)

| Type de changement | Commande | Exemple |
|---|---|---|
| Correctif de bug | `npm version patch` | `1.0.0` → `1.0.1` |
| Nouvelle fonctionnalité (rétrocompatible) | `npm version minor` | `1.0.0` → `1.1.0` |
| Changement cassant (breaking change) | `npm version major` | `1.0.0` → `2.0.0` |

### Workflow de mise à jour

```powershell
# 1. Faire vos modifications dans les fichiers TypeScript

# 2. Incrémenter la version
npm version minor   # ou patch / major

# 3. Rebuild
$env:NODE_OPTIONS = "--use-system-ca"
npm run build

# 4. Publier
$env:NODE_OPTIONS = "--use-system-ca"
npm publish

# 5. Pousser le tag git créé automatiquement (si vous utilisez Git)
git push && git push --tags
```

---

## Rétracter une version (si nécessaire)

```powershell
# Retirer une version dans les 72 h après publication
$env:NODE_OPTIONS = "--use-system-ca"
npm unpublish n8n-nodes-nextcloud-ext@1.0.0

# Déprécier une version (visible sur npmjs mais toujours installable)
$env:NODE_OPTIONS = "--use-system-ca"
npm deprecate n8n-nodes-nextcloud-ext@1.0.0 "Utiliser la version 1.0.1"
```

> Au-delà de 72 h, `npm unpublish` n'est plus disponible pour les packages publics. Utilisez `npm deprecate`.

---

## Résolution de problèmes

### Erreur SSL : `UNABLE_TO_VERIFY_LEAF_SIGNATURE`

Votre réseau utilise un proxy SSL (antivirus, entreprise). Solution :

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm login   # ou npm publish, npm install...
```

### Erreur : `402 Payment Required`

Le nom du package est scopé (`@username/...`) mais vous n'avez pas ajouté `--access public` :

```powershell
npm publish --access public
```

### Erreur : `403 Forbidden` ou `You must be logged in`

```powershell
npm whoami          # vérifier si connecté
npm logout
npm login           # se reconnecter
```

### Erreur : `E409 Conflict` — version déjà publiée

La version existe déjà sur npm. Incrémentez :

```powershell
npm version patch
npm run build
npm publish
```

### Le node n'apparaît pas dans n8n après installation

1. Vérifiez que `dist/` est bien inclus dans le package publié (`npm pack --dry-run`)
2. Vérifiez que `package.json` contient la clé `n8n` avec les chemins corrects vers les fichiers `.js`
3. Redémarrez complètement n8n (pas juste un rechargement)
4. Vérifiez les logs n8n au démarrage (`n8n start` en terminal) pour des erreurs d'import

---

## Récapitulatif des commandes essentielles

```powershell
# Connexion
npm login

# Vérification pré-publication
npx tsc --noEmit && npm run lint && npm pack --dry-run

# Build + publication
npm run build && npm publish

# Mise à jour patch
npm version patch && npm run build && npm publish

# Sur Windows avec proxy SSL — préfixer toutes les commandes npm par :
$env:NODE_OPTIONS = "--use-system-ca"
```
