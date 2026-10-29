// Orbi Cloud client (Supabase): the signed-in account, credits and the AI gateway (chat, images, video, voice).
// Sign-in uses Supabase Auth; everything else goes to the `orbi` Edge Function, which holds the OpenRouter key.
// The publishable key below is public by design: the database is protected by Row Level Security.
const SUPABASE_URL = 'https://jtdkbtszyrqogmvznrig.supabase.co'
const PUBLISHABLE_KEY = 'sb_publishable_maAtOC_F27RQbWorjmbLdQ_dADUMJWK'

function create({ getSetting, setSetting, encrypt, decrypt, appVersion }) {
  // A different backend can be set for development (settings key `cloudBackend`).
  const backend = () => {
    const b = getSetting('cloudBackend', null) || {}
    return { url: String(b.url || SUPABASE_URL).replace(/\/+$/, ''), key: b.key || PUBLISHABLE_KEY }
  }
  const fnUrl = () => `${backend().url}/functions/v1/orbi`
  let session = null // { access, expires }
  let lastMe = null

  const refreshToken = () => decrypt(getSetting('cloudRefresh', ''))
  const saveSession = (s) => {
    session = { access: s.access_token, expires: Date.now() + (Number(s.expires_in) || 3600) * 1000 }
    setSetting('cloudRefresh', encrypt(s.refresh_token))
  }
  const clear = () => {
    session = null
    lastMe = null
    setSetting('cloudRefresh', '')
  }

  async function authCall(path, body, token, method = 'POST') {
    const b = backend()
    let res
    try {
      res = await fetch(`${b.url}/auth/v1${path}`, {
        method,
        headers: { apikey: b.key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body || {}),
        signal: AbortSignal.timeout(20000),
      })
    } catch {
      const err = new Error('Orbi Cloud is not reachable. Check your internet connection.')
      err.code = 'offline'
      throw err
    }
    const text = await res.text()
    let j = {}
    try {
      j = text ? JSON.parse(text) : {}
    } catch {
      /* empty */
    }
    if (!res.ok) {
      const raw = j.msg || j.error_description || j.message || j.error || `Sign-in error ${res.status}`
      const map = {
        'Invalid login credentials': 'Wrong email or password.',
        'Email not confirmed': 'Confirm your email first: open the link we sent you.',
        'User already registered': 'An account with this email already exists. Sign in instead.',
        'Token has expired or is invalid': 'This code is wrong or has expired. Ask for a new one.',
        'New password should be different from the old password.': 'Choose a password different from the old one.',
      }
      const err = new Error(map[raw] || raw)
      err.code = j.error_code || j.code || String(res.status)
      throw err
    }
    return j
  }

  /** A valid access token, refreshing it when it is about to expire. */
  async function accessToken() {
    if (session && session.expires - Date.now() > 60000) return session.access
    const rt = refreshToken()
    if (!rt) return ''
    try {
      saveSession(await authCall('/token?grant_type=refresh_token', { refresh_token: rt }))
      return session.access
    } catch (e) {
      if (e.code !== 'offline') clear()
      throw e
    }
  }

  async function call(path, { method, json, raw, timeout = 30000 } = {}) {
    const headers = { apikey: backend().key, 'X-Orbi-Device': `Orbi desktop ${appVersion} (${process.platform})` }
    const t = await accessToken().catch(() => '')
    if (t) headers.Authorization = `Bearer ${t}`
    if (json !== undefined) headers['Content-Type'] = 'application/json'
    let res
    try {
      res = await fetch(fnUrl() + path, { method: method || (json !== undefined ? 'POST' : 'GET'), headers, body: json !== undefined ? JSON.stringify(json) : undefined, signal: AbortSignal.timeout(timeout) })
    } catch {
      const err = new Error('Orbi Cloud is not reachable. Check your internet connection.')
      err.code = 'offline'
      throw err
    }
    if (raw && res.ok) return res
    const text = await res.text()
    let body = {}
    try {
      body = text ? JSON.parse(text) : {}
    } catch {
      body = { error: { message: text } }
    }
    if (!res.ok) {
      const err = new Error(body.error?.message || body.message || `Orbi Cloud error ${res.status}`)
      err.code = body.error?.code || String(res.status)
      if (res.status === 401 && err.code === 'signed_out') clear()
      throw err
    }
    return body
  }

  const signedIn = () => !!refreshToken()

  return {
    signedIn,
    call,
    accessToken,
    /** OpenAI-compatible provider settings used by the chat code (needs a fresh token). */
    async providerConfig() {
      const t = await accessToken().catch(() => '')
      return { enabled: !!t, baseUrl: `${fnUrl()}/v1`, apiKey: t, extraHeaders: { apikey: backend().key } }
    },
    providerConfigSync: () => ({ enabled: signedIn(), baseUrl: `${fnUrl()}/v1`, apiKey: session?.access || '', extraHeaders: { apikey: backend().key } }),

    async state() {
      const base = { url: backend().url, signedIn: signedIn(), user: null, payments: false, error: null, code: null }
      if (!signedIn()) {
        try {
          const h = await call('/health', { timeout: 8000 })
          return { ...base, online: true, configured: !!h.openrouter, payments: !!h.payments }
        } catch (e) {
          return { ...base, online: e.code !== 'offline', error: e.message, code: e.code }
        }
      }
      try {
        const r = await call('/me', { timeout: 12000 })
        lastMe = r.user
        return { ...base, online: true, user: r.user, payments: !!r.payments }
      } catch (e) {
        return { ...base, signedIn: signedIn(), online: e.code !== 'offline', user: lastMe, error: e.message, code: e.code }
      }
    },
    async signup({ email, password, name }) {
      const r = await authCall(`/signup?redirect_to=${encodeURIComponent(`${fnUrl()}/auth/done`)}`, { email, password, data: { name: name || '' } })
      // With email confirmation on, there is no session until the link is opened.
      if (r.access_token) {
        saveSession(r)
        return { confirm: false }
      }
      return { confirm: true, email }
    },
    async login({ email, password }) {
      saveSession(await authCall('/token?grant_type=password', { email, password }))
      return true
    },
    resend: (email) => authCall('/resend', { type: 'signup', email }),
    /** Confirms a new account with the 6-digit code from the welcome email, and signs in. */
    async confirmSignup({ email, code }) {
      saveSession(await authCall('/verify', { type: 'signup', email, token: String(code).trim() }))
      return true
    },
    /** Password reset with the 6-digit code from the email (works without any web page). */
    recover: (email) => authCall('/recover', { email }),
    async resetPassword({ email, code, password }) {
      const s = await authCall('/verify', { type: 'recovery', email, token: String(code).trim() })
      saveSession(s)
      await authCall('/user', { password }, s.access_token, 'PUT')
      return true
    },
    async logout() {
      const t = session?.access
      clear()
      if (t) await authCall('/logout', {}, t).catch(() => {})
      return true
    },
    plans: () => call('/billing/plans'),
    usage: () => call('/me/usage'),
    catalog: () => call('/v1/catalog'),
    checkout: (item) => call('/billing/checkout', { json: { item } }),
    portal: () => call('/billing/portal', { json: {} }),
    grant: (p) => call('/admin/grant', { json: p }),
    stats: () => call('/admin/stats'),

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

module.exports = { create, SUPABASE_URL }
