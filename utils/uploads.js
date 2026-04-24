const fs = require("fs");
const path = require("path");

const projectPublicDir = path.join(__dirname, "..", "public");
const projectUploadsDir = path.join(projectPublicDir, "uploads");
const preferredUploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : projectUploadsDir;
const defaultAvatarSource = path.join(projectUploadsDir, "default.png");
let activeUploadsDir = null;

function ensureUploadsDir() {
  if (activeUploadsDir) {
    return activeUploadsDir;
  }

  const candidates = preferredUploadsDir === projectUploadsDir
    ? [projectUploadsDir]
    : [preferredUploadsDir, projectUploadsDir];

  for (const uploadsDir of candidates) {
    try {
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const defaultAvatarTarget = path.join(uploadsDir, "default.png");

      if (
        uploadsDir !== projectUploadsDir &&
        fs.existsSync(defaultAvatarSource) &&
        !fs.existsSync(defaultAvatarTarget)
      ) {
        fs.copyFileSync(defaultAvatarSource, defaultAvatarTarget);
      }

      activeUploadsDir = uploadsDir;
      return activeUploadsDir;
    } catch (error) {
      if (uploadsDir === projectUploadsDir) {
        throw error;
      }

      console.warn(`Falling back to local uploads directory after failing to use ${uploadsDir}: ${error.message}`);
    }
  }

  return projectUploadsDir;
}

function getUploadsDir() {
  return ensureUploadsDir();
}

module.exports = {
  ensureUploadsDir,
  getUploadsDir
};
