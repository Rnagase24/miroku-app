// ── Firebase ──
const firebaseConfig = {
  apiKey:            'AIzaSyCVqbMV3bEkQ_thDAvFCDQltXR9eERAtfA',
  authDomain:        'miroku-app-915e2.firebaseapp.com',
  projectId:         'miroku-app-915e2',
  storageBucket:     'miroku-app-915e2.firebasestorage.app',
  messagingSenderId: '540305307612',
  appId:             '1:540305307612:web:a7c16561030a075d334119'
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

const churchDoc = db.collection('church').doc('data');

// ── Auth ──
const SESSION_KEY = 'miroku-session';
const USERS_KEY   = 'miroku-users';

function getUsers() {
  try {
    const stored = localStorage.getItem(USERS_KEY);
    return stored ? JSON.parse(stored) : getDefaultUsers();
  } catch { return getDefaultUsers(); }
}

function getDefaultUsers() {
  return {
    admin:  { password: 'MirokuAdmin2025',  role: 'admin'  },
    member: { password: 'MirokuMember2025', role: 'member' }
  };
}

let currentUser = null;

function checkSession() {
  try {
    const saved = localStorage.getItem(SESSION_KEY);
    if (saved) { currentUser = JSON.parse(saved); return true; }
  } catch {}
  return false;
}

function login(username, password) {
  const users = getUsers();
  const key   = username.toLowerCase().trim();
  const user  = users[key];
  if (user && user.password === password) {
    currentUser = { username: key, role: user.role };
    localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
    return true;
  }
  return false;
}

function logout() {
  currentUser = null;
  localStorage.removeItem(SESSION_KEY);
  unsubscribeData();
  showApp(false);
}

function isAdmin() {
  return currentUser && currentUser.role === 'admin';
}

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
  contact: {
    phone: '(323) 555-0100',
    email: 'info@mirokuLA.org'
  },
  events: [
    { id: 1, date: 'Sun, May 11', title: "Mother's Day Celebration",   desc: 'A special service honoring all mothers. Flowers provided.',           tag: 'Special Service'  },
    { id: 2, date: 'Sat, May 17', title: 'Community Food Drive',        desc: 'Help pack food boxes for families in need. Volunteers welcome!',      tag: 'Community'        },
    { id: 3, date: 'Fri, May 23', title: 'Youth Game Night',            desc: 'Fun and fellowship for teens. Bring a friend! Snacks provided.',      tag: 'Youth'            },
    { id: 4, date: 'Sun, Jun 1',  title: 'Summer Kickoff Cookout',      desc: 'Join us after the 10:30 AM service for a cookout on the lawn.',       tag: 'Fellowship'       },
    { id: 5, date: 'Sat, Jun 7',  title: "Men's Breakfast",             desc: "Monthly men's breakfast and Bible study. 8:00 AM in Fellowship Hall.", tag: "Men's Ministry"   },
    { id: 6, date: 'Sat, Jun 14', title: "Women's Bible Study Retreat", desc: 'A one-day retreat for women — worship, prayer, and fellowship.',      tag: "Women's Ministry" }
  ],
  members: [
    { id: 1, name: 'Pastor David Williams', role: 'Senior Pastor',        phone: '(323) 555-0101' },
    { id: 2, name: 'Sarah Johnson',         role: 'Worship Director',     phone: '(323) 555-0102' },
    { id: 3, name: 'Michael Thompson',      role: 'Youth Pastor',         phone: '(323) 555-0103' },
    { id: 4, name: 'Lisa Martinez',         role: "Children's Ministry",  phone: '(323) 555-0104' },
    { id: 5, name: 'Robert Chen',           role: 'Deacon',               phone: '(323) 555-0105' },
    { id: 6, name: 'Amanda Davis',          role: 'Church Administrator', phone: '(323) 555-0100' },
    { id: 7, name: 'James Wilson',          role: 'Elder',                phone: '(323) 555-0106' },
    { id: 8, name: 'Patricia Moore',        role: 'Prayer Team Lead',     phone: '(323) 555-0107' }
  ],
  media: [
    { id: 1, series: 'Faith That Moves Mountains', title: 'When God Says Wait',             date: 'May 4, 2025',  pastor: 'Pastor David Williams', url: '#' },
    { id: 2, series: 'Faith That Moves Mountains', title: 'The Power of Persistent Prayer', date: 'Apr 27, 2025', pastor: 'Pastor David Williams', url: '#' },
    { id: 3, series: 'Rooted',                     title: 'Finding Peace in the Storm',     date: 'Apr 20, 2025', pastor: 'Michael Thompson',      url: '#' },
    { id: 4, series: 'Rooted',                     title: 'Grace Greater Than Our Sin',     date: 'Apr 13, 2025', pastor: 'Pastor David Williams', url: '#' }
  ]
};

