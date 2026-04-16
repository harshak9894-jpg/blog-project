const express = require("express");
const Conversation = require("../models/Conversation");
const User = require("../models/User");
const asyncHandler = require("../utils/asyncHandler");
const { requireLogin } = require("../middleware/auth");

const router = express.Router();

function sortIds(ids) {
  return [...ids].map(String).sort();
}

function isParticipant(conversation, userId) {
  return conversation.participants.some((participant) => String(participant._id || participant) === String(userId));
}

function getOtherParticipant(conversation, userId) {
  return conversation.participants.find((participant) => String(participant._id) !== String(userId)) || null;
}

function viewerFollowsTarget(targetUser, viewerId) {
  if (!targetUser || !viewerId) return false;
  return (targetUser.followers || []).some((id) => String(id._id || id) === String(viewerId));
}

function canReceiveMessagesFrom(targetUser, viewerId) {
  if (!targetUser || !viewerId) return false;
  if (targetUser.allowMessages === "nobody") return false;
  if (targetUser.allowMessages === "everyone") return true;
  if (targetUser.allowMessages === "followers") {
    return viewerFollowsTarget(targetUser, viewerId);
  }
  return false;
}

function hasBlocked(currentUser, targetUserId) {
  return currentUser.blockedUsers.some((id) => String(id) === String(targetUserId));
}

function isBlockedBetween(currentUser, targetUser) {
  return hasBlocked(currentUser, targetUser._id) || targetUser.blockedUsers.some((id) => String(id) === String(currentUser._id));
}

function canSendMessage(conversation, userId, viewerUser = null) {
  if (conversation.status !== "active" && String(conversation.requestedBy) !== String(userId)) {
    return false;
  }

  if (!viewerUser || conversation.isGroup) {
    return true;
  }

  const otherParticipant = getOtherParticipant(conversation, userId);
  if (!otherParticipant) {
    return true;
  }

  return !isBlockedBetween(viewerUser, otherParticipant);
}

function getParticipantSetting(conversation, userId) {
  return conversation.participantSettings.find((setting) => String(setting.user) === String(userId))
    || conversation.participantSettings.find((setting) => String(setting.user?._id) === String(userId))
    || null;
}

function getVisibleMessages(conversation, userId) {
  const clearedAt = getParticipantSetting(conversation, userId)?.clearedAt;

  if (!clearedAt) {
    return conversation.messages;
  }

  return conversation.messages.filter((message) => new Date(message.createdAt) > new Date(clearedAt));
}

function markConversationRead(conversation, userId) {
  let participantSetting = conversation.participantSettings.find((setting) => String(setting.user) === String(userId));

  if (!participantSetting) {
    conversation.participantSettings.push({
      user: userId,
      unreadCount: 0,
      lastReadAt: new Date()
    });
    return;
  }

  participantSetting.unreadCount = 0;
  participantSetting.lastReadAt = new Date();
}

function buildConversationTitle(conversation, userId) {
  if (conversation.isGroup) {
    return conversation.title || "Group Chat";
  }

  const otherParticipant = getOtherParticipant(conversation, userId);
  return otherParticipant
    ? (otherParticipant.displayName || otherParticipant.username)
    : "Direct Chat";
}

function buildConversationView(conversation, currentUser, { selected = false } = {}) {
  const visibleMessages = getVisibleMessages(conversation, currentUser._id);
  const lastVisibleMessage = visibleMessages[visibleMessages.length - 1];
  const isPendingForViewer = !conversation.isGroup &&
    conversation.status === "pending" &&
    conversation.requestedBy &&
    String(conversation.requestedBy._id || conversation.requestedBy) !== String(currentUser._id);

  const otherParticipant = conversation.isGroup ? null : getOtherParticipant(conversation, currentUser._id);
  const isFavorite = currentUser.favoriteConversations.some((id) => String(id) === String(conversation._id));
  const isBlocked = !conversation.isGroup && otherParticipant ? isBlockedBetween(currentUser, otherParticipant) : false;
  const unreadCount = getParticipantSetting(conversation, currentUser._id)?.unreadCount || 0;

  return {
    _id: conversation._id,
    title: buildConversationTitle(conversation, currentUser._id),
    isGroup: conversation.isGroup,
    status: conversation.status,
    participants: conversation.participants,
    requestedBy: conversation.requestedBy,
    requestedById: conversation.requestedBy ? String(conversation.requestedBy._id || conversation.requestedBy) : "",
    messages: visibleMessages,
    lastMessageText: lastVisibleMessage ? lastVisibleMessage.text : (conversation.status === "pending" ? "Message request" : "No messages yet"),
    lastMessageAt: lastVisibleMessage ? lastVisibleMessage.createdAt : conversation.updatedAt,
    isPendingForViewer,
    isFavorite,
    isBlocked,
    unreadCount,
    otherParticipant,
    canSend: canSendMessage(conversation, currentUser._id, currentUser),
    selected
  };
}

