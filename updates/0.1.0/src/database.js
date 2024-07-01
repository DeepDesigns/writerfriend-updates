const { Sequelize } = require('sequelize');
const path = require('path');
const { app } = require('electron');

// Determine the correct path to the SQLite database
const isProd = process.env.NODE_ENV === 'production';
const dbPath = isProd
  ? path.join(app.getPath('userData'), 'database.sqlite')
  : path.join(__dirname, '../database.sqlite');

// Initialize Sequelize
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: false,
});

module.exports = sequelize;