// ── Firestore data layer ──
let appData = null;
let dataUnsubscribe = null;

function subscribeData() {
  // Show default data immediately so the app is never blank
  appData = deepCopy(DEFAULT_DATA);
  renderAll();

  showLoading(true);
  dataUnsubscribe = churchDoc.onSnapshot(snap => {
    if (snap.exists()) {
      appData = snap.data();
    } else {
      // First run: write defaults to Firestore
      churchDoc.set(appData).catch(err => console.error('Init error:', err));
    }
    renderAll();
    showLoading(false);
  }, err => {
    console.error('Firestore error:', err);
    showLoading(false);
  });
}

function unsubscribeData() {
  if (dataUnsubscribe) { dataUnsubscribe(); dataUnsubscribe = null; }
}

function saveData() {
  renderAll();
  churchDoc.set(appData).catch(err => console.error('Save error:', err));
}

function deepCopy(obj) { return JSON.parse(JSON.stringify(obj)); }

function nextId(arr) {
  return arr.length ? Math.max(...arr.map(x => x.id)) + 1 : 1;
}

// ── XSS helpers ──
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Loading indicator ──
function showLoading(on) {
  let el = document.getElementById('loading-bar');
  if (!el) {
    el = document.createElement('div');
    el.id = 'loading-bar';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;height:3px;background:var(--gold);z-index:9999;transition:opacity 0.3s';
    document.body.appendChild(el);
  }
  el.style.opacity = on ? '1' : '0';
}

// ── Login form ──
document.getElementById('login-form').addEventListener('submit', e => {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');

  if (login(username, password)) {
    errEl.textContent = '';
    document.getElementById('login-password').value = '';
    showApp(true);
  } else {
    errEl.textContent = 'Incorrect username or password.';
    document.getElementById('login-password').value = '';
  }
});

