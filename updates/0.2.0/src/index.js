const { app, BrowserWindow, Menu, dialog } = require('electron');
const log = require('electron-log');
const path = require('path');
const { createServer } = require('./server');

log.transports.file.level = 'info';

let serverInstance;
let mainWindow;

async function startServer() {
  if (!serverInstance) {
    try {
      serverInstance = await createServer();
      log.info('Server started successfully');
    } catch (error) {
      log.error('Error starting server:', error);
      if (error.code === 'EADDRINUSE') {
        dialog.showErrorBox('Server Error', `Port 3000 is already in use.`);
        app.quit();
        return;
      } else {
        dialog.showErrorBox('Server Error', `Failed to start the server: ${error.message}`);
        app.quit();
        return;
      }
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: true,
    },
    show: false,
  });

  mainWindow.loadURL('http://localhost:3000');
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  if (process.env.NODE_ENV !== 'development') {
    mainWindow.removeMenu();
  }

  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        {
          label: 'Check for Updates',
          click() {
            // Placeholder for update checking logic
            dialog.showMessageBox({
              type: 'info',
              title: 'Check for Updates',
              message: 'Update checking functionality will be implemented here.',
              buttons: ['OK']
            });
          }
        },
        {
          label: 'Quit',
          click() {
            app.quit();
          }
        }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);

  return mainWindow;
}

app.whenReady().then(async () => {
  log.info('App is ready, starting server...');
  await startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (serverInstance) {
      serverInstance.close(() => {
        log.info('Server closed');
        app.quit();
      });
    } else {
      app.quit();
    }
  }
});

app.on('before-quit', () => {
  if (serverInstance) {
    serverInstance.close(() => {
      log.info('Server closed');
    });
  }
});

app.on('quit', () => {
  if (serverInstance) {
    serverInstance.close();
  }
});
