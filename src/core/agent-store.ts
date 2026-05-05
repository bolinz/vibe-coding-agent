import { Database } from 'bun:sqlite';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { homedir } from 'os';
import type { Agent } from '../agents/types';

const DB_PATH = `${homedir()}/.vibe-agent/config.db`;

interface AgentRow {
  name: string;
  description: string;
  runtime_type: string;
  command: string;
  args: string;
  env: string;
  container: string;
  cwd: string;
  streaming: number;
  multi_turn: number;
  created_at: string;
  updated_at: string;
}

function rowToAgent(row: AgentRow): Agent {
  return {
    name: row.name,
    description: row.description,
    runtimeType: row.runtime_type as 'cli' | 'session' | 'container',
    config: {
      command: row.command,
      args: row.args ? JSON.parse(row.args) : undefined,
      env: row.env ? JSON.parse(row.env) : undefined,
      cwd: row.cwd || undefined,
      container: row.container ? JSON.parse(row.container) : undefined,
    },
    capabilities: {
      streaming: row.streaming === 1,
      multiTurn: row.multi_turn === 1,
    },
  };
}

function agentToRow(agent: Agent): AgentRow {
  return {
    name: agent.name,
    description: agent.description,
    runtime_type: agent.runtimeType,
    command: agent.config.command,
    args: agent.config.args ? JSON.stringify(agent.config.args) : '[]',
    env: agent.config.env ? JSON.stringify(agent.config.env) : '{}',
    container: agent.config.container ? JSON.stringify(agent.config.container) : '',
    cwd: agent.config.cwd || '',
    streaming: agent.capabilities.streaming ? 1 : 0,
    multi_turn: agent.capabilities.multiTurn ? 1 : 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export class AgentStore {
  private db: Database;

  constructor() {
    const dir = dirname(DB_PATH);
    mkdirSync(dir, { recursive: true });
    this.db = new Database(DB_PATH, { create: true });
    this.init();
  }

  private init(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS agents (
        name TEXT PRIMARY KEY,
        description TEXT NOT NULL DEFAULT '',
        runtime_type TEXT NOT NULL DEFAULT 'cli',
        command TEXT NOT NULL,
        args TEXT NOT NULL DEFAULT '[]',
        env TEXT NOT NULL DEFAULT '{}',
        container TEXT DEFAULT '',
        cwd TEXT DEFAULT '',
        streaming INTEGER DEFAULT 0,
        multi_turn INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  get(name: string): Agent | null {
    const stmt = this.db.query<AgentRow, { $name: string }>(
      'SELECT * FROM agents WHERE name = $name'
    );
    const row = stmt.get({ $name: name });
    stmt.finalize();
    return row ? rowToAgent(row) : null;
  }

  getAll(): Agent[] {
    const stmt = this.db.query<AgentRow, []>('SELECT * FROM agents ORDER BY name');
    const rows = stmt.all();
    stmt.finalize();
    return rows.map(rowToAgent);
  }

  set(agent: Agent): void {
    const row = agentToRow(agent);
    const params: Record<string, string | number> = {
      $name: row.name,
      $description: row.description,
      $runtime_type: row.runtime_type,
      $command: row.command,
      $args: row.args,
      $env: row.env,
      $container: row.container,
      $cwd: row.cwd,
      $streaming: row.streaming,
      $multi_turn: row.multi_turn,
      $created_at: row.created_at,
      $updated_at: row.updated_at,
    };
    const stmt = this.db.query(
      `INSERT INTO agents (name, description, runtime_type, command, args, env, container, cwd, streaming, multi_turn, created_at, updated_at)
       VALUES ($name, $description, $runtime_type, $command, $args, $env, $container, $cwd, $streaming, $multi_turn, $created_at, $updated_at)
       ON CONFLICT(name) DO UPDATE SET
         description = $description, runtime_type = $runtime_type, command = $command,
         args = $args, env = $env, container = $container, cwd = $cwd,
         streaming = $streaming, multi_turn = $multi_turn, updated_at = $updated_at`
    );
    stmt.run(params);
    stmt.finalize();
  }

  delete(name: string): boolean {
    const stmt = this.db.query('DELETE FROM agents WHERE name = $name');
    stmt.run({ $name: name });
    const changes = this.db.query('SELECT changes() as c').get() as { c: number };
    stmt.finalize();
    return changes.c > 0;
  }

  close(): void {
    this.db.close();
  }
}
