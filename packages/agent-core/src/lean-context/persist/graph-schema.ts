export const GRAPH_META_VERSION = 2;

export const GRAPH_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY,
    display_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    mtime_ms INTEGER NOT NULL,
    size INTEGER NOT NULL,
    language TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    qualified_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    language TEXT NOT NULL,
    signature TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    is_test INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL,
    target_id TEXT,
    target_specifier TEXT,
    type TEXT NOT NULL,
    line INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (source_id) REFERENCES nodes(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file_path)`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name)`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_qualified ON nodes(qualified_name)`,
  `CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id)`,
  `CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS fts_nodes USING fts5(
    name,
    qualified_name,
    signature,
    body,
    file_path,
    content='nodes',
    content_rowid='rowid'
  )`,
  `CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
    INSERT INTO fts_nodes(rowid, name, qualified_name, signature, body, file_path)
    VALUES (new.rowid, new.name, new.qualified_name, new.signature, new.body, new.file_path);
  END`,
  `CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
    INSERT INTO fts_nodes(fts_nodes, rowid, name, qualified_name, signature, body, file_path)
    VALUES ('delete', old.rowid, old.name, old.qualified_name, old.signature, old.body, old.file_path);
  END`,
  `CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
    INSERT INTO fts_nodes(fts_nodes, rowid, name, qualified_name, signature, body, file_path)
    VALUES ('delete', old.rowid, old.name, old.qualified_name, old.signature, old.body, old.file_path);
    INSERT INTO fts_nodes(rowid, name, qualified_name, signature, body, file_path)
    VALUES (new.rowid, new.name, new.qualified_name, new.signature, new.body, new.file_path);
  END`,
] as const;
