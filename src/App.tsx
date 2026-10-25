import { type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  Blocks,
  Bookmark,
  BookmarkCheck,
  Bot,
  Download,
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
  on,
  parseJSON,
} from './lib/api'
import { Markdown } from './components/Markdown'
import { OrbiMark, SpyHatIcon } from './components/Logo'
import { SettingsModal } from './components/SettingsModal'
import { navItems, WorkspacePanel, type NavKey } from './components/WorkspacePanel'
import { CommandPalette, FindBar, TitleBar, type Command, type MenuDef } from './components/TitleBar'
import { TerminalPanel, type TerminalHandle } from './components/TerminalPanel'
import { RunCodeContext } from './components/Markdown'
import { CreativeWorkspace, ThemeSwitcher, type ThemeMode } from './components/Creative'

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
  return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(new Date(ts))
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
  const [themeMode, setThemeMode] = useState<ThemeMode>('light')
  const [panelOpen, setPanelOpen] = useState(false)
  const [activeNav, setActiveNav] = useState<NavKey>('chats')
  const [profileOpen, setProfileOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState<null | 'providers' | 'profile' | 'about'>(null)
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
  const activeSkills = useMemo(() => skills.filter((k) => k.enabled).map((k) => k.name), [skills])
  const [activeAgents, setActiveAgents] = useState<string[]>([])
  const [responseType, setResponseType] = useState<ResponseType>('Instant')
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('Medium')
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
      setThemeMode(await api.getSetting<ThemeMode>('theme', 'light'))
      setSelectedModel(await api.getSetting('selectedModel', ''))
      api.localStatus().then(setLocalStatus)
      api.getSetting('terminalOpen', false).then((v) => v && openTerminal())
      setMemoryEnabled(await api.getSetting('memoryEnabled', true))
      await refreshLists()
      await loadModels()
    })()
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
    api.setSetting('theme', themeMode)
  }, [themeMode])
  useEffect(() => {
    if (selectedModel) api.setSetting('selectedModel', selectedModel)
  }, [selectedModel])
  // live updates from the main process
  useEffect(() => {
    const offs = [
      on('local:status', (s: LocalStatus) => setLocalStatus(s)),
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
    const chosen = agents.filter((a) => activeAgents.includes(a.handle))
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

  const activeAgentList = () => agents.filter((a) => activeAgents.includes(a.handle))
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

  const streamInto = async (target: ModelInfo, history: ChatMessage[], convId: string | null) => {
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
    }
    streams.current.set(reqId, msgId)
    buffers.current.set(msgId, '')
    setMessages((cur) => [...cur, placeholder])
    const finished = new Promise<{ ok: boolean; error?: string; aborted?: boolean }>((resolve) => finishers.current.set(reqId, resolve))
    const invoked = api.sendChat(reqId, {
      providerId: target.provider,
      model: target.id,
      system: systemPrompt(target),
      thinking: responseType === 'Thinking',
      effort: reasoningEffort,
      messages: history.filter((m) => !m.error).map(toPayloadMessage),
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
        if (!res.ok) return { ...m, streaming: false, error: true, content: res.error || 'Something went wrong.' }
        return { ...m, streaming: false, content: m.content || (res.aborted ? '_Stopped._' : '') }
      }),
    )
    if (res.ok && convId && finalText) {
      const saved = await api.addMessage({ id: msgId, conversation_id: convId, role: 'assistant', content: finalText, model: placeholder.model, attachments: [], tools: toolList })
      setMessages((cur) => cur.map((m) => (m.id === msgId ? { ...m, temp: false, created_at: saved.created_at } : m)))
    }
    return { reqId, ok: res.ok, text: finalText }
  }

  const sendMessage = async (text: string, regenerate = false) => {
    const content = text.trim()
    if ((!content && !attachments.length) || isStreaming) return
    const currentModel = primaryModel()
    if (!currentModel) {
      setNotice(models.length ? 'Pick a model first.' : 'Connect an AI provider to start chatting.')
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
    const results = await Promise.all(targets.map((t) => streamInto(t, history, convId)))

    if (isNew && convId && results[0]?.ok && currentModel.provider !== 'orbi') {
      const title = await api.titleFor({ providerId: currentModel.provider, model: currentModel.id, messages: [{ role: 'user', content: content.slice(0, 1500) }] })
      if (title) await api.updateConversation(convId, { title })
    }
    if (convId) refreshLists()
  }

  const stop = () => {
    for (const reqId of streams.current.keys()) api.abortChat(reqId)
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
    if (section === 'creative') {
      setActiveNav('creative')
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
    if (section === 'creative') return toggleNavigation('creative')
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
    { id: 'file.export', category: 'File', label: 'Export Chat as Markdown…', shortcut: 'Ctrl+S', enabled: !!conversationId, run: () => conversationId && api.exportConversation(conversationId).then((ok) => ok && setNotice('Chat exported.')) },
    { id: 'file.settings', category: 'File', label: 'Settings', shortcut: 'Ctrl+,', run: () => setSettingsOpen('providers') },
    { id: 'file.localAI', category: 'File', label: 'Local AI Models…', run: () => setSettingsOpen('providers') },
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
    { id: 'edit.copyAnswer', category: 'Edit', label: 'Copy Last Answer', shortcut: 'Ctrl+Shift+C', enabled: !!lastAnswer(), run: () => { const a = lastAnswer(); if (a) { navigator.clipboard.writeText(a.content); setNotice('Last answer copied.') } } },
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
    { id: 'view.sidebar', category: 'View', label: 'Toggle Sidebar', shortcut: 'Ctrl+B', run: () => (activeNav === 'creative' ? goNav('chats') : setPanelOpen((v) => !v)) },
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
    ...navItems.map((n, i) => ({ id: `go.${n.id}`, category: 'Go', label: n.label, shortcut: i < 9 ? `Alt+${i + 1}` : undefined, checked: activeNav === n.id && (n.id === 'creative' || panelOpen), run: () => goNav(n.id) })),
    { id: 'go.nextChat', category: 'Go', label: 'Next Chat', shortcut: 'Alt+Down', run: () => stepChat(1) },
    { id: 'go.prevChat', category: 'Go', label: 'Previous Chat', shortcut: 'Alt+Up', run: () => stepChat(-1) },
    { id: 'go.chat', category: 'Go', label: 'Go to Chat…', shortcut: 'Ctrl+P', run: () => setPalette('chats') },
    // Terminal
    { id: 'term.new', category: 'Terminal', label: 'New Terminal', shortcut: 'Ctrl+Shift+`', run: () => { if (termMounted) { setTermOpen(true); terminalRef.current?.newTerminal() } else openTerminal() } },
    { id: 'term.toggle', category: 'Terminal', label: 'Toggle Terminal', shortcut: 'Ctrl+`', run: () => (termOpen ? setTermOpen(false) : openTerminal()) },
    { id: 'term.clear', category: 'Terminal', label: 'Clear Terminal', enabled: termMounted, run: () => terminalRef.current?.clear() },
    { id: 'term.kill', category: 'Terminal', label: 'Kill Terminal', enabled: termMounted, run: () => terminalRef.current?.killActive() },
    { id: 'term.runSelection', category: 'Terminal', label: 'Run Selected Text', run: () => { const t = selectionText(); if (t) runInTerminal(t); else setNotice('Select some text first.') } },
    { id: 'term.runLastCode', category: 'Terminal', label: 'Run Last Code Block', run: () => { const a = lastAnswer(); const m = a?.content.match(/```(?:bash|sh|shell|zsh|powershell|ps1|pwsh|cmd|console)?\n([\s\S]*?)```(?![\s\S]*```)/); if (m) runInTerminal(m[1]); else setNotice('No shell code block in the last answer.') } },
    { id: 'term.workspace', category: 'Terminal', label: 'Open Workspace Folder in Terminal', run: async () => { const dir = await api.workspaceDir(); runInTerminal(`cd "${dir}"`) } },
    // Help
    { id: 'help.welcome', category: 'Help', label: 'Welcome', run: () => { setTemporaryChat(false); startNewChat(); setActiveNav('chats') } },
    { id: 'help.commands', category: 'Help', label: 'Show All Commands', shortcut: 'Ctrl+Shift+P', run: () => setPalette('commands') },
    { id: 'help.docs', category: 'Help', label: 'Documentation', run: () => api.openExternal('https://github.com/iwerry/chatorbit-app#readme') },
    { id: 'help.issue', category: 'Help', label: 'Report Issue', run: () => api.openExternal('https://github.com/iwerry/chatorbit-app/issues/new') },
    { id: 'help.devtools', category: 'Help', label: 'Toggle Developer Tools', shortcut: 'Ctrl+Shift+I', run: () => api.win.devtools() },
    { id: 'help.reload', category: 'Help', label: 'Reload Window', shortcut: 'Ctrl+R', run: () => api.win.reload() },
    { id: 'help.data', category: 'Help', label: 'Open Data Folder', run: () => api.revealData() },
    { id: 'help.updates', category: 'Help', label: 'Check for Updates…', run: () => api.openExternal('https://github.com/iwerry/chatorbit-app/releases') },
    { id: 'help.about', category: 'Help', label: 'About Orbi', run: () => setSettingsOpen('about') },
  ]
  const commands = Object.fromEntries(commandList.map((c) => [c.id, c]))
  const menus: MenuDef[] = [
    { label: 'File', items: ['file.newChat', 'file.newTemp', 'file.newWindow', 'file.newProject', '-', 'file.openFile', 'file.import', '-', 'file.export', '-', 'file.settings', 'file.localAI', '-', 'file.closeChat', 'file.closeWindow', '-', 'file.exit'] },
    { label: 'Edit', items: ['edit.undo', 'edit.redo', '-', 'edit.cut', 'edit.copy', 'edit.paste', '-', 'edit.find', 'edit.searchChats', '-', 'edit.copyAnswer', 'edit.clearComposer'] },
    { label: 'Selection', items: ['sel.all', 'sel.lastAnswer', '-', 'sel.copy', 'sel.quote', '-', 'sel.runTerminal', 'sel.clear'] },
    { label: 'View', items: ['view.palette', '-', 'go.chats', 'go.creative', 'go.agents', 'go.skills', 'go.mcp', 'go.media', '-', 'view.sidebar', 'view.workspace', 'view.terminal', '-', { label: 'Appearance', submenu: ['view.light', 'view.dark', 'view.terminalTheme'] }, 'view.zoomIn', 'view.zoomOut', 'view.zoomReset', 'view.fullscreen'] },
    { label: 'Go', items: ['go.chats', 'go.creative', 'go.agents', 'go.skills', 'go.mcp', 'go.scheduled', 'go.memory', 'go.bookmarks', 'go.media', '-', 'go.nextChat', 'go.prevChat', '-', 'go.chat'] },
    { label: 'Terminal', items: ['term.new', 'term.toggle', '-', 'term.runSelection', 'term.runLastCode', 'term.workspace', '-', 'term.clear', 'term.kill'] },
    { label: 'Help', items: ['help.welcome', 'help.commands', 'help.docs', '-', 'help.issue', '-', 'help.devtools', 'help.reload', 'help.data', '-', 'help.updates', 'help.about'] },
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
      setNotice('Downloading a tiny local AI (≈105 MB)…')
      await api.installLocalModel('smollm2-135m')
      await loadModels()
      setSelectedModel('orbi::smollm2-135m')
      setNotice('Local AI ready — it runs on this PC, no key needed.')
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

  const lastAssistantIdx = messages.map((m) => m.role).lastIndexOf('assistant')
  const conversationSources = messages.flatMap((m) => parseAttachments(m.attachments))

  return (
    <RunCodeContext.Provider value={runInTerminal}>
    <TitleBar
      menus={menus}
      commands={commands}
      title={activeNav === 'creative' ? 'Orbi — Creative' : activeConversation ? `${activeConversation.title} — Orbi` : 'Orbi'}
      onLogo={() => goNav('chats')}
    />
    <div className="app-frame">
    <div
      className="app-shell"
      style={{ '--workspace-panel-size': `${leftPanelWidth}px`, '--context-panel-size': `${rightPanelWidth}px` } as CSSProperties}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        if (activeNav !== 'creative' && e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
      }}
    >
      <nav className="tool-rail" aria-label="Main navigation">
        <button className="rail-brand" onClick={() => toggleNavigation('chats')} aria-label="Orbi" title="Orbi">
          <OrbiMark width={21} height={21} />
        </button>
        <div className="rail-navigation">
          {navItems.map((item) => {
            const Icon = item.icon
            const selected = activeNav === item.id && (item.id === 'creative' || panelOpen)
            return (
              <button
                key={item.id}
                className={`rail-button ${selected ? 'rail-button-active' : ''}`}
                onClick={() => toggleNavigation(item.id)}
                aria-label={item.label}
                aria-pressed={selected}
                title={item.label}
              >
                <Icon size={18} strokeWidth={1.8} />
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
                <p className="mt-0.5 text-[10px] text-[#919d95]">Local account · Orbi {info?.version}</p>
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
              <span>Upgrade plan</span>
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
              <span>Profile</span>
            </button>
            <button
              className="profile-menu-item"
              role="menuitem"
              onClick={() => {
                setProfileOpen(false)
                setSettingsOpen('providers')
              }}
            >
              <Settings size={16} />
              <span>Settings</span>
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
              <span>Help & data</span>
            </button>
            <button className="profile-menu-item profile-menu-logout" role="menuitem" onClick={() => window.close()}>
              <LogOut size={16} />
              <span>Quit Orbi</span>
            </button>
          </div>
        </>
      )}

      {panelOpen && activeNav !== 'creative' && (
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

      {activeNav === 'creative' ? (
        <CreativeWorkspace
          themeMode={themeMode}
          setThemeMode={setThemeMode}
          onBack={() => {
            setActiveNav('chats')
            setPanelOpen(false)
          }}
          models={models}
          onOpenSettings={() => setSettingsOpen('providers')}
          onMediaCreated={(m) => setMedia((cur) => [m, ...cur])}
        />
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
                    <span className="config-label">{currentModel?.name ?? (models.length ? 'Choose model' : 'Connect a model')}</span>
                    <ChevronDown size={13} />
                  </button>
                  <button className={`config-trigger ${headerMenu === 'skills' ? 'config-trigger-active' : ''}`} onClick={() => toggleHeaderMenu('skills')} aria-expanded={headerMenu === 'skills'}>
                    <Blocks size={16} />
                    <span className="config-label">Skills</span>
                    {activeSkills.length > 0 && <span className="config-count">{activeSkills.length}</span>}
                  </button>
                  <button className={`config-trigger ${headerMenu === 'agents' ? 'config-trigger-active' : ''}`} onClick={() => toggleHeaderMenu('agents')} aria-expanded={headerMenu === 'agents'}>
                    <Bot size={16} />
                    <span className="config-label">Agents</span>
                    {activeAgents.length > 0 && <span className="config-count">{activeAgents.length}</span>}
                  </button>
                  <button
                    className={`config-trigger config-add-trigger ${headerMenu === 'add' ? 'config-trigger-active' : ''}`}
                    onClick={() => toggleHeaderMenu('add')}
                    aria-label="Add another model"
                    aria-expanded={headerMenu === 'add'}
                    title="Compare models side by side"
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
                                <p>LLM model</p>
                                <span>Choose the AI for this conversation</span>
                              </div>
                              <Cpu size={17} />
                            </div>
                            {chatModels.length > 0 && (
                              <label className="sidebar-search popover-search">
                                <Search size={14} />
                                <input autoFocus value={modelSearch} onChange={(e) => setModelSearch(e.target.value)} placeholder={`Search ${chatModels.length} models`} />
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
                              {!modelsLoading && chatModels.length === 0 && <p className="popover-empty">No models yet. Connect a provider — OpenRouter gives you hundreds of models with one key, or Ollama runs them locally for free.</p>}
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
                                <span>Manage providers</span>
                              </button>
                              <button onClick={() => loadModels()}>
                                <RotateCcw size={15} />
                                <span>Refresh list</span>
                              </button>
                            </div>
                          </>
                        )}

                        {headerMenu === 'skills' && (
                          <>
                            <div className="config-popover-heading">
                              <div>
                                <p>Active Skills</p>
                                <span>Select capabilities for this chat</span>
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
                                <p>Agents</p>
                                <span>Activate one or multiple agents</span>
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
                                  setActiveNav('agents')
                                  setPanelOpen(true)
                                }}
                              >
                                <Bot size={15} />
                                <span>Open Agent Builder</span>
                              </button>
                            </div>
                          </>
                        )}

                        {headerMenu === 'add' && (
                          <>
                            <div className="config-popover-heading">
                              <div>
                                <p>Add models</p>
                                <span>Each answer comes from every selected model</span>
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
                                <span>Connect API provider</span>
                              </button>
                              <button
                                onClick={() => {
                                  setHeaderMenu(null)
                                  setSettingsOpen('providers')
                                }}
                              >
                                <Server size={15} />
                                <span>Add local model</span>
                              </button>
                            </div>
                            <label className="sidebar-search popover-search">
                              <Search size={14} />
                              <input value={modelSearch} onChange={(e) => setModelSearch(e.target.value)} placeholder="Search models" />
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
                    Workspace
                  </button>
                )}
                {messages.length > 0 && (
                  <button className="header-action hidden sm:flex" onClick={startNewChat} title="New chat">
                    <Plus size={16} />
                    New
                  </button>
                )}
                <ThemeSwitcher themeMode={themeMode} setThemeMode={setThemeMode} />
                <button
                  className={`temporary-header ${temporaryChat ? 'temporary-header-active' : ''}`}
                  onClick={toggleTemporaryChat}
                  aria-label="Toggle temporary chat"
                  title="Temporary chat"
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
                      <h2>Temporary chat</h2>
                      <p>This conversation will not appear in your history and will be deleted automatically.</p>
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
                      <p className="welcome-kicker">{themeMode === 'terminal' ? 'ORBI // TERMINAL SESSION' : 'Video-first creative canvas'}</p>
                      <h2>{themeMode === 'terminal' ? `System ready, ${userName}.` : `${greeting()}, ${userName}.`}</h2>
                      <p>{themeMode === 'terminal' ? 'Initialize a multimodal workflow.' : 'Direct video, image, and story workflows from one prompt.'}</p>
                      <div className="hero-capabilities">
                        <span>
                          <Video size={12} />
                          Video
                        </span>
                        <span>
                          <ImageIcon size={12} />
                          Image
                        </span>
                        <span>
                          <FileText size={12} />
                          Story
                        </span>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="date-divider">
                    <span>{activeConversation ? new Date(activeConversation.created_at).toLocaleDateString('en-US', { dateStyle: 'medium' }) : 'Today'}</span>
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
                              <summary>Thinking</summary>
                              <p>{item.reasoning}</p>
                            </details>
                          )}
                          {parseJSON<ToolEvent[]>(item.tools, []).length > 0 && (
                            <div className="tool-events">
                              {parseJSON<ToolEvent[]>(item.tools, []).map((t) => {
                                const [srv, ...rest] = t.name.split('__')
                                return (
                                  <details key={t.id} className={`tool-event tool-${t.status}`}>
                                    <summary>
                                      {t.status === 'running' ? <Loader2 size={12} className="animate-spin" /> : <Wrench size={12} />}
                                      <span>
                                        {rest.join('__') || t.name}
                                        <small> · {servers.find((x) => x.id === srv)?.name ?? srv}</small>
                                      </span>
                                      <em>{t.status === 'running' ? 'running' : t.status === 'error' ? 'failed' : 'done'}</em>
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
                            <div className="typing-bubble" aria-label="Orbi is typing">
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
                                  <button title="Copy" onClick={() => navigator.clipboard.writeText(item.content)}>
                                    <Copy size={12} />
                                  </button>
                                  {!item.temp && conversationId && (
                                    <button
                                      title={item.bookmarked ? 'Remove bookmark' : 'Bookmark'}
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
                                <button title="Regenerate" onClick={regenerate}>
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
                    <p className="mb-3 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-[#939c96]">Keep exploring</p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {suggestions.map((s) => (
                        <button key={s} className="suggestion-chip" onClick={() => sendMessage(s)}>
                          {s}
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
                      <button type="button" onClick={() => setActiveAgents((cur) => cur.filter((x) => x !== h))} aria-label={`Stop using ${h}`}>
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
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onPaste={(e) => {
                    const files = Array.from(e.clipboardData.files)
                    if (files.length) {
                      e.preventDefault()
                      addFiles(files)
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendMessage(message)
                    }
                  }}
                  placeholder={temporaryChat ? 'Type a temporary message...' : themeMode === 'terminal' ? '> Enter a prompt...' : 'Ask anything...'}
                  aria-label="Message"
                />
                <div className="mt-2 flex items-center justify-between">
                  <button type="button" className="composer-tool" aria-label="Attach file" title="Attach files or images" onClick={() => fileInput.current?.click()}>
                    <Paperclip size={18} />
                  </button>
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
                    <span className="hidden text-[10px] text-[#9aa19d] sm:block">{additionalModels.length ? `${additionalModels.length + 1} models` : 'Press Enter to send'}</span>
                    <div className="response-mode-control">
                      <button type="button" className={`response-mode-trigger ${responseMenuOpen ? 'response-mode-trigger-active' : ''}`} onClick={() => setResponseMenuOpen((v) => !v)} aria-expanded={responseMenuOpen}>
                        <span>{responseMode}</span>
                        <ChevronDown size={12} />
                      </button>
                      {responseMenuOpen && (
                        <>
                          <button type="button" className="response-menu-backdrop" onClick={() => setResponseMenuOpen(false)} aria-label="Close response mode menu" />
                          <div className="response-mode-menu">
                            <div className="response-menu-heading">
                              <div>
                                <strong>Response behavior</strong>
                                <small>Configured for {currentModel?.name ?? 'your model'}</small>
                              </div>
                              <CircleHelp size={14} />
                            </div>
                            <p className="response-control-label">Mode</p>
                            <div className="response-type-options">
                              {(['Instant', 'Thinking'] as ResponseType[]).map((mode) => (
                                <button type="button" key={mode} className={`response-type-option ${responseType === mode ? 'response-type-option-active' : ''}`} onClick={() => setResponseType(mode)}>
                                  {mode}
                                </button>
                              ))}
                            </div>
                            {responseType === 'Thinking' && (
                              <div className="effort-control">
                                <div className="effort-heading">
                                  <span>Thinking effort</span>
                                  <strong>{reasoningEffort}</strong>
                                </div>
                                <div className="effort-scale">
                                  {(['Fast', 'Medium', 'High'] as ReasoningEffort[]).map((effort) => (
                                    <button type="button" key={effort} className={reasoningEffort === effort ? 'effort-option-active' : ''} onClick={() => setReasoningEffort(effort)}>
                                      <span />
                                      {effort}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                            <p className="response-model-note">Thinking uses extended reasoning on Claude and OpenRouter models that support it.</p>
                          </div>
                        </>
                      )}
                    </div>
                    <button type="button" className="microphone-button" onClick={() => setNotice('Voice input arrives with local Whisper in the next build.')} aria-label="Start voice input">
                      <Mic size={18} />
                    </button>
                    {isStreaming ? (
                      <button className="send-button send-button-stop" type="button" onClick={stop} aria-label="Stop generating" title="Stop">
                        <Square size={14} fill="currentColor" />
                      </button>
                    ) : (
                      <button className="send-button" type="submit" disabled={!message.trim() && !attachments.length} aria-label="Send message">
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
                        return d ? `Downloading local AI… ${d.total ? Math.round((d.received / d.total) * 100) : 0}%` : 'Try a free local AI (≈105 MB)'
                      })()}
                    </strong>
                    <small>SmolLM2 runs on this PC, offline, even with little memory. No key needed.</small>
                  </span>
                </button>
                <button className="connect-banner" onClick={() => setSettingsOpen('providers')}>
                  <Plug size={16} />
                  <span>
                    <strong>Connect your first AI provider</strong>
                    <small>Paste an OpenRouter, OpenAI, Anthropic or Gemini key — or use Ollama locally for free.</small>
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
                    return st.length ? st : starterPrompts
                  })().map((s) => (
                    <button key={s} className="suggestion-chip" onClick={() => sendMessage(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {!emptyLanding && (
                <p className="mt-2.5 text-center text-[10px] text-[#9ca39f]">
                  {temporaryChat ? 'This conversation will not be saved to your history or memory.' : 'Orbi can make mistakes. Verify important information.'}
                </p>
              )}
            </div>
          </main>

          {showContext && (
            <aside className="context-panel">
              <button className="panel-resize-handle panel-resize-handle-right" onPointerDown={(e) => startPanelResize('right', e)} aria-label="Resize workspace panel" />
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="eyebrow text-[#8a948e]">Workspace</p>
                  <h2 className="mt-1 truncate font-display text-lg font-semibold tracking-[-0.03em] text-[#1b241f]">{activeConversation?.title ?? 'New conversation'}</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button className="icon-button context-collapse" onClick={() => setContextOpen(false)} aria-label="Collapse workspace">
                    <ChevronRight size={17} />
                  </button>
                  <button className="icon-button" aria-label="Settings" onClick={() => setSettingsOpen('providers')}>
                    <MoreHorizontal size={18} />
                  </button>
                </div>
              </div>

              <div className="context-card mt-7">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <Sparkles size={15} className="text-[#59734b]" />
                  Active context
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[#6f7973]">
                  {[activeSkills.length && `${activeSkills.length} skill${activeSkills.length > 1 ? 's' : ''}`, activeAgents.length && activeAgents.join(', '), memoryEnabled && memories.length && `${memories.length} memories`]
                    .filter(Boolean)
                    .join(' · ') || 'No skills, agents or memories active.'}
                </p>
              </div>

              <div className="mt-8">
                <p className="eyebrow text-[#8a948e]">Project</p>
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
                    <option value="">No project</option>
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
                  <p className="eyebrow text-[#8a948e]">Sources</p>
                  <button className="text-[11px] font-semibold text-[#537047]" onClick={() => fileInput.current?.click()}>
                    Add
                  </button>
                </div>
                <div className="mt-3 space-y-2">
                  {conversationSources.length === 0 && <p className="text-[11px] text-[#8a938e]">Attach files or images to use them as context.</p>}
                  {conversationSources.map((s, i) => (
                    <div className="source-card" key={i}>
                      <div className={`source-icon ${s.dataUrl ? 'source-icon-blue' : ''}`}>{s.dataUrl ? <ImageIcon size={17} /> : <FileText size={17} />}</div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-[#26322b]">{s.name}</p>
                        <p className="mt-0.5 text-[10px] text-[#8a938e]">{s.text ? `${Math.round(s.text.length / 1000)}k characters` : s.mime}</p>
                      </div>
                      <Check size={14} className="text-[#658256]" />
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-8 border-t border-[#e4e5df] pt-6">
                <p className="eyebrow text-[#8a948e]">Details</p>
                <div className="mt-4 space-y-4">
                  <div className="flex items-center gap-3">
                    <Clock3 size={15} className="text-[#8a948e]" />
                    <div>
                      <p className="text-[10px] text-[#929a95]">Created on</p>
                      <p className="mt-0.5 text-xs font-medium text-[#465149]">{new Date(activeConversation?.created_at ?? Date.now()).toLocaleDateString('en-US', { dateStyle: 'long' })}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Bot size={15} className="text-[#8a948e]" />
                    <div className="min-w-0">
                      <p className="text-[10px] text-[#929a95]">Model{additionalModels.length ? 's' : ''}</p>
                      <p className="mt-0.5 truncate text-xs font-medium text-[#465149]">
                        {[currentModel?.name, ...additionalModels.map((k) => models.find((m) => m.key === k)?.name)].filter(Boolean).join(', ') || '—'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <MessageSquareText size={15} className="text-[#8a948e]" />
                    <div>
                      <p className="text-[10px] text-[#929a95]">Messages</p>
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
        <SettingsModal
          initialTab={settingsOpen}
          onClose={() => setSettingsOpen(null)}
          onChanged={loadModels}
          userName={userName}
          setUserName={setUserName}
          info={info}
          localStatus={localStatus}
          onLocalChanged={() => api.localStatus().then(setLocalStatus)}
        />
      )}

      {notice && <div className="orbi-toast">{notice}</div>}
      {!isDesktop && <div className="orbi-preview-badge">Browser preview</div>}
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
        <TerminalPanel
          ref={terminalRef}
          height={termMax ? Math.max(200, window.innerHeight - 140) : termHeight}
          setHeight={setTermHeight}
          maximized={termMax}
          setMaximized={setTermMax}
          onClose={() => setTermOpen(false)}
        />
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
          <h3>{approval.server} wants to act</h3>
          <pre>{approval.message}</pre>
          <label className="approval-always">
            <input type="checkbox" checked={alwaysAllow} onChange={(e) => setAlwaysAllow(e.target.checked)} /> Don't ask again (auto-approve tools)
          </label>
          <div className="flex justify-end gap-2">
            <button
              className="orbi-btn"
              onClick={() => {
                api.approveTool(approval.id, false)
                setApproval(null)
              }}
            >
              Deny
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
              Allow
            </button>
          </div>
        </div>
      </div>
    )}
    </RunCodeContext.Provider>
  )
}
