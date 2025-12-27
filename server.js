require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
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

// إعداد Socket.IO مع CORS
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// الاتصال بقاعدة البيانات (اختياري)
let useDatabase = false;
try {
    mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/circl_chat', {
        useNewUrlParser: true,
        useUnifiedTopology: true
    });
    useDatabase = true;
    console.log('✅ متصل بقاعدة البيانات MongoDB');
} catch (error) {
    console.log('⚠️  استخدام الذاكرة المؤقتة للبيانات');
}

// نماذج مبسطة تعمل مع الذاكرة أيضاً
let User, Message;
if (useDatabase) {
    const userSchema = new mongoose.Schema({
        username: String,
        avatar: String,
        status: { type: String, default: 'online' },
        lastSeen: { type: Date, default: Date.now }
    }, { timestamps: true });

    const messageSchema = new mongoose.Schema({
        sender: String,
        senderName: String,
        senderAvatar: String,
        content: String,
        room: String,
        type: { type: String, default: 'text' },
        fileUrl: String,
        fileName: String,
        fileType: String,
        fileSize: Number,
        likes: [String],
        readBy: [String]
    }, { timestamps: true });

    User = mongoose.model('User', userSchema);
    Message = mongoose.model('Message', messageSchema);
}

// تخزين البيانات في الذاكرة للمستخدمين النشطين
const activeUsers = new Map();
const roomMessages = {
    'general': [],
    'tech': [],
    'games': [],
    'music': []
};

// مسارات API
app.get('/api/messages/:room', (req, res) => {
    const room = req.params.room;
    res.json(roomMessages[room] || []);
});

app.get('/api/users', (req, res) => {
    const users = Array.from(activeUsers.values()).map(user => ({
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        status: user.status,
        room: user.room
    }));
    res.json(users);
});

app.get('/api/rooms', (req, res) => {
    const rooms = [
        { id: 'general', name: 'عام', description: 'الدردشة العامة للجميع', members: Array.from(activeUsers.values()).filter(u => u.room === 'general').length },
        { id: 'tech', name: 'تقنية', description: 'مناقشات التقنية والتطوير', members: Array.from(activeUsers.values()).filter(u => u.room === 'tech').length },
        { id: 'games', name: 'ألعاب', description: 'مناقشة الألعاب والترفيه', members: Array.from(activeUsers.values()).filter(u => u.room === 'games').length },
        { id: 'music', name: 'موسيقى', description: 'مشاركة الموسيقى والفنون', members: Array.from(activeUsers.values()).filter(u => u.room === 'music').length }
    ];
    res.json(rooms);
});

