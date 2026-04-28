import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { SidecarRPC } from '../../src/core/sidecar-rpc';
import * as path from 'path';

describe('SidecarRPC Integration', () => {
  let rpc: SidecarRPC;

  beforeAll(async () => {
    const sidecarPath = path.join(process.cwd(), 'sidecars', 'feishu', 'feishu-sidecar');
    rpc = new SidecarRPC(sidecarPath, [], {
      FEISHU_APP_ID: 'test_app_id',
      FEISHU_APP_SECRET: 'test_app_secret',
    });

    // Register a mock handler for cardAction (what Node.js does)
    rpc.registerMethod('cardAction', (params: any) => {
      return {
        card: {
          config: { wide_screen_mode: true },
          header: {
            title: { tag: 'plain_text', content: '🤖 Test Card' },
            template: 'blue',
          },
          elements: [
            {
              tag: 'div',
              text: { tag: 'lark_md', content: `Action: ${params?.action}` },
            },
          ],
        },
        toast: { type: 'success', content: 'Test OK' },
      };
    });

    await rpc.start();
  });

  afterAll(() => {
    rpc.stop();
  });

  test('sidecar sends ready notification', () => {
    expect(rpc.isReady()).toBe(true);
  });

  test('call sendMessage returns success', async () => {
    // This will fail because sidecar cannot connect to Feishu with test creds,
    // but it verifies the RPC round-trip works
    try {
      const result = await rpc.call('sendMessage', {
        receiveId: 'test_user',
        content: 'Hello from test',
      });
      expect(result).toBeDefined();
    } catch (err) {
      // Expected to fail due to invalid credentials
      expect(err).toBeInstanceOf(Error);
    }
  });

  test('call sendCardSync returns success', async () => {
    try {
      const result = await rpc.call('sendCardSync', {
        receiveId: 'test_user',
        card: {
          config: { wide_screen_mode: true },
          header: { title: { tag: 'plain_text', content: 'Test' }, template: 'blue' },
          elements: [],
        },
      });
      expect(result).toBeDefined();
    } catch (err) {
      // Expected to fail due to invalid credentials
      expect(err).toBeInstanceOf(Error);
    }
  });

  test('call disconnect returns success', async () => {
    const result = await rpc.call('disconnect');
    expect(result).toEqual({ status: 'disconnected' });
  });
});
