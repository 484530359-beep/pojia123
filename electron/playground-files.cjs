"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Return every regular file below root while preserving the path relative to root.
 * statSync deliberately follows symlinked files/directories; realpath tracking
 * prevents a symlink cycle from making the scan recurse forever.
 */
function filesUnder(root) {
  const files = [];
  const visitedDirectories = new Set();

  const walk = (directory) => {
    let realDirectory;
    let entries;
    try {
      realDirectory = fs.realpathSync(directory);
      if (visitedDirectories.has(realDirectory)) return;
      visitedDirectories.add(realDirectory);
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) walk(fullPath);
      else if (stat.isFile()) files.push(fullPath);
    }
  };

  walk(root);
  return files;
}

module.exports = { filesUnder };
