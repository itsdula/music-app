import { describe, expect, it, vi } from 'vitest';
import type { StudioSession } from '../src/session/studio-session';
import { ToolRegistry, type StudioTool } from '../src/session/tools/registry';
import {
  connectWebMcp,
  findModelContext,
  type ModelContextLike,
  type WebMcpTool,
} from '../src/session/tools/webmcp';

function createRegistry() {
  return new ToolRegistry(() => ({ session: {} as StudioSession }));
}

const echo: StudioTool<{ text: string }> = {
  name: 'echo',
  title: 'Echo',
  description: 'Returns the text it was given.',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  readOnly: true,
  run: ({ text }) => ({ echoed: text }),
};

const boom: StudioTool = {
  name: 'boom',
  title: 'Boom',
  description: 'Always fails.',
  inputSchema: { type: 'object', properties: {} },
  run: () => {
    throw new Error('Kaboom');
  },
};

/** Current-draft fake: registerTool(tool, { signal }) → Promise<undefined>; abort unregisters. */
function createSignalContext() {
  const tools = new Map<string, WebMcpTool>();
  const context: ModelContextLike = {
    registerTool: vi.fn((tool: WebMcpTool, options?: { signal?: AbortSignal }) => {
      if (tools.has(tool.name)) return Promise.reject(new DOMException('dup', 'InvalidStateError'));
      tools.set(tool.name, tool);
      options?.signal?.addEventListener('abort', () => tools.delete(tool.name));
      return Promise.resolve(undefined);
    }),
  };
  return { context, tools };
}

describe('WebMCP bridge', () => {
  it('feature-detects document.modelContext first, then navigator.modelContext', () => {
    const doc = { registerTool: () => undefined };
    const nav = { provideContext: () => undefined };
    expect(
      findModelContext({ document: { modelContext: doc }, navigator: { modelContext: nav } }),
    ).toBe(doc);
    expect(findModelContext({ navigator: { modelContext: nav } })).toBe(nav);
    expect(findModelContext({ navigator: { modelContext: {} } })).toBeNull();
    expect(findModelContext({})).toBeNull();
  });

  it('does nothing (and does not throw) without a model context', () => {
    const registry = createRegistry();
    registry.register(echo);
    const disconnect = connectWebMcp(registry, null);
    expect(() => disconnect()).not.toThrow();
  });

  it('registers every tool with schema and read-only hint, and returns MCP text content', async () => {
    const registry = createRegistry();
    registry.register(echo);
    registry.register(boom);
    const { context, tools } = createSignalContext();
    connectWebMcp(registry, context);
    expect([...tools.keys()]).toEqual(['echo', 'boom']);
    const tool = tools.get('echo')!;
    expect(tool).toMatchObject({
      title: 'Echo',
      description: 'Returns the text it was given.',
      inputSchema: echo.inputSchema,
      annotations: { readOnlyHint: true },
    });
    await expect(tool.execute({ text: 'hi' })).resolves.toEqual({
      content: [{ type: 'text', text: '{"echoed":"hi"}' }],
    });
    await expect(tool.execute({})).resolves.toEqual({
      content: [{ type: 'text', text: '{"error":"input.text is required"}' }],
      isError: true,
    });
    await expect(tools.get('boom')!.execute({})).resolves.toMatchObject({
      content: [{ type: 'text', text: '{"error":"Kaboom"}' }],
      isError: true,
    });
  });

  it('runs calls through the registry so tutorials see them', async () => {
    const registry = createRegistry();
    registry.register(echo);
    const calls: string[] = [];
    registry.onCall((e) => calls.push(`${e.name}:${e.ok}`));
    const { context, tools } = createSignalContext();
    connectWebMcp(registry, context);
    await tools.get('echo')!.execute({ text: 'x' });
    expect(calls).toEqual(['echo:true']);
  });

  it('keeps registrations in sync with the registry and cleans up on disconnect', () => {
    const registry = createRegistry();
    const { context, tools } = createSignalContext();
    const disconnect = connectWebMcp(registry, context);
    expect(tools.size).toBe(0);
    const removeEcho = registry.register(echo);
    registry.register(boom);
    expect([...tools.keys()]).toEqual(['echo', 'boom']);
    removeEcho();
    expect([...tools.keys()]).toEqual(['boom']);
    registry.register(echo);
    expect([...tools.keys()].sort()).toEqual(['boom', 'echo']);
    expect(context.registerTool).toHaveBeenCalledTimes(3);
    disconnect();
    expect(tools.size).toBe(0);
    registry.register({ ...echo, name: 'late' });
    expect(tools.size).toBe(0);
  });

  it('supports older drafts: registerTool returning { unregister } or unregisterTool(name)', () => {
    const registry = createRegistry();
    registry.register(echo);
    const unregisterHandle = vi.fn();
    const legacy: ModelContextLike = {
      registerTool: vi.fn(() => ({ unregister: unregisterHandle })),
    };
    connectWebMcp(registry, legacy)();
    expect(unregisterHandle).toHaveBeenCalledTimes(1);

    const unregisterTool = vi.fn();
    const named: ModelContextLike = { registerTool: vi.fn(() => undefined), unregisterTool };
    connectWebMcp(registry, named)();
    expect(unregisterTool).toHaveBeenCalledWith('echo');
  });

  it('falls back to provideContext with the full tool list on every change', () => {
    const registry = createRegistry();
    registry.register(echo);
    const provided: string[][] = [];
    const clearContext = vi.fn();
    const ctx: ModelContextLike = {
      provideContext: ({ tools }) => provided.push(tools.map((t) => t.name)),
      clearContext,
    };
    const disconnect = connectWebMcp(registry, ctx);
    registry.register(boom);
    expect(provided).toEqual([['echo'], ['echo', 'boom']]);
    disconnect();
    expect(clearContext).toHaveBeenCalledTimes(1);
  });

  it('ignores host errors (permission policy, duplicates) silently', async () => {
    const registry = createRegistry();
    registry.register(echo);
    const ctx: ModelContextLike = {
      registerTool: () => Promise.reject(new DOMException('blocked', 'NotAllowedError')),
      unregisterTool: () => {
        throw new Error('nope');
      },
    };
    const disconnect = connectWebMcp(registry, ctx);
    await Promise.resolve();
    expect(() => disconnect()).not.toThrow();
    const throwing: ModelContextLike = {
      registerTool: () => {
        throw new Error('sync failure');
      },
    };
    expect(() => connectWebMcp(registry, throwing)()).not.toThrow();
  });
});
