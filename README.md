# 📡 WA Broadcast Pro

Professional WhatsApp Broadcast Tool — Send messages to state-wise groups instantly.

---

## 🚀 Features
- Send text, images, videos, documents to all groups at once
- State-wise group management
- Schedule messages (one-time or recurring)
- Message templates
- Contact import via CSV
- Live send progress
- Full history & reports
- PWA — Install on Android like a native app
- Auto-reconnect WhatsApp session

---

## 📋 Setup Guide

### Step 1 — Clone & Install
```bash
git clone https://github.com/YOUR_USERNAME/whatsapp-tool.git
cd whatsapp-tool
npm install
```

### Step 2 — Configure .env
Create a `.env` file:
```env
PORT=3000
SESSION_SECRET=change_this_to_random_string
ADMIN_PASSWORD=your_secure_password
MESSAGE_DELAY=10000
```

### Step 3 — Run Locally
```bash
npm start
```
Open: http://localhost:3000

### Step 4 — Deploy to Render.com
1. Push code to GitHub
2. Go to render.com → New Web Service
3. Connect GitHub repo
4. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
5. Add Environment Variables (same as .env)
6. Deploy!

### Step 5 — Keep Alive (UptimeRobot)
1. Go to uptimerobot.com (free)
2. Add Monitor → HTTP(S)
3. URL: `https://your-app.onrender.com/health`
4. Interval: 5 minutes
5. Done — app stays awake 24/7

### Step 6 — Install PWA on Android
1. Open app URL in Chrome on father's phone
2. Tap ⋮ menu → "Add to Home Screen"
3. App icon appears on home screen ✅

---

## 📱 First Time Use
1. Open app → Enter password
2. WhatsApp QR appears → Scan with WhatsApp Business
3. Go to Groups → Sync from WA
4. Start broadcasting!

---

## ⚠️ Safety Tips
- Keep message delay at 10+ seconds
- Don't send more than 50 groups per session
- Avoid sending same message multiple times daily

---

## 📁 CSV Import Format
```
Name, Phone, State, GroupID
Ramesh Sharma, 919876543210, Rajasthan, 1
Suresh Patel, 919812345678, Gujarat, 2
```

---

## 🛠️ Tech Stack
- Node.js + Express
- @whiskeysockets/baileys (WhatsApp)
- SQLite (better-sqlite3)
- Socket.io (real-time)
- node-cron (scheduling)
- PWA (Android app)
