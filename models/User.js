const mongoose = require("mongoose");
const { DEFAULT_PROFILE_PIC } = require("../utils/uploads");

const notificationSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ["follow", "post_like", "comment", "comment_like", "save"],
    required: true
  },
  message: {
    type: String,
    required: true,
    trim: true
  },
  actor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },
  post: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Post",
    default: null
  },
  read: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  displayName: {
    type: String,
    trim: true,
    maxlength: 50,
    default: ""
  },
  handle: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 30,
    sparse: true
  },
  bio: {
    type: String,
    trim: true,
    maxlength: 160,
    default: ""
  },
  allowMessages: {
    type: String,
    enum: ["everyone", "nobody", "followers"],
    default: "everyone"
  },
  profilePic: {
    type: String,
    default: DEFAULT_PROFILE_PIC
  },
  followers: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  ],
  following: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  ],
  savedPosts: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post"
    }
  ],
  blockedUsers: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  ],
  favoriteConversations: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation"
    }
  ],
  notifications: [notificationSchema]
}, {
  timestamps: true
});

userSchema.pre("validate", function deriveProfileFields(next) {
  if (!this.displayName) {
    this.displayName = this.username;
  }

  if (!this.handle && this.username) {
    this.handle = this.username
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 30);
  }

  next();
});

module.exports = mongoose.model("User", userSchema);
