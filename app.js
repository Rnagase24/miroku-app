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
const churchRef    = db.ref('church/data');
const settingsRef  = db.ref('church/settings');
const accountsRef  = db.ref('church/accounts');
const signinLogRef = db.ref('church/signinLog');
// Member submissions live outside church/data: that node is admin-write only,
// and prayer requests are private to the person who sent them.
const prayerRequestsRef = db.ref('church/prayerRequests');
const soreiRequestsRef  = db.ref('church/soreiRequests');
const pushSubsRef       = db.ref('church/pushSubs');
// Appointments are nested per member so a member can read their own without
// being able to read anyone else's.
const appointmentsRef   = db.ref('church/appointments');

// ── Auth (Firebase Authentication) ──
// Credentials live in Firebase Auth (Google hashes the passwords); profile and
// role live in church/users/{uid}. Nothing here ever stores a password.
const USERS_KEY = 'miroku-users';
const NOTIF_KEY = 'miroku-notif';

const auth     = firebase.auth();
const usersRef = db.ref('church/users');

// Profiles are stored keyed by Firebase Auth uid, but the rest of the app
// looks accounts up by username. getUsers() returns a username-keyed view so
// existing call sites keep working; saveUsers() maps it back to uid keys.
let profilesByUid = null; // null = not yet loaded
let usersCache    = null;

function usernameFor(uid, profile) {
  return profile.username || String(profile.email || uid).split('@')[0].toLowerCase();
}

function rebuildUsersCache() {
  const byName = {};
  Object.entries(profilesByUid || {}).forEach(([uid, p]) => {
    byName[usernameFor(uid, p)] = { ...p, uid };
  });
  usersCache = byName;
  try { localStorage.setItem(USERS_KEY, JSON.stringify(byName)); } catch {}
  return byName;
}

function getUsers() {
  if (usersCache !== null) return usersCache;
  try {
    const s = localStorage.getItem(USERS_KEY);
    return s ? JSON.parse(s) : {};
  } catch { return {}; }
}

// Write a single profile. Security rules only let a member write their own
// node, so self-updates must go through here rather than a whole-map set().
function saveUserProfile(uid, profile) {
  const clean = { ...profile };
  delete clean.uid;
  delete clean.password; // never persist a password again
  profilesByUid = { ...(profilesByUid || {}), [uid]: clean };
  rebuildUsersCache();
  return usersRef.child(uid).set(clean).catch(err => {
    console.error('Profile sync error:', err);
    showToast('Could not save to the server — check your connection.', 'error');
  });
}

// Whole-map write. Rules restrict this to admins.
function saveUsers(users) {
  const byUid = {};
  Object.entries(users).forEach(([uname, u]) => {
    const uid = u.uid;
    if (!uid) return; // no uid == no Firebase Auth account; skip
    const clean = { ...u, username: u.username || uname };
    delete clean.uid;
    delete clean.password;
    byUid[uid] = clean;
  });
  profilesByUid = byUid;
  rebuildUsersCache();
  usersRef.set(byUid).catch(err => {
    console.error('Account sync error:', err);
    showToast('Could not sync accounts — admin permission required.', 'error');
  });
}

async function loadProfiles() {
  const snap = await usersRef.once('value');
  profilesByUid = snap.exists() ? snap.val() : {};
  return rebuildUsersCache();
}

function myProfile() {
  if (!currentUser) return null;
  return (profilesByUid || {})[currentUser.uid] || null;
}

// Kept for call sites that refresh the account list before acting on it.
async function loadUsersFromFirestore() {
  try { await loadProfiles(); }
  catch { /* offline — getUsers() falls back to the cached copy */ }
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

function formatLastSeen(iso) {
  if (!iso) return 'Never signed in';
  const d    = new Date(iso);
  const diff = Math.floor((Date.now() - d) / 1000);
  if (diff < 60)   return 'Just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return d.toLocaleDateString();
}

function logSignIn() {
  if (!currentUser) return;
  const now = new Date().toISOString();
  const p   = myProfile();
  if (p) saveUserProfile(currentUser.uid, { ...p, lastSeen: now });
  signinLogRef.push({
    uid:         currentUser.uid,
    username:    currentUser.username,
    displayName: currentUser.displayName || currentUser.username,
    timestamp:   now
  }).catch(() => {});
}

function checkProfileCompletion() {
  if (!currentUser) return;
  const p = myProfile();
  if (p && p.profileComplete !== true) openMandatoryProfileModal(p);
}

let currentUser = null;

function isAdmin() { return currentUser && currentUser.role === 'admin'; }

// Turn a Firebase Auth error into something a church member can act on.
function authErrorMessage(err) {
  switch (err && err.code) {
    case 'auth/invalid-email':         return 'That does not look like a valid email address.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password. If the password was filled in for you, it may be an old saved one — clear the box and type your current password.';
    case 'auth/too-many-requests':     return 'Too many attempts. Please wait a few minutes and try again.';
    case 'auth/email-already-in-use':  return 'An account already exists for that email. Try signing in instead.';
    case 'auth/weak-password':         return 'Password must be at least 6 characters.';
    case 'auth/network-request-failed':return 'No connection — check your internet and try again.';
    case 'auth/operation-not-allowed':
    case 'auth/configuration-not-found':
      return 'Email sign-in is not switched on for this app yet. Please contact a church admin.';
    default:
      console.error('Auth error:', err);
      return 'Something went wrong signing in. Please try again.';
  }
}

// Creating an Auth account fires onAuthStateChanged immediately — before the
// matching profile has been written. This gate makes the listener wait rather
// than racing ahead and seeding a blank profile over the real one.
let provisioning = null;
function beginProvisioning() {
  let done;
  provisioning = new Promise(resolve => { done = resolve; });
  return () => { done(); provisioning = null; };
}

// Sign in. If no Firebase Auth account exists yet but a legacy account with a
// matching password does, migrate it transparently (see migrateLegacyAccount).
async function signIn(email, password) {
  const addr = String(email || '').trim().toLowerCase();
  try {
    await auth.signInWithEmailAndPassword(addr, password);
    return { ok: true };
  } catch (err) {
    if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
      const migrated = await migrateLegacyAccount(addr, password);
      if (migrated) return { ok: true };
    }
    return { ok: false, message: authErrorMessage(err) };
  }
}

// One-time upgrade of an account created under the old plaintext system.
// Only succeeds if the password the member typed matches the stored one, so
// this cannot be used to claim someone else's account.
async function migrateLegacyAccount(email, password) {
  let legacy = null;
  try {
    const snap = await accountsRef.once('value');
    if (!snap.exists()) return false;
    const entry = Object.entries(snap.val()).find(([, u]) =>
      String(u.email || '').trim().toLowerCase() === email && u.password === password
    );
    if (!entry) return false;
    legacy = { username: entry[0], ...entry[1] };
  } catch {
    return false; // accounts node already locked down — nothing to migrate
  }

  const finish = beginProvisioning();
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    const uid  = cred.user.uid;
    const { password: _pw, ...rest } = legacy;
    await usersRef.child(uid).set({
      ...rest,
      email,
      username: legacy.username,
      role:     legacy.role === 'admin' ? 'admin' : 'member',
      migratedAt: new Date().toISOString()
    });
    // Drop the plaintext password now that Firebase Auth owns the credential.
    await accountsRef.child(legacy.username).remove().catch(() => {});
    return true;
  } finally {
    finish();
  }
}

async function logout() {
  unsubscribeData();
  if ('credentials' in navigator) {
    navigator.credentials.preventSilentAccess().catch(() => {});
  }
  try { await auth.signOut(); } catch {}
}

// ── Default Data ──
const DEFAULT_DATA = {
  services: [
    { id: 1, icon: '☀️', title: 'Sunday Service', time: '11:00 AM',
      recurrence: { weekday: 0, nths: [2, 4] } },
    { id: 2, icon: '🌆', title: 'Wednesday Evening Teachings', time: '6:30 PM',
      recurrence: { weekday: 3, nths: [] } }
  ],
  location: {
    address: '123 Main Street',
    city: 'Los Angeles, CA 90001',
    mapsUrl: 'https://maps.google.com/?q=123+Main+Street+Los+Angeles+CA'
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
    { id: 5, date: 'Sat, Jun 7',  title: "Men's Breakfast",  desc: "Monthly men's breakfast and study of the teachings. 8:00 AM in the Fellowship Hall.", tag: "Men's Group"   },
    { id: 6, date: 'Sat, Jun 14', title: "Women's Retreat",  desc: 'A one-day retreat for women — study, prayer, and fellowship.',                        tag: "Women's Group" }
  ],
  members: [
    { id: 1, name: 'David Williams',        role: 'Head Minister',        phone: '(323) 555-0101', email: 'david@mirokuLA.org'    },
    { id: 2, name: 'Sarah Johnson',         role: 'Services Director',    phone: '(323) 555-0102', email: 'sarah@mirokuLA.org'    },
    { id: 3, name: 'Michael Thompson',      role: 'Youth Minister',       phone: '(323) 555-0103', email: 'michael@mirokuLA.org'  },
    { id: 4, name: 'Lisa Martinez',         role: "Children's Group",     phone: '(323) 555-0104', email: 'lisa@mirokuLA.org'     },
    { id: 5, name: 'Robert Chen',           role: 'Deacon',               phone: '(323) 555-0105', email: 'robert@mirokuLA.org'   },
    { id: 6, name: 'Amanda Davis',          role: 'Church Administrator', phone: '(323) 555-0100', email: 'info@mirokuLA.org'     },
    { id: 7, name: 'James Wilson',          role: 'Elder',                phone: '(323) 555-0106', email: 'james@mirokuLA.org'    },
    { id: 8, name: 'Patricia Moore',        role: 'Prayer Lead',          phone: '(323) 555-0107', email: 'patricia@mirokuLA.org' }
  ],
  media: [
    { id: 1, source: 'other', series: 'Study of the Teachings', title: 'The Light Within',        date: 'May 4, 2025',  pastor: 'David Williams',   url: '#' },
    { id: 2, source: 'other', series: 'Study of the Teachings', title: 'Gratitude in Daily Life', date: 'Apr 27, 2025', pastor: 'David Williams',   url: '#' },
    { id: 3, source: 'other', series: 'Foundations',            title: 'Finding Peace in the Storm', date: 'Apr 20, 2025', pastor: 'Michael Thompson', url: '#' },
    { id: 4, source: 'other', series: 'Foundations',            title: 'Living with Purpose',     date: 'Apr 13, 2025', pastor: 'David Williams',   url: '#' }
  ],
  messages: [],
  youtube:      { channelId: '', apiKey: '' },
  soreiSaishi:  [],
  soreiRules:   '',
  donations: {
    message:    'Thank you for your generous giving! Every contribution supports our church and its activities.',
    websiteUrl: 'https://www.worldmessianic.org/donate',
    zelle:      { enabled: false, info: '', note: '' },
    venmo:      { enabled: false, handle: '', note: '' }
  },
  prayerForms: [
    { id: 1, type: 'daily',     title: 'Daily Prayer',                       description: 'Share what is on your heart. Our ministers hold every request submitted here.',                              active: true, fixed: true },
    { id: 2, type: 'ancestors', title: 'Prayer Request for My Ancestors',     description: 'Request prayers for your ancestors and loved ones who have passed. Our ministers will hold them in prayer.', active: true, fixed: true }
  ],
  prayerRequests: [],
  soreiRequests:  [],
  johreiSessions: [
    { id: 1, icon: '\u2600\ufe0f', title: 'Johrei after Sunday Service', time: '12:15 PM',
      recurrence: { weekday: 0, nths: [2, 4] } },
    { id: 2, icon: '\ud83d\udd4a\ufe0f', title: 'Midweek Johrei', time: '6:00 PM',
      recurrence: { weekday: 3, nths: [] } }
  ],
  oneOnOne: {
    zoomUrl:   'https://us02web.zoom.us/launch/jc/86125800160',
    meetingId: '861 2580 0160',
    passcode:  '662284'
  }
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
      appData.soreiSaishi    = ensureArray(appData.soreiSaishi);
      appData.soreiSaishi    = appData.soreiSaishi.map(e => ({ ...e, ancestors: ensureArray(e.ancestors) }));
      appData.prayerForms    = ensureArray(appData.prayerForms,    DEFAULT_DATA.prayerForms);
      appData.prayerRequests = ensureArray(appData.prayerRequests);
      appData.soreiRequests  = ensureArray(appData.soreiRequests);
      appData.johreiSessions = ensureArray(appData.johreiSessions, DEFAULT_DATA.johreiSessions);
      if (!appData.liveEvents) appData.liveEvents = DEFAULT_DATA.liveEvents;
      if (!appData.location)   appData.location   = DEFAULT_DATA.location;
      if (!appData.contact)    appData.contact    = DEFAULT_DATA.contact;
      if (!appData.youtube)    appData.youtube    = { channelId: '', apiKey: '' };
      if (!appData.donations)  appData.donations  = DEFAULT_DATA.donations;
      if (appData.soreiRules === undefined) appData.soreiRules = '';
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

// Firebase Auth owns the session and restores it on load, so there is no
// manual session check any more — this listener is the single entry point.
let authReady = false;
const resettingPassword = new URLSearchParams(window.location.search).get('mode') === 'resetPassword';
auth.onAuthStateChanged(async user => {
  // A member may already be signed in when they follow a reset link; the reset
  // form must still win.
  if (resettingPassword && pendingOobCode !== null) return;
  if (!user) {
    currentUser = null;
    showApp(false);
    authReady = true;
    return;
  }

  // Wait out any signup/migration that is still writing this user's profile.
  if (provisioning) { try { await provisioning; } catch {} }

  try {
    await loadProfiles();
  } catch {
    // Rules deny reads until a profile exists; fall through with what we have.
  }

  let profile = (profilesByUid || {})[user.uid];
  if (!profile) {
    // First sign-in on an Auth account with no profile yet (e.g. created from
    // the Firebase console). Seed a member profile so the app has a role.
    profile = {
      email:       user.email || '',
      username:    String(user.email || user.uid).split('@')[0].toLowerCase(),
      displayName: user.displayName || String(user.email || '').split('@')[0],
      role:        'member',
      profileComplete: false
    };
    await saveUserProfile(user.uid, profile);
  }

  currentUser = {
    uid:         user.uid,
    email:       user.email || profile.email || '',
    username:    usernameFor(user.uid, profile),
    role:        profile.role === 'admin' ? 'admin' : 'member',
    displayName: profile.displayName || profile.username || user.email
  };

  showApp(true);
  logSignIn();
  authReady = true;
});

// ── Password reset handled in-app ──
// Firebase's own reset page lives on a different domain, so a password changed
// there is invisible to the browser's saved-password store: it keeps offering
// the OLD password on our login screen and sign-in appears to fail. Handling
// the reset here, on our own origin and in a real form, lets the browser see
// the change and offer to update the saved entry.
let pendingOobCode = null;

function showLoginView(which) {
  ['signin-view', 'recover-view', 'newpw-view', 'signup-view'].forEach(id => {
    document.getElementById(id).classList.toggle('hidden', id !== which);
  });
}

// Strip the reset parameters so a refresh doesn't retry a spent code.
function clearAuthParamsFromUrl() {
  if (!window.history || !window.history.replaceState) return;
  const url = new URL(window.location.href);
  ['mode', 'oobCode', 'apiKey', 'continueUrl', 'lang'].forEach(k => url.searchParams.delete(k));
  window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
}

async function handlePasswordResetLink() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('mode') !== 'resetPassword' || !params.get('oobCode')) return false;

  const code = params.get('oobCode');
  showLoginView('newpw-view');
  document.getElementById('login-screen').classList.remove('hidden');

  try {
    const email = await auth.verifyPasswordResetCode(code);
    pendingOobCode = code;
    document.getElementById('newpw-email').value = email;
    document.getElementById('newpw-intro').innerHTML =
      `Setting a new password for <strong>${esc(email)}</strong>.`;
    document.getElementById('newpw-pass').focus();
  } catch (err) {
    pendingOobCode = null;
    document.getElementById('newpw-intro').textContent =
      'This reset link has expired or has already been used.';
    document.getElementById('newpw-error').textContent =
      'Please go back and request a new reset link.';
    document.getElementById('newpw-pass').disabled = true;
    document.getElementById('newpw-confirm').disabled = true;
    document.getElementById('newpw-submit').disabled = true;
  }
  clearAuthParamsFromUrl();
  return true;
}

document.getElementById('newpw-back-btn').addEventListener('click', () => {
  pendingOobCode = null;
  showLoginView('signin-view');
});

