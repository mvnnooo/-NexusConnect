require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

// إنشاء مجلدات التخزين
const directories = ['uploads', 'uploads/images', 'uploads/files', 'uploads/audio'];
directories.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Middleware الأساسي
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// رفع الملفات
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, './uploads/images');
    } else if (file.mimetype.startsWith('audio/')) {
      cb(null, './uploads/audio');
    } else {
      cb(null, './uploads/files');
    }
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

// الاتصال بقاعدة البيانات
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/circl_chat', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('✅ متصل بقاعدة البيانات MongoDB');
}).catch(err => {
  console.log('⚠️  استخدام قاعدة البيانات في الذاكرة بسبب:', err.message);
});

// نماذج بيانات مبسطة
const userSchema = new mongoose.Schema({
  username: String,
  avatar: String,
  status: String,
  lastSeen: Date
}, { timestamps: true });

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  content: String,
  room: String,
  type: { type: String, default: 'text' },
  fileUrl: String,
  fileName: String,
  fileType: String,
  fileSize: Number,
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  readBy: [{ userId: mongoose.Schema.Types.ObjectId, readAt: Date }]
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

// تخزين البيانات في الذاكرة
const activeUsers = new Map();
const activeCalls = new Map();
const typingUsers = new Map();

// Routes API
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'لم يتم رفع أي ملف' });
    }
    
    const fileUrl = `/uploads/${req.file.destination.split('/').slice(1).join('/')}/${req.file.filename}`;
    
    res.json({
      success: true,
      url: fileUrl,
      name: req.file.originalname,
      type: req.file.mimetype,
      size: req.file.size
    });
  } catch (error) {
    console.error('❌ خطأ في رفع الملف:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء رفع الملف' });
  }
});

app.get('/api/messages/:room', async (req, res) => {
  try {
    const messages = await Message.find({ room: req.params.room })
      .populate('sender', 'username avatar')
      .sort({ createdAt: -1 })
      .limit(50);
    
    res.json(messages.reverse());
  } catch (error) {
    res.status(500).json({ error: 'خطأ في جلب الرسائل' });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({})
      .select('username avatar status lastSeen')
      .sort({ username: 1 });
    
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'خطأ في جلب المستخدمين' });
  }
});

