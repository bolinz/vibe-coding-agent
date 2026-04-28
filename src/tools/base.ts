import type { Tool } from '../core/types';

export abstract class BaseTool implements Tool {
  abstract readonly name: string;
  abstract readonly description: string;

  abstract execute(args: Record<string, unknown>): Promise<unknown>;

  protected validateArgs(args: Record<string, unknown>, schema: Record<string, string>): void {
    for (const [key, type] of Object.entries(schema)) {
      if (args[key] === undefined) {
        throw new Error(`Missing required argument: ${key}`);
      }
      if (typeof args[key] !== type) {
        throw new Error(`Invalid type for ${key}: expected ${type}, got ${typeof args[key]}`);
      }
    }
  }
}
