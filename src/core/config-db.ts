import { Database } from 'bun:sqlite';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { homedir } from 'os';

export interface ConfigRecord {
  key: string;
  value: string;
  encrypted: number;
  updatedAt: string;
}

const DEFAULT_DB_PATH = `${homedir()}/.vibe-agent/config.db`;

export class ConfigDB {
  private db: Database;

  constructor(dbPath = DEFAULT_DB_PATH) {
    // Ensure directory exists
    const dir = dirname(dbPath);
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // Directory may already exist
    }

    this.db = new Database(dbPath, { create: true });
    this.init();
  }

  private init(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        encrypted INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  get(key: string): string | undefined {
    const stmt = this.db.query<ConfigRecord, { $key: string }>(
      'SELECT * FROM config WHERE key = $key'
    );
    const row = stmt.get({ $key: key });
    stmt.finalize();
    return row ? row.value : undefined;
  }

  set(key: string, value: string, encrypted = false): void {
    const stmt = this.db.query(
      'INSERT INTO config (key, value, encrypted, updated_at) VALUES ($key, $value, $encrypted, $updated_at) ' +
      'ON CONFLICT(key) DO UPDATE SET value = $value, encrypted = $encrypted, updated_at = $updated_at'
    );
    stmt.run({
      $key: key,
      $value: value,
      $encrypted: encrypted ? 1 : 0,
      $updated_at: new Date().toISOString()
    });
    stmt.finalize();
  }

  delete(key: string): void {
    const stmt = this.db.query('DELETE FROM config WHERE key = $key');
    stmt.run({ $key: key });
    stmt.finalize();
  }

  getAll(): ConfigRecord[] {
    const stmt = this.db.query<ConfigRecord, []>('SELECT * FROM config ORDER BY key');
    const rows = stmt.all();
    stmt.finalize();
    return rows;
  }

  close(): void {
    this.db.close();
  }
}
