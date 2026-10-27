// Hardware profile: RAM, CPU, GPUs (with dedicated VRAM when we can read it) and free disk.
const os = require('node:os')
const fs = require('node:fs')
const { execFile } = require('node:child_process')

function run(cmd, args, timeout = 6000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout)))
  })
}

const GB = 1024 ** 3

async function nvidiaGpus() {
  const out = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'])
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, mem] = l.split(',').map((x) => x.trim())
      return { name, vendor: 'NVIDIA', vram: Math.round((Number(mem) / 1024) * 10) / 10, source: 'nvidia-smi' }
    })
}

async function windowsGpus() {
  // The registry keeps the real 64-bit VRAM size (Win32_VideoController.AdapterRAM caps at 4 GB).
  const ps = `$ErrorActionPreference='SilentlyContinue';
$r = Get-ItemProperty -Path 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' |
  Where-Object { $_.DriverDesc } |
  Select-Object DriverDesc, @{n='mem';e={$_.'HardwareInformation.qwMemorySize'}}, @{n='mem32';e={$_.'HardwareInformation.MemorySize'}};
$r | ConvertTo-Json -Compress`
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], 9000)
  try {
    const rows = [].concat(JSON.parse(out || '[]'))
    return rows.map((r) => {
      let bytes = Number(r.mem) || 0
      if (!bytes && r.mem32) bytes = Array.isArray(r.mem32) ? 0 : Number(r.mem32) || 0
      const name = String(r.DriverDesc)
      return { name, vendor: vendorOf(name), vram: Math.round((bytes / GB) * 10) / 10, source: 'registry' }
    })
  } catch {
    return []
  }
}

async function linuxGpus() {
  const list = []
  try {
    for (const card of fs.readdirSync('/sys/class/drm').filter((d) => /^card\d+$/.test(d))) {
      const base = `/sys/class/drm/${card}/device`
      const vram = Number(fs.readFileSync(`${base}/mem_info_vram_total`, 'utf8')) || 0
      if (vram) list.push({ name: 'AMD GPU', vendor: 'AMD', vram: Math.round((vram / GB) * 10) / 10, source: 'sysfs' })
    }
  } catch {
    /* no drm info */
  }
  if (!list.length) {
    const out = await run('lspci', [])
    for (const l of out.split('\n')) {
      if (/VGA|3D controller|Display controller/i.test(l)) {
        const name = l.split(': ').slice(1).join(': ').trim()
        list.push({ name, vendor: vendorOf(name), vram: 0, source: 'lspci' })
      }
    }
  }
  return list
}

function vendorOf(name) {
  if (/nvidia|geforce|rtx|gtx|quadro/i.test(name)) return 'NVIDIA'
  if (/amd|radeon|ati /i.test(name)) return 'AMD'
  if (/intel|arc|iris|uhd/i.test(name)) return 'Intel'
  if (/apple/i.test(name)) return 'Apple'
  return 'Other'
}

let cache = null

async function detect(app, dataDir) {
  if (cache) return cache
  const cpus = os.cpus()
  const ram = Math.round((os.totalmem() / GB) * 10) / 10
  let gpus = await nvidiaGpus()
  if (process.platform === 'win32') {
    const reg = await windowsGpus()
    for (const g of reg) if (!gpus.some((x) => x.name === g.name)) gpus.push(g)
  } else if (process.platform === 'linux') {
    const lin = await linuxGpus()
    for (const g of lin) if (!gpus.some((x) => x.name === g.name)) gpus.push(g)
  }
  const appleSilicon = process.platform === 'darwin' && process.arch === 'arm64'
  if (appleSilicon) gpus = [{ name: 'Apple Silicon GPU (unified memory)', vendor: 'Apple', vram: Math.round(ram * 0.65 * 10) / 10, source: 'unified' }]
  if (!gpus.length && app) {
    try {
      const info = await app.getGPUInfo('basic')
      for (const d of (info.gpuDevice || []).filter((d) => d.vendorId && d.deviceId)) gpus.push({ name: `GPU ${d.vendorId?.toString(16)}:${d.deviceId?.toString(16)}`, vendor: d.vendorId === 0x10de ? 'NVIDIA' : d.vendorId === 0x1002 ? 'AMD' : d.vendorId === 0x8086 ? 'Intel' : 'Other', vram: 0, source: 'chromium' })
    } catch {
      /* ignore */
    }
  }
  // Integrated GPUs report shared memory; do not count it as dedicated VRAM.
  for (const g of gpus) if (g.vendor === 'Intel' && !/arc/i.test(g.name)) g.vram = 0
  const vram = Math.max(0, ...gpus.map((g) => g.vram || 0))
  let diskFree = 0
  try {
    const s = fs.statfsSync(dataDir || os.homedir())
    diskFree = Math.round(((s.bavail * s.bsize) / GB) * 10) / 10
  } catch {
    /* unknown */
  }
  cache = {
    platform: process.platform,
    arch: process.arch,
    os: `${os.type()} ${os.release()}`,
    cpu: cpus[0]?.model?.trim() || 'Unknown CPU',
    cores: cpus.length,
    ram,
    gpus,
    vram,
    gpuAccel: vram >= 2 || appleSilicon,
    diskFree,
  }
  return cache
}

function reset() {
  cache = null
}

module.exports = { detect, reset }
