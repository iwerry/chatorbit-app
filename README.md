# Orbi

AI chat and creative studio by **OrbiX**: one app for chats, projects, agents, skills, MCP tools, a native terminal and an image/video canvas.

React 19 · Vite · Tailwind 4 · TypeScript, packaged with Electron. Local data lives in SQLite (sql.js/WASM).

> Status: **0.1.27-2**, a desktop preview for Windows. Linux and macOS builds come from the same code.
> Versions follow `0.1.DD-N`: DD is the day of the month, N is the build of that day.
>
> Developed by **Daniel Rodrigues**.

## What's in 0.1.27-2

- **Setup assistant on first launch**: name, language and theme first. Then Orbi reads the hardware and pre-selects the strongest local models that run well on this PC for chat, images, video and voice. Downloads are queued and keep running in the background. You can reopen it from Help → Setup Assistant or Settings → Local models.
- **Stronger catalog, matched to each machine**:
  - Text: Gemma 3 (1B/4B/12B), Llama 3.2 1B, Qwen3 4B Instruct and Qwen3 8B.
  - Images: SDXS 512 (instant, CPU), Z-Image Turbo and FLUX.2 klein 4B (both run on 4 GB GPUs), and FLUX.1 schnell.
  - Video: Wan 2.1 1.3B, now usable on 4 GB GPUs; Wan 2.2 5B for 6 GB+.
  - The compatibility check now allows for Windows reporting 12 GB as 11.7 GB.
- **Search Hugging Face** from the model hub: any GGUF chat model, or single-file SD 1.5/SDXL checkpoints. Each file is marked if it is too big for this PC, but you can still install it.
- **Models folder tools**: Open models folder and Delete all models.
- **Workflows that run** (ComfyUI-style):
  - Typed, colour-coded ports. Drag a wire from an output to an input.
  - Nodes: Prompt, Text AI, Generate image (local or cloud, with optional start image), Generate video (optional first frame), Load image, Voiceover, Save to board and Note.
  - Run one node or the whole graph. Results are cached, and live wires and progress show on the nodes.
  - Four templates.
- **Updates from GitHub**: Orbi checks the latest release and offers it. You choose when to download. Before installing, it lists what will be paused, then installs silently and reopens on its own. No machine restart is needed.
- **Theme is remembered**: the last choice (Light, Dark or Terminal) is applied from the first frame.
- **Fixes**:
  - Local chat no longer overflows the context window when web search is on (8k context, trimmed history).
  - llama.cpp now fits GPU layers on its own.
  - The broken Tiny SD Turbo model was replaced.
  - Image-engine errors are now readable.

## What was in 0.1.27-1

