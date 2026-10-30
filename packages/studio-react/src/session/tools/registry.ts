/**
 * One registry of Studio capabilities ("tools"), shared by three consumers:
 *   - the AI assistant (sent to the model as function tools, executed locally),
 *   - WebMCP (registered on `navigator.modelContext` so browser agents can drive Studio),
 *   - tutorials (a step can wait for a tool to be called).
 * Tools never bypass the command layer: edits go through `session.history`, so everything a
 * tool does is undoable and autosaved like a user edit.
 */
import type { JsonSchema } from '@studio/platform-contracts';
import type { StudioSession } from '../studio-session';

/** Tool names follow the function-calling convention: ^[a-z][a-z0-9_]{0,63}$. */
export const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export interface ToolContext {
  readonly session: StudioSession;
}

export interface StudioTool<I = Record<string, unknown>> {
  readonly name: string;
  /** Short label for UI (chat transcript, tutorial hints). */
  readonly title: string;
  /** What it does and when to use it, written for a language model. */
  readonly description: string;
  /** JSON Schema with `type: 'object'` describing the input. */
  readonly inputSchema: JsonSchema;
  /** True when the tool only reads state (never edits the project or navigates). */
  readonly readOnly?: boolean;
  run(input: I, ctx: ToolContext): unknown;
}

export interface ToolCallEvent {
  readonly name: string;
  readonly input: unknown;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
}

export class ToolInputError extends Error {}

/** Minimal JSON-Schema validation for tool input (types, required, enum, ranges). */
export function validateToolInput(schema: JsonSchema, value: unknown, path = 'input'): string[] {
  const errors: string[] = [];
  const t = schema.type;
  if (t === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return [`${path} must be an object`];
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? [])
      if (obj[key] === undefined) errors.push(`${path}.${key} is required`);
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (obj[key] !== undefined)
        errors.push(...validateToolInput(sub, obj[key], `${path}.${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj))
        if (!schema.properties?.[key]) errors.push(`${path}.${key} is not allowed`);
    }
  } else if (t === 'array') {
    if (!Array.isArray(value)) return [`${path} must be an array`];
    if (schema.minItems !== undefined && value.length < schema.minItems)
      errors.push(`${path} needs at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      errors.push(`${path} allows at most ${schema.maxItems} items`);
    if (schema.items)
      value.forEach((v, i) => errors.push(...validateToolInput(schema.items!, v, `${path}[${i}]`)));
  } else if (t === 'number' || t === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return [`${path} must be a number`];
    if (t === 'integer' && !Number.isInteger(value)) errors.push(`${path} must be an integer`);
    if (schema.minimum !== undefined && value < schema.minimum)
      errors.push(`${path} must be ≥ ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum)
      errors.push(`${path} must be ≤ ${schema.maximum}`);
  } else if (t === 'string') {
    if (typeof value !== 'string') return [`${path} must be a string`];
  } else if (t === 'boolean') {
    if (typeof value !== 'boolean') return [`${path} must be a boolean`];
  }
  if (schema.enum && !schema.enum.includes(value as string | number)) {
    errors.push(`${path} must be one of ${schema.enum.join(', ')}`);
  }
  return errors;
}

export class ToolRegistry {
  private readonly tools = new Map<string, StudioTool<never>>();
  private readonly changeListeners = new Set<() => void>();
  private readonly callListeners = new Set<(event: ToolCallEvent) => void>();

  constructor(private readonly context: () => ToolContext) {}

  /** Adds a tool; returns a function that removes it. Names must be unique. */
  register<I>(tool: StudioTool<I>): () => void {
    if (!TOOL_NAME_PATTERN.test(tool.name)) throw new Error(`Invalid tool name "${tool.name}"`);
    if (this.tools.has(tool.name)) throw new Error(`Tool "${tool.name}" is already registered`);
    if (tool.inputSchema.type !== 'object')
      throw new Error(`Tool "${tool.name}" input must be an object schema`);
    this.tools.set(tool.name, tool as StudioTool<never>);
    this.emitChange();
    return () => {
      if (this.tools.get(tool.name) === (tool as StudioTool<never>)) {
        this.tools.delete(tool.name);
        this.emitChange();
      }
    };
  }

  list(): readonly StudioTool<never>[] {
    return [...this.tools.values()];
  }

  get(name: string): StudioTool<never> | undefined {
    return this.tools.get(name);
  }

  /** Validates input, runs the tool and notifies call listeners. Throws on failure. */
  async call(name: string, input: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      const error = `Unknown tool "${name}"`;
      this.emitCall({ name, input, ok: false, error });
      throw new ToolInputError(error);
    }
    const errors = validateToolInput(tool.inputSchema, input ?? {});
    if (errors.length > 0) {
      const error = errors.join('; ');
      this.emitCall({ name, input, ok: false, error });
      throw new ToolInputError(error);
    }
    try {
      const result = await tool.run((input ?? {}) as never, this.context());
      this.emitCall({ name, input, ok: true, result });
      return result;
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      this.emitCall({ name, input, ok: false, error });
      throw cause;
    }
  }

  /** Fires when tools are added or removed. */
  subscribe(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** Fires after every call (tutorial steps can advance on a tool call). */
  onCall(listener: (event: ToolCallEvent) => void): () => void {
    this.callListeners.add(listener);
    return () => this.callListeners.delete(listener);
  }

  private emitChange(): void {
    for (const l of [...this.changeListeners]) l();
  }

  private emitCall(event: ToolCallEvent): void {
    for (const l of [...this.callListeners]) l(event);
  }
}
