# Rolling audit — one part per day

Split into eight parts so each day's work fits inside a session limit. A
scheduled job runs **one unfinished part per day at 9:00 AM Los Angeles**, in
order, and updates the Progress table below.

**This file is the state.** Whoever picks this up reads the table, does the
first part still marked TODO, and marks it DONE with the date and a one-line
result. Nothing else tracks progress.

## How each part is done

1. Read the actual files. Quote line numbers. No speculation.
2. For each candidate finding, try to **refute** it before believing it.
   Most things that look wrong are already handled somewhere else.
3. Fix only what survives refutation, and only with a test that fails before
   the fix and passes after. Tests go in the scratchpad, not the repo.
4. Bump the `CACHE` version in `service-worker.js` so devices pick the change up.
5. Commit, merge to `main` (which triggers a notification run), and report:
   what was found, what was fixed, what needs the church admin to act on
   (republishing `database.rules.json`, Firebase console settings).
6. If a part turns up nothing, say so plainly. A clean part is a real result.

## The app

Static HTML/CSS/JS PWA + Firebase Auth + Realtime Database (compat SDK v10)
+ Web Push (VAPID), sent by `.github/workflows/push-notifications.yml` running
`scripts/send-notifications.js` every 5 minutes via firebase-admin, which
**bypasses security rules**. Live at https://rnagase24.github.io/miroku-app/

| File | What it is |
|---|---|
| `app.js` | the entire client, ~3900 lines |
| `index.html` | all screens; tabs are sections toggled by class |
| `scripts/send-notifications.js` | the notification sender |
| `database.rules.json` | Firebase rules — **the admin must republish by hand after any change** |
| `service-worker.js` | caching + push display; `CACHE` is the version members see |

One admin (the church minister), a handful of members. Admin-only UI is gated
by the `admin-only` class plus `body.is-admin`.

## Bug classes already found — look for more of the same

- `snapshot.forEach(x => arr.push(x))` stopped after one record: Firebase
  cancels enumeration on a truthy return, and `push` returns the new length.
- A pushLog key built from an ISO timestamp contained `.`, which Firebase
  rejects as a key — `child()` threw and killed the whole run.
- A second hardcoded list of notification keys left a new toggle with no
  listener; it looked on and saved nothing.
- Whole-map writes: `set()` on a parent when the rules only grant `.write` on a
  child wildcard is always denied, and clobbers other users.
- Lookups that short-circuit on an object existing rather than on the field
  actually wanted.
- Recycled ids (`max+1` of a live array) colliding with historical records.
- Failures that leave the UI reporting success.

## Progress

| # | Part | Status | Result |
|---|---|---|---|
| 1 | **Rules vs operations** — inventory every read/write in `app.js`; for each, the exact path and whether `database.rules.json` permits it for a member and for an admin. Flag every silent denial. | DONE 2026-08-18 | 24 operations checked. 2 real: member seeded church/data (admin-only write, silent denial); member read the whole settings map to find their own prefs. Both fixed; settings reads now restricted per-uid in the rules. |
| 2 | **Silent failures on member paths** — signup, prayer request, booking a meeting or Johrei, cancelling, saving a profile, toggling notifications. What the member sees vs what happened. | DONE 2026-08-20 | 3 real. Cancelling said "your minister has been notified" — no cancellation notification existed; added one. A rejected cancel showed nothing at all; now reported. `saveUserProfile` swallowed its own error, so signup and Settings said "saved" for a profile that never reached the server; it now rejects and all three callers report the truth. Prayer, sorei and booking already reported failures correctly. |
| 3 | **Regression check** — verify every fix shipped so far is correct, complete, and applied everywhere the pattern occurs. Especially: remaining truthy-return `forEach`, every pushLog key legal for all inputs, the per-recipient log shape vs old entries, scoped settings writes vs the whole-map read in `initSettings`. | DONE 2026-08-21 | Part 1 broke `refreshPushSubscriptionIfWanted`: it still read the whole settings map, which the tightened rules deny, so no member had their subscription re-asserted at sign-in since v38. Fixed per-uid. Same function also carried the short-circuit bug (`settings[uid] \|\| settings[username]`) the sender had already been fixed for — now merged. Legacy username-keyed prefs are unreadable by the app under the new rules, so the sender now folds them into the uid key. Everything else verified clean: all 5 snapshot `forEach` braced, all 13 pushLog keys legal for every input, per-recipient log shape upgrades legacy entries correctly, no whole-map writes left, all 9 id sites use `nextId`, all 7 toggles driven by `NOTIF_KEYS`. |
| 4 | **Notification sender, end to end** — all seven types, dedupe, timezone and DST, midnight rollover, ordering, what happens with 0 / 1 / many subscribers, and every path that can throw. | DONE 2026-08-22 | 4 real. An illegal pushLog key threw *after* the push went out, so the delivery was never recorded and the notification repeated every 5 minutes for ever — keys are now normalised in one place. The part 3 preference tidy-up ran unguarded ahead of sending, so a failure there would have cost everyone their notifications; wrapped. A raw uid was printed to the public Actions log. The no-subscribers early return skipped the diagnostics and tidy-up that are what get the first person subscribed again; moved. All 7 types, dedupe, per-recipient retry, DST both ways, the 08:00 gate, midnight rollover and 410/503 handling verified by 28 tests. |
| 5 | **Auth and session lifecycle** — signup, sign-in, password reset, role changes, sign-out, stale sessions, the legacy-account migration path, and what happens to a signed-in member whose profile or role is edited underneath them. | DONE 2026-08-23 | 4 real. Password reset was unusable for anyone already signed in: the guard waited on the verified code, which arrives over the network, so the restored session opened the app over the reset form first. Now gated on the URL, decided before anything awaits. Sign-out left this device's push subscription filed under the departing member, so on a shared phone the next person received their notifications. A role change took effect only at the next sign-in — a promoted minister saw no admin controls, a demoted one kept buttons the rules refuse; now watched live. subscribeData could stack a second listener on sign-out-and-in. migrateLegacyAccount remains dead code, still failing closed. |
| 6 | **Data model and migrations** — legacy field shapes, `ensureArray`, Firebase turning sparse arrays into objects and dropping empty ones, uid vs username keying, and anything still reading a shape nothing writes. | TODO | |
| 7 | **Client UI correctness** — rendering, admin-only gating (does a member ever see an admin control?), modal lifecycle, duplicate event listeners across sign-in cycles, and the back/tab navigation. | TODO | |
| 8 | **Privacy and security** — what each role can actually read, PII in notification payloads and in the public Actions logs, the public repo, and anything a member could reach that they should not. | TODO | |

## Notes

- Prayer request text is deliberately kept out of push payloads — they show on
  lock screens. Keep it that way.
- Actions logs are public because the repo is public. Anything logged must stay
  masked.
- Events and Live Streaming notifications exist now; all seven toggles have a
  sender behind them.
