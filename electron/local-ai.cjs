// Orbi Local model hub.
// - Detects the hardware and rates every model as ok / slow / too-heavy for this PC.
// - Downloads engines (llama.cpp, stable-diffusion.cpp, whisper.cpp) and model files only when asked.
// - Runs text through llama-server, images/videos through sd-cli and speech-to-text through whisper-cli.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const hardware = require('./hardware.cjs')

const HF = 'https://huggingface.co'
const GB = 1e9

// ---------- engines ----------
const ENGINES = {
  llama: {
    name: 'llama.cpp',
    tag: 'b11800',
    exe: { server: 'llama-server' },
    asset(gpu) {
      const t = this.tag
      const map = {
        'win32-x64': gpu ? `llama-${t}-bin-win-vulkan-x64.zip` : `llama-${t}-bin-win-cpu-x64.zip`,
        'linux-x64': gpu ? `llama-${t}-bin-ubuntu-vulkan-x64.tar.gz` : `llama-${t}-bin-ubuntu-x64.tar.gz`,
        'darwin-arm64': `llama-${t}-bin-macos-arm64.tar.gz`,
        'darwin-x64': `llama-${t}-bin-macos-x64.tar.gz`,
      }
      const a = map[`${process.platform}-${process.arch}`]
      return a && `https://github.com/ggml-org/llama.cpp/releases/download/${t}/${a}`
    },
  },
  sd: {
    name: 'stable-diffusion.cpp',
    tag: 'master-1015-e41fbcf',
    exe: { cli: 'sd-cli' },
    asset(gpu) {
      const h = 'e41fbcf'
      const map = {
        'win32-x64': gpu ? `sd-master-${h}-bin-win-vulkan-x64.zip` : `sd-master-${h}-bin-win-cpu-x64.zip`,
        'linux-x64': gpu ? `sd-master-${h}-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip` : `sd-master-${h}-bin-Linux-Ubuntu-24.04-x86_64.zip`,
      }
      const a = map[`${process.platform}-${process.arch}`]
      return a && `https://github.com/leejet/stable-diffusion.cpp/releases/download/${this.tag}/${a}`
    },
  },
  whisper: {
    name: 'whisper.cpp',
    tag: 'v1.9.2',
    exe: { cli: 'whisper-cli' },
    asset() {
      const a = { 'win32-x64': 'whisper-bin-x64.zip' }[`${process.platform}-${process.arch}`]
      return a && `https://github.com/ggml-org/whisper.cpp/releases/download/${this.tag}/${a}`
    },
  },
}

