const fs = require("fs");
const path = require("path");

const projectPublicDir = path.join(__dirname, "..", "public");
const projectUploadsDir = path.join(projectPublicDir, "uploads");
const UPLOAD_SEGMENTS = {
  profile: "profile",
  post: "post",
  video: "video"
};
const DEFAULT_PROFILE_FILENAME = "default-avatar.svg";
const DEFAULT_PROFILE_RELATIVE_PATH = path.join(
  UPLOAD_SEGMENTS.profile,
  DEFAULT_PROFILE_FILENAME
).replace(/\\/g, "/");
const DEFAULT_PROFILE_PIC = `/uploads/${DEFAULT_PROFILE_RELATIVE_PATH}`;
const preferredUploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : projectUploadsDir;
const defaultAvatarSource = path.join(projectUploadsDir, DEFAULT_PROFILE_RELATIVE_PATH);
let activeUploadsDir = null;

function ensureUploadSegments(rootDir) {
  if (!fs.existsSync(rootDir)) {
    fs.mkdirSync(rootDir, { recursive: true });
  }

  Object.values(UPLOAD_SEGMENTS).forEach((segment) => {
    const segmentDir = path.join(rootDir, segment);
    if (!fs.existsSync(segmentDir)) {
      fs.mkdirSync(segmentDir, { recursive: true });
    }
  });
}

function ensureUploadsDir() {
  if (activeUploadsDir) {
    return activeUploadsDir;
  }

  const candidates = preferredUploadsDir === projectUploadsDir
    ? [projectUploadsDir]
    : [preferredUploadsDir, projectUploadsDir];

  for (const uploadsDir of candidates) {
    try {
      ensureUploadSegments(uploadsDir);

      const defaultAvatarTarget = path.join(uploadsDir, DEFAULT_PROFILE_RELATIVE_PATH);

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

function getUploadsDir(segment = "") {
  const uploadsDir = ensureUploadsDir();
  return segment ? path.join(uploadsDir, segment) : uploadsDir;
}

module.exports = {
  DEFAULT_PROFILE_PIC,
  UPLOAD_SEGMENTS,
  ensureUploadsDir,
  getUploadsDir
};
