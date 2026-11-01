# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Desktop app built with web technology (React 19 + Vite + Tailwind 4). Windows stable currently uses Electron; the native Rust/Tauri backend coexists in the repository for Linux/macOS transition builds. Both use the same frontend. Signed native updates require publisher-key setup and one transition installation from older previews. The design language is the app's own, not the native look of any OS.

## Users

Professionals in general — the professions covered by Orbi's library: graphic design, UX/product, developers, IT, journalism, audiovisual, motion, filmmaking, screenwriting, social media, marketing and education. They use Orbi at their desk during the working day to get real work done: write, research, plan, produce images, video and voice, automate steps and run tools.

Most are not AI specialists. They expect professional tools that explain themselves; power users (developers, IT, motion) also use the terminal, MCP tools, workflows and agents.

## Product Purpose

Orbi puts everything a professional needs from AI in one app: chat with web search, projects and memory; a Creative studio for images, video and node workflows; an Audio studio for voiceover, music and sound effects; a Creator Studio for skills, agents, multi-agent teams and harnesses; MCP tools; a native terminal; and a media library.

All AI runs on **Orbi Cloud**: the user signs in with an Orbi account and pays with credits (subscription plus extra credit packs). Behind it, every model comes from OpenRouter through Orbi's own server (Supabase); the user never brings an API key and nothing runs on a local AI engine.

Success: a professional opens Orbi instead of juggling separate chat, image, video, voice, automation and terminal tools, and finishes the job inside it.

## Positioning

**Everything in one app, one account.** Chat, images, video, audio, workflows, skills and agents, MCP tools and a terminal share one workspace, one media library, one set of agents and skills, one credit balance and one model picker with the market's best models (ChatGPT, Claude, Gemini, DeepSeek, Kimi, Nano Banana, Veo, Kling, Seedance, ElevenLabs, Lyria…). Neighbors each cover one part (a chat, a node editor, a model runner, a terminal); Orbi's mechanism is that the parts feed each other — a chat answer becomes a workflow prompt, a render lands in the shared library, an agent uses the same skills and tools everywhere.

## Operating Context

- Desktop, long sessions, mouse and keyboard; resizable window from laptop to large monitor.
- Three themes the user switches at will: Light, Dark and Terminal.
- Languages: English default, with Português (Brasil), Español and Français.
- Work arrives as attachments (documents, images, spreadsheets, audio) and leaves as files, media in the library, boards, exported workflows, skills and agent bundles.
- Any PC works: generation happens in the cloud. Microphones and speakers vary (laptop mic, USB audio interface, headset or none); the user picks input and output devices, and Orbi keeps working without a microphone.
- Updates arrive from GitHub releases inside the app; versions follow `0.1.DD-N`. When a release only changes the interface, Orbi applies it without restarting; app updates use the installer. The user always decides when.

## Capabilities and Constraints

