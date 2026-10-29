// Updates from GitHub Releases (github.com/iwerry/chatorbit-app).
// The app always goes straight to the latest release (versions in between are skipped: the latest has everything).
// Two kinds of update, and the user always decides when:
//  - "quick": the release only changed the UI (same `core` fingerprint as this build). Orbi downloads the UI
//    package (~2 MB) and applies it by reloading the window. No reinstall, no restart.
//  - "full": the release changed the app itself. Orbi downloads the installer, which closes Orbi, installs and reopens it.
const fs = require('node:fs')
const crypto = require('node:crypto')
// Electron treats *.asar paths as archives; original-fs reads and writes them as plain files.
let ofs = fs
try {
  ofs = require('original-fs')
} catch {
  /* plain Node (tests) */
}
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
    return { version: app.getVersion(), builtAt: null, core: null }
  }
}

// ---------------------------------------------------------------- quick (UI-only) updates
const uiDir = () => {
  const d = path.join(app.getPath('userData'), 'ui')
  fs.mkdirSync(d, { recursive: true })
  return d
}
const uiCurrentFile = () => path.join(uiDir(), 'current.json')

/** The UI package applied on top of this build, if it still fits (same core, newer than the installed build). */
function uiOverride() {
  try {
    const b = buildInfo()
    const o = JSON.parse(fs.readFileSync(uiCurrentFile(), 'utf8'))
    const file = path.join(uiDir(), o.file)
    if (!b.core || o.core !== b.core) return null
    if (b.builtAt && new Date(o.builtAt).getTime() <= new Date(b.builtAt).getTime()) return null
    if (!ofs.existsSync(file)) return null
    return { ...o, path: file }
  } catch {
    return null
  }
}

/** What is running now: the installed build, or the newer UI package applied on top of it. */
function runningInfo() {
  const b = buildInfo()
  const o = uiOverride()
  return o ? { ...b, version: o.version, builtAt: o.builtAt } : b
}

/** The index.html the windows should load. */
function uiIndex(defaultIndex) {
  const o = uiOverride()
  return o ? path.join(o.path, 'index.html') : defaultIndex
}

// Removes UI packages that are no longer used (keeps the applied one and the one being prepared).
function cleanUi(keep = []) {
  try {
    for (const f of ofs.readdirSync(uiDir())) if (f !== 'current.json' && !keep.includes(f) && !keep.includes(f.replace(/\.part$/, ''))) ofs.rmSync(path.join(uiDir(), f), { force: true, recursive: true })
  } catch {
    /* ignore */
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
  const info = runningInfo()
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
    // Quick update when the release only changed the UI.
    const uiJson = (rel.assets || []).find((a) => a.name === `orbi-ui-${latest.version}.json`)
    const uiPack = (rel.assets || []).find((a) => a.name === `orbi-ui-${latest.version}.asar`)
    if (uiJson && uiPack && info.core) {
      try {
        const m = await (await fetch(uiJson.browser_download_url, { headers: { 'user-agent': 'Orbi-Updater' } })).json()
        if (m.core === info.core && m.size === uiPack.size) {
          latest.quick = { name: uiPack.name, size: uiPack.size, url: uiPack.browser_download_url, sha256: m.sha256, builtAt: m.builtAt, core: m.core }
          const ready = path.join(uiDir(), uiPack.name)
          if (ofs.existsSync(ready) && ofs.statSync(ready).size === uiPack.size) return set({ status: 'ready', latest, file: ready })
          return set({ status: 'available', latest })
        }
      } catch {
        /* fall back to the installer */
      }
    }
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

async function downloadQuick(latest) {
  const q = latest.quick
  const dest = path.join(uiDir(), q.name)
  const keep = [q.name]
  const cur = uiOverride()
  if (cur) keep.push(cur.file)
  cleanUi(keep)
  controller = new AbortController()
  set({ status: 'downloading', progress: { received: 0, total: q.size }, error: null })
  try {
    const res = await fetch(q.url, { signal: controller.signal, redirect: 'follow', headers: { 'user-agent': 'Orbi-Updater' } })
    if (!res.ok) throw new Error(`Download failed (${res.status})`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length !== q.size) throw new Error('The download is incomplete. Try again.')
    if (crypto.createHash('sha256').update(buf).digest('hex') !== q.sha256) throw new Error('The download is damaged. Try again.')
    ofs.writeFileSync(dest + '.part', buf)
    ofs.renameSync(dest + '.part', dest)
    return set({ status: 'ready', file: dest, progress: null })
  } catch (e) {
    if (controller.signal.aborted) return set({ status: 'available', progress: null })
    return set({ status: 'error', error: String(e.message || e), progress: null })
  } finally {
    controller = null
  }
}

async function download() {
  const latest = state.latest
  if (latest?.quick) return downloadQuick(latest)
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
function install(beforeQuit, reloadWindows) {
  if (state.status !== 'ready' || !state.file || !ofs.existsSync(state.file)) throw new Error('The update is not downloaded yet.')
  const q = state.latest?.quick
  if (q) {
    // Quick update: switch the UI package and reload the windows. Orbi keeps running.
    fs.writeFileSync(uiCurrentFile(), JSON.stringify({ version: state.latest.version, builtAt: q.builtAt, core: q.core, file: q.name }, null, 2))
    cleanUi([q.name])
    const v = state.latest.version
    state = { ...state, status: 'current', current: v, file: null, progress: null }
    reloadWindows?.(v)
    send('update:state', state)
    return true
  }
  set({ status: 'installing' })
  beforeQuit?.()
  // Not silent: the installer shows a small progress window so it is clear Orbi is updating.
  const child = spawn(state.file, ['/UPDATE'], { detached: true, stdio: 'ignore', windowsHide: false })
  child.unref()
  setTimeout(() => app.quit(), 400)
  return true
}

function init(electronApp, sender, getSetting) {
  app = electronApp
  send = sender
  state.current = runningInfo().version
  // A UI package that no longer fits this build (Orbi was reinstalled with a newer version) is removed.
  try {
    if (fs.existsSync(uiCurrentFile()) && !uiOverride()) {
      fs.rmSync(uiCurrentFile(), { force: true })
      cleanUi()
    }
  } catch {
    /* ignore */
  }
  const auto = () => getSetting('autoUpdateCheck', true) && check()
  setTimeout(auto, Number(process.env.ORBI_UPDATE_DELAY || 15_000))
  clearInterval(timer)
  timer = setInterval(auto, 4 * 60 * 60 * 1000)
}

module.exports = { init, check, download, cancel, install, getState: () => state, isNewer, uiIndex, runningInfo }
