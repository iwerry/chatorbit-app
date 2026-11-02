# Tauri 2 / Rust migration

Status: **in progress; native packages remain transition previews**. Rust/Tauri source is being integrated alongside Electron in main so the frontend and publication can share the same revision. Windows stable continues to use Electron. Native updates use the official signed updater; owner signing configuration and one initial transition installation are required. See [automatic updates](AUTOMATIC_UPDATES.md).

## Implemented native modules (30 October)

- Native Tauri application and local-only capability configuration.
- Compatibility transport for the existing `window.orbi` frontend contract, including event unsubscribe behavior.
- Bundled native SQLite, WAL, parameter-bound queries, settings and independent workflow persistence.
- Native CRUD for conversations/messages, agents, skills, teams, harnesses, projects, boards and memories; schema column upgrades compatible with the Electron schema.
- Supabase authentication, confirmation/recovery, refresh rotation, billing/account routes and catalog requests; refresh tokens use Windows Credential Manager, macOS Keychain or Linux Secret Service. No plaintext secret fallback. Actual remote sign-in remains untested.
- Native storage tests and a Linux / Apple Silicon / Intel macOS CI check matrix.
- Rust SSE chat transport, fragmented Unicode decoding, tool-call rounds and per-window cancellation.
- Cloud image/audio/video requests, video polling, media storage and native file dialogs.
- Official Rust MCP client with stdio/HTTP transports, scoped approvals and workspace path restrictions; native PTY terminals.
- Bundled library/plugin catalog, Creator Studio validation and YAML/ZIP import/export.
- One-time Electron data import (`src-tauri/src/legacy.rs`, 2 November), before the native database opens. Source is Electron's `<config>/Orbi` folder, which is only read. The database is copied with the SQLite backup API and an integrity check, with a raw copy in `backups/electron-orbi-<ms>.db`. Media files are copied without overwriting existing names, and `media.file` is rewritten from the bare file name to the native absolute path. Settings that hold Electron safeStorage ciphertext or MCP profiles (`cloudRefresh`, `mcpServers`, `provider:*`) are dropped, so users sign in again. A native database that already has user data is never replaced (status `skipped`). An empty one is moved to `backups/orbi-empty-<ms>.db`. The result is recorded in `electron-migration.json`. Failures write no marker and retry on the next launch. Verified with 4 unit tests and an ignored test against a copy of a real Windows folder: 11 conversations, 97 messages, 34 media files, 2 workflows, 34 skills and 18 agents matched.
- Missing frontend events (2 November). `data:changed` is sent after `library:installKit`, `studio:importBundle`, `plugins:set`, `mcp:save`, `mcp:remove` and the `save_memory` tool. `find:result` is counted inside the page, because WebView2/WebKit have no found-in-page event; it follows Electron's `{ matches, active }` behavior, including wrap and backwards search. `update:done` is sent once after the `nativeVersion` setting changes, 1.5 s after UpdateCenter requests `update:state`. The counting script was checked in Node; the events were not observed in a running window.
- Frontend startup fix (2 November). The native preview had never rendered the interface. Vite places `src/lib/api.ts` in its own chunk, and that chunk runs before the entry module's body. So `bridge = window.orbi ?? fallback` read `window.orbi` before `tauriBridge.ts` defined it, the browser fallback returned `null`, and React crashed on a blank window. `api.ts` now imports `./tauriBridge` itself. The `<meta>` CSP in `index.html` also allows `ipc:`/`http://ipc.localhost` and `asset:`/`http://asset.localhost`; before, the fast IPC channel was blocked and migrated images could not load. Earlier "launch smoke tests" only checked that the process stayed alive.
- Isolated test runs. `ORBI_DATA_DIR=<folder>` uses its own database and media, and the credential store service `com.orbix.orbi.isolated`. The Electron import then reads only `ORBI_LEGACY_DIR`, never the real folder. WebView2 storage (localStorage) is still shared with the installed app. With `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`, the window can be inspected over CDP. Verified on Windows 2 November with a copy of real data: login screen rendered and Orbi Cloud online, migrated media loaded through the asset protocol, `find:result` (6 matches, forward/back), `data:changed` after `plugins:set`, and the "Orbi was updated to 0.2.2-1." card after a `nativeVersion` change. Signed-in screens were not checked; that needs the owner's sign-in.
- Native window actions and frontend transport. Startup explicitly reports that local engines/system voices and signed native updates are unavailable in this preview.
- Preview packaging workflow produces Linux x64 DEB/AppImage and macOS Intel/Apple Silicon DMG artifacts. These are development packages, not a completed migration or a stable release; macOS uses ad-hoc signing.

## Required release gates

- Port every active Electron IPC command and confirm startup with real frontend data. Unsupported commands must fail explicitly; they must never report fake success.
- Port Supabase Auth, OS-protected token storage, refresh, streaming chat, tool calls, generation, polling and cancellation.
- Implement and test media import/export, safe local asset access, all CRUD operations, skills, agents, teams and harnesses.
- Port MCP transports, approvals and the native PTY terminal.
- ~~Add non-destructive migration of existing databases and media, with a backup and transaction-based schema upgrades. Never overwrite an existing database.~~ Done in `legacy.rs`. Still open: the import is a one-time snapshot. Opening a Tauri preview before the final switch freezes that snapshot, so the Electron-to-Tauri installer must run before Electron data diverges, or the marker must be removed. The UI has not yet been opened on migrated data.
- Implement native window/file dialogs and a Tauri-compatible updater. Electron ASAR updates are not valid Tauri updates.
- Complete unit/integration tests and Linux/macOS launch smoke tests, including concurrent tasks and cancellation.
- Only then enable stable AppImage/DEB and Intel/Apple Silicon macOS APP/DMG release publication. Preview artifacts are explicitly marked as incomplete development builds. macOS signing/notarization is a separate release credential setup; an ad-hoc development build must be labeled accordingly.

## Validation so far

Windows Rust compilation and 12 unit tests passed (storage, conversations, SSE fragmentation/errors, tool names/workspace restrictions, selected-skill access, skill validation, YAML roundtrip and ZIP traversal). TypeScript passes. Linux x64 and macOS Intel/Apple Silicon CI tests and production packaging passed in run [41078258226](https://github.com/iwerry/chatorbit-app/actions/runs/41078258226), code commit `4e95f68521f8093d3ce75d407140aa82dfaada5e`. Linux process launch passed a 12-second Xvfb smoke test with isolated data. Mac packages use ad-hoc signing and include the microphone usage description. Actual authenticated provider calls and interactive macOS launch have not been verified. Tests cover native modules, not full application parity.

Preview DEB/AppImage and both DMGs were downloaded to the parent workspace's `releases/tauri-0.1.30-preview`, their format signatures verified, and `SHA256SUMS.txt` generated. This local output is outside the Git repository. The public cloud health endpoint returned `ok: true`, `openrouter: true`, `payments: false`; no paid generation was performed.

No Node sidecar is part of the selected architecture. Do not describe a compiled shell or the browser fallback as a completed migration.

