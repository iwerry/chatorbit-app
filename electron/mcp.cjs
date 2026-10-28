// MCP hub: built-in tools + external MCP servers (stdio and HTTP), exposed to chat as one tool list.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { exec } = require('node:child_process')
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js')
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js')
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js')

// ---------- configuration ----------
const DEFAULT_SERVERS = [
  { id: 'orbi-core', name: 'Orbi Core', type: 'builtin', enabled: true, description: 'Web search, read web pages, current time, save memories.' },
  { id: 'orbi-files', name: 'Workspace Files', type: 'builtin', enabled: true, description: 'Read and write files in your Orbi workspace folder.' },
  { id: 'orbi-terminal', name: 'Terminal Commands', type: 'builtin', enabled: true, description: 'Run shell commands on this computer — always asks first.' },
  { id: 'deepwiki', name: 'DeepWiki', type: 'http', url: 'https://mcp.deepwiki.com/mcp', enabled: true, description: 'Ask questions about any public GitHub repository.' },
  { id: 'context7', name: 'Context7', type: 'http', url: 'https://mcp.context7.com/mcp', enabled: true, description: 'Up-to-date docs and code examples for libraries.' },
  // Bundled with Orbi (no Node.js needed). Changes to files and browser actions ask first.
  { id: 'filesystem', name: 'Filesystem (official)', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '{home}'], enabled: true, description: 'Read and edit files in your home folder. Changes ask first.' },
  { id: 'memory-graph', name: 'Knowledge Graph Memory', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], enabled: true, description: 'Persistent knowledge graph memory.' },
  { id: 'sequential-thinking', name: 'Sequential Thinking', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'], enabled: true, description: 'Structured step-by-step problem solving.' },
  { id: 'playwright', name: 'Playwright Browser', type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'], enabled: true, description: 'Lets the AI drive a real browser (Edge or Chrome). Actions ask first.' },
]

// MCP servers that ship inside Orbi and run on Electron's own Node.js, so they work without installing Node.
const BUNDLED = ['@modelcontextprotocol/server-filesystem', '@modelcontextprotocol/server-memory', '@modelcontextprotocol/server-sequential-thinking', '@playwright/mcp']
function bundledLaunch(server) {
  if (server.type !== 'stdio' || !/^npx(\.cmd)?$/i.test(server.command || '')) return null
  const args = expandArgs(server.args).filter((a) => a !== '-y' && a !== '--yes')
  const name = (args[0] || '').replace(/^(@[^/]+\/[^@]+|[^@]+)@.*$/, '$1')
  if (!BUNDLED.includes(name)) return null
  try {
    const dir = path.join(__dirname, '..', 'node_modules', ...name.split('/'))
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    const bin = typeof pj.bin === 'string' ? pj.bin : Object.values(pj.bin || {})[0]
    // Node modules are unpacked from app.asar so the child process can load them (ESM included).
    const file = path.join(dir, bin).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
    let rest = args.slice(1)
    if (name === '@playwright/mcp' && !rest.some((a) => a.startsWith('--browser'))) {
      const chrome = process.platform === 'darwin' ? fs.existsSync('/Applications/Google Chrome.app') : process.platform === 'linux' ? fs.existsSync('/opt/google/chrome/chrome') : false
      rest = [...rest, '--browser', process.platform === 'win32' ? 'msedge' : chrome ? 'chrome' : 'msedge']
    }
    return { command: process.execPath, args: [file, ...rest], env: { ELECTRON_RUN_AS_NODE: '1' } }
  } catch {
    return null
  }
}
// Actions that change things outside the chat ask for approval, even on external servers.
const RISKY = /(^|_)(write|edit|move|delete|remove|rename|create|update|upload|click|type|fill|navigate|drag|press|select_option|file_upload|evaluate|run|exec)/i

const CATALOG = [
  { id: 'filesystem', name: 'Filesystem (official)', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '{home}'], description: 'Full file access to a folder you choose. Needs Node.js.' },
  { id: 'memory-graph', name: 'Knowledge Graph Memory', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], description: 'Persistent knowledge graph memory. Needs Node.js.' },
  { id: 'sequential-thinking', name: 'Sequential Thinking', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'], description: 'Structured step-by-step problem solving. Needs Node.js.' },
  { id: 'playwright', name: 'Playwright Browser', type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'], description: 'Let the AI drive a real browser. Needs Node.js.' },
  { id: 'github', name: 'GitHub', type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer <your GitHub token>' }, description: 'Issues, PRs and repos. Needs a GitHub token.' },
  { id: 'figma', name: 'Figma (Framelink)', type: 'stdio', command: 'npx', args: ['-y', 'figma-developer-mcp', '--stdio'], env: { FIGMA_API_KEY: '<your Figma token>' }, description: 'Read Figma files and frames for design-to-code. Needs Node.js and a Figma token.' },
  { id: 'notion', name: 'Notion', type: 'stdio', command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], env: { NOTION_TOKEN: '<your Notion integration token>' }, description: 'Search and edit Notion pages. Needs Node.js and an integration token.' },
  { id: 'everything', name: 'MCP test server', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'], description: 'Reference server for testing every MCP feature. Needs Node.js.' },
]

const PLUGINS = [
  {
    id: 'dev-kit',
    name: 'Developer Kit',
    description: 'Terminal commands, workspace files, library docs (Context7) and repo Q&A (DeepWiki), plus the @code_helper agent.',
    servers: ['orbi-terminal', 'orbi-files', 'context7', 'deepwiki'],
    skills: ['Code Helper'],
    agents: [{ handle: '@code_helper', name: 'Code Helper', category: 'Development', description: 'Writes and runs code with you.', instructions: 'You are a senior software engineer pairing with the user. Write complete, runnable code, explain briefly, and use the terminal and file tools when they help. Prefer the user\'s operating system commands.' }],
  },
  {
    id: 'research-kit',
    name: 'Research Kit',
    description: 'Reads web pages, researches repositories and turns on the Deep Research skill.',
    servers: ['orbi-core', 'deepwiki'],
    skills: ['Deep Research'],
    agents: [],
  },
  {
    id: 'creative-kit',
    name: 'Creative Kit',
    description: 'Creative Prompting skill and the @creative_director agent for campaigns, images and video.',
    servers: ['orbi-core'],
    skills: ['Creative Prompting'],
    agents: [],
  },
]

let ctx = null // { getSetting, setSetting, db, approve, userDataDir, onChange }
const clients = new Map() // id -> { client, transport, tools, status, error }

function servers() {
  const saved = ctx.getSetting('mcpServers', null)
  if (!saved) {
    ctx.setSetting('mcpServers', DEFAULT_SERVERS)
    return DEFAULT_SERVERS
  }
  // make sure new built-ins appear after updates
  const ids = new Set(saved.map((s) => s.id))
  const merged = [...saved, ...DEFAULT_SERVERS.filter((d) => !ids.has(d.id))]
  if (merged.length !== saved.length) ctx.setSetting('mcpServers', merged)
  return merged
}

function workspaceDir() {
  const dir = ctx.getSetting('workspaceDir', '') || path.join(os.homedir(), 'Documents', 'Orbi')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function safePath(rel) {
  const root = path.resolve(workspaceDir())
  const full = path.resolve(root, rel || '.')
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error(`Path is outside the workspace folder (${root}).`)
  return full
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(br|p|div|li|h\d|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
}

// ---------- built-in tools ----------
const BUILTIN = {
  'orbi-core': [
    {
      name: 'get_current_time',
      description: 'Get the current date and time on this computer.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => ({ iso: new Date().toISOString(), local: new Date().toString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    },
    {
      name: 'web_search',
      description: 'Search the web (no key needed) and read the top pages. Use for current events, facts, prices, docs or anything after your training data.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' }, read_pages: { type: 'number', description: 'How many top pages to read (0-4, default 2)' } }, required: ['query'] },
      run: async ({ query, read_pages = 2 }) => {
        const r = await require('./websearch.cjs').search(query, { read: Math.max(0, Math.min(4, read_pages)), lang: ctx.getSetting('language', 'en') })
        return { engine: r.engine, results: r.results.map((x) => ({ title: x.title, url: x.url, snippet: x.snippet, content: (x.content || '').slice(0, 2500) })) }
      },
    },
    {
      name: 'web_fetch',
      description: 'Download a web page and return its readable text. Use for URLs the user mentions.',
      inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'http(s) URL' }, max_chars: { type: 'number' } }, required: ['url'] },
      run: async ({ url, max_chars = 12000 }) => {
        if (!/^https?:\/\//.test(url)) throw new Error('Only http(s) URLs are allowed.')
        const res = await fetch(url, { headers: { 'user-agent': 'Orbi/0.2 (+https://orbix.com)' }, signal: AbortSignal.timeout(20000) })
        const type = res.headers.get('content-type') || ''
        const body = await res.text()
        const text = type.includes('html') ? htmlToText(body) : body
        return { status: res.status, url: res.url, text: text.slice(0, max_chars) }
      },
    },
    {
      name: 'save_memory',
      description: 'Remember a durable fact about the user (preferences, projects, context) for future conversations.',
      inputSchema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
      run: async ({ content }) => {
        ctx.db.run('INSERT INTO memories (id, content, created_at) VALUES (?,?,?)', [ctx.db.uid(), content, Date.now()])
        ctx.onChange?.('memories')
        return { saved: true }
      },
    },
  ],
  'orbi-files': [
    {
      name: 'list_directory',
      description: 'List files and folders inside the Orbi workspace folder (relative path, default root).',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      run: async ({ path: rel = '.' }) => {
        const dir = safePath(rel)
        return {
          root: workspaceDir(),
          entries: fs.readdirSync(dir, { withFileTypes: true }).map((d) => ({ name: d.name, type: d.isDirectory() ? 'dir' : 'file' })),
        }
      },
    },
    {
      name: 'read_text_file',
      description: 'Read a text file from the Orbi workspace folder.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      run: async ({ path: rel }) => ({ content: fs.readFileSync(safePath(rel), 'utf8').slice(0, 100000) }),
    },
    {
      name: 'write_text_file',
      description: 'Create or overwrite a text file in the Orbi workspace folder. Asks the user first.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      approval: (a) => `Write ${a.path} (${(a.content || '').length} characters) in your Orbi workspace?`,
      run: async ({ path: rel, content }) => {
        const full = safePath(rel)
        fs.mkdirSync(path.dirname(full), { recursive: true })
        fs.writeFileSync(full, content, 'utf8')
        return { written: full }
      },
    },
  ],
  'orbi-terminal': [
    {
      name: 'run_command',
      description: `Run a shell command on the user's computer (${process.platform === 'win32' ? 'PowerShell' : 'bash/zsh'}) and return its output. The user approves every command.`,
      inputSchema: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string', description: 'Working directory (default: Orbi workspace)' } }, required: ['command'] },
      approval: (a) => `Run this command?\n\n${a.command}`,
      run: ({ command, cwd }) =>
        new Promise((resolve) => {
          const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash'
          exec(command, { cwd: cwd && fs.existsSync(cwd) ? cwd : workspaceDir(), shell, timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
            resolve({ exit_code: err ? err.code ?? 1 : 0, stdout: String(stdout).slice(-12000), stderr: String(stderr).slice(-4000) })
          })
        }),
    },
  ],
}

