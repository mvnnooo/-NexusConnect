require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// الأمان والضبط
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// تحديد معدل الطلبات
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 100 // 100 طلب لكل IP
});
app.use('/api/', limiter);

// مجلدات التخزين
if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
  fs.mkdirSync('./uploads/images');
  fs.mkdirSync('./uploads/files');
}

// رفع الملفات
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, './uploads/images');
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
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// الاتصال بقاعدة البيانات
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ متصل بقاعدة البيانات MongoDB');
}).catch(err => {
  console.error('❌ خطأ في الاتصال:', err);
});

// نماذج البيانات
const User = require('./src/models/User');
const Message = require('./src/models/Message');
const Room = require('./src/models/Room');
const Call = require('./src/models/Call');

// تخزين المستخدمين النشطين في الذاكرة
const activeUsers = new Map();
const activeCalls = new Map();
const typingUsers = new Map();

// API Routes
app.use(express.static(path.join(__dirname, 'public')));

// رفع الملفات
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'لم يتم رفع أي ملف' });
  }
  
  const fileUrl = `/uploads/${req.file.path.split('/').slice(1).join('/')}`;
  res.json({
    url: fileUrl,
    name: req.file.originalname,
    type: req.file.mimetype,
    size: req.file.size
  });
});

// WebSocket Events
io.on('connection', (socket) => {
  console.log(`🔌 مستخدم متصل: ${socket.id}`);

  // تسجيل دخول المستخدم
  socket.on('login', async (userData) => {
    try {
      const user = await User.findOneAndUpdate(
        { username: userData.username },
        {
          $set: {
            socketId: socket.id,
            status: 'online',
            lastSeen: new Date()
          }
        },
        { upsert: true, new: true }
      );

      socket.userId = user._id.toString();
      socket.username = user.username;
      activeUsers.set(socket.userId, {
        id: socket.userId,
        socketId: socket.id,
        username: user.username,
        avatar: user.avatar,
        status: 'online',
        room: 'general'
      });

      socket.join('general');
      
      // إعلام جميع المستخدمين
      io.emit('userStatusChanged', {
        userId: socket.userId,
        username: user.username,
        status: 'online',
        avatar: user.avatar
      });

      // إرسال بيانات المستخدم الجديد
      socket.emit('loginSuccess', {
        user: {
          id: user._id,
          username: user.username,
          avatar: user.avatar,
          status: 'online'
        },
        activeUsers: Array.from(activeUsers.values()),
        rooms: await Room.find({})
      });

      console.log(`✅ ${user.username} سجل الدخول`);
    } catch (error) {
      console.error('❌ خطأ في تسجيل الدخول:', error);
      socket.emit('loginError', { message: 'خطأ في تسجيل الدخول' });
    }
  });

  // إرسال رسالة
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
        replyTo: messageData.replyTo,
        mentions: messageData.mentions || []
      });

      const savedMessage = await message.save();
      await savedMessage.populate('sender', 'username avatar');
      if (savedMessage.replyTo) {
        await savedMessage.populate('replyTo');
      }

      // إرسال الرسالة للغرفة
      io.to(savedMessage.room).emit('newMessage', savedMessage);

      // إشعارات للمستخدمين المذكورين
      if (savedMessage.mentions && savedMessage.mentions.length > 0) {
        savedMessage.mentions.forEach(mentionedId => {
          const mentionedUser = activeUsers.get(mentionedId);
          if (mentionedUser) {
            io.to(mentionedUser.socketId).emit('mention', {
              message: savedMessage,
              mentionedBy: user.username
            });
          }
        });
      }

    } catch (error) {
      console.error('❌ خطأ في إرسال الرسالة:', error);
    }
  });

  // تغيير الغرفة
  socket.on('joinRoom', async (roomData) => {
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
    }
  });

  // إنشاء غرفة جديدة
  socket.on('createRoom', async (roomData) => {
    try {
      const room = new Room({
        name: roomData.name,
        description: roomData.description,
        type: roomData.type || 'public',
        createdBy: socket.userId,
        members: [socket.userId]
      });

      const savedRoom = await room.save();
      io.emit('roomCreated', savedRoom);
      socket.emit('roomCreatedSuccess', savedRoom);

    } catch (error) {
      console.error('❌ خطأ في إنشاء الغرفة:', error);
    }
  });

  // مؤشر الكتابة
  socket.on('typing', (data) => {
    const user = activeUsers.get(socket.userId);
    if (user) {
      typingUsers.set(socket.userId, {
        username: user.username,
        room: user.room,
        timestamp: Date.now()
      });

      socket.to(user.room).emit('userTyping', {
        userId: socket.userId,
        username: user.username,
        isTyping: true
      });

      // تنظيف مؤشر الكتابة بعد 3 ثوان
      setTimeout(() => {
        if (typingUsers.has(socket.userId)) {
          typingUsers.delete(socket.userId);
          socket.to(user.room).emit('userTyping', {
            userId: socket.userId,
            username: user.username,
            isTyping: false
          });
        }
      }, 3000);
    }
  });

  // الإعجاب على الرسالة
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

  // الرد على رسالة
  socket.on('replyToMessage', async (data) => {
    try {
      const user = activeUsers.get(socket.userId);
      if (!user) return;

      const replyMessage = new Message({
        sender: socket.userId,
        content: data.content,
        room: user.room,
        replyTo: data.replyTo,
        type: data.type || 'text'
      });

      const savedReply = await replyMessage.save();
      await savedReply.populate('sender', 'username avatar');
      await savedReply.populate('replyTo');

      io.to(user.room).emit('newReply', savedReply);

    } catch (error) {
      console.error('❌ خطأ في الرد:', error);
    }
  });

  // بدء مكالمة فيديو
  socket.on('startCall', (callData) => {
    const user = activeUsers.get(socket.userId);
    if (!user) return;

    const callId = 'call_' + Date.now();
    activeCalls.set(callId, {
      id: callId,
      caller: socket.userId,
      callerName: user.username,
      participants: [socket.userId],
      type: callData.type || 'video',
      room: callData.room,
      status: 'ringing'
    });

    // إرسال طلب المكالمة للمستخدمين في الغرفة
    socket.to(callData.room).emit('incomingCall', {
      callId: callId,
      caller: user.username,
      callerId: socket.userId,
      type: callData.type || 'video',
      room: callData.room
    });

    socket.emit('callStarted', { callId: callId });
  });

  // قبول المكالمة
  socket.on('acceptCall', (callId) => {
    const call = activeCalls.get(callId);
    if (call) {
      call.participants.push(socket.userId);
      call.status = 'active';
      activeCalls.set(callId, call);

      // إعلام جميع المشاركين
      call.participants.forEach(participantId => {
        const participant = activeUsers.get(participantId);
        if (participant) {
          io.to(participant.socketId).emit('callAccepted', {
            callId: callId,
            participants: call.participants
          });
        }
      });
    }
  });

  // إشارات WebRTC
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

  // إنهاء المكالمة
  socket.on('endCall', (callId) => {
    const call = activeCalls.get(callId);
    if (call) {
      call.participants.forEach(participantId => {
        const participant = activeUsers.get(participantId);
        if (participant) {
          io.to(participant.socketId).emit('callEnded', { callId: callId });
        }
      });
      activeCalls.delete(callId);
    }
  });

  // تحديث الحالة
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

  // الانقطاع
  socket.on('disconnect', async () => {
    const user = activeUsers.get(socket.userId);
    if (user) {
      // تحديث الحالة إلى offline
      await User.findByIdAndUpdate(socket.userId, {
        $set: {
          status: 'offline',
          lastSeen: new Date()
        }
      });

      // إعلام جميع المستخدمين
      io.emit('userStatusChanged', {
        userId: socket.userId,
        username: user.username,
        status: 'offline',
        avatar: user.avatar
      });

      // إزالة من المستخدمين النشطين
      activeUsers.delete(socket.userId);
      console.log(`❌ ${user.username} انقطع`);
    }
  });
});

// مسارات API REST
app.get('/api/messages/:roomId', async (req, res) => {
  try {
    const messages = await Message.find({ room: req.params.roomId })
      .populate('sender', 'username avatar')
      .populate('replyTo')
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

app.get('/api/rooms', async (req, res) => {
  try {
    const rooms = await Room.find({})
      .populate('createdBy', 'username')
      .sort({ createdAt: -1 });
    
    res.json(rooms);
  } catch (error) {
    res.status(500).json({ error: 'خطأ في جلب الغرف' });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 الخادم يعمل على http://localhost:${PORT}`);
});
