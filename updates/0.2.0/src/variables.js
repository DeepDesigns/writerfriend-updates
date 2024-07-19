const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const homeDirectory = os.homedir();
const projectsFolder = path.join(homeDirectory, 'WriterFriend');

module.exports = {
    projectsFolder
    };
  