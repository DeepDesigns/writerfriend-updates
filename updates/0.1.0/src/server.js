const express = require('express');
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs').promises; // Use the promises API
const { mainSequelize, initializeProjectDb } = require('./database');
const { projectsFolder } = require('./variables');
const { Project, defineProjectModels } = require('./models');
const { Op } = require('sequelize');
const { generateUniqueId, initializeProject, syncProjectsWithDatabase, getProjectPath } = require('./helpers');
const grayMatter = require('gray-matter');


async function createServer() {
  try {
    await fs.mkdir(projectsFolder, { recursive: true });
    console.log(`Projects folder ensured at ${projectsFolder}`);
  } catch (err) {
    console.error('Error creating projects folder:', err);
  }

  const app = express();
  const port = 3000;

  app.use(fileUpload());
  app.use(express.json());

  // Serve the static files from the React app
  app.use(express.static(path.join(__dirname, 'dist')));

  await mainSequelize.sync()
    .then(() => console.log('Main database synced successfully.'))
    .catch(err => console.error('Failed to sync main database:', err));

  // API ROUTES START FROM HERE


// Route to open a project
app.get('/api/openProject/:projectId', async (req, res) => {
  const { projectId } = req.params;

  if (!projectId) {
    console.log('Project ID is missing in the request params.');
    return res.status(400).json({ error: 'Project ID is required' });
  }

  try {
    console.log(`Finding project with ID: ${projectId}`);
    const project = await Project.findByPk(projectId);

    if (!project) {
      console.log(`Project with ID: ${projectId} not found.`);
      return res.status(404).json({ error: 'Project not found' });
    }

    if (!projectsFolder) {
      console.error('Projects folder is not defined.');
      return res.status(500).json({ error: 'Internal server error' });
    }

    const projectPath = path.join(projectsFolder, project.name);

    if (!projectPath) {
      console.error('Failed to construct project path.');
      return res.status(500).json({ error: 'Internal server error' });
    }

    console.log(`Project database at ${projectPath} found successfully.`);

    res.status(200).json({ message: 'Project opened successfully' });
  } catch (err) {
    console.error('Failed to open project:', err.message);
    res.status(500).json({ error: `Failed to open project: ${err.message}` });
  }
});



// FETCH PROJECTS
app.get('/api/projects', async (req, res) => {
  try {
    const projects = await Project.findAll();

    if (!projects) {
      return res.status(404).json({ error: 'No projects found' });
    }

    const projectList = projects.map(project => ({
      id: project.id,
      name: project.name,
      authorName: project.authorName,
      created_date: project.createdDate ? project.createdDate.toISOString().split('T').join(' ').split('.')[0] : null,
      path: project.path,
      description: project.description,
    }));

    res.status(200).json(projectList);
  } catch (err) {
    console.error('Failed to fetch projects:', err.message);
    res.status(500).json({ error: `Failed to fetch projects: ${err.message}` });
  }
});

// CREATE PROJECT
app.post('/api/create_project', async (req, res) => {
  const { name, author, description } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  const projectName = name.trim();
  const authorName = author ? author.trim() : "Author";
  const projectDescription = description ? description.trim() : 'No description available';

  try {
    const projectPath = path.join(projectsFolder, projectName);

    // Check if a project with the same path already exists
    try {
      await fs.access(projectPath);
      return res.status(409).json({ error: 'A project with this name already exists' });
    } catch (accessErr) {
      if (accessErr.code !== 'ENOENT') {
        console.error('Failed to check project path:', accessErr.message);
        return res.status(500).json({ error: `Failed to check project path: ${accessErr.message}` });
      }
    }

    await initializeProject(projectName, authorName, projectDescription, projectPath);
    res.status(201).json({ message: 'Project created successfully' });
  } catch (err) {
    console.error('Failed to create project:', err.message);
    res.status(500).json({ error: `Failed to create project: ${err.message}` });
  }
});

// DELETE PROJECT
app.post('/api/delete_project', async (req, res) => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      console.warn('Project ID is missing in the request body.');
      return res.status(400).json({ error: 'Project ID is required' });
    }

    // Retrieve project path using the helper function
    const projectPath = await getProjectPath(projectId);

    // Retrieve project from database based on id
    const project = await Project.findByPk(projectId);

    if (project) {
      await project.destroy();

      // Check if the project folder exists and delete it if it does
      try {
        await fs.rm(projectPath, { recursive: true, force: true });
        console.log(`Project folder deleted: ${projectPath}`);
      } catch (err) {
        if (err.code === 'ENOENT') {
          console.warn(`Project folder not found: ${projectPath}`);
        } else {
          console.error('Failed to delete project folder:', err.message);
          return res.status(500).json({ error: `Failed to delete project folder: ${err.message}` });
        }
      }

      console.log('Project deleted successfully');
      res.status(200).json({ message: 'Project deleted successfully' });
    } else {
      console.warn(`Project with ID ${projectId} not found in database.`);
      res.status(404).json({ error: 'Project not found in database' });
    }
  } catch (err) {
    console.error('Failed to delete project:', err.message);
    res.status(500).json({ error: `Failed to delete project: ${err.message}` });
  }
});

