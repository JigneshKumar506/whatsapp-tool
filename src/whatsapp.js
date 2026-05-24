const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, makeInMemoryStore } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode');

const AUTH_PATH = path.join(__dirname, '../data/auth');
const logger = pino({ level: 'silent' });

let sock = null;
let io = null;
let connectionState = 'disconnected';
let qrCodeData = null;
let reconnectTimer = null;
let isConnecting = false;

// Ensure auth directory exists
if (!fs.existsSync(AUTH_PATH)) {
  fs.mkdirSync(AUTH_PATH, { recursive: true });
}

function setIO(socketIO) {
  io = socketIO;
}

function emit(event, data) {
  if (io) io.emit(event, data);
}

function getState() {
  return {
    status: connectionState,
    qr: qrCodeData,
    connected: connectionState === 'connected'
  };
}

async function connectWhatsApp() {
  if (isConnecting) return;
  isConnecting = true;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_PATH);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      logger,
      printQRInTerminal: false,
      auth: state,
      browser: ['WA Broadcast Pro', 'Chrome', '120.0.0'],
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 30000,
      keepAliveIntervalMs: 25000,
      retryRequestDelayMs: 2000,
      maxMsgRetryCount: 5,
      generateHighQualityLinkPreview: true,
    });

    // Save credentials on update
    sock.ev.on('creds.update', saveCreds);

    // Handle connection updates
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCodeData = await qrcode.toDataURL(qr);
        connectionState = 'qr';
        emit('connection-update', { status: 'qr', qr: qrCodeData });
        console.log('📱 QR Code generated — scan with WhatsApp Business');
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        connectionState = 'disconnected';
        qrCodeData = null;
        emit('connection-update', { status: 'disconnected', code: statusCode });
        console.log(`❌ WhatsApp disconnected (code: ${statusCode})`);

        isConnecting = false;

        if (shouldReconnect) {
          console.log('🔄 Reconnecting in 5 seconds...');
          reconnectTimer = setTimeout(() => connectWhatsApp(), 5000);
        } else {
          // Logged out — clear auth
          console.log('🚪 Logged out — clearing session');
          clearAuthData();
        }
      }

      if (connection === 'open') {
        connectionState = 'connected';
        qrCodeData = null;
        isConnecting = false;
        const user = sock.user;
        emit('connection-update', { 
          status: 'connected', 
          user: { name: user?.name, phone: user?.id?.split(':')[0] }
        });
        console.log(`✅ WhatsApp connected as ${user?.name}`);
      }

      if (connection === 'connecting') {
        connectionState = 'connecting';
        emit('connection-update', { status: 'connecting' });
      }
    });

    isConnecting = false;
  } catch (err) {
    console.error('WhatsApp connection error:', err.message);
    isConnecting = false;
    connectionState = 'error';
    emit('connection-update', { status: 'error', message: err.message });
    setTimeout(() => connectWhatsApp(), 10000);
  }
}

function clearAuthData() {
  try {
    if (fs.existsSync(AUTH_PATH)) {
      fs.rmSync(AUTH_PATH, { recursive: true });
      fs.mkdirSync(AUTH_PATH, { recursive: true });
    }
    connectionState = 'disconnected';
  } catch (err) {
    console.error('Error clearing auth data:', err.message);
  }
}

async function logout() {
  try {
    if (sock) {
      await sock.logout();
      sock = null;
    }
    clearAuthData();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    connectionState = 'disconnected';
    emit('connection-update', { status: 'disconnected' });
    return { success: true };
  } catch (err) {
    clearAuthData();
    return { success: false, error: err.message };
  }
}

async function getAllGroups() {
  if (!sock || connectionState !== 'connected') {
    throw new Error('WhatsApp not connected');
  }
  try {
    const chats = await sock.groupFetchAllParticipating();
    const groups = Object.values(chats).map(g => ({
      id: g.id,
      name: g.subject,
      memberCount: g.participants?.length || 0,
      description: g.desc || ''
    }));
    return groups;
  } catch (err) {
    throw new Error('Failed to fetch groups: ' + err.message);
  }
}

async function sendTextMessage(groupId, text) {
  if (!sock || connectionState !== 'connected') {
    throw new Error('WhatsApp not connected');
  }
  await sock.sendMessage(groupId, { text });
}

async function sendMediaMessage(groupId, mediaBuffer, mediaType, filename, caption) {
  if (!sock || connectionState !== 'connected') {
    throw new Error('WhatsApp not connected');
  }

  let messageContent = {};

  if (mediaType.startsWith('image/')) {
    messageContent = {
      image: mediaBuffer,
      caption: caption || '',
      mimetype: mediaType
    };
  } else if (mediaType.startsWith('video/')) {
    messageContent = {
      video: mediaBuffer,
      caption: caption || '',
      mimetype: mediaType
    };
  } else if (mediaType.startsWith('audio/')) {
    messageContent = {
      audio: mediaBuffer,
      mimetype: mediaType,
      ptt: false
    };
  } else {
    messageContent = {
      document: mediaBuffer,
      mimetype: mediaType,
      fileName: filename || 'file',
      caption: caption || ''
    };
  }

  await sock.sendMessage(groupId, messageContent);
}

async function sendToGroups(groups, message, mediaPath, mediaType, onProgress) {
  const delay = parseInt(process.env.MESSAGE_DELAY || '10000');
  const results = { sent: [], failed: [] };

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    try {
      if (mediaPath && fs.existsSync(mediaPath)) {
        const mediaBuffer = fs.readFileSync(mediaPath);
        const filename = path.basename(mediaPath);
        await sendMediaMessage(group.whatsapp_id, mediaBuffer, mediaType, filename, message);
      } else {
        await sendTextMessage(group.whatsapp_id, message);
      }

      results.sent.push(group.id);
      if (onProgress) onProgress(i + 1, groups.length, group, 'success');
      console.log(`✅ Sent to: ${group.name}`);

    } catch (err) {
      results.failed.push({ id: group.id, name: group.name, error: err.message });
      if (onProgress) onProgress(i + 1, groups.length, group, 'failed');
      console.error(`❌ Failed: ${group.name} — ${err.message}`);
    }

    // Delay between messages (skip delay after last message)
    if (i < groups.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return results;
}

module.exports = {
  connectWhatsApp,
  setIO,
  getState,
  getAllGroups,
  sendToGroups,
  logout,
  clearAuthData,
  getSocket: () => sock
};
