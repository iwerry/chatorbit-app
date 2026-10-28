// Creator Studio: one place to create Skills, Agents, Multi-agent teams and Harnesses.
// The brain is SKILLSMITH (by Daniel Rodrigues): discovery → design → build → tests → audit → package → iterate.
// The same flow runs from the chat with /skill-creator, /agent-creator, /multi-agents and /harness.
import { useEffect, useMemo, useState } from 'react'
import {
  Blocks,
  Bot,
  Check,
  ChevronLeft,
  CircleAlert,
  Copy,
  Download,
  FileCode2,
  Hammer,
  Layers,
  Loader2,
  MessageSquarePlus,
  Plus,
  Power,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Users,
  Wand2,
  X,
} from 'lucide-react'
import {
  api,
  parseJSON,
  type Agent,
  type Harness,
  type HarnessConfig,
  type McpServer,
  type ModelInfo,
  type Skill,
  type SkillCheck,
  type SkillDoc,
  type StudioKind,
  type Team,
  type TeamMember,
} from '../lib/api'
import { t } from '../lib/i18n'
import { AgentsPanel, type Draft } from './panels/AgentsPanel'

export type StudioIntent = { kind: StudioKind; brief: string; auto: boolean; nonce: number }

const KINDS: { id: StudioKind; label: string; hint: string; icon: typeof Blocks; cmd: string }[] = [
  { id: 'skill', label: 'Skills', hint: 'Reusable procedures the AI loads only when needed', icon: Blocks, cmd: '/skill-creator' },
  { id: 'agent', label: 'Agents', hint: 'Personas with their own instructions, tools and skills', icon: Bot, cmd: '/agent-creator' },
  { id: 'team', label: 'Multi-agents', hint: 'Teams of agents that work in sequence, in parallel, by routing or by debate', icon: Users, cmd: '/multi-agents' },
  { id: 'harness', label: 'Harness', hint: 'The runtime around the model: allowed tools, skills, agents, context and rules', icon: Layers, cmd: '/harness' },
]
const PHASES = ['Discovery', 'Design', 'Build', 'Tests', 'Audit', 'Package', 'Iterate']
const MODES: { id: Team['mode']; label: string; hint: string }[] = [
  { id: 'sequential', label: 'Sequential', hint: 'Each member improves the previous result (pipeline).' },
  { id: 'parallel', label: 'Parallel', hint: 'Members answer independently; the synthesizer merges.' },
  { id: 'router', label: 'Router', hint: 'A lead picks the single best member for each request.' },
  { id: 'debate', label: 'Debate', hint: 'Members critique each other; the synthesizer decides.' },
]
const cleanErr = (e: unknown) => String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const emptyDoc = (): SkillDoc => ({ name: '', description: '', body: '', files: [], tests: { positive: [], negative: [], cases: [] }, license: 'MIT', version: '1.0.0' })
const toDoc = (k: Skill): SkillDoc => ({ name: k.name, description: k.description, body: k.instructions, files: k.files || [], tests: k.tests || {}, license: k.meta?.license, version: k.meta?.version, compatibility: k.meta?.compatibility, author: k.meta?.author, audit: k.meta?.audit })

type Props = {
  skills: Skill[]
  agents: Agent[]
  servers: McpServer[]
  models: ModelInfo[]
  model: ModelInfo | null
  intent: StudioIntent | null
  activeHarness: string | null
  setActiveHarness: (id: string | null) => void
  onRefresh: () => void
  onBack: () => void
  onChatWith: (handle: string) => void
}

