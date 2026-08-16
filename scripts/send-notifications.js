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
 *   oneonone  — a new request (to ministers), the minister's decision (to the
 *               member), and 24-hour / 1-hour reminders before an approved
 *               meeting (to both)
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

// The UTC offset the church is on for a given date, as "-07:00"/"-08:00", so a
// stored wall-clock time is interpreted in the church's zone rather than the
// runner's UTC.
function tzOffset(isoDate) {
  const probe = new Date(`${isoDate}T12:00:00Z`);
  const asUTC = new Date(probe.toLocaleString('en-US', { timeZone: 'UTC' }));
  const asTZ  = new Date(probe.toLocaleString('en-US', { timeZone: CHURCH_TZ }));
  const mins  = Math.round((asTZ - asUTC) / 60000);
  const sign  = mins < 0 ? '-' : '+';
  const abs   = Math.abs(mins);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

// Which occurrence of its weekday a date is: the 1st Sunday, the 2nd, etc.
const nthOfMonth = day => Math.floor((day - 1) / 7) + 1;

// ── main ──
(async () => {
  const now = parts();
  console.log(`Run at ${now.date} ${now.time} (${CHURCH_TZ})`);

  const [subsSnap, dataSnap, settingsSnap, logSnap, apptSnap] = await Promise.all([
    db.ref('church/pushSubs').once('value'),
    db.ref('church/data').once('value'),
    db.ref('church/settings').once('value'),
    db.ref('church/pushLog').once('value'),
    db.ref('church/appointments').once('value')
  ]);

  const subs     = subsSnap.val()     || {};
  const data     = dataSnap.val()     || {};
  const settings = settingsSnap.val() || {};
  const sentLog  = logSnap.val()      || {};
  const apptsByUser = apptSnap.val()  || {};

  if (!Object.keys(subs).length) { console.log('No push subscriptions yet — nothing to do.'); return; }

  // Map uid -> notification preferences. Settings are keyed by username, so
  // resolve through the profile list.
  const usersSnap = await db.ref('church/users').once('value');
  const users = usersSnap.val() || {};
  // Settings are keyed by uid. Older records were keyed by a derived username,
  // so fall back to that until every device has written a uid-keyed entry.
  const prefsFor = uid => {
    const profile = users[uid] || {};
    const entry = settings[uid]
               || settings[profile.username]
               || settings[(profile.email || '').split('@')[0]]
               || {};
    return entry.notifPrefs || {};
  };

  // One compact line per subscriber so a mismatch is visible in the log rather
  // than guessed at. Masked: these logs are public on a public repository.
  const mask = v => { const t = String(v || ''); return t ? t.slice(0, 2) + '…(' + t.length + ')' : '(none)'; };
  console.log('— subscribers —');
  for (const uid of Object.keys(subs)) {
    const profile = users[uid] || {};
    const via = settings[uid] ? 'uid'
              : settings[profile.username] ? 'username'
              : settings[(profile.email || '').split('@')[0]] ? 'email-prefix'
              : 'NO SETTINGS ENTRY';
    const p = prefsFor(uid);
    console.log(`  ${mask(uid)} role=${profile.role || '?'} settingsVia=${via} `
      + `on=[${Object.keys(p).filter(k => p[k] === true).join(',') || 'none'}]`);
  }
  console.log(`— settings entries: ${Object.keys(settings).length} —`);

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

  // 3. One-on-one meetings — 24h and 1h before an approved meeting. These go to
  //    named recipients (the member plus every minister), not the whole list.
  const adminUids = Object.entries(users)
    .filter(([, p]) => p && p.role === 'admin')
    .map(([uid]) => uid);

  const whenLabel = a => new Date(`${a.date}T${a.time}:00${tzOffset(a.date)}`)
    .toLocaleString('en-US', { timeZone: CHURCH_TZ, weekday: 'short', month: 'short',
                               day: 'numeric', hour: 'numeric', minute: '2-digit' });

  for (const [uid, appts] of Object.entries(apptsByUser)) {
    for (const [apptId, a] of Object.entries(appts || {})) {
      if (!a || !a.date || !a.time) continue;

      const phone = a.memberPhone ? ` Call ${a.memberPhone}.` : '';
      const nameOf = a.memberName || 'A member';
      const isJohrei = a.type === 'johrei';
      const kind   = isJohrei ? 'Johrei session' : 'meeting';
      const extra  = a.withJohrei ? ' plus 15 min Johrei' : '';

      // A request the minister has not yet acted on — tell them it arrived.
      if (a.status === 'pending' && adminUids.length) {
        jobs.push({
          key: `apptnew-${uid}-${apptId}`, pref: 'oneonone', to: adminUids,
          title: isJohrei ? 'New Johrei request' : 'New meeting request',
          body: `${nameOf} asked for a ${a.duration} min ${isJohrei ? 'Johrei session' : 'meeting'}${extra} `
              + `${a.mode === 'online' ? 'online' : 'in person'}, ${whenLabel(a)}.${phone}`
        });
      }

      // The decision, sent to the member. Bounded to meetings still ahead, so
      // enabling notifications later cannot dredge up old outcomes.
      const stillAhead = new Date(`${a.date}T${a.time}:00${tzOffset(a.date)}`).getTime() > Date.now();
      if (a.status === 'approved' && stillAhead) {
        jobs.push({
          key: `apptok-${uid}-${apptId}`, pref: 'oneonone', to: [uid],
          title: isJohrei ? 'Johrei session confirmed' : 'Meeting confirmed',
          body: `Your minister confirmed ${whenLabel(a)} — ${a.duration} min${extra}, `
              + `${a.mode === 'online' ? 'online (Zoom)' : 'in person'}.`
        });
      }
      if (a.status === 'declined' && stillAhead) {
        jobs.push({
          key: `apptno-${uid}-${apptId}`, pref: 'oneonone', to: [uid],
          title: `Your ${kind} request was not approved`,
          body: (a.declineReason || 'Your minister could not make that time.')
              + (a.suggestedAlternative ? ` Suggested instead: ${a.suggestedAlternative}` : '')
        });
      }

      if (a.status !== 'approved') continue;   // reminders are for confirmed meetings only

      // The stored date/time is the church's local wall clock.
      const meetingMs = new Date(`${a.date}T${a.time}:00${tzOffset(a.date)}`).getTime();
      if (isNaN(meetingMs)) continue;
      const minsAway = (meetingMs - Date.now()) / 60000;
      if (minsAway <= 0) continue;                       // already started

      const when = new Date(meetingMs).toLocaleString('en-US', {
        timeZone: CHURCH_TZ, weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit'
      });
      const who  = a.memberName || 'a member';
      const how  = a.mode === 'online' ? 'online (Zoom)' : 'in person';
      const to   = [uid, ...adminUids];

      // Member and minister get different wording — "one-on-one with Ana" reads
      // oddly when you are Ana.
      const push2 = (suffix, title, memberBody, ministerBody) => {
        jobs.push({ key: `${suffix}-m-${uid}-${apptId}`, pref: 'oneonone', to: [uid],
                    title, body: memberBody });
        if (adminUids.length) {
          jobs.push({ key: `${suffix}-a-${uid}-${apptId}`, pref: 'oneonone', to: adminUids,
                      title, body: ministerBody });
        }
      };

      // Above an hour out, send the day-before reminder. Inside the final hour
      // only the 1-hour one is relevant — "tomorrow" would be plainly wrong.
      if (minsAway <= 24 * 60 && minsAway > 60) {
        push2('appt24', isJohrei ? 'Johrei tomorrow' : 'Meeting tomorrow',
          `Your ${kind} with your minister is ${when} — ${a.duration} min${extra}, ${how}.`,
          `${isJohrei ? 'Johrei' : 'One-on-one'} with ${who}, ${when} — ${a.duration} min${extra}, ${how}.${phone}`);
      }
      if (minsAway <= 60) {
        push2('appt1', isJohrei ? 'Johrei in 1 hour' : 'Meeting in 1 hour',
          `Your ${kind} with your minister is at ${when} — ${how}.`,
          `${isJohrei ? 'Johrei' : 'One-on-one'} with ${who} at ${when} — ${how}.${phone}`);
      }
    }
  }

  // Only a job that actually reached somebody counts as delivered. Recording a
  // sent-to-nobody job as done meant that switching a preference on afterwards
  // could never recover the notification.
  const delivered = k => sentLog[k] && (sentLog[k].sent || 0) > 0;
  const due = jobs.filter(j => !delivered(j.key));
  if (!due.length) {
    // Distinguish "nothing is scheduled for now" from "it went out already" —
    // reading the first as the second sends you hunting for a bug that is not there.
    console.log(jobs.length
      ? `Nothing new to send — ${jobs.length} due item(s) already reached their recipients.`
      : 'Nothing due right now (no message scheduled for today, and no service today).');
    return;
  }

  // ── deliver ──
  const stale = [];
  for (const job of due) {
    let sent = 0, skipped = 0;
    for (const [uid, sub] of Object.entries(subs)) {
      if (job.to && !job.to.includes(uid)) continue;   // targeted at specific people
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
    console.log(`${job.key}: sent ${sent}`
      + (skipped ? `, skipped ${skipped} (notification turned off)` : '')
      + (sent === 0 ? ' — will retry until someone receives it' : ''));
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
