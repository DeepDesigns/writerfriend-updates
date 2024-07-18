const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Project, defineProjectModels } = require('./models'); // Ensure you have access to your models here
const { mainSequelize, initializeProjectDb, projectsFolder } = require('./database');
const os = require('os');

const homeDirectory = os.homedir();

// Helper function to generate unique ID
const generateUniqueId = () => {
  return uuidv4().substr(0, 12);
};

// Generate unique project ID
const generateUniqueProjectId = () => {
  return Math.random().toString(36).substr(2, 6);
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
      authorName: authorName,
      createdDate: new Date(),
      path: projectPath,
      description: description
    });

    // Create subfolders for characters and manuscript
    await fs.mkdir(path.join(projectPath, 'characters'), { recursive: true });
    await fs.mkdir(path.join(projectPath, 'manuscript'), { recursive: true });

    // Initialize the project's database
    const projectSequelize = initializeProjectDb(projectPath);
    defineProjectModels(projectSequelize);

    // Sync the project's database
    await projectSequelize.sync();

    // Create metadata file for the project
    await createMetadataFile(projectPath, projectName, authorName, newProject.id, description);

    console.log('Project initialized successfully.');
    return newProject;
  } catch (err) {
    console.error('Failed to initialize project:', err.message);
    throw new Error(`Failed to initialize project: ${err.message}`);
  }
};

// Helper function to traverse the directory
const traverseDirectory = async (dir) => {
  let results = [];
  console.log(`Reading directory: ${dir}`);
  try {
    const list = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of list) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push({ type: 'folder', path: fullPath });
        const subResults = await traverseDirectory(fullPath);
        results = results.concat(subResults);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push({ type: 'file', path: fullPath });
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dir}:`, err);
  }
  return results;
};

// Sync projects with the database
const syncProjectsWithDatabase = async () => {
  console.log('Starting syncProjectsWithDatabase');

  const folders = (await fs.readdir(projectsFolder)).filter(async file =>
    (await fs.stat(path.join(projectsFolder, file))).isDirectory()
  );

  console.log('Folders:', folders);

  const projects = await Project.findAll();
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
        // Use the initializeProject function to handle new projects
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

// Sync filesystem with database
// Sync filesystem with database
const syncFilesystemWithDatabase = async (projectId) => {
  try {
    console.log(`Fetching project with ID: ${projectId}`);
    const project = await Project.findByPk(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const projectPath = project.path;
    console.log(`Project path: ${projectPath}`);
    const manuscriptPath = path.join(projectPath, 'manuscript');
    console.log(`Manuscript path: ${manuscriptPath}`);
    const projectSequelize = initializeProjectDb(projectPath);
    const { Item } = defineProjectModels(projectSequelize);

    console.log('Fetching items from the project database...');
    const dbItems = await Item.findAll();
    const dbItemsMap = new Map(dbItems.map(item => [item.contentPath, item]));

    console.log('Traversing manuscript directory...');
    const fileSystemItems = await traverseDirectory(manuscriptPath);

    const itemsToCreate = [];
    const itemsToUpdate = [];
    const itemsToDelete = new Set(dbItemsMap.keys());

    // Map to hold the newly created item IDs to assign parent IDs correctly
    const newItemsMap = new Map();

    console.log('Preparing batch operations...');
    for (const fsItem of fileSystemItems) {
      const relativePath = path.relative(manuscriptPath, fsItem.path);
      const parentDir = path.dirname(relativePath) === '.' ? null : path.dirname(relativePath);

      let parentId = null;
      if (parentDir) {
        const parentItem = dbItemsMap.get(parentDir) || newItemsMap.get(parentDir);
        parentId = parentItem ? parentItem.id : null;
      }

      if (!dbItemsMap.has(relativePath)) {
        const newItem = {
          id: generateUniqueId(),
          name: path.basename(relativePath),
          type: fsItem.type === 'folder' ? 'folder' : 'document',
          contentPath: relativePath,
          parentId: parentId,
          order: 0,
          createdDate: new Date(),
          modifiedDate: new Date(),
          beats: [],
        };
        itemsToCreate.push(newItem);
        newItemsMap.set(relativePath, newItem); // Add to new items map
      } else {
        const dbItem = dbItemsMap.get(relativePath);
        if (dbItem.parentId !== parentId) {
          dbItem.parentId = parentId;
          itemsToUpdate.push(dbItem);
        }
        itemsToDelete.delete(relativePath); // Remove existing items from the deletion set
      }
    }

    console.log('Executing batch operations...');
    await Item.bulkCreate(itemsToCreate);

    // Batch update using transactions
    const transaction = await projectSequelize.transaction();
    try {
      await Promise.all(itemsToUpdate.map(item => item.save({ transaction })));
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    await Item.destroy({ where: { contentPath: Array.from(itemsToDelete) } });

    console.log('Sync completed successfully.');
  } catch (error) {
    console.error('Error syncing filesystem with database:', error);
  }
};


const correctOrderNumbers = async (projectId) => {
  try {
    console.log(`Correcting order numbers for project with ID: ${projectId}`);
    const project = await Project.findByPk(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const projectPath = project.path;
    const projectSequelize = initializeProjectDb(projectPath);
    const { Item } = defineProjectModels(projectSequelize);

    // Fetch all items from the project database
    console.log('Fetching items from the project database...');
    const dbItems = await Item.findAll();

    // Group items by parentId
    const itemsByParent = dbItems.reduce((acc, item) => {
      const parentId = item.parentId || 'root';
      if (!acc[parentId]) {
        acc[parentId] = [];
      }
      acc[parentId].push(item);
      return acc;
    }, {});

    // Correct order numbers within each group
    const updates = [];
    for (const [parentId, items] of Object.entries(itemsByParent)) {
      // Sort items by their existing order to preserve relative ordering
      items.sort((a, b) => a.order - b.order);

      // Assign unique order numbers
      items.forEach((item, index) => {
        if (item.order !== index + 1) {
          item.order = index + 1;
          updates.push(item.save());
        }
      });
    }

    // Perform all updates in parallel
    await Promise.all(updates);

    console.log('Order numbers corrected successfully.');
  } catch (error) {
    console.error('Error correcting order numbers:', error);
  }
};



module.exports = {
  generateUniqueId,
  generateUniqueProjectId,
  createMetadataFile,
  syncProjectsWithDatabase,
  syncFilesystemWithDatabase,
  initializeProject,
  correctOrderNumbers
};
