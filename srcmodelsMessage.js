const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: function() {
      return !this.fileUrl;
    }
  },
  room: {
    type: String,
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['text', 'image', 'file', 'audio', 'video', 'system'],
    default: 'text'
  },
  fileUrl: String,
  fileName: String,
  fileType: String,
  fileSize: Number,
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  mentions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  reactions: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    emoji: String,
    timestamp: Date
  }],
  readBy: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    readAt: Date
  }],
  deleted: {
    type: Boolean,
    default: false
  },
  deletedAt: Date,
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  edited: {
    type: Boolean,
    default: false
  },
  editedAt: Date,
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// فهرس للبحث السريع
messageSchema.index({ room: 1, createdAt: -1 });
messageSchema.index({ sender: 1, createdAt: -1 });
messageSchema.index({ mentions: 1 });

module.exports = mongoose.model('Message', messageSchema);