const mongoose = require('mongoose');

const callSchema = new mongoose.Schema({
  participants: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    leftAt: Date,
    duration: Number, // المدة بالميلي ثانية
    role: {
      type: String,
      enum: ['initiator', 'participant', 'viewer'],
      default: 'participant'
    },
    streamType: {
      type: String,
      enum: ['audio', 'video', 'screen', 'none'],
      default: 'video'
    }
  }],
  initiator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['audio', 'video', 'screen', 'group'],
    default: 'video'
  },
  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room'
  },
  status: {
    type: String,
    enum: ['initiated', 'ringing', 'active', 'ended', 'missed', 'rejected', 'busy'],
    default: 'initiated'
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  endedAt: Date,
  duration: Number, // المدة الإجمالية بالثواني
  recording: {
    enabled: {
      type: Boolean,
      default: false
    },
    url: String,
    size: Number,
    format: String
  },
  transcription: {
    enabled: {
      type: Boolean,
      default: false
    },
    text: String,
    language: {
      type: String,
      default: 'ar'
    }
  },
  screenShare: {
    enabled: {
      type: Boolean,
      default: false
    },
    sharedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    startedAt: Date,
    endedAt: Date
  },
  chatMessages: [{
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    content: String,
    sentAt: {
      type: Date,
      default: Date.now
    }
  }],
  quality: {
    videoResolution: {
      type: String,
      default: '720p'
    },
    audioQuality: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium'
    },
    networkQuality: {
      type: String,
      enum: ['poor', 'fair', 'good', 'excellent'],
      default: 'good'
    }
  },
  settings: {
    allowRecording: {
      type: Boolean,
      default: false
    },
    allowTranscription: {
      type: Boolean,
      default: false
    },
    allowScreenShare: {
      type: Boolean,
      default: true
    },
    maxParticipants: {
      type: Number,
      default: 10
    },
    waitingRoom: {
      type: Boolean,
      default: false
    }
  },
  metadata: {
    sdpOffer: String,
    sdpAnswer: String,
    iceCandidates: [{
      candidate: String,
      sdpMid: String,
      sdpMLineIndex: Number,
      timestamp: Date
    }],
    turnServers: [{
      urls: String,
      username: String,
      credential: String
    }],
    clientInfo: String,
    deviceInfo: String,
    networkInfo: {
      type: String,
      bandwidth: Number,
      latency: Number,
      packetLoss: Number
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// فهارس
callSchema.index({ initiator: 1, startedAt: -1 });
callSchema.index({ 'participants.user': 1 });
callSchema.index({ room: 1 });
callSchema.index({ status: 1, startedAt: -1 });
callSchema.index({ endedAt: -1 });

// إحصائيات افتراضية
callSchema.virtual('activeParticipants').get(function() {
  return this.participants.filter(p => !p.leftAt).length;
});

callSchema.virtual('totalParticipants').get(function() {
  return this.participants.length;
});

callSchema.virtual('callTitle').get(function() {
  if (this.room) {
    return `مكالمة في غرفة ${this.room.name}`;
  }
  
  const participantsCount = this.participants.length;
  if (participantsCount === 2) {
    return 'مكالمة ثنائية';
  }
  
  return `مكالمة جماعية (${participantsCount})`;
});

callSchema.virtual('formattedDuration').get(function() {
  if (!this.duration) return '00:00';
  
  const hours = Math.floor(this.duration / 3600);
  const minutes = Math.floor((this.duration % 3600) / 60);
  const seconds = this.duration % 60;
  
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
});

// تحديث قبل الحفظ
callSchema.pre('save', function(next) {
  if (this.isModified('status') && this.status === 'ended' && this.startedAt) {
    this.endedAt = new Date();
    this.duration = Math.floor((this.endedAt - this.startedAt) / 1000);
    
    // تحديث مدة المشاركين النشطين
    this.participants.forEach(participant => {
      if (!participant.leftAt) {
        participant.leftAt = this.endedAt;
        participant.duration = Math.floor((this.endedAt - participant.joinedAt) / 1000);
      }
    });
  }
  
  next();
});

// إضافة مشارك
callSchema.methods.addParticipant = function(userId, role = 'participant', streamType = 'video') {
  const existingParticipant = this.participants.find(
    p => p.user.toString() === userId.toString()
  );
  
  if (!existingParticipant) {
    this.participants.push({
      user: userId,
      role: role,
      streamType: streamType,
      joinedAt: new Date()
    });
    
    // تحديث حالة المكالمة
    if (this.status === 'ringing') {
      this.status = 'active';
    }
  }
};

// إزالة مشارك
callSchema.methods.removeParticipant = function(userId) {
  const participant = this.participants.find(
    p => p.user.toString() === userId.toString()
  );
  
  if (participant && !participant.leftAt) {
    participant.leftAt = new Date();
    participant.duration = Math.floor(
      (participant.leftAt - participant.joinedAt) / 1000
    );
    
    // إذا لم يتبقى أحد، إنهاء المكالمة
    const activeParticipants = this.participants.filter(p => !p.leftAt);
    if (activeParticipants.length === 0) {
      this.status = 'ended';
    }
  }
};

// بدء مشاركة الشاشة
callSchema.methods.startScreenShare = function(userId) {
  this.screenShare.enabled = true;
  this.screenShare.sharedBy = userId;
  this.screenShare.startedAt = new Date();
};

// إيقاف مشاركة الشاشة
callSchema.methods.stopScreenShare = function() {
  this.screenShare.enabled = false;
  this.screenShare.endedAt = new Date();
};

// إضافة رسالة محادثة
callSchema.methods.addChatMessage = function(userId, content) {
  this.chatMessages.push({
    sender: userId,
    content: content,
    sentAt: new Date()
  });
};

module.exports = mongoose.model('Call', callSchema);
