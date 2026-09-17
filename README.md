# Airlock

Open source under the MIT license — see `LICENSE`. Fork it and point `config.js` at your own Supabase project.

Catch passing tasks, sort them later. Type a task with `#realm` hashtags and Important/Urgent
flags; it lands in an Eisenhower matrix (Do / Schedule / Delegate / Eliminate). Filter by realm,
drag cards between quadrants, click a card for notes and done. One codebase runs as a web app /
PWA (`airlock.neworbitdigital.com`) and as a Windows desktop app (Electron); everything syncs
through Supabase in real time. Multi-user: each account sees only its own tasks (Postgres RLS).

## Layout
- `site/` — the public website: landing page (`/`), `/privacy`, `/terms`, `/download`, screenshots in `site/img/`, root `sw.js` (self-unregisters the pre-/app/ worker), `_redirects`
- `index.html`, `renderer.js` — the app UI (shared by desktop and web; served at `/app/` on the web)
- `store.js` — auth + sync: Supabase is the source of truth, localStorage is the cache, offline writes queue and retry
- `config.js` — Supabase URL + publishable key (safe to ship; RLS scopes every row to the signed-in user), privacy URL
- `main.js`, `preload.js` — Electron shell only (window, launch-at-startup)
- `manifest.json`, `sw.js`, `icon.svg`, `icon.png`, `icon-180.png` — PWA bits
- `vendor/supabase.js` — supabase-js UMD build, vendored so both targets load the same file with no bundler
- `test/fake-supabase.js` — in-memory backend (auth, RLS, realtime emulation) used by `npm test`

## Sign-in
Web: "Continue with Google" or an emailed code. Desktop: same two options — Google opens in the system browser
(Google blocks OAuth inside embedded windows) and returns via the `airlock://auth?code=…` deep link, which the
main process forwards to the renderer for the PKCE code exchange. The installer registers the `airlock` protocol;
in dev (`npm start`) Electron registers it for the current session. Sessions persist per
device until "Sign out" in the ⋯ menu. Supabase Auth config lives in the dashboard (Google provider,
custom SMTP via Resend, redirect URLs) — see the project scope doc.

**Email template requirement:** the code flow needs the Supabase "Magic Link" email template to include
`{{ .Token }}` (the default template only has a link). Suggested body:
`<p>Your Airlock sign-in code is:</p><h2 style="letter-spacing:4px">{{ .Token }}</h2><p>It expires in 1 hour. If you didn't request it, ignore this email.</p>`

## Desktop
    npm install
    npm start                 # dev
    npm run dist              # dist/Airlock Setup x.y.z.exe (one-click installer; run from an Administrator PowerShell the first time)
    npm run release           # builds AND publishes a GitHub Release so installed apps auto-update (needs $env:GH_TOKEN)
"Launch at startup" and "Check for updates" live in the ⋯ menu.

### Auto-update (how installed desktop apps get new versions)
The app uses `electron-updater` against GitHub Releases on `New-Orbit-Digital/airlock`. On launch (+15 s) and every 4 h it
checks `latest.yml`, downloads silently, then shows a "Restart to update" bar; it also installs on quit. To ship a version:
1. bump `"version"` in package.json (auto-update only moves forward),
2. `$env:GH_TOKEN = "<GitHub personal access token with repo scope>"` (classic token, or fine-grained with Contents: read/write on this repo),
3. `npm run release` from an Administrator PowerShell → creates a draft-free release `vX.Y.Z` with the installer, `latest.yml` and blockmap.
Then `npm run publish:installer` to refresh the site's download link, and `npm run deploy` for the web/PWA (which updates itself on next open).
The app is unsigned; electron-updater tolerates that but Windows shows the SmartScreen prompt on first install only.

## Web / phone
    npm run deploy            # builds web/ (site/ + app at /app/) and deploys to Cloudflare Pages project "airlock" (airlock-ahd.pages.dev)
    npm run publish:installer # uploads dist/Airlock Setup x.y.z.exe to R2 and deploys the airlock-download worker (see file header for first-time setup)