document.getElementById('newpw-form').addEventListener('submit', async e => {
  e.preventDefault();
  const pw    = document.getElementById('newpw-pass').value;
  const cf    = document.getElementById('newpw-confirm').value;
  const email = document.getElementById('newpw-email').value;
  const errEl = document.getElementById('newpw-error');
  const btn   = document.getElementById('newpw-submit');
  errEl.textContent = '';

  if (!pendingOobCode) { errEl.textContent = 'This link is no longer valid — please request a new one.'; return; }
  if (pw.length < 6)   { errEl.textContent = 'Password must be at least 6 characters.'; return; }
  if (pw !== cf)       { errEl.textContent = 'Passwords do not match.'; return; }

  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    await auth.confirmPasswordReset(pendingOobCode, pw);
    pendingOobCode = null;
    await auth.signInWithEmailAndPassword(email, pw);
    await storeCredential(email, pw);
    showLoginView('signin-view');
    showToast('Password updated — you are signed in.', 'info');
    // onAuthStateChanged opens the app.
  } catch (err) {
    errEl.textContent = err.code === 'auth/invalid-action-code'
      ? 'This reset link has expired or has already been used. Please request a new one.'
      : authErrorMessage(err);
    btn.disabled = false;
    btn.textContent = 'Save new password';
  }
});

// ── Login ──
document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const email = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  const btn   = document.querySelector('#login-form button[type="submit"]');
  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    const res = await signIn(email, password);
    if (res.ok) {
      document.getElementById('login-password').value = '';
      await storeCredential(email.trim().toLowerCase(), password);
      // onAuthStateChanged takes it from here.
    } else {
      errEl.textContent = res.message;
      document.getElementById('login-password').value = '';
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
});

// ── Sign Up ──
document.getElementById('show-signup-btn').addEventListener('click', () => {
  document.getElementById('signin-view').classList.add('hidden');
  document.getElementById('recover-view').classList.add('hidden');
  document.getElementById('signup-view').classList.remove('hidden');
  document.getElementById('signup-error').textContent = '';
  document.getElementById('signup-first').focus();
});

document.getElementById('show-signin-btn').addEventListener('click', () => {
  document.getElementById('signup-view').classList.add('hidden');
  document.getElementById('recover-view').classList.add('hidden');
  document.getElementById('signin-view').classList.remove('hidden');
  document.getElementById('login-error').textContent = '';
});

// ── Password Reset (Firebase Authentication) ──
// Firebase sends a real reset link to the member's inbox; the app never sees
// or sets the password itself.
function resetRecoveryView() {
  document.getElementById('recover-form').classList.remove('hidden');
  document.getElementById('recover-email').value = '';
  document.getElementById('recover-error').textContent = '';
  document.getElementById('recover-sent').classList.add('hidden');
}

document.getElementById('show-recover-btn').addEventListener('click', () => {
  resetRecoveryView();
  document.getElementById('signin-view').classList.add('hidden');
  document.getElementById('signup-view').classList.add('hidden');
  document.getElementById('recover-view').classList.remove('hidden');
  const typed = document.getElementById('login-username').value.trim();
  if (typed) document.getElementById('recover-email').value = typed;
  document.getElementById('recover-email').focus();
});

document.getElementById('recover-back-btn').addEventListener('click', () => {
  resetRecoveryView();
  document.getElementById('recover-view').classList.add('hidden');
  document.getElementById('signin-view').classList.remove('hidden');
  document.getElementById('login-error').textContent = '';
});

document.getElementById('recover-form').addEventListener('submit', async e => {
  e.preventDefault();
  const email = document.getElementById('recover-email').value.trim().toLowerCase();
  const errEl = document.getElementById('recover-error');
  const btn   = document.querySelector('#recover-form button[type="submit"]');
  errEl.textContent = '';
  if (!email) { errEl.textContent = 'Please enter your email address.'; return; }

  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    await auth.sendPasswordResetEmail(email);
  } catch (err) {
    // Anything other than a malformed address is reported as success so the
    // form cannot be used to discover which emails have accounts.
    if (err.code === 'auth/invalid-email' ||
        err.code === 'auth/operation-not-allowed' ||
        err.code === 'auth/configuration-not-found') {
      errEl.textContent = authErrorMessage(err);
      btn.disabled = false;
      btn.textContent = 'Email me a reset link';
      return;
    }
    console.error('Password reset error:', err);
  }
  document.getElementById('recover-form').classList.add('hidden');
  document.getElementById('recover-sent').classList.remove('hidden');
  document.getElementById('recover-sent-addr').textContent = email;
  btn.disabled = false;
  btn.textContent = 'Email me a reset link';
});

document.getElementById('signup-form').addEventListener('submit', async e => {
  e.preventDefault();
  const firstName = document.getElementById('signup-first').value.trim();
  const lastName  = document.getElementById('signup-last').value.trim();
  const rawUser   = document.getElementById('signup-username').value.trim();
  const username  = rawUser.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '');
  const email     = document.getElementById('signup-email').value.trim();
  const phone     = document.getElementById('signup-phone').value.trim();
  const password  = document.getElementById('signup-password').value;
  const confirm   = document.getElementById('signup-confirm').value;
  const errEl     = document.getElementById('signup-error');
  const btn       = document.querySelector('#signup-form button[type="submit"]');

  errEl.textContent = '';
  if (!firstName || !lastName) { errEl.textContent = 'First and last name are required.'; return; }
  if (!email)                  { errEl.textContent = 'An email address is required — it is how you sign in and reset your password.'; return; }
  if (!password)               { errEl.textContent = 'Please choose a password.'; return; }
  if (password.length < 6)    { errEl.textContent = 'Password must be at least 6 characters.'; return; }
  if (password !== confirm)   { errEl.textContent = 'Passwords do not match.'; return; }

  btn.disabled = true;
  btn.textContent = 'Creating account…';

  let finishProvision = null;
  try {
    // Firebase Auth creates the credential and rejects duplicate emails for us.
    finishProvision = beginProvisioning();
    const cred = await auth.createUserWithEmailAndPassword(email.toLowerCase(), password);
    const uid  = cred.user.uid;

    await saveUserProfile(uid, {
      role:            'member',
      displayName:     firstName + ' ' + lastName,
      username:        username || String(email).split('@')[0].toLowerCase(),
      firstName,
      lastName,
      email:           email.toLowerCase(),
      phone,
      address:         '',
      profileComplete: true,
      lastSeen:        new Date().toISOString()
    });

    ['signup-first','signup-last','signup-username','signup-email','signup-phone','signup-password','signup-confirm']
      .forEach(id => { document.getElementById(id).value = ''; });
    await storeCredential(email.toLowerCase(), password);
    showToast('Welcome, ' + firstName + '! Your account is ready.', 'info');
    // onAuthStateChanged shows the app.
  } catch (err) {
    errEl.textContent = authErrorMessage(err);
  } finally {
    if (finishProvision) finishProvision();
    btn.disabled = false;
    btn.textContent = 'Create Account';
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
    initInstallBanner();
    loadAppVersion();
    renderNotifStatus();

    const wire = {
      'request-meeting-btn':  () => openRequestMeetingModal('oneonone'),
      'oneonone-inbox-btn':   openMeetingRequestsModal,
      'request-johrei-btn':   openRequestJohreiModal,
      'johrei-requests-btn':  openMeetingRequestsModal,
      'edit-johrei-btn':      openJohreiScheduleModal
    };
    Object.entries(wire).forEach(([id, fn]) => {
      const b = document.getElementById(id);
      if (!b) return;
      const fresh = b.cloneNode(true);      // drop listeners from a previous sign-in
      b.replaceWith(fresh);
      fresh.addEventListener('click', fn);
    });
    renderMyMeetings();
    renderMyJohrei();
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
    const logBtn = document.getElementById('signin-log-btn');
    if (logBtn) {
      logBtn.replaceWith(logBtn.cloneNode(true));
      document.getElementById('signin-log-btn').addEventListener('click', openSigninLogModal);
    }
    // Mandatory profile completion check (slight delay so the app is fully rendered)
    setTimeout(checkProfileCompletion, 500);
    // Donations edit button
    const editDonBtn = document.getElementById('edit-donations-btn');
    if (editDonBtn) {
      editDonBtn.replaceWith(editDonBtn.cloneNode(true));
      document.getElementById('edit-donations-btn').addEventListener('click', openEditDonationsModal);
    }

    // Prayer buttons
    ['prayer-inbox-btn', 'add-prayer-form-btn'].forEach(btnId => {
      const b = document.getElementById(btnId); if (!b) return;
      b.replaceWith(b.cloneNode(true));
    });
    const pInboxBtn = document.getElementById('prayer-inbox-btn');
    if (pInboxBtn) pInboxBtn.addEventListener('click', openPrayerInboxModal);
    const addPfBtn = document.getElementById('add-prayer-form-btn');
    if (addPfBtn) addPfBtn.addEventListener('click', () => openPrayerFormEditor(null));

    // Sorei-Saishi buttons
    ['add-enrollment-btn', 'sorei-rules-btn', 'sorei-reminders-btn'].forEach(btnId => {
      const b = document.getElementById(btnId);
      if (!b) return;
      b.replaceWith(b.cloneNode(true));
    });
    const addEnrBtn = document.getElementById('add-enrollment-btn');
    if (addEnrBtn) addEnrBtn.addEventListener('click', () => openEnrollmentModal(null));
    const soreiRulesBtn = document.getElementById('sorei-rules-btn');
    if (soreiRulesBtn) soreiRulesBtn.addEventListener('click', openSoreiRulesModal);
    const soreiRemBtn = document.getElementById('sorei-reminders-btn');
    if (soreiRemBtn) soreiRemBtn.addEventListener('click', openRemindersModal);

    const soreiSearch = document.getElementById('sorei-search');
    if (soreiSearch) {
      soreiSearch.replaceWith(soreiSearch.cloneNode(true));
      document.getElementById('sorei-search').addEventListener('input', e => renderSoreiSaishi(e.target.value));
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
    // Always return to sign-in view on logout
    document.getElementById('signin-view').classList.remove('hidden');
    document.getElementById('signup-view').classList.add('hidden');
    document.getElementById('recover-view').classList.add('hidden');
    document.getElementById('login-error').textContent = '';
  }
}

document.getElementById('logout-btn').addEventListener('click', logout);

// ── Tab navigation ──

// Track whether a More sub-section is open
let moreSubSection = null;

function navigateToTab(tab) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  const navBtn = document.querySelector(`.nav-btn[data-tab="${tab}"]`);
  if (navBtn) navBtn.classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');
  moreSubSection = null;
  // Hide all more-back-bars
  document.querySelectorAll('.more-back-bar').forEach(b => b.classList.add('hidden'));
}

function navigateToMoreSection(section) {
  if (section === 'oneonone') renderMyMeetings();
  if (section === 'johrei')   { renderJohreiSchedule(); renderMyJohrei(); }
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + section).classList.add('active');
  // Show back bar for this section
  document.querySelectorAll('.more-back-bar').forEach(b => b.classList.add('hidden'));
  const bar = document.getElementById('back-bar-' + section);
  if (bar) bar.classList.remove('hidden');
  moreSubSection = section;
  // Keep "More" nav button active
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const moreBtn = document.querySelector('.nav-btn[data-tab="more"]');
  if (moreBtn) moreBtn.classList.add('active');
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => navigateToTab(btn.dataset.tab));
});

document.addEventListener('click', e => {
  const moreRow = e.target.closest('[data-more]');
  if (moreRow) { navigateToMoreSection(moreRow.dataset.more); return; }
  const backBtn = e.target.closest('[data-back]');
  if (backBtn) { navigateToTab(backBtn.dataset.back); return; }
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
  renderJohreiSchedule();
  renderLocation();
  renderContact();
  renderEvents();
  renderDirectory();
  renderMedia();
  renderYouTubeSettings();
  renderDonations();
  renderPrayer();
  renderSoreiSaishi();
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
      <div class="daily-word-label">${esc(m.title || 'Daily Inspiration')}</div>
      <p class="daily-word-text">${esc(m.text)}</p>
      ${m.scripture ? `<p class="daily-word-scripture">— ${esc(m.scripture)}</p>` : ''}
    </div>`;
}

function openScheduleModal() {
  const today = getTodayString();
  const msgs  = (appData.messages || [])
    .slice()
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.scheduledTime.localeCompare(b.scheduledTime));

  openModal('Schedule Daily Inspiration', `
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
      <input class="form-input" id="new-msg-title" value="Daily Inspiration" placeholder="Daily Inspiration" />
    </div>
    <div class="form-group">
      <label class="form-label">Message</label>
      <textarea class="form-textarea" id="new-msg-text" placeholder="Today's inspiring message..." style="min-height:90px"></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Source / Reference</label>
      <input class="form-input" id="new-msg-scripture" placeholder="e.g. Daily Inspiration page 17" />
    </div>
    <button class="form-btn form-btn-primary" id="save-new-msg-btn">+ Schedule Message</button>

    ${msgs.length ? `
      <div style="margin-top:24px">
        <p style="font-size:13px;font-weight:700;color:var(--purple);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Scheduled (${msgs.length})</p>
        ${msgs.map(m => `
          <div class="scheduled-msg-row">
            <div class="scheduled-msg-info">
              <div class="scheduled-msg-date">${esc(m.scheduledDate)}${m.scheduledTime ? ' &bull; ' + esc(m.scheduledTime) : ''}</div>
              <div class="scheduled-msg-preview">${esc(m.title || 'Daily Inspiration')}: ${esc(m.text.length > 55 ? m.text.substring(0,55) + '…' : m.text)}</div>
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
      <input class="form-input" id="edit-msg-title" value="${esc(m.title || 'Daily Inspiration')}" />
    </div>
    <div class="form-group">
      <label class="form-label">Message</label>
      <textarea class="form-textarea" id="edit-msg-text" style="min-height:90px">${esc(m.text)}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Source / Reference</label>
      <input class="form-input" id="edit-msg-scripture" value="${esc(m.scripture || '')}" placeholder="e.g. Daily Inspiration page 17" />
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
        <div class="scheduled-msg-row" style="flex-direction:column;align-items:stretch;gap:6px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px">
            <div class="scheduled-msg-info">
              <div class="scheduled-msg-date">${esc(u.username)} &bull; <span style="text-transform:capitalize">${esc(u.role)}</span>
                ${u.profileComplete ? ' &bull; <span style="color:#15803d">&#10003; Profile set</span>' : ' &bull; <span style="color:#c2410c">Profile pending</span>'}
              </div>
              <div class="scheduled-msg-preview">${esc(u.displayName || u.username)}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0">
              <button class="card-action-btn" data-edit-acct="${esc(u.username)}">&#9998;</button>
              ${u.username !== currentUser.username ? `<button class="card-action-btn delete" data-del-acct="${esc(u.username)}">&#128465;</button>` : ''}
            </div>
          </div>
          <div style="font-size:11px;color:var(--text-muted)">
            &#128336; ${esc(formatLastSeen(u.lastSeen))}
            ${u.email ? ' &bull; &#9993; ' + esc(u.email) : ''}
            ${u.phone ? ' &bull; &#128222; ' + esc(u.phone) : ''}
            ${u.address ? ' &bull; &#128205; ' + esc(u.address) : ''}
          </div>
          ${(!u.email || !u.phone) ? `<div style="font-size:11px;color:#b06a00;margin-top:2px">&#9888; No email/phone on file — this member can't use self-service recovery.</div>` : ''}
        </div>`).join('')}
    </div>
    <p style="font-size:13px;font-weight:700;color:var(--purple);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">Add New Account</p>
    <div class="form-group"><label class="form-label">Email</label>
      <input class="form-input" id="new-acct-email" type="email" placeholder="member@example.com" autocapitalize="none" autocorrect="off" /></div>
    <div class="form-group"><label class="form-label">Display Name</label>
      <input class="form-input" id="new-acct-display" placeholder="Full name" /></div>
    <div class="form-group"><label class="form-label">Temporary Password</label>
      <input class="form-input" id="new-acct-pw" type="text" placeholder="Min 6 characters" autocomplete="off" autocapitalize="none" autocorrect="off" />
      <button class="form-btn" id="new-acct-gen" type="button" style="margin-top:8px;background:var(--gold-light);color:var(--purple);border:1px solid var(--purple)">&#128273; Generate</button></div>
    <div class="form-group"><label class="form-label">Role</label>
      <select class="form-input" id="new-acct-role">
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </select></div>
    <button class="form-btn form-btn-primary" id="add-acct-btn">+ Create Account</button>
    <p style="font-size:11px;color:var(--text-muted);margin-top:8px">The member signs in with their email and this password, then changes it in Settings.</p>
    <div id="legacy-migrate-box" style="margin-top:22px;padding-top:16px;border-top:1px solid rgba(32,30,29,.12)"></div>
  `, () => {
    // Offer the one-time legacy upgrade only while old accounts still exist.
    accountsRef.once('value').then(snap => {
      const box = document.getElementById('legacy-migrate-box');
      if (!box) return;
      const n = snap.exists() ? Object.keys(snap.val()).length : 0;
      if (!n) { box.innerHTML = '<p style="font-size:11px;color:#15803d">&#10003; All accounts use Firebase sign-in.</p>'; return; }
      box.innerHTML = `
        <p style="font-size:13px;font-weight:700;color:var(--purple);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Legacy accounts</p>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
          ${n} account${n === 1 ? '' : 's'} still use the old password system. Upgrading keeps each member's
          current password and removes it from the database.
        </p>
        <button class="form-btn form-btn-primary" id="migrate-legacy-btn">Upgrade ${n} account${n === 1 ? '' : 's'}</button>`;
      document.getElementById('migrate-legacy-btn').addEventListener('click', async () => {
        const b = document.getElementById('migrate-legacy-btn');
        b.disabled = true;
        b.textContent = 'Upgrading…';
        try {
          const r = await migrateAllLegacyAccounts();
          showToast(`Upgraded ${r.migrated} of ${r.total}.`, r.skipped.length ? 'error' : 'info');
          if (r.skipped.length) alert('Could not upgrade:\n\n' + r.skipped.join('\n'));
          openAccountsModal();
        } catch (err) {
          showToast(authErrorMessage(err), 'error');
          b.disabled = false;
          b.textContent = 'Retry upgrade';
        }
      });
    }).catch(() => {});

    document.querySelectorAll('[data-edit-acct]').forEach(btn => {
      btn.addEventListener('click', () => openEditAccountModal(btn.dataset.editAcct));
    });
    document.querySelectorAll('[data-del-acct]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uname = btn.dataset.delAcct;
        if (!confirm(`Remove "${uname}" from the church directory?\n\nTheir sign-in account stays in Firebase until you delete it under Authentication \u2192 Users in the Firebase console.`)) return;
        const u = getUsers();
        const uid = u[uname] && u[uname].uid;
        if (!uid) { showToast('That account has no linked sign-in record.', 'error'); return; }
        try {
          await usersRef.child(uid).remove();
          delete profilesByUid[uid];
          rebuildUsersCache();
          showToast('Removed from the directory. Delete their login in the Firebase console to finish.', 'info');
        } catch {
          showToast('Could not remove — admin permission required.', 'error');
        }
        openAccountsModal();
      });
    });
    document.getElementById('new-acct-gen').addEventListener('click', () => {
      document.getElementById('new-acct-pw').value = generateTempPassword();
    });
    document.getElementById('add-acct-btn').addEventListener('click', async () => {
      const email       = document.getElementById('new-acct-email').value.trim().toLowerCase();
      const displayName = document.getElementById('new-acct-display').value.trim();
      const password    = document.getElementById('new-acct-pw').value;
      const role        = document.getElementById('new-acct-role').value;
      if (!email || !password) { showToast('Email and password are required.', 'error'); return; }
      if (password.length < 6) { showToast('Password must be at least 6 characters.', 'error'); return; }

      const btn = document.getElementById('add-acct-btn');
      btn.disabled = true;
      btn.textContent = 'Creating…';
      try {
        const uid = await createAuthUserAsAdmin(email, password);
        await usersRef.child(uid).set({
          email,
          username:        email.split('@')[0],
          displayName:     displayName || email.split('@')[0],
          role,
          profileComplete: false
        });
        await loadProfiles();
        showToast(`Account created. Give them: ${email} / ${password}`, 'info');
        openAccountsModal();
      } catch (err) {
        showToast(authErrorMessage(err), 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '+ Create Account';
      }
    });
  });
}

