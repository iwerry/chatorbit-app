// Records the microphone and returns a 16 kHz mono 16-bit WAV (base64), the format whisper expects.
// The microphone is the one picked in the mic menu (any input the operating system offers: laptop mic, USB interface…).
import { preferredInput } from './audioDevices'

export type Recording = {
  stop: () => Promise<string>
  cancel: () => void
  /** Live level meter for the waveform (0..1 values, newest last). */
  levels: (n: number) => number[]
}

export async function startRecording(deviceId = preferredInput()): Promise<Recording> {
  const base = { channelCount: 1, echoCancellation: true, noiseSuppression: true }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { ...base, deviceId: { exact: deviceId } } : base })
  } catch (e) {
    // The saved device was unplugged: fall back to the system default.
    if (!deviceId) throw e
    stream = await navigator.mediaDevices.getUserMedia({ audio: base })
  }
  const rec = new MediaRecorder(stream)
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  rec.start(250)
  const meterCtx = new AudioContext()
  const analyser = meterCtx.createAnalyser()
  analyser.fftSize = 512
  meterCtx.createMediaStreamSource(stream).connect(analyser)
  const buf = new Uint8Array(analyser.fftSize)
  const history: number[] = []
  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(buf)
    let sum = 0
    for (const v of buf) sum += ((v - 128) / 128) ** 2
    history.push(Math.min(1, Math.sqrt(sum / buf.length) * 4))
    if (history.length > 400) history.shift()
  }, 60)
  const release = () => {
    clearInterval(timer)
    meterCtx.close().catch(() => {})
    stream.getTracks().forEach((t) => t.stop())
  }
  return {
    levels: (n) => {
      const out = history.slice(-n)
      return out.length < n ? [...Array(n - out.length).fill(0), ...out] : out
    },
    cancel: () => {
      rec.onstop = null
      if (rec.state !== 'inactive') rec.stop()
      release()
    },
    stop: () =>
      new Promise<string>((resolve, reject) => {
        rec.onstop = async () => {
          release()
          try {
            const raw = await new Blob(chunks, { type: rec.mimeType }).arrayBuffer()
            const ctx = new AudioContext()
            const decoded = await ctx.decodeAudioData(raw)
            ctx.close()
            const rate = 16000
            const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate)
            const src = off.createBufferSource()
            src.buffer = decoded
            src.connect(off.destination)
            src.start()
            const out = await off.startRendering()
            resolve(toWavBase64(out.getChannelData(0), rate))
          } catch (e) {
            reject(e)
          }
        }
        rec.stop()
      }),
  }
}

export async function recordWav(): Promise<() => Promise<string>> {
  const r = await startRecording()
  return r.stop
}

function toWavBase64(samples: Float32Array, rate: number) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const str = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  str(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true)
  const bytes = new Uint8Array(view.buffer)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
