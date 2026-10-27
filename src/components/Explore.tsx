import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Bot, Blocks, Check, ChevronLeft, Clapperboard, Code, ExternalLink, GraduationCap, Layout, Megaphone, Newspaper, Package, Palette, PenLine, Plus, Search, Server, Star, Video } from 'lucide-react'
import { api, type Library, type LibraryAgent, type LibraryKit, type LibrarySkill, type SkillSignals } from '../lib/api'
import { t } from '../lib/i18n'

const ICONS: Record<string, typeof Code> = { palette: Palette, layout: Layout, code: Code, server: Server, newspaper: Newspaper, clapperboard: Clapperboard, megaphone: Megaphone, 'graduation-cap': GraduationCap, chart: BarChart3, video: Video, pen: PenLine }

const SIGNALS: [keyof SkillSignals, string][] = [
  ['purpose', 'Clear purpose and when to use it'],
  ['method', 'Structured method (3+ sections or a detailed playbook)'],
  ['knowledge', '3+ reference files with the knowledge it relies on'],
  ['checks', 'Scripts or tests that validate the result'],
  ['open', 'Published on GitHub with an open-source license'],
]

function Stars({ skill }: { skill: LibrarySkill }) {
  const tip = SIGNALS.map(([k, label]) => `${skill.signals[k] ? '★' : '☆'} ${t(label)}`).join('\n')
  return (
    <span className="lib-stars" title={tip} aria-label={t('{n} of 5 stars', { n: skill.rating })}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={11} className={i <= skill.rating ? 'on' : ''} />
      ))}
    </span>
  )
}

type Tab = 'skills' | 'agents' | 'kits'

export function Explore({ onBack, onChanged, onUseAgent }: { onBack: () => void; onChanged: () => void; onUseAgent: (handle: string) => void }) {
  const [lib, setLib] = useState<Library | null>(null)
  const [prof, setProf] = useState<string>('all')
  const [tab, setTab] = useState<Tab>('kits')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = () => api.library().then(setLib)
  useEffect(() => {
    load()
  }, [])

  const match = (s: string) => s.toLowerCase().includes(q.toLowerCase())
  const inProf = (p: string) => prof === 'all' || p === prof
  type Item = LibrarySkill | LibraryAgent | LibraryKit
  const items = useMemo((): Item[] => {
    if (!lib) return []
    if (tab === 'skills') return lib.skills.filter((x) => inProf(x.profession) && (match(x.name) || match(x.description)))
    if (tab === 'agents') return lib.agents.filter((x) => inProf(x.profession) && (match(x.name) || match(x.description) || match(x.handle)))
    return lib.kits.filter((x) => inProf(x.profession) && (match(x.name) || match(x.description)))
  }, [lib, tab, prof, q])

  const install = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id)
    try {
      await fn()
      await load()
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  const profName = (id: string) => lib?.professions.find((p) => p.id === id)?.name ?? id

  return (
    <main className="explore">
      <header className="explore-head">
        <button className="creative-topbar-button" onClick={onBack} aria-label={t('Back to chats')}>
          <ChevronLeft size={17} />
        </button>
        <div className="min-w-0">
          <h1>{t('Explore')}</h1>
          <p>{t('Ready-made skills, agents and toolkits for your profession. Everything is stored on this computer — installing is instant.')}</p>
        </div>
        <label className="sidebar-search explore-search">
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search the library')} />
        </label>
      </header>
      <div className="explore-body">
        <nav className="explore-profs" aria-label={t('Professions')}>
          <button className={prof === 'all' ? 'active' : ''} onClick={() => setProf('all')}>
            <Package size={15} />
            {t('All professions')}
          </button>
          {lib?.professions.map((p) => {
            const Icon = ICONS[p.icon] ?? Package
            return (
              <button key={p.id} className={prof === p.id ? 'active' : ''} onClick={() => setProf(p.id)} title={t(p.description)}>
                <Icon size={15} />
                {t(p.name)}
              </button>
            )
          })}
        </nav>
        <section className="explore-main">
          <div className="hub-tabs" role="tablist">
            {(
              [
                ['kits', 'Toolkits', Package],
                ['skills', 'Skills', Blocks],
                ['agents', 'Agents', Bot],
              ] as const
            ).map(([id, label, Icon]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
                <Icon size={14} />
                {t(label)}
              </button>
            ))}
          </div>
          {tab === 'skills' && (
            <details className="lib-howto">
              <summary>
                <Star size={12} /> {t('How the stars work')}
              </summary>
              <p>{t('Each star is a quality signal anyone can check in the skill’s repository. Skills are ranked by stars and each profession shows its top 10.')}</p>
              <ul>
                {SIGNALS.map(([k, label]) => (
                  <li key={k}>★ {t(label)}</li>
                ))}
              </ul>
            </details>
          )}
          {!lib && <div className="hub-skeleton" aria-busy="true" />}
          <ul className="explore-list">
            {items.map((it) => {
              const installed = it.installed
              const id = it.id
              const handle = 'handle' in it ? (it as LibraryAgent).handle : null
              const kit = 'servers' in it ? (it as LibraryKit) : null
              const skill = tab === 'skills' ? (it as LibrarySkill) : null
              return (
                <li key={id} className={`explore-row ${installed ? 'installed' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <p className="explore-row-title">
                      <strong>{handle ?? t(it.name)}</strong>
                      {handle && <span className="explore-sub">{t(it.name)}</span>}
                      {prof === 'all' && <span className="hub-badge">{t(profName(it.profession))}</span>}
                      {skill && <Stars skill={skill} />}
                    </p>
                    <p className="explore-desc">{t(it.description)}</p>
                    {skill && skill.author !== 'Orbi' && (
                      <p className="lib-author">
                        <span className={`lib-author-name ${skill.author === 'Daniel Rodrigues' ? 'mine' : ''}`}>{t('by {name}', { name: skill.author })}</span>
                        {skill.license && <span>{skill.license}</span>}
                        {skill.signals.references ? <span>{t('{n} reference files', { n: skill.signals.references })}</span> : null}
                        {skill.source && (
                          <button className="lib-source" onClick={() => api.openExternal(skill.source!)}>
                            GitHub <ExternalLink size={11} />
                          </button>
                        )}
                      </p>
                    )}
                    {kit && (
                      <p className="explore-kit">
                        {kit.skills.length} {t('skills')} · {kit.agents.length} {t('agents')} · {t('tools')}: {kit.servers.join(', ')}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {handle && installed && (
                      <button className="orbi-btn" onClick={() => onUseAgent(handle)}>
                        {t('Chat')}
                      </button>
                    )}
                    {installed ? (
                      <span className="provider-status">
                        <Check size={12} className="inline" /> {t('Installed')}
                      </span>
                    ) : (
                      <button
                        className="orbi-btn orbi-btn-primary"
                        disabled={busy === id}
                        onClick={() =>
                          install(id, () => (tab === 'skills' ? api.installLibrarySkill(id) : tab === 'agents' ? api.installLibraryAgent(id) : api.installKit(id)))
                        }
                      >
                        <Plus size={13} /> {t('Install')}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          {lib && !items.length && <p className="library-empty-row">{t('Nothing matches your search.')}</p>}
        </section>
      </div>
    </main>
  )
}
