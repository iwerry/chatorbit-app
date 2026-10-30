# Local execution guide

Use the Terminal Commands tool so commands, live output, cancellation and exit status are visible in Orbi. Do not ask the user to execute opaque text or assume that a dependency check installs anything.

On Windows use PowerShell; on Linux use bash; on macOS use zsh. Request approval for each command. Check Node and npm with `node --version` and `npm --version`. Inspect project dependencies with `npm ls --depth=0` in the project folder; a nonzero exit can mean missing dependencies, so read the error. Do not run npm install until the user approves it. Prefer project-local npm packages, matching versions of `remotion` and `@remotion/cli`, and existing project scripts. Do not install Python, Skia Canvas or a system FFmpeg unless the chosen workflow actually needs them.

The Remotion CLI can check/download its required browser with `npx remotion browser ensure`; first verify the local CLI exists to avoid an implicit npx package install. Use `npx --no-install remotion compositions src/index.ts` to obtain real composition IDs, then the project's render script or CLI with that ID and an output path. Verify against the installed CLI's help if its syntax differs. Browser downloading is a separate network action requiring approval.

PowerShell and Unix file quoting differ. Keep each command specific to the actual platform. Use UTF-8 for generated files and inspect actual bytes before treating terminal mojibake as file corruption. Do not reuse a command for another OS by replacing slash characters blindly.

On Windows the task runner refreshes PATH from the user and machine settings for each command, so a newly installed executable can be found without restarting Orbi. If PowerShell blocks npm.ps1 or npx.ps1, use npm.cmd/npx.cmd after checking they exist; do not change the user's execution policy globally.

Use `ffmpeg -version` and `ffprobe -version` to check optional media tools. If used, validate real media metadata and the complete output file. Do not silently reduce a requested 1080×1920 output to 720×1280. If only a fallback renderer ran, report that renderer's name and explain the missing Remotion dependency.

The supplied InformativeVideo_Remotion_Project.zip was a reference demo: 1080×1920, 30 fps, 600 frames, with a separate Skia renderer. Its precomputed validation.json and included MP4 are not proof that a new project or the current machine was tested. Never execute an uploaded script automatically; read it first and obtain approval for execution.
