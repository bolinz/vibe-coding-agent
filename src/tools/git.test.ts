import { describe, expect, test } from 'bun:test';
import { GitTool } from './git';

describe('GitTool', () => {
  const tool = new GitTool();

  test('should reject non-allowed git filter-branch', async () => {
    const result = await tool.execute({
      command: 'filter-branch',
      dir: '/tmp'
    }) as { stdout: string; stderr: string; exitCode: number };

    expect(result.stderr).toContain('Git command not allowed');
  });

  test('should reject non-allowed git reflog', async () => {
    const result = await tool.execute({
      command: 'reflog',
      dir: '/tmp'
    }) as { stdout: string; stderr: string; exitCode: number };

    expect(result.stderr).toContain('Git command not allowed');
  });
});
