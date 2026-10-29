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
  vision?: boolean
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

export type SkillFile = { path: string; content: string }
export type SkillTests = { positive?: string[]; negative?: { prompt: string; reason?: string }[]; cases?: { id?: string; input: string; criteria: string[] }[] }
export type SkillMeta = { license?: string; version?: string; compatibility?: string; author?: string; audit?: Record<string, number | string> }
export type Skill = { id: string; name: string; description: string; instructions: string; enabled: number; created_at: number; library_id?: string; files?: SkillFile[]; tests?: SkillTests; meta?: SkillMeta }
// A skill as a portable document (SKILL.md + support files + tests).
export type SkillDoc = { name: string; description: string; body: string; files: SkillFile[]; tests?: SkillTests; license?: string; version?: string; compatibility?: string; author?: string; audit?: Record<string, number | string> }
export type AuditRow = { key: string; label: string; score: number; evidence: string }
export type SkillCheck = { validation: { ok: boolean; issues: string[]; warnings: string[] }; audit: { rows: AuditRow[]; average: number; passed: boolean; notes: string } }
export type TeamMember = { handle?: string; name: string; role?: string; instructions: string; agent?: string }
export type Team = { id: string; handle: string; name: string; description: string; mode: 'sequential' | 'parallel' | 'router' | 'debate'; members: string; synthesizer: string; created_at: number }
export type HarnessConfig = { agents?: string[]; skills?: string[]; servers?: string[]; policies?: { context_budget?: number; compact_tool_output?: number; approval?: 'always' | 'risky' | 'never'; web?: 'auto' | 'on' | 'off'; memory?: boolean; rules?: string } }
export type Harness = { id: string; name: string; description: string; config: string; created_at: number }
export type StudioKind = 'skill' | 'agent' | 'team' | 'harness'

export type ToolEvent = { id: string; name: string; status: 'running' | 'done' | 'error'; args?: unknown; result?: string; sources?: WebResult[] }

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

export type ModelKind = 'text' | 'image' | 'video' | 'stt' | 'upscale' | 'tts'
export type Tier = 'light' | 'medium' | 'heavy' | 'custom'
export type Fit = { level: 'ok' | 'slow' | 'no'; reason: string; vars?: Record<string, string | number> }
export type LocalModel = {
  id: string
  kind: ModelKind
  tier: Tier
  name: string
  badge: string
  size: number
  ram: string
  req: { ram: number; vram: number }
  license: string
  description: string
  fit: Fit
  installed: boolean
  engineSupported: boolean
  downloading: { received: number; total: number; label?: string } | null
  vision?: boolean
  visionReady?: boolean
  gen?: GenInfo | null
  lang?: string
  partial?: number
  engine?: string
  family?: 'kokoro' | 'supertonic' | 'kitten' | 'pocket'
  voices?: VoiceInfo[]
  langs?: string[]
  clone?: boolean
  nonCommercial?: boolean
  isNew?: boolean
  licenseNotice?: string
}
export type GenInfo = { presets: [number, number, number]; fixedSteps: boolean; width: number; height: number; fps: number; image: boolean; ref: boolean; end: boolean }
export type Hardware = {
  platform: string
  arch: string
  os: string
  cpu: string
  cores: number
  ram: number
  gpus: { name: string; vendor: string; vram: number }[]
  vram: number
  gpuAccel: boolean
  diskFree: number
}
// 'piper' is the old name for a downloaded voice; 'local' covers every downloaded voice (voice = speaker inside a pack).
export type TtsChoice =
  | { type: 'cloud'; model: string; voice: string; rate?: number }
  | { type: 'piper' | 'local'; modelId: string; voice?: number | string; rate: number }
  | { type: 'system'; name: string; rate: number }
  | { type: 'native'; id: string; name: string; rate: number }
