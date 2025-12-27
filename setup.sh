#!/bin/bash

echo "========================================"
echo "   تشغيل Circl Chat Pro على Linux/Mac"
echo "========================================"
echo

echo "1. التحقق من تثبيت Node.js..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js غير مثبت!"
    echo "يرجى تثبيت Node.js من https://nodejs.org"
    exit 1
fi

echo "2. تثبيت التبعيات..."
npm install
if [ $? -ne 0 ]; then
    echo "❌ فشل تثبيت التبعيات!"
    exit 1
fi

echo "3. إنشاء مجلدات التخزين..."
mkdir -p uploads/images uploads/files uploads/audio

echo "4. منح الصلاحيات..."
chmod -R 755 uploads

echo "5. تشغيل التطبيق..."
echo
echo "✅ جاهز للتشغيل!"
echo "🌐 افتح المتصفح على: http://localhost:3000"
echo "🛑 لإيقاف التطبيق: اضغط Ctrl+C"
echo

read -p "اضغط Enter للبدء..." -n1 -s
echo

node server.js