export function CreatorStudio(props: Props) {
  const [kind, setKind] = useState<StudioKind>(props.intent?.kind || 'skill')
  const [teams, setTeams] = useState<Team[]>([])
  const [harnesses, setHarnesses] = useState<Harness[]>([])
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [modelKey, setModelKey] = useState<string>(props.model?.key || '')
  const model = props.models.find((m) => m.key === modelKey) || props.model
  // AI brief and discovery
  const [brief, setBrief] = useState(props.intent?.brief || '')
  const [questions, setQuestions] = useState<{ q: string; a: string }[] | null>(null)
  const [phase, setPhase] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // drafts produced by the brain
  const [skillDraft, setSkillDraft] = useState<{ doc: SkillDoc; id?: string; nonce: number } | null>(null)
  const [agentPreset, setAgentPreset] = useState<{ nonce: number; draft: Partial<Draft> } | null>(null)
  const [teamDraft, setTeamDraft] = useState<TeamDraft | null>(null)
  const [harnessDraft, setHarnessDraft] = useState<HarnessDraft | null>(null)

  const reloadExtras = () => {
    api.teams().then(setTeams)
    api.harnesses().then(setHarnesses)
  }
  useEffect(reloadExtras, [])
  useEffect(() => {
    if (!modelKey && props.model) setModelKey(props.model.key)
  }, [props.model])
  // Opened from a slash command: switch tab, fill the brief and start.
  useEffect(() => {
    if (!props.intent) return
    setKind(props.intent.kind)
    setBrief(props.intent.brief)
    resetDraft()
    if (props.intent.auto && props.intent.brief.trim()) setTimeout(() => build(props.intent!.kind, props.intent!.brief, []), 50)
  }, [props.intent?.nonce])

  const resetDraft = () => {
    setQuestions(null)
    setPhase(-1)
    setErr(null)
    setSelected(null)
    setSkillDraft(null)
    setTeamDraft(null)
    setHarnessDraft(null)
  }
  const switchKind = (k: StudioKind) => {
    setKind(k)
    resetDraft()
    setBrief('')
  }

  const ask = async () => {
    if (!model) return setErr(t('Pick a model first.'))
    setBusy(true)
    setErr(null)
    setPhase(0)
    try {
      const r = await api.studioAsk({ kind, brief, providerId: model.provider, model: model.id })
      setQuestions((r.questions || []).slice(0, 5).map((x) => ({ q: x, a: '' })))
    } catch (e) {
      setErr(cleanErr(e))
      setPhase(-1)
    } finally {
      setBusy(false)
    }
  }

  const build = async (k: StudioKind = kind, b: string = brief, answers = questions || [], current?: unknown) => {
    if (!model) return setErr(t('Pick a model first.'))
    setBusy(true)
    setErr(null)
    setPhase(1)
    const timer = setInterval(() => setPhase((p) => (p < 3 ? p + 1 : p)), 9000)
    try {
      const r = await api.studioBuild({ kind: k, brief: b, answers, current, providerId: model.provider, model: model.id })
      setPhase(4)
      const it = r.item || {}
      if (k === 'skill') {
        setSkillDraft({ doc: { ...emptyDoc(), ...it, body: it.body || '', files: it.files || [], tests: it.tests || {}, audit: it.audit }, id: skillDraft?.id, nonce: Date.now() })
      } else if (k === 'agent') {
        setAgentPreset({ nonce: Date.now(), draft: { name: it.name || it.handle || '', description: it.description || '', category: it.category || 'General', instructions: it.instructions || '', starters: it.starters || [], tools: (it.tools || []).filter((x: string) => props.servers.some((s) => s.id === x)), skills_mode: it.skills?.length ? 'selected' : 'off', skills: (it.skills || []).filter((n: string) => props.skills.some((s) => s.name === n)) } })
      } else if (k === 'team') {
        setTeamDraft({ name: it.name || '', handle: it.handle || '', description: it.description || '', mode: it.mode || 'sequential', members: (it.members || []).map((m: TeamMember) => ({ ...m })), synthesizer: it.synthesizer || '' })
      } else {
        const p = it.policies || {}
        setHarnessDraft({ name: it.name || '', description: it.description || '', config: { agents: (it.agents || []).map((h: string) => (h.startsWith('@') ? h : '@' + h)), skills: it.skills || [], servers: it.servers || [], policies: { context_budget: p.context_budget || 32000, compact_tool_output: p.compact_tool_output || 2000, approval: p.approval || 'risky', web: p.web || 'auto', memory: p.memory !== false, rules: p.rules || '' } } })
      }
      setPhase(5)
      setQuestions(null)
    } catch (e) {
      setErr(cleanErr(e))
      setPhase(-1)
    } finally {
      clearInterval(timer)
      setBusy(false)
    }
  }

  // ---------- list ----------
  const list = useMemo(() => {
    const m = (s: string) => s.toLowerCase().includes(q.toLowerCase())
    if (kind === 'skill') return props.skills.filter((k) => m(k.name) || m(k.description || '')).map((k) => ({ id: k.id, title: k.name, sub: k.description, on: !!k.enabled }))
    if (kind === 'agent') return props.agents.filter((a) => m(a.handle) || m(a.description || '')).map((a) => ({ id: a.id, title: a.handle, sub: a.description || a.instructions.slice(0, 80), on: undefined }))
    if (kind === 'team') return teams.filter((x) => m(x.handle) || m(x.name || '')).map((x) => ({ id: x.id, title: x.handle, sub: `${x.mode} · ${parseJSON<TeamMember[]>(x.members, []).length} ${t('members')}`, on: undefined }))
    return harnesses.filter((x) => m(x.name)).map((x) => ({ id: x.id, title: x.name, sub: x.description, on: props.activeHarness === x.id }))
  }, [kind, q, props.skills, props.agents, teams, harnesses, props.activeHarness])

  const open = (id: string) => {
    setErr(null)
    setQuestions(null)
    setPhase(-1)
    setSelected(id)
    if (kind === 'skill') {
      const k = props.skills.find((x) => x.id === id)
      if (k) setSkillDraft({ doc: toDoc(k), id: k.id, nonce: Date.now() })
    } else if (kind === 'team') {
      const x = teams.find((y) => y.id === id)
      if (x) setTeamDraft({ id: x.id, name: x.name, handle: x.handle.slice(1), description: x.description, mode: x.mode, members: parseJSON<TeamMember[]>(x.members, []), synthesizer: x.synthesizer })
    } else if (kind === 'harness') {
      const x = harnesses.find((y) => y.id === id)
      if (x) setHarnessDraft({ id: x.id, name: x.name, description: x.description, config: parseJSON<HarnessConfig>(x.config, {}) })
    }
  }
  const newItem = () => {
    resetDraft()
    if (kind === 'skill') setSkillDraft({ doc: emptyDoc(), nonce: Date.now() })
    if (kind === 'agent') setAgentPreset({ nonce: Date.now(), draft: {} })
    if (kind === 'team') setTeamDraft({ name: '', handle: '', description: '', mode: 'sequential', members: [], synthesizer: '' })
    if (kind === 'harness') setHarnessDraft({ name: '', description: '', config: { agents: [], skills: [], servers: [], policies: { context_budget: 32000, compact_tool_output: 2000, approval: 'risky', web: 'auto', memory: true, rules: '' } } })
  }
  const importZip = async () => {
    try {
      const doc = await api.importSkill()
      if (doc) setSkillDraft({ doc: { ...emptyDoc(), ...doc }, nonce: Date.now() })
    } catch (e) {
      setErr(cleanErr(e))
    }
  }

  const K = KINDS.find((x) => x.id === kind)!
  const hasDraft = (kind === 'skill' && skillDraft) || (kind === 'team' && teamDraft) || (kind === 'harness' && harnessDraft) || kind === 'agent'

  return (
    <main className="studio-page">
      <header className="explore-head">
        <button className="creative-topbar-button" onClick={props.onBack} aria-label={t('Back to chats')}>
          <ChevronLeft size={17} />
        </button>
        <div className="min-w-0">
          <h1>
            <Hammer size={20} className="inline -mt-1" /> {t('Creator Studio')}
          </h1>
          <p>{t('Create skills, agents, multi-agent teams and harnesses in one place. Describe what you need and SKILLSMITH builds, tests and audits it — or write it yourself.')}</p>
        </div>
        <label className="studio-model">
          <span>{t('Brain model')}</span>
          <select className="ab-input" value={modelKey} onChange={(e) => setModelKey(e.target.value)}>
            {props.models
              .filter((m) => !m.image)
              .map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name} · {m.providerName}
                </option>
              ))}
          </select>
        </label>
      </header>

      <div className="studio-tabs" role="tablist">
        {KINDS.map((k) => (
          <button key={k.id} role="tab" aria-selected={kind === k.id} className={kind === k.id ? 'active' : ''} onClick={() => switchKind(k.id)}>
            <k.icon size={15} />
            <span>
              <strong>{t(k.label)}</strong>
              <small>{k.cmd}</small>
            </span>
          </button>
        ))}
      </div>

      <div className="studio-body">
        <aside className="studio-list">
          <label className="sidebar-search">
            <Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search')} />
          </label>
          <div className="studio-list-actions">
            <button className="orbi-btn orbi-btn-primary" onClick={newItem}>
              <Plus size={13} /> {t('New')}
            </button>
            {kind === 'skill' && (
              <button className="orbi-btn" onClick={importZip} title={t('Import a skill (.zip or SKILL.md)')}>
                <Upload size={13} /> {t('Import')}
              </button>
            )}
          </div>
          <ul>
            {list.map((x) => (
              <li key={x.id} className={selected === x.id ? 'active' : ''}>
                <button className="min-w-0 flex-1 text-left" onClick={() => open(x.id)}>
                  <strong className="truncate">{x.title}</strong>
                  <small className="truncate">{x.sub}</small>
                </button>
                {kind === 'skill' && (
                  <button
                    className={`orbi-switch orbi-switch-sm ${x.on ? 'orbi-switch-on' : ''}`}
                    onClick={() => api.toggleSkill(x.id, !x.on).then(props.onRefresh)}
                    aria-label={x.on ? t('Turn off') : t('Turn on')}
                  >
                    <span />
                  </button>
                )}
                {kind === 'harness' && x.on && <span className="hub-badge hub-badge-rec">{t('Active')}</span>}
              </li>
            ))}
            {!list.length && <li className="library-empty-row">{t('Nothing here yet.')}</li>}
          </ul>
        </aside>

        <section className="studio-main">
          <div className="studio-brain">
            <div className="studio-brain-head">
              <Sparkles size={16} />
              <div>
                <strong>{t('Create with AI')}</strong>
                <small>
                  {t(K.hint)} · {t('Also in the chat:')} <code>{K.cmd}</code>
                </small>
              </div>
            </div>
            <textarea
              className="ab-input"
              rows={3}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder={
                kind === 'skill'
                  ? t('e.g. Turn our weekly sales spreadsheet into an executive report with KPIs and risks, in the company style.')
                  : kind === 'agent'
                    ? t('e.g. A senior video editor who plans cuts, pacing and B-roll for YouTube.')
                    : kind === 'team'
                      ? t('e.g. A campaign team: strategist, copywriter and art director, then a reviewer that merges everything.')
                      : t('e.g. A safe research harness: web and files only, no terminal, short tool outputs, cite sources.')
              }
            />
            <div className="studio-brain-actions">
              <button className="orbi-btn" disabled={busy || !brief.trim()} onClick={ask}>
                <CircleAlert size={13} /> {t('Ask me questions first')}
              </button>
              <button className="orbi-btn orbi-btn-primary" disabled={busy || !brief.trim()} onClick={() => build()}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} {t('Create now')}
              </button>
              {!model && <span className="studio-warn">{t('Connect an AI provider to use the brain.')}</span>}
            </div>
            {phase >= 0 && (
              <ol className="studio-phases">
                {PHASES.map((p, i) => (
                  <li key={p} className={i < phase ? 'done' : i === phase ? 'now' : ''}>
                    {i < phase ? <Check size={11} /> : <span>{i + 1}</span>} {t(p)}
                  </li>
                ))}
              </ol>
            )}
            {questions && (
              <div className="studio-questions">
                {questions.map((x, i) => (
                  <label key={i}>
                    <span>{x.q}</span>
                    <input className="ab-input" value={x.a} onChange={(e) => setQuestions((cur) => cur!.map((y, j) => (j === i ? { ...y, a: e.target.value } : y)))} />
                  </label>
                ))}
                <div className="studio-brain-actions">
                  <button className="orbi-btn orbi-btn-primary" disabled={busy} onClick={() => build()}>
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} {t('Build it')}
                  </button>
                  <button className="orbi-btn" onClick={() => setQuestions(null)}>
                    {t('Skip')}
                  </button>
                </div>
              </div>
            )}
            {err && <p className="provider-status provider-status-error">{err}</p>}
          </div>

          {!hasDraft && <p className="studio-empty">{t('Pick an item on the left, start a new one, or describe it above.')}</p>}

          {kind === 'skill' && skillDraft && (
            <SkillEditor
              key={skillDraft.nonce}
              initial={skillDraft.doc}
              id={skillDraft.id}
              busy={busy}
              onImprove={(doc, feedback) => build('skill', `${brief || doc.description}\n\n${feedback}`, [], doc)}
              onSaved={(id) => {
                props.onRefresh()
                setSelected(id)
                setSkillDraft((d) => (d ? { ...d, id } : d))
              }}
              onDeleted={() => {
                props.onRefresh()
                resetDraft()
              }}
            />
          )}

          {kind === 'agent' && (
            <div className="studio-card studio-agent">
              <AgentsPanel
                agents={props.agents}
                models={props.models}
                skills={props.skills}
                servers={props.servers}
                onRefresh={props.onRefresh}
                onChatWithAgent={props.onChatWith}
                preset={agentPreset}
                selectId={selected}
              />
            </div>
          )}

          {kind === 'team' && teamDraft && (
            <TeamEditor
              key={teamDraft.id || 'new-' + (teamDraft.name || '')}
              initial={teamDraft}
              agents={props.agents}
              onSaved={(id) => {
                reloadExtras()
                setSelected(id)
              }}
              onDeleted={() => {
                reloadExtras()
                resetDraft()
              }}
              onChat={props.onChatWith}
            />
          )}

          {kind === 'harness' && harnessDraft && (
            <HarnessEditor
              key={harnessDraft.id || 'new-' + (harnessDraft.name || '')}
              initial={harnessDraft}
              agents={props.agents}
              skills={props.skills}
              servers={props.servers}
              active={!!harnessDraft.id && props.activeHarness === harnessDraft.id}
              setActive={(id) => props.setActiveHarness(id)}
              onSaved={(id) => {
                reloadExtras()
                setSelected(id)
              }}
              onDeleted={() => {
                reloadExtras()
                resetDraft()
              }}
            />
          )}
        </section>
      </div>
    </main>
  )
}