//explicit fetch
app.get('/api/fetch_image', async (req, res) => {
  const { imageUrl } = req.query;

  if (!imageUrl) {
    return res.status(400).json({ error: 'Image URL is required' });
  }

  try {
    const imagePath = path.resolve(__dirname, imageUrl.replace('http://localhost:3000', ''));
    
    if (!fs.existsSync(imagePath)) {
      return res.status(404).send('Image not found');
    }

    res.sendFile(imagePath, (err) => {
      if (err) {
        console.error(`Error sending file: ${err.message}`);
        res.status(err.status || 500).json({ error: `Error sending file: ${err.message}` });
      }
    });
  } catch (err) {
    console.error(`Error fetching image: ${err.message}`);
    res.status(500).json({ error: `Error fetching image: ${err.message}` });
  }
});


///directly serves static image
app.get('/projects/:projectId/images/:imageName', async (req, res) => {
  const { projectId, imageName } = req.params;

  try {
    const projectPath = await getProjectPath(projectId);
    console.log(`Project Path: ${projectPath}`);

    const imagePath = path.join(projectPath, 'images', imageName);
    console.log(`Image Path: ${imagePath}`);

    res.sendFile(imagePath, (err) => {
      if (err) {
        console.error(`Error sending file: ${err.message}`);
        res.status(err.status || 500).json({ error: `Error sending file: ${err.message}` });
      } else {
        console.log(`File sent: ${imagePath}`);
      }
    });
  } catch (err) {
    console.error(`Error fetching project image: ${err.message}`);
    res.status(500).json({ error: `Error fetching project image: ${err.message}` });
  }
});


// Fetch metadata
app.get('/api/project_metadata', async (req, res) => {
  const { projectId } = req.query;

  if (!projectId) {
    console.warn('Project ID is missing in the request query.');
    return res.status(400).json({ error: 'Project ID is required' });
  }

  try {
    const project = await Project.findByPk(projectId);
    if (!project) {
      console.warn(`Project with ID ${projectId} not found.`);
      return res.status(404).json({ error: 'Project not found' });
    }

    const metadataPath = path.join(project.path, 'metadata.json');
    let metadataContent;
    try {
      metadataContent = await fs.readFile(metadataPath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.warn(`Metadata file not found at ${metadataPath}`);
        return res.status(404).json({ error: 'Metadata file not found' });
      } else {
        console.error(`Error reading metadata file: ${err.message}`);
        return res.status(500).json({ error: 'Error reading metadata file' });
      }
    }

    const metadata = JSON.parse(metadataContent);
    const mappedMetadata = {
      title: metadata.Name,
      coverImage: metadata.coverImage ? `${req.protocol}://${req.get('host')}/projects/${projectId}/images/${metadata.coverImage}` : '',
      author: metadata['Author Name'],
      creationDate: metadata.creationDate || new Date().toISOString(),
      description: metadata.Description,
    };

    res.json(mappedMetadata);
  } catch (err) {
    console.error(`Error fetching project metadata: ${err.message}`);
    res.status(500).json({ error: `Error fetching project metadata: ${err.message}` });
  }
});

