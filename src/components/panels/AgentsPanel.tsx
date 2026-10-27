import { useEffect, useMemo, useState } from 'react'
import { t } from '../../lib/i18n'
import { ChevronDown, Maximize2, MessageSquarePlus, Plus, Settings2, Trash2, Wrench, X } from 'lucide-react'
import { api, parseJSON, type Agent, type McpServer, type ModelInfo, type Skill } from '../../lib/api'

const CATEGORIES = ['General', 'Development', 'Creative', 'Research', 'Marketing', 'Data', 'Support']
const COLORS = ['#c8f04a', '#75bdc8', '#b99ad0', '#f0a35e', '#ef7d7d', '#7fd3a1']

type Draft = {
  id?: string
  name: string
  description: string
  model: string
  category: string
  instructions: string
  tools: string[]
  skills_mode: 'off' | 'all' | 'selected'
  skills: string[]
  starters: string[]
  support_name: string
  support_email: string
  color: string
}

const empty = (): Draft => ({
  name: '',
  description: '',
  model: '',
  category: 'General',
  instructions: '',
  tools: [],
  skills_mode: 'off',
  skills: [],
  starters: [''],
  support_name: '',
  support_email: '',
  color: COLORS[0],
})

function fromAgent(a: Agent): Draft {
  const starters = parseJSON<string[]>(a.starters, [])
  return {
    id: a.id,
    name: a.name || a.handle.slice(1),
    description: a.description || '',
    model: a.model || '',
    category: a.category || 'General',
    instructions: a.instructions || '',
    tools: parseJSON<string[]>(a.tools, []),
    skills_mode: (a.skills_mode as Draft['skills_mode']) || 'off',
    skills: parseJSON<string[]>(a.skills, []),
    starters: starters.length ? starters : [''],
    support_name: a.support_name || '',
    support_email: a.support_email || '',
    color: a.color || COLORS[0],
  }
}

