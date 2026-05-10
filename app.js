// ── Firebase ──
const firebaseConfig = {
  apiKey:            'AIzaSyCVqbMV3bEkQ_thDAvFCDQltXR9eERAtfA',
  authDomain:        'miroku-app-915e2.firebaseapp.com',
  projectId:         'miroku-app-915e2',
  storageBucket:     'miroku-app-915e2.firebasestorage.app',
  messagingSenderId: '540305307612',
  appId:             '1:540305307612:web:a7c16561030a075d334119',
  databaseURL:       'https://miroku-app-915e2-default-rtdb.firebaseio.com'
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const churchRef   = db.ref('church/data');
const settingsRef = db.ref('church/settings');
const accountsRef = db.ref('church/accounts');

// ── Auth ──
const SESSION_KEY = 'miroku-session';
const USERS_KEY   = 'miroku-users';
const NOTIF_KEY   = 'miroku-notif';

let usersCache = null; // null = not yet loaded from Firestore

function getUsers() {
  if (usersCache !== null) return usersCache;
  try {
    const s = localStorage.getItem(USERS_KEY);
    return s ? JSON.parse(s) : getDefaultUsers();
  } catch { return getDefaultUsers(); }
}

function getDefaultUsers() {
  return {
    admin:  { password: 'MirokuAdmin2025',  role: 'admin',  displayName: 'Administrator' },
    member: { password: 'MirokuMember2025', role: 'member', displayName: 'Member'        }
  };
}

function saveUsers(users) {
  usersCache = users;
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
  accountsRef.set(users).catch(err => {
    console.error('Account sync error:', err);
    showToast('Warning: accounts may not sync to other devices. Check Firebase rules.', 'error');
  });
}

async function loadUsersFromFirestore() {
  try {
    const snap = await accountsRef.once('value');
    if (snap.exists()) {
      usersCache = snap.val();
      localStorage.setItem(USERS_KEY, JSON.stringify(usersCache));
    } else {
      try { usersCache = JSON.parse(localStorage.getItem(USERS_KEY) || 'null') || getDefaultUsers(); }
      catch { usersCache = getDefaultUsers(); }
      accountsRef.set(usersCache).catch(() => {});
    }
  } catch {
    usersCache = null; // Database unavailable — getUsers() falls back to localStorage
  }
}

function showToast(msg, type = 'info') {
  let el = document.getElementById('app-toast');
  if (el) el.remove();
  el = document.createElement('div');
  el.id = 'app-toast';
  el.className = 'app-toast app-toast-' + type;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.remove(); }, 6000);
}

let currentUser = null;

function checkSession() {
  try {
    const s = localStorage.getItem(SESSION_KEY);
    if (s) { currentUser = JSON.parse(s); return true; }
  } catch {}
  return false;
}

function login(username, password) {
  const users = getUsers();
  const key   = username.toLowerCase().trim();
  const user  = users[key];
  if (user && user.password === password) {
    currentUser = { username: key, role: user.role, displayName: user.displayName || key };
    localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
    return true;
  }
  return false;
}

function logout() {
  currentUser = null;
  localStorage.removeItem(SESSION_KEY);
  unsubscribeData();
  // Tell the browser not to silently re-login after an explicit sign out
  if ('credentials' in navigator) {
    navigator.credentials.preventSilentAccess().catch(() => {});
  }
  showApp(false);
}

function isAdmin() { return currentUser && currentUser.role === 'admin'; }

// ── Default Data ──
const DEFAULT_DATA = {
  services: [
    { id: 1, icon: '☀️', title: 'Sunday Morning',    time: '8:00 AM & 10:30 AM'   },
    { id: 2, icon: '🌆', title: 'Wednesday Evening', time: '6:30 PM — Bible Study' },
    { id: 3, icon: '💖', title: 'Youth Group',        time: 'Friday 7:00 PM'        }
  ],
  location: {
    address: '123 Faith Avenue',
    city: 'Los Angeles, CA 90001',
    mapsUrl: 'https://maps.google.com/?q=123+Faith+Avenue+Los+Angeles+CA'
  },
  contact: { phone: '(323) 555-0100', email: 'info@mirokuLA.org' },
  liveEvents: {
    facebook: { label: 'Facebook Live', url: '', active: false },
    youtube:  { label: 'YouTube Live',  url: '', active: false },
    zoom:     { label: 'Zoom',          url: '', active: false }
  },
  events: [
    { id: 1, date: 'Sun, May 11', title: "Mother's Day Celebration",   desc: 'A special service honoring all mothers. Flowers provided.',            tag: 'Special Service'  },
    { id: 2, date: 'Sat, May 17', title: 'Community Food Drive',        desc: 'Help pack food boxes for families in need. Volunteers welcome!',       tag: 'Community'        },
    { id: 3, date: 'Fri, May 23', title: 'Youth Game Night',            desc: 'Fun and fellowship for teens. Bring a friend! Snacks provided.',       tag: 'Youth'            },
    { id: 4, date: 'Sun, Jun 1',  title: 'Summer Kickoff Cookout',      desc: 'Join us after the 10:30 AM service for a cookout on the lawn.',        tag: 'Fellowship'       },
    { id: 5, date: 'Sat, Jun 7',  title: "Men's Breakfast",             desc: "Monthly men's breakfast and Bible study. 8:00 AM in Fellowship Hall.", tag: "Men's Ministry"   },
    { id: 6, date: 'Sat, Jun 14', title: "Women's Bible Study Retreat", desc: 'A one-day retreat for women — worship, prayer, and fellowship.',       tag: "Women's Ministry" }
  ],
  members: [
    { id: 1, name: 'Pastor David Williams', role: 'Senior Pastor',        phone: '(323) 555-0101', email: 'david@mirokuLA.org'    },
    { id: 2, name: 'Sarah Johnson',         role: 'Worship Director',     phone: '(323) 555-0102', email: 'sarah@mirokuLA.org'    },
    { id: 3, name: 'Michael Thompson',      role: 'Youth Pastor',         phone: '(323) 555-0103', email: 'michael@mirokuLA.org'  },
    { id: 4, name: 'Lisa Martinez',         role: "Children's Ministry",  phone: '(323) 555-0104', email: 'lisa@mirokuLA.org'     },
    { id: 5, name: 'Robert Chen',           role: 'Deacon',               phone: '(323) 555-0105', email: 'robert@mirokuLA.org'   },
    { id: 6, name: 'Amanda Davis',          role: 'Church Administrator', phone: '(323) 555-0100', email: 'info@mirokuLA.org'     },
    { id: 7, name: 'James Wilson',          role: 'Elder',                phone: '(323) 555-0106', email: 'james@mirokuLA.org'    },
    { id: 8, name: 'Patricia Moore',        role: 'Prayer Team Lead',     phone: '(323) 555-0107', email: 'patricia@mirokuLA.org' }
  ],
  media: [
    { id: 1, source: 'other', series: 'Faith That Moves Mountains', title: 'When God Says Wait',             date: 'May 4, 2025',  pastor: 'Pastor David Williams', url: '#' },
    { id: 2, source: 'other', series: 'Faith That Moves Mountains', title: 'The Power of Persistent Prayer', date: 'Apr 27, 2025', pastor: 'Pastor David Williams', url: '#' },
    { id: 3, source: 'other', series: 'Rooted',                     title: 'Finding Peace in the Storm',     date: 'Apr 20, 2025', pastor: 'Michael Thompson',      url: '#' },
    { id: 4, source: 'other', series: 'Rooted',                     title: 'Grace Greater Than Our Sin',     date: 'Apr 13, 2025', pastor: 'Pastor David Williams', url: '#' }
  ],
  messages: [],
  youtube: { channelId: '', apiKey: '' }
};