export type NativeVoice = { id: string; name: string; lang: string; gender: 'f' | 'm' | ''; engine: string }
export type VoiceInfo = { id: number | string; name: string; lang: string; gender: 'f' | 'm'; top?: boolean }
export type VoiceClone = { id: string; name: string; created: number }
export type EngineState = { name: string; tag: string; supported: boolean; installed: boolean; downloading: { received: number; total: number } | null }
export type LocalStatus = {
  hardware: Hardware | null
  engines: Record<'llama' | 'sd' | 'whisper' | 'piper' | 'sherpa', EngineState>
  engineInstalled: boolean
  engineTag: string
  running: { modelId: string; port: number } | null
  starting: boolean
  models: LocalModel[]
  recommended: Partial<Record<ModelKind, string | null>>
  engineDownloading: { received: number; total: number } | null
  paths: { root: string; models: string; engines: string } | null
  orphans?: { files: { file: string; bytes: number }[]; bytes: number }
  queue: string[]
  clones?: VoiceClone[]
}
export type HfRepo = { repo: string; downloads: number; likes: number; updated: string }
export type HfFile = { file: string; size: number; fits: boolean; quant: string }
export type UpdateInfo = {
  status: 'idle' | 'checking' | 'current' | 'available' | 'available-manual' | 'downloading' | 'ready' | 'installing' | 'error'
  current: string
  latest: null | { version: string; name: string; notes: string; publishedAt: string; url: string; asset: null | { name: string; size: number; url: string } }
  progress: null | { received: number; total: number }
  error: string | null
}
export type ActiveWork = { kind: string; label: string }
export type Board = { id: string; name: string; created_at: number }
export type WebResult = { title: string; url: string; snippet: string; content?: string }
export type SkillSignals = { purpose: boolean; method: boolean; knowledge: boolean; checks: boolean; open: boolean; references?: number; checkFiles?: number; commit?: string }
export type LibrarySkill = { id: string; profession: string; name: string; description: string; instructions: string; installed: boolean; author: string; kind?: 'own' | 'official' | 'community' | 'orbi'; source?: string; license?: string; rating: number; signals: SkillSignals; platforms: string[] }
export type LibraryLink = { id: string; repo: string; profession: string; name: string; description: string; author: string; source: string; license: string }
export type LibraryAgent = { id: string; profession: string; handle: string; name: string; description: string; instructions: string; starters: string[]; category: string; installed: boolean; author: string; kind?: 'own' | 'official' | 'community' | 'orbi'; source?: string; license?: string; rating: number; signals: SkillSignals }
export type LibraryKit = { id: string; profession: string; name: string; description: string; servers: string[]; skills: string[]; agents: string[]; installed: boolean }
export type Library = { professions: { id: string; name: string; icon: string; description: string }[]; skills: LibrarySkill[]; agents: LibraryAgent[]; kits: LibraryKit[]; links: LibraryLink[]; directories: { repo: string; description: string; source: string }[] }
export type VoiceMode = { type: 'local'; modelId: string } | { type: 'api'; provider: 'openai' | 'groq' } | { type: 'cloud'; model?: string }

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
  board?: string
  params?: string
}

