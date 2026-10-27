// Builds electron/library-github.json from skill repositories on GitHub.
// Usage: node build/sync-skills.cjs <folder with the cloned repos>
// Each skill gets a 1–5 star score from signals anyone can check in its repository:
//   ★ purpose  — a description that says what it does and when to use it
//   ★ method   — a structured playbook (3+ sections, or 1,500+ characters)
//   ★ knowledge — 3+ reference files beyond the main instructions
//   ★ checks   — scripts or tests that validate the output
//   ★ open     — published with an open-source license
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const root = path.resolve(process.argv[2] || '.')
const DANIEL = 'Daniel Rodrigues'

const SOURCES = [
  { id: 'film:daniskills', profession: 'film', repo: 'iwerry/Daniskills', dir: 'Daniskills', author: DANIEL, name: 'Daniskills — Cinematic AI Production', description: 'Story → cinema → AI generation → continuity → QA → edit: real optics (FOV, Kelvin, 180° shutter) instead of empty adjectives.', main: 'UNIVERSAL_PROMPT.md', extract: (s) => (s.match(/```text\n([\s\S]*?)```/) || [, s])[1] },
  { id: 'screen:master-scene', profession: 'screen', repo: 'iwerry/skill-master-scene', dir: 'skill-master-scene', author: DANIEL, name: 'Master Scene Format', description: 'Industry-standard screenplay format: page geometry, element grammar, page breaks, runtime and Fountain/FDX.', main: 'SKILL.md' },
  { id: 'journalism:investigative', profession: 'journalism', repo: 'iwerry/jornalism.skill', dir: 'jornalism.skill', author: DANIEL, name: 'Investigative Journalism', description: 'Research, OSINT, verification and data methods routed by task, with a standard investigation loop.', main: 'SKILL.md' },
  { id: 'marketing:linkedin-optimizer', profession: 'marketing', repo: 'iwerry/linkedin-skills-pro', dir: 'linkedin-skills-pro', author: DANIEL, name: 'LinkedIn Profile Optimizer', description: 'Headline, About, experiences and the right 50 skills from LinkedIn’s taxonomy — found by recruiters, convincing to people.', main: 'SKILL.md' },
  { id: 'ux:designerx', profession: 'ux', repo: 'iwerry/designerx', dir: 'designerx', author: DANIEL, name: 'DesignerX', description: 'A designer’s eye for interfaces: critique, polish, bolder, quieter, typography, color, motion and anti-patterns.', main: 'skill/SKILL.src.md', extract: designerx },
  { id: 'audiovisual:motion-director', profession: 'audiovisual', repo: 'iwerry/code2video', dir: 'code2video', author: DANIEL, name: 'AI Motion Director', description: 'Motion graphics with code (Canvas, SVG, GSAP, Remotion, Manim, FFmpeg): brief, concept, timecoded script, storyboard and render.', main: 'ai-motion-director/SKILL.md', skillDir: 'ai-motion-director' },
  { id: 'ux:frontend-design', profession: 'ux', repo: 'anthropics/skills', dir: 'anthropic-skills', author: 'Anthropic', name: 'Frontend Design', description: 'Distinctive, intentional visual direction for interfaces that don’t look like templates.', main: 'skills/frontend-design/SKILL.md', skillDir: 'skills/frontend-design', subpath: 'tree/main/skills/frontend-design' },
  { id: 'dev:mcp-builder', profession: 'dev', repo: 'anthropics/skills', dir: 'anthropic-skills', author: 'Anthropic', name: 'MCP Builder', description: 'Build high-quality MCP servers (Python FastMCP or TypeScript SDK) with well-designed tools.', main: 'skills/mcp-builder/SKILL.md', skillDir: 'skills/mcp-builder', subpath: 'tree/main/skills/mcp-builder' },
]

function designerx(s) {
  // Orbi has no DesignerX launcher: keep the principles, how-to-design and modes; drop the CLI setup and command plumbing.
  const body = stripFront(s)
  const keep = body.split(/\n(?=## )/).filter((sec) => !/^## (Setup|Commands)\b/.test(sec))
  return keep.join('\n').replace(/\{\{[a-z_]+\}\}/g, '').replace(/<!--[^>]*-->/g, '')
}
function stripFront(s) {
  const i = s.indexOf('\n---\n', s.indexOf('---'))
  return /^[^\n]*\n*---\n/.test(s) || s.startsWith('---') ? s.slice(i + 5) : s
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue
    const p = path.join(dir, e.name)
    e.isDirectory() ? walk(p, out) : out.push(p)
  }
  return out
}

const out = []
for (const src of SOURCES) {
  const repoDir = path.join(root, src.dir)
  const base = path.join(repoDir, src.skillDir || '')
  const raw = fs.readFileSync(path.join(repoDir, src.main), 'utf8')
  let instructions = (src.extract ? src.extract(raw) : stripFront(raw)).trim()
  const files = walk(base).map((f) => path.relative(base, f))
  const mainRel = path.relative(base, path.join(repoDir, src.main))
  const refs = files.filter((f) => /\.(md|ya?ml|json)$/i.test(f) && f !== mainRel && !/^(README|CHANGELOG|LICENSE|NOTICE|CREDITS|package(-lock)?)\b/i.test(path.basename(f)))
  const checks = files.filter((f) => /(^|\/)(scripts|tests?)\//.test(f) && /\.(py|js|mjs|cjs|ts|sh)$/.test(f))
  const license = [repoDir, base].flatMap((d) => fs.readdirSync(d).filter((f) => /^LICEN[CS]E/i.test(f)).map((f) => fs.readFileSync(path.join(d, f), 'utf8')))[0] || ''
  const licenseName = /Apache License/i.test(license) ? 'Apache-2.0' : /MIT License/i.test(license) ? 'MIT' : /GNU GENERAL PUBLIC LICENSE/i.test(license) ? 'GPL-3.0' : /Creative Commons|CC BY/i.test(license) ? 'CC BY' : license ? 'Custom' : ''
  const sections = (instructions.match(/^#{2,3} /gm) || []).length
  const signals = {
    purpose: !!src.description,
    method: sections >= 3 || instructions.length >= 1500,
    knowledge: refs.length >= 3,
    checks: checks.length > 0,
    open: ['Apache-2.0', 'MIT', 'GPL-3.0', 'CC BY'].includes(licenseName),
  }
  const rating = Object.values(signals).filter(Boolean).length
  let commit = ''
  try {
    commit = execSync('git log -1 --format=%h·%cs', { cwd: repoDir }).toString().trim()
  } catch {}
  const url = `https://github.com/${src.repo}${src.subpath ? '/' + src.subpath : ''}`
  instructions = `[${src.name} — by ${src.author}. Source: ${url}${licenseName ? ` (${licenseName})` : ''}. Reference files mentioned below live in that repository.]\n\n${instructions}`
  out.push({
    id: src.id,
    profession: src.profession,
    name: src.name,
    description: src.description,
    instructions,
    author: src.author,
    source: url,
    license: licenseName,
    rating,
    signals: { ...signals, references: refs.length, checkFiles: checks.length, commit },
  })
  console.log(`${'★'.repeat(rating).padEnd(5, '☆')}  ${src.name}  (${refs.length} refs, ${checks.length} checks, ${licenseName || 'no license'}, ${instructions.length} chars)`)
}
fs.writeFileSync(path.join(__dirname, '..', 'electron', 'library-github.json'), JSON.stringify(out, null, 1) + '\n')