- **Hardware detection**: RAM, CPU, GPU, VRAM and free disk (NVIDIA via `nvidia-smi`, Windows registry for AMD/Intel, sysfs on Linux, unified memory on Apple Silicon).
- **Model hub** (Settings → Local models), with Light / Medium / Heavy tiers for text, image, video and voice input:
  - Each model shows whether it fits this PC (runs well, slow, or won't fit, and why). Models that don't fit stay listed, with **Install anyway**.
  - Engines are downloaded with the first model of each kind: llama.cpp b11800, stable-diffusion.cpp and whisper.cpp. GPU builds (Vulkan) are used when there is a GPU with 2 GB+ VRAM.
  - Text: SmolLM2 135M/360M, Qwen2.5 0.5B/1.5B/7B, Llama 3.2 3B. Image: Tiny SD Turbo, Z-Image Turbo, FLUX.1 schnell. Video: Wan 2.1 1.3B, Wan 2.2 5B. Voice input: Whisper tiny/base/small/turbo.
- **Creative studio**, organized like InvokeAI but with Orbi's own look:
  - **Launchpad**: generate an image or video, edit an image, or build a workflow. Also shows engine status and detects a running InvokeAI.
  - **Canvas**: prompt and negative prompt, model, aspect presets, width/height, seed, steps, frames and count. Inpainting uses a mask brush and image-to-image strength, with live progress and cancel.
  - **Workflows**: the node canvas.
  - **Gallery**, with **Boards** and **Layers**.
  - Generation runs on local models (stable-diffusion.cpp) or cloud image models.
- **Microphone**: on first use, you choose between a local Whisper model (picked for your PC) and an API (OpenAI or Groq). Answers have a **read aloud** button that uses the system voices.
- **Web search for any model**: the globe button (or `/web`) searches DuckDuckGo with a Wikipedia fallback and reads the top pages. The results are given to the model, and the answer shows source cards. Tool-calling models also get a `web_search` tool.
- **Explore**: a library of 80 skills, 80 agents and 8 toolkits. It covers Graphic Design, UX/Product, Developers, IT, Journalism, Audiovisual, Marketing and Education. On first run, two lightweight (prompt-only) skills and one agent per profession come pre-installed.
- **Composer**: type `/` for skills and commands (`/web`, `/image`, `/terminal`, `/clear`), or `@` to mention agents.
- **Languages**: English by default. Português (Brasil), Español and Français are in Settings → General.
- **Design pass**:
  - Calmer focus ring.
  - Theme-aware selection, caret, scrollbars and focus outlines.
  - Tabular numbers.
  - 150–250 ms motion with `prefers-reduced-motion` support.
  - A satellite dot on the active rail item.
- **Lighter startup**: the studio, explore, settings and terminal load on demand (main bundle 842 KB → 503 KB).
- **About**: signed "Developed by Daniel Rodrigues".

### What 0.2.0 added (kept)

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

## Where local models live

- **Windows**: `%APPDATA%\Orbi\local-ai\`. Models are in `models\` and engines in `engine\`. Your chats and media are in `%APPDATA%\Orbi\`.
- **Linux**: `~/.config/Orbi/local-ai/`.
- **macOS**: `~/Library/Application Support/Orbi/local-ai/`.

Settings → Local models has **Open models folder** and **Delete all models**.

## Releasing an update

1. Bump `version` in `package.json` (`0.1.DD-N`).
2. Run `pnpm dist:win`.
3. Publish a GitHub Release tagged `v<version>` with `release/Orbi-Setup-<version>.exe` attached.

Installed apps find the release automatically.

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
  updater.cjs     update check, download and silent install from GitHub Releases
  local-ai.cjs    model hub: llama.cpp, stable-diffusion.cpp and whisper.cpp engines + catalog, downloads, generation
  hardware.cjs    RAM/CPU/GPU/VRAM/disk detection
  websearch.cjs   keyless web search (DuckDuckGo, Wikipedia fallback) and page reading
  library.cjs     profession library: skills, agents and toolkits
src/
  App.tsx                     shell, chat, commands, menus, shortcuts
  components/TitleBar         menu bar, command palette, find bar
  components/TerminalPanel    xterm.js terminal with tabs
  components/WorkspacePanel   chats, projects, memory, bookmarks, media library
  components/panels/          Agent Builder, Skills, MCP & Plugins
  components/CreativeStudio   Launchpad, Canvas (inpainting), Workflows, Gallery, Boards, Layers
  components/NodeFlow         node workflows (typed ports, execution)
  components/SetupWizard      first-run setup and model recommendations
  components/UpdateCenter     update card, notes and install confirmation
  components/Explore          profession library
  components/ModelHub         hardware card + Light/Medium/Heavy models
  components/SettingsModal    general/language, providers, local models, voice, about
  lib/i18n.ts, i18n-dicts.ts  translations (en, pt-BR, es, fr)
  lib/api.ts                  typed bridge (the web version will implement it over HTTP)
build/
  installer.nsi, win-finish.cjs   Windows installer without Wine
```

## Roadmap

### Next
- **Creative**: canvas layers you can move and scale, regional prompts, upscaling, control images, and video/audio nodes in Workflows.
- **Voice**: natural local read-aloud (Kokoro / OuteTTS), and local whisper on macOS and Linux.
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
