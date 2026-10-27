// Native terminal sessions: PowerShell on Windows, the login shell on macOS (zsh), bash on Linux.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

let pty = null
let loadError = null

function loadPty() {
  if (pty || loadError) return pty
  const key = `${process.platform}-${process.arch}`
  const candidates = [
    // Packaged app: native module shipped unpacked under resources/pty/<platform-arch>
    process.resourcesPath && path.join(process.resourcesPath, 'pty', key, 'lib', 'index.js'),
    path.join(__dirname, '..', 'build', 'pty', key, 'lib', 'index.js'),
  ].filter(Boolean)
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        pty = require(c)
        return pty
      } catch (e) {
        loadError = e
      }
    }
  }
  try {
    pty = require('@lydell/node-pty')
  } catch (e) {
    loadError = e
  }
  return pty
}

function defaultShell() {
  if (process.platform === 'win32') {
    const sys = process.env.SystemRoot || 'C:\\Windows'
    const ps = path.join(sys, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    return { file: fs.existsSync(ps) ? ps : 'powershell.exe', args: ['-NoLogo'], name: 'powershell' }
  }
  if (process.platform === 'darwin') {
    const sh = process.env.SHELL || '/bin/zsh'
    return { file: sh, args: ['-l'], name: path.basename(sh) }
  }
  const bash = fs.existsSync('/bin/bash') ? '/bin/bash' : process.env.SHELL || '/bin/sh'
  return { file: bash, args: ['-l'], name: path.basename(bash) }
}

const sessions = new Map()

function create({ id, cols = 100, rows = 24, cwd }, send) {
  const lib = loadPty()
  if (!lib) throw new Error(`Terminal unavailable: ${loadError?.message || 'node-pty not found'}`)
  const shell = defaultShell()
  const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir()
  const proc = lib.spawn(shell.file, shell.args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: dir,
    env: { ...process.env, TERM_PROGRAM: 'Orbi', COLORTERM: 'truecolor' },
    useConpty: process.platform === 'win32' ? true : undefined,
  })
  proc.onData((data) => send('term:data', id, data))
  proc.onExit(({ exitCode }) => {
    sessions.delete(id)
    send('term:exit', id, exitCode)
  })
  sessions.set(id, proc)
  return { pid: proc.pid, shell: shell.name, cwd: dir }
}

function write(id, data) {
  sessions.get(id)?.write(data)
}
function resize(id, cols, rows) {
  try {
    sessions.get(id)?.resize(Math.max(2, cols), Math.max(2, rows))
  } catch {
    /* process already gone */
  }
}
function kill(id) {
  const p = sessions.get(id)
  sessions.delete(id)
  try {
    p?.kill()
  } catch {
    /* ignore */
  }
}
function killAll() {
  for (const id of [...sessions.keys()]) kill(id)
}
function info() {
  const s = defaultShell()
  return { shell: s.name, platform: process.platform, available: !!loadPty(), error: loadError ? String(loadError.message) : null }
}

function list() {
  return [...sessions.keys()]
}

module.exports = { create, write, resize, kill, killAll, info, list }
