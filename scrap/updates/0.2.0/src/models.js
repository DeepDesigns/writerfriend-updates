const { DataTypes } = require('sequelize');
const sequelize = require('./database');

function generateUniqueProjectId() {
  return Math.random().toString(36).substr(2, 6);
}

function generateUniqueId() {
  return Math.random().toString(36).substr(2, 12);
}

const Project = sequelize.define('Project', {
  id: {
    type: DataTypes.STRING(6),
    primaryKey: true,
    defaultValue: generateUniqueProjectId,
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  authorName: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  createdDate: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  path: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  description: {
    type: DataTypes.STRING,
    allowNull: true,
  },
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
    defaultValue: generateUniqueId, // Assuming generateUniqueId is a function to generate unique IDs
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
  timestamps: false // Disable the automatic createdAt and updatedAt columns
});



Project.hasMany(Folder, { foreignKey: 'projectId' });
Folder.belongsTo(Project, { foreignKey: 'projectId' });
Folder.hasMany(Folder, { foreignKey: 'parentId', as: 'subfolders' });
Folder.hasMany(Document, { foreignKey: 'parentId' });
Document.belongsTo(Folder, { foreignKey: 'parentId' });
Document.belongsTo(Project, { foreignKey: 'projectId' });

Document.hasMany(Version, { foreignKey: 'documentId' });
Version.belongsTo(Document, { foreignKey: 'documentId' });
Version.belongsTo(Project, { foreignKey: 'projectId' });

module.exports = {
  Project,
  Folder,
  Document,
  Version,
  sequelize,
};