// ---------- Skill editor: SKILL.md, support files, tests and the 12-point audit ----------
function SkillEditor({ initial, id, busy, onImprove, onSaved, onDeleted }: { initial: SkillDoc; id?: string; busy: boolean; onImprove: (doc: SkillDoc, feedback: string) => void; onSaved: (id: string) => void; onDeleted: () => void }) {
  const [doc, setDoc] = useState<SkillDoc>(initial)
  const [check, setCheck] = useState<SkillCheck | null>(null)
  const [tab, setTab] = useState<'body' | 'files' | 'tests' | 'audit'>('body')
  const [feedback, setFeedback] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  const [fileIdx, setFileIdx] = useState(0)
  const set = <K extends keyof SkillDoc>(k: K, v: SkillDoc[K]) => setDoc((d) => ({ ...d, [k]: v }))
  useEffect(() => {
    const id = setTimeout(() => api.studioCheck(doc).then(setCheck).catch(() => {}), 400)
    return () => clearTimeout(id)
  }, [doc])
  const tests = doc.tests || {}
  const setTests = (patch: Partial<NonNullable<SkillDoc['tests']>>) => set('tests', { ...tests, ...patch })
  const save = async () => {
    const newId = await api.saveSkill({ id, name: doc.name, description: doc.description, instructions: doc.body, files: doc.files, tests: doc.tests, meta: { license: doc.license, version: doc.version, compatibility: doc.compatibility, author: doc.author, audit: doc.audit } })
    setSaved(t('Saved'))
    setTimeout(() => setSaved(null), 1500)
    onSaved(newId || id || '')
  }
  const file = doc.files[fileIdx]
  // Older Orbi skills have display names ("Deep Research"); they still save, but export needs a spec-valid name.
  const blocking = (check?.validation.issues || []).filter((i) => !/^Name must be kebab/.test(i))
  return (
    <div className="studio-card">
      <div className="studio-row">
        <label className="flex-1">
          <span className="ab-label">{t('Name')}</span>
          <input className="ab-input" value={doc.name} onChange={(e) => set('name', e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/--+/g, '-'))} placeholder="kebab-case-name" />
        </label>
        <label>
          <span className="ab-label">{t('Version')}</span>
          <input className="ab-input w-24" value={doc.version || ''} onChange={(e) => set('version', e.target.value)} />
        </label>
        <label>
          <span className="ab-label">{t('License')}</span>
          <input className="ab-input w-28" value={doc.license || ''} onChange={(e) => set('license', e.target.value)} />
        </label>
      </div>
      <label>
        <span className="ab-label">
          {t('Description — what it does and when to use it')} <small className="num">{doc.description.length}/1024</small>
        </span>
        <textarea className="ab-input" rows={3} value={doc.description} onChange={(e) => set('description', e.target.value)} />
      </label>

      <div className="hub-tabs">
        {(
          [
            ['body', 'SKILL.md'],
            ['files', `${t('Support files')} (${doc.files.length})`],
            ['tests', `${t('Tests')} (${(tests.positive || []).length + (tests.negative || []).length + (tests.cases || []).length})`],
            ['audit', check ? `${t('Audit')} ${check.audit.average.toFixed(1)}/5` : t('Audit')],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'body' && <textarea className="ab-input studio-code" rows={18} value={doc.body} onChange={(e) => set('body', e.target.value)} placeholder="# Title\n\n## Objective\n…" />}

      {tab === 'files' && (
        <div className="studio-files">
          <ul>
            {doc.files.map((f, i) => (
              <li key={i} className={i === fileIdx ? 'active' : ''}>
                <button onClick={() => setFileIdx(i)}>
                  <FileCode2 size={12} /> {f.path}
                </button>
                <button className="icon-button" onClick={() => set('files', doc.files.filter((_, j) => j !== i))} aria-label={t('Delete')}>
                  <X size={12} />
                </button>
              </li>
            ))}
            <li>
              <button
                onClick={() => {
                  set('files', [...doc.files, { path: 'references/notes.md', content: '' }])
                  setFileIdx(doc.files.length)
                }}
              >
                <Plus size={12} /> {t('Add file')}
              </button>
            </li>
          </ul>
          {file ? (
            <div className="flex-1 min-w-0">
              <input className="ab-input" value={file.path} onChange={(e) => set('files', doc.files.map((f, j) => (j === fileIdx ? { ...f, path: e.target.value } : f)))} />
              <textarea className="ab-input studio-code mt-2" rows={14} value={file.content} onChange={(e) => set('files', doc.files.map((f, j) => (j === fileIdx ? { ...f, content: e.target.value } : f)))} />
            </div>
          ) : (
            <p className="hub-note">{t('Long references go in references/, deterministic steps in scripts/, templates in assets/. The skill loads them only when needed.')}</p>
          )}
        </div>
      )}

      {tab === 'tests' && (
        <div className="studio-tests">
          <ListEditor title={t('Should trigger (5+)')} items={tests.positive || []} onChange={(v) => setTests({ positive: v })} />
          <ListEditor
            title={t('Should NOT trigger (3+)')}
            items={(tests.negative || []).map((n) => (n.reason ? `${n.prompt} — ${n.reason}` : n.prompt))}
            onChange={(v) => setTests({ negative: v.map((x) => ({ prompt: x.split(' — ')[0], reason: x.split(' — ')[1] || '' })) })}
          />
          <p className="ab-label">{t('Test cases (3+)')}</p>
          {(tests.cases || []).map((c, i) => (
            <div key={i} className="studio-case">
              <strong>{c.id || `TC-${i + 1}`}</strong> {c.input}
              <ul>
                {(c.criteria || []).map((k, j) => (
                  <li key={j}>{k}</li>
                ))}
              </ul>
            </div>
          ))}
          {!(tests.cases || []).length && <p className="hub-note">{t('Create with AI to get test cases, or add them in the exported tests.yaml.')}</p>}
        </div>
      )}

      {tab === 'audit' && check && (
        <div className="studio-audit">
          <p className={`studio-verdict ${check.audit.passed ? 'ok' : ''}`}>
            {check.audit.passed ? <Check size={14} /> : <CircleAlert size={14} />}
            {check.audit.passed ? t('Award-ready: average {n} and no criterion below 4.', { n: check.audit.average.toFixed(2) }) : t('Average {n} — target 4.5 with no criterion below 4.', { n: check.audit.average.toFixed(2) })}
          </p>
          {check.audit.rows.map((r) => (
            <div key={r.key} className="studio-audit-row">
              <span>{t(r.label)}</span>
              <span className="studio-score">
                {[1, 2, 3, 4, 5].map((i) => (
                  <i key={i} className={i <= r.score ? 'on' : ''} />
                ))}
              </span>
              <small>{r.evidence}</small>
            </div>
          ))}
          {check.audit.notes && <p className="hub-note">{check.audit.notes}</p>}
          <p className="hub-note">{t('Scores combine checks Orbi runs on the files with the model’s self-review. They are not measured test results.')}</p>
        </div>
      )}

      {check && (check.validation.issues.length > 0 || check.validation.warnings.length > 0) && (
        <ul className="studio-issues">
          {check.validation.issues.map((x) => (
            <li key={x} className="err">
              <CircleAlert size={12} /> {t(x)}
            </li>
          ))}
          {check.validation.warnings.map((x) => (
            <li key={x}>
              <CircleAlert size={12} /> {t(x)}
            </li>
          ))}
        </ul>
      )}

      <div className="studio-improve">
        <input className="ab-input" value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder={t('What should change? e.g. it triggers too often for invoices')} />
        <button className="orbi-btn" disabled={busy || !doc.body.trim()} onClick={() => onImprove(doc, feedback || 'Fix every weakness found in the audit and the validation warnings.')}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} {t('Improve with AI')}
        </button>
      </div>

      <div className="studio-footer">
        {id && (
          <button
            className="orbi-btn hub-danger"
            onClick={async () => {
              if (!confirm(t('Delete this skill?'))) return
              await api.deleteSkill(id)
              onDeleted()
            }}
          >
            <Trash2 size={13} />
          </button>
        )}
        <button className="orbi-btn" disabled={!doc.name} onClick={() => api.skillMd(doc).then((md) => navigator.clipboard.writeText(md))}>
          <Copy size={13} /> {t('Copy SKILL.md')}
        </button>
        <button className="orbi-btn" disabled={!doc.name || !check?.validation.ok} onClick={() => api.exportSkill(doc)} title={t('Portable ZIP for Claude, ChatGPT, Gemini and any Agent Skills host')}>
          <Download size={13} /> {t('Export ZIP')}
        </button>
        <button className="orbi-btn orbi-btn-primary" disabled={!doc.name || !doc.body.trim() || blocking.length > 0} onClick={save}>
          <Check size={13} /> {saved || (id ? t('Save') : t('Save and turn on'))}
        </button>
      </div>
    </div>
  )
}

