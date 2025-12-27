const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'اسم الغرفة مطلوب'],
    trim: true,
    maxlength: [100, 'اسم الغرفة طويل جداً']
  },
  description: {
    type: String,
    maxlength: [500, 'الوصف طويل جداً']
  },
  type: {
    type: String,
    enum: ['public', 'private', 'direct', 'group'],
    default: 'public'
  },
  image: {
    type: String,
    default: 'https://api.dicebear.com/7.x/shapes/svg?seed=room'
  },
  coverImage: String,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  members: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    role: {
      type: String,
      enum: ['member', 'admin', 'moderator', 'owner'],
      default: 'member'
    },
    notifications: {
      type: String,
      enum: ['all', 'mentions', 'none'],
      default: 'all'
    },
    isMuted: {
      type: Boolean,
      default: false
    }
  }],
  settings: {
    allowFileSharing: {
      type: Boolean,
      default: true
    },
    allowVoiceMessages: {
      type: Boolean,
      default: true
    },
    allowVideoCalls: {
      type: Boolean,
      default: true
    },
    allowScreenSharing: {
      type: Boolean,
      default: true
    },
    maxFileSize: {
      type: Number,
      default: 10485760 // 10MB
    },
    slowMode: {
      enabled: {
        type: Boolean,
        default: false
      },
      interval: {
        type: Number,
        default: 5 // ثواني
      }
    },
    requireApproval: {
      type: Boolean,
      default: false
    },
    encryption: {
      type: String,
      enum: ['none', 'e2ee'],
      default: 'none'
    },
    encryptionKey: String
  },
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  pinnedMessages: [{
    message: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message'
    },
    pinnedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    pinnedAt: {
      type: Date,
      default: Date.now
    }
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  metadata: {
    messagesCount: {
      type: Number,
      default: 0
    },
    filesCount: {
      type: Number,
      default: 0
    },
    imagesCount: {
      type: Number,
      default: 0
    },
    callsCount: {
      type: Number,
      default: 0
    },
    totalMembers: {
      type: Number,
      default: 1
    },
    createdFrom: String
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// فهارس
roomSchema.index({ name: 'text', description: 'text' });
roomSchema.index({ type: 1, lastActivity: -1 });
roomSchema.index({ 'members.user': 1 });
roomSchema.index({ createdBy: 1 });
roomSchema.index({ isActive: 1, isArchived: 1 });

// إحصائيات افتراضية
roomSchema.virtual('membersCount').get(function() {
  return this.members.length;
});

roomSchema.virtual('onlineMembers').get(function() {
  // هذا سيعتمد على تطبيقك، يمكن ربطه بـ activeUsers
  return 0;
});

roomSchema.virtual('unreadCount').get(function() {
  // هذا سيعتمد على تطبيقك
  return 0;
});

roomSchema.virtual('isMember').get(function() {
  return function(userId) {
    return this.members.some(member => 
      member.user._id.toString() === userId.toString()
    );
  };
});

roomSchema.virtual('memberRole').get(function() {
  return function(userId) {
    const member = this.members.find(m => 
      m.user._id.toString() === userId.toString()
    );
    return member ? member.role : null;
  };
});

// تحديث قبل الحفظ
roomSchema.pre('save', function(next) {
  if (this.isNew) {
    // إضافة المنشئ كعضو ومشرف
    this.members.push({
      user: this.createdBy,
      role: 'owner',
      joinedAt: new Date()
    });
    
    this.metadata.totalMembers = 1;
  }
  
  // تحديث آخر نشاط
  this.lastActivity = new Date();
  
  next();
});

// تحديث بعد إضافة رسالة
roomSchema.methods.updateLastMessage = async function(messageId) {
  this.lastMessage = messageId;
  this.lastActivity = new Date();
  this.metadata.messagesCount += 1;
  await this.save();
};

// إضافة عضو جديد
roomSchema.methods.addMember = async function(userId, role = 'member') {
  if (!this.members.some(m => m.user.toString() === userId.toString())) {
    this.members.push({
      user: userId,
      role: role,
      joinedAt: new Date()
    });
    this.metadata.totalMembers += 1;
    await this.save();
  }
};

// إزالة عضو
roomSchema.methods.removeMember = async function(userId) {
  const index = this.members.findIndex(m => 
    m.user.toString() === userId.toString()
  );
  
  if (index > -1) {
    this.members.splice(index, 1);
    this.metadata.totalMembers = Math.max(0, this.metadata.totalMembers - 1);
    await this.save();
  }
};

// تحديث دور العضو
roomSchema.methods.updateMemberRole = async function(userId, newRole) {
  const member = this.members.find(m => 
    m.user.toString() === userId.toString()
  );
  
  if (member && member.role !== 'owner') {
    member.role = newRole;
    await this.save();
  }
};

module.exports = mongoose.model('Room', roomSchema);
