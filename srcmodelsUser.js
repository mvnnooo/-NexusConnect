const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 20
  },
  email: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  avatar: {
    type: String,
    default: 'https://api.dicebear.com/7.x/avataaars/svg?seed=default'
  },
  status: {
    type: String,
    enum: ['online', 'offline', 'away', 'busy', 'invisible'],
    default: 'offline'
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  socketId: String,
  theme: {
    type: String,
    enum: ['light', 'dark', 'auto'],
    default: 'dark'
  },
  notifications: {
    type: Boolean,
    default: true
  },
  sounds: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// تحديث lastSeen قبل الحفظ
userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('User', userSchema);