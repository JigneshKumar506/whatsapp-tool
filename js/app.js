// ===== WA BROADCAST PRO — FRONTEND APP =====

const socket = io();
let currentPage = 'dashboard';
let sendTarget = 'all';
let selectedGroups = [];
let allGroups = [];
let selectedMedia = null;
let waConnected = false;

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  const auth = await api('/auth/status');
  if (auth.authenticated) {
    showApp();
  } else {
    showScreen('login-screen');
  }

  document.getElementById('login-password').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') login();
  });

  document.getElementById('send-message').addEventListener('input', (e) => {
    document.getElementById('char-count').textContent = e.target.value.length + ' characters';
  });
});

// ===== SOCKET EVENTS =====
socket.on('connection-update', (data) => {
  updateWAStatus(data);
});

socket.on('send-start', (data) => {
  showProgress(data.total);
});

socket.on('send-progress', (data) => {
  updateProgress(data.current, data.total, data.group, data.status);
});

socket.on('send-complete', (data) => {
  hideProgress();
  toast(`✅ Done! Sent: ${data.sent}, Failed: ${data.failed}`, data.failed > 0 ? 'info' : 'success');
  loadDashboard();
  loadHistory();
});

socket.on('send-error', (data) => {
  hideProgress();
  toast('❌ Send error: ' + data.error, 'error');
});

socket.on('scheduled-sending-start', (data) => {
  toast(`⏰ Scheduled message sending to ${data.total} groups...`, 'info');
});

socket.on('scheduled-sending-done', (data) => {
  toast(`✅ Scheduled: Sent ${data.sent}, Failed ${data.failed}`, 'success');
  loadSchedule();
});

// ===== AUTH =====
async function login() {
  const pw = document.getElementById('login-password').value;
  const res = await api('/auth/login', 'POST', { password: pw });
  if (res.success) {
    showApp();
  } else {
    document.getElementById('login-error').classList.remove('hidden');
  }
}

async function logoutApp() {
  await api('/auth/logout-app', 'POST');
  showScreen('login-screen');
  document.getElementById('login-password').value = '';
}

// ===== SHOW APP =====
function showApp() {
  showScreen('app-screen');
  showPage('dashboard');
  loadAll();
}

function loadAll() {
  loadDashboard();
  loadGroups();
  loadTemplates();
}

// ===== WHATSAPP STATUS =====
function updateWAStatus(data) {
  const dot = document.getElementById('wa-dot');
  const label = document.getElementById('wa-status-label');
  const sub = document.getElementById('wa-status-sub');
  const qrBtn = document.getElementById('wa-qr-btn');
  const miniDot = document.getElementById('mini-dot');

  dot.className = 'wa-status-dot';
  miniDot.className = 'dot';

  if (data.status === 'connected') {
    dot.classList.add('connected');
    miniDot.classList.add('connected');
    label.textContent = data.user?.name || 'Connected';
    sub.textContent = data.user?.phone ? '+' + data.user.phone : 'WhatsApp Business';
    qrBtn.classList.add('hidden');
    waConnected = true;
  } else if (data.status === 'qr') {
    dot.classList.add('qr');
    label.textContent = 'Scan QR Code';
    sub.textContent = 'Tap QR to scan';
    qrBtn.classList.remove('hidden');
    waConnected = false;
    if (data.qr) {
      document.getElementById('qr-image').src = data.qr;
      document.getElementById('qr-overlay').classList.remove('hidden');
    }
  } else if (data.status === 'connecting') {
    dot.classList.add('connecting');
    miniDot.classList.add('connecting');
    label.textContent = 'Connecting...';
    sub.textContent = 'Please wait';
    waConnected = false;
  } else {
    label.textContent = 'Disconnected';
    sub.textContent = 'Reconnecting...';
    waConnected = false;
  }
}

function showQR() {
  document.getElementById('qr-overlay').classList.remove('hidden');
}

async function logoutWA() {
  confirm2('Logout WhatsApp?', 'This will disconnect WhatsApp. You will need to scan QR again.', async () => {
    await api('/wa/logout', 'POST');
    toast('WhatsApp logged out', 'info');
    closeModal();
  });
}