function ListEditor({ title, items, onChange }: { title: string; items: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="studio-listedit">
      <p className="ab-label">{title}</p>
      {items.map((x, i) => (
        <div key={i} className="ab-starter">
          <input className="ab-input" value={x} onChange={(e) => onChange(items.map((y, j) => (j === i ? e.target.value : y)))} />
          <button onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={t('Delete')}>
            <X size={13} />
          </button>
        </div>
      ))}
      <button className="link-btn text-[12px]" onClick={() => onChange([...items, ''])}>
        <Plus size={12} className="inline" /> {t('Add')}
      </button>
    </div>
  )
}

// ---------- Multi-agent team ----------
type TeamDraft = { id?: string; name: string; handle: string; description: string; mode: Team['mode']; members: TeamMember[]; synthesizer: string }
function TeamEditor({ initial, agents, onSaved, onDeleted, onChat }: { initial: TeamDraft; agents: Agent[]; onSaved: (id: string) => void; onDeleted: () => void; onChat: (h: string) => void }) {
  const [d, setD] = useState(initial)
  const [saved, setSaved] = useState<string | null>(null)
  const set = <K extends keyof TeamDraft>(k: K, v: TeamDraft[K]) => setD((x) => ({ ...x, [k]: v }))
  const setMember = (i: number, patch: Partial<TeamMember>) => set('members', d.members.map((m, j) => (j === i ? { ...m, ...patch } : m)))
  const handle = '@' + (d.handle || d.name).toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '')
  const save = async () => {
    const id = await api.saveTeam({ ...d, handle })
    setD((x) => ({ ...x, id }))
    setSaved(t('Saved'))
    setTimeout(() => setSaved(null), 1500)
    onSaved(id)
  }
  return (
    <div className="studio-card">
      <div className="studio-row">
        <label className="flex-1">
          <span className="ab-label">{t('Team name')}</span>
          <input className="ab-input" value={d.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label>
          <span className="ab-label">{t('Handle')}</span>
          <input className="ab-input w-48" value={d.handle} onChange={(e) => set('handle', e.target.value)} placeholder={handle} />
        </label>
      </div>
      <input className="ab-input" value={d.description} onChange={(e) => set('description', e.target.value)} placeholder={t('What this team does')} />
      <p className="ab-label mt-3">{t('How they work together')}</p>
      <div className="studio-modes">
        {MODES.map((m) => (
          <button key={m.id} className={d.mode === m.id ? 'active' : ''} onClick={() => set('mode', m.id)}>
            <strong>{t(m.label)}</strong>
            <small>{t(m.hint)}</small>
          </button>
        ))}
      </div>
      <p className="ab-label mt-3">{t('Members')}</p>
      {d.members.map((m, i) => (
        <div key={i} className="studio-member">
          <div className="studio-row">
            <select
              className="ab-input w-48"
              value={m.agent || ''}
              onChange={(e) => {
                const a = agents.find((x) => x.handle === e.target.value)
                setMember(i, a ? { agent: a.handle, name: a.name || a.handle, instructions: a.instructions, role: a.description } : { agent: '' })
              }}
            >
              <option value="">{t('Custom member')}</option>
              {agents.map((a) => (
                <option key={a.id} value={a.handle}>
                  {a.handle}
                </option>
              ))}
            </select>
            <input className="ab-input flex-1" value={m.name} onChange={(e) => setMember(i, { name: e.target.value })} placeholder={t('Role name')} />
            <button className="icon-button" onClick={() => set('members', d.members.filter((_, j) => j !== i))} aria-label={t('Delete')}>
              <X size={13} />
            </button>
          </div>
          <textarea className="ab-input mt-2" rows={3} value={m.instructions} onChange={(e) => setMember(i, { instructions: e.target.value })} placeholder={t('Instructions for this member')} />
        </div>
      ))}
      <button className="link-btn text-[12px]" onClick={() => set('members', [...d.members, { name: '', instructions: '' }])}>
        <Plus size={12} className="inline" /> {t('Add member')}
      </button>
      <p className="ab-label mt-3">{t('Synthesizer — how the final answer is assembled')}</p>
      <textarea className="ab-input" rows={3} value={d.synthesizer} onChange={(e) => set('synthesizer', e.target.value)} />
      <p className="hub-note">{t('Use it in any chat by typing {h}. Each member runs with the chat model, then the synthesizer writes the final answer.', { h: handle })}</p>
      <div className="studio-footer">
        {d.id && (
          <button
            className="orbi-btn hub-danger"
            onClick={async () => {
              if (!confirm(t('Delete this team?'))) return
              await api.deleteTeam(d.id!)
              onDeleted()
            }}
          >
            <Trash2 size={13} />
          </button>
        )}
        {d.id && (
          <button className="orbi-btn" onClick={() => onChat(handle)}>
            <MessageSquarePlus size={13} /> {t('Chat with team')}
          </button>
        )}
        <button className="orbi-btn orbi-btn-primary" disabled={!d.name.trim() || d.members.length < 2} onClick={save}>
          <Check size={13} /> {saved || t('Save')}
        </button>
      </div>
    </div>
  )
}