// ---------- external servers ----------
function expandArgs(args = []) {
  return args.map((a) => a.replace('{home}', os.homedir()).replace('{workspace}', workspaceDir()))
}

async function connect(server) {
  disconnect(server.id)
  if (server.type === 'builtin') {
    clients.set(server.id, { status: 'connected', tools: BUILTIN[server.id] || [] })
    return
  }
  const entry = { status: 'connecting', tools: [] }
  clients.set(server.id, entry)
  ctx.onChange?.('mcp')
  try {
    const client = new Client({ name: "Orbi", version: require("../package.json").version })
    let transport
    if (server.type === 'stdio') {
      const bundled = bundledLaunch(server)
      let command = bundled ? bundled.command : server.command
      let args = bundled ? bundled.args : expandArgs(server.args)
      if (bundled) server = { ...server, env: { ...(server.env || {}), ...bundled.env } }
      if (!bundled && process.platform === 'win32' && /^(npx|npm|node|uvx|pnpm|yarn)$/i.test(command)) {
        args = ['/c', command, ...args]
        command = 'cmd.exe'
      }
      transport = new StdioClientTransport({ command, args, env: { ...process.env, ...(server.env || {}) }, stderr: 'ignore' })
      await client.connect(transport)
    } else {
      const url = new URL(server.url)
      const requestInit = { headers: server.headers || {} }
      try {
        transport = new StreamableHTTPClientTransport(url, { requestInit })
        await client.connect(transport)
      } catch (e) {
        transport = new SSEClientTransport(url, { requestInit })
        await client.connect(transport)
      }
    }
    const list = await client.listTools()
    Object.assign(entry, { client, transport, status: 'connected', error: null, tools: list.tools || [] })
  } catch (e) {
    Object.assign(entry, { status: 'error', error: String(e.message || e).slice(0, 300) })
  }
  ctx.onChange?.('mcp')
}

