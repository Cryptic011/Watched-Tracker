## 2026-10-10

### Fix app startup crash after PIN login
- Remove the stale call to the deleted `updateNotificationTestVisibility` function, which threw a `ReferenceError` during account entry and left the login screen stuck.

## 2026-10-10

### Make refresh persistence assertions target the same title
- Capture the edited media ID before Refresh and verify the saved value by ID after reload/login, avoiding brittle assumptions that the first library item remains first after cloud hydration.
- Apply the failed-save guard to that same record so both refresh scenarios test the same item.

## 2026-10-10

### Fix refresh smoke-test hydration wait
- Pass Playwright's timeout in the options argument, not as the page-function argument, and remove the arbitrary delay after verifying the reloaded library.

## 2026-10-10

### Fix refresh browser smoke-test authentication handling
- Keep the Refresh persistence assertion against the mocked cloud library after navigation.
- Re-authenticate through the real PIN form when the isolated browser test origin returns to the login screen, rather than timing out while assuming its session survives a document reload.

## 2026-10-10

### Fix refresh smoke test navigation wait
- Wait for the page's completed reload event after tapping Refresh instead of waiting for a specific mocked cloud login/load response, which was not a reliable signal for browser navigation.
- Retain the persisted-library assertion after reload and the separate failed-cloud-save guard, so Refresh is still tested for data safety rather than merely clicking the button.

## 2026-10-10

### Fix refresh browser smoke-test wait condition
- Wait for the actual mocked cloud login/load response after tapping Refresh instead of a page-local counter that is inaccessible to the browser test context. This addresses the timeout at the refresh step while retaining the saved-data assertions.

## 2026-10-10

### Fix browser refresh smoke test
- Wait for the mocked session reload response after Refresh instead of evaluating the Node-side `loads` variable inside the browser page, which caused the CI smoke test to fail with `ReferenceError: loads is not defined`.

## 2026-10-10

### Fix notification regression test environment
- Provide the GitHub token and repository metadata in the explicit environment used by the workflow-run regression test, matching the sender's required inputs and allowing the Actions run-count lookup to be mocked.

## 2026-10-10

### Fix notification tests after adding overall run-count lookup
- Mock the GitHub Actions total-count API and provide a test token so notification tests exercise the new failed-inclusive overall run counter rather than failing before the status endpoint is called.

## 2026-10-10

### Remove incorrect commit wording from workflow notifications
- Notification bodies now read `Run #N (abcdef0) has passed/has failed/was cancelled/was skipped` using the repository-wide workflow run count, without the misleading word `commit` or redundant “has been pushed”.

## 2026-10-10

### Display the overall failed-inclusive Actions run count in push notifications
- Use GitHub Actions API `total_count` across all workflows for the displayed Run #, including failed runs; preserve the deployment workflow run number separately for source verification.

## 2026-10-10

### Use actual repository-wide workflow-run total
- Fetch GitHub Actions API `total_count` across all workflows at notification time, counting failed and successful runs alike. Keep this separate from the source workflow run number and run ID.

## 2026-10-10

### Correct overall workflow-run count and refresh browser check
- Include the repository-wide Actions run count in deployment status payloads, separately from the source deployment run number and API run ID; the UI can use the all-workflows count that includes failed runs.
- Make the browser refresh test wait for a confirmed subsequent library load instead of relying on a fragile navigation event while verifying saved data survives refresh.

## 2026-10-10

### Fail workflow notification when push delivery is not confirmed
- Require the private status endpoint to report at least one successful device delivery and zero failures; a zero-device or partially failed result now fails the observer workflow instead of showing a misleading green check.
- Log the delivery count and backend reason in the workflow failure for diagnosis.

## 2026-10-10

### Fix stale private-history regression assertion
- Remove the obsolete test-only push table from the private reminder-history query expectations; the test endpoint was intentionally removed, while actual history/library/subscription queries remain scoped to the verified session account.
- Keep the workflow notification wording change and record this deployment-test correction in the changelog.

## 2026-10-10

### Show commit title and concise workflow status in private notifications
- Use the originating commit's title as the notification title, without a generic title when GitHub supplies one.
- Format the body as “Run #N (SHORTSHA) has been pushed and has passed/has failed …”; remove the word “commit” and keep the actual deployment workflow run number.

## 2026-10-10

### Fix workflow-run notification tests and numbering
- Update notification regression tests to use the originating workflow's dedicated source run ID, run number and SHA fields rather than obsolete push-number and secret fields.
- Assert that the backend payload keeps the GitHub run ID separate from the workflow run number and that endpoint errors include the response body.
- Keep the notification text and push data labelled with the actual workflow run number.

## 2026-10-10