// ── Realtime Database layer ──
let appData = null;
let dataUnsubscribe = null;
let ytVideos = [];   // auto-fetched YouTube videos
let ytSynced = false;

function subscribeData() {
  appData = deepCopy(DEFAULT_DATA);
  renderAll();
  showLoading(true);

  const handler = snap => {
    if (snap.exists()) {
      appData = snap.val();
      // Realtime DB stores empty arrays as null and may return objects instead of arrays
      appData.events   = ensureArray(appData.events);
      appData.members  = ensureArray(appData.members);
      appData.media    = ensureArray(appData.media);
      appData.services = ensureArray(appData.services, DEFAULT_DATA.services);
      appData.messages = ensureArray(appData.messages);
      if (!appData.liveEvents) appData.liveEvents = DEFAULT_DATA.liveEvents;
      if (!appData.location)   appData.location   = DEFAULT_DATA.location;
      if (!appData.contact)    appData.contact    = DEFAULT_DATA.contact;
      if (!appData.youtube)    appData.youtube    = { channelId: '', apiKey: '' };
    } else {
      churchRef.set(appData).catch(err => console.error('Init error:', err));
    }
    renderAll();
    showLoading(false);
    if (!ytSynced) { ytSynced = true; refreshYouTube(); }
  };

  const errHandler = err => {
    console.error('Database error:', err);
    showLoading(false);
    showToast('⚠️ Cannot reach database [' + (err.code || err.message || 'unknown') + '] — check Realtime Database rules', 'error');
  };

  churchRef.on('value', handler, errHandler);
  dataUnsubscribe = () => churchRef.off('value', handler);
}

function unsubscribeData() {
  if (dataUnsubscribe) { dataUnsubscribe(); dataUnsubscribe = null; }
  ytVideos = []; ytSynced = false;
}

function saveData() {
  renderAll();
  churchRef.set(appData).catch(err => {
    console.error('Save error:', err);
    showToast('⚠️ Save failed [' + (err.code || err.message || 'unknown') + ']', 'error');
  });
}

function deepCopy(obj) { return JSON.parse(JSON.stringify(obj)); }
function nextId(arr) { return arr.length ? Math.max(...arr.map(x => x.id)) + 1 : 1; }

// Firebase Realtime DB returns null for empty arrays; ensure fields are always real arrays
function ensureArray(val, fallback = []) {
  if (Array.isArray(val)) return val;
  if (!val) return fallback;
  return Object.values(val); // numeric-keyed object → array
}

// Date helpers for calendar picker ↔ display format
function toInputDate(displayDate) {
  // "Sun, May 11" → "2025-05-11"
  if (!displayDate) return '';
  const clean = displayDate.replace(/^[A-Za-z]+,\s*/, '');
  const now = new Date();
  const d = new Date(clean + ' ' + now.getFullYear());
  if (isNaN(d.getTime())) return '';
  if (d < new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)) d.setFullYear(now.getFullYear() + 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function fromInputDate(isoDate) {
  // "2025-05-11" → "Sun, May 11"
  if (!isoDate) return '';
  const [y, m, day] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, day);
  const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return DAYS[dt.getDay()] + ', ' + MONTHS[dt.getMonth()] + ' ' + dt.getDate();
}

// ── XSS helpers ──
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Loading bar ──
function showLoading(on) {
  let el = document.getElementById('loading-bar');
  if (!el) {
    el = document.createElement('div');
    el.id = 'loading-bar';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;height:3px;background:var(--gold);z-index:9999;transition:opacity 0.4s';
    document.body.appendChild(el);
  }
  el.style.opacity = on ? '1' : '0';
}

// ── Credential Management (Face ID / saved passwords) ──
async function storeCredential(username, password) {
  if (!window.PasswordCredential) return;
  try {
    const cred = new PasswordCredential({ id: username, password, name: username });
    await navigator.credentials.store(cred);
  } catch {}
}

async function tryAutoLogin() {
  await loadUsersFromFirestore(); // sync accounts from Firestore before checking credentials

  if (checkSession()) { showApp(true); return; }

  if (!('credentials' in navigator) || !window.PasswordCredential) return;
  try {
    const cred = await navigator.credentials.get({ password: true, mediation: 'silent' });
    if (cred && login(cred.id, cred.password)) showApp(true);
  } catch {}
}

// ── Login ──
document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  if (login(username, password)) {
    errEl.textContent = '';
    document.getElementById('login-password').value = '';
    await storeCredential(username, password); // offer to save / Face ID
    showApp(true);
  } else {
    errEl.textContent = 'Incorrect username or password.';
    document.getElementById('login-password').value = '';
  }
});

// ── Show / hide app ──
function showApp(visible) {
  document.getElementById('login-screen').classList.toggle('hidden', visible);
  document.getElementById('app-header').classList.toggle('hidden', !visible);
  document.getElementById('app-main').classList.toggle('hidden', !visible);
  document.getElementById('bottom-nav').classList.toggle('hidden', !visible);

  if (visible) {
    document.getElementById('admin-badge').classList.toggle('hidden', !isAdmin());
    document.body.classList.toggle('is-admin', isAdmin());
    subscribeData();
    initSettings();
    const schedBtn = document.getElementById('schedule-word-btn');
    if (schedBtn) {
      schedBtn.replaceWith(schedBtn.cloneNode(true));
      document.getElementById('schedule-word-btn').addEventListener('click', openScheduleModal);
    }
    const acctBtn = document.getElementById('manage-accounts-btn');
    if (acctBtn) {
      acctBtn.replaceWith(acctBtn.cloneNode(true));
      document.getElementById('manage-accounts-btn').addEventListener('click', openAccountsModal);
    }
    const ytBtn = document.getElementById('save-yt-btn');
    if (ytBtn) {
      ytBtn.replaceWith(ytBtn.cloneNode(true));
      document.getElementById('save-yt-btn').addEventListener('click', async () => {
        const raw    = document.getElementById('yt-channel-id').value.trim();
        const apiKey = document.getElementById('yt-api-key').value.trim();
        if (!raw || !apiKey) { showToast('Enter your channel URL/handle and API key first.', 'error'); return; }
        const btn = document.getElementById('save-yt-btn');
        btn.textContent = 'Resolving…';
        btn.disabled = true;
        try {
          const channelId = await resolveChannelId(raw, apiKey);
          if (!appData.youtube) appData.youtube = {};
          appData.youtube.channelId = channelId;
          appData.youtube.apiKey    = apiKey;
          // Update the input to show the resolved ID
          const el = document.getElementById('yt-channel-id');
          if (el) el.value = channelId;
          saveData();
          ytSynced = false;
          await refreshYouTube();
          showToast('YouTube connected and synced!', 'info');
        } catch (err) {
          showToast('⚠️ ' + (err.message || 'Could not connect to YouTube'), 'error');
        } finally {
          btn.textContent = 'Save & Sync Now';
          btn.disabled = false;
        }
      });
    }
  } else {
    document.body.classList.remove('is-admin');
    document.getElementById('login-username').value = '';
  }
}