// ===== PAGES =====
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  document.getElementById('page-' + page)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.getAttribute('onclick')?.includes(`'${page}'`)) n.classList.add('active');
  });

  document.getElementById('page-title').textContent = {
    dashboard: 'Dashboard', send: 'Send Message', groups: 'Groups',
    contacts: 'Contacts', templates: 'Templates', schedule: 'Schedule',
    history: 'History & Reports', settings: 'Settings'
  }[page] || page;

  currentPage = page;

  // Load page data
  if (page === 'contacts') loadContacts();
  if (page === 'schedule') loadSchedule();
  if (page === 'history') loadHistory();
  if (page === 'settings') loadSettings();
  if (page === 'send') loadSendPage();

  // Close sidebar on mobile
  if (window.innerWidth < 768) toggleSidebar(false);
}

// ===== SIDEBAR =====
function toggleSidebar(force) {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const isOpen = sidebar.classList.contains('open');
  const open = force !== undefined ? force : !isOpen;
  sidebar.classList.toggle('open', open);
  overlay.classList.toggle('open', open);
}

// ===== DASHBOARD =====
async function loadDashboard() {
  const data = await api('/dashboard');
  if (!data) return;

  document.getElementById('stat-groups').textContent = data.groups?.active || 0;
  document.getElementById('stat-contacts').textContent = data.contacts?.total || 0;
  document.getElementById('stat-sent').textContent = data.messages?.total_sent || 0;
  document.getElementById('stat-scheduled').textContent = data.scheduled || 0;

  document.getElementById('groups-badge').textContent = data.groups?.total || 0;
  document.getElementById('contacts-badge').textContent = data.contacts?.total || 0;

  // Recent history
  const history = await api('/history?limit=5');
  const list = document.getElementById('recent-history');
  if (history?.messages?.length) {
    list.innerHTML = history.messages.map(m => `
      <div class="recent-item">
        <div class="recent-icon">${m.media_type ? '📎' : '💬'}</div>
        <div class="recent-info">
          <div class="recent-msg">${escHtml(m.content || '[Media]')}</div>
          <div class="recent-meta">${formatDate(m.sent_at)} · ${JSON.parse(m.target_groups || '[]').length} groups</div>
        </div>
        <span class="recent-status status-${m.status}">${m.status}</span>
      </div>
    `).join('');
  } else {
    list.innerHTML = '<div class="empty-state">No messages sent yet</div>';
  }
}

// ===== GROUPS =====
async function loadGroups() {
  const data = await api('/groups');
  if (!data) return;
  allGroups = data.groups || [];
  renderGroups(allGroups);
}

function renderGroups(groups) {
  const list = document.getElementById('groups-list');
  if (!groups.length) {
    list.innerHTML = '<div class="empty-state">No groups yet. Add groups or sync from WhatsApp.</div>';
    return;
  }
  list.innerHTML = groups.map(g => `
    <div class="group-item ${g.is_active ? '' : 'inactive'}" id="gi-${g.id}">
      <div class="group-avatar">🏛️</div>
      <div class="group-info">
        <div class="group-name">${escHtml(g.name)}</div>
        <div class="group-meta">
          <span>📍 ${g.state}</span>
          <span>👥 ${g.member_count} members</span>
          <span class="group-tag">${g.tag}</span>
          ${g.whatsapp_id ? '<span class="wa-linked">✓ WA Linked</span>' : '<span class="wa-unlinked">Not linked</span>'}
        </div>
      </div>
      <div class="group-actions">
        <button class="icon-btn toggle ${g.is_active ? '' : 'off'}" onclick="toggleGroup(${g.id})" title="${g.is_active ? 'Disable' : 'Enable'}">
          ${g.is_active ? '✓' : '○'}
        </button>
        <button class="icon-btn edit" onclick="editGroup(${g.id})" title="Edit">✏️</button>
        <button class="icon-btn delete" onclick="deleteGroup(${g.id})" title="Delete">🗑️</button>
      </div>
    </div>
  `).join('');
}

function filterGroups(q) {
  const filtered = allGroups.filter(g =>
    g.name.toLowerCase().includes(q.toLowerCase()) ||
    g.state.toLowerCase().includes(q.toLowerCase())
  );
  renderGroups(filtered);
}

async function toggleGroup(id) {
  await api(`/groups/${id}/toggle`, 'PATCH');
  loadGroups();
  toast('Group updated', 'success');
}

async function deleteGroup(id) {
  confirm2('Delete Group?', 'This will remove the group from your tool. WhatsApp group is not affected.', async () => {
    await api(`/groups/${id}`, 'DELETE');
    loadGroups();
    toast('Group deleted', 'info');
  });
}

