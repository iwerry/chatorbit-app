// SQLite storage (sql.js / WASM — no native module, runs the same on Windows and Linux).
const fs = require('node:fs')
const path = require('node:path')
const initSqlJs = require('sql.js')

let db = null
let dbFile = null
let saveTimer = null

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, project_id TEXT, pinned INTEGER DEFAULT 0,
  model TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
  model TEXT, attachments TEXT, bookmarked INTEGER DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, content TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, file TEXT NOT NULL,
  prompt TEXT, model TEXT, source TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, handle TEXT NOT NULL, instructions TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, instructions TEXT NOT NULL,
  enabled INTEGER DEFAULT 0, created_at INTEGER NOT NULL
);
`

// Columns added after 0.1.0 — applied with ALTER TABLE when missing.
const MIGRATIONS = {
  agents: {
    name: 'TEXT', description: 'TEXT', model: 'TEXT', category: "TEXT DEFAULT 'General'", tools: "TEXT DEFAULT '[]'",
    skills_mode: "TEXT DEFAULT 'off'", skills: "TEXT DEFAULT '[]'", starters: "TEXT DEFAULT '[]'", support_name: 'TEXT', support_email: 'TEXT', color: 'TEXT',
  },
  messages: { tools: "TEXT DEFAULT '[]'" },
  media: { board: "TEXT DEFAULT ''", params: "TEXT DEFAULT ''" },
  skills: { library_id: 'TEXT' },
}

const DEFAULT_SKILLS = [
  ['Deep Research', 'Thorough, structured answers with assumptions and open questions.', 'Research mode: break the question down, reason step by step, separate facts from assumptions, and end with open questions worth checking.', 1],
  ['Document Analysis', 'Careful reading of attached files, citing the parts you use.', 'When files are attached, analyse them carefully, quote the relevant passages briefly and say when something is not in the document.', 0],
  ['Brand Voice', 'Clear, confident, warm copy — no clichés.', 'Write in a clear, confident and warm brand voice. Avoid clichés, filler and exaggerated claims.', 0],
  ['Creative Prompting', 'Turns ideas into detailed image and video prompts.', 'When the user wants visuals, propose detailed image/video prompts covering subject, composition, lens, light, color and motion.', 0],
  ['Code Helper', 'Writes runnable code and terminal commands for your OS.', 'When writing code or commands, give complete runnable snippets, name the file, and use commands for the user\'s operating system. Prefer short explanations after the code.', 0],
]

const DEFAULT_AGENTS = [
  ['@creative_director', 'You are a creative director. Give bold, specific visual and narrative direction, with references to composition, light, color and pacing.'],
  ['@researcher', 'You are a meticulous researcher. Structure answers with evidence, distinguish facts from assumptions, and flag uncertainty.'],
  ['@copy_chief', 'You are a senior copywriter. Write tight, persuasive copy with strong hooks and clear calls to action. Offer 2-3 variants when useful.'],
  ['@data_analyst', 'You are a data analyst. Think in metrics, tables and comparisons. Show calculations step by step.'],
]

async function open(userDataDir) {
  const SQL = await initSqlJs({
    locateFile: (f) => path.join(path.dirname(require.resolve('sql.js')), f),
  })
  dbFile = path.join(userDataDir, 'orbi.db')
  db = fs.existsSync(dbFile) ? new SQL.Database(fs.readFileSync(dbFile)) : new SQL.Database()
  db.exec(SCHEMA)
  for (const [table, cols] of Object.entries(MIGRATIONS)) {
    const have = new Set(all(`PRAGMA table_info(${table})`).map((c) => c.name))
    for (const [col, type] of Object.entries(cols)) if (!have.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`)
  }
  db.exec("UPDATE agents SET name = substr(handle, 2) WHERE name IS NULL OR name = ''")
  if ((get('SELECT COUNT(*) AS n FROM skills')?.n ?? 0) === 0) {
    for (const [name, description, instructions, enabled] of DEFAULT_SKILLS) {
      run('INSERT INTO skills (id, name, description, instructions, enabled, created_at) VALUES (?,?,?,?,?,?)', [uid(), name, description, instructions, enabled, Date.now()])
    }
  }
  const count = get('SELECT COUNT(*) AS n FROM agents')?.n ?? 0
  if (count === 0) {
    for (const [handle, instructions] of DEFAULT_AGENTS) {
      run('INSERT INTO agents (id, handle, name, instructions, created_at) VALUES (?,?,?,?,?)', [uid(), handle, handle.slice(1), instructions, Date.now()])
    }
  }
  flush()
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

function all(sql, params = []) {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  return rows
}

function get(sql, params = []) {
  return all(sql, params)[0]
}

function run(sql, params = []) {
  db.run(sql, params)
  scheduleSave()
}

function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flush, 150)
}

function flush() {
  if (!db || !dbFile) return
  const data = db.export()
  const tmp = dbFile + '.tmp'
  fs.writeFileSync(tmp, Buffer.from(data))
  fs.renameSync(tmp, dbFile)
}

module.exports = { open, all, get, run, uid, flush, get ready() {
  return !!db
} }
