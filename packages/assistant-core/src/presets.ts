/**
 * Provider presets. OpenRouter is the hosted route (server-held key today; a user key in Tauri
 * later). "openai-compatible" covers local servers such as Ollama (`http://localhost:11434/v1`)
 * and LM Studio (`http://localhost:1234/v1`), or any other OpenAI-compatible endpoint.
 */
import type { AssistantTransport } from '@studio/platform-contracts';
import {
  createOpenAiCompatibleClient,
  type FetchLike,
  type OpenAiCompatibleClientOptions,
} from './client';
import type { AssistantLimits } from './guards';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Default OpenRouter model: Anthropic's Claude Haiku 4.5 — reliable function/tool calling,
 * low latency and low cost per turn, which suits a chat panel that loops over tool calls on an
 * operator-paid key. Override with `OPENROUTER_MODEL` (server) or the `model` option.
 */
export const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-haiku-4.5';

export type AssistantProviderId = 'openrouter' | 'openai-compatible';

export interface AssistantProviderPreset {
  readonly id: AssistantProviderId;
  readonly label: string;
  readonly defaultBaseUrl: string;
  readonly defaultModel: string | null;
  readonly requiresApiKey: boolean;
}

/** Presets a settings UI (e.g. Tauri "bring your own provider") can offer. */
export const ASSISTANT_PROVIDER_PRESETS: readonly AssistantProviderPreset[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    defaultBaseUrl: OPENROUTER_BASE_URL,
    defaultModel: DEFAULT_OPENROUTER_MODEL,
    requiresApiKey: true,
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible server (Ollama, LM Studio, …)',
    defaultBaseUrl: 'http://localhost:11434/v1',
    defaultModel: null,
    requiresApiKey: false,
  },
];

export interface OpenRouterClientOptions {
  readonly fetch: FetchLike;
  readonly apiKey: string;
  readonly model?: string;
  readonly allowedModels?: readonly string[];
  /** Sent as `HTTP-Referer` (OpenRouter app attribution); must be an http(s) URL. */
  readonly referer?: string;
  /** Sent as `X-Title` (OpenRouter app attribution). */
  readonly title?: string;
  readonly limits?: Partial<AssistantLimits>;
  readonly baseUrl?: string;
  readonly label?: string;
}

/** Header values must be printable ASCII. */
function headerSafe(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, '').trim();
}

/** `URL` is not part of the portable (ES-only) lib, so this is a conservative pattern check. */
function isHttpUrl(value: string): boolean {
  return /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[\x21-\x7e]*)?$/.test(value);
}

export function createOpenRouterClient(options: OpenRouterClientOptions): AssistantTransport {
  const headers: Record<string, string> = {};
  if (options.referer && isHttpUrl(options.referer)) headers['HTTP-Referer'] = options.referer;
  const title = options.title ? headerSafe(options.title) : '';
  if (title) headers['X-Title'] = title;
  const clientOptions: OpenAiCompatibleClientOptions = {
    fetch: options.fetch,
    baseUrl: options.baseUrl ?? OPENROUTER_BASE_URL,
    apiKey: options.apiKey,
    defaultModel: options.model ?? DEFAULT_OPENROUTER_MODEL,
    headers,
    label: options.label ?? 'OpenRouter',
    ...(options.allowedModels ? { allowedModels: options.allowedModels } : {}),
    ...(options.limits ? { limits: options.limits } : {}),
  };
  return createOpenAiCompatibleClient(clientOptions);
}

/** User-level provider configuration (what Tauri will persist for "bring your own provider"). */
export interface AssistantProviderConfig {
  readonly provider: AssistantProviderId;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly model?: string;
}

/** Builds a client from a provider config; throws if the config is incomplete. */
export function createAssistantClient(
  config: AssistantProviderConfig,
  fetch: FetchLike,
  limits?: Partial<AssistantLimits>,
): AssistantTransport {
  const preset = ASSISTANT_PROVIDER_PRESETS.find((p) => p.id === config.provider);
  if (!preset) throw new Error(`Unknown assistant provider "${String(config.provider)}"`);
  if (preset.requiresApiKey && !config.apiKey) {
    throw new Error(`${preset.label} needs an API key`);
  }
  const model = config.model ?? preset.defaultModel;
  if (!model) throw new Error(`${preset.label} needs a model id`);
  if (config.provider === 'openrouter') {
    return createOpenRouterClient({
      fetch,
      apiKey: config.apiKey ?? '',
      model,
      baseUrl: config.baseUrl ?? preset.defaultBaseUrl,
      ...(limits ? { limits } : {}),
    });
  }
  return createOpenAiCompatibleClient({
    fetch,
    baseUrl: config.baseUrl ?? preset.defaultBaseUrl,
    defaultModel: model,
    label: preset.label,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    ...(limits ? { limits } : {}),
  });
}
