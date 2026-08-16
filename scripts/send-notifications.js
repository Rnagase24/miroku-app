/**
 * Sends due push notifications. Run by .github/workflows/push-notifications.yml
 * on a schedule — free on public repositories, no Firebase Blaze plan needed.
 *
 * Uses the Web Push standard (VAPID) directly, so Apple's and Google's push
 * services deliver the messages at no cost.
 *
 * Two kinds of notification:
 *   dailyword — a scheduled Daily Inspiration whose time has arrived
 *   services  — a reminder on the morning of a service
 *
 * Everything already delivered is recorded under church/pushLog so a message
 * is never sent twice, however often this runs.
 */

const admin    = require('firebase-admin');
const webpush  = require('web-push');

const CHURCH_TZ = 'America/Los_Angeles';

// ── setup ──
const required = ['FIREBASE_SERVICE_ACCOUNT', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'];
const missing  = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error('Missing secrets: ' + missing.join(', '));
  process.exit(1);
}

admin.initializeApp({
  credential:  admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  databaseURL: process.env.DATABASE_URL
});
const db = admin.database();

// Secrets are pasted by hand, often from a phone, so strip whitespace and any
// stray base64 padding rather than failing on an invisible character.
const cleanKey = v => String(v || '').trim().replace(/\s+/g, '').replace(/=+$/, '');
const vapidPublic  = cleanKey(process.env.VAPID_PUBLIC_KEY);
const vapidPrivate = cleanKey(process.env.VAPID_PRIVATE_KEY);

// Report the shape, never the value, so a bad secret is obvious in the log.
console.log(`VAPID public key: ${vapidPublic.length} chars (expected 87)`);
console.log(`VAPID private key: ${vapidPrivate.length} chars (expected 43)`);
if (vapidPublic.length !== 87 || vapidPrivate.length !== 43) {
  console.error('A VAPID key looks wrong. Re-copy it from PUSH-SETUP.md into the repository secret — no spaces or line breaks.');
  process.exit(1);
}

webpush.setVapidDetails(
  String(process.env.VAPID_SUBJECT || 'mailto:info@mirokuLA.org').trim(),
  vapidPublic,
  vapidPrivate
);

// ── date helpers, all in the church's timezone ──
const parts = (d = new Date()) => {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHURCH_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false
  }).formatToParts(d).reduce((o, p) => (o[p.type] = p.value, o), {});
  return {
    date: `${f.year}-${f.month}-${f.day}`,
    time: `${f.hour}:${f.minute}`,
    weekday: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(f.weekday),
    day: parseInt(f.day, 10)
  };
};

// Which occurrence of its weekday a date is: the 1st Sunday, the 2nd, etc.
const nthOfMonth = day => Math.floor((day - 1) / 7) + 1;

// ── main ──
(async () => {
  const now = parts();
  console.log(`Run at ${now.date} ${now.time} (${CHURCH_TZ})`);

  const [subsSnap, dataSnap, settingsSnap, logSnap] = await Promise.all([
    db.ref('church/pushSubs').once('value'),
    db.ref('church/data').once('value'),
    db.ref('church/settings').once('value'),
    db.ref('church/pushLog').once('value')
  ]);

  const subs     = subsSnap.val()     || {};
  const data     = dataSnap.val()     || {};
  const settings = settingsSnap.val() || {};
  const sentLog  = logSnap.val()      || {};

  if (!Object.keys(subs).length) { console.log('No push subscriptions yet — nothing to do.'); return; }

  // Map uid -> notification preferences. Settings are keyed by username, so
  // resolve through the profile list.
  const usersSnap = await db.ref('church/users').once('value');
  const users = usersSnap.val() || {};
  const prefsFor = uid => {
    const profile = users[uid];
    if (!profile) return {};
    const byName = settings[profile.username] || settings[(profile.email || '').split('@')[0]] || {};
    return byName.notifPrefs || {};
  };

  const jobs = [];

  // 1. Daily Inspiration — any scheduled message whose moment has passed today.
  const messages = Array.isArray(data.messages) ? data.messages : Object.values(data.messages || {});
  for (const m of messages) {
    if (!m || !m.scheduledDate) continue;
    if (m.scheduledDate !== now.date) continue;
    if ((m.scheduledTime || '00:00') > now.time) continue;      // not due yet
    jobs.push({
      key:  `dailyword-${m.scheduledDate}-${m.id}`,
      pref: 'dailyword',
      title: m.title || 'Daily Inspiration',
      body:  String(m.text || '').slice(0, 140)
    });
  }

  // 2. Service reminder — on the morning of a service, from 08:00.
  const services = Array.isArray(data.services) ? data.services : Object.values(data.services || {});
  if (now.time >= '08:00') {
    for (const svc of services) {
      const rec = svc && svc.recurrence;
      if (!rec || typeof rec.weekday !== 'number') continue;
      if (rec.weekday !== now.weekday) continue;
      const nths = Array.isArray(rec.nths) ? rec.nths : [];
      if (nths.length && !nths.includes(nthOfMonth(now.day))) continue;
      jobs.push({
        key:  `service-${now.date}-${svc.id}`,
        pref: 'services',
        title: svc.title || 'Service today',
        body:  `Today${svc.time ? ' at ' + svc.time : ''}. We look forward to seeing you.`
      });
    }
  }

  const due = jobs.filter(j => !sentLog[j.key]);
  if (!due.length) { console.log(`${jobs.length} candidate(s), all already sent.`); return; }

  // ── deliver ──
  const stale = [];
  for (const job of due) {
    let sent = 0, skipped = 0;
    for (const [uid, sub] of Object.entries(subs)) {
      if (prefsFor(uid)[job.pref] !== true) { skipped++; continue; }
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: job.title, body: job.body, tag: job.pref, url: './' })
        );
        sent++;
      } catch (err) {
        // 404/410 mean the member uninstalled or revoked — drop the record.
        if (err.statusCode === 404 || err.statusCode === 410) stale.push(uid);
        else console.error(`  ${uid}: ${err.statusCode || ''} ${err.message}`);
      }
    }
    await db.ref('church/pushLog').child(job.key).set({ sentAt: new Date().toISOString(), sent });
    console.log(`${job.key}: sent ${sent}, skipped ${skipped} (pref off)`);
  }

  for (const uid of [...new Set(stale)]) {
    await db.ref('church/pushSubs').child(uid).remove();
    console.log(`Removed dead subscription for ${uid}`);
  }

  // Keep the log from growing without bound.
  const keys = Object.keys({ ...sentLog });
  if (keys.length > 400) {
    await Promise.all(keys.sort().slice(0, keys.length - 200)
      .map(k => db.ref('church/pushLog').child(k).remove()));
  }

})()
  // firebase-admin keeps a live connection to the database, so the process will
  // not exit on its own. Every path — including the early "nothing to do"
  // returns — has to end here, or the job hangs until it times out.
  .then(() => { console.log('Done.'); process.exit(0); })
  .catch(err => { console.error(err); process.exit(1); });