function showAddGroupModal() {
  showModal('Add Group', `
    <label class="modal-label">Group Name</label>
    <input class="modal-input" id="g-name" placeholder="e.g. Rajasthan Business Network" />
    <label class="modal-label">State</label>
    <select class="modal-select" id="g-state">${indianStatesOptions()}</select>
    <label class="modal-label">Tag</label>
    <select class="modal-select" id="g-tag">
      <option value="general">General</option>
      <option value="priority">Priority</option>
      <option value="north">North India</option>
      <option value="south">South India</option>
      <option value="east">East India</option>
      <option value="west">West India</option>
    </select>
    <label class="modal-label">WhatsApp Group ID <span style="color:var(--text3);font-weight:400">(optional — from sync)</span></label>
    <input class="modal-input" id="g-wid" placeholder="123456789@g.us" />
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="saveGroup()">Add Group</button>
    </div>
  `);
}

async function editGroup(id) {
  const group = allGroups.find(g => g.id === id);
  if (!group) return;
  showModal('Edit Group', `
    <label class="modal-label">Group Name</label>
    <input class="modal-input" id="g-name" value="${escHtml(group.name)}" />
    <label class="modal-label">State</label>
    <select class="modal-select" id="g-state">${indianStatesOptions(group.state)}</select>
    <label class="modal-label">Tag</label>
    <select class="modal-select" id="g-tag">
      ${['general','priority','north','south','east','west'].map(t =>
        `<option value="${t}" ${group.tag===t?'selected':''}>${t.charAt(0).toUpperCase()+t.slice(1)}</option>`
      ).join('')}
    </select>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="updateGroup(${id})">Save Changes</button>
    </div>
  `);
}

async function saveGroup() {
  const data = {
    name: document.getElementById('g-name').value.trim(),
    state: document.getElementById('g-state').value,
    tag: document.getElementById('g-tag').value,
    whatsapp_id: document.getElementById('g-wid')?.value.trim() || null,
    is_active: 1, member_count: 0
  };
  if (!data.name) return toast('Group name required', 'error');
  const res = await api('/groups', 'POST', data);
  if (res.success) { closeModal(); loadGroups(); toast('Group added!', 'success'); }
}

async function updateGroup(id) {
  const group = allGroups.find(g => g.id === id);
  const data = {
    name: document.getElementById('g-name').value.trim(),
    state: document.getElementById('g-state').value,
    tag: document.getElementById('g-tag').value,
    is_active: group.is_active, member_count: group.member_count
  };
  await api(`/groups/${id}`, 'PUT', data);
  closeModal(); loadGroups(); toast('Group updated!', 'success');
}

async function syncGroups() {
  if (!waConnected) return toast('WhatsApp not connected', 'error');
  toast('🔄 Syncing groups from WhatsApp...', 'info');
  const res = await api('/groups/sync', 'POST');
  if (res.success) {
    loadGroups(); loadDashboard();
    toast(`✅ Synced! Added ${res.added} new groups (${res.total} total)`, 'success');
  } else {
    toast('Sync failed: ' + res.error, 'error');
  }
}

// ===== CONTACTS =====
async function loadContacts() {
  const data = await api('/contacts');
  if (!data) return;
  document.getElementById('contacts-stats').innerHTML = `
    <div class="contacts-stat-pill">👥 Total: ${data.stats?.total || 0}</div>
  `;
  const list = document.getElementById('contacts-list');
  if (!data.contacts?.length) {
    list.innerHTML = '<div class="empty-state">No contacts yet. Import from CSV.</div>';
    return;
  }
  list.innerHTML = data.contacts.slice(0, 100).map(c => `
    <div class="contact-item">
      <div class="contact-avatar">👤</div>
      <div class="contact-info">
        <div class="contact-name">${escHtml(c.name)}</div>
        <div class="contact-phone">+${c.phone}</div>
      </div>
      <span class="contact-state">${c.state || 'Other'}</span>
      <button class="icon-btn delete" onclick="deleteContact(${c.id})">🗑️</button>
    </div>
  `).join('') + (data.contacts.length > 100 ? `<div class="empty-state">Showing 100 of ${data.contacts.length} contacts</div>` : '');
}

async function deleteContact(id) {
  await api(`/contacts/${id}`, 'DELETE');
  loadContacts(); toast('Contact deleted', 'info');
}