// Readable temporary password an admin can say out loud over the phone.
function generateTempPassword() {
  const words = ['Light', 'Grace', 'Peace', 'Faith', 'Hope', 'Joy', 'Spirit', 'Harmony', 'Blossom', 'Sunrise'];
  const r = new Uint32Array(2);
  crypto.getRandomValues(r);
  return words[r[0] % words.length] + (1000 + (r[1] % 9000));
}

// Creating a user with the main Firebase app would sign the ADMIN out and in
// as the new member. A throwaway secondary app avoids touching this session.
let secondaryApp = null;
async function createAuthUserAsAdmin(email, password) {
  if (!secondaryApp) {
    secondaryApp = firebase.initializeApp(firebaseConfig, 'admin-create');
  }
  const secondaryAuth = secondaryApp.auth();
  try {
    const cred = await secondaryAuth.createUserWithEmailAndPassword(email, password);
    return cred.user.uid;
  } finally {
    await secondaryAuth.signOut().catch(() => {});
  }
}

function openEditAccountModal(username) {
  const users = getUsers();
  const u = users[username];
  if (!u) return;
  openModal('Edit Account', `
    <div class="form-group"><label class="form-label">Email (sign-in)</label>
      <input class="form-input" value="${esc(u.email || '—')}" disabled style="opacity:.55" /></div>
    <div class="form-group"><label class="form-label">Display Name</label>
      <input class="form-input" id="ea-display" value="${esc(u.displayName || '')}" /></div>
    <div class="form-group"><label class="form-label">Role</label>
      <select class="form-input" id="ea-role">
        <option value="member" ${u.role === 'member' ? 'selected' : ''}>Member</option>
        <option value="admin"  ${u.role === 'admin'  ? 'selected' : ''}>Admin</option>
      </select></div>
    <button class="form-btn form-btn-primary" id="ea-save">Save Changes</button>
    <div class="form-group" style="margin-top:18px">
      <label class="form-label">Password</label>
      <p style="font-size:11px;color:var(--text-muted);margin-bottom:8px">
        Passwords are held by Firebase and cannot be read or set from here.
        Send a reset link to their inbox instead.
      </p>
      <button class="form-btn" id="ea-send-reset" type="button" style="background:var(--gold-light);color:var(--purple);border:1px solid var(--purple)">&#9993; Email a password reset link</button>
    </div>
    <button class="form-btn" id="ea-back" style="background:#f5f0ff;color:var(--purple);border:1px solid #d8c8f0">&#8592; Back</button>
  `, () => {
    document.getElementById('ea-send-reset').addEventListener('click', async () => {
      if (!u.email) { showToast('No email on file for this member.', 'error'); return; }
      const btn = document.getElementById('ea-send-reset');
      btn.disabled = true;
      try {
        await auth.sendPasswordResetEmail(u.email);
        showToast(`Reset link sent to ${u.email}.`, 'info');
      } catch (err) {
        showToast(authErrorMessage(err), 'error');
      } finally {
        btn.disabled = false;
      }
    });
    document.getElementById('ea-save').addEventListener('click', async () => {
      const displayName = document.getElementById('ea-display').value.trim();
      const role        = document.getElementById('ea-role').value;
      if (!u.uid) { showToast('That account has no linked sign-in record.', 'error'); return; }
      try {
        await usersRef.child(u.uid).update({ displayName: displayName || username, role });
        await loadProfiles();
        showToast('Account updated!', 'info');
        openAccountsModal();
      } catch {
        showToast('Could not save — admin permission required.', 'error');
      }
    });
    document.getElementById('ea-back').addEventListener('click', openAccountsModal);
  });
}

// One-time bulk upgrade of every remaining plaintext account. Members keep
// their existing password; it simply moves into Firebase Auth.
async function migrateAllLegacyAccounts() {
  const snap = await accountsRef.once('value');
  if (!snap.exists()) return { migrated: 0, skipped: [], total: 0 };
  const legacy = snap.val();
  const names  = Object.keys(legacy);
  let migrated = 0;
  const skipped = [];

  for (const name of names) {
    const rec = legacy[name];
    const email = String(rec.email || '').trim().toLowerCase();
    if (!email || !rec.password) { skipped.push(`${name} (no email or password on file)`); continue; }
    try {
      const uid = await createAuthUserAsAdmin(email, rec.password);
      const { password: _pw, ...rest } = rec;
      await usersRef.child(uid).set({
        ...rest,
        email,
        username:   name,
        role:       rec.role === 'admin' ? 'admin' : 'member',
        migratedAt: new Date().toISOString()
      });
      await accountsRef.child(name).remove();
      migrated++;
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        await accountsRef.child(name).remove().catch(() => {});
        skipped.push(`${name} (already migrated)`);
      } else {
        skipped.push(`${name} (${err.code || 'failed'})`);
      }
    }
  }
  await loadProfiles();
  return { migrated, skipped, total: names.length };
}

// NOTE: Firebase cancels snapshot.forEach() as soon as the callback returns a
// truthy value. push() and unshift() return the new length, so `s.forEach(x =>
// arr.push(x))` silently reads only the first record. Always use a block body.
function openSigninLogModal() {
  openModal('Sign-in Log', '<p style="color:var(--text-muted);font-size:13px">Loading…</p>', () => {});
  signinLogRef.orderByChild('timestamp').limitToLast(60).once('value').then(snap => {
    const entries = [];
    snap.forEach(child => { entries.unshift(child.val()); });
    if (!entries.length) {
      document.getElementById('modal-body').innerHTML = '<p style="color:var(--text-muted);font-size:14px;text-align:center;padding:20px 0;">No sign-in history yet.</p>';
      return;
    }
    document.getElementById('modal-body').innerHTML = `
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Last ${entries.length} sign-in${entries.length !== 1 ? 's' : ''} (most recent first)</p>
      ${entries.map(e => {
        const d = new Date(e.timestamp);
        return `
          <div class="scheduled-msg-row" style="margin-bottom:6px">
            <div class="scheduled-msg-info">
              <div class="scheduled-msg-date">${esc(e.displayName || e.username)} &bull; ${esc(e.username)}</div>
              <div class="scheduled-msg-preview">${d.toLocaleString()}</div>
            </div>
          </div>`;
      }).join('')}`;
  }).catch(() => {
    document.getElementById('modal-body').innerHTML = '<p style="color:#c0392b;font-size:14px">Could not load sign-in log. Check database rules.</p>';
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
// ── Service recurrence ──
// A service may carry a rule like { weekday: 0, nths: [2, 4] } meaning
// "2nd and 4th Sunday". Omit nths for a plain weekly service. Dates are
// worked out on the fly so the list never needs updating by hand.
const WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const ORDINALS      = { 1:'1st', 2:'2nd', 3:'3rd', 4:'4th', 5:'5th' };

// The nth given weekday of a month, or null when that month has no such date
// (e.g. a 5th Sunday). Uses local time so it matches the member's calendar.
function nthWeekdayOfMonth(year, month, weekday, nth) {
  const first  = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  const d = new Date(year, month, 1 + offset + (nth - 1) * 7);
  return d.getMonth() === month ? d : null;
}

function upcomingServiceDates(rec, count = 3, from = new Date()) {
  if (!rec || typeof rec.weekday !== 'number') return [];
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const out = [];

  if (!Array.isArray(rec.nths) || !rec.nths.length) {
    const d = new Date(today);
    d.setDate(d.getDate() + ((rec.weekday - d.getDay() + 7) % 7));
    while (out.length < count) { out.push(new Date(d)); d.setDate(d.getDate() + 7); }
    return out;
  }

  const nths = [...rec.nths].sort((a, b) => a - b);
  let y = today.getFullYear(), m = today.getMonth();
  for (let guard = 0; guard < 24 && out.length < count; guard++) {
    for (const n of nths) {
      if (out.length >= count) break;
      const d = nthWeekdayOfMonth(y, m, rec.weekday, n);
      if (d && d >= today) out.push(d);
    }
    if (++m > 11) { m = 0; y++; }
  }
  return out;
}

function describeRecurrence(rec) {
  if (!rec || typeof rec.weekday !== 'number') return '';
  const day = WEEKDAY_NAMES[rec.weekday];
  if (!Array.isArray(rec.nths) || !rec.nths.length) return `Every ${day}`;
  const parts = [...rec.nths].sort((a, b) => a - b).map(n => ORDINALS[n] || n + 'th');
  const joined = parts.length > 1
    ? parts.slice(0, -1).join(', ') + ' & ' + parts[parts.length - 1]
    : parts[0];
  return `${joined} ${day}`;
}

const fmtServiceDate = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function renderServices() {
  document.getElementById('services-list').innerHTML = (appData.services || []).map(s => {
    const schedule = [describeRecurrence(s.recurrence), s.time].filter(Boolean).join(' · ');
    const next     = upcomingServiceDates(s.recurrence, 3);
    const upcoming = next.length ? `
      <p class="card-next">Next: <strong>${esc(fmtServiceDate(next[0]))}</strong>${
        next.length > 1 ? ' &middot; then ' + next.slice(1).map(d => esc(fmtServiceDate(d))).join(', ') : ''
      }</p>` : '';
    return `
    <div class="card">
      <div class="card-icon">${esc(s.icon)}</div>
      <div class="card-body">
        <h4>${esc(s.title)}</h4>
        <p>${esc(schedule)}</p>
        ${upcoming}
      </div>
    </div>`;
  }).join('') || '<p style="color:var(--text-muted)">No service times added yet.</p>';
}

// Recompute dates when the app comes back to the foreground, so a device left
// open overnight doesn't keep showing yesterday's "next" service.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && document.getElementById('services-list')) renderServices();
});

document.getElementById('edit-services-btn').addEventListener('click', openServicesModal);

function openServicesModal() { openModal('Edit Service Times', buildServicesForm()); }

// ── Johrei session times ──
// Same recurrence engine as Service Times, so "2nd & 4th Sunday" and the
// upcoming dates work identically.
function renderJohreiSchedule() {
  const box = document.getElementById('johrei-schedule-list');
  if (!box) return;
  const items = ensureArray(appData.johreiSessions, DEFAULT_DATA.johreiSessions);
  box.innerHTML = items.map(j => {
    const schedule = [describeRecurrence(j.recurrence), j.time].filter(Boolean).join(' · ');
    const next     = upcomingServiceDates(j.recurrence, 3);
    return `
    <div class="card">
      <div class="card-icon">${esc(j.icon || '\u2600\ufe0f')}</div>
      <div class="card-body">
        <h4>${esc(j.title)}</h4>
        <p>${esc(schedule)}</p>
        ${next.length ? `<p class="card-next">Next: <strong>${esc(fmtServiceDate(next[0]))}</strong>${
          next.length > 1 ? ' &middot; then ' + next.slice(1).map(d => esc(fmtServiceDate(d))).join(', ') : ''
        }</p>` : ''}
      </div>
    </div>`;
  }).join('') || '<p style="color:var(--text-muted);font-size:14px">No regular Johrei times listed yet.</p>';
}

function openJohreiScheduleModal() { openModal('Edit Johrei Times', buildJohreiForm()); }

function buildJohreiForm() {
  const items = ensureArray(appData.johreiSessions, DEFAULT_DATA.johreiSessions);
  const rows = items.map((j, i) => {
    const rec  = j.recurrence || {};
    const nths = Array.isArray(rec.nths) ? rec.nths : [];
    const hasR = typeof rec.weekday === 'number';
    const preview = hasR
      ? upcomingServiceDates(rec, 3).map(fmtServiceDate).join(', ') || 'no upcoming dates'
      : 'No repeat set.';
    return `
    <div class="service-row-group" data-jid="${j.id}">
      <div class="service-row">
        <input class="svc-icon-input"  value="${esc(j.icon || '')}"  placeholder="&#9728;&#65039;" />
        <input class="svc-title-input" value="${esc(j.title || '')}" placeholder="Title" />
        <input class="svc-time-input"  value="${esc(j.time || '')}"  placeholder="Time" />
        <button class="johrei-row-del" data-jid="${j.id}">&#10005;</button>
      </div>
      <div class="svc-repeat">
        <label class="svc-repeat-label">Repeats on</label>
        <select class="svc-weekday">
          <option value="">Doesn't repeat</option>
          ${WEEKDAY_NAMES.map((w, wi) =>
            `<option value="${wi}" ${hasR && rec.weekday === wi ? 'selected' : ''}>${w}</option>`).join('')}
        </select>
        <div class="svc-nths">
          ${[1,2,3,4,5].map(n =>
            `<label class="svc-nth"><input type="checkbox" class="svc-nth-box" value="${n}" ${nths.includes(n) ? 'checked' : ''} /> ${ORDINALS[n]}</label>`
          ).join('')}
        </div>
        <p class="svc-hint">Tick none to repeat <em>every</em> week.</p>
        <p class="svc-preview">Upcoming: ${esc(preview)}</p>
      </div>
    </div>`;
  }).join('');
  return `
    <div id="johrei-form-list">${rows}</div>
    <button class="form-btn form-btn-primary" id="add-johrei-row-btn" style="margin-top:4px">+ Add Johrei Time</button>
    <button class="form-btn form-btn-primary" id="save-johrei-btn" style="margin-top:8px">Save</button>
  `;
}

function bindJohreiForm() {
  document.querySelectorAll('#johrei-form-list .service-row-group').forEach(group => {
    const refresh = () => {
      const rec = readRecurrenceFrom(group);
      group.querySelector('.svc-preview').textContent = rec
        ? 'Upcoming: ' + (upcomingServiceDates(rec, 3).map(fmtServiceDate).join(', ') || 'no upcoming dates')
        : 'No repeat set.';
    };
    group.querySelector('.svc-weekday').addEventListener('change', refresh);
    group.querySelectorAll('.svc-nth-box').forEach(b => b.addEventListener('change', refresh));
  });

  document.querySelectorAll('.johrei-row-del').forEach(btn => {
    btn.addEventListener('click', () => {
      appData.johreiSessions = ensureArray(appData.johreiSessions, DEFAULT_DATA.johreiSessions)
        .filter(j => j.id !== parseInt(btn.dataset.jid, 10));
      document.getElementById('modal-body').innerHTML = buildJohreiForm();
      bindJohreiForm();
    });
  });

  const addBtn = document.getElementById('add-johrei-row-btn');
  if (addBtn) addBtn.addEventListener('click', () => {
    appData.johreiSessions = ensureArray(appData.johreiSessions, DEFAULT_DATA.johreiSessions);
    appData.johreiSessions.push({ id: nextId(appData.johreiSessions), icon: '\u2600\ufe0f', title: 'Johrei', time: '' });
    document.getElementById('modal-body').innerHTML = buildJohreiForm();
    bindJohreiForm();
  });

  const saveBtn = document.getElementById('save-johrei-btn');
  if (saveBtn) saveBtn.addEventListener('click', () => {
    const items = ensureArray(appData.johreiSessions, DEFAULT_DATA.johreiSessions);
    document.querySelectorAll('#johrei-form-list .service-row-group').forEach((group, i) => {
      if (!items[i]) return;
      items[i].icon  = group.querySelector('.svc-icon-input').value.trim();
      items[i].title = group.querySelector('.svc-title-input').value.trim();
      items[i].time  = group.querySelector('.svc-time-input').value.trim();
      const rec = readRecurrenceFrom(group);
      if (rec) items[i].recurrence = rec; else delete items[i].recurrence;
    });
    appData.johreiSessions = items;
    saveData(); closeModal();
  });
}

function buildServicesForm() {
  const rows = (appData.services || []).map((s, i) => {
    const rec  = s.recurrence || {};
    const nths = Array.isArray(rec.nths) ? rec.nths : [];
    const hasR = typeof rec.weekday === 'number';
    const preview = hasR
      ? upcomingServiceDates(rec, 3).map(fmtServiceDate).join(', ') || 'no upcoming dates'
      : 'No repeat set — this service shows without dates.';
    return `
    <div class="service-row-group" data-id="${s.id}">
      <div class="service-row">
        <input class="svc-icon-input"  value="${esc(s.icon)}"  placeholder="☀️" data-idx="${i}" />
        <input class="svc-title-input" value="${esc(s.title)}" placeholder="Title" data-idx="${i}" />
        <input class="svc-time-input"  value="${esc(s.time)}"  placeholder="Time"  data-idx="${i}" />
        <button class="service-row-del" data-id="${s.id}">✕</button>
      </div>
      <div class="svc-repeat">
        <label class="svc-repeat-label">Repeats on</label>
        <select class="svc-weekday">
          <option value="">Doesn't repeat</option>
          ${WEEKDAY_NAMES.map((w, wi) =>
            `<option value="${wi}" ${hasR && rec.weekday === wi ? 'selected' : ''}>${w}</option>`).join('')}
        </select>
        <div class="svc-nths">
          ${[1,2,3,4,5].map(n =>
            `<label class="svc-nth"><input type="checkbox" class="svc-nth-box" value="${n}" ${nths.includes(n) ? 'checked' : ''} /> ${ORDINALS[n]}</label>`
          ).join('')}
        </div>
        <p class="svc-hint">Tick none to repeat <em>every</em> week.</p>
        <p class="svc-preview">Upcoming: ${esc(preview)}</p>
      </div>
    </div>`;
  }).join('');
  return `
    <div id="services-form-list">${rows}</div>
    <button class="form-btn form-btn-primary" id="add-svc-row-btn" style="margin-top:4px">+ Add Service Time</button>
    <button class="form-btn form-btn-primary" id="save-svc-btn" style="margin-top:8px">Save</button>
  `;
}

// Read the recurrence controls out of one form row.
function readRecurrenceFrom(group) {
  const wd = group.querySelector('.svc-weekday').value;
  if (wd === '') return null;
  const nths = [...group.querySelectorAll('.svc-nth-box')]
    .filter(b => b.checked).map(b => parseInt(b.value, 10));
  return { weekday: parseInt(wd, 10), nths };
}

function bindServicesForm() {
  // Live-update the "Upcoming" preview as the admin changes the rule.
  document.querySelectorAll('.service-row-group').forEach(group => {
    const refresh = () => {
      const rec = readRecurrenceFrom(group);
      const el  = group.querySelector('.svc-preview');
      el.textContent = rec
        ? 'Upcoming: ' + (upcomingServiceDates(rec, 3).map(fmtServiceDate).join(', ') || 'no upcoming dates')
        : 'No repeat set — this service shows without dates.';
    };
    group.querySelector('.svc-weekday').addEventListener('change', refresh);
    group.querySelectorAll('.svc-nth-box').forEach(b => b.addEventListener('change', refresh));
  });

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
    document.querySelectorAll('.service-row-group').forEach((group, i) => {
      if (!appData.services[i]) return;
      appData.services[i].icon  = group.querySelector('.svc-icon-input').value.trim();
      appData.services[i].title = group.querySelector('.svc-title-input').value.trim();
      appData.services[i].time  = group.querySelector('.svc-time-input').value.trim();
      const rec = readRecurrenceFrom(group);
      if (rec) appData.services[i].recurrence = rec;
      else     delete appData.services[i].recurrence;
    });
    saveData(); closeModal();
  });
}

