import { type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  Blocks,
  Bookmark,
  BookmarkCheck,
  Bot,
  Download,
  ExternalLink,
  Globe,
  Volume2,
  VolumeX,
  ShieldCheck,
  Wrench,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Cpu,
  Crown,
  FileText,
  FolderKanban,
  Image as ImageIcon,
  Loader2,
  LogOut,
  Menu,
  MessageSquareText,
  Mic,
  MoreHorizontal,
  Paperclip,
  PanelLeftClose,
  Plug,
  Plus,
  RotateCcw,
  Search,
  Server,
  Settings,
  Sparkles,
  Square,
  UserRound,
  Video,
  X,
} from 'lucide-react'
import {
  api,
  bridge,
  isDesktop,
  parseAttachments,
  readFileAsAttachment,
  uid,
  type Agent,
  type AppInfo,
  type Attachment,
  type Conversation,
  type MediaItem,
  type Memory,
  type Message,
  type ModelInfo,
  type Project,
  type Skill,
  type McpServer,
  type Plugin,
  type LocalStatus,
  type ToolEvent,
  type VoiceMode,
  on,
  parseJSON,
} from './lib/api'
import { Markdown } from './components/Markdown'
import { OrbiMark, SpyHatIcon } from './components/Logo'
import type { SettingsTab } from './components/SettingsModal'
import { t, t as tr, setLang as applyLang, fmtDate, fmtTime, type Lang } from './lib/i18n'
import { navItems, WorkspacePanel, type NavKey } from './components/WorkspacePanel'
import { CommandPalette, FindBar, TitleBar, type Command, type MenuDef } from './components/TitleBar'
import type { TerminalHandle } from './components/TerminalPanel'
const TerminalPanel = lazy(() => import('./components/TerminalPanel').then((m) => ({ default: m.TerminalPanel })))
import { RunCodeContext } from './components/Markdown'
import { ThemeSwitcher, type ThemeMode } from './components/ThemeSwitcher'
import { recordWav } from './lib/voice'
import { activity, useActivities, type ActivityDone } from './lib/activity'

const SettingsModal = lazy(() => import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal })))
const VoiceSettings = lazy(() => import('./components/SettingsModal').then((m) => ({ default: m.VoiceSettings })))
const CreativeStudio = lazy(() => import('./components/CreativeStudio').then((m) => ({ default: m.CreativeStudio })))
const UpdateCenter = lazy(() => import('./components/UpdateCenter').then((m) => ({ default: m.UpdateCenter })))
const SetupWizard = lazy(() => import('./components/SetupWizard').then((m) => ({ default: m.SetupWizard })))
const Explore = lazy(() => import('./components/Explore').then((m) => ({ default: m.Explore })))

type Suggest = { kind: 'skill' | 'command' | 'agent'; id: string; label: string; hint: string; insert: string }
const SLASH_COMMANDS = [
  { id: 'web', hint: 'Search the web before answering' },
  { id: 'image', hint: 'Open the Creative studio with this prompt' },
  { id: 'terminal', hint: 'Open the terminal' },
  { id: 'clear', hint: 'Start a new chat' },
]
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

type ResponseType = 'Instant' | 'Thinking'
type ReasoningEffort = 'Fast' | 'Medium' | 'High'
type HeaderMenu = 'models' | 'skills' | 'agents' | 'add' | null

type ChatMessage = Message & { streaming?: boolean; temp?: boolean }

const suggestions = ['Create a list of next steps', 'Summarize in three bullet points', 'What are the potential risks?']
const starterPrompts = [
  'Write a 30-second video script for a coffee brand launch',
  'Give me 5 image prompts for a futuristic city at dawn',
  'Plan a content calendar for a design studio on Instagram',
]