export type AppInfo = { version: string; platform: string; userName: string; dataDir: string; author?: string; company?: string; tagline?: string }

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
  // Orbi Cloud account and gateway
  cloudState: (): Promise<CloudState> => bridge.invoke('cloud:state'),
  cloudSignup: (p: { email: string; password: string; name?: string }): Promise<{ confirm: boolean; email?: string }> => bridge.invoke('cloud:signup', p),
  cloudLogin: (p: { email: string; password: string }): Promise<boolean> => bridge.invoke('cloud:login', p),
  cloudResend: (email: string) => bridge.invoke('cloud:resend', email),
  cloudGrant: (p: { email: string; credits: number; bucket?: 'plan' | 'extra' }): Promise<{ email: string; credits: number }> => bridge.invoke('cloud:grant', p),
  cloudStats: (): Promise<{ users: number; subscribers: number; usage30d: { cost: number; calls: number } }> => bridge.invoke('cloud:stats'),
  cloudLogout: () => bridge.invoke('cloud:logout'),
  cloudPlans: (): Promise<CloudPlans> => bridge.invoke('cloud:plans'),
  cloudUsage: (): Promise<{ items: CloudUsageItem[] }> => bridge.invoke('cloud:usage'),
  cloudCatalog: (): Promise<CloudCatalog> => bridge.invoke('cloud:catalog'),
  cloudCheckout: (item: string): Promise<{ url: string }> => bridge.invoke('cloud:checkout', item),
  cloudPortal: (): Promise<{ url: string }> => bridge.invoke('cloud:portal'),
  cloudSpeak: (p: { text: string; model?: string; voice?: string }): Promise<string> => bridge.invoke('cloud:speak', p),
  cloudVideo: (p: { jobId?: string; model: string; prompt: string; negative?: string; duration?: number; resolution?: string; aspect?: string; frameImage?: string; audio?: boolean; board?: string; source?: string }): Promise<MediaItem> =>
    bridge.invoke('cloud:video', p),
  cloudCancelVideo: (jobId: string) => bridge.invoke('cloud:cancelVideo', jobId),
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
  updateMessage: (id: string, p: { content?: string }) => bridge.invoke('messages:update', id, p),
  bookmark: (id: string, value: boolean) => bridge.invoke('messages:bookmark', id, value),
  bookmarks: (): Promise<Message[]> => bridge.invoke('bookmarks:list'),

  memories: (): Promise<Memory[]> => bridge.invoke('memories:list'),
  addMemory: (content: string): Promise<Memory> => bridge.invoke('memories:add', content),
  deleteMemory: (id: string) => bridge.invoke('memories:delete', id),
  agents: (): Promise<Agent[]> => bridge.invoke('agents:list'),
  saveAgent: (a: Partial<Agent> & { tools?: string[]; skills?: string[]; starters?: string[] }): Promise<string> => bridge.invoke('agents:save', a),
  skills: (): Promise<Skill[]> => bridge.invoke('skills:list'),
  saveSkill: (k: Partial<Skill>): Promise<string> => bridge.invoke('skills:save', k),
  studioAsk: (p: { kind: StudioKind; brief: string; providerId: string; model: string }): Promise<{ questions: string[]; summary?: string }> => bridge.invoke('studio:ask', p),
  studioBuild: (p: { kind: StudioKind; brief: string; answers?: { q: string; a: string }[]; current?: unknown; providerId: string; model: string }): Promise<{ item: any; validation?: SkillCheck['validation']; audit?: SkillCheck['audit'] }> => bridge.invoke('studio:build', p),
  studioCheck: (doc: SkillDoc): Promise<SkillCheck> => bridge.invoke('studio:check', doc),
  exportSkill: (doc: SkillDoc): Promise<string | null> => bridge.invoke('studio:exportSkill', doc),
  importSkill: (): Promise<SkillDoc | null> => bridge.invoke('studio:importSkill'),
  exportBundle: (p: { kind: StudioKind; ids?: string[] }): Promise<string | null> => bridge.invoke('studio:exportBundle', p),
  importBundle: (): Promise<{ agents: number; teams: number; harnesses: number; skills: number } | null> => bridge.invoke('studio:importBundle'),
  skillMd: (doc: SkillDoc): Promise<string> => bridge.invoke('studio:skillMd', doc),
  teams: (): Promise<Team[]> => bridge.invoke('teams:list'),
  saveTeam: (t: Partial<Omit<Team, 'members'>> & { members: TeamMember[] }): Promise<string> => bridge.invoke('teams:save', t),
  deleteTeam: (id: string) => bridge.invoke('teams:delete', id),
  harnesses: (): Promise<Harness[]> => bridge.invoke('harness:list'),
  saveHarness: (h: { id?: string; name: string; description?: string; config: HarnessConfig }): Promise<string> => bridge.invoke('harness:save', h),
  deleteHarness: (id: string) => bridge.invoke('harness:delete', id),
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
  addCustomLocal: (input: string | { repo?: string; file?: string; url?: string; size?: number; kind?: 'text' | 'image'; name?: string }, name?: string): Promise<LocalStatus> =>
    bridge.invoke('local:addCustom', input, name),
  hfSearch: (q: string, kind: 'text' | 'image'): Promise<HfRepo[]> => bridge.invoke('local:hfSearch', q, kind),
  hfFiles: (repo: string, kind: 'text' | 'image'): Promise<HfFile[]> => bridge.invoke('local:hfFiles', repo, kind),
  enqueueLocal: (ids: string[]): Promise<LocalStatus> => bridge.invoke('local:enqueue', ids),
  clearLocalQueue: (): Promise<LocalStatus> => bridge.invoke('local:clearQueue'),
  removeAllLocal: (): Promise<LocalStatus> => bridge.invoke('local:removeAll'),
  cleanOrphans: (): Promise<LocalStatus> => bridge.invoke('local:cleanOrphans'),
  speakLocal: (p: { text: string; modelId: string; rate?: number; voice?: number | string; lang?: string }): Promise<string> => bridge.invoke('voice:speak', p),
  speakToMedia: (p: { text: string; modelId: string; rate?: number; voice?: number | string; lang?: string }): Promise<MediaItem> => bridge.invoke('voice:speakToMedia', p),
  voiceClones: (): Promise<VoiceClone[]> => bridge.invoke('voice:clones'),
  systemVoices: (refresh?: boolean): Promise<{ voices: NativeVoice[]; hint: string | null; platform: string }> => bridge.invoke('voice:systemList', refresh),
  speakSystem: (p: { text: string; system: string; rate?: number }): Promise<string> => bridge.invoke('voice:speak', p),
  speakSystemToMedia: (p: { text: string; system: string; rate?: number }): Promise<MediaItem> => bridge.invoke('voice:speakToMedia', p),
  saveVoiceClone: (p: { name: string; wav: string }): Promise<VoiceClone[]> => bridge.invoke('voice:saveClone', p),
  deleteVoiceClone: (id: string): Promise<VoiceClone[]> => bridge.invoke('voice:deleteClone', id),
  openModelsFolder: () => bridge.invoke('local:openFolder'),
  complete: (p: { providerId: string; model: string; system?: string; prompt: string; maxTokens?: number }): Promise<string> => bridge.invoke('ai:complete', p),
  speech: (p: { text: string; voice?: string; model?: string }): Promise<MediaItem> => bridge.invoke('ai:speech', p),
  updateState: (): Promise<UpdateInfo> => bridge.invoke('update:state'),
  checkUpdate: (): Promise<UpdateInfo> => bridge.invoke('update:check'),
  downloadUpdate: (): Promise<UpdateInfo> => bridge.invoke('update:download'),
  cancelUpdate: () => bridge.invoke('update:cancel'),
  activeWork: (): Promise<ActiveWork[]> => bridge.invoke('update:activeWork'),
  installUpdate: (): Promise<boolean> => bridge.invoke('update:install'),
  removeLocal: (id: string): Promise<LocalStatus> => bridge.invoke('local:remove', id),
  cancelLocal: (id: string) => bridge.invoke('local:cancel', id),
  stopLocal: () => bridge.invoke('local:stop'),
  installEngine: (key: 'llama' | 'sd' | 'whisper'): Promise<LocalStatus> => bridge.invoke('local:installEngine', key),
  refreshHardware: (): Promise<LocalStatus> => bridge.invoke('local:refreshHardware'),
  generateLocal: (p: {
    modelId: string
    prompt: string
    negative?: string
    width?: number
    height?: number
    steps?: number
    seed?: number | ''
    initImage?: string
    mask?: string
    strength?: number
    frames?: number
    fps?: number
    refImages?: string[]
    endImage?: string
    jobId?: string
    board?: string
    source?: string
  }): Promise<MediaItem> => bridge.invoke('local:generate', p),
  cancelLocalGenerate: (jobId?: string) => bridge.invoke('local:cancelGenerate', jobId),
  upscale: (p: { mediaId: string; modelId?: string; jobId?: string; board?: string }): Promise<MediaItem> => bridge.invoke('local:upscale', p),
  mediaDataUrl: (id: string): Promise<string | null> => bridge.invoke('media:dataUrl', id),
  saveCanvas: (dataUrl: string, meta: { name?: string; board?: string; prompt?: string }): Promise<MediaItem | null> => bridge.invoke('media:saveCanvas', dataUrl, meta),
  setMediaBoard: (id: string, board: string) => bridge.invoke('media:setBoard', id, board),
  boards: (): Promise<Board[]> => bridge.invoke('boards:list'),
  createBoard: (name: string): Promise<Board> => bridge.invoke('boards:create', name),
  renameBoard: (id: string, name: string) => bridge.invoke('boards:rename', id, name),
  deleteBoard: (id: string) => bridge.invoke('boards:delete', id),
  webSearch: (q: string, opts?: { read?: number }): Promise<{ query: string; engine: string; results: WebResult[]; context: string }> => bridge.invoke('web:search', q, opts),
  transcribe: (p: { wav: string; mode: VoiceMode; language?: string }): Promise<string> => bridge.invoke('voice:transcribe', p),
  library: (): Promise<Library> => bridge.invoke('library:get'),
  installLibrarySkill: (id: string) => bridge.invoke('library:installSkill', id),
  installLibraryAgent: (id: string) => bridge.invoke('library:installAgent', id),
  installKit: (id: string) => bridge.invoke('library:installKit', id),

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
  generateImage: (p: { providerId: string; model: string; prompt: string; size?: string; source?: string; board?: string; width?: number; height?: number; resolution?: string; refImages?: string[] }): Promise<MediaItem> =>
    bridge.invoke('image:generate', p),

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

