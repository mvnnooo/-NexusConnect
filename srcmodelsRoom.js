const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: String,
  type: {
    type: String,
    enum: ['public', 'private', 'direct'],
    default: 'public'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  admins: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  image: {
    type: String,
    default: 'https://api.dicebear.com/7.x/shapes/svg?seed=room'
  },
  settings: {
    allowFileSharing: {
      type: Boolean,
      default: true
    },
    allowVoiceMessages: {
      type: Boolean,
      default: true
    },
    maxFileSize: {
      type: Number,
      default: 10485760 // 10MB
    },
    slowMode: {
      type: Number,
      default: 0 // seconds, 0 means disabled
    }
  },
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  },
  encryptionKey: String, // للتشفير من طرف لطرف
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

roomSchema.pre('save', function(next) {
  this.lastActivity = Date.now();
  next();
});

module.exports = mongoose.model('Room', roomSchema);