'use strict';

const path = require('path');
const { uriToPath } = require('./dialect');

function priorityKeysForUri(uri, keyPriority) {
  if (!uri || !keyPriority) return null;
  const filename = path.basename(uriToPath(uri));
  if (keyPriority[filename]) return keyPriority[filename];

  // Match prefix conventions (e.g. tsconfig.build.json -> tsconfig.json).
  if (filename.startsWith('tsconfig.') && keyPriority['tsconfig.json']) {
    return keyPriority['tsconfig.json'];
  }
  if (filename.startsWith('jsconfig.') && keyPriority['jsconfig.json']) {
    return keyPriority['jsconfig.json'];
  }
  return null;
}

module.exports = { priorityKeysForUri: priorityKeysForUri };