### Use workflow run numbers in private status notifications
- Replace the misleading “Push #N” notification label with “Workflow run #N”, using the completed deployment workflow’s `run_number` rather than a push counter or the observer workflow’s own run number.
- Rename the notification data field from `pushNumber` to `workflowRunNumber`; keep the run ID separate for GitHub API verification.
- Keep the notification private to the owner’s enabled subscriptions.

## 2026-10-10

### Fix source workflow run IDs in private status notifications
- Stop assigning source deployment metadata to GitHub-reserved environment variables, which GitHub Actions does not allow workflows to override.
- Pass the completed deployment's run ID, run number and SHA through dedicated WATCHLOG_SOURCE_* variables so verification checks the correct run rather than the notification workflow itself.
- Include the Edge Function response body in failed notification job logs to make any future rejection diagnosable.

## 2026-10-10

### Correct completed-run verification for private status notifications
- Normalize GitHub run-number, SHA and conclusion comparisons and verify the source workflow ID before allowing private push delivery.
- Log the exact mismatched verification fields and return a distinct 403/502 response, so failures identify the rejecting layer instead of appearing as an opaque 401.
- Keep status delivery restricted to the owner's enabled push subscriptions.

## 2026-10-10

### Fix run-status notification HTTP 401
- Configure the reminder Edge Function to use its in-function authentication rather than Supabase JWT gateway verification: deployment-status requests are verified against GitHub Actions, while reminder and session actions retain their own checks.
- Keep the sender’s public publishable key in the `apikey` header; do not treat it as a bearer JWT.
- Bundle the function configuration/source note and this changelog entry in one repository commit.

## 2026-10-10

### Fix private run-status notification authorization
- Send both the Supabase `apikey` and `Authorization: Bearer` headers when calling the reminder Edge Function, so the authenticated endpoint can accept workflow completion notifications.
- Diagnose the failed run from its job log: the notification request returned HTTP 401 before any delivery attempt; this fix addresses that request authentication failure.

## 2026-10-10

### Remove separate deployment-notification secret dependency
- Verify completed run ID, run number, commit SHA and conclusion against GitHub's public Actions API instead of requiring a separately configured shared secret.
- Keep run-status delivery restricted to the owner's enabled push subscriptions; do not restore the removed test option.

## 2026-10-10

### Remove private notification test option
- Remove the private background push-test control and client-side handlers from Settings; normal background reminders remain available.
- Remove test-queue processing and the private test scheduling endpoint from the reminder service, while retaining activity for actual reminders.

## 2026-10-10

### Repair run-status notification and Changelog numbering
- Make the workflow-run test assert the exact source expressions without brittle regular-expression parsing.
- Send out-of-app run-status notifications through the private reminder backend only to the account registered as robert17041@icloud.com; no in-app/public status broadcast is used.
- Require a strong WATCHLOG_DEPLOYMENT_NOTIFY_SECRET on both GitHub Actions and the Supabase Edge Function; include the workflow run number, commit and outcome in the notification.
- Keep the release-note regression contract for showing the workflow run number beside each Changelog commit.
- Correct the notification payload to use `runNumber` consistently and fix numeric validation so legitimate run numbers are accepted.
- Keep the successful-deployment refresh signal separate from the private push-status notification.

## 2026-10-10

### Fix Changelog workflow-run regression test
- Correct the Changelog assertion to match the actual `Number.isInteger(entry.workflowRunNumber)` rendering logic.
- Keep the separate GitHub Actions `run_number` mapping assertion so workflow numbering remains covered.

## 2026-10-10

### Force-refresh bottom navigation fix
- Keep the bottom navigation limited to Library, Search and Settings; remove legacy History and Watchlist tabs even if an old DOM fragment is restored.
- Bump the navigation service-worker cache namespace and app asset query versions so the deployed shell and scripts are fetched fresh after this push instead of continuing to display a stale cached interface.
- Verify the source HTML contains only the three supported bottom tabs and that the navigation cleanup remains active during DOM updates.

## 2026-10-10

### Changelog run numbers, Weekly Releases fix details, and editor cleanup
- Display the GitHub Actions workflow run number beside each corresponding app commit in Changelog, regardless of success, failure, cancellation, queueing or in-progress status.
- Correct the Weekly Releases opt-out regression assertion that caused the previous test-fix build to fail, and record that failure and its correction in the detailed release notes.
- Keep the per-show exclusion setting saved with the series; excluded series remain tracked in the Library and retain episode progress and reminders.
- Replace the crowded uppercase checkbox copy with an aligned, accessible preference row and concise helper text.

## 2026-10-10

### Weekly Releases opt-out — regression test correction
- Keep the per-show “Hide from Weekly Releases” preference in the show editor and saved media record.
- Exclude opted-out shows from both dated releases and Dates to be announced without affecting library tracking or reminders.
- Correct the regression assertion to match the app's existing ID-based selector convention, so the build tests the actual implementation rather than a nonexistent selector.

## 2026-10-10

