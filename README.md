# Orbi

AI chat and creative studio by **OrbiX**: one app for chats, projects, agents, skills, MCP tools, a native terminal and an image/video canvas.

React 19 · Vite · Tailwind 4 · TypeScript, packaged with Electron. Local data lives in SQLite (sql.js/WASM).

> Status: **0.2.0**, a desktop preview for Windows. Linux and macOS builds come from the same code.

## What's in 0.2.0

- **Menu bar** next to the Orbi logo: File, Edit, Selection, View, Go, Terminal and Help, in VS Code style. Includes a command palette (`Ctrl+Shift+P`), find in chat (`Ctrl+F`), go to chat (`Ctrl+P`), multiple windows and keyboard shortcuts.
- **Native terminal** in a bottom panel (`Ctrl+\``):
  - Opens PowerShell on Windows, zsh on macOS and bash on Linux.
  - Supports tabs, resizing and maximizing.
  - Shell code blocks in answers get a **Run in terminal** button.
- **Agent Builder**:
  - Fields: name, description, model, category, instructions (with a full-screen editor), MCP tools and skills (Off/All/Selected), plus conversation starters and a support contact.
  - **Chat** with an agent in one click.
- **Skills**: create, edit, filter and turn on/off. Active skills shape every answer.
- **MCP & Plugins**: a new sidebar section.
  - **Pre-connected built-in tools**: Orbi Core (time, web pages, memory), Workspace Files (sandboxed to `Documents/Orbi`) and Terminal Commands (each command needs your approval).
  - **Pre-connected remote MCP servers that need no key**: DeepWiki (GitHub repo Q&A) and Context7 (library docs).
  - **Catalog**: Filesystem, Knowledge Graph Memory, Sequential Thinking, Playwright, GitHub and the MCP test server.
  - Add any MCP server by URL (HTTP/SSE) or command (stdio).
  - **Plugins**: Developer Kit, Research Kit and Creative Kit. Each bundles servers, skills and agents.
- **Tool calling in chat**: works with OpenAI-compatible APIs and Anthropic. Each tool call shows up in the answer, with its inputs and results.
- **Orbi Local**: tiny free models that run on your PC, offline.
  - Nothing is bundled. The engine (llama.cpp `b11800`, ~24 MB) and the model are downloaded only when you click.
  - SmolLM2 135M (≈105 MB, runs on almost any PC), SmolLM2 360M, Qwen2.5 0.5B. All Apache-2.0.
  - You can also paste any `.gguf` link from Hugging Face.

Also carried over from 0.1:
- Streaming chat with several models at once, Thinking mode and attachments.
- History, projects, pinned chats, bookmarks and memory.
- Creative canvas with image generation, and the Media Library.
- Light, dark and terminal themes. API keys are encrypted with the OS secure storage.

## Run in development

```bash
pnpm install
pnpm approve-builds          # allow electron to download its runtime
pnpm vite build && pnpm electron .
# live reload: `pnpm dev` in one terminal, then
#   Windows:  set ORBI_DEV_URL=http://localhost:5173 && pnpm electron .
#   macOS/Linux: ORBI_DEV_URL=http://localhost:5173 pnpm electron .
```

## Build installers

- **Windows, on Linux (no Wine needed):** `pnpm dist:win` produces `release/Orbi-Setup-<version>.exe`. This needs the Windows terminal module in `build/pty/win32-x64`: run `npm pack @lydell/node-pty-win32-x64@1.2.0-beta.18` and extract its `package/` folder there.
- **Windows, on Windows:** `pnpm vite build && pnpm electron-builder --win nsis`.
- **Linux:** `pnpm vite build && pnpm electron-builder --linux deb AppImage`.

## Project structure

```
electron/
  main.cjs        windows, IPC API, approvals, secure key storage, media
  preload.cjs     safe bridge exposed as window.orbi
  db.cjs          SQLite schema + migrations (chats, messages, projects, memories, agents, skills, media, workflows)
  providers.cjs   OpenRouter, OpenAI, Anthropic, Gemini, DeepSeek, Mistral, Ollama, LM Studio, custom, Orbi Local; tool-calling loop
  mcp.cjs         MCP hub: built-in tools, stdio/HTTP servers, catalog, plugins
  terminal.cjs    native shell sessions (node-pty)
  local-ai.cjs    downloads llama.cpp + GGUF models on demand and runs llama-server
src/
  App.tsx                     shell, chat, commands, menus, shortcuts
  components/TitleBar         menu bar, command palette, find bar
  components/TerminalPanel    xterm.js terminal with tabs
  components/WorkspacePanel   chats, projects, memory, bookmarks, media library
  components/panels/          Agent Builder, Skills, MCP & Plugins
  components/Creative         node canvas
  components/SettingsModal    providers, Orbi Local, profile
  lib/api.ts                  typed bridge (the web version will implement it over HTTP)
build/
  installer.nsi, win-finish.cjs   Windows installer without Wine
```

## Roadmap

### 0.3: next update
- **Creative**:
  - Video, audio and 3D nodes, both cloud (fal / Replicate / MuAPI) and local (stable-diffusion.cpp + Wan2.2 TI2V-5B).
  - Local image models (Z-Image Turbo, FLUX.2-klein) installed from Orbi Local.
  - Open-Generative-AI-style studios (Image, Video, Lip Sync, Cinema), ported into the Orbi layout.
- **First-run wizard**: detect GPU, VRAM, RAM and disk, then suggest model packs.
- **Voice**: whisper.cpp for the microphone button, Kokoro for read-aloud.
- **Scheduled chats**: run on the OrbiX cloud, so they work with the PC off.
- **MCP**: OAuth for remote servers, per-server approval rules, MCP resources and prompts.
- **Agents**: file context per agent (RAG), agent marketplace.
- **Terminal**: choose the shell (PowerShell 7, Command Prompt, Git Bash, WSL), split panes, "explain this error" from the terminal.
- **Packaging**: code-signed Windows installer, auto-update, `.deb`/AppImage for Linux.

### Later: OrbiX platform
- Web apps at `chat.orbix.com` and `creative.orbix.com`. They share the same React packages, with login, credits and Pix/card subscriptions.
- The desktop app keeps local models and local MCP. Cloud generations use the same account and credits.
- Moderation, abuse limits and an admin panel for costs and revenue.

## License

Apache-2.0. See [LICENSE](LICENSE). Third-party components:
- llama.cpp, xterm.js, node-pty, sql.js and the MCP SDK: MIT.
- Models: each under its own license (the bundled catalog is Apache-2.0).
