const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Project, defineProjectModels } = require('./models');
const { initializeProjectDb } = require('./database');
const os = require('os');
const { projectsFolder } = require('./variables');
const { Op } = require('sequelize');


// Helper function to generate unique ID
const generateUniqueId = () => {
  return uuidv4().substr(0, 12);
};

// Generate unique project ID
const generateUniqueProjectId = () => {
  return Math.random().toString(36).substr(2, 6);
};

// GET PROJECT PATH BY ID
const getProjectPath = async (projectId) => {
  try {
    const project = await Project.findByPk(projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    return project.path;
  } catch (err) {
    console.error(`Error fetching project path for project ID ${projectId}: ${err.message}`);
    throw err;
  }
};


// Create metadata file for a project
const createMetadataFile = async (projectPath, projectName, authorName, id, description = 'No description available') => {
  const metadata = {
    Name: projectName,
    'Author Name': authorName,
    ID: id,
    Description: description
  };
  const metadataPath = path.join(projectPath, 'metadata.json');
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 4));
};



// Initialize a new project
const initializeProject = async (projectName, authorName, description, projectPath) => {
  try {
    console.log('Creating project folders...');

    // Generate a unique project ID
    const projectId = generateUniqueProjectId();

    // Create the main project folder using the project name
    await fs.mkdir(projectPath, { recursive: true });

    console.log('Creating a new project record in the database...');

    // Create a new project record in the main database
    const newProject = await Project.create({
      id: projectId,
      name: projectName,
      authorName,
      createdDate: new Date(),
      path: projectPath,
      description
    });

    // Create subfolders for characters and manuscript
    await fs.mkdir(path.join(projectPath, 'characters'), { recursive: true });
    await fs.mkdir(path.join(projectPath, 'manuscript'), { recursive: true });

    // Create metadata file for the project
    await createMetadataFile(projectPath, projectName, authorName, projectId, description);

    // Create the project-specific database
    const projectDb = initializeProjectDb(projectPath);
    const { Item, Version } = defineProjectModels(projectDb);
    await projectDb.sync();

    console.log('Project initialized successfully.');
    return newProject;
  } catch (err) {
    console.error('Failed to initialize project:', err.message);
    throw new Error(`Failed to initialize project: ${err.message}`);
  }
};

const syncProjectsWithDatabase = async () => {
  console.log('Starting syncProjectsWithDatabase');

  let folders;
  try {
    folders = (await fs.readdir(projectsFolder)).filter(async file =>
      (await fs.stat(path.join(projectsFolder, file))).isDirectory()
    );
  } catch (err) {
    console.error('Error reading project folders:', err.message);
    throw new Error('Error reading project folders');
  }

  console.log('Folders:', folders);

  let projects;
  try {
    projects = await Project.findAll();
  } catch (err) {
    console.error('Error fetching projects from database:', err.message);
    throw new Error('Error fetching projects from database');
  }

  const dbProjectsMap = new Map(projects.map(project => [project.id, project]));

  for (const folder of folders) {
    const folderPath = path.join(projectsFolder, folder);
    const metadataPath = path.join(folderPath, 'metadata.json');

    if (await fs.access(metadataPath).then(() => true).catch(() => false)) {
      console.log(`Found metadata for folder: ${folder}`);
      let metadata;
      try {
        const metadataContent = await fs.readFile(metadataPath, 'utf8');
        metadata = metadataContent.trim() ? JSON.parse(metadataContent) : {};

        if (!metadata.ID) metadata.ID = generateUniqueProjectId();
        if (!metadata.Name) metadata.Name = folder;
        if (!metadata['Author Name']) metadata['Author Name'] = 'Author';
        if (!metadata.Description) metadata.Description = 'No description available';

        await createMetadataFile(folderPath, metadata.Name, metadata['Author Name'], metadata.ID, metadata.Description);
      } catch (err) {
        console.error(`Failed to read or parse metadata from ${metadataPath}:`, err.message);
        continue;
      }

      const projectId = metadata.ID;
      const projectName = metadata.Name;
      const authorName = metadata['Author Name'];
      const description = metadata.Description;

      if (dbProjectsMap.has(projectId)) {
        const project = dbProjectsMap.get(projectId);
        if (project.path !== folderPath || project.name !== projectName || project.authorName !== authorName || project.description !== description) {
          // Folder was renamed or metadata updated, update the database
          console.log(`Updating project path for project ID ${projectId}`);
          await project.update({ path: folderPath, name: projectName, authorName, description });
        }
        dbProjectsMap.delete(projectId);
      } else {
        // Initialize new project in the database
        console.log(`Initializing new project for project ID ${projectId}`);
        await initializeProject(projectName, authorName, description, folderPath);
      }
    } else {
      console.log(`No metadata found for folder: ${folder}`);
      // Ignore folders without metadata.json
      continue;
    }
  }

  // Remove deleted projects from the database
  for (const [projectId, project] of dbProjectsMap) {
    console.log(`Removing deleted project from database: ${projectId}`);
    await Project.destroy({ where: { id: projectId } });
  }

  console.log('Finished syncProjectsWithDatabase');
};



// Sync folders from structure file to database
const syncFoldersToDb = async (projectId, structureCache) => {
  for (const folderId in structureCache.folders) {
    const folder = structureCache.folders[folderId];
    const dbFolder = await Folder.findByPk(folder.id);
    if (!dbFolder) {
      await Folder.create(folder);
      console.log(`Added folder to DB: ${folder.name}`);
    }
  }
};


// Sync documents from structure file to database
const syncDocumentsToDb = async (projectId, structureCache) => {
  for (const documentId in structureCache.documents) {
    const document = structureCache.documents[documentId];
    const dbDocument = await Document.findByPk(document.id);
    if (!dbDocument) {
      await Document.create(document);
      console.log(`Added document to DB: ${document.name}`);
    }
  }
};

// Main sync function
const syncProject = async (projectId, projectPath, structureCache) => {
  try {
    // Sync folders and documents
    await syncFoldersToDb(projectId, structureCache);
    await syncDocumentsToStructure(projectId, projectPath, structureCache);
    await syncDocumentsToDb(projectId, structureCache);

    // Write updated structure file
    const structureFilePath = path.join(projectPath, 'structure.json');
    await writeStructureFile(projectId, structureCache, structureFilePath);

    console.log('Project synchronization complete');
  } catch (error) {
    console.error('Error during project synchronization:', error);
  }
};

module.exports = {
  generateUniqueId,
  generateUniqueProjectId,
  createMetadataFile,
  syncProjectsWithDatabase,
  initializeProject,
  syncProject,
  getProjectPath
  };