Site: landing at `/`, app at `/app/`, legal at `/privacy/` and `/terms/`, install guide at `/download/`. The Windows installer
is too large for Pages, so `/download/Airlock-Setup.exe` is a `_redirects` rule to the R2-backed worker — fill in the worker URL
after the first `npm run publish:installer`.
Custom domain: Pages → airlock → Custom domains → airlock.neworbitdigital.com, plus a CNAME `airlock → airlock.pages.dev`
in Squarespace's DNS panel (the zone is Squarespace-managed, so Workers custom domains can't be used).
Android: Chrome/Firefox → Add to Home screen. iPhone: Safari → Share → Add to Home Screen. Mac: Safari → Add to Dock, or Chrome → Install.
Drag-and-drop is mouse-only; on the phone, move a card by opening it and flipping Important/Urgent.

## Account menu (⋯)
Signed-in email · Launch at startup (desktop) · Export my tasks (JSON) · Sign out · Delete my account (type DELETE) · Privacy · version.
Delete calls `public.delete_my_account()`; for the owner account (shared with the Inbox app) it deletes Airlock data but keeps the login.

## Data
Supabase project (Inbox) `qaabxgldjluqyccwhjzf`, table `public.matrix_tasks`, RLS owner-only, realtime enabled, replica identity full.
Guards: title ≤ 500 chars, notes ≤ 20k, ≤ 20 tags, ≤ 20,000 tasks per user (trigger). Migrations: `create_matrix_tasks`,
`airlock_multiuser_guards`, `airlock_delete_account_protect_owner`. The app never touches Inbox's own tables.

## Shortcuts
- Typing `#` opens a picker of active realms (on ≥1 open card); ↑↓ + Enter/Tab to pick
- `Enter` add · `Ctrl+I` Important · `Ctrl+U` Urgent · `/` focus capture · `Esc` in the dialog saves

## Verification log
- v0.1 (2026-09-15, headless xvfb): 4 tasks in expected quadrants, #home filter [0,1,0,1], dialog notes + done persisted, no console errors. PASS.
- v0.2 hashtag picker: `#w` → only #work; Enter → `#work `; `#p` (done-only realm) → "New realm #p". PASS.
- v0.3 sync/DnD (`SMOKE_FAKE=1 npm test`): create → [1,0,0,1]; drag Do→Schedule → [0,1,0,1]; notes + done → [0,0,0,1]; queue flushed; backend rows match; realtime insert from a second client arrived. PASS.
- v0.3 database (live SQL as `authenticated`): owner sees own row, `user_id` defaults to auth.uid(), a different uid sees/updates 0 rows; table in `supabase_realtime` publication. PASS.
- v0.3.1 PIN gate; v0.3.2 phone layout (panels grow, page scrolls, no overflow at 412px). PASS. Live PIN sign-in, sync and PWA install confirmed by Justin on PC + Android Firefox; NSIS installer built and installed.
- **v0.4.0 Airlock multi-user (2026-09-16, `SMOKE_FAKE=1 npm test`, fake backend emulating auth + RLS + realtime):** login shown; Google button hidden on desktop;
  email → code step; wrong code → "That code is wrong or has expired."; right code signs in; menu shows alice@example.com; first-run hint shown when empty and
  hidden after first add; reload keeps session; create/drag/dialog/sync/realtime all re-passed; export contains tasks; sign out → sign in as bob → bob sees 0 tasks;
  bob's rows scoped to bob; delete account removes only bob's rows and signs out; no console errors. PASS.
- **v0.4.0 database (live):** constraints `title_len`, `notes_len`, `tags_count` + 20k-row trigger applied; probe inserts with a 501-char title and 21 tags both
  rejected (`check_violation`), table unchanged. `delete_my_account()` created (owner-protected). Justin's 8 tasks moved from the PIN user to
  justin.a.bost@gmail.com (verified 8/0), PIN user deleted. PASS.