document.getElementById('logout-btn').addEventListener('click', logout);

// ── Tab navigation ──
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ── YouTube auto-sync ──

async function resolveChannelId(input, apiKey) {
  const s = input.trim();
  // Already a Channel ID
  if (/^UC[\w-]{22}$/.test(s)) return s;

  // Extract from full URL: youtube.com/channel/UCxxx
  const chanMatch = s.match(/youtube\.com\/channel\/(UC[\w-]{22})/);
  if (chanMatch) return chanMatch[1];

  // Extract handle: @name from URL or raw @name
  let handle = null;
  const handleUrl = s.match(/youtube\.com\/@([\w.-]+)/);
  if (handleUrl) handle = '@' + handleUrl[1];
  else if (s.startsWith('@')) handle = s;

  if (handle) {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(handle)}&key=${encodeURIComponent(apiKey)}`);
    const j = await r.json();
    if (j.items && j.items[0]) return j.items[0].id;
    throw new Error('Channel not found for ' + handle);
  }

  // Try as legacy username
  const userMatch = s.match(/youtube\.com\/(?:c\/|user\/)([\w.-]+)/);
  const username = userMatch ? userMatch[1] : s;
  const r2 = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=id&forUsername=${encodeURIComponent(username)}&key=${encodeURIComponent(apiKey)}`);
  const j2 = await r2.json();
  if (j2.items && j2.items[0]) return j2.items[0].id;
  throw new Error('Could not resolve channel. Try pasting your full YouTube channel URL.');
}