// ── One-on-One with your Minister ──
// Requests need 48 hours' notice, minister approval, and can be cancelled up
// to 8 hours before. All three rules are enforced here and restated in a
// checklist the member must tick before confirming.
const BOOKING_NOTICE_HOURS = 48;
const CANCEL_CUTOFF_HOURS  = 8;

const PURPOSE_LABELS = {
  guidance: 'Guidance',
  johrei:   'Johrei',
  prayer:   'Prayer',
  all:      'Guidance, Johrei and Prayer'
};
const STATUS_LABELS = {
  pending:   { text: 'Awaiting approval', color: '#b06a00' },
  approved:  { text: 'Confirmed',         color: '#15803d' },
  declined:  { text: 'Not approved',      color: '#c0392b' },
  cancelled: { text: 'Cancelled',         color: 'rgba(32,30,29,.5)' }
};

// A meeting's date+time are stored as local wall-clock strings; combine them
// into a real instant so we can compare against now.
function meetingDate(appt) {
  return new Date(`${appt.date}T${(appt.time || '00:00')}:00`);
}
const hoursUntil = appt => (meetingDate(appt) - Date.now()) / 3600000;
const canCancel  = appt => appt.status !== 'cancelled' && appt.status !== 'declined'
                        && hoursUntil(appt) > CANCEL_CUTOFF_HOURS;

