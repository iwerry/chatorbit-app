# Where we stopped — Orbi 0.1.27-2

Versioning: `0.1.DD-N` (DD = day of the month, N = build of the day). Windows resources use `0.1.DD.N`.
The updater compares the release's publish date with this build's `electron/build-info.json`. That file is written by `build/stamp.cjs`, so the day-of-month scheme still works across months.

## Release flow (automatic updates)
1. Bump `package.json` → `pnpm dist:win` (stamps build-info, builds, makes `release/Orbi-Setup-<v>.exe`).
2. Push to `main`.
3. Create GitHub Release `v<version>` and attach the installer. Installed apps (0.1.27-2+) show the update card within ~15 s of starting, or every 4 h.
4. The installer runs silently (`/S`), closes Orbi, replaces the files and relaunches with `--updated`.

## Done in 0.1.27-2
- First-run setup wizard (`SetupWizard.tsx`): name, language and theme, then recommended models per kind. Downloads go to a queue in the main process (`local:enqueue`).
- New catalog (`electron/local-ai.cjs`):
  - Text: Gemma 3, Llama 3.2 1B, Qwen3 4B and 8B.
  - Image: SDXS 512, FLUX.2 klein 4B, and Z-Image Turbo for 4 GB GPUs.
  - Video: Wan 2.1 1.3B, now usable on 4 GB GPUs.
  - Fit tolerance of +0.6 GB RAM. Video is not recommended without a GPU.
  - The retired Tiny SD Turbo is cleaned up on start.
- Hugging Face search, open folder and delete all in the model hub.
- `NodeFlow.tsx` replaces the old non-working canvas:
  - Typed ports and drag-to-connect.
  - Execution with memoization, a media lock and per-node progress.
  - New IPC: `ai:complete` and `ai:speech`.
- Updater (`electron/updater.cjs`, `UpdateCenter.tsx`), with a silent install plus relaunch in `build/installer.nsi`.
- Theme persistence: stored in a setting and in localStorage, and the window background follows the theme.
- Local chat: 8k context, and history and web results trimmed to fit. llama.cpp auto-fits GPU layers (no `-ngl 99`).
- Friendly sd-cli errors.

## Verified here
- Typecheck and build pass.
- Screenshots: setup wizard, model hub, workflow run end to end with mock chat and image providers (LLM → image → board), wire drag, quick-add and type mismatch, update card, download and confirm via a mock release, theme kept after restart.
- Recommendation logic tested for 4 hardware profiles.

## Not testable here (needs the Windows PC)
- Real model downloads from Hugging Face (blocked in this sandbox). New repos and patterns come from stable-diffusion.cpp docs, but some file names are resolved at runtime: SDXS, FLUX.2 klein.
- Real sd-cli and llama runs on GPU, and a real silent install via the updater (first release that can update is the one after 0.1.27-2).

## Next ideas
- Workflow: upscale node, LoRA picker, image-edit (FLUX.2 klein `-r`) node, batch/variations, shareable workflow files.
- Model hub: per-model speed benchmark after install; disk usage view.
- Delta updates (UI-only patches without the full 110 MB installer).
