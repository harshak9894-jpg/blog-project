const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  text: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  }
}, {
  timestamps: true
});

const conversationSchema = new mongoose.Schema({
  title: {
    type: String,
    trim: true,
    maxlength: 80,
    default: ""
  },
  isGroup: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ["pending", "active"],
    default: function () {
      return this.isGroup ? "active" : "pending";
    }
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },
  participants: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    }
  ],
  participantSettings: [
    {
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
      },
      unreadCount: {
        type: Number,
        default: 0
      },
      lastReadAt: {
        type: Date,
        default: null
      },
      clearedAt: {
        type: Date,
        default: null
      }
    }
  ],
  messages: [messageSchema],
  lastMessageAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model("Conversation", conversationSchema);
