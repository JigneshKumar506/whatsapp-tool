const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../data/app.db');
const DATA_DIR = path.join(__dirname, '../data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let db;

async function initDatabase() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();

  // Load existing DB or create new
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Save DB to disk helper
  global.saveDB = () => {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  };

  // Auto-save every 30 seconds
  setInterval(global.saveDB, 30000);

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      state TEXT NOT NULL,
      whatsapp_id TEXT UNIQUE,
      member_count INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      tag TEXT DEFAULT 'general',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      group_id INTEGER,
      state TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      media_path TEXT,
      media_type TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      media_path TEXT,
      media_type TEXT,
      target_groups TEXT NOT NULL,
      sent_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      failed_groups TEXT,
      status TEXT DEFAULT 'pending',
      sent_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS scheduled_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      media_path TEXT,
      media_type TEXT,
      target_groups TEXT NOT NULL,
      schedule_time TEXT NOT NULL,
      is_recurring INTEGER DEFAULT 0,
      recurring_type TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Default settings
  db.run(`INSERT OR IGNORE INTO settings (key,value) VALUES ('message_delay','10000')`);
  db.run(`INSERT OR IGNORE INTO settings (key,value) VALUES ('daily_limit','200')`);
  db.run(`INSERT OR IGNORE INTO settings (key,value) VALUES ('auto_reconnect','true')`);
  global.saveDB();
  console.log('✅ Database ready');
}

// Helper: run query and return rows as objects
function query(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  } catch (e) { console.error('DB query error:', e.message, sql); return []; }
}

function queryOne(sql, params = []) {
  return query(sql, params)[0] || null;
}

function run(sql, params = []) {
  try {
    db.run(sql, params);
    global.saveDB();
    return { lastInsertRowid: db.exec('SELECT last_insert_rowid()')[0]?.values[0][0] };
  } catch (e) { console.error('DB run error:', e.message, sql); return {}; }
}

// ===== GROUPS =====
const groupsDb = {
  getAll: () => query('SELECT * FROM groups ORDER BY state, name'),
  getActive: () => query('SELECT * FROM groups WHERE is_active=1 ORDER BY state, name'),
  getById: (id) => queryOne('SELECT * FROM groups WHERE id=?', [id]),
  getByWhatsappId: (wid) => queryOne('SELECT * FROM groups WHERE whatsapp_id=?', [wid]),
  create: (d) => run('INSERT OR IGNORE INTO groups (name,state,whatsapp_id,member_count,tag) VALUES (?,?,?,?,?)',
    [d.name, d.state, d.whatsapp_id||null, d.member_count||0, d.tag||'general']),
  update: (id, d) => run('UPDATE groups SET name=?,state=?,is_active=?,tag=?,member_count=?,updated_at=datetime("now") WHERE id=?',
    [d.name, d.state, d.is_active, d.tag, d.member_count, id]),
  updateWhatsappId: (id, wid, mc) => run('UPDATE groups SET whatsapp_id=?,member_count=?,updated_at=datetime("now") WHERE id=?', [wid, mc, id]),
  toggleActive: (id) => run('UPDATE groups SET is_active=CASE WHEN is_active=1 THEN 0 ELSE 1 END WHERE id=?', [id]),
  delete: (id) => run('DELETE FROM groups WHERE id=?', [id]),
  getStats: () => queryOne('SELECT COUNT(*) as total, SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) as active, SUM(member_count) as total_members FROM groups')
};

// ===== CONTACTS =====
const contactsDb = {
  getAll: () => query('SELECT * FROM contacts ORDER BY state, name'),
  getByGroup: (gid) => query('SELECT * FROM contacts WHERE group_id=?', [gid]),
  create: (d) => run('INSERT OR IGNORE INTO contacts (name,phone,group_id,state) VALUES (?,?,?,?)',
    [d.name, d.phone, d.group_id||null, d.state||'Other']),
  bulkCreate: (contacts) => {
    contacts.forEach(c => run('INSERT OR IGNORE INTO contacts (name,phone,group_id,state) VALUES (?,?,?,?)',
      [c.name, c.phone, c.group_id||null, c.state||'Other']));
  },
  delete: (id) => run('DELETE FROM contacts WHERE id=?', [id]),
  getStats: () => queryOne('SELECT COUNT(*) as total FROM contacts')
};

// ===== TEMPLATES =====
const templatesDb = {
  getAll: () => query('SELECT * FROM templates ORDER BY created_at DESC'),
  getById: (id) => queryOne('SELECT * FROM templates WHERE id=?', [id]),
  create: (d) => run('INSERT INTO templates (title,content,media_path,media_type) VALUES (?,?,?,?)',
    [d.title, d.content, d.media_path||null, d.media_type||null]),
  update: (id, d) => run('UPDATE templates SET title=?,content=?,media_path=?,media_type=?,updated_at=datetime("now") WHERE id=?',
    [d.title, d.content, d.media_path||null, d.media_type||null, id]),
  delete: (id) => run('DELETE FROM templates WHERE id=?', [id])
};

// ===== MESSAGES =====
const messagesDb = {
  getAll: (limit=50) => query('SELECT * FROM messages ORDER BY sent_at DESC LIMIT ?', [limit]),
  getById: (id) => queryOne('SELECT * FROM messages WHERE id=?', [id]),
  create: (d) => run('INSERT INTO messages (content,media_path,media_type,target_groups,status) VALUES (?,?,?,?,?)',
    [d.content||'', d.media_path||null, d.media_type||null, JSON.stringify(d.target_groups||[]), d.status||'sending']),
  update: (id, d) => run('UPDATE messages SET sent_count=?,failed_count=?,failed_groups=?,status=? WHERE id=?',
    [d.sent_count, d.failed_count, JSON.stringify(d.failed_groups||[]), d.status, id]),
  getStats: () => queryOne(`SELECT COUNT(*) as total, SUM(sent_count) as total_sent, SUM(failed_count) as total_failed,
    COUNT(CASE WHEN DATE(sent_at)=DATE('now') THEN 1 END) as today FROM messages`)
};

// ===== SCHEDULED =====
const scheduledDb = {
  getAll: () => query("SELECT * FROM scheduled_messages WHERE status='pending' ORDER BY schedule_time"),
  getById: (id) => queryOne('SELECT * FROM scheduled_messages WHERE id=?', [id]),
  getPending: () => query("SELECT * FROM scheduled_messages WHERE status='pending' AND schedule_time<=datetime('now')"),
  create: (d) => run('INSERT INTO scheduled_messages (content,media_path,media_type,target_groups,schedule_time,is_recurring,recurring_type) VALUES (?,?,?,?,?,?,?)',
    [d.content||'', d.media_path||null, d.media_type||null, JSON.stringify(d.target_groups||[]),
     d.schedule_time, d.is_recurring?1:0, d.recurring_type||null]),
  updateStatus: (id, status) => run('UPDATE scheduled_messages SET status=? WHERE id=?', [status, id]),
  delete: (id) => run('DELETE FROM scheduled_messages WHERE id=?', [id])
};

// ===== SETTINGS =====
const settingsDb = {
  get: (key) => { const r = queryOne('SELECT value FROM settings WHERE key=?', [key]); return r?.value||null; },
  set: (key, value) => run('INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,datetime("now"))', [key, value]),
  getAll: () => { const rows = query('SELECT key,value FROM settings'); return rows.reduce((a,r)=>({...a,[r.key]:r.value}),{}); }
};

module.exports = { initDatabase, groupsDb, contactsDb, templatesDb, messagesDb, scheduledDb, settingsDb };