function showImportModal() {
  showModal('Import Contacts from CSV', `
    <p style="color:var(--text2);font-size:13px;margin-bottom:16px;line-height:1.6">
      CSV format: <code style="background:var(--bg3);padding:2px 6px;border-radius:4px;color:var(--green)">Name, Phone, State, GroupID</code><br/>
      First row should be header. Phone without country code (auto-added).
    </p>
    <label class="modal-label">Select CSV File</label>
    <input type="file" id="csv-file" accept=".csv,.txt" style="color:var(--text);margin-bottom:16px;width:100%" />
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="importContacts()">Import</button>
    </div>
  `);
}

async function importContacts() {
  const file = document.getElementById('csv-file').files[0];
  if (!file) return toast('Select a CSV file', 'error');
  const form = new FormData();
  form.append('file', file);
  const res = await apiFetch('/api/contacts/bulk', { method: 'POST', body: form });
  const data = await res.json();
  if (data.success) { closeModal(); loadContacts(); toast(`✅ Imported ${data.imported} contacts!`, 'success'); }
  else toast('Import failed: ' + data.error, 'error');
}

function showAddContactModal() {
  const groupOptions = allGroups.map(g => `<option value="${g.id}">${escHtml(g.name)}</option>`).join('');
  showModal('Add Contact', `
    <label class="modal-label">Name</label>
    <input class="modal-input" id="c-name" placeholder="Full Name" />
    <label class="modal-label">Phone Number</label>
    <input class="modal-input" id="c-phone" placeholder="919876543210 (with country code)" />
    <label class="modal-label">State</label>
    <select class="modal-select" id="c-state">${indianStatesOptions()}</select>
    <label class="modal-label">Group</label>
    <select class="modal-select" id="c-group"><option value="">— No Group —</option>${groupOptions}</select>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="saveContact()">Add Contact</button>
    </div>
  `);
}

async function saveContact() {
  const data = {
    name: document.getElementById('c-name').value.trim(),
    phone: document.getElementById('c-phone').value.replace(/[^0-9]/g, ''),
    state: document.getElementById('c-state').value,
    group_id: document.getElementById('c-group').value || null
  };
  if (!data.name || !data.phone) return toast('Name and phone required', 'error');
  const res = await api('/contacts', 'POST', data);
  if (res.success) { closeModal(); loadContacts(); toast('Contact added!', 'success'); }
}

// ===== TEMPLATES =====
async function loadTemplates() {
  const templates = await api('/templates');
  updateTemplatePicker(templates || []);
  const list = document.getElementById('templates-list');
  if (!templates?.length) {
    list.innerHTML = '<div class="empty-state">No templates yet. Create your first template.</div>';
    return;
  }
  list.innerHTML = templates.map(t => `
    <div class="template-card">
      <div class="template-title">${escHtml(t.title)}</div>
      <div class="template-preview">${escHtml(t.content)}</div>
      ${t.media_type ? `<div class="template-media">📎 ${t.media_type.split('/')[0]} attached</div>` : ''}
      <div class="template-actions">
        <button class="btn-small" onclick="useTemplate(${t.id})">Use</button>
        <button class="icon-btn delete" onclick="deleteTemplate(${t.id})">🗑️</button>
      </div>
    </div>
  `).join('');
}

function updateTemplatePicker(templates) {
  const picker = document.getElementById('template-picker');
  if (!picker) return;
  picker.innerHTML = '<option value="">— Select a template —</option>' +
    templates.map(t => `<option value="${t.id}">${escHtml(t.title)}</option>`).join('');
}

async function applyTemplate(id) {
  if (!id) return;
  const templates = await api('/templates');
  const t = templates?.find(t => t.id == id);
  if (t) {
    document.getElementById('send-message').value = t.content;
    document.getElementById('char-count').textContent = t.content.length + ' characters';
    toast('Template applied', 'success');
  }
}

function useTemplate(id) {
  showPage('send');
  setTimeout(() => {
    document.getElementById('template-picker').value = id;
    applyTemplate(id);
  }, 100);
}

async function deleteTemplate(id) {
  confirm2('Delete Template?', 'This cannot be undone.', async () => {
    await api(`/templates/${id}`, 'DELETE');
    loadTemplates(); toast('Template deleted', 'info');
  });
}

