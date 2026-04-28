import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises';
import { resolve } from 'path';
import { BaseTool } from './base';

const SANDBOX_ROOT = process.env.SANDBOX_ROOT ?? '/projects/sandbox';

export class FileTool extends BaseTool {
  readonly name = 'file';
  readonly description = 'Read and write files in sandbox';

  private sanitizePath(filePath: string): string {
    // Prevent path traversal
    const resolved = resolve(SANDBOX_ROOT, filePath);
    if (!resolved.startsWith(SANDBOX_ROOT)) {
      throw new Error('Path outside sandbox not allowed');
    }
    return resolved;
  }

  async execute(args: Record<string, unknown>): Promise<unknown> {
    this.validateArgs(args, { operation: 'string' });

    const operation: string = args.operation as string;

    switch (operation) {
      case 'read': {
        const filePath: string = args.path as string;
        const content = await readFile(this.sanitizePath(filePath), 'utf-8');
        return { content };
      }

      case 'write': {
        const filePath: string = args.path as string;
        const content: string = args.content as string;
        await writeFile(this.sanitizePath(filePath), content, 'utf-8');
        return { success: true };
      }

      case 'list': {
        const dirPath: string = args.path as string;
        const entries = await readdir(this.sanitizePath(dirPath));
        return { entries };
      }

      case 'stat': {
        const filePath: string = args.path as string;
        const stats = await stat(this.sanitizePath(filePath));
        return {
          size: stats.size,
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
          mtime: stats.mtime.toISOString()
        };
      }

      case 'mkdir': {
        const dirPath: string = args.path as string;
        await mkdir(this.sanitizePath(dirPath), { recursive: true });
        return { success: true };
      }

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }
}
