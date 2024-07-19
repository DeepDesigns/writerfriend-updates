//0.2.0
const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const fetch = require('node-fetch'); // Make sure to install node-fetch if you haven't already
const { createServer } = require('./server');

let serverInstance;
let mainWindow;

// Function to read current version from currentversion.json
function getCurrentVersion() {
  const versionFilePath = path.join(__dirname, 'currentversion.json');
  if (fs.existsSync(versionFilePath)) {
    const versionData = fs.readFileSync(versionFilePath);
    return JSON.parse(versionData).version;
  }
  return '0.1.0'; // Default version if file doesn't exist
}

const CURRENT_VERSION = getCurrentVersion(); // The current version of your app
const VERSIONS_URL = 'https://raw.githubusercontent.com/DeepDesigns/writerfriend-updates/main/versions.json'; // URL to versions.json

async function startServer() {
  if (!serverInstance) {
    try {
      serverInstance = await createServer();
      // dialog.showMessageBox({ type: 'info', title: 'Server', message: 'Server started successfully' }); // Removed this line
    } catch (error) {
      dialog.showErrorBox('Server Error', `Failed to start the server: ${error.message}`);
      app.quit();
    }
  }
}

async function checkForUpdates() {
  try {
    dialog.showMessageBox({ type: 'info', title: 'Update Check', message: 'Checking for updates...' });

    const response = await fetch(VERSIONS_URL);
    const versions = await response.json();
    
    const latestVersion = versions.latest;

    if (latestVersion !== CURRENT_VERSION) {
      const userResponse = await dialog.showMessageBox({
        type: 'info',
        title: 'Update Available',
        message: `A new update (${latestVersion}) is available. Do you want to download and install it now?`,
        buttons: ['Yes', 'No']
      });

      if (userResponse.response === 0) {
        const versionData = versions.versions[latestVersion];
        await downloadAndReplaceFiles(latestVersion, versionData);
      }
    } else {
      dialog.showMessageBox({
        type: 'info',
        title: 'No Updates',
        message: 'Your application is up-to-date.',
        buttons: ['OK']
      });
    }
  } catch (error) {
    dialog.showErrorBox('Update Error', `Error checking for updates: ${error.message}`);
  }
}

async function downloadAndReplaceFiles(version, versionData) {
  try {
    const updatesDir = path.join(__dirname, 'updates', version);
    if (!fs.existsSync(updatesDir)) {
      fs.mkdirSync(updatesDir, { recursive: true });
    }

    await downloadFiles(versionData.src, 'src', updatesDir);
    
    if (versionData.migrations) {
      await downloadFiles(versionData.migrations, 'migrations', updatesDir);
    }

    await replaceFiles(updatesDir);
    updateCurrentVersion(version);

    dialog.showMessageBox({
      type: 'info',
      title: 'Update Applied',
      message: 'The update has been applied successfully. The application will now restart.',
      buttons: ['OK']
    }).then(() => {
      app.quit();
      app.relaunch();
    });
  } catch (error) {
    dialog.showErrorBox('Update Error', `Error applying update: ${error.message}`);
  }
}

async function downloadFiles(files, folder, updatesDir) {
  const folderPath = path.join(updatesDir, folder);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  for (const file of files) {
    const fileUrl = `https://raw.githubusercontent.com/DeepDesigns/writerfriend-updates/main/updates/${path.basename(updatesDir)}/${folder}/${file}`;
    const filePath = path.join(folderPath, file);
    await downloadFile(fileUrl, filePath);
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        return reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

async function replaceFiles(updatesDir) {
  const newSrcDir = path.join(updatesDir, 'src');
  const currentSrcDir = path.join(__dirname);

  // Copy the new files from the update directory to the src directory
  await copyFiles(newSrcDir, currentSrcDir);
}

function copyFiles(source, target) {
  return new Promise((resolve, reject) => {
    fs.readdir(source, (err, files) => {
      if (err) return reject(err);

      let remaining = files.length;
      if (remaining === 0) return resolve();

      files.forEach(file => {
        const srcFile = path.join(source, file);
        const destFile = path.join(target, file);

        fs.lstat(srcFile, (err, stats) => {
          if (err) return reject(err);

          if (stats.isDirectory()) {
            fs.mkdir(destFile, { recursive: true }, (err) => {
              if (err) return reject(err);
              copyFiles(srcFile, destFile).then(() => {
                if (--remaining === 0) resolve();
              }).catch(reject);
            });
          } else {
            fs.copyFile(srcFile, destFile, err => {
              if (err) return reject(err);
              if (--remaining === 0) resolve();
            });
          }
        });
      });
    });
  });
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
            checkForUpdates();
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
  await startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function updateCurrentVersion(version) {
  const versionFilePath = path.join(__dirname, 'currentversion.json');
  const versionData = JSON.stringify({ version }, null, 2);
  fs.writeFileSync(versionFilePath, versionData);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (serverInstance) {
      serverInstance.close(() => {
        app.quit();
      });
    } else {
      app.quit();
    }
  }
});

app.on('before-quit', () => {
  if (serverInstance) {
    serverInstance.close();
  }
});

app.on('quit', () => {
  if (serverInstance) {
    serverInstance.close();
  }
});
