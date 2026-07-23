/**
 * DatabaseExplorer — schema browsing and query result visualization.
 *
 * Provides a database exploration UI:
 * - Schema tree (databases → tables → columns)
 * - Table info (columns, types, keys, indexes)
 * - Query result table with pagination
 * - Query editor with syntax hints
 * - Query history
 * - Row count and execution time
 * - NULL value highlighting
 * - Data type icons
 * - Export results (CSV/JSON)
 * - Connection status indicator
 *
 * Visual style:
 * ┌─ Database Explorer ──────────── [● Connected] ────┐
 * │ ▾ mydb                                            │
 * │   ▾ users (1,234 rows)                            │
 * │     ◆ id        INTEGER  PK                       │
 * │     ○ name      TEXT     NOT NULL                 │
 * │     ○ email     TEXT     UNIQUE                   │
 * │     ○ created   DATETIME                          │
 * │   ▸ orders (5,678 rows)                           │
 * │   ▸ products (89 rows)                            │
 * │                                                   │
 * │ SELECT * FROM users LIMIT 3;  ⏱ 12ms             │
 * │ ┌────┬─────────┬─────────────────┬──────────────┐ │
 * │ │ id │ name    │ email           │ created      │ │
 * │ ├────┼─────────┼─────────────────┼──────────────┤ │
 * │ │  1 │ Alice   │ alice@ex.com    │ 2026-01-15   │ │
 * │ │  2 │ Bob     │ bob@ex.com      │ 2026-02-20   │ │
 * │ │  3 │ Charlie │ NULL            │ 2026-03-10   │ │
 * │ └────┴─────────┴─────────────────┴──────────────┘ │
 * └───────────────────────────────────────────────────┘
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ColumnType = 'integer' | 'text' | 'real' | 'blob' | 'datetime' | 'boolean' | 'json';
export type KeyType = 'pk' | 'fk' | 'unique' | null;

export interface ColumnInfo {
  readonly name: string;
  readonly type: ColumnType;
  readonly nullable: boolean;
  readonly key: KeyType;
  readonly defaultValue?: string;
}

export interface TableInfo {
  readonly name: string;
  readonly columns: ColumnInfo[];
  readonly rowCount: number;
  readonly indexes?: string[];
}

export interface DatabaseSchema {
  readonly name: string;
  readonly tables: TableInfo[];
}

export interface QueryResult {
  readonly columns: string[];
  readonly rows: (string | null)[][];
  readonly rowCount: number;
  readonly executionTimeMs: number;
  readonly query: string;
}

export interface DbRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly showSchema?: boolean;
  readonly showQuery?: boolean;
  readonly showResults?: boolean;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// DatabaseExplorer
// ---------------------------------------------------------------------------

const TYPE_ICONS: Record<ColumnType, string> = {
  integer: '#', text: 'A', real: '◐', blob: '◼', datetime: '◷', boolean: '⊘', json: '{}',
};

const TYPE_TOKENS: Record<ColumnType, string> = {
  integer: 'warning', text: 'success', real: 'primary', blob: 'textMuted',
  datetime: 'accent', boolean: 'error', json: 'primary',
};

export class DatabaseExplorer {
  private schemas: Map<string, DatabaseSchema> = new Map();
  private expandedTables: Set<string> = new Set();
  private selectedTable: string | null = null;
  private lastQuery: QueryResult | null = null;
  private queryHistory: string[] = [];
  private connected = false;
  private connectionInfo = '';

  // ─── Connection ──────────────────────────────────────────────────

  /** Set connection status. */
  setConnected(connected: boolean, info = ''): void {
    this.connected = connected;
    this.connectionInfo = info;
  }

  /** Check connection status. */
  get isConnected(): boolean {
    return this.connected;
  }

  // ─── Schema Management ───────────────────────────────────────────

  /** Add a database schema. */
  addSchema(schema: DatabaseSchema): void {
    this.schemas.set(schema.name, schema);
  }

  /** Get all schemas. */
  getSchemas(): DatabaseSchema[] {
    return [...this.schemas.values()];
  }

  /** Get a table by name. */
  getTable(schemaName: string, tableName: string): TableInfo | undefined {
    return this.schemas.get(schemaName)?.tables.find((t) => t.name === tableName);
  }

  // ─── Tree Navigation ─────────────────────────────────────────────

  /** Toggle table expansion. */
  toggleTable(tableName: string): void {
    if (this.expandedTables.has(tableName)) {
      this.expandedTables.delete(tableName);
    } else {
      this.expandedTables.add(tableName);
    }
  }

  /** Select a table. */
  selectTable(tableName: string | null): void {
    this.selectedTable = tableName;
  }

  // ─── Query ───────────────────────────────────────────────────────

  /** Set query result. */
  setQueryResult(result: QueryResult): void {
    this.lastQuery = result;
    this.queryHistory.unshift(result.query);
    if (this.queryHistory.length > 20) this.queryHistory.pop();
  }

  /** Get last query result. */
  getLastQuery(): QueryResult | null {
    return this.lastQuery;
  }

  /** Get query history. */
  getQueryHistory(): string[] {
    return this.queryHistory;
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the database explorer. */
  render(options: DbRenderOptions): string[] {
    const { width, height, showSchema = true, showQuery = true, showResults = true, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const innerWidth = width - 2;

    // Header with connection status
    const connStatus = this.connected
      ? fg('success', '[● Connected]')
      : fg('error', '[○ Disconnected]');
    const title = ` Database Explorer`;
    lines.push(fg('textMuted', `┌─${boldFg('text', title)} ${'─'.repeat(Math.max(0, innerWidth - title.length - 18))} ${connStatus} ┐`));

    let usedLines = 1;

    // Schema tree
    if (showSchema) {
      const schemaLines = this.renderSchemaTree(innerWidth, options);
      const maxSchemaLines = Math.floor(height * 0.4);
      for (const line of schemaLines.slice(0, maxSchemaLines)) {
        lines.push(fg('textMuted', '│') + line + fg('textMuted', '│'));
        usedLines++;
      }
      lines.push(fg('textMuted', '│' + ' '.repeat(innerWidth) + '│'));
      usedLines++;
    }

    // Query
    if (showQuery && this.lastQuery) {
      const queryStr = this.lastQuery.query.slice(0, innerWidth - 15);
      const timeStr = dimFg('textMuted', `⏱ ${String(this.lastQuery.executionTimeMs)}ms`);
      lines.push(fg('textMuted', '│') + ` ${fg('primary', queryStr)} ${timeStr}` + ' '.repeat(Math.max(0, innerWidth - queryStr.length - 15)) + fg('textMuted', '│'));
      usedLines++;
    }

    // Results table
    if (showResults && this.lastQuery) {
      const resultLines = this.renderResultTable(this.lastQuery, innerWidth, options);
      const maxResultLines = height - usedLines - 2;
      for (const line of resultLines.slice(0, maxResultLines)) {
        lines.push(fg('textMuted', '│') + line + fg('textMuted', '│'));
      }
    }

    // Pad
    while (lines.length < height - 1) {
      lines.push(fg('textMuted', '│') + ' '.repeat(innerWidth) + fg('textMuted', '│'));
    }

    // Footer
    const tableCount = [...this.schemas.values()].reduce((sum, s) => sum + s.tables.length, 0);
    const footer = ` ${dimFg('textMuted', `${String(this.schemas.size)} db, ${String(tableCount)} tables`)}  ${fg('primary', '[Query]')} ${fg('accent', '[Refresh]')}`;
    lines.push(fg('textMuted', `└${padRight(footer, innerWidth)}┘`));

    return lines.slice(0, height);
  }

  private renderSchemaTree(width: number, options: DbRenderOptions): string[] {
    const { fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    for (const schema of this.schemas.values()) {
      // Database name
      lines.push(` ${boldFg('accent', `▾ ${schema.name}`)}`);

      for (const table of schema.tables) {
        const isExpanded = this.expandedTables.has(table.name);
        const isSelected = this.selectedTable === table.name;
        const expandIcon = isExpanded ? '▾' : '▸';
        const rowInfo = dimFg('textMuted', ` (${table.rowCount.toLocaleString()} rows)`);
        const tableLine = isSelected
          ? `   ${boldFg('primary', `${expandIcon} ${table.name}`)}${rowInfo}`
          : `   ${fg('text', `${expandIcon} ${table.name}`)}${rowInfo}`;
        lines.push(padRight(tableLine, width));

        // Columns if expanded
        if (isExpanded) {
          for (const col of table.columns.slice(0, 6)) {
            const colLine = this.renderColumn(col, width - 8, options);
            lines.push(`     ${colLine}`);
          }
          if (table.columns.length > 6) {
            lines.push(dimFg('textMuted', `     ... ${String(table.columns.length - 6)} more`));
          }
        }
      }
    }

    return lines;
  }

  private renderColumn(col: ColumnInfo, width: number, options: DbRenderOptions): string {
    const { fg, dimFg } = options;
    const icon = fg(TYPE_TOKENS[col.type], TYPE_ICONS[col.type]);
    const name = col.name.padEnd(10).slice(0, 10);
    const type = dimFg('textMuted', col.type.toUpperCase().padEnd(8));

    let constraints = '';
    if (col.key === 'pk') constraints += fg('warning', ' PK');
    if (col.key === 'fk') constraints += fg('primary', ' FK');
    if (col.key === 'unique') constraints += fg('accent', ' UQ');
    if (!col.nullable) constraints += dimFg('textMuted', ' NN');

    return `${icon} ${fg('text', name)} ${type}${constraints}`;
  }

  private renderResultTable(result: QueryResult, width: number, options: DbRenderOptions): string[] {
    const { fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    // Calculate column widths
    const colWidths = result.columns.map((col, i) => {
      const maxDataWidth = Math.max(...result.rows.map((row) => (row[i] ?? 'NULL').length));
      return Math.min(Math.max(col.length, maxDataWidth) + 2, 20);
    });

    // Adjust to fit width
    const totalWidth = colWidths.reduce((sum, w) => sum + w + 1, 1);
    if (totalWidth > width) {
      const scale = (width - result.columns.length - 1) / colWidths.reduce((sum, w) => sum + w, 0);
      for (let i = 0; i < colWidths.length; i++) {
        colWidths[i] = Math.max(4, Math.floor(colWidths[i]! * scale));
      }
    }

    // Header row
    const headerCells = result.columns.map((col, i) =>
      boldFg('text', col.padEnd(colWidths[i]!).slice(0, colWidths[i]))
    );
    lines.push(` ${fg('textMuted', '┌')} ${headerCells.join(fg('textMuted', '┬'))} ${fg('textMuted', '┐')}`);

    // Separator
    const sepCells = colWidths.map((w) => '─'.repeat(w));
    lines.push(` ${fg('textMuted', '├')} ${sepCells.join(fg('textMuted', '┼'))} ${fg('textMuted', '┤')}`);

    // Data rows
    for (const row of result.rows.slice(0, 8)) {
      const cells = row.map((cell, i) => {
        const value = cell ?? 'NULL';
        const isNull = cell === null;
        const padded = value.padEnd(colWidths[i]!).slice(0, colWidths[i]);
        return isNull ? dimFg('textMuted', padded) : fg('text', padded);
      });
      lines.push(` ${fg('textMuted', '│')} ${cells.join(fg('textMuted', '│'))} ${fg('textMuted', '│')}`);
    }

    // Bottom border
    lines.push(` ${fg('textMuted', '└')} ${sepCells.join(fg('textMuted', '┴'))} ${fg('textMuted', '┘')}`);

    // Row count
    lines.push(dimFg('textMuted', ` ${String(result.rowCount)} row${result.rowCount !== 1 ? 's' : ''}`));

    return lines;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function padRight(str: string, len: number): string {
  const visible = str.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = Math.max(0, len - visible.length);
  return str + ' '.repeat(pad);
}

/** Create a demo database explorer with sample data. */
export function createDemoDatabaseExplorer(): DatabaseExplorer {
  const explorer = new DatabaseExplorer();
  explorer.setConnected(true, 'postgres://localhost:5432/mydb');

  explorer.addSchema({
    name: 'mydb',
    tables: [
      {
        name: 'users',
        rowCount: 1234,
        columns: [
          { name: 'id', type: 'integer', nullable: false, key: 'pk' },
          { name: 'name', type: 'text', nullable: false, key: null },
          { name: 'email', type: 'text', nullable: true, key: 'unique' },
          { name: 'created_at', type: 'datetime', nullable: false, key: null },
          { name: 'is_active', type: 'boolean', nullable: false, key: null, defaultValue: 'true' },
        ],
        indexes: ['idx_users_email', 'idx_users_created'],
      },
      {
        name: 'orders',
        rowCount: 5678,
        columns: [
          { name: 'id', type: 'integer', nullable: false, key: 'pk' },
          { name: 'user_id', type: 'integer', nullable: false, key: 'fk' },
          { name: 'total', type: 'real', nullable: false, key: null },
          { name: 'status', type: 'text', nullable: false, key: null },
        ],
      },
      {
        name: 'products',
        rowCount: 89,
        columns: [
          { name: 'id', type: 'integer', nullable: false, key: 'pk' },
          { name: 'name', type: 'text', nullable: false, key: null },
          { name: 'price', type: 'real', nullable: false, key: null },
          { name: 'metadata', type: 'json', nullable: true, key: null },
        ],
      },
    ],
  });

  explorer.toggleTable('users');

  // Set a query result
  explorer.setQueryResult({
    query: 'SELECT * FROM users LIMIT 3;',
    columns: ['id', 'name', 'email', 'created_at'],
    rows: [
      ['1', 'Alice', 'alice@example.com', '2026-01-15'],
      ['2', 'Bob', 'bob@example.com', '2026-02-20'],
      ['3', 'Charlie', null, '2026-03-10'],
    ],
    rowCount: 3,
    executionTimeMs: 12,
  });

  return explorer;
}
