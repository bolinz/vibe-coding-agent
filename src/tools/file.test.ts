import { describe, expect, test } from 'bun:test';
import { mkdir, writeFile, rm } from 'fs/promises';

// Set sandbox root before importing FileTool
process.env.SANDBOX_ROOT = '/tmp';

// Need to require to pick up env change
const { FileTool } = await import('./file');

const tool = new FileTool();

describe('FileTool', () => {
  test('should read file', async () => {
    await writeFile('/tmp/test-read.txt', 'Hello World');

    const result = await tool.execute({
      operation: 'read',
      path: 'test-read.txt'
    }) as { content: string };

    expect(result.content).toBe('Hello World');
  });

  test('should write file', async () => {
    await tool.execute({
      operation: 'write',
      path: 'test-write.txt',
      content: 'New content'
    });

    const result = await tool.execute({
      operation: 'read',
      path: 'test-write.txt'
    }) as { content: string };

    expect(result.content).toBe('New content');
  });

  test('should list directory', async () => {
    await writeFile('/tmp/test-list-1.txt', '');
    await writeFile('/tmp/test-list-2.txt', '');

    const result = await tool.execute({
      operation: 'list',
      path: '.'
    }) as { entries: string[] };

    expect(result.entries).toContain('test-list-1.txt');
    expect(result.entries).toContain('test-list-2.txt');
  });

  test('should get file stats', async () => {
    await writeFile('/tmp/test-stat.txt', 'Some content');

    const result = await tool.execute({
      operation: 'stat',
      path: 'test-stat.txt'
    }) as { size: number; isFile: boolean; isDirectory: boolean };

    expect(result.size).toBeGreaterThan(0);
    expect(result.isFile).toBe(true);
    expect(result.isDirectory).toBe(false);
  });

  test('should create directory', async () => {
    await tool.execute({
      operation: 'mkdir',
      path: 'test-newdir'
    });

    const result = await tool.execute({
      operation: 'stat',
      path: 'test-newdir'
    }) as { isDirectory: boolean };

    expect(result.isDirectory).toBe(true);
  });

  test('should reject path traversal', async () => {
    await expect(tool.execute({
      operation: 'read',
      path: '/etc/passwd'
    })).rejects.toThrow('Path outside sandbox not allowed');
  });

  test('should reject unknown operation', async () => {
    await expect(tool.execute({
      operation: 'unknown'
    })).rejects.toThrow('Unknown operation');
  });
});