// Update Project Metadata
app.post('/api/project_metadata', async (req, res) => {
  const { projectId, title, coverImage, author, description } = req.body;

  if (!projectId) {
    return res.status(400).json({ error: 'Project ID is required' });
  }

  try {
    const project = await Project.findByPk(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const metadataPath = path.join(project.path, 'metadata.json');
    let metadata;
    try {
      const metadataContent = await fs.readFile(metadataPath, 'utf8');
      metadata = JSON.parse(metadataContent);
    } catch (err) {
      metadata = {};
    }

    // Update metadata
    metadata.Name = title || metadata.Name;
    metadata.coverImage = coverImage ? path.basename(coverImage) : metadata.coverImage; // Only store the filename
    metadata['Author Name'] = author || metadata['Author Name'];
    metadata.Description = description || metadata.Description;

    // Update database fields
    await project.update({
      name: title || project.name,
      authorName: author || project.authorName,
      description: description || project.description
    });

    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

    res.json({
      title: metadata.Name,
      coverImage: metadata.coverImage,
      author: metadata['Author Name'],
      creationDate: metadata.creationDate || new Date().toISOString(),
      description: metadata.Description,
    });
  } catch (err) {
    console.error(`Error updating project metadata: ${err.message}`);
    res.status(500).json({ error: `Error updating project metadata: ${err.message}` });
  }
});



// Upload Cover Image
app.post('/api/upload_cover_image', async (req, res) => {
  const { projectId } = req.body;
  const file = req.files ? req.files.coverImage : null;

  if (!projectId || !file) {
    return res.status(400).json({ success: 0, error: 'Missing project_id or coverImage' });
  }

  // Validate file type
  const validExtensions = ['.jpg', '.jpeg', '.png', '.gif'];
  const extension = path.extname(file.name).toLowerCase();
  if (!validExtensions.includes(extension)) {
    return res.status(400).json({ success: 0, error: 'Invalid file type. Only image files are allowed.' });
  }

  try {
    const project = await Project.findByPk(projectId);
    if (!project) {
      return res.status(404).json({ success: 0, error: 'Project not found' });
    }

    const projectFolder = await getProjectPath(projectId);
    const imagesFolder = path.join(projectFolder, 'images');
    await fs.mkdir(imagesFolder, { recursive: true });

    const fileName = `cover${extension}`;
    const filePath = path.join(imagesFolder, fileName);

    await new Promise((resolve, reject) => {
      file.mv(filePath, (err) => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });

    const metadataPath = path.join(projectFolder, 'metadata.json');
    let metadata;
    try {
      const metadataContent = await fs.readFile(metadataPath, 'utf8');
      metadata = JSON.parse(metadataContent);
    } catch (err) {
      metadata = {};
    }

    metadata.coverImage = fileName;
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

    res.json({ coverImage: `/projects/${projectId}/images/${fileName}` });
  } catch (err) {
    console.error(`Error uploading cover image: ${err.message}`);
    res.status(500).json({ success: 0, error: `Error uploading cover image: ${err.message}` });
  }
});


  

// Create Folder
app.post('/api/folders', async (req, res) => {
  const { name, parent_id, project_id } = req.body;

  if (!name || !project_id) {
    return res.status(400).json({ error: 'Folder name and project ID are required' });
  }

  try {
    const projectPath = await getProjectPath(project_id);
    const projectDb = initializeProjectDb(projectPath);
    const { Folder } = defineProjectModels(projectDb);

    await projectDb.sync();

    // Check for duplicate folder names within the same parent
    const existingFolder = await Folder.findOne({
      where: { name, parentId: parent_id }
    });

    if (existingFolder) {
      await projectDb.close();
      return res.status(400).json({ error: 'A folder with the same name already exists in this location' });
    }

    // Get the highest order number among siblings and assign the next order number
    const highestOrderFolder = await Folder.findOne({
      where: { parentId: parent_id },
      order: [['order', 'DESC']]
    });

    const order = highestOrderFolder ? highestOrderFolder.order + 1 : 0;

    const newFolder = await Folder.create({
      name,
      parentId: parent_id,
      order,
    });

    await projectDb.close();

    res.status(201).json(newFolder);
  } catch (err) {
    console.error('Failed to create folder:', err.message);
    res.status(500).json({ error: `Failed to create folder: ${err.message}` });
  }
});


// Delete Folder
app.delete('/api/folders/:folderId', async (req, res) => {
  const { folderId } = req.params;
  const { projectId } = req.query;

  if (!folderId || !projectId) {
    console.warn('Folder ID or Project ID is missing in the request.');
    return res.status(400).json({ error: 'Folder ID and Project ID are required' });
  }

  try {
    const projectPath = await getProjectPath(projectId);
    const projectDb = initializeProjectDb(projectPath);
    const { Folder } = defineProjectModels(projectDb);

    await projectDb.sync();

    const folder = await Folder.findByPk(folderId);
    if (!folder) {
      console.warn(`Folder with ID ${folderId} not found.`);
      await projectDb.close();
      return res.status(404).json({ error: 'Folder not found' });
    }

    // Get the parent ID of the folder to be deleted
    const parentId = folder.parentId;

    // Delete the folder
    await folder.destroy();

    // Update the order of remaining folders
    const remainingFolders = await Folder.findAll({
      where: { parentId },
      order: [['order', 'ASC']],
    });

    for (let i = 0; i < remainingFolders.length; i++) {
      await remainingFolders[i].update({ order: i });
    }

    await projectDb.close();

    res.status(200).json({ message: 'Folder deleted successfully' });
  } catch (err) {
    console.error('Failed to delete folder:', err.message);
    res.status(500).json({ error: `Failed to delete folder: ${err.message}` });
  }
});


// Fetch All Folders
app.get('/api/folders', async (req, res) => {
  const { project_id } = req.query;

  if (!project_id) {
    console.warn('Project ID is missing in the request query.');
    return res.status(400).json({ error: 'Project ID is required' });
  }

  try {
    const projectPath = await getProjectPath(project_id);
    const projectDb = initializeProjectDb(projectPath);
    const { Folder } = defineProjectModels(projectDb);

    await projectDb.sync();

    const folders = await Folder.findAll({
      order: [['order', 'ASC']], // Ensuring folders are returned in order
    });

    await projectDb.close();

    res.status(200).json(folders);
  } catch (err) {
    console.error('Failed to fetch folders:', err.message);
    res.status(500).json({ error: `Failed to fetch folders: ${err.message}` });
  }
});


// Rename Folder
app.put('/api/folders/:id/rename', async (req, res) => {
  const { id } = req.params;
  const { name, project_id } = req.body; // Extract project_id from the request body

  console.log('rename for id:', id, "name:", name, "project_id:", project_id);

  if (!id || !name || !project_id) {
    console.warn('Missing required parameters for renaming folder.');
    return res.status(400).json({ error: 'Folder ID, name, and project ID are required' });
  }

  try {
    const projectPath = await getProjectPath(project_id);
    const projectDb = initializeProjectDb(projectPath);
    const { Folder } = defineProjectModels(projectDb);

    await projectDb.sync();

    const result = await Folder.update({ name }, { where: { id } });

    if (result[0] === 0) {
      console.warn(`Folder with ID ${id} not found or name is the same.`);
      return res.status(404).json({ error: 'Folder not found or name unchanged' });
    }

    await projectDb.close();

    res.status(200).json({ message: 'Folder renamed successfully' });
  } catch (err) {
    console.error('Failed to rename folder:', err.message);
    res.status(500).json({ error: `Failed to rename folder: ${err.message}` });
  }
});


// Route to create a document
app.post('/api/documents', async (req, res) => {
  const { name, parent_id, project_id, type } = req.body;

  try {
    const projectPath = await getProjectPath(project_id);
    const manuscriptPath = path.join(projectPath, 'manuscript');
    const projectDb = initializeProjectDb(projectPath);
    const { Document, Folder } = defineProjectModels(projectDb);

    await projectDb.sync();

    // Get the highest order number among siblings
    const highestOrderDoc = await Document.findOne({
      where: { parentId: parent_id },
      order: [['order', 'DESC']],
    });

    const highestOrderFolder = await Folder.findOne({
      where: { parentId: parent_id },
      order: [['order', 'DESC']],
    });

    const highestOrder = Math.max(
      highestOrderDoc ? highestOrderDoc.order : 0,
      highestOrderFolder ? highestOrderFolder.order : 0
    );

    const newDocument = await Document.create({
      name,
      parentId: parent_id,
      contentPath: '', // Initialize contentPath but will update after creating the file
      order: highestOrder + 1, // Set the order
    });

    const documentId = newDocument.id;
    const documentPath = path.join(manuscriptPath, `${documentId}.json`);

    // Update the contentPath with the correct path
    await newDocument.update({ contentPath: path.join('manuscript', `${documentId}.json`) });

    // Initialize the JSON file with an empty structure
    const emptyContent = JSON.stringify({
      time: Date.now(),
      blocks: [],
      version: '', // Update with the appropriate version of Editor.js
    }, null, 2);

    await fs.writeFile(documentPath, emptyContent, 'utf8');

    await projectDb.close();

    res.status(201).json(newDocument);
  } catch (err) {
    console.error('Failed to create document:', err.message);
    res.status(500).json({ error: `Failed to create document: ${err.message}` });
  }
});

// Delete Document
app.delete('/api/documents/:documentId', async (req, res) => {
  const { documentId } = req.params;
  const { projectId } = req.query;

  try {
    const projectPath = await getProjectPath(projectId);
    const projectDb = initializeProjectDb(projectPath);
    const { Document } = defineProjectModels(projectDb);

    await projectDb.sync();

    const document = await Document.findByPk(documentId);

    if (document) {
      const parentId = document.parentId;
      const documentOrder = document.order;

      await fs.unlink(path.join(projectPath, document.contentPath)); // Delete the physical .md file
      await Document.destroy({ where: { id: documentId } });

      // Update the order of remaining documents with higher order values
      const documentsToUpdate = await Document.findAll({
        where: {
          parentId: parentId,
          order: {
            [Op.gt]: documentOrder
          }
        }
      });

      for (const doc of documentsToUpdate) {
        await doc.update({ order: doc.order - 1 });
      }
    }

    await projectDb.close();

    res.status(200).json({ message: 'Document deleted successfully' });
  } catch (err) {
    console.error('Failed to delete document:', err.message);
    res.status(500).json({ error: `Failed to delete document: ${err.message}` });
  }
});



// Rename Document
app.put('/api/documents/:id/rename', async (req, res) => {
  const { id } = req.params;
  const { name, project_id } = req.body; // Extract project_id from the request body

  console.log('rename for id:', id, "name:", name, "project_id:", project_id);

  try {
    const projectPath = await getProjectPath(project_id);
    const projectDb = initializeProjectDb(projectPath);
    const { Document } = defineProjectModels(projectDb);

    await projectDb.sync();

    const document = await Document.findByPk(id);

    if (document) {
      await document.update({ name }); // Use the document instance to update its name
    }

    await projectDb.close();

    res.status(200).json({ message: 'Document renamed successfully' });
  } catch (err) {
    console.error('Failed to rename document:', err.message);
    res.status(500).json({ error: `Failed to rename document: ${err.message}` });
  }
});

// Fetch All Documents
app.get('/api/documents', async (req, res) => {
  const { project_id } = req.query;

  if (!project_id) {
    return res.status(400).json({ error: 'Project ID is required' });
  }

  try {
    const projectPath = await getProjectPath(project_id);
    const projectDb = initializeProjectDb(projectPath);
    const { Document } = defineProjectModels(projectDb);

    await projectDb.sync();

    const documents = await Document.findAll();

    await projectDb.close();

    res.status(200).json(documents);
  } catch (err) {
    console.error('Failed to fetch documents:', err.message);
    res.status(500).json({ error: `Failed to fetch documents: ${err.message}` });
  }
});



// Route to move an item
app.put('/api/moveItem', async (req, res) => {
  const { itemId, newParentId, projectId, itemType } = req.body;
  console.log(`Received move request: itemId=${itemId}, newParentId=${newParentId}, projectId=${projectId}, itemType=${itemType}`);

  try {
    const projectPath = await getProjectPath(projectId);
    const projectDb = initializeProjectDb(projectPath);
    const { Folder, Document } = defineProjectModels(projectDb);

    await projectDb.sync();

    if (itemType === 'folder') {
      await Folder.update({ parentId: newParentId }, { where: { id: itemId } });
    } else if (itemType === 'document') {
      // Get the highest order number in the new parent folder
      const maxOrder = await Document.max('order', { where: { parentId: newParentId } }) || 0;
      await Document.update({ parentId: newParentId, order: maxOrder + 1 }, { where: { id: itemId } });
    } else {
      console.error('Invalid item type:', itemType);
      return res.status(400).json({ error: 'Invalid item type' });
    }

    await projectDb.close();

    res.status(200).json({ message: 'Item moved successfully' });
  } catch (err) {
    console.error('Failed to move item:', err.message);
    res.status(500).json({ error: `Failed to move item: ${err.message}` });
  }
});


// Reorder Documents Route
app.put('/api/reorderDocuments', async (req, res) => {
  const { draggedItemId, targetItemId, projectId } = req.body;
  console.log(`Reordering documents: draggedItemId=${draggedItemId}, targetItemId=${targetItemId}, projectId=${projectId}`);

  try {
    const projectPath = await getProjectPath(projectId);
    const projectDb = initializeProjectDb(projectPath);
    const { Document } = defineProjectModels(projectDb);

    await projectDb.sync();

    const draggedItem = await Document.findByPk(draggedItemId);
    const targetItem = await Document.findByPk(targetItemId);

    if (!draggedItem || !targetItem) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const draggedOrder = draggedItem.order;
    const targetOrder = targetItem.order;

    // If the dragged item is currently after the target item, decrement orders in between
    if (draggedOrder > targetOrder) {
      await Document.update(
        { order: projectDb.literal('`order` + 1') },
        { where: { parentId: draggedItem.parentId, order: { [Op.between]: [targetOrder, draggedOrder - 1] } } }
      );
      await draggedItem.update({ order: targetOrder });
    } else {
      await Document.update(
        { order: projectDb.literal('`order` - 1') },
        { where: { parentId: draggedItem.parentId, order: { [Op.between]: [draggedOrder + 1, targetOrder] } } }
      );
      await draggedItem.update({ order: targetOrder });
    }

    await projectDb.close();

    res.status(200).json({ message: 'Documents reordered successfully' });
  } catch (err) {
    console.error('Failed to reorder documents:', err.message);
    res.status(500).json({ error: `Failed to reorder documents: ${err.message}` });
  }
});



// Fetch Beats and Description
app.get('/api/documents/:id/beats-and-description', async (req, res) => {
  const documentId = req.params.id;
  const projectId = req.query.project_id;

  if (!projectId) {
    return res.status(400).json({ error: 'Project ID is required' });
  }

  try {
    const projectPath = await getProjectPath(projectId);

    // Initialize the project-specific database
    const projectDb = initializeProjectDb(projectPath);
    const { Document } = defineProjectModels(projectDb);

    await projectDb.sync();

    const document = await Document.findByPk(documentId);

    if (!document) {
      await projectDb.close();
      return res.status(404).json({ error: 'Document not found' });
    }

    await projectDb.close();

    res.json({ beats: document.beats, description: document.description });
  } catch (err) {
    console.error(`Failed to fetch beats and description: ${err.message}`);
    res.status(500).json({ error: `Failed to fetch beats and description: ${err.message}` });
  }
});


// Update Beats
app.put('/api/documents/:id/beats', async (req, res) => {
  const documentId = req.params.id;
  const { beats } = req.body;
  const projectId = req.query.project_id;

  if (!projectId) {
    return res.status(400).json({ error: 'Project ID is required' });
  }

  try {
    const projectPath = await getProjectPath(projectId);

    // Initialize the project-specific database
    const projectDb = initializeProjectDb(projectPath);
    const { Document } = defineProjectModels(projectDb);

    await projectDb.sync();

    const document = await Document.findByPk(documentId);

    if (!document) {
      await projectDb.close();
      return res.status(404).json({ error: 'Document not found' });
    }

    document.beats = beats;
    await document.save();
    await projectDb.close();

    res.json(document);
  } catch (err) {
    console.error(`Failed to update beats: ${err.message}`);
    res.status(500).json({ error: `Failed to update beats: ${err.message}` });
  }
});


// Update Description
app.put('/api/documents/:id/description', async (req, res) => {
  const documentId = req.params.id;
  const { description } = req.body;
  const projectId = req.query.project_id;

  if (!projectId) {
    return res.status(400).json({ error: 'Project ID is required' });
  }

  try {
    const projectPath = await getProjectPath(projectId);

    // Initialize the project-specific database
    const projectDb = initializeProjectDb(projectPath);
    const { Document } = defineProjectModels(projectDb);

    await projectDb.sync();

    const document = await Document.findByPk(documentId);

    if (!document) {
      await projectDb.close();
      return res.status(404).json({ error: 'Document not found' });
    }

    document.description = description;
    await document.save();
    await projectDb.close();

    res.json(document);
  } catch (err) {
    console.error(`Failed to update description: ${err.message}`);
    res.status(500).json({ error: `Failed to update description: ${err.message}` });
  }
});


// Fetch Document Content
app.post('/api/get_content', async (req, res) => {
  const { documentId, activeProjectId } = req.body;

  if (!documentId) {
    return res.status(400).json({ error: 'Document ID is required' });
  }

  if (!activeProjectId) {
    return res.status(400).json({ error: 'Project ID is required' });
  }

  try {
    const projectPath = await getProjectPath(activeProjectId);

    // Initialize the project-specific database
    const projectDb = initializeProjectDb(projectPath);
    const { Document } = defineProjectModels(projectDb);

    await projectDb.sync();

    const document = await Document.findByPk(documentId);

    if (!document) {
      await projectDb.close();
      return res.status(404).json({ error: 'Document not found' });
    }

    const contentPath = path.join(projectPath, document.contentPath);

    let content;
    try {
      content = await fs.readFile(contentPath, 'utf8');
    } catch (err) {
      await projectDb.close();
      return res.status(500).json({ error: `Failed to read document file: ${err.message}` });
    }

    const document_data = {
      name: document.name,
    };

    await projectDb.close();

    return res.status(200).json({ content, document_data });
  } catch (err) {
    return res.status(500).json({ error: `Error fetching document content: ${err.message}` });
  }
});


// Save Document Content
app.post('/api/save_content', async (req, res) => {
  const { documentId, activeProjectId, content } = req.body;

  if (!documentId || content === undefined) {
    return res.status(400).json({ error: 'Document ID and content are required' });
  }

  if (!activeProjectId) {
    return res.status(400).json({ error: 'Project ID is required' });
  }

  try {
    const projectPath = await getProjectPath(activeProjectId);

    // Initialize the project-specific database
    const projectDb = initializeProjectDb(projectPath);
    const { Document } = defineProjectModels(projectDb);

    await projectDb.sync();

    const document = await Document.findByPk(documentId);

    if (!document) {
      await projectDb.close();
      return res.status(404).json({ error: 'Document not found' });
    }

    const contentPath = path.join(projectPath, document.contentPath);

    try {
      await fs.writeFile(contentPath, JSON.stringify(content), 'utf8');
    } catch (err) {
      await projectDb.close();
      console.error(`Failed to write to document file: ${err.message}`);
      return res.status(500).json({ error: `Failed to write to document file: ${err.message}` });
    }

    // Update the updatedAt field
    await document.update({ updatedAt: new Date() });

    await projectDb.close();

    return res.status(200).json({ message: 'Content saved successfully' });
  } catch (err) {
    return res.status(500).json({ error: `Error saving document content: ${err.message}` });
  }
});



// Upload Song
app.post('/api/upload_song', async (req, res) => {
  const projectId = req.body.project_id;
  const file = req.files ? req.files.file : null;

  if (!projectId || !file) {
    return res.status(400).json({ success: 0, error: 'Missing project_id or file' });
  }

  try {
    const project = await Project.findByPk(projectId);

    if (!project) {
      return res.status(404).json({ success: 0, error: 'Project not found' });
    }

    const projectFolder = path.join(projectsFolder, project.path, 'songs');
    
    // Ensure the songs folder exists
    await fs.mkdir(projectFolder, { recursive: true });

    const filePath = path.join(projectFolder, file.name);

    // Move the file to the destination
    await new Promise((resolve, reject) => {
      file.mv(filePath, (err) => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });

    return res.json({ filename: file.name });
  } catch (err) {
    console.error(`Error uploading song: ${err.message}`);
    return res.status(500).json({ success: 0, error: err.message });
  }
});


// Serve Song
app.get('/api/:project_id/songs/:filename', (req, res) => {
  const { project_id, filename } = req.params;
  const project = Project.findByPk(activeProjectId);
  const songPath = path.join(project.path, 'songs', filename); // Ensure absolute path

  res.sendFile(songPath, err => {
    if (err) {
      console.error(`Error serving song from path: ${songPath}`);
      console.error(`Error serving song: ${err.message}`);
      if (!res.headersSent) {
        res.status(404).send('Song not found');
      }
    }
  });
});




// List Songs
app.post('/api/list_songs', async (req, res) => {
  const project_id = req.body.project_id;
  const songsFolder = path.join('projects', project_id, 'songs');

  try {
    await fs.access(songsFolder);
  } catch {
    return res.json([]);
  }

  try {
    const files = await fs.readdir(songsFolder);
    const fileStats = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(songsFolder, file);
        const stat = await fs.lstat(filePath);
        return { file, isFile: stat.isFile() };
      })
    );

    const songs = fileStats.filter(stat => stat.isFile).map(stat => stat.file);
    return res.json(songs);
  } catch (err) {
    console.error(`Failed to list songs: ${err.message}`);
    return res.status(500).json({ error: `Failed to list songs: ${err.message}` });
  }
});

