// Orbi Local: downloads llama.cpp + a small GGUF model on demand and serves it as an OpenAI-compatible endpoint.
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const LLAMA_TAG = 'b11800'
const HF = 'https://huggingface.co'

const MODELS = [
  {
    id: 'smollm2-135m',
    name: 'SmolLM2 135M',
    badge: 'Super light',
    size: 105_000_000,
    ram: '≈ 300 MB RAM',
    license: 'Apache-2.0',
    description: 'Tiny and fast — runs on any PC, even with little memory. Good for testing, short answers and simple tasks.',
    url: `${HF}/bartowski/SmolLM2-135M-Instruct-GGUF/resolve/main/SmolLM2-135M-Instruct-Q4_K_M.gguf`,
    file: 'SmolLM2-135M-Instruct-Q4_K_M.gguf',
  },
  {
    id: 'smollm2-360m',
    name: 'SmolLM2 360M',
    badge: 'Light',
    size: 386_000_000,
    ram: '≈ 600 MB RAM',
    license: 'Apache-2.0',
    description: 'A bit smarter than 135M and still very light.',
    url: `${HF}/bartowski/SmolLM2-360M-Instruct-GGUF/resolve/main/SmolLM2-360M-Instruct-Q8_0.gguf`,
    file: 'SmolLM2-360M-Instruct-Q8_0.gguf',
  },
  {
    id: 'qwen2.5-0.5b',
    name: 'Qwen2.5 0.5B',
    badge: 'Best tiny',
    size: 398_000_000,
    ram: '≈ 700 MB RAM',
    license: 'Apache-2.0',
    description: 'The most capable of the tiny models, multilingual (good Portuguese).',
    url: `${HF}/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf`,
    file: 'Qwen2.5-0.5B-Instruct-Q4_K_M.gguf',
  },
]

function engineAsset() {
  const key = `${process.platform}-${process.arch}`
  const map = {
    'win32-x64': `llama-${LLAMA_TAG}-bin-win-cpu-x64.zip`,
    'linux-x64': `llama-${LLAMA_TAG}-bin-ubuntu-x64.tar.gz`,
    'darwin-arm64': `llama-${LLAMA_TAG}-bin-macos-arm64.tar.gz`,
    'darwin-x64': `llama-${LLAMA_TAG}-bin-macos-x64.tar.gz`,
  }
  if (!map[key]) throw new Error(`Local AI is not available for ${key} yet.`)
  return process.env.ORBI_LLAMA_URL || `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/${map[key]}`
}

let root = null
let send = () => {}
let server = null // { proc, port, modelId }
let starting = null
const jobs = new Map() // id -> { received, total, controller }

function dirs() {
  const engine = path.join(root, 'engine', LLAMA_TAG)
  const models = path.join(root, 'models')
  fs.mkdirSync(models, { recursive: true })
  return { engine, models }
}

function serverBinary() {
  const { engine } = dirs()
  const exe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  const direct = path.join(engine, exe)
  if (fs.existsSync(direct)) return direct
  // tarballs contain a top-level folder
  if (fs.existsSync(engine)) {
    for (const d of fs.readdirSync(engine)) {
      const p = path.join(engine, d, exe)
      if (fs.existsSync(p)) return p
    }
  }
  return null
}

function customModels() {
  const f = path.join(root, 'custom-models.json')
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {
    return []
  }
}

function allModels() {
  return [...MODELS, ...customModels()]
}

function status() {
  const { models } = dirs()
  return {
    engineInstalled: !!serverBinary(),
    engineTag: LLAMA_TAG,
    running: server ? { modelId: server.modelId, port: server.port } : null,
    starting: !!starting,
    models: allModels().map((m) => {
      const file = path.join(models, m.file)
      const job = jobs.get(m.id)
      return { ...m, installed: fs.existsSync(file), downloading: job ? { received: job.received, total: job.total } : null }
    }),
    engineDownloading: jobs.get('__engine') ? { received: jobs.get('__engine').received, total: jobs.get('__engine').total } : null,
  }
}

function emit() {
  send('local:status', status())
}

async function download(url, dest, jobId) {
  const controller = new AbortController()
  const job = { received: 0, total: 0, controller }
  jobs.set(jobId, job)
  emit()
  try {
    let res
    if (url.startsWith('file://') || path.isAbsolute(url)) {
      const src = url.startsWith('file://') ? new URL(url) : url
      fs.copyFileSync(src, dest)
      return
    }
    res = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { 'user-agent': 'Orbi/0.2' } })
    if (!res.ok) throw new Error(`Download failed (${res.status}) — ${url}`)
    job.total = Number(res.headers.get('content-length') || 0)
    const part = dest + '.part'
    let last = 0
    const counter = new TransformStream({
      transform(chunk, c) {
        job.received += chunk.byteLength
        if (Date.now() - last > 250) {
          last = Date.now()
          emit()
        }
        c.enqueue(chunk)
      },
    })
    await pipeline(Readable.fromWeb(res.body.pipeThrough(counter)), fs.createWriteStream(part))
    fs.renameSync(part, dest)
  } finally {
    jobs.delete(jobId)
    emit()
  }
}

