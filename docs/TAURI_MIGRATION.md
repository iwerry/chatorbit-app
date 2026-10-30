# Tauri 2 / Rust migration

Status: **in progress; not a distributable replacement**. Work is isolated on `codex/tauri-rust`. The published Windows Electron build remains unchanged.

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
- Native window actions and frontend transport. Startup explicitly reports that local engines/system voices and signed native updates are unavailable in this preview.
- Preview packaging workflow produces Linux x64 DEB/AppImage and macOS Intel/Apple Silicon DMG artifacts. These are development packages, not a completed migration or a stable release; macOS uses ad-hoc signing.

## Required release gates

- Port every active Electron IPC command and confirm startup with real frontend data. Unsupported commands must fail explicitly; they must never report fake success.
- Port Supabase Auth, OS-protected token storage, refresh, streaming chat, tool calls, generation, polling and cancellation.
- Implement and test media import/export, safe local asset access, all CRUD operations, skills, agents, teams and harnesses.
- Port MCP transports, approvals and the native PTY terminal.
- Add non-destructive migration of existing databases and media, with a backup and transaction-based schema upgrades. Never overwrite an existing database.
- Implement native window/file dialogs and a Tauri-compatible updater. Electron ASAR updates are not valid Tauri updates.
- Complete unit/integration tests and Linux/macOS launch smoke tests, including concurrent tasks and cancellation.
- Only then enable stable AppImage/DEB and Intel/Apple Silicon macOS APP/DMG release publication. Preview artifacts are explicitly marked as incomplete development builds. macOS signing/notarization is a separate release credential setup; an ad-hoc development build must be labeled accordingly.

## Validation so far

Windows Rust compilation and 12 unit tests passed (storage, conversations, SSE fragmentation/errors, tool names/workspace restrictions, selected-skill access, skill validation, YAML roundtrip and ZIP traversal). TypeScript passes. Linux x64 and macOS Intel/Apple Silicon CI tests and production packaging passed in run [41078258226](https://github.com/iwerry/chatorbit-app/actions/runs/41078258226), code commit `4e95f68521f8093d3ce75d407140aa82dfaada5e`. Linux process launch passed a 12-second Xvfb smoke test with isolated data. Mac packages use ad-hoc signing and include the microphone usage description. Actual authenticated provider calls and interactive macOS launch have not been verified. Tests cover native modules, not full application parity.

Preview DEB/AppImage and both DMGs were downloaded to the parent workspace's `releases/tauri-0.1.30-preview`, their format signatures verified, and `SHA256SUMS.txt` generated. This local output is outside the Git repository. The public cloud health endpoint returned `ok: true`, `openrouter: true`, `payments: false`; no paid generation was performed.

No Node sidecar is part of the selected architecture. Do not describe a compiled shell or the browser fallback as a completed migration.

