/**
 * The assistant conversation loop, independent of React:
 *   user message → model turn (system prompt + history + registry tools) → run the returned
 *   tool calls one by one through `session.tools.call` → feed results back → repeat until the
 *   model answers without tool calls or the step limit is reached.
 * State lives in a vanilla Zustand store for the panel. Transcripts are kept per project in
 * memory for the lifetime of the session (never persisted).
 */
import type {
  AssistantErrorCode,
  AssistantMessage,
  AssistantResponse,
  AssistantToolCall,
  AssistantTransport,
} from '@studio/platform-contracts';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { StudioSession } from '../../session/studio-session';
import { buildSystemPrompt, toolDefinitions } from './system-prompt';

export type ToolCallStatus = 'running' | 'ok' | 'error' | 'skipped';

export type TranscriptItem =
  | { readonly id: string; readonly kind: 'user'; readonly text: string }
  | { readonly id: string; readonly kind: 'assistant'; readonly text: string }
  | {
      readonly id: string;
      readonly kind: 'tool';
      readonly name: string;
      readonly title: string;
      readonly input: unknown;
      readonly status: ToolCallStatus;
      readonly result?: unknown;
      readonly error?: string;
      /** Plain-language note when the call removed or replaced data. */
      readonly deleted?: string;
    }
  | {
      readonly id: string;
      readonly kind: 'notice';
      readonly text: string;
      readonly tone: 'info' | 'warning';
    };

export type ConversationErrorCode = AssistantErrorCode | 'unknown';

export interface ConversationError {
  readonly code: ConversationErrorCode;
  readonly message: string;
}

export interface ConversationState {
  readonly items: readonly TranscriptItem[];
  readonly status: 'idle' | 'running';
  readonly error: ConversationError | null;
}

export interface ConversationOptions {
  readonly session: StudioSession;
  /** Resolved on every turn so a host can attach a transport later. */
  readonly transport: () => AssistantTransport | undefined;
  /** Maximum model turns per user message. Default 12. */
  readonly maxSteps?: number;
  readonly model?: string;
  /** Called when a turn ends (before the status returns to idle). */
  readonly onSettled?: () => void;
}

export const NOT_CONFIGURED_MESSAGE =
  "The AI assistant isn't configured on this server: set OPENROUTER_API_KEY";

const ERROR_CODES: readonly AssistantErrorCode[] = [
  'not-configured',
  'unauthorized',
  'rate-limited',
  'bad-request',
  'provider-error',
  'network',
];

const ERROR_MESSAGES: Record<ConversationErrorCode, string> = {
  'not-configured': NOT_CONFIGURED_MESSAGE,
  unauthorized: 'The AI provider rejected the server’s API key. Check the key and try again.',
  'rate-limited': 'The AI provider is rate-limiting requests. Wait a moment, then retry.',
  'bad-request': 'The AI provider could not process this request.',
  'provider-error': 'The AI provider returned an error. Try again in a moment.',
  network: 'Could not reach the assistant server. Check your connection and retry.',
  unknown: 'Something went wrong while talking to the assistant.',
};

/** Tool results larger than this are truncated before they go back to the model. */
const MAX_TOOL_RESULT_CHARS = 16_000;

class AbortedError extends Error {}

function errorCode(error: unknown): ConversationErrorCode {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && (ERROR_CODES as readonly string[]).includes(code)
    ? (code as AssistantErrorCode)
    : 'unknown';
}

/** Turns a transport failure into a message for the transcript. */
export function describeAssistantError(error: unknown): ConversationError {
  const code = errorCode(error);
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (code === 'not-configured') return { code, message: NOT_CONFIGURED_MESSAGE };
  const base = ERROR_MESSAGES[code];
  return { code, message: detail && detail !== base ? `${base} (${detail})` : base };
}

