/**
 * Destructive: removes all posts, users, chats, express sessions, and upload files
 * (except public/uploads/default.png). Run: node scripts/clear-all-data.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const fs = require("fs/promises");
const path = require("path");

const Post = require("../models/Post");
const User = require("../models/User");
const Conversation = require("../models/Conversation");

const uploadsDir = path.join(__dirname, "..", "public", "uploads");

async function clearUploadFiles() {
  let names;
  try {
    names = await fs.readdir(uploadsDir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name.toLowerCase() === "default.png") continue;
    const full = path.join(uploadsDir, name);
    const stat = await fs.stat(full).catch(() => null);
    if (stat && stat.isFile()) {
      await fs.unlink(full).catch(() => {});
    }
  }
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error("Missing MONGO_URI in .env");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  const [posts, convos, users, sessions] = await Promise.all([
    Post.deleteMany({}),
    Conversation.deleteMany({}),
    User.deleteMany({}),
    mongoose.connection.db.collection("sessions").deleteMany({}).catch(() => ({ deletedCount: 0 }))
  ]);

  console.log("Deleted posts:", posts.deletedCount);
  console.log("Deleted conversations:", convos.deletedCount);
  console.log("Deleted users:", users.deletedCount);
  console.log("Deleted sessions:", sessions.deletedCount ?? 0);

  await clearUploadFiles();
  console.log("Cleared files in public/uploads (kept default.png if present)");

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
