/**
 * WebMCP bridge: exposes every registry tool to in-browser AI agents and keeps the exposed set
 * in sync with the registry (tools added/removed by features, tutorials or session teardown).
 *
 * Targeted API (WebMCP, W3C Web Machine Learning Community Group draft,
 * https://github.com/webmachinelearning/webmcp — spec source `index.bs`, explainer README;
 * checked 2026-10-29 through the GitHub copies because the rendered spec at
 * https://webmachinelearning.github.io/webmcp/ was not reachable from the build sandbox):
 *
 *   partial interface Document { readonly attribute ModelContext modelContext; }
 *   interface ModelContext : EventTarget {
 *     Promise<undefined> registerTool(ModelContextTool tool,
 *                                     optional ModelContextRegisterToolOptions options = {});
 *     …getTools(), executeTool(), ontoolchange (agent side; unused here)
 *   };
 *   dictionary ModelContextTool { required DOMString name; USVString title;
 *     required DOMString description; object inputSchema;
 *     required ToolExecuteCallback execute; ToolAnnotations annotations; };
 *   dictionary ToolAnnotations { boolean readOnlyHint = false; … };
 *   callback ToolExecuteCallback = Promise<any> (object input, ToolExecuteCallbackOptions options);
 *   dictionary ModelContextRegisterToolOptions { sequence<USVString> exposedTo; AbortSignal signal; };
 *   Unregistering = aborting the `signal` passed to registerTool. Duplicate names and names
 *   outside [A-Za-z0-9_.-]{1,128} reject with InvalidStateError; a disabled permission policy
 *   rejects with NotAllowedError. The execute result is JSON-serialized for the agent.
 *
 * Earlier drafts and polyfills (MCP-B, Chrome's first preview) used `navigator.modelContext`
 * with `registerTool(tool)` returning `{ unregister() }`, `unregisterTool(name)`,
 * `provideContext({ tools })` and `clearContext()`. Because the API is still moving, this
 * bridge feature-detects all of these defensively:
 *   1. `document.modelContext`, else `navigator.modelContext`;
 *   2. `registerTool` per tool (passing an AbortSignal, and also using a returned
 *      `unregister()` or `unregisterTool(name)` when present), else `provideContext` with the
 *      full list on every change (and `clearContext` on disconnect);
 *   3. absence or rejection is silent: Studio works the same without WebMCP.
 * Results use the MCP tool-result shape `{ content: [{ type: 'text', text }] }`, with
 * `isError: true` for failures (returned, not thrown, so the agent sees the message instead
 * of a generic "tool rejected").
 */
import type { JsonSchema } from '@studio/platform-contracts';
import type { StudioTool, ToolRegistry } from './registry';

export interface WebMcpToolResult {
  readonly content: ReadonlyArray<{ readonly type: 'text'; readonly text: string }>;
  readonly isError?: boolean;
}

export interface WebMcpTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly annotations: { readonly readOnlyHint: boolean };
  execute(input: unknown, options?: unknown): Promise<WebMcpToolResult>;
}

/** The subset of a ModelContext (any draft) this bridge can use; every member is optional. */
export interface ModelContextLike {
  registerTool?(tool: WebMcpTool, options?: { signal?: AbortSignal }): unknown;
  unregisterTool?(name: string): unknown;
  provideContext?(context: { tools: WebMcpTool[] }): unknown;
  clearContext?(): unknown;
}

interface WebMcpHost {
  readonly document?: { readonly modelContext?: unknown };
  readonly navigator?: { readonly modelContext?: unknown };
}

/** Finds a usable model context on `document` (current draft) or `navigator` (older drafts). */
export function findModelContext(
  host: WebMcpHost = globalThis as WebMcpHost,
): ModelContextLike | null {
  for (const candidate of [host.document?.modelContext, host.navigator?.modelContext]) {
    if (candidate && typeof candidate === 'object') {
      const ctx = candidate as ModelContextLike;
      if (typeof ctx.registerTool === 'function' || typeof ctx.provideContext === 'function')
        return ctx;
    }
  }
  return null;
}

function text(value: unknown): string {
  try {
    return JSON.stringify(value ?? null) ?? 'null';
  } catch {
    return String(value);
  }
}

/** Wraps a registry tool as a WebMCP tool that runs through `registry.call` (validation, events). */
export function toWebMcpTool(registry: ToolRegistry, tool: StudioTool<never>): WebMcpTool {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: { readOnlyHint: tool.readOnly === true },
    async execute(input: unknown) {
      try {
        const result = await registry.call(tool.name, input ?? {});
        return { content: [{ type: 'text', text: text(result) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: text({ error: message }) }], isError: true };
      }
    },
  };
}

/** Swallows synchronous throws and promise rejections from the host API. */
function quietly(fn: () => unknown): unknown {
  try {
    const result = fn();
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      (result as Promise<unknown>).then(undefined, () => undefined);
    }
    return result;
  } catch {
    return undefined;
  }
}

interface Registration {
  readonly tool: StudioTool<never>;
  readonly controller: AbortController;
  handle: unknown;
}

/** Exposes the registry on the page's model context (WebMCP) when present. */
export function connectWebMcp(
  registry: ToolRegistry,
  context: ModelContextLike | null = findModelContext(),
): () => void {
  if (!context) return () => undefined;
  const ctx = context;

  if (typeof ctx.registerTool !== 'function') {
    // provideContext-only drafts: replace the whole tool set on every change.
    const provide = () =>
      quietly(() =>
        ctx.provideContext?.({ tools: registry.list().map((t) => toWebMcpTool(registry, t)) }),
      );
    provide();
    const unsubscribe = registry.subscribe(provide);
    return () => {
      unsubscribe();
      if (typeof ctx.clearContext === 'function') quietly(() => ctx.clearContext?.());
      else quietly(() => ctx.provideContext?.({ tools: [] }));
    };
  }

  const registered = new Map<string, Registration>();

  const unregister = (name: string) => {
    const entry = registered.get(name);
    if (!entry) return;
    registered.delete(name);
    entry.controller.abort();
    const handle = entry.handle as { unregister?: () => unknown } | undefined;
    if (handle && typeof handle.unregister === 'function') quietly(() => handle.unregister?.());
    else if (typeof ctx.unregisterTool === 'function') quietly(() => ctx.unregisterTool?.(name));
  };

  const sync = () => {
    const current = new Map(registry.list().map((t) => [t.name, t]));
    for (const [name, entry] of [...registered]) {
      if (current.get(name) !== entry.tool) unregister(name);
    }
    for (const [name, tool] of current) {
      if (registered.has(name)) continue;
      const controller = new AbortController();
      const entry: Registration = { tool, controller, handle: undefined };
      registered.set(name, entry);
      entry.handle = quietly(() =>
        ctx.registerTool?.(toWebMcpTool(registry, tool), { signal: controller.signal }),
      );
      // Promise-returning drafts resolve to undefined; older ones may resolve to a handle.
      if (entry.handle && typeof (entry.handle as Promise<unknown>).then === 'function') {
        (entry.handle as Promise<unknown>).then(
          (handle) => {
            if (registered.get(name) === entry) entry.handle = handle;
            else if (
              handle &&
              typeof (handle as { unregister?: unknown }).unregister === 'function'
            )
              quietly(() => (handle as { unregister: () => unknown }).unregister());
          },
          () => {
            if (registered.get(name) === entry) registered.delete(name);
          },
        );
      }
    }
  };

  sync();
  const unsubscribe = registry.subscribe(sync);
  return () => {
    unsubscribe();
    for (const name of [...registered.keys()]) unregister(name);
  };
}
