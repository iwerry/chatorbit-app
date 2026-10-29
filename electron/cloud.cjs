// Orbi Cloud client: the signed-in account, credits and the AI gateway (chat, images, video, voice).
// The OpenRouter key lives only on the Orbi Cloud server; this app holds just the user's session token.
const DEFAULT_URL = 'http://127.0.0.1:8787'

function create({ getSetting, setSetting, encrypt, decrypt, appVersion }) {
  const url = () => String(getSetting('cloudUrl', DEFAULT_URL) || DEFAULT_URL).replace(/\/+$/, '')
  const token = () => decrypt(getSetting('cloudToken', ''))
  let lastMe = null

  async function call(path, { method, json, raw, timeout = 30000 } = {}) {
    const headers = { 'X-Orbi-Device': `Orbi desktop ${appVersion} (${process.platform})` }
    const t = token()
    if (t) headers.Authorization = `Bearer ${t}`
    if (json !== undefined) headers['Content-Type'] = 'application/json'
    let res
    try {
      res = await fetch(url() + path, { method: method || (json !== undefined ? 'POST' : 'GET'), headers, body: json !== undefined ? JSON.stringify(json) : undefined, signal: AbortSignal.timeout(timeout) })
    } catch (e) {
      const err = new Error(`Orbi Cloud is not reachable at ${url()}. Is the server running?`)
      err.code = 'offline'
      throw err
    }
    if (raw) {
      if (!res.ok) await fail(res)
      return res
    }
    const text = await res.text()
    let body = {}
    try {
      body = text ? JSON.parse(text) : {}
    } catch {
      body = { error: { message: text } }
    }
    if (!res.ok) {
      const err = new Error(body.error?.message || `Orbi Cloud error ${res.status}`)
      err.code = body.error?.code || String(res.status)
      if (res.status === 401) {
        setSetting('cloudToken', '')
        lastMe = null
      }
      throw err
    }
    return body
  }
  async function fail(res) {
    const text = await res.text().catch(() => '')
    let msg = text
    let code = String(res.status)
    try {
      const j = JSON.parse(text)
      msg = j.error?.message || msg
      code = j.error?.code || code
    } catch {
      /* text */
    }
    const err = new Error(msg || `Orbi Cloud error ${res.status}`)
    err.code = code
    throw err
  }

  const signedIn = () => !!token()

  return {
    url,
    token,
    signedIn,
    call,
    /** OpenAI-compatible provider settings used by the chat code. */
    providerConfig: () => ({ enabled: signedIn(), baseUrl: `${url()}/v1`, apiKey: token() }),

    async state() {
      const base = { url: url(), signedIn: signedIn(), user: null, payments: false, error: null, code: null }
      if (!signedIn()) {
        try {
          const h = await call('/health', { timeout: 4000 })
          return { ...base, online: true, configured: !!h.openrouter, payments: !!h.payments }
        } catch (e) {
          return { ...base, online: false, error: e.message, code: e.code }
        }
      }
      try {
        const r = await call('/me', { timeout: 8000 })
        lastMe = r.user
        return { ...base, online: true, user: r.user, payments: !!r.payments }
      } catch (e) {
        return { ...base, signedIn: signedIn(), online: e.code !== 'offline', user: lastMe, error: e.message, code: e.code }
      }
    },
    setUrl(u) {
      setSetting('cloudUrl', String(u || DEFAULT_URL).trim() || DEFAULT_URL)
      return url()
    },
    async signup(p) {
      const r = await call('/auth/signup', { json: p })
      setSetting('cloudToken', encrypt(r.token))
      lastMe = r.user
      return r.user
    },
    async login(p) {
      const r = await call('/auth/login', { json: p })
      setSetting('cloudToken', encrypt(r.token))
      lastMe = r.user
      return r.user
    },
    async logout() {
      try {
        await call('/auth/logout', { json: {} })
      } catch {
        /* offline is fine */
      }
      setSetting('cloudToken', '')
      lastMe = null
      return true
    },
    plans: () => call('/billing/plans'),
    usage: () => call('/me/usage'),
    catalog: () => call('/v1/catalog'),
    checkout: (item) => call('/billing/checkout', { json: { item } }),
    portal: () => call('/billing/portal', { json: {} }),

    async image({ model, prompt, aspect, resolution, refImages }) {
      const body = { model, prompt, aspect_ratio: aspect || undefined, resolution: resolution || undefined }
      if (refImages && refImages.length) body.input_references = refImages.map((u) => ({ type: 'image_url', image_url: { url: u } }))
      const r = await call('/v1/images', { json: body, timeout: 240000 })
      const img = r.data && r.data[0]
      if (!img) throw new Error('No image came back.')
      if (img.b64_json) return { buffer: Buffer.from(img.b64_json, 'base64'), mime: img.media_type || 'image/png' }
      if (img.url) {
        const res = await fetch(img.url)
        return { buffer: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'image/png' }
      }
      throw new Error('No image came back.')
    },

    /** Submits a video job, polls until it is ready and downloads it. */
    async video({ model, prompt, duration, resolution, aspect, frameImage, audio, signal, onStatus }) {
      const body = { model, prompt, duration: duration || undefined, resolution: resolution || undefined, aspect_ratio: aspect || undefined }
      if (typeof audio === 'boolean') body.generate_audio = audio
      if (frameImage) body.frame_images = [{ type: 'image_url', image_url: { url: frameImage }, frame_type: 'first_frame' }]
      const job = await call('/v1/videos', { json: body, timeout: 60000 })
      const started = Date.now()
      onStatus?.({ phase: 'queued', id: job.id })
      let s = job
      for (let wait = 4000; ; wait = Math.min(wait * 1.3, 15000)) {
        if (signal?.aborted) throw new Error('Stopped.')
        await new Promise((r) => setTimeout(r, wait))
        s = await call(`/v1/videos/${encodeURIComponent(job.id)}`)
        onStatus?.({ phase: s.status, id: job.id, elapsed: Date.now() - started })
        if (s.status === 'completed') break
        if (s.status === 'failed') throw new Error(typeof s.error === 'string' ? s.error : s.error?.message || 'The video failed.')
        if (Date.now() - started > 30 * 60000) throw new Error('The video took too long (30 min).')
      }
      onStatus?.({ phase: 'downloading', id: job.id })
      const res = await call(`/v1/videos/${encodeURIComponent(job.id)}/content?index=0`, { raw: true, timeout: 300000 })
      return { buffer: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'video/mp4' }
    },

    async speech({ text, model, voice, format = 'mp3' }) {
      const res = await call('/v1/audio/speech', { json: { model, input: String(text).slice(0, 4000), voice: voice || undefined, response_format: format }, raw: true, timeout: 120000 })
      return { buffer: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'audio/mpeg' }
    },

    async transcribe({ wavBase64, model, language }) {
      const r = await call('/v1/audio/transcriptions', { json: { model, input_audio: { data: wavBase64, format: 'wav' }, language: language && language !== 'auto' ? language : undefined }, timeout: 120000 })
      return String(r.text || '').trim()
    },
  }
}

module.exports = { create, DEFAULT_URL }
