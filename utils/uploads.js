const fs = require("fs");
const path = require("path");

const projectPublicDir = path.join(__dirname, "..", "public");
const projectUploadsDir = path.join(projectPublicDir, "uploads");
const configuredUploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : projectUploadsDir;
const defaultAvatarSource = path.join(projectUploadsDir, "default.png");
const defaultAvatarTarget = path.join(configuredUploadsDir, "default.png");

function ensureUploadsDir() {
  if (!fs.existsSync(configuredUploadsDir)) {
    fs.mkdirSync(configuredUploadsDir, { recursive: true });
  }

  if (
    configuredUploadsDir !== projectUploadsDir &&
    fs.existsSync(defaultAvatarSource) &&
    !fs.existsSync(defaultAvatarTarget)
  ) {
    fs.copyFileSync(defaultAvatarSource, defaultAvatarTarget);
  }

  return configuredUploadsDir;
}

function getUploadsDir() {
  return ensureUploadsDir();
}

module.exports = {
  ensureUploadsDir,
  getUploadsDir
};