// Upload Image
app.post('/api/upload_image', async (req, res) => {
  try {
    const projectId = req.body.project_id;
    const file = req.files ? req.files.file : null;

    if (!projectId || !file) {
      return res.status(400).json({ success: 0, error: 'Missing project_id or file' });
    }

    const sanitizedFilename = path.basename(file.name);
    const projectFolder = path.join('projects', projectId, 'images');
    await fs.mkdir(projectFolder, { recursive: true });
    const filePath = path.join(projectFolder, sanitizedFilename);

    console.log(`Saving file to: ${filePath}`);

    file.mv(filePath, (err) => {
      if (err) {
        console.error(`Error uploading image: ${err}`);
        return res.status(500).json({ success: 0, error: err.message });
      }

      return res.json({ success: 1, filename: sanitizedFilename });
    });
  } catch (err) {
    console.error(`Error uploading image: ${err}`);
    return res.status(500).json({ success: 0, error: err.message });
  }
});


// Serve Image
app.get('/api/:project_id/images/:filename', (req, res) => {
  const { project_id, filename } = req.params;
  const baseDir = path.resolve(__dirname, '..'); // Assuming your projects folder is in the parent directory of src
  const imagePath = path.join(baseDir, 'projects', project_id, 'images', filename); // Ensure absolute path

  res.sendFile(imagePath, err => {
    if (err) {
      console.error(`Error serving image from path: ${imagePath}`);
      console.error(`Error serving image: ${err.message}`);
      res.status(404).send('Image not found');
    }
  });
});