// ── Show / hide app ──
function showApp(visible) {
  const loginScreen = document.getElementById('login-screen');
  const header      = document.getElementById('app-header');
  const main        = document.getElementById('app-main');
  const nav         = document.getElementById('bottom-nav');
  const adminBadge  = document.getElementById('admin-badge');

  loginScreen.classList.toggle('hidden', visible);
  header.classList.toggle('hidden', !visible);
  main.classList.toggle('hidden', !visible);
  nav.classList.toggle('hidden', !visible);

  if (visible) {
    adminBadge.classList.toggle('hidden', !isAdmin());
    document.body.classList.toggle('is-admin', isAdmin());
    subscribeData();
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

// ── Render all ──
function renderAll() {
  renderServices();
  renderLocation();
  renderContact();
  renderEvents();
  renderDirectory();
  renderMedia();
}

// ── HOME: Service Times ──
function renderServices() {
  document.getElementById('services-list').innerHTML = appData.services.map(s => `
    <div class="card">
      <div class="card-icon">${esc(s.icon)}</div>
      <div class="card-body">
        <h4>${esc(s.title)}</h4>
        <p>${esc(s.time)}</p>
      </div>
    </div>
  `).join('') || '<p style="color:var(--text-muted)">No service times added yet.</p>';
}

document.getElementById('edit-services-btn').addEventListener('click', openServicesModal);

function openServicesModal() {
  openModal('Edit Service Times', buildServicesForm());
}

function buildServicesForm() {
  const rows = appData.services.map((s, i) => `
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
      const id = parseInt(btn.dataset.id, 10);
      appData.services = appData.services.filter(s => s.id !== id);
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
    saveData();
    closeModal();
  });
}

// ── HOME: Location ──
function renderLocation() {
  const loc = appData.location;
  document.getElementById('location-container').innerHTML = `
    <div class="card location-card">
      <div class="card-icon">&#128205;</div>
      <div class="card-body">
        <h4>${esc(loc.address)}</h4>
        <p>${esc(loc.city)}</p>
        <a class="link-button" href="${esc(loc.mapsUrl)}" target="_blank">Get Directions</a>
      </div>
    </div>
  `;
}

document.getElementById('edit-location-btn').addEventListener('click', () => {
  const loc = appData.location;
  const c   = appData.contact;
  openModal('Edit Location & Contact', `
    <div class="form-group">
      <label class="form-label">Street Address</label>
      <input class="form-input" id="f-address" value="${esc(loc.address)}" placeholder="Street address" />
    </div>
    <div class="form-group">
      <label class="form-label">City, State, ZIP</label>
      <input class="form-input" id="f-city" value="${esc(loc.city)}" placeholder="City, State ZIP" />
    </div>
    <div class="form-group">
      <label class="form-label">Google Maps URL</label>
      <input class="form-input" id="f-maps" type="url" value="${esc(loc.mapsUrl)}" placeholder="https://maps.google.com/..." />
    </div>
    <div class="form-group">
      <label class="form-label">Phone</label>
      <input class="form-input" id="f-phone" type="tel" value="${esc(c.phone)}" placeholder="(555) 555-5555" />
    </div>
    <div class="form-group">
      <label class="form-label">Email</label>
      <input class="form-input" id="f-email" type="email" value="${esc(c.email)}" placeholder="info@church.org" />
    </div>
    <button class="form-btn form-btn-primary" id="save-location-btn">Save</button>
  `, () => {
    document.getElementById('save-location-btn').addEventListener('click', () => {
      appData.location.address = document.getElementById('f-address').value.trim();
      appData.location.city    = document.getElementById('f-city').value.trim();
      appData.location.mapsUrl = document.getElementById('f-maps').value.trim();
      appData.contact.phone    = document.getElementById('f-phone').value.trim();
      appData.contact.email    = document.getElementById('f-email').value.trim();
      saveData();
      closeModal();
    });
  });
});

// ── HOME: Contact ──
function renderContact() {
  const c = appData.contact;
  document.getElementById('contact-list').innerHTML = `
    <div class="card">
      <div class="card-icon">&#128222;</div>
      <div class="card-body">
        <h4>Phone</h4>
        <p><a href="tel:${c.phone.replace(/\D/g, '')}">${esc(c.phone)}</a></p>
      </div>
    </div>
    <div class="card">
      <div class="card-icon">&#9993;</div>
      <div class="card-body">
        <h4>Email</h4>
        <p><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></p>
      </div>
    </div>
  `;
}

// ── EVENTS ──
function renderEvents() {
  const list = document.getElementById('events-list');
  if (!appData.events.length) {
    list.innerHTML = '<p style="color:var(--text-muted);padding:8px 0;">No upcoming events.</p>';
    return;
  }
  list.innerHTML = appData.events.map(e => `
    <div class="event-card">
      <div class="event-card-top">
        <div>
          <div class="event-date">${esc(e.date)}</div>
          <div class="event-title">${esc(e.title)}</div>
        </div>
        <div class="card-actions admin-only">
          <button class="card-action-btn" data-action="edit-event" data-id="${e.id}">&#9998;</button>
          <button class="card-action-btn delete" data-action="del-event" data-id="${e.id}">&#128465;</button>
        </div>
      </div>
      <div class="event-desc">${esc(e.desc)}</div>
      <span class="event-tag">${esc(e.tag)}</span>
    </div>
  `).join('');

  document.querySelectorAll('[data-action="edit-event"]').forEach(btn =>
    btn.addEventListener('click', () => openEventModal(parseInt(btn.dataset.id, 10)))
  );
  document.querySelectorAll('[data-action="del-event"]').forEach(btn =>
    btn.addEventListener('click', () => deleteEvent(parseInt(btn.dataset.id, 10)))
  );
}

document.getElementById('add-event-btn').addEventListener('click', () => openEventModal(null));

function openEventModal(id) {
  const ev = id ? appData.events.find(e => e.id === id) : null;
  openModal(ev ? 'Edit Event' : 'Add Event', `
    <div class="form-group">
      <label class="form-label">Date</label>
      <input class="form-input" id="f-date" value="${esc(ev ? ev.date : '')}" placeholder="e.g. Sun, Jun 1" />
    </div>
    <div class="form-group">
      <label class="form-label">Title</label>
      <input class="form-input" id="f-title" value="${esc(ev ? ev.title : '')}" placeholder="Event title" />
    </div>
    <div class="form-group">
      <label class="form-label">Description</label>
      <textarea class="form-textarea" id="f-desc" placeholder="Event description">${esc(ev ? ev.desc : '')}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Category Tag</label>
      <input class="form-input" id="f-tag" value="${esc(ev ? ev.tag : '')}" placeholder="e.g. Community, Youth" />
    </div>
    <button class="form-btn form-btn-primary" id="save-event-btn">Save</button>
    ${ev ? `<button class="form-btn form-btn-danger" id="del-event-btn">Delete Event</button>` : ''}
  `, () => {
    document.getElementById('save-event-btn').addEventListener('click', () => {
      const date  = document.getElementById('f-date').value.trim();
      const title = document.getElementById('f-title').value.trim();
      const desc  = document.getElementById('f-desc').value.trim();
      const tag   = document.getElementById('f-tag').value.trim();
      if (!title) return;
      if (id) {
        const idx = appData.events.findIndex(e => e.id === id);
        if (idx >= 0) appData.events[idx] = { id, date, title, desc, tag };
      } else {
        appData.events.push({ id: nextId(appData.events), date, title, desc, tag });
      }
      saveData();
      closeModal();
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
    ? appData.members.filter(m =>
        m.name.toLowerCase().includes(filter.toLowerCase()) ||
        m.role.toLowerCase().includes(filter.toLowerCase())
      )
    : appData.members;

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
        <div class="member-contact"><a href="tel:${m.phone.replace(/\D/g, '')}">${esc(m.phone)}</a></div>
      </div>
      <div class="card-actions admin-only">
        <button class="card-action-btn" data-action="edit-member" data-id="${m.id}">&#9998;</button>
        <button class="card-action-btn delete" data-action="del-member" data-id="${m.id}">&#128465;</button>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('[data-action="edit-member"]').forEach(btn =>
    btn.addEventListener('click', () => openMemberModal(parseInt(btn.dataset.id, 10)))
  );
  document.querySelectorAll('[data-action="del-member"]').forEach(btn =>
    btn.addEventListener('click', () => deleteMember(parseInt(btn.dataset.id, 10)))
  );
}

document.getElementById('directory-search').addEventListener('input', e => renderDirectory(e.target.value));
document.getElementById('add-member-btn').addEventListener('click', () => openMemberModal(null));

function openMemberModal(id) {
  const m = id ? appData.members.find(x => x.id === id) : null;
  openModal(m ? 'Edit Member' : 'Add Member', `
    <div class="form-group">
      <label class="form-label">Full Name</label>
      <input class="form-input" id="f-name" value="${esc(m ? m.name : '')}" placeholder="Full name" />
    </div>
    <div class="form-group">
      <label class="form-label">Role / Title</label>
      <input class="form-input" id="f-role" value="${esc(m ? m.role : '')}" placeholder="e.g. Worship Director" />
    </div>
    <div class="form-group">
      <label class="form-label">Phone</label>
      <input class="form-input" id="f-phone" type="tel" value="${esc(m ? m.phone : '')}" placeholder="(555) 555-5555" />
    </div>
    <button class="form-btn form-btn-primary" id="save-member-btn">Save</button>
    ${m ? `<button class="form-btn form-btn-danger" id="del-member-btn">Remove Member</button>` : ''}
  `, () => {
    document.getElementById('save-member-btn').addEventListener('click', () => {
      const name  = document.getElementById('f-name').value.trim();
      const role  = document.getElementById('f-role').value.trim();
      const phone = document.getElementById('f-phone').value.trim();
      if (!name) return;
      if (id) {
        const idx = appData.members.findIndex(x => x.id === id);
        if (idx >= 0) appData.members[idx] = { id, name, role, phone };
      } else {
        appData.members.push({ id: nextId(appData.members), name, role, phone });
      }
      saveData();
      closeModal();
    });
    const delBtn = document.getElementById('del-member-btn');
    if (delBtn) delBtn.addEventListener('click', () => { deleteMember(id); closeModal(); });
  });
}

function deleteMember(id) {
  if (!confirm('Remove this member?')) return;
  appData.members = appData.members.filter(m => m.id !== id);
  saveData();
}

// ── MEDIA ──
function renderMedia() {
  const list = document.getElementById('media-list');
  if (!appData.media.length) {
    list.innerHTML = '<p style="color:var(--text-muted);padding:8px 0;">No sermons yet.</p>';
    return;
  }
  list.innerHTML = appData.media.map(m => `
    <div class="media-card">
      <div class="media-thumb">&#127897;</div>
      <div class="media-body">
        <div class="media-series">${esc(m.series)}</div>
        <div class="media-title">${esc(m.title)}</div>
        <div class="media-meta">${esc(m.date)} &bull; ${esc(m.pastor)}</div>
        <div class="media-footer">
          <a class="media-btn" href="${esc(m.url)}" target="_blank">&#9654; Listen</a>
          <div class="card-actions admin-only">
            <button class="card-action-btn" data-action="edit-media" data-id="${m.id}">&#9998;</button>
            <button class="card-action-btn delete" data-action="del-media" data-id="${m.id}">&#128465;</button>
          </div>
        </div>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('[data-action="edit-media"]').forEach(btn =>
    btn.addEventListener('click', () => openMediaModal(parseInt(btn.dataset.id, 10)))
  );
  document.querySelectorAll('[data-action="del-media"]').forEach(btn =>
    btn.addEventListener('click', () => deleteMedia(parseInt(btn.dataset.id, 10)))
  );
}

document.getElementById('add-media-btn').addEventListener('click', () => openMediaModal(null));

function openMediaModal(id) {
  const m = id ? appData.media.find(x => x.id === id) : null;
  openModal(m ? 'Edit Sermon' : 'Add Sermon', `
    <div class="form-group">
      <label class="form-label">Series Name</label>
      <input class="form-input" id="f-series" value="${esc(m ? m.series : '')}" placeholder="Series name" />
    </div>
    <div class="form-group">
      <label class="form-label">Sermon Title</label>
      <input class="form-input" id="f-title" value="${esc(m ? m.title : '')}" placeholder="Sermon title" />
    </div>
    <div class="form-group">
      <label class="form-label">Date</label>
      <input class="form-input" id="f-date" value="${esc(m ? m.date : '')}" placeholder="e.g. May 4, 2025" />
    </div>
    <div class="form-group">
      <label class="form-label">Speaker</label>
      <input class="form-input" id="f-pastor" value="${esc(m ? m.pastor : '')}" placeholder="Speaker name" />
    </div>
    <div class="form-group">
      <label class="form-label">Audio / Video URL</label>
      <input class="form-input" id="f-url" type="url" value="${esc(m && m.url !== '#' ? m.url : '')}" placeholder="https://..." />
    </div>
    <button class="form-btn form-btn-primary" id="save-media-btn">Save</button>
    ${m ? `<button class="form-btn form-btn-danger" id="del-media-btn">Delete Sermon</button>` : ''}
  `, () => {
    document.getElementById('save-media-btn').addEventListener('click', () => {
      const series = document.getElementById('f-series').value.trim();
      const title  = document.getElementById('f-title').value.trim();
      const date   = document.getElementById('f-date').value.trim();
      const pastor = document.getElementById('f-pastor').value.trim();
      const url    = document.getElementById('f-url').value.trim() || '#';
      if (!title) return;
      if (id) {
        const idx = appData.media.findIndex(x => x.id === id);
        if (idx >= 0) appData.media[idx] = { id, series, title, date, pastor, url };
      } else {
        appData.media.push({ id: nextId(appData.media), series, title, date, pastor, url });
      }
      saveData();
      closeModal();
    });
    const delBtn = document.getElementById('del-media-btn');
    if (delBtn) delBtn.addEventListener('click', () => { deleteMedia(id); closeModal(); });
  });
}

function deleteMedia(id) {
  if (!confirm('Delete this sermon?')) return;
  appData.media = appData.media.filter(m => m.id !== id);
  saveData();
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
if (checkSession()) {
  showApp(true);
}
