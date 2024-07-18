const express = require('express');
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs').promises; // Use the promises API
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const { Project, defineProjectModels } = require('./models');
const { runMigrations } = require('./migrate');
const {
  generateUniqueId,
  generateUniqueProjectId,
  createMetadataFile,
  syncProjectsWithDatabase,
  syncFilesystemWithDatabase,
  initializeProject,
  correctOrderNumbers
} = require('./helpers');
const { mainSequelize, initializeProjectDb, projectsFolder } = require('./database');

let activeProjectPath = null;
const treePath = 'foldertree.json';
let jsonTree = [];

// Ensure the projects folder exists
fs.mkdir(projectsFolder, { recursive: true }).catch(err => console.error('Error creating projects folder:', err));

async function createServer() {
  const app = express();
  const port = 3000;

  await runMigrations();
  app.use(fileUpload());
  app.use(express.json());

  // Serve the static files from the React app
  app.use(express.static(path.join(__dirname, '/dist')));

  // Sync the main database
  await mainSequelize.sync()
    .then(() => console.log('Main database synced successfully.'))
    .catch(err => console.error('Failed to sync main database:', err));

  // API ROUTES START FROM HERE

  // OPENING A PROJECT
  app.get('/api/openProject/:projectId', async (req, res) => {
    const projectId = req.params.projectId;

    try {
      const project = await Project.findOne({ where: { id: projectId } });

      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
      activeProjectPath = project.path;
      console.log("project path opened:", activeProjectPath);

      // Sync the filesystem with the project's database
      await syncFilesystemWithDatabase(projectId);

      // Correct order numbers
      await correctOrderNumbers(projectId);

      res.json({ message: 'Project opened successfully', project });
    } catch (error) {
      console.error('Error opening project:', error);
      res.status(500).json({ error: 'Failed to open project' });
    }
  });

  // FETCH PROJECTS
  app.get('/api/projects', async (req, res) => {
    try {
      await syncProjectsWithDatabase();
      const projects = await Project.findAll();
      const projectList = projects.map(project => ({
        id: project.id,
        name: project.name,
        authorName: project.authorName,
        created_date: project.createdDate.toISOString().split('T').join(' ').split('.')[0],
        path: project.path,
        description: project.description
      }));
      res.json(projectList);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // CREATE PROJECT
  app.post('/api/create_project', async (req, res) => {
    const projectData = req.body;
    const projectName = projectData.name.trim();
    const authorName = projectData.author ? projectData.author.trim() : "Author";
    const description = projectData.description ? projectData.description.trim() : 'No description available';

    if (!projectName) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    try {
      const projectPath = path.join(projectsFolder, projectName);
      await initializeProject(projectName, authorName, description, projectPath);
      res.status(200).json({ message: 'Project created successfully' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE PROJECT
  app.post('/api/delete_project', async (req, res) => {
    try {
      const { id: projectId, path: projectPath } = req.body;

      if (!projectPath) {
        return res.status(400).json({ error: 'Project path is required' });
      }

      // Retrieve project from database based on id
      const project = await Project.findByPk(projectId);

      if (project) {
        await project.destroy();

        // Check if the project folder exists and delete it if it does
        try {
          await fs.rm(projectPath, { recursive: true, force: true });
          console.log(`Project folder deleted: ${projectPath}`);
        } catch (err) {
          console.warn(`Project folder not found: ${projectPath}`);
        }

        console.log('Project deleted successfully');
        res.status(200).json({ message: 'Project deleted successfully' });
      } else {
        console.warn('Project not found in database');
        res.status(404).json({ error: 'Project not found in database' });
      }
    } catch (err) {
      console.error('Failed to delete project:', err.message);
      res.status(500).json({ error: `Failed to delete project: ${err.message}` });
    }
  });

  // FETCH PROJECT ITEMS
  app.get('/api/getProjectItems/:projectId', async (req, res) => {
    const projectId = req.params.projectId;

    try {
      const project = await Project.findOne({ where: { id: projectId } });

      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      const projectPath = project.path;
      const projectSequelize = initializeProjectDb(projectPath);
      const { Item } = defineProjectModels(projectSequelize);

      const items = await Item.findAll();

      res.json(items);
    } catch (error) {
      console.error('Error fetching project items:', error);
      res.status(500).json({ error: 'Failed to fetch project items' });
    }
  });

 // ADD NODE
 app.post('/api/projects/:projectId/nodes', async (req, res) => {
  const { projectId } = req.params;
  const { name, type, parentId } = req.body;

  if (!name || !type) {
    return res.status(400).json({ error: 'Name and type are required' });
  }

  try {
    // Initialize the project's database using the global project path
    const projectSequelize = initializeProjectDb(activeProjectPath);
    const { Item } = defineProjectModels(projectSequelize);

    // Determine contentPath based on parentId and name
    const parentItem = parentId ? await Item.findByPk(parentId) : null;
    const parentPath = parentItem ? parentItem.contentPath : '';
    const contentPath = type === 'document' ? path.join(parentPath, `${name}.md`) : path.join(parentPath, name);

    console.log(`Creating new node with contentPath: ${contentPath}`);

    // Create the new node in the database
    const newNode = await Item.create({
      id: generateUniqueId(),
      name,
      type,
      parentId,
      contentPath,
      order: 0, // Set the order to 0 initially, you can adjust this later
      createdDate: new Date(),
      modifiedDate: new Date(),
      beats: [],
    });

    // Create the corresponding folder or file in the filesystem
    const fullPath = path.join(activeProjectPath, 'manuscript', contentPath);
    if (type === 'folder') {
      await fs.mkdir(fullPath, { recursive: true });
    } else if (type === 'document') {
      await fs.writeFile(fullPath, ''); // Create an empty .md file
    }

    console.log(`Created new node at path: ${fullPath}`);

    res.status(201).json(newNode);
  } catch (error) {
    console.error('Error adding node:', error);
    res.status(500).json({ error: 'Failed to add node' });
  }
});








// Create Folder
app.post('/api/folders', async (req, res) => {
  const data = req.body;
  console.log(`Request data: ${JSON.stringify(data)}`); // Log request data

  const { name, parent_id, project_id, order = 0 } = data; // match the Flask variable names

  if (!name || !project_id) {
    console.error('Validation failed: Name and project_id are required');
    return res.status(400).json({ error: 'Name and project_id are required' });
  }

  try {
    console.log(`Looking up project with id: ${project_id}`);
    const project = await Project.findByPk(project_id);
    if (!project) {
      console.error(`Project not found: ${project_id}`);
      return res.status(404).json({ error: 'Project not found' });
    }

    console.log('Generating unique folder ID');
    const folder_id = generateUniqueId();

    console.log('Creating folder in database');
    const folder = await Folder.create({
      id: folder_id,
      name,
      parentId: parent_id,
      projectId: project_id,
      order,
      createdDate: new Date(),
      description: null
    });

    console.log(`Folder created: ${folder.id}`);
    res.status(201).json({ message: 'Folder created', folder: { id: folder.id, name: folder.name } });
  } catch (err) {
    console.error(`Failed to create folder: ${err.message}`);
    res.status(500).json({ error: `Failed to create folder: ${err.message}` });
  }
});

// Fetch All Folders
app.get('/api/folders', async (req, res) => {
  const project_id = req.query.project_id; // match the Flask variable name

  if (!project_id) {
    console.error('Validation failed: project_id is required');
    return res.status(400).json({ error: 'project_id is required' });
  }

  try {
    console.log(`Fetching folders for project_id: ${project_id}`);
    const folders = await Folder.findAll({
      where: { projectId: project_id },
      order: [['order', 'ASC']],
    });

    console.log(`Found ${folders.length} folders for project_id: ${project_id}`);

    const foldersList = folders.map(f => ({
      id: f.id,
      name: f.name,
      parent_id: f.parentId, // match the Flask variable name
      order: f.order,
      description: f.description,
    }));

    console.log('Returning folders list:', JSON.stringify(foldersList));
    res.json(foldersList);
  } catch (err) {
    console.error(`Failed to fetch folders: ${err.message}`);
    res.status(500).json({ error: `Failed to fetch folders: ${err.message}` });
  }
});


// Delete Folder
app.delete('/api/folders/:folder_id', async (req, res) => {
  const folder_id = req.params.folder_id;

  try {
    console.log(`Fetching folder with id: ${folder_id}`);
    const folder = await Folder.findByPk(folder_id);
    if (!folder) {
      console.error(`Folder not found: ${folder_id}`);
      return res.status(404).json({ error: 'Folder not found' });
    }

    const parent_id = folder.parentId;
    const order = folder.order;

    console.log(`Deleting folder with id: ${folder_id}`);
    await folder.destroy();

    console.log(`Fetching remaining folders and documents with parent_id: ${parent_id} and order > ${order}`);
    const remainingFolders = await Folder.findAll({
      where: {
        parentId: parent_id,
        order: { [Op.gt]: order },
      },
    });

    const remainingDocuments = await Document.findAll({
      where: {
        parentId: parent_id,
        order: { [Op.gt]: order },
      },
    });

    for (const sibling of [...remainingFolders, ...remainingDocuments]) {
      console.log(`Updating order for ${sibling.constructor.name} with id: ${sibling.id}`);
      sibling.order -= 1;
      await sibling.save();
    }

    console.log(`Folder with id: ${folder_id} deleted successfully`);
    res.json({ message: 'Folder deleted' });
  } catch (err) {
    console.error(`Failed to delete folder: ${err.message}`);
    res.status(500).json({ error: `Failed to delete folder: ${err.message}` });
  }
});



// Rename Folder
app.put('/api/folders/:folder_id/rename', async (req, res) => {
  const folder_id = req.params.folder_id;
  const { name: new_name } = req.body;

  if (!new_name) {
    console.error('Validation failed: New name is required');
    return res.status(400).json({ error: 'New name is required' });
  }

  try {
    console.log(`Fetching folder with id: ${folder_id}`);
    const folder = await Folder.findByPk(folder_id);
    if (!folder) {
      console.error(`Folder not found: ${folder_id}`);
      return res.status(404).json({ error: 'Folder not found' });
    }

    console.log(`Renaming folder with id: ${folder_id} to new name: ${new_name}`);
    folder.name = new_name;
    await folder.save();

    console.log(`Folder with id: ${folder_id} renamed successfully`);
    res.json({ message: 'Folder renamed successfully' });
  } catch (err) {
    console.error(`Failed to rename folder: ${err.message}`);
    res.status(500).json({ error: `Failed to rename folder: ${err.message}` });
  }
});


// Reorder Items
app.post('/api/reorder', async (req, res) => {
  const data = req.body;
  const items = data.items || [];

  console.log(`Received items for reordering: ${JSON.stringify(items)}`);

  const transaction = await sequelize.transaction();

  try {
    for (const item of items) {
      const { type, id, order, parent_id } = item;
      console.log(`Processing item: ${JSON.stringify(item)}`);

      if (type === 'folder') {
        const folder = await Folder.findByPk(id, { transaction });
        if (folder) {
          folder.order = order;
          folder.parentId = parent_id;
          await folder.save({ transaction });
          console.log(`Updated folder: ${JSON.stringify(folder)}`);
        }
      } else if (type === 'document') {
        const document = await Document.findByPk(id, { transaction });
        if (document) {
          document.order = order;
          document.parentId = parent_id;
          await document.save({ transaction });
          console.log(`Updated document: ${JSON.stringify(document)}`);
        }
      }
    }

    await transaction.commit();
    console.log("Commit successful");
    res.json({ message: 'Items reordered successfully' });
  } catch (err) {
    await transaction.rollback();
    console.error(`Error occurred: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});


// Create Document
app.post('/api/documents', async (req, res) => {
  const data = req.body;
  const { name, parent_id, project_id, type: document_type, order = 0 } = data; // match the Flask variable names

  if (!name || !project_id || !document_type) {
    return res.status(400).json({ error: 'Name, project_id, and type are required' });
  }

  try {
    const project = await Project.findByPk(project_id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const folderPath = path.join(project.path, 'manuscript');
    const document_id = generateUniqueId();
    const fileName = `${document_id}.json`;
    const contentPath = path.join(folderPath, fileName);

    const initialContent = [];

    try {
      fs.writeFileSync(contentPath, JSON.stringify(initialContent));
    } catch (e) {
      return res.status(500).json({ error: `Failed to create document file: ${e.message}` });
    }

    const document = await Document.create({
      id: document_id,
      name,
      parentId: parent_id,
      projectId: project_id,
      type: document_type,
      order,
      contentPath,
      createdDate: new Date(),
      modifiedDate: new Date(),
      description: null,
    });

    res.status(201).json({ message: 'Document created', document: { id: document.id, name: document.name } });
  } catch (err) {
    console.error(`Failed to create document: ${err.message}`);
    res.status(500).json({ error: `Failed to create document: ${err.message}` });
  }
});

// Fetch All Documents
app.get('/api/documents', async (req, res) => {
  const project_id = req.query.project_id; // match the Flask variable name

  if (!project_id) {
    return res.status(400).json({ error: 'project_id is required' });
  }

  try {
    const documents = await Document.findAll({
      where: { projectId: project_id },
      order: [['order', 'ASC']],
    });

    const documentsList = documents.map(d => ({
      id: d.id,
      name: d.name,
      parent_id: d.parentId, // match the Flask variable name
      order: d.order,
      type: d.type,
      description: d.description,
    }));

    res.json(documentsList);
  } catch (err) {
    console.error(`Failed to fetch documents: ${err.message}`);
    res.status(500).json({ error: `Failed to fetch documents: ${err.message}` });
  }
});


// Fetch Beats and Description
app.get('/api/documents/:id/beats-and-description', async (req, res) => {
  const documentId = req.params.id;

  try {
    const document = await Document.findByPk(documentId);

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

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

  try {
    const document = await Document.findByPk(documentId);

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    document.beats = beats;
    await document.save();

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

  try {
    const document = await Document.findByPk(documentId);

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    document.description = description;
    await document.save();

    res.json(document);
  } catch (err) {
    console.error(`Failed to update description: ${err.message}`);
    res.status(500).json({ error: `Failed to update description: ${err.message}` });
  }
});



// Delete Document
app.delete('/api/documents/:document_id', async (req, res) => {
  const document_id = req.params.document_id; 
  try {
    console.log(`Fetching document with id: ${document_id}`);
    const document = await Document.findByPk(document_id);
    if (!document) {
      console.error(`Document not found: ${document_id}`);
      return res.status(404).json({ error: 'Document not found' });
    }

    const parent_id = document.parentId;
    const order = document.order;
    const content_path = document.contentPath;

    console.log(`Deleting document with id: ${document_id}`);
    await document.destroy();

    console.log(`Fetching remaining documents and folders with parent_id: ${parent_id} and order > ${order}`);
    const remainingDocuments = await Document.findAll({
      where: {
        parentId: parent_id,
        order: { [Op.gt]: order },
      },
    });

    const remainingFolders = await Folder.findAll({
      where: {
        parentId: parent_id,
        order: { [Op.gt]: order },
      },
    });

    for (const sibling of [...remainingFolders, ...remainingDocuments]) {
      console.log(`Updating order for ${sibling.constructor.name} with id: ${sibling.id}`);
      sibling.order -= 1;
      await sibling.save();
    }

    if (fs.existsSync(content_path)) {
      console.log(`Deleting file at path: ${content_path}`);
      fs.unlinkSync(content_path);
    }

    console.log(`Document with id: ${document_id} deleted successfully`);
    res.json({ message: 'Document deleted' });
  } catch (err) {
    console.error(`Failed to delete document: ${err.message}`);
    res.status(500).json({ error: `Failed to delete document: ${err.message}` });
  }
});


// Rename Document
app.put('/api/documents/:document_id/rename', async (req, res) => {
  const document_id = req.params.document_id; 
  const { name: new_name } = req.body;

  if (!new_name) {
    return res.status(400).json({ error: 'New name is required' });
  }

  try {
    const document = await Document.findByPk(document_id);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    document.name = new_name;
    await document.save();

    res.json({ message: 'Document renamed successfully' });
  } catch (err) {
    console.error(`Failed to rename document: ${err.message}`);
    res.status(500).json({ error: `Failed to rename document: ${err.message}` });
  }
});

// Fetch Document Content
app.post('/api/get_content', async (req, res) => {
  const { documentId } = req.body;

  if (!documentId) {
    return res.status(400).json({ error: 'Document ID is required' });
  }

  try {
    const document = await Document.findByPk(documentId);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const contentPath = document.contentPath;

    let content;
    try {
      content = fs.readFileSync(contentPath, 'utf8');
    } catch (err) {
      return res.status(500).json({ error: `Failed to read document file: ${err.message}` });
    }

    const document_data = {
      name: document.name,
    };

    return res.status(200).json({ content, document_data });
  } catch (err) {
    return res.status(500).json({ error: `Error fetching document content: ${err.message}` });
  }
});


// Save Document Content
app.post('/api/save_content', async (req, res) => {
  const { documentId, content } = req.body;

  if (!documentId || content === undefined) {
    return res.status(400).json({ error: 'Document ID and content are required' });
  }

  try {
    const document = await Document.findByPk(documentId);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const contentPath = document.contentPath;

    try {
      fs.writeFileSync(contentPath, JSON.stringify(content));
    } catch (err) {
      console.error(`Failed to write to document file: ${err.message}`);
      return res.status(500).json({ error: `Failed to write to document file: ${err.message}` });
    }

    return res.status(200).json({ message: 'Content saved successfully' });
  } catch (err) {
    return res.status(500).json({ error: `Error saving document content: ${err.message}` });
  }
});

// Upload Song
app.post('/api/upload_song', (req, res) => {
  const projectId = req.body.project_id;
  const file = req.files ? req.files.file : null;

  if (!projectId || !file) {
      return res.status(400).json({ success: 0, error: 'Missing project_id or file' });
  }

  const projectFolder = path.join('projects', projectId, 'songs');
  fs.mkdirSync(projectFolder, { recursive: true });

  const filePath = path.join(projectFolder, file.name);

  file.mv(filePath, (err) => {
      if (err) {
          console.error(`Error uploading song: ${err}`);
          return res.status(500).json({ success: 0, error: err.message });
      }

      return res.json({ filename: file.name });
  });
});

// Serve Song
app.get('/api/:project_id/songs/:filename', (req, res) => {
  const { project_id, filename } = req.params;
  const baseDir = path.resolve(__dirname, '..'); // Assuming your projects folder is in the parent directory of src
  const songPath = path.join(baseDir, 'projects', project_id, 'songs', filename); // Ensure absolute path

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

  if (!fs.existsSync(songsFolder)) {
    return res.json([]);
  }

  const songs = fs.readdirSync(songsFolder).filter(file => fs.lstatSync(path.join(songsFolder, file)).isFile());
  return res.json(songs);
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
      fs.mkdirSync(projectFolder, { recursive: true });
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

  if (!fs.existsSync(imagesFolder)) {
    return res.json([]);
  }

  const images = fs.readdirSync(imagesFolder).filter(file => fs.lstatSync(path.join(imagesFolder, file)).isFile());
  return res.json(images);
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

app.get('/api/versions', async (req, res) => {
  const { documentId, projectId } = req.query;

  if (!documentId || !projectId) {
    console.error('Validation failed: documentId and projectId are required');
    return res.status(400).json({ error: 'documentId and projectId are required' });
  }

  try {
    console.log(`Fetching versions for documentId: ${documentId} and projectId: ${projectId}`);
    const versions = await Version.findAll({
      where: { documentId, projectId },
      order: [['timestamp', 'DESC']],
    });

    if (versions.length === 0) {
      console.log(`No versions found for documentId: ${documentId} and projectId: ${projectId}`);
      return res.status(200).json({ message: 'No versions found' });
    }

    console.log(`Found ${versions.length} versions for documentId: ${documentId} and projectId: ${projectId}`);

    const versionsList = versions.map(v => ({
      id: v.id,
      documentId: v.documentId,
      projectId: v.projectId,
      timestamp: v.timestamp,
      contentPath: v.contentPath,
      description: v.description,
      color: v.color,
    }));

    console.log('Returning versions list:', JSON.stringify(versionsList));
    res.json(versionsList);
  } catch (err) {
    console.error(`Failed to fetch versions: ${err.message}`);
    res.status(500).json({ error: `Failed to fetch versions: ${err.message}` });
  }
});


//Create version

app.post('/api/versions', async (req, res) => {
  console.log('Received request to create version:', req.body);
  const { documentId, projectId } = req.body;

  if (!documentId || !projectId) {
    console.error('Validation failed: documentId and projectId are required');
    return res.status(400).json({ error: 'documentId and projectId are required' });
  }

  try {
    console.log(`Finding document with ID ${documentId} and project ID ${projectId}`);
    const document = await Document.findOne({ where: { id: documentId, projectId } });
    if (!document) {
      console.error('Document not found');
      return res.status(404).json({ error: 'Document not found' });
    }
    console.log('Document found:', document);

    console.log(`Finding project with ID ${projectId}`);
    const project = await Project.findByPk(projectId);
    if (!project) {
      console.error('Project not found');
      return res.status(404).json({ error: 'Project not found' });
    }
    console.log('Project found:', project);

    const versionsFolderPath = path.join(project.path, 'versions');
    if (!fs.existsSync(versionsFolderPath)) {
      console.log(`Creating versions folder at path ${versionsFolderPath}`);
      fs.mkdirSync(versionsFolderPath);
    }

    const timestamp = new Date().toISOString().replace(/[:.-]/g, '');
    const versionFileName = `${documentId}-${timestamp}.json`;
    const versionFilePath = path.join(versionsFolderPath, versionFileName);

    try {
      console.log(`Reading document content from ${document.contentPath}`);
      const documentContent = fs.readFileSync(document.contentPath, 'utf8');
      console.log(`Writing document content to ${versionFilePath}`);
      fs.writeFileSync(versionFilePath, documentContent);
    } catch (e) {
      console.error(`Failed to create version file: ${e.message}`);
      return res.status(500).json({ error: `Failed to create version file: ${e.message}` });
    }

    console.log('Creating version entry in the database');
    const version = await Version.create({
      id: uuidv4(), // Ensure the version ID is unique
      documentId,
      projectId,
      timestamp: new Date(),
      contentPath: versionFilePath,
      description: document.description,
      color: document.color,
    });

    console.log('Version created successfully:', version);
    res.status(201).json({ message: 'Version created', version });
  } catch (err) {
    console.error(`Failed to create version: ${err.message}`);
    res.status(500).json({ error: `Failed to create version: ${err.message}` });
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
