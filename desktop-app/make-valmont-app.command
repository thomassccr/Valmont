#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Fabrique une vraie application « Valmont.app » dans /Applications
# (bon nom, icône arrondie, sans barre de navigateur, signée pour macOS)
# Double-clique ce fichier, ou lance-le depuis le Terminal.
# ─────────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")"

SITE="https://thomassccr.github.io/Valmont/"
SRC="node_modules/electron/dist/Electron.app"
APP="/Applications/Valmont.app"

echo "→ Vérification du moteur Electron…"
if [ ! -d "$SRC" ]; then
  echo "  installation (une minute)…"
  npm install
fi

echo "→ Création de $APP …"
rm -rf "$APP"
cp -R "$SRC" "$APP"

echo "→ Renommage de l'exécutable…"
mv "$APP/Contents/MacOS/Electron" "$APP/Contents/MacOS/Valmont"

echo "→ Intégration du code de l'app…"
mkdir -p "$APP/Contents/Resources/app"
curl -fsSL -o "$APP/Contents/Resources/app/icon.png" "${SITE}icon-mac.png"

cat > "$APP/Contents/Resources/app/package.json" <<'PKG'
{ "name": "valmont", "version": "1.0.0", "main": "main.js" }
PKG

cat > "$APP/Contents/Resources/app/main.js" <<'MAIN'
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const APP_URL = 'https://thomassccr.github.io/Valmont/';
app.setName('Valmont');
function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    title: 'Valmont',
    backgroundColor: '#050505',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 9 }
  });
  win.loadURL(APP_URL);
  win.webContents.on('did-finish-load', () => {
    win.webContents.insertCSS('.sidebar{padding-top:30px !important;} #global-topbar{-webkit-app-region:drag;} #global-topbar .tb-item,#global-topbar .tb-btn,#global-topbar .tb-icon-btn,#global-topbar .tb-avatar,#global-topbar #plan-banner,.sb-toggle-row,.sb-brand{-webkit-app-region:no-drag;}');
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
MAIN

echo "→ Fabrication de l'icône Mac (.icns)…"
SRCPNG="$APP/Contents/Resources/app/icon.png"
ICONSET="$(mktemp -d)/Valmont.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$SRCPNG" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s*2)); sips -z $d $d "$SRCPNG" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/valmont.icns"

echo "→ Nom et icône de l'application…"
PLIST="$APP/Contents/Info.plist"
PB=/usr/libexec/PlistBuddy
$PB -c "Set :CFBundleName Valmont" "$PLIST"
$PB -c "Set :CFBundleDisplayName Valmont" "$PLIST" 2>/dev/null || $PB -c "Add :CFBundleDisplayName string Valmont" "$PLIST"
$PB -c "Set :CFBundleExecutable Valmont" "$PLIST"
$PB -c "Set :CFBundleIconFile valmont" "$PLIST"
$PB -c "Set :CFBundleIdentifier com.valmont.app" "$PLIST"

echo "→ Signature pour macOS…"
xattr -cr "$APP"
codesign --force --deep --sign - "$APP" 2>/dev/null || true

echo "→ Rafraîchissement du Dock…"
touch "$APP"
killall Dock 2>/dev/null || true

echo "✅ Terminé ! Valmont.app est dans le dossier Applications."
open "$APP"