function showAddTemplateModal() {
  showModal('New Template', `
    <label class="modal-label">Template Title</label>
    <input class="modal-input" id="t-title" placeholder="e.g. Monthly Update" />
    <label class="modal-label">Message Content</label>
    <textarea class="modal-textarea" id="t-content" placeholder="Your message..."></textarea>
    <label class="modal-label">Attach Media <span style="color:var(--text3);font-weight:400">(optional)</span></label>
    <input type="file" id="t-media" accept="image/*,video/*,.pdf,.doc,.docx" style="color:var(--text);width:100%;margin-bottom:4px" />
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="saveTemplate()">Save Template</button>
    </div>
  `);
}

async function saveTemplate() {
  const form = new FormData();
  form.append('title', document.getElementById('t-title').value.trim());
  form.append('content', document.getElementById('t-content').value.trim());
  const media = document.getElementById('t-media').files[0];
  if (media) form.append('media', media);
  if (!form.get('title') || !form.get('content')) return toast('Title and content required', 'error');
  const res = await apiFetch('/api/templates', { method: 'POST', body: form });
  const data = await res.json();
  if (data.success) { closeModal(); loadTemplates(); toast('Template saved!', 'success'); }
}

// ===== SEND PAGE =====
function loadSendPage() {
  loadGroups().then(() => renderSendGroupList());
  loadTemplates();
}

function setTarget(type) {
  sendTarget = type;
  document.getElementById('tab-all').classList.toggle('active', type === 'all');
  document.getElementById('tab-select').classList.toggle('active', type === 'select');
  document.getElementById('group-selector').classList.toggle('hidden', type !== 'select');

  if (type === 'all') {
    const active = allGroups.filter(g => g.is_active);
    document.getElementById('selected-info').textContent = `All active groups will receive this message (${active.length} groups)`;
  } else {
    renderSendGroupList();
    updateSelectedInfo();
  }
}

function renderSendGroupList(filter = '') {
  const list = document.getElementById('send-group-list');
  const groups = allGroups.filter(g => g.is_active && (!filter || g.name.toLowerCase().includes(filter.toLowerCase())));
  list.innerHTML = groups.map(g => `
    <div class="group-check-item">
      <input type="checkbox" id="sg-${g.id}" value="${g.id}" onchange="updateSelectedInfo()" ${selectedGroups.includes(g.id) ? 'checked' : ''} />
      <label for="sg-${g.id}">${escHtml(g.name)} <span style="color:var(--text3)">· ${g.state}</span></label>
      <span class="group-check-count">👥 ${g.member_count}</span>
    </div>
  `).join('') || '<div style="color:var(--text3);padding:12px;text-align:center">No groups found</div>';
}

function filterSendGroups(q) { renderSendGroupList(q); }

function updateSelectedInfo() {
  selectedGroups = [...document.querySelectorAll('#send-group-list input:checked')].map(cb => parseInt(cb.value));
  document.getElementById('selected-info').textContent = selectedGroups.length > 0
    ? `${selectedGroups.length} group(s) selected`
    : 'No groups selected';
}

function handleMediaSelect(input) {
  const file = input.files[0];
  if (!file) return;
  selectedMedia = file;
  const isImage = file.type.startsWith('image/');
  const content = document.getElementById('media-drop-content');
  content.innerHTML = `
    <div class="media-preview">
      ${isImage ? `<img src="${URL.createObjectURL(file)}" />` : '<div style="font-size:32px">📄</div>'}
      <div class="media-preview-info">
        <div class="media-preview-name">${escHtml(file.name)}</div>
        <div class="media-preview-size">${formatSize(file.size)}</div>
      </div>
      <button class="media-preview-remove" onclick="clearMedia(event)">✕ Remove</button>
    </div>
  `;
}

function clearMedia(e) {
  e?.stopPropagation();
  selectedMedia = null;
  document.getElementById('media-input').value = '';
  document.getElementById('media-drop-content').innerHTML = `
    <div class="media-drop-icon">📎</div>
    <p>Click to attach image, video, audio or document</p>
    <span>Max 64MB</span>
  `;
}

async function confirmSend() {
  const message = document.getElementById('send-message').value.trim();
  if (!message && !selectedMedia) return toast('Enter a message or attach media', 'error');
  if (sendTarget === 'select' && selectedGroups.length === 0) return toast('Select at least one group', 'error');
  if (!waConnected) return toast('WhatsApp is not connected', 'error');

  const targetCount = sendTarget === 'all' ? allGroups.filter(g => g.is_active).length : selectedGroups.length;
  confirm2('Send Message?', `This will send to ${targetCount} group(s). Are you sure?`, doSend, '🚀');
}