async function getCurrentUser(userId) {
  return User.findById(userId)
    .select("username displayName handle profilePic allowMessages blockedUsers favoriteConversations");
}

async function getInboxData(userId, selectedConversationId = null) {
  const [currentUser, rawConversations] = await Promise.all([
    getCurrentUser(userId),
    Conversation.find({ participants: userId })
      .populate("participants")
      .populate("requestedBy")
      .populate("messages.sender")
      .sort({ updatedAt: -1 })
  ]);

  if (!currentUser) {
    return { currentUser: null, conversations: [], selectedConversation: null };
  }

  const conversations = rawConversations
    .map((conversation) => buildConversationView(conversation, currentUser, {
      selected: selectedConversationId && String(conversation._id) === String(selectedConversationId)
    }))
    .sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) {
        return a.isFavorite ? -1 : 1;
      }

      return new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0);
    });

  const selectedConversation = conversations.find((conversation) => String(conversation._id) === String(selectedConversationId)) || null;

  return {
    currentUser,
    conversations,
    selectedConversation
  };
}

async function getChatDirectory(userId) {
  return User.find({
    _id: { $ne: userId }
  })
    .select("username displayName handle profilePic allowMessages followers")
    .sort({ displayName: 1, username: 1 });
}

router.get("/inbox", requireLogin, asyncHandler(async (req, res) => {
  const { currentUser, conversations } = await getInboxData(req.session.userId);

  if (!currentUser) {
    req.flash("error", "User not found");
    return res.redirect("/login");
  }

  res.render("inbox", {
    conversations,
    selectedConversation: null
  });
}));

router.get("/inbox/new", requireLogin, asyncHandler(async (req, res) => {
  const viewerId = req.session.userId;
  const rawDirectory = await getChatDirectory(viewerId);
  const directoryUsers = rawDirectory.map((u) => {
    const plain = u.toObject();
    const canStartChat = canReceiveMessagesFrom(u, viewerId);
    return { ...plain, canStartChat };
  });
  res.render("newChat", { directoryUsers });
}));

async function startDirectConversation(req, res) {
  const targetUserId = req.params.userId;
  const [currentUser, targetUser] = await Promise.all([
    User.findById(req.session.userId),
    User.findById(targetUserId)
  ]);

  if (!currentUser) {
    req.flash("error", "User not found");
    return res.redirect("/login");
  }

  if (!targetUser) {
    req.flash("error", "That user was not found");
    return res.redirect("/inbox/new");
  }

  if (String(currentUser._id) === String(targetUser._id)) {
    req.flash("error", "You cannot message yourself");
    return res.redirect("/inbox/new");
  }

  if (isBlockedBetween(currentUser, targetUser)) {
    req.flash("error", "Messaging is unavailable for this user");
    return res.redirect(`/profile/${targetUser._id}`);
  }

  const pairIds = sortIds([req.session.userId, targetUserId]);
  let conversation = await Conversation.findOne({
    isGroup: false,
    participants: { $all: pairIds, $size: 2 }
  });

  if (!conversation && !canReceiveMessagesFrom(targetUser, currentUser._id)) {
    req.flash("error", "This user is not accepting new messages right now");
    return res.redirect(`/profile/${targetUser._id}`);
  }

  if (!conversation) {
    conversation = await Conversation.create({
      isGroup: false,
      participants: pairIds,
      participantSettings: pairIds.map((id) => ({ user: id })),
      status: "pending",
      requestedBy: currentUser._id,
      messages: [],
      lastMessageAt: new Date()
    });
  }

  res.redirect(`/inbox/${conversation._id}`);
}

