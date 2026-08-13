# Switching the app to Firebase Authentication

The app now uses Firebase Authentication for sign-in. Passwords are hashed and
held by Google — they are never stored in the database and nobody, including
you, can read them.

**Until you finish steps 1–4 below, nobody can sign in.** The code is deployed
but the Firebase project is not configured for it yet. Do these in order.

---

## 1. Turn on Email/Password sign-in

1. Open the [Firebase console](https://console.firebase.google.com/) and pick
   the **miroku-app-915e2** project.
2. In the left sidebar choose **Build → Authentication**, then **Get started**.
3. On the **Sign-in method** tab, click **Email/Password**, switch **Enable**
   on, and **Save**. Leave "Email link (passwordless)" off.

## 2. Create your own admin login

1. Still in **Authentication**, open the **Users** tab and click **Add user**.
2. Enter your email address and a password, then **Add user**.
3. Copy the **User UID** from the row it creates — a long string of letters and
   numbers. You need it in the next step.

## 3. Make that login an admin

1. Left sidebar → **Build → Realtime Database**, then the **Data** tab.
2. Hover the top-level entry and use the **+** to add a child named `users`
   under `church`, so you end up at `church/users`.
3. Under `church/users`, add a child named with **the UID you copied**.
4. Under that UID, add these fields:

   | Field | Value |
   |---|---|
   | `email` | your email address |
   | `role` | `admin` |
   | `displayName` | your name |
   | `username` | e.g. `rodrigo` |
   | `profileComplete` | `true` |

Getting `role` exactly right matters — it is what grants admin rights.

## 4. Lock down the database

Your database is currently **open to the entire internet**. Anyone can read
every member's details or delete all your data. This step closes that.

1. **Realtime Database → Rules** tab.
2. Replace everything there with the contents of `database.rules.json` from
   this repository.
3. Click **Publish**.

Do not skip this. Firebase Authentication on its own does not protect the
database — these rules are what actually enforce who can read and write.

## 5. Upgrade the existing member accounts

Members created under the old system still have plaintext passwords stored in
the database. Upgrading moves them into Firebase Auth **without changing
anyone's password**.

1. Sign in to the app with the email and password from step 2.
2. Go to **More → Settings → Member Accounts**.
3. At the bottom you will see "Legacy accounts" with a count. Press
   **Upgrade N accounts**.
4. Anything that could not be upgraded is listed with a reason — usually no
   email address on file. Those members need you to create an account for them
   (**Add New Account** on the same screen).

A member who signs in before you run this is upgraded automatically, so nobody
gets locked out either way.

---

## What changed for members

- They sign in with their **email address** instead of a username. Their
  password is unchanged.
- **Forgot your password?** now sends a real reset link to their inbox.
- Passwords can be changed under **Settings**, which asks for the current
  password first.

## What changed for you as admin

- **Add New Account** takes an email and a temporary password. Read the
  password out to the member; they change it in Settings.
- You can no longer set or view someone's password — that is the point of the
  change. Use **Email a password reset link** on their account instead.
- Removing someone from the directory does **not** delete their login. To fully
  remove them, also delete them under **Authentication → Users** in the
  console.

## One thing still worth doing

Rotate the admin password you were using before this change. The old one was
stored in plain text in a publicly readable database for as long as the app has
been live, so treat it as compromised even though it no longer works.
