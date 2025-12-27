// تطبيق Circl Chat Pro
class CirclChat {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.currentRoom = 'general';
        this.rooms = [];
        this.users = [];
        this.activeUsers = new Map();
        this.messages = [];
        this.typingUsers = new Set();
        this.typingTimeout = null;
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.isRecording = false;
        this.currentCall = null;
        this.peerConnections = new Map();
        this.localStream = null;
        this.callStartTime = null;
        this.callInterval = null;
        this.notifications = [];
        this.isDarkTheme = true;
        
        this.initialize();
    }
    
    initialize() {
        this.bindEvents();
        this.loadTheme();
        this.setupEmojiPicker();
        this.setupVoiceRecorder();
        this.generateAvatars();
        
        // الاتصال بالسيرفر
        this.connectToServer();
    }
    
    bindEvents() {
        // تسجيل الدخول
        document.getElementById('loginBtn').addEventListener('click', () => this.login());
        document.getElementById('username').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.login();
        });
        
        // إرسال الرسالة
        document.getElementById('sendMessageBtn').addEventListener('click', () => this.sendMessage());
        document.getElementById('messageInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // مؤشر الكتابة
        document.getElementById('messageInput').addEventListener('input', () => this.handleTyping());
        
        // الملفات
        document.getElementById('attachFileBtn').addEventListener('click', () => {
            document.getElementById('fileUploadInput').click();
        });
        
        document.getElementById('attachImageBtn').addEventListener('click', () => {
            document.getElementById('imageUploadInput').click();
        });
        
        document.getElementById('fileUploadInput').addEventListener('change', (e) => this.handleFileUpload(e));
        document.getElementById('imageUploadInput').addEventListener('change', (e) => this.handleImageUpload(e));
        
        // المكالمات
        document.getElementById('voiceCallBtn').addEventListener('click', () => this.startCall('audio'));
        document.getElementById('videoCallBtn').addEventListener('click', () => this.startCall('video'));
        document.getElementById('endCallBtn').addEventListener('click', () => this.endCall());
        
        // المواضيع
        document.getElementById('themeToggleBtn').addEventListener('click', () => this.toggleTheme());
        document.getElementById('themeSelect').addEventListener('change', (e) => this.changeTheme(e.target.value));
        
        // الإعدادات
        document.getElementById('sidebarToggle').addEventListener('click', () => this.toggleSidebar());
        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());
        
        // الأموجي
        document.getElementById('emojiBtn').addEventListener('click', (e) => this.toggleEmojiPicker(e));
        
        // البحث
        document.getElementById('globalSearch').addEventListener('input', (e) => this.searchMessages(e.target.value));
    }
    
    connectToServer() {
        this.socket = io('http://localhost:3000');
        
        this.socket.on('connect', () => {
            console.log('✅ متصل بالسيرفر');
        });
        
        this.socket.on('loginSuccess', (data) => {
            this.handleLoginSuccess(data);
        });
        
        this.socket.on('newMessage', (message) => {
            this.addMessage(message);
        });
        
        this.socket.on('userStatusChanged', (data) => {
            this.updateUserStatus(data);
        });
        
        this.socket.on('userTyping', (data) => {
            this.updateTypingIndicator(data);
        });
        
        this.socket.on('messageLiked', (data) => {
            this.updateMessageLikes(data);
        });
        
        this.socket.on('newReply', (reply) => {
            this.addReply(reply);
        });
        
        this.socket.on('mention', (data) => {
            this.showMentionNotification(data);
        });
        
        this.socket.on('roomCreated', (room) => {
            this.addRoom(room);
        });
        
        this.socket.on('incomingCall', (callData) => {
            this.showIncomingCall(callData);
        });
        
        this.socket.on('callStarted', (data) => {
            this.handleCallStarted(data);
        });
        
        this.socket.on('callAccepted', (data) => {
            this.handleCallAccepted(data);
        });
        
        this.socket.on('callEnded', (data) => {
            this.handleCallEnded(data);
        });
        
        this.socket.on('webrtcSignal', (data) => {
            this.handleWebRTCSignal(data);
        });
    }
    
    login() {
        const username = document.getElementById('username').value.trim();
        const selectedAvatar = document.querySelector('.avatar-option.selected').dataset.avatar;
        const theme = document.getElementById('themeSelect').value;
        
        if (!username) {
            this.showNotification('الرجاء إدخال اسم المستخدم', 'warning');
            return;
        }
        
        this.currentUser = {
            username: username,
            avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}${selectedAvatar}`,
            theme: theme
        };
        
        this.socket.emit('login', this.currentUser);
        
        // إخفاء نافذة تسجيل الدخول
        document.getElementById('loginModal').classList.remove('active');
        
        // إظهار تطبيق الدردشة
        document.getElementById('chatApp').classList.remove('hidden');
        
        // تحديث واجهة المستخدم
        document.getElementById('userNameDisplay').textContent = username;
        document.getElementById('userAvatarImg').src = this.currentUser.avatar;
        
        // تطبيق المظهر
        this.applyTheme(theme);
    }
    
    handleLoginSuccess(data) {
        this.currentUser.id = data.user.id;
        this.currentUser.status = 'online';
        
        // تحديث قائمة المستخدمين
        this.updateUsersList(data.activeUsers);
        
        // تحديث قائمة الغرف
        this.updateRoomsList(data.rooms);
        
        // تحميل الرسائل السابقة
        this.loadPreviousMessages();
        
        this.showNotification(`مرحباً ${this.currentUser.username}!`, 'success');
    }
    
    sendMessage() {
        const input = document.getElementById('messageInput');
        const content = input.value.trim();
        
        if (!content) return;
        
        // التحقق من المذكرات
        const mentions = this.extractMentions(content);
        
        const messageData = {
            content: content,
            room: this.currentRoom,
            type: 'text',
            mentions: mentions
        };
        
        this.socket.emit('sendMessage', messageData);
        
        // مسح حقل الإدخال
        input.value = '';
        input.style.height = 'auto';
        
        // إيقاف مؤشر الكتابة
        this.socket.emit('typing', false);
        clearTimeout(this.typingTimeout);
        this.typingTimeout = null;
    }
    
    handleTyping() {
        if (!this.typingTimeout) {
            this.socket.emit('typing', true);
        }
        
        clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
            this.socket.emit('typing', false);
            this.typingTimeout = null;
        }, 1000);
        
        // ضبط ارتفاع حقل الإدخال
        const input = document.getElementById('messageInput');
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 150) + 'px';
    }
    
    async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        // التحقق من حجم الملف
        if (file.size > 10 * 1024 * 1024) {
            this.showNotification('حجم الملف يجب أن يكون أقل من 10MB', 'danger');
            return;
        }
        
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            const messageData = {
                content: file.name,
                room: this.currentRoom,
                type: this.isImageFile(file) ? 'image' : 'file',
                fileUrl: data.url,
                fileName: file.name,
                fileType: file.type,
                fileSize: file.size
            };
            
            this.socket.emit('sendMessage', messageData);
            
        } catch (error) {
            console.error('❌ خطأ في رفع الملف:', error);
            this.showNotification('خطأ في رفع الملف', 'danger');
        }
    }
    
    async handleImageUpload(event) {
        await this.handleFileUpload(event);
    }
    
    isImageFile(file) {
        return file.type.startsWith('image/');
    }
    
    extractMentions(text) {
        const mentionRegex = /@(\w+)/g;
        const mentions = [];
        let match;
        
        while ((match = mentionRegex.exec(text)) !== null) {
            // البحث عن المستخدم بالاسم
            const user = Array.from(this.activeUsers.values()).find(
                u => u.username.toLowerCase() === match[1].toLowerCase()
            );
            
            if (user) {
                mentions.push(user.id);
            }
        }
        
        return mentions;
    }
    
    updateTypingIndicator(data) {
        if (data.isTyping) {
            this.typingUsers.add(data.username);
        } else {
            this.typingUsers.delete(data.username);
        }
        
        const indicator = document.getElementById('typingIndicator');
        const text = document.getElementById('typingUsersText');
        
        if (this.typingUsers.size > 0) {
            const users = Array.from(this.typingUsers);
            text.textContent = `${users.join(' و ')} ${users.length === 1 ? 'يكتب الآن' : 'يكتبون الآن'}`;
            indicator.style.display = 'flex';
        } else {
            indicator.style.display = 'none';
        }
    }
    
    addMessage(message) {
        // إذا كانت الرسالة للغرفة الحالية
        if (message.room === this.currentRoom) {
            const messagesContainer = document.getElementById('messagesContainer');
            const messageElement = this.createMessageElement(message);
            messagesContainer.appendChild(messageElement);
            
            // التمرير للأسفل
            this.scrollToBottom();
            
            // تشغيل صوت الرسالة
            this.playSound('message');
        }
    }
    
    createMessageElement(message) {
        const isOutgoing = message.sender._id === this.currentUser.id;
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isOutgoing ? 'outgoing' : 'incoming'}`;
        messageDiv.dataset.messageId = message._id;
        
        let contentHtml = `
            <div class="message-avatar">
                <img src="${message.sender.avatar}" alt="${message.sender.username}">
            </div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-sender">${message.sender.username}</span>
                    <span class="message-time">${this.formatTime(message.createdAt)}</span>
                </div>
                <div class="message-text">${this.formatMessageContent(message.content)}</div>
        `;
        
        // إضافة الملف المرفق
        if (message.fileUrl) {
            if (message.type === 'image') {
                contentHtml += `
                    <div class="message-image">
                        <img src="${message.fileUrl}" alt="صورة" onclick="this.classList.toggle('zoomed')">
                    </div>
                `;
            } else {
                contentHtml += `
                    <div class="message-file">
                        <div class="file-icon">
                            <i class="fas fa-file"></i>
                        </div>
                        <div class="file-info">
                            <div class="file-name">${message.fileName}</div>
                            <div class="file-size">${this.formatFileSize(message.fileSize)}</div>
                        </div>
                        <a href="${message.fileUrl}" download class="download-file">
                            <i class="fas fa-download"></i>
                        </a>
                    </div>
                `;
            }
        }
        
        // إضافة الرد
        if (message.replyTo) {
            contentHtml += `
                <div class="message-reply">
                    <div class="reply-sender">${message.replyTo.sender.username}</div>
                    <div class="reply-text">${message.replyTo.content.substring(0, 50)}...</div>
                </div>
            `;
        }
        
        // إضافة الإعجابات
        contentHtml += `
            <div class="message-likes">
                <button class="like-btn ${message.likes.includes(this.currentUser.id) ? 'liked' : ''}" 
                        onclick="circlChat.likeMessage('${message._id}')">
                    <i class="fas fa-heart"></i>
                </button>
                <span>${message.likes.length}</span>
            </div>
            
            <div class="message-actions">
                <button class="message-action-btn" onclick="circlChat.replyToMessage('${message._id}')">
                    <i class="fas fa-reply"></i>
                </button>
                <button class="message-action-btn" onclick="circlChat.copyMessage('${message._id}')">
                    <i class="fas fa-copy"></i>
                </button>
            </div>
        `;
        
        messageDiv.innerHTML = contentHtml + '</div>';
        return messageDiv;
    }
    
    formatMessageContent(content) {
        // تحويل الروابط
        content = content.replace(
            /(https?:\/\/[^\s]+)/g,
            '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
        );
        
        // تحويل المذكرات
        content = content.replace(
            /@(\w+)/g,
            '<span class="mention">@$1</span>'
        );
        
        // تحويل الرموز التعبيرية
        content = twemoji.parse(content);
        
        return content;
    }
    
    likeMessage(messageId) {
        this.socket.emit('likeMessage', messageId);
    }
    
    replyToMessage(messageId) {
        const message = this.messages.find(m => m._id === messageId);
        if (!message) return;
        
        const preview = document.getElementById('replyPreview');
        preview.innerHTML = `
            <div class="reply-info">
                <div class="reply-sender">رد على ${message.sender.username}</div>
                <div class="reply-text">${message.content.substring(0, 100)}</div>
            </div>
            <button class="cancel-reply" onclick="circlChat.cancelReply()">
                <i class="fas fa-times"></i>
            </button>
        `;
        preview.style.display = 'block';
        
        this.replyTo = messageId;
    }
    
    cancelReply() {
        document.getElementById('replyPreview').style.display = 'none';
        this.replyTo = null;
    }
    
    startCall(type) {
        this.currentCall = {
            type: type,
            room: this.currentRoom,
            participants: [this.currentUser.id]
        };
        
        this.socket.emit('startCall', this.currentCall);
        
        // إظهار نافذة المكالمة
        this.showCallWindow();
    }
    
    async showCallWindow() {
        const callWindow = document.getElementById('callWindow');
        callWindow.classList.remove('hidden');
        
        try {
            // الحصول على الصوت/الفيديو
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: this.currentCall.type === 'video'
            });
            
            // إضافة الدفق المحلي
            this.addLocalVideoStream();
            
        } catch (error) {
            console.error('❌ خطأ في الوصول إلى الوسائط:', error);
            this.showNotification('تعذر الوصول إلى الكاميرا/الميكروفون', 'danger');
        }
    }
    
    addLocalVideoStream() {
        const participants = document.getElementById('callParticipants');
        const participantDiv = document.createElement('div');
        participantDiv.className = 'participant local';
        participantDiv.innerHTML = `
            <video class="participant-video" autoplay muted></video>
            <div class="participant-info">
                <div class="participant-avatar">
                    <img src="${this.currentUser.avatar}" alt="${this.currentUser.username}">
                </div>
                <div class="participant-name">${this.currentUser.username} (أنت)</div>
            </div>
        `;
        
        participants.appendChild(participantDiv);
        
        const videoElement = participantDiv.querySelector('video');
        videoElement.srcObject = this.localStream;
    }
    
    endCall() {
        if (this.currentCall) {
            this.socket.emit('endCall', this.currentCall.id);
            this.cleanupCall();
        }
    }
    
    cleanupCall() {
        // إيقاف جميع التدفقات
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        
        // إغلاق اتصالات WebRTC
        this.peerConnections.forEach(pc => pc.close());
        this.peerConnections.clear();
        
        // إيقاف مؤقت المكالمة
        if (this.callInterval) {
            clearInterval(this.callInterval);
            this.callInterval = null;
        }
        
        // إخفاء نافذة المكالمة
        document.getElementById('callWindow').classList.add('hidden');
        this.currentCall = null;
    }
    
    toggleTheme() {
        this.isDarkTheme = !this.isDarkTheme;
        const theme = this.isDarkTheme ? 'dark' : 'light';
        this.applyTheme(theme);
        this.saveTheme(theme);
    }
    
    changeTheme(theme) {
        this.isDarkTheme = theme === 'dark';
        this.applyTheme(theme);
        this.saveTheme(theme);
    }
    
    applyTheme(theme) {
        document.body.className = theme + '-theme';
    }
    
    saveTheme(theme) {
        localStorage.setItem('circl-theme', theme);
    }
    
    loadTheme() {
        const savedTheme = localStorage.getItem('circl-theme') || 'dark';
        this.isDarkTheme = savedTheme === 'dark';
        this.applyTheme(savedTheme);
        document.getElementById('themeSelect').value = savedTheme;
    }
    
    generateAvatars() {
        const grid = document.getElementById('avatarGrid');
        const avatars = [];
        
        for (let i = 1; i <= 12; i++) {
            const seed = `user${i}`;
            avatars.push(`
                <div class="avatar-option ${i === 1 ? 'selected' : ''}" data-avatar="${i}">
                    <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}" alt="صورة ${i}">
                </div>
            `);
        }
        
        grid.innerHTML = avatars.join('');
        
        // اختيار الصورة الشخصية
        grid.querySelectorAll('.avatar-option').forEach(option => {
            option.addEventListener('click', () => {
                grid.querySelectorAll('.avatar-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            });
        });
    }
    
    setupEmojiPicker() {
        const picker = new EmojiMart.Picker({
            onEmojiSelect: (emoji) => {
                const input = document.getElementById('messageInput');
                input.value += emoji.native;
                input.focus();
            },
            theme: this.isDarkTheme ? 'dark' : 'light',
            locale: 'ar',
            previewPosition: 'none',
            skinTonePosition: 'none'
        });
        
        document.getElementById('emojiPicker').appendChild(picker);
    }
    
    setupVoiceRecorder() {
        // إعداد مسجل الصوت
        // سيتم إضافة المنطق هنا
    }
    
    toggleEmojiPicker(event) {
        const picker = document.getElementById('emojiPicker');
        picker.classList.toggle('hidden');
        
        if (!picker.classList.contains('hidden')) {
            const rect = event.target.getBoundingClientRect();
            picker.style.bottom = `${window.innerHeight - rect.top + 10}px`;
            picker.style.right = `${window.innerWidth - rect.right}px`;
        }
    }
    
    showNotification(message, type = 'info') {
        const container = document.getElementById('notificationsContainer');
        const id = Date.now();
        
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div class="notification-header">
                <div class="notification-title">Circl Chat</div>
                <div class="notification-time">الآن</div>
            </div>
            <div class="notification-body">${message}</div>
        `;
        
        container.appendChild(notification);
        
        // إزالة الإشعار بعد 5 ثوانٍ
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.opacity = '0';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }
        }, 5000);
        
        // تشغيل الصوت
        this.playSound('notification');
    }
    
    playSound(type) {
        const audio = document.getElementById(`${type}Sound`);
        if (audio) {
            audio.currentTime = 0;
            audio.play().catch(console.error);
        }
    }
    
    formatTime(dateString) {
        const date = new Date(dateString);
        return date.toLocaleTimeString('ar-EG', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
    
    scrollToBottom() {
        const container = document.getElementById('messagesContainer');
        container.scrollTop = container.scrollHeight;
    }
    
    toggleSidebar() {
        document.getElementById('mainSidebar').classList.toggle('active');
    }
    
    logout() {
        if (confirm('هل تريد تسجيل الخروج؟')) {
            this.socket.disconnect();
            location.reload();
        }
    }
    
    searchMessages(query) {
        // منطق البحث سيتم إضافته هنا
    }
}

// تشغيل التطبيق عند تحميل الصفحة
window.addEventListener('DOMContentLoaded', () => {
    window.circlChat = new CirclChat();
});

// دعم الأموجي
window.twemoji = {
    parse: function(text) {
        return text.replace(/:(\w+):/g, (match, emoji) => {
            // تحويل الرموز النصية إلى رموز تعبيرية
            const emojiMap = {
                'smile': '😊',
                'heart': '❤️',
                'laugh': '😂',
                'wink': '😉',
                'cool': '😎',
                'cry': '😢',
                'angry': '😠',
                'thumbsup': '👍',
                'thumbsdown': '👎',
                'fire': '🔥',
                'star': '⭐'
            };
            
            return emojiMap[emoji] || match;
        });
    }
};