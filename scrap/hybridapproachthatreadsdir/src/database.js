const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Define the projects folder
const homeDirectory = os.homedir();
const projectsFolder = path.join(homeDirectory, 'WriterFriend');

// Ensure the projects folder exists
if (!fs.existsSync(projectsFolder)) {
  fs.mkdirSync(projectsFolder, { recursive: true });
}

// Initialize Sequelize for the main database
const mainDbPath = path.join(projectsFolder, 'main_database.sqlite');
const mainSequelize = new Sequelize({
  dialect: 'sqlite',
  storage: mainDbPath,
  logging: false,
});

// Function to create a new Sequelize instance for a project
const initializeProjectDb = (projectPath) => {
  const projectDbPath = path.join(projectPath, 'project_database.sqlite');
  return new Sequelize({
    dialect: 'sqlite',
    storage: projectDbPath,
    logging: false,
  });
};

module.exports = {
  mainSequelize,
  initializeProjectDb,
  projectsFolder,
};
