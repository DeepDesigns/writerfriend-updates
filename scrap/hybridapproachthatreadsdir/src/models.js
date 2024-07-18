const { DataTypes } = require('sequelize');
const { mainSequelize, initializeProjectDb } = require('./database');

// Helper functions to generate unique IDs
function generateUniqueProjectId() {
  return Math.random().toString(36).substr(2, 6);
}

function generateUniqueId() {
  return Math.random().toString(36).substr(2, 12);
}

// Main database model
const Project = mainSequelize.define('Project', {
  id: {
    type: DataTypes.STRING(6),
    primaryKey: true,
    defaultValue: () => generateUniqueProjectId(),
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

// Function to define project-specific models
const defineProjectModels = (sequelize) => {
  const Item = sequelize.define('Item', {
    id: {
      type: DataTypes.STRING(12),
      primaryKey: true,
      defaultValue: () => generateUniqueId(),
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
      type: DataTypes.STRING(20), // 'folder' or 'document'
      allowNull: false,
    },
    contentPath: {
      type: DataTypes.STRING(255),
      allowNull: true, // Only applicable for documents
    },
    parentId: {
      type: DataTypes.STRING(12),
      allowNull: true, // Null for root items
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
      defaultValue: () => generateUniqueId(),
    },
    documentId: {
      type: DataTypes.STRING(12),
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

  Item.hasMany(Item, { foreignKey: 'parentId', as: 'subitems' });

  Item.hasMany(Version, { foreignKey: 'documentId' });
  Version.belongsTo(Item, { foreignKey: 'documentId' });

  return { Item, Version };
};

module.exports = {
  Project,
  defineProjectModels,
};
