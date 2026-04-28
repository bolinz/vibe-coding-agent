import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

interface RPCRequest {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  id?: number;
}

interface RPCResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: { code: number; message: string };
  id: number;
}

interface RPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

type RPCHandler = (params: unknown) => Promise<unknown> | unknown;

export class SidecarRPC extends EventEmitter {
  private proc: ChildProcess | null = null;
  private pending = new Map<number, { resolve: (value: RPCResponse) => void; reject: (reason: Error) => void }>();
  private nextId = 1;
  private ready = false;
  private readyWaiters: Array<() => void> = [];
  private handlers = new Map<string, RPCHandler>();

  constructor(
    private command: string,
    private args: string[] = [],
    private env: Record<string, string> = {}
  ) {
    super();
  }

  registerMethod(method: string, handler: RPCHandler): void {
    this.handlers.set(method, handler);
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.proc = spawn(this.command, this.args, {
        env: { ...process.env, ...this.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (!this.proc.stdin || !this.proc.stdout) {
        reject(new Error('Failed to spawn sidecar'));
        return;
      }

      const proc = this.proc;

      proc.stdout!.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          this.handleLine(trimmed);
        }
      });

      proc.stderr!.on('data', (data: Buffer) => {
        console.error(`[Sidecar stderr] ${data.toString().trim()}`);
      });

      proc.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });

      proc.on('exit', (code) => {
        this.emit('exit', code);
      });

      // Wait for ready notification
      const checkReady = () => {
        if (this.ready) {
          resolve();
        } else {
          setTimeout(checkReady, 50);
        }
      };
      setTimeout(checkReady, 50);

      // Timeout after 10s
      setTimeout(() => {
        if (!this.ready) {
          reject(new Error('Sidecar ready timeout'));
        }
      }, 10000);
    });
  }

  stop(): void {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }

  async call<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    const req: RPCRequest = { jsonrpc: '2.0', method, params, id };

    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (resp: RPCResponse) => {
          if (resp.error) {
            reject(new Error(resp.error.message));
          } else {
            resolve(resp.result as T);
          }
        },
        reject,
      });

      this.send(req);
    });
  }

  notify(method: string, params?: unknown): void {
    const req: RPCNotification = { jsonrpc: '2.0', method, params };
    this.send(req);
  }

  private send(req: RPCRequest | RPCNotification | RPCResponse): void {
    if (!this.proc || !this.proc.stdin) return;
    const data = JSON.stringify(req) + '\n';
    this.proc.stdin.write(data);
  }

  private handleLine(line: string): void {
    try {
      const msg = JSON.parse(line) as (RPCResponse | RPCNotification | RPCRequest);

      // Handle request from sidecar (has method + id)
      if ('method' in msg && 'id' in msg && msg.id !== undefined && msg.id !== null) {
        this.handleRequest(msg as RPCRequest);
        return;
      }

      // Handle notification from sidecar (no id)
      if ('method' in msg && (!('id' in msg) || msg.id === undefined || msg.id === null)) {
        const notif = msg as RPCNotification;
        if (notif.method === 'ready') {
          this.ready = true;
          for (const waiter of this.readyWaiters) {
            waiter();
          }
          this.readyWaiters = [];
        }
        this.emit(notif.method, notif.params);
        return;
      }

      // Handle response to our call
      if ('id' in msg && msg.id !== undefined && msg.id !== null) {
        const resp = msg as RPCResponse;
        const pending = this.pending.get(resp.id);
        if (pending) {
          this.pending.delete(resp.id);
          pending.resolve(resp);
        }
      }
    } catch {
      // Ignore non-JSON lines (likely SDK log output mixed in stdout)
    }
  }

  private async handleRequest(req: RPCRequest): Promise<void> {
    const id = req.id!;
    const handler = this.handlers.get(req.method);
    if (!handler) {
      this.sendResponse(id, undefined, { code: -32601, message: `Method not found: ${req.method}` });
      return;
    }

    try {
      const result = await handler(req.params);
      console.log('[SidecarRPC] Response for', req.method, ':', JSON.stringify(result).substring(0, 200));
      this.sendResponse(id, result, undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SidecarRPC] Error handling', req.method, ':', message);
      this.sendResponse(id, undefined, { code: -32000, message });
    }
  }

  private sendResponse(id: number, result?: unknown, error?: { code: number; message: string }): void {
    const resp: RPCResponse = { jsonrpc: '2.0', id, result, error };
    this.send(resp);
  }

  isReady(): boolean {
    return this.ready;
  }
}