export function AgentsPanel({
  agents,
  models,
  skills,
  servers,
  onRefresh,
  onChatWithAgent,
}: {
  agents: Agent[]
  models: ModelInfo[]
  skills: Skill[]
  servers: McpServer[]
  onRefresh: () => void
  onChatWithAgent: (handle: string) => void
}) {
  const [selectedId, setSelectedId] = useState<string>('new')
  const [draft, setDraft] = useState<Draft>(empty)
  const [toolPicker, setToolPicker] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [bigEditor, setBigEditor] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    const a = agents.find((x) => x.id === selectedId)
    setDraft(a ? fromAgent(a) : empty())
    setToolPicker(false)
  }, [selectedId])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const chatModels = useMemo(() => models.filter((m) => !m.image), [models])
  const canSave = draft.name.trim() && draft.instructions.trim()

  const save = async () => {
    if (!canSave) return
    const id = await api.saveAgent({ ...draft, starters: draft.starters.map((s) => s.trim()).filter(Boolean) })
    setSaved(draft.id ? 'Saved' : 'Created')
    setTimeout(() => setSaved(null), 1600)
    onRefresh()
    if (id) setSelectedId(id)
  }

  const current = agents.find((x) => x.id === selectedId)

  return (
    <div className="panel-scroll agent-builder">
      <label className="ab-select">
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          <option value="new">{t('Create New Agent')}</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.handle}
            </option>
          ))}
        </select>
        <ChevronDown size={14} />
      </label>

      <div className="ab-identity">
        <button className="ab-avatar" style={{ background: draft.color }} onClick={() => setAdvanced(true)} title={t('Agent color')}>
          {draft.name ? draft.name[0].toUpperCase() : <Plus size={18} />}
        </button>
        <div className="ab-identity-fields">
          <input className="ab-input" placeholder={t('Agent name')} value={draft.name} onChange={(e) => set('name', e.target.value)} />
          <input className="ab-input" placeholder={t('What this agent does')} value={draft.description} onChange={(e) => set('description', e.target.value)} />
        </div>
      </div>

      <div className="ab-row">
        <div>
          <p className="ab-label">
            Model <i>*</i>
          </p>
          <select className="ab-input" value={draft.model} onChange={(e) => set('model', e.target.value)}>
            <option value="">{t('Current chat model')}</option>
            {chatModels.map((m) => (
              <option key={m.key} value={m.key}>
                {m.name} · {m.providerName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="ab-label">
            Category <i>*</i>
          </p>
          <select className="ab-input" value={draft.category} onChange={(e) => set('category', e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="ab-label-row">
        <p className="ab-label">{t('Instructions')}</p>
        <button onClick={() => setBigEditor(true)} title={t('Expand editor')}>
          <Maximize2 size={13} />
        </button>
      </div>
      <textarea className="ab-input ab-textarea" rows={5} placeholder={t('The system instructions that the agent uses')} value={draft.instructions} onChange={(e) => set('instructions', e.target.value)} />

      <div className="ab-label-row">
        <p className="ab-label">{t('Tools')}</p>
        <button onClick={() => setToolPicker((v) => !v)}>
          <Plus size={13} /> Add
        </button>
      </div>
      {toolPicker && (
        <div className="ab-picker">
          {servers.length === 0 && <p className="ab-hint">{t('Connect MCP servers in MCP & Plugins first.')}</p>}
          {servers.map((s) => (
            <label key={s.id} className="ab-check">
              <input type="checkbox" checked={draft.tools.includes(s.id)} onChange={() => set('tools', draft.tools.includes(s.id) ? draft.tools.filter((x) => x !== s.id) : [...draft.tools, s.id])} />
              <span>
                <strong>{s.name}</strong>
                <small>
                  {s.tools.length} tools · {s.status}
                </small>
              </span>
            </label>
          ))}
        </div>
      )}
      {draft.tools.length ? (
        <div className="ab-chips">
          {draft.tools.map((tool) => (
            <span key={tool} className="ab-chip">
              <Wrench size={11} />
              {servers.find((s) => s.id === tool)?.name ?? tool}
              <button onClick={() => set('tools', draft.tools.filter((x) => x !== tool))} aria-label={t('Remove tool')}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <button className="ab-empty" onClick={() => setToolPicker(true)}>
          <Plus size={14} />
          <strong>{t('No tools yet')}</strong>
          <span>{t('Add a tool to give your agent extra abilities.')}</span>
        </button>
      )}

      <div className="ab-label-row">
        <p className="ab-label">{t('Skills')}</p>
        <div className="ab-segment">
          {(['off', 'all', 'selected'] as const).map((m) => (
            <button key={m} className={draft.skills_mode === m ? 'active' : ''} onClick={() => set('skills_mode', m)}>
              {m === 'off' ? 'Off' : m === 'all' ? 'All' : 'Selected'}
            </button>
          ))}
        </div>
      </div>
      {draft.skills_mode === 'selected' && (
        <div className="ab-picker">
          {skills.map((k) => (
            <label key={k.id} className="ab-check">
              <input type="checkbox" checked={draft.skills.includes(k.name)} onChange={() => set('skills', draft.skills.includes(k.name) ? draft.skills.filter((x) => x !== k.name) : [...draft.skills, k.name])} />
              <span>
                <strong>{k.name}</strong>
                <small>{k.description}</small>
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="ab-label-row">
        <p className="ab-label">{t('File context')}</p>
      </div>
      <p className="ab-hint">{draft.id ? 'Attach files in a chat with this agent — they are added as context.' : 'Agent must be created before uploading files for File Context.'}</p>

      <p className="ab-label mt-4">{t('Conversation starters')}</p>
      {draft.starters.map((st, i) => (
        <div className="ab-starter" key={i}>
          <input
            className="ab-input"
            placeholder={t('Enter a conversation starter')}
            value={st}
            onChange={(e) => set('starters', draft.starters.map((x, j) => (j === i ? e.target.value : x)))}
          />
          {i === draft.starters.length - 1 ? (
            <button onClick={() => set('starters', [...draft.starters, ''])} aria-label={t('Add starter')}>
              <Plus size={14} />
            </button>
          ) : (
            <button onClick={() => set('starters', draft.starters.filter((_, j) => j !== i))} aria-label={t('Remove starter')}>
              <X size={13} />
            </button>
          )}
        </div>
      ))}

      <p className="ab-label mt-4">{t('Support contact')}</p>
      <input className="ab-input" placeholder={t('Support contact name')} value={draft.support_name} onChange={(e) => set('support_name', e.target.value)} />
      <input className="ab-input mt-2" placeholder="support@example.com" value={draft.support_email} onChange={(e) => set('support_email', e.target.value)} />

      {advanced && (
        <div className="ab-advanced">
          <p className="ab-label">{t('Color')}</p>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button key={c} className={`ab-color ${draft.color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => set('color', c)} aria-label={c} />
            ))}
          </div>
        </div>
      )}

      <div className="ab-footer">
        <button className="ab-advanced-btn" onClick={() => setAdvanced((v) => !v)}>
          <Settings2 size={14} /> Advanced
        </button>
        {current && (
          <div className="flex gap-2">
            <button className="ab-secondary" onClick={() => onChatWithAgent(current.handle)}>
              <MessageSquarePlus size={14} /> Chat
            </button>
            <button
              className="ab-secondary ab-danger"
              onClick={async () => {
                if (!confirm(`Delete ${current.handle}?`)) return
                await api.deleteAgent(current.id)
                setSelectedId('new')
                onRefresh()
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
        <button className="ab-create" disabled={!canSave} onClick={save}>
          {saved ?? (draft.id ? 'Save' : 'Create')}
        </button>
      </div>

      {bigEditor && (
        <div className="orbi-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setBigEditor(false)}>
          <div className="ab-big-editor">
            <div className="flex items-center justify-between">
              <h3>Instructions · {draft.name || 'New agent'}</h3>
              <button className="orbi-modal-close static" onClick={() => setBigEditor(false)} aria-label={t('Close')}>
                <X size={16} />
              </button>
            </div>
            <textarea autoFocus value={draft.instructions} onChange={(e) => set('instructions', e.target.value)} placeholder={t('The system instructions that the agent uses')} />
          </div>
        </div>
      )}
    </div>
  )
}
