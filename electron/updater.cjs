// Updates from GitHub Releases (github.com/iwerry/chatorbit-app).
// The app checks the latest release, tells the user, downloads the installer only when asked,
// and installs it silently after the user confirms. The installer relaunches Orbi when done.
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const REPO = 'iwerry/chatorbit-app'
const API = process.env.ORBI_UPDATE_API || `https://api.github.com/repos/${REPO}/releases/latest`

let app = null
let send = () => {}
let state = { status: 'idle', current: '', latest: null, progress: null, error: null, file: null }
let controller = null
let timer = null

function buildInfo() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'build-info.json'), 'utf8'))
  } catch {
    return { version: app.getVersion(), builtAt: null }
  }
}

function set(patch) {
  state = { ...state, ...patch }
  send('update:state', state)
  return state
}

// Versions follow 0.1.DD-N (day of month), which does not sort across months,
// so a release is "newer" when its tag differs and it was published after this build.
function isNewer(release, info) {
  const tag = String(release.tag_name || '').replace(/^v/, '')
  if (!tag || tag === info.version) return false
  if (info.builtAt && release.published_at) return new Date(release.published_at).getTime() > new Date(info.builtAt).getTime() + 60_000
  return true
}

async function check({ manual = false } = {}) {
  if (state.status === 'downloading' || state.status === 'installing') return state
  const info = buildInfo()
  set({ status: 'checking', current: info.version, error: null })
  try {
    const res = await fetch(API, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Orbi-Updater' } })
    if (res.status === 404) return set({ status: 'current', latest: null })
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    const rel = await res.json()
    const asset = (rel.assets || []).find((a) => /^Orbi-Setup-.*\.exe$/i.test(a.name))
    const latest = {
      version: String(rel.tag_name || '').replace(/^v/, ''),
      name: rel.name || rel.tag_name,
      notes: String(rel.body || '').slice(0, 6000),
      publishedAt: rel.published_at,
      url: rel.html_url,
      asset: asset ? { name: asset.name, size: asset.size, url: asset.browser_download_url } : null,
    }
    if (!isNewer(rel, info)) return set({ status: 'current', latest })
    if ((process.platform !== 'win32' && process.env.ORBI_UPDATE_TEST !== '1') || !latest.asset) return set({ status: 'available-manual', latest })
    const cached = path.join(dir(), latest.asset.name)
    if (fs.existsSync(cached) && fs.statSync(cached).size === latest.asset.size) return set({ status: 'ready', latest, file: cached })
    return set({ status: 'available', latest })
  } catch (e) {
    return set({ status: manual ? 'error' : 'idle', error: String(e.message || e) })
  }
}

function dir() {
  const d = path.join(app.getPath('userData'), 'updates')
  fs.mkdirSync(d, { recursive: true })
  return d
}

async function download() {
  const latest = state.latest
  if (!latest?.asset) throw new Error('No installer in this release.')
  const dest = path.join(dir(), latest.asset.name)
  for (const f of fs.readdirSync(dir())) if (f !== latest.asset.name && f !== `${latest.asset.name}.part`) fs.rmSync(path.join(dir(), f), { force: true })
  controller = new AbortController()
  set({ status: 'downloading', progress: { received: 0, total: latest.asset.size }, error: null })
  try {
    const part = dest + '.part'
    const have = fs.existsSync(part) ? fs.statSync(part).size : 0
    const res = await fetch(latest.asset.url, { signal: controller.signal, redirect: 'follow', headers: { 'user-agent': 'Orbi-Updater', ...(have ? { Range: `bytes=${have}-` } : {}) } })
    if (!res.ok && res.status !== 206) throw new Error(`Download failed (${res.status})`)
    const resumed = res.status === 206
    let received = resumed ? have : 0
    let last = 0
    const counter = new TransformStream({
      transform(chunk, c) {
        received += chunk.byteLength
        if (Date.now() - last > 250) {
          last = Date.now()
          set({ progress: { received, total: latest.asset.size } })
        }
        c.enqueue(chunk)
      },
    })
    await pipeline(Readable.fromWeb(res.body.pipeThrough(counter)), fs.createWriteStream(part, { flags: resumed ? 'a' : 'w' }))
    if (fs.statSync(part).size !== latest.asset.size) throw new Error('The download is incomplete. Try again.')
    fs.renameSync(part, dest)
    return set({ status: 'ready', file: dest, progress: null })
  } catch (e) {
    if (controller.signal.aborted) return set({ status: 'available', progress: null })
    return set({ status: 'error', error: String(e.message || e), progress: null })
  } finally {
    controller = null
  }
}

function cancel() {
  controller?.abort()
}

// Runs the installer silently; it closes Orbi, replaces the files and opens Orbi again.
function install(beforeQuit) {
  if (state.status !== 'ready' || !state.file || !fs.existsSync(state.file)) throw new Error('The update is not downloaded yet.')
  set({ status: 'installing' })
  beforeQuit?.()
  const child = spawn(state.file, ['/S', '/UPDATE'], { detached: true, stdio: 'ignore', windowsHide: false })
  child.unref()
  setTimeout(() => app.quit(), 400)
  return true
}

function init(electronApp, sender, getSetting) {
  app = electronApp
  send = sender
  state.current = buildInfo().version
  const auto = () => getSetting('autoUpdateCheck', true) && check()
  setTimeout(auto, Number(process.env.ORBI_UPDATE_DELAY || 15_000))
  clearInterval(timer)
  timer = setInterval(auto, 4 * 60 * 60 * 1000)
}

module.exports = { init, check, download, cancel, install, getState: () => state, isNewer }