function timeOf(ts: number) {
  return fmtTime(ts)
}
// ~3 characters per token; 8192-token window minus room for the answer.
const LOCAL_BUDGET = (8192 - 1800) * 3
function fitToBudget<T extends { content: string }>(msgs: T[], budget: number): T[] {
  const out: T[] = []
  let used = 0
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    const len = m.content.length + 20
    if (used + len > budget) {
      if (!out.length) out.unshift({ ...m, content: m.content.slice(-Math.max(500, budget - used)) })
      break
    }
    out.unshift(m)
    used += len
  }
  return out
}
function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}
function cleanError(e: unknown) {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'ME'
  )
}

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [userName, setUserName] = useState('')
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    try {
      return (localStorage.getItem('orbi-theme') as ThemeMode) || 'light'
    } catch {
      return 'light'
    }
  })
  const [themeReady, setThemeReady] = useState(false)
  const [setupOpen, setSetupOpen] = useState<null | number>(null)
  const [creativeMounted, setCreativeMounted] = useState(false)
  const [doneToast, setDoneToast] = useState<ActivityDone | null>(null)
  const activities = useActivities()
  const [panelOpen, setPanelOpen] = useState(false)
  const [activeNav, setActiveNav] = useState<NavKey>('chats')
  const [profileOpen, setProfileOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState<null | SettingsTab>(null)
  const [lang, setLangState] = useState<Lang>('en')
  const [webOn, setWebOn] = useState(false)
  const [voiceMode, setVoiceMode] = useState<VoiceMode | null>(null)
  const [voicePicker, setVoicePicker] = useState(false)
  const [recording, setRecording] = useState<null | { stop: () => Promise<string>; started: number }>(null)
  const [transcribing, setTranscribing] = useState(false)
  const [speaking, setSpeaking] = useState<string | null>(null)
  const [suggestIdx, setSuggestIdx] = useState(0)
  const [suggestClosed, setSuggestClosed] = useState(false)
  const [headerMenu, setHeaderMenu] = useState<HeaderMenu>(null)
  const [modelSearch, setModelSearch] = useState('')

  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelErrors, setModelErrors] = useState<{ provider: string; message: string }[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const [selectedModel, setSelectedModel] = useState('')
  const [additionalModels, setAdditionalModels] = useState<string[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [servers, setServers] = useState<McpServer[]>([])
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [localStatus, setLocalStatus] = useState<LocalStatus | null>(null)
  const [palette, setPalette] = useState<null | 'commands' | 'chats'>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findResult, setFindResult] = useState<{ matches: number; active: number } | null>(null)
  const [termMounted, setTermMounted] = useState(false)
  const [termOpen, setTermOpen] = useState(false)
  const [termHeight, setTermHeight] = useState(280)
  const [termMax, setTermMax] = useState(false)
  const [approval, setApproval] = useState<null | { id: string; server: string; tool: string; message: string }>(null)
  const [alwaysAllow, setAlwaysAllow] = useState(false)
  const terminalRef = useRef<TerminalHandle>(null)
  const activeOverride = useRef<string[]>([])
  const installedSig = useRef<string | null>(null)
  const activeSkills = useMemo(() => skills.filter((k) => k.enabled).map((k) => k.name), [skills])
  const [activeAgents, setActiveAgents] = useState<string[]>([])
  const [responseType, setResponseType] = useState<ResponseType>('Instant')
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('Medium')
  const [prefsReady, setPrefsReady] = useState(false)
  useEffect(() => {
    if (prefsReady) api.setSetting('chatPrefs', { agents: activeAgents, compare: additionalModels, mode: responseType, effort: reasoningEffort })
  }, [activeAgents, additionalModels, responseType, reasoningEffort, prefsReady])
  const [responseMenuOpen, setResponseMenuOpen] = useState(false)
  const [memoryEnabled, setMemoryEnabled] = useState(true)

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [memories, setMemories] = useState<Memory[]>([])
  const [bookmarks, setBookmarks] = useState<Message[]>([])
  const [media, setMedia] = useState<MediaItem[]>([])

  const [message, setMessage] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [temporaryChat, setTemporaryChat] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [leftPanelWidth, setLeftPanelWidth] = useState(252)
  const [rightPanelWidth, setRightPanelWidth] = useState(300)
  const [notice, setNotice] = useState<string | null>(null)

  const streams = useRef(new Map<string, string>()) // reqId -> message id
  const buffers = useRef(new Map<string, string>()) // message id -> streamed text
  const toolLogs = useRef(new Map<string, ToolEvent[]>()) // message id -> tool calls
  const finishers = useRef(new Map<string, (r: { ok: boolean; error?: string; aborted?: boolean }) => void>()) // reqId -> resolve
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isStreaming = messages.some((m) => m.streaming)
  useEffect(() => {
    if (!isStreaming) return
    const id = activity.start({ area: 'chats', kind: 'chat', label: t('Writing an answer') })
    return () => activity.end(id, { ok: true, message: t('The answer is ready.') })
  }, [isStreaming])
  const activeNavRef = useRef(activeNav)
  activeNavRef.current = activeNav
  useEffect(
    () =>
      activity.onDone((a) => {
        // Only announce when the user is somewhere else.
        if (activeNavRef.current !== a.area) setDoneToast(a)
      }),
    [],
  )
  useEffect(() => {
    if (!doneToast) return
    const tm = setTimeout(() => setDoneToast(null), 9000)
    return () => clearTimeout(tm)
  }, [doneToast])
  useEffect(() => {
    if (activeNav === 'creative') setCreativeMounted(true)
  }, [activeNav])
  const currentModel = models.find((m) => m.key === selectedModel)
  const chatModels = useMemo(() => models.filter((m) => !m.image || !/image/i.test(m.id)), [models])

  // ---------- loading ----------
  const loadModels = useCallback(async () => {
    setModelsLoading(true)
    try {
      const r = await api.models()
      setModels(r.models)
      setModelErrors(r.errors)
      setSelectedModel((cur) => {
        if (cur && r.models.some((m) => m.key === cur)) return cur
        const preferred = r.models.find((m) => /gpt-4\.1|gpt-4o-mini|claude.*sonnet|gemini.*flash/i.test(m.id) && !m.image) ?? r.models.find((m) => !m.image) ?? r.models[0]
        return preferred?.key ?? ''
      })
    } finally {
      setModelsLoading(false)
    }
  }, [])

  const refreshLists = useCallback(async () => {
    const [c, p, a, mem, b, med, sk, srv, pl] = await Promise.all([
      api.conversations(),
      api.projects(),
      api.agents(),
      api.memories(),
      api.bookmarks(),
      api.media(),
      api.skills(),
      api.mcpStatus(),
      api.plugins(),
    ])
    setSkills(sk ?? [])
    setServers(srv ?? [])
    setPlugins(pl ?? [])
    setConversations(c)
    setProjects(p)
    setAgents(a)
    setMemories(mem)
    setBookmarks(b)
    setMedia(med)
  }, [])

  useEffect(() => {
    ;(async () => {
      const i = await api.info()
      setInfo(i)
      setUserName(i.userName)
      const savedTheme = await api.getSetting<ThemeMode | null>('theme', null)
      if (savedTheme) setThemeMode(savedTheme)
      setThemeReady(true)
      if (!(await api.getSetting('onboarded', false))) setSetupOpen(0)
      const l = await api.getSetting<Lang>('language', 'en')
      applyLang(l)
      setLangState(l)
      setVoiceMode(await api.getSetting<VoiceMode | null>('voiceMode', null))
      setWebOn(await api.getSetting('webSearch', false))
      setSelectedModel(await api.getSetting('selectedModel', ''))
      api.localStatus().then(setLocalStatus)
      api.getSetting('terminalOpen', false).then((v) => v && openTerminal())
      setMemoryEnabled(await api.getSetting('memoryEnabled', true))
      // Chat preferences survive restarts and updates.
      const prefs = await api.getSetting<{ agents?: string[]; compare?: string[]; mode?: ResponseType; effort?: ReasoningEffort } | null>('chatPrefs', null)
      if (prefs) {
        if (Array.isArray(prefs.agents)) setActiveAgents(prefs.agents)
        if (Array.isArray(prefs.compare)) setAdditionalModels(prefs.compare)
        if (prefs.mode) setResponseType(prefs.mode)
        if (prefs.effort) setReasoningEffort(prefs.effort)
      }
      setPrefsReady(true)
      await refreshLists()
      await loadModels()
    })()
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
    try {
      localStorage.setItem('orbi-theme', themeMode)
    } catch {
      /* storage unavailable */
    }
    // Save only after the stored choice was loaded, so the default never overwrites it.
    if (themeReady) api.setSetting('theme', themeMode)
  }, [themeMode, themeReady])
  useEffect(() => {
    if (selectedModel) api.setSetting('selectedModel', selectedModel)
  }, [selectedModel])
  // live updates from the main process
  useEffect(() => {
    const offs = [
      on('local:status', (s: LocalStatus) => {
        setLocalStatus(s)
        // A model finished downloading: refresh the model menus.
        const sig = s.models.filter((m) => m.installed).map((m) => m.id).join(',')
        if (installedSig.current !== null && installedSig.current !== sig) loadModels()
        installedSig.current = sig
      }),
      on('local:error', (e: { id: string; message: string }) => setNotice(`${e.id}: ${e.message}`)),
      on('data:changed', () => refreshLists()),
      on('tool:approve', (id: string, req: { server: string; tool: string; message: string }) => setApproval({ id, ...req })),
      on('find:result', (r: { matches: number; active: number }) => setFindResult(r)),
    ]
    const t = setInterval(() => api.mcpStatus().then((s) => s && setServers(s)), 15000)
    return () => {
      offs.forEach((f) => f())
      clearInterval(t)
    }
  }, [])

  // title bar overlay colors follow the theme
  useEffect(() => {
    const c = themeMode === 'light' ? ['#e6ece8', '#27332c'] : themeMode === 'dark' ? ['#0e1012', '#d6dbd8'] : ['#040705', '#58f28b']
    api.win.overlay(c[0], c[1])
  }, [themeMode])

  useEffect(() => {
    document.body.classList.toggle('term-open', termOpen)
    document.documentElement.style.setProperty('--term-h', termOpen ? `${termMax ? Math.max(200, window.innerHeight - 140) : termHeight}px` : '0px')
    if (termMounted) api.setSetting('terminalOpen', termOpen)
  }, [termOpen, termHeight, termMax])
  useEffect(() => {
    api.setSetting('memoryEnabled', memoryEnabled)
  }, [memoryEnabled])
  const changeLang = (l: Lang) => {
    applyLang(l)
    setLangState(l)
    api.setSetting('language', l)
  }
  const toggleWeb = () =>
    setWebOn((v) => {
      api.setSetting('webSearch', !v)
      return !v
    })

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4500)
    return () => clearTimeout(t)
  }, [notice])

  // streaming deltas
  useEffect(
    () =>
      bridge.onChatDelta((reqId, delta) => {
        if (delta.done) {
          finishers.current.get(reqId)?.(delta.done)
          return
        }
        const id = streams.current.get(reqId)
        if (!id) return
        if (delta.text) buffers.current.set(id, (buffers.current.get(id) ?? '') + delta.text)
        if (delta.tool) {
          const ev = delta.tool
          const list = toolLogs.current.get(id) ?? []
          const i = list.findIndex((t) => t.id === ev.id)
          const next = i >= 0 ? list.map((t, j) => (j === i ? { ...t, ...ev, args: ev.args ?? t.args } : t)) : [...list, ev]
          toolLogs.current.set(id, next)
          setMessages((cur) => cur.map((m) => (m.id === id ? { ...m, tools: next } : m)))
          return
        }
        setMessages((cur) =>
          cur.map((m) => (m.id === id ? { ...m, content: m.content + (delta.text ?? ''), reasoning: (m.reasoning ?? '') + (delta.reasoning ?? '') } : m)),
        )
      }),
    [],
  )

  // autoscroll
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 240
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [messages])

  // textarea autosize
  useEffect(() => {
    const t = textareaRef.current
    if (!t) return
    t.style.height = 'auto'
    t.style.height = Math.min(t.scrollHeight, 220) + 'px'
  }, [message])

  // ---------- helpers ----------
  const toggleHeaderMenu = (menu: Exclude<HeaderMenu, null>) => {
    setModelSearch('')
    setHeaderMenu((cur) => (cur === menu ? null : menu))
  }
  const toggle = (value: string, list: string[], set: (v: string[]) => void) => set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value])

  const startPanelResize = (side: 'left' | 'right', event: ReactPointerEvent<HTMLButtonElement>) => {
    if (window.innerWidth < 1024) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = side === 'left' ? leftPanelWidth : rightPanelWidth
    const move = (ev: PointerEvent) => {
      const delta = ev.clientX - startX
      const next = side === 'left' ? startWidth + delta : startWidth - delta
      if (side === 'left') setLeftPanelWidth(Math.min(380, Math.max(220, next)))
      else setRightPanelWidth(Math.min(420, Math.max(260, next)))
    }
    const stop = () => {
      document.body.classList.remove('panel-is-resizing')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    document.body.classList.add('panel-is-resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const systemPrompt = (target?: ModelInfo) => {
    // Tiny local models have small context windows and get confused by long instructions.
    if (target?.provider === 'orbi') {
      const a = activeAgentList()[0]
      return [`You are Orbi, a helpful assistant. The user's name is ${userName}. Answer briefly, in the user's language.`, a ? a.instructions.slice(0, 600) : '']
        .filter(Boolean)
        .join('\n')
    }
    const parts = [
      `You are Orbi, a helpful AI assistant and creative partner made by OrbiX. Today is ${new Date().toLocaleDateString('en-US', { dateStyle: 'full' })}. The user's name is ${userName}. Answer in the user's language. Use Markdown when it helps.`,
    ]
    const chosen = agents.filter((a) => activeAgents.includes(a.handle) || activeOverride.current.includes(a.handle))
    const skillNames = new Set(activeSkills)
    for (const a of chosen) {
      if (a.skills_mode === 'all') skills.forEach((k) => skillNames.add(k.name))
      if (a.skills_mode === 'selected') parseJSON<string[]>(a.skills, []).forEach((n) => skillNames.add(n))
    }
    for (const k of skills.filter((k) => skillNames.has(k.name))) parts.push(`Skill — ${k.name}: ${k.instructions}`)
    if (chosen.length === 1) parts.push(`You are acting as the agent ${chosen[0].handle}${chosen[0].description ? ` (${chosen[0].description})` : ''}:\n${chosen[0].instructions}`)
    else if (chosen.length) parts.push('Active agents (combine their perspectives, label each when they differ):\n' + chosen.map((a) => `${a.handle}: ${a.instructions}`).join('\n'))
    parts.push(`The user's computer runs ${info?.platform === 'win32' ? 'Windows (PowerShell)' : info?.platform === 'darwin' ? 'macOS (zsh)' : 'Linux (bash)'}. Orbi has a built-in terminal: shell commands you put in fenced code blocks get a "Run in terminal" button.`)
    if (memoryEnabled && memories.length && !temporaryChat) parts.push('What you remember about the user:\n' + memories.map((m) => `- ${m.content}`).join('\n'))
    return parts.join('\n\n')
  }

  const activeAgentList = () => agents.filter((a) => activeAgents.includes(a.handle) || activeOverride.current.includes(a.handle))
  const agentToolServers = () => {
    const list = activeAgentList().flatMap((a) => parseJSON<string[]>(a.tools, []))
    return list.length ? [...new Set(list)] : null
  }
  const primaryModel = () => {
    const withModel = activeAgentList().find((a) => a.model)
    return (withModel && models.find((m) => m.key === withModel.model)) || currentModel
  }

  const toPayloadMessage = (m: ChatMessage) => {
    const atts = parseAttachments(m.attachments)
    const texts = atts.filter((a) => a.text).map((a) => `\n\n<file name="${a.name}">\n${a.text}\n</file>`)
    const images = atts.filter((a) => a.dataUrl && a.mime.startsWith('image/')).map((a) => a.dataUrl!)
    return { role: m.role, content: m.content + texts.join(''), images: images.length ? images : undefined }
  }

  const streamInto = async (target: ModelInfo, history: ChatMessage[], convId: string | null, extra?: { context: string; tool: ToolEvent }) => {
    const reqId = uid()
    const msgId = uid()
    const placeholder: ChatMessage = {
      id: msgId,
      conversation_id: convId ?? 'temp',
      role: 'assistant',
      content: '',
      model: `${target.name} · ${target.providerName}`,
      attachments: '[]',
      bookmarked: 0,
      created_at: Date.now(),
      streaming: true,
      temp: true,
      tools: extra ? [extra.tool] : undefined,
    }
    streams.current.set(reqId, msgId)
    if (extra) toolLogs.current.set(msgId, [extra.tool])
    buffers.current.set(msgId, '')
    setMessages((cur) => [...cur, placeholder])
    const finished = new Promise<{ ok: boolean; error?: string; aborted?: boolean }>((resolve) => finishers.current.set(reqId, resolve))
    // Local models have an 8k-token window: keep the system prompt, web results and history inside it.
    const local = target.provider === 'orbi'
    const webCtx = extra?.context ? (local ? extra.context.slice(0, 5000) : extra.context) : ''
    const sys = [systemPrompt(target), webCtx].filter(Boolean).join('\n\n')
    let payloadMsgs = history.filter((m) => !m.error).map(toPayloadMessage)
    // Text-only local models reject images: send a note instead and say which models can see.
    if (local && !target.vision && payloadMsgs.some((m) => m.images?.length)) {
      payloadMsgs = payloadMsgs.map((m) =>
        m.images?.length ? { ...m, images: undefined, content: `${m.content}\n\n[${m.images.length} image(s) attached — this model cannot see images, answer from the text only.]` } : m,
      )
      setNotice(t('{model} can’t see images. For pictures, use Gemma 3 4B or Qwen3-VL 4B (Settings → Local models) or a cloud model.', { model: target.name.replace(' (local)', '') }))
    }
    const invoked = api.sendChat(reqId, {
      providerId: target.provider,
      model: target.id,
      system: local ? sys.slice(0, LOCAL_BUDGET / 3) : sys,
      thinking: responseType === 'Thinking',
      effort: reasoningEffort,
      messages: local ? fitToBudget(payloadMsgs, LOCAL_BUDGET - Math.min(sys.length, LOCAL_BUDGET / 3)) : payloadMsgs,
      toolServers: agentToolServers(),
    })
    // Wait for the in-band "done" event; fall back to the invoke reply if it never comes (browser preview).
    const res = await Promise.race([finished, invoked.then((r) => new Promise<typeof r>((ok) => setTimeout(() => ok(r), isDesktop ? 15000 : 0)))])
    finishers.current.delete(reqId)
    streams.current.delete(reqId)
    const toolList = toolLogs.current.get(msgId) ?? []
    toolLogs.current.delete(msgId)
    const finalText = buffers.current.get(msgId) ?? ''
    buffers.current.delete(msgId)
    setMessages((cur) =>
      cur.map((m) => {
        if (m.id !== msgId) return m
        if (!res.ok) return { ...m, streaming: false, error: true, content: res.error || t('Something went wrong.') }
        return { ...m, streaming: false, content: m.content || (res.aborted ? `_${t('Stopped.')}_` : '') }
      }),
    )
    if (res.ok && convId && finalText) {
      const saved = await api.addMessage({ id: msgId, conversation_id: convId, role: 'assistant', content: finalText, model: placeholder.model, attachments: [], tools: toolList })
      setMessages((cur) => cur.map((m) => (m.id === msgId ? { ...m, temp: false, created_at: saved.created_at } : m)))
    }
    return { reqId, ok: res.ok, text: finalText }
  }

  const sendMessage = async (raw: string, regenerate = false) => {
    let text = raw
    let forceWeb = false
    const cmd = text.trim().match(/^\/([\w-]+)\s*([\s\S]*)$/)
    if (cmd && !regenerate) {
      const [, name, rest] = cmd
      if (name === 'clear') return startNewChat()
      if (name === 'terminal') {
        setMessage('')
        return openTerminal()
      }
      if (name === 'image') {
        setMessage('')
        if (rest.trim()) await api.setSetting('studioPrompt', rest.trim())
        return toggleNavigation('creative')
      }
      if (name === 'web') {
        forceWeb = true
        text = rest
      }
      const sk = skills.find((k) => slug(k.name) === name.toLowerCase())
      if (sk) {
        if (!sk.enabled) await api.toggleSkill(sk.id, true).then(refreshLists)
        text = rest
        if (!rest.trim()) return setMessage('')
      }
    }
    // @agent mentions activate agents for this chat
    if (!regenerate) {
      const found = agents.filter((a) => text.split(/\s+/).includes(a.handle)).map((a) => a.handle)
      if (found.length) setActiveAgents((cur) => [...new Set([...cur, ...found])])
      activeOverride.current = found
    }
    const content = text.trim()
    if ((!content && !attachments.length) || isStreaming) return
    const currentModel = primaryModel()
    if (!currentModel) {
      setNotice(models.length ? t('Pick a model first.') : t('Connect an AI provider to start chatting.'))
      if (!models.length) setSettingsOpen('providers')
      return
    }

    let convId = conversationId
    const isNew = !convId && !temporaryChat
    if (isNew) {
      const title = content.length > 40 ? content.slice(0, 40) + '…' : content || attachments[0]?.name || 'New chat'
      const conv = await api.createConversation({ title, project_id: activeProjectId, model: currentModel.key })
      convId = conv.id
      setConversationId(conv.id)
    }
    if (temporaryChat) convId = null

    let history = messages
    if (!regenerate) {
      const userMsg: ChatMessage = {
        id: uid(),
        conversation_id: convId ?? 'temp',
        role: 'user',
        content,
        model: '',
        attachments,
        bookmarked: 0,
        created_at: Date.now(),
      }
      history = [...messages, userMsg]
      setMessages(history)
      setMessage('')
      setAttachments([])
      if (convId) await api.addMessage({ ...userMsg, attachments })
    }
    if (!temporaryChat) setContextOpen(true)

    const targets = [currentModel, ...additionalModels.map((k) => models.find((m) => m.key === k)).filter((m): m is ModelInfo => !!m && m.key !== currentModel.key)]
    const extra = (webOn || forceWeb) && content ? await webContext(content) : undefined
    const results = await Promise.all(targets.map((m) => streamInto(m, history, convId, extra)))

    if (isNew && convId && results[0]?.ok && currentModel.provider !== 'orbi') {
      const title = await api.titleFor({ providerId: currentModel.provider, model: currentModel.id, messages: [{ role: 'user', content: content.slice(0, 1500) }] })
      if (title) await api.updateConversation(convId, { title })
    }
    if (convId) refreshLists()
  }

  const stop = () => {
    for (const reqId of streams.current.keys()) api.abortChat(reqId)
  }

  // Web search runs before the model, so it works with any model (even ones without tool calling).
  const webContext = async (q: string): Promise<{ context: string; tool: ToolEvent } | undefined> => {
    setNotice(t('Searching the web…'))
    try {
      const r = await api.webSearch(q.slice(0, 300), { read: 3 })
      setNotice(null)
      if (!r.results.length) {
        setNotice(t('The web search found nothing — answering without it.'))
        return undefined
      }
      return {
        context: `Web results for the user's latest question. Use them, and cite sources inline as [n](url):\n${r.context}`,
        tool: {
          id: uid(),
          name: 'orbi-core__web_search',
          status: 'done',
          args: { query: q },
          result: `${r.results.length} results · ${r.engine}`,
          sources: r.results.slice(0, 8).map(({ title, url, snippet }) => ({ title, url, snippet })),
        },
      }
    } catch (e) {
      setNotice(`${t('Web search failed')}: ${cleanError(e)}`)
      return undefined
    }
  }

  // ---------- voice ----------
  const startVoice = async (mode = voiceMode) => {
    if (recording) {
      const rec = recording
      setRecording(null)
      setTranscribing(true)
      try {
        const wav = await rec.stop()
        const text = await api.transcribe({ wav, mode: mode!, language: lang.slice(0, 2) })
        if (text.trim()) setMessage((m) => (m ? m.replace(/\s*$/, ' ') : '') + text.trim())
        textareaRef.current?.focus()
      } catch (e) {
        setNotice(cleanError(e))
      } finally {
        setTranscribing(false)
      }
      return
    }
    if (!mode) return setVoicePicker(true)
    try {
      const stopFn = await recordWav()
      setRecording({ stop: stopFn, started: Date.now() })
    } catch (e) {
      setNotice(`${t('Microphone unavailable')}: ${cleanError(e)}`)
    }
  }
  const speak = (m: ChatMessage) => {
    const synth = window.speechSynthesis
    if (!synth) return setNotice(t('This system has no voices for reading aloud.'))
    if (speaking === m.id) {
      synth.cancel()
      setSpeaking(null)
      return
    }
    synth.cancel()
    const plain = m.content.replace(/```[\s\S]*?```/g, ' ').replace(/\]\([^)]*\)/g, ']').replace(/[#*_>`~[\]]/g, '')
    const u = new SpeechSynthesisUtterance(plain.slice(0, 6000))
    u.lang = lang === 'en' ? 'en-US' : lang
    u.onend = u.onerror = () => setSpeaking(null)
    setSpeaking(m.id)
    synth.speak(u)
  }

  const regenerate = async () => {
    if (isStreaming) return
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    if (!lastUser) return
    const idx = messages.lastIndexOf(lastUser)
    const removed = messages.slice(idx + 1)
    for (const m of removed) if (!m.temp && conversationId) await api.deleteMessage(m.id)
    const kept = messages.slice(0, idx + 1)
    setMessages(kept)
    await new Promise((r) => setTimeout(r, 0))
    const first = primaryModel()
    const targets = [first, ...additionalModels.map((k) => models.find((m) => m.key === k))].filter((m): m is ModelInfo => !!m)
    if (!targets.length) return
    await Promise.all(targets.map((t) => streamInto(t, kept, temporaryChat ? null : conversationId)))
    refreshLists()
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    sendMessage(message)
  }

  const openConversation = async (id: string) => {
    if (isStreaming) stop()
    setTemporaryChat(false)
    setActiveNav('chats')
    setConversationId(id)
    const msgs = await api.messages(id)
    setMessages(msgs)
    setContextOpen(true)
    if (window.innerWidth < 1024) setPanelOpen(false)
    requestAnimationFrame(() => scrollRef.current && (scrollRef.current.scrollTop = scrollRef.current.scrollHeight))
  }

  const startNewChat = () => {
    if (isStreaming) stop()
    setConversationId(null)
    setMessages([])
    setMessage('')
    setAttachments([])
    setContextOpen(false)
    textareaRef.current?.focus()
  }

  const toggleNavigation = (section: NavKey) => {
    if (section === 'creative' || section === 'explore') {
      setActiveNav(section)
      setPanelOpen(false)
      setContextOpen(false)
      return
    }
    if (activeNav === section) {
      setPanelOpen((v) => !v)
      return
    }
    setActiveNav(section)
    setPanelOpen(true)
  }

  const toggleTemporaryChat = () => {
    if (isStreaming) stop()
    setTemporaryChat((v) => !v)
    setConversationId(null)
    setMessages([])
    setMessage('')
    setAttachments([])
    setContextOpen(false)
  }

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, 8)
    const read = await Promise.all(list.map(readFileAsAttachment))
    setAttachments((cur) => [...cur, ...read])
  }


  // ---------- terminal ----------
  const openTerminal = () => {
    setTermMounted(true)
    setTermOpen(true)
  }
  const runInTerminal = (code: string) => {
    const wasMounted = termMounted
    openTerminal()
    setTimeout(() => terminalRef.current?.run(code, true), wasMounted ? 50 : 900)
  }

  const goNav = (section: NavKey) => {
    if (section === 'creative' || section === 'explore') return toggleNavigation(section)
    setActiveNav(section)
    setPanelOpen(true)
  }
  const chatWithAgent = (handle: string) => {
    startNewChat()
    setTemporaryChat(false)
    setActiveAgents([handle])
    setActiveNav('chats')
    setPanelOpen(false)
  }
  const lastAnswer = () => [...messages].reverse().find((m) => m.role === 'assistant' && !m.error)
  const stepChat = (dir: 1 | -1) => {
    if (!conversations.length) return
    const i = conversations.findIndex((c) => c.id === conversationId)
    const next = conversations[(i + dir + conversations.length) % conversations.length] ?? conversations[0]
    openConversation(next.id)
  }
  const selectionText = () => window.getSelection()?.toString() ?? ''

  const commandList: Command[] = [
    // File
    { id: 'file.newChat', category: 'File', label: 'New Chat', shortcut: 'Ctrl+N', run: () => { setTemporaryChat(false); startNewChat(); setActiveNav('chats') } },
    { id: 'file.newTemp', category: 'File', label: 'New Temporary Chat', shortcut: 'Ctrl+Alt+N', run: () => { if (!temporaryChat) toggleTemporaryChat(); else startNewChat() } },
    { id: 'file.newWindow', category: 'File', label: 'New Window', shortcut: 'Ctrl+Shift+N', run: () => api.win.new() },
    { id: 'file.newProject', category: 'File', label: 'New Project…', run: () => goNav('chats') },
    { id: 'file.openFile', category: 'File', label: 'Open File…', shortcut: 'Ctrl+O', run: () => fileInput.current?.click() },
    { id: 'file.import', category: 'File', label: 'Import to Media Library…', run: () => goNav('media') },
    { id: 'file.export', category: 'File', label: 'Export Chat as Markdown…', shortcut: 'Ctrl+S', enabled: !!conversationId, run: () => conversationId && api.exportConversation(conversationId).then((ok) => ok && setNotice(t('Chat exported.'))) },
    { id: 'file.settings', category: 'File', label: 'Settings', shortcut: 'Ctrl+,', run: () => setSettingsOpen('general') },
    { id: 'file.localAI', category: 'File', label: 'Local AI Models…', run: () => setSettingsOpen('models') },
    { id: 'file.closeChat', category: 'File', label: 'Close Chat', shortcut: 'Ctrl+F4', run: () => startNewChat() },
    { id: 'file.closeWindow', category: 'File', label: 'Close Window', shortcut: 'Alt+F4', run: () => api.win.close() },
    { id: 'file.exit', category: 'File', label: 'Exit', run: () => api.win.quit() },
    // Edit
    { id: 'edit.undo', category: 'Edit', label: 'Undo', shortcut: 'Ctrl+Z', run: () => api.edit('undo') },
    { id: 'edit.redo', category: 'Edit', label: 'Redo', shortcut: 'Ctrl+Y', run: () => api.edit('redo') },
    { id: 'edit.cut', category: 'Edit', label: 'Cut', shortcut: 'Ctrl+X', run: () => api.edit('cut') },
    { id: 'edit.copy', category: 'Edit', label: 'Copy', shortcut: 'Ctrl+C', run: () => api.edit('copy') },
    { id: 'edit.paste', category: 'Edit', label: 'Paste', shortcut: 'Ctrl+V', run: () => { textareaRef.current?.focus(); api.edit('paste') } },
    { id: 'edit.find', category: 'Edit', label: 'Find in Chat', shortcut: 'Ctrl+F', run: () => setFindOpen(true) },
    { id: 'edit.searchChats', category: 'Edit', label: 'Search Chats', shortcut: 'Ctrl+Shift+F', run: () => setPalette('chats') },
    { id: 'edit.copyAnswer', category: 'Edit', label: 'Copy Last Answer', shortcut: 'Ctrl+Shift+C', enabled: !!lastAnswer(), run: () => { const a = lastAnswer(); if (a) { navigator.clipboard.writeText(a.content); setNotice(t('Last answer copied.')) } } },
    { id: 'edit.clearComposer', category: 'Edit', label: 'Clear Message Box', run: () => { setMessage(''); setAttachments([]) } },
    // Selection
    { id: 'sel.all', category: 'Selection', label: 'Select All', shortcut: 'Ctrl+A', run: () => api.edit('selectAll') },
    { id: 'sel.lastAnswer', category: 'Selection', label: 'Select Last Answer', run: () => { const els = document.querySelectorAll('.message-assistant'); const el = els[els.length - 1]; if (el) { const r = document.createRange(); r.selectNodeContents(el); const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(r) } } },
    { id: 'sel.copy', category: 'Selection', label: 'Copy Selection', run: () => navigator.clipboard.writeText(selectionText()) },
    { id: 'sel.quote', category: 'Selection', label: 'Quote Selection in Message', shortcut: 'Ctrl+L', run: () => { const t = selectionText(); if (t) { setMessage((m) => `${m ? m + '\n' : ''}> ${t.replace(/\n/g, '\n> ')}\n\n`); textareaRef.current?.focus() } } },
    { id: 'sel.runTerminal', category: 'Selection', label: 'Run Selection in Terminal', shortcut: 'Ctrl+Shift+Enter', run: () => { const t = selectionText(); if (t) runInTerminal(t) } },
    { id: 'sel.clear', category: 'Selection', label: 'Clear Selection', run: () => window.getSelection()?.removeAllRanges() },
    // View
    { id: 'view.palette', category: 'View', label: 'Command Palette…', shortcut: 'Ctrl+Shift+P', run: () => setPalette('commands') },
    { id: 'view.sidebar', category: 'View', label: 'Toggle Sidebar', shortcut: 'Ctrl+B', run: () => (activeNav === 'creative' || activeNav === 'explore' ? goNav('chats') : setPanelOpen((v) => !v)) },
    { id: 'view.workspace', category: 'View', label: 'Toggle Workspace Panel', shortcut: 'Ctrl+Alt+B', run: () => setContextOpen((v) => !v) },
    { id: 'view.terminal', category: 'View', label: 'Terminal', shortcut: 'Ctrl+`', checked: termOpen, run: () => (termOpen ? setTermOpen(false) : openTerminal()) },
    { id: 'view.light', category: 'View', label: 'Light Theme', checked: themeMode === 'light', run: () => setThemeMode('light') },
    { id: 'view.dark', category: 'View', label: 'Dark Theme', checked: themeMode === 'dark', run: () => setThemeMode('dark') },
    { id: 'view.terminalTheme', category: 'View', label: 'Terminal Theme', checked: themeMode === 'terminal', run: () => setThemeMode('terminal') },
    { id: 'view.zoomIn', category: 'View', label: 'Zoom In', shortcut: 'Ctrl+=', run: () => api.win.zoom(1) },
    { id: 'view.zoomOut', category: 'View', label: 'Zoom Out', shortcut: 'Ctrl+-', run: () => api.win.zoom(-1) },
    { id: 'view.zoomReset', category: 'View', label: 'Reset Zoom', shortcut: 'Ctrl+0', run: () => api.win.zoom(0) },
    { id: 'view.fullscreen', category: 'View', label: 'Full Screen', shortcut: 'F11', run: () => api.win.fullscreen() },
    // Go
    ...navItems.map((n, i) => ({ id: `go.${n.id}`, category: 'Go', label: n.label, shortcut: i < 9 ? `Alt+${i + 1}` : undefined, checked: activeNav === n.id && (n.id === 'creative' || n.id === 'explore' || panelOpen), run: () => goNav(n.id) })),
    { id: 'go.nextChat', category: 'Go', label: 'Next Chat', shortcut: 'Alt+Down', run: () => stepChat(1) },
    { id: 'go.prevChat', category: 'Go', label: 'Previous Chat', shortcut: 'Alt+Up', run: () => stepChat(-1) },
    { id: 'go.chat', category: 'Go', label: 'Go to Chat…', shortcut: 'Ctrl+P', run: () => setPalette('chats') },
    // Terminal
    { id: 'term.new', category: 'Terminal', label: 'New Terminal', shortcut: 'Ctrl+Shift+`', run: () => { if (termMounted) { setTermOpen(true); terminalRef.current?.newTerminal() } else openTerminal() } },
    { id: 'term.toggle', category: 'Terminal', label: 'Toggle Terminal', shortcut: 'Ctrl+`', run: () => (termOpen ? setTermOpen(false) : openTerminal()) },
    { id: 'term.clear', category: 'Terminal', label: 'Clear Terminal', enabled: termMounted, run: () => terminalRef.current?.clear() },
    { id: 'term.kill', category: 'Terminal', label: 'Kill Terminal', enabled: termMounted, run: () => terminalRef.current?.killActive() },
    { id: 'term.runSelection', category: 'Terminal', label: 'Run Selected Text', run: () => { const t = selectionText(); if (t) runInTerminal(t); else setNotice(tr('Select some text first.')) } },
    { id: 'term.runLastCode', category: 'Terminal', label: 'Run Last Code Block', run: () => { const a = lastAnswer(); const m = a?.content.match(/```(?:bash|sh|shell|zsh|powershell|ps1|pwsh|cmd|console)?\n([\s\S]*?)```(?![\s\S]*```)/); if (m) runInTerminal(m[1]); else setNotice(t('No shell code block in the last answer.')) } },
    { id: 'term.workspace', category: 'Terminal', label: 'Open Workspace Folder in Terminal', run: async () => { const dir = await api.workspaceDir(); runInTerminal(`cd "${dir}"`) } },
    // Help
    { id: 'help.welcome', category: 'Help', label: 'Welcome', run: () => { setTemporaryChat(false); startNewChat(); setActiveNav('chats') } },
    { id: 'help.setup', category: 'Help', label: 'Setup Assistant…', run: () => setSetupOpen(0) },
    { id: 'help.commands', category: 'Help', label: 'Show All Commands', shortcut: 'Ctrl+Shift+P', run: () => setPalette('commands') },
    { id: 'help.docs', category: 'Help', label: 'Documentation', run: () => api.openExternal('https://github.com/iwerry/chatorbit-app#readme') },
    { id: 'help.issue', category: 'Help', label: 'Report Issue', run: () => api.openExternal('https://github.com/iwerry/chatorbit-app/issues/new') },
    { id: 'help.devtools', category: 'Help', label: 'Toggle Developer Tools', shortcut: 'Ctrl+Shift+I', run: () => api.win.devtools() },
    { id: 'help.reload', category: 'Help', label: 'Reload Window', shortcut: 'Ctrl+R', run: () => api.win.reload() },
    { id: 'help.data', category: 'Help', label: 'Open Data Folder', run: () => api.revealData() },
    { id: 'help.updates', category: 'Help', label: 'Check for Updates…', run: () => api.checkUpdate().then((s) => setNotice(s.status === 'current' ? t('You have the latest version.') : s.status === 'error' ? `${t('Could not check')}: ${s.error}` : t('Version {v} is available.', { v: s.latest?.version || '' }))) },
    { id: 'help.about', category: 'Help', label: 'About Orbi', run: () => setSettingsOpen('about') },
  ]
  const commands = Object.fromEntries(commandList.map((c) => [c.id, c]))
  const menus: MenuDef[] = [
    { label: 'File', items: ['file.newChat', 'file.newTemp', 'file.newWindow', 'file.newProject', '-', 'file.openFile', 'file.import', '-', 'file.export', '-', 'file.settings', 'file.localAI', '-', 'file.closeChat', 'file.closeWindow', '-', 'file.exit'] },
    { label: 'Edit', items: ['edit.undo', 'edit.redo', '-', 'edit.cut', 'edit.copy', 'edit.paste', '-', 'edit.find', 'edit.searchChats', '-', 'edit.copyAnswer', 'edit.clearComposer'] },
    { label: 'Selection', items: ['sel.all', 'sel.lastAnswer', '-', 'sel.copy', 'sel.quote', '-', 'sel.runTerminal', 'sel.clear'] },
    { label: 'View', items: ['view.palette', '-', 'go.chats', 'go.creative', 'go.explore', 'go.agents', 'go.skills', 'go.mcp', 'go.media', '-', 'view.sidebar', 'view.workspace', 'view.terminal', '-', { label: 'Appearance', submenu: ['view.light', 'view.dark', 'view.terminalTheme'] }, 'view.zoomIn', 'view.zoomOut', 'view.zoomReset', 'view.fullscreen'] },
    { label: 'Go', items: ['go.chats', 'go.creative', 'go.explore', 'go.agents', 'go.skills', 'go.mcp', 'go.scheduled', 'go.memory', 'go.bookmarks', 'go.media', '-', 'go.nextChat', 'go.prevChat', '-', 'go.chat'] },
    { label: 'Terminal', items: ['term.new', 'term.toggle', '-', 'term.runSelection', 'term.runLastCode', 'term.workspace', '-', 'term.clear', 'term.kill'] },
    { label: 'Help', items: ['help.welcome', 'help.setup', 'help.commands', 'help.docs', '-', 'help.issue', '-', 'help.devtools', 'help.reload', 'help.data', '-', 'help.updates', 'help.about'] },
  ]

  // keyboard shortcuts (native editing keys stay with the browser)
  const commandsRef = useRef(commandList)
  commandsRef.current = commandList
  useEffect(() => {
    const NATIVE = new Set(['Ctrl+Z', 'Ctrl+Y', 'Ctrl+X', 'Ctrl+C', 'Ctrl+V', 'Ctrl+A', 'Alt+F4'])
    const onKey = (e: KeyboardEvent) => {
      const keyName =
        e.code === 'Backquote'
          ? '`'
          : e.code.startsWith('Digit')
            ? e.code.slice(5)
            : e.key === 'ArrowDown'
              ? 'Down'
              : e.key === 'ArrowUp'
                ? 'Up'
                : e.key === '+'
                  ? '='
                  : e.key.length === 1
                    ? e.key.toUpperCase()
                    : e.key
      const combo = `${e.ctrlKey || e.metaKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey ? 'Shift+' : ''}${keyName}`
      if (NATIVE.has(combo)) return
      const inTerminal = (e.target as HTMLElement)?.closest?.('.terminal-panel')
      if (inTerminal && !combo.includes('`')) return
      const cmd = commandsRef.current.find((c) => c.shortcut === combo && c.enabled !== false)
      if (!cmd) return
      e.preventDefault()
      e.stopPropagation()
      cmd.run()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const installTinyModel = async () => {
    try {
      setNotice(t('Downloading a tiny local AI (≈105 MB)…'))
      await api.installLocalModel('smollm2-135m')
      await loadModels()
      setSelectedModel('orbi::smollm2-135m')
      setNotice(t('Local AI ready — it runs on this PC, no key needed.'))
    } catch (e) {
      setNotice(cleanError(e))
    }
  }

  const activeConversation = conversations.find((c) => c.id === conversationId)
  const emptyLanding = messages.length === 0
  const showContext = contextOpen && !temporaryChat && messages.length > 0
  const responseMode = responseType === 'Thinking' ? `Thinking · ${reasoningEffort}` : 'Instant'
  const groupedModels = useMemo(() => {
    const q = modelSearch.toLowerCase()
    const groups = new Map<string, ModelInfo[]>()
    for (const m of chatModels) {
      if (q && !`${m.name} ${m.id} ${m.providerName}`.toLowerCase().includes(q)) continue
      const g = groups.get(m.providerName) ?? []
      g.push(m)
      groups.set(m.providerName, g)
    }
    return [...groups.entries()]
  }, [chatModels, modelSearch])

  const suggestList: Suggest[] = useMemo(() => {
    const m = message.match(/(?:^|\s)([/@])([\w.-]*)$/)
    if (!m || suggestClosed) return []
    const q = m[2].toLowerCase()
    if (m[1] === '/') {
      if (message.trimStart().indexOf('/') !== 0 || message.trim().includes(' ')) return []
      return [
        ...SLASH_COMMANDS.map((c) => ({ kind: 'command' as const, id: c.id, label: `/${c.id}`, hint: t(c.hint), insert: `/${c.id} ` })),
        ...skills.map((k) => ({ kind: 'skill' as const, id: k.id, label: `/${slug(k.name)}`, hint: k.description || k.name, insert: `/${slug(k.name)} ` })),
      ]
        .filter((x) => x.label.slice(1).includes(q))
        .slice(0, 8)
    }
    return agents
      .filter((a) => `${a.handle} ${a.description}`.toLowerCase().includes(q))
      .slice(0, 8)
      .map((a) => ({ kind: 'agent' as const, id: a.id, label: a.handle, hint: a.description || a.instructions.slice(0, 80), insert: `${a.handle} ` }))
  }, [message, skills, agents, suggestClosed])
  const applySuggest = (x: Suggest) => {
    setMessage((cur) => cur.replace(/(^|\s)[/@][\w.-]*$/, (_, pre) => `${pre}${x.insert}`))
    if (x.kind === 'agent') setActiveAgents((cur) => (cur.includes(x.label) ? cur : [...cur, x.label]))
    setSuggestIdx(0)
    textareaRef.current?.focus()
  }

  const lastAssistantIdx = messages.map((m) => m.role).lastIndexOf('assistant')
  const conversationSources = messages.flatMap((m) => parseAttachments(m.attachments))

  return (
    <RunCodeContext.Provider value={runInTerminal}>
    <TitleBar
      menus={menus}
      commands={commands}
      title={activeNav === 'creative' ? `Orbi — ${t('Creative')}` : activeNav === 'explore' ? `Orbi — ${t('Explore')}` : activeConversation ? `${activeConversation.title} — Orbi` : 'Orbi'}
      onLogo={() => goNav('chats')}
    />
    <div className="app-frame">
    <div
      className="app-shell"
      style={{ '--workspace-panel-size': `${leftPanelWidth}px`, '--context-panel-size': `${rightPanelWidth}px` } as CSSProperties}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        if (activeNav !== 'creative' && activeNav !== 'explore' && e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
      }}
    >
      <nav className="tool-rail" aria-label="Main navigation">
        <button className="rail-brand" onClick={() => toggleNavigation('chats')} aria-label="Orbi" title="Orbi">
          <OrbiMark width={21} height={21} />
        </button>
        <div className="rail-navigation">
          {navItems.map((item) => {
            const Icon = item.icon
            const selected = activeNav === item.id && (item.id === 'creative' || item.id === 'explore' || panelOpen)
            return (
              <button
                key={item.id}
                className={`rail-button ${selected ? 'rail-button-active' : ''} ${activities.some((a) => a.area === item.id) ? 'rail-busy' : ''}`}
                onClick={() => toggleNavigation(item.id)}
                aria-label={t(item.label)}
                aria-pressed={selected}
                title={t(item.label)}
              >
                <Icon size={18} strokeWidth={1.8} />
                {activities.some((a) => a.area === item.id) && <span className="rail-busy-count num">{activities.filter((a) => a.area === item.id).length}</span>}
              </button>
            )
          })}
        </div>
        <div className="rail-footer">
          <button className={`rail-avatar ${profileOpen ? 'rail-avatar-active' : ''}`} onClick={() => setProfileOpen((v) => !v)} aria-label="Open profile menu" aria-expanded={profileOpen}>
            {initials(userName)}
          </button>
        </div>
      </nav>

      {profileOpen && (
        <>
          <button className="profile-menu-backdrop" onClick={() => setProfileOpen(false)} aria-label="Close profile menu" />
          <div className="profile-menu" role="menu" aria-label="Profile menu">
            <div className="profile-menu-account">
              <div className="avatar avatar-profile-menu">{initials(userName)}</div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{userName}</p>
                <p className="mt-0.5 text-[10px] text-[#919d95]">{t('Local account')} · Orbi {info?.version}</p>
              </div>
            </div>
            <div className="profile-menu-separator" />
            <button
              className="profile-menu-item profile-menu-upgrade"
              role="menuitem"
              onClick={() => {
                setProfileOpen(false)
                api.openExternal('https://orbix.com')
              }}
            >
              <Crown size={16} />
              <span>{t('Upgrade plan')}</span>
            </button>
            <button
              className="profile-menu-item"
              role="menuitem"
              onClick={() => {
                setProfileOpen(false)
                setSettingsOpen('profile')
              }}
            >
              <UserRound size={16} />
              <span>{t('Profile')}</span>
            </button>
            <button
              className="profile-menu-item"
              role="menuitem"
              onClick={() => {
                setProfileOpen(false)
                setSettingsOpen('general')
              }}
            >
              <Settings size={16} />
              <span>{t('Settings')}</span>
            </button>
            <div className="profile-menu-separator" />
            <button
              className="profile-menu-item"
              role="menuitem"
              onClick={() => {
                setProfileOpen(false)
                setSettingsOpen('about')
              }}
            >
              <CircleHelp size={16} />
              <span>{t('Help & data')}</span>
            </button>
            <button className="profile-menu-item profile-menu-logout" role="menuitem" onClick={() => window.close()}>
              <LogOut size={16} />
              <span>{t('Quit Orbi')}</span>
            </button>
          </div>
        </>
      )}

      {panelOpen && activeNav !== 'creative' && activeNav !== 'explore' && (
        <>
          <button className="panel-backdrop" onClick={() => setPanelOpen(false)} aria-label="Close navigation" />
          <WorkspacePanel
            active={activeNav}
            onCollapse={() => setPanelOpen(false)}
            onResize={(e) => startPanelResize('left', e)}
            conversations={conversations}
            projects={projects}
            activeConversationId={conversationId}
            activeProjectId={activeProjectId}
            setActiveProjectId={setActiveProjectId}
            onOpenConversation={openConversation}
            onNewChat={startNewChat}
            onRefresh={refreshLists}
            agents={agents}
            memories={memories}
            bookmarks={bookmarks}
            media={media}
            skills={skills}
            models={models}
            servers={servers}
            setServers={setServers}
            plugins={plugins}
            setPlugins={setPlugins}
            onChatWithAgent={chatWithAgent}
            memoryEnabled={memoryEnabled}
            setMemoryEnabled={setMemoryEnabled}
            onOpenCreative={() => toggleNavigation('creative')}
          />
        </>
      )}

      {/* Creative stays mounted after the first visit so renders keep running in the background. */}
      {(creativeMounted || activeNav === 'creative') && (
        <Suspense fallback={activeNav === 'creative' ? <main className="view-loading" /> : null}>
          <CreativeStudio
            visible={activeNav === 'creative'}
            themeMode={themeMode}
            setThemeMode={setThemeMode}
            onBack={() => {
              setActiveNav('chats')
              setPanelOpen(false)
            }}
            models={models}
            localStatus={localStatus}
            onOpenModels={() => setSettingsOpen('models')}
            onMediaCreated={(m) => setMedia((cur) => [m, ...cur])}
          />
        </Suspense>
      )}
      {activeNav === 'creative' ? null : activeNav === 'explore' ? (
        <Suspense fallback={<main className="view-loading" />}>
          <Explore
            onBack={() => {
              setActiveNav('chats')
              setPanelOpen(false)
            }}
            onChanged={refreshLists}
            onUseAgent={chatWithAgent}
          />
        </Suspense>
      ) : (
        <>
          <main className={`min-w-0 flex-1 transition-[margin] duration-200 ${showContext ? 'main-context-open' : ''} ${panelOpen ? 'main-panel-open' : 'main-panel-closed'}`}>
            <header className="chat-header">
              <div className="flex min-w-0 items-center gap-3">
                <button className="icon-button panel-mobile-toggle" onClick={() => setPanelOpen((v) => !v)} aria-label="Toggle menu">
                  {panelOpen ? <X size={19} /> : <Menu size={19} />}
                </button>
                <div className="header-config">
                  <button
                    className={`config-trigger config-model-trigger ${headerMenu === 'models' ? 'config-trigger-active' : ''}`}
                    onClick={() => toggleHeaderMenu('models')}
                    aria-expanded={headerMenu === 'models'}
                  >
                    {modelsLoading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                    <span className="config-label">{currentModel?.name ?? (models.length ? t('Choose model') : t('Connect a model'))}</span>
                    <ChevronDown size={13} />
                  </button>
                  <button className={`config-trigger ${headerMenu === 'skills' ? 'config-trigger-active' : ''}`} onClick={() => toggleHeaderMenu('skills')} aria-expanded={headerMenu === 'skills'}>
                    <Blocks size={16} />
                    <span className="config-label">{t('Skills')}</span>
                    {activeSkills.length > 0 && <span className="config-count">{activeSkills.length}</span>}
                  </button>
                  <button className={`config-trigger ${headerMenu === 'agents' ? 'config-trigger-active' : ''}`} onClick={() => toggleHeaderMenu('agents')} aria-expanded={headerMenu === 'agents'}>
                    <Bot size={16} />
                    <span className="config-label">{t('Agents')}</span>
                    {activeAgents.length > 0 && <span className="config-count">{activeAgents.length}</span>}
                  </button>
                  <button
                    className={`config-trigger config-add-trigger ${headerMenu === 'add' ? 'config-trigger-active' : ''}`}
                    onClick={() => toggleHeaderMenu('add')}
                    aria-label={t('Add another model')}
                    aria-expanded={headerMenu === 'add'}
                    title={t('Compare models side by side')}
                  >
                    <Plus size={17} />
                    {additionalModels.length > 0 && <span className="config-count">{additionalModels.length}</span>}
                  </button>

                  {headerMenu && (
                    <>
                      <button className="config-menu-backdrop" onClick={() => setHeaderMenu(null)} aria-label="Close configuration menu" />
                      <div className="config-popover">
                        {headerMenu === 'models' && (
                          <>
                            <div className="config-popover-heading">
                              <div>
                                <p>{t('LLM model')}</p>
                                <span>{t('Choose the AI for this conversation')}</span>
                              </div>
                              <Cpu size={17} />
                            </div>
                            {chatModels.length > 0 && (
                              <label className="sidebar-search popover-search">
                                <Search size={14} />
                                <input autoFocus value={modelSearch} onChange={(e) => setModelSearch(e.target.value)} placeholder={t('Search {n} models', { n: chatModels.length })} />
                              </label>
                            )}
                            <div className="config-options popover-scroll">
                              {groupedModels.map(([provider, list]) => (
                                <div key={provider}>
                                  <p className="config-list-label">{provider}</p>
                                  {list.slice(0, modelSearch ? 200 : 60).map((model) => (
                                    <button
                                      className="config-option"
                                      key={model.key}
                                      onClick={() => {
                                        setSelectedModel(model.key)
                                        setHeaderMenu(null)
                                      }}
                                    >
                                      <span className={`model-radio ${selectedModel === model.key ? 'model-radio-active' : ''}`} />
                                      <span className="min-w-0 flex-1 text-left">
                                        <strong className="block truncate">{model.name}</strong>
                                        <small className="block truncate">
                                          {model.id} · {model.mode}
                                        </small>
                                      </span>
                                      {selectedModel === model.key && <Check size={14} />}
                                    </button>
                                  ))}
                                </div>
                              ))}
                              {!modelsLoading && chatModels.length === 0 && <p className="popover-empty">{t('No models yet. Connect a provider — OpenRouter gives you hundreds of models with one key — or download a local model.')}</p>}
                              {modelErrors.map((e) => (
                                <p key={e.provider} className="popover-error">
                                  {e.provider}: {e.message.slice(0, 140)}
                                </p>
                              ))}
                            </div>
                            <div className="config-connect-actions">
                              <button
                                onClick={() => {
                                  setHeaderMenu(null)
                                  setSettingsOpen('providers')
                                }}
                              >
                                <Plug size={15} />
                                <span>{t('Manage providers')}</span>
                              </button>
                              <button
                                onClick={() => {
                                  setHeaderMenu(null)
                                  setSettingsOpen('models')
                                }}
                              >
                                <Cpu size={15} />
                                <span>{t('Local models')}</span>
                              </button>
                              <button onClick={() => loadModels()}>
                                <RotateCcw size={15} />
                                <span>{t('Refresh list')}</span>
                              </button>
                            </div>
                          </>
                        )}

                        {headerMenu === 'skills' && (
                          <>
                            <div className="config-popover-heading">
                              <div>
                                <p>{t('Active Skills')}</p>
                                <span>{t('Type / in the message box to use one')}</span>
                              </div>
                              <Blocks size={17} />
                            </div>
                            <div className="config-options">
                              {skills.map((skill) => (
                                <button className="config-option" key={skill.id} onClick={() => api.toggleSkill(skill.id, !skill.enabled).then(refreshLists)}>
                                  <span className={`config-checkbox ${activeSkills.includes(skill.name) ? 'config-checkbox-active' : ''}`}>{activeSkills.includes(skill.name) && <Check size={11} />}</span>
                                  <span className="min-w-0 flex-1 text-left">
                                    <strong>{skill.name}</strong>
                                    <small>{skill.description}</small>
                                  </span>
                                </button>
                              ))}
                            </div>
                          </>
                        )}

                        {headerMenu === 'agents' && (
                          <>
                            <div className="config-popover-heading">
                              <div>
                                <p>{t('Agents')}</p>
                                <span>{t('Type @ in the message box to mention one')}</span>
                              </div>
                              <Bot size={17} />
                            </div>
                            <div className="config-options">
                              {agents.map((agent) => (
                                <button className="config-option" key={agent.id} onClick={() => toggle(agent.handle, activeAgents, setActiveAgents)}>
                                  <span className={`config-checkbox ${activeAgents.includes(agent.handle) ? 'config-checkbox-active' : ''}`}>{activeAgents.includes(agent.handle) && <Check size={11} />}</span>
                                  <span className="min-w-0 flex-1 text-left">
                                    <strong>{agent.handle}</strong>
                                    <small className="block truncate">{agent.instructions}</small>
                                  </span>
                                </button>
                              ))}
                            </div>
                            <div className="config-connect-actions">
                              <button
                                onClick={() => {
                                  setHeaderMenu(null)
                                  toggleNavigation('explore')
                                }}
                              >
                                <Sparkles size={15} />
                                <span>{t('Explore library')}</span>
                              </button>
                              <button
                                onClick={() => {
                                  setHeaderMenu(null)
                                  setActiveNav('agents')
                                  setPanelOpen(true)
                                }}
                              >
                                <Bot size={15} />
                                <span>{t('Open Agent Builder')}</span>
                              </button>
                            </div>
                          </>
                        )}

                        {headerMenu === 'add' && (
                          <>
                            <div className="config-popover-heading">
                              <div>
                                <p>{t('Add models')}</p>
                                <span>{t('Each answer comes from every selected model')}</span>
                              </div>
                              <Plus size={17} />
                            </div>
                            <div className="config-connect-actions">
                              <button
                                onClick={() => {
                                  setHeaderMenu(null)
                                  setSettingsOpen('providers')
                                }}
                              >
                                <Plug size={15} />
                                <span>{t('Connect API provider')}</span>
                              </button>
                              <button
                                onClick={() => {
                                  setHeaderMenu(null)
                                  setSettingsOpen('models')
                                }}
                              >
                                <Server size={15} />
                                <span>{t('Add local model')}</span>
                              </button>
                            </div>
                            <label className="sidebar-search popover-search">
                              <Search size={14} />
                              <input value={modelSearch} onChange={(e) => setModelSearch(e.target.value)} placeholder={t('Search models')} />
                            </label>
                            <div className="config-options config-options-compact popover-scroll">
                              {groupedModels
                                .flatMap(([, list]) => list)
                                .filter((m) => m.key !== selectedModel)
                                .slice(0, 80)
                                .map((model) => {
                                  const added = additionalModels.includes(model.key)
                                  return (
                                    <button className="config-option" key={model.key} onClick={() => toggle(model.key, additionalModels, setAdditionalModels)}>
                                      <span className={`config-checkbox ${added ? 'config-checkbox-active' : ''}`}>{added ? <Check size={11} /> : <Plus size={11} />}</span>
                                      <span className="min-w-0 flex-1 text-left">
                                        <strong className="block truncate">{model.name}</strong>
                                        <small>{model.providerName}</small>
                                      </span>
                                    </button>
                                  )
                                })}
                            </div>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {messages.length > 0 && !temporaryChat && !contextOpen && (
                  <button className="header-action hidden sm:flex" onClick={() => setContextOpen(true)}>
                    <PanelLeftClose size={16} />
                    {t('Workspace')}
                  </button>
                )}
                {messages.length > 0 && (
                  <button className="header-action hidden sm:flex" onClick={startNewChat} title="New chat">
                    <Plus size={16} />
                    {t('New')}
                  </button>
                )}
                <ThemeSwitcher themeMode={themeMode} setThemeMode={setThemeMode} />
                <button
                  className={`temporary-header ${temporaryChat ? 'temporary-header-active' : ''}`}
                  onClick={toggleTemporaryChat}
                  aria-label={t('Toggle temporary chat')}
                  title={t('Temporary chat')}
                >
                  <SpyHatIcon className="h-[20px] w-[20px]" />
                </button>
              </div>
            </header>

            <section ref={scrollRef} className={`chat-scroll ${emptyLanding ? 'empty-chat-scroll' : ''}`}>
              <div className="mx-auto w-full max-w-[760px] px-5 py-8 sm:px-8 sm:py-11">
                {emptyLanding ? (
                  temporaryChat ? (
                    <div className="temporary-welcome">
                      <div className="temporary-title-icon">
                        <SpyHatIcon className="h-7 w-7" />
                      </div>
                      <h2>{t('Temporary chat')}</h2>
                      <p>{t('This conversation will not appear in your history and will be deleted automatically.')}</p>
                    </div>
                  ) : (
                    <div className="standard-welcome">
                      <div className="hero-signal-field" aria-hidden="true">
                        <span className="hero-grid" />
                        <span className="hero-orbit hero-orbit-one">
                          <i />
                        </span>
                        <span className="hero-orbit hero-orbit-two">
                          <i />
                        </span>
                        <span className="hero-orbit hero-orbit-three">
                          <i />
                        </span>
                      </div>
                      <div className="standard-title-icon">
                        <OrbiMark width={26} height={26} />
                      </div>
                      <h2>{themeMode === 'terminal' ? t('System ready, {name}.', { name: userName }) : `${t(greeting())}, ${userName}.`}</h2>
                      <p>{themeMode === 'terminal' ? t('Initialize a multimodal workflow.') : t('Chat, search the web, and direct images and video — on your PC or in the cloud.')}</p>
                      <div className="hero-capabilities">
                        <span>
                          <Video size={12} />
                          {t('Video')}
                        </span>
                        <span>
                          <ImageIcon size={12} />
                          {t('Image')}
                        </span>
                        <span>
                          <FileText size={12} />
                          {t('Story')}
                        </span>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="date-divider">
                    <span>{activeConversation ? fmtDate(activeConversation.created_at) : t('Today')}</span>
                  </div>
                )}

                <div className="mt-8 space-y-7">
                  {messages.map((item, idx) => {
                    const atts = parseAttachments(item.attachments)
                    return (
                      <div key={item.id} className={`message-row ${item.role === 'user' ? 'message-row-user' : ''}`}>
                        {item.role === 'assistant' && (
                          <div className="avatar avatar-bot">
                            <OrbiMark width={18} height={18} />
                          </div>
                        )}
                        <div className={`message-wrap ${item.role === 'user' ? 'items-end' : ''}`}>
                          {item.role === 'assistant' && item.model && <span className="message-model">{item.model}</span>}
                          {atts.length > 0 && (
                            <div className="message-attachments">
                              {atts.map((a, i) =>
                                a.dataUrl && a.mime.startsWith('image/') ? (
                                  <img key={i} src={a.dataUrl} alt={a.name} />
                                ) : (
                                  <span key={i} className="attachment-chip">
                                    <FileText size={13} /> {a.name}
                                  </span>
                                ),
                              )}
                            </div>
                          )}
                          {item.reasoning && (
                            <details className="message-reasoning" open={item.streaming && !item.content}>
                              <summary>{t('Thinking')}</summary>
                              <p>{item.reasoning}</p>
                            </details>
                          )}
                          {parseJSON<ToolEvent[]>(item.tools, []).length > 0 && (
                            <div className="tool-events">
                              {parseJSON<ToolEvent[]>(item.tools, []).map((t) => {
                                if (t.sources?.length)
                                  return (
                                    <div key={t.id} className="web-sources">
                                      <p className="web-sources-head">
                                        <Globe size={12} /> {tr('Searched the web')} <small>· {t.result}</small>
                                      </p>
                                      <div className="web-sources-list">
                                        {t.sources.map((src, i) => (
                                          <button key={src.url} className="web-source" onClick={() => api.openExternal(src.url)} title={src.snippet}>
                                            <span className="web-source-n num">{i + 1}</span>
                                            <span className="min-w-0">
                                              <strong>{src.title}</strong>
                                              <small>{hostOf(src.url)}</small>
                                            </span>
                                            <ExternalLink size={11} />
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )
                                const [srv, ...rest] = t.name.split('__')
                                return (
                                  <details key={t.id} className={`tool-event tool-${t.status}`}>
                                    <summary>
                                      {t.status === 'running' ? <Loader2 size={12} className="animate-spin" /> : <Wrench size={12} />}
                                      <span>
                                        {rest.join('__') || t.name}
                                        <small> · {servers.find((x) => x.id === srv)?.name ?? srv}</small>
                                      </span>
                                      <em>{tr(t.status === 'running' ? 'running' : t.status === 'error' ? 'failed' : 'done')}</em>
                                    </summary>
                                    {t.args !== undefined && <pre>{JSON.stringify(t.args, null, 2)}</pre>}
                                    {t.result && <pre>{t.result}</pre>}
                                  </details>
                                )
                              })}
                            </div>
                          )}
                          {(item.content || item.role === 'user') && (
                            <div className={`message-bubble message-${item.role} ${item.error ? 'message-error' : ''}`}>
                              {item.role === 'assistant' && !item.error ? <Markdown text={item.content} /> : <span className="whitespace-pre-wrap">{item.content}</span>}
                              {item.streaming && <span className="stream-caret" />}
                            </div>
                          )}
                          {item.streaming && !item.content && !item.reasoning && (
                            <div className="typing-bubble" aria-label={t('Orbi is typing')}>
                              <span />
                              <span />
                              <span />
                            </div>
                          )}
                          {!item.streaming && (
                            <div className="message-meta">
                              <span>{timeOf(item.created_at)}</span>
                              {item.role === 'user' && <Check size={12} />}
                              {item.role === 'assistant' && !item.error && (
                                <>
                                  <button title={t('Copy')} onClick={() => navigator.clipboard.writeText(item.content)}>
                                    <Copy size={12} />
                                  </button>
                                  <button title={speaking === item.id ? t('Stop reading') : t('Read aloud')} onClick={() => speak(item)} className={speaking === item.id ? 'meta-active' : ''}>
                                    {speaking === item.id ? <VolumeX size={12} /> : <Volume2 size={12} />}
                                  </button>
                                  {!item.temp && conversationId && (
                                    <button
                                      title={item.bookmarked ? t('Remove bookmark') : t('Bookmark')}
                                      onClick={async () => {
                                        await api.bookmark(item.id, !item.bookmarked)
                                        setMessages((cur) => cur.map((m) => (m.id === item.id ? { ...m, bookmarked: m.bookmarked ? 0 : 1 } : m)))
                                        refreshLists()
                                      }}
                                    >
                                      {item.bookmarked ? <BookmarkCheck size={12} /> : <Bookmark size={12} />}
                                    </button>
                                  )}
                                </>
                              )}
                              {idx === lastAssistantIdx && !isStreaming && (
                                <button title={t('Regenerate')} onClick={regenerate}>
                                  <RotateCcw size={12} />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        {item.role === 'user' && <div className="avatar avatar-user">{initials(userName)}</div>}
                      </div>
                    )
                  })}
                </div>

                {!emptyLanding && !isStreaming && messages.length > 0 && (
                  <div className="mt-10">
                    <p className="mb-3 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-[#939c96]">{t('Keep exploring')}</p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {suggestions.map((s) => (
                        <button key={s} className="suggestion-chip" onClick={() => sendMessage(t(s))}>
                          {t(s)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>

            <div className={`composer-area ${temporaryChat ? 'temporary-composer-area' : ''} ${emptyLanding ? 'composer-area-centered' : ''}`}>
              {activeAgents.length > 0 && (
                <div className="agent-chips">
                  {activeAgents.map((h) => (
                    <span key={h} className="attachment-chip agent-chip">
                      <Bot size={12} /> {h}
                      <button type="button" onClick={() => setActiveAgents((cur) => cur.filter((x) => x !== h))} aria-label={t('Stop using {h}', { h })}>
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <form className={`composer ${temporaryChat ? 'composer-temporary' : emptyLanding ? 'composer-welcome' : ''}`} onSubmit={handleSubmit}>
                {attachments.length > 0 && (
                  <div className="composer-attachments">
                    {attachments.map((a, i) => (
                      <span key={i} className="attachment-chip">
                        {a.dataUrl && a.mime.startsWith('image/') ? <img src={a.dataUrl} alt="" /> : <FileText size={13} />}
                        {a.name}
                        <button type="button" onClick={() => setAttachments((cur) => cur.filter((_, j) => j !== i))} aria-label={`Remove ${a.name}`}>
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {suggestList.length > 0 && (
                  <div className="composer-suggest" role="listbox" aria-label={t('Suggestions')}>
                    {suggestList.map((x, i) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={i === suggestIdx % suggestList.length}
                        key={x.kind + x.id}
                        className={i === suggestIdx % suggestList.length ? 'active' : ''}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          applySuggest(x)
                        }}
                      >
                        {x.kind === 'agent' ? <Bot size={13} /> : x.kind === 'skill' ? <Blocks size={13} /> : <Sparkles size={13} />}
                        <strong>{x.label}</strong>
                        <span>{x.hint}</span>
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value)
                    setSuggestClosed(false)
                    setSuggestIdx(0)
                  }}
                  onPaste={(e) => {
                    const files = Array.from(e.clipboardData.files)
                    if (files.length) {
                      e.preventDefault()
                      addFiles(files)
                    }
                  }}
                  onKeyDown={(e) => {
                    if (suggestList.length) {
                      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault()
                        setSuggestIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : suggestList.length - 1)) % suggestList.length)
                        return
                      }
                      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                        e.preventDefault()
                        applySuggest(suggestList[suggestIdx % suggestList.length])
                        return
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        setSuggestClosed(true)
                        return
                      }
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendMessage(message)
                    }
                  }}
                  placeholder={recording ? t('Listening… click the mic again to stop') : transcribing ? t('Transcribing…') : temporaryChat ? t('Type a temporary message...') : themeMode === 'terminal' ? '> ' + t('Enter a prompt...') : t('Ask anything — / for skills, @ for agents')}
                  aria-label={t('Message')}
                />
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <button type="button" className="composer-tool" aria-label={t('Attach file')} title={t('Attach files or images')} onClick={() => fileInput.current?.click()}>
                      <Paperclip size={18} />
                    </button>
                    <button
                      type="button"
                      className={`composer-tool composer-web ${webOn ? 'composer-tool-on' : ''}`}
                      aria-pressed={webOn}
                      title={webOn ? t('Web search on — every message searches the web first') : t('Search the web (works with any model)')}
                      onClick={toggleWeb}
                    >
                      <Globe size={17} />
                      {webOn && <span>{t('Web')}</span>}
                    </button>
                  </div>
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => {
                      if (e.target.files) addFiles(e.target.files)
                      e.target.value = ''
                    }}
                  />
                  <div className="composer-conversation-controls">
                    <span className="hidden text-[10px] text-[#9aa19d] sm:block">{additionalModels.length ? t('{n} models', { n: additionalModels.length + 1 }) : t('Press Enter to send')}</span>
                    <div className="response-mode-control">
                      <button type="button" className={`response-mode-trigger ${responseMenuOpen ? 'response-mode-trigger-active' : ''}`} onClick={() => setResponseMenuOpen((v) => !v)} aria-expanded={responseMenuOpen}>
                        <span>{responseType === 'Thinking' ? `${t('Thinking')} · ${t(reasoningEffort)}` : t('Instant')}</span>
                        <ChevronDown size={12} />
                      </button>
                      {responseMenuOpen && (
                        <>
                          <button type="button" className="response-menu-backdrop" onClick={() => setResponseMenuOpen(false)} aria-label={t('Close')} />
                          <div className="response-mode-menu">
                            <div className="response-menu-heading">
                              <div>
                                <strong>{t('Response behavior')}</strong>
                                <small>{t('Configured for {model}', { model: currentModel?.name ?? t('your model') })}</small>
                              </div>
                              <CircleHelp size={14} />
                            </div>
                            <p className="response-control-label">{t('Mode')}</p>
                            <div className="response-type-options">
                              {(['Instant', 'Thinking'] as ResponseType[]).map((mode) => (
                                <button type="button" key={mode} className={`response-type-option ${responseType === mode ? 'response-type-option-active' : ''}`} onClick={() => setResponseType(mode)}>
                                  {t(mode)}
                                </button>
                              ))}
                            </div>
                            {responseType === 'Thinking' && (
                              <div className="effort-control">
                                <div className="effort-heading">
                                  <span>{t('Thinking effort')}</span>
                                  <strong>{t(reasoningEffort)}</strong>
                                </div>
                                <div className="effort-scale">
                                  {(['Fast', 'Medium', 'High'] as ReasoningEffort[]).map((effort) => (
                                    <button type="button" key={effort} className={reasoningEffort === effort ? 'effort-option-active' : ''} onClick={() => setReasoningEffort(effort)}>
                                      <span />
                                      {t(effort)}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                            <p className="response-model-note">{t('Thinking uses extended reasoning on models that support it.')}</p>
                          </div>
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      className={`microphone-button ${recording ? 'microphone-recording' : ''}`}
                      onClick={() => startVoice()}
                      disabled={transcribing}
                      aria-label={recording ? t('Stop recording') : t('Start voice input')}
                      title={recording ? t('Stop recording') : voiceMode ? t('Voice input') : t('Set up voice input')}
                    >
                      {transcribing ? <Loader2 size={17} className="animate-spin" /> : recording ? <Square size={13} fill="currentColor" /> : <Mic size={18} />}
                    </button>
                    {isStreaming ? (
                      <button className="send-button send-button-stop" type="button" onClick={stop} aria-label={t('Stop generating')} title={t('Stop')}>
                        <Square size={14} fill="currentColor" />
                      </button>
                    ) : (
                      <button className="send-button" type="submit" disabled={!message.trim() && !attachments.length} aria-label={t('Send message')}>
                        <ArrowUp size={18} strokeWidth={2.4} />
                      </button>
                    )}
                  </div>
                </div>
              </form>
              {emptyLanding && !temporaryChat && !modelsLoading && models.length === 0 && (
                <div className="connect-options connect-banner-below">
                <button
                  className="connect-banner"
                  disabled={!!localStatus?.models.find((m) => m.id === 'smollm2-135m')?.downloading || !!localStatus?.engineDownloading}
                  onClick={installTinyModel}
                >
                  {localStatus?.models.find((m) => m.id === 'smollm2-135m')?.downloading || localStatus?.engineDownloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  <span>
                    <strong>
                      {(() => {
                        const d = localStatus?.engineDownloading ?? localStatus?.models.find((m) => m.id === 'smollm2-135m')?.downloading
                        return d ? `${t('Downloading local AI…')} ${d.total ? Math.round((d.received / d.total) * 100) : 0}%` : t('Try a free local AI (≈105 MB)')
                      })()}
                    </strong>
                    <small>{t('SmolLM2 runs on this PC, offline, even with little memory. No key needed.')}</small>
                  </span>
                </button>
                <button className="connect-banner" onClick={() => setSettingsOpen('models')}>
                  <Cpu size={16} />
                  <span>
                    <strong>{t('Pick a model for this PC')}</strong>
                    <small>{t('Light, medium and heavy models — Orbi checks what your hardware can run.')}</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
                <button className="connect-banner" onClick={() => setSettingsOpen('providers')}>
                  <Plug size={16} />
                  <span>
                    <strong>{t('Connect your first AI provider')}</strong>
                    <small>{t('Paste an OpenRouter, OpenAI, Anthropic, Gemini or Groq key — or use Ollama locally for free.')}</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
                </div>
              )}
              {emptyLanding && !temporaryChat && models.length > 0 && (
                <div className="starter-prompts">
                  {(() => {
                    const a = activeAgentList()
                    const st = a.length === 1 ? parseJSON<string[]>(a[0].starters, []).filter(Boolean) : []
                    return st.length ? st : starterPrompts.map((x) => t(x))
                  })().map((s) => (
                    <button key={s} className="suggestion-chip" onClick={() => sendMessage(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {!emptyLanding && (
                <p className="mt-2.5 text-center text-[10px] text-[#9ca39f]">
                  {temporaryChat ? t('This conversation will not be saved to your history or memory.') : t('Orbi can make mistakes. Verify important information.')}
                </p>
              )}
            </div>
          </main>

          {showContext && (
            <aside className="context-panel">
              <button className="panel-resize-handle panel-resize-handle-right" onPointerDown={(e) => startPanelResize('right', e)} aria-label={t('Resize workspace panel')} />
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <h2 className="truncate font-display text-lg font-semibold tracking-[-0.03em] text-[#1b241f]">{activeConversation?.title ?? t('New conversation')}</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button className="icon-button context-collapse" onClick={() => setContextOpen(false)} aria-label={t('Collapse workspace')}>
                    <ChevronRight size={17} />
                  </button>
                  <button className="icon-button" aria-label={t('Settings')} onClick={() => setSettingsOpen('general')}>
                    <MoreHorizontal size={18} />
                  </button>
                </div>
              </div>

              <div className="context-card mt-7">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <Sparkles size={15} className="text-[#59734b]" />
                  {t('Active context')}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[#6f7973]">
                  {[activeSkills.length && t('{n} skills', { n: activeSkills.length }), activeAgents.length && activeAgents.join(', '), webOn && t('web search'), memoryEnabled && memories.length && t('{n} memories', { n: memories.length })]
                    .filter(Boolean)
                    .join(' · ') || t('No skills, agents or memories active.')}
                </p>
              </div>

              <div className="mt-8">
                <p className="eyebrow text-[#8a948e]">{t('Project')}</p>
                <label className="context-select mt-3">
                  <FolderKanban size={15} />
                  <select
                    value={activeConversation?.project_id ?? ''}
                    onChange={async (e) => {
                      if (!conversationId) return
                      await api.updateConversation(conversationId, { project_id: e.target.value || null })
                      refreshLists()
                    }}
                  >
                    <option value="">{t('No project')}</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-8">
                <div className="flex items-center justify-between">
                  <p className="eyebrow text-[#8a948e]">{t('Sources')}</p>
                  <button className="text-[11px] font-semibold text-[#537047]" onClick={() => fileInput.current?.click()}>
                    {t('Add')}
                  </button>
                </div>
                <div className="mt-3 space-y-2">
                  {conversationSources.length === 0 && <p className="text-[11px] text-[#8a938e]">{t('Attach files or images to use them as context.')}</p>}
                  {conversationSources.map((s, i) => (
                    <div className="source-card" key={i}>
                      <div className={`source-icon ${s.dataUrl ? 'source-icon-blue' : ''}`}>{s.dataUrl ? <ImageIcon size={17} /> : <FileText size={17} />}</div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-[#26322b]">{s.name}</p>
                        <p className="mt-0.5 text-[10px] text-[#8a938e]">{s.text ? t('{n}k characters', { n: Math.round(s.text.length / 1000) }) : s.mime}</p>
                      </div>
                      <Check size={14} className="text-[#658256]" />
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-8 border-t border-[#e4e5df] pt-6">
                <p className="eyebrow text-[#8a948e]">{t('Details')}</p>
                <div className="mt-4 space-y-4">
                  <div className="flex items-center gap-3">
                    <Clock3 size={15} className="text-[#8a948e]" />
                    <div>
                      <p className="text-[10px] text-[#929a95]">{t('Created on')}</p>
                      <p className="mt-0.5 text-xs font-medium text-[#465149]">{fmtDate(activeConversation?.created_at ?? Date.now(), 'long')}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Bot size={15} className="text-[#8a948e]" />
                    <div className="min-w-0">
                      <p className="text-[10px] text-[#929a95]">{additionalModels.length ? t('Models') : t('Model')}</p>
                      <p className="mt-0.5 truncate text-xs font-medium text-[#465149]">
                        {[currentModel?.name, ...additionalModels.map((k) => models.find((m) => m.key === k)?.name)].filter(Boolean).join(', ') || '—'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <MessageSquareText size={15} className="text-[#8a948e]" />
                    <div>
                      <p className="text-[10px] text-[#929a95]">{t('Messages')}</p>
                      <p className="mt-0.5 text-xs font-medium text-[#465149]">{messages.length}</p>
                    </div>
                  </div>
                </div>
              </div>
            </aside>
          )}
        </>
      )}

      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal
            key={lang}
            initialTab={settingsOpen}
            onClose={() => {
              setSettingsOpen(null)
              api.getSetting<VoiceMode | null>('voiceMode', null).then(setVoiceMode)
            }}
            onChanged={loadModels}
            userName={userName}
            setUserName={setUserName}
            info={info}
            localStatus={localStatus}
            onLocalChanged={() => api.localStatus().then(setLocalStatus)}
            lang={lang}
            setLang={changeLang}
            onOpenSetup={() => {
              setSettingsOpen(null)
              setSetupOpen(1)
            }}
          />
        </Suspense>
      )}
      {setupOpen !== null && (
        <Suspense fallback={null}>
          <SetupWizard
            startStep={setupOpen}
            status={localStatus}
            userName={userName}
            setUserName={setUserName}
            lang={lang}
            setLang={changeLang}
            themeMode={themeMode}
            setThemeMode={setThemeMode}
            onDone={({ sttModel }) => {
              setSetupOpen(null)
              api.setSetting('onboarded', true)
              if (sttModel && !voiceMode) {
                const m = { type: 'local' as const, modelId: sttModel }
                api.setSetting('voiceMode', m)
                setVoiceMode(m)
              }
              loadModels()
            }}
          />
        </Suspense>
      )}
      {voicePicker && (
        <div className="orbi-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setVoicePicker(false)}>
          <div className="voice-dialog" role="dialog" aria-label={t('Voice input')}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3>{t('Set up voice input')}</h3>
                <p>{t('Choose how Orbi turns your voice into text. You can change this later in Settings → Voice.')}</p>
              </div>
              <button className="icon-button" onClick={() => setVoicePicker(false)} aria-label={t('Close')}>
                <X size={16} />
              </button>
            </div>
            <Suspense fallback={<div className="hub-skeleton" />}>
              <VoiceSettings
                status={localStatus}
                onLocalChanged={() => api.localStatus().then(setLocalStatus)}
                onPicked={(m) => {
                  setVoiceMode(m)
                  setVoicePicker(false)
                  startVoice(m)
                }}
              />
            </Suspense>
          </div>
        </div>
      )}

      {notice && <div className="orbi-toast">{notice}</div>}
      {doneToast && (
        <div className={`done-toast ${doneToast.ok ? '' : 'done-toast-error'}`} role="status">
          <span className={`done-toast-dot kind-${doneToast.kind}`} />
          <span className="min-w-0 flex-1">
            <strong>{doneToast.ok ? doneToast.message || t('Finished') : t('Something went wrong')}</strong>
            <small className="truncate">{doneToast.ok ? doneToast.label : doneToast.message}</small>
          </span>
          <button
            className="orbi-btn orbi-btn-primary"
            onClick={() => {
              toggleNavigation(doneToast.area === 'creative' ? 'creative' : 'chats')
              if (doneToast.area === 'chats') setPanelOpen(false)
              setDoneToast(null)
            }}
          >
            {t('Open')}
          </button>
          <button className="update-x" onClick={() => setDoneToast(null)} aria-label={t('Close')}>
            <X size={13} />
          </button>
        </div>
      )}
      {isDesktop && (
        <Suspense fallback={null}>
          <UpdateCenter />
        </Suspense>
      )}
      {!isDesktop && <div className="orbi-preview-badge">{t('Browser preview')}</div>}
      {findOpen && (
        <FindBar
          onClose={() => {
            setFindOpen(false)
            setFindResult(null)
          }}
          find={(t, next, forward) => api.find(t, { findNext: next, forward })}
          stop={() => api.stopFind()}
          result={findResult}
        />
      )}
    </div>
    </div>
    {termMounted && (
      <div className="term-dock" style={{ display: termOpen ? 'block' : 'none' }}>
        <Suspense fallback={null}>
        <TerminalPanel
          ref={terminalRef}
          height={termMax ? Math.max(200, window.innerHeight - 140) : termHeight}
          setHeight={setTermHeight}
          maximized={termMax}
          setMaximized={setTermMax}
          onClose={() => setTermOpen(false)}
        />
        </Suspense>
      </div>
    )}
    {palette && (
      <CommandPalette
        commands={commandList}
        conversations={conversations}
        initialMode={palette}
        onClose={() => setPalette(null)}
        onOpenConversation={openConversation}
      />
    )}
    {approval && (
      <div className="orbi-modal-backdrop">
        <div className="approval-dialog" role="alertdialog" aria-label="Approve tool">
          <div className="approval-icon">
            <ShieldCheck size={20} />
          </div>
          <h3>{t('{server} wants to act', { server: approval.server })}</h3>
          <pre>{approval.message}</pre>
          <label className="approval-always">
            <input type="checkbox" checked={alwaysAllow} onChange={(e) => setAlwaysAllow(e.target.checked)} /> {t("Don't ask again (auto-approve tools)")}
          </label>
          <div className="flex justify-end gap-2">
            <button
              className="orbi-btn"
              onClick={() => {
                api.approveTool(approval.id, false)
                setApproval(null)
              }}
            >
              {t('Deny')}
            </button>
            <button
              className="orbi-btn orbi-btn-primary"
              autoFocus
              onClick={() => {
                if (alwaysAllow) api.setSetting('autoApproveTools', true)
                api.approveTool(approval.id, true)
                setApproval(null)
              }}
            >
              {t('Allow')}
            </button>
          </div>
        </div>
      </div>
    )}
    </RunCodeContext.Provider>
  )
}
