const { Server } = require("socket.io");
const Conversation = require("../models/Conversation");
const User = require("../models/User");

const onlineUsers = new Map();

function wrap(middleware) {
  return (socket, next) => middleware(socket.request, {}, next);
}

function buildConversationTitle(conversation, currentUserId) {
  if (conversation.isGroup) {
    return conversation.title || "Group Chat";
  }

  const otherParticipant = conversation.participants.find(
    (participant) => String(participant._id) !== String(currentUserId)
  );

  return otherParticipant
    ? (otherParticipant.displayName || otherParticipant.username)
    : "Direct Chat";
}

function serializeMessage(message, currentUserId) {
  return {
    id: String(message._id),
    text: message.text,
    senderId: String(message.sender._id),
    senderName: message.sender.displayName || message.sender.username,
    isOwn: String(message.sender._id) === String(currentUserId),
    createdAt: message.createdAt
  };
}

function isParticipant(conversation, userId) {
  return conversation.participants.some(
    (participantId) => String(participantId._id || participantId) === String(userId)
  );
}

function getOtherParticipant(conversation, userId) {
  return conversation.participants.find(
    (participant) => String(participant._id || participant) !== String(userId)
  ) || null;
}

function isBlockedBetween(currentUser, targetUser) {
  if (!currentUser || !targetUser) {
    return false;
  }

  return currentUser.blockedUsers.some((id) => String(id) === String(targetUser._id)) ||
    targetUser.blockedUsers.some((id) => String(id) === String(currentUser._id));
}

function canSendMessage(conversation, userId) {
  return conversation.status === "active" || String(conversation.requestedBy) === String(userId);
}

function getParticipantSetting(conversation, userId) {
  return conversation.participantSettings?.find(
    (setting) => String(setting.user?._id || setting.user) === String(userId)
  ) || null;
}

function getVisibleMessages(conversation, currentUserId) {
  const participantSetting = getParticipantSetting(conversation, currentUserId);

  if (!participantSetting?.clearedAt) {
    return conversation.messages;
  }

  return conversation.messages.filter((message) => new Date(message.createdAt) > new Date(participantSetting.clearedAt));
}

function serializeConversationPreview(conversation, currentUserId) {
  const visibleMessages = getVisibleMessages(conversation, currentUserId);
  const lastMessage = visibleMessages[visibleMessages.length - 1];
  const participantSetting = getParticipantSetting(conversation, currentUserId);

  return {
    id: String(conversation._id),
    title: buildConversationTitle(conversation, currentUserId),
    isGroup: conversation.isGroup,
    unreadCount: participantSetting?.unreadCount || 0,
    lastMessageText: lastMessage ? lastMessage.text : (conversation.status === "pending" ? "Message request" : "No messages yet"),
    lastMessageAt: conversation.lastMessageAt
  };
}

function addOnlineUser(userId) {
  const nextCount = (onlineUsers.get(String(userId)) || 0) + 1;
  onlineUsers.set(String(userId), nextCount);
}

function removeOnlineUser(userId) {
  const currentCount = onlineUsers.get(String(userId)) || 0;
  if (currentCount <= 1) {
    onlineUsers.delete(String(userId));
    return false;
  }

  onlineUsers.set(String(userId), currentCount - 1);
  return true;
}

async function markConversationRead(conversationId, userId, io) {
  const conversation = await Conversation.findById(conversationId)
    .populate("participants")
    .populate("messages.sender")
    .populate("participantSettings.user");

  if (!conversation || !isParticipant(conversation, userId)) {
    return;
  }

  conversation.participantSettings.forEach((setting) => {
    if (String(setting.user?._id || setting.user) === String(userId)) {
      setting.unreadCount = 0;
      setting.lastReadAt = new Date();
    }
  });
  await conversation.save();

  io.to(`user:${userId}`).emit("chat:conversation-updated", {
    conversation: serializeConversationPreview(conversation, userId)
  });
}