async function doSend() {
  const message = document.getElementById('send-message').value.trim();
  const form = new FormData();
  form.append('message', message);
  form.append('sendAll', sendTarget === 'all' ? 'true' : 'false');
  form.append('groupIds', JSON.stringify(selectedGroups));
  if (selectedMedia) form.append('media', selectedMedia);

  const res = await apiFetch('/api/send', { method: 'POST', body: form });
  const data = await res.json();
  if (!data.success) toast('Send failed: ' + data.error, 'error');
}

function showSendTestConfirm() {
  const message = document.getElementById('send-message').value.trim();
  if (!message && !selectedMedia) return toast('Enter a message first', 'error');
  toast('💡 Test send: Select a single group and send to test', 'info');
  setTarget('select');
}

// ===== SCHEDULE =====
async function loadSchedule() {
  const scheduled = await api('/schedule');
  const list = document.getElementById('scheduled-list');
  if (!scheduled?.length) {
    list.innerHTML = '<div class="empty-state">No scheduled messages. Schedule a broadcast from Send Message page.</div>';
    return;
  }
  list.innerHTML = scheduled.map(s => {
    const d = new Date(s.schedule_time);
    return `
      <div class="schedule-item">
        <div class="schedule-time">
          <div class="schedule-time-value">${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}</div>
          <div class="schedule-time-date">${d.toLocaleDateString('en-IN')}</div>
        </div>
        <div class="schedule-info">
          <div class="schedule-msg">${escHtml(s.content || '[Media]')}</div>
          <div class="schedule-meta">
            ${JSON.parse(s.target_groups||'[]').includes('all') ? 'All groups' : JSON.parse(s.target_groups||'[]').length + ' groups'}
            ${s.is_recurring ? `<span class="recurring-badge">🔁 ${s.recurring_type}</span>` : ''}
          </div>
        </div>
        <button class="icon-btn delete" onclick="cancelSchedule(${s.id})">🗑️</button>
      </div>
    `;
  }).join('');
}

async function cancelSchedule(id) {
  confirm2('Cancel Schedule?', 'This scheduled message will be deleted.', async () => {
    await api(`/schedule/${id}`, 'DELETE');
    loadSchedule(); toast('Schedule cancelled', 'info');
  });
}

function showScheduleModal() {
  const message = document.getElementById('send-message').value.trim();
  if (!message && !selectedMedia) return toast('Enter a message first', 'error');

  const now = new Date();
  now.setMinutes(now.getMinutes() + 30);
  const defaultTime = now.toISOString().slice(0, 16);

  showModal('Schedule Message', `
    <label class="modal-label">Schedule Date & Time</label>
    <input type="datetime-local" class="modal-input" id="sch-time" value="${defaultTime}" />
    <label class="modal-label">Recurring</label>
    <select class="modal-select" id="sch-recurring">
      <option value="">One-time only</option>
      <option value="daily">Daily</option>
      <option value="weekly">Weekly</option>
      <option value="monthly">Monthly</option>
    </select>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="saveSchedule()">Schedule</button>
    </div>
  `);
}

async function saveSchedule() {
  const scheduleTime = document.getElementById('sch-time').value;
  const recurringType = document.getElementById('sch-recurring').value;
  const message = document.getElementById('send-message').value.trim();

  const form = new FormData();
  form.append('message', message);
  form.append('scheduleTime', scheduleTime);
  form.append('sendAll', sendTarget === 'all' ? 'true' : 'false');
  form.append('groupIds', JSON.stringify(selectedGroups));
  form.append('isRecurring', recurringType ? 'true' : 'false');
  if (recurringType) form.append('recurringType', recurringType);
  if (selectedMedia) form.append('media', selectedMedia);

  const res = await apiFetch('/api/schedule', { method: 'POST', body: form });
  const data = await res.json();
  if (data.success) {
    closeModal();
    toast(`✅ Scheduled for ${new Date(scheduleTime).toLocaleString('en-IN')}`, 'success');
  } else {
    toast('Schedule failed: ' + data.error, 'error');
  }
}

