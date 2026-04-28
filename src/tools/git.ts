import { spawn } from 'bun';
import { BaseTool } from './base';

interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class GitTool extends BaseTool {
  readonly name = 'git';
  readonly description = 'Execute git commands';

  private allowedCommands = ['status', 'log', 'diff', 'add', 'commit', 'checkout', 'branch', 'pull', 'push', 'fetch', 'clone'];

  async execute(args: Record<string, unknown>): Promise<GitResult> {
    this.validateArgs(args, { command: 'string' });

    const subcommand: string = args.command as string;
    const gitDir: string = (args.dir as string) ?? '/projects/sandbox';

    // Validate subcommand
    const cmdName = subcommand.split(/\s+/)[0];
    if (!this.allowedCommands.includes(cmdName)) {
      return {
        stdout: '',
        stderr: `Git command not allowed: ${cmdName}`,
        exitCode: 1
      };
    }

    return new Promise((resolve) => {
      const proc = spawn({
        cmd: ['git', '-C', gitDir, ...subcommand.split(/\s+/)],
        stdout: 'pipe',
        stderr: 'pipe'
      });

      Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text()
      ]).then(([stdout, stderr]) => {
        proc.exited.then((exitCode) => {
          resolve({ stdout, stderr, exitCode });
        });
      });
    });
  }
}