export type CloudUser = {
  id: string
  email: string
  name: string
  admin?: boolean
  plan: { id: string; name: string; status: string; renews: number | null; monthlyCredits: number } | null
  credits: { plan: number; extra: number; total: number }
  created: number
}
export type CloudState = { url: string; signedIn: boolean; online?: boolean; configured?: boolean; user: CloudUser | null; payments: boolean; error: string | null; code: string | null }
export type CloudPlans = {
  payments: boolean
  plans: { id: string; name: string; priceLabel: string; monthlyCredits: number; features: string[]; available: boolean }[]
  packs: { id: string; name: string; priceLabel: string; credits: number; available: boolean }[]
  credit: { usd: number }
}
export type CloudUsageItem = { created_at: number; kind: string; amount: number; model: string; note: string }
export type CloudCatalog = {
  chat: { id: string; name: string; vendor: string; context: number; input: string[]; image: boolean; price: { in: number; out: number } }[]
  image: { id: string; name: string; vendor: string; price?: number; aspects?: string[]; resolutions?: string[] }[]
  video: { id: string; name: string; vendor: string; durations: number[]; resolutions: string[]; aspects: string[]; audio: boolean; pricePerSecond?: number; imageInput: boolean }[]
  tts: { id: string; name: string; voices: string[] }[]
  stt: { id: string; name: string }[]
  credits: { usd: number; markup: number }
}
