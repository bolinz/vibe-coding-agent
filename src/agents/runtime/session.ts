import { spawn } from 'bun';
import type { Agent, StreamChunk } from '../types';
import type { RuntimeAdapter } from './types';

interface TmuxSession {
  name: string;
  agent: Agent;
}

/**
 * SessionRuntime — for interactive TUI tools that need a persistent process (aider)
 * Each session gets a dedicated tmux session.
 */
export class SessionRuntime implements RuntimeAdapter {
  readonly type = 'session' as const;

  private sessions = new Map<string, TmuxSession>();
  private readonly prefix = 'vca'; // vibe-coding-agent

  async start(sessionId: string, agent: Agent): Promise<void> {
    const tmuxName = this.tmuxName(sessionId);

    // Check if already exists
    const check = spawn(['tmux', 'has-session', '-t', tmuxName]);
    const exitCode = await check.exited;
    if (exitCode === 0) {
      // Already running
      this.sessions.set(sessionId, { name: tmuxName, agent });
      return;
    }

    // Create new tmux session with the target CLI
    const envVars = Object.entries(agent.config.env ?? {})
      .map(([k, v]) => `export ${k}=${this.shellEscape(v)}`)
      .join(' && ');

    const initCmd = [
      'tmux', 'new-session', '-d', '-s', tmuxName,
      `${envVars ? envVars + ' && ' : ''}cd ${this.shellEscape(agent.config.cwd ?? '/projects/sandbox')} && ${agent.config.command} ${(agent.config.args ?? []).join(' ')}`
    ];

    const proc = spawn(initCmd);
    const startExit = await proc.exited;
    if (startExit !== 0) {
      const err = await new Response(proc.stderr).text();
      throw new Error(`Failed to start tmux session: ${err}`);
    }

    // Wait for CLI to initialize
    await new Promise(resolve => setTimeout(resolve, 3000));

    this.sessions.set(sessionId, { name: tmuxName, agent });
  }

  async stop(_sessionId: string): Promise<void> {
    // Session persists until cleanup()
  }

  isRunning(sessionId: string): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;

    const check = spawn(['tmux', 'has-session', '-t', s.name]);
    // Synchronous check not possible with spawn, but we trust our map
    // In production, consider async health check
    return true;
  }

  async send(sessionId: string, message: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) {
      throw new Error(`Session not started: ${sessionId}`);
    }

    // Use tmux -l (literal) mode to avoid special key interpretation
    await Bun.spawn(['tmux', 'send-keys', '-l', '-t', s.name, message]);
    await Bun.spawn(['tmux', 'send-keys', '-t', s.name, 'Enter']);
  }

  async *read(sessionId: string): AsyncGenerator<StreamChunk> {
    const s = this.sessions.get(sessionId);
    if (!s) {
      yield { type: 'error', content: `Session not found: ${sessionId}` };
      return;
    }

    // Poll tmux pane for output
    const timeoutMs = 120000;
    const pollIntervalMs = 1000;
    const startTime = Date.now();

    let lastOutput = '';

    while (Date.now() - startTime < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

      try {
        const result = spawn(['tmux', 'capture-pane', '-t', s.name, '-p']);
        const output = await new Response(result.stdout).text();

        // Yield only new content since last read
        if (output.length > lastOutput.length) {
          const delta = output.slice(lastOutput.length);
          if (delta.trim()) {
            yield { type: 'text', content: delta };
          }
          lastOutput = output;
        }

        // Detect completion heuristic: prompt char or specific marker
        // Aider typically ends with '>'; customize per agent if needed
        const trimmed = output.trim();
        if (trimmed.endsWith('>') || trimmed.includes('Changes to commit')) {
          yield { type: 'done' };
          return;
        }
      } catch {
        // Ignore capture errors during polling
      }
    }

    yield { type: 'error', content: 'Session response timeout' };
  }

  async cancel(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;

    await Bun.spawn(['tmux', 'send-keys', '-t', s.name, 'C-c']);
  }

  async cleanup(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;

    try {
      await Bun.spawn(['tmux', 'kill-session', '-t', s.name]);
    } catch {
      // ignore if already killed
    }
    this.sessions.delete(sessionId);
  }

  private tmuxName(sessionId: string): string {
    return `${this.prefix}-${sessionId.substring(0, 8)}`;
  }

  private shellEscape(str: string): string {
    return str.replace(/'/g, "'\\''");
  }
}