// WebSocket Events
io.on('connection', (socket) => {
  console.log(`🔌 مستخدم متصل: ${socket.id}`);
  
  socket.on('login', async (userData) => {
    try {
      let user = await User.findOne({ username: userData.username });
      
      if (!user) {
        user = new User({
          username: userData.username,
          avatar: userData.avatar,
          status: 'online',
          lastSeen: new Date()
        });
        await user.save();
      } else {
        user.status = 'online';
        user.lastSeen = new Date();
        await user.save();
      }
      
      socket.userId = user._id.toString();
      socket.username = user.username;
      
      // تخزين المستخدم النشط
      activeUsers.set(socket.userId, {
        id: socket.userId,
        socketId: socket.id,
        username: user.username,
        avatar: user.avatar,
        status: 'online',
        room: 'general',
        lastActive: Date.now()
      });
      
      socket.join('general');
      
      // إرسال بيانات للمستخدم الجديد
      socket.emit('loginSuccess', {
        user: {
          id: user._id,
          username: user.username,
          avatar: user.avatar,
          status: 'online'
        },
        activeUsers: Array.from(activeUsers.values()),
        rooms: [
          { _id: 'general', name: 'عام', type: 'public', membersCount: activeUsers.size },
          { _id: 'tech', name: 'تقنية', type: 'public', membersCount: 0 },
          { _id: 'games', name: 'ألعاب', type: 'public', membersCount: 0 },
          { _id: 'music', name: 'موسيقى', type: 'public', membersCount: 0 }
        ]
      });
      
      // إعلام الآخرين
      socket.broadcast.emit('userStatusChanged', {
        userId: socket.userId,
        username: user.username,
        avatar: user.avatar,
        status: 'online'
      });
      
      console.log(`✅ ${user.username} سجل الدخول`);
      
    } catch (error) {
      console.error('❌ خطأ في تسجيل الدخول:', error);
      socket.emit('loginError', { message: 'خطأ في تسجيل الدخول' });
    }
  });
  
  socket.on('sendMessage', async (messageData) => {
    try {
      const user = activeUsers.get(socket.userId);
      if (!user) return;
      
      const message = new Message({
        sender: socket.userId,
        content: messageData.content,
        room: messageData.room || user.room,
        type: messageData.type || 'text',
        fileUrl: messageData.fileUrl,
        fileName: messageData.fileName,
        fileType: messageData.fileType,
        fileSize: messageData.fileSize,
        replyTo: messageData.replyTo
      });
      
      const savedMessage = await message.save();
      await savedMessage.populate('sender', 'username avatar');
      
      // إرسال الرسالة للغرفة
      io.to(savedMessage.room).emit('newMessage', savedMessage);
      
    } catch (error) {
      console.error('❌ خطأ في إرسال الرسالة:', error);
    }
  });
  
  socket.on('joinRoom', (roomData) => {
    const user = activeUsers.get(socket.userId);
    if (user) {
      socket.leave(user.room);
      user.room = roomData.roomId;
      socket.join(roomData.roomId);
      activeUsers.set(socket.userId, user);
      
      socket.emit('roomChanged', {
        roomId: roomData.roomId,
        roomName: roomData.roomName
      });
      
      // إعلام الغرفة
      socket.to(roomData.roomId).emit('userJoinedRoom', {
        userId: socket.userId,
        username: user.username,
        avatar: user.avatar
      });
    }
  });
  
  socket.on('typing', (data) => {
    const user = activeUsers.get(socket.userId);
    if (user) {
      socket.to(user.room).emit('userTyping', {
        userId: socket.userId,
        username: user.username,
        isTyping: data.isTyping
      });
    }
  });
  
  socket.on('likeMessage', async (messageId) => {
    try {
      const message = await Message.findById(messageId);
      if (!message) return;
      
      const userId = socket.userId;
      const likeIndex = message.likes.indexOf(userId);
      
      if (likeIndex === -1) {
        message.likes.push(userId);
      } else {
        message.likes.splice(likeIndex, 1);
      }
      
      await message.save();
      
      io.to(message.room).emit('messageLiked', {
        messageId: message._id,
        likes: message.likes,
        likedBy: userId
      });
      
    } catch (error) {
      console.error('❌ خطأ في الإعجاب:', error);
    }
  });
  
  socket.on('startCall', (callData) => {
    const user = activeUsers.get(socket.userId);
    if (!user) return;
    
    const callId = `call_${Date.now()}`;
    activeCalls.set(callId, {
      id: callId,
      caller: socket.userId,
      callerName: user.username,
      participants: [socket.userId],
      type: callData.type || 'video',
      room: callData.room || user.room,
      status: 'ringing',
      startedAt: new Date()
    });
    
    socket.to(callData.room || user.room).emit('incomingCall', {
      callId: callId,
      caller: user.username,
      callerId: socket.userId,
      type: callData.type || 'video',
      room: callData.room || user.room
    });
    
    socket.emit('callStarted', { callId: callId });
  });
  
  socket.on('acceptCall', (callData) => {
    const call = activeCalls.get(callData.callId);
    if (call && call.status === 'ringing') {
      call.participants.push(socket.userId);
      call.status = 'active';
      activeCalls.set(callData.callId, call);
      
      io.to(call.room).emit('callAccepted', {
        callId: callData.callId,
        participants: call.participants
      });
    }
  });
  
  socket.on('endCall', (callId) => {
    const call = activeCalls.get(callId);
    if (call) {
      call.status = 'ended';
      call.endedAt = new Date();
      
      io.to(call.room).emit('callEnded', { 
        callId: callId,
        endedBy: socket.userId
      });
      
      activeCalls.delete(callId);
    }
  });
  
  socket.on('webrtcSignal', (data) => {
    const targetUser = activeUsers.get(data.to);
    if (targetUser) {
      io.to(targetUser.socketId).emit('webrtcSignal', {
        from: socket.userId,
        signal: data.signal,
        type: data.type
      });
    }
  });
  
  socket.on('updateStatus', (status) => {
    const user = activeUsers.get(socket.userId);
    if (user) {
      user.status = status;
      activeUsers.set(socket.userId, user);
      
      io.emit('userStatusChanged', {
        userId: socket.userId,
        username: user.username,
        status: status,
        avatar: user.avatar
      });
    }
  });
  
  socket.on('ping', () => {
    const user = activeUsers.get(socket.userId);
    if (user) {
      user.lastActive = Date.now();
      activeUsers.set(socket.userId, user);
    }
    socket.emit('pong');
  });
  
  socket.on('disconnect', async () => {
    const user = activeUsers.get(socket.userId);
    if (user) {
      try {
        await User.findByIdAndUpdate(socket.userId, {
          status: 'offline',
          lastSeen: new Date()
        });
      } catch (error) {
        console.error('❌ خطأ في تحديث حالة المستخدم:', error);
      }
      
      io.emit('userStatusChanged', {
        userId: socket.userId,
        username: user.username,
        status: 'offline',
        avatar: user.avatar
      });
      
      activeUsers.delete(socket.userId);
      
      // إنهاء المكالمات النشطة
      activeCalls.forEach((call, callId) => {
        if (call.participants.includes(socket.userId)) {
          io.to(call.room).emit('callEnded', { 
            callId: callId,
            reason: 'user_disconnected'
          });
          activeCalls.delete(callId);
        }
      });
      
      console.log(`❌ ${user.username} انقطع`);
    }
  });
});

// الصفحة الرئيسية
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// خدمة الملفات المرفوعة
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// صفحة 404
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// بدء الخادم
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
🚀 Circl Chat Pro يعمل بنجاح!
🌐 الرابط: http://localhost:${PORT}
📡 الوضع: ${process.env.NODE_ENV || 'development'}
💾 قاعدة البيانات: ${mongoose.connection.readyState === 1 ? 'متصل ✅' : 'محلي ⚡'}
  `);
});

// تنظيف الذاكرة كل 5 دقائق
setInterval(() => {
  const now = Date.now();
  const timeout = 5 * 60 * 1000;
  
  activeUsers.forEach((user, userId) => {
    if (now - user.lastActive > timeout) {
      activeUsers.delete(userId);
      io.emit('userStatusChanged', {
        userId: userId,
        username: user.username,
        status: 'offline',
        avatar: user.avatar
      });
    }
  });
}, 5 * 60 * 1000);
