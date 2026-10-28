# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Desktop app built with web technology (React 19 + Vite + Tailwind 4, packaged with Electron). Windows installer today; macOS and Linux builds come from the same code. The design language is the app's own, not the native look of any OS.

## Users

Professionals in general — the professions covered by Orbi's library: graphic design, UX/product, developers, IT, journalism, audiovisual, motion, filmmaking, screenwriting, social media, marketing and education. They use Orbi at their desk during the working day to get real work done: write, research, plan, produce images, video and voice, automate steps and run tools.

Most are not AI specialists. They expect professional tools that explain themselves; power users (developers, IT, motion) also use the terminal, MCP tools, workflows and agents.

## Product Purpose

Orbi puts everything a professional needs from AI in one app: chat with web search, projects and memory; a Creative studio for images, video, voice and node workflows; a Creator Studio for skills, agents, multi-agent teams and harnesses; MCP tools; a native terminal; and a media library. Models run locally on the user's PC or in the cloud, chosen per task.

Success: a professional opens Orbi instead of juggling separate chat, image, video, voice, automation and terminal tools, and finishes the job inside it.

## Positioning

**Everything in one app.** Chat, images, video, voice, workflows, skills and agents, MCP tools and a terminal share one workspace, one media library, one set of agents and skills, and one model picker that mixes local and cloud models. Neighbors each cover one part (a chat, a node editor, a model runner, a terminal); Orbi's mechanism is that the parts feed each other — a chat answer becomes a workflow prompt, a render lands in the shared library, an agent uses the same skills and tools everywhere.

## Operating Context

- Desktop, long sessions, mouse and keyboard; resizable window from laptop to large monitor.
- Three themes the user switches at will: Light, Dark and Terminal.
- Languages: English default, with Português (Brasil), Español and Français.
- Work arrives as attachments (documents, images, spreadsheets, audio) and leaves as files, media in the library, boards, exported workflows, skills and agent bundles.
- Hardware ranges from laptops without a GPU to strong NVIDIA workstations; Orbi measures the PC and says what will run well, slow or not at all.
- Updates arrive from GitHub releases inside the app; versions follow `0.1.DD-N`.

## Capabilities and Constraints

- Chat: local (llama.cpp) and cloud providers, web search, attachments, projects, memory, temporary chat (not saved), slash commands (`/web`, `/image`, `/video`, `/skill-creator`, `/agents`, `/multi-agents`, `/harness`, …) and `@` mentions for agents and teams. The message box teaches commands (typewriter examples, command guide, Tab completion), picks the microphone and speaker, and switches Chat · Image · Video. Renders asked in chat run in the Creative queue and show in the chat.
- Media Library: full page with search, kind, origin and board filters, full-screen viewer, and follow-ups (make a video, upscale, edit, use prompt).
- Creative: Launchpad ideas, Canvas (prompt, negative prompt, magic wand, size, quality, seed, mask inpainting), Workflows (ComfyUI-style typed nodes, templates, ComfyUI import), Gallery with boards, full-screen viewer.
- Local engines: stable-diffusion.cpp (image and video), llama.cpp, whisper/sherpa-onnx (dictation, voices), optional Python voices. Each model shows license, size and fit for this PC.
- Creator Studio with the SKILLSMITH brain: create, test, audit, export and import skills, agents, teams and harnesses.
- MCP servers bundled (filesystem, memory, sequential thinking, Playwright) plus a catalog; risky tool calls ask first.
- Terminology in the UI: Skills, Agents, Multi-agents, Harness, Workflows, Boards, Media Library, Launchpad, Canvas, Gallery, Models.
- Constraint: features must degrade gracefully on PCs without a strong GPU (lighter models, honest warnings, never blocked silently).

## Brand Commitments

- Name: **Orbi** (platform name **OrbiX**). The Orbi mark is a solid core crossed by a tilted orbit with a satellite dot (`src/components/Logo.tsx`).
- Signature: **"Developed by Daniel Rodrigues · Draft Creative Studio Ltda — Creative Design & Software Development"** stays visible (About, installer, exported skills and bundles).
- Binding visual direction from the owner: **Adaptive Soft UI** with three variants — Orbi Dark (Premium Dark Soft UI), Orbi Light (Soft Neumorphic UI), Orbi Terminal (Cyberpunk Terminal UI). Details live in DESIGN.md.

## Evidence on Hand

- Real product, shipping as Windows releases on GitHub (`iwerry/chatorbit-app`), with release notes per version in `RELEASE_NOTES.md`.
- Built-in library of skills and agents per profession; two full skills by Daniel Rodrigues (`electron/skills-bundled/`) and SKILLSMITH (`iwerry/SKILLSMITH`).
- No customer testimonials, usage numbers, pricing or press exist yet — do not invent them.

## Product Principles

1. **One place, connected parts.** New features join the shared library, models, skills and agents instead of becoming isolated tools.
2. **Professional, not technical.** Explain in the user's words what a control does; hide engine details until they help.
3. **Honest about the machine.** Say what runs well, slowly or not at all on this PC, and why; never fail silently.
4. **The user stays in control.** Ask before risky actions, show licenses, keep everything exportable.
5. **Same product in every theme and language.** Themes and translations change the look and words, never the behavior or layout.

## Accessibility & Inclusion

- WCAG AA contrast for text in all three themes; UI text never below 11px and sentences never below 12px.
- Full keyboard use with visible focus; `prefers-reduced-motion` respected by every animation.
- Four interface languages; layouts must survive longer Portuguese, Spanish and French strings.
