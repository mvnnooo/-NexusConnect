const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  content: {
    type: String,
    required: function() {
      return !this.fileUrl && this.type !== 'system';
    },
    trim: true,
    maxlength: [5000, 'الرسالة طويلة جداً']
  },
  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['text', 'image', 'file', 'audio', 'video', 'system', 'sticker', 'location'],
    default: 'text'
  },
  fileUrl: String,
  fileName: String,
  fileType: String,
  fileSize: Number,
  thumbnailUrl: String,
  duration: Number, // للرسائل الصوتية/الفيديو
  coordinates: { // للرسائل الجغرافية
    lat: Number,
    lng: Number
  },
  locationName: String,
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
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    emoji: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  readBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    readAt: {
      type: Date,
      default: Date.now
    }
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
  editedHistory: [{
    content: String,
    editedAt: Date
  }],
  pinned: {
    type: Boolean,
    default: false
  },
  pinnedAt: Date,
  pinnedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  metadata: {
    isEdited: {
      type: Boolean,
      default: false
    },
    isForwarded: {
      type: Boolean,
      default: false
    },
    forwardedFrom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message'
    },
    clientInfo: String,
    encryption: {
      type: String,
      enum: ['none', 'e2ee'],
      default: 'none'
    },
    encryptionKey: String
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// فهارس
messageSchema.index({ room: 1, createdAt: -1 });
messageSchema.index({ sender: 1, createdAt: -1 });
messageSchema.index({ 'mentions': 1 });
messageSchema.index({ 'likes': 1 });
messageSchema.index({ pinned: 1, room: 1 });

// إحصائيات افتراضية
messageSchema.virtual('isOwnedBy').get(function() {
  return function(userId) {
    return this.sender._id.toString() === userId.toString();
  };
});

messageSchema.virtual('isLikedBy').get(function() {
  return function(userId) {
    return this.likes.some(like => like._id.toString() === userId.toString());
  };
});

messageSchema.virtual('isRead').get(function() {
  return this.readBy.length > 0;
});

messageSchema.virtual('likesCount').get(function() {
  return this.likes.length;
});

messageSchema.virtual('reactionsCount').get(function() {
  return this.reactions.length;
});

// تحديث قبل الحفظ
messageSchema.pre('save', function(next) {
  if (this.isModified('content') && !this.isNew) {
    this.edited = true;
    this.editedAt = new Date();
    
    // حفظ النسخة القديمة
    if (!this.editedHistory) {
      this.editedHistory = [];
    }
    
    // احفظ فقط آخر 5 تعديلات
    if (this.editedHistory.length >= 5) {
      this.editedHistory.shift();
    }
    
    this.editedHistory.push({
      content: this.content,
      editedAt: this.editedAt
    });
  }
  
  // تقليم المحتوى إذا كان طويلاً جداً
  if (this.content && this.content.length > 5000) {
    this.content = this.content.substring(0, 5000);
  }
  
  next();
});

// عند حذف الرسالة
messageSchema.pre('save', function(next) {
  if (this.deleted && !this.deletedAt) {
    this.deletedAt = new Date();
    this.content = 'تم حذف هذه الرسالة';
    this.fileUrl = null;
    this.fileName = null;
    this.fileType = null;
    this.fileSize = null;
    this.thumbnailUrl = null;
  }
  next();
});

module.exports = mongoose.model('Message', messageSchema);