// List Images
app.post('/api/list_images', async (req, res) => {
  const project_id = req.body.project_id;
  const imagesFolder = path.join('projects', project_id, 'images');

  try {
    await fs.access(imagesFolder);
  } catch {
    return res.json([]);
  }

  try {
    const files = await fs.readdir(imagesFolder);
    const fileStats = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(imagesFolder, file);
        const stat = await fs.lstat(filePath);
        return { file, isFile: stat.isFile() };
      })
    );

    const images = fileStats.filter(stat => stat.isFile).map(stat => stat.file);
    return res.json(images);
  } catch (err) {
    console.error(`Failed to list images: ${err.message}`);
    return res.status(500).json({ error: `Failed to list images: ${err.message}` });
  }
});


// Create a new timeline
app.post('/api/timelines', async (req, res) => {
  const { projectId, name } = req.body;

  try {
    const projectPath = await getProjectPath(projectId);
    const timelinesPath = path.join(projectPath, 'timelines');
    await fs.mkdir(timelinesPath, { recursive: true });

    const timelinePath = path.join(timelinesPath, `${name}.json`);
    const timelineData = {
      nodes: [],
      edges: []
    };

    await fs.writeFile(timelinePath, JSON.stringify(timelineData, null, 2));
    res.status(201).json(timelineData);
  } catch (err) {
    console.error(`Failed to create timeline: ${err.message}`);
    res.status(500).json({ error: `Failed to create timeline: ${err.message}` });
  }
});

