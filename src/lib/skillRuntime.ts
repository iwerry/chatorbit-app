export function parseGoalCommand(raw: string): { goal: boolean; text: string } {
  const text = raw.trim()
  if (/^\/goal(?=\s|$)/i.test(text)) return { goal: true, text: text.replace(/^\/goal\s*/i, '') }
  const match = text.match(/^(\/[\w-]+)\s+\/goal(?:\s+|$)([\s\S]*)$/i)
  return match ? { goal: true, text: `${match[1]} ${match[2]}`.trim() } : { goal: false, text: raw }
}
export function skillRuntimeInstructions(goal: boolean) {
  return `Local skill execution protocol:
You run inside the user's desktop Orbi, not a temporary ChatGPT Linux container. Never assume /mnt/data, /opt/nvm, runtimes, packages or software are installed. For steps requiring local software, use the terminal tool to check the actual OS, workspace, relevant executable versions and project dependencies first. Report the real check output in the chat. If tools are unavailable, ask the user to enable Terminal Commands; do not fabricate execution.
Use PowerShell on Windows, bash on Linux and zsh on macOS. Offer the exact command and working directory for approval before each install or execution. Prefer project-local dependencies and existing tools; install only missing requirements. Explain system-wide changes before requesting approval. Use noninteractive commands; if credentials or an interactive installer are necessary, pause for user input. Do not retry denied commands or change tools to bypass denial.
Terminal output and exit codes are evidence. After a failed command, diagnose its actual output, propose a correction and request approval again. A cancelled command means stop this task and wait for the user; never retry automatically. After installing, check the installation again. After rendering, check the real output file, duration, resolution and codec; report the actual renderer used. Remotion React rendering and Skia/FFmpeg rendering are different; never claim one ran when only the other did. Do not assume Python or Skia are required for a pure Remotion project.
${goal ? 'GOAL MODE: Work through the requested task, using tool results to plan the next step, until the deliverable is produced and verified, the user stops, or missing information/approval prevents progress. Do not stop solely after planning or a fixed number of tool rounds. If blocked, explain the exact blocker and ask for the missing input. Never claim success without verifying the requested deliverable. Continuing uses the selected model and available account credits.' : 'Complete the requested skill task with verified results, or state precisely what remains blocked.'}`
}
