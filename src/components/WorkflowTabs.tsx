import { useCallback, useEffect, useState, type ComponentProps, type ComponentType } from 'react'
import { Plus, X, Loader2 } from 'lucide-react'
import { api } from '../lib/api'
import { t } from '../lib/i18n'

type Tab = { id: string; name: string }
type Workspace = { tabs: Tab[]; active: string; closed: Tab[] }
const initial: Workspace = { tabs: [{ id: 'flow', name: 'Workflow 1' }], active: 'flow', closed: [] }

export function WorkflowTabs<P extends { visible?: boolean; storageKey?: string; onBusyChange?: (key: string, busy: boolean) => void; pendingTemplate?: unknown }>({ Editor, editorProps }: { Editor: ComponentType<P>; editorProps: Omit<P, 'storageKey' | 'onBusyChange'> }) {
  const [workspace, setWorkspace] = useState(initial)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const reportBusy = useCallback((id: string, running: boolean) => setBusy((prev) => prev[id] === running ? prev : { ...prev, [id]: running }), [])
  useEffect(() => {
    api.getSetting('workflowTabs', initial).then((saved) => {
      if (saved?.tabs?.length && saved.tabs.every((tab) => typeof tab.id === 'string' && typeof tab.name === 'string') && new Set(saved.tabs.map((tab) => tab.id)).size === saved.tabs.length) {
        setWorkspace({ tabs: saved.tabs, active: saved.tabs.some((tab) => tab.id === saved.active) ? saved.active : saved.tabs[0].id, closed: Array.isArray(saved.closed) ? saved.closed : [] })
      }
    }).catch(() => {}).finally(() => setLoaded(true))
  }, [])
  useEffect(() => {
    if (loaded) api.setSetting('workflowTabs', workspace).catch(console.error)
  }, [loaded, workspace])
  const add = () => {
    const tab = { id: `flow-${crypto.randomUUID()}`, name: `${t('Workflow')} ${workspace.tabs.length + 1}` }
    setWorkspace((prev) => ({ ...prev, tabs: [...prev.tabs, tab], active: tab.id }))
  }
  const close = (id: string) => {
    if (busy[id] || workspace.tabs.length === 1) return
    if (!confirm(t('Close this workflow tab? Its saved workflow will be kept.'))) return
    setWorkspace((prev) => {
      const tabs = prev.tabs.filter((tab) => tab.id !== id)
      return { tabs, closed: [...prev.closed.filter((tab) => tab.id !== id), prev.tabs.find((tab) => tab.id === id)!], active: prev.active === id ? tabs[Math.max(0, prev.tabs.findIndex((tab) => tab.id === id) - 1)].id : prev.active }
    })
  }
  if (!loaded) return <div className="hub-skeleton" />
  return <div className="flow-workspace" style={editorProps.visible === false ? { display: 'none' } : undefined}>
    <div className="flow-tabs" role="tablist" aria-label={t('Open workflows')}>
      {workspace.tabs.map((tab) => <div className={`flow-tab ${workspace.active === tab.id ? 'active' : ''}`} key={tab.id}>
        <button role="tab" aria-selected={workspace.active === tab.id} onClick={() => setWorkspace((prev) => ({ ...prev, active: tab.id }))} title={tab.name}>
          {busy[tab.id] && <Loader2 size={12} className="animate-spin" />}{tab.name}
        </button>
        {workspace.active === tab.id && <input className="flow-tab-rename" aria-label={t('Rename workflow')} value={tab.name} maxLength={60} onChange={(e) => {
          const name = e.target.value
          setWorkspace((prev) => ({ ...prev, tabs: prev.tabs.map((item) => item.id === tab.id ? { ...item, name } : item) }))
        }} onBlur={() => setWorkspace((prev) => ({ ...prev, tabs: prev.tabs.map((item) => item.id === tab.id && !item.name.trim() ? { ...item, name: t('Workflow') } : item) }))} />}
        <button className="flow-tab-close" aria-label={t('Close workflow')} disabled={busy[tab.id] || workspace.tabs.length === 1} onClick={() => close(tab.id)}><X size={13} /></button>
      </div>)}
      <button className="orbi-btn flow-tab-add" onClick={add} aria-label={t('New workflow')}><Plus size={14} />{t('New workflow')}</button>
      {workspace.closed.length > 0 && <select className="ab-input flow-reopen" value="" aria-label={t('Reopen workflow')} onChange={(e) => {
        const id = e.target.value
        setWorkspace((prev) => {
          const tab = prev.closed.find((tab) => tab.id === id)
          return tab ? { tabs: [...prev.tabs, tab], active: id, closed: prev.closed.filter((tab) => tab.id !== id) } : prev
        })
      }}><option value="">{t('Reopen workflow')}</option>{workspace.closed.map((tab) => <option key={tab.id} value={tab.id}>{tab.name}</option>)}</select>}
    </div>
    {workspace.tabs.map((tab) => <Editor key={tab.id} {...{ ...editorProps, storageKey: tab.id, visible: editorProps.visible !== false && workspace.active === tab.id, pendingTemplate: workspace.active === tab.id ? editorProps.pendingTemplate : null, onBusyChange: reportBusy } as P} />)}
  </div>
}