// Delete a timeline
app.delete('/api/timelines/:projectId/:name', async (req, res) => {
  const { projectId, name } = req.params;

  try {
    const projectPath = await getProjectPath(projectId);
    const timelinePath = path.join(projectPath, 'timelines', `${name}.json`);

    await fs.unlink(timelinePath);
    res.status(200).json({ message: 'Timeline deleted successfully' });
  } catch (err) {
    console.error(`Failed to delete timeline: ${err.message}`);
    res.status(500).json({ error: `Failed to delete timeline: ${err.message}` });
  }
});

// Fetch all timelines
app.get('/api/timelines/:projectId', async (req, res) => {
  const { projectId } = req.params;

  try {
    const projectPath = await getProjectPath(projectId);
    const timelinesPath = path.join(projectPath, 'timelines');

    const files = await fs.readdir(timelinesPath);
    const timelines = await Promise.all(files.map(async (file) => {
      const filePath = path.join(timelinesPath, file);
      const stats = await fs.stat(filePath);

      return {
        name: path.basename(file, path.extname(file)), // File name without extension
        modifiedDate: stats.mtime.toISOString(), // Last modified date
      };
    }));

    res.status(200).json(timelines);
  } catch (err) {
    console.error(`Failed to fetch timelines: ${err.message}`);
    res.status(500).json({ error: `Failed to fetch timelines: ${err.message}` });
  }
});



