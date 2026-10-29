/**
 * Assistant (AI chat) transport. Studio's UI builds the conversation and runs tool calls
 * locally; a transport only exchanges one model turn. Hosts choose how that turn reaches a
 * model:
 *   - Next.js: a server action that calls the provider with a server-held key
 *   - Electron/Vite: POST to the Next.js `/api/assistant` endpoint (same server code)
 *   - Tauri (planned): call a provider directly with a user-configured key, or a local model
 * Message and tool shapes follow the widely used OpenAI-compatible chat format so the same
 * request works for OpenRouter, OpenAI-compatible local servers and future providers.
 */
import type { AbortSignalLike } from '@studio/audio-contracts';

/** JSON Schema subset used for tool parameters. */
export interface JsonSchema {
  readonly type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  readonly description?: string;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly enum?: readonly (string | number)[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly additionalProperties?: boolean;
}

export interface AssistantToolCall {
  readonly id: string;
  readonly name: string;
  /** Arguments as a JSON string, exactly as the model produced them. */
  readonly arguments: string;
}

export type AssistantMessage =
  | { readonly role: 'system'; readonly content: string }
  | { readonly role: 'user'; readonly content: string }
  | {
      readonly role: 'assistant';
      readonly content: string;
      readonly toolCalls?: readonly AssistantToolCall[];
    }
  | { readonly role: 'tool'; readonly toolCallId: string; readonly content: string };

export interface AssistantToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
}

export interface AssistantRequest {
  readonly messages: readonly AssistantMessage[];
  readonly tools: readonly AssistantToolDefinition[];
  /** Provider model id; the server may ignore it and use its configured default. */
  readonly model?: string;
}

export interface AssistantResponse {
  /** The model's reply; may contain tool calls the client should execute. */
  readonly message: Extract<AssistantMessage, { role: 'assistant' }>;
  readonly model: string;
  readonly finishReason: 'stop' | 'tool_calls' | 'length' | 'error' | 'other';
}

export type AssistantErrorCode =
  'not-configured' | 'unauthorized' | 'rate-limited' | 'bad-request' | 'provider-error' | 'network';

export interface AssistantTransport {
  /** Human-readable route, e.g. "OpenRouter via studio server". */
  readonly label: string;
  complete(request: AssistantRequest, signal?: AbortSignalLike): Promise<AssistantResponse>;
}
