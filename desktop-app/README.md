# Valmont — Application Mac (sans barre)

Transforme Valmont en vraie application macOS, dans sa propre fenêtre, **sans
aucune barre de navigateur** (seulement les 3 boutons ronds du Mac).

L'app affiche ton site en ligne : elle reste donc toujours à jour toute seule.

## Installation (une seule fois, ~10 min)

### 1. Installer Node.js

Va sur **https://nodejs.org**, télécharge la version **LTS** (gros bouton de
gauche), ouvre le fichier `.pkg` et clique « Continuer » jusqu'au bout.
(C'est ce qui permet de fabriquer l'app.)

### 2. Ouvrir le Terminal dans ce dossier

- Ouvre l'app **Terminal** (Cmd + Espace, tape « Terminal », Entrée).
- Tape `cd ` (avec l'espace), puis **glisse le dossier `desktop-app`** depuis le
  Finder dans la fenêtre du Terminal, puis Entrée.

### 3. Copier-coller ces deux commandes (une à la fois)

```
npm install
```
```
npm run build
```

Attends que ça finisse (quelques minutes la première fois).

### 4. Installer l'app

- Ouvre le dossier **`dist`** qui vient d'apparaître.
- Double-clique le fichier **`Valmont-1.0.0.dmg`**.
- Glisse l'icône **Valmont** dans le dossier **Applications**.
- Lance Valmont depuis le Launchpad ou le dossier Applications.

### Au premier lancement

macOS peut dire « Valmont ne peut pas être ouvert car le développeur n'est pas
vérifié » (normal : l'app n'est pas signée). Fais :
**clic droit sur l'app → « Ouvrir » → « Ouvrir »**. Une seule fois, ensuite elle
s'ouvre normalement.

## Modifier plus tard

L'app pointe vers `https://thomassccr.github.io/Valmont/` (voir `main.js`).
Comme elle charge le site en ligne, **toute mise à jour du site apparaît
automatiquement** dans l'app, sans rien reconstruire.
