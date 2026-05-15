# Guide de déploiement sur npmjs.com

Ce guide couvre toutes les étapes pour publier et mettre à jour `n8n-nodes-nextcloud-ext` sur le registre npm public.

---

## Prérequis

| Outil | Version minimale | Vérification |
|---|---|---|
| Node.js | 18.10 | `node --version` |
| npm | 9.0 | `npm --version` |
| Git | toute | `git --version` |

Le package est déjà configuré : auteur, dépôt GitHub, email.

---

## Publier une mise à jour

### 1. Modifier le code et rebuilder

```powershell
# Compiler TypeScript → dist/
$env:NODE_OPTIONS = "--use-system-ca"
npm run build

# Vérifier qu'il n'y a pas d'erreurs TypeScript
npx tsc --noEmit
```

### 2. Incrémenter la version (semantic versioning)

| Type de changement | Commande | Exemple |
|---|---|---|
| Correctif de bug | `npm version patch --no-git-tag-version` | `1.0.26` → `1.0.27` |
| Nouvelle fonctionnalité | `npm version minor --no-git-tag-version` | `1.0.26` → `1.1.0` |
| Changement cassant | `npm version major --no-git-tag-version` | `1.0.26` → `2.0.0` |

> `--no-git-tag-version` permet de bumper sans créer de tag git automatiquement (utile si le repo n'est pas propre).

### 3. Mettre à jour CHANGELOG.md

Ajoutez une section pour la nouvelle version en haut du fichier CHANGELOG.md :

```markdown
## [X.Y.Z] — YYYY-MM-DD

### Ajouté
- ...

### Corrigé
- ...

### Modifié
- ...
```

### 4. Se connecter à npm

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm login
# Username : kiriyama76
# Entrez votre mot de passe et le code 2FA
```

Ou utiliser un token Automation (recommandé pour éviter la 2FA) :

```powershell
npm config set //registry.npmjs.org/:_authToken=npm_xxxxxxxxxxxx
```

### 5. Vérifier ce qui sera publié

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm pack --dry-run
```

Vérifiez que la liste contient uniquement `dist/`, `README.md`, `LICENSE`.

### 6. Publier

```powershell
# Avec prepublishOnly (build + lint automatiques)
$env:NODE_OPTIONS = "--use-system-ca"
npm publish

# Si le linter bloque (sans les scripts pre-publish)
$env:NODE_OPTIONS = "--use-system-ca"
npm publish --ignore-scripts

# Supprimer le token de la config locale après publication
npm config delete //registry.npmjs.org/:_authToken
```

### 7. Pousser sur GitHub

```powershell
git add -A
git commit -m "feat: description de la mise à jour"
git push
```

---

## Première publication (nouveau compte npm)

### Créer un compte npmjs.com

1. Allez sur **[npmjs.com/signup](https://www.npmjs.com/signup)**
2. Username : choisissez un identifiant (ex: `kiriyama76`)
3. Confirmez votre email
4. Activez la **2FA** : Compte → Access Tokens → Two-Factor Authentication

### Générer un token Automation (recommandé)

1. npmjs.com → votre avatar → **Access Tokens**
2. **Generate New Token** → type **"Automation"** (bypasse la 2FA pour les scripts)
3. Copiez le token (affiché une seule fois)

```powershell
npm config set //registry.npmjs.org/:_authToken=npm_xxxxxxxxxxxx
npm whoami  # doit afficher votre username
```

### Vérifier la disponibilité du nom

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm view n8n-nodes-nextcloud-ext version
# Si 404 → nom disponible
```

---

## Après publication

### Vérifier sur npmjs.com

Ouvrez `https://www.npmjs.com/package/n8n-nodes-nextcloud-ext` et vérifiez :
- [ ] Le README s'affiche correctement
- [ ] La version est correcte
- [ ] Les dépendances `exceljs`, `fast-xml-parser`, `jszip`, `xlsx-populate` apparaissent

### Tester dans n8n

1. **Settings** → **Community Nodes** → désinstaller l'ancienne version
2. Réinstaller `n8n-nodes-nextcloud-ext`
3. Redémarrer n8n
4. Tester les opérations

---

## Rétracter ou déprécier une version

```powershell
# Retirer une version dans les 72h
$env:NODE_OPTIONS = "--use-system-ca"
npm unpublish n8n-nodes-nextcloud-ext@X.Y.Z

# Déprécier (visible sur npm mais toujours installable)
$env:NODE_OPTIONS = "--use-system-ca"
npm deprecate n8n-nodes-nextcloud-ext@X.Y.Z "Utiliser la version X.Y.Z+1"
```

---

## Résolution de problèmes

### Erreur SSL : `UNABLE_TO_VERIFY_LEAF_SIGNATURE`

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
# Préfixer toutes les commandes npm par cette ligne
```

### Erreur : `prepublishOnly` échoue (lint)

```powershell
npm publish --ignore-scripts
```

### Erreur : `402 Payment Required`

Le package est scopé (`@username/...`) → ajouter `--access public` :
```powershell
npm publish --access public
```

### Le node n'apparaît pas dans n8n après installation

1. Vérifiez que `dist/` est bien inclus (`npm pack --dry-run`)
2. Vérifiez que `package.json` contient la clé `n8n` avec les chemins `.js` corrects
3. **Redémarrez complètement n8n** (pas juste un rechargement)
4. Vérifiez les logs n8n au démarrage pour des erreurs d'import

---

## Récapitulatif — commandes essentielles

```powershell
# Build
$env:NODE_OPTIONS = "--use-system-ca"; npm run build

# Bump de version + publication complète
npm version patch --no-git-tag-version
$env:NODE_OPTIONS = "--use-system-ca"
npm config set //registry.npmjs.org/:_authToken=npm_xxxx
npm publish --ignore-scripts
npm config delete //registry.npmjs.org/:_authToken
git add -A && git commit -m "..." && git push
```
