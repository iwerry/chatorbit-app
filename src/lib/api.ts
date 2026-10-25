// Thin typed wrapper over the desktop bridge (window.orbi).
// The same interface can later be implemented over HTTP for the web version.

export type ProviderInfo = {
  id: string
  name: string
  kind: 'openai' | 'anthropic'
  baseUrl: string
  needsKey: boolean
  mode: 'API' | 'Local'
  hint: string
  enabled: boolean
  customBaseUrl: string
  hasKey: boolean
}

export type ModelInfo = {
  key: string
  id: string
  name: string
  provider: string
  providerName: string
  mode: 'API' | 'Local'
  image: boolean
}

export type Project = { id: string; name: string; created_at: number }

export type Conversation = {
  id: string
  title: string
  project_id: string | null
  pinned: number
  model: string
  created_at: number
  updated_at: number
}

export type Attachment = { name: string; mime: string; dataUrl?: string; text?: string }

export type Message = {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  model: string
  attachments: string | Attachment[]
  bookmarked: number
  created_at: number
  reasoning?: string
  error?: boolean
  conversation_title?: string
  tools?: string | ToolEvent[]
}

export type Memory = { id: string; content: string; created_at: number }

export type Agent = {
  id: string
  handle: string
  name: string
  description: string
  model: string
  category: string
  instructions: string
  tools: string | string[]
  skills_mode: 'off' | 'all' | 'selected'
  skills: string | string[]
  starters: string | string[]
  support_name: string
  support_email: string
  color: string
  created_at: number
}

export type Skill = { id: string; name: string; description: string; instructions: string; enabled: number; created_at: number }

export type ToolEvent = { id: string; name: string; status: 'running' | 'done' | 'error'; args?: unknown; result?: string }

export type McpServer = {
  id: string
  name: string
  type: 'builtin' | 'stdio' | 'http'
  url?: string
  command?: string
  args?: string[]
  headers?: Record<string, string>
  env?: Record<string, string>
  enabled: boolean
  description?: string
  status: 'connected' | 'connecting' | 'error' | 'disabled'
  error: string | null
  tools: { name: string; description: string }[]
}

export type CatalogEntry = Omit<McpServer, 'status' | 'error' | 'tools' | 'enabled'>
export type Plugin = { id: string; name: string; description: string; servers: string[]; skills: string[]; enabled: boolean }

export type LocalModel = {
  id: string
  name: string
  badge: string
  size: number
  ram: string
  license: string
  description: string
  installed: boolean
  downloading: { received: number; total: number } | null
}
export type LocalStatus = {
  engineInstalled: boolean
  engineTag: string
  running: { modelId: string; port: number } | null
  starting: boolean
  models: LocalModel[]
  engineDownloading: { received: number; total: number } | null
}

export function parseJSON<T>(v: unknown, fallback: T): T {
  if (Array.isArray(v)) return v as T
  if (typeof v !== 'string' || !v) return fallback
  try {
    return JSON.parse(v) as T
  } catch {
    return fallback
  }
}

export type MediaItem = {
  id: string
  kind: 'image' | 'video' | 'audio' | 'file'
  name: string
  file: string
  prompt: string
  model: string
  source: string
  created_at: number
  url: string
}

export type AppInfo = { version: string; platform: string; userName: string; dataDir: string }

type Bridge = {
  invoke: (channel: string, ...args: unknown[]) => Promise<any>
  onChatDelta: (cb: (reqId: string, delta: { text?: string; reasoning?: string; tool?: ToolEvent; done?: { ok: boolean; error?: string; aborted?: boolean } }) => void) => () => void
  on?: (channel: string, cb: (...args: any[]) => void) => () => void
  platform?: string
}

declare global {
  interface Window {
    orbi?: Bridge
  }
}

// Browser fallback so the UI can be previewed with `vite` alone (no Electron).
const memory: Record<string, any[]> = { conversations: [], messages: [], projects: [], memories: [], media: [], agents: [] }
const fallback: Bridge = {
  invoke: async (channel, ...args) => {
    const [a, b] = args as any[]
    switch (channel) {
      case 'app:info':
        return { version: 'web-preview', platform: 'web', userName: 'Marina', dataDir: '' }
      case 'settings:get':
        return JSON.parse(localStorage.getItem('orbi:' + a) ?? 'null') ?? b
      case 'settings:set':
        localStorage.setItem('orbi:' + a, JSON.stringify(b))
        return
      case 'providers:list':
        return []
      case 'models:list':
        return { models: [], errors: [] }
      case 'chat:send':
        return { ok: false, error: 'Preview mode: run the desktop app to talk to real models.' }
      case 'conversations:list':
        return memory.conversations
      case 'projects:list':
      case 'memories:list':
      case 'media:list':
      case 'bookmarks:list':
      case 'agents:list':
        return memory[channel.split(':')[0]] ?? []
      case 'messages:list':
        return memory.messages.filter((m) => m.conversation_id === a)
      case 'conversations:create': {
        const row = { id: crypto.randomUUID(), title: a.title, project_id: a.project_id ?? null, pinned: 0, model: a.model, created_at: Date.now(), updated_at: Date.now() }
        memory.conversations.unshift(row)
        return row
      }
      case 'messages:add': {
        const row = { id: crypto.randomUUID(), created_at: Date.now(), bookmarked: 0, ...a }
        memory.messages.push(row)
        return row
      }
      default:
        return null
    }
  },
  onChatDelta: () => () => {},
}