// Socket.IO Events
io.on('connection', (socket) => {
    console.log(`🔌 مستخدم جديد متصل: ${socket.id}`);

    // انضمام المستخدم
    socket.on('join', async (userData) => {
        try {
            const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const username = userData.username || `مستخدم_${Math.floor(Math.random() * 1000)}`;
            const avatar = userData.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`;
            
            const user = {
                id: userId,
                socketId: socket.id,
                username: username,
                avatar: avatar,
                status: 'online',
                room: 'general',
                lastActive: Date.now()
            };
            
            socket.userId = userId;
            socket.username = username;
            
            // تخزين في الذاكرة النشطة
            activeUsers.set(userId, user);
            
            // الانضمام للغرفة العامة
            socket.join('general');
            
            // حفظ في قاعدة البيانات إذا كانت متوفرة
            if (useDatabase && User) {
                await User.findOneAndUpdate(
                    { username: username },
                    {
                        username: username,
                        avatar: avatar,
                        status: 'online',
                        lastSeen: new Date()
                    },
                    { upsert: true, new: true }
                );
            }
            
            // إرسال بيانات للمستخدم الجديد
            socket.emit('welcome', {
                user: user,
                activeUsers: Array.from(activeUsers.values()),
                rooms: [
                    { id: 'general', name: 'عام', members: Array.from(activeUsers.values()).filter(u => u.room === 'general').length },
                    { id: 'tech', name: 'تقنية', members: Array.from(activeUsers.values()).filter(u => u.room === 'tech').length },
                    { id: 'games', name: 'ألعاب', members: Array.from(activeUsers.values()).filter(u => u.room === 'games').length },
                    { id: 'music', name: 'موسيقى', members: Array.from(activeUsers.values()).filter(u => u.room === 'music').length }
                ],
                messages: roomMessages['general'] || []
            });
            
            // إعلام جميع المستخدمين بمستخدم جديد
            io.emit('userJoined', {
                id: userId,
                username: username,
                avatar: avatar,
                status: 'online',
                room: 'general'
            });
            
            // تحديث عدد المستخدمين في الغرف
            io.emit('roomUpdate', {
                room: 'general',
                members: Array.from(activeUsers.values()).filter(u => u.room === 'general').length
            });
            
            console.log(`✅ ${username} انضم إلى الدردشة`);
            
        } catch (error) {
            console.error('❌ خطأ في انضمام المستخدم:', error);
            socket.emit('error', { message: 'خطأ في الانضمام للدردشة' });
        }
    });

    // إرسال رسالة
    socket.on('sendMessage', async (messageData) => {
        try {
            const user = activeUsers.get(socket.userId);
            if (!user) return;

            const message = {
                id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                sender: socket.userId,
                senderName: user.username,
                senderAvatar: user.avatar,
                content: messageData.content,
                room: messageData.room || user.room,
                type: messageData.type || 'text',
                fileUrl: messageData.fileUrl,
                fileName: messageData.fileName,
                fileType: messageData.fileType,
                fileSize: messageData.fileSize,
                likes: [],
                readBy: [socket.userId],
                timestamp: new Date(),
                time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
            };

            // حفظ الرسالة في الذاكرة
            if (!roomMessages[message.room]) {
                roomMessages[message.room] = [];
            }
            roomMessages[message.room].push(message);
            
            // حفظ في قاعدة البيانات إذا كانت متوفرة
            if (useDatabase && Message) {
                const dbMessage = new Message({
                    sender: socket.userId,
                    senderName: user.username,
                    senderAvatar: user.avatar,
                    content: messageData.content,
                    room: messageData.room || user.room,
                    type: messageData.type || 'text',
                    fileUrl: messageData.fileUrl,
                    fileName: messageData.fileName,
                    fileType: messageData.fileType,
                    fileSize: messageData.fileSize,
                    likes: [],
                    readBy: [socket.userId]
                });
                await dbMessage.save();
            }

            // إرسال الرسالة للجميع في الغرفة
            io.to(message.room).emit('newMessage', message);

            // تحديث آخر نشاط للغرفة
            io.emit('roomActivity', {
                room: message.room,
                lastMessage: message.content.substring(0, 50),
                timestamp: message.timestamp
            });

        } catch (error) {
            console.error('❌ خطأ في إرسال الرسالة:', error);
            socket.emit('error', { message: 'خطأ في إرسال الرسالة' });
        }
    });

    // تغيير الغرفة
    socket.on('changeRoom', (roomData) => {
        const user = activeUsers.get(socket.userId);
        if (user) {
            // ترك الغرفة السابقة
            socket.leave(user.room);
            
            // تحديث عدد الأعضاء في الغرفة السابقة
            io.emit('roomUpdate', {
                room: user.room,
                members: Array.from(activeUsers.values()).filter(u => u.room === user.room).length - 1
            });

            // الانضمام للغرفة الجديدة
            user.room = roomData.roomId;
            socket.join(roomData.roomId);
            activeUsers.set(socket.userId, user);

            // إرسال رسالة ترحيبية للمستخدم
            const welcomeMessage = {
                id: `sys_${Date.now()}`,
                sender: 'system',
                senderName: 'النظام',
                senderAvatar: 'https://api.dicebear.com/7.x/shapes/svg?seed=system',
                content: `مرحباً ${user.username}! انتقلت إلى غرفة ${roomData.roomName}`,
                room: roomData.roomId,
                type: 'system',
                timestamp: new Date(),
                time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
            };

            socket.emit('newMessage', welcomeMessage);

            // إرسال رسالة للمستخدمين الآخرين في الغرفة
            const joinMessage = {
                id: `sys_${Date.now()}_join`,
                sender: 'system',
                senderName: 'النظام',
                senderAvatar: 'https://api.dicebear.com/7.x/shapes/svg?seed=system',
                content: `${user.username} انضم إلى الغرفة`,
                room: roomData.roomId,
                type: 'system',
                timestamp: new Date(),
                time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
            };

            socket.to(roomData.roomId).emit('newMessage', joinMessage);

            // إرسال رسائل الغرفة للمستخدم
            socket.emit('roomMessages', {
                room: roomData.roomId,
                messages: roomMessages[roomData.roomId] || []
            });

            // تحديث عدد الأعضاء في الغرفة الجديدة
            io.emit('roomUpdate', {
                room: roomData.roomId,
                members: Array.from(activeUsers.values()).filter(u => u.room === roomData.roomId).length
            });

            // إعلام المستخدم بتغيير الغرفة
            socket.emit('roomChanged', {
                roomId: roomData.roomId,
                roomName: roomData.roomName,
                members: Array.from(activeUsers.values()).filter(u => u.room === roomData.roomId).length
            });
        }
    });

    // مؤشر الكتابة
    socket.on('typing', (isTyping) => {
        const user = activeUsers.get(socket.userId);
        if (user) {
            socket.to(user.room).emit('userTyping', {
                userId: socket.userId,
                username: user.username,
                isTyping: isTyping
            });
        }
    });

    // الإعجاب على الرسالة
    socket.on('likeMessage', (messageId) => {
        const user = activeUsers.get(socket.userId);
        if (!user) return;

        // البحث عن الرسالة في جميع الغرف
        for (const room in roomMessages) {
            const messageIndex = roomMessages[room].findIndex(msg => msg.id === messageId);
            if (messageIndex !== -1) {
                const message = roomMessages[room][messageIndex];
                
                // التحقق إذا كان المستخدم قد أعجب بالفعل
                const likeIndex = message.likes.indexOf(socket.userId);
                
                if (likeIndex === -1) {
                    // إضافة إعجاب
                    message.likes.push(socket.userId);
                } else {
                    // إزالة إعجاب
                    message.likes.splice(likeIndex, 1);
                }
                
                roomMessages[room][messageIndex] = message;
                
                // إرسال تحديث للجميع في الغرفة
                io.to(message.room).emit('messageLiked', {
                    messageId: messageId,
                    likes: message.likes,
                    likedBy: socket.userId
                });
                
                break;
            }
        }
    });

    // تحديث حالة المستخدم
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

    // البحث في الرسائل
    socket.on('searchMessages', (searchData) => {
        const user = activeUsers.get(socket.userId);
        if (!user) return;

        const results = [];
        const searchTerm = searchData.query.toLowerCase();
        const room = searchData.room || user.room;

        if (roomMessages[room]) {
            results.push(...roomMessages[room].filter(msg => 
                msg.content.toLowerCase().includes(searchTerm) ||
                msg.senderName.toLowerCase().includes(searchTerm)
            ));
        }

        socket.emit('searchResults', {
            query: searchData.query,
            results: results.slice(0, 50), // تحديد النتائج
            count: results.length
        });
    });

    // طلب تحديث المستخدمين
    socket.on('getUsers', () => {
        const users = Array.from(activeUsers.values()).map(user => ({
            id: user.id,
            username: user.username,
            avatar: user.avatar,
            status: user.status,
            room: user.room
        }));
        socket.emit('usersList', users);
    });

    // طلب تحديث الرسائل
    socket.on('getMessages', (room) => {
        socket.emit('messagesList', {
            room: room,
            messages: roomMessages[room] || []
        });
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
    socket.on('disconnect', () => {
        const user = activeUsers.get(socket.userId);
        if (user) {
            // تحديث الحالة
            user.status = 'offline';
            
            // إعلام جميع المستخدمين
            io.emit('userLeft', {
                userId: socket.userId,
                username: user.username
            });

            // تحديث عدد الأعضاء في الغرفة
            io.emit('roomUpdate', {
                room: user.room,
                members: Array.from(activeUsers.values()).filter(u => u.room === user.room && u.status === 'online').length
            });

            // إزالة من الذاكرة النشطة بعد 5 دقائق
            setTimeout(() => {
                if (activeUsers.get(socket.userId)?.status === 'offline') {
                    activeUsers.delete(socket.userId);
                }
            }, 5 * 60 * 1000);

            console.log(`❌ ${user.username} انقطع`);
        }
    });
});

// الصفحة الرئيسية
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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
👥 المستخدمون النشطون: 0
💾 الوضع: ${useDatabase ? 'قاعدة بيانات' : 'ذاكرة مؤقتة'}
📡 الجاهزية: 100%
    `);
});

// تنظيف الذاكرة المؤقتة كل ساعة
setInterval(() => {
    const now = Date.now();
    const inactiveTime = 30 * 60 * 1000; // 30 دقيقة
    
    activeUsers.forEach((user, userId) => {
        if (now - user.lastActive > inactiveTime) {
            activeUsers.delete(userId);
            io.emit('userLeft', {
                userId: userId,
                username: user.username
            });
        }
    });
}, 60 * 60 * 1000);
