// Native system voices, read in the main process so they can also be saved as audio (Workflows):
//   Windows: SAPI desktop voices (System.Speech) and OneCore voices (Windows.Media.SpeechSynthesis)
//   macOS:   every voice of `say` (including downloaded Siri/Enhanced/Premium voices)
//   Linux:   espeak-ng / espeak, plus SVOX Pico (pico2wave) when installed
// Their license is the operating system's: free to use on this computer.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

let cache = null

function tmp(ext) {
  return path.join(os.tmpdir(), `orbi-sys-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`)
}

function run(cmd, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err = (err + d).slice(-3000)))
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim().split('\n').pop() || `${cmd} exited with ${code}`))))
    if (input != null) p.stdin.end(input)
    else p.stdin.end()
  })
}

function has(cmd) {
  try {
    return spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { windowsHide: true }).status === 0
  } catch {
    return false
  }
}

// ---------- Windows ----------
const PS_HEADER = `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
`
const PS_LIST = PS_HEADER + `
$list = @()
try {
  Add-Type -AssemblyName System.Speech
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  foreach ($v in $s.GetInstalledVoices()) {
    if (-not $v.Enabled) { continue }
    $i = $v.VoiceInfo
    $list += [pscustomobject]@{ id = 'sapi:' + $i.Name; name = $i.Name; lang = $i.Culture.Name; gender = "$($i.Gender)"; api = 'sapi' }
  }
} catch {}
try {
  $null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
  foreach ($v in [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices) {
    $list += [pscustomobject]@{ id = 'winrt:' + $v.Id; name = $v.DisplayName; lang = $v.Language; gender = "$($v.Gender)"; api = 'winrt' }
  }
} catch {}
ConvertTo-Json -InputObject @($list) -Compress
`
// param() must be the first statement of a PowerShell script.
const PS_SAPI = `param([string]$name, [string]$textFile, [string]$out, [int]$rate)
` + PS_HEADER + `Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice($name)
$s.Rate = $rate
$s.SetOutputToWaveFile($out)
$s.Speak((Get-Content -Raw -Encoding UTF8 $textFile))
$s.Dispose()
`
const PS_WINRT = `param([string]$id, [string]$textFile, [string]$out, [double]$rate)
` + PS_HEADER + `Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait() | Out-Null; $t.Result }
$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Id -eq $id } | Select-Object -First 1
if ($voice) { $synth.Voice = $voice }
try { $synth.Options.SpeakingRate = $rate } catch {}
$text = Get-Content -Raw -Encoding UTF8 $textFile
$stream = Await ($synth.SynthesizeTextToStreamAsync($text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
$reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
$size = [uint32]$stream.Size
$null = Await ($reader.LoadAsync($size)) ([uint32])
$bytes = New-Object byte[] $size
$reader.ReadBytes($bytes)
[IO.File]::WriteAllBytes($out, $bytes)
`
function powershell(script, args = []) {
  const file = tmp('ps1')
  // A BOM makes Windows PowerShell 5.1 read the script as UTF-8.
  fs.writeFileSync(file, '\ufeff' + script, 'utf8')
  const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return run(fs.existsSync(exe) ? exe : 'powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args]).finally(() => fs.rmSync(file, { force: true }))
}

async function listWindows() {
  const raw = (await powershell(PS_LIST)).trim()
  const list = raw ? JSON.parse(raw) : []
  // The same voice can appear in both APIs; keep the OneCore copy (more natural and more languages).
  const seen = new Set()
  return list
    .sort((a, b) => (a.api === 'winrt' ? -1 : 1) - (b.api === 'winrt' ? -1 : 1))
    .filter((v) => {
      const key = v.name.replace(/^Microsoft\s+/i, '').replace(/\s+Desktop/i, '').split(' - ')[0].toLowerCase() + '|' + v.lang.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((v) => ({ id: v.id, name: v.name.replace(/^Microsoft\s+/i, ''), lang: v.lang, gender: /female/i.test(v.gender) ? 'f' : /male/i.test(v.gender) ? 'm' : '', engine: v.api === 'winrt' ? 'Windows (OneCore)' : 'Windows (SAPI)' }))
}

// ---------- macOS ----------
async function listMac() {
  const out = await run('say', ['-v', '?'])
  return out
    .split('\n')
    .map((l) => l.match(/^(.+?)\s{2,}([a-z]{2,3}[_-][A-Za-z0-9]+)\s+#/))
    .filter(Boolean)
    .map((m) => ({ id: `say:${m[1].trim()}`, name: m[1].trim(), lang: m[2].replace('_', '-'), gender: '', engine: 'macOS' }))
}

// ---------- Linux ----------
const PICO = ['en-US', 'en-GB', 'de-DE', 'es-ES', 'fr-FR', 'it-IT']
function espeakCmd() {
  return has('espeak-ng') ? 'espeak-ng' : has('espeak') ? 'espeak' : null
}
async function listLinux() {
  const list = []
  const es = espeakCmd()
  if (es) {
    const out = await run(es, ['--voices'])
    for (const l of out.split('\n').slice(1)) {
      const c = l.trim().split(/\s+/)
      if (c.length < 4) continue
      list.push({ id: `espeak:${c[1]}`, name: `${c[3].replace(/_/g, ' ')}`, lang: c[1], gender: /\/F/.test(c[2]) ? 'f' : 'm', engine: 'eSpeak NG' })
    }
  }
  if (has('pico2wave')) for (const l of PICO) list.push({ id: `pico:${l}`, name: `Pico ${l}`, lang: l, gender: 'f', engine: 'SVOX Pico' })
  return list
}

async function list({ refresh = false } = {}) {
  if (cache && !refresh) return cache
  try {
    cache = process.platform === 'win32' ? await listWindows() : process.platform === 'darwin' ? await listMac() : await listLinux()
  } catch {
    cache = []
  }
  return cache
}

// Linux without any engine: tell the user what to install.
function hint() {
  if (process.platform !== 'linux') return null
  if (espeakCmd() || has('pico2wave')) return null
  return 'sudo apt install espeak-ng'
}

async function speak({ id, text, rate = 1 }) {
  const out = tmp('wav')
  const textFile = tmp('txt')
  fs.writeFileSync(textFile, String(text).slice(0, 8000), 'utf8')
  const r = Math.max(0.5, Math.min(2, Number(rate) || 1))
  try {
    const [kind, ...rest] = String(id).split(':')
    const name = rest.join(':')
    if (kind === 'sapi') await powershell(PS_SAPI, [name, textFile, out, String(Math.round((r - 1) * 10))])
    else if (kind === 'winrt') await powershell(PS_WINRT, [name, textFile, out, String(r)])
    else if (kind === 'say') await run('say', ['-v', name, '-r', String(Math.round(180 * r)), '-o', out, '--file-format=WAVE', '--data-format=LEI16@22050', '-f', textFile])
    else if (kind === 'espeak') await run(espeakCmd() || 'espeak-ng', ['-v', name, '-s', String(Math.round(165 * r)), '-w', out, '-f', textFile])
    else if (kind === 'pico') await run('pico2wave', ['-l', name, '-w', out, fs.readFileSync(textFile, 'utf8').slice(0, 2000)])
    else throw new Error('Unknown system voice.')
    return fs.readFileSync(out)
  } finally {
    fs.rmSync(out, { force: true })
    fs.rmSync(textFile, { force: true })
  }
}

module.exports = { list, speak, hint }
