// Creator Studio brain (SKILLSMITH method): turns a brief into Agent Skills, agents, multi-agent teams
// and harnesses; validates them against the open Agent Skills spec; audits them with the 12-point
// rubric; imports and exports portable ZIP packages.
// Method by Daniel Rodrigues — https://github.com/iwerry/SKILLSMITH (MIT)
const { zipSync, unzipSync, strToU8, strFromU8 } = require('fflate')

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const BRANDS = /claude|anthropic|openai|chatgpt|gpt|gemini|google|copilot/i
const SECRET = /(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"]?[A-Za-z0-9_./+\-]{12,}/i
const RUBRIC = [
  ['triggering', 'Description says what it does and when to use it, with real and implicit triggers and negative boundaries'],
  ['focus', 'Solves exactly one well-bounded competence'],
  ['concision', 'Every line adds something the model would not know on its own'],
  ['progressive', 'Long details live in references/ or scripts/ with instructions on when to read them'],
  ['executability', 'An agent can follow it end to end without guessing'],
  ['reliability', 'Fragile steps have scripts, templates or verification loops'],
  ['examples', '2–3 short, realistic input → output examples'],
  ['robustness', 'Says how to handle missing, ambiguous or malformed input'],
  ['portability', 'Generic tool names and manual fallbacks when code cannot run'],
  ['security', 'No secrets; confirmation before destructive or external actions'],
  ['maintainability', 'Version, author and consistent terminology, no relative dates'],
  ['testability', 'Positive and negative trigger prompts plus verifiable test cases'],
]

// ---------- prompts ----------
const CORE = `You are SKILLSMITH, the skill engineering brain inside Orbi (method by Daniel Rodrigues).
You build portable, production-grade agent capabilities following the open Agent Skills specification (agentskills.io):
- A skill is a folder: SKILL.md (YAML frontmatter + Markdown procedure) plus optional references/, scripts/ and assets/.
- Progressive disclosure: level 1 = name + description (always in context, a few dozen tokens); level 2 = SKILL.md body (loaded when triggered, under 500 lines / ~5,000 tokens); level 3 = support files read or run only when the body says so, using one-level relative paths like references/style.md.
- name: kebab-case, lowercase ASCII letters, digits and single hyphens, max 64 characters, no AI brand names.
- description: max 1024 characters, no < or >, assertive, third person. It must say WHAT it does (concrete action verb) and WHEN to use it (real triggers and synonyms in the user's languages, implicit triggers such as "even if the user does not say X") and when NOT to use it (negative boundaries pointing to the right alternative).
- Body: objective, required inputs, numbered procedure, rules with the reason behind each rule, calibrated degrees of freedom (high for creative work, medium = templates, low = scripts for calculations and parsing), verification loops (generate → check → fix → re-check), handling of missing/ambiguous input, output contract, 2–3 short examples, and a manual fallback for every script.
- Write the skill itself in English (portable, best for every model) unless the user explicitly asks for another language; the user-facing answer language follows the user.
- Never include secrets. Require confirmation for destructive or external actions. Do not invent test results.
Reply ONLY with one JSON object, no prose and no code fences.`

const SHAPES = {
  skill: `{"name":"kebab-case","description":"...","license":"MIT","version":"1.0.0","compatibility":"optional runtime requirements or empty","body":"# Title\\n\\n## Objective ...full Markdown body...","files":[{"path":"references/....md","content":"..."},{"path":"scripts/....py","content":"..."}],"tests":{"positive":["5+ prompts that must trigger"],"negative":[{"prompt":"near miss","reason":"why not / which alternative"}],"cases":[{"id":"TC-01","input":"...","criteria":["observable success criterion"]}]},"audit":{"triggering":5,"focus":5,"concision":5,"progressive":5,"executability":5,"reliability":5,"examples":5,"robustness":5,"portability":5,"security":5,"maintainability":5,"testability":5,"notes":"honest weaknesses"}}`,
  agent: `{"handle":"snake_case","name":"Display Name","description":"one line","category":"General|Development|Creative|Research|Marketing|Data|Support","instructions":"## Role\\n...\\n## How you work\\n- ...\\n## Deliver\\n- ...\\n## Avoid\\n- ...","starters":["3 example prompts"],"skills":["kebab-case names of existing skills that help, if any"],"tools":["server ids that help: orbi-core, orbi-files, orbi-terminal, deepwiki, context7"]}`,
  team: `{"handle":"snake_case","name":"Team name","description":"one line","mode":"sequential|parallel|router|debate","members":[{"handle":"snake_case","name":"Role name","role":"one line","instructions":"## Role ... ## How you work ... ## Deliver ..."}],"synthesizer":"instructions for the final answer that merges the members' work"}`,
  harness: `{"name":"Harness name","description":"one line","agents":["handles of agents to include"],"skills":["skill names to switch on"],"servers":["MCP server ids allowed"],"policies":{"context_budget":32000,"compact_tool_output":2000,"approval":"always|risky|never","web":"auto|on|off","memory":true,"rules":"short operating rules for every answer"}}`,
}

const GUIDE = {
  skill: 'Build ONE complete Agent Skill. Put long reference material into files under references/ and deterministic steps into scripts/ (Python standard library preferred) with a manual fallback in the body. Include at least 5 positive trigger prompts, 3 negative near misses and 3 test cases. Score the audit honestly from 1 to 5.',
  agent: 'Build ONE agent persona with a structured system prompt (Role, How you work, Deliver, Avoid). Be specific to the domain; do not repeat generic assistant behavior.',
  team: 'Build a multi-agent team of 2–5 complementary specialists. Choose the mode: sequential (each member improves the previous output — pipelines), parallel (independent perspectives merged by the synthesizer), router (a lead picks the single best member for each request), debate (members critique each other, synthesizer decides).',
  harness: 'Build an agent harness: the runtime around the model — which agents, skills and MCP servers are allowed (only list what is needed: tools not listed are hidden from the model), context budget, compaction of long tool outputs, approval policy and operating rules.',
}

function questionsPrompt(kind, brief) {
  return {
    system: CORE.replace('Reply ONLY with one JSON object', 'Phase 1 — Discovery. Reply ONLY with one JSON object'),
    prompt: `The user wants a new ${kind}. Brief:\n"""${brief}"""\n\nAsk at most 5 short, essential questions whose answers would change the result (inputs, outputs, audience, constraints, failures to avoid, platforms). Skip anything the brief already answers. Write the questions in the same language as the brief.\nJSON shape: {"questions":["..."],"summary":"one line: what you understood"}`,
  }
}

function buildPrompt(kind, brief, answers, current) {
  const qa = (answers || []).filter((a) => a && a.a).map((a) => `Q: ${a.q}\nA: ${a.a}`).join('\n')
  return {
    system: CORE,
    prompt: `Phases 2–5 (design, build, tests, self-audit). ${GUIDE[kind]}\n\nBrief:\n"""${brief}"""\n${qa ? `\nDiscovery answers:\n${qa}\n` : ''}${current ? `\nImprove this existing version instead of starting over (keep what works, fix weaknesses):\n${JSON.stringify(current).slice(0, 24000)}\n` : ''}\nJSON shape:\n${SHAPES[kind]}`,
  }
}

// Models sometimes wrap JSON in fences or add text; take the first balanced object.
function parseJson(text) {
  const s = String(text).replace(/^```(?:json)?/gm, '').replace(/```$/gm, '')
  const start = s.indexOf('{')
  if (start < 0) throw new Error('The model did not return a result. Try again or pick a stronger model.')
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return JSON.parse(s.slice(start, i + 1))
  }
  throw new Error('The answer was cut off before the end. Try a model with a larger output or a shorter brief.')
}

