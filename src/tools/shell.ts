import { spawn } from 'bun';
import { BaseTool } from './base';

interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class ShellTool extends BaseTool {
  readonly name = 'shell';
  readonly description = 'Execute shell commands in sandbox';

  private allowedCommands = ['ls', 'cat', 'grep', 'find', 'echo', 'pwd', 'mkdir', 'touch', 'git', 'vim', 'nano', 'python3', 'node'];
  private deniedPatterns = [
    /rm\s+-rf\s+\//,
    /shutdown|reboot|halt/,
    /dd\s+/,
    /mkfs/,
    /fdisk/
  ];

  async execute(args: Record<string, unknown>): Promise<ShellResult> {
    this.validateArgs(args, { command: 'string' });

    const command: string = args.command as string;

    // Security check: deny dangerous patterns
    for (const pattern of this.deniedPatterns) {
      if (pattern.test(command)) {
        return {
          stdout: '',
          stderr: '[BLOCKED] Dangerous command detected',
          exitCode: 1
        };
      }
    }

    // Security check: validate command
    const cmdName = command.split(/\s+/)[0];
    if (!this.allowedCommands.includes(cmdName)) {
      return {
        stdout: '',
        stderr: `[BLOCKED] Command not allowed: ${cmdName}`,
        exitCode: 1
      };
    }

    return new Promise((resolve) => {
      const proc = spawn(command.split(' '), {
        cwd: (args.cwd as string) ?? '/projects/sandbox',
        stdout: 'pipe',
        stderr: 'pipe'
      });

      const timeout = setTimeout(() => {
        proc.kill();
        resolve({
          stdout: '',
          stderr: 'Command timeout',
          exitCode: 124
        });
      }, (args.timeout as number) ?? 30000);

      Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text()
      ]).then(([stdout, stderr]) => {
        clearTimeout(timeout);
        proc.exited.then((exitCode) => {
          resolve({ stdout, stderr, exitCode });
        });
      });
    });
  }
}