function initChatSocket(server, sessionMiddleware) {
  const io = new Server(server, {
    cors: {
      origin: true,
      credentials: true
    }
  });

  io.use(wrap(sessionMiddleware));

  io.use((socket, next) => {
    if (!socket.request.session?.userId) {
      return next(new Error("Unauthorized"));
    }

    next();
  });

  io.on("connection", (socket) => {
    const currentUserId = String(socket.request.session.userId);

    socket.join(`user:${currentUserId}`);
    addOnlineUser(currentUserId);
    io.emit("presence:update", {
      userId: currentUserId,
      online: true
    });
    socket.emit("presence:list", {
      userIds: [...onlineUsers.keys()]
    });

    socket.on("chat:join", async ({ conversationId }) => {
      if (!conversationId) return;

      const conversation = await Conversation.findById(conversationId);
      if (!conversation || !isParticipant(conversation, currentUserId)) return;

      socket.join(`conversation:${conversationId}`);
      await markConversationRead(conversationId, currentUserId, io);
    });

    socket.on("chat:read", async ({ conversationId }) => {
      if (!conversationId) return;
      await markConversationRead(conversationId, currentUserId, io);
    });

    socket.on("chat:typing", ({ conversationId, isTyping }) => {
      if (!conversationId) return;

      socket.to(`conversation:${conversationId}`).emit("chat:typing", {
        conversationId,
        userId: currentUserId,
        isTyping: Boolean(isTyping)
      });
    });

    socket.on("chat:send", async ({ conversationId, text }, callback = () => {}) => {
      try {
        const trimmedText = String(text || "").trim();
        if (!conversationId || !trimmedText) {
          return callback({ ok: false, error: "Message cannot be empty" });
        }

        const [conversation, actor] = await Promise.all([
          Conversation.findById(conversationId).populate("participants"),
          User.findById(currentUserId).select("displayName username blockedUsers")
        ]);

        if (!conversation) {
          return callback({ ok: false, error: "Conversation not found" });
        }

        if (!isParticipant(conversation, currentUserId)) {
          return callback({ ok: false, error: "Not allowed in this conversation" });
        }

        if (!canSendMessage(conversation, currentUserId)) {
          return callback({ ok: false, error: "You cannot send messages in this conversation" });
        }

        if (!conversation.isGroup) {
          const otherParticipant = getOtherParticipant(conversation, currentUserId);
          const targetUser = otherParticipant
            ? await User.findById(otherParticipant._id).select("blockedUsers")
            : null;

          if (isBlockedBetween(actor, targetUser)) {
            return callback({ ok: false, error: "This chat is blocked" });
          }
        }

        conversation.messages.push({
          sender: currentUserId,
          text: trimmedText
        });
        conversation.lastMessageAt = new Date();

        conversation.participantSettings.forEach((setting) => {
          if (String(setting.user) === currentUserId) {
            setting.unreadCount = 0;
            setting.lastReadAt = new Date();
            if (setting.clearedAt) {
              setting.clearedAt = null;
            }
          } else {
            setting.unreadCount = (setting.unreadCount || 0) + 1;
          }
        });

        await conversation.save();

        const populatedConversation = await Conversation.findById(conversationId)
          .populate("participants")
          .populate("messages.sender")
          .populate("participantSettings.user");

        const savedMessage = populatedConversation.messages[populatedConversation.messages.length - 1];

        const roomPayload = {
          conversationId: String(populatedConversation._id),
          message: {
            id: String(savedMessage._id),
            text: savedMessage.text,
            senderId: String(savedMessage.sender._id),
            senderName: savedMessage.sender.displayName || savedMessage.sender.username,
            createdAt: savedMessage.createdAt
          }
        };

        io.to(`conversation:${conversationId}`).emit("chat:message", roomPayload);
        io.to(`conversation:${conversationId}`).emit("chat:typing", {
          conversationId: String(populatedConversation._id),
          userId: currentUserId,
          isTyping: false
        });

        populatedConversation.participants.forEach((participant) => {
          io.to(`user:${participant._id}`).emit("chat:conversation-updated", {
            conversation: serializeConversationPreview(populatedConversation, participant._id),
            actorName: actor ? (actor.displayName || actor.username) : "Someone"
          });
        });

        callback({
          ok: true,
          message: serializeMessage(savedMessage, currentUserId)
        });
      } catch (error) {
        callback({ ok: false, error: "Unable to send message" });
      }
    });

    socket.on("disconnect", () => {
      const stillOnline = removeOnlineUser(currentUserId);
      if (!stillOnline) {
        io.emit("presence:update", {
          userId: currentUserId,
          online: false
        });
      }
    });
  });

  return io;
}

module.exports = {
  initChatSocket,
  serializeConversationPreview,
  serializeMessage
};