// ---------- SKILL.md ----------
const yamlStr = (v) => (/[:#'"{}[\],&*!|>%@`]|^\s|\s$/.test(String(v)) ? JSON.stringify(String(v)) : String(v))
function toSkillMd(s, author = 'Orbi user') {
  const fm = ['---', `name: ${s.name}`, `description: ${yamlStr(s.description)}`, `license: ${s.license || 'MIT'}`]
  if (s.compatibility) fm.push(`compatibility: ${yamlStr(s.compatibility)}`)
  fm.push('metadata:', `  author: ${yamlStr(s.author || author)}`, `  version: "${s.version || '1.0.0'}"`, '---', '')
  return fm.join('\n') + String(s.body || '').trim() + '\n'
}
function fromSkillMd(text) {
  const m = String(text).match(/^﻿?---\s*\n([\s\S]*?)\n---\s*\n?/)
  if (!m) throw new Error('SKILL.md must start with YAML frontmatter between --- lines.')
  const meta = {}
  let parent = null
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\s*)([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!kv) continue
    let v = kv[3].trim()
    if (/^["']/.test(v)) {
      try {
        v = JSON.parse(v.replace(/^'(.*)'$/, '"$1"'))
      } catch {
        v = v.slice(1, -1)
      }
    }
    if (kv[1]) {
      if (parent) meta[parent] = { ...(typeof meta[parent] === 'object' ? meta[parent] : {}), [kv[2]]: v }
    } else {
      parent = v === '' ? kv[2] : null
      meta[kv[2]] = v
    }
  }
  return { meta, body: text.slice(m[0].length) }
}

// ---------- validation and audit ----------
function validate(s) {
  const issues = []
  const warn = []
  if (!NAME.test(s.name || '') || s.name.length > 64) issues.push('Name must be kebab-case: lowercase letters, digits and single hyphens, up to 64 characters.')
  if (BRANDS.test(s.name || '')) issues.push('Name must not contain AI brand names.')
  if (!s.description || s.description.length > 1024) issues.push('Description must have 1–1024 characters.')
  if (/[<>]/.test(s.description || '')) issues.push('Description must not contain < or >.')
  if (s.description && !/\b(use|when|whenever)\b/i.test(s.description)) warn.push('Description should say when to use the skill.')
  if (s.description && !/\b(do not|don't|not for|never)\b/i.test(s.description)) warn.push('Description has no negative boundary ("Do not use for …").')
  const lines = String(s.body || '').split('\n').length
  if (!String(s.body || '').trim()) issues.push('The body (procedure) is empty.')
  if (lines > 500) warn.push(`SKILL.md body has ${lines} lines; keep it under 500 and move details to references/.`)
  const all = [s.body, ...(s.files || []).map((f) => f.content)].join('\n')
  if (SECRET.test(all)) issues.push('Possible secret or key found; remove it.')
  for (const f of s.files || []) {
    if (!/^(references|scripts|assets)\/[^/]+$/.test(f.path)) warn.push(`${f.path}: support files should sit one level deep in references/, scripts/ or assets/.`)
    if (!String(s.body || '').includes(f.path)) warn.push(`${f.path} is never mentioned in SKILL.md, so the agent will not know when to read it.`)
  }
  for (const m of String(s.body || '').matchAll(/\b(references|scripts|assets)\/[\w.\-]+/g)) if (!(s.files || []).some((f) => f.path === m[0])) warn.push(`SKILL.md mentions ${m[0]}, which does not exist.`)
  return { ok: !issues.length, issues, warnings: [...new Set(warn)] }
}

// Deterministic checks for the rubric; the model's self-scores fill in what code cannot judge.
function audit(s) {
  const body = String(s.body || '')
  const t = s.tests || {}
  const v = validate(s)
  const model = s.audit || {}
  const rows = RUBRIC.map(([key, label]) => {
    let score = Number(model[key]) || 3
    let evidence = 'Model self-review'
    const cap = (n, why) => {
      if (score > n) {
        score = n
        evidence = why
      }
    }
    if (key === 'triggering') {
      if (!/\b(use|when)\b/i.test(s.description || '')) cap(2, 'Description does not say when to use it.')
      else if (!/\b(do not|not for|never)\b/i.test(s.description || '')) cap(3, 'No negative boundary in the description.')
    }
    if (key === 'progressive' && body.split('\n').length > 500) cap(2, 'Body over 500 lines.')
    if (key === 'examples' && !/example/i.test(body)) cap(2, 'No examples section in the body.')
    if (key === 'robustness' && !/(ambiguous|missing|incomplete|malformed|if .* not)/i.test(body)) cap(3, 'Does not say how to handle missing or ambiguous input.')
    if (key === 'reliability' && !/(verify|check|validate|re-?run)/i.test(body)) cap(3, 'No verification step.')
    if (key === 'portability' && (s.files || []).some((f) => f.path.startsWith('scripts/')) && !/(fallback|manual|if .*cannot run|without)/i.test(body)) cap(3, 'Scripts without a manual fallback.')
    if (key === 'security' && v.issues.some((i) => /secret/i.test(i))) cap(1, 'Possible secret found.')
    if (key === 'maintainability' && !s.version) cap(3, 'No version.')
    if (key === 'testability') {
      const pos = (t.positive || []).length
      const neg = (t.negative || []).length
      const cases = (t.cases || []).length
      if (pos < 5 || neg < 3 || cases < 3) cap(3, `Tests: ${pos} positive, ${neg} negative, ${cases} cases (target 5 / 3 / 3).`)
      else evidence = `${pos} positive, ${neg} negative, ${cases} cases.`
    }
    return { key, label, score: Math.max(1, Math.min(5, Math.round(score))), evidence }
  })
  const avg = rows.reduce((a, r) => a + r.score, 0) / rows.length
  return { rows, average: Math.round(avg * 100) / 100, passed: avg >= 4.5 && rows.every((r) => r.score >= 4), notes: model.notes || '' }
}

// ---------- ZIP ----------
function testsYaml(s) {
  const t = s.tests || {}
  const q = (x) => JSON.stringify(String(x))
  const lines = [`skill_name: ${s.name}`, 'positive_triggers:']
  for (const p of t.positive || []) lines.push(`  - prompt: ${q(p)}`, '    expected_action: "ACTIVATED"')
  lines.push('negative_triggers:')
  for (const n of t.negative || []) lines.push(`  - prompt: ${q(n.prompt || n)}`, '    expected_action: "NOT_ACTIVATED"', `    reason: ${q(n.reason || '')}`)
  lines.push('operational_cases:')
  for (const c of t.cases || []) {
    lines.push(`  - test_id: ${q(c.id || 'TC')}`, `    input: ${q(c.input || '')}`, '    verification_criteria:')
    for (const k of c.criteria || []) lines.push(`      - ${q(k)}`)
  }
  return lines.join('\n') + '\n'
}
function exportZip(s, author) {
  const root = s.name
  const files = { [`${root}/SKILL.md`]: strToU8(toSkillMd(s, author)) }
  for (const f of s.files || []) if (/^[\w./-]+$/.test(f.path) && !f.path.includes('..')) files[`${root}/${f.path}`] = strToU8(String(f.content))
  if (s.tests && ((s.tests.positive || []).length || (s.tests.cases || []).length)) files[`${root}/evals/tests.yaml`] = strToU8(testsYaml(s))
  return Buffer.from(zipSync(files, { level: 6 }))
}
function importZip(buffer) {
  const entries = unzipSync(new Uint8Array(buffer))
  const names = Object.keys(entries).filter((n) => !n.endsWith('/') && !n.startsWith('__MACOSX'))
  const skillMd = names.filter((n) => /(^|\/)SKILL\.md$/i.test(n)).sort((a, b) => a.length - b.length)[0]
  if (!skillMd) throw new Error('No SKILL.md found in this ZIP.')
  const base = skillMd.replace(/SKILL\.md$/i, '')
  const { meta, body } = fromSkillMd(strFromU8(entries[skillMd]))
  const files = names
    .filter((n) => n.startsWith(base) && n !== skillMd && /^(references|scripts|assets|evals)\//.test(n.slice(base.length)))
    .filter((n) => entries[n].length < 400000 && !/\.(png|jpe?g|gif|webp|pdf|zip|bin|onnx|gguf)$/i.test(n))
    .map((n) => ({ path: n.slice(base.length), content: strFromU8(entries[n]) }))
  return {
    name: String(meta.name || base.split('/').filter(Boolean).pop() || 'imported-skill'),
    description: String(meta.description || ''),
    license: String(meta.license || ''),
    compatibility: String(meta.compatibility || ''),
    version: String(meta.metadata?.version || meta.version || '1.0.0'),
    author: String(meta.metadata?.author || meta.author || ''),
    body,
    files,
  }
}

// ---------- bundles: agents, multi-agent teams and harnesses ----------
// A bundle ZIP holds readable Markdown for people and other hosts (AGENT.md, TEAM.md, HARNESS.md,
// skills/<name>/SKILL.md) plus orbi-bundle.json, which Orbi imports back exactly.
const arr = (v) => {
  if (Array.isArray(v)) return v
  try {
    const j = JSON.parse(v || '[]')
    return Array.isArray(j) ? j : []
  } catch {
    return []
  }
}
const obj = (v) => {
  if (v && typeof v === 'object') return v
  try {
    return JSON.parse(v || '{}') || {}
  } catch {
    return {}
  }
}
const slug = (v, d = 'item') => String(v || d).toLowerCase().replace(/^@/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || d
const fm = (o) => '---\n' + Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.map((x) => JSON.stringify(String(x))).join(', ')}]` : JSON.stringify(String(v))}`).join('\n') + '\n---\n'

function agentMd(a) {
  const starters = arr(a.starters)
  const skills = a.skills_mode === 'all' ? ['(all enabled skills)'] : a.skills_mode === 'selected' ? arr(a.skills) : []
  return (
    fm({ name: a.name, handle: a.handle, description: a.description, category: a.category, model: a.model, tools: arr(a.tools), skills }) +
    `\n# ${a.name || a.handle}\n\n${a.description ? a.description + '\n\n' : ''}## Instructions\n\n${a.instructions || ''}\n` +
    (starters.length ? `\n## Conversation starters\n\n${starters.map((x) => `- ${x}`).join('\n')}\n` : '') +
    `\n---\nUse: paste the Instructions as the system prompt of any assistant, or import this ZIP in Orbi → Creator Studio.\n`
  )
}
const MODE_TEXT = { sequential: 'Sequential — each member improves the previous result.', parallel: 'Parallel — members answer independently; the synthesizer merges.', router: 'Router — a lead picks the best member for each request.', debate: 'Debate — members critique each other; the synthesizer decides.' }
function teamMd(t) {
  const members = arr(t.members)
  return (
    fm({ name: t.name, handle: t.handle, mode: t.mode, members: members.length }) +
    `\n# ${t.name || t.handle}\n\n${t.description ? t.description + '\n\n' : ''}**How they work together:** ${MODE_TEXT[t.mode] || t.mode}\n\n## Members\n\n` +
    members.map((m, i) => `### ${i + 1}. ${m.name || m.agent || 'Member'}${m.agent ? ` (${m.agent})` : ''}\n\n${m.role ? `*${m.role}*\n\n` : ''}${m.instructions || (m.agent ? `Uses the agent ${m.agent} — see agents/.` : '')}\n`).join('\n') +
    `\n## Synthesizer\n\n${t.synthesizer || 'Merge the members’ work into one clear final answer.'}\n`
  )
}
function harnessMd(h) {
  const c = obj(h.config)
  const p = c.policies || {}
  const list = (x) => (x && x.length ? x.map((v) => `- ${v}`).join('\n') : '- (none)')
  return (
    fm({ name: h.name, description: h.description }) +
    `\n# ${h.name}\n\n${h.description ? h.description + '\n\n' : ''}## Allowed tools (MCP servers)\n\n${list(c.servers)}\n\nTools not listed are hidden from the model, so it cannot call them. Enforce this in the host, not in the prompt.\n\n## Skills switched on\n\n${list(c.skills)}\n\n## Agents\n\n${list(c.agents)}\n\n## Policies\n\n` +
    `- Context budget: ${p.context_budget ? `${p.context_budget} tokens` : 'model default'}\n- Cut long tool outputs: ${p.compact_tool_output ? `${p.compact_tool_output} characters` : 'off'}\n- Web search: ${p.web || 'auto'}\n- Memories: ${p.memory === false ? 'off' : 'on'}\n- Approval for risky tools: ${p.approval || 'risky'}\n\n## Operating rules\n\n${p.rules || '(none)'}\n`
  )
}
function exportBundle({ agents = [], teams = [], harnesses = [], skills = [], title = 'orbi-bundle', author = '' }) {
  const root = slug(title, 'orbi-bundle')
  const files = {}
  const put = (p, text) => (files[`${root}/${p}`] = strToU8(text))
  for (const a of agents) put(`agents/${slug(a.handle || a.name, 'agent')}/AGENT.md`, agentMd(a))
  for (const t of teams) put(`teams/${slug(t.handle || t.name, 'team')}/TEAM.md`, teamMd(t))
  for (const h of harnesses) put(`harnesses/${slug(h.name, 'harness')}/HARNESS.md`, harnessMd(h))
  for (const k of skills) {
    const name = slug(k.name, 'skill')
    put(`skills/${name}/SKILL.md`, toSkillMd({ ...k, name }, author))
    for (const f of k.files || []) if (/^[\w./-]+$/.test(f.path) && !f.path.includes('..')) put(`skills/${name}/${f.path}`, String(f.content))
    if (k.tests && ((k.tests.positive || []).length || (k.tests.cases || []).length)) put(`skills/${name}/evals/tests.yaml`, testsYaml({ ...k, name }))
  }
  const count = (n, w) => (n ? `${n} ${w}${n > 1 ? 's' : ''}` : '')
  put(
    'README.md',
    `# ${title}\n\nExported from Orbi Creator Studio${author ? ` by ${author}` : ''} on ${new Date().toISOString().slice(0, 10)}.\n\nContains ${[count(agents.length, 'agent'), count(teams.length, 'team'), count(harnesses.length, 'harness'), count(skills.length, 'skill')].filter(Boolean).join(', ') || 'nothing'}.\n\n- **agents/** — AGENT.md per agent (instructions you can paste into any assistant)\n- **teams/** — TEAM.md per multi-agent team\n- **harnesses/** — HARNESS.md per harness (allowed tools, skills, agents, policies)\n- **skills/** — portable Agent Skills (SKILL.md + support files)\n- **orbi-bundle.json** — import this ZIP in Orbi → Creator Studio → Import to restore everything\n`,
  )
  put('orbi-bundle.json', JSON.stringify({ orbi: 'bundle', version: 1, agents, teams, harnesses, skills }, null, 2))
  return Buffer.from(zipSync(files, { level: 6 }))
}
function importBundle(buffer) {
  const entries = unzipSync(new Uint8Array(buffer))
  const name = Object.keys(entries).find((n) => /(^|\/)orbi-bundle\.json$/.test(n))
  if (!name) return null
  const j = JSON.parse(strFromU8(entries[name]))
  if (j.orbi !== 'bundle') return null
  return { agents: j.agents || [], teams: j.teams || [], harnesses: j.harnesses || [], skills: j.skills || [] }
}

module.exports = { questionsPrompt, buildPrompt, parseJson, toSkillMd, fromSkillMd, validate, audit, exportZip, importZip, exportBundle, importBundle, RUBRIC }