// ===== HISTORY =====
async function loadHistory() {
  const data = await api('/history');
  if (!data) return;

  const stats = data.stats || {};
  document.getElementById('history-stats').innerHTML = `
    <div class="history-stat"><div class="history-stat-num" style="color:var(--blue)">${stats.total||0}</div><div class="history-stat-label">Total Broadcasts</div></div>
    <div class="history-stat"><div class="history-stat-num" style="color:var(--green)">${stats.total_sent||0}</div><div class="history-stat-label">Groups Reached</div></div>
    <div class="history-stat"><div class="history-stat-num" style="color:var(--red)">${stats.total_failed||0}</div><div class="history-stat-label">Failed</div></div>
    <div class="history-stat"><div class="history-stat-num" style="color:var(--orange)">${stats.today||0}</div><div class="history-stat-label">Today</div></div>
  `;

  const list = document.getElementById('history-list');
  if (!data.messages?.length) {
    list.innerHTML = '<div class="empty-state">No message history yet</div>';
    return;
  }
  list.innerHTML = data.messages.map(m => `
    <div class="history-item">
      <div class="history-item-header">
        <span style="font-weight:700;font-size:14px">${m.media_type ? '📎 ' + m.media_type.split('/')[0].toUpperCase() + ' + Message' : '💬 Text Message'}</span>
        <span class="recent-status status-${m.status}">${m.status}</span>
      </div>
      <div class="history-item-msg">${escHtml((m.content || '').substring(0, 150))}${m.content?.length > 150 ? '...' : ''}</div>
      <div class="history-item-footer">
        <span class="history-pill pill-sent">✓ Sent: ${m.sent_count||0}</span>
        ${m.failed_count > 0 ? `<span class="history-pill pill-failed">✗ Failed: ${m.failed_count}</span>` : ''}
        <span class="history-pill pill-time">${formatDate(m.sent_at)}</span>
      </div>
    </div>
  `).join('');
}

// ===== SETTINGS =====
async function loadSettings() {
  const settings = await api('/settings');
  if (settings?.message_delay) document.getElementById('setting-delay').value = settings.message_delay;
  if (settings?.daily_limit) document.getElementById('setting-limit').value = settings.daily_limit;
}

async function saveSetting(key, value) {
  await api('/settings', 'PUT', { key, value });
  toast('Setting saved!', 'success');
}

// ===== PROGRESS =====
function showProgress(total) {
  document.getElementById('send-progress-card').classList.remove('hidden');
  document.getElementById('progress-count').textContent = `0 / ${total}`;
  document.getElementById('progress-bar').style.width = '0%';
  document.getElementById('progress-log').innerHTML = '';
}

function updateProgress(current, total, group, status) {
  const pct = (current / total) * 100;
  document.getElementById('progress-bar').style.width = pct + '%';
  document.getElementById('progress-count').textContent = `${current} / ${total}`;
  const log = document.getElementById('progress-log');
  const item = document.createElement('div');
  item.className = `progress-log-item ${status}`;
  item.textContent = `${status === 'success' ? '✓' : '✗'} ${group}`;
  log.insertBefore(item, log.firstChild);
}

function hideProgress() {
  setTimeout(() => {
    document.getElementById('send-progress-card').classList.add('hidden');
  }, 3000);
}

// ===== MODAL =====
function showModal(title, body) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

function confirm2(title, msg, onOk, icon = '⚠️') {
  document.getElementById('confirm-icon').textContent = icon;
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent = msg;
  document.getElementById('confirm-overlay').classList.remove('hidden');
  document.getElementById('confirm-ok').onclick = () => {
    document.getElementById('confirm-overlay').classList.add('hidden');
    if (onOk) onOk();
  };
}

// ===== TOAST =====
function toast(msg, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ===== API HELPERS =====
async function api(path, method = 'GET', body = null) {
  try {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch('/api' + path, opts);
    return res.json();
  } catch (err) {
    console.error('API error:', err);
    return null;
  }
}

async function apiFetch(path, opts = {}) {
  return fetch(path, opts);
}

// ===== UTILITIES =====
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/1024/1024).toFixed(1) + ' MB';
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

function indianStatesOptions(selected = '') {
  const states = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Delhi','Goa',
    'Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
    'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan',
    'Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
    'Chandigarh','Jammu & Kashmir','Ladakh','Puducherry','Other'];
  return states.map(s => `<option value="${s}" ${s===selected?'selected':''}>${s}</option>`).join('');
}