export const bridge: Bridge = window.orbi ?? fallback
export const isDesktop = !!window.orbi
export const platform = window.orbi?.platform ?? 'web'
export const on = (channel: string, cb: (...args: any[]) => void) => bridge.on?.(channel, cb) ?? (() => {})

export const api = {
  info: (): Promise<AppInfo> => bridge.invoke('app:info'),
  getSetting: <T,>(key: string, fallback: T): Promise<T> => bridge.invoke('settings:get', key, fallback),
  setSetting: (key: string, value: unknown) => bridge.invoke('settings:set', key, value),

  providers: (): Promise<ProviderInfo[]> => bridge.invoke('providers:list'),
  saveProvider: (id: string, patch: Partial<{ enabled: boolean; apiKey: string; baseUrl: string }>) => bridge.invoke('providers:save', id, patch),
  testProvider: (id: string): Promise<{ ok: boolean; count: number }> => bridge.invoke('providers:test', id),
  models: (): Promise<{ models: ModelInfo[]; errors: { provider: string; message: string }[] }> => bridge.invoke('models:list'),

  sendChat: (reqId: string, payload: unknown): Promise<{ ok: boolean; error?: string; aborted?: boolean }> => bridge.invoke('chat:send', reqId, payload),
  abortChat: (reqId: string) => bridge.invoke('chat:abort', reqId),
  titleFor: (payload: unknown): Promise<string> => bridge.invoke('chat:title', payload),

  projects: (): Promise<Project[]> => bridge.invoke('projects:list'),
  createProject: (name: string): Promise<Project> => bridge.invoke('projects:create', name),
  deleteProject: (id: string) => bridge.invoke('projects:delete', id),

  conversations: (): Promise<Conversation[]> => bridge.invoke('conversations:list'),
  createConversation: (c: Partial<Conversation>): Promise<Conversation> => bridge.invoke('conversations:create', c),
  updateConversation: (id: string, patch: Partial<Conversation>) => bridge.invoke('conversations:update', id, patch),
  deleteConversation: (id: string) => bridge.invoke('conversations:delete', id),

  messages: (conversationId: string): Promise<Message[]> => bridge.invoke('messages:list', conversationId),
  addMessage: (m: Partial<Message> & { attachments?: Attachment[] }): Promise<Message> => bridge.invoke('messages:add', m),
  deleteMessage: (id: string) => bridge.invoke('messages:delete', id),
  bookmark: (id: string, value: boolean) => bridge.invoke('messages:bookmark', id, value),
  bookmarks: (): Promise<Message[]> => bridge.invoke('bookmarks:list'),

  memories: (): Promise<Memory[]> => bridge.invoke('memories:list'),
  addMemory: (content: string): Promise<Memory> => bridge.invoke('memories:add', content),
  deleteMemory: (id: string) => bridge.invoke('memories:delete', id),
  agents: (): Promise<Agent[]> => bridge.invoke('agents:list'),
  saveAgent: (a: Partial<Agent> & { tools?: string[]; skills?: string[]; starters?: string[] }): Promise<string> => bridge.invoke('agents:save', a),
  skills: (): Promise<Skill[]> => bridge.invoke('skills:list'),
  saveSkill: (k: Partial<Skill>) => bridge.invoke('skills:save', k),
  toggleSkill: (id: string, enabled: boolean) => bridge.invoke('skills:toggle', id, enabled),
  deleteSkill: (id: string) => bridge.invoke('skills:delete', id),

  mcpStatus: (): Promise<McpServer[]> => bridge.invoke('mcp:status'),
  mcpCatalog: (): Promise<CatalogEntry[]> => bridge.invoke('mcp:catalog'),
  saveMcp: (s: Partial<McpServer>): Promise<McpServer[]> => bridge.invoke('mcp:save', s),
  removeMcp: (id: string): Promise<McpServer[]> => bridge.invoke('mcp:remove', id),
  reconnectMcp: (id: string): Promise<McpServer[]> => bridge.invoke('mcp:reconnect', id),
  workspaceDir: (): Promise<string> => bridge.invoke('mcp:workspace'),
  chooseWorkspace: (): Promise<string> => bridge.invoke('mcp:chooseWorkspace'),
  plugins: (): Promise<Plugin[]> => bridge.invoke('plugins:list'),
  setPlugin: (id: string, enabled: boolean): Promise<Plugin[]> => bridge.invoke('plugins:set', id, enabled),
  approveTool: (id: string, ok: boolean) => bridge.invoke('tool:approveReply', id, ok),

  localStatus: (): Promise<LocalStatus> => bridge.invoke('local:status'),
  installLocalModel: (id: string): Promise<LocalStatus> => bridge.invoke('local:installModel', id),
  addCustomLocal: (url: string, name?: string): Promise<LocalStatus> => bridge.invoke('local:addCustom', url, name),
  removeLocal: (id: string): Promise<LocalStatus> => bridge.invoke('local:remove', id),
  cancelLocal: (id: string) => bridge.invoke('local:cancel', id),
  stopLocal: () => bridge.invoke('local:stop'),

  termInfo: (): Promise<{ shell: string; platform: string; available: boolean; error: string | null }> => bridge.invoke('term:info'),
  termCreate: (o: { id: string; cols: number; rows: number; cwd?: string }): Promise<{ pid: number; shell: string; cwd: string }> => bridge.invoke('term:create', o),
  termWrite: (id: string, data: string) => bridge.invoke('term:write', id, data),
  termResize: (id: string, cols: number, rows: number) => bridge.invoke('term:resize', id, cols, rows),
  termKill: (id: string) => bridge.invoke('term:kill', id),

  win: {
    new: () => bridge.invoke('window:new'),
    close: () => bridge.invoke('window:close'),
    minimize: () => bridge.invoke('window:minimize'),
    fullscreen: () => bridge.invoke('window:fullscreen'),
    devtools: () => bridge.invoke('window:devtools'),
    reload: () => bridge.invoke('window:reload'),
    zoom: (dir: -1 | 0 | 1) => bridge.invoke('window:zoom', dir),
    overlay: (color: string, symbolColor: string) => bridge.invoke('window:overlay', { color, symbolColor }),
    quit: () => bridge.invoke('app:quit'),
  },
  edit: (cmd: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll' | 'delete') => bridge.invoke('edit:command', cmd),
  find: (text: string, opts?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }) => bridge.invoke('find:start', text, opts),
  stopFind: () => bridge.invoke('find:stop'),
  exportConversation: (id: string): Promise<boolean> => bridge.invoke('conversations:export', id),
  deleteAgent: (id: string) => bridge.invoke('agents:delete', id),

  media: (): Promise<MediaItem[]> => bridge.invoke('media:list'),
  deleteMedia: (id: string) => bridge.invoke('media:delete', id),
  openMedia: (id: string) => bridge.invoke('media:open', id),
  revealMedia: (id: string) => bridge.invoke('media:reveal', id),
  saveMediaAs: (id: string) => bridge.invoke('media:saveAs', id),
  importMedia: (file: { name: string; dataUrl: string }): Promise<MediaItem | null> => bridge.invoke('media:import', file),
  generateImage: (p: { providerId: string; model: string; prompt: string; size?: string; source?: string }): Promise<MediaItem> => bridge.invoke('image:generate', p),

  getWorkflow: (id: string) => bridge.invoke('workflows:get', id),
  saveWorkflow: (id: string, name: string, data: unknown) => bridge.invoke('workflows:save', id, name, data),

  openExternal: (url: string) => bridge.invoke('shell:openExternal', url),
  revealData: () => bridge.invoke('data:reveal'),
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

export function parseAttachments(a: Message['attachments']): Attachment[] {
  if (Array.isArray(a)) return a
  try {
    return JSON.parse(a || '[]')
  } catch {
    return []
  }
}

export function readFileAsAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    const isText = /^text\/|json|xml|javascript|typescript|csv|markdown/.test(file.type) || /\.(md|txt|csv|json|ts|tsx|js|py|html|css|yaml|yml|xml|sql)$/i.test(file.name)
    reader.onerror = () => reject(reader.error)
    if (isText) {
      reader.onload = () => resolve({ name: file.name, mime: file.type || 'text/plain', text: String(reader.result).slice(0, 200_000) })
      reader.readAsText(file)
    } else {
      reader.onload = () => resolve({ name: file.name, mime: file.type || 'application/octet-stream', dataUrl: String(reader.result) })
      reader.readAsDataURL(file)
    }
  })
}