router.get("/inbox/start/:userId", requireLogin, asyncHandler(startDirectConversation));
router.post("/inbox/start/:userId", requireLogin, asyncHandler(startDirectConversation));

router.post("/inbox/group", requireLogin, asyncHandler(async (req, res) => {
  const currentUser = await User.findById(req.session.userId);

  if (!currentUser) {
    req.flash("error", "User not found");
    return res.redirect("/login");
  }

  const title = req.body.title?.trim();
  const selectedParticipants = Array.isArray(req.body.participants)
    ? req.body.participants
    : req.body.participants
      ? [req.body.participants]
      : [];

  const candidateUsers = await User.find({
    _id: { $in: selectedParticipants, $ne: req.session.userId }
  }).select("allowMessages blockedUsers followers");

  if (!title) {
    req.flash("error", "Group title is required");
    return res.redirect("/inbox/new");
  }

  if (candidateUsers.length < 2) {
    req.flash("error", "Choose at least 2 people for a group chat");
    return res.redirect("/inbox/new");
  }

  const hasBlockedConflict = candidateUsers.some((person) =>
    !canReceiveMessagesFrom(person, currentUser._id) ||
    person.blockedUsers.some((id) => String(id) === String(req.session.userId)) ||
    currentUser.blockedUsers.some((id) => String(id) === String(person._id))
  );

  if (hasBlockedConflict) {
    req.flash("error", "One or more selected users are unavailable for a new group chat");
    return res.redirect("/inbox/new");
  }

  const uniqueParticipants = Array.from(new Set([
    String(req.session.userId),
    ...candidateUsers.map((user) => String(user._id))
  ]));

  const conversation = await Conversation.create({
    title,
    isGroup: true,
    participants: uniqueParticipants,
    participantSettings: uniqueParticipants.map((id) => ({ user: id })),
    status: "active",
    messages: [],
    lastMessageAt: new Date()
  });

  res.redirect(`/inbox/${conversation._id}`);
}));

router.get("/inbox/:id", requireLogin, asyncHandler(async (req, res) => {
  const selectedConversationDocument = await Conversation.findById(req.params.id);

  if (selectedConversationDocument && isParticipant(selectedConversationDocument, req.session.userId)) {
    markConversationRead(selectedConversationDocument, req.session.userId);
    await selectedConversationDocument.save();
  }

  const { currentUser, conversations, selectedConversation } = await getInboxData(req.session.userId, req.params.id);

  if (!currentUser) {
    req.flash("error", "User not found");
    return res.redirect("/login");
  }

  if (!selectedConversation) {
    req.flash("error", "Conversation not found");
    return res.redirect("/inbox");
  }

  res.render("inbox", {
    conversations,
    selectedConversation
  });
}));

router.post("/inbox/:id/accept", requireLogin, asyncHandler(async (req, res) => {
  const conversation = await Conversation.findById(req.params.id);

  if (!conversation || !isParticipant(conversation, req.session.userId)) {
    req.flash("error", "Conversation not found");
    return res.redirect("/inbox");
  }

  if (conversation.isGroup || conversation.status !== "pending") {
    return res.redirect(`/inbox/${conversation._id}`);
  }

  if (String(conversation.requestedBy) === String(req.session.userId)) {
    req.flash("error", "Only the recipient can accept this request");
    return res.redirect(`/inbox/${conversation._id}`);
  }

  conversation.status = "active";
  await conversation.save();

  req.flash("success", "Message request accepted");
  res.redirect(`/inbox/${conversation._id}`);
}));

router.post("/inbox/:id/decline", requireLogin, asyncHandler(async (req, res) => {
  const conversation = await Conversation.findById(req.params.id);

  if (!conversation || !isParticipant(conversation, req.session.userId)) {
    req.flash("error", "Conversation not found");
    return res.redirect("/inbox");
  }

  if (conversation.isGroup || conversation.status !== "pending") {
    return res.redirect(`/inbox/${conversation._id}`);
  }

  if (String(conversation.requestedBy) === String(req.session.userId)) {
    req.flash("error", "Only the recipient can decline this request");
    return res.redirect(`/inbox/${conversation._id}`);
  }

  await conversation.deleteOne();
  req.flash("success", "Message request declined");
  res.redirect("/inbox");
}));

