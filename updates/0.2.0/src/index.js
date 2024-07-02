//0.2.0

const { app, BrowserWindow, Menu, dialog } = require('electron');
const log = require('electron-log');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { createServer } = require('./server');

log.transports.file.level = 'info';

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
      log.info('Server started successfully');
    } catch (error) {
      log.error('Error starting server:', error);
      dialog.showErrorBox('Server Error', `Failed to start the server: ${error.message}`);
      app.quit();
    }
  }
}

async function checkForUpdates() {
  try {
    const response = await fetch(VERSIONS_URL);
    const versions = await response.json();
    log.info('Fetched versions:', versions);

    const latestVersion = versions.latest;

    if (latestVersion !== CURRENT_VERSION) {
      log.info(`Update available: ${latestVersion}`);
      const userResponse = await dialog.showMessageBox({
        type: 'info',
        title: 'Update Available',
        message: `A new update (${latestVersion}) is available. Do you want to download and install it now?`,
        buttons: ['Yes', 'No']
      });

      if (userResponse.response === 0) {
        const versionData = versions.versions[latestVersion];
        await downloadAndUpdateFiles(latestVersion, versionData);
      }
    } else {
      log.info('No updates available.');
    }
  } catch (error) {
    log.error('Error checking for updates:', error);
  }
}

async function downloadAndUpdateFiles(version, versionData) {
  try {
    const tmpDir = path.join(__dirname, 'tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir);
    }

    log.info(`Attempting to fetch update data for version: ${version}`);
    log.info(`Version data: ${JSON.stringify(versionData)}`);

    await downloadFiles(versionData.src, 'src', tmpDir, version);
    await downloadFiles(versionData.migrations, 'migrations', tmpDir, version);

    log.info('Update downloaded to temporary directory successfully.');

    copyFilesToTarget(path.join(tmpDir, 'src'), path.join(__dirname,));
    copyFilesToTarget(path.join(tmpDir, 'migrations'), path.join(__dirname, '..', 'migrations'));

    log.info('Update downloaded and applied successfully.');
    updateCurrentVersion(version);
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Applied',
      message: 'The update has been applied successfully. Please restart the application to use the latest version.',
      buttons: ['Restart', 'Later']
    }).then((result) => {
      if (result.response === 0) {
        app.quit();
        app.relaunch();
      }
    });
  } catch (error) {
    log.error('Error downloading files:', error);
  }
}

async function downloadFiles(files, folder, tmpDir, version) {
  const folderPath = path.join(tmpDir, folder);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  for (const file of files) {
    const fileUrl = `https://raw.githubusercontent.com/DeepDesigns/writerfriend-updates/main/updates/${version}/${folder}/${file}`;
    log.info(`Downloading file from URL: ${fileUrl}`);
    const filePath = path.join(folderPath, file);
    await downloadFile(fileUrl, filePath);
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        log.error(`Failed to get '${url}' (${response.statusCode})`);
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

function copyFilesToTarget(source, target) {
  if (fs.existsSync(source)) {
    const files = fs.readdirSync(source);
    files.forEach((file) => {
      const curSource = path.join(source, file);
      const curTarget = path.join(target, file);
      if (fs.lstatSync(curSource).isDirectory()) {
        copyFilesToTarget(curSource, curTarget);
      } else {
        fs.copyFileSync(curSource, curTarget);
        log.info(`Copied file from ${curSource} to ${curTarget}`);
      }
    });
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
  log.info('App is ready, starting server...');
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