async function installEngine() {
  if (serverBinary()) return status()
  const { engine } = dirs()
  fs.mkdirSync(engine, { recursive: true })
  const url = engineAsset()
  const archive = path.join(root, path.basename(url.split('?')[0]))
  await download(url, archive, '__engine')
  if (archive.endsWith('.zip')) {
    const { unzipSync } = require('fflate')
    const files = unzipSync(new Uint8Array(fs.readFileSync(archive)))
    for (const [name, data] of Object.entries(files)) {
      if (name.endsWith('/')) continue
      const out = path.join(engine, name)
      fs.mkdirSync(path.dirname(out), { recursive: true })
      fs.writeFileSync(out, data)
    }
  } else {
    await require('tar').x({ file: archive, cwd: engine })
  }
  fs.rmSync(archive, { force: true })
  const bin = serverBinary()
  if (!bin) throw new Error('llama-server was not found in the downloaded engine.')
  if (process.platform !== 'win32') fs.chmodSync(bin, 0o755)
  emit()
  return status()
}

async function installModel(id) {
  const m = allModels().find((x) => x.id === id)
  if (!m) throw new Error('Unknown model')
  const { models } = dirs()
  const dest = path.join(models, m.file)
  if (!fs.existsSync(dest)) await download(m.url, dest, id)
  return status()
}

async function addCustomModel(url, name) {
  const clean = url.trim()
  if (!/\.gguf(\?|$)/i.test(clean)) throw new Error('Paste a direct link to a .gguf file (Hugging Face "resolve" link).')
  const file = decodeURIComponent(clean.split('?')[0].split('/').pop())
  const id = 'custom-' + file.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/\.gguf$/, '')
  const list = customModels().filter((m) => m.id !== id)
  list.push({ id, name: name || file.replace(/\.gguf$/i, ''), badge: 'Custom', size: 0, ram: '', license: '', description: clean, url: clean, file })
  fs.writeFileSync(path.join(root, 'custom-models.json'), JSON.stringify(list, null, 2))
  return installModel(id)
}

function cancel(id) {
  jobs.get(id)?.controller.abort()
}

function removeModel(id) {
  const m = allModels().find((x) => x.id === id)
  if (!m) return status()
  if (server?.modelId === id) stop()
  fs.rmSync(path.join(dirs().models, m.file), { force: true })
  if (id.startsWith('custom-'))
    fs.writeFileSync(path.join(root, 'custom-models.json'), JSON.stringify(customModels().filter((x) => x.id !== id), null, 2))
  emit()
  return status()
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
    s.on('error', reject)
  })
}

async function ensureRunning(modelId) {
  if (server && server.modelId === modelId && server.proc.exitCode === null) return server
  if (starting) await starting.catch(() => {})
  if (server && server.modelId === modelId) return server
  starting = (async () => {
    stop()
    const bin = serverBinary()
    if (!bin) throw new Error('Install the local AI engine first (Settings → AI providers → Orbi Local).')
    const m = allModels().find((x) => x.id === modelId)
    const file = m && path.join(dirs().models, m.file)
    if (!file || !fs.existsSync(file)) throw new Error('This local model is not downloaded yet.')
    const port = await freePort()
    const threads = Math.max(2, Math.min(8, require('node:os').cpus().length - 1))
    const proc = spawn(bin, ['-m', file, '--host', '127.0.0.1', '--port', String(port), '--alias', modelId, '-c', '4096', '-t', String(threads), '--jinja'], {
      cwd: path.dirname(bin),
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let log = ''
    proc.stderr.on('data', (d) => (log = (log + d).slice(-4000)))
    server = { proc, port, modelId }
    proc.on('exit', () => {
      if (server?.proc === proc) server = null
      emit()
    })
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) throw new Error('Local engine stopped: ' + log.split('\n').filter((l) => / E |error/i.test(l)).slice(-2).join(' ').slice(0, 300))
      try {
        const r = await fetch(`http://127.0.0.1:${port}/health`)
        if (r.ok) break
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 300))
    }
    emit()
    return server
  })()
  try {
    return await starting
  } finally {
    starting = null
  }
}

function stop() {
  if (server) {
    try {
      server.proc.kill()
    } catch {
      /* ignore */
    }
    server = null
    emit()
  }
}

function installedModels() {
  return status()
    .models.filter((m) => m.installed)
    .map((m) => ({ id: m.id, name: `${m.name} (local)`, image: false }))
}

function init(dir, sender) {
  root = dir
  send = sender
  fs.mkdirSync(root, { recursive: true })
}

module.exports = { init, status, installEngine, installModel, addCustomModel, removeModel, cancel, ensureRunning, stop, installedModels }
