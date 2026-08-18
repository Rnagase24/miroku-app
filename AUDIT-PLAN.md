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
| 1 | **Rules vs operations** — inventory every read/write in `app.js`; for each, the exact path and whether `database.rules.json` permits it for a member and for an admin. Flag every silent denial. | TODO | |
| 2 | **Silent failures on member paths** — signup, prayer request, booking a meeting or Johrei, cancelling, saving a profile, toggling notifications. What the member sees vs what happened. | TODO | |
| 3 | **Regression check** — verify every fix shipped so far is correct, complete, and applied everywhere the pattern occurs. Especially: remaining truthy-return `forEach`, every pushLog key legal for all inputs, the per-recipient log shape vs old entries, scoped settings writes vs the whole-map read in `initSettings`. | TODO | |
| 4 | **Notification sender, end to end** — all seven types, dedupe, timezone and DST, midnight rollover, ordering, what happens with 0 / 1 / many subscribers, and every path that can throw. | TODO | |
| 5 | **Auth and session lifecycle** — signup, sign-in, password reset, role changes, sign-out, stale sessions, the legacy-account migration path, and what happens to a signed-in member whose profile or role is edited underneath them. | TODO | |
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
