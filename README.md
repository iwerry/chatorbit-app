# Orbi

AI chat and creative studio by **OrbiX**: one app for chats, projects, agents, skills, MCP tools, a native terminal, an image/video canvas, node workflows and an audio studio.

Desktop app built with **Tauri 2** (Rust) and **React 19 · Vite · Tailwind 4 · TypeScript**. All AI runs on **Orbi Cloud** (models from OpenRouter, billed in Orbi credits). Nothing runs on the user's machine except the app itself.

> **Draft Creative Studio Ltda** — Creative Design & Software Development. Developed by Daniel Rodrigues.
> What changed in each version: [RELEASE_NOTES.md](RELEASE_NOTES.md). Where the work stands: [continue.md](continue.md).

## Versions

`0.M.D-N`: M = months since October, D = day of the month (no leading zero), N = build of that day. `package.json` holds the version; `node build/prepare-native.cjs` copies it to `src-tauri/Cargo.toml`, `Cargo.lock` and `tauri.conf.json`.

## Run in development

```bash
pnpm install
pnpm dev                                   # front end only, in the browser
pnpm dlx @tauri-apps/cli@2 dev             # the desktop app
```

Release build of the app on this machine:

```bash
pnpm build
cargo build --release --manifest-path src-tauri/Cargo.toml --locked --features tauri/custom-protocol
```

## Releasing

Every push to `main` that touches the app runs `.github/workflows/native-release.yml`:

- Builds and signs Windows (NSIS), macOS (Apple Silicon and Intel) and Linux (deb, AppImage).
- Updates the signed update channel (`native-channel` → `latest.json`), which installed apps check.
- Publishes the stable GitHub release `v<version>` with `Orbi-Setup-<version>.exe`. Older Electron installs look for that name, so they move to this app; the installer hooks remove Electron and the app imports `%APPDATA%\Orbi` on first launch (`src-tauri/src/legacy.rs`).

Signing: the secret `TAURI_SIGNING_PRIVATE_KEY` and the variable `TAURI_UPDATER_PUBLIC_KEY`, set with `build/configure-native-updates.ps1`. Keep a private backup of the key; without it installed apps stop receiving updates. Use `[skip ci]` for commits that change only documentation.

## Project structure

```
src/                     React front end (the same UI on every platform)
  App.tsx                shell, chat, commands, menus, shortcuts
  components/            CreativeStudio, NodeFlow, AudioStudio, MediaLibrary, SettingsModal, panels…
  lib/api.ts             typed API the UI calls; lib/tauriBridge.ts sends it to Rust
  lib/i18n-dicts.ts      translations (en, pt-BR, es, fr)
src-tauri/               Rust backend (Tauri 2)
  src/                   storage (SQLite), cloud, chat streaming, media, MCP, terminal, updater, legacy import
  resources/             bundled skill library, plugins, MCP catalog
  windows/hooks.nsh      installer hooks for the move from Electron
supabase/                Orbi Cloud: Edge Function `orbi` and migrations
build/                   version sync, update manifest, skill sync, signing setup
tests/                   node tests for the front end and the update manifest
```

### Skill library

`node build/sync-skills.cjs <folder with the repos cloned as owner_name>` reads `build/skill-sources.json`, scores each skill, writes `src-tauri/resources/library-github.json` and `THIRD_PARTY_SKILLS.md`, and merges the skills and agents into `src-tauri/resources/library.json`, which the app bundles.

## License

Apache-2.0. See [LICENSE](LICENSE). Bundled third-party skills keep their own licenses and notices in `src-tauri/resources/THIRD_PARTY_SKILLS.md`.
