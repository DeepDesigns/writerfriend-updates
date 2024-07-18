const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');
const { projectsFolder } = require('./variables');

// Ensure the projects folder exists
if (!fs.existsSync(projectsFolder)) {
  fs.mkdirSync(projectsFolder, { recursive: true });
}

// Function to create a new Sequelize instance with WAL mode enabled
const createSequelizeInstance = (dbPath) => {
  const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: dbPath,
    logging: false,
    dialectOptions: {
      mode: require('sqlite3').OPEN_READWRITE | require('sqlite3').OPEN_CREATE | require('sqlite3').OPEN_FULLMUTEX,
    },
  });

  // Enable WAL mode
  sequelize.query('PRAGMA journal_mode = WAL;').then(() => {
    // console.log(`WAL mode enabled for database at ${dbPath}`);
  }).catch((err) => {
    console.error(`Failed to enable WAL mode for database at ${dbPath}:`, err.message);
  });

  return sequelize;
};

// Initialize Sequelize for the main database
const mainDbPath = path.join(projectsFolder, 'main_database.sqlite');
const mainSequelize = createSequelizeInstance(mainDbPath);

// Function to create a new Sequelize instance for a project
const initializeProjectDb = (projectPath) => {
  const projectDbPath = path.join(projectPath, 'project_database.sqlite');
  return createSequelizeInstance(projectDbPath);
};

module.exports = {
  mainSequelize,
  initializeProjectDb,
  projectsFolder,
};