router.post("/inbox/:id/favorite", requireLogin, asyncHandler(async (req, res) => {
  const [conversation, currentUser] = await Promise.all([
    Conversation.findById(req.params.id),
    User.findById(req.session.userId)
  ]);

  if (!conversation || !isParticipant(conversation, req.session.userId) || !currentUser) {
    req.flash("error", "Conversation not found");
    return res.redirect("/inbox");
  }

  const alreadyFavorite = currentUser.favoriteConversations.some((id) => String(id) === String(conversation._id));

  if (alreadyFavorite) {
    currentUser.favoriteConversations.pull(conversation._id);
    req.flash("success", "Conversation removed from favourites");
  } else {
    currentUser.favoriteConversations.push(conversation._id);
    req.flash("success", "Conversation added to favourites");
  }

  await currentUser.save();
  res.redirect(`/inbox/${conversation._id}`);
}));

router.post("/inbox/:id/block", requireLogin, asyncHandler(async (req, res) => {
  const [conversation, currentUser] = await Promise.all([
    Conversation.findById(req.params.id).populate("participants"),
    User.findById(req.session.userId)
  ]);

  if (!conversation || !isParticipant(conversation, req.session.userId) || !currentUser) {
    req.flash("error", "Conversation not found");
    return res.redirect("/inbox");
  }

  if (conversation.isGroup) {
    req.flash("error", "Block is only available in direct chats");
    return res.redirect(`/inbox/${conversation._id}`);
  }

  const otherParticipant = getOtherParticipant(conversation, req.session.userId);

  if (!otherParticipant) {
    req.flash("error", "User not found");
    return res.redirect(`/inbox/${conversation._id}`);
  }

  if (!hasBlocked(currentUser, otherParticipant._id)) {
    currentUser.blockedUsers.push(otherParticipant._id);
    await currentUser.save();
  }

  req.flash("success", "User blocked in chat");
  res.redirect(`/inbox/${conversation._id}`);
}));

router.post("/inbox/:id/clear", requireLogin, asyncHandler(async (req, res) => {
  const conversation = await Conversation.findById(req.params.id);

  if (!conversation || !isParticipant(conversation, req.session.userId)) {
    req.flash("error", "Conversation not found");
    return res.redirect("/inbox");
  }

  let participantSetting = conversation.participantSettings.find((setting) => String(setting.user) === String(req.session.userId));

  if (!participantSetting) {
    conversation.participantSettings.push({
      user: req.session.userId,
      unreadCount: 0,
      lastReadAt: new Date(),
      clearedAt: new Date()
    });
  } else {
    participantSetting.unreadCount = 0;
    participantSetting.lastReadAt = new Date();
    participantSetting.clearedAt = new Date();
  }

  await conversation.save();

  req.flash("success", "Chat cleared for your inbox");
  res.redirect(`/inbox/${conversation._id}`);
}));

router.post("/inbox/:id/message", requireLogin, asyncHandler(async (req, res) => {
  const [conversation, currentUser] = await Promise.all([
    Conversation.findById(req.params.id).populate("participants"),
    User.findById(req.session.userId)
  ]);
  const text = req.body.text?.trim();

  if (!conversation || !isParticipant(conversation, req.session.userId) || !currentUser) {
    req.flash("error", "Conversation not found");
    return res.redirect("/inbox");
  }

  if (!text) {
    req.flash("error", "Message cannot be empty");
    return res.redirect(`/inbox/${conversation._id}`);
  }

  if (!canSendMessage(conversation, req.session.userId, currentUser)) {
    req.flash("error", "You cannot send messages in this conversation");
    return res.redirect(`/inbox/${conversation._id}`);
  }

  conversation.messages.push({
    sender: req.session.userId,
    text
  });
  conversation.lastMessageAt = new Date();

  const participantSetting = conversation.participantSettings.find((setting) => String(setting.user) === String(req.session.userId));
  if (participantSetting && participantSetting.clearedAt) {
    participantSetting.clearedAt = null;
  }

  markConversationRead(conversation, req.session.userId);

  await conversation.save();

  res.redirect(`/inbox/${conversation._id}`);
}));

module.exports = router;
