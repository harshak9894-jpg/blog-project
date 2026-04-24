const express = require("express");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const User = require("../models/User");
const Post = require("../models/Post");
const asyncHandler = require("../utils/asyncHandler");
const { storeUploadedFile } = require("../utils/mediaStorage");
const { requireLogin, requireLoginJson } = require("../middleware/auth");

const router = express.Router();

/* ======================
   MULTER CONFIG (DP)
====================== */

const fileFilter = (req, file, cb) => {
  const allowedTypes = ["image/jpeg", "image/png", "image/jpg"];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only JPG and PNG allowed"));
  }
};

const uploadDP = multer({
  storage: multer.memoryStorage(),
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

function normalizeHandle(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 30);
}

async function createNotification({ recipientId, actorId, type, message, postId = null }) {
  if (!recipientId || !actorId || recipientId.toString() === actorId.toString()) {
    return;
  }

  await User.findByIdAndUpdate(recipientId, {
    $push: {
      notifications: {
        type,
        message,
        actor: actorId,
        post: postId,
        read: false
      }
    }
  });
}

/* ======================
   REGISTER
====================== */

router.get("/register", (req, res) => {
  res.render("register");
});

router.post("/register", asyncHandler(async (req, res) => {

  const username = req.body.username?.trim();
  const email = req.body.email?.trim().toLowerCase();
  const password = req.body.password?.trim();
  const handle = normalizeHandle(req.body.handle || username);

  if (!username || !email || !password || !handle) {
    req.flash("error", "All fields are required");
    return res.redirect("/register");
  }

  if (password.length < 6) {
    req.flash("error", "Password must be at least 6 characters");
    return res.redirect("/register");
  }

  const exists = await User.findOne({ email });
  if (exists) {
    req.flash("error", "Email is already registered");
    return res.redirect("/register");
  }

  const usernameTaken = await User.findOne({ username });
  if (usernameTaken) {
    req.flash("error", "That username is already taken");
    return res.redirect("/register");
  }

  const handleExists = await User.findOne({ handle });
  if (handleExists) {
    req.flash("error", "That handle is already taken");
    return res.redirect("/register");
  }

  const hashed = await bcrypt.hash(password, 10);

  await User.create({
    username,
    email,
    password: hashed,
    displayName: username,
    handle
  });

  req.flash("success", "Account created. Please login.");
  res.redirect("/login");
}));

/* ======================
   LOGIN
====================== */

router.get("/login", (req, res) => {
  res.render("login");
});

router.post("/login", asyncHandler(async (req, res) => {

  const email = req.body.email?.trim().toLowerCase();
  const password = req.body.password?.trim();

  if (!email || !password) {
    req.flash("error", "Email and password are required");
    return res.redirect("/login");
  }

  const user = await User.findOne({ email });
  if (!user) {
    req.flash("error", "Invalid email or password");
    return res.redirect("/login");
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    req.flash("error", "Invalid email or password");
    return res.redirect("/login");
  }

  req.session.userId = user._id;
  req.flash("success", "Welcome back");
  res.redirect("/");
}));

/* ======================
   LOGOUT
====================== */

router.get("/logout", requireLogin, (req, res) => {
  req.session.destroy();
  res.redirect("/");
});

/* ======================
   PROFILE PAGE
====================== */

router.get("/profile/:id", asyncHandler(async (req, res) => {

  const profileUser = await User.findById(req.params.id)
    .populate("followers")
    .populate("following");

  if (!profileUser) {
    req.flash("error", "User not found");
    return res.redirect("/");
  }

  const isFollowing = req.session.userId &&
    profileUser.followers.some(f =>
      f._id.toString() === req.session.userId?.toString()
    );

  const canMessage = Boolean(req.session.userId) && (
    profileUser.allowMessages === "everyone" ||
    (profileUser.allowMessages === "followers" && isFollowing)
  );

  const viewer = req.session.userId
    ? await User.findById(req.session.userId)
    : null;

  const canSeeFollowersOnlyPosts = viewer &&
    profileUser.followers.some(f => f._id.toString() === viewer._id.toString());

  const viewerId = req.session.userId ? String(req.session.userId) : "";
  const profileId = String(profileUser._id);
  const isOwnProfile = Boolean(viewerId && viewerId === profileId);

  let postQuery;
  if (isOwnProfile) {
    postQuery = { author: profileUser._id };
  } else if (canSeeFollowersOnlyPosts) {
    postQuery = {
      author: profileUser._id,
      $or: [{ visibility: "public" }, { visibility: "followers" }]
    };
  } else {
    postQuery = { author: profileUser._id, visibility: "public" };
  }

  const profilePosts = await Post.find(postQuery)
    .sort({ createdAt: -1 });

  res.render("profile", {
    profileUser,
    isFollowing,
    profilePosts,
    canMessage
  });
}));

router.get("/settings", requireLogin, (req, res) => {
  res.render("settings");
});

router.get("/edit-profile", requireLogin, asyncHandler(async (req, res) => {
  const currentUser = await User.findById(req.session.userId);

  if (!currentUser) {
    req.flash("error", "User not found");
    return res.redirect("/login");
  }

  res.render("editProfile", { currentUser });
}));

function pickAllowMessages(value) {
  if (value === "nobody") return "nobody";
  if (value === "followers") return "followers";
  return "everyone";
}

router.post("/edit-profile", requireLogin, asyncHandler(async (req, res) => {
  const currentUser = await User.findById(req.session.userId);

  if (!currentUser) {
    req.flash("error", "User not found");
    return res.redirect("/login");
  }

  const username = req.body.username?.trim();
  const displayName = req.body.displayName?.trim();
  const handle = normalizeHandle(req.body.handle);
  const bio = req.body.bio?.trim() || "";
  const allowMessages = pickAllowMessages(req.body.allowMessages);

  if (!username || !displayName || !handle) {
    req.flash("error", "Username, display name, and handle are required");
    return res.redirect("/edit-profile");
  }

  const existingUsername = await User.findOne({
    username,
    _id: { $ne: currentUser._id }
  });

  if (existingUsername) {
    req.flash("error", "That username is already taken");
    return res.redirect("/edit-profile");
  }

  const existingHandleUser = await User.findOne({
    handle,
    _id: { $ne: currentUser._id }
  });

  if (existingHandleUser) {
    req.flash("error", "That handle is already taken");
    return res.redirect("/edit-profile");
  }

  currentUser.username = username;
  currentUser.displayName = displayName;
  currentUser.handle = handle;
  currentUser.bio = bio;
  currentUser.allowMessages = allowMessages;

  await currentUser.save();

  req.flash("success", "Profile updated");
  res.redirect(`/profile/${currentUser._id}`);
}));

/* ======================
   UPLOAD / CHANGE DP
====================== */

router.post("/upload-dp", requireLogin, uploadDP.single("profilePic"), asyncHandler(async (req, res) => {

  if (!req.file) {
    req.flash("error", "Please choose an image");
    return res.redirect("/edit-profile");
  }

  const user = await User.findById(req.session.userId);

  if (!user) {
    req.flash("error", "User not found");
    return res.redirect("/login");
  }

  const uploadedProfilePic = await storeUploadedFile({
    file: req.file,
    folder: "blog-project/profile-pics",
    prefix: "dp",
    resourceType: "image"
  });

  user.profilePic = uploadedProfilePic.url;

  await user.save();

  req.flash("success", "Profile picture updated");
  res.redirect("/profile/" + user._id);
}));

/* ======================
   FOLLOW SYSTEM
====================== */

router.post("/follow/:id", requireLoginJson, asyncHandler(async (req, res) => {

  const currentUser = await User.findById(req.session.userId);
  const targetUser = await User.findById(req.params.id);

  if (!currentUser) {
    return res.status(404).json({ error: "Current user not found" });
  }

  if (!targetUser) {
    return res.status(404).json({ error: "User not found" });
  }

  if (currentUser._id.toString() === targetUser._id.toString()) {
    return res.status(400).json({ error: "Cannot follow yourself" });
  }

  const alreadyFollowing = currentUser.following.includes(targetUser._id);

  if (alreadyFollowing) {
    currentUser.following.pull(targetUser._id);
    targetUser.followers.pull(currentUser._id);
  } else {
    currentUser.following.push(targetUser._id);
    targetUser.followers.push(currentUser._id);
  }

  await currentUser.save();
  await targetUser.save();

  if (!alreadyFollowing) {
    await createNotification({
      recipientId: targetUser._id,
      actorId: currentUser._id,
      type: "follow",
      message: `${currentUser.displayName || currentUser.username} started following you`
    });
  }

  res.json({
    following: !alreadyFollowing,
    followersCount: targetUser.followers.length
  });
}));

router.get("/notifications", requireLogin, asyncHandler(async (req, res) => {
  const currentUser = await User.findById(req.session.userId)
    .populate("notifications.actor")
    .populate("notifications.post")
    .select("notifications");

  if (!currentUser) {
    req.flash("error", "User not found");
    return res.redirect("/login");
  }

  const notifications = [...currentUser.notifications].reverse();

  res.render("notifications", { notifications });
}));

router.post("/notifications/read-all", requireLogin, asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.session.userId, {
    $set: {
      "notifications.$[].read": true
    }
  });

  req.flash("success", "Notifications marked as read");
  res.redirect("/notifications");
}));

module.exports = router;
