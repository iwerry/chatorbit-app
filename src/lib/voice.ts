// Records the microphone and returns a 16 kHz mono 16-bit WAV (base64), the format whisper expects.
export async function recordWav(): Promise<() => Promise<string>> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  const rec = new MediaRecorder(stream)
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  rec.start(250)
  return () =>
    new Promise<string>((resolve, reject) => {
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        try {
          const buf = await new Blob(chunks, { type: rec.mimeType }).arrayBuffer()
          const ctx = new AudioContext()
          const decoded = await ctx.decodeAudioData(buf)
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
    })
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