async function refreshYouTube() {
  const yt = (appData && appData.youtube) || {};
  if (!yt.channelId || !yt.apiKey) return;
  try {
    const res  = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(yt.channelId)}&type=video&order=date&maxResults=20&key=${encodeURIComponent(yt.apiKey)}`
    );
    const json = await res.json();
    if (json.error) {
      showToast('YouTube sync failed: ' + (json.error.message || 'check your API key'), 'error');
      return;
    }
    ytVideos = (json.items || []).map(item => ({
      source:  'youtube',
      videoId: item.id.videoId,
      title:   item.snippet.title,
      date:    formatYTDate(item.snippet.publishedAt),
      channel: item.snippet.channelTitle,
      thumb:   (item.snippet.thumbnails.medium || item.snippet.thumbnails.default || {}).url || '',
      url:     'https://www.youtube.com/watch?v=' + item.id.videoId
    }));
    renderMedia();
  } catch (err) {
    console.error('YouTube fetch error:', err);
  }
}

function formatYTDate(iso) {
  const d = new Date(iso);
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return M[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

function renderYouTubeSettings() {
  const yt = (appData && appData.youtube) || {};
  const cEl = document.getElementById('yt-channel-id');
  const kEl = document.getElementById('yt-api-key');
  if (cEl && document.activeElement !== cEl) cEl.value = yt.channelId || '';
  if (kEl && document.activeElement !== kEl) kEl.value = yt.apiKey    || '';
}

// ── Render all ──
function renderAll() {
  renderDailyMessage();
  renderLiveEvents();
  renderServices();
  renderLocation();
  renderContact();
  renderEvents();
  renderDirectory();
  renderMedia();
  renderYouTubeSettings();
}

// ── DAILY WORD ──
function getTodayString() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function renderDailyMessage() {
  const container = document.getElementById('daily-word-container');
  if (!container) return;
  const today = getTodayString();
  const past = (appData.messages || [])
    .filter(m => m.scheduledDate <= today)
    .sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate) || b.scheduledTime.localeCompare(a.scheduledTime));

  if (!past.length) {
    container.innerHTML = '<div class="daily-word-card daily-word-empty"><p>No daily message yet.</p></div>';
    return;
  }
  const m = past[0];
  container.innerHTML = `
    <div class="daily-word-card">
      <div class="daily-word-quote">"</div>
      <div class="daily-word-label">${esc(m.title || 'Daily Word')}</div>
      <p class="daily-word-text">${esc(m.text)}</p>
      ${m.scripture ? `<p class="daily-word-scripture">— ${esc(m.scripture)}</p>` : ''}
    </div>`;
}

function openScheduleModal() {
  const today = getTodayString();
  const msgs  = (appData.messages || [])
    .slice()
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.scheduledTime.localeCompare(b.scheduledTime));

  openModal('Schedule Daily Word', `
    <p style="font-size:13px;font-weight:700;color:var(--purple);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">New Message</p>
    <div class="form-group">
      <label class="form-label">Date</label>
      <input class="form-input" id="new-msg-date" type="date" value="${today}" />
    </div>
    <div class="form-group">
      <label class="form-label">Time</label>
      <input class="form-input" id="new-msg-time" type="time" value="06:00" />
    </div>
    <div class="form-group">
      <label class="form-label">Title / Label</label>
      <input class="form-input" id="new-msg-title" value="Daily Word" placeholder="Daily Word" />
    </div>
    <div class="form-group">
      <label class="form-label">Message</label>
      <textarea class="form-textarea" id="new-msg-text" placeholder="Today's inspiring message..." style="min-height:90px"></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Scripture Reference</label>
      <input class="form-input" id="new-msg-scripture" placeholder="e.g. John 3:16" />
    </div>
    <button class="form-btn form-btn-primary" id="save-new-msg-btn">+ Schedule Message</button>

    ${msgs.length ? `
      <div style="margin-top:24px">
        <p style="font-size:13px;font-weight:700;color:var(--purple);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Scheduled (${msgs.length})</p>
        ${msgs.map(m => `
          <div class="scheduled-msg-row">
            <div class="scheduled-msg-info">
              <div class="scheduled-msg-date">${esc(m.scheduledDate)}${m.scheduledTime ? ' &bull; ' + esc(m.scheduledTime) : ''}</div>
              <div class="scheduled-msg-preview">${esc(m.title || 'Daily Word')}: ${esc(m.text.length > 55 ? m.text.substring(0,55) + '…' : m.text)}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0">
              <button class="card-action-btn" data-edit-msg="${m.id}">&#9998;</button>
              <button class="card-action-btn delete" data-del-msg="${m.id}">&#128465;</button>
            </div>
          </div>`).join('')}
      </div>` : ''}
  `, () => {
    document.getElementById('save-new-msg-btn').addEventListener('click', () => {
      const date      = document.getElementById('new-msg-date').value;
      const time      = document.getElementById('new-msg-time').value;
      const title     = document.getElementById('new-msg-title').value.trim();
      const text      = document.getElementById('new-msg-text').value.trim();
      const scripture = document.getElementById('new-msg-scripture').value.trim();
      if (!text) return;
      if (!appData.messages) appData.messages = [];
      appData.messages.push({ id: nextId(appData.messages), scheduledDate: date, scheduledTime: time, title, text, scripture });
      saveData();
      openScheduleModal();
    });

    document.querySelectorAll('[data-del-msg]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.delMsg, 10);
        if (!confirm('Delete this message?')) return;
        appData.messages = appData.messages.filter(m => m.id !== id);
        saveData();
        openScheduleModal();
      });
    });

    document.querySelectorAll('[data-edit-msg]').forEach(btn => {
      btn.addEventListener('click', () => openEditMessageModal(parseInt(btn.dataset.editMsg, 10)));
    });
  });
}

function openEditMessageModal(id) {
  const m = (appData.messages || []).find(x => x.id === id);
  if (!m) return;
  openModal('Edit Scheduled Message', `
    <div class="form-group">
      <label class="form-label">Date</label>
      <input class="form-input" id="edit-msg-date" type="date" value="${esc(m.scheduledDate)}" />
    </div>
    <div class="form-group">
      <label class="form-label">Time</label>
      <input class="form-input" id="edit-msg-time" type="time" value="${esc(m.scheduledTime || '06:00')}" />
    </div>
    <div class="form-group">
      <label class="form-label">Title / Label</label>
      <input class="form-input" id="edit-msg-title" value="${esc(m.title || 'Daily Word')}" />
    </div>
    <div class="form-group">
      <label class="form-label">Message</label>
      <textarea class="form-textarea" id="edit-msg-text" style="min-height:90px">${esc(m.text)}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Scripture Reference</label>
      <input class="form-input" id="edit-msg-scripture" value="${esc(m.scripture || '')}" placeholder="e.g. John 3:16" />
    </div>
    <button class="form-btn form-btn-primary" id="update-msg-btn">Save Changes</button>
    <button class="form-btn form-btn-danger" id="back-schedule-btn" style="background:#f5f0ff;color:var(--purple);border:1px solid #d8c8f0">&#8592; Back to Schedule</button>
  `, () => {
    document.getElementById('update-msg-btn').addEventListener('click', () => {
      const idx = appData.messages.findIndex(x => x.id === id);
      if (idx < 0) return;
      appData.messages[idx] = {
        id,
        scheduledDate: document.getElementById('edit-msg-date').value,
        scheduledTime: document.getElementById('edit-msg-time').value,
        title:         document.getElementById('edit-msg-title').value.trim(),
        text:          document.getElementById('edit-msg-text').value.trim(),
        scripture:     document.getElementById('edit-msg-scripture').value.trim()
      };
      saveData();
      openScheduleModal();
    });
    document.getElementById('back-schedule-btn').addEventListener('click', openScheduleModal);
  });
}

// ── MEMBER ACCOUNTS ──
function openAccountsModal() {
  const users = getUsers();
  const list  = Object.entries(users).map(([u, d]) => ({ username: u, ...d }));
  openModal('Member Accounts', `
    <div style="margin-bottom:20px">
      ${list.map(u => `
        <div class="scheduled-msg-row">
          <div class="scheduled-msg-info">
            <div class="scheduled-msg-date">${esc(u.username)} &bull; <span style="text-transform:capitalize">${esc(u.role)}</span></div>
            <div class="scheduled-msg-preview">${esc(u.displayName || u.username)}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="card-action-btn" data-edit-acct="${esc(u.username)}">&#9998;</button>
            ${u.username !== currentUser.username ? `<button class="card-action-btn delete" data-del-acct="${esc(u.username)}">&#128465;</button>` : ''}
          </div>
        </div>`).join('')}
    </div>
    <p style="font-size:13px;font-weight:700;color:var(--purple);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">Add New Account</p>
    <div class="form-group"><label class="form-label">Username</label>
      <input class="form-input" id="new-acct-user" placeholder="e.g. jane.doe" autocapitalize="none" autocorrect="off" /></div>
    <div class="form-group"><label class="form-label">Display Name</label>
      <input class="form-input" id="new-acct-display" placeholder="Full name" /></div>
    <div class="form-group"><label class="form-label">Password</label>
      <input class="form-input" id="new-acct-pw" type="password" placeholder="Min 6 characters" /></div>
    <div class="form-group"><label class="form-label">Role</label>
      <select class="form-input" id="new-acct-role">
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </select></div>
    <button class="form-btn form-btn-primary" id="add-acct-btn">+ Create Account</button>
  `, () => {
    document.querySelectorAll('[data-edit-acct]').forEach(btn => {
      btn.addEventListener('click', () => openEditAccountModal(btn.dataset.editAcct));
    });
    document.querySelectorAll('[data-del-acct]').forEach(btn => {
      btn.addEventListener('click', () => {
        const uname = btn.dataset.delAcct;
        if (!confirm(`Delete account "${uname}"?`)) return;
        const u = getUsers();
        delete u[uname];
        saveUsers(u);
        openAccountsModal();
      });
    });
    document.getElementById('add-acct-btn').addEventListener('click', () => {
      const username    = document.getElementById('new-acct-user').value.toLowerCase().trim().replace(/\s+/g, '.');
      const displayName = document.getElementById('new-acct-display').value.trim();
      const password    = document.getElementById('new-acct-pw').value;
      const role        = document.getElementById('new-acct-role').value;
      if (!username || !password) { showToast('Username and password are required.', 'error'); return; }
      if (password.length < 6)    { showToast('Password must be at least 6 characters.', 'error'); return; }
      const u = getUsers();
      if (u[username])            { showToast('That username already exists.', 'error'); return; }
      u[username] = { password, role, displayName: displayName || username };
      saveUsers(u);
      showToast(`Account "${username}" created! Share the username and password with them.`, 'info');
      openAccountsModal();
    });
  });
}

function openEditAccountModal(username) {
  const users = getUsers();
  const u = users[username];
  if (!u) return;
  openModal('Edit Account', `
    <div class="form-group"><label class="form-label">Username</label>
      <input class="form-input" value="${esc(username)}" disabled style="opacity:.55" /></div>
    <div class="form-group"><label class="form-label">Display Name</label>
      <input class="form-input" id="ea-display" value="${esc(u.displayName || '')}" /></div>
    <div class="form-group"><label class="form-label">New Password</label>
      <input class="form-input" id="ea-pw" type="password" placeholder="Leave blank to keep current" /></div>
    <div class="form-group"><label class="form-label">Role</label>
      <select class="form-input" id="ea-role">
        <option value="member" ${u.role === 'member' ? 'selected' : ''}>Member</option>
        <option value="admin"  ${u.role === 'admin'  ? 'selected' : ''}>Admin</option>
      </select></div>
    <button class="form-btn form-btn-primary" id="ea-save">Save Changes</button>
    <button class="form-btn" id="ea-back" style="background:#f5f0ff;color:var(--purple);border:1px solid #d8c8f0">&#8592; Back</button>
  `, () => {
    document.getElementById('ea-save').addEventListener('click', () => {
      const displayName = document.getElementById('ea-display').value.trim();
      const newPw       = document.getElementById('ea-pw').value;
      const role        = document.getElementById('ea-role').value;
      if (newPw && newPw.length < 6) { showToast('Password must be at least 6 characters.', 'error'); return; }
      const u2 = getUsers();
      u2[username] = { ...u2[username], displayName: displayName || username, role, ...(newPw ? { password: newPw } : {}) };
      saveUsers(u2);
      showToast('Account updated!', 'info');
      openAccountsModal();
    });
    document.getElementById('ea-back').addEventListener('click', openAccountsModal);
  });
}

// ── LIVE EVENTS ──
const PLATFORMS = [
  { key: 'facebook', icon: '📘', label: 'Facebook Live' },
  { key: 'youtube',  icon: '▶️',  label: 'YouTube Live'  },
  { key: 'zoom',     icon: '💻', label: 'Zoom'           }
];

function renderLiveEvents() {
  const le = appData.liveEvents || {};
  document.getElementById('live-events-list').innerHTML = PLATFORMS.map(p => {
    const data   = le[p.key] || {};
    const active = data.active && data.url;
    const label  = data.label || p.label;
    return `
      <a class="live-platform-card ${active ? 'active' : 'inactive'}"
         href="${active ? esc(data.url) : '#'}"
         ${active ? 'target="_blank"' : 'onclick="return false"'}>
        ${active ? '<div class="live-badge">LIVE</div>' : ''}
        <div class="live-platform-icon">${p.icon}</div>
        <div class="live-platform-label">${esc(label)}</div>
      </a>
    `;
  }).join('');
}

document.getElementById('edit-live-btn').addEventListener('click', () => {
  const le = appData.liveEvents || {};
  openModal('Edit Live Events', `
    ${PLATFORMS.map(p => {
      const d = le[p.key] || {};
      return `
        <p style="font-weight:700;color:var(--purple);margin-bottom:8px">${p.icon} ${p.label}</p>
        <div class="form-group">
          <label class="form-label">Label</label>
          <input class="form-input" id="live-label-${p.key}" value="${esc(d.label || p.label)}" />
        </div>
        <div class="form-group">
          <label class="form-label">URL</label>
          <input class="form-input" id="live-url-${p.key}" type="url" value="${esc(d.url || '')}" placeholder="https://..." />
        </div>
        <div class="settings-toggle-row" style="margin-bottom:20px">
          <div class="toggle-info"><div class="toggle-title">Show as Live</div></div>
          <label class="toggle-switch">
            <input type="checkbox" id="live-active-${p.key}" ${d.active ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </label>
        </div>
      `;
    }).join('')}
    <button class="form-btn form-btn-primary" id="save-live-btn">Save</button>
  `, () => {
    document.getElementById('save-live-btn').addEventListener('click', () => {
      if (!appData.liveEvents) appData.liveEvents = {};
      PLATFORMS.forEach(p => {
        appData.liveEvents[p.key] = {
          label:  document.getElementById('live-label-' + p.key).value.trim() || p.label,
          url:    document.getElementById('live-url-' + p.key).value.trim(),
          active: document.getElementById('live-active-' + p.key).checked
        };
      });
      saveData();
      closeModal();
    });
  });
});

// ── HOME: Service Times ──
function renderServices() {
  document.getElementById('services-list').innerHTML = (appData.services || []).map(s => `
    <div class="card">
      <div class="card-icon">${esc(s.icon)}</div>
      <div class="card-body"><h4>${esc(s.title)}</h4><p>${esc(s.time)}</p></div>
    </div>
  `).join('') || '<p style="color:var(--text-muted)">No service times added yet.</p>';
}

document.getElementById('edit-services-btn').addEventListener('click', openServicesModal);

function openServicesModal() { openModal('Edit Service Times', buildServicesForm()); }

function buildServicesForm() {
  const rows = (appData.services || []).map((s, i) => `
    <div class="service-row" data-id="${s.id}">
      <input class="svc-icon-input"  value="${esc(s.icon)}"  placeholder="☀️" data-idx="${i}" />
      <input class="svc-title-input" value="${esc(s.title)}" placeholder="Title" data-idx="${i}" />
      <input class="svc-time-input"  value="${esc(s.time)}"  placeholder="Time"  data-idx="${i}" />
      <button class="service-row-del" data-id="${s.id}">✕</button>
    </div>
  `).join('');
  return `
    <div id="services-form-list">${rows}</div>
    <button class="form-btn form-btn-primary" id="add-svc-row-btn" style="margin-top:4px">+ Add Service Time</button>
    <button class="form-btn form-btn-primary" id="save-svc-btn" style="margin-top:8px">Save</button>
  `;
}

function bindServicesForm() {
  document.querySelectorAll('.service-row-del').forEach(btn => {
    btn.addEventListener('click', () => {
      appData.services = appData.services.filter(s => s.id !== parseInt(btn.dataset.id, 10));
      document.getElementById('modal-body').innerHTML = buildServicesForm();
      bindServicesForm();
    });
  });
  const addBtn = document.getElementById('add-svc-row-btn');
  if (addBtn) addBtn.addEventListener('click', () => {
    appData.services.push({ id: nextId(appData.services), icon: '🕊️', title: 'New Service', time: '' });
    document.getElementById('modal-body').innerHTML = buildServicesForm();
    bindServicesForm();
  });
  const saveBtn = document.getElementById('save-svc-btn');
  if (saveBtn) saveBtn.addEventListener('click', () => {
    document.querySelectorAll('.service-row').forEach((row, i) => {
      if (!appData.services[i]) return;
      appData.services[i].icon  = row.querySelector('.svc-icon-input').value.trim();
      appData.services[i].title = row.querySelector('.svc-title-input').value.trim();
      appData.services[i].time  = row.querySelector('.svc-time-input').value.trim();
    });
    saveData(); closeModal();
  });
}

// ── HOME: Location ──
function renderLocation() {
  const loc = appData.location;
  document.getElementById('location-container').innerHTML = `
    <div class="card location-card">
      <div class="card-icon">&#128205;</div>
      <div class="card-body">
        <h4>${esc(loc.address)}</h4><p>${esc(loc.city)}</p>
        <a class="link-button" href="${esc(loc.mapsUrl)}" target="_blank">Get Directions</a>
      </div>
    </div>`;
}

document.getElementById('edit-location-btn').addEventListener('click', () => {
  const loc = appData.location, c = appData.contact;
  openModal('Edit Location & Contact', `
    <div class="form-group"><label class="form-label">Street Address</label>
      <input class="form-input" id="f-address" value="${esc(loc.address)}" /></div>
    <div class="form-group"><label class="form-label">City, State, ZIP</label>
      <input class="form-input" id="f-city" value="${esc(loc.city)}" /></div>
    <div class="form-group"><label class="form-label">Google Maps URL</label>
      <input class="form-input" id="f-maps" type="url" value="${esc(loc.mapsUrl)}" /></div>
    <div class="form-group"><label class="form-label">Phone</label>
      <input class="form-input" id="f-phone" type="tel" value="${esc(c.phone)}" /></div>
    <div class="form-group"><label class="form-label">Email</label>
      <input class="form-input" id="f-email" type="email" value="${esc(c.email)}" /></div>
    <button class="form-btn form-btn-primary" id="save-location-btn">Save</button>
  `, () => {
    document.getElementById('save-location-btn').addEventListener('click', () => {
      appData.location.address = document.getElementById('f-address').value.trim();
      appData.location.city    = document.getElementById('f-city').value.trim();
      appData.location.mapsUrl = document.getElementById('f-maps').value.trim();
      appData.contact.phone    = document.getElementById('f-phone').value.trim();
      appData.contact.email    = document.getElementById('f-email').value.trim();
      saveData(); closeModal();
    });
  });
});

// ── HOME: Contact ──
function renderContact() {
  const c = appData.contact;
  document.getElementById('contact-list').innerHTML = `
    <div class="card">
      <div class="card-icon">&#128222;</div>
      <div class="card-body"><h4>Phone</h4>
        <p><a href="tel:${c.phone.replace(/\D/g,'')}">${esc(c.phone)}</a></p></div>
    </div>
    <div class="card">
      <div class="card-icon">&#9993;</div>
      <div class="card-body"><h4>Email</h4>
        <p><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></p></div>
    </div>`;
}

// ── EVENTS ──
function renderEvents() {
  const list = document.getElementById('events-list');
  if (!(appData.events || []).length) {
    list.innerHTML = '<p style="color:var(--text-muted);padding:8px 0;">No upcoming events.</p>';
    return;
  }
  list.innerHTML = appData.events.map(e => `
    <div class="event-card">
      <div class="event-card-top">
        <div><div class="event-date">${esc(e.date)}</div><div class="event-title">${esc(e.title)}</div></div>
        <div class="card-actions admin-only">
          <button class="card-action-btn" data-action="edit-event" data-id="${e.id}">&#9998;</button>
          <button class="card-action-btn delete" data-action="del-event" data-id="${e.id}">&#128465;</button>
        </div>
      </div>
      <div class="event-desc">${esc(e.desc)}</div>
      <span class="event-tag">${esc(e.tag)}</span>
    </div>`).join('');
  document.querySelectorAll('[data-action="edit-event"]').forEach(b =>
    b.addEventListener('click', () => openEventModal(parseInt(b.dataset.id, 10))));
  document.querySelectorAll('[data-action="del-event"]').forEach(b =>
    b.addEventListener('click', () => deleteEvent(parseInt(b.dataset.id, 10))));
}

document.getElementById('add-event-btn').addEventListener('click', () => openEventModal(null));

function openEventModal(id) {
  const ev = id ? appData.events.find(e => e.id === id) : null;
  openModal(ev ? 'Edit Event' : 'Add Event', `
    <div class="form-group"><label class="form-label">Date</label>
      <input class="form-input" id="f-date" type="date" value="${esc(ev ? toInputDate(ev.date) : '')}" /></div>
    <div class="form-group"><label class="form-label">Title</label>
      <input class="form-input" id="f-title" value="${esc(ev ? ev.title : '')}" placeholder="Event title" /></div>
    <div class="form-group"><label class="form-label">Description</label>
      <textarea class="form-textarea" id="f-desc" placeholder="Event description">${esc(ev ? ev.desc : '')}</textarea></div>
    <div class="form-group"><label class="form-label">Category Tag</label>
      <input class="form-input" id="f-tag" value="${esc(ev ? ev.tag : '')}" placeholder="e.g. Community, Youth" /></div>
    <button class="form-btn form-btn-primary" id="save-event-btn">Save</button>
    ${ev ? '<button class="form-btn form-btn-danger" id="del-event-btn">Delete Event</button>' : ''}
  `, () => {
    document.getElementById('save-event-btn').addEventListener('click', () => {
      const date = fromInputDate(document.getElementById('f-date').value);
      const title = document.getElementById('f-title').value.trim();
      const desc = document.getElementById('f-desc').value.trim();
      const tag = document.getElementById('f-tag').value.trim();
      if (!title) return;
      if (id) {
        const idx = appData.events.findIndex(e => e.id === id);
        if (idx >= 0) appData.events[idx] = { id, date, title, desc, tag };
      } else {
        appData.events.push({ id: nextId(appData.events), date, title, desc, tag });
      }
      saveData(); closeModal();
    });
    const delBtn = document.getElementById('del-event-btn');
    if (delBtn) delBtn.addEventListener('click', () => { deleteEvent(id); closeModal(); });
  });
}

function deleteEvent(id) {
  if (!confirm('Delete this event?')) return;
  appData.events = appData.events.filter(e => e.id !== id);
  saveData();
}

// ── DIRECTORY ──
function initials(name) {
  return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

function renderDirectory(filter = '') {
  const filtered = filter
    ? (appData.members || []).filter(m =>
        m.name.toLowerCase().includes(filter.toLowerCase()) ||
        m.role.toLowerCase().includes(filter.toLowerCase()))
    : (appData.members || []);

  const list = document.getElementById('directory-list');
  if (!filtered.length) {
    list.innerHTML = '<p style="color:var(--text-muted);padding:8px 0;">No members found.</p>';
    return;
  }
  list.innerHTML = filtered.map(m => `
    <div class="member-card">
      <div class="member-avatar">${esc(initials(m.name))}</div>
      <div class="member-info">
        <div class="member-name">${esc(m.name)}</div>
        <div class="member-role">${esc(m.role)}</div>
        <div class="member-contact"><a href="tel:${m.phone.replace(/\D/g,'')}">${esc(m.phone)}</a></div>
        ${m.email ? `<div class="member-contact"><a href="mailto:${esc(m.email)}">${esc(m.email)}</a></div>` : ''}
      </div>
      <div class="card-actions admin-only">
        <button class="card-action-btn" data-action="edit-member" data-id="${m.id}">&#9998;</button>
        <button class="card-action-btn delete" data-action="del-member" data-id="${m.id}">&#128465;</button>
      </div>
    </div>`).join('');
  document.querySelectorAll('[data-action="edit-member"]').forEach(b =>
    b.addEventListener('click', () => openMemberModal(parseInt(b.dataset.id, 10))));
  document.querySelectorAll('[data-action="del-member"]').forEach(b =>
    b.addEventListener('click', () => deleteMember(parseInt(b.dataset.id, 10))));
}

document.getElementById('directory-search').addEventListener('input', e => renderDirectory(e.target.value));
document.getElementById('add-member-btn').addEventListener('click', () => openMemberModal(null));

function openMemberModal(id) {
  const m = id ? appData.members.find(x => x.id === id) : null;
  openModal(m ? 'Edit Member' : 'Add Member', `
    <div class="form-group"><label class="form-label">Full Name</label>
      <input class="form-input" id="f-name" value="${esc(m ? m.name : '')}" placeholder="Full name" /></div>
    <div class="form-group"><label class="form-label">Role / Title</label>
      <input class="form-input" id="f-role" value="${esc(m ? m.role : '')}" placeholder="e.g. Worship Director" /></div>
    <div class="form-group"><label class="form-label">Phone</label>
      <input class="form-input" id="f-phone" type="tel" value="${esc(m ? m.phone : '')}" placeholder="(555) 555-5555" /></div>
    <div class="form-group"><label class="form-label">Email</label>
      <input class="form-input" id="f-email" type="email" value="${esc(m ? m.email || '' : '')}" placeholder="email@example.com" /></div>
    <button class="form-btn form-btn-primary" id="save-member-btn">Save</button>
    ${m ? '<button class="form-btn form-btn-danger" id="del-member-btn">Remove Member</button>' : ''}
  `, () => {
    document.getElementById('save-member-btn').addEventListener('click', () => {
      const name  = document.getElementById('f-name').value.trim();
      const role  = document.getElementById('f-role').value.trim();
      const phone = document.getElementById('f-phone').value.trim();
      const email = document.getElementById('f-email').value.trim();
      if (!name) return;
      if (id) {
        const idx = appData.members.findIndex(x => x.id === id);
        if (idx >= 0) appData.members[idx] = { id, name, role, phone, email };
      } else {
        appData.members.push({ id: nextId(appData.members), name, role, phone, email });
      }
      saveData(); renderDirectory(document.getElementById('directory-search').value); closeModal();
    });
    const delBtn = document.getElementById('del-member-btn');
    if (delBtn) delBtn.addEventListener('click', () => { deleteMember(id); closeModal(); });
  });
}

function deleteMember(id) {
  if (!confirm('Remove this member?')) return;
  appData.members = appData.members.filter(m => m.id !== id);
  saveData(); renderDirectory(document.getElementById('directory-search').value);
}

// ── MEDIA ──
function renderMedia() {
  const list = document.getElementById('media-list');

  const ytHTML = ytVideos.map(v => `
    <div class="media-card yt-card">
      ${v.thumb ? `<div class="media-thumb-img"><img src="${esc(v.thumb)}" alt="${esc(v.title)}" loading="lazy" /></div>`
                : `<div class="media-thumb yt-thumb">&#9654;</div>`}
      <div class="media-body">
        <div class="media-source-badge yt-badge">&#9654; YouTube</div>
        <div class="media-title">${esc(v.title)}</div>
        <div class="media-meta">${esc(v.date)} &bull; ${esc(v.channel)}</div>
        <div class="media-footer">
          <a class="media-btn yt-btn" href="${esc(v.url)}" target="_blank">&#9654; Watch on YouTube</a>
        </div>
      </div>
    </div>`).join('');

  const manualHTML = (appData.media || []).map(m => {
    const isFB = m.source === 'facebook';
    return `
    <div class="media-card${isFB ? ' fb-card' : ''}">
      <div class="media-thumb${isFB ? ' fb-thumb' : ''}">
        ${isFB ? '&#128248;' : '&#127897;'}
      </div>
      <div class="media-body">
        ${isFB ? '<div class="media-source-badge fb-badge">&#128248; Facebook</div>' : ''}
        ${m.series ? `<div class="media-series">${esc(m.series)}</div>` : ''}
        <div class="media-title">${esc(m.title)}</div>
        <div class="media-meta">${esc(m.date)}${m.pastor ? ' &bull; ' + esc(m.pastor) : ''}</div>
        <div class="media-footer">
          <a class="media-btn${isFB ? ' fb-btn' : ''}" href="${esc(m.url)}" target="_blank">
            &#9654; Watch${isFB ? ' on Facebook' : ''}
          </a>
          <div class="card-actions admin-only">
            <button class="card-action-btn" data-action="edit-media" data-id="${m.id}">&#9998;</button>
            <button class="card-action-btn delete" data-action="del-media" data-id="${m.id}">&#128465;</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  if (!ytHTML && !manualHTML) {
    list.innerHTML = '<p style="color:var(--text-muted);padding:8px 0;">No recordings yet. YouTube videos will appear here automatically once you add your channel in Settings.</p>';
    return;
  }
  list.innerHTML = ytHTML + manualHTML;
  document.querySelectorAll('[data-action="edit-media"]').forEach(b =>
    b.addEventListener('click', () => openMediaModal(parseInt(b.dataset.id, 10))));
  document.querySelectorAll('[data-action="del-media"]').forEach(b =>
    b.addEventListener('click', () => deleteMedia(parseInt(b.dataset.id, 10))));
}

document.getElementById('add-media-btn').addEventListener('click', () => openMediaModal(null));

function openMediaModal(id) {
  const m = id ? appData.media.find(x => x.id === id) : null;
  const src = m ? (m.source || 'other') : 'facebook';
  openModal(m ? 'Edit Recording' : 'Add Recording', `
    <div class="form-group"><label class="form-label">Platform</label>
      <select class="form-input" id="f-source">
        <option value="facebook" ${src === 'facebook' ? 'selected' : ''}>&#128248; Facebook Video</option>
        <option value="other"    ${src === 'other'    ? 'selected' : ''}>&#127897; Other / Audio</option>
      </select></div>
    <div class="form-group"><label class="form-label">Series / Service Name</label>
      <input class="form-input" id="f-series" value="${esc(m ? m.series || '' : '')}" placeholder="e.g. Sunday Service" /></div>
    <div class="form-group"><label class="form-label">Title</label>
      <input class="form-input" id="f-title" value="${esc(m ? m.title : '')}" placeholder="Sermon title" /></div>
    <div class="form-group"><label class="form-label">Date</label>
      <input class="form-input" id="f-date" type="date" value="${esc(m ? toInputDate(m.date) : '')}" /></div>
    <div class="form-group"><label class="form-label">Speaker</label>
      <input class="form-input" id="f-pastor" value="${esc(m ? m.pastor || '' : '')}" placeholder="Speaker name" /></div>
    <div class="form-group"><label class="form-label">Video URL</label>
      <input class="form-input" id="f-url" type="url" value="${esc(m && m.url !== '#' ? m.url : '')}"
        placeholder="Paste the Facebook or video link here" /></div>
    <button class="form-btn form-btn-primary" id="save-media-btn">Save</button>
    ${m ? '<button class="form-btn form-btn-danger" id="del-media-btn">Delete</button>' : ''}
  `, () => {
    document.getElementById('save-media-btn').addEventListener('click', () => {
      const source = document.getElementById('f-source').value;
      const series = document.getElementById('f-series').value.trim();
      const title  = document.getElementById('f-title').value.trim();
      const date   = fromInputDate(document.getElementById('f-date').value);
      const pastor = document.getElementById('f-pastor').value.trim();
      const url    = document.getElementById('f-url').value.trim() || '#';
      if (!title) return;
      if (id) {
        const idx = appData.media.findIndex(x => x.id === id);
        if (idx >= 0) appData.media[idx] = { id, source, series, title, date, pastor, url };
      } else {
        appData.media.push({ id: nextId(appData.media), source, series, title, date, pastor, url });
      }
      saveData(); closeModal();
    });
    const delBtn = document.getElementById('del-media-btn');
    if (delBtn) delBtn.addEventListener('click', () => { deleteMedia(id); closeModal(); });
  });
}

function deleteMedia(id) {
  if (!confirm('Delete this recording?')) return;
  appData.media = appData.media.filter(m => m.id !== id);
  saveData();
}

// ── SETTINGS ──
function initSettings() {
  // Load persisted settings from Firestore
  settingsRef.once('value').then(snap => {
    const data = snap.exists() ? snap.val() : {};
    const userSettings = (data[currentUser.username]) || {};

    const nameInput = document.getElementById('settings-display-name');
    if (nameInput) nameInput.value = userSettings.displayName || currentUser.displayName || '';

    const prefs = userSettings.notifPrefs || {};
    ['events', 'services', 'live', 'classes'].forEach(key => {
      const el = document.getElementById('notif-' + key);
      if (el) el.checked = !!(prefs[key]);
    });
  }).catch(() => {
    // Fall back to localStorage if Firestore unavailable
    const users = getUsers();
    const user  = users[currentUser.username] || {};
    const nameInput = document.getElementById('settings-display-name');
    if (nameInput) nameInput.value = user.displayName || '';
    const prefs = JSON.parse(localStorage.getItem(NOTIF_KEY) || '{}');
    ['events', 'services', 'live', 'classes'].forEach(key => {
      const el = document.getElementById('notif-' + key);
      if (el) el.checked = !!(prefs[key]);
    });
  });

  // Save profile button
  const saveBtn = document.getElementById('settings-save-btn');
  if (saveBtn) {
    saveBtn.replaceWith(saveBtn.cloneNode(true));
    document.getElementById('settings-save-btn').addEventListener('click', saveProfile);
  }

  // Notification toggles
  ['events', 'services', 'live', 'classes'].forEach(key => {
    const el = document.getElementById('notif-' + key);
    if (!el) return;
    el.replaceWith(el.cloneNode(true));
    document.getElementById('notif-' + key).addEventListener('change', e => {
      handleNotifToggle(key, e.target.checked);
    });
  });
}

function saveUserSettings(patch) {
  settingsRef.once('value').then(snap => {
    const data = snap.exists() ? snap.val() : {};
    data[currentUser.username] = Object.assign(data[currentUser.username] || {}, patch);
    settingsRef.set(data);
  }).catch(() => {
    // localStorage fallback
    if (patch.displayName) {
      const users = getUsers();
      if (users[currentUser.username]) {
        users[currentUser.username].displayName = patch.displayName;
        saveUsers(users);
      }
    }
    if (patch.notifPrefs) localStorage.setItem(NOTIF_KEY, JSON.stringify(patch.notifPrefs));
  });
}

function saveProfile() {
  const msgEl      = document.getElementById('settings-profile-msg');
  const displayName = document.getElementById('settings-display-name').value.trim();
  const currentPw  = document.getElementById('settings-current-pw').value;
  const newPw      = document.getElementById('settings-new-pw').value;
  const confirmPw  = document.getElementById('settings-confirm-pw').value;

  const users = getUsers();
  const user  = users[currentUser.username];

  if (!user || user.password !== currentPw) {
    msgEl.textContent = 'Current password is incorrect.';
    msgEl.className = 'settings-msg error';
    return;
  }

  if (newPw && newPw !== confirmPw) {
    msgEl.textContent = 'New passwords do not match.';
    msgEl.className = 'settings-msg error';
    return;
  }

  if (newPw && newPw.length < 6) {
    msgEl.textContent = 'New password must be at least 6 characters.';
    msgEl.className = 'settings-msg error';
    return;
  }

  user.displayName = displayName;
  if (newPw) user.password = newPw;
  saveUsers(users);

  currentUser.displayName = displayName;
  localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));

  saveUserSettings({ displayName });

  document.getElementById('settings-current-pw').value = '';
  document.getElementById('settings-new-pw').value     = '';
  document.getElementById('settings-confirm-pw').value = '';

  msgEl.textContent = 'Profile saved successfully!';
  msgEl.className = 'settings-msg success';
  setTimeout(() => { if (msgEl) msgEl.textContent = ''; }, 3000);
}

async function handleNotifToggle(key, enabled) {
  if (!enabled) {
    updateNotifPref(key, false);
    return;
  }

  if (!('Notification' in window)) {
    alert('Your browser does not support notifications.');
    document.getElementById('notif-' + key).checked = false;
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    updateNotifPref(key, true);
  } else {
    document.getElementById('notif-' + key).checked = false;
    alert('Please enable notifications in your device settings for this app.');
  }
}

function updateNotifPref(key, value) {
  settingsRef.once('value').then(snap => {
    const data = snap.exists() ? snap.val() : {};
    const userSettings = data[currentUser.username] || {};
    userSettings.notifPrefs = userSettings.notifPrefs || {};
    userSettings.notifPrefs[key] = value;
    data[currentUser.username] = userSettings;
    settingsRef.set(data);
  }).catch(() => {
    const prefs = JSON.parse(localStorage.getItem(NOTIF_KEY) || '{}');
    prefs[key] = value;
    localStorage.setItem(NOTIF_KEY, JSON.stringify(prefs));
  });
}

// ── Modal system ──
function openModal(title, bodyHtml, onReady) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-card').scrollTop = 0;
  if (title === 'Edit Service Times') bindServicesForm();
  if (onReady) onReady();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

document.getElementById('modal-close-btn').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

// ── Init ──
tryAutoLogin();
