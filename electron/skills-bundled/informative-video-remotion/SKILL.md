---
name: informative-video-remotion
description: Use when creating an informative or explanatory video from a brief with React and Remotion, with local dependency checks, approved installation, rendering and verification. Not for editing a supplied video frame by frame or claiming an unexecuted render succeeded.
license: MIT
metadata:
  author: Daniel Rodrigues
  version: 1.0.0
---

# Informative video with local execution

Read `references/local-execution.md` before proposing commands. Work in the user's Orbi workspace. The execution environment is their computer, not a ChatGPT container. Never assume a dependency is installed or use `/mnt/data` or `/opt/nvm` paths.

1. Confirm the audience, brief, language, aspect ratio, duration and desired deliverable. With `/goal`, continue from checks through verified export; if essential information is missing, ask for it.
2. Use the approved terminal tool to inspect the real OS, current directory, Node/npm versions and the project's package.json/dependencies. Check FFmpeg/ffprobe only when required for the selected path. A React-only Remotion render does not automatically require Python or Skia.
3. Report installed and missing tools from actual command results. Propose commands to install only missing dependencies locally in the project. Explain any system-wide installation. Every command requires approval. A denied action is a blocker, not permission to try another way.
4. Create a scene plan with contiguous frame ranges. Use deterministic React/Remotion animation, accessible typography and safe areas. Do not change names or text because of a console encoding artifact; inspect the actual UTF-8 file bytes first.
5. Check matching Remotion package versions and install/check the browser required by the CLI, with approval. Validate TypeScript and enumerate compositions before rendering the selected composition ID. Wait for the real command to finish and inspect its exit code.
6. Render the requested output, then verify that it exists and is nonempty. Inspect its duration, dimensions, codec and audio using available verification tools. If browser compatibility is required, prefer H.264/yuv420p, AAC and faststart while preserving the requested dimensions unless the user approves a resize.
7. If a command fails, use its real stdout/stderr to diagnose and request approval for a corrected command. Do not invent logs, claim background progress without a running process, or install everything indiscriminately. If network access fails, report it; ask before switching rendering engines.
8. Return the output path and verification evidence. A Skia Canvas + FFmpeg fallback is a separate renderer and must be labeled accurately. A source project or a successful typecheck is not a rendered video.

Example: `/informative-video-remotion /goal Crie um vídeo vertical de 30 segundos sobre a história do café.` First inspect the user's environment, then produce and verify the video, pausing for approvals and missing information.
