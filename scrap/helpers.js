const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Project } = require('./models'); // Ensure you have access to your models here

const homeDirectory = require('os').homedir();
const projectsFolder = path.join(homeDirectory, 'WriterFriend');

// Helper function to read JSON file
const readJsonFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const data = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(data);
};

// Helper function to write JSON file
const writeJsonFile = (filePath, data) => {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
};

// Helper function to generate unique ID
const generateUniqueId = () => {
  return uuidv4().substr(0, 12);
};

// Helper function to save JSON tree
const saveJsonTree = (tree, treePath) => {
  fs.writeFileSync(treePath, JSON.stringify(tree, null, 2));
};

// Generate the initial file list with IDs
const generateFileListWithIds = (dirPath) => {
  const result = [];

  const traverseDirectory = (currentPath, parent = null) => {
    const items = fs.readdirSync(currentPath);
    items.forEach((item) => {
      const itemPath = path.join(currentPath, item);
      const stats = fs.statSync(itemPath);

      if (stats.isDirectory() || item.endsWith('.md')) {
        const id = generateUniqueId();

        const file = {
          id,
          type: stats.isDirectory() ? 'folder' : 'file',
          name: item,
          path: itemPath,
          children: []
        };

        if (parent) {
          parent.children.push(file);
        } else {
          result.push(file);
        }

        if (stats.isDirectory()) {
          traverseDirectory(itemPath, file);
        }
      }
    });
  };

  traverseDirectory(dirPath);
  return result;
};

// Helper function to find item path
const findItemPath = (tree, id, basePath) => {
  for (const item of tree) {
    const itemPath = path.join(basePath, item.name);
    if (item.id === id) {
      return itemPath;
    }
    if (item.children) {
      const childPath = findItemPath(item.children, id, itemPath);
      if (childPath) {
        return childPath;
      }
    }
  }
  return null;
};

// Generate unique project ID
const generateUniqueProjectId = () => {
  return Math.random().toString(36).substr(2, 6);
};

// Create metadata file for a project
const createMetadataFile = (projectPath, projectName, authorName, id, description = 'No description available') => {
  const metadata = {
    Name: projectName,
    'Author Name': authorName,
    ID: id,
    Description: description
  };
  const metadataPath = path.join(projectPath, 'metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 4));
};

const syncProjectsWithDatabase = async () => {
  const folders = fs.readdirSync(projectsFolder).filter(file =>
    fs.statSync(path.join(projectsFolder, file)).isDirectory()
  );

  const projects = await Project.findAll();
  const dbProjectsMap = new Map(projects.map(project => [project.id, project]));
  const dbProjectsPathMap = new Map(projects.map(project => [project.path, project.id]));

  for (const folder of folders) {
    const folderPath = path.join(projectsFolder, folder);
    const metadataPath = path.join(folderPath, 'metadata.json');

    if (fs.existsSync(metadataPath)) {
      let metadata;
      try {
        const metadataContent = fs.readFileSync(metadataPath, 'utf8');
        metadata = metadataContent.trim() ? JSON.parse(metadataContent) : {};

        if (!metadata.ID) metadata.ID = generateUniqueProjectId();
        if (!metadata.Name) metadata.Name = folder;
        if (!metadata['Author Name']) metadata['Author Name'] = 'Author';
        if (!metadata.Description) metadata.Description = 'No description available';

        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 4));
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
        if (project.path !== folderPath) {
          // Folder was renamed, update the database with the new path
          await project.update({ path: folderPath, name: projectName, authorName, description });
        }
        dbProjectsMap.delete(projectId);
      } else if (dbProjectsPathMap.has(folderPath)) {
        const existingProjectId = dbProjectsPathMap.get(folderPath);
        // Folder path matches an existing project, update project ID and metadata
        const project = dbProjectsMap.get(existingProjectId);
        await project.update({ id: projectId, name: projectName, authorName, description });
        dbProjectsMap.delete(existingProjectId);
      } else {
        // New project folder, create a new record
        await Project.create({
          id: projectId,
          name: projectName,
          authorName: authorName,
          createdDate: new Date(),
          path: folderPath,
          description: description
        });
      }
    }
  }

  // Remove deleted projects from the database
  for (const [projectId, project] of dbProjectsMap) {
    await Project.destroy({ where: { id: projectId } });
  }
};
// Function to get project path by project ID
const getProjectPathById = async (projectId) => {
    const project = await Project.findOne({ where: { id: projectId } });
    if (!project) {
      throw new Error('Project not found');
    }
    return project.path;
  };
  

module.exports = {
  readJsonFile,
  writeJsonFile,
  generateUniqueId,
  saveJsonTree,
  generateFileListWithIds,
  findItemPath,
  generateUniqueProjectId,
  createMetadataFile,
  syncProjectsWithDatabase,
  getProjectPathById
};
