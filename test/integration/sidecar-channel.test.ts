import { describe, test, expect, beforeAll } from 'bun:test';
import { SidecarFeishuChannel } from '../../src/channels/feishu/sidecar-channel';
import { SessionManager, MemorySessionStore } from '../../src/core/session';
import { Router } from '../../src/core/router';
import { EventBus } from '../../src/core/event';
import { ToolRegistry } from '../../src/core/registry';
import { AgentManager } from '../../src/agents/manager';
import { RuntimeRegistry } from '../../src/agents/runtime/registry';
import { CLIRuntime } from '../../src/agents/runtime/cli';
import { PipelineEngine } from '../../src/agents/pipeline/executor';

describe('SidecarFeishuChannel Integration', () => {
  let channel: SidecarFeishuChannel;
  let sessionManager: SessionManager;

  beforeAll(async () => {
    const store = new MemorySessionStore();
    sessionManager = new SessionManager(store);
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

    const pipeline = new PipelineEngine(agentManager, runtimeRegistry, toolRegistry);
    const router = new Router(sessionManager, agentManager, eventBus, toolRegistry, pipeline, 'echo');

    channel = new SidecarFeishuChannel(router, sessionManager, {
      appId: 'test',
      appSecret: 'test',
    });
  });

  test('handleCardAction - open_menu returns menu card within 3s', async () => {
    const start = performance.now();
    const result = await channel.handleCardAction({
      userId: 'test_user',
      action: 'open_menu',
      value: {},
    });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(3000);
    expect(result.card).toBeDefined();
    expect(result.card?.header).toBeDefined();
    expect(result.toast?.type).toBe('info');
  });

  test('handleCardAction - switch_agent returns agent select card', async () => {
    const result = await channel.handleCardAction({
      userId: 'test_user',
      action: 'switch_agent',
      value: {},
    });

    expect(result.card).toBeDefined();
    expect(result.card?.header?.title?.content).toContain('切换 Agent');
  });

  test('handleCardAction - set_agent switches agent and returns menu', async () => {
    // First create a session
    await sessionManager.create('test_user', 'echo', {}, 'test_user');

    const result = await channel.handleCardAction({
      userId: 'test_user',
      action: 'set_agent',
      value: { agent: 'echo' },
    });

    expect(result.card).toBeDefined();
    expect(result.toast?.type).toBe('success');

    const session = await sessionManager.getByUserId('test_user');
    expect(session?.agentType).toBe('echo');
  });

  test('handleCardAction - new_session creates new session', async () => {
    const result = await channel.handleCardAction({
      userId: 'test_user_2',
      action: 'new_session',
      value: {},
    });

    expect(result.card).toBeDefined();
    expect(result.toast?.type).toBe('success');
  });
});
