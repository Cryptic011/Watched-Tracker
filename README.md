# Watched Logger

Watched Logger is an installable web app for tracking films and television episodes, including release reminders and cross-device library syncing.

## What each project item is for

| Path | Purpose |
| --- | --- |
| `index.html` | The website shell. Browser logic and styling live in `assets/`; script order is explicit and startup runs last. |
| `manifest.webmanifest` | Installation details used when the site is added to a phone or computer as an app. |
| `sw.js` | The service worker that receives episode-release notifications and opens notification links only inside Watched Logger. Its short conventional name is referenced by the app. |
| `.github/workflows/pages.yml` | Stages the runtime website files and assets and publishes only those files to GitHub Pages with the Node.js 24-compatible checkout, Pages, artifact, and deploy actions. |
| `supabase/functions/watchlog-pin/` | Handles secure PIN access, revision-checked syncing, maintenance enforcement, and the safe title-search gateway. The directory name is also the function's public endpoint name. |
| `supabase/functions/watchlog-reminders/` | Stores notification subscriptions and sends scheduled episode reminders. The directory name is also the function's public endpoint name. |
| `supabase/migrations/` | Reproduces the PIN and background-reminder backends and records maintenance, atomic lockout, and conflict-safe sync changes. |
| `tests/` | Checks sorting, search, saving, and the files published to the site. |

## Repository layout

```text
Watched-Tracker/
├── .github/
│   └── workflows/
│       └── pages.yml
├── supabase/
│   ├── functions/
│   │   ├── watchlog-pin/
│   │   │   └── index.ts
│   │   └── watchlog-reminders/
│   │       └── index.ts
│   └── migrations/
│       ├── 20260903_add_watchlog_maintenance_mode.sql
│       ├── 20260904000100_create_pin_backend.sql
│       ├── 20260904000200_harden_watchlog_sync.sql
│       └── 20260908000100_create_push_backend.sql
├── index.html
├── manifest.webmanifest
├── sw.js
└── tests/
```

Every tracked file is part of the running app, its deployment, or the reproducible backend. There are no generated build folders, dependency folders, or obsolete duplicate files committed to the repository.

## Deployment

Changes pushed to `main` are automatically deployed to GitHub Pages. During deployment, the workflow creates a temporary `_site` directory containing the HTML shell, generated build metadata, gallery files, `assets/`, manifest, and notification worker; repository documentation, workflow configuration, and Supabase source files are not included in the website artifact.

The Supabase functions and migrations are backend components and are deployed through Supabase separately. They are never part of the GitHub Pages upload.

After Pages successfully deploys, `scripts/notify-deployment.mjs` verifies that both the HTML and build metadata serve the new commit, then broadcasts a public deployment hint through Supabase Realtime. Open foreground apps subscribe using `assets/js/deployment-channel.js` and verify same-origin build metadata before reloading. No recurring version polling is used; WebSocket heartbeats only keep the transport alive. Hidden/offline apps disconnect and check on return. Editor and episode-tracker sheets, pending saves and failed saves defer refresh. The channel contains only a commit SHA and uses a publishable key; public messages cannot choose a reload URL or supply executable content. The notification worker remains independent of this foreground connection.

The push-backend migration creates the four private reminder tables and seeds one configuration row. Existing configuration, VAPID keys, and subscriptions are preserved. The first `public_key` request generates VAPID keys. For a new environment, configure a scheduler to POST `{"action":"process"}` to `watchlog-reminders` every minute, with `x-watchlog-cron` set to the configuration row's generated `cron_secret`. Keep that secret in the scheduler's private configuration. The migration does not create a scheduled job. Existing installations with manually provisioned tables should compare their schema before applying it: `CREATE TABLE IF NOT EXISTS` does not reconcile existing column or constraint differences.

Run the application checks with `node --test tests/*.test.mjs`. The deployment workflow runs these checks before publishing.

## Browser code

The files in `assets/js/` are ordered classic scripts sharing the existing app scope. Keep their order in `index.html`; `editor.js` starts the application after all definitions load.

- `app-core.js`: state, DOM references, navigation, dates, appearance and common helpers.
- `reminders.js`: notification setup, maintenance, and local cache primitives.
- `sync.js`: persistence queues, conflict handling, account sessions, metadata refresh and sorting.
- `library.js`: released/watched episode rules, episode tracker, library rendering and filters.
- `catalogue.js`: title identity, search providers and release verification.
- `dashboard.js`: next released episode, seven-day calendar and private reminder activity.
- `discovery.js` and `assets/css/discovery.css`: the Search tab and Add show/film entry point, with poster results, format filters, expandable descriptions, title details and duplicate labels. Search reuses the authenticated catalogue and opens the existing editor before saving; manual entry remains available.
- `editor.js`: title search interaction, editing and startup.
- `assets/css/`: base app styles and dashboard styles.

The dashboard uses the tracker's released-episode map and never treats announced episode totals as released. The calendar shows today plus six days, preserves unknown times and labels saved platforms separately from confirmed UK availability. Private reminder activity is authorized by the existing owner hash in the reminder function, after session validation; every query is scoped to that session account. No schema change is required. Send success means accepted by the push service, not confirmed phone delivery.

## Browser regression checks

`npm ci`, `npx playwright install --with-deps chromium webkit`, then
`BROWSER_ENGINES=all npm run test:browser` exercises the real mobile layout in
Chromium and WebKit. The checks mock all external services and use a separate
test account, so they never change production libraries or send notifications.
Both browser engines must pass before GitHub Pages can publish.

Refresh saves the current library locally and synchronizes it to the cloud before
reloading. Failed synchronization pauses refresh; incomplete editor forms stay
open. Episode rows toggle individual released episodes, Watch next fills the
earliest unwatched gap, and a six-second Undo reverses the latest action.
Release reminders use “Watch Logger Reminder” with the title and timing in the
body. Supporting installed apps show a reminder badge dot while unopened;
private tests do not set a badge, and reopening the app clears it.
