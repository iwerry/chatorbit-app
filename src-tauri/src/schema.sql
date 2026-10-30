
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
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY, handle TEXT NOT NULL, name TEXT, description TEXT, mode TEXT DEFAULT 'sequential',
  members TEXT DEFAULT '[]', synthesizer TEXT DEFAULT '', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS harnesses (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, config TEXT DEFAULT '{}', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, instructions TEXT NOT NULL,
  enabled INTEGER DEFAULT 0, created_at INTEGER NOT NULL
);
