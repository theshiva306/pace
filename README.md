# Pace

A minimal study-competition app for a private group of friends.
Start studying → study → save the session → compete on a weekly leaderboard.

Timer, Groups (leaderboard / live / chat), Profile. Nothing else.

## Stack

React + Vite + Tailwind CSS v4, Firebase Authentication (Google) + Realtime Database, deployed on GitHub Pages.

## 1. Create the Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com) → **Add project**.
2. **Build → Authentication → Get started → Google** → enable it.
3. **Build → Realtime Database → Create database** → start in **locked mode** (any region).
4. Go to **Project settings → General → Your apps → Web app** (`</>`) and register an app. Copy the config values.
5. Go to **Realtime Database → Rules**, paste the contents of `database.rules.json` from this repo, and publish.

## 2. Configure the app

```bash
cp .env.example .env
```

Fill in `.env` with the values from step 1.4 (the database URL looks like
`https://<project-id>-default-rtdb.<region>.firebasedatabase.app`).

## 3. Run locally

```bash
npm install
npm run dev
```

## 4. Deploy to GitHub Pages

See the detailed walkthrough below — the short version: push to GitHub, add your Firebase
config as repository secrets, turn on Pages with source "GitHub Actions", and the included
workflow (`.github/workflows/deploy.yml`) builds and deploys on every push to `main`.

## How the core flow works

- **One active session per user.** `activeSessions/{uid}` in Realtime Database is the single
  source of truth. The Timer screen always computes elapsed time as
  `now - startedAt` (corrected for clock skew via Firebase's `.info/serverTimeOffset`), so a
  refresh, a tab switch, or a short network drop never loses time — nothing is ever counted up
  locally.
- **Stop ≠ Save.** Pressing Stop freezes the duration and opens a confirmation sheet. Only
  **Save** writes a permanent `completedSessions` entry and adds the duration to that week's
  `weeklyTotals`. **Delete** discards it. **Cancel** does neither and leaves the frozen session
  exactly as it was, so nothing is lost by backing out of the sheet.
- **Live is automatic.** There's no "join live" action — starting a session mirrors a lightweight
  pointer into `groups/{groupId}/live/{uid}` for every group the user belongs to; stopping (via
  Save or Delete) removes it. Group members subscribe to that node with a realtime listener, so
  someone opening the app mid-session sees the correct elapsed time immediately, not `00:00`.
- **Weeks reset automatically.** Leaderboard totals are keyed by ISO week id (`2026-W34`,
  Monday–Sunday). A new week simply has no entries yet — old weeks are never deleted or rolled up
  into an analytics view, by design.
- **Idempotent saves.** Saving is keyed by `sessionId`; a duplicate save (double-tap, retried
  request after a refresh) is a no-op rather than a double-counted session.

## Data model

```
users/{uid}                          displayName, photoURL, createdAt
userGroups/{uid}/{groupId}           true

groups/{groupId}
  name, inviteCode, createdBy, createdAt
  members/{uid}                      displayName, photoURL, joinedAt
  live/{uid}                         sessionId, startedAt, mode, targetSeconds
  weeklyTotals/{weekId}/{uid}        durationSeconds
  messages/{messageId}               uid, displayName, text, timestamp

activeSessions/{uid}                 sessionId, startedAt, mode, targetSeconds, status
completedSessions/{uid}/{sessionId}  groupId, startedAt, endedAt, durationSeconds, weekId
inviteCodes/{code}                   groupId
```

`activeSessions` is per-user and owner-only (refresh-safe source of truth); `groups/{id}/live` is
a same-shaped mirror written to every group the user is in, so group members can watch live status
without reading anyone else's private session.

## Security rules

`database.rules.json` enforces, per the Realtime Database rules language:

- No read/write without auth.
- A group's contents are only readable by its members.
- Everyone can only write their own `users`, `activeSessions`, `completedSessions`, `live`, and
  chat messages (`uid` must match `auth.uid`).
- Group membership writes are capped at `MAX_GROUP_SIZE` (6, see `src/lib/sessions.js`).
- `weeklyTotals` writes must come from the member themselves and can't decrease — a lightweight
  guard against accidental or malicious rollback. (A private-group trust model is assumed; for a
  fully tamper-proof leaderboard, move the increment into a Cloud Function — out of scope here.)
- Chat messages are create-only (no edits/deletes) and capped at 500 characters.

## Notable choices / out of scope

- `MAX_GROUP_SIZE` lives in `src/lib/sessions.js` — change it in one place.
- Profile photo uses the Google account photo. A custom-upload flow was intentionally left out to
  avoid pulling in Firebase Storage for v1 (per the brief).
- Dark mode is the only implemented theme; the toggle in Settings is a placeholder for a future
  light theme rather than a functioning switch.
- No streaks, XP, badges, planner, notes, or public/global leaderboard — intentionally.
- Routing uses `HashRouter` (URLs look like `.../#/groups`) instead of `BrowserRouter`, so it
  deploys to GitHub Pages with zero server-side rewrite configuration.

## Group settings UI

Group settings use a compact member list, separate admin controls, confirmation before member removal, and a dedicated leave-group action. Only admins can rename the group, remove members, or delete the group.
