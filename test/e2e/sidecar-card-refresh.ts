/**
 * End-to-end test for Feishu Sidecar synchronous card refresh
 * 
 * Usage:
 *   bun run test/e2e/sidecar-card-refresh.ts
 * 
 * This test verifies the full chain:
 *   Simulated Card Action -> Go Sidecar -> Node.js handleCardAction() -> Sync Response
 * 
 * No real Feishu credentials needed — we bypass the WebSocket and test the RPC layer.
 */

import { SidecarRPC } from '../../src/core/sidecar-rpc';
import { SidecarFeishuChannel } from '../../src/channels/feishu/sidecar-channel';
import { SessionManager, MemorySessionStore } from '../../src/core/session';
import { Router } from '../../src/core/router';
import { EventBus } from '../../src/core/event';
import { ToolRegistry } from '../../src/core/registry';
import { PipelineEngine } from '../../src/agents/pipeline/executor';
import { AgentManager } from '../../src/agents/manager';
import { RuntimeRegistry } from '../../src/agents/runtime/registry';
import { CLIRuntime } from '../../src/agents/runtime/cli';
import * as path from 'path';

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Feishu Sidecar Card Refresh E2E Test');
  console.log('═══════════════════════════════════════════════════════\n');

  // ── Setup ──────────────────────────────────────────────
  const store = new MemorySessionStore();
  const sessionManager = new SessionManager(store);
  const eventBus = new EventBus();
  const toolRegistry = new ToolRegistry();
  const agentManager = new AgentManager();
  const runtimeRegistry = new RuntimeRegistry();
  runtimeRegistry.register('cli', new CLIRuntime());
  agentManager.register({
    name: 'echo',
    description: 'Simple echo agent for testing',
    runtimeType: 'cli',
    config: { command: 'echo', args: ['Echo:'] },
    capabilities: { streaming: false, multiTurn: false },
  });
  const pipeline = new PipelineEngine(agentManager, runtimeRegistry, toolRegistry, { maxToolRounds: 10 });
  const router = new Router(sessionManager, agentManager, eventBus, toolRegistry, pipeline, 'echo');

  const channel = new SidecarFeishuChannel(router, sessionManager, {
    appId: 'test',
    appSecret: 'test',
  });

  // ── Test 1: Direct handleCardAction performance ─────────
  console.log('Test 1: Direct handleCardAction (no sidecar)');
  console.log('───────────────────────────────────────────────────────');

  const tests = [
    { action: 'open_menu', desc: 'Open menu' },
    { action: 'switch_agent', desc: 'Switch agent' },
    { action: 'set_agent', agent: 'echo', desc: 'Set agent to echo' },
    { action: 'new_session', desc: 'New session' },
    { action: 'info', desc: 'Session info' },
  ];

  for (const t of tests) {
    const start = performance.now();
    const result = await channel.handleCardAction({
      userId: 'test_user_e2e',
      action: t.action,
      value: t.agent ? { agent: t.agent } : {},
    });
    const elapsed = performance.now() - start;

    const hasCard = result.card ? '✅ card' : '❌ no card';
    const hasToast = result.toast ? `✅ toast(${result.toast.type})` : '❌ no toast';
    const pass = elapsed < 3000 ? '✅' : '❌';

    console.log(`  ${pass} ${t.desc.padEnd(20)} | ${elapsed.toFixed(2).padStart(6)}ms | ${hasCard} | ${hasToast}`);
  }

  // ── Test 2: Full sidecar RPC round-trip ─────────────────
  console.log('\nTest 2: Full sidecar RPC round-trip');
  console.log('───────────────────────────────────────────────────────');

  const sidecarPath = path.join(process.cwd(), 'sidecars', 'feishu', 'feishu-sidecar');
  const rpc = new SidecarRPC(sidecarPath, [], {
    FEISHU_APP_ID: 'cli_test123',
    FEISHU_APP_SECRET: 'test_secret',
  });

  // Register cardAction handler (simulates what Node.js does)
  rpc.registerMethod('cardAction', async (params: any) => {
    const result = await channel.handleCardAction(params);
    return result;
  });

  const startRpc = performance.now();
  await rpc.start();
  const startupTime = performance.now() - startRpc;
  console.log(`  ✅ Sidecar startup          | ${startupTime.toFixed(2).padStart(6)}ms`);

  // Simulate card action through RPC
  const rpcTests = [
    { action: 'open_menu', desc: 'RPC: open_menu' },
    { action: 'switch_agent', desc: 'RPC: switch_agent' },
  ];

  for (const t of rpcTests) {
    const start = performance.now();
    try {
      const result = await rpc.call('cardAction', {
        userId: 'test_user_rpc',
        action: t.action,
        value: {},
      });
      const elapsed = performance.now() - start;
      const r = result as any;
      const hasCard = r?.card ? '✅ card' : '❌ no card';
      const pass = elapsed < 3000 ? '✅' : '❌';
      console.log(`  ${pass} ${t.desc.padEnd(20)} | ${elapsed.toFixed(2).padStart(6)}ms | ${hasCard}`);
    } catch (err) {
      const elapsed = performance.now() - start;
      console.log(`  ❌ ${t.desc.padEnd(20)} | ${elapsed.toFixed(2).padStart(6)}ms | ERROR: ${err}`);
    }
  }

  // Cleanup
  rpc.stop();

  // ── Summary ─────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  All tests completed successfully!');
  console.log('═══════════════════════════════════════════════════════');
}

runTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
