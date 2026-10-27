// Builds electron/library-github.json from the skill repositories listed in build/skill-sources.json.
// Usage: node build/sync-skills.cjs <folder with the repos cloned as owner_name>
//
// Each skill gets a 1–5 star score from signals anyone can check in its repository:
//   ★ purpose   — a description that says what it does and when to use it
//   ★ method    — a structured playbook (3+ sections, or 1,500+ characters)
//   ★ knowledge — 3+ reference files in the skill folder beyond the main instructions
//   ★ checks    — scripts or tests that validate the output
//   ★ open      — published with an open-source license that allows bundling it
// Only skills with such a license are bundled; the rest are listed as links to GitHub.
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const root = path.resolve(process.argv[2] || '.')
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'skill-sources.json'), 'utf8'))
const OPEN = ['MIT', 'Apache-2.0', 'BSD', 'GPL-3.0', 'CC BY']
const ACRONYMS = { seo: 'SEO', ai: 'AI', cro: 'CRO', ux: 'UX', ui: 'UI', mcp: 'MCP', d3: 'D3', x: 'X', ab: 'A/B', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', ffmpeg: 'FFmpeg', moviepy: 'MoviePy', sw: '', github: 'GitHub', slo: 'SLO', devops: 'DevOps', typescript: 'TypeScript', sql: 'SQL', ml: 'ML', k8s: 'Kubernetes' }

const NAMES = { 'emil-design-eng': 'Design Engineering', hyperframes: 'HyperFrames', 'short-form-video-script': 'Short-Form Video Script', pixel2motion: 'Pixel2Motion', 'lemo-opuscar': 'Lemo Opuscar (code films)', 'sw-truby-anatomy': 'Truby Story Anatomy', 'sw-premise-theme': 'Premise & Theme', 'sw-character-conflict': 'Character & Conflict', 'sw-format-adaptation': 'Format & Adaptation', 'sw-series-engine-bible': 'Series Engine & Bible', 'sw-writers-room': 'Writers’ Room', 'ui-ux-designer': 'UI/UX Designer', 'on-call-handoff-patterns': 'On-Call Handoff', '': '' }
const SMALL = new Set(['and', 'to', 'of', 'the', 'for', 'in', 'on', 'with'])
const repoDir = (repo) => path.join(root, repo.replace('/', '_'))

function licenseOf(text) {
  if (!text) return ''
  if (/^https?:\/\//.test(text.trim())) return ''
  if (/Apache/i.test(text)) return 'Apache-2.0'
  if (/\bMIT\b|Permission is hereby granted, free of charge/i.test(text)) return 'MIT'
  if (/GNU AFFERO|AGPL/i.test(text)) return 'AGPL-3.0'
  if (/BSD/i.test(text)) return 'BSD'
  if (/GNU GENERAL PUBLIC LICENSE|\bGPL/i.test(text)) return 'GPL-3.0'
  if (/PolyForm/i.test(text)) return 'PolyForm-NC'
  if (/Proprietary/i.test(text)) return 'Proprietary'
  if (/Creative Commons|CC BY/i.test(text)) return 'CC BY'
  return 'Custom'
}
function findLicense(dir, stop) {
  // Closest LICENSE file or plugin manifest walking up from the skill folder to the repository root.
  for (let d = dir; ; d = path.dirname(d)) {
    const f = fs.existsSync(d) ? fs.readdirSync(d).find((x) => /^LICEN[CS]E/i.test(x)) : null
    if (f) return licenseOf(fs.readFileSync(path.join(d, f), 'utf8').slice(0, 2000))
    for (const m of ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json', 'package.json']) {
      const p = path.join(d, m)
      if (fs.existsSync(p)) {
        const lic = (JSON.parse(fs.readFileSync(p, 'utf8')).license || '').toString()
        if (lic) return licenseOf(lic)
      }
    }
    if (d === stop || d === path.dirname(d)) return ''
  }
}
function front(s) {
  const m = s.match(/^\s*(?:[^\n]*\n\s*)?---\n([\s\S]*?)\n---\n/)
  const meta = {}
  if (m) {
    const y = m[1]
    const get = (k) => {
      const r = y.match(new RegExp(`^${k}:\\s*(>-?|\\|-?)?\\s*\\n?([\\s\\S]*?)(?=^\\S[^\\n]*:|$(?![\\s\\S]))`, 'm'))
      return r ? r[2].replace(/\s+/g, ' ').trim().replace(/^["']|["']$/g, '') : ''
    }
    meta.name = get('name')
    meta.description = get('description')
    meta.license = get('license')
  }
  return { meta, body: m ? s.slice(s.indexOf(m[0]) + m[0].length) : s }
}
function humanize(slug) {
  if (NAMES[slug]) return NAMES[slug]
  return slug
    .split(/[-_]/)
    .filter((w) => ACRONYMS[w] !== '')
    .map((w, i) => ACRONYMS[w] || (i && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ')
    .replace(/^A\/B Testing$/, 'A/B Testing')
}
function shortDesc(d) {
  let s = d.replace(/\s*\([^)]*[　-鿿][^)]*\)/g, '').replace(/\s+/g, ' ').trim()
  s = s.replace(/^(This skill should be used when the user asks to|Use (this skill )?(when|to)|When the user wants to)\s*/i, '')
  s = (s.match(/^.*?[.!?](\s|$)/) || [s])[0].trim()
  s = s.replace(/ (Also use|Use when|Run when).*$/, '').replace(/[,;:]$/, '')
  if (s.length > 150) s = s.slice(0, 147).replace(/\s+\S*$/, '') + '…'
  return s[0].toUpperCase() + s.slice(1).replace(/([^.!?…])$/, '$1.')
}
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules'].includes(e.name)) continue
    const p = path.join(dir, e.name)
    e.isDirectory() ? walk(p, out) : out.push(p)
  }
  return out
}
function designerx(s) {
  // Orbi has no DesignerX launcher: keep principles, how-to-design and modes; drop CLI setup and command plumbing.
  return front(s).body.split(/\n(?=## )/).filter((sec) => !/^## (Setup|Commands)\b/.test(sec)).join('\n').replace(/\{\{[a-z_]+\}\}/g, '').replace(/<!--[^>]*-->/g, '')
}

const skills = []
const seen = new Set()
for (const src of cfg.skills) {
  const rd = repoDir(src.repo)
  if (src.path && !src.main && !fs.existsSync(path.join(rd, src.path, 'SKILL.md'))) {
    const hit = walk(rd).find((f) => f.endsWith(path.join(src.path, 'SKILL.md')))
    if (hit) src.path = path.relative(rd, path.dirname(hit))
  }
  const base = path.join(rd, src.path || '')
  const mainPath = path.join(rd, src.main || path.join(src.path || '', 'SKILL.md'))
  if (!fs.existsSync(mainPath)) {
    console.warn('missing', src.repo, src.path)
    continue
  }
  const raw = fs.readFileSync(mainPath, 'utf8')
  const { meta, body } = front(raw)
  let instructions = (src.extract === 'textblock' ? (raw.match(/```text\n([\s\S]*?)```/) || [, body])[1] : src.extract === 'designerx' ? designerx(raw) : body).trim()
  const slug = path.basename(src.path || src.repo.split('/')[1])
  const id = src.id || `${src.profession}:${src.repo.split('/')[0].toLowerCase()}-${slug.toLowerCase()}`.replace(/[^a-z0-9:-]+/g, '-')
  if (seen.has(id)) continue
  seen.add(id)
  const files = walk(base).map((f) => path.relative(base, f))
  const mainRel = path.relative(base, mainPath)
  const refs = files.filter((f) => /\.(md|ya?ml|json|txt)$/i.test(f) && f !== mainRel && !/^(README|CHANGELOG|LICENSE|NOTICE|CREDITS|package(-lock)?|tsconfig)\b/i.test(path.basename(f)) && !f.startsWith('.'))
  const checks = files.filter((f) => /(^|\/)(scripts|tests?|evals?)\//.test(f) && /\.(py|js|mjs|cjs|ts|sh)$/.test(f))
  const license = (meta.license && !/LICENSE\.txt|complete terms/i.test(meta.license) && licenseOf(meta.license) !== 'Custom' ? licenseOf(meta.license) : '') || findLicense(base, rd)
  const sections = (instructions.match(/^#{2,3} /gm) || []).length
  const signals = {
    purpose: !!(src.description || meta.description),
    method: sections >= 3 || instructions.length >= 1500,
    knowledge: refs.length >= 3,
    checks: checks.length > 0,
    open: OPEN.includes(license),
  }
  if (!signals.open && src.kind !== 'own') {
    console.warn('skipped (license ' + (license || 'none') + '):', src.repo, src.path)
    continue
  }
  const rating = Object.values(signals).filter(Boolean).length
  let commit = ''
  try {
    commit = execSync('git log -1 --format=%h·%cs', { cwd: rd }).toString().trim()
  } catch {}
  const url = `https://github.com/${src.repo}${src.path ? `/tree/main/${src.path}` : ''}`
  const name = src.name || humanize(slug)
  instructions = `[${name} — by ${src.author}. Source: ${url} (${license}). Files this skill mentions live in that repository.]\n\n${instructions}`
  skills.push({
    id,
    profession: src.profession,
    name,
    description: src.description || shortDesc(meta.description || name),
    instructions,
    author: src.author,
    kind: src.kind || 'community',
    source: url,
    license,
    rating,
    signals: { ...signals, references: refs.length, checkFiles: checks.length, commit },
  })
}


// Agents (persona prompts) from GitHub, scored with the same signals. The plugin folder around
// the agent counts for knowledge (skills/references) and checks (scripts/tests).
const agents = []
for (const src of cfg.agents || []) {
  const rd = repoDir(src.repo)
  const hit = walk(path.join(rd, 'plugins')).filter((f) => f.endsWith(`/agents/${src.name}.md`)).sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0]
  if (!hit) {
    console.warn('missing agent', src.name)
    continue
  }
  const raw = fs.readFileSync(hit, 'utf8')
  const { meta, body } = front(raw)
  const plugin = path.dirname(path.dirname(hit))
  const pfiles = walk(plugin).map((f) => path.relative(plugin, f))
  const refs = pfiles.filter((f) => /^skills\//.test(f) && /\.(md|ya?ml|json)$/i.test(f))
  const checks = pfiles.filter((f) => /(^|\/)(scripts|tests?|evals?)\//.test(f) && /\.(py|js|mjs|cjs|ts|sh)$/.test(f))
  const license = findLicense(plugin, rd)
  const sections = (body.match(/^#{2,3} /gm) || []).length
  const signals = { purpose: !!meta.description, method: sections >= 3 || body.length >= 1500, knowledge: refs.length >= 3, checks: checks.length > 0, open: OPEN.includes(license) }
  if (!signals.open) continue
  const rel = path.relative(rd, hit)
  const url = `https://github.com/${src.repo}/blob/main/${rel}`
  const name = humanize(src.name).replace(/ Pro$/, ' Expert')
  agents.push({
    id: `${src.profession}:gh-${src.name}`,
    profession: src.profession,
    handle: '@' + src.name.replace(/-/g, '_'),
    name,
    description: shortDesc(meta.description || name),
    instructions: `[${name} — by ${src.author}. Source: ${url} (${license}).]\n\n${body.trim()}`,
    starters: [],
    author: src.author,
    kind: 'community',
    source: url,
    license,
    rating: Object.values(signals).filter(Boolean).length,
    signals: { ...signals, references: refs.length, checkFiles: checks.length },
  })
}

const links = cfg.links.map((l) => {
  const rd = repoDir(l.repo)
  return { ...l, id: `link:${l.repo.toLowerCase()}`, source: `https://github.com/${l.repo}`, license: findLicense(rd, rd) || 'None', kind: 'link' }
})
const directories = cfg.directories.map((d) => ({ ...d, source: `https://github.com/${d.repo}` }))

fs.writeFileSync(path.join(__dirname, '..', 'electron', 'library-github.json'), JSON.stringify({ skills, agents, links, directories }, null, 1) + '\n')
const by = {}
for (const s of skills) (by[s.profession] ||= []).push(s)
for (const [p, list] of Object.entries(by)) console.log(p.padEnd(12), list.length, list.map((s) => `${s.rating}★ ${s.name}`).join(' · '))
console.log('agents:', agents.map((a) => `${a.rating}★ ${a.name}`).join(' · '))
console.log('links:', links.map((l) => `${l.name} (${l.license})`).join(', '))

// License notices for every bundled repository (MIT/Apache/BSD require keeping them).
const notice = ['# Third-party skills bundled in Orbi', '', 'Each skill keeps its author, source link and license in the library. License texts follow.', '']
for (const repo of [...new Set([...cfg.skills, ...(cfg.agents || [])].map((s) => s.repo))]) {
  if (![...skills, ...agents].some((s) => s.source.startsWith(`https://github.com/${repo}`))) continue
  const rd = repoDir(repo)
  const files = walk(rd).filter((f) => /(^|\/)(LICEN[CS]E|NOTICE)[^/]*$/i.test(f) && path.relative(rd, f).split('/').length <= 4).slice(0, 6)
  notice.push(`## ${repo}`, '', `https://github.com/${repo}`, '')
  for (const f of files) notice.push('```', fs.readFileSync(f, 'utf8').trim().slice(0, 12000), '```', '')
}
fs.writeFileSync(path.join(__dirname, '..', 'electron', 'THIRD_PARTY_SKILLS.md'), notice.join('\n') + '\n')