// Fetch timeline data (nodes and edges)
app.get('/api/:projectId/timelines/:timelineName', async (req, res) => {
  const { projectId, timelineName } = req.params;
  console.log("fetching timeline file:", projectId, timelineName);

  try {
    const projectPath = await getProjectPath(projectId);
    const timelinePath = path.join(projectPath, 'timelines', `${timelineName}.json`);

    const timelineContent = await fs.readFile(timelinePath, 'utf8');
    const timelineData = JSON.parse(timelineContent);
    console.log(timelineData);

    res.status(200).json({ nodes: timelineData.nodes, edges: timelineData.edges });
  } catch (err) {
    console.error(`Failed to fetch timeline data: ${err.message}`);
    res.status(500).json({ error: `Failed to fetch timeline data: ${err.message}` });
  }
});

// Save data of nodes and edges
app.put('/api/:projectId/timelines/:timelineName', async (req, res) => {
  const { projectId, timelineName } = req.params;
  const { nodes, edges } = req.body;

  try {
    const projectPath = await getProjectPath(projectId);
    const timelinePath = path.join(projectPath, 'timelines', `${timelineName}.json`);

    const timelineContent = await fs.readFile(timelinePath, 'utf8');
    const timelineData = JSON.parse(timelineContent);

    timelineData.nodes = nodes;
    timelineData.edges = edges;

    await fs.writeFile(timelinePath, JSON.stringify(timelineData, null, 2));

    res.status(200).json(timelineData);
  } catch (err) {
    console.error(`Failed to save timeline data: ${err.message}`);
    res.status(500).json({ error: `Failed to save timeline data: ${err.message}` });
  }
});





