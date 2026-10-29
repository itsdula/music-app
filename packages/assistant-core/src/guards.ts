/**
 * Request guards shared by every assistant route. Input arriving at a server action or HTTP
 * endpoint is untrusted, so `validateAssistantRequest` checks the full structure, enforces size
 * limits and returns a clean copy (unknown fields dropped) ready to send to a provider.
 */
import type {
  AssistantMessage,
  AssistantRequest,
  AssistantToolCall,
  AssistantToolDefinition,
  JsonSchema,
} from '@studio/platform-contracts';

export interface AssistantLimits {
  /** Messages per request (system + user + assistant + tool). */
  readonly maxMessages: number;
  /** Total characters across message contents, tool-call arguments and tool definitions. */
  readonly maxTotalChars: number;
  /** Tool definitions per request. */
  readonly maxTools: number;
  /** `max_tokens` sent to the provider: caps the length (and cost) of one reply. */
  readonly maxOutputTokens: number;
}

export const DEFAULT_ASSISTANT_LIMITS: AssistantLimits = {
  maxMessages: 200,
  maxTotalChars: 200_000,
  maxTools: 64,
  maxOutputTokens: 4096,
};

export function resolveAssistantLimits(partial?: Partial<AssistantLimits>): AssistantLimits {
  return { ...DEFAULT_ASSISTANT_LIMITS, ...partial };
}

export type AssistantValidation =
  | { readonly ok: true; readonly request: AssistantRequest }
  | { readonly ok: false; readonly code: 'bad-request'; readonly message: string };

/** Tool names accepted by OpenAI-compatible providers. */
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_ID_LENGTH = 256;
const MAX_MODEL_ID_LENGTH = 200;

class GuardError extends Error {}

function fail(message: string): never {
  throw new GuardError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, what: string, maxLength?: number): string {
  if (typeof value !== 'string') fail(`${what} must be a string.`);
  if (maxLength !== undefined && value.length > maxLength) fail(`${what} is too long.`);
  return value;
}

function requireId(value: unknown, what: string): string {
  const id = requireString(value, what, MAX_ID_LENGTH);
  if (id.length === 0) fail(`${what} must not be empty.`);
  return id;
}

function parseToolCall(value: unknown, where: string): AssistantToolCall {
  if (!isRecord(value)) fail(`${where} must be an object.`);
  const name = requireString(value.name, `${where}.name`);
  if (!TOOL_NAME.test(name)) fail(`${where}.name is not a valid tool name.`);
  return {
    id: requireId(value.id, `${where}.id`),
    name,
    arguments: requireString(value.arguments, `${where}.arguments`),
  };
}

function parseMessage(value: unknown, index: number): AssistantMessage {
  const where = `messages[${index}]`;
  if (!isRecord(value)) fail(`${where} must be an object.`);
  const content = requireString(value.content, `${where}.content`);
  switch (value.role) {
    case 'system':
    case 'user':
      return { role: value.role, content };
    case 'assistant': {
      if (value.toolCalls === undefined) return { role: 'assistant', content };
      if (!Array.isArray(value.toolCalls)) fail(`${where}.toolCalls must be an array.`);
      const toolCalls = value.toolCalls.map((call, i) =>
        parseToolCall(call, `${where}.toolCalls[${i}]`),
      );
      return toolCalls.length > 0
        ? { role: 'assistant', content, toolCalls }
        : { role: 'assistant', content };
    }
    case 'tool':
      return {
        role: 'tool',
        toolCallId: requireId(value.toolCallId, `${where}.toolCallId`),
        content,
      };
    default:
      return fail(`${where}.role must be system, user, assistant or tool.`);
  }
}

/** Returns a JSON-clean copy of a tool's parameter schema and its serialised length. */
function cleanSchema(value: unknown, where: string): { schema: JsonSchema; chars: number } {
  if (!isRecord(value)) fail(`${where} must be a JSON Schema object.`);
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return fail(`${where} must be JSON-serialisable.`);
  }
  return { schema: JSON.parse(json) as JsonSchema, chars: json.length };
}

function parseTool(
  value: unknown,
  index: number,
): { tool: AssistantToolDefinition; chars: number } {
  const where = `tools[${index}]`;
  if (!isRecord(value)) fail(`${where} must be an object.`);
  const name = requireString(value.name, `${where}.name`);
  if (!TOOL_NAME.test(name)) fail(`${where}.name is not a valid tool name.`);
  const description = requireString(value.description, `${where}.description`);
  const { schema, chars } = cleanSchema(value.parameters, `${where}.parameters`);
  return {
    tool: { name, description, parameters: schema },
    chars: name.length + description.length + chars,
  };
}

function messageChars(message: AssistantMessage): number {
  let chars = message.content.length;
  if (message.role === 'assistant' && message.toolCalls) {
    for (const call of message.toolCalls) chars += call.name.length + call.arguments.length;
  }
  return chars;
}

/** Validates untrusted input against the contract and the limits. */
export function validateAssistantRequest(
  input: unknown,
  limits: AssistantLimits = DEFAULT_ASSISTANT_LIMITS,
): AssistantValidation {
  try {
    if (!isRecord(input)) fail('The request must be an object.');
    if (!Array.isArray(input.messages)) fail('messages must be an array.');
    if (input.messages.length === 0) fail('messages must not be empty.');
    if (input.messages.length > limits.maxMessages) {
      fail(`Too many messages (limit ${limits.maxMessages}).`);
    }
    const tools: unknown = input.tools ?? [];
    if (!Array.isArray(tools)) fail('tools must be an array.');
    if (tools.length > limits.maxTools) fail(`Too many tools (limit ${limits.maxTools}).`);

    const messages = input.messages.map(parseMessage);
    let totalChars = messages.reduce((sum, message) => sum + messageChars(message), 0);

    const seen = new Set<string>();
    const parsedTools = tools.map((tool, index) => {
      const parsed = parseTool(tool, index);
      if (seen.has(parsed.tool.name)) fail(`Duplicate tool name "${parsed.tool.name}".`);
      seen.add(parsed.tool.name);
      totalChars += parsed.chars;
      return parsed.tool;
    });
    if (totalChars > limits.maxTotalChars) {
      fail(`The conversation is too long (limit ${limits.maxTotalChars} characters).`);
    }

    let model: string | undefined;
    if (input.model !== undefined && input.model !== null) {
      model = requireString(input.model, 'model', MAX_MODEL_ID_LENGTH).trim() || undefined;
    }
    const request: AssistantRequest =
      model === undefined
        ? { messages, tools: parsedTools }
        : { messages, tools: parsedTools, model };
    return { ok: true, request };
  } catch (error) {
    if (error instanceof GuardError)
      return { ok: false, code: 'bad-request', message: error.message };
    throw error;
  }
}