function disconnect(id) {
  const c = clients.get(id)
  clients.delete(id)
  try {
    c?.client?.close()
  } catch {
    /* ignore */
  }
}

async function connectAll() {
  await Promise.all(servers().filter((s) => s.enabled).map((s) => connect(s)))
}

function status() {
  return servers().map((s) => {
    const c = clients.get(s.id)
    return {
      ...s,
      status: !s.enabled ? 'disabled' : c?.status || 'connecting',
      error: c?.error || null,
      tools: (c?.tools || []).map((t) => ({ name: t.name, description: t.description || '' })),
    }
  })
}

async function saveServer(server) {
  const list = servers()
  const i = list.findIndex((s) => s.id === server.id)
  const next = { ...(i >= 0 ? list[i] : {}), ...server }
  if (i >= 0) list[i] = next
  else list.push(next)
  ctx.setSetting('mcpServers', list)
  if (next.enabled) await connect(next)
  else disconnect(next.id)
  return status()
}

function removeServer(id) {
  disconnect(id)
  ctx.setSetting(
    'mcpServers',
    servers().filter((s) => s.id !== id || s.type === 'builtin'),
  )
  return status()
}

// ---------- tool list for the model ----------
function qualified(serverId, tool) {
  return `${serverId}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
}

function toolsForChat(allowServers) {
  const out = []
  for (const s of servers()) {
    if (!s.enabled) continue
    if (allowServers && !allowServers.includes(s.id)) continue
    const c = clients.get(s.id)
    if (c?.status !== 'connected') continue
    for (const t of c.tools) {
      out.push({ name: qualified(s.id, t.name), description: `[${s.name}] ${t.description || t.name}`.slice(0, 1000), parameters: t.inputSchema || { type: 'object', properties: {} }, server: s.id, tool: t.name })
    }
  }
  return out
}

async function callTool(qname, args, origin) {
  for (const s of servers()) {
    const c = clients.get(s.id)
    if (!c || c.status !== 'connected') continue
    const t = c.tools.find((x) => qualified(s.id, x.name) === qname)
    if (!t) continue
    if (s.type === 'builtin') {
      if (t.approval && !ctx.getSetting('autoApproveTools', false)) {
        const ok = await ctx.approve({ server: s.name, tool: t.name, message: t.approval(args || {}), args }, origin)
        if (!ok) return { error: 'The user declined this action.' }
      }
      return t.run(args || {})
    }
    if (RISKY.test(t.name) && !ctx.getSetting('autoApproveTools', false)) {
      const ok = await ctx.approve({ server: s.name, tool: t.name, message: `${s.name} wants to run ${t.name}:\n\n${JSON.stringify(args || {}, null, 2).slice(0, 800)}`, args }, origin)
      if (!ok) return { error: 'The user declined this action.' }
    }
    const r = await c.client.callTool({ name: t.name, arguments: args || {} })
    const text = (r.content || []).map((p) => (p.type === 'text' ? p.text : `[${p.type}]`)).join('\n')
    return r.isError ? { error: text } : text
  }
  throw new Error(`Tool not found: ${qname}`)
}

// ---------- plugins ----------
function plugins() {
  const on = ctx.getSetting('plugins', null) ?? []
  return PLUGINS.map((p) => ({ ...p, enabled: on.includes(p.id) }))
}

async function setPlugin(id, enabled) {
  const p = PLUGINS.find((x) => x.id === id)
  if (!p) return plugins()
  const on = new Set(ctx.getSetting('plugins', []) ?? [])
  if (enabled) on.add(id)
  else on.delete(id)
  ctx.setSetting('plugins', [...on])
  if (enabled) {
    const list = servers()
    for (const s of list) if (p.servers.includes(s.id) && !s.enabled) await saveServer({ ...s, enabled: true })
    for (const name of p.skills) ctx.db.run('UPDATE skills SET enabled = 1 WHERE name = ?', [name])
    for (const a of p.agents) {
      const exists = ctx.db.get('SELECT id FROM agents WHERE handle = ?', [a.handle])
      if (!exists)
        ctx.db.run('INSERT INTO agents (id, handle, name, description, category, instructions, tools, created_at) VALUES (?,?,?,?,?,?,?,?)', [
          ctx.db.uid(), a.handle, a.name, a.description, a.category, a.instructions, JSON.stringify(p.servers), Date.now(),
        ])
    }
  } else {
    for (const name of p.skills) ctx.db.run('UPDATE skills SET enabled = 0 WHERE name = ?', [name])
  }
  ctx.onChange?.('all')
  return plugins()
}

async function init(c) {
  ctx = c
  if (ctx.getSetting('plugins', null) === null) {
    // First run: everything that needs no setup starts connected.
    ctx.setSetting('plugins', [])
    for (const p of PLUGINS) await setPlugin(p.id, true)
  }
  connectAll()
}

function shutdown() {
  for (const id of [...clients.keys()]) disconnect(id)
}

module.exports = { init, status, saveServer, removeServer, connect, toolsForChat, callTool, plugins, setPlugin, CATALOG, workspaceDir, shutdown, servers }
