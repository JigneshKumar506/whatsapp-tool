require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const cors = require('cors');
const path = require('path');

const { initDatabase } = require('./src/database');
const { connectWhatsApp, setIO: setWAIO } = require('./src/whatsapp');
const { startScheduler, setIO: setSchedulerIO } = require('./src/scheduler');
const { router, setSendIO } = require('./src/routes');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'wa_broadcast_secret',
  resave: false, saveUninitialized: false,
  cookie: { secure: false, maxAge: 7*24*60*60*1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api', router);
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

io.on('connection', (socket) => {
  const { getState } = require('./src/whatsapp');
  socket.emit('connection-update', getState());
  socket.on('disconnect', () => {});
});

setWAIO(io);
setSchedulerIO(io);
setSendIO(io);

async function start() {
  await initDatabase();
  server.listen(PORT, () => {
    console.log('');
    console.log('╔════════════════════════════════════╗');
    console.log('║    WA Broadcast Pro — Running!     ║');
    console.log(`║    http://localhost:${PORT}           ║`);
    console.log('╚════════════════════════════════════╝');
    console.log('');
  });
  connectWhatsApp();
  startScheduler();
}

start().catch(console.error);

process.on('uncaughtException', (err) => console.error('Uncaught:', err.message));
process.on('unhandledRejection', (r) => console.error('Unhandled:', r?.message || r));
