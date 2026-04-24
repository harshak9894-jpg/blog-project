const fs = require("fs/promises");
const path = require("path");
const { getUploadsDir } = require("./uploads");
const { isCloudinaryConfigured, uploadBufferToCloudinary } = require("./cloudinary");

function createUploadName(prefix, originalname = "", mimetype = "") {
  const baseName = String(originalname || "")
    .replace(path.extname(originalname || ""), "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "file";

  const extension = path.extname(originalname || "") || (
    mimetype === "image/jpeg" ? ".jpg" :
      mimetype === "image/png" ? ".png" :
        mimetype === "video/mp4" ? ".mp4" :
          ""
  );

  return `${prefix}-${Date.now()}-${baseName}${extension}`;
}

async function storeUploadedFile({ file, folder, prefix, resourceType = "auto" }) {
  if (!file) {
    return null;
  }

  const uploadName = createUploadName(prefix, file.originalname, file.mimetype);

  if (isCloudinaryConfigured) {
    const uploaded = await uploadBufferToCloudinary({
      buffer: file.buffer,
      folder,
      publicId: uploadName.replace(path.extname(uploadName), ""),
      resourceType
    });

    return {
      url: uploaded.secure_url,
      resourceType: uploaded.resource_type
    };
  }

  const uploadsDir = getUploadsDir();
  const localFilePath = path.join(uploadsDir, uploadName);
  await fs.writeFile(localFilePath, file.buffer);

  return {
    url: `/uploads/${uploadName}`,
    resourceType: resourceType === "auto"
      ? (file.mimetype.startsWith("video") ? "video" : "image")
      : resourceType
  };
}

module.exports = {
  isCloudinaryConfigured,
  storeUploadedFile
};
