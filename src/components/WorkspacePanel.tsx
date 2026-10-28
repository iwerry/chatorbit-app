import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  Bookmark,
  Hammer,
  Bot,
  Blocks,
  Brain,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  Compass,
  ExternalLink,
  FolderKanban,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Library,
  Maximize2,
  MessageSquareText,
  Pencil,
  Pin,
  Plug,
  PinOff,
  Plus,
  Search,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from 'lucide-react'
import { openInCreative } from '../lib/creativeBus'
import { api, type Agent, type Conversation, type McpServer, type MediaItem, type Memory, type Message, type ModelInfo, type Plugin, type Project, type Skill } from '../lib/api'
import { t } from '../lib/i18n'
import { McpPanel } from './panels/McpPanel'
import { Lightbox } from './Lightbox'

export type NavKey = 'chats' | 'creative' | 'explore' | 'studio' | 'agents' | 'skills' | 'mcp' | 'scheduled' | 'memory' | 'bookmarks' | 'media'
// Full-page sections (no side panel).
export const isPage = (s: string) => s === 'creative' || s === 'explore' || s === 'studio' || s === 'media'

export const navItems = [
  { id: 'chats' as const, label: 'Chats', icon: MessageSquareText },
  { id: 'creative' as const, label: 'Creative', icon: WandSparkles },
  { id: 'explore' as const, label: 'Explore', icon: Compass },
  { id: 'studio' as const, label: 'Creator Studio', icon: Hammer },
  { id: 'mcp' as const, label: 'MCP & Plugins', icon: Plug },
  { id: 'scheduled' as const, label: 'Scheduled Chats', icon: CalendarClock },
  { id: 'memory' as const, label: 'Memory', icon: Brain },
  { id: 'bookmarks' as const, label: 'Bookmarks', icon: Bookmark },
  { id: 'media' as const, label: 'Media Library', icon: Library },
]

function groupLabel(ts: number) {
  const now = new Date()
  const created = new Date(ts)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = new Date(created.getFullYear(), created.getMonth(), created.getDate()).getTime()
  if (day === today) return 'Today'
  if (day === today - 86400000) return 'Yesterday'
  if (created.getFullYear() === now.getFullYear()) return new Intl.DateTimeFormat('en-US', { month: 'long' }).format(created)
  return String(created.getFullYear())
}

type Props = {
  active: NavKey
  onCollapse: () => void
  onResize: (event: ReactPointerEvent<HTMLButtonElement>) => void
  // chats
  conversations: Conversation[]
  projects: Project[]
  activeConversationId: string | null
  activeProjectId: string | null
  setActiveProjectId: (id: string | null) => void
  onOpenConversation: (id: string) => void
  onNewChat: () => void
  onRefresh: () => void
  // other modules
  agents: Agent[]
  memories: Memory[]
  bookmarks: Message[]
  media: MediaItem[]
  skills: Skill[]
  models: ModelInfo[]
  servers: McpServer[]
  setServers: (s: McpServer[]) => void
  plugins: Plugin[]
  setPlugins: (p: Plugin[]) => void
  onChatWithAgent: (handle: string) => void
  memoryEnabled: boolean
  setMemoryEnabled: (v: boolean) => void
  onOpenCreative: () => void
}

export function WorkspacePanel(props: Props) {
  const current = navItems.find((i) => i.id === props.active) ?? navItems[0]
  const Icon = current.icon
  return (
    <aside className="workspace-panel">
      <div className="panel-heading">
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon size={18} />
          <span className="truncate font-display text-sm font-semibold">{t(current.label)}</span>
        </div>
        <div className="flex items-center gap-1">
          <button className="panel-collapse" onClick={props.onCollapse} aria-label={t('Collapse panel')}>
            <ChevronLeft size={17} />
          </button>
        </div>
      </div>
      {current.id === 'chats' && <ChatsLibrary {...props} />}
      {current.id === 'mcp' && <McpPanel servers={props.servers} setServers={props.setServers} plugins={props.plugins} setPlugins={props.setPlugins} onRefresh={props.onRefresh} />}
      {current.id === 'scheduled' && <ScheduledPanel />}
      {current.id === 'memory' && <MemoryPanel memories={props.memories} enabled={props.memoryEnabled} setEnabled={props.setMemoryEnabled} onRefresh={props.onRefresh} />}
      {current.id === 'bookmarks' && <BookmarksPanel bookmarks={props.bookmarks} onOpen={props.onOpenConversation} onRefresh={props.onRefresh} />}
      {current.id === 'media' && <MediaPanel media={props.media} onRefresh={props.onRefresh} onOpenCreative={props.onOpenCreative} />}
      <button className="panel-resize-handle panel-resize-handle-left" onPointerDown={props.onResize} aria-label={t('Resize navigation panel')} />
    </aside>
  )
}