- v0.4.1 (2026-09-16): install banner + menu item via `beforeinstallprompt` (Android/desktop), one-time iOS Safari "Add to Home Screen" hint, manifest shortcut "New task". Smoke test re-run: PASS, no console errors. Live check of airlock-ahd.pages.dev from the Claude browser: all assets 200, service worker registered, sign-in screen renders; `POST /otp` for a test address returned 200 with no SMTP error (test user deleted afterwards).
- v0.5.0 (2026-09-16): public site added (landing/privacy/terms/download, screenshots generated from the app with sample data); app moved to `/app/` (manifest scope, root SW self-unregister, `_redirects`); email-code box accepts 6–10 digits with no auto-submit (Justin's live code was longer than 6); R2 download worker + publish script. Smoke test re-run: PASS, no console errors. Landing rendered at 1280px and reviewed.
- v0.5.1 (2026-09-16): desktop Google sign-in via system browser + `airlock://` deep link. Smoke test: Google button visible on desktop, click hands a Google URL to `shell.openExternal` (stubbed), a bad deep-link code is rejected, a good one signs in (`google-user@example.com`). PASS, no console errors.
- v0.5.2 (2026-09-16): landing copy revised ("Capture now. Decide later.", space-themed quadrant cards, merged sync/offline card, "In a browser", open-source callouts + LICENSE (MIT), support address justin@neworbitdigital.com); hero screenshot regenerated at 910px; **app bug fixed**: first-run hint was a grid item and squashed the quadrants — moved above the grid. Landing re-rendered at 1280px and reviewed.
- v0.6.0 (2026-09-16): theme toggle (dark/light, persisted, follows OS on first run), quiet theme-aware scrollbars, circle tick that draws a check and lets the card linger ~1.6 s before it leaves, "Show done" moved into the ⋯ menu, menu `hidden` bug fixed (desktop-only / web-only items were leaking through `display:flex`), Install item opens `/download/` where no native prompt exists, electron-updater wired to GitHub Releases with Restart-to-update bar and "Check for updates". Smoke test adds: tick lingers then completes, theme persists, menu hides web-only items on desktop. PASS, no console errors. Light theme rendered and reviewed.
- **Live (2026-09-16 ~20:00 ET):** https://airlock.neworbitdigital.com serves the landing page; `/app/`, `/privacy/`, `/terms/`, `/download/`, manifest and images all 200; `/download/Airlock-Setup.exe` 302s to the R2 worker. Root cause of the DNS delay: neworbitdigital.com's zone lives in the agency Cloudflare account (Squarespace's DNS panel was inert — "custom nameservers"); CNAME added there, set to DNS-only because the Pages project is in a different Cloudflare account (proxied gave Error 1014). GitHub release v0.6.0 published; desktop 0.6.0 installed; Google sign-in works on desktop and web (Justin).
- v0.6.1 (2026-09-17): `airlock-ping.wav` (Justin's) plays when a task is added and when one is marked done (tick or dialog; not on reopen), volume 0.6, preloaded; "Mute sounds" toggle in the ⋯ menu, persisted in `localStorage` (`airlock.mute`). Shipped in the installer (`build.files`), web (`/app/airlock-ping.wav`), SW cache (`airlock-shell-v8`), CSP `media-src 'self'`. Smoke test adds: two adds → two `play()` calls; muted tick → zero. PASS, no console errors.
- v0.6.1 release (2026-09-17): `npm run release` published v0.6.1 directly (no draft); installed 0.6.0 desktop app reported and applied the update (Justin). **Auto-update verified end to end.**
- v0.6.2 (2026-09-17, web-only fix): iPhone home-screen app — capture bar, menu, login overlay and status line now respect `env(safe-area-inset-*)` (the input was sliding under the status bar with `viewport-fit=cover` + `black-translucent`). SW cache `airlock-shell-v9`. Rendered at 390×844 with a simulated 47px inset and reviewed.
- Not yet verified: live Google sign-in on web, live email-code delivery via Resend, the Magic Link template edit, custom-domain deploy.
