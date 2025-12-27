const mongoose = require('mongoose');

const callSchema = new mongoose.Schema({
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  initiator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['audio', 'video', 'screen'],
    default: 'video'
  },
  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room'
  },
  status: {
    type: String,
    enum: ['initiated', 'ringing', 'active', 'ended', 'missed'],
    default: 'initiated'
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  endedAt: Date,
  duration: Number, // في الثواني
  recordingUrl: String,
  transcription: String,
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

callSchema.pre('save', function(next) {
  if (this.status === 'ended' && this.startedAt) {
    this.duration = Math.floor((new Date() - this.startedAt) / 1000);
    this.endedAt = new Date();
  }
  next();
});

module.exports = mongoose.model('Call', callSchema);