function stringifyResult(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value ?? { ok: true }) ?? '{"ok":true}';
  } catch {
    text = String(value);
  }
  return text.length > MAX_TOOL_RESULT_CHARS
    ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}… (truncated)`
    : text;
}

/** Plain-language summary of data a tool call removed, for the transcript. */
export function describeDeletion(name: string, result: unknown): string | undefined {
  const r = (result ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'delete_track': {
      const d = (r.deleted ?? {}) as { name?: string; clipsDeleted?: number };
      const clips = d.clipsDeleted ?? 0;
      return `Deleted track “${d.name ?? '?'}”${clips ? ` and its ${clips} clip${clips === 1 ? '' : 's'}` : ''}.`;
    }
    case 'delete_clips': {
      const d = Array.isArray(r.deleted) ? (r.deleted as Array<{ name?: string }>) : [];
      return `Deleted ${d.length} clip${d.length === 1 ? '' : 's'}${d.length ? `: ${d.map((c) => `“${c.name ?? '?'}”`).join(', ')}` : ''}.`;
    }
    case 'replace_notes': {
      const removed = typeof r.removed === 'number' ? r.removed : 0;
      return removed > 0
        ? `Replaced ${removed} existing note${removed === 1 ? '' : 's'}.`
        : undefined;
    }
    case 'remove_effect': {
      const d = (r.removed ?? {}) as { kind?: string; from?: string };
      return `Removed ${d.kind ?? 'an'} effect from ${d.from ?? 'a track'}.`;
    }
    default:
      return undefined;
  }
}

let conversationCount = 0;

export class AssistantConversation {
  /** Unique per instance (stable React key). */
  readonly id = `conversation-${++conversationCount}`;
  readonly store: StoreApi<ConversationState>;
  private history: AssistantMessage[] = [];
  private controller: AbortController | null = null;
  private nextId = 0;
  private readonly maxSteps: number;

  constructor(private readonly options: ConversationOptions) {
    this.maxSteps = options.maxSteps ?? 12;
    this.store = createStore<ConversationState>()(() => ({
      items: [],
      status: 'idle',
      error: null,
    }));
  }

  get state(): ConversationState {
    return this.store.getState();
  }

  /** Model-facing history (without the system prompt); exposed for tests. */
  get messages(): readonly AssistantMessage[] {
    return this.history;
  }

  get isConfigured(): boolean {
    return this.options.transport() !== undefined;
  }

  /** Sends a user message and runs the loop. Resolves when the turn is finished. */
  async send(text: string): Promise<void> {
    const content = text.trim();
    if (!content || this.state.status === 'running') return;
    this.history.push({ role: 'user', content });
    this.push({ kind: 'user', text: content });
    this.store.setState({ error: null });
    await this.run();
  }

  /** Re-runs the last user message after an error (or a stop). */
  async retry(): Promise<void> {
    if (this.state.status === 'running') return;
    const lastUser = this.history.map((m) => m.role).lastIndexOf('user');
    if (lastUser < 0) return;
    this.history = this.history.slice(0, lastUser + 1);
    const items = this.state.items;
    const lastUserItem = items.map((i) => i.kind).lastIndexOf('user');
    this.store.setState({ items: items.slice(0, lastUserItem + 1), error: null });
    await this.run();
  }

  /** Stops the current turn; tool calls already made stay applied (and undoable). */
  abort(): void {
    this.controller?.abort();
  }

  clear(): void {
    this.abort();
    this.history = [];
    this.store.setState({ items: [], error: null });
  }

  // --- loop ---------------------------------------------------------------------------------

  private async run(): Promise<void> {
    const transport = this.options.transport();
    if (!transport) {
      this.store.setState({
        error: { code: 'not-configured', message: NOT_CONFIGURED_MESSAGE },
      });
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    this.store.setState({ status: 'running', error: null });
    try {
      let finished = false;
      for (let step = 0; step < this.maxSteps && !finished; step++) {
        const response = await this.complete(transport, controller.signal);
        finished = await this.handleResponse(response, controller.signal);
      }
      if (!finished) {
        this.push({
          kind: 'notice',
          tone: 'warning',
          text: `Stopped after ${this.maxSteps} steps. Send “continue” to let the assistant keep going.`,
        });
      }
    } catch (error) {
      if (error instanceof AbortedError || controller.signal.aborted) {
        this.push({
          kind: 'notice',
          tone: 'info',
          text: 'Stopped. Changes made so far are kept; use Undo to revert them.',
        });
      } else {
        this.store.setState({ error: describeAssistantError(error) });
      }
    } finally {
      if (this.controller === controller) this.controller = null;
      this.options.onSettled?.();
      this.store.setState({ status: 'idle' });
    }
  }

  private async complete(
    transport: AssistantTransport,
    signal: AbortSignal,
  ): Promise<AssistantResponse> {
    const { session, model } = this.options;
    const request = {
      messages: [{ role: 'system', content: buildSystemPrompt(session) } as const, ...this.history],
      tools: toolDefinitions(session.tools),
      ...(model ? { model } : {}),
    };
    if (signal.aborted) throw new AbortedError();
    // Race the abort so Stop works even if a transport ignores the signal.
    return await new Promise<AssistantResponse>((resolve, reject) => {
      const onAbort = () => reject(new AbortedError());
      signal.addEventListener('abort', onAbort, { once: true });
      transport.complete(request, signal).then(
        (response) => {
          signal.removeEventListener('abort', onAbort);
          if (signal.aborted) reject(new AbortedError());
          else resolve(response);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(
            signal.aborted
              ? new AbortedError()
              : error instanceof Error
                ? error
                : Object.assign(new Error(String(error)), { cause: error }),
          );
        },
      );
    });
  }

  /** Records a model turn and runs its tool calls; returns true when the turn is final. */
  private async handleResponse(response: AssistantResponse, signal: AbortSignal): Promise<boolean> {
    const { message } = response;
    const toolCalls = message.toolCalls ?? [];
    this.history.push({
      role: 'assistant',
      content: message.content ?? '',
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    });
    if (message.content?.trim()) this.push({ kind: 'assistant', text: message.content.trim() });
    if (response.finishReason === 'error' && toolCalls.length === 0) {
      this.store.setState({
        error: { code: 'provider-error', message: ERROR_MESSAGES['provider-error'] },
      });
      return true;
    }
    if (toolCalls.length === 0) {
      if (response.finishReason === 'length') {
        this.push({
          kind: 'notice',
          tone: 'warning',
          text: 'The reply was cut off (length limit).',
        });
      }
      return true;
    }
    for (let i = 0; i < toolCalls.length; i++) {
      if (signal.aborted) {
        // Keep the history well-formed: every tool call needs a result message.
        for (const skipped of toolCalls.slice(i)) {
          this.history.push({
            role: 'tool',
            toolCallId: skipped.id,
            content: '{"error":"Cancelled by the user"}',
          });
          this.push(this.toolItem(skipped, undefined, 'skipped'));
        }
        throw new AbortedError();
      }
      await this.runToolCall(toolCalls[i]!);
    }
    return false;
  }

  private toolItem(call: AssistantToolCall, input: unknown, status: ToolCallStatus) {
    return {
      kind: 'tool' as const,
      name: call.name,
      title: this.options.session.tools.get(call.name)?.title ?? call.name,
      input,
      status,
    };
  }

  private async runToolCall(call: AssistantToolCall): Promise<void> {
    let input: unknown;
    let parseError: string | null = null;
    try {
      input = call.arguments.trim() ? (JSON.parse(call.arguments) as unknown) : {};
    } catch (error) {
      parseError = `Arguments were not valid JSON (${error instanceof Error ? error.message : 'parse error'}). Send a JSON object.`;
      input = call.arguments;
    }
    const id = this.push(this.toolItem(call, input, 'running'));
    let content: string;
    if (parseError) {
      this.update(id, { status: 'error', error: parseError });
      content = JSON.stringify({ error: parseError });
    } else {
      try {
        const result = await this.options.session.tools.call(call.name, input);
        const deleted = describeDeletion(call.name, result);
        this.update(id, { status: 'ok', result, ...(deleted ? { deleted } : {}) });
        content = stringifyResult(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.update(id, { status: 'error', error: message });
        content = JSON.stringify({ error: message });
      }
    }
    this.history.push({ role: 'tool', toolCallId: call.id, content });
  }

  // --- transcript helpers -------------------------------------------------------------------

  private push(item: DistributiveOmit<TranscriptItem, 'id'>): string {
    const id = `m${++this.nextId}`;
    this.store.setState((s) => ({ items: [...s.items, { ...item, id } as TranscriptItem] }));
    return id;
  }

  private update(id: string, patch: Partial<Extract<TranscriptItem, { kind: 'tool' }>>): void {
    this.store.setState((s) => ({
      items: s.items.map((item) =>
        item.id === id && item.kind === 'tool' ? { ...item, ...patch } : item,
      ),
    }));
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

// --- per-project, session-scoped conversations ----------------------------------------------

const conversations = new WeakMap<StudioSession, Map<string, AssistantConversation>>();

/**
 * The conversation for a project in this session (created on first use, kept in memory).
 * When a turn ends in a different project than it started in (the assistant itself opened or
 * created a project), the conversation follows the user to that project if it has none yet.
 */
export function getConversation(
  session: StudioSession,
  projectId: string,
  options: Omit<ConversationOptions, 'session' | 'transport' | 'onSettled'> = {},
): AssistantConversation {
  let byProject = conversations.get(session);
  if (!byProject) {
    byProject = new Map();
    conversations.set(session, byProject);
  }
  const map = byProject;
  const existing = map.get(projectId);
  if (existing) return existing;
  let key = projectId;
  const conversation: AssistantConversation = new AssistantConversation({
    ...options,
    session,
    transport: () => session.platform.assistant,
    onSettled: () => {
      const now = session.history.present.id;
      if (now !== key && !map.has(now) && map.get(key) === conversation) {
        map.delete(key);
        map.set(now, conversation);
        key = now;
      }
    },
  });
  map.set(projectId, conversation);
  return conversation;
}