// ---------- Harness ----------
type HarnessDraft = { id?: string; name: string; description: string; config: HarnessConfig }
function HarnessEditor({
  initial,
  agents,
  skills,
  servers,
  active,
  setActive,
  onSaved,
  onDeleted,
}: {
  initial: HarnessDraft
  agents: Agent[]
  skills: Skill[]
  servers: McpServer[]
  active: boolean
  setActive: (id: string | null) => void
  onSaved: (id: string) => void
  onDeleted: () => void
}) {
  const [d, setD] = useState(initial)
  const [saved, setSaved] = useState<string | null>(null)
  const c = d.config
  const p = c.policies || {}
  const setC = (patch: Partial<HarnessConfig>) => setD((x) => ({ ...x, config: { ...x.config, ...patch } }))
  const setP = (patch: Partial<NonNullable<HarnessConfig['policies']>>) => setC({ policies: { ...p, ...patch } })
  const toggle = (key: 'agents' | 'skills' | 'servers', v: string) => {
    const cur = c[key] || []
    setC({ [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] })
  }
  const save = async () => {
    const id = await api.saveHarness({ id: d.id, name: d.name, description: d.description, config: d.config })
    setD((x) => ({ ...x, id }))
    setSaved(t('Saved'))
    setTimeout(() => setSaved(null), 1500)
    onSaved(id)
    return id
  }
  return (
    <div className="studio-card">
      <div className="studio-row">
        <label className="flex-1">
          <span className="ab-label">{t('Harness name')}</span>
          <input className="ab-input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
        </label>
      </div>
      <input className="ab-input" value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder={t('What this harness is for')} />
      <div className="studio-grid">
        <Picker title={t('Tools the model may use')} hint={t('Anything not checked is hidden from the model, so it cannot be called.')} items={servers.map((s) => ({ id: s.id, label: s.name, sub: `${s.tools.length} tools` }))} on={c.servers || []} toggle={(v) => toggle('servers', v)} />
        <Picker title={t('Skills switched on')} hint={t('Only names and descriptions stay in context until a skill is needed.')} items={skills.map((s) => ({ id: s.name, label: s.name, sub: s.description }))} on={c.skills || []} toggle={(v) => toggle('skills', v)} />
        <Picker title={t('Agents')} hint={t('Active in the chat while this harness is on.')} items={agents.map((a) => ({ id: a.handle, label: a.handle, sub: a.description || '' }))} on={c.agents || []} toggle={(v) => toggle('agents', v)} />
      </div>
      <div className="studio-row mt-3">
        <label>
          <span className="ab-label">{t('Context budget')}</span>
          <select className="ab-input" value={p.context_budget || 32000} onChange={(e) => setP({ context_budget: Number(e.target.value) })}>
            {[8000, 16000, 32000, 64000, 128000, 200000].map((n) => (
              <option key={n} value={n}>
                {Math.round(n / 1000)}k tokens
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="ab-label">{t('Cut long tool outputs')}</span>
          <select className="ab-input" value={p.compact_tool_output || 0} onChange={(e) => setP({ compact_tool_output: Number(e.target.value) })}>
            <option value={0}>{t('Off')}</option>
            {[500, 2000, 5000, 10000].map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()} {t('characters')}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="ab-label">{t('Web search')}</span>
          <select className="ab-input" value={p.web || 'auto'} onChange={(e) => setP({ web: e.target.value as 'auto' })}>
            <option value="auto">{t('As set in the chat')}</option>
            <option value="on">{t('Always on')}</option>
            <option value="off">{t('Off')}</option>
          </select>
        </label>
        <label className="ab-check self-end">
          <input type="checkbox" checked={p.memory !== false} onChange={(e) => setP({ memory: e.target.checked })} />
          <span>{t('Use memories')}</span>
        </label>
      </div>
      <p className="ab-label mt-3">{t('Operating rules for every answer')}</p>
      <textarea className="ab-input" rows={3} value={p.rules || ''} onChange={(e) => setP({ rules: e.target.value })} />
      <p className="hub-note">{t('Tool limits are enforced by Orbi (hidden tools cannot be called); rules are instructions to the model.')}</p>
      <div className="studio-footer">
        {d.id && (
          <button
            className="orbi-btn hub-danger"
            onClick={async () => {
              if (!confirm(t('Delete this harness?'))) return
              await api.deleteHarness(d.id!)
              onDeleted()
            }}
          >
            <Trash2 size={13} />
          </button>
        )}
        <button className="orbi-btn orbi-btn-primary" disabled={!d.name.trim()} onClick={save}>
          <Check size={13} /> {saved || t('Save')}
        </button>
        <button
          className={`orbi-btn ${active ? 'orbi-btn-primary' : ''}`}
          disabled={!d.name.trim()}
          onClick={async () => {
            if (active) return setActive(null)
            const id = await save()
            setActive(id)
          }}
        >
          <Power size={13} /> {active ? t('Turn off') : t('Turn on in chat')}
        </button>
      </div>
    </div>
  )
}

function Picker({ title, hint, items, on, toggle }: { title: string; hint: string; items: { id: string; label: string; sub: string }[]; on: string[]; toggle: (id: string) => void }) {
  return (
    <div className="studio-picker">
      <p className="ab-label">{title}</p>
      <small>{hint}</small>
      <div className="ab-picker">
        {items.map((x) => (
          <label key={x.id} className="ab-check">
            <input type="checkbox" checked={on.includes(x.id)} onChange={() => toggle(x.id)} />
            <span>
              <strong>{x.label}</strong>
              <small>{x.sub}</small>
            </span>
          </label>
        ))}
        {!items.length && <p className="ab-hint">—</p>}
      </div>
    </div>
  )
}
