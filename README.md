# Watched Logger

Watched Logger is an installable web app for tracking films and television episodes, including release reminders and cross-device library syncing.

## What each project item is for

| Path | Purpose |
| --- | --- |
| `index.html` | The complete website interface and browser-side app logic. GitHub Pages requires this conventional entry-point name. |
| `manifest.webmanifest` | Installation details used when the site is added to a phone or computer as an app. |
| `sw.js` | The service worker that receives episode-release notifications and opens notification links only inside Watched Logger. Its short conventional name is referenced by the app. |
| `.github/workflows/pages.yml` | Stages the three runtime website files and publishes only those files to GitHub Pages with the Node.js 24-compatible checkout, Pages, artifact, and deploy actions. |
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

Changes pushed to `main` are automatically deployed to GitHub Pages. During deployment, the workflow creates a temporary `_site` directory containing only `index.html`, `manifest.webmanifest`, and `sw.js`; repository documentation, workflow configuration, and Supabase source files are not included in the website artifact.

The Supabase functions and migrations are backend components and are deployed through Supabase separately. They are never part of the GitHub Pages upload.

The push-backend migration creates the four private reminder tables and seeds one configuration row. Existing configuration, VAPID keys, and subscriptions are preserved. The first `public_key` request generates VAPID keys. For a new environment, configure a scheduler to POST `{"action":"process"}` to `watchlog-reminders` every minute, with `x-watchlog-cron` set to the configuration row's generated `cron_secret`. Keep that secret in the scheduler's private configuration. The migration does not create a scheduled job. Existing installations with manually provisioned tables should compare their schema before applying it: `CREATE TABLE IF NOT EXISTS` does not reconcile existing column or constraint differences.

Run the application checks with `node --test tests/*.test.mjs`. The deployment workflow runs these checks before publishing.
