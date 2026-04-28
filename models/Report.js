const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema({
  post: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Post",
    default: null
  },
  postTitle: {
    type: String,
    required: true,
    trim: true,
    maxlength: 160
  },
  postAuthorName: {
    type: String,
    trim: true,
    maxlength: 80,
    default: "Unknown"
  },
  postAuthorHandle: {
    type: String,
    trim: true,
    maxlength: 40,
    default: ""
  },
  postUrl: {
    type: String,
    trim: true,
    maxlength: 240,
    default: ""
  },
  reporterUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },
  reporterName: {
    type: String,
    trim: true,
    maxlength: 80,
    default: "Guest"
  },
  reporterEmail: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 120,
    default: ""
  },
  reason: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  status: {
    type: String,
    enum: ["open", "resolved"],
    default: "open"
  }
}, {
  timestamps: true
});

module.exports = mongoose.model("Report", reportSchema);