function ChatsLibrary(p: Props) {
  const [search, setSearch] = useState('')
  const [projectsOpen, setProjectsOpen] = useState(true)
  const [pinnedOpen, setPinnedOpen] = useState(true)
  const [chatsOpen, setChatsOpen] = useState(true)
  const [newProject, setNewProject] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const filtered = useMemo(
    () =>
      p.conversations.filter(
        (c) => c.title.toLowerCase().includes(search.toLowerCase()) && (!p.activeProjectId || c.project_id === p.activeProjectId),
      ),
    [p.conversations, search, p.activeProjectId],
  )
  const pinned = filtered.filter((c) => c.pinned)
  const groups = useMemo(() => {
    const out: { label: string; items: Conversation[] }[] = []
    for (const c of filtered.filter((c) => !c.pinned)) {
      const label = groupLabel(c.updated_at)
      const g = out.find((x) => x.label === label)
      if (g) g.items.push(c)
      else out.push({ label, items: [c] })
    }
    return out
  }, [filtered])

  const commitRename = async (id: string) => {
    if (renameValue.trim()) await api.updateConversation(id, { title: renameValue.trim() })
    setRenaming(null)
    p.onRefresh()
  }

  const row = (c: Conversation) => (
    <div key={c.id} className={`conversation-item conversation-row ${c.id === p.activeConversationId ? 'conversation-active' : ''}`}>
      {renaming === c.id ? (
        <input
          className="conversation-rename"
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={() => commitRename(c.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename(c.id)
            if (e.key === 'Escape') setRenaming(null)
          }}
        />
      ) : (
        <button className="conversation-open" onClick={() => p.onOpenConversation(c.id)} title={c.title}>
          <MessageSquareText size={15} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">{c.title}</span>
        </button>
      )}
      <span className="conversation-tools">
        <button
          title={c.pinned ? 'Unpin' : 'Pin'}
          onClick={async () => {
            await api.updateConversation(c.id, { pinned: c.pinned ? 0 : 1 })
            p.onRefresh()
          }}
        >
          {c.pinned ? <PinOff size={13} /> : <Pin size={13} />}
        </button>
        <button
          title={t('Rename')}
          onClick={() => {
            setRenaming(c.id)
            setRenameValue(c.title)
          }}
        >
          <Pencil size={13} />
        </button>
        <button
          title={t('Delete')}
          onClick={async () => {
            if (!confirm(`Delete "${c.title}"?`)) return
            await api.deleteConversation(c.id)
            if (c.id === p.activeConversationId) p.onNewChat()
            p.onRefresh()
          }}
        >
          <Trash2 size={13} />
        </button>
      </span>
    </div>
  )

  return (
    <div className="panel-scroll chat-library">
      <label className="sidebar-search library-global-search">
        <Search size={15} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search chats')} />
      </label>

      <section className="library-section">
        <button className="library-section-heading" onClick={() => setProjectsOpen((v) => !v)} aria-expanded={projectsOpen}>
          <span>{t('Projects')}</span>
          <ChevronDown size={13} className={`section-chevron ${projectsOpen ? 'section-chevron-open' : ''}`} />
          <FolderKanban size={15} className="ml-auto" />
        </button>
        {projectsOpen && (
          <>
            {p.projects.map((proj) => (
              <div key={proj.id} className={`conversation-item conversation-row ${p.activeProjectId === proj.id ? 'conversation-active' : ''}`}>
                <button className="conversation-open" onClick={() => p.setActiveProjectId(p.activeProjectId === proj.id ? null : proj.id)}>
                  <FolderOpen size={15} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-left">{proj.name}</span>
                </button>
                <span className="conversation-tools">
                  <button
                    title={t('Delete project')}
                    onClick={async () => {
                      if (!confirm(`Delete project "${proj.name}"? Its chats are kept.`)) return
                      await api.deleteProject(proj.id)
                      if (p.activeProjectId === proj.id) p.setActiveProjectId(null)
                      p.onRefresh()
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
            ))}
            {newProject !== null ? (
              <input
                className="conversation-rename mt-1"
                autoFocus
                placeholder={t('Project name')}
                value={newProject}
                onChange={(e) => setNewProject(e.target.value)}
                onBlur={() => setNewProject(null)}
                onKeyDown={async (e) => {
                  if (e.key === 'Escape') setNewProject(null)
                  if (e.key === 'Enter' && newProject.trim()) {
                    const proj = await api.createProject(newProject.trim())
                    setNewProject(null)
                    p.setActiveProjectId(proj.id)
                    p.onRefresh()
                  }
                }}
              />
            ) : (
              <button className="library-primary-action" onClick={() => setNewProject('')}>
                <FolderPlus size={15} />
                <span>{t('New project')}</span>
              </button>
            )}
          </>
        )}
      </section>

      <section className="library-section pinned-library-section">
        <button className="library-section-heading" onClick={() => setPinnedOpen((v) => !v)} aria-expanded={pinnedOpen}>
          <span>{t('Pinned')}</span>
          <ChevronDown size={13} className={`section-chevron ${pinnedOpen ? 'section-chevron-open' : ''}`} />
          <Pin size={15} className="ml-auto" />
        </button>
        {pinnedOpen && (pinned.length ? <div className="mt-1.5 space-y-1">{pinned.map(row)}</div> : <p className="library-empty-row">{t('No pinned chats')}</p>)}
      </section>

      <section className="library-section chats-library-section">
        <div className="library-section-row">
          <button className="library-section-heading min-w-0 flex-1" onClick={() => setChatsOpen((v) => !v)} aria-expanded={chatsOpen}>
            <span>{p.activeProjectId ? p.projects.find((x) => x.id === p.activeProjectId)?.name ?? 'Chats' : 'Chats'}</span>
            <ChevronDown size={13} className={`section-chevron ${chatsOpen ? 'section-chevron-open' : ''}`} />
          </button>
          {p.activeProjectId && (
            <button className="library-filter" aria-label={t('Show all chats')} title={t('Show all chats')} onClick={() => p.setActiveProjectId(null)}>
              <X size={15} />
            </button>
          )}
        </div>
        {chatsOpen && (
          <>
            <div className="library-chat-actions">
              <button className="library-new-chat" onClick={p.onNewChat}>
                <Plus size={15} />
                <span>{t('New chat')}</span>
              </button>
            </div>
            {groups.length > 0 ? (
              <div className="conversation-groups">
                {groups.map((g) => (
                  <div className="conversation-group" key={g.label}>
                    <p className="eyebrow px-2 text-[#7e8a84]">{g.label}</p>
                    <div className="mt-1.5 space-y-1">{g.items.map(row)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-conversations">
                <MessageSquareText size={19} />
                <p>{search ? 'No matches' : 'No chats yet'}</p>
                <span>{t('Your conversations will be organized here automatically.')}</span>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}

function PanelIntro({ children }: { children: React.ReactNode }) {
  return <p className="px-3 text-xs leading-relaxed text-[color:var(--neo-faint)]">{children}</p>
}

function ScheduledPanel() {
  return (
    <div className="panel-scroll pt-4">
      <PanelIntro>{t('Automate recurring tasks and conversations — weekly summaries, trend radars, reports.')}</PanelIntro>
      <div className="empty-conversations mt-8">
        <CalendarClock size={19} />
        <p>{t('Coming in the next build')}</p>
        <span>{t('Scheduled chats will run in the OrbiX cloud so they work even with this PC turned off.')}</span>
      </div>
    </div>
  )
}

function MemoryPanel({ memories, enabled, setEnabled, onRefresh }: { memories: Memory[]; enabled: boolean; setEnabled: (v: boolean) => void; onRefresh: () => void }) {
  const [draft, setDraft] = useState('')
  return (
    <div className="panel-scroll pt-4">
      <PanelIntro>{t('Facts Orbi remembers about you and your work. They are added to every conversation when memory is on.')}</PanelIntro>
      <button className="module-item module-item-rich mt-4" onClick={() => setEnabled(!enabled)}>
        <Brain size={15} />
        <div className="min-w-0 flex-1 text-left">
          <strong>{t('Use memory in chats')}</strong>
          <small>{enabled ? 'On' : 'Off'}</small>
        </div>
        <span className={`orbi-switch orbi-switch-sm ${enabled ? 'orbi-switch-on' : ''}`}>
          <span />
        </span>
      </button>
      <div className="panel-form">
        <textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. I'm a video producer in São Paulo; I prefer answers in Portuguese." />
        <button
          className="orbi-btn orbi-btn-primary"
          disabled={!draft.trim()}
          onClick={async () => {
            await api.addMemory(draft.trim())
            setDraft('')
            onRefresh()
          }}
        >
          <Plus size={13} /> Remember this
        </button>
      </div>
      <div className="mt-2 space-y-1">
        {memories.length === 0 && <p className="library-empty-row">{t('No memories yet')}</p>}
        {memories.map((m, i) => (
          <div className="module-item module-item-rich" key={m.id}>
            <span className={`module-dot module-dot-${(i % 3) + 1}`} />
            <div className="min-w-0 flex-1 text-left">
              <small className="memory-text">{m.content}</small>
            </div>
            <span className="conversation-tools">
              <button
                title={t('Forget')}
                onClick={async () => {
                  await api.deleteMemory(m.id)
                  onRefresh()
                }}
              >
                <Trash2 size={13} />
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function BookmarksPanel({ bookmarks, onOpen, onRefresh }: { bookmarks: Message[]; onOpen: (id: string) => void; onRefresh: () => void }) {
  return (
    <div className="panel-scroll pt-4">
      <PanelIntro>{t('Answers you saved with the bookmark button. Click one to jump back to its conversation.')}</PanelIntro>
      <div className="mt-4 space-y-1">
        {bookmarks.length === 0 && <p className="library-empty-row">{t('No bookmarks yet')}</p>}
        {bookmarks.map((b, i) => (
          <div className="module-item module-item-rich" key={b.id}>
            <span className={`module-dot module-dot-${(i % 3) + 1}`} />
            <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(b.conversation_id)}>
              <strong>{b.conversation_title}</strong>
              <small>{b.content.slice(0, 140)}</small>
            </button>
            <span className="conversation-tools">
              <button
                title={t('Remove bookmark')}
                onClick={async () => {
                  await api.bookmark(b.id, false)
                  onRefresh()
                }}
              >
                <X size={13} />
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MediaPanel({ media, onRefresh, onOpenCreative }: { media: MediaItem[]; onRefresh: () => void; onOpenCreative: () => void }) {
  const [filter, setFilter] = useState<'all' | 'image' | 'video' | 'file'>('all')
  const [viewing, setViewing] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const shown = media.filter((m) => filter === 'all' || m.kind === filter || (filter === 'file' && (m.kind === 'audio' || m.kind === 'file')))
  return (
    <div className="panel-scroll pt-4">
      <PanelIntro>{t('Every asset created or imported across your conversations and Creative workflows.')}</PanelIntro>
      <div className="media-actions">
        <button className="orbi-btn" onClick={() => input.current?.click()}>
          <Upload size={13} /> {t('Import')}
        </button>
        <button className="orbi-btn orbi-btn-primary" onClick={onOpenCreative}>
          <WandSparkles size={13} /> {t('Create')}
        </button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={async (e) => {
            for (const f of Array.from(e.target.files ?? [])) {
              const dataUrl = await new Promise<string>((r) => {
                const fr = new FileReader()
                fr.onload = () => r(String(fr.result))
                fr.readAsDataURL(f)
              })
              await api.importMedia({ name: f.name, dataUrl })
            }
            e.target.value = ''
            onRefresh()
          }}
        />
      </div>
      <div className="creative-library-tabs media-tabs">
        {(['all', 'image', 'video', 'file'] as const).map((f) => (
          <button key={f} className={filter === f ? 'creative-library-tab-active' : ''} onClick={() => setFilter(f)}>
            {t(f === 'all' ? 'All' : f === 'image' ? 'Images' : f === 'video' ? 'Videos' : 'Files')}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="empty-conversations mt-6">
          <ImageIcon size={19} />
          <p>{t('Nothing here yet')}</p>
          <span>{t('Generate an image in Creative or import files to start your library.')}</span>
        </div>
      ) : (
        <div className="media-grid">
          {shown.map((m, k) => (
            <div className="media-tile" key={m.id} title={m.prompt || m.name}>
              {m.kind === 'image' ? (
                <img src={m.url} alt={m.name} loading="lazy" onClick={() => setViewing(k)} />
              ) : m.kind === 'video' ? (
                <video src={m.url} muted onClick={() => setViewing(k)} onMouseEnter={(e) => e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} />
              ) : (
                <div className="media-file" onClick={() => setViewing(k)}>
                  {m.name.split('.').pop()?.toUpperCase()}
                </div>
              )}
              <div className="media-tile-tools">
                <button title={t('View full screen')} onClick={() => setViewing(k)}>
                  <Maximize2 size={12} />
                </button>
                <button title={t('Open in another app')} onClick={() => api.openMedia(m.id)}>
                  <ExternalLink size={12} />
                </button>
                <button title={t('Show in folder')} onClick={() => api.revealMedia(m.id)}>
                  <FolderOpen size={12} />
                </button>
                <button
                  title={t('Delete')}
                  onClick={async () => {
                    if (!confirm(t('Delete this file from the library?'))) return
                    await api.deleteMedia(m.id)
                    onRefresh()
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {viewing !== null && shown[viewing] && (
        <Lightbox
          items={shown}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          onDeleted={onRefresh}
          onUsePrompt={(m, negative) => {
            sendPromptToCreative(m.prompt, negative, m.kind === 'video' ? 'video' : 'image')
            setViewing(null)
            onOpenCreative()
          }}
        />
      )}
    </div>
  )
}

// Sends a prompt to the Creative canvas (it listens while open and reads the setting when it opens).
export function sendPromptToCreative(prompt: string, negative?: string, mode: 'image' | 'video' = 'image') {
  openInCreative({ prompt, negative: negative || '', mode })
}