- Account: Orbi Cloud sign-in (e-mail and password, confirmation and password reset by e-mail code), plans and credit packs (Stripe, still being set up), credits shown everywhere; admins (by e-mail on the server) give credits and see totals.
- Models and prices: every list (text, image, video, voice, dictation, music) groups models by company, puts Popular first, tags Top / Fast / Cheap, and shows the price — OpenRouter US$ for admins, credits for everyone else. Each image and video model offers only its own aspect ratios, resolutions and durations. The cost is shown before a run and the amount spent after it.
- Chat: Orbi Cloud models, web search, attachments, projects, memory, temporary chat (not saved), slash commands (`/web`, `/image`, `/video`, `/skill-creator`, `/agents`, `/multi-agents`, `/harness`, …) and `@` mentions for agents and teams. The message box teaches commands (typewriter examples, command guide, Tab completion), picks the microphone and speaker, and switches Chat · Image · Video. Renders asked in chat run in the Creative queue and show in the chat.
- Media Library: full page with search, kind, origin and board filters, full-screen viewer, and follow-ups (make a video, upscale, edit, use prompt).
- Creative: Launchpad ideas (each opens with a named model and shows its cost; covers ship with the app), Canvas (prompt, negative prompt, Improve and Random, aspect ratio, resolution, duration, sound), Workflows (ComfyUI-style typed nodes, templates set to the best models, ComfyUI import), Gallery with boards, full-screen viewer.
- Audio: voiceover (text to speech with each model's voices), music (Lyria clips or full songs, instrumental or with lyrics) and sound effects; results go to the Media Library.
- Voice in chat: dictation and read-aloud through Orbi Cloud models only (no downloaded or operating-system voices).
- Creator Studio with the SKILLSMITH brain: create, test, audit, export and import skills, agents, teams and harnesses.
- MCP servers bundled (filesystem, memory, sequential thinking, Playwright) plus a catalog; risky tool calls ask first.
- Terminology in the UI: Skills, Agents, Multi-agents, Harness, Workflows, Boards, Media Library, Launchpad, Canvas, Gallery, Audio, Credits.
- Constraints: provider keys never live in the app or the public repository (only in Orbi's server secrets); when the AI balance or a model fails, the message says so plainly. Undecided: final plan prices, Stripe live mode, Google sign-in, own e-mail sender, the website and the mobile app (same account and server), and the move from Electron to Tauri.

## Brand Commitments

- Name: **Orbi** (platform name **OrbiX**). The Orbi mark is a solid core crossed by a tilted orbit with a satellite dot (`src/components/Logo.tsx`).
- Signature: **"Developed by Daniel Rodrigues · Draft Creative Studio Ltda — Creative Design & Software Development"** stays visible (About, installer, exported skills and bundles).
- Binding visual direction from the owner: **Adaptive Soft UI** with three variants — Orbi Dark (Premium Dark Soft UI), Orbi Light (Soft Neumorphic UI), Orbi Terminal (Cyberpunk Terminal UI). Details live in DESIGN.md.

## Evidence on Hand

- Real product, shipping as Windows releases on GitHub (`iwerry/chatorbit-app`), with release notes per version in `RELEASE_NOTES.md`.
- Built-in library of skills and agents per profession; two full skills by Daniel Rodrigues (`electron/skills-bundled/`) and SKILLSMITH (`iwerry/SKILLSMITH`).
- Plan prices in the app (Pro US$ 19, Studio US$ 49, packs US$ 6 and US$ 22) are starting hypotheses, not decided prices.
- No customer testimonials, usage numbers or press exist yet — do not invent them.

## Product Principles

1. **One place, connected parts.** New features join the shared library, models, skills and agents instead of becoming isolated tools.
2. **Professional, not technical.** Explain in the user's words what a control does; hide engine details until they help.
3. **Honest about cost and limits.** Show what a run will cost before it starts and what it cost after; say plainly when a model, the balance or the connection fails; never fail silently.
4. **The user stays in control.** Ask before risky actions and before installing updates, keep everything exportable.
5. **Same product in every theme and language.** Themes and translations change the look and words, never the behavior or layout.

## Accessibility & Inclusion

- WCAG AA contrast for text in all three themes; UI text never below 11px and sentences never below 12px.
- Full keyboard use with visible focus; `prefers-reduced-motion` respected by every animation.
- Four interface languages; layouts must survive longer Portuguese, Spanish and French strings.

## Confirmed workflow refinements — 29 October 2026

Daniel requested a focused refinement of the existing Adaptive Soft UI: readable spacing, one model-menu pattern, viewport-aware popovers, prompts that grow with their content, and compact Boards with full-screen viewing, library, download and delete actions. Contextual suggestions cover video, image and audio and respect reduced motion. Model prices use the refreshed catalog; speed suggestions must not imply measured live latency.

Workflow tabs preserve separate graphs and running work. Chat, Canvas and Workflows must remain usable while other tasks run. Windows is the current test platform. Releases use GitHub Actions and the existing 0.1.DD-N version convention.
