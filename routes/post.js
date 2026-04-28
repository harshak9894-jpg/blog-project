const express = require("express");
const Post = require("../models/Post");
const User = require("../models/User");
const Report = require("../models/Report");
const multer = require("multer");
const asyncHandler = require("../utils/asyncHandler");
const { storeUploadedFile } = require("../utils/mediaStorage");
const { requireLogin, requireLoginJson } = require("../middleware/auth");

const router = express.Router();
const REPORT_ADMIN_EMAIL = process.env.ADMIN_EMAIL?.trim().toLowerCase() || "";

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/jpg",
    "video/mp4"
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only JPG, PNG, MP4 allowed"), false);
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter
});

function parseTags(rawTags) {
  return Array.from(new Set(String(rawTags || "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8)));
}

function pickAllowedValue(value, allowedValues, fallbackValue) {
  return allowedValues.includes(value) ? value : fallbackValue;
}

function escapeRegex(string) {
  return String(string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTab(value, isLoggedIn) {
  const allowedTabs = isLoggedIn
    ? ["latest", "popular", "following", "old"]
    : ["latest", "popular", "old"];

  return allowedTabs.includes(value) ? value : "latest";
}

function normalizeCategory(value, isLoggedIn) {
  if (!value) {
    return isLoggedIn ? "all" : "general";
  }

  const allowedCategories = isLoggedIn
    ? ["all", "general", "photo", "video", "discussion", "posts", "videos"]
    : ["general", "videos", "posts"];

  return allowedCategories.includes(value) ? value : (isLoggedIn ? "all" : "general");
}

function buildCategoryCondition(category) {
  switch (category) {
    case "photo":
      return {
        $or: [
          { category: "photo" },
          { mediaType: "image" }
        ]
      };
    case "video":
    case "videos":
      return {
        $or: [
          { category: "video" },
          { mediaType: "video" }
        ]
      };
    case "discussion":
      return { category: "discussion" };
    case "posts":
      return { mediaType: { $ne: "video" } };
    case "general":
    case "all":
    default:
      return null;
  }
}

function getGuestTabLabel(tab) {
  return {
    latest: "Latest",
    old: "Old",
    popular: "Popular"
  }[tab] || "Latest";
}

function getGuestCategoryLabel(category) {
  return {
    general: "General",
    videos: "Videos",
    posts: "Posts"
  }[category] || "General";
}

function getReportReason(value) {
  return String(value || "")
    .trim()
    .slice(0, 500) || "Reported from public feed";
}

function formatRelativeTime(value) {
  const createdAt = new Date(value);
  const diffMs = Date.now() - createdAt.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < hour) {
    return `${Math.max(1, Math.floor(diffMs / minute))}m ago`;
  }

  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)}h ago`;
  }

  if (diffMs < 7 * day) {
    return `${Math.floor(diffMs / day)}d ago`;
  }

  return createdAt.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short"
  });
}

const requireReportAdmin = asyncHandler(async (req, res, next) => {
  if (!req.session.userId) {
    req.flash("error", "Please login first");
    return res.redirect("/login");
  }

  if (!REPORT_ADMIN_EMAIL) {
    return res.status(403).render("error", {
      message: "Admin reports access is not configured yet.",
      statusCode: 403
    });
  }

  const currentUser = await User.findById(req.session.userId).select("email username displayName");

  if (!currentUser || String(currentUser.email || "").toLowerCase() !== REPORT_ADMIN_EMAIL) {
    return res.status(403).render("error", {
      message: "You are not allowed to access reports.",
      statusCode: 403
    });
  }

  req.reportAdminUser = currentUser;
  next();
});

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

router.get("/", asyncHandler(async (req, res) => {
  const rawSearch = req.query.search;
  const search = (typeof rawSearch === "string" ? rawSearch : Array.isArray(rawSearch) ? rawSearch[0] : "")
    ?.trim() || "";
  const currentUserId = req.session.userId;
  const currentUser = req.session.userId
    ? await User.findById(req.session.userId).select("following savedPosts")
    : null;
  const isLoggedIn = Boolean(currentUserId);
  const tab = normalizeTab(req.query.tab?.trim(), isLoggedIn);
  const category = normalizeCategory(req.query.category?.trim(), isLoggedIn);

  const query = {};
  const andConditions = [];

  if (search) {
    const safePattern = escapeRegex(search);
    andConditions.push({
      $or: [
        { title: { $regex: safePattern, $options: "i" } },
        { content: { $regex: safePattern, $options: "i" } },
        { tags: { $regex: safePattern, $options: "i" } }
      ]
    });
  }

  const categoryCondition = buildCategoryCondition(category);

  if (categoryCondition) {
    andConditions.push(categoryCondition);
  }

  if (tab === "following") {
    const followingIds = currentUser && currentUser.following ? currentUser.following : [];
    if (!currentUser || followingIds.length === 0) {
      andConditions.push({ author: null });
    } else {
      andConditions.push({ author: { $in: followingIds } });
    }
  }

  if (!currentUser) {
    andConditions.push({ visibility: "public" });
  } else {
    const followingIds = currentUser.following || [];
    andConditions.push({
      $or: [
        { visibility: "public" },
        {
          visibility: "followers",
          author: { $in: [...followingIds, currentUser._id] }
        }
      ]
    });
  }

  if (andConditions.length > 0) {
    query.$and = andConditions;
  }

  let posts = await Post.find(query)
    .populate("author")
    .populate("comments.user")
    .sort(tab === "old" ? { createdAt: 1 } : { createdAt: -1 });

  if (tab === "popular") {
    posts = posts.sort((a, b) => {
      const scoreA = a.likes.length + a.comments.length;
      const scoreB = b.likes.length + b.comments.length;
      return scoreB - scoreA;
    });
  }

  const visiblePosts = posts
    .filter((post) => post.author)
    .map((post) => {
      post.comments = post.comments.filter((comment) => comment.user);
      post.relativeTime = formatRelativeTime(post.createdAt);
      return post;
    });

  const homeView = currentUser ? "home" : "guestHome";

  res.render(homeView, {
    posts: visiblePosts,
    activeCategory: category,
    activeTab: tab,
    guestTabLabel: getGuestTabLabel(tab),
    guestCategoryLabel: getGuestCategoryLabel(category)
  });
}));

router.get("/create", requireLogin, (req, res) => {
  const requestedType = pickAllowedValue(req.query.type?.trim(), ["general", "video", "discussion"], "general");
  res.render("createPost", {
    initialType: requestedType
  });
});

router.post("/create", requireLogin, upload.single("media"), asyncHandler(async (req, res) => {
  const title = req.body.title?.trim();
  const content = req.body.content?.trim();
  const category = pickAllowedValue(req.body.category?.trim(), ["general", "photo", "video", "discussion"], "general");
  const visibility = pickAllowedValue(req.body.visibility?.trim(), ["public", "followers"], "public");
  const tags = parseTags(req.body.tags);

  if (!title || !content) {
    req.flash("error", "Title and content are required");
    return res.redirect("/create");
  }

  let mediaPath = null;
  let mediaType = null;

  if (req.file) {
    const segment = req.file.mimetype.startsWith("video") ? "video" : "post";
    const uploadedMedia = await storeUploadedFile({
      file: req.file,
      cloudFolder: `blog-project/${segment}`,
      segment,
      prefix: segment,
      resourceType: "auto"
    });

    mediaPath = uploadedMedia.url;
    mediaType = uploadedMedia.resourceType === "video" ? "video" : "image";
  }

  await Post.create({
    title,
    content,
    media: mediaPath,
    mediaType,
    category,
    tags,
    visibility,
    author: req.session.userId
  });

  req.flash("success", "Post created");
  res.redirect(`/profile/${req.session.userId}`);
}));

router.get("/saved", requireLogin, asyncHandler(async (req, res) => {
  const currentUser = await User.findById(req.session.userId)
    .populate({
      path: "savedPosts",
      populate: [{ path: "author" }]
    });

  if (!currentUser) {
    req.flash("error", "User not found");
    return res.redirect("/login");
  }

  const savedPosts = (currentUser.savedPosts || []).filter((post) => post && post.author);

  res.render("savedPosts", { savedPosts });
}));

router.post("/save/:id", requireLoginJson, asyncHandler(async (req, res) => {
  const [currentUser, post] = await Promise.all([
    User.findById(req.session.userId),
    Post.findById(req.params.id).populate("author")
  ]);

  if (!currentUser) {
    return res.status(404).json({ error: "User not found" });
  }

  if (!post) {
    return res.status(404).json({ error: "Post not found" });
  }

  const alreadySaved = currentUser.savedPosts.includes(post._id);

  if (alreadySaved) {
    currentUser.savedPosts.pull(post._id);
  } else {
    currentUser.savedPosts.push(post._id);
  }

  await currentUser.save();

  if (!alreadySaved && post.author) {
    await createNotification({
      recipientId: post.author._id,
      actorId: currentUser._id,
      type: "save",
      message: `${currentUser.displayName || currentUser.username} saved your post`,
      postId: post._id
    });
  }

  res.json({
    saved: !alreadySaved,
    savedCount: currentUser.savedPosts.length
  });
}));

router.post("/like/:id", requireLoginJson, asyncHandler(async (req, res) => {
  const [post, currentUser] = await Promise.all([
    Post.findById(req.params.id),
    User.findById(req.session.userId)
  ]);

  if (!post) {
    return res.status(404).json({ error: "Post not found" });
  }

  if (!currentUser) {
    return res.status(404).json({ error: "User not found" });
  }

  const userId = req.session.userId;
  const alreadyLiked = post.likes.includes(userId);

  if (alreadyLiked) {
    post.likes.pull(userId);
  } else {
    post.likes.push(userId);
  }

  await post.save();

  if (!alreadyLiked) {
    await createNotification({
      recipientId: post.author,
      actorId: currentUser._id,
      type: "post_like",
      message: `${currentUser.displayName || currentUser.username} liked your post`,
      postId: post._id
    });
  }

  res.json({
    likesCount: post.likes.length,
    liked: !alreadyLiked
  });
}));

router.post("/comment/:id", requireLoginJson, asyncHandler(async (req, res) => {
  const text = req.body.text?.trim();
  if (!text) {
    return res.status(400).json({ error: "Comment text is required" });
  }

  const [post, currentUser] = await Promise.all([
    Post.findById(req.params.id),
    User.findById(req.session.userId)
  ]);

  if (!post) {
    return res.status(404).json({ error: "Post not found" });
  }

  if (!currentUser) {
    return res.status(404).json({ error: "User not found" });
  }

  post.comments.push({
    text,
    user: req.session.userId
  });
  await post.save();
  await post.populate("comments.user");

  const savedComment = post.comments[post.comments.length - 1];

  await createNotification({
    recipientId: post.author,
    actorId: currentUser._id,
    type: "comment",
    message: `${currentUser.displayName || currentUser.username} commented on your post`,
    postId: post._id
  });

  res.json({
    commentId: savedComment._id,
    text: savedComment.text,
    username: savedComment.user.displayName || savedComment.user.username,
    profilePic: savedComment.user.profilePic,
    userId: savedComment.user._id,
    likesCount: savedComment.likes.length,
    liked: false
  });
}));

router.post("/report/:id", asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.id)
    .populate("author", "username displayName handle");

  if (!post) {
    return res.status(404).json({ error: "Post not found" });
  }

  let reporterName = "Guest";
  let reporterEmail = "";
  let reporterUser = null;

  if (req.session.userId) {
    const currentUser = await User.findById(req.session.userId)
      .select("username displayName email");

    if (currentUser) {
      reporterUser = currentUser._id;
      reporterName = currentUser.displayName || currentUser.username;
      reporterEmail = currentUser.email || "";
    }
  }

  await Report.create({
    post: post._id,
    postTitle: post.title,
    postAuthorName: post.author
      ? (post.author.displayName || post.author.username || "Unknown")
      : "Unknown",
    postAuthorHandle: post.author
      ? (post.author.handle || post.author.username || "")
      : "",
    postUrl: `/post/${post._id}`,
    reporterUser,
    reporterName,
    reporterEmail,
    reason: getReportReason(req.body.reason)
  });

  if (req.accepts("json")) {
    return res.json({ success: true });
  }

  req.flash("success", "Report submitted");
  res.redirect("/");
}));

router.post("/comment-like/:postId/:commentId", requireLoginJson, asyncHandler(async (req, res) => {
  const [post, currentUser] = await Promise.all([
    Post.findById(req.params.postId),
    User.findById(req.session.userId)
  ]);

  if (!post) {
    return res.status(404).json({ error: "Post not found" });
  }

  if (!currentUser) {
    return res.status(404).json({ error: "User not found" });
  }

  const comment = post.comments.id(req.params.commentId);

  if (!comment) {
    return res.status(404).json({ error: "Comment not found" });
  }

  const userId = req.session.userId;
  const alreadyLiked = comment.likes.includes(userId);

  if (alreadyLiked) {
    comment.likes.pull(userId);
  } else {
    comment.likes.push(userId);
  }

  await post.save();

  if (!alreadyLiked) {
    await createNotification({
      recipientId: comment.user,
      actorId: currentUser._id,
      type: "comment_like",
      message: `${currentUser.displayName || currentUser.username} liked your comment`,
      postId: post._id
    });
  }

  res.json({
    likesCount: comment.likes.length,
    liked: !alreadyLiked
  });
}));

router.delete("/comment/:postId/:commentId", requireLoginJson, asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.postId)
    .populate("comments.user");

  if (!post) {
    return res.status(404).json({ error: "Post not found" });
  }

  const comment = post.comments.id(req.params.commentId);

  if (!comment) {
    return res.status(404).json({ error: "Comment not found" });
  }

  if (comment.user._id.toString() !== req.session.userId.toString()) {
    return res.status(403).json({ error: "Not allowed" });
  }

  comment.deleteOne();
  await post.save();

  res.json({ success: true });
}));

router.get("/edit/:id", requireLogin, asyncHandler(async (req, res) => {
  const post = await Post.findOne({
    _id: req.params.id,
    author: req.session.userId
  });

  if (!post) {
    req.flash("error", "Unauthorized");
    return res.redirect(`/profile/${req.session.userId}`);
  }

  res.render("editPost", { post });
}));

router.put("/edit/:id", requireLogin, asyncHandler(async (req, res) => {
  const title = req.body.title?.trim();
  const content = req.body.content?.trim();
  const category = pickAllowedValue(req.body.category?.trim(), ["general", "photo", "video", "discussion"], "general");
  const visibility = pickAllowedValue(req.body.visibility?.trim(), ["public", "followers"], "public");
  const tags = parseTags(req.body.tags);

  if (!title || !content) {
    req.flash("error", "Title and content are required");
    return res.redirect(`/edit/${req.params.id}`);
  }

  const updatedPost = await Post.findOneAndUpdate(
    { _id: req.params.id, author: req.session.userId },
    {
      title,
      content,
      category,
      visibility,
      tags,
      editedAt: new Date()
    }
  );

  if (!updatedPost) {
    req.flash("error", "Post not found");
    return res.redirect(`/profile/${req.session.userId}`);
  }

  req.flash("success", "Post updated");
  res.redirect(`/profile/${req.session.userId}`);
}));

router.delete("/delete/:id", requireLogin, asyncHandler(async (req, res) => {
  const deletedPost = await Post.findOneAndDelete({
    _id: req.params.id,
    author: req.session.userId
  });

  if (!deletedPost) {
    req.flash("error", "Post not found");
    return res.redirect(`/profile/${req.session.userId}`);
  }

  req.flash("success", "Post deleted");
  res.redirect(`/profile/${req.session.userId}`);
}));

router.get("/post/:id", asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.id)
    .populate("author")
    .populate("comments.user");

  if (!post) {
    req.flash("error", "Post not found");
    return res.redirect("/");
  }

  res.render("singlePost", { post });
}));

router.get("/admin/reports", requireReportAdmin, asyncHandler(async (req, res) => {
  const reports = await Report.find()
    .sort({ createdAt: -1 })
    .lean();

  res.render("adminReports", {
    reports,
    adminEmail: REPORT_ADMIN_EMAIL
  });
}));

router.post("/admin/reports/:id/resolve", requireReportAdmin, asyncHandler(async (req, res) => {
  const report = await Report.findById(req.params.id);

  if (!report) {
    req.flash("error", "Report not found");
    return res.redirect("/admin/reports");
  }

  report.status = "resolved";
  await report.save();

  req.flash("success", "Report marked as resolved");
  res.redirect("/admin/reports");
}));

router.get("/download-post/:id", asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.id);
  if (!post) {
    req.flash("error", "Post not found");
    return res.redirect("/");
  }

  const escapeHtml = (value) => String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  const htmlContent = `
    <html>
      <head>
        <title>${escapeHtml(post.title)}</title>
      </head>
      <body>
        <h2>${escapeHtml(post.title)}</h2>
        <p>${escapeHtml(post.content)}</p>
      </body>
    </html>
  `;

  res.setHeader("Content-Disposition", "attachment; filename=post.html");
  res.setHeader("Content-Type", "text/html");
  res.send(htmlContent);
}));

module.exports = router;
