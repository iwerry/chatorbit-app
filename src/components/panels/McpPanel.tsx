import { useEffect, useState } from 'react'
import { t } from '../../lib/i18n'
import { ChevronDown, FolderOpen, Globe, Loader2, Plus, Puzzle, RefreshCw, Server, Terminal, Trash2, Wrench } from 'lucide-react'
import { api, type CatalogEntry, type McpServer, type Plugin } from '../../lib/api'

function StatusDot({ status }: { status: McpServer['status'] }) {
  return <span className={`mcp-dot mcp-dot-${status}`} title={status} />
}

export function McpPanel({ servers, setServers, plugins, setPlugins, onRefresh }: { servers: McpServer[]; setServers: (s: McpServer[]) => void; plugins: Plugin[]; setPlugins: (p: Plugin[]) => void; onRefresh: () => void }) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [toolsOn, setToolsOn] = useState(true)
  const [workspace, setWorkspace] = useState('')
  const [adding, setAdding] = useState<null | { type: 'http' | 'stdio'; name: string; url: string; command: string; headers: string }>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    api.mcpCatalog().then(setCatalog)
    api.getSetting('toolsEnabled', true).then(setToolsOn)
    api.workspaceDir().then(setWorkspace)
  }, [])

  const run = async (id: string, fn: () => Promise<McpServer[]>) => {
    setBusy(id)
    try {
      setServers(await fn())
    } finally {
      setBusy(null)
    }
  }

  const connectedTools = servers.filter((s) => s.status === 'connected').reduce((n, s) => n + s.tools.length, 0)
  const installed = new Set(servers.map((s) => s.id))

  return (
    <div className="panel-scroll mcp-panel">
      <p className="px-1 text-xs leading-relaxed text-[color:var(--neo-faint)]">{t('Give Orbi abilities with MCP servers and plugins. Everything that needs no setup is already connected.')}</p>

      <button
        className="module-item module-item-rich mt-3"
        onClick={() => {
          setToolsOn(!toolsOn)
          api.setSetting('toolsEnabled', !toolsOn)
        }}
      >
        <Wrench size={15} />
        <div className="min-w-0 flex-1 text-left">
          <strong>{t('Use tools in chat')}</strong>
          <small>
            {toolsOn ? `On · ${connectedTools} tools available` : 'Off'} — models that support tools can call them.
          </small>
        </div>
        <span className={`orbi-switch orbi-switch-sm ${toolsOn ? 'orbi-switch-on' : ''}`}>
          <span />
        </span>
      </button>

      <div className="module-item module-item-rich">
        <FolderOpen size={15} />
        <div className="min-w-0 flex-1 text-left">
          <strong>{t('Workspace folder')}</strong>
          <small title={workspace}>{workspace}</small>
        </div>
        <button className="mcp-mini" onClick={async () => setWorkspace(await api.chooseWorkspace())}>
          {t('Change')}
        </button>
      </div>

      <p className="eyebrow mt-5 px-1 text-[#7e8a84]">{t('Plugins')}</p>
      <div className="mt-2 space-y-1.5">
        {plugins.map((p) => (
          <div className="mcp-card" key={p.id}>
            <Puzzle size={15} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <strong>{p.name}</strong>
              <small>{p.description}</small>
            </div>
            <button
              className={`orbi-switch orbi-switch-sm ${p.enabled ? 'orbi-switch-on' : ''}`}
              onClick={async () => {
                setPlugins(await api.setPlugin(p.id, !p.enabled))
                onRefresh()
              }}
              aria-label={p.enabled ? 'Disable plugin' : 'Enable plugin'}
            >
              <span />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between px-1">
        <p className="eyebrow text-[#7e8a84]">{t('MCP servers')}</p>
        <button className="panel-add" aria-label={t('Add MCP server')} onClick={() => setAdding({ type: 'http', name: '', url: '', command: '', headers: '' })}>
          <Plus size={13} />
        </button>
      </div>

      {adding && (
        <div className="panel-form">
          <div className="ab-segment w-full">
            {(['http', 'stdio'] as const).map((t) => (
              <button key={t} className={adding.type === t ? 'active' : ''} onClick={() => setAdding({ ...adding, type: t })}>
                {t === 'http' ? 'Remote (URL)' : 'Local (command)'}
              </button>
            ))}
          </div>
          <input placeholder={t('Name')} value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
          {adding.type === 'http' ? (
            <>
              <input placeholder="https://example.com/mcp" value={adding.url} onChange={(e) => setAdding({ ...adding, url: e.target.value })} />
              <input placeholder={t('Authorization header (optional)')} value={adding.headers} onChange={(e) => setAdding({ ...adding, headers: e.target.value })} />
            </>
          ) : (
            <input placeholder="npx -y @scope/server --flag" value={adding.command} onChange={(e) => setAdding({ ...adding, command: e.target.value })} />
          )}
          <div className="flex gap-2">
            <button
              className="orbi-btn orbi-btn-primary"
              disabled={!adding.name.trim() || (adding.type === 'http' ? !adding.url.trim() : !adding.command.trim())}
              onClick={async () => {
                const id = adding.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
                const [command, ...args] = adding.command.trim().split(/\s+/)
                const server: Partial<McpServer> =
                  adding.type === 'http'
                    ? { id, name: adding.name.trim(), type: 'http', url: adding.url.trim(), headers: adding.headers.trim() ? { Authorization: adding.headers.trim() } : {}, enabled: true }
                    : { id, name: adding.name.trim(), type: 'stdio', command, args, enabled: true }
                setAdding(null)
                await run(id, () => api.saveMcp(server))
              }}
            >
              {t('Connect')}
            </button>
            <button className="orbi-btn" onClick={() => setAdding(null)}>
              {t('Cancel')}
            </button>
          </div>
        </div>
      )}

      <div className="mt-2 space-y-1.5">
        {servers.map((s) => (
          <div className={`mcp-card mcp-server ${expanded === s.id ? 'mcp-open' : ''}`} key={s.id}>
            <button className="mcp-server-head" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
              {s.type === 'builtin' ? (s.id === 'orbi-terminal' ? <Terminal size={15} /> : <Wrench size={15} />) : s.type === 'http' ? <Globe size={15} /> : <Server size={15} />}
              <div className="min-w-0 flex-1 text-left">
                <strong>
                  <StatusDot status={s.status} /> {s.name}
                </strong>
                <small>{s.status === 'connected' ? `${s.tools.length} tools · ${s.type === 'builtin' ? 'built-in' : s.type}` : s.status === 'error' ? 'Could not connect' : s.status}</small>
              </div>
              {busy === s.id ? <Loader2 size={14} className="animate-spin" /> : <ChevronDown size={13} className={`section-chevron ${expanded === s.id ? 'section-chevron-open' : ''}`} />}
            </button>
            {expanded === s.id && (
              <div className="mcp-detail">
                {s.description && <p>{s.description}</p>}
                {s.url && <code>{s.url}</code>}
                {s.command && (
                  <code>
                    {s.command} {(s.args || []).join(' ')}
                  </code>
                )}
                {s.error && <p className="mcp-error">{s.error}</p>}
                {s.tools.length > 0 && (
                  <ul>
                    {s.tools.map((t) => (
                      <li key={t.name} title={t.description}>
                        <Wrench size={10} /> {t.name}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap gap-1.5">
                  <button className="mcp-mini" onClick={() => run(s.id, () => api.saveMcp({ id: s.id, enabled: !s.enabled }))}>
                    {s.enabled ? 'Disable' : 'Enable'}
                  </button>
                  {s.enabled && (
                    <button className="mcp-mini" onClick={() => run(s.id, () => api.reconnectMcp(s.id))}>
                      <RefreshCw size={11} /> Reconnect
                    </button>
                  )}
                  {s.type !== 'builtin' && (
                    <button className="mcp-mini mcp-mini-danger" onClick={() => run(s.id, () => api.removeMcp(s.id))}>
                      <Trash2 size={11} /> Remove
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="eyebrow mt-5 px-1 text-[#7e8a84]">{t('Catalog')}</p>
      <div className="mt-2 space-y-1.5 pb-6">
        {catalog
          .filter((c) => !installed.has(c.id))
          .map((c) => (
            <div className="mcp-card" key={c.id}>
              {c.type === 'http' ? <Globe size={15} className="mt-0.5 shrink-0" /> : <Server size={15} className="mt-0.5 shrink-0" />}
              <div className="min-w-0 flex-1">
                <strong>{c.name}</strong>
                <small>{c.description}</small>
              </div>
              <button
                className="mcp-mini"
                disabled={busy === c.id}
                onClick={() =>
                  c.headers && Object.values(c.headers).some((v) => v.includes('<'))
                    ? setAdding({ type: 'http', name: c.name, url: c.url ?? '', command: '', headers: 'Bearer ' })
                    : run(c.id, () => api.saveMcp({ ...c, enabled: true }))
                }
              >
                {busy === c.id ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Add
              </button>
            </div>
          ))}
      </div>
    </div>
  )
}
