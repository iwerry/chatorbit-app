const { app, BrowserWindow, ipcMain, shell, safeStorage, dialog, nativeTheme, Menu } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const db = require('./db.cjs')
const ai = require('./providers.cjs')
const terminal = require('./terminal.cjs')
const websearch = require('./websearch.cjs')
const library = require('./library.cjs')
const systemVoices = require('./system-voices.cjs')
const studio = require('./studio.cjs')
const mcp = require('./mcp.cjs')
const localAI = require('./local-ai.cjs')
const updater = require('./updater.cjs')
const cloudClient = require('./cloud.cjs')
// Orbi now runs on Orbi Cloud (market models through OpenRouter). Local engines and personal API keys stay in the code but are hidden.
const CLOUD_ONLY = true

const isDev = !!process.env.ORBI_DEV_URL
let win = null
const windows = new Set()
const controllers = new Map()
const approvals = new Map()
let currentSender = null

function broadcast(channel, ...args) {
  for (const w of windows) if (!w.isDestroyed()) w.webContents.send(channel, ...args)
}

function mediaDir() {
  const dir = path.join(app.getPath('userData'), 'media')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// ---------- settings & secrets ----------
function getSetting(key, fallback = null) {
  const row = db.get('SELECT value FROM settings WHERE key = ?', [key])
  if (!row) return fallback
  try {
    return JSON.parse(row.value)
  } catch {
    return fallback
  }
}
function setSetting(key, value) {
  db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)])
}
function encrypt(s) {
  if (!s) return ''
  return safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(s).toString('base64') : 'raw:' + Buffer.from(s).toString('base64')
}
function decrypt(s) {
  if (!s) return ''
  try {
    if (s.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64'))
    if (s.startsWith('raw:')) return Buffer.from(s.slice(4), 'base64').toString()
  } catch {
    return ''
  }
  return ''
}
let cloud = null
const cloudApi = () => (cloud ||= cloudClient.create({ getSetting, setSetting, encrypt, decrypt, appVersion: app.getVersion() }))
function providerConfig(id) {
  if (id === 'orbicloud') return cloudApi().providerConfigSync()
  if (id === 'orbi') {
    const st = localAI.status()
    return { enabled: st.engineInstalled && st.models.some((m) => m.installed), baseUrl: st.running ? `http://127.0.0.1:${st.running.port}/v1` : '', apiKey: '' }
  }
  const c = getSetting(`provider:${id}`, {})
  return { enabled: !!c.enabled, baseUrl: c.baseUrl || '', apiKey: decrypt(c.apiKey) }
}

// ---------- media ----------
function mediaRow(r) {
  return { ...r, url: pathToFileURL(path.join(mediaDir(), r.file)).href }
}
function saveMedia({ buffer, mime, kind, name, prompt, model, source, board, params }) {
  const id = db.uid()
  const ext = (mime.split('/')[1] || 'png').replace('jpeg', 'jpg').split('+')[0]
  const file = `${id}.${ext}`
  fs.writeFileSync(path.join(mediaDir(), file), buffer)
  const row = { id, kind, name: name || `${kind}-${id}.${ext}`, file, prompt: prompt || '', model: model || '', source: source || '', created_at: Date.now() }
  row.board = board || ''
  row.params = params ? JSON.stringify(params) : ''
  db.run('INSERT INTO media (id, kind, name, file, prompt, model, source, created_at, board, params) VALUES (?,?,?,?,?,?,?,?,?,?)', [row.id, row.kind, row.name, row.file, row.prompt, row.model, row.source, row.created_at, row.board, row.params])
  return mediaRow(row)
}

async function complete({ providerId, model, system, prompt, maxTokens, timeout = 180000 }) {
  let text = ''
  await ai.streamChat(
    { providerId, model, thinking: false, maxTokens, system: system || 'You are a helpful creative assistant.', messages: [{ role: 'user', content: String(prompt || '') }] },
    await configFor(providerId, model),
    (d) => (text += d.text || ''),
    AbortSignal.timeout(timeout),
  )
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
}

// Skills rows carry their support files, tests and metadata as JSON.
function skillRow(r) {
  if (!r) return r
  const j = (v, d) => {
    try {
      return v ? JSON.parse(v) : d
    } catch {
      return d
    }
  }
  return { ...r, files: j(r.files, []), tests: j(r.tests, {}), meta: j(r.meta, {}) }
}
function skillDoc(r) {
  const k = skillRow(r)
  return { name: k.name, description: k.description || '', body: k.instructions, files: k.files, tests: k.tests, license: k.meta.license, version: k.meta.version, compatibility: k.meta.compatibility, author: k.meta.author, audit: k.meta.audit }
}

// ---------- IPC API ----------
const api = {
  'app:info': () => ({
    version: app.getVersion(),
    platform: process.platform,
    userName: getSetting('userName') || os.userInfo().username || 'there',
    dataDir: app.getPath('userData'),
    author: 'Daniel Rodrigues',
    company: 'Draft Creative Studio Ltda',
    tagline: 'Creative Design & Software Development',
  }),
  'settings:get': (key, fallback) => getSetting(key, fallback),
  'settings:set': (key, value) => setSetting(key, value),

  'providers:list': () =>
    ai.PROVIDERS.map((p) => {
      const c = providerConfig(p.id)
      return { ...p, enabled: c.enabled, customBaseUrl: c.baseUrl, hasKey: !!c.apiKey }
    }),
  'providers:save': (id, patch) => {
    const cur = getSetting(`provider:${id}`, {})
    const next = { ...cur, ...patch }
    if ('apiKey' in patch) next.apiKey = encrypt(patch.apiKey)
    setSetting(`provider:${id}`, next)
    return true
  },
  'providers:test': async (id) => {
    if (id === 'orbi') return { ok: true, count: localAI.installedModels('text').length }
    const models = await ai.listModels(id, providerConfig(id))
    return { ok: true, count: models.length }
  },
  'models:list': async () => {
    const out = []
    const errors = []
    await Promise.all(
      ai.PROVIDERS.filter((p) => !CLOUD_ONLY || p.id === 'orbicloud').map(async (p) => {
        const c = p.id === 'orbicloud' ? await cloudApi().providerConfig() : providerConfig(p.id)
        if (!c.enabled) return
        try {
          const models = p.id === 'orbi' ? localAI.installedModels('text') : await ai.listModels(p.id, c)
          for (const m of models) out.push({ ...m, provider: p.id, providerName: p.name, mode: p.mode, key: `${p.id}::${m.id}` })
        } catch (e) {
          errors.push({ provider: p.name, message: String(e.message || e) })
        }
      }),
    )
    return { models: out, errors }
  },

  'chat:send': async (reqId, payload) => {
    const sender = currentSender
    // The end of a stream travels on the same channel as its deltas, so it can never overtake them.
    const done = (result) => {
      if (!sender.isDestroyed()) sender.send('chat:delta', reqId, { done: result })
      return result
    }
    const controller = new AbortController()
    controllers.set(reqId, controller)
    try {
      const cfg = await configFor(payload.providerId, payload.model)
      const useTools = payload.useTools !== false && payload.providerId !== 'orbi' && getSetting('toolsEnabled', true)
      const tools = useTools ? mcp.toolsForChat(payload.toolServers && payload.toolServers.length ? payload.toolServers : null) : []
      // Progressive disclosure: the model sees only skill names + descriptions and loads a skill's body
      // (level 2) or one of its support files (level 3) when it decides the skill applies.
      const catalog = useTools && Array.isArray(payload.skillCatalog) ? payload.skillCatalog : []
      if (catalog.length)
        tools.push(
          { name: 'orbi-skills__load_skill', description: 'Load the full instructions of one of the available skills before using it. Call it as soon as a skill matches the request.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Skill name exactly as listed' } }, required: ['name'] } },
          { name: 'orbi-skills__read_skill_file', description: 'Read a support file of a loaded skill (references/, scripts/, assets/) when its instructions say so.', parameters: { type: 'object', properties: { name: { type: 'string' }, path: { type: 'string', description: 'Relative path such as references/style.md' } }, required: ['name', 'path'] } },
        )
      const limit = Number(payload.compactToolOutput) || 0
      const compact = (r) => {
        if (!limit) return r
        const text = typeof r === 'string' ? r : JSON.stringify(r)
        return text.length > limit ? text.slice(0, limit) + `\n[… ${text.length - limit} more characters cut by the harness]` : r
      }
      const callSkillTool = (name, args) => {
        const row = db.all('SELECT * FROM skills').find((k) => catalog.includes(k.id) && (k.name === args.name || k.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') === String(args.name || '').toLowerCase()))
        if (!row) return { error: `Unknown skill: ${args.name}. Available: ${db.all('SELECT name FROM skills').filter((k) => k).map((k) => k.name).join(', ')}` }
        const k = skillRow(row)
        if (name.endsWith('load_skill')) return { name: k.name, instructions: k.instructions, files: k.files.map((f) => f.path) }
        const f = k.files.find((x) => x.path === args.path)
        return f ? { path: f.path, content: f.content } : { error: `No file ${args.path} in ${k.name}. Files: ${k.files.map((x) => x.path).join(', ') || 'none'}` }
      }
      const toolkit = tools.length ? { tools, call: async (name, args) => compact(name.startsWith('orbi-skills__') ? callSkillTool(name, args || {}) : await mcp.callTool(name, args, sender)) } : null
      await ai.streamChat(payload, cfg, (delta) => !sender.isDestroyed() && sender.send('chat:delta', reqId, delta), controller.signal, toolkit)
      return done({ ok: true })
    } catch (e) {
      if (controller.signal.aborted) return done({ ok: true, aborted: true })
      return done({ ok: false, error: String(e.message || e) })
    } finally {
      controllers.delete(reqId)
    }
  },
  'chat:abort': (reqId) => controllers.get(reqId)?.abort(),
  // One-shot completion used by workflow nodes.
  'ai:complete': (p) => complete(p),
  // Text to speech for workflow voiceover nodes (OpenAI key required).
  'ai:speech': async ({ text, voice, model }) => {
    if (CLOUD_ONLY) {
      const pref = getSetting('cloudVoice', {})
      const m = model || pref.model || 'openai/gpt-4o-mini-tts-2025-12-15'
      const { buffer, mime } = await cloudApi().speech({ text, model: m, voice: voice || pref.voice || 'alloy' })
      return saveMedia({ buffer, mime, kind: 'audio', name: `voiceover-${Date.now()}.mp3`, prompt: String(text).slice(0, 300), model: m, source: 'creative' })
    }
    const cfg = providerConfig('openai')
    if (!cfg.apiKey) throw new Error('Voiceover needs an OpenAI key (Settings → AI providers).')
    const res = await fetch(`${(cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: voice || 'alloy', input: String(text).slice(0, 4000), response_format: 'mp3' }),
    })
    if (!res.ok) throw new Error(`Voiceover failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    return saveMedia({ buffer, mime: 'audio/mpeg', kind: 'audio', name: `voiceover-${Date.now()}.mp3`, prompt: String(text).slice(0, 300), model: 'OpenAI TTS', source: 'creative' })
  },
  'chat:title': async (payload) => {
    try {
      let text = ''
      await ai.streamChat(
        {
          ...payload,
          thinking: false,
          system: 'Write a short title (max 6 words) for this conversation. Reply with the title only, no quotes, same language as the user.',
        },
        await configFor(payload.providerId, payload.model),
        (d) => (text += d.text || ''),
        AbortSignal.timeout(20000),
      )
      return text.replace(/["'*#\n]/g, '').trim().slice(0, 60)
    } catch {
      return ''
    }
  },

  // conversations & messages
  'projects:list': () => db.all('SELECT * FROM projects ORDER BY created_at DESC'),
  'projects:create': (name) => {
    const row = { id: db.uid(), name, created_at: Date.now() }
    db.run('INSERT INTO projects (id, name, created_at) VALUES (?,?,?)', [row.id, row.name, row.created_at])
    return row
  },
  'projects:delete': (id) => {
    db.run('UPDATE conversations SET project_id = NULL WHERE project_id = ?', [id])
    db.run('DELETE FROM projects WHERE id = ?', [id])
  },
  'conversations:list': () => db.all('SELECT * FROM conversations ORDER BY updated_at DESC'),
  'conversations:create': (c) => {
    const now = Date.now()
    const row = { id: db.uid(), title: c.title || 'New chat', project_id: c.project_id || null, pinned: 0, model: c.model || '', created_at: now, updated_at: now }
    db.run('INSERT INTO conversations (id, title, project_id, pinned, model, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', [row.id, row.title, row.project_id, 0, row.model, now, now])
    return row
  },
  'conversations:update': (id, patch) => {
    const allowed = ['title', 'project_id', 'pinned', 'model', 'updated_at']
    for (const [k, v] of Object.entries(patch)) if (allowed.includes(k)) db.run(`UPDATE conversations SET ${k} = ? WHERE id = ?`, [v, id])
  },
  'conversations:delete': (id) => {
    db.run('DELETE FROM messages WHERE conversation_id = ?', [id])
    db.run('DELETE FROM conversations WHERE id = ?', [id])
  },
  'messages:list': (conversationId) => db.all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC', [conversationId]),
  'messages:add': (m) => {
    const row = { id: m.id || db.uid(), created_at: m.created_at || Date.now(), model: m.model || '', attachments: JSON.stringify(m.attachments || []), bookmarked: 0, ...m }
    db.run('INSERT INTO messages (id, conversation_id, role, content, model, attachments, bookmarked, created_at, tools) VALUES (?,?,?,?,?,?,?,?,?)', [
      row.id, row.conversation_id, row.role, row.content, row.model, typeof row.attachments === 'string' ? row.attachments : JSON.stringify(row.attachments), 0, row.created_at,
      typeof m.tools === 'string' ? m.tools : JSON.stringify(m.tools || []),
    ])
    db.run('UPDATE conversations SET updated_at = ? WHERE id = ?', [Date.now(), row.conversation_id])
    return row
  },
  'messages:delete': (id) => db.run('DELETE FROM messages WHERE id = ?', [id]),
  'messages:update': (id, p = {}) => {
    if (typeof p.content === 'string') db.run('UPDATE messages SET content = ? WHERE id = ?', [p.content, id])
    return true
  },
  'messages:bookmark': (id, value) => db.run('UPDATE messages SET bookmarked = ? WHERE id = ?', [value ? 1 : 0, id]),
  'bookmarks:list': () =>
    db.all('SELECT m.*, c.title AS conversation_title FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.bookmarked = 1 ORDER BY m.created_at DESC'),

  // memory & agents
  'memories:list': () => db.all('SELECT * FROM memories ORDER BY created_at DESC'),
  'memories:add': (content) => {
    const row = { id: db.uid(), content, created_at: Date.now() }
    db.run('INSERT INTO memories (id, content, created_at) VALUES (?,?,?)', [row.id, row.content, row.created_at])
    return row
  },
  'memories:delete': (id) => db.run('DELETE FROM memories WHERE id = ?', [id]),
  'agents:list': () => db.all('SELECT * FROM agents ORDER BY created_at ASC'),
  'agents:save': (a) => {
    const handle = '@' + String(a.name || a.handle || 'agent').trim().toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '')
    const vals = [
      handle, a.name || handle.slice(1), a.description || '', a.model || '', a.category || 'General', a.instructions || '',
      JSON.stringify(a.tools || []), a.skills_mode || 'off', JSON.stringify(a.skills || []), JSON.stringify(a.starters || []),
      a.support_name || '', a.support_email || '', a.color || '',
    ]
    const cols = 'handle = ?, name = ?, description = ?, model = ?, category = ?, instructions = ?, tools = ?, skills_mode = ?, skills = ?, starters = ?, support_name = ?, support_email = ?, color = ?'
    if (a.id) db.run(`UPDATE agents SET ${cols} WHERE id = ?`, [...vals, a.id])
    else {
      const id = db.uid()
      db.run('INSERT INTO agents (id, handle, instructions, created_at) VALUES (?,?,?,?)', [id, handle, a.instructions || '', Date.now()])
      db.run(`UPDATE agents SET ${cols} WHERE id = ?`, [...vals, id])
      return id
    }
    return a.id
  },
  'agents:delete': (id) => db.run('DELETE FROM agents WHERE id = ?', [id]),

  // media
  'media:list': () => db.all('SELECT * FROM media ORDER BY created_at DESC').map(mediaRow),
  'media:delete': (id) => {
    const r = db.get('SELECT * FROM media WHERE id = ?', [id])
    if (r) fs.rmSync(path.join(mediaDir(), r.file), { force: true })
    db.run('DELETE FROM media WHERE id = ?', [id])
  },
  'media:open': (id) => {
    const r = db.get('SELECT * FROM media WHERE id = ?', [id])
    if (r) shell.openPath(path.join(mediaDir(), r.file))
  },
  'media:reveal': (id) => {
    const r = db.get('SELECT * FROM media WHERE id = ?', [id])
    if (r) shell.showItemInFolder(path.join(mediaDir(), r.file))
  },
  'media:saveAs': async (id) => {
    const r = db.get('SELECT * FROM media WHERE id = ?', [id])
    if (!r) return false
    const res = await dialog.showSaveDialog(win, { defaultPath: r.name })
    if (res.canceled || !res.filePath) return false
    fs.copyFileSync(path.join(mediaDir(), r.file), res.filePath)
    return true
  },
  'media:import': (file) => {
    const [, mime, data] = file.dataUrl.match(/^data:([^;]+);base64,(.*)$/) || []
    if (!data) return null
    const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'file'
    return saveMedia({ buffer: Buffer.from(data, 'base64'), mime, kind, name: file.name, source: 'upload' })
  },
  'image:generate': async (payload) => {
    const { buffer, mime } =
      payload.providerId === 'orbicloud'
        ? await cloudApi().image({ model: payload.model, prompt: payload.prompt, aspect: aspectOf(payload.width, payload.height), resolution: payload.resolution, refImages: payload.refImages })
        : await ai.generateImage(payload, providerConfig(payload.providerId))
    const short = payload.prompt.slice(0, 40).replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'image'
    return saveMedia({ buffer, mime, kind: 'image', name: `${short}.${mime.includes('jpeg') ? 'jpg' : 'png'}`, prompt: payload.prompt, model: payload.model, source: payload.source || 'creative', board: payload.board, params: { width: payload.width, height: payload.height } })
  },
  // Local image / video generation with stable-diffusion.cpp
  'local:generate': async (payload) => {
    const sender = currentSender
    const tmp = []
    const writeTemp = (dataUrl, name) => {
      const [, , data] = dataUrl.match(/^data:([^;]+);base64,(.*)$/) || []
      if (!data) return null
      const f = path.join(os.tmpdir(), `orbi-${Date.now()}-${name}.png`)
      fs.writeFileSync(f, Buffer.from(data, 'base64'))
      tmp.push(f)
      return f
    }
    try {
      const { buffer, mime, model } = await localAI.generateMedia(
        {
          ...payload,
          initImage: payload.initImage && writeTemp(payload.initImage, 'init'),
          mask: payload.mask && writeTemp(payload.mask, 'mask'),
          endImage: payload.endImage && writeTemp(payload.endImage, 'end'),
          refImages: (payload.refImages || []).map((r, i) => writeTemp(r, `ref${i}`)).filter(Boolean),
        },
        (p) => !sender.isDestroyed() && sender.send('local:progress', p),
      )
      const kind = mime.startsWith('video') ? 'video' : 'image'
      const short = payload.prompt.slice(0, 40).replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || kind
      return saveMedia({ buffer, mime, kind, name: `${short}.${kind === 'video' ? 'webm' : 'png'}`, prompt: payload.prompt, model, source: payload.source || 'creative', board: payload.board, params: { width: payload.width, height: payload.height, steps: payload.steps, seed: payload.seed, negative: payload.negative || undefined } })
    } finally {
      for (const f of tmp) fs.rmSync(f, { force: true })
    }
  },
  'local:cancelGenerate': (jobId) => localAI.cancelMedia(jobId),
  'local:upscale': async ({ mediaId, modelId, jobId, board }) => {
    const sender = currentSender
    const r = db.get('SELECT * FROM media WHERE id = ?', [mediaId])
    if (!r) throw new Error('Image not found.')
    const { buffer, mime, model } = await localAI.upscaleImage({ modelId, inputPath: path.join(mediaDir(), r.file), jobId }, (p) => !sender.isDestroyed() && sender.send('local:progress', p))
    return saveMedia({ buffer, mime, kind: 'image', name: `${path.basename(r.name, path.extname(r.name))}-4x.png`, prompt: r.prompt, model, source: 'creative', board: board ?? r.board })
  },
  'media:dataUrl': (id) => {
    const r = db.get('SELECT * FROM media WHERE id = ?', [id])
    if (!r) return null
    const buf = fs.readFileSync(path.join(mediaDir(), r.file))
    const ext = path.extname(r.file).slice(1).toLowerCase()
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', webm: 'video/webm', mp4: 'video/mp4' }[ext] || 'application/octet-stream'
    return `data:${mime};base64,${buf.toString('base64')}`
  },
  'media:saveCanvas': (dataUrl, meta = {}) => {
    const [, mime, data] = dataUrl.match(/^data:([^;]+);base64,(.*)$/) || []
    if (!data) return null
    return saveMedia({ buffer: Buffer.from(data, 'base64'), mime, kind: 'image', name: meta.name || 'canvas.png', source: 'canvas', board: meta.board, prompt: meta.prompt || '' })
  },
  'media:setBoard': (id, board) => db.run('UPDATE media SET board = ? WHERE id = ?', [board || '', id]),
  'boards:list': () => db.all('SELECT * FROM boards ORDER BY created_at ASC'),
  'boards:create': (name) => {
    const row = { id: db.uid(), name, created_at: Date.now() }
    db.run('INSERT INTO boards (id, name, created_at) VALUES (?,?,?)', [row.id, row.name, row.created_at])
    return row
  },
  'boards:rename': (id, name) => db.run('UPDATE boards SET name = ? WHERE id = ?', [name, id]),
  'boards:delete': (id) => {
    db.run("UPDATE media SET board = '' WHERE board = ?", [id])
    db.run('DELETE FROM boards WHERE id = ?', [id])
  },

  // ---------- web search ----------
  // ---------- Orbi Cloud account ----------
  'cloud:state': () => cloudApi().state(),
  'cloud:resend': (email) => cloudApi().resend(email),
  'cloud:recover': (email) => cloudApi().recover(email),
  'cloud:confirmSignup': (p) => cloudApi().confirmSignup(p),
  'cloud:resetPassword': (p) => cloudApi().resetPassword(p),
  'cloud:grant': (p) => cloudApi().grant(p),
  'cloud:stats': () => cloudApi().stats(),
  'cloud:signup': (p) => cloudApi().signup(p),
  'cloud:login': (p) => cloudApi().login(p),
  'cloud:logout': () => cloudApi().logout(),
  'cloud:plans': () => cloudApi().plans(),
  'cloud:usage': () => cloudApi().usage(),
  'cloud:catalog': () => cloudApi().catalog(),
  'cloud:checkout': async (item) => {
    const r = await cloudApi().checkout(item)
    if (r.url) shell.openExternal(r.url)
    return r
  },
  'cloud:portal': async () => {
    const r = await cloudApi().portal()
    if (r.url) shell.openExternal(r.url)
    return r
  },
  // Read-aloud: returns playable audio without saving it to the library.
  'cloud:speak': async ({ text, model, voice }) => {
    const pref = getSetting('cloudVoice', {})
    const { buffer, mime } = await cloudApi().speech({ text, model: model || pref.model || 'openai/gpt-4o-mini-tts-2025-12-15', voice: voice || pref.voice || 'alloy' })
    return `data:${mime};base64,${buffer.toString('base64')}`
  },
  'cloud:video': async (p) => {
    const sender = currentSender
    const controller = new AbortController()
    if (p.jobId) cloudVideoJobs.set(p.jobId, controller)
    try {
      const { buffer, mime } = await cloudApi().video({
        ...p,
        signal: controller.signal,
        onStatus: (s) => p.jobId && !sender.isDestroyed() && sender.send('local:progress', { jobId: p.jobId, step: 0, total: 0, phase: s.phase === 'completed' || s.phase === 'downloading' ? 'decoding' : s.phase === 'in_progress' ? 'cloud' : 'queued', elapsed: s.elapsed }),
      })
      const short = String(p.prompt || '').slice(0, 40).replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'video'
      return saveMedia({ buffer, mime, kind: 'video', name: `${short}.mp4`, prompt: p.prompt, model: p.model, source: p.source || 'creative', board: p.board, params: { duration: p.duration, resolution: p.resolution, aspect: p.aspect, negative: p.negative || undefined } })
    } finally {
      if (p.jobId) cloudVideoJobs.delete(p.jobId)
    }
  },
  'cloud:cancelVideo': (jobId) => cloudVideoJobs.get(jobId)?.abort(),

  'web:search': async (q, opts = {}) => {
    const r = await websearch.search(q, { lang: getSetting('language', 'en'), read: opts.read ?? 3 })
    return { ...r, context: websearch.toContext(r) }
  },

  // ---------- voice ----------
  'voice:transcribe': async ({ wav, mode, language }) => {
    if (CLOUD_ONLY || mode?.type === 'cloud') return cloudApi().transcribe({ wavBase64: wav, model: mode?.model || getSetting('cloudStt', '') || 'openai/gpt-4o-mini-transcribe', language })
    const buf = Buffer.from(wav, 'base64')
    if (mode?.type === 'local') {
      const f = path.join(os.tmpdir(), `orbi-voice-${Date.now()}.wav`)
      fs.writeFileSync(f, buf)
      try {
        return await localAI.transcribe({ wavPath: f, modelId: mode.modelId, language: language || 'auto' })
      } finally {
        fs.rmSync(f, { force: true })
      }
    }
    const providerId = mode?.provider || 'openai'
    const cfg = providerConfig(providerId)
    if (!cfg.apiKey) throw new Error(`Add your ${providerId === 'groq' ? 'Groq' : 'OpenAI'} API key in Settings → AI providers.`)
    const p = ai.PROVIDERS.find((x) => x.id === providerId)
    const form = new FormData()
    form.append('file', new Blob([buf], { type: 'audio/wav' }), 'speech.wav')
    form.append('model', providerId === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1')
    if (language && language !== 'auto') form.append('language', language)
    const res = await fetch(`${(cfg.baseUrl || p.baseUrl).replace(/\/+$/, '')}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${cfg.apiKey}` }, body: form })
    if (!res.ok) throw new Error(`Transcription failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
    return String((await res.json()).text || '').trim()
  },

  // ---------- profession library ----------
  'library:get': () => {
    const installedSkills = new Set(db.all('SELECT library_id, name FROM skills').flatMap((r) => [r.library_id, r.name]).filter(Boolean))
    const installedAgents = new Set(db.all('SELECT handle FROM agents').map((r) => r.handle))
    return {
      professions: library.PROFESSIONS,
      skills: library.topSkills((k) => installedSkills.has(k.id) || installedSkills.has(k.name)).map((k) => ({ ...k, installed: installedSkills.has(k.id) || installedSkills.has(k.name) })),
      agents: library.topAgents((a) => installedAgents.has(a.handle)).map((a) => ({ ...a, installed: installedAgents.has(a.handle) })),
      links: library.LINKS,
      directories: library.DIRECTORIES,
      kits: library.KITS.map((k) => ({ ...k, installed: k.skills.every((s) => installedSkills.has(s)) && k.agents.every((a) => installedAgents.has(library.AGENTS.find((x) => x.id === a)?.handle)) })),
    }
  },
  'library:installSkill': (id) => installLibrarySkill(id),
  'library:installAgent': (id) => installLibraryAgent(id),
  'library:installKit': async (id) => {
    const kit = library.KITS.find((k) => k.id === id)
    if (!kit) return false
    kit.skills.forEach(installLibrarySkill)
    kit.agents.forEach(installLibraryAgent)
    for (const sid of kit.servers) {
      const srv = mcp.servers().find((x) => x.id === sid)
      if (srv && !srv.enabled) await mcp.saveServer({ ...srv, enabled: true })
      const cat = !srv && mcp.CATALOG.find((x) => x.id === sid)
      if (cat && !Object.values(cat.env || {}).some((v) => String(v).includes('<'))) await mcp.saveServer({ ...cat, enabled: true })
    }
    broadcast('data:changed', 'all')
    return true
  },

  // ---------- InvokeAI (optional external engine) ----------


  // workflows (Creative)
  'workflows:get': (id) => {
    const r = db.get('SELECT * FROM workflows WHERE id = ?', [id])
    return r ? JSON.parse(r.data) : null
  },
  'workflows:save': (id, name, data) => {
    db.run('INSERT INTO workflows (id, name, data, updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = excluded.updated_at', [
      id, name, JSON.stringify(data), Date.now(),
    ])
  },

  // ---------- skills ----------
  'skills:list': () => db.all('SELECT * FROM skills ORDER BY created_at ASC').map(skillRow),
  'skills:save': (k) => {
    const extra = [JSON.stringify(k.files || []), JSON.stringify(k.tests || {}), JSON.stringify(k.meta || {})]
    if (k.id) {
      db.run('UPDATE skills SET name = ?, description = ?, instructions = ?, files = ?, tests = ?, meta = ? WHERE id = ?', [k.name, k.description || '', k.instructions, ...extra, k.id])
      return k.id
    }
    const id = db.uid()
    db.run('INSERT INTO skills (id, name, description, instructions, enabled, created_at, files, tests, meta) VALUES (?,?,?,?,?,?,?,?,?)', [id, k.name, k.description || '', k.instructions, 1, Date.now(), ...extra])
    return id
  },

  // ---------- Creator Studio (SKILLSMITH brain) ----------
  'studio:ask': async ({ kind, brief, providerId, model }) => studio.parseJson(await complete({ providerId, model, ...studio.questionsPrompt(kind, brief), maxTokens: 2000 })),
  'studio:build': async ({ kind, brief, answers, current, providerId, model }) => {
    const out = studio.parseJson(await complete({ providerId, model, ...studio.buildPrompt(kind, brief, answers, current), maxTokens: 16000, timeout: 420000 }))
    if (kind === 'skill') {
      out.name = String(out.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
      out.files = Array.isArray(out.files) ? out.files.filter((f) => f && f.path && typeof f.content === 'string') : []
      return { item: out, validation: studio.validate(out), audit: studio.audit(out) }
    }
    return { item: out }
  },
  'studio:check': (doc) => ({ validation: studio.validate(doc), audit: studio.audit(doc) }),
  'studio:exportSkill': async (doc) => {
    const r = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow(), { defaultPath: `${doc.name || 'skill'}.zip`, filters: [{ name: 'Agent Skill', extensions: ['zip'] }] })
    if (r.canceled || !r.filePath) return null
    fs.writeFileSync(r.filePath, studio.exportZip(doc, getSetting('userName') || os.userInfo().username))
    shell.showItemInFolder(r.filePath)
    return r.filePath
  },
  'studio:skillMd': (doc) => studio.toSkillMd(doc, getSetting('userName') || 'Orbi user'),
  'studio:importSkill': async () => {
    const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), { properties: ['openFile'], filters: [{ name: 'Agent Skill', extensions: ['zip', 'md', 'skill'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    const file = r.filePaths[0]
    if (/\.md$/i.test(file)) {
      const { meta, body } = studio.fromSkillMd(fs.readFileSync(file, 'utf8'))
      return { name: String(meta.name || path.basename(path.dirname(file))), description: String(meta.description || ''), license: String(meta.license || ''), version: String(meta.metadata?.version || '1.0.0'), author: String(meta.metadata?.author || ''), body, files: [] }
    }
    return studio.importZip(fs.readFileSync(file))
  },

  // Download agents, teams or harnesses (with the agents and skills they use) as one ZIP.
  'studio:exportBundle': async ({ kind, ids }) => {
    const pick = (rows) => (ids && ids.length ? rows.filter((r) => ids.includes(r.id)) : rows)
    const allAgents = db.all('SELECT * FROM agents ORDER BY created_at ASC')
    const allSkills = db.all('SELECT * FROM skills ORDER BY created_at ASC')
    const out = { agents: [], teams: [], harnesses: [], skills: [] }
    const addAgent = (handle) => {
      const a = allAgents.find((x) => x.handle === handle || x.handle === '@' + String(handle).replace(/^@/, ''))
      if (a && !out.agents.includes(a)) out.agents.push(a)
    }
    if (kind === 'agent') out.agents = pick(allAgents)
    if (kind === 'team') {
      out.teams = pick(db.all('SELECT * FROM teams ORDER BY created_at ASC'))
      for (const t of out.teams) for (const m of JSON.parse(t.members || '[]')) if (m.agent) addAgent(m.agent)
    }
    if (kind === 'harness') {
      out.harnesses = pick(db.all('SELECT * FROM harnesses ORDER BY created_at ASC'))
      for (const h of out.harnesses) for (const a of JSON.parse(h.config || '{}').agents || []) addAgent(a)
    }
    if (kind === 'skill') out.skills = pick(allSkills).map(skillDoc)
    const names = new Set()
    for (const a of out.agents) {
      if (a.skills_mode === 'all') allSkills.filter((k) => k.enabled).forEach((k) => names.add(k.name))
      if (a.skills_mode === 'selected') JSON.parse(a.skills || '[]').forEach((n) => names.add(n))
    }
    for (const h of out.harnesses) for (const n of JSON.parse(h.config || '{}').skills || []) names.add(n)
    for (const k of allSkills) if (names.has(k.name) && !out.skills.some((x) => x.name === k.name)) out.skills.push(skillDoc(k))
    const first = out.agents[0] || out.teams[0] || out.harnesses[0] || out.skills[0]
    if (!first) throw new Error('Nothing to download yet.')
    const single = (ids && ids.length === 1) || (kind === 'agent' ? out.agents.length : kind === 'team' ? out.teams.length : kind === 'harness' ? out.harnesses.length : out.skills.length) === 1
    const title = single ? `${kind}-${String(first.handle || first.name || kind).replace(/^@/, '')}` : `orbi-${kind}s`
    const r = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow(), { defaultPath: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.zip`, filters: [{ name: 'Orbi bundle', extensions: ['zip'] }] })
    if (r.canceled || !r.filePath) return null
    fs.writeFileSync(r.filePath, studio.exportBundle({ ...out, title, author: getSetting('userName') || os.userInfo().username }))
    shell.showItemInFolder(r.filePath)
    return r.filePath
  },
  // Import an Orbi bundle ZIP (agents, teams, harnesses and their skills) or a single skill.
  'studio:importBundle': async () => {
    const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), { properties: ['openFile'], filters: [{ name: 'Orbi bundle or Agent Skill', extensions: ['zip', 'md', 'skill', 'json'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    const file = r.filePaths[0]
    const buf = fs.readFileSync(file)
    let b = null
    if (/\.json$/i.test(file)) {
      const j = JSON.parse(buf.toString('utf8'))
      if (j.orbi === 'bundle') b = j
    } else if (/\.(zip|skill)$/i.test(file)) b = studio.importBundle(buf)
    if (!b) {
      const doc = /\.md$/i.test(file)
        ? (() => {
            const { meta, body } = studio.fromSkillMd(buf.toString('utf8'))
            return { name: String(meta.name || 'imported-skill'), description: String(meta.description || ''), body, files: [], license: String(meta.license || ''), version: String(meta.metadata?.version || '1.0.0'), author: String(meta.metadata?.author || '') }
          })()
        : studio.importZip(buf)
      b = { agents: [], teams: [], harnesses: [], skills: [doc] }
    }
    const counts = { agents: 0, teams: 0, harnesses: 0, skills: 0 }
    const existingSkills = db.all('SELECT * FROM skills')
    for (const k of b.skills || []) {
      const hit = existingSkills.find((x) => x.name === k.name)
      api['skills:save']({ id: hit?.id, name: k.name, description: k.description, instructions: k.body ?? k.instructions ?? '', files: k.files, tests: k.tests, meta: { license: k.license, version: k.version, compatibility: k.compatibility, author: k.author } })
      counts.skills++
    }
    const handles = new Set(db.all('SELECT handle FROM agents').map((x) => x.handle))
    for (const a of b.agents || []) {
      if (handles.has(a.handle)) continue
      api['agents:save']({ ...a, id: undefined, tools: JSON.parse(typeof a.tools === 'string' ? a.tools || '[]' : JSON.stringify(a.tools || [])), skills: JSON.parse(typeof a.skills === 'string' ? a.skills || '[]' : JSON.stringify(a.skills || [])), starters: JSON.parse(typeof a.starters === 'string' ? a.starters || '[]' : JSON.stringify(a.starters || [])) })
      counts.agents++
    }
    for (const t of b.teams || []) {
      api['teams:save']({ ...t, id: undefined, members: typeof t.members === 'string' ? JSON.parse(t.members || '[]') : t.members })
      counts.teams++
    }
    for (const h of b.harnesses || []) {
      api['harness:save']({ ...h, id: undefined, config: typeof h.config === 'string' ? JSON.parse(h.config || '{}') : h.config })
      counts.harnesses++
    }
    broadcast('data:changed', 'studio')
    return counts
  },

  // ---------- multi-agent teams and harnesses ----------
  'teams:list': () => db.all('SELECT * FROM teams ORDER BY created_at ASC'),
  'teams:save': (t) => {
    const handle = '@' + String(t.handle || t.name || 'team').toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '')
    const vals = [handle, t.name || handle.slice(1), t.description || '', t.mode || 'sequential', JSON.stringify(t.members || []), t.synthesizer || '']
    if (t.id) {
      db.run('UPDATE teams SET handle = ?, name = ?, description = ?, mode = ?, members = ?, synthesizer = ? WHERE id = ?', [...vals, t.id])
      return t.id
    }
    const id = db.uid()
    db.run('INSERT INTO teams (id, handle, name, description, mode, members, synthesizer, created_at) VALUES (?,?,?,?,?,?,?,?)', [id, ...vals, Date.now()])
    return id
  },
  'teams:delete': (id) => db.run('DELETE FROM teams WHERE id = ?', [id]),
  'harness:list': () => db.all('SELECT * FROM harnesses ORDER BY created_at ASC'),
  'harness:save': (h) => {
    if (h.id) {
      db.run('UPDATE harnesses SET name = ?, description = ?, config = ? WHERE id = ?', [h.name, h.description || '', JSON.stringify(h.config || {}), h.id])
      return h.id
    }
    const id = db.uid()
    db.run('INSERT INTO harnesses (id, name, description, config, created_at) VALUES (?,?,?,?,?)', [id, h.name, h.description || '', JSON.stringify(h.config || {}), Date.now()])
    return id
  },
  'harness:delete': (id) => {
    if (getSetting('activeHarness') === id) setSetting('activeHarness', null)
    db.run('DELETE FROM harnesses WHERE id = ?', [id])
  },
  'skills:toggle': (id, enabled) => db.run('UPDATE skills SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]),
  'skills:delete': (id) => db.run('DELETE FROM skills WHERE id = ?', [id]),

  // ---------- MCP & plugins ----------
  'mcp:status': () => mcp.status(),
  'mcp:catalog': () => mcp.CATALOG,
  'mcp:save': (server) => mcp.saveServer(server),
  'mcp:remove': (id) => mcp.removeServer(id),
  'mcp:reconnect': async (id) => {
    const s = mcp.servers().find((x) => x.id === id)
    if (s) await mcp.connect(s)
    return mcp.status()
  },
  'mcp:workspace': () => mcp.workspaceDir(),
  'mcp:chooseWorkspace': async () => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(currentSender), { properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return mcp.workspaceDir()
    setSetting('workspaceDir', r.filePaths[0])
    return mcp.workspaceDir()
  },
  'plugins:list': () => mcp.plugins(),
  'plugins:set': (id, enabled) => mcp.setPlugin(id, enabled),
  'tool:approveReply': (id, ok) => {
    approvals.get(id)?.(!!ok)
    approvals.delete(id)
  },

  // ---------- local AI ----------
  'local:status': () => localAI.status(),
  'local:installEngine': (key) => localAI.installEngine(key),
  'local:installModel': (id) => localAI.installModel(id),
  'local:addCustom': (input, name) => localAI.addCustomModel(input, name),
  'local:hfSearch': (q, kind) => localAI.hfSearch(q, kind),
  'local:hfFiles': (repo, kind) => localAI.hfFiles(repo, kind),
  'local:enqueue': (ids) => localAI.enqueue(ids),
  'local:clearQueue': () => localAI.clearQueue(),
  'local:removeAll': () => localAI.removeAll(),
  'local:cleanOrphans': () => localAI.cleanOrphans(),
  // Read text aloud with a downloaded voice (returns a WAV data URL to play).
  'voice:speak': async (p) => 'data:audio/wav;base64,' + (await (p.system ? systemVoices.speak({ id: p.system, text: p.text, rate: p.rate }) : localAI.speak(p))).toString('base64'),
  'voice:speakToMedia': async (p) => {
    const buffer = await (p.system ? systemVoices.speak({ id: p.system, text: p.text, rate: p.rate }) : localAI.speak(p))
    return saveMedia({ buffer, mime: 'audio/wav', kind: 'audio', name: `voiceover-${Date.now()}.wav`, prompt: String(p.text).slice(0, 300), model: p.modelId, source: 'creative' })
  },
  // Voice cloning: reference recordings kept on this computer.
  'voice:clones': () => localAI.clones(),
  // Voices of the operating system (Windows SAPI/OneCore, macOS say, Linux eSpeak NG/Pico).
  'voice:systemList': async (refresh) => ({ voices: await systemVoices.list({ refresh: !!refresh }), hint: systemVoices.hint(), platform: process.platform }),
  'voice:saveClone': (p) => localAI.saveClone(p),
  'voice:deleteClone': (id) => localAI.deleteClone(id),
  'local:openFolder': () => shell.openPath(path.join(app.getPath('userData'), 'local-ai')),

  // updates
  'update:state': () => updater.getState(),
  'update:check': () => updater.check({ manual: true }),
  'update:download': () => updater.download(),
  'update:cancel': () => updater.cancel(),
  'update:activeWork': () => [...localAI.activeWork(), ...(controllers.size ? [{ kind: 'chat', label: 'Answer being written' }] : []), ...terminal.list().map((t) => ({ kind: 'terminal', label: `Terminal ${t}` }))],
  'update:install': () =>
    updater.install(() => {
      for (const c of controllers.values()) c.abort()
      localAI.cancelMedia()
      localAI.stop()
      terminal.killAll()
      db.flush()
    }),
  'local:refreshHardware': () => localAI.refreshHardware(),
  'local:remove': (id) => localAI.removeModel(id),
  'local:cancel': (id) => localAI.cancel(id),
  'local:stop': () => localAI.stop(),

  // ---------- terminal ----------
  'term:info': () => terminal.info(),
  'term:create': (opts) => {
    const sender = currentSender
    return terminal.create(opts, (ch, ...args) => !sender.isDestroyed() && sender.send(ch, ...args))
  },
  'term:write': (id, data) => terminal.write(id, data),
  'term:resize': (id, cols, rows) => terminal.resize(id, cols, rows),
  'term:kill': (id) => terminal.kill(id),

  // ---------- window ----------
  'window:new': () => createWindow(),
  'window:close': () => BrowserWindow.fromWebContents(currentSender)?.close(),
  'window:minimize': () => BrowserWindow.fromWebContents(currentSender)?.minimize(),
  'window:fullscreen': () => {
    const w = BrowserWindow.fromWebContents(currentSender)
    w?.setFullScreen(!w.isFullScreen())
  },
  'window:devtools': () => currentSender.toggleDevTools(),
  'window:reload': () => currentSender.reload(),
  'window:zoom': (dir) => {
    const wc = currentSender
    wc.setZoomLevel(dir === 0 ? 0 : wc.getZoomLevel() + dir * 0.5)
  },
  'window:overlay': (colors) => {
    const w = BrowserWindow.fromWebContents(currentSender)
    try {
      if (process.platform !== 'darwin') w?.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor, height: 34 })
    } catch {
      /* overlay not supported */
    }
  },
  'edit:command': (cmd) => {
    const wc = currentSender
    if (['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll', 'delete'].includes(cmd)) wc[cmd]()
  },
  'find:start': (text, opts) => (text ? currentSender.findInPage(text, opts || {}) : currentSender.stopFindInPage('clearSelection')),
  'find:stop': () => currentSender.stopFindInPage('clearSelection'),
  'conversations:export': async (id) => {
    const c = db.get('SELECT * FROM conversations WHERE id = ?', [id])
    if (!c) return false
    const msgs = db.all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC', [id])
    const md = `# ${c.title}\n\n` + msgs.map((m) => `**${m.role === 'user' ? 'You' : 'Orbi' + (m.model ? ' · ' + m.model : '')}**\n\n${m.content}\n`).join('\n---\n\n')
    const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(currentSender), { defaultPath: `${c.title.replace(/[\\/:*?"<>|]/g, '')}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] })
    if (r.canceled || !r.filePath) return false
    fs.writeFileSync(r.filePath, md, 'utf8')
    return true
  },
  'app:quit': () => app.quit(),

  'shell:openExternal': (url) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
  },
  'data:reveal': () => shell.openPath(app.getPath('userData')),
}

for (const [channel, fn] of Object.entries(api)) {
  ipcMain.handle(channel, (e, ...args) => {
    currentSender = e.sender
    return fn(...args)
  })
}

function installLibrarySkill(id) {
  const k = library.SKILLS.find((x) => x.id === id)
  if (!k) return false
  if (db.get('SELECT id FROM skills WHERE library_id = ? OR name = ?', [k.id, k.name])) return true
  db.run('INSERT INTO skills (id, name, description, instructions, enabled, created_at, library_id, files, tests, meta) VALUES (?,?,?,?,?,?,?,?,?,?)', [db.uid(), k.name, k.description, k.instructions, 0, Date.now(), k.id, JSON.stringify(k.files || []), JSON.stringify(k.tests || {}), JSON.stringify(k.meta || { author: k.author, license: k.license })])
  return true
}
function installLibraryAgent(id) {
  const a = library.AGENTS.find((x) => x.id === id)
  if (!a) return false
  if (db.get('SELECT id FROM agents WHERE handle = ?', [a.handle])) return true
  const aid = db.uid()
  db.run('INSERT INTO agents (id, handle, instructions, created_at) VALUES (?,?,?,?)', [aid, a.handle, a.instructions, Date.now()])
  db.run('UPDATE agents SET name = ?, description = ?, category = ?, starters = ? WHERE id = ?', [a.name, a.description, a.category, JSON.stringify(a.starters || []), aid])
  if (a.skills?.length) {
    a.skills.forEach((n) => {
      const lib = library.SKILLS.find((k) => k.name === n)
      if (lib) installLibrarySkill(lib.id)
    })
    db.run("UPDATE agents SET skills_mode = 'selected', skills = ? WHERE id = ?", [JSON.stringify(a.skills), aid])
  }
  return true
}

const cloudVideoJobs = new Map()
// Nearest standard aspect ratio for a width × height.
function aspectOf(w, h) {
  if (!w || !h) return undefined
  const list = [['1:1', 1], ['4:3', 4 / 3], ['3:4', 3 / 4], ['16:9', 16 / 9], ['9:16', 9 / 16], ['21:9', 21 / 9], ['3:2', 1.5], ['2:3', 2 / 3]]
  const r = w / h
  return list.reduce((a, b) => (Math.abs(Math.log(b[1] / r)) < Math.abs(Math.log(a[1] / r)) ? b : a))[0]
}

async function configFor(providerId, model) {
  if (providerId === 'orbicloud') return cloudApi().providerConfig()
  if (providerId === 'orbi') {
    const srv = await localAI.ensureRunning(model)
    return { enabled: true, apiKey: '', baseUrl: `http://127.0.0.1:${srv.port}/v1` }
  }
  return providerConfig(providerId)
}

function approve(req, origin) {
  return new Promise((resolve) => {
    const id = db.uid()
    approvals.set(id, resolve)
    const target = origin && !origin.isDestroyed() ? origin : win?.webContents
    if (!target) return resolve(false)
    target.send('tool:approve', id, req)
    setTimeout(() => {
      if (approvals.has(id)) {
        approvals.delete(id)
        resolve(false)
      }
    }, 5 * 60 * 1000)
  })
}

// Window colors follow the last theme the user picked, so there is no light flash on start.
function themeColors() {
  const t = (db.ready && getSetting('theme', 'light')) || 'light'
  if (t === 'dark') return { bg: '#0e1012', bar: '#0e1012', fg: '#d6dbd8' }
  if (t === 'terminal') return { bg: '#040705', bar: '#040705', fg: '#58f28b' }
  return { bg: '#eef2ef', bar: '#e6ece8', fg: '#27332c' }
}

function createWindow() {
  const w = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    title: 'Orbi',
    backgroundColor: themeColors().bg,
    icon: path.join(__dirname, 'icon.png'),
    show: false,
    // VS Code-style title bar: the app draws its own menu next to the Orbi logo.
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 12, y: 10 } }
      : { titleBarOverlay: { color: themeColors().bar, symbolColor: themeColors().fg, height: 34 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  })
  windows.add(w)
  if (!win) win = w
  w.on('closed', () => {
    windows.delete(w)
    if (win === w) win = [...windows][0] || null
  })
  w.on('focus', () => (win = w))
  w.once('ready-to-show', () => w.show())
  // Windows logoff/shutdown can end the app without before-quit: save first.
  w.on('session-end', () => db.flush())
  w.on('close', () => db.flush())
  if (process.argv.includes('--updated')) w.webContents.once('did-finish-load', () => w.webContents.send('update:done', app.getVersion()))
  w.webContents.on('found-in-page', (_e, r) => w.webContents.send('find:result', { matches: r.matches, active: r.activeMatchOrdinal }))
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://') && !url.startsWith(process.env.ORBI_DEV_URL || '###')) {
      e.preventDefault()
      if (/^https?:\/\//.test(url)) shell.openExternal(url)
    }
  })
  if (isDev) w.loadURL(process.env.ORBI_DEV_URL)
  else w.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  return w
}

