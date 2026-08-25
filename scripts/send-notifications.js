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
 *   announcements — a newly posted announcement (to everyone)
 *   events    — a newly added event (to everyone)
 *   live      — a stream going live (to everyone)
 *   prayer    — a new prayer request (to ministers)
 *   sorei     — a new ancestor service request (to ministers), and a reminder
 *               to the member the day before a requested service date
 *
 * Everything already delivered is recorded under church/pushLog so a message
 * is never sent twice, however often this runs.
 */

const admin    = require('firebase-admin');
const webpush  = require('web-push');

const CHURCH_TZ = 'America/Los_Angeles';

// Every preference this sender acts on. Must match NOTIF_KEYS in app.js.
const PREF_KEYS = ['dailyword', 'announcements', 'services', 'oneonone', 'events', 'live', 'prayer', 'sorei'];

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

  const [subsSnap, dataSnap, settingsSnap, logSnap, apptSnap, prayerSnap, soreiSnap] = await Promise.all([
    db.ref('church/pushSubs').once('value'),
    db.ref('church/data').once('value'),
    db.ref('church/settings').once('value'),
    db.ref('church/pushLog').once('value'),
    db.ref('church/appointments').once('value'),
    db.ref('church/prayerRequests').once('value'),
    db.ref('church/soreiRequests').once('value')
  ]);

  const subs     = subsSnap.val()     || {};
  const data     = dataSnap.val()     || {};
  const settings = settingsSnap.val() || {};
  const sentLog  = logSnap.val()      || {};
  const apptsByUser = apptSnap.val()  || {};
  const prayers     = prayerSnap.val() || {};
  const soreis      = soreiSnap.val()  || {};

  // Map uid -> notification preferences. Settings are keyed by username, so
  // resolve through the profile list.
  const usersSnap = await db.ref('church/users').once('value');
  const users = usersSnap.val() || {};
  // Settings are keyed by uid. Older records were keyed by a derived username,
  // so fall back to that until every device has written a uid-keyed entry.
  // Merge, never short-circuit. settings/{uid} can exist holding only a
  // displayName — short-circuiting on the entry meant that masked any legacy
  // username-keyed notifPrefs and the member silently received nothing.
  const prefsFor = uid => {
    const profile = users[uid] || {};
    const at = k => (k && settings[k] && settings[k].notifPrefs) || {};
    const all = {
      ...at((profile.email || '').split('@')[0]),
      ...at(profile.username),
      ...at(uid)                       // uid-keyed wins where present
    };
    // Only what this sender can actually deliver. Retired keys left in old
    // records otherwise show up in the log as though someone were subscribed
    // to something.
    const known = {};
    for (const k of PREF_KEYS) if (k in all) known[k] = all[k];
    return known;
  };

  // One compact line per subscriber so a mismatch is visible in the log rather
  // than guessed at. Masked: these logs are public on a public repository.
  const mask = v => { const t = String(v || ''); return t ? t.slice(0, 2) + '…(' + t.length + ')' : '(none)'; };

  // Fold legacy username- and email-keyed preferences into the uid-keyed node.
  // The sender reads them either way, but the app no longer can: a member may
  // only read church/settings/{their own uid}, so anything still filed under an
  // old key showed every toggle as off — and touching one wrote a uid-keyed
  // entry that then masked the rest. Runs here because only this job has the
  // access to read one member's node and write another's. Idempotent: once the
  // uid node agrees with the merged view there is nothing left to write.
  // Housekeeping must never cost anyone a notification: if this fails, log it
  // and go on to send.
  try {
    for (const uid of Object.keys(users)) {
      // Only the preferences this sender actually acts on. Copying anything
      // else forward would re-establish dead keys — 'classes' outlived the
      // Classes section it belonged to — under the key the app now reads.
      const merged = { ...prefsFor(uid) };   // already limited to known keys
      const current = (settings[uid] && settings[uid].notifPrefs) || {};
      // Retire preferences for features that no longer exist — 'classes'
      // outlived the Classes and Groups section by some margin. Nothing reads
      // them, but they linger in the log making it hard to see what is real.
      for (const k of Object.keys(current)) if (!PREF_KEYS.includes(k)) merged[k] = null;
      if (!Object.keys(merged).length) continue;
      if (Object.keys(merged).every(k => current[k] === merged[k])) continue;
      await db.ref('church/settings').child(uid).child('notifPrefs').update(merged);
      settings[uid] = { ...(settings[uid] || {}), notifPrefs: merged };
      console.log(`Moved notification preferences to the uid key for ${mask(uid)}`);
    }
  } catch (err) {
    console.error(`Could not tidy notification preferences (${err.message}) — sending anyway`);
  }
  console.log('— subscribers —');
  for (const uid of Object.keys(subs)) {
    const profile = users[uid] || {};
    const has = k => !!(k && settings[k] && settings[k].notifPrefs);
    const via = [has(uid) && 'uid', has(profile.username) && 'username',
                 has((profile.email || '').split('@')[0]) && 'email-prefix']
                .filter(Boolean).join('+') || 'NO PREFS ANYWHERE';
    const p = prefsFor(uid);
    console.log(`  ${mask(uid)} role=${profile.role || '?'} settingsVia=${via} `
      + `on=[${Object.keys(p).filter(k => p[k] === true).join(',') || 'none'}]`);
  }
  console.log(`— settings entries: ${Object.keys(settings).length} —`);

  // The list above only shows people who HAVE a subscription. Someone whose
  // toggle looks on but never saved one is invisible there — and receives
  // nothing. Cross-reference every account against pushSubs to surface them.
  const wantsSomething = uid => Object.values(prefsFor(uid)).some(v => v === true);
  const orphans = Object.keys(users).filter(uid => !subs[uid] && wantsSomething(uid));
  const silent  = Object.keys(users).filter(uid => !subs[uid] && !wantsSomething(uid));

  console.log(`— accounts: ${Object.keys(users).length} total, ${Object.keys(subs).length} with a push subscription —`);
  if (orphans.length) {
    console.log(`  !! ${orphans.length} account(s) have notifications switched ON but NO subscription`);
    console.log('     (their toggle did not save, or their device never registered — they receive nothing)');
    for (const uid of orphans) {
      const p = prefsFor(uid);
      console.log(`     ${mask(uid)} role=${(users[uid] || {}).role || '?'} `
        + `on=[${Object.keys(p).filter(k => p[k] === true).join(',')}]`);
    }
  }
  if (silent.length) {
    console.log(`  ${silent.length} account(s) have no subscription and nothing switched on:`);
    for (const uid of silent) {
      console.log(`     ${mask(uid)} role=${(users[uid] || {}).role || '?'}`);
    }
  }

  // Server-side truth about what is actually stored, so a "sent" request that
  // appears nowhere can be confirmed or ruled out from the log.
  const apptTotal = Object.values(apptsByUser)
    .reduce((n, byId) => n + Object.keys(byId || {}).length, 0);
  console.log(`— appointments: ${apptTotal} across ${Object.keys(apptsByUser).length} member(s) —`);
  for (const [auid, byId] of Object.entries(apptsByUser)) {
    for (const [aid, a] of Object.entries(byId || {})) {
      console.log(`  ${mask(auid)}/${mask(aid)} ${a.type || 'oneonone'} ${a.status} ${a.date} ${a.time}`);
    }
  }

  console.log(`— prayer requests: ${Object.keys(prayers).length} · sorei requests: ${Object.keys(soreis).length} —`);

  // "We went live and nobody was told" is otherwise impossible to diagnose from
  // here: whether the switch was on, and how long the stamp had been sitting
  // there, is the whole answer. Not personal data, so printed plainly.
  const liveState = data.liveEvents || {};
  console.log(`— live streaming —`);
  for (const [platform, l] of Object.entries(liveState)) {
    const t = Date.parse((l || {}).activatedAt || '');
    const age = isNaN(t) ? 'no activation stamp'
      : `switched on ${Math.round((Date.now() - t) / 60000)} min ago`;
    console.log(`  ${platform}: ${(l || {}).active ? 'ON' : 'off'}, ${age}`
      + (l && l.active && !isNaN(t) && Date.now() - t > 3 * 3600000
         ? '  << too old to announce — switch it off and on again when the stream starts' : ''));
  }

  // Anything older than this is treated as pre-existing and never announced,
  // so switching a notification type on cannot flood everyone with a backlog.
  const RECENT_DAYS = 3;
  const recentEnough = iso => {
    const t = Date.parse(iso || '');
    return !isNaN(t) && (Date.now() - t) < RECENT_DAYS * 86400000;
  };

  // Bailing out here rather than at the top: with nobody subscribed there is
  // nothing to send, but the diagnostics above and the preference tidy-up are
  // exactly what gets the first person subscribed again.
  if (!Object.keys(subs).length) { console.log('No push subscriptions yet — nothing to send.'); return; }

  const jobs = [];

  // 1. Daily Inspiration — any scheduled message whose moment has passed today.
  const messages = Array.isArray(data.messages) ? data.messages : Object.values(data.messages || {});
  const LOOKBACK_H = 12;
  for (const m of messages) {
    if (!m || !m.scheduledDate) continue;
    const dueMs = Date.parse(`${m.scheduledDate}T${m.scheduledTime || '00:00'}:00${tzOffset(m.scheduledDate)}`);
    if (isNaN(dueMs)) continue;
    const hoursPast = (Date.now() - dueMs) / 3600000;
    // A window, not same-day equality: the scheduler skips runs, so a message
    // due at 23:50 would otherwise be missed permanently once the date rolls.
    if (hoursPast < 0 || hoursPast > LOOKBACK_H) continue;
    jobs.push({
      // The stamp makes an edited message a different notification, so fixing
      // the wording and re-scheduling actually sends. Numeric: keys cannot
      // contain '.'.
      key:  `dailyword-${m.scheduledDate}-${m.id}-${Number(m.updatedAt) || 0}`,
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

    // Johrei times are presented to members the same way service times are, so
    // they get the same morning reminder. Namespaced key: ids can collide
    // across the two lists.
    const johrei = Array.isArray(data.johreiSessions)
      ? data.johreiSessions : Object.values(data.johreiSessions || {});
    for (const j of johrei) {
      const rec = j && j.recurrence;
      if (!rec || typeof rec.weekday !== 'number') continue;
      if (rec.weekday !== now.weekday) continue;
      const nths = Array.isArray(rec.nths) ? rec.nths : [];
      if (nths.length && !nths.includes(nthOfMonth(now.day))) continue;
      jobs.push({
        key:  `johrei-${now.date}-${j.id}`,
        pref: 'services',
        title: j.title || 'Johrei today',
        body:  `Today${j.time ? ' at ' + j.time : ''}.`
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

      // A member cancelling — tell the ministers. Without this the app told the
      // member "your minister has been notified" and nothing was ever sent, so
      // the minister could sit waiting on Zoom for a meeting called off days
      // earlier. Bounded by when it was cancelled, not by the meeting time: a
      // cancellation is news the moment it happens.
      if (a.status === 'cancelled' && adminUids.length
          && a.cancelledAt && recentEnough(a.cancelledAt)) {
        jobs.push({
          key: `apptcancel-${uid}-${apptId}`, pref: 'oneonone', to: adminUids,
          title: isJohrei ? 'Johrei session cancelled' : 'Meeting cancelled',
          body: `${nameOf} cancelled the ${kind} scheduled for ${whenLabel(a)}.${phone}`
        });
      }

      // The decision, sent to the member. Bounded to meetings still ahead, so
      // enabling notifications later cannot dredge up old outcomes.
      // Bound on when the minister decided, not on the meeting time: a late
      // reply is exactly when the member most needs to hear it.
      const decidedRecently = a.decidedAt ? recentEnough(a.decidedAt) : false;
      const stillAhead = new Date(`${a.date}T${a.time}:00${tzOffset(a.date)}`).getTime() > Date.now();
      if (a.status === 'approved' && (stillAhead || decidedRecently)) {
        jobs.push({
          key: `apptok-${uid}-${apptId}`, pref: 'oneonone', to: [uid],
          title: isJohrei ? 'Johrei session confirmed' : 'Meeting confirmed',
          body: `Your minister confirmed ${whenLabel(a)} — ${a.duration} min${extra}, `
              + `${a.mode === 'online' ? 'online (Zoom)' : 'in person'}.`
        });
      }
      if (a.status === 'declined' && (stillAhead || decidedRecently)) {
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
      // Only call it "tomorrow" when it genuinely is. Approving at 09:00 for a
      // 15:00 slot used to send "Meeting tomorrow" showing today's date.
      const meetingDay = new Intl.DateTimeFormat('en-CA', { timeZone: CHURCH_TZ })
        .format(new Date(meetingMs));
      const isTomorrow = meetingDay !== now.date;
      if (minsAway <= 24 * 60 && minsAway > 60 && isTomorrow) {
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
  // Delivered is per recipient. Recording it per job meant that if the admin
  // succeeded and a member's push failed, the member never got another attempt.
  const deliveredTo = (k, uid) => {
    const e = sentLog[k];
    if (!e || !e.to || typeof e.to !== 'object') return false;  // legacy entries: retry
    return e.to[uid] === true;
  };
  // 3b. New events — announced to everyone. Only events carrying a recent
  //     createdAt qualify, so the existing list is never announced in bulk.
  const events = Array.isArray(data.events) ? data.events : Object.values(data.events || {});
  for (const e of events) {
    if (!e || !e.createdAt || !recentEnough(e.createdAt)) continue;
    jobs.push({
      key: `event-${e.id}`, pref: 'events',
      title: e.title || 'New event',
      body: [e.date, e.desc].filter(Boolean).join(' — ').slice(0, 140)
    });
  }

  // 3b-ii. A newly posted announcement. The popup only reaches someone who
  //        opens the app; this is what makes an urgent one urgent. The key
  //        carries the announcement's id, so editing the wording and posting
  //        again announces again, exactly as the popup does.
  const ann = data.announcement;
  if (ann && ann.active && ann.id && recentEnough(ann.postedAt)) {
    jobs.push({
      key: `announce-${ann.id}`, pref: 'announcements',
      title: ann.title || 'A message from your minister',
      body: String(ann.text || '').replace(/\s+/g, ' ').trim().slice(0, 140)
    });
  }

  // 3c. Live stream — announced when a platform is switched on. The key carries
  //     the activation stamp, so switching it on again next week announces
  //     again rather than being treated as already sent.
  const live = data.liveEvents || {};
  for (const [platform, l] of Object.entries(live)) {
    if (!l || !l.active || !l.activatedAt) continue;
    const startedMs = Date.parse(l.activatedAt);
    if (isNaN(startedMs) || Date.now() - startedMs > 3 * 3600000) continue;  // only while fresh
    jobs.push({
      // Milliseconds, not the ISO string: a Firebase key cannot contain '.'
      key: `live-${platform}-${startedMs}`, pref: 'live',
      title: "We're live now",
      body: `${l.label || platform} has started. Open the app to watch.`
    });
  }

  // 4. Prayer requests — tell the ministers one arrived. Deliberately WITHOUT
  //    the prayer text: these are private, and a push payload shows on a lock
  //    screen. The minister opens the Inbox to read it.
  if (adminUids.length) {
    for (const [id, r] of Object.entries(prayers)) {
      if (!r || !recentEnough(r.submittedAt)) continue;   // don't dredge up old ones
      jobs.push({
        key: `prayer-${id}`, pref: 'prayer', to: adminUids,
        title: 'New prayer request',
        body: `${r.memberName || 'A member'} submitted a request`
            + (r.formTitle ? ` (${r.formTitle})` : '')
            + '. Open the Prayer Inbox to read it.'
      });
    }

    // 5. Ancestor service requests — same idea, to the ministers.
    for (const [id, r] of Object.entries(soreis)) {
      if (!r || !recentEnough(r.submittedAt)) continue;
      jobs.push({
        key: `sorei-${id}`, pref: 'sorei', to: adminUids,
        title: 'New ancestor service request',
        body: `${r.memberName || 'A member'} requested ${r.serviceLabel || 'a service'}`
            + (r.ancestorName ? ` for ${r.ancestorName}` : '')
            + (r.desiredDate ? `, ${r.desiredDate}` : '') + '.'
      });
    }
  }

  // 6. Ancestor service reminder — the day before a requested date, to the
  //    member who asked for it. This is what the "Sorei Reminders" toggle
  //    promises members, as opposed to the minister-facing item above.
  for (const [id, r] of Object.entries(soreis)) {
    if (!r || !r.desiredDate || !r.uid) continue;
    if (r.status === 'cancelled' || r.status === 'declined') continue;
    const at = new Date(`${r.desiredDate}T09:00:00${tzOffset(r.desiredDate)}`).getTime();
    if (isNaN(at)) continue;
    const hoursAway = (at - Date.now()) / 3600000;
    if (hoursAway <= 0 || hoursAway > 24) continue;       // only the day before
    jobs.push({
      key: `soreiremind-${id}`, pref: 'sorei', to: [r.uid],
      title: 'Ancestor service tomorrow',
      body: `${r.serviceLabel || 'Your ancestor service'}`
          + (r.ancestorName ? ` for ${r.ancestorName}` : '')
          + ` is tomorrow, ${r.desiredDate}.`
    });
  }

  // A key is built from stored data, and a Firebase key may not contain
  // . # $ [ ] or /. An illegal one throws on the pushLog write — after the
  // push has gone out — so the delivery is never recorded and the same
  // notification goes out again on every run, for ever. Normalise here, in the
  // one place every key passes through, so the dedupe check and the log write
  // can never disagree about what a job is called.
  for (const j of jobs) j.key = String(j.key).replace(/[.#$[\]/]/g, '_');

  const anyPending = j => Object.keys(subs).some(uid =>
    (!j.to || j.to.includes(uid)) && prefsFor(uid)[j.pref] === true && !deliveredTo(j.key, uid));
  const due = jobs.filter(anyPending);
  if (!due.length) {
    // Distinguish "nothing is scheduled for now" from "it went out already" —
    // reading the first as the second sends you hunting for a bug that is not there.
    console.log(jobs.length
      ? `Nothing new to send — ${jobs.length} item(s) already reached everyone who wants them.`
      : 'Nothing due right now (no message scheduled for today, and no service today).');
    return;
  }

  // ── deliver ──
  const stale = [];
  for (const job of due) {
    // A malformed job must not take the rest of the run down with it.
    try {
      let sent = 0, skipped = 0, already = 0;
      const reached = {};
      for (const [uid, sub] of Object.entries(subs)) {
        if (job.to && !job.to.includes(uid)) continue;      // targeted at specific people
        if (prefsFor(uid)[job.pref] !== true) { skipped++; continue; }
        if (deliveredTo(job.key, uid)) { already++; continue; }
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title: job.title, body: job.body, tag: job.pref, url: './' })
          );
          reached[uid] = true;
          sent++;
        } catch (err) {
          // 404/410 mean the member uninstalled or revoked — drop the record.
          if (err.statusCode === 404 || err.statusCode === 410) stale.push(uid);
          else console.error(`  ${mask(uid)}: ${err.statusCode || ''} ${err.message}`);
        }
      }
      if (sent) {
        const prev = (sentLog[job.key] && sentLog[job.key].to) || {};
        await db.ref('church/pushLog').child(job.key)
          .set({ sentAt: new Date().toISOString(), to: { ...prev, ...reached } });
      }
      console.log(`${job.key}: sent ${sent}`
        + (already ? `, ${already} already had it` : '')
        + (skipped ? `, ${skipped} have it turned off` : '')
        + (sent === 0 ? ' — will retry' : ''));
    } catch (err) {
      console.error(`${job.key}: FAILED (${err.message}) — continuing with the other jobs`);
    }
  }

  for (const uid of [...new Set(stale)]) {
    await db.ref('church/pushSubs').child(uid).remove();
    console.log(`Removed dead subscription for ${mask(uid)}`);  // public log — never raw
  }

  // Keep the log from growing without bound.
  // Removing a pushLog entry licenses a re-send, so prune the OLDEST by time —
  // sorting by key name deleted every appt* record first and re-announced them.
  const keys = Object.keys({ ...sentLog });
  if (keys.length > 400) {
    const age = k => Date.parse((sentLog[k] || {}).sentAt || 0) || 0;
    await Promise.all(keys.sort((a, b) => age(a) - age(b)).slice(0, keys.length - 200)
      .map(k => db.ref('church/pushLog').child(k).remove()));
  }

})()
  // firebase-admin keeps a live connection to the database, so the process will
  // not exit on its own. Every path — including the early "nothing to do"
  // returns — has to end here, or the job hangs until it times out.
  .then(() => { console.log('Done.'); process.exit(0); })
  .catch(err => { console.error(err); process.exit(1); });
