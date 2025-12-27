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
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// إعداد التطبيق
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? ['https://yourusername.github.io', 'https://circl-chat-pro.vercel.app']
      : '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// إنشاء المجلدات الضرورية
const directories = ['uploads', 'uploads/images', 'uploads/files', 'uploads/audio'];
directories.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.socket.io", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:", "http:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:", "https:"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://yourusername.github.io', 'https://circl-chat-pro.vercel.app']
    : '*',
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// تحديد معدل الطلبات
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'لقد تجاوزت عدد الطلبات المسموح بها، يرجى المحاولة لاحقاً'
});
app.use('/api/', limiter);

// خدمة الملفات الثابتة
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
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
  limits: { 
    fileSize: (parseInt(process.env.FILE_UPLOAD_LIMIT_MB) || 10) * 1024 * 1024 
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'audio/mpeg', 'audio/wav', 'audio/ogg',
      'application/pdf', 'text/plain',
      'video/mp4', 'video/webm'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('نوع الملف غير مدعوم'), false);
    }
  }
});

// الاتصال بقاعدة البيانات
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
}).then(() => {
  console.log('✅ متصل بقاعدة البيانات MongoDB بنجاح');
}).catch(err => {
  console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err.message);
});

// نماذج البيانات
const User = require('./src/models/User');
const Message = require('./src/models/Message');
const Room = require('./src/models/Room');
const Call = require('./src/models/Call');

// تخزين البيانات في الذاكرة للمستخدمين النشطين
const activeUsers = new Map();
const activeCalls = new Map();
const typingUsers = new Map();

// API Routes
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

// تسجيل مستخدم جديد
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    // التحقق من البيانات
    if (!username || !password) {
      return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
    }
    
    // التحقق من وجود المستخدم
    const existingUser = await User.findOne({ 
      $or: [{ username }, { email }] 
    });
    
    if (existingUser) {
      return res.status(400).json({ error: 'اسم المستخدم أو البريد الإلكتروني مستخدم بالفعل' });
    }
    
    // تشفير كلمة المرور
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // إنشاء المستخدم
    const user = new User({
      username,
      email: email || null,
      password: hashedPassword,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
      status: 'offline'
    });
    
    await user.save();
    
    // إنشاء توكن
    const token = jwt.sign(
      { userId: user._id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        avatar: user.avatar,
        status: user.status
      }
    });
    
  } catch (error) {
    console.error('❌ خطأ في التسجيل:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء التسجيل' });
  }
});

// تسجيل الدخول
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
    }
    
    // البحث عن المستخدم
    const user = await User.findOne({ username });
    
    if (!user) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }
    
    // التحقق من كلمة المرور
    const validPassword = await bcrypt.compare(password, user.password);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }
    
    // إنشاء توكن
    const token = jwt.sign(
      { userId: user._id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        avatar: user.avatar,
        status: 'online'
      }
    });
    
  } catch (error) {
    console.error('❌ خطأ في تسجيل الدخول:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء تسجيل الدخول' });
  }
});

// جلب المستخدمين
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({})
      .select('username avatar status lastSeen createdAt')
      .sort({ username: 1 })
      .limit(100);
    
    res.json(users);
  } catch (error) {
    console.error('❌ خطأ في جلب المستخدمين:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء جلب المستخدمين' });
  }
});

// جلب الرسائل
app.get('/api/messages/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { limit = 50, before = null } = req.query;
    
    let query = { room: roomId, deleted: false };
    
    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }
    
    const messages = await Message.find(query)
      .populate('sender', 'username avatar')
      .populate('replyTo')
      .populate('mentions', 'username')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));
    
    res.json(messages.reverse());
  } catch (error) {
    console.error('❌ خطأ في جلب الرسائل:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء جلب الرسائل' });
  }
});

// جلب الغرف
app.get('/api/rooms', async (req, res) => {
  try {
    const rooms = await Room.find({ isActive: true })
      .populate('createdBy', 'username')
      .populate('members', 'username avatar')
      .sort({ lastActivity: -1 });
    
    res.json(rooms);
  } catch (error) {
    console.error('❌ خطأ في جلب الغرف:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء جلب الغرف' });
  }
});

// إنشاء غرفة جديدة
app.post('/api/rooms', async (req, res) => {
  try {
    const { name, description, type = 'public', members = [] } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'اسم الغرفة مطلوب' });
    }
    
    // التحقق من المصادقة (في تطبيق حقيقي)
    const userId = req.user?.userId || 'anonymous';
    
    const room = new Room({
      name,
      description,
      type,
      createdBy: userId,
      members: [...members, userId],
      image: `https://api.dicebear.com/7.x/shapes/svg?seed=${name}`
    });
    
    await room.save();
    
    const populatedRoom = await Room.findById(room._id)
      .populate('createdBy', 'username')
      .populate('members', 'username avatar');
    
    res.json(populatedRoom);
    
  } catch (error) {
    console.error('❌ خطأ في إنشاء الغرفة:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء إنشاء الغرفة' });
  }
});

