const { app, BrowserWindow, shell } = require('electron');

// L'app charge ton site en ligne : elle sera toujours à jour automatiquement.
const APP_URL = 'https://thomassccr.github.io/Valmont/';

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Valmont',
    backgroundColor: '#050505',
    // Aucune barre de titre : uniquement les 3 boutons ronds macOS, posés sur le contenu
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 9 },
    webPreferences: { contextIsolation: true }
  });

  win.loadURL(APP_URL);

  // Garde « Valmont » comme titre de fenêtre (sinon la page impose le sien,
  // visible dans la barre que macOS révèle en plein écran au survol du haut)
  win.webContents.on('page-title-updated', (e) => e.preventDefault());

  // Adaptations appliquées uniquement dans l'app (le site en navigateur n'est pas touché) :
  // - décale le haut de la sidebar pour que le toggle ne passe pas sous les 3 boutons macOS
  //   (les boutons sont au-dessus de la sidebar ; le reste du contenu monte jusqu'en haut)
  // - rend la barre du haut « attrapable » pour déplacer la fenêtre
  win.webContents.on('did-finish-load', () => {
    win.webContents.insertCSS(`
      .sidebar { padding-top: 30px !important; }
      #global-topbar { -webkit-app-region: drag; }
      #global-topbar .tb-item, #global-topbar .tb-btn, #global-topbar .tb-icon-btn,
      #global-topbar .tb-avatar, #global-topbar #plan-banner { -webkit-app-region: no-drag; }
      .sb-toggle-row, .sb-brand { -webkit-app-region: no-drag; }
    `);
  });

  // Les liens externes s'ouvrent dans le navigateur par défaut, pas dans l'app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
