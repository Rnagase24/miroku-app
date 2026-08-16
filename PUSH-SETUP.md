# Turning on push notifications

Free. No Firebase Blaze plan, no credit card. It uses the web's built-in push
standard (VAPID) — Apple and Google deliver the messages — and a scheduled
GitHub Action does the sending, which is free on public repositories.

Do these three steps once.

---

## 1. Get a Firebase service account key

This lets the workflow read who's subscribed.

1. https://console.firebase.google.com/project/miroku-app-915e2/settings/serviceaccounts/adminsdk
2. Click **Generate new private key** → **Generate key**. A `.json` file downloads.
3. Open it in a text editor and copy **the whole contents**, including the
   outer `{` and `}`.

Treat that file like a password — it grants full access to your database.
Delete it from your Downloads once step 2 is done.

## 2. Add four repository secrets

Go to: https://github.com/Rnagase24/miroku-app/settings/secrets/actions

Click **New repository secret** for each of these.

| Name | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | the entire JSON from step 1 |
| `VAPID_PUBLIC_KEY` | `BGq8bv1aasEYZI8pQTLKT7LO0BQUiK5jiX3SI8xlDFqOpGRvkKq4b-m2mR2YcRTEjcv5C16n6Y1C-3hl6K0YeE4` |
| `VAPID_PRIVATE_KEY` | `Ke5Spb-ajjOby5vtgxbtZILlWiFYAdSiIe3dfJJzWKU` |
| `VAPID_SUBJECT` | `mailto:` and your email, e.g. `mailto:info@mirokuLA.org` |

The public key is also in `app.js` — that one is meant to be public. **The
private key must only ever live in this secret.** If it leaks, anyone could
send notifications to your members; regenerate the pair if that happens.

## 3. Publish the updated database rules

`database.rules.json` has a new `pushSubs` section. Copy the file's contents
into **Realtime Database → Rules → Publish**, as before. Without it, members
can't register for notifications.

---

## Checking it works

1. Open the app **from your Home Screen** (not a browser tab) and switch on a
   notification in Settings. Allow the permission prompt.
2. Go to **Schedule** on the Daily Inspiration section and schedule a message
   for a few minutes from now.
3. Wait for the workflow, or trigger it immediately:
   https://github.com/Rnagase24/miroku-app/actions/workflows/push-notifications.yml
   → **Run workflow**.
4. The run log lists exactly who was sent to and who was skipped.

The schedule runs every 5 minutes, GitHub's minimum. It is not exact — GitHub
delays scheduled runs when it is busy, so in practice expect a message within
about ten minutes of its scheduled time rather than on the dot.

## What gets sent

- **Daily Inspiration** — when a scheduled message's time arrives.
- **Service Times** — on the morning of a service (from 8am), worked out from
  the recurrence rule, so 2nd and 4th Sundays only.
- **One-on-One meetings** — a new request goes to the ministers (with the
  member's phone), the decision goes to the member, and both are reminded 24
  hours and 1 hour before a confirmed meeting.

Members only receive a type they've switched on in Settings. Everything sent is
recorded under `church/pushLog`, so nothing is ever sent twice however often
the workflow runs.

The other toggles (Events, Live, Prayer) are stored but nothing sends them yet
— those need a trigger deciding *when* to fire. Say the word and they can be
added.

## The iPhone limitation

**On iPhone, notifications only reach members who added the app to their Home
Screen.** Apple does not allow web push from a Safari tab — there is no way
around this. iOS 16.4 or newer is also required.

The app now shows a banner prompting people to install, and switching on a
notification on an uninstalled iPhone explains what to do first. Android is
less restrictive and works either way.

So your notification reach is essentially "how many members installed the app".
Worth mentioning the Home Screen step whenever you share the link.
