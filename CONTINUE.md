# Where we stopped — Orbi 0.1.27-1

Versioning: `0.1.DD-N` (DD = day of the month, N = build of the day). Windows version resources use `0.1.DD.N`.

## Done in 0.1.27-1
- Hardware detection (`electron/hardware.cjs`), with a Light/Medium/Heavy model hub for text, image, video and voice input (`electron/local-ai.cjs`, `src/components/ModelHub.tsx`). Incompatible models are marked, but **Install anyway** still works.
- Creative studio in the InvokeAI organization (`src/components/CreativeStudio.tsx`): Launchpad, Canvas with inpaint mask, Workflows (embedded node canvas), Gallery, Boards and Layers.
- Microphone setup on first click: local Whisper or an API (OpenAI/Groq). Recording uses `src/lib/voice.ts`, which produces a 16 kHz WAV. Read-aloud uses system voices.
- Web search for any model: the globe toggle or `/web`. Answers show source cards. Tool-calling models also get a `web_search` built-in tool.
- Explore (`src/components/Explore.tsx`, `electron/library.cjs`): 8 professions with 80 skills, 80 agents and 8 kits. On first run, 2 skills and 1 agent per profession are seeded.
- Composer `/` and `@` autocomplete.
- i18n: English by default, plus pt-BR, es and fr (`src/lib/i18n-dicts.ts`, about 520 strings).
- designerx pass (`src/studio.css`). Lazy loading for the studio, explore, settings and terminal.
- About page signed "Developed by Daniel Rodrigues". Copyright is in the exe and installer.

## Verified here
- `tsc --noEmit` and `vite build` pass.
- Screenshots: home, slash and @ menus, studio canvas (cloud generation through the mock provider), launchpad (dark theme), workflows, explore, and settings in Portuguese.
- The installer builds as `release/Orbi-Setup-0.1.27-1.exe`.

## Not testable in this sandbox (needs a real Windows PC)
- Hugging Face model downloads and real sd-cli and whisper-cli runs. The hosts are blocked here; file resolution and engine URLs were tested earlier.
- Live DuckDuckGo and Wikipedia results. Only the parser was unit-tested on fixtures.
- The microphone. Electron grants the media permission by default.

## Next ideas
- Movable/scalable canvas layers, upscaling, control images, regional prompts.
- Kokoro/OuteTTS local voices; whisper on macOS/Linux.
- Translate library skill/agent descriptions; more languages.
- Code signing and auto-update.
