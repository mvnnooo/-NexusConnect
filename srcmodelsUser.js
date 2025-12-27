const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, 'اسم المستخدم مطلوب'],
    unique: true,
    trim: true,
    minlength: [3, 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل'],
    maxlength: [30, 'اسم المستخدم يجب أن لا يتجاوز 30 حرف'],
    match: [/^[a-zA-Z0-9_\u0600-\u06FF\s]+$/, 'اسم المستخدم غير صالح']
  },
  email: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'البريد الإلكتروني غير صالح']
  },
  password: {
    type: String,
    required: function() {
      return this.email; // كلمة المرور مطلوبة فقط إذا كان هناك بريد إلكتروني
    },
    minlength: [6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل']
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
    enabled: {
      type: Boolean,
      default: true
    },
    sounds: {
      type: Boolean,
      default: true
    },
    desktop: {
      type: Boolean,
      default: true
    }
  },
  privacy: {
    showStatus: {
      type: Boolean,
      default: true
    },
    showLastSeen: {
      type: Boolean,
      default: true
    },
    allowDirectMessages: {
      type: Boolean,
      default: true
    }
  },
  friends: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  blockedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  rooms: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room'
  }],
  metadata: {
    joinDate: {
      type: Date,
      default: Date.now
    },
    messagesCount: {
      type: Number,
      default: 0
    },
    callsCount: {
      type: Number,
      default: 0
    },
    lastActive: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// فهارس
userSchema.index({ username: 1 });
userSchema.index({ email: 1 });
userSchema.index({ status: 1 });
userSchema.index({ 'metadata.lastActive': -1 });

// إحصائيات افتراضية
userSchema.virtual('isOnline').get(function() {
  return this.status === 'online';
});

userSchema.virtual('activityStatus').get(function() {
  if (this.status === 'online') return 'متصل الآن';
  if (this.status === 'away') return 'بعيد';
  if (this.status === 'busy') return 'مشغول';
  
  if (this.lastSeen) {
    const diff = Date.now() - this.lastSeen.getTime();
    const minutes = Math.floor(diff / 60000);
    
    if (minutes < 1) return 'كان متصلًا للتو';
    if (minutes < 60) return `منذ ${minutes} دقيقة`;
    
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `منذ ${hours} ساعة`;
    
    const days = Math.floor(hours / 24);
    return `منذ ${days} يوم`;
  }
  
  return 'غير متصل';
});

// تحديث آخر ظهور قبل الحفظ
userSchema.pre('save', function(next) {
  if (this.isModified('status') && this.status === 'offline') {
    this.lastSeen = new Date();
  }
  next();
});

module.exports = mongoose.model('User', userSchema);
