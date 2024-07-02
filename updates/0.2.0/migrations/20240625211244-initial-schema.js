'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Create Projects table
    await queryInterface.createTable('Projects', {
      id: {
        type: Sequelize.STRING(6),
        primaryKey: true,
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      authorName: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      createdDate: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      path: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      description: {
        type: Sequelize.STRING,
        allowNull: true,
      },
    });

    // Create Folders table
    await queryInterface.createTable('Folders', {
      id: {
        type: Sequelize.STRING(12),
        primaryKey: true,
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      createdDate: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      parentId: {
        type: Sequelize.STRING(12),
        allowNull: true,
      },
      projectId: {
        type: Sequelize.STRING(6),
        allowNull: false,
      },
      order: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      description: {
        type: Sequelize.STRING,
        allowNull: true,
      },
    });

    // Create Documents table
    await queryInterface.createTable('Documents', {
      id: {
        type: Sequelize.STRING(12),
        primaryKey: true,
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      createdDate: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      modifiedDate: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
        onUpdate: Sequelize.NOW,
      },
      type: {
        type: Sequelize.STRING(20),
        allowNull: false,
      },
      contentPath: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      parentId: {
        type: Sequelize.STRING(12),
        allowNull: true,
      },
      projectId: {
        type: Sequelize.STRING(6),
        allowNull: false,
      },
      order: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      description: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      color: {
        type: Sequelize.STRING(7),
        allowNull: true,
      },
      beats: {
        type: Sequelize.JSON,
        allowNull: true,
        defaultValue: [],
      },
    });

    // Create Versions table
    await queryInterface.createTable('Versions', {
      id: {
        type: Sequelize.STRING(12),
        primaryKey: true,
      },
      documentId: {
        type: Sequelize.STRING(12),
        allowNull: false,
      },
      projectId: {
        type: Sequelize.STRING(6),
        allowNull: false,
      },
      timestamp: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      contentPath: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      description: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      color: {
        type: Sequelize.STRING(7),
        allowNull: true,
      },
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Drop tables in reverse order
    await queryInterface.dropTable('Versions');
    await queryInterface.dropTable('Documents');
    await queryInterface.dropTable('Folders');
    await queryInterface.dropTable('Projects');
  },
};