app.setAppUserModelId('com.orbix.orbi')
// One Orbi at a time: opening it again focuses the open window instead of starting a second copy.
const gotLock = !!process.env.ORBI_SNAPSHOT || app.requestSingleInstanceLock()
if (!gotLock) app.quit()
app.on('second-instance', () => {
  const w = win || [...windows][0]
  if (w) {
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  }
})

app.whenReady().then(async () => {
  if (!gotLock) return
  await db.open(app.getPath('userData'))
  // Upgrade installed library skills/agents to the new playbooks, only when the user never edited them.
  for (const k of library.SKILLS) if (k.legacy) db.run('UPDATE skills SET instructions = ? WHERE library_id = ? AND instructions = ?', [k.instructions, k.id, k.legacy])
  for (const a of library.AGENTS) if (a.legacy) db.run('UPDATE agents SET instructions = ? WHERE handle = ? AND instructions = ?', [a.instructions, a.handle, a.legacy])
  // First run: pre-install the lightweight (prompt-only) starters — two skills and one agent per profession.
  if (!getSetting('librarySeeded')) {
    for (const p of library.PROFESSIONS) {
      library.SKILLS.filter((k) => k.profession === p.id).slice(0, 2).forEach((k) => installLibrarySkill(k.id))
      library.AGENTS.filter((a) => a.profession === p.id).slice(0, 1).forEach((a) => installLibraryAgent(a.id))
    }
    setSetting('librarySeeded', true)
  }
  nativeTheme.themeSource = 'dark'
  // The app draws its own menu bar. macOS keeps a minimal native menu so ⌘C/⌘V work.
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]))
  } else Menu.setApplicationMenu(null)
  await localAI.init(path.join(app.getPath('userData'), 'local-ai'), broadcast, app)
  await mcp.init({ getSetting, setSetting, db, approve, onChange: (what) => broadcast('data:changed', what) })
  createWindow()
  updater.init(app, broadcast, getSetting)
  // Screenshot hook used for automated checks.
  if (process.env.ORBI_SNAPSHOT) {
    win.webContents.once('did-finish-load', () =>
      setTimeout(async () => {
        if (process.env.ORBI_SNAPSHOT_JS) await win.webContents.executeJavaScript(process.env.ORBI_SNAPSHOT_JS).catch(() => {})
        setTimeout(async () => {
          const img = await win.webContents.capturePage()
          fs.writeFileSync(process.env.ORBI_SNAPSHOT, img.toPNG())
          app.quit()
        }, Number(process.env.ORBI_SNAPSHOT_WAIT || 1200))
      }, 1500),
    )
  }
})
app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => {
  terminal.killAll()
  localAI.stop()
  mcp.shutdown()
  db.flush()
})
