const { Sequelize } = require('sequelize');
const { Umzug, SequelizeStorage } = require('umzug');
const path = require('path');
const { app } = require('electron');

const isProd = process.env.NODE_ENV === 'production';
const dbPath = isProd
  ? path.join(app.getPath('userData'), 'database.sqlite')
  : path.join(__dirname, '../database.sqlite');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: false,
});

const umzug = new Umzug({
  migrations: {
    glob: path.join(__dirname, '..', 'migrations', '*.js'), // Correctly specify the glob pattern for migration files
  },
  storage: new SequelizeStorage({ sequelize }),
  context: sequelize.getQueryInterface(),
  logger: console,
});

async function runMigrations() {
  try {
    await umzug.up();
    console.log('All migrations performed successfully');
  } catch (error) {
    console.error('Migration error:', error);
  }
}

module.exports = { runMigrations };