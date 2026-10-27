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
const mcp = require('./mcp.cjs')
const localAI = require('./local-ai.cjs')
const updater = require('./updater.cjs')

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
function providerConfig(id) {
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
      ai.PROVIDERS.map(async (p) => {
        const c = providerConfig(p.id)
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
      const toolkit = tools.length ? { tools, call: (name, args) => mcp.callTool(name, args, sender) } : null
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
  'ai:complete': async ({ providerId, model, system, prompt }) => {
    let text = ''
    await ai.streamChat(
      { providerId, model, thinking: false, system: system || 'You are a helpful creative assistant.', messages: [{ role: 'user', content: String(prompt || '') }] },
      await configFor(providerId, model),
      (d) => (text += d.text || ''),
      AbortSignal.timeout(180000),
    )
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  },
  // Text to speech for workflow voiceover nodes (OpenAI key required).
  'ai:speech': async ({ text, voice }) => {
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
    const { buffer, mime } = await ai.generateImage(payload, providerConfig(payload.providerId))
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
      return saveMedia({ buffer, mime, kind, name: `${short}.${kind === 'video' ? 'webm' : 'png'}`, prompt: payload.prompt, model, source: 'creative', board: payload.board, params: { width: payload.width, height: payload.height, steps: payload.steps, seed: payload.seed } })
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
  'web:search': async (q, opts = {}) => {
    const r = await websearch.search(q, { lang: getSetting('language', 'en'), read: opts.read ?? 3 })
    return { ...r, context: websearch.toContext(r) }
  },

  // ---------- voice ----------
  'voice:transcribe': async ({ wav, mode, language }) => {
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
      agents: library.AGENTS.map((a) => ({ ...a, installed: installedAgents.has(a.handle) })),
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
  'skills:list': () => db.all('SELECT * FROM skills ORDER BY created_at ASC'),
  'skills:save': (k) => {
    if (k.id) db.run('UPDATE skills SET name = ?, description = ?, instructions = ? WHERE id = ?', [k.name, k.description || '', k.instructions, k.id])
    else db.run('INSERT INTO skills (id, name, description, instructions, enabled, created_at) VALUES (?,?,?,?,?,?)', [db.uid(), k.name, k.description || '', k.instructions, 1, Date.now()])
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
  // Read text aloud with a downloaded Piper voice (returns a WAV data URL to play).
  'voice:speak': async ({ text, modelId, rate }) => 'data:audio/wav;base64,' + (await localAI.speak({ text, modelId, rate })).toString('base64'),
  'voice:speakToMedia': async ({ text, modelId, rate }) => {
    const buffer = await localAI.speak({ text, modelId, rate })
    return saveMedia({ buffer, mime: 'audio/wav', kind: 'audio', name: `voiceover-${Date.now()}.wav`, prompt: String(text).slice(0, 300), model: modelId, source: 'creative' })
  },
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
  db.run('INSERT INTO skills (id, name, description, instructions, enabled, created_at, library_id) VALUES (?,?,?,?,?,?,?)', [db.uid(), k.name, k.description, k.instructions, 0, Date.now(), k.id])
  return true
}
function installLibraryAgent(id) {
  const a = library.AGENTS.find((x) => x.id === id)
  if (!a) return false
  if (db.get('SELECT id FROM agents WHERE handle = ?', [a.handle])) return true
  const aid = db.uid()
  db.run('INSERT INTO agents (id, handle, instructions, created_at) VALUES (?,?,?,?)', [aid, a.handle, a.instructions, Date.now()])
  db.run('UPDATE agents SET name = ?, description = ?, category = ?, starters = ? WHERE id = ?', [a.name, a.description, a.category, JSON.stringify(a.starters || []), aid])
  return true
}

async function configFor(providerId, model) {
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
