import { spawn } from 'bun';
import type { Agent, ContainerConfig, StreamChunk } from '../types';
import type { RuntimeAdapter } from './types';
import { ConfigManager } from '../../core/config';

export function buildContainerRunArgs(
  containerCmd: string,
  cc: ContainerConfig,
  agentCmd: string,
  agentArgs: string[],
  message: string,
  workingDir?: string,
  agentCwd?: string,
): string[] {
  const cmd = cc.cmd || containerCmd;
  const workDir = cc.workDir || '/workspace';
  const hostWorkDir = workingDir || agentCwd || process.cwd();

  const args: string[] = [cmd, 'run', '--rm', '-i'];

  args.push('-v', `${hostWorkDir}:${workDir}`);
  args.push('-w', workDir);

  if (cc.memory) {
    args.push('--memory', cc.memory);
  }
  if (cc.cpu) {
    args.push('--cpus', cc.cpu);
  }
  if (cc.networkDisabled) {
    args.push('--network', 'none');
  }

  args.push(cc.image);
  args.push(agentCmd);

  const substitutedArgs = agentArgs.map((a) => a === '{message}' ? message : a);
  args.push(...substitutedArgs);

  if (!agentArgs.includes('{message}')) {
    args.push(message);
  }

  return args;
}

interface ContainerSession {
  proc: ReturnType<typeof spawn>;
  controller: AbortController;
  agent: Agent;
  workingDir?: string;
}

export class ContainerRuntime implements RuntimeAdapter {
  readonly type = 'container' as const;

  private sessions = new Map<string, ContainerSession>();
  private agentMap = new Map<string, { agent: Agent; workingDir?: string }>();

  async start(sessionId: string, agent: Agent, workingDir?: string): Promise<void> {
    this.agentMap.set(sessionId, { agent, workingDir });
  }

  async stop(_sessionId: string): Promise<void> {
    // No-op: containers auto-exit when done
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

    const entry = this.agentMap.get(sessionId);
    if (!entry) {
      throw new Error(`Container agent not initialized for session ${sessionId}. Call start() first.`);
    }

    const { agent, workingDir } = entry;
    const cc = agent.config.container;
    if (!cc) {
      throw new Error(`Agent ${agent.name} has no container config.`);
    }

    const config = await this.getContainerCmd();
    const controller = new AbortController();

    const dockerArgs = buildContainerRunArgs(
      config.cmd,
      cc,
      agent.config.command,
      agent.config.args ?? [],
      message,
      workingDir,
      agent.config.cwd,
    );

    try {
      const proc = spawn({
        cmd: dockerArgs,
        env: { ...process.env, ...(agent.config.env ?? {}) },
        stdout: 'pipe',
        stderr: 'pipe',
        signal: controller.signal,
      });

      this.sessions.set(sessionId, { proc, controller, agent, workingDir });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const sentinel = spawn({ cmd: ['echo', ''], stdout: 'pipe', stderr: 'pipe' });
      this.sessions.set(sessionId, {
        proc: sentinel,
        controller,
        agent: { ...agent, capabilities: { ...agent.capabilities, streaming: false } },
        workingDir,
      });
      (this.sessions.get(sessionId) as ContainerSession & { _spawnError?: string })._spawnError = errorMsg;
    }
  }

  async *read(sessionId: string): AsyncGenerator<StreamChunk> {
    const s = this.sessions.get(sessionId);
    if (!s) {
      yield { type: 'error', content: `No active container session: ${sessionId}` };
      return;
    }

    const spawnError = (s as ContainerSession & { _spawnError?: string })._spawnError;
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
  }

  // ---- private ----

  private async getContainerCmd(): Promise<{ cmd: string }> {
    const cm = new ConfigManager();
    const cmd = cm.get('container_cmd') || 'docker';
    return { cmd };
  }
}