### Per-show Weekly Releases visibility
- Add a per-show “Hide from Weekly Releases” setting in the show editor.
- Exclude opted-out shows from dated and to-be-announced weekly release lists while retaining their library record, episode tracking, watched progress, status, and reminders.
- Preserve the preference through edits and cloud sync as part of the existing media record.

## 2026-10-09

### Restore complete Changelog and correct app numbering
- Preserve the full repository commit history in the Changelog; overlay workflow outcomes by commit SHA instead of replacing the history with a filtered list of workflow runs.
- Fix the duplicate-filter key so distinct commits are not collapsed when workflow run numbers are unavailable.
- Keep the user's app commit sequence at 270 existing changes, with the next repository commit numbered 271; do not display GitHub Actions push/run numbers.
- Use clear outcome labels (Verified, Failed, Cancelled, In progress, Queued) against the corresponding app commit.

## 2026-10-09

### Changelog numbering and build repair
- Use repository commit-history numbers for the app version and Changelog entries; do not derive app numbering from GitHub Actions run or push numbers.
- Map workflow outcomes to the corresponding repository commit by commit SHA, so successful, failed, and cancelled attempts refer to a meaningful commit.
- Fix the missing closing brace in build metadata generation that stopped deployment before tests and publishing could run.

## 2026-10-09

### App commit number correction
- Derive the displayed app commit number from the deployment workflow run number, preserving the app numbering offset so push run 183 is app commit 267 and push run 184 is app commit 268.
- Do not use the repository-wide Actions workflow-run total as the app commit number.

## 2026-10-09

### App commit numbering
- Show the app commit number in Changelog entries instead of the individual GitHub Actions push-run number.
- Keep failed, cancelled, queued and in-progress attempts in the same app-commit sequence. The weekly releases redesign is app commit 267.

## 2026-10-09

### Weekly releases redesign
- Redesign “This week’s releases” as a compact, date-led weekly schedule with release counts, time chips, clearer title hierarchy and saved-platform labels.
- Group episodes of the same title airing on the same day/time into a single tappable card to avoid long repeated-title lists.
- Improve empty-day states, dates-to-be-announced grouping, mobile spacing and keyboard focus visibility.

# Changelog

## 2026-10-06

### Changelog and push status history
- Rename the app's “What's new” menu and dialog to **Changelog**.
- Show every repository push in the Changelog, including failed, cancelled, timed-out, skipped, queued, and in-progress pushes rather than only successful changes.
- Resolve each push's GitHub Actions result by commit SHA and preserve the actual push number, using status-specific wording such as “Failed push 178”, “Cancelled push 189”, and “Push 190” for a successful push.
- Keep the existing successful deployment refresh notification separate from the push-status history.

## 2026-10-06

### Deployment status notifications
- Add a private in-app notification to your account only whenever a push/change is sent — including successful, failed, cancelled, or otherwise unsuccessful deployment attempts.
- The notification tells you the push/commit and its outcome so a failed or ineffective change is immediately identifiable.
- Keep the existing successful-deployment refresh signal separate from the new status notification.
- Fix the WebKit smoke check so the known mocked Supabase pin CORS diagnostic does not incorrectly fail an otherwise passing browser run.

## 2026-10-06

### Verified fix
- Keep a TV episode in the upcoming/current release timeline for 24 hours after its actual air timestamp even after TVMaze advances `nextEpisodeDate` to the following episode.
- Use the stored `scheduledEpisodeReleases` metadata as the post-air retention source, with regression coverage for both the upcoming card and current timeline.

## 2026-10-03

### Verified fixes
- Connected the existing root `apply_fixes.py` on `main` to the GitHub Pages deployment workflow.
- The fix script now targets the repository's current split source files rather than assuming all code is inside `index.html`.
- Allow pinch-to-zoom by removing the `user-scalable=no` viewport restriction.
- Preserve episode progress when release/episode metadata for the current season is unavailable instead of clamping progress to zero.
- Make `mergeLibraries` timestamp ties deterministic so the first/cloud record wins an equal-timestamp collision.
- Add `90dvh` to the editor modal height so Safari's dynamic toolbar does not clip the modal.
- The script is idempotent and verifies all four fixes on every deployment.

- 2026-10-06: Fixed Changelog push-status rendering so every result keeps exactly one actual push number with the correct status-specific wording: failed/cancelled pushes use `Failed push N` / `Cancelled push N`, while successful pushes use `Push N`.

- Move private status delivery to a dedicated `workflow_run: completed` observer so completed success, failure, and cancellation outcomes are covered even if the deployment job stops before its final step.
- Remove duplicate status delivery from the deployment workflow and fail visibly if the private notification secret is missing.

- Correct Changelog run labels to use the overall All workflows history position, not the individual workflow's run_number. Display only `Run N (short-commit)` before the change title.
