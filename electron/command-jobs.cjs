// Approved task commands. The interactive terminal remains available independently.
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const jobs = new Map()
function shellCommand(command, platform = process.platform) {
  if (platform === 'win32') {
    const script = "$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';' + $env:Path; $global:LASTEXITCODE = 0; & {\n" + command + "\n}; if (-not $?) { exit 1 }; exit $LASTEXITCODE"
    return ['powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]]
  }
  return [platform === 'darwin' ? '/bin/zsh' : '/bin/bash', ['-lc', command]]
}
function stop(id, origin, cancelled = true) {
  const job = jobs.get(id)
  if (!job || (origin && job.origin !== origin)) return false
  job.cancelled ||= cancelled
  if (process.platform === 'win32') spawn('taskkill.exe', ['/PID', String(job.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => job.child.kill()).on('exit', (code) => { if (code) job.child.kill() })
  else { try { process.kill(-job.child.pid, 'SIGKILL') } catch { job.child.kill('SIGKILL') } }
  return true
}
function run({ command, cwd, timeoutSeconds = 900 }, origin, signal) {
  if (typeof command !== 'string' || !command.trim() || command.length > 64000) throw new Error('Command must contain 1–64000 characters.')
  if (signal?.aborted) return Promise.reject(new Error('Stopped.'))
  const id = randomUUID()
  const [shell, args] = shellCommand(command)
  const send = (event) => { if (origin && !origin.isDestroyed()) origin.send('term:job', { id, ...event }) }
  return new Promise((resolve) => {
    const child = spawn(shell, args, { cwd, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TERM: 'dumb', NO_COLOR: '1', PYTHONIOENCODING: 'utf-8' } })
    const job = { child, origin, cancelled: false }
    jobs.set(id, job)
    send({ phase: 'start', shell, command, cwd })
    let stdout = '', stderr = '', timedOut = false, error = ''
    const consume = (stream, kind) => { stream.setEncoding('utf8'); stream.on('data', (text) => { if (kind === 'stdout') stdout = (stdout + text).slice(-64000); else stderr = (stderr + text).slice(-16000); send({ phase: 'data', stream: kind, text }) }) }
    consume(child.stdout, 'stdout'); consume(child.stderr, 'stderr')
    child.on('error', (e) => { error = e.message })
    const abort = () => stop(id, origin)
    const timer = setTimeout(() => { timedOut = true; stop(id, origin, false) }, Math.max(1, Math.min(1800, Number(timeoutSeconds) || 900)) * 1000)
    signal?.addEventListener('abort', abort, { once: true })
    child.on('close', (code) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort); jobs.delete(id)
      const result = { jobId: id, exit_code: code ?? 1, cancelled: job.cancelled, timedOut, stderr: (error ? `${stderr}\n${error}` : stderr).slice(-4000), stdout: stdout.slice(-10000), outputTruncated: stdout.length > 10000 || stderr.length > 4000 }
      if (result.cancelled || result.timedOut || result.exit_code !== 0) result.error = result.timedOut ? 'Command timed out.' : result.cancelled ? 'Stopped by the user.' : `Command exited with code ${result.exit_code}.`
      send({ phase: 'exit', code: result.exit_code, cancelled: result.cancelled, timedOut, error })
      resolve(result)
    })
  })
}
function close(origin) { for (const [id, job] of jobs) if (!origin || job.origin === origin) stop(id, origin) }
module.exports = { run, stop, close, shellCommand }
