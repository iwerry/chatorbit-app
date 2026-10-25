import { useState } from 'react'
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import { api, type Skill } from '../../lib/api'

export function SkillsPanel({ skills, onRefresh, creating, setCreating }: { skills: Skill[]; onRefresh: () => void; creating: boolean; setCreating: (v: boolean) => void }) {
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState(true)
  const [editing, setEditing] = useState<Partial<Skill> | null>(null)
  const shown = skills.filter((k) => k.name.toLowerCase().includes(filter.toLowerCase()))
  const form = creating ? { name: '', description: '', instructions: '' } : editing

  const close = () => {
    setEditing(null)
    setCreating(false)
  }

  return (
    <div className="panel-scroll skills-panel">
      <input className="ab-input" placeholder="Filter skills by name" value={filter} onChange={(e) => setFilter(e.target.value)} />

      {form && (
        <SkillForm
          key={form.id ?? 'new'}
          initial={form}
          onCancel={close}
          onSave={async (k) => {
            await api.saveSkill(k)
            close()
            onRefresh()
          }}
        />
      )}

      <button className="library-section-heading mt-3" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <ChevronDown size={13} className={`section-chevron ${open ? 'section-chevron-open' : ''}`} />
        <span>My Skills</span>
        <span className="ml-auto text-[10px] opacity-60">{skills.filter((k) => k.enabled).length} on</span>
      </button>
      {open && (
        <div className="mt-1 space-y-1">
          {shown.length === 0 && <p className="library-empty-row text-center">No skills yet</p>}
          {shown.map((k, i) => (
            <div className="module-item module-item-rich" key={k.id}>
              <span className={`module-dot module-dot-${(i % 3) + 1}`} />
              <button className="min-w-0 flex-1 text-left" onClick={() => api.toggleSkill(k.id, !k.enabled).then(onRefresh)}>
                <strong>{k.name}</strong>
                <small>{k.description || k.instructions}</small>
              </button>
              <span className="conversation-tools">
                <button title="Edit" onClick={() => setEditing(k)}>
                  <Pencil size={13} />
                </button>
                <button
                  title="Delete"
                  onClick={async () => {
                    if (!confirm(`Delete skill "${k.name}"?`)) return
                    await api.deleteSkill(k.id)
                    onRefresh()
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </span>
              <button className={`orbi-switch orbi-switch-sm ${k.enabled ? 'orbi-switch-on' : ''}`} onClick={() => api.toggleSkill(k.id, !k.enabled).then(onRefresh)} aria-label={k.enabled ? 'Turn off' : 'Turn on'}>
                <span />
              </button>
            </div>
          ))}
        </div>
      )}
      {!form && (
        <button className="library-primary-action mt-3" onClick={() => setCreating(true)}>
          <Plus size={15} />
          <span>New skill</span>
        </button>
      )}
    </div>
  )
}

function SkillForm({ initial, onSave, onCancel }: { initial: Partial<Skill>; onSave: (k: Partial<Skill>) => void; onCancel: () => void }) {
  const [k, setK] = useState(initial)
  return (
    <div className="panel-form skill-form">
      <input placeholder="Skill name" value={k.name ?? ''} onChange={(e) => setK({ ...k, name: e.target.value })} autoFocus />
      <input placeholder="Short description" value={k.description ?? ''} onChange={(e) => setK({ ...k, description: e.target.value })} />
      <textarea rows={6} placeholder="Instructions: how should Orbi behave when this skill is on?" value={k.instructions ?? ''} onChange={(e) => setK({ ...k, instructions: e.target.value })} />
      <div className="flex gap-2">
        <button className="orbi-btn orbi-btn-primary" disabled={!k.name?.trim() || !k.instructions?.trim()} onClick={() => onSave(k)}>
          {k.id ? 'Save' : 'Create'}
        </button>
        <button className="orbi-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
