// ------------ BACKEND (server.js) ------------
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// تخزين المستخدمين النشطين
const users = new Map();
const rooms = ['عام', 'تقنية', 'تطوير', 'تعلم', 'ترفيه'];

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log('مستخدم جديد متصل:', socket.id);
    
    // انضمام المستخدم
    socket.on('join', (userData) => {
        users.set(socket.id, {
            id: socket.id,
            username: userData.username,
            avatar: userData.avatar,
            room: 'عام'
        });
        
        socket.join('عام');
        socket.emit('welcome', {
            message: `مرحباً ${userData.username}!`,
            rooms: rooms,
            users: Array.from(users.values())
        });
        
        // إعلام الآخرين
        socket.broadcast.emit('userJoined', {
            id: socket.id,
            username: userData.username,
            avatar: userData.avatar
        });
    });
    
    // إرسال رسالة
    socket.on('sendMessage', (messageData) => {
        const user = users.get(socket.id);
        if (user) {
            const message = {
                id: Date.now(),
                userId: socket.id,
                username: user.username,
                avatar: user.avatar,
                text: messageData.text,
                timestamp: new Date(),
                room: user.room
            };
            
            io.to(user.room).emit('newMessage', message);
            
            // حفظ الرسالة في التاريخ (في تطبيق حقيقي: قاعدة بيانات)
            console.log('رسالة جديدة:', message);
        }
    });
    
    // تغيير الغرفة
    socket.on('changeRoom', (roomName) => {
        const user = users.get(socket.id);
        if (user) {
            socket.leave(user.room);
            user.room = roomName;
            socket.join(roomName);
            
            socket.emit('roomChanged', {
                room: roomName,
                message: `انتقلت إلى غرفة ${roomName}`
            });
        }
    });
    
    // الكتابة النشطة
    socket.on('typing', (isTyping) => {
        const user = users.get(socket.id);
        if (user) {
            socket.broadcast.to(user.room).emit('userTyping', {
                userId: socket.id,
                username: user.username,
                isTyping: isTyping
            });
        }
    });
    
    // انقطاع الاتصال
    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user) {
            users.delete(socket.id);
            io.emit('userLeft', {
                id: socket.id,
                username: user.username
            });
            console.log('مستخدم انقطع:', user.username);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ الخادم يعمل على http://localhost:${PORT}`);
});