// WebSocket Events
io.on('connection', (socket) => {
  console.log(`🔌 مستخدم جديد متصل: ${socket.id}`);
  
  // تسجيل دخول المستخدم
  socket.on('login', async (userData) => {
    try {
      let user = await User.findOne({ username: userData.username });
      
      if (!user) {
        // إنشاء مستخدم جديد إذا لم يكن موجوداً
        user = new User({
          username: userData.username,
          avatar: userData.avatar,
          status: 'online'
        });
        await user.save();
      } else {
        // تحديث حالة المستخدم الحالي
        user.status = 'online';
        user.lastSeen = new Date();
        await user.save();
      }
      
      socket.userId = user._id.toString();
      socket.username = user.username;
      
      // تخزين بيانات المستخدم النشط
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
      
      // إرسال ترحيب للمستخدم الجديد
      socket.emit('loginSuccess', {
        user: {
          id: user._id,
          username: user.username,
          avatar: user.avatar,
          status: 'online'
        },
        activeUsers: Array.from(activeUsers.values()),
        rooms: await Room.find({ isActive: true }).limit(20)
      });
      
      // إعلام المستخدمين الآخرين
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
  
  // إرسال رسالة
  socket.on('sendMessage', async (messageData) => {
    try {
      const user = activeUsers.get(socket.userId);
      if (!user) return;
      
      // التحقق من وجود غرفة
      let room = await Room.findOne({ _id: messageData.room });
      if (!room) {
        room = await Room.findOne({ name: messageData.room });
      }
      
      if (!room) {
        socket.emit('error', { message: 'الغرفة غير موجودة' });
        return;
      }
      
      // التحقق من أن المستخدم عضو في الغرفة
      if (room.type === 'private' && !room.members.includes(socket.userId)) {
        socket.emit('error', { message: 'ليس لديك صلاحية الوصول لهذه الغرفة' });
        return;
      }
      
      const message = new Message({
        sender: socket.userId,
        content: messageData.content,
        room: room._id,
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
      
      if (savedMessage.mentions && savedMessage.mentions.length > 0) {
        await savedMessage.populate('mentions', 'username avatar');
      }
      
      // تحديث آخر نشاط للغرفة
      room.lastActivity = new Date();
      room.lastMessage = savedMessage._id;
      await room.save();
      
      // إرسال الرسالة للجميع في الغرفة
      io.to(room._id.toString()).emit('newMessage', savedMessage);
      
      // إشعارات للمستخدمين المذكورين
      if (savedMessage.mentions && savedMessage.mentions.length > 0) {
        savedMessage.mentions.forEach(mentionedUser => {
          const activeUser = activeUsers.get(mentionedUser._id.toString());
          if (activeUser) {
            io.to(activeUser.socketId).emit('mention', {
              message: savedMessage,
              mentionedBy: user.username,
              room: room.name
            });
          }
        });
      }
      
    } catch (error) {
      console.error('❌ خطأ في إرسال الرسالة:', error);
      socket.emit('error', { message: 'خطأ في إرسال الرسالة' });
    }
  });
  
  // الانضمام إلى غرفة
  socket.on('joinRoom', async (roomData) => {
    try {
      const user = activeUsers.get(socket.userId);
      if (!user) return;
      
      // ترك الغرفة السابقة
      socket.leave(user.room);
      
      // الانضمام للغرفة الجديدة
      user.room = roomData.roomId;
      socket.join(roomData.roomId);
      activeUsers.set(socket.userId, user);
      
      // تحديث حالة المستخدم في قاعدة البيانات
      await User.findByIdAndUpdate(socket.userId, {
        $set: { lastSeen: new Date() }
      });
      
      // إرسال تأكيد للمستخدم
      socket.emit('roomChanged', {
        roomId: roomData.roomId,
        roomName: roomData.roomName
      });
      
      // إعلام الآخرين في الغرفة
      socket.to(roomData.roomId).emit('userJoinedRoom', {
        userId: socket.userId,
        username: user.username,
        avatar: user.avatar
      });
      
      console.log(`🔀 ${user.username} انضم إلى غرفة ${roomData.roomName}`);
      
    } catch (error) {
      console.error('❌ خطأ في تغيير الغرفة:', error);
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
      
      // تنظيف مؤشر الكتابة بعد 3 ثوانٍ
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
      const userIndex = message.likes.indexOf(userId);
      
      if (userIndex === -1) {
        // إضافة إعجاب
        message.likes.push(userId);
        await message.save();
        
        io.to(message.room.toString()).emit('messageLiked', {
          messageId: message._id,
          likes: message.likes,
          likedBy: userId,
          action: 'like'
        });
        
      } else {
        // إزالة إعجاب
        message.likes.splice(userIndex, 1);
        await message.save();
        
        io.to(message.room.toString()).emit('messageLiked', {
          messageId: message._id,
          likes: message.likes,
          likedBy: userId,
          action: 'unlike'
        });
      }
      
    } catch (error) {
      console.error('❌ خطأ في الإعجاب:', error);
    }
  });
  
  // بدء مكالمة
  socket.on('startCall', (callData) => {
    const user = activeUsers.get(socket.userId);
    if (!user) return;
    
    const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const call = {
      id: callId,
      caller: socket.userId,
      callerName: user.username,
      participants: [socket.userId],
      type: callData.type || 'video',
      room: callData.room || user.room,
      status: 'ringing',
      startedAt: new Date(),
      offer: callData.offer
    };
    
    activeCalls.set(callId, call);
    
    // إرسال طلب المكالمة للمستخدمين في الغرفة
    socket.to(call.room).emit('incomingCall', {
      callId: callId,
      caller: user.username,
      callerId: socket.userId,
      type: call.type,
      room: call.room,
      offer: call.offer
    });
    
    socket.emit('callStarted', { callId: callId });
    
    console.log(`📞 ${user.username} بدأ مكالمة ${call.type}`);
  });
  
  // قبول المكالمة
  socket.on('acceptCall', (callData) => {
    const call = activeCalls.get(callData.callId);
    if (call && call.status === 'ringing') {
      call.participants.push(socket.userId);
      call.status = 'active';
      activeCalls.set(callData.callId, call);
      
      // إرسال قبول المكالمة للجميع
      io.to(call.room).emit('callAccepted', {
        callId: callData.callId,
        participants: call.participants,
        answer: callData.answer
      });
      
      console.log(`✅ مكالمة ${callData.callId} مقبولة`);
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
      call.status = 'ended';
      call.endedAt = new Date();
      call.duration = Math.floor((call.endedAt - call.startedAt) / 1000);
      
      // إرسال إنهاء المكالمة للجميع
      io.to(call.room).emit('callEnded', { 
        callId: callId,
        duration: call.duration,
        endedBy: socket.userId
      });
      
      // حفظ المكالمة في قاعدة البيانات
      const callRecord = new Call({
        participants: call.participants,
        initiator: call.caller,
        type: call.type,
        room: call.room,
        status: 'ended',
        startedAt: call.startedAt,
        endedAt: call.endedAt,
        duration: call.duration
      });
      
      callRecord.save().catch(console.error);
      
      activeCalls.delete(callId);
      
      console.log(`❌ مكالمة ${callId} انتهت`);
    }
  });
  
  // تحديث حالة المستخدم
  socket.on('updateStatus', async (status) => {
    const user = activeUsers.get(socket.userId);
    if (user) {
      user.status = status;
      activeUsers.set(socket.userId, user);
      
      // تحديث في قاعدة البيانات
      await User.findByIdAndUpdate(socket.userId, {
        $set: { status: status, lastSeen: new Date() }
      });
      
      // إعلام جميع المستخدمين
      io.emit('userStatusChanged', {
        userId: socket.userId,
        username: user.username,
        status: status,
        avatar: user.avatar
      });
      
      console.log(`🔄 ${user.username} غير حالته إلى ${status}`);
    }
  });
  
  // فحص النشاط
  socket.on('ping', () => {
    const user = activeUsers.get(socket.userId);
    if (user) {
      user.lastActive = Date.now();
      activeUsers.set(socket.userId, user);
    }
    socket.emit('pong');
  });
  
  // الانقطاع
  socket.on('disconnect', async () => {
    const user = activeUsers.get(socket.userId);
    if (user) {
      // تحديث الحالة في قاعدة البيانات
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
      
      // إنهاء أي مكالمات نشطة
      activeCalls.forEach((call, callId) => {
        if (call.participants.includes(socket.userId)) {
          socket.to(call.room).emit('callEnded', { 
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

// صفحة 404
app.use((req, res) => {
  res.status(404);
  
  if (req.accepts('html')) {
    res.sendFile(path.join(__dirname, 'public', '404.html'));
  } else if (req.accepts('json')) {
    res.json({ error: 'الصفحة غير موجودة' });
  } else {
    res.type('txt').send('الصفحة غير موجودة');
  }
});

// معالجة الأخطاء
app.use((err, req, res, next) => {
  console.error('❌ خطأ في الخادم:', err.stack);
  
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' 
      ? 'حدث خطأ في الخادم' 
      : err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// بدء الخادم
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
🚀 Circl Chat Pro يعمل بنجاح!
📡 البيئة: ${process.env.NODE_ENV || 'development'}
🌐 الرابط: http://localhost:${PORT}
📊 المستخدمون النشطون: 0
💾 قاعدة البيانات: ${mongoose.connection.readyState === 1 ? 'متصل ✅' : 'غير متصل ❌'}
  `);
});

// تنظيف المستخدمين غير النشطين كل ساعة
setInterval(() => {
  const now = Date.now();
  const timeout = 5 * 60 * 1000; // 5 دقائق
  
  activeUsers.forEach((user, userId) => {
    if (now - user.lastActive > timeout) {
      activeUsers.delete(userId);
      io.emit('userStatusChanged', {
        userId: userId,
        username: user.username,
        status: 'offline',
        avatar: user.avatar
      });
      console.log(`🧹 تنظيف مستخدم غير نشط: ${user.username}`);
    }
  });
}, 60 * 60 * 1000); // كل ساعة

// تصدير للتطبيقات الخارجية
module.exports = { app, server, io };
