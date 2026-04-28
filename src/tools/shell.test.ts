import { describe, expect, test } from 'bun:test';
import { ShellTool } from './shell';

describe('ShellTool', () => {
  const tool = new ShellTool();

  test('should block dangerous rm -rf /', async () => {
    const result = await tool.execute({
      command: 'rm -rf /'
    }) as { stdout: string; stderr: string; exitCode: number };

    expect(result.stderr).toContain('[BLOCKED]');
    expect(result.exitCode).toBe(1);
  });

  test('should block shutdown commands', async () => {
    const result = await tool.execute({
      command: 'shutdown -h now'
    }) as { stdout: string; stderr: string; exitCode: number };

    expect(result.stderr).toContain('[BLOCKED]');
  });

  test('should block dd commands', async () => {
    const result = await tool.execute({
      command: 'dd if=/dev/zero of=/tmp/test'
    }) as { stdout: string; stderr: string; exitCode: number };

    expect(result.stderr).toContain('[BLOCKED]');
  });

  test('should reject non-allowed curl command', async () => {
    const result = await tool.execute({
      command: 'curl http://example.com'
    }) as { stdout: string; stderr: string; exitCode: number };

    expect(result.stderr).toContain('[BLOCKED]');
    expect(result.exitCode).toBe(1);
  });
});
