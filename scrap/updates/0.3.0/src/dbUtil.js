const { Sequelize } = require('sequelize');
const path = require('path');
const { runMigrations } = require('./migrate');
const { v4: uuidv4 } = require('uuid');

function generateUniqueId() {
  return uuidv4().substr(0, 12);
}

async function setupProjectDatabase(projectPath) {
    const dbPath = path.join(projectPath, 'project.sqlite');
    const sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: dbPath,
      logging: false,
    });
    

  const Folder = sequelize.define('Folder', {
    id: {
      type: DataTypes.STRING(12),
      primaryKey: true,
      defaultValue: generateUniqueId,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    createdDate: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    parentId: {
      type: DataTypes.STRING(12),
      allowNull: true,
    },
    projectId: {
      type: DataTypes.STRING(6),
      allowNull: false,
    },
    order: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  });

  const Document = sequelize.define('Document', {
    id: {
      type: DataTypes.STRING(12),
      primaryKey: true,
      defaultValue: generateUniqueId,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    createdDate: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    modifiedDate: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      onUpdate: DataTypes.NOW,
    },
    type: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    contentPath: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    parentId: {
      type: DataTypes.STRING(12),
      allowNull: true,
    },
    projectId: {
      type: DataTypes.STRING(6),
      allowNull: false,
    },
    order: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    color: {
      type: DataTypes.STRING(7), // Assuming hex color codes
      allowNull: true,
    },
    beats: {
      type: DataTypes.JSON, // Store beats as a JSON array
      allowNull: true,
      defaultValue: [],
    },
  });

  const Version = sequelize.define('Version', {
    id: {
      type: DataTypes.STRING(12),
      primaryKey: true,
      defaultValue: generateUniqueId,
    },
    documentId: {
      type: DataTypes.STRING(12),
      allowNull: false,
    },
    projectId: {
      type: DataTypes.STRING(6),
      allowNull: false,
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    contentPath: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    color: {
      type: DataTypes.STRING(7), // Assuming hex color codes
      allowNull: true,
    },
  }, {
    timestamps: false, // Disable the automatic createdAt and updatedAt columns
  });

  return sequelize.sync()
    .then(() => ({
      Folder,
      Document,
      Version,
      sequelize,
    }));
}

module.exports = setupProjectDatabase;
