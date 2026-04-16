const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  likes: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  ]
}, {
  timestamps: true
});

const postSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120
  },
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: 5000
  },
  media: {
    type: String,
    default: null
  },
  mediaType: {
    type: String,
    enum: ["image", "video", null],
    default: null
  },
  category: {
    type: String,
    enum: ["general", "photo", "video", "discussion"],
    default: "general"
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  visibility: {
    type: String,
    enum: ["public", "followers"],
    default: "public"
  },
  editedAt: {
    type: Date,
    default: null
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  likes: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  ],
  comments: [commentSchema]
}, {
  timestamps: true
});

module.exports = mongoose.model("Post", postSchema);