function formatMeetingWhen(appt) {
  const d = meetingDate(appt);
  if (isNaN(d)) return `${appt.date} ${appt.time}`;
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
       + ' at ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Earliest datetime a member may book, as a value for <input type="datetime-local">
function earliestBookingValue() {
  const d = new Date(Date.now() + BOOKING_NOTICE_HOURS * 3600000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function oneOnOneConfig() {
  return Object.assign({}, DEFAULT_DATA.oneOnOne, appData.oneOnOne || {});
}

function renderMyMeetings() { renderMyAppointments('oneonone'); }
function renderMyJohrei()   { renderMyAppointments('johrei'); }

// Older records predate the type field; treat those as one-on-one meetings.
const apptType = a => a.type === 'johrei' ? 'johrei' : 'oneonone';

function renderMyAppointments(type) {
  const box = document.getElementById(APPT_TYPES[type].listId);
  if (!box || !currentUser) return;
  appointmentsRef.child(currentUser.uid).once('value').then(snap => {
    const list = [];
    snap.forEach(c => { list.push({ id: c.key, ...c.val() }); });
    const mine = list.filter(a => apptType(a) === type)
                     .sort((a, b) => meetingDate(b) - meetingDate(a));

    if (!mine.length) {
      box.innerHTML = `<p style="color:var(--text-muted);font-size:14px">You have no ${
        type === 'johrei' ? 'Johrei sessions' : 'meetings'} yet.</p>`;
      return;
    }
    const cfg = oneOnOneConfig();
    box.innerHTML = mine.map(a => {
      const st = STATUS_LABELS[a.status] || STATUS_LABELS.pending;
      const showJoin = a.status === 'approved' && a.mode === 'online';
      return `
      <div class="card" style="flex-direction:column;align-items:stretch;gap:8px">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
          <div>
            <h4 style="font-size:15px;font-weight:600">${esc(formatMeetingWhen(a))}</h4>
            <p style="font-size:13px;color:var(--text-muted)">
              ${type === 'johrei' ? 'Johrei' : esc(PURPOSE_LABELS[a.purpose] || a.purpose)} &bull;
              ${a.duration} min${a.withJohrei ? ` + ${JOHREI_MINUTES} min Johrei` : ''} &bull;
              ${a.mode === 'online' ? 'Online' : 'In person'}
            </p>
          </div>
          <span style="font-size:11px;font-weight:700;color:${st.color};white-space:nowrap">${esc(st.text)}</span>
        </div>
        ${a.notes ? `<p style="font-size:13px;color:var(--text-muted)">&ldquo;${esc(a.notes)}&rdquo;</p>` : ''}
        ${a.status === 'declined' && (a.declineReason || a.suggestedAlternative) ? `
          <div class="decline-note">
            ${a.declineReason ? `<p><strong>From your minister:</strong> ${esc(a.declineReason)}</p>` : ''}
            ${a.suggestedAlternative ? `<p style="margin-top:6px"><strong>Suggested instead:</strong> ${esc(a.suggestedAlternative)}</p>` : ''}
            <p style="margin-top:8px;font-size:12px;color:var(--text-muted)">Use &ldquo;Request a Meeting&rdquo; above to book the new time.</p>
          </div>` : ''}
        ${showJoin ? `
          <a class="donation-give-btn" href="${esc(cfg.zoomUrl)}" target="_blank" rel="noopener"
             style="display:block;text-align:center;text-decoration:none;font-size:15px;padding:12px">Join on Zoom</a>
          <p style="font-size:11px;color:var(--text-muted);text-align:center">
            Meeting ID ${esc(cfg.meetingId)} &bull; Passcode ${esc(cfg.passcode)}</p>` : ''}
        ${canCancel(a)
          ? `<button class="form-btn" data-cancel-appt="${esc(a.id)}" style="margin:0;background:#fdecea;color:#c0392b;border:1px solid #e8b4ae">Cancel this meeting</button>`
          : (a.status === 'approved' || a.status === 'pending')
            ? `<p style="font-size:11px;color:var(--text-muted)">Too late to cancel here &mdash; please contact your minister directly.</p>`
            : ''}
      </div>`;
    }).join('');

    box.querySelectorAll('[data-cancel-appt]').forEach(btn => {
      btn.addEventListener('click', () => cancelMeeting(btn.dataset.cancelAppt, type));
    });
  }).catch(err => {
    console.error('Meetings load error:', err);
    box.innerHTML = '<p style="color:#c0392b;font-size:14px">Could not load these yet.</p>';
  });
}

async function cancelMeeting(id, type = 'oneonone') {
  const snap = await appointmentsRef.child(currentUser.uid).child(id).once('value');
  const appt = snap.val();
  if (!appt) return;
  if (!canCancel(appt)) {
    showToast(`Meetings can only be cancelled more than ${CANCEL_CUTOFF_HOURS} hours ahead.`, 'error');
    return;
  }
  if (!confirm('Cancel this meeting with your minister?')) return;
  await appointmentsRef.child(currentUser.uid).child(id)
    .update({ status: 'cancelled', cancelledAt: new Date().toISOString() });
  showToast('Cancelled. Your minister has been notified.', 'info');
  renderMyAppointments(type);
}

const APPT_TYPES = {
  oneonone: { label: 'Meeting',        listId: 'my-meetings-list', title: 'Request a Meeting' },
  johrei:   { label: 'Johrei session', listId: 'my-johrei-list',   title: 'Request a Johrei Session' }
};
const JOHREI_MINUTES = 15;

function openRequestJohreiModal() { openRequestMeetingModal('johrei'); }

function openRequestMeetingModal(type = 'oneonone') {
  const p = myProfile() || {};
  const name = p.displayName || currentUser.displayName || '';
  const isJohrei = type === 'johrei';
  openModal(APPT_TYPES[type].title, `
    <div class="form-group"><label class="form-label">Your Name</label>
      <input class="form-input" id="oo-name" value="${esc(name)}" placeholder="Your full name" /></div>

    <div class="form-group"><label class="form-label">${isJohrei ? 'How would you like to receive Johrei?' : 'How would you like to meet?'}</label>
      <select class="form-input" id="oo-mode">
        <option value="inperson">In person</option>
        <option value="online">Online (Zoom)</option>
      </select></div>

    ${isJohrei ? `
      <div class="form-group">
        <p style="font-size:13px;color:var(--text-muted);line-height:1.5">
          A Johrei session lasts ${JOHREI_MINUTES} minutes.
        </p>
      </div>` : `
      <div class="form-group"><label class="form-label">Purpose of the meeting</label>
        <select class="form-input" id="oo-purpose">
          <option value="guidance">Guidance</option>
          <option value="johrei">Johrei</option>
          <option value="prayer">Prayer</option>
          <option value="all">All of the above</option>
        </select></div>

      <div class="form-group"><label class="form-label">How long?</label>
        <select class="form-input" id="oo-duration">
          <option value="30">30 minutes</option>
          <option value="60">1 hour</option>
        </select></div>

      <label class="booking-check" style="border:1px solid rgba(32,30,29,.12);border-radius:12px;padding:10px 12px;margin-bottom:14px">
        <input type="checkbox" id="oo-addjohrei" />
        <span>Add ${JOHREI_MINUTES} minutes of Johrei to this meeting</span>
      </label>`}

    <div class="form-group"><label class="form-label">Preferred date and time</label>
      <input class="form-input" id="oo-when" type="datetime-local" min="${earliestBookingValue()}" />
      <p style="font-size:11px;color:var(--text-muted);margin-top:6px">
        At least ${BOOKING_NOTICE_HOURS} hours from now. Your minister will confirm.</p></div>

    <div class="form-group"><label class="form-label">Anything you'd like to share beforehand? (optional)</label>
      <textarea class="form-textarea" id="oo-notes" style="min-height:80px" placeholder="Optional"></textarea></div>

    <div class="booking-checklist">
      <label class="booking-check"><input type="checkbox" class="oo-ack" id="oo-ack1" />
        <span>I understand this request must be at least ${BOOKING_NOTICE_HOURS} hours in advance.</span></label>
      <label class="booking-check"><input type="checkbox" class="oo-ack" id="oo-ack2" />
        <span>I understand my minister must approve the date${isJohrei ? ' and time' : ', time and length'} before it is confirmed.</span></label>
      <label class="booking-check"><input type="checkbox" class="oo-ack" id="oo-ack3" />
        <span>I understand I can cancel in the app up to ${CANCEL_CUTOFF_HOURS} hours before, and after that I should contact my minister directly.</span></label>
    </div>

    <p class="settings-msg error" id="oo-msg" style="margin-bottom:8px"></p>
    <button class="form-btn form-btn-primary" id="oo-submit" disabled>Confirm Request</button>
  `, () => {
    const submit = document.getElementById('oo-submit');
    const acks   = [...document.querySelectorAll('.oo-ack')];
    // The confirm button stays disabled until every point is acknowledged.
    const sync = () => { submit.disabled = !acks.every(a => a.checked); };
    acks.forEach(a => a.addEventListener('change', sync));

    submit.addEventListener('click', async () => {
      const msg = document.getElementById('oo-msg');
      const name = document.getElementById('oo-name').value.trim();
      const when = document.getElementById('oo-when').value;
      msg.textContent = '';

      if (!name) { msg.textContent = 'Please enter your name.'; return; }
      if (!when) { msg.textContent = 'Please choose a date and time.'; return; }
      const chosen = new Date(when);
      if (isNaN(chosen)) { msg.textContent = 'That date and time is not valid.'; return; }
      if ((chosen - Date.now()) / 3600000 < BOOKING_NOTICE_HOURS) {
        msg.textContent = `Please choose a time at least ${BOOKING_NOTICE_HOURS} hours from now.`;
        return;
      }

      submit.disabled = true;
      submit.textContent = 'Sending…';
      const pad = n => String(n).padStart(2, '0');
      try {
        const ref = await appointmentsRef.child(currentUser.uid).push({
          uid:         currentUser.uid,
          memberName:  name,
          memberEmail: currentUser.email || '',
          memberPhone: (myProfile() || {}).phone || '',
          type:        type,
          mode:        document.getElementById('oo-mode').value,
          purpose:     isJohrei ? 'johrei' : document.getElementById('oo-purpose').value,
          duration:    isJohrei ? JOHREI_MINUTES : parseInt(document.getElementById('oo-duration').value, 10),
          withJohrei:  !isJohrei && !!(document.getElementById('oo-addjohrei') || {}).checked,
          date:        `${chosen.getFullYear()}-${pad(chosen.getMonth()+1)}-${pad(chosen.getDate())}`,
          time:        `${pad(chosen.getHours())}:${pad(chosen.getMinutes())}`,
          notes:       document.getElementById('oo-notes').value.trim(),
          status:      'pending',
          createdAt:   new Date().toISOString()
        });

        // Read it back before claiming success. A write that is accepted
        // locally but not stored server-side would otherwise show "sent" for a
        // request that exists nowhere.
        const check = await appointmentsRef.child(currentUser.uid).child(ref.key).once('value');
        if (!check.exists()) {
          throw new Error('The request did not save. Please try again or contact your minister.');
        }

        closeModal();
        showToast('Request sent. Your minister will confirm it shortly.', 'info');
        renderMyMeetings();
        renderMyJohrei();
      } catch (err) {
        console.error('Meeting request error:', err);
        msg.textContent = err && err.message && err.message.includes('did not save')
          ? err.message
          : `Could not send your request (${(err && (err.code || err.message)) || 'unknown error'}). Please try again.`;
        submit.disabled = false;
        submit.textContent = 'Confirm Request';
      }
    });
  });
}

// ── Minister's view of every request ──
function openMeetingRequestsModal() {
  openModal('Meeting Requests', '<p style="color:var(--text-muted);font-size:13px">Loading…</p>', () => {});
  appointmentsRef.once('value').then(snap => {
    const all = [];
    snap.forEach(userNode => {
      userNode.forEach(c => { all.push({ uid: userNode.key, id: c.key, ...c.val() }); });
    });
    all.sort((a, b) => meetingDate(a) - meetingDate(b));
    console.log(`Requests inbox: ${all.length} appointment(s) across ${snap.numChildren()} member(s)`);
    const pending = all.filter(a => a.status === 'pending');
    const rest    = all.filter(a => a.status !== 'pending');

    const row = a => {
      const st = STATUS_LABELS[a.status] || STATUS_LABELS.pending;
      return `
      <div class="prayer-inbox-item">
        <div style="display:flex;justify-content:space-between;gap:8px">
          <span class="prayer-inbox-name">${esc(a.memberName || a.uid)}</span>
          <span style="font-size:11px;font-weight:700;color:${st.color}">${esc(st.text)}</span>
        </div>
        <div class="prayer-inbox-date">${esc(formatMeetingWhen(a))}</div>
        <div style="font-size:12px;color:var(--text-muted);margin:4px 0">
          ${apptType(a) === 'johrei' ? '<strong>Johrei</strong>' : esc(PURPOSE_LABELS[a.purpose] || a.purpose)} &bull;
          ${a.duration} min${a.withJohrei ? ` + ${JOHREI_MINUTES} min Johrei` : ''} &bull;
          ${a.mode === 'online' ? 'Online' : 'In person'}
        </div>
        ${a.memberPhone ? `<div style="font-size:12px;margin:2px 0 4px">
          <a href="tel:${esc(String(a.memberPhone).replace(/[^0-9+]/g, ''))}"
             style="color:var(--purple-light);font-weight:600;text-decoration:none">&#128222; ${esc(a.memberPhone)}</a>
        </div>` : ''}
        ${a.notes ? `<div class="prayer-inbox-text">${esc(a.notes)}</div>` : ''}
        ${a.status === 'pending' ? `
          <div style="display:flex;gap:6px;margin-top:8px">
            <button class="form-btn form-btn-primary" style="margin:0;flex:1;padding:9px"
                    data-appt-ok="${esc(a.uid)}|${esc(a.id)}">Approve</button>
            <button class="form-btn" style="margin:0;flex:1;padding:9px;background:#fdecea;color:#c0392b;border:1px solid #e8b4ae"
                    data-appt-no="${esc(a.uid)}|${esc(a.id)}">Decline</button>
          </div>` : ''}
      </div>`;
    };

    document.getElementById('modal-body').innerHTML = `
      <p style="font-size:11px;font-weight:700;color:var(--purple);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">
        Awaiting approval (${pending.length})</p>
      ${pending.length ? pending.map(row).join('')
        : '<p style="color:var(--text-muted);font-size:13px;margin-bottom:12px">Nothing waiting.</p>'}
      <p style="font-size:11px;font-weight:700;color:var(--purple);text-transform:uppercase;letter-spacing:.07em;margin:18px 0 8px">
        Everything else (${rest.length})</p>
      ${rest.length ? rest.map(row).join('')
        : '<p style="color:var(--text-muted);font-size:13px">Nothing yet.</p>'}`;

    const decide = (attr, status, note) => {
      document.querySelectorAll(`[${attr}]`).forEach(btn => {
        btn.addEventListener('click', async () => {
          const [uid, id] = btn.getAttribute(attr).split('|');
          btn.disabled = true;
          try {
            await appointmentsRef.child(uid).child(id).update({
              status, decidedAt: new Date().toISOString(), decidedBy: currentUser.username
            });
            showToast(note, 'info');
            openMeetingRequestsModal();
          } catch {
            showToast('Could not save — admin permission required.', 'error');
            btn.disabled = false;
          }
        });
      });
    };
    decide('data-appt-ok', 'approved', 'Meeting approved. The member will be told and reminded before it starts.');

    // Declining always carries a reason and, ideally, an alternative — a bare
    // "no" leaves the member with nothing to act on.
    document.querySelectorAll('[data-appt-no]').forEach(btn => {
      btn.addEventListener('click', () => {
        const [uid, id] = btn.getAttribute('data-appt-no').split('|');
        openDeclineMeetingModal(uid, id);
      });
    });
  }).catch(err => {
    console.error('Requests load error:', err);
    document.getElementById('modal-body').innerHTML =
      '<p style="color:#c0392b;font-size:14px">Could not load requests. Admin access required.</p>';
  });
}

function openDeclineMeetingModal(uid, id) {
  openModal('Decline Meeting', `
    <p style="font-size:13px;color:var(--text-muted);line-height:1.5;margin-bottom:14px">
      The member will be sent your reply, so they know what happened and what to do next.
    </p>
    <div class="form-group"><label class="form-label">Reason *</label>
      <textarea class="form-textarea" id="dec-reason" style="min-height:80px"
                placeholder="e.g. I have a service at that time."></textarea></div>
    <div class="form-group"><label class="form-label">Suggest another day or time</label>
      <input class="form-input" id="dec-alt" placeholder="e.g. Thursday after 3pm, or Saturday morning" />
      <p style="font-size:11px;color:var(--text-muted);margin-top:6px">
        Optional, but it saves the member guessing.</p></div>
    <p class="settings-msg error" id="dec-msg" style="margin-bottom:8px"></p>
    <button class="form-btn form-btn-primary" id="dec-send">Send Reply &amp; Decline</button>
    <button class="form-btn" id="dec-back" style="background:#f5f0ff;color:var(--purple);border:1px solid #d8c8f0">&#8592; Back</button>
  `, () => {
    document.getElementById('dec-back').addEventListener('click', openMeetingRequestsModal);
    document.getElementById('dec-send').addEventListener('click', async () => {
      const reason = document.getElementById('dec-reason').value.trim();
      const alt    = document.getElementById('dec-alt').value.trim();
      const msg    = document.getElementById('dec-msg');
      if (!reason) { msg.textContent = 'Please give the member a reason.'; return; }

      const btn = document.getElementById('dec-send');
      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        await appointmentsRef.child(uid).child(id).update({
          status: 'declined',
          declineReason: reason,
          suggestedAlternative: alt,
          decidedAt: new Date().toISOString(),
          decidedBy: currentUser.username
        });
        showToast('Reply sent to the member.', 'info');
        openMeetingRequestsModal();
      } catch {
        msg.textContent = 'Could not save — admin permission required.';
        btn.disabled = false;
        btn.textContent = 'Send Reply & Decline';
      }
    });
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
      <input class="form-input" id="f-role" value="${esc(m ? m.role : '')}" placeholder="e.g. Services Director" /></div>
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
      <input class="form-input" id="f-title" value="${esc(m ? m.title : '')}" placeholder="Teaching title" /></div>
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

// ── DONATIONS ──
const DONATION_METHODS = [
  { key: 'zelle', label: 'Zelle', color: '#6d1ed4', getInfo: d => d.info || '', getLink: () => '' },
  { key: 'venmo', label: 'Venmo', color: '#3d95ce', getInfo: d => d.handle ? ('@' + d.handle.replace(/^@/, '')) : '', getLink: d => d.handle ? 'https://venmo.com/' + d.handle.replace(/^@/, '') : '' }
];

function renderDonations() {
  const container = document.getElementById('donations-container');
  if (!container) return;
  const d = appData.donations || DEFAULT_DATA.donations;
  const websiteUrl = d.websiteUrl || DEFAULT_DATA.donations.websiteUrl;
  const otherActive = DONATION_METHODS.filter(m => { const md = d[m.key] || {}; return md.enabled && m.getInfo(md); });

  let html = `
    <div class="donation-hero">
      <div class="donation-hero-icon">&#128591;</div>
      <p class="donation-hero-text">${esc(d.message || DEFAULT_DATA.donations.message)}</p>
    </div>
    <a class="donation-give-btn" href="${esc(websiteUrl)}" target="_blank">&#128176; Give Now</a>`;

  if (otherActive.length) {
    html += `<p class="donation-other-label">Other ways to give</p>`;
    html += otherActive.map(method => {
      const md   = d[method.key] || {};
      const info = method.getInfo(md);
      const link = method.getLink(md);
      return `
        <div class="donation-card" style="border-top:4px solid ${method.color}">
          <div class="donation-method-label" style="color:${method.color}">${method.label}</div>
          <div class="donation-info">${esc(info)}</div>
          ${md.note ? `<div class="donation-note">${esc(md.note)}</div>` : ''}
          ${method.key === 'zelle' ? `<p class="donation-note" style="margin-top:4px">Open your bank app and send to the number/email above using Zelle.</p>` : ''}
          ${link ? `<a class="donation-btn" href="${esc(link)}" target="_blank" style="background:${method.color}">Open ${method.label}</a>` : ''}
        </div>`;
    }).join('');
  }
  container.innerHTML = html;
}

function openEditDonationsModal() {
  const d   = appData.donations || DEFAULT_DATA.donations;
  const val = (key, field) => esc((d[key] && d[key][field]) || '');
  const chk = key => (d[key] && d[key].enabled) ? 'checked' : '';
  openModal('Edit Giving', `
    <div class="form-group"><label class="form-label">Message to Members</label>
      <textarea class="form-textarea" id="don-msg" style="min-height:60px">${esc(d.message || DEFAULT_DATA.donations.message)}</textarea></div>
    <div class="form-group"><label class="form-label">Give Button URL</label>
      <input class="form-input" id="don-url" type="url" value="${esc(d.websiteUrl || DEFAULT_DATA.donations.websiteUrl)}" placeholder="https://..." /></div>

    <div class="donation-edit-section">
      <div class="settings-toggle-row" style="padding:0;box-shadow:none;border:none;margin-bottom:10px">
        <div class="toggle-info"><div class="toggle-title">&#128156; Show Zelle</div></div>
        <label class="toggle-switch"><input type="checkbox" id="don-zelle-on" ${chk('zelle')} /><span class="toggle-slider"></span></label>
      </div>
      <div class="form-group"><label class="form-label">Phone or Email</label>
        <input class="form-input" id="don-zelle-info" value="${val('zelle','info')}" placeholder="(555) 555-0100 or info@church.org" /></div>
      <div class="form-group"><label class="form-label">Note (optional)</label>
        <input class="form-input" id="don-zelle-note" value="${val('zelle','note')}" placeholder="e.g. Include your name in the memo" /></div>
    </div>

    <div class="donation-edit-section">
      <div class="settings-toggle-row" style="padding:0;box-shadow:none;border:none;margin-bottom:10px">
        <div class="toggle-info"><div class="toggle-title">&#128184; Show Venmo</div></div>
        <label class="toggle-switch"><input type="checkbox" id="don-venmo-on" ${chk('venmo')} /><span class="toggle-slider"></span></label>
      </div>
      <div class="form-group"><label class="form-label">Venmo @handle</label>
        <input class="form-input" id="don-venmo-handle" value="${val('venmo','handle')}" placeholder="@ChurchName" autocapitalize="none" /></div>
      <div class="form-group"><label class="form-label">Note (optional)</label>
        <input class="form-input" id="don-venmo-note" value="${val('venmo','note')}" placeholder="e.g. Write 'Tithe' or 'Offering'" /></div>
    </div>

    <button class="form-btn form-btn-primary" id="save-donations-btn">Save</button>
  `, () => {
    document.getElementById('save-donations-btn').addEventListener('click', () => {
      if (!appData.donations) appData.donations = {};
      appData.donations.message    = document.getElementById('don-msg').value.trim() || DEFAULT_DATA.donations.message;
      appData.donations.websiteUrl = document.getElementById('don-url').value.trim() || DEFAULT_DATA.donations.websiteUrl;
      appData.donations.zelle      = { enabled: document.getElementById('don-zelle-on').checked, info: document.getElementById('don-zelle-info').value.trim(), note: document.getElementById('don-zelle-note').value.trim() };
      appData.donations.venmo      = { enabled: document.getElementById('don-venmo-on').checked, handle: document.getElementById('don-venmo-handle').value.trim().replace(/^@+/, ''), note: document.getElementById('don-venmo-note').value.trim() };
      saveData(); closeModal();
    });
  });
}

// ── PRAYER REQUESTS ──
function renderPrayer() {
  const list = document.getElementById('prayer-forms-list');
  if (!list) return;
  const forms = ensureArray(appData.prayerForms, DEFAULT_DATA.prayerForms)
    .filter(f => f.active !== false || isAdmin());

  if (!forms.length) {
    list.innerHTML = '<p style="color:var(--text-muted)">No prayer forms available.</p>';
    return;
  }

  list.innerHTML = forms.map(form => `
    <div class="prayer-form-card" data-open-form="${form.id}">
      <div class="prayer-form-icon">${form.type === 'ancestors' ? '&#9729;&#65039;' : '&#128591;'}</div>
      <div class="prayer-form-body">
        <div class="prayer-form-title">${esc(form.title)}</div>
        <div class="prayer-form-desc">${esc(form.description)}</div>
        ${!form.active ? '<span class="prayer-inactive-badge">Inactive</span>' : ''}
      </div>
      <div class="prayer-form-arrow">&#8250;</div>
      ${isAdmin() && !form.fixed ? `<div class="prayer-admin-btns">
        <button class="card-action-btn" data-edit-pf="${form.id}">&#9998;</button>
        <button class="card-action-btn delete" data-del-pf="${form.id}">&#128465;</button>
      </div>` : ''}
    </div>`).join('');

  list.querySelectorAll('[data-open-form]').forEach(card =>
    card.addEventListener('click', e => {
      if (e.target.closest('[data-edit-pf],[data-del-pf]')) return;
      openPrayerSubmitModal(parseInt(card.dataset.openForm, 10));
    }));
  list.querySelectorAll('[data-edit-pf]').forEach(b =>
    b.addEventListener('click', () => openPrayerFormEditor(parseInt(b.dataset.editPf, 10))));
  list.querySelectorAll('[data-del-pf]').forEach(b =>
    b.addEventListener('click', () => deletePrayerForm(parseInt(b.dataset.delPf, 10))));
}

function openPrayerSubmitModal(formId) {
  const forms = ensureArray(appData.prayerForms, DEFAULT_DATA.prayerForms);
  const form  = forms.find(f => f.id === formId);
  if (!form) return;

  const users = getUsers();
  const user  = currentUser ? users[currentUser.username] : null;
  const fullName = user && (user.firstName || user.lastName)
    ? ((user.firstName || '') + ' ' + (user.lastName || '')).trim()
    : (currentUser ? currentUser.displayName || '' : '');

  const ancestorField = form.type === 'ancestors' ? `
    <div class="form-group"><label class="form-label">Ancestor Name(s)</label>
      <input class="form-input" id="pr-ancestors" placeholder="Name(s) of your ancestors" /></div>` : '';

  openModal(form.title, `
    <p style="font-size:14px;color:var(--text-muted);line-height:1.5;margin-bottom:16px">${esc(form.description)}</p>
    <div class="form-group"><label class="form-label">Your Name</label>
      <input class="form-input" id="pr-name" value="${esc(fullName)}" placeholder="Your full name" /></div>
    ${ancestorField}
    <div class="form-group"><label class="form-label">Prayer Request</label>
      <textarea class="form-textarea" id="pr-text" style="min-height:120px" placeholder="Share your prayer request here..."></textarea></div>
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">&#128274; Your request is received privately by our prayer team.</p>
    <button class="form-btn form-btn-primary" id="submit-prayer-btn">&#128591; Submit Prayer Request</button>
  `, () => {
    document.getElementById('submit-prayer-btn').addEventListener('click', () => {
      const name      = document.getElementById('pr-name').value.trim();
      const text      = document.getElementById('pr-text').value.trim();
      const ancestors = form.type === 'ancestors' ? (document.getElementById('pr-ancestors') || {}).value || '' : '';
      if (!name || !text) { showToast('Please enter your name and prayer request.', 'error'); return; }
      const btn = document.getElementById('submit-prayer-btn');
      btn.disabled = true;
      btn.textContent = 'Sending…';
      prayerRequestsRef.push({
        uid:            currentUser ? currentUser.uid : '',
        formId:         form.id,
        formTitle:      form.title,
        memberUsername: currentUser ? currentUser.username : '',
        memberName:     name,
        ancestorNames:  ancestors.trim(),
        prayerText:     text,
        submittedAt:    new Date().toISOString()
      }).then(() => {
        closeModal();
        showToast('Your prayer request has been submitted. Thank you.', 'info');
      }).catch(err => {
        console.error('Prayer request error:', err);
        btn.disabled = false;
        btn.innerHTML = '&#128591; Submit Prayer Request';
        showToast('Could not send your request — please check your connection and try again.', 'error');
      });
    });
  });
}

function openPrayerInboxModal() {
  openModal('Prayer Inbox', '<p style="color:var(--text-muted);font-size:13px">Loading…</p>', () => {});
  prayerRequestsRef.once('value')
    .then(async snap => {
      const live = [];
      snap.forEach(c => { live.push(c.val()); });

      // Requests submitted before prayer requests moved out of church/data are
      // still readable by every member. Move them across and clear the old
      // copy now that an admin (who can write both) is here.
      const legacy = ensureArray(appData.prayerRequests);
      if (legacy.length) {
        try {
          for (const r of legacy) await prayerRequestsRef.push(r);
          appData.prayerRequests = [];
          await churchRef.child('prayerRequests').set([]);
          legacy.forEach(r => live.push(r));
        } catch (err) {
          console.error('Prayer request migration failed:', err);
          legacy.forEach(r => live.push(r));
        }
      }
      renderPrayerInbox(live);
    })
    .catch(err => {
      console.error('Prayer inbox error:', err);
      document.getElementById('modal-body').innerHTML =
        '<p style="color:#c0392b;font-size:14px">Could not load prayer requests. Admin access is required.</p>';
    });
}

function renderPrayerInbox(all) {
  const requests = all.slice()
    .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));

  if (!requests.length) {
    document.getElementById('modal-body').innerHTML =
      '<p style="color:var(--text-muted);font-size:14px;text-align:center;padding:24px 0">No prayer requests yet.</p>';
    return;
  }

  // Group by form
  const groups = {};
  for (const req of requests) {
    const k = req.formTitle || 'General';
    if (!groups[k]) groups[k] = [];
    groups[k].push(req);
  }

  let html = `<p style="font-size:12px;color:var(--text-muted);margin-bottom:16px">${requests.length} total request${requests.length !== 1 ? 's' : ''} (newest first)</p>`;
  for (const [title, items] of Object.entries(groups)) {
    html += `<p style="font-size:11px;font-weight:700;color:var(--purple);text-transform:uppercase;letter-spacing:.07em;margin:16px 0 8px">${esc(title)} (${items.length})</p>`;
    html += items.map(req => {
      const d = new Date(req.submittedAt);
      return `<div class="prayer-inbox-item">
        <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px">
          <span class="prayer-inbox-name">${esc(req.memberName)}</span>
          <span class="prayer-inbox-date">${d.toLocaleDateString()}</span>
        </div>
        ${req.ancestorNames ? `<div style="font-size:12px;color:var(--purple-light);margin-bottom:4px">&#9729;&#65039; ${esc(req.ancestorNames)}</div>` : ''}
        <div class="prayer-inbox-text">${esc(req.prayerText)}</div>
      </div>`;
    }).join('');
  }
  document.getElementById('modal-body').innerHTML = html;
}

function openPrayerFormEditor(id) {
  const forms = ensureArray(appData.prayerForms, DEFAULT_DATA.prayerForms);
  const form  = id ? forms.find(f => f.id === id) : null;
  openModal(form ? 'Edit Prayer Form' : 'New Prayer Form', `
    <div class="form-group"><label class="form-label">Title *</label>
      <input class="form-input" id="pf-title" value="${esc(form ? form.title : '')}" placeholder="e.g. Spring Service Prayer" /></div>
    <div class="form-group"><label class="form-label">Description</label>
      <textarea class="form-textarea" id="pf-desc" style="min-height:80px" placeholder="Describe what this form is for, what to include, etc.">${esc(form ? form.description : '')}</textarea></div>
    <div class="settings-toggle-row" style="margin-bottom:16px">
      <div class="toggle-info"><div class="toggle-title">Active (visible to members)</div></div>
      <label class="toggle-switch">
        <input type="checkbox" id="pf-active" ${(!form || form.active !== false) ? 'checked' : ''} />
        <span class="toggle-slider"></span>
      </label>
    </div>
    <button class="form-btn form-btn-primary" id="save-pf-btn">Save Form</button>
  `, () => {
    document.getElementById('save-pf-btn').addEventListener('click', () => {
      const title  = document.getElementById('pf-title').value.trim();
      const desc   = document.getElementById('pf-desc').value.trim();
      const active = document.getElementById('pf-active').checked;
      if (!title) return;
      if (!appData.prayerForms) appData.prayerForms = [...DEFAULT_DATA.prayerForms];
      if (id) {
        const idx = appData.prayerForms.findIndex(f => f.id === id);
        if (idx >= 0) Object.assign(appData.prayerForms[idx], { title, description: desc, active });
      } else {
        appData.prayerForms.push({ id: nextId(appData.prayerForms), type: 'custom', title, description: desc, active, fixed: false });
      }
      saveData(); closeModal();
    });
  });
}

function deletePrayerForm(id) {
  if (!confirm('Delete this prayer form? Existing submissions in the inbox are kept.')) return;
  appData.prayerForms = ensureArray(appData.prayerForms, DEFAULT_DATA.prayerForms).filter(f => f.id !== id);
  saveData();
}

// ── SOREI-SAISHI ──

// Returns ISO "YYYY-MM-DD" of next occurrence for an ancestor
function getSoreiNextDate(anc) {
  if (!anc.annual) return anc.serviceDate || '';
  const today = new Date();
  const y = today.getFullYear();
  const candidate = new Date(y, (anc.serviceMonth || 1) - 1, anc.serviceDay || 1);
  if (candidate < today) candidate.setFullYear(y + 1);
  return candidate.getFullYear() + '-' + String(candidate.getMonth() + 1).padStart(2, '0') + '-' + String(candidate.getDate()).padStart(2, '0');
}

function getSoreiDaysUntil(anc) {
  const iso = getSoreiNextDate(anc);
  if (!iso) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const svc   = new Date(iso + 'T00:00:00');
  return Math.round((svc - today) / 86400000);
}

// Returns 'overdue' | 'due' | 'upcoming' | 'past' | null
function getSoreiStatus(anc) {
  const days = getSoreiDaysUntil(anc);
  if (days === null) return null;
  if (!anc.annual && days < 0) return 'past';
  if (days < 0) return 'overdue';
  if (days <= 45) return 'due';
  return 'upcoming';
}

// Returns all ancestor-member pairs needing reminders (within 45-day window)
function getSoreiDueList() {
  const today = new Date(); today.setHours(0,0,0,0);
  const thisYear = today.getFullYear();
  const results = [];
  for (const entry of (appData.soreiSaishi || [])) {
    for (const anc of (entry.ancestors || [])) {
      const days = getSoreiDaysUntil(anc);
      if (days === null || days < 0 || days > 45) continue;
      // Check if reminder was already sent this cycle
      if (anc.annual && anc.reminderSentYear === thisYear) continue;
      if (!anc.annual && anc.reminderSentDate === getSoreiNextDate(anc)) continue;
      results.push({ entry, anc, days });
    }
  }
  return results;
}

function soreiDateDisplay(anc) {
  if (anc.annual) {
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const m = parseInt(anc.serviceMonth, 10);
    const d = parseInt(anc.serviceDay, 10);
    return 'Annual: ' + (MONTHS[m - 1] || '?') + ' ' + d;
  }
  if (anc.serviceDate) return 'One-time: ' + fromInputDate(anc.serviceDate);
  return 'No date set';
}

function renderSoreiSaishi(filter) {
  const list = document.getElementById('sorei-list');
  if (!list) return;

  const entries = appData.soreiSaishi || [];
  const isAdm = isAdmin();

  // Members see only their own enrollment
  const visible = isAdm
    ? entries.filter(e => !filter || e.memberName.toLowerCase().includes(filter.toLowerCase()) ||
        (e.ancestors || []).some(a => a.name.toLowerCase().includes(filter.toLowerCase())))
    : entries.filter(e => e.memberUsername === (currentUser && currentUser.username));

  // Reminder banner (admin only)
  let bannerHTML = '';
  if (isAdm) {
    const due = getSoreiDueList();
    if (due.length) {
      bannerHTML = `
        <div class="reminder-banner">
          <div class="reminder-banner-icon">&#9888;&#65039;</div>
          <div class="reminder-banner-text">
            <div class="reminder-banner-title">${due.length} reminder${due.length > 1 ? 's' : ''} pending</div>
            <div class="reminder-banner-sub">Services within the next 45 days</div>
          </div>
          <button class="reminder-banner-btn" id="open-reminders-banner-btn">View</button>
        </div>`;
    }
  }

  if (!visible.length) {
    list.innerHTML = bannerHTML + `<div class="sorei-empty"><div class="sorei-empty-icon">&#128333;</div>${
      isAdm ? 'No enrollments yet. Tap + Add to enroll a member.' : 'You are not enrolled in Sorei-Saishi yet. Please contact the church.'
    }</div>`;
    if (isAdm && bannerHTML) document.getElementById('open-reminders-banner-btn').addEventListener('click', openRemindersModal);
    return;
  }

  list.innerHTML = bannerHTML + visible.map(entry => {
    const ancestors = entry.ancestors || [];
    const ancsHTML = ancestors.map(anc => {
      const status = getSoreiStatus(anc);
      const days   = getSoreiDaysUntil(anc);
      let badge = anc.annual
        ? `<span class="ancestor-badge badge-annual">Annual</span>`
        : `<span class="ancestor-badge badge-onetime">One-time</span>`;
      if (status === 'due' || status === 'overdue') {
        badge += ` <span class="ancestor-badge ${status === 'overdue' ? 'badge-overdue' : 'badge-due'}">${
          status === 'overdue' ? 'Overdue' : days + 'd away'
        }</span>`;
      }
      return `
        <div class="ancestor-row">
          <div class="ancestor-row-left">
            <div class="ancestor-name">${esc(anc.name)}</div>
            <div class="ancestor-relation">${esc(anc.relation || '')}</div>
            ${anc.deathDate ? `<div class="ancestor-date" style="font-size:11px">&#10012; Transitioned: ${esc(fromInputDate(anc.deathDate))}</div>` : ''}
            <div class="ancestor-date">${esc(soreiDateDisplay(anc))}</div>
            ${badge}
            ${anc.notes ? `<div style="font-size:12px;color:var(--text-muted);margin-top:3px">${esc(anc.notes)}</div>` : ''}
            <button class="sorei-request-btn" data-req-entry="${entry.id}" data-req-anc="${anc.id}" style="margin-top:8px">&#128395; Request Service</button>
          </div>
          ${isAdm ? `<div class="card-actions" style="display:flex">
            <button class="card-action-btn" data-edit-anc="${entry.id}" data-anc-idx="${anc.id}">&#9998;</button>
            <button class="card-action-btn delete" data-del-anc="${entry.id}" data-anc-idx="${anc.id}">&#128465;</button>
          </div>` : ''}
        </div>`;
    }).join('');

    return `
      <div class="enrollment-card">
        <div class="enrollment-card-header">
          <div class="enrollment-avatar">${esc(initials(entry.memberName || '?'))}</div>
          <div class="enrollment-member-info">
            <div class="enrollment-member-name">${esc(entry.memberName)}</div>
            <div class="enrollment-member-email">${esc(entry.memberEmail || '')}${entry.memberPhone ? ' &bull; ' + esc(entry.memberPhone) : ''}</div>
          </div>
          ${isAdm ? `<div class="card-actions" style="display:flex;gap:6px">
            <button class="card-action-btn" data-add-anc="${entry.id}" title="Add ancestor">+</button>
            <button class="card-action-btn" data-edit-enr="${entry.id}">&#9998;</button>
            <button class="card-action-btn delete" data-del-enr="${entry.id}">&#128465;</button>
          </div>` : ''}
        </div>
        ${ancsHTML || '<div style="padding:10px 16px;font-size:13px;color:var(--text-muted)">No ancestors added yet.</div>'}
      </div>`;
  }).join('');

  // Wire buttons
  if (isAdm && bannerHTML) {
    const b = document.getElementById('open-reminders-banner-btn');
    if (b) b.addEventListener('click', openRemindersModal);
  }

  document.querySelectorAll('[data-edit-enr]').forEach(b =>
    b.addEventListener('click', () => openEnrollmentModal(parseInt(b.dataset.editEnr, 10))));
  document.querySelectorAll('[data-del-enr]').forEach(b =>
    b.addEventListener('click', () => deleteEnrollment(parseInt(b.dataset.delEnr, 10))));
  document.querySelectorAll('[data-add-anc]').forEach(b =>
    b.addEventListener('click', () => openAncestorModal(parseInt(b.dataset.addAnc, 10), null)));
  document.querySelectorAll('[data-edit-anc]').forEach(b =>
    b.addEventListener('click', () => openAncestorModal(parseInt(b.dataset.editAnc, 10), parseInt(b.dataset.ancIdx, 10))));
  document.querySelectorAll('[data-del-anc]').forEach(b =>
    b.addEventListener('click', () => deleteAncestor(parseInt(b.dataset.delAnc, 10), parseInt(b.dataset.ancIdx, 10))));
  document.querySelectorAll('[data-req-entry]').forEach(b =>
    b.addEventListener('click', () => openServiceRequestModal(parseInt(b.dataset.reqEntry, 10), parseInt(b.dataset.reqAnc, 10))));
}

function deleteEnrollment(id) {
  if (!confirm('Remove this member enrollment and all their ancestors?')) return;
  appData.soreiSaishi = appData.soreiSaishi.filter(e => e.id !== id);
  saveData();
}

function deleteAncestor(entryId, ancId) {
  if (!confirm('Remove this ancestor?')) return;
  const entry = (appData.soreiSaishi || []).find(e => e.id === entryId);
  if (!entry) return;
  entry.ancestors = entry.ancestors.filter(a => a.id !== ancId);
  saveData();
}

function openEnrollmentModal(id) {
  const entry = id ? (appData.soreiSaishi || []).find(e => e.id === id) : null;
  const users = getUsers();
  const userOptions = Object.entries(users).map(([u, d]) =>
    `<option value="${esc(u)}" ${entry && entry.memberUsername === u ? 'selected' : ''}>${esc(d.displayName || u)} (${esc(u)})</option>`
  ).join('');

  openModal(entry ? 'Edit Enrollment' : 'Add Enrollment', `
    <div class="form-group"><label class="form-label">Member Name</label>
      <input class="form-input" id="enr-name" value="${esc(entry ? entry.memberName : '')}" placeholder="Full name" /></div>
    <div class="form-group"><label class="form-label">Email</label>
      <input class="form-input" id="enr-email" type="email" value="${esc(entry ? entry.memberEmail || '' : '')}" placeholder="For reminders" /></div>
    <div class="form-group"><label class="form-label">Phone</label>
      <input class="form-input" id="enr-phone" type="tel" value="${esc(entry ? entry.memberPhone || '' : '')}" placeholder="(optional)" /></div>
    <div class="form-group"><label class="form-label">Link to App Account (optional)</label>
      <select class="form-input" id="enr-username">
        <option value="">— None —</option>${userOptions}
      </select></div>
    <button class="form-btn form-btn-primary" id="save-enr-btn">Save</button>
  `, () => {
    document.getElementById('save-enr-btn').addEventListener('click', () => {
      const memberName     = document.getElementById('enr-name').value.trim();
      const memberEmail    = document.getElementById('enr-email').value.trim();
      const memberPhone    = document.getElementById('enr-phone').value.trim();
      const memberUsername = document.getElementById('enr-username').value;
      if (!memberName) return;
      if (!appData.soreiSaishi) appData.soreiSaishi = [];
      if (id) {
        const idx = appData.soreiSaishi.findIndex(e => e.id === id);
        if (idx >= 0) Object.assign(appData.soreiSaishi[idx], { memberName, memberEmail, memberPhone, memberUsername });
      } else {
        appData.soreiSaishi.push({ id: nextId(appData.soreiSaishi), memberName, memberEmail, memberPhone, memberUsername, ancestors: [] });
      }
      saveData(); closeModal();
    });
  });
}

function openAncestorModal(entryId, ancId) {
  const entry = (appData.soreiSaishi || []).find(e => e.id === entryId);
  if (!entry) return;
  const anc = ancId ? (entry.ancestors || []).find(a => a.id === ancId) : null;
  const isAnnual = anc ? anc.annual !== false : true;

  openModal(anc ? 'Edit Ancestor' : 'Add Ancestor', `
    <div class="form-group"><label class="form-label">Ancestor Name</label>
      <input class="form-input" id="anc-name" value="${esc(anc ? anc.name : '')}" placeholder="Full name" /></div>
    <div class="form-group"><label class="form-label">Relation</label>
      <input class="form-input" id="anc-relation" value="${esc(anc ? anc.relation || '' : '')}" placeholder="e.g. Grandfather, Mother" /></div>
    <div class="form-group"><label class="form-label">Date of Transition</label>
      <input class="form-input" id="anc-death-date" type="date" value="${esc(anc ? anc.deathDate || '' : '')}" />
      <p style="font-size:11px;color:var(--text-muted);margin-top:3px">Date the ancestor passed away — used to track service eligibility</p></div>
    <div class="form-group"><label class="form-label">Annual Service Schedule</label>
      <select class="form-input" id="anc-type">
        <option value="annual"  ${isAnnual  ? 'selected' : ''}>Annual (repeats every year on same date)</option>
        <option value="onetime" ${!isAnnual ? 'selected' : ''}>One-time (specific date only)</option>
      </select></div>
    <div id="anc-annual-fields" style="${isAnnual ? '' : 'display:none'}">
      <div style="display:flex;gap:8px">
        <div class="form-group" style="flex:1"><label class="form-label">Month</label>
          <select class="form-input" id="anc-month">
            ${['January','February','March','April','May','June','July','August','September','October','November','December'].map((m,i) =>
              `<option value="${i+1}" ${anc && anc.annual && parseInt(anc.serviceMonth) === i+1 ? 'selected' : ''}>${m}</option>`
            ).join('')}
          </select></div>
        <div class="form-group" style="flex:1"><label class="form-label">Day</label>
          <input class="form-input" id="anc-day" type="number" min="1" max="31" value="${esc(anc && anc.annual ? anc.serviceDay || '' : '')}" placeholder="15" /></div>
      </div>
    </div>
    <div id="anc-onetime-fields" style="${!isAnnual ? '' : 'display:none'}">
      <div class="form-group"><label class="form-label">Service Date</label>
        <input class="form-input" id="anc-date" type="date" value="${esc(anc && !anc.annual ? anc.serviceDate || '' : '')}" /></div>
    </div>
    <div class="form-group"><label class="form-label">Notes (optional)</label>
      <textarea class="form-textarea" id="anc-notes" placeholder="Any special notes...">${esc(anc ? anc.notes || '' : '')}</textarea></div>
    <button class="form-btn form-btn-primary" id="save-anc-btn">Save</button>
  `, () => {
    // Toggle annual/one-time fields
    document.getElementById('anc-type').addEventListener('change', e => {
      const annual = e.target.value === 'annual';
      document.getElementById('anc-annual-fields').style.display = annual ? '' : 'none';
      document.getElementById('anc-onetime-fields').style.display = annual ? 'none' : '';
    });

    document.getElementById('save-anc-btn').addEventListener('click', () => {
      const name      = document.getElementById('anc-name').value.trim();
      const relation  = document.getElementById('anc-relation').value.trim();
      const deathDate = document.getElementById('anc-death-date').value;
      const type      = document.getElementById('anc-type').value;
      const notes     = document.getElementById('anc-notes').value.trim();
      if (!name) return;

      let ancData;
      if (type === 'annual') {
        ancData = {
          annual: true,
          serviceMonth: parseInt(document.getElementById('anc-month').value, 10),
          serviceDay:   parseInt(document.getElementById('anc-day').value, 10) || 1,
          serviceDate:  '',
          reminderSentYear: anc ? (anc.reminderSentYear || 0) : 0
        };
      } else {
        ancData = {
          annual: false,
          serviceMonth: 0, serviceDay: 0,
          serviceDate:  document.getElementById('anc-date').value,
          reminderSentDate: anc ? (anc.reminderSentDate || '') : ''
        };
      }

      if (!entry.ancestors) entry.ancestors = [];
      if (ancId) {
        const idx = entry.ancestors.findIndex(a => a.id === ancId);
        if (idx >= 0) entry.ancestors[idx] = { id: ancId, name, relation, deathDate, notes, ...ancData };
      } else {
        entry.ancestors.push({ id: nextId(entry.ancestors), name, relation, deathDate, notes, ...ancData });
      }
      saveData(); closeModal();
    });
  });
}

// ── SOREI SERVICE REQUESTS ──
const NEN_SAI_YEARS = [1, 2, 3, 4, 5, 10, 15, 20, 30, 40, 50, 100];

function nenSaiEligibleYear(deathDate) {
  if (!deathDate) return null;
  const death = new Date(deathDate + 'T00:00:00');
  const thisYear = new Date().getFullYear();
  const elapsed = thisYear - death.getFullYear();
  return NEN_SAI_YEARS.includes(elapsed) ? elapsed : null;
}

function shinreiDaysRemaining(deathDate) {
  if (!deathDate) return null;
  const death = new Date(deathDate + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  const days = Math.round((today - death) / 86400000);
  return 50 - days; // positive = still within window
}

function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  return DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

function openServiceRequestModal(entryId, ancId) {
  const entry = (appData.soreiSaishi || []).find(e => e.id === entryId);
  if (!entry) return;
  const anc = (entry.ancestors || []).find(a => a.id === ancId);
  if (!anc) return;

  const deathDate = anc.deathDate || '';
  const shinreiDays = deathDate ? shinreiDaysRemaining(deathDate) : null;
  const nenYear = deathDate ? nenSaiEligibleYear(deathDate) : null;

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // Min date for irei-sai / nen-sai: 30 days from today
  const minDate = (() => {
    const d = new Date(); d.setDate(d.getDate() + 30);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  })();

  const shinreiLabel = shinreiDays !== null
    ? (shinreiDays >= 0 ? `&#10003; Eligible — ${shinreiDays} day${shinreiDays !== 1 ? 's' : ''} remaining in 50-day window` : `&#10007; Window closed — more than 50 days have passed since transition`)
    : '&#9432; Death date required — edit this ancestor first';

  const shinreiOk   = shinreiDays !== null && shinreiDays >= 0;
  const isShinreiDisabled = !shinreiOk ? 'disabled' : '';

  const nenLabel = deathDate
    ? (nenYear ? `&#10003; Eligible — year ${nenYear} service` : `&#10007; Not eligible this year (next eligible: ${NEN_SAI_YEARS.map(y => { const d = new Date(deathDate+'T00:00:00'); d.setFullYear(d.getFullYear()+y); return d.getFullYear(); }).find(y => y >= new Date().getFullYear())} or later)`)
    : '&#9432; Death date required — edit this ancestor first';
  const isNenDisabled = (!deathDate || !nenYear) ? 'disabled' : '';

  openModal('Request a Service', `
    <p style="font-size:13px;color:var(--purple);font-weight:700;margin-bottom:4px">${esc(anc.name)}</p>
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:20px">${esc(entry.memberName)}</p>

    <div class="form-group">
      <label class="form-label">Service Type</label>
      <select class="form-input" id="sr-type">
        <option value="">— Choose a service type —</option>
        <option value="shinrei" ${isShinreiDisabled}>Shinrei-Saishi (newly transitioned)</option>
        <option value="irei">Irei-Sai (annual memorial)</option>
        <option value="nen" ${isNenDisabled}>Nen-Sai (special year memorial)</option>
      </select>
    </div>

    <div id="sr-shinrei-info" class="service-rule-box" style="display:none">
      <p style="font-size:13px;font-weight:700;color:var(--purple);margin-bottom:6px">Shinrei-Saishi</p>
      <p style="font-size:13px;color:var(--text-muted);line-height:1.55;margin-bottom:8px">Requested within the first 50 days of transition. A personalized service letter with the 10-day schedule will be generated upon confirmation.</p>
      <p style="font-size:13px;margin-bottom:4px">${shinreiLabel}</p>
      ${deathDate ? `<p style="font-size:12px;color:var(--text-muted);margin-top:6px">10-day services: <strong>${addDays(deathDate,10)}</strong>, <strong>${addDays(deathDate,20)}</strong>, <strong>${addDays(deathDate,30)}</strong>, <strong>${addDays(deathDate,40)}</strong>, <strong>${addDays(deathDate,50)}</strong></p>` : ''}
    </div>

    <div id="sr-irei-info" class="service-rule-box" style="display:none">
      <p style="font-size:13px;font-weight:700;color:var(--purple);margin-bottom:6px">Irei-Sai — Annual Memorial</p>
      <p style="font-size:13px;color:var(--text-muted);line-height:1.55;margin-bottom:12px">Can be requested any time. Usually held on the anniversary of the transition. Must be requested at least 30 days before the desired date.</p>
      <div class="form-group">
        <label class="form-label">Desired Service Date</label>
        <input class="form-input" id="sr-irei-date" type="date" min="${minDate}" />
      </div>
    </div>

    <div id="sr-nen-info" class="service-rule-box" style="display:none">
      <p style="font-size:13px;font-weight:700;color:var(--purple);margin-bottom:6px">Nen-Sai — Special Year Memorial</p>
      <p style="font-size:13px;color:var(--text-muted);line-height:1.55;margin-bottom:8px">Available only in specific anniversary years (1st, 2nd, 3rd, 4th, 5th, 10th, 15th, 20th, 30th, 40th, 50th, 100th). Must be requested at least 30 days before the desired date.</p>
      <p style="font-size:13px;margin-bottom:12px">${nenLabel}</p>
      ${nenYear ? `
      <div class="form-group">
        <label class="form-label">Desired Service Date</label>
        <input class="form-input" id="sr-nen-date" type="date" min="${minDate}" />
      </div>` : ''}
    </div>

    <div class="form-group" style="margin-top:8px">
      <label class="form-label">Notes (optional)</label>
      <textarea class="form-textarea" id="sr-notes" placeholder="Any additional information for the minister..."></textarea>
    </div>

    <button class="form-btn form-btn-primary" id="sr-submit-btn">Submit Request</button>
  `, () => {
    const typeEl = document.getElementById('sr-type');
    const boxes  = { shinrei: 'sr-shinrei-info', irei: 'sr-irei-info', nen: 'sr-nen-info' };

    typeEl.addEventListener('change', () => {
      Object.values(boxes).forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; });
      const sel = boxes[typeEl.value];
      if (sel) { const el = document.getElementById(sel); if(el) el.style.display = ''; }
    });

    document.getElementById('sr-submit-btn').addEventListener('click', () => {
      const type  = typeEl.value;
      const notes = document.getElementById('sr-notes').value.trim();
      if (!type) { showToast('Please choose a service type.', 'error'); return; }

      let desiredDate = '';
      if (type === 'irei') {
        desiredDate = (document.getElementById('sr-irei-date') || {}).value;
        if (!desiredDate) { showToast('Please select a desired service date.', 'error'); return; }
        const diff = Math.round((new Date(desiredDate+'T00:00:00') - new Date().setHours(0,0,0,0)) / 86400000);
        if (diff < 30) { showToast('Irei-Sai must be requested at least 30 days before the service date.', 'error'); return; }
      } else if (type === 'nen') {
        desiredDate = (document.getElementById('sr-nen-date') || {}).value;
        if (!desiredDate) { showToast('Please select a desired service date.', 'error'); return; }
        const diff = Math.round((new Date(desiredDate+'T00:00:00') - new Date().setHours(0,0,0,0)) / 86400000);
        if (diff < 30) { showToast('Nen-Sai must be requested at least 30 days before the service date.', 'error'); return; }
      }

      const typeLabels = { shinrei: 'Shinrei-Saishi', irei: 'Irei-Sai', nen: 'Nen-Sai' };
      const request = {
        id:             Date.now(),
        entryId,
        ancId,
        memberName:     entry.memberName,
        memberUsername: entry.memberUsername || '',
        ancestorName:   anc.name,
        serviceType:    type,
        serviceLabel:   typeLabels[type],
        deathDate:      deathDate,
        desiredDate,
        notes,
        status:         'pending',
        submittedAt:    new Date().toISOString()
      };

      soreiRequestsRef.push({ ...request, uid: currentUser ? currentUser.uid : '' })
        .then(() => {
          if (type === 'shinrei') printShireiSaishiLetter(entry, anc, deathDate);
          closeModal();
          showToast('Service request submitted! Please contact your minister to schedule.', 'info');
        })
        .catch(err => {
          console.error('Service request error:', err);
          showToast('Could not send your request — please check your connection and try again.', 'error');
        });
    });
  });
}

function printShireiSaishiLetter(entry, anc, deathDate) {
  const schedDates = [10, 20, 30, 40, 50].map(n => `<tr><td style="padding:8px 12px;font-weight:600">Day ${n}</td><td style="padding:8px 12px">${addDays(deathDate, n)}</td></tr>`).join('');

  const deathDisplay = (() => {
    const d = new Date(deathDate + 'T00:00:00');
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    return DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  })();

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Shinrei-Saishi Service Letter</title>
<style>
  body { font-family: Georgia, serif; max-width: 720px; margin: 40px auto; padding: 0 24px; color: #1a1a2e; line-height: 1.7; }
  h1 { color: #4a1c6e; font-size: 22px; margin-bottom: 4px; }
  .subtitle { color: #6b3fa0; font-size: 14px; letter-spacing: 0.05em; margin-bottom: 32px; }
  .section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #4a1c6e; margin: 24px 0 8px; border-bottom: 2px solid #d4a843; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  tr:nth-child(odd) td { background: #f5f0ff; }
  td { border: 1px solid #e0d8ed; font-size: 14px; }
  .note { background: #fff7ed; border-left: 4px solid #d4a843; padding: 14px 16px; border-radius: 4px; font-size: 14px; margin-top: 24px; }
  .footer { margin-top: 40px; font-size: 12px; color: #6b6b80; border-top: 1px solid #e0d8ed; padding-top: 12px; }
  @media print { body { margin: 24px auto; } }
</style>
</head>
<body>
<h1>Miroku LA Church</h1>
<div class="subtitle">World Messianity — Los Angeles</div>

<p>Date: ${today}</p>
<p>Dear <strong>${esc(entry.memberName)}</strong>,</p>
<p>We have received your Shinrei-Saishi service request and wish to express our sincere condolences during this time of transition. Please find below the schedule for the 50-day memorial services for your ancestor.</p>

<div class="section-title">Ancestor Information</div>
<p><strong>Name:</strong> ${esc(anc.name)}<br />
<strong>Relation:</strong> ${esc(anc.relation || 'Ancestor')}<br />
<strong>Date of Transition:</strong> ${deathDisplay}</p>

<div class="section-title">50-Day Service Schedule</div>
<p style="font-size:13px;color:#6b6b80;margin-bottom:8px">Services should ideally be performed on or near each of the following dates:</p>
<table>
  <thead><tr style="background:#4a1c6e;color:#fff"><td style="padding:8px 12px">Service</td><td style="padding:8px 12px">Scheduled Date</td></tr></thead>
  <tbody>${schedDates}</tbody>
</table>

<div class="note">
  <strong>Important:</strong> Please contact your minister as soon as possible to arrange the dates and times for each service. The 50-day Shinrei-Saishi period is a sacred time of spiritual transition. Your participation and prayers are essential.
</div>

<p style="margin-top:24px">May your ancestor rest in the Light of God, and may your family find peace and comfort during this time.</p>
<p>In faith and service,<br /><strong>Miroku LA Church</strong><br />World Messianity — Los Angeles</p>

<div class="footer">Miroku LA Church &bull; worldmessianic.org &bull; This letter was generated on ${today}</div>
</body>
</html>`);
  win.document.close();
  setTimeout(() => win.print(), 600);
}

function openSoreiRulesModal() {
  openModal('Sorei-Saishi Rules', `
    <div class="form-group"><label class="form-label">Rules & Information</label>
      <textarea class="form-textarea" id="sorei-rules-text" style="min-height:180px" placeholder="Enter the rules and information for Sorei-Saishi here...">${esc(appData.soreiRules || '')}</textarea></div>
    <button class="form-btn form-btn-primary" id="save-rules-btn">Save</button>
  `, () => {
    document.getElementById('save-rules-btn').addEventListener('click', () => {
      appData.soreiRules = document.getElementById('sorei-rules-text').value.trim();
      saveData(); closeModal();
    });
  });
}

function openRemindersModal() {
  const due = getSoreiDueList();
  const thisYear = new Date().getFullYear();

  const emails = [...new Set(due.map(d => d.entry.memberEmail).filter(Boolean))];

  const itemsHTML = due.length ? due.map(({ entry, anc, days }) => `
    <div class="reminder-item">
      <div class="reminder-item-name">${esc(anc.name)} <span style="font-weight:400;color:var(--text-muted)">— ${esc(anc.relation || '')}</span></div>
      <div class="reminder-item-meta">${esc(soreiDateDisplay(anc))} &bull; <strong>${days === 0 ? 'Today' : days + ' day' + (days !== 1 ? 's' : '') + ' away'}</strong></div>
      <div class="reminder-item-email">&#9993; ${esc(entry.memberName)} &lt;${esc(entry.memberEmail || 'no email')}&gt;</div>
    </div>
  `).join('') : '<p style="color:var(--text-muted);font-size:14px">No reminders due in the next 45 days.</p>';

  openModal('Reminders Due', `
    ${itemsHTML}
    ${due.length ? `
      <div style="margin-top:20px">
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">${emails.length} email address${emails.length !== 1 ? 'es' : ''} to notify</p>
        <button class="form-btn form-btn-primary" id="copy-emails-btn">&#128203; Copy Email List</button>
        <button class="form-btn" id="mark-sent-btn" style="background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;margin-top:8px">&#10003; Mark All as Sent</button>
      </div>` : ''}
  `, () => {
    const copyBtn = document.getElementById('copy-emails-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(emails.join(', ')).then(() => showToast('Email list copied!', 'info')).catch(() => showToast(emails.join(', '), 'info'));
      });
    }
    const markBtn = document.getElementById('mark-sent-btn');
    if (markBtn) {
      markBtn.addEventListener('click', () => {
        if (!confirm('Mark all pending reminders as sent? This cannot be undone.')) return;
        const thisYr = new Date().getFullYear();
        for (const { entry, anc } of due) {
          const e = appData.soreiSaishi.find(x => x.id === entry.id);
          if (!e) continue;
          const a = e.ancestors.find(x => x.id === anc.id);
          if (!a) continue;
          if (a.annual) a.reminderSentYear = thisYr;
          else a.reminderSentDate = a.serviceDate;
        }
        saveData();
        showToast('All reminders marked as sent.', 'info');
        closeModal();
      });
    }
  });
}

// ── MANDATORY PROFILE SETUP ──
function openMandatoryProfileModal(user) {
  let overlay = document.getElementById('profile-setup-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'profile-setup-overlay';
  overlay.className = 'profile-setup-overlay';
  overlay.innerHTML = `
    <div class="profile-setup-card">
      <div class="profile-setup-logo"><img src="logo.svg" alt="Miroku LA Church" /></div>
      <h2 class="profile-setup-title">Welcome! Set Up Your Profile</h2>
      <p class="profile-setup-sub">Please fill in your details and create a personal password before continuing.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-group">
          <label class="form-label">First Name *</label>
          <input class="form-input" id="ps-first" value="${esc(user && user.firstName || '')}" placeholder="First name" />
        </div>
        <div class="form-group">
          <label class="form-label">Last Name *</label>
          <input class="form-input" id="ps-last" value="${esc(user && user.lastName || '')}" placeholder="Last name" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Address</label>
        <input class="form-input" id="ps-address" value="${esc(user && user.address || '')}" placeholder="Street address" />
      </div>
      <div class="form-group">
        <label class="form-label">Phone *</label>
        <input class="form-input" id="ps-phone" type="tel" value="${esc(user && user.phone || '')}" placeholder="(555) 555-5555" />
      </div>
      <div class="form-group">
        <label class="form-label">New Password</label>
        <input class="form-input" id="ps-pw" type="password" placeholder="Optional — set your own password" autocomplete="new-password" />
      </div>
      <div class="form-group">
        <label class="form-label">Confirm Password</label>
        <input class="form-input" id="ps-pw2" type="password" placeholder="Repeat your password" autocomplete="new-password" />
      </div>
      <p class="settings-msg error" id="ps-msg" style="margin-bottom:8px"></p>
      <button class="form-btn form-btn-primary" id="ps-save-btn">Save &amp; Continue</button>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('ps-save-btn').addEventListener('click', async () => {
    const firstName = document.getElementById('ps-first').value.trim();
    const lastName  = document.getElementById('ps-last').value.trim();
    const address   = document.getElementById('ps-address').value.trim();
    const phone     = document.getElementById('ps-phone').value.trim();
    const pw        = document.getElementById('ps-pw').value;
    const pw2       = document.getElementById('ps-pw2').value;
    const msgEl     = document.getElementById('ps-msg');

    if (!firstName || !lastName)     { msgEl.textContent = 'First and last name are required.'; return; }
    if (!phone)                       { msgEl.textContent = 'Phone number is required.'; return; }
    if (pw && pw.length < 6)          { msgEl.textContent = 'Password must be at least 6 characters.'; return; }
    if (pw && pw !== pw2)             { msgEl.textContent = 'Passwords do not match.'; return; }

    const existing = myProfile();
    if (!existing) { msgEl.textContent = 'Account error — please sign out and back in.'; return; }

    if (pw) {
      try {
        await auth.currentUser.updatePassword(pw);
      } catch (err) {
        msgEl.textContent = err.code === 'auth/requires-recent-login'
          ? 'Please sign out and back in before changing your password. Your other details were not saved yet.'
          : authErrorMessage(err);
        return;
      }
    }

    const displayName = firstName + ' ' + lastName;
    await saveUserProfile(currentUser.uid, {
      ...existing, firstName, lastName, address, phone, displayName, profileComplete: true
    });
    currentUser.displayName = displayName;

    overlay.remove();
    showToast('Welcome, ' + firstName + '! Your profile is all set.', 'info');
  });
}

// ── SETTINGS ──
function initSettings() {
  // Load profile fields from account data
  const users = getUsers();
  const user  = users[currentUser.username] || {};
  const setVal = (id, val) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = val || ''; };
  setVal('settings-first-name', user.firstName);
  setVal('settings-last-name',  user.lastName);
  setVal('settings-address',    user.address);
  setVal('settings-phone',      user.phone);

  // Load notification prefs from settingsRef
  settingsRef.once('value').then(snap => {
    const data = snap.exists() ? snap.val() : {};
    const prefs = (data[currentUser.uid] || data[currentUser.username] || {}).notifPrefs || {};
    NOTIF_KEYS.forEach(key => {
      const el = document.getElementById('notif-' + key);
      if (el) el.checked = !!(prefs[key]);
    });
  }).catch(() => {
    const prefs = JSON.parse(localStorage.getItem(NOTIF_KEY) || '{}');
    NOTIF_KEYS.forEach(key => {
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

  // Notification toggles. Driven by NOTIF_KEYS — a second hardcoded list here
  // silently left new toggles with no listener, so they appeared to switch on
  // but saved nothing.
  NOTIF_KEYS.forEach(key => {
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
    // Keyed by uid, not username: the username is derived in two places and a
    // mismatch silently loses the setting.
    data[currentUser.uid] = Object.assign(data[currentUser.uid] || data[currentUser.username] || {}, patch);
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

async function saveProfile() {
  const msgEl    = document.getElementById('settings-profile-msg');
  const firstName = document.getElementById('settings-first-name').value.trim();
  const lastName  = document.getElementById('settings-last-name').value.trim();
  const address   = document.getElementById('settings-address').value.trim();
  const phone     = document.getElementById('settings-phone').value.trim();
  const currentPw = document.getElementById('settings-current-pw').value;
  const newPw     = document.getElementById('settings-new-pw').value;
  const confirmPw = document.getElementById('settings-confirm-pw').value;

  const user = myProfile();
  if (!user) {
    msgEl.textContent = 'Account error — please sign out and back in.';
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

  // Firebase requires proof of the current password before changing it.
  if (newPw) {
    if (!currentPw) {
      msgEl.textContent = 'Enter your current password to change it.';
      msgEl.className = 'settings-msg error';
      return;
    }
    try {
      const cred = firebase.auth.EmailAuthProvider.credential(auth.currentUser.email, currentPw);
      await auth.currentUser.reauthenticateWithCredential(cred);
      await auth.currentUser.updatePassword(newPw);
    } catch (err) {
      msgEl.textContent = (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential')
        ? 'Current password is incorrect.'
        : authErrorMessage(err);
      msgEl.className = 'settings-msg error';
      return;
    }
  }

  const displayName = (firstName && lastName) ? firstName + ' ' + lastName : (firstName || lastName || user.displayName || currentUser.username);
  await saveUserProfile(currentUser.uid, {
    ...user, firstName, lastName, address, phone, displayName, profileComplete: true
  });

  currentUser.displayName = displayName;
  saveUserSettings({ displayName });

  document.getElementById('settings-current-pw').value = '';
  document.getElementById('settings-new-pw').value     = '';
  document.getElementById('settings-confirm-pw').value = '';

  msgEl.textContent = 'Profile saved!';
  msgEl.className = 'settings-msg success';
  setTimeout(() => { if (msgEl) msgEl.textContent = ''; }, 3000);
}

// ── Web Push ──
// Standard VAPID push: no Firebase Cloud Messaging and no paid plan. The
// public key is safe to ship; the matching private key lives in a GitHub
// secret and is only used by the scheduled sender workflow.
const NOTIF_KEYS = ['dailyword', 'events', 'live', 'prayer', 'sorei', 'services', 'oneonone'];

// Filled in from the running service worker, so it always reflects the code
// actually on the device rather than a constant that drifts out of date.
let APP_VERSION = 'checking…';

function loadAppVersion() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data && e.data.type === 'version') {
      APP_VERSION = String(e.data.version).replace('miroku-la-', '');
      renderNotifStatus();
    }
  });
  navigator.serviceWorker.ready
    .then(reg => { if (reg.active) reg.active.postMessage('version'); })
    .catch(() => {});
}

const VAPID_PUBLIC_KEY = 'BGq8bv1aasEYZI8pQTLKT7LO0BQUiK5jiX3SI8xlDFqOpGRvkKq4b-m2mR2YcRTEjcv5C16n6Y1C-3hl6K0YeE4';

function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - base64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// iOS only delivers push to a PWA installed on the Home Screen.
function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

// Store the browser's push subscription against the member so the sender can
// reach them. Called whenever a notification preference is switched on.
async function ensurePushSubscription() {
  if (!pushSupported() || !currentUser) return { ok: false, reason: 'unsupported' };
  if (isIOS() && !isInstalled()) return { ok: false, reason: 'ios-needs-install' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
  }
  const json = sub.toJSON();
  await pushSubsRef.child(currentUser.uid).set({
    uid:       currentUser.uid,
    endpoint:  json.endpoint,
    p256dh:    json.keys.p256dh,
    auth:      json.keys.auth,
    updatedAt: new Date().toISOString()
  });
  return { ok: true };
}

async function removePushSubscription() {
  if (!currentUser) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch {}
  await pushSubsRef.child(currentUser.uid).remove().catch(() => {});
}

// Any preference still on? If not, drop the subscription entirely.
function anyNotifPrefOn() {
  return NOTIF_KEYS.some(k => {
    const el = document.getElementById('notif-' + k);
    return el && el.checked;
  });
}

// ── Install prompt ──
// iOS delivers push only to an installed PWA, so nudging members to install is
// what actually makes notifications reach them.
const INSTALL_DISMISSED_KEY = 'miroku-install-dismissed';
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();           // Chrome/Android: keep it for our own button
  deferredInstallPrompt = e;
  showInstallBanner();
});

function installInstructions() {
  if (isIOS()) return 'Tap the Share button below, then "Add to Home Screen".';
  return 'Open your browser menu (⋮) and choose "Install app".';
}

function showInstallBanner(force = false) {
  const el = document.getElementById('install-banner');
  if (!el || isInstalled()) return;
  if (!force && localStorage.getItem(INSTALL_DISMISSED_KEY) === '1') return;
  document.getElementById('install-banner-steps').textContent = installInstructions();
  document.getElementById('install-banner-action').classList.toggle('hidden', !deferredInstallPrompt);
  el.classList.remove('hidden');
}

function initInstallBanner() {
  const el = document.getElementById('install-banner');
  if (!el) return;
  document.getElementById('install-banner-close').addEventListener('click', () => {
    el.classList.add('hidden');
    localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
  });
  document.getElementById('install-banner-action').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    if (outcome === 'accepted') el.classList.add('hidden');
  });
  showInstallBanner();
}

window.addEventListener('appinstalled', () => {
  document.getElementById('install-banner')?.classList.add('hidden');
});

// Shows exactly why notifications are or aren't working on THIS device.
// Without it a failure is invisible: the toggle just quietly does nothing.
async function renderNotifStatus() {
  const el = document.getElementById('notif-status');
  if (!el) return;
  const tail = ` <span style="opacity:.6">(app ${APP_VERSION})</span>`;
  const bad  = msg => { el.innerHTML = msg + tail; el.style.borderColor = '#c0392b'; };
  const good = msg => { el.innerHTML = msg + tail; el.style.borderColor = '#15803d'; };

  if (!pushSupported())            return bad('<strong>Not available.</strong> This browser cannot receive notifications.');
  if (isIOS() && !isInstalled())   return bad('<strong>Add to Home Screen first.</strong> On iPhone, notifications only work from the installed app — tap Share, then "Add to Home Screen", and open it from there.');
  if (Notification.permission === 'denied')
                                   return bad('<strong>Blocked.</strong> Allow notifications for this app in your phone settings, then switch one on below.');

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub)                      return bad('<strong>Not set up on this device.</strong> Switch on a notification below to register this phone.');
    const saved = await pushSubsRef.child(currentUser.uid).once('value');
    if (!saved.exists())           return bad('<strong>Almost there.</strong> This phone is registered but not saved to the church database — switch a notification off and on again.');
    good('<strong>Active on this device.</strong> You will receive the notifications ticked below.');
  } catch (err) {
    bad('<strong>Could not check.</strong> ' + esc(err.message || 'Unknown error'));
  }
}

async function handleNotifToggle(key, enabled) {
  const el = document.getElementById('notif-' + key);
  if (!enabled) {
    updateNotifPref(key, false);
    if (!anyNotifPrefOn()) await removePushSubscription();
    renderNotifStatus();
    return;
  }

  const res = await ensurePushSubscription();
  if (res.ok) { updateNotifPref(key, true); renderNotifStatus(); return; }

  if (el) el.checked = false;
  renderNotifStatus();
  if (res.reason === 'ios-needs-install') {
    showToast('On iPhone, add the app to your Home Screen first to receive notifications.', 'error');
    showInstallBanner(true);
  } else if (res.reason === 'denied') {
    showToast('Notifications are blocked. Turn them on for this app in your phone settings.', 'error');
  } else {
    showToast('This browser does not support notifications.', 'error');
  }
}

function updateNotifPref(key, value) {
  settingsRef.once('value').then(snap => {
    const data = snap.exists() ? snap.val() : {};
    const userSettings = data[currentUser.uid] || data[currentUser.username] || {};
    userSettings.notifPrefs = userSettings.notifPrefs || {};
    userSettings.notifPrefs[key] = value;
    data[currentUser.uid] = userSettings;      // uid, never a derived username
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
  if (title === 'Edit Johrei Times')  bindJohreiForm();
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
// Firebase Auth restores any existing session and fires onAuthStateChanged,
// which is what boots the app. The one thing to check first is whether this
// page was opened from an emailed password-reset link.
handlePasswordResetLink();