app.post('/api/export_to_word', async (req, res) => {
  const { documentId, projectId } = req.body;

  console.log(`Request data: documentId=${documentId}, projectId=${projectId}`);

  if (!documentId || !projectId) {
    console.error('Document ID and Project ID are required');
    return res.status(400).json({ error: 'Document ID and Project ID are required' });
  }

  try {
    const document = await Document.findByPk(documentId);
    if (!document) {
      console.error(`Document not found: ${documentId}`);
      return res.status(404).json({ error: 'Document not found' });
    }

    const contentPath = document.contentPath;
    const documentName = document.name;

    let content;
    try {
      content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
      console.log('Content read successfully:', content);
    } catch (error) {
      console.error(`Failed to read document file: ${error.message}`);
      return res.status(500).json({ error: `Failed to read document file: ${error.message}` });
    }

    const outputDir = 'tmp';
    const outputPath = path.join(outputDir, `${documentName}.docx`);
    fs.mkdirSync(outputDir, { recursive: true });

    console.log('Passing content to conversion function');
    await convertEditorJSToWord(content, outputPath, projectId); // Pass projectId here

    console.log(`Successfully exported document ${documentId} to Word`);
    res.setHeader('Content-Disposition', `attachment; filename="${documentName}.docx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.download(outputPath, (err) => {
      if (err) {
        console.error(`Failed to send file: ${err}`);
        res.status(500).json({ error: `Failed to send file: ${err.message}` });
      } else {
        console.log(`File sent: ${outputPath}`);
      }
    });
  } catch (error) {
    console.error(`Failed to export document: ${error.message}`);
    res.status(500).json({ error: `Failed to export document: ${error.message}` });
  }
});

// Fetch versions for a document
app.get('/api/versions', async (req, res) => {
  const { documentId, projectId } = req.query;

  try {
    const projectPath = await getProjectPath(projectId);
    const projectDb = initializeProjectDb(projectPath);
    const { Version } = defineProjectModels(projectDb);

    await projectDb.sync();

    const versions = await Version.findAll({ where: { documentId } });

    await projectDb.close();
    res.status(200).json(versions);
  } catch (err) {
    console.error('Failed to fetch versions:', err.message);
    res.status(500).json({ error: `Failed to fetch versions: ${err.message}` });
  }
});



// Create a new version
app.post('/api/create_version', async (req, res) => {
  const { documentId, projectId, description } = req.body;

  try {
    const projectPath = await getProjectPath(projectId);
    const projectDb = initializeProjectDb(projectPath);
    const { Version, Document } = defineProjectModels(projectDb);

    await projectDb.sync();

    const document = await Document.findByPk(documentId);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const documentContentPath = path.join(projectPath, 'manuscript', `${documentId}.json`);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const versionContentPath = path.join(projectPath, 'manuscript', 'versions', `${documentId}_${timestamp}.json`);

    await fs.mkdir(path.dirname(versionContentPath), { recursive: true });
    await fs.copyFile(documentContentPath, versionContentPath);

    const version = await Version.create({
      documentId,
      contentPath: versionContentPath,
      description,
      timestamp: new Date(),
    });

    await projectDb.close();
    res.status(201).json({ message: 'Version created successfully', version });
  } catch (err) {
    console.error('Failed to create version:', err.message);
    res.status(500).json({ error: `Failed to create version: ${err.message}` });
  }
});

// Update Version Description
app.put('/api/update_version_description', async (req, res) => {
  const { versionId, projectId, description } = req.body;

  try {
    const projectPath = await getProjectPath(projectId);
    const projectDb = initializeProjectDb(projectPath);
    const { Version } = defineProjectModels(projectDb);

    await projectDb.sync();

    const version = await Version.findByPk(versionId);
    if (!version) {
      return res.status(404).json({ error: 'Version not found' });
    }

    await version.update({ description });

    await projectDb.close();
    res.status(200).json({ message: 'Version description updated successfully' });
  } catch (err) {
    console.error('Failed to update version description:', err.message);
    res.status(500).json({ error: `Failed to update version description: ${err.message}` });
  }
});

// Fetch Version Content
app.get('/api/version_content', async (req, res) => {
  const { versionId, projectId } = req.query;

  try {
    const projectPath = await getProjectPath(projectId);
    const projectDb = initializeProjectDb(projectPath);
    const { Version } = defineProjectModels(projectDb);

    await projectDb.sync();

    const version = await Version.findByPk(versionId);
    if (!version) {
      return res.status(404).json({ error: 'Version not found' });
    }

    const versionContentPath = version.contentPath;
    const versionContent = await fs.readFile(versionContentPath, 'utf8');

    await projectDb.close();
    res.status(200).json({ content: versionContent });
  } catch (err) {
    console.error('Failed to fetch version content:', err.message);
    res.status(500).json({ error: `Failed to fetch version content: ${err.message}` });
  }
});


//End of API routes

  // Handle fallback for HTML5 history API
app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });

const server = app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

return server;
}

if (require.main === module) {
createServer();
}

module.exports = { createServer };
