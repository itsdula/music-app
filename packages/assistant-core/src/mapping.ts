/**
 * AssistantRequest/AssistantResponse ↔ OpenAI-compatible `/chat/completions` JSON.
 * Reference shape: the OpenAI Chat Completions API, which OpenRouter, Ollama, LM Studio,
 * vLLM and llama.cpp's server all accept.
 */
import type {
  AssistantMessage,
  AssistantRequest,
  AssistantResponse,
  AssistantToolCall,
} from '@studio/platform-contracts';
import { AssistantError } from './errors';

type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: {
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ChatCompletionsBody {
  model: string;
  messages: ChatMessage[];
  max_tokens: number;
  tools?: {
    type: 'function';
    function: { name: string; description: string; parameters: unknown };
  }[];
  tool_choice?: 'auto';
  stream: false;
}

function toChatMessage(message: AssistantMessage): ChatMessage {
  switch (message.role) {
    case 'system':
    case 'user':
      return { role: message.role, content: message.content };
    case 'assistant': {
      const calls = message.toolCalls ?? [];
      if (calls.length === 0) return { role: 'assistant', content: message.content };
      return {
        role: 'assistant',
        // Several providers reject an empty string next to tool calls; null is the documented form.
        content: message.content === '' ? null : message.content,
        tool_calls: calls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }
    case 'tool':
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  }
}

export function toChatCompletionsBody(
  request: AssistantRequest,
  options: { readonly model: string; readonly maxTokens: number },
): ChatCompletionsBody {
  const body: ChatCompletionsBody = {
    model: options.model,
    messages: request.messages.map(toChatMessage),
    max_tokens: options.maxTokens,
    stream: false,
  };
  // Omit empty tool lists: some OpenAI-compatible servers reject `tools: []`.
  if (request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
    body.tool_choice = 'auto';
  }
  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // Some providers return content parts: [{ type: 'text', text: '…' }].
    return content
      .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
}

function parseToolCalls(value: unknown): AssistantToolCall[] {
  if (!Array.isArray(value)) return [];
  const calls: AssistantToolCall[] = [];
  value.forEach((raw, index) => {
    if (!isRecord(raw)) return;
    const fn = isRecord(raw.function) ? raw.function : {};
    if (typeof fn.name !== 'string' || fn.name === '') return;
    const args = fn.arguments;
    calls.push({
      id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : `call_${index}`,
      name: fn.name,
      arguments:
        typeof args === 'string'
          ? args
          : args === undefined || args === null
            ? '{}'
            : JSON.stringify(args),
    });
  });
  return calls;
}

function mapFinishReason(
  reason: unknown,
  hasToolCalls: boolean,
): AssistantResponse['finishReason'] {
  if (hasToolCalls) return 'tool_calls';
  switch (reason) {
    case 'stop':
    case 'end_turn':
      return 'stop';
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls';
    case 'length':
    case 'max_tokens':
      return 'length';
    case 'error':
      return 'error';
    default:
      return reason === null || reason === undefined ? 'stop' : 'other';
  }
}

const INVALID = 'The model provider returned an unexpected response.';

/** Maps a successful chat-completions JSON body to an AssistantResponse. */
export function fromChatCompletionsBody(body: unknown, requestedModel: string): AssistantResponse {
  if (!isRecord(body) || !Array.isArray(body.choices) || body.choices.length === 0) {
    throw new AssistantError('provider-error', INVALID);
  }
  const choice: unknown = body.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) {
    throw new AssistantError('provider-error', INVALID);
  }
  const toolCalls = parseToolCalls(choice.message.tool_calls);
  const content = contentText(choice.message.content);
  return {
    message:
      toolCalls.length > 0
        ? { role: 'assistant', content, toolCalls }
        : { role: 'assistant', content },
    model: typeof body.model === 'string' && body.model !== '' ? body.model : requestedModel,
    finishReason: mapFinishReason(choice.finish_reason, toolCalls.length > 0),
  };
}