// ---------- catalog ----------
// req: ram = GB of system memory needed; vram = GB of dedicated video memory for good speed (0 = CPU is fine).
// files: repo + file, or repo + pattern (resolved with the Hugging Face API on first download).
const CATALOG = [
  // TEXT (llama.cpp)
  { id: 'smollm2-135m', kind: 'text', tier: 'light', name: 'SmolLM2 135M', license: 'Apache-2.0', size: 0.105, req: { ram: 1, vram: 0 },
    description: 'Tiny and instant. Runs on any PC — great for testing and short answers.', files: [{ role: 'model', repo: 'bartowski/SmolLM2-135M-Instruct-GGUF', file: 'SmolLM2-135M-Instruct-Q4_K_M.gguf' }] },
  { id: 'smollm2-360m', kind: 'text', tier: 'light', name: 'SmolLM2 360M', license: 'Apache-2.0', size: 0.386, req: { ram: 1.5, vram: 0 },
    description: 'Still very light, a bit smarter than 135M.', files: [{ role: 'model', repo: 'bartowski/SmolLM2-360M-Instruct-GGUF', file: 'SmolLM2-360M-Instruct-Q8_0.gguf' }] },
  { id: 'qwen2.5-0.5b', kind: 'text', tier: 'light', name: 'Qwen2.5 0.5B', license: 'Apache-2.0', size: 0.398, req: { ram: 2, vram: 0 },
    description: 'Best of the tiny models. Multilingual, decent Portuguese.', files: [{ role: 'model', repo: 'bartowski/Qwen2.5-0.5B-Instruct-GGUF', file: 'Qwen2.5-0.5B-Instruct-Q4_K_M.gguf' }] },
  { id: 'qwen2.5-1.5b', kind: 'text', tier: 'medium', name: 'Qwen2.5 1.5B', license: 'Apache-2.0', size: 0.99, req: { ram: 4, vram: 0 },
    description: 'Good everyday assistant on a normal laptop.', files: [{ role: 'model', repo: 'bartowski/Qwen2.5-1.5B-Instruct-GGUF', file: 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf' }] },
  { id: 'llama3.2-3b', kind: 'text', tier: 'medium', name: 'Llama 3.2 3B', license: 'Llama 3.2 Community', size: 2.02, req: { ram: 6, vram: 0 },
    description: 'Solid writing and reasoning for its size.', files: [{ role: 'model', repo: 'bartowski/Llama-3.2-3B-Instruct-GGUF', file: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf' }] },
  { id: 'qwen2.5-7b', kind: 'text', tier: 'heavy', name: 'Qwen2.5 7B', license: 'Apache-2.0', size: 4.68, req: { ram: 12, vram: 6 },
    description: 'Strong local model. Best with a GPU (6 GB+) or 16 GB RAM.', files: [{ role: 'model', repo: 'bartowski/Qwen2.5-7B-Instruct-GGUF', file: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf' }] },

  // SPEECH TO TEXT (whisper.cpp)
  { id: 'whisper-tiny', kind: 'stt', tier: 'light', name: 'Whisper Tiny', license: 'MIT', size: 0.075, req: { ram: 1, vram: 0 },
    description: 'Fast dictation on any PC. Multilingual.', files: [{ role: 'model', repo: 'ggerganov/whisper.cpp', file: 'ggml-tiny.bin' }] },
  { id: 'whisper-base', kind: 'stt', tier: 'light', name: 'Whisper Base', license: 'MIT', size: 0.142, req: { ram: 1, vram: 0 },
    description: 'Better accuracy, still fast.', files: [{ role: 'model', repo: 'ggerganov/whisper.cpp', file: 'ggml-base.bin' }] },
  { id: 'whisper-small', kind: 'stt', tier: 'medium', name: 'Whisper Small', license: 'MIT', size: 0.466, req: { ram: 2, vram: 0 },
    description: 'Good accuracy in Portuguese and other languages.', files: [{ role: 'model', repo: 'ggerganov/whisper.cpp', file: 'ggml-small.bin' }] },
  { id: 'whisper-turbo', kind: 'stt', tier: 'heavy', name: 'Whisper Large v3 Turbo', license: 'MIT', size: 0.547, req: { ram: 4, vram: 2 },
    description: 'Best accuracy. Needs a decent CPU or a GPU.', files: [{ role: 'model', repo: 'ggerganov/whisper.cpp', file: 'ggml-large-v3-turbo-q5_0.bin' }] },

  // IMAGE (stable-diffusion.cpp)
  { id: 'tiny-sd-turbo', kind: 'image', tier: 'light', name: 'Tiny SD Turbo', license: 'see model card', size: 1.84, req: { ram: 4, vram: 0 },
    description: '512×512 in one step. Runs on CPU — simple images, fast.', files: [{ role: 'model', repo: 'akleine/tiny-sd-turbo_q8_0', pattern: '\\.gguf$' }],
    args: { model: '-m', extra: ['--steps', '1', '--cfg-scale', '1'], width: 512, height: 512 } },
  { id: 'z-image-turbo', kind: 'image', tier: 'medium', name: 'Z-Image Turbo', license: 'Apache-2.0', size: 5.8, req: { ram: 12, vram: 6 },
    description: 'High quality photos and text in images. 8 steps.', files: [
      { role: 'diffusion', repo: 'leejet/Z-Image-Turbo-GGUF', file: 'z_image_turbo-Q3_K.gguf', pattern: 'Q3_K\\.gguf$' },
      { role: 'llm', repo: 'unsloth/Qwen3-4B-Instruct-2507-GGUF', file: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf' },
      { role: 'vae', repo: 'Green-Sky/flux.1-schnell-GGUF', file: 'ae-f16.gguf' },
    ], args: { diffusion: '--diffusion-model', llm: '--llm', vae: '--vae', extra: ['--cfg-scale', '1', '--steps', '8', '--offload-to-cpu', '--diffusion-fa'], width: 768, height: 768 } },
  { id: 'flux-schnell', kind: 'image', tier: 'heavy', name: 'FLUX.1 schnell', license: 'Apache-2.0', size: 9.7, req: { ram: 16, vram: 8 },
    description: 'Excellent prompt following and detail. 4 steps.', files: [
      { role: 'diffusion', repo: 'Green-Sky/flux.1-schnell-GGUF', file: 'flux1-schnell-q4_k.gguf' },
      { role: 'vae', repo: 'Green-Sky/flux.1-schnell-GGUF', file: 'ae-f16.gguf' },
      { role: 'clip_l', repo: 'Green-Sky/flux.1-schnell-GGUF', file: 'clip_l-q8_0.gguf' },
      { role: 't5xxl', repo: 'Green-Sky/flux.1-schnell-GGUF', file: 't5xxl_q4_k.gguf' },
    ], args: { diffusion: '--diffusion-model', vae: '--vae', clip_l: '--clip_l', t5xxl: '--t5xxl', extra: ['--cfg-scale', '1', '--steps', '4', '--sampling-method', 'euler', '--offload-to-cpu'], width: 1024, height: 1024 } },

  // VIDEO (stable-diffusion.cpp, Wan)
  { id: 'wan2.1-1.3b', kind: 'video', tier: 'light', name: 'Wan 2.1 1.3B', license: 'Apache-2.0', size: 6.2, req: { ram: 12, vram: 6 },
    description: '480p clips of ~2 s. The lightest video model — still needs a GPU to be practical.', files: [
      { role: 'diffusion', repo: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged', file: 'split_files/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors' },
      { role: 'vae', repo: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged', file: 'split_files/vae/wan_2.1_vae.safetensors' },
      { role: 't5xxl', repo: 'city96/umt5-xxl-encoder-gguf', file: 'umt5-xxl-encoder-Q3_K_M.gguf' },
    ], args: { mode: 'vid_gen', diffusion: '--diffusion-model', vae: '--vae', t5xxl: '--t5xxl', extra: ['--cfg-scale', '6.0', '--sampling-method', 'euler', '--diffusion-fa', '--video-frames', '33', '--flow-shift', '3.0', '--offload-to-cpu'], width: 832, height: 480 } },
  { id: 'wan2.2-5b-q3', kind: 'video', tier: 'medium', name: 'Wan 2.2 TI2V 5B (Q3)', license: 'Apache-2.0', size: 7.0, req: { ram: 16, vram: 8 },
    description: 'Text or image to video, better motion. Needs 8 GB VRAM.', files: [
      { role: 'diffusion', repo: 'QuantStack/Wan2.2-TI2V-5B-GGUF', file: 'Wan2.2-TI2V-5B-Q3_K_M.gguf' },
      { role: 'vae', repo: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged', file: 'split_files/vae/wan2.2_vae.safetensors' },
      { role: 't5xxl', repo: 'city96/umt5-xxl-encoder-gguf', file: 'umt5-xxl-encoder-Q3_K_M.gguf' },
    ], args: { mode: 'vid_gen', diffusion: '--diffusion-model', vae: '--vae', t5xxl: '--t5xxl', extra: ['--cfg-scale', '6.0', '--sampling-method', 'euler', '--diffusion-fa', '--video-frames', '33', '--flow-shift', '3.0', '--offload-to-cpu'], width: 704, height: 480 } },
  { id: 'wan2.2-5b-q4', kind: 'video', tier: 'heavy', name: 'Wan 2.2 TI2V 5B (Q4)', license: 'Apache-2.0', size: 8.5, req: { ram: 24, vram: 12 },
    description: 'Best local video quality here. 12 GB VRAM recommended.', files: [
      { role: 'diffusion', repo: 'QuantStack/Wan2.2-TI2V-5B-GGUF', file: 'Wan2.2-TI2V-5B-Q4_K_M.gguf' },
      { role: 'vae', repo: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged', file: 'split_files/vae/wan2.2_vae.safetensors' },
      { role: 't5xxl', repo: 'city96/umt5-xxl-encoder-gguf', file: 'umt5-xxl-encoder-Q4_K_M.gguf' },
    ], args: { mode: 'vid_gen', diffusion: '--diffusion-model', vae: '--vae', t5xxl: '--t5xxl', extra: ['--cfg-scale', '6.0', '--sampling-method', 'euler', '--diffusion-fa', '--video-frames', '49', '--flow-shift', '3.0', '--offload-to-cpu'], width: 1280, height: 704 } },
]
const ENGINE_FOR = { text: 'llama', image: 'sd', video: 'sd', stt: 'whisper' }

// ---------- state ----------
let root = null
let send = () => {}
let electronApp = null
let hw = null
let server = null // llama-server { proc, port, modelId }
let starting = null
const jobs = new Map() // id -> { received, total, controller, label }

function modelsDir() {
  const d = path.join(root, 'models')
  fs.mkdirSync(d, { recursive: true })
  return d
}
function engineDir(key) {
  return path.join(root, 'engine', key, ENGINES[key].tag)
}
function findExe(dir, name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name
  if (!fs.existsSync(dir)) return null
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.name === exe) return p
    }
  }
  return null
}
function engineBinary(key) {
  const e = ENGINES[key]
  return findExe(engineDir(key), Object.values(e.exe)[0])
}
// Back-compat with 0.2.0 installs (engine/<tag>).
function legacyLlama() {
  return findExe(path.join(root, 'engine', ENGINES.llama.tag), 'llama-server')
}

function customModels() {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'custom-models.json'), 'utf8')).map((m) => ({
      kind: 'text', tier: 'custom', req: { ram: 0, vram: 0 }, license: '', size: (m.size || 0) / GB, ...m,
      files: m.files || [{ role: 'model', url: m.url, file: m.file }],
    }))
  } catch {
    return []
  }
}
function allModels() {
  return [...CATALOG, ...customModels()]
}
function localName(f) {
  return path.basename(f.file || f.url || '')
}
function isInstalled(m) {
  return m.files.every((f) => f.file && fs.existsSync(path.join(modelsDir(), localName(f))))
}

function fitFor(m) {
  if (!hw) return { level: 'ok', reason: '' }
  const need = m.req || { ram: 0, vram: 0 }
  const effRam = hw.ram + (hw.platform === 'darwin' ? 0 : 0)
  if (hw.diskFree && m.size && hw.diskFree < m.size + 1) return { level: 'no', reason: 'Needs {need} GB free disk — you have {have} GB.', vars: { need: m.size.toFixed(1), have: hw.diskFree } }
  if (need.ram && effRam < need.ram) return { level: 'no', reason: 'Needs {need} GB RAM — this PC has {have} GB.', vars: { need: need.ram, have: hw.ram } }
  if (need.vram && hw.vram < need.vram) {
    if (m.kind === 'video' || (m.kind === 'image' && m.tier === 'heavy'))
      return { level: 'slow', reason: 'Best with {need} GB VRAM (you have {have}). It will run on CPU — very slowly.', vars: { need: need.vram, have: hw.vram || 0 } }
    return { level: 'slow', reason: 'Best with {need} GB VRAM (you have {have}). Works on CPU, slower.', vars: { need: need.vram, have: hw.vram || 0 } }
  }
  return { level: 'ok', reason: 'Runs well on this PC.' }
}

function engineSupported(kind) {
  const e = ENGINES[ENGINE_FOR[kind]]
  return !!e?.asset(false)
}

function status() {
  const engines = {}
  for (const key of Object.keys(ENGINES)) {
    const job = jobs.get(`__engine:${key}`)
    engines[key] = {
      name: ENGINES[key].name,
      tag: ENGINES[key].tag,
      supported: !!ENGINES[key].asset(false),
      installed: !!(engineBinary(key) || (key === 'llama' && legacyLlama())),
      downloading: job ? { received: job.received, total: job.total } : null,
    }
  }
  const models = allModels().map((m) => {
    const job = jobs.get(m.id)
    return {
      id: m.id, kind: m.kind, tier: m.tier, name: m.name, description: m.description, license: m.license,
      size: Math.round((m.size || 0) * GB), req: m.req, ram: m.req?.ram ? `${m.req.ram} GB RAM` : '',
      badge: m.tier === 'light' ? 'Light' : m.tier === 'medium' ? 'Medium' : m.tier === 'heavy' ? 'Heavy' : 'Custom',
      fit: fitFor(m), installed: isInstalled(m), engineSupported: engineSupported(m.kind),
      downloading: job ? { received: job.received, total: job.total, label: job.label } : null,
    }
  })
  const recommended = {}
  for (const kind of ['text', 'image', 'video', 'stt']) {
    const ok = models.filter((m) => m.kind === kind && m.fit.level === 'ok' && m.engineSupported)
    recommended[kind] = ok.length ? ok[ok.length - 1].id : null
  }
  return {
    hardware: hw,
    engines,
    engineInstalled: engines.llama.installed,
    engineTag: ENGINES.llama.tag,
    engineDownloading: engines.llama.downloading,
    running: server ? { modelId: server.modelId, port: server.port } : null,
    starting: !!starting,
    models,
    recommended,
  }
}

let emitTimer = null
function emit() {
  clearTimeout(emitTimer)
  emitTimer = setTimeout(() => send('local:status', status()), 120)
}

// ---------- downloads ----------
async function resolveFile(f) {
  if (f.url) return { url: f.url, file: localName(f) }
  if (f.file) return { url: `${HF}/${f.repo}/resolve/main/${f.file.split('/').map(encodeURIComponent).join('/')}`, file: path.basename(f.file) }
  const res = await fetch(`${HF}/api/models/${f.repo}`, { headers: { 'user-agent': 'Orbi' } })
  if (!res.ok) throw new Error(`Hugging Face: could not list ${f.repo} (${res.status}).`)
  const json = await res.json()
  const re = new RegExp(f.pattern, 'i')
  const hit = (json.siblings || []).map((s) => s.rfilename).find((n) => re.test(n))
  if (!hit) throw new Error(`No file matching ${f.pattern} in ${f.repo}.`)
  f.file = hit
  return { url: `${HF}/${f.repo}/resolve/main/${hit.split('/').map(encodeURIComponent).join('/')}`, file: path.basename(hit) }
}

async function download(url, dest, jobId, label, offset = 0, totalHint = 0) {
  let job = jobs.get(jobId)
  if (!job) {
    job = { received: 0, total: 0, controller: new AbortController(), label }
    jobs.set(jobId, job)
  }
  job.label = label
  emit()
  if (url.startsWith('file://') || path.isAbsolute(url)) {
    fs.copyFileSync(url.startsWith('file://') ? new URL(url) : url, dest)
    return
  }
  const part = dest + '.part'
  const have = fs.existsSync(part) ? fs.statSync(part).size : 0
  const headers = { 'user-agent': 'Orbi' }
  if (have) headers.Range = `bytes=${have}-`
  const res = await fetch(url, { signal: job.controller.signal, redirect: 'follow', headers })
  if (!res.ok && res.status !== 206) throw new Error(`Download failed (${res.status}) — ${url}`)
  const resumed = res.status === 206
  const len = Number(res.headers.get('content-length') || 0)
  job.total = totalHint || offset + (resumed ? have : 0) + len
  job.received = offset + (resumed ? have : 0)
  let last = 0
  const counter = new TransformStream({
    transform(chunk, c) {
      job.received += chunk.byteLength
      if (Date.now() - last > 300) {
        last = Date.now()
        emit()
      }
      c.enqueue(chunk)
    },
  })
  await pipeline(Readable.fromWeb(res.body.pipeThrough(counter)), fs.createWriteStream(part, { flags: resumed ? 'a' : 'w' }))
  fs.renameSync(part, dest)
}

async function extract(archive, dir) {
  fs.mkdirSync(dir, { recursive: true })
  if (archive.endsWith('.zip')) {
    const { unzipSync } = require('fflate')
    const files = unzipSync(new Uint8Array(fs.readFileSync(archive)))
    for (const [name, data] of Object.entries(files)) {
      if (name.endsWith('/')) continue
      const out = path.join(dir, name)
      fs.mkdirSync(path.dirname(out), { recursive: true })
      fs.writeFileSync(out, data)
    }
  } else await require('tar').x({ file: archive, cwd: dir })
}

async function installEngine(key = 'llama') {
  if (engineBinary(key) || (key === 'llama' && legacyLlama())) return status()
  if (!hw) hw = await hardware.detect(electronApp, root)
  const e = ENGINES[key]
  const useGpu = hw.gpuAccel && process.platform !== 'darwin'
  const url = (key === 'llama' && process.env.ORBI_LLAMA_URL) || (key === 'sd' && process.env.ORBI_SD_URL) || e.asset(useGpu)
  if (!url) throw new Error(`${e.name} has no build for ${process.platform}-${process.arch} yet. Use a cloud provider instead.`)
  const dir = engineDir(key)
  const archive = path.join(root, path.basename(url.split('?')[0]))
  const jobId = `__engine:${key}`
  try {
    await download(url, archive, jobId, `${e.name} engine`)
    await extract(archive, dir)
  } finally {
    fs.rmSync(archive, { force: true })
    jobs.delete(jobId)
    emit()
  }
  const bin = engineBinary(key)
  if (!bin) throw new Error(`${e.name}: executable not found in the download.`)
  if (process.platform !== 'win32') for (const f of fs.readdirSync(path.dirname(bin))) if (!/\.(so|dylib|txt|bat|sh)$/.test(f) || f.endsWith('.sh')) fs.chmodSync(path.join(path.dirname(bin), f), 0o755)
  return status()
}

async function installModel(id) {
  const m = allModels().find((x) => x.id === id)
  if (!m) throw new Error('Unknown model')
  await installEngine(ENGINE_FOR[m.kind] || 'llama')
  const total = Math.round((m.size || 0) * GB)
  let done = 0
  try {
    for (const f of m.files) {
      const { url, file } = await resolveFile(f)
      const dest = path.join(modelsDir(), file)
      if (!fs.existsSync(dest)) await download(url, dest, id, `${m.name} · ${file}`, done, total)
      done += fs.existsSync(dest) ? fs.statSync(dest).size : 0
    }
    if (m.files.some((f) => f.pattern)) saveResolved(m)
  } finally {
    jobs.delete(id)
    emit()
  }
  return status()
}

function saveResolved(m) {
  const map = loadResolved()
  map[m.id] = m.files.map((f) => f.file)
  fs.writeFileSync(path.join(root, 'resolved.json'), JSON.stringify(map, null, 2))
}
function loadResolved() {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'resolved.json'), 'utf8'))
  } catch {
    return {}
  }
}

async function addCustomModel(url, name) {
  const clean = url.trim()
  if (!/\.gguf(\?|$)/i.test(clean)) throw new Error('Paste a direct link to a .gguf file (Hugging Face "resolve" link).')
  const file = decodeURIComponent(clean.split('?')[0].split('/').pop())
  const id = 'custom-' + file.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/\.gguf$/, '')
  let list = []
  try {
    list = JSON.parse(fs.readFileSync(path.join(root, 'custom-models.json'), 'utf8'))
  } catch {
    /* none */
  }
  list = list.filter((m) => m.id !== id)
  list.push({ id, name: name || file.replace(/\.gguf$/i, ''), description: clean, url: clean, file })
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
  const shared = new Set(allModels().filter((x) => x.id !== id && isInstalled(x)).flatMap((x) => x.files.map(localName)))
  for (const f of m.files) if (f.file && !shared.has(localName(f))) fs.rmSync(path.join(modelsDir(), localName(f)), { force: true })
  if (id.startsWith('custom-')) {
    try {
      const list = JSON.parse(fs.readFileSync(path.join(root, 'custom-models.json'), 'utf8')).filter((x) => x.id !== id)
      fs.writeFileSync(path.join(root, 'custom-models.json'), JSON.stringify(list, null, 2))
    } catch {
      /* none */
    }
  }
  emit()
  return status()
}

// ---------- text: llama-server ----------
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
function threads() {
  return Math.max(2, Math.min(8, os.cpus().length - 1))
}

async function ensureRunning(modelId) {
  if (server && server.modelId === modelId && server.proc.exitCode === null) return server
  if (starting) await starting.catch(() => {})
  if (server && server.modelId === modelId) return server
  starting = (async () => {
    stop()
    const bin = engineBinary('llama') || legacyLlama()
    if (!bin) throw new Error('Install a local text model first (Settings → Models).')
    const m = allModels().find((x) => x.id === modelId)
    if (!m || !isInstalled(m)) throw new Error('This local model is not downloaded yet.')
    const file = path.join(modelsDir(), localName(m.files[0]))
    const port = await freePort()
    const args = ['-m', file, '--host', '127.0.0.1', '--port', String(port), '--alias', modelId, '-c', '4096', '-t', String(threads()), '--jinja']
    if (hw?.gpuAccel) args.push('-ngl', '99')
    const proc = spawn(bin, args, { cwd: path.dirname(bin), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let log = ''
    proc.stderr.on('data', (d) => (log = (log + d).slice(-4000)))
    server = { proc, port, modelId }
    proc.on('exit', () => {
      if (server?.proc === proc) server = null
      emit()
    })
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) throw new Error('Local engine stopped: ' + log.split('\n').filter((l) => / E |error/i.test(l)).slice(-2).join(' ').slice(0, 300))
      try {
        if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break
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

function installedModels(kind = 'text') {
  return allModels()
    .filter((m) => m.kind === kind && isInstalled(m))
    .map((m) => ({ id: m.id, name: `${m.name} (local)`, image: kind === 'image', video: kind === 'video' }))
}

// ---------- image & video: sd-cli ----------
const activeRuns = new Map()

function runProcess(bin, args, onLine, signal) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { cwd: path.dirname(bin), windowsHide: true })
    let tail = ''
    const onData = (d) => {
      const s = String(d)
      tail = (tail + s).slice(-6000)
      for (const line of s.split(/\r|\n/)) if (line.trim()) onLine?.(line.trim())
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    signal?.addEventListener('abort', () => proc.kill())
    proc.on('error', reject)
    proc.on('exit', (code) => (code === 0 ? resolve(tail) : reject(new Error(tail.split('\n').filter((l) => /error|fail|assert/i.test(l)).slice(-3).join(' ').slice(0, 400) || `exit code ${code}`))))
  })
}

async function generateMedia({ modelId, prompt, negative, width, height, steps, seed, initImage, mask, strength, frames }, onProgress) {
  const m = allModels().find((x) => x.id === modelId)
  if (!m || !['image', 'video'].includes(m.kind)) throw new Error('Unknown local image/video model.')
  if (!isInstalled(m)) throw new Error(`${m.name} is not downloaded yet.`)
  const bin = engineBinary('sd')
  if (!bin) throw new Error('The image engine is not installed.')
  const resolved = loadResolved()[m.id]
  const fileFor = (role) => {
    const i = m.files.findIndex((f) => f.role === role)
    return path.join(modelsDir(), path.basename((resolved && resolved[i]) || m.files[i].file))
  }
  const a = m.args
  const args = []
  if (a.mode) args.push('-M', a.mode)
  for (const role of ['model', 'diffusion', 'llm', 'vae', 'clip_l', 't5xxl']) if (a[role]) args.push(a[role], fileFor(role))
  args.push('-p', prompt)
  if (negative) args.push('-n', negative)
  const extra = [...a.extra]
  if (steps) {
    const i = extra.indexOf('--steps')
    if (i >= 0) extra[i + 1] = String(steps)
    else extra.push('--steps', String(steps))
  }
  if (frames && a.mode === 'vid_gen') {
    const i = extra.indexOf('--video-frames')
    if (i >= 0) extra[i + 1] = String(frames)
  }
  args.push(...extra)
  args.push('-W', String(width || a.width), '-H', String(height || a.height), '-t', String(threads()))
  if (seed !== undefined && seed !== null && seed !== '') args.push('--seed', String(seed))
  if (initImage) args.push('-i', initImage, '--strength', String(strength ?? 0.75))
  if (mask) args.push('--mask', mask)
  const out = path.join(os.tmpdir(), `orbi-${Date.now()}.${m.kind === 'video' ? 'webm' : 'png'}`)
  args.push('-o', out)
  const controller = new AbortController()
  const runId = String(Date.now())
  activeRuns.set(runId, controller)
  try {
    await runProcess(bin, args, (line) => {
      const p = line.match(/\|\s*(\d+)\/(\d+)\s*-/) || line.match(/(\d+)\/(\d+)/)
      if (p) onProgress?.({ step: Number(p[1]), total: Number(p[2]), line })
    }, controller.signal)
  } finally {
    activeRuns.delete(runId)
  }
  if (!fs.existsSync(out)) throw new Error('The engine finished without writing an output file.')
  const buffer = fs.readFileSync(out)
  fs.rmSync(out, { force: true })
  return { buffer, mime: m.kind === 'video' ? 'video/webm' : 'image/png', model: m.name }
}

function cancelMedia() {
  for (const c of activeRuns.values()) c.abort()
}

// ---------- speech to text: whisper-cli ----------
async function transcribe({ wavPath, modelId, language }) {
  const m = allModels().find((x) => x.id === modelId && x.kind === 'stt')
  if (!m || !isInstalled(m)) throw new Error('This voice model is not downloaded yet.')
  const bin = engineBinary('whisper')
  if (!bin) throw new Error('The voice engine is not installed.')
  const args = ['-m', path.join(modelsDir(), localName(m.files[0])), '-f', wavPath, '-nt', '-np', '-t', String(threads()), '-l', language || 'auto']
  const outText = await new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { cwd: path.dirname(bin), windowsHide: true })
    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.stderr.on('data', (d) => (err = (err + d).slice(-3000)))
    proc.on('error', reject)
    proc.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(err.split('\n').slice(-3).join(' ') || `exit ${code}`))))
  })
  return outText.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim()
}

async function init(dir, sender, app) {
  root = dir
  send = sender
  electronApp = app
  fs.mkdirSync(root, { recursive: true })
  hw = await hardware.detect(app, dir).catch(() => null)
  emit()
}

async function refreshHardware() {
  hardware.reset()
  hw = await hardware.detect(electronApp, root)
  return status()
}

module.exports = {
  init, status, installEngine, installModel, addCustomModel, removeModel, cancel, ensureRunning, stop, installedModels,
  generateMedia, cancelMedia, transcribe, refreshHardware, CATALOG,
}
