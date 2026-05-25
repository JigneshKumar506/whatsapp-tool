// routes/index.js — All API routes combined
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { groupsDb, contactsDb, templatesDb, messagesDb, scheduledDb, settingsDb } = require('./database');
const { getState, getAllGroups, sendToGroups, logout } = require('./whatsapp');
const mime = require('mime-types');

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 64 * 1024 * 1024 } // 64MB max
});

// ==================== AUTH ====================
router.post('/auth/login', (req, res) => {
  const { password } = req.body;
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
  if (password === adminPass) {
    req.session.authenticated = true;
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Invalid password' });
});

router.post('/auth/logout-app', requireAuth, (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

router.get('/auth/status', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

// ==================== WHATSAPP ====================
router.get('/wa/status', requireAuth, (req, res) => {
  res.json(getState());
});

router.post('/wa/logout', requireAuth, async (req, res) => {
  const result = await logout();
  res.json(result);
});

router.get('/wa/groups/fetch', requireAuth, async (req, res) => {
  try {
    const groups = await getAllGroups();
    res.json({ success: true, groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== GROUPS ====================
router.get('/groups', requireAuth, (req, res) => {
  const groups = groupsDb.getAll();
  const stats = groupsDb.getStats();
  res.json({ groups, stats });
});

router.post('/groups', requireAuth, (req, res) => {
  try {
    const result = groupsDb.create(req.body);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/groups/:id', requireAuth, (req, res) => {
  groupsDb.update(req.params.id, req.body);
  res.json({ success: true });
});

router.delete('/groups/:id', requireAuth, (req, res) => {
  groupsDb.delete(req.params.id);
  res.json({ success: true });
});

router.patch('/groups/:id/toggle', requireAuth, (req, res) => {
  groupsDb.toggleActive(req.params.id);
  res.json({ success: true });
});

// Sync groups from WhatsApp
router.post('/groups/sync', requireAuth, async (req, res) => {
  try {
    const waGroups = await getAllGroups();
    const dbGroups = groupsDb.getAll();
    const existingIds = new Set(dbGroups.map(g => g.whatsapp_id));
    
    let added = 0;
    for (const wg of waGroups) {
      if (!existingIds.has(wg.id)) {
        groupsDb.create({
          name: wg.name,
          state: extractState(wg.name),
          whatsapp_id: wg.id,
          member_count: wg.memberCount
        });
        added++;
      } else {
        const dbGroup = dbGroups.find(g => g.whatsapp_id === wg.id);
        if (dbGroup) {
          groupsDb.updateWhatsappId(dbGroup.id, wg.id, wg.memberCount);
        }
      }
    }
    res.json({ success: true, added, total: waGroups.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function extractState(groupName) {
  const states = [
    'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
    'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
    'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
    'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
    'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
    'Delhi', 'Jammu', 'Kashmir', 'Ladakh', 'Chandigarh', 'Puducherry'
  ];
  const lower = groupName.toLowerCase();
  const found = states.find(s => lower.includes(s.toLowerCase()));
  return found || 'Other';
}

// ==================== CONTACTS ====================
router.get('/contacts', requireAuth, (req, res) => {
  const contacts = contactsDb.getAll();
  const stats = contactsDb.getStats();
  res.json({ contacts, stats });
});

router.post('/contacts', requireAuth, (req, res) => {
  try {
    const result = contactsDb.create(req.body);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/contacts/bulk', requireAuth, upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const content = fs.readFileSync(req.file.path, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const contacts = [];
    
    for (let i = 1; i < lines.length; i++) { // Skip header
      const parts = lines[i].split(',').map(p => p.trim().replace(/"/g, ''));
      if (parts.length >= 2) {
        contacts.push({
          name: parts[0],
          phone: parts[1].replace(/[^0-9]/g, ''),
          state: parts[2] || 'Other',
          group_id: parts[3] ? parseInt(parts[3]) : null
        });
      }
    }
    
    contactsDb.bulkCreate(contacts);
    fs.unlinkSync(req.file.path);
    res.json({ success: true, imported: contacts.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/contacts/:id', requireAuth, (req, res) => {
  contactsDb.delete(req.params.id);
  res.json({ success: true });
});

// ==================== TEMPLATES ====================
router.get('/templates', requireAuth, (req, res) => {
  res.json(templatesDb.getAll());
});

router.post('/templates', requireAuth, upload.single('media'), (req, res) => {
  try {
    const data = {
      title: req.body.title,
      content: req.body.content,
      media_path: req.file ? req.file.path : null,
      media_type: req.file ? req.file.mimetype : null
    };
    const result = templatesDb.create(data);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/templates/:id', requireAuth, upload.single('media'), (req, res) => {
  const existing = templatesDb.getById(req.params.id);
  const data = {
    title: req.body.title,
    content: req.body.content,
    media_path: req.file ? req.file.path : existing?.media_path,
    media_type: req.file ? req.file.mimetype : existing?.media_type
  };
  templatesDb.update(req.params.id, data);
  res.json({ success: true });
});

router.delete('/templates/:id', requireAuth, (req, res) => {
  templatesDb.delete(req.params.id);
  res.json({ success: true });
});

// ==================== SEND MESSAGES ====================
let isSending = false;
let sendIO = null;

function setSendIO(io) { sendIO = io; }

router.post('/send', requireAuth, upload.single('media'), async (req, res) => {
  if (isSending) return res.status(429).json({ error: 'Already sending messages, please wait' });

  try {
    const { message, groupIds, sendAll } = req.body;
    if (!message && !req.file) return res.status(400).json({ error: 'Message or media required' });

    let groups;
    if (sendAll === 'true' || sendAll === true) {
      groups = groupsDb.getActive();
    } else {
      const ids = JSON.parse(groupIds || '[]');
      groups = ids.map(id => groupsDb.getById(id)).filter(g => g && g.whatsapp_id);
    }

    if (groups.length === 0) return res.status(400).json({ error: 'No valid groups selected' });

    const mediaPath = req.file ? req.file.path : null;
    const mediaType = req.file ? req.file.mimetype : null;

    // Respond immediately
    res.json({ success: true, total: groups.length, message: 'Sending started' });

    // Send in background
    isSending = true;
    const msgRecord = messagesDb.create({
      content: message || '',
      media_path: mediaPath,
      media_type: mediaType,
      target_groups: groups.map(g => g.id),
      status: 'sending'
    });

    if (sendIO) sendIO.emit('send-start', { total: groups.length });

    const results = await sendToGroups(groups, message || '', mediaPath, mediaType, (current, total, group, status) => {
      if (sendIO) sendIO.emit('send-progress', { current, total, group: group.name, status });
    });

    messagesDb.update(msgRecord.lastInsertRowid, {
      sent_count: results.sent.length,
      failed_count: results.failed.length,
      failed_groups: results.failed,
      status: 'completed'
    });

    if (sendIO) sendIO.emit('send-complete', {
      sent: results.sent.length,
      failed: results.failed.length,
      failedGroups: results.failed
    });

    isSending = false;
  } catch (err) {
    isSending = false;
    console.error('Send error:', err.message);
    if (sendIO) sendIO.emit('send-error', { error: err.message });
  }
});

// ==================== SCHEDULE ====================
router.get('/schedule', requireAuth, (req, res) => {
  res.json(scheduledDb.getAll());
});

router.post('/schedule', requireAuth, upload.single('media'), (req, res) => {
  try {
    const { message, groupIds, sendAll, scheduleTime, isRecurring, recurringType } = req.body;
    const targetGroups = sendAll === 'true' ? ['all'] : JSON.parse(groupIds || '[]');
    
    const data = {
      content: message || '',
      media_path: req.file ? req.file.path : null,
      media_type: req.file ? req.file.mimetype : null,
      target_groups: targetGroups,
      schedule_time: scheduleTime,
      is_recurring: isRecurring === 'true',
      recurring_type: recurringType || null
    };
    
    const result = scheduledDb.create(data);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/schedule/:id', requireAuth, (req, res) => {
  scheduledDb.delete(req.params.id);
  res.json({ success: true });
});

// ==================== HISTORY ====================
router.get('/history', requireAuth, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const messages = messagesDb.getAll(limit);
  const stats = messagesDb.getStats();
  res.json({ messages, stats });
});

// ==================== SETTINGS ====================
router.get('/settings', requireAuth, (req, res) => {
  res.json(settingsDb.getAll());
});

router.put('/settings', requireAuth, (req, res) => {
  const { key, value } = req.body;
  settingsDb.set(key, value);
  if (key === 'message_delay') process.env.MESSAGE_DELAY = value;
  res.json({ success: true });
});

// ==================== DASHBOARD STATS ====================
router.get('/dashboard', requireAuth, (req, res) => {
  const groupStats = groupsDb.getStats();
  const contactStats = contactsDb.getStats();
  const messageStats = messagesDb.getStats();
  const scheduled = scheduledDb.getAll().length;
  res.json({
    groups: groupStats,
    contacts: contactStats,
    messages: messageStats,
    scheduled
  });
});

module.exports = { router, setSendIO };

// ==================== GROUP CREATION FROM CSV ====================
const { createGroupsFromCSVs } = require('./groupCreator');

let isCreatingGroups = false;

router.post('/groups/create-from-csv', requireAuth, upload.array('csvFiles', 20), async (req, res) => {
  if (isCreatingGroups) return res.status(429).json({ error: 'Already creating groups, please wait' });
  if (!req.files?.length) return res.status(400).json({ error: 'No CSV files uploaded' });

  res.json({ success: true, message: 'Group creation started', total: req.files.length });

  isCreatingGroups = true;
  try {
    const results = await createGroupsFromCSVs(req.files, sendIO);
    console.log('Group creation complete:', results.length, 'groups');
  } catch (err) {
    console.error('Group creation error:', err.message);
    if (sendIO) sendIO.emit('group-creation-error', { error: err.message });
  } finally {
    isCreatingGroups = false;
    // Cleanup uploaded CSV files
    req.files.forEach(f => { try { require('fs').unlinkSync(f.path); } catch(e){} });
  }
});

// ==================== BROADCAST TO CONTACTS ====================
router.post('/broadcast-contacts', requireAuth, upload.single('media'), async (req, res) => {
  try {
    const contacts = JSON.parse(req.body.contacts || '[]');
    const message = req.body.message || '';
    if (!contacts.length) return res.status(400).json({ error: 'No contacts provided' });

    const mediaPath = req.file ? req.file.path : null;
    const mediaType = req.file ? req.file.mimetype : null;

    res.json({ success: true, total: contacts.length });

    if (sendIO) sendIO.emit('bc-start', { total: contacts.length });

    const delay = parseInt(process.env.MESSAGE_DELAY || '10000');
    let sent = 0, failed = 0;

    const { sendTextMessage, sendMediaMessage } = require('./whatsapp');
    const fs = require('fs');
    const path = require('path');

    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i];
      const jid = c.phone + '@s.whatsapp.net';
      try {
        if (mediaPath && fs.existsSync(mediaPath)) {
          const buf = fs.readFileSync(mediaPath);
          await sendMediaMessage(jid, buf, mediaType, path.basename(mediaPath), message);
        } else {
          await sendTextMessage(jid, message);
        }
        sent++;
        if (sendIO) sendIO.emit('bc-progress', { current: i+1, total: contacts.length, name: c.name, status: 'success' });
      } catch (e) {
        failed++;
        if (sendIO) sendIO.emit('bc-progress', { current: i+1, total: contacts.length, name: c.name, status: 'failed' });
      }
      if (i < contacts.length - 1) await new Promise(r => setTimeout(r, delay));
    }

    if (sendIO) sendIO.emit('bc-complete', { sent, failed });
    if (mediaPath) try { require('fs').unlinkSync(mediaPath); } catch(e) {}
  } catch (err) {
    if (sendIO) sendIO.emit('bc-error', { error: err.message });
  }
});
