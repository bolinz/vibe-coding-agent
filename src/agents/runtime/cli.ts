import { spawn } from 'bun';
import type { Agent, StreamChunk } from '../types';
import type { RuntimeAdapter } from './types';

interface CLISession {
  proc: ReturnType<typeof spawn>;
  controller: AbortController;
  agent: Agent;
}

/**
 * CLIRuntime — for one-shot CLI tools (claude -p, codex, cline, hermes)
 * Each send() spawns a new process; read() collects stdout.
 */
export class CLIRuntime implements RuntimeAdapter {
  readonly type = 'cli' as const;

  private sessions = new Map<string, CLISession>();
  private agentMap = new Map<string, Agent>();

  async start(sessionId: string, agent: Agent): Promise<void> {
    // Stash agent config so send() can build the command later
    this.agentMap.set(sessionId, agent);
  }

  async stop(_sessionId: string): Promise<void> {
    // No-op: processes auto-exit when done
  }

  isRunning(sessionId: string): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    return !(s.proc as unknown as { killed?: boolean }).killed;
  }

  async send(sessionId: string, message: string): Promise<void> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      try {
        existing.controller.abort();
        (existing.proc as unknown as { kill?: () => void }).kill?.();
      } catch {
        // ignore
      }
      this.sessions.delete(sessionId);
    }

    const agent = this.agentMap.get(sessionId);
    if (!agent) {
      throw new Error(`Agent config not set for session ${sessionId}. Call start() first.`);
    }

    const controller = new AbortController();
    // Support {message} placeholder in args for tools that need message at a specific position
    const args = (agent.config.args ?? []).map((arg) =>
      arg === '{message}' ? message : arg
    );
    // If no placeholder was used, append message at the end (default behavior)
    const hasPlaceholder = (agent.config.args ?? []).includes('{message}');
    const cmd = hasPlaceholder
      ? [agent.config.command, ...args]
      : [agent.config.command, ...args, message];

    try {
      const proc = spawn({
        cmd,
        env: { ...process.env, ...(agent.config.env ?? {}) },
        cwd: agent.config.cwd,
        stdout: 'pipe',
        stderr: 'pipe',
        signal: controller.signal,
      });

      this.sessions.set(sessionId, { proc, controller, agent });
    } catch (err) {
      // Spawn failed (e.g. ENOENT). Store a sentinel so read() can yield the error.
      const errorMsg = err instanceof Error ? err.message : String(err);
      const sentinel = spawn({ cmd: ['echo', ''], stdout: 'pipe', stderr: 'pipe' });
      this.sessions.set(sessionId, {
        proc: sentinel,
        controller,
        agent: { ...agent, capabilities: { ...agent.capabilities, streaming: false } },
      });
      // We will yield the error in read() instead of here
      (this.sessions.get(sessionId) as CLISession & { _spawnError?: string })._spawnError = errorMsg;
    }
  }

  async *read(sessionId: string): AsyncGenerator<StreamChunk> {
    const s = this.sessions.get(sessionId);
    if (!s) {
      yield { type: 'error', content: `No active CLI session: ${sessionId}` };
      return;
    }

    // Check for spawn-time error
    const spawnError = (s as CLISession & { _spawnError?: string })._spawnError;
    if (spawnError) {
      yield { type: 'error', content: spawnError };
      yield { type: 'done' };
      this.sessions.delete(sessionId);
      return;
    }

    const { proc, agent } = s;

    if (agent.capabilities.streaming) {
      const stdout = proc.stdout as ReadableStream<Uint8Array> | undefined;
      if (stdout) {
        const reader = stdout.getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            if (text) yield { type: 'text', content: text };
          }
        } finally {
          reader.releaseLock();
        }
      }
    } else {
      const stdout = proc.stdout as ReadableStream<Uint8Array> | undefined;
      const stderr = proc.stderr as ReadableStream<Uint8Array> | undefined;

      const stdoutText = stdout ? await new Response(stdout).text() : '';
      const stderrText = stderr ? await new Response(stderr).text() : '';
      const exitCode = await proc.exited;

      // Some CLIs (e.g. hermes) output errors to stdout with non-zero exit code.
      // Prefer stdout if it has content; otherwise use stderr.
      const outputText = stdoutText.trim() || stderrText.trim();

      if (exitCode !== 0 && outputText) {
        yield { type: 'error', content: outputText };
      } else if (outputText) {
        yield { type: 'text', content: outputText };
      }
    }

    yield { type: 'done' };
    this.sessions.delete(sessionId);
  }

  async cancel(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;

    s.controller.abort();
    try {
      (s.proc as unknown as { kill?: () => void }).kill?.();
    } catch {
      // ignore
    }
    this.sessions.delete(sessionId);
  }

  async cleanup(sessionId: string): Promise<void> {
    await this.cancel(sessionId);
    this.agentMap.delete(sessionId);
  }
}
